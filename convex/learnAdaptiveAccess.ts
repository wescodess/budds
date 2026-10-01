import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { hasAccountDeletionTombstone } from './lib/accountDeletionTombstone'
import { getAdaptiveLearnPublicStatus } from './lib/adaptiveLearnAccess'
import { canBootstrapLearnV2E2e } from './lib/learnV2E2e'
import { requireAdaptiveActivationApproval } from './lib/adaptiveActivationApproval'

export const adaptiveStatus = query({ args: {}, handler: async ctx => await getAdaptiveLearnPublicStatus(ctx) })

// Disposable loopback browser tests exercise rollout and recovery through the
// same owner-scoped entitlement state as the internal cohort control.
export const setLocalE2eEntitlement = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, args) => {
    if (!canBootstrapLearnV2E2e({
      BUDDS_E2E_MODE: process.env.BUDDS_E2E_MODE,
      BUDDS_E2E_AUTH_TOKEN: process.env.BUDDS_E2E_AUTH_TOKEN,
      CONVEX_CLOUD_URL: process.env.CONVEX_CLOUD_URL,
    })) throw new Error('Local Adaptive Learn test control unavailable')
    const identity = await ctx.auth.getUserIdentity()
    if (!identity || await hasAccountDeletionTombstone(ctx, identity.tokenIdentifier)) throw new Error('Adaptive Learn entitlement change denied')
    const user = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', identity.tokenIdentifier)).unique()
    if (!user) throw new Error('Adaptive Learn entitlement user not found')
    if (args.enabled) requireAdaptiveActivationApproval({
      BUDDS_E2E_MODE: process.env.BUDDS_E2E_MODE,
      BUDDS_E2E_AUTH_TOKEN: process.env.BUDDS_E2E_AUTH_TOKEN,
      CONVEX_CLOUD_URL: process.env.CONVEX_CLOUD_URL,
    })
    const entitlement = { enabled: args.enabled, updatedAt: Date.now() }
    await ctx.db.patch(user._id, { learnAdaptiveExperienceEntitlement: entitlement })
    return entitlement
  },
})

export const setCohortEntitlement = internalMutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity || await hasAccountDeletionTombstone(ctx, identity.tokenIdentifier)) throw new Error('Adaptive Learn entitlement change denied')
    const user = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', identity.tokenIdentifier)).unique()
    if (!user) throw new Error('Adaptive Learn entitlement user not found')
    if (args.enabled) requireAdaptiveActivationApproval()
    const entitlement = { enabled: args.enabled, updatedAt: Date.now() }
    await ctx.db.patch(user._id, { learnAdaptiveExperienceEntitlement: entitlement })
    return entitlement
  },
})
