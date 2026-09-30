import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { requireAdaptiveMutationAccess, requireAdaptiveQueryAccess } from './lib/adaptiveLearnAccess'
import { writeLearnActivityEvent } from './lib/learnAdaptiveEvents'
import { canonicalAdaptiveActivityJson } from '../shared/learn-adaptive-activity-plan'
import {
  ADAPTIVE_ROUTING_ANALYSIS_VERSION,
  ADAPTIVE_ROUTING_ASSIGNMENT_CONTRACT_VERSION,
  adaptiveRoutingAnalysisPlanValidator,
  validateAdaptiveRoutingAnalysisPlan,
} from '../shared/learn-adaptive-experiment'

const ANALYSIS_VERSION = ADAPTIVE_ROUTING_ANALYSIS_VERSION
const APPROVAL_CODE = /^[a-z0-9][a-z0-9._:-]{0,127}$/
const SNAPSHOT_KEY = /^[a-z0-9][a-z0-9_-]{0,95}$/
const SNAPSHOT_SOURCE_VERSION = /^[a-z0-9][a-z0-9._:-]{0,95}$/
const EVIDENCE_DIGEST = /^sha256:[a-f0-9]{64}$/
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

function guardrailValue(row: Doc<'learnAdaptiveExperimentGuardrailEvaluations'>) {
  return { analysisVersion: ANALYSIS_VERSION, status: row.status,
    rollbackTrigger: row.rollbackTrigger, reasons: row.reasons }
}

async function writeExperimentExclusion(ctx: Parameters<typeof writeLearnActivityEvent>[0],
  args: { userId: string, threadId: Doc<'learningThreads'>['_id'], reason: 'analysis_unapproved' | 'safety_prerequisite_missing' | 'guardrail_rollback' }) {
  await writeLearnActivityEvent(ctx, { userId: args.userId, threadId: args.threadId,
    eventType: 'experiment_assignment', eventVersion: 'experiment_assignment.v1',
    sourceVersion: ANALYSIS_VERSION, contractVersion: ADAPTIVE_ROUTING_ASSIGNMENT_CONTRACT_VERSION,
    semanticKey: `experiment:${ANALYSIS_VERSION}:excluded:${args.reason}`, occurredAt: Date.now(),
    reasonCode: args.reason, outcomeCode: 'excluded',
    metadata: { cohort: 'excluded', experimentEligibility: 'excluded',
      experimentExclusionCode: args.reason, experimentAnalysisVersion: ANALYSIS_VERSION },
  })
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
    validateObservation(args.accessibility)
    validateObservation(args.recovery)
    const snapshotDigest = await digest(canonicalAdaptiveActivityJson({
      accessibility: args.accessibility, recovery: args.recovery,
      evidenceDigest: args.evidenceDigest, snapshotSourceVersion: args.snapshotSourceVersion,
    }))
    const prior = await ctx.db.query('learnAdaptiveExperimentGuardrailEvaluations')
      .withIndex('by_planId_and_snapshotKey', q => q.eq('planId', args.planId).eq('snapshotKey', args.snapshotKey)).unique()
    if (prior) {
      if (prior.snapshotDigest !== snapshotDigest) throw new Error('Adaptive experiment guardrail snapshot conflicts with prior evaluation')
      return guardrailValue(prior)
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
    if (rollbackTrigger) {
      const priorRollback = await ctx.db.query('learnAdaptiveExperimentRollbacks')
        .withIndex('by_planId', q => q.eq('planId', plan._id)).unique()
      if (!priorRollback) await ctx.db.insert('learnAdaptiveExperimentRollbacks', {
        planId: plan._id, triggerEvaluationId: evaluationId, triggeredAt: Date.now(),
      })
    }
    const row = await ctx.db.get(evaluationId)
    if (!row) throw new Error('Adaptive experiment guardrail evaluation was not recorded')
    return guardrailValue(row)
  },
})

const assignmentValue = (row: { cohort: 'adaptive' | 'fixed' }) => ({
  kind: 'assigned' as const, analysisVersion: ANALYSIS_VERSION,
  cohort: row.cohort, eligibility: 'eligible' as const,
})

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
      await writeExperimentExclusion(ctx, { userId, threadId: thread._id, reason: 'analysis_unapproved' })
      return { kind: 'excluded' as const, reason: 'analysis_unapproved' as const, analysisVersion: ANALYSIS_VERSION }
    }
    const rollback = await ctx.db.query('learnAdaptiveExperimentRollbacks')
      .withIndex('by_planId', q => q.eq('planId', plan._id)).unique()
    if (rollback) {
      await writeExperimentExclusion(ctx, { userId, threadId: thread._id, reason: 'guardrail_rollback' })
      return { kind: 'excluded' as const, reason: 'guardrail_rollback' as const, analysisVersion: ANALYSIS_VERSION }
    }
    if (thread.deletionStartedAt !== undefined || (thread.lifecycle !== 'ready' && thread.lifecycle !== 'active')
      || thread.initialDecision?.status === 'pending'
      || (thread.authorityKind === 'v2_mission' && thread.evidenceState !== 'ready')) {
      await writeExperimentExclusion(ctx, { userId, threadId: thread._id, reason: 'safety_prerequisite_missing' })
      return { kind: 'excluded' as const, reason: 'safety_prerequisite_missing' as const, analysisVersion: ANALYSIS_VERSION }
    }
    const prior = await ctx.db.query('learnAdaptiveExperimentAssignments')
      .withIndex('by_userId_and_analysisVersion', q => q.eq('userId', userId).eq('analysisVersion', ANALYSIS_VERSION)).unique()
    if (prior) return assignmentValue(prior)
    const hash = await digest(`${ANALYSIS_VERSION}:${userId}`)
    const cohort = Number.parseInt(hash.slice(7, 9), 16) % 2 === 0 ? 'adaptive' as const : 'fixed' as const
    const assignedAt = Date.now()
    await ctx.db.insert('learnAdaptiveExperimentAssignments', {
      userId, planId: plan._id, analysisVersion: ANALYSIS_VERSION, cohort, eligibility: 'eligible',
      contractVersion: ADAPTIVE_ROUTING_ASSIGNMENT_CONTRACT_VERSION, assignedAt,
    })
    await writeLearnActivityEvent(ctx, { userId, threadId: thread._id,
      eventType: 'experiment_assignment', eventVersion: 'experiment_assignment.v1',
      sourceVersion: ANALYSIS_VERSION, contractVersion: ADAPTIVE_ROUTING_ASSIGNMENT_CONTRACT_VERSION,
      semanticKey: `experiment:${ANALYSIS_VERSION}`, occurredAt: assignedAt,
      outcomeCode: 'assigned', metadata: { cohort, experimentEligibility: 'eligible',
        experimentAnalysisVersion: ANALYSIS_VERSION },
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
      if (trigger) return guardrailValue(trigger)
    }
    const latest = await ctx.db.query('learnAdaptiveExperimentGuardrailEvaluations')
      .withIndex('by_planId_and_evaluatedAt', q => q.eq('planId', assignment.planId)).order('desc').first()
    return latest ? guardrailValue(latest) : null
  },
})
