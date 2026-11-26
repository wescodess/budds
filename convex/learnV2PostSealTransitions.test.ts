/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import { makeFunctionReference } from 'convex/server'
import type { Id } from './_generated/dataModel'
import { assessmentDeliveryFixture, deliveryIdentity, publishDeliveryTeaching, syntheticDeliveryProtocol, type DeliveryTeachingShape } from '../tests/fixtures/learn-v2-assessment-delivery'
import { canvasFamilyFixture } from '../tests/fixtures/learn-v2-canvas'
import { createLearnScorerRegistry, sealLearnScorerConfiguration } from './lib/learnV2ScorerConfig'
import { prepareAndRegisterInstructionalArtifactsForOwner, instructionalReservationSemanticAdapter, normalizedInstructionalCaseFingerprints } from './lib/learnV2ArtifactLineage'
import { measurementItemAdapters } from './lib/learnV2MeasurementItems'
import { measurementCaseExposed } from './lib/learnV2Measurement'
import * as casePrompt from '../shared/learn-v2-case-prompt'
import { privacyDigest } from './lib/learnV2ResponsePrivacy'
import { postSealApplicationFields } from './lib/learnV2PostSealStamp'
import { measurementClock } from './lib/learnV2MeasurementAssignment'
import { ADAPTIVE_V2_PILOT_MANIFEST } from '../shared/adaptive-v2-pilot-policy'
import { LEARN_V2_POST_SEAL_TEACHING_VERSION as version } from '../shared/learn-v2-assessment-disclosure'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION } from '../shared/learn-v2-responses'
import { LEARN_V2_PUBLIC_API_VERSION } from './lib/learnV2PublicContract'
import { learnV2CanvasMeasurementApi } from './learnV2ApiAdapters'
import { closeUnplayableLearnCheck } from './lib/learnV2MeasurementDueWork'
import { learnAssessmentBoundSurface, LEARN_CHECK_SURFACE_VERSION } from '../shared/learn-v2-measurement'
import { learnReportCheckSurface } from '../shared/learn-v2-measurement-report'
import { seedFixedCheckPlan } from '../tests/fixtures/learn-v2-fixed-check-plan'

const policy = vi.hoisted(() => ({ protocol: null as unknown, scorer: null as unknown, todayCanvas: false }))
vi.mock('../shared/learn-v2-measurement-storage-manifest', async original => {
  const value = await original<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...value, LEARN_MEASUREMENT_CAPABILITIES: { ...value.LEARN_MEASUREMENT_CAPABILITIES,
    responses: true, enrollment: true, delivery: true, scoring: true, get todayCanvasChecks() { return policy.todayCanvas } } }
})
vi.mock('./lib/learnV2MeasurementAssignment', async original => {
  const value = await original<typeof import('./lib/learnV2MeasurementAssignment')>()
  return { ...value, getFrozenLearnMeasurementProtocol: () => policy.protocol }
})
vi.mock('./lib/learnV2MeasurementScorerInventory', () => ({ getLearnMeasurementScorer: async (binding?: { configurationId: string }) => {
  const scorer = policy.scorer as { registry: unknown, saved: unknown, legacy?: { binding: { configurationId: string } } } | null
  return scorer?.legacy && scorer.legacy.binding.configurationId === binding?.configurationId ? { ...scorer, saved: scorer.legacy } : scorer
} }))

const originalManifest = structuredClone(ADAPTIVE_V2_PILOT_MANIFEST)
const materializeDue = makeFunctionReference<'mutation', { userId: string, through: number }>('learnV2MeasurementDueWork:materializeDelayedCheckEligibility')
const enrollProspect = makeFunctionReference<'mutation', { studySessionId: Id<'studySessions'>, familyId?: Id<'learnMeasurementFamilies'>,
  entryPoint: 'today' | 'session_deep_link' | 'canvas' }>('learnV2Measurement:enrollProspect')
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(Date.parse('2027-03-07T15:00:00Z'))
  policy.protocol = syntheticDeliveryProtocol(); policy.scorer = null; policy.todayCanvas = false
  vi.spyOn(instructionalReservationSemanticAdapter, 'compare').mockResolvedValue({ decision: 'pass', coverage: 'complete' })
})
afterEach(() => {
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, originalManifest)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers()
})

type TeachingOptions = { blocks?: DeliveryTeachingShape['blockContents'], pass?: boolean }
async function fixture(canvas = false, collision?: 'identical' | 'normalized' | 'near', lineage?: 'sibling' | 'unknown', options: TeachingOptions = {}) {
  const definition = { configurationId: 'post-seal.synthetic', configurationVersion: 'post-seal.synthetic.v1',
    kind: canvas ? 'measurement_rubric' as const : 'legacy_baseline' as const, requestedModel: 'synthetic/model', endpoint: null,
    identity: { mappingVersion: 'synthetic.identity.v1', canonicalModel: 'synthetic/model', family: 'synthetic',
      snapshotAssurance: 'unknown' as const, verifiedReturnedModels: [] } }
  const saved = await sealLearnScorerConfiguration(definition)
  const baseline = { ...definition, configurationId: 'post-seal.baseline', kind: 'legacy_baseline' as const }
  const legacy = await sealLearnScorerConfiguration(baseline)
  const registry = await createLearnScorerRegistry({ epoch: 'synthetic.epoch.v1', configurations: [
    { definition, expectedDigest: saved.binding.configurationDigest }, ...(canvas ? [{ definition: baseline, expectedDigest: legacy.binding.configurationDigest }] : [])],
  legacyAllowlist: [canvas ? baseline.configurationId : definition.configurationId], prospectiveConfigurationId: null })
  policy.scorer = { registry, saved, legacy }
  if (canvas) policy.protocol = { ...syntheticDeliveryProtocol(Date.now(), true), scoringBinding: saved.binding }
  const f = canvas ? await canvasFamilyFixture(saved.binding, { rubric: true, transactionLimits: true })
    : await assessmentDeliveryFixture({ transactionLimits: true })
  const legacyPrompt = 'TEACHING-CANARY-independent_application: Seven parcels contain eleven spare parts apiece. Determine the shipment inventory.'
  const legacyPractice = collision === 'identical' ? legacyPrompt : collision === 'normalized'
    ? `  ${legacyPrompt.toUpperCase().replaceAll(' ', '  \n')}  ` : legacyPrompt.replace('inventory', 'stock')
  const guard = collision ? vi.spyOn(casePrompt, 'learnCasePromptsMatch').mockReturnValue(false) : null
  let contentId: Id<'sessionContent'>
  try { contentId = await publishDeliveryTeaching(f, collision || options.blocks ? { claims: 1, supports: 1,
    blockContents: { ...options.blocks, ...(collision ? { faded_example: legacyPractice } : {}) } } : undefined) }
  finally { guard?.mockRestore() }
  const blocks = await f.t.run(ctx => ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('sessionContentId', contentId)).take(16))
  const registered = await f.owner.run(ctx => prepareAndRegisterInstructionalArtifactsForOwner(ctx, deliveryIdentity.tokenIdentifier, {
    artifacts: blocks.filter(block => !lineage || block.kind !== 'faded_example').map(block => ({
      artifact: { kind: 'session_block', id: block._id }, key: 'whole', origins: [], sources: [{ kind: 'excerpt',
        sourceSnapshotId: f.graph.sourceSnapshotId, sourceExcerptId: f.graph.sourceExcerptId, revision: 1, recordRevision: 1,
        contentHash: f.graph.support.sourceContentHash }],
    })),
  }))
  if (lineage === 'sibling') {
    const check = blocks.find(block => block.kind === 'independent_application')!
    const origin = registered.references.find(reference => reference.artifact.id === check._id)!
    await f.owner.run(ctx => prepareAndRegisterInstructionalArtifactsForOwner(ctx, deliveryIdentity.tokenIdentifier, { artifacts: [{
      artifact: { kind: 'session_block', id: blocks.find(block => block.kind === 'faded_example')!._id }, key: 'whole',
      origins: [{ reference: origin, transformation: 'rewrite' }], sources: [],
    }] }))
  }
  for (const name of ['OPENROUTER_API_KEY', 'CF_ACCOUNT_ID', 'CLOUDFLARE_AI_GATEWAY_ID']) vi.stubEnv(name, 'synthetic-unused')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'post-seal-synthetic-execution', model: 'synthetic/model',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
      criterionResults: [{ key: canvas ? 'private-criterion' : 'accuracy', awarded: options.pass !== false }], misconceptionTags: [] }) } }],
    usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 }, openrouter_metadata: { requested: 'synthetic/model', strategy: 'direct', attempt: 1,
      endpoints: { available: [{ provider: 'Synthetic Provider', model: 'synthetic/model', selected: true }] }, pipeline: [] } }))))
  const reference = (id: Id<'learnAssessmentOpportunities'>) => ({ version, assessmentOpportunityId: id })
  const read = (id: Id<'learnAssessmentOpportunities'>) => f.owner.query(api.learnV2Assessments.getPostSealTeaching, reference(id))
  const open = (id: Id<'learnAssessmentOpportunities'>) => f.owner.mutation(api.learnV2PostSealTeaching.openPractice, reference(id))
  const score = (submissionId: Id<'learnResponses'>) => f.owner.action(api.learnV2Mastery.scoreMasterySubmission, {
    version: LEARN_V2_PUBLIC_API_VERSION, submissionId, idempotencyKey: 'post_seal_transition_score_12345' })
  return { ...f, contentId, read, open, score }
}

async function cold(f: Awaited<ReturnType<typeof fixture>>) {
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: f.graph.studySessionId,
    expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'post_seal_transition_cold_12345', entryPoint: 'today' })).toMatchObject({ status: 'assessment' })
  const row = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').take(8))).find(row => row.purpose.kind === 'measurement_cold')!
  const receipt = await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: {
    version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'post_seal_transition_seal_12345', response: {
      target: { assessmentOpportunityId: row._id }, expectedRevision: row.revision, payload: { kind: 'numeric', value: 0, unit: 'members' } } } })
  if (receipt.kind !== 'accepted') throw new Error('Expected cold acceptance')
  return row
}

async function ordinary(assisted = false, collision?: 'identical' | 'normalized' | 'near', lineage?: 'sibling' | 'unknown', options: TeachingOptions = {}) {
  const f = await fixture(false, collision, lineage, options)
  const first = await cold(f)
  const coldSubmissionId = (await f.t.run(ctx => ctx.db.get(first._id)))!.submissionId!
  expect(await f.score(coldSubmissionId)).toMatchObject({ status: 'scored' })
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: f.graph.studySessionId,
    expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'post_seal_transition_teach_12345', entryPoint: 'today' })).toMatchObject({ status: 'in_progress' })
  const row = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').take(8))).find(row => row.purpose.kind === 'independent_application')!
  if (assisted) expect(await f.owner.mutation(api.learnV2Assistance.authorizeAssistance, { version: LEARN_V2_PUBLIC_API_VERSION,
    assessmentOpportunityId: row._id, kind: 'hint', idempotencyKey: 'post_seal_ordinary_hint_12345' })).toMatchObject({ status: 'authorized' })
  const receipt = await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: {
    version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'post_seal_transition_ordinary_12345', response: {
      target: { assessmentOpportunityId: row._id }, expectedRevision: row.revision,
      payload: { kind: 'text', text: 'A supported ordinary application.' }, confidence: 3 } } })
  if (receipt.kind !== 'accepted') throw new Error('Expected ordinary acceptance')
  return { ...f, row, receipt }
}

test.each(['identical', 'normalized', 'near'] as const)('legacy publication cannot expose a %s ordinary check as practice', async collision => {
  const f = await ordinary(false, collision)
  if (collision === 'near') {
    const compare = vi.mocked(measurementItemAdapters.compare)
    const original = compare.getMockImplementation()!
    compare.mockImplementation(async input => JSON.stringify(input.content).includes('stock')
      ? { decision: 'reject' as const, coverage: 'complete' as const } : original(input))
  }
  expect(await f.score(f.receipt.submissionId)).toMatchObject({ status: 'scored' })
  expect(await f.open(f.row._id)).toMatchObject({ status: 'available', practice: null, availability: { practice: { status: 'unavailable', reasonCode: 'disclosure_unknown' } } })
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealPracticeBindings').take(2))).toEqual([])
  expect(await f.t.run(ctx => ctx.db.query('learnResponseSlots').take(2))).toEqual([])
})

const ordinaryPrompt = 'TEACHING-CANARY-independent_application: Seven parcels contain eleven spare parts apiece. Determine the shipment inventory.'
const feedbackClaim = 'TEACHING-CLAIM-CANARY: the source supports the separate practice case.'

async function ordinarySource(f: Awaited<ReturnType<typeof ordinary>>) {
  return (await f.t.run(ctx => ctx.db.query('learnPostSealTeachingSources').withIndex('by_userId_and_submissionId', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('submissionId', f.receipt.submissionId)).unique()))!
}
function deliveryKind(value: unknown) {
  if (!value || typeof value !== 'object' || !('delivery' in value)) return null
  const delivery = value.delivery
  return delivery && typeof delivery === 'object' && 'kind' in delivery ? delivery.kind : null
}

test.each([
  ['hint', false], ['hint', true], ['worked_example', false], ['worked_example', true],
] as const)('post-seal %s denies the ordinary check as help, canonical=%s', async (kind, canonical) => {
  const f = await ordinary(false, undefined, undefined, { pass: false, blocks: {
    [kind === 'hint' ? 'explanation' : 'worked_example']: canonical ? ` ${ordinaryPrompt.toUpperCase().replaceAll(' ', '\n  ')} ` : ordinaryPrompt,
  } })
  expect(await f.score(f.receipt.submissionId)).toMatchObject({ status: 'scored' })
  const opened = await f.open(f.row._id)
  if (opened.status !== 'available' || !opened.practice) throw new Error('Expected separate practice')
  expect(await f.owner.mutation(api.learnV2Assistance.authorizePracticeAssistance, { version, assessmentOpportunityId: f.row._id,
    target: { responseSlotId: opened.practice.responseSlotId }, expectedRevision: 1, kind, idempotencyKey: 'check_as_help_denied_12345' }))
    .toMatchObject({ status: 'denied', reasonCode: 'disclosure_unknown' })
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealHelpReceipts').take(2))).toEqual([])
})

test.each([
  ['feedback', false], ['feedback', true], ['lesson', false], ['lesson', true],
] as const)('post-seal %s cannot publish the ordinary check, canonical=%s', async (kind, canonical) => {
  const f = await ordinary(false, undefined, undefined, kind === 'feedback'
    ? { blocks: { independent_application: canonical ? ` ${feedbackClaim.toUpperCase().replaceAll(' ', '\n  ')} ` : feedbackClaim } }
    : { pass: false, blocks: { explanation: canonical ? ` ${ordinaryPrompt.toUpperCase().replaceAll(' ', '\n  ')} ` : ordinaryPrompt } })
  expect(await f.score(f.receipt.submissionId)).toMatchObject({ status: 'scored' })
  expect(await f.read(f.row._id)).toMatchObject({ status: 'available', feedback: null, lesson: null })
  const source = await ordinarySource(f)
  expect(source).toMatchObject({ content: { status: 'pending' }, sourceDependencyCount: 0 })
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealSourceLinks').withIndex('by_userId_and_target_teachingSourceId', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('target.teachingSourceId', source._id)).take(2))).toEqual([])
})

