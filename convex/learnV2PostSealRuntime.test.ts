/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import { getFunctionName, makeFunctionReference } from 'convex/server'
import type { Doc } from './_generated/dataModel'
import { assessmentDeliveryFixture, deliveryIdentity, publishDeliveryTeaching, syntheticDeliveryProtocol } from '../tests/fixtures/learn-v2-assessment-delivery'
import { prepareAndRegisterInstructionalArtifactsForOwner, instructionalReservationSemanticAdapter } from './lib/learnV2ArtifactLineage'
import * as helpAdmission from './lib/learnV2HelpAdmission'
import * as postSealTeaching from './lib/learnV2PostSealTeaching'
import { measurementItemAdapters } from './lib/learnV2MeasurementItems'
import { postSealApplicationFields } from './lib/learnV2PostSealStamp'
import { learnV2CanvasMeasurementApi, learnV2TodayMeasurementApi } from './learnV2ApiAdapters'
import { LEARN_V2_POST_SEAL_TEACHING_VERSION as version } from '../shared/learn-v2-assessment-disclosure'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION } from '../shared/learn-v2-responses'
import { LEARN_V2_PUBLIC_API_VERSION } from './lib/learnV2PublicContract'
import { learnPostSealTeachingSourceStorageSchema } from '../shared/learn-v2-post-seal-storage'

const policy = vi.hoisted(() => ({ responses: true, protocol: null as unknown }))
vi.mock('../shared/learn-v2-measurement-storage-manifest', async original => {
  const value = await original<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...value, LEARN_MEASUREMENT_CAPABILITIES: { ...value.LEARN_MEASUREMENT_CAPABILITIES,
    enrollment: true, delivery: true, scoring: true, get responses() { return policy.responses } } }
})
vi.mock('./lib/learnV2MeasurementAssignment', async original => {
  const value = await original<typeof import('./lib/learnV2MeasurementAssignment')>()
  return { ...value, getFrozenLearnMeasurementProtocol: () => policy.protocol }
})

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(Date.parse('2027-03-07T15:00:00Z'))
  policy.responses = true; policy.protocol = syntheticDeliveryProtocol()
  vi.spyOn(instructionalReservationSemanticAdapter, 'compare').mockResolvedValue({ decision: 'pass', coverage: 'complete' })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers() })

async function fixture(options: { prepare?: boolean, score?: boolean, pass?: boolean, citationSource?: boolean } = {}) {
  const f = await assessmentDeliveryFixture({ transactionLimits: true })
  const contentId = await publishDeliveryTeaching(f)
  const blocks = await f.t.run(ctx => ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('sessionContentId', contentId)).take(16))
  const practiceBlock = blocks.find(block => block.kind === 'faded_example')!
  const explanation = blocks.find(block => block.kind === 'explanation')!
  const example = blocks.find(block => block.kind === 'worked_example')!
  const citationSource = options.citationSource ? await f.t.run(async ctx => {
    const source = (await ctx.db.get(f.graph.sourceSnapshotId))!
    const identity = (await ctx.db.get(source.sourceIdentityId))!
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { ...postSealApplicationFields(identity), externalKey: 'citation-only-source' })
    const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', { ...postSealApplicationFields(source), sourceIdentityId })
    const excerpt = (await ctx.db.get(f.graph.sourceExcerptId))!
    const sourceExcerptId = await ctx.db.insert('learnSourceExcerpts', { ...postSealApplicationFields(excerpt), sourceSnapshotId })
    return { kind: 'excerpt' as const, sourceSnapshotId, sourceExcerptId, revision: 1, recordRevision: 1, contentHash: source.contentHash! }
  }) : null
  await f.owner.run(ctx => prepareAndRegisterInstructionalArtifactsForOwner(ctx, deliveryIdentity.tokenIdentifier, { artifacts: [practiceBlock, explanation, example].map(block => ({
    artifact: { kind: 'session_block', id: block._id }, key: 'whole', origins: [],
    sources: [{ kind: 'excerpt', sourceSnapshotId: f.graph.sourceSnapshotId, sourceExcerptId: f.graph.sourceExcerptId,
      revision: 1, recordRevision: 1, contentHash: f.graph.support.sourceContentHash }, ...(citationSource && block.kind !== 'faded_example' ? [citationSource] : [])],
  })) }))
  const start = await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: f.graph.studySessionId,
    expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'post_seal_start_12345', entryPoint: 'today' })
  expect(start).toMatchObject({ status: 'assessment' })
  const opportunity = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').take(8))).find(row => row.purpose.kind === 'measurement_cold')!
  const correct = await f.t.run(async ctx => {
    if (opportunity.assessmentPins.kind !== 'measurement') throw new Error('Expected measurement')
    const spec = await ctx.db.get(opportunity.assessmentPins.itemPins.scoringSpecId)
    if (spec?.payload?.kind !== 'numeric') throw new Error('Expected numeric key')
    return spec.payload.expected
  })
  const accepted = await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: {
    version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'post_seal_accept_12345',
    response: { target: { assessmentOpportunityId: opportunity._id }, expectedRevision: opportunity.revision,
      payload: { kind: 'numeric', value: options.pass ? correct : 0, unit: 'members' } } } })
  if (accepted.kind !== 'accepted') throw new Error(`Expected acceptance: ${JSON.stringify(accepted)}`)
  const reference = { version, assessmentOpportunityId: opportunity._id }
  const prepare = () => f.owner.mutation(api.learnV2PostSealTeaching.openPractice, reference)
  const score = () => f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: accepted.submissionId, idempotencyKey: 'post_seal_score_12345' })
  if (options.score) expect(await score()).toMatchObject({ status: 'scored' })
  if (options.prepare !== false) expect(await prepare()).toMatchObject({ status: 'available', practice: { revision: 1 } })
  const read = () => f.owner.query(api.learnV2Assessments.getPostSealTeaching, reference)
  const publish = () => f.owner.mutation(internal.learnV2PostSealTeaching.publishTeaching, { submissionId: accepted.submissionId })
  const binding = async () => (await f.t.run(ctx => ctx.db.query('learnPostSealPracticeBindings').take(2)))[0]!
  const source = async () => (await f.t.run(ctx => ctx.db.query('learnPostSealTeachingSources').take(2)))[0]!
  const request = async (key = 'practice_help_runtime_123', kind: 'hint' | 'worked_example' = 'worked_example') => ({ ...reference,
    target: { responseSlotId: (await binding()).responseSlotId }, expectedRevision: 1, kind, idempotencyKey: key })
  const help = async (key?: string, kind?: 'hint' | 'worked_example') => f.owner.mutation(api.learnV2Assistance.authorizePracticeAssistance, await request(key, kind))
  const helpState = async () => {
    const value = await read()
    return value.status === 'available' ? value.availability.help : value
  }
  const publishFeedback = () => f.owner.mutation(learnV2CanvasMeasurementApi.publishPostSealFeedback, reference)
  const helpExposures = async () => (await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(64))).filter(row => row.practiceHelp)
  const acceptPractice = async (key: string) => f.owner.mutation(api.learnV2Responses.acceptResponse, { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: key, response: { target: { responseSlotId: (await binding()).responseSlotId }, expectedRevision: 1,
      payload: { kind: 'text', text: 'A supported practice response.' } } })
  return { ...f, contentId, opportunity, accepted, practiceBlock, explanation, example, citationSource, reference, read, publish, binding, source, request, help,
    prepare, score, publishFeedback, helpExposures, acceptPractice, helpState }
}

