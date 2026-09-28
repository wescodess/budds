/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|recovery-owner' }
const OTHER = { tokenIdentifier: 'https://auth.example.com|recovery-other' }
const originalFlag = process.env.LEARN_V2_ENABLED
beforeEach(() => { process.env.LEARN_V2_ENABLED = 'true' })
afterAll(() => { if (originalFlag === undefined) delete process.env.LEARN_V2_ENABLED; else process.env.LEARN_V2_ENABLED = originalFlag })

async function fixture(intent: 'refresh' | 'understand' = 'refresh', sourceKind: 'pasted' | 'folder' = 'pasted') {
  const t = convexTest(schema, modules)
  for (const identity of [OWNER, OTHER]) {
    const actor = t.withIdentity(identity)
    await actor.mutation(api.users.upsertUser, {})
    await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
    await actor.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  }
  const owner = t.withIdentity(OWNER)
  const other = t.withIdentity(OTHER)
  const folderId = sourceKind === 'folder' ? await owner.mutation(api.folders.createFolder, { name: 'Diagnostic source' }) : null
  const created = await owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, {
    need: 'Help me prepare while my evidence loads.', outcome: 'State what I already know.', intent,
    availableTime: '15', sourceScope: folderId ? { kind: 'folder', folderId } : { kind: 'pasted', contentDigest: `sha256:${'a'.repeat(64)}`, byteCount: 128 },
    idempotencyKey: `recovery-create-${intent}`,
  })
  if (created.kind !== 'created') throw new Error('draft not created')
  const prepared = await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId: created.thread.id, expectedRevision: 1, idempotencyKey: `recovery-prepare-${intent}` })
  if (prepared.kind !== 'ok' || prepared.value.status !== 'not_required') throw new Error('initial decision not prepared')
  return { t, owner, other, threadId: created.thread.id, folderId }
}

