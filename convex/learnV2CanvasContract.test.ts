import * as assessmentDelivery from './lib/learnV2AssessmentDelivery'
import * as scoringContract from '../server/utils/learn-v2-measurement-item-contract'
/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { anyApi, makeFunctionReference, type ApiFromModules } from 'convex/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { runLearnDueCron } from '../tests/fixtures/learn-v2-due-cron'
import { api, internal } from './_generated/api'
import schema from './schema'
import { canvasFamilyFixture, canvasIdentity } from '../tests/fixtures/learn-v2-canvas'
import { publishDeliveryTeaching, syntheticDeliveryProtocol } from '../tests/fixtures/learn-v2-assessment-delivery'
import { learnMeasurementProtocolSchema, measurementClock } from './lib/learnV2MeasurementAssignment'
import { seedMeasurementStorage } from '../tests/fixtures/learn-v2-measurement-storage'
import { ADAPTIVE_ASSESSMENT_PLAN_VERSION, composeAdaptiveActivityPlan, readAdaptiveAssessmentReference } from '../shared/learn-adaptive-activity-plan'
import { storedPlan } from './learnAdaptiveRecovery'
import { ADAPTIVE_V2_PILOT_MANIFEST } from '../shared/adaptive-v2-pilot-policy'
import { privacyDigest } from './lib/learnV2ResponsePrivacy'
import { createLearnScorerRegistry, sealLearnScorerConfiguration } from './lib/learnV2ScorerConfig'
import { LEARN_V2_PUBLIC_API_VERSION } from './lib/learnV2PublicContract'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION } from '../shared/learn-v2-responses'
import { masteryScopeKey } from './lib/learnV2MasteryScope'
import { localDateAt } from '../shared/learn-v2-mastery'
import { LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION } from '../shared/learn-v2-assessment-disclosure'
import { replaceMeasurementOpportunity } from '../tests/fixtures/learn-v2-measurement-replacement'
import { seedFixedCheckPlan } from '../tests/fixtures/learn-v2-fixed-check-plan'

const policy = vi.hoisted(() => ({ responses: true, delivery: true, scoring: true, enrollment: true, evidenceRows: 64, scorer: null as unknown, protocol: null as unknown }))
vi.mock('../shared/learn-v2-measurement-item-limits', async original => {
  const value = await original<typeof import('../shared/learn-v2-measurement-item-limits')>()
  return { ...value, LEARN_MEASUREMENT_ITEM_LIMITS: { ...value.LEARN_MEASUREMENT_ITEM_LIMITS, get evidenceRows() { return policy.evidenceRows } },
    assertMeasurementEvidenceRows(claims: Parameters<typeof value.assertMeasurementEvidenceRows>[0]) {
      if (policy.evidenceRows === 65 && claims.length === 32 && claims.every(claim => claim.supports.length <= 3)
        && claims.reduce((count, claim) => count + claim.supports.length, 0) === 65) return
      value.assertMeasurementEvidenceRows(claims)
    } }
})
vi.mock('../shared/learn-v2-measurement-storage-manifest', async original => {
  const value = await original<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...value, LEARN_MEASUREMENT_CAPABILITIES: { ...value.LEARN_MEASUREMENT_CAPABILITIES,
    get responses() { return policy.responses }, get delivery() { return policy.delivery }, get scoring() { return policy.scoring }, get enrollment() { return policy.enrollment } } }
})
vi.mock('./lib/learnV2MeasurementAssignment', async original => {
  const value = await original<typeof import('./lib/learnV2MeasurementAssignment')>()
  return { ...value, getFrozenLearnMeasurementProtocol: () => policy.protocol }
})
vi.mock('./lib/learnV2MeasurementScorerInventory', () => ({ getLearnMeasurementScorer: async () => policy.scorer }))

const modules = import.meta.glob('./**/*.ts')
const measurement = (anyApi as unknown as ApiFromModules<{ learnV2Measurement: typeof import('./learnV2Measurement') }>).learnV2Measurement
const materializeDue = makeFunctionReference<'mutation', { userId: string, through: number }>('learnV2MeasurementDueWork:materializeDelayedCheckEligibility')
const OWNER = canvasIdentity
const NOW = 1_800_000_000_001
const HASH = `sha256:${'a'.repeat(64)}`
const originalManifest = structuredClone(ADAPTIVE_V2_PILOT_MANIFEST)
const answer = 'A committed learner answer.'

beforeEach(() => {
  policy.responses = true; policy.delivery = true; policy.scoring = true; policy.enrollment = true; policy.scorer = null
  policy.evidenceRows = 64
  vi.useFakeTimers(); vi.setSystemTime(NOW)
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  vi.stubEnv('LEARN_ADAPTIVE_V2_PILOT_MANIFEST', ADAPTIVE_V2_PILOT_MANIFEST.version)
  for (const name of ['OPENROUTER_API_KEY', 'CF_ACCOUNT_ID', 'CLOUDFLARE_AI_GATEWAY_ID']) vi.stubEnv(name, 'synthetic-unused')
})
afterEach(() => {
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, originalManifest)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers()
})

async function fixture(options: { prepare?: boolean, attach?: boolean, flow?: 'v2_today' | 'v2_canvas', rubric?: boolean, reserve?: boolean, reserveCount?: number, inventory?: { claims: number, supports: number, sources: number, extraSupports?: number, backingDocuments?: boolean, claimText?: string }, transactionLimits?: boolean, format?: 'numeric' | 'keyed' | 'ordered' } = {}) {
  const definition = { configurationId: 'canvas.synthetic.v2', configurationVersion: 'canvas.synthetic.v2', kind: 'measurement_rubric' as const,
    requestedModel: 'synthetic/model', endpoint: null, identity: { mappingVersion: 'synthetic.identity.v1', canonicalModel: 'synthetic/model',
      family: 'synthetic', snapshotAssurance: 'unknown' as const, verifiedReturnedModels: [] } }
  const saved = await sealLearnScorerConfiguration(definition)
  const registry = await createLearnScorerRegistry({ epoch: 'synthetic.epoch.v1', configurations: [{ definition, expectedDigest: saved.binding.configurationDigest }],
    legacyAllowlist: [], prospectiveConfigurationId: null })
  policy.scorer = { registry, saved }
  policy.protocol = options.rubric === false ? syntheticDeliveryProtocol(NOW) : learnMeasurementProtocolSchema.parse({ ...syntheticDeliveryProtocol(NOW, true), scoringBinding: saved.binding })
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { pilotApproved: true,
    startsAt: new Date(NOW - 86_400_000).toISOString(), endsAt: new Date(NOW + 86_400_000).toISOString(),
    cohort: { ...originalManifest.cohort, subjectHashes: [await privacyDigest(['adaptive-v2-pilot-cohort.v1', OWNER.tokenIdentifier])] },
    modelPolicies: [{ model: 'synthetic/model', inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.1 }],
    productControls: { ...originalManifest.productControls, maxDispatchesPerHour: 4, maxDispatchesPerDay: 8, maxConcurrent: 2, maxReservedMicroUsdPerDay: 100_000 },
    rollback: { ...originalManifest.rollback, ownerSubjectHash: await privacyDigest(['adaptive-v2-rollback-owner.tokenIdentifier-sha256.v1', OWNER.tokenIdentifier]) } })
  const family = await canvasFamilyFixture(saved.binding, { reserve: options.reserve, reserveCount: options.reserveCount, inventory: options.inventory, transactionLimits: options.transactionLimits, rubric: options.rubric !== false, keyed: options.format === 'keyed', ordered: options.format === 'ordered' })
  const { t, owner, graph } = family
  await t.run(async ctx => {
    const user = (await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', OWNER.tokenIdentifier)).unique())!
    await ctx.db.patch(user._id, { learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: NOW } })
  })
  const teachingContentId = await publishDeliveryTeaching(family)
  const prepare = { studySessionId: graph.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas_prepare_1234567890' }
  const preparation = options.prepare === false ? null : options.flow === 'v2_today'
    ? await owner.mutation(measurement.enrollProspect, { studySessionId: graph.studySessionId, familyId: family.begun.familyId, entryPoint: 'today' })
    : await owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, prepare)
  if (options.prepare !== false && options.rubric !== false && preparation && !('kind' in preparation && preparation.kind === 'prepared') && !('status' in preparation && preparation.status === 'admitted')) throw new Error(JSON.stringify(preparation))
  const prepared = await t.run(async ctx => {
    const opportunity = (await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(4))[0]
    const item = opportunity?.assessmentPins.kind === 'measurement' ? (await ctx.db.get(opportunity.assessmentPins.itemPins.itemId))!
      : (await ctx.db.query('learnMeasurementItems').withIndex('by_userId_and_familyId_and_familyRevision_and_formLabel', q =>
        q.eq('userId', OWNER.tokenIdentifier).eq('familyId', family.begun.familyId).eq('familyRevision', 1)).first())!
    const claims = await ctx.db.query('learnMeasurementClaims').withIndex('by_userId_and_itemId_and_order', q => q.eq('userId', OWNER.tokenIdentifier).eq('itemId', item._id)).take(33)
    const support = (await ctx.db.query('learnMeasurementSupports').withIndex('by_userId_and_claimId', q => q.eq('userId', OWNER.tokenIdentifier).eq('claimId', claims[0]!._id)).first())!
    const opportunityId = opportunity?._id
    return { opportunityId: opportunityId!, prompt: item.prompt!, sessionContentId: opportunity?.contextPins.kind === 'session' ? opportunity.contextPins.sessionContentId : teachingContentId,
      studySessionId: opportunity?.contextPins.kind === 'session' ? opportunity.contextPins.studySessionId : graph.studySessionId,
      itemId: item._id, claimId: claims[0]!._id, supportId: support._id }
  })
  const attach = { studySessionId: graph.studySessionId, expectedSessionRevision: 2, idempotencyKey: `adaptive-ready-${crypto.randomUUID?.() ?? Date.now()}` }
  const attached = options.attach === false ? null : await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, attach)
  if (attached && attached.kind !== 'attached') throw new Error(JSON.stringify(attached))
  const activity = attached ? await t.run(ctx => ctx.db.query('learningThreadActivities').withIndex('by_userId_and_activityId', q =>
    q.eq('userId', OWNER.tokenIdentifier).eq('activityId', attached.activityId)).unique()) : null
  const f = { ...graph, studySessionId: prepared.studySessionId, threadId: attached?.threadId, activityId: activity?._id,
    rows: { learnAssessmentOpportunities: prepared.opportunityId, learnMeasurementClaims: prepared.claimId, learnMeasurementSupports: prepared.supportId } }
  const stage = attached ? { threadId: attached.threadId, activityId: attached.activityId, studySessionId: prepared.studySessionId, expectedRevision: 1, expectedSessionRevision: 3,
    response: answer, confidence: 3, idempotencyKey: `adaptive-canvas-submit-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}` } : null
  const canonical = { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'today_submission_1234567890',
    response: { target: { assessmentOpportunityId: prepared.opportunityId }, expectedRevision: 2, payload: { kind: 'text' as const, text: answer }, confidence: 3 } } }
  return { t, owner, f, stage: stage!, canonical, attach, attached, family, prepared, prompt: prepared.prompt,
    prepare, preparation, reference: { version: LEARN_V2_PUBLIC_API_VERSION, assessmentOpportunityId: prepared.opportunityId } }
}

