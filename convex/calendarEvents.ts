import { v } from 'convex/values'
import { action, internalAction, internalMutation, internalQuery, mutation, query, type ActionCtx } from './_generated/server'
import { api, internal } from './_generated/api'
import { requireAuth } from './lib/auth'
import { getCalendarAccessToken, getStoredCalendarAccessToken } from './lib/calendarTokenRuntime'
import type { Doc, Id } from './_generated/dataModel'
import { markCalendarEventManaged, reserveCalendarCleanup } from './calendarEventCleanup'
import { hasAccountDeletionTombstone } from './lib/accountDeletionTombstone'
import {
  buildEventDescription,
  buildEventTitle,
  determineSessionType,
  getScheduledHourInTimezone,
  preferredDayNumbersFromStrings,
} from '../server/utils/session-composition'

const sessionTypeValidator = v.union(
  v.literal('new-content'),
  v.literal('review'),
  v.literal('audio-only'),
)

const statusValidator = v.union(
  v.literal('scheduled'),
  v.literal('completed'),
  v.literal('missed'),
  v.literal('rescheduled'),
)

const DISCONNECT_BATCH_SIZE = 25
const MISSED_EVENT_BATCH_SIZE = 10

function createGoogleEventId(): string {
  return crypto.randomUUID().replaceAll('-', '').toLowerCase()
}

function localTimeOnDate(reference: Date, time: string, timezone: string): number | null {
  try {
    const [hour, minute] = time.split(':').map(Number)
    const parts = new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone,
    }).formatToParts(reference)
    const year = Number(parts.find(part => part.type === 'year')?.value)
    const month = Number(parts.find(part => part.type === 'month')?.value) - 1
    const day = Number(parts.find(part => part.type === 'day')?.value)
    if (![year, month, day, hour, minute].every(Number.isFinite)) return null
    const localAsUtc = new Date(Date.UTC(year, month, day, hour, minute))
    const utcString = localAsUtc.toLocaleString('en-US', { timeZone: 'UTC' })
    const zonedString = localAsUtc.toLocaleString('en-US', { timeZone: timezone })
    const offsetMs = new Date(zonedString).getTime() - new Date(utcString).getTime()
    return localAsUtc.getTime() - offsetMs
  }
  catch {
    return null
  }
}

function findNextBoundedCalendarSlot(args: {
  now: number
  after: number
  timezone: string
  morningStart: string
  eveningEnd: string
  preferredDays: Set<number>
  sessionMinutes: number
}): Date | null {
  const dayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: args.timezone })
  const dayMap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
  const durationMs = args.sessionMinutes * 60_000
  for (let dayOffset = 1; dayOffset <= 14; dayOffset++) {
    const reference = new Date(args.now + dayOffset * 86_400_000)
    const dayNumber = dayMap[dayFormatter.format(reference).toLowerCase()]
    if (dayNumber === undefined || !args.preferredDays.has(dayNumber)) continue
    const morning = localTimeOnDate(reference, args.morningStart, args.timezone)
    const evening = localTimeOnDate(reference, args.eveningEnd, args.timezone)
    if (morning === null || evening === null) continue
    let candidate = morning
    while (candidate <= args.after) candidate += durationMs
    if (candidate > args.now && candidate + durationMs <= evening) return new Date(candidate)
  }
  return null
}

export const reserveOperationAndCalendarSlot = internalMutation({
  args: {
    userId: v.string(),
    calendarConnectionId: v.id('calendarConnections'),
    calendarEventId: v.string(),
    courseId: v.id('courses'),
    reason: v.union(v.literal('sync-create'), v.literal('missed-reschedule')),
    operationKey: v.string(),
    notBefore: v.number(),
  },
  handler: async (ctx, args): Promise<{
    cleanupJobId: Id<'calendarEventCleanupJobs'>
    scheduledAt: number
  } | null> => {
    if (await hasAccountDeletionTombstone(ctx, args.userId)) {
      throw new Error('Account deletion is in progress')
    }
    const connection = await ctx.db.get(args.calendarConnectionId)
    if (!connection
      || connection.userId !== args.userId
      || connection.status !== 'connected'
      || !connection.preferences) {
      throw new Error('Active calendar connection with preferences not found')
    }

    const [latestScheduled, latestRescheduled] = await Promise.all([
      ctx.db
        .query('calendarEvents')
        .withIndex('by_userId_and_status_and_scheduledAt', q => q
          .eq('userId', args.userId)
          .eq('status', 'scheduled'))
        .order('desc')
        .first(),
      ctx.db
        .query('calendarEvents')
        .withIndex('by_userId_and_status_and_scheduledAt', q => q
          .eq('userId', args.userId)
          .eq('status', 'rescheduled'))
        .order('desc')
        .first(),
    ])
    const now = Date.now()
    const after = Math.max(
      args.notBefore,
      connection.calendarSlotWatermark ?? 0,
      latestScheduled?.scheduledAt ?? 0,
      latestRescheduled?.scheduledAt ?? 0,
    )
    const slot = findNextBoundedCalendarSlot({
      now,
      after,
      timezone: connection.timezone,
      morningStart: connection.preferences.morningStart,
      eveningEnd: connection.preferences.eveningEnd,
      preferredDays: preferredDayNumbersFromStrings(connection.preferences.preferredDays),
      sessionMinutes: connection.preferences.sessionMinutes,
    })
    if (!slot) return null
    const cleanupJobId = await reserveCalendarCleanup(ctx, {
      userId: args.userId,
      calendarConnectionId: args.calendarConnectionId,
      calendarEventId: args.calendarEventId,
      courseId: args.courseId,
      reason: args.reason,
      operationKey: args.operationKey,
    })
    await ctx.db.patch(connection._id, { calendarSlotWatermark: slot.getTime() })
    return { cleanupJobId, scheduledAt: slot.getTime() }
  },
})

