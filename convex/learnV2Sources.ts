import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import { isLearnV2TransitionAllowed, type SourceState } from '../shared/learn-v2-contract'
import { LEARN_V2_BLUEPRINT_LIMITS } from '../shared/learn-v2-blueprint'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server'
import {
  hasLearnV2Access,
  requireLearnV2MutationAccess,
  requireLearnV2QueryAccess,
} from './lib/learnV2Access'
import {
  incrementRecordRevision,
  sanitizePublicSourceLocator,
  tombstonedSourceExternalKey,
} from './lib/learnV2SourceSanitization'

const MAX_URL_LENGTH = 2_048
const MAX_KEY_LENGTH = 128
const MAX_TITLE_LENGTH = 300
const MAX_PAGE = 16
const CLEANUP_BATCH = 32
const SOURCE_CURSOR_PREFIX = 'learn-v2-source:v2:'

type SourceCursorSegment = 'legacy_status' | 'legacy_purged' | 'current'

function decodeSourceCursor(value: string | null, requestedStatus: SourceState): {
  segment: SourceCursorSegment
  cursor: string | null
} {
  if (!value) return { segment: 'legacy_status', cursor: null }
  if (!value.startsWith(SOURCE_CURSOR_PREFIX)) {
    // Native Convex cursors issued before the compatibility cursor was
    // introduced already address the current effective-status index.
    return { segment: 'current', cursor: value }
  }
  const encoded = value.slice(SOURCE_CURSOR_PREFIX.length)
  const firstSeparator = encoded.indexOf(':')
  const secondSeparator = encoded.indexOf(':', firstSeparator + 1)
  if (firstSeparator < 1 || secondSeparator < 0) throw new Error('Invalid source cursor')
  const status = encoded.slice(0, firstSeparator)
  const segment = encoded.slice(firstSeparator + 1, secondSeparator) as SourceCursorSegment
  if (status !== requestedStatus || !['legacy_status', 'legacy_purged', 'current'].includes(segment)) {
    throw new Error('Invalid source cursor')
  }
  if (segment === 'legacy_purged' && requestedStatus !== 'unavailable') {
    throw new Error('Invalid source cursor')
  }
  try {
    const rawCursor = encoded.slice(secondSeparator + 1)
    return { segment, cursor: rawCursor ? decodeURIComponent(rawCursor) : null }
  }
  catch {
    throw new Error('Invalid source cursor')
  }
}

function encodeSourceCursor(status: SourceState, segment: SourceCursorSegment, cursor: string | null) {
  return `${SOURCE_CURSOR_PREFIX}${status}:${segment}:${cursor ? encodeURIComponent(cursor) : ''}`
}

function nextSourceSegment(status: SourceState, segment: SourceCursorSegment): SourceCursorSegment | null {
  if (segment === 'legacy_status') return status === 'unavailable' ? 'legacy_purged' : 'current'
  if (segment === 'legacy_purged') return 'current'
  return null
}

export const LEARN_V2_FETCH_ADMISSION_POLICY = {
  ownerConcurrencyLimit: 2,
  globalConcurrencyLimit: 16,
  leaseMs: 30_000,
  rateWindowMs: 60_000,
  ownerRateLimit: 12,
} as const

const sourceStatus = v.union(
  v.literal('candidate'),
  v.literal('fetched'),
  v.literal('evaluated'),
  v.literal('user_accepted'),
  v.literal('rejected'),
  v.literal('unavailable'),
)

const rightsStatus = v.union(v.literal('permitted'), v.literal('unknown'), v.literal('prohibited'))
const rightsProvenance = v.union(v.literal('noarchive'), v.literal('link_license'), v.literal('html_license'), v.literal('none'))
const fetchPolicyVersion = v.literal('learn-v2.fetch.v2')
const rightsPolicyVersion = v.literal('learn-v2.rights.v2')
const safeFetchFailureReason = v.union(
  v.literal('invalid_url'),
  v.literal('url_too_long'),
  v.literal('https_required'),
  v.literal('blocked_address'),
  v.literal('dns_resolution_failed'),
  v.literal('deadline_exceeded'),
  v.literal('redirect_limit'),
  v.literal('redirect_missing_location'),
  v.literal('robots_denied'),
  v.literal('robots_unavailable'),
  v.literal('http_status'),
  v.literal('partial_content'),
  v.literal('authentication_required'),
  v.literal('unsupported_mime'),
  v.literal('unsupported_charset'),
  v.literal('unsupported_encoding'),
  v.literal('invalid_content_encoding'),
  v.literal('content_signature_mismatch'),
  v.literal('declared_size_overflow'),
  v.literal('wire_size_overflow'),
  v.literal('decoded_size_overflow'),
  v.literal('binary_text'),
  v.literal('network_failure'),
)

function validateKey(value: string) {
  if (!value.trim() || value.length > MAX_KEY_LENGTH) throw new Error('Invalid idempotency key')
}

function validateRevision(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid expected revision')
}

function canonicalizeUrl(value: string) {
  if (value.length > MAX_URL_LENGTH) throw new Error('Source URL exceeds the maximum length')
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new Error('Invalid source URL')
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error('Invalid source URL')
  url.hash = ''
  const serialized = url.toString()
  if (serialized.length > MAX_URL_LENGTH) throw new Error('Source URL exceeds the maximum length')
  return serialized
}

function locatorFor(value: string) {
  const url = new URL(value)
  return `${url.origin}/`
}

async function digest(value: unknown) {
  const encoded = new TextEncoder().encode(JSON.stringify(value))
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoded))
  return `sha256:${[...bytes].map(value => value.toString(16).padStart(2, '0')).join('')}`
}

async function idempotencyKeyHash(value: string) {
  return await digest({ idempotencyKey: value })
}

async function tombstonedIdentityKey(identity: Doc<'learnSourceIdentities'>) {
  return await tombstonedSourceExternalKey(String(identity._id))
}

function currentRevision(source: Doc<'learnSourceSnapshots'>) {
  return source.recordRevision ?? 1
}

function effectiveStatus(source: Doc<'learnSourceSnapshots'>) {
  return source.effectiveStatus ?? (source.evidencePurgedAt !== undefined ? 'unavailable' : source.status)
}

function requireSourceTransition(from: SourceState, to: SourceState) {
  if (!isLearnV2TransitionAllowed('source', from, to)) throw new Error('Invalid source transition')
}

