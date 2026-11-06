import { v, type Validator } from 'convex/values'
import type { z } from 'zod'
import {
  LEARN_V2_REPORT_RESPONSE_KINDS, LEARN_V2_REPORT_SENSITIVITY_POLICY_VERSION, LEARN_V2_REPORT_STARTING_BANDS,
  LEARN_V2_REPORT_STATUSES, LEARN_V2_REPORT_DISPOSITIONS, type learnReportMetricSchema,
  type learnReportAssignmentSnapshotSchema, type learnReportResultSnapshotSchema, type learnReportInputSnapshotSchema,
} from '../../shared/learn-v2-measurement-report'

const literals = <const T extends string>(values: readonly T[]) => v.union(...values.map(value => v.literal(value)))
const nullableNumber = v.union(v.number(), v.null())
const nullableString = v.union(v.string(), v.null())
const sourceCoverage = literals(['complete', 'unknown'])
const responseKind = literals(LEARN_V2_REPORT_RESPONSE_KINDS)
const familyStatus = literals(['provisional_equivalent', 'empirically_supported', 'quarantined', 'retired', 'unknown'])
const masteryState = literals(['unseen', 'learning', 'guided', 'independent', 'retained', 'needs_review', 'blocked', 'provisionally_known'])
const replacementPolicy = v.union(v.object({ kind: v.literal('secondary_only') }),
  v.object({ kind: v.literal('predeclared'), protocolVersion: v.string(), ruleVersion: v.string(), ruleDigest: v.string() }))
const interval = v.union(v.object({ lower: v.number(), upper: v.number() }), v.null())
const estimateFields = {
  status: literals(LEARN_V2_REPORT_STATUSES), populationState: literals(['known', 'unknown']), sourceCoverage,
  outcomeCoverage: literals(['none', 'partial', 'complete', 'unknown']), validity: literals(['verified', 'provisional', 'quarantined', 'unknown']),
  precision: literals(['available', 'insufficient_clusters', 'insufficient_variation', 'unknown']),
  observedValue: nullableNumber, allEligibleValue: nullableNumber, missingOutcomeBounds: interval, confidenceInterval: interval, reasonCodes: v.array(v.string()),
}
const estimate = v.object({ population: v.number(), observed: v.number(), contributingLearners: v.number(), ...estimateFields })
const distinctCounts = {
  maturedEpisodes: v.number(), operationallyEligible: v.number(), acceptedSubmissions: v.number(), validDelayedScores: v.number(),
  validColdScores: v.number(), comparablePairs: v.number(), maturedClaims: v.number(), checkedClaims: v.number(), failedClaims: v.number(),
}
const orderCounts = v.object({ ABC: v.number(), ACB: v.number(), BAC: v.number(), BCA: v.number(), CAB: v.number(), CBA: v.number(), AB: v.number(), BA: v.number(), unknown: v.number() })
const formCounts = v.object({ A: v.number(), B: v.number(), C: v.number(), D: v.number(), E: v.number(), F: v.number(), unknown: v.number() })
const sourceReason = v.object({ covered: v.number(), affected: v.number(), unknown: v.number() })
const bandCounts = v.object({ population: v.number(), accepted: v.number(), validScored: v.number(), paired: v.number() })

