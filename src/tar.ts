import { constants } from 'node:fs';
import { chmod, mkdir, open, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { UserError } from './errors.js';
import { statIfExists } from './files.js';

const BLOCK_SIZE = 512;

const readString = (buffer: Buffer, start: number, length: number): string =>
  buffer
    .subarray(start, start + length)
    .toString('utf8')
    .split('\0')[0] ?? '';

const readNumber = (buffer: Buffer, start: number, length: number): number => {
  const field = buffer.subarray(start, start + length);

  if (field[0]! & 0x80) {
    let value = BigInt(field[0]! & 0x7f);

    for (const byte of field.subarray(1)) {
      value = value * 256n + BigInt(byte);
    }

    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new UserError('Invalid tar archive: numeric field is too large');
    }

    return Number(value);
  }

  const text = readString(buffer, start, length).trim();

  if (text && !/^[0-7]+$/u.test(text)) {
    throw new UserError('Invalid tar archive: expected an octal numeric field');
  }

  const value = Number.parseInt(text || '0', 8);

  if (!Number.isSafeInteger(value)) {
    throw new UserError('Invalid tar archive: numeric field is too large');
  }

  return value;
};

const checkHeader = (header: Buffer): void => {
  let checksum = 0;

  for (const [index, byte] of header.entries()) {
    checksum += index >= 148 && index < 156 ? 32 : byte;
  }

  if (checksum !== readNumber(header, 148, 8)) {
    throw new UserError('Invalid tar archive: header checksum does not match');
  }
};

const parsePax = (data: Buffer): Record<string, string> => {
  const fields: Record<string, string> = Object.create(null) as Record<string, string>;
  let offset = 0;

  while (offset < data.length) {
    const space = data.indexOf(32, offset);
    const sizeText = data.subarray(offset, space).toString('ascii');
    const size = Number(sizeText);

    if (
      space < offset ||
      !/^\d+$/u.test(sizeText) ||
      !Number.isSafeInteger(size) ||
      size <= space - offset + 1 ||
      offset + size > data.length ||
      data[offset + size - 1] !== 10
    ) {
      throw new UserError('Invalid tar archive: malformed pax record');
    }

    const record = data.subarray(space + 1, offset + size - 1).toString('utf8');
    const equals = record.indexOf('=');

    if (equals < 1) {
      throw new UserError('Invalid tar archive: malformed pax attribute');
    }

    fields[record.slice(0, equals)] = record.slice(equals + 1);
    offset += size;
  }

  return fields;
};

export const entryPath = (root: string, name: string): string | undefined => {
  if (
    name.includes('\\') ||
    name.includes('\0') ||
    name.startsWith('/') ||
    /^[a-z]:/iu.test(name)
  ) {
    throw new UserError(`Unsafe tar entry "${name}": path escapes the target directory`);
  }

  const components = name.split('/').filter((component) => component && component !== '.');

  if (components.includes('..')) {
    throw new UserError(`Unsafe tar entry "${name}": path escapes the target directory`);
  }

  components.shift();

  if (components.length === 0 || components.includes('.git')) {
    return undefined;
  }

  const destination = resolve(root, ...components);
  const withinRoot = relative(resolve(root), destination);

  if (withinRoot === '..' || withinRoot.startsWith(`..${sep}`) || isAbsolute(withinRoot)) {
    throw new UserError(`Unsafe tar entry "${name}": path escapes the target directory`);
  }

  return destination;
};

const ensureDirectory = async (root: string, directory: string): Promise<void> => {
  const parts = relative(root, directory).split(sep).filter(Boolean);
  let current = root;

  for (const part of ['', ...parts]) {
    current = join(current, part);
    const info = await statIfExists(current);

    if (info && (!info.isDirectory() || info.isSymbolicLink())) {
      throw new UserError(
        `Unsafe tar destination "${current}": expected a directory without symlinks`,
      );
    }

    await mkdir(current, { recursive: true });
  }
};

/** Read ustar, pax and GNU long-name archives, stripping their enclosing directory. */
export const extractTar = async (archive: Buffer, directory: string): Promise<void> => {
  const root = resolve(directory);
  const directoryModes = new Map<string, number>();
  let pax: Record<string, string> = {};
  let longName: string | undefined;
  let offset = 0;
  let hasEnded = false;

  await ensureDirectory(root, root);

  while (offset + BLOCK_SIZE <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK_SIZE);

    if (header.every((byte) => byte === 0)) {
      hasEnded = true;
      break;
    }

    checkHeader(header);
    const type = readString(header, 156, 1);
    const isExtended = ['x', 'g', 'L', 'K'].includes(type);
    const headerSize = readNumber(header, 124, 12);
    const size = !isExtended && pax.size !== undefined ? Number(pax.size) : headerSize;

    if (!Number.isSafeInteger(size) || size < 0) {
      throw new UserError('Invalid tar archive: invalid entry size');
    }

    const start = offset + BLOCK_SIZE;
    const next = start + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;

    if (next > archive.length) {
      throw new UserError('Invalid tar archive: truncated entry');
    }

    const data = archive.subarray(start, start + size);

    offset = next;

    if (type === 'g') {
      // GitHub emits pax_global_header with repository metadata, not project files.
      continue;
    }

    if (type === 'x') {
      pax = { ...pax, ...parsePax(data) };
      continue;
    }

    if (type === 'L') {
      longName = readString(data, 0, data.length);
      continue;
    }

    if (type === 'K') {
      continue;
    }

    const prefix = readString(header, 257, 6) === 'ustar' ? readString(header, 345, 155) : '';
    const headerName = [prefix, readString(header, 0, 100)].filter(Boolean).join('/');
    const name = pax.path ?? longName ?? headerName;

    pax = {};
    longName = undefined;

    // Skip links, devices, FIFOs and other non-file entries without following them.
    if (!['', '0', '5'].includes(type) || name === 'pax_global_header') {
      continue;
    }

    const destination = entryPath(root, name);

    if (!destination) {
      continue;
    }

    const mode = readNumber(header, 100, 8) & 0o777;

    if (type === '5' || name.endsWith('/')) {
      await ensureDirectory(root, destination);
      directoryModes.set(destination, mode);
      continue;
    }

    await ensureDirectory(root, dirname(destination));
    const existing = await statIfExists(destination);

    if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
      throw new UserError(`Unsafe tar destination "${destination}": expected a regular file`);
    }

    await rm(destination, { force: true });
    const file = await open(
      destination,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      mode,
    );

    try {
      await file.writeFile(data);
      await file.chmod(mode);
    } finally {
      await file.close();
    }
  }

  if (!hasEnded) {
    throw new UserError('Invalid tar archive: missing end-of-archive block');
  }

  const deepestFirst = [...directoryModes].sort(([left], [right]) => right.length - left.length);

  for (const [path, mode] of deepestFirst) {
    await chmod(path, mode);
  }
};