export const listByUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx)
    const events = await ctx.db
      .query('calendarEvents')
      .withIndex('by_userId', q => q.eq('userId', userId))
      .take(200)
    return events.map(({ calendarEventId: _, ...rest }) => rest)
  },
})

export const listByCourse = query({
  args: { courseId: v.id('courses') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const events = await ctx.db
      .query('calendarEvents')
      .withIndex('by_courseId', q => q.eq('courseId', args.courseId))
      .take(100)
    return events.filter(e => e.userId === userId)
  },
})

export const listScheduled = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx)
    const [scheduled, rescheduled] = await Promise.all([
      ctx.db
        .query('calendarEvents')
        .withIndex('by_userId_and_status', q => q.eq('userId', userId).eq('status', 'scheduled'))
        .take(100),
      ctx.db
        .query('calendarEvents')
        .withIndex('by_userId_and_status', q => q.eq('userId', userId).eq('status', 'rescheduled'))
        .take(100),
    ])
    const events = [...scheduled, ...rescheduled].sort((a, b) => a.scheduledAt - b.scheduledAt)
    return events.map(({ calendarEventId: _, ...rest }) => rest)
  },
})

export const create = internalMutation({
  args: {
    userId: v.string(),
    calendarConnectionId: v.id('calendarConnections'),
    calendarEventId: v.string(),
    courseId: v.id('courses'),
    scheduledAt: v.number(),
    sessionType: sessionTypeValidator,
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('calendarEvents', {
      userId: args.userId,
      calendarConnectionId: args.calendarConnectionId,
      calendarEventId: args.calendarEventId,
      courseId: args.courseId,
      scheduledAt: args.scheduledAt,
      sessionType: args.sessionType,
      status: 'scheduled',
      description: args.description,
    })
  },
})

export const commitCreateWithCompensation = internalMutation({
  args: {
    cleanupJobId: v.id('calendarEventCleanupJobs'),
    userId: v.string(),
    calendarConnectionId: v.id('calendarConnections'),
    calendarEventId: v.string(),
    courseId: v.id('courses'),
    scheduledAt: v.number(),
    sessionType: sessionTypeValidator,
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (await hasAccountDeletionTombstone(ctx, args.userId)) {
      throw new Error('Account deletion is in progress')
    }
    const connection = await ctx.db.get(args.calendarConnectionId)
    if (!connection || connection.userId !== args.userId || connection.status !== 'connected') {
      throw new Error('Active calendar connection not found')
    }
    const course = await ctx.db.get(args.courseId)
    if (!course || course.userId !== args.userId || course.status === 'deleting') {
      throw new Error('Active course not found')
    }

    const existing = await ctx.db
      .query('calendarEvents')
      .withIndex('by_calendarConnectionId_and_calendarEventId', q =>
        q.eq('calendarConnectionId', args.calendarConnectionId).eq('calendarEventId', args.calendarEventId),
      )
      .unique()
    if (existing) {
      if (existing.userId !== args.userId || existing.courseId !== args.courseId) {
        throw new Error('Calendar event id is already associated with another event')
      }
      await markCalendarEventManaged(ctx, { ...args, reason: 'sync-create' })
      return existing._id
    }

    const eventId = await ctx.db.insert('calendarEvents', {
      userId: args.userId,
      calendarConnectionId: args.calendarConnectionId,
      calendarEventId: args.calendarEventId,
      courseId: args.courseId,
      scheduledAt: args.scheduledAt,
      sessionType: args.sessionType,
      status: 'scheduled',
      description: args.description,
    })
    await markCalendarEventManaged(ctx, { ...args, reason: 'sync-create' })
    return eventId
  },
})

export const updateStatus = mutation({
  args: {
    eventId: v.id('calendarEvents'),
    status: statusValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const event = await ctx.db.get(args.eventId)
    if (!event || event.userId !== userId) throw new Error('Event not found')
    await ctx.db.patch(args.eventId, { status: args.status })
  },
})

