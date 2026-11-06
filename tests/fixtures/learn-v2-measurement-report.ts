import {
  LEARN_V2_REPORT_SENSITIVITY_POLICY_VERSION, learnReportEstimateSchema, learnReportMetricSchema,
  deriveLearnReportComputationKeys, learnReportEpisodeSnapshotSchema, learnReportFirstClaimSnapshotSchema,
  learnReportResultSnapshotSchema, learnReportWatermarkSnapshotSchema,
} from '../../shared/learn-v2-measurement-report'

export async function measurementReportSourceFixture() {
  const keys = await deriveLearnReportComputationKeys({ reportRunId: 'run1', ownerTokenIdentifier: 'https://fixture.example|owner',
    blueprintRevisionId: 'blueprint1', objectiveId: 'objective1' })
  const anchorAt = Date.UTC(2026, 9, 1)
  const openAt = Date.UTC(2026, 9, 8)
  const digest = `sha256:${'a'.repeat(64)}`
  const scorerConfiguration = { scoringKind: 'deterministic', configurationDigest: digest, scorerVersion: 'scorer.v1' }
  const stratum = { epoch: 'epoch.v1', baselineSha: 'a'.repeat(40), cohortVersion: 'cohort.v1', flow: 'v2_today', entryPoint: 'today.v1', depth: 'working',
    familyId: 'family1', familyRevision: 1, familyValidationStatus: 'provisional_equivalent', equivalenceVersion: 'equivalence.v1', responseKind: 'keyed', scorerConfiguration }
  const clock = { protocolVersion: 'protocol.v1', schedulingPolicyVersion: 'schedule.v1', anchorKind: 'sealed_cold', anchorEventId: 'cold1', anchorAt,
    horizonDays: 7, timezone: 'UTC', dueLocalDate: '2026-10-08', dueAt: openAt, openAt, closeAt: openAt + 86_400_000 }
  const episode = learnReportEpisodeSnapshotSchema.parse({ kind: 'episode', ...keys, assignmentId: 'assignment1',
    learningVoidId: 'void1', blueprintRevisionId: 'blueprint1', objectiveId: 'objective1', horizonDays: 7,
    assignment: { ...stratum, status: 'admitted', protocolStatus: 'frozen', protocolVersion: 'protocol.v1', enrollmentAt: anchorAt - 1, timezone: 'UTC', anchorAt, anchorKind: 'sealed_cold',
      historyStatus: 'prospectively_unexposed', allocationOrder: 'ABC', assignedDay7: true, assignedDay30: true, sourceCoverage: 'complete' },
    clock, coldOpportunityId: 'coldOpportunity1', originalOpportunityId: 'delayedOpportunity1', replacementOpportunityId: null,
    coldAcceptance: { submissionId: 'coldSubmission1', acceptedAt: anchorAt }, delayedAcceptance: { submissionId: 'delayedSubmission1', acceptedAt: openAt },
    cold: null, delayed: null, replacementClock: null, replacementAcceptance: null, replacement: null, replacementPolicy: { kind: 'secondary_only' },
    operationalEligibility: 'eligible', disposition: 'scoring_pending', reasonCodes: ['scoring_pending'], mixedFlow: false, treatmentEpochChanged: false })
  const claim = learnReportFirstClaimSnapshotSchema.parse({ kind: 'first_check_claim', ...keys, stratum,
    claim: { claimKey: 'claim1', claimSequence: 1, basisAttemptId: 'basisAttempt1', masteryRecordRevision: 1,
      firstIndependentAt: anchorAt, firstIndependentLocalDate: '2026-10-01', firstIndependentTimezone: 'UTC',
      transitionVersion: 'learn-v2.mastery-transition.v1', claimFactSequence: 1 },
    firstCheckOpportunityId: 'delayedOpportunity1', checkSequence: 1,
    clock: { ...clock, anchorKind: 'first_independent', anchorEventId: 'basisAttempt1' }, stateAtEligibility: 'independent', stateAtAcceptance: 'independent',
    acceptance: episode.delayedAcceptance, result: null, unresolvedReason: 'scoring_pending' })
  const watermark = learnReportWatermarkSnapshotSchema.parse({ kind: 'owner_watermark', learnerKey: keys.learnerKey,
    sequence: 1, dueWorkThrough: clock.closeAt, historyCoverage: 'complete', legacyIndependentAudit: { unknownCount: 0, sourceCoverage: 'complete' } })
  const cold = learnReportResultSnapshotSchema.parse({ ...episode.coldAcceptance, attemptId: 'coldAttempt1', executionId: 'coldExecution1', kind: 'measurement_cold',
    scoreCommittedAt: clock.closeAt + 1000, scorePercent: 60, thresholdPercent: 80, caseId: 'caseA', itemId: 'itemA', familyRevision: 1, formLabel: 'A',
    ...scorerConfiguration, observedModel: null, observedUpstream: null, identityVersion: 'identity.v1', identityStatus: 'deterministic',
    comparisonContractDigest: digest, supportManifestDigest: digest, assistanceState: 'unassisted', assistancePolicyVersion: 'assistance.v1',
    validityStatus: 'valid', exclusionReasons: [], measurementEligible: true, masteryEligible: false, evidenceAvailable: true,
    pasteObserved: 'unknown', focusLossObserved: 'unknown', instrumentationVersion: 'instrumentation.v1', masteryStateBefore: 'unseen', masteryStateAfter: 'unseen' })
  const delayed = learnReportResultSnapshotSchema.parse({ ...cold, ...episode.delayedAcceptance, attemptId: 'delayedAttempt1', executionId: 'delayedExecution1',
    kind: 'measurement_delayed', scorePercent: 40, caseId: 'caseB', itemId: 'itemB', formLabel: 'B' })
  return { keys, episode, claim, watermark, cold, delayed }
}

