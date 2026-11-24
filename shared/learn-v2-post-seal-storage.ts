import { z } from 'zod'
import { LEARN_MEASUREMENT_STORAGE_LIMITS } from './learn-v2-measurement-storage-manifest'
import { learnArtifactSourceDependencySchema } from './learn-v2-artifact-lineage'
import {
  learnAuthorizePracticeAssistanceSchema, learnPostSealFeedbackSchema, learnPostSealLessonSchema,
  learnPracticeAssistanceContentSchema,
} from './learn-v2-assessment-disclosure'
import {
  learnDigestSchema, learnIdSchema, learnRevisionSchema, learnSequenceSchema, learnSerializedBytes,
  learnTextSchema, learnTimestampSchema, learnVersionSchema, parseLearnContract,
} from './learn-v2-responses'

export { LEARN_V2_POST_SEAL_STORAGE_VERSION } from './learn-v2-measurement-storage-manifest'
export const LEARN_V2_PRACTICE_HELP_FINGERPRINT_VERSION = 'learn-v2.practice-help-fingerprint.v1' as const

const base = {
  userId: z.string().min(1).max(500), storageVersion: learnVersionSchema, createdAt: learnTimestampSchema,
  postSealStorageVersion: learnVersionSchema, learningVoidId: learnIdSchema<'learningVoids'>(),
}
const check = { assessmentOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>(), submissionId: learnIdSchema<'learnResponses'>() }
const evidence = { evidenceStatus: z.enum(['available', 'evidence_unavailable']), invalidatedAt: learnTimestampSchema.optional() }
const sourceDependencyCount = z.number().int().min(1).max(LEARN_MEASUREMENT_STORAGE_LIMITS.maxSourceDependencies)
const publication = z.strictObject({
  policyVersion: learnVersionSchema, payloadDigest: learnDigestSchema, sourceManifestDigest: learnDigestSchema,
  validationDigest: learnDigestSchema, publishedAt: learnTimestampSchema,
})
const purgedContent = z.strictObject({ status: z.literal('purged'), reasonCode: z.literal('evidence_unavailable'), purgedAt: learnTimestampSchema })
const pendingContent = z.strictObject({ status: z.literal('pending') })

function withinBytes(value: unknown, maximum: number) {
  try { learnSerializedBytes(value, maximum); return true }
  catch { return false }
}

function boundedRow<T extends z.ZodType>(schema: T) {
  return schema.superRefine((row, ctx) => {
    if (!withinBytes(row, LEARN_MEASUREMENT_STORAGE_LIMITS.maxEnvelopeBytes)) ctx.addIssue({ code: 'custom', message: 'Storage envelope exceeds its byte ceiling' })
    if (typeof row !== 'object' || row === null || !('content' in row) || typeof row.content !== 'object' || row.content === null) return
    if ('payload' in row.content && !withinBytes(row.content.payload, LEARN_MEASUREMENT_STORAGE_LIMITS.maxResponseBytes)) {
      ctx.addIssue({ code: 'custom', message: 'Teaching payload exceeds its byte ceiling' })
    }
  })
}

const teachingPayload = z.strictObject({ feedback: learnPostSealFeedbackSchema.nullable(), lesson: learnPostSealLessonSchema.nullable() })
  .refine(value => value.feedback !== null || value.lesson !== null, 'Published teaching requires content')
const teachingBase = { ...base, ...check, sourceDependencyCount }
export const learnPostSealTeachingSourceStorageSchema = boundedRow(z.union([
  z.strictObject({ ...teachingBase, evidenceStatus: z.literal('available'), attemptId: learnIdSchema<'masteryAttempts'>().nullable(), content: pendingContent }),
  z.strictObject({ ...teachingBase, evidenceStatus: z.literal('available'), attemptId: learnIdSchema<'masteryAttempts'>(),
    content: z.strictObject({ status: z.literal('available'), payload: teachingPayload, publication }) }),
  z.strictObject({ ...teachingBase, evidenceStatus: z.literal('evidence_unavailable'), attemptId: learnIdSchema<'masteryAttempts'>().nullable(),
    invalidatedAt: learnTimestampSchema, content: purgedContent }),
]))

