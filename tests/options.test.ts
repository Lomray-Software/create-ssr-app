import { describe, expect, it, vi } from 'vitest';
import { parseArgs, resolveOptions } from '../src/options.js';
import { templates } from '../src/templates.js';

describe('argument parsing', () => {
  it('provides all defaults without a TTY', async () => {
    const ask = vi.fn();
    const parsed = parseArgs([]);

    expect(await resolveOptions(parsed, false, ask)).toEqual({
      directory: 'my-ssr-app',
      template: 'minimal',
      ref: undefined,
      packageManager: 'npm',
      install: true,
      git: true,
      force: false,
      yes: false,
      help: false,
      version: false,
    });
    expect(ask).not.toHaveBeenCalled();
  });

  it('parses every long flag and an explicit directory', () => {
    expect(
      parseArgs([
        'app',
        '--template',
        'full',
        '--ref',
        'v1.2.3',
        '--package-manager',
        'bun',
        '--no-install',
        '--no-git',
        '--force',
        '--yes',
        '--help',
        '--version',
      ]).options,
    ).toEqual({
      directory: 'app',
      template: 'full',
      ref: 'v1.2.3',
      packageManager: 'bun',
      install: false,
      git: false,
      force: true,
      yes: true,
      help: true,
      version: true,
    });
  });

  it('parses short aliases and equals syntax', () => {
    expect(parseArgs(['-t', 'localization', '-y', '-h', '-v']).options).toMatchObject({
      template: 'localization',
      yes: true,
      help: true,
      version: true,
    });
    expect(
      parseArgs(['--template=custom-server', '--ref=example/minimal', '--package-manager=pnpm'])
        .options,
    ).toMatchObject({ template: 'custom-server', ref: 'example/minimal', packageManager: 'pnpm' });
  });

  it('accepts a directory after -- and an explicit manager over detection', () => {
    expect(parseArgs(['--', '-app']).options.directory).toBe('-app');
    expect(parseArgs(['--package-manager', 'npm'], 'yarn/1.22.0').options.packageManager).toBe(
      'npm',
    );
    expect(parseArgs([], 'pnpm/10.0.0 npm/?').options.packageManager).toBe('pnpm');
  });

  it.each([
    ['--unknown'],
    ['--template'],
    ['-t', 'missing'],
    ['--template', 'toString'],
    ['--template='],
    ['--package-manager', 'deno'],
    ['--ref='],
    ['--ref', 'bad ref'],
    ['one', 'two'],
    [''],
    ['--no-install=false'],
  ])('rejects invalid arguments %j', (...args) => {
    expect(() => parseArgs(args)).toThrow();
  });
});

describe('interactive defaults', () => {
  it('asks for each missing value only on a TTY, with numbered descriptions', async () => {
    const ask = vi
      .fn()
      .mockResolvedValueOnce('chosen-app')
      .mockResolvedValueOnce('3')
      .mockResolvedValueOnce('n')
      .mockResolvedValueOnce('yes');

    expect(await resolveOptions(parseArgs([]), true, ask)).toMatchObject({
      directory: 'chosen-app',
      template: 'custom-server',
      install: false,
      git: true,
    });
    expect(ask).toHaveBeenCalledTimes(4);

    for (const [index, [name, { description }]] of Object.entries(templates).entries()) {
      expect(ask.mock.calls[1]?.[0]).toContain(`${index + 1}. ${name}: ${description}`);
    }
  });

  it('accepts blank answers as defaults', async () => {
    const ask = vi.fn().mockResolvedValue('');

    expect(await resolveOptions(parseArgs([]), true, ask)).toMatchObject({
      directory: 'my-ssr-app',
      template: 'minimal',
      install: true,
      git: true,
    });
  });

  it.each(['-y', '--yes', '--help', '--version'])('does not prompt with %s', async (flag) => {
    const ask = vi.fn();

    await resolveOptions(parseArgs([flag]), true, ask);
    expect(ask).not.toHaveBeenCalled();
  });

  it('does not prompt for values supplied by flags', async () => {
    const ask = vi.fn();

    await resolveOptions(parseArgs(['app', '-t', 'full', '--no-install', '--no-git']), true, ask);
    expect(ask).not.toHaveBeenCalled();
  });

  it('does not ask for a template when --ref overrides it', async () => {
    const ask = vi.fn();

    await resolveOptions(
      parseArgs(['app', '--ref', 'deadbeef', '--no-install', '--no-git']),
      true,
      ask,
    );
    expect(ask).not.toHaveBeenCalled();
  });

  it('accepts a template name and no answers', async () => {
    const ask = vi
      .fn()
      .mockResolvedValueOnce('localization')
      .mockResolvedValueOnce('no')
      .mockResolvedValueOnce('N');

    expect(await resolveOptions(parseArgs(['app']), true, ask)).toMatchObject({
      template: 'localization',
      install: false,
      git: false,
    });
  });

  it('rejects invalid template selections and confirmation answers', async () => {
    await expect(
      resolveOptions(parseArgs(['app']), true, vi.fn().mockResolvedValue('99')),
    ).rejects.toThrow('Unknown template');
    await expect(
      resolveOptions(parseArgs(['app', '-t', 'full']), true, vi.fn().mockResolvedValue('maybe')),
    ).rejects.toThrow('yes or no');
  });
});
