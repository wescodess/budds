import { v } from 'convex/values'
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from './_generated/server'
import { internal } from './_generated/api'
import { getCalendarAccessToken } from './lib/calendarTokenRuntime'
import type { Doc, Id } from './_generated/dataModel'
import { hasAccountDeletionTombstone } from './lib/accountDeletionTombstone'

const INITIAL_CLEANUP_DELAY_MS = 2 * 60_000
const CLAIM_LEASE_MS = 60_000
const MAX_ATTEMPTS = 8
const BASE_BACKOFF_MS = 30_000
const MAX_BACKOFF_MS = 60 * 60_000
const SWEEP_BATCH_SIZE = 25
const TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60_000

const reasonValidator = v.union(
  v.literal('sync-create'),
  v.literal('missed-reschedule'),
)

function retryDelayMs(attempts: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.min(retryAfterMs, MAX_BACKOFF_MS)
  }
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS)
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get('retry-after')
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return undefined
  return Math.max(0, timestamp - Date.now())
}

async function isRetryableGoogle403(response: Response): Promise<boolean> {
  if (response.status !== 403) return false
  try {
    const body = await response.clone().json() as {
      error?: { errors?: Array<{ reason?: string }>; status?: string }
    }
    const reasons = new Set(body.error?.errors?.map(error => error.reason).filter(Boolean) ?? [])
    return body.error?.status === 'RESOURCE_EXHAUSTED'
      || reasons.has('rateLimitExceeded')
      || reasons.has('userRateLimitExceeded')
      || reasons.has('quotaExceeded')
      || reasons.has('dailyLimitExceeded')
  }
  catch {
    return false
  }
}

type CalendarCleanupReservationArgs = {
  userId: string
  calendarConnectionId: Id<'calendarConnections'>
  calendarEventId: string
  courseId: Id<'courses'>
  reason: 'sync-create' | 'missed-reschedule'
  operationKey?: string
}