function sourceView(source: Doc<'learnSourceSnapshots'>) {
  return {
    _id: source._id,
    sourceIdentityId: source.sourceIdentityId,
    learningVoidId: source.learningVoidId,
    blueprintRevisionId: source.blueprintRevisionId,
    revision: source.revision,
    recordRevision: currentRevision(source),
    status: source.status,
    effectiveStatus: effectiveStatus(source),
    contentHash: source.contentHash,
    contentType: source.contentType,
    publicLocator: sanitizePublicSourceLocator(source.publicLocator),
    rightsStatus: source.rightsStatus,
    rightsProvenance: source.rightsProvenance,
    rightsPolicyVersion: source.rightsPolicyVersion,
    fetchPolicyVersion: source.fetchPolicyVersion,
    conflictStatus: source.conflictStatus,
    trustClassification: source.trustClassification,
    unavailableReason: source.unavailableReason,
    fetchedAt: source.fetchedAt,
    evaluatedAt: source.evaluatedAt,
    acceptedAt: source.acceptedAt,
    rejectedAt: source.rejectedAt,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt ?? source.createdAt,
  }
}

function reviewTitle(value: string | undefined) {
  if (!value) return null
  const sanitized = value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH)
  return sanitized || null
}

function reviewDomain(...values: Array<string | undefined>) {
  for (const value of values) {
    if (!value) continue
    try {
      return new URL(value).hostname.toLowerCase().slice(0, 253)
    }
    catch {
      // Ignore malformed legacy locators and continue to the next public value.
    }
  }
  return null
}

async function requireLiveVoid(ctx: MutationCtx | QueryCtx, userId: string, learningVoidId: Id<'learningVoids'>) {
  const learningVoid = await ctx.db.get(learningVoidId)
  if (!learningVoid || learningVoid.userId !== userId || learningVoid.status === 'archived') {
    throw new Error('Learning Void not found')
  }
  const folder = await ctx.db.get(learningVoid.folderId)
  if (!folder || folder.userId !== userId) throw new Error('Learning Void not found')
  return learningVoid
}

async function requireOwnedSource(ctx: MutationCtx | QueryCtx, userId: string, id: Id<'learnSourceSnapshots'>) {
  const source = await ctx.db.get(id)
  if (!source || source.userId !== userId) throw new Error('Source not found')
  await requireLiveVoid(ctx, userId, source.learningVoidId)
  return source
}

async function requireNewestBlueprintRevision(
  ctx: MutationCtx | QueryCtx,
  userId: string,
  blueprintRevisionId: Id<'learnBlueprintRevisions'> | undefined,
) {
  if (!blueprintRevisionId) throw new Error('Blueprint revision not found')
  const blueprint = await ctx.db.get(blueprintRevisionId)
  if (!blueprint || blueprint.userId !== userId) throw new Error('Blueprint revision not found')
  const newest = await ctx.db.query('learnBlueprintRevisions')
    .withIndex('by_userId_and_blueprintId_and_revision', q => q
      .eq('userId', userId).eq('blueprintId', blueprint.blueprintId))
    .order('desc')
    .first()
  if (!newest || newest._id !== blueprint._id) throw new Error('Blueprint revision is superseded')
  return blueprint
}

async function requireOpenSourceReview(
  ctx: MutationCtx | QueryCtx,
  userId: string,
  blueprintRevisionId: Id<'learnBlueprintRevisions'> | undefined,
) {
  const blueprint = await requireNewestBlueprintRevision(ctx, userId, blueprintRevisionId)
  if (!['draft', 'source_review'].includes(blueprint.status)) throw new Error('Blueprint source review is closed')
  return blueprint
}

async function findReceipt(ctx: MutationCtx, userId: string, rawIdempotencyKey: string) {
  const keyHash = await idempotencyKeyHash(rawIdempotencyKey)
  return await ctx.db.query('learnSourceCommandReceipts')
    .withIndex('by_userId_and_idempotencyKeyHash', q => q.eq('userId', userId).eq('idempotencyKeyHash', keyHash))
    .unique()
}

function replayReceipt(receipt: Doc<'learnSourceCommandReceipts'>, command: string, fingerprint: string) {
  if (receipt.command !== command || receipt.requestFingerprint !== fingerprint) throw new Error('Idempotency key reuse')
  return JSON.parse(receipt.response) as Record<string, unknown>
}

async function saveReceipt(ctx: MutationCtx, args: {
  userId: string
  learningVoidId: Id<'learningVoids'>
  sourceSnapshotId: Id<'learnSourceSnapshots'>
  idempotencyKey: string
  command: string
  requestFingerprint: string
  response: Record<string, unknown>
}) {
  const { idempotencyKey, ...persisted } = args
  await ctx.db.insert('learnSourceCommandReceipts', {
    ...persisted,
    idempotencyKeyHash: await idempotencyKeyHash(idempotencyKey),
    response: JSON.stringify(args.response),
    createdAt: Date.now(),
  })
  return args.response
}

