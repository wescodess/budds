import { v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { requireAdaptiveMutationAccess, requireAdaptiveQueryAccess } from './lib/adaptiveLearnAccess'
import { hasLearnActivityEvent, writeLearnActivityEvent } from './lib/learnAdaptiveEvents'
import { isOperableDiagnosticActivity, liveEvidenceState } from './learnAdaptiveRecovery'
import { loadReadyCanvas } from './learnAdaptiveCanvas'
import { representativeCompletion } from './learnAdaptive'
import { getScopedMasteryRecord } from './lib/learnV2MasteryScope'
import { canonicalAdaptiveActivityJson } from '../shared/learn-adaptive-activity-plan'
import {
  ADAPTIVE_ROUTING_ANALYSIS_VERSION,
  ADAPTIVE_ROUTING_ASSIGNMENT_CONTRACT_VERSION,
  ADAPTIVE_ROUTING_ELIGIBILITY_VERSION,
  ADAPTIVE_ROUTING_EXCLUSION_VERSION,
  ADAPTIVE_ROUTING_ASSIGNMENT_UNIT,
  ADAPTIVE_ROUTING_ROLLBACK_SIGNAL_VERSION,
  adaptiveRoutingAnalysisPlanValidator,
  validateAdaptiveRoutingAnalysisPlan,
} from '../shared/learn-adaptive-experiment'

const ANALYSIS_VERSION = ADAPTIVE_ROUTING_ANALYSIS_VERSION
const APPROVAL_CODE = /^[a-z0-9][a-z0-9._:-]{0,127}$/
const SNAPSHOT_KEY = /^[a-z0-9][a-z0-9_-]{0,95}$/
const SNAPSHOT_SOURCE_VERSION = /^[a-z0-9][a-z0-9._:-]{0,95}$/
const EVIDENCE_DIGEST = /^sha256:[a-f0-9]{64}$/
const EXPERIMENT_METADATA_VERSIONS = {
  experimentAnalysisVersion: ANALYSIS_VERSION,
  experimentEligibilityVersion: ADAPTIVE_ROUTING_ELIGIBILITY_VERSION,
  experimentExclusionVersion: ADAPTIVE_ROUTING_EXCLUSION_VERSION,
  experimentAssignmentUnit: ADAPTIVE_ROUTING_ASSIGNMENT_UNIT,
}
const guardrailObservationValidator = v.object({
  adaptiveSuccesses: v.number(), adaptiveEligible: v.number(),
  fixedSuccesses: v.number(), fixedEligible: v.number(),
})

type GuardrailObservation = {
  adaptiveSuccesses: number
  adaptiveEligible: number
  fixedSuccesses: number
  fixedEligible: number
}

function validateObservation(observation: GuardrailObservation) {
  const { adaptiveSuccesses, adaptiveEligible, fixedSuccesses, fixedEligible } = observation
  if ([adaptiveSuccesses, adaptiveEligible, fixedSuccesses, fixedEligible].some(value => !Number.isSafeInteger(value) || value < 0 || value > 1_000_000)
    || adaptiveSuccesses > adaptiveEligible || fixedSuccesses > fixedEligible)
    throw new Error('Adaptive experiment guardrail counts are invalid')
}

function degradedByMoreThanThreePoints(observation: GuardrailObservation) {
  const { adaptiveSuccesses, adaptiveEligible, fixedSuccesses, fixedEligible } = observation
  return adaptiveEligible > 0 && fixedEligible > 0
    && 100 * (fixedSuccesses * adaptiveEligible - adaptiveSuccesses * fixedEligible)
      > 3 * fixedEligible * adaptiveEligible
}

function rollbackSignalValue(row: Doc<'learnAdaptiveExperimentRollbacks'>) {
  return { signalId: String(row._id), version: row.signalVersion, analysisVersion: ANALYSIS_VERSION,
    action: row.action, cohort: row.cohort, delivery: row.delivery, reasons: row.reasons,
    triggerEvaluationId: String(row.triggerEvaluationId), triggeredAt: row.triggeredAt }
}

function guardrailValue(row: Doc<'learnAdaptiveExperimentGuardrailEvaluations'>,
  rollback: Doc<'learnAdaptiveExperimentRollbacks'> | null = null) {
  return { analysisVersion: ANALYSIS_VERSION, status: row.status,
    rollbackTrigger: row.rollbackTrigger, reasons: row.reasons,
    rollbackSignal: rollback ? rollbackSignalValue(rollback) : null }
}

export const getRollbackSignal = internalQuery({
  args: { analysisVersion: v.literal(ANALYSIS_VERSION) },
  handler: async (ctx, args) => {
    const plan = await ctx.db.query('learnAdaptiveExperimentPlans')
      .withIndex('by_version', q => q.eq('version', args.analysisVersion)).unique()
    if (!plan) return null
    const rollback = await ctx.db.query('learnAdaptiveExperimentRollbacks')
      .withIndex('by_planId', q => q.eq('planId', plan._id)).unique()
    return rollback ? rollbackSignalValue(rollback) : null
  },
})

async function excludeFromExperiment(ctx: MutationCtx,
  args: { userId: string, threadId: Doc<'learningThreads'>['_id'], reason: 'analysis_unapproved' | 'analysis_contract_unsupported' | 'safety_prerequisite_missing' | 'guardrail_rollback' }) {
  await writeLearnActivityEvent(ctx, { userId: args.userId, threadId: args.threadId,
    eventType: 'experiment_assignment', eventVersion: 'experiment_assignment.v1',
    sourceVersion: ANALYSIS_VERSION, contractVersion: ADAPTIVE_ROUTING_ASSIGNMENT_CONTRACT_VERSION,
    semanticKey: `experiment:${ANALYSIS_VERSION}:excluded:${args.reason}`, occurredAt: Date.now(),
    reasonCode: args.reason, outcomeCode: 'excluded',
    metadata: { cohort: 'excluded', experimentEligibility: 'excluded',
      experimentExclusionCode: args.reason, ...EXPERIMENT_METADATA_VERSIONS },
  })
  return { kind: 'excluded' as const, reason: args.reason, analysisVersion: ANALYSIS_VERSION }
}

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return `sha256:${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export const freezeAnalysisPlan = internalMutation({
  args: { plan: adaptiveRoutingAnalysisPlanValidator },
  handler: async (ctx, args) => {
    validateAdaptiveRoutingAnalysisPlan(args.plan)
    const planDigest = await digest(canonicalAdaptiveActivityJson(args.plan))
    const prior = await ctx.db.query('learnAdaptiveExperimentPlans')
      .withIndex('by_version', q => q.eq('version', ANALYSIS_VERSION)).unique()
    if (prior) {
      if (prior.digest !== planDigest) throw new Error('Adaptive routing analysis is already frozen')
      return prior._id
    }
    return await ctx.db.insert('learnAdaptiveExperimentPlans', {
      version: ANALYSIS_VERSION, plan: args.plan, digest: planDigest, frozenAt: Date.now(),
    })
  },
})

export const recordApproval = internalMutation({
  args: {
    planId: v.id('learnAdaptiveExperimentPlans'),
    productAnalyticsReference: v.string(), productReference: v.string(),
    qaReference: v.string(), engineeringReference: v.string(),
  },
  handler: async (ctx, args) => {
    const plan = await ctx.db.get(args.planId)
    if (!plan || plan.version !== ANALYSIS_VERSION) throw new Error('Adaptive routing analysis is unavailable')
    validateAdaptiveRoutingAnalysisPlan(plan.plan)
    const { planId, ...references } = args
    if (Object.values(references).some(reference => !APPROVAL_CODE.test(reference)))
      throw new Error('Adaptive routing analysis approval reference is invalid')
    const prior = await ctx.db.query('learnAdaptiveExperimentApprovals')
      .withIndex('by_planId', q => q.eq('planId', planId)).unique()
    if (prior) {
      if (Object.entries(references).some(([key, value]) => prior[key as keyof typeof references] !== value))
        throw new Error('Adaptive routing analysis approval is already recorded')
      return prior._id
    }
    return await ctx.db.insert('learnAdaptiveExperimentApprovals', { planId, ...references, approvedAt: Date.now() })
  },
})

export const evaluateGuardrails = internalMutation({
  args: { planId: v.id('learnAdaptiveExperimentPlans'), snapshotKey: v.string(),
    evidenceDigest: v.string(), snapshotSourceVersion: v.string(),
    accessibility: guardrailObservationValidator, recovery: guardrailObservationValidator },
  handler: async (ctx, args) => {
    if (!SNAPSHOT_KEY.test(args.snapshotKey) || !SNAPSHOT_SOURCE_VERSION.test(args.snapshotSourceVersion)
      || !EVIDENCE_DIGEST.test(args.evidenceDigest)) throw new Error('Adaptive experiment snapshot provenance is invalid')
    const plan = await ctx.db.get(args.planId)
    const approval = plan && await ctx.db.query('learnAdaptiveExperimentApprovals')
      .withIndex('by_planId', q => q.eq('planId', plan._id)).unique()
    if (!plan || !approval || plan.version !== ANALYSIS_VERSION)
      throw new Error('Adaptive routing analysis is not approved')
    validateAdaptiveRoutingAnalysisPlan(plan.plan)
    validateObservation(args.accessibility)
    validateObservation(args.recovery)
    const snapshotDigest = await digest(canonicalAdaptiveActivityJson({
      accessibility: args.accessibility, recovery: args.recovery,
      evidenceDigest: args.evidenceDigest, snapshotSourceVersion: args.snapshotSourceVersion,
    }))
    const prior = await ctx.db.query('learnAdaptiveExperimentGuardrailEvaluations')
      .withIndex('by_planId_and_snapshotKey', q => q.eq('planId', args.planId).eq('snapshotKey', args.snapshotKey)).unique()
    let rollback = await ctx.db.query('learnAdaptiveExperimentRollbacks')
      .withIndex('by_planId', q => q.eq('planId', plan._id)).unique()
    if (prior) {
      if (prior.snapshotDigest !== snapshotDigest) throw new Error('Adaptive experiment guardrail snapshot conflicts with prior evaluation')
      return guardrailValue(prior, rollback)
    }
    const reasons: Array<'accessibility_degradation' | 'recovery_degradation'> = []
    if (degradedByMoreThanThreePoints(args.accessibility)) reasons.push('accessibility_degradation')
    if (degradedByMoreThanThreePoints(args.recovery)) reasons.push('recovery_degradation')
    const rollbackTrigger = reasons.length > 0
    const minSample = plan.plan.minimumSamplePerArm
    const insufficient = [args.accessibility, args.recovery].some(observation =>
      observation.adaptiveEligible < minSample || observation.fixedEligible < minSample)
    const status = rollbackTrigger ? 'non_qualifying' as const
      : insufficient ? 'insufficient_evidence' as const : 'guardrails_passed' as const
    const evaluationId = await ctx.db.insert('learnAdaptiveExperimentGuardrailEvaluations', {
      planId: plan._id, snapshotKey: args.snapshotKey, snapshotDigest,
      evidenceDigest: args.evidenceDigest, snapshotSourceVersion: args.snapshotSourceVersion,
      status, rollbackTrigger, reasons, evaluatedAt: Date.now(),
    })
    if (rollbackTrigger && !rollback) {
      const rollbackId = await ctx.db.insert('learnAdaptiveExperimentRollbacks', {
        planId: plan._id, triggerEvaluationId: evaluationId, triggeredAt: Date.now(), reasons,
        signalVersion: ADAPTIVE_ROUTING_ROLLBACK_SIGNAL_VERSION,
        action: 'disable_adaptive_exposure', cohort: 'adaptive', delivery: 'pending',
      })
      rollback = await ctx.db.get(rollbackId)
    }
    const row = await ctx.db.get(evaluationId)
    if (!row) throw new Error('Adaptive experiment guardrail evaluation was not recorded')
    return guardrailValue(row, rollback)
  },
})

const assignmentValue = (row: { cohort: 'adaptive' | 'fixed' }) => ({
  kind: 'assigned' as const, analysisVersion: ANALYSIS_VERSION,
  cohort: row.cohort, eligibility: 'eligible' as const,
})

async function hasExperimentSafetyPrerequisites(ctx: MutationCtx, thread: Doc<'learningThreads'>) {
  if (thread.deletionStartedAt !== undefined || (thread.lifecycle !== 'ready' && thread.lifecycle !== 'active')
    || thread.initialDecision?.status === 'pending') return false
  const sourceState = await liveEvidenceState(ctx, thread)
  if (sourceState !== 'none' && sourceState !== 'ready') return false
  const activity = thread.currentActivityId ? await ctx.db.get(thread.currentActivityId) : null
  if (thread.currentActivityId && (!activity || activity.userId !== thread.userId || activity.threadId !== thread._id)) return false
  const latest = await ctx.db.query('learningThreadActivities')
    .withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', thread.userId).eq('threadId', thread._id))
    .order('desc').first()
  if (latest?._id !== activity?._id) return false
  if (thread.authorityKind === 'standalone') {
    return !activity || activity.status === 'submitted' && await isOperableDiagnosticActivity(activity)
      && await hasLearnActivityEvent(ctx, thread.userId, activity._id, 'activity_completed')
  }
  if (sourceState !== 'ready' || !activity || activity.activityClass !== 'factual'
    || !activity.learningVoidId || !activity.blueprintRevisionId || !activity.objectiveId || !activity.sessionContentId
    || activity.evidenceReferences.length < 1 || activity.evidenceReferences.length > 16) return false
  const canvas = await loadReadyCanvas(ctx, thread.userId, thread._id)
  if (!canvas || (canvas.status !== 'ready' && canvas.status !== 'feedback')) return false
  for (const reference of activity.evidenceReferences) {
    const source = await ctx.db.get(reference.sourceSnapshotId)
    if (!source || source.userId !== thread.userId || source.learningVoidId !== activity.learningVoidId
      || source.blueprintRevisionId !== activity.blueprintRevisionId || source.recordRevision !== reference.sourceRecordRevision
      || source.status !== 'user_accepted' || source.effectiveStatus !== 'user_accepted'
      || source.evidencePurgedAt !== undefined || source.rightsStatus !== 'permitted' || source.conflictStatus !== 'clear') return false
  }
  if (activity.status === 'feedback') {
    const completion = await representativeCompletion(ctx, thread.userId, activity)
    const attempt = activity.masteryAttemptId ? await ctx.db.get(activity.masteryAttemptId) : null
    const { record: mastery } = await getScopedMasteryRecord(ctx, thread.userId, activity.blueprintRevisionId, activity.objectiveId)
    if (!completion || !attempt || !mastery || mastery.lastAttemptId !== attempt._id
      || (attempt.kind !== 'independent_application' && attempt.kind !== 'retained_transfer')
      || !attempt.masteryStateBefore || !attempt.masteryStateAfter || !attempt.masteryTransitionReason
      || attempt.masteryTransitionVersion !== 'learn-v2.mastery-transition.v1' || attempt.masteryStateAfter !== mastery.state) return false
  }
  return true
}

export const assignForThread = mutation({
  args: { threadId: v.id('learningThreads') },
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveMutationAccess(ctx)
    const thread = await ctx.db.get(args.threadId)
    if (!thread || thread.userId !== userId) throw new Error('Adaptive experiment thread access denied')
    if (process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED !== 'true')
      return { kind: 'excluded' as const, reason: 'experiment_disabled' as const, analysisVersion: ANALYSIS_VERSION }
    const plan = await ctx.db.query('learnAdaptiveExperimentPlans')
      .withIndex('by_version', q => q.eq('version', ANALYSIS_VERSION)).unique()
    const approval = plan && await ctx.db.query('learnAdaptiveExperimentApprovals')
      .withIndex('by_planId', q => q.eq('planId', plan._id)).unique()
    if (!plan || !approval) {
      return await excludeFromExperiment(ctx, { userId, threadId: thread._id, reason: 'analysis_unapproved' })
    }
    try { validateAdaptiveRoutingAnalysisPlan(plan.plan) }
    catch {
      return await excludeFromExperiment(ctx, { userId, threadId: thread._id, reason: 'analysis_contract_unsupported' })
    }
    const rollback = await ctx.db.query('learnAdaptiveExperimentRollbacks')
      .withIndex('by_planId', q => q.eq('planId', plan._id)).unique()
    if (rollback) {
      return await excludeFromExperiment(ctx, { userId, threadId: thread._id, reason: 'guardrail_rollback' })
    }
    if (!(await hasExperimentSafetyPrerequisites(ctx, thread))) {
      return await excludeFromExperiment(ctx, { userId, threadId: thread._id, reason: 'safety_prerequisite_missing' })
    }
    const prior = await ctx.db.query('learnAdaptiveExperimentAssignments')
      .withIndex('by_userId_and_analysisVersion', q => q.eq('userId', userId).eq('analysisVersion', ANALYSIS_VERSION)).unique()
    if (prior) return assignmentValue(prior)
    const hash = await digest(`${ANALYSIS_VERSION}:${userId}`)
    const cohort = Number.parseInt(hash.slice(7, 9), 16) % 2 === 0 ? 'adaptive' as const : 'fixed' as const
    const assignedAt = Date.now()
    await ctx.db.insert('learnAdaptiveExperimentAssignments', {
      userId, planId: plan._id, analysisVersion: ANALYSIS_VERSION, cohort, eligibility: 'eligible',
      eligibilityVersion: ADAPTIVE_ROUTING_ELIGIBILITY_VERSION, assignmentUnit: ADAPTIVE_ROUTING_ASSIGNMENT_UNIT,
      contractVersion: ADAPTIVE_ROUTING_ASSIGNMENT_CONTRACT_VERSION, assignedAt,
    })
    await writeLearnActivityEvent(ctx, { userId, threadId: thread._id,
      eventType: 'experiment_assignment', eventVersion: 'experiment_assignment.v1',
      sourceVersion: ANALYSIS_VERSION, contractVersion: ADAPTIVE_ROUTING_ASSIGNMENT_CONTRACT_VERSION,
      semanticKey: `experiment:${ANALYSIS_VERSION}`, occurredAt: assignedAt,
      outcomeCode: 'assigned', metadata: { cohort, experimentEligibility: 'eligible',
        ...EXPERIMENT_METADATA_VERSIONS },
    })
    return assignmentValue({ cohort })
  },
})

export const getMyStatus = query({
  args: { threadId: v.id('learningThreads') },
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveQueryAccess(ctx)
    const thread = await ctx.db.get(args.threadId)
    if (!thread || thread.userId !== userId) throw new Error('Adaptive experiment thread access denied')
    const assignment = await ctx.db.query('learnAdaptiveExperimentAssignments')
      .withIndex('by_userId_and_analysisVersion', q => q.eq('userId', userId).eq('analysisVersion', ANALYSIS_VERSION)).unique()
    return { analysisVersion: ANALYSIS_VERSION, exposure: 'off' as const,
      assignment: assignment ? assignmentValue(assignment) : null }
  },
})

export const getGuardrailStatus = query({
  args: { threadId: v.id('learningThreads') },
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveQueryAccess(ctx)
    const thread = await ctx.db.get(args.threadId)
    if (!thread || thread.userId !== userId) throw new Error('Adaptive experiment thread access denied')
    const assignment = await ctx.db.query('learnAdaptiveExperimentAssignments')
      .withIndex('by_userId_and_analysisVersion', q => q.eq('userId', userId).eq('analysisVersion', ANALYSIS_VERSION)).unique()
    if (!assignment) return null
    const rollback = await ctx.db.query('learnAdaptiveExperimentRollbacks')
      .withIndex('by_planId', q => q.eq('planId', assignment.planId)).unique()
    if (rollback) {
      const trigger = await ctx.db.get(rollback.triggerEvaluationId)
      if (trigger) return guardrailValue(trigger, rollback)
    }
    const latest = await ctx.db.query('learnAdaptiveExperimentGuardrailEvaluations')
      .withIndex('by_planId_and_evaluatedAt', q => q.eq('planId', assignment.planId)).order('desc').first()
    return latest ? guardrailValue(latest) : null
  },
})
