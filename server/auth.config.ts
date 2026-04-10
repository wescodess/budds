import Database from 'better-sqlite3'
import { defineServerAuth } from '@onmax/nuxt-better-auth/config'
import { convex } from '@convex-dev/better-auth/plugins'
import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config'
import type { AuthConfig } from 'convex/server'

const authConfig = {
  providers: [
    getAuthConfigProvider({ jwks: process.env.JWKS }),
  ],
} satisfies AuthConfig

export default defineServerAuth({
  database: new Database('./data/auth.db'),
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  plugins: [
    convex({ authConfig }),
  ],
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
})