export const deleteByCourse = internalMutation({
  args: { courseId: v.id('courses') },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query('calendarEvents')
      .withIndex('by_courseId', q => q.eq('courseId', args.courseId))
      .take(500)
    for (const event of events) {
      await ctx.db.delete(event._id)
    }
  },
})

export const deleteByUser = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query('calendarEvents')
      .withIndex('by_userId', q => q.eq('userId', args.userId))
      .take(500)
    for (const event of events) {
      await ctx.db.delete(event._id)
    }
  },
})

export const getAllByUserPage = internalQuery({
  args: {
    userId: v.string(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('calendarEvents')
      .withIndex('by_userId', q => q.eq('userId', args.userId))
      .paginate({ cursor: args.cursor, numItems: 100 })
  },
})

export const getDisconnectBatch = internalQuery({
  args: {
    calendarConnectionId: v.id('calendarConnections'),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.calendarConnectionId)
    if (!connection
      || connection.status !== 'disconnecting'
      || connection.disconnectLeaseToken !== args.leaseToken) return []
    return await ctx.db
      .query('calendarEvents')
      .withIndex('by_calendarConnectionId_and_calendarEventId', q =>
        q.eq('calendarConnectionId', connection._id),
      )
      .take(DISCONNECT_BATCH_SIZE)
  },
})

export const getProjectionDisconnectBatch = internalQuery({
  args: { calendarConnectionId: v.id('calendarConnections'), leaseToken: v.string() },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.calendarConnectionId)
    if (!connection || connection.status !== 'disconnecting' || connection.disconnectLeaseToken !== args.leaseToken) {
      return { activeCreate: false, projections: [] }
    }
    const activeCreate = await ctx.db.query('calendarProjections')
      .withIndex('by_connectionId_and_status_and_createLeaseExpiresAt', q => q
        .eq('calendarConnectionId', connection._id)
        .eq('status', 'creating')
        .gt('providerCreateLeaseExpiresAt', Date.now()))
      .first()
    const settlingCreate = activeCreate ? null : await ctx.db.query('calendarProjections')
      .withIndex('by_calendarConnectionId_and_status_and_providerCreateSettleAfter', q => q
        .eq('calendarConnectionId', connection._id)
        .eq('status', 'creating')
        .gt('providerCreateSettleAfter', Date.now()))
      .first()
    const withinGrace = Boolean(settlingCreate)
    const projections = await ctx.db.query('calendarProjections')
      .withIndex('by_calendarConnectionId', q => q.eq('calendarConnectionId', connection._id))
      .take(DISCONNECT_BATCH_SIZE)
    return { activeCreate: Boolean(activeCreate || withinGrace), projections }
  },
})

type DisconnectActionResult = {
  disconnected: boolean
  googleEventsDeleted: number
  googleEventsFailed: number
}

