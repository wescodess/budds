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
import { assessmentDeliveryFixture, deliveryIdentity, publishDeliveryTeaching, syntheticDeliveryProtocol } from '../tests/fixtures/learn-v2-assessment-delivery'

const mastery = (anyApi as unknown as ApiFromModules<{ learnV2Mastery: typeof import('./learnV2Mastery') }>).learnV2Mastery
const measurement = (anyApi as unknown as ApiFromModules<{ learnV2Measurement: typeof import('./learnV2Measurement') }>).learnV2Measurement
const due = makeFunctionReference<'mutation', { userId: string, through?: number }>('learnV2MeasurementDueWork:materializeDelayedCheckEligibility')
const policy = vi.hoisted(() => ({ responses: true, enrollment: true, protocol: null as unknown, scorer: null as unknown }))
vi.mock('../shared/learn-v2-measurement-storage-manifest', async original => {
  const value = await original<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...value, LEARN_MEASUREMENT_CAPABILITIES: { ...value.LEARN_MEASUREMENT_CAPABILITIES, scoring: true, delivery: true,
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
  policy.responses = true; policy.enrollment = true; policy.protocol = syntheticDeliveryProtocol()
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers() })

async function fixture(options: { reserve?: boolean } = {}) {
  const definition = { configurationId: 'today.synthetic', configurationVersion: 'today.synthetic.v1', kind: 'legacy_baseline' as const,
    requestedModel: 'synthetic/model', endpoint: null, identity: { mappingVersion: 'synthetic.identity.v1', canonicalModel: 'synthetic/model',
      family: 'synthetic', snapshotAssurance: 'unknown' as const, verifiedReturnedModels: [] } }
  const saved = await sealLearnScorerConfiguration(definition)
  const registry = await createLearnScorerRegistry({ epoch: 'synthetic.epoch.v1', configurations: [{ definition, expectedDigest: saved.binding.configurationDigest }],
    legacyAllowlist: [definition.configurationId], prospectiveConfigurationId: null })
  policy.scorer = { registry, saved }
  const f = await assessmentDeliveryFixture(options)
  const contentId = await publishDeliveryTeaching(f)
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

async function openDay7(f: Awaited<ReturnType<typeof fixture>>) {
  const cold = await f.seal()
  await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: cold.accepted.submissionId, idempotencyKey: 'terminal_cold_score_1234567890' })
  const day7 = (await f.opportunities()).find(row => row.horizonDays === 7)!
  vi.setSystemTime(day7.openAt + 1000)
  await f.t.mutation(due, { userId, through: Date.now() })
  const today = await f.owner.query(api.learnV2Today.getToday, {})
  if (today.status !== 'ready') throw new Error('Expected day 7')
  await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: today.sessionId,
    expectedSessionRevision: today.sessionRevision, expectedContentRevision: today.content.revision, idempotencyKey: 'terminal_day7_start_1234567890' })
  const before = (await f.opportunities()).find(row => row._id === day7._id)!
  return { today, before }
}

async function sealDay7(f: Awaited<ReturnType<typeof fixture>>, check: Awaited<ReturnType<typeof openDay7>>, value = 0) {
  const accepted = await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: 'terminal_day7_seal_1234567890', response: { target: { assessmentOpportunityId: check.before._id }, expectedRevision: check.before.revision,
      payload: { kind: 'numeric', value, unit: 'members' } } } })
  if (accepted.kind !== 'accepted') throw new Error('Expected sealed day 7')
  return { ...check, accepted }
}

async function sealedDay7(f: Awaited<ReturnType<typeof fixture>>) {
  return await sealDay7(f, await openDay7(f))
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
    const check = await openDay7(f)
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
  const check = await openDay7(f)
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
  const check = await openDay7(f)
  const request = { assessmentOpportunityId: check.before._id, reason: 'contaminated' as const }
  await f.t.run(ctx => ctx.db.patch(check.before._id, { reasonCode: request.reason }))
  expect(await f.t.run(ctx => replaceLearnMeasurementOpportunityForOwner(ctx, userId, request))).toMatchObject({ status: 'replaced' })
  expect(await f.t.run(ctx => ctx.db.get(check.today.sessionId))).toMatchObject({ status: 'cancelled' })
  expect((await f.opportunities()).find(row => row._id === check.before._id)).toMatchObject({ phase: 'invalid', originalSlot: true,
    contextPins: check.before.contextPins })
  expect((await f.opportunities()).find(row => row.replacesOpportunityId === check.before._id)).toMatchObject({ originalSlot: false, checkSequence: 0 })
})

test('disabled lifecycle cleanup preserves an existing active check session', async () => {
  const f = await fixture()
  const check = await openDay7(f)
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
  vi.setSystemTime(original.openAt + 1000)
  await f.t.mutation(due, { userId, through: Date.now() })
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
