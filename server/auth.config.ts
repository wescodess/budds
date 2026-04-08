import { components } from '#convex/api'
import { createClient } from '@convex-dev/better-auth'
import { convex } from '@convex-dev/better-auth/server/plugins'
import { defineServerAuth } from '@onmax/nuxt-better-auth/config'

const authComponent = createClient(components.betterAuth)

export default defineServerAuth({
  database: authComponent.adapter(),
  plugins: [convex()],
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
})
