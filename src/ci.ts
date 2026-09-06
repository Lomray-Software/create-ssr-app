import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { statIfExists } from './files.js';

export const writeCiWorkflow = async (
  directory: string,
  manifest: Record<string, unknown>,
): Promise<void> => {
  const { scripts } = manifest;
  const commands = ['lint:check', 'ts:check', 'style:check', 'build', 'size:check', 'smoke']
    .filter(
      (script) =>
        scripts &&
        typeof scripts === 'object' &&
        Object.hasOwn(scripts, script) &&
        typeof (scripts as Record<string, unknown>)[script] === 'string',
    )
    .map(
      (script) =>
        `      - run: npm run ${script}${script === 'build' ? ' -- --throw-warnings' : ''}`,
    );
  const nodeVersion = (await statIfExists(join(directory, '.nvmrc')))?.isFile()
    ? 'node-version-file: .nvmrc'
    : "node-version: '22'";
  const workflow = `name: CI

on: [push, pull_request]

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          ${nodeVersion}
          cache: npm
      - run: npm ci --ignore-scripts
${commands.join('\n')}
`;
  const workflows = join(directory, '.github', 'workflows');

  await mkdir(workflows, { recursive: true });
  await writeFile(join(workflows, 'ci.yml'), workflow);
};
