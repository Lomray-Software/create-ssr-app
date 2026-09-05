import {
  chmod,
  link,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { entryPath, extractTar } from '../src/tar.js';
import { systemTar, temporaryDirectory } from './helpers.js';

const temporary: string[] = [];

const fixture = async (): Promise<string> => {
  const parent = await temporaryDirectory();

  temporary.push(parent);
  await mkdir(join(parent, 'template', 'nested', 'empty'), { recursive: true });
  await writeFile(join(parent, 'template', 'nested', 'run.sh'), '#!/bin/sh\necho hello\n');
  await chmod(join(parent, 'template', 'nested', 'run.sh'), 0o751);
  await chmod(join(parent, 'template', 'nested', 'empty'), 0o701);

  return parent;
};

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('system tar archives', () => {
  it.each(['ustar', 'pax', 'gnu'] as const)(
    'reads %s directories, nested files, long paths and file modes',
    async (format) => {
      const parent = await fixture();
      const directoryName = 'directory-'.repeat(8);
      const filename = format === 'ustar' ? 'file-'.repeat(12) : `${'long-'.repeat(35)}é.txt`;
      const relativePath = join(directoryName, filename);

      await mkdir(join(parent, 'template', directoryName));
      await writeFile(join(parent, 'template', relativePath), 'long file contents');
      const archive = await systemTar(parent, format);
      const target = join(parent, 'output');

      if (format === 'pax') {
        expect(archive.includes(Buffer.from('path='))).toBe(true);
      }

      if (format === 'gnu') {
        expect(archive.includes(Buffer.from('././@LongLink'))).toBe(true);
      }

      await extractTar(archive, target);
      expect(relativePath.length).toBeGreaterThan(100);
      expect(await readFile(join(target, relativePath), 'utf8')).toBe('long file contents');
      expect(await readFile(join(target, 'nested', 'run.sh'), 'utf8')).toBe(
        '#!/bin/sh\necho hello\n',
      );
      expect((await stat(join(target, 'nested', 'run.sh'))).mode & 0o777).toBe(0o751);
      expect((await stat(join(target, 'nested', 'empty'))).mode & 0o777).toBe(0o701);
      expect(await readdir(target)).not.toContain('template');
    },
  );

  it.each(['ustar', 'pax', 'gnu'] as const)(
    'rejects traversal in %s archives produced with system tar',
    async (format) => {
      const parent = await fixture();

      await writeFile(join(parent, 'template', 'payload'), 'must not escape');
      const escapedName = format === 'ustar' ? 'escaped' : 'escaped'.repeat(22);
      const archive = await systemTar(
        parent,
        format,
        `|template/payload|template/../${escapedName}|`,
      );

      await expect(extractTar(archive, join(parent, 'output'))).rejects.toThrow(
        'escapes the target directory',
      );
      await expect(stat(join(parent, escapedName))).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('skips symlinks, hard links and source git metadata', async () => {
    const parent = await fixture();

    await symlink('../../outside', join(parent, 'template', 'symlink'));
    await link(join(parent, 'template', 'nested', 'run.sh'), join(parent, 'template', 'hardlink'));
    await mkdir(join(parent, 'template', '.git'));
    await writeFile(join(parent, 'template', '.git', 'config'), 'template git config');
    const target = join(parent, 'output');

    await extractTar(await systemTar(parent), target);
    expect(await readdir(target)).not.toContain('symlink');
    expect(await readdir(target)).not.toContain('.git');
    // tar may select either hard-linked name as the regular file; it must not recreate a link.
    const files = await readdir(target);

    if (files.includes('hardlink')) {
      expect((await stat(join(target, 'hardlink'))).nlink).toBe(1);
    }
  });

  it('refuses existing symlinks in the extraction destination', async () => {
    const parent = await fixture();
    const target = join(parent, 'output');
    const outside = join(parent, 'outside');

    await mkdir(target);
    await mkdir(outside);
    await symlink(outside, join(target, 'nested'));
    await expect(extractTar(await systemTar(parent), target)).rejects.toThrow('without symlinks');
    expect(await readdir(outside)).toEqual([]);
  });

  it('rejects corrupt checksums and truncated archives', async () => {
    const parent = await fixture();
    const archive = await systemTar(parent);
    const corrupt = Buffer.from(archive);

    corrupt[0] = corrupt[0]! ^ 1;
    await expect(extractTar(corrupt, join(parent, 'corrupt'))).rejects.toThrow('checksum');
    await expect(extractTar(archive.subarray(0, 513), join(parent, 'truncated'))).rejects.toThrow(
      'end-of-archive',
    );
  });

  it('ignores a pax global header without applying its path to project files', async () => {
    const parent = await fixture();
    const payload = Buffer.from('19 path=../../evil\n');
    const header = Buffer.alloc(512);

    header.write('pax_global_header');
    header.write('0000644\0', 100);
    header.write(`${payload.length.toString(8).padStart(11, '0')}\0`, 124);
    header.fill(32, 148, 156);
    header.write('g', 156);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);

    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
    const archive = Buffer.concat([
      header,
      payload,
      Buffer.alloc(512 - payload.length),
      await systemTar(parent),
    ]);
    const target = join(parent, 'output');

    await extractTar(archive, target);
    expect(await readdir(target)).toEqual(['nested']);
    expect(await readFile(join(target, 'nested', 'run.sh'), 'utf8')).toContain('echo hello');
  });
});

describe('archive paths', () => {
  it.each([
    'template/../../evil',
    '/tmp/evil',
    'C:/evil',
    'template/..\\evil',
    'template/one/../../../evil',
  ])('rejects %s', (name) => {
    expect(() => entryPath('/tmp/destination', name)).toThrow('escapes the target directory');
  });

  it('strips only the enclosing directory and ignores its root entry', () => {
    expect(entryPath('/tmp/destination', 'template/')).toBeUndefined();
    expect(entryPath('/tmp/destination', 'template/src/main.ts')).toBe(
      '/tmp/destination/src/main.ts',
    );
  });
});
