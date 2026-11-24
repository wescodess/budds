/// <reference types="vite/client" />
import { anyApi, makeFunctionReference, type ApiFromModules } from 'convex/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import { createLearnScorerRegistry, sealLearnScorerConfiguration } from './lib/learnV2ScorerConfig'
import type { Doc } from './_generated/dataModel'
import { deterministicLearnScoringReceipt } from './lib/learnV2MeasurementScoring'
import { replaceLearnMeasurementOpportunityForOwner } from './lib/learnV2MeasurementDueWork'
import { normalizedInstructionalCaseFingerprints } from './lib/learnV2ArtifactLineage'
import { privacyDigest } from './lib/learnV2ResponsePrivacy'
import { LEARN_V2_PUBLIC_API_VERSION } from './lib/learnV2PublicContract'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION, type LearnResponsePayload } from '../shared/learn-v2-responses'
import { assessmentDeliveryFixture, deliveryIdentity, publishDeliveryTeaching, syntheticDeliveryProtocol, type DeliveryTeachingShape } from '../tests/fixtures/learn-v2-assessment-delivery'
import { replaceMeasurementOpportunity } from '../tests/fixtures/learn-v2-measurement-replacement'
import { seedFixedCheckPlan } from '../tests/fixtures/learn-v2-fixed-check-plan'
import * as assessmentDelivery from './lib/learnV2AssessmentDelivery'
import * as scoringContract from '../server/utils/learn-v2-measurement-item-contract'
import { createResponsePrivacyReadContext, privacyRead } from './lib/learnV2PrivacyReadContext'
import { measurementReadContext } from './lib/learnV2MeasurementReadContext'
import { requireLearnActiveWorkPlan } from './lib/learnV2FixedChecks'
import { learnDueCron, runLearnDueCron } from '../tests/fixtures/learn-v2-due-cron'
import { LEARN_DUE_WORK_LEASE_MS } from './learnV2MeasurementDueWork'
import { enqueueLearnDueWork } from './lib/learnV2DueWorkQueue'

const measurementItems = (anyApi as unknown as ApiFromModules<{ learnV2MeasurementItems: typeof import('./learnV2MeasurementItems') }>).learnV2MeasurementItems
const mastery = (anyApi as unknown as ApiFromModules<{ learnV2Mastery: typeof import('./learnV2Mastery') }>).learnV2Mastery
const measurement = (anyApi as unknown as ApiFromModules<{ learnV2Measurement: typeof import('./learnV2Measurement') }>).learnV2Measurement
const due = makeFunctionReference<'mutation', { userId: string, through?: number }>('learnV2MeasurementDueWork:materializeDelayedCheckEligibility')
const policy = vi.hoisted(() => ({ responses: true, enrollment: true, delivery: true, protocol: null as unknown, scorer: null as unknown }))
vi.mock('../shared/learn-v2-measurement-storage-manifest', async original => {
  const value = await original<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...value, LEARN_MEASUREMENT_CAPABILITIES: { ...value.LEARN_MEASUREMENT_CAPABILITIES, scoring: true, get delivery() { return policy.delivery },
    get responses() { return policy.responses }, get enrollment() { return policy.enrollment } } }
})
vi.mock('./lib/learnV2MeasurementAssignment', async original => {
  const value = await original<typeof import('./lib/learnV2MeasurementAssignment')>()
  return { ...value, getFrozenLearnMeasurementProtocol: () => policy.protocol }
})

vi.mock('./lib/learnV2MeasurementScorerInventory', () => ({ getLearnMeasurementScorer: async () => policy.scorer }))

const userId = deliveryIdentity.tokenIdentifier
const PRIVATE = ['PRIVATE-SOLUTION', 'PRIVATE-ORDINARY-RUBRIC', 'PRIVATE-RUBRIC-CANARY', 'scoringSpecDigest', 'supportManifestDigest', 'assessmentRubricSnapshot', 'randomizationSeed']
const TEACHING = ['TEACHING-CANARY', 'TEACHING-CLAIM-CANARY']
type Entry = 'today' | 'session_deep_link'

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(Date.parse('2027-03-07T15:00:00Z'))
  policy.responses = true; policy.enrollment = true; policy.delivery = true; policy.protocol = syntheticDeliveryProtocol()
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers() })

async function fixture(options: { reserve?: boolean, reserveCount?: number, inventory?: { claims: number, supports: number, sources: number, extraSupports?: number, backingDocuments?: boolean, claimText?: string }, transactionLimits?: boolean, teaching?: DeliveryTeachingShape } = {}) {
  const definition = { configurationId: 'today.synthetic', configurationVersion: 'today.synthetic.v1', kind: 'legacy_baseline' as const,
    requestedModel: 'synthetic/model', endpoint: null, identity: { mappingVersion: 'synthetic.identity.v1', canonicalModel: 'synthetic/model',
      family: 'synthetic', snapshotAssurance: 'unknown' as const, verifiedReturnedModels: [] } }
  const saved = await sealLearnScorerConfiguration(definition)
  const registry = await createLearnScorerRegistry({ epoch: 'synthetic.epoch.v1', configurations: [{ definition, expectedDigest: saved.binding.configurationDigest }],
    legacyAllowlist: [definition.configurationId], prospectiveConfigurationId: null })
  policy.scorer = { registry, saved }
  const f = await assessmentDeliveryFixture(options)
  const contentId = await publishDeliveryTeaching(f, options.teaching)
  const request = { studySessionId: f.graph.studySessionId, expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'today_start_command' }
  const settle = <T,>(value: Promise<T>) => value.catch((error: { data?: unknown }) => ({ rejected: error.data ?? String(error) }))
  const reads = async (key = 'today_content_delivery') => ({
    today: await settle(f.owner.query(api.learnV2Today.getToday, {})),
    candidate: await settle(f.owner.query(api.learnV2Journey.getSessionCandidate, { learningVoidId: f.graph.learningVoidId, studySessionId: f.graph.studySessionId })),
    content: await settle(f.owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: f.graph.studySessionId })),
    delivery: await settle(f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.graph.studySessionId, idempotencyKey: key })),
  })
  const opportunities = () => f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q => q.eq('userId', userId)).take(16))
  const exposures = () => f.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(32))
  const cold = async () => (await opportunities()).find(row => row.purpose.kind === 'measurement_cold')!
  async function open(entryPoint: Entry = 'today') {
    const started = await f.owner.mutation(api.learnV2SessionContent.startStudySession, { ...request, entryPoint })
    expect(started).toMatchObject({ status: 'assessment', assessment: { kind: 'check' }, deliveryGrant: { status: 'granted' } })
    return await cold()
  }
  async function seal(entryPoint: Entry = 'today', payload: LearnResponsePayload = { kind: 'numeric', value: 0, unit: 'members' }) {
    const opportunity = await open(entryPoint)
    const accepted = await f.owner.mutation(mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
      idempotencyKey: 'today_accept_command', response: { target: { assessmentOpportunityId: opportunity._id }, expectedRevision: opportunity.revision, payload } } })
    if (accepted.kind !== 'accepted') throw new Error(`Expected seal: ${JSON.stringify(accepted)}`)
    return { opportunity, accepted }
  }
  async function pending(entryPoint: Entry = 'today') {
    const sealed = await seal(entryPoint)
    const command = { tokenIdentifier: userId, submissionId: sealed.accepted.submissionId }
    const reserved = await f.owner.mutation(mastery.beginSealedMasteryScoring, command)
    if (reserved.kind !== 'acquired') throw new Error('Expected scoring lease')
    const input = await f.owner.query(mastery.getSealedMasteryScoringInput, command)
    const receipt = await deterministicLearnScoringReceipt(input, { dispatchedAt: Date.now(), dispatchOrdinal: 1, leaseIdentityHash: await privacyDigest(reserved.leaseToken) })
    const executionId = await f.owner.mutation(mastery.registerSealedMasteryScoring, { ...command, receiptJson: JSON.stringify(receipt) })
    return { ...sealed, command, reserved, executionId }
  }
  return { ...f, contentId, request, reads, opportunities, exposures, cold, open, seal, pending }
}

function forms(value: unknown) {
  return new Set([...JSON.stringify(value).matchAll(/Hypothetical ([A-F]):/gu)].map(match => match[1]))
}

function ordinaryScorer() {
  const network = vi.fn(async () => new Response(JSON.stringify({ id: 'synthetic-ordinary-execution', model: 'synthetic/model',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ criterionResults: [{ key: 'accuracy', awarded: true }], misconceptionTags: [] }) } }],
    usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
    openrouter_metadata: { requested: 'synthetic/model', strategy: 'direct', attempt: 1,
      endpoints: { available: [{ provider: 'Synthetic Provider', model: 'synthetic/model', selected: true }] }, pipeline: [] } })))
  vi.stubGlobal('fetch', network)
  for (const name of ['OPENROUTER_API_KEY', 'CF_ACCOUNT_ID', 'CLOUDFLARE_AI_GATEWAY_ID']) vi.stubEnv(name, 'synthetic-unused')
  return network
}

async function openDelayedCheck(f: Awaited<ReturnType<typeof fixture>>, horizon: 7 | 30 = 7, start = true) {
  const cold = await f.seal()
  await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: cold.accepted.submissionId, idempotencyKey: 'terminal_cold_score_1234567890' })
  const day7 = (await f.opportunities()).find(row => row.horizonDays === horizon)!
  vi.setSystemTime(day7.openAt + 1000)
  await f.t.mutation(due, { userId, through: Date.now() })
  const today = await f.owner.query(api.learnV2Today.getToday, {})
  if (today.status !== 'ready') throw new Error('Expected day 7')
  if (start) await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: today.sessionId,
    expectedSessionRevision: today.sessionRevision, expectedContentRevision: today.content.revision, idempotencyKey: 'terminal_day7_start_1234567890' })
  const before = (await f.opportunities()).find(row => row._id === day7._id)!
  return { today, before }
}

async function sealDay7(f: Awaited<ReturnType<typeof fixture>>, check: Awaited<ReturnType<typeof openDelayedCheck>>, value = 0) {
  const accepted = await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: 'terminal_day7_seal_1234567890', response: { target: { assessmentOpportunityId: check.before._id }, expectedRevision: check.before.revision,
      payload: { kind: 'numeric', value, unit: 'members' } } } })
  if (accepted.kind !== 'accepted') throw new Error('Expected sealed day 7')
  return { ...check, accepted }
}

async function sealedDay7(f: Awaited<ReturnType<typeof fixture>>) {
  return await sealDay7(f, await openDelayedCheck(f))
}

function responseContextPins(response: Doc<'learnResponses'> | null) {
  if (!response || response.scopeKind !== 'v2') throw new Error('Expected a V2 response')
  return response.contextPins
}

test.each(['sealed', 'scored'] as const)('many historical %s check shells do not consume Today\'s active-session limit', async state => {
  const f = await fixture()
  const check = await sealedDay7(f)
  const sealedPins = await f.t.run(async ctx => responseContextPins(await ctx.db.get(check.accepted.submissionId)))
  if (state === 'scored') await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: check.accepted.submissionId, idempotencyKey: 'terminal_day7_score_1234567890' })
  const historical = await f.t.run(async ctx => {
    const session = (await ctx.db.get(check.today.sessionId))!
    expect(await ctx.db.get(check.accepted.submissionId)).toMatchObject({ contextPins: sealedPins })
    const { _id, _creationTime, ...fields } = session
    for (let index = 0; index < 140; index++) await ctx.db.insert('studySessions', { ...fields,
      scheduledStartAt: session.scheduledStartAt - (index + 1) * 86_400_000 })
    return session
  })
  const day30 = (await f.opportunities()).find(row => row.horizonDays === 30)!
  vi.setSystemTime(day30.openAt + 1000)
  await f.t.mutation(due, { userId, through: Date.now() })
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', assessment: { kind: 'check', state: { assessmentOpportunityId: day30._id } } })
  expect(historical).toMatchObject({ status: 'completed', revision: check.before.contextPins.kind === 'session' ? check.before.contextPins.sessionRevision : 0 })
})

test.each(['sealed', 'scored'] as const)('a completed %s check keeps a read-only recovery envelope', async phase => {
  const f = await fixture()
  const check = await sealedDay7(f)
  if (phase === 'scored') await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: check.accepted.submissionId, idempotencyKey: 'recovery_check_score_1234567890' })
  vi.setSystemTime(check.before.closeAt + 1)
  const session = (await f.t.run(ctx => ctx.db.get(check.today.sessionId)))!
  const before = await f.opportunities()
  const exposures = await f.exposures()
  const content = await f.owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: session._id })
  expect(content).toMatchObject({ assessment: { kind: 'check', state: { phase: phase === 'scored' ? 'scored_fail' : 'submitted_sealed' } },
    blocks: [], claims: [], supports: [], work: { submissionId: check.accepted.submissionId, body: { bodyAvailability: 'available', payload: { kind: 'numeric', value: 0, unit: 'members' } } } })
  expect(await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: session._id,
    idempotencyKey: 'completed_check_delivery_1234567890' })).toMatchObject({ value: content })
  for (const entryPoint of ['today', 'session_deep_link'] as const) {
    const request = { studySessionId: session._id, expectedSessionRevision: session.revision, expectedContentRevision: check.today.content.revision,
      entryPoint, idempotencyKey: `completed_check_start_${entryPoint}_1234567890` }
    const started = await f.owner.mutation(api.learnV2SessionContent.startStudySession, request)
    expect(started).toMatchObject({ status: 'assessment', deliveryGrant: null,
      assessment: { kind: 'check', state: { phase: phase === 'scored' ? 'scored_fail' : 'submitted_sealed' } } })
    expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, request)).toEqual(started)
  }
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: check.today.sessionId,
    expectedSessionRevision: check.today.sessionRevision, expectedContentRevision: check.today.content.revision,
    idempotencyKey: 'terminal_day7_start_1234567890' })).toMatchObject({ status: 'assessment', deliveryGrant: null })
  expect(await f.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, { version: LEARN_V2_PUBLIC_API_VERSION,
    assessmentOpportunityId: check.before._id, expectedRevision: before.find(row => row._id === check.before._id)!.revision,
    idempotencyKey: 'completed_check_grant_1234567890' })).toMatchObject({ status: 'unavailable' })
  expect(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: 'completed_check_resubmit_1234567890', response: { target: { assessmentOpportunityId: check.before._id },
      expectedRevision: check.before.revision, payload: { kind: 'numeric', value: 1, unit: 'members' } } } })).toMatchObject({ kind: 'rejected', reasonCode: 'already_accepted' })
  expect(await f.t.run(ctx => ctx.db.get(session._id))).toEqual(session)
  expect(await f.opportunities()).toEqual(before)
  expect(await f.exposures()).toEqual(exposures)
  await f.t.run(ctx => ctx.db.patch(session._id, { startedSessionContentRevision: session.startedSessionContentRevision! + 1 }))
  expect(await f.owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: session._id })).toBeNull()
})

test('scoring replays preserve the closure established by sealing', async () => {
  const f = await fixture()
  const check = await sealedDay7(f)
  const command = { version: LEARN_V2_PUBLIC_API_VERSION, submissionId: check.accepted.submissionId, idempotencyKey: 'closed_replay_score_1234567890' }
  await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, command)
  const session = await f.t.run(ctx => ctx.db.get(check.today.sessionId))
  const opportunity = (await f.opportunities()).find(row => row._id === check.before._id)!
  const attempt = (await f.t.run(ctx => ctx.db.get(opportunity.authoritativeAttemptId!)))!
  expect(session).toMatchObject({ status: 'completed' })
  expect(await f.owner.mutation(mastery.beginSealedMasteryScoring, { tokenIdentifier: userId,
    submissionId: check.accepted.submissionId })).toEqual({ kind: 'completed' })
  expect(await f.owner.mutation(mastery.commitSealedMasteryAttempt, { tokenIdentifier: userId,
    submissionId: check.accepted.submissionId, executionId: attempt.scoringExecutionId! })).toEqual(attempt._id)
  expect(await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: check.accepted.submissionId, idempotencyKey: 'closed_public_replay_1234567890' })).toMatchObject({ status: 'scored' })
  expect(await f.t.run(ctx => ctx.db.get(check.today.sessionId))).toEqual(session)
  expect((await f.opportunities()).find(row => row._id === opportunity._id)).toEqual(opportunity)
})

test.each(['sealed', 'scored_pass', 'scored_fail', 'expired', 'missed', 'cancelled', 'abandoned', 'scoring_limit'] as const)(
  '%s transition closes its check beside a ready day-30 check', async transition => {
    const f = await fixture()
    const check = await openDelayedCheck(f)
    if (['sealed', 'scored_pass', 'scored_fail', 'scoring_limit'].includes(transition)) {
      const pins = check.before.assessmentPins
      if (pins.kind !== 'measurement') throw new Error('Expected measurement')
      const item = (await f.t.run(ctx => ctx.db.get(pins.itemPins.itemId)))!
      const numbers = /groups=(\d+), size=(\d+)/u.exec(item.declaredStimulus!)!
      const sealed = await sealDay7(f, check, transition === 'scored_pass' ? Number(numbers[1]) * Number(numbers[2]) : 0)
      if (transition === 'scored_pass' || transition === 'scored_fail') await f.owner.action(api.learnV2Mastery.scoreMasterySubmission,
        { version: LEARN_V2_PUBLIC_API_VERSION, submissionId: sealed.accepted.submissionId, idempotencyKey: 'sweep_score_1234567890' })
      if (transition === 'scoring_limit') {
        const opportunity = (await f.opportunities()).find(row => row._id === check.before._id)!
        await f.t.run(ctx => ctx.db.patch(opportunity.scoringJobId!, { attempts: 1000 }))
        expect(await f.owner.mutation(mastery.beginSealedMasteryScoring, { tokenIdentifier: userId,
          submissionId: sealed.accepted.submissionId })).toEqual({ kind: 'blocked' })
        expect((await f.opportunities()).find(row => row._id === check.before._id)).toMatchObject({ phase: 'invalid' })
      }
      expect(await f.owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: check.today.sessionId })).toMatchObject(
        transition === 'scoring_limit' ? { assessment: { kind: 'blocked' }, work: null } : { work: { submissionId: sealed.accepted.submissionId } })
    } else if (transition === 'cancelled' || transition === 'abandoned') {
      const command = { version: LEARN_V2_PUBLIC_API_VERSION, target: { assessmentOpportunityId: check.before._id },
        expectedRevision: check.before.revision, idempotencyKey: 'sweep_terminalize_1234567890', reason: transition }
      const result = await f.owner.mutation(api.learnV2Responses.terminalizeResponse, command)
      expect(result).toMatchObject({ status: 'terminal', reason: transition })
      expect(await f.owner.mutation(api.learnV2Responses.terminalizeResponse, command)).toEqual(result)
    } else {
      vi.setSystemTime(check.before.closeAt)
      if (transition === 'missed') await f.owner.mutation(api.learnV2Plans.markExpiredSessionsMissed,
        { learningVoidId: f.graph.learningVoidId, idempotencyKey: 'sweep_expire_1234567890' })
      await f.t.mutation(due, { userId, through: Date.now() })
    }
    const terminal = (await f.t.run(ctx => ctx.db.get(check.today.sessionId)))!
    expect(terminal.status).toBe(transition === 'cancelled' ? 'cancelled' : ['abandoned', 'expired', 'missed'].includes(transition) ? 'missed' : 'completed')
    expect(terminal.revision).toBe(check.before.contextPins.kind === 'session' ? check.before.contextPins.sessionRevision : 0)
    expect((await f.opportunities()).find(row => row._id === check.before._id)!.contextPins).toEqual(check.before.contextPins)
    await f.t.run(async ctx => {
      const { _id, _creationTime, ...fields } = terminal
      for (let index = 0; index < 140; index++) await ctx.db.insert('studySessions', { ...fields,
        scheduledStartAt: terminal.scheduledStartAt - (index + 1) * 86_400_000 })
    })
    const day30 = (await f.opportunities()).find(row => row.horizonDays === 30)!
    vi.setSystemTime(day30.openAt + 1000)
    await f.t.mutation(due, { userId, through: Date.now() })
    expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready',
      assessment: { kind: 'check', state: { assessmentOpportunityId: day30._id } } })
  })

