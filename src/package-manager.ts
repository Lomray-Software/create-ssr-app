export const packageManagers = ['npm', 'pnpm', 'yarn', 'bun'] as const;

export type PackageManager = (typeof packageManagers)[number];

export const isPackageManager = (value: string): value is PackageManager =>
  packageManagers.some((manager) => manager === value);

export const detectPackageManager = (userAgent = ''): PackageManager => {
  const manager = userAgent.split('/')[0] ?? '';

  return isPackageManager(manager) ? manager : 'npm';
};

export const installCommand = (manager: PackageManager, hasNpmLockfile: boolean): string[] => [
  manager,
  manager === 'npm' && hasNpmLockfile ? 'ci' : 'install',
];

export const developCommand = (manager: PackageManager): string[] => [manager, 'run', 'develop'];

export const quoteArgument = (value: string): string => {
  if (/^[\w@%+=:,./-]+$/u.test(value)) {
    return value;
  }

  if (process.platform === 'win32') {
    return `"${value.replaceAll('"', '\\"')}"`;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
};

export const displayCommand = (command: string[]): string => command.map(quoteArgument).join(' ');
