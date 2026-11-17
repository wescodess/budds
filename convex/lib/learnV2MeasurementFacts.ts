import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import {
  LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, learnReportAssignmentSnapshotSchema,
  learnReportFactSchema, learnReportSourceWatermarkSchema, learnReportWatermarkSnapshotSchema,
  deriveLearnReportLearnerKey,
  resolveLearnReportFirstSlotV2, qualifiesLearnReportFirstSlot,
  type LearnReportIndependentClaimV2, type LearnReportLinkedFirstSlot,
  type LearnReportSourceFact,
} from '../../shared/learn-v2-measurement-report'
import { LEARN_MEASUREMENT_STORAGE_VERSION } from '../../shared/learn-v2-measurement-storage-manifest'
import { LEARN_V2_ASSISTANCE_POLICY_VERSION, LEARN_V2_VALIDITY_POLICY_VERSION, parseLearnContract } from '../../shared/learn-v2-responses'
import { deriveLearnScorerConfiguration } from '../../shared/learn-v2-measurement'
import { masteryScopeKey } from './learnV2MasteryScope'
import { privacyDigest } from './learnV2ResponsePrivacy'

type FactInput = Omit<LearnReportSourceFact, 'factVersion' | 'sequence'> & {
  learningVoidId?: Id<'learningVoids'>
  expectedSequence?: number
}

export async function nextLearnMeasurementSourceSequence(ctx: QueryCtx | MutationCtx, userId: string) {
  const watermark = await ctx.db.query('learnMeasurementSourceWatermarks')
    .withIndex('by_userId', q => q.eq('userId', userId)).unique()
  if (watermark) parseLearnContract(learnReportSourceWatermarkSchema, {
    sourceVersion: watermark.sourceVersion, sequence: watermark.sequence, dueWorkThrough: watermark.dueWorkThrough,
    historyCoverage: watermark.historyCoverage, updatedAt: watermark.updatedAt,
  })
  const sequence = (watermark?.sequence ?? 0) + 1
  if (!Number.isSafeInteger(sequence)) throw new Error('Learn source sequence exhausted')
  return { watermark, sequence }
}

// Source writers call this in their mutation, after their own semantic replay.
export async function appendLearnMeasurementFact(ctx: MutationCtx, userId: string, input: FactInput) {
  const { watermark, sequence } = await nextLearnMeasurementSourceSequence(ctx, userId)
  if (input.expectedSequence !== undefined && input.expectedSequence !== sequence) throw new Error('Learn source sequence conflict')
  const value = parseLearnContract(learnReportFactSchema, {
    factVersion: LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, sequence,
    epoch: input.epoch, occurredAt: input.occurredAt, fact: input.fact,
  })
  const fact = value.fact
  const source = fact.kind === 'enrollment' ? await ctx.db.get(fact.assignmentId)
    : fact.kind === 'opportunity' ? await ctx.db.get(fact.assessmentOpportunityId)
      : fact.kind === 'independent_claim' || fact.kind === 'independent_claim_v2' ? await ctx.db.get(fact.basisAttemptId)
        : fact.kind === 'first_slot_link' ? await ctx.db.get(fact.slot.firstCheckOpportunityId)
          : await ctx.db.get(fact.submissionId)
  if (!source || source.userId !== userId
    || ('learningVoidId' in source && source.learningVoidId !== input.learningVoidId)) throw new Error('Learn fact scope mismatch')
  if (fact.kind === 'independent_claim_v2' || fact.kind === 'first_slot_link') {
    await validateFirstIndependentFact(ctx, userId, value, input.learningVoidId)
  }
  const now = Date.now()
  await ctx.db.insert('learnMeasurementReportFacts', {
    ...value, userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION, createdAt: now,
    ...(input.learningVoidId ? { learningVoidId: input.learningVoidId } : {}),
  })
  const state = parseLearnContract(learnReportSourceWatermarkSchema, {
    sourceVersion: LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, sequence, updatedAt: now,
    dueWorkThrough: watermark?.dueWorkThrough ?? null, historyCoverage: watermark?.historyCoverage ?? 'unknown',
  })
  if (watermark) await ctx.db.patch(watermark._id, state)
  else await ctx.db.insert('learnMeasurementSourceWatermarks', {
    ...state, userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION, createdAt: now,
  })
  return sequence
}