test.each(['void', 'account'] as const)('%s deletion closes a bound check before removing its opportunity', async scope => {
  const f = await fixture()
  const check = await openDelayedCheck(f)
  const learningVoid = (await f.t.run(ctx => ctx.db.get(f.graph.learningVoidId)))!
  if (scope === 'account') await f.t.mutation(internal.accountDeletion.deleteAccountCascade, { userId })
  for (let batch = 0; batch < 250; batch++) {
    if (scope === 'void') await f.t.mutation(internal.learnV2Retention.deleteFolderFoundation, { userId, folderId: learningVoid.folderId })
    else await f.t.mutation(internal.accountDeletion.runDeletionBatch, { userId })
    if (!await f.t.run(ctx => ctx.db.get(check.before._id))) {
      expect(await f.t.run(ctx => ctx.db.get(check.today.sessionId))).toMatchObject({ status: 'cancelled' })
      return
    }
  }
  throw new Error('Opportunity deletion exceeded its batch bound')
})

test('replacement invalidation closes the original delivery binding without moving its first slot', async () => {
  const f = await fixture({ reserve: true })
  const check = await openDelayedCheck(f)
  const request = { assessmentOpportunityId: check.before._id, reason: 'contaminated' as const }
  await f.t.run(ctx => ctx.db.patch(check.before._id, { reasonCode: request.reason }))
  expect(await f.t.run(ctx => replaceLearnMeasurementOpportunityForOwner(ctx, userId, request))).toMatchObject({ status: 'replaced' })
  expect(await f.t.run(ctx => ctx.db.get(check.today.sessionId))).toMatchObject({ status: 'cancelled' })
  expect((await f.opportunities()).find(row => row._id === check.before._id)).toMatchObject({ phase: 'invalid', originalSlot: true,
    contextPins: check.before.contextPins })
  expect((await f.opportunities()).find(row => row.replacesOpportunityId === check.before._id)).toMatchObject({ originalSlot: false, checkSequence: 0 })
})

test.each([7, 30] as const)('Today delivers and scores the recorded day-%s reserve without changing original allocation', async horizon => {
  const f = await fixture({ reserve: true })
  const check = await openDelayedCheck(f, horizon)
  const assignment = (await f.t.run(ctx => ctx.db.get(check.before.assignmentId!)))!
  if (assignment.status !== 'admitted') throw new Error('Expected admitted assignment')
  await f.t.run(ctx => ctx.db.patch(check.before._id, { reasonCode: 'contaminated' }))
  const request = { assessmentOpportunityId: check.before._id, reason: 'contaminated' as const }
  const result = await f.owner.mutation(replaceMeasurementOpportunity, request)
  if (result.status !== 'replaced') throw new Error('Expected reserve')
  expect(await f.owner.mutation(replaceMeasurementOpportunity, request)).toEqual(result)
  await f.t.mutation(due, { userId, through: Date.now() })
  const today = await f.owner.query(api.learnV2Today.getToday, {})
  expect(today).toMatchObject({ status: 'ready', assessment: { kind: 'check', state: { assessmentOpportunityId: result.assessmentOpportunityId } } })
  if (today.status !== 'ready') throw new Error('Expected reserve discovery')
  const started = await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: today.sessionId,
    expectedSessionRevision: today.sessionRevision, expectedContentRevision: today.content.revision, idempotencyKey: 'reserve_today_start_1234567890' })
  expect(started).toMatchObject({ status: 'assessment', deliveryGrant: { status: 'granted' } })
  const opportunity = (await f.opportunities()).find(row => row._id === result.assessmentOpportunityId)!
  const pins = opportunity.assessmentPins
  if (pins.kind !== 'measurement') throw new Error('Expected reserve pins')
  const item = (await f.t.run(ctx => ctx.db.get(pins.itemPins.itemId)))!
  const envelope = await f.owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: today.sessionId })
  expect(envelope).toMatchObject({ delivered: { prompt: item.prompt, declaredStimulus: item.declaredStimulus } })
  const numbers = /groups=(\d+), size=(\d+)/u.exec(item.declaredStimulus!)!
  const accepted = await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: 'reserve_today_seal_1234567890', response: { target: { assessmentOpportunityId: opportunity._id }, expectedRevision: opportunity.revision,
      payload: { kind: 'numeric', value: Number(numbers[1]) * Number(numbers[2]), unit: 'members' } } } })
  if (accepted.kind !== 'accepted') throw new Error('Expected reserve seal')
  expect(await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: accepted.submissionId, idempotencyKey: 'reserve_today_score_1234567890' })).toMatchObject({ status: 'scored', result: { scorePercent: 100 } })
  expect(await f.t.run(ctx => ctx.db.get(assignment._id))).toMatchObject({ status: 'admitted', allocation: assignment.allocation })
  expect((await f.opportunities()).find(row => row._id === check.before._id)).toMatchObject({ originalSlot: true, contextPins: check.before.contextPins })
  expect((await f.opportunities()).find(row => row._id === opportunity._id)).toMatchObject({ originalSlot: false, checkSequence: 0, phase: 'scored_pass' })
})

test.each(['unrecorded', 'wrong_record', 'wrong_parent', 'foreign_parent', 'changed_item', 'promoted', 'clock'] as const)(
  'replacement authority rejects %s provenance in disclosure, grant and acceptance', async forgery => {
    const f = await fixture({ reserve: true, reserveCount: 2 })
    const check = await openDelayedCheck(f)
    await f.t.run(ctx => ctx.db.patch(check.before._id, { reasonCode: 'contaminated' }))
    const replacement = await f.owner.mutation(replaceMeasurementOpportunity, { assessmentOpportunityId: check.before._id, reason: 'contaminated' })
    if (replacement.status !== 'replaced') throw new Error('Expected recorded reserve')
    await f.t.mutation(due, { userId, through: Date.now() })
    const today = await f.owner.query(api.learnV2Today.getToday, {})
    if (today.status !== 'ready') throw new Error('Expected reserve')
    await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: today.sessionId,
      expectedSessionRevision: today.sessionRevision, expectedContentRevision: today.content.revision, idempotencyKey: 'forgery_reserve_start_1234567890' })
    const row = (await f.opportunities()).find(value => value._id === replacement.assessmentOpportunityId)!
    const day30 = (await f.opportunities()).find(value => value.horizonDays === 30)!
    await f.t.run(async ctx => {
      const parent = (await ctx.db.get(check.before._id))!
      if (forgery === 'unrecorded') await ctx.db.patch(parent._id, { replacementBinding: undefined })
      if (forgery === 'wrong_record') await ctx.db.patch(parent._id, { replacementBinding: { ...parent.replacementBinding!, assessmentOpportunityId: day30._id } })
      if (forgery === 'wrong_parent') await ctx.db.patch(row._id, { replacesOpportunityId: day30._id })
      if (forgery === 'foreign_parent') {
        const { _id, _creationTime, ...fields } = parent
        const foreignId = await ctx.db.insert('learnAssessmentOpportunities', { ...fields, userId: 'https://auth.example|foreign-parent' })
        await ctx.db.patch(row._id, { replacesOpportunityId: foreignId })
      }
      if (forgery === 'promoted') await ctx.db.patch(row._id, { originalSlot: true })
      if (forgery === 'clock') await ctx.db.patch(row._id, { closeAt: row.closeAt + 60_000 })
      if (forgery === 'changed_item') {
        if (row.assessmentPins.kind !== 'measurement') throw new Error('Expected item')
        const pins = row.assessmentPins.itemPins
        const items = await ctx.db.query('learnMeasurementItems').withIndex('by_userId_and_familyId_and_familyRevision_and_formLabel', q =>
          q.eq('userId', userId).eq('familyId', pins.familyId).eq('familyRevision', pins.familyRevision)).take(7)
        const item = items.find(value => value.reserve && value._id !== pins.itemId)!
        if (!item.scoringSpecId || !item.publicationValidationId) throw new Error('Expected published reserve')
        await ctx.db.patch(row._id, { assessmentPins: { kind: 'measurement', itemPins: { ...pins, itemId: item._id, itemRevision: item.revision,
          caseId: item.caseId, formLabel: item.formLabel, promptDigest: item.promptDigest, scoringSpecId: item.scoringSpecId,
          scoringSpecRevision: item.scoringSpecRevision, scoringSpecDigest: item.scoringSpecDigest,
          supportManifestDigest: item.supportManifestDigest, publicationValidationId: item.publicationValidationId } } })
      }
    })
    expect(await f.owner.query(api.learnV2Assessments.getAssessmentState, { version: LEARN_V2_PUBLIC_API_VERSION,
      assessmentOpportunityId: row._id })).toMatchObject({ status: 'unavailable', reasonCodes: ['pins_mismatch'] })
    expect(await f.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, { version: LEARN_V2_PUBLIC_API_VERSION,
      assessmentOpportunityId: row._id, expectedRevision: row.revision, idempotencyKey: 'forged_reserve_grant_1234567890' }))
      .toMatchObject({ status: 'unavailable', reasonCodes: ['pins_mismatch'] })
    expect(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
      idempotencyKey: 'forged_reserve_seal_1234567890', response: { target: { assessmentOpportunityId: row._id }, expectedRevision: row.revision,
        payload: { kind: 'numeric', value: 0, unit: 'members' } } } })).toMatchObject({ kind: 'rejected', reasonCode: 'pins_mismatch' })
  })

test.each(['ready', 'in_progress', 'completed', 'mixed', 'placed'] as const)('plan reflow preserves %s fixed checks and their recovery', async state => {
  const f = await fixture()
  const first = await openDelayedCheck(f, 7, state !== 'ready')
  if (state === 'placed') await f.t.run(ctx => ctx.db.patch(first.today.sessionId, { placementId: 'retained-placement', placementKind: 'retained_review' }))
  if (state === 'completed' || state === 'mixed') {
    const sealed = await sealDay7(f, first)
    await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
      submissionId: sealed.accepted.submissionId, idempotencyKey: 'reflow_day7_score_1234567890' })
  }
  if (state === 'mixed') {
    const day30 = (await f.opportunities()).find(row => row.horizonDays === 30)!
    vi.setSystemTime(day30.openAt + 1000)
    await f.t.mutation(due, { userId, through: Date.now() })
  }
  const fixed = await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId', q => q.eq('userId', userId)).take(32))
  const checks = fixed.filter(row => row.assessmentPurpose === 'measurement_delayed')
  const pins = (await f.opportunities()).map(row => ({ id: row._id, contextPins: row.contextPins }))
  const { futureId } = await f.t.run(ctx => seedFixedCheckPlan(ctx, userId, f.graph, Date.now()))
  const command = { studyPlanRevisionId: f.graph.studyPlanRevisionId, expectedPlanRecordRevision: 1, idempotencyKey: 'fixed_check_reflow_1234567890' }
  const reflow = await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, command)
  if (!reflow.successorPlanRevisionId) throw new Error('Expected successor')
  expect(reflow.changedSessionIds).toContain(futureId)
  expect(reflow.preservedSessionIds).toEqual(expect.arrayContaining(checks.map(row => row._id)))
  expect(await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, command)).toEqual(reflow)
  for (const check of checks) {
    expect(await f.t.run(ctx => ctx.db.get(check._id))).toEqual(check)
    expect(await f.owner.query(api.learnV2Journey.getSessionCandidate, { learningVoidId: f.graph.learningVoidId, studySessionId: check._id }))
      .toMatchObject({ studySessionId: check._id, status: check.status })
    expect(await f.owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: check._id })).not.toBeNull()
  }
  expect((await f.opportunities()).map(row => ({ id: row._id, contextPins: row.contextPins }))).toEqual(pins)
  const preview = await f.owner.query(api.learnV2Plans.getPlanPreview, { studyPlanRevisionId: reflow.successorPlanRevisionId })
  expect(preview).toMatchObject({ status: 'accepted' })
  const planDelivery = await f.owner.mutation(api.learnV2Journey.getMissionDelivery, { learningVoidId: f.graph.learningVoidId, idempotencyKey: 'fixed_plan_view_1234567890' })
  if (state === 'completed') expect(planDelivery.value?.plan.fixedChecks?.map(row => row._id)).toContain(first.today.sessionId)
  else expect(planDelivery).toMatchObject({ admission: { status: 'denied' }, value: null })
  if (state !== 'completed') expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', assessment: { kind: 'check' } })
  const day30 = (await f.opportunities()).find(row => row.horizonDays === 30)!
  vi.setSystemTime(day30.openAt + 2000)
  await f.t.mutation(due, { userId, through: Date.now() })
  const next = await f.owner.query(api.learnV2Today.getToday, {})
  expect(next).toMatchObject({ status: 'ready', assessment: { kind: 'check', state: { assessmentOpportunityId: day30._id } } })
  if (next.status !== 'ready') throw new Error('Expected day 30 after reflow')
  await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: next.sessionId, expectedSessionRevision: next.sessionRevision,
    expectedContentRevision: next.content.revision, idempotencyKey: 'fixed_reflow_day30_start_1234567890' })
  const current = (await f.opportunities()).find(row => row._id === day30._id)!
  const accepted = await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: 'fixed_reflow_day30_seal_1234567890', response: { target: { assessmentOpportunityId: current._id }, expectedRevision: current.revision,
      payload: { kind: 'numeric', value: 0, unit: 'members' } } } })
  if (accepted.kind !== 'accepted') throw new Error('Expected seal after reflow')
  expect(await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: accepted.submissionId, idempotencyKey: 'fixed_reflow_day30_score_1234567890' })).toMatchObject({ status: 'scored' })
  const projected = await f.owner.mutation(api.learnV2Journey.getMissionDelivery, { learningVoidId: f.graph.learningVoidId, idempotencyKey: 'fixed_plan_complete_view_1234567890' })
  expect(projected.admission.status).not.toBe('denied')
  expect(projected.value?.plan.sessions.every(row => row.schedulerVersion !== 'learn-v2.delayed-delivery.v1')).toBe(true)
  expect(projected.value?.plan.fixedChecks?.map(row => row._id)).toEqual(expect.arrayContaining(checks.map(row => row._id)))
})

async function reflowWithMixedChecks() {
  const f = await fixture()
  const first = await sealedDay7(f)
  await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: first.accepted.submissionId, idempotencyKey: 'consumer_day7_score_1234567890' })
  const day30 = (await f.opportunities()).find(row => row.horizonDays === 30)!
  vi.setSystemTime(day30.openAt + 1000)
  await f.t.mutation(due, { userId, through: Date.now() })
  await f.t.run(ctx => seedFixedCheckPlan(ctx, userId, f.graph, Date.now()))
  const before = await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId', q => q.eq('userId', userId)).take(32))
  const checks = before.filter(row => row.assessmentPurpose === 'measurement_delayed')
  expect(checks.map(row => row.status).sort()).toEqual(['completed', 'ready'])
  const reflow = await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: f.graph.studyPlanRevisionId,
    expectedPlanRecordRevision: 1, idempotencyKey: 'consumer_reflow_1234567890' })
  if (!reflow.successorPlanRevisionId) throw new Error('Expected successor')
  for (const check of checks) expect(await f.t.run(ctx => ctx.db.get(check._id))).toEqual(check)
  return { ...f, first, day30, checks, successorId: reflow.successorPlanRevisionId }
}

