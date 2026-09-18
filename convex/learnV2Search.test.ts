/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const identity = { tokenIdentifier: 'https://auth.example.com|search-owner', name: 'Search Owner' }
const previousV2 = process.env.LEARN_V2_ENABLED
const previousSearch = process.env.LEARN_V2_TAVILY_SEARCH_ENABLED
const previousTavilyKey = process.env.TAVILY_API_KEY

beforeEach(() => {
  process.env.LEARN_V2_ENABLED = 'true'
  process.env.LEARN_V2_TAVILY_SEARCH_ENABLED = 'true'
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  if (previousV2 === undefined) delete process.env.LEARN_V2_ENABLED
  else process.env.LEARN_V2_ENABLED = previousV2
  if (previousSearch === undefined) delete process.env.LEARN_V2_TAVILY_SEARCH_ENABLED
  else process.env.LEARN_V2_TAVILY_SEARCH_ENABLED = previousSearch
  if (previousTavilyKey === undefined) delete process.env.TAVILY_API_KEY
  else process.env.TAVILY_API_KEY = previousTavilyKey
})

async function setup() {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(identity)
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, {
    tokenIdentifier: identity.tokenIdentifier,
    enabled: true,
  })
  const folderId = await owner.mutation(api.folders.createFolder, { name: 'Public topic sources' })
  const learningVoid = await owner.mutation(api.learnV2Lifecycle.createLearningVoid, {
    folderId,
    title: 'Energy history',
    idempotencyKey: 'create-search-void',
  })
  const blueprint = await owner.mutation(api.learnV2Lifecycle.createBlueprintDraft, {
    learningVoidId: learningVoid!._id,
    expectedVoidRevision: 1,
    idempotencyKey: 'create-search-blueprint',
  })
  return {
    t,
    owner,
    learningVoidId: learningVoid!._id,
    blueprintRevisionId: blueprint!._id,
    args: {
      tokenIdentifier: identity.tokenIdentifier,
      learningVoidId: learningVoid!._id,
      blueprintRevisionId: blueprint!._id,
      expectedVoidRevision: 2,
      expectedBlueprintRecordRevision: 1,
      idempotencyKeyHash: `sha256:${'a'.repeat(64)}`,
      requestFingerprint: `sha256:${'b'.repeat(64)}`,
      queryDigest: `sha256:${'c'.repeat(64)}`,
    },
  }
}