test.each(['hint', 'worked_example', 'feedback', 'lesson'] as const)('post-seal %s requires a complete comparison before delivery', async kind => {
  const f = await ordinary(false, undefined, undefined, { pass: false })
  const compare = vi.mocked(measurementItemAdapters.compare)
  const original = compare.getMockImplementation()!
  compare.mockImplementation(async input => deliveryKind(input.content) === kind
    ? { decision: 'unknown' as const, coverage: 'unknown' as const } : original(input))
  expect(await f.score(f.receipt.submissionId)).toMatchObject({ status: 'scored' })
  if (kind === 'feedback' || kind === 'lesson') {
    expect(await ordinarySource(f)).toMatchObject({ content: { status: 'pending' }, sourceDependencyCount: 0 })
    expect(await f.read(f.row._id)).toMatchObject({ status: 'available', feedback: null, lesson: null })
  } else {
    const opened = await f.open(f.row._id)
    if (opened.status !== 'available' || !opened.practice) throw new Error('Expected practice')
    expect(await f.owner.mutation(api.learnV2Assistance.authorizePracticeAssistance, { version, assessmentOpportunityId: f.row._id,
      target: { responseSlotId: opened.practice.responseSlotId }, expectedRevision: 1, kind, idempotencyKey: 'unknown_help_comparison_12345' }))
      .toMatchObject({ status: 'denied', reasonCode: 'disclosure_unknown' })
  }
  expect(compare.mock.calls.some(([input]) => deliveryKind(input.content) === kind)).toBe(true)
})

test('post-seal distinct artifacts pass one shared proof and preserve replay', async () => {
  const f = await ordinary(false, undefined, undefined, { pass: false })
  const compare = vi.mocked(measurementItemAdapters.compare)
  compare.mockClear()
  expect(await f.score(f.receipt.submissionId)).toMatchObject({ status: 'scored', result: { scorePercent: 0 } })
  expect(await f.read(f.row._id)).toMatchObject({ status: 'available', feedback: { tier: 'T0' }, lesson: { tier: 'T0' } })
  const opened = await f.open(f.row._id)
  if (opened.status !== 'available' || !opened.practice) throw new Error('Expected practice')
  for (const kind of ['hint', 'worked_example'] as const) {
    const request = { version, assessmentOpportunityId: f.row._id, target: { responseSlotId: opened.practice.responseSlotId },
      expectedRevision: 1, kind, idempotencyKey: `separate_${kind}_replay_12345` }
    const delivered = await f.owner.mutation(api.learnV2Assistance.authorizePracticeAssistance, request)
    expect(delivered).toMatchObject({ status: 'authorized', content: { kind, tier: 'T0' } })
    const comparisons = compare.mock.calls.length
    expect(await f.owner.mutation(api.learnV2Assistance.authorizePracticeAssistance, request)).toEqual(delivered)
    expect(compare).toHaveBeenCalledTimes(comparisons)
  }
  expect(new Set(compare.mock.calls.map(([input]) => deliveryKind(input.content)))).toEqual(new Set(['practice', 'feedback', 'lesson', 'hint', 'worked_example']))
  const comparisons = compare.mock.calls.length
  expect(await f.read(f.row._id)).toMatchObject({ status: 'available', feedback: { tier: 'T0' }, lesson: { tier: 'T0' } })
  expect(compare).toHaveBeenCalledTimes(comparisons)
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealHelpReceipts').take(3))).toHaveLength(2)
})

test.each([
  ['Using the provided atlas, identify the capital city of France.', 'Using the provided atlas, identify the capital city of Japan.'],
  ['Calculate 123 + 456', 'Calculate 123 - 456'],
])('post-seal distinct cases are delivered after a complete comparison: %s', async (practice, check) => {
  const f = await ordinary(false, undefined, undefined, { blocks: { faded_example: practice!, independent_application: check! } })
  expect(await f.score(f.receipt.submissionId)).toMatchObject({ status: 'scored' })
  expect(await f.open(f.row._id)).toMatchObject({ status: 'available', practice: { prompt: practice } })
})

test.each(['feedback', 'hint'] as const)('post-seal %s comparison propagates unexpected resource errors', async kind => {
  const f = await ordinary(false, undefined, undefined, { pass: false })
  if (kind === 'hint') expect(await f.score(f.receipt.submissionId)).toMatchObject({ status: 'scored' })
  const compare = vi.mocked(measurementItemAdapters.compare)
  const original = compare.getMockImplementation()!
  compare.mockImplementation(async input => {
    if (deliveryKind(input.content) === kind) throw new Error('Read limit exceeded')
    return original(input)
  })
  if (kind === 'feedback') {
    await expect(f.score(f.receipt.submissionId)).rejects.toThrow('Read limit exceeded')
    expect(await f.t.run(ctx => ctx.db.get(f.row._id))).toMatchObject({ phase: 'scored_fail' })
    expect(await ordinarySource(f)).toMatchObject({ content: { status: 'pending' }, sourceDependencyCount: 0 })
  } else {
    const opened = await f.open(f.row._id)
    if (opened.status !== 'available' || !opened.practice) throw new Error('Expected practice')
    await expect(f.owner.mutation(api.learnV2Assistance.authorizePracticeAssistance, { version, assessmentOpportunityId: f.row._id,
      target: { responseSlotId: opened.practice.responseSlotId }, expectedRevision: 1, kind, idempotencyKey: 'help_resource_failure_12345' }))
      .rejects.toThrow('Read limit exceeded')
    expect(await f.t.run(ctx => ctx.db.query('learnPostSealHelpReceipts').take(2))).toEqual([])
  }
})

test.each(['hint', 'worked_example'] as const)('post-seal %s replay rechecks the saved content against the check', async kind => {
  const f = await ordinary(false, undefined, undefined, { pass: false })
  expect(await f.score(f.receipt.submissionId)).toMatchObject({ status: 'scored' })
  const opened = await f.open(f.row._id)
  if (opened.status !== 'available' || !opened.practice) throw new Error('Expected practice')
  const request = { version, assessmentOpportunityId: f.row._id, target: { responseSlotId: opened.practice.responseSlotId },
    expectedRevision: 1, kind, idempotencyKey: 'saved_help_collision_12345' }
  expect(await f.owner.mutation(api.learnV2Assistance.authorizePracticeAssistance, request)).toMatchObject({ status: 'authorized' })
  const receipt = (await f.t.run(ctx => ctx.db.query('learnPostSealHelpReceipts').take(2)))[0]!
  if (receipt.content.status !== 'available') throw new Error('Expected saved receipt')
  const payload = { ...receipt.content.payload, text: ordinaryPrompt }
  const content = { ...receipt.content, payload, publication: { ...receipt.content.publication, payloadDigest: await privacyDigest(payload) } }
  await f.t.run(async ctx => {
    await ctx.db.patch(receipt._id, { content })
    await ctx.db.patch(receipt.authorizationId, { projectionDigest: await privacyDigest(payload) })
  })
  expect(await f.owner.mutation(api.learnV2Assistance.authorizePracticeAssistance, request)).toMatchObject({ status: 'denied', reasonCode: 'disclosure_unknown' })
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealHelpReceipts').take(3))).toHaveLength(1)
})

test.each(['feedback', 'lesson'] as const)('post-seal %s read rechecks the saved content against the check', async kind => {
  const f = await ordinary(false, undefined, undefined, { pass: false })
  expect(await f.score(f.receipt.submissionId)).toMatchObject({ status: 'scored' })
  const source = await ordinarySource(f)
  if (source.content.status !== 'available' || !source.content.payload.feedback || !source.content.payload.lesson) throw new Error('Expected published teaching')
  const payload = { ...source.content.payload, feedback: kind === 'feedback' ? { ...source.content.payload.feedback, text: ordinaryPrompt } : source.content.payload.feedback,
    lesson: kind === 'lesson' ? { ...source.content.payload.lesson, paragraphs: [ordinaryPrompt] } : source.content.payload.lesson }
  const content = { ...source.content, payload, publication: { ...source.content.publication, payloadDigest: await privacyDigest(payload) } }
  await f.t.run(ctx => ctx.db.patch(source._id, { content }))
  expect(await f.read(f.row._id)).toEqual({ version, status: 'unavailable', reasonCode: 'disclosure_unknown' })
  expect((await ordinarySource(f)).content).toEqual(content)
})

test.each(['sibling', 'unknown'] as const)('ordinary practice rejects %s lineage', async lineage => {
  const f = await ordinary(false, undefined, lineage)
  expect(await f.score(f.receipt.submissionId)).toMatchObject({ status: 'scored' })
  expect(await f.open(f.row._id)).toMatchObject({ status: 'available', practice: null, availability: { practice: { status: 'unavailable', reasonCode: 'disclosure_unknown' } } })
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealPracticeBindings').take(2))).toEqual([])
})

test.each([
  { label: 'sibling', decision: 'reject', coverage: 'complete' },
  { label: 'unknown relationship', decision: 'unknown', coverage: 'unknown' },
  { label: 'incomplete comparison', decision: 'pass', coverage: 'unknown' },
] as const)('ordinary practice denies a %s verdict for the exact sealed pair', async verdict => {
  const f = await ordinary()
  expect(await f.score(f.receipt.submissionId)).toMatchObject({ status: 'scored' })
  const compare = vi.spyOn(measurementItemAdapters, 'compare').mockResolvedValue(verdict)
  expect(await f.open(f.row._id)).toMatchObject({ status: 'available', practice: null, availability: { practice: { status: 'unavailable', reasonCode: 'disclosure_unknown' } } })
  if (f.row.assessmentPins.kind !== 'session_application') throw new Error('Expected ordinary check')
  expect(compare).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'instructional',
    corpus: [expect.objectContaining({ _id: f.row.assessmentPins.caseId, usageClass: 'instructional' })],
    content: expect.objectContaining({ check: expect.objectContaining({ caseId: f.row.assessmentPins.caseId, pins: f.row.assessmentPins }) }) }))
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealPracticeBindings').take(2))).toEqual([])
})

test('a separate ordinary practice case is proved once and its prompt case owns both exposures', async () => {
  const f = await ordinary()
  expect(await f.score(f.receipt.submissionId)).toMatchObject({ status: 'scored' })
  const compare = vi.spyOn(measurementItemAdapters, 'compare')
  compare.mockClear()
  const opened = await f.open(f.row._id)
  if (opened.status !== 'available' || !opened.practice) throw new Error('Expected practice')
  expect(compare).toHaveBeenCalledOnce()
  expect(await f.open(f.row._id)).toEqual(opened)
  await f.read(f.row._id)
  expect(compare).toHaveBeenCalledOnce()
  expect(await f.owner.mutation(api.learnV2Assistance.authorizePracticeAssistance, { version, assessmentOpportunityId: f.row._id,
    target: { responseSlotId: opened.practice.responseSlotId }, expectedRevision: 1, kind: 'worked_example', idempotencyKey: 'separate_prompt_help_12345' })).toMatchObject({ status: 'authorized' })
  const binding = (await f.t.run(ctx => ctx.db.query('learnPostSealPracticeBindings').take(2)))[0]!
  const promptCase = (await f.t.run(ctx => ctx.db.get(binding.practiceCaseId)))!
  expect(promptCase).toMatchObject(await normalizedInstructionalCaseFingerprints(opened.practice.prompt, opened.practice.prompt))
  const exposures = await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').withIndex('by_userId_and_caseId_and_serverTime', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('caseId', binding.practiceCaseId)).take(8))
  expect(exposures).toHaveLength(2)
  expect(exposures.filter(row => row.practiceHelp)).toHaveLength(1)
  expect(exposures.every(row => row.caseId === binding.practiceCaseId && row.assessmentOpportunityId === undefined)).toBe(true)
  expect(await f.t.run(ctx => measurementCaseExposed(ctx, deliveryIdentity.tokenIdentifier, binding.practiceCaseId))).toBe(true)
  expect(await f.t.run(ctx => measurementCaseExposed(ctx, deliveryIdentity.tokenIdentifier, binding.practiceCaseId, f.row._id))).toBe(true)
})

test.each([false, true])('ordinary scoring preserves teaching and immutable acceptance pins, assisted=%s', async assisted => {
  const f = await ordinary(assisted)
  const accepted = (await f.t.run(ctx => ctx.db.get(f.receipt.submissionId)))!
  if (accepted.scopeKind !== 'v2' || accepted.contextPins.kind !== 'session') throw new Error('Expected session pins')
  expect(accepted.assistanceSnapshot).toMatchObject({ state: assisted ? 'assisted' : 'unassisted' })
  expect(await f.score(f.receipt.submissionId)).toMatchObject({ status: 'scored', result: { scorePercent: 100 } })
  expect(await f.t.run(ctx => ctx.db.get(f.graph.studySessionId))).toMatchObject({ status: 'completed', revision: accepted.contextPins.sessionRevision + 1 })
  expect(await f.read(f.row._id)).toMatchObject({ status: 'available', feedback: { tier: 'T0' }, lesson: null })
  const opened = await f.open(f.row._id)
  if (opened.status !== 'available' || !opened.practice) throw new Error('Expected practice opening')
  expect(await f.owner.mutation(api.learnV2Assistance.authorizePracticeAssistance, { version, assessmentOpportunityId: f.row._id,
    target: { responseSlotId: opened.practice.responseSlotId }, expectedRevision: 1, kind: 'worked_example', idempotencyKey: 'completed_session_practice_hint_12345' }))
    .toMatchObject({ status: 'authorized' })
  expect(await f.owner.mutation(api.learnV2Responses.acceptResponse, { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: 'completed_session_practice_answer_12345', response: { target: { responseSlotId: opened.practice.responseSlotId }, expectedRevision: 1,
      payload: { kind: 'text', text: 'A separate supported practice response.' } } })).toMatchObject({ kind: 'accepted' })
  expect(await f.owner.query(api.learnV2Assessments.getAssessmentState, { version: LEARN_V2_PUBLIC_API_VERSION,
    assessmentOpportunityId: f.row._id })).toMatchObject({ status: 'unavailable' })
  expect(await f.score(f.receipt.submissionId)).toMatchObject({ status: 'scored' })
  expect(await f.t.run(ctx => ctx.db.get(f.receipt.submissionId))).toEqual(accepted)
  expect((await f.t.run(ctx => ctx.db.get(f.row._id)))!.contextPins).toEqual(accepted.contextPins)
})