export const registerCandidate = mutation({
  args: {
    learningVoidId: v.id('learningVoids'),
    blueprintRevisionId: v.id('learnBlueprintRevisions'),
    url: v.string(),
    title: v.optional(v.string()),
    expectedVoidRevision: v.number(),
    expectedBlueprintRecordRevision: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireLearnV2MutationAccess(ctx)
    validateKey(args.idempotencyKey)
    validateRevision(args.expectedVoidRevision)
    validateRevision(args.expectedBlueprintRecordRevision)
    if (args.title && args.title.length > MAX_TITLE_LENGTH) throw new Error('Source title exceeds the maximum length')
    const canonicalUrl = canonicalizeUrl(args.url)
    const requestFingerprint = await digest({ ...args, url: canonicalUrl })
    const prior = await findReceipt(ctx, userId, args.idempotencyKey)
    if (prior) return replayReceipt(prior, 'register_candidate', requestFingerprint)
    const learningVoid = await requireLiveVoid(ctx, userId, args.learningVoidId)
    if (learningVoid.revision !== args.expectedVoidRevision) throw new Error('Learning Void revision conflict')
    const blueprint = await ctx.db.get(args.blueprintRevisionId)
    if (!blueprint || blueprint.userId !== userId || blueprint.learningVoidId !== learningVoid._id) throw new Error('Blueprint revision not found')
    if (blueprint.recordRevision !== args.expectedBlueprintRecordRevision) throw new Error('Blueprint revision conflict')
    if (!['draft', 'source_review'].includes(blueprint.status)) throw new Error('Blueprint revision is not editable')
    await requireNewestBlueprintRevision(ctx, userId, blueprint._id)
    const externalKey = await digest({ sourceUrl: canonicalUrl })
    let identity = await ctx.db.query('learnSourceIdentities')
      .withIndex('by_userId_and_learningVoidId_and_origin_and_externalKey', q => q
        .eq('userId', userId).eq('learningVoidId', learningVoid._id).eq('origin', 'user_url').eq('externalKey', externalKey))
      .unique()
    const now = Date.now()
    if (!identity) {
      const identityId = await ctx.db.insert('learnSourceIdentities', {
        userId,
        learningVoidId: learningVoid._id,
        origin: 'user_url',
        externalKey,
        canonicalUrl,
        publicLocator: locatorFor(canonicalUrl),
        privateLocator: canonicalUrl,
        title: args.title?.trim() || undefined,
      })
      identity = await ctx.db.get(identityId)
      if (!identity) throw new Error('Unable to create source identity')
    }
    if (identity.tombstonedAt) throw new Error('Source identity is unavailable')
    const latest = await ctx.db.query('learnSourceSnapshots')
      .withIndex('by_userId_and_sourceIdentityId_and_revision', q => q.eq('userId', userId).eq('sourceIdentityId', identity._id))
      .order('desc').first()
    const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', {
      userId,
      sourceIdentityId: identity._id,
      learningVoidId: learningVoid._id,
      blueprintRevisionId: args.blueprintRevisionId,
      revision: (latest?.revision ?? 0) + 1,
      recordRevision: 1,
      status: 'candidate',
      effectiveStatus: 'candidate',
      publicLocator: identity.publicLocator ?? locatorFor(canonicalUrl),
      privateLocator: canonicalUrl,
      createdAt: now,
      updatedAt: now,
    })
    const response = { sourceSnapshotId, status: 'candidate', effectiveStatus: 'candidate', recordRevision: 1 }
    return await saveReceipt(ctx, {
      userId,
      learningVoidId: learningVoid._id,
      sourceSnapshotId,
      idempotencyKey: args.idempotencyKey,
      command: 'register_candidate',
      requestFingerprint,
      response,
    })
  },
})

export const getSource = query({
  args: { sourceSnapshotId: v.id('learnSourceSnapshots') },
  handler: async (ctx, args) => {
    const userId = await requireLearnV2QueryAccess(ctx)
    const source = await requireOwnedSource(ctx, userId, args.sourceSnapshotId)
    return sourceView(source)
  },
})

export const listSources = query({
  args: {
    learningVoidId: v.id('learningVoids'),
    status: v.optional(sourceStatus),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireLearnV2QueryAccess(ctx)
    await requireLiveVoid(ctx, userId, args.learningVoidId)
    const paginationOpts = {
      cursor: args.paginationOpts.cursor,
      numItems: Math.min(MAX_PAGE, Math.max(1, Math.floor(args.paginationOpts.numItems))),
    }
    if (args.status) {
      const requestedStatus = args.status
      // A versioned cursor walks three fully indexed projections. Each call
      // executes exactly one bounded pagination while the cursor spans every
      // legacy row, rather than truncating compatibility at a fixed total.
      const state = decodeSourceCursor(paginationOpts.cursor, requestedStatus)
      const result = state.segment === 'current'
        ? await ctx.db.query('learnSourceSnapshots')
            .withIndex('by_userId_and_learningVoidId_and_effectiveStatus', q => q
              .eq('userId', userId).eq('learningVoidId', args.learningVoidId).eq('effectiveStatus', requestedStatus))
            .paginate({ cursor: state.cursor, numItems: paginationOpts.numItems })
        : state.segment === 'legacy_purged'
          ? await ctx.db.query('learnSourceSnapshots')
              .withIndex('by_userId_and_learningVoidId_and_effectiveStatus_and_evidencePurgedAt', q => q
                .eq('userId', userId)
                .eq('learningVoidId', args.learningVoidId)
                .eq('effectiveStatus', undefined)
                .gt('evidencePurgedAt', undefined))
              .paginate({ cursor: state.cursor, numItems: paginationOpts.numItems })
          : await ctx.db.query('learnSourceSnapshots')
              .withIndex('by_userId_and_learningVoidId_and_effectiveStatus_and_status_and_evidencePurgedAt', q => {
                const range = q
                  .eq('userId', userId)
                  .eq('learningVoidId', args.learningVoidId)
                  .eq('effectiveStatus', undefined)
                  .eq('status', requestedStatus)
                return range.eq('evidencePurgedAt', undefined)
              })
              .paginate({ cursor: state.cursor, numItems: paginationOpts.numItems })
      const nextSegment = result.isDone ? nextSourceSegment(requestedStatus, state.segment) : null
      return {
        page: result.page.map(sourceView),
        isDone: result.isDone && nextSegment === null,
        continueCursor: result.isDone
          ? nextSegment === null ? result.continueCursor : encodeSourceCursor(requestedStatus, nextSegment, null)
          : encodeSourceCursor(requestedStatus, state.segment, result.continueCursor),
      }
    }
    const result = await ctx.db.query('learnSourceSnapshots')
      .withIndex('by_userId_and_learningVoidId_and_status', q => q.eq('userId', userId).eq('learningVoidId', args.learningVoidId))
      .paginate(paginationOpts)
    return { ...result, page: result.page.map(sourceView) }
  },
})

