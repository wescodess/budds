/// <reference types="vite/client" />
import { makeFunctionReference } from 'convex/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import { canvasFamilyFixture, canvasIdentity } from '../tests/fixtures/learn-v2-canvas'
import { publishDeliveryTeaching, syntheticDeliveryProtocol } from '../tests/fixtures/learn-v2-assessment-delivery'
import { ADAPTIVE_V2_PILOT_MANIFEST } from '../shared/adaptive-v2-pilot-policy'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION } from '../shared/learn-v2-responses'
import { learnTodayCheckPointerSchema } from '../shared/learn-v2-today-check'
import { LEARN_V2_PUBLIC_API_VERSION } from './lib/learnV2PublicContract'
import { createLearnScorerRegistry, sealLearnScorerConfiguration } from './lib/learnV2ScorerConfig'
import { privacyDigest } from './lib/learnV2ResponsePrivacy'
import type { Doc } from './_generated/dataModel'

const policy = vi.hoisted(() => ({ pointers: true, responses: true, protocol: null as unknown, scorer: null as unknown }))
vi.mock('../shared/learn-v2-measurement-storage-manifest', async original => {
  const value = await original<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...value, LEARN_MEASUREMENT_CAPABILITIES: { ...value.LEARN_MEASUREMENT_CAPABILITIES,
    enrollment: true, delivery: true, scoring: true, get responses() { return policy.responses }, get todayCanvasChecks() { return policy.pointers } } }
})
vi.mock('./lib/learnV2MeasurementAssignment', async original => {
  const value = await original<typeof import('./lib/learnV2MeasurementAssignment')>()
  return { ...value, getFrozenLearnMeasurementProtocol: () => policy.protocol }
})
vi.mock('./lib/learnV2MeasurementScorerInventory', () => ({ getLearnMeasurementScorer: async () => policy.scorer }))

const originalManifest = structuredClone(ADAPTIVE_V2_PILOT_MANIFEST)
const userId = canvasIdentity.tokenIdentifier
const due = makeFunctionReference<'mutation', { userId: string, through: number }>('learnV2MeasurementDueWork:materializeDelayedCheckEligibility')
const NOW = Date.parse('2027-03-07T15:00:00Z')

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW)
  policy.pointers = true; policy.responses = true
  vi.stubEnv('LEARN_ADAPTIVE_V2_PILOT_MANIFEST', ADAPTIVE_V2_PILOT_MANIFEST.version)
  for (const name of ['OPENROUTER_API_KEY', 'CF_ACCOUNT_ID', 'CLOUDFLARE_AI_GATEWAY_ID']) vi.stubEnv(name, 'synthetic-unused')
})
afterEach(() => {
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, originalManifest)
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers()
})

