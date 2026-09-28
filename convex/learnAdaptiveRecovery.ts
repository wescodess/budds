import { v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireAdaptiveMutationAccess, requireAdaptiveQueryAccess } from './lib/adaptiveLearnAccess'
import { composeAdaptiveActivityPlan, replayAdaptiveActivityPlan, type AdaptiveEvidenceState, type ComposedAdaptiveActivityPlan } from '../shared/learn-adaptive-activity-plan'
import { adaptiveRecoveryCopy } from '../shared/learn-adaptive-recovery'
import { executeAdaptiveThreadCommand } from './learnAdaptiveCommands'
import { hasLearnActivityEvent, writeLearnActivityEvent } from './lib/learnAdaptiveEvents'
import { projectAdaptiveControls, reasonTextForActivity } from '../shared/learn-adaptive-controls'

const DIAGNOSTIC_ROUTER_VERSION = 'learn-adaptive.preparing-diagnostic.v1'

export async function liveEvidenceState(ctx: QueryCtx | MutationCtx, thread: Doc<'learningThreads'>): Promise<AdaptiveEvidenceState> {
  if (thread.sourceScope.kind === 'folder') {
    const folder = await ctx.db.get(thread.sourceScope.sourceId as Id<'folders'>)
    if (!folder || folder.userId !== thread.userId) return 'unavailable'
  }
  if (thread.sourceScope.kind === 'document') {
    const document = await ctx.db.get(thread.sourceScope.sourceId as Id<'documents'>)
    const folder = document && await ctx.db.get(document.folderId)
    if (!document || document.userId !== thread.userId || !folder || folder.userId !== thread.userId) return 'unavailable'
  }
  return thread.evidenceState
}

export function storedPlan(activity: Doc<'learningThreadActivities'>): ComposedAdaptiveActivityPlan {
  return {
    planVersion: activity.planVersion, replayVersion: activity.replayVersion, contractVersion: activity.contractVersion,
    rendererVersion: activity.rendererVersion, validationVersion: activity.validationVersion,
    sequenceValidationVersion: activity.sequenceValidationVersion, fallbackVersion: activity.fallbackVersion,
    activityId: activity.activityId, threadId: String(activity.threadId), boundaryOrdinal: activity.boundaryOrdinal,
    planRevision: activity.planRevision, activityClass: activity.activityClass, intent: activity.intent,
    objectiveId: activity.objectiveId ? String(activity.objectiveId) : null, purpose: activity.purpose,
    reasonCode: activity.reasonCode, primitivePlan: activity.primitivePlan, requiredAction: activity.requiredAction,
    evaluationContract: activity.evaluationContract, fallback: activity.fallback, accessibilityMetadata: activity.accessibilityMetadata,
    pins: { learningVoidId: activity.learningVoidId ? String(activity.learningVoidId) : null,
      blueprintRevisionId: activity.blueprintRevisionId ? String(activity.blueprintRevisionId) : null,
      objectiveId: activity.objectiveId ? String(activity.objectiveId) : null,
      sessionContentId: activity.sessionContentId ? String(activity.sessionContentId) : null },
    evidenceReferences: activity.evidenceReferences.map(reference => ({ ...reference, claimId: String(reference.claimId), supportId: String(reference.supportId), sourceSnapshotId: String(reference.sourceSnapshotId) })),
    generationInputs: activity.generationInputs, decisionInputs: activity.decisionInputs,
    replacesActivityId: activity.replacesActivityId, canonicalInputSnapshot: activity.canonicalInputSnapshot,
    inputDigest: activity.inputDigest,
  }
}

export async function isOperableDiagnosticActivity(activity: Doc<'learningThreadActivities'>) {
  if (activity.activityClass !== 'non_factual' || activity.primitivePlan.length !== 1
    || activity.primitivePlan[0]?.type !== 'diagnostic_prompt' || activity.primitivePlan[0].action !== 'submit_response') return false
  return (await replayAdaptiveActivityPlan(storedPlan(activity))).ok
}

