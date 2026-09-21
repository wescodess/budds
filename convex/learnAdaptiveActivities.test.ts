/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import type { Infer } from 'convex/values'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import type { commitAdaptiveActivityPlanValidator } from '../shared/adaptive-learn-storage-manifest'

const modules = import.meta.glob('./**/*.ts')
const ownerId = 'https://auth.example.com|adaptive-plan-owner'
const otherId = 'https://auth.example.com|adaptive-plan-other'
const originalLearnV2Flag = process.env.LEARN_V2_ENABLED

beforeAll(() => { process.env.LEARN_V2_ENABLED = 'true' })
afterAll(() => { if (originalLearnV2Flag === undefined) delete process.env.LEARN_V2_ENABLED; else process.env.LEARN_V2_ENABLED = originalLearnV2Flag })

async function fixture() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = 1_800_000_000_000
    for (const tokenIdentifier of [ownerId, otherId]) await ctx.db.insert('users', {
      tokenIdentifier, name: tokenIdentifier, learnV2Entitlement: { enabled: true, updatedAt: now },
      learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: now },
    })
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
    expectedRevision: 1,
    idempotencyKey: 'activity-plan-key-0001',
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
  test('rejects a first activity while the initial clarification is pending', async () => {
    const { t, ids } = await fixture()
    await t.run(ctx => ctx.db.patch(ids.threadId, {
      initialDecision: {
        decisionVersion: 'learn-adaptive.initial-decision.v1',
        templateVersion: 'learn-adaptive.clarification-templates.v1',
        inputDigest: `sha256:${'b'.repeat(64)}`,
        inputSnapshot: { intent: 'understand', availableTime: '25', authorityKind: 'v2_mission', sourceKind: 'folder', evidenceState: 'ready', outcomeProvenance: 'need_fallback', threadRevision: 1 },
        status: 'pending',
        reasonCode: 'outcome_needed_for_first_move',
        continuationKind: 'ready_v2',
        questionKey: 'useful_outcome',
        preparedAt: 1,
      },
    }))
    await expect(t.withIdentity({ tokenIdentifier: ownerId }).mutation(internal.learnAdaptiveActivities.commitActivityPlan, planArgs(ids))).rejects.toThrow(/initial clarification/i)
    expect(await t.run(ctx => ctx.db.query('learningThreadActivities').withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', ownerId).eq('threadId', ids.threadId)).take(1))).toEqual([])
  })

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
    expect(committed.kind).toBe('ok')
    if (committed.kind !== 'ok') throw new Error('Expected committed activity')
    expect(await t.run(ctx => ctx.db.get(committed.value.activityDocumentId as Id<'learningThreadActivities'>))).toMatchObject({
      activityClass: 'non_factual',
      objectiveId: null,
      learningVoidId: null,
      blueprintRevisionId: null,
      sessionContentId: null,
      evidenceReferences: [],
      generationInputs: { sessionContentRevision: null, sessionContentInputDigest: null, generatorVersion: null },
    })
    expect(await t.run(ctx => ctx.db.query('learnActivityEvents').withIndex('by_userId_and_threadId_and_occurredAt', q => q.eq('userId', ownerId).eq('threadId', threadId)).collect()))
      .toEqual([expect.objectContaining({ eventType: 'activity_eligible' })])
  })

  test('commits a complete immutable factual plan and replays only its stored snapshot', async () => {
    const { t, ids } = await fixture()
    const actor = t.withIdentity({ tokenIdentifier: ownerId })
    const args = planArgs(ids)
    const committed = await actor.mutation(internal.learnAdaptiveActivities.commitActivityPlan, args)
    expect(await actor.mutation(internal.learnAdaptiveActivities.commitActivityPlan, args)).toEqual(committed)
    expect(await t.run(ctx => ctx.db.query('learningThreadActivities').withIndex('by_userId', q => q.eq('userId', ownerId)).take(2))).toHaveLength(1)
    expect(await t.run(ctx => ctx.db.query('learnActivityEvents').withIndex('by_userId_and_threadId_and_occurredAt', q => q.eq('userId', ownerId).eq('threadId', ids.threadId)).take(4))).toEqual([
      expect.objectContaining({ eventType: 'activity_eligible', eventVersion: 'activity_eligible.v1', metadata: expect.objectContaining({ activityClass: 'factual', boundaryOrdinal: 1 }) }),
    ])
    expect(committed).toMatchObject({ kind: 'ok', value: { activityId: 'activity-001', boundaryOrdinal: 1, planRevision: 1, replayable: true }, revision: 2 })
    if (committed.kind !== 'ok') throw new Error('Expected committed activity')
    const row = await t.run(ctx => ctx.db.get(committed.value.activityDocumentId as Id<'learningThreadActivities'>))
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

    const beforeInvalidation = await t.run(ctx => ctx.db.get(committed.value.activityDocumentId as Id<'learningThreadActivities'>))
    await t.run(ctx => ctx.db.patch(ids.sourceSnapshotId, { status: 'unavailable', effectiveStatus: 'unavailable', evidencePurgedAt: Date.now() }))
    const invalidatedReplay = await actor.query(internal.learnAdaptiveActivities.replayActivityPlan, { activityId: 'activity-001' })
    expect(invalidatedReplay).toEqual({ ok: false, reason: 'evidence_invalidated' })
    expect(JSON.stringify(invalidatedReplay)).not.toContain('Activity unavailable')
    expect(await t.run(ctx => ctx.db.get(committed.value.activityDocumentId as Id<'learningThreadActivities'>))).toEqual(beforeInvalidation)
  })

  test('suppresses replay when accepted support becomes unavailable', async () => {
    const { t, ids } = await fixture()
    const actor = t.withIdentity({ tokenIdentifier: ownerId })
    const committed = await actor.mutation(internal.learnAdaptiveActivities.commitActivityPlan, planArgs(ids))
    if (committed.kind !== 'ok') throw new Error('Expected committed activity')
    const before = await t.run(ctx => ctx.db.get(committed.value.activityDocumentId as Id<'learningThreadActivities'>))
    await t.run(ctx => ctx.db.patch(ids.supportId, { evidenceStatus: 'evidence_unavailable' }))

    const replay = await actor.query(internal.learnAdaptiveActivities.replayActivityPlan, { activityId: 'activity-001' })

    expect(replay).toEqual({ ok: false, reason: 'evidence_unavailable' })
    expect(JSON.stringify(replay)).not.toContain('Activity unavailable')
    expect(await t.run(ctx => ctx.db.get(committed.value.activityDocumentId as Id<'learningThreadActivities'>))).toEqual(before)
  })

  test('creates a replacement at the next boundary without mutating its prior plan', async () => {
    const { t, ids } = await fixture()
    const actor = t.withIdentity({ tokenIdentifier: ownerId })
    const first = await actor.mutation(internal.learnAdaptiveActivities.commitActivityPlan, planArgs(ids))
    if (first.kind !== 'ok') throw new Error('Expected first activity')
    const before = await t.run(ctx => ctx.db.get(first.value.activityDocumentId as Id<'learningThreadActivities'>))
    const second = await actor.mutation(internal.learnAdaptiveActivities.commitActivityPlan, planArgs(ids, {
      activityId: 'activity-002',
      expectedRevision: 2,
      idempotencyKey: 'activity-plan-key-0002',
      boundaryOrdinal: 2,
      planRevision: 2,
      replacesActivityId: 'activity-001',
      reasonCode: 'learner_requested_replacement',
    }))

    expect(second).toMatchObject({ kind: 'ok', value: { activityId: 'activity-002', boundaryOrdinal: 2, planRevision: 2 }, revision: 3 })
    if (second.kind !== 'ok') throw new Error('Expected replacement activity')
    expect(await t.run(ctx => ctx.db.get(first.value.activityDocumentId as Id<'learningThreadActivities'>))).toEqual(before)
    expect(await t.run(ctx => ctx.db.get(ids.threadId))).toMatchObject({ currentActivityId: second.value.activityDocumentId, revision: 3 })

    await t.run(ctx => ctx.db.patch(ids.sourceSnapshotId, { status: 'unavailable', effectiveStatus: 'unavailable', evidencePurgedAt: Date.now() }))
    const historicalReplay = await actor.query(internal.learnAdaptiveActivities.replayActivityPlan, { activityId: 'activity-001' })
    expect(historicalReplay).toEqual({ ok: false, reason: 'evidence_unavailable' })
    expect(JSON.stringify(historicalReplay)).not.toContain(before!.fallback.body)
    expect(await t.run(ctx => ctx.db.get(first.value.activityDocumentId as Id<'learningThreadActivities'>))).toEqual(before)
  })

  test('rejects forged ownership, evidence, and revision boundaries before persistence', async () => {
    const { t, ids } = await fixture()
    await expect(t.mutation(internal.learnAdaptiveActivities.commitActivityPlan, planArgs(ids)))
      .rejects.toThrow('Adaptive Learn access denied')
    await expect(t.withIdentity({ tokenIdentifier: otherId }).mutation(internal.learnAdaptiveActivities.commitActivityPlan, planArgs(ids)))
      .rejects.toThrow('Thread not found')
    const actor = t.withIdentity({ tokenIdentifier: ownerId })
    await expect(actor.mutation(internal.learnAdaptiveActivities.commitActivityPlan, planArgs(ids, { evidenceReferences: [] })))
      .rejects.toThrow('Factual activity requires between 1 and 16 evidence references')
    await expect(actor.mutation(internal.learnAdaptiveActivities.commitActivityPlan, planArgs(ids, { boundaryOrdinal: 2 })))
      .resolves.toMatchObject({ kind: 'conflict', code: 'activity_boundary_changed', actualRevision: 1 })
    expect(await t.run(ctx => ctx.db.query('learningThreadActivities').withIndex('by_userId', q => q.eq('userId', ownerId)).take(2))).toEqual([])
  })

  test('persists and replays a stale-revision result before activity boundary validation', async () => {
    const { t, ids } = await fixture()
    const actor = t.withIdentity({ tokenIdentifier: ownerId })
    const args = planArgs(ids, { expectedRevision: 2, boundaryOrdinal: 99, idempotencyKey: 'stale-plan-key-0001' })
    const first = await actor.mutation(internal.learnAdaptiveActivities.commitActivityPlan, args)
    expect(first).toEqual({ kind: 'conflict', code: 'stale_revision', expectedRevision: 2, actualRevision: 1, authority: 'convex' })
    expect(await actor.mutation(internal.learnAdaptiveActivities.commitActivityPlan, args)).toEqual(first)
    expect(await t.run(ctx => ctx.db.query('learningThreadActivities').withIndex('by_userId', q => q.eq('userId', ownerId)).take(1))).toEqual([])
    expect(await t.run(ctx => ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId', q => q.eq('userId', ownerId)).take(2))).toHaveLength(1)
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
    if (committed.kind !== 'ok') throw new Error('Expected committed activity')
    await t.run(ctx => ctx.db.patch(committed.value.activityDocumentId as Id<'learningThreadActivities'>, { purpose: 'Tampered purpose' }))

    expect(await actor.query(internal.learnAdaptiveActivities.replayActivityPlan, { activityId: 'activity-001' }))
      .toEqual({ ok: false, reason: 'replay_integrity_failed' })
    expect(await t.run(ctx => ctx.db.get(committed.value.activityDocumentId as Id<'learningThreadActivities'>)))
      .toMatchObject({ purpose: 'Tampered purpose', inputDigest: committed.value.inputDigest })
  })
})