// Reused verbatim by stored cells, public pages and aggregate export pages.
export const learnReportMetricValidator = v.object({
  metric: literals(['verified_learning_gain.v1', 'false_mastery_next_delayed.v1']), horizonDays: v.union(v.literal(7), v.literal(30)),
  weighting: literals(['capability_episode', 'learner_sensitivity']), stratum: v.object({
    flow: literals(['v2_today', 'v2_canvas']), entryPoint: v.string(), depth: literals(['foundational', 'working', 'advanced']),
    startingBand: literals(LEARN_V2_REPORT_STARTING_BANDS), responseKind: literals(LEARN_V2_REPORT_RESPONSE_KINDS), scoringKind: literals(['deterministic', 'model']),
    configurationDigest: v.string(), observedModel: nullableString, observedUpstream: nullableString,
    familyValidationStatus: familyStatus,
  }), ...estimateFields,
  legacyIndependentAudit: v.object({ unknownCount: nullableNumber, sourceCoverage }),
  counts: v.object({
    considered: v.number(), notAdmitted: v.number(), horizonNotAssigned: v.number(), anchorNotStarted: v.number(), notYetDue: v.number(), windowOpen: v.number(),
    ...distinctCounts, distinctLearners: v.object(distinctCounts), acceptedColdSubmissions: v.number(), acceptedClaims: v.number(),
    dispositions: v.object({ missing_cold: v.number(), missing_delayed: v.number(), abandoned: v.number(), assisted_contaminated: v.number(),
      invalid_item_novelty: v.number(), evidence_unavailable: v.number(), pin_flow_treatment_mismatch: v.number(), access_provider_blocked: v.number(),
      scoring_pending: v.number(), reconciliation_required: v.number(), valid_scored: v.number() }),
  }),
  replacements: v.object({
    policy: replacementPolicy,
    originalPopulation: v.number(), withLinkedReplacement: v.number(), withAcceptedReplacement: v.number(), withValidReplacement: v.number(),
    withComparableReplacement: v.number(), primaryIncludedPairs: v.number(), secondary: estimate,
  }),
  instrumentation: v.object({ pasteFlagged: v.number(), focusFlagged: v.number(), eitherFlagged: v.number(), unknownUnflagged: v.number(), knownUnflagged: v.number(),
    pasteUnknown: v.number(), focusUnknown: v.number(), unknownInstrumentation: v.number(), flaggedWithUnknownInstrumentation: v.number() }),
  sensitivity: v.object({ policyVersion: v.literal(LEARN_V2_REPORT_SENSITIVITY_POLICY_VERSION), excludingFlagged: estimate }),
  allocations: v.object({ assignedOrders: orderCounts, observedOrders: orderCounts,
    assignedColdForms: formCounts, observedColdForms: formCounts, assignedDelayedForms: formCounts, observedDelayedForms: formCounts }),
  sourceAccounting: v.object({ population: v.number(), missingT0: sourceReason, unknownExposure: sourceReason, exhaustedInventory: sourceReason,
    purgedEvidence: sourceReason, replacement: sourceReason, treatmentChange: sourceReason, outsideHelpUncertainty: sourceReason }),
  attritionByStartingBand: v.object({ below40: bandCounts, from40To80: bandCounts, from80To100: bandCounts, unknown: bandCounts }),
}) satisfies Validator<z.infer<typeof learnReportMetricSchema>, 'required', string>

