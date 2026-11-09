import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import {
  deriveLearnReportComputationKeys, learnReportEpisodeSnapshotSchema, learnReportFirstClaimSnapshotSchema,
  learnReportFactSchema, type LearnReportInputSnapshot, type LearnReportSourceFact,
} from '../../shared/learn-v2-measurement-report'
import { deriveLearnScorerConfiguration } from '../../shared/learn-v2-measurement'
import { learnFirstCheckClaimSchema } from '../../shared/learn-v2-delayed-check'
import { learnSerializedBytes } from '../../shared/learn-v2-responses'
import { LEARN_MEASUREMENT_STORAGE_LIMITS as limits } from '../../shared/learn-v2-measurement-storage-manifest'
import { hasAccountDeletionTombstone } from './accountDeletionTombstone'
import { sourceBodyAvailable } from './learnV2ResponsePrivacy'
import { documentHasCurrentRevision } from './learnV2BackingSource'
import type { LearnReportApproval } from './learnV2MeasurementReportAccess'

type Fact = Doc<'learnMeasurementReportFacts'>
type Episode = Extract<LearnReportInputSnapshot, { kind: 'episode' }>
function incomplete(reason: string): never { throw new Error(reason) }
function factValue(row: Fact): LearnReportSourceFact {
  return learnReportFactSchema.parse({ factVersion: row.factVersion, sequence: row.sequence, epoch: row.epoch, occurredAt: row.occurredAt, fact: row.fact })
}
export async function readLearnReportFactPage(ctx: QueryCtx, userId: string, epoch: string, after: number, through: number) {
  if (await hasAccountDeletionTombstone(ctx, userId)) incomplete('source_invalidated')
  const rows = await ctx.db.query('learnMeasurementReportFacts')
    .withIndex('by_userId_and_sequence', q => q.eq('userId', userId).gt('sequence', after).lte('sequence', through)).take(4)
  const bytes = learnSerializedBytes(rows.map(factValue), limits.maxReportPageBytes)
  if (rows.some((row, index) => row.sequence !== after + index + 1)) incomplete('missing_source_fact')
  const end = rows.at(-1)?.sequence ?? after
  if (rows.length < 4 && end !== through) incomplete('missing_source_page')
  return { records: rows.map(row => ({ id: row._id, sequence: row.sequence, inScope: row.epoch === epoch && ['enrollment', 'independent_claim'].includes(row.fact.kind) })), isDone: end === through, bytes }
}
async function opportunityFacts(ctx: QueryCtx, userId: string, id: Id<'learnAssessmentOpportunities'>, through: number) {
  const rows = await ctx.db.query('learnMeasurementReportFacts')
    .withIndex('by_userId_and_fact_assessmentOpportunityId', q => q.eq('userId', userId).eq('fact.assessmentOpportunityId', id)).order('desc').take(8)
  if (rows.length === 8) incomplete('opportunity_history_overflow')
  return rows.filter(row => row.sequence <= through).sort((a, b) => a.sequence - b.sequence)
}
async function responseEvidenceAvailable(ctx: QueryCtx, userId: string, response: Doc<'learnResponses'>) {
  if (response.evidenceStatus !== 'available' || response.currentEligibility !== 'eligible' || response.invalidatedAt !== undefined) return false
  const links = await ctx.db.query('learnResponseEvidenceLinks')
    .withIndex('by_userId_and_submissionId', q => q.eq('userId', userId).eq('submissionId', response._id)).take(65)
  if (!links.length || links.length > 64) return false
  for (const link of links) {
    if (link.evidenceStatus !== 'available' || link.invalidatedAt !== undefined) return false
    const dependency = link.dependency
    if (dependency.kind === 'snapshot') {
      if (!await sourceBodyAvailable(ctx, userId, dependency.sourceSnapshotId)) return false
      const source = await ctx.db.get(dependency.sourceSnapshotId)
      if (!source || source.revision !== dependency.sourceSnapshotRevision || (source.recordRevision ?? 1) !== dependency.sourceRecordRevision) return false
    } else if (dependency.kind === 'document') {
      const document = await ctx.db.get(dependency.documentId)
      if (!document || document.userId !== userId || document.status !== 'success' || !documentHasCurrentRevision(document, dependency.sourceRevision)) return false
      const folder = await ctx.db.get(document.folderId)
      if (!folder || folder.userId !== userId) return false
    } else {
      const folder = await ctx.db.get(dependency.folderId)
      if (!folder || folder.userId !== userId) return false
    }
  }
  return true
}
async function outcome(ctx: QueryCtx, userId: string, opportunity: Doc<'learnAssessmentOpportunities'> | null, through: number, cutoff: number, epoch: string) {
  const empty = { acceptance: null, result: null, validitySnapshot: null, stateAtAcceptance: null, assistanceState: null, flow: null, epoch: null } as const
  if (!opportunity) return empty
  const responses = await ctx.db.query('learnResponses')
    .withIndex('by_userId_and_assessmentOpportunityId', q => q.eq('userId', userId).eq('assessmentOpportunityId', opportunity._id)).take(2)
  if (responses.length > 1) incomplete('conflicting_submission')
  const response = responses[0]
  if (!response || response.acceptedAt > cutoff) return empty
  const facts = await ctx.db.query('learnMeasurementReportFacts')
    .withIndex('by_userId_and_fact_submissionId', q => q.eq('userId', userId).eq('fact.submissionId', response._id)).take(8)
  if (facts.length === 8) incomplete('response_history_overflow')
  const pinned = facts.filter(row => row.sequence <= through).map(factValue)
  if (pinned.some(row => row.epoch !== epoch)) incomplete('conflicting_source_epoch')
  const accepted = pinned.filter(row => row.fact.kind === 'response')
  if (accepted.length > 1) incomplete('conflicting_acceptance')
  const acceptanceFact = accepted[0]?.fact
  if (!acceptanceFact || acceptanceFact.kind !== 'response') return empty
  if (acceptanceFact.acceptedAt !== response.acceptedAt) incomplete('conflicting_acceptance')
  const scores = pinned.filter(row => row.fact.kind === 'score' && row.fact.scoreCommittedAt <= cutoff)
  if (scores.length > 1) incomplete('conflicting_score')
  const score = scores[0]?.fact
  let result = score?.kind === 'score' ? score.snapshot : null
  if (result) {
    const [attempt, execution] = await Promise.all([ctx.db.get(result.attemptId), ctx.db.get(result.executionId)])
    if (!attempt || !execution || attempt.userId !== userId || execution.userId !== userId || execution.submissionId !== response._id
      || execution.assessmentOpportunityId !== opportunity._id || execution.authoritativeAttemptId !== attempt._id
      || execution.committedAt !== result.scoreCommittedAt || attempt.objectiveId !== opportunity.objectiveId
      || attempt.blueprintRevisionId !== opportunity.blueprintRevisionId || result.submissionId !== response._id
      || result.acceptedAt !== response.acceptedAt || score?.kind !== 'score' || score.scorePercent !== result.scorePercent
      || attempt.submissionId !== response._id || attempt.scoringExecutionId !== execution._id
      || attempt.serverScorePercent !== result.scorePercent || execution.outcome !== 'validated'
      || (execution.verdict ? execution.verdict.scorePercent !== result.scorePercent : execution.evidenceStatus === 'available')) incomplete('invalid_authoritative_result')
    const configuration = await deriveLearnScorerConfiguration(execution.scoringBinding)
    if (result.configurationDigest !== configuration.configurationDigest || result.scorerVersion !== configuration.scorerVersion
      || result.scoringKind !== configuration.scoringKind || attempt.kind !== result.kind
      || result.kind !== opportunity.purpose.kind || result.comparisonContractDigest !== opportunity.assessmentContractDigest
      || result.caseId !== (opportunity.assessmentPins.kind === 'measurement' ? opportunity.assessmentPins.itemPins.caseId : opportunity.assessmentPins.caseId)
      || result.supportManifestDigest !== (opportunity.assessmentPins.kind === 'measurement' ? opportunity.assessmentPins.itemPins.supportManifestDigest : opportunity.assessmentPins.supportManifestDigest)) incomplete('invalid_result_pins')
    if (execution.observedIdentity.status !== result.identityStatus
      || (execution.observedIdentity.status !== 'deterministic' && (execution.observedIdentity.returnedScorerModel !== result.observedModel
        || execution.observedIdentity.servingProvider !== result.observedUpstream))) incomplete('invalid_scorer_identity')
    const evidenceAvailable = await responseEvidenceAvailable(ctx, userId, response)
    const integrity = pinned.some(row => row.fact.kind === 'integrity' && (row.fact.currentEligibility !== 'eligible' || !row.fact.evidenceAvailable))
    result = { ...result, evidenceAvailable: result.evidenceAvailable && evidenceAvailable && execution.evidenceStatus === 'available' && !integrity }
  }
  return { acceptance: { submissionId: response._id, acceptedAt: response.acceptedAt }, result,
    validitySnapshot: acceptanceFact.validitySnapshot, assistanceState: acceptanceFact.assistanceSnapshot.state, stateAtAcceptance: acceptanceFact.stateAtAcceptance ?? 'unknown' as const,
    flow: 'flow' in response ? (['today', 'v2_today'].includes(response.flow) ? 'v2_today' : 'v2_canvas') : null,
    epoch: 'baselineEpoch' in response ? response.baselineEpoch : 'measurementContext' in response && response.measurementContext.status === 'admitted' ? response.measurementContext.baselineEpoch : null }
}
function operational(rows: Fact[]) {
  const latest = rows.findLast(row => row.fact.kind === 'opportunity' && ['eligible', 'blocked', 'pending'].includes(row.fact.status))?.fact
  return latest?.kind === 'opportunity' && ['eligible', 'blocked', 'pending'].includes(latest.status)
    ? latest.status as Episode['operationalEligibility'] : 'pending' as const
}
function savedClock(rows: Fact[]) {
  const fact = rows.at(-1)?.fact
  return fact?.kind === 'opportunity' ? fact.clock : null
}
function slotDisposition(facts: Fact[], accepted: Awaited<ReturnType<typeof outcome>>): Episode['disposition'] {
  const latest = facts.at(-1)?.fact
  if (accepted.assistanceState && accepted.assistanceState !== 'unassisted') return 'assisted_contaminated'
  if (operational(facts) === 'blocked') return 'access_provider_blocked'
  if (latest?.kind === 'opportunity' && ['cancelled', 'abandoned'].includes(latest.status)) return 'abandoned'
  if (latest?.kind === 'opportunity' && ['invalid', 'reconciliation_required'].includes(latest.status)) return 'reconciliation_required'
  return accepted.acceptance && !accepted.result ? 'scoring_pending' : accepted.result ? 'valid_scored' : 'missing_delayed'
}
async function scopeAvailable(ctx: QueryCtx, userId: string, row: { learningVoidId: Id<'learningVoids'>, blueprintRevisionId: Id<'learnBlueprintRevisions'>, objectiveId: Id<'learnObjectives'> }) {
  const [voidRow, blueprint, objective] = await Promise.all([ctx.db.get(row.learningVoidId), ctx.db.get(row.blueprintRevisionId), ctx.db.get(row.objectiveId)])
  if (!voidRow || !blueprint || !objective || voidRow.userId !== userId || blueprint.userId !== userId || objective.userId !== userId
    || blueprint.learningVoidId !== voidRow._id || objective.blueprintRevisionId !== blueprint._id) incomplete('source_invalidated')
}