test.each(['identical', 'normalized'] as const)('publication atomically rejects %s practice/application content', async variant => {
  const f = await assessmentDeliveryFixture({ transactionLimits: true })
  const prompt = 'Seven parcels contain eleven spare parts apiece. Determine the shipment inventory.'
  const practice = variant === 'identical' ? prompt : ` ${prompt.toUpperCase().replaceAll(' ', '\n  ')} `
  const cases = await f.t.run(ctx => ctx.db.query('learnAssessmentCases').take(64))
  await expect(publishDeliveryTeaching(f, { claims: 1, supports: 1,
    blockContents: { faded_example: practice, independent_application: prompt } })).rejects.toThrow('instructional_case_overlap')
  expect(await f.t.run(ctx => ctx.db.query('sessionContent').take(2))).toEqual([])
  expect(await f.t.run(ctx => ctx.db.query('sessionContentBlocks').take(16))).toEqual([])
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentCases').take(64))).toEqual(cases)
})

test.each([
  ['atlas countries', 'Using the provided atlas, identify the capital city of France.', 'Using the provided atlas, identify the capital city of Japan.'],
  ['operators', 'Calculate 123 + 456', 'Calculate 123 - 456'],
  ['numbers', 'Calculate 123 + 456', 'Calculate 123 + 457'],
  ['similar prose', 'Determine the shipment inventory.', 'Determine the shipment stock.'],
])('publication preserves distinct %s cases', async (_label, practice, application) => {
  const f = await assessmentDeliveryFixture({ transactionLimits: true })
  const id = await publishDeliveryTeaching(f, { claims: 1, supports: 1,
    blockContents: { faded_example: practice!, independent_application: application! } })
  const blocks = await f.t.run(ctx => ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('sessionContentId', id)).take(16))
  expect(blocks.find(block => block.kind === 'faded_example')?.content).toBe(practice)
  expect(blocks.find(block => block.kind === 'independent_application')?.content).toBe(application)
})

test('capability-off publication preserves the existing acceptance of identical instructional blocks', async () => {
  const f = await assessmentDeliveryFixture({ transactionLimits: true })
  policy.responses = false
  expect(await publishDeliveryTeaching(f, { claims: 1, supports: 1,
    blockContents: { faded_example: 'The same prompt.', independent_application: 'The same prompt.' } })).toBeTruthy()
})

test.each(['score_first', 'practice_first', 'concurrent'] as const)('public seal, score and practice opening publish once: %s', async order => {
  const f = await fixture({ prepare: false })
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealPracticeBindings').take(2))).toEqual([])
  await f.read()
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealPracticeBindings').take(2))).toEqual([])
  if (order === 'score_first') {
    expect(await f.score()).toMatchObject({ status: 'scored' })
    expect(await f.read()).toMatchObject({ status: 'available', feedback: { tier: 'T0' }, lesson: { tier: 'T0' }, practice: null })
    expect(await f.prepare()).toMatchObject({ status: 'available', practice: { revision: 1 } })
  } else if (order === 'practice_first') {
    expect(await f.prepare()).toMatchObject({ status: 'available', feedback: null, lesson: null, practice: { revision: 1 } })
    expect(await f.score()).toMatchObject({ status: 'scored' })
  } else await Promise.all([f.prepare(), f.score()])
  expect(await f.read()).toMatchObject({ status: 'available', feedback: { tier: 'T0' }, lesson: { tier: 'T0' }, practice: { revision: 1 } })
  const published = await f.source()
  vi.setSystemTime(Date.now() + 1000)
  await Promise.all([f.prepare(), f.prepare(), f.score(), f.score()])
  expect(await f.source()).toEqual(published)
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealTeachingSources').take(2))).toHaveLength(1)
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealPracticeBindings').take(2))).toHaveLength(1)
  const slots = await f.t.run(ctx => ctx.db.query('learnResponseSlots').withIndex('by_userId_and_slotKey', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('slotKey', `post-seal:${f.accepted.submissionId}`)).take(2))
  expect(slots).toHaveLength(1)
  const sourceLinks = await f.t.run(ctx => ctx.db.query('learnPostSealSourceLinks').withIndex('by_userId_and_target_teachingSourceId', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('target.teachingSourceId', published._id)).take(65))
  expect(sourceLinks).toHaveLength(published.sourceDependencyCount)
})

test('publication failure propagates without undoing a canonical score; a public retry publishes once', async () => {
  const f = await fixture({ prepare: false })
  vi.spyOn(postSealTeaching, 'publishPostSealTeachingForOwner').mockRejectedValueOnce(new Error('Read limit exceeded'))
  await expect(f.score()).rejects.toThrow('Read limit exceeded')
  const row = (await f.t.run(ctx => ctx.db.get(f.opportunity._id)))!
  expect(row).toMatchObject({ phase: 'scored_fail' })
  expect(await f.source()).toMatchObject({ attemptId: row.authoritativeAttemptId, content: { status: 'pending' } })
  expect(await f.score()).toMatchObject({ status: 'scored', result: { attemptId: row.authoritativeAttemptId } })
  expect(await f.read()).toMatchObject({ status: 'available', feedback: { tier: 'T0' }, lesson: { tier: 'T0' } })
  expect(await f.t.run(ctx => ctx.db.query('masteryAttempts').take(2))).toHaveLength(1)
})

test.each([
  ['worked_example', 'hint'], ['hint', 'worked_example'], ['hint', 'hint'], ['worked_example', 'worked_example'],
  ['hint', 'worked_example', 'hint'], ['worked_example', 'hint', 'worked_example'],
] as const)('acceptance preserves every delivered help kind in order %j', async (...kinds) => {
  const f = await fixture({ score: true })
  const first = new Map<string, number>()
  for (const [index, kind] of kinds.entries()) {
    vi.setSystemTime(Date.now() + 1000)
    const delivered = await f.help(`mixed_help_delivery_${index}_12345`, kind)
    if (delivered.status !== 'authorized') throw new Error('Expected delivered help')
    if (!first.has(kind)) first.set(kind, delivered.deliveredAt)
    expect(await f.help(`mixed_help_delivery_${index}_12345`, kind)).toEqual(delivered)
  }
  const binding = await f.binding()
  const command = { version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'mixed_help_acceptance_12345', response: {
    target: { responseSlotId: binding.responseSlotId }, expectedRevision: 1, payload: { kind: 'text' as const, text: 'A supported practice response.' } } }
  const accepted = await f.owner.mutation(api.learnV2Responses.acceptResponse, command)
  if (accepted.kind !== 'accepted') throw new Error('Expected practice acceptance')
  const snapshot = (await f.t.run(ctx => ctx.db.get(accepted.submissionId)))!.assistanceSnapshot
  expect(snapshot).toMatchObject({ state: 'assisted', assistanceRevision: new Set(kinds).size,
    substantiveHintUsedAt: first.get('hint') ?? null, answerRevealedAt: first.get('worked_example') ?? null })
  expect(await f.owner.mutation(api.learnV2Responses.acceptResponse, command)).toEqual(accepted)
  expect((await f.t.run(ctx => ctx.db.get(accepted.submissionId)))!.assistanceSnapshot).toEqual(snapshot)
})

