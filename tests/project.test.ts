import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packageName, postProcess, rewritePackage } from '../src/project.js';
import { readCiWorkflow, temporaryDirectory, writeFixture } from './helpers.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('project metadata', () => {
  it.each([
    ['My Cool App', 'my-cool-app'],
    ['__APP', 'app'],
    ['café', 'cafe'],
    ['☃', 'my-ssr-app'],
    ['node_modules', 'my-node_modules'],
    ['favicon.ico', 'my-favicon.ico'],
    ['App.Test_1', 'app.test_1'],
  ])('derives a valid npm package name from %s', (directory, expected) => {
    expect(packageName(directory)).toBe(expected);
  });

  it('limits package names to 214 characters', () => {
    expect(packageName('a'.repeat(230))).toHaveLength(214);
  });

  it('rewrites only the requested metadata and preserves private and scripts', () => {
    const manifest = {
      name: 'template',
      version: '9.9.9',
      description: 'text',
      repository: 'repo',
      homepage: 'home',
      bugs: 'bugs',
      author: 'author',
      keywords: ['keywords'],
      private: false,
      scripts: { prepare: 'husky', develop: 'vite' },
      dependencies: { react: '*' },
      custom: 1,
    };

    expect(rewritePackage(manifest, 'My App', false)).toEqual({
      name: 'my-app',
      version: '0.1.0',
      private: false,
      scripts: { develop: 'vite' },
      dependencies: { react: '*' },
      custom: 1,
    });
    expect(rewritePackage(manifest, 'app', true).scripts).toEqual(manifest.scripts);
    expect(manifest.scripts.prepare).toBe('husky');
    expect(rewritePackage({}, 'app', false)).not.toHaveProperty('private');
  });
});

describe('post-processing', () => {
  it.each([true, false])(
    'removes template ownership files, preserving deployment and lock files (git=%s)',
    async (git) => {
      const directory = await temporaryDirectory();

      temporary.push(directory);
      await writeFixture(directory);
      const lockfile = await readFile(join(directory, 'package-lock.json'));

      await postProcess(directory, 'My App', git);
      const files = await readdir(directory);

      for (const file of ['renovate.json', 'CHANGELOG.md', 'LICENSE', 'SECURITY.md']) {
        expect(files).not.toContain(file);
      }

      expect(await readdir(join(directory, '.github'))).toEqual(['workflows']);
      expect(await readdir(join(directory, '.github', 'workflows'))).toEqual(['ci.yml']);
      const workflow = await readCiWorkflow(directory);

      expect(workflow.jobs.check.steps).toContainEqual({
        run: 'npm run build -- --throw-warnings',
      });

      for (const file of ['vercel.json', 'amplify.yml', 'Dockerfile', 'README.md', 'src']) {
        expect(files).toContain(file);
      }

      expect(files.includes('.husky')).toBe(git);
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
        name: string;
        version: string;
        private: boolean;
        scripts: Record<string, string>;
      };

      expect(manifest).toMatchObject({ name: 'my-app', version: '0.1.0', private: true });
      expect(Object.hasOwn(manifest.scripts, 'prepare')).toBe(git);
      expect(await readFile(join(directory, 'package-lock.json'))).toEqual(lockfile);
      await expect(postProcess(directory, 'My App', git)).resolves.toBeUndefined();
      expect(await readCiWorkflow(directory)).toEqual(workflow);
    },
  );
});