export async function normalizeLearnReportInventory(ctx: QueryCtx, run: Doc<'learnMeasurementReportRuns'>, approval: LearnReportApproval,
  userId: string, through: number, coverage: 'complete' | 'unknown', factId: Id<'learnMeasurementReportFacts'>): Promise<LearnReportInputSnapshot[]> {
  const stored = await ctx.db.get(factId)
  if (!stored || stored.userId !== userId || stored.epoch !== run.epoch || stored.sequence > through) incomplete('invalid_inventory_fact')
  const fact = factValue(stored).fact
  if (fact.kind === 'enrollment') {
    const latest = await ctx.db.query('learnMeasurementReportFacts')
      .withIndex('by_userId_and_fact_assignmentId', q => q.eq('userId', userId).eq('fact.assignmentId', fact.assignmentId)).order('desc').take(8)
    if (latest.length === 8) incomplete('assignment_history_overflow')
    const pinned = latest.filter(row => row.sequence <= through).sort((a, b) => b.sequence - a.sequence)[0]
    if (pinned?._id !== stored._id) return []
    const assignment = await ctx.db.get(fact.assignmentId)
    if (!assignment || assignment.userId !== userId || assignment.epoch !== run.epoch || assignment.cohortVersion !== run.cohortVersion) incomplete('source_invalidated')
    const enrollmentAt = fact.snapshot.enrollmentAt ?? assignment.createdAt
    if (enrollmentAt < run.enrollmentStartAt || enrollmentAt >= run.enrollmentEndAt) return []
    await scopeAvailable(ctx, userId, assignment)
    const keys = await deriveLearnReportComputationKeys({ reportRunId: run._id, ownerTokenIdentifier: userId, ...assignment })
    const common = { kind: 'episode' as const, ...keys, assignmentId: assignment._id, learningVoidId: assignment.learningVoidId,
      blueprintRevisionId: assignment.blueprintRevisionId, objectiveId: assignment.objectiveId, assignment: { ...fact.snapshot, sourceCoverage: coverage },
      coldOpportunityId: null, originalOpportunityId: null, replacementOpportunityId: null, coldAcceptance: null, delayedAcceptance: null,
      cold: null, delayed: null, coldReplacement: null, replacementClock: null, replacementAcceptance: null, replacement: null,
      replacementPolicy: null, operationalEligibility: 'pending' as const, disposition: 'missing_cold' as const,
      reasonCodes: [], mixedFlow: false, treatmentEpochChanged: false }
    if (fact.status !== 'admitted') return [learnReportEpisodeSnapshotSchema.parse({ ...common, horizonDays: 7, clock: null })]
    if (assignment.status !== 'admitted' || approval.frozenAt > enrollmentAt || assignment.protocolVersion !== run.protocolVersion) incomplete('conflicting_protocol_pins')
    const opportunities = await ctx.db.query('learnAssessmentOpportunities')
      .withIndex('by_userId_and_assignmentId_and_horizonDays', q => q.eq('userId', userId).eq('assignmentId', assignment._id)).take(8)
    if (opportunities.length === 8) incomplete('opportunity_inventory_overflow')
    const slots = []
    for (const opportunity of opportunities) {
      if (opportunity.blueprintRevisionId !== assignment.blueprintRevisionId || opportunity.objectiveId !== assignment.objectiveId) incomplete('conflicting_capability')
      const facts = await opportunityFacts(ctx, userId, opportunity._id, through)
      if (facts.length) slots.push({ opportunity, facts })
    }
    const coldSlots = slots.filter(row => row.opportunity.purpose.kind === 'measurement_cold')
    const cold = coldSlots.find(row => row.opportunity.originalSlot)
    const coldReplacement = coldSlots.find(row => !row.opportunity.originalSlot)
    if (coldSlots.length > (cold ? 1 : 0) + (coldReplacement ? 1 : 0)) incomplete('conflicting_cold_slot')
    if (coldReplacement && coldReplacement.opportunity.replacesOpportunityId !== cold?.opportunity._id) incomplete('invalid_replacement_link')
    const coldOutcome = await outcome(ctx, userId, cold?.opportunity ?? null, through, run.cutoff, run.epoch)
    const replacementOutcome = await outcome(ctx, userId, coldReplacement?.opportunity ?? null, through, run.cutoff, run.epoch)
    const rows: LearnReportInputSnapshot[] = []
    for (const horizon of [7, 30] as const) {
      if (!(horizon === 7 ? fact.snapshot.assignedDay7 : fact.snapshot.assignedDay30)) continue
      const delayedSlots = slots.filter(row => row.opportunity.purpose.kind === 'measurement_delayed' && row.opportunity.purpose.horizonDays === horizon)
      const delayed = delayedSlots.find(row => row.opportunity.originalSlot)
      const replacement = delayedSlots.find(row => !row.opportunity.originalSlot)
      if (delayedSlots.length > (delayed ? 1 : 0) + (replacement ? 1 : 0)
        || (replacement && replacement.opportunity.replacesOpportunityId !== delayed?.opportunity._id)) incomplete('invalid_replacement_link')
      const delayedOutcome = await outcome(ctx, userId, delayed?.opportunity ?? null, through, run.cutoff, run.epoch)
      const replacedOutcome = await outcome(ctx, userId, replacement?.opportunity ?? null, through, run.cutoff, run.epoch)
      rows.push(learnReportEpisodeSnapshotSchema.parse({ ...common, horizonDays: horizon,
        clock: delayed ? savedClock(delayed.facts) : null,
        coldOpportunityId: cold?.opportunity._id ?? null, originalOpportunityId: delayed?.opportunity._id ?? null,
        replacementOpportunityId: replacement?.opportunity._id ?? null, replacementClock: replacement ? savedClock(replacement.facts) : null,
        coldAcceptance: coldOutcome.acceptance, delayedAcceptance: delayedOutcome.acceptance, cold: coldOutcome.result, delayed: delayedOutcome.result,
        replacementAcceptance: replacedOutcome.acceptance, replacement: replacedOutcome.result, replacementPolicy: approval.replacementPolicy,
        operationalEligibility: delayed ? operational(delayed.facts) : 'pending',
        disposition: coldOutcome.assistanceState && coldOutcome.assistanceState !== 'unassisted' ? 'assisted_contaminated' : slotDisposition(delayed?.facts ?? [], delayedOutcome),
        mixedFlow: [coldOutcome, delayedOutcome].some(outcome => outcome.acceptance !== null && outcome.flow !== fact.snapshot.flow),
        treatmentEpochChanged: [coldOutcome, delayedOutcome].some(outcome => outcome.acceptance !== null && outcome.epoch !== fact.snapshot.epoch),
        coldReplacement: coldReplacement ? { assessmentOpportunityId: coldReplacement.opportunity._id,
          replacesOpportunityId: coldReplacement.opportunity.replacesOpportunityId, replacementReason: coldReplacement.opportunity.replacementReason,
          openAt: coldReplacement.opportunity.openAt, closeAt: coldReplacement.opportunity.closeAt,
          eligibilityPolicyVersion: coldReplacement.opportunity.eligibilityPolicyVersion, operationalEligibility: operational(coldReplacement.facts),
          acceptance: replacementOutcome.acceptance, validitySnapshot: replacementOutcome.validitySnapshot, result: replacementOutcome.result } : null,
      }))
    }
    return rows
  }
  if (fact.kind !== 'independent_claim') return []
  if (fact.firstIndependentAt < run.enrollmentStartAt || fact.firstIndependentAt >= run.enrollmentEndAt) return []
  const [basis, opportunity] = await Promise.all([ctx.db.get(fact.basisAttemptId), ctx.db.get(fact.firstCheckOpportunityId)])
  if (!basis || !opportunity || basis.userId !== userId || opportunity.userId !== userId || basis.kind !== 'independent_application'
    || basis.masteryStateAfter !== 'independent' || (!basis.masteryStateBefore || ['independent', 'retained'].includes(basis.masteryStateBefore))
    || basis.masteryRecordRevision !== fact.masteryRecordRevision || basis.masteryTransitionVersion !== fact.transitionVersion
    || (basis.serverScorePercent ?? 0) < 80 || basis.usedHint !== false || basis.usedReveal !== false
    || basis.masteryTransitionReason !== 'unassisted_pass_independent'
    || basis.assistanceSnapshot?.state !== 'unassisted' || basis.validitySnapshot?.masteryEligible !== true || basis.validitySnapshot.status !== 'valid'
    || basis.objectiveId !== opportunity.objectiveId || basis.blueprintRevisionId !== opportunity.blueprintRevisionId
    || !opportunity.originalSlot || opportunity.checkSequence !== fact.checkSequence || fact.claimFactSequence !== stored.sequence) incomplete('invalid_claim_basis')
  if (!basis.submissionId || !basis.scoringExecutionId) incomplete('invalid_claim_basis')
  const basisExecution = await ctx.db.get(basis.scoringExecutionId)
  if (!basisExecution || basisExecution.userId !== userId || basisExecution.authoritativeAttemptId !== basis._id
    || basisExecution.submissionId !== basis.submissionId || basisExecution.outcome !== 'validated'
    || basisExecution.committedAt === undefined || basisExecution.committedAt > fact.firstIndependentAt) incomplete('invalid_claim_basis')
  await scopeAvailable(ctx, userId, opportunity)
  const { kind: _kind, firstCheckOpportunityId: _id, checkSequence: _check, stratum, ...claim } = fact
  if (JSON.stringify(learnFirstCheckClaimSchema.parse(opportunity.firstCheckClaim)) !== JSON.stringify(learnFirstCheckClaimSchema.parse(claim))) incomplete('conflicting_first_slot')
  const facts = await opportunityFacts(ctx, userId, opportunity._id, through)
  const clock = savedClock(facts)
  if (!clock) incomplete('missing_first_slot_clock')
  const accepted = await outcome(ctx, userId, opportunity, through, run.cutoff, run.epoch)
  const eligibility = facts.find(row => row.fact.kind === 'opportunity' && row.fact.stateAtEligibility !== undefined)?.fact
  const disposition = slotDisposition(facts, accepted)
  return [learnReportFirstClaimSnapshotSchema.parse({ kind: 'first_check_claim',
    ...await deriveLearnReportComputationKeys({ reportRunId: run._id, ownerTokenIdentifier: userId, ...opportunity }),
    stratum, claim, firstCheckOpportunityId: opportunity._id, checkSequence: fact.checkSequence, clock,
    stateAtEligibility: eligibility?.kind === 'opportunity' ? eligibility.stateAtEligibility ?? 'unknown' : 'unknown',
    stateAtAcceptance: accepted.stateAtAcceptance, acceptance: accepted.acceptance, result: accepted.result,
    unresolvedReason: ['valid_scored', 'missing_delayed'].includes(disposition) ? null : disposition })]
}
