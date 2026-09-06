import { readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { writeCiWorkflow } from './ci.js';
import { UserError, errorCause } from './errors.js';

export const packageName = (directory: string): string => {
  const name = basename(resolve(directory))
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[._-]+|[._-]+$/gu, '')
    .slice(0, 214);

  if (!name) {
    return 'my-ssr-app';
  }

  return ['node_modules', 'favicon.ico'].includes(name) ? `my-${name}` : name;
};

export const rewritePackage = (
  manifest: Record<string, unknown>,
  directory: string,
  git: boolean,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {
    ...manifest,
    name: packageName(directory),
    version: '0.1.0',
  };

  for (const key of ['description', 'repository', 'homepage', 'bugs', 'author', 'keywords']) {
    delete result[key];
  }

  if (!git && result.scripts && typeof result.scripts === 'object') {
    const scripts = { ...result.scripts } as Record<string, unknown>;

    delete scripts.prepare;
    result.scripts = scripts;
  }

  return result;
};

export const postProcess = async (
  directory: string,
  nameFrom: string,
  git: boolean,
): Promise<void> => {
  const manifestPath = join(directory, 'package.json');
  let manifest;

  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
  } catch (error) {
    throw new UserError(`Unable to read the template package.json: ${errorCause(error)}`);
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new UserError('The template package.json must contain a JSON object');
  }

  const rewritten = rewritePackage(manifest as Record<string, unknown>, nameFrom, git);

  await writeFile(manifestPath, `${JSON.stringify(rewritten, null, 2)}\n`);
  await removeTemplateMetadata(directory, git);
  await writeCiWorkflow(directory, rewritten);
};

export const removeTemplateMetadata = async (directory: string, git: boolean): Promise<void> => {
  const removals = ['.github', 'renovate.json', 'CHANGELOG.md', 'LICENSE', 'SECURITY.md'];

  if (!git) {
    removals.push('.husky');
  }

  await Promise.all(
    removals.map((file) => rm(join(directory, file), { recursive: true, force: true })),
  );
};
