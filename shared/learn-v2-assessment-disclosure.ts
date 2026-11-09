import { z } from 'zod'
import {
  learnIdSchema, learnRevisionSchema, learnTimestampSchema, learnTextSchema, learnDigestSchema,
  learnResponseBodyStateSchema, learnAssistanceSnapshotSchema, learnValiditySnapshotSchema,
  learnScoreSchema, learnReasonCodesSchema, parseLearnContract,
  learnPostSealPracticeBindingSchema, learnPracticeAssistanceTargetSchema, learnResponseIdempotencyKeySchema,
} from './learn-v2-responses'
import { learnMeasurementResponseSpecSchema } from './learn-v2-measurement'
import { learnAssessmentLifecycleSchema, learnAssessmentCapabilitiesSchema } from './learn-v2-delayed-check'

export const LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION = 'learn-v2.assessment-disclosure.v1' as const
export const LEARN_V2_PUBLIC_FEEDBACK_CODES = ['pass', 'needs_review', 'assisted_result', 'excluded_result'] as const
export const learnPublicAssessmentIdentitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('measurement'), itemId: learnIdSchema<'learnMeasurementItems'>(), itemRevision: learnRevisionSchema, promptDigest: learnDigestSchema }),
  z.strictObject({ kind: z.literal('session_application'), sessionContentId: learnIdSchema<'sessionContent'>(), contentRevision: learnRevisionSchema, promptDigest: learnDigestSchema }),
  z.strictObject({ kind: z.literal('calibration'), objectiveId: learnIdSchema<'learnObjectives'>(), blueprintRevisionId: learnIdSchema<'learnBlueprintRevisions'>(), promptDigest: learnDigestSchema }),
])
export const learnDeliveryGrantSchema = z.strictObject({
  policyVersion: z.literal(LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION),
  deliveryGrantId: learnIdSchema<'learnAssessmentExposures'>(), assessmentOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>(),
  identity: learnPublicAssessmentIdentitySchema, projectionDigest: learnDigestSchema, grantedAt: learnTimestampSchema,
  status: z.enum(['granted', 'acknowledged']),
})
export const learnAssessmentDisclosureContextSchema = z.strictObject({
  version: z.literal(LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION), owned: z.boolean(),
  accessAvailable: z.boolean(), evidenceAvailable: z.boolean(), pinsMatch: z.boolean(),
  lifecycle: learnAssessmentLifecycleSchema, grant: learnDeliveryGrantSchema.nullable(),
})
export const learnObjectiveSummarySchema = z.strictObject({
  version: z.literal(LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION), objectiveId: learnIdSchema<'learnObjectives'>(),
  title: learnTextSchema(300), capability: learnTextSchema(1000),
  depth: z.enum(['foundational', 'working', 'advanced']), revision: learnRevisionSchema,
})
export const learnDeliveredAssessmentSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('delivered'), version: z.literal(LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION),
    assessmentOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>(), deliveryGrantId: learnIdSchema<'learnAssessmentExposures'>(),
    identity: learnPublicAssessmentIdentitySchema, phase: learnAssessmentLifecycleSchema.shape.phase,
    prompt: learnTextSchema(), declaredStimulus: learnTextSchema().nullable(), instructions: learnTextSchema(1000),
    responseSpec: learnMeasurementResponseSpecSchema }),
  z.strictObject({ status: z.literal('unavailable'), version: z.literal(LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION),
    reasonCode: z.enum(['not_delivered', 'disclosure_unknown', 'evidence_unavailable', 'unavailable']) }),
])
export const learnSafeAssessmentResultSchema = z.strictObject({
  attemptId: learnIdSchema<'masteryAttempts'>(), scorePercent: learnScoreSchema, thresholdPercent: z.literal(80),
  scoreCommittedAt: learnTimestampSchema, feedbackCodes: z.array(z.enum(LEARN_V2_PUBLIC_FEEDBACK_CODES)).min(1).max(4)
    .refine(values => new Set(values).size === values.length),
})
export const learnAttemptHistorySchema = z.strictObject({
  version: z.literal(LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION), submissionId: learnIdSchema<'learnResponses'>(),
  acceptedAt: learnTimestampSchema, confidence: z.number().int().min(1).max(5).optional(),
  assistanceSnapshot: learnAssistanceSnapshotSchema, validitySnapshot: learnValiditySnapshotSchema,
  currentEligibility: z.enum(['eligible', 'excluded', 'unknown']),
  body: learnResponseBodyStateSchema, result: learnSafeAssessmentResultSchema.nullable(),
})
export const learnOwnerAssessmentExportSchema = z.strictObject({
  version: z.literal(LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION), work: learnAttemptHistorySchema,
  assessment: learnDeliveredAssessmentSchema,
  omittedCategories: z.tuple([z.literal('private_scoring'), z.literal('unseen_forms'), z.literal('private_evidence'), z.literal('provider_payloads')]),
})
export type LearnAssessmentDisclosureContext = z.infer<typeof learnAssessmentDisclosureContextSchema>

