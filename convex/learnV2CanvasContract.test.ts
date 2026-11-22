/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { seedMeasurementStorage, STORAGE_CANARIES } from '../tests/fixtures/learn-v2-measurement-storage'
import { ADAPTIVE_ASSESSMENT_PLAN_VERSION, composeAdaptiveActivityPlan, readAdaptiveAssessmentReference } from '../shared/learn-adaptive-activity-plan'
import { storedPlan } from './learnAdaptiveRecovery'
import { ADAPTIVE_V2_PILOT_MANIFEST } from '../shared/adaptive-v2-pilot-policy'
import { privacyDigest } from './lib/learnV2ResponsePrivacy'
import { createLearnScorerRegistry, sealLearnScorerConfiguration } from './lib/learnV2ScorerConfig'
import { LEARN_V2_PUBLIC_API_VERSION } from './lib/learnV2PublicContract'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION, LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION } from '../shared/learn-v2-responses'
import { LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION } from '../shared/learn-v2-assessment-disclosure'

const policy = vi.hoisted(() => ({ responses: true, delivery: true, scoring: true, scorer: null as unknown }))
vi.mock('../shared/learn-v2-measurement-storage-manifest', async original => {
  const value = await original<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...value, LEARN_MEASUREMENT_CAPABILITIES: { ...value.LEARN_MEASUREMENT_CAPABILITIES,
    get responses() { return policy.responses }, get delivery() { return policy.delivery }, get scoring() { return policy.scoring } } }
})
vi.mock('./lib/learnV2MeasurementScorerInventory', () => ({ getLearnMeasurementScorer: async () => policy.scorer }))

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example|canvas-contract', subject: 'canvas-contract' }
const NOW = 1_800_000_000_001
const HASH = `sha256:${'a'.repeat(64)}`
const originalManifest = structuredClone(ADAPTIVE_V2_PILOT_MANIFEST)
const prompt = 'Apply the rule to the assigned situation.'
const answer = 'A committed learner answer.'

beforeEach(() => {
  policy.responses = true; policy.delivery = true; policy.scoring = true; policy.scorer = null
  vi.useFakeTimers(); vi.setSystemTime(NOW)
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  vi.stubEnv('LEARN_ADAPTIVE_V2_PILOT_MANIFEST', ADAPTIVE_V2_PILOT_MANIFEST.version)
  for (const name of ['OPENROUTER_API_KEY', 'CF_ACCOUNT_ID', 'CLOUDFLARE_AI_GATEWAY_ID']) vi.stubEnv(name, 'synthetic-unused')
})
afterEach(() => {
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, originalManifest)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers()
})

