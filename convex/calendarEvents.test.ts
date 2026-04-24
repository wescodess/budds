/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
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
    expect(events[0]!.calendarEventId).toBe('google_evt_123')
    expect(events[0]!.sessionType).toBe('new-content')
    expect(events[0]!.status).toBe('scheduled')
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
    expect(events[0]!.calendarEventId).toBe('evt_1')
  })

  test('listScheduled returns only scheduled events', async () => {
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

    await asAlice.mutation(api.calendarEvents.updateStatus, {
      eventId,
      status: 'completed',
    })

    scheduled = await asAlice.query(api.calendarEvents.listScheduled, {})
    expect(scheduled).toHaveLength(0)
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

  test('getScheduledByUser returns scheduled events (internal)', async () => {
    const t = convexTest(schema, modules)
    const { courseId, connectionId } = await setupCalendarAndCourse(t)
    const asAlice = t.withIdentity(USER_A)

    const eventId = await t.mutation(internal.calendarEvents.create, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'evt_internal',
      courseId,
      scheduledAt: Date.now() + 86_400_000,
      sessionType: 'new-content',
    })

    const scheduled = await t.query(internal.calendarEvents.getScheduledByUser, {
      userId: USER_A.tokenIdentifier,
    })
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]!._id).toBe(eventId)

    await asAlice.mutation(api.calendarEvents.updateStatus, {
      eventId,
      status: 'completed',
    })

    const afterUpdate = await t.query(internal.calendarEvents.getScheduledByUser, {
      userId: USER_A.tokenIdentifier,
    })
    expect(afterUpdate).toHaveLength(0)
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
})
