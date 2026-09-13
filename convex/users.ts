import { mutation, query } from './_generated/server'
import { AUDIO_OVERVIEW_DAILY_CAP, todayUtcYmd } from './lib/audioOverviewPolicy'
import { getOptionalAuthUserId, requireAuth } from './lib/auth'

export { AUDIO_OVERVIEW_DAILY_CAP }

export const upsertUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')
    const userId = await requireAuth(ctx)

    const existing = await ctx.db
      .query('users')
      .withIndex('by_tokenIdentifier', (q) =>
        q.eq('tokenIdentifier', userId),
      )
      .unique()

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: identity.name ?? existing.name,
        email: identity.email ?? existing.email,
        avatarUrl: identity.pictureUrl ?? existing.avatarUrl,
      })
      return existing._id
    }

    return await ctx.db.insert('users', {
      tokenIdentifier: identity.tokenIdentifier,
      name: identity.name ?? 'Unknown',
      email: identity.email ?? undefined,
      avatarUrl: identity.pictureUrl ?? undefined,
    })
  },
})

export const getUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return null

    const user = await ctx.db
      .query('users')
      .withIndex('by_tokenIdentifier', (q) =>
        q.eq('tokenIdentifier', userId),
      )
      .unique()
    if (!user) return null

    return {
      _id: user._id,
      _creationTime: user._creationTime,
      tokenIdentifier: user.tokenIdentifier,
      name: user.name,
      ...(user.email === undefined ? {} : { email: user.email }),
      ...(user.avatarUrl === undefined ? {} : { avatarUrl: user.avatarUrl }),
      ...(user.audioOverviewQuota === undefined
        ? {}
        : { audioOverviewQuota: user.audioOverviewQuota }),
      ...(user.audioOverviewInterjectionQuota === undefined
        ? {}
        : { audioOverviewInterjectionQuota: user.audioOverviewInterjectionQuota }),
    }
  },
})

export const getDailyQuota = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return null

    const user = await ctx.db
      .query('users')
      .withIndex('by_tokenIdentifier', (q) =>
        q.eq('tokenIdentifier', userId),
      )
      .unique()

    const today = todayUtcYmd()
    const quota = user?.audioOverviewQuota
    const used = quota && quota.date === today ? quota.count : 0
    return { used, cap: AUDIO_OVERVIEW_DAILY_CAP, date: today }
  },
})

export const incrementDailyQuota = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx)

    const user = await ctx.db
      .query('users')
      .withIndex('by_tokenIdentifier', (q) =>
        q.eq('tokenIdentifier', userId),
      )
      .unique()
    if (!user) throw new Error('User not found')

    const today = todayUtcYmd()
    const current = user.audioOverviewQuota
    const used = current && current.date === today ? current.count : 0
    if (used >= AUDIO_OVERVIEW_DAILY_CAP) {
      throw new Error('Daily audio overview quota reached')
    }
    const nextCount = used + 1
    await ctx.db.patch(user._id, {
      audioOverviewQuota: { date: today, count: nextCount },
    })
    return { used: nextCount, cap: AUDIO_OVERVIEW_DAILY_CAP, date: today }
  },
})
