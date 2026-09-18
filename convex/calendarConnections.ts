import { v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { requireAuth } from './lib/auth'
import type { Doc } from './_generated/dataModel'
import { assertCalendarCleanupSettled } from './calendarEventCleanup'
import { internal } from './_generated/api'

const DISCONNECT_LEASE_MS = 60_000

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
      preferences: connection.preferences ?? null,
      learnV2ConsentVersion: connection.learnV2ConsentVersion ?? null,
    }
  },
})

export const upsertConnection = mutation({
  args: {
    provider: v.literal('google'),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.number(),
    timezone: v.string(),
    grantedScopes: v.optional(v.array(v.string())),
    learnV2ConsentVersion: v.optional(v.literal(1)),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const existing = await ctx.db
      .query('calendarConnections')
      .withIndex('by_userId', q => q.eq('userId', userId))
      .first()

    if (existing) {
      if (existing.status === 'disconnecting') {
        throw new Error('Calendar disconnect is in progress')
      }
      await ctx.db.patch(existing._id, {
        accessToken: args.accessToken,
        ...(args.refreshToken ? { refreshToken: args.refreshToken } : {}),
        expiresAt: args.expiresAt,
        timezone: args.timezone,
        status: 'connected' as const,
        connectedAt: Date.now(),
        ...(args.grantedScopes ? { grantedScopes: [...new Set(args.grantedScopes)].sort() } : {}),
        ...(args.learnV2ConsentVersion ? { learnV2ConsentVersion: args.learnV2ConsentVersion } : {}),
      })
      return existing._id
    }

    if (!args.refreshToken) throw new Error('A refresh token is required for a new connection')
    return await ctx.db.insert('calendarConnections', {
      userId,
      provider: args.provider,
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      expiresAt: args.expiresAt,
      timezone: args.timezone,
      status: 'connected',
      connectedAt: Date.now(),
      ...(args.grantedScopes ? { grantedScopes: [...new Set(args.grantedScopes)].sort() } : {}),
      ...(args.learnV2ConsentVersion ? { learnV2ConsentVersion: args.learnV2ConsentVersion } : {}),
    })
  },
})

// Kept internal for local cleanup tests and trusted server orchestration. Public
// callers must use calendarEvents.disconnectCalendar so Google events are
// removed before credentials and local records are deleted.
export const disconnect = internalMutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx)
    const connection = await ctx.db
      .query('calendarConnections')
      .withIndex('by_userId', q => q.eq('userId', userId))
      .first()
    if (!connection) throw new Error('No calendar connection found')
    const event = await ctx.db
      .query('calendarEvents')
      .withIndex('by_userId', q => q.eq('userId', userId))
      .first()
    if (event) throw new Error('Calendar events must be removed by the provider-first disconnect')
    const projection = await ctx.db
      .query('calendarProjections')
      .withIndex('by_calendarConnectionId', q => q.eq('calendarConnectionId', connection._id))
      .first()
    if (projection) throw new Error('Calendar projections must be removed by the provider-first disconnect')
    await assertCalendarCleanupSettled(ctx, connection._id)
    const cleanup = await ctx.db
      .query('calendarEventCleanupJobs')
      .withIndex('by_calendarConnectionId_and_calendarEventId', q =>
        q.eq('calendarConnectionId', connection._id),
      )
      .first()
    if (cleanup) throw new Error('Calendar cleanup evidence must be drained before disconnecting')
    await ctx.db.delete(connection._id)
  },
})

export const beginDisconnectForUser = internalMutation({
  args: {
    userId: v.string(),
    leaseToken: v.string(),
    expectedCalendarConnectionId: v.optional(v.id('calendarConnections')),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query('calendarConnections')
      .withIndex('by_userId', q => q.eq('userId', args.userId))
      .first()
    if (!connection) return { state: 'absent' as const }
    if (args.expectedCalendarConnectionId && connection._id !== args.expectedCalendarConnectionId) {
      return { state: 'absent' as const }
    }

    const now = Date.now()
    if (connection.status === 'disconnecting'
      && connection.disconnectLeaseToken
      && (connection.disconnectLeaseExpiresAt ?? 0) > now) {
      return {
        state: 'busy' as const,
        retryAfterMs: connection.disconnectLeaseExpiresAt! - now,
      }
    }

    await ctx.db.patch(connection._id, {
      status: 'disconnecting',
      disconnectLeaseToken: args.leaseToken,
      disconnectLeaseExpiresAt: now + DISCONNECT_LEASE_MS,
      disconnectAttempts: (connection.disconnectAttempts ?? 0) + 1,
      disconnectUpdatedAt: now,
    })
    await ctx.scheduler.runAfter(DISCONNECT_LEASE_MS, internal.calendarEvents.continueDisconnect, {
      calendarConnectionId: connection._id,
    })
    return {
      state: 'claimed' as const,
      connection: {
        ...connection,
        status: 'disconnecting' as const,
        disconnectLeaseToken: args.leaseToken,
        disconnectLeaseExpiresAt: now + DISCONNECT_LEASE_MS,
      },
    }
  },
})