test('plan and session consumer sweep handles live and terminal fixed checks after reflow', async () => {
  const f = await reflowWithMixedChecks()
  const acceptedPins = await f.t.run(async ctx => responseContextPins(await ctx.db.get(f.first.accepted.submissionId)))
  expect(await f.owner.query(api.learnV2Plans.getPlanPreview, { studyPlanRevisionId: f.successorId })).toMatchObject({ status: 'accepted' })
  expect(await f.owner.query(api.learnV2Plans.getPlanPreview, { studyPlanRevisionId: f.graph.studyPlanRevisionId })).toMatchObject({ status: 'superseded' })
  expect((await f.owner.query(api.learnV2Journey.listHub, {})).items).toEqual([expect.objectContaining({ nextScheduledAt: f.day30.openAt })])
  expect(await f.owner.mutation(api.learnV2Journey.getCurrentMissionDelivery, { idempotencyKey: 'consumer_current_view_1234567890' }))
    .toMatchObject({ admission: { status: 'denied' }, value: null })
  expect(await f.owner.mutation(api.learnV2Journey.getMissionDelivery, { learningVoidId: f.graph.learningVoidId, idempotencyKey: 'consumer_plan_view_1234567890' }))
    .toMatchObject({ admission: { status: 'denied' }, value: null })
  for (const check of f.checks) {
    expect(await f.owner.query(api.learnV2Journey.getSessionCandidate, { learningVoidId: f.graph.learningVoidId, studySessionId: check._id }))
      .toMatchObject({ studySessionId: check._id, status: check.status })
    expect(await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: check._id, idempotencyKey: `consumer_check_view_${check._id}` }))
      .toMatchObject({ value: { assessment: { kind: 'check', state: { assessmentOpportunityId: check.assessmentOpportunityId } } } })
  }
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', assessment: { state: { assessmentOpportunityId: f.day30._id } } })
  vi.stubEnv('LEARN_V2_CALENDAR_ENABLED', 'true')
  const connectionId = await f.t.run(ctx => ctx.db.insert('calendarConnections', { userId, provider: 'google', accessToken: '', refreshToken: '',
    expiresAt: Date.now() + 86_400_000, timezone: 'UTC', status: 'connected', connectedAt: Date.now(), learnV2ConsentVersion: 1,
    grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned', 'https://www.googleapis.com/auth/calendar.events.freebusy'] }))
  const network = vi.fn(async () => { throw new Error('Unexpected calendar dispatch') })
  vi.stubGlobal('fetch', network)
  expect(await f.owner.query(api.learnV2Calendar.getStatus, {})).toMatchObject({ enabled: true, connection: 'ready' })
  for (const check of f.checks) {
    const unavailable = { kind: 'unavailable', reasonCode: 'fixed_assessment_window', studySessionId: check._id }
    expect(await f.owner.query(internal.learnV2Calendar.getProjectionInput, { userId, studySessionId: check._id })).toEqual(unavailable)
    expect(await f.owner.mutation(internal.learnV2Calendar.reserveProjection, { userId, studySessionId: check._id, externalEventId: `b${'a'.repeat(32)}` })).toEqual(unavailable)
    expect(await f.owner.action(api.learnV2Calendar.projectSession, { studySessionId: check._id })).toEqual(unavailable)
  }
  expect(network).not.toHaveBeenCalled()
  expect(await f.owner.query(api.learnV2Calendar.listProjections, {})).toEqual([])
  const ordinary = (await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', q =>
    q.eq('userId', userId).eq('studyPlanRevisionId', f.successorId)).take(8))).find(row => row.status === 'planned' && row.scheduledStartAt > Date.now())!
  expect(await f.owner.query(internal.learnV2Calendar.getProjectionInput, { userId, studySessionId: ordinary._id })).toMatchObject({ session: { _id: ordinary._id }, plan: { _id: f.successorId } })
  const fixed = f.checks[0]!
  const projectionId = await f.t.run(ctx => ctx.db.insert('calendarProjections', { userId, calendarConnectionId: connectionId,
    studySessionId: fixed._id, studyPlanRevisionId: fixed.studyPlanRevisionId, pinnedPlanRevision: 1, pinnedSessionRevision: fixed.revision,
    provider: 'google', externalEventId: 'fixed-window-control', status: 'projected', privateMetadata: '{}', createdAt: Date.now(), updatedAt: Date.now() }))
  expect(await f.owner.mutation(internal.learnV2CalendarReconciliation.recordExternalChange, { calendarConnectionId: connectionId,
    externalEventId: 'fixed-window-control', kind: 'moved', proposedStartAt: fixed.scheduledStartAt + 60_000,
    proposedEndAt: fixed.scheduledEndAt! + 60_000, providerUpdatedAt: Date.now() + 1000 })).toBeNull()
  expect(await f.owner.query(api.learnV2CalendarReconciliation.listProposals, {})).toEqual([])
  expect(await f.t.run(ctx => ctx.db.get(projectionId))).toMatchObject({ status: 'projected' })
  let authorization = await f.owner.mutation(api.dataExport.authorizePersonalExport, {})
  for (let page = 0; page < 16 && !authorization.done; page++) authorization = await f.owner.mutation(api.dataExport.authorizePersonalExport,
    { authorizationId: authorization.authorizationId, cursor: authorization.cursor! })
  expect(authorization.done).toBe(true)
  for (const collection of ['studySessions', 'studyPlanRevisions', 'sessionContent', 'masteryAttempts'] as const) {
    const page = await f.owner.query(api.dataExport.getUserDataPage, { collection, paginationOpts: { numItems: 50, cursor: null }, authorizationId: authorization.authorizationId })
    expect(page.page.length).toBeGreaterThan(0)
    if (collection === 'studySessions') for (const check of f.checks) expect(page.page).toEqual(expect.arrayContaining([expect.objectContaining({
      _id: check._id, assessmentPurpose: 'measurement_delayed', assessmentOpportunityId: check.assessmentOpportunityId,
      scheduledStartAt: check.scheduledStartAt, scheduledEndAt: check.scheduledEndAt })]))
  }
  expect(await f.t.run(async ctx => responseContextPins(await ctx.db.get(f.first.accepted.submissionId)))).toEqual(acceptedPins)
  for (const check of f.checks) expect(await f.t.run(ctx => ctx.db.get(check._id))).toMatchObject({
    _id: check._id, studyPlanRevisionId: check.studyPlanRevisionId, assessmentOpportunityId: check.assessmentOpportunityId,
    scheduledStartAt: check.scheduledStartAt, scheduledEndAt: check.scheduledEndAt })
})

test.each(['void', 'account'] as const)('%s deletion drains fixed checks retained across reflow revisions', async scope => {
  const f = await reflowWithMixedChecks()
  const next = await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: f.successorId,
    expectedPlanRecordRevision: 1, idempotencyKey: 'deletion_second_reflow_1234567890' })
  expect(next.preservedSessionIds).toEqual(expect.arrayContaining(f.checks.map(row => row._id)))
  const learningVoid = (await f.t.run(ctx => ctx.db.get(f.graph.learningVoidId)))!
  if (scope === 'account') await f.t.mutation(internal.accountDeletion.deleteAccountCascade, { userId })
  for (let batch = 0; batch < 250; batch++) {
    if (scope === 'void') await f.t.mutation(internal.learnV2Retention.deleteFolderFoundation, { userId, folderId: learningVoid.folderId })
    else await f.t.mutation(internal.accountDeletion.runDeletionBatch, { userId })
    const sessions = await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId', q => q.eq('userId', userId)).take(1))
    if (!sessions.length) {
      expect(await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q => q.eq('userId', userId)).take(1))).toEqual([])
      return
    }
  }
  throw new Error('Deletion did not drain every reflow revision')
})

test('fixed checks do not change ordinary reflow placements, status transitions or generation', async () => {
  const outcomes = []
  for (const withCheck of [false, true]) {
    vi.setSystemTime(Date.parse('2027-03-07T15:00:00Z'))
    policy.protocol = syntheticDeliveryProtocol()
    const f = await fixture()
    if (withCheck) await openDelayedCheck(f)
    else {
      const cold = await f.seal()
      await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
        submissionId: cold.accepted.submissionId, idempotencyKey: 'ordinary_control_cold_1234567890' })
      const day7 = (await f.opportunities()).find(row => row.horizonDays === 7)!
      vi.setSystemTime(day7.openAt + 1000)
    }
    const setup = await f.t.run(ctx => seedFixedCheckPlan(ctx, userId, f.graph, Date.now()))
    const reflow = await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: f.graph.studyPlanRevisionId,
      expectedPlanRecordRevision: 1, idempotencyKey: 'ordinary_control_reflow_1234567890' })
    if (!reflow.successorPlanRevisionId) throw new Error('Expected successor')
    outcomes.push(await f.t.run(async ctx => {
      const rows = await ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', q =>
        q.eq('userId', userId).eq('studyPlanRevisionId', reflow.successorPlanRevisionId!)).take(8)
      const jobs = await ctx.db.query('learnJobs').withIndex('by_userId', q => q.eq('userId', userId)).take(24)
      return { placements: rows.map(row => ({ placementId: row.placementId, status: row.status, revision: row.revision,
        start: row.scheduledStartAt, end: row.scheduledEndAt, kind: row.placementKind, priority: row.schedulingPriority,
        scheduler: row.schedulerVersion, assessmentPurpose: row.assessmentPurpose })),
      futureStatus: (await ctx.db.get(setup.futureId))!.status,
      generations: jobs.filter(row => row.studyPlanRevisionId === reflow.successorPlanRevisionId).map(row => ({ status: row.status, type: row.type })) }
    }))
  }
  expect(outcomes[1]).toEqual(outcomes[0])
})

test.each(['valid', 'wrong_reason', 'wrong_blueprint', 'record_revision', 'cycle'] as const)('fixed check authority after repeated reflow: %s', async change => {
  const f = await fixture()
  const check = await openDelayedCheck(f)
  await f.t.run(ctx => seedFixedCheckPlan(ctx, userId, f.graph, Date.now()))
  const first = await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: f.graph.studyPlanRevisionId,
    expectedPlanRecordRevision: 1, idempotencyKey: 'chain_first_reflow_1234567890' })
  if (!first.successorPlanRevisionId) throw new Error('Expected first successor')
  const second = await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: first.successorPlanRevisionId,
    expectedPlanRecordRevision: 1, idempotencyKey: 'chain_second_reflow_1234567890' })
  if (!second.successorPlanRevisionId) throw new Error('Expected second successor')
  await f.t.run(async ctx => {
    const current = (await ctx.db.get(second.successorPlanRevisionId!))!
    if (change === 'wrong_reason') await ctx.db.patch(current._id, { changeReason: 'availability_changed' })
    if (change === 'wrong_blueprint') await ctx.db.patch(current._id, { blueprintRecordRevision: current.blueprintRecordRevision! + 1 })
    if (change === 'record_revision') {
      const original = (await ctx.db.get(f.graph.studyPlanRevisionId))!
      await ctx.db.patch(original._id, { recordRevision: original.recordRevision! + 1 })
    }
    if (change === 'cycle') await ctx.db.patch(current._id, { parentRevisionId: current._id })
  })
  const state = await f.owner.query(api.learnV2Assessments.getAssessmentState, { version: LEARN_V2_PUBLIC_API_VERSION,
    assessmentOpportunityId: check.before._id })
  if (change === 'valid') {
    expect(state).toMatchObject({ status: 'available', phase: 'test_open' })
    expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', sessionId: check.today.sessionId })
  } else {
    expect(state).toMatchObject({ status: 'unavailable', reasonCodes: ['pins_mismatch'] })
    expect(await f.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, { version: LEARN_V2_PUBLIC_API_VERSION,
      assessmentOpportunityId: check.before._id, expectedRevision: check.before.revision, idempotencyKey: 'chain_bad_grant_1234567890' }))
      .toMatchObject({ status: 'unavailable', reasonCodes: ['pins_mismatch'] })
    expect(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
      idempotencyKey: 'chain_bad_seal_1234567890', response: { target: { assessmentOpportunityId: check.before._id }, expectedRevision: check.before.revision,
        payload: { kind: 'numeric', value: 0, unit: 'members' } } } })).toMatchObject({ kind: 'rejected', reasonCode: 'pins_mismatch' })
  }
})

test('fixed-check plan additions stay absent when responses are off', async () => {
  const f = await reflowWithMixedChecks()
  const before = await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId', q => q.eq('userId', userId)).take(32))
  policy.responses = false
  const view = await f.owner.mutation(api.learnV2Journey.getMissionDelivery, { learningVoidId: f.graph.learningVoidId, idempotencyKey: 'fixed_off_view_1234567890' })
  expect(view.value?.plan).not.toHaveProperty('fixedChecks')
  for (const check of f.checks) expect(await f.owner.query(api.learnV2Journey.getSessionCandidate, {
    learningVoidId: f.graph.learningVoidId, studySessionId: check._id })).toBeNull()
  expect(await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId', q => q.eq('userId', userId)).take(32))).toEqual(before)
})

async function independentWithReflow(count = 1) {
  const f = await fixture()
  const cold = await f.seal()
  await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: cold.accepted.submissionId, idempotencyKey: 'outcome_route_cold_score_1234567890' })
  await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)
  ordinaryScorer()
  expect(await f.owner.action(api.learnV2Mastery.submitMasteryAttempt, { studySessionId: f.graph.studySessionId,
    expectedSessionRevision: 3, expectedContentRevision: 1, expectedPlanRecordRevision: 1, expectedBlueprintRecordRevision: 1,
    response: 'My separate-case application.', confidence: 3, idempotencyKey: 'outcome_route_independent_1234567890' }))
    .toMatchObject({ status: 'completed', state: 'independent' })
  let activePlanId = f.graph.studyPlanRevisionId
  if (count) await f.t.run(async ctx => {
    await seedFixedCheckPlan(ctx, userId, f.graph, Date.now())
    await ctx.db.patch(f.graph.studySessionId, { status: 'completed', missedAt: undefined })
  })
  for (let index = 0; index < count; index++) {
    const reflow = await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: activePlanId,
      expectedPlanRecordRevision: 1, idempotencyKey: `outcome_route_reflow_${index}_1234567890` })
    if (!reflow.successorPlanRevisionId) throw new Error('Expected successor')
    activePlanId = reflow.successorPlanRevisionId
  }
  return { ...f, activePlanId }
}

async function sealOutcomeCheck(f: Awaited<ReturnType<typeof fixture>>, horizon: 7 | 30) {
  const original = (await f.opportunities()).find(row => row.horizonDays === horizon)!
  vi.setSystemTime(original.openAt + 1000)
  await f.t.mutation(due, { userId, through: Date.now() })
  const today = await f.owner.query(api.learnV2Today.getToday, {})
  if (today.status !== 'ready') throw new Error('Expected check')
  await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: today.sessionId, expectedSessionRevision: today.sessionRevision,
    expectedContentRevision: today.content.revision, idempotencyKey: 'outcome_route_check_start_1234567890' })
  const opportunity = (await f.opportunities()).find(row => row._id === original._id)!
  const accepted = await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: 'outcome_route_check_seal_1234567890', response: { target: { assessmentOpportunityId: original._id }, expectedRevision: opportunity.revision,
      payload: { kind: 'numeric', value: 0, unit: 'members' } } } })
  if (accepted.kind !== 'accepted') throw new Error('Expected sealed check')
  const frozen = await f.t.run(async ctx => ({ session: await ctx.db.get(today.sessionId), response: await ctx.db.get(accepted.submissionId) }))
  return { original, today, opportunity, accepted, frozen }
}

async function acceptFollowUpGeneration(f: Awaited<ReturnType<typeof fixture>>, session: Doc<'studySessions'>) {
  const job = (await f.t.run(ctx => ctx.db.query('learnJobs').withIndex('by_userId_and_studySessionId_and_type_and_status', q =>
    q.eq('userId', userId).eq('studySessionId', session._id).eq('type', 'session_content_generation').eq('status', 'queued')).take(4)))[0]!
  expect(job).toMatchObject({ studyPlanRevisionId: session.studyPlanRevisionId, expectedSessionRevision: session.revision })
  const lease = await f.t.mutation(internal.learnV2SessionContent.leaseSessionContentGeneration, { tokenIdentifier: userId, jobId: job._id, expectedRevision: job.revision })
  expect(lease.kind).toBe('leased')
  if (lease.kind !== 'leased') throw new Error('Expected generation lease')
  const running = await f.t.mutation(internal.learnV2SessionContent.beginSessionContentGeneration,
    { tokenIdentifier: userId, jobId: job._id, expectedRevision: lease.revision, leaseToken: lease.leaseToken })
  expect(running.status).toBe('running')
  expect(await f.t.query(internal.learnV2SessionContent.getSessionContentGenerationInput,
    { tokenIdentifier: userId, jobId: job._id, expectedRevision: running.revision, leaseToken: lease.leaseToken }))
    .toMatchObject({ sources: [expect.objectContaining({ sourceSnapshotId: f.graph.sourceSnapshotId })] })
  return job
}

test.each([{ horizon: 7, reflows: 0, draft: false }, { horizon: 7, reflows: 1, draft: false },
  { horizon: 30, reflows: 2, draft: false }, { horizon: 7, reflows: 1, draft: true }] as const)(
  'a failed day-$horizon check after $reflows reflows creates reachable remediation: draft=$draft', async ({ horizon, reflows, draft }) => {
  const f = await independentWithReflow(reflows)
  if (draft) await f.t.run(async ctx => {
    const { _id: _id, _creationTime: _time, ...plan } = (await ctx.db.get(f.activePlanId))!
    await ctx.db.insert('studyPlanRevisions', { ...plan, revision: plan.revision + 1, status: 'draft', parentRevisionId: f.activePlanId,
      changeReason: 'availability_changed', acceptedAt: undefined })
  })
  const { original, today, opportunity, accepted, frozen } = await sealOutcomeCheck(f, horizon)
  const result = await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: accepted.submissionId, idempotencyKey: 'outcome_route_check_score_1234567890' })
  if (result.status !== 'scored') throw new Error('Expected score')
  expect(await f.t.run(ctx => ctx.db.get(result.result.attemptId))).toMatchObject({ masteryStateAfter: 'needs_review' })
  const sessions = await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId', q => q.eq('userId', userId)).take(32))
  const remediation = sessions.find(row => row.auditReasonCode === `mastery_followup:${result.result.attemptId}`)!
  expect(remediation).toMatchObject({ studyPlanRevisionId: f.activePlanId, placementKind: 'review', schedulingPriority: 'prerequisite_remediation' })
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'pending', sessionId: remediation._id })
  expect(await f.owner.query(api.learnV2Journey.getSessionCandidate, { learningVoidId: f.graph.learningVoidId, studySessionId: remediation._id }))
    .toMatchObject({ studySessionId: remediation._id, status: 'planned' })
  await acceptFollowUpGeneration(f, remediation)
  expect(await f.t.run(ctx => ctx.db.get(today.sessionId))).toEqual(frozen.session)
  expect(await f.t.run(ctx => ctx.db.get(accepted.submissionId))).toEqual(frozen.response)
  const scored = (await f.opportunities()).find(row => row._id === original._id)!
  expect(scored.contextPins).toEqual(opportunity.contextPins)
  expect(scored.assessmentPins).toEqual(opportunity.assessmentPins)
  expect(scored.firstCheckClaim).toEqual(opportunity.firstCheckClaim)
  expect(scored.delayedCheckId).toBe(opportunity.delayedCheckId)
})

