/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { api } from '../../convex/_generated/api'
import { HELP_OWNER, helpConsumerFixture } from '../../tests/fixtures/learn-v2-help-consumers'
import { isAllowedModel, SERVER_DEFAULT_MODEL } from '../utils/models'
import type { Id } from '../../convex/_generated/dataModel'
import type { MessageProvenance } from '../../shared/learn-v2-message-provenance'
import { artifactManifestDigest, prepareAndRegisterInstructionalArtifacts } from '../../convex/lib/learnV2ArtifactLineage'
import { searchDocuments as indexedSearch } from '../utils/ai-search'
import { buildQuizPrompt, parseQuizResponse } from '../utils/quiz-prompt'
import { buildFlashcardPrompt, parseFlashcardResponse } from '../utils/flashcard-prompt'
import { authorizeExport } from '../../tests/fixtures/learn-v2-personal-export'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION, LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION } from '../../shared/learn-v2-responses'

const policy = vi.hoisted(() => ({ responses: true }))
vi.mock('../../shared/learn-v2-measurement-storage-manifest', async importOriginal => {
  const original = await importOriginal<typeof import('../../shared/learn-v2-measurement-storage-manifest')>()
  return { ...original, LEARN_MEASUREMENT_CAPABILITIES: { ...original.LEARN_MEASUREMENT_CAPABILITIES,
    get responses() { return policy.responses } } }
})
const mutation = vi.fn()
const query = vi.fn()
vi.mock('convex/browser', () => ({ ConvexHttpClient: class { setAuth() {}; mutation = mutation; query = query } }))
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('createError', (options: { statusCode: number, message: string, data?: unknown }) => Object.assign(new Error(options.message), options))
vi.stubGlobal('getConvexTokenIdentifier', () => HELP_OWNER.tokenIdentifier)
vi.stubGlobal('useRuntimeConfig', vi.fn(() => ({ public: { convex: { url: 'https://test.convex.cloud' } } })))
vi.stubGlobal('getRequestHeader', () => 'route-replay-key')
vi.stubGlobal('readBody', vi.fn())
vi.stubGlobal('searchDocuments', vi.fn())
vi.stubGlobal('fetchFolderDocs', vi.fn())
vi.stubGlobal('generateCompletion', vi.fn())
vi.stubGlobal('generateCompletionStream', vi.fn())
vi.stubGlobal('setResponseHeader', vi.fn())
vi.stubGlobal('sendStream', vi.fn())
vi.stubGlobal('isAllowedModel', isAllowedModel)
vi.stubGlobal('SERVER_DEFAULT_MODEL', SERVER_DEFAULT_MODEL)
vi.stubGlobal('buildQuizPrompt', buildQuizPrompt)
vi.stubGlobal('parseQuizResponse', parseQuizResponse)
vi.stubGlobal('buildFlashcardPrompt', buildFlashcardPrompt)
vi.stubGlobal('parseFlashcardResponse', parseFlashcardResponse)
const general = (await import('./chat/general.post')).default
const rag = (await import('./rag/chat.post')).default
const search = (await import('./rag/search.post')).default
const audio = (await import('./audio-overview/interject.post')).default
const topics = (await import('./quiz/topics.post')).default
const quiz = (await import('./quiz/generate.post')).default
const flashcards = (await import('./flashcards/generate.post')).default
const outline = (await import('./course/generate-outline.post')).default
const section = (await import('./course/generate-section.post')).default
const audioGenerate = (await import('./audio-overview/generate.post')).default
const audioStep = (await import('./audio-overview/jobs/step.post')).default
const modules = import.meta.glob('../../convex/**/*.ts')
const event = { context: { convexToken: `fixture.${Buffer.from(JSON.stringify({ iss: 'https://owner.example', sub: 'help-owner' })).toString('base64url')}.fixture` } } as never
const encoder = new TextEncoder()
let s: Awaited<ReturnType<typeof helpConsumerFixture>>
let emitted: string[]
let courseId: Id<'courses'>
let sectionId: Id<'courseSections'>
let roomId: Id<'flashcardRooms'>

