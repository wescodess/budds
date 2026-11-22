/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import baseline from '../tests/fixtures/c4-off-parity/c5-dev-427bd0fa.json'

const pin = '427bd0fa7f0542732a6597f89da89763d7faf57f'
const modules = import.meta.glob('./**/*.ts')
const userId = 'https://auth.example|c5-off-parity'
const contract = { version: 'learn-v2.assessment.v1' as const, kind: 'machine_checkable' as const, responseFormat: 'short_text' as const,
  instructions: 'Apply the source rule.', passingScorePercent: 80 as const, criteria: [{ key: 'rule', description: 'Apply the rule correctly.', weightPercent: 100 }] }

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_001); vi.stubEnv('LEARN_V2_ENABLED', 'true') })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

function expectPinned(key: string, value: unknown) {
  const serialized: unknown = JSON.parse(JSON.stringify(value))
  if (import.meta.env.C5_RECORD_DEV === pin) console.log(`C5_DEV_FIXTURE ${JSON.stringify({ key, value: serialized })}`)
  else {
    expect(Object.hasOwn(baseline, key), `Missing pinned dev fixture: ${key}`).toBe(true)
    expect(serialized).toEqual((baseline as Record<string, unknown>)[key])
  }
}

async function fixture(placementKind: 'learning' | 'retained_review' = 'learning', started = true) {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity({ tokenIdentifier: userId })
  const ids = await t.run(async ctx => {
    const now = Date.now()
    await ctx.db.insert('users', { tokenIdentifier: userId, name: 'Learner', learnV2Entitlement: { enabled: true, updatedAt: now } })
    const folderId = await ctx.db.insert('folders', { userId, name: 'Sources', documentCount: 0 })
    const learningVoidId = await ctx.db.insert('learningVoids', { userId, folderId, title: 'Capability', status: 'active', revision: 1, createdAt: now, updatedAt: now })
    const blueprintId = await ctx.db.insert('learnBlueprints', { userId, learningVoidId, revision: 1, createdAt: now })
    const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { userId, blueprintId, learningVoidId, revision: 1, recordRevision: 1, status: 'accepted', createdAt: now, updatedAt: now })
    await ctx.db.patch(learningVoidId, { activeBlueprintRevisionId: blueprintRevisionId })
    const objectiveId = await ctx.db.insert('learnObjectives', { userId, blueprintRevisionId, order: 0, title: 'Apply a rule', depth: 'working', assessmentContract: contract })
    const studyPlanId = await ctx.db.insert('studyPlans', { userId, learningVoidId, revision: 1, createdAt: now })
    const studyPlanRevisionId = await ctx.db.insert('studyPlanRevisions', { userId, studyPlanId, learningVoidId, revision: 1, recordRevision: 1, status: 'accepted', blueprintRevisionId, blueprintRecordRevision: 1, timezone: 'UTC', createdAt: now })
    await ctx.db.patch(studyPlanId, { activeRevisionId: studyPlanRevisionId })
    const studySessionId = await ctx.db.insert('studySessions', { userId, studyPlanRevisionId, primaryObjectiveId: objectiveId, status: started ? 'in_progress' : 'ready', revision: 1, scheduledStartAt: now, timezone: 'UTC', placementKind })
    const sessionContentId = await ctx.db.insert('sessionContent', { userId, studySessionId, studyPlanRevisionId, blueprintRevisionId, objectiveId, revision: 1, status: 'published', assessmentRubricSnapshot: JSON.stringify(contract), createdAt: now, publishedAt: now })
    if (started) await ctx.db.patch(studySessionId, { startedSessionContentId: sessionContentId, startedSessionContentRevision: 1 })
    for (const [index, kind] of ['worked_example', 'faded_example', 'transfer_challenge'].entries()) {
      await ctx.db.insert('sessionContentBlocks', { userId, sessionContentId, order: index, kind: kind as 'worked_example' | 'faded_example' | 'transfer_challenge', content: `Teaching ${kind}` })
    }
    return { learningVoidId, blueprintRevisionId, objectiveId, studyPlanId, studyPlanRevisionId, studySessionId, sessionContentId }
  })
  return { t, owner, ids }
}