const scorerConfiguration = v.object({ scoringKind: literals(['deterministic', 'model']), configurationDigest: v.string(), scorerVersion: v.string() })
const acceptance = v.object({ submissionId: v.id('learnResponses'), acceptedAt: v.number() })
const computationKeys = { learnerKey: v.string(), capabilityKey: v.string() }
const frozenStratum = {
  epoch: v.string(), baselineSha: v.string(), cohortVersion: v.string(), flow: literals(['v2_today', 'v2_canvas']),
  entryPoint: v.string(), depth: literals(['foundational', 'working', 'advanced']),
  familyId: v.union(v.id('learnMeasurementFamilies'), v.null()), familyRevision: nullableNumber,
  familyValidationStatus: familyStatus, equivalenceVersion: nullableString,
}
export const learnReportFirstSlotStratumValidator = v.object({ ...frozenStratum, responseKind, scorerConfiguration })
const reportClock = v.object({
  protocolVersion: v.string(), schedulingPolicyVersion: v.string(), anchorKind: v.string(), anchorEventId: v.string(), anchorAt: v.number(),
  horizonDays: v.union(v.literal(7), v.literal(30)), timezone: v.string(), dueLocalDate: v.string(), dueAt: v.number(), openAt: v.number(), closeAt: v.number(),
})
const firstCheckClaim = v.object({
  claimKey: v.string(), claimSequence: v.number(), basisAttemptId: v.id('masteryAttempts'), masteryRecordRevision: v.number(),
  firstIndependentAt: v.number(), firstIndependentLocalDate: v.string(), firstIndependentTimezone: v.string(),
  transitionVersion: v.literal('learn-v2.mastery-transition.v1'), claimFactSequence: v.number(),
})
export const learnReportAssignmentSnapshotValidator = v.object({
  status: literals(['considered', 'not_admitted', 'admitted']), protocolStatus: literals(['protocol_not_frozen', 'blocked', 'frozen']),
  ...frozenStratum, responseKind: v.union(responseKind, v.null()), scorerConfiguration: v.union(scorerConfiguration, v.null()),
  protocolVersion: nullableString, enrollmentAt: nullableNumber, timezone: nullableString, anchorAt: nullableNumber, anchorKind: nullableString,
  historyStatus: literals(['prospectively_unexposed', 'returning', 'unknown']),
  allocationOrder: v.union(literals(['ABC', 'ACB', 'BAC', 'BCA', 'CAB', 'CBA', 'AB', 'BA']), v.null()),
  assignedDay7: v.boolean(), assignedDay30: v.boolean(), sourceCoverage,
}) satisfies Validator<z.infer<typeof learnReportAssignmentSnapshotSchema>, 'required', string>
export const learnReportResultSnapshotValidator = v.object({
  submissionId: v.id('learnResponses'), attemptId: v.id('masteryAttempts'), executionId: v.id('learnScoringExecutions'),
  kind: literals(['measurement_cold', 'measurement_delayed', 'independent_application', 'retained_transfer']),
  acceptedAt: v.number(), scoreCommittedAt: v.number(), scorePercent: v.number(), thresholdPercent: v.literal(80),
  caseId: v.id('learnAssessmentCases'), itemId: v.union(v.id('learnMeasurementItems'), v.null()), familyRevision: nullableNumber,
  formLabel: v.union(literals(['A', 'B', 'C', 'D', 'E', 'F']), v.null()), ...scorerConfiguration.fields,
  observedModel: nullableString, observedUpstream: nullableString, identityVersion: v.string(),
  identityStatus: literals(['verified', 'unknown', 'mismatch', 'deterministic', 'unverified_legacy']),
  comparisonContractDigest: v.string(), supportManifestDigest: v.string(),
  assistanceState: literals(['unassisted', 'assisted', 'unknown']), assistancePolicyVersion: v.string(),
  validityStatus: literals(['valid', 'excluded', 'unknown']), exclusionReasons: v.array(v.string()),
  measurementEligible: v.boolean(), masteryEligible: v.boolean(), evidenceAvailable: v.boolean(),
  pasteObserved: v.union(v.boolean(), v.literal('unknown')), focusLossObserved: v.union(v.boolean(), v.literal('unknown')), instrumentationVersion: v.string(),
  masteryStateBefore: masteryState, masteryStateAfter: masteryState,
}) satisfies Validator<z.infer<typeof learnReportResultSnapshotSchema>, 'required', string>
const nullableResult = v.union(learnReportResultSnapshotValidator, v.null())
const nullableAcceptance = v.union(acceptance, v.null())
const coldReplacement = v.object({
  assessmentOpportunityId: v.id('learnAssessmentOpportunities'), replacesOpportunityId: v.id('learnAssessmentOpportunities'),
  replacementReason: v.string(), openAt: v.number(), closeAt: v.number(), eligibilityPolicyVersion: v.string(),
  operationalEligibility: literals(['pending', 'eligible', 'blocked']), acceptance: nullableAcceptance,
  validitySnapshot: v.union(v.object({ policyVersion: v.string(), status: literals(['valid', 'excluded', 'unknown']),
    measurementEligible: v.boolean(), masteryEligible: v.boolean(), exclusionReasons: v.array(v.string()) }), v.null()),
  result: nullableResult,
})
export const learnReportInputSnapshotValidator = v.union(
  v.object({ kind: v.literal('owner_watermark'), learnerKey: v.string(),
    sequence: v.number(), dueWorkThrough: nullableNumber, historyCoverage: sourceCoverage,
    legacyIndependentAudit: learnReportMetricValidator.fields.legacyIndependentAudit }),
  v.object({ kind: v.literal('episode'), ...computationKeys, assignmentId: v.id('learnMeasurementAssignments'),
    learningVoidId: v.id('learningVoids'), blueprintRevisionId: v.id('learnBlueprintRevisions'), objectiveId: v.id('learnObjectives'),
    horizonDays: v.union(v.literal(7), v.literal(30)), assignment: learnReportAssignmentSnapshotValidator, clock: v.union(reportClock, v.null()),
    coldOpportunityId: v.union(v.id('learnAssessmentOpportunities'), v.null()),
    originalOpportunityId: v.union(v.id('learnAssessmentOpportunities'), v.null()), replacementOpportunityId: v.union(v.id('learnAssessmentOpportunities'), v.null()),
    coldAcceptance: nullableAcceptance, delayedAcceptance: nullableAcceptance, cold: nullableResult, delayed: nullableResult, coldReplacement: v.union(coldReplacement, v.null()),
    replacementClock: v.union(reportClock, v.null()), replacementAcceptance: nullableAcceptance, replacement: nullableResult, replacementPolicy: v.union(replacementPolicy, v.null()),
    operationalEligibility: literals(['pending', 'eligible', 'blocked']), disposition: literals(LEARN_V2_REPORT_DISPOSITIONS), reasonCodes: v.array(v.string()),
    mixedFlow: v.boolean(), treatmentEpochChanged: v.boolean(),
  }),
  v.object({ kind: v.literal('first_check_claim'), ...computationKeys,
    stratum: learnReportFirstSlotStratumValidator, claim: firstCheckClaim,
    firstCheckOpportunityId: v.id('learnAssessmentOpportunities'), checkSequence: v.number(), clock: reportClock,
    stateAtEligibility: masteryState, stateAtAcceptance: v.union(masteryState, v.null()), acceptance: nullableAcceptance,
    result: nullableResult, unresolvedReason: nullableString,
  }),
) satisfies Validator<z.infer<typeof learnReportInputSnapshotSchema>, 'required', string>
