import { v } from 'convex/values'
import { LEARN_ARTIFACT_CLASSIFICATIONS, LEARN_ARTIFACT_LINEAGE_VERSION } from '../../shared/learn-v2-artifact-lineage'

const base = { userId: v.string(), storageVersion: v.literal('learn-v2.measurement-storage.v1'), createdAt: v.number() }
const evidence = { evidenceStatus: v.union(v.literal('available'), v.literal('evidence_unavailable')), invalidatedAt: v.optional(v.number()) }
export const artifactClassificationValidator = v.union(...LEARN_ARTIFACT_CLASSIFICATIONS.map(value => v.literal(value)))
export const artifactReferenceFields = {
  artifact: v.union(
    v.object({ kind: v.literal('session_block'), id: v.id('sessionContentBlocks') }),
    v.object({ kind: v.literal('document'), id: v.id('documents') }),
    v.object({ kind: v.literal('document_chunk'), id: v.id('documents') }),
    v.object({ kind: v.literal('quiz_question'), id: v.id('quizQuestions') }),
    v.object({ kind: v.literal('section_block'), id: v.id('courseSections') }),
    v.object({ kind: v.literal('flashcard_version'), id: v.id('flashcardRoomVersions') }),
    v.object({ kind: v.literal('audio_overview'), id: v.id('audioOverviews') }),
    v.object({ kind: v.literal('learner_artifact'), id: v.id('learningThreadArtifacts') }),
    v.object({ kind: v.literal('measurement_item'), id: v.id('learnMeasurementItems') }),
    v.object({ kind: v.literal('scoring_spec'), id: v.id('learnMeasurementScoringSpecs') }),
  ),
  key: v.string(), revision: v.string(), payloadDigest: v.string(),
}
export const artifactReferenceValidator = v.object(artifactReferenceFields)
export const artifactLookupArgs = { reference: artifactReferenceValidator }
export const artifactOwnerRecordValidator = v.union(
  v.object({ kind: v.literal('document'), id: v.id('documents') }),
  v.object({ kind: v.literal('audio_job'), id: v.id('audioOverviewJobs') }),
)
export const artifactCaseFields = { caseId: v.id('learnAssessmentCases'), scenarioFingerprint: v.string(), solutionFingerprint: v.string(), identityPolicyVersion: v.string() }
export const artifactValidationFields = {
  lineageId: v.id('learnArtifactLineages'), payloadDigest: v.string(), manifestDigest: v.string(),
  decision: v.union(v.literal('pass'), v.literal('reject'), v.literal('unknown')), comparedCatalogRevision: v.number(),
  coverage: v.union(v.literal('complete'), v.literal('unknown')), coverageWatermark: v.string(), corpusDigest: v.string(),
  identityPolicyVersion: v.string(), noveltyPolicyVersion: v.string(), validatorVersion: v.string(),
  validatorModel: v.union(v.string(), v.null()), harnessArtifactDigest: v.string(),
}
export const artifactLineageFields = {
  ...base, ...evidence, ...artifactReferenceFields, lineageVersion: v.literal(LEARN_ARTIFACT_LINEAGE_VERSION), manifestDigest: v.string(), classification: artifactClassificationValidator,
  authority: v.union(v.literal('server_producer'), v.literal('personal_authorship'), v.literal('legacy_record')), authorityVersion: v.string(),
  derivation: v.union(v.literal('original'), v.literal('derived')), originCount: v.number(), caseCount: v.number(), sourceCount: v.number(),
  validationId: v.optional(v.id('learnArtifactValidations')),
  nextId: v.optional(v.id('learnArtifactLineages')),
  publication: v.optional(v.object({ validationId: v.id('learnArtifactValidations'), catalogRevision: v.number(), publishedAt: v.number() })),
}
export const artifactOriginFields = {
  ...base, lineageId: v.id('learnArtifactLineages'), originLineageId: v.id('learnArtifactLineages'),
  originRevision: v.string(), originPayloadDigest: v.string(), originManifestDigest: v.string(), classification: artifactClassificationValidator,
  transformation: v.union(v.literal('copy'), v.literal('summary'), v.literal('rewrite'), v.literal('restore'), v.literal('import')),
}
export const artifactCaseBindingFields = { ...base, lineageId: v.id('learnArtifactLineages'), ...artifactCaseFields }
export const artifactValidationStorageFields = { ...base, ...evidence, ...artifactValidationFields }
export const artifactSourceDependencyValidator = v.union(
  v.object({ kind: v.literal('snapshot'), sourceSnapshotId: v.id('learnSourceSnapshots'), revision: v.number(), recordRevision: v.number(), contentHash: v.string() }),
  v.object({ kind: v.literal('excerpt'), sourceExcerptId: v.id('learnSourceExcerpts'), sourceSnapshotId: v.id('learnSourceSnapshots'), revision: v.number(), recordRevision: v.number(), contentHash: v.string() }),
  v.object({ kind: v.literal('document'), documentId: v.id('documents'), sourceRevision: v.string() }),
  v.object({ kind: v.literal('folder'), folderId: v.id('folders') }),
)
export const artifactSourceLinkFields = { ...base, ...evidence, lineageId: v.id('learnArtifactLineages'), dependency: v.optional(artifactSourceDependencyValidator) }
export const artifactLookupResultValidator = v.union(
  v.object({ status: v.literal('unavailable'), version: v.literal(LEARN_ARTIFACT_LINEAGE_VERSION) }),
  v.object({ status: v.literal('bound'), version: v.literal(LEARN_ARTIFACT_LINEAGE_VERSION), lineageId: v.id('learnArtifactLineages'), reference: artifactReferenceValidator,
    classification: artifactClassificationValidator, instructionalRegistered: v.boolean(), catalogRevision: v.number(), originLineageIds: v.array(v.id('learnArtifactLineages')),
    cases: v.array(v.object({ ...artifactCaseFields, usageClass: v.union(v.literal('instructional'), v.literal('measurement_reserved'), v.literal('unknown')) })),
    validation: v.object({ ...artifactValidationFields, validationId: v.id('learnArtifactValidations') }),
  }),
)
export const artifactRegistrationArgs = { reference: artifactReferenceValidator, validationId: v.id('learnArtifactValidations'), expectedCatalogRevision: v.number() }
export const artifactRegistrationResultValidator = v.object({ version: v.literal(LEARN_ARTIFACT_LINEAGE_VERSION), lineageId: v.id('learnArtifactLineages'), catalogRevision: v.number() })
export const artifactReadUsageValidator = v.object({ chargedBytes: v.number(), documentsRead: v.number(), readRequests: v.number(), limitBytes: v.number() })
export const artifactBatchRegistrationArgs = {
  artifacts: v.array(v.object({ reference: artifactReferenceValidator, validationId: v.id('learnArtifactValidations') })), expectedCatalogRevision: v.number(),
}
export const artifactBatchRegistrationResultValidator = v.object({
  version: v.literal(LEARN_ARTIFACT_LINEAGE_VERSION), lineageIds: v.array(v.id('learnArtifactLineages')), catalogRevision: v.number(), readUsage: artifactReadUsageValidator,
})
