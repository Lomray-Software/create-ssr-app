import { describe, expect, it } from 'vitest';
import { nextSteps } from '../src/index.js';
import { parseArgs } from '../src/options.js';
import {
  detectPackageManager,
  displayCommand,
  installCommand,
  packageManagers,
} from '../src/package-manager.js';

describe('package managers', () => {
  it.each(packageManagers)('detects %s from the leading user agent token', (manager) => {
    expect(detectPackageManager(`${manager}/1.2.3 npm/? node/v22.23.2`)).toBe(manager);
  });

  it.each([undefined, '', 'unknown/1.0.0', 'corepack/1.0.0', 'npm-fake/1.0.0'])(
    'falls back to npm for %s',
    (agent) => {
      expect(detectPackageManager(agent)).toBe('npm');
    },
  );

  it.each(packageManagers)('selects %s install and development commands', (manager) => {
    expect(installCommand(manager, false)).toEqual([manager, 'install']);
    expect(installCommand(manager, true)).toEqual([manager, manager === 'npm' ? 'ci' : 'install']);
    const { options } = parseArgs(['my app', '--no-install', '--package-manager', manager]);
    const output = nextSteps(options, true);

    expect(output).toContain(displayCommand(['cd', 'my app']));
    expect(output).toContain(`${manager} ${manager === 'npm' ? 'ci' : 'install'}`);
    expect(output).toContain(`${manager} run develop`);
    expect(output).toContain('https://lomray-software.github.io/vite-ssr-boost/');
    expect(nextSteps({ ...options, install: true }, true)).not.toContain(
      `${manager} ${manager === 'npm' ? 'ci' : 'install'}`,
    );
  });

  it('quotes shell metacharacters in displayed paths', () => {
    if (process.platform !== 'win32') {
      expect(displayCommand(['cd', "app's $name"])).toBe("cd 'app'\\''s $name'");
    }
  });

  it('prints a usable cd command for a directory starting with a dash', () => {
    expect(nextSteps(parseArgs(['--', '-app']).options, false)).toContain('cd ./-app');
  });
});
