/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|intent-owner' }
const OTHER = { tokenIdentifier: 'https://auth.example.com|intent-other' }
const originalFlag = process.env.LEARN_V2_ENABLED

beforeEach(() => { process.env.LEARN_V2_ENABLED = 'true' })
afterAll(() => { if (originalFlag === undefined) delete process.env.LEARN_V2_ENABLED; else process.env.LEARN_V2_ENABLED = originalFlag })

async function setup() {
  const t = convexTest(schema, modules)
  for (const identity of [OWNER, OTHER]) {
    const actor = t.withIdentity(identity)
    await actor.mutation(api.users.upsertUser, {})
    await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
    await actor.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  }
  const owner = t.withIdentity(OWNER)
  const created = await owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, {
    need: 'Understand the mechanism in my own words.', intent: 'understand', availableTime: '15',
    sourceScope: { kind: 'none' }, idempotencyKey: 'intent-create-thread-01',
  })
  if (created.kind !== 'created') throw new Error('expected created thread')
  return { t, owner, other: t.withIdentity(OTHER), thread: created.thread }
}

describe('one selected learning intent', () => {
  test('changes and persists the selected intent while preserving the original wording', async () => {
    const { owner, thread } = await setup()
    const result = await owner.mutation(api.learnAdaptive.setIntent, {
      threadId: thread.id, intent: 'prepare', expectedRevision: 1, idempotencyKey: 'intent-set-prepare-01',
    })
    expect(result).toMatchObject({ kind: 'ok', revision: 2, value: { intent: 'prepare' } })
    expect(await owner.query(api.learnAdaptiveDrafts.getThreadDraft, { threadId: thread.id })).toMatchObject({
      intent: 'prepare', revision: 2, originalNeed: thread.originalNeed, outcome: thread.outcome,
    })
  })

  test('accepts the six intents, replays a command, and leaves same-value selection at one revision', async () => {
    const { owner, thread } = await setup()
    let revision = 1
    for (const intent of ['prepare', 'build', 'master', 'refresh', 'explore', 'understand'] as const) {
      const args = { threadId: thread.id, intent, expectedRevision: revision, idempotencyKey: `intent-change-${intent}-01` }
      const changed = await owner.mutation(api.learnAdaptive.setIntent, args)
      expect(changed).toMatchObject({ kind: 'ok', revision: revision + 1, value: { intent } })
      expect(await owner.mutation(api.learnAdaptive.setIntent, args)).toEqual(changed)
      revision += 1
    }
    const same = await owner.mutation(api.learnAdaptive.setIntent, { threadId: thread.id, intent: 'understand', expectedRevision: revision, idempotencyKey: 'intent-same-value-001' })
    expect(same).toMatchObject({ kind: 'ok', revision, value: { intent: 'understand' } })
    expect((await owner.query(api.learnAdaptiveDrafts.getThreadDraft, { threadId: thread.id }))?.revision).toBe(revision)
    await expect(owner.mutation(api.learnAdaptive.setIntent, { threadId: thread.id, intent: 'invent', expectedRevision: revision, idempotencyKey: 'intent-invalid-0001' } as never)).rejects.toThrow()
  })

  test('keeps the one pending clarification and its pinned input when intent changes', async () => {
    const { t, owner, thread } = await setup()
    await owner.mutation(api.learnAdaptive.setIntent, { threadId: thread.id, intent: 'prepare', expectedRevision: 1, idempotencyKey: 'intent-pending-prep01' })
    await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId: thread.id, expectedRevision: 2, idempotencyKey: 'intent-pending-start1' })
    const before = (await t.run(ctx => ctx.db.get(thread.id)))?.initialDecision
    expect(before).toMatchObject({ status: 'pending', inputSnapshot: { intent: 'prepare' } })
    const changed = await owner.mutation(api.learnAdaptive.setIntent, { threadId: thread.id, intent: 'explore', expectedRevision: 3, idempotencyKey: 'intent-pending-next01' })
    expect(changed).toMatchObject({ kind: 'ok', revision: 4, value: { intent: 'explore' } })
    expect((await t.run(ctx => ctx.db.get(thread.id)))?.initialDecision).toEqual(before)
    const stale = await owner.mutation(api.learnAdaptiveClarifications.resolveClarification, { threadId: thread.id, expectedRevision: 3, idempotencyKey: 'intent-stale-answer01', resolution: { kind: 'answer', answer: 'A clear explanation I can share.' } })
    expect(stale).toMatchObject({ kind: 'conflict', code: 'stale_revision', actualRevision: 4 })
    await owner.mutation(api.learnAdaptiveClarifications.resolveClarification, { threadId: thread.id, expectedRevision: 4, idempotencyKey: 'intent-current-answer1', resolution: { kind: 'answer', answer: 'A clear explanation I can share.' } })
    const resolved = await t.run(ctx => ctx.db.get(thread.id))
    expect(resolved).toMatchObject({ intent: 'explore', originalNeed: thread.originalNeed, outcome: 'A clear explanation I can share.', initialDecision: { status: 'answered', inputSnapshot: { intent: 'prepare' } } })
    await owner.mutation(api.learnAdaptive.setIntent, { threadId: thread.id, intent: 'master', expectedRevision: 5, idempotencyKey: 'intent-after-answer01' })
    expect((await t.run(ctx => ctx.db.get(thread.id)))?.initialDecision).toEqual(resolved?.initialDecision)
  })

  test('serializes concurrent intent changes, rejects key reuse, and enforces owner and lifecycle', async () => {
    const { t, owner, other, thread } = await setup()
    const [first, second] = await Promise.all([
      owner.mutation(api.learnAdaptive.setIntent, { threadId: thread.id, intent: 'build', expectedRevision: 1, idempotencyKey: 'intent-race-build-01' }),
      owner.mutation(api.learnAdaptive.setIntent, { threadId: thread.id, intent: 'refresh', expectedRevision: 1, idempotencyKey: 'intent-race-refresh1' }),
    ])
    expect([first.kind, second.kind].sort()).toEqual(['conflict', 'ok'])
    const winner = first.kind === 'ok' ? 'build' : 'refresh'
    expect((await t.run(ctx => ctx.db.get(thread.id)))?.intent).toBe(winner)
    const reused = await owner.mutation(api.learnAdaptive.setIntent, { threadId: thread.id, intent: 'master', expectedRevision: 1, idempotencyKey: 'intent-race-build-01' })
    expect(reused).toMatchObject({ kind: 'conflict', code: 'duplicate_key' })
    await expect(other.mutation(api.learnAdaptive.setIntent, { threadId: thread.id, intent: 'master', expectedRevision: 2, idempotencyKey: 'intent-foreign-owner1' })).rejects.toThrow(/not found/i)
    await expect(t.mutation(api.learnAdaptive.setIntent, { threadId: thread.id, intent: 'master', expectedRevision: 2, idempotencyKey: 'intent-unauthorized01' })).rejects.toThrow(/access denied/i)
    await t.run(ctx => ctx.db.patch(thread.id, { lifecycle: 'ended' }))
    await expect(owner.mutation(api.learnAdaptive.setIntent, { threadId: thread.id, intent: 'master', expectedRevision: 2, idempotencyKey: 'intent-ended-thread1' })).rejects.toThrow(/lifecycle/i)
  })

  test('preserves the old activity pin and uses the changed intent at the next activity boundary', async () => {
    const { t, owner, thread } = await setup()
    const commit = async (intent: 'understand' | 'build', expectedRevision: number, ordinal: number, replacesActivityId?: string) => owner.mutation(internal.learnAdaptiveActivities.commitActivityPlan, {
      threadId: thread.id,
      expectedRevision,
      idempotencyKey: `intent-commit-${ordinal}-${intent}-01`,
      activityId: `intent-activity-${ordinal}`,
      boundaryOrdinal: ordinal,
      planRevision: ordinal,
      activityClass: 'non_factual',
      intent,
      objectiveId: null,
      purpose: 'Work from the learner goal.',
      reasonCode: 'standalone_next_move',
      primitiveSequence: [{ type: 'diagnostic_prompt' as const, action: 'submit_response' as const, props: { prompt: 'What do you know?', responseFormat: 'short_text' as const, assistance: 'none' as const } }],
      requiredAction: { kind: 'submit_response', label: 'Continue' },
      evaluationContract: { version: 'learn-adaptive.evaluation.v1', kind: 'learner_response' as const, responseFormat: 'short_text' as const, passingScorePercent: null },
      accessibilityMetadata: { heading: 'Next move', instructions: 'Answer the prompt.', focusTargetTestId: 'intent-next-move', liveRegionMode: 'polite' as const },
      learningVoidId: null,
      blueprintRevisionId: null,
      sessionContentId: null,
      evidenceReferences: [],
      decisionInputs: { routerVersion: 'learn-adaptive.router.v1', availableTime: '15' as const, sourceState: 'none' as const, priorActivityId: replacesActivityId ?? null, priorAttemptId: null, priorOutcome: null, assistance: 'none' as const, confidence: null },
      ...(replacesActivityId ? { replacesActivityId } : {}),
    })
    const first = await commit('understand', 1, 1)
    expect(first).toMatchObject({ kind: 'ok', revision: 2 })
    const changed = await owner.mutation(api.learnAdaptive.setIntent, { threadId: thread.id, intent: 'build', expectedRevision: 2, idempotencyKey: 'intent-after-work-001' })
    expect(changed).toMatchObject({ kind: 'ok', revision: 3 })
    await expect(commit('understand', 3, 2, 'intent-activity-1')).rejects.toThrow(/inputs are stale/i)
    const next = await commit('build', 3, 2, 'intent-activity-1')
    expect(next).toMatchObject({ kind: 'ok', revision: 4 })
    const activities = await t.run(ctx => ctx.db.query('learningThreadActivities').withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', thread.id)).take(3))
    expect(activities.map(activity => ({ intent: activity.intent, intentRevision: activity.decisionInputs.intentRevision, status: activity.status }))).toEqual([
      { intent: 'understand', intentRevision: 1, status: 'eligible' },
      { intent: 'build', intentRevision: 3, status: 'eligible' },
    ])
    expect((await owner.query(api.learnAdaptiveDrafts.getThreadDraft, { threadId: thread.id }))?.originalNeed).toBe(thread.originalNeed)
  })

  test('denies a gate-removed owner and a deleting thread', async () => {
    const { t, owner, thread } = await setup()
    await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: false })
    await expect(owner.mutation(api.learnAdaptive.setIntent, { threadId: thread.id, intent: 'prepare', expectedRevision: 1, idempotencyKey: 'intent-gate-denied01' })).rejects.toThrow(/access denied/i)
    await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
    await t.run(ctx => ctx.db.patch(thread.id, { deletionStartedAt: 1 }))
    await expect(owner.mutation(api.learnAdaptive.setIntent, { threadId: thread.id, intent: 'prepare', expectedRevision: 1, idempotencyKey: 'intent-deleting-0001' })).rejects.toThrow(/deletion is in progress/i)
  })
})
