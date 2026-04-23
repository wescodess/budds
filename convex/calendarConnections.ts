import { v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { requireAuth } from './lib/auth'

export const getByUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx)
    const connection = await ctx.db
      .query('calendarConnections')
      .withIndex('by_userId', q => q.eq('userId', userId))
      .first()
    if (!connection) return null
    return {
      _id: connection._id,
      provider: connection.provider,
      timezone: connection.timezone,
      status: connection.status,
      connectedAt: connection.connectedAt,
    }
  },
})

export const upsertConnection = mutation({
  args: {
    provider: v.literal('google'),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
    timezone: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const existing = await ctx.db
      .query('calendarConnections')
      .withIndex('by_userId', q => q.eq('userId', userId))
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, {
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        expiresAt: args.expiresAt,
        timezone: args.timezone,
        status: 'connected' as const,
        connectedAt: Date.now(),
      })
      return existing._id
    }

    return await ctx.db.insert('calendarConnections', {
      userId,
      provider: args.provider,
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      expiresAt: args.expiresAt,
      timezone: args.timezone,
      status: 'connected',
      connectedAt: Date.now(),
    })
  },
})

export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx)
    const connection = await ctx.db
      .query('calendarConnections')
      .withIndex('by_userId', q => q.eq('userId', userId))
      .first()
    if (!connection) throw new Error('No calendar connection found')
    await ctx.db.delete(connection._id)
  },
})

export const getTokens = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query('calendarConnections')
      .withIndex('by_userId', q => q.eq('userId', args.userId))
      .first()
    if (!connection || connection.status !== 'connected') return null
    return {
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      expiresAt: connection.expiresAt,
    }
  },
})

export const updateTokens = internalMutation({
  args: {
    userId: v.string(),
    accessToken: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query('calendarConnections')
      .withIndex('by_userId', q => q.eq('userId', args.userId))
      .first()
    if (!connection) throw new Error('No calendar connection found')
    await ctx.db.patch(connection._id, {
      accessToken: args.accessToken,
      expiresAt: args.expiresAt,
    })
  },
})
