import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import {
  internalMutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server'
import { requireLearnV2QueryAccess, hasLearnV2Access } from './lib/learnV2Access'

export const SEARCH_PROVIDER = 'tavily_free' as const
export const PRODUCT_QUOTA_OWNER = '__learn_v2_search_product__'
export const DELETED_QUOTA_OWNER = '__learn_v2_search_deleted__'
export const SEARCH_RESERVATION_TTL_MS = 5 * 60 * 1000
export const SEARCH_DISPATCH_LEASE_MS = 30 * 1000
export const SEARCH_RECONCILIATION_STABILIZATION_MS = 60 * 1000
export const SEARCH_LIMITS = {
  productMonth: 800,
  productDay: 25,
  userDay: 4,
  learningVoidLifetime: 2,
} as const

const CLEANUP_BATCH = 32
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u
const EDITABLE_BLUEPRINT_STATUSES = new Set(['draft', 'source_review', 'map_review'])

type BucketScope = Doc<'searchQuotaBuckets'>['scopeKind']
type BucketDefinition = {
  userId: string
  learningVoidId?: Id<'learningVoids'>
  scopeKind: BucketScope
  scopeKey: string
  periodKey: string
  limit: number
}

async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return `sha256:${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

function assertHash(value: string, label: string) {
  if (!HASH_PATTERN.test(value)) throw new Error(`Invalid ${label}`)
}

function assertPositiveRevision(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${label}`)
}

function assertPeriod(value: string, kind: BucketScope) {
  const valid = kind === 'product_month'
    ? /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value)
    : kind === 'learning_void_broad'
      ? value === 'lifetime'
      : /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u.test(value)
  if (!valid) throw new Error('Quota ledger unavailable')
}

function assertBucketIntegrity(bucket: Doc<'searchQuotaBuckets'>, expected: BucketDefinition) {
  if (
    bucket.provider !== SEARCH_PROVIDER
    || bucket.userId !== expected.userId
    || bucket.learningVoidId !== expected.learningVoidId
    || bucket.scopeKind !== expected.scopeKind
    || bucket.scopeKey !== expected.scopeKey
    || bucket.periodKey !== expected.periodKey
    || bucket.limit !== expected.limit
    || (bucket.providerUsageBaseline !== undefined
      && (!Number.isSafeInteger(bucket.providerUsageBaseline) || bucket.providerUsageBaseline < 0))
    || (bucket.providerReportedUsageObservedAt !== undefined
      && (!Number.isSafeInteger(bucket.providerReportedUsageObservedAt) || bucket.providerReportedUsageObservedAt < 0))
    || !Number.isSafeInteger(bucket.reservedCredits)
    || bucket.reservedCredits < 0
    || !Number.isSafeInteger(bucket.consumedCredits)
    || bucket.consumedCredits < 0
    || bucket.reservedCredits + bucket.consumedCredits > bucket.limit
    || !Number.isSafeInteger(bucket.revision)
    || bucket.revision < 1
  ) throw new Error('Quota ledger unavailable')
  assertPeriod(bucket.periodKey, bucket.scopeKind)
}

async function getOrCreateBucket(ctx: MutationCtx, definition: BucketDefinition, now: number) {
  const existing = await ctx.db.query('searchQuotaBuckets')
    .withIndex('by_provider_and_scopeKind_and_scopeKey_and_periodKey', q => q
      .eq('provider', SEARCH_PROVIDER)
      .eq('scopeKind', definition.scopeKind)
      .eq('scopeKey', definition.scopeKey)
      .eq('periodKey', definition.periodKey))
    .unique()
  if (existing) {
    assertBucketIntegrity(existing, definition)
    return existing
  }
  const id = await ctx.db.insert('searchQuotaBuckets', {
    ...definition,
    provider: SEARCH_PROVIDER,
    ...(definition.scopeKind === 'product_month' ? { providerUsageBaseline: 0 } : {}),
    reservedCredits: 0,
    consumedCredits: 0,
    revision: 1,
    reconciliationStatus: 'matched',
    createdAt: now,
    updatedAt: now,
  })
  const created = await ctx.db.get(id)
  if (!created) throw new Error('Quota ledger unavailable')
  return created
}

function productUsageBaseline(bucket: Doc<'searchQuotaBuckets'>): number {
  const baseline = bucket.providerUsageBaseline ?? 0
  if (bucket.scopeKind !== 'product_month'
    || !Number.isSafeInteger(baseline)
    || baseline < 0) throw new Error('Quota ledger unavailable')
  return baseline
}

async function hasReviewRequiredCircuit(ctx: MutationCtx, month: string): Promise<boolean> {
  return await ctx.db.query('searchQuotaBuckets')
    .withIndex('by_provider_and_reconciliationStatus_and_periodKey', q => q
      .eq('provider', SEARCH_PROVIDER)
      .eq('reconciliationStatus', 'review_required')
      .eq('periodKey', month))
    .first() !== null
}

