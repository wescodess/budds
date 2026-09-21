/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import type { Infer } from 'convex/values'
import { describe, expect, test } from 'vitest'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import type { commitAdaptiveActivityPlanValidator } from '../shared/adaptive-learn-storage-manifest'

const modules = import.meta.glob('./**/*.ts')
const ownerId = 'https://auth.example.com|adaptive-plan-owner'
const otherId = 'https://auth.example.com|adaptive-plan-other'

async function fixture() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = 1_800_000_000_000
    const folderId = await ctx.db.insert('folders', { userId: ownerId, name: 'Adaptive sources', documentCount: 0 })
    const learningVoidId = await ctx.db.insert('learningVoids', { userId: ownerId, folderId, title: 'Photosynthesis', status: 'active', revision: 4, createdAt: now, updatedAt: now })
    const blueprintId = await ctx.db.insert('learnBlueprints', { userId: ownerId, learningVoidId, revision: 1, createdAt: now })
    const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { userId: ownerId, blueprintId, learningVoidId, revision: 2, recordRevision: 5, status: 'accepted', createdAt: now, updatedAt: now })
    await ctx.db.patch(learningVoidId, { activeBlueprintRevisionId: blueprintRevisionId })
    const objectiveId = await ctx.db.insert('learnObjectives', { userId: ownerId, blueprintRevisionId, order: 0, title: 'Explain photosynthesis' })
    const studyPlanId = await ctx.db.insert('studyPlans', { userId: ownerId, learningVoidId, revision: 1, createdAt: now })
    const studyPlanRevisionId = await ctx.db.insert('studyPlanRevisions', { userId: ownerId, studyPlanId, learningVoidId, revision: 1, status: 'active', blueprintRevisionId, blueprintRecordRevision: 5, createdAt: now })
    const studySessionId = await ctx.db.insert('studySessions', { userId: ownerId, studyPlanRevisionId, primaryObjectiveId: objectiveId, status: 'ready', revision: 1, scheduledStartAt: now })
    const sessionContentId = await ctx.db.insert('sessionContent', { userId: ownerId, studySessionId, studyPlanRevisionId, blueprintRevisionId, objectiveId, revision: 2, status: 'published', inputDigest: `sha256:${'a'.repeat(64)}`, generatorVersion: 'learn-v2.session-content.v1', createdAt: now, publishedAt: now })
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { userId: ownerId, learningVoidId, origin: 'user_url', externalKey: 'source-1' })
    const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', { userId: ownerId, sourceIdentityId, learningVoidId, blueprintRevisionId, revision: 3, recordRevision: 7, status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear', createdAt: now })
    const sourceExcerptId = await ctx.db.insert('learnSourceExcerpts', { userId: ownerId, sourceSnapshotId, locator: 'page:1', rightsStatus: 'permitted' })
    const claimId = await ctx.db.insert('sessionContentClaims', { userId: ownerId, sessionContentId, order: 0, claim: 'Plants convert light energy.', verifierVersion: 'learn-v2.entailment.v2', confidence: 0.95 })
    const supportId = await ctx.db.insert('learnClaimSupports', { userId: ownerId, sessionContentClaimId: claimId, sourceExcerptId, sourceSnapshotId, entailment: 'entailed', verifierVersion: 'learn-v2.entailment.v2', confidence: 0.95, conflictStatus: 'clear', evidenceStatus: 'evidence_available' })
    const threadId = await ctx.db.insert('learningThreads', {
      userId: ownerId,
      originalNeed: 'I need to understand photosynthesis.',
      intent: 'understand',
      availableTime: '25',
      authorityKind: 'v2_mission',
      learningVoidId,
      sourceScope: { kind: 'folder', sourceId: String(folderId) },
      evidenceState: 'ready',
      lifecycle: 'ready',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    })
    return { threadId, learningVoidId, blueprintRevisionId, objectiveId, sessionContentId, sourceSnapshotId, claimId, supportId }
  })
  return { t, ids }
}