test('repeated help replays one delivery per content and a refreshed read reports content-free help state', async () => {
  const f = await fixture({ score: true })
  expect(await f.helpState()).toEqual({ remaining: 8, hint: { status: 'available' }, worked_example: { status: 'available' } })
  const first = await f.help('repeated_hint_delivery_0_12345', 'hint')
  if (first.status !== 'authorized') throw new Error('Expected delivered help')
  const binding = await f.binding()
  const slot = await f.t.run(ctx => ctx.db.get(binding.responseSlotId))
  for (let index = 1; index < 9; index++) {
    vi.setSystemTime(Date.now() + 1000)
    expect(await f.help(`repeated_hint_delivery_${index}_12345`, 'hint')).toEqual(first)
  }
  expect(await f.t.run(ctx => ctx.db.get(binding.responseSlotId))).toEqual(slot)
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealHelpReceipts').take(8))).toHaveLength(1)
  expect(await f.helpExposures()).toHaveLength(1)
  expect(await f.helpState()).toEqual({ remaining: 7, hint: { status: 'delivered' }, worked_example: { status: 'available' } })
  expect(await f.help('repeated_hint_after_refresh_12345', 'hint')).toEqual(first)
  vi.setSystemTime(Date.now() + 1000)
  const example = await f.help('repeated_example_delivery_12345', 'worked_example')
  if (example.status !== 'authorized') throw new Error('Expected worked example')
  expect(await f.help('repeated_example_after_refresh_12345', 'worked_example')).toEqual(example)
  expect(await f.helpState()).toEqual({ remaining: 6, hint: { status: 'delivered' }, worked_example: { status: 'delivered' } })
  expect(await f.helpExposures()).toHaveLength(2)
  const accepted = await f.acceptPractice('repeated_help_acceptance_12345')
  if (accepted.kind !== 'accepted') throw new Error('Expected practice acceptance')
  expect((await f.t.run(ctx => ctx.db.get(accepted.submissionId)))!.assistanceSnapshot).toMatchObject({
    assistanceRevision: 2, substantiveHintUsedAt: first.deliveredAt, answerRevealedAt: example.deliveredAt })
  expect(await f.helpState()).toEqual({ remaining: 6,
    hint: { status: 'unavailable', reasonCode: 'unavailable' }, worked_example: { status: 'unavailable', reasonCode: 'unavailable' } })
})

test('concurrent fresh keys for one help kind serialize into one delivery', async () => {
  const f = await fixture({ score: true })
  const [first, second] = await Promise.all([f.help('concurrent_hint_tab_one_12345', 'hint'), f.help('concurrent_hint_tab_two_12345', 'hint')])
  expect(first).toMatchObject({ status: 'authorized' })
  expect(second).toEqual(first)
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealHelpReceipts').take(8))).toHaveLength(1)
  expect(await f.helpExposures()).toHaveLength(1)
})

test('the distinct-content cap denies new content with its own reason and still replays delivered help', async () => {
  const f = await fixture({ score: true })
  vi.spyOn(postSealTeaching.postSealHelpPolicy, 'distinctContentLimit').mockReturnValue(1)
  const hint = await f.help('capped_hint_delivery_12345', 'hint')
  if (hint.status !== 'authorized') throw new Error('Expected delivered help')
  const binding = await f.binding()
  const slot = await f.t.run(ctx => ctx.db.get(binding.responseSlotId))
  expect(await f.help('capped_example_delivery_12345', 'worked_example')).toEqual({ version, status: 'denied', reasonCode: 'help_limit_reached' })
  expect(await f.help('capped_hint_after_limit_12345', 'hint')).toEqual(hint)
  expect(await f.help('capped_hint_delivery_12345', 'hint')).toEqual(hint)
  expect(await f.t.run(ctx => ctx.db.get(binding.responseSlotId))).toEqual(slot)
  expect(await f.helpExposures()).toHaveLength(1)
  expect(await f.helpState()).toEqual({ remaining: 0, hint: { status: 'delivered' },
    worked_example: { status: 'unavailable', reasonCode: 'help_limit_reached' } })
})

test('a hint withheld by a passing score stays unavailable, distinct from the cap', async () => {
  const f = await fixture({ score: true, pass: true })
  expect(await f.help('passed_hint_request_12345', 'hint')).toEqual({ version, status: 'denied', reasonCode: 'unavailable' })
  expect(await f.helpState()).toEqual({ remaining: 8,
    hint: { status: 'unavailable', reasonCode: 'unavailable' }, worked_example: { status: 'available' } })
  expect(await f.help('passed_example_request_12345', 'worked_example')).toMatchObject({ status: 'authorized' })
  expect(await f.helpState()).toEqual({ remaining: 7,
    hint: { status: 'unavailable', reasonCode: 'unavailable' }, worked_example: { status: 'delivered' } })
  expect(await f.helpExposures()).toHaveLength(1)
})

test('acceptance rejects an incomplete delivered-help history instead of freezing missing timestamps', async () => {
  const f = await fixture({ score: true })
  const first = await f.help('incomplete_help_first_12345', 'worked_example')
  if (first.status !== 'authorized') throw new Error('Expected delivered help')
  expect(await f.help('incomplete_help_second_12345', 'hint')).toMatchObject({ status: 'authorized' })
  await f.t.run(ctx => ctx.db.delete(first.authorizationId))
  const binding = await f.binding()
  expect(await f.owner.mutation(api.learnV2Responses.acceptResponse, { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: 'incomplete_help_accept_12345', response: { target: { responseSlotId: binding.responseSlotId }, expectedRevision: 1,
      payload: { kind: 'text', text: 'A supported practice response.' } } })).toMatchObject({ kind: 'rejected', reasonCode: 'pins_mismatch' })
  expect(await f.t.run(ctx => ctx.db.get(binding.responseSlotId))).toMatchObject({ status: 'open', revision: 1 })
})

test('publishes persisted feedback and a failure-only lesson; pending practice has no source links', async () => {
  const f = await fixture()
  const pending = await f.source()
  expect(pending).toMatchObject({ attemptId: null, content: { status: 'pending' }, sourceDependencyCount: 0 })
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealSourceLinks').withIndex('by_userId_and_target_teachingSourceId', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('target.teachingSourceId', pending._id)).take(2))).toEqual([])
  expect(await f.read()).toMatchObject({ status: 'available', feedback: null, lesson: null, practice: { revision: 1, prompt: f.practiceBlock.content } })
  expect(await f.publish()).toMatchObject({ status: 'unavailable' })
  await f.score()
  const row = await f.t.run(ctx => ctx.db.get(f.opportunity._id))
  expect(await f.source()).toMatchObject({ attemptId: row!.authoritativeAttemptId })
  expect(await f.publish()).toEqual({ status: 'published' })
  expect(await f.publish()).toEqual({ status: 'published' })
  const read = await f.read()
  expect(read).toMatchObject({ status: 'available', feedback: { tier: 'T0' }, lesson: { tier: 'T0', paragraphs: [f.explanation.content] } })
  expect(JSON.stringify(read)).not.toMatch(/PRIVATE-|rubric|criterion|scoringSpec|caseId|HINT_CANARY/)
  const published = await f.source()
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealSourceLinks').withIndex('by_userId_and_target_teachingSourceId', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('target.teachingSourceId', published._id)).take(65))).toHaveLength(published.sourceDependencyCount)
})

test('a valid pass publishes feedback without a lesson and creation after scoring stamps the authoritative attempt', async () => {
  const f = await fixture({ score: true, pass: true })
  expect((await f.source()).attemptId).toBe((await f.t.run(ctx => ctx.db.get(f.opportunity._id)))!.authoritativeAttemptId)
  expect(await f.publish()).toEqual({ status: 'published' })
  expect(await f.read()).toMatchObject({ status: 'available', feedback: { tier: 'T0' }, lesson: null })
})

