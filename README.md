<p align="center">
  <img src="https://raw.githubusercontent.com/Lomray-Software/vite-ssr-boost/prod/logo.png" width="160" alt="Lomray Vite SSR Boost" />
</p>

<h1 align="center">@lomray/create-ssr-app</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@lomray/create-ssr-app"><img src="https://img.shields.io/npm/v/@lomray/create-ssr-app" alt="npm version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Lomray-Software/create-ssr-app" alt="MIT license" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/node/v/@lomray/create-ssr-app" alt="Node.js version" /></a>
</p>

Create a React Router (Data mode) app with SSR and Vite SSR Boost from the official Lomray templates.
Start with minimal SSR, the full reference app, a Fastify production server, TanStack Query, or localization.

## Usage

Requires Node.js **22.12.0 or newer**.

```sh
npm create @lomray/ssr-app@latest my-app
pnpm create @lomray/ssr-app my-app
yarn create @lomray/ssr-app my-app
bun create @lomray/ssr-app my-app
```

You can also run `npx @lomray/create-ssr-app my-app` or the installed `create-ssr-app` binary.
For npm, put flags after `--` so npm forwards them to the scaffolder:

```sh
npm create @lomray/ssr-app@latest my-app -- --template custom-server --no-install --no-git -y
npx @lomray/create-ssr-app my-app --template localization
```

On a terminal, missing values prompt for the directory, a numbered template choice, dependency
installation, and git initialization. Empty answers accept defaults. With `--yes` or non-TTY stdin,
the CLI uses flags and defaults without prompting. Package manager selection follows
`npm_config_user_agent`, falling back to npm.

## Options

| Argument / option          | Default                   | Description                                                                                                             |
| -------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `[directory]`              | `my-ssr-app`              | Destination directory.                                                                                                  |
| `-t, --template <name>`    | `minimal`                 | `full`, `minimal`, `custom-server`, `tanstack-query`, or `localization`.                                                |
| `--ref <branch\|tag\|sha>` | Template branch           | Advanced: use any git ref in the template repository, overriding the template mapping and skipping the template prompt. |
| `--package-manager <name>` | Detected, otherwise `npm` | `npm`, `pnpm`, `yarn`, or `bun`.                                                                                        |
| `--no-install`             | Install                   | Skip installation and print the install command in Next steps.                                                          |
| `--no-git`                 | Initialize git            | Skip git initialization; remove `.husky/` and `scripts.prepare`.                                                        |
| `--force`                  | Off                       | Allow a non-empty destination, overwriting matching template files and retaining unrelated existing files.              |
| `-y, --yes`                | Off                       | Accept defaults without prompts.                                                                                        |
| `-h, --help`               | Off                       | Print help.                                                                                                             |
| `-v, --version`            | Off                       | Print the package version.                                                                                              |

Git initialization is also skipped if git is unavailable or the destination is already inside a
repository; in both cases, `.husky/` and `scripts.prepare` are removed from the copied template.
Existing destination symlinks that conflict with template paths are rejected even with `--force`.

## Templates