async function fixture() {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(OWNER)
  const definition = { configurationId: 'canvas.synthetic', configurationVersion: 'canvas.synthetic.v1', kind: 'legacy_baseline' as const,
    requestedModel: 'synthetic/model', endpoint: null, identity: { mappingVersion: 'synthetic.identity.v1', canonicalModel: 'synthetic/model',
      family: 'synthetic', snapshotAssurance: 'unknown' as const, verifiedReturnedModels: [] } }
  const saved = await sealLearnScorerConfiguration(definition)
  const registry = await createLearnScorerRegistry({ epoch: 'fixture-epoch', configurations: [{ definition, expectedDigest: saved.binding.configurationDigest }],
    legacyAllowlist: [definition.configurationId], prospectiveConfigurationId: null })
  policy.scorer = { registry, saved }
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { pilotApproved: true,
    startsAt: new Date(NOW - 86_400_000).toISOString(), endsAt: new Date(NOW + 86_400_000).toISOString(),
    cohort: { ...originalManifest.cohort, subjectHashes: [await privacyDigest(['adaptive-v2-pilot-cohort.v1', OWNER.tokenIdentifier])] },
    modelPolicies: [{ model: 'synthetic/model', inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.1 }],
    productControls: { ...originalManifest.productControls, maxDispatchesPerHour: 4, maxDispatchesPerDay: 8, maxConcurrent: 2, maxReservedMicroUsdPerDay: 100_000 },
    rollback: { ...originalManifest.rollback, ownerSubjectHash: await privacyDigest(['adaptive-v2-rollback-owner.tokenIdentifier-sha256.v1', OWNER.tokenIdentifier]) } })
  const f = await t.run(ctx => seedMeasurementStorage(ctx, OWNER.tokenIdentifier))
  const contract = { version: 'learn-v2.assessment.v1' as const, kind: 'bounded_rubric' as const, responseFormat: 'short_text' as const,
    instructions: 'Apply the source rule.', passingScorePercent: 80 as const, criteria: [{ key: 'rule', description: STORAGE_CANARIES.rubric, weightPercent: 100 }] }
  const capability = { ...f.scope, assessmentContractVersion: contract.version, assessmentContractDigest: await privacyDigest(contract) }
  const prepared = await t.run(async ctx => {
    await ctx.db.insert('users', { tokenIdentifier: OWNER.tokenIdentifier, name: 'Learner', learnV2Entitlement: { enabled: true, updatedAt: NOW },
      learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: NOW } })
    for (const table of ['learnResponses', 'learnResponseBodies', 'learnResponseEvidenceLinks', 'learnResponseIntegrityEvents', 'learnResponseCommandReceipts', 'learnScoringExecutions', 'learnMeasurementReportFacts', 'learnMeasurementSourceWatermarks'] as const)
      for (const row of await ctx.db.query(table).take(8)) await ctx.db.delete(row._id)
    await ctx.db.patch(f.learningVoidId, { activeBlueprintRevisionId: f.scope.blueprintRevisionId })
    await ctx.db.patch(f.scope.blueprintRevisionId, { status: 'accepted', acceptedAt: NOW - 1000 })
    await ctx.db.patch(f.scope.objectiveId, { depth: 'working', assessmentContract: contract })
    await ctx.db.patch(f.scope.contextPins.studyPlanId, { activeRevisionId: f.scope.contextPins.studyPlanRevisionId })
    await ctx.db.patch(f.scope.contextPins.studyPlanRevisionId, { status: 'accepted', acceptedAt: NOW - 1000,
      blueprintRevisionId: f.scope.blueprintRevisionId, blueprintRecordRevision: 1, timezone: 'UTC' })
    const plan = await composeAdaptiveActivityPlan({ activityId: 'canvas-assigned-check', threadId: String(f.threadId), boundaryOrdinal: 1, planRevision: 1,
      activityClass: 'factual', intent: 'master', objectiveId: String(f.scope.objectiveId), purpose: 'Complete the assigned check.', reasonCode: 'assessment_check',
      primitiveSequence: [], assessmentReference: { version: ADAPTIVE_ASSESSMENT_PLAN_VERSION,
        assessmentOpportunityId: f.rows.learnAssessmentOpportunities, deliveryGrantId: f.rows.learnAssessmentExposures,
        item: { itemId: f.itemPins.itemId, itemRevision: 1, promptDigest: await privacyDigest(prompt) },
        responseSpec: { kind: 'bounded_rubric', version: 'response.v1', maxCodeUnits: 12000 },
        claims: [{ claimId: f.rows.learnMeasurementClaims, revision: 1, claimDigest: HASH }] },
      requiredAction: { kind: 'submit_response', label: 'Submit response' },
      evaluationContract: { version: 'learn-adaptive.evaluation.v1', kind: 'server_scored', responseFormat: 'short_text', passingScorePercent: 80 },
      accessibilityMetadata: { heading: 'Assigned check', instructions: 'Submit your response.', focusTargetTestId: 'learn-primitive-independent-application', liveRegionMode: 'polite' },
      pins: { learningVoidId: String(f.learningVoidId), blueprintRevisionId: String(f.scope.blueprintRevisionId), objectiveId: String(f.scope.objectiveId), sessionContentId: String(f.scope.contextPins.sessionContentId) },
      evidenceReferences: [], generationInputs: { sessionContentRevision: 1, sessionContentInputDigest: HASH, generatorVersion: 'generator.v1' },
      decisionInputs: { intentRevision: 1, routerVersion: 'learn-adaptive.router.v1', availableTime: '15', sourceState: 'ready', sourceInputs: [],
        priorActivityId: null, priorAttemptId: null, priorOutcome: null, assistance: 'none', confidence: null } })
    await ctx.db.patch(f.threadId, { authorityKind: 'v2_mission', learningVoidId: f.learningVoidId, currentActivityId: f.activityId, lifecycle: 'active', evidenceState: 'ready' })
    await ctx.db.patch(f.activityId, { activityId: plan.activityId, activityClass: 'factual', status: 'started', intent: plan.intent,
      objectiveId: f.scope.objectiveId, learningVoidId: f.learningVoidId, blueprintRevisionId: f.scope.blueprintRevisionId,
      sessionContentId: f.scope.contextPins.sessionContentId, purpose: plan.purpose, reasonCode: plan.reasonCode, primitivePlan: plan.primitivePlan,
      requiredAction: plan.requiredAction, evaluationContract: plan.evaluationContract, accessibilityMetadata: plan.accessibilityMetadata,
      fallback: plan.fallback, generationInputs: plan.generationInputs, decisionInputs: plan.decisionInputs,
      canonicalInputSnapshot: plan.canonicalInputSnapshot, inputDigest: plan.inputDigest })
    const canvas = { threadId: f.threadId, threadRevision: 1, activityId: f.activityId, activityRevision: 1,
      planVersion: plan.planVersion, replayVersion: plan.replayVersion, rendererVersion: plan.rendererVersion,
      evaluationVersion: plan.evaluationContract.version, pilotConfigurationVersion: ADAPTIVE_V2_PILOT_MANIFEST.version }
    const contextPins = { ...f.scope.contextPins, contentInputDigest: HASH, canvas }
    const { contextPins: _context, scopeKind: _scope, ...pins } = capability
    const assignment = (await ctx.db.get(f.rows.learnMeasurementAssignments))!
    if (assignment.status !== 'admitted' || assignment.allocation.kind !== 'three_case') throw new Error('Expected fixture allocation')
    const allocation = { ...assignment.allocation }
    for (const key of ['cold', 'day7', 'day30'] as const) {
      allocation[key] = { ...allocation[key], promptDigest: await privacyDigest(key === 'cold' ? prompt : `SIBLING-${key}`), scoringSpecDigest: HASH, supportManifestDigest: HASH }
      const item = (await ctx.db.get(allocation[key].itemId))!
      await ctx.db.patch(item._id, { ...pins, prompt: key === 'cold' ? prompt : `SIBLING-${key}`, promptDigest: allocation[key].promptDigest,
        scoringSpecDigest: HASH, supportManifestDigest: HASH, responseSpec: { kind: 'bounded_rubric', version: 'response.v1', maxCodeUnits: 12000 } })
      await ctx.db.patch(item.scoringSpecId!, { ...pins, digest: HASH, scoringBinding: saved.binding,
        payload: { kind: 'bounded_rubric', keyInsufficientReason: 'Written reasoning is required.', criteria: contract.criteria } })
    }
    await ctx.db.patch(f.rows.learnMeasurementFamilies, pins)
    await ctx.db.patch(f.rows.learnMeasurementValidations, pins)
    await ctx.db.patch(f.rows.learnMeasurementSupports, pins)
    await ctx.db.patch(f.rows.learnMeasurementClaims, { claimDigest: HASH })
    await ctx.db.patch(f.rows.learnMeasurementAssignments, { ...pins, allocation, scoringBinding: saved.binding, flow: 'v2_canvas', entryPoint: 'canvas' })
    await ctx.db.patch(f.rows.learnAssessmentOpportunities, { ...pins, contextPins, phase: 'test_open', submissionId: undefined, scoringJobId: undefined,
      revision: 1, closeAt: NOW + 100_000, assessmentPins: { kind: 'measurement', itemPins: allocation.cold }, scoringBinding: saved.binding,
      deliveryPins: { version: LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION, confidenceRequested: true } })
    await ctx.db.patch(f.rows.learnAssessmentExposures, { threadId: f.threadId, activityId: f.activityId,
      projectionDigest: allocation.cold.promptDigest, policyVersion: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION })
    await ctx.db.patch(f.studySessionId, { status: 'in_progress', assessmentPurpose: 'measurement_cold', assessmentOpportunityId: f.rows.learnAssessmentOpportunities,
      startedSessionContentId: contextPins.sessionContentId, startedSessionContentRevision: 1, assistanceRevision: 0, timezone: 'UTC' })
    await ctx.db.patch(contextPins.sessionContentId, { blueprintRevisionId: pins.blueprintRevisionId, objectiveId: pins.objectiveId,
      studyPlanRevisionId: contextPins.studyPlanRevisionId, inputDigest: HASH, generatorVersion: 'generator.v1', providerModel: 'synthetic/model',
      assessmentPurpose: 'measurement_cold', assessmentOpportunityId: f.rows.learnAssessmentOpportunities })
    await ctx.db.insert('sessionContentBlocks', { userId: OWNER.tokenIdentifier, sessionContentId: contextPins.sessionContentId, order: 0,
      kind: 'explanation', content: 'PRIVATE EXPLANATION' })
    return { activityId: plan.activityId }
  })
  const stage = { threadId: f.threadId, activityId: prepared.activityId, studySessionId: f.studySessionId, expectedRevision: 1, expectedSessionRevision: 1,
    response: answer, confidence: 3, idempotencyKey: 'adaptive-canvas-submit-12345678-1234-1234-1234-123456789012' }
  const canonical = { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'today_submission_1234567890',
    response: { target: { assessmentOpportunityId: f.rows.learnAssessmentOpportunities }, expectedRevision: 1, payload: { kind: 'text' as const, text: answer }, confidence: 3 } } }
  return { t, owner, f, stage, canonical }
}

