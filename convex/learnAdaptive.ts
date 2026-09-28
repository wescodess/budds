import { v } from 'convex/values'
import { api } from './_generated/api'
import { action, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { AdaptiveCommandRejection, executeAdaptiveThreadCommand, initiateAdaptiveThreadDeletion } from './learnAdaptiveCommands'
import { requireAdaptiveQueryAccess } from './lib/adaptiveLearnAccess'
import { isOperableDiagnosticActivity, liveEvidenceState, storedPlan } from './learnAdaptiveRecovery'
import { replayAdaptiveActivityPlan } from '../shared/learn-adaptive-activity-plan'
import { loadReadyCanvas } from './learnAdaptiveCanvas'
import { requireAuth } from './lib/auth'
import { masteryAttemptArgs, submitMasteryAttemptForOwner, type MasteryAttemptActionResult } from './learnV2Mastery'
import { needFirstDraftArgsValidator } from '../shared/learn-adaptive-draft'
import { ADAPTIVE_OVERRIDE_VERSION, adaptiveOverrideOptionValidator, fixedNextPlanForOverride, projectAdaptiveControls, reasonTextForActivity } from '../shared/learn-adaptive-controls'
import { ADAPTIVE_REPRESENTATIVE_COMPLETION_VERSION, representativeNextAction } from '../shared/learn-adaptive-completion'
import { LEARN_V2_MASTERY_THRESHOLD } from '../shared/learn-v2-mastery'
import { learnActivityEventDedupeHash, writeLearnActivityEvent } from './lib/learnAdaptiveEvents'
import { adaptiveArtifactKindValidator, adaptiveArtifactStatusValidator, boundedArtifactText } from '../shared/learn-adaptive-artifact'
import { queueAdaptiveArtifactDeletion } from './lib/learnAdaptiveArtifacts'
import { prepareAdaptiveCommand } from '../shared/adaptive-command-authority'

const memoryPreferenceKeyValidator = v.union(v.literal('representation'), v.literal('pace'), v.literal('practice_style'))
const memoryPreferenceOperationValidator = v.union(v.literal('set'), v.literal('disable'), v.literal('clear'))
const MEMORY_HISTORY_LIMIT = 8
type MemoryProjection = {
  threadRevision: number
  lifecycle: Doc<'learningThreads'>['lifecycle']
  unresolvedPoint: string | null
  nextAction: { label: string } | null
  evidenceState: string
  preferences: { key: Doc<'learningThreadPreferences'>['key'], value: string | null, state: 'active' | 'disabled', revision: number }[]
  artifacts: { id: Id<'learningThreadArtifacts'>, kind: Doc<'learningThreadArtifacts'>['artifactKind'], title: string,
    summary: string, status: Doc<'learningThreadArtifacts'>['status'], revision: number, updatedAt: number,
    historical: boolean, readOnly: boolean, evidenceLabel: 'evidence_unavailable' | null }[]
  history: { activityId: string, purpose: string, status: Doc<'learningThreadActivities'>['status'],
    activityClass: Doc<'learningThreadActivities'>['activityClass'], updatedAt: number, readOnly: true,
    evidenceStatus: 'ready' | 'unavailable' | 'not_required',
    attempt: { id: Id<'masteryAttempts'>, scorePercent: number, masteryStateAfter: Doc<'masteryRecords'>['state'] | null } | null }[]
}

export const getMemory = query({
  args: { threadId: v.id('learningThreads') },
  handler: async (ctx, args): Promise<MemoryProjection | null> => {
    const userId = await requireAdaptiveQueryAccess(ctx)
    const thread = await ctx.db.get(args.threadId)
    if (!thread || thread.userId !== userId || thread.deletionStartedAt !== undefined) return null
    const [preferences, artifacts, recent] = await Promise.all([
      ctx.db.query('learningThreadPreferences')
        .withIndex('by_userId_and_threadId_and_key', q => q.eq('userId', userId).eq('threadId', thread._id)).take(3),
      ctx.runQuery(api.learnAdaptive.listThreadArtifacts, { threadId: thread._id }),
      ctx.db.query('learningThreadActivities')
        .withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', userId).eq('threadId', thread._id))
        .order('desc').take(MEMORY_HISTORY_LIMIT),
    ])
    const history = await Promise.all(recent.filter(row => row._id !== thread.currentActivityId).map(async row => {
      const evidenceStatus = row.activityClass === 'non_factual' ? 'not_required' as const
        : row.evidenceReferences.length === 0 || await artifactEvidenceUnavailable(ctx, thread, row)
            ? 'unavailable' as const : 'ready' as const
      const completion = await representativeCompletion(ctx, userId, row)
      const storedAttempt = completion && row.masteryAttemptId ? await ctx.db.get(row.masteryAttemptId) : null
      const attempt = storedAttempt && storedAttempt.userId === userId && storedAttempt.objectiveId === row.objectiveId
        && typeof storedAttempt.serverScorePercent === 'number' && Number.isFinite(storedAttempt.serverScorePercent)
        ? { id: storedAttempt._id, scorePercent: storedAttempt.serverScorePercent,
            masteryStateAfter: storedAttempt.masteryStateAfter ?? null } : null
      return { activityId: row.activityId, purpose: row.purpose, status: row.status,
        activityClass: row.activityClass, updatedAt: row.updatedAt, readOnly: true as const,
        evidenceStatus, attempt }
    }))
    const continuation: { nextAction: { label: string } | null } | null = await ctx.runQuery(api.learnAdaptive.getThread, { threadId: thread._id })
    return {
      threadRevision: thread.revision,
      lifecycle: thread.lifecycle,
      unresolvedPoint: thread.unresolvedPoint?.slice(0, 240) ?? null,
      nextAction: continuation?.nextAction ?? null,
      evidenceState: await liveEvidenceState(ctx, thread),
      preferences: preferences.map(row => ({ key: row.key, value: row.value, state: row.state, revision: row.revision })),
      artifacts: artifacts.map(row => ({ id: row.id, kind: row.artifactKind, title: row.title, summary: row.summary,
        status: row.status, revision: row.revision, updatedAt: row.updatedAt,
        historical: row.historical, readOnly: row.readOnly, evidenceLabel: row.evidenceLabel })),
      history,
    }
  },
})

export const setMemoryPreference = mutation({
  args: { threadId: v.id('learningThreads'), key: memoryPreferenceKeyValidator,
    operation: memoryPreferenceOperationValidator, value: v.optional(v.string()),
    expectedRevision: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => await executeAdaptiveThreadCommand(ctx, {
    threadId: args.threadId, expectedRevision: args.expectedRevision, idempotencyKey: args.idempotencyKey,
    commandName: 'setMemoryPreference', payload: { key: args.key, operation: args.operation, value: args.value ?? null },
    returnBlockedWhenDeleting: true,
    apply: async (commandCtx, thread, userId) => {
      if (thread.lifecycle === 'ended' || thread.lifecycle === 'rollback') {
        throw new AdaptiveCommandRejection('blocked', 'thread_not_editable', 'This thread is read-only')
      }
      const value = args.value?.trim() ?? ''
      if (args.operation === 'set' ? value.length < 1 || value.length > 120 : args.value !== undefined) {
        throw new AdaptiveCommandRejection('invalid', 'preference_value_invalid', 'Preference value is invalid')
      }
      const existing = await commandCtx.db.query('learningThreadPreferences')
        .withIndex('by_userId_and_threadId_and_key', q => q.eq('userId', userId).eq('threadId', thread._id).eq('key', args.key)).unique()
      if (args.operation === 'clear' && !existing) {
        throw new AdaptiveCommandRejection('blocked', 'preference_unavailable', 'Preference is unavailable')
      }
      const now = Date.now()
      if (args.operation === 'clear') await commandCtx.db.delete(existing!._id)
      else if (existing) await commandCtx.db.patch(existing._id, {
        value: args.operation === 'set' ? value : null,
        state: args.operation === 'set' ? 'active' : 'disabled', revision: existing.revision + 1, updatedAt: now,
      })
      else await commandCtx.db.insert('learningThreadPreferences', {
        userId, threadId: thread._id, key: args.key, value: args.operation === 'set' ? value : null,
        state: args.operation === 'set' ? 'active' : 'disabled', revision: 1, createdAt: now, updatedAt: now,
      })
      const revision = thread.revision + 1
      await commandCtx.db.patch(thread._id, { revision, updatedAt: now })
      return { value: { key: args.key, state: args.operation === 'clear' ? 'cleared' as const : args.operation === 'set' ? 'active' as const : 'disabled' as const }, revision }
    },
  }),
})

async function artifactEvidenceUnavailable(ctx: QueryCtx | MutationCtx, thread: Doc<'learningThreads'>, activity: Doc<'learningThreadActivities'>) {
  if (activity.activityClass !== 'factual') return false
  if (activity.status === 'blocked' || await liveEvidenceState(ctx, thread) !== 'ready') return true
  const invalidated = await ctx.db.query('learnActivityEvidenceLinks')
    .withIndex('by_userId_and_activityId_and_invalidatedAt', q => q.eq('userId', thread.userId).eq('activityId', activity._id).gt('invalidatedAt', 0))
    .first()
  return invalidated !== null
}

async function latestLiveThreadArtifact(ctx: QueryCtx | MutationCtx, thread: Doc<'learningThreads'>) {
  const [draft, saved] = await Promise.all([
    ctx.db.query('learningThreadArtifacts')
      .withIndex('by_userId_and_threadId_and_status_and_updatedAt', q => q.eq('userId', thread.userId).eq('threadId', thread._id).eq('status', 'draft'))
      .order('desc').first(),
    ctx.db.query('learningThreadArtifacts')
      .withIndex('by_userId_and_threadId_and_status_and_updatedAt', q => q.eq('userId', thread.userId).eq('threadId', thread._id).eq('status', 'saved'))
      .order('desc').first(),
  ])
  if (!draft) return saved
  if (!saved) return draft
  return draft.updatedAt > saved.updatedAt || draft.updatedAt === saved.updatedAt && String(draft._id) > String(saved._id) ? draft : saved
}

export const saveArtifact = mutation({
  args: { threadId: v.id('learningThreads'), activityId: v.string(), artifactId: v.optional(v.id('learningThreadArtifacts')),
    artifactKind: adaptiveArtifactKindValidator, title: v.string(), summary: v.string(), status: adaptiveArtifactStatusValidator,
    expectedRevision: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => await executeAdaptiveThreadCommand(ctx, {
    threadId: args.threadId, expectedRevision: args.expectedRevision, idempotencyKey: args.idempotencyKey,
    commandName: 'saveArtifact', payload: { activityId: args.activityId, artifactId: args.artifactId ? String(args.artifactId) : null,
      artifactKind: args.artifactKind, title: args.title, summary: args.summary, status: args.status },
    returnBlockedWhenDeleting: true,
    apply: async (commandCtx, thread, userId) => {
      if (thread.lifecycle === 'ended' || thread.lifecycle === 'rollback') throw new AdaptiveCommandRejection('blocked', 'thread_not_editable', 'Thread is unavailable for artifact editing')
      let text: ReturnType<typeof boundedArtifactText>
      try { text = boundedArtifactText(args.title, args.summary, args.status) }
      catch { throw new AdaptiveCommandRejection('invalid', 'artifact_text_invalid', 'Artifact title or summary is invalid') }
      const activity = await commandCtx.db.query('learningThreadActivities')
        .withIndex('by_userId_and_activityId', q => q.eq('userId', userId).eq('activityId', args.activityId)).unique()
      if (!activity || activity.threadId !== thread._id) throw new AdaptiveCommandRejection('blocked', 'activity_unavailable', 'Activity is unavailable')
      if (await artifactEvidenceUnavailable(commandCtx, thread, activity)) throw new AdaptiveCommandRejection('blocked', 'artifact_evidence_unavailable', 'This activity evidence is unavailable; the artifact is read-only')
      const now = Date.now()
      let artifactId = args.artifactId
      let artifactRevision = 1
      if (artifactId) {
        const existing = await commandCtx.db.get(artifactId)
        if (!existing || existing.userId !== userId || existing.threadId !== thread._id || existing.activityId !== activity._id || existing.status === 'deleted') throw new AdaptiveCommandRejection('blocked', 'artifact_unavailable', 'Artifact is unavailable')
        artifactRevision = existing.revision + 1
        await commandCtx.db.patch(artifactId, { artifactKind: args.artifactKind, ...text, status: args.status, revision: artifactRevision, updatedAt: now })
      }
      else {
        if (thread.currentActivityId !== activity._id) throw new AdaptiveCommandRejection('blocked', 'activity_not_current', 'Current activity is unavailable')
        artifactId = await commandCtx.db.insert('learningThreadArtifacts', { userId, threadId: thread._id, activityId: activity._id,
          artifactKind: args.artifactKind, ...text, status: args.status, revision: artifactRevision, createdAt: now, updatedAt: now })
      }
      const revision = thread.revision + 1
      await commandCtx.db.patch(thread._id, { unresolvedPoint: (thread.unresolvedPoint ?? thread.originalNeed).slice(0, 240),
        nextAction: { kind: args.status === 'saved' ? 'review_artifact' : 'continue_artifact',
          label: args.status === 'saved' ? 'Review your saved artifact' : 'Continue your artifact',
          reasonCode: args.status === 'saved' ? 'artifact_saved' : 'artifact_draft', activityId: activity.activityId },
        revision, updatedAt: now })
      return { value: { artifactId, status: args.status, revision: artifactRevision }, revision }
    },
  }),
})

export const deleteArtifact = mutation({
  args: { threadId: v.id('learningThreads'), artifactId: v.id('learningThreadArtifacts'), expectedRevision: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => await executeAdaptiveThreadCommand(ctx, {
    threadId: args.threadId, expectedRevision: args.expectedRevision, idempotencyKey: args.idempotencyKey,
    commandName: 'deleteArtifact', payload: { artifactId: String(args.artifactId) },
    returnBlockedWhenDeleting: true,
    apply: async (commandCtx, thread, userId) => {
      const artifact = await commandCtx.db.get(args.artifactId)
      if (!artifact || artifact.userId !== userId || artifact.threadId !== thread._id || artifact.status === 'deleted') throw new AdaptiveCommandRejection('blocked', 'artifact_unavailable', 'Artifact is unavailable')
      const removed = await queueAdaptiveArtifactDeletion(commandCtx, artifact)
      const revision = thread.revision + 1
      const now = Date.now()
      const latest = await latestLiveThreadArtifact(commandCtx, thread)
      const latestActivity = latest && await commandCtx.db.get(latest.activityId)
      const current = thread.currentActivityId && await commandCtx.db.get(thread.currentActivityId)
      const nextAction = latest && latestActivity?.userId === userId && latestActivity.threadId === thread._id
        ? { kind: latest.status === 'saved' ? 'review_artifact' : 'continue_artifact',
            label: latest.status === 'saved' ? 'Review your saved artifact' : 'Continue your artifact',
            reasonCode: latest.status === 'saved' ? 'artifact_saved' : 'artifact_draft',
            activityId: latestActivity.activityId }
        : current ? { kind: current.requiredAction.kind, label: current.requiredAction.label,
            reasonCode: current.reasonCode, activityId: current.activityId }
          : undefined
      await commandCtx.db.patch(thread._id, { nextAction, revision, updatedAt: now })
      return { value: { artifactId: artifact._id, status: 'deleted' as const, cleanupPending: !removed }, revision }
    },
  }),
})

export const listThreadArtifacts = query({
  args: { threadId: v.id('learningThreads') },
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveQueryAccess(ctx)
    const thread = await ctx.db.get(args.threadId)
    if (!thread || thread.userId !== userId || thread.deletionStartedAt !== undefined) throw new Error('Thread not found')
    const [drafts, saved] = await Promise.all([
      ctx.db.query('learningThreadArtifacts')
        .withIndex('by_userId_and_threadId_and_status_and_updatedAt', q => q.eq('userId', userId).eq('threadId', thread._id).eq('status', 'draft'))
        .order('desc').take(16),
      ctx.db.query('learningThreadArtifacts')
        .withIndex('by_userId_and_threadId_and_status_and_updatedAt', q => q.eq('userId', userId).eq('threadId', thread._id).eq('status', 'saved'))
        .order('desc').take(16),
    ])
    const rows = [...drafts, ...saved].sort((a, b) => b.updatedAt - a.updatedAt || String(b._id).localeCompare(String(a._id))).slice(0, 16)
    return await Promise.all(rows.map(async row => {
      const activity = await ctx.db.get(row.activityId)
      const evidenceUnavailable = !activity || await artifactEvidenceUnavailable(ctx, thread, activity)
      return {
        id: row._id, activityId: row.activityId, artifactKind: row.artifactKind, revision: row.revision,
        title: row.title, summary: row.summary, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt,
        historical: evidenceUnavailable, readOnly: evidenceUnavailable || thread.lifecycle === 'ended' || thread.lifecycle === 'rollback',
        evidenceLabel: evidenceUnavailable ? 'evidence_unavailable' as const : null,
      }
    }))
  },
})

export const getArtifactCanvas = query({
  args: { threadId: v.id('learningThreads') },
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveQueryAccess(ctx)
    const thread = await ctx.db.get(args.threadId)
    if (!thread || thread.userId !== userId || thread.deletionStartedAt !== undefined || !thread.currentActivityId) return null
    const activity = await ctx.db.get(thread.currentActivityId)
    if (!activity || activity.userId !== userId || activity.threadId !== thread._id
      || activity.activityClass !== 'non_factual' || activity.primitivePlan.length !== 1
      || activity.primitivePlan[0]?.type !== 'artifact_workspace') return null
    const owner = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique()
    if (!owner) return null
    const replay = await replayAdaptiveActivityPlan(storedPlan(activity))
    const operable = replay.ok && activity.requiredAction.kind === 'save_artifact'
      && activity.requiredAction.label === 'Save artifact'
      && activity.primitivePlan[0].action === 'save_artifact'
      && activity.evaluationContract.kind !== 'server_scored'
      && ['eligible', 'started', 'submitted', 'feedback'].includes(activity.status)
      && !['ended', 'rollback'].includes(thread.lifecycle)
    return {
      ownerId: owner._id,
      thread: { id: thread._id, revision: thread.revision, outcome: thread.outcome ?? thread.originalNeed },
      activity: { id: activity.activityId, planRevision: activity.planRevision, status: activity.status,
        primitive: operable ? activity.primitivePlan[0] : null, fallback: activity.fallback },
      status: operable ? activity.status : 'blocked' as const,
    }
  },
})

const reflectionDecisionValidator = v.union(v.literal('accept'), v.literal('override'), v.literal('end'))
const REFLECTION_DECISION_VERSION = 'learn-adaptive.reflection-decision.v1' as const

function reflectionDecisionInput(outcome: 'accepted' | 'overridden' | 'ended') {
  return outcome === 'accepted' ? 'accept' as const : outcome === 'overridden' ? 'override' as const : 'end' as const
}

async function reflectionReceiptMatches(thread: Doc<'learningThreads'>, activity: Doc<'learningThreadActivities'>,
  receipt: Doc<'learnActivityCommandReceipts'>, outcome: 'accepted' | 'overridden' | 'ended') {
  const expected = await prepareAdaptiveCommand({
    userId: activity.userId, commandName: 'decideReflectionNextMove', targetId: String(thread._id),
    expectedRevision: receipt.targetRevision, idempotencyKey: 'reflection-integrity-check',
    payload: { activityId: activity.activityId, decision: reflectionDecisionInput(outcome) },
  })
  return receipt.requestFingerprint === expected.requestFingerprint
}

async function validReflectionActivity(activity: Doc<'learningThreadActivities'>) {
  if (activity.activityClass !== 'non_factual' || activity.primitivePlan.length !== 1
    || activity.primitivePlan[0]?.type !== 'reflection_next_move'
    || activity.requiredAction.kind !== activity.primitivePlan[0].action
    || activity.evaluationContract.kind !== 'acknowledgement'
    || activity.evaluationContract.responseFormat !== 'none'
    || activity.evaluationContract.passingScorePercent !== null
    || activity.evidenceReferences.length !== 0
    || activity.learningVoidId !== null || activity.blueprintRevisionId !== null
    || activity.objectiveId !== null || activity.sessionContentId !== null) return null
  const expectedReason = reasonTextForActivity({ activityClass: activity.activityClass, purpose: activity.purpose,
    reasonCode: activity.reasonCode, sourceState: activity.decisionInputs.sourceState })
  if (!activity.reasonText || activity.reasonText.version !== expectedReason.version
    || activity.reasonText.purpose !== expectedReason.purpose || activity.reasonText.text !== expectedReason.text) return null
  const replay = await replayAdaptiveActivityPlan(storedPlan(activity))
  if (!replay.ok) return null
  const primitive = activity.primitivePlan[0]
  const primaryDecision = primitive.action === 'accept_next_move' ? 'accept'
    : primitive.action === 'override_next_move' ? 'override' : 'end'
  return primitive.props.allowedDecisions.includes(primaryDecision) ? primitive : null
}

async function validPersistedReflectionDecision(ctx: QueryCtx | MutationCtx, thread: Doc<'learningThreads'>, activity: Doc<'learningThreadActivities'>,
  primitive: NonNullable<Awaited<ReturnType<typeof validReflectionActivity>>>) {
  const decision = activity.reflectionDecision
  if (!decision) return false
  if (activity.status !== 'ended' || decision.version !== REFLECTION_DECISION_VERSION
    || decision.nextMove !== primitive.props.nextMove
    || !Number.isSafeInteger(decision.decisionRevision) || decision.decisionRevision < 2
    || decision.decisionRevision > thread.revision
    || !/^sha256:[a-f0-9]{64}$/.test(decision.idempotencyKeyHash)
    || (decision.outcome === 'ended') !== (thread.lifecycle === 'ended')) return false
  const receipt = await ctx.db.query('learnActivityCommandReceipts')
    .withIndex('by_userId_and_idempotencyKeyHash', q => q.eq('userId', activity.userId).eq('idempotencyKeyHash', decision.idempotencyKeyHash))
    .unique()
  return Boolean(receipt && receipt.threadId === thread._id && receipt.commandName === 'decideReflectionNextMove'
    && receipt.targetRevision + 1 === decision.decisionRevision && receipt.resultKind === 'ok'
    && await reflectionReceiptMatches(thread, activity, receipt, decision.outcome))
}

export const getReflectionCanvas = query({
  args: { threadId: v.id('learningThreads') },
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveQueryAccess(ctx)
    const thread = await ctx.db.get(args.threadId)
    if (!thread || thread.userId !== userId || thread.deletionStartedAt !== undefined || !thread.currentActivityId) return null
    const activity = await ctx.db.get(thread.currentActivityId)
    if (!activity || activity.userId !== userId || activity.threadId !== thread._id) return null
    if (activity.primitivePlan.length !== 1 || activity.primitivePlan[0]?.type !== 'reflection_next_move') return null
    const owner = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique()
    if (!owner) return null
    const primitive = await validReflectionActivity(activity)
    const decision = activity.reflectionDecision
    const decisionValid = !decision || primitive && await validPersistedReflectionDecision(ctx, thread, activity, primitive)
    const ready = primitive && !decision && ['eligible', 'started'].includes(activity.status)
      && ['ready', 'active'].includes(thread.lifecycle)
    const completed = primitive && decision && decisionValid
    return {
      ownerId: owner._id,
      thread: { id: thread._id, revision: thread.revision, outcome: thread.outcome ?? thread.originalNeed, lifecycle: thread.lifecycle },
      activity: {
        id: activity.activityId, planRevision: activity.planRevision, status: activity.status,
        purpose: activity.purpose, reason: activity.reasonText?.text ?? activity.purpose,
        primitive: ready || completed ? primitive : null, fallback: activity.fallback,
      },
      status: completed ? 'completed' as const : ready ? activity.status : 'blocked' as const,
      decision: completed ? { outcome: decision.outcome, nextMove: decision.nextMove, decidedAt: decision.decidedAt } : null,
    }
  },
})

export const decideReflectionNextMove = mutation({
  args: { threadId: v.id('learningThreads'), activityId: v.string(), decision: reflectionDecisionValidator,
    expectedRevision: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => await executeAdaptiveThreadCommand(ctx, {
    threadId: args.threadId, expectedRevision: args.expectedRevision, idempotencyKey: args.idempotencyKey,
    commandName: 'decideReflectionNextMove', payload: { activityId: args.activityId, decision: args.decision },
    returnBlockedWhenDeleting: true,
    replayExpiredResult: async (commandCtx, receipt, userId) => {
      const thread = await commandCtx.db.get(receipt.threadId)
      const activity = thread?.currentActivityId && await commandCtx.db.get(thread.currentActivityId)
      const durable = activity?.reflectionDecision
      if (!thread || thread.userId !== userId || !activity || activity.userId !== userId || activity.activityId !== args.activityId
        || !durable || durable.idempotencyKeyHash !== receipt.idempotencyKeyHash
        || durable.outcome !== (args.decision === 'accept' ? 'accepted' : args.decision === 'override' ? 'overridden' : 'ended')
        || durable.decisionRevision !== receipt.targetRevision + 1 || durable.decisionRevision > thread.revision) return null
      const primitive = await validReflectionActivity(activity)
      if (!primitive || !(await validPersistedReflectionDecision(commandCtx, thread, activity, primitive))) return null
      return { kind: 'ok' as const, value: { outcome: durable.outcome, nextMove: durable.nextMove }, revision: durable.decisionRevision, receiptId: String(receipt._id) }
    },
    apply: async (commandCtx, thread, userId, command) => {
      const activity = thread.currentActivityId && await commandCtx.db.get(thread.currentActivityId)
      if (!activity || activity.userId !== userId || activity.threadId !== thread._id || activity.activityId !== args.activityId) {
        throw new AdaptiveCommandRejection('blocked', 'activity_unavailable', 'Reflection activity is unavailable')
      }
      const primitive = await validReflectionActivity(activity)
      if (!primitive || activity.reflectionDecision || !['eligible', 'started'].includes(activity.status)
        || !['ready', 'active'].includes(thread.lifecycle)) {
        throw new AdaptiveCommandRejection('blocked', 'activity_unavailable', 'Reflection activity is unavailable')
      }
      if (!primitive.props.allowedDecisions.includes(args.decision)) {
        throw new AdaptiveCommandRejection('blocked', 'decision_unavailable', 'That reflection choice is unavailable')
      }
      const outcome = args.decision === 'accept' ? 'accepted' as const : args.decision === 'override' ? 'overridden' as const : 'ended' as const
      const revision = thread.revision + 1
      const now = Date.now()
      await commandCtx.db.patch(activity._id, { status: 'ended', reflectionDecision: {
        version: REFLECTION_DECISION_VERSION, outcome, nextMove: primitive.props.nextMove,
        decisionRevision: revision, idempotencyKeyHash: command.idempotencyKeyHash, decidedAt: now,
      }, updatedAt: now })
      const nextAction = args.decision === 'accept'
        ? { kind: 'continue', label: primitive.props.nextMove, reasonCode: 'reflection_next_move_accepted', activityId: activity.activityId }
        : args.decision === 'override'
          ? { kind: 'override', label: 'Choose a different next move', reasonCode: 'reflection_next_move_overridden', activityId: activity.activityId }
          : { kind: 'return_to_learn', label: 'Back to Learn', reasonCode: 'reflection_thread_ended', activityId: activity.activityId }
      await commandCtx.db.patch(thread._id, { lifecycle: args.decision === 'end' ? 'ended' : thread.lifecycle,
        ...(args.decision === 'end' ? { lifecycleChangedAt: now } : {}),
        unresolvedPoint: (thread.unresolvedPoint ?? (args.decision === 'accept'
          ? primitive.props.nextMove : thread.originalNeed)).slice(0, 240),
        nextAction, revision, updatedAt: now })
      await writeLearnActivityEvent(commandCtx, { userId, threadId: thread._id, activityId: activity._id,
        eventType: 'activity_completed', eventVersion: 'activity_completed.v1', sourceVersion: activity.planVersion,
        contractVersion: activity.contractVersion, semanticKey: `activity:${activity.activityId}:reflection:${outcome}`,
        occurredAt: now, reasonCode: `reflection_${outcome}`, outcomeCode: outcome,
        metadata: { activityClass: 'non_factual', boundaryOrdinal: activity.boundaryOrdinal, planRevision: activity.planRevision } })
      if (args.decision === 'end') await writeLearnActivityEvent(commandCtx, {
        userId, threadId: thread._id, activityId: activity._id,
        eventType: 'explicit_end', eventVersion: 'explicit_end.v1',
        sourceVersion: 'learn-adaptive.lifecycle.v1', contractVersion: activity.contractVersion,
        semanticKey: `thread:${String(thread._id)}:explicit_end`, occurredAt: now,
        reasonCode: 'learner_ended_thread', outcomeCode: 'ended', metadata: {},
      })
      return { value: { outcome, nextMove: primitive.props.nextMove }, revision }
    },
  }),
})

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
      if (thread.lifecycle === 'paused' || thread.lifecycle === 'ended' || thread.lifecycle === 'rollback') throw new Error('Thread intent cannot be changed in its current lifecycle')
      if (thread.intent === args.intent) return { value: { intent: thread.intent }, revision: thread.revision }
      const revision = thread.revision + 1
      await commandCtx.db.patch(thread._id, { intent: args.intent, revision, updatedAt: Date.now() })
      return { value: { intent: args.intent }, revision }
    },
  }),
})