function planArgs(ids: Awaited<ReturnType<typeof fixture>>['ids'], overrides: Record<string, unknown> = {}): Infer<typeof commitAdaptiveActivityPlanValidator> {
  return {
    threadId: ids.threadId,
    activityId: 'activity-001',
    boundaryOrdinal: 1,
    planRevision: 1,
    activityClass: 'factual' as const,
    intent: 'understand' as const,
    objectiveId: ids.objectiveId,
    purpose: 'Explain the accepted mechanism before independent practice.',
    reasonCode: 'accepted_evidence_explanation',
    primitiveSequence: [{ type: 'cited_explanation', action: 'continue', props: { heading: 'Photosynthesis', explanation: 'Plants convert light energy into stored chemical energy.', sourceRefs: [String(ids.sourceSnapshotId)] } }],
    requiredAction: { kind: 'continue', label: 'Continue' },
    evaluationContract: { version: 'learn-adaptive.evaluation.v1', kind: 'acknowledgement' as const, responseFormat: 'none' as const, passingScorePercent: null },
    accessibilityMetadata: { heading: 'Photosynthesis', instructions: 'Read the explanation and continue.', focusTargetTestId: 'learn-primitive-cited-explanation', liveRegionMode: 'polite' as const },
    learningVoidId: ids.learningVoidId,
    blueprintRevisionId: ids.blueprintRevisionId,
    sessionContentId: ids.sessionContentId,
    evidenceReferences: [{ claimId: ids.claimId, supportId: ids.supportId, sourceSnapshotId: ids.sourceSnapshotId }],
    decisionInputs: { routerVersion: 'learn-adaptive.router.v1', availableTime: '25' as const, sourceState: 'ready' as const, priorActivityId: null, priorAttemptId: null, priorOutcome: null, assistance: 'none' as const, confidence: null },
    ...overrides,
  } as Infer<typeof commitAdaptiveActivityPlanValidator>
}

