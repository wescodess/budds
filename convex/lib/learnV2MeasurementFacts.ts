import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import {
  LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, learnReportAssignmentSnapshotSchema,
  learnReportFactSchema, learnReportSourceWatermarkSchema, learnReportWatermarkSnapshotSchema,
  deriveLearnReportLearnerKey,
  resolveLearnReportFirstSlotV2, qualifiesLearnReportFirstSlot,
  learnReportFirstSlotStratumSchema, reconcileLearnReportFirstClaims,
  type LearnReportIndependentClaimV2, type LearnReportLinkedFirstSlot, type LearnReportFirstClaimIdentity,
  type LearnReportSourceFact,
} from '../../shared/learn-v2-measurement-report'
import { LEARN_MEASUREMENT_STORAGE_VERSION } from '../../shared/learn-v2-measurement-storage-manifest'
import { LEARN_V2_ASSISTANCE_POLICY_VERSION, LEARN_V2_VALIDITY_POLICY_VERSION, parseLearnContract } from '../../shared/learn-v2-responses'
import { deriveLearnScorerConfiguration, learnScorerBindingSchema } from '../../shared/learn-v2-measurement'
import { learnAssessmentPurposeSchema, doesLearnAssessmentPurposeMatchPins } from '../../shared/learn-v2-delayed-check'
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
  if (fact.kind === 'independent_claim') throw new Error('Learn legacy Independent claims are read-only')
  const source = fact.kind === 'enrollment' ? await ctx.db.get(fact.assignmentId)
    : fact.kind === 'opportunity' ? await ctx.db.get(fact.assessmentOpportunityId)
      : fact.kind === 'independent_claim_v2' ? await ctx.db.get(fact.basisAttemptId)
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
  if (fact.kind === 'first_slot_link') {
    const previous = await ctx.db.query('learnMeasurementReportFacts')
      .withIndex('by_userId_and_fact_claimKey_and_fact_claimSequence', q => q.eq('userId', userId).eq('fact.claimKey', fact.claimKey).eq('fact.claimSequence', fact.claimSequence)).take(3)
    const saved = previous[0]
    if (previous.length !== 1 || !saved || saved.fact.kind !== 'independent_claim_v2'
      || saved.learningVoidId !== learningVoidId) throw new Error('Learn first slot already linked or claim unavailable')
    const resolved = resolveLearnReportFirstSlotV2({ factVersion: saved.factVersion, sequence: saved.sequence,
      epoch: saved.epoch, occurredAt: saved.occurredAt, fact: saved.fact }, value)
    if (resolved.firstSlot.kind !== 'linked') throw new Error('Learn first slot unavailable')
    await validateFirstSlot(ctx, userId, resolved, resolved.firstSlot, learningVoidId)
    await assertFirstClaimReconciles(ctx, userId, value.epoch, resolved, saved._id)
    return
  }
  await assertFirstClaimReconciles(ctx, userId, value.epoch, fact)
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

const FIRST_CLAIM_FACT_KINDS = ['independent_claim', 'independent_claim_v2', 'first_slot_link'] as const
const FIRST_CLAIM_INVENTORY_LIMIT = 256

