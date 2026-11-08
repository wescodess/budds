import { v, type Infer, type Validator } from 'convex/values'
import { z } from 'zod'
import { learnReportMetricValidator } from './learnV2MeasurementReportContract'
import type { learnResponseReceiptSchema} from '../../shared/learn-v2-responses';
import {
  LEARN_V2_RESPONSE_CONTRACT_VERSION, LEARN_V2_RESPONSE_REJECTION_CODES,
  learnAcceptResponseRequestSchema, learnFinalResponseBundleSchema,
  learnResponseTargetSchema, learnResponseIdempotencyKeySchema, learnRevisionSchema, learnIdSchema,
  learnTimestampSchema, parseLearnContract, validateLearnAcceptResponseRequest, validateLearnFinalResponseBundle,
} from '../../shared/learn-v2-responses'
import {
  LEARN_V2_ASSESSMENT_CAPABILITIES_VERSION, LEARN_V2_ASSESSMENT_PHASES,
} from '../../shared/learn-v2-delayed-check'
import {
  LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, LEARN_V2_PUBLIC_FEEDBACK_CODES,
  LEARN_V2_POST_SEAL_TEACHING_VERSION, LEARN_V2_POST_SEAL_TEACHING_REASONS,
  learnPostSealTeachingReferenceSchema, learnAuthorizePracticeAssistanceSchema,
  type learnPostSealTeachingSchema, type learnPracticeAssistanceAuthorizationSchema,
  type learnAttemptHistorySchema, type learnDeliveredAssessmentSchema,
} from '../../shared/learn-v2-assessment-disclosure'
import {
  LEARN_V2_MEASUREMENT_REPORT_VERSION, LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION,
  LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION,
  type learnMeasurementReportSchema, type learnMeasurementReportCellsSchema,
} from '../../shared/learn-v2-measurement-report'

export const LEARN_V2_PUBLIC_API_VERSION = 'learn-v2.public-api.v1' as const
const literals = <const T extends string>(values: readonly T[]) => v.union(...values.map(value => v.literal(value)))
const nullableNumber = v.union(v.number(), v.null())
const nullableString = v.union(v.string(), v.null())
const observation = v.union(v.boolean(), v.literal('unknown'))
const phase = literals(LEARN_V2_ASSESSMENT_PHASES)
export const responseTargetValidator = v.union(
  v.object({ responseSlotId: v.id('learnResponseSlots') }),
  v.object({ assessmentOpportunityId: v.id('learnAssessmentOpportunities') }),
)
const payload = v.union(
  v.object({ kind: v.literal('text'), text: v.string() }),
  v.object({ kind: v.literal('keyed'), keys: v.array(v.string()) }),
  v.object({ kind: v.literal('numeric'), value: v.number(), unit: v.string() }),
  v.object({ kind: v.literal('ordered'), entries: v.array(v.string()) }),
  v.object({ kind: v.literal('source_comparison'), sourceRef: v.string(), comparison: v.string() }),
)
const responseEntry = v.object({
  target: responseTargetValidator, expectedRevision: v.number(), payload, confidence: v.optional(v.number()),
  instrumentation: v.optional(v.object({ pasteObserved: observation, focusLossObserved: observation, version: v.string() })),
})
export const acceptResponseArgs = v.object({
  version: v.literal(LEARN_V2_RESPONSE_CONTRACT_VERSION), idempotencyKey: v.string(), response: responseEntry,
})
export const acceptMasterySubmissionArgs = v.object({
  submission: v.union(acceptResponseArgs, v.object({
    version: v.literal(LEARN_V2_RESPONSE_CONTRACT_VERSION), idempotencyKey: v.string(),
    teachBack: responseEntry, application: responseEntry,
  })),
})
export const acceptResponseCommandSchema = z.union([learnAcceptResponseRequestSchema, learnFinalResponseBundleSchema])
export const acceptMasterySubmissionSchema = z.strictObject({
  submission: z.union([
    learnAcceptResponseRequestSchema.refine(value => 'assessmentOpportunityId' in value.response.target),
    learnFinalResponseBundleSchema,
  ]),
})
export const responseReceiptValidator = v.union(
  v.object({ kind: v.literal('rejected'), version: v.literal(LEARN_V2_RESPONSE_CONTRACT_VERSION), reasonCode: literals(LEARN_V2_RESPONSE_REJECTION_CODES) }),
  v.object({ kind: v.literal('accepted'), version: v.literal(LEARN_V2_RESPONSE_CONTRACT_VERSION), target: responseTargetValidator,
    submissionId: v.id('learnResponses'), acceptedAt: v.number(), revision: v.number(),
    phase: literals(['accepted', 'submitted_sealed']), bodyAvailability: v.literal('available') }),
) satisfies Validator<z.infer<typeof learnResponseReceiptSchema>, 'required', string>