test.each([{ pass: false, separate: true }, { pass: true, separate: true }, { pass: true, separate: false }])('retained-transfer teaching uses its exact Independent basis and a fresh pair proof: %j', async ({ pass, separate }) => {
  const f = await ordinary()
  expect(await f.score(f.receipt.submissionId)).toMatchObject({ status: 'scored', result: { scorePercent: 100 } })
  const basis = (await f.t.run(ctx => ctx.db.get(f.row._id)))!
  const basisAt = Date.now()
  vi.setSystemTime(basisAt + 7 * 86_400_000)
  const retained = await f.t.run(async ctx => {
    const userId = deliveryIdentity.tokenIdentifier
    const checks = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_learningVoidId', q =>
      q.eq('userId', userId).eq('learningVoidId', f.graph.learningVoidId)).take(8)
    for (const check of checks) if (check.horizonDays === 7) await ctx.db.patch(check._id, { phase: 'cancelled' })
    const prompt = 'Use six pallets with thirteen boxes each to determine the warehouse delivery total.'
    if (basis.assessmentPins.kind !== 'session_application' || basis.contextPins.kind !== 'session') throw new Error('Expected Independent basis')
    const checkCase = (await ctx.db.get(basis.assessmentPins.caseId))!
    const caseId = await ctx.db.insert('learnAssessmentCases', { ...postSealApplicationFields(checkCase),
      ...await normalizedInstructionalCaseFingerprints(prompt, prompt), caseKey: 'retained-transfer-case',
      usageClass: 'instructional', identityValidationId: checkCase.identityValidationId! })
    const validation = (await ctx.db.get(checkCase.identityValidationId!))!
    const catalog = (await ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', userId)).unique())!
    await ctx.db.patch(catalog._id, { catalogRevision: catalog.catalogRevision + 1 })
    const validationId = await ctx.db.insert('learnMeasurementValidations', { ...postSealApplicationFields(validation),
      subject: { kind: 'case', caseId }, comparedCatalogRevision: catalog.catalogRevision + 1 })
    await ctx.db.patch(caseId, { identityValidationId: validationId })
    const clock = measurementClock(syntheticDeliveryProtocol(), { at: basisAt, eventId: basis.authoritativeAttemptId! }, 'UTC', 7)
    const studySessionId = await ctx.db.insert('studySessions', { userId, studyPlanRevisionId: f.graph.studyPlanRevisionId,
      primaryObjectiveId: f.graph.objectiveId, status: 'ready', revision: 1, assistanceRevision: 0, scheduledStartAt: Date.now(), placementKind: 'retained_review', assessmentPurpose: 'retained_transfer' })
    const original = (await ctx.db.get(f.contentId))!
    const sessionContentId = await ctx.db.insert('sessionContent', { ...postSealApplicationFields(original), studySessionId,
      assessmentPurpose: 'retained_transfer' })
    await ctx.db.insert('sessionContentBlocks', { userId, sessionContentId, order: 0, kind: 'transfer_challenge', content: prompt, claimOrdersJson: '[0]' })
    const claims = await ctx.db.query('sessionContentClaims').withIndex('by_userId_and_sessionContentId_and_order', q =>
      q.eq('userId', userId).eq('sessionContentId', original._id)).take(32)
    for (const claim of claims) {
      const sessionContentClaimId = await ctx.db.insert('sessionContentClaims', { ...postSealApplicationFields(claim), sessionContentId })
      const supports = await ctx.db.query('learnClaimSupports').withIndex('by_userId_and_sessionContentClaimId', q =>
        q.eq('userId', userId).eq('sessionContentClaimId', claim._id)).take(8)
      for (const support of supports) await ctx.db.insert('learnClaimSupports', { ...postSealApplicationFields(support), sessionContentClaimId })
    }
    const { submissionId: _submission, scoringJobId: _job, authoritativeAttemptId: _attempt, deliveryGrantId: _grant,
      ...fields } = postSealApplicationFields(basis)
    const opportunityId = await ctx.db.insert('learnAssessmentOpportunities', { ...fields, phase: 'ready', revision: 1,
      purpose: { kind: 'retained_transfer', basisAttemptId: basis.authoritativeAttemptId!, clock },
      contextPins: { ...basis.contextPins, studySessionId, sessionContentId, sessionRevision: 1 },
      assessmentPins: { ...basis.assessmentPins, caseId, promptDigest: await privacyDigest(prompt) },
      openAt: clock.openAt, closeAt: clock.closeAt, dueAt: clock.dueAt, checkSequence: 1, originalSlot: true })
    await ctx.db.patch(studySessionId, { assessmentOpportunityId: opportunityId })
    await ctx.db.patch(sessionContentId, { assessmentOpportunityId: opportunityId })
    return { opportunityId, studySessionId, caseId }
  })
  const started = await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: retained.studySessionId,
    expectedSessionRevision: 1, expectedContentRevision: 1, idempotencyKey: 'retained_teaching_start_12345' })
  if (started.status !== 'assessment' || started.deliveryGrant?.status !== 'granted') throw new Error(`Expected retained grant: ${JSON.stringify(started)}`)
  const accepted = await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: {
    version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'retained_teaching_accept_12345', response: {
      target: { assessmentOpportunityId: retained.opportunityId }, expectedRevision: started.deliveryGrant.revision,
      payload: { kind: 'text', text: 'A retained transfer response.' }, confidence: 3 } } })
  if (accepted.kind !== 'accepted') throw new Error(`Expected retained acceptance: ${JSON.stringify(accepted)}`)
  expect(await f.t.run(ctx => ctx.db.get(accepted.submissionId))).toMatchObject({ validitySnapshot: { status: 'valid', masteryEligible: true } })
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: 'retained-synthetic-execution', model: 'synthetic/model',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
      criterionResults: [{ key: 'accuracy', awarded: pass }], misconceptionTags: [] }) } }],
    usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 }, openrouter_metadata: { requested: 'synthetic/model', strategy: 'direct', attempt: 1,
      endpoints: { available: [{ provider: 'Synthetic Provider', model: 'synthetic/model', selected: true }] }, pipeline: [] } })))
  const compare = vi.mocked(measurementItemAdapters.compare)
  const original = compare.getMockImplementation()!
  if (!separate) compare.mockImplementation(async input => deliveryKind(input.content)
    ? { decision: 'unknown', coverage: 'unknown' } : original(input))
  compare.mockClear()
  expect(await f.score(accepted.submissionId)).toMatchObject({ status: 'scored', result: { scorePercent: pass ? 100 : 0 } })
  if (!separate) {
    expect(await f.read(retained.opportunityId)).toMatchObject({ status: 'available', feedback: null, lesson: null,
      availability: { feedback: 'feedback_publishing', practice: { status: 'not_opened' } } })
    expect(await f.open(retained.opportunityId)).toMatchObject({ status: 'available', feedback: null, lesson: null, practice: null,
      availability: { feedback: 'feedback_publishing', practice: { status: 'unavailable', reasonCode: 'disclosure_unknown' } } })
    return
  }
  expect(await f.read(retained.opportunityId)).toMatchObject({ status: 'available', feedback: { tier: 'T0' },
    lesson: pass ? null : { tier: 'T0' }, availability: { feedback: 'available', practice: { status: 'not_opened' } } })
  expect(await f.open(retained.opportunityId)).toMatchObject({ status: 'available', feedback: { tier: 'T0' }, practice: { revision: 1 } })
  expect(compare.mock.calls.filter(([input]) => deliveryKind(input.content)).every(([input]) => input.corpus.length === 1
    && input.corpus[0]!._id === retained.caseId)).toBe(true)
  expect(new Set(compare.mock.calls.map(([input]) => deliveryKind(input.content)))).toEqual(new Set(pass ? ['feedback', 'practice'] : ['feedback', 'lesson', 'practice']))
})
test('an unrelated post-seal revision cannot impersonate scoring completion', async () => {
  const f = await ordinary()
  await f.t.run(ctx => ctx.db.patch(f.graph.studySessionId, { revision: 4 }))
  for (const result of [await f.read(f.row._id), await f.open(f.row._id)]) expect(result).toEqual({ version, status: 'unavailable', reasonCode: 'disclosure_unknown' })
})

test.each(['extra_revision', 'missing_transition', 'unconsumed_execution', 'assistance_changed'] as const)('post-seal completion proof rejects %s', async change => {
  const f = await ordinary()
  expect(await f.score(f.receipt.submissionId)).toMatchObject({ status: 'scored' })
  expect(await f.open(f.row._id)).toMatchObject({ status: 'available', practice: { revision: 1 } })
  await f.t.run(async ctx => {
    const row = (await ctx.db.get(f.row._id))!
    const attempt = (await ctx.db.get(row.authoritativeAttemptId!))!
    const session = (await ctx.db.get(f.graph.studySessionId))!
    if (change === 'extra_revision') await ctx.db.patch(session._id, { revision: session.revision + 1 })
    else if (change === 'missing_transition') await ctx.db.patch(attempt._id, { masteryTransitionReason: undefined })
    else if (change === 'unconsumed_execution') await ctx.db.patch(attempt.scoringExecutionId!, { authoritativeAttemptId: undefined })
    else await ctx.db.patch(session._id, { substantiveHintUsedAt: Date.now(), assistanceRevision: 1 })
  })
  expect(await f.read(f.row._id)).toEqual({ version, status: 'unavailable', reasonCode: 'disclosure_unknown' })
  expect(await f.open(f.row._id)).toEqual({ version, status: 'unavailable', reasonCode: 'disclosure_unknown' })
})

test('Canvas scoring preserves its sealed check and teaching authority', async () => {
  const f = await fixture(true)
  const studySessionId = await f.t.run(ctx => ctx.db.insert('studySessions', { userId: deliveryIdentity.tokenIdentifier,
    studyPlanRevisionId: f.graph.studyPlanRevisionId, primaryObjectiveId: f.graph.objectiveId, status: 'planned', revision: 1, scheduledStartAt: Date.now() }))
  await publishDeliveryTeaching({ t: f.t, graph: { ...f.graph, studySessionId } })
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { pilotApproved: true, startsAt: new Date(Date.now() - 86_400_000).toISOString(),
    endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    cohort: { ...originalManifest.cohort, subjectHashes: [await privacyDigest(['adaptive-v2-pilot-cohort.v1', deliveryIdentity.tokenIdentifier])] },
    modelPolicies: [{ model: 'synthetic/model', inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.1 }],
    productControls: { ...originalManifest.productControls, maxDispatchesPerHour: 4, maxDispatchesPerDay: 8, maxConcurrent: 2, maxReservedMicroUsdPerDay: 100_000 },
    rollback: { ...originalManifest.rollback, ownerSubjectHash: await privacyDigest(['adaptive-v2-rollback-owner.tokenIdentifier-sha256.v1', deliveryIdentity.tokenIdentifier]) } })
  vi.stubEnv('LEARN_ADAPTIVE_V2_PILOT_MANIFEST', ADAPTIVE_V2_PILOT_MANIFEST.version)
  await f.t.run(async ctx => {
    const user = (await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', deliveryIdentity.tokenIdentifier)).unique())!
    await ctx.db.patch(user._id, { learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: Date.now() } })
  })
  const prepared = await f.owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, { studySessionId,
    expectedSessionRevision: 2, idempotencyKey: 'post_seal_canvas_prepare_12345' })
  if (prepared.kind !== 'prepared') throw new Error(JSON.stringify(prepared))
  const check = (await f.t.run(ctx => ctx.db.get(prepared.assessmentOpportunityId)))!
  if (check.contextPins.kind !== 'session') throw new Error('Expected Canvas check session')
  const attached = await f.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId,
    expectedSessionRevision: 2, idempotencyKey: 'post_seal_canvas_attach_12345' })
  if (attached.kind !== 'attached') throw new Error('Expected Canvas attachment')
  const receipt = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { threadId: attached.threadId, activityId: attached.activityId,
    studySessionId: check.contextPins.studySessionId, expectedRevision: 1, expectedSessionRevision: 3, response: 'A supported Canvas response.',
    confidence: 3, idempotencyKey: 'post_seal_canvas_seal_12345' })
  if (receipt.kind !== 'accepted') throw new Error('Expected Canvas acceptance')
  const response = (await f.t.run(ctx => ctx.db.get(receipt.submissionId)))!
  if (!('assessmentOpportunityId' in response)) throw new Error('Expected assessment response')
  expect(await f.owner.action(api.learnAdaptive.submitResponse, { threadId: attached.threadId, activityId: attached.activityId,
    submissionId: receipt.submissionId, idempotencyKey: 'post_seal_canvas_score_12345' })).toMatchObject({ kind: 'accepted', status: 'completed' })
  expect(await f.read(response.assessmentOpportunityId)).toMatchObject({ status: 'available', feedback: { tier: 'T0' } })
  expect(await f.open(response.assessmentOpportunityId)).toMatchObject({ status: 'available', practice: { revision: 1 } })
  expect(await f.t.run(ctx => ctx.db.get(receipt.submissionId))).toEqual(response)
})

async function canvasTeachingFixture(entryPoint: 'today' | 'canvas', pass = false) {
  policy.todayCanvas = entryPoint === 'today'
  const f = await fixture(true, undefined, undefined, { pass })
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { pilotApproved: true, startsAt: new Date(Date.now() - 86_400_000).toISOString(),
    endsAt: new Date(Date.now() + 40 * 86_400_000).toISOString(),
    cohort: { ...originalManifest.cohort, subjectHashes: [await privacyDigest(['adaptive-v2-pilot-cohort.v1', deliveryIdentity.tokenIdentifier])] },
    modelPolicies: [{ model: 'synthetic/model', inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.1 }],
    productControls: { ...originalManifest.productControls, maxDispatchesPerHour: 4, maxDispatchesPerDay: 8, maxConcurrent: 2, maxReservedMicroUsdPerDay: 100_000 },
    rollback: { ...originalManifest.rollback, ownerSubjectHash: await privacyDigest(['adaptive-v2-rollback-owner.tokenIdentifier-sha256.v1', deliveryIdentity.tokenIdentifier]) } })
  vi.stubEnv('LEARN_ADAPTIVE_V2_PILOT_MANIFEST', ADAPTIVE_V2_PILOT_MANIFEST.version)
  await f.t.run(async ctx => {
    const user = (await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', deliveryIdentity.tokenIdentifier)).unique())!
    await ctx.db.patch(user._id, { learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: Date.now() } })
  })
  return f
}

