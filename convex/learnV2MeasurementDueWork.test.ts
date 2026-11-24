/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { anyApi, makeFunctionReference, type ApiFromModules } from 'convex/server'
import { internal } from './_generated/api'
import * as dueWork from './lib/learnV2MeasurementDueWork'
import { enqueueLearnDueWork, LEARN_DUE_WORK_MAX_ATTEMPTS, LEARN_DUE_WORK_LEASE_MS } from './lib/learnV2DueWorkQueue'
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

async function fixture() {
  const f = await assessmentDeliveryFixture()
  await publishDeliveryTeaching(f)
  const enroll = () => f.owner.mutation(measurement.enrollProspect, { studySessionId: f.graph.studySessionId, familyId: f.begun.familyId, entryPoint: 'today' })
  const opportunities = () => f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q => q.eq('userId', userId)).take(8))
  const work = () => f.t.run(ctx => ctx.db.query('learnMeasurementDueWork').withIndex('by_userId', q => q.eq('userId', userId)).take(16))
  return { ...f, enroll, opportunities, work }
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
  expect(pending).toMatchObject({ state: 'pending', attempts: 1 })
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
  const failure = vi.spyOn(dueWork, 'materializeLearnMeasurementAssignment').mockImplementationOnce(async ctx => {
    await ctx.db.patch(slot._id, { operationalEligibility: 'blocked', reasonCode: 'synthetic_fault' })
    throw new Error('synthetic_owner_mutation_failure')
  })
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  await runLearnDueCron(f.t)
  expect(failure).toHaveBeenCalledOnce()
  const pending = (await f.work()).find(row => row.key === `${slot._id}:open`)!
  expect(pending).toMatchObject({ state: 'pending', attempts: 1 })
  expect(await f.t.run(ctx => ctx.db.system.get(pending.scheduledFunctionId!))).toMatchObject({ state: { kind: 'failed' } })
  expect(await f.t.run(ctx => ctx.db.get(slot._id))).toMatchObject({ phase: 'preparing', operationalEligibility: 'pending' })
  expect(errors).toHaveBeenCalled()
  const staleArgs = { userId, workId: pending._id, generation: pending.generation }
  vi.setSystemTime(slot.openAt + LEARN_DUE_WORK_LEASE_MS - 1)
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

test('exhausted scheduled mutations leave a terminal record and cancel a check without a learner miss', async () => {
  const f = await materialized()
  const slot = (await f.opportunities()).find(row => row.horizonDays === 7)!
  vi.setSystemTime(slot.openAt)
  await runLearnDueCron(f.t)
  const ready = (await f.opportunities()).find(row => row._id === slot._id)!
  expect(ready.contextPins.kind).toBe('session')
  vi.setSystemTime(slot.closeAt)
  vi.spyOn(dueWork, 'materializeLearnMeasurementAssignment').mockRejectedValue(new Error('synthetic_owner_mutation_failure'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  for (let attempt = 1; attempt <= LEARN_DUE_WORK_MAX_ATTEMPTS; attempt++) {
    await runLearnDueCron(f.t)
    const pending = (await f.work()).find(row => row.key === `${slot._id}:close`)!
    expect(pending).toMatchObject({ state: 'pending', attempts: attempt })
    expect(pending.nextAttemptAt).toBeGreaterThan(Date.now())
    vi.setSystemTime(pending.nextAttemptAt)
  }
  await runLearnDueCron(f.t)
  const terminal = (await f.work()).find(row => row.key === `${slot._id}:close`)!
  expect(terminal).toMatchObject({ state: 'terminal', attempts: LEARN_DUE_WORK_MAX_ATTEMPTS, reasonCode: 'retries_exhausted' })
  expect(await f.t.run(ctx => ctx.db.get(slot._id))).toMatchObject({ phase: 'abandoned', reasonCode: 'system_due_work_late' })
  if (ready.contextPins.kind !== 'session') throw new Error('Expected check binding')
  const sessionId = ready.contextPins.studySessionId
  const closed = await f.t.run(ctx => ctx.db.get(sessionId))
  expect(closed).toMatchObject({ status: 'cancelled', auditReasonCode: 'system_due_work_late' })
  expect(closed).not.toHaveProperty('missedAt')
  vi.setSystemTime(Date.now() + 60_000)
  expect(await tick(f)).toMatchObject({ scheduledLearners: 0 })
})
