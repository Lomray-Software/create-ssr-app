import { parseArgs as parseNodeArgs } from 'node:util';
import { UserError, errorCause } from './errors.js';
import { detectPackageManager, isPackageManager } from './package-manager.js';
import type { PackageManager } from './package-manager.js';
import { isTemplate, templates } from './templates.js';
import type { Template } from './templates.js';

export interface IOptions {
  directory: string;
  template: Template;
  ref?: string;
  packageManager: PackageManager;
  install: boolean;
  git: boolean;
  force: boolean;
  yes: boolean;
  help: boolean;
  version: boolean;
}

export interface IParsedArgs {
  options: IOptions;
  provided: Set<string>;
}

export const parseArgs = (args: string[], userAgent?: string): IParsedArgs => {
  let parsed;

  try {
    parsed = parseNodeArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        template: { type: 'string', short: 't' },
        ref: { type: 'string' },
        'package-manager': { type: 'string' },
        'no-install': { type: 'boolean' },
        'no-git': { type: 'boolean' },
        force: { type: 'boolean' },
        yes: { type: 'boolean', short: 'y' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    throw new UserError(errorCause(error));
  }

  const { values, positionals } = parsed;
  const template = values.template ?? 'minimal';
  const packageManager = values['package-manager'] ?? detectPackageManager(userAgent);

  if (positionals.length > 1) {
    throw new UserError('Expected at most one project directory');
  }

  if (positionals[0] !== undefined && !positionals[0].trim()) {
    throw new UserError('The project directory cannot be empty');
  }

  if (!isTemplate(template)) {
    throw new UserError(
      `Unknown template "${template}"; choose ${Object.keys(templates).join(', ')}`,
    );
  }

  if (!isPackageManager(packageManager)) {
    throw new UserError(
      `Unknown package manager "${packageManager}"; choose npm, pnpm, yarn or bun`,
    );
  }

  if (values.ref !== undefined && (!values.ref.trim() || /[\x00-\x20\x7f]/u.test(values.ref))) {
    throw new UserError(
      'The template ref must be a non-empty git branch, tag or SHA without spaces',
    );
  }

  const provided = new Set(Object.keys(values));

  if (positionals[0] !== undefined) {
    provided.add('directory');
  }

  return {
    options: {
      directory: positionals[0] ?? 'my-ssr-app',
      template,
      ref: values.ref,
      packageManager,
      install: !values['no-install'],
      git: !values['no-git'],
      force: values.force ?? false,
      yes: values.yes ?? false,
      help: values.help ?? false,
      version: values.version ?? false,
    },
    provided,
  };
};

export type Ask = (question: string) => Promise<string>;

const confirm = async (ask: Ask, question: string): Promise<boolean> => {
  const answer = (await ask(`${question} (Y/n) `)).trim().toLowerCase();

  if (['', 'y', 'yes'].includes(answer)) {
    return true;
  }

  if (['n', 'no'].includes(answer)) {
    return false;
  }

  throw new UserError('Please answer yes or no');
};

export const resolveOptions = async (
  { options: defaults, provided }: IParsedArgs,
  isTTY: boolean,
  ask: Ask,
): Promise<IOptions> => {
  const options = { ...defaults };

  if (!isTTY || options.yes || options.help || options.version) {
    return options;
  }

  if (!provided.has('directory')) {
    options.directory = (await ask('Project directory (my-ssr-app): ')).trim() || options.directory;
  }

  if (!provided.has('template') && !provided.has('ref')) {
    const names = Object.keys(templates) as Template[];
    const choices = names.map(
      (name, index) => `  ${index + 1}. ${name}: ${templates[name].description}`,
    );
    const answer = (await ask(`Templates:\n${choices.join('\n')}\nTemplate (2, minimal): `)).trim();
    const chosen = /^\d+$/u.test(answer) ? names[Number(answer) - 1] : answer || options.template;

    if (!chosen || !isTemplate(chosen)) {
      throw new UserError(`Unknown template "${answer}"; choose a template name or number 1–4`);
    }

    options.template = chosen;
  }

  if (!provided.has('no-install')) {
    options.install = await confirm(ask, 'Install dependencies?');
  }

  if (!provided.has('no-git')) {
    options.git = await confirm(ask, 'Initialize git?');
  }

  return options;
};