async function runDisconnectForUser(
  ctx: ActionCtx,
  userId: string,
  expectedCalendarConnectionId?: Id<'calendarConnections'>,
): Promise<DisconnectActionResult> {
  const leaseToken = crypto.randomUUID()
  const claim = await ctx.runMutation(internal.calendarConnections.beginDisconnectForUser, {
    userId,
    leaseToken,
    ...(expectedCalendarConnectionId ? { expectedCalendarConnectionId } : {}),
  })
  if (claim.state === 'absent') {
    return { disconnected: true, googleEventsDeleted: 0, googleEventsFailed: 0 }
  }
  if (claim.state === 'busy') {
    return { disconnected: false, googleEventsDeleted: 0, googleEventsFailed: 0 }
  }

  let accessToken: string
  try {
    accessToken = claim.connection.disconnectRevokeStartedAt
      ? await getStoredCalendarAccessToken(claim.connection)
      : await getCalendarAccessToken(ctx, userId, claim.connection)
  }
  catch (error) {
    await ctx.runMutation(internal.calendarConnections.recordDisconnectBatch, {
      calendarConnectionId: claim.connection._id,
      leaseToken,
      deletedEventIds: [],
      failures: 1,
      error: error instanceof Error ? error.message : String(error),
    })
    return { disconnected: false, googleEventsDeleted: 0, googleEventsFailed: 1 }
  }

  // Stop the current V2 channel before deleting managed provider events. Google
  // permits overlapping renewal channels, so only the stored current pair is
  // stopped; a missing/expired channel is already settled.
  const watchChannels: Doc<'calendarWatchChannels'>[] = await ctx.runQuery(internal.learnV2CalendarReconciliation.getWatchStopBatch, { calendarConnectionId: claim.connection._id, includeCurrent: true })
  // Pre-ledger connections retain the legacy pair; once ledgered, stop each
  // durable channel exactly once below.
  if (watchChannels.length === 0 && claim.connection.learnV2WatchChannelId && claim.connection.learnV2WatchResourceId) {
    try {
      const stopped = await fetch('https://www.googleapis.com/calendar/v3/channels/stop', {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: claim.connection.learnV2WatchChannelId, resourceId: claim.connection.learnV2WatchResourceId }), signal: AbortSignal.timeout(15_000),
      })
      if (!stopped.ok && stopped.status !== 404 && stopped.status !== 410) throw new Error(`Google Calendar watch stop failed with status ${stopped.status}`)
      await ctx.runMutation(internal.learnV2CalendarReconciliation.clearStoppedWatch, { calendarConnectionId: claim.connection._id })
    } catch (error) {
      await ctx.runMutation(internal.calendarConnections.recordDisconnectBatch, { calendarConnectionId: claim.connection._id, leaseToken, deletedEventIds: [], failures: 1, error: error instanceof Error ? error.message : String(error) })
      return { disconnected: false, googleEventsDeleted: 0, googleEventsFailed: 1 }
    }
  }
  for (const channel of watchChannels) {
    try {
      const stopped = await fetch('https://www.googleapis.com/calendar/v3/channels/stop', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: channel.channelId, resourceId: channel.resourceId }), signal: AbortSignal.timeout(15_000) })
      if (!stopped.ok && stopped.status !== 404 && stopped.status !== 410) throw new Error(`Google Calendar watch stop failed with status ${stopped.status}`)
      await ctx.runMutation(internal.learnV2CalendarReconciliation.markWatchStopped, { calendarConnectionId: claim.connection._id, channelId: channel.channelId })
    } catch (error) {
      await ctx.runMutation(internal.calendarConnections.recordDisconnectBatch, { calendarConnectionId: claim.connection._id, leaseToken, deletedEventIds: [], failures: 1, error: error instanceof Error ? error.message : String(error) })
      return { disconnected: false, googleEventsDeleted: 0, googleEventsFailed: 1 }
    }
  }

  const events: Doc<'calendarEvents'>[] = await ctx.runQuery(internal.calendarEvents.getDisconnectBatch, {
    calendarConnectionId: claim.connection._id,
    leaseToken,
  })
  const projectionBatch: { activeCreate: boolean, projections: Doc<'calendarProjections'>[] } = await ctx.runQuery(internal.calendarEvents.getProjectionDisconnectBatch, {
    calendarConnectionId: claim.connection._id,
    leaseToken,
  })
  if (projectionBatch.activeCreate) {
    await ctx.runMutation(internal.calendarConnections.recordDisconnectBatch, {
      calendarConnectionId: claim.connection._id,
      leaseToken,
      deletedEventIds: [],
      failures: 1,
      error: 'Waiting for an in-flight calendar projection to settle',
    })
    return { disconnected: false, googleEventsDeleted: 0, googleEventsFailed: 0 }
  }
  const projections = projectionBatch.projections
  const localOnlyProjectionIds = projections.filter(row => !row.externalEventId).map(row => row._id)
  const outcomes = await Promise.all([...events.map(event => ({ id: event._id, externalEventId: event.calendarEventId, kind: 'event' as const })), ...projections.filter((projection): projection is Doc<'calendarProjections'> & { externalEventId: string } => Boolean(projection.externalEventId)).map(projection => ({ id: projection._id, externalEventId: projection.externalEventId, kind: 'projection' as const }))].map(async (row) => {
    try {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(row.externalEventId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(15_000),
        },
      )
      return {
        id: row.id, kind: row.kind,
        ok: response.ok || response.status === 404 || response.status === 410,
        status: response.status,
        error: `Google Calendar delete failed with status ${response.status}`,
      }
    }
    catch (error) {
      return {
        id: row.id, kind: row.kind,
        ok: false,
        status: undefined,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }))
  const deletedEventIds = outcomes.filter(result => result.ok && result.kind === 'event').map(result => result.id as Id<'calendarEvents'>)
  const deletedProjectionIds = [...localOnlyProjectionIds, ...outcomes.filter(result => result.ok && result.kind === 'projection').map(result => result.id as Id<'calendarProjections'>)]
  const failures = outcomes.filter(result => !result.ok)
  if (failures.some(result => result.status === 401)) {
    await ctx.runMutation(internal.calendarConnections.expireAccessTokenForCleanup, {
      calendarConnectionId: claim.connection._id,
      userId,
    })
  }
  const result = await ctx.runMutation(internal.calendarConnections.recordDisconnectBatch, {
    calendarConnectionId: claim.connection._id,
    leaseToken,
    deletedEventIds,
    deletedProjectionIds,
    failures: failures.length,
    ...(failures[0] ? { error: failures[0].error } : {}),
  })
  if (result.state === 'ready_to_revoke') {
    const checkpointed = await ctx.runMutation(internal.calendarConnections.beginOAuthRevoke, { calendarConnectionId: claim.connection._id, leaseToken })
    if (!checkpointed) return { disconnected: false, googleEventsDeleted: deletedEventIds.length + deletedProjectionIds.length, googleEventsFailed: 0 }
    try {
      const revoked = await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: accessToken }), signal: AbortSignal.timeout(15_000) })
      // A checkpoint makes an already-invalid token a settled retry outcome.
      if (revoked.status !== 200 && revoked.status !== 400) throw new Error(`Google OAuth revoke failed with status ${revoked.status}`)
      const finalized = await ctx.runMutation(internal.calendarConnections.finalizeOAuthRevocation, { calendarConnectionId: claim.connection._id, leaseToken })
      return { disconnected: finalized, googleEventsDeleted: deletedEventIds.length + deletedProjectionIds.length, googleEventsFailed: 0 }
    } catch (error) {
      await ctx.runMutation(internal.calendarConnections.recordDisconnectBatch, { calendarConnectionId: claim.connection._id, leaseToken, deletedEventIds: [], failures: 1, error: error instanceof Error ? error.message : String(error) })
      return { disconnected: false, googleEventsDeleted: deletedEventIds.length + deletedProjectionIds.length, googleEventsFailed: 1 }
    }
  }
  return {
    disconnected: false,
    googleEventsDeleted: deletedEventIds.length + deletedProjectionIds.length,
    googleEventsFailed: failures.length,
  }
}

