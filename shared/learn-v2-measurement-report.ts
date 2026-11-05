import { z } from 'zod'
import {
  learnCodeSchema, learnDigestSchema, learnIdSchema, learnVersionSchema, learnTimestampSchema, learnSequenceSchema,
  learnRevisionSchema, learnScoreSchema, learnObservationSchema, learnReasonCodesSchema, learnTimezoneSchema,
  learnAssistanceSnapshotSchema, learnValiditySnapshotSchema, parseLearnContract,
} from './learn-v2-responses'
import { learnAssessmentClockSchema, learnFirstCheckClaimSchema, learnAssessmentPhaseSchema } from './learn-v2-delayed-check'
import { learnMeasurementFlowSchema, learnMeasurementDepthSchema, learnHistoryStatusSchema, learnFamilyStatusSchema, learnMeasurementHorizonSchema, LEARN_V2_FORM_ORDERS } from './learn-v2-measurement'
import { LEARN_MEASUREMENT_STORAGE_LIMITS } from './learn-v2-measurement-storage-manifest'

export const LEARN_V2_MEASUREMENT_REPORT_VERSION = 'learn-v2.measurement-report.v1' as const
export const LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION = 'learn-v2.measurement-report-source.v1' as const
export const LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION = 'learn-v2.measurement-report-query.v1' as const
export const VERIFIED_LEARNING_GAIN_VERSION = 'verified_learning_gain.v1' as const
export const FALSE_MASTERY_NEXT_DELAYED_VERSION = 'false_mastery_next_delayed.v1' as const
export const LEARN_V2_REPORT_PRECISION = { bootstrapReplicates: 10_000, minimumLearnerClusters: 20, confidenceLevel: 0.95 } as const
export const LEARN_V2_REPORT_STATUSES = [
  'not_admitted', 'protocol_not_frozen', 'anchor_not_started', 'not_yet_due', 'no_eligible_population',
  'unmeasurable_no_t0', 'insufficient_data', 'partial_observed', 'observed_complete', 'unknown_source_coverage', 'quarantined',
] as const
export const LEARN_V2_REPORT_DISPOSITIONS = [
  'missing_cold', 'missing_delayed', 'abandoned', 'assisted_contaminated', 'invalid_item_novelty', 'evidence_unavailable',
  'pin_flow_treatment_mismatch', 'access_provider_blocked', 'scoring_pending', 'reconciliation_required', 'valid_scored',
] as const
export const learnReportStatusSchema = z.enum(LEARN_V2_REPORT_STATUSES)
export const learnReportDispositionSchema = z.enum(LEARN_V2_REPORT_DISPOSITIONS)
export const learnReportOpportunityStatusSchema = z.union([learnAssessmentPhaseSchema, z.enum(['pending', 'eligible', 'blocked'])])
const sourceCoverage = z.enum(['complete', 'unknown'])
const masteryState = z.enum(['unseen', 'learning', 'guided', 'independent', 'retained', 'needs_review', 'blocked', 'provisionally_known'])