async function validateFirstIndependentFact(ctx: MutationCtx, userId: string, value: LearnReportSourceFact, learningVoidId?: Id<'learningVoids'>) {
  const fact = value.fact
  if (fact.kind !== 'independent_claim_v2' && fact.kind !== 'first_slot_link') throw new Error('Invalid Independent fact')
  const previous = await ctx.db.query('learnMeasurementReportFacts')
    .withIndex('by_userId_and_fact_claimKey_and_fact_claimSequence', q => q.eq('userId', userId).eq('fact.claimKey', fact.claimKey).eq('fact.claimSequence', 1)).take(3)
  if (fact.kind === 'first_slot_link') {
    const saved = previous[0]
    if (previous.length !== 1 || !saved || saved.fact.kind !== 'independent_claim_v2'
      || saved.learningVoidId !== learningVoidId) throw new Error('Learn first slot already linked or claim unavailable')
    const resolved = resolveLearnReportFirstSlotV2({ factVersion: saved.factVersion, sequence: saved.sequence,
      epoch: saved.epoch, occurredAt: saved.occurredAt, fact: saved.fact }, value)
    if (resolved.firstSlot.kind !== 'linked') throw new Error('Learn first slot unavailable')
    await validateFirstSlot(ctx, userId, resolved, resolved.firstSlot, learningVoidId)
    return
  }
  if (previous.length) throw new Error('Learn first Independent claim already recorded')
  const claim = resolveLearnReportFirstSlotV2(value)
  const basis = await ctx.db.get(claim.basisAttemptId)
  const blueprint = await ctx.db.get(claim.blueprintRevisionId)
  const objective = await ctx.db.get(claim.objectiveId)
  const acceptedAt = basis?.acceptedAt ?? basis?.measurementStorage?.acceptedAt
  const key = await privacyDigest(['learn-v2.first-independent.v1', await masteryScopeKey(userId, claim.blueprintRevisionId, claim.objectiveId), value.epoch])
  if (!basis || basis.userId !== userId || basis.blueprintRevisionId !== claim.blueprintRevisionId || basis.objectiveId !== claim.objectiveId
    || blueprint?.userId !== userId || blueprint.learningVoidId !== learningVoidId
    || objective?.userId !== userId || objective.blueprintRevisionId !== blueprint._id
    || claim.claimKey !== key || basis.kind !== 'independent_application'
    || basis.masteryStateBefore === undefined || ['independent', 'retained'].includes(basis.masteryStateBefore) || basis.masteryStateAfter !== 'independent'
    || basis.masteryTransitionVersion !== claim.transitionVersion || basis.masteryRecordRevision !== claim.masteryRecordRevision
    || acceptedAt !== claim.firstIndependentAt || value.occurredAt > Date.now()
    || basis.attemptLocalDate !== claim.firstIndependentLocalDate || basis.attemptTimezone !== claim.firstIndependentTimezone
    || basis.serverScorePercent === undefined || !Number.isFinite(basis.serverScorePercent) || basis.serverScorePercent < 80 || basis.serverScorePercent > 100
    || basis.assistanceSnapshot?.state !== 'unassisted' || basis.assistanceSnapshot.policyVersion !== LEARN_V2_ASSISTANCE_POLICY_VERSION
    || basis.validitySnapshot?.status !== 'valid' || !basis.validitySnapshot.masteryEligible || basis.validitySnapshot.policyVersion !== LEARN_V2_VALIDITY_POLICY_VERSION
    || claim.policyPins.assistancePolicyVersion !== basis.assistanceSnapshot.policyVersion
    || claim.policyPins.validityPolicyVersion !== basis.validitySnapshot.policyVersion
    || claim.policyPins.thresholdVersion !== (basis.scoringBinding?.thresholdVersion ?? 'learn-v2.mastery-threshold.v1')) throw new Error('Learn first Independent basis is invalid')
  if (claim.firstSlot.kind === 'linked') await validateFirstSlot(ctx, userId, claim, claim.firstSlot, learningVoidId)
}