async function requireCurrentBlueprint(
  ctx: MutationCtx,
  userId: string,
  learningVoidId: Id<'learningVoids'>,
  blueprintRevisionId: Id<'learnBlueprintRevisions'>,
  expectedVoidRevision: number,
  expectedBlueprintRecordRevision: number,
) {
  const learningVoid = await ctx.db.get(learningVoidId)
  if (!learningVoid || learningVoid.userId !== userId || learningVoid.status === 'archived') {
    throw new Error('Learning Void not found')
  }
  const folder = await ctx.db.get(learningVoid.folderId)
  if (!folder || folder.userId !== userId) throw new Error('Learning Void not found')
  if (learningVoid.revision !== expectedVoidRevision) throw new Error('Learning Void revision conflict')

  const revision = await ctx.db.get(blueprintRevisionId)
  if (!revision
    || revision.userId !== userId
    || revision.learningVoidId !== learningVoidId
    || revision.recordRevision !== expectedBlueprintRecordRevision
    || !EDITABLE_BLUEPRINT_STATUSES.has(revision.status)) {
    throw new Error('Blueprint revision conflict')
  }
  const newest = await ctx.db.query('learnBlueprintRevisions')
    .withIndex('by_userId_and_blueprintId_and_revision', q => q
      .eq('userId', userId)
      .eq('blueprintId', revision.blueprintId))
    .order('desc')
    .first()
  if (!newest || newest._id !== revision._id) throw new Error('Blueprint revision conflict')
  // This is an authority boundary, not merely a UI affordance: a forged
  // client action must not spend public-search capacity on folder-only work.
  if (revision.sourcePolicy === 'folder_only') throw new Error('Web research is disabled by this source policy')
  return { learningVoid, revision }
}

function reservationView(reservation: Doc<'searchReservations'>) {
  return {
    reservationId: reservation._id,
    status: reservation.status,
    dispatchState: reservation.dispatchState,
    reconciliationRequired: reservation.reconciliationRequired,
    revision: reservation.revision,
    outcomeCode: reservation.outcomeCode,
    createdAt: reservation.createdAt,
    settledAt: reservation.settledAt,
  }
}

function ownsSettlementCapability(reservation: Doc<'searchReservations'>, tokenIdentifier: string) {
  return reservation.userId === tokenIdentifier
    || (reservation.userId === DELETED_QUOTA_OWNER && reservation.ownerDeletedAt !== undefined)
}

function bucketIds(reservation: Doc<'searchReservations'>): Id<'searchQuotaBuckets'>[] {
  return [
    reservation.productMonthBucketId,
    reservation.productDayBucketId,
    reservation.userDayBucketId,
    reservation.learningVoidBucketId,
  ]
}

async function expectedBucketDefinitions(reservation: Doc<'searchReservations'>): Promise<BucketDefinition[]> {
  const deleted = reservation.userId === DELETED_QUOTA_OWNER
  const ownerScope = deleted
    ? await sha256(`deleted-user-day:${String(reservation.userDayBucketId)}`)
    : await sha256(`owner:${reservation.userId}`)
  const voidScope = deleted
    ? await sha256(`deleted-void:${String(reservation.learningVoidBucketId)}`)
    : reservation.learningVoidId
      ? await sha256(`void:${String(reservation.learningVoidId)}`)
      : reservation.voidScopeKey
  return [
    { userId: PRODUCT_QUOTA_OWNER, scopeKind: 'product_month', scopeKey: 'global', periodKey: reservation.productMonthPeriodKey, limit: SEARCH_LIMITS.productMonth },
    { userId: PRODUCT_QUOTA_OWNER, scopeKind: 'product_day', scopeKey: 'global', periodKey: reservation.productDayPeriodKey, limit: SEARCH_LIMITS.productDay },
    { userId: reservation.userId, scopeKind: 'user_day', scopeKey: ownerScope, periodKey: reservation.userDayPeriodKey, limit: SEARCH_LIMITS.userDay },
    { userId: reservation.userId, learningVoidId: reservation.learningVoidId, scopeKind: 'learning_void_broad', scopeKey: voidScope, periodKey: 'lifetime', limit: SEARCH_LIMITS.learningVoidLifetime },
  ]
}

async function clearDispatchLease(
  ctx: MutationCtx,
  reservation: Doc<'searchReservations'>,
  now: number,
) {
  const bucket = await ctx.db.get(reservation.productMonthBucketId)
  if (!bucket) throw new Error('Quota ledger unavailable')
  if (bucket.activeDispatchReservationId === reservation._id) {
    await ctx.db.patch(bucket._id, {
      activeDispatchReservationId: undefined,
      activeDispatchLeaseExpiresAt: undefined,
      revision: bucket.revision + 1,
      updatedAt: now,
    })
  }
}

async function clearOwnedDispatchCircuit(
  ctx: MutationCtx,
  reservation: Doc<'searchReservations'>,
  now: number,
) {
  const bucket = await ctx.db.get(reservation.productMonthBucketId)
  if (!bucket) throw new Error('Quota ledger unavailable')
  if (bucket.circuitReason === 'dispatch_uncertain' && bucket.circuitReservationId === reservation._id) {
    await ctx.db.patch(bucket._id, {
      reconciliationStatus: 'matched',
      circuitReason: undefined,
      circuitReservationId: undefined,
      lastReconciledAt: now,
      revision: bucket.revision + 1,
      updatedAt: now,
    })
  }
}

async function changeBuckets(
  ctx: MutationCtx,
  reservation: Doc<'searchReservations'>,
  transition: 'consume' | 'release',
  now: number,
) {
  const ids = bucketIds(reservation)
  if (new Set(ids.map(String)).size !== 4) throw new Error('Quota ledger unavailable')
  const definitions = await expectedBucketDefinitions(reservation)
  for (const [index, id] of ids.entries()) {
    const bucket = await ctx.db.get(id)
    if (!bucket) throw new Error('Quota ledger unavailable')
    assertBucketIntegrity(bucket, definitions[index]!)
    if (bucket.reservedCredits < 1) throw new Error('Quota ledger unavailable')
    await ctx.db.patch(bucket._id, transition === 'consume'
      ? {
          reservedCredits: bucket.reservedCredits - 1,
          consumedCredits: bucket.consumedCredits + 1,
          revision: bucket.revision + 1,
          updatedAt: now,
        }
      : {
          reservedCredits: bucket.reservedCredits - 1,
          revision: bucket.revision + 1,
          updatedAt: now,
        })
  }
}

