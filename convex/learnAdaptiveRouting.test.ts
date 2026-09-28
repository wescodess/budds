/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { writeLearnActivityEvent } from './lib/learnAdaptiveEvents'
import { masteryScopeKey } from './lib/learnV2MasteryScope'
import type { AdaptiveOverrideOption } from '../shared/learn-adaptive-controls'

const modules = import.meta.glob('./**/*.ts')
const ownerId = 'https://auth.example.com|routing-owner'
const priorFlag = process.env.LEARN_V2_ENABLED

async function legacyRepresentativeHash(threadId: string, attemptId: string) {
  const canonical = JSON.stringify(['learn-adaptive.activity-events.v1', ownerId, threadId,
    'representative_pass.v1', `attempt:${attemptId}:representative`])
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)))
  return `sha256:${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

beforeAll(() => { process.env.LEARN_V2_ENABLED = 'true' })
afterAll(() => { if (priorFlag === undefined) delete process.env.LEARN_V2_ENABLED; else process.env.LEARN_V2_ENABLED = priorFlag })

async function standaloneFixture() {
  const t = convexTest(schema, modules)
  const threadId = await t.run(async ctx => {
    await ctx.db.insert('users', { tokenIdentifier: ownerId, name: 'Routing owner',
      learnV2Entitlement: { enabled: true, updatedAt: 1 }, learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: 1 } })
    return await ctx.db.insert('learningThreads', { userId: ownerId, originalNeed: 'Find a useful next step.',
      intent: 'explore', availableTime: '25', authorityKind: 'standalone', sourceScope: { kind: 'none' },
      evidenceState: 'none', lifecycle: 'ready', revision: 1, createdAt: 1, updatedAt: 1 })
  })
  return { t, threadId, owner: t.withIdentity({ tokenIdentifier: ownerId }) }
}

async function factualFixture(twoSources = false) {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity({ tokenIdentifier: ownerId })
  const ids = await t.run(async ctx => {
    const now = Date.now()
    await ctx.db.insert('users', { tokenIdentifier: ownerId, name: 'Routing owner',
      learnV2Entitlement: { enabled: true, updatedAt: now }, learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: now } })
    const folderId = await ctx.db.insert('folders', { userId: ownerId, name: 'Routing sources', documentCount: 0 })
    const learningVoidId = await ctx.db.insert('learningVoids', { userId: ownerId, folderId, title: 'Gravity', status: 'active', revision: 1, createdAt: now, updatedAt: now })
    const blueprintId = await ctx.db.insert('learnBlueprints', { userId: ownerId, learningVoidId, revision: 1, createdAt: now })
    const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { userId: ownerId, blueprintId, learningVoidId, revision: 1,
      recordRevision: 3, status: 'accepted', createdAt: now, updatedAt: now })
    await ctx.db.patch(learningVoidId, { activeBlueprintRevisionId: blueprintRevisionId })
    const objectiveId = await ctx.db.insert('learnObjectives', { userId: ownerId, blueprintRevisionId, order: 0, title: 'Explain gravity',
      assessmentContract: { version: 'learn-v2.assessment.v1', kind: 'machine_checkable', responseFormat: 'short_text',
        instructions: 'Explain from evidence.', passingScorePercent: 80, criteria: [{ key: 'accuracy', description: 'Accurate.', weightPercent: 100 }] } })
    const studyPlanId = await ctx.db.insert('studyPlans', { userId: ownerId, learningVoidId, revision: 1, createdAt: now })
    const studyPlanRevisionId = await ctx.db.insert('studyPlanRevisions', { userId: ownerId, studyPlanId, learningVoidId, revision: 1,
      recordRevision: 5, status: 'accepted', blueprintRevisionId, blueprintRecordRevision: 3, createdAt: now })
    await ctx.db.patch(studyPlanId, { activeRevisionId: studyPlanRevisionId })
    const studySessionId = await ctx.db.insert('studySessions', { userId: ownerId, studyPlanRevisionId, primaryObjectiveId: objectiveId,
      status: 'ready', revision: 2, scheduledStartAt: now - 1_000, timezone: 'UTC' })
    const sessionContentId = await ctx.db.insert('sessionContent', { userId: ownerId, studySessionId, studyPlanRevisionId,
      blueprintRevisionId, objectiveId, revision: 1, status: 'published', inputDigest: `sha256:${'a'.repeat(64)}`,
      generatorVersion: 'learn-v2.session-content.v1', createdAt: now, publishedAt: now })
    await ctx.db.insert('sessionContentBlocks', { userId: ownerId, sessionContentId, order: 0, kind: 'explanation',
      content: 'Gravity attracts masses.', claimOrdersJson: twoSources ? '[0,1]' : '[0]' })
    await ctx.db.insert('sessionContentBlocks', { userId: ownerId, sessionContentId, order: 1, kind: 'independent_application',
      content: 'Explain why an apple falls.', claimOrdersJson: twoSources ? '[0,1]' : '[0]' })
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { userId: ownerId, learningVoidId,
      origin: 'user_url', externalKey: 'gravity-source' })
    const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', { userId: ownerId, sourceIdentityId, learningVoidId,
      blueprintRevisionId, revision: 1, recordRevision: 7, status: 'user_accepted', effectiveStatus: 'user_accepted',
      rightsStatus: 'permitted', conflictStatus: 'clear', createdAt: now })
    await ctx.db.insert('learnObjectiveSources', { userId: ownerId, objectiveId, sourceSnapshotId, coverage: 'strong' })
    const sourceExcerptId = await ctx.db.insert('learnSourceExcerpts', { userId: ownerId, sourceSnapshotId,
      locator: 'private-page-1', excerpt: 'PRIVATE SOURCE TEXT', rightsStatus: 'permitted' })
    const claimId = await ctx.db.insert('sessionContentClaims', { userId: ownerId, sessionContentId, order: 0,
      claim: 'Gravity attracts masses.', verifierVersion: 'learn-v2.entailment.v2', confidence: 0.95 })
    await ctx.db.insert('learnClaimSupports', { userId: ownerId, sessionContentClaimId: claimId, sourceExcerptId,
      sourceSnapshotId, entailment: 'entailed', verifierVersion: 'learn-v2.entailment.v2', confidence: 0.95,
      conflictStatus: 'clear', evidenceStatus: 'evidence_available' })
    if (twoSources) {
      const secondIdentityId = await ctx.db.insert('learnSourceIdentities', { userId: ownerId, learningVoidId,
        origin: 'user_url', externalKey: 'gravity-source-two' })
      const secondSnapshotId = await ctx.db.insert('learnSourceSnapshots', { userId: ownerId,
        sourceIdentityId: secondIdentityId, learningVoidId, blueprintRevisionId, revision: 1, recordRevision: 2,
        status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear', createdAt: now })
      await ctx.db.insert('learnObjectiveSources', { userId: ownerId, objectiveId, sourceSnapshotId: secondSnapshotId, coverage: 'strong' })
      const secondExcerptId = await ctx.db.insert('learnSourceExcerpts', { userId: ownerId,
        sourceSnapshotId: secondSnapshotId, locator: 'private-page-2', excerpt: 'PRIVATE SOURCE TWO', rightsStatus: 'permitted' })
      const secondClaimId = await ctx.db.insert('sessionContentClaims', { userId: ownerId, sessionContentId, order: 1,
        claim: 'Objects attract one another.', verifierVersion: 'learn-v2.entailment.v2', confidence: 0.95 })
      await ctx.db.insert('learnClaimSupports', { userId: ownerId, sessionContentClaimId: secondClaimId,
        sourceExcerptId: secondExcerptId, sourceSnapshotId: secondSnapshotId, entailment: 'entailed',
        verifierVersion: 'learn-v2.entailment.v2', confidence: 0.95, conflictStatus: 'clear', evidenceStatus: 'evidence_available' })
    }
    return { folderId, learningVoidId, blueprintRevisionId, objectiveId, studySessionId, studyPlanRevisionId, sessionContentId, sourceSnapshotId }
  })
  const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, {
    studySessionId: ids.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'routing-factual-attach-0001',
  })
  return { t, owner, ids, attached }
}

async function completedFactualFixture(input: { kind: 'independent_application' | 'retained_transfer', scorePercent: number,
  stateBefore: 'unseen' | 'independent' | 'retained', stateAfter: 'independent' | 'retained' | 'needs_review',
  reason: 'unassisted_pass_independent' | 'eligible_delayed_pass_retained' | 'eligible_delayed_failure_needs_review' | 'assisted_mastery_preserved',
  assistance?: 'hint' | 'reveal', selectedOverride?: AdaptiveOverrideOption, twoSources?: boolean }) {
  const fixture = await factualFixture(input.twoSources)
  const { t, ids, attached } = fixture
  if (input.selectedOverride) {
    const selected = await fixture.owner.mutation(api.learnAdaptive.applyOverride, {
      threadId: attached.threadId, activityId: attached.activityId, option: input.selectedOverride,
      expectedRevision: 2, idempotencyKey: `routing-factual-override-${input.selectedOverride}-0001`,
    })
    if (selected.kind !== 'ok') throw new Error('Expected override selection')
  }
  await t.run(async ctx => {
    const now = Date.now()
    const thread = await ctx.db.get(attached.threadId)
    if (!thread?.currentActivityId) throw new Error('Attached activity unavailable')
    const activity = await ctx.db.get(thread.currentActivityId)
    if (!activity) throw new Error('Attached activity unavailable')
    await ctx.db.patch(ids.studySessionId, { status: 'completed', revision: 4,
      startedSessionContentId: ids.sessionContentId, startedSessionContentRevision: 1 })
    const attemptId = await ctx.db.insert('masteryAttempts', { userId: ownerId,
      blueprintRevisionId: ids.blueprintRevisionId, objectiveId: ids.objectiveId,
      studySessionId: ids.studySessionId, studyPlanRevisionId: ids.studyPlanRevisionId,
      sessionContentId: ids.sessionContentId, contentRevision: 1, attemptedAt: now,
      idempotencyKey: 'server-owned-attempt-0001', kind: input.kind,
      serverScorePercent: input.scorePercent, usedHint: input.assistance === 'hint', usedReveal: input.assistance === 'reveal',
      confidence: 4, scorerVersion: 'learn-v2.scorer.v1', masteryStateBefore: input.stateBefore,
      masteryStateAfter: input.stateAfter, masteryTransitionReason: input.reason,
      masteryTransitionVersion: 'learn-v2.mastery-transition.v1' })
    const scoringJobId = await ctx.db.insert('learnJobs', { userId: ownerId,
      learningVoidId: ids.learningVoidId, blueprintRevisionId: ids.blueprintRevisionId,
      studyPlanRevisionId: ids.studyPlanRevisionId, studySessionId: ids.studySessionId,
      adaptiveThreadId: attached.threadId, adaptiveActivityId: activity._id,
      type: 'mastery_scoring', status: 'succeeded', revision: 1,
      idempotencyKey: 'server-owned-score-0001', checkpoint: `attempt:${String(attemptId)}` })
    await ctx.db.insert('masteryRecords', { userId: ownerId, blueprintRevisionId: ids.blueprintRevisionId,
      objectiveId: ids.objectiveId, scopeKey: await masteryScopeKey(ownerId, ids.blueprintRevisionId, ids.objectiveId),
      state: input.stateAfter, lastAttemptId: attemptId })
    await ctx.db.patch(activity._id, { status: 'feedback', masteryAttemptId: attemptId, scoringJobId })
    const passed = input.scorePercent >= 80
    await writeLearnActivityEvent(ctx, { userId: ownerId, threadId: attached.threadId, activityId: activity._id,
      eventType: passed ? 'representative_pass' : 'representative_fail',
      eventVersion: passed ? 'representative_pass.v1' : 'representative_fail.v1',
      sourceVersion: 'learn-v2.scorer.v1', contractVersion: activity.contractVersion,
      semanticKey: `attempt:${String(attemptId)}:representative`, occurredAt: now,
      outcomeCode: passed ? 'pass' : 'fail', metadata: { activityClass: 'factual',
        boundaryOrdinal: activity.boundaryOrdinal, planRevision: activity.planRevision } })
  })
  return fixture
}

describe('server-authorized adaptive routing decisions', () => {
  test('explicit promotion pins a verified representative pass without another mastery transition', async () => {
    const { t, owner, ids, attached } = await completedFactualFixture({ kind: 'independent_application', scorePercent: 92,
      stateBefore: 'unseen', stateAfter: 'independent', reason: 'unassisted_pass_independent' })
    const activity = await t.run(async ctx => ctx.db.get((await ctx.db.get(attached.threadId))!.currentActivityId!))
    if (!activity) throw new Error('Expected activity')
    const proposed = await owner.mutation(api.learnAdaptive.requestPromotion, {
      threadId: attached.threadId, activityId: activity._id, kind: 'mastery',
      expectedRevision: 2, idempotencyKey: 'routing-promotion-master-0001',
    })
    expect(proposed).toMatchObject({ kind: 'ok', value: { kind: 'mastery', basis: 'representative_performance' }, revision: 3 })
    expect(await owner.query(api.learnAdaptive.listPromotionProposals, { threadId: attached.threadId })).toMatchObject([{
      kind: 'mastery', basis: 'representative_performance', activityId: activity._id,
      attemptId: activity.masteryAttemptId, objectiveId: ids.objectiveId,
      blueprintRevisionId: ids.blueprintRevisionId, sessionContentId: ids.sessionContentId,
    }])
    expect((await t.run(ctx => ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', ownerId)).take(2))).length).toBe(1)
    expect((await t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId', q => q.eq('userId', ownerId)).take(2))).length).toBe(1)
  })

  test('applies Compare sources only from two live accepted source pins', async () => {
    const { owner, attached } = await completedFactualFixture({ kind: 'retained_transfer', scorePercent: 92,
      stateBefore: 'independent', stateAfter: 'retained', reason: 'eligible_delayed_pass_retained',
      selectedOverride: 'compare_sources', twoSources: true })
    expect(await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId: attached.threadId, expectedRevision: 3, idempotencyKey: 'routing-two-sources-0001',
    })).toMatchObject({ kind: 'ok', value: { status: 'recommended',
      selectedActivity: { primitive: 'source_comparison', activityClass: 'factual' },
      reasonCode: 'learner_requested_compare_sources',
      overrideApplication: { option: 'compare_sources', outcome: 'applied' } } })
  })

  test('consumes a selected factual override into a blocked fallback when accepted evidence turns stale', async () => {
    const { t, owner, ids, attached } = await completedFactualFixture({ kind: 'retained_transfer', scorePercent: 92,
      stateBefore: 'independent', stateAfter: 'retained', reason: 'eligible_delayed_pass_retained', selectedOverride: 'example' })
    await t.run(ctx => ctx.db.patch(ids.sourceSnapshotId, { effectiveStatus: 'rejected', recordRevision: 8 }))
    const result = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId: attached.threadId, expectedRevision: 3, idempotencyKey: 'routing-stale-override-0001',
    })
    expect(result).toMatchObject({ kind: 'ok', value: { status: 'blocked', selectedActivity: null,
      reasonCode: 'evidence_stale', fallback: { kind: 'non_factual_activity' },
      overrideApplication: { option: 'example', outcome: 'fallback', applicationReason: 'router_blocked' } } })
    if (result.kind !== 'ok') throw new Error('Expected fallback decision')
    const selection = await t.run(ctx => ctx.db.query('learnActivityOverrides')
      .withIndex('by_userId_and_threadId_and_createdAt', q => q.eq('userId', ownerId).eq('threadId', attached.threadId)).first())
    expect(selection?.consumedDecisionId).toBe(result.value.decisionId)
    expect(await owner.query(api.learnAdaptiveRouting.replayDecision, { decisionId: result.value.decisionId as never }))
      .toMatchObject({ status: 'replayed', value: result.value })
    await t.run(ctx => ctx.db.patch(ids.sourceSnapshotId, { effectiveStatus: 'user_accepted', recordRevision: 7 }))
    const later = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId: attached.threadId, expectedRevision: 4, idempotencyKey: 'routing-stale-override-later-0001',
    })
    if (later.kind === 'ok') expect(later.value).not.toHaveProperty('overrideApplication')
    else expect(later).toMatchObject({ kind: 'blocked' })
  })

  test.each([
    ['time', 'time_45', { availableTime: '60' }],
    ['activity', 'example', { nextActivity: 'challenge_step' }],
    ['difficulty', 'example', { difficulty: 'harder' }],
    ['original time', 'example', { availableTime: '15' }],
  ] as const)('consumes a corrupt %s override plan as a safe fallback', async (caseName, option, alteration) => {
    const { t, owner, attached } = await completedFactualFixture({ kind: 'retained_transfer', scorePercent: 92,
      stateBefore: 'independent', stateAfter: 'retained', reason: 'eligible_delayed_pass_retained', selectedOverride: option })
    const before = await t.run(ctx => ctx.db.get(attached.threadId))
    await t.run(async ctx => {
      const selection = await ctx.db.query('learnActivityOverrides')
        .withIndex('by_userId_and_threadId_and_createdAt', q => q.eq('userId', ownerId).eq('threadId', attached.threadId)).first()
      if (!selection) throw new Error('Expected override')
      await ctx.db.patch(selection._id, { fixedNextPlan: { ...selection.fixedNextPlan, ...alteration } })
    })
    const result = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId: attached.threadId, expectedRevision: 3, idempotencyKey: `routing-corrupt-${caseName.replaceAll(' ', '-')}-0001`,
    })
    expect(result).toMatchObject({ kind: 'ok', value: { status: 'blocked', selectedActivity: null,
      reasonCode: 'override_plan_invalid', overrideApplication: { option, outcome: 'fallback', applicationReason: 'plan_invalid' } } })
    if (result.kind !== 'ok') throw new Error('Expected safe fallback')
    const after = await t.run(async ctx => ({ thread: await ctx.db.get(attached.threadId),
      selection: await ctx.db.query('learnActivityOverrides')
        .withIndex('by_userId_and_threadId_and_createdAt', q => q.eq('userId', ownerId).eq('threadId', attached.threadId)).first() }))
    expect(after.thread?.currentActivityId).toBe(before?.currentActivityId)
    expect(after.thread?.availableTime).toBe(before?.availableTime)
    expect(after.selection?.consumedDecisionId).toBe(result.value.decisionId)
    expect(await owner.query(api.learnAdaptiveRouting.replayDecision, { decisionId: result.value.decisionId as never }))
      .toMatchObject({ status: 'replayed', value: result.value })
  })

  test('consumes a selected override into the provider-failure fallback without replacing the response', async () => {
    const { t, owner, attached } = await factualFixture()
    expect(await owner.mutation(api.learnAdaptive.applyOverride, { threadId: attached.threadId,
      activityId: attached.activityId, option: 'example', expectedRevision: 2,
      idempotencyKey: 'routing-provider-override-0001' })).toMatchObject({ kind: 'ok' })
    await t.run(async ctx => {
      const thread = await ctx.db.get(attached.threadId)
      const activity = thread?.currentActivityId && await ctx.db.get(thread.currentActivityId)
      if (!activity) throw new Error('Expected factual activity')
      await ctx.db.patch(activity._id, { status: 'blocked' })
      await writeLearnActivityEvent(ctx, { userId: ownerId, threadId: attached.threadId, activityId: activity._id,
        eventType: 'provider_failure', eventVersion: 'provider_failure.v1', sourceVersion: 'provider.v1',
        contractVersion: activity.contractVersion, semanticKey: `provider:${String(activity._id)}:failure`,
        occurredAt: Date.now(), outcomeCode: 'failure', metadata: { activityClass: 'factual',
          boundaryOrdinal: activity.boundaryOrdinal, planRevision: activity.planRevision, providerStage: 'outcome' } })
    })
    expect(await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId: attached.threadId, expectedRevision: 3, idempotencyKey: 'routing-provider-fallback-0001',
    })).toMatchObject({ kind: 'ok', value: { status: 'blocked', reasonCode: 'evidence_blocked',
      fallback: { kind: 'non_factual_activity' },
      overrideApplication: { option: 'example', outcome: 'fallback', applicationReason: 'router_blocked' } } })
  })

  test('ignores a foreign override even when it names the current activity and boundary', async () => {
    const { t, owner, attached } = await completedFactualFixture({ kind: 'retained_transfer', scorePercent: 92,
      stateBefore: 'independent', stateAfter: 'retained', reason: 'eligible_delayed_pass_retained' })
    await t.run(async ctx => {
      const activity = await ctx.db.get((await ctx.db.get(attached.threadId))!.currentActivityId!)
      if (!activity) throw new Error('Expected activity')
      await ctx.db.insert('learnActivityOverrides', { userId: 'https://auth.example.com|other-owner',
        threadId: attached.threadId, activityId: activity._id, option: 'example', source: 'learner',
        version: 'learn-adaptive.override.v1', fixedNextPlan: { version: 'learn-adaptive.fixed-next-plan.v1',
          inputOption: 'example', nextActivity: 'worked_example', availableTime: '25', difficulty: 'same',
          maxNewActivities: 1, authority: 'server_revalidate_at_boundary' },
        boundaryOrdinal: activity.boundaryOrdinal, selectedRevision: 3, createdAt: Date.now() })
    })
    const result = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId: attached.threadId, expectedRevision: 2, idempotencyKey: 'routing-foreign-override-0001',
    })
    expect(result).toMatchObject({ kind: 'ok', value: { selectedActivity: { primitive: 'reflection_next_move' },
      reasonCode: 'reflect_on_demonstration' } })
    if (result.kind !== 'ok') throw new Error('Expected decision')
    expect(result.value).not.toHaveProperty('overrideApplication')
  })

  test.each(['activity', 'ordinal'] as const)('ignores an override bound to the wrong %s', async mismatch => {
    const { t, owner, attached } = await completedFactualFixture({ kind: 'retained_transfer', scorePercent: 92,
      stateBefore: 'independent', stateAfter: 'retained', reason: 'eligible_delayed_pass_retained', selectedOverride: 'example' })
    await t.run(async ctx => {
      const selection = await ctx.db.query('learnActivityOverrides')
        .withIndex('by_userId_and_threadId_and_createdAt', q => q.eq('userId', ownerId).eq('threadId', attached.threadId)).first()
      const activity = await ctx.db.get((await ctx.db.get(attached.threadId))!.currentActivityId!)
      if (!selection || !activity) throw new Error('Expected selection and activity')
      if (mismatch === 'ordinal') await ctx.db.patch(selection._id, { boundaryOrdinal: activity.boundaryOrdinal + 1 })
      else {
        const thread = await ctx.db.get(attached.threadId)
        if (!thread) throw new Error('Expected thread')
        const { _id: _threadId, _creationTime: _threadCreated, ...otherThread } = thread
        const otherThreadId = await ctx.db.insert('learningThreads', { ...otherThread, currentActivityId: undefined })
        const { _id: _id, _creationTime: _created, ...otherActivity } = activity
        const otherActivityId = await ctx.db.insert('learningThreadActivities', { ...otherActivity,
          threadId: otherThreadId, activityId: `other:${String(activity._id)}`, boundaryOrdinal: activity.boundaryOrdinal + 1 })
        await ctx.db.patch(selection._id, { activityId: otherActivityId })
      }
    })
    const result = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId: attached.threadId, expectedRevision: 3, idempotencyKey: `routing-wrong-${mismatch}-0001`,
    })
    expect(result).toMatchObject({ kind: 'ok', value: { selectedActivity: { primitive: 'reflection_next_move' },
      reasonCode: 'reflect_on_demonstration' } })
    if (result.kind !== 'ok') throw new Error('Expected decision')
    expect(result.value).not.toHaveProperty('overrideApplication')
  })

  test('rejects a source-comparison selection when only one accepted source is pinned', async () => {
    const { t, owner, attached } = await factualFixture()
    await expect(owner.mutation(api.learnAdaptive.applyOverride, { threadId: attached.threadId,
      activityId: attached.activityId, option: 'compare_sources', expectedRevision: 2,
      idempotencyKey: 'routing-rejected-compare-0001' })).rejects.toThrow('Override unavailable: evidence')
    expect(await t.run(ctx => ctx.db.query('learnActivityOverrides')
      .withIndex('by_userId_and_threadId_and_createdAt', q => q.eq('userId', ownerId).eq('threadId', attached.threadId)).take(1))).toEqual([])
  })

  test('routes from a v1 representative event whose stored hash remains authoritative', async () => {
    const { t, owner, attached } = await completedFactualFixture({ kind: 'retained_transfer', scorePercent: 92,
      stateBefore: 'independent', stateAfter: 'retained', reason: 'eligible_delayed_pass_retained' })
    await t.run(async ctx => {
      const activity = await ctx.db.get((await ctx.db.get(attached.threadId))!.currentActivityId!)
      if (!activity?.masteryAttemptId) throw new Error('Expected representative attempt')
      const event = await ctx.db.query('learnActivityEvents')
        .withIndex('by_userId_and_activityId_and_eventType_and_occurredAt', q => q.eq('userId', ownerId)
          .eq('activityId', activity._id).eq('eventType', 'representative_pass')).first()
      if (!event) throw new Error('Expected representative event')
      await ctx.db.patch(event._id, { taxonomyVersion: 'learn-adaptive.activity-events.v1',
        dedupeKeyHash: await legacyRepresentativeHash(String(attached.threadId), String(activity.masteryAttemptId)) })
    })
    expect(await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId: attached.threadId, expectedRevision: 2, idempotencyKey: 'routing-legacy-representative-0001',
    })).toMatchObject({ kind: 'ok', value: { status: 'recommended', selectedActivity: { primitive: 'reflection_next_move' } } })
  })

  test.each(['missing', 'mismatched'] as const)('does not use a %s mastery scope for a representative route', async (scope) => {
    const { t, owner, attached } = await completedFactualFixture({ kind: 'retained_transfer', scorePercent: 92,
      stateBefore: 'independent', stateAfter: 'retained', reason: 'eligible_delayed_pass_retained' })
    await t.run(async ctx => {
      const record = await ctx.db.query('masteryRecords')
        .withIndex('by_userId', q => q.eq('userId', ownerId)).first()
      if (!record) throw new Error('Expected scoped record')
      await ctx.db.patch(record._id, { scopeKey: scope === 'missing' ? undefined : `sha256:${'f'.repeat(64)}` })
    })
    const result = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId: attached.threadId, expectedRevision: 2, idempotencyKey: 'routing-legacy-mastery-scope-0001',
    })
    expect(result).toMatchObject({ kind: 'blocked', code: 'representative_authority_unavailable' })
    expect(await t.run(ctx => ctx.db.query('learnActivityDecisions')
      .withIndex('by_userId_and_threadId_and_createdAt', q => q.eq('userId', ownerId).eq('threadId', attached.threadId)).take(1))).toEqual([])
  })

  test('routes a pinned retained-transfer pass from the exact scored attempt without copying learner response', async () => {
    const { t, owner, attached } = await completedFactualFixture({ kind: 'retained_transfer', scorePercent: 92,
      stateBefore: 'independent', stateAfter: 'retained', reason: 'eligible_delayed_pass_retained' })
    const result = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId: attached.threadId, expectedRevision: 2, idempotencyKey: 'routing-retained-pass-0001',
    })
    expect(result).toMatchObject({ kind: 'ok', value: { status: 'recommended',
      selectedActivity: { primitive: 'reflection_next_move' }, reasonCode: 'reflect_on_demonstration' } })
    const row = await t.run(ctx => ctx.db.query('learnActivityDecisions')
      .withIndex('by_userId_and_threadId_and_createdAt', q => q.eq('userId', ownerId).eq('threadId', attached.threadId)).first())
    expect(JSON.parse(row!.inputSnapshot).priorActivity).toMatchObject({
      attemptKind: 'retained_transfer', outcome: 'representative_pass', assistance: 'none',
      masteryTransition: { stateBefore: 'independent', stateAfter: 'retained', reason: 'eligible_delayed_pass_retained' },
    })
    expect(row?.inputSnapshot).not.toContain('Gravity attracts masses.')
  })

  test.each([
    [{ kind: 'retained_transfer', scorePercent: 55, stateBefore: 'retained', stateAfter: 'needs_review',
      reason: 'eligible_delayed_failure_needs_review' }, 'representative_fail', 'worked_example', 'remediate_failed_attempt'],
    [{ kind: 'retained_transfer', scorePercent: 55, stateBefore: 'retained', stateAfter: 'retained',
      reason: 'assisted_mastery_preserved', assistance: 'reveal' }, 'representative_fail', 'worked_example', 'remediate_failed_attempt'],
  ] as const)('uses authoritative delayed outcome and transition for %s', async (attempt, outcome, primitive, reasonCode) => {
    const { t, owner, attached } = await completedFactualFixture(attempt)
    const result = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId: attached.threadId, expectedRevision: 2, idempotencyKey: 'routing-retained-outcome-0001',
    })
    expect(result).toMatchObject({ kind: 'ok', value: { selectedActivity: { primitive }, reasonCode } })
    const row = await t.run(ctx => ctx.db.query('learnActivityDecisions')
      .withIndex('by_userId_and_threadId_and_createdAt', q => q.eq('userId', ownerId).eq('threadId', attached.threadId)).first())
    expect(JSON.parse(row!.inputSnapshot).priorActivity).toMatchObject({ outcome, attemptKind: 'retained_transfer',
      assistance: 'assistance' in attempt ? attempt.assistance : 'none', masteryTransition: { reason: attempt.reason } })
  })

  test('does not select factual next work from a swapped or foreign representative attempt', async () => {
    const { t, owner, attached } = await completedFactualFixture({ kind: 'retained_transfer', scorePercent: 92,
      stateBefore: 'independent', stateAfter: 'retained', reason: 'eligible_delayed_pass_retained' })
    await t.run(async ctx => {
      const activity = await ctx.db.get((await ctx.db.get(attached.threadId))!.currentActivityId!)
      if (!activity?.masteryAttemptId) throw new Error('Expected attempt')
      await ctx.db.patch(activity.masteryAttemptId, { userId: 'https://auth.example.com|routing-other' })
    })
    expect(await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId: attached.threadId, expectedRevision: 2, idempotencyKey: 'routing-foreign-attempt-0001',
    })).toMatchObject({ kind: 'blocked', code: 'representative_authority_unavailable' })
    expect(await t.run(ctx => ctx.db.query('learnActivityDecisions').withIndex('by_userId', q => q.eq('userId', ownerId)).take(1))).toEqual([])
  })

  test('a changed attempt kind cannot launder a delayed mastery promotion into the routed result', async () => {
    const { t, owner, attached } = await completedFactualFixture({ kind: 'retained_transfer', scorePercent: 92,
      stateBefore: 'independent', stateAfter: 'retained', reason: 'eligible_delayed_pass_retained' })
    await t.run(async ctx => {
      const activity = await ctx.db.get((await ctx.db.get(attached.threadId))!.currentActivityId!)
      if (!activity?.masteryAttemptId) throw new Error('Expected attempt')
      await ctx.db.patch(activity.masteryAttemptId, { kind: 'independent_application' })
    })
    expect(await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId: attached.threadId, expectedRevision: 2, idempotencyKey: 'routing-changed-kind-0001',
    })).toMatchObject({ kind: 'ok', value: { status: 'blocked', selectedActivity: null, reasonCode: 'unsupported_mastery' } })
  })

  test('an assisted attempt cannot promote unseen mastery to independent through the decision writer', async () => {
    const { owner, attached } = await completedFactualFixture({ kind: 'independent_application', scorePercent: 95,
      stateBefore: 'unseen', stateAfter: 'independent', reason: 'assisted_mastery_preserved', assistance: 'hint' })
    expect(await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId: attached.threadId, expectedRevision: 2, idempotencyKey: 'routing-assisted-promotion-0001',
    })).toMatchObject({ kind: 'ok', value: { status: 'blocked', selectedActivity: null, reasonCode: 'unsupported_mastery' } })
  })

  test('reconstructs the exact stored routing result after receipt redaction and mutable state changes', async () => {
    const { t, threadId, owner } = await standaloneFixture()
    const args = { threadId, expectedRevision: 1, idempotencyKey: 'routing-durable-replay-0001' }
    const first = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, args)
    if (first.kind !== 'ok') throw new Error('Expected routed decision')
    expect(first.value.routerVersion).toBe('learn-adaptive.router.v1')
    expect(first.value).not.toHaveProperty('overrideApplication')
    await t.run(async ctx => {
      const receipt = await ctx.db.get(first.receiptId as never)
      if (!receipt) throw new Error('Expected receipt')
      await ctx.db.patch(receipt._id, { resultReference: null, resultRedactedAt: Date.now(), redactionStatus: 'redacted' })
      await ctx.db.patch(threadId, { evidenceState: 'unavailable', lifecycle: 'rollback', revision: 5 })
    })
    expect(await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, args)).toEqual(first)
    expect(await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, { ...args, expectedRevision: 2 }))
      .toMatchObject({ kind: 'conflict', code: 'duplicate_key' })
    expect(await owner.query(api.learnAdaptiveRouting.replayDecision, { decisionId: first.value.decisionId as never }))
      .toMatchObject({ status: 'replayed', value: first.value })
  })

  test('does not replay a tampered durable decision after the short-lived receipt result is redacted', async () => {
    const { t, threadId, owner } = await standaloneFixture()
    const args = { threadId, expectedRevision: 1, idempotencyKey: 'routing-tamper-replay-0001' }
    const first = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, args)
    if (first.kind !== 'ok') throw new Error('Expected decision')
    await t.run(async ctx => {
      const receipt = await ctx.db.get(first.receiptId as never)
      if (!receipt) throw new Error('Expected receipt')
      await ctx.db.patch(receipt._id, { resultReference: null, resultRedactedAt: Date.now(), redactionStatus: 'redacted' })
      await ctx.db.patch(first.value.decisionId as never, { reasonCode: 'tampered_reason' })
    })
    expect(await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, args))
      .toMatchObject({ kind: 'invalid', code: 'result_expired' })
    expect(await owner.query(api.learnAdaptiveRouting.replayDecision, { decisionId: first.value.decisionId as never }))
      .toMatchObject({ status: 'integrity_failed' })
  })

  test('does not replay a decision whose selected activity identity was changed after receipt redaction', async () => {
    const { t, threadId, owner } = await standaloneFixture()
    const args = { threadId, expectedRevision: 1, idempotencyKey: 'routing-identity-replay-0001' }
    const first = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, args)
    if (first.kind !== 'ok') throw new Error('Expected decision')
    await t.run(async ctx => {
      const receipt = await ctx.db.get(first.receiptId as never)
      if (!receipt) throw new Error('Expected receipt')
      await ctx.db.patch(receipt._id, { resultReference: null, resultRedactedAt: Date.now(), redactionStatus: 'redacted' })
      await ctx.db.patch(first.value.decisionId as never, { activityId: 'route_wrong-thread_999' })
    })
    expect(await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, args))
      .toMatchObject({ kind: 'invalid', code: 'result_expired' })
    expect(await owner.query(api.learnAdaptiveRouting.replayDecision, { decisionId: first.value.decisionId as never }))
      .toMatchObject({ status: 'integrity_failed' })
  })

  test('rejects client authority, oversized or unknown input, foreign ownership, and stale revision without a decision event', async () => {
    const { t, threadId, owner } = await standaloneFixture()
    const base = { threadId, expectedRevision: 1, idempotencyKey: 'routing-adversarial-0001' }
    for (const extra of [{ serverScorePercent: 100 }, { mastery: 'retained' },
      { evidenceAcceptance: 'user_accepted' }, { sourceInputs: Array.from({ length: 200 }, () => 'private') },
      { overrideOption: 'answer_now' }, { routeTo: 'https://private.example.com' }]) {
      await expect(owner.mutation(api.learnAdaptiveRouting.decideNextActivity, { ...base, ...extra } as never)).rejects.toThrow()
    }
    await t.run(ctx => ctx.db.insert('users', { tokenIdentifier: 'https://auth.example.com|routing-other', name: 'Other',
      learnV2Entitlement: { enabled: true, updatedAt: 1 }, learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: 1 } }))
    await expect(t.withIdentity({ tokenIdentifier: 'https://auth.example.com|routing-other' })
      .mutation(api.learnAdaptiveRouting.decideNextActivity, base)).rejects.toThrow(/Thread not found/)
    expect(await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, { ...base, expectedRevision: 2 }))
      .toMatchObject({ kind: 'conflict', code: 'stale_revision' })
    const state = await t.run(async ctx => ({
      decisions: await ctx.db.query('learnActivityDecisions').withIndex('by_userId', q => q.eq('userId', ownerId)).take(1),
      events: await ctx.db.query('learnActivityEvents').withIndex('by_userId', q => q.eq('userId', ownerId)).take(1),
    }))
    expect(state).toEqual({ decisions: [], events: [] })
  })

  test('exports a redacted bounded decision and deletes it before its parent thread', async () => {
    const { t, threadId, owner } = await standaloneFixture()
    const decided = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId, expectedRevision: 1, idempotencyKey: 'routing-export-delete-0001',
    })
    if (decided.kind !== 'ok') throw new Error('Expected decision')
    const exported = await owner.query(api.dataExport.getUserDataPage, {
      collection: 'learnActivityDecisions', paginationOpts: { cursor: null, numItems: 100 },
    })
    expect(exported.page).toHaveLength(1)
    expect(exported.page[0]).toMatchObject({ activityId: decided.value.activityId,
      selectedActivity: { primitive: 'diagnostic_prompt' }, reasonCode: 'source_free_diagnostic' })
    expect(exported.page[0]).not.toHaveProperty('inputSnapshot')
    expect(exported.page[0]).not.toHaveProperty('idempotencyKeyHash')
    expect(await owner.mutation(api.learnAdaptive.requestThreadDeletion, { threadId })).toMatchObject({ status: 'queued' })
    const job = await t.run(ctx => ctx.db.query('learnAdaptiveThreadDeletionJobs')
      .withIndex('by_userId_and_threadId', q => q.eq('userId', ownerId).eq('threadId', threadId)).unique())
    expect(await t.mutation(internal.learnAdaptiveCommands.runThreadDeletionJob, { jobId: job!._id }))
      .toMatchObject({ phase: 'decisions', state: 'queued' })
    for (let i = 0; i < 8; i++) {
      const remaining = await t.run(ctx => ctx.db.get(threadId))
      if (!remaining) break
      await t.mutation(internal.learnAdaptiveCommands.runThreadDeletionJob, { jobId: job!._id })
    }
    expect(await t.run(ctx => ctx.db.get(threadId))).toBeNull()
    expect(await t.run(ctx => ctx.db.query('learnActivityDecisions').withIndex('by_userId', q => q.eq('userId', ownerId)).take(1))).toEqual([])
  })

  test('account deletion traverses decision children before the owner thread in bounded batches', async () => {
    const { t, threadId, owner } = await standaloneFixture()
    const decided = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId, expectedRevision: 1, idempotencyKey: 'routing-account-delete-0001',
    })
    expect(decided.kind).toBe('ok')
    await t.run(ctx => ctx.db.insert('accountDeletionJobs', { userId: ownerId, status: 'active',
      phase: 'learnV2', startedAt: Date.now(), updatedAt: Date.now() }))
    await t.mutation(internal.accountDeletion.runDeletionBatch, { userId: ownerId })
    expect(await t.run(ctx => ctx.db.query('learnActivityDecisions').withIndex('by_userId', q => q.eq('userId', ownerId)).take(1))).toEqual([])
    expect(await t.run(ctx => ctx.db.get(threadId))).not.toBeNull()
    for (let i = 0; i < 8; i++) {
      if (!(await t.run(ctx => ctx.db.get(threadId)))) break
      await t.mutation(internal.accountDeletion.runDeletionBatch, { userId: ownerId })
    }
    expect(await t.run(ctx => ctx.db.get(threadId))).toBeNull()
  })
  test('captures only live owner-checked factual pins and accepted source revisions, without private source content', async () => {
    const { t, owner, ids, attached } = await factualFixture()
    const result = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId: attached.threadId, expectedRevision: 2, idempotencyKey: 'routing-factual-incomplete-0001',
    })
    expect(result).toMatchObject({ kind: 'ok', value: { status: 'blocked', selectedActivity: null,
      reasonCode: 'prior_activity_incomplete', fallback: { kind: 'stay_on_current' } } })
    const decision = await t.run(ctx => ctx.db.query('learnActivityDecisions')
      .withIndex('by_userId_and_threadId_and_createdAt', q => q.eq('userId', ownerId).eq('threadId', attached.threadId)).first())
    expect(decision?.activityId).toBe(`route_${String(attached.threadId)}_2`)
    expect(JSON.parse(decision!.inputSnapshot)).toMatchObject({
      authorityKind: 'v2_mission', pins: { learningVoidId: ids.learningVoidId, blueprintRevisionId: ids.blueprintRevisionId,
        blueprintRecordRevision: 3, objectiveId: ids.objectiveId, sessionContentId: ids.sessionContentId, sessionContentRevision: 1 },
      sourceInputs: [{ sourceSnapshotId: ids.sourceSnapshotId, effectiveStatus: 'user_accepted', recordRevision: 7 }],
      priorActivity: { activityId: attached.activityId, outcome: 'incomplete' },
    })
    expect(decision?.inputSnapshot).not.toContain('PRIVATE SOURCE TEXT')
    expect(decision?.inputSnapshot).not.toContain('private-page-1')
  })

  test('records a factual recovery decision when a pinned accepted source becomes stale', async () => {
    const { t, owner, ids, attached } = await factualFixture()
    await t.run(ctx => ctx.db.patch(ids.sourceSnapshotId, { effectiveStatus: 'rejected', recordRevision: 8 }))
    const result = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId: attached.threadId, expectedRevision: 2, idempotencyKey: 'routing-stale-source-0001',
    })
    expect(result).toMatchObject({ kind: 'ok', value: { status: 'blocked', selectedActivity: null,
      fallback: { kind: 'non_factual_activity', primitive: 'diagnostic_prompt' } } })
    const row = await t.run(ctx => ctx.db.query('learnActivityDecisions')
      .withIndex('by_userId_and_threadId_and_createdAt', q => q.eq('userId', ownerId).eq('threadId', attached.threadId)).first())
    expect(JSON.parse(row!.inputSnapshot).sourceState).not.toBe('ready')
  })
  test('records a blocked router result and its safe fallback without inventing an activity', async () => {
    const { t, threadId, owner } = await standaloneFixture()
    await t.run(ctx => ctx.db.patch(threadId, { evidenceState: 'unavailable' }))
    const result = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId, expectedRevision: 1, idempotencyKey: 'routing-blocked-0001',
    })
    expect(result).toMatchObject({ kind: 'ok', value: { status: 'blocked', selectedActivity: null,
      reasonCode: 'evidence_unavailable', fallback: { kind: 'non_factual_activity', primitive: 'diagnostic_prompt' } } })
    expect(await t.run(ctx => ctx.db.query('learnActivityDecisions').withIndex('by_userId_and_threadId_and_createdAt', q => q.eq('userId', ownerId).eq('threadId', threadId)).take(2)))
      .toMatchObject([{ status: 'blocked', selectedActivity: null, reasonCode: 'evidence_unavailable' }])
  })

  test('a blocked decision can advance only after its server-owned routing inputs change', async () => {
    const { t, threadId, owner } = await standaloneFixture()
    await t.run(ctx => ctx.db.patch(threadId, { evidenceState: 'unavailable' }))
    const blocked = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId, expectedRevision: 1, idempotencyKey: 'routing-recovery-blocked-0001',
    })
    expect(blocked).toMatchObject({ kind: 'ok', value: { status: 'blocked', activityId: `route_${String(threadId)}_1` } })
    expect(await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId, expectedRevision: 2, idempotencyKey: 'routing-recovery-unchanged-0001',
    })).toMatchObject({ kind: 'blocked', code: 'routing_boundary_recorded' })
    await t.run(ctx => ctx.db.patch(threadId, { evidenceState: 'none' }))
    const recovered = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId, expectedRevision: 2, idempotencyKey: 'routing-recovery-ready-0001',
    })
    expect(recovered).toMatchObject({ kind: 'ok', value: { status: 'recommended', activityId: `route_${String(threadId)}_2` } })
    expect(await t.run(ctx => ctx.db.query('learnActivityDecisions')
      .withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', ownerId).eq('threadId', threadId)).take(3)))
      .toMatchObject([{ boundaryOrdinal: 1, status: 'blocked' }, { boundaryOrdinal: 2, status: 'recommended' }])
  })

  test('reserves the next bounded activity identity after a completed diagnostic boundary', async () => {
    const { t, threadId, owner } = await standaloneFixture()
    await t.run(ctx => ctx.db.patch(threadId, { outcome: 'Identify one useful next move.', outcomeProvenance: 'explicit' }))
    const prepared = await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, {
      threadId, expectedRevision: 1, idempotencyKey: 'routing-prepare-next-0001',
    })
    expect(prepared.kind).toBe('ok')
    const continued = await owner.mutation(api.learnAdaptiveRecovery.continueDraft, {
      threadId, expectedRevision: 2, idempotencyKey: 'routing-continue-next-0001',
    })
    if (continued.kind !== 'ok') throw new Error('Expected diagnostic activity')
    const submitted = await owner.mutation(api.learnAdaptiveRecovery.submitDiagnosticResponse, {
      threadId, activityId: continued.value.activityId, expectedRevision: 3,
      response: 'I want to compare two explanations.', idempotencyKey: 'routing-submit-next-0001',
    })
    expect(submitted.kind).toBe('ok')
    const decided = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId, expectedRevision: 4, idempotencyKey: 'routing-next-boundary-0001',
    })
    expect(decided).toMatchObject({ kind: 'ok', value: { selectedActivity: { primitive: 'diagnostic_prompt' } } })
    const decision = await t.run(ctx => ctx.db.query('learnActivityDecisions')
      .withIndex('by_userId_and_threadId_and_createdAt', q => q.eq('userId', ownerId).eq('threadId', threadId)).first())
    expect(decision?.activityId).toBe(`route_${String(threadId)}_2`)
    expect(JSON.parse(decision!.inputSnapshot)).toMatchObject({ priorActivity: { activityId: continued.value.activityId,
      outcome: 'completed', primitive: 'diagnostic_prompt' } })
  })

  test('commits one bounded source-free decision without inventing a Canvas plan, then replays the stored result after thread changes', async () => {
    const { t, threadId, owner } = await standaloneFixture()
    const args = { threadId, expectedRevision: 1, idempotencyKey: 'routing-standalone-0001' }
    const result = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, args)
    expect(result).toMatchObject({ kind: 'ok', revision: 2, value: {
      status: 'recommended', selectedActivity: { primitive: 'diagnostic_prompt', activityClass: 'non_factual' },
      reasonCode: 'source_free_diagnostic', routerVersion: 'learn-adaptive.router.v1',
    } })
    const before = await t.run(async ctx => ({
      decisions: await ctx.db.query('learnActivityDecisions').withIndex('by_userId_and_threadId_and_createdAt', q => q.eq('userId', ownerId).eq('threadId', threadId)).take(2),
      activities: await ctx.db.query('learningThreadActivities').withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', ownerId).eq('threadId', threadId)).take(2),
      events: await ctx.db.query('learnActivityEvents').withIndex('by_userId_and_threadId_and_occurredAt', q => q.eq('userId', ownerId).eq('threadId', threadId)).take(2),
    }))
    expect(before.decisions).toHaveLength(1)
    expect(before.activities).toEqual([])
    expect(before.events).toMatchObject([{ eventType: 'routing_decision', eventVersion: 'routing_decision.v1' }])
    expect(before.decisions[0]).toMatchObject({ inputDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      selectedActivity: { primitive: 'diagnostic_prompt' }, reasonCode: 'source_free_diagnostic',
      activityId: result.kind === 'ok' ? result.value.activityId : undefined })
    await t.run(ctx => ctx.db.patch(threadId, { evidenceState: 'unavailable', lifecycle: 'rollback', revision: 3 }))
    expect(await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, args)).toEqual(result)
    const after = await t.run(async ctx => ({
      decisions: await ctx.db.query('learnActivityDecisions').withIndex('by_userId_and_threadId_and_createdAt', q => q.eq('userId', ownerId).eq('threadId', threadId)).take(2),
      activities: await ctx.db.query('learningThreadActivities').withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', ownerId).eq('threadId', threadId)).take(2),
      events: await ctx.db.query('learnActivityEvents').withIndex('by_userId_and_threadId_and_occurredAt', q => q.eq('userId', ownerId).eq('threadId', threadId)).take(2),
    }))
    expect(after).toEqual(before)
  })
})