export async function measurementReportNonAdmittedFixture(status: 'considered' | 'not_admitted', protocolStatus: 'protocol_not_frozen' | 'blocked') {
  const source = await measurementReportSourceFixture()
  const episode = learnReportEpisodeSnapshotSchema.parse({ ...source.episode,
    assignment: { ...source.episode.assignment, status, protocolStatus, protocolVersion: null, enrollmentAt: null, timezone: null,
      anchorAt: null, anchorKind: null, allocationOrder: null, responseKind: null, scorerConfiguration: null,
      familyId: null, familyRevision: null, familyValidationStatus: 'unknown', equivalenceVersion: null,
      assignedDay7: false, assignedDay30: false },
    clock: null, coldOpportunityId: null, originalOpportunityId: null, coldAcceptance: null, delayedAcceptance: null,
    operationalEligibility: 'blocked', replacementPolicy: null, disposition: 'missing_cold', reasonCodes: [protocolStatus] })
  return { ...source, episode }
}

export async function measurementReportIdentityFixture() {
  const source = await measurementReportSourceFixture()
  const { cold, delayed, claim } = source
  const replacementClock = { ...source.episode.clock!, dueAt: claim.clock.dueAt + 3_600_000,
    openAt: claim.clock.openAt + 3_600_000, closeAt: claim.clock.closeAt + 86_400_000 }
  const replacement = learnReportResultSnapshotSchema.parse({ ...delayed, submissionId: 'replacementSubmission1',
    acceptedAt: replacementClock.openAt, scoreCommittedAt: replacementClock.openAt + 1000,
    attemptId: 'replacementAttempt1', executionId: 'replacementExecution1', caseId: 'caseD', itemId: 'itemD', formLabel: 'D' })
  const episode = learnReportEpisodeSnapshotSchema.parse({ ...source.episode, cold, delayed,
    replacementOpportunityId: 'replacementOpportunity1', replacementClock,
    replacementAcceptance: { submissionId: replacement.submissionId, acceptedAt: replacement.acceptedAt }, replacement })
  const openAt = claim.clock.anchorAt + 30 * 86_400_000
  const day30Delayed = learnReportResultSnapshotSchema.parse({ ...delayed, submissionId: 'day30Submission',
    attemptId: 'day30Attempt', executionId: 'day30Execution', acceptedAt: openAt, scoreCommittedAt: openAt + 1000,
    caseId: 'caseC', itemId: 'itemC', formLabel: 'C' })
  const day30Replacement = learnReportResultSnapshotSchema.parse({ ...day30Delayed, submissionId: 'day30ReplacementSubmission',
    acceptedAt: openAt + 3_600_000, scoreCommittedAt: openAt + 3_600_000 + 1000,
    attemptId: 'day30ReplacementAttempt', executionId: 'day30ReplacementExecution', caseId: 'caseE', itemId: 'itemE', formLabel: 'E' })
  const day30 = learnReportEpisodeSnapshotSchema.parse({ ...episode, horizonDays: 30,
    clock: { ...claim.clock, horizonDays: 30, dueLocalDate: '2026-10-31', dueAt: openAt, openAt, closeAt: openAt + 86_400_000 },
    replacementClock: { ...replacementClock, horizonDays: 30, dueLocalDate: '2026-10-31', dueAt: openAt + 3_600_000,
      openAt: openAt + 3_600_000, closeAt: openAt + 2 * 86_400_000 },
    originalOpportunityId: 'day30Opportunity', delayedAcceptance: { submissionId: day30Delayed.submissionId, acceptedAt: day30Delayed.acceptedAt }, delayed: day30Delayed,
    replacementOpportunityId: 'day30ReplacementOpportunity', replacementAcceptance: { submissionId: day30Replacement.submissionId, acceptedAt: day30Replacement.acceptedAt }, replacement: day30Replacement })
  const otherAssignment = learnReportEpisodeSnapshotSchema.parse({ ...episode, assignmentId: 'assignment2', coldOpportunityId: 'otherColdOpportunity',
    coldAcceptance: { ...episode.coldAcceptance, submissionId: 'otherColdSubmission' },
    cold: { ...cold, submissionId: 'otherColdSubmission', attemptId: 'otherColdAttempt', executionId: 'otherColdExecution' },
    originalOpportunityId: 'otherDelayedOpportunity', delayedAcceptance: { ...episode.delayedAcceptance, submissionId: 'otherDelayedSubmission' },
    delayed: { ...delayed, submissionId: 'otherDelayedSubmission', attemptId: 'otherDelayedAttempt', executionId: 'otherDelayedExecution' },
    replacementOpportunityId: 'otherReplacementOpportunity', replacementAcceptance: { ...episode.replacementAcceptance, submissionId: 'otherReplacementSubmission' },
    replacement: { ...replacement, submissionId: 'otherReplacementSubmission', attemptId: 'otherReplacementAttempt', executionId: 'otherReplacementExecution' } })
  return { ...source, episode, day30, otherAssignment }
}

