import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['tests/support/adaptive-activation-configuration.ts'],
    include: ['convex/**/*.test.ts', 'server/**/*.test.ts', 'shared/**/*.test.ts'],
    environmentMatchGlobs: [
      ['convex/**', 'edge-runtime'],
      ['server/**', 'node'],
      ['shared/**', 'node'],
    ],
  },
})