async function canvasColdTeaching(entryPoint: 'today' | 'canvas' = 'today', options: { score?: boolean, pass?: boolean,
  beforePreparation?: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>,
  afterPreparation?: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void> } = {}) {
  const f = await canvasTeachingFixture(entryPoint, options.pass)
  const instructionalSession = await f.t.run(ctx => ctx.db.get(f.graph.studySessionId))
  const instructionalContent = await f.t.run(ctx => ctx.db.get(f.contentId))
  await options.beforePreparation?.(f)
  if (entryPoint === 'canvas') {
    expect(await f.owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, { studySessionId: f.graph.studySessionId,
      expectedSessionRevision: 2, idempotencyKey: 'canvas_cold_post_seal_prepare_12345' })).toMatchObject({ kind: 'prepared' })
  } else {
    expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: f.graph.studySessionId,
      expectedSessionRevision: 2, expectedContentRevision: 1, entryPoint: 'today', idempotencyKey: 'today_surface_post_seal_start_12345' }))
      .toMatchObject({ status: 'assessment' })
  }
  await options.afterPreparation?.(f)
  const row = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier)).take(8))).find(row => row.purpose.kind === 'measurement_cold')!
  const assignment = (await f.t.run(ctx => ctx.db.get(row.assignmentId!)))!
  expect(assignment).toMatchObject(entryPoint === 'today'
    ? { status: 'admitted', flow: 'v2_today', checkSurface: { surface: 'canvas', measurementFlow: 'v2_today' } }
    : { status: 'admitted', flow: 'v2_canvas' })
  if (row.contextPins.kind !== 'session' || !row.contextPins.canvas) throw new Error('Expected dedicated Canvas check')
  expect(row.contextPins.studySessionId).not.toBe(f.graph.studySessionId)
  const attached = await f.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: row.contextPins.studySessionId,
    expectedSessionRevision: row.contextPins.sessionRevision, idempotencyKey: 'today_surface_post_seal_attach_12345' })
  if (attached.kind !== 'attached') throw new Error(JSON.stringify(attached))
  const canvas = (await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId }))!
  expect(canvas.responsePrompt).toBeTruthy()
  const receipt = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { threadId: attached.threadId, activityId: attached.activityId,
    studySessionId: row.contextPins.studySessionId, expectedRevision: canvas.thread.revision, expectedSessionRevision: canvas.session.revision,
    response: 'A separate Canvas-surface answer in the Today treatment.', confidence: 3, idempotencyKey: 'today_surface_post_seal_accept_12345' })
  if (receipt.kind !== 'accepted') throw new Error('Expected Canvas acceptance')
  const response = (await f.t.run(ctx => ctx.db.get(receipt.submissionId)))!
  expect(response).toMatchObject({ flow: 'canvas', measurementContext: { status: 'admitted' },
    ...(entryPoint === 'today' ? { contextPins: { checkSurface: { surface: 'canvas', measurementFlow: 'v2_today' } } } : {}) })
  if (options.score !== false) expect(await f.owner.action(api.learnAdaptive.submitResponse, { threadId: attached.threadId, activityId: attached.activityId,
    submissionId: receipt.submissionId, idempotencyKey: 'today_surface_post_seal_score_12345' })).toMatchObject({ kind: 'accepted', status: 'completed' })
  const reference = { version, assessmentOpportunityId: row._id }
  const read = () => f.owner.query(learnV2CanvasMeasurementApi.getPostSealTeaching, reference)
  const open = () => f.owner.mutation(learnV2CanvasMeasurementApi.openPostSealPractice, reference)
  const help = (slotId: Id<'learnResponseSlots'>, kind: 'hint' | 'worked_example') => f.owner.mutation(learnV2CanvasMeasurementApi.authorizePracticeAssistance,
    { ...reference, target: { responseSlotId: slotId }, expectedRevision: 1, kind, idempotencyKey: `today_surface_help_${kind}_12345` })
  const canvasReceipt = async () => (await f.owner.query(api.learnAdaptiveCanvas.getCanvas, {
    threadId: attached.threadId, checkReference: row.delayedCheckId }))?.checkReceipt
  return { ...f, row, response, assignment, instructionalSession, instructionalContent, attached, canvasReceipt, read, open, help }
}

async function fillOrdinaryPlan(f: Awaited<ReturnType<typeof fixture>>, count: number) {
  await f.t.run(async ctx => {
    const { futureId } = await seedFixedCheckPlan(ctx, deliveryIdentity.tokenIdentifier, f.graph, Date.now())
    await ctx.db.patch(f.graph.studySessionId, { status: 'ready', missedAt: undefined })
    const { _id, _creationTime, ...future } = (await ctx.db.get(futureId))!
    for (let index = 2; index < count; index++) await ctx.db.insert('studySessions', {
      ...future, placementId: `ordinary-boundary-${index}`, status: 'completed',
    })
  })
}

async function fillDedicatedPlan(f: Awaited<ReturnType<typeof canvasColdTeaching>>, count: number) {
  if (count === 1) return
  const delayed = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier)).take(8))).find(row => row.horizonDays === 7)!
  const now = Date.now()
  vi.setSystemTime(delayed.openAt)
  await f.t.mutation(materializeDue, { userId: deliveryIdentity.tokenIdentifier, through: Date.now() })
  const ready = (await f.t.run(ctx => ctx.db.get(delayed._id)))!
  if (ready.contextPins.kind !== 'session') throw new Error('Expected dedicated delayed check')
  const sessionId = ready.contextPins.studySessionId
  const attached = await f.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: sessionId,
    expectedSessionRevision: ready.contextPins.sessionRevision, idempotencyKey: 'boundary_delayed_attach_12345' })
  if (attached.kind !== 'attached') throw new Error('Expected delayed attachment')
  const canvas = (await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId }))!
  const receipt = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { threadId: attached.threadId, activityId: attached.activityId,
    studySessionId: sessionId, expectedRevision: canvas.thread.revision, expectedSessionRevision: canvas.session.revision,
    response: 'A separately sealed delayed boundary check.', confidence: 3, idempotencyKey: 'boundary_delayed_submit_12345' })
  if (receipt.kind !== 'accepted') throw new Error('Expected delayed acceptance')
  expect(await f.owner.action(api.learnAdaptive.submitResponse, { threadId: attached.threadId, activityId: attached.activityId,
    submissionId: receipt.submissionId, idempotencyKey: 'boundary_delayed_score_12345' })).toMatchObject({ kind: 'accepted', status: 'completed' })
  await f.t.run(async ctx => {
    const { _id, _creationTime, ...session } = (await ctx.db.get(sessionId))!
    for (let index = 2; index < count; index++) await ctx.db.insert('studySessions', { ...session, scheduledStartAt: now - 1 })
  })
  vi.setSystemTime(now)
}

let boundaryMissionRead = 0
async function boundaryMission(f: Awaited<ReturnType<typeof fixture>>) {
  const result = await f.owner.mutation(api.learnV2Journey.getMissionDelivery, { learningVoidId: f.graph.learningVoidId,
    idempotencyKey: `boundary_mission_${++boundaryMissionRead}_12345` })
  expect(result.admission.status).not.toBe('denied')
  if (!result.value) throw new Error('Expected readable Mission')
  return result.value
}

test.each(['hub', 'mission'] as const)('32 ordinary sessions remain readable on %s through cold preparation, sealing and scoring', async reader => {
  const read = async (f: Awaited<ReturnType<typeof fixture>>) => reader === 'hub'
    ? await f.owner.query(api.learnV2Journey.listHub, {})
    : (await boundaryMission(f)).plan.sessions
  let baseline: Awaited<ReturnType<typeof read>>
  const f = await canvasColdTeaching('canvas', { score: false, beforePreparation: async f => {
    await fillOrdinaryPlan(f, 32)
    baseline = await read(f)
  }, afterPreparation: async f => {
    if (reader === 'hub') expect(await read(f)).toEqual(baseline!)
    else expect(await f.owner.mutation(api.learnV2Journey.getMissionDelivery, { learningVoidId: f.graph.learningVoidId,
      idempotencyKey: 'boundary_open_mission_12345' })).toMatchObject({ admission: { status: 'denied' }, value: null })
  } })
  expect(await read(f)).toEqual(baseline!)
  expect(await f.owner.action(api.learnAdaptive.submitResponse, { threadId: f.attached.threadId, activityId: f.attached.activityId,
    submissionId: f.response._id, idempotencyKey: `boundary_${reader}_score_12345` })).toMatchObject({ kind: 'accepted', status: 'completed' })
  expect(await read(f)).toEqual(baseline!)
})

test.each(['hub', 'mission', 'reflow'] as const)('32 ordinary sessions retain their contract on %s at the dedicated-check allowance', async reader => {
  let before = ''
  const f = await canvasColdTeaching('canvas', { beforePreparation: async f => {
    await fillOrdinaryPlan(f, 32)
    before = JSON.stringify((await f.owner.query(api.learnV2Journey.getMission, { learningVoidId: f.graph.learningVoidId }))!.plan.sessions)
  } })
  await fillDedicatedPlan(f, 128)
  if (reader === 'hub') expect(await f.owner.query(api.learnV2Journey.listHub, {})).toMatchObject({ items: [{ nextAction: 'study_session', nextScheduledAt: Date.now() }] })
  else if (reader === 'mission') {
    const mission = await boundaryMission(f)
    expect(mission.plan.sessions).toHaveLength(32)
    expect(JSON.stringify(mission.plan.sessions)).toBe(before)
    expect(mission.plan.fixedChecks).toHaveLength(128)
    expect(mission.plan.fixedChecks?.filter(row => row.assessmentPurpose === 'measurement_cold')).toHaveLength(1)
  } else {
    const reflow = await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: f.graph.studyPlanRevisionId,
      expectedPlanRecordRevision: 1, idempotencyKey: 'boundary_maximum_checks_reflow_12345' })
    expect(reflow.changedSessionIds).toHaveLength(1)
    expect(reflow.preservedSessionIds).toHaveLength(159)
    const mission = await boundaryMission(f)
    expect(mission.plan.fixedChecks).toHaveLength(128)
    expect(mission.plan.sessions).toHaveLength(2)
  }
})

test.each((['hub', 'mission'] as const).flatMap(reader => [1, 129, 512].map(checks => ({ reader, checks }))))(
  '33 ordinary sessions still exceed the $reader contract with $checks dedicated checks', async ({ reader, checks }) => {
  const f = await canvasColdTeaching('canvas', { beforePreparation: f => fillOrdinaryPlan(f, 33) })
  await fillDedicatedPlan(f, checks)
  await expect(reader === 'hub' ? f.owner.query(api.learnV2Journey.listHub, {})
    : f.owner.query(api.learnV2Journey.getMission, { learningVoidId: f.graph.learningVoidId }))
    .rejects.toThrow('Learn V2 sessions exceed their bounded contract')
})

test.each(['reflow', 'expiry'] as const)('600 ordinary sessions keep their %s allowance separate from dedicated checks', async reader => {
  const f = await canvasColdTeaching('canvas', { beforePreparation: f => fillOrdinaryPlan(f, 600) })
  await fillDedicatedPlan(f, 128)
  if (reader === 'reflow') {
    const receipt = await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: f.graph.studyPlanRevisionId,
      expectedPlanRecordRevision: 1, idempotencyKey: 'boundary_large_plan_reflow_12345' })
    expect(receipt.changedSessionIds).toHaveLength(1)
    expect(receipt.preservedSessionIds).toHaveLength(727)
  } else expect(await f.owner.mutation(api.learnV2Plans.markExpiredSessionsMissed, { learningVoidId: f.graph.learningVoidId,
    idempotencyKey: 'boundary_large_plan_expiry_12345' })).toEqual({ missedSessionIds: [] })
})

test.each([{ ordinary: 32, checks: 129 }, { ordinary: 128, checks: 128 }, { ordinary: 128, checks: 129 }, { ordinary: 128, checks: 512 }])(
  '$ordinary ordinary Today candidates remain usable with $checks active dedicated checks', async ({ ordinary, checks }) => {
  const f = await canvasColdTeaching('canvas', { beforePreparation: f => fillOrdinaryPlan(f, ordinary) })
  await f.t.run(async ctx => {
    const rows = await ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', q =>
      q.eq('userId', deliveryIdentity.tokenIdentifier).eq('studyPlanRevisionId', f.graph.studyPlanRevisionId)).take(130)
    for (const row of rows) if (!row.assessmentPurpose && row.status === 'completed') await ctx.db.patch(row._id, { status: 'planned' })
  })
  const before = await f.owner.query(api.learnV2Today.getToday, {})
  expect(before).not.toMatchObject({ status: 'blocked', reason: 'today_candidate_limit' })
  await fillDedicatedPlan(f, checks)
  await f.t.run(async ctx => {
    const rows = await ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', q =>
      q.eq('userId', deliveryIdentity.tokenIdentifier).eq('studyPlanRevisionId', f.graph.studyPlanRevisionId)).take(641)
    for (const row of rows) if (row.schedulerVersion === 'learn-v2.delayed-delivery.v1'
      && (row.assessmentPurpose === 'measurement_delayed' || checks > 128)) await ctx.db.patch(row._id, { status: 'ready' })
  })
  expect(await f.owner.query(api.learnV2Today.getToday, {})).toEqual(before)
  await f.t.run(ctx => ctx.db.insert('studySessions', { userId: deliveryIdentity.tokenIdentifier,
    studyPlanRevisionId: f.graph.studyPlanRevisionId, primaryObjectiveId: f.graph.objectiveId,
    status: 'planned', revision: 1, scheduledStartAt: Date.now() + 3 * 86_400_000 }))
  if (ordinary === 128) expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'blocked', reason: 'today_candidate_limit' })
})

test.each((['hub', 'mission', 'reflow'] as const).flatMap(reader => [129, 512].map(checks => ({ reader, checks }))))(
  '$checks dedicated overflow rows preserve ordinary work on $reader', async ({ reader, checks }) => {
  const f = await canvasColdTeaching('canvas', { beforePreparation: f => fillOrdinaryPlan(f, 32) })
  const before = (await boundaryMission(f)).plan.sessions
  const hub = reader === 'hub' ? await f.owner.query(api.learnV2Journey.listHub, {}) : null
  await fillDedicatedPlan(f, checks)
  if (reader === 'hub') expect(await f.owner.query(api.learnV2Journey.listHub, {})).toEqual(hub)
  else if (reader === 'mission') {
    const mission = await boundaryMission(f)
    expect(mission.plan.sessions).toEqual(before)
    expect(mission.plan.fixedChecks!.length).toBeLessThanOrEqual(128)
  } else {
    const reflow = await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: f.graph.studyPlanRevisionId,
      expectedPlanRecordRevision: 1, idempotencyKey: 'boundary_dedicated_overflow_reflow_12345' })
    expect(reflow.changedSessionIds).toHaveLength(1)
    const ordinaryIds = new Set<string>(before.map(row => row._id))
    expect(reflow.preservedSessionIds!.filter(id => ordinaryIds.has(id))).toHaveLength(31)
    expect((await boundaryMission(f)).plan.sessions).toHaveLength(2)
  }
})

async function padCheckCapacity(f: Awaited<ReturnType<typeof fixture>>, count: number, opportunityId?: Id<'learnAssessmentOpportunities'>) {
  await f.t.run(async ctx => {
    for (let index = 0; index < count; index++) await ctx.db.insert('studySessions', { userId: deliveryIdentity.tokenIdentifier,
      studyPlanRevisionId: f.graph.studyPlanRevisionId, primaryObjectiveId: f.graph.objectiveId, status: 'completed', revision: 1,
      scheduledStartAt: Date.now() - 1, schedulerVersion: 'learn-v2.delayed-delivery.v1', assessmentPurpose: 'measurement_delayed',
      ...(opportunityId ? { assessmentOpportunityId: opportunityId } : {}) })
  })
}