export const unavailableValidator = v.object({
  version: v.literal(LEARN_V2_PUBLIC_API_VERSION), status: literals(['disabled', 'unavailable']), reasonCodes: v.array(v.string()),
})
export type LearnV2Unavailable = Infer<typeof unavailableValidator>
export function disabledLearnV2Result(): LearnV2Unavailable {
  return { version: LEARN_V2_PUBLIC_API_VERSION, status: 'disabled', reasonCodes: ['disabled'] }
}
export function disabledResponseReceipt(): z.infer<typeof learnResponseReceiptSchema> {
  return { kind: 'rejected', version: LEARN_V2_RESPONSE_CONTRACT_VERSION, reasonCode: 'disabled' }
}

export const responseStateArgs = {
  version: v.literal(LEARN_V2_PUBLIC_API_VERSION), target: responseTargetValidator,
}
export const responseStateSchema = z.strictObject({ version: z.literal(LEARN_V2_PUBLIC_API_VERSION), target: learnResponseTargetSchema })
const assistance = v.object({
  policyVersion: v.string(), state: literals(['unassisted', 'assisted', 'unknown']), assistanceRevision: v.number(),
  substantiveHintUsedAt: nullableNumber, answerRevealedAt: nullableNumber,
  priorExposure: literals(['known', 'unknown', 'prospectively_unexposed']), outsideHelp: literals(['reported', 'not_reported', 'unknown']),
  pasteObserved: observation, focusLossObserved: observation, instrumentationVersion: v.string(), instrumentationProvenance: v.string(),
})
const validity = v.object({
  policyVersion: v.string(), status: literals(['valid', 'excluded', 'unknown']),
  measurementEligible: v.boolean(), masteryEligible: v.boolean(), exclusionReasons: v.array(v.string()),
})
const safeResult = v.object({
  attemptId: v.id('masteryAttempts'), scorePercent: v.number(), thresholdPercent: v.literal(80),
  scoreCommittedAt: v.number(), feedbackCodes: v.array(literals(LEARN_V2_PUBLIC_FEEDBACK_CODES)),
})
const work = v.object({
  version: v.literal(LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION), submissionId: v.id('learnResponses'), acceptedAt: v.number(),
  confidence: v.optional(v.number()), assistanceSnapshot: assistance, validitySnapshot: validity,
  currentEligibility: literals(['eligible', 'excluded', 'unknown']),
  body: v.union(
    v.object({ bodyAvailability: v.literal('available'), payload }),
    v.object({ bodyAvailability: v.literal('unavailable'), reasonCode: v.literal('evidence_unavailable') }),
    v.object({ bodyAvailability: v.literal('purged'), reasonCode: v.literal('evidence_unavailable'), purgedAt: v.number() }),
  ), result: v.union(safeResult, v.null()),
}) satisfies Validator<z.infer<typeof learnAttemptHistorySchema>, 'required', string>
export const responseStateValidator = v.union(unavailableValidator, v.object({
  version: v.literal(LEARN_V2_PUBLIC_API_VERSION), status: v.literal('available'), target: responseTargetValidator,
  revision: v.number(), state: literals(['open', 'accepted', 'terminal']), work: v.union(work, v.null()),
}))
export const terminalizeResponseArgs = {
  ...responseStateArgs, expectedRevision: v.number(), idempotencyKey: v.string(), reason: literals(['cancelled', 'abandoned']),
}
export const terminalizeResponseSchema = responseStateSchema.extend({
  expectedRevision: learnRevisionSchema, idempotencyKey: learnResponseIdempotencyKeySchema, reason: z.enum(['cancelled', 'abandoned']),
})
export const terminalizeResponseValidator = v.union(unavailableValidator, v.object({
  version: v.literal(LEARN_V2_PUBLIC_API_VERSION), status: v.literal('terminal'), target: responseTargetValidator,
  revision: v.number(), reason: literals(['cancelled', 'abandoned']),
  terminalizedAt: v.number(),
}))