// Owner-only projection for source-review cards. It deliberately omits
// canonical/private URLs, object keys, filenames, excerpts, and identity keys.
export const listSourceReview = query({
  args: {
    blueprintRevisionId: v.id('learnBlueprintRevisions'),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireLearnV2QueryAccess(ctx)
    const blueprint = await requireNewestBlueprintRevision(ctx, userId, args.blueprintRevisionId)
    await requireLiveVoid(ctx, userId, blueprint.learningVoidId)
    const result = await ctx.db.query('learnSourceSnapshots')
      .withIndex('by_userId_and_blueprintRevisionId', q => q
        .eq('userId', userId).eq('blueprintRevisionId', blueprint._id))
      .paginate({
        cursor: args.paginationOpts.cursor,
        numItems: Math.min(MAX_PAGE, Math.max(1, Math.floor(args.paginationOpts.numItems))),
      })
    const page = []
    for (const source of result.page) {
      const identity = await ctx.db.get(source.sourceIdentityId)
      if (!identity || identity.userId !== userId || identity.learningVoidId !== blueprint.learningVoidId) {
        throw new Error('Source review identity mismatch')
      }
      const excerpt = await ctx.db.query('learnSourceExcerpts')
        .withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('sourceSnapshotId', source._id))
        .unique()
      const hasContent = source.rightsStatus === 'permitted' && excerpt?.rightsStatus === 'permitted'
        && excerpt.evidencePurgedAt === undefined && Boolean(excerpt.excerpt?.trim())
      const hasLocator = Boolean(sanitizePublicSourceLocator(source.publicLocator)
        ?? sanitizePublicSourceLocator(identity.publicLocator)
        ?? sanitizePublicSourceLocator(excerpt?.locator))
      const objectiveLinks = await ctx.db.query('learnObjectiveSources')
        .withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('sourceSnapshotId', source._id))
        .take(LEARN_V2_BLUEPRINT_LIMITS.maximumObjectiveSourceLinks + 1)
      if (objectiveLinks.length > LEARN_V2_BLUEPRINT_LIMITS.maximumObjectiveSourceLinks) throw new Error('Source review objective links exceed their bounded contract')
      const reviewedObjectives = []
      for (const link of objectiveLinks) {
        const objective = await ctx.db.get(link.objectiveId)
        if (!objective || objective.userId !== userId || objective.blueprintRevisionId !== blueprint._id) throw new Error('Source review objective scope mismatch')
        reviewedObjectives.push({ objectiveId: objective._id, title: reviewTitle(objective.title), coverage: link.coverage })
      }
      page.push({
        ...sourceView(source),
        identity: {
          origin: identity.origin,
          title: reviewTitle(identity.title),
          publisherDomain: reviewDomain(identity.publicLocator, source.publicLocator, identity.canonicalUrl),
        },
        retrieval: {
          status: effectiveStatus(source),
          fetchedAt: source.fetchedAt ?? null,
          evaluatedAt: source.evaluatedAt ?? null,
        },
        rights: {
          status: source.rightsStatus ?? 'unknown',
          provenance: source.rightsProvenance ?? 'none',
          policyVersion: source.rightsPolicyVersion ?? null,
          access: effectiveStatus(source) === 'unavailable' || source.evidencePurgedAt !== undefined
            ? 'evidence_unavailable'
            : hasContent ? 'available' : hasLocator ? 'locator_only' : 'evidence_unavailable',
        },
        signals: {
          authority: 'unknown',
          freshness: source.fetchedAt === undefined ? 'unknown' : 'retrieved_at',
          freshnessAt: source.fetchedAt ?? null,
        },
        reviewedObjectives,
      })
    }
    return { ...result, page }
  },
})

async function cleanAdmissionRows(ctx: MutationCtx, now: number) {
  const leases = await ctx.db.query('learnSourceFetchLeases')
    .withIndex('by_expiresAt', q => q.lte('expiresAt', now)).take(CLEANUP_BATCH)
  for (const lease of leases) await ctx.db.delete(lease._id)
  const rateRows = await ctx.db.query('learnSourceFetchRateEvents')
    .withIndex('by_expiresAt', q => q.lte('expiresAt', now)).take(CLEANUP_BATCH)
  for (const row of rateRows) await ctx.db.delete(row._id)
}

export const replayOrAcquireFetch = internalMutation({
  args: {
    tokenIdentifier: v.string(),
    sourceSnapshotId: v.id('learnSourceSnapshots'),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    validateKey(args.idempotencyKey)
    validateRevision(args.expectedRevision)
    if (!(await hasLearnV2Access(ctx, args.tokenIdentifier))) throw new Error('Learn V2 access denied')
    const userId = args.tokenIdentifier
    const requestFingerprint = await digest({ sourceSnapshotId: String(args.sourceSnapshotId), expectedRevision: args.expectedRevision })
    const receipt = await findReceipt(ctx, userId, args.idempotencyKey)
    if (receipt) return { kind: 'replayed' as const, response: replayReceipt(receipt, 'fetch_source', requestFingerprint) }
    const source = await requireOwnedSource(ctx, userId, args.sourceSnapshotId)
    await requireOpenSourceReview(ctx, userId, source.blueprintRevisionId)
    if (currentRevision(source) !== args.expectedRevision) throw new Error('Source revision conflict')
    if (effectiveStatus(source) !== 'candidate') throw new Error('Invalid source transition')
    const identity = await ctx.db.get(source.sourceIdentityId)
    if (!identity || identity.userId !== userId || identity.tombstonedAt || !identity.canonicalUrl) throw new Error('Source identity unavailable')
    const now = Date.now()
    await cleanAdmissionRows(ctx, now)
    const keyHash = await idempotencyKeyHash(args.idempotencyKey)
    const keyLease = await ctx.db.query('learnSourceFetchLeases')
      .withIndex('by_userId_and_idempotencyKeyHash', q => q.eq('userId', userId).eq('idempotencyKeyHash', keyHash)).unique()
    if (keyLease) {
      if (keyLease.expiresAt <= now) await ctx.db.delete(keyLease._id)
      else {
        if (keyLease.requestFingerprint !== requestFingerprint) throw new Error('Idempotency key reuse')
        return { kind: 'retryable_denial' as const, reason: 'duplicate_in_flight' as const }
      }
    }
    const snapshotLease = await ctx.db.query('learnSourceFetchLeases')
      .withIndex('by_userId_and_sourceSnapshotId_and_expiresAt', q => q
        .eq('userId', userId).eq('sourceSnapshotId', source._id).gt('expiresAt', now)).first()
    if (snapshotLease) return { kind: 'retryable_denial' as const, reason: 'snapshot_in_flight' as const }
    const ownerLeases = await ctx.db.query('learnSourceFetchLeases')
      .withIndex('by_userId_and_expiresAt', q => q.eq('userId', userId).gt('expiresAt', now)).take(LEARN_V2_FETCH_ADMISSION_POLICY.ownerConcurrencyLimit)
    if (ownerLeases.length >= LEARN_V2_FETCH_ADMISSION_POLICY.ownerConcurrencyLimit) return { kind: 'retryable_denial' as const, reason: 'owner_capacity' as const }
    const globalLeases = await ctx.db.query('learnSourceFetchLeases')
      .withIndex('by_expiresAt', q => q.gt('expiresAt', now)).take(LEARN_V2_FETCH_ADMISSION_POLICY.globalConcurrencyLimit)
    if (globalLeases.length >= LEARN_V2_FETCH_ADMISSION_POLICY.globalConcurrencyLimit) return { kind: 'retryable_denial' as const, reason: 'global_capacity' as const }
    const recent = await ctx.db.query('learnSourceFetchRateEvents')
      .withIndex('by_userId_and_expiresAt', q => q.eq('userId', userId).gt('expiresAt', now)).take(LEARN_V2_FETCH_ADMISSION_POLICY.ownerRateLimit)
    if (recent.length >= LEARN_V2_FETCH_ADMISSION_POLICY.ownerRateLimit) return { kind: 'retryable_denial' as const, reason: 'rate_limited' as const }
    const leaseToken = crypto.randomUUID()
    const leaseId = await ctx.db.insert('learnSourceFetchLeases', {
      userId,
      learningVoidId: source.learningVoidId,
      sourceSnapshotId: source._id,
      idempotencyKeyHash: keyHash,
      requestFingerprint,
      leaseToken,
      expiresAt: now + LEARN_V2_FETCH_ADMISSION_POLICY.leaseMs,
      createdAt: now,
    })
    await ctx.db.insert('learnSourceFetchRateEvents', {
      userId,
      learningVoidId: source.learningVoidId,
      sourceSnapshotId: source._id,
      createdAt: now,
      expiresAt: now + LEARN_V2_FETCH_ADMISSION_POLICY.rateWindowMs,
    })
    return {
      kind: 'acquired' as const,
      leaseId,
      leaseToken,
      url: identity.canonicalUrl,
      requestFingerprint,
    }
  },
})

