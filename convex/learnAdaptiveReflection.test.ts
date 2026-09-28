/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { composeAdaptiveActivityPlan } from '../shared/learn-adaptive-activity-plan'
import { reasonTextForActivity } from '../shared/learn-adaptive-controls'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|reflection-owner' }
const OTHER = { tokenIdentifier: 'https://auth.example.com|reflection-other' }
const originalFlag = process.env.LEARN_V2_ENABLED

beforeEach(() => { process.env.LEARN_V2_ENABLED = 'true' })
afterAll(() => { if (originalFlag === undefined) delete process.env.LEARN_V2_ENABLED; else process.env.LEARN_V2_ENABLED = originalFlag })

async function fixture() {
  const t = convexTest(schema, modules)
  for (const identity of [OWNER, OTHER]) {
    const actor = t.withIdentity(identity)
    await actor.mutation(api.users.upsertUser, {})
    await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
    await actor.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  }
  const ids = await t.run(async (ctx) => {
    const threadId = await ctx.db.insert('learningThreads', {
      userId: OWNER.tokenIdentifier, originalNeed: 'Choose a useful next step.', outcome: 'Keep learning deliberately.',
      outcomeProvenance: 'explicit', intent: 'explore', availableTime: '25', authorityKind: 'standalone',
      sourceScope: { kind: 'none' }, evidenceState: 'none', lifecycle: 'active', revision: 3, createdAt: 1, updatedAt: 1,
    })
    const activityId = `reflection:${String(threadId)}`
    const plan = await composeAdaptiveActivityPlan({
      activityId, threadId: String(threadId), boundaryOrdinal: 2, planRevision: 1, activityClass: 'non_factual',
      intent: 'explore', objectiveId: null, purpose: 'Choose what to do next.', reasonCode: 'reflect_on_demonstration',
      primitiveSequence: [{ type: 'reflection_next_move', action: 'accept_next_move', props: {
        feedback: 'You completed the guided example.', nextMove: 'Try one independent example.', allowedDecisions: ['accept', 'override', 'end'],
      } }],
      requiredAction: { kind: 'accept_next_move', label: 'Accept next move' },
      evaluationContract: { version: 'learn-adaptive.evaluation.v1', kind: 'acknowledgement', responseFormat: 'none', passingScorePercent: null },
      accessibilityMetadata: { heading: 'Choose your next move', instructions: 'Review the feedback and choose one option.', focusTargetTestId: 'learn-primitive-reflection-next-move', liveRegionMode: 'polite' },
      pins: { learningVoidId: null, blueprintRevisionId: null, objectiveId: null, sessionContentId: null },
      evidenceReferences: [], generationInputs: { sessionContentRevision: null, sessionContentInputDigest: null, generatorVersion: null },
      decisionInputs: { intentRevision: 1, routerVersion: 'learn-adaptive.router.v1', availableTime: '25', sourceState: 'none', sourceInputs: [],
        priorActivityId: 'guided:1', priorAttemptId: null, priorOutcome: 'completed', assistance: 'none', confidence: null },
    })
    const { pins: _pins, ...stored } = plan
    const rowId = await ctx.db.insert('learningThreadActivities', { userId: OWNER.tokenIdentifier, ...stored,
      threadId, objectiveId: null, learningVoidId: null, blueprintRevisionId: null, sessionContentId: null,
      evidenceReferences: [], reasonText: reasonTextForActivity({ activityClass: 'non_factual',
        purpose: plan.purpose, reasonCode: plan.reasonCode, sourceState: plan.decisionInputs.sourceState }),
      status: 'eligible', createdAt: 1, updatedAt: 1 })
    await ctx.db.patch(threadId, { currentActivityId: rowId })
    return { threadId, activityId, rowId }
  })
  return { t, ...ids, owner: t.withIdentity(OWNER), other: t.withIdentity(OTHER) }
}