async function fixture(options: { canvas?: boolean, inventory?: { claims: number, supports: number, sources: number } } = {}) {
  const definition = { configurationId: 'today-canvas.synthetic.v1', configurationVersion: 'today-canvas.synthetic.v1', kind: 'measurement_rubric' as const,
    requestedModel: 'synthetic/model', endpoint: null, identity: { mappingVersion: 'synthetic.identity.v1', canonicalModel: 'synthetic/model',
      family: 'synthetic', snapshotAssurance: 'unknown' as const, verifiedReturnedModels: [] } }
  const saved = await sealLearnScorerConfiguration(definition)
  const baseline = { ...definition, configurationId: 'today-canvas.baseline.v1', kind: 'legacy_baseline' as const }
  const baselineSaved = await sealLearnScorerConfiguration(baseline)
  const registry = await createLearnScorerRegistry({ epoch: 'synthetic.epoch.v1', configurations: [{ definition, expectedDigest: saved.binding.configurationDigest },
    { definition: baseline, expectedDigest: baselineSaved.binding.configurationDigest }], legacyAllowlist: [baseline.configurationId], prospectiveConfigurationId: null })
  policy.scorer = { registry, saved }
  policy.protocol = { ...syntheticDeliveryProtocol(), scoringBinding: saved.binding }
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { pilotApproved: true,
    startsAt: new Date(NOW - 86_400_000).toISOString(), endsAt: new Date(NOW + 40 * 86_400_000).toISOString(),
    cohort: { ...originalManifest.cohort, subjectHashes: [await privacyDigest(['adaptive-v2-pilot-cohort.v1', userId])] },
    modelPolicies: [{ model: 'synthetic/model', inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.1 }],
    productControls: { ...originalManifest.productControls, maxDispatchesPerHour: 4, maxDispatchesPerDay: 8, maxConcurrent: 2, maxReservedMicroUsdPerDay: 100_000 },
    rollback: { ...originalManifest.rollback, ownerSubjectHash: await privacyDigest(['adaptive-v2-rollback-owner.tokenIdentifier-sha256.v1', userId]) } })
  const f = await canvasFamilyFixture(saved.binding, { rubric: true, inventory: options.inventory })
  if (options.canvas !== false) await f.t.run(async ctx => {
    const user = (await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique())!
    await ctx.db.patch(user._id, { learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: NOW } })
  })
  await publishDeliveryTeaching(f)
  const start = (entryPoint: 'today' | 'session_deep_link' = 'today') => f.owner.mutation(api.learnV2SessionContent.startStudySession, {
    studySessionId: f.graph.studySessionId, expectedSessionRevision: 2, expectedContentRevision: 1,
    idempotencyKey: `today_pointer_start_${entryPoint}`, entryPoint })
  const opportunities = () => f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q => q.eq('userId', userId)).take(16))
  const read = async () => {
    const today = await f.owner.query(api.learnV2Today.getToday, {})
    if (!('checkPointers' in today)) throw new Error('Expected pointer projection')
    expect(today.checkPointers.status).toBe('available')
    return today.checkPointers.checks
  }
  return { ...f, start, opportunities, read }
}

async function attach(f: Awaited<ReturnType<typeof fixture>>, opportunity: Doc<'learnAssessmentOpportunities'>) {
  if (opportunity.contextPins.kind !== 'session' || !opportunity.contextPins.canvas) throw new Error('Expected Canvas pins')
  const session = (await f.t.run(ctx => ctx.db.get(opportunity.contextPins.kind === 'session' ? opportunity.contextPins.studySessionId : f.graph.studySessionId)))!
  const attached = await f.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: session._id,
    expectedSessionRevision: session.revision, idempotencyKey: `pointer_attach_${opportunity._id}` })
  if (attached.kind !== 'attached') throw new Error(JSON.stringify(attached))
  const canvas = (await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId }))!
  expect(canvas.responsePrompt).toBeTruthy()
  return { attached, canvas, stage: { threadId: attached.threadId, activityId: attached.activityId, studySessionId: session._id,
    expectedRevision: canvas.thread.revision, expectedSessionRevision: canvas.session.revision, response: 'A saved learner answer.',
    confidence: 3, idempotencyKey: `pointer_save_${opportunity._id}` } }
}

function modelReply() {
  return new Response(JSON.stringify({ id: 'synthetic-execution', model: 'synthetic/model', choices: [{ index: 0, finish_reason: 'stop',
    message: { role: 'assistant', content: JSON.stringify({ criterionResults: [{ key: 'private-criterion', awarded: true }], misconceptionTags: [] }) } }],
    usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 }, openrouter_metadata: { requested: 'synthetic/model', strategy: 'direct', attempt: 1,
      endpoints: { available: [{ provider: 'Synthetic Provider', model: 'synthetic/model', selected: true }] }, pipeline: [] } }))
}

