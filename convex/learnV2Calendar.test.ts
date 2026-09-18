/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import { deterministicGoogleProjectionId } from './learnV2Calendar'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|calendar-v2-owner', name: 'Calendar V2 Owner' }

async function setupProjection() {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(OWNER)
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, {
    tokenIdentifier: OWNER.tokenIdentifier,
    enabled: true,
  })
  const folderId = await owner.mutation(api.folders.createFolder, { name: 'Calendar V2' })
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const learningVoidId = await ctx.db.insert('learningVoids', {
      userId: OWNER.tokenIdentifier,
      folderId,
      title: 'Private learning title PRIVATE_FILENAME.pdf PRIVATE_EXCERPT https://private.example/source',
      status: 'scheduled',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    })
    const blueprintId = await ctx.db.insert('learnBlueprints', {
      userId: OWNER.tokenIdentifier,
      learningVoidId,
      revision: 1,
      createdAt: now,
    })
    const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', {
      userId: OWNER.tokenIdentifier,
      blueprintId,
      learningVoidId,
      revision: 1,
      recordRevision: 1,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    const objectiveId = await ctx.db.insert('learnObjectives', {
      userId: OWNER.tokenIdentifier,
      blueprintRevisionId,
      order: 0,
      title: 'Private objective title',
    })
    const studyPlanId = await ctx.db.insert('studyPlans', {
      userId: OWNER.tokenIdentifier,
      learningVoidId,
      revision: 1,
      createdAt: now,
    })
    const studyPlanRevisionId = await ctx.db.insert('studyPlanRevisions', {
      userId: OWNER.tokenIdentifier,
      studyPlanId,
      learningVoidId,
      revision: 1,
      recordRevision: 1,
      status: 'accepted',
      blueprintRevisionId,
      createdAt: now,
      acceptedAt: now,
    })
    const studySessionId = await ctx.db.insert('studySessions', {
      userId: OWNER.tokenIdentifier,
      studyPlanRevisionId,
      primaryObjectiveId: objectiveId,
      status: 'ready',
      revision: 2,
      scheduledStartAt: now + 60 * 60_000,
      scheduledEndAt: now + 90 * 60_000,
      timezone: 'America/Toronto',
    })
    return { studySessionId, studyPlanRevisionId }
  })
  const calendarConnectionId = await owner.mutation(api.calendarConnections.upsertConnection, {
    provider: 'google',
    accessToken: btoa('access-token'),
    refreshToken: btoa('refresh-token'),
    expiresAt: Date.now() + 3_600_000,
    timezone: 'America/Toronto',
    grantedScopes: [
      'https://www.googleapis.com/auth/calendar.events.owned',
      'https://www.googleapis.com/auth/calendar.events.freebusy',
    ],
    learnV2ConsentVersion: 1,
  })
  return { t, owner, calendarConnectionId, ...ids }
}

describe('Learn V2 calendar projection identity', () => {
  test('is deterministic, opaque, and Google base32hex compatible', async () => {
    const source = 'connection:kg2p3h90vxb28bhq6dy6s5a4zg7f0bq1:session:7'
    const first = await deterministicGoogleProjectionId(source)
    expect(await deterministicGoogleProjectionId(source)).toBe(first)
    expect(first).toMatch(/^b[0-9a-v]{51}$/)
    expect(first).not.toContain('kg2p3h90')
  })

  test('changes when a pinned projection input changes', async () => {
    expect(await deterministicGoogleProjectionId('connection:one:plan:1:session:1'))
      .not.toBe(await deterministicGoogleProjectionId('connection:one:plan:2:session:1'))
  })
})

