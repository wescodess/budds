/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|reconciliation-owner', name: 'Owner' }

async function connection() {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(OWNER)
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: OWNER.tokenIdentifier, enabled: true })
  const id = await owner.mutation(api.calendarConnections.upsertConnection, { provider: 'google', accessToken: btoa('access'), refreshToken: btoa('refresh'), expiresAt: Date.now() + 3_600_000, timezone: 'UTC', grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned', 'https://www.googleapis.com/auth/calendar.events.freebusy'], learnV2ConsentVersion: 1 })
  return { t, owner, id }
}

describe('Learn V2 calendar reconciliation webhook receipts', () => {
  beforeEach(() => { process.env.LEARN_V2_ENABLED = 'true'; process.env.LEARN_V2_CALENDAR_ENABLED = 'true' })
  afterEach(() => { delete process.env.LEARN_V2_ENABLED; delete process.env.LEARN_V2_CALENDAR_ENABLED })

  test('accepts only the current channel/resource/token once', async () => {
    const setup = await connection()
    await setup.t.mutation(internal.learnV2CalendarReconciliation.reserveSync, { calendarConnectionId: setup.id, leaseToken: 'lease' })
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('opaque-token')))].map(byte => byte.toString(16).padStart(2, '0')).join('')
    await setup.t.mutation(internal.learnV2CalendarReconciliation.commitWatch, { calendarConnectionId: setup.id, leaseToken: 'lease', channelId: 'channel-current', resourceId: 'resource-current', tokenHash: hash, expiresAt: Date.now() + 60_000 })
    await expect(setup.t.mutation(internal.learnV2CalendarReconciliation.acceptWebhookHint, { channelId: 'channel-current', resourceId: 'resource-current', token: 'opaque-token', messageNumber: '1', state: 'exists' })).resolves.toMatchObject({ calendarConnectionId: setup.id })
    await expect(setup.t.mutation(internal.learnV2CalendarReconciliation.acceptWebhookHint, { channelId: 'channel-current', resourceId: 'resource-current', token: 'opaque-token', messageNumber: '1', state: 'exists' })).resolves.toBeNull()
    await expect(setup.t.mutation(internal.learnV2CalendarReconciliation.acceptWebhookHint, { channelId: 'channel-old', resourceId: 'resource-current', token: 'opaque-token', messageNumber: '2', state: 'exists' })).resolves.toBeNull()
    await expect(setup.t.mutation(internal.learnV2CalendarReconciliation.acceptWebhookHint, { channelId: 'channel-current', resourceId: 'wrong-resource', token: 'opaque-token', messageNumber: '3', state: 'exists' })).resolves.toBeNull()
  })

  test('expires stale receipts in bounded batches', async () => {
    const setup = await connection()
    await setup.t.run(ctx => ctx.db.insert('calendarWebhookReceipts', { userId: OWNER.tokenIdentifier, calendarConnectionId: setup.id, channelId: 'old', messageNumber: '1', messageNumberOrder: '00000000000000000001', receivedAt: Date.now() - 8 * 24 * 60 * 60_000 }))
    await expect(setup.t.mutation(internal.learnV2CalendarReconciliation.purgeWebhookReceipts, {})).resolves.toBe(1)
  })

  test('supersedes a current watch into pending-stop and retries only pending channels', async () => {
    const setup = await connection()
    await setup.t.mutation(internal.learnV2CalendarReconciliation.reserveSync, { calendarConnectionId: setup.id, leaseToken: 'one' })
    await setup.t.mutation(internal.learnV2CalendarReconciliation.commitWatch, { calendarConnectionId: setup.id, leaseToken: 'one', channelId: 'one', resourceId: 'resource-one', tokenHash: 'hash-one', expiresAt: Date.now() + 60_000 })
    await setup.t.mutation(internal.learnV2CalendarReconciliation.reserveSync, { calendarConnectionId: setup.id, leaseToken: 'two' })
    await setup.t.mutation(internal.learnV2CalendarReconciliation.commitWatch, { calendarConnectionId: setup.id, leaseToken: 'two', channelId: 'two', resourceId: 'resource-two', tokenHash: 'hash-two', expiresAt: Date.now() + 60_000 })
    const pending = await setup.t.query(internal.learnV2CalendarReconciliation.getWatchStopBatch, { calendarConnectionId: setup.id, includeCurrent: false })
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ channelId: 'one', status: 'pending_stop' })
    await setup.t.mutation(internal.learnV2CalendarReconciliation.markWatchStopped, { calendarConnectionId: setup.id, channelId: 'one' })
    expect(await setup.t.query(internal.learnV2CalendarReconciliation.getWatchStopBatch, { calendarConnectionId: setup.id, includeCurrent: false })).toEqual([])
  })
})
