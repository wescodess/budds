/// <reference types="vite/client" />
import { createTimeoutScope, deferred } from '../tests/support/timeout-isolation'
import { makeFunctionReference } from 'convex/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import { canvasFamilyFixture, canvasIdentity } from '../tests/fixtures/learn-v2-canvas'
import { publishDeliveryTeaching, syntheticDeliveryProtocol, type DeliveryTeachingShape } from '../tests/fixtures/learn-v2-assessment-delivery'
import { ADAPTIVE_V2_PILOT_MANIFEST } from '../shared/adaptive-v2-pilot-policy'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION } from '../shared/learn-v2-responses'
import { learnCanvasCheckReceiptSchema, learnTodayCheckPointerSchema } from '../shared/learn-v2-today-check'
import { LEARN_V2_PUBLIC_API_VERSION } from './lib/learnV2PublicContract'
import { createLearnScorerRegistry, sealLearnScorerConfiguration } from './lib/learnV2ScorerConfig'
import { privacyDigest } from './lib/learnV2ResponsePrivacy'
import type { Doc, Id } from './_generated/dataModel'
import * as privacyContext from './lib/learnV2PrivacyReadContext'
import { readCanvasCheckPointerForOwner } from './learnAdaptiveCanvas'
import { measurementReadContext } from './lib/learnV2MeasurementReadContext'
import { prepareSavedLearnModelScoring } from './lib/learnV2MeasurementScoring'
import { LEARN_REPORT_APPROVALS, reportControl } from './lib/learnV2MeasurementReportAccess'
import { LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION } from '../shared/learn-v2-measurement-report'
import { seedFixedCheckPlan } from '../tests/fixtures/learn-v2-fixed-check-plan'
import * as dedicatedChecks from './lib/learnV2DelayedDelivery'
import * as canvasPreparation from './learnAdaptiveCanvas'
import { LEARN_V2_MEASUREMENT_ADMISSION_REASONS } from '../shared/learn-v2-measurement'

const policy = vi.hoisted(() => ({ pointers: true, responses: true, enrollment: true, delivery: true, reports: false, evidenceRows: 64, protocol: null as unknown, scorer: null as unknown }))
vi.mock('../shared/learn-v2-measurement-item-limits', async original => {
  const value = await original<typeof import('../shared/learn-v2-measurement-item-limits')>()
  return { ...value, LEARN_MEASUREMENT_ITEM_LIMITS: { ...value.LEARN_MEASUREMENT_ITEM_LIMITS, get evidenceRows() { return policy.evidenceRows } },
    assertMeasurementEvidenceRows(claims: Parameters<typeof value.assertMeasurementEvidenceRows>[0]) {
      if (claims.reduce((count, claim) => count + claim.supports.length, 0) > policy.evidenceRows) throw new value.MeasurementItemBoundsError('item_evidence_limit')
      value.assertMeasurementEvidenceRows(claims)
    } }
})
vi.mock('../shared/learn-v2-measurement-storage-manifest', async original => {
  const value = await original<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...value, LEARN_MEASUREMENT_CAPABILITIES: { ...value.LEARN_MEASUREMENT_CAPABILITIES,
    get enrollment() { return policy.enrollment }, get delivery() { return policy.delivery }, scoring: true, get responses() { return policy.responses }, get reports() { return policy.reports },
    get todayCanvasChecks() { return policy.pointers } } }
})
vi.mock('./lib/learnV2MeasurementAssignment', async original => {
  const value = await original<typeof import('./lib/learnV2MeasurementAssignment')>()
  return { ...value, getFrozenLearnMeasurementProtocol: () => policy.protocol }
})
vi.mock('./lib/learnV2MeasurementScorerInventory', () => ({ getLearnMeasurementScorer: async () => policy.scorer }))

const originalManifest = structuredClone(ADAPTIVE_V2_PILOT_MANIFEST)
const userId = canvasIdentity.tokenIdentifier
const due = makeFunctionReference<'mutation', { userId: string, through: number }>('learnV2MeasurementDueWork:materializeDelayedCheckEligibility')
const enrollProspect = makeFunctionReference<'mutation', { studySessionId: Id<'studySessions'>, familyId: Id<'learnMeasurementFamilies'>,
  entryPoint: 'today' }>('learnV2Measurement:enrollProspect')
const NOW = Date.parse('2027-03-07T15:00:00Z')

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW)
  policy.pointers = true; policy.responses = true; policy.enrollment = true; policy.delivery = true; policy.reports = false; policy.evidenceRows = 64; LEARN_REPORT_APPROVALS.splice(0)
  vi.stubEnv('LEARN_ADAPTIVE_V2_PILOT_MANIFEST', ADAPTIVE_V2_PILOT_MANIFEST.version)
  for (const name of ['OPENROUTER_API_KEY', 'CF_ACCOUNT_ID', 'CLOUDFLARE_AI_GATEWAY_ID']) vi.stubEnv(name, 'synthetic-unused')
})
afterEach(() => {
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, originalManifest)
  LEARN_REPORT_APPROVALS.splice(0)
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers()
})

async function fixture(options: { canvas?: boolean, rubric?: boolean, inventory?: { claims: number, supports: number, sources: number, backingDocuments?: boolean }, reserveCount?: number,
  test?: Awaited<ReturnType<typeof canvasFamilyFixture>>['t'], fixtureKey?: string, teaching?: DeliveryTeachingShape } = {}) {
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
  const f = await canvasFamilyFixture(saved.binding, { rubric: options.rubric ?? true, inventory: options.inventory, reserveCount: options.reserveCount, test: options.test, fixtureKey: options.fixtureKey })
  if (options.canvas !== false) await f.t.run(async ctx => {
    const user = (await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique())!
    await ctx.db.patch(user._id, { learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: NOW } })
  })
  await publishDeliveryTeaching(f, options.teaching)
  const start = (entryPoint: 'today' | 'session_deep_link' = 'today') => f.owner.mutation(api.learnV2SessionContent.startStudySession, {
    studySessionId: f.graph.studySessionId, expectedSessionRevision: 2, expectedContentRevision: 1,
    idempotencyKey: `today_pointer_start_${entryPoint}`, entryPoint })
  const opportunities = () => f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q => q.eq('userId', userId)).take(16))
  const read = async () => {
    const today = await f.owner.query(api.learnV2Today.getToday, {})
    if (!('checkPointers' in today)) throw new Error('Expected pointer projection')
    expect(today.checkPointers.status).toBe('available')
    const checks = [...today.checkPointers.checks]
    let isDone = today.checkPointers.isDone
    let cursor = today.checkPointers.continueCursor
    let pages = 1
    while (!isDone) {
      expect(cursor).toBeTruthy()
      const page = await f.owner.query(api.learnV2Today.getCheckPointers, { cursor: cursor! })
      expect(page.status).toBe('available')
      checks.push(...page.checks)
      isDone = page.isDone
      cursor = page.continueCursor
      expect(++pages).toBeLessThan(100)
    }
    return checks
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

function modelReply(awarded = true) {
  return new Response(JSON.stringify({ id: 'synthetic-execution', model: 'synthetic/model', choices: [{ index: 0, finish_reason: 'stop',
    message: { role: 'assistant', content: JSON.stringify({ criterionResults: [{ key: 'private-criterion', awarded }], misconceptionTags: [] }) } }],
    usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 }, openrouter_metadata: { requested: 'synthetic/model', strategy: 'direct', attempt: 1,
      endpoints: { available: [{ provider: 'Synthetic Provider', model: 'synthetic/model', selected: true }] }, pipeline: [] } }))
}

async function coldFor(f: Awaited<ReturnType<typeof fixture>>) {
  const rows = await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_learningVoidId', q =>
    q.eq('userId', userId).eq('learningVoidId', f.graph.learningVoidId)).take(8))
  const row = rows.find(value => value.purpose.kind === 'measurement_cold')
  if (!row) throw new Error('Expected cold check')
  return row
}

async function anotherTodayLesson(f: Awaited<ReturnType<typeof fixture>>) {
  const studySessionId = await f.t.run(ctx => ctx.db.insert('studySessions', { userId, studyPlanRevisionId: f.graph.studyPlanRevisionId,
    primaryObjectiveId: f.graph.objectiveId, status: 'planned', revision: 1, scheduledStartAt: NOW }))
  await publishDeliveryTeaching({ t: f.t, graph: { ...f.graph, studySessionId } })
  return studySessionId
}

test('Today preserves its planned lesson behind a dedicated Canvas check and opens it after saving', async () => {
  const f = await fixture()
  const lesson = await f.t.run(ctx => ctx.db.get(f.graph.studySessionId))
  await f.start()
  const cold = (await f.opportunities())[0]!
  if (cold.contextPins.kind !== 'session') throw new Error('Expected dedicated session')
  expect(cold.contextPins.studySessionId).not.toBe(f.graph.studySessionId)
  expect(await f.t.run(ctx => ctx.db.get(f.graph.studySessionId))).toEqual(lesson)
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', sessionId: f.graph.studySessionId,
    assessment: { kind: 'check', check: { state: 'ready' } }, checkPointers: { checks: [expect.objectContaining({ state: 'ready' })] } })
  expect(await f.owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: f.graph.studySessionId })).toMatchObject({ blocks: [] })
  const opened = await attach(f, cold)
  const accepted = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
  expect(accepted.kind).toBe('accepted')
  expect(await f.t.run(ctx => ctx.db.get(f.graph.studySessionId))).toEqual(lesson)
  expect(await f.t.run(ctx => ctx.db.get(opened.stage.studySessionId))).toMatchObject({ status: 'completed' })
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', sessionId: f.graph.studySessionId,
    assessment: { kind: 'teach' }, checkPointers: { checks: [expect.objectContaining({ state: 'saved_scoring' })] } })
  expect(await f.start()).toMatchObject({ status: 'in_progress' })
  const teaching = await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.graph.studySessionId,
    idempotencyKey: 'preserved_today_lesson_delivery_1234567890' })
  expect(teaching.value?.blocks.length).toBeGreaterThan(0)
  expect(JSON.stringify(teaching)).toContain('TEACHING-CANARY')
  expect(JSON.stringify(teaching)).not.toMatch(/Hypothetical|PRIVATE|A saved learner answer/)
})

test('a due delayed Canvas check locks the later Today lesson until its answer is saved', async () => {
  const f = await fixture()
  await f.t.run(ctx => ctx.db.patch(f.graph.studySessionId, { scheduledEndAt: NOW + 30 * 60_000 }))
  await f.start()
  const cold = await coldFor(f)
  const opening = await attach(f, cold)
  expect((await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opening.stage)).kind).toBe('accepted')
  const delayed = (await f.opportunities()).find(row => row.horizonDays === 7)!
  vi.setSystemTime(delayed.openAt + 1000)
  await f.owner.mutation(api.learnV2Plans.markExpiredSessionsMissed, { learningVoidId: f.graph.learningVoidId,
    idempotencyKey: 'prior_today_lesson_expired_1234567890' })
  await f.t.mutation(due, { userId, through: Date.now() })
  const later = await anotherTodayLesson(f)
  await f.t.run(ctx => ctx.db.patch(later, { scheduledStartAt: Date.now() }))
  const lesson = (await f.t.run(ctx => ctx.db.get(later)))!
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', sessionId: later,
    assessment: { kind: 'check', check: { reference: delayed.delayedCheckId, state: 'ready' } } })
  const start = () => f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: later,
    expectedSessionRevision: 2, expectedContentRevision: 1, entryPoint: 'today', idempotencyKey: 'due_check_today_lesson_1234567890' })
  expect(await start()).toMatchObject({ status: 'assessment', deliveryGrant: null,
    assessment: { check: { reference: delayed.delayedCheckId } } })
  expect(await f.t.run(ctx => ctx.db.get(later))).toEqual(lesson)
  const opened = await attach(f, (await f.opportunities()).find(row => row._id === delayed._id)!)
  await f.t.mutation(due, { userId, through: Date.now() })
  expect(await f.t.run(ctx => ctx.db.get(delayed._id))).toMatchObject({ operationalEligibility: 'eligible' })
  expect((await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)).kind).toBe('accepted')
  expect(await start()).toMatchObject({ status: 'in_progress' })
  const teaching = await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: later,
    idempotencyKey: 'after_delayed_save_lesson_1234567890' })
  expect(teaching.value?.blocks.length).toBeGreaterThan(0)
})

test('dedicated cold checks retain their frozen binding through repeated lesson reflows and rollback', async () => {
  vi.setSystemTime(NOW - 8 * 60 * 60_000)
  const f = await fixture()
  await f.start()
  const cold = await coldFor(f)
  if (cold.contextPins.kind !== 'session') throw new Error('Expected dedicated check')
  vi.setSystemTime(NOW - 8 * 60 * 60_000 + 30 * 60_000 + 1000)
  await f.t.run(ctx => seedFixedCheckPlan(ctx, userId, f.graph, Date.now()))
  const first = await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: f.graph.studyPlanRevisionId,
    expectedPlanRecordRevision: 1, idempotencyKey: 'cold_check_first_reflow_1234567890' })
  expect(first.preservedSessionIds).toContain(cold.contextPins.studySessionId)
  policy.pointers = false
  const active = (await f.t.run(ctx => ctx.db.get(f.graph.studyPlanId)))!.activeRevisionId!
  const second = await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: active,
    expectedPlanRecordRevision: 1, idempotencyKey: 'cold_check_second_reflow_1234567890' })
  expect(second.preservedSessionIds).toContain(cold.contextPins.studySessionId)
  expect((await f.t.run(ctx => ctx.db.get(cold._id)))!.contextPins).toEqual(cold.contextPins)
  expect(await f.read()).toEqual([expect.objectContaining({ reference: cold.delayedCheckId, state: 'ready' })])
  await attach(f, cold)
})