test('cross-tab preparation and help retry preserve one slot, receipt, exposure and response revision', async () => {
  const f = await fixture({ prepare: false, score: true })
  const preparations = await Promise.all([f.prepare(), f.prepare()])
  expect(preparations[0]).toEqual(preparations[1])
  const before = await f.t.run(ctx => ctx.db.get(f.accepted.submissionId))
  const [first, second] = await Promise.all([f.help(undefined, 'hint'), f.help(undefined, 'hint')])
  expect(first).toEqual(second)
  expect(first).toMatchObject({ status: 'authorized', revision: 1, content: { kind: 'hint', tier: 'T0', text: f.explanation.content } })
  const binding = await f.binding()
  const slot = (await f.t.run(ctx => ctx.db.get(binding.responseSlotId)))!
  expect(slot).toMatchObject({ revision: 1, practiceAssistance: { revision: 1, deliveryCount: 1, hintCount: 1 } })
  expect(await f.t.run(ctx => ctx.db.get(f.accepted.submissionId))).toEqual(before)
  const receipts = await f.t.run(ctx => ctx.db.query('learnPostSealHelpReceipts').take(8))
  expect(receipts).toHaveLength(1)
  const prompt = (await f.t.run(ctx => ctx.db.get(slot.deliveryExposureId)))!
  const help = (await f.t.run(ctx => ctx.db.get(receipts[0]!.authorizationId)))!
  expect(prompt._id).not.toBe(help._id)
  for (const exposure of [prompt, help]) {
    expect(exposure).toMatchObject({ purpose: 'practice', caseId: binding.practiceCaseId, status: 'granted' })
    expect(exposure).not.toHaveProperty('assessmentOpportunityId')
  }
  expect(prompt).not.toHaveProperty('practiceHelp')
  expect(help.practiceHelp).toMatchObject({ practiceBindingId: binding._id, responseSlotId: slot._id, assistanceSequence: 1 })
  expect(await f.help('practice_help_second_123', 'worked_example')).toMatchObject({ status: 'authorized', content: { kind: 'worked_example', text: f.example.content } })
  expect(await f.help(undefined, 'hint')).toEqual(first)
  expect(await f.help(undefined, 'worked_example')).toMatchObject({ status: 'denied', reasonCode: 'disclosure_unknown' })
})

test.each(['submitted_sealed', 'scoring_pending', 'retryable_failure', 'reconciliation_required', 'invalid'] as const)('practice and help survive %s without valid score', async phase => {
  const f = await fixture()
  await f.t.run(ctx => ctx.db.patch(f.opportunity._id, { phase }))
  expect(await f.read()).toMatchObject({ status: 'available', feedback: null, lesson: null, practice: { revision: 1 } })
  expect(await f.help()).toMatchObject({ status: 'authorized' })
})

test('a second open check on the same assignment blocks read, help, preparation and saved help replay', async () => {
  const f = await fixture({ score: true })
  await f.publish()
  expect(await f.help()).toMatchObject({ status: 'authorized' })
  const secondId = await f.t.run(async ctx => {
    const other = (await ctx.db.query('learnAssessmentOpportunities').take(8)).find(row => row._id !== f.opportunity._id)!
    await ctx.db.patch(other._id, { phase: 'ready', openAt: Date.now(), closeAt: Date.now() + 1000 })
    return other._id
  })
  expect(await f.read()).toEqual({ version, status: 'unavailable', reasonCode: 'test_open' })
  expect(await f.help()).toEqual({ version, status: 'denied', reasonCode: 'test_open' })
  expect(await f.help('fresh_key_while_open_123')).toMatchObject({ status: 'denied', reasonCode: 'test_open' })
  expect(await f.prepare()).toMatchObject({ status: 'unavailable', reasonCode: 'test_open' })
  await f.t.run(ctx => ctx.db.patch(secondId, { phase: 'cancelled' }))
  expect(await f.help()).toMatchObject({ status: 'authorized' })
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealHelpReceipts').take(8))).toHaveLength(1)
})

test.each(['hint_first', 'accept_first', 'concurrent'] as const)('practice help serializes with acceptance: %s', async order => {
  const f = await fixture()
  const binding = await f.binding()
  const accept = () => f.owner.mutation(api.learnV2Responses.acceptResponse, { version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'practice_accept_runtime_123',
    response: { target: { responseSlotId: binding.responseSlotId }, expectedRevision: 1, payload: { kind: 'text', text: 'A practice response.' } } })
  let help
  let accepted
  if (order === 'concurrent') [help, accepted] = await Promise.all([f.help(), accept()])
  else if (order === 'hint_first') { help = await f.help(); accepted = await accept() }
  else { accepted = await accept(); help = await f.help() }
  expect(accepted.kind).toBe('accepted')
  if (accepted.kind !== 'accepted') throw new Error('Expected practice acceptance')
  const saved = (await f.t.run(ctx => ctx.db.get(accepted.submissionId)))!
  if (help.status === 'authorized') expect(saved.assistanceSnapshot).toMatchObject({ state: 'assisted', assistanceRevision: 1 })
  else expect(await f.t.run(ctx => ctx.db.query('learnPostSealHelpReceipts').take(2))).toHaveLength(0)
  expect(await f.help()).toMatchObject({ status: 'denied' })
  expect(await f.t.run(ctx => ctx.db.get(binding.responseSlotId))).toMatchObject({ revision: 2 })
  expect((await f.t.run(ctx => ctx.db.get(f.accepted.submissionId)))!.assistanceSnapshot.assistanceRevision).toBe(0)
})

test('revocation before cleanup denies reads, replay and new writes; a competing source purge cannot restore content', async () => {
  const f = await fixture({ score: true })
  await f.publish(); await f.help()
  const results = await Promise.allSettled([f.owner.mutation(api.learnV2Sources.markUnavailable, { sourceSnapshotId: f.graph.sourceSnapshotId,
    expectedRevision: 1, idempotencyKey: 'post_seal_revoke_source', reason: 'source_deleted' }), f.help('racing_help_runtime_123')])
  expect(results[0]!.status).toBe('fulfilled')
  expect(await f.read()).toMatchObject({ status: 'unavailable' })
  expect(await f.help()).toMatchObject({ status: 'denied' })
  expect(await f.publish()).toMatchObject({ status: 'unavailable' })
  await f.t.finishAllScheduledFunctions(() => vi.runAllTimers())
  for (const table of ['learnPostSealTeachingSources', 'learnPostSealPracticeBindings', 'learnPostSealHelpReceipts'] as const) {
    const rows = await f.t.run(ctx => ctx.db.query(table).take(8))
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row).toMatchObject({ evidenceStatus: 'evidence_unavailable', content: { status: 'purged' } })
  }
})