const fetchResult = v.union(
  v.object({
    kind: v.literal('success'),
    finalUrl: v.string(),
    publicLocator: v.string(),
    contentHash: v.string(),
    contentType: v.union(v.literal('text/html'), v.literal('text/plain'), v.literal('application/pdf')),
    wireBytes: v.number(),
    decodedBytes: v.number(),
    excerpt: v.optional(v.string()),
    trustClassification: v.literal('untrusted_source_data'),
    rightsStatus,
    rightsProvenance,
    rightsPolicyVersion,
    fetchPolicyVersion,
  }),
  v.object({
    kind: v.literal('failure'),
    reason: safeFetchFailureReason,
    fetchPolicyVersion,
  }),
)

export const commitFetchResult = internalMutation({
  args: {
    tokenIdentifier: v.string(),
    sourceSnapshotId: v.id('learnSourceSnapshots'),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
    leaseId: v.id('learnSourceFetchLeases'),
    leaseToken: v.string(),
    requestFingerprint: v.string(),
    result: fetchResult,
  },
  handler: async (ctx, args) => {
    validateKey(args.idempotencyKey)
    validateRevision(args.expectedRevision)
    if (!(await hasLearnV2Access(ctx, args.tokenIdentifier))) throw new Error('Learn V2 access denied')
    const userId = args.tokenIdentifier
    const prior = await findReceipt(ctx, userId, args.idempotencyKey)
    if (prior) return replayReceipt(prior, 'fetch_source', args.requestFingerprint)
    const lease = await ctx.db.get(args.leaseId)
    const keyHash = await idempotencyKeyHash(args.idempotencyKey)
    if (!lease || lease.userId !== userId || lease.sourceSnapshotId !== args.sourceSnapshotId
      || lease.idempotencyKeyHash !== keyHash || lease.requestFingerprint !== args.requestFingerprint
      || lease.leaseToken !== args.leaseToken) throw new Error('Fetch lease unavailable')
    if (lease.expiresAt <= Date.now()) {
      await ctx.db.delete(lease._id)
      throw new Error('Fetch lease expired')
    }
    const source = await requireOwnedSource(ctx, userId, args.sourceSnapshotId)
    await requireOpenSourceReview(ctx, userId, source.blueprintRevisionId)
    if (currentRevision(source) !== args.expectedRevision) throw new Error('Source revision conflict')
    if (effectiveStatus(source) !== 'candidate') throw new Error('Invalid source transition')
    const identity = await ctx.db.get(source.sourceIdentityId)
    if (!identity || identity.userId !== userId || identity.tombstonedAt || !identity.canonicalUrl) throw new Error('Source identity unavailable')
    const now = Date.now()
    let response: Record<string, unknown>
    if (args.result.kind === 'success') {
      requireSourceTransition(source.status, 'fetched')
      const finalUrl = canonicalizeUrl(args.result.finalUrl)
      // Never trust an independently supplied locator. The only public value
      // is derived from the validated final representation URL.
      const finalPublicLocator = locatorFor(finalUrl)
      if (!/^[a-f0-9]{64}$/i.test(args.result.contentHash)) throw new Error('Invalid fetched content hash')
      if (!Number.isSafeInteger(args.result.wireBytes) || args.result.wireBytes < 0
        || !Number.isSafeInteger(args.result.decodedBytes) || args.result.decodedBytes < 0) throw new Error('Invalid fetched byte count')
      if (args.result.excerpt && args.result.excerpt.length > 4_000) throw new Error('Fetched excerpt exceeds the maximum length')
      if (args.result.fetchPolicyVersion.length > 96 || args.result.rightsPolicyVersion.length > 96) throw new Error('Invalid policy version')
      const rightsCombinationIsValid = (args.result.rightsStatus === 'prohibited' && args.result.rightsProvenance === 'noarchive')
        || (args.result.rightsStatus === 'permitted' && ['link_license', 'html_license'].includes(args.result.rightsProvenance))
        || (args.result.rightsStatus === 'unknown' && args.result.rightsProvenance === 'none')
      if (!rightsCombinationIsValid) {
        throw new Error('Invalid rights decision')
      }
      const nextRevision = incrementRecordRevision(source.recordRevision)
      const retainPrivateLocator = args.result.rightsStatus === 'permitted'
      await ctx.db.patch(source._id, {
        status: 'fetched',
        effectiveStatus: 'fetched',
        recordRevision: nextRevision,
        contentHash: args.result.contentHash,
        sourceRevision: `sha256:${args.result.contentHash}`,
        publicLocator: finalPublicLocator,
        privateLocator: retainPrivateLocator ? finalUrl : undefined,
        contentType: args.result.contentType,
        wireBytes: args.result.wireBytes,
        decodedBytes: args.result.decodedBytes,
        rightsStatus: args.result.rightsStatus,
        rightsProvenance: args.result.rightsProvenance,
        rightsPolicyVersion: args.result.rightsPolicyVersion,
        fetchPolicyVersion: args.result.fetchPolicyVersion,
        trustClassification: 'untrusted_source_data',
        fetchedAt: now,
        updatedAt: now,
      })
      await ctx.db.insert('learnSourceExcerpts', {
        userId,
        sourceSnapshotId: source._id,
        locator: finalPublicLocator,
        privateLocator: retainPrivateLocator ? finalUrl : undefined,
        excerpt: args.result.rightsStatus === 'permitted' ? args.result.excerpt : undefined,
        rightsStatus: args.result.rightsStatus,
        trustClassification: 'untrusted_source_data',
      })
      if (!retainPrivateLocator) {
        await ctx.db.patch(identity._id, {
          externalKey: await tombstonedIdentityKey(identity),
          canonicalUrl: undefined,
          publicLocator: finalPublicLocator,
          privateLocator: undefined,
          tombstonedAt: identity.tombstonedAt ?? now,
        })
      }
      response = { sourceSnapshotId: source._id, status: 'fetched', effectiveStatus: 'fetched', recordRevision: nextRevision }
    }
    else {
      requireSourceTransition(source.status, 'unavailable')
      const nextRevision = incrementRecordRevision(source.recordRevision)
      await ctx.db.patch(source._id, {
        status: 'unavailable',
        effectiveStatus: 'unavailable',
        recordRevision: nextRevision,
        unavailableReason: args.result.reason.slice(0, 96),
        privateLocator: undefined,
        fetchPolicyVersion: args.result.fetchPolicyVersion,
        updatedAt: now,
      })
      await ctx.db.patch(identity._id, {
        externalKey: await tombstonedIdentityKey(identity),
        canonicalUrl: undefined,
        privateLocator: undefined,
        publicLocator: sanitizePublicSourceLocator(identity.publicLocator),
        tombstonedAt: identity.tombstonedAt ?? now,
      })
      response = { sourceSnapshotId: source._id, status: 'unavailable', effectiveStatus: 'unavailable', recordRevision: nextRevision, unavailableReason: args.result.reason.slice(0, 96) }
    }
    await ctx.db.delete(lease._id)
    return await saveReceipt(ctx, {
      userId,
      learningVoidId: source.learningVoidId,
      sourceSnapshotId: source._id,
      idempotencyKey: args.idempotencyKey,
      command: 'fetch_source',
      requestFingerprint: args.requestFingerprint,
      response,
    })
  },
})

