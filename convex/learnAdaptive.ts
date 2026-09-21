import { v } from 'convex/values'
import { action, mutation } from './_generated/server'
import { initiateAdaptiveThreadDeletion } from './learnAdaptiveCommands'
import { requireAuth } from './lib/auth'
import { masteryAttemptArgs, submitMasteryAttemptForOwner, type MasteryAttemptActionResult } from './learnV2Mastery'

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

export function toAdaptiveSubmissionAdmission(result: MasteryAttemptActionResult) {
  if (result.status === 'completed') return {
    kind: 'accepted' as const,
    status: 'completed' as const,
    attemptReference: String(result.attemptId),
    replayed: result.replayed,
  }
  if (result.status === 'in_progress') return { kind: 'accepted' as const, status: 'in_progress' as const, replayed: false as const }
  return { kind: result.status, code: result.code, message: result.message, retryable: result.retryable }
}

// The adaptive public boundary is intentionally only a thin authority wrapper.
// All job, quota, provider, attempt, feedback, and mastery work remains owned by
// the exact V2 submitMasteryAttempt orchestration helper. Story 1.7 owns the
// adaptive command receipt/revision and feedback projection; Slice 1.6 returns
// only bounded admission status and an opaque completed-attempt reference.
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
    return toAdaptiveSubmissionAdmission(result)
  },
})