function modelReply() {
  return new Response(JSON.stringify({ id: 'synthetic-execution', model: 'synthetic/model', choices: [{ index: 0, finish_reason: 'stop',
    message: { role: 'assistant', content: JSON.stringify({ criterionResults: [{ key: 'rule', awarded: true }], misconceptionTags: [] }) } }],
    usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 }, openrouter_metadata: { requested: 'synthetic/model', strategy: 'direct', attempt: 1,
      endpoints: { available: [{ provider: 'Synthetic Provider', model: 'synthetic/model', selected: true }] }, pipeline: [] } }))
}

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
    expect(await ctx.db.get(s.f.activityId)).not.toHaveProperty('submittedResponse')
    expect((await ctx.db.get(s.f.threadId))!.revision).toBe(1)
  })
})

test.each(['missing_claim', 'revoked_support'] as const)('measurement acceptance fails closed for %s without teaching-claim fallback', async damage => {
  const s = await fixture()
  await s.t.run(async ctx => {
    if (damage === 'missing_claim') await ctx.db.delete(s.f.rows.learnMeasurementClaims)
    else await ctx.db.patch(s.f.rows.learnMeasurementSupports, { evidenceStatus: 'evidence_unavailable', invalidatedAt: NOW })
  })
  expect(await s.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, s.canonical)).toMatchObject({ kind: 'rejected', reasonCode: 'evidence_unavailable' })
  expect(await s.t.run(ctx => ctx.db.query('learnResponseBodies').take(8))).toEqual([])
})

