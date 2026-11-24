import type { Id } from '../../convex/_generated/dataModel'
import type { MutationCtx } from '../../convex/_generated/server'
import { privacyDigest } from '../../convex/lib/learnV2ResponsePrivacy'
import { LEARN_V2_POST_SEAL_TEACHING_VERSION } from '../../shared/learn-v2-assessment-disclosure'
import { fingerprintLearnPracticeHelpRequest, LEARN_V2_POST_SEAL_STORAGE_VERSION,
  learnPostSealTeachingSourceStorageSchema, learnPostSealPracticeBindingStorageSchema,
  learnPostSealHelpReceiptStorageSchema, learnPostSealSourceLinkStorageSchema } from '../../shared/learn-v2-post-seal-storage'

export const POST_SEAL_CANARIES = { prompt: 'private-post-seal-practice', help: 'private-post-seal-hint', feedback: 'private-post-seal-feedback', lesson: 'private-post-seal-lesson' }

export async function seedPostSealStorage(ctx: Pick<MutationCtx, 'db'>, input: {
  base: { userId: string, storageVersion: 'learn-v2.measurement-storage.v1', createdAt: number }, learningVoidId: Id<'learningVoids'>,
  assessmentOpportunityId: Id<'learnAssessmentOpportunities'>, submissionId: Id<'learnResponses'>,
  sourceSnapshotId: Id<'learnSourceSnapshots'>, checkCaseId: Id<'learnAssessmentCases'>, slotId: Id<'learnResponseSlots'>,
}) {
  const base = { ...input.base, postSealStorageVersion: LEARN_V2_POST_SEAL_STORAGE_VERSION, learningVoidId: input.learningVoidId }
  const check = { assessmentOpportunityId: input.assessmentOpportunityId, submissionId: input.submissionId }
  const common = { ...base, ...check, evidenceStatus: 'available' as const, sourceDependencyCount: 1 }
  const teachingSourceId = await ctx.db.insert('learnPostSealTeachingSources', learnPostSealTeachingSourceStorageSchema.parse({ ...common, attemptId: null, content: { status: 'pending' } }))
  const practiceCaseId = await ctx.db.insert('learnAssessmentCases', { ...input.base, caseKey: 'post-seal-practice', scenarioFingerprint: 'a'.repeat(64), solutionFingerprint: 'b'.repeat(64), identityPolicyVersion: 'identity.v1', usageClass: 'unknown' })
  const original = await ctx.db.get(input.slotId)
  if (!original || original.scopeKind !== 'v2') throw new Error('Missing V2 slot')
  const { _id: _id, _creationTime: _time, ...slot } = original
  const responseSlotId = await ctx.db.insert('learnResponseSlots', { ...slot, stage: 'practice', slotKey: 'post-seal-practice', blockId: 'post-seal-practice' })
  const prompt = { tier: 'T0' as const, prompt: POST_SEAL_CANARIES.prompt }
  const publication = { policyVersion: 'publication.fixture.v1', payloadDigest: await privacyDigest(prompt), sourceManifestDigest: 'a'.repeat(64), validationDigest: 'b'.repeat(64), publishedAt: base.createdAt }
  const practiceBindingId = await ctx.db.insert('learnPostSealPracticeBindings', learnPostSealPracticeBindingStorageSchema.parse({ ...common,
    responseSlotId, checkCaseId: input.checkCaseId, practiceCaseId, caseRelation: 'separate_case', reservedCase: 'no',
    identityPolicyVersion: 'identity.v1', caseValidationDigest: 'c'.repeat(64), catalogRevision: 1,
    content: { status: 'available', payload: prompt, publication } }))
  const request = { version: LEARN_V2_POST_SEAL_TEACHING_VERSION, assessmentOpportunityId: input.assessmentOpportunityId,
    target: { responseSlotId }, expectedRevision: 1, kind: 'hint' as const, idempotencyKey: 'post_seal_request_123456' }
  const fingerprints = await fingerprintLearnPracticeHelpRequest(request)
  const payload = { kind: 'hint' as const, tier: 'T0' as const, text: POST_SEAL_CANARIES.help }
  const authorizationId = await ctx.db.insert('learnAssessmentExposures', { ...input.base, learningVoidId: input.learningVoidId,
    caseId: practiceCaseId, purpose: 'practice', status: 'granted', projectionDigest: await privacyDigest(payload),
    deliveryReceiptHash: fingerprints.requestDigest, serverTime: base.createdAt, policyVersion: 'practice-help.fixture.v1', provenanceVersion: 'delivery.fixture.v1',
    practiceHelp: { responseSlotId, practiceBindingId, kind: 'hint', assistanceSequence: 1 } })
  const helpReceiptId = await ctx.db.insert('learnPostSealHelpReceipts', learnPostSealHelpReceiptStorageSchema.parse({ ...common,
    practiceBindingId, responseSlotId, expectedRevision: 1, kind: 'hint', commandVersion: request.version, ...fingerprints,
    authorizationId, deliveredAt: base.createdAt, assistanceSequence: 1,
    content: { status: 'available', payload, publication: { ...publication, payloadDigest: await privacyDigest(payload) } } }))
  await ctx.db.patch(responseSlotId, { deliveryExposureId: authorizationId, practiceAssistance: {
    policyVersion: 'practice-help.fixture.v1', revision: 1, deliveryCount: 1, hintCount: 1, workedExampleCount: 0,
    lastDeliveredAt: base.createdAt, lastAuthorizationId: authorizationId,
  } })
  const sourceLinkIds = []
  for (const target of [{ teachingSourceId }, { practiceBindingId }, { helpReceiptId }]) {
    sourceLinkIds.push(await ctx.db.insert('learnPostSealSourceLinks', learnPostSealSourceLinkStorageSchema.parse({ ...base,
      evidenceStatus: 'available', target, dependency: { kind: 'snapshot', sourceSnapshotId: input.sourceSnapshotId,
        revision: 1, recordRevision: 1, contentHash: 'a'.repeat(64) } })))
  }
  return { teachingSourceId, practiceBindingId, helpReceiptId, sourceLinkIds, responseSlotId, authorizationId, practiceCaseId, request }
}
