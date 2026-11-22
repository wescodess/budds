/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { anyApi, type ApiFromModules } from 'convex/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { canvasFamilyFixture, canvasIdentity } from '../tests/fixtures/learn-v2-canvas'
import { syntheticDeliveryProtocol } from '../tests/fixtures/learn-v2-assessment-delivery'
import { learnMeasurementProtocolSchema, measurementClock } from './lib/learnV2MeasurementAssignment'
import { seedMeasurementStorage } from '../tests/fixtures/learn-v2-measurement-storage'
import { ADAPTIVE_ASSESSMENT_PLAN_VERSION, composeAdaptiveActivityPlan, readAdaptiveAssessmentReference } from '../shared/learn-adaptive-activity-plan'
import { storedPlan } from './learnAdaptiveRecovery'
import { ADAPTIVE_V2_PILOT_MANIFEST } from '../shared/adaptive-v2-pilot-policy'
import { privacyDigest } from './lib/learnV2ResponsePrivacy'
import { createLearnScorerRegistry, sealLearnScorerConfiguration } from './lib/learnV2ScorerConfig'
import { LEARN_V2_PUBLIC_API_VERSION } from './lib/learnV2PublicContract'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION, LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION } from '../shared/learn-v2-responses'
import { masteryScopeKey } from './lib/learnV2MasteryScope'
import { localDateAt } from '../shared/learn-v2-mastery'
import { LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION } from '../shared/learn-v2-assessment-disclosure'

const policy = vi.hoisted(() => ({ responses: true, delivery: true, scoring: true, scorer: null as unknown, protocol: null as unknown }))
vi.mock('../shared/learn-v2-measurement-storage-manifest', async original => {
  const value = await original<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...value, LEARN_MEASUREMENT_CAPABILITIES: { ...value.LEARN_MEASUREMENT_CAPABILITIES,
    get responses() { return policy.responses }, get delivery() { return policy.delivery }, get scoring() { return policy.scoring }, enrollment: true } }
})
vi.mock('./lib/learnV2MeasurementAssignment', async original => {
  const value = await original<typeof import('./lib/learnV2MeasurementAssignment')>()
  return { ...value, getFrozenLearnMeasurementProtocol: () => policy.protocol }
})
vi.mock('./lib/learnV2MeasurementScorerInventory', () => ({ getLearnMeasurementScorer: async () => policy.scorer }))

const modules = import.meta.glob('./**/*.ts')
const measurement = (anyApi as unknown as ApiFromModules<{ learnV2Measurement: typeof import('./learnV2Measurement') }>).learnV2Measurement
const OWNER = canvasIdentity
const NOW = 1_800_000_000_001
const HASH = `sha256:${'a'.repeat(64)}`
const originalManifest = structuredClone(ADAPTIVE_V2_PILOT_MANIFEST)
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

