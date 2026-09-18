/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const USER_A = {
  tokenIdentifier: 'https://auth.example.com|user_cal_evt_a',
  name: 'Alice',
  email: 'alice@example.com',
}

const USER_B = {
  tokenIdentifier: 'https://auth.example.com|user_cal_evt_b',
  name: 'Bob',
  email: 'bob@example.com',
}

async function setupCalendarAndCourse(t: ReturnType<typeof convexTest>) {
  const asAlice = t.withIdentity(USER_A)

  const folderId = await asAlice.mutation(api.folders.createFolder, {
    name: 'Test Folder',
  })

  const { courseId } = await asAlice.mutation(api.courses.create, {
    title: 'Test Course',
    folderId,
    sourceType: 'web-only',
    webSearchEnabled: true,
  })

  const connectionId = await asAlice.mutation(api.calendarConnections.upsertConnection, {
    provider: 'google',
    accessToken: 'dG9rZW4=',
    refreshToken: 'cmVmcmVzaA==',
    expiresAt: Date.now() + 3600000,
    timezone: 'America/New_York',
  })

  return { folderId, courseId, connectionId }
}

describe('calendarEvents', () => {
  test('listByUser returns empty when no events exist', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)
    const result = await asAlice.query(api.calendarEvents.listByUser, {})
    expect(result).toEqual([])
  })

  test('create adds a new calendar event (internal)', async () => {
    const t = convexTest(schema, modules)
    const { courseId, connectionId } = await setupCalendarAndCourse(t)

    const scheduledAt = Date.now() + 86_400_000
    const eventId = await t.mutation(internal.calendarEvents.create, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'google_evt_123',
      courseId,
      scheduledAt,
      sessionType: 'new-content',
      description: '25 min new content session',
    })

    expect(eventId).toBeTruthy()

    const asAlice = t.withIdentity(USER_A)
    const events = await asAlice.query(api.calendarEvents.listByUser, {})
    expect(events).toHaveLength(1)
    expect(events[0]!.sessionType).toBe('new-content')
    expect(events[0]!.status).toBe('scheduled')
    expect(events[0]).not.toHaveProperty('calendarEventId')
  })

  test('listByCourse filters events by course', async () => {
    const t = convexTest(schema, modules)
    const { courseId, connectionId } = await setupCalendarAndCourse(t)

    await t.mutation(internal.calendarEvents.create, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'evt_1',
      courseId,
      scheduledAt: Date.now() + 86_400_000,
      sessionType: 'new-content',
    })

    const asAlice = t.withIdentity(USER_A)
    const events = await asAlice.query(api.calendarEvents.listByCourse, { courseId })
    expect(events).toHaveLength(1)
    expect(events[0]!.sessionType).toBe('new-content')
  })

  test('listScheduled returns scheduled and rescheduled active events', async () => {
    const t = convexTest(schema, modules)
    const { courseId, connectionId } = await setupCalendarAndCourse(t)
    const asAlice = t.withIdentity(USER_A)

    const eventId = await t.mutation(internal.calendarEvents.create, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'evt_sched',
      courseId,
      scheduledAt: Date.now() + 86_400_000,
      sessionType: 'review',
    })

    let scheduled = await asAlice.query(api.calendarEvents.listScheduled, {})
    expect(scheduled).toHaveLength(1)

    await t.mutation(internal.calendarEvents.createRescheduled, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'evt_rescheduled_active',
      courseId,
      scheduledAt: Date.now() + 172_800_000,
      sessionType: 'review',
    })
    scheduled = await asAlice.query(api.calendarEvents.listScheduled, {})
    expect(scheduled).toHaveLength(2)

    await asAlice.mutation(api.calendarEvents.updateStatus, {
      eventId,
      status: 'completed',
    })

    scheduled = await asAlice.query(api.calendarEvents.listScheduled, {})
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]!.status).toBe('rescheduled')
  })

  test('updateStatus changes event status', async () => {
    const t = convexTest(schema, modules)
    const { courseId, connectionId } = await setupCalendarAndCourse(t)
    const asAlice = t.withIdentity(USER_A)

    const eventId = await t.mutation(internal.calendarEvents.create, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'evt_update',
      courseId,
      scheduledAt: Date.now() + 86_400_000,
      sessionType: 'new-content',
    })

    await asAlice.mutation(api.calendarEvents.updateStatus, {
      eventId,
      status: 'missed',
    })

    const events = await asAlice.query(api.calendarEvents.listByUser, {})
    expect(events[0]!.status).toBe('missed')
  })

  test('updateStatus rejects if user does not own event', async () => {
    const t = convexTest(schema, modules)
    const { courseId, connectionId } = await setupCalendarAndCourse(t)

    const eventId = await t.mutation(internal.calendarEvents.create, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'evt_notmine',
      courseId,
      scheduledAt: Date.now() + 86_400_000,
      sessionType: 'review',
    })

    const asBob = t.withIdentity(USER_B)
    await expect(
      asBob.mutation(api.calendarEvents.updateStatus, {
        eventId,
        status: 'completed',
      }),
    ).rejects.toThrow('Event not found')
  })

  test('deleteByCourse removes all events for a course (internal)', async () => {
    const t = convexTest(schema, modules)
    const { courseId, connectionId } = await setupCalendarAndCourse(t)
    const asAlice = t.withIdentity(USER_A)

    await t.mutation(internal.calendarEvents.create, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'evt_del_1',
      courseId,
      scheduledAt: Date.now() + 86_400_000,
      sessionType: 'new-content',
    })

    await t.mutation(internal.calendarEvents.create, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'evt_del_2',
      courseId,
      scheduledAt: Date.now() + 172_800_000,
      sessionType: 'review',
    })

    let events = await asAlice.query(api.calendarEvents.listByUser, {})
    expect(events).toHaveLength(2)

    await t.mutation(internal.calendarEvents.deleteByCourse, { courseId })

    events = await asAlice.query(api.calendarEvents.listByUser, {})
    expect(events).toHaveLength(0)
  })

  test('events are user-isolated', async () => {
    const t = convexTest(schema, modules)
    const { courseId, connectionId } = await setupCalendarAndCourse(t)

    await t.mutation(internal.calendarEvents.create, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'evt_iso',
      courseId,
      scheduledAt: Date.now() + 86_400_000,
      sessionType: 'audio-only',
    })

    const asBob = t.withIdentity(USER_B)
    const bobEvents = await asBob.query(api.calendarEvents.listByUser, {})
    expect(bobEvents).toHaveLength(0)
  })

  test('listByUser requires authentication', async () => {
    const t = convexTest(schema, modules)
    await expect(
      t.query(api.calendarEvents.listByUser, {}),
    ).rejects.toThrow('Unauthenticated')
  })

  test('deleteByUser removes all events for a user (internal)', async () => {
    const t = convexTest(schema, modules)
    const { courseId, connectionId } = await setupCalendarAndCourse(t)
    const asAlice = t.withIdentity(USER_A)

    await t.mutation(internal.calendarEvents.create, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'evt_user_del_1',
      courseId,
      scheduledAt: Date.now() + 86_400_000,
      sessionType: 'new-content',
    })

    await t.mutation(internal.calendarEvents.create, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'evt_user_del_2',
      courseId,
      scheduledAt: Date.now() + 172_800_000,
      sessionType: 'review',
    })

    let events = await asAlice.query(api.calendarEvents.listByUser, {})
    expect(events).toHaveLength(2)

    await t.mutation(internal.calendarEvents.deleteByUser, {
      userId: USER_A.tokenIdentifier,
    })

    events = await asAlice.query(api.calendarEvents.listByUser, {})
    expect(events).toHaveLength(0)
  })

  test('missed candidates remain scheduled until rescheduling commits', async () => {
    const t = convexTest(schema, modules)
    const { courseId, connectionId } = await setupCalendarAndCourse(t)
    const asAlice = t.withIdentity(USER_A)

    const pastTime = Date.now() - 3_600_000
    await t.mutation(internal.calendarEvents.create, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'evt_past_1',
      courseId,
      scheduledAt: pastTime,
      sessionType: 'new-content',
    })

    const futureTime = Date.now() + 86_400_000
    await t.mutation(internal.calendarEvents.create, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'evt_future_1',
      courseId,
      scheduledAt: futureTime,
      sessionType: 'review',
    })

    const { missed } = await t.query(internal.calendarEvents.getMissedCandidatesPage, {
      userId: USER_A.tokenIdentifier,
      status: 'scheduled',
      cursor: null,
    })

    expect(missed).toHaveLength(1)
    expect(missed[0]!.courseId).toBe(courseId)

    const events = await asAlice.query(api.calendarEvents.listByUser, {})
    const pastEvent = events.find(e => e.scheduledAt === pastTime)
    const futureEvent = events.find(e => e.scheduledAt === futureTime)
    expect(pastEvent!.status).toBe('scheduled')
    expect(futureEvent!.status).toBe('scheduled')

    await t.mutation(internal.calendarEvents.commitReschedule, {
      missedEventId: missed[0]!.eventId,
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'evt_rescheduled_1',
      courseId,
      scheduledAt: Date.now() + 172_800_000,
      sessionType: 'new-content',
    })

    const committedEvents = await asAlice.query(api.calendarEvents.listByUser, {})
    expect(committedEvents.find(e => e.scheduledAt === pastTime)!.status).toBe('missed')
  })

  test('getMissedCandidates returns empty when no events are past due', async () => {
    const t = convexTest(schema, modules)
    const { courseId, connectionId } = await setupCalendarAndCourse(t)

    await t.mutation(internal.calendarEvents.create, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'evt_future_only',
      courseId,
      scheduledAt: Date.now() + 86_400_000,
      sessionType: 'new-content',
    })

    const { missed } = await t.query(internal.calendarEvents.getMissedCandidatesPage, {
      userId: USER_A.tokenIdentifier,
      status: 'scheduled',
      cursor: null,
    })

    expect(missed).toHaveLength(0)
  })

  test('getMissedCandidates excludes already missed events', async () => {
    const t = convexTest(schema, modules)
    const { courseId, connectionId } = await setupCalendarAndCourse(t)
    const asAlice = t.withIdentity(USER_A)

    const eventId = await t.mutation(internal.calendarEvents.create, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'evt_already_missed',
      courseId,
      scheduledAt: Date.now() - 7_200_000,
      sessionType: 'new-content',
    })

    await asAlice.mutation(api.calendarEvents.updateStatus, {
      eventId,
      status: 'missed',
    })

    const { missed } = await t.query(internal.calendarEvents.getMissedCandidatesPage, {
      userId: USER_A.tokenIdentifier,
      status: 'scheduled',
      cursor: null,
    })

    expect(missed).toHaveLength(0)
  })

  test('createRescheduled creates event with rescheduled status', async () => {
    const t = convexTest(schema, modules)
    const { courseId, connectionId } = await setupCalendarAndCourse(t)
    const asAlice = t.withIdentity(USER_A)

    const rescheduledAt = Date.now() + 172_800_000
    const eventId = await t.mutation(internal.calendarEvents.createRescheduled, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'google_resched_1',
      courseId,
      scheduledAt: rescheduledAt,
      sessionType: 'new-content',
      description: 'Rescheduled session',
    })

    expect(eventId).toBeTruthy()

    const events = await asAlice.query(api.calendarEvents.listByUser, {})
    const rescheduled = events.find(e => e.scheduledAt === rescheduledAt)
    expect(rescheduled).toBeTruthy()
    expect(rescheduled!.status).toBe('rescheduled')
    expect(rescheduled!.scheduledAt).toBe(rescheduledAt)
  })

  test('missed detection and rescheduling flow end-to-end (data layer)', async () => {
    const t = convexTest(schema, modules)
    const { courseId, connectionId } = await setupCalendarAndCourse(t)
    const asAlice = t.withIdentity(USER_A)

    const pastTime = Date.now() - 3_600_000
    const missedEventId = await t.mutation(internal.calendarEvents.create, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'evt_e2e_missed',
      courseId,
      scheduledAt: pastTime,
      sessionType: 'review',
    })

    const { missed } = await t.query(internal.calendarEvents.getMissedCandidatesPage, {
      userId: USER_A.tokenIdentifier,
      status: 'scheduled',
      cursor: null,
    })
    expect(missed).toHaveLength(1)

    const rescheduledAt = Date.now() + 86_400_000
    await t.mutation(internal.calendarEvents.commitReschedule, {
      missedEventId,
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'google_resched_e2e',
      courseId,
      scheduledAt: rescheduledAt,
      sessionType: 'review',
      description: 'Rescheduled review session',
    })

    const events = await asAlice.query(api.calendarEvents.listByUser, {})
    expect(events).toHaveLength(2)

    const missedEvent = events.find(e => e.scheduledAt === pastTime)
    const rescheduledEvent = events.find(e => e.scheduledAt === rescheduledAt)

    expect(missedEvent!.status).toBe('missed')
    expect(rescheduledEvent!.status).toBe('rescheduled')
    expect(rescheduledEvent!.scheduledAt).toBe(rescheduledAt)
    expect(rescheduledEvent!.sessionType).toBe('review')
  })

  test('[P1] failed provider deletion keeps the local event and credentials for retry', async () => {
    const t = convexTest(schema, modules)
    const { courseId, connectionId } = await setupCalendarAndCourse(t)
    const asAlice = t.withIdentity(USER_A)
    await t.mutation(internal.calendarEvents.create, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'provider-retry-event',
      courseId,
      scheduledAt: Date.now() + 60_000,
      sessionType: 'review',
    })

    const previousEncryptionKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })))
    try {
      expect(await asAlice.action(api.calendarEvents.disconnectCalendar, {})).toEqual({
        disconnected: false,
        googleEventsDeleted: 0,
        googleEventsFailed: 1,
      })
    }
    finally {
      if (previousEncryptionKey === undefined) delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
      else process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = previousEncryptionKey
      vi.unstubAllGlobals()
    }

    expect(await asAlice.query(api.calendarConnections.getByUser, {})).toMatchObject({ status: 'disconnecting' })
    expect(await asAlice.query(api.calendarEvents.listByUser, {})).toHaveLength(1)
    expect(await t.query(internal.calendarConnections.getConnectionByIdForCleanup, {
      calendarConnectionId: connectionId,
    })).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String) })
  })

  test('disconnectCalendar removes one bounded provider batch and finalizes when drained', async () => {
    const t = convexTest(schema, modules)
    const { courseId, connectionId } = await setupCalendarAndCourse(t)
    const asAlice = t.withIdentity(USER_A)
    await t.run(async (ctx) => {
      for (let index = 0; index < 25; index++) {
        await ctx.db.insert('calendarEvents', {
          userId: USER_A.tokenIdentifier,
          calendarConnectionId: connectionId,
          calendarEventId: `google-batch-${index}`,
          courseId,
          scheduledAt: Date.now() + index * 60_000,
          sessionType: 'review',
          status: 'scheduled',
        })
      }
    })

    const previousEncryptionKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
    const deleteGoogleEvent = vi.fn(async (url: string) => new Response(null, {
      status: url.includes('/revoke') ? 200 : 204,
    }))
    vi.stubGlobal('fetch', deleteGoogleEvent)
    try {
      const result = await asAlice.action(api.calendarEvents.disconnectCalendar, {})
      expect(result).toEqual({ disconnected: true, googleEventsDeleted: 25, googleEventsFailed: 0 })
    }
    finally {
      if (previousEncryptionKey === undefined) delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
      else process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = previousEncryptionKey
      vi.unstubAllGlobals()
    }

    expect(deleteGoogleEvent).toHaveBeenCalledTimes(26)
    expect(deleteGoogleEvent.mock.calls.filter(([url]) => String(url).includes('/revoke'))).toHaveLength(1)
    expect(await asAlice.query(api.calendarConnections.getByUser, {})).toBeNull()
    expect(await asAlice.query(api.calendarEvents.listByUser, {})).toEqual([])
  })

  test('[P1] missed-candidate pages include every rescheduled replacement beyond 200 rows', async () => {
    const t = convexTest(schema, modules)
    const { courseId, connectionId } = await setupCalendarAndCourse(t)
    await t.run(async (ctx) => {
      for (let index = 0; index < 205; index++) {
        await ctx.db.insert('calendarEvents', {
          userId: USER_A.tokenIdentifier,
          calendarConnectionId: connectionId,
          calendarEventId: `past-rescheduled-${index}`,
          courseId,
          scheduledAt: Date.now() - 60_000 - index,
          sessionType: 'review',
          status: 'rescheduled',
        })
      }
    })

    let cursor: string | null = null
    const missedIds: string[] = []
    do {
      const page: {
        missed: Array<{ eventId: string }>
        isDone: boolean
        continueCursor: string
      } = await t.query(internal.calendarEvents.getMissedCandidatesPage, {
        userId: USER_A.tokenIdentifier,
        status: 'rescheduled',
        cursor,
      })
      missedIds.push(...page.missed.map((event: { eventId: string }) => event.eventId))
      cursor = page.isDone ? null : page.continueCursor
    } while (cursor !== null)

    expect(missedIds).toHaveLength(205)
  })

  test('[P1] missed-session continuation carries slot position across page boundaries', async () => {
    const t = convexTest(schema, modules)
    const { courseId, connectionId } = await setupCalendarAndCourse(t)
    const asAlice = t.withIdentity(USER_A)
    await asAlice.mutation(api.calendarConnections.updatePreferences, {
      morningStart: '09:00',
      eveningEnd: '10:00',
      sessionMinutes: 25,
      preferredDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    })
    await t.run(async (ctx) => {
      for (let index = 0; index < 11; index++) {
        await ctx.db.insert('calendarEvents', {
          userId: USER_A.tokenIdentifier,
          calendarConnectionId: connectionId,
          calendarEventId: `missed-page-${index}`,
          courseId,
          scheduledAt: Date.now() - 60_000 - index,
          sessionType: 'review',
          status: 'scheduled',
        })
      }
    })

    const previousEncryptionKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
    const starts: string[] = []
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { start: { dateTime: string } }
      starts.push(body.start.dateTime)
      return new Response('{}', { status: 200 })
    }))
    try {
      await t.action(internal.calendarEvents.checkMissedSessionsForUser, {
        userId: USER_A.tokenIdentifier,
        status: 'scheduled',
        cursor: null,
        nextSlotAfter: Date.now(),
      })
      vi.useFakeTimers()
      await t.finishAllScheduledFunctions(vi.runAllTimers)
    }
    finally {
      if (previousEncryptionKey === undefined) delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
      else process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = previousEncryptionKey
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }

    expect(starts).toHaveLength(11)
    expect(new Set(starts).size).toBe(11)
    for (const start of starts) {
      const minute = Number(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(start)).split(':')[0]) * 60
        + Number(new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/New_York',
          minute: '2-digit',
        }).format(new Date(start)))
      expect(minute + 25).toBeLessThanOrEqual(10 * 60)
    }
  })

  test('[P2] separate missed-session runs allocate after existing future events', async () => {
    const t = convexTest(schema, modules)
    const { courseId, connectionId } = await setupCalendarAndCourse(t)
    const asAlice = t.withIdentity(USER_A)
    await asAlice.mutation(api.calendarConnections.updatePreferences, {
      morningStart: '09:00',
      eveningEnd: '17:00',
      sessionMinutes: 25,
      preferredDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    })
    const insertMissed = async (calendarEventId: string) => await t.mutation(internal.calendarEvents.create, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId,
      courseId,
      scheduledAt: Date.now() - 60_000,
      sessionType: 'review',
    })
    await insertMissed('separate-run-one')

    const previousEncryptionKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
    const starts: number[] = []
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { start: { dateTime: string } }
      starts.push(new Date(body.start.dateTime).getTime())
      return new Response('{}', { status: 200 })
    }))
    try {
      await t.action(internal.calendarEvents.checkMissedSessionsForUser, {
        userId: USER_A.tokenIdentifier,
        status: 'scheduled',
        cursor: null,
      })
      await insertMissed('separate-run-two')
      await t.action(internal.calendarEvents.checkMissedSessionsForUser, {
        userId: USER_A.tokenIdentifier,
        status: 'scheduled',
        cursor: null,
      })
    }
    finally {
      if (previousEncryptionKey === undefined) delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
      else process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = previousEncryptionKey
      vi.unstubAllGlobals()
    }

    expect(starts).toHaveLength(2)
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(25 * 60_000)
  })
})
