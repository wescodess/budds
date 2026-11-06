import type { Id } from '../../convex/_generated/dataModel'
import type { TestConvex } from 'convex-test'
import { api, internal } from '../../convex/_generated/api'
import type schema from '../../convex/schema'
import { LEARN_MEASUREMENT_STORAGE_VERSION } from '../../shared/learn-v2-measurement-storage-manifest'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION } from '../../shared/learn-v2-responses'

export async function standaloneResponseFixture(t: TestConvex<typeof schema>, userId: string,
  scope: 'document' | 'folder' | 'none' = 'document', canonical = false) {
  const owner = t.withIdentity({ tokenIdentifier: userId })
  const prefix = `standalone-${scope}-${canonical ? 'canonical' : 'legacy'}`
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: userId, enabled: true })
  await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  const folderId = await owner.mutation(api.folders.createFolder, { name: 'Standalone source' })
  const documentId = await t.run(ctx => ctx.db.insert('documents', { userId, folderId, filename: 'diagnostic.txt', fileSize: 1,
    status: 'success', sourceRevision: `sha256:${'a'.repeat(64)}`, contentHash: 'a'.repeat(64), r2Key: 'standalone/original.txt' }))
  const draft = await owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, {
    need: 'Refresh my understanding while the selected source loads.', outcome: 'Explain what I already know.', intent: 'refresh', availableTime: '15',
    sourceScope: scope === 'document' ? { kind: 'document', documentId } : scope === 'folder' ? { kind: 'folder', folderId } : { kind: 'none' },
    idempotencyKey: `${prefix}-draft`,
  })
  if (draft.kind !== 'created') throw new Error('Expected standalone draft')
  const threadId = draft.thread.id
  await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId, expectedRevision: 1, idempotencyKey: `${prefix}-decision` })
  const continued = await owner.mutation(api.learnAdaptiveRecovery.continueDraft, { threadId, expectedRevision: 2, idempotencyKey: `${prefix}-continue` })
  if (continued.kind !== 'ok') throw new Error('Expected diagnostic')
  await owner.mutation(api.learnAdaptiveRecovery.recordDiagnosticRendered, { threadId, activityId: continued.value.activityId })
  const activity = (await t.run(async ctx => ctx.db.get((await ctx.db.get(threadId))!.currentActivityId!)))!
  const answer = 'standalone-protected-answer-canary'
  let responseSlotId: Id<'learnResponseSlots'> | undefined
  let submissionId: Id<'learnResponses'> | undefined
  if (canonical) {
    const stage = 'diagnostic'
    responseSlotId = await t.run(async ctx => {
      const base = { userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION, createdAt: Date.now() }
      const hash = `sha256:${'a'.repeat(64)}`
      const deliveryExposureId = await ctx.db.insert('learnAssessmentExposures', { ...base, threadId, activityId: activity._id,
        purpose: 'practice', status: 'granted', projectionDigest: hash, deliveryReceiptHash: hash, serverTime: Date.now(), policyVersion: 'delivery.v1', provenanceVersion: 'delivery.v1' })
      return await ctx.db.insert('learnResponseSlots', { ...base, scopeKind: 'standalone', threadId, activityId: activity._id,
        threadRevision: 3, activityRevision: 1, activityContractVersion: activity.contractVersion, evidenceStatus: 'available', stage,
        slotKey: `${stage}.v1`, blockId: stage, promptDigest: hash, promptRevision: 1, responseFormatVersion: 'text.v1',
        confidenceRequested: false, deliveryExposureId, revision: 1, status: 'open' })
    })
    const accepted = await owner.mutation(api.learnV2Responses.acceptResponse, { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
      idempotencyKey: `${prefix}-canonical-answer`, response: { target: { responseSlotId }, expectedRevision: 1, payload: { kind: 'text', text: answer } } })
    if (accepted.kind !== 'accepted') throw new Error(`Expected canonical acceptance: ${JSON.stringify(accepted)}`)
    submissionId = accepted.submissionId
  }
  await owner.mutation(api.learnAdaptiveRecovery.submitDiagnosticResponse, { threadId, activityId: activity.activityId,
    expectedRevision: 3, response: answer, idempotencyKey: `${prefix}-answer` })
  return { t, owner, userId, folderId, documentId, threadId, activityId: activity._id, answer, responseSlotId, submissionId }
}