export const learnReportAssignmentSnapshotSchema = z.strictObject({
  epoch: learnVersionSchema, baselineSha: z.string().regex(/^[a-f0-9]{40}$/), cohortVersion: learnVersionSchema,
  flow: learnMeasurementFlowSchema, entryPoint: learnVersionSchema, depth: learnMeasurementDepthSchema,
  protocolVersion: learnVersionSchema.nullable(), enrollmentAt: learnTimestampSchema.nullable(), timezone: learnTimezoneSchema.nullable(),
  anchorAt: learnTimestampSchema.nullable(), anchorKind: learnVersionSchema.nullable(), historyStatus: learnHistoryStatusSchema,
  familyId: learnIdSchema<'learnMeasurementFamilies'>().nullable(), familyRevision: learnRevisionSchema.nullable(),
  familyValidationStatus: z.union([learnFamilyStatusSchema, z.literal('unknown')]), equivalenceVersion: learnVersionSchema.nullable(),
  allocationOrder: z.enum([...LEARN_V2_FORM_ORDERS, 'AB', 'BA']).nullable(),
  assignedDay7: z.boolean(), assignedDay30: z.boolean(), sourceCoverage,
})
export const learnReportResultSnapshotSchema = z.strictObject({
  submissionId: learnIdSchema<'learnResponses'>(), attemptId: learnIdSchema<'masteryAttempts'>(), executionId: learnIdSchema<'learnScoringExecutions'>(),
  kind: z.enum(['measurement_cold', 'measurement_delayed', 'independent_application', 'retained_transfer']),
  acceptedAt: learnTimestampSchema, scoreCommittedAt: learnTimestampSchema, scorePercent: learnScoreSchema, thresholdPercent: z.literal(80),
  caseId: learnIdSchema<'learnAssessmentCases'>(), itemId: learnIdSchema<'learnMeasurementItems'>().nullable(),
  familyRevision: learnRevisionSchema.nullable(), formLabel: z.enum(['A', 'B', 'C', 'D', 'E', 'F']).nullable(),
  scoringKind: z.enum(['deterministic', 'model']), configurationDigest: learnDigestSchema, scorerVersion: learnVersionSchema,
  observedModel: z.string().min(1).max(200).nullable(), observedUpstream: z.string().min(1).max(200).nullable(),
  identityVersion: learnVersionSchema, identityStatus: z.enum(['verified', 'unknown', 'mismatch', 'deterministic', 'unverified_legacy']),
  comparisonContractDigest: learnDigestSchema, supportManifestDigest: learnDigestSchema,
  assistanceState: z.enum(['unassisted', 'assisted', 'unknown']), assistancePolicyVersion: learnVersionSchema,
  validityStatus: z.enum(['valid', 'excluded', 'unknown']), exclusionReasons: learnReasonCodesSchema,
  measurementEligible: z.boolean(), masteryEligible: z.boolean(), evidenceAvailable: z.boolean(),
  pasteObserved: learnObservationSchema, focusLossObserved: learnObservationSchema, instrumentationVersion: learnVersionSchema,
  masteryStateBefore: masteryState, masteryStateAfter: masteryState,
}).refine(value => value.acceptedAt <= value.scoreCommittedAt
  && (value.scoringKind !== 'deterministic' || (value.identityStatus === 'deterministic' && value.observedModel === null && value.observedUpstream === null))
  && (!value.kind.startsWith('measurement_') || (value.itemId !== null && value.familyRevision !== null && value.formLabel !== null)), 'Inconsistent scalar result')

export const learnReportWatermarkSnapshotSchema = z.strictObject({
  kind: z.literal('owner_watermark'), sequence: learnSequenceSchema, dueWorkThrough: learnTimestampSchema.nullable(), historyCoverage: sourceCoverage,
})
export const learnReportEpisodeSnapshotSchema = z.strictObject({
  kind: z.literal('episode'), assignment: learnReportAssignmentSnapshotSchema, clock: learnAssessmentClockSchema.nullable(),
  originalOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>().nullable(), replacementOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>().nullable(),
  cold: learnReportResultSnapshotSchema.nullable(), delayed: learnReportResultSnapshotSchema.nullable(),
  operationalEligibility: z.enum(['pending', 'eligible', 'blocked']), responseAcceptedAt: learnTimestampSchema.nullable(),
  disposition: learnReportDispositionSchema, reasonCodes: learnReasonCodesSchema, mixedFlow: z.boolean(), treatmentEpochChanged: z.boolean(),
}).refine(value => (value.cold === null || value.cold.kind === 'measurement_cold')
  && (value.delayed === null || value.delayed.kind === 'measurement_delayed'), 'Incorrect measurement endpoint kind')
