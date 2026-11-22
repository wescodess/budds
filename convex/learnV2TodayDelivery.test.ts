/// <reference types="vite/client" />
import { anyApi, type ApiFromModules } from 'convex/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import { deterministicLearnScoringReceipt } from './lib/learnV2MeasurementScoring'
import { createLearnScorerRegistry, sealLearnScorerConfiguration } from './lib/learnV2ScorerConfig'
import { privacyDigest } from './lib/learnV2ResponsePrivacy'
import { LEARN_V2_PUBLIC_API_VERSION } from './lib/learnV2PublicContract'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION, type LearnResponsePayload } from '../shared/learn-v2-responses'
import { assessmentDeliveryFixture, deliveryIdentity, publishDeliveryTeaching, syntheticDeliveryProtocol } from '../tests/fixtures/learn-v2-assessment-delivery'

const mastery = (anyApi as unknown as ApiFromModules<{ learnV2Mastery: typeof import('./learnV2Mastery') }>).learnV2Mastery
const policy = vi.hoisted(() => ({ responses: true, enrollment: true, protocol: null as unknown, scorer: null as unknown }))
vi.mock('../shared/learn-v2-measurement-storage-manifest', async original => {
  const value = await original<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...value, LEARN_MEASUREMENT_CAPABILITIES: { ...value.LEARN_MEASUREMENT_CAPABILITIES, scoring: true,
    get responses() { return policy.responses }, get enrollment() { return policy.enrollment } } }
})
vi.mock('./lib/learnV2MeasurementAssignment', async original => {
  const value = await original<typeof import('./lib/learnV2MeasurementAssignment')>()
  return { ...value, getFrozenLearnMeasurementProtocol: () => policy.protocol }
})
vi.mock('./lib/learnV2MeasurementScorerInventory', () => ({ getLearnMeasurementScorer: async () => policy.scorer }))

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(Date.parse('2027-03-07T15:00:00Z'))
  policy.responses = true; policy.enrollment = true; policy.protocol = syntheticDeliveryProtocol(); policy.scorer = null
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers() })

async function fixture(options: Parameters<typeof assessmentDeliveryFixture>[0] = {}) {
  const f = await assessmentDeliveryFixture(options)
  const contentId = await publishDeliveryTeaching(f)
  const request = { studySessionId: f.graph.studySessionId, expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'today_start_command' }
  async function open(entryPoint: 'today' | 'session_deep_link' = 'today') {
    const started = await f.owner.mutation(api.learnV2SessionContent.startStudySession, { ...request, entryPoint })
    expect(started.status).toBe('assessment')
    const row = await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q => q.eq('userId', deliveryIdentity.tokenIdentifier)).unique())
    if (!row?.deliveryGrantId) throw new Error('Expected cold delivery')
    return row
  }
  async function seal(payload: LearnResponsePayload = { kind: 'numeric', value: 0, unit: 'members' }) {
    const opportunity = await open()
    const accepted = await f.owner.mutation(mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
      idempotencyKey: 'today_accept_command', response: { target: { assessmentOpportunityId: opportunity._id }, expectedRevision: opportunity.revision,
        payload } } })
    if (accepted.kind !== 'accepted') throw new Error(`Expected seal: ${JSON.stringify(accepted)}`)
    return { opportunity, accepted }
  }
  async function pending() {
    const sealed = await seal()
    const command = { tokenIdentifier: deliveryIdentity.tokenIdentifier, submissionId: sealed.accepted.submissionId }
    const reserved = await f.owner.mutation(mastery.beginSealedMasteryScoring, command)
    if (reserved.kind !== 'acquired') throw new Error('Expected scoring lease')
    const input = await f.owner.query(mastery.getSealedMasteryScoringInput, command)
    const receipt = await deterministicLearnScoringReceipt(input, { dispatchedAt: Date.now(), dispatchOrdinal: 1, leaseIdentityHash: await privacyDigest(reserved.leaseToken) })
    const executionId = await f.owner.mutation(mastery.registerSealedMasteryScoring, { ...command, receiptJson: JSON.stringify(receipt) })
    return { ...sealed, command, reserved, executionId }
  }
  return { ...f, contentId, request, open, seal, pending }
}

