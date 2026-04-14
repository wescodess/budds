import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'

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
      prose: true,
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
    cloudflareAccountId: process.env.CF_ACCOUNT_ID,
    cloudflareAiGatewayId: process.env.CLOUDFLARE_AI_GATEWAY_ID,
    cloudflareAiGatewayApiKey: process.env.CLOUDFLARE_AI_GATEWAY_API_KEY,
    cloudflareAiSearchInstance: process.env.CLOUDFLARE_AI_SEARCH_INSTANCE,
    cloudflareAiSearchToken: process.env.CLOUDFLARE_AI_SEARCH_TOKEN,
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    r2Endpoint: process.env.R2_ENDPOINT,
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    r2BucketName: process.env.R2_BUCKET_NAME,
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3002',
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