async function validateFirstSlot(ctx: MutationCtx, userId: string, claim: LearnReportIndependentClaimV2,
  slot: LearnReportLinkedFirstSlot, learningVoidId?: Id<'learningVoids'>) {
  if (!learningVoidId || slot.linkedAt !== Date.now() || !qualifiesLearnReportFirstSlot(claim, slot)) throw new Error('Learn first slot is not qualifying')
  const opportunities = await ctx.db.query('learnAssessmentOpportunities')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(65)
  if (opportunities.length > 64) throw new Error('Learn first-slot inventory exceeds its bound')
  const candidates: Doc<'learnAssessmentOpportunities'>[] = []
  for (const row of opportunities) {
    if (row.blueprintRevisionId !== claim.blueprintRevisionId || row.objectiveId !== claim.objectiveId
      || !row.originalSlot || row.replacesOpportunityId !== undefined || !('clock' in row.purpose)
      || !qualifiesLearnReportFirstSlot(claim, { ...slot, clock: row.purpose.clock })) continue
    if (row.purpose.kind === 'retained_transfer') {
      if (row.purpose.basisAttemptId === claim.basisAttemptId) candidates.push(row)
    }
    else {
      const assignment = await ctx.db.get(row.purpose.assignmentId)
      if (assignment?.userId === userId && assignment.status === 'admitted' && assignment.epoch === claim.stratum.epoch
        && assignment.learningVoidId === learningVoidId && assignment.blueprintRevisionId === claim.blueprintRevisionId
        && assignment.objectiveId === claim.objectiveId && row.assignmentId === assignment._id) candidates.push(row)
    }
  }
  candidates.sort((left, right) => left.openAt - right.openAt || left.delayedCheckId.localeCompare(right.delayedCheckId))
  const first = candidates[0]
  const firstClock = first && 'clock' in first.purpose ? first.purpose.clock : null
  if (!first || !firstClock || first._id !== slot.firstCheckOpportunityId
    || first.createdAt > slot.linkedAt
    || first.openAt !== slot.clock.openAt || first.closeAt !== slot.clock.closeAt || first.dueAt !== slot.clock.dueAt
    || Object.entries(slot.clock).some(([key, pin]) => firstClock[key as keyof typeof slot.clock] !== pin)
    || first.submissionId !== undefined || first.authoritativeAttemptId !== undefined || first.scoringJobId !== undefined
    || !['preparing', 'ready', 'test_open'].includes(first.phase) || Date.now() >= first.closeAt
    || first.firstCheckClaim && (first.firstCheckClaim.claimKey !== claim.claimKey || first.checkSequence !== 1)) throw new Error('Learn earliest first slot unavailable')
  const [response, execution, attempt] = await Promise.all([
    ctx.db.query('learnResponses').withIndex('by_userId_and_assessmentOpportunityId', q => q.eq('userId', userId).eq('assessmentOpportunityId', first._id)).first(),
    ctx.db.query('learnScoringExecutions').withIndex('by_userId_and_assessmentOpportunityId', q => q.eq('userId', userId).eq('assessmentOpportunityId', first._id)).first(),
    ctx.db.query('masteryAttempts').withIndex('by_userId_and_assessmentOpportunityId', q => q.eq('userId', userId).eq('assessmentOpportunityId', first._id)).first(),
  ])
  if (response || execution || attempt) throw new Error('Learn first slot outcome already started')
  const assignment = first.purpose.kind === 'measurement_delayed' ? await ctx.db.get(first.purpose.assignmentId) : null
  const flow = assignment?.flow ?? (first.contextPins.kind === 'session' && first.contextPins.canvas ? 'v2_canvas' : 'v2_today')
  const configuration = await deriveLearnScorerConfiguration(first.scoringBinding)
  if (configuration.scoringKind !== slot.stratum.scorerConfiguration.scoringKind
    || configuration.configurationDigest !== slot.stratum.scorerConfiguration.configurationDigest
    || configuration.scorerVersion !== slot.stratum.scorerConfiguration.scorerVersion
    || first.depth !== slot.stratum.depth || flow !== slot.stratum.flow) throw new Error('Learn first-slot stratum mismatch')
  if (first.assessmentPins.kind === 'measurement') {
    const pins = first.assessmentPins.itemPins
    const [family, item] = await Promise.all([ctx.db.get(pins.familyId), ctx.db.get(pins.itemId)])
    if (family?.userId !== userId || item?.userId !== userId || item.familyId !== family._id
      || slot.stratum.familyId !== family._id || slot.stratum.familyRevision !== pins.familyRevision
      || slot.stratum.familyValidationStatus !== family.status || slot.stratum.equivalenceVersion !== pins.equivalenceVersion
      || slot.stratum.responseKind !== item.responseSpec.kind) throw new Error('Learn first-slot stratum mismatch')
  }
  else if (slot.stratum.familyId !== null || slot.stratum.familyRevision !== null || slot.stratum.equivalenceVersion !== null
    || slot.stratum.familyValidationStatus !== 'unknown' || slot.stratum.responseKind !== 'bounded_rubric') throw new Error('Learn first-slot stratum mismatch')
}