test.each([true, false])('later Today teaching preserves its treatment flow and Canvas checks after cold pass=%s', async passed => {
  const f = await fixture()
  await f.start()
  const cold = (await f.opportunities())[0]!
  const opened = await attach(f, cold)
  const accepted = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
  if (accepted.kind !== 'accepted') throw new Error('Expected seal')
  vi.stubGlobal('fetch', vi.fn(async () => modelReply(passed)))
  await f.owner.action(api.learnAdaptive.submitResponse, { threadId: opened.attached.threadId, activityId: opened.attached.activityId,
    submissionId: accepted.submissionId, idempotencyKey: 'today_treatment_score_1234567890' })
  expect(await f.start()).toMatchObject({ status: 'in_progress' })
  const later = await anotherTodayLesson(f)
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: later, expectedSessionRevision: 2,
    expectedContentRevision: 1, idempotencyKey: 'later_today_treatment_1234567890', entryPoint: 'today' })).toMatchObject({ status: 'in_progress' })
  const assignment = (await f.t.run(ctx => ctx.db.get(cold.assignmentId!)))!
  expect(assignment).toMatchObject({ flow: 'v2_today', entryPoint: 'today', checkSurface: { surface: 'canvas', measurementFlow: 'v2_today' } })
  expect(assignment.exclusionReasons).not.toContain('mixed_flow')
  const response = await f.t.run(ctx => ctx.db.get(accepted.submissionId))
  expect(response).toMatchObject({ flow: 'canvas', contextPins: { checkSurface: { surface: 'canvas', measurementFlow: 'v2_today' } } })
  const delayed = (await f.opportunities()).find(row => row.horizonDays === 7)!
  vi.setSystemTime(delayed.openAt + 1000)
  await f.t.mutation(due, { userId, through: Date.now() })
  const ready = (await f.opportunities()).find(row => row._id === delayed._id)!
  expect((await f.read()).find(row => row.reference === delayed.delayedCheckId)).toMatchObject({ state: 'ready' })
  await attach(f, ready)
  expect(await f.owner.query(api.learnV2Assessments.getAssessment, { version: LEARN_V2_PUBLIC_API_VERSION,
    assessmentOpportunityId: ready._id })).toMatchObject({ status: 'unavailable', reasonCodes: ['flow_mismatch'] })
})

async function revokeCanvas(revocation: 'entitlement' | 'pilot', f: Awaited<ReturnType<typeof fixture>>) {
  if (revocation === 'pilot') Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { pilotApproved: false })
  else await f.t.run(async ctx => {
    const user = (await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique())!
    await ctx.db.patch(user._id, { learnAdaptiveExperienceEntitlement: { enabled: false, updatedAt: Date.now() } })
  })
}

const measurementRows = (f: Awaited<ReturnType<typeof fixture>>) => Promise.all([
  f.t.run(ctx => ctx.db.query('learnMeasurementAssignments').take(4)),
  f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').take(8)),
  f.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(4)),
  f.opportunities().then(rows => rows.filter(row => row.assignmentId)),
])

async function expectTeachingDelivery(f: Awaited<ReturnType<typeof fixture>>, studySessionId: Id<'studySessions'>, key: string) {
  const delivered = await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, {
    studySessionId, idempotencyKey: `fallback_delivery_${key}` })
  expect(delivered.admission.status).not.toBe('denied')
  expect(delivered.value?.blocks.length).toBeGreaterThan(0)
  expect(JSON.stringify(delivered)).toContain('TEACHING-CANARY')
  return delivered
}

test.each([true, false])('initial protocol absence opens teaching only with Today Canvas checks enabled=%s', async enabled => {
  const f = await fixture()
  policy.pointers = enabled
  policy.protocol = null
  for (let retry = 0; retry < 2; retry++) {
    expect(await f.start()).toMatchObject(enabled ? { status: 'in_progress' }
      : { status: 'assessment', assessment: { kind: 'blocked', reasonCode: 'protocol_not_frozen', state: null } })
    expect(await f.t.run(ctx => ctx.db.get(f.graph.studySessionId))).toMatchObject({ status: enabled ? 'in_progress' : 'ready' })
    if (enabled) await expectTeachingDelivery(f, f.graph.studySessionId, `missing_protocol_${retry}`)
  }
  for (const rows of (await measurementRows(f)).slice(0, 2)) expect(rows).toEqual([])
})

test.each(['protocol', 'enrollment', 'delivery', 'catalog', 'cold_inventory'] as const)(
  'early %s unavailability settles an unanswered check before ordinary teaching', async failure => {
    const f = await fixture()
    await f.start()
    const cold = await coldFor(f)
    if (failure === 'protocol') policy.protocol = null
    if (failure === 'enrollment') policy.enrollment = false
    if (failure === 'delivery') policy.delivery = false
    if (failure === 'catalog') await f.t.run(ctx => ctx.db.patch(f.graph.catalogId, { measurementCapability: { enabled: false } }))
    if (failure === 'cold_inventory') await f.t.run(ctx => ctx.db.delete(cold._id))
    expect(await f.start()).toMatchObject({ status: 'in_progress' })
    await expectTeachingDelivery(f, f.graph.studySessionId, `early_${failure}`)
    const settled = await f.t.run(ctx => ctx.db.get(cold._id))
    if (failure === 'cold_inventory') expect(settled).toBeNull()
    else expect(settled).toMatchObject({ phase: 'cancelled', operationalEligibility: 'blocked',
      reasonCode: failure === 'protocol' ? 'protocol_not_frozen' : failure === 'catalog' ? 'unknown_history'
        : failure === 'delivery' ? 'cold_after_teaching' : 'disabled' })
  })

const TRANSIENT_PREPARATION = ['disabled', 'protocol_not_frozen', 'session_unavailable', 'outside_window', 'evidence_unavailable', 'scorer_unavailable'] as const
test('historical non-admissions cannot impose a new teaching limit during protocol fallback', async () => {
  const f = await fixture({ canvas: false })
  await f.start()
  await f.t.run(async ctx => {
    const assignment = (await ctx.db.query('learnMeasurementAssignments').withIndex('by_userId', q => q.eq('userId', userId)).unique())!
    const { _id: _assignmentId, _creationTime: _created, ...fields } = assignment
    for (let index = 1; index < 9; index++) await ctx.db.insert('learnMeasurementAssignments', { ...fields,
      assignmentKey: `historical_non_admission_${index}`, epoch: `synthetic.history.${index}`, createdAt: NOW - index })
    const practice = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_contextPins_studySessionId', q =>
      q.eq('userId', userId).eq('contextPins.studySessionId', f.graph.studySessionId)).take(2)
    for (const row of practice) await ctx.db.patch(row._id, { phase: 'cancelled' })
    await ctx.db.patch(f.graph.studySessionId, { status: 'completed' })
  })
  const later = await anotherTodayLesson(f)
  policy.protocol = null
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', sessionId: later })
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: later, expectedSessionRevision: 2,
    expectedContentRevision: 1, entryPoint: 'today', idempotencyKey: 'historical_non_admission_lesson' })).toMatchObject({ status: 'in_progress' })
  await expectTeachingDelivery(f, later, 'historical_non_admissions')
})

const PREPARATION_REASON_SWEEP = [...new Set([...TRANSIENT_PREPARATION, ...LEARN_V2_MEASUREMENT_ADMISSION_REASONS,
  'pilot_not_admitted', 'response_format_unavailable', 'assessment_unavailable', 'canvas_not_admitted',
  'outside_enrollment_window', 'protocol_horizon_mismatch'])]
test.each(PREPARATION_REASON_SWEEP)('preparation reason %s always starts and delivers valid ordinary teaching', async reasonCode => {
  const f = await fixture()
  vi.spyOn(canvasPreparation, 'prepareCanvasSessionForOwner').mockResolvedValue({ kind: 'not_admitted', reasonCode, observations: 'no_observations' })
  expect(await f.start()).toMatchObject({ status: 'in_progress' })
  await expectTeachingDelivery(f, f.graph.studySessionId, `reason_${reasonCode}`)
  const [assignments, facts, , opportunities] = await measurementRows(f)
  if (TRANSIENT_PREPARATION.some(reason => reason === reasonCode)) {
    expect(assignments).toEqual([])
    expect(facts).toEqual([])
  } else {
    expect(assignments).toMatchObject([{ status: 'not_admitted', reasonCode }])
    expect(facts).toMatchObject([{ fact: { kind: 'enrollment', status: 'not_admitted' } }])
  }
  expect(opportunities).toEqual([])
})

test.each(['preparing_pending', 'preparing_blocked', 'ready_blocked', 'test_open_blocked', 'ready_eligible'] as const)(
  'a due unanswered %s check is settled before the later lesson starts and delivers', async state => {
    const f = await fixture()
    await f.t.run(ctx => ctx.db.patch(f.graph.studySessionId, { scheduledEndAt: NOW + 30 * 60_000 }))
    await f.start()
    const cold = await coldFor(f)
    const opening = await attach(f, cold)
    expect((await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opening.stage)).kind).toBe('accepted')
    const savedCold = await f.t.run(ctx => ctx.db.get(cold._id))
    const delayed = (await f.opportunities()).find(row => row.horizonDays === 7)!
    vi.setSystemTime(delayed.openAt + 1000)
    await f.owner.mutation(api.learnV2Plans.markExpiredSessionsMissed, { learningVoidId: f.graph.learningVoidId,
      idempotencyKey: `settled_prior_${state}` })
    if (!state.startsWith('preparing')) {
      await f.t.mutation(due, { userId, through: Date.now() })
      if (state.startsWith('test_open')) await attach(f, (await f.opportunities()).find(row => row._id === delayed._id)!)
    }
    await revokeCanvas('entitlement', f)
    if (state.endsWith('blocked')) await f.t.mutation(due, { userId, through: Date.now() })
    const [phase, operationalEligibility] = state.startsWith('test_open') ? ['test_open', 'blocked'] : state.split('_')
    expect(await f.t.run(ctx => ctx.db.get(delayed._id))).toMatchObject({ phase, operationalEligibility })
    const later = await anotherTodayLesson(f)
    await f.t.run(ctx => ctx.db.patch(later, { scheduledStartAt: Date.now() }))
    expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', sessionId: later, assessment: { kind: 'teach' } })
    expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: later, expectedSessionRevision: 2,
      expectedContentRevision: 1, entryPoint: 'today', idempotencyKey: `settled_start_${state}` })).toMatchObject({ status: 'in_progress' })
    await expectTeachingDelivery(f, later, state)
    expect(await f.t.run(ctx => ctx.db.get(delayed._id))).toMatchObject({ phase: 'cancelled', operationalEligibility: 'blocked', reasonCode: 'canvas_not_admitted' })
    expect(await f.t.run(ctx => ctx.db.get(cold._id))).toEqual(savedCold)
    const facts = await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_assessmentOpportunityId', q =>
      q.eq('userId', userId).eq('fact.assessmentOpportunityId', delayed._id)).take(16))
    expect(facts.some(row => row.fact.kind === 'opportunity' && row.fact.status === 'blocked' && row.fact.reasonCode === 'canvas_not_admitted')).toBe(true)
    expect(facts.some(row => row.fact.kind === 'opportunity' && row.fact.status === 'cancelled' && row.fact.reasonCode === 'canvas_not_admitted')).toBe(true)
    expect(facts.some(row => row.fact.kind === 'opportunity' && row.fact.reasonCode === 'missed_window')).toBe(false)
    expect((await f.opportunities()).filter(row => ['measurement_cold', 'measurement_delayed', 'retained_transfer'].includes(row.purpose.kind)
      && row.submissionId === undefined && row.openAt <= Date.now() && row.closeAt > Date.now()
      && ['preparing', 'ready', 'test_open'].includes(row.phase))).toEqual([])
  })

test.each(['scorer', 'evidence'] as const)('a transient %s preparation failure writes nothing and opens the Today lesson', async failure => {
  const f = await fixture()
  const scorer = policy.scorer
  if (failure === 'scorer') policy.scorer = { ...(scorer as object), saved: null }
  if (failure === 'evidence') await f.t.run(ctx => ctx.db.patch(f.graph.sourceSnapshotId, { rightsStatus: 'unknown' }))
  expect(await f.start()).toMatchObject({ status: 'in_progress' })
  const [assignments, facts, exposures, opportunities] = await measurementRows(f)
  for (const rows of [assignments, facts, opportunities]) expect(rows).toEqual([])
  expect(exposures.filter(row => row.purpose === 'teaching' || row.assignmentId)).toEqual([])
  const owner = await f.t.run(ctx => ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique())
  expect(owner?.learnTodayCheckSurfaceVersion).toBeUndefined()
  expect(await f.read()).toEqual([])
  if (failure === 'evidence') await f.t.run(ctx => ctx.db.patch(f.graph.sourceSnapshotId, { rightsStatus: 'permitted' }))
  const teaching = await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.graph.studySessionId,
    idempotencyKey: `transient_${failure}_lesson_delivery_1234567890` })
  expect(JSON.stringify(teaching)).toContain('TEACHING-CANARY')
  policy.scorer = scorer
  const later = await anotherTodayLesson(f)
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: later, expectedSessionRevision: 2,
    expectedContentRevision: 1, idempotencyKey: `transient_${failure}_retry_1234567890`, entryPoint: 'today' })).toMatchObject({ status: 'in_progress' })
  expect(await f.t.run(ctx => ctx.db.query('learnMeasurementAssignments').take(2))).toMatchObject([{ status: 'not_admitted',
    reasonCode: 'prior_exposure', historyStatus: 'returning', flow: 'v2_today', checkSurface: { surface: 'canvas', measurementFlow: 'v2_today' } }])
  expect((await f.opportunities()).filter(row => row.assignmentId)).toEqual([])
})

const PERMANENT_PREPARATION = ['pilot_not_admitted', 'novel_item_unavailable', 'response_format_unavailable', 'assessment_unavailable',
  'outside_enrollment_window', 'unknown_history', 'protocol_horizon_mismatch'] as const
test.each(PERMANENT_PREPARATION)('a permanent %s preparation outcome records its non-admission and the lesson resolves as ordinary', async reasonCode => {
  const f = await fixture({ rubric: reasonCode !== 'response_format_unavailable' })
  const family = (await f.t.run(ctx => ctx.db.query('learnMeasurementFamilies').withIndex('by_userId', q => q.eq('userId', userId)).first()))!
  if (reasonCode === 'pilot_not_admitted') Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { pilotApproved: false })
  if (reasonCode === 'novel_item_unavailable') await f.t.run(ctx => ctx.db.patch(family._id, { status: 'quarantined' }))
  if (reasonCode === 'assessment_unavailable') await f.t.run(async ctx => {
    const item = (await ctx.db.query('learnMeasurementItems').withIndex('by_userId_and_familyId_and_familyRevision_and_formLabel', q =>
      q.eq('userId', userId).eq('familyId', family._id)).first())!
    await ctx.db.patch(item._id, { promptDigest: `sha256:${'0'.repeat(64)}` })
  })
  const protocol = policy.protocol as ReturnType<typeof syntheticDeliveryProtocol>
  if (reasonCode === 'outside_enrollment_window') policy.protocol = { ...protocol, enrollmentEndAt: NOW - 1 }
  if (reasonCode === 'protocol_horizon_mismatch') policy.protocol = { ...protocol, windows: protocol.windows.slice(0, 1) }
  if (reasonCode === 'unknown_history') await f.t.run(ctx => ctx.db.patch(f.graph.catalogId, { createdAt: NOW + 1 }))
  expect(await f.start()).toMatchObject({ status: 'in_progress' })
  await expectTeachingDelivery(f, f.graph.studySessionId, `permanent_${reasonCode}`)
  const [assignments, facts, exposures, opportunities] = await measurementRows(f)
  expect(assignments).toMatchObject([{ status: 'not_admitted', reasonCode, flow: 'v2_today', entryPoint: 'today',
    checkSurface: { surface: 'canvas', measurementFlow: 'v2_today' } }])
  expect(assignments[0]!.exclusionReasons).toContain(reasonCode)
  expect(facts).toMatchObject([{ fact: { kind: 'enrollment', status: 'not_admitted' } }])
  expect(exposures.filter(row => row.purpose === 'teaching' || row.assignmentId)).toEqual([])
  expect(opportunities).toEqual([])
  const later = await anotherTodayLesson(f)
  expect(await f.owner.query(api.learnV2Today.getToday, {})).not.toHaveProperty('assessment')
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: later, expectedSessionRevision: 2,
    expectedContentRevision: 1, idempotencyKey: `permanent_${reasonCode}_later`, entryPoint: 'today' })).toMatchObject({ status: 'in_progress' })
  await expectTeachingDelivery(f, later, `permanent_later_${reasonCode}`)
  expect(await f.t.run(ctx => ctx.db.query('learnMeasurementAssignments').take(4))).toHaveLength(1)
})

