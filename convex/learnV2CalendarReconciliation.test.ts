/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|reconciliation-owner', name: 'Owner' }

function testCipherMaterial() {
  return btoa(Array.from({ length: 32 }, (_, index) => String(index % 10)).join(''))
}

async function connection() {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(OWNER)
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: OWNER.tokenIdentifier, enabled: true })
  const id = await owner.mutation(api.calendarConnections.upsertConnection, { provider: 'google', accessToken: btoa('access'), refreshToken: btoa('refresh'), expiresAt: Date.now() + 3_600_000, timezone: 'UTC', grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned', 'https://www.googleapis.com/auth/calendar.events.freebusy'], learnV2ConsentVersion: 1 })
  return { t, owner, id }
}

async function connectionWithProjection() {
  const setup = await connection()
  const folderId = await setup.owner.mutation(api.folders.createFolder, { name: 'Calendar reconciliation sentinels' })
  const ids = await setup.t.run(async ctx => {
    const now = Date.now()
    const voidId = await ctx.db.insert('learningVoids', { userId: OWNER.tokenIdentifier, folderId, title: 'PRIVATE_TITLE_SENTINEL', status: 'scheduled', revision: 1, createdAt: now, updatedAt: now })
    const blueprintId = await ctx.db.insert('learnBlueprints', { userId: OWNER.tokenIdentifier, learningVoidId: voidId, revision: 1, createdAt: now })
    const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { userId: OWNER.tokenIdentifier, blueprintId, learningVoidId: voidId, revision: 1, recordRevision: 1, status: 'active', createdAt: now, updatedAt: now })
    const objectiveId = await ctx.db.insert('learnObjectives', { userId: OWNER.tokenIdentifier, blueprintRevisionId, order: 0, title: 'PRIVATE_TITLE_SENTINEL' })
    const planId = await ctx.db.insert('studyPlans', { userId: OWNER.tokenIdentifier, learningVoidId: voidId, revision: 4, createdAt: now })
    const planRevisionId = await ctx.db.insert('studyPlanRevisions', { userId: OWNER.tokenIdentifier, studyPlanId: planId, learningVoidId: voidId, revision: 4, recordRevision: 9, status: 'accepted', createdAt: now, acceptedAt: now })
    const sessionId = await ctx.db.insert('studySessions', { userId: OWNER.tokenIdentifier, studyPlanRevisionId: planRevisionId, primaryObjectiveId: objectiveId, status: 'ready', revision: 7, scheduledStartAt: now + 3_600_000, scheduledEndAt: now + 5_400_000, timezone: 'UTC' })
    const projectionId = await ctx.db.insert('calendarProjections', { userId: OWNER.tokenIdentifier, calendarConnectionId: setup.id, studySessionId: sessionId, studyPlanRevisionId: planRevisionId, pinnedPlanRevision: 4, pinnedSessionRevision: 7, provider: 'google', externalEventId: 'b0123456789abcdefghijklmnopqrstuv0123456789abcdefghijklmnop', privateMetadata: 'PRIVATE_TITLE_SENTINEL PRIVATE_FILENAME_SENTINEL PRIVATE_EXCERPT_SENTINEL https://private.example/sentinel', status: 'projected', createdAt: now, projectedAt: now, updatedAt: now, lastProviderUpdatedAt: now })
    return { planId, planRevisionId, sessionId, projectionId }
  })
  return { ...setup, ...ids }
}

