import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { auditArgs, evaluate, runAudit } from './audit-gate.mjs';

const counts = (overrides = {}) => ({
  info: 0,
  low: 0,
  moderate: 0,
  high: 0,
  critical: 0,
  total: 0,
  ...overrides,
});

const report = (vulnerabilities = {}, vulnerabilityCounts = counts(), extra = {}) => ({
  auditReportVersion: 2,
  vulnerabilities,
  metadata: { vulnerabilities: vulnerabilityCounts },
  ...extra,
});

const run = (status, body) => ({
  status,
  stdout: typeof body === 'string' ? body : JSON.stringify(body),
});

const bundledMinimatch = {
  minimatch: {
    name: 'minimatch',
    severity: 'moderate',
    via: [
      {
        source: 1,
        name: 'minimatch',
        url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249',
        severity: 'moderate',
        range: '>=7.0.0 <11.0.1',
      },
    ],
    nodes: ['node_modules/npm/node_modules/minimatch'],
  },
};

const rootMinimatch = {
  minimatch: {
    ...bundledMinimatch.minimatch,
    nodes: ['node_modules/minimatch'],
  },
};

describe('audit gate', () => {
  it('passes a clean run', () => {
    expect(evaluate(run(0, report())).errors).toEqual([]);
  });

  it('passes an advisory that sits only in the npm bundle', () => {
    const result = evaluate(run(1, report(bundledMinimatch, counts({ moderate: 1, total: 1 }))));

    expect(result.errors).toEqual([]);
    expect(result.notes.some((line) => line.startsWith('allowed: GHSA-g3hv-75wg-m249'))).toBe(true);
  });

  it('fails the same advisory outside the npm bundle', () => {
    const result = evaluate(run(1, report(rootMinimatch, counts({ moderate: 1, total: 1 }))));

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('node_modules/minimatch');
  });

  it('fails exit status 1 with an empty report', () => {
    expect(evaluate(run(1, report())).errors).toEqual([
      'npm audit exited with status 1 but reported no findings',
    ]);
  });

  it('fails an unexpected exit status', () => {
    expect(evaluate(run(2, report())).errors[0]).toContain('unexpected status 2');
  });

  it('fails severity counts that do not add up to the total', () => {
    const result = evaluate(run(1, report(bundledMinimatch, counts({ high: 1, total: 2 }))));

    expect(result.errors[0]).toContain('inconsistent');
  });

  it('fails a total that does not match the entries', () => {
    const result = evaluate(run(0, report({}, counts({ low: 1, total: 1 }))));

    expect(result.errors[0]).toContain('inconsistent');
  });

  it('fails missing or invalid severity counts', () => {
    const { critical: _, ...withoutCritical } = counts();

    expect(evaluate(run(0, report({}, withoutCritical))).errors[0]).toContain('severity counts');
    expect(evaluate(run(0, report({}, counts({ low: -1, total: -1 })))).errors[0]).toContain(
      'severity counts',
    );
  });

  it('fails an unknown report version', () => {
    expect(evaluate(run(0, report({}, counts(), { auditReportVersion: 1 }))).errors[0]).toContain(
      'version 1 is not supported',
    );
    expect(
      evaluate(run(0, report({}, counts(), { auditReportVersion: undefined }))).errors[0],
    ).toContain('not supported');
  });

  it('fails an unreadable or error report', () => {
    expect(evaluate(run(1, 'not json')).errors[0]).toContain('unreadable');
    expect(evaluate(run(1, { error: { summary: 'network down' } })).errors[0]).toContain(
      'network down',
    );
  });

  it('fails a transitive entry that leads nowhere', () => {
    const dangling = {
      ...bundledMinimatch,
      npm: { name: 'npm', severity: 'moderate', via: ['glob'], nodes: ['node_modules/npm'] },
    };
    const result = evaluate(run(1, report(dangling, counts({ moderate: 2, total: 2 }))));

    expect(result.errors).toEqual(['npm: points to glob, which does not lead to an advisory']);
  });
});

describe('audit gate report checks', () => {
  it('fails a report that carries an error field, even an empty one', () => {
    expect(evaluate(run(0, report({}, counts(), { error: null }))).errors[0]).toContain(
      'npm audit failed',
    );
  });

  it('accepts a dependent cycle that reaches an allowed advisory', () => {
    const cycle = {
      ...bundledMinimatch,
      'semantic-release': {
        name: 'semantic-release',
        severity: 'moderate',
        via: ['@semantic-release/github'],
        nodes: ['node_modules/semantic-release'],
      },
      '@semantic-release/github': {
        name: '@semantic-release/github',
        severity: 'moderate',
        via: ['semantic-release', 'minimatch'],
        nodes: ['node_modules/@semantic-release/github'],
      },
    };
    const result = evaluate(run(1, report(cycle, counts({ moderate: 3, total: 3 }))));

    expect(result.errors).toEqual([]);
  });

  it('fails a dependent that reaches an advisory outside the allowlist', () => {
    const other = {
      ...rootMinimatch,
      'some-tool': {
        name: 'some-tool',
        severity: 'moderate',
        via: ['minimatch'],
        nodes: ['node_modules/some-tool'],
      },
    };
    const result = evaluate(run(1, report(other, counts({ moderate: 2, total: 2 }))));

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('GHSA-g3hv-75wg-m249 (node_modules/minimatch)');
  });
});

