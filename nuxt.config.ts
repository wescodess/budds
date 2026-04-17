import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'

function parseDotenvFiles() {
  const dotenvPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '.env.local'),
  ]
  const entries: Record<string, string> = {}

  for (const dotenvPath of dotenvPaths) {
    if (!fs.existsSync(dotenvPath)) continue

    const source = fs.readFileSync(dotenvPath, 'utf8')

    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue

      const separatorIndex = line.indexOf('=')
      if (separatorIndex < 1) continue

      const key = line.slice(0, separatorIndex).trim()
      let value = line.slice(separatorIndex + 1).trim()

      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }

      entries[key] = value
    }
  }

  return entries
}

const dotenvVars = parseDotenvFiles()

function readConfiguredValue(...names: string[]) {
  for (const name of names) {
    const value = process.env[name] || dotenvVars[name]
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
const siteUrl = readConfiguredValue('SITE_URL', 'NUXT_PUBLIC_SITE_URL')
const publicSiteUrl = siteUrl || readConfiguredValue('NUXT_PUBLIC_SITE_URL')
const authProxyTargetUrl = readConfiguredValue('AUTH_PROXY_TARGET_URL', 'NUXT_AUTH_PROXY_TARGET_URL') || toConvexSiteUrl(convexUrl)

export default defineNuxtConfig({
  css: ['~/assets/css/tailwind.css'],
  compatibilityDate: '2025-01-01',
  vite: {
    plugins: [tailwindcss()],
  },
  nitro: {
    preset: 'cloudflare_pages',
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
      },
    },
  },
  shadcn: {
    prefix: 'Ui',
    componentDir: '@/components/ui',
  },
  auth: {
    clientOnly: false,
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
    cloudflareAiGatewayApiKey: readConfiguredValue('NUXT_CLOUDFLARE_AI_GATEWAY_API_KEY', 'CLOUDFLARE_AI_GATEWAY_API_KEY'),
    cloudflareAiSearchInstance: readConfiguredValue('NUXT_CLOUDFLARE_AI_SEARCH_INSTANCE', 'CLOUDFLARE_AI_SEARCH_INSTANCE'),
    cloudflareAiSearchToken: readConfiguredValue('NUXT_CLOUDFLARE_AI_SEARCH_TOKEN', 'CLOUDFLARE_AI_SEARCH_TOKEN'),
    openrouterApiKey: readConfiguredValue('NUXT_OPENROUTER_API_KEY', 'OPENROUTER_API_KEY'),
    cloudflareWorkersAiToken: readConfiguredValue('NUXT_CLOUDFLARE_WORKERS_AI_TOKEN', 'CLOUDFLARE_WORKERS_AI_TOKEN'),
    r2Endpoint: readConfiguredValue('NUXT_R2_ENDPOINT', 'R2_ENDPOINT'),
    r2AccessKeyId: readConfiguredValue('NUXT_R2_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID'),
    r2SecretAccessKey: readConfiguredValue('NUXT_R2_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY'),
    r2BucketName: readConfiguredValue('NUXT_R2_BUCKET_NAME', 'R2_BUCKET_NAME'),
    public: {
      siteUrl: publicSiteUrl,
      convex: {
        url: convexUrl,
      },
    },
  },
  routeRules: {
    '/': { auth: 'user' as const },
    '/chat': { auth: 'user' as const },
    '/app': { auth: 'user' as const },
    '/app/**': { auth: 'user' as const },
    '/login': { auth: 'guest' as const },
  },
})