test.each([7, 30] as const)('Canvas discovers and plays its original day-%s item without replaying cold or exposing siblings', async horizon => {
  const s = await fixture()
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { endsAt: new Date(NOW + 40 * 86_400_000).toISOString() })
  vi.stubGlobal('fetch', vi.fn(async () => modelReply()))
  const cold = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)
  if (cold.kind !== 'accepted') throw new Error('Expected cold seal')
  await s.owner.action(api.learnAdaptive.submitResponse, { threadId: s.stage.threadId, activityId: s.stage.activityId,
    submissionId: cold.submissionId, idempotencyKey: 'cold_before_delayed_canvas_1234567890' })
  const slots = () => s.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(8))
  const original = (await slots()).find(row => row.horizonDays === horizon)!
  if (horizon === 30) {
    const day7 = (await slots()).find(row => row.horizonDays === 7)!
    vi.setSystemTime(day7.openAt)
    await runLearnDueCron(s.t)
  }
  vi.setSystemTime(original.openAt + 1000)
  await runLearnDueCron(s.t)
  const due = await s.owner.query(api.learnAdaptiveCanvas.listDueChecks, {})
  expect(due).toMatchObject({ status: 'available', checks: [{ assessmentOpportunityId: original._id, horizonDays: horizon }] })
  expect(JSON.stringify(due)).not.toMatch(/Hypothetical|PRIVATE|declaredStimulus|promptDigest/)
  const check = due.checks[0]!
  expect(check.studySessionId).not.toBe(s.f.studySessionId)
  expect(await s.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, { version: LEARN_V2_PUBLIC_API_VERSION,
    assessmentOpportunityId: original._id, expectedRevision: 1, idempotencyKey: 'delayed_canvas_today_bypass_1234567890' }))
    .toMatchObject({ status: 'unavailable', reasonCodes: ['flow_mismatch'] })
  const attached = await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: check.studySessionId,
    expectedSessionRevision: check.sessionRevision, idempotencyKey: 'attach_due_canvas_check_1234567890' })
  if (attached.kind !== 'attached') throw new Error(JSON.stringify(attached))
  expect(attached.threadId).not.toBe(s.stage.threadId)
  const canvas = (await s.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId }))!
  if (original.assessmentPins.kind !== 'measurement') throw new Error('Expected item pins')
  const item = (await s.t.run(ctx => ctx.db.get(original.assessmentPins.kind === 'measurement' ? original.assessmentPins.itemPins.itemId : s.prepared.itemId)))!
  expect(canvas).toMatchObject({ status: 'started', responsePrompt: item.prompt, declaredStimulus: item.declaredStimulus })
  const siblings = await s.t.run(ctx => ctx.db.query('learnMeasurementItems').withIndex('by_userId_and_familyId_and_familyRevision_and_formLabel', q =>
    q.eq('userId', OWNER.tokenIdentifier).eq('familyId', item.familyId).eq('familyRevision', item.familyRevision)).take(7))
  for (const sibling of siblings.filter(row => row._id !== item._id)) expect(JSON.stringify(canvas)).not.toContain(sibling.prompt)
  expect(JSON.stringify(canvas)).not.toContain('PRIVATE')
  const sealed = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { threadId: attached.threadId, activityId: attached.activityId,
    studySessionId: check.studySessionId, expectedRevision: canvas.activity.planRevision!, expectedSessionRevision: canvas.session.revision,
    response: answer, confidence: 3, idempotencyKey: 'seal_due_canvas_check_1234567890' })
  if (sealed.kind !== 'accepted') throw new Error('Expected delayed seal')
  const acceptedPins = await s.t.run(async ctx => {
    const response = await ctx.db.get(sealed.submissionId)
    if (!response || response.scopeKind !== 'v2') throw new Error('Expected a V2 response')
    return response.contextPins
  })
  expect(await s.t.run(ctx => ctx.db.get(check.studySessionId))).toMatchObject({ status: 'completed', revision: canvas.session.revision })
  expect(await s.owner.action(api.learnAdaptive.submitResponse, { threadId: attached.threadId, activityId: attached.activityId,
    submissionId: sealed.submissionId, idempotencyKey: 'score_due_canvas_check_1234567890' })).toMatchObject({ kind: 'accepted', status: 'completed' })
  const scored = await s.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })
  expect(scored).toMatchObject({ status: 'feedback', assessment: { phase: 'scored_pass' } })
  expect(scored!.activity.controls.options.every(option => !option.available)).toBe(true)
  await s.t.run(async ctx => {
    const opportunity = (await ctx.db.get(original._id))!
    expect(await ctx.db.get(check.studySessionId)).toMatchObject({ status: 'completed', revision: canvas.session.revision })
    expect(await ctx.db.get(sealed.submissionId)).toMatchObject({ contextPins: acceptedPins })
    expect(await ctx.db.get(opportunity.deliveryGrantId!)).toMatchObject({ caseId: item.caseId, provenanceVersion: 'learn-v2.assessment-delivery.canvas.v1' })
    expect(await ctx.db.get(opportunity.authoritativeAttemptId!)).toMatchObject({ kind: 'measurement_delayed', horizonDays: horizon, masteryStateAfter: 'unseen' })
    if (horizon === 30) expect((await ctx.db.query('learnAssessmentOpportunities').take(8)).find(row => row.horizonDays === 7)).toMatchObject({ phase: 'abandoned', reasonCode: 'missed_window' })
  })
})

test.each([7, 30] as const)('Canvas delivers and scores the recorded day-%s reserve in its own flow', async horizon => {
  const s = await fixture({ reserve: true })
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { endsAt: new Date(NOW + 40 * 86_400_000).toISOString() })
  vi.stubGlobal('fetch', vi.fn(async () => modelReply()))
  const cold = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)
  if (cold.kind !== 'accepted') throw new Error('Expected cold seal')
  await s.owner.action(api.learnAdaptive.submitResponse, { threadId: s.stage.threadId, activityId: s.stage.activityId,
    submissionId: cold.submissionId, idempotencyKey: 'reserve_cold_score_1234567890' })
  const slots = () => s.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(12))
  const original = (await slots()).find(row => row.horizonDays === horizon)!
  const assignment = (await s.t.run(ctx => ctx.db.get(original.assignmentId!)))!
  if (assignment.status !== 'admitted') throw new Error('Expected admitted assignment')
  vi.setSystemTime(original.openAt + 1000)
  await s.t.mutation(materializeDue, { userId: OWNER.tokenIdentifier, through: Date.now() })
  const prior = await s.owner.query(api.learnAdaptiveCanvas.listDueChecks, {})
  if (prior.status !== 'available' || !prior.checks[0]) throw new Error('Expected original')
  await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: prior.checks[0].studySessionId,
    expectedSessionRevision: prior.checks[0].sessionRevision, idempotencyKey: 'reserve_original_attach_1234567890' })
  await s.t.run(ctx => seedFixedCheckPlan(ctx, OWNER.tokenIdentifier, s.family.graph, Date.now()))
  const reflow = await s.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: s.f.studyPlanRevisionId,
    expectedPlanRecordRevision: 1, idempotencyKey: 'canvas_reserve_reflow_1234567890' })
  expect(reflow.preservedSessionIds).toContain(prior.checks[0].studySessionId)
  expect(reflow.preservedSessionIds).toContain(s.f.studySessionId)
  await s.t.run(ctx => ctx.db.patch(original._id, { reasonCode: 'contaminated' }))
  const replaced = await s.owner.mutation(replaceMeasurementOpportunity, { assessmentOpportunityId: original._id, reason: 'contaminated' })
  if (replaced.status !== 'replaced') throw new Error('Expected reserve')
  await s.t.mutation(materializeDue, { userId: OWNER.tokenIdentifier, through: Date.now() })
  const due = await s.owner.query(api.learnAdaptiveCanvas.listDueChecks, {})
  expect(due).toMatchObject({ status: 'available', checks: [{ assessmentOpportunityId: replaced.assessmentOpportunityId }] })
  if (due.status !== 'available' || !due.checks[0]) throw new Error('Expected reserve discovery')
  const check = due.checks[0]
  expect(await s.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, { version: LEARN_V2_PUBLIC_API_VERSION,
    assessmentOpportunityId: replaced.assessmentOpportunityId, expectedRevision: 1, idempotencyKey: 'reserve_canvas_flow_bypass_1234567890' }))
    .toMatchObject({ status: 'unavailable', reasonCodes: ['flow_mismatch'] })
  const attached = await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: check.studySessionId,
    expectedSessionRevision: check.sessionRevision, idempotencyKey: 'reserve_attach_1234567890' })
  if (attached.kind !== 'attached') throw new Error('Expected attached reserve')
  const opportunity = (await slots()).find(row => row._id === replaced.assessmentOpportunityId)!
  const pins = opportunity.assessmentPins
  if (pins.kind !== 'measurement') throw new Error('Expected reserve pins')
  const item = (await s.t.run(ctx => ctx.db.get(pins.itemPins.itemId)))!
  const canvas = (await s.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId }))!
  expect(canvas).toMatchObject({ status: 'started', responsePrompt: item.prompt, declaredStimulus: item.declaredStimulus })
  const siblings = await s.t.run(ctx => ctx.db.query('learnMeasurementItems').withIndex('by_userId_and_familyId_and_familyRevision_and_formLabel', q =>
    q.eq('userId', OWNER.tokenIdentifier).eq('familyId', item.familyId).eq('familyRevision', item.familyRevision)).take(7))
  for (const sibling of siblings.filter(row => row._id !== item._id)) expect(JSON.stringify(canvas)).not.toContain(sibling.prompt)
  const sealed = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { threadId: attached.threadId, activityId: attached.activityId,
    studySessionId: check.studySessionId, expectedRevision: canvas.activity.planRevision!, expectedSessionRevision: canvas.session.revision,
    response: answer, confidence: 3, idempotencyKey: 'reserve_canvas_seal_1234567890' })
  if (sealed.kind !== 'accepted') throw new Error('Expected reserve seal')
  expect(await s.owner.action(api.learnAdaptive.submitResponse, { threadId: attached.threadId, activityId: attached.activityId,
    submissionId: sealed.submissionId, idempotencyKey: 'reserve_canvas_score_1234567890' })).toMatchObject({ kind: 'accepted', status: 'completed' })
  expect(await s.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })).toMatchObject({ status: 'feedback', assessment: { phase: 'scored_pass' } })
  expect(await s.t.run(ctx => ctx.db.get(assignment._id))).toMatchObject({ status: 'admitted', allocation: assignment.allocation })
  expect((await slots()).find(row => row._id === original._id)).toMatchObject({ originalSlot: true })
  expect((await slots()).find(row => row._id === opportunity._id)).toMatchObject({ originalSlot: false, checkSequence: 0, phase: 'scored_pass' })
})

function modelReply(awarded = true, key = 'private-criterion') {
  return new Response(JSON.stringify({ id: 'synthetic-execution', model: 'synthetic/model', choices: [{ index: 0, finish_reason: 'stop',
    message: { role: 'assistant', content: JSON.stringify({ criterionResults: [{ key, awarded }], misconceptionTags: [] }) } }],
    usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 }, openrouter_metadata: { requested: 'synthetic/model', strategy: 'direct', attempt: 1,
      endpoints: { available: [{ provider: 'Synthetic Provider', model: 'synthetic/model', selected: true }] }, pipeline: [] } }))
}

