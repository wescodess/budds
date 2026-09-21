/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|clarification-owner' }
const OTHER = { tokenIdentifier: 'https://auth.example.com|clarification-other' }
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
  return { t, owner: t.withIdentity(OWNER), other: t.withIdentity(OTHER) }
}

async function createDraft(owner: ReturnType<Awaited<ReturnType<typeof setup>>['t']['withIdentity']>, input: { intent: 'understand' | 'prepare' | 'build', outcome?: string, key: string }) {
  const result = await owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, {
    need: 'Prepare me to explain this system safely.',
    ...(input.outcome ? { outcome: input.outcome } : {}),
    intent: input.intent,
    availableTime: '15',
    sourceScope: { kind: 'none' },
    idempotencyKey: input.key,
  })
  if (result.kind !== 'created') throw new Error('expected created thread')
  return result.thread
}

describe('initial clarification authority', () => {
  test('prepares at most one useful-outcome clarification and preserves original wording', async () => {
    const { t, owner } = await setup()
    const thread = await createDraft(owner, { intent: 'prepare', key: 'create-clarify-thread-01' })
    const args = { threadId: thread.id, expectedRevision: 1, idempotencyKey: 'test-aaaaaaaaaaaa-01' }
    const prepared = await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, args)
    expect(prepared).toMatchObject({ kind: 'ok', revision: 2, value: { status: 'pending', question: { key: 'useful_outcome', prompt: expect.stringContaining('outcome') }, continuationKind: 'standalone_non_factual' } })
    expect(JSON.stringify(prepared)).not.toContain(thread.originalNeed)
    expect(await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, args)).toEqual(prepared)
    const projection = await owner.query(api.learnAdaptiveClarifications.getInitialDecision, { threadId: thread.id })
    expect(projection).toMatchObject({ status: 'pending', originalNeed: thread.originalNeed, question: { key: 'useful_outcome' } })
    const durable = await t.run(async ctx => ({
      thread: await ctx.db.get(thread.id),
      events: await ctx.db.query('learnActivityEvents').withIndex('by_userId_and_threadId_and_occurredAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', thread.id)).take(8),
      activities: await ctx.db.query('learningThreadActivities').withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', thread.id)).take(8),
      jobs: await ctx.db.query('learnJobs').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(8),
      receipts: await ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId_and_threadId', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', thread.id)).take(8),
    }))
    expect(durable.thread).toMatchObject({ originalNeed: thread.originalNeed, revision: 2, initialDecision: { status: 'pending', questionKey: 'useful_outcome' } })
    expect(durable.events).toHaveLength(1)
    expect(durable.activities).toEqual([])
    expect(durable.jobs).toEqual([])
    expect(JSON.stringify(durable.receipts)).not.toContain(thread.originalNeed)
    await t.run(ctx => ctx.db.patch(thread.id, { revision: 3, updatedAt: 3 }))
    expect(await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, args)).toEqual(prepared)
  })

  test('continues directly when declared inputs are sufficient and never writes first-value effects', async () => {
    const { t, owner } = await setup()
    const thread = await createDraft(owner, { intent: 'understand', outcome: 'Explain the mechanism in my own words.', key: 'create-direct-thread-001' })
    await expect(owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId: thread.id, expectedRevision: 1, idempotencyKey: 'prepare-direct-key-001' })).resolves.toMatchObject({
      kind: 'ok',
      revision: 2,
      value: { status: 'not_required', reasonCode: 'declared_inputs_sufficient', continuationKind: 'standalone_non_factual' },
    })
    const rows = await t.run(async ctx => ({
      activities: await ctx.db.query('learningThreadActivities').withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', thread.id)).take(2),
      attempts: await ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(2),
      events: await ctx.db.query('learnActivityEvents').withIndex('by_userId_and_threadId_and_occurredAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', thread.id)).take(4),
    }))
    expect(rows.activities).toEqual([])
    expect(rows.attempts).toEqual([])
    expect(rows.events.map(event => event.eventType)).toEqual(['thread_drafted'])
  })

  test('uses explicit provenance for new repeated outcomes and conservative equality fallback for legacy threads', async () => {
    const { t, owner } = await setup()
    const wording = 'Build a small working prototype safely.'
    const explicit = await owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, { need: wording, outcome: wording, intent: 'build', availableTime: '15', sourceScope: { kind: 'none' }, idempotencyKey: 'create-explicit-repeat-01' })
    if (explicit.kind !== 'created') throw new Error('expected explicit draft')
    await expect(owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId: explicit.thread.id, expectedRevision: 1, idempotencyKey: 'prepare-explicit-repeat1' })).resolves.toMatchObject({ value: { status: 'not_required' } })

    const legacyId = await t.run(ctx => ctx.db.insert('learningThreads', { userId: OWNER.tokenIdentifier, originalNeed: wording, outcome: wording, intent: 'build', availableTime: '15', authorityKind: 'standalone', sourceScope: { kind: 'none' }, evidenceState: 'none', lifecycle: 'draft', revision: 1, createdAt: 1, updatedAt: 1 }))
    await expect(owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId: legacyId, expectedRevision: 1, idempotencyKey: 'prepare-legacy-repeat-01' })).resolves.toMatchObject({ value: { status: 'pending', question: { key: 'useful_outcome' } } })
  })

  test('pins evidence recovery directly instead of interrupting with a clarification', async () => {
    const { t, owner } = await setup()
    const thread = await createDraft(owner, { intent: 'build', key: 'create-recovery-thread01' })
    await t.run(ctx => ctx.db.patch(thread.id, { evidenceState: 'blocked', lifecycle: 'blocked' }))
    await expect(owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId: thread.id, expectedRevision: 1, idempotencyKey: 'prepare-recovery-key01' })).resolves.toMatchObject({ value: { status: 'not_required', reasonCode: 'evidence_requires_recovery', continuationKind: 'evidence_recovery' } })
  })

  test('records one bounded answer as learner input, reuses pinned continuation, and never leaks it into receipts', async () => {
    const { t, owner } = await setup()
    const thread = await createDraft(owner, { intent: 'build', key: 'create-answer-thread-001' })
    await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId: thread.id, expectedRevision: 1, idempotencyKey: 'prepare-answer-key-001' })
    await t.run(ctx => ctx.db.patch(thread.id, { intent: 'explore', evidenceState: 'preparing', revision: 3, updatedAt: 3 }))
    const answer = 'A working checklist I can apply tomorrow.'
    const args = { threadId: thread.id, expectedRevision: 3, idempotencyKey: 'resolve-answer-key-001', resolution: { kind: 'answer' as const, answer } }
    const resolved = await owner.mutation(api.learnAdaptiveClarifications.resolveClarification, args)
    expect(resolved).toMatchObject({ kind: 'ok', revision: 4, value: { status: 'answered', continuationKind: 'standalone_non_factual' } })
    expect(JSON.stringify(resolved)).not.toContain(answer)
    expect(await owner.query(api.learnAdaptiveClarifications.getInitialDecision, { threadId: thread.id })).toMatchObject({ status: 'answered', originalNeed: thread.originalNeed, outcome: answer, continuationKind: 'standalone_non_factual' })
    const durable = await t.run(async ctx => ({
      thread: await ctx.db.get(thread.id),
      receipts: await ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId_and_threadId', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', thread.id)).take(8),
      events: await ctx.db.query('learnActivityEvents').withIndex('by_userId_and_threadId_and_occurredAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', thread.id)).take(8),
    }))
    expect(durable.thread).toMatchObject({ originalNeed: thread.originalNeed, outcome: answer, outcomeProvenance: 'clarification', initialDecision: { status: 'answered', answer } })
    expect(JSON.stringify(durable.receipts)).not.toContain(answer)
    expect(JSON.stringify(durable.events)).not.toContain(answer)
    await expect(owner.query(api.dataExport.getUserDataPage, { collection: 'learningThreads', paginationOpts: { cursor: null, numItems: 8 } })).resolves.toMatchObject({ page: [expect.objectContaining({ initialDecision: expect.objectContaining({ status: 'answered', answer }) })] })
    await t.run(ctx => ctx.db.patch(thread.id, { revision: 5, updatedAt: 5 }))
    expect(await owner.mutation(api.learnAdaptiveClarifications.resolveClarification, args)).toEqual(resolved)
    await expect(owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId: thread.id, expectedRevision: 5, idempotencyKey: 'prepare-again-key-001' })).rejects.toThrow(/already prepared/i)
  })

  test('records skip terminally and answer-vs-skip concurrency commits only one resolution', async () => {
    const { t, owner } = await setup()
    const thread = await createDraft(owner, { intent: 'prepare', key: 'create-race-thread-0001' })
    await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId: thread.id, expectedRevision: 1, idempotencyKey: 'prepare-race-key-0001' })
    const [answer, skip] = await Promise.all([
      owner.mutation(api.learnAdaptiveClarifications.resolveClarification, { threadId: thread.id, expectedRevision: 2, idempotencyKey: 'answer-race-key-00001', resolution: { kind: 'answer', answer: 'Rehearse a concise interview explanation.' } }),
      owner.mutation(api.learnAdaptiveClarifications.resolveClarification, { threadId: thread.id, expectedRevision: 2, idempotencyKey: 'skip-race-key-0000001', resolution: { kind: 'skip' } }),
    ])
    expect([answer.kind, skip.kind].sort()).toEqual(['conflict', 'ok'])
    expect((await t.run(ctx => ctx.db.get(thread.id)))?.initialDecision?.status).toMatch(/answered|skipped/)
    expect(await t.run(ctx => ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId_and_threadId', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', thread.id)).take(8))).toHaveLength(4)
  })

  test('rejects foreign, ended, deleted-source, and malformed-answer requests without a decision write', async () => {
    const { t, owner, other } = await setup()
    const thread = await createDraft(owner, { intent: 'build', key: 'create-denied-thread-01' })
    await expect(other.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId: thread.id, expectedRevision: 1, idempotencyKey: 'test-bbbbbbbbbbbb-01' })).rejects.toThrow(/not found/i)
    await t.run(ctx => ctx.db.patch(thread.id, { lifecycle: 'ended' }))
    await expect(owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId: thread.id, expectedRevision: 1, idempotencyKey: 'ended-prepare-key-001' })).rejects.toThrow(/lifecycle/i)
    await t.run(ctx => ctx.db.patch(thread.id, { lifecycle: 'draft' }))
    await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId: thread.id, expectedRevision: 1, idempotencyKey: 'test-cccccccccccc-01' })
    await expect(owner.mutation(api.learnAdaptiveClarifications.resolveClarification, { threadId: thread.id, expectedRevision: 2, idempotencyKey: 'empty-answer-key-0001', resolution: { kind: 'answer', answer: '   ' } })).rejects.toThrow(/between 1 and 1000 bytes/i)
    expect((await t.run(ctx => ctx.db.get(thread.id)))?.initialDecision?.status).toBe('pending')

    const folderId = await t.run(ctx => ctx.db.insert('folders', { userId: OWNER.tokenIdentifier, name: 'Temporary', documentCount: 0 }))
    const folderDraft = await owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, { need: 'Build safely from this folder.', intent: 'build', availableTime: '15', sourceScope: { kind: 'folder', folderId }, idempotencyKey: 'create-folder-thread-001' })
    if (folderDraft.kind !== 'created') throw new Error('expected folder draft')
    await t.run(ctx => ctx.db.delete(folderId))
    await expect(owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId: folderDraft.thread.id, expectedRevision: 1, idempotencyKey: 'deleted-source-key-001' })).rejects.toThrow(/source is unavailable/i)
    expect((await t.run(ctx => ctx.db.get(folderDraft.thread.id)))?.initialDecision).toBeUndefined()
  })

  test.each(['active', 'paused'] as const)('rejects an initial decision after the thread becomes %s', async lifecycle => {
    const { t, owner } = await setup()
    const thread = await createDraft(owner, { intent: 'prepare', key: `create-${lifecycle}-thread-01` })
    await t.run(ctx => ctx.db.patch(thread.id, { lifecycle }))
    await expect(owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId: thread.id, expectedRevision: 1, idempotencyKey: `prepare-${lifecycle}-key-01` })).rejects.toThrow(/lifecycle/i)
    expect((await t.run(ctx => ctx.db.get(thread.id)))?.initialDecision).toBeUndefined()
  })

  test('does not resolve a pending clarification after the thread becomes active', async () => {
    const { t, owner } = await setup()
    const thread = await createDraft(owner, { intent: 'prepare', key: 'create-active-resolution-01' })
    await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId: thread.id, expectedRevision: 1, idempotencyKey: 'prepare-active-resolution1' })
    await t.run(ctx => ctx.db.patch(thread.id, { lifecycle: 'active' }))
    await expect(owner.mutation(api.learnAdaptiveClarifications.resolveClarification, { threadId: thread.id, expectedRevision: 2, idempotencyKey: 'resolve-active-resolution1', resolution: { kind: 'skip' } })).rejects.toThrow(/lifecycle/i)
    expect((await t.run(ctx => ctx.db.get(thread.id)))?.initialDecision?.status).toBe('pending')
  })

  test('rejects preparation when an activity already exists even if the lifecycle is stale', async () => {
    const { t, owner } = await setup()
    const thread = await createDraft(owner, { intent: 'prepare', key: 'create-history-thread-01' })
    const committed = await owner.mutation(internal.learnAdaptiveActivities.commitActivityPlan, {
      threadId: thread.id,
      expectedRevision: 1,
      idempotencyKey: 'commit-history-plan-01',
      activityId: 'historical-activity-01',
      boundaryOrdinal: 1,
      planRevision: 1,
      activityClass: 'non_factual',
      intent: 'prepare',
      objectiveId: null,
      purpose: 'Begin from the declared need.',
      reasonCode: 'standalone_first_move',
      primitiveSequence: [{ type: 'diagnostic_prompt', action: 'submit_response', props: { prompt: 'What should we practice?', responseFormat: 'short_text', assistance: 'none' } }],
      requiredAction: { kind: 'submit_response', label: 'Continue' },
      evaluationContract: { version: 'learn-adaptive.evaluation.v1', kind: 'learner_response', responseFormat: 'short_text', passingScorePercent: null },
      accessibilityMetadata: { heading: 'First move', instructions: 'Answer the prompt.', focusTargetTestId: 'first-move', liveRegionMode: 'polite' },
      learningVoidId: null,
      blueprintRevisionId: null,
      sessionContentId: null,
      evidenceReferences: [],
      decisionInputs: { routerVersion: 'learn-adaptive.router.v1', availableTime: '15', sourceState: 'none', priorActivityId: null, priorAttemptId: null, priorOutcome: null, assistance: 'none', confidence: null },
    })
    expect(committed.kind).toBe('ok')
    await t.run(ctx => ctx.db.patch(thread.id, { lifecycle: 'draft' }))
    await expect(owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId: thread.id, expectedRevision: 2, idempotencyKey: 'prepare-after-history-01' })).rejects.toThrow(/first activity/i)
  })

  test('serializes concurrent prepare commands to one immutable initial decision', async () => {
    const { t, owner } = await setup()
    const thread = await createDraft(owner, { intent: 'prepare', key: 'create-prepare-race-001' })
    const [first, second] = await Promise.all([
      owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId: thread.id, expectedRevision: 1, idempotencyKey: 'prepare-race-first-001' }),
      owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId: thread.id, expectedRevision: 1, idempotencyKey: 'prepare-race-second-01' }),
    ])
    expect([first.kind, second.kind].sort()).toEqual(['conflict', 'ok'])
    expect((await t.run(ctx => ctx.db.get(thread.id)))?.initialDecision).toMatchObject({ status: 'pending', inputSnapshot: { threadRevision: 1 } })
  })
})
