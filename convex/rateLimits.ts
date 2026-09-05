import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, mutation } from './_generated/server'
import { requireAuth } from './lib/auth'

const WINDOW_MS = 60_000
const CLEANUP_BATCH_SIZE = 200

export const consume = mutation({
  args: {
    route: v.string(),
    maxPerMinute: v.union(v.literal(3), v.literal(5), v.literal(20)),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const route = args.route.slice(0, 200)
    const key = `${userId}::${route}`
    const now = Date.now()
    const existing = await ctx.db
      .query('rateLimitBuckets')
      .withIndex('by_key', q => q.eq('key', key))
      .unique()

    if (!existing) {
      await ctx.db.insert('rateLimitBuckets', {
        key,
        userId,
        route,
        count: 1,
        windowStartedAt: now,
        expiresAt: now + WINDOW_MS,
      })
      return { allowed: true, retryAfterMs: 0 }
    }

    if (existing.expiresAt <= now) {
      await ctx.db.patch(existing._id, {
        count: 1,
        windowStartedAt: now,
        expiresAt: now + WINDOW_MS,
      })
      return { allowed: true, retryAfterMs: 0 }
    }

    if (existing.count >= args.maxPerMinute) {
      return {
        allowed: false,
        retryAfterMs: Math.max(1, existing.expiresAt - now),
      }
    }

    await ctx.db.patch(existing._id, { count: existing.count + 1 })
    return { allowed: true, retryAfterMs: 0 }
  },
})

export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query('rateLimitBuckets')
      .withIndex('by_expiresAt', q => q.lt('expiresAt', Date.now()))
      .take(CLEANUP_BATCH_SIZE)

    for (const bucket of expired) await ctx.db.delete(bucket._id)

    if (expired.length === CLEANUP_BATCH_SIZE) {
      await ctx.scheduler.runAfter(1, internal.rateLimits.cleanupExpired, {})
    }
    return { deleted: expired.length }
  },
})
