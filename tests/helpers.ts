import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

interface IFixtureOptions {
  scripts?: Record<string, string>;
  nodeVersion?: string;
}

interface ICiWorkflow {
  name: string;
  on: string[];
  permissions: Record<string, string>;
  jobs: {
    check: {
      'runs-on': string;
      steps: { uses?: string; with?: Record<string, string>; run?: string }[];
    };
  };
}

export const readCiWorkflow = async (directory: string): Promise<ICiWorkflow> =>
  parse(await readFile(join(directory, '.github', 'workflows', 'ci.yml'), 'utf8')) as ICiWorkflow;

export const temporaryDirectory = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'create-ssr-test-'));

export const writeFixture = async (
  directory: string,
  { scripts, nodeVersion }: IFixtureOptions = {},
): Promise<void> => {
  await mkdir(join(directory, '.github', 'workflows'), { recursive: true });
  await mkdir(join(directory, '.husky'), { recursive: true });
  await mkdir(join(directory, 'src'), { recursive: true });
  const manifest = {
    name: '@lomray/vite-template',
    version: '9.9.9',
    private: true,
    description: 'Template description',
    repository: { url: 'template' },
    homepage: 'template',
    bugs: 'template',
    author: 'Template author',
    keywords: ['template'],
    scripts: scripts ?? { prepare: 'husky', develop: 'vite', build: 'vite build' },
    dependencies: { react: '^19.0.0' },
  };

  await writeFile(join(directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  if (nodeVersion !== undefined) {
    await writeFile(join(directory, '.nvmrc'), `${nodeVersion}\n`);
  }

  await writeFile(
    join(directory, 'package-lock.json'),
    '{"name":"template","lockfileVersion":3}\n',
  );

  for (const file of [
    '.github/workflows/ci.yml',
    '.github/workflows/release.yml',
    '.github/CODEOWNERS',
    '.husky/pre-commit',
    'renovate.json',
    'CHANGELOG.md',
    'LICENSE',
    'SECURITY.md',
    'vercel.json',
    'amplify.yml',
    'Dockerfile',
    'README.md',
    'src/main.ts',
  ]) {
    await writeFile(join(directory, file), `fixture: ${file}\n`);
  }

  await chmod(join(directory, '.husky/pre-commit'), 0o755);
};

export const systemTar = async (
  parent: string,
  format: 'ustar' | 'pax' | 'gnu' = 'ustar',
  transform?: string,
): Promise<Buffer> => {
  const isBsd = execFileSync('tar', ['--version'], { encoding: 'utf8' }).includes('bsdtar');
  const archivePath = join(parent, `${format}.tar`);
  const args = [
    `--format=${isBsd && format === 'gnu' ? 'gnutar' : format}`,
    '-cf',
    archivePath,
    '-C',
    parent,
  ];

  if (transform) {
    args.push(...(isBsd ? ['-s', transform] : ['--transform', `s${transform}`]));
  }

  args.push('template');
  execFileSync('tar', args, { env: { ...process.env, COPYFILE_DISABLE: '1' } });

  return readFile(archivePath);
};