beforeEach(async () => {
  policy.responses = true
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  vi.stubEnv('NUXT_BETTER_AUTH_SECRET', 'message-provenance-fixture-secret')
  vi.mocked(globalThis.useRuntimeConfig).mockReturnValue({ public: { convex: { url: 'https://test.convex.cloud' } } } as never)
  vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_001)
  s = await helpConsumerFixture(modules)
  ;({ courseId } = await s.owner.mutation(api.courses.create, { folderId: s.f.folderId, title: 'Teaching course', sourceType: 'folder' }))
  sectionId = await s.t.run(async ctx => {
    await ctx.db.patch(courseId, { outlineSections: [{ order: 0, title: 'Rule', description: 'Apply the rule', knowledgeType: 'factual' }] })
    await ctx.db.insert('courseSourceDocs', { userId: HELP_OWNER.tokenIdentifier, courseId, documentId: s.f.documentId, folderId: s.f.folderId })
    return await ctx.db.insert('courseSections', { userId: HELP_OWNER.tokenIdentifier, courseId, order: 0, title: 'Rule', knowledgeType: 'factual', status: 'generating', masteryLevel: 'new', contentBlocks: [] })
  })
  ;({ roomId } = await s.owner.mutation(api.flashcardRooms.createRoom, { folderId: s.f.folderId, title: 'Teaching cards' }))
  mutation.mockReset().mockImplementation((reference: FunctionReference<'mutation'>, args: never) => s.owner.mutation(reference, args))
  query.mockReset().mockImplementation((reference: FunctionReference<'query'>, args: never) => s.owner.query(reference, args))
  emitted = []
  vi.mocked(globalThis.readBody).mockReset()
  vi.mocked(globalThis.searchDocuments).mockReset().mockResolvedValue({ data: [{ id: 'chunk-1', content: 'SOURCE_CONTENT', score: 0.9,
    attributes: { documentId: s.f.documentId, folderId: s.f.folderId, contentHash: 'source-hash', sourceRevision: 'source.r1', filename: 'case.pdf' } }] })
  vi.mocked(globalThis.fetchFolderDocs).mockReset().mockResolvedValue([])
  vi.mocked(globalThis.generateCompletion).mockReset().mockResolvedValue({ model: SERVER_DEFAULT_MODEL, choices: [{ message: { content: 'TEACHING_ANSWER' } }] })
  vi.mocked(globalThis.generateCompletionStream).mockReset().mockImplementation(async () => new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode('data: TEACHING_ANSWER\n\n')); controller.close()
  } }))
  vi.mocked(globalThis.sendStream).mockReset().mockImplementation(async (_event, stream) => {
    const reader = (stream as ReadableStream<Uint8Array>).getReader()
    while (true) { const result = await reader.read(); if (result.done) break; emitted.push(new TextDecoder().decode(result.value)) }
    return emitted.join('')
  })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks() })
const body = (extra: Record<string, unknown> = {}) => vi.mocked(globalThis.readBody).mockResolvedValue({
  query: 'Explain the rule', model: SERVER_DEFAULT_MODEL, folderId: s.f.folderId, ...extra,
})