test.each(['archived', 'deleted_void', 'no_active', 'deleted_successor', 'foreign_successor', 'unrelated_successor', 'stale_blueprint', 'missing_folder'] as const)(
  'a check creates no ordinary work with invalid active-plan authority: %s', async change => {
  const f = await independentWithReflow()
  const check = await sealOutcomeCheck(f, 7)
  await f.t.run(async ctx => {
    if (change === 'archived') await ctx.db.patch(f.graph.learningVoidId, { status: 'archived' })
    if (change === 'deleted_void') await ctx.db.delete(f.graph.learningVoidId)
    if (change === 'no_active') await ctx.db.patch(f.graph.studyPlanId, { activeRevisionId: undefined })
    if (change === 'deleted_successor') await ctx.db.delete(f.activePlanId)
    if (change === 'foreign_successor') await ctx.db.patch(f.activePlanId, { userId: 'another-owner' })
    if (change === 'unrelated_successor') await ctx.db.patch(f.activePlanId, { changeReason: 'availability_changed' })
    if (change === 'stale_blueprint') await ctx.db.patch(f.graph.blueprintRevisionId, { recordRevision: 2 })
    if (change === 'missing_folder') await ctx.db.delete((await ctx.db.get(f.graph.learningVoidId))!.folderId)
  })
  const snapshot = () => f.t.run(async ctx => ({
    sessions: await ctx.db.query('studySessions').withIndex('by_userId', q => q.eq('userId', userId)).take(32),
    jobs: await ctx.db.query('learnJobs').withIndex('by_userId', q => q.eq('userId', userId)).take(32),
    attempts: await ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', userId)).take(32),
  }))
  const before = await snapshot()
  await expect(f.t.run(async ctx => requireLearnActiveWorkPlan(ctx, userId, (await ctx.db.get(f.graph.studyPlanRevisionId))!)))
    .rejects.toThrow('Learn follow-up active plan unavailable')
  await expect(f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: check.accepted.submissionId, idempotencyKey: 'no_active_check_score_1234567890' })).rejects.toThrow(/unavailable|denied/)
  expect(await snapshot()).toEqual(before)
  expect(await f.t.run(ctx => ctx.db.get(check.today.sessionId))).toEqual(check.frozen.session)
  expect(await f.t.run(ctx => ctx.db.get(check.accepted.submissionId))).toEqual(check.frozen.response)
})

async function successorLesson() {
  const f = await fixture()
  const cold = await f.seal()
  await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: cold.accepted.submissionId, idempotencyKey: 'creator_cold_score_1234567890' })
  await f.t.run(ctx => seedFixedCheckPlan(ctx, userId, f.graph, Date.now()))
  const reflow = await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: f.graph.studyPlanRevisionId,
    expectedPlanRecordRevision: 1, idempotencyKey: 'creator_reflow_1234567890' })
  if (!reflow.successorPlanRevisionId) throw new Error('Expected successor')
  const planId = reflow.successorPlanRevisionId
  const lesson = (await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', q =>
    q.eq('userId', userId).eq('studyPlanRevisionId', planId)).take(8))).find(row => row.status === 'planned')!
  await publishDeliveryTeaching({ t: f.t, graph: { ...f.graph, studySessionId: lesson._id, studyPlanRevisionId: planId } })
  await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: lesson._id, expectedSessionRevision: 2,
    expectedContentRevision: 1, idempotencyKey: 'creator_lesson_start_1234567890' })
  return { ...f, planId, lesson }
}

test.each(['guided_review', 'retained_unavailable'] as const)('the %s creator and its next reflow use the active plan', async creator => {
  const f = await successorLesson()
  if (creator === 'guided_review') await f.owner.mutation(api.learnV2Mastery.recordAssistanceUse, { studySessionId: f.lesson._id,
    expectedSessionRevision: 3, kind: 'substantive_hint' })
  else policy.protocol = null
  ordinaryScorer()
  const result = await f.owner.action(api.learnV2Mastery.submitMasteryAttempt, { studySessionId: f.lesson._id,
    expectedSessionRevision: creator === 'guided_review' ? 4 : 3, expectedContentRevision: 1, expectedPlanRecordRevision: 1,
    expectedBlueprintRecordRevision: 1, response: 'My separate-case application.', confidence: 3, idempotencyKey: 'creator_application_1234567890' })
  if (result.status !== 'completed') throw new Error('Expected completed application')
  expect(result.state).toBe(creator === 'guided_review' ? 'guided' : 'independent')
  const followUp = (await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId', q => q.eq('userId', userId)).take(32)))
    .find(row => row.auditReasonCode === `mastery_followup:${result.attemptId}` || row.assessmentPurpose === 'retained_transfer')!
  expect(followUp.studyPlanRevisionId).toBe(f.planId)
  expect(followUp.placementId).toBeTruthy()
  expect(await f.owner.query(api.learnV2Journey.getSessionCandidate, { learningVoidId: f.graph.learningVoidId, studySessionId: followUp._id }))
    .toMatchObject({ studySessionId: followUp._id, status: creator === 'guided_review' ? 'planned' : 'blocked' })
  if (creator === 'guided_review') {
    expect(followUp).toMatchObject({ placementKind: 'review', schedulingPriority: 'due_review' })
    expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'pending', sessionId: followUp._id })
  } else expect(followUp).toMatchObject({ status: 'blocked', assessmentPurpose: 'retained_transfer', auditReasonCode: 'protocol_not_frozen' })
  const again = await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: f.planId,
    expectedPlanRecordRevision: 1, idempotencyKey: 'creator_second_reflow_1234567890' })
  if (!again.successorPlanRevisionId) throw new Error('Expected second successor')
  const carried = (await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', q =>
    q.eq('userId', userId).eq('studyPlanRevisionId', again.successorPlanRevisionId!)).take(8))).find(row => row.placementId === followUp.placementId)!
  expect(carried).toMatchObject({ placementKind: followUp.placementKind, schedulingPriority: followUp.schedulingPriority, status: followUp.status })
  if (creator === 'guided_review') {
    expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'pending', sessionId: carried._id })
    await acceptFollowUpGeneration(f, carried)
  } else {
    expect(carried).toMatchObject({ assessmentPurpose: 'retained_transfer', auditReasonCode: 'protocol_not_frozen' })
    const jobs = await f.t.run(ctx => ctx.db.query('learnJobs').withIndex('by_userId_and_studySessionId_and_type_and_status', q =>
      q.eq('userId', userId).eq('studySessionId', carried._id).eq('type', 'session_content_generation')).take(4))
    expect(jobs).toEqual([])
    vi.setSystemTime(carried.scheduledStartAt + 1000)
    expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'blocked', reason: 'protocol_not_frozen', canRetryGeneration: false })
  }
})

test('a remediation follow-up survives its own reflow and scoring replay', async () => {
  const f = await independentWithReflow()
  const check = await sealOutcomeCheck(f, 7)
  const request = { version: LEARN_V2_PUBLIC_API_VERSION, submissionId: check.accepted.submissionId, idempotencyKey: 'remediation_second_score_1234567890' }
  const result = await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, request)
  if (result.status !== 'scored') throw new Error('Expected scored check')
  const followUp = (await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId', q => q.eq('userId', userId)).take(32)))
    .find(row => row.auditReasonCode === `mastery_followup:${result.result.attemptId}`)!
  const again = await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: f.activePlanId,
    expectedPlanRecordRevision: 1, idempotencyKey: 'remediation_second_reflow_1234567890' })
  if (!again.successorPlanRevisionId) throw new Error('Expected successor')
  const carried = (await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', q =>
    q.eq('userId', userId).eq('studyPlanRevisionId', again.successorPlanRevisionId!)).take(8))).find(row => row.placementId === followUp.placementId)!
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'pending', sessionId: carried._id })
  expect(await f.owner.query(api.learnV2Journey.getSessionCandidate, { learningVoidId: f.graph.learningVoidId, studySessionId: carried._id }))
    .toMatchObject({ status: 'planned' })
  await acceptFollowUpGeneration(f, carried)
  const before = await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId', q => q.eq('userId', userId)).take(32))
  expect(await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, request)).toMatchObject({ status: 'scored', result: result.result })
  expect(await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId', q => q.eq('userId', userId)).take(32))).toEqual(before)
  expect(await f.t.run(ctx => ctx.db.get(check.today.sessionId))).toEqual(check.frozen.session)
  expect(await f.t.run(ctx => ctx.db.get(check.accepted.submissionId))).toEqual(check.frozen.response)
})

test.each(['draft_off', 'archived'] as const)('follow-up generation revalidates active-plan authority: %s', async change => {
  const f = await independentWithReflow()
  const check = await sealOutcomeCheck(f, 7)
  const result = await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: check.accepted.submissionId, idempotencyKey: 'generation_route_score_1234567890' })
  if (result.status !== 'scored') throw new Error('Expected scored check')
  const followUp = (await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId', q => q.eq('userId', userId)).take(32)))
    .find(row => row.auditReasonCode === `mastery_followup:${result.result.attemptId}`)!
  const job = (await f.t.run(ctx => ctx.db.query('learnJobs').withIndex('by_userId_and_studySessionId_and_type_and_status', q =>
    q.eq('userId', userId).eq('studySessionId', followUp._id).eq('type', 'session_content_generation')).take(4)))[0]!
  await f.t.run(async ctx => {
    if (change === 'archived') await ctx.db.patch(f.graph.learningVoidId, { status: 'archived' })
    else {
      const { _id: _id, _creationTime: _time, ...plan } = (await ctx.db.get(f.activePlanId))!
      await ctx.db.insert('studyPlanRevisions', { ...plan, revision: plan.revision + 1, status: 'draft', parentRevisionId: f.activePlanId,
        changeReason: 'availability_changed', acceptedAt: undefined })
    }
  })
  if (change === 'draft_off') {
    policy.responses = false
    expect(await f.t.run(async ctx => requireLearnActiveWorkPlan(ctx, userId, (await ctx.db.get(f.graph.studyPlanRevisionId))!)))
      .toMatchObject({ _id: f.graph.studyPlanRevisionId, status: 'superseded' })
  }
  expect(await f.t.mutation(internal.learnV2SessionContent.leaseSessionContentGeneration,
    { tokenIdentifier: userId, jobId: job._id, expectedRevision: job.revision })).toMatchObject({ kind: 'blocked' })
  expect(await f.t.run(ctx => ctx.db.get(job._id))).toMatchObject({ status: 'blocked', terminalReason: 'input_revision_conflict' })
  expect(await f.t.run(ctx => ctx.db.get(check.today.sessionId))).toEqual(check.frozen.session)
  expect(await f.t.run(ctx => ctx.db.get(check.accepted.submissionId))).toEqual(check.frozen.response)
})

test.each(['valid', 'archived', 'no_active', 'missing_folder'] as const)('follow-up retry creates work only under valid active authority: %s', async change => {
  const f = await independentWithReflow()
  const check = await sealOutcomeCheck(f, 7)
  const result = await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: check.accepted.submissionId, idempotencyKey: 'retry_route_score_1234567890' })
  if (result.status !== 'scored') throw new Error('Expected scored check')
  const followUp = (await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId', q => q.eq('userId', userId)).take(32)))
    .find(row => row.auditReasonCode === `mastery_followup:${result.result.attemptId}`)!
  const job = (await f.t.run(ctx => ctx.db.query('learnJobs').withIndex('by_userId_and_studySessionId_and_type_and_status', q =>
    q.eq('userId', userId).eq('studySessionId', followUp._id).eq('type', 'session_content_generation')).take(4)))[0]!
  const lease = await f.t.mutation(internal.learnV2SessionContent.leaseSessionContentGeneration,
    { tokenIdentifier: userId, jobId: job._id, expectedRevision: job.revision })
  if (lease.kind !== 'leased') throw new Error('Expected generation lease')
  await f.t.mutation(internal.learnV2SessionContent.terminalizeSessionContentGeneration, { tokenIdentifier: userId, jobId: job._id,
    expectedRevision: lease.revision, leaseToken: lease.leaseToken, reason: 'synthetic_candidate_failure', sessionStatus: 'generation_failed' })
  await f.t.run(async ctx => {
    if (change === 'archived') await ctx.db.patch(f.graph.learningVoidId, { status: 'archived' })
    if (change === 'no_active') await ctx.db.patch(f.graph.studyPlanId, { activeRevisionId: undefined })
    if (change === 'missing_folder') await ctx.db.delete((await ctx.db.get(f.graph.learningVoidId))!.folderId)
  })
  const before = await f.t.run(ctx => ctx.db.query('learnJobs').withIndex('by_userId', q => q.eq('userId', userId)).take(32))
  const request = { studySessionId: followUp._id, expectedSessionRevision: followUp.revision + 1, idempotencyKey: 'retry_route_generation_1234567890' }
  if (change === 'valid') {
    const retry = await f.owner.mutation(api.learnV2SessionContent.retrySessionContentGeneration, request)
    expect(retry).toMatchObject({ status: 'pending' })
    const retried = (await f.t.run(ctx => ctx.db.get(followUp._id)))!
    const accepted = await acceptFollowUpGeneration(f, retried)
    expect(accepted._id).toBe(retry.jobId)
    expect(accepted.studyPlanRevisionId).toBe(f.activePlanId)
    expect(await f.owner.mutation(api.learnV2SessionContent.retrySessionContentGeneration, request)).toEqual(retry)
  } else {
    await expect(f.owner.mutation(api.learnV2SessionContent.retrySessionContentGeneration, request)).rejects.toThrow(/not current|unavailable/)
    await expect(f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: f.activePlanId,
      expectedPlanRecordRevision: 1, idempotencyKey: 'retry_route_invalid_reflow_1234567890' })).rejects.toThrow(/archived|not current|not found|unavailable/)
    expect(await f.t.run(ctx => ctx.db.query('learnJobs').withIndex('by_userId', q => q.eq('userId', userId)).take(32))).toEqual(before)
    expect(await f.t.run(ctx => ctx.db.get(followUp._id))).toMatchObject({ status: 'generation_failed', revision: followUp.revision + 1 })
  }
})

test.each(['valid', 'archived', 'no_active'] as const)('family generation from an outcome session validates active authority: %s', async change => {
  const f = await independentWithReflow()
  const check = await sealOutcomeCheck(f, 7)
  const result = await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: check.accepted.submissionId, idempotencyKey: 'family_route_score_1234567890' })
  if (result.status !== 'scored') throw new Error('Expected scored check')
  const followUp = (await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId', q => q.eq('userId', userId)).take(32)))
    .find(row => row.auditReasonCode === `mastery_followup:${result.result.attemptId}`)!
  const family = (await f.t.run(ctx => ctx.db.get(f.begun.familyId)))!
  await f.t.run(async ctx => {
    if (change === 'archived') await ctx.db.patch(f.graph.learningVoidId, { status: 'archived' })
    if (change === 'no_active') await ctx.db.patch(f.graph.studyPlanId, { activeRevisionId: undefined })
  })
  const before = await f.t.run(ctx => ctx.db.query('learnJobs').withIndex('by_userId', q => q.eq('userId', userId)).take(32))
  const commands = (anyApi as unknown as ApiFromModules<{ learnV2MeasurementItems: typeof import('./learnV2MeasurementItems') }>).learnV2MeasurementItems
  const request = { tokenIdentifier: userId, studySessionId: followUp._id, expectedSessionRevision: followUp.revision,
    familyKey: 'outcome.family.v1', revision: 1, coreFormCount: 3 as const, equivalenceVersion: family.equivalenceVersion,
    equivalenceDescriptorJson: JSON.stringify(family.equivalenceDescriptor), idempotencyKey: 'family_route_generation_1234567890' }
  if (change === 'valid') {
    const begun = await f.t.mutation(commands.beginFamilyGeneration, request)
    expect(await f.t.run(ctx => ctx.db.get(begun.jobId))).toMatchObject({ studySessionId: followUp._id, studyPlanRevisionId: f.activePlanId })
  } else {
    await expect(f.t.mutation(commands.beginFamilyGeneration, request)).rejects.toThrow(/unavailable|pins_mismatch/)
    expect(await f.t.run(ctx => ctx.db.query('learnJobs').withIndex('by_userId', q => q.eq('userId', userId)).take(32))).toEqual(before)
  }
})

test('a retained follow-up after reflow binds the frozen original plan instead of blocking a valid item', async () => {
  const f = await fixture()
  const first = await sealedDay7(f)
  await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: first.accepted.submissionId, idempotencyKey: 'retained_reflow_day7_score_1234567890' })
  await f.t.run(ctx => seedFixedCheckPlan(ctx, userId, f.graph, Date.now()))
  const reflow = await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: f.graph.studyPlanRevisionId,
    expectedPlanRecordRevision: 1, idempotencyKey: 'retained_reflow_plan_1234567890' })
  if (!reflow.successorPlanRevisionId) throw new Error('Expected successor')
  const planId = reflow.successorPlanRevisionId
  const lesson = (await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', q =>
    q.eq('userId', userId).eq('studyPlanRevisionId', planId)).take(8))).find(row => row.status === 'planned')!
  await publishDeliveryTeaching({ t: f.t, graph: { ...f.graph, studySessionId: lesson._id, studyPlanRevisionId: planId } })
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: lesson._id, expectedSessionRevision: 2,
    expectedContentRevision: 1, idempotencyKey: 'retained_reflow_lesson_start_1234567890' })).toMatchObject({ status: 'in_progress' })
  ordinaryScorer()
  expect(await f.owner.action(api.learnV2Mastery.submitMasteryAttempt, { studySessionId: lesson._id, expectedSessionRevision: 3,
    expectedContentRevision: 1, expectedPlanRecordRevision: 1, expectedBlueprintRecordRevision: 1,
    response: 'My separate-case application.', confidence: 3, idempotencyKey: 'retained_reflow_independent_1234567890' }))
    .toMatchObject({ status: 'completed', state: 'independent', scorePercent: 100 })
  const day30 = (await f.opportunities()).find(row => row.horizonDays === 30)!
  const sessions = await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId', q => q.eq('userId', userId)).take(32))
  const bound = sessions.filter(row => row.assessmentOpportunityId === day30._id)
  expect(bound).toEqual([expect.objectContaining({ studyPlanRevisionId: f.graph.studyPlanRevisionId, status: 'ready',
    assessmentPurpose: 'measurement_delayed', schedulerVersion: 'learn-v2.delayed-delivery.v1', scheduledStartAt: day30.openAt, scheduledEndAt: day30.closeAt })])
  expect(sessions.some(row => row.assessmentPurpose === 'retained_transfer' && row.status === 'blocked')).toBe(false)
  const again = await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: planId,
    expectedPlanRecordRevision: 1, idempotencyKey: 'retained_reflow_again_1234567890' })
  expect(again.preservedSessionIds).toContain(bound[0]!._id)
  expect(await f.t.run(ctx => ctx.db.get(bound[0]!._id))).toEqual(bound[0])
})