export async function releaseSearchReservationClaims(
  ctx: MutationCtx,
  reservation: Doc<'searchReservations'>,
  now: number,
) {
  await changeBuckets(ctx, reservation, 'release', now)
  await clearDispatchLease(ctx, reservation, now)
}

export async function prepareSearchReservationForAccountDeletion(
  ctx: MutationCtx,
  reservation: Doc<'searchReservations'>,
  now: number,
) {
  if (reservation.status === 'reserved' && reservation.dispatchState === 'not_started') {
    await releaseSearchReservationClaims(ctx, reservation, now)
    await ctx.db.delete(reservation._id)
    return 'deleted' as const
  }
  const productBucket = await ctx.db.get(reservation.productMonthBucketId)
  const ownsTerminalCircuit = reservation.status === 'released'
    && reservation.reconciliationRequired
    && productBucket?.circuitReservationId === reservation._id
    && (productBucket.circuitReason === 'usage_policy' || productBucket.circuitReason === 'usage_drift')
  const ownsStartedReconciliation = reservation.status === 'reserved' && reservation.dispatchState === 'started'
  if (!ownsStartedReconciliation && !ownsTerminalCircuit) {
    await ctx.db.delete(reservation._id)
    return 'deleted' as const
  }

  const ids = bucketIds(reservation)
  if (new Set(ids.map(String)).size !== 4) throw new Error('Quota ledger unavailable')
  const originalDefinitions = await expectedBucketDefinitions(reservation)
  const anonymousDefinitions: BucketDefinition[] = [
    originalDefinitions[0]!,
    originalDefinitions[1]!,
    { userId: DELETED_QUOTA_OWNER, scopeKind: 'user_day', scopeKey: await sha256(`deleted-user-day:${String(reservation.userDayBucketId)}`), periodKey: reservation.userDayPeriodKey, limit: SEARCH_LIMITS.userDay },
    { userId: DELETED_QUOTA_OWNER, scopeKind: 'learning_void_broad', scopeKey: await sha256(`deleted-void:${String(reservation.learningVoidBucketId)}`), periodKey: 'lifetime', limit: SEARCH_LIMITS.learningVoidLifetime },
  ]
  for (const [index, id] of ids.entries()) {
    const bucket = await ctx.db.get(id)
    if (!bucket) throw new Error('Quota ledger unavailable')
    try {
      assertBucketIntegrity(bucket, originalDefinitions[index]!)
    }
    catch {
      assertBucketIntegrity(bucket, anonymousDefinitions[index]!)
    }
    if (ownsStartedReconciliation && bucket.reservedCredits < 1) throw new Error('Quota ledger unavailable')
    if (index >= 2 && bucket.userId !== DELETED_QUOTA_OWNER) {
      await ctx.db.patch(bucket._id, {
        userId: DELETED_QUOTA_OWNER,
        learningVoidId: undefined,
        scopeKey: anonymousDefinitions[index]!.scopeKey,
        revision: bucket.revision + 1,
        updatedAt: now,
      })
    }
  }
  await ctx.db.patch(reservation._id, {
    userId: DELETED_QUOTA_OWNER,
    learningVoidId: undefined,
    blueprintRevisionId: undefined,
    voidScopeKey: anonymousDefinitions[3]!.scopeKey,
    idempotencyKeyHash: undefined,
    requestFingerprint: undefined,
    queryDigest: undefined,
    ownerDeletedAt: now,
    updatedAt: now,
  })
  return 'anonymized' as const
}