export const disconnectCalendar = action({
  args: {},
  handler: async (ctx): Promise<DisconnectActionResult> => {
    const userId = await requireAuth(ctx)
    return await runDisconnectForUser(ctx, userId)
  },
})

/** Provider-first entry point for account deletion after its auth tombstone exists. */
export const startDisconnectForUser = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, args): Promise<DisconnectActionResult> =>
    await runDisconnectForUser(ctx, args.userId),
})

export const continueDisconnect = internalAction({
  args: { calendarConnectionId: v.id('calendarConnections') },
  handler: async (ctx, args): Promise<DisconnectActionResult> => {
    const connection: Doc<'calendarConnections'> | null = await ctx.runQuery(
      internal.calendarConnections.getConnectionByIdForCleanup,
      { calendarConnectionId: args.calendarConnectionId },
    )
    if (!connection) return { disconnected: true, googleEventsDeleted: 0, googleEventsFailed: 0 }
    return await runDisconnectForUser(ctx, connection.userId, connection._id)
  },
})

type SyncCalendarResult = {
  created: number
  events: Array<{ courseId: string; eventId: string; sessionType: string }>
  failures: number
  message?: string
}

async function syncCalendarPage(
  ctx: ActionCtx,
  args: { userId: string; cursor: string | null; hasDueReviews: boolean; nextSlotAfter: number },
): Promise<SyncCalendarResult> {
    const { userId } = args
    const connection = await ctx.runQuery(internal.calendarConnections.getConnectionByUser, { userId })
    if (!connection) throw new Error('No active calendar connection')
    if (!connection.preferences) throw new Error('Calendar preferences not set')

    const accessToken = await getCalendarAccessToken(ctx, userId, connection)
    const coursePage: { page: Doc<'courses'>[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(
      internal.courses.getCalendarSyncPage,
      { userId, cursor: args.cursor },
    )
    const activeCourses = coursePage.page.filter(
      (course: Doc<'courses'>) => course.status === 'ready' && course.completedSectionCount < course.totalSectionCount,
    )
    const prefs = connection.preferences
    const timezone = connection.timezone
    let nextSlotAfter = args.nextSlotAfter
    const siteUrl = process.env.SITE_URL || process.env.NUXT_PUBLIC_SITE_URL || ''
    const createdEvents: Array<{ courseId: string; eventId: string; sessionType: string }> = []
    let failures = 0

    for (const course of activeCourses) {
      const googleEventId = createGoogleEventId()
      const operationKey = `sync-course:${course._id}`
      const operationAvailable = await ctx.runQuery(internal.calendarEventCleanup.isOperationAvailable, {
        userId,
        calendarConnectionId: connection._id,
        courseId: course._id,
        operationKey,
        reason: 'sync-create',
      })
      if (!operationAvailable) continue
      let cleanupJobId: Id<'calendarEventCleanupJobs'> | null = null
      let reservedStart: number
      try {
        const reservation = await ctx.runMutation(internal.calendarEvents.reserveOperationAndCalendarSlot, {
          userId,
          calendarConnectionId: connection._id,
          calendarEventId: googleEventId,
          courseId: course._id,
          reason: 'sync-create',
          operationKey,
          notBefore: nextSlotAfter,
        })
        if (!reservation) continue
        cleanupJobId = reservation.cleanupJobId
        reservedStart = reservation.scheduledAt
      }
      catch (error) {
        failures++
        console.error(`[syncCalendar] Failed to reserve course ${course._id}:`, error)
        continue
      }
      const startDate = new Date(reservedStart)
      nextSlotAfter = reservedStart

      const sessionType = determineSessionType({
        scheduledHour: getScheduledHourInTimezone(startDate.getTime(), timezone),
        slotMinutes: prefs.sessionMinutes,
        hasDueReviews: args.hasDueReviews,
        hasNewContent: course.completedSectionCount < course.totalSectionCount,
      })
      const title = buildEventTitle(course.title, sessionType)
      const description = buildEventDescription({
        courseName: course.title,
        sessionType,
        slotMinutes: prefs.sessionMinutes,
        deepLink: siteUrl ? `${siteUrl}/app/learn/${course._id}` : '',
      })
      const endDate = new Date(startDate.getTime() + prefs.sessionMinutes * 60_000)

      try {
        const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: googleEventId,
            summary: title,
            description,
            start: { dateTime: startDate.toISOString(), timeZone: timezone },
            end: { dateTime: endDate.toISOString(), timeZone: timezone },
            reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 5 }] },
          }),
          signal: AbortSignal.timeout(30_000),
        })
        if (!response.ok) throw new Error(`Google Calendar create failed with status ${response.status}`)

        await ctx.runMutation(internal.calendarEvents.commitCreateWithCompensation, {
          cleanupJobId,
          userId,
          calendarConnectionId: connection._id,
          calendarEventId: googleEventId,
          courseId: course._id,
          scheduledAt: startDate.getTime(),
          sessionType,
          description,
        })
        createdEvents.push({ courseId: course._id, eventId: googleEventId, sessionType })
      }
      catch (error) {
        failures++
        console.error(`[syncCalendar] Failed to schedule course ${course._id}:`, error)
        if (cleanupJobId) {
          await ctx.runMutation(internal.calendarEventCleanup.expedite, { cleanupJobId })
            .catch(expediteError => console.error(
              `[syncCalendar] Cleanup ${cleanupJobId} remains on its durable fallback schedule:`,
              expediteError,
            ))
        }
      }
    }

    if (!coursePage.isDone) {
      await ctx.scheduler.runAfter(0, internal.calendarEvents.continueSyncCalendar, {
        userId,
        cursor: coursePage.continueCursor,
        hasDueReviews: args.hasDueReviews,
        nextSlotAfter,
      })
    }
    return {
      created: createdEvents.length,
      events: createdEvents,
      failures,
      ...(coursePage.isDone && activeCourses.length === 0
        ? { message: 'No active courses to schedule' }
        : !coursePage.isDone
            ? { message: 'Calendar sync continues in the background' }
            : {}),
    }
}