test.each(['absent', 'purged', 'duplicates', 'conflicting', 'malformed'] as const)('optional teaching state never blocks the canonical score commit: %s', async state => {
  const f = await fixture()
  const source = await f.source()
  let foreignAttempt: Doc<'masteryAttempts'>['_id'] | undefined
  await f.t.run(async ctx => {
    if (state === 'absent') await ctx.db.delete(source._id)
    if (state === 'purged') await ctx.db.patch(source._id, { evidenceStatus: 'evidence_unavailable', invalidatedAt: Date.now(),
      content: { status: 'purged', reasonCode: 'evidence_unavailable', purgedAt: Date.now() } })
    if (state === 'duplicates') await ctx.db.insert('learnPostSealTeachingSources', learnPostSealTeachingSourceStorageSchema.parse(postSealApplicationFields(source)))
    if (state === 'conflicting') {
      foreignAttempt = await ctx.db.insert('masteryAttempts', { userId: deliveryIdentity.tokenIdentifier,
        objectiveId: f.graph.objectiveId, attemptedAt: Date.now(), idempotencyKey: 'foreign_attempt_runtime', serverScorePercent: 50 })
      await ctx.db.patch(source._id, { attemptId: foreignAttempt })
    }
    if (state === 'malformed') await ctx.db.patch(source._id, { createdAt: -1 })
  })
  expect(await f.score()).toMatchObject({ status: 'scored' })
  const opportunity = (await f.t.run(ctx => ctx.db.get(f.opportunity._id)))!
  expect(opportunity.authoritativeAttemptId).toBeDefined()
  if (state === 'purged') expect(await f.source()).toMatchObject({ attemptId: opportunity.authoritativeAttemptId, sourceDependencyCount: 0, content: { status: 'purged' } })
  if (state === 'conflicting') expect((await f.source()).attemptId).toBe(foreignAttempt)
  if (state === 'duplicates' || state === 'conflicting' || state === 'malformed') expect(await f.read()).toMatchObject({ status: 'unavailable', reasonCode: 'disclosure_unknown' })
})

test('endpoint aliases keep the read content-free for help and preserve the disabled response exactly', async () => {
  const f = await fixture({ score: true })
  await f.publish()
  expect(await f.owner.query(learnV2CanvasMeasurementApi.getPostSealTeaching, f.reference)).toEqual(await f.read())
  expect(await f.owner.mutation(learnV2CanvasMeasurementApi.authorizePracticeAssistance, await f.request())).toEqual(await f.help())
  expect(learnV2TodayMeasurementApi).not.toHaveProperty('getPostSealTeaching')
  expect(learnV2TodayMeasurementApi).not.toHaveProperty('authorizePracticeAssistance')
  expect(getFunctionName(learnV2CanvasMeasurementApi.openPostSealPractice)).toBe(getFunctionName(api.learnV2PostSealTeaching.openPractice))
  expect(await f.owner.mutation(learnV2CanvasMeasurementApi.openPostSealPractice, f.reference)).toEqual(await f.read())
  expect(learnV2TodayMeasurementApi).not.toHaveProperty('openPostSealPractice')
  expect(await f.read()).not.toHaveProperty('hint')
  expect(await f.read()).not.toHaveProperty('workedExample')
  policy.responses = false
  expect(await f.read()).toEqual({ version, status: 'unavailable', reasonCode: 'disabled' })
  expect(await f.help()).toEqual({ version, status: 'denied', reasonCode: 'disabled' })
  const binding = await f.binding()
  const source = await f.source()
  expect(await f.prepare()).toEqual({ version, status: 'unavailable', reasonCode: 'disabled' })
  expect(await f.publishFeedback()).toEqual({ version, status: 'unavailable', reasonCode: 'disabled' })
  expect(await f.binding()).toEqual(binding)
  expect(await f.source()).toEqual(source)
})

test('feedback and help citation-only source dependencies revoke independently of the practice prompt', async () => {
  const f = await fixture({ score: true, citationSource: true })
  expect(await f.publish()).toEqual({ status: 'published' })
  expect(await f.help()).toMatchObject({ status: 'authorized' })
  const citationId = f.citationSource!.sourceSnapshotId
  const links = await f.t.run(ctx => ctx.db.query('learnPostSealSourceLinks').withIndex('by_userId_and_dependency_sourceSnapshotId_and_invalidatedAt', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('dependency.sourceSnapshotId', citationId).eq('invalidatedAt', undefined)).take(8))
  expect(links.some(link => 'teachingSourceId' in link.target)).toBe(true)
  expect(links.some(link => 'helpReceiptId' in link.target)).toBe(true)
  expect(links.some(link => 'practiceBindingId' in link.target)).toBe(false)
  const binding = await f.binding()
  const accepted = await f.owner.mutation(api.learnV2Responses.acceptResponse, { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: 'citation_practice_answer_123', response: { target: { responseSlotId: binding.responseSlotId }, expectedRevision: 1,
      payload: { kind: 'text', text: 'A practice answer that may quote the delivered help.' } } })
  if (accepted.kind !== 'accepted') throw new Error('Expected practice acceptance')
  const responseLinks = await f.t.run(ctx => ctx.db.query('learnResponseEvidenceLinks').withIndex('by_userId_and_submissionId', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('submissionId', accepted.submissionId)).take(65))
  expect(responseLinks.some(link => link.dependency.kind === 'snapshot' && link.dependency.sourceSnapshotId === citationId)).toBe(true)
  await f.owner.mutation(api.learnV2Sources.markUnavailable, { sourceSnapshotId: citationId, expectedRevision: 1,
    idempotencyKey: 'citation_source_revoke_123', reason: 'access_lost' })
  expect(await f.read()).toMatchObject({ status: 'unavailable' })
  expect(await f.help()).toMatchObject({ status: 'denied' })
  await f.t.finishAllScheduledFunctions(() => vi.runAllTimers())
  expect(await f.binding()).toMatchObject({ evidenceStatus: 'available' })
  expect(await f.source()).toMatchObject({ content: { status: 'purged' } })
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealHelpReceipts').first())).toMatchObject({ content: { status: 'purged' } })
  expect(await f.t.run(ctx => ctx.db.get(accepted.submissionId))).toMatchObject({ bodyAvailability: 'purged' })
})

test('different cross-tab keys serialize separate deliveries against one practice slot', async () => {
  const f = await fixture({ score: true })
  const results = await Promise.all([f.help('tab_one_help_key_12345', 'hint'), f.help('tab_two_help_key_12345', 'worked_example')])
  expect(results.every(result => result.status === 'authorized')).toBe(true)
  const receipts = await f.t.run(ctx => ctx.db.query('learnPostSealHelpReceipts').take(8))
  expect(receipts.map(row => row.assistanceSequence).sort()).toEqual([1, 2])
  expect(new Set(receipts.map(row => row.authorizationId)).size).toBe(2)
  const binding = await f.binding()
  expect(await f.t.run(ctx => ctx.db.get(binding.responseSlotId))).toMatchObject({ revision: 1,
    practiceAssistance: { deliveryCount: 2, revision: 2, hintCount: 1, workedExampleCount: 1 } })
})

test('account deletion drains runtime content, bindings, receipts, source links and practice exposures', async () => {
  const f = await fixture({ score: true })
  await f.publish(); await f.help()
  await f.owner.mutation(internal.accountDeletion.deleteCurrentUser, {})
  for (let page = 0; page < 250; page++) {
    await f.t.mutation(internal.accountDeletion.runDeletionBatch, { userId: deliveryIdentity.tokenIdentifier })
    const tombstone = await f.t.query(internal.accountDeletion.getDeletionTombstone, { userId: deliveryIdentity.tokenIdentifier })
    if (tombstone?.phase === 'waitingExternal' || tombstone?.phase === 'complete') break
    if (page === 249) throw new Error('Deletion did not finish its database phases')
  }
  for (const table of ['learnPostSealTeachingSources', 'learnPostSealPracticeBindings', 'learnPostSealHelpReceipts', 'learnPostSealSourceLinks', 'learnResponseSlots', 'learnAssessmentExposures'] as const) {
    expect(await f.t.run(ctx => ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', deliveryIdentity.tokenIdentifier)).take(1))).toEqual([])
  }
})

test('entitlement revocation schedules bounded redaction and regrant cannot restore the withdrawn copies', async () => {
  const f = await fixture({ score: true })
  await f.publish(); await f.help()
  await f.t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: deliveryIdentity.tokenIdentifier, enabled: false })
  await expect(f.read()).rejects.toThrow(/access denied/)
  await expect(f.help()).rejects.toThrow(/access denied/)
  await f.t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: deliveryIdentity.tokenIdentifier, enabled: true })
  await f.t.finishAllScheduledFunctions(() => vi.runAllTimers())
  for (const table of ['learnPostSealTeachingSources', 'learnPostSealPracticeBindings', 'learnPostSealHelpReceipts'] as const) {
    for (const row of await f.t.run(ctx => ctx.db.query(table).take(8))) expect(row).toMatchObject({ evidenceStatus: 'evidence_unavailable', content: { status: 'purged' } })
  }
  expect(await f.read()).toMatchObject({ status: 'unavailable', reasonCode: 'evidence_unavailable' })
  expect(await f.help()).toMatchObject({ status: 'denied' })
  expect(await f.publish()).toMatchObject({ status: 'unavailable' })
})

