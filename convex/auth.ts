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

function e2eEmailPasswordEnabled() {
  if (process.env.BUDDS_E2E_MODE !== 'true' || (process.env.BUDDS_E2E_AUTH_TOKEN?.length ?? 0) < 32) return false
  try {
    return ['127.0.0.1', 'localhost'].includes(new URL(normalizeUrl(process.env.CONVEX_CLOUD_URL)).hostname)
  }
  catch {
    return false
  }
}

/**
 * Better Auth's Convex plugin uses the Convex site URL as the JWT issuer and
 * the Better Auth user id as the subject. Keep this construction beside the
 * plugin configuration so account deletion receives the same stable owner id
 * stored by authenticated Convex mutations.
 */
export function tokenIdentifierForAuthUser(userId: string, convexSiteUrl: string | undefined) {
  const issuer = normalizeUrl(convexSiteUrl)
  const subject = userId.trim()
  if (!issuer || !subject || subject.includes('|')) {
    throw new Error('Unable to derive the Convex account owner identity')
  }
  return `${issuer}|${subject}`
}

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const siteUrl = normalizeUrl(process.env.SITE_URL)
    || normalizeUrl(process.env.NUXT_PUBLIC_SITE_URL)
    || 'http://localhost:3002'

  const convexSiteUrl = normalizeUrl(process.env.CONVEX_SITE_URL)

  const developmentOrigins = process.env.NODE_ENV === 'production'
    ? []
    : [
        'http://localhost:3002',
        'http://127.0.0.1:3002',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
      ]

  const trustedOrigins = Array.from(new Set([
    siteUrl,
    ...(convexSiteUrl ? [convexSiteUrl] : []),
    'https://budds.pages.dev',
    ...developmentOrigins,
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
    // A disposable local browser-test account is created through Better Auth's
    // normal endpoint. This provider is never enabled in production.
    ...(e2eEmailPasswordEnabled() ? { emailAndPassword: { enabled: true } } : {}),
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          if (!('runMutation' in ctx) || typeof ctx.runMutation !== 'function') {
            throw new Error('Account deletion is unavailable in this runtime')
          }
          const userId = tokenIdentifierForAuthUser(user.id, convexSiteUrl)
          await ctx.runMutation(internal.accountDeletion.beginAccountDeletionForAuthUser, { userId })
        },
      },
    },
    plugins: [convex({ authConfig })],
    trustedOrigins,
  })
}