test.each(['canvas', 'today'] as const)('%s cold creation at capacity records system missing and leaves the lesson usable', async entryPoint => {
  const f = await canvasTeachingFixture(entryPoint)
  await padCheckCapacity(f, 128)
  const prepare = { studySessionId: f.graph.studySessionId, expectedSessionRevision: 2, idempotencyKey: `capacity_${entryPoint}_cold_prepare_12345` }
  if (entryPoint === 'canvas') expect(await f.owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, prepare))
    .toMatchObject({ kind: 'not_admitted', reasonCode: 'system_check_capacity' })
  else expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, { ...prepare,
    expectedContentRevision: 1, entryPoint: 'today' })).toMatchObject({ status: 'in_progress' })
  const state = await f.t.run(async ctx => ({ sessions: await ctx.db.query('studySessions').take(140),
    assignments: await ctx.db.query('learnMeasurementAssignments').take(4), facts: await ctx.db.query('learnMeasurementReportFacts').take(16) }))
  expect(state.sessions).toHaveLength(129)
  expect(state.assignments[0]).toMatchObject({ status: 'not_admitted', exclusionReasons: expect.arrayContaining(['system_check_capacity']) })
  expect(state.facts.map(row => row.fact)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'enrollment', status: 'not_admitted' })]))
  expect(state.sessions.every(row => row.status !== 'missed')).toBe(true)
  expect(await f.owner.query(api.learnV2Today.getToday, {})).not.toMatchObject({ status: 'blocked' })
})

test('delayed creation at capacity records system missing without inserting or marking a learner miss', async () => {
  const f = await canvasColdTeaching('canvas')
  await padCheckCapacity(f, 127, f.row._id)
  const delayed = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').take(8))).find(row => row.horizonDays === 7)!
  vi.setSystemTime(delayed.openAt)
  await f.t.mutation(materializeDue, { userId: deliveryIdentity.tokenIdentifier, through: Date.now() })
  expect(await f.t.run(ctx => ctx.db.query('studySessions').take(140))).toHaveLength(129)
  expect(await f.t.run(ctx => ctx.db.get(delayed._id))).toMatchObject({ phase: 'cancelled', operationalEligibility: 'blocked', reasonCode: 'system_check_capacity' })
  const facts = await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_assessmentOpportunityId', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('fact.assessmentOpportunityId', delayed._id)).take(16))
  expect(facts.at(-1)?.fact).toMatchObject({ kind: 'opportunity', status: 'cancelled', reasonCode: 'system_check_capacity' })
  vi.setSystemTime(delayed.closeAt + 1)
  await f.t.mutation(materializeDue, { userId: deliveryIdentity.tokenIdentifier, through: Date.now() })
  expect(await f.t.run(ctx => ctx.db.get(delayed._id))).toMatchObject({ phase: 'cancelled', reasonCode: 'system_check_capacity' })
})

test('starting a lesson preserves an admitted cold system-missing outcome', async () => {
  const f = await canvasTeachingFixture('today')
  policy.todayCanvas = false
  const family = (await f.t.run(ctx => ctx.db.query('learnMeasurementFamilies').take(2)))[0]!
  expect(await f.owner.mutation(enrollProspect, { studySessionId: f.graph.studySessionId,
    familyId: family._id, entryPoint: 'today' })).toMatchObject({ status: 'admitted' })
  const cold = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').take(8))).find(row => row.purpose.kind === 'measurement_cold')!
  const contextPins = cold.contextPins
  if (contextPins.kind === 'calibration') throw new Error('Expected session-bound enrollment')
  const checkSurface = { version: LEARN_CHECK_SURFACE_VERSION, surface: 'canvas' as const, measurementFlow: 'v2_today' as const }
  await f.t.run(async ctx => {
    await ctx.db.patch(cold.assignmentId!, { checkSurface })
    await ctx.db.patch(cold._id, { contextPins: { ...contextPins, checkSurface }, phase: 'cancelled',
      operationalEligibility: 'blocked', reasonCode: 'system_check_capacity' })
  })
  policy.todayCanvas = true
  await padCheckCapacity(f, 128, cold._id)
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: f.graph.studySessionId,
    expectedSessionRevision: 2, expectedContentRevision: 1, entryPoint: 'today', idempotencyKey: 'admitted_cold_capacity_start_12345' }))
    .toMatchObject({ status: 'in_progress' })
  expect(await f.t.run(ctx => ctx.db.get(cold._id))).toMatchObject({ phase: 'cancelled', operationalEligibility: 'blocked', reasonCode: 'system_check_capacity' })
  expect(await f.t.run(ctx => ctx.db.query('studySessions').take(140))).toHaveLength(129)
})

test('retained creation at capacity records system missing and keeps Independent without a blocked shell', async () => {
  const f = await ordinary()
  await padCheckCapacity(f, 128, f.row._id)
  const before = await f.t.run(ctx => ctx.db.query('studySessions').take(140))
  expect(await f.score(f.receipt.submissionId)).toMatchObject({ status: 'scored', result: { scorePercent: 100 } })
  expect(await f.t.run(ctx => ctx.db.query('masteryRecords').take(4))).toEqual(expect.arrayContaining([expect.objectContaining({ state: 'independent' })]))
  expect(await f.t.run(ctx => ctx.db.query('studySessions').take(140))).toHaveLength(before.length)
  const delayed = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').take(8))).find(row => row.horizonDays === 7)!
  expect(delayed).toMatchObject({ phase: 'cancelled', operationalEligibility: 'blocked', reasonCode: 'system_check_capacity' })
})

test.each(['canvas', 'today'] as const)('%s cold creation admits the last dedicated slot and replays at capacity', async entryPoint => {
  const f = await canvasTeachingFixture(entryPoint)
  await padCheckCapacity(f, 127)
  const args = { studySessionId: f.graph.studySessionId, expectedSessionRevision: 2, idempotencyKey: `last_slot_${entryPoint}_12345` }
  const start = () => entryPoint === 'canvas' ? f.owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, args)
    : f.owner.mutation(api.learnV2SessionContent.startStudySession, { ...args, expectedContentRevision: 1, entryPoint: 'today' })
  const result = await start()
  expect(result).toMatchObject(entryPoint === 'canvas' ? { kind: 'prepared' } : { status: 'assessment' })
  expect(await start()).toEqual(result)
  expect(await f.t.run(ctx => ctx.db.query('studySessions').take(140))).toHaveLength(129)
})

test.each(['reflow', 'expiry'] as const)('601 ordinary sessions still exceed the %s contract', async reader => {
  const f = await canvasColdTeaching('canvas', { beforePreparation: f => fillOrdinaryPlan(f, 601) })
  await expect(reader === 'reflow'
    ? f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: f.graph.studyPlanRevisionId,
      expectedPlanRecordRevision: 1, idempotencyKey: 'boundary_ordinary_overflow_reflow_12345' })
    : f.owner.mutation(api.learnV2Plans.markExpiredSessionsMissed, { learningVoidId: f.graph.learningVoidId,
      idempotencyKey: 'boundary_ordinary_overflow_expiry_12345' }))
    .rejects.toThrow('Study plan session count is outside the bounded contract')
})

test.each(['result_unconfirmed', 'closed'] as const)('the %s Canvas receipt reaches only separate-case practice', async state => {
  const f = await canvasColdTeaching('today', { score: false })
  if (state === 'result_unconfirmed') {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('lost provider receipt') }))
    expect(await f.owner.action(api.learnAdaptive.submitResponse, { threadId: f.attached.threadId, activityId: f.attached.activityId,
      submissionId: f.response._id, idempotencyKey: 'receipt_unconfirmed_score_12345' }))
      .toMatchObject({ kind: 'blocked', code: 'reconciliation_required', retryable: false })
  } else await f.t.run(ctx => ctx.db.patch(f.row._id, { phase: 'cancelled' }))
  const receipt = await f.canvasReceipt()
  expect(receipt?.state).toBe(state)
  const reference = receipt?.postSealReference
  if (!reference) throw new Error('Expected receipt reference')
  expect(reference).toEqual({ version, assessmentOpportunityId: f.row._id })
  expect(await f.owner.query(learnV2CanvasMeasurementApi.getPostSealTeaching, reference))
    .toMatchObject({ status: 'available', feedback: null, lesson: null, practice: null })
  const opened = await f.owner.mutation(learnV2CanvasMeasurementApi.openPostSealPractice, reference)
  if (opened.status !== 'available' || !opened.practice) throw new Error('Expected separate practice')
  expect(opened).toMatchObject({ feedback: null, lesson: null, availability: { practice: { status: 'available' } } })
  expect(await f.help(opened.practice.responseSlotId, 'worked_example')).toMatchObject({ status: 'authorized' })
  expect(await f.help(opened.practice.responseSlotId, 'hint')).toMatchObject({ status: 'denied', reasonCode: 'unavailable' })
  expect(await f.t.run(ctx => ctx.db.get(f.response._id))).toEqual(f.response)
})

test.each(['open_check', 'revoked', 'separation'] as const)('a receipt reference cannot bypass %s gates', async gate => {
  const f = await canvasColdTeaching('today', { score: false })
  await f.t.run(ctx => ctx.db.patch(f.row._id, { phase: 'reconciliation_required' }))
  const reference = (await f.canvasReceipt())?.postSealReference
  if (!reference) throw new Error('Expected receipt reference')
  const opened = await f.owner.mutation(learnV2CanvasMeasurementApi.openPostSealPractice, reference)
  if (opened.status !== 'available' || !opened.practice) throw new Error('Expected separate practice')
  const slotId = opened.practice.responseSlotId
  await f.help(slotId, 'worked_example')
  if (gate === 'open_check') {
    const delayed = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').take(8))).find(row => row.horizonDays === 7)!
    vi.setSystemTime(delayed.openAt)
    await f.t.mutation(materializeDue, { userId: deliveryIdentity.tokenIdentifier, through: Date.now() })
  } else if (gate === 'revoked') await f.t.run(ctx => ctx.db.patch(f.graph.sourceSnapshotId, { rightsStatus: 'prohibited' }))
  else await f.t.run(async ctx => {
    const binding = (await ctx.db.query('learnPostSealPracticeBindings').take(2))[0]!
    const checkCaseId = f.row.assessmentPins.kind === 'measurement' ? f.row.assessmentPins.itemPins.caseId : null
    if (!checkCaseId) throw new Error('Expected measurement case')
    await ctx.db.patch(binding._id, { practiceCaseId: checkCaseId })
  })
  const read = await f.owner.query(learnV2CanvasMeasurementApi.getPostSealTeaching, reference)
  const retried = await f.owner.mutation(learnV2CanvasMeasurementApi.openPostSealPractice, reference)
  if (gate === 'separation') {
    expect(read).toMatchObject({ status: 'available', practice: null, availability: { practice: { status: 'unavailable' } } })
    expect(retried).toMatchObject({ status: 'available', practice: null })
  } else {
    expect(read).toMatchObject({ status: 'unavailable', reasonCode: gate === 'open_check' ? 'test_open' : 'evidence_unavailable' })
    expect(retried).toEqual(read)
    if (gate === 'revoked') expect(await f.canvasReceipt()).toMatchObject({ state: 'closed', postSealReference: reference })
  }
  expect(await f.help(slotId, 'worked_example')).toMatchObject({ status: 'denied' })
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealPracticeBindings').take(2))).toHaveLength(1)
  const foreign = f.t.withIdentity({ tokenIdentifier: 'foreign-owner', subject: 'foreign' })
  await expect(foreign.query(learnV2CanvasMeasurementApi.getPostSealTeaching, reference)).rejects.toThrow('Learn access denied')
  await expect(foreign.mutation(learnV2CanvasMeasurementApi.openPostSealPractice, reference)).rejects.toThrow('Learn access denied')
})

test('Today treatment on the Canvas surface seals, scores and delivers teaching, practice and both help kinds', async () => {
  const f = await canvasColdTeaching()
  expect(await f.read()).toMatchObject({ status: 'available', feedback: { tier: 'T0' }, lesson: { tier: 'T0' },
    availability: { feedback: 'available', practice: { status: 'not_opened' } } })
  const [opened, retry] = await Promise.all([f.open(), f.open()])
  expect(retry).toEqual(opened)
  if (opened.status !== 'available' || !opened.practice) throw new Error('Expected practice')
  for (const kind of ['hint', 'worked_example'] as const) {
    const first = await f.help(opened.practice.responseSlotId, kind)
    expect(first).toMatchObject({ status: 'authorized', content: { kind, tier: 'T0' } })
    expect(await f.help(opened.practice.responseSlotId, kind)).toEqual(first)
  }
  expect(opened.availability.help).toEqual({ remaining: 8, hint: { status: 'available' }, worked_example: { status: 'available' } })
  const helped = { ...opened, availability: { ...opened.availability,
    help: { remaining: 6, hint: { status: 'delivered' }, worked_example: { status: 'delivered' } } } }
  policy.todayCanvas = false
  expect(await f.open()).toEqual(helped)
  expect(await f.read()).toEqual(helped)
  expect(await f.help(opened.practice.responseSlotId, 'worked_example')).toMatchObject({ status: 'authorized' })
  expect(await f.t.run(ctx => ctx.db.get(f.response._id))).toEqual(f.response)
  expect(await f.t.run(ctx => ctx.db.get(f.assignment._id))).toMatchObject({ flow: 'v2_today', exclusionReasons: [] })
  for (const table of ['learnPostSealTeachingSources', 'learnPostSealPracticeBindings'] as const) {
    expect(await f.t.run(ctx => ctx.db.query(table).withIndex('by_userId_and_submissionId', q =>
      q.eq('userId', deliveryIdentity.tokenIdentifier).eq('submissionId', f.response._id)).take(2))).toHaveLength(1)
  }
})