export const syncCalendar = action({
  args: {},
  handler: async (ctx): Promise<SyncCalendarResult> => {
    const userId = await requireAuth(ctx)
    const dueReviewItems = await ctx.runQuery(api.reviewItems.listDueForUser, {})
    return await syncCalendarPage(ctx, {
      userId,
      cursor: null,
      hasDueReviews: dueReviewItems.length > 0,
      nextSlotAfter: Date.now(),
    })
  },
})

export const continueSyncCalendar = internalAction({
  args: {
    userId: v.string(),
    cursor: v.string(),
    hasDueReviews: v.boolean(),
    nextSlotAfter: v.number(),
  },
  handler: async (ctx, args): Promise<SyncCalendarResult> => await syncCalendarPage(ctx, args),
})

const activeCalendarStatusValidator = v.union(v.literal('scheduled'), v.literal('rescheduled'))

export const getMissedCandidatesPage = internalQuery({
  args: {
    userId: v.string(),
    status: activeCalendarStatusValidator,
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const result = await ctx.db
      .query('calendarEvents')
      .withIndex('by_userId_and_status', q => q.eq('userId', args.userId).eq('status', args.status))
      .paginate({ cursor: args.cursor, numItems: MISSED_EVENT_BATCH_SIZE })

    const missed: Array<{
      eventId: typeof result.page[0]['_id']
      courseId: typeof result.page[0]['courseId']
      calendarConnectionId: typeof result.page[0]['calendarConnectionId']
      sessionType: typeof result.page[0]['sessionType']
    }> = []

    for (const event of result.page) {
      if (event.scheduledAt < now) {
        missed.push({
          eventId: event._id,
          courseId: event.courseId,
          calendarConnectionId: event.calendarConnectionId,
          sessionType: event.sessionType,
        })
      }
    }

    return { missed, isDone: result.isDone, continueCursor: result.continueCursor }
  },
})

