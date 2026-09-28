import { fileURLToPath } from 'node:url'

// Selected only by the disposable E2E runner via `nuxt dev --extends`.
// Normal Nuxt builds never load this layer or its fixture route.
const baseUrl = new URL(process.env.BUDDS_E2E_BASE_URL ?? 'http://127.0.0.1:3102')
const convexUrl = new URL(process.env.NUXT_PUBLIC_CONVEX_URL ?? 'http://127.0.0.1:3210')
if (process.env.NODE_ENV === 'production' || process.env.BUDDS_E2E_MODE !== 'true'
  || process.env.CONVEX_DEPLOY_KEY || process.env.CF_PAGES_ENVIRONMENT
  || baseUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(baseUrl.hostname)
  || convexUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(convexUrl.hostname)) {
  throw new Error('Canvas browser harness requires disposable loopback E2E mode')
}

const renderers = new Set([
  'ReadySessionCanvas.vue', 'DiagnosticCanvas.vue', 'ArtifactWorkspace.vue', 'ReflectionNextMove.vue',
].map(name => fileURLToPath(new URL(`../../app/components/learn-adaptive/${name}`, import.meta.url))))
const stubModule = fileURLToPath(new URL('./projection-stubs', import.meta.url))

export default defineNuxtConfig({
  hooks: {
    'pages:extend'(pages) {
      pages.push({
        name: 'canvas-browser-harness',
        path: '/__e2e/canvas-browser-harness',
        file: fileURLToPath(new URL('../canvas-harness.vue', import.meta.url)),
      })
    },
    'vite:extendConfig'(config) {
      config.plugins ||= []
      config.plugins.push({
        name: 'canvas-browser-projection-only',
        enforce: 'pre',
        transform(code, id) {
          if (!renderers.has(id)) return
          if (!code.includes('<script setup lang="ts">')) throw new Error(`Unexpected Canvas renderer shape: ${id}`)
          const transformed = code
            .replace('<script setup lang="ts">', `<script setup lang="ts">\nimport { useHarnessMutation, useHarnessAction, useHarnessQuery } from '${stubModule}'`)
            .replaceAll('useConvexMutation(', 'useHarnessMutation(')
            .replaceAll('useConvexAction(', 'useHarnessAction(')
            .replaceAll('useConvexQuery(', 'useHarnessQuery(')
          if (/\buseConvex(?:Mutation|Action|Query)\s*(?:<[^>]+>)?\s*\(/u.test(transformed)) {
            throw new Error(`Canvas renderer has an unstubbed Convex transport: ${id}`)
          }
          return transformed
        },
      })
    },
  },
})