async function reflowCanvasTeaching(f: Awaited<ReturnType<typeof canvasColdTeaching>>, preparedPlan = false) {
  if (!preparedPlan) await f.t.run(async ctx => {
    const { futureId } = await seedFixedCheckPlan(ctx, deliveryIdentity.tokenIdentifier, f.graph, Date.now())
    await ctx.db.delete(futureId)
    await ctx.db.patch(f.graph.studySessionId, { status: 'ready', missedAt: undefined })
  })
  const reflow = await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: f.graph.studyPlanRevisionId,
    expectedPlanRecordRevision: 1, idempotencyKey: `canvas_teaching_reflow_${f.graph.studyPlanRevisionId}` })
  const successorPlanRevisionId = reflow.successorPlanRevisionId
  if (!successorPlanRevisionId) throw new Error('Expected a reflow successor')
  const successor = (await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('studyPlanRevisionId', successorPlanRevisionId)).take(8)))
    .find(row => row.placementId === 'ordinary-past')!
  const graph = { ...f.graph, studyPlanRevisionId: successorPlanRevisionId, studySessionId: successor._id }
  const contentId = await publishDeliveryTeaching({ t: f.t, graph })
  const blocks = await f.t.run(ctx => ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('sessionContentId', contentId)).take(16))
  await f.owner.run(ctx => prepareAndRegisterInstructionalArtifactsForOwner(ctx, deliveryIdentity.tokenIdentifier, {
    artifacts: blocks.map(block => ({ artifact: { kind: 'session_block', id: block._id }, key: 'whole', origins: [], sources: [{ kind: 'excerpt',
      sourceSnapshotId: graph.sourceSnapshotId, sourceExcerptId: graph.sourceExcerptId, revision: 1, recordRevision: 1, contentHash: graph.support.sourceContentHash }] })),
  }))
  const instructionalSession = await f.t.run(ctx => ctx.db.get(successor._id))
  const instructionalContent = await f.t.run(ctx => ctx.db.get(contentId))
  return { ...f, graph, contentId, instructionalSession, instructionalContent }
}

test('Canvas continuation resolves reflow lineage at the ordinary and dedicated session limits', async () => {
  const original = await canvasColdTeaching('canvas', { beforePreparation: f => fillOrdinaryPlan(f, 600) })
  await fillDedicatedPlan(original, 128)
  const f = await reflowCanvasTeaching(original, true)
  const session = (await f.t.run(ctx => ctx.db.get(f.graph.studySessionId)))!
  expect(await f.owner.mutation(api.learnAdaptiveCanvas.startCanvasSession, { studySessionId: session._id,
    expectedSessionRevision: session.revision, expectedContentRevision: 1, idempotencyKey: 'boundary_canvas_successor_start_12345' }))
    .toMatchObject({ kind: 'attached' })
})

test.each([0, 1, 2])('Canvas cold original-session control delivers teaching and reaches Independent after %s reflows', async reflows => {
  let f = await canvasColdTeaching('canvas')
  const fixedCheck = await f.t.run(ctx => ctx.db.get(f.row._id))
  const reference = { version, assessmentOpportunityId: f.row._id }
  const teaching = await f.read()
  if (teaching.status !== 'available') throw new Error(JSON.stringify(teaching))
  expect(teaching).toMatchObject({ status: 'available', feedback: { tier: 'T0' }, lesson: { tier: 'T0' }, practice: null })
  expect(await f.owner.mutation(learnV2CanvasMeasurementApi.publishPostSealFeedback, reference))
    .toMatchObject({ status: 'available', feedback: { tier: 'T0' }, lesson: { tier: 'T0' }, practice: null })
  const opened = await f.open()
  if (opened.status !== 'available' || !opened.practice) throw new Error(JSON.stringify(opened))
  expect(await f.open()).toEqual(opened)
  for (const kind of ['hint', 'worked_example'] as const) {
    const first = await f.help(opened.practice.responseSlotId, kind)
    expect(first).toMatchObject({ status: 'authorized', content: { kind, tier: 'T0' } })
    expect(await f.help(opened.practice.responseSlotId, kind)).toEqual(first)
  }
  const practiceCommand = { version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'canvas_cold_practice_accept_12345', response: {
    target: { responseSlotId: opened.practice.responseSlotId }, expectedRevision: opened.practice.revision,
    payload: { kind: 'text' as const, text: 'A separate formative practice response.' } } }
  const accepted = await f.owner.mutation(api.learnV2Responses.acceptResponse, practiceCommand)
  expect(accepted).toMatchObject({ kind: 'accepted' })
  expect(await f.owner.mutation(api.learnV2Responses.acceptResponse, practiceCommand)).toEqual(accepted)
  expect(await f.t.run(ctx => ctx.db.get(f.graph.studySessionId))).toEqual(f.instructionalSession)
  expect(await f.t.run(ctx => ctx.db.get(f.contentId))).toEqual(f.instructionalContent)
  expect(await f.t.run(ctx => ctx.db.get(f.row._id))).toEqual(fixedCheck)
  const binding = (await f.t.run(ctx => ctx.db.query('learnPostSealPracticeBindings').withIndex('by_userId_and_submissionId', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('submissionId', f.response._id)).unique()))!
  const exposures = await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').withIndex('by_userId', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier)).take(16))
  const later = exposures.filter(row => row.purpose === 'practice')
  expect(later).toHaveLength(3)
  for (const exposure of later) {
    expect(exposure.caseId).toBe(binding.practiceCaseId)
    expect(exposure).not.toHaveProperty('assessmentOpportunityId')
  }
  expect(binding.practiceCaseId).not.toBe(binding.checkCaseId)
  for (let index = 0; index < reflows; index++) f = await reflowCanvasTeaching(f)
  const session = (await f.t.run(ctx => ctx.db.get(f.graph.studySessionId)))!
  if (reflows) expect(await f.owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, { studySessionId: session._id,
    expectedSessionRevision: session.revision, idempotencyKey: 'canvas_reflow_preparation_retry_12345' }))
    .toMatchObject({ kind: 'prepared', assessmentOpportunityId: f.row._id, sessionContentId: fixedCheck!.contextPins.kind === 'session' ? fixedCheck!.contextPins.sessionContentId : null })
  const continuation = { studySessionId: session._id, expectedSessionRevision: session.revision,
    expectedContentRevision: 1, idempotencyKey: 'canvas_cold_teaching_start_12345' }
  const attached = await f.owner.mutation(learnV2CanvasMeasurementApi.startSession, continuation)
  if (attached.kind !== 'attached') throw new Error(JSON.stringify(attached))
  expect(await f.owner.mutation(learnV2CanvasMeasurementApi.startSession, continuation)).toEqual({ ...attached, replayed: true })
  expect(await f.t.run(ctx => ctx.db.get(f.assignment._id))).toMatchObject({ flow: 'v2_canvas', exclusionReasons: [] })
  expect(await f.t.run(ctx => ctx.db.get(f.row._id))).toMatchObject({ operationalEligibility: 'eligible' })
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').withIndex('by_userId_and_assignmentId_and_purpose_and_status_and_serverTime', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('assignmentId', f.assignment._id).eq('purpose', 'teaching').eq('status', 'granted')).take(2)))
    .toEqual([expect.objectContaining({ provenanceVersion: 'learn-v2.instructional-flow.v2_canvas.v1' })])
  expect(await f.read()).toMatchObject({ status: 'unavailable', reasonCode: 'test_open' })
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: 'canvas-cold-independent-execution', model: 'synthetic/model',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
      criterionResults: [{ key: 'accuracy', awarded: true }], misconceptionTags: [] }) } }],
    usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 }, openrouter_metadata: { requested: 'synthetic/model', strategy: 'direct', attempt: 1,
      endpoints: { available: [{ provider: 'Synthetic Provider', model: 'synthetic/model', selected: true }] }, pipeline: [] } })))
  const canvas = (await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId }))!
  expect(canvas.responsePrompt).toBeTruthy()
  const sealed = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { studySessionId: session._id,
    threadId: attached.threadId, activityId: attached.activityId, expectedRevision: canvas.thread.revision,
    expectedSessionRevision: canvas.session.revision, response: 'Separate ordinary application.', confidence: 3, idempotencyKey: 'canvas_cold_independent_12345' })
  if (sealed.kind !== 'accepted') throw new Error(JSON.stringify(sealed))
  const independent = { threadId: attached.threadId, activityId: attached.activityId, submissionId: sealed.submissionId, idempotencyKey: 'canvas_cold_independent_score_12345' }
  const result = await f.owner.action(api.learnAdaptive.submitResponse, independent)
  expect(result).toMatchObject({ kind: 'accepted', status: 'completed' })
  expect(await f.owner.action(api.learnAdaptive.submitResponse, independent)).toMatchObject({ kind: 'accepted', status: 'completed' })
  const attempts = await f.t.run(ctx => ctx.db.query('masteryAttempts').withIndex('by_userId', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier)).take(8))
  expect(attempts)
    .toEqual([expect.objectContaining({ kind: 'measurement_cold' }), expect.objectContaining({ kind: 'independent_application', studySessionId: session._id,
      masteryStateAfter: 'independent', serverScorePercent: 100,
      assistanceSnapshot: expect.objectContaining({ state: 'unassisted' }) })])
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_contextPins_studySessionId', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('contextPins.studySessionId', session._id)).take(2)))
    .toEqual([expect.objectContaining({ purpose: { kind: 'independent_application' }, phase: 'scored_pass' })])
  const claims = await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_kind_and_sequence', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('fact.kind', 'independent_claim_v2')).take(2))
  const day7 = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_assignmentId_and_horizonDays', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('assignmentId', f.assignment._id).eq('horizonDays', 7)).unique()))!
  expect(claims).toEqual([expect.objectContaining({ fact: expect.objectContaining({ basisAttemptId: attempts[1]!._id,
    stratum: expect.objectContaining({ flow: 'v2_canvas', entryPoint: 'canvas' }),
    firstSlot: expect.objectContaining({ kind: 'linked', firstCheckOpportunityId: day7._id, checkSequence: 1,
      stratum: expect.objectContaining({ flow: 'v2_canvas', entryPoint: 'canvas' }) }) }) })])
  const claim = claims[0]!.fact
  if (claim.kind !== 'independent_claim_v2' || claim.firstSlot.kind !== 'linked') throw new Error('Expected linked Independent claim')
  expect(learnReportCheckSurface(claim.stratum)).toBe('canvas')
  expect(learnReportCheckSurface(claim.firstSlot.stratum)).toBe('canvas')
  expect(day7.firstCheckClaim).toMatchObject({ claimKey: claim.claimKey, basisAttemptId: attempts[1]!._id, claimSequence: 1 })
  const applicationResponse = (await f.t.run(ctx => ctx.db.get(sealed.submissionId)))!
  expect(applicationResponse).toMatchObject({ flow: 'canvas',
    contextPins: { kind: 'session', studySessionId: session._id, canvas: { threadId: attached.threadId } } })
  if (!('contextPins' in applicationResponse)) throw new Error('Expected application response')
  expect(learnAssessmentBoundSurface(null, applicationResponse.contextPins)).toBe('canvas')
  expect(await f.t.run(ctx => ctx.db.get(f.assignment._id))).toMatchObject({ flow: 'v2_canvas', exclusionReasons: [] })
  expect(await f.t.run(ctx => ctx.db.get(f.row._id))).toMatchObject({ operationalEligibility: 'eligible' })
  expect(await f.t.run(ctx => ctx.db.get(f.response._id))).toEqual(f.response)
  expect(await f.t.run(ctx => ctx.db.get(f.contentId))).toEqual(f.instructionalContent)
  expect(await f.t.run(ctx => ctx.db.get(f.row._id))).toEqual(fixedCheck)
  expect(await f.read()).toMatchObject(reflows ? { status: 'unavailable', reasonCode: 'disclosure_unknown' }
    : { status: 'available', feedback: { tier: 'T0' }, lesson: { tier: 'T0' } })
  expect(await f.owner.mutation(learnV2CanvasMeasurementApi.startSession, continuation)).toEqual({ ...attached, replayed: true })
})

async function canvasContinuationWrites(f: Awaited<ReturnType<typeof canvasColdTeaching>>) {
  return await f.t.run(async ctx => ({ session: await ctx.db.get(f.graph.studySessionId),
    opportunities: await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q => q.eq('userId', deliveryIdentity.tokenIdentifier)).take(16),
    exposures: await ctx.db.query('learnAssessmentExposures').withIndex('by_userId', q => q.eq('userId', deliveryIdentity.tokenIdentifier)).take(16),
    receipts: await ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId', q => q.eq('userId', deliveryIdentity.tokenIdentifier)).take(16) }))
}

test.each([1, 2])('Canvas continuation start survives %s later reflows and reaches Independent', async count => {
  const f = await canvasColdTeaching('canvas')
  await f.t.run(async ctx => {
    const { futureId } = await seedFixedCheckPlan(ctx, deliveryIdentity.tokenIdentifier, f.graph, Date.now())
    await ctx.db.delete(futureId)
    await ctx.db.patch(f.graph.studySessionId, { status: 'ready', missedAt: undefined })
  })
  const request = { studySessionId: f.graph.studySessionId, expectedSessionRevision: 2,
    expectedContentRevision: 1, idempotencyKey: 'canvas_start_before_reflow_12345' }
  const attached = await f.owner.mutation(learnV2CanvasMeasurementApi.startSession, request)
  if (attached.kind !== 'attached') throw new Error(JSON.stringify(attached))
  const before = (await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId }))!
  expect(before.status).toBe('started')
  const started = (await f.t.run(ctx => ctx.db.get(f.graph.studySessionId)))!
  expect(started.canvasColdCheckId).toBe(f.row._id)
  const application = (await f.t.run(ctx => ctx.db.get(started.assessmentOpportunityId!)))!
  const grant = await f.t.run(ctx => ctx.db.get(application.deliveryGrantId!))
  const coldCheck = await f.t.run(ctx => ctx.db.get(f.row._id))
  let planId = f.graph.studyPlanRevisionId
  for (let index = 0; index < count; index++) {
    const reflow = await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: planId,
      expectedPlanRecordRevision: 1, idempotencyKey: `canvas_started_reflow_${index}_12345` })
    if (!reflow.successorPlanRevisionId) throw new Error('Expected reflow successor')
    planId = reflow.successorPlanRevisionId
    const canvas = (await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId }))!
    expect(canvas.status).toBe('started')
    expect(canvas.responsePrompt).toBe(before.responsePrompt)
    expect(await f.owner.mutation(learnV2CanvasMeasurementApi.startSession, request)).toEqual({ ...attached, replayed: true })
    expect(await f.owner.query(api.learnV2Today.getToday, {})).toMatchObject({ status: 'ready', sessionId: f.graph.studySessionId })
    expect(await f.t.run(ctx => ctx.db.get(f.graph.studySessionId))).toEqual({ ...started, carriedPlanRevisionId: planId })
    expect(await f.t.run(ctx => ctx.db.get(application._id))).toEqual(application)
    expect(await f.t.run(ctx => ctx.db.get(application.deliveryGrantId!))).toEqual(grant)
    expect(await f.owner.query(api.learnV2Journey.getSessionCandidate, { learningVoidId: f.graph.learningVoidId,
      studySessionId: f.graph.studySessionId })).toMatchObject({ studySessionId: f.graph.studySessionId, status: 'in_progress', content: { revision: 1 } })
  }
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: 'canvas-carried-independent-execution', model: 'synthetic/model',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
      criterionResults: [{ key: 'accuracy', awarded: true }], misconceptionTags: [] }) } }],
    usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 }, openrouter_metadata: { requested: 'synthetic/model', strategy: 'direct', attempt: 1,
      endpoints: { available: [{ provider: 'Synthetic Provider', model: 'synthetic/model', selected: true }] }, pipeline: [] } })))
  const sealed = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { studySessionId: f.graph.studySessionId,
    threadId: attached.threadId, activityId: attached.activityId, expectedRevision: before.thread.revision,
    expectedSessionRevision: before.session.revision, response: 'A supported continuation response.', confidence: 3,
    idempotencyKey: 'canvas_carried_submit_12345' })
  if (sealed.kind !== 'accepted') throw new Error(JSON.stringify(sealed))
  expect(await f.owner.action(api.learnAdaptive.submitResponse, { threadId: attached.threadId, activityId: attached.activityId,
    submissionId: sealed.submissionId, idempotencyKey: 'canvas_carried_score_12345' })).toMatchObject({ kind: 'accepted', status: 'completed' })
  expect(await f.t.run(ctx => ctx.db.get(f.graph.studySessionId))).toMatchObject({ status: 'completed', carriedPlanRevisionId: planId })
  const attempts = await f.t.run(ctx => ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', deliveryIdentity.tokenIdentifier)).take(8))
  expect(attempts).toEqual([expect.objectContaining({ kind: 'measurement_cold' }), expect.objectContaining({ kind: 'independent_application',
    masteryStateAfter: 'independent', serverScorePercent: 100, studySessionId: f.graph.studySessionId,
    assistanceSnapshot: expect.objectContaining({ state: 'unassisted' }) })])
  const day7 = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_assignmentId_and_horizonDays', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('assignmentId', f.assignment._id).eq('horizonDays', 7)).unique()))!
  const claims = await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_kind_and_sequence', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('fact.kind', 'independent_claim_v2')).take(2))
  expect(claims).toEqual([expect.objectContaining({ fact: expect.objectContaining({ basisAttemptId: attempts[1]!._id,
    stratum: expect.objectContaining({ flow: 'v2_canvas' }), firstSlot: expect.objectContaining({ firstCheckOpportunityId: day7._id }) }) })])
  expect(await f.t.run(ctx => ctx.db.get(f.assignment._id))).toMatchObject({ flow: 'v2_canvas', exclusionReasons: [] })
  expect(await f.t.run(ctx => ctx.db.get(f.row._id))).toEqual(coldCheck)
  expect(await f.t.run(ctx => ctx.db.get(f.response._id))).toEqual(f.response)
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').withIndex('by_userId_and_assignmentId_and_purpose_and_status_and_serverTime', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('assignmentId', f.assignment._id).eq('purpose', 'teaching').eq('status', 'granted')).take(2)))
    .toEqual([expect.objectContaining({ provenanceVersion: 'learn-v2.instructional-flow.v2_canvas.v1' })])
})

