/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { anyApi, makeFunctionReference, type ApiFromModules } from 'convex/server'
import { api, internal } from './_generated/api'
import { convexTest } from 'convex-test'
import { internalMutation, type MutationCtx } from './_generated/server'
import { v } from 'convex/values'
import schema from './schema'
import * as workFunctions from './learnV2MeasurementDueWork'
import * as dueWork from './lib/learnV2MeasurementDueWork'
import { enqueueLearnDueWork, LEARN_DUE_WORK_MAX_ATTEMPTS, LEARN_DUE_WORK_MAX_RECOVERY_ATTEMPTS } from './lib/learnV2DueWorkQueue'
import { assessmentDeliveryFixture, deliveryIdentity, publishDeliveryTeaching, syntheticDeliveryProtocol } from '../tests/fixtures/learn-v2-assessment-delivery'
import { learnDueCron, runLearnDueCron } from '../tests/fixtures/learn-v2-due-cron'

const policy = vi.hoisted(() => ({ protocol: null as unknown }))
vi.mock('../shared/learn-v2-measurement-storage-manifest', async original => {
  const value = await original<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...value, LEARN_MEASUREMENT_CAPABILITIES: { ...value.LEARN_MEASUREMENT_CAPABILITIES, responses: true, enrollment: true, delivery: true } }
})
vi.mock('./lib/learnV2MeasurementAssignment', async original => {
  const value = await original<typeof import('./lib/learnV2MeasurementAssignment')>()
  return { ...value, getFrozenLearnMeasurementProtocol: () => policy.protocol }
})
const START = Date.parse('2027-03-07T15:00:00Z')
const userId = deliveryIdentity.tokenIdentifier
const measurement = (anyApi as unknown as ApiFromModules<{ learnV2Measurement: typeof import('./learnV2Measurement') }>).learnV2Measurement
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); policy.protocol = syntheticDeliveryProtocol(START) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers() })

async function fixture(options: Parameters<typeof assessmentDeliveryFixture>[0] = {}) {
  const f = await assessmentDeliveryFixture(options)
  const ownerId = options.identity?.tokenIdentifier ?? userId
  await publishDeliveryTeaching(f)
  const enroll = () => f.owner.mutation(measurement.enrollProspect, { studySessionId: f.graph.studySessionId, familyId: f.begun.familyId, entryPoint: 'today' })
  const opportunities = () => f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q => q.eq('userId', ownerId)).take(8))
  const work = () => f.t.run(ctx => ctx.db.query('learnMeasurementDueWork').withIndex('by_userId', q => q.eq('userId', ownerId)).take(16))
  return { ...f, enroll, opportunities, work, ownerId }
}
const tick = async (f: Awaited<ReturnType<typeof fixture>>) => {
  const cron = learnDueCron()
  return f.t.mutation(cron.reference, cron.args)
}

async function materialized() {
  const f = await fixture()
  expect(await f.enroll()).toMatchObject({ status: 'admitted' })
  await runLearnDueCron(f.t)
  expect((await f.opportunities()).filter(row => row.horizonDays)).toHaveLength(2)
  vi.setSystemTime((await f.opportunities()).find(row => row.purpose.kind === 'measurement_cold')!.closeAt)
  await runLearnDueCron(f.t)
  return f
}