test.each(['entitlement', 'pilot'] as const)('a ready cold check that loses its Canvas %s stops locking the lesson without a fabricated miss', async revocation => {
  const f = await fixture()
  expect(await f.start()).toMatchObject({ status: 'assessment', assessment: { check: { state: 'ready' } } })
  const cold = await coldFor(f)
  await revokeCanvas(revocation, f)
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', sessionId: f.graph.studySessionId,
    assessment: { kind: 'teach' }, checkPointers: { checks: [] } })
  expect(await f.start()).toMatchObject({ status: 'in_progress' })
  expect(await f.t.run(ctx => ctx.db.get(cold._id))).toMatchObject({ phase: 'cancelled', operationalEligibility: 'blocked', reasonCode: 'cold_after_teaching' })
  const facts = await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_assessmentOpportunityId', q =>
    q.eq('userId', userId).eq('fact.assessmentOpportunityId', cold._id)).take(8))
  expect(facts.map(row => row.fact.kind === 'opportunity' ? [row.fact.status, row.fact.reasonCode ?? null] : null).slice(-3))
    .toEqual([['blocked', 'canvas_not_admitted'], ['cancelled', 'canvas_not_admitted'], ['cancelled', 'cold_after_teaching']])
  if (cold.contextPins.kind !== 'session') throw new Error('Expected dedicated check')
  const dedicated = cold.contextPins.studySessionId
  expect(await f.t.run(ctx => ctx.db.get(dedicated))).toMatchObject({ status: 'cancelled', auditReasonCode: 'canvas_not_admitted' })
  const teaching = await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.graph.studySessionId,
    idempotencyKey: `cold_${revocation}_revoked_lesson_1234567890` })
  expect(JSON.stringify(teaching)).toContain('TEACHING-CANARY')
})

test.each(['entitlement', 'pilot'] as const)('a ready day-7 check that loses its Canvas %s opens the later lesson and closes as an access block', async revocation => {
  const f = await fixture()
  await f.t.run(ctx => ctx.db.patch(f.graph.studySessionId, { scheduledEndAt: NOW + 30 * 60_000 }))
  await f.start()
  const cold = await coldFor(f)
  const opening = await attach(f, cold)
  expect((await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opening.stage)).kind).toBe('accepted')
  const delayed = (await f.opportunities()).find(row => row.horizonDays === 7)!
  vi.setSystemTime(delayed.openAt + 1000)
  await f.owner.mutation(api.learnV2Plans.markExpiredSessionsMissed, { learningVoidId: f.graph.learningVoidId,
    idempotencyKey: `revoked_${revocation}_prior_lesson_1234567890` })
  await f.t.mutation(due, { userId, through: Date.now() })
  const later = await anotherTodayLesson(f)
  await f.t.run(ctx => ctx.db.patch(later, { scheduledStartAt: Date.now() }))
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ sessionId: later,
    assessment: { kind: 'check', check: { reference: delayed.delayedCheckId, state: 'ready' } } })
  await revokeCanvas(revocation, f)
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', sessionId: later,
    assessment: { kind: 'teach' }, checkPointers: { checks: [expect.objectContaining({ reference: cold.delayedCheckId, state: 'closed' })] } })
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: later, expectedSessionRevision: 2,
    expectedContentRevision: 1, entryPoint: 'today', idempotencyKey: `revoked_${revocation}_later_lesson_1234567890` })).toMatchObject({ status: 'in_progress' })
  expect(await f.t.run(ctx => ctx.db.get(delayed._id))).toMatchObject({ phase: 'cancelled', operationalEligibility: 'blocked', reasonCode: 'canvas_not_admitted' })
  const teaching = await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: later,
    idempotencyKey: `delayed_${revocation}_revoked_lesson_1234567890` })
  expect(JSON.stringify(teaching)).toContain('TEACHING-CANARY')
  vi.setSystemTime(delayed.closeAt + 1000)
  await f.t.mutation(due, { userId, through: Date.now() })
  expect(await f.t.run(ctx => ctx.db.get(delayed._id))).toMatchObject({ phase: 'cancelled', operationalEligibility: 'blocked', reasonCode: 'canvas_not_admitted' })
  const facts = await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_assessmentOpportunityId', q =>
    q.eq('userId', userId).eq('fact.assessmentOpportunityId', delayed._id)).take(8))
  expect(facts.map(row => row.fact.kind === 'opportunity' ? row.fact.reasonCode ?? null : null)).not.toContain('missed_window')
  expect(facts.findLast(row => row.fact.kind === 'opportunity' && ['eligible', 'blocked', 'pending'].includes(row.fact.status))?.fact)
    .toMatchObject({ status: 'blocked', reasonCode: 'canvas_not_admitted' })
})

test('the merged due-work binder applies Canvas gates by frozen surface and admits dedicated cold rows', async () => {
  const f = await fixture()
  await f.start()
  const cold = await coldFor(f)
  const assignment = (await f.t.run(ctx => ctx.db.get(cold.assignmentId!)))!
  if (assignment.status !== 'admitted') throw new Error('Expected admission')
  expect(assignment.flow).toBe('v2_today')
  expect(await f.t.run(ctx => dedicatedChecks.learnDelayedCheckBindingBlock(ctx, assignment, cold))).toBeNull()
  await revokeCanvas('entitlement', f)
  expect(await f.t.run(ctx => dedicatedChecks.learnDelayedCheckBindingBlock(ctx, assignment, cold))).toBe('canvas_not_admitted')
  const legacy = { ...assignment, checkSurface: undefined, flow: 'v2_today' as const }
  expect(await f.t.run(ctx => dedicatedChecks.learnDelayedCheckBindingBlock(ctx, legacy, cold))).toBe('pins_mismatch')
})

test('Journey projects the purpose of a dedicated cold check', async () => {
  const f = await fixture()
  await f.start()
  const cold = await coldFor(f)
  if (cold.contextPins.kind !== 'session') throw new Error('Expected dedicated check')
  const opened = await attach(f, cold)
  expect((await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)).kind).toBe('accepted')
  const mission = await f.owner.mutation(api.learnV2Journey.getMissionDelivery, { learningVoidId: f.graph.learningVoidId,
    idempotencyKey: 'dedicated_cold_purpose_1234567890' })
  expect(mission.value?.plan.fixedChecks).toEqual([expect.objectContaining({ _id: cold.contextPins.studySessionId,
    assessmentPurpose: 'measurement_cold', assessmentOpportunityId: cold._id })])
})

test('an explicit Today treatment cannot be rebound to Canvas teaching or accepted without its Canvas surface', async () => {
  const f = await fixture()
  await f.start()
  const cold = await coldFor(f)
  const opened = await attach(f, cold)
  const assignment = await f.t.run(ctx => ctx.db.get(cold.assignmentId!))
  const later = await anotherTodayLesson(f)
  expect(await f.owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, { studySessionId: later, expectedSessionRevision: 2,
    idempotencyKey: 'deny_today_canvas_teaching_1234567890' })).toMatchObject({ kind: 'not_admitted', reasonCode: 'flow_mismatch' })
  expect(await f.t.run(ctx => ctx.db.get(cold.assignmentId!))).toEqual(assignment)
  const current = (await f.t.run(ctx => ctx.db.get(cold._id)))!
  if (current.contextPins.kind !== 'session') throw new Error('Expected Canvas context')
  const { canvas: _canvas, ...contextPins } = current.contextPins
  await f.t.run(ctx => ctx.db.patch(cold._id, { contextPins }))
  expect(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: 'deny_unbound_today_accept_1234567890', response: { target: { assessmentOpportunityId: cold._id },
      expectedRevision: current.revision, payload: { kind: 'text', text: opened.stage.response }, confidence: 3 } } }))
    .toMatchObject({ kind: 'rejected', reasonCode: 'pins_mismatch' })
  expect(await f.t.run(ctx => ctx.db.query('learnResponses').take(2))).toEqual([])
})

test('a preparation resource failure after admission rolls back every enrollment write and retries', async () => {
  const f = await fixture()
  const lesson = await f.t.run(ctx => ctx.db.get(f.graph.studySessionId))
  const failure = vi.spyOn(dedicatedChecks, 'bindLearnDelayedCheck').mockRejectedValue(new Error('Learn source validation budget exhausted'))
  await expect(f.start()).rejects.toThrow('Learn source validation budget exhausted')
  for (const rows of await Promise.all([
    f.t.run(ctx => ctx.db.query('learnMeasurementAssignments').take(2)),
    f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').take(2)),
    f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').take(2)),
    f.t.run(ctx => ctx.db.query('learnMeasurementSourceWatermarks').take(2)),
    f.t.run(ctx => ctx.db.query('learnActivityCommandReceipts').take(2)),
  ])) expect(rows).toEqual([])
  expect(await f.t.run(ctx => ctx.db.get(f.graph.studySessionId))).toEqual(lesson)
  const owner = await f.t.run(ctx => ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique())
  expect(owner?.learnTodayCheckSurfaceVersion).toBeUndefined()
  failure.mockRestore()
  expect(await f.start()).toMatchObject({ status: 'assessment', assessment: { check: { state: 'ready' } } })
})

test('prospective Today callers cannot bypass the server-owned Canvas preparation binding', async () => {
  const f = await fixture()
  const family = (await f.t.run(ctx => ctx.db.query('learnMeasurementFamilies').withIndex('by_userId', q => q.eq('userId', userId)).first()))!
  expect(await f.owner.mutation(enrollProspect, { studySessionId: f.graph.studySessionId, familyId: family._id,
    entryPoint: 'today' })).toEqual({ status: 'not_admitted', assignmentId: null, reasonCodes: ['canvas_preparation_required'] })
  expect(await f.t.run(ctx => ctx.db.query('learnMeasurementAssignments').take(2))).toEqual([])
  expect(await f.start()).toMatchObject({ status: 'assessment', assessment: { check: { state: 'ready' } } })
})

test('C6 pins Today treatment and honest entry strata in frozen Canvas-check source inputs', async () => {
  policy.reports = true
  const f = await fixture()
  await f.t.run(ctx => ctx.db.insert('learnMeasurementSourceWatermarks', { userId, storageVersion: 'learn-v2.measurement-storage.v1',
    createdAt: NOW, sourceVersion: LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, sequence: 0, dueWorkThrough: null, historyCoverage: 'complete', updatedAt: NOW }))
  await f.start()
  const cold = await coldFor(f)
  const opened = await attach(f, cold)
  const accepted = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
  if (accepted.kind !== 'accepted') throw new Error('Expected cold seal')
  vi.stubGlobal('fetch', vi.fn(async () => modelReply()))
  await f.owner.action(api.learnAdaptive.submitResponse, { threadId: opened.attached.threadId, activityId: opened.attached.activityId,
    submissionId: accepted.submissionId, idempotencyKey: 'today_c6_cold_score_1234567890' })
  await f.start()
  const day7 = (await f.opportunities()).find(row => row.horizonDays === 7)!
  vi.setSystemTime(day7.openAt + 1000)
  await f.t.mutation(due, { userId, through: Date.now() })
  const check = await attach(f, (await f.opportunities()).find(row => row._id === day7._id)!)
  const saved = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, check.stage)
  if (saved.kind !== 'accepted') throw new Error('Expected delayed seal')
  await f.owner.action(api.learnAdaptive.submitResponse, { threadId: check.attached.threadId, activityId: check.attached.activityId,
    submissionId: saved.submissionId, idempotencyKey: 'today_c6_delayed_score_1234567890' })
  await f.t.mutation(due, { userId, through: Date.now() })
  const protocol = syntheticDeliveryProtocol(NOW)
  const viewerId = 'https://report.example|today-surface-viewer'
  LEARN_REPORT_APPROVALS.push({ tokenIdentifier: viewerId, principalBindingVersion: 'today.binding.v1', grantVersion: 'today.grant.v1',
    cohortVersion: protocol.cohortVersion, epoch: protocol.epoch, protocolVersion: protocol.version, baselineSha: protocol.baselineSha,
    frozenAt: protocol.enrollmentStartAt - 1, owners: [userId], replacementPolicy: { kind: 'secondary_only' } })
  const viewerGrantId = await f.t.run(ctx => ctx.db.insert('learnMeasurementReportViewerGrants', { userId: viewerId,
    storageVersion: 'learn-v2.measurement-storage.v1', createdAt: Date.now(), cohortVersion: protocol.cohortVersion, epoch: protocol.epoch,
    principalBindingVersion: 'today.binding.v1', grantVersion: 'today.grant.v1', status: 'active', grantedAt: Date.now(), expiresAt: Date.now() + 86_400_000 }))
  const viewer = f.t.withIdentity({ tokenIdentifier: viewerId, subject: 'today-surface-viewer' })
  const request = await viewer.mutation(api.learnV2MeasurementReports.requestReport, { version: LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION,
    viewerGrantId, idempotencyKey: 'today_surface_report_1234567890', enrollmentStartAt: protocol.enrollmentStartAt,
    enrollmentEndAt: protocol.enrollmentEndAt, cutoff: Date.now() })
  if (request.status !== 'requested') throw new Error('Expected report request')
  await f.t.mutation(internal.learnV2MeasurementReports.pinReportOwners, { reportRunId: request.reportRunId })
  for (let batch = 0; batch < 16; batch++) {
    const run = (await f.t.run(ctx => ctx.db.get(request.reportRunId)))!
    if (run.status !== 'building' || reportControl(run).phase !== 'extracting') break
    await f.t.action(internal.learnV2MeasurementReports.buildReportBatch, { reportRunId: request.reportRunId })
  }
  const run = (await f.t.run(ctx => ctx.db.get(request.reportRunId)))!
  expect(reportControl(run).phase).toBe('computing')
  expect(run.codeVersion).toBe('learn-v2.report-code.c6.2.v9')
  const rows = await f.t.query(internal.learnV2MeasurementReports.readSourcePage, { reportRunId: request.reportRunId, after: 0 })
  const episodes = rows.map(row => row.snapshot).filter(row => row.kind === 'episode')
  expect(episodes).toHaveLength(2)
  for (const episode of episodes) expect(episode).toMatchObject({ assignment: { flow: 'v2_today', checkSurface: 'canvas', entryPoint: 'today' }, mixedFlow: false })
  const enrollment = await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_assignmentId', q =>
    q.eq('userId', userId).eq('fact.assignmentId', cold.assignmentId!)).first())
  expect(enrollment?.fact).toMatchObject({ kind: 'enrollment', snapshot: { flow: 'v2_today', checkSurface: 'canvas' } })
  expect(episodes.find(row => row.horizonDays === 7)).toMatchObject({ cold: { scorePercent: 100 }, delayed: { scorePercent: 100 } })
})