export const assessmentReferenceArgs = {
  version: v.literal(LEARN_V2_PUBLIC_API_VERSION), assessmentOpportunityId: v.id('learnAssessmentOpportunities'),
}
export const assessmentReferenceSchema = z.strictObject({
  version: z.literal(LEARN_V2_PUBLIC_API_VERSION), assessmentOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>(),
})
export const grantAssessmentDeliveryArgs = { ...assessmentReferenceArgs, expectedRevision: v.number(), idempotencyKey: v.string() }
export const grantAssessmentDeliverySchema = assessmentReferenceSchema.extend({ expectedRevision: learnRevisionSchema, idempotencyKey: learnResponseIdempotencyKeySchema })
export const grantAssessmentDeliveryValidator = v.union(unavailableValidator, v.object({
  version: v.literal(LEARN_V2_PUBLIC_API_VERSION), status: v.literal('granted'), assessmentOpportunityId: v.id('learnAssessmentOpportunities'),
  deliveryGrantId: v.id('learnAssessmentExposures'), revision: v.number(), phase: v.literal('test_open'),
}))
const identity = v.union(
  v.object({ kind: v.literal('measurement'), itemId: v.id('learnMeasurementItems'), itemRevision: v.number(), promptDigest: v.string() }),
  v.object({ kind: v.literal('session_application'), sessionContentId: v.id('sessionContent'), contentRevision: v.number(), promptDigest: v.string() }),
  v.object({ kind: v.literal('calibration'), objectiveId: v.id('learnObjectives'), blueprintRevisionId: v.id('learnBlueprintRevisions'), promptDigest: v.string() }),
)
const deliveredAssessment = v.union(
  v.object({ status: v.literal('delivered'), version: v.literal(LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION),
    assessmentOpportunityId: v.id('learnAssessmentOpportunities'), deliveryGrantId: v.id('learnAssessmentExposures'), identity, phase,
    prompt: v.string(), declaredStimulus: nullableString, instructions: v.string(), responseSpec: v.union(
      v.object({ kind: v.literal('keyed'), version: v.string(), maxSelections: v.number() }),
      v.object({ kind: v.literal('numeric'), version: v.string(), unit: v.string() }),
      v.object({ kind: v.literal('ordered'), version: v.string(), maxEntries: v.number() }),
      v.object({ kind: v.literal('bounded_rubric'), version: v.string(), maxCodeUnits: v.literal(12000) }),
    ) }),
  v.object({ status: v.literal('unavailable'), version: v.literal(LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION),
    reasonCode: literals(['not_delivered', 'disclosure_unknown', 'evidence_unavailable', 'unavailable']) }),
) satisfies Validator<z.infer<typeof learnDeliveredAssessmentSchema>, 'required', string>
export const assessmentDeliveryValidator = v.union(unavailableValidator, deliveredAssessment)
const assessmentCapabilities = v.object({
  version: v.literal(LEARN_V2_ASSESSMENT_CAPABILITIES_VERSION), status: literals(['disabled', 'unavailable', 'available']),
  canDeliver: v.boolean(), canSubmit: v.boolean(), canRequestAssistance: v.boolean(), canTeachSeparateCase: v.boolean(),
  canReadFeedback: v.boolean(), reasonCodes: v.array(v.string()),
})
export const assessmentStateValidator = v.union(unavailableValidator, v.object({
  version: v.literal(LEARN_V2_PUBLIC_API_VERSION), status: v.literal('available'), assessmentOpportunityId: v.id('learnAssessmentOpportunities'),
  revision: v.number(), phase, submissionId: v.union(v.id('learnResponses'), v.null()), capabilities: assessmentCapabilities,
}))
export const scoreMasterySubmissionArgs = { version: v.literal(LEARN_V2_PUBLIC_API_VERSION), submissionId: v.id('learnResponses'), idempotencyKey: v.string() }
export const scoreMasterySubmissionSchema = z.strictObject({
  version: z.literal(LEARN_V2_PUBLIC_API_VERSION), submissionId: learnIdSchema<'learnResponses'>(), idempotencyKey: learnResponseIdempotencyKeySchema,
})
export const scoreMasterySubmissionValidator = v.union(unavailableValidator, v.object({
  version: v.literal(LEARN_V2_PUBLIC_API_VERSION), status: literals(['scoring_pending', 'retryable_failure', 'reconciliation_required', 'invalid']),
  submissionId: v.id('learnResponses'), reasonCodes: v.array(v.string()),
}), v.object({ version: v.literal(LEARN_V2_PUBLIC_API_VERSION), status: v.literal('scored'), submissionId: v.id('learnResponses'), result: safeResult }))
export const authorizeAssistanceArgs = {
  version: v.literal(LEARN_V2_PUBLIC_API_VERSION), assessmentOpportunityId: v.optional(v.id('learnAssessmentOpportunities')),
  kind: literals(['hint', 'reveal', 'chat', 'source', 'search', 'audio', 'replay', 'export']), idempotencyKey: v.string(),
}
export const authorizeAssistanceSchema = z.strictObject({
  version: z.literal(LEARN_V2_PUBLIC_API_VERSION), assessmentOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>().optional(),
  kind: z.enum(['hint', 'reveal', 'chat', 'source', 'search', 'audio', 'replay', 'export']), idempotencyKey: learnResponseIdempotencyKeySchema,
})
export const assistanceAuthorizationValidator = v.union(
  v.object({ version: v.literal(LEARN_V2_PUBLIC_API_VERSION), status: v.literal('denied'), reasonCode: literals(['disabled', 'unavailable', 'test_open', 'disclosure_unknown']) }),
  v.object({ version: v.literal(LEARN_V2_PUBLIC_API_VERSION), status: v.literal('authorized'), authorizationId: v.id('learnAssessmentExposures'),
    assessmentOpportunityId: v.union(v.id('learnAssessmentOpportunities'), v.null()) }),
)

