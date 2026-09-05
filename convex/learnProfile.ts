import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import { evaluateStreak } from './lib/streak'
import { getOptionalAuthUserId, requireAuth } from './lib/auth'
import { getTodayInTimezone } from './lib/dates'

export const getProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return null

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

export const updateDailyReviewCap = mutation({
  args: { cap: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    if (args.cap < 5 || args.cap > 200) {
      throw new Error('Daily review cap must be between 5 and 200')
    }
    const cap = Math.round(args.cap)
    const profile = await getOrCreateProfile(ctx, userId)
    await ctx.db.patch(profile._id, { dailyReviewCap: cap })
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