test.each(['expiry', 'manual'] as const)('%s missed handling finds fixed checks on a reflow ancestor without changing their pins', async mode => {
  const f = await fixture()
  const check = await openDelayedCheck(f, 7, mode === 'expiry')
  await f.t.run(ctx => seedFixedCheckPlan(ctx, userId, f.graph, Date.now()))
  await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: f.graph.studyPlanRevisionId,
    expectedPlanRecordRevision: 1, idempotencyKey: 'missed_ancestor_reflow_1234567890' })
  const session = (await f.t.run(ctx => ctx.db.get(check.today.sessionId)))!
  vi.setSystemTime(check.before.closeAt + (mode === 'manual' ? 1 : 0))
  if (mode === 'expiry') expect(await f.owner.mutation(api.learnV2Plans.markExpiredSessionsMissed,
    { learningVoidId: f.graph.learningVoidId, idempotencyKey: 'missed_ancestor_expire_1234567890' })).toMatchObject({ missedSessionIds: expect.arrayContaining([session._id]) })
  else expect(await f.owner.mutation(api.learnV2Plans.markStudySessionMissed, { studySessionId: session._id,
    expectedSessionRevision: session.revision, idempotencyKey: 'missed_ancestor_manual_1234567890' })).toMatchObject({ status: 'missed', revision: session.revision })
  expect(await f.t.run(ctx => ctx.db.get(session._id))).toMatchObject({ status: 'missed', revision: session.revision,
    scheduledStartAt: session.scheduledStartAt, scheduledEndAt: session.scheduledEndAt })
  expect((await f.opportunities()).find(row => row._id === check.before._id)!.contextPins).toEqual(check.before.contextPins)
  await f.t.mutation(due, { userId, through: Date.now() })
  expect((await f.opportunities()).find(row => row._id === check.before._id)).toMatchObject({ phase: 'abandoned', reasonCode: 'missed_window' })
  const day30 = (await f.opportunities()).find(row => row.horizonDays === 30)!
  vi.setSystemTime(day30.openAt + 1000)
  await f.t.mutation(due, { userId, through: Date.now() })
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', assessment: { state: { assessmentOpportunityId: day30._id } } })
})

test('disabled lifecycle cleanup preserves an existing active check session', async () => {
  const f = await fixture()
  const check = await openDelayedCheck(f)
  const before = await f.t.run(ctx => ctx.db.get(check.today.sessionId))
  vi.setSystemTime(check.before.closeAt + 1)
  policy.responses = false
  await f.owner.mutation(api.learnV2Plans.markExpiredSessionsMissed, { learningVoidId: f.graph.learningVoidId, idempotencyKey: 'off_check_cleanup_1234567890' })
  await f.t.mutation(due, { userId, through: Date.now() })
  expect(await f.owner.mutation(api.learnV2Responses.terminalizeResponse, { version: LEARN_V2_PUBLIC_API_VERSION,
    target: { assessmentOpportunityId: check.before._id }, expectedRevision: check.before.revision,
    idempotencyKey: 'off_check_terminal_1234567890', reason: 'cancelled' })).toMatchObject({ status: 'disabled' })
  expect(await f.t.run(ctx => ctx.db.get(check.today.sessionId))).toEqual(before)
})

test('ordinary completed session recovery keeps its existing behavior', async () => {
  const f = await fixture()
  await f.seal()
  await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)
  await f.t.run(ctx => ctx.db.patch(f.graph.studySessionId, { status: 'completed' }))
  expect(await f.owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: f.graph.studySessionId })).toBeNull()
  await expect(f.owner.mutation(api.learnV2SessionContent.startStudySession, { ...f.request,
    idempotencyKey: 'ordinary_completed_restart_1234567890' })).rejects.toThrow('Study session is not ready')
})

test('expiration terminalizes a started dedicated check while preserving ordinary sessions and opportunity pins', async () => {
  const f = await fixture()
  await f.seal()
  await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)
  const ordinary = (await f.t.run(ctx => ctx.db.get(f.graph.studySessionId)))!
  const day7 = (await f.opportunities()).find(row => row.horizonDays === 7)!
  vi.setSystemTime(day7.openAt + 1000)
  await f.t.mutation(due, { userId, through: Date.now() })
  const today = await f.owner.query(api.learnV2Today.getToday, {})
  if (today.status !== 'ready') throw new Error('Expected day 7')
  await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: today.sessionId,
    expectedSessionRevision: today.sessionRevision, expectedContentRevision: today.content.revision, idempotencyKey: 'missed_check_start_1234567890' })
  const before = (await f.opportunities()).find(row => row._id === day7._id)!
  vi.setSystemTime(day7.closeAt)
  const missed = await f.owner.mutation(api.learnV2Plans.markExpiredSessionsMissed, { learningVoidId: f.graph.learningVoidId, idempotencyKey: 'missed_check_cleanup_1234567890' })
  expect(missed.missedSessionIds).toContain(today.sessionId)
  await f.t.run(async ctx => {
    expect(await ctx.db.get(today.sessionId)).toMatchObject({ status: 'missed', missedAt: day7.closeAt })
    expect(await ctx.db.get(f.graph.studySessionId)).toEqual(ordinary)
    expect((await ctx.db.get(day7._id))!.contextPins).toEqual(before.contextPins)
  })
  await f.t.mutation(due, { userId, through: Date.now() })
  expect((await f.opportunities()).find(row => row._id === day7._id)).toMatchObject({ phase: 'abandoned', reasonCode: 'missed_window' })
  const day30 = (await f.opportunities()).find(row => row.horizonDays === 30)!
  vi.setSystemTime(day30.openAt + 1000)
  await f.t.mutation(due, { userId, through: Date.now() })
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', assessment: { state: { assessmentOpportunityId: day30._id } } })
})

test.each([7, 30] as const)('Today discovers, grants, seals and scores its original day-%s case below Independent', async horizon => {
  const f = await fixture()
  const cold = await f.seal()
  await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: cold.accepted.submissionId, idempotencyKey: 'delayed_journey_cold_score_1234567890' })
  await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)
  expect(JSON.stringify(await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery,
    { studySessionId: f.graph.studySessionId, idempotencyKey: 'future_check_allows_lesson_1234567890' }))).toContain('TEACHING-CANARY-explanation')
  const original = (await f.opportunities()).find(row => row.horizonDays === horizon)!
  if (horizon === 30) {
    const day7 = (await f.opportunities()).find(row => row.horizonDays === 7)!
    vi.setSystemTime(day7.openAt)
    await runLearnDueCron(f.t)
  }
  vi.setSystemTime(original.openAt + 1000)
  await runLearnDueCron(f.t)
  await f.t.mutation(due, { userId, through: Date.now() })
  const today = await f.owner.query(api.learnV2Today.getToday, {})
  expect(today).toMatchObject({ status: 'ready', mastery: { state: 'unseen' }, assessment: { kind: 'check', state: { assessmentOpportunityId: original._id } } })
  if (today.status !== 'ready') throw new Error('Expected a due check')
  expect(today.sessionId).not.toBe(f.graph.studySessionId)
  expect(JSON.stringify(await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery,
    { studySessionId: f.graph.studySessionId, idempotencyKey: 'open_check_denies_lesson_1234567890' }))).not.toContain('TEACHING-CANARY')
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: today.sessionId,
    expectedSessionRevision: today.sessionRevision, expectedContentRevision: today.content.revision, idempotencyKey: 'start_due_today_check_1234567890' }))
    .toMatchObject({ status: 'assessment', deliveryGrant: { status: 'granted' } })
  const delivered = await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery,
    { studySessionId: today.sessionId, idempotencyKey: 'deliver_due_today_check_1234567890' })
  if (original.assessmentPins.kind !== 'measurement') throw new Error('Expected measurement pins')
  const itemId = original.assessmentPins.itemPins.itemId
  const item = await f.t.run(ctx => ctx.db.get(itemId))
  expect(JSON.stringify(delivered)).toContain(item!.prompt)
  for (const sibling of f.generated.members.filter(member => member.prompt !== item!.prompt)) expect(JSON.stringify(delivered)).not.toContain(sibling.prompt)
  for (const secret of PRIVATE) expect(JSON.stringify(delivered)).not.toContain(secret)
  const numbers = /groups=(\d+), size=(\d+)/u.exec(item!.declaredStimulus!)!
  const current = (await f.opportunities()).find(row => row._id === original._id)!
  const accepted = await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: 'seal_due_today_check_1234567890', response: { target: { assessmentOpportunityId: original._id }, expectedRevision: current.revision,
      payload: { kind: 'numeric', value: Number(numbers[1]) * Number(numbers[2]), unit: 'members' } } } })
  if (accepted.kind !== 'accepted') throw new Error(JSON.stringify(accepted))
  const acceptedPins = await f.t.run(async ctx => responseContextPins(await ctx.db.get(accepted.submissionId)))
  expect(await f.t.run(ctx => ctx.db.get(today.sessionId))).toMatchObject({ status: 'completed', revision: current.contextPins.kind === 'session' ? current.contextPins.sessionRevision : 0 })
  expect(await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: accepted.submissionId, idempotencyKey: 'score_due_today_check_1234567890' })).toMatchObject({ status: 'scored', result: { scorePercent: 100 } })
  await f.t.run(async ctx => {
    const row = (await ctx.db.get(original._id))!
    const attempt = (await ctx.db.get(row.authoritativeAttemptId!))!
    expect(await ctx.db.get(today.sessionId)).toMatchObject({ status: 'completed' })
    expect(await ctx.db.get(accepted.submissionId)).toMatchObject({ contextPins: acceptedPins })
    expect(attempt).toMatchObject({ kind: 'measurement_delayed', horizonDays: horizon, masteryStateBefore: 'unseen', masteryStateAfter: 'unseen' })
    expect(await ctx.db.get(row.deliveryGrantId!)).toMatchObject({ assessmentOpportunityId: row._id,
      caseId: item!.caseId, provenanceVersion: 'learn-v2.assessment-delivery.today.v1' })
    expect(await ctx.db.query('learnAssessmentOpportunities').take(8)).toHaveLength(4)
    if (horizon === 30) expect((await ctx.db.query('learnAssessmentOpportunities').take(8)).find(opportunity => opportunity.horizonDays === 7)).toMatchObject({ phase: 'abandoned', reasonCode: 'missed_window' })
  })
})

test.each([false, true])('Today enrolls, seals and scores cold, then scores a separate application with first-claim and assistance rules: assisted=%s', async assisted => {
  const f = await fixture()
  const sealed = await f.seal()
  const network = ordinaryScorer()
  expect(await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: sealed.accepted.submissionId, idempotencyKey: 'today_cold_score_1234567890' })).toMatchObject({ status: 'scored', result: { scorePercent: 0 } })
  expect(network).not.toHaveBeenCalled()
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)).toMatchObject({ status: 'in_progress' })
  const delivery = await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.graph.studySessionId, idempotencyKey: 'ordinary_lesson_delivery_1234567890' })
  expect(JSON.stringify(delivery)).toContain('TEACHING-CANARY-explanation')
  expect(JSON.stringify(delivery)).not.toContain('TEACHING-CANARY-worked_example')
  if (assisted) expect(await f.owner.mutation(api.learnV2Mastery.recordAssistanceUse, { studySessionId: f.graph.studySessionId,
    expectedSessionRevision: 3, kind: 'substantive_hint' })).toMatchObject({ revision: 4, assistance: { content: expect.stringContaining('TEACHING-CANARY-faded_example') } })
  const ordinary = (await f.opportunities()).find(row => row.purpose.kind === 'independent_application')!
  expect(ordinary).toMatchObject({ phase: 'test_open', contextPins: { kind: 'session', studySessionId: f.graph.studySessionId, sessionRevision: assisted ? 4 : 3, sessionContentId: f.contentId } })
  expect(ordinary.assessmentPins.kind).toBe('session_application')
  expect(ordinary.scoringBinding).toMatchObject({ kind: 'model', scorerVersion: 'learn-v2.mastery-scorer.v1', requestedModel: 'synthetic/model' })
  const acceptedAt = Date.now()
  const result = await f.owner.action(api.learnV2Mastery.submitMasteryAttempt, { studySessionId: f.graph.studySessionId,
    expectedSessionRevision: assisted ? 4 : 3, expectedContentRevision: 1, expectedPlanRecordRevision: 1, expectedBlueprintRecordRevision: 1,
    response: 'My separate-case application.', confidence: 3, idempotencyKey: 'ordinary_application_after_cold_1234567890' })
  expect(result).toMatchObject({ status: 'completed', state: assisted ? 'guided' : 'independent', scorePercent: 100 })
  expect(network).toHaveBeenCalledTimes(1)
  await f.t.run(async ctx => {
    const attempts = await ctx.db.query('masteryAttempts').take(8)
    expect(attempts).toHaveLength(2)
    expect(attempts.find(row => row.kind === 'measurement_cold')).toMatchObject({ masteryStateAfter: 'unseen' })
    const basis = attempts.find(row => row.kind === 'independent_application')!
    expect(basis).toMatchObject({ acceptedAt, assistanceSnapshot: { state: assisted ? 'assisted' : 'unassisted' }, masteryStateAfter: assisted ? 'guided' : 'independent' })
    const facts = await ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId', q => q.eq('userId', userId)).take(64)
    const claims = facts.filter(row => row.fact.kind === 'independent_claim_v2')
    expect(claims).toHaveLength(assisted ? 0 : 1)
    if (assisted) return
    const day7 = (await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q => q.eq('userId', userId)).take(8)).find(row => row.horizonDays === 7)!
    expect(claims[0]!.fact).toMatchObject({ version: 'learn-v2.first-independent-claim.v2', basisAttemptId: basis._id,
      firstIndependentAt: acceptedAt, firstSlot: { kind: 'linked', firstCheckOpportunityId: day7._id }, stratum: { flow: 'v2_today' } })
    expect(day7.originalSlot).toBe(true)
    expect(day7.firstCheckClaim?.basisAttemptId).toBe(basis._id)
    const retained = (await ctx.db.query('studySessions').take(8)).filter(row => row.placementKind === 'retained_review')
    expect(retained).toEqual([expect.objectContaining({ status: 'ready', assessmentOpportunityId: day7._id, assessmentPurpose: 'measurement_delayed' })])
  })
  if (!assisted) {
    const retained = (await f.opportunities()).find(row => row.horizonDays === 7)!
    vi.setSystemTime(retained.openAt)
    await runLearnDueCron(f.t)
    expect((await f.opportunities()).find(row => row._id === retained._id)).toMatchObject({ phase: 'ready', operationalEligibility: 'eligible', eligibleAt: retained.openAt })
    const day30 = (await f.opportunities()).find(row => row.horizonDays === 30)!
    vi.setSystemTime(day30.openAt + 1000)
    await f.t.mutation(due, { userId, through: Date.now() })
    expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', assessment: { state: { assessmentOpportunityId: day30._id } } })
    const day7 = (await f.opportunities()).find(row => row.horizonDays === 7)!
    expect(day7).toMatchObject({ phase: 'abandoned', reasonCode: 'missed_window', firstCheckClaim: { basisAttemptId: expect.any(String) }, checkSequence: 1 })
    expect((await f.opportunities()).find(row => row.horizonDays === 30)!.firstCheckClaim).toBeUndefined()
    const facts = await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId', q => q.eq('userId', userId)).take(96))
    expect(facts.find(row => row.fact.kind === 'independent_claim_v2')?.fact).toMatchObject({ firstSlot: { kind: 'linked', firstCheckOpportunityId: day7._id } })
  }
})

test('day 30 remains discoverable below Independent after an authoritative day-7 failure', async () => {
  const f = await fixture()
  const cold = await f.seal()
  await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: cold.accepted.submissionId, idempotencyKey: 'failed_day7_cold_score_1234567890' })
  const day7 = (await f.opportunities()).find(row => row.horizonDays === 7)!
  vi.setSystemTime(day7.openAt + 1000)
  await f.t.mutation(due, { userId, through: Date.now() })
  const today = await f.owner.query(api.learnV2Today.getToday, {})
  if (today.status !== 'ready') throw new Error('Expected day 7')
  await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: today.sessionId,
    expectedSessionRevision: today.sessionRevision, expectedContentRevision: today.content.revision, idempotencyKey: 'failed_day7_start_1234567890' })
  const current = (await f.opportunities()).find(row => row._id === day7._id)!
  const accepted = await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: 'failed_day7_seal_1234567890', response: { target: { assessmentOpportunityId: day7._id }, expectedRevision: current.revision,
      payload: { kind: 'numeric', value: 0, unit: 'members' } } } })
  if (accepted.kind !== 'accepted') throw new Error('Expected a sealed failure')
  expect(await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: accepted.submissionId, idempotencyKey: 'failed_day7_score_1234567890' })).toMatchObject({ status: 'scored', result: { scorePercent: 0 } })
  const day30 = (await f.opportunities()).find(row => row.horizonDays === 30)!
  vi.setSystemTime(day30.openAt + 1000)
  await f.t.mutation(due, { userId, through: Date.now() })
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', mastery: { state: 'unseen' },
    assessment: { kind: 'check', state: { assessmentOpportunityId: day30._id } } })
  expect((await f.opportunities()).find(row => row._id === day7._id)).toMatchObject({ phase: 'scored_fail' })
})

test.each(['no_item', 'protocol_not_frozen'] as const)('retained follow-up resolves to an explicit %s block instead of a planned shell', async reason => {
  const f = await fixture()
  if (reason === 'no_item') await f.t.run(ctx => ctx.db.patch(f.begun.familyId, { status: 'quarantined' }))
  else {
    const cold = await f.seal()
    await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
      submissionId: cold.accepted.submissionId, idempotencyKey: 'retained_unavailable_cold_1234567890' })
  }
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)).toMatchObject({ status: 'in_progress' })
  if (reason === 'protocol_not_frozen') policy.protocol = null
  ordinaryScorer()
  expect(await f.owner.action(api.learnV2Mastery.submitMasteryAttempt, { studySessionId: f.graph.studySessionId,
    expectedSessionRevision: 3, expectedContentRevision: 1, expectedPlanRecordRevision: 1, expectedBlueprintRecordRevision: 1,
    response: 'My separate-case application.', confidence: 3, idempotencyKey: 'retained_unavailable_application_1234567890' }))
    .toMatchObject({ status: 'completed', state: 'independent' })
  const shell = (await f.t.run(ctx => ctx.db.query('studySessions').take(8))).find(row => row.placementKind === 'retained_review')!
  expect(shell).toMatchObject({ status: 'blocked', assessmentPurpose: 'retained_transfer', auditReasonCode: reason })
  expect(shell.assessmentOpportunityId).toBeUndefined()
  vi.setSystemTime(shell.scheduledStartAt + 1000)
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'blocked', reason, canRetryGeneration: false })
})

test('starting an ordinary application cannot upgrade unknown assistance history', async () => {
  const f = await fixture()
  await f.t.run(ctx => ctx.db.patch(f.graph.catalogId, { historyCompleteness: 'unknown' }))
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)).toMatchObject({ status: 'in_progress' })
  expect(await f.t.run(ctx => ctx.db.get(f.graph.studySessionId))).not.toHaveProperty('assistanceRevision')
  const application = (await f.opportunities()).find(row => row.purpose.kind === 'independent_application')!
  const accepted = await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: 'unknown_history_application_1234567890', response: { target: { assessmentOpportunityId: application._id }, expectedRevision: application.revision,
      payload: { kind: 'text', text: 'An ordinary application response.' }, confidence: 3 } } })
  expect(accepted.kind).toBe('accepted')
  if (accepted.kind !== 'accepted') throw new Error('Expected saved response')
  expect(await f.t.run(ctx => ctx.db.get(accepted.submissionId))).toMatchObject({ assistanceSnapshot: { state: 'unknown' } })
})