test('off-state parity uses a real Canvas-entered assignment through an ordinary Today lesson', async () => {
  policy.pointers = false
  const f = await fixture()
  expect(await f.owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, { studySessionId: f.graph.studySessionId,
    expectedSessionRevision: 2, idempotencyKey: 'real_canvas_enrollment_1234567890' })).toMatchObject({ kind: 'prepared' })
  const cold = (await f.opportunities())[0]!
  expect(await f.t.run(ctx => ctx.db.get(cold.assignmentId!))).toMatchObject({ entryPoint: 'canvas', flow: 'v2_canvas' })
  const later = await anotherTodayLesson(f)
  const content = (await f.t.run(ctx => ctx.db.query('sessionContent').withIndex('by_userId_and_studySessionId_and_revision', q =>
    q.eq('userId', userId).eq('studySessionId', later)).unique()))!
  const envelope = { _id: content._id, studySessionId: later, studyPlanRevisionId: content.studyPlanRevisionId,
    blueprintRevisionId: content.blueprintRevisionId, objectiveId: content.objectiveId, revision: content.revision, status: 'published',
    blocks: [], claims: [], supports: [] }
  expect(await f.owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: later })).toEqual({ ...envelope,
    assessment: { kind: 'blocked', reasonCode: 'flow_mismatch', state: null }, delivered: null, work: null })
  const opened = await attach(f, cold)
  const accepted = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
  if (accepted.kind !== 'accepted') throw new Error('Expected seal')
  const own = await f.owner.query(api.learnV2Responses.getResponseState, { version: LEARN_V2_PUBLIC_API_VERSION,
    target: { assessmentOpportunityId: cold._id } })
  if (own.status !== 'available') throw new Error('Expected canonical own work')
  expect(await f.owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: later })).toEqual({ ...envelope,
    assessment: { kind: 'teach', reasonCode: 'instruction_not_delivered', state: null },
    delivered: { version: LEARN_V2_PUBLIC_API_VERSION, status: 'unavailable', reasonCodes: ['flow_mismatch'] }, work: own.work })
  expect(await f.owner.query(api.learnV2Today.getToday, {})).not.toHaveProperty('checkPointers')
})

test('historical surface-binding labels remain readable through rollback without narrowing stored versions', async () => {
  const f = await fixture()
  await f.start()
  const cold = await coldFor(f)
  await f.t.run(async ctx => {
    const assignment = (await ctx.db.get(cold.assignmentId!))!
    if (!assignment.checkSurface || cold.contextPins.kind !== 'session' || !cold.contextPins.checkSurface) throw new Error('Expected surface binding')
    await ctx.db.patch(assignment._id, { checkSurface: { ...assignment.checkSurface, version: 'learn-v2.check-surface.v0' } })
    await ctx.db.patch(cold._id, { contextPins: { ...cold.contextPins, checkSurface: { ...cold.contextPins.checkSurface, version: 'learn-v2.check-surface.v0' } } })
  })
  policy.pointers = false
  expect(await f.read()).toEqual([expect.objectContaining({ reference: cold.delayedCheckId, state: 'ready' })])
  await attach(f, (await f.t.run(ctx => ctx.db.get(cold._id)))!)
})

test('an expired subscribed pointer continuation returns a typed restart', async () => {
  const f = await fixture()
  await f.start()
  for (let index = 1; index < 5; index++) {
    const next = await fixture({ test: f.t, fixtureKey: `restart-${index}` })
    await next.start()
  }
  const page = await f.owner.query(api.learnV2Today.getCheckPointers, {})
  expect(page.continueCursor).toBeTruthy()
  vi.setSystemTime(NOW + 3_600_001)
  expect(await f.owner.query(api.learnV2Today.getCheckPointers, { cursor: page.continueCursor! })).toEqual({
    status: 'restart_required', reasonCode: 'cursor_expired', checks: [], isDone: false, continueCursor: null,
  })
  expect(await f.owner.query(api.learnV2Today.getCheckPointers, {})).toMatchObject({ status: 'available', checks: expect.any(Array) })
})

test.each(['today', 'session_deep_link'] as const)('%s records its entry while the row delivers, seals, scores and reads on Canvas', async entryPoint => {
  const f = await fixture()
  expect(await f.read()).toEqual([])
  expect(await f.start(entryPoint)).toMatchObject({ status: 'assessment', deliveryGrant: null, assessment: { check: { state: 'ready' } } })
  const row = (await f.opportunities())[0]!
  const [pointer] = await f.read()
  expect(learnTodayCheckPointerSchema.parse(pointer)).toEqual(pointer)
  expect(pointer).toMatchObject({ reference: row.delayedCheckId, state: 'ready', destination: { kind: 'canvas',
    route: `/app/learn/void/${row.contextPins.kind === 'session' ? row.contextPins.canvas!.threadId : ''}?check=${encodeURIComponent(row.delayedCheckId)}` } })
  expect(await f.t.run(ctx => ctx.db.get(row.assignmentId!))).toMatchObject({ flow: 'v2_today', entryPoint, checkSurface: { surface: 'canvas', measurementFlow: 'v2_today' } })
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
  expect(enrollment?.fact).toMatchObject({ kind: 'enrollment', snapshot: { flow: 'v2_today', entryPoint } })
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
  expect(await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: check.stage.threadId })).toMatchObject({ status: 'submitted', assessment: { bodyAvailability: 'available' } })
  expect(await f.owner.query(internal.learnV2Mastery.getMasterySubmissionScoringState, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: saved.submissionId, idempotencyKey: 'delayed_pointer_recovery_1234567890' })).toMatchObject({ status: 'scoring_pending' })
  expect((await f.read()).find(row => row.reference === pointer.reference)).toEqual({ ...pointer, state: 'saved_scoring' })
  expect(await f.read()).toEqual(await f.read())
  vi.stubGlobal('fetch', vi.fn(async () => modelReply()))
  await f.owner.action(api.learnAdaptive.submitResponse, { threadId: check.stage.threadId, activityId: check.stage.activityId,
    submissionId: saved.submissionId, idempotencyKey: 'pointer_delayed_score_1234567890' })
  expect((await f.read()).find(row => row.reference === pointer.reference)).toEqual({ ...pointer, state: 'result_ready' })
})

test.each([1, 2])('saved scoring capacity after %s definitive failures agrees on Today and Canvas', async failures => {
  const f = await fixture()
  await f.start()
  const row = (await f.opportunities())[0]!
  const opened = await attach(f, row)
  const accepted = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
  if (accepted.kind !== 'accepted') throw new Error('Expected seal')
  const network = vi.fn(async () => new Response('Definitive synthetic failure', { status: 400 }))
  vi.stubGlobal('fetch', network)
  const score = () => f.owner.action(api.learnAdaptive.submitResponse, { threadId: opened.attached.threadId, activityId: opened.attached.activityId,
    submissionId: accepted.submissionId, idempotencyKey: 'pointer_scoring_capacity_1234567890' })
  for (let attempt = 0; attempt < failures; attempt++) await score()
  const current = (await f.t.run(ctx => ctx.db.get(row._id)))!
  const job = (await f.t.run(ctx => ctx.db.get(current.scoringJobId!)))!
  expect(job).toMatchObject({ attempts: failures, status: 'queued' })
  expect(current.phase).toBe('retryable_failure')
  const expected = failures === 2 ? 'closed' : 'saved_scoring'
  expect(await f.read()).toEqual([expect.objectContaining({ reference: row.delayedCheckId, state: expected })])
  const canvas = await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: opened.attached.threadId, checkReference: row.delayedCheckId })
  expect(canvas).toMatchObject({ status: expected === 'closed' ? 'blocked' : 'submitted', checkReceipt: {
    state: expected, submissionId: accepted.submissionId, body: { bodyAvailability: 'available' },
  } })
  expect(await f.owner.mutation(api.learnAdaptiveCanvas.getCanvasDelivery, { threadId: opened.attached.threadId, checkReference: row.delayedCheckId,
    idempotencyKey: 'capacity_delivery_1234567890' })).toEqual({ admission: { version: 'learn-v2.help-admission.v1', status: 'ordinary' }, value: canvas })
  expect(JSON.stringify(canvas)).not.toMatch(/Hypothetical|PRIVATE|scorePercent|feedbackCodes/)
  expect(await f.t.run(ctx => ctx.db.get(job._id))).toEqual(job)
  expect(network).toHaveBeenCalledTimes(failures)
  if (failures === 2) {
    await score()
    expect(network).toHaveBeenCalledTimes(2)
    expect(await f.t.run(ctx => ctx.db.get(row._id))).toMatchObject({ phase: 'invalid', reasonCode: 'scoring_attempt_limit' })
  } else {
    network.mockImplementation(async () => modelReply())
    await score()
    expect(network).toHaveBeenCalledTimes(2)
    expect(await f.read()).toEqual([expect.objectContaining({ state: 'result_ready' })])
  }
})

test('a final validated scoring execution awaiting commit remains recoverable after its lease expires', async () => {
  const f = await fixture()
  await f.start()
  const row = (await f.opportunities())[0]!
  const opened = await attach(f, row)
  const accepted = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
  if (accepted.kind !== 'accepted') throw new Error('Expected seal')
  const network = vi.fn(async () => new Response('Definitive synthetic failure', { status: 400 }))
  vi.stubGlobal('fetch', network)
  const score = () => f.owner.action(api.learnAdaptive.submitResponse, { threadId: opened.attached.threadId, activityId: opened.attached.activityId,
    submissionId: accepted.submissionId, idempotencyKey: 'validated_capacity_recovery_1234567890' })
  await score()
  const args = { tokenIdentifier: userId, submissionId: accepted.submissionId }
  const reservation = await f.owner.mutation(internal.learnV2Mastery.beginSealedMasteryScoring, args)
  if (reservation.kind !== 'acquired') throw new Error('Expected final dispatch reservation')
  const input = await f.owner.query(internal.learnV2Mastery.getSealedMasteryScoringInput, args)
  const { service, prepared } = await prepareSavedLearnModelScoring(input, { dispatchedAt: NOW, dispatchOrdinal: 2,
    leaseIdentityHash: await privacyDigest(reservation.leaseToken) })
  const executionId = await f.owner.mutation(internal.learnV2Mastery.registerSealedMasteryScoring, { ...args, receiptJson: JSON.stringify(prepared.receipt) })
  expect(await f.t.run(ctx => ctx.db.get(input.job._id))).toMatchObject({ attempts: 2, status: 'running' })
  expect(await f.read()).toEqual([expect.objectContaining({ state: 'saved_scoring' })])
  network.mockImplementation(async () => modelReply())
  const result = await service.dispatch(prepared)
  expect(await f.owner.mutation(internal.learnV2Mastery.recordMasteryScoringReceipt, { tokenIdentifier: userId, executionId,
    resultJson: JSON.stringify(result) })).toBe(true)
  expect(await f.t.run(ctx => ctx.db.get(executionId))).toMatchObject({ outcome: 'validated' })
  vi.setSystemTime(NOW + ADAPTIVE_V2_PILOT_MANIFEST.limits.leaseMs + 1)
  expect(await f.read()).toEqual([expect.objectContaining({ state: 'saved_scoring' })])
  expect(await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: opened.attached.threadId, checkReference: row.delayedCheckId }))
    .toMatchObject({ checkReceipt: { state: 'saved_scoring' } })
  expect(network).toHaveBeenCalledTimes(2)
  await score()
  expect(network).toHaveBeenCalledTimes(2)
  expect(await f.read()).toEqual([expect.objectContaining({ state: 'result_ready' })])
  expect(await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: opened.attached.threadId, checkReference: row.delayedCheckId }))
    .toMatchObject({ checkReceipt: { state: 'result_ready' } })
})

const recoveryChanges = ['none', 'claim_loss', 'source_purge', 'claim_revoked', 'assignment_revoked', 'validity_revoked', 'response_excluded', 'retryable_failure',
  'reconciliation_required', 'invalid', 'cancelled', 'abandoned', 'missing_result', 'entitlement', 'pilot'] as const

