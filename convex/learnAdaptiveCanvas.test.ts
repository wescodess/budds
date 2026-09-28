/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const pilotFixture = vi.hoisted(() => ({ approved: false }))
vi.mock('../shared/adaptive-v2-pilot-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/adaptive-v2-pilot-policy')>()
  const approved = { ...actual.ADAPTIVE_V2_PILOT_MANIFEST, pilotApproved: true,
    cohort: { ...actual.ADAPTIVE_V2_PILOT_MANIFEST.cohort, subjectHashes: ['sha256:3dcadcd97535d79753fb6bb2909f96bdd4588933bc9faadea9992b691233cfa2'] },
    modelPolicies: [{ model: 'test/mastery-model', inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.1 }] }
  return { ...actual, adaptiveV2PilotDecision: (configuredVersion: unknown, input: Parameters<typeof actual.adaptiveV2PilotDecision>[1]) =>
    actual.adaptiveV2PilotDecision(configuredVersion, input, pilotFixture.approved ? approved : actual.ADAPTIVE_V2_PILOT_MANIFEST) }
})

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|canvas-owner' }
const OTHER = { tokenIdentifier: 'https://auth.example.com|canvas-other' }
const originalFlag = process.env.LEARN_V2_ENABLED

beforeEach(() => { process.env.LEARN_V2_ENABLED = 'true'; pilotFixture.approved = false })
afterAll(() => { if (originalFlag === undefined) delete process.env.LEARN_V2_ENABLED; else process.env.LEARN_V2_ENABLED = originalFlag })

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
    return { folderId, studySessionId, sessionContentId, learningVoidId, laterSourceSnapshotId, laterExcerptId, laterClaimId }
  })
  return { t, owner, other, ids }
}

describe('ready V2 adaptive Canvas', () => {
  test('factual thread recovers from deleted or non-owned folder despite retained ready Canvas snapshots', async () => {
    const { t, owner, ids } = await fixture()
    const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, {
      studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-folder-source-authority1',
    })
    const read = async () => await owner.query(api.learnAdaptive.getThread, { threadId: attached.threadId })
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'ready' })

    await t.run(ctx => ctx.db.patch(ids.folderId, { userId: OTHER.tokenIdentifier }))
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'ready' })
    expect(await read()).toMatchObject({ thread: { evidenceState: 'unavailable' }, nextAction: { kind: 'recover', activityId: attached.activityId } })

    await t.run(ctx => ctx.db.patch(ids.folderId, { userId: OWNER.tokenIdentifier }))
    expect(await read()).toMatchObject({ thread: { evidenceState: 'ready' }, nextAction: { kind: 'continue' } })
    await t.run(ctx => ctx.db.delete(ids.folderId))
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'ready' })
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
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'ready' })
    expect(await read()).toMatchObject({ thread: { evidenceState: 'unavailable' }, nextAction: { kind: 'recover', activityId: attached.activityId } })

    await t.run(ctx => ctx.db.patch(documentId, { userId: OWNER.tokenIdentifier }))
    await t.run(ctx => ctx.db.delete(documentId))
    expect(await owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'ready' })
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
    expect(await read()).toMatchObject({ thread: { evidenceState: 'stale' }, nextAction: { kind: 'recover', activityId: attached.activityId } })

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
    pilotFixture.approved = true
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
      pilotFixture.approved = false
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
    pilotFixture.approved = true
    process.env.LEARN_ADAPTIVE_V2_PILOT_MANIFEST = 'adaptive-v2-pilot.v1'
    process.env.OPENROUTER_API_KEY = 'test-key'
    process.env.CF_ACCOUNT_ID = 'test-account'
    process.env.CLOUDFLARE_AI_GATEWAY_ID = 'test-gateway'
    const provider = vi.fn(async () => new Response(JSON.stringify({ id: 'canvas-score', model: 'test/mastery-model', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ criterionResults: [{ key: 'accuracy', awarded: true }], misconceptionTags: [] }) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', provider)
    try {
      const { t, owner, ids } = await fixture()
      const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas-admit-attach-0001' })
      await owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: ids.studySessionId, expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'canvas-admit-start-0001' })
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
    }
    finally {
      pilotFixture.approved = false
      delete process.env.LEARN_ADAPTIVE_V2_PILOT_MANIFEST
      delete process.env.OPENROUTER_API_KEY
      delete process.env.CF_ACCOUNT_ID
      delete process.env.CLOUDFLARE_AI_GATEWAY_ID
      vi.unstubAllGlobals()
    }
  })
})