These descriptions match the [template repository](https://github.com/Lomray-Software/vite-template/tree/prod).
See the [Vite SSR Boost documentation](https://lomray-software.github.io/vite-ssr-boost/) for development,
SSR behavior, and deployment.

| Template         | Branch                                                                                                   | What it shows                                                                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `full`           | [`prod`](https://github.com/Lomray-Software/vite-template/tree/prod)                                     | Streaming SSR, MobX, consistent Suspense, meta tags and route management                                                                                                                             |
| `minimal`        | [`example/minimal`](https://github.com/Lomray-Software/vite-template/tree/example/minimal)               | Six runtime dependencies, loaders, a lazy route with CSS, redirect, client-only route and 404, plus the SPA-to-SSR file diff                                                                         |
| `custom-server`  | [`example/custom-server`](https://github.com/Lomray-Software/vite-template/tree/example/custom-server)   | Development through the managed CLI, production through an application-owned Fastify server with static assets, compression and Early Hints; dual export of the managed entry and a Fetch handler    |
| `tanstack-query` | [`example/tanstack-query`](https://github.com/Lomray-Software/vite-template/tree/example/tanstack-query) | TanStack Query kept from an existing SPA: per-request QueryClient, prefetchQuery and dehydrate in loaders, a pending detail query streamed through useSuspenseQuery, HydrationBoundary on the client |
| `localization`   | [`example/localization`](https://github.com/Lomray-Software/vite-template/tree/example/localization)     | i18next with the language chosen on the server from the cookie or Accept-Language, transferred to the client before hydration, and a cookie-based switcher                                           |

## How it works

1. Downloads `https://codeload.github.com/Lomray-Software/vite-template/tar.gz/refs/heads/<branch>`
   with Node's global `fetch`. For an explicit `--ref`, a branch endpoint returning 404 falls back to
   `https://codeload.github.com/Lomray-Software/vite-template/tar.gz/<ref>` for tags and commits.
2. Decompresses with `node:zlib` and reads the tar archive using this package's own reader.
   It supports ustar, pax, GNU long names, directories, regular files, and permission bits. It strips
   the enclosing archive directory, skips global pax metadata and links, and rejects paths that
   escape the destination. Source `.git` metadata is excluded. There are **zero runtime dependencies**.
3. Removes `.github/`, `renovate.json`, `CHANGELOG.md`, `LICENSE`, and `SECURITY.md` from the template.
   When git initialization is skipped, it also removes `.husky/` and `scripts.prepare`.
   It keeps `vercel.json`, `amplify.yml`, `Dockerfile`, and the other project files.
   It generates a fresh `.github/workflows/ci.yml` for pushes and pull requests, including with
   `--no-git`. CI uses the template's `.nvmrc` or Node 22, installs with `npm ci --ignore-scripts`,
   and runs the available `lint:check`, `ts:check`, `style:check`, `build -- --throw-warnings`,
   `size:check`, and `smoke` scripts in that order. It has no deployment jobs or secrets.
4. Sets `package.json`'s name to a valid npm name derived from the destination basename and its
   version to `0.1.0`. It deletes `description`, `repository`, `homepage`, `bugs`, `author`, and
   `keywords`, preserving `private` and other fields. The scaffolder does not edit lockfiles.
5. When enabled and available, runs `git init --initial-branch=main` and creates
   `Initial commit from @lomray/create-ssr-app` before installing dependencies. The initial commit
   bypasses hooks and signing; it uses the configured git identity, with `create-ssr-app` /
   `create-ssr-app@localhost` as a fallback if none is configured.
6. Runs `npm ci` when npm is selected and `package-lock.json` exists; otherwise runs the selected
   manager's `install` command. Prints each command, then Next steps with the selected manager's
   `run develop` command and the documentation link. A package manager may update its own lockfile.

Colors use ANSI codes only on TTY output and are disabled whenever `NO_COLOR` is defined.
Exit codes are `0` for success, `1` for input, source, or command failures, and `2` for unexpected errors.

## Offline and proxies

Use a local `.tar.gz` archive (with an enclosing directory, like GitHub's archives) or a directory
containing the template's `package.json`:

```sh
CREATE_SSR_APP_SOURCE=/path/to/template.tar.gz npx @lomray/create-ssr-app my-app --no-install -y
CREATE_SSR_APP_SOURCE=/path/to/vite-template npx @lomray/create-ssr-app my-app --no-install --no-git -y
```

This replaces the download regardless of `--template` or `--ref`. A directory is copied without
changing the source; symlinks and `.git` metadata are skipped. Use an already installed CLI or a local
checkout (`npm ci && npm run build`, then `node bin/create-ssr-app.mjs`) if npm itself is also offline.

The CLI does not implement proxy handling. `HTTPS_PROXY` alone is not automatically honored by
global `fetch`. On Node.js 22.23.2, a local proxy probe confirmed that `HTTPS_PROXY` alone was ignored
and `NODE_USE_ENV_PROXY=1` enabled proxy routing. Node added this opt-in for `fetch` in 22.21.0;
see the [Node.js release notes](https://github.com/nodejs/nodejs.org/blob/main/apps/site/pages/en/blog/release/v22.21.0.md).

```sh
NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://proxy.example.com:8080 npx @lomray/create-ssr-app my-app
```

On older supported Node versions, upgrade to a runtime that honors proxy environment variables
or download the archive separately and use `CREATE_SSR_APP_SOURCE`.

## Contributing

Use the Node version in `.nvmrc` for the development tools:

```sh
npm ci
npm run lint:check
npm run ts:check
npm test
npm run build
npm pack --dry-run
CREATE_SSR_APP_E2E=1 npm run test:e2e
```

The opt-in e2e suite downloads all four GitHub templates and installs and builds the minimal app.
Releases use semantic-release: `prod` publishes to npm's `latest` channel and `staging` publishes
`beta` prereleases. CI expects `NPM_TOKEN` and `GITHUB_TOKEN` for releases.

## License

[MIT](LICENSE) — Lomray Software.
