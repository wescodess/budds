/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { api } from '../../convex/_generated/api'
import { HELP_OWNER, helpConsumerFixture } from '../../tests/fixtures/learn-v2-help-consumers'
import { isAllowedModel, SERVER_DEFAULT_MODEL } from '../utils/models'

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
vi.stubGlobal('useRuntimeConfig', () => ({ public: { convex: { url: 'https://test.convex.cloud' } } }))
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
const general = (await import('./chat/general.post')).default
const rag = (await import('./rag/chat.post')).default
const search = (await import('./rag/search.post')).default
const audio = (await import('./audio-overview/interject.post')).default
const modules = import.meta.glob('../../convex/**/*.ts')
const event = { context: { convexToken: 'test-token' } } as never
const encoder = new TextEncoder()
let s: Awaited<ReturnType<typeof helpConsumerFixture>>
let emitted: string[]

beforeEach(async () => {
  policy.responses = true
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_001)
  s = await helpConsumerFixture(modules)
  mutation.mockReset().mockImplementation((reference: FunctionReference<'mutation'>, args: never) => s.owner.mutation(reference, args))
  query.mockReset().mockImplementation((reference: FunctionReference<'query'>, args: never) => s.owner.query(reference, args))
  emitted = []
  vi.mocked(globalThis.readBody).mockReset()
  vi.mocked(globalThis.searchDocuments).mockReset().mockResolvedValue({ data: [{ id: 'chunk-1', content: 'SOURCE_CONTENT', score: 0.9,
    attributes: { documentId: s.f.documentId, filename: 'case.pdf' } }] })
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

describe('Nitro handlers use registered server help admission', () => {
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
      title: 'Teaching audio', status: 'ready', turns: [], voiceProfile: { hostA: 'a', hostB: 'b' }, totalDurationMs: 0 }))
    vi.mocked(globalThis.readBody).mockResolvedValue({ overviewId, question: 'Give help', insertedAfterTurnIndex: 0 })
    await expect(audio(event)).rejects.toMatchObject({ statusCode: 403, data: { status: 'denied', reasonCode: 'test_open' } })
    noDispatch()
    expect(mutation).toHaveBeenCalledTimes(1)
    expect(getFunctionName(mutation.mock.calls[0]?.[0])).toBe('learnV2Assistance:admitHelp')
  })
  test.each([false, true])('explicitly unrelated RAG streaming=%s uses only the admitted retrieval scope', async stream => {
    const folderId = await s.owner.mutation(api.folders.createFolder, { name: 'Other course' })
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
})