test.each(['pilot', 'entitlement', 'source', 'protocol'] as const)('due Canvas discovery and attachment recheck %s before a new grant', async gate => {
  const s = await fixture()
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { endsAt: new Date(NOW + 40 * 86_400_000).toISOString() })
  const cold = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)
  expect(cold.kind).toBe('accepted')
  const day7 = (await s.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').take(8))).find(row => row.horizonDays === 7)!
  vi.setSystemTime(day7.openAt + 1000)
  await s.t.mutation(materializeDue, { userId: OWNER.tokenIdentifier, through: Date.now() })
  const check = (await s.owner.query(api.learnAdaptiveCanvas.listDueChecks, {})).checks[0]!
  const before = await s.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(8))
  if (gate === 'pilot') Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { pilotApproved: false })
  if (gate === 'protocol') policy.protocol = null
  await s.t.run(async ctx => {
    if (gate === 'source') await ctx.db.patch(s.family.graph.sourceSnapshotId, { evidencePurgedAt: Date.now() })
    if (gate === 'entitlement') {
      const user = (await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', OWNER.tokenIdentifier)).unique())!
      await ctx.db.patch(user._id, { learnAdaptiveExperienceEntitlement: { enabled: false, updatedAt: Date.now() } })
    }
  })
  const attach = { studySessionId: check.studySessionId, expectedSessionRevision: check.sessionRevision, idempotencyKey: 'revoked_due_canvas_grant_1234567890' }
  if (gate === 'entitlement') {
    await expect(s.owner.query(api.learnAdaptiveCanvas.listDueChecks, {})).rejects.toThrow(/access denied/)
    await expect(s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, attach)).rejects.toThrow(/access denied/)
  } else {
    expect(await s.owner.query(api.learnAdaptiveCanvas.listDueChecks, {})).toMatchObject({ status: 'unavailable', checks: [] })
    expect(await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, attach)).toMatchObject({ kind: 'not_admitted' })
  }
  expect(await s.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(8))).toEqual(before)
})

test('fresh Canvas preparation atomically binds its flow and enrollment without granting or disclosing an item', async () => {
  const s = await fixture({ prepare: false, attach: false })
  expect(await s.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').take(8))).toEqual([])
  const prepared = await s.owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, s.prepare)
  expect(prepared).toMatchObject({ kind: 'prepared' })
  expect(await s.owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, s.prepare)).toEqual(prepared)
  await expect(s.owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, { ...s.prepare, expectedSessionRevision: 3 })).rejects.toThrow('Idempotency key was already used')
  expect(await s.owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, { ...s.prepare, idempotencyKey: 'second_prepare_tab_1234567890' })).toEqual(prepared)
  expect(JSON.stringify(prepared)).not.toMatch(/Hypothetical|PRIVATE|prompt|stimulus/)
  await s.t.run(async ctx => {
    expect(await ctx.db.query('learnMeasurementAssignments').take(8)).toMatchObject([{ status: 'admitted', flow: 'v2_canvas', entryPoint: 'canvas' }])
    const opportunities = await ctx.db.query('learnAssessmentOpportunities').take(8)
    expect(opportunities).toHaveLength(1)
    expect(opportunities[0]).toMatchObject({ purpose: { kind: 'measurement_cold' }, phase: 'ready', contextPins: { kind: 'session', canvas: expect.any(Object) } })
    expect(opportunities[0]).not.toHaveProperty('deliveryGrantId')
    const session = (await ctx.db.get(opportunities[0]!.contextPins.kind === 'session' ? opportunities[0]!.contextPins.studySessionId : s.f.studySessionId))!
    expect(session.assessmentOpportunityId).toBe(opportunities[0]!._id)
    expect(session.status).toBe('ready')
    const content = await ctx.db.get(opportunities[0]!.contextPins.kind === 'session' ? opportunities[0]!.contextPins.sessionContentId : s.prepared.sessionContentId)
    expect(content).toMatchObject({ assessmentOpportunityId: opportunities[0]!._id, assessmentPurpose: 'measurement_cold' })
    expect(await ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', OWNER.tokenIdentifier).eq('sessionContentId', content!._id)).take(8)).toEqual([])
    expect(await ctx.db.query('learningThreads').take(8)).toHaveLength(1)
    expect(await ctx.db.query('learningThreadActivities').take(8)).toHaveLength(1)
    expect(await ctx.db.query('learnAssessmentExposures').take(8)).toEqual([])
  })
  if (prepared.kind !== 'prepared') throw new Error('Expected preparation')
  expect(await s.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, { version: LEARN_V2_PUBLIC_API_VERSION,
    assessmentOpportunityId: prepared.assessmentOpportunityId, expectedRevision: 1, idempotencyKey: 'prepared_today_bypass_1234567890' })).toMatchObject({ status: 'unavailable', reasonCodes: ['flow_mismatch'] })
  expect(await s.owner.query(api.learnV2Assessments.getAssessment, { version: LEARN_V2_PUBLIC_API_VERSION,
    assessmentOpportunityId: prepared.assessmentOpportunityId })).toMatchObject({ status: 'unavailable' })
})

test.each(['predates_catalog', 'started_content'] as const)('Canvas preparation preserves the original session history: %s', async history => {
  const s = await fixture({ prepare: false, attach: false })
  await s.t.run(async ctx => {
    const source = (await ctx.db.get(s.family.graph.studySessionId))!
    if (history === 'predates_catalog') await ctx.db.patch(s.family.graph.catalogId, { createdAt: source._creationTime + 1 })
    else await ctx.db.patch(source._id, { startedSessionContentId: s.prepared.sessionContentId, startedSessionContentRevision: 1 })
  })
  vi.setSystemTime(Date.now() + 1000)
  expect(await s.owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, s.prepare)).toMatchObject({ kind: 'not_admitted' })
  expect(await s.t.run(ctx => ctx.db.query('learnMeasurementAssignments').take(2)))
    .toEqual([expect.objectContaining({ status: 'not_admitted', historyStatus: history === 'predates_catalog' ? 'unknown' : 'returning' })])
  expect(await s.t.run(ctx => ctx.db.query('studySessions').take(3))).toHaveLength(1)
  expect(await s.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').take(2))).toEqual([])
})

test('Canvas cold preserves assistance history from the original instructional session', async () => {
  const s = await fixture({ prepare: false, attach: false })
  const hintAt = NOW - 1000
  await s.t.run(ctx => ctx.db.patch(s.family.graph.studySessionId, { assistanceRevision: 1, substantiveHintUsedAt: hintAt }))
  expect(await s.owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, s.prepare)).toMatchObject({ kind: 'prepared' })
  const attached = await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, s.attach)
  if (attached.kind !== 'attached') throw new Error(JSON.stringify(attached))
  const canvas = (await s.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId }))!
  const receipt = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { threadId: attached.threadId,
    activityId: attached.activityId, studySessionId: canvas.session.studySessionId, expectedRevision: canvas.activity.planRevision!,
    expectedSessionRevision: canvas.session.revision, response: answer, confidence: 3, idempotencyKey: 'canvas_cold_prior_assistance_12345' })
  if (receipt.kind !== 'accepted') throw new Error(JSON.stringify(receipt))
  expect(await s.t.run(ctx => ctx.db.get(receipt.submissionId))).toMatchObject({
    assistanceSnapshot: { state: 'assisted', assistanceRevision: 1, substantiveHintUsedAt: hintAt },
    validitySnapshot: { measurementEligible: false } })
})

test('an open Canvas cold check still blocks teaching from the preserved instructional session', async () => {
  const s = await fixture({ attach: false })
  const before = await s.t.run(ctx => ctx.db.get(s.family.graph.studySessionId))
  expect(await s.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, {
    studySessionId: s.family.graph.studySessionId, idempotencyKey: 'canvas_cold_teaching_lock_12345' }))
    .toMatchObject({ value: { assessment: { kind: 'blocked', reasonCode: 'flow_mismatch' },
      blocks: [], claims: [], supports: [], delivered: null } })
  expect(await s.t.run(ctx => ctx.db.get(s.family.graph.studySessionId))).toEqual(before)
})

test('Canvas cold keeps its exact session and remains playable through a plan reflow', async () => {
  const s = await fixture({ attach: false })
  const before = (await s.t.run(ctx => ctx.db.get(s.f.studySessionId)))!
  expect(before._id).not.toBe(s.family.graph.studySessionId)
  await s.t.run(ctx => seedFixedCheckPlan(ctx, OWNER.tokenIdentifier, s.family.graph, Date.now()))
  const reflow = await s.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: s.f.studyPlanRevisionId,
    expectedPlanRecordRevision: 1, idempotencyKey: 'canvas_cold_reflow_1234567890' })
  expect(reflow.preservedSessionIds).toContain(before._id)
  expect(await s.t.run(ctx => ctx.db.get(before._id))).toEqual(before)
  const attached = await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { ...s.attach, studySessionId: before._id })
  if (attached.kind !== 'attached') throw new Error(JSON.stringify(attached))
  const canvas = (await s.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId }))!
  expect(canvas.responsePrompt).toBeTruthy()
  const receipt = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { threadId: attached.threadId,
    activityId: attached.activityId, studySessionId: canvas.session.studySessionId, expectedRevision: canvas.activity.planRevision!,
    expectedSessionRevision: canvas.session.revision, response: answer, confidence: 3, idempotencyKey: 'canvas_cold_reflow_accept_12345' })
  expect(receipt).toMatchObject({ kind: 'accepted' })
  expect(await s.t.run(ctx => ctx.db.get(before._id))).toMatchObject({ status: 'completed', revision: canvas.session.revision })
})

test.each([false, true])('Today enrollment ignores an ordinary Canvas attachment with Canvas in protocol=%s', async canvasAllowed => {
  const s = await fixture({ prepare: false, attach: false })
  policy.responses = false
  expect(await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, s.attach)).toMatchObject({ kind: 'attached' })
  policy.responses = true
  policy.protocol = { ...policy.protocol as ReturnType<typeof learnMeasurementProtocolSchema.parse>,
    flows: canvasAllowed ? ['v2_today', 'v2_canvas'] : ['v2_today'] }
  const started = await s.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: s.f.studySessionId,
    expectedSessionRevision: 2, expectedContentRevision: 1, entryPoint: 'today', idempotencyKey: 'explicit_today_flow_1234567890' })
  expect(started).toMatchObject({ status: 'assessment', deliveryGrant: { status: 'granted' } })
  const assignment = await s.t.run(ctx => ctx.db.query('learnMeasurementAssignments').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).unique())
  expect(assignment).toMatchObject({ status: 'admitted', flow: 'v2_today', entryPoint: 'today' })
})