test('#569 finding 1: a cleared access block is retried and opens before closure', async () => {
  const f = await materialized()
  const slot = (await f.opportunities()).find(row => row.horizonDays === 7)!
  await f.t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: userId, enabled: false })
  vi.setSystemTime(slot.openAt)
  await runLearnDueCron(f.t)
  expect(await f.t.run(ctx => ctx.db.get(slot._id))).toMatchObject({ phase: 'preparing', operationalEligibility: 'blocked', reasonCode: 'not_admitted' })
  const pending = (await f.work()).find(row => row.key === `${slot._id}:open`)!
  expect(pending).toMatchObject({ state: 'pending', attempts: 0, domainChecks: 1 })
  expect(pending.nextAttemptAt).toBe(slot.openAt + 60_000)
  await f.t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: userId, enabled: true })
  vi.setSystemTime(pending.nextAttemptAt)
  await runLearnDueCron(f.t)
  expect(await f.t.run(ctx => ctx.db.get(slot._id))).toMatchObject({ phase: 'ready', operationalEligibility: 'eligible', eligibleAt: Date.now() })
  expect((await f.work()).some(row => row._id === pending._id)).toBe(false)
  vi.setSystemTime(slot.closeAt)
  await runLearnDueCron(f.t)
  expect(await f.t.run(ctx => ctx.db.get(slot._id))).toMatchObject({ phase: 'abandoned', reasonCode: 'missed_window' })
})

test('#569 finding 2: enrollment in the completed sweep millisecond retains its first work', async () => {
  const f = await fixture()
  expect(await tick(f)).toMatchObject({ status: 'complete' })
  expect(await f.enroll()).toMatchObject({ status: 'admitted' })
  expect(await f.work()).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'owner', dueAt: START, state: 'pending' }),
    expect.objectContaining({ kind: 'assignment', dueAt: START, state: 'pending' }),
  ]))
  vi.setSystemTime(START + 1)
  await runLearnDueCron(f.t)
  const delayed = (await f.opportunities()).filter(row => row.horizonDays)
  expect(delayed).toHaveLength(2)
  for (const row of delayed) expect(row).toMatchObject({ phase: 'preparing', operationalEligibility: 'pending' })
  expect((await f.work()).filter(row => row.state === 'pending')).toEqual([])
})

test('enrollment and its due records roll back together when their mutation fails', async () => {
  const f = await fixture()
  await expect(f.owner.mutation(async ctx => {
    const enrolled = await ctx.runMutation(measurement.enrollProspect, { studySessionId: f.graph.studySessionId,
      familyId: f.begun.familyId, entryPoint: 'today' })
    expect(enrolled).toMatchObject({ status: 'admitted' })
    expect(await ctx.db.query('learnMeasurementDueWork').withIndex('by_userId', q => q.eq('userId', userId)).take(8)).toHaveLength(4)
    throw new Error('synthetic_enrollment_failure')
  })).rejects.toThrow('synthetic_enrollment_failure')
  expect(await f.work()).toEqual([])
  expect(await f.opportunities()).toEqual([])
  expect(await f.t.run(ctx => ctx.db.query('learnMeasurementAssignments').withIndex('by_userId', q => q.eq('userId', userId)).take(2))).toEqual([])
  expect(await f.enroll()).toMatchObject({ status: 'admitted' })
  expect((await f.work()).filter(row => row.kind === 'owner' || row.kind === 'assignment')).toHaveLength(2)
})

test('an opportunity first materialized after openAt is drained in the same recovery chain', async () => {
  const f = await fixture()
  expect(await f.enroll()).toMatchObject({ status: 'admitted' })
  expect((await f.opportunities()).filter(row => row.horizonDays)).toEqual([])
  vi.setSystemTime(START + 7 * 86_400_000)
  await runLearnDueCron(f.t)
  const delayed = (await f.opportunities()).find(row => row.horizonDays === 7)!
  expect(delayed.createdAt).toBeGreaterThan(delayed.openAt)
  expect(delayed).toMatchObject({ phase: 'ready', operationalEligibility: 'eligible', eligibleAt: Date.now() })
  expect((await f.work()).filter(row => row.state === 'pending')).toEqual([])
  expect((await f.work()).find(row => row.key === `${delayed._id}:close`)).toMatchObject({ state: 'scheduled', dueAt: delayed.closeAt })
})