test.each(['today', 'session_deep_link'] as const)('%s records its entry while the row delivers, seals, scores and reads on Canvas', async entryPoint => {
  const f = await fixture()
  expect(await f.read()).toEqual([])
  expect(await f.start(entryPoint)).toMatchObject({ status: 'assessment', deliveryGrant: null, assessment: { check: { state: 'ready' } } })
  const row = (await f.opportunities())[0]!
  const [pointer] = await f.read()
  expect(learnTodayCheckPointerSchema.parse(pointer)).toEqual(pointer)
  expect(pointer).toMatchObject({ reference: row.delayedCheckId, state: 'ready', destination: { kind: 'canvas',
    route: `/app/learn/void/${row.contextPins.kind === 'session' ? row.contextPins.canvas!.threadId : ''}` } })
  expect(await f.t.run(ctx => ctx.db.get(row.assignmentId!))).toMatchObject({ flow: 'v2_canvas', entryPoint })
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(4))).toEqual([])
  const { attached, canvas, stage } = await attach(f, row)
  expect((await f.read())[0]).toEqual(pointer)
  const accepted = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, stage)
  if (accepted.kind !== 'accepted') throw new Error('Expected seal')
  expect((await f.read())[0]).toEqual({ ...pointer, state: 'saved_scoring' })
  expect(await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, stage)).toEqual(accepted)
  vi.stubGlobal('fetch', vi.fn(async () => modelReply()))
  await f.owner.action(api.learnAdaptive.submitResponse, { threadId: attached.threadId, activityId: attached.activityId,
    submissionId: accepted.submissionId, idempotencyKey: 'pointer_score_1234567890' })
  expect((await f.read())[0]).toEqual({ ...pointer, state: 'result_ready' })
  expect(await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'feedback', savedResponse: { response: stage.response } })
  const todayReads = [await f.owner.query(api.learnV2Today.getToday, {}),
    await f.owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: f.graph.studySessionId })]
  for (const value of todayReads) expect(JSON.stringify(value)).not.toMatch(/Hypothetical|PRIVATE|A saved learner answer|criterionResults|declaredStimulus|scoringSpec|scorePercent|scored_pass|scored_fail|feedbackCodes|authoritativeAttemptId/)
  expect(canvas.responsePrompt).toMatch(/Hypothetical/)
  const saved = (await f.t.run(ctx => ctx.db.get(accepted.submissionId)))!
  expect(saved).toMatchObject({ flow: 'canvas' })
  const fact = await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_submissionId', q => q.eq('userId', userId).eq('fact.submissionId', accepted.submissionId)).first())
  expect(fact?.fact).toMatchObject({ kind: 'response', submissionId: accepted.submissionId })
  const enrollment = await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_assignmentId', q => q.eq('userId', userId).eq('fact.assignmentId', row.assignmentId!)).first())
  expect(enrollment?.fact).toMatchObject({ kind: 'enrollment', snapshot: { flow: 'v2_canvas', entryPoint } })
})

test('a dedicated delayed check remains on Today after sealing and refresh', async () => {
  const f = await fixture()
  await f.start()
  const cold = (await f.opportunities())[0]!
  const opening = await attach(f, cold)
  expect((await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opening.stage)).kind).toBe('accepted')
  const day7 = (await f.opportunities()).find(row => row.horizonDays === 7)!
  vi.setSystemTime(day7.openAt + 1000)
  await f.t.mutation(due, { userId, through: Date.now() })
  const ready = (await f.opportunities()).find(row => row._id === day7._id)!
  const pointer = (await f.read()).find(row => row.reference === day7.delayedCheckId)!
  expect(pointer).toMatchObject({ state: 'ready' })
  const check = await attach(f, ready)
  const saved = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, check.stage)
  if (saved.kind !== 'accepted') throw new Error('Expected delayed seal')
  expect(await f.t.run(ctx => ctx.db.get(check.stage.studySessionId))).toMatchObject({ status: 'completed' })
  expect((await f.read()).find(row => row.reference === pointer.reference)).toEqual({ ...pointer, state: 'saved_scoring' })
  expect(await f.read()).toEqual(await f.read())
  vi.stubGlobal('fetch', vi.fn(async () => modelReply()))
  await f.owner.action(api.learnAdaptive.submitResponse, { threadId: check.stage.threadId, activityId: check.stage.activityId,
    submissionId: saved.submissionId, idempotencyKey: 'pointer_delayed_score_1234567890' })
  expect((await f.read()).find(row => row.reference === pointer.reference)).toEqual({ ...pointer, state: 'result_ready' })
})