test('capability-off streaming forwards large legacy answers without the new provenance limit or accounting', async () => {
  policy.responses = false
  const output = encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'answer '.repeat(90_000) } }] })}\n\n`)
  vi.mocked(globalThis.generateCompletionStream).mockImplementationOnce(async () => new ReadableStream({ start(controller) {
    controller.enqueue(output)
    controller.close()
  } }))
  const before = await s.exposures()
  body({ stream: true })
  await rag(event)
  expect(emitted).toContain(new TextDecoder().decode(output))
  expect(mutation).not.toHaveBeenCalled()
  expect(query).not.toHaveBeenCalled()
  expect(await s.exposures()).toEqual(before)
})

function noDispatch() {
  expect(globalThis.searchDocuments).not.toHaveBeenCalled()
  expect(globalThis.fetchFolderDocs).not.toHaveBeenCalled()
  expect(globalThis.generateCompletion).not.toHaveBeenCalled()
  expect(globalThis.generateCompletionStream).not.toHaveBeenCalled()
  expect(globalThis.sendStream).not.toHaveBeenCalled()
  expect(query).not.toHaveBeenCalled()
  expect(emitted).toEqual([])
}
async function sealed() { await s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, {
  phase: 'submitted_sealed', submissionId: s.f.rows.learnResponses,
})) }
async function formative() {
  s = await helpConsumerFixture(modules, false)
  await s.t.run(async ctx => {
    const opportunity = (await ctx.db.get(s.f.rows.learnAssessmentOpportunities))!
    if (opportunity.assessmentPins.kind !== 'calibration') throw new Error('Expected calibration fixture')
    await ctx.db.patch(opportunity._id, { deliveryPins: { version: LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION, confidenceRequested: false } })
    await ctx.db.patch(s.f.rows.learnAssessmentExposures, { projectionDigest: opportunity.assessmentPins.promptDigest })
  })
}
async function acceptedAssistance() {
  const target = { assessmentOpportunityId: s.f.rows.learnAssessmentOpportunities }
  const result = await s.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: {
    version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'help_response_acceptance',
    response: { target, expectedRevision: 1, payload: { kind: 'text', text: 'My independently written response' } },
  } })
  expect(result).toMatchObject({ kind: 'accepted' })
  const state = await s.owner.query(api.learnV2Responses.getResponseState, { version: 'learn-v2.public-api.v1', target })
  if (state.status !== 'available' || !state.work) throw new Error('Expected accepted response')
  return state.work.assistanceSnapshot.state
}

const generators = [
  ['quiz/topics', topics, () => ({ folderId: s.f.folderId })],
  ['quiz/generate', quiz, () => ({ folderId: s.f.folderId })],
  ['flashcards/generate', flashcards, () => ({ folderId: s.f.folderId, roomId })],
  ['course/generate-outline', outline, () => ({ courseId })],
  ['course/generate-section', section, () => ({ courseId, sectionId })],
  ['audio-overview/generate', audioGenerate, () => ({ folderId: s.f.folderId })],
] as const

describe('Nitro handlers use registered server help admission', () => {
  test('a formative response without help remains unassisted at acceptance', async () => {
    await formative()
    expect(await acceptedAssistance()).toBe('unassisted')
  })
  test.each([false, true])('retrieval failure streaming=%s before dispatch leaves the accepted response unassisted', async stream => {
    await formative()
    body({ stream })
    vi.mocked(globalThis.searchDocuments).mockRejectedValueOnce(new Error('Fixture retrieval unavailable'))
    await expect(rag(event)).rejects.toThrow('Fixture retrieval unavailable')
    expect(globalThis.generateCompletion).not.toHaveBeenCalled()
    expect(globalThis.generateCompletionStream).not.toHaveBeenCalled()
    expect(globalThis.sendStream).not.toHaveBeenCalled()
    expect(await acceptedAssistance()).toBe('unassisted')
  })
  test.each([false, true].flatMap(stream => [SERVER_DEFAULT_MODEL, 'openai/gpt-4o'].map(model => ({ stream, model }))))('provider failure streaming=$stream model=$model before delivery leaves the accepted response unassisted', async ({ stream, model }) => {
    await formative()
    body({ stream, model })
    vi.mocked(stream ? globalThis.generateCompletionStream : globalThis.generateCompletion).mockRejectedValue(new Error('Fixture provider unavailable'))
    await expect(rag(event)).rejects.toThrow()
    expect(emitted).toEqual([])
    expect(await acceptedAssistance()).toBe('unassisted')
  })
  test.each(['sources', 'answer'] as const)('partial %s delivery followed by stream failure counts as assistance once', async first => {
    await formative()
    if (first === 'answer') vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [] })
    body({ stream: true })
    let index = 0
    vi.mocked(globalThis.generateCompletionStream).mockImplementationOnce(async () => new ReadableStream({
      pull(controller) {
        if (first === 'sources' || index === 2) controller.error(new Error('Fixture stream unavailable'))
        else { index++; controller.enqueue(encoder.encode(`data: {"choices":[{"delta":{"content":"ANSWER_${index}"}}]}\n\n`)) }
      },
    }, { highWaterMark: 0 }))
    const before = (await s.exposures()).length
    await expect(rag(event)).rejects.toMatchObject({ statusCode: 502 })
    expect(emitted.join('')).toContain(first === 'sources' ? 'SOURCE_CONTENT' : 'ANSWER_2')
    expect((await s.exposures()).slice(before).filter(row => row.purpose === 'teaching').map(row => row.status)).toEqual(['granted'])
    expect(await acceptedAssistance()).toBe('assisted')
  })
  test.each(['metadata', 'partial_frame', 'cancelled'] as const)('a stream ending with only %s leaves the accepted response unassisted', async mode => {
    await formative()
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [] })
    body({ stream: true })
    let index = 0
    vi.mocked(globalThis.generateCompletionStream).mockImplementationOnce(async () => new ReadableStream({
      pull(controller) {
        if (index++ === 0) controller.enqueue(encoder.encode(mode === 'partial_frame'
          ? 'data: {"choices":[{"delta":{"content":"WITHHELD_PARTIAL'
          : 'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n'))
        else controller.error(new Error('Fixture stream unavailable'))
      },
    }, { highWaterMark: 0 }))
    if (mode === 'cancelled') vi.mocked(globalThis.sendStream).mockImplementationOnce(async (_event, stream) => {
      await (stream as ReadableStream).cancel()
      throw new Error('Fixture client disconnected')
    })
    await expect(rag(event)).rejects.toThrow()
    expect(emitted.join('')).not.toContain('WITHHELD_PARTIAL')
    expect(await acceptedAssistance()).toBe('unassisted')
  })
  test.each([rag, search])('successful content delivery records assistance once at acceptance', async handler => {
    await formative()
    body()
    const before = (await s.exposures()).length
    await handler(event)
    expect((await s.exposures()).slice(before).filter(row => row.purpose === 'teaching').map(row => row.status)).toEqual(['granted'])
    expect(await acceptedAssistance()).toBe('assisted')
  })
  test.each(['metadata', 'partial_frame'] as const)('a %s prefix followed by answer delivery records assistance once', async mode => {
    await formative()
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [] })
    body({ stream: true })
    const frames = mode === 'metadata'
      ? ['data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"DELIVERED_ANSWER"}}]}\n\n']
      : ['data: {"choices":[{"delta":{"content":"DELIVERED_', 'ANSWER"}}]}\n\n']
    vi.mocked(globalThis.generateCompletionStream).mockImplementationOnce(async () => new ReadableStream({
      pull(controller) { const frame = frames.shift(); if (frame) controller.enqueue(encoder.encode(frame)); else controller.close() },
    }, { highWaterMark: 0 }))
    const before = (await s.exposures()).length
    expect(await rag(event)).toContain('DELIVERED_ANSWER')
    expect((await s.exposures()).slice(before).filter(row => row.purpose === 'teaching').map(row => row.status)).toEqual(['granted'])
    expect(await acceptedAssistance()).toBe('assisted')
  })
  test('a formative opportunity opening midstream receives one delivery fact before the next answer chunk', async () => {
    await formative()
    body({ stream: true })
    let nextOpportunity: Id<'learnAssessmentOpportunities'> | undefined
    let index = 0
    vi.mocked(globalThis.generateCompletionStream).mockImplementationOnce(async () => new ReadableStream({
      async pull(controller) {
        if (index++ === 0) nextOpportunity = await s.t.run(async ctx => {
          const { _id: _id, _creationTime: _time, ...row } = (await ctx.db.get(s.f.rows.learnAssessmentOpportunities))!
          return await ctx.db.insert('learnAssessmentOpportunities', { ...row, delayedCheckId: 'new-formative-opportunity' })
        })
        if (index <= 2) controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"NEW_CHECK_CONTENT"}}]}\n\n'))
        else controller.close()
      },
    }, { highWaterMark: 0 }))
    const before = (await s.exposures()).length
    await rag(event)
    expect(nextOpportunity).toBeDefined()
    expect((await s.exposures()).slice(before).filter(row => row.purpose === 'teaching').map(row => row.assessmentOpportunityId).sort())
      .toEqual([s.f.rows.learnAssessmentOpportunities, nextOpportunity].sort())
  })
  test.each(generators)('%s denies an open check before source reads, retrieval or dispatch', async (_name, handler, command) => {
    vi.mocked(globalThis.readBody).mockResolvedValue(command())
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 403, data: { reasonCode: 'test_open' } })
    noDispatch()
    expect((await s.exposures()).at(-1)?.status).toBe('requested_denied')
  })
  test.each(generators.slice(0, 5))('%s rechecks when a check opens during retrieval', async (_name, handler, command) => {
    await sealed()
    vi.mocked(globalThis.readBody).mockResolvedValue(command())
    vi.mocked(globalThis.searchDocuments).mockImplementationOnce(async () => {
      await s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { phase: 'test_open', submissionId: undefined }))
      return { data: [{ id: 'source', content: 'RETRIEVED_CONTENT', score: 1, attributes: { documentId: s.f.documentId } }] }
    })
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 403, data: { reasonCode: 'test_open' } })
    expect(globalThis.generateCompletion).not.toHaveBeenCalled()
    expect(globalThis.fetchFolderDocs).not.toHaveBeenCalled()
    expect(mutation.mock.calls.some(([ref]) => /createWithQuestions|generateRoomCards|finalizeOutline|finalizeSectionGeneration/.test(getFunctionName(ref)))).toBe(false)
  })
  test.each(generators.slice(0, 5))('%s with the capability off reaches the provider stub without assistance facts', async (_name, handler, command) => {
    policy.responses = false
    vi.mocked(globalThis.readBody).mockResolvedValue(command())
    vi.mocked(globalThis.generateCompletion).mockRejectedValue(new Error('Fixture provider unavailable'))
    const before = await s.exposures()
    await Promise.resolve(handler(event)).catch(() => undefined)
    expect(globalThis.generateCompletion).toHaveBeenCalled()
    expect(await s.exposures()).toEqual(before)
  })
  test.each(['preparing', 'ready'] as const)('teaching denies non-ordinary %s admission', async phase => {
    await s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { phase }))
    vi.mocked(globalThis.readBody).mockResolvedValue({ folderId: s.f.folderId })
    await expect(topics(event)).rejects.toMatchObject({ statusCode: 403, data: { status: 'denied' } })
    noDispatch()
  })
  test('teaching denies formative admission without recording delivered assistance', async () => {
    s = await helpConsumerFixture(modules, false)
    const before = await s.exposures()
    vi.mocked(globalThis.readBody).mockResolvedValue({ folderId: s.f.folderId })
    await expect(topics(event)).rejects.toMatchObject({ statusCode: 403, data: { status: 'denied' } })
    noDispatch()
    expect((await s.exposures()).slice(before.length).map(row => row.status)).toEqual(['requested_denied'])
  })
  test.each(['prepare', 'scene-context', 'claim-render', 'commit-scene', 'publish', 'align'])('Audio workflow %s denies before content or provider work', async stage => {
    const capability = 'a'.repeat(43)
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(capability))
    const capabilityHash = Buffer.from(hash).toString('base64url')
    const jobId = await s.t.run(async ctx => {
      const taskId = await ctx.db.insert('tasks', { userId: HELP_OWNER.tokenIdentifier, folderId: s.f.folderId,
        type: 'audio-overview-generation', status: 'pending', title: 'Audio', createdAt: Date.now(), updatedAt: Date.now(),
        audioOverviewRequest: { scope: { mode: 'folder' }, documents: [{ documentId: s.f.documentId, folderId: s.f.folderId, filename: 'fixture.txt' }],
          preferences: { lengthMinutes: 5, complexity: 'beginner' }, voiceProfile: { hostA: 'asteria', hostB: 'orion' }, quotaDate: '2027-01-01' } })
      return await ctx.db.insert('audioOverviewJobs', { userId: HELP_OWNER.tokenIdentifier, folderId: s.f.folderId, taskId, capabilityHash,
        idempotencyKey: 'audio_job_fixture_123', status: 'accepted', stage: 'accepted', completedTurns: 0, createdAt: Date.now(), updatedAt: Date.now() })
    })
    vi.stubGlobal('getRequestHeader', () => capability)
    mutation.mockImplementation((ref, args) => getFunctionName(ref) === 'audioOverviewJobs:admitTeachingHelp' ? s.t.mutation(ref, args) : s.owner.mutation(ref, args))
    vi.mocked(globalThis.readBody).mockResolvedValue({ jobId, stage })
    expect(await audioStep(event)).toMatchObject({ ok: false, status: 'denied', reasonCode: 'test_open', retryable: false })
    noDispatch()
  })
  test.each([{}, { sessionId: 'forged-session', unrelated: true }])('general help rejects omitted/forged context before any provider or fallback: %j', async extra => {
    body(extra)
    await expect(general(event)).rejects.toMatchObject({ statusCode: 403, data: { status: 'denied', reasonCode: 'disclosure_unknown' } })
    noDispatch()
    expect((await s.exposures()).at(-1)).toMatchObject({ status: 'requested_denied' })
  })
  test.each([false, true])('RAG streaming=%s denies held-out help and receipt replay before retrieval/provider/source events', async stream => {
    body({ stream, sessionId: 'forged-session', unrelated: true })
    for (let replay = 0; replay < 2; replay++) await expect(rag(event)).rejects.toMatchObject({ statusCode: 403, data: { status: 'denied', reasonCode: 'test_open' } })
    noDispatch()
    const facts = (await s.exposures()).filter(row => row.provenanceVersion === 'learn-v2.help-admission.v1')
    expect(facts).toHaveLength(1)
    expect(facts[0]?.status).toBe('requested_denied')
  })
  test.each([false, true])('search scoped=%s denies before retrieval', async scoped => {
    body({ folderId: scoped ? s.f.folderId : undefined })
    await expect(search(event)).rejects.toMatchObject({ statusCode: 403, data: { status: 'denied', reasonCode: scoped ? 'test_open' : 'disclosure_unknown' } })
    noDispatch()
  })
  test('explicit RAG scope is denied before even resolving document metadata', async () => {
    body({ scope: { fileIds: [s.f.documentId] } })
    await expect(rag(event)).rejects.toMatchObject({ statusCode: 403, data: { reasonCode: 'test_open' } })
    noDispatch()
  })
  test('audio interjection denies before overview/source reads, reservation, worker or provider', async () => {
    const overviewId = await s.t.run(ctx => ctx.db.insert('audioOverviews', { userId: HELP_OWNER.tokenIdentifier, folderId: s.f.folderId,
      title: 'Teaching audio', sourceDocumentIds: [s.f.documentId], status: 'ready', turns: [], voiceProfile: { hostA: 'a', hostB: 'b' }, totalDurationMs: 0 }))
    vi.mocked(globalThis.readBody).mockResolvedValue({ overviewId, question: 'Give help', insertedAfterTurnIndex: 0 })
    await expect(audio(event)).rejects.toMatchObject({ statusCode: 403, data: { status: 'denied', reasonCode: 'test_open' } })
    noDispatch()
    expect(mutation).toHaveBeenCalledTimes(1)
    expect(getFunctionName(mutation.mock.calls[0]?.[0])).toBe('learnV2Assistance:admitHelp')
  })
  test.each([false, true])('explicitly unrelated RAG streaming=%s uses only the admitted retrieval scope', async stream => {
    const folderId = await s.owner.mutation(api.folders.createFolder, { name: 'Other course' })
    const documentId = await s.t.run(ctx => ctx.db.insert('documents', { userId: HELP_OWNER.tokenIdentifier, folderId,
      filename: 'other.txt', status: 'success', fileSize: 1 }))
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [{ id: 'other', content: 'OTHER_SOURCE', score: 1,
      attributes: { documentId, folderId, filename: 'other.txt' } }] })
    body({ folderId, stream })
    const before = await s.exposures()
    const response = await rag(event)
    expect(globalThis.searchDocuments).toHaveBeenCalledWith(expect.objectContaining({ folderId }))
    expect(stream ? response : (response as { answer: string }).answer).toContain('TEACHING_ANSWER')
    if (stream) expect(emitted[0]).toContain('event: sources')
    expect(await s.exposures()).toEqual(before)
  })
  test('resolved explicit document scope is passed into search before retrieval', async () => {
    await sealed()
    body({ scope: { fileIds: [s.f.documentId] } })
    await rag(event)
    expect(globalThis.searchDocuments).toHaveBeenCalledWith(expect.objectContaining({ filterDocIds: [s.f.documentId] }))
  })
  test('unbound client history cannot launder current-check content into an unrelated folder', async () => {
    const folderId = await s.owner.mutation(api.folders.createFolder, { name: 'Other course' })
    body({ folderId, history: [{ role: 'assistant', content: 'CHECK_CONTENT' }] })
    await expect(rag(event)).rejects.toMatchObject({ data: { status: 'denied', reasonCode: 'disclosure_unknown' } })
    noDispatch()
  })
  test.each([general, rag, search])('a sealed check permits later help without changing its acceptance facts', async handler => {
    await sealed()
    const before = await s.t.run(ctx => ctx.db.get(s.f.rows.learnResponses))
    body()
    await handler(event)
    expect(await s.t.run(ctx => ctx.db.get(s.f.rows.learnResponses))).toEqual(before)
  })
  test('capability off keeps ordinary general help available', async () => {
    policy.responses = false
    body()
    const before = await s.exposures()
    expect(await general(event)).toMatchObject({ answer: 'TEACHING_ANSWER' })
    expect(await s.exposures()).toEqual(before)
  })
  test.each([false, true])('provider fallback streaming=%s rechecks a newly open check before dispatching again', async stream => {
    await sealed()
    const fail = async () => {
      await s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { phase: 'test_open', submissionId: undefined }))
      throw new Error('UPSTREAM_PAYLOAD')
    }
    vi.mocked(stream ? globalThis.generateCompletionStream : globalThis.generateCompletion).mockImplementationOnce(fail)
    body({ stream, model: 'openai/gpt-4o' })
    await expect(rag(event)).rejects.toMatchObject({ statusCode: 403, data: { reasonCode: 'test_open' } })
    expect(stream ? globalThis.generateCompletionStream : globalThis.generateCompletion).toHaveBeenCalledTimes(1)
    expect(emitted).toEqual([])
  })
  test('stream cancels upstream and emits no source event when a check opens before streaming starts', async () => {
    await sealed()
    const cancel = vi.fn()
    vi.mocked(globalThis.generateCompletionStream).mockImplementationOnce(async () => {
      await s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { phase: 'test_open', submissionId: undefined }))
      return new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('MUST_NOT_ESCAPE')); controller.close() }, cancel })
    })
    body({ stream: true })
    await expect(rag(event)).rejects.toMatchObject({ statusCode: 403, data: { reasonCode: 'test_open' } })
    expect(cancel).toHaveBeenCalledOnce()
    expect(emitted).toEqual([])
  })
  test('nonstream output is withheld if a check opens during provider generation', async () => {
    await sealed()
    vi.mocked(globalThis.generateCompletion).mockImplementationOnce(async () => {
      await s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { phase: 'test_open', submissionId: undefined }))
      return { choices: [{ message: { content: 'MUST_NOT_ESCAPE' } }], model: SERVER_DEFAULT_MODEL }
    })
    body()
    await expect(rag(event)).rejects.toMatchObject({ statusCode: 403, data: { reasonCode: 'test_open' } })
  })
  test('a source moved into the check folder cannot retain unrelated RAG admission', async () => {
    const folderId = await s.owner.mutation(api.folders.createFolder, { name: 'Other source folder' })
    const documentId = await s.t.run(ctx => ctx.db.insert('documents', { userId: HELP_OWNER.tokenIdentifier, folderId,
      filename: 'other.txt', status: 'success', fileSize: 1 }))
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [{ id: 'other', content: 'OTHER_SOURCE', score: 1,
      attributes: { documentId, folderId, filename: 'other.txt' } }] })
    vi.mocked(globalThis.generateCompletion).mockImplementationOnce(async () => {
      await s.t.run(ctx => ctx.db.patch(documentId, { folderId: s.f.folderId }))
      return { choices: [{ message: { content: 'WITHHELD_AFTER_MOVE' } }], model: SERVER_DEFAULT_MODEL }
    })
    body({ folderId })
    await expect(rag(event)).rejects.toThrow('Teaching input is unavailable')
    expect(globalThis.generateCompletion).toHaveBeenCalledOnce()
    expect(emitted).toEqual([])
  })
  test.each([false, true])('a check opening midstream blocks the next chunk and cancels upstream; prior assistance=%s', async priorAssistance => {
    s = await helpConsumerFixture(modules, !priorAssistance)
    if (!priorAssistance) await sealed()
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [{ id: 'chunk', content: 'SOURCE_CONTENT', score: 1,
      attributes: { documentId: s.f.documentId, folderId: s.f.folderId, sourceRevision: 'source.r1', contentHash: 'source-hash' } }] })
    body({ stream: true })
    const cancel = vi.fn()
    let index = 0
    vi.mocked(globalThis.generateCompletionStream).mockImplementationOnce(async () => new ReadableStream({
      async pull(controller) {
        if (index++ === 0) controller.enqueue(encoder.encode('data: FIRST_DELIVERED\n\n'))
        else if (index === 2) {
          await s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, priorAssistance ? { purpose: {
            kind: 'measurement_cold', assignmentId: s.f.rows.learnMeasurementAssignments, protocolVersion: 'protocol.fixture' }, revision: 2 }
            : { phase: 'test_open', submissionId: undefined }))
          controller.enqueue(encoder.encode('data: SECOND_WITHHELD\n\n'))
        }
        else controller.close()
      }, cancel,
    }, { highWaterMark: 0 }))
    const before = (await s.exposures()).length
    await expect(rag(event)).rejects.toMatchObject({ statusCode: 403, data: { status: 'denied', reasonCode: 'test_open' } })
    expect(emitted.join('')).toContain('FIRST_DELIVERED')
    expect(emitted.join('')).not.toContain('SECOND_WITHHELD')
    expect(cancel).toHaveBeenCalledOnce()
    expect((await s.exposures()).slice(before).map(row => row.status)).toEqual(priorAssistance ? ['granted', 'requested_denied'] : ['requested_denied'])
  })
  test.each([false, true])('history-bearing RAG receipts remain unknown through persisted replay and export, streaming=%s', async stream => {
    await sealed()
    body({ stream, history: [{ role: 'assistant', content: 'PRIOR_SOURCE_QUOTE' }] })
    vi.mocked(globalThis.generateCompletionStream).mockImplementationOnce(async () => new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"TEACHING_ANSWER"}}]}\n\n'))
      controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close()
    } }))
    const response = await rag(event)
    const provenance = stream
      ? JSON.parse(emitted.find(value => value.startsWith('event: provenance'))!.split('data: ')[1]!) as MessageProvenance
      : (response as { provenance: MessageProvenance }).provenance
    expect(provenance).toMatchObject({ scope: 'unknown', references: null })
    const conversationId = await s.owner.mutation(api.conversations.createConversation, { folderId: s.f.folderId, title: 'History' })
    await s.owner.mutation(api.messages.appendMessage, { conversationId, role: 'user', content: 'My retained question' })
    const id = await s.owner.mutation(api.messages.appendMessage, { conversationId, role: 'assistant', content: 'TEACHING_ANSWER', provenance,
      sources: [{ content: 'SOURCE_CONTENT', score: 0.9, filename: 'case.pdf' }] })
    expect(await s.t.run(ctx => ctx.db.get(id))).toMatchObject({ content: '', sources: [], helpScope: { scope: 'unknown', references: null } })
    await s.t.run(ctx => ctx.db.delete(s.f.documentId))
    for (const responses of [true]) {
      policy.responses = responses
      const replay = await s.owner.mutation(api.messages.replayByConversation, { conversationId, idempotencyKey: 'unknown_history_replay' })
      expect(replay).toMatchObject({ admission: { status: 'denied', reasonCode: 'unavailable' } })
      expect(replay.messages.map(row => row.content)).toEqual(['My retained question', ''])
      const exported = await s.owner.query(api.dataExport.getUserDataPage, { collection: 'messages', paginationOpts: { numItems: 8, cursor: null }, authorizationId: await authorizeExport(s.owner) })
      expect(JSON.stringify(exported)).not.toMatch(/TEACHING_ANSWER|SOURCE_CONTENT|PRIOR_SOURCE_QUOTE/)
      expect(JSON.stringify(exported)).toContain('My retained question')
      expect(JSON.stringify(exported)).toContain('evidence_unavailable')
    }
  })
  test.each([false, true])('new RAG answers retain signed cross-folder provenance, streaming=%s', async stream => {
    await sealed()
    vi.mocked(globalThis.useRuntimeConfig).mockReturnValue({ public: { convex: { url: 'https://test.convex.cloud' } },
      betterAuthSecret: 'message-provenance-fixture-secret' } as never)
    vi.stubEnv('NUXT_BETTER_AUTH_SECRET', '')
    body({ stream })
    vi.mocked(globalThis.generateCompletionStream).mockImplementationOnce(async () => new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"TEACHING_ANSWER"}}]}\n\n'))
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    } }))
    const response = await rag(event)
    vi.stubEnv('NUXT_BETTER_AUTH_SECRET', 'message-provenance-fixture-secret')
    const provenance = stream
      ? JSON.parse(emitted.find(value => value.startsWith('event: provenance'))!.split('data: ')[1]!) as MessageProvenance
      : (response as { provenance: MessageProvenance }).provenance
    const folderId = await s.owner.mutation(api.folders.createFolder, { name: 'Different conversation folder' })
    const conversationId = await s.owner.mutation(api.conversations.createConversation, { folderId, title: 'Other conversation' })
    const messageId = await s.owner.mutation(api.messages.appendMessage, { conversationId, role: 'assistant', content: 'TEACHING_ANSWER', provenance,
      sources: [{ content: 'SOURCE_CONTENT', score: 0.9, filename: 'case.pdf' }] })
    expect((await s.t.run(ctx => ctx.db.get(messageId)))?.helpScope?.references).toContainEqual({ kind: 'document', id: s.f.documentId })
    await s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { phase: 'test_open', submissionId: undefined }))
    const replay = await s.owner.mutation(api.messages.replayByConversation, { conversationId, idempotencyKey: 'stored_rag_answer_123' })
    expect(replay.admission).toMatchObject({ status: 'denied', reasonCode: 'test_open' })
    expect(replay.messages[0]?.content).toBe('')
  })
  test.each(([
    ['search', search, 'private_scoring'], ['chat', rag, 'private_scoring'],
    ['search', search, 'measurement'], ['chat', rag, 'measurement'],
    ['search', search, 'unknown'], ['chat', rag, 'unknown'],
    ['search', search, 'stale_pins'], ['chat', rag, 'stale_pins'],
    ['search', search, 'during_search'], ['chat', rag, 'during_search'],
  ] as const).map(([name, handler, restriction]) => ({ name, handler, restriction })))('$name revalidates indexed content after $restriction restriction', async ({ handler, restriction }) => {
    await sealed()
    const contentHash = 'a'.repeat(64)
    const sourceRevision = `sha256:${contentHash}`
    await s.t.run(async ctx => {
      await ctx.db.patch(s.f.documentId, { contentHash, sourceRevision })
      await ctx.db.patch(s.f.rows.learnAssessmentCatalogs, { measurementCapability: { enabled: true } })
    })
    await s.owner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [
      { artifact: { kind: 'document', id: s.f.documentId }, key: 'whole', sources: [], origins: [] },
    ] }))
    async function restrict() {
      await s.t.run(async ctx => {
        const rows = await ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q
          .eq('artifact.kind', 'document').eq('artifact.id', s.f.documentId).eq('nextId', undefined)).take(16)
        expect(rows).toHaveLength(1)
        for (const row of rows) {
          await ctx.db.patch(row._id, { classification: restriction === 'measurement' || restriction === 'unknown' ? restriction : 'private_scoring',
            authority: 'server_producer', publication: undefined })
          const current = (await ctx.db.get(row._id))!
          const manifestDigest = await artifactManifestDigest(ctx, current, [], [], [])
          await ctx.db.patch(row._id, { manifestDigest })
          await ctx.db.patch(row.validationId!, { manifestDigest })
        }
      })
    }
    vi.mocked(globalThis.useRuntimeConfig).mockReturnValue({ public: { convex: { url: 'https://test.convex.cloud' } },
      cloudflareAccountId: 'fixture', cloudflareAiSearchInstance: 'fixture', cloudflareAiSearchToken: 'fixture' } as never)
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ success: true, result: { data: [{
      filename: 'fixture.txt', content: [{ id: 'indexed-before-restriction', text: 'INDEXED_CONTENT_CANARY', score: 1 }],
      attributes: { file: { userid: HELP_OWNER.tokenIdentifier, folderid: s.f.folderId, documentid: s.f.documentId, filename: 'fixture.txt', contenthash: contentHash, sourcerevision: sourceRevision } },
    }] } })))
    vi.mocked(globalThis.searchDocuments).mockImplementation(indexedSearch)
    body()
    expect(JSON.stringify(await handler(event))).toContain('INDEXED_CONTENT_CANARY')
    expect(fetch).toHaveBeenCalledOnce()
    fetch.mockClear()
    vi.mocked(globalThis.generateCompletion).mockClear()
    if (restriction === 'stale_pins') await s.t.run(ctx => ctx.db.patch(s.f.documentId, { sourceRevision: 'source.changed' }))
    else if (restriction === 'during_search') {
      const response = fetch.getMockImplementation()!
      fetch.mockImplementationOnce(async (...args) => { const result = await response(...args); await restrict(); return result })
    } else await restrict()
    await expect(handler(event)).rejects.toThrow(/Teaching input is unavailable/)
    expect(globalThis.generateCompletion).not.toHaveBeenCalled()
    if (restriction !== 'stale_pins' && restriction !== 'during_search') expect(fetch).not.toHaveBeenCalled()
  })
  test('owner-wide retrieval fails closed beyond its document budget', async () => {
    await sealed()
    await s.t.run(async ctx => {
      for (let index = 0; index < 64; index++) await ctx.db.insert('documents', { userId: HELP_OWNER.tokenIdentifier,
        folderId: s.f.folderId, filename: `document-${index}`, fileSize: 1, status: 'success' })
    })
    body({ folderId: undefined })
    await expect(search(event)).rejects.toThrow('Teaching input is unavailable')
    expect(globalThis.searchDocuments).not.toHaveBeenCalled()
  })
  test.each(['documents', 'folders'] as const)('explicit RAG scope bounds expanded %s before retrieval', async kind => {
    await sealed()
    await s.t.run(async ctx => {
      for (let index = 0; index < 64; index++) {
        if (kind === 'folders') await ctx.db.insert('folders', { userId: HELP_OWNER.tokenIdentifier, parentId: s.f.folderId,
          name: `child-${index}`, documentCount: 0 })
        else await ctx.db.insert('documents', { userId: HELP_OWNER.tokenIdentifier, folderId: s.f.folderId,
          filename: `document-${index}`, fileSize: 1, status: 'success' })
      }
    })
    body({ scope: { folderIds: [s.f.folderId] } })
    await expect(rag(event)).rejects.toThrow('Teaching input is unavailable')
    expect(globalThis.searchDocuments).not.toHaveBeenCalled()
    expect(globalThis.fetchFolderDocs).not.toHaveBeenCalled()
    expect(globalThis.generateCompletion).not.toHaveBeenCalled()
  })
})
