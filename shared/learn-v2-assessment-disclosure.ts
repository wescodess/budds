import { z } from 'zod'
import {
  learnIdSchema, learnRevisionSchema, learnTimestampSchema, learnTextSchema, learnDigestSchema,
  learnResponseBodyStateSchema, learnAssistanceSnapshotSchema, learnValiditySnapshotSchema,
  learnScoreSchema, learnReasonCodesSchema, parseLearnContract,
} from './learn-v2-responses'
import { learnMeasurementResponseSpecSchema } from './learn-v2-measurement'
import { learnAssessmentLifecycleSchema } from './learn-v2-delayed-check'

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