async function recordDiagnosticStartEvents(ctx: MutationCtx, userId: string, thread: Doc<'learningThreads'>, activity: Doc<'learningThreadActivities'>, occurredAt: number) {
  if (!(await hasLearnActivityEvent(ctx, userId, activity._id, 'thread_command_committed'))) throw new Error('Diagnostic opportunity is unavailable')
  await writeLearnActivityEvent(ctx, { userId, threadId: thread._id, activityId: activity._id,
    eventType: 'activity_started', eventVersion: 'activity_started.v1', sourceVersion: activity.planVersion,
    contractVersion: activity.contractVersion, semanticKey: `activity:${activity.activityId}:started`, occurredAt,
    reasonCode: 'diagnostic_rendered', outcomeCode: 'started',
    metadata: { activityClass: 'non_factual', boundaryOrdinal: activity.boundaryOrdinal, planRevision: activity.planRevision } })
  return await writeLearnActivityEvent(ctx, { userId, threadId: thread._id, activityId: activity._id,
    eventType: 'meaningful_activity_started', eventVersion: 'meaningful_activity_started.v1',
    sourceVersion: activity.rendererVersion, contractVersion: activity.contractVersion,
    metricDefinitionVersion: 'first_value.v1', semanticKey: `thread:${String(thread._id)}:opportunity:1:meaningful_start`,
    occurredAt, reasonCode: 'rendered_operable_activity_acknowledged', outcomeCode: 'meaningful_start',
    metadata: { activityClass: 'non_factual', boundaryOrdinal: activity.boundaryOrdinal,
      planRevision: activity.planRevision, opportunityOrdinal: 1 } })
}