test.each(([false, true] as const).flatMap(scored => recoveryChanges.map(change => ({ scored, change }))))(
  'saved recovery policy: scored=$scored change=$change', async ({ scored, change }) => {
    const f = await fixture()
    await f.start()
    const row = (await f.opportunities())[0]!
    const opened = await attach(f, row)
    const accepted = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
    if (accepted.kind !== 'accepted') throw new Error('Expected seal')
    if (scored) {
      vi.stubGlobal('fetch', vi.fn(async () => modelReply()))
      await f.owner.action(api.learnAdaptive.submitResponse, { threadId: opened.attached.threadId, activityId: opened.attached.activityId,
        submissionId: accepted.submissionId, idempotencyKey: 'recovery_matrix_score_1234567890' })
    }
    await f.t.run(async ctx => {
      if (change === 'source_purge') await ctx.db.patch(f.graph.sourceSnapshotId, { evidencePurgedAt: NOW })
      if (change === 'claim_loss' || change === 'claim_revoked') {
        if (row.assessmentPins.kind !== 'measurement') throw new Error('Expected measurement pins')
        const itemId = row.assessmentPins.itemPins.itemId
        const claim = (await ctx.db.query('learnMeasurementClaims').withIndex('by_userId_and_itemId_and_order', q => q.eq('userId', userId).eq('itemId', itemId)).first())!
        await ctx.db.patch(claim._id, change === 'claim_loss' ? { evidenceStatus: 'evidence_unavailable' } : { invalidatedAt: NOW })
      }
      if (change === 'assignment_revoked') await ctx.db.patch(row.assignmentId!, { invalidatedAt: NOW })
      if (change === 'validity_revoked') {
        const response = (await ctx.db.get(accepted.submissionId))!
        await ctx.db.patch(accepted.submissionId, { validitySnapshot: { ...response.validitySnapshot, status: 'excluded', measurementEligible: false, masteryEligible: false, exclusionReasons: ['evidence_unavailable'] } })
      }
      if (change === 'response_excluded') await ctx.db.patch(accepted.submissionId, { currentEligibility: 'excluded' })
      if (['retryable_failure', 'reconciliation_required', 'invalid', 'cancelled', 'abandoned'].some(phase => phase === change)) {
        await ctx.db.patch(row._id, { phase: change as 'retryable_failure' | 'reconciliation_required' | 'invalid' | 'cancelled' | 'abandoned' })
      }
      if (change === 'missing_result') await ctx.db.patch(row._id, { phase: 'scored_pass', authoritativeAttemptId: undefined })
      if (change === 'entitlement') {
        const user = (await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique())!
        await ctx.db.patch(user._id, { learnAdaptiveExperienceEntitlement: { enabled: false, updatedAt: NOW } })
      }
    })
    if (change === 'pilot') Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { pilotApproved: false })
    const closed = ['claim_loss', 'source_purge', 'claim_revoked', 'assignment_revoked', 'validity_revoked', 'response_excluded', 'invalid', 'cancelled', 'abandoned', 'entitlement'].includes(change)
      || change === 'pilot' && !scored
    const expected = closed ? 'closed' : ['missing_result', 'reconciliation_required'].includes(change) || change === 'pilot'
      ? 'result_unconfirmed' : scored ? 'result_ready' : 'saved_scoring'
    const pointers = await f.read()
    expect(pointers).toEqual([expect.objectContaining({ reference: row.delayedCheckId, state: expected })])
    const canvas = await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: opened.attached.threadId })
    expect(learnCanvasCheckReceiptSchema.parse(canvas?.checkReceipt)).toEqual(canvas?.checkReceipt)
    expect(canvas).toMatchObject({ status: expected === 'closed' ? 'blocked' : expected === 'result_unconfirmed' ? 'reconciling'
      : expected === 'result_ready' ? 'feedback' : 'submitted', checkReceipt: {
      version: 'learn-v2.canvas-check-receipt.v1', reference: row.delayedCheckId, state: expected, submissionId: accepted.submissionId,
    }, responsePrompt: null, declaredStimulus: null, responseSpec: null, activity: { primitive: null, evidenceScope: { sourceRefs: [] } } })
    expect(await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: opened.attached.threadId, checkReference: row.delayedCheckId })).toEqual(canvas)
    if (change === 'entitlement') {
      await expect(f.owner.query(api.learnV2Responses.getResponseState, { version: LEARN_V2_PUBLIC_API_VERSION,
        target: { assessmentOpportunityId: row._id } })).rejects.toThrow('Learn access denied')
      expect(canvas!.checkReceipt!.body.bodyAvailability).toBe('unavailable')
    } else {
      const canonical = await f.owner.query(api.learnV2Responses.getResponseState, { version: LEARN_V2_PUBLIC_API_VERSION,
        target: { assessmentOpportunityId: row._id } })
      if (canonical.status !== 'available' || !canonical.work) throw new Error('Expected accepted response')
      expect(canonical.state).toBe('accepted')
      expect(canvas!.checkReceipt!.body).toEqual(canonical.work.body)
    }
    expect(JSON.stringify(pointers)).not.toMatch(/Hypothetical|PRIVATE|A saved learner answer|scorePercent|feedbackCodes|scored_pass|scored_fail/)
    expect(JSON.stringify(canvas)).not.toMatch(/Hypothetical|PRIVATE|criterionResults/)
    if (expected === 'result_ready') {
      const read = await f.owner.query(internal.learnV2Mastery.getMasterySubmissionScoringState, { version: LEARN_V2_PUBLIC_API_VERSION,
        submissionId: accepted.submissionId, idempotencyKey: 'matrix_result_read_1234567890' })
      if (read.status !== 'scored' || canvas?.checkReceipt?.state !== 'result_ready') throw new Error('Expected authoritative result')
      expect(canvas.checkReceipt.result).toEqual(read.result)
    } else expect(JSON.stringify(canvas)).not.toMatch(/scorePercent|feedbackCodes/)
    if (expected === 'closed' || expected === 'result_unconfirmed') expect(JSON.stringify(canvas)).not.toMatch(/scored_pass|scored_fail|authoritativeAttemptId/)
    if (expected === 'closed' || expected === 'result_unconfirmed') {
      expect(await f.owner.mutation(api.learnAdaptiveCanvas.getCanvasDelivery, { threadId: opened.attached.threadId, checkReference: row.delayedCheckId, idempotencyKey: 'receipt_delivery_matrix_1234567890' }))
        .toEqual({ admission: { version: 'learn-v2.help-admission.v1', status: 'ordinary' }, value: canvas })
    }
  })

test.each([false, true])('owned saved work keeps its addressed receipt after routing changes, scored=%s', async scored => {
  const f = await fixture()
  await f.start()
  const row = (await f.opportunities())[0]!
  const opened = await attach(f, row)
  const accepted = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
  if (accepted.kind !== 'accepted') throw new Error('Expected seal')
  if (scored) {
    vi.stubGlobal('fetch', vi.fn(async () => modelReply()))
    await f.owner.action(api.learnAdaptive.submitResponse, { threadId: opened.attached.threadId, activityId: opened.attached.activityId,
      submissionId: accepted.submissionId, idempotencyKey: 'routing_recovery_score_1234567890' })
  }
  await f.t.run(ctx => ctx.db.patch(opened.attached.threadId, { currentActivityId: undefined, revision: opened.canvas.thread.revision + 1 }))
  const expected = scored ? 'result_unconfirmed' : 'closed'
  const [pointer] = await f.read()
  expect(pointer).toMatchObject({ reference: row.delayedCheckId, state: expected })
  const route = new URL(pointer!.destination.route, 'https://example.test')
  expect(route.searchParams.get('check')).toBe(row.delayedCheckId)
  const canvas = await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: pointer!.destination.threadId, checkReference: route.searchParams.get('check')! })
  expect(canvas?.checkReceipt).toMatchObject({ state: expected, submissionId: accepted.submissionId })
  expect(JSON.stringify(canvas)).not.toMatch(/Hypothetical|PRIVATE|scorePercent|feedbackCodes|scored_pass|scored_fail/)
})

test.each(([false, true] as const).flatMap(scored => (['deleted', 'deleting', 'foreign'] as const).map(change => ({ scored, change }))))(
  'saved work has no destination after thread $change, scored=$scored', async ({ scored, change }) => {
    const f = await fixture()
    await f.start()
    const row = (await f.opportunities())[0]!
    const opened = await attach(f, row)
    const accepted = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
    if (accepted.kind !== 'accepted') throw new Error('Expected seal')
    if (scored) {
      vi.stubGlobal('fetch', vi.fn(async () => modelReply()))
      await f.owner.action(api.learnAdaptive.submitResponse, { threadId: opened.attached.threadId, activityId: opened.attached.activityId,
        submissionId: accepted.submissionId, idempotencyKey: 'deleted_recovery_score_1234567890' })
    }
    await f.t.run(async ctx => {
      if (change === 'deleted') await ctx.db.delete(opened.attached.threadId)
      else await ctx.db.patch(opened.attached.threadId, change === 'deleting' ? { deletionStartedAt: NOW } : { userId: 'different-owner' })
    })
    expect(await f.read()).toEqual([])
    expect(await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: opened.attached.threadId, checkReference: row.delayedCheckId })).toBeNull()
  })

test('a check reference cannot address another owned Canvas', async () => {
  const f = await fixture()
  await f.start()
  const row = (await f.opportunities())[0]!
  const opened = await attach(f, row)
  await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
  const other = await fixture({ test: f.t, fixtureKey: 'other-receipt' })
  await other.start()
  const next = await coldFor(other)
  expect(await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: opened.attached.threadId, checkReference: next.delayedCheckId })).toBeNull()
})

test.each(['invalid', 'cancelled', 'abandoned'] as const)('an unanswered %s check still has no row', async phase => {
  const f = await fixture()
  await f.start()
  const row = (await f.opportunities())[0]!
  await f.t.run(ctx => ctx.db.patch(row._id, { phase }))
  expect(await f.read()).toEqual([])
})

test('terminal discovery is recent while direct owned receipt recovery has no expiry', async () => {
  const f = await fixture()
  await f.start()
  const row = (await f.opportunities())[0]!
  const opened = await attach(f, row)
  await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
  await f.t.run(ctx => ctx.db.patch(row._id, { phase: 'invalid' }))
  expect(await f.read()).toEqual([expect.objectContaining({ state: 'closed' })])
  vi.setSystemTime(NOW + 91 * 86_400_000)
  expect(await f.read()).toEqual([])
  expect(await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: opened.attached.threadId, checkReference: row.delayedCheckId }))
    .toMatchObject({ checkReceipt: { state: 'closed' } })
  await f.t.run(ctx => ctx.db.patch(row._id, { phase: 'submitted_sealed' }))
  expect(await f.read()).toEqual([expect.objectContaining({ state: 'closed' })])
})

test.each([false, true])('historical saved Canvas labels remain discoverable beyond terminal recency, scored=%s', async scored => {
  const f = await fixture()
  await f.start()
  const row = (await f.opportunities())[0]!
  const opened = await attach(f, row)
  const accepted = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
  if (accepted.kind !== 'accepted') throw new Error('Expected seal')
  if (scored) {
    vi.stubGlobal('fetch', vi.fn(async () => modelReply()))
    await f.owner.action(api.learnAdaptive.submitResponse, { threadId: opened.attached.threadId, activityId: opened.attached.activityId,
      submissionId: accepted.submissionId, idempotencyKey: 'historical_recovery_score_1234567890' })
  }
  await f.t.run(async ctx => {
    const current = (await ctx.db.get(row._id))!
    if (current.contextPins.kind !== 'session' || !current.contextPins.canvas) throw new Error('Expected Canvas pins')
    await ctx.db.patch(row._id, { contextPins: { ...current.contextPins, canvas: { ...current.contextPins.canvas, planVersion: 'historical-plan' } } })
    const response = (await ctx.db.get(accepted.submissionId))!
    if (response.scopeKind !== 'v2' || response.contextPins.kind !== 'session' || !response.contextPins.canvas) throw new Error('Expected saved Canvas pins')
    await ctx.db.patch(accepted.submissionId, { contextPins: { ...response.contextPins, canvas: { ...response.contextPins.canvas, planVersion: 'historical-plan' } } })
  })
  vi.setSystemTime(NOW + 91 * 86_400_000)
  const expected = scored ? 'result_unconfirmed' : 'closed'
  expect(await f.read()).toEqual([expect.objectContaining({ reference: row.delayedCheckId, state: expected })])
  expect(await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: opened.attached.threadId, checkReference: row.delayedCheckId }))
    .toMatchObject({ checkReceipt: { state: expected } })
})

test('a lost scoring response keeps a readable unconfirmed receipt without redispatch', async () => {
  const f = await fixture()
  await f.start()
  const row = (await f.opportunities())[0]!
  const opened = await attach(f, row)
  const accepted = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
  if (accepted.kind !== 'accepted') throw new Error('Expected seal')
  const network = vi.fn(async () => { throw new TypeError('lost provider receipt') })
  vi.stubGlobal('fetch', network)
  const request = { threadId: opened.attached.threadId, activityId: opened.attached.activityId,
    submissionId: accepted.submissionId, idempotencyKey: 'recovery_lost_score_1234567890' }
  expect(await f.owner.action(api.learnAdaptive.submitResponse, request)).toMatchObject({ kind: 'blocked', code: 'reconciliation_required', retryable: false })
  expect(await f.owner.action(api.learnAdaptive.submitResponse, request)).toMatchObject({ kind: 'blocked', code: 'reconciliation_required', retryable: false })
  expect(network).toHaveBeenCalledTimes(1)
  expect(await f.read()).toEqual([expect.objectContaining({ state: 'result_unconfirmed' })])
  const canvas = await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: opened.attached.threadId, checkReference: row.delayedCheckId })
  expect(canvas?.checkReceipt).toMatchObject({ state: 'result_unconfirmed', submissionId: accepted.submissionId,
    body: { bodyAvailability: 'available', payload: { kind: 'text', text: opened.stage.response } } })
  expect(JSON.stringify(canvas)).not.toMatch(/Hypothetical|PRIVATE|scorePercent|feedbackCodes|scored_pass|scored_fail/)
})

test('saved receipt reads propagate resource exhaustion instead of relabelling it', async () => {
  const f = await fixture({ inventory: { claims: 32, supports: 2, sources: 64, backingDocuments: true } })
  await f.start()
  const row = (await f.opportunities())[0]!
  const opened = await attach(f, row)
  await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
  const original = privacyContext.createResponsePrivacyReadContext
  vi.spyOn(privacyContext, 'createResponsePrivacyReadContext').mockImplementation((ctx, owner, _limit, options) => original(ctx, owner, 64, options))
  await expect(f.owner.query(api.learnV2Today.getCheckPointers, {})).rejects.toThrow('Learn source validation budget exhausted')
  await expect(f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: opened.attached.threadId, checkReference: row.delayedCheckId }))
    .rejects.toThrow('Learn source validation budget exhausted')
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
    const closed = ['invalid', 'cancelled', 'abandoned'].includes(phase)
    const expected = closed ? 'closed' : ['reconciliation_required', 'scored_pass', 'scored_fail'].includes(phase) ? 'result_unconfirmed' : 'saved_scoring'
    const pointers = await f.read()
    expect(pointers).toEqual([expect.objectContaining({ state: expected })])
    const canvas = await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: opened.attached.threadId })
    expect(canvas?.status ?? 'blocked').toBe(closed ? 'blocked' : expected === 'result_unconfirmed' ? 'reconciling' : phase === 'scoring_pending' ? 'scoring' : 'submitted')
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
  expect(assignment).toMatchObject({ status: 'not_admitted', flow: 'v2_today', entryPoint: 'today', exclusionReasons: ['canvas_not_admitted', 'not_admitted'] })
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

