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
  routeRules: {
    '/app/**': { auth: 'user' as const },
    '/login': { auth: 'guest' as const },
  },
})
