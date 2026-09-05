import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    // Nuxt's first environment bootstrap can exceed Vitest's 10s default in
    // this application even though individual component tests are fast.
    hookTimeout: 120_000,
    setupFiles: ['tests/component/setup.ts'],
    include: ['tests/component/**/*.test.ts'],
    // Audio Overview has a dedicated browser-like harness with the exact
    // Convex and Nuxt boundaries it needs. Running those files again in this
    // Nuxt environment bypasses their setup and produces false injection
    // failures.
    exclude: ['tests/component/audio-overview/**/*.test.ts'],
    environment: 'nuxt',
    environmentOptions: {
      nuxt: {
        domEnvironment: 'happy-dom',
        url: 'http://localhost:3000/login',
        dotenv: {
          fileName: '.env',
        },
        overrides: {
          // Component tests mock Convex and auth at their public composable
          // boundaries. Do not create real network clients during Nuxt's
          // global beforeAll hook.
          convex: { url: '' },
          auth: { clientOnly: true },
          runtimeConfig: {
            public: {
              siteUrl: 'http://127.0.0.1:9',
              convex: { url: '' },
            },
          },
          routeRules: {
            '/': { auth: false },
            '/login': { auth: false },
          },
        },
      },
    },
  },
})
