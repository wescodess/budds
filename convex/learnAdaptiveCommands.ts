import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalMutation, type MutationCtx } from './_generated/server'
import { prepareAdaptiveCommand } from '../shared/adaptive-command-authority'
import { requireAdaptiveMutationAccess } from './lib/adaptiveLearnAccess'

const RECEIPT_DETAIL_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_RESULT_REFERENCE_CHARS = 4_096
const THREAD_DELETION_BATCH_SIZE = 8
const THREAD_DELETION_MAX_ATTEMPTS = 3
const THREAD_DELETION_RETRY_DELAYS_MS = [1_000, 5_000] as const

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
  const prior = await ctx.db.query('learnActivityCommandReceipts')
    .withIndex('by_userId_and_idempotencyKeyHash', q => q.eq('userId', userId).eq('idempotencyKeyHash', prepared.idempotencyKeyHash))
    .unique()
  if (prior) {
    if (prior.requestFingerprint !== prepared.requestFingerprint) return { kind: 'conflict', code: 'duplicate_key', expectedRevision: input.expectedRevision, actualRevision: prior.targetRevision, authority: 'convex' }
    if (prior.resultRedactedAt !== undefined || prior.resultReference === null) return { kind: 'invalid', code: 'result_expired', message: 'The original command result has expired', retryable: false }
    return JSON.parse(prior.resultReference) as AdaptiveResult<T>
  }
  const thread = await ctx.db.get(input.threadId)
  if (!thread || thread.userId !== userId) throw new Error('Thread not found')
  if (thread.deletionStartedAt !== undefined) throw new Error('Thread deletion is in progress')
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

export async function deleteAdaptiveThreadAuthorityBatch(ctx: MutationCtx, job: Doc<'learnAdaptiveThreadDeletionJobs'>) {
  const { userId, threadId } = job
  const thread = await ctx.db.get(threadId)
  if (thread && thread.userId !== userId) throw new Error('Thread deletion authority mismatch')

  if (thread) {
    if (thread.deletionStartedAt === undefined) await ctx.db.patch(threadId, { deletionStartedAt: Date.now() })
    const activities = await ctx.db.query('learningThreadActivities').withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', userId).eq('threadId', threadId)).take(THREAD_DELETION_BATCH_SIZE)
    if (activities.length > 0) {
      for (const activity of activities) await ctx.db.delete(activity._id)
      await ctx.db.patch(job._id, { phase: 'children', updatedAt: Date.now() })
      return { phase: 'activities' as const, deleted: activities.length, done: false, jobId: job._id }
    }

    // Parent ownership and the first bounded receipt batch end atomically.
    const firstReceipts = await ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId_and_threadId', q => q.eq('userId', userId).eq('threadId', threadId)).take(THREAD_DELETION_BATCH_SIZE)
    await ctx.db.delete(threadId)
    for (const receipt of firstReceipts) await ctx.db.delete(receipt._id)
    const remaining = await ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId_and_threadId', q => q.eq('userId', userId).eq('threadId', threadId)).first()
    if (remaining) {
      await ctx.db.patch(job._id, { phase: 'receipts', updatedAt: Date.now() })
      return { phase: 'parent_and_receipts' as const, deleted: firstReceipts.length + 1, done: false, jobId: job._id }
    }
    await ctx.db.delete(job._id)
    return { phase: 'parent_and_receipts' as const, deleted: firstReceipts.length + 1, done: true, jobId: job._id }
  }

  const receipts = await ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId_and_threadId', q => q.eq('userId', userId).eq('threadId', threadId)).take(THREAD_DELETION_BATCH_SIZE)
  for (const receipt of receipts) await ctx.db.delete(receipt._id)
  const remaining = await ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId_and_threadId', q => q.eq('userId', userId).eq('threadId', threadId)).first()
  if (remaining) {
    await ctx.db.patch(job._id, { phase: 'receipts', updatedAt: Date.now() })
    return { phase: 'receipts' as const, deleted: receipts.length, done: false, jobId: job._id }
  }
  await ctx.db.delete(job._id)
  return { phase: 'receipts' as const, deleted: receipts.length, done: true, jobId: job._id }
}

export async function initiateAdaptiveThreadDeletion(ctx: MutationCtx, userId: string, threadId: Id<'learningThreads'>) {
  const existing = await ctx.db.query('learnAdaptiveThreadDeletionJobs')
    .withIndex('by_userId_and_threadId', q => q.eq('userId', userId).eq('threadId', threadId))
    .unique()
  if (existing) return { jobId: existing._id, status: existing.status }

  const thread = await ctx.db.get(threadId)
  if (!thread || thread.userId !== userId) throw new Error('Thread not found')
  const now = Date.now()
  const jobId = await ctx.db.insert('learnAdaptiveThreadDeletionJobs', {
    userId, threadId: thread._id, phase: 'children', status: 'queued', attempts: 0, createdAt: now, updatedAt: now,
  })
  await ctx.db.patch(thread._id, { deletionStartedAt: now })
  await ctx.scheduler.runAfter(0, internal.learnAdaptiveCommands.runThreadDeletionJob, { jobId })
  return { jobId, status: 'queued' as const }
}

export const runThreadDeletionJob = internalMutation({
  args: { jobId: v.id('learnAdaptiveThreadDeletionJobs') },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job) return { state: 'complete' as const }
    if (job.status === 'failed') return { state: 'failed' as const, attempts: job.attempts }

    try {
      await ctx.db.patch(job._id, { status: 'running', updatedAt: Date.now() })
      const result = await deleteAdaptiveThreadAuthorityBatch(ctx, job)
      const remainingJob = await ctx.db.get(job._id)
      if (!remainingJob || result.done) return { state: 'complete' as const }

      await ctx.db.patch(job._id, { status: 'queued', attempts: 0, terminalReason: undefined, updatedAt: Date.now() })
      await ctx.scheduler.runAfter(0, internal.learnAdaptiveCommands.runThreadDeletionJob, { jobId: job._id })
      return { state: 'queued' as const, phase: result.phase }
    }
    catch (error) {
      const attempts = job.attempts + 1
      const terminalReason = error instanceof Error && error.message === 'Thread deletion authority mismatch'
        ? 'authority_mismatch' as const
        : 'batch_failed' as const
      if (attempts >= THREAD_DELETION_MAX_ATTEMPTS) {
        await ctx.db.patch(job._id, { status: 'failed', attempts, terminalReason, updatedAt: Date.now() })
        return { state: 'failed' as const, attempts, terminalReason }
      }
      const retryAfterMs = THREAD_DELETION_RETRY_DELAYS_MS[attempts - 1] ?? THREAD_DELETION_RETRY_DELAYS_MS.at(-1)!
      await ctx.db.patch(job._id, { status: 'retrying', attempts, terminalReason, updatedAt: Date.now() })
      await ctx.scheduler.runAfter(retryAfterMs, internal.learnAdaptiveCommands.runThreadDeletionJob, { jobId: job._id })
      return { state: 'retrying' as const, attempts, retryAfterMs }
    }
  },
})