export async function reserveCalendarCleanup(
  ctx: MutationCtx,
  args: CalendarCleanupReservationArgs,
): Promise<Id<'calendarEventCleanupJobs'>> {
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

    const operationReservations: Doc<'calendarEventCleanupJobs'>[] = []
    if (args.operationKey) {
      operationReservations.push(...await ctx.db
        .query('calendarEventCleanupJobs')
        .withIndex('by_calendarConnectionId_and_operationKey', q =>
          q.eq('calendarConnectionId', args.calendarConnectionId).eq('operationKey', args.operationKey),
        )
        .order('desc')
        .take(20))
    }
    if (args.reason === 'sync-create') {
      operationReservations.push(...await ctx.db
        .query('calendarEventCleanupJobs')
        .withIndex('by_calendarConnectionId_and_courseId_and_reason', q => q
          .eq('calendarConnectionId', args.calendarConnectionId)
          .eq('courseId', args.courseId)
          .eq('reason', 'sync-create'))
        .order('desc')
        .take(20))
    }
    for (const reservation of new Map(operationReservations.map(row => [row._id, row])).values()) {
      if (reservation.calendarEventId === args.calendarEventId) continue
      if (reservation.status === 'pending'
        || reservation.status === 'deleting'
        || reservation.status === 'dead_letter') {
        throw new Error('Calendar operation already has an unresolved external reservation')
      }
      if (reservation.status === 'managed') {
        const managedEvent = await ctx.db
          .query('calendarEvents')
          .withIndex('by_calendarConnectionId_and_calendarEventId', q => q
            .eq('calendarConnectionId', args.calendarConnectionId)
            .eq('calendarEventId', reservation.calendarEventId))
          .unique()
        if (managedEvent && (managedEvent.status === 'scheduled' || managedEvent.status === 'rescheduled')) {
          throw new Error('Calendar operation is already managed by an active event')
        }
      }
    }

    if (args.reason === 'sync-create') {
      const activeCourseEvent = await ctx.db
        .query('calendarEvents')
        .withIndex('by_courseId', q => q.eq('courseId', args.courseId))
        .filter(q => q.and(
          q.eq(q.field('userId'), args.userId),
          q.eq(q.field('calendarConnectionId'), args.calendarConnectionId),
          q.or(
            q.eq(q.field('status'), 'scheduled'),
            q.eq(q.field('status'), 'rescheduled'),
          ),
        ))
        .first()
      if (activeCourseEvent) throw new Error('Course already has an active calendar event')
    }

    const existing = await ctx.db
      .query('calendarEventCleanupJobs')
      .withIndex('by_calendarConnectionId_and_calendarEventId', q =>
        q.eq('calendarConnectionId', args.calendarConnectionId).eq('calendarEventId', args.calendarEventId),
      )
      .unique()
    if (existing) {
      if (existing.userId !== args.userId
        || existing.courseId !== args.courseId
        || existing.reason !== args.reason) {
        throw new Error('Calendar event id is already reserved for another operation')
      }
      if (existing.status !== 'pending') {
        throw new Error('Calendar event cleanup reservation is no longer reusable')
      }
      return existing._id
    }

    const now = Date.now()
    const cleanupJobId = await ctx.db.insert('calendarEventCleanupJobs', {
      ...args,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: now + INITIAL_CLEANUP_DELAY_MS,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.scheduler.runAfter(
      INITIAL_CLEANUP_DELAY_MS,
      internal.calendarEventCleanup.processOne,
      { cleanupJobId },
    )
    return cleanupJobId
}

export const reserve = internalMutation({
  args: {
    userId: v.string(),
    calendarConnectionId: v.id('calendarConnections'),
    calendarEventId: v.string(),
    courseId: v.id('courses'),
    reason: reasonValidator,
    operationKey: v.optional(v.string()),
  },
  handler: reserveCalendarCleanup,
})

export const getStatus = internalQuery({
  args: { cleanupJobId: v.id('calendarEventCleanupJobs') },
  handler: async (ctx, args): Promise<Doc<'calendarEventCleanupJobs'> | null> =>
    await ctx.db.get(args.cleanupJobId),
})

export const isOperationAvailable = internalQuery({
  args: {
    userId: v.string(),
    calendarConnectionId: v.id('calendarConnections'),
    courseId: v.id('courses'),
    operationKey: v.string(),
    reason: reasonValidator,
  },
  handler: async (ctx, args): Promise<boolean> => {
    const connection = await ctx.db.get(args.calendarConnectionId)
    if (!connection || connection.userId !== args.userId || connection.status !== 'connected') return false
    const reservations: Doc<'calendarEventCleanupJobs'>[] = await ctx.db
      .query('calendarEventCleanupJobs')
      .withIndex('by_calendarConnectionId_and_operationKey', q => q
        .eq('calendarConnectionId', args.calendarConnectionId)
        .eq('operationKey', args.operationKey))
      .order('desc')
      .take(20)
    if (args.reason === 'sync-create') {
      reservations.push(...await ctx.db
        .query('calendarEventCleanupJobs')
        .withIndex('by_calendarConnectionId_and_courseId_and_reason', q => q
          .eq('calendarConnectionId', args.calendarConnectionId)
          .eq('courseId', args.courseId)
          .eq('reason', 'sync-create'))
        .order('desc')
        .take(20))
    }
    if (reservations.some(row => row.status === 'pending'
      || row.status === 'deleting'
      || row.status === 'dead_letter')) return false
    for (const reservation of reservations.filter(row => row.status === 'managed')) {
      const event = await ctx.db
        .query('calendarEvents')
        .withIndex('by_calendarConnectionId_and_calendarEventId', q => q
          .eq('calendarConnectionId', args.calendarConnectionId)
          .eq('calendarEventId', reservation.calendarEventId))
        .unique()
      if (event && (event.status === 'scheduled' || event.status === 'rescheduled')) return false
    }
    if (args.reason === 'sync-create') {
      const activeEvent = await ctx.db
        .query('calendarEvents')
        .withIndex('by_courseId', q => q.eq('courseId', args.courseId))
        .filter(q => q.and(
          q.eq(q.field('userId'), args.userId),
          q.eq(q.field('calendarConnectionId'), args.calendarConnectionId),
          q.or(q.eq(q.field('status'), 'scheduled'), q.eq(q.field('status'), 'rescheduled')),
        ))
        .first()
      if (activeEvent) return false
    }
    return true
  },
})

type ClaimedCleanup = {
  cleanupJobId: Id<'calendarEventCleanupJobs'>
  userId: string
  calendarConnectionId: Id<'calendarConnections'>
  calendarEventId: string
  attempt: number
}

export const claim = internalMutation({
  args: { cleanupJobId: v.id('calendarEventCleanupJobs') },
  handler: async (ctx, args): Promise<ClaimedCleanup | null> => {
    const job = await ctx.db.get(args.cleanupJobId)
    if (!job || job.status !== 'pending' || job.nextAttemptAt > Date.now()) return null

    if (job.attempts >= MAX_ATTEMPTS) {
      const now = Date.now()
      await ctx.db.patch(job._id, {
        status: 'dead_letter',
        lastError: job.lastError ?? 'Calendar cleanup exhausted its retry budget',
        updatedAt: now,
        completedAt: now,
      })
      return null
    }

    const now = Date.now()
    const attempt = job.attempts + 1
    await ctx.db.patch(job._id, {
      status: 'deleting',
      attempts: attempt,
      lastAttemptAt: now,
      leaseExpiresAt: now + CLAIM_LEASE_MS,
      updatedAt: now,
    })
    return {
      cleanupJobId: job._id,
      userId: job.userId,
      calendarConnectionId: job.calendarConnectionId,
      calendarEventId: job.calendarEventId,
      attempt,
    }
  },
})

export const recordSuccess = internalMutation({
  args: {
    cleanupJobId: v.id('calendarEventCleanupJobs'),
    attempt: v.number(),
    httpStatus: v.number(),
    resolution: v.union(v.literal('deleted'), v.literal('already_absent')),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.cleanupJobId)
    if (!job || job.status !== 'deleting' || job.attempts !== args.attempt) return false
    const now = Date.now()
    await ctx.db.patch(job._id, {
      status: 'resolved',
      resolution: args.resolution,
      lastHttpStatus: args.httpStatus,
      updatedAt: now,
      completedAt: now,
    })
    return true
  },
})

export const recordFailure = internalMutation({
  args: {
    cleanupJobId: v.id('calendarEventCleanupJobs'),
    attempt: v.number(),
    error: v.string(),
    retryable: v.boolean(),
    httpStatus: v.optional(v.number()),
    retryAfterMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<'dead_letter' | 'pending' | null> => {
    const job = await ctx.db.get(args.cleanupJobId)
    if (!job || job.status !== 'deleting' || job.attempts !== args.attempt) return null

    const now = Date.now()
    if (!args.retryable || args.attempt >= MAX_ATTEMPTS) {
      await ctx.db.patch(job._id, {
        status: 'dead_letter',
        lastError: args.error.slice(0, 500),
        ...(args.httpStatus === undefined ? {} : { lastHttpStatus: args.httpStatus }),
        updatedAt: now,
        completedAt: now,
      })
      return 'dead_letter' as const
    }

    const delayMs = retryDelayMs(args.attempt, args.retryAfterMs)
    await ctx.db.patch(job._id, {
      status: 'pending',
      nextAttemptAt: now + delayMs,
      lastError: args.error.slice(0, 500),
      ...(args.httpStatus === undefined ? {} : { lastHttpStatus: args.httpStatus }),
      updatedAt: now,
    })
    await ctx.scheduler.runAfter(delayMs, internal.calendarEventCleanup.processOne, {
      cleanupJobId: job._id,
    })
    return 'pending' as const
  },
})

export const expedite = internalMutation({
  args: { cleanupJobId: v.id('calendarEventCleanupJobs') },
  handler: async (ctx, args): Promise<boolean> => {
    const job = await ctx.db.get(args.cleanupJobId)
    if (!job || job.status !== 'pending') return false
    const now = Date.now()
    await ctx.db.patch(job._id, { nextAttemptAt: now, updatedAt: now })
    await ctx.scheduler.runAfter(0, internal.calendarEventCleanup.processOne, {
      cleanupJobId: job._id,
    })
    return true
  },
})

export const processOne = internalAction({
  args: { cleanupJobId: v.id('calendarEventCleanupJobs') },
  handler: async (ctx, args): Promise<'skipped' | 'resolved' | 'pending' | 'dead_letter'> => {
    const claimed: ClaimedCleanup | null = await ctx.runMutation(
      internal.calendarEventCleanup.claim,
      args,
    )
    if (!claimed) return 'skipped'

    try {
      const connection: Doc<'calendarConnections'> | null = await ctx.runQuery(
        internal.calendarConnections.getConnectionByIdForCleanup,
        { calendarConnectionId: claimed.calendarConnectionId },
      )
      if (!connection || connection.userId !== claimed.userId) {
        await ctx.runMutation(internal.calendarEventCleanup.recordFailure, {
          cleanupJobId: claimed.cleanupJobId,
          attempt: claimed.attempt,
          error: 'Calendar connection is unavailable for external cleanup',
          retryable: false,
        })
        return 'dead_letter'
      }

      const accessToken = await getCalendarAccessToken(ctx, claimed.userId, connection)
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(claimed.calendarEventId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(15_000),
        },
      )

      if (response.ok || response.status === 404 || response.status === 410) {
        await ctx.runMutation(internal.calendarEventCleanup.recordSuccess, {
          cleanupJobId: claimed.cleanupJobId,
          attempt: claimed.attempt,
          httpStatus: response.status,
          resolution: response.ok ? 'deleted' : 'already_absent',
        })
        return 'resolved'
      }

      const retryable403 = await isRetryableGoogle403(response)
      const retryable = response.status === 408
        || response.status === 409
        || response.status === 425
        || response.status === 429
        || response.status >= 500
        || response.status === 401
        || retryable403
      if (response.status === 401) {
        await ctx.runMutation(internal.calendarConnections.expireAccessTokenForCleanup, {
          calendarConnectionId: claimed.calendarConnectionId,
          userId: claimed.userId,
        })
      }
      const providerRetryAfterMs = retryAfterMs(response)
      const status = await ctx.runMutation(internal.calendarEventCleanup.recordFailure, {
        cleanupJobId: claimed.cleanupJobId,
        attempt: claimed.attempt,
        error: `Google Calendar cleanup failed with status ${response.status}`,
        retryable,
        httpStatus: response.status,
        ...(providerRetryAfterMs === undefined ? {} : { retryAfterMs: providerRetryAfterMs }),
      })
      return status ?? 'skipped'
    }
    catch (error) {
      const status = await ctx.runMutation(internal.calendarEventCleanup.recordFailure, {
        cleanupJobId: claimed.cleanupJobId,
        attempt: claimed.attempt,
        error: boundedError(error),
        retryable: true,
      })
      return status ?? 'skipped'
    }
  },
})

export const sweepDue = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ expiredClaims: number; due: number }> => {
    const now = Date.now()
    const expiredClaims = await ctx.db
      .query('calendarEventCleanupJobs')
      .withIndex('by_status_and_leaseExpiresAt', q =>
        q.eq('status', 'deleting').lte('leaseExpiresAt', now),
      )
      .take(SWEEP_BATCH_SIZE)

    for (const job of expiredClaims) {
      await ctx.db.patch(job._id, { status: 'pending', nextAttemptAt: now, updatedAt: now })
      await ctx.scheduler.runAfter(0, internal.calendarEventCleanup.processOne, {
        cleanupJobId: job._id,
      })
    }
    if (expiredClaims.length > 0) {
      return { expiredClaims: expiredClaims.length, due: 0 }
    }

    const due = await ctx.db
      .query('calendarEventCleanupJobs')
      .withIndex('by_status_and_nextAttemptAt', q =>
        q.eq('status', 'pending').lte('nextAttemptAt', now),
      )
      .take(SWEEP_BATCH_SIZE)
    for (const job of due) {
      await ctx.scheduler.runAfter(0, internal.calendarEventCleanup.processOne, {
        cleanupJobId: job._id,
      })
    }
    return { expiredClaims: expiredClaims.length, due: due.length }
  },
})

