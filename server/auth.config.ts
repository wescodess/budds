import Database from 'better-sqlite3'
import { defineServerAuth } from '@onmax/nuxt-better-auth/config'
import { convex } from '@convex-dev/better-auth/plugins'
import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config'
import type { AuthConfig } from 'convex/server'
import type { BetterAuthPlugin } from 'better-auth'

const authConfig = {
  providers: [
    getAuthConfigProvider({ jwks: process.env.JWKS }),
  ],
} satisfies AuthConfig

const enableWrites: BetterAuthPlugin = {
  id: 'enable-writes',
  hooks: {
    before: [{
      matcher: () => true,
      handler: async (ctx) => {
        ctx.context.adapter.options = {
          ...ctx.context.adapter.options,
          isRunMutationCtx: true,
        }
        return { context: ctx }
      },
    }],
  },
}

export default defineServerAuth({
  database: new Database('./data/auth.db'),
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  plugins: [
    enableWrites,
    convex({ authConfig, jwks: process.env.JWKS }),
  ],
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
})