export const learnReportFirstClaimSnapshotSchema = z.strictObject({
  kind: z.literal('first_check_claim'), claim: learnFirstCheckClaimSchema, firstCheckOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>(),
  checkSequence: learnRevisionSchema, clock: learnAssessmentClockSchema,
  stateAtEligibility: masteryState, stateAtAcceptance: masteryState.nullable(), result: learnReportResultSnapshotSchema.nullable(),
  unresolvedReason: learnCodeSchema.nullable(),
})
export const learnReportInputSnapshotSchema = z.discriminatedUnion('kind', [learnReportWatermarkSnapshotSchema, learnReportEpisodeSnapshotSchema, learnReportFirstClaimSnapshotSchema])
export const learnReportFactPayloadSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('enrollment'), assignmentId: learnIdSchema<'learnMeasurementAssignments'>(), recordRevision: learnRevisionSchema,
    status: z.enum(['considered', 'not_admitted', 'admitted']), snapshot: learnReportAssignmentSnapshotSchema }),
  z.strictObject({ kind: z.literal('opportunity'), assessmentOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>(), recordRevision: learnRevisionSchema,
    status: learnReportOpportunityStatusSchema, dueAt: learnTimestampSchema.nullable(), closeAt: learnTimestampSchema, clock: learnAssessmentClockSchema.nullable(), originalSlot: z.boolean() }),
  z.strictObject({ kind: z.literal('response'), submissionId: learnIdSchema<'learnResponses'>(), acceptedAt: learnTimestampSchema,
    measurementEligible: z.boolean(), masteryEligible: z.boolean(), assistanceSnapshot: learnAssistanceSnapshotSchema, validitySnapshot: learnValiditySnapshotSchema }),
  z.strictObject({ kind: z.literal('score'), submissionId: learnIdSchema<'learnResponses'>(), attemptId: learnIdSchema<'masteryAttempts'>(),
    executionId: learnIdSchema<'learnScoringExecutions'>(), scorePercent: learnScoreSchema, scoreCommittedAt: learnTimestampSchema, snapshot: learnReportResultSnapshotSchema }),
  z.strictObject({ kind: z.literal('independent_claim'), ...learnFirstCheckClaimSchema.shape,
    firstCheckOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>(), checkSequence: learnRevisionSchema }),
  z.strictObject({ kind: z.literal('integrity'), submissionId: learnIdSchema<'learnResponses'>(), integrityEventId: learnIdSchema<'learnResponseIntegrityEvents'>(),
    currentEligibility: z.enum(['eligible', 'excluded', 'unknown']), evidenceAvailable: z.boolean(), bodyAvailability: z.enum(['available', 'purged']) }),
])
export const learnReportFactSchema = z.strictObject({
  factVersion: z.literal(LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION), sequence: learnRevisionSchema,
  epoch: learnVersionSchema, occurredAt: learnTimestampSchema, fact: learnReportFactPayloadSchema,
})
export const learnReportSourceWatermarkSchema = z.strictObject({
  sourceVersion: z.literal(LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION), sequence: learnSequenceSchema,
  dueWorkThrough: learnTimestampSchema.nullable(), historyCoverage: sourceCoverage, updatedAt: learnTimestampSchema,
})

export const learnReportQuerySchema = z.strictObject({
  version: z.literal(LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION), cohortVersion: learnVersionSchema,
  epoch: learnVersionSchema, protocolVersion: learnVersionSchema,
  enrollmentStartAt: learnTimestampSchema, enrollmentEndAt: learnTimestampSchema, cutoff: learnTimestampSchema,
}).refine(value => value.enrollmentStartAt < value.enrollmentEndAt && value.enrollmentEndAt <= value.cutoff
  && value.enrollmentEndAt - value.enrollmentStartAt <= 90 * 86_400_000, 'Report enrollment range exceeds its bound')

