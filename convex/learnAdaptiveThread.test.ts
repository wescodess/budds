/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|thread-shell-owner' }
const OTHER = { tokenIdentifier: 'https://auth.example.com|thread-shell-other' }
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
  const owner = t.withIdentity(OWNER)
  const other = t.withIdentity(OTHER)
  const created = await owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, {
    need: 'Explain the hard part of orbital motion.', outcome: 'Explain orbital motion in my own words.', intent: 'refresh',
    availableTime: '15', sourceScope: { kind: 'none' }, idempotencyKey: 'thread-shell-draft-0001',
  })
  if (created.kind !== 'created') throw new Error('Expected draft')
  return { t, owner, other, threadId: created.thread.id }
}

describe('owner scoped adaptive thread projection', () => {
  test('restores a draft and its next move from Convex on every read', async () => {
    const { owner, threadId } = await fixture()
    const first = await owner.query(api.learnAdaptive.getThread, { threadId })
    expect(first).toMatchObject({
      ownerId: expect.any(String),
      thread: { id: threadId, outcome: 'Explain orbital motion in my own words.', intent: 'refresh',
        sourceScope: { kind: 'none' }, evidenceState: 'none', lifecycle: 'draft', revision: 1 },
      currentActivity: null, history: [],
      nextAction: { kind: 'clarify', label: 'Continue on Learn', activityId: null },
    })
    expect(await owner.query(api.learnAdaptive.getThread, { threadId })).toEqual(first)
    await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, {
      threadId, expectedRevision: 1, idempotencyKey: 'thread-shell-first-decision1',
    })
    expect(await owner.query(api.learnAdaptive.getThread, { threadId })).toMatchObject({
      nextAction: { kind: 'continue', label: 'Start diagnostic', activityId: null },
    })
  })

  test('keeps the current activity separate from at most eight prior boundaries', async () => {
    const { t, owner, threadId } = await fixture()
    const decision = await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, {
      threadId, expectedRevision: 1, idempotencyKey: 'thread-shell-decision-0001',
    })
    expect(decision.kind).toBe('ok')
    const continued = await owner.mutation(api.learnAdaptiveRecovery.continueDraft, {
      threadId, expectedRevision: 2, idempotencyKey: 'thread-shell-continue-0001',
    })
    if (continued.kind !== 'ok') throw new Error('Expected activity')
    const initial = await owner.query(api.learnAdaptive.getThread, { threadId })
    expect(initial).toMatchObject({
      thread: { lifecycle: 'active', evidenceState: 'none' },
      currentActivity: { id: continued.value.activityId, status: 'eligible', activityClass: 'non_factual' },
      nextAction: { activityId: continued.value.activityId, label: 'Save response' },
      history: [],
    })
    const activity = await t.run(async ctx => ctx.db.get((await ctx.db.get(threadId))!.currentActivityId!))
    if (!activity) throw new Error('Expected stored activity')
    const { _id: _activityId, _creationTime: _activityCreatedAt, ...activityFields } = activity
    await t.run(async ctx => {
      for (let ordinal = 2; ordinal <= 12; ordinal++) {
        const id = await ctx.db.insert('learningThreadActivities', {
          ...activityFields,
          activityId: `activity-${ordinal}`, boundaryOrdinal: ordinal, status: ordinal === 12 ? 'eligible' : 'replaced',
          purpose: `Purpose ${ordinal}`, createdAt: ordinal, updatedAt: ordinal,
        } as never)
        if (ordinal === 12) await ctx.db.patch(threadId, { currentActivityId: id, revision: 4 })
      }
    })
    const restored = await owner.query(api.learnAdaptive.getThread, { threadId })
    expect(restored?.currentActivity).toMatchObject({ id: 'activity-12', purpose: 'Purpose 12' })
    expect(restored?.history.map(item => item.id)).toEqual([
      'activity-11', 'activity-10', 'activity-9', 'activity-8', 'activity-7', 'activity-6', 'activity-5', 'activity-4',
    ])
    expect(await owner.query(api.learnAdaptive.getThread, { threadId })).toEqual(restored)
  })

  test('reports a saved standalone answer as saved rather than being scored', async () => {
    const { owner, threadId } = await fixture()
    await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, {
      threadId, expectedRevision: 1, idempotencyKey: 'thread-shell-save-decision1',
    })
    const continued = await owner.mutation(api.learnAdaptiveRecovery.continueDraft, {
      threadId, expectedRevision: 2, idempotencyKey: 'thread-shell-save-start001',
    })
    if (continued.kind !== 'ok') throw new Error('Expected activity')
    await owner.mutation(api.learnAdaptiveRecovery.submitDiagnosticResponse, {
      threadId, activityId: continued.value.activityId, expectedRevision: 3,
      response: 'I think gravity keeps the orbit curving.', idempotencyKey: 'thread-shell-save-response1',
    })
    const restored = await owner.query(api.learnAdaptive.getThread, { threadId })
    expect(restored).toMatchObject({
      currentActivity: { status: 'submitted' },
      nextAction: { kind: 'review_saved_response', label: 'Your response is saved', activityId: continued.value.activityId },
    })
  })

  test('returns no thread data for another owner, an unknown ID, or feature off', async () => {
    const { t, owner, other, threadId } = await fixture()
    expect(await other.query(api.learnAdaptive.getThread, { threadId })).toBeNull()
    const unknownId = await t.run(ctx => ctx.db.insert('learningThreads', {
      userId: OTHER.tokenIdentifier, originalNeed: 'Another thread', intent: 'explore', availableTime: '15',
      authorityKind: 'standalone', sourceScope: { kind: 'none' }, evidenceState: 'none', lifecycle: 'draft',
      revision: 1, createdAt: 1, updatedAt: 1,
    }))
    expect(await owner.query(api.learnAdaptive.getThread, { threadId: unknownId })).toBeNull()
    await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: false })
    await expect(owner.query(api.learnAdaptive.getThread, { threadId })).rejects.toThrow(/access denied/i)
  })
})
