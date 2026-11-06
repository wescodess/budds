import { z } from 'zod'
import { learnDigestSchema, learnIdSchema, learnRevisionSchema, learnSequenceSchema, learnVersionSchema, parseLearnContract } from './learn-v2-responses'

export const LEARN_ARTIFACT_LINEAGE_VERSION = 'learn-v2.artifact-lineage.v1' as const
export const LEARN_ARTIFACT_CONTENT_VERSION = 'learn-v2.artifact-content.v1' as const
export const LEARN_ARTIFACT_LINEAGE_LIMITS = { maxNodes: 16, maxDepth: 8, maxOrigins: 8, maxCases: 32, maxSources: 64, maxBatch: 32, maxLookupBytes: 64 * 1024 } as const
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
export const learnArtifactValidationSchema = z.strictObject({
  lineageId: learnIdSchema<'learnArtifactLineages'>(), payloadDigest: learnDigestSchema, manifestDigest: learnDigestSchema,
  decision: z.enum(['pass', 'reject', 'unknown']), comparedCatalogRevision: learnSequenceSchema,
  coverage: z.enum(['complete', 'unknown']), coverageWatermark: learnVersionSchema, corpusDigest: learnDigestSchema,
  identityPolicyVersion: learnVersionSchema, noveltyPolicyVersion: learnVersionSchema,
  validatorVersion: learnVersionSchema, validatorModel: learnVersionSchema.nullable(), harnessArtifactDigest: learnDigestSchema,
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
export const learnArtifactSupersessionArgsSchema = z.strictObject({ previousLineageId: learnIdSchema<'learnArtifactLineages'>(), replacementLineageId: learnIdSchema<'learnArtifactLineages'>() })
export type LearnArtifactOwnerRecord = z.infer<typeof learnArtifactOwnerRecordSchema>
export type LearnArtifactReference = z.infer<typeof learnArtifactReferenceSchema>
export type LearnArtifactLookupResult = z.infer<typeof learnArtifactLookupResultSchema>
export function validateLearnArtifactLookup(input: unknown) { return parseLearnContract(learnArtifactLookupArgsSchema, input) }
export function validateLearnArtifactLookupResult(input: unknown) { return parseLearnContract(learnArtifactLookupResultSchema, input, LEARN_ARTIFACT_LINEAGE_LIMITS.maxLookupBytes) }
