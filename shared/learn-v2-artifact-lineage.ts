import { z } from 'zod'
import { learnDigestSchema, learnIdSchema, learnRevisionSchema, learnSequenceSchema, learnVersionSchema, parseLearnContract } from './learn-v2-responses'

export const LEARN_ARTIFACT_LINEAGE_VERSION = 'learn-v2.artifact-lineage.v1' as const
export const LEARN_ARTIFACT_CONTENT_VERSION = 'learn-v2.artifact-content.v1' as const
export const LEARN_ARTIFACT_PREPARATION_VERSION = 'learn-v2.artifact-preparation.v1' as const
export const LEARN_ARTIFACT_CASE_IDENTITY_VERSION = 'learn-v2.instructional-case.v1' as const
export const LEARN_ARTIFACT_RESERVATION_VERSION = 'learn-v2.instructional-reservation.v1' as const
export const LEARN_ARTIFACT_SEMANTIC_VERSION = 'learn-v2.reservation-semantic.unavailable.v1' as const
export const LEARN_ARTIFACT_INPUT_ADMISSION_VERSION = 'learn-v2.artifact-input-admission.v1' as const
// maxBatch is the largest single-write instructional publication: a generated
// Quiz requests at most 50 questions. A document's chunks register as one set.
export const LEARN_ARTIFACT_LINEAGE_LIMITS = { maxNodes: 16, maxDepth: 8, maxOrigins: 8, maxCases: 32, maxSources: 64, maxBatch: 50, maxReservedCases: 256, maxLookupBytes: 64 * 1024 } as const
export const LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY = 'chunk-set' as const
export const LEARN_ARTIFACT_CLASSIFICATIONS = ['teaching', 'genuine_personal_work', 'legacy_history', 'measurement', 'private_scoring', 'unknown'] as const
export const learnArtifactClassificationSchema = z.enum(LEARN_ARTIFACT_CLASSIFICATIONS)
export const learnArtifactReferenceSchema = z.strictObject({
  artifact: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('session_block'), id: learnIdSchema<'sessionContentBlocks'>() }),
    z.strictObject({ kind: z.literal('document'), id: learnIdSchema<'documents'>() }),
    z.strictObject({ kind: z.literal('document_chunk'), id: learnIdSchema<'documents'>() }),
    z.strictObject({ kind: z.literal('quiz_question'), id: learnIdSchema<'quizQuestions'>() }),
    z.strictObject({ kind: z.literal('section_block'), id: learnIdSchema<'courseSections'>() }),
    z.strictObject({ kind: z.literal('flashcard_version'), id: learnIdSchema<'flashcardRoomVersions'>() }),
    z.strictObject({ kind: z.literal('audio_overview'), id: learnIdSchema<'audioOverviews'>() }),
    z.strictObject({ kind: z.literal('learner_artifact'), id: learnIdSchema<'learningThreadArtifacts'>() }),
    z.strictObject({ kind: z.literal('measurement_item'), id: learnIdSchema<'learnMeasurementItems'>() }),
    z.strictObject({ kind: z.literal('scoring_spec'), id: learnIdSchema<'learnMeasurementScoringSpecs'>() }),
  ]),
  key: learnVersionSchema, revision: learnVersionSchema, payloadDigest: learnDigestSchema,
})
export const learnArtifactLookupArgsSchema = z.strictObject({ reference: learnArtifactReferenceSchema })
export const learnArtifactInputBatchAdmissionArgsSchema = z.strictObject({
  references: z.array(learnArtifactReferenceSchema).min(1).max(LEARN_ARTIFACT_LINEAGE_LIMITS.maxSources),
})
export const learnArtifactIdentityAdmissionArgsSchema = learnArtifactReferenceSchema.shape.artifact
export const learnArtifactIdentityBatchAdmissionArgsSchema = z.strictObject({
  artifacts: z.array(learnArtifactIdentityAdmissionArgsSchema).min(1).max(LEARN_ARTIFACT_LINEAGE_LIMITS.maxSources),
})

export const learnArtifactInputAdmissionResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('admitted_registered'), version: z.literal(LEARN_ARTIFACT_INPUT_ADMISSION_VERSION), reasonCode: z.literal('registered_lineage') }),
  z.strictObject({ status: z.literal('admitted_unregistered'), version: z.literal(LEARN_ARTIFACT_INPUT_ADMISSION_VERSION), reasonCode: z.literal('unregistered_ordinary_input') }),
  z.strictObject({ status: z.literal('rejected'), version: z.literal(LEARN_ARTIFACT_INPUT_ADMISSION_VERSION), reasonCode: z.enum(['registration_required', 'restricted_lineage', 'lineage_unavailable', 'projection_exceeds_budget']) }),
])
// Internal authority references only. A producer rereads the record; neither
// an owner string nor a caller's copy of a record can authorize a lookup.
export const learnArtifactOwnerRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('document'), id: learnIdSchema<'documents'>() }),
  z.strictObject({ kind: z.literal('audio_job'), id: learnIdSchema<'audioOverviewJobs'>() }),
])
export const learnArtifactCaseSchema = z.strictObject({
  caseId: learnIdSchema<'learnAssessmentCases'>(), scenarioFingerprint: learnDigestSchema, solutionFingerprint: learnDigestSchema,
  identityPolicyVersion: learnVersionSchema,
})
const snapshotPins = { sourceSnapshotId: learnIdSchema<'learnSourceSnapshots'>(), revision: learnRevisionSchema, recordRevision: learnRevisionSchema, contentHash: learnDigestSchema }
export const learnArtifactSourceDependencySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('snapshot'), ...snapshotPins }),
  z.strictObject({ kind: z.literal('excerpt'), sourceExcerptId: learnIdSchema<'learnSourceExcerpts'>(), ...snapshotPins }),
  z.strictObject({ kind: z.literal('document'), documentId: learnIdSchema<'documents'>(), sourceRevision: learnVersionSchema }),
  z.strictObject({ kind: z.literal('folder'), folderId: learnIdSchema<'folders'>() }),
])
const preparationHistory = {
  instrumentationEpoch: learnVersionSchema, historyCompleteness: z.enum(['unknown', 'prospective_complete']), historyBasisVersion: learnVersionSchema,
}
export const learnArtifactPreparationEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('instructional_reservation'), version: z.literal(LEARN_ARTIFACT_PREPARATION_VERSION), ...preparationHistory,
    reservedCaseCount: learnSequenceSchema, deterministicDecision: z.enum(['pass', 'reject']),
    semanticDecision: z.enum(['not_required', 'pass', 'reject', 'unknown']), semanticVersion: learnVersionSchema }),
  z.strictObject({ kind: z.literal('personal_work'), version: z.literal(LEARN_ARTIFACT_PREPARATION_VERSION), ...preparationHistory }),
])
export const learnArtifactValidationSchema = z.strictObject({
  lineageId: learnIdSchema<'learnArtifactLineages'>(), payloadDigest: learnDigestSchema, manifestDigest: learnDigestSchema,
  decision: z.enum(['pass', 'reject', 'unknown']), comparedCatalogRevision: learnSequenceSchema,
  coverage: z.enum(['complete', 'unknown']), coverageWatermark: learnVersionSchema, corpusDigest: learnDigestSchema,
  identityPolicyVersion: learnVersionSchema, noveltyPolicyVersion: learnVersionSchema,
  validatorVersion: learnVersionSchema, validatorModel: learnVersionSchema.nullable(), harnessArtifactDigest: learnDigestSchema,
  preparation: learnArtifactPreparationEvidenceSchema.optional(),
})
export const learnArtifactLookupResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unavailable'), version: z.literal(LEARN_ARTIFACT_LINEAGE_VERSION) }),
  z.strictObject({ status: z.literal('bound'), version: z.literal(LEARN_ARTIFACT_LINEAGE_VERSION),
    lineageId: learnIdSchema<'learnArtifactLineages'>(), reference: learnArtifactReferenceSchema,
    classification: learnArtifactClassificationSchema, instructionalRegistered: z.boolean(), catalogRevision: learnSequenceSchema,
    originLineageIds: z.array(learnIdSchema<'learnArtifactLineages'>()).max(LEARN_ARTIFACT_LINEAGE_LIMITS.maxNodes),
    cases: z.array(learnArtifactCaseSchema.extend({ usageClass: z.enum(['instructional', 'measurement_reserved', 'unknown']) })).max(LEARN_ARTIFACT_LINEAGE_LIMITS.maxCases),
    validation: learnArtifactValidationSchema.extend({ validationId: learnIdSchema<'learnArtifactValidations'>() }),
  }),
])
export const learnArtifactRegistrationArgsSchema = z.strictObject({ reference: learnArtifactReferenceSchema, validationId: learnIdSchema<'learnArtifactValidations'>(), expectedCatalogRevision: learnSequenceSchema })
export const learnArtifactRegistrationResultSchema = z.strictObject({
  version: z.literal(LEARN_ARTIFACT_LINEAGE_VERSION), lineageId: learnIdSchema<'learnArtifactLineages'>(), catalogRevision: learnRevisionSchema,
})
export const learnArtifactReadUsageSchema = z.strictObject({ chargedBytes: learnSequenceSchema, documentsRead: learnSequenceSchema, readRequests: learnSequenceSchema, limitBytes: learnRevisionSchema })
export const learnArtifactBatchRegistrationArgsSchema = z.strictObject({
  artifacts: z.array(learnArtifactRegistrationArgsSchema.omit({ expectedCatalogRevision: true })).min(1).max(LEARN_ARTIFACT_LINEAGE_LIMITS.maxBatch),
  expectedCatalogRevision: learnSequenceSchema,
})
export const learnArtifactBatchRegistrationResultSchema = z.strictObject({
  version: z.literal(LEARN_ARTIFACT_LINEAGE_VERSION), lineageIds: z.array(learnIdSchema<'learnArtifactLineages'>()).min(1).max(LEARN_ARTIFACT_LINEAGE_LIMITS.maxBatch),
  catalogRevision: learnRevisionSchema, readUsage: learnArtifactReadUsageSchema,
})
const artifactKinds = learnArtifactReferenceSchema.shape.artifact.options
const preparationArtifactSchema = z.discriminatedUnion('kind', [artifactKinds[0], artifactKinds[1], artifactKinds[2], artifactKinds[3], artifactKinds[4], artifactKinds[5], artifactKinds[6]])
export const learnArtifactPreparationArgsSchema = z.strictObject({
  artifacts: z.array(z.strictObject({
    artifact: preparationArtifactSchema, key: learnVersionSchema,
    origins: z.array(z.strictObject({ reference: learnArtifactReferenceSchema, transformation: z.enum(['copy', 'summary', 'rewrite', 'restore', 'import']) })).max(LEARN_ARTIFACT_LINEAGE_LIMITS.maxOrigins),
    sources: z.array(learnArtifactSourceDependencySchema).max(LEARN_ARTIFACT_LINEAGE_LIMITS.maxSources),
  })).min(1).max(LEARN_ARTIFACT_LINEAGE_LIMITS.maxBatch),
})
export const learnArtifactPreparationResultSchema = learnArtifactBatchRegistrationResultSchema.extend({
  references: z.array(learnArtifactReferenceSchema).min(1).max(LEARN_ARTIFACT_LINEAGE_LIMITS.maxBatch),
})
export const learnArtifactSupersessionArgsSchema = z.strictObject({ previousLineageId: learnIdSchema<'learnArtifactLineages'>(), replacementLineageId: learnIdSchema<'learnArtifactLineages'>() })
export type LearnArtifactOwnerRecord = z.infer<typeof learnArtifactOwnerRecordSchema>
export type LearnArtifactReference = z.infer<typeof learnArtifactReferenceSchema>
export type LearnArtifactLookupResult = z.infer<typeof learnArtifactLookupResultSchema>
export type LearnArtifactInputAdmissionResult = z.infer<typeof learnArtifactInputAdmissionResultSchema>
export type LearnArtifactPreparationArgs = z.infer<typeof learnArtifactPreparationArgsSchema>
export function validateLearnArtifactLookup(input: unknown) { return parseLearnContract(learnArtifactLookupArgsSchema, input) }
export function validateLearnArtifactLookupResult(input: unknown) { return parseLearnContract(learnArtifactLookupResultSchema, input, LEARN_ARTIFACT_LINEAGE_LIMITS.maxLookupBytes) }