// Reads every claim this append could collide with, so concurrent appends conflict and nothing persisted fails reconciliation later.
async function assertFirstClaimReconciles(ctx: MutationCtx, userId: string, epoch: string,
  candidate: LearnReportIndependentClaimV2, claimFactId?: Id<'learnMeasurementReportFacts'>) {
  const [scoped, sameKey, sameBasis] = await Promise.all([
    Promise.all(FIRST_CLAIM_FACT_KINDS.map(kind => ctx.db.query('learnMeasurementReportFacts')
      .withIndex('by_userId_and_epoch_and_fact_kind', q => q.eq('userId', userId).eq('epoch', epoch).eq('fact.kind', kind))
      .take(FIRST_CLAIM_INVENTORY_LIMIT + 1))),
    ctx.db.query('learnMeasurementReportFacts').withIndex('by_fact_claimKey', q => q.eq('fact.claimKey', candidate.claimKey)).take(4),
    ctx.db.query('learnMeasurementReportFacts').withIndex('by_fact_basisAttemptId', q => q.eq('fact.basisAttemptId', candidate.basisAttemptId)).take(4),
  ])
  if (scoped.some(rows => rows.length > FIRST_CLAIM_INVENTORY_LIMIT)) throw new Error('Learn first Independent claim inventory exceeds its bound')
  const rows = new Map([...scoped.flat(), ...sameKey, ...sameBasis].map(row => [row._id, row]))
  const links = new Map<string, string>()
  for (const row of rows.values()) {
    if (row.fact.kind === 'first_slot_link') links.set(JSON.stringify([row.userId, row.fact.claimKey]), row.fact.slot.firstCheckOpportunityId)
  }
  const proposed: LearnReportFirstClaimIdentity = { owner: userId, capability: JSON.stringify([candidate.blueprintRevisionId, candidate.objectiveId]),
    epoch: candidate.stratum.epoch, snapshot: 'candidate', claimKey: candidate.claimKey, basisAttemptId: candidate.basisAttemptId,
    firstCheckOpportunityId: candidate.firstSlot.kind === 'linked' ? candidate.firstSlot.firstCheckOpportunityId : null }
  for (const row of rows.values()) {
    if (row._id === claimFactId) continue
    const existing = await readFirstClaimIdentity(ctx, row, links)
    const reasons = existing ? reconcileLearnReportFirstClaims([existing, proposed]) : new Set<string>()
    if (reasons.size) throw new Error(`Learn first Independent claim already recorded: ${[...reasons].sort().join(', ')}`)
  }
}

async function readFirstClaimIdentity(ctx: MutationCtx, row: Doc<'learnMeasurementReportFacts'>,
  links: ReadonlyMap<string, string>): Promise<LearnReportFirstClaimIdentity | null> {
  const fact = row.fact
  if (fact.kind === 'independent_claim_v2') return { owner: row.userId, capability: JSON.stringify([fact.blueprintRevisionId, fact.objectiveId]),
    epoch: fact.stratum.epoch, snapshot: row._id, claimKey: fact.claimKey, basisAttemptId: fact.basisAttemptId,
    firstCheckOpportunityId: fact.firstSlot.kind === 'linked' ? fact.firstSlot.firstCheckOpportunityId
      : links.get(JSON.stringify([row.userId, fact.claimKey])) ?? null }
  if (fact.kind !== 'independent_claim') return null
  const opportunity = await ctx.db.get(fact.firstCheckOpportunityId)
  const basis = opportunity ? null : await ctx.db.get(fact.basisAttemptId)
  const scope = opportunity ?? (basis?.blueprintRevisionId && basis.objectiveId ? basis : null)
  return { owner: row.userId, capability: JSON.stringify(scope ? [scope.blueprintRevisionId, scope.objectiveId] : ['unavailable', row._id]),
    epoch: fact.stratum.epoch, snapshot: row._id, claimKey: fact.claimKey, basisAttemptId: fact.basisAttemptId,
    firstCheckOpportunityId: fact.firstCheckOpportunityId }
}

async function validateFirstSlot(ctx: MutationCtx, userId: string, claim: LearnReportIndependentClaimV2,
  slot: LearnReportLinkedFirstSlot, learningVoidId?: Id<'learningVoids'>) {
  if (!learningVoidId || slot.linkedAt !== Date.now() || !qualifiesLearnReportFirstSlot(claim, slot)) throw new Error('Learn first slot is not qualifying')
  const opportunities = await ctx.db.query('learnAssessmentOpportunities')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(65)
  if (opportunities.length > 64) throw new Error('Learn first-slot inventory exceeds its bound')
  const candidates: { row: Doc<'learnAssessmentOpportunities'>, slot: LearnReportLinkedFirstSlot }[] = []
  for (const row of opportunities) {
    const candidate = await readQualifyingFirstSlot(ctx, userId, claim, row)
    if (candidate) candidates.push({ row, slot: candidate })
  }
  candidates.sort((left, right) => left.row.openAt - right.row.openAt || left.row.delayedCheckId.localeCompare(right.row.delayedCheckId))
  const selected = candidates[0]
  const first = selected?.row
  if (!first || first._id !== slot.firstCheckOpportunityId
    || first.createdAt > slot.linkedAt
    || first.submissionId !== undefined || first.authoritativeAttemptId !== undefined || first.scoringJobId !== undefined
    || !['preparing', 'ready', 'test_open'].includes(first.phase) || Date.now() >= first.closeAt
    || first.firstCheckClaim && (first.firstCheckClaim.claimKey !== claim.claimKey || first.checkSequence !== 1)) throw new Error('Learn earliest first slot unavailable')
  const [response, execution, attempt] = await Promise.all([
    ctx.db.query('learnResponses').withIndex('by_userId_and_assessmentOpportunityId', q => q.eq('userId', userId).eq('assessmentOpportunityId', first._id)).first(),
    ctx.db.query('learnScoringExecutions').withIndex('by_userId_and_assessmentOpportunityId', q => q.eq('userId', userId).eq('assessmentOpportunityId', first._id)).first(),
    ctx.db.query('masteryAttempts').withIndex('by_userId_and_assessmentOpportunityId', q => q.eq('userId', userId).eq('assessmentOpportunityId', first._id)).first(),
  ])
  if (response || execution || attempt) throw new Error('Learn first slot outcome already started')
  if (await privacyDigest(selected.slot) !== await privacyDigest(slot)) throw new Error('Learn first-slot stratum mismatch')
}

