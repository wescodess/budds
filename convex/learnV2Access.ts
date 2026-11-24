import { v } from 'convex/values'
import { internalMutation, query } from './_generated/server'
import { internal } from './_generated/api'
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
    if (!args.enabled) {
      const postSeal = await ctx.db.query('learnPostSealTeachingSources').withIndex('by_userId', q => q.eq('userId', args.tokenIdentifier)).take(1)
      const practice = await ctx.db.query('learnPostSealPracticeBindings').withIndex('by_userId', q => q.eq('userId', args.tokenIdentifier)).take(1)
      if (postSeal.length || practice.length) await ctx.scheduler.runAfter(0, internal.learnV2PostSealTeaching.purgeAccess, { userId: args.tokenIdentifier, table: 0, cursor: null })
    }
    return learnV2Entitlement
  },
})