export function projectObjectiveSummary(input: Record<string, unknown>) {
  return parseLearnContract(learnObjectiveSummarySchema, {
    version: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, objectiveId: input.objectiveId,
    title: input.title, capability: input.capability, depth: input.depth, revision: input.revision,
  })
}

export function projectDeliveredAssessment(input: Record<string, unknown>, context: LearnAssessmentDisclosureContext) {
  const value = parseLearnContract(learnAssessmentDisclosureContextSchema, context)
  const unavailable = (reasonCode: 'not_delivered' | 'disclosure_unknown' | 'evidence_unavailable' | 'unavailable') =>
    learnDeliveredAssessmentSchema.parse({ version: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, status: 'unavailable', reasonCode })
  if (!value.owned || !value.accessAvailable) return unavailable('unavailable')
  if (!value.evidenceAvailable) return unavailable('evidence_unavailable')
  if (!value.pinsMatch) return unavailable('disclosure_unknown')
  const grant = value.grant
  if (!grant) return unavailable('not_delivered')
  const identity = learnPublicAssessmentIdentitySchema.safeParse(input.identity)
  if (!identity.success || grant.assessmentOpportunityId !== value.lifecycle.assessmentOpportunityId
    || grant.deliveryGrantId !== value.lifecycle.deliveryGrantId || input.projectionDigest !== grant.projectionDigest
    || JSON.stringify(identity.data) !== JSON.stringify(grant.identity)
    || ['preparing', 'ready'].includes(value.lifecycle.phase)) return unavailable('disclosure_unknown')
  return parseLearnContract(learnDeliveredAssessmentSchema, {
    version: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, status: 'delivered',
    assessmentOpportunityId: value.lifecycle.assessmentOpportunityId, deliveryGrantId: grant.deliveryGrantId,
    identity: identity.data, phase: value.lifecycle.phase, prompt: input.prompt,
    declaredStimulus: input.declaredStimulus, instructions: input.instructions, responseSpec: input.responseSpec,
  })
}

export function projectAttemptHistory(input: Record<string, unknown>, context: {
  owned: boolean, bodyDisclosureAllowed: boolean, resultDisclosureAllowed: boolean,
}) {
  if (!context.owned) throw new Error('Assessment work is unavailable')
  const storedBody = parseLearnContract(learnResponseBodyStateSchema, input.body)
  const body = !context.bodyDisclosureAllowed && storedBody.bodyAvailability === 'available'
    ? { bodyAvailability: 'unavailable' as const, reasonCode: 'evidence_unavailable' as const } : storedBody
  const safeResult = context.resultDisclosureAllowed && input.result !== null
    ? learnSafeAssessmentResultSchema.parse(input.result) : null
  return parseLearnContract(learnAttemptHistorySchema, {
    version: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, submissionId: input.submissionId, acceptedAt: input.acceptedAt,
    ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
    assistanceSnapshot: input.assistanceSnapshot, validitySnapshot: input.validitySnapshot,
    currentEligibility: input.currentEligibility, body, result: safeResult,
  })
}

