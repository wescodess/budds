/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const USER = {
  tokenIdentifier: 'https://auth.example.com|calendar_cleanup_user',
  name: 'Calendar Cleanup User',
  email: 'calendar-cleanup@example.com',
}

async function setup(t: ReturnType<typeof convexTest>) {
  const asUser = t.withIdentity(USER)
  const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Calendar cleanup' })
  const { courseId } = await asUser.mutation(api.courses.create, {
    title: 'Durable calendar cleanup',
    folderId,
    sourceType: 'web-only',
    webSearchEnabled: true,
  })
  const calendarConnectionId = await asUser.mutation(api.calendarConnections.upsertConnection, {
    provider: 'google',
    accessToken: 'dG9rZW4=',
    refreshToken: 'cmVmcmVzaA==',
    expiresAt: Date.now() + 3_600_000,
    timezone: 'UTC',
  })
  return { asUser, courseId, calendarConnectionId }
}

describe('calendar event compensating cleanup', () => {
  let previousEncryptionKey: string | undefined

  beforeEach(() => {
    previousEncryptionKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
  })

  afterEach(() => {
    if (previousEncryptionKey === undefined) delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
    else process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = previousEncryptionKey
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  test('[P0] reserves durable cleanup before Google event creation', async () => {
    const t = convexTest(schema, modules)
    const { courseId, calendarConnectionId } = await setup(t)

    const cleanupJobId = await t.mutation(internal.calendarEventCleanup.reserve, {
      userId: USER.tokenIdentifier,
      calendarConnectionId,
      calendarEventId: '0123456789abcdef0123456789abcdef',
      courseId,
      reason: 'sync-create',
    })

    const evidence = await t.query(internal.calendarEventCleanup.getStatus, { cleanupJobId })
    expect(evidence).toMatchObject({
      userId: USER.tokenIdentifier,
      calendarConnectionId,
      calendarEventId: '0123456789abcdef0123456789abcdef',
      courseId,
      reason: 'sync-create',
      status: 'pending',
      attempts: 0,
    })

    const scheduled = await t.run(async ctx => await ctx.db.system.query('_scheduled_functions').collect())
    expect(scheduled.some(job => job.name.includes('calendarEventCleanup:processOne'))).toBe(true)
  })

  test('[P0] calendar sync arms cleanup before calling Google with a caller-owned event id', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, calendarConnectionId } = await setup(t)
    await t.run(async ctx => {
      await ctx.db.patch(courseId, { status: 'ready', totalSectionCount: 1 })
    })
    await asUser.mutation(api.calendarConnections.updatePreferences, {
      morningStart: '09:00',
      eveningEnd: '17:00',
      sessionMinutes: 25,
      preferredDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    })

    const createGoogleEvent = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { id?: string }
      expect(body.id).toMatch(/^[0-9a-f]{32}$/)
      const reservation = await t.run(async ctx => await ctx.db
        .query('calendarEventCleanupJobs')
        .withIndex('by_calendarConnectionId_and_calendarEventId', q =>
          q.eq('calendarConnectionId', calendarConnectionId).eq('calendarEventId', body.id!),
        )
        .unique())
      expect(reservation?.status).toBe('pending')
      return new Response(JSON.stringify({ id: body.id }), { status: 200 })
    })
    vi.stubGlobal('fetch', createGoogleEvent)

    const result = await asUser.action(api.calendarEvents.syncCalendar, {})
    expect(result.created).toBe(1)
    expect(result.failures).toBe(0)
    expect(createGoogleEvent).toHaveBeenCalledOnce()

    const terminal = await t.run(async ctx => await ctx.db
      .query('calendarEventCleanupJobs')
      .withIndex('by_calendarConnectionId_and_status', q =>
        q.eq('calendarConnectionId', calendarConnectionId).eq('status', 'managed'),
      )
      .unique())
    expect(terminal?.calendarEventId).toBe(result.events[0]!.eventId)
  })

  test('[P1] concurrent syncs reserve one course operation before the only Google POST', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, calendarConnectionId } = await setup(t)
    await t.run(async ctx => await ctx.db.patch(courseId, { status: 'ready', totalSectionCount: 1 }))
    await asUser.mutation(api.calendarConnections.updatePreferences, {
      morningStart: '09:00',
      eveningEnd: '17:00',
      sessionMinutes: 25,
      preferredDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    })
    const starts: number[] = []
    const createGoogleEvent = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { start: { dateTime: string } }
      starts.push(new Date(body.start.dateTime).getTime())
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', createGoogleEvent)

    const results = await Promise.all([
      asUser.action(api.calendarEvents.syncCalendar, {}),
      asUser.action(api.calendarEvents.syncCalendar, {}),
    ])

    expect(createGoogleEvent).toHaveBeenCalledOnce()
    expect(results.reduce((sum, result) => sum + result.created, 0)).toBe(1)
    expect((await t.query(internal.calendarConnections.getConnectionByIdForCleanup, {
      calendarConnectionId,
    }))!.calendarSlotWatermark).toBe(starts[0])
  })

  test('[P1] pre-operationKey pending rows still gate a course during migration', async () => {
    const t = convexTest(schema, modules)
    const { courseId, calendarConnectionId } = await setup(t)
    await t.mutation(internal.calendarEventCleanup.reserve, {
      userId: USER.tokenIdentifier,
      calendarConnectionId,
      calendarEventId: '69696969696969696969696969696969',
      courseId,
      reason: 'sync-create',
    })

    await expect(t.mutation(internal.calendarEventCleanup.reserve, {
      userId: USER.tokenIdentifier,
      calendarConnectionId,
      calendarEventId: '70707070707070707070707070707070',
      courseId,
      reason: 'sync-create',
      operationKey: `sync-course:${courseId}`,
    })).rejects.toThrow('unresolved external reservation')
  })

  test('[P2] calendar sync continues through more than 100 owner-scoped courses', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, calendarConnectionId } = await setup(t)
    const course = await t.run(async ctx => await ctx.db.get(courseId))
    await t.run(async (ctx) => {
      const now = Date.now()
      await ctx.db.patch(courseId, { status: 'ready', totalSectionCount: 1 })
      for (let index = 0; index < 100; index++) {
        await ctx.db.insert('courses', {
          userId: USER.tokenIdentifier,
          folderId: course!.folderId,
          title: `Calendar course ${index}`,
          status: 'ready',
          sourceType: 'web-only',
          sourceConfidence: { docCount: 0, webPercent: 100 },
          pace: 'steady',
          outlineSections: [],
          completedSectionCount: 0,
          totalSectionCount: 1,
          webSearchEnabled: true,
          createdAt: now + index,
          updatedAt: now + index,
        })
      }
    })
    await asUser.mutation(api.calendarConnections.updatePreferences, {
      morningStart: '09:00',
      eveningEnd: '17:00',
      sessionMinutes: 25,
      preferredDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    })
    const starts: number[] = []
    const createGoogleEvent = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { start: { dateTime: string } }
      starts.push(new Date(body.start.dateTime).getTime())
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', createGoogleEvent)

    const firstPage = await asUser.action(api.calendarEvents.syncCalendar, {})
    expect(firstPage.created).toBe(25)
    expect(firstPage.message).toBe('Calendar sync continues in the background')
    vi.useFakeTimers()
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    expect(createGoogleEvent).toHaveBeenCalledTimes(101)
    const orderedStarts = [...starts].sort((left, right) => left - right)
    expect(new Set(orderedStarts).size).toBe(101)
    for (let index = 1; index < orderedStarts.length; index++) {
      expect(orderedStarts[index]! - orderedStarts[index - 1]!).toBeGreaterThanOrEqual(25 * 60_000)
    }
    expect(await t.run(async ctx => await ctx.db
      .query('calendarEvents')
      .withIndex('by_userId', q => q.eq('userId', USER.tokenIdentifier))
      .collect())).toHaveLength(101)
    const watermark = (await t.query(internal.calendarConnections.getConnectionByIdForCleanup, {
      calendarConnectionId,
    }))!.calendarSlotWatermark
    await asUser.action(api.calendarEvents.syncCalendar, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(createGoogleEvent).toHaveBeenCalledTimes(101)
    expect((await t.query(internal.calendarConnections.getConnectionByIdForCleanup, {
      calendarConnectionId,
    }))!.calendarSlotWatermark).toBe(watermark)
  })

  test('[P0] local event commit and compensation disarm are atomic', async () => {
    const t = convexTest(schema, modules)
    const { courseId, calendarConnectionId } = await setup(t)
    const calendarEventId = 'abcdef0123456789abcdef0123456789'
    const cleanupJobId = await t.mutation(internal.calendarEventCleanup.reserve, {
      userId: USER.tokenIdentifier,
      calendarConnectionId,
      calendarEventId,
      courseId,
      reason: 'sync-create',
    })

    const eventId = await t.mutation(internal.calendarEvents.commitCreateWithCompensation, {
      cleanupJobId,
      userId: USER.tokenIdentifier,
      calendarConnectionId,
      calendarEventId,
      courseId,
      scheduledAt: Date.now() + 86_400_000,
      sessionType: 'new-content',
    })

    expect(eventId).toBeTruthy()
    expect(await t.query(internal.calendarEventCleanup.getStatus, { cleanupJobId }))
      .toMatchObject({ status: 'managed', attempts: 0 })

    const deleteGoogleEvent = vi.fn()
    vi.stubGlobal('fetch', deleteGoogleEvent)
    expect(await t.action(internal.calendarEventCleanup.processOne, { cleanupJobId })).toBe('skipped')
    expect(deleteGoogleEvent).not.toHaveBeenCalled()
  })

  test('[P0] cleanup claim wins atomically over a late local event commit', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, calendarConnectionId } = await setup(t)
    const calendarEventId = '10101010101010101010101010101010'
    const cleanupJobId = await t.mutation(internal.calendarEventCleanup.reserve, {
      userId: USER.tokenIdentifier,
      calendarConnectionId,
      calendarEventId,
      courseId,
      reason: 'sync-create',
    })
    await t.mutation(internal.calendarEventCleanup.expedite, { cleanupJobId })
    expect(await t.mutation(internal.calendarEventCleanup.claim, { cleanupJobId }))
      .toMatchObject({ attempt: 1 })

    await expect(t.mutation(internal.calendarEvents.commitCreateWithCompensation, {
      cleanupJobId,
      userId: USER.tokenIdentifier,
      calendarConnectionId,
      calendarEventId,
      courseId,
      scheduledAt: Date.now() + 86_400_000,
      sessionType: 'new-content',
    })).rejects.toThrow('Calendar cleanup already claimed the external event')
    expect(await asUser.query(api.calendarEvents.listByUser, {})).toEqual([])
  })

  test('[P0] reschedule commit updates the missed event and disarms cleanup atomically', async () => {
    const t = convexTest(schema, modules)
    const { courseId, calendarConnectionId } = await setup(t)
    const missedEventId = await t.mutation(internal.calendarEvents.create, {
      userId: USER.tokenIdentifier,
      calendarConnectionId,
      calendarEventId: 'original-calendar-event',
      courseId,
      scheduledAt: Date.now() - 60_000,
      sessionType: 'review',
    })
    const calendarEventId = 'abcdefabcdefabcdefabcdefabcdefab'
    const cleanupJobId = await t.mutation(internal.calendarEventCleanup.reserve, {
      userId: USER.tokenIdentifier,
      calendarConnectionId,
      calendarEventId,
      courseId,
      reason: 'missed-reschedule',
    })

    const replacementId = await t.mutation(internal.calendarEvents.commitRescheduleWithCompensation, {
      cleanupJobId,
      missedEventId,
      userId: USER.tokenIdentifier,
      calendarConnectionId,
      calendarEventId,
      courseId,
      scheduledAt: Date.now() + 86_400_000,
      sessionType: 'review',
    })

    const evidence = await t.run(async ctx => ({
      missed: await ctx.db.get(missedEventId),
      replacement: await ctx.db.get(replacementId),
    }))
    expect(evidence.missed?.status).toBe('missed')
    expect(evidence.replacement?.status).toBe('rescheduled')
    expect(await t.query(internal.calendarEventCleanup.getStatus, { cleanupJobId }))
      .toMatchObject({ status: 'managed', attempts: 0 })
  })

  test('[P0] a missing external event resolves cleanup idempotently', async () => {
    const t = convexTest(schema, modules)
    const { courseId, calendarConnectionId } = await setup(t)
    const cleanupJobId = await t.mutation(internal.calendarEventCleanup.reserve, {
      userId: USER.tokenIdentifier,
      calendarConnectionId,
      calendarEventId: '11111111111111111111111111111111',
      courseId,
      reason: 'sync-create',
    })
    await t.mutation(internal.calendarEventCleanup.expedite, { cleanupJobId })
    const deleteGoogleEvent = vi.fn().mockResolvedValue(new Response('', { status: 404 }))
    vi.stubGlobal('fetch', deleteGoogleEvent)

    expect(await t.action(internal.calendarEventCleanup.processOne, { cleanupJobId })).toBe('resolved')
    expect(await t.action(internal.calendarEventCleanup.processOne, { cleanupJobId })).toBe('skipped')
    expect(deleteGoogleEvent).toHaveBeenCalledOnce()
    expect(await t.query(internal.calendarEventCleanup.getStatus, { cleanupJobId })).toMatchObject({
      status: 'resolved',
      attempts: 1,
      resolution: 'already_absent',
      lastHttpStatus: 404,
    })
  })

  test('[P0] retryable Google failure remains durable and schedules backoff', async () => {
    const t = convexTest(schema, modules)
    const { courseId, calendarConnectionId } = await setup(t)
    const cleanupJobId = await t.mutation(internal.calendarEventCleanup.reserve, {
      userId: USER.tokenIdentifier,
      calendarConnectionId,
      calendarEventId: '22222222222222222222222222222222',
      courseId,
      reason: 'missed-reschedule',
    })
    await t.mutation(internal.calendarEventCleanup.expedite, { cleanupJobId })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', {
      status: 503,
      headers: { 'retry-after': '1' },
    })))

    expect(await t.action(internal.calendarEventCleanup.processOne, { cleanupJobId })).toBe('pending')
    const evidence = await t.query(internal.calendarEventCleanup.getStatus, { cleanupJobId })
    expect(evidence).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastHttpStatus: 503,
    })
    expect(evidence!.nextAttemptAt).toBeGreaterThan(evidence!.lastAttemptAt!)
  })

  test('[P1] unauthorized cleanup expires the access token before retry', async () => {
    const t = convexTest(schema, modules)
    const { courseId, calendarConnectionId } = await setup(t)
    const cleanupJobId = await t.mutation(internal.calendarEventCleanup.reserve, {
      userId: USER.tokenIdentifier,
      calendarConnectionId,
      calendarEventId: '21212121212121212121212121212121',
      courseId,
      reason: 'sync-create',
    })
    await t.mutation(internal.calendarEventCleanup.expedite, { cleanupJobId })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 })))

    expect(await t.action(internal.calendarEventCleanup.processOne, { cleanupJobId })).toBe('pending')
    expect(await t.query(internal.calendarConnections.getConnectionByIdForCleanup, {
      calendarConnectionId,
    })).toMatchObject({ expiresAt: 0 })
  })

  test('[P1] Google 403 rate-limit reasons retry instead of dead-lettering', async () => {
    const t = convexTest(schema, modules)
    const { courseId, calendarConnectionId } = await setup(t)
    const cleanupJobId = await t.mutation(internal.calendarEventCleanup.reserve, {
      userId: USER.tokenIdentifier,
      calendarConnectionId,
      calendarEventId: '23232323232323232323232323232323',
      courseId,
      reason: 'sync-create',
    })
    await t.mutation(internal.calendarEventCleanup.expedite, { cleanupJobId })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { errors: [{ reason: 'userRateLimitExceeded' }], status: 'RESOURCE_EXHAUSTED' },
    }), { status: 403, headers: { 'content-type': 'application/json' } })))

    expect(await t.action(internal.calendarEventCleanup.processOne, { cleanupJobId })).toBe('pending')
    expect(await t.query(internal.calendarEventCleanup.getStatus, { cleanupJobId })).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastHttpStatus: 403,
    })
  })

  test('[P0] permanent Google failure is retained as terminal evidence and blocks disconnect', async () => {
    const t = convexTest(schema, modules)
    const { asUser, courseId, calendarConnectionId } = await setup(t)
    const cleanupJobId = await t.mutation(internal.calendarEventCleanup.reserve, {
      userId: USER.tokenIdentifier,
      calendarConnectionId,
      calendarEventId: '33333333333333333333333333333333',
      courseId,
      reason: 'sync-create',
    })
    await t.mutation(internal.calendarEventCleanup.expedite, { cleanupJobId })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 })))

    expect(await t.action(internal.calendarEventCleanup.processOne, { cleanupJobId })).toBe('dead_letter')
    expect(await t.query(internal.calendarEventCleanup.getStatus, { cleanupJobId })).toMatchObject({
      status: 'dead_letter',
      attempts: 1,
      lastHttpStatus: 403,
    })
    await expect(asUser.mutation(internal.calendarConnections.disconnect, {}))
      .rejects.toThrow('Calendar external cleanup must finish before disconnecting')
  })

  test('[P0] retry budget exhaustion produces a durable dead letter', async () => {
    const t = convexTest(schema, modules)
    const { courseId, calendarConnectionId } = await setup(t)
    const cleanupJobId = await t.mutation(internal.calendarEventCleanup.reserve, {
      userId: USER.tokenIdentifier,
      calendarConnectionId,
      calendarEventId: '44444444444444444444444444444444',
      courseId,
      reason: 'sync-create',
    })
    const deleteGoogleEvent = vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }))
    vi.stubGlobal('fetch', deleteGoogleEvent)

    for (let attempt = 1; attempt <= 8; attempt++) {
      await t.mutation(internal.calendarEventCleanup.expedite, { cleanupJobId })
      const result = await t.action(internal.calendarEventCleanup.processOne, { cleanupJobId })
      expect(result).toBe(attempt === 8 ? 'dead_letter' : 'pending')
    }

    expect(deleteGoogleEvent).toHaveBeenCalledTimes(8)
    expect(await t.query(internal.calendarEventCleanup.getStatus, { cleanupJobId })).toMatchObject({
      status: 'dead_letter',
      attempts: 8,
      lastHttpStatus: 503,
    })
  })

  test('[P0] expired-claim recovery fences a stale cleanup result', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const { courseId, calendarConnectionId } = await setup(t)
    const cleanupJobId = await t.mutation(internal.calendarEventCleanup.reserve, {
      userId: USER.tokenIdentifier,
      calendarConnectionId,
      calendarEventId: '55555555555555555555555555555555',
      courseId,
      reason: 'sync-create',
    })
    await t.mutation(internal.calendarEventCleanup.expedite, { cleanupJobId })
    const firstClaim = await t.mutation(internal.calendarEventCleanup.claim, { cleanupJobId })
    expect(firstClaim?.attempt).toBe(1)

    vi.advanceTimersByTime(60_001)
    expect(await t.mutation(internal.calendarEventCleanup.sweepDue, {})).toEqual({
      expiredClaims: 1,
      due: 0,
    })
    const secondClaim = await t.mutation(internal.calendarEventCleanup.claim, { cleanupJobId })
    expect(secondClaim?.attempt).toBe(2)

    expect(await t.mutation(internal.calendarEventCleanup.recordSuccess, {
      cleanupJobId,
      attempt: 1,
      httpStatus: 204,
      resolution: 'deleted',
    })).toBe(false)
    expect(await t.query(internal.calendarEventCleanup.getStatus, { cleanupJobId }))
      .toMatchObject({ status: 'deleting', attempts: 2 })
  })

  test('[P1] due-job rescue schedules at most one bounded batch', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const { courseId, calendarConnectionId } = await setup(t)
    for (let index = 0; index < 26; index++) {
      await t.mutation(internal.calendarEventCleanup.reserve, {
        userId: USER.tokenIdentifier,
        calendarConnectionId,
        calendarEventId: index.toString(16).padStart(32, '0'),
        courseId,
        reason: 'missed-reschedule',
      })
    }
    vi.advanceTimersByTime(2 * 60_000 + 1)

    expect(await t.mutation(internal.calendarEventCleanup.sweepDue, {})).toEqual({
      expiredClaims: 0,
      due: 25,
    })
  })

  test('[P1] disconnect gate rejects late reservations and retains credentials until compensation settles', async () => {
    const t = convexTest(schema, modules)
    const { courseId, calendarConnectionId } = await setup(t)
    const cleanupJobId = await t.mutation(internal.calendarEventCleanup.reserve, {
      userId: USER.tokenIdentifier,
      calendarConnectionId,
      calendarEventId: '67676767676767676767676767676767',
      courseId,
      reason: 'sync-create',
      operationKey: `sync-course:${courseId}`,
    })
    expect(await t.mutation(internal.calendarConnections.beginDisconnectForUser, {
      userId: USER.tokenIdentifier,
      leaseToken: 'disconnect-lease-one',
      expectedCalendarConnectionId: calendarConnectionId,
    })).toMatchObject({ state: 'claimed' })
    expect(await t.query(internal.calendarConnections.getConnectionByUser, {
      userId: USER.tokenIdentifier,
    })).toBeNull()
    await expect(t.mutation(internal.calendarEventCleanup.reserve, {
      userId: USER.tokenIdentifier,
      calendarConnectionId,
      calendarEventId: '68686868686868686868686868686868',
      courseId,
      reason: 'sync-create',
      operationKey: `sync-course:${courseId}`,
    })).rejects.toThrow('Active calendar connection not found')
    await expect(t.mutation(internal.calendarEvents.commitCreateWithCompensation, {
      cleanupJobId,
      userId: USER.tokenIdentifier,
      calendarConnectionId,
      calendarEventId: '67676767676767676767676767676767',
      courseId,
      scheduledAt: Date.now() + 60_000,
      sessionType: 'review',
    })).rejects.toThrow('Active calendar connection not found')

    expect(await t.query(internal.calendarConnections.getConnectionByIdForCleanup, {
      calendarConnectionId,
    })).toMatchObject({ status: 'disconnecting', refreshToken: expect.any(String) })
    await t.mutation(internal.calendarEventCleanup.expedite, { cleanupJobId })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    expect(await t.action(internal.calendarEventCleanup.processOne, { cleanupJobId })).toBe('resolved')
    expect(await t.mutation(internal.calendarConnections.recordDisconnectBatch, {
      calendarConnectionId,
      leaseToken: 'disconnect-lease-one',
      deletedEventIds: [],
      failures: 0,
    })).toMatchObject({ state: 'purging_evidence' })
    expect(await t.mutation(internal.calendarConnections.beginDisconnectForUser, {
      userId: USER.tokenIdentifier,
      leaseToken: 'disconnect-lease-two',
      expectedCalendarConnectionId: calendarConnectionId,
    })).toMatchObject({ state: 'claimed' })
    expect(await t.mutation(internal.calendarConnections.recordDisconnectBatch, {
      calendarConnectionId,
      leaseToken: 'disconnect-lease-two',
      deletedEventIds: [],
      failures: 0,
    })).toMatchObject({ state: 'ready_to_revoke' })
    await expect(t.mutation(internal.calendarConnections.beginOAuthRevoke, {
      calendarConnectionId,
      leaseToken: 'disconnect-lease-two',
    })).resolves.toBe(true)
    await expect(t.mutation(internal.calendarConnections.finalizeOAuthRevocation, {
      calendarConnectionId,
      leaseToken: 'disconnect-lease-two',
    })).resolves.toBe(true)
  })

  test('[P1] disconnect purges more than one bounded batch of terminal cleanup before credentials', async () => {
    const t = convexTest(schema, modules)
    const { courseId, calendarConnectionId } = await setup(t)
    await t.run(async (ctx) => {
      const now = Date.now()
      for (let index = 0; index < 51; index++) {
        await ctx.db.insert('calendarEventCleanupJobs', {
          userId: USER.tokenIdentifier,
          calendarConnectionId,
          calendarEventId: `terminal-${index}`,
          courseId,
          reason: 'sync-create',
          status: 'managed',
          attempts: 0,
          nextAttemptAt: now,
          createdAt: now,
          updatedAt: now,
          completedAt: now,
        })
      }
    })

    for (let pass = 0; pass < 3; pass++) {
      expect(await t.action(internal.calendarEvents.startDisconnectForUser, {
        userId: USER.tokenIdentifier,
      })).toMatchObject({ disconnected: false })
      expect(await t.query(internal.calendarConnections.hasConnectionForUser, {
        userId: USER.tokenIdentifier,
      })).toBe(true)
    }
    expect(await t.action(internal.calendarEvents.startDisconnectForUser, {
      userId: USER.tokenIdentifier,
    })).toMatchObject({ disconnected: true })
    expect(await t.query(internal.calendarConnections.hasConnectionForUser, {
      userId: USER.tokenIdentifier,
    })).toBe(false)
    expect(await t.run(async ctx => await ctx.db
      .query('calendarEventCleanupJobs')
      .withIndex('by_userId', q => q.eq('userId', USER.tokenIdentifier))
      .collect())).toEqual([])
  })
})