test('help versus acceptance of a second relevant check preserves the second sealed assistance snapshot', async () => {
  const f = await fixture()
  const second = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').take(8))).find(row => row.horizonDays === 7)!
  vi.setSystemTime(second.openAt)
  const due = makeFunctionReference<'mutation', { userId: string, through?: number }>('learnV2MeasurementDueWork:materializeDelayedCheckEligibility')
  await f.t.mutation(due, { userId: deliveryIdentity.tokenIdentifier, through: Date.now() })
  const ready = (await f.t.run(ctx => ctx.db.get(second._id)))!
  if (ready.contextPins.kind !== 'session') throw new Error('Expected delayed session')
  const started = await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: ready.contextPins.studySessionId,
    expectedSessionRevision: ready.contextPins.sessionRevision, expectedContentRevision: ready.contextPins.contentRevision, idempotencyKey: 'second_check_grant_12345' })
  if (started.status !== 'assessment') throw new Error('Expected delayed start')
  const grant = started.deliveryGrant
  if (!grant || grant.status !== 'granted') throw new Error('Expected second grant')
  expect(await f.help()).toMatchObject({ status: 'denied', reasonCode: 'test_open' })
  const [help, receipt] = await Promise.all([f.help(), f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: {
    version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'second_check_accept_12345', response: {
      target: { assessmentOpportunityId: ready._id }, expectedRevision: grant.revision, payload: { kind: 'numeric', value: 0, unit: 'members' } } } })])
  if (receipt.kind !== 'accepted') throw new Error(`Expected second acceptance: ${JSON.stringify(receipt)}`)
  const response = (await f.t.run(ctx => ctx.db.get(receipt.submissionId)))!
  expect(response.assistanceSnapshot).toMatchObject({ state: 'unassisted', assistanceRevision: 0 })
  if (help.status === 'authorized') expect(help.deliveredAt).toBeGreaterThanOrEqual(response.acceptedAt)
  expect(await f.help()).toMatchObject({ status: 'authorized' })
  expect((await f.t.run(ctx => ctx.db.get(receipt.submissionId)))!.assistanceSnapshot).toEqual(response.assistanceSnapshot)
})

test.each(['same_case', 'reserved', 'unknown_lineage', 'foreign_slot', 'duplicate_binding', 'changed_prompt'] as const)('practice authority fails closed for %s', async mutation => {
  const f = await fixture()
  const binding = await f.binding()
  await f.t.run(async ctx => {
    if (mutation === 'same_case') await ctx.db.patch(binding._id, { practiceCaseId: binding.checkCaseId })
    if (mutation === 'reserved') await ctx.db.patch(binding.practiceCaseId, { reservedAt: Date.now() })
    if (mutation === 'unknown_lineage') {
      const lineage = (await ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q =>
        q.eq('artifact.kind', 'session_block').eq('artifact.id', f.practiceBlock._id).eq('nextId', undefined)).take(2))[0]!
      await ctx.db.patch(lineage._id, { classification: 'unknown' })
    }
    if (mutation === 'foreign_slot') await ctx.db.patch(binding.responseSlotId, { userId: 'https://elsewhere.example|publisher' })
    if (mutation === 'duplicate_binding') await ctx.db.insert('learnPostSealPracticeBindings', postSealApplicationFields(binding))
    if (mutation === 'changed_prompt') await ctx.db.patch(f.practiceBlock._id, { content: 'A changed prompt with no new publication.' })
  })
  expect(await f.read()).toMatchObject({ status: 'available', practice: null, availability: { practice: { status: 'unavailable' } } })
  const help = f.help()
  if (mutation === 'foreign_slot') await expect(help).rejects.toThrow(/access denied/)
  else expect(await help).toMatchObject({ status: 'denied' })
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealHelpReceipts').take(2))).toHaveLength(0)
})

test('unknown or overflowing relevant-check inventory withholds content and receipt replay', async () => {
  const f = await fixture()
  await f.help()
  await f.t.run(async ctx => {
    const original = (await ctx.db.query('learnAssessmentOpportunities').take(8)).find(row => row._id !== f.opportunity._id)!
    for (let i = 0; i < 9; i++) await ctx.db.insert('learnAssessmentOpportunities', { ...postSealApplicationFields(original), openAt: Date.now(), closeAt: Date.now() + 1000 })
  })
  expect(await f.read()).toMatchObject({ status: 'unavailable', reasonCode: 'disclosure_unknown' })
  expect(await f.help()).toMatchObject({ status: 'denied', reasonCode: 'disclosure_unknown' })
})

test.each(['preparing', 'ready'] as const)('future %s and expired check windows do not exhaust teaching, help or practice acceptance', async phase => {
  const f = await fixture({ score: true })
  const saved = await f.help()
  await f.t.run(async ctx => {
    const future = (await ctx.db.query('learnAssessmentOpportunities').take(8)).find(row => row.horizonDays === 7)!
    for (let index = 0; index < 60; index++) await ctx.db.insert('learnAssessmentOpportunities', { ...postSealApplicationFields(future), phase })
    for (const phase of ['preparing', 'ready', 'test_open'] as const) {
      for (let index = 0; index < 9; index++) await ctx.db.insert('learnAssessmentOpportunities', {
        ...postSealApplicationFields(future), phase, openAt: Date.now() - 2000, closeAt: Date.now() - 1,
      })
    }
  })
  expect(await f.owner.run(ctx => helpAdmission.readTeachingDisclosureChecks(ctx, deliveryIdentity.tokenIdentifier, null,
    async () => ({ references: [{ kind: 'learning_void', id: f.graph.learningVoidId }] })))).toEqual({ status: 'known', checks: [] })
  expect(await f.read()).toMatchObject({ status: 'available', feedback: { tier: 'T0' }, lesson: { tier: 'T0' }, practice: { revision: 1 } })
  expect(await f.prepare()).toMatchObject({ status: 'available', practice: { revision: 1 } })
  expect(await f.help()).toEqual(saved)
  expect(await f.help('future_windows_new_help_12345')).toMatchObject({ status: 'authorized' })
  const binding = await f.binding()
  expect(await f.owner.mutation(api.learnV2Responses.acceptResponse, { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: 'future_windows_practice_answer_12345', response: { target: { responseSlotId: binding.responseSlotId }, expectedRevision: 1,
      payload: { kind: 'text', text: 'A supported separate practice response.' } } })).toMatchObject({ kind: 'accepted' })
})

