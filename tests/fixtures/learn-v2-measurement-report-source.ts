import type { MutationCtx } from '../../convex/_generated/server'
import type { Id } from '../../convex/_generated/dataModel'
import { seedMeasurementStorage } from './learn-v2-measurement-storage'
import { measurementReportSourceFixture } from './learn-v2-measurement-report'
import { appendLearnMeasurementFact, writeLearnMeasurementEnrollmentFact, writeLearnResponseAcceptanceFact } from '../../convex/lib/learnV2MeasurementFacts'
import { deriveLearnScorerConfiguration } from '../../shared/learn-v2-measurement'

export const REPORT_NOW = Date.UTC(2026, 9, 10)
export const REPORT_START = Date.UTC(2026, 8, 30)
export const REPORT_END = Date.UTC(2026, 9, 2)
export async function seedReportSource(ctx: MutationCtx, userId: string, mode: 'scored' | 'missing' | 'unscored' = 'scored') {
  const f = await seedMeasurementStorage(ctx, userId)
  const source = await measurementReportSourceFixture()
  const digest = `sha256:${'a'.repeat(64)}`
  const binding = { kind: 'deterministic' as const, engineVersion: 'fixture-engine.v1', thresholdVersion: 'threshold.v1', thresholdPercent: 80 as const, transitionVersion: 'learn-v2.mastery-transition.v1' as const }
  const configuration = await deriveLearnScorerConfiguration(binding)
  for (const table of ['learnMeasurementReportRows', 'learnMeasurementReportCells', 'learnMeasurementReportRuns', 'learnMeasurementReportViewerGrants', 'learnMeasurementReportFacts', 'learnMeasurementSourceWatermarks', 'learnResponseIntegrityEvents'] as const) {
    for (const row of await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(8)) await ctx.db.delete(row._id)
  }
  await ctx.db.patch(f.documentId, { status: 'success' })
  const assignment = (await ctx.db.get(f.rows.learnMeasurementAssignments))!
  if (assignment.status !== 'admitted' || assignment.allocation.kind !== 'three_case') throw new Error('Invalid report fixture')
  const pins = { cold: { ...assignment.allocation.cold, supportManifestDigest: digest }, delayed: { ...assignment.allocation.day7, supportManifestDigest: digest } }
  await ctx.db.patch(assignment._id, { allocation: { kind: 'two_case', horizonDays: 7, ...pins }, scoringBinding: binding,
    enrollmentAt: source.episode.assignment.enrollmentAt!, anchorAt: source.episode.assignment.anchorAt,
    anchorEventId: 'fixture-cold', enrollmentTimezone: 'UTC', assessmentContractDigest: digest })
  await writeLearnMeasurementEnrollmentFact(ctx, userId, (await ctx.db.get(assignment._id))!)
  const clock = { ...source.episode.clock!, protocolVersion: 'protocol.fixture' }
  const cold = (await ctx.db.get(f.rows.learnAssessmentOpportunities))!
  const { _id: _coldId, _creationTime: _coldTime, ...opportunityFields } = cold
  await ctx.db.patch(cold._id, { scoringBinding: binding, assessmentContractDigest: digest, assessmentPins: { kind: 'measurement', itemPins: pins.cold }, phase: 'ready', submissionId: undefined,
    openAt: source.episode.assignment.anchorAt!, closeAt: source.episode.assignment.anchorAt! + 86_400_000 })
  const delayedId = await ctx.db.insert('learnAssessmentOpportunities', { ...opportunityFields, scoringBinding: binding, assessmentContractDigest: digest,
    delayedCheckId: 'fixture-delayed', purpose: { kind: 'measurement_delayed', assignmentId: assignment._id, horizonDays: 7, clock },
    assessmentPins: { kind: 'measurement', itemPins: pins.delayed }, horizonDays: 7, phase: 'ready', submissionId: undefined,
    openAt: clock.openAt, closeAt: clock.closeAt, dueAt: clock.dueAt })
  for (const id of [cold._id, delayedId]) {
    const opportunity = (await ctx.db.get(id))!
    await appendLearnMeasurementFact(ctx, userId, { epoch: assignment.epoch, learningVoidId: f.learningVoidId, occurredAt: clock.openAt,
      fact: { kind: 'opportunity', assessmentOpportunityId: id, recordRevision: 1, status: 'eligible', dueAt: opportunity.dueAt ?? null,
        closeAt: opportunity.closeAt, clock: id === delayedId ? clock : null, originalSlot: true, stateAtEligibility: 'independent' } })
  }
  const originalResponse = (await ctx.db.get(f.rows.learnResponses))!
  if (!('baselineEpoch' in originalResponse)) throw new Error('Expected legacy assessment fixture response')
  const originalExecution = (await ctx.db.get(f.rows.learnScoringExecutions))!
  await ctx.db.delete(originalResponse._id)
  const { _id: _responseId, _creationTime: _responseTime, ...responseFields } = originalResponse
  const { _id: _executionId, _creationTime: _executionTime, ...executionFields } = originalExecution
  const outcomes: { submissionId: Id<'learnResponses'>, executionId?: Id<'learnScoringExecutions'>, attemptId?: Id<'masteryAttempts'> }[] = []
  if (mode !== 'missing') for (const [index, id] of [cold._id, delayedId].entries()) {
    const itemPins = index ? pins.delayed : pins.cold
    const acceptedAt = index ? clock.openAt : source.episode.assignment.anchorAt!
    const submissionId = await ctx.db.insert('learnResponses', { ...responseFields, acceptedAt, scoringBinding: binding,
      assessmentOpportunityId: id, assessmentPins: { kind: 'measurement', itemPins }, currentEligibility: 'eligible' })
    await ctx.db.patch(id, { submissionId })
    await ctx.db.insert('learnResponseEvidenceLinks', { ...f.base, learningVoidId: f.learningVoidId, aggregate: { learningVoidId: f.learningVoidId },
      submissionId, evidenceStatus: 'available', dependency: { kind: 'snapshot', sourceSnapshotId: f.sourceSnapshotId,
        sourceSnapshotRevision: 1, sourceRecordRevision: 1, supportManifestDigest: 'support-hash' } })
    await writeLearnResponseAcceptanceFact(ctx, userId, (await ctx.db.get(submissionId))!, assignment.epoch, 'independent')
    if (mode === 'unscored' && index) { outcomes.push({ submissionId }); continue }
    const scorePercent = index ? 40 : 60
    const committedAt = acceptedAt + 1000
    const executionId = await ctx.db.insert('learnScoringExecutions', { ...executionFields, assessmentOpportunityId: id, submissionId,
      scoringBinding: binding, assessmentPins: { kind: 'measurement', itemPins }, observedIdentity: { status: 'deterministic', engineVersion: binding.engineVersion },
      dispatchedAt: acceptedAt, outcome: 'validated', committedAt, integrityResult: 'valid', verdict: { criterionResults: [], misconceptionTags: [], scorePercent, verdictDigest: 'fixture-verdict', responseDigest: 'fixture-response' } })
    const common = { userId, blueprintRevisionId: f.scope.blueprintRevisionId, objectiveId: f.scope.objectiveId, attemptedAt: acceptedAt,
      idempotencyKey: `fixture-${index}`, serverScorePercent: scorePercent, submissionId, assessmentOpportunityId: id, scoringExecutionId: executionId,
      measurementStorage: { version: 'learn-v2.measurement-storage.v1' as const, scope: f.scope, assessmentOpportunityId: id, submissionId, executionId,
        itemPins, scoringBinding: binding, assistanceSnapshot: f.assistanceSnapshot, validitySnapshot: f.validitySnapshot,
        acceptedAt, scoreCommittedAt: committedAt, requestedScorerModel: null, returnedScorerModel: null } }
    const attemptId = index ? await ctx.db.insert('masteryAttempts', { ...common, kind: 'measurement_delayed', horizonDays: 7 })
      : await ctx.db.insert('masteryAttempts', { ...common, kind: 'measurement_cold' })
    await ctx.db.patch(executionId, { authoritativeAttemptId: attemptId })
    const template = index ? source.delayed : source.cold
    await appendLearnMeasurementFact(ctx, userId, { epoch: assignment.epoch, learningVoidId: f.learningVoidId, occurredAt: committedAt,
      fact: { kind: 'score', submissionId, attemptId, executionId, scorePercent, scoreCommittedAt: committedAt,
        snapshot: { ...template, ...configuration, submissionId, attemptId, executionId, acceptedAt, scoreCommittedAt: committedAt,
          caseId: itemPins.caseId, itemId: itemPins.itemId, familyRevision: itemPins.familyRevision,
          assistancePolicyVersion: f.assistanceSnapshot.policyVersion } } })
    outcomes.push({ submissionId, executionId, attemptId })
  }
  const watermark = (await ctx.db.query('learnMeasurementSourceWatermarks').withIndex('by_userId', q => q.eq('userId', userId)).unique())!
  await ctx.db.patch(watermark._id, { historyCoverage: 'complete', dueWorkThrough: REPORT_NOW })
  return { ...f, outcomes, delayedId, clock, configuration, binding, watermarkId: watermark._id }
}