// Only the thread id, revision and retry key cross the client seam. The server
// owns the primitive, plan, purpose, response contract and source state.
export const continueDraft = mutation({
  args: { threadId: v.id('learningThreads'), expectedRevision: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => await executeAdaptiveThreadCommand(ctx, {
    ...args, commandName: 'continueStandaloneDiagnostic', payload: {},
    apply: async (commandCtx, thread, userId) => {
      if (thread.authorityKind !== 'standalone' || thread.currentActivityId || ['ended', 'rollback'].includes(thread.lifecycle)) throw new Error('Standalone diagnostic is unavailable')
      if (!thread.initialDecision || thread.initialDecision.status === 'pending') throw new Error('Resolve or skip the initial clarification first')
      const existing = await commandCtx.db.query('learningThreadActivities')
        .withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', userId).eq('threadId', thread._id)).first()
      if (existing) throw new Error('Standalone diagnostic already exists')
      const sourceState = await liveEvidenceState(commandCtx, thread)
      const prompt = thread.intent === 'refresh'
        ? 'What do you already know about this topic, and what would you like to check again?'
        : 'What do you already know, and what would be useful to learn or do next?'
      const activityId = `diagnostic:${String(thread._id)}`
      const composed = await composeAdaptiveActivityPlan({
        activityId, threadId: String(thread._id), boundaryOrdinal: 1, planRevision: 1,
        activityClass: 'non_factual', intent: thread.intent, objectiveId: null,
        purpose: 'Record your starting point while source evidence is prepared or recovered.',
        reasonCode: sourceState === 'preparing' ? 'evidence_preparing_diagnostic' : 'standalone_diagnostic',
        primitiveSequence: [{ type: 'diagnostic_prompt', action: 'submit_response', props: { prompt, responseFormat: 'short_text', assistance: 'none' } }],
        requiredAction: { kind: 'submit_response', label: 'Save response' },
        evaluationContract: { version: 'learn-adaptive.evaluation.v1', kind: 'learner_response', responseFormat: 'short_text', passingScorePercent: null },
        accessibilityMetadata: { heading: 'Your starting point', instructions: 'Write what you know or want to check. This is not scored.', focusTargetTestId: 'learn-primitive-diagnostic-prompt', liveRegionMode: 'polite' },
        pins: { learningVoidId: null, blueprintRevisionId: null, objectiveId: null, sessionContentId: null },
        evidenceReferences: [],
        generationInputs: { sessionContentRevision: null, sessionContentInputDigest: null, generatorVersion: null },
        decisionInputs: { intentRevision: thread.revision, routerVersion: DIAGNOSTIC_ROUTER_VERSION,
          availableTime: thread.availableTime, sourceState, sourceInputs: [],
          priorActivityId: null, priorAttemptId: null, priorOutcome: null, assistance: 'none', confidence: null },
      })
      const now = Date.now()
      const activityDocumentId = await commandCtx.db.insert('learningThreadActivities', {
        userId, threadId: thread._id, activityId, boundaryOrdinal: 1, planRevision: 1,
        activityClass: 'non_factual', status: 'eligible', planVersion: composed.planVersion,
        replayVersion: composed.replayVersion, contractVersion: composed.contractVersion,
        rendererVersion: composed.rendererVersion, validationVersion: composed.validationVersion,
        sequenceValidationVersion: composed.sequenceValidationVersion, fallbackVersion: composed.fallbackVersion,
        intent: composed.intent, objectiveId: null, purpose: composed.purpose, reasonCode: composed.reasonCode,
        reasonText: reasonTextForActivity({ activityClass: 'non_factual', purpose: composed.purpose, reasonCode: composed.reasonCode, sourceState }),
        primitivePlan: composed.primitivePlan, requiredAction: composed.requiredAction,
        evaluationContract: composed.evaluationContract, fallback: composed.fallback,
        accessibilityMetadata: composed.accessibilityMetadata, learningVoidId: null, blueprintRevisionId: null,
        sessionContentId: null, evidenceReferences: [], generationInputs: composed.generationInputs,
        decisionInputs: composed.decisionInputs, replacesActivityId: null,
        canonicalInputSnapshot: composed.canonicalInputSnapshot, inputDigest: composed.inputDigest,
        createdAt: now, updatedAt: now,
      })
      const revision = thread.revision + 1
      await commandCtx.db.patch(thread._id, { currentActivityId: activityDocumentId,
        lifecycle: sourceState === 'preparing' ? 'preparing' : 'active', revision, updatedAt: now })
      const readyOpportunity = sourceState === 'none' || sourceState === 'ready'
      const preparingOpportunity = sourceState === 'preparing'
      await writeLearnActivityEvent(commandCtx, { userId, threadId: thread._id, activityId: activityDocumentId,
        eventType: 'thread_command_committed', eventVersion: 'thread_command_committed.v1',
        sourceVersion: composed.planVersion, contractVersion: composed.contractVersion,
        metricDefinitionVersion: 'first_value.v1', semanticKey: `thread:${String(thread._id)}:opportunity:1:command`,
        occurredAt: now, reasonCode: readyOpportunity ? 'standalone_diagnostic_ready' : preparingOpportunity ? 'standalone_diagnostic_preparing' : 'standalone_diagnostic_blocked',
        outcomeCode: readyOpportunity ? 'ready_content' : preparingOpportunity ? 'preparing' : 'excluded',
        metadata: { activityClass: 'non_factual', boundaryOrdinal: 1, planRevision: 1, opportunityOrdinal: 1,
          firstValueEligibility: readyOpportunity ? 'ready_standalone_non_factual' : preparingOpportunity ? 'preparing' : 'excluded',
          ...(!readyOpportunity && !preparingOpportunity ? { firstValueExclusionCode: 'evidence_blocked_at_commit' as const } : {}),
          cohort: 'adaptive_experience_entitled' } })
      await writeLearnActivityEvent(commandCtx, { userId, threadId: thread._id, activityId: activityDocumentId,
        eventType: 'activity_eligible', eventVersion: 'activity_eligible.v1', sourceVersion: composed.planVersion,
        contractVersion: composed.contractVersion, semanticKey: `activity:${activityId}:eligible`, occurredAt: now,
        reasonCode: composed.reasonCode, outcomeCode: 'eligible', metadata: { activityClass: 'non_factual', boundaryOrdinal: 1, planRevision: 1 } })
      return { value: { status: 'eligible' as const, activityId }, revision }
    },
  }),
})

// The client calls this only after the registered prompt and enabled save
// action are mounted. Repeated acknowledgements are deduped by semantic key.
export const recordDiagnosticRendered = mutation({
  args: { threadId: v.id('learningThreads'), activityId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveMutationAccess(ctx)
    const thread = await ctx.db.get(args.threadId)
    if (!thread || thread.userId !== userId || thread.authorityKind !== 'standalone' || thread.deletionStartedAt !== undefined) throw new Error('Diagnostic is unavailable')
    const activity = thread.currentActivityId && await ctx.db.get(thread.currentActivityId)
    if (!activity || activity.userId !== userId || activity.threadId !== thread._id || activity.activityId !== args.activityId
      || activity.activityClass !== 'non_factual' || !['eligible', 'started', 'submitted'].includes(activity.status)
      || activity.boundaryOrdinal !== 1 || activity.planRevision !== 1
      || activity.activityId !== `diagnostic:${String(thread._id)}`
      || activity.decisionInputs.routerVersion !== DIAGNOSTIC_ROUTER_VERSION
      || activity.evidenceReferences.length !== 0 || activity.sessionContentId !== null
      || activity.primitivePlan.length !== 1 || activity.primitivePlan[0]?.type !== 'diagnostic_prompt'
      || activity.primitivePlan[0].action !== 'submit_response' || activity.requiredAction.kind !== 'submit_response'
      || activity.requiredAction.label !== 'Save response' || activity.evaluationContract.kind !== 'learner_response'
      || !(await replayAdaptiveActivityPlan(storedPlan(activity))).ok) throw new Error('Operable diagnostic is unavailable')
    const now = Date.now()
    if (activity.status === 'eligible') await ctx.db.patch(activity._id, { status: 'started', updatedAt: now })
    const result = await recordDiagnosticStartEvents(ctx, userId, thread, activity, now)
    return { status: 'recorded' as const, replayed: result.replayed }
  },
})

export const getDiagnosticCanvas = query({
  args: { threadId: v.id('learningThreads') },
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveQueryAccess(ctx)
    const thread = await ctx.db.get(args.threadId)
    if (!thread || thread.userId !== userId || thread.authorityKind !== 'standalone' || thread.deletionStartedAt !== undefined) return null
    const owner = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique()
    if (!owner) return null
    const activity = thread.currentActivityId && await ctx.db.get(thread.currentActivityId)
    const evidenceState = await liveEvidenceState(ctx, thread)
    const recovery = adaptiveRecoveryCopy(evidenceState)
    if (!activity) return { ownerId: owner._id, thread: { id: thread._id, outcome: thread.outcome ?? thread.originalNeed, intent: thread.intent, revision: thread.revision }, status: 'draft' as const, evidenceState, recovery, decisionPending: !thread.initialDecision || thread.initialDecision.status === 'pending', activity: null }
    if (activity.userId !== userId || activity.threadId !== thread._id || activity.activityClass !== 'non_factual') return null
    const primitive = await isOperableDiagnosticActivity(activity) ? activity.primitivePlan[0] : null
    const selectedOverride = await ctx.db.query('learnActivityOverrides')
      .withIndex('by_userId_and_activityId_and_createdAt', q => q.eq('userId', userId).eq('activityId', activity._id))
      .order('desc').first()
    return { ownerId: owner._id, thread: { id: thread._id, outcome: thread.outcome ?? thread.originalNeed, intent: thread.intent, revision: thread.revision },
      status: primitive ? activity.status : 'blocked', evidenceState, recovery, decisionPending: false,
      activity: { id: activity.activityId, status: activity.status, planRevision: activity.planRevision, primitive,
        controls: projectAdaptiveControls({ activityClass: 'non_factual', activityStatus: primitive ? activity.status : 'blocked', lifecycle: thread.lifecycle,
          evidenceReady: evidenceState === 'ready', sourceCount: 0, currentTime: thread.availableTime,
          selected: selectedOverride?.option, fixedNextPlan: selectedOverride?.fixedNextPlan, reasonText: activity.reasonText,
          purpose: activity.purpose, reasonCode: activity.reasonCode, sourceState: activity.decisionInputs.sourceState }),
        response: activity.submittedResponse ?? null, fallback: activity.fallback, requiredAction: activity.requiredAction } }
  },
})

