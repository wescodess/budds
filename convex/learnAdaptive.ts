import { v } from 'convex/values'
import { action, mutation, query } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { executeAdaptiveThreadCommand, initiateAdaptiveThreadDeletion } from './learnAdaptiveCommands'
import { requireAdaptiveQueryAccess } from './lib/adaptiveLearnAccess'
import { liveEvidenceState } from './learnAdaptiveRecovery'
import { loadReadyCanvas } from './learnAdaptiveCanvas'
import { requireAuth } from './lib/auth'
import { masteryAttemptArgs, submitMasteryAttemptForOwner, type MasteryAttemptActionResult } from './learnV2Mastery'
import { needFirstDraftArgsValidator } from '../shared/learn-adaptive-draft'

export const setIntent = mutation({
  args: { threadId: v.id('learningThreads'), intent: needFirstDraftArgsValidator.intent, expectedRevision: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => await executeAdaptiveThreadCommand(ctx, {
    threadId: args.threadId,
    expectedRevision: args.expectedRevision,
    idempotencyKey: args.idempotencyKey,
    commandName: 'setIntent',
    payload: { intent: args.intent },
    allowNoop: true,
    apply: async (commandCtx, thread) => {
      if (thread.lifecycle === 'ended' || thread.lifecycle === 'rollback') throw new Error('Thread intent cannot be changed in its current lifecycle')
      if (thread.intent === args.intent) return { value: { intent: thread.intent }, revision: thread.revision }
      const revision = thread.revision + 1
      await commandCtx.db.patch(thread._id, { intent: args.intent, revision, updatedAt: Date.now() })
      return { value: { intent: args.intent }, revision }
    },
  }),
})

const HISTORY_LIMIT = 8

function nextThreadAction(thread: Doc<'learningThreads'>, activity: Doc<'learningThreadActivities'> | null, factualCanvas: Awaited<ReturnType<typeof loadReadyCanvas>>, sourceEvidenceState: Awaited<ReturnType<typeof liveEvidenceState>>) {
  if (thread.lifecycle === 'ended' || thread.lifecycle === 'rollback') return {
    kind: 'return_to_learn', label: 'Back to Learn', reasonCode: 'thread_unavailable', activityId: null,
  }
  if (thread.lifecycle === 'blocked' || thread.lifecycle === 'paused') return {
    kind: 'recover', label: 'Back to Learn', reasonCode: `thread_${thread.lifecycle}`, activityId: activity?.activityId ?? null,
  }
  if (activity?.activityClass === 'factual' && (sourceEvidenceState !== 'ready' || !factualCanvas || factualCanvas.status === 'blocked')) return {
    kind: 'recover', label: 'Review your learning mission', reasonCode: sourceEvidenceState !== 'ready' ? `source_${sourceEvidenceState}` : factualCanvas ? 'canvas_blocked' : 'canvas_unavailable', activityId: activity.activityId,
  }
  if (activity) {
    if (activity.status === 'eligible' || activity.status === 'started') return {
      kind: activity.requiredAction.kind, label: activity.requiredAction.label,
      reasonCode: activity.reasonCode, activityId: activity.activityId,
    }
    if (activity.activityClass === 'non_factual' && activity.status === 'submitted') return {
      kind: 'review_saved_response', label: 'Your response is saved', reasonCode: 'diagnostic_response_saved', activityId: activity.activityId,
    }
    if (activity.status === 'submitted' || activity.status === 'scoring' || activity.status === 'reconciling') return {
      kind: 'wait', label: 'Your response is being checked', reasonCode: `activity_${activity.status}`, activityId: activity.activityId,
    }
    if (activity.status === 'feedback') return {
      kind: 'review_feedback', label: 'Review your feedback', reasonCode: 'activity_feedback', activityId: activity.activityId,
    }
    return { kind: 'recover', label: 'Back to Learn', reasonCode: `activity_${activity.status}`, activityId: activity.activityId }
  }
  if (!thread.initialDecision || thread.initialDecision.status === 'pending') return {
    kind: 'clarify', label: 'Continue on Learn', reasonCode: 'clarification_pending', activityId: null,
  }
  if (thread.authorityKind === 'standalone') return {
    kind: 'continue', label: 'Start diagnostic', reasonCode: 'diagnostic_ready', activityId: null,
  }
  return { kind: 'continue', label: 'Start learning', reasonCode: 'thread_ready_for_first_move', activityId: null }
}

export const getThread = query({
  args: { threadId: v.id('learningThreads') },
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveQueryAccess(ctx)
    const thread = await ctx.db.get(args.threadId)
    if (!thread || thread.userId !== userId || thread.deletionStartedAt !== undefined) return null
    const owner = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique()
    if (!owner) return null
    const activity = thread.currentActivityId ? await ctx.db.get(thread.currentActivityId) : null
    if (activity && (activity.userId !== userId || activity.threadId !== thread._id)) return null
    const sourceEvidenceState = await liveEvidenceState(ctx, thread)
    const factualCanvas = activity?.activityClass === 'factual' ? await loadReadyCanvas(ctx, userId, thread._id) : null
    const evidenceState = activity?.activityClass === 'factual'
      ? sourceEvidenceState !== 'ready' ? sourceEvidenceState
        : factualCanvas?.status === 'blocked' ? factualCanvas.recoveryState ?? 'blocked'
          : factualCanvas ? 'ready' : 'unavailable'
      : sourceEvidenceState
    const recent = await ctx.db.query('learningThreadActivities')
      .withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', userId).eq('threadId', thread._id))
      .order('desc').take(HISTORY_LIMIT + 1)
    return {
      ownerId: owner._id,
      thread: {
        id: thread._id, outcome: thread.outcome ?? thread.originalNeed, intent: thread.intent,
        sourceScope: thread.sourceScope, evidenceState, lifecycle: thread.lifecycle, revision: thread.revision,
        authorityKind: thread.authorityKind, learningVoidId: thread.learningVoidId ?? null,
      },
      currentActivity: activity ? {
        id: activity.activityId, status: activity.status, activityClass: activity.activityClass,
        purpose: activity.purpose, reasonCode: activity.reasonCode, boundaryOrdinal: activity.boundaryOrdinal,
      } : null,
      history: recent.filter(row => row._id !== thread.currentActivityId).slice(0, HISTORY_LIMIT).map(row => ({
        id: row.activityId, status: row.status, activityClass: row.activityClass,
        purpose: row.purpose, reasonCode: row.reasonCode, boundaryOrdinal: row.boundaryOrdinal,
        updatedAt: row.updatedAt,
      })),
      nextAction: nextThreadAction(thread, activity, factualCanvas, sourceEvidenceState),
    }
  },
})

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