test.each([false, true])('off-state retained content matches pinned dev when started=%s', async started => {
  const f = await fixture('retained_review', started)
  expectPinned(`retained.read.${started}`, await f.owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: f.ids.studySessionId }))
  expectPinned(`retained.delivery.${started}`, await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.ids.studySessionId, idempotencyKey: 'off_retained_delivery' }))
})

test('off-state retained start matches pinned dev', async () => {
  const f = await fixture('retained_review', false)
  expectPinned('retained.start', await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: f.ids.studySessionId, expectedSessionRevision: 1, expectedContentRevision: 1, idempotencyKey: 'off_retained_start' }))
})

test('off-state retained generation retry matches pinned dev', async () => {
  const f = await fixture('retained_review', false)
  await f.t.run(async ctx => {
    await ctx.db.patch(f.ids.studySessionId, { status: 'blocked' })
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { userId, learningVoidId: f.ids.learningVoidId, origin: 'user_url', externalKey: 'off_retained_source' })
    const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', { userId, learningVoidId: f.ids.learningVoidId, sourceIdentityId, revision: 1, status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear', createdAt: Date.now() })
    await ctx.db.insert('learnJobs', { userId, learningVoidId: f.ids.learningVoidId, blueprintRevisionId: f.ids.blueprintRevisionId, studyPlanRevisionId: f.ids.studyPlanRevisionId,
      studySessionId: f.ids.studySessionId, type: 'session_content_generation', status: 'blocked', revision: 1, idempotencyKey: 'off_retained_prior', dispatchSupportingSourceSnapshotIds: [sourceSnapshotId] })
  })
  expectPinned('retained.retry', await f.owner.mutation(api.learnV2SessionContent.retrySessionContentGeneration, { studySessionId: f.ids.studySessionId, expectedSessionRevision: 1, idempotencyKey: 'off_retained_retry' }))
})

test.each(['learning', 'retained_review'] as const)('off-state %s help delivery and replay match pinned dev', async kind => {
  const f = await fixture(kind)
  const request = { studySessionId: f.ids.studySessionId, expectedSessionRevision: 1, kind: 'substantive_hint' as const }
  expectPinned(`help.${kind}.first`, await f.owner.mutation(api.learnV2Mastery.recordAssistanceUse, request))
  expectPinned(`help.${kind}.replay`, await f.owner.mutation(api.learnV2Mastery.recordAssistanceUse, request))
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(1))).toEqual([])
})

test.each(['legacy', 'persisted', 'invalid'] as const)('off-state %s mastery feedback replay matches pinned dev', async kind => {
  const f = await fixture()
  const request = { studySessionId: f.ids.studySessionId, expectedSessionRevision: 1, expectedContentRevision: 1, expectedPlanRecordRevision: 1, expectedBlueprintRecordRevision: 1, response: 'My answer', confidence: 4, idempotencyKey: 'off_mastery_replay' }
  const projection = { templateVersion: 'learn-adaptive.feedback-templates.v1' as const, taxonomyVersion: 'learn-adaptive.misconception-taxonomy.v1' as const, criterionResults: [{ key: 'rule', label: 'Apply the rule correctly.', awarded: true, template: 'criterion_met', message: 'Apply the rule correctly.: criterion met.' }], misconceptionTags: [], misconceptionFeedback: [] }
  await f.t.run(ctx => ctx.db.insert('masteryAttempts', { userId, objectiveId: f.ids.objectiveId, blueprintRevisionId: f.ids.blueprintRevisionId, studySessionId: f.ids.studySessionId,
    attemptedAt: Date.now(), idempotencyKey: request.idempotencyKey, requestFingerprint: JSON.stringify({ command: 'submitMasteryAttempt', ...request, idempotencyKey: undefined }),
    kind: 'independent_application', serverScorePercent: 100, result: 'independent', criterionResultsJson: JSON.stringify([{ key: 'rule', awarded: true }]), misconceptionTagsJson: '[]', rubricSnapshot: JSON.stringify(contract),
    ...(kind === 'legacy' ? {} : { feedbackTemplateVersion: projection.templateVersion, misconceptionTaxonomyVersion: projection.taxonomyVersion, feedbackProjectionJson: JSON.stringify(kind === 'invalid' ? { ...projection, criterionResults: null } : projection) }) }))
  try { expectPinned(`feedback.${kind}`, await f.owner.action(api.learnV2Mastery.submitMasteryAttempt, request)) }
  catch (error) {
    if (kind !== 'invalid') throw error
    expectPinned(`feedback.${kind}`, { error: (error as Error).message })
  }
})