describe('Learn V2 zero-paid search ledger', () => {
  test('enforces folder-only source policy before reserving public-web capacity', async () => {
    const { t, owner, learningVoidId, blueprintRevisionId } = await setup()
    await t.run(async ctx => await ctx.db.patch(blueprintRevisionId, { sourcePolicy: 'folder_only' }))
    const provider = vi.fn()
    vi.stubGlobal('fetch', provider)

    await expect(owner.action(api.learnV2SearchActions.searchPublicWeb, {
      learningVoidId,
      blueprintRevisionId,
      expectedVoidRevision: 2,
      expectedBlueprintRecordRevision: 1,
      query: 'history of solar energy in Ontario',
      idempotencyKey: 'folder-only-search-denied',
    })).rejects.toThrow('Web research is disabled by this source policy')
    expect(provider).not.toHaveBeenCalled()
    expect(await t.run(async ctx => ctx.db.query('searchReservations').take(1))).toEqual([])
  })

  test('runs the public action through the real digest and ledger contract', async () => {
    const { t, owner, learningVoidId, blueprintRevisionId } = await setup()
    process.env.TAVILY_API_KEY = 'tvly-action-ledger-test'
    const provider = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/usage')) {
        return Response.json({ key: { usage: 0, limit: 800 }, account: { current_plan: 'Researcher', plan_usage: 0, plan_limit: 1000, paygo_usage: 0, paygo_limit: 0 } })
      }
      return Response.json({ request_id: 'action-provider-request', usage: { credits: 1 }, results: [{ title: 'Solar history', url: 'https://example.org/solar', content: 'Public discovery.' }] })
    })
    vi.stubGlobal('fetch', provider)
    const result = await owner.action(api.learnV2SearchActions.searchPublicWeb, {
      learningVoidId,
      blueprintRevisionId,
      expectedVoidRevision: 2,
      expectedBlueprintRecordRevision: 1,
      query: 'history of solar energy in Ontario',
      idempotencyKey: 'real-action-ledger-digest',
    })
    expect(result).toMatchObject({ ok: true, status: 'consumed', credits: 1 })
    expect(provider).toHaveBeenCalledTimes(2)
    const reservation = await t.run(async ctx => ctx.db.query('searchReservations').take(1))
    expect(reservation[0]).toMatchObject({ status: 'consumed' })
    expect(reservation[0]?.idempotencyKeyHash).toMatch(/^sha256:[a-f0-9]{64}$/u)
    expect(reservation[0]?.requestFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u)
    expect(reservation[0]?.queryDigest).toMatch(/^sha256:[a-f0-9]{64}$/u)
    expect(JSON.stringify(reservation)).not.toContain('history of solar energy')
  })

  test('serializes overlapping public actions before provider usage and dispatch', async () => {
    const { owner, learningVoidId, blueprintRevisionId } = await setup()
    process.env.TAVILY_API_KEY = 'tvly-overlap-test'
    let releaseUsage!: () => void
    let markUsageStarted!: () => void
    const usageGate = new Promise<void>(resolve => { releaseUsage = resolve })
    const usageStarted = new Promise<void>(resolve => { markUsageStarted = resolve })
    const provider = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/usage')) {
        markUsageStarted()
        await usageGate
        return Response.json({ key: { usage: 0, limit: 800 }, account: { current_plan: 'Researcher', plan_usage: 0, plan_limit: 1000, paygo_usage: 0, paygo_limit: 0 } })
      }
      return Response.json({ request_id: 'overlap-provider-request', usage: { credits: 1 }, results: [] })
    })
    vi.stubGlobal('fetch', provider)
    const shared = { learningVoidId, blueprintRevisionId, expectedVoidRevision: 2, expectedBlueprintRecordRevision: 1, query: 'history of solar energy in Ontario' }
    const first = owner.action(api.learnV2SearchActions.searchPublicWeb, { ...shared, idempotencyKey: 'overlap-first' })
    await usageStarted
    const second = await owner.action(api.learnV2SearchActions.searchPublicWeb, { ...shared, idempotencyKey: 'overlap-second' })
    expect(second).toMatchObject({ ok: false, status: 'released' })
    expect(provider).toHaveBeenCalledTimes(1)
    releaseUsage()
    await expect(first).resolves.toMatchObject({ ok: true, status: 'consumed' })
    expect(provider).toHaveBeenCalledTimes(2)
  })

  test('claims four caps atomically and consumes exactly once without raw durable data', async () => {
    const { t, args } = await setup()
    const acquired = await t.mutation(internal.learnV2Search.replayOrReserve, args)
    expect(acquired.kind).toBe('acquired')
    if (acquired.kind !== 'acquired') throw new Error('expected acquired reservation')

    await t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: acquired.revision,
    })
    const authorized = await t.mutation(internal.learnV2Search.authorizeDispatch, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: acquired.revision,
      providerKeyUsage: 0,
    })
    expect(authorized.kind).toBe('authorized')
    if (authorized.kind !== 'authorized') throw new Error('expected dispatch authorization')
    await t.mutation(internal.learnV2Search.consume, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: authorized.revision,
      providerRequestId: 'provider-request-private',
    })

    const stored = await t.run(async ctx => ({
      reservation: await ctx.db.get(acquired.reservationId),
      buckets: await ctx.db.query('searchQuotaBuckets').take(8),
    }))
    expect(stored.buckets).toHaveLength(4)
    expect(stored.buckets.every(bucket => bucket.reservedCredits === 0 && bucket.consumedCredits === 1)).toBe(true)
    expect(stored.reservation).toMatchObject({ status: 'consumed', dispatchState: 'started', reconciliationRequired: false })
    const durable = JSON.stringify(stored)
    expect(durable).not.toContain('provider-request-private')
    expect(durable).not.toContain(acquired.executionToken)
    expect(stored.reservation?.providerRequestIdHash).toMatch(/^sha256:[a-f0-9]{64}$/u)

    await expect(t.mutation(internal.learnV2Search.replayOrReserve, args)).resolves.toMatchObject({
      kind: 'replayed_consumed',
      status: 'consumed',
    })
    expect((await t.run(async ctx => ctx.db.query('searchQuotaBuckets').take(8)))
      .every(bucket => bucket.consumedCredits === 1)).toBe(true)
  })

  test('rejects changed idempotency fingerprints and enforces the two-search lifetime Void cap', async () => {
    const { t, args } = await setup()
    await t.mutation(internal.learnV2Search.replayOrReserve, args)
    await expect(t.mutation(internal.learnV2Search.replayOrReserve, {
      ...args,
      requestFingerprint: `sha256:${'d'.repeat(64)}`,
    })).rejects.toThrow(/different request/)

    await expect(t.mutation(internal.learnV2Search.replayOrReserve, {
      ...args,
      idempotencyKeyHash: `sha256:${'e'.repeat(64)}`,
      requestFingerprint: `sha256:${'f'.repeat(64)}`,
    })).resolves.toMatchObject({ kind: 'acquired' })
    await expect(t.mutation(internal.learnV2Search.replayOrReserve, {
      ...args,
      idempotencyKeyHash: `sha256:${'1'.repeat(64)}`,
      requestFingerprint: `sha256:${'2'.repeat(64)}`,
    })).rejects.toThrow(/quota exhausted/)
  })

  test.each([
    ['product_month', 800],
    ['product_day', 25],
    ['user_day', 4],
  ] as const)('fails closed at the %s cap', async (scopeKind, limit) => {
    const { t, args } = await setup()
    await t.mutation(internal.learnV2Search.replayOrReserve, args)
    await t.run(async ctx => {
      const bucket = await ctx.db.query('searchQuotaBuckets')
        .withIndex('by_provider_and_scopeKind_and_scopeKey_and_periodKey', q => q
          .eq('provider', 'tavily_free')
          .eq('scopeKind', scopeKind))
        .first()
      if (!bucket) throw new Error('missing quota fixture')
      await ctx.db.patch(bucket._id, { reservedCredits: limit, consumedCredits: 0 })
    })
    await expect(t.mutation(internal.learnV2Search.replayOrReserve, {
      ...args,
      idempotencyKeyHash: `sha256:${'3'.repeat(64)}`,
      requestFingerprint: `sha256:${'4'.repeat(64)}`,
    })).rejects.toThrow(/quota exhausted/)
  })

  test('settlement never clears a circuit opened for a different reason', async () => {
    const { t, args } = await setup()
    const acquired = await t.mutation(internal.learnV2Search.replayOrReserve, args)
    if (acquired.kind !== 'acquired') throw new Error('expected acquired reservation')
    await t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: 1,
    })
    const authorized = await t.mutation(internal.learnV2Search.authorizeDispatch, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: 1,
      providerKeyUsage: 0,
    })
    if (authorized.kind !== 'authorized') throw new Error('expected dispatch')
    const ambiguous = await t.mutation(internal.learnV2Search.markAmbiguous, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: authorized.revision,
      outcomeCode: 'provider_outcome_unknown',
    })
    await t.run(async ctx => {
      const reservation = await ctx.db.get(acquired.reservationId)
      if (!reservation) throw new Error('missing reservation')
      await ctx.db.patch(reservation.productMonthBucketId, { circuitReason: 'usage_policy', circuitReservationId: undefined })
    })
    await t.mutation(internal.learnV2Search.reconcileFromUsageEvidence, {
      reservationId: acquired.reservationId,
      expectedRevision: ambiguous.revision,
      idempotencyKey: 'unrelated-circuit',
      providerKeyUsage: 1,
    })
    const bucket = await t.run(async ctx => {
      const reservation = await ctx.db.get(acquired.reservationId)
      return reservation ? await ctx.db.get(reservation.productMonthBucketId) : null
    })
    expect(bucket).toMatchObject({ reconciliationStatus: 'review_required', circuitReason: 'usage_policy' })
  })

  test('releases every claim and owns a discoverable circuit on provider usage drift', async () => {
    const { t, args } = await setup()
    const acquired = await t.mutation(internal.learnV2Search.replayOrReserve, args)
    if (acquired.kind !== 'acquired') throw new Error('expected reservation')
    await t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: 1,
    })
    await expect(t.mutation(internal.learnV2Search.authorizeDispatch, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: 1, providerKeyUsage: 7,
    })).resolves.toMatchObject({ kind: 'usage_drift', status: 'released', reconciliationRequired: true })
    const stored = await t.run(async ctx => {
      const reservation = await ctx.db.get(acquired.reservationId)
      return { reservation, buckets: reservation ? await Promise.all([reservation.productMonthBucketId, reservation.productDayBucketId, reservation.userDayBucketId, reservation.learningVoidBucketId].map(id => ctx.db.get(id))) : [] }
    })
    expect(stored.reservation).toMatchObject({ status: 'released', reconciliationRequired: true, outcomeCode: 'usage_drift' })
    expect(stored.buckets.every(bucket => bucket?.reservedCredits === 0)).toBe(true)
    expect(stored.buckets[0]).toMatchObject({ reconciliationStatus: 'review_required', circuitReason: 'usage_drift', circuitReservationId: acquired.reservationId })
    expect(stored.buckets[0]?.activeDispatchReservationId).toBeUndefined()
    await expect(t.mutation(internal.learnV2Search.replayOrReserve, args)).resolves.toMatchObject({
      kind: 'replayed_released', status: 'released', reconciliationRequired: true,
    })
  })

  test.each([
    { reason: 'usage_policy' as const, matchingUsage: 0 },
    { reason: 'usage_drift' as const, matchingUsage: 1 },
  ])('clears only matching terminal $reason circuit evidence', async ({ reason, matchingUsage }) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T12:00:00.000Z'))
    const { t, args } = await setup()
    const acquired = await t.mutation(internal.learnV2Search.replayOrReserve, args)
    if (acquired.kind !== 'acquired') throw new Error('expected reservation')
    await t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: 1,
    })
    if (reason === 'usage_policy') {
      await t.mutation(internal.learnV2Search.releasePreDispatch, {
        tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: 1, outcomeCode: 'usage_policy_denied', openCircuit: true,
      })
    }
    else {
      await t.mutation(internal.learnV2Search.authorizeDispatch, {
        tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: 1, providerKeyUsage: 1,
      })
    }
    const terminal = await t.run(ctx => ctx.db.get(acquired.reservationId))
    expect(terminal).toMatchObject({ status: 'released', reconciliationRequired: true, revision: 2 })
    if (reason === 'usage_drift') vi.advanceTimersByTime(60_001)
    await t.mutation(internal.learnV2Search.reconcileFromUsageEvidence, {
      reservationId: acquired.reservationId, expectedRevision: 2, idempotencyKey: `terminal-${reason}`, providerKeyUsage: matchingUsage,
    })
    const resolved = await t.run(async ctx => ({ reservation: await ctx.db.get(acquired.reservationId), bucket: await ctx.db.get((await ctx.db.get(acquired.reservationId))!.productMonthBucketId) }))
    expect(resolved.reservation).toMatchObject({ reconciliationRequired: false })
    expect(resolved.bucket).toMatchObject({
      reconciliationStatus: 'matched',
      providerReportedUsage: matchingUsage,
      providerUsageBaseline: reason === 'usage_drift' ? 1 : 0,
    })
    expect(resolved.bucket?.circuitReason).toBeUndefined()

    if (reason === 'usage_drift') {
      const next = await t.mutation(internal.learnV2Search.replayOrReserve, {
        ...args,
        idempotencyKeyHash: `sha256:${'1'.repeat(64)}`,
        requestFingerprint: `sha256:${'2'.repeat(64)}`,
      })
      if (next.kind !== 'acquired') throw new Error('expected reservation after drift rebase')
      await t.mutation(internal.learnV2Search.acquireDispatchLease, {
        tokenIdentifier: identity.tokenIdentifier, reservationId: next.reservationId, executionToken: next.executionToken, expectedRevision: 1,
      })
      await expect(t.mutation(internal.learnV2Search.authorizeDispatch, {
        tokenIdentifier: identity.tokenIdentifier, reservationId: next.reservationId, executionToken: next.executionToken, expectedRevision: 1, providerKeyUsage: 1,
      })).resolves.toMatchObject({ kind: 'authorized' })
    }
  })

  test.each(['usage_policy', 'usage_drift'] as const)('keeps terminal %s circuit closed when evidence does not match', async (reason) => {
    const { t, args } = await setup()
    const acquired = await t.mutation(internal.learnV2Search.replayOrReserve, args)
    if (acquired.kind !== 'acquired') throw new Error('expected reservation')
    await t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: 1,
    })
    if (reason === 'usage_policy') {
      await t.mutation(internal.learnV2Search.releasePreDispatch, {
        tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: 1, outcomeCode: 'usage_policy_denied', openCircuit: true,
      })
    }
    else {
      await t.mutation(internal.learnV2Search.authorizeDispatch, {
        tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: 1, providerKeyUsage: 1,
      })
    }
    await t.mutation(internal.learnV2Search.reconcileFromUsageEvidence, {
      reservationId: acquired.reservationId, expectedRevision: 2, idempotencyKey: `terminal-mismatch-${reason}`, providerKeyUsage: 2,
    })
    const unresolved = await t.run(async ctx => ({ reservation: await ctx.db.get(acquired.reservationId), bucket: await ctx.db.get((await ctx.db.get(acquired.reservationId))!.productMonthBucketId) }))
    expect(unresolved.reservation).toMatchObject({ reconciliationRequired: true })
    expect(unresolved.bucket).toMatchObject({ reconciliationStatus: 'review_required', circuitReason: reason, circuitReservationId: acquired.reservationId })
  })

  test('adopts changed drift evidence as a fresh observation before rebasing', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T12:00:00.000Z'))
    const { t, args } = await setup()
    const acquired = await t.mutation(internal.learnV2Search.replayOrReserve, args)
    if (acquired.kind !== 'acquired') throw new Error('expected reservation')
    await t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: 1,
    })
    await t.mutation(internal.learnV2Search.authorizeDispatch, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: 1, providerKeyUsage: 1,
    })
    vi.advanceTimersByTime(60_001)
    const observedAt = Date.now()
    await expect(t.mutation(internal.learnV2Search.reconcileFromUsageEvidence, {
      reservationId: acquired.reservationId, expectedRevision: 2, idempotencyKey: 'drift-changed-reading', providerKeyUsage: 2,
    })).resolves.toMatchObject({ status: 'released', reconciliationRequired: true, revision: 3 })
    const observing = await t.run(async ctx => ({
      reservation: await ctx.db.get(acquired.reservationId),
      bucket: await ctx.db.get((await ctx.db.get(acquired.reservationId))!.productMonthBucketId),
    }))
    expect(observing.bucket).toMatchObject({ providerReportedUsage: 2, providerReportedUsageObservedAt: observedAt, reconciliationStatus: 'review_required' })
    vi.advanceTimersByTime(59_999)
    await expect(t.mutation(internal.learnV2Search.reconcileFromUsageEvidence, {
      reservationId: acquired.reservationId, expectedRevision: 3, idempotencyKey: 'drift-not-stable', providerKeyUsage: 2,
    })).resolves.toMatchObject({ reconciliationRequired: true, revision: 4 })
    vi.advanceTimersByTime(2)
    await expect(t.mutation(internal.learnV2Search.reconcileFromUsageEvidence, {
      reservationId: acquired.reservationId, expectedRevision: 4, idempotencyKey: 'drift-stable', providerKeyUsage: 2,
    })).resolves.toMatchObject({ reconciliationRequired: false, revision: 5 })
    expect(await t.run(async ctx => ctx.db.get((await ctx.db.get(acquired.reservationId))!.productMonthBucketId)))
      .toMatchObject({ providerUsageBaseline: 2, reconciliationStatus: 'matched' })
  })

  test('serializes parallel claims at the final shared credit', async () => {
    const { t, args } = await setup()
    const seed = await t.mutation(internal.learnV2Search.replayOrReserve, args)
    if (seed.kind !== 'acquired') throw new Error('expected seed reservation')
    await t.run(async ctx => {
      const reservation = await ctx.db.get(seed.reservationId)
      if (!reservation) throw new Error('missing seed reservation')
      for (const bucketId of [reservation.productMonthBucketId, reservation.productDayBucketId, reservation.userDayBucketId, reservation.learningVoidBucketId]) {
        const bucket = await ctx.db.get(bucketId)
        if (!bucket) throw new Error('missing quota fixture')
        await ctx.db.patch(bucketId, { reservedCredits: 0 })
      }
      await ctx.db.delete(seed.reservationId)
      const bucket = await ctx.db.query('searchQuotaBuckets')
        .withIndex('by_provider_and_scopeKind_and_scopeKey_and_periodKey', q => q
          .eq('provider', 'tavily_free')
          .eq('scopeKind', 'product_day'))
        .first()
      if (!bucket) throw new Error('missing quota fixture')
      await ctx.db.patch(bucket._id, { reservedCredits: 24, consumedCredits: 0 })
    })
    const outcomes = await Promise.allSettled([
      t.mutation(internal.learnV2Search.replayOrReserve, {
        ...args,
        idempotencyKeyHash: `sha256:${'5'.repeat(64)}`,
        requestFingerprint: `sha256:${'6'.repeat(64)}`,
      }),
      t.mutation(internal.learnV2Search.replayOrReserve, {
        ...args,
        idempotencyKeyHash: `sha256:${'7'.repeat(64)}`,
        requestFingerprint: `sha256:${'8'.repeat(64)}`,
      }),
    ])
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1)
    const dayBucket = await t.run(async ctx => ctx.db.query('searchQuotaBuckets')
      .withIndex('by_provider_and_scopeKind_and_scopeKey_and_periodKey', q => q
        .eq('provider', 'tavily_free')
        .eq('scopeKind', 'product_day'))
      .first())
    expect((dayBucket?.reservedCredits ?? 0) + (dayBucket?.consumedCredits ?? 0)).toBe(25)
  })

  test('serializes provider usage preflight and dispatch behind one product lease', async () => {
    const { t, args } = await setup()
    const first = await t.mutation(internal.learnV2Search.replayOrReserve, args)
    const second = await t.mutation(internal.learnV2Search.replayOrReserve, {
      ...args,
      idempotencyKeyHash: `sha256:${'7'.repeat(64)}`,
      requestFingerprint: `sha256:${'8'.repeat(64)}`,
    })
    if (first.kind !== 'acquired' || second.kind !== 'acquired') throw new Error('expected reservations')
    await expect(t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: first.reservationId,
      executionToken: first.executionToken,
      expectedRevision: 1,
    })).resolves.toMatchObject({ kind: 'acquired' })
    await expect(t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: second.reservationId,
      executionToken: second.executionToken,
      expectedRevision: 1,
    })).resolves.toMatchObject({ kind: 'busy' })
    await t.mutation(internal.learnV2Search.releasePreDispatch, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: first.reservationId,
      executionToken: first.executionToken,
      expectedRevision: 1,
      outcomeCode: 'preflight_cancelled',
      openCircuit: false,
    })
    await expect(t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: second.reservationId,
      executionToken: second.executionToken,
      expectedRevision: 1,
    })).resolves.toMatchObject({ kind: 'acquired' })
  })

  test('takes over an expired preflight lease without releasing the stale reservation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T12:00:00.000Z'))
    const { t, args } = await setup()
    const first = await t.mutation(internal.learnV2Search.replayOrReserve, args)
    const second = await t.mutation(internal.learnV2Search.replayOrReserve, {
      ...args,
      idempotencyKeyHash: `sha256:${'7'.repeat(64)}`,
      requestFingerprint: `sha256:${'8'.repeat(64)}`,
    })
    if (first.kind !== 'acquired' || second.kind !== 'acquired') throw new Error('expected reservations')
    await t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: first.reservationId, executionToken: first.executionToken, expectedRevision: 1,
    })
    vi.advanceTimersByTime(30_001)
    await expect(t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: second.reservationId, executionToken: second.executionToken, expectedRevision: 1,
    })).resolves.toMatchObject({ kind: 'acquired' })
    const state = await t.run(async ctx => ({
      first: await ctx.db.get(first.reservationId),
      bucket: await ctx.db.get((await ctx.db.get(second.reservationId))!.productMonthBucketId),
    }))
    expect(state.first).toMatchObject({ status: 'reserved', dispatchState: 'not_started' })
    expect(state.bucket?.activeDispatchReservationId).toBe(second.reservationId)
    await expect(t.mutation(internal.learnV2Search.authorizeDispatch, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: first.reservationId, executionToken: first.executionToken, expectedRevision: 1, providerKeyUsage: 0,
    })).rejects.toThrow(/unavailable/)
    await expect(t.mutation(internal.learnV2Search.authorizeDispatch, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: second.reservationId, executionToken: second.executionToken, expectedRevision: 1, providerKeyUsage: 0,
    })).resolves.toMatchObject({ kind: 'authorized' })
  })

  test.each([
    ['day', '2026-09-14T23:59:59.500Z', 1_000],
    ['month', '2026-09-30T23:59:59.500Z', 1_000],
  ])('releases an undispatched reservation when its UTC $name rolls over', async (_label, start, advanceMs) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(start))
    const { t, args } = await setup()
    const acquired = await t.mutation(internal.learnV2Search.replayOrReserve, args)
    if (acquired.kind !== 'acquired') throw new Error('expected reservation')
    await t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: 1,
    })
    vi.advanceTimersByTime(advanceMs)
    await expect(t.mutation(internal.learnV2Search.authorizeDispatch, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: 1, providerKeyUsage: 0,
    })).resolves.toMatchObject({ kind: 'period_stale', status: 'released', reconciliationRequired: false })
    const stored = await t.run(async ctx => {
      const reservation = await ctx.db.get(acquired.reservationId)
      return { reservation, buckets: reservation ? await Promise.all([reservation.productMonthBucketId, reservation.productDayBucketId, reservation.userDayBucketId, reservation.learningVoidBucketId].map(id => ctx.db.get(id))) : [] }
    })
    expect(stored.reservation).toMatchObject({ status: 'released', dispatchState: 'not_started', outcomeCode: 'period_rolled_over' })
    expect(stored.buckets.every(bucket => bucket?.reservedCredits === 0)).toBe(true)
  })

  test('settles against the originally claimed UTC day after rollover', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T23:59:59.500Z'))
    const { t, args } = await setup()
    const acquired = await t.mutation(internal.learnV2Search.replayOrReserve, args)
    if (acquired.kind !== 'acquired') throw new Error('expected acquired reservation')
    await t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: 1,
    })
    const authorized = await t.mutation(internal.learnV2Search.authorizeDispatch, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: 1,
      providerKeyUsage: 0,
    })
    if (authorized.kind !== 'authorized') throw new Error('expected dispatch authorization')
    vi.advanceTimersByTime(2_000)
    await t.mutation(internal.learnV2Search.consume, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: authorized.revision,
      providerRequestId: 'utc-rollover-request',
    })
    const stored = await t.run(async ctx => ({
      reservation: await ctx.db.get(acquired.reservationId),
      dayBucket: await ctx.db.get((await ctx.db.get(acquired.reservationId))!.productDayBucketId),
    }))
    expect(stored.reservation?.productDayPeriodKey).toBe('2026-09-13')
    expect(stored.dayBucket).toMatchObject({ periodKey: '2026-09-13', reservedCredits: 0, consumedCredits: 1 })
  })

  test('single-winner dispatch keeps an uncertain call reserved until reconciliation', async () => {
    const { t, args } = await setup()
    const acquired = await t.mutation(internal.learnV2Search.replayOrReserve, args)
    if (acquired.kind !== 'acquired') throw new Error('expected acquired reservation')
    await t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: 1,
    })
    const authorized = await t.mutation(internal.learnV2Search.authorizeDispatch, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: 1,
      providerKeyUsage: 0,
    })
    if (authorized.kind !== 'authorized') throw new Error('expected authorized dispatch')
    await expect(t.mutation(internal.learnV2Search.authorizeDispatch, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: 1,
      providerKeyUsage: 0,
    })).resolves.toMatchObject({ kind: 'reconciliation_required', dispatchState: 'started' })

    const ambiguous = await t.mutation(internal.learnV2Search.markAmbiguous, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: authorized.revision,
      outcomeCode: 'provider_unavailable',
    })
    expect(ambiguous).toMatchObject({ status: 'reserved', reconciliationRequired: true, revision: 3 })
    const before = await t.run(async ctx => ({
      reservation: await ctx.db.get(acquired.reservationId),
      bucket: await ctx.db.get((await ctx.db.get(acquired.reservationId))!.productMonthBucketId),
    }))
    expect(before.bucket).toMatchObject({ reservedCredits: 1, consumedCredits: 0, reconciliationStatus: 'review_required' })
    await expect(t.mutation(internal.learnV2Search.replayOrReserve, args)).resolves.toMatchObject({ kind: 'reconciliation_required' })
    await expect(t.mutation(internal.learnV2Search.replayOrReserve, {
      ...args,
      idempotencyKeyHash: `sha256:${'9'.repeat(64)}`,
      requestFingerprint: `sha256:${'0'.repeat(64)}`,
    })).rejects.toThrow(/unavailable/)

    await t.mutation(internal.learnV2Search.reconcileFromUsageEvidence, {
      reservationId: acquired.reservationId,
      expectedRevision: 3,
      idempotencyKey: 'reconcile-used-1',
      providerKeyUsage: 1,
    })
    await expect(t.mutation(internal.learnV2Search.reconcileFromUsageEvidence, {
      reservationId: acquired.reservationId,
      expectedRevision: 3,
      idempotencyKey: 'reconcile-used-1',
      providerKeyUsage: 1,
    })).resolves.toMatchObject({ status: 'consumed' })
    const after = await t.run(async ctx => ({
      reservation: await ctx.db.get(acquired.reservationId),
      bucket: await ctx.db.get((await ctx.db.get(acquired.reservationId))!.productMonthBucketId),
    }))
    expect(after.reservation).toMatchObject({ status: 'consumed', reconciliationRequired: false })
    expect(after.bucket).toMatchObject({ reservedCredits: 0, consumedCredits: 1, reconciliationStatus: 'matched' })
  })

  test.each([
    { label: 'unused', providerKeyUsage: 0, status: 'released', outcomeCode: 'confirmed_unused' },
    { label: 'unknown', providerKeyUsage: 2, status: 'reserved', outcomeCode: 'reconciliation_unknown' },
  ] as const)('derives $label reconciliation from fresh usage evidence', async ({ providerKeyUsage, status, outcomeCode }) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T12:00:00.000Z'))
    const { t, args } = await setup()
    const acquired = await t.mutation(internal.learnV2Search.replayOrReserve, args)
    if (acquired.kind !== 'acquired') throw new Error('expected acquired reservation')
    await t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: 1,
    })
    const authorized = await t.mutation(internal.learnV2Search.authorizeDispatch, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: 1,
      providerKeyUsage: 0,
    })
    if (authorized.kind !== 'authorized') throw new Error('expected authorized dispatch')
    await expect(t.mutation(internal.learnV2Search.reconcileFromUsageEvidence, {
      reservationId: acquired.reservationId,
      expectedRevision: authorized.revision,
      idempotencyKey: 'too-early',
      providerKeyUsage,
    })).rejects.toThrow(/still active/)
    const ambiguous = await t.mutation(internal.learnV2Search.markAmbiguous, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: authorized.revision,
      outcomeCode: 'provider_outcome_unknown',
    })
    if (status === 'released') vi.advanceTimersByTime(60_001)
    const result = await t.mutation(internal.learnV2Search.reconcileFromUsageEvidence, {
      reservationId: acquired.reservationId,
      expectedRevision: ambiguous.revision,
      idempotencyKey: `reconcile-${status}`,
      providerKeyUsage,
    })
    expect(result).toMatchObject({ status })
    const stored = await t.run(async ctx => ({
      reservation: await ctx.db.get(acquired.reservationId),
      bucket: await ctx.db.get((await ctx.db.get(acquired.reservationId))!.productMonthBucketId),
    }))
    expect(stored.reservation).toMatchObject({ status, outcomeCode })
    if (status === 'released') {
      expect(stored.bucket).toMatchObject({ reservedCredits: 0, consumedCredits: 0, reconciliationStatus: 'matched' })
    }
    else {
      expect(stored.bucket).toMatchObject({ reservedCredits: 1, consumedCredits: 0, reconciliationStatus: 'review_required' })
    }
    await expect(t.mutation(internal.learnV2Search.reconcileFromUsageEvidence, {
      reservationId: acquired.reservationId,
      expectedRevision: ambiguous.revision,
      idempotencyKey: `reconcile-${status}`,
      providerKeyUsage: providerKeyUsage + 1,
    })).rejects.toThrow(/different reconciliation evidence/)
  })

  test('keeps an early unchanged usage reading claimed until the evidence stabilizes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T12:00:00.000Z'))
    const { t, args } = await setup()
    const acquired = await t.mutation(internal.learnV2Search.replayOrReserve, args)
    if (acquired.kind !== 'acquired') throw new Error('expected reservation')
    await t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: 1,
    })
    const authorized = await t.mutation(internal.learnV2Search.authorizeDispatch, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: 1, providerKeyUsage: 0,
    })
    if (authorized.kind !== 'authorized') throw new Error('expected dispatch')
    const ambiguous = await t.mutation(internal.learnV2Search.markAmbiguous, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: authorized.revision, outcomeCode: 'provider_outcome_unknown',
    })
    const early = await t.mutation(internal.learnV2Search.reconcileFromUsageEvidence, {
      reservationId: acquired.reservationId, expectedRevision: ambiguous.revision, idempotencyKey: 'early-unchanged-usage', providerKeyUsage: 0,
    })
    expect(early).toMatchObject({ status: 'reserved', reconciliationRequired: true, outcomeCode: 'reconciliation_unknown' })
    vi.advanceTimersByTime(60_001)
    await expect(t.mutation(internal.learnV2Search.reconcileFromUsageEvidence, {
      reservationId: acquired.reservationId, expectedRevision: early.revision, idempotencyKey: 'stabilized-unchanged-usage', providerKeyUsage: 0,
    })).resolves.toMatchObject({ status: 'released', reconciliationRequired: false })
  })

  test('keeps old-month ambiguity claimed while admitting the current period', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-30T23:59:00.000Z'))
    const { t, args } = await setup()
    const acquired = await t.mutation(internal.learnV2Search.replayOrReserve, args)
    if (acquired.kind !== 'acquired') throw new Error('expected reservation')
    await t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: 1,
    })
    const authorized = await t.mutation(internal.learnV2Search.authorizeDispatch, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: 1, providerKeyUsage: 0,
    })
    if (authorized.kind !== 'authorized') throw new Error('expected dispatch')
    const ambiguous = await t.mutation(internal.learnV2Search.markAmbiguous, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: authorized.revision, outcomeCode: 'provider_outcome_unknown',
    })
    vi.advanceTimersByTime(120_000)
    const beforeCurrentAdmission = await t.run(async ctx => {
      const reservation = await ctx.db.get(acquired.reservationId)
      if (!reservation) throw new Error('expected reservation')
      return {
        reservation,
        buckets: await Promise.all([
          reservation.productMonthBucketId,
          reservation.productDayBucketId,
          reservation.userDayBucketId,
          reservation.learningVoidBucketId,
        ].map(id => ctx.db.get(id))),
      }
    })
    expect(beforeCurrentAdmission.reservation).toMatchObject({
      status: 'reserved',
      reconciliationRequired: true,
    })
    expect(beforeCurrentAdmission.buckets.every(bucket => bucket?.reservedCredits === 1 && bucket.consumedCredits === 0)).toBe(true)
    expect(beforeCurrentAdmission.buckets[0]).toMatchObject({
      reconciliationStatus: 'review_required',
      circuitReason: 'dispatch_uncertain',
      circuitReservationId: acquired.reservationId,
    })

    const current = await t.mutation(internal.learnV2Search.replayOrReserve, {
      ...args,
      idempotencyKeyHash: `sha256:${'7'.repeat(64)}`,
      requestFingerprint: `sha256:${'8'.repeat(64)}`,
    })
    expect(current).toMatchObject({ kind: 'acquired' })

    const beforeReconciliation = await t.run(async ctx => ({
      reservation: await ctx.db.get(acquired.reservationId),
      buckets: await Promise.all(beforeCurrentAdmission.buckets.map(bucket => ctx.db.get(bucket!._id))),
    }))
    const unresolved = await t.mutation(internal.learnV2Search.reconcileFromUsageEvidence, {
      reservationId: acquired.reservationId, expectedRevision: ambiguous.revision, idempotencyKey: 'cross-month-evidence', providerKeyUsage: 0,
    })
    expect(unresolved).toMatchObject({ status: 'reserved', reconciliationRequired: true, outcomeCode: 'reconciliation_unknown' })
    const afterReconciliation = await t.run(async ctx => ({
      reservation: await ctx.db.get(acquired.reservationId),
      buckets: await Promise.all(beforeCurrentAdmission.buckets.map(bucket => ctx.db.get(bucket!._id))),
    }))
    expect(afterReconciliation.reservation).toMatchObject({
      status: 'reserved',
      reconciliationRequired: true,
      outcomeCode: 'reconciliation_unknown',
    })
    expect(afterReconciliation.buckets.map(bucket => ({
      reservedCredits: bucket?.reservedCredits,
      consumedCredits: bucket?.consumedCredits,
    }))).toEqual(beforeReconciliation.buckets.map(bucket => ({
      reservedCredits: bucket?.reservedCredits,
      consumedCredits: bucket?.consumedCredits,
    })))
    expect(afterReconciliation.buckets[0]).toMatchObject({
      reconciliationStatus: 'review_required',
      circuitReason: 'dispatch_uncertain',
      circuitReservationId: acquired.reservationId,
    })
  })

  test.each(['usage_policy', 'usage_drift'] as const)('retires old-month terminal %s circuit without rewriting historical counters', async (reason) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-30T23:58:00.000Z'))
    const { t, args } = await setup()
    const acquired = await t.mutation(internal.learnV2Search.replayOrReserve, args)
    if (acquired.kind !== 'acquired') throw new Error('expected reservation')
    await t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: 1,
    })
    if (reason === 'usage_policy') {
      await t.mutation(internal.learnV2Search.releasePreDispatch, {
        tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: 1, outcomeCode: 'usage_policy_denied', openCircuit: true,
      })
    }
    else {
      await t.mutation(internal.learnV2Search.authorizeDispatch, {
        tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: 1, providerKeyUsage: 3,
      })
    }
    const before = await t.run(async ctx => {
      const reservation = await ctx.db.get(acquired.reservationId)
      return reservation ? await ctx.db.get(reservation.productMonthBucketId) : null
    })
    vi.setSystemTime(new Date('2026-10-01T00:01:00.000Z'))
    await expect(t.mutation(internal.learnV2Search.reconcileFromUsageEvidence, {
      reservationId: acquired.reservationId, expectedRevision: 2, idempotencyKey: `old-terminal-${reason}`, providerKeyUsage: 0,
    })).resolves.toMatchObject({ reconciliationRequired: false })
    const after = await t.run(async ctx => {
      const reservation = await ctx.db.get(acquired.reservationId)
      return reservation ? await ctx.db.get(reservation.productMonthBucketId) : null
    })
    expect(after).toMatchObject({
      reservedCredits: before?.reservedCredits,
      consumedCredits: before?.consumedCredits,
      providerUsageBaseline: before?.providerUsageBaseline,
      reconciliationStatus: 'matched',
    })
    expect(after?.circuitReason).toBeUndefined()
  })

  test('records unavailable reconciliation evidence durably with replay and conflict protection', async () => {
    const { t, args } = await setup()
    const acquired = await t.mutation(internal.learnV2Search.replayOrReserve, args)
    if (acquired.kind !== 'acquired') throw new Error('expected reservation')
    await t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: 1,
    })
    const authorized = await t.mutation(internal.learnV2Search.authorizeDispatch, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: 1, providerKeyUsage: 0,
    })
    if (authorized.kind !== 'authorized') throw new Error('expected dispatch')
    const ambiguous = await t.mutation(internal.learnV2Search.markAmbiguous, {
      tokenIdentifier: identity.tokenIdentifier, reservationId: acquired.reservationId, executionToken: acquired.executionToken, expectedRevision: authorized.revision, outcomeCode: 'provider_outcome_unknown',
    })
    const command = { reservationId: acquired.reservationId, expectedRevision: ambiguous.revision, idempotencyKey: 'usage-unavailable-reconciliation' }
    await expect(t.mutation(internal.learnV2Search.reconcileUsageUnavailable, command)).resolves.toMatchObject({ reconciliationRequired: true, revision: 4 })
    await expect(t.mutation(internal.learnV2Search.reconcileUsageUnavailable, command)).resolves.toMatchObject({ reconciliationRequired: true, revision: 4 })
    const stored = await t.run(async ctx => ({ reservation: await ctx.db.get(acquired.reservationId), bucket: await ctx.db.get((await ctx.db.get(acquired.reservationId))!.productMonthBucketId) }))
    expect(stored.reservation).toMatchObject({ status: 'reserved', reconciliationRequired: true, outcomeCode: 'reconciliation_unknown' })
    expect(stored.reservation?.reconciliationKeyHash).toMatch(/^sha256:[a-f0-9]{64}$/u)
    expect(stored.reservation?.reconciliationRequestFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u)
    expect(stored.bucket).toMatchObject({ reservedCredits: 1, reconciliationStatus: 'review_required', circuitReason: 'dispatch_uncertain' })
    await expect(t.mutation(internal.learnV2Search.reconcileFromUsageEvidence, {
      ...command, providerKeyUsage: 1,
    })).rejects.toThrow(/different reconciliation evidence/)
  })

  test.each([
    { reservedCredits: -1, consumedCredits: 0, revision: 1 },
    { reservedCredits: 0.5, consumedCredits: 0, revision: 1 },
    { reservedCredits: 0, consumedCredits: 801, revision: 1 },
    { reservedCredits: 0, consumedCredits: 0, revision: 0 },
  ])('fails closed on malformed quota counters %#', async (poison) => {
    const { t, args } = await setup()
    const seed = await t.mutation(internal.learnV2Search.replayOrReserve, args)
    if (seed.kind !== 'acquired') throw new Error('expected seed reservation')
    await t.run(async ctx => {
      const reservation = await ctx.db.get(seed.reservationId)
      if (!reservation) throw new Error('missing reservation')
      await ctx.db.delete(seed.reservationId)
      for (const id of [reservation.productMonthBucketId, reservation.productDayBucketId, reservation.userDayBucketId, reservation.learningVoidBucketId]) {
        const bucket = await ctx.db.get(id)
        if (!bucket) throw new Error('missing bucket')
        await ctx.db.patch(id, { reservedCredits: 0 })
      }
      await ctx.db.patch(reservation.productMonthBucketId, poison)
    })
    await expect(t.mutation(internal.learnV2Search.replayOrReserve, {
      ...args,
      idempotencyKeyHash: `sha256:${'f'.repeat(64)}`,
      requestFingerprint: `sha256:${'0'.repeat(64)}`,
    })).rejects.toThrow(/Quota ledger unavailable/)
    expect(await t.run(async ctx => ctx.db.query('searchReservations').take(1))).toHaveLength(0)
  })

  test.each([
    ['productMonthBucketId', { userId: 'wrong-owner' }],
    ['productDayBucketId', { scopeKind: 'user_day' }],
    ['userDayBucketId', { scopeKey: `sha256:${'f'.repeat(64)}` }],
    ['userDayBucketId', { periodKey: '2026-09-13' }],
    ['learningVoidBucketId', { learningVoidId: undefined }],
    ['productMonthBucketId', { limit: 799 }],
  ] as const)('fails settlement atomically when %s identity drifts', async (bucketField, patch) => {
    const { t, args } = await setup()
    const acquired = await t.mutation(internal.learnV2Search.replayOrReserve, args)
    if (acquired.kind !== 'acquired') throw new Error('expected acquired reservation')
    await t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: 1,
    })
    const authorized = await t.mutation(internal.learnV2Search.authorizeDispatch, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: 1,
      providerKeyUsage: 0,
    })
    if (authorized.kind !== 'authorized') throw new Error('expected dispatch')
    await t.run(async ctx => {
      const reservation = await ctx.db.get(acquired.reservationId)
      if (!reservation) throw new Error('missing reservation')
      await ctx.db.patch(reservation[bucketField], patch as never)
    })
    await expect(t.mutation(internal.learnV2Search.consume, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: authorized.revision,
      providerRequestId: 'tuple-drift-request',
    })).rejects.toThrow(/Quota ledger unavailable/)
    const buckets = await t.run(async ctx => ctx.db.query('searchQuotaBuckets').take(8))
    expect(buckets.every(bucket => bucket.reservedCredits === 1 && bucket.consumedCredits === 0)).toBe(true)
  })

  test('kill switch denies before reserve and again before dispatch with a releasable claim', async () => {
    const { t, args } = await setup()
    process.env.LEARN_V2_TAVILY_SEARCH_ENABLED = 'false'
    await expect(t.mutation(internal.learnV2Search.replayOrReserve, args)).rejects.toThrow(/unavailable/)
    expect(await t.run(async ctx => ctx.db.query('searchReservations').take(1))).toHaveLength(0)

    process.env.LEARN_V2_TAVILY_SEARCH_ENABLED = 'true'
    const acquired = await t.mutation(internal.learnV2Search.replayOrReserve, args)
    if (acquired.kind !== 'acquired') throw new Error('expected acquired reservation')
    await t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: 1,
    })
    process.env.LEARN_V2_TAVILY_SEARCH_ENABLED = 'false'
    await expect(t.mutation(internal.learnV2Search.authorizeDispatch, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: 1,
      providerKeyUsage: 0,
    })).rejects.toThrow(/unavailable/)
    await t.mutation(internal.learnV2Search.releasePreDispatch, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: acquired.reservationId,
      executionToken: acquired.executionToken,
      expectedRevision: 1,
      outcomeCode: 'dispatch_authorization_denied',
      openCircuit: false,
    })
    expect(await t.run(async ctx => ctx.db.get(acquired.reservationId))).toMatchObject({ status: 'released' })
  })

  test('expiry cleanup releases only proven undispatched reservations', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T23:59:59.000Z'))
    const { t, args } = await setup()
    const dispatched = await t.mutation(internal.learnV2Search.replayOrReserve, args)
    if (dispatched.kind !== 'acquired') throw new Error('expected acquired reservation')
    const undispatched = await t.mutation(internal.learnV2Search.replayOrReserve, {
      ...args,
      idempotencyKeyHash: `sha256:${'d'.repeat(64)}`,
      requestFingerprint: `sha256:${'e'.repeat(64)}`,
    })
    if (undispatched.kind !== 'acquired') throw new Error('expected second reservation')
    await t.mutation(internal.learnV2Search.acquireDispatchLease, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: dispatched.reservationId,
      executionToken: dispatched.executionToken,
      expectedRevision: 1,
    })
    await t.mutation(internal.learnV2Search.authorizeDispatch, {
      tokenIdentifier: identity.tokenIdentifier,
      reservationId: dispatched.reservationId,
      executionToken: dispatched.executionToken,
      expectedRevision: 1,
      providerKeyUsage: 0,
    })
    vi.advanceTimersByTime(6 * 60 * 1000)
    await expect(t.mutation(internal.learnV2Search.cleanupExpiredUndispatched, {})).resolves.toMatchObject({ released: 1 })
    expect(await t.run(async ctx => ctx.db.get(undispatched.reservationId))).toMatchObject({
      status: 'released',
      outcomeCode: 'expired_before_dispatch',
    })
    expect(await t.run(async ctx => ctx.db.get(dispatched.reservationId))).toMatchObject({
      status: 'reserved',
      dispatchState: 'started',
      reconciliationRequired: true,
    })
  })
})
