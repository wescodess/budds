/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const USER_A = {
  tokenIdentifier: 'https://auth.example.com|user_cal_a',
  name: 'Alice',
  email: 'alice@example.com',
}

const USER_B = {
  tokenIdentifier: 'https://auth.example.com|user_cal_b',
  name: 'Bob',
  email: 'bob@example.com',
}

describe('calendarConnections', () => {
  test('getByUser returns null when no connection exists', async () => {
    const t = convexTest(schema, modules)
    const result = await t.withIdentity(USER_A).query(api.calendarConnections.getByUser, {})
    expect(result).toBeNull()
  })

  test('upsertConnection creates a new connection', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)

    const id = await asAlice.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'dG9rZW4=',
      refreshToken: 'cmVmcmVzaA==',
      expiresAt: Date.now() + 3600000,
      timezone: 'America/New_York',
    })

    expect(id).toBeTruthy()

    const connection = await asAlice.query(api.calendarConnections.getByUser, {})
    expect(connection).not.toBeNull()
    expect(connection!.provider).toBe('google')
    expect(connection!.timezone).toBe('America/New_York')
    expect(connection!.status).toBe('connected')
  })

  test('upsertConnection updates existing connection', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)

    await asAlice.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'dG9rZW4=',
      refreshToken: 'cmVmcmVzaA==',
      expiresAt: Date.now() + 3600000,
      timezone: 'America/New_York',
    })

    await asAlice.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'bmV3dG9rZW4=',
      refreshToken: 'bmV3cmVmcmVzaA==',
      expiresAt: Date.now() + 7200000,
      timezone: 'Europe/London',
    })

    const connection = await asAlice.query(api.calendarConnections.getByUser, {})
    expect(connection!.timezone).toBe('Europe/London')
  })

  test('disconnect removes the connection', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)

    await asAlice.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'dG9rZW4=',
      refreshToken: 'cmVmcmVzaA==',
      expiresAt: Date.now() + 3600000,
      timezone: 'America/New_York',
    })

    await asAlice.mutation(internal.calendarConnections.disconnect, {})
    const connection = await asAlice.query(api.calendarConnections.getByUser, {})
    expect(connection).toBeNull()
  })

  test('local disconnect cannot bypass provider-first event deletion', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)

    const connectionId = await asAlice.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'dG9rZW4=',
      refreshToken: 'cmVmcmVzaA==',
      expiresAt: Date.now() + 3600000,
      timezone: 'America/New_York',
    })

    const folderId = await asAlice.mutation(api.folders.createFolder, { name: 'Cal Folder' })
    const { courseId } = await asAlice.mutation(api.courses.create, {
      title: 'Cal Course',
      folderId,
      sourceType: 'web-only',
      webSearchEnabled: true,
    })

    await t.mutation(internal.calendarEvents.create, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'evt_disc_1',
      courseId,
      scheduledAt: Date.now() + 86_400_000,
      sessionType: 'new-content',
    })

    await t.mutation(internal.calendarEvents.create, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionId,
      calendarEventId: 'evt_disc_2',
      courseId,
      scheduledAt: Date.now() + 172_800_000,
      sessionType: 'review',
    })

    let events = await asAlice.query(api.calendarEvents.listByUser, {})
    expect(events).toHaveLength(2)

    await expect(asAlice.mutation(internal.calendarConnections.disconnect, {}))
      .rejects.toThrow('provider-first disconnect')

    events = await asAlice.query(api.calendarEvents.listByUser, {})
    expect(events).toHaveLength(2)

    const connection = await asAlice.query(api.calendarConnections.getByUser, {})
    expect(connection).not.toBeNull()
  })

  test('disconnect throws when no connection exists', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)

    await expect(
      asAlice.mutation(internal.calendarConnections.disconnect, {}),
    ).rejects.toThrow('No calendar connection found')
  })

  test('getByUser does not leak tokens', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)

    await asAlice.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'dG9rZW4=',
      refreshToken: 'cmVmcmVzaA==',
      expiresAt: Date.now() + 3600000,
      timezone: 'America/New_York',
    })

    const connection = await asAlice.query(api.calendarConnections.getByUser, {})
    expect(connection).not.toHaveProperty('accessToken')
    expect(connection).not.toHaveProperty('refreshToken')
    expect(connection).not.toHaveProperty('expiresAt')
  })

  test('connections are user-isolated', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)
    const asBob = t.withIdentity(USER_B)

    await asAlice.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'YWxpY2V0b2tlbg==',
      refreshToken: 'YWxpY2VyZWZyZXNo',
      expiresAt: Date.now() + 3600000,
      timezone: 'America/New_York',
    })

    const bobConnection = await asBob.query(api.calendarConnections.getByUser, {})
    expect(bobConnection).toBeNull()
  })

  test('getByUser requires authentication', async () => {
    const t = convexTest(schema, modules)
    await expect(
      t.query(api.calendarConnections.getByUser, {}),
    ).rejects.toThrow('Unauthenticated')
  })

  test('getTokens returns tokens for connected user (internal)', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)

    const expiresAt = Date.now() + 3600000
    await asAlice.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'dG9rZW4=',
      refreshToken: 'cmVmcmVzaA==',
      expiresAt,
      timezone: 'America/New_York',
    })

    const tokens = await t.query(internal.calendarConnections.getTokens, {
      userId: USER_A.tokenIdentifier,
    })
    expect(tokens).not.toBeNull()
    expect(tokens!.accessToken).toBe('dG9rZW4=')
    expect(tokens!.refreshToken).toBe('cmVmcmVzaA==')
    expect(tokens!.expiresAt).toBe(expiresAt)
  })

  test('updatePreferences stores preferences on connected calendar', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)

    await asAlice.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'dG9rZW4=',
      refreshToken: 'cmVmcmVzaA==',
      expiresAt: Date.now() + 3600000,
      timezone: 'America/New_York',
    })

    await asAlice.mutation(api.calendarConnections.updatePreferences, {
      morningStart: '09:00',
      eveningEnd: '20:00',
      sessionMinutes: 15,
      preferredDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    })

    const connection = await asAlice.query(api.calendarConnections.getByUser, {})
    expect(connection!.preferences).toEqual({
      morningStart: '09:00',
      eveningEnd: '20:00',
      sessionMinutes: 15,
      preferredDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    })
  })

  test('updatePreferences overwrites existing preferences', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)

    await asAlice.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'dG9rZW4=',
      refreshToken: 'cmVmcmVzaA==',
      expiresAt: Date.now() + 3600000,
      timezone: 'America/New_York',
    })

    await asAlice.mutation(api.calendarConnections.updatePreferences, {
      morningStart: '09:00',
      eveningEnd: '20:00',
      sessionMinutes: 15,
      preferredDays: ['mon', 'tue', 'wed'],
    })

    await asAlice.mutation(api.calendarConnections.updatePreferences, {
      morningStart: '07:00',
      eveningEnd: '22:00',
      sessionMinutes: 25,
      preferredDays: ['sat', 'sun'],
    })

    const connection = await asAlice.query(api.calendarConnections.getByUser, {})
    expect(connection!.preferences).toEqual({
      morningStart: '07:00',
      eveningEnd: '22:00',
      sessionMinutes: 25,
      preferredDays: ['sat', 'sun'],
    })
  })

  test('updatePreferences throws when no connection exists', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)

    await expect(
      asAlice.mutation(api.calendarConnections.updatePreferences, {
        morningStart: '09:00',
        eveningEnd: '20:00',
        sessionMinutes: 15,
        preferredDays: ['mon'],
      }),
    ).rejects.toThrow('No calendar connection found')
  })

  test('updatePreferences rejects invalid or unusable daily windows', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)
    await asAlice.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'dG9rZW4=',
      refreshToken: 'cmVmcmVzaA==',
      expiresAt: Date.now() + 3600000,
      timezone: 'UTC',
    })

    await expect(asAlice.mutation(api.calendarConnections.updatePreferences, {
      morningStart: '99:99',
      eveningEnd: '20:00',
      sessionMinutes: 25,
      preferredDays: ['mon'],
    })).rejects.toThrow('HH:MM')
    await expect(asAlice.mutation(api.calendarConnections.updatePreferences, {
      morningStart: '20:00',
      eveningEnd: '20:10',
      sessionMinutes: 25,
      preferredDays: ['mon'],
    })).rejects.toThrow('fit at least one session')
  })

  test('updatePreferences requires authentication', async () => {
    const t = convexTest(schema, modules)
    await expect(
      t.mutation(api.calendarConnections.updatePreferences, {
        morningStart: '09:00',
        eveningEnd: '20:00',
        sessionMinutes: 15,
        preferredDays: ['mon'],
      }),
    ).rejects.toThrow('Unauthenticated')
  })

  test('getByUser returns null preferences when none set', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)

    await asAlice.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'dG9rZW4=',
      refreshToken: 'cmVmcmVzaA==',
      expiresAt: Date.now() + 3600000,
      timezone: 'America/New_York',
    })

    const connection = await asAlice.query(api.calendarConnections.getByUser, {})
    expect(connection!.preferences).toBeNull()
  })

  test('updateTokens refreshes access token (internal)', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)

    const calendarConnectionId = await asAlice.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'b2xk',
      refreshToken: 'cmVmcmVzaA==',
      expiresAt: Date.now() + 3600000,
      timezone: 'America/New_York',
    })

    const newExpiresAt = Date.now() + 7200000
    await t.mutation(internal.calendarConnections.updateTokens, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId,
      expectedStatus: 'connected',
      accessToken: 'bmV3',
      expiresAt: newExpiresAt,
    })

    const tokens = await t.query(internal.calendarConnections.getTokens, {
      userId: USER_A.tokenIdentifier,
    })
    expect(tokens!.accessToken).toBe('bmV3')
    expect(tokens!.expiresAt).toBe(newExpiresAt)
  })

  test('getConnectedUserPage returns user IDs for connected calendars', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)
    const asBob = t.withIdentity(USER_B)

    await asAlice.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'dG9rZW4=',
      refreshToken: 'cmVmcmVzaA==',
      expiresAt: Date.now() + 3600000,
      timezone: 'America/New_York',
    })

    await asBob.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'Ym9idG9rZW4=',
      refreshToken: 'Ym9icmVmcmVzaA==',
      expiresAt: Date.now() + 3600000,
      timezone: 'Europe/London',
    })

    const page = await t.query(internal.calendarConnections.getConnectedUserPage, { cursor: null })
    expect(page.userIds).toHaveLength(2)
    expect(page.userIds).toContain(USER_A.tokenIdentifier)
    expect(page.userIds).toContain(USER_B.tokenIdentifier)
  })

  test('getConnectedUserPage excludes disconnected users', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)

    await asAlice.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'dG9rZW4=',
      refreshToken: 'cmVmcmVzaA==',
      expiresAt: Date.now() + 3600000,
      timezone: 'America/New_York',
    })

    await asAlice.mutation(internal.calendarConnections.disconnect, {})

    const page = await t.query(internal.calendarConnections.getConnectedUserPage, { cursor: null })
    expect(page.userIds).toHaveLength(0)
  })

  test('getConnectionByUser returns full connection for connected user', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)

    await asAlice.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'dG9rZW4=',
      refreshToken: 'cmVmcmVzaA==',
      expiresAt: Date.now() + 3600000,
      timezone: 'America/New_York',
    })

    const connection = await t.query(internal.calendarConnections.getConnectionByUser, {
      userId: USER_A.tokenIdentifier,
    })
    expect(connection).not.toBeNull()
    expect(connection!.accessToken).toBe('dG9rZW4=')
    expect(connection!.timezone).toBe('America/New_York')
  })

  test('getConnectionByUser returns null for non-existent user', async () => {
    const t = convexTest(schema, modules)

    const connection = await t.query(internal.calendarConnections.getConnectionByUser, {
      userId: 'nonexistent|user',
    })
    expect(connection).toBeNull()
  })

  test('[P1] OAuth upsert cannot reopen a connection after durable disconnect begins', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)
    const calendarConnectionId = await asAlice.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'dG9rZW4=',
      refreshToken: 'cmVmcmVzaA==',
      expiresAt: Date.now() + 3600000,
      timezone: 'America/New_York',
    })
    await t.mutation(internal.calendarConnections.beginDisconnectForUser, {
      userId: USER_A.tokenIdentifier,
      leaseToken: 'oauth-race-lease',
      expectedCalendarConnectionId: calendarConnectionId,
    })

    await expect(asAlice.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'bmV3',
      refreshToken: 'bmV3LXJlZnJlc2g=',
      expiresAt: Date.now() + 7200000,
      timezone: 'UTC',
    })).rejects.toThrow('Calendar disconnect is in progress')
  })

  test('[P1] stale refresh for disconnected connection A cannot overwrite reconnected B', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)
    const connectionA = await asAlice.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'Y29ubmVjdGlvbi1h',
      refreshToken: 'cmVmcmVzaC1h',
      expiresAt: Date.now() + 3600000,
      timezone: 'UTC',
    })
    await t.mutation(internal.calendarConnections.beginDisconnectForUser, {
      userId: USER_A.tokenIdentifier,
      leaseToken: 'complete-a',
      expectedCalendarConnectionId: connectionA,
    })
    await t.mutation(internal.calendarConnections.recordDisconnectBatch, {
      calendarConnectionId: connectionA,
      leaseToken: 'complete-a',
      deletedEventIds: [],
      failures: 0,
    })
    const connectionB = await asAlice.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'Y29ubmVjdGlvbi1i',
      refreshToken: 'cmVmcmVzaC1i',
      expiresAt: Date.now() + 7200000,
      timezone: 'UTC',
    })

    await expect(t.mutation(internal.calendarConnections.updateTokens, {
      userId: USER_A.tokenIdentifier,
      calendarConnectionId: connectionA,
      expectedStatus: 'connected',
      accessToken: 'c3RhbGUtYQ==',
      expiresAt: Date.now() + 10_800_000,
    })).rejects.toThrow('Calendar connection changed')
    expect(connectionB).not.toBe(connectionA)
    expect(await t.query(internal.calendarConnections.getTokens, {
      userId: USER_A.tokenIdentifier,
    })).toMatchObject({ accessToken: 'Y29ubmVjdGlvbi1i', refreshToken: 'cmVmcmVzaC1i' })
  })

  test('[P1] connected-user pagination continues beyond the former 500-row ceiling', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      for (let index = 0; index < 501; index++) {
        await ctx.db.insert('calendarConnections', {
          userId: `calendar-scale-${index}`,
          provider: 'google',
          accessToken: 'token',
          refreshToken: 'refresh',
          expiresAt: Date.now() + 60_000,
          timezone: 'UTC',
          status: 'connected',
          connectedAt: Date.now(),
        })
      }
    })

    let cursor: string | null = null
    const userIds: string[] = []
    do {
      const page: { userIds: string[]; isDone: boolean; continueCursor: string } = await t.query(
        internal.calendarConnections.getConnectedUserPage,
        { cursor },
      )
      userIds.push(...page.userIds)
      cursor = page.isDone ? null : page.continueCursor
    } while (cursor !== null)

    expect(userIds).toHaveLength(501)
    expect(userIds).toContain('calendar-scale-500')
  })
})
