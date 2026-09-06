import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { initializeGit, runCommand, shouldInitializeGit } from './commands.js';
import type { Log } from './commands.js';
import { UserError, errorSentence } from './errors.js';
import { checkDestination, copyDirectory, statIfExists } from './files.js';
import { parseArgs, resolveOptions } from './options.js';
import type { IOptions } from './options.js';
import {
  developCommand,
  displayCommand,
  installCommand,
  quoteArgument,
} from './package-manager.js';
import { postProcess, removeTemplateMetadata } from './project.js';
import { loadSource } from './source.js';
import { templates } from './templates.js';

const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string;
  version: string;
};

export const docsUrl = 'https://lomray-software.github.io/vite-ssr-boost/';

export const colorize = (
  text: string,
  code: number,
  isTTY = Boolean(process.stdout.isTTY),
  environment: NodeJS.ProcessEnv = process.env,
): string =>
  isTTY && environment.NO_COLOR === undefined ? `\u001B[${code}m${text}\u001B[0m` : text;

export const help = `${metadata.name} v${metadata.version}

Usage:
  npm create @lomray/ssr-app@latest [directory] [-- options]
  npx @lomray/create-ssr-app [directory] [options]

Options:
  -t, --template <name>       full | minimal | custom-server | localization (default: minimal)
      --ref <branch|tag|sha>  Override the template branch with any template repository git ref
      --package-manager <pm> npm | pnpm | yarn | bun (detected from npm_config_user_agent; otherwise npm)
      --no-install           Skip installing dependencies
      --no-git               Skip git initialization and remove Husky/prepare
      --force                Allow a non-empty directory; overwrite matching template files
  -y, --yes                  Accept defaults without prompts
  -h, --help                 Show this help
  -v, --version              Show the version

The default directory is my-ssr-app. Prompts run only when stdin is a TTY and --yes is absent.
CREATE_SSR_APP_SOURCE=<directory|archive.tar.gz> uses a local template instead of GitHub.
Requires Node.js >=22.12.0.
Documentation: ${docsUrl}`;

export const nextSteps = (options: IOptions, hasNpmLockfile: boolean): string => {
  const directory = options.directory.startsWith('-')
    ? `./${options.directory}`
    : options.directory;
  const commands = [`cd ${quoteArgument(directory)}`];

  if (!options.install) {
    commands.push(displayCommand(installCommand(options.packageManager, hasNpmLockfile)));
  }

  commands.push(displayCommand(developCommand(options.packageManager)));

  return `\nNext steps:\n${commands.map((command) => `  ${command}`).join('\n')}\n\nDocumentation: ${docsUrl}`;
};

export const scaffold = async (
  options: IOptions,
  log: Log = console.log,
  source = process.env.CREATE_SSR_APP_SOURCE,
): Promise<void> => {
  const directory = resolve(options.directory);

  await checkDestination(directory, options.force);
  log(
    `Template: ${options.template} (${options.ref ?? templates[options.template].branch}${options.ref ? ', --ref override' : ''})`,
  );
  log(`Directory: ${options.directory}`);
  const shouldUseGit = await shouldInitializeGit(directory, options.git, log);
  const temporary = await mkdtemp(join(tmpdir(), 'create-ssr-app-'));

  try {
    const staging = join(temporary, 'template');

    await loadSource(
      staging,
      options.ref ?? templates[options.template].branch,
      Boolean(options.ref),
      source,
    );
    await postProcess(staging, directory, shouldUseGit);
    // Recheck after the download in case another process populated the destination.
    await checkDestination(directory, options.force);
    await copyDirectory(staging, directory);
    await removeTemplateMetadata(directory, shouldUseGit);
    // Restore only the generated workflow after clearing any old destination metadata.
    await copyDirectory(join(staging, '.github'), join(directory, '.github'));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }

  if (shouldUseGit) {
    await initializeGit(directory, log);
  }

  const hasNpmLockfile = Boolean(await statIfExists(join(directory, 'package-lock.json')));

  if (options.install) {
    await runCommand(installCommand(options.packageManager, hasNpmLockfile), directory, log);
  }

  log(colorize('\nProject created.', 32));
  log(nextSteps(options, hasNpmLockfile));
};

export const run = async (args = process.argv.slice(2)): Promise<number> => {
  try {
    const parsed = parseArgs(args, process.env.npm_config_user_agent);

    if (parsed.options.help) {
      console.log(help);

      return 0;
    }

    if (parsed.options.version) {
      console.log(metadata.version);

      return 0;
    }

    console.log(colorize(`${metadata.name} v${metadata.version}\n`, 36));
    let { options } = parsed;

    if (process.stdin.isTTY && !options.yes) {
      const reader = createInterface({ input: process.stdin, output: process.stdout });
      const controller = new AbortController();
      const cancel = (): void => controller.abort();

      reader.on('SIGINT', cancel);
      reader.on('close', cancel);

      try {
        options = await resolveOptions(parsed, true, (question) =>
          reader.question(question, { signal: controller.signal }),
        );
      } catch (error) {
        if (controller.signal.aborted) {
          throw new UserError('Project creation was cancelled');
        }

        throw error;
      } finally {
        reader.close();
      }
    }

    await scaffold(options);

    return 0;
  } catch (error) {
    console.error(errorSentence(error));

    return error instanceof UserError ? 1 : 2;
  }
};