export const replayOrReserve = internalMutation({
  args: {
    tokenIdentifier: v.string(),
    learningVoidId: v.id('learningVoids'),
    blueprintRevisionId: v.id('learnBlueprintRevisions'),
    expectedVoidRevision: v.number(),
    expectedBlueprintRecordRevision: v.number(),
    idempotencyKeyHash: v.string(),
    requestFingerprint: v.string(),
    queryDigest: v.string(),
  },
  handler: async (ctx, args) => {
    assertPositiveRevision(args.expectedVoidRevision, 'Learning Void revision')
    assertPositiveRevision(args.expectedBlueprintRecordRevision, 'Blueprint record revision')
    assertHash(args.idempotencyKeyHash, 'idempotency key hash')
    assertHash(args.requestFingerprint, 'request fingerprint')
    assertHash(args.queryDigest, 'query digest')

    const existing = await ctx.db.query('searchReservations')
      .withIndex('by_userId_and_idempotencyKeyHash', q => q
        .eq('userId', args.tokenIdentifier)
        .eq('idempotencyKeyHash', args.idempotencyKeyHash))
      .unique()
    if (existing) {
      if (existing.requestFingerprint !== args.requestFingerprint) {
        throw new Error('Idempotency key was used for a different request')
      }
      if (existing.status === 'consumed') return { kind: 'replayed_consumed' as const, ...reservationView(existing) }
      if (existing.status === 'released') return { kind: 'replayed_released' as const, ...reservationView(existing) }
      return {
        kind: existing.dispatchState === 'started' ? 'reconciliation_required' as const : 'in_flight' as const,
        ...reservationView(existing),
      }
    }

    if (process.env.LEARN_V2_TAVILY_SEARCH_ENABLED !== 'true'
      || !(await hasLearnV2Access(ctx, args.tokenIdentifier))) {
      throw new Error('Public search unavailable')
    }
    const now = Date.now()
    const instant = new Date(now)
    const day = instant.toISOString().slice(0, 10)
    const month = day.slice(0, 7)
    if (await hasReviewRequiredCircuit(ctx, month)) throw new Error('Public search unavailable')
    await requireCurrentBlueprint(
      ctx,
      args.tokenIdentifier,
      args.learningVoidId,
      args.blueprintRevisionId,
      args.expectedVoidRevision,
      args.expectedBlueprintRecordRevision,
    )

    const ownerScope = await sha256(`owner:${args.tokenIdentifier}`)
    const voidScope = await sha256(`void:${String(args.learningVoidId)}`)
    const definitions: BucketDefinition[] = [
      { userId: PRODUCT_QUOTA_OWNER, scopeKind: 'product_month', scopeKey: 'global', periodKey: month, limit: SEARCH_LIMITS.productMonth },
      { userId: PRODUCT_QUOTA_OWNER, scopeKind: 'product_day', scopeKey: 'global', periodKey: day, limit: SEARCH_LIMITS.productDay },
      { userId: args.tokenIdentifier, scopeKind: 'user_day', scopeKey: ownerScope, periodKey: day, limit: SEARCH_LIMITS.userDay },
      { userId: args.tokenIdentifier, learningVoidId: args.learningVoidId, scopeKind: 'learning_void_broad', scopeKey: voidScope, periodKey: 'lifetime', limit: SEARCH_LIMITS.learningVoidLifetime },
    ]
    const buckets = []
    for (const definition of definitions) buckets.push(await getOrCreateBucket(ctx, definition, now))
    if (buckets.some(bucket => bucket.reconciliationStatus !== 'matched')) throw new Error('Public search unavailable')
    if (buckets.some(bucket => bucket.reservedCredits + bucket.consumedCredits >= bucket.limit)) {
      throw new Error('Public search quota exhausted')
    }
    for (const bucket of buckets) {
      await ctx.db.patch(bucket._id, {
        reservedCredits: bucket.reservedCredits + 1,
        revision: bucket.revision + 1,
        updatedAt: now,
      })
    }

    const executionToken = crypto.randomUUID()
    const executionTokenHash = await sha256(executionToken)
    const reservationId = await ctx.db.insert('searchReservations', {
      userId: args.tokenIdentifier,
      learningVoidId: args.learningVoidId,
      blueprintRevisionId: args.blueprintRevisionId,
      expectedVoidRevision: args.expectedVoidRevision,
      expectedBlueprintRecordRevision: args.expectedBlueprintRecordRevision,
      voidScopeKey: voidScope,
      provider: SEARCH_PROVIDER,
      searchClass: 'broad',
      status: 'reserved',
      dispatchState: 'not_started',
      reconciliationRequired: false,
      productMonthBucketId: buckets[0]!._id,
      productDayBucketId: buckets[1]!._id,
      userDayBucketId: buckets[2]!._id,
      learningVoidBucketId: buckets[3]!._id,
      productMonthPeriodKey: month,
      productDayPeriodKey: day,
      userDayPeriodKey: day,
      learningVoidPeriodKey: 'lifetime',
      expectedCredits: 1,
      idempotencyKeyHash: args.idempotencyKeyHash,
      requestFingerprint: args.requestFingerprint,
      queryDigest: args.queryDigest,
      executionTokenHash,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + SEARCH_RESERVATION_TTL_MS,
    })
    return {
      kind: 'acquired' as const,
      reservationId,
      executionToken,
      revision: 1,
      productMonthConsumed: buckets[0]!.consumedCredits,
    }
  },
})

export const authorizeDispatch = internalMutation({
  args: {
    tokenIdentifier: v.string(),
    reservationId: v.id('searchReservations'),
    executionToken: v.string(),
    expectedRevision: v.number(),
    providerKeyUsage: v.number(),
  },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId)
    if (!reservation || reservation.userId !== args.tokenIdentifier) throw new Error('Search reservation not found')
    if (reservation.status !== 'reserved' || reservation.dispatchState !== 'not_started') {
      return { kind: reservation.reconciliationRequired ? 'reconciliation_required' as const : 'terminal' as const, ...reservationView(reservation) }
    }
    if (reservation.revision !== args.expectedRevision
      || await sha256(args.executionToken) !== reservation.executionTokenHash) {
      throw new Error('Search reservation conflict')
    }
    if (process.env.LEARN_V2_TAVILY_SEARCH_ENABLED !== 'true'
      || !(await hasLearnV2Access(ctx, args.tokenIdentifier))) {
      throw new Error('Public search unavailable')
    }
    const now = Date.now()
    const currentDay = new Date(now).toISOString().slice(0, 10)
    const currentMonth = currentDay.slice(0, 7)
    if (await hasReviewRequiredCircuit(ctx, currentMonth)) throw new Error('Public search unavailable')
    if (!reservation.learningVoidId || !reservation.blueprintRevisionId) throw new Error('Public search unavailable')
    await requireCurrentBlueprint(
      ctx,
      args.tokenIdentifier,
      reservation.learningVoidId,
      reservation.blueprintRevisionId,
      reservation.expectedVoidRevision,
      reservation.expectedBlueprintRecordRevision,
    )
    if (!Number.isSafeInteger(args.providerKeyUsage) || args.providerKeyUsage < 0) {
      throw new Error('Public search unavailable')
    }
    if (reservation.productMonthPeriodKey !== currentMonth
      || reservation.productDayPeriodKey !== currentDay
      || reservation.userDayPeriodKey !== currentDay) {
      await releaseSearchReservationClaims(ctx, reservation, now)
      await ctx.db.patch(reservation._id, {
        status: 'released',
        reconciliationRequired: false,
        outcomeCode: 'period_rolled_over',
        settledAt: now,
        updatedAt: now,
        revision: reservation.revision + 1,
      })
      return { kind: 'period_stale' as const, status: 'released' as const, reconciliationRequired: false, revision: reservation.revision + 1 }
    }
    const monthBucket = await ctx.db.get(reservation.productMonthBucketId)
    if (!monthBucket
      || monthBucket.reconciliationStatus !== 'matched'
      || monthBucket.activeDispatchReservationId !== reservation._id
      || (monthBucket.activeDispatchLeaseExpiresAt ?? 0) <= Date.now()) {
      throw new Error('Public search unavailable')
    }
    if (args.providerKeyUsage !== productUsageBaseline(monthBucket) + monthBucket.consumedCredits) {
      await releaseSearchReservationClaims(ctx, reservation, now)
      const currentBucket = await ctx.db.get(reservation.productMonthBucketId)
      if (!currentBucket) throw new Error('Quota ledger unavailable')
      await ctx.db.patch(currentBucket._id, {
        reconciliationStatus: 'review_required',
        circuitReason: 'usage_drift',
        circuitReservationId: reservation._id,
        providerReportedUsage: args.providerKeyUsage,
        providerReportedUsageObservedAt: now,
        revision: currentBucket.revision + 1,
        updatedAt: now,
      })
      await ctx.db.patch(reservation._id, {
        status: 'released',
        reconciliationRequired: true,
        outcomeCode: 'usage_drift',
        settledAt: now,
        updatedAt: now,
        revision: reservation.revision + 1,
      })
      return { kind: 'usage_drift' as const, status: 'released' as const, reconciliationRequired: true, revision: reservation.revision + 1 }
    }
    await ctx.db.patch(reservation._id, {
      dispatchState: 'started',
      reconciliationRequired: true,
      providerUsageBeforeDispatch: args.providerKeyUsage,
      dispatchedAt: now,
      updatedAt: now,
      revision: reservation.revision + 1,
    })
    await ctx.db.patch(monthBucket._id, {
      reconciliationStatus: 'review_required',
      circuitReason: 'dispatch_uncertain',
      circuitReservationId: reservation._id,
      revision: monthBucket.revision + 1,
      updatedAt: now,
    })
    return { kind: 'authorized' as const, reservationId: reservation._id, revision: reservation.revision + 1 }
  },
})