async function fixture(options: { attach?: boolean, flow?: 'v2_today' | 'v2_canvas', rubric?: boolean } = {}) {
  const definition = { configurationId: 'canvas.synthetic', configurationVersion: 'canvas.synthetic.v1', kind: 'legacy_baseline' as const,
    requestedModel: 'synthetic/model', endpoint: null, identity: { mappingVersion: 'synthetic.identity.v1', canonicalModel: 'synthetic/model',
      family: 'synthetic', snapshotAssurance: 'unknown' as const, verifiedReturnedModels: [] } }
  const saved = await sealLearnScorerConfiguration(definition)
  const registry = await createLearnScorerRegistry({ epoch: 'synthetic.epoch.v1', configurations: [{ definition, expectedDigest: saved.binding.configurationDigest }],
    legacyAllowlist: [definition.configurationId], prospectiveConfigurationId: null })
  policy.scorer = { registry, saved }
  policy.protocol = options.rubric === false ? syntheticDeliveryProtocol(NOW) : learnMeasurementProtocolSchema.parse({ ...syntheticDeliveryProtocol(NOW, true), scoringBinding: saved.binding })
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { pilotApproved: true,
    startsAt: new Date(NOW - 86_400_000).toISOString(), endsAt: new Date(NOW + 86_400_000).toISOString(),
    cohort: { ...originalManifest.cohort, subjectHashes: [await privacyDigest(['adaptive-v2-pilot-cohort.v1', OWNER.tokenIdentifier])] },
    modelPolicies: [{ model: 'synthetic/model', inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.1 }],
    productControls: { ...originalManifest.productControls, maxDispatchesPerHour: 4, maxDispatchesPerDay: 8, maxConcurrent: 2, maxReservedMicroUsdPerDay: 100_000 },
    rollback: { ...originalManifest.rollback, ownerSubjectHash: await privacyDigest(['adaptive-v2-rollback-owner.tokenIdentifier-sha256.v1', OWNER.tokenIdentifier]) } })
  const family = await canvasFamilyFixture(saved.binding, { rubric: options.rubric !== false })
  const { t, owner, graph } = family
  // The entry adapter consumes an already authorized flow and prepared session envelope.
  // Enrollment, family publication and all subsequent grant/accept/score commands run their real registered boundaries.
  const enrolled = await owner.mutation(measurement.enrollProspect, { studySessionId: graph.studySessionId, familyId: family.begun.familyId, entryPoint: 'today' })
  if (enrolled.status !== 'admitted' || !enrolled.assignmentId) throw new Error(JSON.stringify(enrolled))
  const prepared = await t.run(async ctx => {
    const user = (await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', OWNER.tokenIdentifier)).unique())!
    await ctx.db.patch(user._id, { learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: NOW } })
    const opportunity = (await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_assignmentId_and_horizonDays', q =>
      q.eq('userId', OWNER.tokenIdentifier).eq('assignmentId', enrolled.assignmentId!).eq('horizonDays', undefined)).unique())!
    if (opportunity.assessmentPins.kind !== 'measurement' || opportunity.contextPins.kind === 'calibration') throw new Error('Expected measurement')
    const item = (await ctx.db.get(opportunity.assessmentPins.itemPins.itemId))!
    const sessionContentId = await ctx.db.insert('sessionContent', { userId: OWNER.tokenIdentifier, studySessionId: graph.studySessionId,
      studyPlanRevisionId: graph.studyPlanRevisionId, blueprintRevisionId: graph.blueprintRevisionId, objectiveId: graph.objectiveId,
      revision: 1, status: 'published', inputDigest: HASH, generatorVersion: 'generator.v1', providerModel: 'synthetic/model',
      assessmentPurpose: 'measurement_cold', assessmentOpportunityId: opportunity._id,
      createdAt: NOW, publishedAt: NOW })
    await ctx.db.patch(graph.studySessionId, { status: 'ready', assessmentPurpose: 'measurement_cold', assessmentOpportunityId: opportunity._id, timezone: 'UTC', assistanceRevision: 0 })
    await ctx.db.patch(opportunity._id, { contextPins: { ...opportunity.contextPins, kind: 'session', studySessionId: graph.studySessionId,
      sessionRevision: 1, sessionContentId, contentRevision: 1, contentInputDigest: HASH, generatorVersion: 'generator.v1' },
      deliveryPins: { version: LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION, confidenceRequested: true } })
    await ctx.db.patch(enrolled.assignmentId!, { flow: options.flow ?? 'v2_canvas', entryPoint: options.flow === 'v2_today' ? 'today' : 'canvas' })
    await ctx.db.insert('sessionContentBlocks', { userId: OWNER.tokenIdentifier, sessionContentId, order: 0, kind: 'explanation', content: 'PRIVATE EXPLANATION' })
    const claims = await ctx.db.query('learnMeasurementClaims').withIndex('by_userId_and_itemId_and_order', q => q.eq('userId', OWNER.tokenIdentifier).eq('itemId', item._id)).take(33)
    const support = (await ctx.db.query('learnMeasurementSupports').withIndex('by_userId_and_claimId', q => q.eq('userId', OWNER.tokenIdentifier).eq('claimId', claims[0]!._id)).first())!
    return { opportunityId: opportunity._id, prompt: item.prompt!, sessionContentId, itemId: item._id, claimId: claims[0]!._id, supportId: support._id }
  })
  const attach = { studySessionId: graph.studySessionId, expectedSessionRevision: 1, idempotencyKey: `adaptive-ready-${crypto.randomUUID?.() ?? Date.now()}` }
  const attached = options.attach === false ? null : await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, attach)
  if (attached && attached.kind !== 'attached') throw new Error(JSON.stringify(attached))
  const activity = attached ? await t.run(ctx => ctx.db.query('learningThreadActivities').withIndex('by_userId_and_activityId', q =>
    q.eq('userId', OWNER.tokenIdentifier).eq('activityId', attached.activityId)).unique()) : null
  const f = { ...graph, studySessionId: graph.studySessionId, threadId: attached?.threadId, activityId: activity?._id,
    rows: { learnAssessmentOpportunities: prepared.opportunityId, learnMeasurementClaims: prepared.claimId, learnMeasurementSupports: prepared.supportId } }
  const stage = attached ? { threadId: attached.threadId, activityId: attached.activityId, studySessionId: graph.studySessionId, expectedRevision: 1, expectedSessionRevision: 2,
    response: answer, confidence: 3, idempotencyKey: `adaptive-canvas-submit-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}` } : null
  const canonical = { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'today_submission_1234567890',
    response: { target: { assessmentOpportunityId: prepared.opportunityId }, expectedRevision: 2, payload: { kind: 'text' as const, text: answer }, confidence: 3 } } }
  return { t, owner, f, stage: stage!, canonical, attach, attached, family, prepared, prompt: prepared.prompt,
    reference: { version: LEARN_V2_PUBLIC_API_VERSION, assessmentOpportunityId: prepared.opportunityId } }
}

