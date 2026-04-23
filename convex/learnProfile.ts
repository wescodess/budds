import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import { evaluateStreak } from './lib/streak'
import { requireAuth } from './lib/auth'

export const getProfile = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null
    const userId = identity.tokenIdentifier

    return await ctx.db
      .query('learnProfile')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique()
  },
})

export const setTimezone = mutation({
  args: { timezone: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const tz = args.timezone.trim()
    if (!tz) throw new Error('Timezone must not be empty')

    try {
      new Date().toLocaleDateString('en-CA', { timeZone: tz })
    } catch {
      throw new Error(`Invalid timezone: ${tz}`)
    }

    const profile = await getOrCreateProfile(ctx, userId)
    await ctx.db.patch(profile._id, { timezone: tz })
  },
})

export async function getOrCreateProfile(ctx: MutationCtx, userId: string) {
  const existing = await ctx.db
    .query('learnProfile')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique()

  if (existing) return existing

  const id = await ctx.db.insert('learnProfile', {
    userId,
    streakCurrent: 0,
    streakFreezeAvailable: true,
    dailyReviewCap: 50,
  })

  return (await ctx.db.get(id))!
}

function getTodayInTimezone(timezone?: string): string {
  if (timezone) {
    try {
      return new Date().toLocaleDateString('en-CA', { timeZone: timezone })
    } catch {
      // fall through to UTC
    }
  }
  return new Date().toISOString().slice(0, 10)
}

export async function updateStreakForActivity(ctx: MutationCtx, userId: string) {
  const profile = await getOrCreateProfile(ctx, userId)
  const todayStr = getTodayInTimezone(profile.timezone)

  const result = evaluateStreak(
    {
      streakCurrent: profile.streakCurrent,
      streakLastDate: profile.streakLastDate,
      streakFreezeAvailable: profile.streakFreezeAvailable,
      streakFreezeUsedAt: profile.streakFreezeUsedAt,
    },
    todayStr,
  )

  await ctx.db.patch(profile._id, {
    streakCurrent: result.streakCurrent,
    streakLastDate: result.streakLastDate,
    streakFreezeAvailable: result.streakFreezeAvailable,
    streakFreezeUsedAt: result.streakFreezeUsedAt,
  })

  return result
}