export const acquireDispatchLease = internalMutation({
  args: {
    tokenIdentifier: v.string(),
    reservationId: v.id('searchReservations'),
    executionToken: v.string(),
    expectedRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId)
    if (!reservation || reservation.userId !== args.tokenIdentifier) throw new Error('Search reservation not found')
    if (reservation.status !== 'reserved' || reservation.dispatchState !== 'not_started') {
      return { kind: 'terminal' as const, ...reservationView(reservation) }
    }
    if (reservation.revision !== args.expectedRevision
      || await sha256(args.executionToken) !== reservation.executionTokenHash) {
      throw new Error('Search reservation conflict')
    }
    if (process.env.LEARN_V2_TAVILY_SEARCH_ENABLED !== 'true'
      || !(await hasLearnV2Access(ctx, args.tokenIdentifier))) {
      throw new Error('Public search unavailable')
    }
    const now = Date.now()
    const currentMonth = new Date(now).toISOString().slice(0, 7)
    if (await hasReviewRequiredCircuit(ctx, currentMonth)) throw new Error('Public search unavailable')
    if (!reservation.learningVoidId || !reservation.blueprintRevisionId) throw new Error('Public search unavailable')
    await requireCurrentBlueprint(
      ctx,
      args.tokenIdentifier,
      reservation.learningVoidId,
      reservation.blueprintRevisionId,
      reservation.expectedVoidRevision,
      reservation.expectedBlueprintRecordRevision,
    )
    const monthBucket = await ctx.db.get(reservation.productMonthBucketId)
    if (!monthBucket || monthBucket.reconciliationStatus !== 'matched') throw new Error('Public search unavailable')
    if (monthBucket.activeDispatchReservationId
      && monthBucket.activeDispatchReservationId !== reservation._id
      && (monthBucket.activeDispatchLeaseExpiresAt ?? 0) > now) {
      return { kind: 'busy' as const }
    }
    await ctx.db.patch(monthBucket._id, {
      activeDispatchReservationId: reservation._id,
      activeDispatchLeaseExpiresAt: now + SEARCH_DISPATCH_LEASE_MS,
      revision: monthBucket.revision + 1,
      updatedAt: now,
    })
    return { kind: 'acquired' as const, revision: reservation.revision }
  },
})

export const releasePreDispatch = internalMutation({
  args: {
    tokenIdentifier: v.string(),
    reservationId: v.id('searchReservations'),
    executionToken: v.string(),
    expectedRevision: v.number(),
    outcomeCode: v.string(),
    openCircuit: v.boolean(),
  },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId)
    if (!reservation || reservation.userId !== args.tokenIdentifier) throw new Error('Search reservation not found')
    if (reservation.status !== 'reserved') return reservationView(reservation)
    if (reservation.dispatchState !== 'not_started') throw new Error('Dispatched search cannot be released')
    if (reservation.revision !== args.expectedRevision
      || await sha256(args.executionToken) !== reservation.executionTokenHash
      || !/^[a-z0-9_]{1,64}$/u.test(args.outcomeCode)) throw new Error('Search reservation conflict')
    const now = Date.now()
    await releaseSearchReservationClaims(ctx, reservation, now)
    if (args.openCircuit) {
      const productBucket = await ctx.db.get(reservation.productMonthBucketId)
      if (!productBucket) throw new Error('Quota ledger unavailable')
      await ctx.db.patch(productBucket._id, {
        reconciliationStatus: 'review_required',
        circuitReason: 'usage_policy',
        circuitReservationId: reservation._id,
        revision: productBucket.revision + 1,
        updatedAt: now,
      })
    }
    await ctx.db.patch(reservation._id, {
      status: 'released',
      reconciliationRequired: args.openCircuit,
      outcomeCode: args.outcomeCode,
      settledAt: now,
      updatedAt: now,
      revision: reservation.revision + 1,
    })
    return { ...reservationView(reservation), status: 'released' as const, revision: reservation.revision + 1, settledAt: now }
  },
})

