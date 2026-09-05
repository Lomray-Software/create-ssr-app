export const templates = {
  full: {
    branch: 'prod',
    description: 'Streaming SSR, MobX, consistent Suspense, meta tags and route management',
  },
  minimal: {
    branch: 'example/minimal',
    description:
      'Six runtime dependencies, loaders, a lazy route with CSS, redirect, client-only route and 404, plus the SPA-to-SSR file diff',
  },
  'custom-server': {
    branch: 'example/custom-server',
    description:
      'Development through the managed CLI, production through an application-owned Fastify server with static assets, compression and Early Hints; dual export of the managed entry and a Fetch handler',
  },
  localization: {
    branch: 'example/localization',
    description:
      'i18next with the language chosen on the server from the cookie or Accept-Language, transferred to the client before hydration, and a cookie-based switcher',
  },
} as const;

export type Template = keyof typeof templates;

export const isTemplate = (value: string): value is Template => Object.hasOwn(templates, value);
