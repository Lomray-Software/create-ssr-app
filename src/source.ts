import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { UserError, errorCause } from './errors.js';
import { copyDirectory, statIfExists } from './files.js';
import { extractTar } from './tar.js';

const decompress = promisify(gunzip);
const archiveBase = 'https://codeload.github.com/Lomray-Software/vite-template/tar.gz';

export const downloadArchive = async (ref: string, allowRefFallback: boolean): Promise<Buffer> => {
  const encodedRef = ref.split('/').map(encodeURIComponent).join('/');
  const urls = [`${archiveBase}/refs/heads/${encodedRef}`];

  if (allowRefFallback) {
    urls.push(`${archiveBase}/${encodedRef}`);
  }

  for (const [index, url] of urls.entries()) {
    let response;

    try {
      response = await fetch(url, { signal: AbortSignal.timeout(60_000) });

      if (response.ok) {
        return Buffer.from(await response.arrayBuffer());
      }
    } catch (error) {
      throw new UserError(
        `Unable to download template ref "${ref}": network failure (${errorCause(error)})`,
      );
    }

    await response.body?.cancel();

    if (response.status !== 404 || index === urls.length - 1) {
      throw new UserError(
        `Unable to download template ref "${ref}": HTTP ${response.status} ${response.statusText}`,
      );
    }
  }

  throw new UserError(`Template ref "${ref}" was not found`);
};

export const loadSource = async (
  destination: string,
  ref: string,
  allowRefFallback: boolean,
  source?: string,
): Promise<void> => {
  let compressed;

  if (source) {
    const path = resolve(source);
    const info = await statIfExists(path);

    if (!info || (!info.isDirectory() && !info.isFile())) {
      throw new UserError(`Offline source "${path}" must be a .tar.gz file or directory`);
    }

    if (info.isDirectory()) {
      await copyDirectory(path, destination);

      return;
    }

    compressed = await readFile(path);
  } else {
    compressed = await downloadArchive(ref, allowRefFallback);
  }

  let archive;

  try {
    archive = await decompress(compressed);
  } catch (error) {
    throw new UserError(`Unable to decompress template archive: ${errorCause(error)}`);
  }

  await extractTar(archive, destination);
};