describe('reflection and next-move authority', () => {
  test('projects only the owned replay-valid reflection plan', async () => {
    const { t, owner, other, threadId, rowId } = await fixture()
    expect(await owner.query(api.learnAdaptive.getReflectionCanvas, { threadId })).toMatchObject({
      status: 'eligible', decision: null, activity: { primitive: { type: 'reflection_next_move', props: {
        feedback: 'You completed the guided example.', nextMove: 'Try one independent example.',
      } } },
    })
    expect(await other.query(api.learnAdaptive.getReflectionCanvas, { threadId })).toBeNull()
    await t.run(ctx => ctx.db.patch(rowId, { purpose: 'Tampered purpose' }))
    expect(await owner.query(api.learnAdaptive.getReflectionCanvas, { threadId })).toMatchObject({ status: 'blocked', activity: { primitive: null } })
  })

  test.each([
    ['accept', 'accepted', 'active', 'Try one independent example.'],
    ['override', 'overridden', 'active', 'Choose a different next move'],
    ['end', 'ended', 'ended', 'Back to Learn'],
  ] as const)('records %s as an authoritative non-mastery outcome', async (decision, outcome, lifecycle, label) => {
    const { t, owner, threadId, activityId } = await fixture()
    const args = { threadId, activityId, decision, expectedRevision: 3, idempotencyKey: `reflection-${decision}-decision-0001` }
    const first = await owner.mutation(api.learnAdaptive.decideReflectionNextMove, args)
    expect(first).toMatchObject({ kind: 'ok', revision: 4, value: { outcome, nextMove: 'Try one independent example.' } })
    expect(await owner.mutation(api.learnAdaptive.decideReflectionNextMove, args)).toEqual(first)
    expect(await owner.query(api.learnAdaptive.getReflectionCanvas, { threadId })).toMatchObject({
      status: 'completed', decision: { outcome, nextMove: 'Try one independent example.' },
    })
    expect(await owner.query(api.learnAdaptive.getThread, { threadId })).toMatchObject({ nextAction: { label } })
    const durable = await t.run(async ctx => ({ thread: await ctx.db.get(threadId),
      attempts: await ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(2),
      jobs: await ctx.db.query('learnJobs').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(2),
      events: await ctx.db.query('learnActivityEvents').withIndex('by_userId_and_threadId_and_occurredAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).take(4) }))
    expect(durable.thread).toMatchObject({ lifecycle, revision: 4, nextAction: { label } })
    expect(durable.attempts).toEqual([])
    expect(durable.jobs).toEqual([])
    expect(durable.events).toEqual([expect.objectContaining({ eventType: 'activity_completed', outcomeCode: outcome })])
  })

  test('rejects a decision not offered by the persisted plan', async () => {
    const { t, owner, threadId, activityId, rowId } = await fixture()
    const activity = await t.run(ctx => ctx.db.get(rowId))
    if (!activity || activity.primitivePlan[0]?.type !== 'reflection_next_move') throw new Error('missing reflection')
    const restricted = await composeAdaptiveActivityPlan({
      ...activity,
      threadId: String(threadId), objectiveId: null,
      primitiveSequence: [{ type: 'reflection_next_move', action: 'accept_next_move', props: { ...activity.primitivePlan[0].props, allowedDecisions: ['accept'] } }],
      pins: { learningVoidId: null, blueprintRevisionId: null, objectiveId: null, sessionContentId: null },
      replacesActivityId: undefined,
    })
    const { pins: _pins, ...stored } = restricted
    await t.run(ctx => ctx.db.patch(rowId, { ...stored, threadId, objectiveId: null, evidenceReferences: [] }))
    expect(await owner.mutation(api.learnAdaptive.decideReflectionNextMove, { threadId, activityId, decision: 'end', expectedRevision: 3, idempotencyKey: 'test-test-test-test-1' }))
      .toMatchObject({ kind: 'blocked', code: 'decision_unavailable' })
  })

  test('blocks choices while the thread is paused and rejects a tampered persisted reason', async () => {
    const { t, owner, threadId, activityId, rowId } = await fixture()
    await t.run(ctx => ctx.db.patch(threadId, { lifecycle: 'paused' }))
    expect(await owner.query(api.learnAdaptive.getReflectionCanvas, { threadId }))
      .toMatchObject({ status: 'blocked', activity: { primitive: null } })
    expect(await owner.mutation(api.learnAdaptive.decideReflectionNextMove, {
      threadId, activityId, decision: 'accept', expectedRevision: 3, idempotencyKey: 'reflection-paused-0001',
    })).toMatchObject({ kind: 'blocked', code: 'activity_unavailable' })
    await t.run(async (ctx) => {
      await ctx.db.patch(threadId, { lifecycle: 'active' })
      const activity = await ctx.db.get(rowId)
      if (!activity?.reasonText) throw new Error('missing reflection reason')
      await ctx.db.patch(rowId, { reasonText: { ...activity.reasonText, text: 'Tampered reason' } })
    })
    expect(await owner.query(api.learnAdaptive.getReflectionCanvas, { threadId }))
      .toMatchObject({ status: 'blocked', activity: { primitive: null } })
  })

  test('falls back instead of exposing a tampered stored next action', async () => {
    const { t, owner, threadId, activityId, rowId } = await fixture()
    await owner.mutation(api.learnAdaptive.decideReflectionNextMove, { threadId, activityId, decision: 'accept',
      expectedRevision: 3, idempotencyKey: 'test-test-test-test-2' })
    await t.run(ctx => ctx.db.patch(threadId, { nextAction: { kind: 'continue', label: 'Fabricated route',
      reasonCode: 'reflection_next_move_accepted', activityId } }))
    expect(await owner.query(api.learnAdaptive.getThread, { threadId })).toMatchObject({
      nextAction: { kind: 'recover', reasonCode: 'reflection_decision_invalid' },
    })
    await t.run(ctx => ctx.db.patch(threadId, { lifecycle: 'ended' }))
    expect(await owner.query(api.learnAdaptive.getReflectionCanvas, { threadId })).toMatchObject({ status: 'blocked', decision: null })
    await t.run(async (ctx) => {
      const activity = await ctx.db.get(rowId)
      if (!activity?.reflectionDecision) throw new Error('missing reflection decision')
      await ctx.db.patch(threadId, { lifecycle: 'active' })
      await ctx.db.patch(rowId, { reflectionDecision: { ...activity.reflectionDecision, decisionRevision: 3 } })
    })
    expect(await owner.query(api.learnAdaptive.getReflectionCanvas, { threadId })).toMatchObject({ status: 'blocked', decision: null })
  })

  test('binds the durable outcome and expired replay to the receipt request fingerprint', async () => {
    const { t, owner, threadId, activityId, rowId } = await fixture()
    const args = { threadId, activityId, decision: 'accept' as const, expectedRevision: 3,
      idempotencyKey: 'reflection-fingerprint-0001' }
    expect(await owner.mutation(api.learnAdaptive.decideReflectionNextMove, args)).toMatchObject({ kind: 'ok' })
    await t.run(async (ctx) => {
      const activity = await ctx.db.get(rowId)
      if (!activity?.reflectionDecision) throw new Error('missing reflection decision')
      await ctx.db.patch(rowId, { reflectionDecision: { ...activity.reflectionDecision, outcome: 'overridden' } })
      await ctx.db.patch(threadId, { nextAction: { kind: 'override', label: 'Choose a different next move',
        reasonCode: 'reflection_next_move_overridden', activityId } })
    })
    expect(await owner.query(api.learnAdaptive.getReflectionCanvas, { threadId }))
      .toMatchObject({ status: 'blocked', decision: null })
    expect(await owner.query(api.learnAdaptive.getThread, { threadId })).toMatchObject({
      nextAction: { kind: 'recover', reasonCode: 'activity_ended' },
    })
    await t.mutation(internal.learnAdaptiveCommands.redactExpiredReceiptResults,
      { now: Date.now() + 31 * 24 * 60 * 60 * 1000 })
    expect(await owner.mutation(api.learnAdaptive.decideReflectionNextMove, args))
      .toMatchObject({ kind: 'invalid', code: 'result_expired' })
  })

  test('rejects expired replay when the persisted next move no longer matches the plan', async () => {
    const { t, owner, threadId, activityId, rowId } = await fixture()
    const args = { threadId, activityId, decision: 'accept' as const, expectedRevision: 3,
      idempotencyKey: 'reflection-next-move-replay-0001' }
    expect(await owner.mutation(api.learnAdaptive.decideReflectionNextMove, args)).toMatchObject({ kind: 'ok' })
    await t.run(async (ctx) => {
      const activity = await ctx.db.get(rowId)
      if (!activity?.reflectionDecision) throw new Error('missing reflection decision')
      await ctx.db.patch(rowId, { reflectionDecision: { ...activity.reflectionDecision, nextMove: 'Forged next move.' } })
    })
    await t.mutation(internal.learnAdaptiveCommands.redactExpiredReceiptResults,
      { now: Date.now() + 31 * 24 * 60 * 60 * 1000 })
    expect(await owner.mutation(api.learnAdaptive.decideReflectionNextMove, args))
      .toMatchObject({ kind: 'invalid', code: 'result_expired' })
  })
})