test.each(['no_grant', 'open', 'sealed', 'pending', 'scored', 'revoked'] as const)('both Today entry points enforce the %s disclosure boundary', async state => {
  for (const entryPoint of ['today', 'session_deep_link'] as const) {
    const f = await fixture()
    if (state === 'open' || state === 'revoked') await f.open(entryPoint)
    if (state === 'sealed') await f.seal(entryPoint)
    if (state === 'pending') await f.pending(entryPoint)
    if (state === 'scored') {
      const pending = await f.pending(entryPoint)
      await f.owner.mutation(mastery.commitSealedMasteryAttempt, { ...pending.command, executionId: pending.executionId })
    }
    if (state === 'revoked') await f.t.run(ctx => ctx.db.patch(f.graph.sourceSnapshotId, { evidencePurgedAt: Date.now() }))
    const reads = await f.reads()
    const coldForm = (await f.cold())?.assessmentPins
    const coldLabel = coldForm?.kind === 'measurement' ? coldForm.itemPins.formLabel : null
    for (const [name, value] of Object.entries(reads)) {
      const serialized = JSON.stringify(value)
      for (const canary of PRIVATE) expect(serialized, `${state}:${entryPoint}:${name}`).not.toContain(canary)
      const teachingAllowed = name === 'delivery' && ['sealed', 'pending', 'scored'].includes(state)
      if (!teachingAllowed) for (const canary of TEACHING) expect(serialized, `${state}:${entryPoint}:${name}`).not.toContain(canary)
      if (name === 'today' || name === 'candidate' || ['no_grant', 'revoked'].includes(state)) expect(forms(value).size, `${state}:${name}`).toBe(0)
      else expect([...forms(value)].every(label => label === coldLabel)).toBe(true)
    }
    if (state === 'open') {
      expect(reads.today).toMatchObject({ status: 'ready', assessment: { kind: 'check', state: { phase: 'test_open' } } })
      expect(reads.content).toMatchObject({ blocks: [], claims: [], supports: [], delivered: { status: 'delivered', phase: 'test_open' } })
    }
    if (state === 'no_grant') expect(reads.today).toMatchObject({ status: 'ready', assessment: { kind: 'unprepared' } })
    if (state === 'revoked') expect(reads.today).toMatchObject({ status: 'blocked', reason: 'evidence_unavailable' })
    if (['sealed', 'pending', 'scored'].includes(state)) {
      expect(JSON.stringify(reads.content)).toContain('"value":0')
      expect(JSON.stringify(reads.delivery)).toContain('TEACHING-CANARY-explanation')
    }
    if (state === 'pending') {
      expect(JSON.stringify(reads.content)).toContain('scoring_pending')
      for (const field of ['scorePercent', 'feedbackCodes', 'diagnosis', 'retained']) expect(JSON.stringify(reads)).not.toContain(field)
    }
    expect(await f.t.run(ctx => ctx.db.query('learnMeasurementAssignments').take(4))).toEqual(state === 'no_grant' ? [] : [expect.objectContaining({ entryPoint, flow: 'v2_today' })])
  }
})

test('one grant survives cross-tab starts, both entry points, lost responses and public retries', async () => {
  const f = await fixture()
  const [first, second] = await Promise.all((['session_deep_link', 'today'] as const).map(entryPoint => f.owner.mutation(api.learnV2SessionContent.startStudySession,
    { ...f.request, entryPoint, idempotencyKey: `cross_tab_${entryPoint}` })))
  if (first.status !== 'assessment' || first.deliveryGrant?.status !== 'granted') throw new Error('Expected a grant')
  expect(second).toMatchObject({ status: 'assessment', deliveryGrant: { deliveryGrantId: first.deliveryGrant.deliveryGrantId } })
  const lost = await f.owner.mutation(api.learnV2SessionContent.startStudySession, { ...f.request, entryPoint: 'session_deep_link', idempotencyKey: 'cross_tab_session_deep_link' })
  expect(lost).toMatchObject({ deliveryGrant: { deliveryGrantId: first.deliveryGrant.deliveryGrantId } })
  const opportunity = await f.cold()
  const publicGrant = await f.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, { version: LEARN_V2_PUBLIC_API_VERSION,
    assessmentOpportunityId: opportunity._id, expectedRevision: 1, idempotencyKey: 'another_tab_public_grant' })
  expect(publicGrant).toMatchObject({ status: 'granted', deliveryGrantId: first.deliveryGrant.deliveryGrantId })
  await expect(f.owner.mutation(api.learnV2SessionContent.retrySessionContentGeneration, { studySessionId: f.graph.studySessionId,
    expectedSessionRevision: 2, idempotencyKey: 'no_reroll_after_grant' })).rejects.toThrow()
  expect(await f.opportunities()).toHaveLength(1)
  expect(await f.exposures()).toEqual([expect.objectContaining({ _id: first.deliveryGrant.deliveryGrantId, purpose: 'cold_measurement', status: 'granted' })])
  expect(await f.t.run(ctx => ctx.db.query('learnMeasurementAssignments').take(4))).toEqual([expect.objectContaining({ entryPoint: 'session_deep_link' })])
  expect(forms(await f.reads()).size).toBe(1)
})

test('no teaching payload leaves Today before the cold check is sealed', async () => {
  const f = await fixture()
  for (let attempt = 0; attempt < 2; attempt++) {
    const reads = await f.reads(`pre_seal_${attempt}`)
    for (const canary of TEACHING) expect(JSON.stringify(reads)).not.toContain(canary)
    expect(reads.delivery).toMatchObject({ value: { blocks: [], claims: [], supports: [] } })
    if (!attempt) await f.open()
  }
  expect((await f.exposures()).filter(row => row.purpose === 'teaching')).toHaveLength(0)
  expect(await f.t.run(ctx => ctx.db.get(f.graph.studySessionId))).toMatchObject({ status: 'ready' })
})

test('sealing permits separate-case teaching before scoring, recorded once with frozen assistance', async () => {
  const f = await fixture()
  const sealed = await f.seal()
  const started = await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)
  expect(started.status).toBe('in_progress')
  const content = await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.graph.studySessionId, idempotencyKey: 'post_seal_teaching_delivery' })
  expect(JSON.stringify(content)).toContain('TEACHING-CANARY-explanation')
  for (const canary of PRIVATE) expect(JSON.stringify(content)).not.toContain(canary)
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)).toEqual(started)
  expect(await f.t.run(ctx => ctx.db.get(sealed.accepted.submissionId))).toMatchObject({ assistanceSnapshot: { state: 'unassisted' } })
  expect((await f.exposures()).filter(row => row.purpose === 'teaching')).toEqual([expect.objectContaining({ provenanceVersion: 'learn-v2.instructional-flow.v2_today.v1' })])
  expect(await f.cold()).toMatchObject({ operationalEligibility: 'eligible', phase: 'submitted_sealed' })
  expect(await f.t.run(ctx => ctx.db.query('masteryAttempts').take(8))).toHaveLength(0)
})

test('provider failure after seal reveals no score or diagnosis and keeps separate-case teaching', async () => {
  const f = await fixture()
  const pending = await f.pending()
  await f.owner.mutation(mastery.failSealedMasteryScoring, { ...pending.command, leaseToken: pending.reserved.leaseToken })
  expect(['retryable_failure', 'reconciliation_required']).toContain((await f.cold()).phase)
  const reads = await f.reads('provider_failure_delivery')
  for (const field of ['scorePercent', 'feedbackCodes', 'diagnosis', 'scored_pass', 'scored_fail']) expect(JSON.stringify(reads)).not.toContain(field)
  expect(JSON.stringify(reads.delivery)).toContain('TEACHING-CANARY-explanation')
  expect(await f.t.run(ctx => ctx.db.query('masteryAttempts').take(8))).toHaveLength(0)
})

test('source loss before enrollment, before the grant and after the seal never falls back to a lesson', async () => {
  const unenrolled = await fixture()
  await unenrolled.t.run(ctx => ctx.db.patch(unenrolled.graph.sourceSnapshotId, { evidencePurgedAt: Date.now() }))
  await unenrolled.owner.mutation(api.learnV2SessionContent.startStudySession, unenrolled.request)
  expect(await unenrolled.t.run(ctx => ctx.db.query('learnMeasurementAssignments').unique())).toMatchObject({ status: 'not_admitted' })
  for (const canary of [...TEACHING, ...PRIVATE]) expect(JSON.stringify(await unenrolled.reads('unenrolled_source_loss'))).not.toContain(canary)
  expect(await unenrolled.exposures()).toHaveLength(0)

  const before = await fixture()
  await before.owner.mutation(measurement.enrollProspect, { studySessionId: before.graph.studySessionId, familyId: before.begun.familyId, entryPoint: 'today' })
  await before.t.run(ctx => ctx.db.patch(before.graph.sourceSnapshotId, { evidencePurgedAt: Date.now() }))
  const blocked = await before.owner.mutation(api.learnV2SessionContent.startStudySession, before.request)
  expect(blocked).toMatchObject({ status: 'assessment', assessment: { reasonCode: 'evidence_unavailable' }, deliveryGrant: null })
  for (const canary of [...TEACHING, ...PRIVATE]) expect(JSON.stringify(await before.reads('enrolled_source_loss'))).not.toContain(canary)
  expect(await before.exposures()).toHaveLength(0)

  const after = await fixture()
  await after.seal()
  await after.t.run(ctx => ctx.db.patch(after.graph.sourceSnapshotId, { evidencePurgedAt: Date.now() }))
  const reads = await after.reads('revoked_after_seal')
  for (const canary of [...TEACHING, ...PRIVATE]) expect(JSON.stringify(reads)).not.toContain(canary)
  expect(await after.owner.mutation(api.learnV2SessionContent.startStudySession, after.request)).toMatchObject({ status: 'assessment' })
  expect((await after.exposures()).filter(row => row.purpose === 'teaching')).toHaveLength(0)
})

test('a missing protocol blocks the episode; a recorded non-admission continues the ordinary lesson', async () => {
  const f = await fixture()
  policy.protocol = null
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)).toMatchObject({ status: 'assessment', assessment: { reasonCode: 'protocol_not_frozen' }, deliveryGrant: null })
  for (const canary of TEACHING) expect(JSON.stringify(await f.reads('no_protocol'))).not.toContain(canary)
  policy.protocol = syntheticDeliveryProtocol()
  await f.t.run(ctx => ctx.db.patch(f.begun.familyId, { status: 'quarantined' }))
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)).toMatchObject({ status: 'in_progress' })
  expect(await f.t.run(ctx => ctx.db.query('learnMeasurementAssignments').unique())).toMatchObject({ status: 'not_admitted', exclusionReasons: expect.arrayContaining(['novel_item_unavailable']) })
  expect(await f.opportunities()).toEqual([expect.objectContaining({ purpose: { kind: 'independent_application' } })])
  expect(JSON.stringify(await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.graph.studySessionId, idempotencyKey: 'ordinary_lesson' }))).toContain('TEACHING-CANARY')
})

test('a missed cold check releases the lesson and records teaching before measurement', async () => {
  const f = await fixture()
  await f.open()
  expect(JSON.stringify(await f.reads('cold_open'))).not.toContain('TEACHING-CANARY')
  vi.advanceTimersByTime(3_600_000)
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', assessment: { kind: 'teach' } })
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, { ...f.request, idempotencyKey: 'after_missed_cold' })).toMatchObject({ status: 'in_progress' })
  expect(await f.cold()).toMatchObject({ phase: 'abandoned', operationalEligibility: 'blocked' })
  expect(JSON.stringify(await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.graph.studySessionId, idempotencyKey: 'missed_cold_lesson' }))).toContain('TEACHING-CANARY')
  expect((await f.exposures()).filter(row => row.purpose === 'teaching')).toHaveLength(1)
})

test('a Canvas episode cannot launder its cold check or teaching through Today', async () => {
  const f = await fixture()
  await f.owner.mutation(measurement.enrollProspect, { studySessionId: f.graph.studySessionId, familyId: f.begun.familyId, entryPoint: 'today' })
  const assignment = await f.t.run(ctx => ctx.db.query('learnMeasurementAssignments').unique())
  await f.t.run(ctx => ctx.db.patch(assignment!._id, { flow: 'v2_canvas' }))
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)).toMatchObject({ status: 'assessment', assessment: { reasonCode: 'flow_mismatch' }, deliveryGrant: null })
  const opportunity = await f.cold()
  expect(await f.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, { version: LEARN_V2_PUBLIC_API_VERSION,
    assessmentOpportunityId: opportunity._id, expectedRevision: opportunity.revision, idempotencyKey: 'launder_canvas_episode_grant' })).toMatchObject({ reasonCodes: ['flow_mismatch'] })
  const reads = await f.reads('canvas_episode')
  for (const canary of [...TEACHING, ...PRIVATE]) expect(JSON.stringify(reads)).not.toContain(canary)
  expect(forms(reads).size).toBe(0)
  expect(await f.exposures()).toHaveLength(0)
})

test('owners outside the measurement catalogue and capability-off sessions keep the ordinary Today path', async () => {
  for (const variant of ['responses_off', 'enrollment_off', 'catalogue_off'] as const) {
    const f = await fixture()
    policy.responses = variant !== 'responses_off'
    policy.enrollment = variant !== 'enrollment_off'
    if (variant === 'catalogue_off') await f.t.run(ctx => ctx.db.patch(f.graph.catalogId, { measurementCapability: { enabled: false } }))
    const today = await f.owner.query(api.learnV2Today.getToday, {})
    expect(today).toMatchObject({ status: 'ready', content: { assessmentRubricVersion: 'learn-v2.assessment.v1' } })
    expect(today).not.toHaveProperty('assessment')
    expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)).toEqual({ status: 'in_progress', sessionContentId: f.contentId, sessionContentRevision: 1 })
    expect(JSON.stringify(await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.graph.studySessionId, idempotencyKey: `ordinary_${variant}` }))).toContain('TEACHING-CANARY')
    expect(await f.t.run(ctx => ctx.db.query('learnMeasurementAssignments').take(4))).toHaveLength(0)
    expect(await f.exposures()).toHaveLength(0)
  }
})

test('a retained_review placement stays test-only and blocks without an opportunity', async () => {
  const f = await fixture()
  await f.t.run(ctx => ctx.db.patch(f.graph.studySessionId, { placementKind: 'retained_review' }))
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'blocked', reason: 'assessment_unavailable', canRetryGeneration: false })
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)).toMatchObject({ status: 'assessment', assessment: { kind: 'blocked' }, deliveryGrant: null })
  const reads = await f.reads('retained_review')
  for (const canary of [...TEACHING, ...PRIVATE]) expect(JSON.stringify(reads)).not.toContain(canary)
  await expect(f.owner.mutation(api.learnV2SessionContent.retrySessionContentGeneration, { studySessionId: f.graph.studySessionId,
    expectedSessionRevision: 2, idempotencyKey: 'retained_retry' })).rejects.toThrow('Assessment generation cannot be retried')
})

async function sealedWithDelayedSlots() {
  const f = await fixture()
  await f.seal()
  await f.t.mutation(due, { userId })
  const delayed = (await f.opportunities()).filter(row => row.purpose.kind === 'measurement_delayed')
  expect(delayed.map(row => [row.horizonDays, row.phase])).toEqual(expect.arrayContaining([[7, 'preparing'], [30, 'preparing']]))
  expect(delayed.every(row => row.openAt > Date.now())).toBe(true)
  return { ...f, delayed: delayed as Array<Doc<'learnAssessmentOpportunities'>> }
}

test('help admission: a future day-7 opportunity allows separate-case teaching after a sealed cold check', async () => {
  const f = await sealedWithDelayedSlots()
  const first = await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.graph.studySessionId, idempotencyKey: 'future_slot_teaching' })
  expect(first.admission.status).not.toBe('denied')
  expect(JSON.stringify(first)).toContain('TEACHING-CANARY-explanation')
  await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.graph.studySessionId, idempotencyKey: 'future_slot_teaching_again' })
  const exposures = await f.exposures()
  expect(exposures.filter(row => row.status === 'requested_denied')).toHaveLength(0)
  const intervening = exposures.filter(row => row.provenanceVersion === 'learn-v2.intervening-learning.v1')
  expect(intervening).toHaveLength(2)
  expect(intervening.every(row => row.assessmentOpportunityId === undefined && row.caseId === undefined && row.assignmentId === f.delayed[0]!.assignmentId)).toBe(true)
})

test('help admission: a delayed opportunity at or past openAt is denied even before due work runs', async () => {
  const f = await sealedWithDelayedSlots()
  const day7 = f.delayed.find(row => row.horizonDays === 7)!
  vi.setSystemTime(day7.openAt)
  const denied = await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.graph.studySessionId, idempotencyKey: 'past_open_teaching' })
  expect(denied).toMatchObject({ admission: { status: 'denied' }, value: null })
  expect((await f.exposures()).filter(row => row.status === 'requested_denied' && row.assessmentOpportunityId === day7._id)).toHaveLength(1)
})

test('help admission: unknown delayed timing is denied', async () => {
  const f = await sealedWithDelayedSlots()
  const day30 = f.delayed.find(row => row.horizonDays === 30)!
  await f.t.run(ctx => ctx.db.patch(day30._id, { openAt: Number.NaN }))
  const denied = await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.graph.studySessionId, idempotencyKey: 'unknown_timing_teaching' })
  expect(denied).toMatchObject({ admission: { status: 'denied' }, value: null })
  expect(JSON.stringify(denied)).not.toContain('TEACHING-CANARY')
})

test('help admission: the reserved case and its sibling forms are never taught', async () => {
  const f = await sealedWithDelayedSlots()
  const block = await f.t.run(ctx => ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', f.contentId)).first())
  const pins = await normalizedInstructionalCaseFingerprints(block!.content!, block!.content!)
  await f.t.run(async ctx => {
    const row = await ctx.db.query('learnAssessmentCases').withIndex('by_userId_and_scenarioFingerprint_and_solutionFingerprint', q => q.eq('userId', userId).eq('scenarioFingerprint', pins.scenarioFingerprint).eq('solutionFingerprint', pins.solutionFingerprint)).unique()
    await ctx.db.patch(row!._id, { reservedAt: Date.now() })
  })
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)).toMatchObject({ status: 'assessment', assessment: { reasonCode: 'instructional_holdout_unknown' } })
  const reads = await f.reads('reserved_case')
  for (const canary of [...TEACHING, ...PRIVATE]) expect(JSON.stringify(reads)).not.toContain(canary)
  const cold = (await f.cold()).assessmentPins
  const allowed = cold.kind === 'measurement' ? cold.itemPins.formLabel : null
  expect([...forms(reads)].every(label => label === allowed)).toBe(true)
  expect((await f.exposures()).filter(row => row.purpose === 'teaching')).toHaveLength(0)
})