export const learnPostSealPracticeBindingStorageSchema = boundedRow(z.strictObject({
  ...base, ...check, ...evidence, responseSlotId: learnIdSchema<'learnResponseSlots'>(),
  checkCaseId: learnIdSchema<'learnAssessmentCases'>(), practiceCaseId: learnIdSchema<'learnAssessmentCases'>(),
  caseRelation: z.literal('separate_case'), reservedCase: z.literal('no'), identityPolicyVersion: learnVersionSchema,
  caseValidationDigest: learnDigestSchema, catalogRevision: learnRevisionSchema, sourceDependencyCount,
  content: z.discriminatedUnion('status', [purgedContent, z.strictObject({ status: z.literal('available'),
    payload: z.strictObject({ tier: z.enum(['T0', 'T2']), prompt: learnTextSchema() }), publication })]),
}).refine(row => row.checkCaseId !== row.practiceCaseId, 'Practice must use a different case')
  .refine(row => row.content.status === 'available'
    ? row.evidenceStatus === 'available' && row.invalidatedAt === undefined
    : row.evidenceStatus === 'evidence_unavailable' && row.invalidatedAt !== undefined, 'Content and evidence state disagree'))

export const learnPracticeSlotAssistanceStorageSchema = z.strictObject({
  policyVersion: learnVersionSchema, revision: learnSequenceSchema, deliveryCount: learnSequenceSchema,
  hintCount: learnSequenceSchema, workedExampleCount: learnSequenceSchema,
  lastDeliveredAt: learnTimestampSchema, lastAuthorizationId: learnIdSchema<'learnAssessmentExposures'>(),
}).refine(row => row.revision === row.deliveryCount && row.deliveryCount === row.hintCount + row.workedExampleCount
  && row.deliveryCount > 0, 'Slot assistance counters disagree')

export const learnPostSealHelpReceiptStorageSchema = boundedRow(z.strictObject({
  ...base, ...check, ...evidence, practiceBindingId: learnIdSchema<'learnPostSealPracticeBindings'>(),
  responseSlotId: learnIdSchema<'learnResponseSlots'>(), expectedRevision: learnRevisionSchema,
  kind: z.enum(['hint', 'worked_example']), commandVersion: learnVersionSchema, fingerprintVersion: learnVersionSchema,
  idempotencyKeyHash: learnDigestSchema, requestDigest: learnDigestSchema,
  authorizationId: learnIdSchema<'learnAssessmentExposures'>(), deliveredAt: learnTimestampSchema,
  assistanceSequence: learnRevisionSchema, sourceDependencyCount,
  content: z.discriminatedUnion('status', [purgedContent, z.strictObject({ status: z.literal('available'), payload: learnPracticeAssistanceContentSchema, publication })]),
}).refine(row => row.content.status !== 'available' || row.content.payload.kind === row.kind, 'Help kind disagrees with content')
  .refine(row => row.deliveredAt === row.createdAt, 'Receipt time is server delivery time')
  .refine(row => row.content.status === 'available'
    ? row.evidenceStatus === 'available' && row.invalidatedAt === undefined
    : row.evidenceStatus === 'evidence_unavailable' && row.invalidatedAt !== undefined, 'Content and evidence state disagree'))

export const learnPostSealSourceLinkStorageSchema = boundedRow(z.strictObject({
  ...base, ...evidence, target: z.union([
    z.strictObject({ teachingSourceId: learnIdSchema<'learnPostSealTeachingSources'>() }),
    z.strictObject({ practiceBindingId: learnIdSchema<'learnPostSealPracticeBindings'>() }),
    z.strictObject({ helpReceiptId: learnIdSchema<'learnPostSealHelpReceipts'>() }),
  ]), dependency: learnArtifactSourceDependencySchema.optional(),
}).refine(row => row.evidenceStatus === 'available'
  ? row.dependency !== undefined && row.invalidatedAt === undefined
  : row.dependency === undefined && row.invalidatedAt !== undefined, 'Source links require live pins or a redacted tombstone'))

export const learnPracticeHelpExposureStorageSchema = z.strictObject({
  responseSlotId: learnIdSchema<'learnResponseSlots'>(), practiceBindingId: learnIdSchema<'learnPostSealPracticeBindings'>(),
  kind: z.enum(['hint', 'worked_example']), assistanceSequence: learnRevisionSchema,
})

export async function fingerprintLearnPracticeHelpRequest(input: unknown) {
  const request = parseLearnContract(learnAuthorizePracticeAssistanceSchema, input)
  const hash = async (value: unknown) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  }
  return {
    fingerprintVersion: LEARN_V2_PRACTICE_HELP_FINGERPRINT_VERSION,
    idempotencyKeyHash: await hash([LEARN_V2_PRACTICE_HELP_FINGERPRINT_VERSION, 'key', request.idempotencyKey]),
    requestDigest: await hash([LEARN_V2_PRACTICE_HELP_FINGERPRINT_VERSION, 'request', request.version,
      request.assessmentOpportunityId, request.target.responseSlotId, request.expectedRevision, request.kind, request.idempotencyKey]),
  }
}
