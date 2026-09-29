import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { internal } from './_generated/api'

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const BATCH_SIZE = 128

export const purgeExpiredLearnActivityEvents = internalMutation({
  args: {
    cutoff: v.optional(v.number()),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const cutoff = args.cutoff ?? Date.now() - RETENTION_MS

    if (args.userId) {
      const userId = args.userId
      const expired = await ctx.db.query('learnActivityEvents')
        .withIndex('by_userId_and_occurredAt', q => q.eq('userId', userId).lte('occurredAt', cutoff))
        .take(BATCH_SIZE)
      for (const event of expired) await ctx.db.delete(event._id)

      await ctx.scheduler.runAfter(0, internal.learnActivityEventRetention.purgeExpiredLearnActivityEvents, { cutoff })
      return { deleted: expired.length, scheduled: true }
    }

    const oldestExpired = await ctx.db.query('learnActivityEvents')
      .withIndex('by_occurredAt', q => q.lte('occurredAt', cutoff))
      .take(1)
    const nextOwner = oldestExpired[0]
    if (!nextOwner) return { deleted: 0, scheduled: false }

    await ctx.scheduler.runAfter(0, internal.learnActivityEventRetention.purgeExpiredLearnActivityEvents, {
      cutoff,
      userId: nextOwner.userId,
    })
    return { deleted: 0, scheduled: true }
  },
})
