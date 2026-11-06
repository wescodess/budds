/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { composeAdaptiveActivityPlan } from '../shared/learn-adaptive-activity-plan'
import { ADAPTIVE_V2_PILOT_MANIFEST } from '../shared/adaptive-v2-pilot-policy'
import { seedMeasurementStorage, STORAGE_CANARIES } from '../tests/fixtures/learn-v2-measurement-storage'
import { authorizeExport } from '../tests/fixtures/learn-v2-personal-export'
import { appendActivityResponseTargets } from '../tests/fixtures/learn-v2-activity-responses'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|canvas-owner' }
const OTHER = { tokenIdentifier: 'https://auth.example.com|canvas-other' }
const originalFlag = process.env.LEARN_V2_ENABLED
const originalManifest = structuredClone(ADAPTIVE_V2_PILOT_MANIFEST)

beforeEach(() => { process.env.LEARN_V2_ENABLED = 'true' })
afterEach(() => { Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, originalManifest); vi.useRealTimers() })
afterAll(() => { if (originalFlag === undefined) delete process.env.LEARN_V2_ENABLED; else process.env.LEARN_V2_ENABLED = originalFlag })

async function approveSyntheticPilot() {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['adaptive-v2-rollback-owner.tokenIdentifier-sha256.v1', OWNER.tokenIdentifier]))))
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, {
    pilotApproved: true,
    cohort: { ...originalManifest.cohort, subjectHashes: ['sha256:3dcadcd97535d79753fb6bb2909f96bdd4588933bc9faadea9992b691233cfa2'] },
    modelPolicies: [{ model: 'test/mastery-model', inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.1 }],
    productControls: { ...originalManifest.productControls, maxDispatchesPerHour: 4, maxDispatchesPerDay: 8, maxConcurrent: 2, maxReservedMicroUsdPerDay: 100_000 },
    rollback: { ...originalManifest.rollback, ownerSubjectHash: `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}` },
  })
}

async function fixture() {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(OWNER)
  const other = t.withIdentity(OTHER)
  for (const actor of [owner, other]) {
    await actor.mutation(api.users.upsertUser, {})
  }
  for (const identity of [OWNER, OTHER]) {
    await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
    await t.withIdentity(identity).mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  }
  const ids = await t.run(async ctx => {
    const now = Date.now()
    const userId = OWNER.tokenIdentifier
    const folderId = await ctx.db.insert('folders', { userId, name: 'Canvas sources', documentCount: 0 })
    const learningVoidId = await ctx.db.insert('learningVoids', { userId, folderId, title: 'Explain gravity', status: 'active', revision: 1, createdAt: now, updatedAt: now })
    const blueprintId = await ctx.db.insert('learnBlueprints', { userId, learningVoidId, revision: 1, createdAt: now })
    const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { userId, blueprintId, learningVoidId, revision: 1, recordRevision: 3, status: 'accepted', createdAt: now, updatedAt: now })
    await ctx.db.patch(learningVoidId, { activeBlueprintRevisionId: blueprintRevisionId })
    const objectiveId = await ctx.db.insert('learnObjectives', { userId, blueprintRevisionId, order: 0, title: 'Explain gravity', assessmentContract: { version: 'learn-v2.assessment.v1', kind: 'machine_checkable', responseFormat: 'short_text', instructions: 'Explain from the evidence.', passingScorePercent: 80, criteria: [{ key: 'accuracy', description: 'Accurate explanation.', weightPercent: 100 }] } })
    const studyPlanId = await ctx.db.insert('studyPlans', { userId, learningVoidId, revision: 1, createdAt: now })
    const studyPlanRevisionId = await ctx.db.insert('studyPlanRevisions', { userId, studyPlanId, learningVoidId, revision: 1, recordRevision: 5, status: 'accepted', blueprintRevisionId, blueprintRecordRevision: 3, createdAt: now })
    await ctx.db.patch(studyPlanId, { activeRevisionId: studyPlanRevisionId })
    const studySessionId = await ctx.db.insert('studySessions', { userId, studyPlanRevisionId, primaryObjectiveId: objectiveId, status: 'ready', revision: 2, scheduledStartAt: now - 1_000, timezone: 'UTC' })
    const sessionContentId = await ctx.db.insert('sessionContent', { userId, studySessionId, studyPlanRevisionId, blueprintRevisionId, objectiveId, revision: 1, status: 'published', inputDigest: `sha256:${'a'.repeat(64)}`, generatorVersion: 'learn-v2.session-content.v1', providerModel: 'test/mastery-model', assessmentRubricSnapshot: JSON.stringify({ version: 'learn-v2.assessment.v1', kind: 'machine_checkable', responseFormat: 'short_text', instructions: 'Explain from the evidence.', passingScorePercent: 80, criteria: [{ key: 'accuracy', description: 'Accurate explanation.', weightPercent: 100 }] }), createdAt: now, publishedAt: now })
    await ctx.db.insert('sessionContentBlocks', { userId, sessionContentId, order: 0, kind: 'explanation', content: 'Gravity attracts masses.', claimOrdersJson: '[0]' })
    await ctx.db.insert('sessionContentBlocks', { userId, sessionContentId, order: 1, kind: 'independent_application', content: 'Explain why an apple falls.', claimOrdersJson: '[0,1]' })
    await ctx.db.insert('sessionContentBlocks', { userId, sessionContentId, order: 2, kind: 'worked_example', content: 'The apple accelerates toward Earth.', claimOrdersJson: '[0]' })
    await ctx.db.insert('sessionContentBlocks', { userId, sessionContentId, order: 3, kind: 'faded_example', content: 'Think about mass and distance.', claimOrdersJson: '[0]' })
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { userId, learningVoidId, origin: 'user_url', externalKey: 'gravity-source' })
    const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', { userId, sourceIdentityId, learningVoidId, blueprintRevisionId, revision: 1, recordRevision: 1, status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear', createdAt: now })
    await ctx.db.insert('learnObjectiveSources', { userId, objectiveId, sourceSnapshotId, coverage: 'strong' })
    const sourceExcerptId = await ctx.db.insert('learnSourceExcerpts', { userId, sourceSnapshotId, locator: 'p:1', excerpt: 'Gravity attracts masses.', rightsStatus: 'permitted' })
    const claimId = await ctx.db.insert('sessionContentClaims', { userId, sessionContentId, order: 0, claim: 'Gravity attracts masses.', verifierVersion: 'learn-v2.entailment.v2', confidence: 0.95 })
    await ctx.db.insert('learnClaimSupports', { userId, sessionContentClaimId: claimId, sourceExcerptId, sourceSnapshotId, entailment: 'entailed', verifierVersion: 'learn-v2.entailment.v2', confidence: 0.95, conflictStatus: 'clear', evidenceStatus: 'evidence_available' })
    const laterSourceIdentityId = await ctx.db.insert('learnSourceIdentities', { userId, learningVoidId, origin: 'user_url', externalKey: 'apple-source' })
    const laterSourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', { userId, sourceIdentityId: laterSourceIdentityId, learningVoidId, blueprintRevisionId, revision: 1, recordRevision: 1, status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear', createdAt: now })
    await ctx.db.insert('learnObjectiveSources', { userId, objectiveId, sourceSnapshotId: laterSourceSnapshotId, coverage: 'strong' })
    const laterExcerptId = await ctx.db.insert('learnSourceExcerpts', { userId, sourceSnapshotId: laterSourceSnapshotId, locator: 'p:2', excerpt: 'Earth attracts nearby apples.', rightsStatus: 'permitted' })
    const laterClaimId = await ctx.db.insert('sessionContentClaims', { userId, sessionContentId, order: 1, claim: 'Earth attracts nearby apples.', verifierVersion: 'learn-v2.entailment.v2', confidence: 0.95 })
    await ctx.db.insert('learnClaimSupports', { userId, sessionContentClaimId: laterClaimId, sourceExcerptId: laterExcerptId, sourceSnapshotId: laterSourceSnapshotId, entailment: 'entailed', verifierVersion: 'learn-v2.entailment.v2', confidence: 0.95, conflictStatus: 'clear', evidenceStatus: 'evidence_available' })
    return { folderId, studySessionId, sessionContentId, learningVoidId, sourceSnapshotId, laterSourceSnapshotId, laterExcerptId, laterClaimId }
  })
  return { t, owner, other, ids }
}