test.each(['entitlement', 'pilot', 'thread', 'void'] as const)('refresh never invents a destination after %s revocation', async revoked => {
  const f = await fixture()
  await f.start()
  const row = (await f.opportunities())[0]!
  expect(await f.read()).toHaveLength(1)
  await f.t.run(async ctx => {
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

test.each(([false, true] as const).flatMap(opened =>
  (['source_purge', 'source_rights', 'document_access', 'claim_loss', 'support_loss', 'excerpt_loss'] as const).map(loss => ({ opened, loss }))))(
  '$loss removes an unplayable ready pointer, already opened=$opened', async ({ opened, loss }) => {
  const f = await fixture({ inventory: { claims: 3, supports: 1, sources: 2, backingDocuments: true } })
  await f.start()
  const row = (await f.opportunities())[0]!
  if (opened) await attach(f, row)
  const pointers = await f.read()
  expect(pointers).toEqual([expect.objectContaining({ state: 'ready' })])
  await f.t.run(async ctx => {
    if (loss === 'source_purge') await ctx.db.patch(f.graph.sourceSnapshotId, { evidencePurgedAt: NOW })
    if (loss === 'source_rights') await ctx.db.patch(f.graph.sourceSnapshotId, { rightsStatus: 'prohibited' })
    if (loss === 'document_access') {
      const identity = (await ctx.db.get(f.graph.sourceIdentityId))!
      const document = (await ctx.db.get(identity.folderDocumentId!))!
      await ctx.db.patch(document.folderId, { userId: 'foreign-owner' })
    }
    if (loss === 'excerpt_loss') await ctx.db.patch(f.graph.sourceExcerptId, { excerpt: undefined })
    if (row.assessmentPins.kind !== 'measurement') throw new Error('Expected measurement pins')
    const itemId = row.assessmentPins.itemPins.itemId
    if (loss === 'claim_loss') {
      const claim = (await ctx.db.query('learnMeasurementClaims').withIndex('by_userId_and_itemId_and_order', q => q.eq('userId', userId).eq('itemId', itemId)).first())!
      await ctx.db.patch(claim._id, { evidenceStatus: 'evidence_unavailable' })
    }
    if (loss === 'support_loss') {
      const support = (await ctx.db.query('learnMeasurementSupports').withIndex('by_userId_and_itemId', q => q.eq('userId', userId).eq('itemId', itemId)).first())!
      await ctx.db.patch(support._id, { evidenceStatus: 'evidence_unavailable' })
    }
  })
  expect(await f.read()).toEqual([])
  expect(await f.owner.query(api.learnV2Today.getCheckPointers, {})).toMatchObject({ status: 'available', checks: [] })
  const session = (await f.t.run(ctx => ctx.db.get(f.graph.studySessionId)))!
  expect(await f.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: f.graph.studySessionId,
    expectedSessionRevision: session.revision, idempotencyKey: 'revoked_pointer_attach_1234567890' })).toMatchObject({ kind: 'not_admitted' })
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(3))).toHaveLength(opened ? 1 : 0)
  expect((await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: pointers[0]!.destination.threadId }))?.responsePrompt ?? null).toBeNull()
})

test('pointer readers propagate an exhausted shared read budget', async () => {
  const f = await fixture()
  await f.start()
  const original = privacyContext.createResponsePrivacyReadContext
  vi.spyOn(privacyContext, 'createResponsePrivacyReadContext').mockImplementation((ctx, owner, _limit, options) => original(ctx, owner, 1, options))
  await expect(f.owner.query(api.learnV2Today.getCheckPointers, {})).rejects.toThrow('Learn source validation budget exhausted')
  await expect(f.owner.query(api.learnV2Today.getToday, {})).rejects.toThrow('Learn source validation budget exhausted')
})

test('ready-pointer validation propagates exhaustion inside its full authority check', async () => {
  const f = await fixture({ inventory: { claims: 32, supports: 2, sources: 64, backingDocuments: true } })
  await f.start()
  const original = privacyContext.createResponsePrivacyReadContext
  vi.spyOn(privacyContext, 'createResponsePrivacyReadContext').mockImplementation((ctx, owner, _limit, options) => original(ctx, owner, 64, options))
  await expect(f.owner.query(api.learnV2Today.getCheckPointers, {})).rejects.toThrow('Learn source validation budget exhausted')
})

test('Today defers pointer discovery before its remaining budget is insufficient', async () => {
  const f = await fixture()
  await f.start()
  const original = privacyContext.createResponsePrivacyReadContext
  const budget = vi.spyOn(privacyContext, 'createResponsePrivacyReadContext').mockImplementation((ctx, owner, _limit, options) => original(ctx, owner, 70, options))
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', sessionId: f.graph.studySessionId, checkPointers: {
    status: 'unavailable', reasonCode: 'pointer_page_budget', checks: [], isDone: false, continueCursor: null,
  } })
  budget.mockRestore()
  expect(await f.owner.query(api.learnV2Today.getCheckPointers, {})).toMatchObject({ status: 'available', checks: [expect.objectContaining({ state: 'ready' })] })
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

test('a playable six-form family fits the ready-pointer reservation with native limits', async () => {
  const f = await fixture({ reserveCount: 3, inventory: { claims: 32, supports: 2, sources: 64, backingDocuments: true } })
  await f.start()
  const original = privacyContext.createResponsePrivacyReadContext
  const budget = vi.spyOn(privacyContext, 'createResponsePrivacyReadContext').mockImplementation((ctx, owner, _limit, options) => original(ctx, owner, 896, options))
  expect(await f.owner.query(api.learnV2Today.getCheckPointers, {})).toMatchObject({ status: 'available', checks: [expect.objectContaining({ state: 'ready' })] })
  budget.mockRestore()
  await attach(f, (await f.opportunities())[0]!)
}, 20_000)

test('bounded discovery pages retain an older check after more than 32 later records', async () => {
  const f = await fixture()
  await f.start()
  await f.t.run(async ctx => {
    const row = (await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_phase', q => q.eq('userId', userId).eq('phase', 'ready')).first())!
    const { _id, _creationTime, ...fields } = row
    for (let index = 0; index < 32; index++) await ctx.db.insert('learnAssessmentOpportunities', { ...fields, delayedCheckId: `overflow-${index}` })
  })
  const first = await f.owner.query(api.learnV2Today.getCheckPointers, {})
  expect(first).toMatchObject({ status: 'available', isDone: false })
  let page = first
  let pages = 1
  const checks = [...first.checks]
  while (!page.isDone) {
    const cursor = page.continueCursor!
    page = await f.owner.query(api.learnV2Today.getCheckPointers, { cursor })
    expect(await f.owner.query(api.learnV2Today.getCheckPointers, { cursor })).toEqual(page)
    checks.push(...page.checks)
    expect(++pages).toBeLessThan(40)
  }
  expect(pages).toBeGreaterThan(1)
  expect(checks).toEqual([expect.objectContaining({ state: 'ready' })])
})

test('an ungranted expired check has no pointer to a blocked Canvas or a new grant', async () => {
  const f = await fixture()
  await f.start()
  const row = (await f.opportunities())[0]!
  vi.setSystemTime(row.closeAt)
  expect(await f.read()).toEqual([])
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(4))).toEqual([])
})

test('measurement read caches revalidate authority after writes', async () => {
  const f = await fixture()
  await f.start()
  const row = (await f.opportunities())[0]!
  await f.owner.mutation(async raw => {
    const ctx = measurementReadContext(raw, userId)
    const read = () => readCanvasCheckPointerForOwner(ctx, userId, row)
    expect(await read()).toMatchObject({ state: 'ready' })
    await ctx.db.patch(f.graph.sourceSnapshotId, { evidencePurgedAt: NOW })
    expect(await read()).toBeNull()
    await ctx.db.patch(f.graph.sourceSnapshotId, { evidencePurgedAt: undefined })
    expect(await read()).toMatchObject({ state: 'ready' })
    if (row.assessmentPins.kind !== 'measurement') throw new Error('Expected measurement pins')
    const itemId = row.assessmentPins.itemPins.itemId
    const claim = (await ctx.db.query('learnMeasurementClaims').withIndex('by_userId_and_itemId_and_order', q => q.eq('userId', userId).eq('itemId', itemId)).first())!
    await ctx.db.patch(claim._id, { evidenceStatus: 'evidence_unavailable' })
    expect(await read()).toBeNull()
    await ctx.db.patch(claim._id, { evidenceStatus: 'available' })
    expect(await read()).toMatchObject({ state: 'ready' })
    const user = (await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique())!
    await ctx.db.patch(user._id, { learnAdaptiveExperienceEntitlement: { enabled: false, updatedAt: NOW } })
    expect(await read()).toBeNull()
  })
})

test('saved-work read caches invalidate after body and source revocation', async () => {
  const f = await fixture()
  await f.start()
  const row = (await f.opportunities())[0]!
  const opened = await attach(f, row)
  const saved = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
  if (saved.kind !== 'accepted') throw new Error('Expected seal')
  await f.owner.mutation(async raw => {
    const ctx = measurementReadContext(raw, userId)
    const read = async () => readCanvasCheckPointerForOwner(ctx, userId, (await ctx.db.get(row._id))!)
    expect(await read()).toMatchObject({ state: 'saved_scoring' })
    await ctx.db.patch(f.graph.sourceSnapshotId, { evidencePurgedAt: NOW })
    expect(await read()).toMatchObject({ state: 'closed' })
    await ctx.db.patch(f.graph.sourceSnapshotId, { evidencePurgedAt: undefined })
    expect(await read()).toMatchObject({ state: 'saved_scoring' })
    await ctx.db.patch(saved.submissionId, { bodyAvailability: 'purged', bodyPurgedAt: NOW })
    expect(await read()).toMatchObject({ state: 'closed' })
  })
})

test.each(['saved_scoring', 'result_ready'] as const)('$state recovers under completed-work bounds after publication limits tighten', async state => {
  const f = await fixture({ inventory: { claims: 32, supports: 2, sources: 64, backingDocuments: true } })
  await f.start()
  const row = (await f.opportunities())[0]!
  const opened = await attach(f, row)
  const saved = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
  if (saved.kind !== 'accepted') throw new Error('Expected seal')
  if (state === 'result_ready') {
    vi.stubGlobal('fetch', vi.fn(async () => modelReply()))
    await f.owner.action(api.learnAdaptive.submitResponse, { threadId: opened.attached.threadId, activityId: opened.attached.activityId,
      submissionId: saved.submissionId, idempotencyKey: 'historical_pointer_score_1234567890' })
  }
  const before = await f.t.run(ctx => ctx.db.get(saved.submissionId))
  policy.evidenceRows = 1
  expect(await f.read()).toEqual([expect.objectContaining({ state })])
  expect(await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: opened.attached.threadId })).toMatchObject({
    status: state === 'result_ready' ? 'feedback' : 'submitted', savedResponse: { response: opened.stage.response },
  })
  expect(await f.t.run(ctx => ctx.db.get(saved.submissionId))).toEqual(before)
})

test.each([false, true])('anonymous Canvas reads retain the existing denial shape, capability=%s', async enabled => {
  const f = await fixture()
  await f.start()
  const row = (await f.opportunities())[0]!
  if (row.contextPins.kind !== 'session' || !row.contextPins.canvas) throw new Error('Expected Canvas pins')
  policy.pointers = enabled
  await expect(f.t.query(api.learnAdaptiveCanvas.getCanvas, { threadId: row.contextPins.canvas.threadId }))
    .rejects.toThrow('Adaptive Learn access denied')
  await expect(f.t.mutation(api.learnAdaptiveCanvas.getCanvasDelivery, { threadId: row.contextPins.canvas.threadId,
    idempotencyKey: 'anonymous_canvas_delivery_1234567890' })).rejects.toThrow('Adaptive Learn access denied')
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

test.each([6, 12])('%s maximum-sized families return bounded pointer pages without exhausting Today', async count => {
  const families: Awaited<ReturnType<typeof fixture>>[] = []
  for (let index = 0; index < count; index++) {
    const f = await fixture({ test: families[0]?.t, fixtureKey: `volume-${index}`, inventory: { claims: 32, supports: 2, sources: 64 } })
    await f.start()
    families.push(f)
  }
  const f = families[0]!
  await f.t.mutation(due, { userId, through: NOW })
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q => q.eq('userId', userId)).take(count * 3 + 1))).toHaveLength(count * 3)
  const today = await f.owner.query(api.learnV2Today.getToday, {})
  expect('checkPointers' in today && today.checkPointers.status).toBe('available')
  expect('checkPointers' in today && today.checkPointers.checks).toHaveLength(4)
  const references: string[] = []
  let cursor: string | undefined
  let pages = 0
  do {
    const page = await f.owner.query(api.learnV2Today.getCheckPointers, { cursor })
    expect(page.status).toBe('available')
    references.push(...page.checks.map(check => check.reference))
    pages++
    cursor = page.continueCursor ?? undefined
    if (page.isDone) break
    expect(cursor).toBeTruthy()
    expect(pages).toBeLessThan(count * 3)
  } while (cursor)
  expect(pages).toBe(Math.ceil(count / 4))
  expect(references).toHaveLength(count)
  expect(new Set(references).size).toBe(count)
}, 60_000)

test('overflow continues across saved, ready and both scored phases without exposing their phases', async () => {
  const families: Awaited<ReturnType<typeof fixture>>[] = []
  const references: string[] = []
  for (const [index, state] of ['ready', 'scored_pass', 'invalid', 'result_unconfirmed', 'scored_fail', 'ready', 'cancelled'].entries()) {
    const f = await fixture({ test: families[0]?.t, fixtureKey: `overflow-state-${index}` })
    await f.start()
    const row = await coldFor(f)
    references.push(row.delayedCheckId)
    if (state !== 'ready') {
      const opened = await attach(f, row)
      const saved = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
      if (saved.kind !== 'accepted') throw new Error('Expected seal')
      if (state === 'result_unconfirmed') await f.t.run(ctx => ctx.db.patch(row._id, { phase: 'reconciliation_required' }))
      if (state === 'invalid' || state === 'cancelled') await f.t.run(ctx => ctx.db.patch(row._id, { phase: state }))
      if (state.startsWith('scored_')) {
        vi.stubGlobal('fetch', vi.fn(async () => modelReply(state === 'scored_pass')))
        await f.owner.action(api.learnAdaptive.submitResponse, { threadId: opened.attached.threadId, activityId: opened.attached.activityId,
          submissionId: saved.submissionId, idempotencyKey: 'overflow_pointer_score_1234567890' })
        expect(await f.t.run(ctx => ctx.db.get(row._id))).toMatchObject({ phase: state })
      }
    }
    families.push(f)
  }
  const f = families[0]!
  const today = await f.owner.query(api.learnV2Today.getToday, {})
  if (!('checkPointers' in today)) throw new Error('Expected pointer projection')
  expect(today.checkPointers).toMatchObject({ status: 'available', isDone: false, checks: expect.any(Array) })
  expect(today.checkPointers.checks).toHaveLength(4)
  expect(today.checkPointers.continueCursor).toBeTruthy()
  vi.setSystemTime(NOW + 1_000)
  const next = await f.owner.query(api.learnV2Today.getCheckPointers, { cursor: today.checkPointers.continueCursor! })
  expect(next).toMatchObject({ status: 'available', isDone: true, continueCursor: null })
  expect(next.checks).toHaveLength(3)
  expect(await f.owner.query(api.learnV2Today.getCheckPointers, { cursor: today.checkPointers.continueCursor! })).toEqual(next)
  expect([...today.checkPointers.checks, ...next.checks].map(pointer => pointer.reference).sort()).toEqual(references.sort())
  expect(JSON.stringify([today.checkPointers, next])).not.toMatch(/scored_pass|scored_fail|criterionResults|scorePercent|feedbackCodes/)
})

