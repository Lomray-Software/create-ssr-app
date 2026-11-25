import { describe, expect, it } from 'vitest';
import { evaluate } from './audit.mjs';

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