export const releaseFetchLease = internalMutation({
  args: {
    tokenIdentifier: v.string(),
    leaseId: v.id('learnSourceFetchLeases'),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    const lease = await ctx.db.get(args.leaseId)
    if (lease && lease.userId === args.tokenIdentifier && lease.leaseToken === args.leaseToken) {
      await ctx.db.delete(lease._id)
      return true
    }
    return false
  },
})

export const recordEvaluation = internalMutation({
  args: {
    tokenIdentifier: v.string(),
    sourceSnapshotId: v.id('learnSourceSnapshots'),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
    conflictStatus: v.union(v.literal('clear'), v.literal('unresolved')),
  },
  handler: async (ctx, args) => {
    validateKey(args.idempotencyKey)
    validateRevision(args.expectedRevision)
    if (!(await hasLearnV2Access(ctx, args.tokenIdentifier))) throw new Error('Learn V2 access denied')
    const requestFingerprint = await digest({ sourceSnapshotId: String(args.sourceSnapshotId), expectedRevision: args.expectedRevision, conflictStatus: args.conflictStatus })
    const prior = await findReceipt(ctx, args.tokenIdentifier, args.idempotencyKey)
    if (prior) return replayReceipt(prior, 'evaluate_source', requestFingerprint)
    const source = await requireOwnedSource(ctx, args.tokenIdentifier, args.sourceSnapshotId)
    await requireOpenSourceReview(ctx, args.tokenIdentifier, source.blueprintRevisionId)
    if (currentRevision(source) !== args.expectedRevision) throw new Error('Source revision conflict')
    requireSourceTransition(source.status, 'evaluated')
    if (effectiveStatus(source) !== 'fetched' || !source.rightsStatus) throw new Error('Invalid source transition')
    const now = Date.now()
    const recordRevision = incrementRecordRevision(source.recordRevision)
    await ctx.db.patch(source._id, { status: 'evaluated', effectiveStatus: 'evaluated', conflictStatus: args.conflictStatus, evaluatedAt: now, updatedAt: now, recordRevision })
    const response = { sourceSnapshotId: source._id, status: 'evaluated', effectiveStatus: 'evaluated', recordRevision, conflictStatus: args.conflictStatus }
    return await saveReceipt(ctx, { userId: args.tokenIdentifier, learningVoidId: source.learningVoidId, sourceSnapshotId: source._id, idempotencyKey: args.idempotencyKey, command: 'evaluate_source', requestFingerprint, response })
  },
})