describe('Learn V2 calendar reconciliation webhook receipts', () => {
  beforeEach(() => { process.env.LEARN_V2_ENABLED = 'true'; process.env.LEARN_V2_CALENDAR_ENABLED = 'true'; process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = testCipherMaterial() })
  afterEach(() => { delete process.env.LEARN_V2_ENABLED; delete process.env.LEARN_V2_CALENDAR_ENABLED; delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY; vi.unstubAllGlobals() })

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

  test('pulls paged incremental changes and commits only the final sync token', async () => {
    const setup = await connection()
    await setup.t.run(ctx => ctx.db.patch(setup.id, { learnV2SyncToken: 'old-token' }))
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('pageToken=page-2')) return new Response(JSON.stringify({ items: [], nextSyncToken: 'final-token' }), { status: 200 })
      return new Response(JSON.stringify({ items: [], nextPageToken: 'page-2' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetch)
    await expect(setup.t.action(internal.learnV2CalendarReconciliation.syncConnection, { userId: OWNER.tokenIdentifier, calendarConnectionId: setup.id })).resolves.toMatchObject({ kind: 'synced' })
    const row = await setup.t.run(ctx => ctx.db.get(setup.id))
    expect(row?.learnV2SyncToken).toBe('final-token')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  test('polling schedules and executes incremental sync without a webhook hint', async () => {
    const setup = await connection()
    await setup.t.run(ctx => ctx.db.patch(setup.id, { learnV2SyncToken: 'poll-token' }))
    const fetch = vi.fn(async () => new Response(JSON.stringify({ items: [], nextSyncToken: 'poll-final' }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await expect(setup.t.action(internal.learnV2CalendarReconciliation.maintainConnections, { cursor: null })).resolves.toMatchObject({ scheduled: 1 })
    const scheduled = await setup.t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())
    expect(scheduled.some(job => job.name.includes('learnV2CalendarReconciliation:syncConnection'))).toBe(true)
    await expect(setup.t.action(internal.learnV2CalendarReconciliation.syncConnection, { userId: OWNER.tokenIdentifier, calendarConnectionId: setup.id })).resolves.toMatchObject({ kind: 'synced' })
    expect(fetch).toHaveBeenCalledOnce()
    expect((await setup.t.run(ctx => ctx.db.get(setup.id)))?.learnV2SyncToken).toBe('poll-final')
  })

  test('later-page 410 clears cursors, schedules a full resync, and preserves Budds authority', async () => {
    const setup = await connectionWithProjection()
    await setup.t.run(ctx => ctx.db.patch(setup.id, { learnV2SyncToken: 'old-sync', learnV2SyncPageToken: 'old-page' }))
    const before = await setup.t.run(async ctx => ({ plan: await ctx.db.get(setup.planRevisionId), session: await ctx.db.get(setup.sessionId) }))
    const fetch = vi.fn(async (url: string) => {
      if (!url.includes('syncToken=')) return new Response(JSON.stringify({ items: [], nextSyncToken: 'fresh-sync' }), { status: 200 })
      if (url.includes('pageToken=page-2') || url.includes('pageToken=old-page')) return new Response(null, { status: 410 })
      return new Response(JSON.stringify({ items: [], nextPageToken: 'page-2' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetch)
    await expect(setup.t.action(internal.learnV2CalendarReconciliation.syncConnection, { userId: OWNER.tokenIdentifier, calendarConnectionId: setup.id })).resolves.toEqual({ kind: 'reset' })
    const reset = await setup.t.run(ctx => ctx.db.get(setup.id))
    expect(reset).toMatchObject({ learnV2SyncFullResync: true })
    expect(reset?.learnV2SyncToken).toBeUndefined()
    expect(reset?.learnV2SyncPageToken).toBeUndefined()
    await expect(setup.t.action(internal.learnV2CalendarReconciliation.syncConnection, { userId: OWNER.tokenIdentifier, calendarConnectionId: setup.id, fullResync: true })).resolves.toEqual({ kind: 'synced' })
    const after = await setup.t.run(async ctx => ({ connection: await ctx.db.get(setup.id), plan: await ctx.db.get(setup.planRevisionId), session: await ctx.db.get(setup.sessionId) }))
    expect(after.connection?.learnV2SyncToken).toBe('fresh-sync')
    expect(after.connection?.learnV2SyncPageToken).toBeUndefined()
    expect(after.plan).toMatchObject({ recordRevision: before.plan?.recordRevision, revision: before.plan?.revision, status: before.plan?.status })
    expect(after.session).toMatchObject({ revision: before.session?.revision, scheduledStartAt: before.session?.scheduledStartAt, scheduledEndAt: before.session?.scheduledEndAt, status: before.session?.status })
  })

  test('marks attention without touching Budds authority for sync auth and network failures', async () => {
    const setup = await connectionWithProjection()
    const before = await setup.t.run(async ctx => ({ plan: await ctx.db.get(setup.planRevisionId), session: await ctx.db.get(setup.sessionId) }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 403 })))
    await expect(setup.t.action(internal.learnV2CalendarReconciliation.syncConnection, { userId: OWNER.tokenIdentifier, calendarConnectionId: setup.id })).resolves.toEqual({ kind: 'attention' })
    expect((await setup.t.run(ctx => ctx.db.get(setup.id)))?.learnV2AttentionReason).toBe('scope_lost')
    const afterAuth = await setup.t.run(async ctx => ({ plan: await ctx.db.get(setup.planRevisionId), session: await ctx.db.get(setup.sessionId) }))
    expect(afterAuth).toEqual(before)

    await setup.t.run(ctx => ctx.db.patch(setup.id, { learnV2AttentionReason: undefined, learnV2AttentionRequiredAt: undefined }))
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    await expect(setup.t.action(internal.learnV2CalendarReconciliation.syncConnection, { userId: OWNER.tokenIdentifier, calendarConnectionId: setup.id })).rejects.toThrow('network down')
    const afterNetwork = await setup.t.run(async ctx => ({ connection: await ctx.db.get(setup.id), plan: await ctx.db.get(setup.planRevisionId), session: await ctx.db.get(setup.sessionId) }))
    expect(afterNetwork.connection?.learnV2WatchLeaseToken).toBeUndefined()
    expect({ plan: afterNetwork.plan, session: afterNetwork.session }).toEqual(before)
  })

  test('exports and public calendar surfaces exclude private projection sentinels', async () => {
    const setup = await connectionWithProjection()
    const [listed, exported] = await Promise.all([
      setup.owner.query(api.learnV2Calendar.listProjections, {}),
      setup.owner.query(api.dataExport.getUserDataPage, { collection: 'calendarProjections', paginationOpts: { cursor: null, numItems: 8 } }),
    ])
    const serialized = JSON.stringify({ listed, exported })
    for (const sentinel of ['PRIVATE_TITLE_SENTINEL', 'PRIVATE_FILENAME_SENTINEL', 'PRIVATE_EXCERPT_SENTINEL', 'https://private.example/sentinel']) expect(serialized).not.toContain(sentinel)
  })

  test('renews before stopping old channels, treats 410 as terminal, and retries a failed pending stop', async () => {
    const setup = await connection()
    process.env.LEARN_V2_CALENDAR_WEBHOOK_URL = 'https://budds.test/calendar-hook'
    await setup.t.mutation(internal.learnV2CalendarReconciliation.reserveSync, { calendarConnectionId: setup.id, leaseToken: 'old-watch-lease' })
    await setup.t.mutation(internal.learnV2CalendarReconciliation.commitWatch, { calendarConnectionId: setup.id, leaseToken: 'old-watch-lease', channelId: 'old-channel', resourceId: 'old-resource', tokenHash: 'old-hash', expiresAt: Date.now() + 60_000 })
    const calls: Array<{ url: string, body?: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined })
      if (url.endsWith('/watch')) return new Response(JSON.stringify({ resourceId: 'new-resource', expiration: String(Date.now() + 86_400_000) }), { status: 200 })
      return new Response(null, { status: 410 })
    }))
    await expect(setup.t.action(internal.learnV2CalendarReconciliation.renewWatch, { userId: OWNER.tokenIdentifier, calendarConnectionId: setup.id })).resolves.toEqual({ kind: 'watching' })
    expect(calls[0]?.url).toContain('/watch')
    expect(calls[1]?.body).toContain('old-channel')
    expect(await setup.t.query(internal.learnV2CalendarReconciliation.getWatchStopBatch, { calendarConnectionId: setup.id, includeCurrent: false })).toEqual([])

    await setup.t.mutation(internal.learnV2CalendarReconciliation.reserveSync, { calendarConnectionId: setup.id, leaseToken: 'failed-watch-lease' })
    await setup.t.mutation(internal.learnV2CalendarReconciliation.commitWatch, { calendarConnectionId: setup.id, leaseToken: 'failed-watch-lease', channelId: 'third-channel', resourceId: 'third-resource', tokenHash: 'third-hash', expiresAt: Date.now() + 60_000 })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/channels/stop') ? new Response(null, { status: 503 }) : new Response(null, { status: 200 })))
    await expect(setup.t.action(internal.learnV2CalendarReconciliation.stopPendingWatches, { userId: OWNER.tokenIdentifier, calendarConnectionId: setup.id })).resolves.toEqual({ stopped: 0, failed: 1 })
    expect(await setup.t.query(internal.learnV2CalendarReconciliation.getWatchStopBatch, { calendarConnectionId: setup.id, includeCurrent: false })).toHaveLength(1)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    await expect(setup.t.action(internal.learnV2CalendarReconciliation.stopPendingWatches, { userId: OWNER.tokenIdentifier, calendarConnectionId: setup.id })).resolves.toEqual({ stopped: 1, failed: 0 })
  })

  test('ordinary disconnect stops every watch, removes provider projections and credentials, but keeps Budds authority', async () => {
    const setup = await connectionWithProjection()
    for (const [leaseToken, channelId, resourceId] of [['disconnect-one', 'watch-one', 'resource-one'], ['disconnect-two', 'watch-two', 'resource-two']] as const) {
      await setup.t.mutation(internal.learnV2CalendarReconciliation.reserveSync, { calendarConnectionId: setup.id, leaseToken })
      await setup.t.mutation(internal.learnV2CalendarReconciliation.commitWatch, { calendarConnectionId: setup.id, leaseToken, channelId, resourceId, tokenHash: `${channelId}-hash`, expiresAt: Date.now() + 60_000 })
    }
    const requests: Array<{ url: string, method?: string, body?: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method, body: typeof init?.body === 'string' ? init.body : undefined })
      return new Response(null, { status: url.includes('/revoke') ? 200 : 204 })
    }))
    let result = await setup.owner.action(api.calendarEvents.disconnectCalendar, {})
    for (let attempt = 0; !result.disconnected && attempt < 4; attempt++) result = await setup.t.action(internal.calendarEvents.continueDisconnect, { calendarConnectionId: setup.id })
    expect(result).toMatchObject({ disconnected: true, googleEventsDeleted: 0 })
    expect(requests.filter(row => row.url.includes('/channels/stop'))).toHaveLength(2)
    expect(requests.some(row => row.method === 'DELETE' && row.url.includes('/events/'))).toBe(true)
    expect(requests.at(-1)?.url).toContain('/revoke')
    const durable = await setup.t.run(async ctx => ({ connection: await ctx.db.get(setup.id), projection: await ctx.db.get(setup.projectionId), plan: await ctx.db.get(setup.planId), revision: await ctx.db.get(setup.planRevisionId), session: await ctx.db.get(setup.sessionId), watches: await ctx.db.query('calendarWatchChannels').withIndex('by_calendarConnectionId', q => q.eq('calendarConnectionId', setup.id)).take(10) }))
    expect(durable.connection).toBeNull()
    expect(durable.projection).toBeNull()
    expect(durable.watches).toEqual([])
    expect(durable.plan).not.toBeNull()
    expect(durable.revision).not.toBeNull()
    expect(durable.session).not.toBeNull()
  })
})
