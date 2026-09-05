import { v } from 'convex/values'
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
} from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { hasAccountDeletionTombstone } from './lib/accountDeletionTombstone'
import { getCalendarAccessToken } from './lib/calendarTokenRuntime'
import { scheduleAudioOverviewDeletion } from './audioOverviews'

const LOCAL_BATCH_SIZE = 8
const PROVIDER_BATCH_SIZE = 8
const LEASE_MS = 3 * 60_000
const STALE_JOB_MS = 15 * 60_000
const BASE_RETRY_MS = 30_000
const MAX_RETRY_MS = 60 * 60_000

type CourseDeletionJob = Doc<'courseDeletionJobs'>
type CourseDeletionPhase = CourseDeletionJob['phase']

type StepResult = {
  state: 'progress' | 'waiting' | 'retrying' | 'complete' | 'delegated'
  phase?: CourseDeletionPhase
  error?: string
}

export type CourseDeletionRunResult = {
  deleted: boolean
  pending: boolean
  error?: string
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

function retryDelayMs(attempts: number): number {
  return Math.min(BASE_RETRY_MS * 2 ** Math.max(0, attempts - 1), MAX_RETRY_MS)
}

async function scheduleNext(ctx: MutationCtx, jobId: Id<'courseDeletionJobs'>, delayMs = 0) {
  await ctx.scheduler.runAfter(delayMs, internal.courseDeletion.process, { jobId })
}

async function patchPhase(
  ctx: MutationCtx,
  job: CourseDeletionJob,
  phase: CourseDeletionPhase,
) {
  await ctx.db.patch(job._id, {
    phase,
    attempts: 0,
    nextAttemptAt: Date.now(),
    leaseToken: undefined,
    leaseExpiresAt: undefined,
    lastError: undefined,
    updatedAt: Date.now(),
  })
  await scheduleNext(ctx, job._id)
}

async function continueJob(ctx: MutationCtx, job: CourseDeletionJob) {
  await ctx.db.patch(job._id, { updatedAt: Date.now() })
  await scheduleNext(ctx, job._id)
}

export const start = internalMutation({
  args: { courseId: v.id('courses'), userId: v.string() },
  handler: async (ctx, args): Promise<Id<'courseDeletionJobs'>> => {
    if (await hasAccountDeletionTombstone(ctx, args.userId)) {
      throw new Error('Account deletion is in progress')
    }
    const course = await ctx.db.get(args.courseId)
    if (!course || course.userId !== args.userId) throw new Error('Course not found')

    const existing = await ctx.db
      .query('courseDeletionJobs')
      .withIndex('by_courseId', q => q.eq('courseId', args.courseId))
      .unique()
    if (existing) {
      if (course.status !== 'deleting') {
        await ctx.db.patch(course._id, { status: 'deleting', updatedAt: Date.now() })
      }
      await scheduleNext(ctx, existing._id)
      return existing._id
    }

    const now = Date.now()
    await ctx.db.patch(course._id, { status: 'deleting', updatedAt: now })
    const jobId = await ctx.db.insert('courseDeletionJobs', {
      userId: args.userId,
      courseId: args.courseId,
      status: 'active',
      phase: 'settleCalendarCleanup',
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    })
    await scheduleNext(ctx, jobId)
    return jobId
  },
})

export const get = internalQuery({
  args: { jobId: v.id('courseDeletionJobs') },
  handler: async (ctx, args): Promise<CourseDeletionJob | null> => await ctx.db.get(args.jobId),
})

async function processQuizReference(
  ctx: MutationCtx,
  job: CourseDeletionJob,
  entityId: string,
): Promise<boolean> {
  const quizId = ctx.db.normalizeId('quizzes', entityId)
  if (!quizId) return false
  const quiz = await ctx.db.get(quizId)
  if (!quiz || quiz.userId !== job.userId || quiz.courseScoped !== true) return false

  const attempt = await ctx.db
    .query('quizAttempts')
    .withIndex('by_quizId', q => q.eq('quizId', quiz._id))
    .first()
  if (attempt) {
    if (attempt.userId !== job.userId) throw new Error('Course quiz attempt ownership mismatch')
    const answers = await ctx.db
      .query('attemptAnswers')
      .withIndex('by_attemptId', q => q.eq('attemptId', attempt._id))
      .take(LOCAL_BATCH_SIZE)
    for (const answer of answers) await ctx.db.delete(answer._id)
    if (answers.length === 0) await ctx.db.delete(attempt._id)
    return true
  }

  const questions = await ctx.db
    .query('quizQuestions')
    .withIndex('by_quizId', q => q.eq('quizId', quiz._id))
    .take(LOCAL_BATCH_SIZE)
  for (const question of questions) {
    if (question.userId !== job.userId) throw new Error('Course quiz question ownership mismatch')
    await ctx.db.delete(question._id)
  }
  if (questions.length > 0) return true

  await ctx.db.delete(quiz._id)
  return true
}

async function processFlashcardReference(
  ctx: MutationCtx,
  job: CourseDeletionJob,
  entityId: string,
): Promise<boolean> {
  const roomId = ctx.db.normalizeId('flashcardRooms', entityId)
  if (!roomId) return false
  const room = await ctx.db.get(roomId)
  if (!room || room.userId !== job.userId || room.courseScoped !== true) return false

  const cards = await ctx.db
    .query('flashcardRoomCards')
    .withIndex('by_roomId', q => q.eq('roomId', room._id))
    .take(LOCAL_BATCH_SIZE)
  for (const card of cards) {
    if (card.userId !== job.userId) throw new Error('Course flashcard ownership mismatch')
    await ctx.db.delete(card._id)
  }
  if (cards.length > 0) return true

  const version = await ctx.db
    .query('flashcardRoomVersions')
    .withIndex('by_roomId', q => q.eq('roomId', room._id))
    .first()
  if (version) {
    if (version.userId !== job.userId) throw new Error('Course flashcard version ownership mismatch')
    const versionCards = await ctx.db
      .query('flashcardVersionCards')
      .withIndex('by_versionId', q => q.eq('versionId', version._id))
      .take(LOCAL_BATCH_SIZE)
    for (const card of versionCards) {
      if (card.userId !== job.userId) throw new Error('Course flashcard version card ownership mismatch')
      await ctx.db.delete(card._id)
    }
    if (versionCards.length === 0) await ctx.db.delete(version._id)
    return true
  }

  await ctx.db.delete(room._id)
  return true
}

async function processAudioReference(
  ctx: MutationCtx,
  job: CourseDeletionJob,
  entityId: string,
): Promise<boolean> {
  const overviewId = ctx.db.normalizeId('audioOverviews', entityId)
  if (!overviewId) return false
  const overview = await ctx.db.get(overviewId)
  if (!overview || overview.userId !== job.userId || overview.courseScoped !== true) return false
  if (overview.status === 'deleting') return false
  await scheduleAudioOverviewDeletion(ctx, overview._id, job.userId)
  return true
}

async function processSectionBatch(ctx: MutationCtx, job: CourseDeletionJob): Promise<boolean> {
  const section = await ctx.db
    .query('courseSections')
    .withIndex('by_courseId', q => q.eq('courseId', job.courseId))
    .first()
  if (!section) return false
  if (section.userId !== job.userId) throw new Error('Course section ownership mismatch')

  for (const block of section.contentBlocks) {
    if (!block.entityId) continue
    const type = block.entityType ?? (block.type === 'text' ? undefined : block.type)
    const processed = type === 'quiz'
      ? await processQuizReference(ctx, job, block.entityId)
      : type === 'flashcard'
        ? await processFlashcardReference(ctx, job, block.entityId)
        : type === 'audio'
          ? await processAudioReference(ctx, job, block.entityId)
          : false
    if (processed) return true
  }

  await ctx.db.delete(section._id)
  return true
}

async function firstUnsettledCleanup(ctx: MutationCtx, courseId: Id<'courses'>) {
  for (const status of ['pending', 'deleting', 'dead_letter'] as const) {
    const row = await ctx.db
      .query('calendarEventCleanupJobs')
      .withIndex('by_courseId_and_status', q => q.eq('courseId', courseId).eq('status', status))
      .first()
    if (row) return row
  }
  return null
}

export const runLocalBatch = internalMutation({
  args: { jobId: v.id('courseDeletionJobs') },
  handler: async (ctx, args): Promise<StepResult> => {
    const job = await ctx.db.get(args.jobId)
    if (!job) return { state: 'complete' }
    if (await hasAccountDeletionTombstone(ctx, job.userId)) {
      await ctx.db.delete(job._id)
      return { state: 'delegated' }
    }
    if (job.nextAttemptAt > Date.now()) return { state: 'waiting', phase: job.phase }

    const course = await ctx.db.get(job.courseId)
    if (!course) {
      await ctx.db.delete(job._id)
      return { state: 'complete' }
    }
    if (course.userId !== job.userId) throw new Error('Course deletion ownership mismatch')

    if (job.phase === 'settleCalendarCleanup') {
      const unsettled = await firstUnsettledCleanup(ctx, job.courseId)
      if (unsettled) {
        if (unsettled.status === 'dead_letter') {
          await ctx.scheduler.runAfter(0, internal.calendarEventCleanup.retryDeadLetter, {
            cleanupJobId: unsettled._id,
          })
        }
        const delayMs = 30_000
        await ctx.db.patch(job._id, {
          nextAttemptAt: Date.now() + delayMs,
          lastError: 'Waiting for calendar event compensation to settle',
          updatedAt: Date.now(),
        })
        await scheduleNext(ctx, job._id, delayMs)
        return { state: 'waiting', phase: job.phase }
      }
      await patchPhase(ctx, job, 'providerEvents')
      return { state: 'progress', phase: 'providerEvents' }
    }

    if (job.phase === 'providerEvents') return { state: 'progress', phase: job.phase }

    if (job.phase === 'calendarCleanupJobs') {
      const rows: Doc<'calendarEventCleanupJobs'>[] = []
      for (const status of ['managed', 'resolved'] as const) {
        if (rows.length >= LOCAL_BATCH_SIZE) break
        rows.push(...await ctx.db
          .query('calendarEventCleanupJobs')
          .withIndex('by_courseId_and_status', q => q.eq('courseId', job.courseId).eq('status', status))
          .take(LOCAL_BATCH_SIZE - rows.length))
      }
      for (const row of rows) {
        if (row.userId !== job.userId) throw new Error('Calendar cleanup ownership mismatch')
        await ctx.db.delete(row._id)
      }
      if (rows.length > 0) await continueJob(ctx, job)
      else await patchPhase(ctx, job, 'sections')
      return { state: 'progress', phase: rows.length > 0 ? job.phase : 'sections' }
    }

    if (job.phase === 'sections') {
      if (await processSectionBatch(ctx, job)) {
        await continueJob(ctx, job)
        return { state: 'progress', phase: job.phase }
      }
      await patchPhase(ctx, job, 'courseSourceDocs')
      return { state: 'progress', phase: 'courseSourceDocs' }
    }

    if (job.phase === 'courseSourceDocs') {
      const rows = await ctx.db
        .query('courseSourceDocs')
        .withIndex('by_courseId', q => q.eq('courseId', job.courseId))
        .take(LOCAL_BATCH_SIZE)
      for (const row of rows) {
        if (row.userId !== job.userId) throw new Error('Course source ownership mismatch')
        await ctx.db.delete(row._id)
      }
      if (rows.length > 0) await continueJob(ctx, job)
      else await patchPhase(ctx, job, 'reviewItems')
      return { state: 'progress', phase: rows.length > 0 ? job.phase : 'reviewItems' }
    }

    if (job.phase === 'reviewItems') {
      const rows = await ctx.db
        .query('reviewItems')
        .withIndex('by_courseId', q => q.eq('courseId', job.courseId))
        .take(LOCAL_BATCH_SIZE)
      for (const row of rows) {
        if (row.userId !== job.userId) throw new Error('Course review item ownership mismatch')
        await ctx.db.delete(row._id)
      }
      if (rows.length > 0) await continueJob(ctx, job)
      else await patchPhase(ctx, job, 'finalize')
      return { state: 'progress', phase: rows.length > 0 ? job.phase : 'finalize' }
    }

    const unsettled = await firstUnsettledCleanup(ctx, job.courseId)
    if (unsettled) {
      await patchPhase(ctx, job, 'settleCalendarCleanup')
      return { state: 'progress', phase: 'settleCalendarCleanup' }
    }
    const calendarEvent = await ctx.db
      .query('calendarEvents')
      .withIndex('by_courseId', q => q.eq('courseId', job.courseId))
      .first()
    if (calendarEvent) {
      await patchPhase(ctx, job, 'providerEvents')
      return { state: 'progress', phase: 'providerEvents' }
    }
    const section = await ctx.db.query('courseSections').withIndex('by_courseId', q => q.eq('courseId', job.courseId)).first()
    if (section) {
      await patchPhase(ctx, job, 'sections')
      return { state: 'progress', phase: 'sections' }
    }
    const source = await ctx.db.query('courseSourceDocs').withIndex('by_courseId', q => q.eq('courseId', job.courseId)).first()
    if (source) {
      await patchPhase(ctx, job, 'courseSourceDocs')
      return { state: 'progress', phase: 'courseSourceDocs' }
    }
    const review = await ctx.db.query('reviewItems').withIndex('by_courseId', q => q.eq('courseId', job.courseId)).first()
    if (review) {
      await patchPhase(ctx, job, 'reviewItems')
      return { state: 'progress', phase: 'reviewItems' }
    }

    await ctx.db.delete(course._id)
    await ctx.db.delete(job._id)
    return { state: 'complete' }
  },
})

type ProviderClaim =
  | { state: 'claimed', leaseToken: string, job: CourseDeletionJob, events: Doc<'calendarEvents'>[] }
  | { state: 'progress' | 'busy' | 'waiting' | 'complete' | 'delegated' }

export const claimProviderBatch = internalMutation({
  args: { jobId: v.id('courseDeletionJobs'), leaseToken: v.string() },
  handler: async (ctx, args): Promise<ProviderClaim> => {
    const job = await ctx.db.get(args.jobId)
    if (!job) return { state: 'complete' }
    if (await hasAccountDeletionTombstone(ctx, job.userId)) {
      await ctx.db.delete(job._id)
      return { state: 'delegated' }
    }
    if (job.phase !== 'providerEvents') return { state: 'progress' }
    const now = Date.now()
    if (job.nextAttemptAt > now) return { state: 'waiting' }
    if (job.leaseToken && (job.leaseExpiresAt ?? 0) > now) return { state: 'busy' }

    const events = await ctx.db
      .query('calendarEvents')
      .withIndex('by_courseId', q => q.eq('courseId', job.courseId))
      .take(PROVIDER_BATCH_SIZE)
    for (const event of events) {
      if (event.userId !== job.userId) throw new Error('Calendar event ownership mismatch')
    }
    if (events.length === 0) {
      await patchPhase(ctx, job, 'calendarCleanupJobs')
      return { state: 'progress' }
    }

    await ctx.db.patch(job._id, {
      leaseToken: args.leaseToken,
      leaseExpiresAt: now + LEASE_MS,
      updatedAt: now,
    })
    return { state: 'claimed', leaseToken: args.leaseToken, job, events }
  },
})

export const recordProviderBatch = internalMutation({
  args: {
    jobId: v.id('courseDeletionJobs'),
    leaseToken: v.string(),
    deletedEventIds: v.array(v.id('calendarEvents')),
    failures: v.number(),
    error: v.optional(v.string()),
    unauthorizedConnectionIds: v.array(v.id('calendarConnections')),
  },
  handler: async (ctx, args): Promise<StepResult> => {
    const job = await ctx.db.get(args.jobId)
    if (!job) return { state: 'complete' }
    if (job.leaseToken !== args.leaseToken || job.phase !== 'providerEvents') {
      return { state: 'waiting', phase: job.phase }
    }

    for (const connectionId of args.unauthorizedConnectionIds) {
      const connection = await ctx.db.get(connectionId)
      if (connection?.userId === job.userId) await ctx.db.patch(connection._id, { expiresAt: 0 })
    }
    for (const eventId of args.deletedEventIds) {
      const event = await ctx.db.get(eventId)
      if (event && event.userId === job.userId && event.courseId === job.courseId) {
        await ctx.db.delete(event._id)
      }
    }

    const now = Date.now()
    if (args.failures > 0) {
      const attempts = job.attempts + 1
      const delayMs = retryDelayMs(attempts)
      await ctx.db.patch(job._id, {
        attempts,
        nextAttemptAt: now + delayMs,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        lastError: (args.error ?? 'Google Calendar cleanup failed').slice(0, 500),
        updatedAt: now,
      })
      await scheduleNext(ctx, job._id, delayMs)
      return { state: 'retrying', phase: job.phase, error: args.error }
    }

    await ctx.db.patch(job._id, {
      attempts: 0,
      nextAttemptAt: now,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      lastError: undefined,
      updatedAt: now,
    })
    await scheduleNext(ctx, job._id)
    return { state: 'progress', phase: job.phase }
  },
})

async function processProviderBatch(ctx: ActionCtx, jobId: Id<'courseDeletionJobs'>): Promise<StepResult> {
  const leaseToken = crypto.randomUUID()
  const claim: ProviderClaim = await ctx.runMutation(internal.courseDeletion.claimProviderBatch, {
    jobId,
    leaseToken,
  })
  if (claim.state !== 'claimed') {
    return { state: claim.state === 'busy' ? 'waiting' : claim.state }
  }

  const tokenByConnection = new Map<string, string>()
  const deletedEventIds: Id<'calendarEvents'>[] = []
  const unauthorizedConnectionIds = new Set<Id<'calendarConnections'>>()
  const errors: string[] = []

  for (const event of claim.events) {
    try {
      let accessToken = tokenByConnection.get(event.calendarConnectionId)
      if (!accessToken) {
        const connection: Doc<'calendarConnections'> | null = await ctx.runQuery(
          internal.calendarConnections.getConnectionByIdForCleanup,
          { calendarConnectionId: event.calendarConnectionId },
        )
        if (!connection
          || connection.userId !== claim.job.userId
          || (connection.status !== 'connected' && connection.status !== 'disconnecting')) {
          throw new Error('Reconnect Google Calendar before deleting this scheduled course')
        }
        accessToken = await getCalendarAccessToken(ctx, claim.job.userId, connection)
        tokenByConnection.set(event.calendarConnectionId, accessToken)
      }

      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(event.calendarEventId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(15_000),
        },
      )
      if (response.ok || response.status === 404 || response.status === 410) {
        deletedEventIds.push(event._id)
      }
      else {
        if (response.status === 401) unauthorizedConnectionIds.add(event.calendarConnectionId)
        errors.push(`Google Calendar cleanup failed with status ${response.status}`)
      }
    }
    catch (error) {
      errors.push(boundedError(error))
    }
  }

  return await ctx.runMutation(internal.courseDeletion.recordProviderBatch, {
    jobId,
    leaseToken: claim.leaseToken,
    deletedEventIds,
    failures: errors.length,
    ...(errors[0] ? { error: errors[0] } : {}),
    unauthorizedConnectionIds: [...unauthorizedConnectionIds],
  })
}