test('#569 finding 3: a fault in the scheduled owner mutation retains work until successful retry', async () => {
  const f = await materialized()
  const slot = (await f.opportunities()).find(row => row.horizonDays === 7)!
  vi.setSystemTime(slot.openAt)
  const failure = vi.spyOn(dueWork, 'processLearnMeasurementDueOpportunity').mockImplementationOnce(async ctx => {
    await ctx.db.patch(slot._id, { operationalEligibility: 'blocked', reasonCode: 'synthetic_fault' })
    throw new Error('synthetic_owner_mutation_failure')
  })
  await tick(f)
  const dispatched = (await f.work()).find(row => row.key === `${slot._id}:open`)!
  await f.t.finishAllScheduledFunctions(() => vi.runAllTimers())
  expect(failure).toHaveBeenCalledOnce()
  const pending = (await f.work()).find(row => row.key === `${slot._id}:open`)!
  expect(pending).toMatchObject({ state: 'pending', attempts: 1 })
  expect(await f.t.run(ctx => ctx.db.system.get(dispatched.scheduledFunctionId!))).toMatchObject({ state: { kind: 'success' } })
  expect(await f.t.run(ctx => ctx.db.get(slot._id))).toMatchObject({ phase: 'preparing', operationalEligibility: 'pending' })
  const staleArgs = { userId, workId: pending._id, generation: pending.generation }
  vi.setSystemTime(pending.nextAttemptAt - 1)
  expect(await tick(f)).toMatchObject({ scheduledLearners: 0 })
  vi.setSystemTime(pending.nextAttemptAt)
  await runLearnDueCron(f.t)
  expect((await f.work()).find(row => row._id === pending._id)).toBeUndefined()
  expect(await f.t.run(ctx => ctx.db.get(slot._id))).toMatchObject({ phase: 'ready', operationalEligibility: 'eligible' })
  const before = await f.opportunities()
  await f.t.mutation(makeFunctionReference<'mutation'>('learnV2MeasurementDueWork:processDelayedCheckWork'), staleArgs)
  expect(await f.opportunities()).toEqual(before)
})

test('a non-returning learner is materialized, opened and closed by the registered cron', async () => {
  const f = await materialized()
  for (const horizonDays of [7, 30]) {
    const slot = (await f.opportunities()).find(row => row.horizonDays === horizonDays)!
    vi.setSystemTime(slot.openAt)
    await runLearnDueCron(f.t)
    const ready = (await f.opportunities()).find(row => row._id === slot._id)!
    expect(ready).toMatchObject({ phase: 'ready', operationalEligibility: 'eligible', eligibleAt: slot.openAt })
    expect(ready.deliveryGrantId).toBeUndefined()
    vi.setSystemTime(slot.closeAt)
    await runLearnDueCron(f.t)
    expect(await f.t.run(ctx => ctx.db.get(slot._id))).toMatchObject({ phase: 'abandoned', reasonCode: 'missed_window' })
  }
  expect(await f.work()).toEqual([])
})

test('the first enabled tick after downtime drains more than one page without a population sweep', async () => {
  const f = await fixture()
  expect(await f.enroll()).toMatchObject({ status: 'admitted' })
  await f.t.run(async ctx => {
    for (let index = 0; index < 33; index++) {
      const owner = `https://due.example|backlog-${index}`
      await ctx.db.insert('learnAssessmentCatalogs', { userId: owner, storageVersion: 'learn-v2.measurement-storage.v1', createdAt: START,
        catalogRevision: 1, instrumentationEpoch: 'fixture.v1', historyCompleteness: 'prospective_complete', historyBasisVersion: 'fixture.v1',
        historyCoverageWatermark: 'fixture.v1', measurementCapability: { enabled: true } })
      await ctx.db.insert('learnMeasurementSourceWatermarks', { userId: owner, storageVersion: 'learn-v2.measurement-storage.v1', createdAt: START,
        sourceVersion: 'learn-v2.measurement-report-source.v4', sequence: 0, dueWorkThrough: null, historyCoverage: 'complete', updatedAt: START })
      await enqueueLearnDueWork(ctx, { userId: owner, key: 'owner', kind: 'owner', dueAt: START })
    }
  })
  vi.setSystemTime(START + 2 * 86_400_000)
  expect(await tick(f)).toMatchObject({ visited: 16, scheduledLearners: 16, continued: true })
  expect(await tick(f)).toMatchObject({ status: 'busy', scheduledLearners: 0 })
  await f.t.finishAllScheduledFunctions(() => vi.runAllTimers())
  const watermarks = await f.t.run(ctx => ctx.db.query('learnMeasurementSourceWatermarks').withIndex('by_createdAt', q => q.lte('createdAt', START)).take(35))
  expect(watermarks).toHaveLength(34)
  for (const row of watermarks) expect(row.dueWorkThrough).toBe(Date.now())
  const pending = await f.t.run(ctx => ctx.db.query('learnMeasurementDueWork').withIndex('by_state_and_nextAttemptAt', q => q.eq('state', 'pending')).take(40))
  expect(pending).toEqual([])
  expect((await f.opportunities()).filter(row => row.horizonDays)).toHaveLength(2)
})