// A closed learner preference for the next boundary. The current activity and
// response stay authoritative; Slice 2 owns replayable route consumption.
export const applyOverride = mutation({
  args: { threadId: v.id('learningThreads'), activityId: v.string(), option: adaptiveOverrideOptionValidator,
    expectedRevision: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => await executeAdaptiveThreadCommand(ctx, {
    threadId: args.threadId, expectedRevision: args.expectedRevision, idempotencyKey: args.idempotencyKey,
    commandName: 'applyOverride', payload: { activityId: args.activityId, option: args.option },
    apply: async (commandCtx, thread, userId) => {
      const activity = thread.currentActivityId && await commandCtx.db.get(thread.currentActivityId)
      if (!activity || activity.userId !== userId || activity.threadId !== thread._id || activity.activityId !== args.activityId) throw new Error('Current activity is unavailable')
      const factualCanvas = activity.activityClass === 'factual' ? await loadReadyCanvas(commandCtx, userId, thread._id) : null
      const diagnosticOperable = activity.activityClass === 'non_factual' ? await isOperableDiagnosticActivity(activity) : false
      const evidenceState = await liveEvidenceState(commandCtx, thread)
      const controls = projectAdaptiveControls({ activityClass: activity.activityClass,
        activityStatus: activity.activityClass === 'factual' && (!factualCanvas || factualCanvas.status === 'blocked')
          || activity.activityClass === 'non_factual' && !diagnosticOperable ? 'blocked' : activity.status,
        lifecycle: thread.lifecycle, evidenceReady: activity.activityClass === 'factual' && !!factualCanvas && factualCanvas.status !== 'blocked' && evidenceState === 'ready',
        sourceCount: new Set(activity.evidenceReferences.map(reference => String(reference.sourceSnapshotId))).size,
        currentTime: thread.availableTime })
      const option = controls.options.find(candidate => candidate.key === args.option)
      if (!option?.available) throw new Error(`Override unavailable: ${option?.unavailableReason ?? 'policy'}`)
      const now = Date.now()
      const fixedNextPlan = fixedNextPlanForOverride(args.option, thread.availableTime)
      await commandCtx.db.insert('learnActivityOverrides', { userId, threadId: thread._id, activityId: activity._id,
        option: args.option, source: 'learner', version: ADAPTIVE_OVERRIDE_VERSION,
        fixedNextPlan, selectionAvailableTime: thread.availableTime,
        boundaryOrdinal: activity.boundaryOrdinal, selectedRevision: thread.revision + 1, createdAt: now })
      const revision = thread.revision + 1
      await commandCtx.db.patch(thread._id, { revision, updatedAt: now })
      return { value: { option: args.option, source: 'learner' as const, fixedNextPlan }, revision }
    },
  }),
})

const HISTORY_LIMIT = 8

const lifecycleArgs = { threadId: v.id('learningThreads'), expectedRevision: v.number(), idempotencyKey: v.string() }

async function requireLifecycleAnchor(ctx: MutationCtx, thread: Doc<'learningThreads'>, userId: string) {
  if (thread.authorityKind !== 'v2_mission') return
  const learningVoid = thread.learningVoidId && await ctx.db.get(thread.learningVoidId)
  if (!learningVoid || learningVoid.userId !== userId) throw new Error('Thread mission anchor is unavailable')
  if (!thread.currentActivityId) return
  const activity = await ctx.db.get(thread.currentActivityId)
  if (!activity || activity.userId !== userId || activity.threadId !== thread._id
    || activity.activityClass === 'factual' && activity.learningVoidId !== learningVoid._id) {
    throw new Error('Thread mission anchor is unavailable')
  }
}

export const leaveThread = mutation({
  args: lifecycleArgs,
  handler: async (ctx, args) => await executeAdaptiveThreadCommand(ctx, {
    ...args, commandName: 'leaveThread', payload: {}, returnBlockedWhenDeleting: true,
    apply: async (commandCtx, thread, userId) => {
      await requireLifecycleAnchor(commandCtx, thread, userId)
      if (thread.lifecycle === 'paused' || thread.lifecycle === 'ended' || thread.lifecycle === 'rollback') {
        throw new AdaptiveCommandRejection('blocked', 'lifecycle_unavailable', 'Thread cannot be left in its current lifecycle')
      }
      const previousLifecycle = thread.lifecycle
      const changedAt = Date.now()
      const revision = thread.revision + 1
      await commandCtx.db.patch(thread._id, {
        lifecycle: 'paused', lifecycleBeforePause: previousLifecycle, lifecycleChangedAt: changedAt,
        revision, updatedAt: changedAt,
      })
      return { value: { lifecycle: 'paused' as const, previousLifecycle, changedAt }, revision }
    },
  }),
})

export const resumeThread = mutation({
  args: lifecycleArgs,
  handler: async (ctx, args) => await executeAdaptiveThreadCommand(ctx, {
    ...args, commandName: 'resumeThread', payload: {}, returnBlockedWhenDeleting: true,
    apply: async (commandCtx, thread, userId) => {
      await requireLifecycleAnchor(commandCtx, thread, userId)
      if (thread.lifecycle !== 'paused' || !thread.lifecycleBeforePause) {
        throw new AdaptiveCommandRejection('blocked', 'lifecycle_unavailable', 'Thread is not available to resume')
      }
      const lifecycle = thread.lifecycleBeforePause
      const changedAt = Date.now()
      const revision = thread.revision + 1
      await commandCtx.db.patch(thread._id, {
        lifecycle, lifecycleBeforePause: undefined, lifecycleChangedAt: changedAt,
        revision, updatedAt: changedAt,
      })
      return { value: { lifecycle, changedAt }, revision }
    },
  }),
})

export const endThread = mutation({
  args: lifecycleArgs,
  handler: async (ctx, args) => await executeAdaptiveThreadCommand(ctx, {
    ...args, commandName: 'endThread', payload: {}, returnBlockedWhenDeleting: true,
    apply: async (commandCtx, thread, userId) => {
      await requireLifecycleAnchor(commandCtx, thread, userId)
      if (thread.lifecycle === 'ended' || thread.lifecycle === 'rollback') {
        throw new AdaptiveCommandRejection('blocked', 'lifecycle_unavailable', 'Thread cannot be ended in its current lifecycle')
      }
      const changedAt = Date.now()
      const revision = thread.revision + 1
      await commandCtx.db.patch(thread._id, {
        lifecycle: 'ended', lifecycleBeforePause: undefined, lifecycleChangedAt: changedAt,
        unresolvedPoint: (thread.unresolvedPoint ?? thread.originalNeed).slice(0, 240),
        nextAction: { kind: 'return_to_learn', label: 'Back to Learn', reasonCode: 'thread_ended',
          activityId: thread.currentActivityId ? (await commandCtx.db.get(thread.currentActivityId))?.activityId ?? '' : '' },
        revision, updatedAt: changedAt,
      })
      await writeLearnActivityEvent(commandCtx, {
        userId, threadId: thread._id, eventType: 'explicit_end', eventVersion: 'explicit_end.v1',
        sourceVersion: 'learn-adaptive.lifecycle.v1', contractVersion: 'learn-adaptive.thread.v1',
        semanticKey: `thread:${String(thread._id)}:explicit_end`, occurredAt: changedAt,
        reasonCode: 'learner_ended_thread', outcomeCode: 'ended', metadata: {},
      })
      return { value: { lifecycle: 'ended' as const, changedAt }, revision }
    },
  }),
})

export async function representativeCompletion(ctx: QueryCtx | MutationCtx, userId: string, activity: Doc<'learningThreadActivities'> | null) {
  if (!activity || activity.activityClass !== 'factual' || activity.status !== 'feedback'
    || activity.evaluationContract.kind !== 'server_scored' || !activity.masteryAttemptId || !activity.scoringJobId) return null
  const [attempt, job, passedEvent, failedEvent] = await Promise.all([
    ctx.db.get(activity.masteryAttemptId),
    ctx.db.get(activity.scoringJobId),
    ctx.db.query('learnActivityEvents').withIndex('by_userId_and_activityId_and_eventType_and_occurredAt', q => q.eq('userId', userId).eq('activityId', activity._id).eq('eventType', 'representative_pass')).first(),
    ctx.db.query('learnActivityEvents').withIndex('by_userId_and_activityId_and_eventType_and_occurredAt', q => q.eq('userId', userId).eq('activityId', activity._id).eq('eventType', 'representative_fail')).first(),
  ])
  if (!attempt || !job || attempt.userId !== userId || attempt.blueprintRevisionId !== activity.blueprintRevisionId
    || attempt.objectiveId !== activity.objectiveId || attempt.sessionContentId !== activity.sessionContentId
    || attempt.contentRevision !== activity.generationInputs.sessionContentRevision
    || !attempt.studySessionId || !attempt.studyPlanRevisionId
    || job.userId !== userId || job.type !== 'mastery_scoring' || job.status !== 'succeeded'
    || job.adaptiveThreadId !== activity.threadId || job.adaptiveActivityId !== activity._id
    || job.studySessionId !== attempt.studySessionId || job.studyPlanRevisionId !== attempt.studyPlanRevisionId
    || job.learningVoidId !== activity.learningVoidId || job.blueprintRevisionId !== activity.blueprintRevisionId
    || job.checkpoint !== `attempt:${String(attempt._id)}`
    || !Number.isFinite(attempt.serverScorePercent) || Boolean(passedEvent) === Boolean(failedEvent)) return null
  const event = passedEvent ?? failedEvent!
  const passed = attempt.serverScorePercent! >= LEARN_V2_MASTERY_THRESHOLD
  if (activity.evaluationContract.passingScorePercent !== LEARN_V2_MASTERY_THRESHOLD
    || event.threadId !== activity.threadId || event.activityId !== activity._id
    || event.outcomeCode !== (passed ? 'pass' : 'fail') || Boolean(passedEvent) !== passed
    || event.sourceVersion !== attempt.scorerVersion || event.contractVersion !== activity.contractVersion
    || event.metadata.boundaryOrdinal !== activity.boundaryOrdinal || event.metadata.planRevision !== activity.planRevision
    || event.dedupeKeyHash !== await learnActivityEventDedupeHash({ userId, threadId: activity.threadId,
      eventVersion: passed ? 'representative_pass.v1' : 'representative_fail.v1', semanticKey: `attempt:${String(attempt._id)}:representative`,
      taxonomyVersion: event.taxonomyVersion })) return null
  return { version: ADAPTIVE_REPRESENTATIVE_COMPLETION_VERSION,
    status: passedEvent ? 'passed' as const : 'needs_practice' as const,
    basis: 'server_scored_representative_task' as const, activityId: activity.activityId, recordedAt: event.occurredAt }
}

async function validArtifactNextAction(ctx: QueryCtx, thread: Doc<'learningThreads'>) {
  const action = thread.nextAction
  if (!action || !['artifact_saved', 'artifact_draft'].includes(action.reasonCode)) return false
  const latest = await latestLiveThreadArtifact(ctx, thread)
  if (!latest) return false
  const sourceActivity = await ctx.db.get(latest.activityId)
  if (!sourceActivity || sourceActivity.userId !== thread.userId || sourceActivity.threadId !== thread._id
    || sourceActivity.activityId !== action.activityId) return false
  const saved = latest.status === 'saved'
  return action.kind === (saved ? 'review_artifact' : 'continue_artifact')
    && action.label === (saved ? 'Review your saved artifact' : 'Continue your artifact')
    && action.reasonCode === (saved ? 'artifact_saved' : 'artifact_draft')
}

function nextThreadAction(thread: Doc<'learningThreads'>, activity: Doc<'learningThreadActivities'> | null, factualCanvas: Awaited<ReturnType<typeof loadReadyCanvas>>, sourceEvidenceState: Awaited<ReturnType<typeof liveEvidenceState>>, completion: Awaited<ReturnType<typeof representativeCompletion>>, reflectionDecisionValid = false, artifactActionValid = false) {
  if (thread.lifecycle === 'rollback') return {
    kind: 'return_to_learn', label: 'Back to Learn', reasonCode: 'thread_unavailable', activityId: null,
  }
  if (thread.lifecycle === 'blocked' || thread.lifecycle === 'paused') return {
    kind: 'recover', label: 'Back to Learn', reasonCode: `thread_${thread.lifecycle}`, activityId: activity?.activityId ?? null,
  }
  if (activity?.reflectionDecision && reflectionDecisionValid && thread.nextAction) {
    const decision = activity.reflectionDecision
    const expected = decision.outcome === 'accepted'
      ? { kind: 'continue', label: decision.nextMove, reasonCode: 'reflection_next_move_accepted' }
      : decision.outcome === 'overridden'
        ? { kind: 'override', label: 'Choose a different next move', reasonCode: 'reflection_next_move_overridden' }
        : { kind: 'return_to_learn', label: 'Back to Learn', reasonCode: 'reflection_thread_ended' }
    if (thread.nextAction.kind === expected.kind && thread.nextAction.label === expected.label
      && thread.nextAction.reasonCode === expected.reasonCode && thread.nextAction.activityId === activity.activityId) return thread.nextAction
    return { kind: 'recover', label: 'Back to Learn', reasonCode: 'reflection_decision_invalid', activityId: activity.activityId }
  }
  if (thread.lifecycle === 'ended') return {
    kind: 'return_to_learn', label: 'Back to Learn', reasonCode: 'thread_unavailable', activityId: null,
  }
  if (activity?.activityClass === 'factual' && sourceEvidenceState !== 'ready') return {
    kind: 'recover', label: 'Review your learning mission', reasonCode: `source_${sourceEvidenceState}`, activityId: activity.activityId,
  }
  if (activity?.activityClass === 'factual' && (!factualCanvas || factualCanvas.status === 'blocked')) return {
    kind: 'recover', label: 'Review your learning mission', reasonCode: factualCanvas ? 'canvas_blocked' : 'canvas_unavailable', activityId: activity.activityId,
  }
  if (artifactActionValid && thread.nextAction) return thread.nextAction
  if (activity && completion) {
    const expected = representativeNextAction(completion.status === 'passed', activity.activityId)
    return thread.nextAction?.kind === expected.kind && thread.nextAction.activityId === expected.activityId
      && thread.nextAction.reasonCode === expected.reasonCode ? thread.nextAction : expected
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

async function projectThread(ctx: QueryCtx, userId: string, thread: Doc<'learningThreads'>) {
  const owner = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique()
  if (!owner) return null
  const activity = thread.currentActivityId ? await ctx.db.get(thread.currentActivityId) : null
  if (activity && (activity.userId !== userId || activity.threadId !== thread._id)) return null
  if (thread.authorityKind === 'v2_mission') {
    const learningVoid = thread.learningVoidId && await ctx.db.get(thread.learningVoidId)
    if (!learningVoid || learningVoid.userId !== userId
      || activity?.activityClass === 'factual' && activity.learningVoidId !== learningVoid._id) return null
  }
  const sourceEvidenceState = await liveEvidenceState(ctx, thread)
  const factualCanvas = activity?.activityClass === 'factual' ? await loadReadyCanvas(ctx, userId, thread._id) : null
  const completion = await representativeCompletion(ctx, userId, activity)
  const reflectionPrimitive = activity ? await validReflectionActivity(activity) : null
  const reflectionDecisionValid = Boolean(activity && reflectionPrimitive
    && await validPersistedReflectionDecision(ctx, thread, activity, reflectionPrimitive))
  const artifactActionValid = await validArtifactNextAction(ctx, thread)
  const liveArtifact = await latestLiveThreadArtifact(ctx, thread)
  const artifactActivity = liveArtifact ? await ctx.db.get(liveArtifact.activityId) : null
  const artifactHistorical = !artifactActivity || artifactActivity.userId !== userId || artifactActivity.threadId !== thread._id
    || await artifactEvidenceUnavailable(ctx, thread, artifactActivity)
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
      id: thread._id, goal: thread.originalNeed, outcome: thread.outcome ?? thread.originalNeed, intent: thread.intent,
      sourceScope: thread.sourceScope, evidenceState, lifecycle: thread.lifecycle, revision: thread.revision,
      lifecycleChangedAt: thread.lifecycleChangedAt ?? null,
      authorityKind: thread.authorityKind, learningVoidId: thread.learningVoidId ?? null,
    },
    currentActivity: activity ? {
      id: activity.activityId, status: activity.status, activityClass: activity.activityClass,
      purpose: activity.purpose, reasonCode: activity.reasonCode, boundaryOrdinal: activity.boundaryOrdinal,
    } : null,
    attemptContext: activity ? {
      priorOutcome: activity.decisionInputs.priorOutcome,
      assistance: activity.decisionInputs.assistance,
    } : null,
    artifact: liveArtifact ? { id: liveArtifact._id, title: liveArtifact.title, status: liveArtifact.status,
      activityId: artifactActivity?.activityId ?? null, historical: artifactHistorical } : null,
    unresolvedPoint: thread.unresolvedPoint?.slice(0, 240) ?? null,
    completion,
    history: recent.filter(row => row._id !== thread.currentActivityId).slice(0, HISTORY_LIMIT).map(row => ({
      id: row.activityId, status: row.status, activityClass: row.activityClass,
      purpose: row.purpose, reasonCode: row.reasonCode, boundaryOrdinal: row.boundaryOrdinal,
      updatedAt: row.updatedAt,
    })),
    nextAction: nextThreadAction(thread, activity, factualCanvas, sourceEvidenceState, completion, reflectionDecisionValid, artifactActionValid),
  }
}

export const getThread = query({
  args: { threadId: v.id('learningThreads') },
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveQueryAccess(ctx)
    const thread = await ctx.db.get(args.threadId)
    if (!thread || thread.userId !== userId || thread.deletionStartedAt !== undefined) return null
    return await projectThread(ctx, userId, thread)
  },
})

