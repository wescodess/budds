import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { timeoutIsolationPlugin } from '../../support/timeout-isolation-plugin'

export default defineConfig(({ mode }) => ({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: mode === 'native' ? [] : [timeoutIsolationPlugin()],
  test: {
    setupFiles: mode === 'native' ? [] : [fileURLToPath(new URL('../../support/timeout-isolation.ts', import.meta.url))],
    include: ['convex/*.test.ts'],
    environment: 'node',
  },
}))