export async function runCourseDeletionSteps(
  ctx: ActionCtx,
  jobId: Id<'courseDeletionJobs'>,
  maxSteps: number,
): Promise<CourseDeletionRunResult> {
  for (let step = 0; step < maxSteps; step++) {
    const job: CourseDeletionJob | null = await ctx.runQuery(internal.courseDeletion.get, { jobId })
    if (!job) return { deleted: true, pending: false }
    if (job.nextAttemptAt > Date.now() && job.lastError) {
      return { deleted: false, pending: true, error: job.lastError }
    }
    const result = job.phase === 'providerEvents'
      ? await processProviderBatch(ctx, jobId)
      : await ctx.runMutation(internal.courseDeletion.runLocalBatch, { jobId })
    if (result.state === 'complete' || result.state === 'delegated') {
      return { deleted: true, pending: false }
    }
    if (result.state === 'waiting') return { deleted: false, pending: true }
    if (result.state === 'retrying') {
      return { deleted: false, pending: true, ...(result.error ? { error: result.error } : {}) }
    }
  }
  return { deleted: false, pending: true }
}

export const process = internalAction({
  args: { jobId: v.id('courseDeletionJobs') },
  handler: async (ctx, args): Promise<CourseDeletionRunResult> =>
    await runCourseDeletionSteps(ctx, args.jobId, 1),
})

export const resumeStale = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ resumed: number }> => {
    const now = Date.now()
    const jobs = await ctx.db
      .query('courseDeletionJobs')
      .withIndex('by_status_and_updatedAt', q => q.eq('status', 'active').lt('updatedAt', now - STALE_JOB_MS))
      .take(25)
    let resumed = 0
    for (const job of jobs) {
      if (job.nextAttemptAt > now || (job.leaseExpiresAt ?? 0) > now) continue
      await ctx.db.patch(job._id, {
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
      })
      await scheduleNext(ctx, job._id)
      resumed++
    }
    return { resumed }
  },
})
