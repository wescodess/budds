import { mutation, query } from './_generated/server'

export const AUDIO_OVERVIEW_DAILY_CAP = 10

function todayUtcYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

export const upsertUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')

    const existing = await ctx.db
      .query('users')
      .withIndex('by_tokenIdentifier', (q) =>
        q.eq('tokenIdentifier', identity.tokenIdentifier),
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
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null

    return await ctx.db
      .query('users')
      .withIndex('by_tokenIdentifier', (q) =>
        q.eq('tokenIdentifier', identity.tokenIdentifier),
      )
      .unique()
  },
})

export const getDailyQuota = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null

    const user = await ctx.db
      .query('users')
      .withIndex('by_tokenIdentifier', (q) =>
        q.eq('tokenIdentifier', identity.tokenIdentifier),
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
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')

    const user = await ctx.db
      .query('users')
      .withIndex('by_tokenIdentifier', (q) =>
        q.eq('tokenIdentifier', identity.tokenIdentifier),
      )
      .unique()
    if (!user) throw new Error('User not found')

    const today = todayUtcYmd()
    const current = user.audioOverviewQuota
    const nextCount = current && current.date === today ? current.count + 1 : 1
    await ctx.db.patch(user._id, {
      audioOverviewQuota: { date: today, count: nextCount },
    })
    return { used: nextCount, cap: AUDIO_OVERVIEW_DAILY_CAP, date: today }
  },
})
