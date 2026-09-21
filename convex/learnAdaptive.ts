import { v } from 'convex/values'
import { action, mutation } from './_generated/server'
import { initiateAdaptiveThreadDeletion } from './learnAdaptiveCommands'
import { requireAuth } from './lib/auth'
import { masteryAttemptArgs, submitMasteryAttemptForOwner } from './learnV2Mastery'

// Data-lifecycle exception: this ownership-scoped maintenance request uses
// base authentication and remains available when Adaptive Learn is disabled.
// It is not an adaptive domain command: expectedRevision, idempotencyKey, and
// AdaptiveResult do not apply. The durable owner+thread job is the idempotency
// authority for initiation; its internal worker owns bounded continuation.
export const requestThreadDeletion = mutation({
  args: { threadId: v.id('learningThreads') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    return await initiateAdaptiveThreadDeletion(ctx, userId, args.threadId)
  },
})

// The adaptive public boundary is intentionally only a thin authority wrapper.
// All job, quota, provider, attempt, feedback, and mastery work remains owned by
// the exact V2 submitMasteryAttempt orchestration helper.
export const submitResponse = action({
  args: { threadId: v.id('learningThreads'), activityId: v.string(), ...masteryAttemptArgs },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return { kind: 'denied' as const, code: 'adaptive_gate_unavailable', message: 'Adaptive Learn is unavailable.', retryable: false }
    const { threadId, activityId, ...attempt } = args
    const result = await submitMasteryAttemptForOwner(ctx, identity.tokenIdentifier, attempt, {
      threadId,
      activityId,
      manifestVersion: process.env.LEARN_ADAPTIVE_V2_PILOT_MANIFEST?.trim() ?? '',
    })
    if (result.status === 'completed') return {
      kind: 'ok' as const,
      value: result,
      revision: attempt.expectedSessionRevision + (result.replayed ? 0 : 1),
      receiptId: String(result.attemptId),
    }
    if (result.status === 'in_progress') return { kind: 'blocked' as const, code: 'scoring_in_progress', message: 'Scoring is already in progress.', retryable: true }
    return { kind: result.status, code: result.code, message: result.message, retryable: result.retryable }
  },
})