test('expired unanswered candidates do not displace the first-page check before cleanup runs', async () => {
  const f = await fixture()
  await f.start()
  const row = (await f.opportunities())[0]!
  await f.t.run(async ctx => {
    const { _id: _id, _creationTime: _creationTime, ...fields } = row
    const assignment = (await ctx.db.get(row.assignmentId!))!
    const { _id: _assignmentId, _creationTime: _assignmentTime, ...assignmentFields } = assignment
    for (let index = 0; index < 24; index++) {
      const assignmentId = await ctx.db.insert('learnMeasurementAssignments', { ...assignmentFields, assignmentKey: `expired-assignment-${index}` })
      await ctx.db.insert('learnAssessmentOpportunities', { ...fields, assignmentId,
        purpose: { kind: 'measurement_cold', assignmentId, protocolVersion: syntheticDeliveryProtocol().version },
        delayedCheckId: `expired-${index}`, closeAt: NOW - 1 })
    }
  })
  const today = await f.owner.query(api.learnV2Today.getToday, {})
  expect('checkPointers' in today && today.checkPointers).toEqual({ status: 'available', reasonCode: null,
    checks: [expect.objectContaining({ reference: row.delayedCheckId, state: 'ready' })], isDone: true, continueCursor: null })
})

test.each([1, 2, 4])('%s maximum checks appear together on the first Today page', async count => {
  const families: Awaited<ReturnType<typeof fixture>>[] = []
  for (let index = 0; index < count; index++) {
    const f = await fixture({ test: families[0]?.t, fixtureKey: `first-${index}`, reserveCount: 3,
      inventory: { claims: 32, supports: 2, sources: 64, backingDocuments: true } })
    await f.start()
    families.push(f)
  }
  const f = families[0]!
  await f.t.mutation(due, { userId, through: NOW })
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q => q.eq('userId', userId)).take(count * 3 + 1))).toHaveLength(count * 3)
  const result = await f.owner.query(async ctx => ({ today: await ctx.runQuery(api.learnV2Today.getToday, {}), metrics: await ctx.meta.getTransactionMetrics() }))
  console.info('today-pointer-read-budget', JSON.stringify({ checks: count, queries: result.metrics.databaseQueries.used,
    documents: result.metrics.documentsRead.used, bytes: result.metrics.bytesRead.used }))
  expect('checkPointers' in result.today && result.today.checkPointers).toMatchObject({ status: 'available', isDone: true, continueCursor: null })
  expect('checkPointers' in result.today && result.today.checkPointers.checks).toHaveLength(count)
  expect(result.metrics.databaseQueries.used).toBeLessThan(3072)
}, 60_000)

test('four maximum mixed-state checks appear on the first Today page', async () => {
  const families: Awaited<ReturnType<typeof fixture>>[] = []
  for (const [index, state] of (['ready', 'saved_scoring', 'result_unconfirmed', 'result_ready'] as const).entries()) {
    const f = await fixture({ test: families[0]?.t, fixtureKey: `mixed-${index}`, reserveCount: 3,
      inventory: { claims: 32, supports: 2, sources: 64, backingDocuments: true } })
    await f.start()
    if (state !== 'ready') {
      const row = await coldFor(f)
      const opened = await attach(f, row)
      const saved = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
      if (saved.kind !== 'accepted') throw new Error('Expected seal')
      if (state === 'result_unconfirmed') await f.t.run(ctx => ctx.db.patch(row._id, { phase: 'reconciliation_required' }))
      if (state === 'result_ready') {
        vi.stubGlobal('fetch', vi.fn(async () => modelReply()))
        await f.owner.action(api.learnAdaptive.submitResponse, { threadId: opened.attached.threadId, activityId: opened.attached.activityId,
          submissionId: saved.submissionId, idempotencyKey: 'mixed_pointer_score_1234567890' })
      }
    }
    families.push(f)
  }
  const f = families[0]!
  await f.t.mutation(due, { userId, through: NOW })
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  const result = await f.owner.query(async ctx => ({ today: await ctx.runQuery(api.learnV2Today.getToday, {}), metrics: await ctx.meta.getTransactionMetrics() }))
  console.info('today-pointer-read-budget', JSON.stringify({ checks: 'mixed-4', queries: result.metrics.databaseQueries.used,
    documents: result.metrics.documentsRead.used, bytes: result.metrics.bytesRead.used }))
  expect('checkPointers' in result.today && result.today.checkPointers).toMatchObject({ status: 'available', isDone: true, continueCursor: null })
  expect('checkPointers' in result.today && result.today.checkPointers.checks.map(pointer => pointer.state).sort()).toEqual(['ready', 'saved_scoring', 'result_unconfirmed', 'result_ready'].sort())
  expect(result.metrics.databaseQueries.used).toBeLessThan(3072)
}, 60_000)

test('historical Canvas version batches continue without dropping saved checks', async () => {
  const families: Awaited<ReturnType<typeof fixture>>[] = []
  const references: string[] = []
  for (let index = 0; index < 6; index++) {
    const f = await fixture({ test: families[0]?.t, fixtureKey: `version-batch-${index}` })
    await f.start()
    const row = await coldFor(f)
    const opened = await attach(f, row)
    const accepted = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
    if (accepted.kind !== 'accepted') throw new Error('Expected seal')
    if (index > 0) await f.t.run(async ctx => {
      const opportunity = (await ctx.db.get(row._id))!
      const response = (await ctx.db.get(accepted.submissionId))!
      if (opportunity.contextPins.kind !== 'session' || !opportunity.contextPins.canvas || response.scopeKind !== 'v2'
        || response.contextPins.kind !== 'session' || !response.contextPins.canvas) throw new Error('Expected Canvas pins')
      await ctx.db.patch(row._id, { contextPins: { ...opportunity.contextPins, canvas: { ...opportunity.contextPins.canvas, planVersion: `historical-${index}` } } })
      await ctx.db.patch(accepted.submissionId, { contextPins: { ...response.contextPins, canvas: { ...response.contextPins.canvas, planVersion: `historical-${index}` } } })
    })
    references.push(row.delayedCheckId)
    families.push(f)
  }
  const f = families[0]!
  const today = await f.owner.query(api.learnV2Today.getToday, {})
  if (!('checkPointers' in today)) throw new Error('Expected pointers')
  expect(today.checkPointers.checks).toHaveLength(4)
  const next = await f.owner.query(api.learnV2Today.getCheckPointers, { cursor: today.checkPointers.continueCursor! })
  expect(next).toMatchObject({ isDone: true, continueCursor: null })
  expect([...today.checkPointers.checks, ...next.checks].map(pointer => pointer.reference).sort()).toEqual(references.sort())
})

test('recent deleted checks cannot displace four owned closed receipts from the first page', async () => {
  const families: Awaited<ReturnType<typeof fixture>>[] = []
  const references: string[] = []
  for (let index = 0; index < 16; index++) {
    const f = await fixture({ test: families[0]?.t, fixtureKey: `closed-history-${index}` })
    await f.start()
    const row = await coldFor(f)
    const opened = await attach(f, row)
    await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
    await f.t.run(ctx => ctx.db.patch(row._id, { phase: 'invalid' }))
    if (index >= 4) await f.t.run(ctx => ctx.db.delete(opened.attached.threadId))
    else references.push(row.delayedCheckId)
    families.push(f)
  }
  const today = await families[0]!.owner.query(api.learnV2Today.getToday, {})
  expect('checkPointers' in today && today.checkPointers).toMatchObject({ isDone: true, continueCursor: null })
  expect('checkPointers' in today && today.checkPointers.checks.map(pointer => pointer.reference).sort()).toEqual(references.sort())
})

test('four maximum ready checks remain on the first page with retired historical Canvas labels', async () => {
  const families: Awaited<ReturnType<typeof fixture>>[] = []
  for (let index = 0; index < 7; index++) {
    const historical = index < 3
    const f = await fixture({ test: families[0]?.t, fixtureKey: `historical-headroom-${index}`,
      ...(historical ? {} : { reserveCount: 3, inventory: { claims: 32, supports: 2, sources: 64, backingDocuments: true } }) })
    await f.start()
    if (historical) await f.t.run(async ctx => {
      const row = (await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_learningVoidId', q =>
        q.eq('userId', userId).eq('learningVoidId', f.graph.learningVoidId)).take(8)).find(value => value.purpose.kind === 'measurement_cold')!
      if (row.contextPins.kind !== 'session' || !row.contextPins.canvas) throw new Error('Expected Canvas pins')
      await ctx.db.patch(row._id, { phase: 'invalid', contextPins: { ...row.contextPins,
        canvas: { ...row.contextPins.canvas, planVersion: `historical-retired-${index}` } } })
      await ctx.db.patch(f.graph.studySessionId, { status: 'completed' })
    })
    families.push(f)
  }
  const result = await families[0]!.owner.query(async ctx => ({ today: await ctx.runQuery(api.learnV2Today.getToday, {}), metrics: await ctx.meta.getTransactionMetrics() }))
  console.info('today-pointer-read-budget', JSON.stringify({ checks: 'ready-4-historical', queries: result.metrics.databaseQueries.used,
    documents: result.metrics.documentsRead.used, bytes: result.metrics.bytesRead.used }))
  expect('checkPointers' in result.today && result.today.checkPointers.checks).toHaveLength(4)
  expect('checkPointers' in result.today && result.today.checkPointers).toMatchObject({ isDone: true, continueCursor: null })
  expect(result.metrics.databaseQueries.used).toBeLessThan(3072)
}, 60_000)

test('four maximum closed receipts appear on the first Today page', async () => {
  const families: Awaited<ReturnType<typeof fixture>>[] = []
  for (let index = 0; index < 4; index++) {
    const f = await fixture({ test: families[0]?.t, fixtureKey: `closed-maximum-${index}`, reserveCount: 3,
      inventory: { claims: 32, supports: 2, sources: 64, backingDocuments: true } })
    await f.start()
    const row = await coldFor(f)
    const opened = await attach(f, row)
    await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)
    await f.t.run(ctx => ctx.db.patch(row._id, { phase: 'invalid' }))
    families.push(f)
  }
  const f = families[0]!
  const result = await f.owner.query(async ctx => ({ today: await ctx.runQuery(api.learnV2Today.getToday, {}), metrics: await ctx.meta.getTransactionMetrics() }))
  console.info('today-pointer-read-budget', JSON.stringify({ checks: 'closed-4', queries: result.metrics.databaseQueries.used,
    documents: result.metrics.documentsRead.used, bytes: result.metrics.bytesRead.used }))
  expect('checkPointers' in result.today && result.today.checkPointers).toMatchObject({ isDone: true, continueCursor: null })
  expect('checkPointers' in result.today && result.today.checkPointers.checks.map(pointer => pointer.state)).toEqual(['closed', 'closed', 'closed', 'closed'])
  expect(result.metrics.databaseQueries.used).toBeLessThan(3072)
}, 60_000)

test.each([17, 32])('Today preparation accepts %s teaching claims without a teaching Canvas ceiling', async claims => {
  const f = await fixture({ teaching: { claims, supports: claims === 32 ? 2 : 1, sources: claims === 32 ? 64 : 17 } })
  const started = await f.start()
  expect(started).toMatchObject({ status: 'assessment', deliveryGrant: null, assessment: { check: { state: 'ready' } } })
  expect(await f.start()).toEqual(started)
  const row = (await f.opportunities()).find(row => row.purpose.kind === 'measurement_cold')!
  await attach(f, row)
  expect(await f.t.run(ctx => ctx.db.query('learningThreads').take(3))).toHaveLength(1)
})

test.each([false, true])('a mid-flight flag toggle preserves its frozen flow: initially enabled=%s', async enabled => {
  policy.pointers = enabled
  const f = await fixture()
  await f.start()
  const row = (await f.opportunities()).find(row => row.purpose.kind === 'measurement_cold')!
  const reference = { version: LEARN_V2_PUBLIC_API_VERSION, assessmentOpportunityId: row._id }
  const opened = enabled ? await attach(f, row) : null
  policy.pointers = !enabled
  const today = await f.owner.query(api.learnV2Today.getToday, {})
  const state = await f.owner.query(api.learnV2Today.getCheckPointers, {})
  if (opened) {
    expect('checkPointers' in today && today.checkPointers.checks).toEqual([expect.objectContaining({ reference: row.delayedCheckId, state: 'ready' })])
    expect(state.checks).toEqual([expect.objectContaining({ reference: row.delayedCheckId })])
    expect(await f.owner.query(api.learnV2Assessments.getAssessment, reference)).toMatchObject({ reasonCodes: ['flow_mismatch'] })
    const session = (await f.t.run(ctx => ctx.db.get(f.graph.studySessionId)))!
    expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: session._id, expectedSessionRevision: session.revision,
      expectedContentRevision: 1, idempotencyKey: 'toggle_canvas_start_1234567890' })).toMatchObject({ deliveryGrant: null, assessment: { check: { state: 'ready' } } })
    expect((await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)).kind).toBe('accepted')
    expect((await f.read())[0]).toMatchObject({ state: 'saved_scoring' })
  } else {
    expect(today).toMatchObject({ status: 'ready', assessment: { kind: 'check', state: { phase: 'test_open' } } })
    expect(state.checks).toEqual([])
    expect(await f.owner.query(api.learnV2Assessments.getAssessment, reference)).toMatchObject({ status: 'delivered' })
    expect(await f.start()).toMatchObject({ deliveryGrant: { status: 'granted' } })
    const current = (await f.opportunities()).find(value => value._id === row._id)!
    const accepted = await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
      idempotencyKey: 'toggle_today_accept_1234567890', response: { target: { assessmentOpportunityId: row._id }, expectedRevision: current.revision,
        payload: { kind: 'text', text: 'A saved Today answer.' } } } })
    expect(accepted).toMatchObject({ kind: 'accepted' })
  }
  policy.pointers = enabled
  await f.owner.query(api.learnV2Today.getToday, {})
  expect(await f.t.run(ctx => ctx.db.get(row.assignmentId!))).toMatchObject({ flow: 'v2_today',
    ...(enabled ? { checkSurface: { surface: 'canvas', measurementFlow: 'v2_today' } } : {}) })
  expect(await f.t.run(ctx => ctx.db.query('learnResponses').withIndex('by_userId_and_assessmentOpportunityId', q => q.eq('userId', userId).eq('assessmentOpportunityId', row._id)).first()))
    .toMatchObject({ flow: enabled ? 'canvas' : 'today' })
})