async function readQualifyingFirstSlot(ctx: QueryCtx, userId: string, claim: LearnReportIndependentClaimV2,
  row: Doc<'learnAssessmentOpportunities'>): Promise<LearnReportLinkedFirstSlot | null> {
  if (row.userId !== userId || row.blueprintRevisionId !== claim.blueprintRevisionId || row.objectiveId !== claim.objectiveId
    || !row.originalSlot || row.replacesOpportunityId !== undefined) return null
  const parsedPurpose = learnAssessmentPurposeSchema.safeParse(row.purpose)
  if (!parsedPurpose.success || !('clock' in parsedPurpose.data)) return null
  const purpose = parsedPurpose.data
  if (!doesLearnAssessmentPurposeMatchPins(purpose, row.assessmentPins)) return null
  const clock = purpose.clock
  const binding = learnScorerBindingSchema.safeParse(row.scoringBinding)
  if (!binding.success || row.openAt !== clock.openAt || row.closeAt !== clock.closeAt || row.dueAt !== clock.dueAt
    || row.horizonDays !== undefined && row.horizonDays !== clock.horizonDays) return null
  const assignment = purpose.kind === 'measurement_delayed' ? await ctx.db.get(purpose.assignmentId) : null
  if (purpose.kind === 'retained_transfer' ? purpose.basisAttemptId !== claim.basisAttemptId
    : !assignment || assignment.userId !== userId || assignment.status !== 'admitted' || assignment.epoch !== claim.stratum.epoch
      || assignment.learningVoidId !== row.learningVoidId || assignment.blueprintRevisionId !== claim.blueprintRevisionId
      || assignment.objectiveId !== claim.objectiveId || row.assignmentId !== assignment._id) return null
  const pins = row.assessmentPins.kind === 'measurement' ? row.assessmentPins.itemPins : null
  const [family, item] = await Promise.all([pins ? ctx.db.get(pins.familyId) : null, pins ? ctx.db.get(pins.itemId) : null])
  if (pins ? !family || family.userId !== userId || !item || item.userId !== userId || item.familyId !== family._id
    || family.revision !== pins.familyRevision || item.familyRevision !== pins.familyRevision || family.equivalenceVersion !== pins.equivalenceVersion
    : row.assessmentPins.kind !== 'session_application') return null
  const stratum = learnReportFirstSlotStratumSchema.safeParse({
    epoch: assignment?.epoch ?? claim.stratum.epoch, baselineSha: assignment?.baselineSha ?? claim.stratum.baselineSha,
    cohortVersion: assignment?.cohortVersion ?? claim.stratum.cohortVersion,
    flow: assignment?.flow ?? (row.contextPins.kind === 'session' && row.contextPins.canvas ? 'v2_canvas' : 'v2_today'),
    entryPoint: assignment?.entryPoint ?? 'retained_check', depth: row.depth,
    familyId: pins?.familyId ?? null, familyRevision: pins?.familyRevision ?? null,
    familyValidationStatus: family?.status ?? 'unknown', equivalenceVersion: pins?.equivalenceVersion ?? null,
    responseKind: item?.responseSpec.kind ?? 'bounded_rubric', scorerConfiguration: await deriveLearnScorerConfiguration(binding.data),
  })
  if (!stratum.success) return null
  const candidate: LearnReportLinkedFirstSlot = { kind: 'linked', firstCheckOpportunityId: row._id, checkSequence: 1,
    linkedAt: Date.now(), clock, stratum: stratum.data }
  return qualifiesLearnReportFirstSlot(claim, candidate) ? candidate : null
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
