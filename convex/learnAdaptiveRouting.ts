import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { executeAdaptiveThreadCommand, AdaptiveCommandRejection } from './learnAdaptiveCommands'
import { requireAdaptiveQueryAccess } from './lib/adaptiveLearnAccess'
import { isOperableDiagnosticActivity, liveEvidenceState } from './learnAdaptiveRecovery'
import { loadReadyCanvas } from './learnAdaptiveCanvas'
import { representativeCompletion } from './learnAdaptive'
import { hasLearnActivityEvent, writeLearnActivityEvent } from './lib/learnAdaptiveEvents'
import { getScopedMasteryRecord } from './lib/learnV2MasteryScope'
import { canonicalAdaptiveActivityJson } from '../shared/learn-adaptive-activity-plan'
import { ADAPTIVE_ROUTER_VERSION, routeAdaptiveNextActivity, type AdaptiveRouterInput, type AdaptiveRouterResult } from '../shared/learn-adaptive-router'

const MAX_SNAPSHOT_BYTES = 8_192
const ROUTING_DECISION_CONTRACT_VERSION = 'learn-adaptive.routing-decision.v1'

type DecisionValue = {
  decisionId: string
  activityId: string
  routerVersion: typeof ADAPTIVE_ROUTER_VERSION
  status: AdaptiveRouterResult['status']
  selectedActivity: AdaptiveRouterResult['recommendation']
  reasonCode: AdaptiveRouterResult['reasonCode']
  fallback: AdaptiveRouterResult['fallback']
  overrides: AdaptiveRouterResult['overrides']
}

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return `sha256:${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

function decisionValue(row: Doc<'learnActivityDecisions'>): DecisionValue {
  return { decisionId: String(row._id), activityId: row.activityId, routerVersion: row.routerVersion,
    status: row.status, selectedActivity: row.selectedActivity, reasonCode: row.reasonCode as AdaptiveRouterResult['reasonCode'],
    fallback: JSON.parse(row.fallback) as AdaptiveRouterResult['fallback'],
    overrides: JSON.parse(row.overrideMetadata) as AdaptiveRouterResult['overrides'] }
}

async function decisionReplays(row: Doc<'learnActivityDecisions'>): Promise<boolean> {
  if (!Number.isSafeInteger(row.boundaryOrdinal) || row.boundaryOrdinal < 1 || row.boundaryOrdinal > 1_000_000
    || row.activityId !== `route_${String(row.threadId)}_${row.boundaryOrdinal}`
    || row.resultRevision !== row.targetRevision + 1
    || new TextEncoder().encode(row.inputSnapshot).byteLength > MAX_SNAPSHOT_BYTES
    || await digest(row.inputSnapshot) !== row.inputDigest) return false
  try {
    const parsed = JSON.parse(row.inputSnapshot) as AdaptiveRouterInput
    if (canonicalAdaptiveActivityJson(parsed) !== row.inputSnapshot) return false
    const routed = routeAdaptiveNextActivity(parsed)
    return routed.routerVersion === row.routerVersion && routed.status === row.status
      && canonicalAdaptiveActivityJson(routed.recommendation) === canonicalAdaptiveActivityJson(row.selectedActivity)
      && routed.reasonCode === row.reasonCode && canonicalAdaptiveActivityJson(routed.fallback) === row.fallback
      && canonicalAdaptiveActivityJson(routed.overrides) === row.overrideMetadata
  }
  catch { return false }
}

export const decideNextActivity = mutation({
  args: { threadId: v.id('learningThreads'), expectedRevision: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => await executeAdaptiveThreadCommand<DecisionValue>(ctx, {
    ...args, commandName: 'decideNextActivity', payload: {}, returnBlockedWhenDeleting: true,
    replayExpiredResult: async (commandCtx, receipt, userId) => {
      const decision = await commandCtx.db.query('learnActivityDecisions')
        .withIndex('by_userId_and_idempotencyKeyHash', q => q.eq('userId', userId).eq('idempotencyKeyHash', receipt.idempotencyKeyHash)).unique()
      if (!decision || decision.threadId !== receipt.threadId || decision.targetRevision !== receipt.targetRevision
        || decision.resultRevision <= receipt.targetRevision || !(await decisionReplays(decision))) return null
      return { kind: 'ok', value: decisionValue(decision), revision: decision.resultRevision, receiptId: String(receipt._id) }
    },
    apply: async (commandCtx, thread, userId, command) => {
      if (thread.initialDecision?.status === 'pending') throw new AdaptiveCommandRejection('blocked', 'clarification_pending', 'Resolve the initial clarification before routing')
      if (thread.lifecycle !== 'ready' && thread.lifecycle !== 'active') throw new AdaptiveCommandRejection('blocked', 'thread_unavailable', 'Thread is not ready for routing')
      const activity = thread.currentActivityId && await commandCtx.db.get(thread.currentActivityId)
      if (thread.currentActivityId && (!activity || activity.userId !== userId || activity.threadId !== thread._id))
        throw new AdaptiveCommandRejection('blocked', 'routing_boundary_unavailable', 'Current activity authority is unavailable')
      if (thread.authorityKind === 'standalone' && activity && (activity.status !== 'submitted'
        || !(await isOperableDiagnosticActivity(activity))
        || !(await hasLearnActivityEvent(commandCtx, userId, activity._id, 'activity_completed'))))
        throw new AdaptiveCommandRejection('blocked', 'routing_boundary_unavailable', 'The current activity is not complete')
      if (thread.authorityKind === 'v2_mission' && (!activity || activity.activityClass !== 'factual'))
        throw new AdaptiveCommandRejection('blocked', 'routing_boundary_unavailable', 'Pinned factual activity authority is unavailable')
      const latest = await commandCtx.db.query('learningThreadActivities')
        .withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', userId).eq('threadId', thread._id))
        .order('desc').first()
      if (latest?._id !== (activity?._id ?? undefined)) throw new AdaptiveCommandRejection('blocked', 'routing_boundary_unavailable', 'The current activity boundary is unavailable')
      let sourceState = await liveEvidenceState(commandCtx, thread)
      let sourceInputs: AdaptiveRouterInput['sourceInputs'] = []
      let pins: AdaptiveRouterInput['pins'] = { learningVoidId: null, blueprintRevisionId: null, blueprintRecordRevision: null,
        objectiveId: null, sessionContentId: null, sessionContentRevision: null }
      let priorActivity: AdaptiveRouterInput['priorActivity'] = activity ? { activityId: activity.activityId, primitive: 'diagnostic_prompt', activityClass: 'non_factual',
        outcome: 'completed', attemptId: null, attemptKind: null, assistance: 'none', confidence: null, masteryTransition: null } : null
      let mastery: AdaptiveRouterInput['mastery'] = null
      if (thread.authorityKind === 'v2_mission' && activity) {
        const canvas = await loadReadyCanvas(commandCtx, userId, thread._id)
        if (!canvas || !activity.learningVoidId || !activity.blueprintRevisionId || !activity.objectiveId || !activity.sessionContentId
          || thread.learningVoidId !== activity.learningVoidId || activity.evidenceReferences.length < 1 || activity.evidenceReferences.length > 16)
          throw new AdaptiveCommandRejection('blocked', 'factual_authority_unavailable', 'Pinned factual authority is unavailable')
        const [learningVoid, blueprint, objective, content] = await Promise.all([
          commandCtx.db.get(activity.learningVoidId), commandCtx.db.get(activity.blueprintRevisionId),
          commandCtx.db.get(activity.objectiveId), commandCtx.db.get(activity.sessionContentId),
        ])
        if (!learningVoid || !blueprint || !objective || !content || learningVoid.userId !== userId
          || blueprint.userId !== userId || objective.userId !== userId || content.userId !== userId
          || blueprint.learningVoidId !== learningVoid._id || objective.blueprintRevisionId !== blueprint._id
          || content.blueprintRevisionId !== blueprint._id || content.objectiveId !== objective._id
          || activity.generationInputs.sessionContentRevision === null)
          throw new AdaptiveCommandRejection('blocked', 'factual_authority_unavailable', 'Pinned factual authority is unavailable')
        pins = { learningVoidId: String(learningVoid._id), blueprintRevisionId: String(blueprint._id),
          blueprintRecordRevision: blueprint.recordRevision, objectiveId: String(objective._id),
          sessionContentId: String(content._id), sessionContentRevision: activity.generationInputs.sessionContentRevision }
        const sourceMap = new Map<string, { sourceSnapshotId: string, effectiveStatus: 'user_accepted', recordRevision: number }>()
        let sourceStale = false
        for (const reference of activity.evidenceReferences) {
          const sourceSnapshotId = String(reference.sourceSnapshotId)
          const existing = sourceMap.get(sourceSnapshotId)
          if (existing && existing.recordRevision !== reference.sourceRecordRevision)
            throw new AdaptiveCommandRejection('invalid', 'factual_source_pins_invalid', 'Pinned source revisions disagree')
          sourceMap.set(sourceSnapshotId, { sourceSnapshotId, effectiveStatus: 'user_accepted', recordRevision: reference.sourceRecordRevision })
          const source = await commandCtx.db.get(reference.sourceSnapshotId)
          if (!source || source.userId !== userId || source.learningVoidId !== learningVoid._id || source.blueprintRevisionId !== blueprint._id
            || source.status !== 'user_accepted' || source.effectiveStatus !== 'user_accepted'
            || source.recordRevision !== reference.sourceRecordRevision || source.evidencePurgedAt !== undefined
            || source.rightsStatus !== 'permitted' || source.conflictStatus !== 'clear') sourceStale = true
        }
        sourceInputs = [...sourceMap.values()].sort((a, b) => a.sourceSnapshotId < b.sourceSnapshotId ? -1 : a.sourceSnapshotId > b.sourceSnapshotId ? 1 : 0)
        if (sourceState === 'ready') sourceState = sourceStale ? 'stale' : canvas.status === 'blocked' ? canvas.recoveryState ?? 'blocked' : 'ready'
        const { record: masteryRecord } = await getScopedMasteryRecord(commandCtx, userId, blueprint._id, objective._id)
        mastery = masteryRecord ? { scope: 'revision_scoped', blueprintRevisionId: String(blueprint._id),
          objectiveId: String(objective._id), state: masteryRecord.state } : null
        if (activity.status === 'feedback') {
          const completion = await representativeCompletion(commandCtx, userId, activity)
          const attempt = activity.masteryAttemptId && await commandCtx.db.get(activity.masteryAttemptId)
          if (!completion || !attempt || !masteryRecord || masteryRecord.lastAttemptId !== attempt._id
            || (attempt.kind !== 'independent_application' && attempt.kind !== 'retained_transfer')
            || !attempt.masteryStateBefore || !attempt.masteryStateAfter || !attempt.masteryTransitionReason
            || attempt.masteryTransitionVersion !== 'learn-v2.mastery-transition.v1'
            || attempt.masteryStateAfter !== masteryRecord.state)
            throw new AdaptiveCommandRejection('blocked', 'representative_authority_unavailable', 'Representative attempt authority is unavailable')
          priorActivity = { activityId: activity.activityId, primitive: 'independent_application', activityClass: 'factual',
            outcome: completion.status === 'passed' ? 'representative_pass' : 'representative_fail',
            attemptId: String(attempt._id), attemptKind: attempt.kind,
            assistance: attempt.usedReveal ? 'reveal' : attempt.usedHint ? 'hint' : 'none',
            confidence: attempt.confidence === undefined ? null : { scale: 'v2_1_5', value: attempt.confidence },
            masteryTransition: { attemptId: String(attempt._id), attemptKind: attempt.kind,
              stateBefore: attempt.masteryStateBefore, stateAfter: attempt.masteryStateAfter,
              reason: attempt.masteryTransitionReason, version: attempt.masteryTransitionVersion } }
        }
        else priorActivity = { activityId: activity.activityId, primitive: activity.primitivePlan[0]?.type ?? 'cited_explanation',
          activityClass: 'factual', outcome: 'incomplete', attemptId: null, attemptKind: null,
          assistance: 'none', confidence: null, masteryTransition: null }
      }
      const input: AdaptiveRouterInput = {
        routerVersion: ADAPTIVE_ROUTER_VERSION, threadState: thread.lifecycle, authorityKind: thread.authorityKind,
        intent: thread.intent, intentRevision: thread.revision, sourceState, sourceInputs, pins,
        availableTime: thread.availableTime, priorActivity, mastery,
      }
      const inputSnapshot = canonicalAdaptiveActivityJson(input)
      if (new TextEncoder().encode(inputSnapshot).byteLength > MAX_SNAPSHOT_BYTES) throw new AdaptiveCommandRejection('invalid', 'routing_snapshot_oversized', 'Routing snapshot exceeds its limit')
      const routed = routeAdaptiveNextActivity(input)
      const priorDecision = await commandCtx.db.query('learnActivityDecisions')
        .withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', userId).eq('threadId', thread._id))
        .order('desc').first()
      if (priorDecision) {
        if (!(await decisionReplays(priorDecision))) throw new AdaptiveCommandRejection('invalid', 'routing_decision_integrity', 'Prior routing decision integrity failed')
        const previousInput = JSON.parse(priorDecision.inputSnapshot) as AdaptiveRouterInput
        const selectedActivityReached = priorDecision.status === 'recommended'
          && activity?.activityId === priorDecision.activityId
          && activity.boundaryOrdinal === priorDecision.boundaryOrdinal
          && activity.activityClass === priorDecision.selectedActivity?.activityClass
          && activity.primitivePlan[0]?.type === priorDecision.selectedActivity?.primitive
        if (!selectedActivityReached && (priorDecision.status !== 'blocked'
          || canonicalAdaptiveActivityJson({ ...previousInput, intentRevision: input.intentRevision }) === inputSnapshot))
          throw new AdaptiveCommandRejection('blocked', 'routing_boundary_recorded', 'This routing boundary is already recorded')
      }
      const boundaryOrdinal = Math.max(activity?.boundaryOrdinal ?? 0, priorDecision?.boundaryOrdinal ?? 0) + 1
      if (!Number.isSafeInteger(boundaryOrdinal) || boundaryOrdinal < 1 || boundaryOrdinal > 1_000_000)
        throw new AdaptiveCommandRejection('invalid', 'routing_boundary_invalid', 'The next activity boundary is invalid')
      const activityId = `route_${String(thread._id)}_${boundaryOrdinal}`
      const existing = await commandCtx.db.query('learnActivityDecisions')
        .withIndex('by_userId_and_activityId_and_createdAt', q => q.eq('userId', userId).eq('activityId', activityId)).first()
      if (existing) throw new AdaptiveCommandRejection('blocked', 'routing_boundary_recorded', 'This activity boundary already has a routing decision')
      const now = Date.now()
      const revision = thread.revision + 1
      const decisionId = await commandCtx.db.insert('learnActivityDecisions', {
        userId, threadId: thread._id, activityId, boundaryOrdinal, routerVersion: routed.routerVersion,
        inputSnapshot, inputDigest: await digest(inputSnapshot), status: routed.status,
        selectedActivity: routed.recommendation, reasonCode: routed.reasonCode,
        fallback: canonicalAdaptiveActivityJson(routed.fallback), overrideMetadata: canonicalAdaptiveActivityJson(routed.overrides),
        targetRevision: thread.revision, resultRevision: revision, idempotencyKeyHash: command.idempotencyKeyHash, createdAt: now,
      })
      await commandCtx.db.patch(thread._id, { revision, updatedAt: now })
      await writeLearnActivityEvent(commandCtx, { userId, threadId: thread._id,
        eventType: 'routing_decision', eventVersion: 'routing_decision.v1',
        sourceVersion: routed.routerVersion, contractVersion: ROUTING_DECISION_CONTRACT_VERSION,
        semanticKey: `routing:${activityId}`, occurredAt: now, reasonCode: routed.reasonCode,
        outcomeCode: routed.status, metadata: { ...(routed.recommendation ? { activityClass: routed.recommendation.activityClass } : {}), boundaryOrdinal } })
      return { value: { decisionId: String(decisionId), activityId, routerVersion: routed.routerVersion,
        status: routed.status, selectedActivity: routed.recommendation, reasonCode: routed.reasonCode,
        fallback: routed.fallback, overrides: routed.overrides }, revision }
    },
  }),
})

export const replayDecision = query({
  args: { decisionId: v.id('learnActivityDecisions') },
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveQueryAccess(ctx)
    const row = await ctx.db.get(args.decisionId)
    if (!row || row.userId !== userId) return null
    if (!(await decisionReplays(row))) return { status: 'integrity_failed' as const }
    return { status: 'replayed' as const, value: decisionValue(row) }
  },
})