export const consume = internalMutation({
  args: {
    tokenIdentifier: v.string(),
    reservationId: v.id('searchReservations'),
    executionToken: v.string(),
    expectedRevision: v.number(),
    providerRequestId: v.string(),
  },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId)
    if (!reservation || !ownsSettlementCapability(reservation, args.tokenIdentifier)) throw new Error('Search reservation not found')
    if (reservation.status !== 'reserved') return reservationView(reservation)
    if (reservation.dispatchState !== 'started'
      || reservation.revision !== args.expectedRevision
      || await sha256(args.executionToken) !== reservation.executionTokenHash
      || !args.providerRequestId
      || args.providerRequestId.length > 256) throw new Error('Search reservation conflict')
    const now = Date.now()
    await changeBuckets(ctx, reservation, 'consume', now)
    await clearDispatchLease(ctx, reservation, now)
    await clearOwnedDispatchCircuit(ctx, reservation, now)
    await ctx.db.patch(reservation._id, {
      status: 'consumed',
      reconciliationRequired: false,
      providerRequestIdHash: await sha256(args.providerRequestId),
      outcomeCode: 'success_one_credit',
      settledAt: now,
      updatedAt: now,
      revision: reservation.revision + 1,
    })
    return { ...reservationView(reservation), status: 'consumed' as const, revision: reservation.revision + 1, settledAt: now }
  },
})

export const markAmbiguous = internalMutation({
  args: {
    tokenIdentifier: v.string(),
    reservationId: v.id('searchReservations'),
    executionToken: v.string(),
    expectedRevision: v.number(),
    outcomeCode: v.string(),
  },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId)
    if (!reservation || !ownsSettlementCapability(reservation, args.tokenIdentifier)) throw new Error('Search reservation not found')
    if (reservation.status !== 'reserved') return reservationView(reservation)
    if (reservation.dispatchState !== 'started'
      || reservation.revision !== args.expectedRevision
      || await sha256(args.executionToken) !== reservation.executionTokenHash
      || !/^[a-z0-9_]{1,64}$/u.test(args.outcomeCode)) throw new Error('Search reservation conflict')
    const now = Date.now()
    const productBucket = await ctx.db.get(reservation.productMonthBucketId)
    if (!productBucket) throw new Error('Quota ledger unavailable')
    await ctx.db.patch(productBucket._id, {
      reconciliationStatus: 'review_required',
      circuitReason: 'dispatch_uncertain',
      circuitReservationId: reservation._id,
      revision: productBucket.revision + 1,
      updatedAt: now,
    })
    await ctx.db.patch(reservation._id, {
      reconciliationRequired: true,
      outcomeCode: args.outcomeCode,
      updatedAt: now,
      revision: reservation.revision + 1,
    })
    await clearDispatchLease(ctx, reservation, now)
    return { ...reservationView(reservation), reconciliationRequired: true, revision: reservation.revision + 1 }
  },
})

function validateReconciliationKey(value: string) {
  if (!value.trim() || value.length > 128) throw new Error('Invalid idempotency key')
}

async function reconcileFingerprint(idempotencyKey: string, evidence: string) {
  return {
    keyHash: await sha256(`reconciliation:${idempotencyKey}`),
    requestFingerprint: await sha256(`reconciliation:${idempotencyKey}:${evidence}`),
  }
}

async function assertReconciliationCommand(
  reservation: Doc<'searchReservations'>,
  expectedRevision: number,
  keyHash: string,
  requestFingerprint: string,
) {
  if (reservation.reconciliationKeyHash === keyHash) {
    if (reservation.reconciliationRequestFingerprint !== requestFingerprint) {
      throw new Error('Idempotency key was used for different reconciliation evidence')
    }
    return 'replay' as const
  }
  if (reservation.revision !== expectedRevision) throw new Error('Search reservation conflict')
  return 'new' as const
}

