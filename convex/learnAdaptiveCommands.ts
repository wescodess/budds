import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { internalMutation, type MutationCtx } from './_generated/server'
import { prepareAdaptiveCommand } from '../shared/adaptive-command-authority'
import { requireAdaptiveMutationAccess } from './lib/adaptiveLearnAccess'

const RECEIPT_DETAIL_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_RESULT_REFERENCE_CHARS = 4_096

export type AdaptiveCommandResult<T> =
  | { kind: 'ok', value: T, revision: number, receiptId: string }
  | { kind: 'conflict', code: 'stale_revision' | 'duplicate_key', expectedRevision: number, actualRevision: number, authority: 'convex', receiptId?: string }
  | { kind: 'invalid', code: 'result_expired', message: string, retryable: false, receiptId: string }

type CommandInput<T> = {
  threadId: Id<'learningThreads'>
  expectedRevision: number
  idempotencyKey: string
  commandName: string
  payload: Record<string, unknown>
  apply: (ctx: MutationCtx, thread: Doc<'learningThreads'>, userId: string) => Promise<{ value: T, revision: number }>
}

function boundedReference(value: unknown): string {
  const encoded = JSON.stringify(value)
  if (encoded.length > MAX_RESULT_REFERENCE_CHARS) throw new Error('Adaptive command result exceeds receipt bounds')
  return encoded
}

export async function executeAdaptiveThreadCommand<T>(ctx: MutationCtx, input: CommandInput<T>): Promise<AdaptiveCommandResult<T>> {
  const userId = await requireAdaptiveMutationAccess(ctx)
  const prepared = await prepareAdaptiveCommand({
    userId, commandName: input.commandName, targetId: String(input.threadId), expectedRevision: input.expectedRevision,
    idempotencyKey: input.idempotencyKey, payload: input.payload,
  })
  const prior = await ctx.db.query('learnActivityCommandReceipts')
    .withIndex('by_userId_and_idempotencyKeyHash', q => q.eq('userId', userId).eq('idempotencyKeyHash', prepared.idempotencyKeyHash))
    .unique()
  if (prior) {
    if (prior.requestFingerprint !== prepared.requestFingerprint) return { kind: 'conflict', code: 'duplicate_key', expectedRevision: input.expectedRevision, actualRevision: prior.targetRevision, authority: 'convex' }
    if (prior.resultRedactedAt !== undefined || prior.resultReference === null) return { kind: 'invalid', code: 'result_expired', message: 'The original command result has expired', retryable: false, receiptId: String(prior._id) }
    return JSON.parse(prior.resultReference) as AdaptiveCommandResult<T>
  }

  const thread = await ctx.db.get(input.threadId)
  if (!thread || thread.userId !== userId) throw new Error('Thread not found')
  const now = Date.now()
  if (thread.revision !== input.expectedRevision) {
    const receiptId = await ctx.db.insert('learnActivityCommandReceipts', {
      userId, threadId: thread._id, idempotencyKeyHash: prepared.idempotencyKeyHash,
      requestFingerprint: prepared.requestFingerprint, commandName: input.commandName,
      targetRevision: input.expectedRevision, resultKind: 'conflict', resultReference: null,
      errorReference: boundedReference({ code: 'stale_revision', actualRevision: thread.revision }),
      createdAt: now, resultExpiresAt: now + RECEIPT_DETAIL_TTL_MS,
    })
    const result = { kind: 'conflict' as const, code: 'stale_revision' as const, expectedRevision: input.expectedRevision, actualRevision: thread.revision, authority: 'convex' as const, receiptId: String(receiptId) }
    await ctx.db.patch(receiptId, { resultReference: boundedReference(result) })
    return result
  }

  const committed = await input.apply(ctx, thread, userId)
  const receiptId = await ctx.db.insert('learnActivityCommandReceipts', {
    userId, threadId: thread._id, idempotencyKeyHash: prepared.idempotencyKeyHash,
    requestFingerprint: prepared.requestFingerprint, commandName: input.commandName,
    targetRevision: input.expectedRevision, resultKind: 'ok', resultReference: null,
    errorReference: null, createdAt: now, resultExpiresAt: now + RECEIPT_DETAIL_TTL_MS,
  })
  const result = { kind: 'ok' as const, value: committed.value, revision: committed.revision, receiptId: String(receiptId) }
  await ctx.db.patch(receiptId, { resultReference: boundedReference(result) })
  return result
}

export const redactExpiredReceiptResults = internalMutation({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const expired = await ctx.db.query('learnActivityCommandReceipts')
      .withIndex('by_resultExpiresAt', q => q.lte('resultExpiresAt', args.now))
      .take(32)
    let redacted = 0
    for (const receipt of expired) {
      if (receipt.resultRedactedAt !== undefined) continue
      await ctx.db.patch(receipt._id, { resultReference: null, errorReference: null, resultRedactedAt: args.now })
      redacted++
    }
    return { scanned: expired.length, redacted }
  },
})
