import { v } from 'convex/values'
import { mutation, query, type MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireAdaptiveQueryAccess } from './lib/adaptiveLearnAccess'
import { executeAdaptiveThreadCommand } from './learnAdaptiveCommands'
import {
  CLARIFICATION_TEMPLATE_VERSION,
  INITIAL_DECISION_VERSION,
  digestInitialDecisionInput,
  renderClarification,
  selectInitialDecision,
  validateClarificationAnswer,
  type InitialDecisionInput,
} from '../shared/learn-adaptive-clarification'

type StoredInitialDecision = NonNullable<Doc<'learningThreads'>['initialDecision']>

function projectDecision(decision: StoredInitialDecision) {
  return {
    decisionVersion: decision.decisionVersion,
    status: decision.status,
    reasonCode: decision.reasonCode,
    continuationKind: decision.continuationKind,
    ...(decision.questionKey ? { question: { key: decision.questionKey, ...renderClarification(decision.questionKey, decision.templateVersion) } } : {}),
  }
}

function legacyOutcomeProvenance(thread: Doc<'learningThreads'>): InitialDecisionInput['outcomeProvenance'] {
  if (thread.outcomeProvenance) return thread.outcomeProvenance
  return (thread.outcome ?? thread.originalNeed) === thread.originalNeed ? 'need_fallback' : 'explicit'
}

function decisionInput(thread: Doc<'learningThreads'>): InitialDecisionInput {
  return {
    intent: thread.intent,
    availableTime: thread.availableTime,
    authorityKind: thread.authorityKind,
    sourceKind: thread.sourceScope.kind,
    evidenceState: thread.evidenceState,
    outcomeProvenance: legacyOutcomeProvenance(thread),
    threadRevision: thread.revision,
  }
}

async function requireLiveSourceAnchor(ctx: MutationCtx, thread: Doc<'learningThreads'>, userId: string) {
  if (thread.sourceScope.kind === 'folder') {
    const folder = await ctx.db.get(thread.sourceScope.sourceId as Id<'folders'>)
    if (!folder || folder.userId !== userId) throw new Error('Selected source is unavailable')
  }
  if (thread.sourceScope.kind === 'document') {
    const document = await ctx.db.get(thread.sourceScope.sourceId as Id<'documents'>)
    if (!document || document.userId !== userId) throw new Error('Selected source is unavailable')
    const folder = await ctx.db.get(document.folderId)
    if (!folder || folder.userId !== userId) throw new Error('Selected source is unavailable')
  }
}

function assertPreparatoryLifecycle(thread: Doc<'learningThreads'>) {
  if (thread.lifecycle === 'active' || thread.lifecycle === 'paused' || thread.lifecycle === 'ended' || thread.lifecycle === 'rollback') {
    throw new Error('Thread cannot be prepared in its current lifecycle')
  }
}

async function assertBeforeFirstMove(ctx: MutationCtx, thread: Doc<'learningThreads'>) {
  if (thread.currentActivityId) throw new Error('Initial clarification is unavailable after the first activity')
  const activity = await ctx.db.query('learningThreadActivities')
    .withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', thread.userId).eq('threadId', thread._id))
    .first()
  if (activity) throw new Error('Initial clarification is unavailable after the first activity')
}

export const prepareInitialDecision = mutation({
  args: { threadId: v.id('learningThreads'), expectedRevision: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => await executeAdaptiveThreadCommand(ctx, {
    ...args,
    commandName: 'prepareInitialDecision',
    payload: {},
    apply: async (commandCtx, thread, userId) => {
      assertPreparatoryLifecycle(thread)
      await assertBeforeFirstMove(commandCtx, thread)
      if (thread.initialDecision) throw new Error('Initial decision is already prepared')
      await requireLiveSourceAnchor(commandCtx, thread, userId)
      const inputSnapshot = decisionInput(thread)
      const selected = selectInitialDecision(inputSnapshot)
      const now = Date.now()
      const initialDecision: StoredInitialDecision = {
        decisionVersion: INITIAL_DECISION_VERSION,
        templateVersion: CLARIFICATION_TEMPLATE_VERSION,
        inputDigest: await digestInitialDecisionInput(inputSnapshot),
        inputSnapshot,
        status: selected.kind === 'clarification' ? 'pending' : 'not_required',
        reasonCode: selected.reasonCode,
        continuationKind: selected.continuationKind,
        ...(selected.questionKey ? { questionKey: selected.questionKey } : {}),
        preparedAt: now,
      }
      const revision = thread.revision + 1
      await commandCtx.db.patch(thread._id, { initialDecision, revision, updatedAt: now })
      return { value: projectDecision(initialDecision), revision }
    },
  }),
})

const clarificationResolutionValidator = v.union(
  v.object({ kind: v.literal('answer'), answer: v.string() }),
  v.object({ kind: v.literal('skip') }),
)

export const resolveClarification = mutation({
  args: { threadId: v.id('learningThreads'), expectedRevision: v.number(), idempotencyKey: v.string(), resolution: clarificationResolutionValidator },
  handler: async (ctx, args) => await executeAdaptiveThreadCommand(ctx, {
    threadId: args.threadId,
    expectedRevision: args.expectedRevision,
    idempotencyKey: args.idempotencyKey,
    commandName: 'resolveClarification',
    payload: { resolution: args.resolution },
    apply: async (commandCtx, thread) => {
      assertPreparatoryLifecycle(thread)
      await assertBeforeFirstMove(commandCtx, thread)
      const current = thread.initialDecision
      if (!current || current.status !== 'pending' || current.questionKey !== 'useful_outcome') throw new Error('No pending clarification is available')
      const now = Date.now()
      const answer = args.resolution.kind === 'answer' ? validateClarificationAnswer(args.resolution.answer) : undefined
      const initialDecision: StoredInitialDecision = {
        ...current,
        status: answer === undefined ? 'skipped' : 'answered',
        ...(answer === undefined ? {} : { answer }),
        resolvedAt: now,
      }
      const revision = thread.revision + 1
      await commandCtx.db.patch(thread._id, {
        initialDecision,
        ...(answer === undefined ? {} : { outcome: answer, outcomeProvenance: 'clarification' as const }),
        revision,
        updatedAt: now,
      })
      return { value: projectDecision(initialDecision), revision }
    },
  }),
})

export const getInitialDecision = query({
  args: { threadId: v.id('learningThreads') },
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveQueryAccess(ctx)
    const thread = await ctx.db.get(args.threadId)
    if (!thread || thread.userId !== userId || !thread.initialDecision) return null
    return {
      ...projectDecision(thread.initialDecision),
      originalNeed: thread.originalNeed,
      outcome: thread.outcome ?? thread.originalNeed,
      revision: thread.revision,
    }
  },
})
