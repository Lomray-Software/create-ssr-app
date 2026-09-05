import { spawn, spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { UserError } from './errors.js';
import { statIfExists } from './files.js';
import { displayCommand } from './package-manager.js';

export type Log = (message: string) => void;

export const runCommand = async (command: string[], cwd: string, log: Log): Promise<void> => {
  const [executable, ...args] = command;

  if (!executable) {
    throw new Error('Cannot run an empty command');
  }

  log(`Running: ${displayCommand(command)}`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('error', (error) => {
      reject(new UserError(`Unable to run ${executable}: ${error.message}`));
    });
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new UserError(
            `${displayCommand(command)} failed (${signal ? `signal ${signal}` : `exit code ${code}`})`,
          ),
        );
      }
    });
  });
};

export const shouldInitializeGit = async (
  directory: string,
  enabled: boolean,
  log: Log,
): Promise<boolean> => {
  if (!enabled) {
    return false;
  }

  if (spawnSync('git', ['--version'], { stdio: 'ignore' }).status !== 0) {
    log('Git is unavailable; skipping git initialization.');

    return false;
  }

  let ancestor = directory;

  while (!(await statIfExists(ancestor))) {
    ancestor = dirname(ancestor);
  }

  if (
    spawnSync('git', ['rev-parse', '--git-dir'], { cwd: ancestor, stdio: 'ignore' }).status === 0
  ) {
    log('The destination is already inside a repository; skipping git initialization.');

    return false;
  }

  return true;
};

export const initializeGit = async (directory: string, log: Log): Promise<void> => {
  await runCommand(['git', 'init', '--initial-branch=main'], directory, log);
  await runCommand(['git', 'add', '--all'], directory, log);

  const config = [
    '-c',
    'commit.gpgsign=false',
    '-c',
    `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
  ];

  for (const [key, fallback] of [
    ['user.name', 'create-ssr-app'],
    ['user.email', 'create-ssr-app@localhost'],
  ] as const) {
    const value = spawnSync('git', ['config', '--get', key], { cwd: directory, encoding: 'utf8' });

    if (!value.stdout?.trim()) {
      config.push('-c', `${key}=${fallback}`);
    }
  }

  await runCommand(
    ['git', ...config, 'commit', '-m', 'Initial commit from @lomray/create-ssr-app'],
    directory,
    log,
  );
};