export function projectOwnerExport(input: {
  work: Record<string, unknown>, assessment: Record<string, unknown>, context: LearnAssessmentDisclosureContext,
  bodyDisclosureAllowed: boolean, resultDisclosureAllowed: boolean,
}) {
  const context = parseLearnContract(learnAssessmentDisclosureContextSchema, input.context)
  return parseLearnContract(learnOwnerAssessmentExportSchema, {
    version: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION,
    work: projectAttemptHistory(input.work, { owned: context.owned,
      bodyDisclosureAllowed: input.bodyDisclosureAllowed && context.evidenceAvailable && context.accessAvailable,
      resultDisclosureAllowed: input.resultDisclosureAllowed }),
    assessment: projectDeliveredAssessment(input.assessment, context),
    omittedCategories: ['private_scoring', 'unseen_forms', 'private_evidence', 'provider_payloads'],
  })
}

export const learnHelpDisclosureInputSchema = z.strictObject({
  owned: z.boolean(), relevantOpenCheck: z.enum(['yes', 'no', 'unknown']),
  sealed: z.boolean(), reservedCase: z.enum(['yes', 'no', 'unknown']), reasonCodes: learnReasonCodesSchema,
})
export function canDiscloseLearnHelp(input: z.infer<typeof learnHelpDisclosureInputSchema>) {
  const value = parseLearnContract(learnHelpDisclosureInputSchema, input)
  return value.owned && value.reservedCase === 'no' && (value.relevantOpenCheck === 'no' || (value.relevantOpenCheck === 'yes' && value.sealed))
}