// A visible measurement or retained-check attempt cannot be an Independent basis (#364 §5).
export async function measurementReportBasisFixture(endpoint: 'cold' | 'delayed' | 'replacement' | 'claim') {
  const source = await measurementReportIdentityFixture()
  const original = endpoint === 'claim' ? source.delayed : source.episode[endpoint]!
  const basis = original
  const firstIndependentAt = basis.acceptedAt
  const openAt = firstIndependentAt + 7 * 86_400_000
  const claim = learnReportFirstClaimSnapshotSchema.parse({ ...source.claim,
    claim: { ...source.claim.claim, claimKey: 'basisJoinClaim', basisAttemptId: basis.attemptId,
      firstIndependentAt, firstIndependentLocalDate: new Date(firstIndependentAt).toISOString().slice(0, 10) },
    firstCheckOpportunityId: 'basisJoinFirstOpportunity', acceptance: null, stateAtAcceptance: null,
    clock: { ...source.claim.clock, anchorEventId: basis.attemptId, anchorAt: firstIndependentAt,
      dueLocalDate: new Date(openAt).toISOString().slice(0, 10), dueAt: openAt, openAt, closeAt: openAt + 86_400_000 } })
  const basisRow = endpoint === 'claim'
    ? learnReportFirstClaimSnapshotSchema.parse({ ...source.claim, stratum: { ...source.claim.stratum, epoch: 'previous.epoch' }, result: basis })
    : learnReportEpisodeSnapshotSchema.parse({ ...source.episode, [endpoint]: basis })
  return { ...source, claim, basis, basisRow }
}