export const commitReschedule = internalMutation({
  args: {
    missedEventId: v.id('calendarEvents'),
    userId: v.string(),
    calendarConnectionId: v.id('calendarConnections'),
    calendarEventId: v.string(),
    courseId: v.id('courses'),
    scheduledAt: v.number(),
    sessionType: sessionTypeValidator,
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (await hasAccountDeletionTombstone(ctx, args.userId)) {
      throw new Error('Account deletion is in progress')
    }
    const connection = await ctx.db.get(args.calendarConnectionId)
    if (!connection || connection.userId !== args.userId || connection.status !== 'connected') {
      throw new Error('Active calendar connection not found')
    }
    const missedEvent = await ctx.db.get(args.missedEventId)
    if (!missedEvent
      || missedEvent.userId !== args.userId
      || (missedEvent.status !== 'scheduled' && missedEvent.status !== 'rescheduled')) {
      throw new Error('Missed calendar event is no longer eligible for rescheduling')
    }
    const course = await ctx.db.get(args.courseId)
    if (!course || course.userId !== args.userId || course.status === 'deleting') {
      throw new Error('Active course not found')
    }
    await ctx.db.patch(missedEvent._id, { status: 'missed' })
    return await ctx.db.insert('calendarEvents', {
      userId: args.userId,
      calendarConnectionId: args.calendarConnectionId,
      calendarEventId: args.calendarEventId,
      courseId: args.courseId,
      scheduledAt: args.scheduledAt,
      sessionType: args.sessionType,
      status: 'rescheduled',
      description: args.description,
    })
  },
})

export const commitRescheduleWithCompensation = internalMutation({
  args: {
    cleanupJobId: v.id('calendarEventCleanupJobs'),
    missedEventId: v.id('calendarEvents'),
    userId: v.string(),
    calendarConnectionId: v.id('calendarConnections'),
    calendarEventId: v.string(),
    courseId: v.id('courses'),
    scheduledAt: v.number(),
    sessionType: sessionTypeValidator,
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (await hasAccountDeletionTombstone(ctx, args.userId)) {
      throw new Error('Account deletion is in progress')
    }
    const connection = await ctx.db.get(args.calendarConnectionId)
    if (!connection || connection.userId !== args.userId || connection.status !== 'connected') {
      throw new Error('Active calendar connection not found')
    }
    const course = await ctx.db.get(args.courseId)
    if (!course || course.userId !== args.userId || course.status === 'deleting') {
      throw new Error('Active course not found')
    }
    const existing = await ctx.db
      .query('calendarEvents')
      .withIndex('by_calendarConnectionId_and_calendarEventId', q =>
        q.eq('calendarConnectionId', args.calendarConnectionId).eq('calendarEventId', args.calendarEventId),
      )
      .unique()
    if (existing) {
      if (existing.userId !== args.userId || existing.courseId !== args.courseId) {
        throw new Error('Calendar event id is already associated with another event')
      }
      await markCalendarEventManaged(ctx, { ...args, reason: 'missed-reschedule' })
      return existing._id
    }

    const missedEvent = await ctx.db.get(args.missedEventId)
    if (!missedEvent
      || missedEvent.userId !== args.userId
      || (missedEvent.status !== 'scheduled' && missedEvent.status !== 'rescheduled')) {
      throw new Error('Missed calendar event is no longer eligible for rescheduling')
    }
    if (missedEvent.calendarConnectionId !== args.calendarConnectionId
      || missedEvent.courseId !== args.courseId) {
      throw new Error('Missed calendar event does not match the replacement')
    }
    await ctx.db.patch(missedEvent._id, { status: 'missed' })
    const eventId = await ctx.db.insert('calendarEvents', {
      userId: args.userId,
      calendarConnectionId: args.calendarConnectionId,
      calendarEventId: args.calendarEventId,
      courseId: args.courseId,
      scheduledAt: args.scheduledAt,
      sessionType: args.sessionType,
      status: 'rescheduled',
      description: args.description,
    })
    await markCalendarEventManaged(ctx, { ...args, reason: 'missed-reschedule' })
    return eventId
  },
})

export const createRescheduled = internalMutation({
  args: {
    userId: v.string(),
    calendarConnectionId: v.id('calendarConnections'),
    calendarEventId: v.string(),
    courseId: v.id('courses'),
    scheduledAt: v.number(),
    sessionType: sessionTypeValidator,
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('calendarEvents', {
      userId: args.userId,
      calendarConnectionId: args.calendarConnectionId,
      calendarEventId: args.calendarEventId,
      courseId: args.courseId,
      scheduledAt: args.scheduledAt,
      sessionType: args.sessionType,
      status: 'rescheduled',
      description: args.description,
    })
  },
})