export const postSealTeachingArgs = {
  version: v.literal(LEARN_V2_POST_SEAL_TEACHING_VERSION), assessmentOpportunityId: v.id('learnAssessmentOpportunities'),
}
export const postSealTeachingReferenceSchema = learnPostSealTeachingReferenceSchema
export const authorizePracticeAssistanceArgs = {
  ...postSealTeachingArgs, target: v.object({ responseSlotId: v.id('learnResponseSlots') }), expectedRevision: v.number(),
  kind: literals(['hint', 'worked_example']), idempotencyKey: v.string(),
}
export const authorizePracticeAssistanceSchema = learnAuthorizePracticeAssistanceSchema
const teachingCitations = v.array(v.object({ sourceRef: v.string(), label: v.string() }))
export const postSealTeachingValidator = v.union(
  v.object({ version: v.literal(LEARN_V2_POST_SEAL_TEACHING_VERSION), status: v.literal('unavailable'), reasonCode: literals(LEARN_V2_POST_SEAL_TEACHING_REASONS) }),
  v.object({ version: v.literal(LEARN_V2_POST_SEAL_TEACHING_VERSION), status: v.literal('available'), assessmentOpportunityId: v.id('learnAssessmentOpportunities'),
    feedback: v.union(v.object({ text: v.string(), citations: teachingCitations }), v.null()),
    lesson: v.union(v.object({ paragraphs: v.array(v.string()), citations: teachingCitations }), v.null()),
    practice: v.union(v.object({ responseSlotId: v.id('learnResponseSlots'), revision: v.number(), prompt: v.string() }), v.null()) }),
) satisfies Validator<z.infer<typeof learnPostSealTeachingSchema>, 'required', string>
export const practiceAssistanceAuthorizationValidator = v.union(
  v.object({ version: v.literal(LEARN_V2_POST_SEAL_TEACHING_VERSION), status: v.literal('denied'), reasonCode: literals(LEARN_V2_POST_SEAL_TEACHING_REASONS) }),
  v.object({ version: v.literal(LEARN_V2_POST_SEAL_TEACHING_VERSION), status: v.literal('authorized'), assessmentOpportunityId: v.id('learnAssessmentOpportunities'),
    target: v.object({ responseSlotId: v.id('learnResponseSlots') }), revision: v.number(), authorizationId: v.id('learnAssessmentExposures'), deliveredAt: v.number(),
    content: v.object({ kind: literals(['hint', 'worked_example']), text: v.string() }) }),
) satisfies Validator<z.infer<typeof learnPracticeAssistanceAuthorizationSchema>, 'required', string>

