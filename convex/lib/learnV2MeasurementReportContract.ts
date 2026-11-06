import { v, type Validator } from 'convex/values'
import type { z } from 'zod'
import {
  LEARN_V2_REPORT_RESPONSE_KINDS, LEARN_V2_REPORT_SENSITIVITY_POLICY_VERSION, LEARN_V2_REPORT_STARTING_BANDS,
  LEARN_V2_REPORT_STATUSES, type learnReportMetricSchema,
} from '../../shared/learn-v2-measurement-report'

const literals = <const T extends string>(values: readonly T[]) => v.union(...values.map(value => v.literal(value)))
const nullableNumber = v.union(v.number(), v.null())
const nullableString = v.union(v.string(), v.null())
const sourceCoverage = literals(['complete', 'unknown'])
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
    familyValidationStatus: literals(['provisional_equivalent', 'empirically_supported', 'quarantined', 'retired', 'unknown']),
  }), ...estimateFields,
  counts: v.object({
    considered: v.number(), notAdmitted: v.number(), horizonNotAssigned: v.number(), anchorNotStarted: v.number(), notYetDue: v.number(), windowOpen: v.number(),
    ...distinctCounts, distinctLearners: v.object(distinctCounts), acceptedColdSubmissions: v.number(), acceptedClaims: v.number(),
    dispositions: v.object({ missing_cold: v.number(), missing_delayed: v.number(), abandoned: v.number(), assisted_contaminated: v.number(),
      invalid_item_novelty: v.number(), evidence_unavailable: v.number(), pin_flow_treatment_mismatch: v.number(), access_provider_blocked: v.number(),
      scoring_pending: v.number(), reconciliation_required: v.number(), valid_scored: v.number() }),
  }),
  replacements: v.object({
    policy: v.union(v.object({ kind: v.literal('secondary_only') }), v.object({ kind: v.literal('predeclared'), protocolVersion: v.string(), ruleVersion: v.string(), ruleDigest: v.string() })),
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
