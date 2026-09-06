import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import { chmod, link, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldInitializeGit } from '../src/commands.js';
import { colorize, run, scaffold } from '../src/index.js';
import { parseArgs } from '../src/options.js';
import { packageManagers } from '../src/package-manager.js';
import { readCiWorkflow, temporaryDirectory, writeFixture } from './helpers.js';

vi.mock('node:child_process', { spy: true });

const temporary: string[] = [];

const fixture = async (): Promise<{ parent: string; source: string; target: string }> => {
  const parent = await temporaryDirectory();

  temporary.push(parent);
  const source = join(parent, 'source');

  await writeFixture(source);

  return { parent, source, target: join(parent, 'My App') };
};

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('scaffolding', () => {
  it('creates an offline project and preserves the source and lockfile', async () => {
    const { source, target } = await fixture();
    const log = vi.fn<(message: string) => void>();

    await scaffold(parseArgs([target, '--no-install', '--no-git', '-y']).options, log, source);
    const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8')) as {
      name: string;
    };

    expect(manifest.name).toBe('my-app');
    expect(await readFile(join(target, 'package-lock.json'))).toEqual(
      await readFile(join(source, 'package-lock.json')),
    );
    expect(await readdir(source)).toContain('.github');
    expect(await readCiWorkflow(target)).toMatchObject({ name: 'CI' });
    expect(await readFile(join(source, '.github', 'workflows', 'ci.yml'), 'utf8')).toBe(
      'fixture: .github/workflows/ci.yml\n',
    );
    expect(await readdir(target)).not.toContain('.git');
    expect(log.mock.calls.flat().join('\n')).toContain('npm ci');
  });

  it('rejects a non-empty destination before fetching, and --force preserves unrelated files', async () => {
    const { source, target } = await fixture();

    await mkdir(target);
    await writeFile(join(target, 'keep.txt'), 'user file');
    await writeFile(join(target, 'README.md'), 'old readme');
    await writeFile(join(target, 'LICENSE'), 'old template license');
    await mkdir(join(target, '.github'));
    await writeFile(join(target, '.github', 'stale.yml'), 'old metadata');
    await mkdir(join(target, '.husky'));
    const { options } = parseArgs([target, '--no-install', '--no-git', '-y']);
    const fetchMock = vi.fn<typeof fetch>();

    vi.stubGlobal('fetch', fetchMock);
    await expect(scaffold(options, vi.fn(), undefined)).rejects.toThrow('not empty');
    expect(fetchMock).not.toHaveBeenCalled();
    await scaffold({ ...options, force: true }, vi.fn(), source);
    expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('user file');
    expect(await readFile(join(target, 'README.md'))).toEqual(
      await readFile(join(source, 'README.md')),
    );
    expect(await readdir(target)).not.toContain('LICENSE');
    expect(await readdir(join(target, '.github'))).toEqual(['workflows']);
    expect(await readdir(join(target, '.github', 'workflows'))).toEqual(['ci.yml']);
    expect(await readCiWorkflow(target)).toMatchObject({ name: 'CI' });
    expect(await readdir(target)).not.toContain('.husky');
  });

  it('does not create a destination for an invalid source', async () => {
    const { source, target } = await fixture();

    await writeFile(join(source, 'package.json'), 'invalid json');
    await expect(
      scaffold(parseArgs([target, '--no-git', '--no-install']).options, vi.fn(), source),
    ).rejects.toThrow('package.json');
    await expect(readdir(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['root', 'directory', 'file'])(
    'refuses an existing %s symlink even with --force',
    async (kind) => {
      const { parent, source, target } = await fixture();
      const outside = join(parent, 'outside');

      await mkdir(outside);
      await writeFile(join(outside, 'important.json'), 'unchanged');

      if (kind === 'root') {
        await symlink(outside, target);
      } else {
        await mkdir(target);
        await symlink(
          kind === 'directory' ? outside : join(outside, 'important.json'),
          join(target, kind === 'directory' ? 'src' : 'package.json'),
        );
      }

      await expect(
        scaffold(
          parseArgs([target, '--force', '--no-git', '--no-install']).options,
          vi.fn(),
          source,
        ),
      ).rejects.toThrow('symlink');
      expect(await readFile(join(outside, 'important.json'), 'utf8')).toBe('unchanged');
    },
  );

  it('replaces hard-linked destination files without changing their outside inode', async () => {
    const { parent, source, target } = await fixture();
    const outside = join(parent, 'important.json');

    await writeFile(outside, 'unchanged');
    await mkdir(target);
    await link(outside, join(target, 'package.json'));
    await scaffold(
      parseArgs([target, '--force', '--no-git', '--no-install']).options,
      vi.fn(),
      source,
    );
    expect(await readFile(outside, 'utf8')).toBe('unchanged');
  });

  it.each(packageManagers)(
    'runs the selected %s installer in the project directory',
    async (manager) => {
      const { parent, source, target } = await fixture();
      const bin = join(parent, 'bin');

      await mkdir(bin);
      await writeFile(join(bin, manager), '#!/bin/sh\nprintf "%s\\n" "$@" > install-command.txt\n');
      await chmod(join(bin, manager), 0o755);
      vi.stubEnv('PATH', `${bin}${delimiter}${process.env.PATH ?? ''}`);
      const log = vi.fn<(message: string) => void>();

      await scaffold(
        parseArgs([target, '--no-git', '--package-manager', manager, '-y']).options,
        log,
        source,
      );
      expect(await readFile(join(target, 'install-command.txt'), 'utf8')).toBe(
        `${manager === 'npm' ? 'ci' : 'install'}\n`,
      );
      expect(log.mock.calls.flat()).toContain(
        `Running: ${manager} ${manager === 'npm' ? 'ci' : 'install'}`,
      );
    },
  );
});

describe('git initialization', () => {
  it('requests main and the specified commit without requiring global identity or signing', async () => {
    const { parent, source, target } = await fixture();
    const globalConfig = join(parent, 'gitconfig');
    const spawnMock = vi.mocked(spawn).mockImplementation(() => {
      const child = new ChildProcess();

      queueMicrotask(() => child.emit('exit', 0));

      return child;
    });

    await writeFile(globalConfig, '[commit]\n\tgpgsign = true\n');
    vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig);
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    await scaffold(parseArgs([target, '--no-install', '-y']).options, vi.fn(), source);
    expect(spawnMock.mock.calls.map(([command, args]) => [command, args])).toEqual([
      ['git', ['init', '--initial-branch=main']],
      ['git', ['add', '--all']],
      [
        'git',
        [
          '-c',
          'commit.gpgsign=false',
          '-c',
          `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
          '-c',
          'user.name=create-ssr-app',
          '-c',
          'user.email=create-ssr-app@localhost',
          'commit',
          '-m',
          'Initial commit from @lomray/create-ssr-app',
        ],
      ],
    ]);
    expect(spawnMock.mock.calls.every(([, , options]) => options?.cwd === target)).toBe(true);
    expect(await readdir(target)).toContain('.husky');
    expect(await readCiWorkflow(target)).toMatchObject({ name: 'CI' });
  });

  it('skips initialization inside an existing repository and removes prepare', async () => {
    const { parent, source, target } = await fixture();

    expect(spawnSync('git', ['init', '--initial-branch=main', parent]).status).toBe(0);
    await scaffold(parseArgs([target, '--no-install', '-y']).options, vi.fn(), source);
    expect(await readdir(target)).not.toContain('.git');
    expect(await readdir(target)).not.toContain('.husky');
    const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(manifest.scripts.prepare).toBeUndefined();
    expect(spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: parent }).status).not.toBe(0);
  });

  it('skips initialization when git is unavailable', async () => {
    const { parent } = await fixture();
    const log = vi.fn<(message: string) => void>();

    vi.stubEnv('PATH', parent);
    expect(await shouldInitializeGit(parent, true, log)).toBe(false);
    expect(log.mock.calls.flat().join('\n')).toContain('Git is unavailable');
  });
});

describe('output and exit codes', () => {
  it('honors NO_COLOR, including an empty value, and non-TTY output', () => {
    expect(colorize('text', 32, true, {})).toBe('\u001B[32mtext\u001B[0m');
    expect(colorize('text', 32, true, { NO_COLOR: '' })).toBe('text');
    expect(colorize('text', 32, true, { NO_COLOR: '1' })).toBe('text');
    expect(colorize('text', 32, false, {})).toBe('text');
  });

  it.each(['--help', '--version'])('exits successfully for %s', async (flag) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(await run([flag])).toBe(0);
    expect(log).toHaveBeenCalled();
  });

  it('reports user errors as one clear line with exit code 1', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await run(['--template', 'unknown'])).toBe(1);
    expect(error).toHaveBeenCalledExactlyOnceWith(
      'Error: Unknown template "unknown"; choose full, minimal, custom-server, tanstack-query, cloudflare, localization.',
    );
  });

  it('reports unexpected errors with exit code 2', async () => {
    vi.spyOn(console, 'log').mockImplementationOnce(() => {
      throw new Error('output unavailable');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await run(['-y'])).toBe(2);
    expect(error).toHaveBeenCalledExactlyOnceWith('Error: output unavailable.');
  });

  it.each(['18.19.0', '22.11.0'])(
    'rejects unsupported Node %s before loading the compiled CLI',
    (version) => {
      const url = pathToFileURL(resolve('bin/create-ssr-app.mjs')).href;
      const script = `Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(version)} }); await import(${JSON.stringify(url)});`;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stderr.trim()).toBe(
        `Error: Unsupported Node.js ${version}; @lomray/create-ssr-app requires Node.js >=22.12.0.`,
      );
    },
  );
});
