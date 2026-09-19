import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import type { NuxtConfig } from 'nuxt/schema'

function readConfiguredValue(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return ''
}

function toConvexSiteUrl(url: string) {
  if (!url) return ''
  return url.replace(/\.convex\.cloud(?=\/|$)/, '.convex.site')
}

const convexUrl = readConfiguredValue('NUXT_PUBLIC_CONVEX_URL', 'CONVEX_URL')
const siteUrl = readConfiguredValue('SITE_URL', 'NUXT_PUBLIC_SITE_URL', 'CF_PAGES_URL')
const publicSiteUrl = siteUrl || readConfiguredValue('NUXT_PUBLIC_SITE_URL', 'CF_PAGES_URL')
const authProxyTargetUrl = readConfiguredValue('AUTH_PROXY_TARGET_URL', 'NUXT_AUTH_PROXY_TARGET_URL') || toConvexSiteUrl(convexUrl)
const serverAuthEnabled = process.env.NODE_ENV !== 'development'
const routeRules = {
  '/': { auth: serverAuthEnabled ? 'user' as const : undefined },
  '/chat': { auth: serverAuthEnabled ? 'user' as const : undefined },
  '/app': { auth: serverAuthEnabled ? 'user' as const : undefined },
  '/app/**': { auth: serverAuthEnabled ? 'user' as const : undefined },
  '/login': { auth: serverAuthEnabled ? 'guest' as const : undefined },
  '/audio/**': { swr: 300 },
} as unknown as NonNullable<NuxtConfig['routeRules']>

export default defineNuxtConfig({
  css: ['~/assets/css/tailwind.css'],
  compatibilityDate: '2025-01-01',
  vite: {
    plugins: [tailwindcss()],
  },
  nitro: {
    preset: 'cloudflare_pages',
    cloudflare: {
      nodeCompat: true,
    },
    externals: {
      inline: [fileURLToPath(new URL('./convex/_generated/', import.meta.url))],
    },
  },
  modules: ['shadcn-nuxt', 'nuxt-convex', '@onmax/nuxt-better-auth', '@nuxtjs/mdc'],
  convex: {
    url: convexUrl,
  },
  components: [
    { path: '~/components/global', global: true },
    '~/components',
  ],
  mdc: {
    highlight: {
      theme: {
        default: 'github-dark-default',
        dark: 'github-dark-default',
      },
      langs: ['ts', 'js', 'jsx', 'tsx', 'vue', 'bash', 'shell', 'json', 'md', 'python', 'sql', 'html', 'css', 'diff', 'yaml'],
    },
    components: {
      prose: false,
      map: {
        citation: 'Citation',
        pre: 'ProsePre',
      },
    },
  },
  shadcn: {
    prefix: 'Ui',
    componentDir: '@/components/ui',
  },
  auth: {
    // The hosted Convex auth proxy can stall Better Auth's SSR bootstrap in
    // local development. Existing client auth plugins establish the session
    // after hydration; production keeps server-side auth and route guards.
    clientOnly: !serverAuthEnabled,
    redirects: {
      login: '/login',
      guest: '/',
      logout: '/login',
    },
  },
  devServer: {
    port: 3002,
  },
  runtimeConfig: {
    // Read from process.env in Cloudflare Pages and from .env/.env.local locally.
    authProxyTargetUrl,
    siteUrl,
    cloudflareAccountId: readConfiguredValue('NUXT_CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID'),
    cloudflareAiGatewayId: readConfiguredValue('NUXT_CLOUDFLARE_AI_GATEWAY_ID', 'CLOUDFLARE_AI_GATEWAY_ID'),
    cloudflareAiGatewayApiKey: '',
    cloudflareAiSearchInstance: readConfiguredValue('NUXT_CLOUDFLARE_AI_SEARCH_INSTANCE', 'CLOUDFLARE_AI_SEARCH_INSTANCE'),
    cloudflareAiSearchToken: '',
    openrouterApiKey: '',
    cloudflareWorkersAiToken: '',
    r2Endpoint: readConfiguredValue('NUXT_R2_ENDPOINT', 'R2_ENDPOINT'),
    r2AccessKeyId: '',
    r2SecretAccessKey: '',
    r2BucketName: readConfiguredValue('NUXT_R2_BUCKET_NAME', 'R2_BUCKET_NAME'),
    diaServerUrl: readConfiguredValue('NUXT_DIA_SERVER_URL', 'DIA_SERVER_URL'),
    diaServerApiKey: '',
    diaStartFunctionUrl: readConfiguredValue('NUXT_DIA_START_FUNCTION_URL', 'DIA_START_FUNCTION_URL'),
    audioOverviewJobSecret: '',
    audioOverviewWorkerUrl: readConfiguredValue('NUXT_AUDIO_OVERVIEW_WORKER_URL', 'AUDIO_OVERVIEW_WORKER_URL'),
    audioOverviewWorkerToken: '',
    // Private-only evaluator pilot. It is off unless mode is `shadow` and
    // a configured provider is selected; neither value is public runtime config.
    learningDecisionMode: readConfiguredValue('NUXT_LEARNING_DECISION_MODE'),
    learningDecisionProvider: readConfiguredValue('NUXT_LEARNING_DECISION_PROVIDER'),
    layaEvaluatorUrl: readConfiguredValue('NUXT_LAYA_EVALUATOR_URL'),
    layaEvaluatorToken: '',
    calendarTokenEncryptionKey: '',
    public: {
      siteUrl: publicSiteUrl,
      convex: {
        url: convexUrl,
      },
    },
  },
  routeRules,
})
