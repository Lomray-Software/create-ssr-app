import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const temporaryDirectory = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'create-ssr-test-'));

export const writeFixture = async (directory: string): Promise<void> => {
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
    scripts: { prepare: 'husky', develop: 'vite', build: 'vite build' },
    dependencies: { react: '^19.0.0' },
  };

  await writeFile(join(directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    join(directory, 'package-lock.json'),
    '{"name":"template","lockfileVersion":3}\n',
  );

  for (const file of [
    '.github/workflows/ci.yml',
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