// Folder evidence is already fetched into Budds-owned storage. This command is
// the authoritative handoff from a frozen, still-accessible manifest entry to
// the common source evaluation lifecycle; it never accepts the source for the
// learner and it never persists document text.
async function prepareFolderSourceCommand(ctx: MutationCtx, args: {
  tokenIdentifier: string
  sourceSnapshotId: Id<'learnSourceSnapshots'>
  expectedRevision: number
  idempotencyKey: string
  finalizeForReview: boolean
}) {
    validateKey(args.idempotencyKey)
    validateRevision(args.expectedRevision)
    if (!(await hasLearnV2Access(ctx, args.tokenIdentifier))) throw new Error('Learn V2 access denied')
    const command = args.finalizeForReview ? 'prepare_folder_source_for_review' : 'prepare_folder_source'
    const requestFingerprint = await digest({ sourceSnapshotId: String(args.sourceSnapshotId), expectedRevision: args.expectedRevision, finalizeForReview: args.finalizeForReview })
    const prior = await findReceipt(ctx, args.tokenIdentifier, args.idempotencyKey)
    if (prior) return replayReceipt(prior, command, requestFingerprint)
    const source = await requireOwnedSource(ctx, args.tokenIdentifier, args.sourceSnapshotId)
    await requireOpenSourceReview(ctx, args.tokenIdentifier, source.blueprintRevisionId)
    if (currentRevision(source) !== args.expectedRevision) throw new Error('Source revision conflict')
    if (source.status !== 'candidate' || effectiveStatus(source) !== 'candidate') throw new Error('Invalid source transition')
    const identity = await ctx.db.get(source.sourceIdentityId)
    if (!identity || identity.userId !== args.tokenIdentifier || identity.origin !== 'folder_document' || identity.tombstonedAt || !identity.folderDocumentId) {
      throw new Error('Folder source identity unavailable')
    }
    if (!source.blueprintRevisionId || !source.folderManifestId || !source.contentHash || !source.sourceRevision || !source.objectKey) {
      throw new Error('Folder source snapshot is incomplete')
    }
    const manifest = await ctx.db.get(source.folderManifestId)
    if (!manifest || manifest.userId !== args.tokenIdentifier || manifest.learningVoidId !== source.learningVoidId
      || manifest.blueprintRevisionId !== source.blueprintRevisionId || manifest.status !== 'frozen') {
      throw new Error('Frozen folder source manifest unavailable')
    }
    const entry = await ctx.db.query('learnFolderSourceManifestEntries')
      .withIndex('by_userId_and_manifestId_and_documentId', q => q
        .eq('userId', args.tokenIdentifier)
        .eq('manifestId', manifest._id)
        .eq('documentId', identity.folderDocumentId))
      .unique()
    if (!entry || entry.sourceSnapshotId !== source._id || entry.sourceIdentityId !== identity._id
      || entry.availability !== 'available' || entry.evidencePurgedAt !== undefined
      || entry.contentHash !== source.contentHash || entry.documentRevision !== source.sourceRevision) {
      throw new Error('Frozen folder source entry unavailable')
    }
    const document = await ctx.db.get(identity.folderDocumentId)
    if (!document || document.userId !== args.tokenIdentifier || document.status !== 'success'
      || document.r2Key?.trim() !== source.objectKey || document.contentHash?.trim().toLowerCase() !== source.contentHash
      || document.sourceRevision?.trim() !== source.sourceRevision) {
      throw new Error('Folder source revision is no longer accessible')
    }
    const now = Date.now()
    const recordRevision = incrementRecordRevision(source.recordRevision)
    await ctx.db.patch(source._id, {
      status: 'fetched',
      effectiveStatus: 'fetched',
      recordRevision,
      rightsStatus: 'unknown',
      rightsProvenance: 'none',
      rightsPolicyVersion: 'learn-v2.user-source-retention.v1',
      trustClassification: 'untrusted_source_data',
      fetchedAt: now,
      updatedAt: now,
    })
    const existingExcerpt = await ctx.db.query('learnSourceExcerpts')
      .withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', args.tokenIdentifier).eq('sourceSnapshotId', source._id))
      .unique()
    const normalizedExcerpt = {
      locator: `sha256:${source.contentHash.toLowerCase()}`,
      privateLocator: undefined,
      excerpt: undefined,
      rightsStatus: 'unknown' as const,
      trustClassification: 'untrusted_source_data' as const,
      evidencePurgedAt: undefined,
    }
    if (!existingExcerpt) {
      await ctx.db.insert('learnSourceExcerpts', {
        userId: args.tokenIdentifier,
        sourceSnapshotId: source._id,
        ...normalizedExcerpt,
      })
    }
    else await ctx.db.patch(existingExcerpt._id, normalizedExcerpt)
    const finalRecordRevision = args.finalizeForReview ? incrementRecordRevision(recordRevision) : recordRevision
    if (args.finalizeForReview) {
      await ctx.db.patch(source._id, {
        status: 'evaluated',
        effectiveStatus: 'evaluated',
        conflictStatus: 'clear',
        evaluatedAt: now,
        recordRevision: finalRecordRevision,
        updatedAt: now,
      })
    }
    const response = {
      sourceSnapshotId: source._id,
      status: args.finalizeForReview ? 'evaluated' : 'fetched',
      effectiveStatus: args.finalizeForReview ? 'evaluated' : 'fetched',
      recordRevision: finalRecordRevision,
      ...(args.finalizeForReview ? { conflictStatus: 'clear' as const } : {}),
    }
    return await saveReceipt(ctx, {
      userId: args.tokenIdentifier,
      learningVoidId: source.learningVoidId,
      sourceSnapshotId: source._id,
      idempotencyKey: args.idempotencyKey,
      command,
      requestFingerprint,
      response,
    })
}