export const reconcileFromUsageEvidence = internalMutation({
  args: {
    reservationId: v.id('searchReservations'),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
    providerKeyUsage: v.number(),
  },
  handler: async (ctx, args) => {
    validateReconciliationKey(args.idempotencyKey)
    if (!Number.isSafeInteger(args.providerKeyUsage) || args.providerKeyUsage < 0) {
      throw new Error('Invalid provider usage evidence')
    }
    const reservation = await ctx.db.get(args.reservationId)
    if (!reservation) throw new Error('Search reservation not found')
    const fingerprint = await reconcileFingerprint(args.idempotencyKey, `usage:${args.providerKeyUsage}`)
    if (await assertReconciliationCommand(reservation, args.expectedRevision, fingerprint.keyHash, fingerprint.requestFingerprint) === 'replay') {
      return reservationView(reservation)
    }
    const now = Date.now()
    const productBucket = await ctx.db.get(reservation.productMonthBucketId)
    if (!productBucket) throw new Error('Quota ledger unavailable')
    const baseline = productUsageBaseline(productBucket)
    const currentMonth = new Date(now).toISOString().slice(0, 7)
    const evidenceMatchesReservationPeriod = reservation.productMonthPeriodKey === currentMonth

    if (reservation.status !== 'reserved') {
      const ownsTerminalCircuit = (productBucket.circuitReason === 'usage_policy' || productBucket.circuitReason === 'usage_drift')
        && productBucket.circuitReservationId === reservation._id
      const expectedProviderUsage = baseline + productBucket.consumedCredits
      const historicalCircuit = ownsTerminalCircuit && !evidenceMatchesReservationPeriod
      const policyResolved = ownsTerminalCircuit
        && productBucket.circuitReason === 'usage_policy'
        && (historicalCircuit || args.providerKeyUsage === expectedProviderUsage)
      const driftObservationChanged = productBucket.circuitReason === 'usage_drift'
        && evidenceMatchesReservationPeriod
        && productBucket.providerReportedUsage !== args.providerKeyUsage
      const driftStable = productBucket.providerReportedUsageObservedAt !== undefined
        && now - productBucket.providerReportedUsageObservedAt >= SEARCH_RECONCILIATION_STABILIZATION_MS
      const driftResolved = ownsTerminalCircuit
        && productBucket.circuitReason === 'usage_drift'
        && (historicalCircuit || (
          !driftObservationChanged
          && driftStable
          && args.providerKeyUsage >= productBucket.consumedCredits
        ))
      const circuitResolved = policyResolved || driftResolved
      if (ownsTerminalCircuit && driftObservationChanged) {
        await ctx.db.patch(productBucket._id, {
          providerReportedUsage: args.providerKeyUsage,
          providerReportedUsageObservedAt: now,
          revision: productBucket.revision + 1,
          updatedAt: now,
        })
      }
      else if (circuitResolved) {
        await ctx.db.patch(productBucket._id, {
          reconciliationStatus: 'matched',
          circuitReason: undefined,
          circuitReservationId: undefined,
          ...(evidenceMatchesReservationPeriod
            ? {
                providerUsageBaseline: driftResolved
                  ? args.providerKeyUsage - productBucket.consumedCredits
                  : baseline,
                providerReportedUsage: args.providerKeyUsage,
                providerReportedUsageObservedAt: now,
              }
            : {}),
          lastReconciledAt: now,
          revision: productBucket.revision + 1,
          updatedAt: now,
        })
      }
      await ctx.db.patch(reservation._id, {
        reconciliationRequired: circuitResolved ? false : reservation.reconciliationRequired,
        reconciliationKeyHash: fingerprint.keyHash,
        reconciliationRequestFingerprint: fingerprint.requestFingerprint,
        updatedAt: now,
        revision: reservation.revision + 1,
      })
      return reservationView({
        ...reservation,
        reconciliationRequired: circuitResolved ? false : reservation.reconciliationRequired,
        revision: reservation.revision + 1,
      })
    }
    if (productBucket.activeDispatchReservationId === reservation._id
      && (productBucket.activeDispatchLeaseExpiresAt ?? 0) > now) {
      throw new Error('Search dispatch is still active')
    }
    const usageBeforeDispatch = reservation.providerUsageBeforeDispatch
    if (reservation.dispatchState !== 'started'
      || !Number.isSafeInteger(usageBeforeDispatch)) {
      throw new Error('Search reservation conflict')
    }

    if (!evidenceMatchesReservationPeriod) {
      if (productBucket.reconciliationStatus !== 'review_required'
        || productBucket.circuitReason !== 'dispatch_uncertain'
        || productBucket.circuitReservationId !== reservation._id) {
        await ctx.db.patch(productBucket._id, {
          reconciliationStatus: 'review_required',
          circuitReason: 'dispatch_uncertain',
          circuitReservationId: reservation._id,
          revision: productBucket.revision + 1,
          updatedAt: now,
        })
      }
      await ctx.db.patch(reservation._id, {
        reconciliationRequired: true,
        outcomeCode: 'reconciliation_unknown',
        reconciliationKeyHash: fingerprint.keyHash,
        reconciliationRequestFingerprint: fingerprint.requestFingerprint,
        updatedAt: now,
        revision: reservation.revision + 1,
      })
      return {
        ...reservationView(reservation),
        reconciliationRequired: true,
        outcomeCode: 'reconciliation_unknown',
        revision: reservation.revision + 1,
      }
    }

    const delta = args.providerKeyUsage - usageBeforeDispatch!
    const unchangedEvidenceIsStable = now - (reservation.dispatchedAt ?? reservation.updatedAt) >= SEARCH_RECONCILIATION_STABILIZATION_MS
    if ((delta === 0 && !unchangedEvidenceIsStable)
      || (delta !== 0 && delta !== 1)) {
      await ctx.db.patch(productBucket._id, {
        reconciliationStatus: 'review_required',
        circuitReason: 'dispatch_uncertain',
        circuitReservationId: reservation._id,
        providerReportedUsage: args.providerKeyUsage,
        revision: productBucket.revision + 1,
        updatedAt: now,
      })
      await ctx.db.patch(reservation._id, {
        reconciliationRequired: true,
        outcomeCode: 'reconciliation_unknown',
        reconciliationKeyHash: fingerprint.keyHash,
        reconciliationRequestFingerprint: fingerprint.requestFingerprint,
        updatedAt: now,
        revision: reservation.revision + 1,
      })
      return {
        ...reservationView(reservation),
        reconciliationRequired: true,
        outcomeCode: 'reconciliation_unknown',
        revision: reservation.revision + 1,
      }
    }

    const confirmedUsed = delta === 1
    await changeBuckets(ctx, reservation, confirmedUsed ? 'consume' : 'release', now)
    await clearDispatchLease(ctx, reservation, now)
    await clearOwnedDispatchCircuit(ctx, reservation, now)
    const reconciledBucket = await ctx.db.get(reservation.productMonthBucketId)
    if (!reconciledBucket) throw new Error('Quota ledger unavailable')
    await ctx.db.patch(reconciledBucket._id, {
      providerReportedUsage: args.providerKeyUsage,
      lastReconciledAt: now,
      revision: reconciledBucket.revision + 1,
      updatedAt: now,
    })
    const status = confirmedUsed ? 'consumed' as const : 'released' as const
    await ctx.db.patch(reservation._id, {
      status,
      reconciliationRequired: false,
      outcomeCode: confirmedUsed ? 'confirmed_used' : 'confirmed_unused',
      reconciliationKeyHash: fingerprint.keyHash,
      reconciliationRequestFingerprint: fingerprint.requestFingerprint,
      settledAt: now,
      updatedAt: now,
      revision: reservation.revision + 1,
    })
    return {
      ...reservationView(reservation),
      status,
      reconciliationRequired: false,
      outcomeCode: confirmedUsed ? 'confirmed_used' : 'confirmed_unused',
      revision: reservation.revision + 1,
      settledAt: now,
    }
  },
})