test.each(['responses', 'delivery', 'enrollment', 'protocol', 'pilot', 'entitlement', 'v2_entitlement', 'flow', 'history', 'source'] as const)('fresh Canvas preparation keeps %s admission conjunctive', async gate => {
  const s = await fixture({ prepare: false, attach: false })
  if (gate === 'responses' || gate === 'delivery' || gate === 'enrollment') policy[gate] = false
  else if (gate === 'protocol') policy.protocol = null
  else if (gate === 'pilot') Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { pilotApproved: false })
  else if (gate === 'flow') policy.protocol = { ...learnMeasurementProtocolSchema.parse(policy.protocol), flows: ['v2_today'] }
  else await s.t.run(async ctx => {
    const user = (await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', OWNER.tokenIdentifier)).unique())!
    if (gate === 'entitlement') await ctx.db.patch(user._id, { learnAdaptiveExperienceEntitlement: { enabled: false, updatedAt: NOW } })
    if (gate === 'v2_entitlement') await ctx.db.patch(user._id, { learnV2Entitlement: { enabled: false, updatedAt: NOW } })
    if (gate === 'history') await ctx.db.patch(s.family.graph.catalogId, { historyCompleteness: 'unknown' })
    if (gate === 'source') await ctx.db.patch(s.family.graph.sourceSnapshotId, { evidencePurgedAt: NOW })
  })
  if (gate === 'entitlement' || gate === 'v2_entitlement') await expect(s.owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, s.prepare)).rejects.toThrow(/access denied/)
  else expect(await s.owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, s.prepare)).toMatchObject({ kind: 'not_admitted', observations: 'no_observations' })
  await s.t.run(async ctx => {
    expect(await ctx.db.query('learnAssessmentExposures').take(8)).toEqual([])
    expect(await ctx.db.query('learnAssessmentOpportunities').take(8)).toEqual([])
    expect(await ctx.db.query('learningThreads').take(8)).toEqual([])
    expect(await ctx.db.query('learningThreadActivities').take(8)).toEqual([])
    expect(await ctx.db.query('sessionContent').take(8)).toHaveLength(1)
    expect(await ctx.db.get(s.f.studySessionId)).not.toHaveProperty('assessmentOpportunityId')
  })
})

test('fresh Canvas preparation rejects anonymous and foreign callers', async () => {
  const s = await fixture({ prepare: false, attach: false })
  await expect(s.t.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, s.prepare)).rejects.toThrow(/access denied/)
  await expect(s.t.withIdentity({ tokenIdentifier: 'https://foreign.example|publisher', subject: OWNER.subject }).mutation(api.learnAdaptiveCanvas.prepareCanvasSession, s.prepare)).rejects.toThrow(/access denied/)
  await expect(s.t.query(api.learnAdaptiveCanvas.listDueChecks, {})).rejects.toThrow(/access denied/)
  await expect(s.t.withIdentity({ tokenIdentifier: 'https://foreign.example|publisher', subject: OWNER.subject }).query(api.learnAdaptiveCanvas.listDueChecks, {})).rejects.toThrow(/access denied/)
  expect(await s.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').take(8))).toEqual([])
})

test('the existing Canvas attachment entry prepares a fresh session before its first grant', async () => {
  const s = await fixture({ prepare: false, attach: false })
  const attached = await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, s.attach)
  expect(attached).toMatchObject({ kind: 'attached', replayed: false })
  await expect(s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { ...s.attach, expectedSessionRevision: 3 })).rejects.toThrow('Idempotency key was already used')
  await s.t.run(async ctx => {
    expect(await ctx.db.query('learnMeasurementAssignments').take(8)).toMatchObject([{ flow: 'v2_canvas', status: 'admitted' }])
    expect(await ctx.db.query('learnAssessmentOpportunities').take(8)).toHaveLength(1)
    expect(await ctx.db.query('learningThreadActivities').take(8)).toHaveLength(1)
    expect(await ctx.db.query('learnAssessmentExposures').take(8)).toMatchObject([{ provenanceVersion: 'learn-v2.assessment-delivery.canvas.v1' }])
  })
})

test('rubric grading receives the exact delivered declared stimulus and rejects changed stimulus pins before dispatch', async () => {
  const s = await fixture()
  const delivered = await s.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: s.stage.threadId })
  expect(delivered?.declaredStimulus).toMatch(/groups=\d+, size=\d+/)
  expect(delivered?.responsePrompt).toContain('the declared givens')
  const accepted = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)
  if (accepted.kind !== 'accepted') throw new Error('Expected sealed response')
  const input = await s.owner.query(internal.learnV2Mastery.getSealedMasteryScoringInput, { tokenIdentifier: OWNER.tokenIdentifier, submissionId: accepted.submissionId })
  expect(input.scoringInput.declaredStimulus).toBe(delivered!.declaredStimulus)
  const network = vi.fn(async (_url: unknown, options: RequestInit | undefined) => {
    const body = JSON.parse(String(options?.body)) as { messages: Array<{ content: string }> }
    const payload = JSON.parse(body.messages[1]!.content) as { declaredStimulus: string }
    expect(payload.declaredStimulus).toBe(delivered!.declaredStimulus)
    return modelReply()
  })
  vi.stubGlobal('fetch', network)
  expect(await s.owner.action(api.learnAdaptive.submitResponse, { threadId: s.stage.threadId, activityId: s.stage.activityId,
    submissionId: accepted.submissionId, idempotencyKey: 'canvas_stimulus_score_1234567890' })).toMatchObject({ kind: 'accepted', status: 'completed' })
  expect(network).toHaveBeenCalledTimes(1)
  const changed = await fixture()
  const sealed = await changed.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, changed.stage)
  if (sealed.kind !== 'accepted') throw new Error('Expected sealed response')
  await changed.t.run(ctx => ctx.db.patch(changed.prepared.itemId, { declaredStimulus: 'Changed hypothetical givens.' }))
  await expect(changed.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: sealed.submissionId, idempotencyKey: 'changed_stimulus_score_1234567890' })).rejects.toThrow(/stimulus pins mismatch/)
  expect(network).toHaveBeenCalledTimes(1)
})

test('Canvas seals one canonical body and replays a lost receipt without staging another copy', async () => {
  const s = await fixture()
  const receipt = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)
  expect(receipt).toMatchObject({ kind: 'accepted', phase: 'submitted_sealed' })
  expect(await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)).toEqual(receipt)
  expect(await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { ...s.stage, response: 'Changed answer' })).toMatchObject({ kind: 'rejected', reasonCode: 'idempotency_conflict' })
  expect(await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { ...s.stage, idempotencyKey: 'another_canvas_command_1234567890' })).toMatchObject({ kind: 'rejected', reasonCode: 'already_accepted' })
  expect(JSON.stringify(receipt)).not.toContain(answer)
  await s.t.run(async ctx => {
    expect(await ctx.db.query('learnResponseBodies').take(8)).toMatchObject([{ payload: { text: answer } }])
    expect(await ctx.db.query('learnResponses').take(8)).toHaveLength(1)
    expect(await ctx.db.query('masteryAttempts').take(8)).toHaveLength(0)
    expect(await ctx.db.get(s.f.activityId!)).not.toHaveProperty('submittedResponse')
    expect((await ctx.db.get(s.stage.threadId))!.revision).toBe(1)
  })
})

test.each(['missing_claim', 'revoked_support'] as const)('measurement acceptance fails closed for %s without teaching-claim fallback', async damage => {
  const s = await fixture()
  await s.t.run(async ctx => {
    if (damage === 'missing_claim') {
      const claims = await ctx.db.query('learnMeasurementClaims').withIndex('by_userId_and_itemId_and_order', q => q.eq('userId', OWNER.tokenIdentifier).eq('itemId', s.prepared.itemId)).take(33)
      for (const claim of claims) await ctx.db.delete(claim._id)
    }
    else await ctx.db.patch(s.f.rows.learnMeasurementSupports, { evidenceStatus: 'evidence_unavailable', invalidatedAt: NOW })
  })
  expect(await s.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, s.canonical)).toMatchObject({ kind: 'rejected', reasonCode: 'evidence_unavailable' })
  expect(await s.t.run(ctx => ctx.db.query('learnResponseBodies').take(8))).toEqual([])
})

test.each(['grant', 'item_revision', 'claim_revision', 'claim_digest', 'unknown_version'] as const)('Canvas refuses a self-consistent plan with a mismatched %s reference', async mismatch => {
  const s = await fixture()
  await s.t.run(async ctx => {
    const activity = (await ctx.db.get(s.f.activityId!))!
    const reference = readAdaptiveAssessmentReference(activity)!
    if (mismatch === 'grant') reference.deliveryGrantId = null
    if (mismatch === 'item_revision') reference.item.itemRevision++
    if (mismatch === 'claim_revision') reference.claims[0]!.revision++
    if (mismatch === 'claim_digest') reference.claims[0]!.claimDigest = `sha256:${'b'.repeat(64)}`
    const plan = await composeAdaptiveActivityPlan({ ...storedPlan(activity), primitiveSequence: [], assessmentReference: reference,
      replacesActivityId: undefined })
    let snapshot = plan.canonicalInputSnapshot
    if (mismatch === 'unknown_version') snapshot = snapshot.replace(ADAPTIVE_ASSESSMENT_PLAN_VERSION, 'learn-adaptive.assessment-plan.unknown')
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot)))
    await ctx.db.patch(activity._id, { canonicalInputSnapshot: snapshot, inputDigest: `sha256:${[...hash].map(value => value.toString(16).padStart(2, '0')).join('')}` })
  })
  const value = await s.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: s.stage.threadId })
  expect(value).toBeNull()
  expect(await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)).toMatchObject({ kind: 'rejected', reasonCode: 'unavailable' })
  expect(await s.t.run(ctx => ctx.db.query('learnResponseBodies').take(8))).toEqual([])
})

test('Canvas and direct Today acceptance race on one opportunity and retain Canvas attribution', async () => {
  const s = await fixture()
  const results = await Promise.all([s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage),
    s.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, s.canonical)])
  expect(results.filter(row => row.kind === 'accepted')).toHaveLength(1)
  await s.t.run(async ctx => {
    const responses = await ctx.db.query('learnResponses').take(8)
    expect(responses).toHaveLength(1)
    expect(responses[0]).toMatchObject({ flow: 'canvas', contextPins: { canvas: { threadId: s.stage.threadId, activityId: s.f.activityId! } } })
    expect(await ctx.db.query('learnResponseBodies').take(8)).toHaveLength(1)
  })
})

test('Canvas scores only its saved ID and preserves one authoritative attempt across routes and replay', async () => {
  const s = await fixture()
  const network = vi.fn(async () => modelReply())
  vi.stubGlobal('fetch', network)
  const receipt = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)
  if (receipt.kind !== 'accepted') throw new Error(JSON.stringify(receipt))
  const request = { threadId: s.stage.threadId, activityId: s.stage.activityId, submissionId: receipt.submissionId, idempotencyKey: 'canvas_score_1234567890' }
  expect(await s.owner.action(api.learnAdaptive.submitResponse, request)).toMatchObject({ kind: 'accepted', status: 'completed' })
  expect(await s.owner.action(api.learnAdaptive.submitResponse, request)).toMatchObject({ kind: 'accepted', status: 'completed', replayed: true })
  expect(await s.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION, submissionId: receipt.submissionId,
    idempotencyKey: 'today_score_replay_1234567890' })).toMatchObject({ status: 'scored' })
  expect(network).toHaveBeenCalledTimes(1)
  await s.t.run(async ctx => {
    const attempts = await ctx.db.query('masteryAttempts').take(8)
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({ kind: 'measurement_cold', submissionId: receipt.submissionId })
    expect(attempts[0]).not.toHaveProperty('response')
    expect(await ctx.db.query('masteryRecords').take(8)).toHaveLength(0)
    expect(await ctx.db.get(s.f.studySessionId)).toMatchObject({ status: 'completed', revision: 3 })
    expect(await ctx.db.get(s.family.graph.studySessionId)).toMatchObject({ status: 'ready', revision: 2 })
  })
})