export const retryDeadLetter = internalMutation({
  args: { cleanupJobId: v.id('calendarEventCleanupJobs') },
  handler: async (ctx, args): Promise<boolean> => {
    const job = await ctx.db.get(args.cleanupJobId)
    if (!job || job.status !== 'dead_letter') return false
    const now = Date.now()
    await ctx.db.patch(job._id, {
      status: 'pending',
      attempts: 0,
      nextAttemptAt: now,
      updatedAt: now,
    })
    await ctx.scheduler.runAfter(0, internal.calendarEventCleanup.processOne, {
      cleanupJobId: job._id,
    })
    return true
  },
})

export const purgeTerminal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - TERMINAL_RETENTION_MS
    const managed = await ctx.db
      .query('calendarEventCleanupJobs')
      .withIndex('by_status_and_completedAt', q =>
        q.eq('status', 'managed').lte('completedAt', cutoff),
      )
      .take(50)
    const resolved = await ctx.db
      .query('calendarEventCleanupJobs')
      .withIndex('by_status_and_completedAt', q =>
        q.eq('status', 'resolved').lte('completedAt', cutoff),
      )
      .take(50)
    for (const job of [...managed, ...resolved]) await ctx.db.delete(job._id)
    return { deleted: managed.length + resolved.length }
  },
})

