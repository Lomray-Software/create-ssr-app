import type { Stats } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { UserError } from './errors.js';

export const statIfExists = async (path: string): Promise<Stats | undefined> => {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
};

export const checkDestination = async (directory: string, force: boolean): Promise<void> => {
  const info = await statIfExists(directory);

  if (!info) {
    return;
  }

  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new UserError(`Destination "${directory}" must be a directory, not a file or symlink`);
  }

  if (!force && (await readdir(directory)).length > 0) {
    throw new UserError(
      `Directory "${directory}" is not empty; use --force to allow existing files`,
    );
  }
};

interface ICopyEntry {
  source: string;
  target: string;
  directory: boolean;
  mode: number;
}

const collectEntries = async (source: string, target: string): Promise<ICopyEntry[]> => {
  const entries: ICopyEntry[] = [];

  for (const entry of await readdir(source, { withFileTypes: true })) {
    // Repository metadata and links must never be imported from an offline checkout.
    if (entry.name === '.git' || entry.isSymbolicLink()) {
      continue;
    }

    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    const info = await lstat(sourcePath);

    if (!info.isFile() && !info.isDirectory()) {
      continue;
    }

    const existing = await statIfExists(targetPath);

    if (
      existing &&
      (existing.isSymbolicLink() ||
        existing.isDirectory() !== info.isDirectory() ||
        (!existing.isDirectory() && !existing.isFile()))
    ) {
      throw new UserError(
        `Destination entry "${targetPath}" conflicts with the template or is a symlink`,
      );
    }

    entries.push({
      source: sourcePath,
      target: targetPath,
      directory: info.isDirectory(),
      mode: info.mode & 0o777,
    });

    if (info.isDirectory()) {
      entries.push(...(await collectEntries(sourcePath, targetPath)));
    }
  }

  return entries;
};

export const copyDirectory = async (source: string, target: string): Promise<void> => {
  await checkDestination(target, true);
  const entries = await collectEntries(source, target);

  await mkdir(target, { recursive: true });

  for (const entry of entries) {
    if (entry.directory) {
      await mkdir(entry.target, { recursive: true });
    } else {
      // Replace the entry itself so an existing hard link cannot modify an outside file.
      await rm(entry.target, { force: true });
      await copyFile(entry.source, entry.target);
      await chmod(entry.target, entry.mode);
    }
  }

  for (const entry of entries.reverse()) {
    if (entry.directory) {
      await chmod(entry.target, entry.mode);
    }
  }
};