export const reconcileUsageUnavailable = internalMutation({
  args: {
    reservationId: v.id('searchReservations'),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    validateReconciliationKey(args.idempotencyKey)
    const reservation = await ctx.db.get(args.reservationId)
    if (!reservation) throw new Error('Search reservation not found')
    const fingerprint = await reconcileFingerprint(args.idempotencyKey, 'usage:unavailable')
    if (await assertReconciliationCommand(reservation, args.expectedRevision, fingerprint.keyHash, fingerprint.requestFingerprint) === 'replay') {
      return reservationView(reservation)
    }
    if (reservation.status !== 'reserved' || reservation.dispatchState !== 'started') {
      throw new Error('Search reservation conflict')
    }
    const now = Date.now()
    const productBucket = await ctx.db.get(reservation.productMonthBucketId)
    if (!productBucket) throw new Error('Quota ledger unavailable')
    if (productBucket.activeDispatchReservationId === reservation._id
      && (productBucket.activeDispatchLeaseExpiresAt ?? 0) > now) {
      throw new Error('Search dispatch is still active')
    }
    await ctx.db.patch(productBucket._id, {
      reconciliationStatus: 'review_required',
      circuitReason: 'dispatch_uncertain',
      circuitReservationId: reservation._id,
      revision: productBucket.revision + 1,
      updatedAt: now,
    })
    await ctx.db.patch(reservation._id, {
      reconciliationRequired: true,
      outcomeCode: 'reconciliation_unknown',
      reconciliationKeyHash: fingerprint.keyHash,
      reconciliationRequestFingerprint: fingerprint.requestFingerprint,
      updatedAt: now,
      revision: reservation.revision + 1,
    })
    return { ...reservationView(reservation), reconciliationRequired: true, revision: reservation.revision + 1 }
  },
})

export const cleanupExpiredUndispatched = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const rows = await ctx.db.query('searchReservations')
      .withIndex('by_provider_and_status_and_dispatchState_and_expiresAt', q => q
        .eq('provider', SEARCH_PROVIDER)
        .eq('status', 'reserved')
        .eq('dispatchState', 'not_started')
        .lt('expiresAt', now))
      .take(CLEANUP_BATCH)
    for (const reservation of rows) {
      await releaseSearchReservationClaims(ctx, reservation, now)
      await ctx.db.patch(reservation._id, {
        status: 'released',
        outcomeCode: 'expired_before_dispatch',
        settledAt: now,
        updatedAt: now,
        revision: reservation.revision + 1,
      })
    }
    return { released: rows.length, hasMore: rows.length === CLEANUP_BATCH }
  },
})

async function findBucket(ctx: QueryCtx, scopeKind: BucketScope, scopeKey: string, periodKey: string) {
  return await ctx.db.query('searchQuotaBuckets')
    .withIndex('by_provider_and_scopeKind_and_scopeKey_and_periodKey', q => q
      .eq('provider', SEARCH_PROVIDER)
      .eq('scopeKind', scopeKind)
      .eq('scopeKey', scopeKey)
      .eq('periodKey', periodKey))
    .unique()
}

export const quotaStatus = query({
  args: { learningVoidId: v.id('learningVoids') },
  handler: async (ctx, args) => {
    const userId = await requireLearnV2QueryAccess(ctx)
    const learningVoid = await ctx.db.get(args.learningVoidId)
    if (!learningVoid || learningVoid.userId !== userId) throw new Error('Learning Void not found')
    const day = new Date().toISOString().slice(0, 10)
    const month = day.slice(0, 7)
    const ownerScope = await sha256(`owner:${userId}`)
    const voidScope = await sha256(`void:${String(args.learningVoidId)}`)
    const rows = await Promise.all([
      findBucket(ctx, 'product_month', 'global', month),
      findBucket(ctx, 'product_day', 'global', day),
      findBucket(ctx, 'user_day', ownerScope, day),
      findBucket(ctx, 'learning_void_broad', voidScope, 'lifetime'),
    ])
    const limits = [SEARCH_LIMITS.productMonth, SEARCH_LIMITS.productDay, SEARCH_LIMITS.userDay, SEARCH_LIMITS.learningVoidLifetime]
    const scopes = ['product_month', 'product_day', 'user_day', 'learning_void_broad'] as const
    const now = new Date()
    const nextUtcDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
    const nextUtcMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
    return rows.map((row, index) => ({
      scope: scopes[index]!,
      limit: limits[index]!,
      reserved: row?.reservedCredits ?? 0,
      consumed: row?.consumedCredits ?? 0,
      available: limits[index]! - (row?.reservedCredits ?? 0) - (row?.consumedCredits ?? 0),
      resetAt: index === 0 ? nextUtcMonth : index < 3 ? nextUtcDay : null,
    }))
  },
})