export function emptyMeasurementEstimate() {
  return learnReportEstimateSchema.parse({ population: 0, observed: 0, contributingLearners: 0,
    status: 'no_eligible_population', populationState: 'known', sourceCoverage: 'complete', outcomeCoverage: 'none', validity: 'provisional',
    precision: 'insufficient_clusters', observedValue: null, allEligibleValue: null, missingOutcomeBounds: null, confidenceInterval: null,
    reasonCodes: ['no_eligible_population', 'insufficient_clusters'] })
}
const orderCounts = () => ({ ABC: 0, ACB: 0, BAC: 0, BCA: 0, CAB: 0, CBA: 0, AB: 0, BA: 0, unknown: 0 })
const formCounts = () => ({ A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, unknown: 0 })
const bandCounts = () => ({ population: 0, accepted: 0, validScored: 0, paired: 0 })
const sourceReason = () => ({ covered: 0, affected: 0, unknown: 0 })

export function emptyMeasurementReportCell() {
  const { population: _population, observed: _observed, contributingLearners: _learners, ...estimate } = emptyMeasurementEstimate()
  return learnReportMetricSchema.parse({ metric: 'verified_learning_gain.v1', horizonDays: 7, weighting: 'capability_episode',
    stratum: { flow: 'v2_today', entryPoint: 'today.v1', depth: 'working', startingBand: 'all', responseKind: 'keyed',
      scoringKind: 'deterministic', configurationDigest: `sha256:${'a'.repeat(64)}`, observedModel: null, observedUpstream: null, familyValidationStatus: 'provisional_equivalent' },
    ...estimate,
    legacyIndependentAudit: { unknownCount: 0, sourceCoverage: 'complete' },
    counts: { considered: 0, notAdmitted: 0, horizonNotAssigned: 0, anchorNotStarted: 0, notYetDue: 0, windowOpen: 0,
      maturedEpisodes: 0, operationallyEligible: 0, acceptedSubmissions: 0, validDelayedScores: 0, validColdScores: 0, comparablePairs: 0,
      maturedClaims: 0, checkedClaims: 0, failedClaims: 0, acceptedColdSubmissions: 0, acceptedClaims: 0,
      dispositions: { missing_cold: 0, missing_delayed: 0, abandoned: 0, assisted_contaminated: 0, invalid_item_novelty: 0,
        evidence_unavailable: 0, pin_flow_treatment_mismatch: 0, access_provider_blocked: 0, scoring_pending: 0, reconciliation_required: 0, valid_scored: 0 },
      distinctLearners: { maturedEpisodes: 0, operationallyEligible: 0, acceptedSubmissions: 0, validDelayedScores: 0, validColdScores: 0,
        comparablePairs: 0, maturedClaims: 0, checkedClaims: 0, failedClaims: 0 } },
    replacements: { policy: { kind: 'secondary_only' }, originalPopulation: 0, withLinkedReplacement: 0, withAcceptedReplacement: 0,
      withValidReplacement: 0, withComparableReplacement: 0, primaryIncludedPairs: 0, secondary: emptyMeasurementEstimate() },
    instrumentation: { pasteFlagged: 0, focusFlagged: 0, eitherFlagged: 0, unknownUnflagged: 0, knownUnflagged: 0,
      pasteUnknown: 0, focusUnknown: 0, unknownInstrumentation: 0, flaggedWithUnknownInstrumentation: 0 },
    sensitivity: { policyVersion: LEARN_V2_REPORT_SENSITIVITY_POLICY_VERSION, excludingFlagged: emptyMeasurementEstimate() },
    allocations: { assignedOrders: orderCounts(), observedOrders: orderCounts(), assignedColdForms: formCounts(), observedColdForms: formCounts(),
      assignedDelayedForms: formCounts(), observedDelayedForms: formCounts() },
    sourceAccounting: { population: 0, missingT0: sourceReason(), unknownExposure: sourceReason(), exhaustedInventory: sourceReason(),
      purgedEvidence: sourceReason(), replacement: sourceReason(), treatmentChange: sourceReason(), outsideHelpUncertainty: sourceReason() },
    attritionByStartingBand: { below40: bandCounts(), from40To80: bandCounts(), from80To100: bandCounts(), unknown: bandCounts() },
  })
}