function modelReply(awarded = true, key = 'private-criterion') {
  return new Response(JSON.stringify({ id: 'synthetic-execution', model: 'synthetic/model', choices: [{ index: 0, finish_reason: 'stop',
    message: { role: 'assistant', content: JSON.stringify({ criterionResults: [{ key, awarded }], misconceptionTags: [] }) } }],
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
  const t = convexTest(schema, modules)
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
    expectedSessionRevision: 2, expectedRevision: 1, response: answer, confidence: 3,
    idempotencyKey: `adaptive-canvas-submit-${shape === 'uuid' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}` }
  expect(await s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, stage)).toMatchObject({ kind: 'accepted', phase: 'submitted_sealed' })
  await expect(s.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { ...stage, idempotencyKey: `adaptive-canvas-submit:${suffix}` })).rejects.toThrow(/URL-safe/)
})

test.each(['numeric', 'keyed', 'ordered'] as const)('unsupported %s Canvas checks cannot consume a grant', async format => {
  const s = await fixture({ attach: false, rubric: false })
  if (format !== 'numeric') await s.t.run(ctx => ctx.db.patch(s.prepared.itemId, { responseSpec: format === 'keyed'
    ? { kind: 'keyed', version: 'response.v1', maxSelections: 1 } : { kind: 'ordered', version: 'response.v1', maxEntries: 3 } }))
  expect(await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, s.attach)).toEqual({ kind: 'not_admitted', observations: 'no_observations', reasonCode: 'response_format_unavailable' })
  expect(await s.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(8))).toEqual([])
  expect(await s.t.run(ctx => ctx.db.query('learningThreads').take(8))).toEqual([])
})

test.each(['preparing', 'invalid', 'cancelled', 'abandoned', 'outside_window', 'protocol', 'pilot', 'source'] as const)('unavailable attachment (%s) returns no observation and creates no wrapper or grant', async state => {
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
    expect(await ctx.db.query('learningThreads').take(8)).toEqual([])
    expect((await ctx.db.get(s.prepared.opportunityId))!.contextPins).not.toHaveProperty('canvas')
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
  expect(await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, s.attach)).toMatchObject({ kind: 'not_admitted', reasonCode: 'assessment_unavailable', observations: 'no_observations' })
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
        kind: 'transfer_challenge', content: selectedPrompt })
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
  const attached = await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, s.attach)
  if (attached.kind !== 'attached') throw new Error(JSON.stringify(attached))
  return { ...s, prompt: selectedPrompt, attached, stage: { threadId: attached.threadId, activityId: attached.activityId, studySessionId: s.f.studySessionId,
    expectedSessionRevision: 2, expectedRevision: 1, response: answer, confidence: 3, idempotencyKey: `adaptive-canvas-submit-${crypto.randomUUID()}` } }
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

test.each(['v2_canvas', 'v2_today'] as const)('merged Today start races Canvas attachment without changing the %s stratum', async flow => {
  const s = await fixture({ attach: false, flow })
  const [canvas, today] = await Promise.all([
    s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, s.attach),
    s.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: s.f.studySessionId,
      expectedSessionRevision: 1, expectedContentRevision: 1, idempotencyKey: 'merged_today_canvas_race_1234567890', entryPoint: 'today' }),
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