export const LEARN_V2_POST_SEAL_TEACHING_VERSION = 'learn-v2.post-seal-teaching.v1' as const
export const LEARN_V2_POST_SEAL_TEACHING_REASONS = ['disabled', 'unavailable', 'not_sealed', 'test_open', 'evidence_unavailable', 'disclosure_unknown'] as const
const postSealVersion = z.literal(LEARN_V2_POST_SEAL_TEACHING_VERSION)
export const learnPostSealTeachingReferenceSchema = z.strictObject({
  version: postSealVersion, assessmentOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>(),
})
export const learnTeachingCitationSchema = z.strictObject({ sourceRef: learnTextSchema(200), label: learnTextSchema(300) })
const teachingCitations = z.array(learnTeachingCitationSchema).min(1).max(16)
const sourcedTeachingTier = z.enum(['T0', 'T1'])
const practiceTeachingTier = z.enum(['T0', 'T2'])
export const learnPostSealFeedbackSchema = z.strictObject({ tier: sourcedTeachingTier, text: learnTextSchema(), citations: teachingCitations })
export const learnPostSealLessonSchema = z.strictObject({ tier: sourcedTeachingTier, paragraphs: z.array(learnTextSchema()).min(1).max(8), citations: teachingCitations })
export const learnPostSealPracticeSchema = z.strictObject({
  responseSlotId: learnIdSchema<'learnResponseSlots'>(), revision: learnRevisionSchema, tier: practiceTeachingTier, prompt: learnTextSchema(),
})
export const learnPostSealTeachingSchema = z.discriminatedUnion('status', [
  z.strictObject({ version: postSealVersion, status: z.literal('unavailable'), reasonCode: z.enum(LEARN_V2_POST_SEAL_TEACHING_REASONS) }),
  z.strictObject({ version: postSealVersion, status: z.literal('available'), assessmentOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>(),
    feedback: learnPostSealFeedbackSchema.nullable(), lesson: learnPostSealLessonSchema.nullable(), practice: learnPostSealPracticeSchema.nullable() }),
])
export const learnAuthorizePracticeAssistanceSchema = learnPostSealTeachingReferenceSchema.extend({
  target: learnPracticeAssistanceTargetSchema, expectedRevision: learnRevisionSchema,
  kind: z.enum(['hint', 'worked_example']), idempotencyKey: learnResponseIdempotencyKeySchema,
})
export const learnPracticeAssistanceContentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('hint'), tier: z.literal('T0'), text: learnTextSchema() }),
  z.strictObject({ kind: z.literal('worked_example'), tier: practiceTeachingTier, text: learnTextSchema() }),
])
export const learnPracticeAssistanceAuthorizationSchema = z.discriminatedUnion('status', [
  z.strictObject({ version: postSealVersion, status: z.literal('denied'), reasonCode: z.enum(LEARN_V2_POST_SEAL_TEACHING_REASONS) }),
  z.strictObject({ version: postSealVersion, status: z.literal('authorized'), assessmentOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>(),
    target: learnPracticeAssistanceTargetSchema, revision: learnRevisionSchema,
    authorizationId: learnIdSchema<'learnAssessmentExposures'>(), deliveredAt: learnTimestampSchema, content: learnPracticeAssistanceContentSchema }),
])
export const learnPracticeAssistanceReceiptSchema = z.strictObject({
  request: learnAuthorizePracticeAssistanceSchema, result: learnPracticeAssistanceAuthorizationSchema,
})
export const learnPostSealTeachingContextSchema = z.strictObject({
  disclosure: learnAssessmentDisclosureContextSchema, capabilities: learnAssessmentCapabilitiesSchema, validScore: z.boolean(),
  publicationAllowed: z.boolean(), relevantOpenCheck: z.enum(['yes', 'no', 'unknown']), practiceBinding: learnPostSealPracticeBindingSchema.nullable(),
})
export const learnPostSealTeachingSourceSchema = z.strictObject({
  assessmentOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>(), submissionId: learnIdSchema<'learnResponses'>(),
  attemptId: learnIdSchema<'masteryAttempts'>().nullable(),
  feedback: learnPostSealFeedbackSchema.nullable(), lesson: learnPostSealLessonSchema.nullable(), practice: learnPostSealPracticeSchema.nullable(),
})
export type LearnPostSealTeaching = z.infer<typeof learnPostSealTeachingSchema>
export type LearnPostSealTeachingContext = z.infer<typeof learnPostSealTeachingContextSchema>
export type LearnPracticeAssistanceAuthorization = z.infer<typeof learnPracticeAssistanceAuthorizationSchema>

export function unavailableLearnPostSealTeaching(reasonCode: typeof LEARN_V2_POST_SEAL_TEACHING_REASONS[number]): LearnPostSealTeaching {
  return { version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'unavailable', reasonCode }
}

function postSealTeachingDenial(context: LearnPostSealTeachingContext): typeof LEARN_V2_POST_SEAL_TEACHING_REASONS[number] | null {
  const { disclosure, capabilities } = context
  if (!disclosure.owned || !disclosure.accessAvailable) return 'unavailable'
  if (context.relevantOpenCheck !== 'no') return context.relevantOpenCheck === 'yes' ? 'test_open' : 'disclosure_unknown'
  if (!disclosure.evidenceAvailable) return 'evidence_unavailable'
  if (!disclosure.pinsMatch || !context.publicationAllowed) return 'disclosure_unknown'
  if (capabilities.status !== 'available') return 'unavailable'
  const lifecycle = disclosure.lifecycle
  if (!lifecycle.submissionId || !lifecycle.deliveryGrantId || lifecycle.acceptedAt === null
    || !['submitted_sealed', 'scoring_pending', 'scored_pass', 'scored_fail', 'retryable_failure', 'reconciliation_required', 'invalid'].includes(lifecycle.phase)) return 'not_sealed'
  const grant = disclosure.grant
  if (!grant || grant.assessmentOpportunityId !== lifecycle.assessmentOpportunityId || grant.deliveryGrantId !== lifecycle.deliveryGrantId) return 'disclosure_unknown'
  return null
}