test.each(['submitted_sealed', 'scoring_pending', 'retryable_failure', 'reconciliation_required', 'scored_pass', 'scored_fail', 'invalid', 'cancelled', 'abandoned'] as const)(
  'refresh projects only the safe %s state', async phase => {
    const f = await fixture()
    await f.start()
    const row = (await f.opportunities())[0]!
    const opened = await attach(f, row)
    const saved = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
    if (saved.kind !== 'accepted') throw new Error('Expected seal')
    await f.t.run(ctx => ctx.db.patch(row._id, { phase }))
    const expected = ['invalid', 'cancelled', 'abandoned'].includes(phase) ? 'closed'
      : ['reconciliation_required', 'scored_pass', 'scored_fail'].includes(phase) ? 'result_unconfirmed' : 'saved_scoring'
    const pointers = await f.read()
    expect(pointers).toEqual([expect.objectContaining({ state: expected })])
    expect(await f.read()).toEqual(pointers)
    expect(JSON.stringify(pointers)).not.toMatch(/Hypothetical|PRIVATE|payload|score|feedback|submissionId|deliveryGrantId/)
  })

test('no Canvas means no check row or invented destination and an explicit non-admission', async () => {
  const f = await fixture({ canvas: false })
  expect(await f.read()).toEqual([])
  expect(await f.start()).toMatchObject({ status: 'in_progress' })
  expect(await f.read()).toEqual([])
  expect((await f.opportunities()).filter(row => row.purpose.kind.startsWith('measurement_'))).toEqual([])
  const assignment = await f.t.run(ctx => ctx.db.query('learnMeasurementAssignments').first())
  expect(assignment).toMatchObject({ status: 'not_admitted', flow: 'v2_canvas', entryPoint: 'today', exclusionReasons: ['canvas_not_admitted', 'not_admitted'] })
  expect((await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(4))).filter(row => ['cold_measurement', 'delayed_measurement'].includes(row.purpose))).toEqual([])
})

test('Today grants and reads cannot change flow; canonical acceptance and scoring retain adaptive gates', async () => {
  const f = await fixture()
  await f.start()
  const row = (await f.opportunities())[0]!
  const reference = { version: LEARN_V2_PUBLIC_API_VERSION, assessmentOpportunityId: row._id }
  expect(await f.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, { ...reference, expectedRevision: row.revision,
    idempotencyKey: 'pointer_launder_grant_1234567890' })).toMatchObject({ reasonCodes: ['flow_mismatch'] })
  const opened = await attach(f, row)
  expect(await f.owner.query(api.learnV2Assessments.getAssessment, reference)).toMatchObject({ reasonCodes: ['flow_mismatch'] })
  const setEntitlement = async (enabled: boolean) => f.t.run(async ctx => {
    const user = (await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique())!
    await ctx.db.patch(user._id, { learnAdaptiveExperienceEntitlement: { enabled, updatedAt: NOW } })
  })
  await setEntitlement(false)
  await expect(f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: 'pointer_launder_accept_1234567890', response: { target: { assessmentOpportunityId: row._id }, expectedRevision: 2,
      payload: { kind: 'text', text: opened.stage.response }, confidence: 3 } } })).rejects.toThrow('Learn access denied')
  await setEntitlement(true)
  const saved = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
  if (saved.kind !== 'accepted') throw new Error('Expected seal')
  await setEntitlement(false)
  await expect(f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: saved.submissionId, idempotencyKey: 'pointer_launder_score_1234567890' })).rejects.toThrow('Learn access denied')
})