test.each(['today', 'session_deep_link'] as const)('a frozen %s Canvas check survives rollback before its first grant', async entryPoint => {
  const f = await fixture()
  const started = await f.start(entryPoint)
  const row = (await f.opportunities()).find(row => row.purpose.kind === 'measurement_cold')!
  policy.pointers = false
  expect(await f.start(entryPoint)).toEqual(started)
  expect(await f.read()).toEqual([expect.objectContaining({ reference: row.delayedCheckId, state: 'ready' })])
  const opened = await attach(f, row)
  expect((await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)).kind).toBe('accepted')
  expect((await f.read())[0]).toMatchObject({ state: 'saved_scoring' })
})

test('a legacy Today assignment keeps its dedicated delayed entry after rollout', async () => {
  policy.pointers = false
  const f = await fixture()
  await f.start()
  const cold = (await f.opportunities()).find(row => row.purpose.kind === 'measurement_cold')!
  expect(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: 'legacy_cold_save_1234567890', response: { target: { assessmentOpportunityId: cold._id }, expectedRevision: cold.revision,
      payload: { kind: 'text', text: 'A saved Today answer.' } } } })).toMatchObject({ kind: 'accepted' })
  const day7 = (await f.opportunities()).find(row => row.horizonDays === 7)!
  policy.pointers = true
  vi.setSystemTime(day7.openAt + 1000)
  await f.t.mutation(due, { userId, through: Date.now() })
  const ready = (await f.opportunities()).find(row => row._id === day7._id)!
  if (ready.contextPins.kind !== 'session') throw new Error('Expected session pins')
  const session = (await f.t.run(ctx => ctx.db.get(ready.contextPins.kind === 'session' ? ready.contextPins.studySessionId : f.graph.studySessionId)))!
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', sessionId: session._id,
    assessment: { kind: 'check', state: { phase: 'ready' } }, checkPointers: { checks: [] } })
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: session._id,
    expectedSessionRevision: session.revision, expectedContentRevision: ready.contextPins.contentRevision,
    idempotencyKey: 'legacy_delayed_start_1234567890', entryPoint: 'today' })).toMatchObject({ status: 'assessment', deliveryGrant: { status: 'granted' } })
  expect(await f.owner.query(api.learnV2Assessments.getAssessment, { version: LEARN_V2_PUBLIC_API_VERSION, assessmentOpportunityId: ready._id })).toMatchObject({ status: 'delivered' })
  expect(await f.read()).toEqual([])
})

type SweepFixture = Awaited<ReturnType<typeof fixture>>
type SweepTarget = 'same_objective' | 'other_objective' | 'other_void' | 'shared_source_void'
const SWEEP_TARGETS: SweepTarget[] = ['same_objective', 'other_objective', 'other_void', 'shared_source_void']
const SCHEDULER_STATES = ['preparing_pending', 'preparing_blocked', 'ready_blocked', 'test_open_blocked'] as const
type SweepCondition = { kind: 'playable' | 'protocol_removed' | 'protocol_version' | 'protocol_window' | 'entitlement' | 'pilot' | 'thread_lost' | 'expired'
  | 'saved' | 'saved_protocol_version' | 'saved_protocol_window' } | { kind: 'reason', reasonCode: string } | { kind: 'scheduler', state: typeof SCHEDULER_STATES[number] }
const SWEEP_CONDITIONS: SweepCondition[] = [
  ...(['playable', 'protocol_removed', 'protocol_version', 'protocol_window', 'entitlement', 'pilot', 'thread_lost', 'expired',
    'saved', 'saved_protocol_version', 'saved_protocol_window'] as const).map(kind => ({ kind })),
  ...PREPARATION_REASON_SWEEP.map(reasonCode => ({ kind: 'reason' as const, reasonCode })),
  ...SCHEDULER_STATES.map(state => ({ kind: 'scheduler' as const, state })),
]
const conditionLabel = (condition: SweepCondition) => condition.kind === 'reason' ? `reason ${condition.reasonCode}`
  : condition.kind === 'scheduler' ? `scheduler ${condition.state}` : condition.kind

async function sweepTarget(f: SweepFixture, target: SweepTarget) {
  if (target === 'same_objective') return { lessonId: await anotherTodayLesson(f), g: f }
  if (target === 'other_void' || target === 'shared_source_void') {
    const g = await fixture({ test: f.t, fixtureKey: 'sweep-void-2' })
    if (target === 'shared_source_void') await f.t.run(async ctx => ctx.db.patch(g.graph.sourceIdentityId,
      { externalKey: (await ctx.db.get(f.graph.sourceIdentityId))!.externalKey }))
    return { lessonId: g.graph.studySessionId, g }
  }
  const lessonId = await f.t.run(async ctx => {
    const objectiveId = await ctx.db.insert('learnObjectives', { userId, blueprintRevisionId: f.graph.blueprintRevisionId, order: 1,
      title: 'Apply a second rule', depth: 'working', assessmentContract: (await ctx.db.get(f.graph.objectiveId))!.assessmentContract })
    await ctx.db.insert('learnObjectiveSources', { userId, objectiveId, sourceSnapshotId: f.graph.sourceSnapshotId, coverage: 'strong' })
    return await ctx.db.insert('studySessions', { userId, studyPlanRevisionId: f.graph.studyPlanRevisionId, primaryObjectiveId: objectiveId,
      status: 'planned', revision: 1, scheduledStartAt: NOW })
  })
  await publishDeliveryTeaching({ t: f.t, graph: { ...f.graph, studySessionId: lessonId } })
  return { lessonId, g: f }
}

async function applySweepCondition(f: SweepFixture, condition: SweepCondition, check: Doc<'learnAssessmentOpportunities'>) {
  const protocol = policy.protocol as ReturnType<typeof syntheticDeliveryProtocol>
  if (condition.kind.startsWith('saved')) {
    const opened = await attach(f, check)
    expect((await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)).kind).toBe('accepted')
  }
  if (condition.kind === 'protocol_removed') policy.protocol = null
  if (condition.kind.endsWith('protocol_version')) policy.protocol = { ...protocol, version: 'synthetic.delivery-protocol.v2' }
  if (condition.kind.endsWith('protocol_window')) policy.protocol = { ...protocol, coldWindowMs: protocol.coldWindowMs + 60_000 }
  if (condition.kind === 'entitlement' || condition.kind === 'pilot') await revokeCanvas(condition.kind, f)
  if (condition.kind === 'thread_lost' && check.contextPins.kind === 'session' && check.contextPins.canvas) {
    const threadId = check.contextPins.canvas.threadId
    await f.t.run(ctx => ctx.db.delete(threadId))
  }
  if (condition.kind === 'expired') vi.setSystemTime(check.closeAt + 60_000)
  if (condition.kind === 'reason') await f.t.run(ctx => ctx.db.patch(check._id, { operationalEligibility: 'blocked', reasonCode: condition.reasonCode }))
  if (condition.kind === 'scheduler') {
    const [phase, operationalEligibility] = condition.state === 'test_open_blocked' ? ['test_open', 'blocked'] as const
      : condition.state.split('_') as ['preparing' | 'ready', 'pending' | 'blocked']
    await f.t.run(ctx => ctx.db.patch(check._id, { phase, operationalEligibility, reasonCode: 'synthetic_scheduler_block' }))
  }
}

function expectedCloseReason(condition: SweepCondition) {
  if (condition.kind === 'reason') return condition.reasonCode
  if (condition.kind === 'scheduler') return 'synthetic_scheduler_block'
  if (['protocol_removed', 'protocol_version', 'protocol_window'].includes(condition.kind)) return 'protocol_not_frozen'
  if (condition.kind === 'entitlement') return 'canvas_not_admitted'
  return null
}

async function expectTodayLessonInvariant(f: SweepFixture, lessonId: Id<'studySessions'>, key: string) {
  const today = await f.owner.query(api.learnV2Today.getToday, {})
  expect(today).toMatchObject({ status: 'ready', sessionId: lessonId })
  if (today.status !== 'ready' || !('checkPointers' in today)) throw new Error('Expected a ready Today projection with pointers')
  const lesson = (await f.t.run(ctx => ctx.db.get(lessonId)))!
  const content = await f.t.run(ctx => ctx.db.query('sessionContent').withIndex('by_userId_and_studySessionId_and_revision', q =>
    q.eq('userId', userId).eq('studySessionId', lessonId)).order('desc').first())
  const start = () => f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: lessonId,
    expectedSessionRevision: lesson.revision, expectedContentRevision: content!.revision, entryPoint: 'today', idempotencyKey: `sweep_start_${key}` })
  const assessment = 'assessment' in today ? today.assessment : undefined
  if (assessment?.kind === 'check') {
    const reference = assessment.check?.reference
    expect(assessment.check).toMatchObject({ state: 'ready' })
    expect(today.checkPointers.checks).toContainEqual(expect.objectContaining({ reference, state: 'ready' }))
    const started = await start()
    expect(started).toMatchObject({ status: 'assessment', assessment: { kind: 'check', check: { state: 'ready' } } })
    const after = await f.owner.query(api.learnV2Today.getToday, {})
    const locked = 'assessment' in after && after.assessment?.kind === 'check' ? after.assessment.check?.reference : null
    expect(locked).toBe('assessment' in started && started.assessment.check ? started.assessment.check.reference : undefined)
    expect('checkPointers' in after && after.checkPointers.checks).toContainEqual(expect.objectContaining({ reference: locked, state: 'ready' }))
    expect(await f.t.run(ctx => ctx.db.get(lessonId))).toEqual(lesson)
    const withheld = await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: lessonId,
      idempotencyKey: `sweep_withheld_${key}_1234567890` })
    expect(JSON.stringify(withheld)).not.toContain('TEACHING-CANARY')
    return 'locked' as const
  }
  expect(assessment?.kind ?? 'ordinary').toMatch(/^(teach|unprepared|ordinary)$/)
  expect(await start()).toMatchObject({ status: 'in_progress' })
  await expectTeachingDelivery(f, lessonId, `sweep_${key}`)
  return 'taught' as const
}

test.each(SWEEP_TARGETS.flatMap(target => SWEEP_CONDITIONS.map(condition => [target, conditionLabel(condition), condition] as const)))(
  'Today startable implies start and delivery for a %s lesson when the open check has %s', async (target, label, condition) => {
    const f = await fixture()
    await f.t.run(ctx => ctx.db.patch(f.graph.studySessionId, { scheduledEndAt: NOW + 30 * 60_000 }))
    await f.start()
    const check = await coldFor(f)
    const { lessonId, g } = await sweepTarget(f, target)
    await f.t.run(ctx => ctx.db.patch(f.graph.studySessionId, { scheduledStartAt: NOW + 3 * 86_400_000, scheduledEndAt: undefined }))
    await applySweepCondition(f, condition, check)
    const before = (await f.t.run(ctx => ctx.db.get(check._id)))!
    const savedResponse = before.submissionId ? await f.t.run(ctx => ctx.db.get(before.submissionId!)) : null
    vi.spyOn(canvasPreparation, 'prepareCanvasSessionForOwner').mockResolvedValue({ kind: 'not_admitted',
      reasonCode: condition.kind === 'reason' ? condition.reasonCode : 'novel_item_unavailable', observations: 'no_observations' })
    const key = `${target}_${label}`.replace(/[^a-z0-9]+/giu, '_')
    const outcome = await expectTodayLessonInvariant(g, lessonId, key)
    const after = (await f.t.run(ctx => ctx.db.get(check._id)))!
    // The C4 guard cannot scope a check whose thread is gone, so it withholds every teaching read until that check closes.
    const independent = target === 'other_void' && condition.kind !== 'thread_lost'
    if (condition.kind === 'playable' && !independent) {
      expect(outcome).toBe('locked')
      expect(after).toEqual(before)
      const opened = await attach(f, after)
      expect((await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, opened.stage)).kind).toBe('accepted')
      expect(await expectTodayLessonInvariant(g, lessonId, `${key}_after_save`)).toBe('taught')
      return
    }
    expect(outcome).toBe('taught')
    if (savedResponse) expect(await f.t.run(ctx => ctx.db.get(before.submissionId!))).toEqual(savedResponse)
    const closable = !independent && !before.submissionId && condition.kind !== 'expired' && condition.kind !== 'playable'
    if (!closable) {
      if (independent || before.submissionId) expect(after).toEqual(before)
      return
    }
    expect(after).toMatchObject({ phase: 'cancelled', operationalEligibility: 'blocked' })
    const facts = await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_assessmentOpportunityId', q =>
      q.eq('userId', userId).eq('fact.assessmentOpportunityId', check._id)).take(16))
    const cancelled = facts.filter(row => row.fact.kind === 'opportunity' && row.fact.status === 'cancelled')
    expect(cancelled.length).toBeGreaterThan(0)
    const reason = expectedCloseReason(condition)
    if (reason) expect(cancelled.map(row => row.fact.kind === 'opportunity' ? row.fact.reasonCode : null)).toContain(reason)
  }, 60_000)


test('an expired evidence-limit fixture cannot quarantine the next Canvas publication', async () => {
  const release = deferred<undefined>()
  const predecessor = createTimeoutScope()
  void predecessor.run(async () => {
    policy.evidenceRows = 1
    try {
      await release.promise
      policy.evidenceRows = 1
    } finally {
      policy.evidenceRows = 1
    }
  })
  predecessor.close()
  expect(policy.evidenceRows).toBe(64)
  const f = await fixture({ inventory: { claims: 3, supports: 1, sources: 1 } })
  release.resolve(undefined)
  await Promise.resolve()
  await Promise.resolve()
  expect(policy.evidenceRows).toBe(64)
  await f.start()
  const checks = await f.read()
  expect(checks).toHaveLength(1)
  expect(checks[0]).toMatchObject({ state: 'ready' })
  const opened = await attach(f, (await f.opportunities())[0]!)
  expect(opened.canvas.responsePrompt).toBeTruthy()
})