export const recordDisconnectBatch = internalMutation({
  args: {
    calendarConnectionId: v.id('calendarConnections'),
    leaseToken: v.string(),
    deletedEventIds: v.array(v.id('calendarEvents')),
    deletedProjectionIds: v.optional(v.array(v.id('calendarProjections'))),
    failures: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.calendarConnectionId)
    if (!connection
      || connection.status !== 'disconnecting'
      || connection.disconnectLeaseToken !== args.leaseToken) {
      return { state: 'stale' as const }
    }

    for (const eventId of args.deletedEventIds) {
      const event = await ctx.db.get(eventId)
      if (event?.calendarConnectionId === connection._id) await ctx.db.delete(eventId)
    }
    for (const projectionId of args.deletedProjectionIds ?? []) {
      const projection = await ctx.db.get(projectionId)
      if (projection?.calendarConnectionId === connection._id) await ctx.db.delete(projectionId)
    }

    const now = Date.now()
    const deletedCount = (connection.disconnectDeletedCount ?? 0)
      + args.deletedEventIds.length
      + (args.deletedProjectionIds?.length ?? 0)
    if (args.failures > 0) {
      const delayMs = Math.min(30_000 * 2 ** Math.min((connection.disconnectAttempts ?? 1) - 1, 7), 60 * 60_000)
      await ctx.db.patch(connection._id, {
        disconnectDeletedCount: deletedCount,
        disconnectLastError: (args.error ?? 'Google Calendar event deletion failed').slice(0, 500),
        disconnectLeaseToken: undefined,
        disconnectLeaseExpiresAt: undefined,
        disconnectUpdatedAt: now,
      })
      await ctx.scheduler.runAfter(delayMs, internal.calendarEvents.continueDisconnect, {
        calendarConnectionId: connection._id,
      })
      return { state: 'retrying' as const, retryAfterMs: delayMs }
    }

    const remainingEvent = await ctx.db
      .query('calendarEvents')
      .withIndex('by_calendarConnectionId_and_calendarEventId', q =>
        q.eq('calendarConnectionId', connection._id),
      )
      .first()
    const remainingProjection = await ctx.db
      .query('calendarProjections')
      .withIndex('by_calendarConnectionId', q => q.eq('calendarConnectionId', connection._id))
      .first()
    if (remainingEvent || remainingProjection) {
      await ctx.db.patch(connection._id, {
        disconnectDeletedCount: deletedCount,
        disconnectLeaseToken: undefined,
        disconnectLeaseExpiresAt: undefined,
        disconnectUpdatedAt: now,
      })
      await ctx.scheduler.runAfter(0, internal.calendarEvents.continueDisconnect, {
        calendarConnectionId: connection._id,
      })
      return { state: 'continuing' as const }
    }

    try {
      await assertCalendarCleanupSettled(ctx, connection._id)
    }
    catch {
      await ctx.db.patch(connection._id, {
        disconnectDeletedCount: deletedCount,
        disconnectLastError: 'Waiting for external calendar compensation to settle',
        disconnectLeaseToken: undefined,
        disconnectLeaseExpiresAt: undefined,
        disconnectUpdatedAt: now,
      })
      await ctx.scheduler.runAfter(30_000, internal.calendarEvents.continueDisconnect, {
        calendarConnectionId: connection._id,
      })
      return { state: 'waiting_cleanup' as const }
    }

    const managedCleanup = await ctx.db
      .query('calendarEventCleanupJobs')
      .withIndex('by_calendarConnectionId_and_status', q =>
        q.eq('calendarConnectionId', connection._id).eq('status', 'managed'),
      )
      .take(25)
    const resolvedCleanup = await ctx.db
      .query('calendarEventCleanupJobs')
      .withIndex('by_calendarConnectionId_and_status', q =>
        q.eq('calendarConnectionId', connection._id).eq('status', 'resolved'),
      )
      .take(25)
    const terminalCleanup = [...managedCleanup, ...resolvedCleanup]
    if (terminalCleanup.length > 0) {
      for (const cleanup of terminalCleanup) await ctx.db.delete(cleanup._id)
      await ctx.db.patch(connection._id, {
        disconnectDeletedCount: deletedCount,
        disconnectLeaseToken: undefined,
        disconnectLeaseExpiresAt: undefined,
        disconnectUpdatedAt: now,
      })
      await ctx.scheduler.runAfter(0, internal.calendarEvents.continueDisconnect, {
        calendarConnectionId: connection._id,
      })
      return { state: 'purging_evidence' as const, deleted: terminalCleanup.length }
    }

    await ctx.db.delete(connection._id)
    return { state: 'disconnected' as const, deleted: deletedCount }
  },
})

