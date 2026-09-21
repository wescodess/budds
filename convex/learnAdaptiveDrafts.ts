import { v } from 'convex/values'
import { mutation, query, type MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireAdaptiveMutationAccess, requireAdaptiveQueryAccess } from './lib/adaptiveLearnAccess'
import { boundedAdaptiveCommandReference, prepareAdaptiveCommand } from '../shared/adaptive-command-authority'
import { canonicalNeedFirstUrl, NEED_FIRST_DRAFT_VERSION, needFirstDraftArgsValidator, validateNeedFirstDraftInput, type NeedFirstDraftInput } from '../shared/learn-adaptive-draft'
import { writeLearnActivityEvent } from './lib/learnAdaptiveEvents'

const RECEIPT_DETAIL_TTL_MS = 30 * 24 * 60 * 60 * 1_000

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`
}

function projectThread(thread: Doc<'learningThreads'>) {
  return {
    id: thread._id,
    originalNeed: thread.originalNeed,
    outcome: thread.outcome ?? thread.originalNeed,
    intent: thread.intent,
    availableTime: thread.availableTime,
    authorityKind: thread.authorityKind,
    sourceScope: thread.sourceScope,
    evidenceState: thread.evidenceState,
    lifecycle: thread.lifecycle,
    revision: thread.revision,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  }
}

async function storedSourceScope(ctx: MutationCtx, userId: string, sourceScope: NeedFirstDraftInput['sourceScope']): Promise<Doc<'learningThreads'>['sourceScope']> {
  if (sourceScope.kind === 'none') return sourceScope
  if (sourceScope.kind === 'folder') {
    const folder = await ctx.db.get(sourceScope.folderId as Id<'folders'>)
    if (!folder || folder.userId !== userId) throw new Error('Selected source is unavailable')
    return { kind: 'folder', sourceId: String(folder._id) }
  }
  if (sourceScope.kind === 'document') {
    const document = await ctx.db.get(sourceScope.documentId as Id<'documents'>)
    if (!document || document.userId !== userId) throw new Error('Selected source is unavailable')
    const folder = await ctx.db.get(document.folderId)
    if (!folder || folder.userId !== userId) throw new Error('Selected source is unavailable')
    return { kind: 'document', sourceId: String(document._id) }
  }
  if (sourceScope.kind === 'url') return { kind: 'url', urlHash: await sha256(canonicalNeedFirstUrl(sourceScope.url)) }
  return { kind: 'pasted', contentDigest: sourceScope.contentDigest, byteCount: sourceScope.byteCount }
}

export const createThreadDraft = mutation({
  args: { ...needFirstDraftArgsValidator, idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveMutationAccess(ctx)
    const input = validateNeedFirstDraftInput({ need: args.need, ...(args.outcome?.trim() ? { outcome: args.outcome } : {}), intent: args.intent, availableTime: args.availableTime, sourceScope: args.sourceScope as NeedFirstDraftInput['sourceScope'] })
    const prepared = await prepareAdaptiveCommand({ userId, commandName: 'createThreadDraft', targetId: 'new-thread', expectedRevision: 1, idempotencyKey: args.idempotencyKey, payload: input })
    const prior = await ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId_and_idempotencyKeyHash', q => q.eq('userId', userId).eq('idempotencyKeyHash', prepared.idempotencyKeyHash)).unique()
    if (prior) {
      if (prior.requestFingerprint !== prepared.requestFingerprint) return { kind: 'conflict' as const, code: 'duplicate_key' as const, retryable: false as const }
      if (!prior.resultReference || prior.resultRedactedAt !== undefined) return { kind: 'invalid' as const, code: 'result_expired' as const, retryable: false as const }
      const replay = JSON.parse(prior.resultReference) as { kind: 'created', threadId: Id<'learningThreads'>, revision: number, status: 'draft_created', receiptId: string }
      const thread = await ctx.db.get(prior.threadId)
      if (!thread || thread.userId !== userId || prior.threadId !== replay.threadId || replay.threadId !== thread._id || replay.revision !== 1) throw new Error('Created thread replay authority is unavailable')
      return { kind: 'created' as const, thread: projectThread(thread), status: replay.status, replayed: true as const, receiptId: replay.receiptId }
    }
    const sourceScope = await storedSourceScope(ctx, userId, input.sourceScope)
    const now = Date.now()
    const threadId = await ctx.db.insert('learningThreads', {
      userId,
      originalNeed: input.need,
      outcome: input.outcome?.trim() ? input.outcome : input.need,
      outcomeProvenance: input.outcome?.trim() ? 'explicit' : 'need_fallback',
      intent: input.intent,
      availableTime: input.availableTime,
      authorityKind: 'standalone',
      sourceScope,
      evidenceState: input.sourceScope.kind === 'none' ? 'none' : 'preparing',
      lifecycle: 'draft',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    })
    await writeLearnActivityEvent(ctx, {
      userId,
      threadId,
      eventType: 'thread_drafted',
      eventVersion: 'thread_drafted.v1',
      sourceVersion: NEED_FIRST_DRAFT_VERSION,
      contractVersion: 'learn-adaptive.thread.v1',
      semanticKey: `thread:${String(threadId)}:draft`,
      occurredAt: now,
      reasonCode: 'need_composer_submitted',
      outcomeCode: 'draft_created',
      metadata: {},
    })
    const thread = (await ctx.db.get(threadId))!
    const result = { kind: 'created' as const, thread: projectThread(thread), status: 'draft_created' as const, replayed: false as const }
    const receiptId = await ctx.db.insert('learnActivityCommandReceipts', {
      userId,
      threadId,
      idempotencyKeyHash: prepared.idempotencyKeyHash,
      requestFingerprint: prepared.requestFingerprint,
      commandName: 'createThreadDraft',
      targetRevision: 1,
      resultKind: 'ok',
      resultReference: null,
      errorReference: null,
      createdAt: now,
      resultExpiresAt: now + RECEIPT_DETAIL_TTL_MS,
      redactionStatus: 'pending',
    })
    const committed = { ...result, receiptId: String(receiptId) }
    await ctx.db.patch(receiptId, { resultReference: boundedAdaptiveCommandReference({ kind: 'created', threadId, revision: thread.revision, status: result.status, receiptId: String(receiptId) }) })
    return committed
  },
})

export const getThreadDraft = query({
  args: { threadId: v.id('learningThreads') },
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveQueryAccess(ctx)
    const thread = await ctx.db.get(args.threadId)
    if (!thread || thread.userId !== userId) return null
    return projectThread(thread)
  },
})