describe('audit gate scope', () => {
  const dirs = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  /**
   * A project with one package of every dependency type and an .npmrc that asks npm to omit
   * all of them. The audit must still submit every package for review.
   */
  const scopeFixture = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'audit-scope-'));
    const root = {
      name: 'audit-scope',
      version: '1.0.0',
      dependencies: { 'scope-prod': '1.0.0' },
      devDependencies: { 'scope-dev': '1.0.0' },
      optionalDependencies: { 'scope-optional': '1.0.0' },
      peerDependencies: { 'scope-peer': '1.0.0' },
    };
    const lockEntry = (name, flags) => ({
      version: '1.0.0',
      resolved: `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`,
      ...flags,
    });
    const lock = {
      name: root.name,
      version: root.version,
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': root,
        'node_modules/scope-prod': lockEntry('scope-prod', {}),
        'node_modules/scope-dev': lockEntry('scope-dev', { dev: true }),
        'node_modules/scope-optional': lockEntry('scope-optional', { optional: true }),
        'node_modules/scope-peer': lockEntry('scope-peer', { peer: true }),
      },
    };

    dirs.push(dir);
    await writeFile(join(dir, 'package.json'), JSON.stringify(root));
    await writeFile(join(dir, 'package-lock.json'), JSON.stringify(lock));
    await writeFile(
      join(dir, '.npmrc'),
      'omit[]=dev\nomit[]=optional\nomit[]=peer\nregistry=http://127.0.0.1:9/\n',
    );

    return dir;
  };

  /**
   * A local advisory endpoint in its own process (runAudit blocks this one while npm runs).
   * It records which packages npm asked about and reports no advisories.
   */
  const advisoryServer = async (dir) => {
    const log = join(dir, 'asked.json');
    const script = join(dir, 'advisory-server.mjs');

    await writeFile(
      script,
      [
        "import { appendFileSync } from 'node:fs';",
        "import { createServer } from 'node:http';",
        "import { gunzipSync } from 'node:zlib';",
        'const server = createServer((request, response) => {',
        '  const chunks = [];',
        "  request.on('data', (chunk) => chunks.push(chunk));",
        "  request.on('end', () => {",
        '    const body = Buffer.concat(chunks);',
        "    const gzip = request.headers['content-encoding'] === 'gzip';",
        "    if (request.url.includes('/security/advisories/bulk')) {",
        '      const names = Object.keys(JSON.parse(gzip ? gunzipSync(body) : body.toString()));',
        `      appendFileSync(${JSON.stringify(log)}, JSON.stringify(names) + '\\n');`,
        '    }',
        "    response.setHeader('content-type', 'application/json');",
        "    response.end('{}');",
        '  });',
        '});',
        "server.listen(0, '127.0.0.1', () => console.log(server.address().port));",
      ].join('\n'),
    );

    const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'inherit'] });
    const port = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.stdout.once('data', (data) => resolve(String(data).trim()));
    });
    const asked = async () =>
      (await readFile(log, 'utf8'))
        .trim()
        .split('\n')
        .flatMap((line) => JSON.parse(line));

    return { asked, stop: () => child.kill(), url: `http://127.0.0.1:${port}/` };
  };

  it('asks for every dependency type from the pinned registry', () => {
    const args = auditArgs();

    ['prod', 'dev', 'optional', 'peer'].forEach((type) => {
      expect(args).toContain(`--include=${type}`);
    });
    expect(args).toContain('--registry=https://registry.npmjs.org/');
  });

  it('audits every dependency type when .npmrc and the environment omit them', async () => {
    const dir = await scopeFixture();
    const { asked, stop, url } = await advisoryServer(dir);

    try {
      const result = runAudit({
        cwd: dir,
        env: {
          ...process.env,
          npm_config_omit: 'dev',
          npm_config_only: 'prod',
          npm_config_production: 'true',
          npm_config_registry: 'http://127.0.0.1:9/',
        },
        registry: url,
      });

      expect(result.error).toBeUndefined();
      expect((await asked()).sort()).toEqual([
        'scope-dev',
        'scope-optional',
        'scope-peer',
        'scope-prod',
      ]);
      expect(evaluate(result).errors).toEqual([]);
    } finally {
      stop();
    }
  });

  it('fails the command when npm exits 1 with an empty report', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'audit-cli-'));
    const fakeNpm = join(dir, 'npm-cli.js');

    dirs.push(dir);
    await writeFile(
      fakeNpm,
      [
        'const empty = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };',
        'process.stdout.write(JSON.stringify({ auditReportVersion: 2, vulnerabilities: {},',
        '  metadata: { vulnerabilities: empty } }));',
        'process.exitCode = 1;',
      ].join('\n'),
    );

    const cli = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('audit.mjs', import.meta.url))],
      { encoding: 'utf8', env: { ...process.env, npm_execpath: fakeNpm } },
    );

    expect(cli.status).toBe(1);
    expect(cli.stderr).toContain('npm audit exited with status 1 but reported no findings');
  });

  it('refuses to run without the npm that started it', () => {
    expect(runAudit({ env: {} }).error).toContain('npm_execpath is not set');
  });
});
