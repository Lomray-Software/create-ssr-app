import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { postProcess } from '../src/project.js';
import { readCiWorkflow, temporaryDirectory, writeFixture } from './helpers.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('generated CI workflow', () => {
  it.each([
    { optional: [] },
    { optional: ['style:check'] },
    { optional: ['size:check'] },
    { optional: ['smoke'] },
    { optional: ['style:check', 'size:check'] },
    { optional: ['style:check', 'smoke'] },
    { optional: ['size:check', 'smoke'] },
    { optional: ['style:check', 'size:check', 'smoke'] },
  ])('includes only available checks with optional scripts $optional', async ({ optional }) => {
    const directory = await temporaryDirectory();
    const scripts = {
      'lint:check': 'eslint .',
      'ts:check': 'tsc --noEmit',
      build: 'vite build',
      deploy: 'publish-app',
      ...Object.fromEntries(optional.map((script) => [script, 'check-app'])),
    };

    temporary.push(directory);
    await writeFixture(directory, { scripts });
    await postProcess(directory, 'app', false);
    const workflow = await readCiWorkflow(directory);
    const expected = ['npm ci --ignore-scripts', 'npm run lint:check', 'npm run ts:check'];

    if (optional.includes('style:check')) {
      expected.push('npm run style:check');
    }

    expected.push('npm run build -- --throw-warnings');

    for (const script of ['size:check', 'smoke']) {
      if (optional.includes(script)) {
        expected.push(`npm run ${script}`);
      }
    }

    expect(workflow.on).toEqual(['push', 'pull_request']);
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(Object.keys(workflow.jobs)).toEqual(['check']);
    expect(workflow.jobs.check['runs-on']).toBe('ubuntu-latest');
    expect(workflow.jobs.check.steps.filter((step) => step.run).map((step) => step.run)).toEqual(
      expected,
    );
    expect(await readFile(join(directory, '.github', 'workflows', 'ci.yml'), 'utf8')).not.toContain(
      'secrets',
    );
  });

  it.each([
    { nodeVersion: undefined, git: false },
    { nodeVersion: undefined, git: true },
    { nodeVersion: '24.0.0', git: false },
    { nodeVersion: '24.0.0', git: true },
  ])('selects Node from $nodeVersion with git=$git', async ({ nodeVersion, git }) => {
    const directory = await temporaryDirectory();

    temporary.push(directory);
    await writeFixture(directory, { nodeVersion });
    await postProcess(directory, 'app', git);
    const workflow = await readCiWorkflow(directory);

    expect(workflow.jobs.check.steps.slice(0, 2)).toEqual([
      { uses: 'actions/checkout@v4' },
      {
        uses: 'actions/setup-node@v4',
        with: {
          ...(nodeVersion ? { 'node-version-file': '.nvmrc' } : { 'node-version': '22' }),
          cache: 'npm',
        },
      },
    ]);
  });

  it('does not reference missing core scripts in an offline template', async () => {
    const directory = await temporaryDirectory();

    temporary.push(directory);
    await writeFixture(directory, { scripts: { develop: 'vite' } });
    await postProcess(directory, 'app', false);
    const workflow = await readCiWorkflow(directory);

    expect(workflow.jobs.check.steps.filter((step) => step.run)).toEqual([
      { run: 'npm ci --ignore-scripts' },
    ]);
  });
});