export async function seedOrdinaryReportClaim(ctx: MutationCtx, f: Awaited<ReturnType<typeof seedReportSource>>, captured = true) {
  const source = await measurementReportSourceFixture()
  const userId = f.base.userId
  const cold = (await ctx.db.get(f.rows.learnAssessmentOpportunities))!
  const { _id: _id, _creationTime: _time, ...fields } = cold
  const clock = { ...f.clock, anchorKind: 'first_independent' }
  const firstCheckOpportunityId = await ctx.db.insert('learnAssessmentOpportunities', { ...fields, assignmentId: undefined,
    purpose: { kind: 'independent_application' }, delayedCheckId: 'ordinary-first',
    submissionId: undefined, originalSlot: true, checkSequence: 1, openAt: clock.openAt, closeAt: clock.closeAt,
    assessmentPins: { kind: 'session_application', caseId: f.itemPins.caseId, promptDigest: 'fixture-prompt', rubricVersion: 'rubric.v1', rubricDigest: 'fixture-rubric', supportManifestDigest: 'fixture-support' } })
  const response = (await ctx.db.get(f.outcomes[0]!.submissionId))!
  if (!('baselineEpoch' in response)) throw new Error('Expected legacy assessment fixture response')
  const { _id: _response, _creationTime: _responseTime, ...responseFields } = response
  const basisSubmissionId = await ctx.db.insert('learnResponses', { ...responseFields, assessmentOpportunityId: firstCheckOpportunityId,
    validitySnapshot: { ...f.validitySnapshot, masteryEligible: true }, acceptedAt: source.claim.claim.firstIndependentAt })
  const execution = (await ctx.db.get(f.outcomes[0]!.executionId!))!
  const { _id: _execution, _creationTime: _executionTime, ...executionFields } = execution
  const executionId = await ctx.db.insert('learnScoringExecutions', { ...executionFields, submissionId: basisSubmissionId,
    assessmentOpportunityId: firstCheckOpportunityId, committedAt: source.claim.claim.firstIndependentAt })
  const basisAttemptId = await ctx.db.insert('masteryAttempts', { userId, blueprintRevisionId: f.scope.blueprintRevisionId,
    objectiveId: f.scope.objectiveId, kind: 'independent_application', idempotencyKey: 'ordinary-basis', attemptedAt: source.claim.claim.firstIndependentAt,
    serverScorePercent: 80, usedHint: false, usedReveal: false, masteryStateBefore: 'guided', masteryStateAfter: 'independent', masteryRecordRevision: 1,
    masteryTransitionVersion: 'learn-v2.mastery-transition.v1', masteryTransitionReason: 'unassisted_pass_independent', submissionId: basisSubmissionId,
    scoringExecutionId: executionId, assistanceSnapshot: f.assistanceSnapshot, validitySnapshot: { ...f.validitySnapshot, masteryEligible: true } })
  await ctx.db.patch(executionId, { authoritativeAttemptId: basisAttemptId, verdict: { ...execution.verdict!, scorePercent: 80 } })
  const watermark = (await ctx.db.get(f.watermarkId))!
  const claim = { ...source.claim.claim, claimKey: 'ordinary-first', basisAttemptId, claimFactSequence: watermark.sequence + 1 }
  // This is a distinct scheduled first check; its basis acceptance belongs to an earlier opportunity.
  const basisOpportunityId = await ctx.db.insert('learnAssessmentOpportunities', { ...fields, assignmentId: undefined, delayedCheckId: 'ordinary-basis',
    purpose: { kind: 'independent_application' }, firstCheckClaim: undefined, submissionId: basisSubmissionId, originalSlot: false })
  await ctx.db.patch(basisSubmissionId, { assessmentOpportunityId: basisOpportunityId })
  await ctx.db.patch(executionId, { assessmentOpportunityId: basisOpportunityId })
  await ctx.db.patch(firstCheckOpportunityId, { firstCheckClaim: claim, purpose: { kind: 'retained_transfer', basisAttemptId, clock } })
  await appendLearnMeasurementFact(ctx, userId, { epoch: 'fixture-epoch', learningVoidId: f.learningVoidId, occurredAt: claim.firstIndependentAt,
    fact: { kind: 'independent_claim', ...claim, firstCheckOpportunityId, checkSequence: 1,
      stratum: { ...source.claim.stratum, epoch: 'fixture-epoch', familyId: null, familyRevision: null,
        equivalenceVersion: null, responseKind: 'bounded_rubric', scorerConfiguration: f.configuration } } })
  await appendLearnMeasurementFact(ctx, userId, { epoch: 'fixture-epoch', learningVoidId: f.learningVoidId, occurredAt: clock.openAt,
    fact: { kind: 'opportunity', assessmentOpportunityId: firstCheckOpportunityId, recordRevision: 1, status: 'blocked', dueAt: clock.dueAt,
      closeAt: clock.closeAt, clock, originalSlot: true, ...(captured ? { stateAtEligibility: 'independent' as const } : {}) } })
  return { firstCheckOpportunityId, claim }
}