test.each(['placement', 'plan_root', 'objective', 'parent', 'blueprint', 'origin_digest', 'ambiguous_origin'] as const)(
  'Canvas successor continuation rejects unrelated or broken %s lineage', async failure => {
    const original = await canvasColdTeaching('canvas')
    const f = await reflowCanvasTeaching(original)
    await f.t.run(async ctx => {
      if (failure === 'placement') await ctx.db.patch(f.graph.studySessionId, { placementId: 'unrelated-lesson' })
      if (failure === 'parent') await ctx.db.patch(f.graph.studyPlanRevisionId, { parentRevisionId: undefined })
      if (failure === 'blueprint') await ctx.db.patch(f.graph.studyPlanRevisionId, { blueprintRecordRevision: 2 })
      if (failure === 'origin_digest') await ctx.db.patch(original.contentId, { inputDigest: 'different-original-input' })
      if (failure === 'ambiguous_origin') {
        const { _id: _id, _creationTime: _time, ...source } = (await ctx.db.get(original.graph.studySessionId))!
        await ctx.db.insert('studySessions', source)
      }
      if (failure === 'objective') {
        const { _id: _id, _creationTime: _time, ...objective } = (await ctx.db.get(f.graph.objectiveId))!
        const objectiveId = await ctx.db.insert('learnObjectives', objective)
        await ctx.db.patch(f.graph.studySessionId, { primaryObjectiveId: objectiveId })
        await ctx.db.patch(f.contentId, { objectiveId })
      }
      if (failure === 'plan_root') {
        const studyPlanId = await ctx.db.insert('studyPlans', { userId: deliveryIdentity.tokenIdentifier, learningVoidId: f.graph.learningVoidId,
          revision: 1, createdAt: Date.now() })
        const { _id: _id, _creationTime: _time, ...plan } = (await ctx.db.get(f.graph.studyPlanRevisionId))!
        const planId = await ctx.db.insert('studyPlanRevisions', { ...plan, studyPlanId, parentRevisionId: undefined })
        await ctx.db.patch(studyPlanId, { activeRevisionId: planId })
        await ctx.db.patch(f.graph.studySessionId, { studyPlanRevisionId: planId })
        await ctx.db.patch(f.contentId, { studyPlanRevisionId: planId })
      }
    })
    const before = await canvasContinuationWrites(f)
    const request = { studySessionId: f.graph.studySessionId, expectedSessionRevision: 2, idempotencyKey: 'canvas_unrelated_successor_12345' }
    expect(await f.owner.mutation(learnV2CanvasMeasurementApi.startSession, { ...request, expectedContentRevision: 1 })).toMatchObject({ kind: 'not_admitted' })
    expect(await f.owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, request)).toMatchObject({ kind: 'not_admitted' })
    expect(await canvasContinuationWrites(f)).toEqual(before)
    expect(await f.t.run(ctx => ctx.db.get(f.response._id))).toEqual(f.response)
  })

test.each(['missing_membership', 'foreign_membership', 'broken_lineage', 'binding', 'source_purge', 'cold_link', 'cold_assignment', 'cold_session'] as const)(
  'carried Canvas application rejects %s without changing its frozen pins', async failure => {
    const f = await canvasColdTeaching('canvas')
    await f.t.run(async ctx => {
      const { futureId } = await seedFixedCheckPlan(ctx, deliveryIdentity.tokenIdentifier, f.graph, Date.now())
      await ctx.db.delete(futureId)
      await ctx.db.patch(f.graph.studySessionId, { status: 'ready', missedAt: undefined })
    })
    const start = { studySessionId: f.graph.studySessionId, expectedSessionRevision: 2, expectedContentRevision: 1,
      idempotencyKey: 'canvas_carried_denial_start_12345' }
    const attached = await f.owner.mutation(learnV2CanvasMeasurementApi.startSession, start)
    if (attached.kind !== 'attached') throw new Error(JSON.stringify(attached))
    const before = (await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId }))!
    const session = (await f.t.run(ctx => ctx.db.get(f.graph.studySessionId)))!
    const application = (await f.t.run(ctx => ctx.db.get(session.assessmentOpportunityId!)))!
    const coldPins = (await f.t.run(ctx => ctx.db.get(f.row._id)))!.contextPins
    if (!('contextPins' in f.response)) throw new Error('Expected assessment response')
    const responsePins = f.response.contextPins
    const reflow = await f.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: f.graph.studyPlanRevisionId,
      expectedPlanRecordRevision: 1, idempotencyKey: 'canvas_carried_denial_reflow_12345' })
    if (!reflow.successorPlanRevisionId) throw new Error('Expected successor')
    const destination = reflow.successorPlanRevisionId
    await f.t.run(async ctx => {
      if (failure === 'missing_membership') await ctx.db.patch(session._id, { carriedPlanRevisionId: undefined })
      if (failure === 'cold_link') await ctx.db.patch(session._id, { canvasColdCheckId: application._id })
      if (failure === 'cold_assignment') await ctx.db.patch(f.assignment._id, { flow: 'v2_today' })
      if (failure === 'cold_session' && coldPins.kind === 'session') await ctx.db.patch(coldPins.studySessionId, { schedulerVersion: 'ordinary-session.v1' })
      if (failure === 'broken_lineage') await ctx.db.patch(destination, { parentRevisionId: undefined })
      if (failure === 'binding' && application.contextPins.kind === 'session') await ctx.db.patch(application._id, {
        contextPins: { ...application.contextPins, contentInputDigest: 'mismatched-application-input' } })
      if (failure === 'foreign_membership') {
        const { _id: _id, _creationTime: _time, ...plan } = (await ctx.db.get(destination))!
        const foreign = await ctx.db.insert('studyPlanRevisions', { ...plan, userId: 'https://auth.example|foreign' })
        await ctx.db.patch(session._id, { carriedPlanRevisionId: foreign })
      }
    })
    if (failure === 'source_purge') await f.owner.mutation(api.learnV2Sources.markUnavailable, { sourceSnapshotId: f.graph.sourceSnapshotId,
      expectedRevision: 1, reason: 'source_deleted', idempotencyKey: 'canvas_carried_source_withdrawal_12345' })
    const canvas = await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId })
    expect(canvas?.status ?? 'blocked').toBe('blocked')
    expect(canvas?.responsePrompt).toBeFalsy()
    expect(await f.owner.mutation(learnV2CanvasMeasurementApi.startSession, start)).toMatchObject({ kind: 'not_admitted' })
    expect(await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { threadId: attached.threadId, activityId: attached.activityId,
      studySessionId: session._id, expectedRevision: before.thread.revision, expectedSessionRevision: before.session.revision,
      response: 'A response with withdrawn authority.', confidence: 3, idempotencyKey: 'canvas_carried_denied_submit_12345' })).toMatchObject({ kind: 'rejected' })
    expect((await f.t.run(ctx => ctx.db.get(f.row._id)))!.contextPins).toEqual(coldPins)
    expect((await f.t.run(ctx => ctx.db.get(f.response._id)))!).toMatchObject({ contextPins: responsePins })
    expect(await f.t.run(ctx => ctx.db.query('learnResponses').withIndex('by_userId', q => q.eq('userId', deliveryIdentity.tokenIdentifier)).take(8))).toHaveLength(1)
  })

test.each(['unsealed', 'open_check', 'separation_unknown', 'evidence'] as const)('Canvas successor retains the %s gate', async failure => {
  const f = await reflowCanvasTeaching(await canvasColdTeaching('canvas'))
  if (failure === 'unsealed') await f.t.run(ctx => ctx.db.patch(f.row._id, { phase: 'test_open', submissionId: undefined, authoritativeAttemptId: undefined }))
  if (failure === 'evidence') await f.t.run(ctx => ctx.db.patch(f.graph.sourceSnapshotId, { effectiveStatus: 'unavailable' }))
  if (failure === 'separation_unknown') {
    const compare = vi.mocked(measurementItemAdapters.compare)
    const original = compare.getMockImplementation()!
    compare.mockImplementation(async input => JSON.stringify(input.content).includes('"kind":"independent_application"')
      ? { decision: 'unknown', coverage: 'unknown' } : original(input))
  }
  if (failure === 'open_check') {
    const delayed = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_assignmentId_and_horizonDays', q =>
      q.eq('userId', deliveryIdentity.tokenIdentifier).eq('assignmentId', f.assignment._id).eq('horizonDays', 7)).unique()))!
    await f.t.run(ctx => ctx.db.patch(f.graph.studySessionId, { scheduledEndAt: delayed.closeAt + 60_000 }))
    vi.setSystemTime(delayed.openAt)
    await f.t.mutation(materializeDue, { userId: deliveryIdentity.tokenIdentifier, through: Date.now() })
  }
  const before = await canvasContinuationWrites(f)
  expect(await f.owner.mutation(learnV2CanvasMeasurementApi.startSession, { studySessionId: f.graph.studySessionId, expectedSessionRevision: 2,
    expectedContentRevision: 1, idempotencyKey: 'canvas_successor_guard_12345' })).toMatchObject({ kind: 'not_admitted',
    reasonCode: failure === 'unsealed' ? 'not_sealed' : failure === 'open_check' ? 'test_open' : failure === 'evidence' ? 'evidence_unavailable' : 'disclosure_unknown' })
  expect(await canvasContinuationWrites(f)).toEqual(before)
  expect(await f.t.run(ctx => ctx.db.get(f.response._id))).toEqual(f.response)
})

test.each([false, true])('Canvas successor origin lookup keeps the ordinary plan bound with overflow=%s', async overflow => {
  const original = await canvasColdTeaching('canvas')
  const f = await reflowCanvasTeaching(original)
  await f.t.run(async ctx => {
    const { _id: _id, _creationTime: _time, ...source } = (await ctx.db.get(original.graph.studySessionId))!
    for (let index = 0; index < 599; index++) await ctx.db.insert('studySessions', { ...source, placementId: `other-placement-${index}` })
  })
  expect(await f.owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, { studySessionId: f.graph.studySessionId,
    expectedSessionRevision: 2, idempotencyKey: 'canvas_successor_bounded_prepare_12345' })).toMatchObject({ kind: 'prepared', assessmentOpportunityId: f.row._id })
  if (overflow) await f.t.run(async ctx => {
    const { _id: _id, _creationTime: _time, ...source } = (await ctx.db.get(original.graph.studySessionId))!
    await ctx.db.insert('studySessions', { ...source, placementId: 'overflow-placement' })
  })
  const before = await canvasContinuationWrites(f)
  const result = await f.owner.mutation(learnV2CanvasMeasurementApi.startSession, { studySessionId: f.graph.studySessionId, expectedSessionRevision: 2,
    expectedContentRevision: 1, idempotencyKey: 'canvas_successor_overflow_start_12345' })
  expect(result).toMatchObject(overflow ? { kind: 'not_admitted', reasonCode: 'pins_mismatch' } : { kind: 'attached' })
  if (overflow) expect(await canvasContinuationWrites(f)).toEqual(before)
})

test('Canvas continuation preserves the Today treatment and rejects an unsealed check', async () => {
  const f = await canvasColdTeaching('today')
  const request = { studySessionId: f.graph.studySessionId, expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'today_cannot_canvas_start_12345' }
  expect(await f.owner.mutation(learnV2CanvasMeasurementApi.startSession, request)).toMatchObject({ kind: 'not_admitted', reasonCode: 'flow_mismatch' })
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, { ...request, entryPoint: 'today' }))
    .toMatchObject({ status: 'in_progress', sessionContentId: f.contentId })
  expect(await f.t.run(ctx => ctx.db.get(f.assignment._id))).toMatchObject({ flow: 'v2_today', exclusionReasons: [] })
  expect(await f.t.run(ctx => ctx.db.get(f.row._id))).toMatchObject({ operationalEligibility: 'eligible' })
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').withIndex('by_userId_and_assignmentId_and_purpose_and_status_and_serverTime', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('assignmentId', f.assignment._id).eq('purpose', 'teaching').eq('status', 'granted')).take(2)))
    .toEqual([expect.objectContaining({ provenanceVersion: 'learn-v2.instructional-flow.v2_today.v1' })])
  const canvas = await canvasColdTeaching('canvas', { score: false })
  await canvas.t.run(ctx => ctx.db.patch(canvas.row._id, { phase: 'test_open', submissionId: undefined }))
  expect(await canvas.owner.mutation(learnV2CanvasMeasurementApi.startSession, { ...request, studySessionId: canvas.graph.studySessionId }))
    .toMatchObject({ kind: 'not_admitted', reasonCode: 'not_sealed' })
  expect(await canvas.t.run(ctx => ctx.db.get(canvas.graph.studySessionId))).toEqual(canvas.instructionalSession)
})