test('future check inventory still has a separate bounded overflow', async () => {
  const f = await fixture()
  await f.t.run(async ctx => {
    const future = (await ctx.db.query('learnAssessmentOpportunities').take(8)).find(row => row.horizonDays === 7)!
    for (let index = 0; index < 64; index++) await ctx.db.insert('learnAssessmentOpportunities', postSealApplicationFields(future))
  })
  expect(await f.read()).toEqual({ version, status: 'unavailable', reasonCode: 'disclosure_unknown' })
})

test('the read distinguishes unopened practice, pending scoring and publishing without persisting work', async () => {
  const f = await fixture({ prepare: false })
  expect(await f.read()).toEqual({ ...f.reference, status: 'available', feedback: null, lesson: null, practice: null,
    availability: { feedback: 'scoring_pending', practice: { status: 'not_opened' }, help: null } })
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealTeachingSources').take(2))).toEqual([])
  const compare = vi.spyOn(measurementItemAdapters, 'compare')
  const original = compare.getMockImplementation()!
  compare.mockImplementation(async input => 'delivery' in Object(input.content) && (input.content as { delivery: { kind: string } }).delivery.kind === 'feedback'
    ? { decision: 'unknown', coverage: 'unknown' } : original(input))
  expect(await f.score()).toMatchObject({ status: 'scored' })
  const pending = await f.source()
  expect(await f.read()).toEqual({ ...f.reference, status: 'available', feedback: null, lesson: null, practice: null,
    availability: { feedback: 'feedback_publishing', practice: { status: 'not_opened' }, help: null } })
  expect(await f.source()).toEqual(pending)
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealPracticeBindings').take(2))).toEqual([])
})

test('a publish-only retry releases deferred feedback without creating practice or exposures', async () => {
  const f = await fixture({ prepare: false })
  const compare = vi.spyOn(measurementItemAdapters, 'compare')
  const original = compare.getMockImplementation()!
  compare.mockResolvedValue({ decision: 'unknown', coverage: 'unknown' })
  expect(await f.score()).toMatchObject({ status: 'scored' })
  expect(await f.source()).toMatchObject({ content: { status: 'pending' }, sourceDependencyCount: 0 })
  expect(await f.publishFeedback()).toEqual({ ...f.reference, status: 'available', feedback: null, lesson: null, practice: null,
    availability: { feedback: 'feedback_publishing', practice: { status: 'not_opened' }, help: null } })
  const exposures = await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(64))
  compare.mockImplementation(original)
  const [first, second] = await Promise.all([f.publishFeedback(), f.publishFeedback()])
  expect(second).toEqual(first)
  expect(first).toMatchObject({ status: 'available', feedback: { tier: 'T0' }, lesson: { tier: 'T0' }, practice: null,
    availability: { feedback: 'available', practice: { status: 'not_opened' }, help: null } })
  expect(await f.read()).toEqual(first)
  expect(await f.source()).toMatchObject({ content: { status: 'available' } })
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealPracticeBindings').take(2))).toEqual([])
  expect((await f.t.run(ctx => ctx.db.query('learnResponseSlots').take(64))).filter(slot => slot.stage === 'practice')).toEqual([])
  const after = await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(64))
  expect(after).toEqual(exposures)
  expect(after.filter(row => row.purpose === 'practice')).toHaveLength(0)
  expect(getFunctionName(learnV2CanvasMeasurementApi.publishPostSealFeedback)).toBe(getFunctionName(api.learnV2PostSealTeaching.publishFeedback))
  expect(learnV2TodayMeasurementApi).not.toHaveProperty('publishPostSealFeedback')
})

test('public retries publish feedback independently when practice cannot be prepared', async () => {
  const f = await fixture({ prepare: false })
  const compare = vi.spyOn(measurementItemAdapters, 'compare')
  const original = compare.getMockImplementation()!
  compare.mockResolvedValue({ decision: 'unknown', coverage: 'unknown' })
  expect(await f.score()).toMatchObject({ status: 'scored' })
  expect(await f.source()).toMatchObject({ content: { status: 'pending' }, sourceDependencyCount: 0 })
  compare.mockImplementation(async input => (input.content as { delivery?: { kind: string } }).delivery?.kind === 'practice'
    ? { decision: 'reject', coverage: 'complete' } : original(input))
  const [first, second] = await Promise.all([f.prepare(), f.prepare()])
  expect(first).toEqual(second)
  expect(first).toMatchObject({ status: 'available', feedback: { tier: 'T0' }, lesson: { tier: 'T0' }, practice: null,
    availability: { feedback: 'available', practice: { status: 'unavailable', reasonCode: 'disclosure_unknown' } } })
  const source = await f.source()
  expect(await f.prepare()).toEqual(first)
  expect(await f.source()).toEqual(source)
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealTeachingSources').take(2))).toHaveLength(1)
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealPracticeBindings').take(2))).toEqual([])
})

test('publication deferred by an open check completes through public retries after its acceptance', async () => {
  const f = await fixture({ prepare: false })
  const second = (await f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').take(8))).find(row => row.horizonDays === 7)!
  vi.setSystemTime(second.openAt)
  const due = makeFunctionReference<'mutation', { userId: string, through: number }>('learnV2MeasurementDueWork:materializeDelayedCheckEligibility')
  await f.t.mutation(due, { userId: deliveryIdentity.tokenIdentifier, through: Date.now() })
  const ready = (await f.t.run(ctx => ctx.db.get(second._id)))!
  if (ready.contextPins.kind !== 'session') throw new Error('Expected ready session')
  const start = await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: ready.contextPins.studySessionId,
    expectedSessionRevision: ready.contextPins.sessionRevision, expectedContentRevision: ready.contextPins.contentRevision,
    idempotencyKey: 'deferred_publication_check_open_12345' })
  if (start.status !== 'assessment' || start.deliveryGrant?.status !== 'granted') throw new Error('Expected open check')
  expect(await f.score()).toMatchObject({ status: 'scored' })
  expect(await f.source()).toMatchObject({ content: { status: 'pending' }, sourceDependencyCount: 0 })
  expect(await f.prepare()).toEqual({ version, status: 'unavailable', reasonCode: 'test_open' })
  expect(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: {
    version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'deferred_publication_check_accept_12345', response: {
      target: { assessmentOpportunityId: ready._id }, expectedRevision: start.deliveryGrant.revision,
      payload: { kind: 'numeric', value: 0, unit: 'members' } } } })).toMatchObject({ kind: 'accepted' })
  const [first, secondRetry] = await Promise.all([f.prepare(), f.prepare()])
  expect(first).toEqual(secondRetry)
  expect(first).toMatchObject({ status: 'available', feedback: { tier: 'T0' }, lesson: { tier: 'T0' }, practice: { revision: 1 } })
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealTeachingSources').withIndex('by_userId_and_submissionId', q =>
    q.eq('userId', deliveryIdentity.tokenIdentifier).eq('submissionId', f.accepted.submissionId)).take(2))).toHaveLength(1)
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealPracticeBindings').take(2))).toHaveLength(1)
})

test('saved feedback uses its sealed payload and survives later copy-label edits', async () => {
  const f = await fixture({ prepare: false, score: true })
  const source = await f.source()
  const before = await f.read()
  expect(before).toMatchObject({ status: 'available', feedback: { tier: 'T0', text: 'TEACHING-CLAIM-CANARY: the source supports the separate practice case.' } })
  expect(source.content).toMatchObject({ status: 'available', publication: { policyVersion: 'learn-v2.post-seal-feedback-copy.v1' } })
  const copy = vi.spyOn(postSealTeaching.postSealFeedbackCopy, 'citationLabel').mockReturnValue('Updated source label')
  const text = vi.spyOn(postSealTeaching.postSealFeedbackCopy, 'text').mockReturnValue('An updated outcome message.')
  expect(await f.read()).toEqual(before)
  expect(await f.prepare()).toMatchObject({ status: 'available', feedback: before.status === 'available' ? before.feedback : null })
  expect(await f.source()).toEqual(source)
  expect(copy).not.toHaveBeenCalled()
  expect(text).not.toHaveBeenCalled()
})

