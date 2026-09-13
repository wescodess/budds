import { v } from 'convex/values'
import { internalMutation, query } from './_generated/server'
import { hasAccountDeletionTombstone } from './lib/accountDeletionTombstone'
import { getLearnV2PublicStatus } from './lib/learnV2Access'

export const status = query({
  args: {},
  handler: async (ctx) => await getLearnV2PublicStatus(ctx),
})

export const setCohortEntitlement = internalMutation({
  args: {
    tokenIdentifier: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (await hasAccountDeletionTombstone(ctx, args.tokenIdentifier)) {
      throw new Error('Learn V2 entitlement change denied')
    }
    const user = await ctx.db
      .query('users')
      .withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', args.tokenIdentifier))
      .unique()
    if (!user) throw new Error('Learn V2 entitlement user not found')

    const learnV2Entitlement = {
      enabled: args.enabled,
      updatedAt: Date.now(),
    }
    await ctx.db.patch(user._id, { learnV2Entitlement })
    return learnV2Entitlement
  },
})