test.each(['pilot', 'entitlement'] as const)('direct V2 scoring cannot bypass denied Canvas %s', async denial => {
  const s = await fixture()
  const receipt = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)
  if (receipt.kind !== 'accepted') throw new Error(JSON.stringify(receipt))
  if (denial === 'pilot') Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { pilotApproved: false })
  else await s.t.run(async ctx => {
    const user = (await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', OWNER.tokenIdentifier)).unique())!
    await ctx.db.patch(user._id, { learnAdaptiveExperienceEntitlement: { enabled: false, updatedAt: NOW } })
  })
  const network = vi.fn(async () => modelReply())
  vi.stubGlobal('fetch', network)
  await expect(s.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION, submissionId: receipt.submissionId,
    idempotencyKey: 'direct_v2_denied_1234567890' })).rejects.toThrow()
  expect(network).not.toHaveBeenCalled()
})

test('a lost scoring response keeps the saved answer in reconciliation without redispatch', async () => {
  const s = await fixture()
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('lost provider receipt') }))
  const receipt = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)
  if (receipt.kind !== 'accepted') throw new Error(JSON.stringify(receipt))
  const request = { threadId: s.stage.threadId, activityId: s.stage.activityId, submissionId: receipt.submissionId, idempotencyKey: 'canvas_lost_score_1234567890' }
  expect(await s.owner.action(api.learnAdaptive.submitResponse, request)).toMatchObject({ kind: 'blocked', code: 'reconciliation_required', retryable: false })
  expect(await s.owner.action(api.learnAdaptive.submitResponse, request)).toMatchObject({ kind: 'blocked', code: 'reconciliation_required', retryable: false })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(await s.t.run(ctx => ctx.db.query('masteryAttempts').take(8))).toHaveLength(0)
  expect(await s.t.run(ctx => ctx.db.query('learnResponseBodies').take(8))).toHaveLength(1)
})

test('disabled saved-ID scoring and assessment Canvas reads disclose no check body or teaching', async () => {
  const s = await fixture()
  const receipt = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)
  if (receipt.kind !== 'accepted') throw new Error(JSON.stringify(receipt))
  policy.responses = false
  const network = vi.fn(async () => modelReply())
  vi.stubGlobal('fetch', network)
  expect(await s.owner.action(api.learnAdaptive.submitResponse, { threadId: s.stage.threadId, activityId: s.stage.activityId,
    submissionId: receipt.submissionId, idempotencyKey: 'disabled_canvas_score_1234567890' })).toMatchObject({ kind: 'blocked', code: 'disabled' })
  for (const value of [await s.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: s.stage.threadId }),
    await s.owner.mutation(api.learnAdaptiveCanvas.getCanvasDelivery, { threadId: s.stage.threadId, idempotencyKey: 'disabled_canvas_read_1234567890' })]) {
    expect(JSON.stringify(value)).not.toMatch(/PRIVATE EXPLANATION|SIBLING-|private-answer-key|private-rubric-description/)
    expect(JSON.stringify(value)).not.toContain(s.prompt)
  }
  expect(network).not.toHaveBeenCalled()
  expect(await s.t.run(ctx => ctx.db.query('learnResponseBodies').take(8))).toHaveLength(1)
})

test('standalone diagnostics use a non-factual slot with the tighter byte limit and no V2 attempt', async () => {
  const t = convexTest({ schema, modules, transactionLimits: true })
  const owner = t.withIdentity(OWNER)
  const f = await t.run(ctx => seedMeasurementStorage(ctx, OWNER.tokenIdentifier))
  const slotId = await t.run(async ctx => {
    await ctx.db.insert('users', { tokenIdentifier: OWNER.tokenIdentifier, name: 'Learner', learnV2Entitlement: { enabled: true, updatedAt: NOW },
      learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: NOW } })
    await ctx.db.patch(f.threadId, { currentActivityId: f.activityId })
    const exposureId = await ctx.db.insert('learnAssessmentExposures', { ...f.base, threadId: f.threadId, activityId: f.activityId,
      purpose: 'practice', status: 'granted', projectionDigest: HASH, deliveryReceiptHash: HASH, serverTime: NOW,
      policyVersion: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, provenanceVersion: 'diagnostic.v1' })
    return await ctx.db.insert('learnResponseSlots', { ...f.base, scopeKind: 'standalone', threadId: f.threadId, activityId: f.activityId,
      threadRevision: 1, activityRevision: 1, activityContractVersion: 'learn-adaptive.activity-contract.v1', evidenceStatus: 'available',
      stage: 'diagnostic', slotKey: 'diagnostic.v1', blockId: 'diagnostic', promptDigest: HASH, promptRevision: 1, responseFormatVersion: 'text.v1',
      confidenceRequested: false, deliveryExposureId: exposureId, revision: 1, status: 'open' })
  })
  const request = { version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'diagnostic_response_1234567890',
    response: { target: { responseSlotId: slotId }, expectedRevision: 1, payload: { kind: 'text' as const, text: '私'.repeat(4001) } } }
  expect(await owner.mutation(api.learnV2Responses.acceptResponse, request)).toMatchObject({ kind: 'rejected', reasonCode: 'payload_too_large' })
  const receipt = await owner.mutation(api.learnV2Responses.acceptResponse, { ...request, idempotencyKey: 'diagnostic_valid_1234567890',
    response: { ...request.response, payload: { kind: 'text', text: 'What I currently know.' } } })
  expect(receipt).toMatchObject({ kind: 'accepted', phase: 'accepted' })
  if (receipt.kind !== 'accepted') throw new Error(JSON.stringify(receipt))
  const saved = await t.run(ctx => ctx.db.get(receipt.submissionId))
  expect(saved).toMatchObject({ scopeKind: 'standalone', responseSlotId: slotId })
  expect(saved).not.toHaveProperty('assessmentOpportunityId')
  expect(await t.run(ctx => ctx.db.query('masteryAttempts').take(8))).toEqual([])
})

test('contribution conversion rechecks held-out lineage and preserves recorded exposure', async () => {
  const t = convexTest({ schema, modules, transactionLimits: true })
  const owner = t.withIdentity(OWNER)
  const f = await t.run(ctx => seedMeasurementStorage(ctx, OWNER.tokenIdentifier))
  await t.run(ctx => ctx.db.insert('users', { tokenIdentifier: OWNER.tokenIdentifier, name: 'Learner', learnV2Entitlement: { enabled: true, updatedAt: NOW }, learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: NOW } }))
  const s = { t, owner, f }
  policy.responses = false
  const threadId = await s.t.run(ctx => ctx.db.insert('learningThreads', { userId: OWNER.tokenIdentifier, authorityKind: 'standalone',
    originalNeed: 'Plan practice', intent: 'explore', availableTime: '15', sourceScope: { kind: 'none' }, evidenceState: 'none',
    lifecycle: 'ready', revision: 1, createdAt: NOW, updatedAt: NOW }))
  const source = await s.owner.query(api.learnAdaptive.inspectContributionSource, { source: { feature: 'documents', id: s.f.documentId } })
  if (!source || source.status !== 'available') throw new Error('Expected legacy source')
  const contribution = await s.owner.mutation(api.learnAdaptive.recordContribution, { threadId, source: { feature: 'documents', id: s.f.documentId, revision: source.revision },
    classification: 'unknown', contributionKind: 'context', metadata: {}, expectedRevision: 1, idempotencyKey: 'contribution_record_1234567890' })
  if (contribution.kind !== 'recorded') throw new Error(JSON.stringify(contribution))
  await s.t.run(async ctx => {
    const { _id: _id, _creationTime: _time, ...fields } = (await ctx.db.get(s.f.rows.learnArtifactLineages))!
    await ctx.db.insert('learnArtifactLineages', { ...fields, artifact: { kind: 'document', id: s.f.documentId },
      classification: 'measurement', derivation: 'original', originCount: 0, sourceCount: 0, caseCount: 0 })
  })
  const before = await s.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(20))
  policy.responses = true
  await expect(s.owner.mutation(api.learnAdaptive.convertContributionToActivity, { threadId, contributionId: contribution.contributionId,
    expectedRevision: contribution.revision, idempotencyKey: 'contribution_convert_1234567890' })).rejects.toThrow()
  expect(await s.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(20))).toEqual(before)
  expect(await s.t.run(ctx => ctx.db.query('learningThreadActivities').withIndex('by_userId_and_threadId_and_boundaryOrdinal', q =>
    q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).take(8))).toEqual([])
})

function expectSafeCanvas(value: unknown, s: Awaited<ReturnType<typeof fixture>>) {
  const text = JSON.stringify(value)
  for (const marker of ['PRIVATE', 'private-criterion', 'cited_explanation', 'scoringSpecId', 'supportManifestDigest', 'canonicalInputSnapshot']) expect(text).not.toContain(marker)
  for (const member of s.family.generated.members) if (member.prompt !== s.prompt) expect(text).not.toContain(member.prompt)
}

test('registered attachment grants once, projects only the delivered check, and recovers lost attachment receipts', async () => {
  const s = await fixture({ attach: false })
  expect(await s.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(8))).toEqual([])
  const attached = await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, s.attach)
  if (attached.kind !== 'attached') throw new Error(JSON.stringify(attached))
  expect(JSON.stringify(attached)).not.toContain(s.prompt)
  const canvas = await s.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })
  expect(canvas).toMatchObject({ status: 'started', responsePrompt: s.prompt, responseSpec: { kind: 'bounded_rubric' },
    assessment: { phase: 'test_open', submissionId: null }, activity: { primitive: { type: 'independent_application', props: { prompt: s.prompt } } } })
  expectSafeCanvas(canvas, s)
  const delivered = await s.owner.mutation(api.learnAdaptiveCanvas.getCanvasDelivery, { threadId: attached.threadId, idempotencyKey: 'canvas_check_read_1234567890' })
  expect(delivered.value).toEqual(canvas)
  expectSafeCanvas(delivered, s)
  await s.t.run(async ctx => {
    for (const row of await ctx.db.query('learnActivityCommandReceipts').take(8)) await ctx.db.delete(row._id)
    for (const row of await ctx.db.query('learnPlanCommandReceipts').take(8)) await ctx.db.delete(row._id)
  })
  expect(await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, s.attach)).toMatchObject({ kind: 'attached', threadId: attached.threadId, activityId: attached.activityId, replayed: true })
  expect(await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { ...s.attach, idempotencyKey: 'another_attach_tab_1234567890' })).toMatchObject({ threadId: attached.threadId, replayed: true })
  await s.t.run(async ctx => {
    const grants = await ctx.db.query('learnAssessmentExposures').take(8)
    expect(grants).toHaveLength(1)
    expect(grants[0]).toMatchObject({ provenanceVersion: 'learn-v2.assessment-delivery.canvas.v1', threadId: attached.threadId })
    expect(await ctx.db.query('learningThreads').take(8)).toHaveLength(1)
    const activities = await ctx.db.query('learningThreadActivities').take(8)
    expect(activities).toHaveLength(1)
    expect(activities[0]!.primitivePlan).toEqual([])
    expect(activities[0]!.evidenceReferences).toEqual([])
    const reference = readAdaptiveAssessmentReference(activities[0]!)!
    expect(reference).toMatchObject({ assessmentOpportunityId: s.prepared.opportunityId, deliveryGrantId: grants[0]!._id, item: { itemId: s.prepared.itemId } })
  })
})

