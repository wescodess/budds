import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { timeoutIsolationPlugin } from './tests/support/timeout-isolation-plugin'

export default defineConfig({
  plugins: [timeoutIsolationPlugin()],
  resolve: {
    alias: {
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    setupFiles: ['tests/support/timeout-isolation.ts', 'tests/support/adaptive-activation-configuration.ts'],
    sequence: { setupFiles: 'list' },
    include: ['convex/**/*.test.ts', 'server/**/*.test.ts', 'shared/**/*.test.ts', 'scripts/design-capture.test.ts', 'scripts/design-ratchet.test.mjs', 'scripts/learn-v2-scorer-harness.test.ts', 'scripts/learn-v2-scorer-corpus.test.ts', 'scripts/learn-v2-measurement-report.test.ts'],
    environmentMatchGlobs: [
      ['convex/**', 'edge-runtime'],
      ['server/**', 'node'],
      ['shared/**', 'node'],
      ['scripts/design-ratchet.test.mjs', 'node'],
    ],
  },
})
