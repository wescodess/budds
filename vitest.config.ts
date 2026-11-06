import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['tests/support/adaptive-activation-configuration.ts'],
    include: ['convex/**/*.test.ts', 'server/**/*.test.ts', 'shared/**/*.test.ts', 'scripts/design-capture.test.ts', 'scripts/design-ratchet.test.mjs', 'scripts/learn-v2-scorer-harness.test.ts', 'scripts/learn-v2-scorer-corpus.test.ts'],
    environmentMatchGlobs: [
      ['convex/**', 'edge-runtime'],
      ['server/**', 'node'],
      ['shared/**', 'node'],
      ['scripts/design-ratchet.test.mjs', 'node'],
    ],
  },
})
