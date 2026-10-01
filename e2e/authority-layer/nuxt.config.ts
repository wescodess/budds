import { fileURLToPath } from 'node:url'

// Only the disposable loopback stack loads this layer. Unlike canvas-layer,
// it leaves all Canvas-to-Convex transport intact.
const baseUrl = new URL(process.env.BUDDS_E2E_BASE_URL ?? 'http://127.0.0.1:3102')
const convexUrl = new URL(process.env.NUXT_PUBLIC_CONVEX_URL ?? 'http://127.0.0.1:3210')
if (process.env.NODE_ENV === 'production' || process.env.BUDDS_E2E_MODE !== 'true'
  || process.env.CONVEX_DEPLOY_KEY || process.env.CF_PAGES_ENVIRONMENT
  || baseUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(baseUrl.hostname)
  || convexUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(convexUrl.hostname)) {
  throw new Error('Adaptive authority harness requires disposable loopback E2E mode')
}

export default defineNuxtConfig({
  hooks: {
    'pages:extend'(pages) {
      pages.push({
        name: 'adaptive-access-harness',
        path: '/__e2e/adaptive-access',
        file: fileURLToPath(new URL('../adaptive-access-harness.vue', import.meta.url)),
      })
      pages.push({
        name: 'adaptive-session-harness',
        path: '/__e2e/adaptive-session',
        file: fileURLToPath(new URL('../adaptive-session-harness.vue', import.meta.url)),
      })
    },
  },
})
