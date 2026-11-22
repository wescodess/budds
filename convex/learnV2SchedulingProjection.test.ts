/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { helpConsumerFixture } from '../tests/fixtures/learn-v2-help-consumers'
import { createSchedulingPreview, schedulingCases } from '../tests/fixtures/c4-off-parity/scheduling'

const policy = vi.hoisted(() => ({ responses: false }))
vi.mock('../shared/learn-v2-measurement-storage-manifest', async importOriginal => {
  const original = await importOriginal<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...original, LEARN_MEASUREMENT_CAPABILITIES: { ...original.LEARN_MEASUREMENT_CAPABILITIES, get responses() { return policy.responses } } }
})
const modules = import.meta.glob('./**/*.ts')
beforeEach(() => { vi.stubEnv('LEARN_V2_ENABLED', 'true'); vi.useFakeTimers(); vi.setSystemTime(Date.parse('2030-09-01T12:00:00Z')) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

test.each([false, true])('writer-valid scheduling inputs survive preview and Journey reads with responses=%s', async responses => {
  policy.responses = responses
  for (const changes of Object.values(schedulingCases)) {
    const s = await helpConsumerFixture(modules)
    await s.t.run(ctx => ctx.db.delete(s.f.rows.learnAssessmentOpportunities))
    const { id, schedulingInput } = await createSchedulingPreview(s, changes)
    const stored = (await s.t.run(ctx => ctx.db.get(id)))!
    const preview = await s.owner.query(api.learnV2Plans.getPlanPreview, { studyPlanRevisionId: id })
    expect(preview?.inputSnapshot).toBe(stored.inputSnapshot)
    expect(preview?.resultSnapshot).toBe(stored.resultSnapshot)
    const mission = await s.owner.query(api.learnV2Journey.getMission, { learningVoidId: s.f.learningVoidId })
    expect(JSON.parse(mission?.plan.preview?.inputSnapshot ?? 'null')).toEqual(schedulingInput)
    expect(JSON.parse(mission?.plan.preview?.resultSnapshot ?? 'null')).toMatchObject({ status: stored.feasibility })
  }
})

test.each([false, true])('scheduling edits and reflow preserve writer results with responses=%s', async responses => {
  policy.responses = responses
  const s = await helpConsumerFixture(modules)
  await s.t.run(ctx => ctx.db.delete(s.f.rows.learnAssessmentOpportunities))
  const initial = await createSchedulingPreview(s)
  const edit = await s.owner.mutation(api.learnV2Plans.editPlanPreview, {
    studyPlanRevisionId: initial.id, expectedPlanRecordRevision: 1, expectedVoidRevision: 5, expectedBlueprintRecordRevision: 4,
    changeReason: 'availability_changed', idempotencyKey: 'scheduling-edit', schedulingInput: { ...initial.schedulingInput, ...schedulingCases.sunday },
  })
  const id = edit._id as Id<'studyPlanRevisions'>
  const stored = (await s.t.run(ctx => ctx.db.get(id)))!
  expect((await s.owner.query(api.learnV2Plans.getPlanPreview, { studyPlanRevisionId: id }))?.inputSnapshot).toBe(stored.inputSnapshot)
  await s.owner.mutation(api.learnV2Plans.acceptPlanPreview, { studyPlanRevisionId: id, expectedVoidRevision: 5, expectedPlanRecordRevision: 1, idempotencyKey: 'scheduling-accept' })
  const active = (await s.t.run(ctx => ctx.db.get(id)))!
  const reflow = await s.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, {
    studyPlanRevisionId: id, expectedPlanRecordRevision: active.recordRevision!, idempotencyKey: 'scheduling-reflow',
  })
  const successorId = reflow.successorPlanRevisionId as Id<'studyPlanRevisions'>
  const successor = (await s.t.run(ctx => ctx.db.get(successorId)))!
  const preview = await s.owner.query(api.learnV2Plans.getPlanPreview, { studyPlanRevisionId: successorId })
  expect(preview?.inputSnapshot).toBe(successor.inputSnapshot)
  expect(preview?.resultSnapshot).toBe(successor.resultSnapshot)
  const mission = await s.owner.query(api.learnV2Journey.getMission, { learningVoidId: s.f.learningVoidId })
  expect(JSON.parse(mission?.plan.accepted?.resultSnapshot ?? 'null')).toEqual(JSON.parse(successor.resultSnapshot!))
})

test.each([false, true])('scheduling projections omit nested private fields while retaining writer data with responses=%s', async responses => {
  policy.responses = responses
  const s = await helpConsumerFixture(modules)
  const { id } = await createSchedulingPreview(s)
  const original = (await s.t.run(ctx => ctx.db.get(id)))!
  const input = JSON.parse(original.inputSnapshot!)
  const result = JSON.parse(original.resultSnapshot!)
  input.privateScoring = 'PRIVATE_SCHEDULING_CANARY'
  input.objectives[0].rubric = 'PRIVATE_SCHEDULING_CANARY'
  input.availability[0].criteria = 'PRIVATE_SCHEDULING_CANARY'
  result.privateScoring = 'PRIVATE_SCHEDULING_CANARY'
  result.placements[0].scoringPayload = 'PRIVATE_SCHEDULING_CANARY'
  result.capacity.weights = 'PRIVATE_SCHEDULING_CANARY'
  await s.t.run(ctx => ctx.db.patch(id, { inputSnapshot: JSON.stringify(input), resultSnapshot: JSON.stringify(result) }))
  const preview = await s.owner.query(api.learnV2Plans.getPlanPreview, { studyPlanRevisionId: id })
  expect(preview?.inputSnapshot).toBe(original.inputSnapshot)
  expect(preview?.resultSnapshot).toBe(original.resultSnapshot)
  expect(JSON.stringify(preview)).not.toContain('PRIVATE_SCHEDULING_CANARY')
})