export const learnReportSourcePageSchema = z.strictObject({
  version: z.literal(LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION), reportRunId: learnIdSchema<'learnMeasurementReportRuns'>(),
  sequence: learnSequenceSchema, sourceWatermark: learnSequenceSchema,
  rows: z.array(learnReportInputSnapshotSchema).max(8), cursor: z.string().min(1).max(2000).nullable(), isDone: z.boolean(),
}).refine(value => value.isDone === (value.cursor === null), 'Incomplete report cursor')
export function validateLearnReportSourcePage(input: unknown) {
  return parseLearnContract(learnReportSourcePageSchema, input, LEARN_MEASUREMENT_STORAGE_LIMITS.maxReportPageBytes)
}

export const learnReportProvenanceSchema = z.strictObject({
  kind: z.literal('aggregate_snapshot'), sourceVersion: z.literal(LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION),
  queryVersion: z.literal(LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION), adapterVersion: learnVersionSchema, codeVersion: learnVersionSchema,
  rosterDigest: learnDigestSchema, inputDigest: learnDigestSchema, cutoff: learnTimestampSchema,
  extractionStartedAt: learnTimestampSchema, extractionEndedAt: learnTimestampSchema, sourceCoverage,
  episodeCount: z.number().int().min(0).max(10_000), inputBytes: z.number().int().min(0).max(64 * 1024 * 1024),
  bootstrapSeed: learnDigestSchema, bootstrapReplicates: z.literal(10_000),
}).refine(value => value.extractionStartedAt <= value.extractionEndedAt, 'Invalid extraction range')
export const learnReportStratumSchema = z.strictObject({
  flow: learnMeasurementFlowSchema, entryPoint: learnVersionSchema, depth: learnMeasurementDepthSchema,
  startingBand: z.enum(['0_40', '40_80', '80_100', 'unknown']),
  scoringKind: z.enum(['deterministic', 'model']), configurationDigest: learnDigestSchema,
  observedModel: z.string().min(1).max(200).nullable(), observedUpstream: z.string().min(1).max(200).nullable(),
  familyValidationStatus: z.union([learnFamilyStatusSchema, z.literal('unknown')]),
})
const count = learnSequenceSchema
export const learnReportPopulationCountsSchema = z.strictObject({
  considered: count, notAdmitted: count, horizonNotAssigned: count, anchorNotStarted: count, notYetDue: count, windowOpen: count,
  maturedEpisodes: count, operationallyEligible: count, acceptedSubmissions: count, validDelayedScores: count, validColdScores: count, comparablePairs: count,
  maturedClaims: count, checkedClaims: count, failedClaims: count,
  distinctLearners: z.strictObject({ maturedEpisodes: count, operationallyEligible: count, acceptedSubmissions: count,
    validDelayedScores: count, validColdScores: count, comparablePairs: count, maturedClaims: count, checkedClaims: count, failedClaims: count }),
}).refine(value => value.operationallyEligible <= value.maturedEpisodes && value.acceptedSubmissions <= value.maturedEpisodes
  && value.validDelayedScores <= value.acceptedSubmissions && value.validColdScores <= value.maturedEpisodes
  && value.comparablePairs <= Math.min(value.validDelayedScores, value.validColdScores)
  && value.checkedClaims <= value.maturedClaims && value.failedClaims <= value.checkedClaims
  && Object.entries(value.distinctLearners).every(([key, learners]) => learners <= value[key as keyof typeof value.distinctLearners]), 'Inconsistent report counts')