describe('ready V2 adaptive Canvas', () => {
  test.each(['body_purged', 'direct_document_deleted', 'unrelated_slots', 'unrelated_canvas_slots', 'unrelated_opportunities', 'activity_overflow'] as const)('Canvas and Journey preserve retained body authority through %s', async revocation => {
    vi.useFakeTimers()
    const { t, owner, ids } = await fixture()
    const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canonical-copy-attach' })
    const f = await t.run(ctx => seedMeasurementStorage(ctx, OWNER.tokenIdentifier))
    const prepared = await t.run(async ctx => {
      const thread = (await ctx.db.get(attached.threadId))!
      const content = (await ctx.db.get(ids.sessionContentId))!
      const plan = (await ctx.db.get(content.studyPlanRevisionId!))!
      const canvas = { threadId: thread._id, threadRevision: thread.revision, activityId: thread.currentActivityId!, activityRevision: 1,
        planVersion: 'learn-adaptive.activity-plan.v1', replayVersion: 'learn-adaptive.activity-replay.v1', rendererVersion: 'learn-adaptive.renderer.v1',
        evaluationVersion: 'learn-adaptive.evaluation.v1', pilotConfigurationVersion: 'pilot.v1' }
      const pins = { ...f.scope, learningVoidId: ids.learningVoidId, blueprintRevisionId: content.blueprintRevisionId!, objectiveId: content.objectiveId!,
        blueprintRecordRevision: 3, contextPins: { ...f.scope.contextPins, studyPlanId: plan.studyPlanId, studyPlanRevisionId: plan._id,
          studySessionId: ids.studySessionId, sessionContentId: content._id, canvas } }
      await ctx.db.patch(f.rows.learnResponses, pins)
      await ctx.db.patch(f.rows.learnAssessmentOpportunities, pins)
      await ctx.db.patch(f.rows.learnResponseBodies, { learningVoidId: ids.learningVoidId })
      await ctx.db.patch(f.rows.learnResponseEvidenceLinks, { learningVoidId: ids.learningVoidId, aggregate: { learningVoidId: ids.learningVoidId },
        dependency: { kind: 'snapshot', sourceSnapshotId: ids.sourceSnapshotId, sourceSnapshotRevision: 1, sourceRecordRevision: 1, supportManifestDigest: 'support-hash' } })
      const attemptId = await ctx.db.insert('masteryAttempts', { userId: OWNER.tokenIdentifier, blueprintRevisionId: pins.blueprintRevisionId,
        objectiveId: pins.objectiveId, sessionContentId: content._id, submissionId: f.rows.learnResponses, attemptedAt: 123,
        idempotencyKey: 'canonical-copy-attempt', response: STORAGE_CANARIES.answer, confidence: 4, serverScorePercent: 80 })
      await ctx.db.patch(thread.currentActivityId!, { submittedResponse: STORAGE_CANARIES.answer, submittedConfidence: 4, masteryAttemptId: attemptId })
      const documentId = await ctx.db.insert('documents', { userId: OWNER.tokenIdentifier, folderId: ids.folderId, filename: 'direct.txt', fileSize: 1,
        status: 'success', sourceRevision: `sha256:${'a'.repeat(64)}`, contentHash: 'a'.repeat(64) })
      await ctx.db.patch(thread._id, { sourceScope: { kind: 'document', sourceId: String(documentId) } })
      return { activityId: thread.currentActivityId!, documentId, blueprintRevisionId: pins.blueprintRevisionId }
    })
    const canvasArgs = { threadId: attached.threadId }
    expect((await owner.query(api.learnAdaptiveCanvas.getCanvas, canvasArgs))?.savedResponse).toMatchObject({ response: STORAGE_CANARIES.answer })
    expect((await owner.query(api.learnV2Journey.getMission, { learningVoidId: ids.learningVoidId }))?.mastery[0]?.attempts[0]).toMatchObject({ response: STORAGE_CANARIES.answer })
    if (revocation.startsWith('unrelated') || revocation === 'activity_overflow') {
      const targetFixture = { t, userId: OWNER.tokenIdentifier, threadId: attached.threadId, activityId: prepared.activityId, submissionId: f.rows.learnResponses }
      const kind = revocation === 'unrelated_slots' ? 'standalone' : revocation === 'unrelated_opportunities' ? 'opportunity' : 'canvas_slot'
      await appendActivityResponseTargets(targetFixture, 63, revocation === 'activity_overflow', kind)
      expect((await owner.query(api.learnAdaptiveCanvas.getCanvas, canvasArgs))?.savedResponse).toMatchObject({ response: STORAGE_CANARIES.answer })
      await appendActivityResponseTargets(targetFixture, 1, revocation === 'activity_overflow', kind)
      const canvas = await owner.query(api.learnAdaptiveCanvas.getCanvas, canvasArgs)
      expect(canvas).toMatchObject({ thread: { id: attached.threadId }, session: { studySessionId: ids.studySessionId }, activity: { planRevision: 1 } })
      const attempt = (await owner.query(api.learnV2Journey.getMission, { learningVoidId: ids.learningVoidId }))?.mastery[0]?.attempts[0]
      if (revocation === 'activity_overflow') {
        expect(canvas?.savedResponse).toBeNull()
        expect(attempt).toMatchObject({ serverScorePercent: 80, confidence: 4, bodyAvailability: 'unavailable' })
        expect(attempt).not.toHaveProperty('response')
      } else {
        expect(canvas?.savedResponse).toMatchObject({ response: STORAGE_CANARIES.answer })
        expect(attempt).toMatchObject({ response: STORAGE_CANARIES.answer })
      }
      return
    }
    if (revocation === 'body_purged') await t.mutation(internal.learnV2Retention.purgeResponseCopies, { userId: OWNER.tokenIdentifier, submissionId: f.rows.learnResponses })
    else await owner.mutation(api.documents.deleteDocument, { id: prepared.documentId })
    expect((await t.run(ctx => ctx.db.get(prepared.activityId)))?.submittedResponse).toBe(STORAGE_CANARIES.answer)
    for (const cleanup of [false, true]) {
      if (cleanup) await t.finishAllScheduledFunctions(vi.runAllTimers)
      expect((await owner.query(api.learnAdaptiveCanvas.getCanvas, canvasArgs))?.savedResponse).toBeNull()
      const journey = await owner.query(api.learnV2Journey.getMission, { learningVoidId: ids.learningVoidId })
      expect(journey?.mastery[0]?.attempts[0]).toMatchObject({ serverScorePercent: 80, confidence: 4, bodyAvailability: 'unavailable' })
      expect(journey?.mastery[0]?.attempts[0]).not.toHaveProperty('response')
      const authorizationId = await authorizeExport(owner)
      const page = await owner.query(api.dataExport.getUserDataPage, { authorizationId, collection: 'learningThreadActivities', paginationOpts: { cursor: null, numItems: 16 } })
      expect(page.page.find(row => row._id === prepared.activityId)).not.toHaveProperty('submittedResponse')
      const review = await owner.query(api.learnV2Sources.listSourceReview, { blueprintRevisionId: prepared.blueprintRevisionId, paginationOpts: { cursor: null, numItems: 8 } })
      expect(review.page.find(row => row._id === ids.sourceSnapshotId)?.excerpt).toBe('Gravity attracts masses.')
      expect(JSON.stringify(review)).not.toContain(STORAGE_CANARIES.answer)
    }
    expect((await t.run(ctx => ctx.db.get(prepared.activityId)))?.submittedResponse).toBeUndefined()
  })

  test.each(['tombstone', 'source_unavailable', 'document_deleted', 'document_replaced', 'document_hash_replaced', 'document_object_replaced', 'folder_deleted', 'archived', 'evidence_purged'] as const)('Canvas, journey and source review deny %s before scheduled cleanup', async revocation => {
    vi.useFakeTimers()
    const { t, owner, ids } = await fixture()
    const privateText = 'private-response-rubric-cache-canary'
    const publicCriterion = 'Explain the capability accurately using the accepted evidence.'
    const response = 'My retained answer about gravity.'
    const prepared = await t.run(async ctx => {
      const content = (await ctx.db.get(ids.sessionContentId))!
      const source = (await ctx.db.get(ids.sourceSnapshotId))!
      const documentId = await ctx.db.insert('documents', { userId: OWNER.tokenIdentifier, folderId: ids.folderId,
        filename: 'gravity.txt', fileSize: 1, status: 'success', contentHash: 'a'.repeat(64), sourceRevision: `sha256:${'a'.repeat(64)}`, r2Key: 'canvas/gravity.txt' })
      await ctx.db.patch(source.sourceIdentityId, { origin: 'folder_document', folderDocumentId: documentId })
      await ctx.db.patch(source._id, { blueprintRevisionId: content.blueprintRevisionId, contentHash: 'a'.repeat(64), sourceRevision: `sha256:${'a'.repeat(64)}`, objectKey: 'canvas/gravity.txt' })
      await ctx.db.patch(ids.laterSourceSnapshotId, { blueprintRevisionId: content.blueprintRevisionId })
      await ctx.db.patch(content.objectiveId!, { assessmentContract: { version: 'learn-v2.assessment.v1', kind: 'bounded_rubric', responseFormat: 'short_text',
        instructions: 'Explain from the evidence.', passingScorePercent: 80, criteria: [{ key: 'correct', description: publicCriterion, weightPercent: 100 }] } })
      await ctx.db.patch(content.studyPlanRevisionId!, {
        inputSnapshot: JSON.stringify({ version: 'learn-v2.schedule-input.v1', timezone: 'UTC', startLocalDate: '2026-11-06', targetLocalDate: null,
          sessionMinutes: 25, minRestMinutes: 720, availability: [{ weekday: 1, start: '18:00', end: '20:00' }], blackoutDates: [], reviewIntervalsDays: [1, 3], privateRubric: privateText }),
        resultSnapshot: JSON.stringify({ version: 'learn-v2.scheduler.v1', status: 'feasible', reasonCodes: ['capacity_available'], alternatives: [], privateCache: privateText }),
      })
      const attemptId = await ctx.db.insert('masteryAttempts', { userId: OWNER.tokenIdentifier, blueprintRevisionId: content.blueprintRevisionId,
        objectiveId: content.objectiveId!, kind: 'calibration', attemptedAt: 123, serverScorePercent: 80, confidence: 4, usedHint: false, usedReveal: false,
        idempotencyKey: 'read-privacy-calibration', activityContractVersion: 'learn-v2.calibration-attempt.v1', rubricVersion: 'rubric.v1', scorerVersion: 'scorer.v1',
        response, sourceSnapshotIdsJson: JSON.stringify([source._id]),
        requestFingerprint: JSON.stringify({ response: privateText }), rubricSnapshot: privateText, criterionResultsJson: privateText,
        feedbackProjectionJson: privateText, contentRevisionPinsJson: privateText })
      return { documentId, sourceIdentityId: source.sourceIdentityId, objectiveId: content.objectiveId!, blueprintRevisionId: content.blueprintRevisionId!, attemptId }
    })
    const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'read-privacy-attach' })
    const activityId = await t.run(async ctx => {
      const thread = (await ctx.db.get(attached.threadId))!
      await ctx.db.patch(thread.currentActivityId!, { submittedResponse: response, submittedConfidence: 4 })
      return thread.currentActivityId!
    })
    const canvasArgs = { threadId: attached.threadId }
    const journeyArgs = { learningVoidId: ids.learningVoidId }
    const reviewArgs = { blueprintRevisionId: prepared.blueprintRevisionId, paginationOpts: { cursor: null, numItems: 8 } }
    const liveCanvas = await owner.query(api.learnAdaptiveCanvas.getCanvas, canvasArgs)
    expect(liveCanvas).toMatchObject({ status: 'ready', savedResponse: { response, confidence: 4 } })
    expect(liveCanvas?.activity.fallback.body).not.toBe('')
    const liveJourney = await owner.query(api.learnV2Journey.getMission, journeyArgs)
    expect(liveJourney?.sources.items.find(row => row._id === ids.sourceSnapshotId)?.excerpt?.text).toBe('Gravity attracts masses.')
    expect(liveJourney?.calibration.attempts[0]).toMatchObject({ response, serverScorePercent: 80, confidence: 4 })
    expect(liveJourney?.calibration.items[0]?.prompt).toBe('Explain from the evidence.')
    const storedObjective = (await t.run(ctx => ctx.db.get(prepared.objectiveId)))!
    expect(liveJourney?.map?.objectives[0]).toEqual({ ...storedObjective, sourceLinks: expect.any(Array), prerequisiteObjectiveIds: [] })
    expect(liveJourney?.calibration.items[0]?.rubric).toEqual(storedObjective.assessmentContract)
    expect(liveJourney?.calibration.attempts[0]).toMatchObject({ userId: OWNER.tokenIdentifier, rubricVersion: 'rubric.v1', scorerVersion: 'scorer.v1', activityContractVersion: 'learn-v2.calibration-attempt.v1' })
    expect(liveJourney?.mastery[0]?.attempts[0]).toEqual(liveJourney?.calibration.attempts[0])
    expect(liveJourney?.plan.accepted).toMatchObject({ inputSnapshot: expect.stringContaining('UTC'), resultSnapshot: expect.stringContaining('capacity_available') })
    expect(JSON.stringify(liveJourney)).not.toContain(privateText)
    expect((await owner.query(api.learnV2Sources.listSourceReview, reviewArgs)).page.find(row => row._id === ids.sourceSnapshotId)).toMatchObject({ excerpt: 'Gravity attracts masses.', rights: { access: 'available' } })
    // A stale legacy fallback remains stored until the continuation runs.
    await t.run(async ctx => { const activity = (await ctx.db.get(activityId))!; await ctx.db.patch(activityId, { fallback: { ...activity.fallback, body: privateText } }) })
    if (revocation === 'source_unavailable') await owner.mutation(api.learnV2Sources.markUnavailable, { sourceSnapshotId: ids.sourceSnapshotId, expectedRevision: 1, idempotencyKey: 'read-privacy-revoke', reason: 'access_lost' })
    if (revocation === 'document_deleted') await owner.mutation(api.documents.deleteDocument, { id: prepared.documentId })
    if (revocation === 'document_replaced') await t.mutation(internal.documents.updateDocumentStatus, { id: prepared.documentId, status: 'success', sourceRevision: 'document.r2' })
    if (revocation === 'document_hash_replaced') await t.mutation(internal.documents.updateDocumentStatus, { id: prepared.documentId, status: 'success', contentHash: 'b'.repeat(64) })
    if (revocation === 'document_object_replaced') await t.mutation(internal.documents.updateDocumentStatus, { id: prepared.documentId, status: 'success', r2Key: 'read-privacy/relocated.txt' })
    if (revocation === 'folder_deleted') await owner.mutation(api.folders.deleteFolder, { id: ids.folderId })
    if (revocation === 'archived') await owner.mutation(api.learnV2Lifecycle.transitionLearningVoid, { learningVoidId: ids.learningVoidId, expectedRevision: 1, status: 'archived', idempotencyKey: 'read-privacy-archive' })
    if (revocation === 'tombstone' || revocation === 'evidence_purged') {
      await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: OWNER.tokenIdentifier, sourceIdentityId: prepared.sourceIdentityId })
      if (revocation === 'tombstone') {
        expect(await t.run(ctx => ctx.db.get(ids.sourceSnapshotId))).toMatchObject({ effectiveStatus: 'user_accepted' })
        expect(await t.run(ctx => ctx.db.get(ids.sourceSnapshotId))).not.toHaveProperty('evidencePurgedAt')
      }
      else {
        // Finish only the source's bounded mutation. Dependent body/cache
        // continuations remain scheduled and never run in this regression.
        for (let batch = 0; batch < 8 && (await t.run(ctx => ctx.db.get(ids.sourceSnapshotId)))?.evidencePurgedAt === undefined; batch++) {
          await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: OWNER.tokenIdentifier, sourceIdentityId: prepared.sourceIdentityId })
        }
        expect(await t.run(ctx => ctx.db.get(ids.sourceSnapshotId))).toHaveProperty('evidencePurgedAt')
      }
    }
    const canvas = await owner.query(api.learnAdaptiveCanvas.getCanvas, canvasArgs)
    expect(canvas).toMatchObject({ status: 'blocked', thread: { id: attached.threadId }, savedResponse: null, responsePrompt: null,
      activity: { primitive: null, fallback: { body: '' } } })
    expect(JSON.stringify(canvas)).not.toContain(privateText)
    const mission = await owner.query(api.learnV2Journey.getMission, journeyArgs)
    if (revocation === 'folder_deleted') expect(mission).toBeNull()
    else {
      expect(mission).toMatchObject({ learningVoid: { _id: ids.learningVoidId }, calibration: { attempts: [{ serverScorePercent: 80, confidence: 4, bodyAvailability: 'unavailable' }] } })
      expect(mission?.sources.items.find(row => row._id === ids.sourceSnapshotId)?.excerpt).toBeNull()
      expect(mission?.calibration.items[0]?.prompt).toBeNull()
      expect(mission?.calibration.items[0]?.rubric).toBeNull()
      expect(mission?.map?.objectives[0]).toHaveProperty('assessmentContract', storedObjective.assessmentContract)
      expect(JSON.stringify(mission)).not.toContain(response)
      expect(JSON.stringify(mission)).not.toContain(privateText)
      expect(mission?.mastery[0]?.attempts[0]).not.toHaveProperty('response')
    }
    if (revocation === 'folder_deleted' || revocation === 'archived') await expect(owner.query(api.learnV2Sources.listSourceReview, reviewArgs)).rejects.toThrow('Learning Void not found')
    else expect((await owner.query(api.learnV2Sources.listSourceReview, reviewArgs)).page.find(row => row._id === ids.sourceSnapshotId))
      .toMatchObject({ _id: ids.sourceSnapshotId, excerpt: null, rights: { access: 'evidence_unavailable' } })
    expect(await t.run(ctx => ctx.db.get(prepared.attemptId))).toMatchObject({ response, serverScorePercent: 80, attemptedAt: 123, confidence: 4 })
  })

  test('a stale or blocked stage receipt pins its key while a fresh key commits exactly once', async () => {
    const { owner, ids } = await fixture()
    const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-receipt-attach-0001' })
    await owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'canvas-receipt-start-0001' })
    const stage = (idempotencyKey: string, expectedRevision: number) => owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, {
      threadId: attached.threadId, activityId: attached.activityId, studySessionId: ids.studySessionId,
      expectedSessionRevision: 3, expectedRevision, response: 'Earth attracts the apple.', confidence: 4, idempotencyKey,
    })
    await owner.mutation(api.learnAdaptive.leaveThread, { threadId: attached.threadId, expectedRevision: 2, idempotencyKey: 'canvas-receipt-leave-0001' })
    expect(await stage('canvas-receipt-stale-0001', 2)).toMatchObject({ kind: 'conflict', code: 'stale_revision', actualRevision: 3 })
    expect(await stage('canvas-receipt-stale-0001', 3)).toMatchObject({ kind: 'conflict', code: 'duplicate_key' })
    expect(await stage('canvas-receipt-paused-0001', 3)).toMatchObject({ kind: 'blocked', code: 'thread_not_active', retryable: false })
    await owner.mutation(api.learnAdaptive.resumeThread, { threadId: attached.threadId, expectedRevision: 3, idempotencyKey: 'canvas-receipt-resume-0001' })
    expect(await stage('canvas-receipt-paused-0001', 3)).toMatchObject({ kind: 'blocked', code: 'thread_not_active' })
    expect(await stage('canvas-receipt-paused-0001', 4)).toMatchObject({ kind: 'conflict', code: 'duplicate_key' })
    const committed = await stage('canvas-receipt-fresh-0001', 4)
    expect(committed).toMatchObject({ kind: 'ok', revision: 5 })
    expect(await stage('canvas-receipt-fresh-0001', 4)).toEqual(committed)
    await expect(stage('canvas-receipt-after-ack-0001', 5)).rejects.toThrow(/Started Canvas activity is unavailable/)
  })

  test('lifecycle transitions preserve the attached session pins and V2 authority', async () => {
    const { t, owner, ids } = await fixture()
    const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, {
      studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-lifecycle-attach-0001',
    })
    const before = await t.run(async ctx => {
      const thread = await ctx.db.get(attached.threadId)
      return { thread, activity: thread?.currentActivityId ? await ctx.db.get(thread.currentActivityId) : null,
        session: await ctx.db.get(ids.studySessionId), mission: await ctx.db.get(ids.learningVoidId) }
    })
    if (!before.thread || !before.activity || !before.session || !before.mission) throw new Error('Expected attached session')
    const left = await owner.mutation(api.learnAdaptive.leaveThread, {
      threadId: attached.threadId, expectedRevision: before.thread.revision, idempotencyKey: 'canvas-lifecycle-leave-0001',
    })
    expect(left).toMatchObject({ kind: 'ok', value: { lifecycle: 'paused' } })
    const resumed = await owner.mutation(api.learnAdaptive.resumeThread, {
      threadId: attached.threadId, expectedRevision: before.thread.revision + 1, idempotencyKey: 'canvas-lifecycle-resume-0001',
    })
    expect(resumed).toMatchObject({ kind: 'ok', value: { lifecycle: before.thread.lifecycle } })
    const ended = await owner.mutation(api.learnAdaptive.endThread, {
      threadId: attached.threadId, expectedRevision: before.thread.revision + 2, idempotencyKey: 'canvas-lifecycle-end-0001',
    })
    expect(ended).toMatchObject({ kind: 'ok', value: { lifecycle: 'ended' } })
    const after = await t.run(async ctx => ({ thread: await ctx.db.get(attached.threadId),
      activity: await ctx.db.get(before.activity!._id), session: await ctx.db.get(ids.studySessionId),
      mission: await ctx.db.get(ids.learningVoidId),
      attempts: await ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(1),
      jobs: await ctx.db.query('learnJobs').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(1) }))
    expect(after.thread).toMatchObject({ authorityKind: 'v2_mission', learningVoidId: ids.learningVoidId, currentActivityId: before.activity._id })
    expect(after.activity).toEqual(before.activity)
    expect(after.session).toEqual(before.session)
    expect(after.mission).toEqual(before.mission)
    expect(after.attempts).toEqual([])
    expect(after.jobs).toEqual([])
  })

  test('a replay cannot retarget an attached activity to a different or missing immutable V2 anchor', async () => {
    const { t, owner, ids } = await fixture()
    const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, {
      studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-anchor-attach-0001',
    })
    expect(await owner.query(api.learnAdaptive.getThread, { threadId: attached.threadId })).toMatchObject({ thread: {
      authorityKind: 'v2_mission', learningVoidId: ids.learningVoidId,
    } })
    await t.run(ctx => ctx.db.patch(attached.threadId, { learningVoidId: undefined }))
    expect(await owner.query(api.learnAdaptive.getThread, { threadId: attached.threadId })).toBeNull()
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toBeNull()
    await expect(owner.mutation(api.learnAdaptiveCanvas.attachReadySession, {
      studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-anchor-attach-0001',
    })).rejects.toThrow(/anchor/i)
    await expect(owner.mutation(api.learnAdaptiveCanvas.attachReadySession, {
      studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-anchor-attach-0002',
    })).rejects.toThrow(/anchor/i)
    await t.run(ctx => ctx.db.patch(attached.threadId, { learningVoidId: ids.learningVoidId, authorityKind: 'standalone' }))
    await expect(owner.mutation(api.learnAdaptiveCanvas.attachReadySession, {
      studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-anchor-attach-0001',
    })).rejects.toThrow(/anchor/i)
  })

  test('an attachment receipt cannot replay an activity no longer owned by the caller', async () => {
    const { t, owner, ids } = await fixture()
    const args = { studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-owner-replay-0001' }
    const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, args)
    const activityId = await t.run(async ctx => (await ctx.db.get(attached.threadId))!.currentActivityId!)
    await t.run(ctx => ctx.db.patch(activityId, { userId: OTHER.tokenIdentifier }))
    await expect(owner.mutation(api.learnAdaptiveCanvas.attachReadySession, args)).rejects.toThrow(/unavailable/i)
  })

  test('a staged representative response cannot use an activity whose thread V2 anchor changed', async () => {
    const { t, owner, ids } = await fixture()
    const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, {
      studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-anchor-stage-0001',
    })
    await owner.mutation(api.learnV2SessionContent.startStudySession, {
      studySessionId: ids.studySessionId, expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'canvas-anchor-start-0001',
    })
    await t.run(ctx => ctx.db.patch(attached.threadId, { learningVoidId: undefined }))
    await expect(owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, {
      threadId: attached.threadId, activityId: attached.activityId, studySessionId: ids.studySessionId,
      expectedSessionRevision: 3, expectedRevision: 2, response: 'Earth attracts it.', confidence: 4,
      idempotencyKey: 'canvas-anchor-submit-0001',
    })).rejects.toThrow(/unavailable/i)
  })
  test('offers supported closed controls only while live source authority is ready', async () => {
    const { t, owner, ids } = await fixture()
    const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, {
      studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-controls-attach-0001',
    })
    const ready = await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })
    expect(ready?.activity.evidenceScope).toEqual({ version: 'learn-adaptive.canvas-evidence-scope.v1', integrityState: 'accepted', sourceRefs: [String(ids.sourceSnapshotId), String(ids.laterSourceSnapshotId)] })
    expect(ready?.activity.primitive?.type === 'cited_explanation' ? ready.activity.primitive.props.sourceRefs : null).toEqual([String(ids.sourceSnapshotId)])
    expect(ready?.activity.controls).toMatchObject({ reasonText: { version: 'learn-adaptive.reason-text.v1', purpose: expect.stringContaining('supported explanation'), text: expect.stringContaining('accepted sources') },
      options: expect.arrayContaining([{ key: 'example', label: 'Show an example', available: true, unavailableReason: null }]) })
    await t.run(ctx => ctx.db.delete(ids.folderId))
    const lost = await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })
    expect(lost?.activity.controls.options.find(option => option.key === 'example')).toMatchObject({ available: false, unavailableReason: 'state' })
    await expect(owner.mutation(api.learnAdaptive.applyOverride, { threadId: attached.threadId, activityId: attached.activityId,
      option: 'example', expectedRevision: ready!.thread.revision, idempotencyKey: 'canvas-controls-lost-0001' })).rejects.toThrow(/Override unavailable/)
  })

  test('records one versioned render failure only for the owned current Canvas', async () => {
    const { t, owner, other, ids } = await fixture()
    const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, {
      studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-render-attach-0001',
    })
    const input = { threadId: attached.threadId, activityId: attached.activityId, expectedPlanRevision: 1, reasonCode: 'unsafe_url' as const }
    await expect(other.mutation(api.learnAdaptiveCanvas.reportRenderFailure, input)).rejects.toThrow()
    await expect(owner.mutation(api.learnAdaptiveCanvas.reportRenderFailure, { ...input, expectedPlanRevision: 2 })).rejects.toThrow(/authority/i)
    await expect(owner.mutation(api.learnAdaptiveCanvas.reportRenderFailure, { ...input, reasonCode: 'private_source_url' as never })).rejects.toThrow()
    await expect(owner.mutation(api.learnAdaptiveCanvas.reportRenderFailure, { ...input, rawPayload: 'private data' } as never)).rejects.toThrow()
    expect(await owner.mutation(api.learnAdaptiveCanvas.reportRenderFailure, input)).toMatchObject({ recorded: true })
    expect(await owner.mutation(api.learnAdaptiveCanvas.reportRenderFailure, input)).toMatchObject({ recorded: false })
    const events = await t.run(ctx => ctx.db.query('learnActivityEvents')
      .withIndex('by_userId_and_threadId_and_occurredAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', attached.threadId)).take(4))
    expect(events.filter(event => event.eventType === 'canvas_render_failure')).toMatchObject([
      { eventVersion: 'canvas_render_failure.v1', reasonCode: 'unsafe_url', outcomeCode: 'fallback_rendered' },
    ])
    expect((await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId }))?.thread.revision).toBe(2)
  })

  test('factual thread recovers from deleted or non-owned folder despite retained ready Canvas snapshots', async () => {
    const { t, owner, ids } = await fixture()
    const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, {
      studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-folder-source-authority1',
    })
    const read = async () => await owner.query(api.learnAdaptive.getThread, { threadId: attached.threadId })
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'ready' })

    await t.run(ctx => ctx.db.patch(ids.folderId, { userId: OTHER.tokenIdentifier }))
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'blocked', savedResponse: null, responsePrompt: null, activity: { primitive: null, fallback: { body: '' } } })
    expect(await read()).toMatchObject({ thread: { evidenceState: 'unavailable' }, nextAction: { kind: 'recover', label: 'Review your Void', activityId: attached.activityId } })

    await t.run(ctx => ctx.db.patch(ids.folderId, { userId: OWNER.tokenIdentifier }))
    expect(await read()).toMatchObject({ thread: { evidenceState: 'ready' }, nextAction: { kind: 'continue' } })
    await t.run(ctx => ctx.db.delete(ids.folderId))
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'blocked', savedResponse: null, responsePrompt: null, activity: { primitive: null, fallback: { body: '' } } })
    expect(await read()).toMatchObject({ thread: { evidenceState: 'unavailable' }, nextAction: { kind: 'recover', activityId: attached.activityId } })
  })

  test('factual thread recovers from deleted or non-owned document despite retained ready Canvas snapshots', async () => {
    const { t, owner, ids } = await fixture()
    const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, {
      studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-document-source-authority1',
    })
    const documentId = await t.run(async ctx => {
      const documentId = await ctx.db.insert('documents', { userId: OWNER.tokenIdentifier, folderId: ids.folderId, filename: 'Gravity.pdf', status: 'success', fileSize: 123 })
      await ctx.db.patch(attached.threadId, { sourceScope: { kind: 'document', sourceId: String(documentId) } })
      return documentId
    })
    const read = async () => await owner.query(api.learnAdaptive.getThread, { threadId: attached.threadId })
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'ready' })
    expect(await read()).toMatchObject({ thread: { evidenceState: 'ready' }, nextAction: { kind: 'continue' } })

    await t.run(ctx => ctx.db.patch(documentId, { userId: OTHER.tokenIdentifier }))
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'blocked', savedResponse: null, responsePrompt: null, activity: { primitive: null, fallback: { body: '' } } })
    expect(await read()).toMatchObject({ thread: { evidenceState: 'unavailable' }, nextAction: { kind: 'recover', activityId: attached.activityId } })

    await t.run(ctx => ctx.db.patch(documentId, { userId: OWNER.tokenIdentifier }))
    await t.run(ctx => ctx.db.delete(documentId))
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'blocked', savedResponse: null, responsePrompt: null, activity: { primitive: null, fallback: { body: '' } } })
    expect(await read()).toMatchObject({ thread: { evidenceState: 'unavailable' }, nextAction: { kind: 'recover', activityId: attached.activityId } })
  })

  test('thread next action follows live factual Canvas eligibility through stale plan, content, and evidence', async () => {
    const { t, owner, ids } = await fixture()
    const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, {
      studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-thread-live-authority1',
    })
    const read = async () => await owner.query(api.learnAdaptive.getThread, { threadId: attached.threadId })
    expect(await read()).toMatchObject({ thread: { evidenceState: 'ready' }, nextAction: { kind: 'continue', activityId: attached.activityId } })

    const planId = await t.run(async ctx => (await ctx.db.get(ids.studySessionId))!.studyPlanRevisionId)
    await t.run(ctx => ctx.db.patch(planId, { status: 'superseded' }))
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'blocked', recoveryState: 'stale' })
    expect(await read()).toMatchObject({ thread: { evidenceState: 'stale' },
      unresolvedPoint: 'Explain gravity', nextAction: { kind: 'recover', activityId: attached.activityId } })

    await t.run(async ctx => {
      await ctx.db.patch(planId, { status: 'accepted' })
      await ctx.db.patch(ids.sessionContentId, { status: 'superseded' })
    })
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'blocked', recoveryState: 'stale' })
    expect(await read()).toMatchObject({ thread: { evidenceState: 'stale' }, nextAction: { kind: 'recover' } })

    await t.run(async ctx => {
      await ctx.db.patch(ids.sessionContentId, { status: 'published' })
      await ctx.db.patch(ids.laterSourceSnapshotId, { effectiveStatus: 'unavailable', status: 'unavailable' })
    })
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'blocked', recoveryState: 'unavailable' })
    expect(await read()).toMatchObject({ thread: { evidenceState: 'unavailable' }, nextAction: { kind: 'recover' } })

    await t.run(ctx => ctx.db.patch(ids.laterSourceSnapshotId, { effectiveStatus: 'user_accepted', status: 'user_accepted', conflictStatus: 'unresolved' }))
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'blocked', recoveryState: 'blocked' })
    expect(await read()).toMatchObject({ thread: { evidenceState: 'blocked' }, nextAction: { kind: 'recover' } })

    await t.run(ctx => ctx.db.patch(ids.laterSourceSnapshotId, { conflictStatus: 'clear', evidencePurgedAt: Date.now() }))
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'blocked', recoveryState: 'invalidated' })
    expect(await read()).toMatchObject({ thread: { evidenceState: 'invalidated' }, nextAction: { kind: 'recover' } })

    await t.run(ctx => ctx.db.delete(ids.sessionContentId))
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toBeNull()
    expect(await read()).toMatchObject({ thread: { evidenceState: 'unavailable' }, nextAction: { kind: 'recover' } })
  })
  test('attaches one ready session to an owned thread, starts shared V2 authority, and admits one response', async () => {
    const { t, owner, other, ids } = await fixture()
    const needFirst = await owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, { need: 'Explain a different concept from scratch.', intent: 'build', availableTime: '15', sourceScope: { kind: 'none' }, idempotencyKey: 'canvas-separate-need-0001' })
    if (needFirst.kind !== 'created') throw new Error('Expected independent need-first draft')
    await expect(other.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-foreign-ready-0001' })).rejects.toThrow(/unavailable/i)
    const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-attach-ready-0001' })
    expect(attached).toMatchObject({ kind: 'attached', replayed: false })
    expect(await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-attach-ready-0001' })).toMatchObject({ threadId: attached.threadId, replayed: true })
    expect(await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-attach-ready-0002' })).toMatchObject({ threadId: attached.threadId, replayed: true })
    expect(await other.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toBeNull()
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: needFirst.thread.id })).toBeNull()
    expect(await owner.query(api.learnAdaptiveDrafts.getThreadDraft, { threadId: needFirst.thread.id })).toMatchObject({ authorityKind: 'standalone', intent: 'build', revision: 1 })
    const canvas = await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })
    expect(canvas).toMatchObject({ status: 'ready', activity: { status: 'eligible', primitive: { type: 'cited_explanation' } }, session: { studySessionId: ids.studySessionId, revision: 2 } })
    const pins = await t.run(async ctx => ctx.db.query('learningThreadActivities').withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', attached.threadId)).first())
    expect(pins?.evidenceReferences).toHaveLength(2)
    expect(pins?.evidenceReferences.map(pin => pin.claimId)).toContain(ids.laterClaimId)
    await owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'canvas-shared-start-0001' })
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'started', activity: { status: 'started' }, session: { revision: 3 } })
    await owner.mutation(api.learnV2Mastery.recordAssistanceUse, { studySessionId: ids.studySessionId, expectedSessionRevision: 3, kind: 'substantive_hint' })
    const submitted = await owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { threadId: attached.threadId, activityId: attached.activityId, studySessionId: ids.studySessionId, expectedSessionRevision: 4, expectedRevision: 2, response: 'The apple falls because Earth attracts it.', confidence: 4, idempotencyKey: 'canvas-submit-response-0001' })
    expect(submitted).toMatchObject({ kind: 'ok', value: { status: 'submitted' } })
    expect(await owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { threadId: attached.threadId, activityId: attached.activityId, studySessionId: ids.studySessionId, expectedSessionRevision: 4, expectedRevision: 2, response: 'The apple falls because Earth attracts it.', confidence: 4, idempotencyKey: 'canvas-submit-response-0001' })).toEqual(submitted)
    expect(await owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { threadId: attached.threadId, activityId: attached.activityId, studySessionId: ids.studySessionId, expectedSessionRevision: 4, expectedRevision: 2, response: 'A different response.', confidence: 4, idempotencyKey: 'canvas-submit-response-0001' })).toMatchObject({ kind: 'conflict', code: 'duplicate_key' })
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({
      status: 'submitted', activity: { status: 'submitted' },
      savedResponse: { response: 'The apple falls because Earth attracts it.', confidence: 4 },
    })
    const stagedActivity = await t.run(async ctx => ctx.db.query('learningThreadActivities').withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', attached.threadId)).first())
    expect(stagedActivity).toMatchObject({ submittedResponse: 'The apple falls because Earth attracts it.', submittedConfidence: 4 })
    const stagingReceipt = await t.run(async ctx => ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId_and_threadId', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', attached.threadId)).collect())
    expect(JSON.stringify(stagingReceipt)).not.toContain('The apple falls because Earth attracts it.')
    const telemetry = await t.run(async ctx => ctx.db.query('learnActivityEvents').withIndex('by_userId_and_threadId_and_occurredAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', attached.threadId)).take(20))
    expect(JSON.stringify(telemetry)).not.toContain('The apple falls because Earth attracts it.')
    expect(await owner.action(api.learnAdaptive.submitResponse, { threadId: attached.threadId, activityId: attached.activityId, studySessionId: ids.studySessionId, expectedSessionRevision: 4, expectedContentRevision: 1, expectedPlanRecordRevision: 5, expectedBlueprintRecordRevision: 3, response: 'The apple falls because Earth attracts it.', confidence: 4, idempotencyKey: `adaptive-canvas-score:${attached.activityId}` })).toMatchObject({ kind: 'blocked' })
    const durable = await t.run(async ctx => ({ jobs: await ctx.db.query('learnJobs').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(2), attempts: await ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(2) }))
    expect(durable).toEqual({ jobs: [], attempts: [] })
  })

  test('rejects scoring input that differs from the atomically staged response', async () => {
    await approveSyntheticPilot()
    process.env.LEARN_ADAPTIVE_V2_PILOT_MANIFEST = 'adaptive-v2-pilot.v1'
    try {
      const { t, owner, ids } = await fixture()
      const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-match-attach-0001' })
      await owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'canvas-match-start-0001' })
      const staged = await owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { threadId: attached.threadId, activityId: attached.activityId, studySessionId: ids.studySessionId, expectedSessionRevision: 3, expectedRevision: 2, response: '  Earth attracts the apple.  ', confidence: 4, idempotencyKey: 'canvas-match-stage-0001' })
      expect(await owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { threadId: attached.threadId, activityId: attached.activityId, studySessionId: ids.studySessionId, expectedSessionRevision: 3, expectedRevision: 2, response: 'Earth attracts the apple.', confidence: 4, idempotencyKey: 'canvas-match-stage-0001' })).toEqual(staged)
      expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ savedResponse: { response: 'Earth attracts the apple.', confidence: 4 } })
      expect(await owner.action(api.learnAdaptive.submitResponse, { threadId: attached.threadId, activityId: attached.activityId, studySessionId: ids.studySessionId, expectedSessionRevision: 3, expectedContentRevision: 1, expectedPlanRecordRevision: 5, expectedBlueprintRecordRevision: 3, response: 'Changed after staging.', confidence: 4, idempotencyKey: 'canvas-match-score-0001' })).toMatchObject({ kind: 'denied', code: 'adaptive_activity_authority_unavailable' })
      expect(await owner.action(api.learnAdaptive.submitResponse, { threadId: attached.threadId, activityId: attached.activityId, studySessionId: ids.studySessionId, expectedSessionRevision: 3, expectedContentRevision: 1, expectedPlanRecordRevision: 5, expectedBlueprintRecordRevision: 3, response: 'Earth attracts the apple.', confidence: 5, idempotencyKey: 'canvas-match-score-0002' })).toMatchObject({ kind: 'denied', code: 'adaptive_activity_authority_unavailable' })
      expect(await owner.action(api.learnAdaptive.submitResponse, { threadId: attached.threadId, activityId: attached.activityId, studySessionId: ids.studySessionId, expectedSessionRevision: 3, expectedContentRevision: 1, expectedPlanRecordRevision: 5, expectedBlueprintRecordRevision: 3, response: ' Earth attracts the apple. ', confidence: 4, idempotencyKey: 'canvas-match-score-0003' })).toMatchObject({ kind: 'denied', code: 'adaptive_activity_authority_unavailable' })
      expect(await t.run(ctx => ctx.db.query('learnJobs').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(1))).toEqual([])
    }
    finally {
      Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, originalManifest)
      delete process.env.LEARN_ADAPTIVE_V2_PILOT_MANIFEST
    }
  })

  test('later prompt claim invalidation blocks rendering and guarded submission', async () => {
    const { t, owner, ids } = await fixture()
    const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-attach-later-claim-0001' })
    await owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'canvas-shared-later-start-0001' })
    await t.run(async ctx => { await ctx.db.patch(ids.laterSourceSnapshotId, { effectiveStatus: 'rejected', recordRevision: 2 }) })
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'blocked', responsePrompt: null, activity: { primitive: null } })
    await expect(owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { threadId: attached.threadId, activityId: attached.activityId, studySessionId: ids.studySessionId, expectedSessionRevision: 3, expectedRevision: 2, response: 'Earth attracts it.', confidence: 4, idempotencyKey: 'canvas-blocked-later-0001' })).rejects.toThrow(/evidence is unavailable/i)
  })

  test('a comparison response selects exactly one of two pinned sources with a rationale', async () => {
    const { t, owner, ids } = await fixture()
    const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-comparison-attach-0001' })
    await owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'canvas-comparison-start-0001' })
    await t.run(async ctx => {
      const thread = (await ctx.db.get(attached.threadId))!
      const activity = (await ctx.db.get(thread.currentActivityId!))!
      await ctx.db.patch(activity._id, { primitivePlan: [{
        contractVersion: 'learn-adaptive.activity-contract.v1', rendererVersion: 'learn-adaptive.renderer.v1',
        type: 'source_comparison', action: 'submit_comparison', testId: 'learn-primitive-source-comparison',
        props: { prompt: 'Which source is stronger?', sources: [
          { sourceRef: String(ids.sourceSnapshotId), label: 'Source A', summary: 'First source.', integrityState: 'accepted' },
          { sourceRef: String(ids.laterSourceSnapshotId), label: 'Source B', summary: 'Second source.', integrityState: 'accepted' },
        ] },
      }], requiredAction: { kind: 'submit_comparison', label: 'Submit comparison' } })
    })
    const baseInput = { threadId: attached.threadId, activityId: attached.activityId, studySessionId: ids.studySessionId,
      expectedSessionRevision: 3, expectedRevision: 2, confidence: 4 }
    const invalid = [
      'Arbitrary prose without a selected source.',
      '{"version":"learn-adaptive.source-comparison-response.v1","sourceRef":"missing-source","rationale":"A clear rationale."}',
      `{"version":"learn-adaptive.source-comparison-response.v1","sourceRef":"${String(ids.sourceSnapshotId)}","rationale":""}`,
      `{"version":"learn-adaptive.source-comparison-response.v1","sourceRef":"${String(ids.sourceSnapshotId)}","sourceRef":"${String(ids.laterSourceSnapshotId)}","rationale":"A reason."}`,
    ]
    for (const [index, response] of invalid.entries()) {
      await expect(owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { ...baseInput, response, idempotencyKey: `canvas-comparison-invalid-${index}` })).rejects.toThrow(/comparison response/i)
    }
    const response = `{"version":"learn-adaptive.source-comparison-response.v1","sourceRef":"${String(ids.laterSourceSnapshotId)}","rationale":"This later review explains the observation."}`
    expect(await owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { ...baseInput, response, idempotencyKey: 'canvas-comparison-valid-0001' })).toMatchObject({ kind: 'ok', value: { status: 'submitted' } })
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ savedResponse: { response, confidence: 4 } })
  })

  test.each([
    ['conflict', { conflictStatus: 'unresolved' as const }],
    ['gap', { entailment: 'not_evaluated' as const }],
  ])('projects a bounded %s reason when pinned evidence can no longer support comparison', async (expected, update) => {
    const { t, owner, ids } = await fixture()
    const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: `canvas-${expected}-attach-0001` })
    await t.run(async ctx => {
      const support = (await ctx.db.query('learnClaimSupports').withIndex('by_userId_and_sessionContentClaimId', q => q.eq('userId', OWNER.tokenIdentifier).eq('sessionContentClaimId', ids.laterClaimId)).unique())!
      await ctx.db.patch(support._id, update)
    })
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'blocked', recoveryEvidenceIssue: expected, activity: { primitive: null } })
  })

  test('keeps the signed comparison kind available for local draft recovery while evidence blocks rendering', async () => {
    const { t, owner, ids } = await fixture()
    const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-comparison-draft-attach-0001' })
    const supportId = await t.run(async ctx => {
      const thread = (await ctx.db.get(attached.threadId))!
      const activity = (await ctx.db.get(thread.currentActivityId!))!
      const requiredAction = { kind: 'submit_comparison', label: 'Submit comparison' }
      const composed = await composeAdaptiveActivityPlan({
        activityId: activity.activityId, threadId: String(thread._id), boundaryOrdinal: activity.boundaryOrdinal,
        planRevision: activity.planRevision, activityClass: activity.activityClass, intent: activity.intent,
        objectiveId: String(activity.objectiveId), purpose: activity.purpose, reasonCode: activity.reasonCode,
        primitiveSequence: [{ type: 'source_comparison', action: 'submit_comparison', props: { prompt: 'Which source is stronger?', sources: [
          { sourceRef: String(ids.sourceSnapshotId), label: 'Source A', summary: 'First source.' },
          { sourceRef: String(ids.laterSourceSnapshotId), label: 'Source B', summary: 'Second source.' },
        ] } }], requiredAction, evaluationContract: activity.evaluationContract,
        accessibilityMetadata: activity.accessibilityMetadata,
        pins: { learningVoidId: String(activity.learningVoidId), blueprintRevisionId: String(activity.blueprintRevisionId), objectiveId: String(activity.objectiveId), sessionContentId: String(activity.sessionContentId) },
        evidenceReferences: activity.evidenceReferences.map(reference => ({ ...reference, claimId: String(reference.claimId), supportId: String(reference.supportId), sourceSnapshotId: String(reference.sourceSnapshotId) })),
        generationInputs: activity.generationInputs, decisionInputs: activity.decisionInputs,
      })
      await ctx.db.patch(activity._id, { primitivePlan: composed.primitivePlan, requiredAction,
        canonicalInputSnapshot: composed.canonicalInputSnapshot, inputDigest: composed.inputDigest })
      const support = (await ctx.db.query('learnClaimSupports').withIndex('by_userId_and_sessionContentClaimId', q => q.eq('userId', OWNER.tokenIdentifier).eq('sessionContentClaimId', ids.laterClaimId)).unique())!
      return support._id
    })
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'ready', activity: { draftKind: 'source_comparison', primitive: { type: 'source_comparison' } } })
    await t.run(ctx => ctx.db.patch(supportId, { conflictStatus: 'unresolved' }))
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'blocked', activity: { draftKind: 'source_comparison', primitive: null } })
    await t.run(ctx => ctx.db.patch(supportId, { conflictStatus: 'clear' }))
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'ready', activity: { draftKind: 'source_comparison', primitive: { type: 'source_comparison' } } })
  })

  test('stages an independent application only when its prompt matches the scored content', async () => {
    const { t, owner, ids } = await fixture()
    const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-application-attach-0001' })
    await owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'canvas-application-start-0001' })
    const prompt = await t.run(async ctx => {
      const thread = (await ctx.db.get(attached.threadId))!
      const activity = (await ctx.db.get(thread.currentActivityId!))!
      const blocks = await ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', OWNER.tokenIdentifier).eq('sessionContentId', activity.sessionContentId!)).take(17)
      const prompt = blocks.find(block => block.kind === 'independent_application')!.content!
      await ctx.db.patch(activity._id, { primitivePlan: [{ contractVersion: 'learn-adaptive.activity-contract.v1', rendererVersion: 'learn-adaptive.renderer.v1', type: 'independent_application', action: 'submit_response', testId: 'learn-primitive-independent-application', props: { prompt: 'Different scored question.', responseFormat: 'long_text', draftPersistence: true } }], requiredAction: { kind: 'submit_response', label: 'Submit response' } })
      return prompt
    })
    const input = { threadId: attached.threadId, activityId: attached.activityId, studySessionId: ids.studySessionId, expectedSessionRevision: 3, expectedRevision: 2, response: 'Earth attracts the apple.', confidence: 4 }
    await expect(owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { ...input, idempotencyKey: 'canvas-application-bad-0001' })).rejects.toThrow(/Independent application response is invalid/)
    await t.run(async ctx => {
      const thread = (await ctx.db.get(attached.threadId))!
      await ctx.db.patch(thread.currentActivityId!, { primitivePlan: [{ contractVersion: 'learn-adaptive.activity-contract.v1', rendererVersion: 'learn-adaptive.renderer.v1', type: 'independent_application', action: 'submit_response', testId: 'learn-primitive-independent-application', props: { prompt, responseFormat: 'long_text', draftPersistence: true } }] })
    })
    expect(await owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { ...input, idempotencyKey: 'canvas-application-good-0001' })).toMatchObject({ kind: 'ok', value: { status: 'submitted' } })
  })

  test('non-rendered claims and extra supports must be ready before attach and while responding', async () => {
    const beforeAttach = await fixture()
    await beforeAttach.t.run(async ctx => {
      const extraClaimId = await ctx.db.insert('sessionContentClaims', { userId: OWNER.tokenIdentifier, sessionContentId: beforeAttach.ids.sessionContentId, order: 2, claim: 'A non-rendered claim.', verifierVersion: 'learn-v2.entailment.v2', confidence: 0.95 })
      await ctx.db.insert('learnClaimSupports', { userId: OWNER.tokenIdentifier, sessionContentClaimId: extraClaimId, sourceExcerptId: beforeAttach.ids.laterExcerptId, sourceSnapshotId: beforeAttach.ids.laterSourceSnapshotId, entailment: 'entailed', verifierVersion: 'learn-v2.entailment.v2', confidence: 0.95, conflictStatus: 'unresolved', evidenceStatus: 'evidence_available' })
    })
    expect(await beforeAttach.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'blocked', reason: 'content_evidence_unavailable' })
    await expect(beforeAttach.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: beforeAttach.ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-bad-extra-claim-0001' })).rejects.toThrow(/evidence/i)

    const afterAttach = await fixture()
    const attached = await afterAttach.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: afterAttach.ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-extra-support-attach-0001' })
    await afterAttach.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: afterAttach.ids.studySessionId, expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'canvas-extra-support-start-0001' })
    await afterAttach.t.run(async ctx => {
      await ctx.db.insert('learnClaimSupports', { userId: OWNER.tokenIdentifier, sessionContentClaimId: afterAttach.ids.laterClaimId, sourceExcerptId: afterAttach.ids.laterExcerptId, sourceSnapshotId: afterAttach.ids.laterSourceSnapshotId, entailment: 'entailed', verifierVersion: 'learn-v2.entailment.v2', confidence: 0.95, conflictStatus: 'unresolved', evidenceStatus: 'evidence_available' })
    })
    expect(await afterAttach.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'blocked', responsePrompt: null })
    await expect(afterAttach.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: afterAttach.ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-extra-support-attach-0001' })).rejects.toThrow(/evidence/i)
    await expect(afterAttach.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { threadId: attached.threadId, activityId: attached.activityId, studySessionId: afterAttach.ids.studySessionId, expectedSessionRevision: 3, expectedRevision: 2, response: 'Earth attracts it.', confidence: 4, idempotencyKey: 'canvas-bad-extra-support-0001' })).rejects.toThrow(/evidence/i)
  })

  test('an ended activity cannot attach the same session content again', async () => {
    const { t, owner, ids } = await fixture()
    const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-ended-attach-0001' })
    await t.run(async ctx => {
      const activity = await ctx.db.query('learningThreadActivities').withIndex('by_userId_and_activityId', q => q.eq('userId', OWNER.tokenIdentifier).eq('activityId', attached.activityId)).unique()
      if (!activity) throw new Error('Expected activity')
      await ctx.db.patch(activity._id, { status: 'ended' })
    })
    await expect(owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-ended-attach-0002' })).rejects.toThrow(/already has an adaptive activity/i)
  })

  test('approved pilot admits staged response only through existing V2 job and attempt authority', async () => {
    await approveSyntheticPilot()
    process.env.LEARN_ADAPTIVE_V2_PILOT_MANIFEST = 'adaptive-v2-pilot.v1'
    process.env.OPENROUTER_API_KEY = 'test-key'
    process.env.CF_ACCOUNT_ID = 'test-account'
    process.env.CLOUDFLARE_AI_GATEWAY_ID = 'test-gateway'
    const provider = vi.fn(async () => new Response(JSON.stringify({ id: 'canvas-score', model: 'test/mastery-model', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ criterionResults: [{ key: 'accuracy', awarded: true }], misconceptionTags: [] }) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', provider)
    try {
      const { t, owner, ids } = await fixture()
      const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-admit-attach-0001' })
      expect(await owner.query(api.learnAdaptive.getThread, { threadId: attached.threadId })).toMatchObject({
        completion: null, thread: { authorityKind: 'v2_mission', learningVoidId: ids.learningVoidId },
      })
      await owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'canvas-admit-start-0001' })
      expect(await owner.query(api.learnAdaptive.getThread, { threadId: attached.threadId })).toMatchObject({ completion: null })
      await owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { threadId: attached.threadId, activityId: attached.activityId, studySessionId: ids.studySessionId, expectedSessionRevision: 3, expectedRevision: 2, response: 'Earth attracts the apple.', confidence: 4, idempotencyKey: 'canvas-admit-stage-0001' })
      const admitted = await owner.action(api.learnAdaptive.submitResponse, { threadId: attached.threadId, activityId: attached.activityId, studySessionId: ids.studySessionId, expectedSessionRevision: 3, expectedContentRevision: 1, expectedPlanRecordRevision: 5, expectedBlueprintRecordRevision: 3, response: 'Earth attracts the apple.', confidence: 4, idempotencyKey: 'canvas-admit-score-0001' })
      expect(admitted).toMatchObject({ kind: 'accepted', status: 'completed' })
      expect(provider).toHaveBeenCalledTimes(1)
      const durable = await t.run(async ctx => ({
        jobs: await ctx.db.query('learnJobs').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).collect(),
        attempts: await ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).collect(),
        activity: await ctx.db.query('learningThreadActivities').withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', attached.threadId)).first(),
      }))
      expect(durable.jobs.filter(job => job.type === 'mastery_scoring')).toHaveLength(1)
      expect(durable.jobs[0]).toMatchObject({ adaptiveThreadId: attached.threadId, studySessionId: ids.studySessionId })
      expect(durable.attempts).toHaveLength(1)
      expect(durable.attempts[0]).toMatchObject({ studySessionId: ids.studySessionId, response: 'Earth attracts the apple.' })
      expect(durable.activity).toMatchObject({ activityId: attached.activityId, status: 'feedback' })
      expect(durable.activity?.submittedResponse).toBeUndefined()
      expect(durable.activity?.submittedConfidence).toBeUndefined()
      expect(durable.activity?.evidenceReferences).toHaveLength(2)
      expect(await owner.query(api.learnAdaptive.getThread, { threadId: attached.threadId })).toMatchObject({
        thread: { authorityKind: 'v2_mission', learningVoidId: ids.learningVoidId, evidenceState: 'ready' },
        completion: { status: 'passed', basis: 'server_scored_representative_task', activityId: attached.activityId },
        nextAction: { kind: 'open_v2_mission', label: 'Choose your next move in your Void', reasonCode: 'representative_pass', activityId: attached.activityId },
      })
      const persistedAction = { kind: 'open_v2_mission', reasonCode: 'representative_pass', activityId: attached.activityId }
      const persistLabel = (label: string) => t.run(ctx => ctx.db.patch(attached.threadId, { nextAction: { ...persistedAction, label } }))
      await persistLabel('Choose your next move in your learning mission')
      expect((await owner.query(api.learnAdaptive.getThread, { threadId: attached.threadId }))?.nextAction).toEqual({ ...persistedAction, label: 'Choose your next move in your Void' })
      expect((await t.run(ctx => ctx.db.get(attached.threadId)))?.nextAction?.label).toBe('Choose your next move in your learning mission')
      await persistLabel('Review your learning mission')
      expect((await owner.query(api.learnAdaptive.getThread, { threadId: attached.threadId }))?.nextAction).toEqual({ ...persistedAction, label: 'Review your learning mission' })
      await persistLabel('Choose your next move in your Void')
      expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'feedback' })
      await t.run(ctx => ctx.db.patch(ids.studySessionId, { startedSessionContentRevision: 2 }))
      expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'blocked' })
      await t.run(ctx => ctx.db.patch(ids.studySessionId, { startedSessionContentRevision: 1 }))
      await t.run(ctx => ctx.db.patch(ids.studySessionId, { startedSessionContentId: undefined }))
      expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'blocked' })
      await t.run(ctx => ctx.db.patch(ids.studySessionId, { startedSessionContentId: ids.sessionContentId }))
      await t.run(ctx => ctx.db.patch(durable.attempts[0]!._id, { contentRevision: 2 }))
      expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'blocked' })
      await t.run(ctx => ctx.db.patch(durable.attempts[0]!._id, { contentRevision: 1 }))
      expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'feedback' })
      await t.run(ctx => ctx.db.patch(ids.sessionContentId, { status: 'superseded' }))
      expect(await owner.query(api.learnAdaptive.getThread, { threadId: attached.threadId })).toMatchObject({
        completion: { status: 'passed' }, thread: { evidenceState: 'stale' }, nextAction: { kind: 'recover' },
      })
    }
    finally {
      Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, originalManifest)
      delete process.env.LEARN_ADAPTIVE_V2_PILOT_MANIFEST
      delete process.env.OPENROUTER_API_KEY
      delete process.env.CF_ACCOUNT_ID
      delete process.env.CLOUDFLARE_AI_GATEWAY_ID
      vi.unstubAllGlobals()
    }
  })
})
