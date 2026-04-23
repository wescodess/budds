import { query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import { evaluateStreak } from './lib/streak'

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
  const todayStr = new Date().toISOString().slice(0, 10)

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
