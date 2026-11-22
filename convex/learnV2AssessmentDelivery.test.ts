/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { anyApi, type ApiFromModules } from 'convex/server'
import { api } from './_generated/api'
import { LEARN_V2_PUBLIC_API_VERSION } from './lib/learnV2PublicContract'
import { assessmentDeliveryFixture, deliveryIdentity, syntheticDeliveryProtocol } from '../tests/fixtures/learn-v2-assessment-delivery'

const policy = vi.hoisted(() => ({ responses: true, protocol: null as unknown }))
const measurement = (anyApi as unknown as ApiFromModules<{ learnV2Measurement: typeof import('./learnV2Measurement') }>).learnV2Measurement
vi.mock('../shared/learn-v2-measurement-storage-manifest', async original => {
  const value = await original<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...value, LEARN_MEASUREMENT_CAPABILITIES: { ...value.LEARN_MEASUREMENT_CAPABILITIES, enrollment: true,
    get responses() { return policy.responses } } }
})
vi.mock('./lib/learnV2MeasurementAssignment', async original => {
  const value = await original<typeof import('./lib/learnV2MeasurementAssignment')>()
  return { ...value, getFrozenLearnMeasurementProtocol: () => policy.protocol }
})

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(Date.parse('2027-03-07T15:00:00Z'))
  policy.responses = true; policy.protocol = syntheticDeliveryProtocol()
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers() })

async function fixture() {
  const f = await assessmentDeliveryFixture()
  const enrolled = await f.owner.mutation(measurement.enrollProspect, {
    studySessionId: f.graph.studySessionId, familyId: f.begun.familyId, entryPoint: 'today',
  })
  if (!enrolled.assignmentId || enrolled.status !== 'admitted') throw new Error(`Enrollment unavailable: ${JSON.stringify(enrolled)}`)
  const opportunity = await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities')
    .withIndex('by_userId_and_assignmentId_and_horizonDays', q => q.eq('userId', deliveryIdentity.tokenIdentifier).eq('assignmentId', enrolled.assignmentId!).eq('horizonDays', undefined)).unique())
  if (!opportunity) throw new Error('Cold opportunity unavailable')
  const reference = { version: LEARN_V2_PUBLIC_API_VERSION, assessmentOpportunityId: opportunity._id }
  const request = { ...reference, expectedRevision: opportunity.revision, idempotencyKey: 'assessment_first_grant' }
  return { ...f, opportunity, reference, request }
}

test('readiness is metadata-only; a lost grant and another tab recover exactly one item', async () => {
  const f = await fixture()
  expect(await f.owner.query(api.learnV2Assessments.getAssessment, f.reference)).toEqual({ status: 'unavailable', version: 'learn-v2.assessment-disclosure.v1', reasonCode: 'not_delivered' })
  expect(await f.owner.query(api.learnV2Assessments.getAssessmentState, f.reference)).toMatchObject({ status: 'available', phase: 'ready', capabilities: { canDeliver: true } })
  const first = await f.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, f.request)
  expect(first).toMatchObject({ status: 'granted', revision: 2 })
  expect(await f.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, f.request)).toEqual(first)
  expect(await f.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, { ...f.request, idempotencyKey: 'assessment_another_tab' })).toEqual(first)
  const delivered = await f.owner.query(api.learnV2Assessments.getAssessment, f.reference)
  expect(delivered).toMatchObject({ status: 'delivered', phase: 'test_open', responseSpec: { kind: 'numeric' } })
  const serialized = JSON.stringify(delivered)
  for (const canary of ['PRIVATE-SOLUTION', 'PRIVATE-ORDINARY-RUBRIC', 'assessmentContract', 'scoringSpecId', 'supportManifestDigest']) expect(serialized).not.toContain(canary)
  const grants = await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').withIndex('by_userId_and_assessmentOpportunityId', q => q.eq('userId', deliveryIdentity.tokenIdentifier).eq('assessmentOpportunityId', f.opportunity._id)).take(8))
  expect(grants).toHaveLength(1)
  expect(grants[0]).toMatchObject({ provenanceVersion: 'learn-v2.assessment-delivery.today.v1', status: 'granted' })
})

test('source revocation invalidates grant replay and redisclosure without restoring consumption', async () => {
  const f = await fixture()
  expect(await f.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, f.request)).toMatchObject({ status: 'granted' })
  await f.t.run(ctx => ctx.db.patch(f.graph.sourceSnapshotId, { evidencePurgedAt: Date.now() }))
  expect(await f.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, f.request)).toMatchObject({ status: 'unavailable' })
  expect(await f.owner.query(api.learnV2Assessments.getAssessment, f.reference)).toMatchObject({ status: 'unavailable' })
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(8))).toHaveLength(1)
})

test('disabled responses, an unfrozen protocol, stale revision and expired window never grant', async () => {
  const f = await fixture()
  policy.responses = false
  expect(await f.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, f.request)).toMatchObject({ status: 'disabled' })
  policy.responses = true; policy.protocol = null
  expect(await f.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, f.request)).toMatchObject({ reasonCodes: ['protocol_not_frozen'] })
  policy.protocol = syntheticDeliveryProtocol()
  expect(await f.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, { ...f.request, expectedRevision: 4 })).toMatchObject({ reasonCodes: ['revision_conflict'] })
  vi.advanceTimersByTime(3_600_000)
  expect(await f.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, f.request)).toMatchObject({ reasonCodes: ['outside_window'] })
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(8))).toHaveLength(0)
})

test('Today cannot grant a Canvas assignment or replay a grant with different flow provenance', async () => {
  const f = await fixture()
  await f.t.run(ctx => ctx.db.patch(f.opportunity.assignmentId!, { flow: 'v2_canvas' }))
  expect(await f.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, f.request)).toMatchObject({ reasonCodes: ['flow_mismatch'] })
  await f.t.run(ctx => ctx.db.patch(f.opportunity.assignmentId!, { flow: 'v2_today' }))
  const granted = await f.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, f.request)
  if (granted.status !== 'granted') throw new Error('Expected grant')
  await f.t.run(ctx => ctx.db.patch(granted.deliveryGrantId, { provenanceVersion: 'learn-v2.assessment-delivery.canvas.v1' }))
  expect(await f.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, f.request)).toMatchObject({ reasonCodes: ['disclosure_unknown'] })
})