const interval = z.strictObject({ lower: z.number().finite(), upper: z.number().finite() }).refine(value => value.lower <= value.upper)
export const learnReportMetricSchema = z.strictObject({
  metric: z.enum([VERIFIED_LEARNING_GAIN_VERSION, FALSE_MASTERY_NEXT_DELAYED_VERSION]), horizonDays: learnMeasurementHorizonSchema,
  weighting: z.enum(['capability_episode', 'learner_sensitivity']), stratum: learnReportStratumSchema,
  status: learnReportStatusSchema, populationState: z.enum(['known', 'unknown']), sourceCoverage,
  outcomeCoverage: z.enum(['none', 'partial', 'complete', 'unknown']), validity: z.enum(['verified', 'provisional', 'quarantined', 'unknown']),
  precision: z.enum(['available', 'insufficient_clusters', 'insufficient_variation', 'unknown']),
  counts: learnReportPopulationCountsSchema,
  observedValue: z.number().finite().nullable(), allEligibleValue: z.number().finite().nullable(),
  missingOutcomeBounds: interval.nullable(), confidenceInterval: interval.nullable(), reasonCodes: learnReasonCodesSchema,
}).superRefine((value, ctx) => {
  const gain = value.metric === VERIFIED_LEARNING_GAIN_VERSION
  const population = gain ? value.counts.maturedEpisodes : value.counts.maturedClaims
  const observed = gain ? value.counts.comparablePairs : value.counts.checkedClaims
  const learners = gain ? value.counts.distinctLearners.comparablePairs : value.counts.distinctLearners.checkedClaims
  const minimum = gain ? -100 : 0
  const maximum = gain ? 100 : 1
  const numbers = [value.observedValue, value.allEligibleValue, value.missingOutcomeBounds?.lower,
    value.missingOutcomeBounds?.upper, value.confidenceInterval?.lower, value.confidenceInterval?.upper]
  if (numbers.some(number => number != null && (number < minimum || number > maximum))
    || (!observed && value.observedValue !== null)
    || ((!population || observed < population || value.populationState !== 'known' || value.sourceCoverage !== 'complete') && value.allEligibleValue !== null)
    || ((!population || value.populationState !== 'known' || value.sourceCoverage !== 'complete') && value.missingOutcomeBounds !== null)
    || (value.status === 'observed_complete' && (!population || observed !== population || value.outcomeCoverage !== 'complete'))
    || (value.status === 'partial_observed' && (!observed || observed >= population || value.outcomeCoverage !== 'partial'))
    || (value.status === 'no_eligible_population' && population !== 0)
    || ((value.precision !== 'available' || learners < 20) && value.confidenceInterval !== null)
    || ((value.observedValue === null || value.allEligibleValue === null || value.confidenceInterval === null) && !value.reasonCodes.length)) {
    ctx.addIssue({ code: 'custom', message: 'Unknown or incomplete measurement must have explicit nulls and reasons' })
  }
})
export const learnMeasurementReportSchema = z.discriminatedUnion('status', [
  z.strictObject({ version: z.literal(LEARN_V2_MEASUREMENT_REPORT_VERSION), status: z.literal('sealed'),
    reportRunId: learnIdSchema<'learnMeasurementReportRuns'>(), query: learnReportQuerySchema, provenance: learnReportProvenanceSchema }),
  z.strictObject({ version: z.literal(LEARN_V2_MEASUREMENT_REPORT_VERSION), status: z.enum(['disabled', 'unavailable', 'building', 'failed', 'stale']),
    reasonCodes: learnReasonCodesSchema.refine(values => values.length > 0) }),
])
export const learnMeasurementReportCellsSchema = z.strictObject({
  version: z.literal(LEARN_V2_MEASUREMENT_REPORT_VERSION), reportRunId: learnIdSchema<'learnMeasurementReportRuns'>(),
  cells: z.array(learnReportMetricSchema).max(8), cursor: z.string().min(1).max(2000).nullable(), isDone: z.boolean(),
}).refine(value => value.isDone === (value.cursor === null))
export function validateLearnMeasurementReportCells(input: unknown) {
  return parseLearnContract(learnMeasurementReportCellsSchema, input, LEARN_MEASUREMENT_STORAGE_LIMITS.maxReportPageBytes)
}

export type LearnReportSourceFact = z.infer<typeof learnReportFactSchema>
export type LearnReportInputSnapshot = z.infer<typeof learnReportInputSnapshotSchema>
export type LearnMeasurementReport = z.infer<typeof learnMeasurementReportSchema>
export type LearnReportMetric = z.infer<typeof learnReportMetricSchema>