describe('standalone diagnostic continuation', () => {
  test('commits and replays a provider-free diagnostic for Refresh while evidence prepares', async () => {
    const { t, owner, other, threadId } = await fixture()
    const args = { threadId, expectedRevision: 2, idempotencyKey: 'recovery-continue-001' }
    const first = await owner.mutation(api.learnAdaptiveRecovery.continueDraft, args)
    expect(first).toMatchObject({ kind: 'ok', revision: 3, value: { status: 'eligible' } })
    expect(await owner.mutation(api.learnAdaptiveRecovery.continueDraft, args)).toEqual(first)
    const canvas = await owner.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId })
    expect(canvas).toMatchObject({ evidenceState: 'preparing', activity: { id: first.kind === 'ok' ? first.value.activityId : '', status: 'eligible', primitive: { type: 'diagnostic_prompt', action: 'submit_response' } } })
    expect(canvas?.activity?.primitive).toMatchObject({ props: { prompt: expect.stringContaining('already know') } })
    expect(await other.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId })).toBeNull()
    const activity = await t.run(async ctx => ctx.db.get((await ctx.db.get(threadId))!.currentActivityId!))
    expect(activity).toMatchObject({ activityClass: 'non_factual', evaluationContract: { kind: 'learner_response' }, evidenceReferences: [], learningVoidId: null, sessionContentId: null })
    expect(await t.run(ctx => ctx.db.query('learnJobs').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(2))).toEqual([])
    const started = await t.run(ctx => ctx.db.query('learnActivityEvents').withIndex('by_userId_and_threadId_and_occurredAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).take(8))
    expect(started).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: 'thread_command_committed', eventVersion: 'thread_command_committed.v1', metricDefinitionVersion: 'first_value.v1', metadata: expect.objectContaining({ opportunityOrdinal: 1, firstValueEligibility: 'preparing', cohort: 'adaptive_experience_entitled' }) })]))
    const acknowledged = await owner.mutation(api.learnAdaptiveRecovery.recordDiagnosticRendered, { threadId, activityId: first.kind === 'ok' ? first.value.activityId : '' })
    expect(acknowledged).toEqual({ status: 'recorded', replayed: false })
    expect(await owner.mutation(api.learnAdaptiveRecovery.recordDiagnosticRendered, { threadId, activityId: first.kind === 'ok' ? first.value.activityId : '' })).toEqual({ status: 'recorded', replayed: true })
    const events = await t.run(ctx => ctx.db.query('learnActivityEvents').withIndex('by_userId_and_threadId_and_occurredAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).take(8))
    expect(events.filter(event => event.eventType === 'activity_started')).toHaveLength(1)
    expect(events.filter(event => event.eventType === 'meaningful_activity_started')).toEqual([expect.objectContaining({ metricDefinitionVersion: 'first_value.v1', metadata: expect.objectContaining({ opportunityOrdinal: 1 }) })])
  })

  test('saves one unscored response and keeps the same boundary through every recovery state', async () => {
    const { t, owner, other, threadId } = await fixture('understand')
    const first = await owner.mutation(api.learnAdaptiveRecovery.continueDraft, { threadId, expectedRevision: 2, idempotencyKey: 'recovery-state-start-01' })
    if (first.kind !== 'ok') throw new Error('diagnostic not committed')
    const submitArgs = { threadId, activityId: first.value.activityId, expectedRevision: 3,
      response: '  I know one part and want to test the rest.  ', idempotencyKey: 'recovery-state-answer-01' }
    const saved = await owner.mutation(api.learnAdaptiveRecovery.submitDiagnosticResponse, submitArgs)
    expect(saved).toMatchObject({ kind: 'ok', revision: 4, value: { status: 'submitted' } })
    expect(await owner.mutation(api.learnAdaptiveRecovery.submitDiagnosticResponse, submitArgs)).toEqual(saved)
    await expect(owner.mutation(api.learnAdaptiveRecovery.submitDiagnosticResponse, { ...submitArgs, idempotencyKey: 'recovery-state-answer-02', expectedRevision: 4 })).rejects.toThrow(/boundary is unavailable/i)
    await expect(other.mutation(api.learnAdaptiveRecovery.submitDiagnosticResponse, { ...submitArgs, idempotencyKey: 'recovery-foreign-answer-01' })).rejects.toThrow(/not found/i)
    for (const state of ['blocked', 'stale', 'invalidated', 'unavailable', 'ready'] as const) {
      await t.run(ctx => ctx.db.patch(threadId, { evidenceState: state }))
      const canvas = await owner.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId })
      expect(canvas).toMatchObject({ evidenceState: state, activity: { id: first.value.activityId, status: 'submitted', response: 'I know one part and want to test the rest.' } })
      expect(canvas?.recovery.body).toMatch(/source|material|support|evidence/i)
      expect(canvas?.activity?.primitive).toMatchObject({ type: 'diagnostic_prompt' })
    }
    expect(await other.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId })).toBeNull()
    expect(await t.run(ctx => ctx.db.query('learnJobs').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(2))).toEqual([])
    expect(await t.run(ctx => ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(2))).toEqual([])
    const receipts = await t.run(ctx => ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId_and_threadId', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).take(8))
    expect(JSON.stringify(receipts)).not.toContain('I know one part')
    const events = await t.run(ctx => ctx.db.query('learnActivityEvents').withIndex('by_userId_and_threadId_and_occurredAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).take(12))
    expect(events.map(event => event.eventType)).toEqual(expect.arrayContaining(['meaningful_response', 'activity_completed']))
  })

  test('uses the ready standalone denominator only for a valid ready diagnostic', async () => {
    const { t, owner, threadId } = await fixture()
    await t.run(ctx => ctx.db.patch(threadId, { evidenceState: 'ready' }))
    await owner.mutation(api.learnAdaptiveRecovery.continueDraft, { threadId, expectedRevision: 2, idempotencyKey: 'recovery-ready-start-01' })
    const events = await t.run(ctx => ctx.db.query('learnActivityEvents').withIndex('by_userId_and_threadId_and_occurredAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).take(5))
    expect(events.find(event => event.eventType === 'thread_command_committed')).toMatchObject({ metadata: { firstValueEligibility: 'ready_standalone_non_factual', opportunityOrdinal: 1 } })
  })

  test('treats a deleted selected folder as unavailable at commit without changing stored source status', async () => {
    const { t, owner, threadId, folderId } = await fixture('refresh', 'folder')
    if (!folderId) throw new Error('folder missing')
    await t.run(ctx => ctx.db.delete(folderId))
    const result = await owner.mutation(api.learnAdaptiveRecovery.continueDraft, { threadId, expectedRevision: 2, idempotencyKey: 'recovery-deleted-folder-start' })
    expect(result.kind).toBe('ok')
    const activity = await t.run(async ctx => ctx.db.get((await ctx.db.get(threadId))!.currentActivityId!))
    expect(activity).toMatchObject({ decisionInputs: { sourceState: 'unavailable' } })
    const events = await t.run(ctx => ctx.db.query('learnActivityEvents').withIndex('by_userId_and_threadId_and_occurredAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).take(5))
    expect(events.find(event => event.eventType === 'thread_command_committed')).toMatchObject({ metadata: { firstValueEligibility: 'excluded', firstValueExclusionCode: 'evidence_blocked_at_commit' } })
    expect((await t.run(ctx => ctx.db.get(threadId)))?.evidenceState).toBe('preparing')
    expect(await owner.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId })).toMatchObject({ evidenceState: 'unavailable' })
  })

  test.each(['blocked', 'stale', 'invalidated', 'unavailable'] as const)('excludes %s evidence from ready and preparing denominators', async state => {
    const { t, owner, threadId } = await fixture()
    await t.run(ctx => ctx.db.patch(threadId, { evidenceState: state }))
    await owner.mutation(api.learnAdaptiveRecovery.continueDraft, { threadId, expectedRevision: 2, idempotencyKey: `recovery-${state}-start` })
    const events = await t.run(ctx => ctx.db.query('learnActivityEvents').withIndex('by_userId_and_threadId_and_occurredAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).take(5))
    expect(events.find(event => event.eventType === 'thread_command_committed')).toMatchObject({ metadata: { firstValueEligibility: 'excluded', firstValueExclusionCode: 'evidence_blocked_at_commit', opportunityOrdinal: 1 } })
  })

  test('accepts a delayed render acknowledgement after a response was saved', async () => {
    const { t, owner, threadId } = await fixture()
    const first = await owner.mutation(api.learnAdaptiveRecovery.continueDraft, { threadId, expectedRevision: 2, idempotencyKey: 'recovery-late-ack-start' })
    if (first.kind !== 'ok') throw new Error('diagnostic not committed')
    await owner.mutation(api.learnAdaptiveRecovery.submitDiagnosticResponse, { threadId, activityId: first.value.activityId, expectedRevision: 3, response: 'My saved answer.', idempotencyKey: 'recovery-late-ack-submit' })
    expect(await owner.mutation(api.learnAdaptiveRecovery.recordDiagnosticRendered, { threadId, activityId: first.value.activityId })).toEqual({ status: 'recorded', replayed: true })
    const events = await t.run(ctx => ctx.db.query('learnActivityEvents').withIndex('by_userId_and_threadId_and_occurredAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).take(10))
    expect(events.filter(event => event.eventType === 'meaningful_activity_started')).toHaveLength(1)
    expect(events.map(event => event.eventType)).toEqual(['thread_drafted', 'thread_command_committed', 'activity_eligible', 'activity_started', 'meaningful_activity_started', 'meaningful_response', 'activity_completed'])
    expect(events[4]!.occurredAt).toBeLessThanOrEqual(events[5]!.occurredAt)
    expect((await owner.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId }))?.activity).toMatchObject({ status: 'submitted', response: 'My saved answer.' })
  })

  test('serializes competing continuations and requires the prepared initial decision', async () => {
    const { t, owner, other, threadId } = await fixture()
    await t.run(ctx => ctx.db.patch(threadId, { initialDecision: undefined }))
    await expect(owner.mutation(api.learnAdaptiveRecovery.continueDraft, { threadId, expectedRevision: 2, idempotencyKey: 'recovery-before-decision' })).rejects.toThrow(/initial clarification/i)
    const prepared = await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId, expectedRevision: 2, idempotencyKey: 'recovery-prepare-again' })
    expect(prepared).toMatchObject({ kind: 'ok', revision: 3 })
    const [first, second] = await Promise.all([
      owner.mutation(api.learnAdaptiveRecovery.continueDraft, { threadId, expectedRevision: 3, idempotencyKey: 'recovery-race-one' }),
      owner.mutation(api.learnAdaptiveRecovery.continueDraft, { threadId, expectedRevision: 3, idempotencyKey: 'recovery-race-two' }),
    ])
    expect([first.kind, second.kind].sort()).toEqual(['conflict', 'ok'])
    expect(await t.run(ctx => ctx.db.query('learningThreadActivities').withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).take(2))).toHaveLength(1)
    await expect(other.mutation(api.learnAdaptiveRecovery.continueDraft, { threadId, expectedRevision: 4, idempotencyKey: 'recovery-foreign-start' })).rejects.toThrow(/not found/i)
  })
})