export async function markCalendarEventManaged(
  ctx: MutationCtx,
  args: {
    cleanupJobId: Id<'calendarEventCleanupJobs'>
    userId: string
    calendarConnectionId: Id<'calendarConnections'>
    calendarEventId: string
    courseId: Id<'courses'>
    reason: 'sync-create' | 'missed-reschedule'
  },
): Promise<void> {
  const job = await ctx.db.get(args.cleanupJobId)
  if (!job
    || job.userId !== args.userId
    || job.calendarConnectionId !== args.calendarConnectionId
    || job.calendarEventId !== args.calendarEventId
    || job.courseId !== args.courseId
    || job.reason !== args.reason) {
    throw new Error('Calendar cleanup reservation does not match the event commit')
  }
  if (job.status === 'managed') return
  if (job.status !== 'pending') {
    throw new Error('Calendar cleanup already claimed the external event')
  }
  const now = Date.now()
  await ctx.db.patch(job._id, { status: 'managed', updatedAt: now, completedAt: now })
}

export async function assertCalendarCleanupSettled(
  ctx: MutationCtx,
  calendarConnectionId: Id<'calendarConnections'>,
): Promise<void> {
  for (const status of ['pending', 'deleting', 'dead_letter'] as const) {
    const unresolved = await ctx.db
      .query('calendarEventCleanupJobs')
      .withIndex('by_calendarConnectionId_and_status', q =>
        q.eq('calendarConnectionId', calendarConnectionId).eq('status', status),
      )
      .first()
    if (unresolved) {
      throw new Error('Calendar external cleanup must finish before disconnecting')
    }
  }
}