export const prepareFolderSource = internalMutation({
  args: {
    tokenIdentifier: v.string(),
    sourceSnapshotId: v.id('learnSourceSnapshots'),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => await prepareFolderSourceCommand(ctx, { ...args, finalizeForReview: false }),
})

export const prepareFolderSourceForReview = mutation({
  args: {
    sourceSnapshotId: v.id('learnSourceSnapshots'),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => await prepareFolderSourceCommand(ctx, {
    ...args,
    tokenIdentifier: await requireLearnV2MutationAccess(ctx),
    finalizeForReview: true,
  }),
})

async function terminalCommand(ctx: MutationCtx, args: {
  userId: string
  sourceSnapshotId: Id<'learnSourceSnapshots'>
  expectedRevision: number
  idempotencyKey: string
  command: 'accept_source' | 'reject_source' | 'mark_unavailable'
  reason?: string
}) {
  validateKey(args.idempotencyKey)
  validateRevision(args.expectedRevision)
  const requestFingerprint = await digest({ sourceSnapshotId: String(args.sourceSnapshotId), expectedRevision: args.expectedRevision, reason: args.reason })
  const prior = await findReceipt(ctx, args.userId, args.idempotencyKey)
  if (prior) return replayReceipt(prior, args.command, requestFingerprint)
  const source = await requireOwnedSource(ctx, args.userId, args.sourceSnapshotId)
  const blueprint = await requireNewestBlueprintRevision(ctx, args.userId, source.blueprintRevisionId)
  if (args.command !== 'mark_unavailable' && !['draft', 'source_review'].includes(blueprint.status)) {
    throw new Error('Source membership is immutable after source review')
  }
  if (currentRevision(source) !== args.expectedRevision) throw new Error('Source revision conflict')
  const now = Date.now()
  let recordRevision = currentRevision(source)
  let status: 'user_accepted' | 'rejected' | 'unavailable'
  let terminalReason: string | undefined
  let acceptedSourceSetChanged = false
  if (args.command === 'accept_source') {
    requireSourceTransition(source.status, 'user_accepted')
    if (effectiveStatus(source) !== 'evaluated' || source.conflictStatus !== 'clear' || source.rightsStatus === 'prohibited') throw new Error('Source cannot be accepted')
    if (!source.blueprintRevisionId) throw new Error('Blueprint revision not found')
    const currentAccepted = await ctx.db.query('learnSourceSnapshots')
      .withIndex('by_userId_and_blueprintRevisionId_and_effectiveStatus', q => q
        .eq('userId', args.userId).eq('blueprintRevisionId', source.blueprintRevisionId).eq('effectiveStatus', 'user_accepted'))
      .take(LEARN_V2_BLUEPRINT_LIMITS.maximumAcceptedSources)
    const legacyAccepted = await ctx.db.query('learnSourceSnapshots')
      .withIndex('by_userId_and_blueprintRevisionId_and_effectiveStatus_and_status', q => q
        .eq('userId', args.userId).eq('blueprintRevisionId', source.blueprintRevisionId).eq('effectiveStatus', undefined).eq('status', 'user_accepted'))
      .take(LEARN_V2_BLUEPRINT_LIMITS.maximumAcceptedSources)
    const acceptedCount = new Set([...currentAccepted, ...legacyAccepted].map(row => String(row._id))).size
    if (acceptedCount >= LEARN_V2_BLUEPRINT_LIMITS.maximumAcceptedSources) throw new Error('Blueprint already has the maximum accepted sources')
    recordRevision = incrementRecordRevision(source.recordRevision)
    status = 'user_accepted'
    acceptedSourceSetChanged = true
    await ctx.db.patch(source._id, { status, effectiveStatus: status, acceptedAt: now, recordRevision, updatedAt: now })
  }
  else if (args.command === 'reject_source') {
    requireSourceTransition(source.status, 'rejected')
    recordRevision = incrementRecordRevision(source.recordRevision)
    status = 'rejected'
    await ctx.db.patch(source._id, {
      status,
      effectiveStatus: status,
      rejectedAt: now,
      publicLocator: sanitizePublicSourceLocator(source.publicLocator),
      privateLocator: undefined,
      recordRevision,
      updatedAt: now,
    })
    const excerpt = await ctx.db.query('learnSourceExcerpts')
      .withIndex('by_userId_and_sourceSnapshotId', q => q
        .eq('userId', args.userId).eq('sourceSnapshotId', source._id))
      .unique()
    if (excerpt) {
      await ctx.db.patch(excerpt._id, {
        locator: sanitizePublicSourceLocator(source.publicLocator) ?? sanitizePublicSourceLocator(excerpt.locator) ?? 'source-unavailable',
        privateLocator: undefined,
        excerpt: undefined,
        evidencePurgedAt: now,
      })
    }
    const identity = await ctx.db.get(source.sourceIdentityId)
    if (identity && identity.userId === args.userId) {
      await ctx.db.patch(identity._id, {
        externalKey: await tombstonedIdentityKey(identity),
        canonicalUrl: undefined,
        privateLocator: undefined,
        publicLocator: sanitizePublicSourceLocator(identity.publicLocator),
        tombstonedAt: identity.tombstonedAt ?? now,
      })
    }
  }
  else {
    if (!['user_accepted', 'rejected', 'unavailable'].includes(source.status)) {
      requireSourceTransition(source.status, 'unavailable')
    }
    status = 'unavailable'
    acceptedSourceSetChanged = effectiveStatus(source) === 'user_accepted'
    const unavailableReason = source.unavailableReason ?? (args.reason ?? 'source_deleted').slice(0, 96)
    terminalReason = unavailableReason
    const needsAuthoritativePatch = effectiveStatus(source) !== 'unavailable'
      || source.unavailableReason === undefined
      || source.privateLocator !== undefined
    if (needsAuthoritativePatch) {
      recordRevision = incrementRecordRevision(source.recordRevision)
      await ctx.db.patch(source._id, {
        // Accepted/rejected lifecycle history remains immutable; availability
        // is a separate indexed projection.
        status: ['user_accepted', 'rejected'].includes(source.status) ? source.status : 'unavailable',
        effectiveStatus: 'unavailable',
        unavailableReason,
        privateLocator: undefined,
        recordRevision,
        updatedAt: now,
      })
    }
    const identity = await ctx.db.get(source.sourceIdentityId)
    if (identity && identity.userId === args.userId) {
      await ctx.db.patch(identity._id, {
        externalKey: await tombstonedIdentityKey(identity),
        canonicalUrl: undefined,
        publicLocator: undefined,
        privateLocator: undefined,
        title: undefined,
        tombstonedAt: identity.tombstonedAt ?? now,
      })
    }
    await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeSourceEvidence, {
      userId: args.userId,
      sourceIdentityId: source.sourceIdentityId,
      reason: unavailableReason,
    })
  }
  if (acceptedSourceSetChanged && blueprint.status === 'source_review') {
    await ctx.db.patch(blueprint._id, {
      recordRevision: incrementRecordRevision(blueprint.recordRevision),
      updatedAt: now,
    })
  }
  const response: Record<string, unknown> = {
    sourceSnapshotId: source._id,
    status: args.command === 'mark_unavailable' && ['user_accepted', 'rejected'].includes(source.status)
      ? source.status
      : status,
    effectiveStatus: status,
    recordRevision,
    ...(terminalReason ? { unavailableReason: terminalReason } : {}),
  }
  return await saveReceipt(ctx, { userId: args.userId, learningVoidId: source.learningVoidId, sourceSnapshotId: source._id, idempotencyKey: args.idempotencyKey, command: args.command, requestFingerprint, response })
}

export const acceptSource = mutation({
  args: { sourceSnapshotId: v.id('learnSourceSnapshots'), expectedRevision: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => terminalCommand(ctx, { ...args, userId: await requireLearnV2MutationAccess(ctx), command: 'accept_source' }),
})

export const rejectSource = mutation({
  args: { sourceSnapshotId: v.id('learnSourceSnapshots'), expectedRevision: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => terminalCommand(ctx, { ...args, userId: await requireLearnV2MutationAccess(ctx), command: 'reject_source' }),
})

export const markUnavailable = mutation({
  args: { sourceSnapshotId: v.id('learnSourceSnapshots'), expectedRevision: v.number(), idempotencyKey: v.string(), reason: v.union(v.literal('source_deleted'), v.literal('access_lost'), v.literal('policy_denied')) },
  handler: async (ctx, args) => terminalCommand(ctx, { ...args, userId: await requireLearnV2MutationAccess(ctx), command: 'mark_unavailable' }),
})
