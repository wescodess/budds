import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  css: ['~/assets/css/tailwind.css'],
  compatibilityDate: '2025-01-01',
  vite: {
    plugins: [tailwindcss()],
  },
  modules: ['shadcn-nuxt', 'nuxt-convex', '@onmax/nuxt-better-auth'],
  shadcn: {
    prefix: 'Ui',
    componentDir: '@/components/ui',
  },
  auth: {
    redirects: {
      login: '/login',
      guest: '/',
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
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3002',
    },
  },
  routeRules: {
    '/app/**': { auth: 'user' as const },
    '/login': { auth: 'guest' as const },
  },
})