test.each([false, true])('an incomplete owner scan waits without spending the fault budget: repaired=%s', async repaired => {
  const f = await materialized()
  const assignment = (await f.t.run(ctx => ctx.db.query('learnMeasurementAssignments').withIndex('by_userId', q => q.eq('userId', userId)).first()))!
  const incompleteIds = await f.t.run(async ctx => {
    const { _id: _id, _creationTime: _time, ...fields } = assignment
    const ids = []
    for (let index = 0; index < 2; index++) ids.push(await ctx.db.insert('learnMeasurementAssignments', { ...fields, assignmentKey: `missing_cold_fixture:${index}` }))
    await enqueueLearnDueWork(ctx, { userId, key: 'owner', kind: 'owner', dueAt: Date.now() })
    return ids
  })
  await runLearnDueCron(f.t)
  let pending = (await f.work()).find(row => row.kind === 'owner')!
  expect(pending).toMatchObject({ state: 'pending', attempts: 0, domainChecks: 1 })
  if (repaired) {
    await f.t.run(async ctx => { for (const id of incompleteIds) await ctx.db.delete(id) })
    vi.setSystemTime(pending.nextAttemptAt)
    await runLearnDueCron(f.t)
    expect((await f.work()).some(row => row.kind === 'owner')).toBe(false)
  } else {
    for (let attempt = 2; attempt <= LEARN_DUE_WORK_MAX_ATTEMPTS; attempt++) {
      vi.setSystemTime(pending.nextAttemptAt)
      await runLearnDueCron(f.t)
      pending = (await f.work()).find(row => row.kind === 'owner')!
      expect(pending.attempts).toBe(0)
    }
    expect(pending).toMatchObject({ state: 'pending', domainChecks: 7 })
    expect(pending.nextAttemptAt - Date.now()).toBeLessThanOrEqual(3_600_000)
  }
})

test('an access block cleared after more than two hours still opens its check', async () => {
  const f = await materialized()
  const slot = (await f.opportunities()).find(row => row.horizonDays === 7)!
  await f.t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: userId, enabled: false })
  vi.setSystemTime(slot.openAt)
  await runLearnDueCron(f.t)
  while (Date.now() < slot.openAt + 3 * 3_600_000) {
    const pending = (await f.work()).find(row => row.key === `${slot._id}:open`)!
    expect(pending).toMatchObject({ state: 'pending', attempts: 0 })
    expect(pending.nextAttemptAt - Date.now()).toBeLessThanOrEqual(3_600_000)
    vi.setSystemTime(pending.nextAttemptAt)
    await runLearnDueCron(f.t)
  }
  expect(await f.t.run(ctx => ctx.db.get(slot._id))).toMatchObject({ phase: 'preparing', reasonCode: 'not_admitted' })
  await f.t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: userId, enabled: true })
  vi.setSystemTime((await f.work()).find(row => row.key === `${slot._id}:open`)!.nextAttemptAt)
  await runLearnDueCron(f.t)
  expect(await f.t.run(ctx => ctx.db.get(slot._id))).toMatchObject({ phase: 'ready', operationalEligibility: 'eligible', eligibleAt: Date.now() })
})