export const submitDiagnosticResponse = mutation({
  args: { threadId: v.id('learningThreads'), activityId: v.string(), expectedRevision: v.number(), response: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    const response = args.response.trim()
    if (!response || new TextEncoder().encode(response).byteLength > 12_000) throw new Error('Diagnostic response must be between 1 and 12000 bytes')
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(response))
    const responseHash = `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`
    return await executeAdaptiveThreadCommand(ctx, {
      threadId: args.threadId, expectedRevision: args.expectedRevision, idempotencyKey: args.idempotencyKey,
      commandName: 'submitStandaloneDiagnostic', payload: { activityId: args.activityId, responseHash },
      apply: async (commandCtx, thread, userId) => {
        const activity = thread.currentActivityId && await commandCtx.db.get(thread.currentActivityId)
        if (!activity || activity.userId !== userId || activity.threadId !== thread._id || activity.activityId !== args.activityId
          || activity.activityClass !== 'non_factual' || !['eligible', 'started'].includes(activity.status)
          || activity.boundaryOrdinal !== 1 || activity.activityId !== `diagnostic:${String(thread._id)}`
          || activity.decisionInputs.routerVersion !== DIAGNOSTIC_ROUTER_VERSION
          || activity.primitivePlan.length !== 1 || activity.primitivePlan[0]?.type !== 'diagnostic_prompt'
          || activity.evaluationContract.kind !== 'learner_response') throw new Error('Diagnostic response boundary is unavailable')
        if (!(await replayAdaptiveActivityPlan(storedPlan(activity))).ok) throw new Error('Diagnostic plan cannot be replayed')
        const now = Date.now()
        // A valid saved response proves this registered activity was operable,
        // even if its earlier nonblocking render acknowledgement was delayed.
        await recordDiagnosticStartEvents(commandCtx, userId, thread, activity, now)
        await commandCtx.db.patch(activity._id, { status: 'submitted', submittedResponse: response, updatedAt: now })
        const revision = thread.revision + 1
        await commandCtx.db.patch(thread._id, { lifecycle: 'active', revision, updatedAt: now })
        await writeLearnActivityEvent(commandCtx, { userId, threadId: thread._id, activityId: activity._id,
          eventType: 'meaningful_response', eventVersion: 'meaningful_response.v1', sourceVersion: activity.planVersion,
          contractVersion: activity.contractVersion, semanticKey: `activity:${activity.activityId}:response`, occurredAt: now,
          reasonCode: 'diagnostic_response_saved', outcomeCode: 'submitted', metadata: { activityClass: 'non_factual', boundaryOrdinal: activity.boundaryOrdinal, planRevision: activity.planRevision } })
        await writeLearnActivityEvent(commandCtx, { userId, threadId: thread._id, activityId: activity._id,
          eventType: 'activity_completed', eventVersion: 'activity_completed.v1', sourceVersion: activity.planVersion,
          contractVersion: activity.contractVersion, semanticKey: `activity:${activity.activityId}:completed`, occurredAt: now,
          reasonCode: 'diagnostic_response_saved', outcomeCode: 'completed',
          metadata: { activityClass: 'non_factual', boundaryOrdinal: activity.boundaryOrdinal, planRevision: activity.planRevision } })
        return { value: { status: 'submitted' as const, activityId: activity.activityId }, revision }
      },
    })
  },
})