export const requestReportArgs = {
  version: v.literal(LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION), viewerGrantId: v.id('learnMeasurementReportViewerGrants'),
  idempotencyKey: v.string(), enrollmentStartAt: v.number(), enrollmentEndAt: v.number(), cutoff: v.number(),
}
export const requestReportSchema = z.strictObject({
  version: z.literal(LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION), viewerGrantId: learnIdSchema<'learnMeasurementReportViewerGrants'>(),
  idempotencyKey: learnResponseIdempotencyKeySchema, enrollmentStartAt: learnTimestampSchema, enrollmentEndAt: learnTimestampSchema, cutoff: learnTimestampSchema,
}).refine(value => value.enrollmentStartAt < value.enrollmentEndAt && value.enrollmentEndAt <= value.cutoff
  && value.enrollmentEndAt - value.enrollmentStartAt <= 90 * 86_400_000)
export const reportReferenceArgs = { version: v.literal(LEARN_V2_MEASUREMENT_REPORT_VERSION), reportRunId: v.id('learnMeasurementReportRuns') }
export const reportReferenceSchema = z.strictObject({ version: z.literal(LEARN_V2_MEASUREMENT_REPORT_VERSION), reportRunId: learnIdSchema<'learnMeasurementReportRuns'>() })
export const reportPageArgs = { ...reportReferenceArgs, cursor: v.union(v.string(), v.null()) }
export const reportPageSchema = reportReferenceSchema.extend({ cursor: z.string().min(1).max(2000).nullable() })
export const reportUnavailableValidator = v.object({
  version: v.literal(LEARN_V2_MEASUREMENT_REPORT_VERSION), status: literals(['disabled', 'unavailable', 'building', 'failed', 'stale']), reasonCodes: v.array(v.string()),
})
const reportQuery = v.object({
  version: v.literal(LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION), cohortVersion: v.string(), epoch: v.string(), protocolVersion: v.string(),
  enrollmentStartAt: v.number(), enrollmentEndAt: v.number(), cutoff: v.number(),
})
const sourceCoverage = literals(['complete', 'unknown'])
const provenance = v.object({
  kind: v.literal('aggregate_snapshot'), sourceVersion: v.literal(LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION),
  queryVersion: v.literal(LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION), adapterVersion: v.string(), codeVersion: v.string(),
  rosterDigest: v.string(), inputDigest: v.string(), cutoff: v.number(), extractionStartedAt: v.number(), extractionEndedAt: v.number(), sourceCoverage,
  episodeCount: v.number(), inputBytes: v.number(), bootstrapSeed: v.string(), bootstrapReplicates: v.literal(10000),
})
export const reportValidator = v.union(reportUnavailableValidator, v.object({
  version: v.literal(LEARN_V2_MEASUREMENT_REPORT_VERSION), status: v.literal('sealed'), reportRunId: v.id('learnMeasurementReportRuns'), query: reportQuery, provenance,
})) satisfies Validator<z.infer<typeof learnMeasurementReportSchema>, 'required', string>
export const requestReportValidator = v.union(reportUnavailableValidator, v.object({
  version: v.literal(LEARN_V2_MEASUREMENT_REPORT_VERSION), status: v.literal('requested'), reportRunId: v.id('learnMeasurementReportRuns'),
}))
const reportCells = v.object({
  version: v.literal(LEARN_V2_MEASUREMENT_REPORT_VERSION), reportRunId: v.id('learnMeasurementReportRuns'),
  cells: v.array(learnReportMetricValidator), cursor: nullableString, isDone: v.boolean(),
}) satisfies Validator<z.infer<typeof learnMeasurementReportCellsSchema>, 'required', string>
export const reportCellsValidator = v.union(reportUnavailableValidator, reportCells)
export const aggregateExportValidator = v.union(reportUnavailableValidator, v.object({
  version: v.literal(LEARN_V2_MEASUREMENT_REPORT_VERSION), status: v.literal('aggregate_page'),
  manifest: v.object({ reportRunId: v.id('learnMeasurementReportRuns'), query: reportQuery, provenance }), page: reportCells,
}))