test.each(['no_grant', 'open', 'sealed', 'pending', 'scored', 'revoked'] as const)('both Today entry points enforce the %s disclosure boundary', async state => {
  const f = await fixture()
  if (state === 'open' || state === 'revoked') await f.open()
  if (state === 'sealed') await f.seal()
  if (state === 'pending') await f.pending()
  if (state === 'scored') {
    const pending = await f.pending()
    await f.owner.mutation(mastery.commitSealedMasteryAttempt, { ...pending.command, executionId: pending.executionId })
  }
  if (state === 'revoked') await f.t.run(ctx => ctx.db.patch(f.graph.sourceSnapshotId, { evidencePurgedAt: Date.now() }))
  const today = await f.owner.query(api.learnV2Today.getToday, {})
  const content = await f.owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: f.graph.studySessionId })
  const delivery = await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.graph.studySessionId, idempotencyKey: 'today_content_delivery' })
  for (const [index, result] of [today, content, delivery].entries()) {
    const serialized = JSON.stringify(result)
    for (const canary of ['PRIVATE-SOLUTION', 'PRIVATE-ORDINARY-RUBRIC', 'scoringSpecDigest', 'supportManifestDigest']) expect(serialized).not.toContain(canary)
    if (index < 2 || !['sealed', 'pending', 'scored'].includes(state)) for (const canary of ['TEACHING-CANARY', 'TEACHING-CLAIM-CANARY']) expect(serialized).not.toContain(canary)
    if (state === 'no_grant' || state === 'revoked') expect(serialized).not.toContain('Hypothetical')
  }
  expect(JSON.stringify(today)).not.toContain('Hypothetical')
  if (['sealed', 'pending', 'scored'].includes(state)) expect(JSON.stringify(content)).toContain('"value":0')
  if (state === 'pending') {
    expect(JSON.stringify(content)).toContain('scoring_pending')
    expect(JSON.stringify(content)).not.toContain('scorePercent')
    expect(JSON.stringify(content)).not.toContain('feedbackCodes')
  }
})

test('cold disclosure is shared by navigation, direct links, cross-tab starts and lost responses', async () => {
  const f = await fixture()
  const first = await f.open('session_deep_link')
  const retries = await Promise.all(['today', 'session_deep_link'].map(entryPoint => f.owner.mutation(api.learnV2SessionContent.startStudySession,
    { ...f.request, entryPoint: entryPoint as 'today' | 'session_deep_link', idempotencyKey: `cross_tab_${entryPoint}` })))
  for (const result of retries) expect(result).toMatchObject({ status: 'assessment', deliveryGrant: { deliveryGrantId: first.deliveryGrantId } })
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').take(8))).toHaveLength(1)
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(8))).toHaveLength(1)
  expect(await f.t.run(ctx => ctx.db.query('learnMeasurementAssignments').unique())).toMatchObject({ entryPoint: 'session_deep_link', flow: 'v2_today' })
  await expect(f.owner.mutation(api.learnV2SessionContent.retrySessionContentGeneration, { studySessionId: f.graph.studySessionId,
    expectedSessionRevision: 2, idempotencyKey: 'no_reroll_after_grant' })).rejects.toThrow('Assessment generation cannot be retried')
  expect(await f.owner.query(api.learnV2Assessments.getAssessment, { version: LEARN_V2_PUBLIC_API_VERSION, assessmentOpportunityId: first._id })).toMatchObject({ status: 'delivered' })
})

test('sealing permits separate-case teaching before scoring, with one exposure and frozen assistance', async () => {
  const f = await fixture()
  const sealed = await f.seal()
  const started = await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)
  expect(started.status).toBe('in_progress')
  await expect(f.owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: f.graph.studySessionId })).rejects.toMatchObject({ data: { code: 'help_delivery_required' } })
  const content = await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.graph.studySessionId, idempotencyKey: 'post_seal_teaching_delivery' })
  expect(JSON.stringify(content)).toContain('TEACHING-CANARY-explanation')
  expect(JSON.stringify(content)).not.toContain('PRIVATE-ORDINARY-RUBRIC')
  expect(JSON.stringify(content)).not.toContain('PRIVATE-SOLUTION')
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)).toEqual(started)
  const saved = await f.t.run(ctx => ctx.db.get(sealed.accepted.submissionId))
  expect(saved?.assistanceSnapshot).toMatchObject({ state: 'unassisted' })
  const exposures = await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(16))
  expect(exposures.filter(row => row.purpose === 'teaching')).toHaveLength(1)
  expect(await f.t.run(ctx => ctx.db.query('masteryAttempts').take(8))).toHaveLength(0)
})

test('missing protocol and unavailable inventory never fall back to a lesson', async () => {
  const f = await fixture()
  policy.protocol = null
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)).toMatchObject({ status: 'assessment', deliveryGrant: null })
  policy.protocol = syntheticDeliveryProtocol()
  await f.t.run(ctx => ctx.db.patch(f.begun.familyId, { status: 'quarantined' }))
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)).toMatchObject({ status: 'assessment', deliveryGrant: null })
  expect(await f.t.run(ctx => ctx.db.query('learnMeasurementAssignments').unique())).toMatchObject({ status: 'not_admitted' })
  expect(JSON.stringify(await f.owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: f.graph.studySessionId }))).not.toContain('TEACHING-CANARY')
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(8))).toHaveLength(0)
})
