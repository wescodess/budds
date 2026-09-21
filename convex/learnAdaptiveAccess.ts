import { v } from 'convex/values'
import { internalMutation, query } from './_generated/server'
import { hasAccountDeletionTombstone } from './lib/accountDeletionTombstone'
import { getAdaptiveLearnPublicStatus } from './lib/adaptiveLearnAccess'

export const adaptiveStatus = query({ args: {}, handler: async ctx => await getAdaptiveLearnPublicStatus(ctx) })

export const setCohortEntitlement = internalMutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity || await hasAccountDeletionTombstone(ctx, identity.tokenIdentifier)) throw new Error('Adaptive Learn entitlement change denied')
    const user = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', identity.tokenIdentifier)).unique()
    if (!user) throw new Error('Adaptive Learn entitlement user not found')
    const entitlement = { enabled: args.enabled, updatedAt: Date.now() }
    await ctx.db.patch(user._id, { learnAdaptiveExperienceEntitlement: entitlement })
    return entitlement
  },
})
