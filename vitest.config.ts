import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['convex/**/*.test.ts', 'server/**/*.test.ts'],
    environmentMatchGlobs: [
      ['convex/**', 'edge-runtime'],
      ['server/**', 'node'],
    ],
  },
})
