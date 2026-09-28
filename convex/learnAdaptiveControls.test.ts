/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|controls-owner' }
const OTHER = { tokenIdentifier: 'https://auth.example.com|controls-other' }
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
  const created = await owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, {
    need: 'Explain orbital motion.', outcome: 'Explain an orbit.', intent: 'refresh', availableTime: '25',
    sourceScope: { kind: 'none' }, idempotencyKey: 'controls-create-thread-0001',
  })
  if (created.kind !== 'created') throw new Error('Expected draft')
  const threadId = created.thread.id
  await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId, expectedRevision: 1, idempotencyKey: 'controls-decision-0001' })
  const continued = await owner.mutation(api.learnAdaptiveRecovery.continueDraft, { threadId, expectedRevision: 2, idempotencyKey: 'controls-continue-0001' })
  if (continued.kind !== 'ok') throw new Error('Expected diagnostic')
  return { t, owner, other: t.withIdentity(OTHER), threadId, activityId: continued.value.activityId }
}

describe('bounded learner controls', () => {
  test('saves a time preference without changing the current thread or creating a route', async () => {
    const { t, owner, threadId, activityId } = await fixture()
    const before = await t.run(ctx => ctx.db.get(threadId))
    const selected = await owner.mutation(api.learnAdaptive.applyOverride, { threadId, activityId, option: 'time_45',
      expectedRevision: 3, idempotencyKey: 'controls-deferred-time-0001' })
    expect(selected.kind).toBe('ok')
    const after = await t.run(ctx => ctx.db.get(threadId))
    expect(after?.availableTime).toBe('25')
    expect(after?.currentActivityId).toBe(before?.currentActivityId)
    expect(await t.run(ctx => ctx.db.query('learnActivityDecisions')
      .withIndex('by_userId_and_threadId_and_createdAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).take(1))).toEqual([])
  })

  test('consumes the time preference once at the completed boundary and replays the decision', async () => {
    const { t, owner, threadId, activityId } = await fixture()
    const selected = await owner.mutation(api.learnAdaptive.applyOverride, { threadId, activityId, option: 'time_45',
      expectedRevision: 3, idempotencyKey: 'controls-boundary-time-0001' })
    expect(selected.kind).toBe('ok')
    const submitted = await owner.mutation(api.learnAdaptiveRecovery.submitDiagnosticResponse, {
      threadId, activityId, expectedRevision: 4, response: 'A saved response about orbital motion.',
      idempotencyKey: 'controls-boundary-submit-0001',
    })
    expect(submitted.kind).toBe('ok')
    const decided = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId, expectedRevision: 5, idempotencyKey: 'controls-boundary-route-0001',
    })
    expect(decided).toMatchObject({ kind: 'ok', value: { status: 'recommended',
      reasonCode: 'learner_requested_time_45',
      overrideApplication: { version: 'learn-adaptive.override-application.v1', option: 'time_45',
        outcome: 'applied', applicationReason: 'applied', effectiveAvailableTime: '45' } } })
    if (decided.kind !== 'ok') throw new Error('Expected decision')
    const after = await t.run(ctx => ctx.db.get(threadId))
    expect(after?.availableTime).toBe('45')
    expect((await owner.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId }))?.activity?.response)
      .toBe('A saved response about orbital motion.')
    expect(await owner.query(api.learnAdaptiveRouting.replayDecision, { decisionId: decided.value.decisionId as never }))
      .toMatchObject({ status: 'replayed', value: decided.value })
    const exported = (await owner.query(api.dataExport.getUserDataPage, {
      collection: 'learnActivityDecisions', paginationOpts: { cursor: null, numItems: 10 },
    })).page.find(row => row._id === decided.value.decisionId) as { overrideApplication?: unknown } | undefined
    expect(exported?.overrideApplication).toEqual({ version: 'learn-adaptive.override-application.v1',
      option: 'time_45', outcome: 'applied', applicationReason: 'applied', effectiveAvailableTime: '45' })
    const exportedOverrides = (await owner.query(api.dataExport.getUserDataPage, {
      collection: 'learnActivityOverrides', paginationOpts: { cursor: null, numItems: 10 },
    })).page
    expect(exportedOverrides[0]).not.toHaveProperty('consumedDecisionId')
    expect(await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId, expectedRevision: 5, idempotencyKey: 'controls-boundary-route-0001',
    })).toEqual(decided)
    await t.run(async ctx => {
      const receipt = await ctx.db.get(decided.receiptId as never)
      if (!receipt) throw new Error('Expected decision receipt')
      await ctx.db.patch(receipt._id, { resultReference: null, resultRedactedAt: Date.now(), redactionStatus: 'redacted' })
      await ctx.db.patch(threadId, { evidenceState: 'unavailable', revision: 20 })
    })
    expect(await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId, expectedRevision: 5, idempotencyKey: 'controls-boundary-route-0001',
    })).toEqual(decided)
  })

  test('the latest same-activity preference wins while older selections remain audit history', async () => {
    const { t, owner, threadId, activityId } = await fixture()
    await owner.mutation(api.learnAdaptive.applyOverride, { threadId, activityId, option: 'time_45',
      expectedRevision: 3, idempotencyKey: 'controls-last-first-0001' })
    await owner.mutation(api.learnAdaptive.applyOverride, { threadId, activityId, option: 'time_60',
      expectedRevision: 4, idempotencyKey: 'controls-last-second-0001' })
    await owner.mutation(api.learnAdaptiveRecovery.submitDiagnosticResponse, { threadId, activityId,
      expectedRevision: 5, response: 'Keep my answer.', idempotencyKey: 'controls-last-submit-0001' })
    const decision = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId, expectedRevision: 6, idempotencyKey: 'controls-last-route-0001',
    })
    expect(decision).toMatchObject({ kind: 'ok', value: { reasonCode: 'learner_requested_time_60',
      overrideApplication: { option: 'time_60', effectiveAvailableTime: '60' } } })
    if (decision.kind !== 'ok') throw new Error('Expected decision')
    expect((await t.run(ctx => ctx.db.get(threadId)))?.availableTime).toBe('60')
    const selections = await t.run(ctx => ctx.db.query('learnActivityOverrides')
      .withIndex('by_userId_and_threadId_and_createdAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).take(3))
    expect(selections.map(row => [row.option, row.consumedDecisionId ?? null])).toEqual([
      ['time_45', null], ['time_60', decision.value.decisionId],
    ])
    expect(await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, {
      threadId, expectedRevision: 7, idempotencyKey: 'controls-last-repeat-0001',
    })).toMatchObject({ kind: 'blocked', code: 'routing_boundary_recorded' })
  })

  test('does not replay a decision if its selected output or override digest is changed', async () => {
    for (const mutation of ['output', 'digest'] as const) {
      const { t, owner, threadId, activityId } = await fixture()
      await owner.mutation(api.learnAdaptive.applyOverride, { threadId, activityId, option: 'time_45',
        expectedRevision: 3, idempotencyKey: `controls-tamper-select-${mutation}-0001` })
      await owner.mutation(api.learnAdaptiveRecovery.submitDiagnosticResponse, { threadId, activityId,
        expectedRevision: 4, response: 'Keep my response.', idempotencyKey: `controls-tamper-submit-${mutation}-0001` })
      const args = { threadId, expectedRevision: 5, idempotencyKey: `controls-tamper-route-${mutation}-0001` }
      const first = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, args)
      if (first.kind !== 'ok') throw new Error('Expected decision')
      await t.run(async ctx => {
        const receipt = await ctx.db.get(first.receiptId as never)
        const decision = await ctx.db.get(first.value.decisionId as Id<'learnActivityDecisions'>)
        if (!receipt || !decision?.overrideApplication) throw new Error('Expected durable decision')
        await ctx.db.patch(receipt._id, { resultReference: null, resultRedactedAt: Date.now(), redactionStatus: 'redacted' })
        if (mutation === 'output') await ctx.db.patch(decision._id, { reasonCode: 'source_free_diagnostic' })
        else await ctx.db.patch(decision._id, { overrideApplication: { ...decision.overrideApplication,
          inputDigest: `sha256:${'f'.repeat(64)}` } })
      })
      expect(await owner.query(api.learnAdaptiveRouting.replayDecision, { decisionId: first.value.decisionId as never }))
        .toMatchObject({ status: 'integrity_failed' })
      expect(await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, args))
        .toMatchObject({ kind: 'invalid', code: 'result_expired' })
    }
  })

  test('projects persisted Why text and closed options; records one learner selection without replacing the current response', async () => {
    const { t, owner, threadId, activityId } = await fixture()
    const before = await owner.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId })
    expect(before?.activity?.controls).toMatchObject({ reasonText: { version: 'learn-adaptive.reason-text.v1', purpose: expect.stringContaining('starting point'), text: expect.stringContaining('No source was selected') },
      options: expect.arrayContaining([
        { key: 'example', label: 'Show an example', available: false, unavailableReason: 'evidence' },
        { key: 'time_45', label: '45 minutes', available: true, unavailableReason: null },
      ]) })
    expect(await t.run(async ctx => (await ctx.db.get((await ctx.db.get(threadId))!.currentActivityId!))!.reasonText)).toEqual(before?.activity?.controls.reasonText)
    const result = await owner.mutation(api.learnAdaptive.applyOverride, { threadId, activityId, option: 'time_45', expectedRevision: 3, idempotencyKey: 'controls-time-0001' })
    expect(result).toMatchObject({ kind: 'ok', value: { option: 'time_45', source: 'learner', fixedNextPlan: {
      version: 'learn-adaptive.fixed-next-plan.v1', inputOption: 'time_45', nextActivity: 'continue_with_time', availableTime: '45', maxNewActivities: 1,
    } }, revision: 4 })
    expect(await owner.mutation(api.learnAdaptive.applyOverride, { threadId, activityId, option: 'time_45', expectedRevision: 3, idempotencyKey: 'controls-time-0001' })).toEqual(result)
    const after = await owner.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId })
    expect(after?.activity?.id).toBe(before?.activity?.id)
    expect(after?.activity?.controls?.selected).toEqual('time_45')
    expect(after?.activity?.controls?.fixedNextPlan).toEqual(result.kind === 'ok' ? result.value.fixedNextPlan : null)
    const exportedPlan = (await owner.query(api.dataExport.getUserDataPage, { collection: 'learnActivityOverrides', paginationOpts: { cursor: null, numItems: 10 } })).page[0]
    expect(exportedPlan).toMatchObject({ fixedNextPlan: result.kind === 'ok' ? result.value.fixedNextPlan : null })
    expect((await owner.query(api.learnAdaptive.getThread, { threadId }))?.thread.revision).toBe(4)
  })

  test('rejects non-owner, stale revision and disabled options without authoring a plan', async () => {
    const { t, owner, other, threadId, activityId } = await fixture()
    await expect(other.mutation(api.learnAdaptive.applyOverride, { threadId, activityId, option: 'time_45', expectedRevision: 3, idempotencyKey: 'controls-other-0001' })).rejects.toThrow('Thread not found')
    const stale = await owner.mutation(api.learnAdaptive.applyOverride, { threadId, activityId, option: 'time_45', expectedRevision: 2, idempotencyKey: 'controls-stale-0001' })
    expect(stale).toMatchObject({ kind: 'conflict', code: 'stale_revision' })
    await expect(owner.mutation(api.learnAdaptive.applyOverride, { threadId, activityId, option: 'example', expectedRevision: 3, idempotencyKey: 'controls-disabled-0001' })).rejects.toThrow('Override unavailable: evidence')
    await expect(owner.mutation(api.learnAdaptive.applyOverride, { threadId, activityId, option: 'time_45', expectedRevision: 3,
      idempotencyKey: 'controls-forged-0001', source: 'provider', score: 100 } as never)).rejects.toThrow()
    await expect(owner.mutation(api.learnAdaptive.applyOverride, { threadId, activityId, option: 'write_a_plan',
      expectedRevision: 3, idempotencyKey: 'controls-unknown-option-0001' } as never)).rejects.toThrow()
    const activityCount = await t.run(ctx => ctx.db.query('learningThreadActivities').withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).take(2))
    expect(activityCount).toHaveLength(1)
  })

  test('serializes competing choices at one revision and rejects an idempotency key reused with another option', async () => {
    const { owner, threadId, activityId } = await fixture()
    const first = await owner.mutation(api.learnAdaptive.applyOverride, { threadId, activityId, option: 'time_45', expectedRevision: 3, idempotencyKey: 'controls-race-first-0001' })
    expect(first.kind).toBe('ok')
    const competing = await owner.mutation(api.learnAdaptive.applyOverride, { threadId, activityId, option: 'time_60', expectedRevision: 3, idempotencyKey: 'controls-race-second-0001' })
    expect(competing).toMatchObject({ kind: 'conflict', code: 'stale_revision', actualRevision: 4 })
    const duplicate = await owner.mutation(api.learnAdaptive.applyOverride, { threadId, activityId, option: 'time_60', expectedRevision: 3, idempotencyKey: 'controls-race-first-0001' })
    expect(duplicate).toMatchObject({ kind: 'conflict', code: 'duplicate_key' })
    const read = await owner.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId })
    expect(read?.activity?.controls.selected).toBe('time_45')
  })

  test('feature-off owner cannot write a preference', async () => {
    const { t, owner, threadId, activityId } = await fixture()
    await t.withIdentity(OWNER).mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: false })
    await expect(owner.mutation(api.learnAdaptive.applyOverride, { threadId, activityId, option: 'time_45', expectedRevision: 3,
      idempotencyKey: 'controls-off-0001' })).rejects.toThrow(/Adaptive Learn access denied/)
  })

  test('corrupt diagnostic replay disables controls and cannot record a choice or bump revision', async () => {
    const { t, owner, threadId, activityId } = await fixture()
    await t.run(async ctx => {
      const thread = (await ctx.db.get(threadId))!
      await ctx.db.patch(thread.currentActivityId!, { inputDigest: `sha256:${'f'.repeat(64)}` })
    })
    const canvas = await owner.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId })
    expect(canvas?.status).toBe('blocked')
    expect(canvas?.activity?.controls.options.every(option => !option.available && option.unavailableReason === 'state')).toBe(true)
    await expect(owner.mutation(api.learnAdaptive.applyOverride, { threadId, activityId, option: 'time_45', expectedRevision: 3,
      idempotencyKey: 'controls-corrupt-0001' })).rejects.toThrow('Override unavailable: state')
    expect((await owner.query(api.learnAdaptive.getThread, { threadId }))?.thread.revision).toBe(3)
    expect((await owner.query(api.dataExport.getUserDataPage, { collection: 'learnActivityOverrides', paginationOpts: { cursor: null, numItems: 10 } })).page).toEqual([])
  })

  test('exports learner-only preference metadata and removes it with the thread', async () => {
    const { t, owner, threadId, activityId } = await fixture()
    await owner.mutation(api.learnAdaptive.applyOverride, { threadId, activityId, option: 'time_45', expectedRevision: 3, idempotencyKey: 'controls-export-0001' })
    const exported = await owner.query(api.dataExport.getUserDataPage, { collection: 'learnActivityOverrides', paginationOpts: { cursor: null, numItems: 10 } })
    expect(exported.page).toMatchObject([{ option: 'time_45', source: 'learner', version: 'learn-adaptive.override.v1', threadId }])
    expect(JSON.stringify(exported.page)).not.toMatch(/tokenIdentifier|response|provider|score/i)
    await owner.mutation(api.learnAdaptive.requestThreadDeletion, { threadId })
    const job = await t.run(ctx => ctx.db.query('learnAdaptiveThreadDeletionJobs').withIndex('by_userId_and_threadId', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).unique())
    expect(job).not.toBeNull()
    for (let i = 0; i < 12; i++) {
      const current = await t.run(ctx => ctx.db.get(job!._id))
      if (!current) break
      await t.mutation(internal.learnAdaptiveCommands.runThreadDeletionJob, { jobId: job!._id })
    }
    expect((await owner.query(api.dataExport.getUserDataPage, { collection: 'learnActivityOverrides', paginationOpts: { cursor: null, numItems: 10 } })).page).toEqual([])
  })
})