test.each(['v2_canvas', 'v2_today'] as const)('real Today/Canvas delivery race keeps the assigned %s flow and consumes one grant', async flow => {
  const s = await fixture({ attach: false, flow })
  const [canvas, today] = await Promise.all([
    s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, s.attach),
    s.owner.mutation(api.learnV2Assessments.grantAssessmentDelivery, { ...s.reference, expectedRevision: 1, idempotencyKey: 'cross_route_today_1234567890' }),
  ])
  if (flow === 'v2_canvas') {
    expect(canvas).toMatchObject({ kind: 'attached' })
    expect(today).toMatchObject({ status: 'unavailable', reasonCodes: ['flow_mismatch'] })
  } else {
    expect(canvas).toMatchObject({ kind: 'not_admitted', observations: 'no_observations' })
    expect(today).toMatchObject({ status: 'granted' })
  }
  await s.t.run(async ctx => {
    const grants = await ctx.db.query('learnAssessmentExposures').take(8)
    expect(grants).toHaveLength(1)
    expect(grants[0]!.provenanceVersion).toBe(`learn-v2.assessment-delivery.${flow === 'v2_canvas' ? 'canvas' : 'today'}.v1`)
    expect(await ctx.db.query('learningThreads').take(8)).toHaveLength(flow === 'v2_canvas' ? 1 : 0)
    expect(await ctx.db.query('learnResponses').take(8)).toEqual([])
  })
})

test.each(['uuid', 'fallback'] as const)('actual Phase A %s attachment/staging key shapes cross the registered boundary', async shape => {
  const s = await fixture({ attach: false })
  const suffix = shape === 'uuid' ? crypto.randomUUID() : String(Date.now())
  const attached = await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { ...s.attach, idempotencyKey: `adaptive-ready-${suffix}` })
  if (attached.kind !== 'attached') throw new Error(JSON.stringify(attached))
  const stage = { threadId: attached.threadId, activityId: attached.activityId, studySessionId: s.f.studySessionId,
    expectedSessionRevision: 3, expectedRevision: 1, response: answer, confidence: 3,
    idempotencyKey: `adaptive-canvas-submit-${shape === 'uuid' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}` }
  expect(await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, stage)).toMatchObject({ kind: 'accepted', phase: 'submitted_sealed' })
  await expect(s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { ...stage, idempotencyKey: `adaptive-canvas-submit:${suffix}` })).rejects.toThrow(/URL-safe/)
})

test.each(['numeric', 'keyed', 'ordered'] as const)('unsupported %s Canvas checks cannot consume a grant', async format => {
  const s = await fixture({ attach: false, rubric: false, format })
  expect(await s.owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, s.prepare)).toEqual({ kind: 'not_admitted', observations: 'no_observations', reasonCode: 'response_format_unavailable' })
  expect(await s.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(8))).toEqual([])
  expect(await s.t.run(ctx => ctx.db.query('learningThreads').take(8))).toEqual([])
})

test.each(['preparing', 'invalid', 'cancelled', 'abandoned', 'outside_window', 'protocol', 'pilot', 'source'] as const)('unavailable attachment (%s) retains its preparation without a grant or extra wrapper', async state => {
  const s = await fixture({ attach: false })
  if (state === 'pilot') Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { pilotApproved: false })
  else if (state === 'protocol') policy.protocol = null
  else await s.t.run(async ctx => {
    if (state === 'source') await ctx.db.patch(s.family.graph.sourceSnapshotId, { evidencePurgedAt: NOW })
    else if (state === 'outside_window') await ctx.db.patch(s.prepared.opportunityId, { closeAt: NOW })
    else await ctx.db.patch(s.prepared.opportunityId, { phase: state })
  })
  const result = await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, s.attach)
  expect(result).toMatchObject({ kind: 'not_admitted', observations: 'no_observations' })
  expectSafeCanvas(result, s)
  await s.t.run(async ctx => {
    expect(await ctx.db.query('learnAssessmentExposures').take(8)).toEqual([])
    expect(await ctx.db.query('learningThreads').take(8)).toHaveLength(1)
    expect((await ctx.db.get(s.prepared.opportunityId))!.contextPins).toHaveProperty('canvas')
    expect((await ctx.db.get(s.f.studySessionId))!.status).toBe('ready')
  })
})

const sealedPhases = ['submitted_sealed', 'scoring_pending', 'retryable_failure', 'reconciliation_required', 'scored_pass', 'scored_fail', 'invalid', 'cancelled', 'abandoned'] as const
test.each(sealedPhases)('Canvas read/delivery/attachment replay at %s never releases teaching or private grading', async phase => {
  const s = await fixture()
  const receipt = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)
  if (receipt.kind !== 'accepted') throw new Error(JSON.stringify(receipt))
  await s.t.run(ctx => ctx.db.patch(s.prepared.opportunityId, { phase }))
  for (const value of [await s.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: s.stage.threadId }),
    await s.owner.mutation(api.learnAdaptiveCanvas.getCanvasDelivery, { threadId: s.stage.threadId, idempotencyKey: 'phase_read_replay_1234567890' }),
    await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, s.attach)]) expectSafeCanvas(value, s)
  expect(await s.t.run(ctx => ctx.db.query('learnResponses').take(8))).toHaveLength(1)
  expect(await s.t.run(ctx => ctx.db.query('learnResponseBodies').take(8))).toHaveLength(1)
  expect(await s.t.run(ctx => ctx.db.query('masteryAttempts').take(8))).toHaveLength(0)
})

test('legacy factual attachment is not a non-factual diagnostic or prospective measurement', async () => {
  const s = await fixture({ attach: false })
  await s.t.run(async ctx => {
    await ctx.db.patch(s.f.studySessionId, { assessmentPurpose: undefined, assessmentOpportunityId: undefined })
    await ctx.db.patch(s.prepared.sessionContentId, { assessmentPurpose: undefined, assessmentOpportunityId: undefined })
  })
  expect(await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, s.attach)).toMatchObject({ kind: 'not_admitted', observations: 'no_observations' })
  expect(await s.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(8))).toEqual([])
})

