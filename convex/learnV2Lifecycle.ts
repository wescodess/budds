import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireLearnV2MutationAccess, requireLearnV2QueryAccess } from './lib/learnV2Access'
import { isLearnV2TransitionAllowed } from '../shared/learn-v2-contract'
import { cloneBlueprintChildren } from './lib/learnV2BlueprintClone'

const voidStatus = v.union(v.literal('draft'), v.literal('sourcing'), v.literal('source_review'), v.literal('map_review'), v.literal('calibration'), v.literal('plan_review'), v.literal('scheduled'), v.literal('active'), v.literal('completed'), v.literal('paused'), v.literal('needs_attention'), v.literal('failed'), v.literal('archived'))
const blueprintStatus = v.union(v.literal('draft'), v.literal('source_review'), v.literal('map_review'), v.literal('accepted'), v.literal('active'), v.literal('superseded'))
const MAX_LIST_PAGE_SIZE = 8
const MAX_LEARNING_VOID_TITLE_LENGTH = 200
const MAX_IDEMPOTENCY_KEY_LENGTH = 128

type VoidStatus = Doc<'learningVoids'>['status']
type BlueprintStatus = Doc<'learnBlueprintRevisions'>['status']

function fingerprint(command: string, args: Record<string, unknown>) {
  return JSON.stringify({ command, ...args })
}

function assertNonEmptyText(value: string, label: string) {
  if (value.trim().length === 0) throw new Error(`${label} must not be blank`)
}

function assertTextAtMost(value: string, maximumLength: number, label: string) {
  if (value.length > maximumLength) throw new Error(`${label} must not exceed ${maximumLength} characters`)
}

function assertIdempotencyKey(value: string) {
  assertNonEmptyText(value, 'Idempotency key')
  assertTextAtMost(value, MAX_IDEMPOTENCY_KEY_LENGTH, 'Idempotency key')
}

function assertPositiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a safe positive integer`)
}

async function replayOrReject(ctx: MutationCtx, userId: string, idempotencyKey: string, requestFingerprint: string) {
  const stored = await ctx.db.query('learnLifecycleReceipts')
    .withIndex('by_userId_and_idempotencyKey', q => q.eq('userId', userId).eq('idempotencyKey', idempotencyKey)).unique()
  if (!stored) return null
  if (stored.requestFingerprint !== requestFingerprint) throw new Error('Idempotency key was already used for a different request')
  await requireLiveOwnedVoid(ctx, userId, stored.learningVoidId)
  return stored
}

function learningVoidOutcome(data: { learningVoidId: Id<'learningVoids'>, status: NonNullable<Doc<'learnLifecycleReceipts'>['status']>, revision: number, activeBlueprintRevisionId?: Id<'learnBlueprintRevisions'> }) {
  return {
    _id: data.learningVoidId,
    status: data.status,
    revision: data.revision,
    activeBlueprintRevisionId: data.activeBlueprintRevisionId ?? null,
  }
}

function learningVoidReceiptOutcome(receipt: Doc<'learnLifecycleReceipts'>) {
  if (!receipt.status) throw new Error('Lifecycle receipt is missing its Learning Void snapshot')
  return learningVoidOutcome({ learningVoidId: receipt.learningVoidId, status: receipt.status, revision: receipt.revision, activeBlueprintRevisionId: receipt.blueprintRevisionId })
}

function blueprintRevisionOutcome(data: { blueprintRevisionId: Id<'learnBlueprintRevisions'>, status: NonNullable<Doc<'learnLifecycleReceipts'>['status']>, blueprintRevisionOrdinal: number, blueprintRecordRevision: number }) {
  return {
    _id: data.blueprintRevisionId,
    status: data.status,
    revision: data.blueprintRevisionOrdinal,
    recordRevision: data.blueprintRecordRevision,
  }
}

function blueprintRevisionReceiptOutcome(receipt: Doc<'learnLifecycleReceipts'>) {
  if (!receipt.blueprintRevisionId || !receipt.status || receipt.blueprintRevisionOrdinal === undefined || receipt.blueprintRecordRevision === undefined) throw new Error('Lifecycle receipt is missing its Blueprint revision snapshot')
  return blueprintRevisionOutcome({ blueprintRevisionId: receipt.blueprintRevisionId, status: receipt.status, blueprintRevisionOrdinal: receipt.blueprintRevisionOrdinal, blueprintRecordRevision: receipt.blueprintRecordRevision })
}

async function persistReceipt(ctx: MutationCtx, data: {
  userId: string, learningVoidId: Id<'learningVoids'>, idempotencyKey: string, command: string, requestFingerprint: string,
  revision: number, status?: VoidStatus | BlueprintStatus,
  blueprintRevisionId?: Id<'learnBlueprintRevisions'>,
  blueprintRevisionOrdinal?: number, blueprintRecordRevision?: number,
}) {
  await ctx.db.insert('learnLifecycleReceipts', { ...data, createdAt: Date.now() })
}

async function requireLiveOwnedVoid(ctx: MutationCtx, userId: string, learningVoidId: Id<'learningVoids'>) {
  const learningVoid = await ctx.db.get(learningVoidId)
  if (!learningVoid || learningVoid.userId !== userId) throw new Error('Learning Void not found')
  const folder = await ctx.db.get(learningVoid.folderId)
  if (!folder || folder.userId !== userId) throw new Error('Learning Void folder not found')
  return learningVoid
}

async function isLiveOwnedVoid(ctx: QueryCtx, userId: string, learningVoidId: Id<'learningVoids'>) {
  const learningVoid = await ctx.db.get(learningVoidId)
  if (!learningVoid || learningVoid.userId !== userId) return false
  const folder = await ctx.db.get(learningVoid.folderId)
  return folder?.userId === userId
}

function assertUnguardedTransition(machine: 'learningVoid' | 'blueprintRevision', from: VoidStatus | BlueprintStatus, to: VoidStatus | BlueprintStatus) {
  if (!isLearnV2TransitionAllowed(machine as never, from as never, to as never)) throw new Error(`${machine} transition ${from} -> ${to} is not allowed or is guarded`)
}

export const createLearningVoid = mutation({
  args: { folderId: v.id('folders'), title: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    assertNonEmptyText(args.title, 'Learning Void title')
    assertTextAtMost(args.title, MAX_LEARNING_VOID_TITLE_LENGTH, 'Learning Void title')
    assertIdempotencyKey(args.idempotencyKey)
    const userId = await requireLearnV2MutationAccess(ctx)
    const requestFingerprint = fingerprint('createLearningVoid', args)
    const replay = await replayOrReject(ctx, userId, args.idempotencyKey, requestFingerprint)
    if (replay) return learningVoidReceiptOutcome(replay)
    const folder = await ctx.db.get(args.folderId)
    if (!folder || folder.userId !== userId) throw new Error('Learning Void folder not found')
    const now = Date.now()
    const id = await ctx.db.insert('learningVoids', { userId, folderId: args.folderId, title: args.title, status: 'draft', revision: 1, lastIdempotencyKey: args.idempotencyKey, createdAt: now, updatedAt: now })
    await persistReceipt(ctx, { userId, learningVoidId: id, idempotencyKey: args.idempotencyKey, command: 'createLearningVoid', requestFingerprint, revision: 1, status: 'draft' })
    return learningVoidOutcome({ learningVoidId: id, status: 'draft', revision: 1 })
  },
})

export const transitionLearningVoid = mutation({
  args: { learningVoidId: v.id('learningVoids'), status: voidStatus, expectedRevision: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    assertPositiveInteger(args.expectedRevision, 'Expected Learning Void revision')
    assertIdempotencyKey(args.idempotencyKey)
    const userId = await requireLearnV2MutationAccess(ctx)
    const requestFingerprint = fingerprint('transitionLearningVoid', args)
    const replay = await replayOrReject(ctx, userId, args.idempotencyKey, requestFingerprint)
    if (replay) return learningVoidReceiptOutcome(replay)
    const row = await requireLiveOwnedVoid(ctx, userId, args.learningVoidId)
    if (row.revision !== args.expectedRevision) throw new Error('Learning Void revision conflict')
    if (['map_review', 'calibration', 'plan_review', 'scheduled', 'active', 'completed'].includes(args.status)) {
      throw new Error('Learning Void forward transition requires its dedicated domain command')
    }
    assertUnguardedTransition('learningVoid', row.status, args.status)
    const revision = row.revision + 1
    await ctx.db.patch(row._id, { status: args.status, revision, lastIdempotencyKey: args.idempotencyKey, updatedAt: Date.now() })
    await persistReceipt(ctx, { userId, learningVoidId: row._id, idempotencyKey: args.idempotencyKey, command: 'transitionLearningVoid', requestFingerprint, revision, status: args.status, blueprintRevisionId: row.activeBlueprintRevisionId })
    return learningVoidOutcome({ learningVoidId: row._id, status: args.status, revision, activeBlueprintRevisionId: row.activeBlueprintRevisionId })
  },
})

export const createBlueprintDraft = mutation({
  args: { learningVoidId: v.id('learningVoids'), expectedVoidRevision: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    assertPositiveInteger(args.expectedVoidRevision, 'Expected Learning Void revision')
    assertIdempotencyKey(args.idempotencyKey)
    const userId = await requireLearnV2MutationAccess(ctx)
    const requestFingerprint = fingerprint('createBlueprintDraft', args)
    const replay = await replayOrReject(ctx, userId, args.idempotencyKey, requestFingerprint)
    if (replay) return blueprintRevisionReceiptOutcome(replay)
    const learningVoid = await requireLiveOwnedVoid(ctx, userId, args.learningVoidId)
    if (learningVoid.revision !== args.expectedVoidRevision) throw new Error('Learning Void revision conflict')
    const existingBlueprint = await ctx.db.query('learnBlueprints')
      .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoid._id)).first()
    if (existingBlueprint) throw new Error('Learning Void already has a stable Blueprint')
    const now = Date.now()
    const blueprintId = await ctx.db.insert('learnBlueprints', { userId, learningVoidId: learningVoid._id, revision: 1, createdAt: now })
    const id = await ctx.db.insert('learnBlueprintRevisions', { userId, blueprintId, learningVoidId: learningVoid._id, revision: 1, recordRevision: 1, status: 'draft', createdAt: now, updatedAt: now })
    await ctx.db.patch(learningVoid._id, { revision: learningVoid.revision + 1, updatedAt: now })
    await persistReceipt(ctx, { userId, learningVoidId: learningVoid._id, idempotencyKey: args.idempotencyKey, command: 'createBlueprintDraft', requestFingerprint, revision: 1, status: 'draft', blueprintRevisionId: id, blueprintRevisionOrdinal: 1, blueprintRecordRevision: 1 })
    return blueprintRevisionOutcome({ blueprintRevisionId: id, status: 'draft', blueprintRevisionOrdinal: 1, blueprintRecordRevision: 1 })
  },
})

export const forkBlueprintDraft = mutation({
  args: { blueprintRevisionId: v.id('learnBlueprintRevisions'), expectedRecordRevision: v.number(), expectedVoidRevision: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    assertPositiveInteger(args.expectedRecordRevision, 'Expected Blueprint record revision')
    assertPositiveInteger(args.expectedVoidRevision, 'Expected Learning Void revision')
    assertIdempotencyKey(args.idempotencyKey)
    const userId = await requireLearnV2MutationAccess(ctx)
    const requestFingerprint = fingerprint('forkBlueprintDraft', args)
    const replay = await replayOrReject(ctx, userId, args.idempotencyKey, requestFingerprint)
    if (replay) return blueprintRevisionReceiptOutcome(replay)
    const source = await ctx.db.get(args.blueprintRevisionId)
    if (!source || source.userId !== userId) throw new Error('Blueprint revision not found')
    const learningVoid = await requireLiveOwnedVoid(ctx, userId, source.learningVoidId)
    if (source.recordRevision !== args.expectedRecordRevision || learningVoid.revision !== args.expectedVoidRevision) throw new Error('Blueprint revision conflict')
    const latest = await ctx.db.query('learnBlueprintRevisions')
      .withIndex('by_userId_and_blueprintId_and_revision', q => q.eq('userId', userId).eq('blueprintId', source.blueprintId))
      .order('desc').first()
    if (!latest) throw new Error('Blueprint revision not found')
    if (latest._id !== source._id) throw new Error('Blueprint revision conflict')
    if (!['draft', 'source_review', 'map_review', 'accepted', 'active'].includes(source.status)) throw new Error('Blueprint revision cannot be edited')
    if (!['draft', 'source_review', 'map_review', 'calibration'].includes(learningVoid.status)) throw new Error('Learning Void is not ready for a Blueprint edit')
    const now = Date.now()
    const ordinal = latest.revision + 1
    const id = await ctx.db.insert('learnBlueprintRevisions', {
      userId,
      blueprintId: source.blueprintId,
      learningVoidId: source.learningVoidId,
      revision: ordinal,
      recordRevision: 1,
      status: 'draft',
      intentVersion: source.intentVersion,
      desiredOutcome: source.desiredOutcome,
      mode: source.mode,
      desiredDepth: source.desiredDepth,
      sourcePolicy: source.sourcePolicy,
      generatorVersion: source.generatorVersion,
      createdAt: now,
      updatedAt: now,
    })
    const copyMap = ['map_review', 'accepted', 'active'].includes(source.status)
    const clonedSourceIds = copyMap ? await cloneBlueprintChildren(ctx, userId, source, id) : new Map<string, Id<'learnSourceSnapshots'>>()
    const generationSupportingSourceSnapshotIds = copyMap ? source.generationSupportingSourceSnapshotIds?.map(sourceId => {
      const cloneId = clonedSourceIds.get(String(sourceId))
      if (!cloneId) throw new Error('Blueprint supporting source scope mismatch')
      return cloneId
    }) : undefined
    if (generationSupportingSourceSnapshotIds) await ctx.db.patch(id, { generationSupportingSourceSnapshotIds })
    await ctx.db.patch(learningVoid._id, {
      status: learningVoid.status === 'calibration' ? 'map_review' : learningVoid.status,
      revision: learningVoid.revision + 1,
      updatedAt: now,
    })
    await persistReceipt(ctx, { userId, learningVoidId: learningVoid._id, idempotencyKey: args.idempotencyKey, command: 'forkBlueprintDraft', requestFingerprint, revision: 1, status: 'draft', blueprintRevisionId: id, blueprintRevisionOrdinal: ordinal, blueprintRecordRevision: 1 })
    return blueprintRevisionOutcome({ blueprintRevisionId: id, status: 'draft', blueprintRevisionOrdinal: ordinal, blueprintRecordRevision: 1 })
  },
})

export const transitionBlueprintRevision = mutation({
  args: { blueprintRevisionId: v.id('learnBlueprintRevisions'), status: blueprintStatus, expectedRecordRevision: v.number(), expectedVoidRevision: v.optional(v.number()), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    assertPositiveInteger(args.expectedRecordRevision, 'Expected Blueprint record revision')
    if (args.expectedVoidRevision !== undefined) assertPositiveInteger(args.expectedVoidRevision, 'Expected Learning Void revision')
    assertIdempotencyKey(args.idempotencyKey)
    const userId = await requireLearnV2MutationAccess(ctx)
    const requestFingerprint = fingerprint('transitionBlueprintRevision', args)
    const replay = await replayOrReject(ctx, userId, args.idempotencyKey, requestFingerprint)
    if (replay) return blueprintRevisionReceiptOutcome(replay)
    const row = await ctx.db.get(args.blueprintRevisionId)
    if (!row || row.userId !== userId) throw new Error('Blueprint revision not found')
    if (row.recordRevision !== args.expectedRecordRevision) throw new Error('Blueprint revision conflict')
    if (['map_review', 'accepted', 'active'].includes(args.status)) {
      throw new Error('Blueprint forward transition requires its dedicated domain command')
    }
    assertUnguardedTransition('blueprintRevision', row.status, args.status)
    const learningVoid = await requireLiveOwnedVoid(ctx, userId, row.learningVoidId)
    const now = Date.now()
    const recordRevision = row.recordRevision + 1
    if (args.status === 'active') {
      if (args.expectedVoidRevision === undefined) throw new Error('Activation requires an expected Learning Void revision')
      if (learningVoid.revision !== args.expectedVoidRevision) throw new Error('Learning Void revision conflict')
    }
    else if (args.expectedVoidRevision !== undefined) {
      throw new Error('Expected Learning Void revision is only valid for activation')
    }
    if (args.status === 'active') {
      const current = learningVoid.activeBlueprintRevisionId && await ctx.db.get(learningVoid.activeBlueprintRevisionId)
      if (current && current.userId === userId && current._id !== row._id) {
        if (!isLearnV2TransitionAllowed('blueprintRevision', current.status, 'superseded', 'replacement_revision_activated')) throw new Error('Active blueprint cannot be superseded')
        await ctx.db.patch(current._id, { status: 'superseded', recordRevision: current.recordRevision + 1, updatedAt: now })
      }
      await ctx.db.patch(learningVoid._id, { activeBlueprintRevisionId: row._id, revision: learningVoid.revision + 1, updatedAt: now })
    }
    await ctx.db.patch(row._id, { status: args.status, recordRevision, acceptedAt: args.status === 'accepted' ? now : row.acceptedAt, updatedAt: now })
    await persistReceipt(ctx, { userId, learningVoidId: learningVoid._id, idempotencyKey: args.idempotencyKey, command: 'transitionBlueprintRevision', requestFingerprint, revision: recordRevision, status: args.status, blueprintRevisionId: row._id, blueprintRevisionOrdinal: row.revision, blueprintRecordRevision: recordRevision })
    return blueprintRevisionOutcome({ blueprintRevisionId: row._id, status: args.status, blueprintRevisionOrdinal: row.revision, blueprintRecordRevision: recordRevision })
  },
})

export const getLearningVoid = query({
  args: { learningVoidId: v.id('learningVoids') },
  handler: async (ctx, args) => {
    const userId = await requireLearnV2QueryAccess(ctx)
    const row = await ctx.db.get(args.learningVoidId)
    return row && await isLiveOwnedVoid(ctx, userId, row._id) ? row : null
  },
})

export const listLearningVoids = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const userId = await requireLearnV2QueryAccess(ctx)
    const page = await ctx.db.query('learningVoids').withIndex('by_userId', q => q.eq('userId', userId)).paginate({ cursor: args.paginationOpts.cursor, numItems: Math.min(MAX_LIST_PAGE_SIZE, Math.max(1, Math.floor(args.paginationOpts.numItems))) })
    const live = []
    for (const row of page.page) if (await isLiveOwnedVoid(ctx, userId, row._id)) live.push(row)
    return { ...page, page: live }
  },
})

export const getBlueprintRevision = query({
  args: { blueprintRevisionId: v.id('learnBlueprintRevisions') },
  handler: async (ctx, args) => {
    const userId = await requireLearnV2QueryAccess(ctx)
    const row = await ctx.db.get(args.blueprintRevisionId)
    return row && await isLiveOwnedVoid(ctx, userId, row.learningVoidId) ? row : null
  },
})