export const hasConnectionForUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => (await ctx.db
    .query('calendarConnections')
    .withIndex('by_userId', q => q.eq('userId', args.userId))
    .first()) !== null,
})

const dayLiteral = v.union(
  v.literal('mon'), v.literal('tue'), v.literal('wed'),
  v.literal('thu'), v.literal('fri'), v.literal('sat'), v.literal('sun'),
)

const TIME_RE = /^\d{2}:\d{2}$/

function validTimeMinutes(value: string): number | null {
  if (!TIME_RE.test(value)) return null
  const [hour, minute] = value.split(':').map(Number)
  if (hour === undefined || minute === undefined || hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

export const updatePreferences = mutation({
  args: {
    morningStart: v.string(),
    eveningEnd: v.string(),
    sessionMinutes: v.union(v.literal(5), v.literal(10), v.literal(15), v.literal(25)),
    preferredDays: v.array(dayLiteral),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const morningMinutes = validTimeMinutes(args.morningStart)
    const eveningMinutes = validTimeMinutes(args.eveningEnd)
    if (morningMinutes === null || eveningMinutes === null) {
      throw new Error('Time must be in HH:MM format')
    }
    if (morningMinutes + args.sessionMinutes > eveningMinutes) {
      throw new Error('Calendar availability must fit at least one session')
    }
    if (args.preferredDays.length === 0) {
      throw new Error('At least one preferred day is required')
    }
    const connection = await ctx.db
      .query('calendarConnections')
      .withIndex('by_userId', q => q.eq('userId', userId))
      .first()
    if (!connection) throw new Error('No calendar connection found')
    if (connection.status !== 'connected') throw new Error('Calendar not connected')

    await ctx.db.patch(connection._id, {
      preferences: {
        morningStart: args.morningStart,
        eveningEnd: args.eveningEnd,
        sessionMinutes: args.sessionMinutes,
        preferredDays: args.preferredDays,
      },
    })
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
    calendarConnectionId: v.id('calendarConnections'),
    expectedStatus: v.union(v.literal('connected'), v.literal('disconnecting')),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.calendarConnectionId)
    if (!connection
      || connection.userId !== args.userId
      || connection.status !== args.expectedStatus) {
      throw new Error('Calendar connection changed while refreshing credentials')
    }
    await ctx.db.patch(connection._id, {
      accessToken: args.accessToken,
      ...(args.refreshToken ? { refreshToken: args.refreshToken } : {}),
      expiresAt: args.expiresAt,
    })
  },
})

export const getConnectedUserPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('calendarConnections')
      .paginate({ cursor: args.cursor, numItems: 100 })
    return {
      userIds: Array.from(new Set(result.page
        .filter(connection => connection.status === 'connected')
        .map(connection => connection.userId))),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    }
  },
})

export const getConnectionByUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args): Promise<Doc<'calendarConnections'> | null> => {
    const connection = await ctx.db
      .query('calendarConnections')
      .withIndex('by_userId', q => q.eq('userId', args.userId))
      .first()
    if (!connection || connection.status !== 'connected') return null
    return connection
  },
})

export const getConnectionForDisconnectByUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args): Promise<Doc<'calendarConnections'> | null> => await ctx.db
    .query('calendarConnections')
    .withIndex('by_userId', q => q.eq('userId', args.userId))
    .first(),
})

export const getConnectionByIdForCleanup = internalQuery({
  args: { calendarConnectionId: v.id('calendarConnections') },
  handler: async (ctx, args): Promise<Doc<'calendarConnections'> | null> => {
    return await ctx.db.get(args.calendarConnectionId)
  },
})

export const expireAccessTokenForCleanup = internalMutation({
  args: {
    calendarConnectionId: v.id('calendarConnections'),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.calendarConnectionId)
    if (!connection || connection.userId !== args.userId) return false
    await ctx.db.patch(connection._id, { expiresAt: 0 })
    return true
  },
})