export function partialMeasurementReportCell() {
  const cell = emptyMeasurementReportCell()
  cell.status = 'partial_observed'
  cell.outcomeCoverage = 'partial'
  cell.observedValue = -20
  cell.missingOutcomeBounds = { lower: -30, upper: 20 }
  cell.legacyIndependentAudit.unknownCount = 3
  cell.reasonCodes = ['missing_delayed', 'insufficient_clusters']
  Object.assign(cell.counts, { considered: 3, notAdmitted: 1, maturedEpisodes: 2, operationallyEligible: 2,
    acceptedSubmissions: 1, validDelayedScores: 1, validColdScores: 2, comparablePairs: 1, acceptedColdSubmissions: 2 })
  cell.counts.dispositions.missing_delayed = 1
  cell.counts.dispositions.valid_scored = 1
  Object.assign(cell.counts.distinctLearners, { maturedEpisodes: 2, operationallyEligible: 2, acceptedSubmissions: 1, validDelayedScores: 1, validColdScores: 2, comparablePairs: 1 })
  Object.assign(cell.replacements, { originalPopulation: 2, withLinkedReplacement: 1,
    secondary: { ...emptyMeasurementEstimate(), population: 1, status: 'insufficient_data', missingOutcomeBounds: { lower: -40, upper: 60 }, reasonCodes: ['scoring_pending', 'insufficient_clusters'] } })
  cell.instrumentation = { pasteFlagged: 1, focusFlagged: 1, eitherFlagged: 1, unknownUnflagged: 1, knownUnflagged: 0,
    pasteUnknown: 1, focusUnknown: 1, unknownInstrumentation: 1, flaggedWithUnknownInstrumentation: 0 }
  cell.sensitivity.excludingFlagged = { ...emptyMeasurementEstimate(), population: 1, status: 'insufficient_data',
    missingOutcomeBounds: { lower: -40, upper: 60 }, reasonCodes: ['missing_delayed', 'insufficient_clusters'] }
  cell.allocations.assignedOrders.ABC = 2
  cell.allocations.observedOrders.ABC = 1
  cell.allocations.assignedColdForms.A = 2
  cell.allocations.observedColdForms.A = 2
  cell.allocations.assignedDelayedForms.B = 2
  cell.allocations.observedDelayedForms.B = 1
  cell.sourceAccounting.population = 3
  for (const reason of [cell.sourceAccounting.missingT0, cell.sourceAccounting.unknownExposure, cell.sourceAccounting.exhaustedInventory,
    cell.sourceAccounting.purgedEvidence, cell.sourceAccounting.replacement, cell.sourceAccounting.treatmentChange, cell.sourceAccounting.outsideHelpUncertainty]) reason.covered = 3
  cell.sourceAccounting.missingT0.affected = 1
  cell.sourceAccounting.unknownExposure.affected = 1
  cell.sourceAccounting.replacement.affected = 1
  cell.sourceAccounting.outsideHelpUncertainty.affected = 3
  cell.attritionByStartingBand.from40To80 = { population: 2, accepted: 1, validScored: 1, paired: 1 }
  return learnReportMetricSchema.parse(cell)
}