// A bounded window of recent owner-owned threads is ranked by durable value.
// Priority is lexicographic; timestamps only settle ties within a priority.
const RESUME_CANDIDATE_LIMIT = 16
const RESUME_SIGNAL_LIMIT = 8
export const listResumeCandidates = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAdaptiveQueryAccess(ctx)
    const recentThreads = await ctx.db.query('learningThreads')
      .withIndex('by_userId_and_updatedAt', q => q.eq('userId', userId))
      .order('desc').take(RESUME_CANDIDATE_LIMIT)
    const threads = new Map(recentThreads.map(thread => [String(thread._id), thread]))
    for (const status of ['eligible', 'started', 'feedback'] as const) {
      const activities = await ctx.db.query('learningThreadActivities')
        .withIndex('by_userId_and_status_and_updatedAt', q => q.eq('userId', userId).eq('status', status))
        .order('desc').take(RESUME_SIGNAL_LIMIT)
      for (const activity of activities) {
        const thread = await ctx.db.get(activity.threadId)
        if (thread?.userId === userId && thread.currentActivityId === activity._id) threads.set(String(thread._id), thread)
      }
    }
    for (const evidenceState of ['stale', 'invalidated', 'unavailable'] as const) {
      const changedThreads = await ctx.db.query('learningThreads')
        .withIndex('by_userId_and_evidenceState_and_updatedAt', q => q.eq('userId', userId).eq('evidenceState', evidenceState))
        .order('desc').take(RESUME_SIGNAL_LIMIT)
      for (const thread of changedThreads) threads.set(String(thread._id), thread)
    }
    const vulnerableRecords = await ctx.db.query('masteryRecords')
      .withIndex('by_userId_and_state_and_updatedAt', q => q.eq('userId', userId).eq('state', 'needs_review'))
      .order('desc').take(RESUME_SIGNAL_LIMIT)
    for (const record of vulnerableRecords) {
      const activities = await ctx.db.query('learningThreadActivities')
        .withIndex('by_userId_and_objectiveId_and_updatedAt', q => q.eq('userId', userId).eq('objectiveId', record.objectiveId))
        .order('desc').take(RESUME_SIGNAL_LIMIT)
      for (const activity of activities) {
        if (activity.blueprintRevisionId !== record.blueprintRevisionId) continue
        const thread = await ctx.db.get(activity.threadId)
        if (thread?.userId === userId && thread.currentActivityId === activity._id) threads.set(String(thread._id), thread)
      }
    }
    const candidates = []
    for (const thread of threads.values()) {
      if (thread.deletionStartedAt !== undefined || ['ended', 'rollback'].includes(thread.lifecycle)) continue
      const projection = await projectThread(ctx, userId, thread)
      if (!projection) continue
      const activity = thread.currentActivityId ? await ctx.db.get(thread.currentActivityId) : null
      const action = projection.nextAction
      const safeAction = !['recover', 'return_to_learn', 'wait'].includes(action.kind)
        && (activity?.activityClass !== 'factual' || projection.thread.evidenceState === 'ready')
      const planValid = activity && (await replayAdaptiveActivityPlan(storedPlan(activity))).ok
      const unfinished = Boolean(activity && planValid && ['eligible', 'started', 'feedback'].includes(activity.status) && safeAction)
      const mastery = activity?.objectiveId && activity.blueprintRevisionId
        ? await ctx.db.query('masteryRecords').withIndex('by_userId_and_blueprintRevisionId_and_objectiveId', q => q.eq('userId', userId)
          .eq('blueprintRevisionId', activity.blueprintRevisionId!).eq('objectiveId', activity.objectiveId!)).first()
        : null
      const vulnerable = mastery?.state === 'needs_review'
      const changedSource = activity?.activityClass === 'factual'
        && ['stale', 'invalidated', 'unavailable'].includes(await liveEvidenceState(ctx, thread))
      const priority = unfinished ? 3 : vulnerable ? 2 : changedSource ? 1 : 0
      const reason = unfinished ? 'unfinished_activity' as const : vulnerable ? 'needs_review' as const
        : changedSource ? 'source_recovery' as const : 'recent_thread' as const
      candidates.push({ ownerId: projection.ownerId, threadId: thread._id, outcome: projection.thread.outcome, intent: projection.thread.intent,
        lifecycle: projection.thread.lifecycle, evidenceState: projection.thread.evidenceState,
        unresolvedPoint: projection.unresolvedPoint, currentActivity: projection.currentActivity,
        nextAction: action, reason, updatedAt: thread.updatedAt, priority })
    }
    return candidates.sort((a, b) => b.priority - a.priority || b.updatedAt - a.updatedAt
      || String(a.threadId).localeCompare(String(b.threadId)))
      .map(({ priority: _priority, ...candidate }) => candidate)
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
