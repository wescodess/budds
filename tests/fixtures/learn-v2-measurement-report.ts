import {
  LEARN_V2_REPORT_SENSITIVITY_POLICY_VERSION, learnReportEstimateSchema, learnReportMetricSchema,
} from '../../shared/learn-v2-measurement-report'

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