test.each(['source', 'entitlement', 'pilot', 'thread', 'void'] as const)('refresh never invents a destination after %s revocation', async revoked => {
  const f = await fixture()
  await f.start()
  const row = (await f.opportunities())[0]!
  expect(await f.read()).toHaveLength(1)
  await f.t.run(async ctx => {
    if (revoked === 'source') await ctx.db.patch(f.graph.sourceSnapshotId, { evidencePurgedAt: Date.now() })
    if (revoked === 'entitlement') {
      const user = (await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique())!
      await ctx.db.patch(user._id, { learnAdaptiveExperienceEntitlement: { enabled: false, updatedAt: NOW } })
    }
    if (revoked === 'thread' && row.contextPins.kind === 'session') await ctx.db.patch(row.contextPins.canvas!.threadId, { deletionStartedAt: NOW })
    if (revoked === 'void') await ctx.db.delete(f.graph.learningVoidId)
  })
  if (revoked === 'pilot') Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { pilotApproved: false })
  expect(await f.read()).toEqual([])
})

test('the amendment off keeps the dev Today grant contract and adds no projection field', async () => {
  policy.pointers = false
  const f = await fixture()
  expect(await f.owner.query(api.learnV2Today.getToday, {})).not.toHaveProperty('checkPointers')
  expect(await f.start()).toMatchObject({ status: 'assessment', deliveryGrant: { status: 'granted' } })
  const assignment = await f.t.run(ctx => ctx.db.query('learnMeasurementAssignments').first())
  expect(assignment).toMatchObject({ flow: 'v2_today', entryPoint: 'today' })
})

test('pointer reads and Canvas attachment fit the shared 64-row inventory bound with native limits', async () => {
  const f = await fixture({ inventory: { claims: 32, supports: 2, sources: 64 } })
  await f.start()
  expect(await f.read()).toEqual([expect.objectContaining({ state: 'ready' })])
  await attach(f, (await f.opportunities())[0]!)
  const today = await f.owner.query(api.learnV2Today.getToday, {})
  expect(await f.owner.query(api.learnV2Today.getCheckPointers, {})).toEqual('checkPointers' in today ? today.checkPointers : null)
})

test('bounded discovery pages retain an older check after more than 32 later records', async () => {
  const f = await fixture()
  await f.start()
  await f.t.run(async ctx => {
    const row = (await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_phase', q => q.eq('userId', userId).eq('phase', 'ready')).first())!
    const { _id, _creationTime, ...fields } = row
    for (let index = 0; index < 32; index++) await ctx.db.insert('learnAssessmentOpportunities', { ...fields, delayedCheckId: `overflow-${index}` })
  })
  const first = await f.owner.query(api.learnV2Today.getCheckPointers, {})
  expect(first).toMatchObject({ status: 'available', isDone: false, checks: [] })
  const next = await f.owner.query(api.learnV2Today.getCheckPointers, { cursor: first.continueCursor! })
  expect(next).toMatchObject({ status: 'available', isDone: true, continueCursor: null,
    checks: [expect.objectContaining({ state: 'ready' })] })
  expect(await f.owner.query(api.learnV2Today.getCheckPointers, { cursor: first.continueCursor! })).toEqual(next)
})

test('an ungranted expired check has a closed pointer without minting a grant', async () => {
  const f = await fixture()
  await f.start()
  const row = (await f.opportunities())[0]!
  vi.setSystemTime(row.closeAt)
  expect(await f.read()).toEqual([expect.objectContaining({ state: 'closed' })])
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(4))).toEqual([])
})

test('responses off dominates the new capability and preserves the original Today projection', async () => {
  const f = await fixture()
  policy.responses = false
  policy.pointers = false
  const original = await f.owner.query(api.learnV2Today.getToday, {})
  policy.pointers = true
  expect(JSON.stringify(await f.owner.query(api.learnV2Today.getToday, {}))).toBe(JSON.stringify(original))
  expect(await f.owner.query(api.learnV2Today.getCheckPointers, {})).toEqual({ status: 'disabled', reasonCode: 'disabled', checks: [], isDone: true, continueCursor: null })
})