describe('Learn V2 Google projection', () => {
  beforeEach(() => {
    process.env.LEARN_V2_ENABLED = 'true'
    process.env.LEARN_V2_CALENDAR_ENABLED = 'true'
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = btoa('0123456789abcdef0123456789abcdef')
    process.env.SITE_URL = 'https://budds.test'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.LEARN_V2_ENABLED
    delete process.env.LEARN_V2_CALENDAR_ENABLED
    delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
    delete process.env.SITE_URL
  })

  test('projects once with bounded FreeBusy and privacy-safe event fields', async () => {
    const setup = await setupProjection()
    const provider = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/freeBusy')) {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        expect(body).toMatchObject({ items: [{ id: 'primary' }] })
        return new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }), { status: 200 })
      }
      const body = JSON.parse(String(init.body)) as Record<string, any>
      expect(body.id).toMatch(/^b[0-9a-v]{51}$/)
      expect(body.summary).toBe('Budds study session')
      expect(body.description).toBe('https://budds.test/app/learn/today')
      for (const privateValue of [
        'Private learning title',
        'Private objective title',
        'PRIVATE_FILENAME.pdf',
        'PRIVATE_EXCERPT',
        'https://private.example/source',
      ]) expect(JSON.stringify(body)).not.toContain(privateValue)
      expect(body.extendedProperties.private.buddsProjection).not.toContain(String(setup.studySessionId))
      return new Response(JSON.stringify({ etag: 'etag-1', updated: '2030-01-01T00:00:00Z' }), { status: 200 })
    })
    vi.stubGlobal('fetch', provider)

    await expect(setup.owner.action(api.learnV2Calendar.projectSession, {
      studySessionId: setup.studySessionId,
    })).resolves.toMatchObject({ kind: 'projected', studySessionId: setup.studySessionId })
    await expect(setup.owner.action(api.learnV2Calendar.projectSession, {
      studySessionId: setup.studySessionId,
    })).resolves.toEqual({ kind: 'already_projected', studySessionId: setup.studySessionId })

    expect(provider).toHaveBeenCalledTimes(2)
    const projection = await setup.t.run(ctx => ctx.db.query('calendarProjections')
      .withIndex('by_userId_and_studySessionId', q => q.eq('userId', OWNER.tokenIdentifier).eq('studySessionId', setup.studySessionId))
      .unique())
    expect(projection).toMatchObject({
      calendarConnectionId: setup.calendarConnectionId,
      studyPlanRevisionId: setup.studyPlanRevisionId,
      pinnedPlanRevision: 1,
      pinnedSessionRevision: 2,
      status: 'projected',
      provider: 'google',
      providerEtag: 'etag-1',
    })
  })

  test('does not reserve or insert when primary calendar is busy or FreeBusy errors', async () => {
    const setup = await setupProjection()
    const busyProvider = vi.fn(async () => new Response(JSON.stringify({
      calendars: { primary: { busy: [{ start: '2030-01-01T00:00:00Z', end: '2030-01-01T01:00:00Z' }] } },
    }), { status: 200 }))
    vi.stubGlobal('fetch', busyProvider)
    await expect(setup.owner.action(api.learnV2Calendar.projectSession, {
      studySessionId: setup.studySessionId,
    })).resolves.toEqual({ kind: 'busy', studySessionId: setup.studySessionId })
    expect(await setup.t.run(ctx => ctx.db.query('calendarProjections').collect())).toEqual([])

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      calendars: { primary: { errors: [{ reason: 'internalError' }], busy: [] } },
    }), { status: 200 })))
    await expect(setup.owner.action(api.learnV2Calendar.projectSession, {
      studySessionId: setup.studySessionId,
    })).rejects.toThrow(/FreeBusy returned a calendar error/)
    expect(await setup.t.run(ctx => ctx.db.query('calendarProjections').collect())).toEqual([])
  })

  test('allows only one provider insert across concurrent retries and records a 409 as reconciliation', async () => {
    const setup = await setupProjection()
    let eventPosts = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/freeBusy')) return new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }), { status: 200 })
      eventPosts += 1
      return new Response('{}', { status: 200 })
    }))
    const concurrent = await Promise.all([
      setup.owner.action(api.learnV2Calendar.projectSession, { studySessionId: setup.studySessionId }),
      setup.owner.action(api.learnV2Calendar.projectSession, { studySessionId: setup.studySessionId }),
    ])
    expect(concurrent.filter(result => result.kind === 'projected')).toHaveLength(1)
    expect(['busy', 'already_projected']).toContain(concurrent.find(result => result.kind !== 'projected')?.kind)
    expect(eventPosts).toBe(1)

    const second = await setupProjection()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/freeBusy')
      ? new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }), { status: 200 })
      : new Response('{}', { status: 409 })))
    await expect(second.owner.action(api.learnV2Calendar.projectSession, {
      studySessionId: second.studySessionId,
    })).resolves.toEqual({ kind: 'conflict', studySessionId: second.studySessionId })
    expect(await second.t.run(ctx => ctx.db.query('calendarProjections').first()))
      .toMatchObject({ status: 'reconciliation_needed' })
  })

  test('fails closed when the independent calendar flag or required consent is absent', async () => {
    const setup = await setupProjection()
    process.env.LEARN_V2_CALENDAR_ENABLED = 'false'
    await expect(setup.owner.query(api.learnV2Calendar.getStatus, {})).resolves.toMatchObject({ enabled: false })
    await expect(setup.owner.action(api.learnV2Calendar.projectSession, {
      studySessionId: setup.studySessionId,
    })).rejects.toThrow(/calendar access denied/)
  })

  test('disconnect waits for an in-flight provider create and then removes the settled projection provider-first', async () => {
    const setup = await setupProjection()
    const externalEventId = await deterministicGoogleProjectionId(`race:${setup.studySessionId}`)
    const reserved = await setup.t.mutation(internal.learnV2Calendar.reserveProjection, {
      userId: OWNER.tokenIdentifier,
      studySessionId: setup.studySessionId,
      externalEventId,
    })
    expect(reserved.kind).toBe('reserved')
    const leaseToken = 'provider-create-lease'
    await expect(setup.t.mutation(internal.learnV2Calendar.claimProviderCreate, {
      projectionId: reserved.projection!._id,
      userId: OWNER.tokenIdentifier,
      leaseToken,
    })).resolves.toBe(true)

    const provider = vi.fn(async (url: string) => new Response(null, { status: url.includes('/revoke') ? 200 : 204 }))
    vi.stubGlobal('fetch', provider)
    await expect(setup.owner.action(api.calendarEvents.disconnectCalendar, {})).resolves.toEqual({
      disconnected: false,
      googleEventsDeleted: 0,
      googleEventsFailed: 0,
    })
    expect(provider).not.toHaveBeenCalled()

    await expect(setup.t.mutation(internal.learnV2Calendar.commitProjection, {
      projectionId: reserved.projection!._id,
      userId: OWNER.tokenIdentifier,
      leaseToken,
    })).resolves.toBe(reserved.projection!._id)
    await expect(setup.t.action(internal.calendarEvents.continueDisconnect, {
      calendarConnectionId: setup.calendarConnectionId,
    })).resolves.toMatchObject({ disconnected: true, googleEventsDeleted: 1 })
    expect(provider).toHaveBeenCalledTimes(2)
    expect(String(provider.mock.calls[0]![0])).toContain(externalEventId)
    expect(await setup.t.run(ctx => ctx.db.get(reserved.projection!._id))).toBeNull()
    expect(await setup.t.run(ctx => ctx.db.get(setup.calendarConnectionId))).toBeNull()
  })

  test('records only a newer external move with different times as a redacted proposal', async () => {
    const setup = await setupProjection()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/freeBusy')
      ? new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }), { status: 200 })
      : new Response('{}', { status: 200 })))
    await setup.owner.action(api.learnV2Calendar.projectSession, { studySessionId: setup.studySessionId })
    const projection = await setup.t.run(ctx => ctx.db.query('calendarProjections').withIndex('by_userId_and_studySessionId', q => q.eq('userId', OWNER.tokenIdentifier).eq('studySessionId', setup.studySessionId)).unique())
    const session = await setup.t.run(ctx => ctx.db.get(setup.studySessionId))
    const providerTime = Date.now() + 10_000
    await setup.t.mutation(internal.learnV2CalendarReconciliation.recordExternalChange, { calendarConnectionId: setup.calendarConnectionId, externalEventId: projection!.externalEventId!, kind: 'moved', providerUpdatedAt: providerTime, proposedStartAt: session!.scheduledStartAt, proposedEndAt: session!.scheduledEndAt })
    expect(await setup.t.run(ctx => ctx.db.query('calendarReconciliationProposals').first())).toBeNull()
    const end = session!.scheduledEndAt ?? session!.scheduledStartAt + 30 * 60_000
    await setup.t.mutation(internal.learnV2CalendarReconciliation.recordExternalChange, { calendarConnectionId: setup.calendarConnectionId, externalEventId: projection!.externalEventId!, kind: 'moved', providerUpdatedAt: providerTime + 1, proposedStartAt: session!.scheduledStartAt + 60_000, proposedEndAt: end + 60_000 })
    expect(await setup.t.run(ctx => ctx.db.query('calendarReconciliationProposals').first())).toMatchObject({ kind: 'moved', proposedStartAt: session!.scheduledStartAt + 60_000 })
    await setup.t.mutation(internal.learnV2CalendarReconciliation.recordExternalChange, { calendarConnectionId: setup.calendarConnectionId, externalEventId: projection!.externalEventId!, kind: 'deleted', providerUpdatedAt: providerTime + 2 })
    expect(await setup.t.run(ctx => ctx.db.query('calendarReconciliationProposals').first())).toMatchObject({ kind: 'deleted' })
  })
})