async function purposeFixture(kind: 'measurement_cold' | 'measurement_delayed' | 'retained_transfer' | 'independent_application') {
  const s = await fixture({ attach: false })
  let selectedPrompt = s.prompt
  await s.t.run(async ctx => {
    const opportunity = (await ctx.db.get(s.prepared.opportunityId))!
    if (opportunity.assessmentPins.kind !== 'measurement') throw new Error('Expected item')
    if (kind === 'measurement_delayed') {
      const assignment = (await ctx.db.get(opportunity.assignmentId!))!
      if (assignment.status !== 'admitted' || assignment.allocation.kind !== 'three_case') throw new Error('Expected full assignment')
      const item = (await ctx.db.get(assignment.allocation.day7.itemId))!
      const clock = measurementClock(learnMeasurementProtocolSchema.parse(policy.protocol), { at: NOW - 7 * 86_400_000, eventId: 'fixture-anchor' }, 'UTC', 7)
      await ctx.db.patch(opportunity._id, { purpose: { kind, assignmentId: assignment._id, horizonDays: 7, clock },
        assessmentPins: { kind: 'measurement', itemPins: assignment.allocation.day7 }, horizonDays: 7, openAt: clock.openAt, closeAt: clock.closeAt })
      selectedPrompt = item.prompt!
    } else if (kind !== 'measurement_cold') {
      const objective = (await ctx.db.get(s.family.graph.objectiveId))!
      const rubric = objective.assessmentContract
      await ctx.db.patch(s.prepared.sessionContentId, { assessmentRubricSnapshot: JSON.stringify(rubric) })
      await ctx.db.insert('sessionContentBlocks', { userId: OWNER.tokenIdentifier, sessionContentId: s.prepared.sessionContentId, order: 1,
        kind: kind === 'independent_application' ? 'independent_application' : 'transfer_challenge', content: selectedPrompt })
      const claimId = await ctx.db.insert('sessionContentClaims', { userId: OWNER.tokenIdentifier, sessionContentId: s.prepared.sessionContentId,
        order: 0, claim: 'PRIVATE TEACHING CLAIM', verifierVersion: 'fixture.verifier.v1', confidence: 1 })
      await ctx.db.insert('learnClaimSupports', { userId: OWNER.tokenIdentifier, sessionContentClaimId: claimId, sourceExcerptId: s.family.graph.sourceExcerptId,
        sourceSnapshotId: s.family.graph.sourceSnapshotId, entailment: 'entailed', conflictStatus: 'clear', evidenceStatus: 'evidence_available', verifierVersion: 'fixture.verifier.v1', confidence: 1 })
      const basisAttemptId = await ctx.db.insert('masteryAttempts', { userId: OWNER.tokenIdentifier, objectiveId: s.family.graph.objectiveId,
        blueprintRevisionId: s.family.graph.blueprintRevisionId, attemptedAt: NOW - 7 * 86_400_000, idempotencyKey: 'fixture-first-independent', serverScorePercent: 100, kind: 'independent_application' })
      const clock = measurementClock(learnMeasurementProtocolSchema.parse(policy.protocol), { at: NOW - 7 * 86_400_000, eventId: basisAttemptId }, 'UTC', 7)
      if (kind === 'retained_transfer') await ctx.db.insert('masteryRecords', { userId: OWNER.tokenIdentifier, objectiveId: s.family.graph.objectiveId,
        blueprintRevisionId: s.family.graph.blueprintRevisionId, scopeKey: await masteryScopeKey(OWNER.tokenIdentifier, s.family.graph.blueprintRevisionId, s.family.graph.objectiveId), recordRevision: 1, state: 'independent', firstIndependentPassAt: NOW - 7 * 86_400_000,
        firstIndependentLocalDate: localDateAt(NOW - 7 * 86_400_000, 'UTC'), firstIndependentTimezone: 'UTC' })
      await ctx.db.patch(opportunity._id, { assignmentId: undefined, purpose: kind === 'retained_transfer' ? { kind, basisAttemptId, clock } : { kind },
        assessmentPins: { kind: 'session_application', caseId: opportunity.assessmentPins.itemPins.caseId, promptDigest: await privacyDigest(selectedPrompt),
          rubricVersion: 'learn-v2.assessment.v1', rubricDigest: await privacyDigest(rubric), supportManifestDigest: HASH },
        ...(kind === 'retained_transfer' ? { openAt: clock.openAt, closeAt: clock.closeAt } : {}) })
    }
    await ctx.db.patch(s.f.studySessionId, { assessmentPurpose: kind, placementKind: kind === 'retained_transfer' ? 'retained_review' : 'learning' })
    await ctx.db.patch(s.prepared.sessionContentId, { assessmentPurpose: kind })
  })
  if (kind === 'measurement_delayed') await s.t.run(async ctx => {
    const activity = (await ctx.db.query('learningThreadActivities').withIndex('by_userId_and_sessionContentId_and_updatedAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('sessionContentId', s.prepared.sessionContentId)).first())!
    const opportunity = (await ctx.db.get(s.prepared.opportunityId))!
    if (opportunity.assessmentPins.kind !== 'measurement') throw new Error('Expected measurement')
    const item = (await ctx.db.get(opportunity.assessmentPins.itemPins.itemId))!
    if (item.responseSpec.kind !== 'bounded_rubric') throw new Error('Expected rubric')
    const claims = await ctx.db.query('learnMeasurementClaims').withIndex('by_userId_and_itemId_and_order', q => q.eq('userId', OWNER.tokenIdentifier).eq('itemId', item._id)).take(33)
    const reference = readAdaptiveAssessmentReference(activity)!
    const plan = await composeAdaptiveActivityPlan({ ...storedPlan(activity), replacesActivityId: undefined, primitiveSequence: [],
      assessmentReference: { ...reference, item: { itemId: item._id, itemRevision: item.revision, promptDigest: item.promptDigest }, responseSpec: item.responseSpec,
        claims: claims.map(claim => ({ claimId: claim._id, revision: claim.revision, claimDigest: claim.claimDigest })) } })
    await ctx.db.patch(activity._id, { canonicalInputSnapshot: plan.canonicalInputSnapshot, inputDigest: plan.inputDigest })
  })
  if (kind === 'retained_transfer' || kind === 'independent_application') {
    const definition = { configurationId: 'canvas.application.synthetic', configurationVersion: 'canvas.application.synthetic.v1', kind: 'legacy_baseline' as const,
      requestedModel: 'synthetic/model', endpoint: null, identity: { mappingVersion: 'synthetic.identity.v1', canonicalModel: 'synthetic/model',
        family: 'synthetic', snapshotAssurance: 'unknown' as const, verifiedReturnedModels: [] } }
    const saved = await sealLearnScorerConfiguration(definition)
    const registry = await createLearnScorerRegistry({ epoch: 'synthetic.epoch.v1', configurations: [{ definition, expectedDigest: saved.binding.configurationDigest }],
      legacyAllowlist: [definition.configurationId], prospectiveConfigurationId: null })
    policy.scorer = { registry, saved }
    await s.t.run(ctx => ctx.db.patch(s.prepared.opportunityId, { scoringBinding: saved.binding }))
  }
  const attached = await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { ...s.attach, studySessionId: s.f.studySessionId })
  if (attached.kind !== 'attached') throw new Error(JSON.stringify(attached))
  return { ...s, prompt: selectedPrompt, attached, stage: { threadId: attached.threadId, activityId: attached.activityId, studySessionId: s.f.studySessionId,
    expectedSessionRevision: 3, expectedRevision: 1, response: answer, confidence: 3, idempotencyKey: `adaptive-canvas-submit-${crypto.randomUUID()}` } }
}

test.each((['measurement_cold', 'measurement_delayed', 'retained_transfer', 'independent_application'] as const).flatMap(kind => [true, false].map(awarded => ({ kind, awarded }))))('registered $kind Canvas attach/read/stage/score/replay with awarded=$awarded shares one canonical result', async ({ kind, awarded }) => {
  const s = await purposeFixture(kind)
  const network = vi.fn(async () => modelReply(awarded, kind === 'retained_transfer' || kind === 'independent_application' ? 'accuracy' : 'private-criterion'))
  vi.stubGlobal('fetch', network)
  const initial = await s.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: s.stage.threadId })
  expect(initial).toMatchObject({ status: 'started', responsePrompt: s.prompt })
  expectSafeCanvas(initial, s)
  const accepted = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)
  if (accepted.kind !== 'accepted') throw new Error(JSON.stringify(accepted))
  const score = { threadId: s.stage.threadId, activityId: s.stage.activityId, submissionId: accepted.submissionId, idempotencyKey: 'canvas_purpose_score_1234567890' }
  expect(await s.owner.action(api.learnAdaptive.submitResponse, score)).toMatchObject({ kind: 'accepted', status: 'completed' })
  expect(await s.owner.action(api.learnAdaptive.submitResponse, score)).toMatchObject({ kind: 'accepted', status: 'completed', replayed: true })
  expect(await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)).toEqual(accepted)
  const replay = await s.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: s.stage.threadId })
  expect(replay).toMatchObject({ status: 'feedback', savedResponse: { response: answer, confidence: 3 } })
  expectSafeCanvas(replay, s)
  await s.t.run(async ctx => {
    const attempts = (await ctx.db.query('masteryAttempts').take(8)).filter(row => row.submissionId === accepted.submissionId)
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({ kind, serverScorePercent: awarded ? 100 : 0 })
    expect(attempts[0]).not.toHaveProperty('response')
    expect(await ctx.db.query('learnResponseBodies').take(8)).toHaveLength(1)
    if (kind === 'measurement_cold' || kind === 'measurement_delayed') expect(await ctx.db.query('masteryRecords').take(8)).toEqual([])
  })
  expect(network).toHaveBeenCalledTimes(1)
})

test.each(['retained_transfer', 'independent_application'] as const)('Canvas %s rejects response wire overflow before sealing', async kind => {
  const s = await purposeFixture(kind)
  vi.stubGlobal('fetch', vi.fn(async () => modelReply(true, 'accuracy')))
  expect(await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { ...s.stage, response: '\\'.repeat(4001) }))
    .toMatchObject({ kind: 'rejected', reasonCode: 'payload_too_large' })
  expect(await s.t.run(ctx => ctx.db.query('learnResponseBodies').take(4))).toEqual([])
  const sealed = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { ...s.stage,
    response: '\\'.repeat(4000), idempotencyKey: 'canvas_application_bounded_1234567890' })
  if (sealed.kind !== 'accepted') throw new Error('Expected bounded Canvas response')
  expect(await s.owner.action(api.learnAdaptive.submitResponse, { threadId: s.stage.threadId, activityId: s.stage.activityId,
    submissionId: sealed.submissionId, idempotencyKey: 'canvas_application_bounded_score_1234567890' })).toMatchObject({ kind: 'accepted', status: 'completed' })
})

test.each(['v2_canvas', 'v2_today'] as const)('merged Today start races Canvas attachment without changing the %s stratum', async flow => {
  const s = await fixture({ attach: false, flow })
  const [canvas, today] = await Promise.all([
    s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, s.attach),
    s.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: s.f.studySessionId,
      expectedSessionRevision: 2, expectedContentRevision: flow === 'v2_canvas' ? 2 : 1, idempotencyKey: 'merged_today_canvas_race_1234567890', entryPoint: 'today' }),
  ])
  if (flow === 'v2_canvas') {
    expect(canvas).toMatchObject({ kind: 'attached' })
    expect(today).toMatchObject({ status: 'assessment', assessment: { reasonCode: 'flow_mismatch' }, deliveryGrant: null })
  } else {
    expect(canvas).toMatchObject({ kind: 'not_admitted', observations: 'no_observations' })
    expect(today).toMatchObject({ status: 'assessment', deliveryGrant: { status: 'granted' } })
  }
  expectSafeCanvas(today, s)
  const grants = await s.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(8))
  expect(grants).toHaveLength(1)
  expect(grants[0]!.provenanceVersion).toBe(`learn-v2.assessment-delivery.${flow === 'v2_canvas' ? 'canvas' : 'today'}.v1`)
  expect(await s.t.run(ctx => ctx.db.query('learnResponseBodies').take(8))).toEqual([])
  expect(await s.t.run(ctx => ctx.db.query('masteryAttempts').take(8))).toEqual([])
})

test('source revocation rejects attachment and saved-receipt replay while retaining case consumption', async () => {
  const s = await fixture()
  const receipt = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)
  if (receipt.kind !== 'accepted') throw new Error(JSON.stringify(receipt))
  await s.t.run(ctx => ctx.db.patch(s.family.graph.sourceSnapshotId, { evidencePurgedAt: NOW }))
  expect(await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, s.attach)).toMatchObject({ kind: 'not_admitted', observations: 'no_observations' })
  expect(await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)).toMatchObject({ kind: 'rejected', reasonCode: 'evidence_unavailable' })
  const value = await s.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: s.stage.threadId })
  expect(value).toMatchObject({ status: 'blocked', responsePrompt: null, savedResponse: null, assessment: { bodyAvailability: 'unavailable' } })
  expectSafeCanvas(value, s)
  expect(await s.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(8))).toHaveLength(1)
  expect(await s.t.run(ctx => ctx.db.query('learnResponses').take(8))).toHaveLength(1)
  expect(await s.t.run(ctx => ctx.db.query('masteryAttempts').take(8))).toEqual([])
})

test('saved-ID scoring rejects hybrid raw requests before dispatch', async () => {
  const s = await fixture()
  const receipt = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)
  if (receipt.kind !== 'accepted') throw new Error(JSON.stringify(receipt))
  const network = vi.fn(async () => modelReply())
  vi.stubGlobal('fetch', network)
  await expect(s.owner.action(api.learnAdaptive.submitResponse, { threadId: s.stage.threadId, activityId: s.stage.activityId,
    submissionId: receipt.submissionId, response: 'A replacement raw body', idempotencyKey: 'hybrid_saved_score_1234567890' })).rejects.toThrow(/only a submission reference/)
  expect(network).not.toHaveBeenCalled()
  expect(await s.t.run(ctx => ctx.db.query('learnResponseBodies').take(8))).toHaveLength(1)
})

test.each([{ reserves: 3, claims: 32, supports: 2, extraSupports: 0, backingDocuments: true }, { reserves: 3, claims: 8, supports: 8, extraSupports: 0 }])('published inventory fits Canvas preparation and attachment: %j', async shape => {
  const s = await fixture({ prepare: false, attach: false, reserveCount: shape.reserves, inventory: { ...shape, sources: 64 } })
  const prepared = await s.owner.mutation(async ctx => {
    const value = await ctx.runMutation(api.learnAdaptiveCanvas.prepareCanvasSession, s.prepare)
    return { value, metrics: await ctx.meta.getTransactionMetrics() }
  })
  console.info('delivery-read-budget', JSON.stringify({ path: 'canvas-prepare', shape, queries: prepared.metrics.databaseQueries.used,
    documents: prepared.metrics.documentsRead.used, bytes: prepared.metrics.bytesRead.used }))
  expect(prepared.value).toMatchObject({ kind: 'prepared' })
  const attached = await s.owner.mutation(async ctx => {
    const value = await ctx.runMutation(api.learnAdaptiveCanvas.attachReadySession, s.attach)
    return { value, metrics: await ctx.meta.getTransactionMetrics() }
  })
  console.info('delivery-read-budget', JSON.stringify({ path: 'canvas-attach', shape, queries: attached.metrics.databaseQueries.used,
    documents: attached.metrics.documentsRead.used, bytes: attached.metrics.bytesRead.used, reason: attached.value.kind === 'not_admitted' ? attached.value.reasonCode : null }))
  expect(attached.value).toMatchObject({ kind: 'attached' })
  expect(attached.metrics.databaseQueries.used).toBeLessThan(3072)
  if (attached.value.kind !== 'attached') throw new Error('Expected attached check')
  const attachment = attached.value
  const canvas = (await s.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attachment.threadId }))!
  const accepted = await s.owner.mutation(async ctx => {
    const value = await ctx.runMutation(api.learnAdaptiveCanvas.submitCanvasResponse, { threadId: attachment.threadId,
      activityId: attachment.activityId, studySessionId: canvas.session.studySessionId, expectedRevision: canvas.activity.planRevision!,
      expectedSessionRevision: canvas.session.revision, response: answer, confidence: 3, idempotencyKey: 'max_canvas_accept_1234567890' })
    return { value, metrics: await ctx.meta.getTransactionMetrics() }
  })
  expect(accepted.value).toMatchObject({ kind: 'accepted' })
  console.info('delivery-read-budget', JSON.stringify({ path: 'canvas-accept', shape, queries: accepted.metrics.databaseQueries.used,
    documents: accepted.metrics.documentsRead.used, bytes: accepted.metrics.bytesRead.used }))
  expect(accepted.metrics.databaseQueries.used).toBeLessThan(3072)

})