test.each(['not_admitted', 'novel_item_unavailable', 'evidence_unavailable', 'catalogue'] as const)(
  'a permanent %s block closes with its actual reason and retires pending work', async block => {
    const f = await materialized()
    const slot = (await f.opportunities()).find(row => row.horizonDays === 7)!
    if (block === 'not_admitted') await f.t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: userId, enabled: false })
    else await f.t.run(async ctx => {
      if (block === 'catalogue') await ctx.db.patch(f.graph.catalogId, { measurementCapability: { enabled: false } })
      else if (block === 'evidence_unavailable') await ctx.db.patch(slot.assignmentId!, { evidenceStatus: 'evidence_unavailable' })
      else {
        if (slot.assessmentPins.kind !== 'measurement') throw new Error('Expected Measurement Item')
        await ctx.db.insert('learnAssessmentExposures', { userId, storageVersion: 'learn-v2.measurement-storage.v1', createdAt: Date.now(),
          caseId: slot.assessmentPins.itemPins.caseId, serverTime: Date.now(), purpose: 'delayed_measurement', status: 'granted',
          projectionDigest: 'fixture', deliveryReceiptHash: 'permanent_block_fixture', policyVersion: 'fixture.v1', provenanceVersion: 'fixture.v1' })
      }
    })
    vi.setSystemTime(slot.openAt)
    await runLearnDueCron(f.t)
    const reasonCode = block === 'catalogue' ? 'not_admitted' : block
    while (Date.now() < slot.closeAt) {
      const pending = (await f.work()).find(row => row.key === `${slot._id}:open`)!
      expect(pending).toMatchObject({ state: 'pending', attempts: 0 })
      expect(pending.nextAttemptAt).toBeLessThanOrEqual(slot.closeAt)
      vi.setSystemTime(pending.nextAttemptAt)
      await runLearnDueCron(f.t)
    }
    expect(await f.t.run(ctx => ctx.db.get(slot._id))).toMatchObject({ phase: 'abandoned', reasonCode })
    expect((await f.work()).filter(row => row.assessmentOpportunityId === slot._id)).toEqual([])
    const facts = await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_assessmentOpportunityId', q =>
      q.eq('userId', userId).eq('fact.assessmentOpportunityId', slot._id)).order('desc').take(1))
    expect(facts[0]?.fact).toMatchObject({ kind: 'opportunity', status: 'abandoned', reasonCode })
  },
)