test.each([false, true])('published repeated-source inventory fits Today start: limits=%s', async transactionLimits => {
  const f = await fixture({ inventory: { claims: 32, supports: 2, sources: 2 }, transactionLimits })
  const measured = await f.owner.mutation(async ctx => {
    const value = await ctx.runMutation(api.learnV2SessionContent.startStudySession, f.request)
    return { value, metrics: await ctx.meta.getTransactionMetrics() }
  })
  console.info('delivery-read-budget', JSON.stringify({ path: 'today-start', transactionLimits, queries: measured.metrics.databaseQueries.used,
    documents: measured.metrics.documentsRead.used, bytes: measured.metrics.bytesRead.used }))
  expect(measured.value).toMatchObject({ status: 'assessment', assessment: { kind: 'check' }, deliveryGrant: { status: 'granted' } })
  expect(measured.metrics.databaseQueries.used).toBeLessThan(3072)
})

test.each([{ reserves: 3, claims: 32, supports: 2, extraSupports: 0, backingDocuments: true }, { reserves: 3, claims: 8, supports: 8, extraSupports: 0 }])('published inventory fits Today start: %j', async shape => {
  const f = await fixture({ reserveCount: shape.reserves, inventory: { ...shape, sources: 64 } })
  const measured = await f.owner.mutation(async ctx => {
    const value = await ctx.runMutation(api.learnV2SessionContent.startStudySession, f.request)
    return { value, metrics: await ctx.meta.getTransactionMetrics() }
  })
  console.info('delivery-read-budget', JSON.stringify({ path: 'today-start', shape, payloadBytes: new TextEncoder().encode(JSON.stringify(f.generated)).length,
    queries: measured.metrics.databaseQueries.used, documents: measured.metrics.documentsRead.used, bytes: measured.metrics.bytesRead.used,
    reason: measured.value.status === 'assessment' ? measured.value.assessment.reasonCode : null }))
  expect(measured.value).toMatchObject({ status: 'assessment', assessment: { kind: 'check' }, deliveryGrant: { status: 'granted' } })
  expect(measured.metrics.databaseQueries.used).toBeLessThan(3072)
  const opportunity = await f.cold()
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', assessment: { kind: 'check' } })
  const granted = await f.owner.mutation(async ctx => {
    const value = await ctx.runMutation(api.learnV2Assessments.grantAssessmentDelivery, { version: LEARN_V2_PUBLIC_API_VERSION,
      assessmentOpportunityId: opportunity._id, expectedRevision: opportunity.revision, idempotencyKey: 'max_inventory_grant_1234567890' })
    return { value, metrics: await ctx.meta.getTransactionMetrics() }
  })
  expect(granted.value).toMatchObject({ status: 'granted' })
  const accepted = await f.owner.mutation(async ctx => {
    const value = await ctx.runMutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
      idempotencyKey: 'max_inventory_accept_1234567890', response: { target: { assessmentOpportunityId: opportunity._id }, expectedRevision: opportunity.revision,
        payload: { kind: 'numeric', value: 0, unit: 'members' } } } })
    return { value, metrics: await ctx.meta.getTransactionMetrics() }
  })
  expect(accepted.value).toMatchObject({ kind: 'accepted' })
  for (const [path, call] of [['today-grant', granted], ['today-accept', accepted]] as const) {
    console.info('delivery-read-budget', JSON.stringify({ path, shape, queries: call.metrics.databaseQueries.used,
      documents: call.metrics.documentsRead.used, bytes: call.metrics.bytesRead.used }))
    expect(call.metrics.databaseQueries.used).toBeLessThan(3072)
  }

})

test.each((['patch', 'replace', 'delete', 'insert'] as const).flatMap(write => [false, true].map(child => ({ write, child }))))(
  'source authority is revalidated after $write with a child read scope=$child', async ({ write, child }) => {
  const f = await fixture()
  await f.owner.mutation(measurement.enrollProspect, { studySessionId: f.graph.studySessionId, familyId: f.begun.familyId, entryPoint: 'today' })
  const opportunity = await f.cold()
  const result = await f.owner.mutation(async original => {
    const parent = createResponsePrivacyReadContext(original, userId).ctx
    let ctx = measurementReadContext(parent, userId)
    if (child) ctx = measurementReadContext(createResponsePrivacyReadContext(ctx, userId).ctx, userId)
    expect(await assessmentDelivery.readLearnAssessmentStateForOwner(ctx, userId, opportunity._id, 'today')).toMatchObject({ status: 'available' })
    if (write === 'patch') await ctx.db.patch(f.graph.sourceIdentityId, { tombstonedAt: Date.now() })
    if (write === 'delete') await ctx.db.delete(f.graph.sourceExcerptId)
    if (write === 'replace' || write === 'insert') {
      const { _id: _id, _creationTime: _time, ...source } = (await ctx.db.get(f.graph.sourceSnapshotId))!
      if (write === 'replace') await ctx.db.replace(f.graph.sourceSnapshotId, { ...source, rightsStatus: 'prohibited' })
      else await ctx.db.insert('learnSourceSnapshots', { ...source, revision: source.revision + 1 })
    }
    return await assessmentDelivery.grantLearnAssessmentDeliveryForOwner(ctx, userId, { assessmentOpportunityId: opportunity._id,
      expectedRevision: opportunity.revision, idempotencyKey: 'revoked_in_invocation_1234567890', flow: 'today' })
  })
  expect(result).toMatchObject({ status: 'unavailable', reasonCodes: ['evidence_unavailable'] })
  expect(await f.exposures()).toEqual([])
})

test('Today rolls back instead of returning a blocked assessment with a successful grant', async () => {
  const f = await fixture()
  const original = assessmentDelivery.readLearnAssessmentStateForOwner
  vi.spyOn(assessmentDelivery, 'readLearnAssessmentStateForOwner').mockImplementation(async (ctx, owner, id, flow) => {
    const row = await ctx.db.get(id)
    if (row?.deliveryGrantId) {
      if (!('patch' in ctx.db)) throw new Error('Expected mutation context')
      await ctx.db.patch(f.graph.sourceIdentityId, { tombstonedAt: Date.now() })
    }
    return await original(ctx, owner, id, flow)
  })
  await expect(f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)).rejects.toThrow('Learn assessment delivery authority changed')
  expect(await f.exposures()).toEqual([])
  expect(await f.opportunities()).toEqual([])
  expect(await f.t.run(ctx => ctx.db.get(f.graph.sourceIdentityId))).not.toHaveProperty('tombstonedAt')
  expect(await f.t.run(ctx => ctx.db.get(f.graph.studySessionId))).toMatchObject({ status: 'ready', revision: 2 })
})

test.each(['grant', 'accept'] as const)('native read exhaustion aborts %s instead of becoming unavailable or invalid payload', async phase => {
  const f = await fixture({ inventory: { claims: 32, supports: 2, sources: 64 } })
  await f.owner.mutation(measurement.enrollProspect, { studySessionId: f.graph.studySessionId, familyId: f.begun.familyId, entryPoint: 'today' })
  if (phase === 'accept') await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)
  const opportunity = await f.cold()
  const exposures = await f.exposures()
  await expect(f.owner.mutation(async ctx => phase === 'grant'
    ? await ctx.runMutation(api.learnV2Assessments.grantAssessmentDelivery, { version: LEARN_V2_PUBLIC_API_VERSION,
      assessmentOpportunityId: opportunity._id, expectedRevision: opportunity.revision, idempotencyKey: 'budget_exhaustion_grant_1234567890' },
    { transactionLimits: { databaseQueries: 180 } })
    : await ctx.runMutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
      idempotencyKey: 'budget_exhaustion_accept_1234567890', response: { target: { assessmentOpportunityId: opportunity._id }, expectedRevision: opportunity.revision,
        payload: { kind: 'numeric', value: 0, unit: 'members' } } } }, { transactionLimits: { databaseQueries: 180 } }))).rejects.toThrow('Too many index ranges')
  expect(await f.exposures()).toEqual(exposures)
  expect(await f.cold()).toEqual(opportunity)
  expect(await f.t.run(ctx => ctx.db.query('learnResponses').withIndex('by_userId', q => q.eq('userId', userId)).take(2))).toEqual([])
})


test('the largest published inventory can grant before starting its session', async () => {
  const f = await fixture({ reserveCount: 3, inventory: { claims: 32, supports: 2, sources: 64, extraSupports: 0, backingDocuments: true } })
  await f.owner.mutation(measurement.enrollProspect, { studySessionId: f.graph.studySessionId, familyId: f.begun.familyId, entryPoint: 'today' })
  const opportunity = await f.cold()
  const granted = await f.owner.mutation(async ctx => {
    const value = await ctx.runMutation(api.learnV2Assessments.grantAssessmentDelivery, { version: LEARN_V2_PUBLIC_API_VERSION,
      assessmentOpportunityId: opportunity._id, expectedRevision: opportunity.revision, idempotencyKey: 'max_first_grant_1234567890' })
    return { value, metrics: await ctx.meta.getTransactionMetrics() }
  })
  expect(granted.value).toMatchObject({ status: 'granted' })
  console.info('delivery-read-budget', JSON.stringify({ path: 'today-first-grant', queries: granted.metrics.databaseQueries.used,
    documents: granted.metrics.documentsRead.used, bytes: granted.metrics.bytesRead.used }))
  expect(granted.metrics.databaseQueries.used).toBeLessThan(3072)
})

test('the 64-row publication bound delivers, seals, recovers and scores through Today', async () => {
  const f = await fixture({ reserveCount: 3, inventory: { claims: 32, supports: 2, sources: 64, backingDocuments: true } })
  const sealed = await f.seal()
  expect(await f.owner.query(api.learnV2Assessments.getAssessmentState, { version: LEARN_V2_PUBLIC_API_VERSION, assessmentOpportunityId: sealed.opportunity._id }))
    .toMatchObject({ status: 'available', phase: 'submitted_sealed' })
  const scored = await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: sealed.accepted.submissionId, idempotencyKey: 'bound_today_score_1234567890' })
  expect(scored).toMatchObject({ status: 'scored' })
  expect(await f.owner.query(api.learnV2Assessments.getAssessmentState, { version: LEARN_V2_PUBLIC_API_VERSION, assessmentOpportunityId: sealed.opportunity._id }))
    .toMatchObject({ status: 'available', phase: 'scored_fail' })
  expect(await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: sealed.accepted.submissionId, idempotencyKey: 'bound_today_recovery_1234567890' })).toEqual(scored)
})

test('65-row inventory is rejected before Today publication or disclosure', async () => {
  await expect(fixture({ inventory: { claims: 32, supports: 2, sources: 3, extraSupports: 1 } }))
    .rejects.toThrow('item_evidence_limit')
})

test('publication rejects an item above its publication byte budget', async () => {
  await expect(fixture({ inventory: { claims: 32, supports: 2, sources: 3, claimText: 'A'.repeat(500) } }))
    .rejects.toThrow('item_payload_limit')
})

test('publication revalidation rejects a validated family that grows to 65 support rows', async () => {
  const f = await assessmentDeliveryFixture({ publish: false, inventory: { claims: 32, supports: 2, sources: 3 } })
  await f.t.run(async ctx => {
    const item = (await ctx.db.query('learnMeasurementItems').withIndex('by_userId_and_familyId_and_familyRevision_and_formLabel', q =>
      q.eq('userId', userId).eq('familyId', f.begun.familyId).eq('familyRevision', 1)).first())!
    const claims = await ctx.db.query('learnMeasurementClaims').withIndex('by_userId_and_itemId_and_order', q =>
      q.eq('userId', userId).eq('itemId', item._id)).take(2)
    const extra = (await ctx.db.query('learnMeasurementSupports').withIndex('by_userId_and_claimId', q =>
      q.eq('userId', userId).eq('claimId', claims[1]!._id)).first())!
    const { _id: _id, _creationTime: _time, ...support } = extra
    await ctx.db.insert('learnMeasurementSupports', { ...support, claimId: claims[0]!._id })
  })
  expect(await f.t.mutation(measurementItems.publishFamily, { ...f.args, expectedRevision: 3 }))
    .toMatchObject({ status: 'quarantined', reasonCode: 'item_evidence_limit' })
  const rows = await f.t.run(ctx => ctx.db.query('learnMeasurementItems').withIndex('by_userId_and_familyId_and_familyRevision_and_formLabel', q =>
    q.eq('userId', userId).eq('familyId', f.begun.familyId).eq('familyRevision', 1)).take(7))
  expect(rows.every(row => row.status !== 'published')).toBe(true)
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(8))).toEqual([])
})

test('ordinary publication rejects 65 evidence rows before making content ready', async () => {
  await expect(fixture({ teaching: { claims: 32, supports: 2, extraSupports: 1 } })).rejects.toThrow('item_evidence_limit')
})

test('the registered cron alone closes stale windows and restores consistent Today teaching', async () => {
  const f = await fixture()
  await f.seal()
  const day30 = (await f.opportunities()).find(row => row.horizonDays === 30)!
  vi.setSystemTime(day30.closeAt + 86_400_000)
  await runLearnDueCron(f.t)
  expect((await f.opportunities()).filter(row => row.horizonDays)).toEqual(expect.arrayContaining([
    expect.objectContaining({ horizonDays: 7, phase: 'abandoned', reasonCode: 'system_due_work_late' }),
    expect.objectContaining({ horizonDays: 30, phase: 'abandoned', reasonCode: 'system_due_work_late' }),
  ]))
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', sessionId: f.graph.studySessionId })
  const delivered = await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, {
    studySessionId: f.graph.studySessionId, idempotencyKey: 'cron_restores_teaching_1234567890' })
  expect(delivered).toMatchObject({ admission: { status: 'ordinary' }, value: { _id: f.contentId } })
  expect(JSON.stringify(delivered)).toContain('TEACHING-CANARY-explanation')
  const watermark = await f.t.run(ctx => ctx.db.query('learnMeasurementSourceWatermarks').withIndex('by_userId', q => q.eq('userId', userId)).unique())
  expect(watermark?.dueWorkThrough).toBe(Date.now())
})

test('the registered cron materializes and closes a non-returning learner on schedule', async () => {
  const protocol = syntheticDeliveryProtocol()
  policy.protocol = { ...protocol, windows: protocol.windows.map(window => ({ ...window, dueMinute: 720 })) }
  const f = await fixture()
  await f.seal()
  const day7 = (await f.opportunities()).find(row => row.horizonDays === 7)!
  expect(day7.dueAt).toBeGreaterThan(day7.openAt)
  vi.setSystemTime(day7.openAt)
  await runLearnDueCron(f.t)
  const ready = (await f.opportunities()).find(row => row._id === day7._id)!
  expect(ready).toMatchObject({ phase: 'ready', operationalEligibility: 'eligible', eligibleAt: Date.now(), contextPins: { kind: 'session' } })
  expect(ready.deliveryGrantId).toBeUndefined()
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', assessment: { kind: 'check', state: { assessmentOpportunityId: day7._id } } })
  expect(await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.graph.studySessionId,
    idempotencyKey: 'cron_open_window_denies_teaching_1234567890' })).toMatchObject({ admission: { status: 'denied', reasonCode: 'unavailable' } })
  vi.setSystemTime(day7.closeAt)
  await runLearnDueCron(f.t)
  const closed = (await f.opportunities()).find(row => row._id === day7._id)!
  expect(closed).toMatchObject({ phase: 'abandoned', reasonCode: 'missed_window' })
  if (closed.contextPins.kind !== 'session') throw new Error('Expected dedicated binding')
  expect(await f.t.run(ctx => ctx.db.get(closed.contextPins.kind === 'session' ? closed.contextPins.studySessionId : f.graph.studySessionId)))
    .toMatchObject({ status: 'missed' })
})

test('expired preparing opportunities do not indefinitely deny teaching before late cleanup', async () => {
  const f = await fixture()
  await f.seal()
  const day30 = (await f.opportunities()).find(row => row.horizonDays === 30)!
  vi.setSystemTime(day30.closeAt)
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', sessionId: f.graph.studySessionId })
  expect(await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.graph.studySessionId,
    idempotencyKey: 'expired_preparing_teaching_1234567890' })).toMatchObject({ admission: { status: 'ordinary' }, value: { _id: f.contentId } })
  expect((await f.opportunities()).find(row => row._id === day30._id)).toMatchObject({ phase: 'preparing', operationalEligibility: 'pending' })
})

test('the registered cron binds overlapping horizons at maximum published inventory within transaction limits', async () => {
  const protocol = syntheticDeliveryProtocol()
  policy.protocol = { ...protocol, windows: protocol.windows.map(window => ({ ...window, closeDayOffset: 31 })) }
  const f = await fixture({ reserveCount: 3, inventory: { claims: 32, supports: 2, sources: 64, backingDocuments: true } })
  await f.seal()
  const day30 = (await f.opportunities()).find(row => row.horizonDays === 30)!
  vi.setSystemTime(day30.openAt)
  await runLearnDueCron(f.t)
  const originals = (await f.opportunities()).filter(row => row.horizonDays)
  expect(originals).toHaveLength(2)
  for (const row of originals) expect(row).toMatchObject({ phase: 'ready', operationalEligibility: 'eligible', contextPins: { generatorVersion: 'learn-v2.delayed-delivery.v1' } })
})

