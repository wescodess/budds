/// <reference types="vite/client" />
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
import type { Doc } from './_generated/dataModel'
import * as privacyContext from './lib/learnV2PrivacyReadContext'
import { readCanvasCheckPointerForOwner } from './learnAdaptiveCanvas'
import { measurementReadContext } from './lib/learnV2MeasurementReadContext'

const policy = vi.hoisted(() => ({ pointers: true, responses: true, evidenceRows: 64, protocol: null as unknown, scorer: null as unknown }))
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
  policy.pointers = true; policy.responses = true; policy.evidenceRows = 64
  vi.stubEnv('LEARN_ADAPTIVE_V2_PILOT_MANIFEST', ADAPTIVE_V2_PILOT_MANIFEST.version)
  for (const name of ['OPENROUTER_API_KEY', 'CF_ACCOUNT_ID', 'CLOUDFLARE_AI_GATEWAY_ID']) vi.stubEnv(name, 'synthetic-unused')
})
afterEach(() => {
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, originalManifest)
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers()
})

async function fixture(options: { canvas?: boolean, inventory?: { claims: number, supports: number, sources: number, backingDocuments?: boolean }, reserveCount?: number,
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
  const f = await canvasFamilyFixture(saved.binding, { rubric: true, inventory: options.inventory, reserveCount: options.reserveCount, test: options.test, fixtureKey: options.fixtureKey })
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

test.each(['today', 'session_deep_link'] as const)('%s records its entry while the row delivers, seals, scores and reads on Canvas', async entryPoint => {
  const f = await fixture()
  expect(await f.read()).toEqual([])
  expect(await f.start(entryPoint)).toMatchObject({ status: 'assessment', deliveryGrant: null, assessment: { check: { state: 'ready' } } })
  const row = (await f.opportunities())[0]!
  const [pointer] = await f.read()
  expect(learnTodayCheckPointerSchema.parse(pointer)).toEqual(pointer)
  expect(pointer).toMatchObject({ reference: row.delayedCheckId, state: 'ready', destination: { kind: 'canvas',
    route: `/app/learn/void/${row.contextPins.kind === 'session' ? row.contextPins.canvas!.threadId : ''}?check=${encodeURIComponent(row.delayedCheckId)}` } })
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
  const next = (await other.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_contextPins_studySessionId', q =>
    q.eq('userId', userId).eq('contextPins.studySessionId', other.graph.studySessionId)).unique()))!
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
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'empty', checkPointers: {
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
    const row = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_contextPins_studySessionId', q =>
      q.eq('userId', userId).eq('contextPins.studySessionId', f.graph.studySessionId)).unique()))!
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
    for (let index = 0; index < 24; index++) await ctx.db.insert('learnAssessmentOpportunities', {
      ...fields, delayedCheckId: `expired-${index}`, closeAt: NOW - 1,
    })
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
      const row = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_contextPins_studySessionId', q =>
        q.eq('userId', userId).eq('contextPins.studySessionId', f.graph.studySessionId)).unique()))!
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
    const row = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_contextPins_studySessionId', q =>
      q.eq('userId', userId).eq('contextPins.studySessionId', f.graph.studySessionId)).unique()))!
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
    const row = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_contextPins_studySessionId', q =>
      q.eq('userId', userId).eq('contextPins.studySessionId', f.graph.studySessionId)).unique()))!
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
      const row = (await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_contextPins_studySessionId', q =>
        q.eq('userId', userId).eq('contextPins.studySessionId', f.graph.studySessionId)).unique())!
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
    const row = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_contextPins_studySessionId', q =>
      q.eq('userId', userId).eq('contextPins.studySessionId', f.graph.studySessionId)).unique()))!
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
      expectedContentRevision: session.startedSessionContentRevision!, idempotencyKey: 'toggle_canvas_start_1234567890' })).toMatchObject({ deliveryGrant: null, assessment: { check: { state: 'ready' } } })
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
  expect(await f.t.run(ctx => ctx.db.get(row.assignmentId!))).toMatchObject({ flow: enabled ? 'v2_canvas' : 'v2_today' })
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