test('a poisoned recovery cannot block a healthy learner and is parked after bounded failures', async () => {
  const f = await fixture()
  expect(await f.enroll()).toMatchObject({ status: 'admitted' })
  const healthy = await fixture({ test: f.t, identity: { tokenIdentifier: 'https://due.example|healthy', subject: 'healthy' } })
  expect(await healthy.enroll()).toMatchObject({ status: 'admitted' })
  await runLearnDueCron(f.t)
  const slot = (await f.opportunities()).find(row => row.horizonDays === 7)!
  const healthySlot = (await healthy.opportunities()).find(row => row.horizonDays === 7)!
  vi.setSystemTime(slot.openAt)
  await runLearnDueCron(f.t)
  const before = await f.t.run(ctx => ctx.db.get(slot._id))
  const poisoned = (await f.work()).find(row => row.key === `${slot._id}:close`)!
  await f.t.run(ctx => ctx.db.patch(poisoned._id, { attempts: LEARN_DUE_WORK_MAX_ATTEMPTS }))
  const original = dueWork.processLearnMeasurementDueOpportunity
  const failure = vi.spyOn(dueWork, 'processLearnMeasurementDueOpportunity').mockImplementation(async (ctx, assignment, protocol, row, through) => {
    if (row._id === slot._id) {
      await ctx.db.patch(row._id, { reasonCode: 'synthetic_partial_failure' })
      throw new Error('synthetic_recovery_failure')
    }
    return original(ctx, assignment, protocol, row, through)
  })
  vi.setSystemTime(slot.closeAt)
  await runLearnDueCron(f.t)
  expect(await f.t.run(ctx => ctx.db.get(healthySlot._id))).toMatchObject({ phase: 'abandoned', reasonCode: 'missed_window' })
  expect(await f.t.run(ctx => ctx.db.get(slot._id))).toEqual(before)
  let parked = (await f.work()).find(row => row._id === poisoned._id)!
  expect(parked).toMatchObject({ state: 'parked', recoveryAttempts: 1 })
  for (let attempt = 2; attempt <= LEARN_DUE_WORK_MAX_RECOVERY_ATTEMPTS; attempt++) {
    vi.setSystemTime(parked.nextAttemptAt)
    await runLearnDueCron(f.t)
    parked = (await f.work()).find(row => row._id === poisoned._id)!
    expect(parked.recoveryAttempts).toBe(attempt)
  }
  expect(parked).toMatchObject({ state: 'terminal', nextAttemptAt: Number.MAX_SAFE_INTEGER })
  expect(failure.mock.calls.filter(call => call[3]._id === slot._id)).toHaveLength(LEARN_DUE_WORK_MAX_RECOVERY_ATTEMPTS)
  vi.setSystemTime(Date.now() + 3_600_000)
  expect(await tick(f)).toMatchObject({ scheduledLearners: 0 })
  failure.mockRestore()
  await f.t.mutation(makeFunctionReference<'mutation'>('learnV2MeasurementDueWork:materializeDelayedCheckEligibility'), { userId })
  expect(await f.t.run(ctx => ctx.db.get(slot._id))).toMatchObject({ phase: 'abandoned', reasonCode: 'missed_window' })
  expect((await f.work()).some(row => row._id === poisoned._id)).toBe(false)
})

test('assignment faults preserve unopened checks and an in-progress check, then allow recovery', async () => {
  const f = await materialized()
  const slot = (await f.opportunities()).find(row => row.horizonDays === 7)!
  vi.setSystemTime(slot.openAt)
  await runLearnDueCron(f.t)
  const ready = (await f.opportunities()).find(row => row._id === slot._id)!
  if (ready.contextPins.kind !== 'session') throw new Error('Expected dedicated check')
  const sessionId = ready.contextPins.studySessionId
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: sessionId,
    expectedSessionRevision: ready.contextPins.sessionRevision, expectedContentRevision: ready.contextPins.contentRevision,
    entryPoint: 'today', idempotencyKey: 'assignment_fault_live_check' })).toMatchObject({ status: 'assessment' })
  const before = await f.opportunities()
  expect(before.find(row => row._id === slot._id)).toMatchObject({ phase: 'test_open' })
  const session = await f.t.run(ctx => ctx.db.get(sessionId))
  expect(session).toMatchObject({ status: 'in_progress' })
  await f.t.run(ctx => enqueueLearnDueWork(ctx, { userId, assignmentId: slot.assignmentId, learningVoidId: slot.learningVoidId,
    key: `assignment:${slot.assignmentId}`, kind: 'assignment', dueAt: Date.now() }))
  const failure = vi.spyOn(dueWork, 'materializeLearnMeasurementAssignment').mockRejectedValue(new Error('synthetic_assignment_failure'))
  let work = (await f.work()).find(row => row.kind === 'assignment')!
  for (let attempt = 1; attempt <= LEARN_DUE_WORK_MAX_ATTEMPTS; attempt++) {
    vi.setSystemTime(work.nextAttemptAt)
    await runLearnDueCron(f.t)
    work = (await f.work()).find(row => row.kind === 'assignment')!
    expect(work.attempts).toBe(attempt)
    expect(await f.opportunities()).toEqual(before)
    expect(await f.t.run(ctx => ctx.db.get(sessionId))).toEqual(session)
  }
  expect(work).toMatchObject({ state: 'parked', reasonCode: 'retries_exhausted' })
  expect(before.find(row => row.horizonDays === 30)!.openAt).toBeGreaterThan(Date.now())
  failure.mockRestore()
  await f.t.mutation(makeFunctionReference<'mutation'>('learnV2MeasurementDueWork:materializeDelayedCheckEligibility'), { userId })
  expect((await f.work()).find(row => row._id === work._id)).toBeUndefined()
  expect(await f.opportunities()).toEqual(before)
})

