import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    {
      name: 'audio-component-nuxt-runtime-flags',
      enforce: 'pre',
      transform(code, id) {
        if (!id.startsWith(fileURLToPath(new URL('.', import.meta.url)))) return
        return code
          .replaceAll('import.meta.client', 'true')
          .replaceAll('import.meta.server', 'false')
      },
    },
    vue(),
  ],
  resolve: {
    alias: {
      '~~': fileURLToPath(new URL('.', import.meta.url)),
      '@@': fileURLToPath(new URL('.', import.meta.url)),
      '~': fileURLToPath(new URL('./app', import.meta.url)),
      '@': fileURLToPath(new URL('./app', import.meta.url)),
      '#convex/api': fileURLToPath(new URL('./convex/_generated/api.js', import.meta.url)),
    },
  },
  define: {
    'import.meta.client': true,
    'import.meta.server': false,
  },
  test: {
    name: 'audio-components',
    environment: 'happy-dom',
    setupFiles: ['tests/component/audio-overview/setup.ts'],
    include: ['tests/component/audio-overview/**/*.test.ts'],
    // The suite mutates browser globals at explicit composable seams. Running
    // files serially prevents one mounted app from tearing down another's
    // mocked Nuxt globals and avoids CPU-heavy parallel SFC transforms.
    fileParallelism: false,
    maxWorkers: 1,
    // Cold SFC transforms can consume most of the default 10s budget when the
    // repository, Worker, and component gates run concurrently. Individual
    // mounted behavior remains sub-second once modules are loaded.
    testTimeout: 20_000,
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
})
