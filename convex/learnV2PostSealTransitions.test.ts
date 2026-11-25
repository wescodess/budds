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
vi.mock('./lib/learnV2MeasurementScorerInventory', () => ({ getLearnMeasurementScorer: async () => policy.scorer }))

const originalManifest = structuredClone(ADAPTIVE_V2_PILOT_MANIFEST)
const materializeDue = makeFunctionReference<'mutation', { userId: string, through: number }>('learnV2MeasurementDueWork:materializeDelayedCheckEligibility')
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
  const registry = await createLearnScorerRegistry({ epoch: 'synthetic.epoch.v1', configurations: [{ definition, expectedDigest: saved.binding.configurationDigest }],
    legacyAllowlist: canvas ? [] : [definition.configurationId], prospectiveConfigurationId: null })
  policy.scorer = { registry, saved }
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
  const attached = await f.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId,
    expectedSessionRevision: 2, idempotencyKey: 'post_seal_canvas_attach_12345' })
  if (attached.kind !== 'attached') throw new Error('Expected Canvas attachment')
  const receipt = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, { threadId: attached.threadId, activityId: attached.activityId,
    studySessionId, expectedRevision: 1, expectedSessionRevision: 3, response: 'A supported Canvas response.',
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

async function todayCanvasTeaching() {
  policy.todayCanvas = true
  const f = await fixture(true, undefined, undefined, { pass: false })
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
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: f.graph.studySessionId,
    expectedSessionRevision: 2, expectedContentRevision: 1, entryPoint: 'today', idempotencyKey: 'today_surface_post_seal_start_12345' }))
    .toMatchObject({ status: 'assessment' })
  const row = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier)).take(8))).find(row => row.purpose.kind === 'measurement_cold')!
  const assignment = (await f.t.run(ctx => ctx.db.get(row.assignmentId!)))!
  expect(assignment).toMatchObject({ status: 'admitted', flow: 'v2_today', checkSurface: { surface: 'canvas', measurementFlow: 'v2_today' } })
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
    contextPins: { checkSurface: { surface: 'canvas', measurementFlow: 'v2_today' } } })
  expect(await f.owner.action(api.learnAdaptive.submitResponse, { threadId: attached.threadId, activityId: attached.activityId,
    submissionId: receipt.submissionId, idempotencyKey: 'today_surface_post_seal_score_12345' })).toMatchObject({ kind: 'accepted', status: 'completed' })
  const reference = { version, assessmentOpportunityId: row._id }
  const read = () => f.owner.query(learnV2CanvasMeasurementApi.getPostSealTeaching, reference)
  const open = () => f.owner.mutation(learnV2CanvasMeasurementApi.openPostSealPractice, reference)
  const help = (slotId: Id<'learnResponseSlots'>, kind: 'hint' | 'worked_example') => f.owner.mutation(learnV2CanvasMeasurementApi.authorizePracticeAssistance,
    { ...reference, target: { responseSlotId: slotId }, expectedRevision: 1, kind, idempotencyKey: `today_surface_help_${kind}_12345` })
  return { ...f, row, response, assignment, read, open, help }
}

test('Today treatment on the Canvas surface seals, scores and delivers teaching, practice and both help kinds', async () => {
  const f = await todayCanvasTeaching()
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

test('closing an unplayable Today check removes its post-seal teaching lock', async () => {
  const f = await todayCanvasTeaching()
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

test('a sealed cancelled check retains separate practice without releasing score-driven teaching', async () => {
  const f = await todayCanvasTeaching()
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
