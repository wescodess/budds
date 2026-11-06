import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import {
  LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, learnReportAssignmentSnapshotSchema,
  learnReportFactSchema, learnReportSourceWatermarkSchema, learnReportWatermarkSnapshotSchema,
  type LearnReportSourceFact,
} from '../../shared/learn-v2-measurement-report'
import { LEARN_MEASUREMENT_STORAGE_VERSION } from '../../shared/learn-v2-measurement-storage-manifest'
import { parseLearnContract } from '../../shared/learn-v2-responses'

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
      : fact.kind === 'independent_claim' ? await ctx.db.get(fact.basisAttemptId)
        : await ctx.db.get(fact.submissionId)
  if (!source || source.userId !== userId
    || ('learningVoidId' in source && source.learningVoidId !== input.learningVoidId)) throw new Error('Learn fact scope mismatch')
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

export async function writeLearnMeasurementEnrollmentFact(ctx: MutationCtx, userId: string, assignment: Doc<'learnMeasurementAssignments'>) {
  const family = assignment.familyId ? await ctx.db.get(assignment.familyId) : null
  if (assignment.userId !== userId || (family && (family.userId !== userId || family.learningVoidId !== assignment.learningVoidId))) throw new Error('Learn access denied')
  const admitted = assignment.status === 'admitted' ? assignment : null
  const allocation = admitted?.allocation
  const snapshot = parseLearnContract(learnReportAssignmentSnapshotSchema, {
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
  if (previous?.fact.kind === 'enrollment' && previous.fact.status === assignment.status
    && JSON.stringify(previous.fact.snapshot) === JSON.stringify(snapshot)) return previous.sequence
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

export async function readLearnMeasurementWatermarkSnapshot(ctx: QueryCtx | MutationCtx, userId: string) {
  const { watermark } = await nextLearnMeasurementSourceSequence(ctx, userId)
  return parseLearnContract(learnReportWatermarkSnapshotSchema, {
    kind: 'owner_watermark', sequence: watermark?.sequence ?? 0, dueWorkThrough: watermark?.dueWorkThrough ?? null,
    historyCoverage: watermark?.historyCoverage ?? 'unknown', legacyIndependentAudit: { sourceCoverage: 'unknown', unknownCount: null },
  })
}