export async function writeLearnMeasurementEnrollmentFact(ctx: MutationCtx, userId: string, assignment: Doc<'learnMeasurementAssignments'>) {
  const family = assignment.familyId ? await ctx.db.get(assignment.familyId) : null
  if (assignment.userId !== userId || (family && (family.userId !== userId || family.learningVoidId !== assignment.learningVoidId))) throw new Error('Learn access denied')
  const admitted = assignment.status === 'admitted' ? assignment : null
  const allocation = admitted?.allocation
  const snapshot = parseLearnContract(learnReportAssignmentSnapshotSchema, {
    status: assignment.status, protocolStatus: assignment.protocolStatus,
    responseKind: admitted?.responseKind ?? null,
    scorerConfiguration: admitted ? await deriveLearnScorerConfiguration(admitted.scoringBinding) : null,
    epoch: assignment.epoch, baselineSha: assignment.baselineSha, cohortVersion: assignment.cohortVersion,
    flow: assignment.flow, entryPoint: assignment.entryPoint, depth: assignment.depth,
    protocolVersion: admitted?.protocolVersion ?? null, enrollmentAt: admitted?.enrollmentAt ?? null,
    timezone: admitted?.enrollmentTimezone ?? null, anchorAt: admitted?.anchorAt ?? null, anchorKind: admitted?.anchorKind ?? null,
    historyStatus: assignment.historyStatus, familyId: assignment.familyId ?? null, familyRevision: assignment.familyRevision ?? null,
    familyValidationStatus: family?.status ?? 'unknown', equivalenceVersion: family?.equivalenceVersion ?? null,
    allocationOrder: allocation?.kind === 'three_case' ? allocation.order
      : allocation ? `${allocation.cold.formLabel}${allocation.delayed.formLabel}` : null,
    assignedDay7: allocation?.kind === 'three_case' || (allocation?.kind === 'two_case' && allocation.horizonDays === 7),
    assignedDay30: allocation?.kind === 'three_case' || (allocation?.kind === 'two_case' && allocation.horizonDays === 30),
    sourceCoverage: 'unknown',
  })
  const previous = await ctx.db.query('learnMeasurementReportFacts')
    .withIndex('by_userId_and_fact_assignmentId', q => q.eq('userId', userId).eq('fact.assignmentId', assignment._id))
    .order('desc').first()
  const previousSnapshot = previous?.fact.kind === 'enrollment'
    ? parseLearnContract(learnReportAssignmentSnapshotSchema, previous.fact.snapshot) : null
  if (previous?.fact.kind === 'enrollment' && previous.fact.status === assignment.status
    && JSON.stringify(previousSnapshot) === JSON.stringify(snapshot)) return previous.sequence
  const recordRevision = previous?.fact.kind === 'enrollment' ? previous.fact.recordRevision + 1 : 1
  return await appendLearnMeasurementFact(ctx, userId, {
    epoch: assignment.epoch, occurredAt: Date.now(), learningVoidId: assignment.learningVoidId,
    fact: { kind: 'enrollment', assignmentId: assignment._id, recordRevision, status: assignment.status, snapshot },
  })
}

export async function writeLearnResponseAcceptanceFact(ctx: MutationCtx, userId: string, response: Doc<'learnResponses'>, epoch: string) {
  return await appendLearnMeasurementFact(ctx, userId, {
    epoch, occurredAt: response.acceptedAt,
    ...(response.scopeKind === 'v2' ? { learningVoidId: response.learningVoidId } : {}),
    fact: { kind: 'response', submissionId: response._id, acceptedAt: response.acceptedAt,
      measurementEligible: response.validitySnapshot.measurementEligible, masteryEligible: response.validitySnapshot.masteryEligible,
      assistanceSnapshot: response.assistanceSnapshot, validitySnapshot: response.validitySnapshot },
  })
}

export async function readLearnMeasurementWatermarkSnapshot(ctx: QueryCtx | MutationCtx, userId: string, reportRunId: Id<'learnMeasurementReportRuns'>) {
  const { watermark } = await nextLearnMeasurementSourceSequence(ctx, userId)
  return parseLearnContract(learnReportWatermarkSnapshotSchema, {
    kind: 'owner_watermark', learnerKey: await deriveLearnReportLearnerKey(reportRunId, userId),
    sequence: watermark?.sequence ?? 0, dueWorkThrough: watermark?.dueWorkThrough ?? null,
    historyCoverage: watermark?.historyCoverage ?? 'unknown', legacyIndependentAudit: { sourceCoverage: 'unknown', unknownCount: null },
  })
}
