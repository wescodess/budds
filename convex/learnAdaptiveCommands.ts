import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { internalMutation, type MutationCtx } from './_generated/server'
import { prepareAdaptiveCommand } from '../shared/adaptive-command-authority'
import { requireAdaptiveMutationAccess } from './lib/adaptiveLearnAccess'
import { requireAuth } from './lib/auth'

const RECEIPT_DETAIL_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_RESULT_REFERENCE_CHARS = 4_096

export type AdaptiveResult<T> =
  | { kind: 'ok', value: T, revision: number, receiptId: string }
  | { kind: 'conflict', code: 'stale_revision' | 'duplicate_key' | 'activity_boundary_changed', expectedRevision: number, actualRevision: number, authority: 'convex' }
  | { kind: 'denied' | 'blocked' | 'invalid', code: string, message: string, retryable: boolean }

type CommandInput<T> = {
  threadId: Id<'learningThreads'>
  expectedRevision: number
  idempotencyKey: string
  commandName: string
  payload: Record<string, unknown>
  apply: (ctx: MutationCtx, thread: Doc<'learningThreads'>, userId: string) => Promise<{ value: T, revision: number }>
}

export class AdaptiveCommandConflict extends Error {
  constructor(public readonly code: 'activity_boundary_changed', public readonly actualRevision: number) {
    super(code)
  }
}

function boundedReference(value: unknown): string {
  const encoded = JSON.stringify(value)
  if (encoded.length > MAX_RESULT_REFERENCE_CHARS) throw new Error('Adaptive command result exceeds receipt bounds')
  return encoded
}

export async function executeAdaptiveThreadCommand<T>(ctx: MutationCtx, input: CommandInput<T>): Promise<AdaptiveResult<T>> {
  const userId = await requireAdaptiveMutationAccess(ctx)
  const prepared = await prepareAdaptiveCommand({
    userId, commandName: input.commandName, targetId: String(input.threadId), expectedRevision: input.expectedRevision,
    idempotencyKey: input.idempotencyKey, payload: input.payload,
  })
  const thread = await ctx.db.get(input.threadId)
  if (!thread || thread.userId !== userId) throw new Error('Thread not found')
  if (thread.deletionStartedAt !== undefined) throw new Error('Thread deletion is in progress')
  const prior = await ctx.db.query('learnActivityCommandReceipts')
    .withIndex('by_userId_and_idempotencyKeyHash', q => q.eq('userId', userId).eq('idempotencyKeyHash', prepared.idempotencyKeyHash))
    .unique()
  if (prior) {
    if (prior.requestFingerprint !== prepared.requestFingerprint) return { kind: 'conflict', code: 'duplicate_key', expectedRevision: input.expectedRevision, actualRevision: prior.targetRevision, authority: 'convex' }
    if (prior.resultRedactedAt !== undefined || prior.resultReference === null) return { kind: 'invalid', code: 'result_expired', message: 'The original command result has expired', retryable: false }
    return JSON.parse(prior.resultReference) as AdaptiveResult<T>
  }
  const now = Date.now()
  const persistConflict = async (code: 'stale_revision' | 'activity_boundary_changed', actualRevision: number): Promise<AdaptiveResult<T>> => {
    const receiptId = await ctx.db.insert('learnActivityCommandReceipts', {
      userId, threadId: thread._id, idempotencyKeyHash: prepared.idempotencyKeyHash,
      requestFingerprint: prepared.requestFingerprint, commandName: input.commandName,
      targetRevision: input.expectedRevision, resultKind: 'conflict', resultReference: null,
      errorReference: boundedReference({ code, actualRevision }),
      createdAt: now, resultExpiresAt: now + RECEIPT_DETAIL_TTL_MS, redactionStatus: 'pending',
    })
    const result = { kind: 'conflict' as const, code, expectedRevision: input.expectedRevision, actualRevision, authority: 'convex' as const }
    await ctx.db.patch(receiptId, { resultReference: boundedReference(result) })
    return result
  }
  if (thread.revision !== input.expectedRevision) return await persistConflict('stale_revision', thread.revision)

  let committed: { value: T, revision: number }
  try {
    committed = await input.apply(ctx, thread, userId)
  }
  catch (error) {
    if (error instanceof AdaptiveCommandConflict) return await persistConflict(error.code, error.actualRevision)
    throw error
  }
  const authoritativeThread = await ctx.db.get(thread._id)
  if (!authoritativeThread || authoritativeThread.userId !== userId || committed.revision <= input.expectedRevision || authoritativeThread.revision !== committed.revision) {
    throw new Error('Adaptive command reported a non-authoritative revision')
  }
  const receiptId = await ctx.db.insert('learnActivityCommandReceipts', {
    userId, threadId: thread._id, idempotencyKeyHash: prepared.idempotencyKeyHash,
    requestFingerprint: prepared.requestFingerprint, commandName: input.commandName,
    targetRevision: input.expectedRevision, resultKind: 'ok', resultReference: null,
    errorReference: null, createdAt: now, resultExpiresAt: now + RECEIPT_DETAIL_TTL_MS, redactionStatus: 'pending',
  })
  const result = { kind: 'ok' as const, value: committed.value, revision: committed.revision, receiptId: String(receiptId) }
  await ctx.db.patch(receiptId, { resultReference: boundedReference(result) })
  return result
}

export const redactExpiredReceiptResults = internalMutation({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const expired = await ctx.db.query('learnActivityCommandReceipts')
      .withIndex('by_redactionStatus_and_resultExpiresAt', q => q.eq('redactionStatus', 'pending').lte('resultExpiresAt', args.now))
      .take(32)
    let redacted = 0
    for (const receipt of expired) {
      await ctx.db.patch(receipt._id, { resultReference: null, errorReference: null, resultRedactedAt: args.now, redactionStatus: 'redacted' })
      redacted++
    }
    return { scanned: expired.length, redacted }
  },
})

export async function deleteAdaptiveThreadAuthorityBatch(ctx: MutationCtx, userId: string, threadId: Id<'learningThreads'>) {
  const thread = await ctx.db.get(threadId)
  if (!thread || thread.userId !== userId) throw new Error('Thread not found')
  if (thread.deletionStartedAt === undefined) {
    await ctx.db.patch(threadId, { deletionStartedAt: Date.now() })
    return { phase: 'marked' as const, deleted: 0, done: false }
  }
  const activities = await ctx.db.query('learningThreadActivities').withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', userId).eq('threadId', threadId)).take(8)
  if (activities.length > 0) {
    for (const activity of activities) await ctx.db.delete(activity._id)
    return { phase: 'activities' as const, deleted: activities.length, done: false }
  }
  const receipts = await ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId_and_threadId', q => q.eq('userId', userId).eq('threadId', threadId)).take(8)
  if (receipts.length > 0) {
    for (const receipt of receipts) await ctx.db.delete(receipt._id)
    return { phase: 'receipts' as const, deleted: receipts.length, done: false }
  }
  await ctx.db.delete(threadId)
  return { phase: 'thread' as const, deleted: 1, done: true }
}

export const deleteThreadAuthorityRows = internalMutation({
  args: { threadId: v.id('learningThreads') },
  handler: async (ctx, args) => {
    // Maintenance derives ownership from base auth but deliberately bypasses
    // rollout entitlements so rollback cannot strand a marked thread.
    const userId = await requireAuth(ctx)
    return await deleteAdaptiveThreadAuthorityBatch(ctx, userId, args.threadId)
  },
})
