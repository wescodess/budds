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

    await asAlice.mutation(api.calendarConnections.disconnect, {})
    const connection = await asAlice.query(api.calendarConnections.getByUser, {})
    expect(connection).toBeNull()
  })

  test('disconnect throws when no connection exists', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)

    await expect(
      asAlice.mutation(api.calendarConnections.disconnect, {}),
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

  test('updateTokens refreshes access token (internal)', async () => {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(USER_A)

    await asAlice.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'b2xk',
      refreshToken: 'cmVmcmVzaA==',
      expiresAt: Date.now() + 3600000,
      timezone: 'America/New_York',
    })

    const newExpiresAt = Date.now() + 7200000
    await t.mutation(internal.calendarConnections.updateTokens, {
      userId: USER_A.tokenIdentifier,
      accessToken: 'bmV3',
      expiresAt: newExpiresAt,
    })

    const tokens = await t.query(internal.calendarConnections.getTokens, {
      userId: USER_A.tokenIdentifier,
    })
    expect(tokens!.accessToken).toBe('bmV3')
    expect(tokens!.expiresAt).toBe(newExpiresAt)
  })
})