export const checkMissedSessionsForUser = internalAction({
  args: {
    userId: v.string(),
    status: activeCalendarStatusValidator,
    cursor: v.union(v.string(), v.null()),
    nextSlotAfter: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
      const { userId } = args
      const page = await ctx.runQuery(internal.calendarEvents.getMissedCandidatesPage, {
        userId,
        status: args.status,
        cursor: args.cursor,
      })
      const missed = page.missed
      const connection = await ctx.runQuery(internal.calendarConnections.getConnectionByUser, { userId })
      if (!connection || !connection.preferences) return

      const siteUrl = process.env.SITE_URL || process.env.NUXT_PUBLIC_SITE_URL || ''

      let accessToken: string
      try {
        accessToken = await getCalendarAccessToken(ctx, userId, connection)
      }
      catch (error) {
        console.error(`[checkMissedSessions] Token preparation failed for ${userId}:`, error)
        return
      }

      const prefs = connection.preferences
      const timezone = connection.timezone
      const now = Date.now()
      let nextSlotAfter = args.nextSlotAfter ?? now

      for (const missedEvent of missed) {
        const googleEventId = createGoogleEventId()
        const operationKey = `reschedule-event:${missedEvent.eventId}`
        const operationAvailable = await ctx.runQuery(internal.calendarEventCleanup.isOperationAvailable, {
          userId,
          calendarConnectionId: connection._id,
          courseId: missedEvent.courseId,
          operationKey,
          reason: 'missed-reschedule',
        })
        if (!operationAvailable) continue
        let cleanupJobId: Id<'calendarEventCleanupJobs'> | null = null
        let reservedStart: number
        try {
          const reservation = await ctx.runMutation(internal.calendarEvents.reserveOperationAndCalendarSlot, {
            userId,
            calendarConnectionId: connection._id,
            calendarEventId: googleEventId,
            courseId: missedEvent.courseId,
            reason: 'missed-reschedule',
            operationKey,
            notBefore: nextSlotAfter,
          })
          if (!reservation) continue
          cleanupJobId = reservation.cleanupJobId
          reservedStart = reservation.scheduledAt
        }
        catch (error) {
          console.error(`[checkMissedSessions] Failed to reserve replacement for ${missedEvent.courseId}:`, error)
          continue
        }
        const nextSlot = new Date(reservedStart)
        nextSlotAfter = reservedStart

        const endTime = new Date(nextSlot.getTime() + prefs.sessionMinutes * 60_000)

        const course = await ctx.runQuery(internal.courses.getById, { courseId: missedEvent.courseId })
        if (!course) continue
        const courseName = course.title

        const typeLabel = missedEvent.sessionType === 'new-content'
          ? 'New Content'
          : missedEvent.sessionType === 'review'
            ? 'Review'
            : 'Audio Only'

        const title = `[Budds] ${courseName} - ${typeLabel}`
        const deepLink = siteUrl ? `${siteUrl}/app/learn/${missedEvent.courseId}` : ''
        const description = [
          `${prefs.sessionMinutes} min ${missedEvent.sessionType === 'new-content' ? 'new content' : missedEvent.sessionType === 'review' ? 'review' : 'audio-only'} session (rescheduled)`,
          `Course: ${courseName}`,
          '',
          deepLink,
        ].join('\n')

        try {
          const calRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              id: googleEventId,
              summary: title,
              description,
              start: { dateTime: nextSlot.toISOString(), timeZone: timezone },
              end: { dateTime: endTime.toISOString(), timeZone: timezone },
              reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 5 }] },
            }),
            signal: AbortSignal.timeout(30_000),
          })

          if (!calRes.ok) {
            throw new Error(`Google Calendar create failed with status ${calRes.status}`)
          }

          await ctx.runMutation(internal.calendarEvents.commitRescheduleWithCompensation, {
            cleanupJobId,
            missedEventId: missedEvent.eventId,
            userId,
            calendarConnectionId: missedEvent.calendarConnectionId,
            calendarEventId: googleEventId,
            courseId: missedEvent.courseId,
            scheduledAt: nextSlot.getTime(),
            sessionType: missedEvent.sessionType,
            description,
          })
        }
        catch (err) {
          console.error(`[checkMissedSessions] Failed to reschedule event for course ${missedEvent.courseId}:`, err)
          if (cleanupJobId) {
            await ctx.runMutation(internal.calendarEventCleanup.expedite, { cleanupJobId })
              .catch(expediteError => console.error(
                `[checkMissedSessions] Cleanup ${cleanupJobId} remains on its durable fallback schedule:`,
                expediteError,
              ))
          }
        }
      }
      if (!page.isDone) {
        await ctx.scheduler.runAfter(0, internal.calendarEvents.checkMissedSessionsForUser, {
          ...args,
          cursor: page.continueCursor,
          nextSlotAfter,
        })
      }
      else if (args.status === 'scheduled') {
        await ctx.scheduler.runAfter(0, internal.calendarEvents.checkMissedSessionsForUser, {
          userId,
          status: 'rescheduled',
          cursor: null,
          nextSlotAfter,
        })
      }
  },
})

export const checkMissedSessions = internalAction({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args): Promise<{ usersScheduled: number; hasMore: boolean }> => {
    const page: { userIds: string[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(
      internal.calendarConnections.getConnectedUserPage,
      {
      cursor: args.cursor ?? null,
      },
    )
    for (const userId of page.userIds) {
      await ctx.scheduler.runAfter(0, internal.calendarEvents.checkMissedSessionsForUser, {
        userId,
        status: 'scheduled',
        cursor: null,
        nextSlotAfter: Date.now(),
      })
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.calendarEvents.checkMissedSessions, {
        cursor: page.continueCursor,
      })
    }
    return { usersScheduled: page.userIds.length, hasMore: !page.isDone }
  },
})