test('a new feedback copy cannot assign T0 to an unentailed outcome message', async () => {
  const f = await fixture({ prepare: false })
  vi.spyOn(postSealTeaching.postSealFeedbackCopy, 'text').mockReturnValue('Your response met the check requirements.')
  expect(await f.score()).toMatchObject({ status: 'scored' })
  expect(await f.source()).toMatchObject({ content: { status: 'pending' }, sourceDependencyCount: 0 })
  expect(await f.read()).toMatchObject({ status: 'available', feedback: null, lesson: null,
    availability: { feedback: 'feedback_publishing' } })
})

test.each(['pending', 'pass', 'failure', 'invalid'] as const)('hint explanation uses the lesson gate for %s scoring', async state => {
  const f = await fixture({ score: state !== 'pending', pass: state === 'pass' })
  if (state === 'invalid') await f.t.run(ctx => ctx.db.patch(f.opportunity._id, { phase: 'invalid' }))
  const result = await f.help('hint_lesson_gate_12345', 'hint')
  expect(result.status).toBe(state === 'failure' ? 'authorized' : 'denied')
  if (result.status === 'authorized') expect(result.content.text).toBe(f.explanation.content)
  else expect(result).toEqual({ version, status: 'denied', reasonCode: 'unavailable' })
  expect(await f.help('worked_example_lesson_gate_12345', 'worked_example')).toMatchObject({ status: 'authorized' })
})

test('saved hint replay closes when its scored-failure authority is invalidated', async () => {
  const f = await fixture({ score: true })
  const saved = await f.help('hint_lesson_replay_gate_12345', 'hint')
  expect(saved).toMatchObject({ status: 'authorized' })
  await f.t.run(ctx => ctx.db.patch(f.accepted.submissionId, { currentEligibility: 'excluded' }))
  expect(await f.help('hint_lesson_replay_gate_12345', 'hint')).toEqual({ version, status: 'denied', reasonCode: 'unavailable' })
  await f.t.run(ctx => ctx.db.patch(f.accepted.submissionId, { currentEligibility: 'eligible' }))
  expect(await f.help('hint_lesson_replay_gate_12345', 'hint')).toEqual(saved)
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealHelpReceipts').take(2))).toHaveLength(1)
})

test('unexpected and resource failures escape all runtime endpoints without delivered receipts or counters', async () => {
  const f = await fixture({ score: true })
  const spy = vi.spyOn(helpAdmission, 'relevantOpenLearnCheck')
  for (const error of [new Error('Unexpected failure'), new Error('Transaction read limit exhausted')]) {
    spy.mockRejectedValue(error)
    for (const operation of [f.read, f.help, f.prepare, f.publish]) await expect(operation()).rejects.toThrow(error.message)
  }
  expect(await f.t.run(ctx => ctx.db.query('learnPostSealHelpReceipts').take(2))).toHaveLength(0)
  const binding = await f.binding()
  expect(await f.t.run(ctx => ctx.db.get(binding.responseSlotId))).not.toHaveProperty('practiceAssistance')
})

test('authoritative score validity and attempt bindings are rechecked instead of trusting the phase', async () => {
  const f = await fixture({ score: true })
  await f.publish()
  const row = (await f.t.run(ctx => ctx.db.get(f.opportunity._id)))!
  const attempt = (await f.t.run(ctx => ctx.db.get(row.authoritativeAttemptId!)))!
  await f.t.run(ctx => ctx.db.patch(f.accepted.submissionId, { currentEligibility: 'excluded' }))
  expect(await f.read()).toMatchObject({ status: 'available', feedback: null, lesson: null, practice: { revision: 1 } })
  await f.t.run(ctx => ctx.db.patch(f.accepted.submissionId, { currentEligibility: 'eligible' }))
  await f.t.run(ctx => ctx.db.patch(attempt.scoringExecutionId!, { integrityResult: 'unknown' }))
  expect(await f.read()).toMatchObject({ status: 'available', feedback: null, lesson: null })
  const source = await f.source()
  await f.t.run(ctx => ctx.db.patch(source._id, { attemptId: null, content: { status: 'pending' }, sourceDependencyCount: 0 }))
  expect(await f.read()).toMatchObject({ status: 'unavailable', reasonCode: 'disclosure_unknown' })
})

test.each([false, true])('a published source keeps immutable content when an accepted check becomes invalid: pass=%s', async pass => {
  const f = await fixture({ score: true, pass })
  expect(await f.publish()).toEqual({ status: 'published' })
  const source = await f.source()
  await f.t.run(ctx => ctx.db.patch(f.opportunity._id, { phase: 'invalid' }))
  expect(await f.read()).toMatchObject({ status: 'available', feedback: null, lesson: null, practice: { revision: 1 } })
  expect(await f.help()).toMatchObject({ status: 'authorized' })
  expect(await f.source()).toEqual(source)
})

test('owner export omits runtime teaching, help, keys and dependency copies while keeping canonical work', async () => {
  const f = await fixture({ score: true })
  await f.publish(); await f.help()
  const authorization = await f.owner.mutation(api.dataExport.authorizePersonalExport, {})
  expect(authorization.done).toBe(true)
  for (const collection of ['learnPostSealTeachingSources', 'learnPostSealPracticeBindings', 'learnPostSealHelpReceipts', 'learnPostSealSourceLinks'] as const) {
    const page = await f.owner.query(api.dataExport.getUserDataPage, { collection, paginationOpts: { cursor: null, numItems: 8 }, authorizationId: authorization.authorizationId })
    expect(page.page.length).toBeGreaterThan(0)
    expect(JSON.stringify(page.page)).not.toMatch(/TEACHING-CANARY|content|dependency|idempotencyKeyHash|requestDigest|caseValidationDigest|practiceCaseId|sourceSnapshotId/)
  }
})

test('issuer isolation, unauthenticated calls and account deletion guard both endpoint aliases', async () => {
  const f = await fixture()
  const request = await f.request()
  const foreign = f.t.withIdentity({ tokenIdentifier: 'https://foreign.example|publisher', subject: deliveryIdentity.subject })
  for (const actor of [foreign, f.t]) {
    await expect(actor.query(learnV2CanvasMeasurementApi.getPostSealTeaching, f.reference)).rejects.toThrow()
    await expect(actor.mutation(learnV2CanvasMeasurementApi.authorizePracticeAssistance, request)).rejects.toThrow()
    await expect(actor.mutation(learnV2CanvasMeasurementApi.openPostSealPractice, f.reference)).rejects.toThrow()
    await expect(actor.mutation(learnV2CanvasMeasurementApi.publishPostSealFeedback, f.reference)).rejects.toThrow()
  }
  await f.t.run(ctx => ctx.db.insert('accountDeletionJobs', { userId: deliveryIdentity.tokenIdentifier, status: 'active', phase: 'learnV2',
    startedAt: Date.now(), updatedAt: Date.now() }))
  await expect(f.read()).rejects.toThrow(/deletion/)
  await expect(f.help()).rejects.toThrow(/deletion/)
  await expect(f.prepare()).rejects.toThrow(/deletion/)
  await expect(f.publishFeedback()).rejects.toThrow(/deletion/)
})