test('off-state Canvas attach, read, stage, replay and scoring match pinned dev with Phase A keys', async () => {
  const f = await fixture('learning', false)
  await f.t.run(async ctx => {
    const user = (await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique())!
    await ctx.db.patch(user._id, { learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: Date.now() } })
    await ctx.db.patch(f.ids.sessionContentId, { inputDigest: `sha256:${'a'.repeat(64)}`, generatorVersion: 'learn-v2.session-content.v1', providerModel: 'test/model' })
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { userId, learningVoidId: f.ids.learningVoidId, origin: 'user_url', externalKey: 'off_canvas_source' })
    const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', { userId, learningVoidId: f.ids.learningVoidId, sourceIdentityId,
      blueprintRevisionId: f.ids.blueprintRevisionId, revision: 1, recordRevision: 1, status: 'user_accepted', effectiveStatus: 'user_accepted',
      rightsStatus: 'permitted', conflictStatus: 'clear', createdAt: Date.now() })
    await ctx.db.insert('learnObjectiveSources', { userId, objectiveId: f.ids.objectiveId, sourceSnapshotId, coverage: 'strong' })
    const sourceExcerptId = await ctx.db.insert('learnSourceExcerpts', { userId, sourceSnapshotId, locator: 'rule', excerpt: 'The source supports this rule.', rightsStatus: 'permitted' })
    const claimId = await ctx.db.insert('sessionContentClaims', { userId, sessionContentId: f.ids.sessionContentId, order: 0,
      claim: 'The source supports this rule.', verifierVersion: 'verifier.v1', confidence: 0.95 })
    await ctx.db.insert('learnClaimSupports', { userId, sessionContentClaimId: claimId, sourceExcerptId, sourceSnapshotId,
      entailment: 'entailed', conflictStatus: 'clear', evidenceStatus: 'evidence_available', verifierVersion: 'verifier.v1', confidence: 0.95 })
    await ctx.db.insert('sessionContentBlocks', { userId, sessionContentId: f.ids.sessionContentId, order: 3, kind: 'explanation',
      content: 'Study the supported explanation.', claimOrdersJson: '[0]' })
    await ctx.db.insert('sessionContentBlocks', { userId, sessionContentId: f.ids.sessionContentId, order: 4, kind: 'independent_application',
      content: 'Apply the rule independently.', claimOrdersJson: '[0]' })
  })
  const attach = { studySessionId: f.ids.studySessionId, expectedSessionRevision: 1,
    idempotencyKey: 'adaptive-ready-12345678-1234-1234-1234-123456789012' }
  const attached = await f.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, attach)
  if (attached.kind !== 'attached') throw new Error('Expected Canvas attachment')
  expectPinned('canvas.attach', attached)
  expectPinned('canvas.attach.replay', await f.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, attach))
  expectPinned('canvas.ready', await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId }))
  expectPinned('canvas.ready.delivery', await f.owner.mutation(api.learnAdaptiveCanvas.getCanvasDelivery, { threadId: attached.threadId, idempotencyKey: 'canvas_off_delivery_1234567890' }))
  await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: f.ids.studySessionId, expectedSessionRevision: 1,
    expectedContentRevision: 1, idempotencyKey: 'canvas_start_1234567890' })
  const stage = { threadId: attached.threadId, activityId: attached.activityId, studySessionId: f.ids.studySessionId,
    expectedSessionRevision: 2, expectedRevision: 2, response: 'My committed response.', confidence: 3,
    idempotencyKey: 'adaptive-canvas-submit-12345678-1234-1234-1234-123456789012' }
  expectPinned('canvas.stage', await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, stage))
  expectPinned('canvas.stage.replay', await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, stage))
  expectPinned('canvas.submitted', await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId }))
  expectPinned('canvas.score.denied', await f.owner.action(api.learnAdaptive.submitResponse, { threadId: attached.threadId, activityId: attached.activityId,
    studySessionId: f.ids.studySessionId, expectedSessionRevision: 2, expectedContentRevision: 1, expectedPlanRecordRevision: 1,
    expectedBlueprintRecordRevision: 1, response: stage.response, confidence: stage.confidence, idempotencyKey: 'canvas_score_1234567890' }))
})

