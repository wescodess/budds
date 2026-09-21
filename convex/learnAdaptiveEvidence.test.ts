/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const ownerId = 'https://auth.example.com|adaptive-evidence-owner'
const otherId = 'https://auth.example.com|adaptive-evidence-other'

async function fixture() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = 1_800_000_000_000
    const folderId = await ctx.db.insert('folders', { userId: ownerId, name: 'Evidence sources', documentCount: 0 })
    const learningVoidId = await ctx.db.insert('learningVoids', { userId: ownerId, folderId, title: 'Photosynthesis', status: 'active', revision: 4, createdAt: now, updatedAt: now })
    const blueprintId = await ctx.db.insert('learnBlueprints', { userId: ownerId, learningVoidId, revision: 1, createdAt: now })
    const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { userId: ownerId, blueprintId, learningVoidId, revision: 2, recordRevision: 5, status: 'accepted', createdAt: now, updatedAt: now })
    await ctx.db.patch(learningVoidId, { activeBlueprintRevisionId: blueprintRevisionId })
    const objectiveId = await ctx.db.insert('learnObjectives', { userId: ownerId, blueprintRevisionId, order: 0, title: 'Explain photosynthesis' })
    const studyPlanId = await ctx.db.insert('studyPlans', { userId: ownerId, learningVoidId, revision: 1, createdAt: now })
    const studyPlanRevisionId = await ctx.db.insert('studyPlanRevisions', { userId: ownerId, studyPlanId, learningVoidId, revision: 1, status: 'active', blueprintRevisionId, blueprintRecordRevision: 5, createdAt: now })
    const studySessionId = await ctx.db.insert('studySessions', { userId: ownerId, studyPlanRevisionId, primaryObjectiveId: objectiveId, status: 'ready', revision: 1, scheduledStartAt: now })
    const sessionContentId = await ctx.db.insert('sessionContent', { userId: ownerId, studySessionId, studyPlanRevisionId, blueprintRevisionId, objectiveId, revision: 2, status: 'published', inputDigest: `sha256:${'a'.repeat(64)}`, generatorVersion: 'learn-v2.session-content.v1', createdAt: now, publishedAt: now })
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { userId: ownerId, learningVoidId, origin: 'user_url', externalKey: 'source-1', privateLocator: 'https://private.example/source' })
    const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', { userId: ownerId, sourceIdentityId, learningVoidId, blueprintRevisionId, revision: 3, recordRevision: 7, status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear', privateLocator: 'r2://private-snapshot', createdAt: now })
    const sourceExcerptId = await ctx.db.insert('learnSourceExcerpts', { userId: ownerId, sourceSnapshotId, locator: 'page:1', privateLocator: 'r2://private-excerpt', excerpt: 'Protected source passage.', rightsStatus: 'permitted' })
    const claimId = await ctx.db.insert('sessionContentClaims', { userId: ownerId, sessionContentId, order: 0, claim: 'Plants convert light energy.', verifierVersion: 'learn-v2.entailment.v2', confidence: 0.95 })
    const supportId = await ctx.db.insert('learnClaimSupports', { userId: ownerId, sessionContentClaimId: claimId, sourceExcerptId, sourceSnapshotId, entailment: 'entailed', verifierVersion: 'learn-v2.entailment.v2', confidence: 0.95, conflictStatus: 'clear', evidenceStatus: 'evidence_available' })
    const threadId = await ctx.db.insert('learningThreads', { userId: ownerId, originalNeed: 'Understand photosynthesis.', intent: 'understand', availableTime: '25', authorityKind: 'v2_mission', learningVoidId, sourceScope: { kind: 'folder', sourceId: String(folderId) }, evidenceState: 'ready', lifecycle: 'active', revision: 2, createdAt: now, updatedAt: now })
    const activityId = await ctx.db.insert('learningThreadActivities', {
      userId: ownerId,
      threadId,
      activityId: 'activity-evidence-1',
      boundaryOrdinal: 1,
      planRevision: 1,
      activityClass: 'factual',
      status: 'started',
      planVersion: 'learn-adaptive.activity-plan.v1',
      replayVersion: 'learn-adaptive.activity-replay.v1',
      contractVersion: 'learn-adaptive.activity-contract.v1',
      rendererVersion: 'learn-adaptive.renderer.v1',
      validationVersion: 'learn-adaptive.primitive-validation.v1',
      sequenceValidationVersion: 'learn-adaptive.primitive-sequence-validation.v1',
      fallbackVersion: 'learn-adaptive.text-card-fallback.v1',
      intent: 'understand',
      objectiveId,
      purpose: 'Explain accepted evidence.',
      reasonCode: 'accepted_evidence_explanation',
      primitivePlan: [{ contractVersion: 'learn-adaptive.activity-contract.v1', rendererVersion: 'learn-adaptive.renderer.v1', type: 'cited_explanation', action: 'continue', props: { heading: 'Photosynthesis', explanation: 'Plants convert light energy.', sourceRefs: [String(sourceSnapshotId)] }, testId: 'learn-primitive-cited-explanation' }],
      requiredAction: { kind: 'continue', label: 'Continue' },
      evaluationContract: { version: 'learn-adaptive.evaluation.v1', kind: 'acknowledgement', responseFormat: 'none', passingScorePercent: null },
      fallback: { version: 'learn-adaptive.text-card-fallback.v1', kind: 'text_card', title: 'Photosynthesis', body: 'Plants convert light energy.', primaryAction: { type: 'continue_safe', label: 'Continue' }, testId: 'learn-activity-fallback' },
      accessibilityMetadata: { heading: 'Photosynthesis', instructions: 'Read and continue.', focusTargetTestId: 'learn-primitive-cited-explanation', liveRegionMode: 'polite' },
      learningVoidId,
      blueprintRevisionId,
      sessionContentId,
      evidenceReferences: [{ claimId, supportId, sourceSnapshotId, sourceSnapshotRevision: 3, sourceRecordRevision: 7, sourceEffectiveStatus: 'user_accepted', verifierVersion: 'learn-v2.entailment.v2', integrityState: 'accepted' }],
      generationInputs: { sessionContentRevision: 2, sessionContentInputDigest: `sha256:${'a'.repeat(64)}`, generatorVersion: 'learn-v2.session-content.v1' },
      decisionInputs: { intentRevision: 1, routerVersion: 'learn-adaptive.router.v1', availableTime: '25', sourceState: 'ready', sourceInputs: [{ sourceSnapshotId: String(sourceSnapshotId), effectiveStatus: 'user_accepted', recordRevision: 7 }], priorActivityId: null, priorAttemptId: null, priorOutcome: null, assistance: 'none', confidence: null },
      replacesActivityId: null,
      canonicalInputSnapshot: '{}',
      inputDigest: `sha256:${'b'.repeat(64)}`,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.patch(threadId, { currentActivityId: activityId })
    return { threadId, activityId, objectiveId, blueprintRevisionId, sessionContentId, sourceIdentityId, sourceSnapshotId, sourceExcerptId, claimId, supportId }
  })
  return { t, ids }
}