describe('Adaptive activity plan authority', () => {
  test('commits a standalone non-factual plan without inventing V2 authority', async () => {
    const { t, ids } = await fixture()
    const threadId = await t.run(ctx => ctx.db.insert('learningThreads', {
      userId: ownerId,
      originalNeed: 'Help me choose a learning direction.',
      intent: 'explore',
      availableTime: '15',
      authorityKind: 'standalone',
      sourceScope: { kind: 'none' },
      evidenceState: 'none',
      lifecycle: 'ready',
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    }))
    const committed = await t.withIdentity({ tokenIdentifier: ownerId }).mutation(internal.learnAdaptiveActivities.commitActivityPlan, planArgs(ids, {
      threadId,
      activityId: 'activity-standalone',
      activityClass: 'non_factual',
      intent: 'explore',
      objectiveId: null,
      primitiveSequence: [{ type: 'diagnostic_prompt', action: 'submit_response', props: { prompt: 'What do you want to learn?', responseFormat: 'short_text', assistance: 'none' } }],
      requiredAction: { kind: 'submit_response', label: 'Continue' },
      evaluationContract: { version: 'learn-adaptive.evaluation.v1', kind: 'learner_response', responseFormat: 'short_text', passingScorePercent: null },
      learningVoidId: null,
      blueprintRevisionId: null,
      sessionContentId: null,
      evidenceReferences: [],
      decisionInputs: { routerVersion: 'learn-adaptive.router.v1', availableTime: '15', sourceState: 'none', priorActivityId: null, priorAttemptId: null, priorOutcome: null, assistance: 'none', confidence: null },
    }))

    expect(await t.run(ctx => ctx.db.get(committed.activityDocumentId as Id<'learningThreadActivities'>))).toMatchObject({
      activityClass: 'non_factual',
      objectiveId: null,
      learningVoidId: null,
      blueprintRevisionId: null,
      sessionContentId: null,
      evidenceReferences: [],
      generationInputs: { sessionContentRevision: null, sessionContentInputDigest: null, generatorVersion: null },
    })
  })

  test('commits a complete immutable factual plan and replays only its stored snapshot', async () => {
    const { t, ids } = await fixture()
    const actor = t.withIdentity({ tokenIdentifier: ownerId })
    const committed = await actor.mutation(internal.learnAdaptiveActivities.commitActivityPlan, planArgs(ids))

    expect(committed).toMatchObject({ activityId: 'activity-001', boundaryOrdinal: 1, planRevision: 1, replayable: true })
    const row = await t.run(ctx => ctx.db.get(committed.activityDocumentId as Id<'learningThreadActivities'>))
    expect(row).toMatchObject({
      userId: ownerId,
      threadId: ids.threadId,
      activityId: 'activity-001',
      activityClass: 'factual',
      contractVersion: 'learn-adaptive.activity-contract.v1',
      rendererVersion: 'learn-adaptive.renderer.v1',
      planVersion: 'learn-adaptive.activity-plan.v1',
      replayVersion: 'learn-adaptive.activity-replay.v1',
      objectiveId: ids.objectiveId,
      sessionContentId: ids.sessionContentId,
      primitivePlan: [expect.objectContaining({ type: 'cited_explanation', action: 'continue' })],
      evidenceReferences: [expect.objectContaining({ claimId: ids.claimId, supportId: ids.supportId, sourceSnapshotId: ids.sourceSnapshotId, sourceSnapshotRevision: 3, sourceRecordRevision: 7, verifierVersion: 'learn-v2.entailment.v2', integrityState: 'accepted' })],
      generationInputs: { sessionContentRevision: 2, sessionContentInputDigest: `sha256:${'a'.repeat(64)}`, generatorVersion: 'learn-v2.session-content.v1' },
      decisionInputs: { intentRevision: 1, routerVersion: 'learn-adaptive.router.v1', sourceInputs: [{ sourceSnapshotId: String(ids.sourceSnapshotId), effectiveStatus: 'user_accepted', recordRevision: 7 }], priorAttemptId: null },
      inputDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    })
    expect(await actor.query(internal.learnAdaptiveActivities.replayActivityPlan, { activityId: 'activity-001' }))
      .toMatchObject({ ok: true, value: { activityId: 'activity-001', reasonCode: 'accepted_evidence_explanation' } })

    await t.run(ctx => ctx.db.patch(ids.sourceSnapshotId, { status: 'unavailable', effectiveStatus: 'unavailable', evidencePurgedAt: Date.now() }))
    expect(await actor.query(internal.learnAdaptiveActivities.replayActivityPlan, { activityId: 'activity-001' }))
      .toMatchObject({ ok: true, value: { activityId: 'activity-001' } })
  })

  test('creates a replacement at the next boundary without mutating its prior plan', async () => {
    const { t, ids } = await fixture()
    const actor = t.withIdentity({ tokenIdentifier: ownerId })
    const first = await actor.mutation(internal.learnAdaptiveActivities.commitActivityPlan, planArgs(ids))
    const before = await t.run(ctx => ctx.db.get(first.activityDocumentId as Id<'learningThreadActivities'>))
    const second = await actor.mutation(internal.learnAdaptiveActivities.commitActivityPlan, planArgs(ids, {
      activityId: 'activity-002',
      boundaryOrdinal: 2,
      planRevision: 2,
      replacesActivityId: 'activity-001',
      reasonCode: 'learner_requested_replacement',
    }))

    expect(second).toMatchObject({ activityId: 'activity-002', boundaryOrdinal: 2, planRevision: 2 })
    expect(await t.run(ctx => ctx.db.get(first.activityDocumentId as Id<'learningThreadActivities'>))).toEqual(before)
    expect(await t.run(ctx => ctx.db.get(ids.threadId))).toMatchObject({ currentActivityId: second.activityDocumentId, revision: 3 })
  })

  test('rejects forged ownership, evidence, and revision boundaries before persistence', async () => {
    const { t, ids } = await fixture()
    await expect(t.mutation(internal.learnAdaptiveActivities.commitActivityPlan, planArgs(ids)))
      .rejects.toThrow('Unauthenticated')
    await expect(t.withIdentity({ tokenIdentifier: otherId }).mutation(internal.learnAdaptiveActivities.commitActivityPlan, planArgs(ids)))
      .rejects.toThrow('Thread not found')
    const actor = t.withIdentity({ tokenIdentifier: ownerId })
    await expect(actor.mutation(internal.learnAdaptiveActivities.commitActivityPlan, planArgs(ids, { evidenceReferences: [] })))
      .rejects.toThrow('Factual activity requires between 1 and 16 evidence references')
    await expect(actor.mutation(internal.learnAdaptiveActivities.commitActivityPlan, planArgs(ids, { boundaryOrdinal: 2 })))
      .rejects.toThrow('first boundary')
    expect(await t.run(ctx => ctx.db.query('learningThreadActivities').withIndex('by_userId', q => q.eq('userId', ownerId)).take(2))).toEqual([])
  })

  test('rejects a factual plan when its blueprint revision is no longer authoritative', async () => {
    const { t, ids } = await fixture()
    await t.run(async (ctx) => {
      const current = await ctx.db.get(ids.blueprintRevisionId)
      const successorId = await ctx.db.insert('learnBlueprintRevisions', {
        userId: ownerId,
        blueprintId: current!.blueprintId,
        learningVoidId: ids.learningVoidId,
        revision: 3,
        recordRevision: 1,
        status: 'accepted',
        createdAt: 2,
        updatedAt: 2,
      })
      await ctx.db.patch(ids.learningVoidId, { activeBlueprintRevisionId: successorId })
    })

    await expect(t.withIdentity({ tokenIdentifier: ownerId }).mutation(internal.learnAdaptiveActivities.commitActivityPlan, planArgs(ids)))
      .rejects.toThrow('Active Blueprint pointer is stale')
  })

  test('detects persisted-plan tampering without mutating the altered revision', async () => {
    const { t, ids } = await fixture()
    const actor = t.withIdentity({ tokenIdentifier: ownerId })
    const committed = await actor.mutation(internal.learnAdaptiveActivities.commitActivityPlan, planArgs(ids))
    await t.run(ctx => ctx.db.patch(committed.activityDocumentId as Id<'learningThreadActivities'>, { purpose: 'Tampered purpose' }))

    expect(await actor.query(internal.learnAdaptiveActivities.replayActivityPlan, { activityId: 'activity-001' }))
      .toEqual({ ok: false, reason: 'replay_integrity_failed' })
    expect(await t.run(ctx => ctx.db.get(committed.activityDocumentId as Id<'learningThreadActivities'>)))
      .toMatchObject({ purpose: 'Tampered purpose', inputDigest: committed.inputDigest })
  })
})
