import { betterAuth } from 'better-auth'
import { createClient, type GenericCtx } from '@convex-dev/better-auth'
import { convex } from '@convex-dev/better-auth/plugins'
import { components, internal } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import authConfig from './auth.config'

export const authComponent = createClient<DataModel>(components.betterAuth)

function normalizeUrl(value: string | undefined) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : ''
}

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const siteUrl = normalizeUrl(process.env.SITE_URL)
    || normalizeUrl(process.env.NUXT_PUBLIC_SITE_URL)
    || 'http://localhost:3002'

  const trustedOrigins = Array.from(new Set([
    siteUrl,
    'https://budds.pages.dev',
    'http://localhost:3002',
    'http://127.0.0.1:3002',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]))

  return betterAuth({
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async () => {
          if ('runMutation' in ctx && typeof ctx.runMutation === 'function') {
            await ctx.runMutation(internal.accountDeletion.deleteCurrentUser, {})
          }
        },
      },
    },
    plugins: [convex({ authConfig })],
    trustedOrigins,
  })
}
