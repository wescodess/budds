import { v } from 'convex/values'
import { artifactSourceDependencyValidator } from './learnV2ArtifactLineageContract'

const base = {
  userId: v.string(), storageVersion: v.string(), createdAt: v.number(), postSealStorageVersion: v.string(),
  learningVoidId: v.id('learningVoids'),
}
const check = { assessmentOpportunityId: v.id('learnAssessmentOpportunities'), submissionId: v.id('learnResponses') }
const evidence = { evidenceStatus: v.union(v.literal('available'), v.literal('evidence_unavailable')), invalidatedAt: v.optional(v.number()) }
const publication = v.object({
  policyVersion: v.string(), payloadDigest: v.string(), sourceManifestDigest: v.string(), validationDigest: v.string(), publishedAt: v.number(),
})
const purged = v.object({ status: v.literal('purged'), reasonCode: v.literal('evidence_unavailable'), purgedAt: v.number() })
const citations = v.array(v.object({ sourceRef: v.string(), label: v.string() }))
const sourcedTier = v.union(v.literal('T0'), v.literal('T1'))
const practiceTier = v.union(v.literal('T0'), v.literal('T2'))
const teachingPayload = v.object({
  feedback: v.union(v.object({ tier: sourcedTier, text: v.string(), citations }), v.null()),
  lesson: v.union(v.object({ tier: sourcedTier, paragraphs: v.array(v.string()), citations }), v.null()),
})
const teachingBase = { ...base, ...check, sourceDependencyCount: v.number() }
export const postSealTeachingSourceValidator = v.union(
  v.object({ ...teachingBase, evidenceStatus: v.literal('available'), attemptId: v.union(v.id('masteryAttempts'), v.null()), content: v.object({ status: v.literal('pending') }) }),
  v.object({ ...teachingBase, attemptId: v.id('masteryAttempts'), evidenceStatus: v.literal('available'),
    content: v.object({ status: v.literal('available'), payload: teachingPayload, publication }) }),
  v.object({ ...teachingBase, attemptId: v.union(v.id('masteryAttempts'), v.null()), evidenceStatus: v.literal('evidence_unavailable'),
    invalidatedAt: v.number(), content: purged }),
)
export const postSealPracticeBindingFields = {
  ...base, ...check, ...evidence, responseSlotId: v.id('learnResponseSlots'),
  checkCaseId: v.id('learnAssessmentCases'), practiceCaseId: v.id('learnAssessmentCases'),
  caseRelation: v.literal('separate_case'), reservedCase: v.literal('no'), identityPolicyVersion: v.string(),
  caseValidationDigest: v.string(), catalogRevision: v.number(), sourceDependencyCount: v.number(),
  content: v.union(purged, v.object({ status: v.literal('available'), payload: v.object({ tier: practiceTier, prompt: v.string() }), publication })),
}
export const practiceSlotAssistanceValidator = v.object({
  policyVersion: v.string(), revision: v.number(), deliveryCount: v.number(), hintCount: v.number(), workedExampleCount: v.number(),
  lastDeliveredAt: v.number(), lastAuthorizationId: v.id('learnAssessmentExposures'),
})
export const postSealHelpReceiptFields = {
  ...base, ...check, ...evidence, practiceBindingId: v.id('learnPostSealPracticeBindings'), responseSlotId: v.id('learnResponseSlots'),
  expectedRevision: v.number(), kind: v.union(v.literal('hint'), v.literal('worked_example')), commandVersion: v.string(), fingerprintVersion: v.string(),
  idempotencyKeyHash: v.string(), requestDigest: v.string(), authorizationId: v.id('learnAssessmentExposures'), deliveredAt: v.number(),
  assistanceSequence: v.number(), sourceDependencyCount: v.number(),
  content: v.union(purged, v.object({ status: v.literal('available'), publication, payload: v.union(
    v.object({ kind: v.literal('hint'), tier: v.literal('T0'), text: v.string() }),
    v.object({ kind: v.literal('worked_example'), tier: practiceTier, text: v.string() }),
  ) })),
}
export const postSealSourceLinkFields = {
  ...base, ...evidence, target: v.union(
    v.object({ teachingSourceId: v.id('learnPostSealTeachingSources') }),
    v.object({ practiceBindingId: v.id('learnPostSealPracticeBindings') }),
    v.object({ helpReceiptId: v.id('learnPostSealHelpReceipts') }),
  ), dependency: v.optional(artifactSourceDependencyValidator),
}
export const practiceHelpExposureValidator = v.object({
  responseSlotId: v.id('learnResponseSlots'), practiceBindingId: v.id('learnPostSealPracticeBindings'),
  kind: v.union(v.literal('hint'), v.literal('worked_example')), assistanceSequence: v.number(),
})