test.each(['responses', 'enrollment', 'delivery', 'protocol', 'feature'] as const)('the due-work cron is inert with %s off', async gate => {
  const f = await fixture()
  await f.seal()
  const before = await f.opportunities()
  const work = (await f.t.run(ctx => ctx.db.query('learnMeasurementDueWork').withIndex('by_userId', q => q.eq('userId', userId)).first()))!
  const slot = before.find(row => row.horizonDays === 7)!
  vi.setSystemTime(slot.openAt)
  if (gate === 'protocol') policy.protocol = null
  else if (gate === 'feature') vi.stubEnv('LEARN_V2_ENABLED', 'false')
  else policy[gate] = false
  const cron = learnDueCron()
  const checked = await f.t.mutation(async ctx => {
    const value = await ctx.runMutation(cron.reference, cron.args)
    return { value, metrics: await ctx.meta.getTransactionMetrics() }
  })
  expect(checked.value).toMatchObject({ status: 'disabled', scheduledLearners: 0 })
  expect(checked.metrics.databaseQueries.used).toBe(0)
  expect(checked.metrics.documentsWritten.used).toBe(0)
  expect(checked.metrics.functionsScheduled.used).toBe(0)
  expect(await f.opportunities()).toEqual(before)
  const queued = makeFunctionReference<'mutation'>('learnV2MeasurementDueWork:materializeDelayedCheckEligibility')
  const stopped = await f.t.mutation(async ctx => {
    const value = await ctx.runMutation(queued, { userId, through: Date.now(), fromCron: true })
    return { value, metrics: await ctx.meta.getTransactionMetrics() }
  })
  expect(stopped.value).toMatchObject({ status: 'disabled', processed: 0 })
  expect(stopped.metrics.databaseQueries.used).toBe(0)
  expect(stopped.metrics.documentsWritten.used).toBe(0)
  expect(stopped.metrics.functionsScheduled.used).toBe(0)
  const worker = makeFunctionReference<'mutation'>('learnV2MeasurementDueWork:processDelayedCheckWork')
  const continuation = makeFunctionReference<'mutation'>('learnV2MeasurementDueWork:continueDelayedCheckSweep')
  const durable = await f.t.mutation(async ctx => {
    await ctx.runMutation(worker, { userId, workId: work._id, generation: work.generation })
    await ctx.runMutation(continuation, { leaseId: 'disabled', target: Date.now() })
    await enqueueLearnDueWork(ctx, { userId, key: 'disabled', kind: 'owner', dueAt: Date.now() })
    return ctx.meta.getTransactionMetrics()
  })
  expect(durable.databaseQueries.used).toBe(0)
  expect(durable.documentsWritten.used).toBe(0)
  expect(durable.functionsScheduled.used).toBe(0)
})

async function measuredTick(f: { t: Awaited<ReturnType<typeof fixture>>['t'] }) {
  const cron = learnDueCron()
  return f.t.mutation(async ctx => {
    const value = await ctx.runMutation(cron.reference, cron.args)
    return { value, metrics: await ctx.meta.getTransactionMetrics() }
  })
}
const pendingJobs = (f: { t: Awaited<ReturnType<typeof fixture>>['t'] }) => f.t.run(async ctx =>
  (await ctx.db.system.query('_scheduled_functions').take(512)).filter(row => row.state.kind === 'pending'))
const ownerJobs = (rows: { name: string, args: unknown[] }[], owner = userId) =>
  rows.filter(row => row.name.includes('processDelayedCheckWork') && row.args.some(arg => arg && typeof arg === 'object' && 'userId' in arg && arg.userId === owner))

async function seedDueOwner(f: { t: Awaited<ReturnType<typeof fixture>>['t'] }, owner: string) {
  await f.t.run(async ctx => {
    const now = Date.now()
    await ctx.db.insert('learnAssessmentCatalogs', { userId: owner, storageVersion: 'learn-v2.measurement-storage.v1', createdAt: now,
      catalogRevision: 1, instrumentationEpoch: 'fixture.v1', historyCompleteness: 'prospective_complete', historyBasisVersion: 'fixture.v1',
      historyCoverageWatermark: 'fixture.v1', measurementCapability: { enabled: true } })
    await ctx.db.insert('learnMeasurementSourceWatermarks', { userId: owner, storageVersion: 'learn-v2.measurement-storage.v1', createdAt: now,
      sourceVersion: 'learn-v2.measurement-report-source.v4', sequence: 0, dueWorkThrough: null, historyCoverage: 'complete', updatedAt: now })
    await enqueueLearnDueWork(ctx, { userId: owner, key: 'owner', kind: 'owner', dueAt: now })
  })
}

test('due-work fan-out is bounded, single-flight and idempotent under duplicate ticks', async () => {
  const f = await fixture()
  await f.seal()
  const slot = (await f.opportunities()).find(row => row.horizonDays === 7)!
  vi.setSystemTime(slot.openAt)
  for (let index = 0; index < 33; index++) await seedDueOwner(f, `https://cron.example|bounded-${index}`)
  const first = await measuredTick(f)
  expect(first.value).toMatchObject({ status: 'scheduled', visited: 16, scheduledLearners: 16, continued: true })
  expect(first.metrics.functionsScheduled.used).toBe(17)
  expect(first.metrics.databaseQueries.used).toBeLessThanOrEqual(8)
  for (const tick of await Promise.all([measuredTick(f), measuredTick(f)])) {
    expect(tick.value).toMatchObject({ status: 'busy', scheduledLearners: 0 })
    expect(tick.metrics.functionsScheduled.used).toBe(0)
    expect(tick.metrics.documentsWritten.used).toBe(0)
  }
  const chain = (await pendingJobs(f)).find(row => row.name.includes('continueDelayedCheckSweep'))!
  const page = await f.t.mutation(makeFunctionReference<'mutation'>('learnV2MeasurementDueWork:continueDelayedCheckSweep'), chain.args[0] as never)
  expect(page).toMatchObject({ status: 'scheduled', visited: 16, scheduledLearners: 16, continued: true })
  await f.t.finishAllScheduledFunctions(() => vi.runAllTimers())
  const closed = await f.t.run(ctx => ctx.db.system.query('_scheduled_functions').take(256))
  expect(closed.filter(row => row.state.kind === 'pending' || row.state.kind === 'inProgress')).toEqual([])
  const visited = new Set(closed.flatMap(row => row.args.flatMap(arg => arg && typeof arg === 'object' && 'userId' in arg ? [arg.userId] : [])))
  expect(visited.has(userId)).toBe(true)
  for (let index = 0; index < 33; index++) expect(visited.has(`https://cron.example|bounded-${index}`)).toBe(true)
  expect(closed.filter(row => row.name.includes('continueDelayedCheckSweep'))).toHaveLength(3)
  expect(await f.t.run(ctx => ctx.db.query('learnMeasurementDueWorkCursors').take(2))).toEqual([expect.objectContaining({ through: slot.openAt, leaseId: null })])
  const sessions = await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_assessmentPurpose', q =>
    q.eq('userId', userId).eq('studyPlanRevisionId', f.graph.studyPlanRevisionId).eq('assessmentPurpose', 'measurement_delayed')).take(4))
  expect(sessions).toHaveLength(1)
  const events = await f.t.run(ctx => ctx.db.query('learnActivityEvents').withIndex('by_userId_and_dedupeKeyHash', q => q.eq('userId', userId)).take(16))
  expect(events.filter(row => 'assessmentOpportunityId' in row && row.assessmentOpportunityId === slot._id)).toHaveLength(1)
})

test('a due-work tick with nothing due schedules no learner work', async () => {
  const f = await fixture()
  await f.seal()
  await runLearnDueCron(f.t)
  const before = await f.t.run(ctx => ctx.db.query('learnMeasurementSourceWatermarks').withIndex('by_userId', q => q.eq('userId', userId)).unique())
  expect(before?.dueWorkThrough).toBe(Date.now())
  for (let minute = 1; minute <= 3; minute++) {
    vi.setSystemTime(Date.now() + 60_000)
    const tick = await measuredTick(f)
    expect(tick.value).toEqual({ status: 'complete', visited: 0, scheduledLearners: 0, continued: false })
    expect(tick.metrics.functionsScheduled.used).toBe(0)
    expect(tick.metrics.databaseQueries.used).toBeLessThanOrEqual(7)
    expect(await pendingJobs(f)).toEqual([])
  }
  expect(await f.t.run(ctx => ctx.db.query('learnMeasurementSourceWatermarks').withIndex('by_userId', q => q.eq('userId', userId)).unique())).toEqual(before)
  expect(await f.t.run(ctx => ctx.db.query('learnMeasurementDueWorkCursors').take(2))).toEqual([expect.objectContaining({ through: Date.now(), leaseId: null })])
})

test('a disabled measurement catalogue retains work with backoff until it is enabled again', async () => {
  const f = await fixture()
  await f.seal()
  await runLearnDueCron(f.t)
  const catalog = (await f.t.run(ctx => ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', userId)).unique()))!
  await f.t.run(ctx => ctx.db.patch(catalog._id, { measurementCapability: { enabled: false } }))
  const slot = (await f.opportunities()).find(row => row.horizonDays === 7)!
  vi.setSystemTime(slot.openAt)
  const due = await measuredTick(f)
  expect(due.value).toMatchObject({ status: 'scheduled', scheduledLearners: 2 })
  expect(ownerJobs(await pendingJobs(f))).toHaveLength(2)
  await f.t.finishAllScheduledFunctions(() => vi.runAllTimers())
  expect((await f.opportunities()).find(row => row._id === slot._id)).toMatchObject({ phase: 'preparing', operationalEligibility: 'blocked', reasonCode: 'not_admitted' })
  const pending = () => f.t.run(ctx => ctx.db.query('learnMeasurementDueWork').withIndex('by_userId_and_state_and_dueAt', q =>
    q.eq('userId', userId).eq('state', 'pending')).take(8))
  expect(await pending()).toHaveLength(1)
  for (const row of await pending()) expect(row).toMatchObject({ attempts: 0, domainChecks: 1, nextAttemptAt: slot.openAt + 60_000 })
  vi.setSystemTime(slot.openAt + 59_999)
  expect((await measuredTick(f)).value).toMatchObject({ status: 'complete', scheduledLearners: 0 })
  vi.setSystemTime(slot.openAt + 60_000)
  await runLearnDueCron(f.t)
  for (const row of await pending()) expect(row).toMatchObject({ attempts: 0, domainChecks: 2, nextAttemptAt: slot.openAt + 180_000 })
  vi.setSystemTime(slot.openAt + 120_000)
  expect((await measuredTick(f)).value).toMatchObject({ status: 'complete', scheduledLearners: 0 })
  await f.t.run(ctx => ctx.db.patch(catalog._id, { measurementCapability: { enabled: true } }))
  vi.setSystemTime(slot.openAt + 180_000)
  await runLearnDueCron(f.t)
  expect(await pending()).toEqual([])
  expect((await f.opportunities()).find(row => row._id === slot._id)).toMatchObject({ phase: 'ready', operationalEligibility: 'eligible' })
})

test('an expired due-work lease is taken over and the abandoned chain stops', async () => {
  const f = await fixture()
  await f.seal()
  for (let index = 0; index < 17; index++) await seedDueOwner(f, `https://cron.example|takeover-${index}`)
  vi.setSystemTime((await f.opportunities()).find(row => row.horizonDays === 7)!.openAt)
  const started = await measuredTick(f)
  expect(started.value).toMatchObject({ status: 'scheduled', continued: true })
  const abandoned = (await pendingJobs(f)).find(row => row.name.includes('continueDelayedCheckSweep'))!
  vi.setSystemTime(Date.now() + 60_000)
  expect((await measuredTick(f)).value).toMatchObject({ status: 'busy' })
  vi.setSystemTime(Date.now() + LEARN_DUE_WORK_LEASE_MS)
  const resumed = await measuredTick(f)
  expect(resumed.value).toMatchObject({ status: 'scheduled' })
  const continueSweep = makeFunctionReference<'mutation'>('learnV2MeasurementDueWork:continueDelayedCheckSweep')
  const stale = await f.t.mutation(async ctx => {
    const value = await ctx.runMutation(continueSweep, abandoned.args[0] as never)
    return { value, metrics: await ctx.meta.getTransactionMetrics() }
  })
  expect(stale.value).toMatchObject({ status: 'stale', scheduledLearners: 0 })
  expect(stale.metrics.documentsWritten.used).toBe(0)
  expect(stale.metrics.functionsScheduled.used).toBe(0)
})

test('ordinary publication rejects source evidence above the serialized scoring request budget', async () => {
  await expect(fixture({ teaching: { claims: 32, supports: 2, excerpt: 'Source evidence supports a separate practice case. '.repeat(10) } })).rejects.toThrow('item_scoring_request_limit')
})

test('responses-off ordinary publication and start keep the existing 65-row behavior', async () => {
  policy.responses = false
  const f = await fixture({ teaching: { claims: 32, supports: 2, extraSupports: 1 } })
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)).toEqual({ status: 'in_progress',
    sessionContentId: f.contentId, sessionContentRevision: 1 })
  expect(await f.opportunities()).toEqual([])
  expect(await f.exposures()).toEqual([])
})

test.each(['start', 'acceptance'] as const)('older 65-row ordinary content is explicitly unavailable at %s', async boundary => {
  const original = scoringContract.assertMeasurementScoringContract
  const oldPublication = vi.spyOn(scoringContract, 'assertMeasurementScoringContract').mockImplementation((input, binding, acceptance, request) => {
    if (input.evidence.length <= 64) original(input, binding, acceptance, request)
  })
  const f = await fixture({ teaching: { claims: 32, supports: 2, extraSupports: 1 } })
  await f.seal()
  if (boundary === 'start') {
    oldPublication.mockRestore()
    await expect(f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)).rejects.toThrow('Learn application delivery unavailable: item_evidence_limit')
    expect((await f.opportunities()).filter(row => row.purpose.kind === 'independent_application')).toEqual([])
    expect(await f.t.run(ctx => ctx.db.get(f.graph.studySessionId))).toMatchObject({ status: 'ready', revision: 2 })
  } else {
    await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)
    oldPublication.mockRestore()
    const opportunity = (await f.opportunities()).find(row => row.purpose.kind === 'independent_application')!
    expect(await f.owner.query(api.learnV2Assessments.getAssessmentState, { version: LEARN_V2_PUBLIC_API_VERSION,
      assessmentOpportunityId: opportunity._id })).toMatchObject({ status: 'unavailable', reasonCodes: ['item_evidence_limit'] })
    expect(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: {
      version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'legacy_ordinary_bound_1234567890', response: {
        target: { assessmentOpportunityId: opportunity._id }, expectedRevision: opportunity.revision,
        payload: { kind: 'text', text: 'An otherwise valid response.' }, confidence: 3 } } }))
      .toMatchObject({ kind: 'rejected', reasonCode: 'item_evidence_limit' })
    expect(await f.t.run(ctx => ctx.db.get(opportunity._id))).not.toHaveProperty('submissionId')
  }
  expect(await f.t.run(ctx => ctx.db.query('learnResponseBodies').take(4))).toHaveLength(1)
})

test.each(['canonical', 'compatibility'] as const)('ordinary %s admission rejects escaped wire overflow before sealing', async entry => {
  const f = await fixture({ teaching: { claims: 32, supports: 2 } })
  await f.seal()
  ordinaryScorer()
  await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)
  const opportunity = (await f.opportunities()).find(row => row.purpose.kind === 'independent_application')!
  const command = { version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'ordinary_oversized_wire_1234567890', response: {
    target: { assessmentOpportunityId: opportunity._id }, expectedRevision: opportunity.revision,
    payload: { kind: 'text' as const, text: '\\'.repeat(4001) }, confidence: 3 } }
  const result = entry === 'compatibility' ? await f.owner.action(api.learnV2Mastery.submitMasteryAttempt, { studySessionId: f.graph.studySessionId,
    expectedSessionRevision: 3, expectedContentRevision: 1, expectedPlanRecordRevision: 1, expectedBlueprintRecordRevision: 1,
    response: command.response.payload.text, confidence: 3, idempotencyKey: command.idempotencyKey })
    : await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: command })
  expect(result).toMatchObject(entry === 'compatibility' ? { status: 'invalid', code: 'payload_too_large' } : { kind: 'rejected', reasonCode: 'payload_too_large' })
  expect(await f.t.run(ctx => ctx.db.get(opportunity._id))).not.toHaveProperty('submissionId')
  const accepted = await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { ...command,
    idempotencyKey: 'ordinary_bounded_retry_1234567890', response: { ...command.response, payload: { kind: 'text', text: '\\'.repeat(4000) } } } })
  if (accepted.kind !== 'accepted') throw new Error('Expected bounded retry')
  expect(await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: accepted.submissionId, idempotencyKey: 'ordinary_bounded_retry_score_1234567890' })).toMatchObject({ status: 'scored' })
})

test('ordinary publication, sealing and scoring accept the shared 64-row bound', async () => {
  const f = await fixture({ teaching: { claims: 32, supports: 2, sources: 64 } })
  await f.seal()
  ordinaryScorer()
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.request)).toMatchObject({ status: 'in_progress' })
  const opportunity = (await f.opportunities()).find(row => row.purpose.kind === 'independent_application')!
  const accepted = await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: {
    version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'ordinary_bound_accept_1234567890', response: {
      target: { assessmentOpportunityId: opportunity._id }, expectedRevision: opportunity.revision,
      payload: { kind: 'text', text: 'A supported application.' }, confidence: 3 } } })
  if (accepted.kind !== 'accepted') throw new Error('Expected sealed application')
  expect(await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: accepted.submissionId, idempotencyKey: 'ordinary_bound_score_1234567890' })).toMatchObject({ status: 'scored' })
})


test('child privacy scopes propagate a strict parent budget and roll back earlier writes', async () => {
  const f = await fixture()
  const before = (await f.t.run(ctx => ctx.db.get(f.graph.learningVoidId)))!
  await expect(f.owner.mutation(async ctx => {
    await ctx.db.patch(before._id, { title: 'Uncommitted child-budget marker' })
    const strict = createResponsePrivacyReadContext(ctx, userId, 1, { throwOnBudgetExhaustion: true }).ctx
    const child = createResponsePrivacyReadContext(strict, userId).ctx
    await child.db.get(f.graph.sourceSnapshotId)
    return await privacyRead(child, userId, ['child-budget'], null, current => current.db.get(f.graph.sourceExcerptId))
  })).rejects.toThrow('Learn source validation budget exhausted')
  expect(await f.t.run(ctx => ctx.db.get(before._id))).toEqual(before)
})

test('publication rejects a field-valid item that exceeds the reserved scorer request budget', async () => {
  await expect(fixture({ inventory: { claims: 8, supports: 8, sources: 8, claimText: 'A'.repeat(500) } }))
    .rejects.toThrow('item_scoring_request_limit')
})

test.each([false, true])('strict descendants promote ancestor budget propagation through a copied context=%s', async copied => {
  const f = await fixture()
  await expect(f.owner.query(async ctx => {
    const parent = createResponsePrivacyReadContext(ctx, userId, 1).ctx
    const view = copied ? { ...parent } : parent
    const strict = createResponsePrivacyReadContext(view, userId, undefined, { throwOnBudgetExhaustion: true }).ctx
    await strict.db.get(f.graph.sourceSnapshotId)
    return await privacyRead(parent, userId, ['ancestor-budget'], null, () => strict.db.get(f.graph.sourceExcerptId))
  })).rejects.toThrow('Learn source validation budget exhausted')
})