test.each(['grant', 'item_revision', 'claim_revision', 'claim_digest', 'unknown_version'] as const)('Canvas refuses a self-consistent plan with a mismatched %s reference', async mismatch => {
  const s = await fixture()
  await s.t.run(async ctx => {
    const activity = (await ctx.db.get(s.f.activityId))!
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
  const value = await s.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: s.f.threadId })
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
    expect(responses[0]).toMatchObject({ flow: 'canvas', contextPins: { canvas: { threadId: s.f.threadId, activityId: s.f.activityId } } })
    expect(await ctx.db.query('learnResponseBodies').take(8)).toHaveLength(1)
  })
})

test('Canvas scores only its saved ID and preserves one authoritative attempt across routes and replay', async () => {
  const s = await fixture()
  const network = vi.fn(async () => modelReply())
  vi.stubGlobal('fetch', network)
  const receipt = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)
  if (receipt.kind !== 'accepted') throw new Error(JSON.stringify(receipt))
  const request = { threadId: s.f.threadId, activityId: s.stage.activityId, submissionId: receipt.submissionId, idempotencyKey: 'canvas_score_1234567890' }
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
    expect((await ctx.db.get(s.f.studySessionId))!.status).toBe('in_progress')
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
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('lost provider receipt') }))
  const receipt = await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, s.stage)
  if (receipt.kind !== 'accepted') throw new Error(JSON.stringify(receipt))
  const request = { threadId: s.f.threadId, activityId: s.stage.activityId, submissionId: receipt.submissionId, idempotencyKey: 'canvas_lost_score_1234567890' }
  expect(await s.owner.action(api.learnAdaptive.submitResponse, request)).toMatchObject({ kind: 'blocked', code: 'reconciliation_required', retryable: false })
  expect(await s.owner.action(api.learnAdaptive.submitResponse, request)).toMatchObject({ kind: 'blocked', code: 'reconciliation_required', retryable: false })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(await s.t.run(ctx => ctx.db.query('masteryAttempts').take(8))).toHaveLength(0)
  expect(await s.t.run(ctx => ctx.db.query('learnResponseBodies').take(8))).toHaveLength(1)
})

test('disabled saved-ID scoring and assessment Canvas reads disclose no check body or teaching', async () => {
  const s = await fixture()
  policy.responses = false
  const network = vi.fn(async () => modelReply())
  vi.stubGlobal('fetch', network)
  expect(await s.owner.action(api.learnAdaptive.submitResponse, { threadId: s.f.threadId, activityId: s.stage.activityId,
    submissionId: s.f.rows.learnResponses, idempotencyKey: 'disabled_canvas_score_1234567890' })).toMatchObject({ kind: 'blocked', code: 'disabled' })
  for (const value of [await s.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: s.f.threadId }),
    await s.owner.mutation(api.learnAdaptiveCanvas.getCanvasDelivery, { threadId: s.f.threadId, idempotencyKey: 'disabled_canvas_read_1234567890' })]) {
    expect(JSON.stringify(value)).not.toMatch(/PRIVATE EXPLANATION|SIBLING-|private-answer-key|private-rubric-description/)
    expect(JSON.stringify(value)).not.toContain(prompt)
  }
  expect(network).not.toHaveBeenCalled()
  expect(await s.t.run(ctx => ctx.db.query('learnResponseBodies').take(8))).toEqual([])
})

test('standalone diagnostics use a non-factual slot with the tighter byte limit and no V2 attempt', async () => {
  const t = convexTest(schema, modules)
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
  const s = await fixture()
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