test('a later successful materialization is not fenced by a parked assignment record', async () => {
  const f = await fixture()
  expect(await f.enroll()).toMatchObject({ status: 'admitted' })
  const work = (await f.work()).find(row => row.kind === 'assignment')!
  await f.t.run(ctx => ctx.db.patch(work._id, { state: 'terminal', attempts: LEARN_DUE_WORK_MAX_ATTEMPTS, nextAttemptAt: Number.MAX_SAFE_INTEGER }))
  await f.t.mutation(makeFunctionReference<'mutation'>('learnV2MeasurementDueWork:materializeDelayedCheckEligibility'), { userId })
  expect((await f.opportunities()).filter(row => row.horizonDays)).toHaveLength(2)
  expect((await f.work()).find(row => row._id === work._id)).toBeUndefined()
})

test('registered workers never read global queue ranges or the dispatch cursor', async () => {
  const forbidden: string[] = []
  const guard = (ctx: MutationCtx): MutationCtx => ({ ...ctx, db: new Proxy(ctx.db, {
    get(target, property) {
      const method = Reflect.get(target, property)
      if (property !== 'query') return typeof method === 'function' ? (...args: unknown[]) => Reflect.apply(method, target, args) : method
      return (table: string) => {
        if (table === 'learnMeasurementDueWorkCursors') { forbidden.push(table); throw new Error('global_cursor_read') }
        const query = Reflect.apply(method, target, [table])
        if (typeof query !== 'object' || query === null) throw new Error('Query is unavailable')
        return new Proxy(query, { get(queryTarget, queryProperty) {
          const queryMethod = Reflect.get(queryTarget, queryProperty)
          if (queryProperty === 'withIndex') return (index: string, ...args: unknown[]) => {
            if (table === 'learnMeasurementDueWork' && !index.startsWith('by_userId')) { forbidden.push(index); throw new Error('global_due_read') }
            return Reflect.apply(queryMethod, queryTarget, [index, ...args])
          }
          return typeof queryMethod === 'function' ? (...args: unknown[]) => Reflect.apply(queryMethod, queryTarget, args) : queryMethod
        } })
      }
    },
  }) })
  const args = { userId: v.string(), workId: v.id('learnMeasurementDueWork'), generation: v.number(), recovering: v.optional(v.boolean()) }
  const invoke = (registration: object, ctx: MutationCtx, input: unknown) => {
    const handler = Reflect.get(registration, '_handler')
    if (typeof handler !== 'function') throw new Error('Mutation handler is unavailable')
    return Promise.resolve(Reflect.apply(handler, undefined, [guard(ctx), input])).then(() => null)
  }
  const modules = import.meta.glob('./**/*.ts')
  const t = convexTest({ schema, transactionLimits: true, modules: { ...modules, './learnV2MeasurementDueWork.ts': async () => ({ ...workFunctions,
    processDelayedCheckWork: internalMutation({ args, handler: (ctx, input) => invoke(workFunctions.processDelayedCheckWork, ctx, input) }),
    applyDelayedCheckWork: internalMutation({ args, handler: (ctx, input) => invoke(workFunctions.applyDelayedCheckWork, ctx, input) }),
  }) } })
  const f = await fixture({ test: t })
  expect(await f.enroll()).toMatchObject({ status: 'admitted' })
  await runLearnDueCron(t)
  expect(forbidden).toEqual([])
  expect((await f.work()).filter(row => row.state === 'pending')).toEqual([])
  expect((await f.opportunities()).filter(row => row.horizonDays)).toHaveLength(2)
})