test('Canvas continuation rechecks pins, pilot, evidence and idempotency without starting a second application', async () => {
  const f = await canvasColdTeaching('canvas')
  const request = { studySessionId: f.graph.studySessionId, expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'canvas_cold_continuation_retry_12345' }
  expect(await f.owner.mutation(learnV2CanvasMeasurementApi.startSession, { ...request, expectedContentRevision: 2 }))
    .toMatchObject({ kind: 'not_admitted', reasonCode: 'evidence_unavailable' })
  const attached = await f.owner.mutation(learnV2CanvasMeasurementApi.startSession, request)
  if (attached.kind !== 'attached') throw new Error(JSON.stringify(attached))
  await expect(f.owner.mutation(learnV2CanvasMeasurementApi.startSession, { ...request, expectedContentRevision: 2 })).rejects.toThrow(/different request/)
  expect(await f.owner.mutation(learnV2CanvasMeasurementApi.startSession, { ...request, idempotencyKey: 'canvas_cold_second_continuation_12345' }))
    .toMatchObject({ kind: 'not_admitted', reasonCode: 'session_unavailable' })
  const before = await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').withIndex('by_userId', q => q.eq('userId', deliveryIdentity.tokenIdentifier)).take(16))
  vi.stubEnv('LEARN_ADAPTIVE_V2_PILOT_MANIFEST', '')
  expect(await f.owner.mutation(learnV2CanvasMeasurementApi.startSession, request)).toMatchObject({ kind: 'not_admitted' })
  vi.stubEnv('LEARN_ADAPTIVE_V2_PILOT_MANIFEST', ADAPTIVE_V2_PILOT_MANIFEST.version)
  await f.t.run(ctx => ctx.db.patch(f.contentId, { inputDigest: 'stale-content-input' }))
  expect(await f.owner.mutation(learnV2CanvasMeasurementApi.startSession, request)).toMatchObject({ kind: 'not_admitted' })
  await f.t.run(ctx => ctx.db.patch(f.contentId, { inputDigest: f.instructionalContent!.inputDigest }))
  await f.t.run(ctx => ctx.db.patch(f.graph.sourceSnapshotId, { effectiveStatus: 'unavailable' }))
  expect(await f.owner.mutation(learnV2CanvasMeasurementApi.startSession, request)).toMatchObject({ kind: 'not_admitted' })
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').withIndex('by_userId', q => q.eq('userId', deliveryIdentity.tokenIdentifier)).take(16))).toEqual(before)
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_contextPins_studySessionId', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('contextPins.studySessionId', f.graph.studySessionId)).take(2))).toHaveLength(1)
})

test('Canvas cold permits separate practice while scoring is pending and withholds pass-only teaching', async () => {
  const f = await canvasColdTeaching('canvas', { score: false, pass: true })
  expect(await f.read()).toMatchObject({ status: 'available', feedback: null, lesson: null, practice: null,
    availability: { feedback: 'scoring_pending', practice: { status: 'not_opened' } } })
  const opened = await f.open()
  if (opened.status !== 'available' || !opened.practice) throw new Error('Expected pending practice')
  expect(await f.help(opened.practice.responseSlotId, 'worked_example')).toMatchObject({ status: 'authorized' })
  expect(await f.help(opened.practice.responseSlotId, 'hint')).toMatchObject({ status: 'denied', reasonCode: 'unavailable' })
  expect(await f.score(f.response._id)).toMatchObject({ status: 'scored', result: { scorePercent: 100 } })
  expect(await f.read()).toMatchObject({ status: 'available', feedback: { tier: 'T0' }, lesson: null,
    practice: { responseSlotId: opened.practice.responseSlotId } })
  expect(await f.help(opened.practice.responseSlotId, 'hint')).toMatchObject({ status: 'denied', reasonCode: 'unavailable' })
  expect(await f.t.run(ctx => ctx.db.get(f.response._id))).toEqual(f.response)
})

test('Canvas cold rechecks a relevant open sibling before teaching, help replay and practice acceptance', async () => {
  const f = await canvasColdTeaching('canvas')
  const opened = await f.open()
  if (opened.status !== 'available' || !opened.practice) throw new Error('Expected practice')
  expect(await f.help(opened.practice.responseSlotId, 'hint')).toMatchObject({ status: 'authorized' })
  const delayed = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier)).take(8))).find(row => row.horizonDays === 7)!
  await f.t.run(ctx => ctx.db.patch(f.graph.studySessionId, { scheduledEndAt: delayed.closeAt + 60_000 }))
  vi.setSystemTime(delayed.openAt)
  await f.t.mutation(materializeDue, { userId: deliveryIdentity.tokenIdentifier, through: Date.now() })
  expect(await f.read()).toMatchObject({ status: 'unavailable', reasonCode: 'test_open' })
  expect(await f.open()).toMatchObject({ status: 'unavailable', reasonCode: 'test_open' })
  expect(await f.help(opened.practice.responseSlotId, 'hint')).toMatchObject({ status: 'denied', reasonCode: 'test_open' })
  expect(await f.owner.mutation(learnV2CanvasMeasurementApi.startSession, { studySessionId: f.graph.studySessionId,
    expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'canvas_cold_locked_continuation_12345' }))
    .toMatchObject({ kind: 'not_admitted', reasonCode: 'test_open' })
  expect(await f.t.run(ctx => ctx.db.get(f.graph.studySessionId))).toMatchObject({ status: 'ready', revision: 2 })
  expect(await f.owner.mutation(api.learnV2Responses.acceptResponse, { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: 'canvas_cold_locked_practice_12345', response: { target: { responseSlotId: opened.practice.responseSlotId },
      expectedRevision: opened.practice.revision, payload: { kind: 'text', text: 'A separate practice response.' } } })).toMatchObject({ kind: 'rejected' })
  expect(await f.t.run(ctx => ctx.db.get(f.response._id))).toEqual(f.response)
  vi.setSystemTime(delayed.closeAt)
  await f.t.mutation(materializeDue, { userId: deliveryIdentity.tokenIdentifier, through: Date.now() })
  expect(await f.read()).toMatchObject({ status: 'available', feedback: { tier: 'T0' }, lesson: { tier: 'T0' } })
})

test.each(['feedback', 'lesson', 'practice', 'hint', 'worked_example'] as const)('Canvas cold %s requires complete exact-check separation', async kind => {
  const f = await canvasColdTeaching('canvas', { score: kind !== 'feedback' && kind !== 'lesson' })
  const opened = kind === 'hint' || kind === 'worked_example' ? await f.open() : null
  const compare = vi.mocked(measurementItemAdapters.compare)
  const original = compare.getMockImplementation()!
  compare.mockImplementation(async input => deliveryKind(input.content) === kind
    ? { decision: 'unknown', coverage: 'unknown' } : original(input))
  if (kind === 'feedback' || kind === 'lesson') {
    expect(await f.score(f.response._id)).toMatchObject({ status: 'scored' })
    expect(await f.read()).toMatchObject({ status: 'available', feedback: null, lesson: null })
  } else if (kind === 'practice') {
    expect(await f.open()).toMatchObject({ status: 'available', practice: null,
      availability: { practice: { status: 'unavailable', reasonCode: 'disclosure_unknown' } } })
  } else {
    if (opened?.status !== 'available' || !opened.practice) throw new Error('Expected practice')
    expect(await f.help(opened.practice.responseSlotId, kind)).toMatchObject({ status: 'denied', reasonCode: 'disclosure_unknown' })
  }
})

test('closing an unplayable Today check removes its post-seal teaching lock', async () => {
  const f = await canvasColdTeaching()
  const delayed = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier)).take(8))).find(row => row.horizonDays === 7)!
  vi.setSystemTime(delayed.openAt)
  await f.t.mutation(materializeDue, { userId: deliveryIdentity.tokenIdentifier, through: Date.now() })
  const ready = (await f.t.run(ctx => ctx.db.get(delayed._id)))!
  if (ready.contextPins.kind !== 'session' || !ready.contextPins.canvas) throw new Error('Expected delayed Canvas check')
  expect(await f.read()).toMatchObject({ status: 'unavailable', reasonCode: 'test_open' })
  const threadId = ready.contextPins.canvas.threadId
  await f.t.run(ctx => ctx.db.delete(threadId))
  await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.graph.studySessionId,
    idempotencyKey: 'unplayable_today_check_delivery_12345' })
  expect(await f.t.run(ctx => ctx.db.get(ready._id))).toMatchObject({ phase: 'cancelled' })
  expect(await f.read()).toMatchObject({ status: 'available', feedback: { tier: 'T0' }, lesson: { tier: 'T0' } })
  expect(await f.open()).toMatchObject({ status: 'available', practice: { revision: 1 } })
})

test.each(['today', 'canvas'] as const)('a sealed cancelled %s check retains separate practice without releasing score-driven teaching', async entryPoint => {
  const f = await canvasColdTeaching(entryPoint)
  const opened = await f.open()
  if (opened.status !== 'available' || !opened.practice) throw new Error('Expected practice')
  const slotId = opened.practice.responseSlotId
  const savedHelp = await f.help(slotId, 'worked_example')
  const sealed = (await f.t.run(ctx => ctx.db.get(f.row._id)))!
  const assignment = f.assignment
  if (assignment.status !== 'admitted') throw new Error('Expected assignment')
  await f.owner.run(ctx => closeUnplayableLearnCheck(ctx, assignment, sealed, 'canvas_not_admitted'))
  expect(await f.t.run(ctx => ctx.db.get(f.row._id))).toEqual(sealed)
  await f.t.run(ctx => ctx.db.patch(f.row._id, { phase: 'cancelled' }))
  expect(await f.read()).toMatchObject({ status: 'available', feedback: null, lesson: null, practice: { responseSlotId: slotId },
    availability: { feedback: 'unavailable', practice: { status: 'available' } } })
  expect(await f.help(slotId, 'worked_example')).toEqual(savedHelp)
  expect(await f.help(slotId, 'hint')).toMatchObject({ status: 'denied', reasonCode: 'unavailable' })
  expect(await f.owner.query(api.learnV2Assessments.getAssessmentState, { version: LEARN_V2_PUBLIC_API_VERSION,
    assessmentOpportunityId: f.row._id })).toMatchObject({ status: 'unavailable' })
  expect(await f.t.run(ctx => ctx.db.get(f.response._id))).toEqual(f.response)
})

test('dedicated sealing, expiry and due-work closure preserve their exact revision', async () => {
  const f = await ordinary()
  expect(await f.score(f.receipt.submissionId)).toMatchObject({ status: 'scored' })
  const row = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').take(8))).find(row => row.horizonDays === 7)!
  vi.setSystemTime(row.openAt)
  await f.t.mutation(materializeDue, { userId: deliveryIdentity.tokenIdentifier, through: Date.now() })
  const ready = (await f.t.run(ctx => ctx.db.get(row._id)))!
  if (ready.contextPins.kind !== 'session') throw new Error('Expected dedicated check')
  const opened = await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: ready.contextPins.studySessionId,
    expectedSessionRevision: ready.contextPins.sessionRevision, expectedContentRevision: 1, entryPoint: 'today', idempotencyKey: 'post_seal_dedicated_start_12345' })
  if (opened.status !== 'assessment' || opened.deliveryGrant?.status !== 'granted') throw new Error('Expected check grant')
  const receipt = await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: {
    version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'post_seal_dedicated_seal_12345', response: {
      target: { assessmentOpportunityId: row._id }, expectedRevision: opened.deliveryGrant.revision, payload: { kind: 'numeric', value: 0, unit: 'members' } } } })
  if (receipt.kind !== 'accepted') throw new Error('Expected dedicated acceptance')
  const response = (await f.t.run(ctx => ctx.db.get(receipt.submissionId)))!
  if (response.scopeKind !== 'v2' || response.contextPins.kind !== 'session') throw new Error('Expected session pins')
  expect(await f.t.run(ctx => ctx.db.get(ready.contextPins.kind === 'session' ? ready.contextPins.studySessionId : f.graph.studySessionId)))
    .toMatchObject({ status: 'completed', revision: response.contextPins.sessionRevision })
  expect(await f.open(row._id)).toMatchObject({ status: 'available', practice: { revision: 1 } })
  expect(await f.score(receipt.submissionId)).toMatchObject({ status: 'scored' })
  vi.setSystemTime(row.closeAt + 1)
  await f.owner.mutation(api.learnV2Plans.markExpiredSessionsMissed, { learningVoidId: f.graph.learningVoidId, idempotencyKey: 'post_seal_dedicated_expiry_12345' })
  await f.t.mutation(materializeDue, { userId: deliveryIdentity.tokenIdentifier, through: Date.now() })
  expect(await f.read(row._id)).toMatchObject({ status: 'available', feedback: { tier: 'T0' }, practice: { revision: 1 } })
  expect(await f.t.run(ctx => ctx.db.get(response.contextPins.kind === 'session' ? response.contextPins.studySessionId : f.graph.studySessionId)))
    .toMatchObject({ status: 'completed', revision: response.contextPins.sessionRevision })
  expect(await f.t.run(ctx => ctx.db.get(receipt.submissionId))).toEqual(response)
})

test('expiry and due-work closure never admit an unsubmitted dedicated check or bump its revision', async () => {
  const f = await fixture()
  await cold(f)
  const row = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').take(8))).find(row => row.horizonDays === 7)!
  vi.setSystemTime(row.openAt)
  await f.t.mutation(materializeDue, { userId: deliveryIdentity.tokenIdentifier, through: Date.now() })
  const ready = (await f.t.run(ctx => ctx.db.get(row._id)))!
  if (ready.contextPins.kind !== 'session') throw new Error('Expected dedicated session')
  const pins = ready.contextPins
  vi.setSystemTime(row.closeAt + 1)
  expect(await f.owner.mutation(api.learnV2Plans.markStudySessionMissed, { studySessionId: pins.studySessionId,
    expectedSessionRevision: pins.sessionRevision, idempotencyKey: 'unsubmitted_check_expiry_12345' }))
    .toMatchObject({ status: 'missed', revision: pins.sessionRevision })
  await f.t.mutation(materializeDue, { userId: deliveryIdentity.tokenIdentifier, through: Date.now() })
  expect(await f.t.run(ctx => ctx.db.get(pins.studySessionId))).toMatchObject({ status: 'missed', revision: pins.sessionRevision })
  expect((await f.t.run(ctx => ctx.db.get(row._id)))!.contextPins).toEqual(pins)
  expect(await f.read(row._id)).toMatchObject({ status: 'unavailable' })
  expect(await f.open(row._id)).toMatchObject({ status: 'unavailable' })
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealPracticeBindings').take(2))).toEqual([])
})
