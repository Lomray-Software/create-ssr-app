import { spawn } from 'node:child_process';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { templates } from '../src/templates.js';
import { temporaryDirectory } from './helpers.js';

const run = async (command: string, args: string[], cwd: string): Promise<void> => {
  await new Promise<void>((resolveRun, reject) => {
    const environment = { ...process.env };

    delete environment.NO_COLOR;
    delete environment.CREATE_SSR_APP_SOURCE;
    // Vitest sets NODE_ENV=test; generated apps must exercise their normal production build.
    delete environment.NODE_ENV;
    const child = spawn(command, args, {
      cwd,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 240_000,
    });
    let output = '';

    for (const stream of [child.stdout, child.stderr]) {
      stream?.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
    }

    child.on('error', reject);
    child.on('exit', (code) => {
      process.stdout.write(`${output.trim()}\n`);

      if (code === 0) {
        resolveRun();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with ${code}\n${output}`));
      }
    });
  });
};

describe.skipIf(process.env.CREATE_SSR_APP_E2E !== '1')('GitHub templates', () => {
  let parent: string;
  const cli = resolve('bin/create-ssr-app.mjs');

  beforeAll(async () => {
    parent = await temporaryDirectory();
  });

  afterAll(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  it.each(Object.keys(templates))(
    'scaffolds %s from GitHub',
    async (template) => {
      const target = join(parent, template);

      await run(
        process.execPath,
        [cli, target, '--template', template, '--no-install', '--no-git', '-y'],
        parent,
      );
      const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8')) as {
        name: string;
        version: string;
        scripts: Record<string, string>;
        dependencies: Record<string, string>;
      };
      const files = await readdir(target);

      expect(manifest.name).toBe(template);
      expect(manifest.version).toBe('0.1.0');
      expect(manifest.scripts.prepare).toBeUndefined();

      for (const file of [
        '.github',
        '.husky',
        '.git',
        'renovate.json',
        'CHANGELOG.md',
        'LICENSE',
        'SECURITY.md',
      ]) {
        expect(files).not.toContain(file);
      }

      expect(manifest.scripts.develop).toBeTruthy();

      if (template === 'minimal') {
        expect(Object.keys(manifest.dependencies)).toHaveLength(6);
        await run('npm', ['ci', '--ignore-scripts'], target);
        await run('npm', ['run', 'build'], target);
        expect((await stat(join(target, 'build'))).isDirectory()).toBe(true);
      }

      if (template === 'custom-server') {
        expect(manifest.dependencies).toHaveProperty('fastify');
      }

      if (template === 'localization') {
        expect(manifest.dependencies).toHaveProperty('i18next');
      }

      if (template === 'full') {
        expect(manifest.dependencies).toHaveProperty('mobx');
      }
    },
    300_000,
  );
});