test.each([false, true])('off-state Today learning list and content match pinned dev when started=%s', async started => {
  const f = await fixture('learning', started)
  expectPinned(`today.list.${started}`, await f.owner.query(api.learnV2Today.getToday, {}))
  expectPinned(`today.read.${started}`, await f.owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: f.ids.studySessionId }))
  expectPinned(`today.delivery.${started}`, await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.ids.studySessionId, idempotencyKey: 'off_today_delivery' }))
})

test('off-state Today learning start and replay match pinned dev', async () => {
  const f = await fixture('learning', false)
  const request = { studySessionId: f.ids.studySessionId, expectedSessionRevision: 1, expectedContentRevision: 1, idempotencyKey: 'off_today_start' }
  expectPinned('today.start', await f.owner.mutation(api.learnV2SessionContent.startStudySession, request))
  expectPinned('today.start.replay', await f.owner.mutation(api.learnV2SessionContent.startStudySession, request))
  expect(await f.t.run(ctx => ctx.db.query('learnMeasurementAssignments').take(1))).toEqual([])
})

test('off-state Today learning generation retry matches pinned dev', async () => {
  const f = await fixture('learning', false)
  await f.t.run(async ctx => {
    await ctx.db.patch(f.ids.studySessionId, { status: 'blocked' })
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { userId, learningVoidId: f.ids.learningVoidId, origin: 'user_url', externalKey: 'off_today_source' })
    const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', { userId, learningVoidId: f.ids.learningVoidId, sourceIdentityId, revision: 1, status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear', createdAt: Date.now() })
    await ctx.db.insert('learnJobs', { userId, learningVoidId: f.ids.learningVoidId, blueprintRevisionId: f.ids.blueprintRevisionId, studyPlanRevisionId: f.ids.studyPlanRevisionId,
      studySessionId: f.ids.studySessionId, type: 'session_content_generation', status: 'blocked', revision: 1, idempotencyKey: 'off_today_prior', dispatchSupportingSourceSnapshotIds: [sourceSnapshotId] })
  })
  expectPinned('today.retry', await f.owner.mutation(api.learnV2SessionContent.retrySessionContentGeneration, { studySessionId: f.ids.studySessionId, expectedSessionRevision: 1, idempotencyKey: 'off_today_retry' }))
})

test.each([false, true])('off-state Today ready row with supported evidence matches pinned dev when started=%s', async started => {
  const f = await fixture('learning', started)
  await f.t.run(async ctx => {
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { userId, learningVoidId: f.ids.learningVoidId, origin: 'user_url', externalKey: 'off_today_evidence' })
    const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', { userId, learningVoidId: f.ids.learningVoidId, sourceIdentityId, revision: 1, status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear', createdAt: Date.now() })
    const sourceExcerptId = await ctx.db.insert('learnSourceExcerpts', { userId, sourceSnapshotId, locator: 'rule:1', excerpt: 'The rule applies.', rightsStatus: 'permitted' })
    const sessionContentClaimId = await ctx.db.insert('sessionContentClaims', { userId, sessionContentId: f.ids.sessionContentId, order: 0, claim: 'The rule applies.' })
    await ctx.db.insert('learnClaimSupports', { userId, sessionContentClaimId, sourceSnapshotId, sourceExcerptId, entailment: 'entailed', conflictStatus: 'clear', evidenceStatus: 'evidence_available', verifierVersion: 'learn-v2.entailment.v2', confidence: 0.95 })
  })
  expectPinned(`today.list.ready.${started}`, await f.owner.query(api.learnV2Today.getToday, {}))
  expectPinned(`today.read.ready.${started}`, await f.owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: f.ids.studySessionId }))
})
