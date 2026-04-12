import { betterAuth } from 'better-auth'
import { createClient, type GenericCtx } from '@convex-dev/better-auth'
import { convex } from '@convex-dev/better-auth/plugins'
import { components, internal } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import authConfig from './auth.config'

export const authComponent = createClient<DataModel>(components.betterAuth)

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    baseURL: process.env.SITE_URL,
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
            await ctx.runMutation(internal.accountDeletion.deleteAccountCascade, {})
          }
        },
      },
    },
    plugins: [convex({ authConfig })],
    trustedOrigins: [process.env.SITE_URL!],
  })
}