export function learnPostSealTeachingDenial(context: LearnPostSealTeachingContext) {
  return postSealTeachingDenial(parseLearnContract(learnPostSealTeachingContextSchema, context))
}

function canReadPostSealPractice(context: LearnPostSealTeachingContext, responseSlotId: string, revision: number) {
  const binding = context.practiceBinding
  return context.capabilities.canTeachSeparateCase && binding?.owned && binding.evidenceAvailable && binding.stage === 'practice'
    && binding.assessmentOpportunityId === context.disclosure.lifecycle.assessmentOpportunityId
    && binding.submissionId === context.disclosure.lifecycle.submissionId
    && binding.target.responseSlotId === responseSlotId && binding.revision === revision
    && binding.caseRelation === 'separate_case' && binding.reservedCase === 'no'
}

export function projectPostSealTeaching(input: unknown, context: LearnPostSealTeachingContext): LearnPostSealTeaching {
  const value = parseLearnContract(learnPostSealTeachingContextSchema, context)
  const denied = postSealTeachingDenial(value)
  if (denied) return unavailableLearnPostSealTeaching(denied)
  try {
    const source = parseLearnContract(learnPostSealTeachingSourceSchema, input)
    const lifecycle = value.disclosure.lifecycle
    if (source.assessmentOpportunityId !== lifecycle.assessmentOpportunityId || source.submissionId !== lifecycle.submissionId
      || source.attemptId !== lifecycle.authoritativeAttemptId) return unavailableLearnPostSealTeaching('disclosure_unknown')
    const feedbackAllowed = value.validScore && value.capabilities.canReadFeedback && lifecycle.authoritativeAttemptId !== null
      && ['scored_pass', 'scored_fail'].includes(lifecycle.phase)
    return parseLearnContract(learnPostSealTeachingSchema, {
      version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'available', assessmentOpportunityId: lifecycle.assessmentOpportunityId,
      feedback: feedbackAllowed ? source.feedback : null,
      lesson: feedbackAllowed && lifecycle.phase === 'scored_fail' ? source.lesson : null,
      practice: source.practice && canReadPostSealPractice(value, source.practice.responseSlotId, source.practice.revision) ? source.practice : null,
    })
  }
  catch { return unavailableLearnPostSealTeaching('disclosure_unknown') }
}

export function projectPracticeAssistanceAuthorization(input: unknown, request: z.infer<typeof learnAuthorizePracticeAssistanceSchema>, context: LearnPostSealTeachingContext): LearnPracticeAssistanceAuthorization {
  const value = parseLearnContract(learnPostSealTeachingContextSchema, context)
  const command = parseLearnContract(learnAuthorizePracticeAssistanceSchema, request)
  const denied = postSealTeachingDenial(value)
  const deny = (reasonCode: typeof LEARN_V2_POST_SEAL_TEACHING_REASONS[number]): LearnPracticeAssistanceAuthorization =>
    ({ version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'denied', reasonCode })
  if (denied) return deny(denied)
  if (command.assessmentOpportunityId !== value.disclosure.lifecycle.assessmentOpportunityId
    || !canReadPostSealPractice(value, command.target.responseSlotId, command.expectedRevision)) return deny('disclosure_unknown')
  try {
    const saved = parseLearnContract(learnPracticeAssistanceReceiptSchema, input)
    if (JSON.stringify(saved.request) !== JSON.stringify(command)) return deny('disclosure_unknown')
    const receipt = saved.result
    if (receipt.status !== 'authorized') return receipt
    if (receipt.assessmentOpportunityId !== command.assessmentOpportunityId || receipt.target.responseSlotId !== command.target.responseSlotId
      || receipt.revision !== command.expectedRevision || receipt.content.kind !== command.kind
      || receipt.deliveredAt < value.disclosure.lifecycle.acceptedAt!) return deny('disclosure_unknown')
    return receipt
  }
  catch { return deny('disclosure_unknown') }
}