const capability = v.object({ status: literals(['disabled', 'unavailable', 'available']), reasonCodes: v.array(v.string()) })
export const featureReadinessValidator = v.object({
  version: v.literal(LEARN_V2_PUBLIC_API_VERSION), status: literals(['disabled', 'unavailable', 'ready_to_collect']),
  protocolStatus: literals(['protocol_not_frozen', 'frozen']), serverUsable: v.boolean(), uiRequired: v.literal(false),
  realBaselineCaptured: v.boolean(), day7Observed: v.boolean(), day30Observed: v.boolean(),
  capabilities: v.object({ responseAcceptance: capability, assessmentDelivery: capability, assessmentAcceptance: capability,
    scoringBySubmission: capability, assistanceAuthorization: capability, reportRequest: capability, reportRead: capability, aggregateExport: capability }),
})
export type LearnV2FeatureReadiness = Infer<typeof featureReadinessValidator>
export type LearnV2AcceptMasterySubmission = z.infer<typeof acceptMasterySubmissionSchema>
export type LearnV2AcceptResponseCommand = z.infer<typeof acceptResponseCommandSchema>
export type LearnV2ScoreMasterySubmission = z.infer<typeof scoreMasterySubmissionSchema>
export type LearnV2ResponseState = Infer<typeof responseStateValidator>
export type LearnV2Terminalization = Infer<typeof terminalizeResponseValidator>
export type LearnV2DeliveryGrant = Infer<typeof grantAssessmentDeliveryValidator>
export type LearnV2AssessmentDelivery = Infer<typeof assessmentDeliveryValidator>
export type LearnV2AssessmentState = Infer<typeof assessmentStateValidator>
export type LearnV2SubmissionScore = Infer<typeof scoreMasterySubmissionValidator>
export type LearnV2AssistanceAuthorization = Infer<typeof assistanceAuthorizationValidator>
export type LearnV2PostSealTeaching = Infer<typeof postSealTeachingValidator>
export type LearnV2PracticeAssistanceAuthorization = Infer<typeof practiceAssistanceAuthorizationValidator>
export type LearnV2ReportRequest = Infer<typeof requestReportValidator>
export type LearnV2Report = Infer<typeof reportValidator>
export type LearnV2ReportCells = Infer<typeof reportCellsValidator>
export type LearnV2AggregateExport = Infer<typeof aggregateExportValidator>

export function parsePublicLearnRequest<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  try { return parseLearnContract(schema, input) }
  catch { throw new Error('Invalid Learn request') }
}

export function validateLearnMasterySubmission(input: unknown, pins: Parameters<typeof validateLearnFinalResponseBundle>[1]) {
  const request = parsePublicLearnRequest(acceptMasterySubmissionSchema, input)
  if ('response' in request.submission) validateLearnAcceptResponseRequest(request.submission, { ...pins.application, diagnostic: false })
  else validateLearnFinalResponseBundle(request.submission, pins)
  return request
}