test.each(['nested_limit', 'native_limit'] as const)('Canvas preparation propagates %s and rolls back earlier writes', async mode => {
  const s = await fixture({ prepare: false, attach: false, reserveCount: 3,
    inventory: { claims: 32, supports: 2, sources: 64, backingDocuments: true } })
  const before = (await s.t.run(ctx => ctx.db.get(s.f.learningVoidId)))!
  await expect(s.owner.mutation(async ctx => {
    await ctx.db.patch(before._id, { title: 'Uncommitted preparation marker' })
    if (mode === 'native_limit') for (let index = 0; index < 3500; index++) await ctx.db.get(s.f.studySessionId)
    return await ctx.runMutation(api.learnAdaptiveCanvas.prepareCanvasSession, s.prepare,
      mode === 'nested_limit' ? { transactionLimits: { databaseQueries: 180 } } : {})
  })).rejects.toThrow('Too many index ranges')
  expect(await s.t.run(ctx => ctx.db.get(before._id))).toEqual(before)
})

test('the 64-row publication bound delivers, seals, recovers and scores through Canvas', async () => {
  const s = await fixture({ reserveCount: 3, inventory: { claims: 32, supports: 2, sources: 64, backingDocuments: true } })
  vi.stubGlobal('fetch', vi.fn(async () => modelReply()))
  const sealed = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)
  if (sealed.kind !== 'accepted') throw new Error('Expected sealed response')
  expect(await s.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: s.stage.threadId }))
    .toMatchObject({ assessment: { phase: 'submitted_sealed' } })
  const scored = await s.owner.action(api.learnAdaptive.submitResponse, { threadId: s.stage.threadId, activityId: s.stage.activityId,
    submissionId: sealed.submissionId, idempotencyKey: 'bound_canvas_score_1234567890' })
  expect(scored).toMatchObject({ kind: 'accepted', status: 'completed' })
  expect(await s.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: s.stage.threadId }))
    .toMatchObject({ assessment: { phase: 'scored_pass' } })
  expect(await s.owner.action(api.learnAdaptive.submitResponse, { threadId: s.stage.threadId, activityId: s.stage.activityId,
    submissionId: sealed.submissionId, idempotencyKey: 'bound_canvas_recovery_1234567890' })).toMatchObject({ kind: 'accepted', status: 'completed' })
})

test('65-row inventory is rejected before Canvas publication or disclosure', async () => {
  await expect(fixture({ inventory: { claims: 32, supports: 2, sources: 3, extraSupports: 1 } }))
    .rejects.toThrow('item_evidence_limit')
})

test.each(['sealed', 'scored'] as const)('saved %s work above the admission allowance recovers within the transport cap', async phase => {
  const s = await fixture()
  vi.stubGlobal('fetch', vi.fn(async () => modelReply()))
  const original = scoringContract.assertMeasurementScoringContract
  const priorAdmission = vi.spyOn(scoringContract, 'assertMeasurementScoringContract').mockImplementation((input, binding, acceptance, request) => {
    if (!acceptance) original(input, binding, acceptance, request)
  })
  const sealed = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { ...s.stage, response: '\\'.repeat(4001) })
  if (sealed.kind !== 'accepted') throw new Error('Expected sealed response')
  const request = { threadId: s.stage.threadId, activityId: s.stage.activityId, submissionId: sealed.submissionId,
    idempotencyKey: 'saved_allowance_recovery_1234567890' }
  if (phase === 'scored') expect(await s.owner.action(api.learnAdaptive.submitResponse, request)).toMatchObject({ kind: 'accepted', status: 'completed' })
  priorAdmission.mockRestore()
  const before = await s.t.run(ctx => ctx.db.get(sealed.submissionId))
  expect(await s.owner.query(internal.learnV2Mastery.getMasterySubmissionScoringState, {
    version: LEARN_V2_PUBLIC_API_VERSION, submissionId: sealed.submissionId, idempotencyKey: 'saved_allowance_state_1234567890' }))
    .toMatchObject({ status: phase === 'scored' ? 'scored' : 'scoring_pending' })
  expect(await s.owner.action(api.learnAdaptive.submitResponse, request)).toMatchObject({ kind: 'accepted', status: 'completed' })
  expect(await s.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: sealed.submissionId, idempotencyKey: 'saved_allowance_replay_1234567890' })).toMatchObject({ status: 'scored' })
  expect(await s.t.run(ctx => ctx.db.get(sealed.submissionId))).toEqual(before)
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('saved work still fails the hard transport cap without dispatch or loss of its body', async () => {
  const s = await fixture({ inventory: { claims: 32, supports: 2, sources: 64,
    claimText: 'The source rule justifies this declared hypothetical total using multiplication. '.repeat(2) } })
  const original = scoringContract.assertMeasurementScoringContract
  const priorAdmission = vi.spyOn(scoringContract, 'assertMeasurementScoringContract').mockImplementation((input, binding, acceptance, request) => {
    if (!acceptance) original(input, binding, acceptance, request)
  })
  const sealed = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { ...s.stage, response: '\\'.repeat(8000) })
  if (sealed.kind !== 'accepted') throw new Error('Expected saved fixture response')
  priorAdmission.mockRestore()
  vi.stubGlobal('fetch', vi.fn())
  await expect(s.owner.query(internal.learnV2Mastery.getMasterySubmissionScoringState, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: sealed.submissionId, idempotencyKey: 'saved_hard_transport_cap_1234567890' })).rejects.toThrow('response_payload_limit')
  expect(await s.t.run(ctx => ctx.db.query('learnResponseBodies').take(4))).toHaveLength(1)
  expect(await s.t.run(ctx => ctx.db.query('masteryAttempts').take(4))).toEqual([])
  expect(fetch).not.toHaveBeenCalled()
})

test('an authoritative result with 65 saved evidence rows survives a lower admission bound', async () => {
  policy.evidenceRows = 65
  const s = await fixture({ inventory: { claims: 32, supports: 2, sources: 3, extraSupports: 1 } })
  vi.stubGlobal('fetch', vi.fn(async () => modelReply()))
  const sealed = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)
  if (sealed.kind !== 'accepted') throw new Error('Expected sealed response')
  const request = { threadId: s.stage.threadId, activityId: s.stage.activityId, submissionId: sealed.submissionId,
    idempotencyKey: 'saved_evidence_bound_score_1234567890' }
  expect(await s.owner.action(api.learnAdaptive.submitResponse, request)).toMatchObject({ kind: 'accepted', status: 'completed' })
  const before = await s.t.run(ctx => ctx.db.get(sealed.submissionId))
  policy.evidenceRows = 64
  expect(await s.owner.query(internal.learnV2Mastery.getMasterySubmissionScoringState, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: sealed.submissionId, idempotencyKey: 'saved_evidence_bound_state_1234567890' })).toMatchObject({ status: 'scored' })
  expect(await s.owner.action(api.learnAdaptive.submitResponse, request)).toMatchObject({ kind: 'accepted', status: 'completed' })
  expect(await s.t.run(ctx => ctx.db.get(sealed.submissionId))).toEqual(before)
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('Canvas rejects an oversized scoring response before sealing and accepts a bounded retry', async () => {
  const s = await fixture({ inventory: { claims: 32, supports: 2, sources: 3 } })
  const oversized = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { ...s.stage,
    response: '\\'.repeat(4001), idempotencyKey: 'oversized_wire_body_1234567890' })
  expect(oversized).toMatchObject({ kind: 'rejected', reasonCode: 'payload_too_large' })
  expect(await s.t.run(ctx => ctx.db.query('learnResponses').take(8))).toEqual([])
  const accepted = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { ...s.stage,
    response: '\\'.repeat(4000), idempotencyKey: 'bounded_wire_body_1234567890' })
  expect(accepted).toMatchObject({ kind: 'accepted', phase: 'submitted_sealed' })
  if (accepted.kind !== 'accepted') throw new Error('Expected sealed response')
  vi.stubGlobal('fetch', vi.fn(async () => modelReply()))
  expect(await s.owner.action(api.learnAdaptive.submitResponse, { threadId: s.stage.threadId, activityId: s.stage.activityId,
    submissionId: accepted.submissionId, idempotencyKey: 'bounded_wire_score_1234567890' })).toMatchObject({ kind: 'accepted', status: 'completed' })
})

test.each(['Too many index ranges read', 'Unexpected scoring failure'])('Canvas scoring propagates %s and retains the sealed answer for recovery', async message => {
  const s = await fixture({ inventory: { claims: 32, supports: 2, sources: 3 } })
  const sealed = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)
  if (sealed.kind !== 'accepted') throw new Error('Expected sealed response')
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(message) }))
  const request = { threadId: s.stage.threadId, activityId: s.stage.activityId, submissionId: sealed.submissionId,
    idempotencyKey: 'unexpected_canvas_score_1234567890' }
  await expect(s.owner.action(api.learnAdaptive.submitResponse, request)).rejects.toThrow(message)
  expect(await s.t.run(ctx => ctx.db.query('masteryAttempts').take(8))).toEqual([])
  expect(await s.t.run(ctx => ctx.db.query('learnResponseBodies').take(8))).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(61_000)
  vi.stubGlobal('fetch', vi.fn(async () => modelReply()))
  const recovered = await s.owner.action(api.learnAdaptive.submitResponse, request)
  expect(recovered).toMatchObject({ kind: 'accepted', status: 'in_progress' })
  expect(fetch).not.toHaveBeenCalled()
})


test('Canvas attachment rolls back a grant when its final assessment is blocked', async () => {
  const s = await fixture({ attach: false })
  const original = assessmentDelivery.readLearnAssessmentForOwner
  vi.spyOn(assessmentDelivery, 'readLearnAssessmentForOwner').mockImplementation(async (ctx, owner, id, flow) => {
    const row = await ctx.db.get(id)
    if (row?.deliveryGrantId) {
      if (!('patch' in ctx.db)) throw new Error('Expected mutation context')
      await ctx.db.patch(s.family.graph.sourceIdentityId, { tombstonedAt: Date.now() })
    }
    return await original(ctx, owner, id, flow)
  })
  await expect(s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, s.attach)).rejects.toThrow('Learn Canvas delivery authority changed')
  expect(await s.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(8))).toEqual([])
  expect(await s.t.run(ctx => ctx.db.get(s.family.graph.sourceIdentityId))).not.toHaveProperty('tombstonedAt')
  expect(await s.t.run(ctx => ctx.db.get(s.f.studySessionId))).toMatchObject({ status: 'ready', revision: 2 })
})