async function project(t: Awaited<ReturnType<typeof fixture>>['t']) {
  return await t.withIdentity({ tokenIdentifier: ownerId }).query(
    internal.learnAdaptiveEvidence.getActivityEvidence,
    { activityId: 'activity-evidence-1' },
  )
}

describe('Adaptive activity evidence projection', () => {
  test('returns an authenticated accepted projection with conservative claim status and permitted source data', async () => {
    const { t } = await fixture()

    await expect(t.query(internal.learnAdaptiveEvidence.getActivityEvidence, { activityId: 'activity-evidence-1' }))
      .rejects.toThrow('Unauthenticated')
    expect(await t.withIdentity({ tokenIdentifier: otherId }).query(internal.learnAdaptiveEvidence.getActivityEvidence, { activityId: 'activity-evidence-1' }))
      .toBeNull()

    const result = await project(t)
    expect(result).toEqual({
      kind: 'factual',
      activityId: 'activity-evidence-1',
      eligibility: 'eligible',
      readOnly: false,
      integrityState: 'accepted',
      claims: [{
        claimId: expect.any(String),
        claimText: 'Plants convert light energy.',
        claimStatus: 'unknown',
        integrityState: 'accepted',
        source: { origin: 'user_url', locator: 'page:1', sourceSnapshotId: expect.any(String), sourceSnapshotRevision: 3, sourceRecordRevision: 7 },
      }],
    })
    expect(JSON.stringify(result)).not.toContain('private')
    expect(JSON.stringify(result)).not.toContain('Protected source passage')
  })

  test.each([
    'insufficient',
    'conflicting',
    'stale',
    'deleted',
    'unavailable',
  ] as const)('blocks current factual eligibility when evidence is %s', async (integrityState) => {
    const { t, ids } = await fixture()
    await t.run(async (ctx) => {
      if (integrityState === 'insufficient') await ctx.db.patch(ids.supportId, { entailment: 'not_evaluated' })
      else if (integrityState === 'conflicting') await ctx.db.patch(ids.supportId, { conflictStatus: 'unresolved' })
      else if (integrityState === 'stale') await ctx.db.patch(ids.sourceSnapshotId, { recordRevision: 8 })
      else if (integrityState === 'deleted') await ctx.db.patch(ids.sourceExcerptId, { locator: 'source-unavailable', privateLocator: undefined, excerpt: undefined, evidencePurgedAt: 123 })
      else await ctx.db.patch(ids.supportId, { evidenceStatus: 'evidence_unavailable' })
    })

    expect(await project(t)).toMatchObject({
      eligibility: 'blocked',
      readOnly: false,
      integrityState,
      claims: [{ claimStatus: 'unknown', integrityState }],
    })
  })

  test('keeps historical attempt and activity rows unchanged after source purge', async () => {
    const { t, ids } = await fixture()
    const before = await t.run(async (ctx) => {
      const attemptId = await ctx.db.insert('masteryAttempts', { userId: ownerId, blueprintRevisionId: ids.blueprintRevisionId, objectiveId: ids.objectiveId, sessionContentId: ids.sessionContentId, attemptedAt: 100, idempotencyKey: 'historical-attempt', serverScorePercent: 90, result: 'pass' })
      await ctx.db.patch(ids.activityId, { status: 'replaced' })
      await ctx.db.patch(ids.threadId, { currentActivityId: undefined })
      await ctx.db.patch(ids.sourceIdentityId, { privateLocator: undefined, tombstonedAt: 123 })
      await ctx.db.patch(ids.sourceSnapshotId, { effectiveStatus: 'unavailable', privateLocator: undefined, evidencePurgedAt: 123 })
      await ctx.db.patch(ids.sourceExcerptId, { locator: 'source-unavailable', privateLocator: undefined, excerpt: undefined, evidencePurgedAt: 123 })
      await ctx.db.patch(ids.supportId, { evidenceStatus: 'evidence_unavailable' })
      return { attemptId, attempt: await ctx.db.get(attemptId), activity: await ctx.db.get(ids.activityId) }
    })

    expect(await project(t)).toMatchObject({
      eligibility: 'historical',
      readOnly: true,
      integrityState: 'unavailable',
      claims: [{ claimStatus: 'unknown', integrityState: 'unavailable', source: { locator: null } }],
    })
    expect(await t.run(ctx => ctx.db.get(before.attemptId))).toEqual(before.attempt)
    expect(await t.run(ctx => ctx.db.get(ids.activityId))).toEqual(before.activity)
  })
})
