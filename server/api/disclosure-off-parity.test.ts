/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { HELP_OWNER, helpConsumerFixture } from '../../tests/fixtures/learn-v2-help-consumers'
import { seedTeachingReads } from '../../tests/fixtures/learn-v2-teaching-reads'
import { expectDev } from '../../tests/fixtures/c4-off-parity/expect-dev'
import { isAllowedModel, SERVER_DEFAULT_MODEL } from '../utils/models'
import { buildQuizPrompt, parseQuizResponse } from '../utils/quiz-prompt'
import { buildFlashcardPrompt, parseFlashcardResponse } from '../utils/flashcard-prompt'

const { mutation, query, fetchMedia } = vi.hoisted(() => ({ mutation: vi.fn(), query: vi.fn(), fetchMedia: vi.fn() }))
vi.mock('convex/browser', () => ({ ConvexHttpClient: class { setAuth() {}; mutation = mutation; query = query } }))
vi.mock('../utils/r2-folder', () => ({ fetchPrivateR2Object: fetchMedia }))
vi.mock('../../shared/learn-v2-measurement-storage-manifest', async importOriginal => {
  const original = await importOriginal<typeof import('../../shared/learn-v2-measurement-storage-manifest')>()
  return { ...original, LEARN_MEASUREMENT_CAPABILITIES: { ...original.LEARN_MEASUREMENT_CAPABILITIES, responses: false } }
})
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('createError', (options: { message: string }) => Object.assign(new Error(options.message), options))
vi.stubGlobal('getRequestHeader', vi.fn((_event: unknown, name: string) => name === 'idempotency-key' ? 'legacy'.repeat(100) : undefined))
vi.stubGlobal('useRuntimeConfig', vi.fn(() => ({ public: { convex: { url: 'https://test.convex.cloud' } } })))
vi.stubGlobal('getRouterParam', vi.fn())
vi.stubGlobal('getQuery', vi.fn())
vi.stubGlobal('getConvexTokenIdentifier', () => HELP_OWNER.tokenIdentifier)
vi.stubGlobal('readBody', vi.fn())
vi.stubGlobal('searchDocuments', vi.fn())
vi.stubGlobal('fetchFolderDocs', vi.fn())
vi.stubGlobal('assertSearchIndexAvailable', vi.fn())
vi.stubGlobal('generateCompletion', vi.fn())
vi.stubGlobal('generateCompletionStream', vi.fn())
vi.stubGlobal('setResponseHeader', vi.fn())
vi.stubGlobal('setResponseStatus', vi.fn())
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
const topics = (await import('./quiz/topics.post')).default
const quiz = (await import('./quiz/generate.post')).default
const flashcards = (await import('./flashcards/generate.post')).default
const outline = (await import('./course/generate-outline.post')).default
const section = (await import('./course/generate-section.post')).default
const audioGenerate = (await import('./audio-overview/generate.post')).default
const audioInterject = (await import('./audio-overview/interject.post')).default
const audioStep = (await import('./audio-overview/jobs/step.post')).default
const ownerMedia = (await import('./audio-overview/media/[artifactId].get')).default
const sharedMedia = (await import('./audio-overview/public/[token]/media.get')).default
const interjectionMedia = (await import('./audio-overview/interjections/[interjectionId]/media.get')).default
const sectionCache = (await import('./learn/section-cache-payload.get')).default
const event = { context: { convexToken: `fixture.${Buffer.from(JSON.stringify({ iss: 'https://owner.example', sub: 'help-owner' })).toString('base64url')}.fixture` } } as never
const modules = import.meta.glob('../../convex/**/*.ts')
let s: Awaited<ReturnType<typeof helpConsumerFixture>>, r: Awaited<ReturnType<typeof seedTeachingReads>>
beforeEach(async () => {
  vi.stubEnv('AUDIO_OVERVIEW_JOB_SECRET', 'fixture-job-secret'); vi.stubEnv('AUDIO_OVERVIEW_WORKER_TOKEN', 'fixture-worker-token-00000000000000000'); vi.stubEnv('NUXT_BETTER_AUTH_SECRET', ''); vi.stubEnv('BETTER_AUTH_SECRET', ''); vi.stubEnv('LEARN_V2_ENABLED', 'true'); vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_001)
  vi.mocked(useRuntimeConfig).mockReturnValue({ public: { convex: { url: 'https://test.convex.cloud' } } } as never)
  s = await helpConsumerFixture(modules)
  r = await s.t.run(async ctx => {
    await ctx.db.patch(s.f.documentId, { contentHash: 'a'.repeat(64), sourceRevision: 'source.r1' })
    return await seedTeachingReads(ctx, HELP_OWNER.tokenIdentifier, s.f.folderId, s.f.documentId, await ctx.storage.store(new Blob(['audio'])))
  })
  query.mockReset().mockImplementation((reference, args) => s.owner.query(reference, args))
  mutation.mockReset().mockImplementation((reference, args) => s.owner.mutation(reference, args))
  vi.mocked(getRequestHeader).mockReset().mockImplementation((_event, name) => name === 'idempotency-key' ? 'legacy'.repeat(100) : undefined)
  vi.mocked(readBody).mockReset()
  vi.mocked(searchDocuments).mockReset().mockResolvedValue({ data: [0, 1, 2].map(index => ({ id: `chunk-${index}`, content: 'SOURCE_CONTENT', score: 0.9, attributes: { documentId: s.f.documentId, folderId: s.f.folderId, filename: 'source.txt' } })) })
  vi.mocked(fetchFolderDocs).mockReset().mockResolvedValue([])
  vi.mocked(generateCompletion).mockReset().mockResolvedValue({ model: SERVER_DEFAULT_MODEL, choices: [{ message: { content: JSON.stringify({ title: 'Generated teaching', topics: ['Topic'], cards: [{ order: 0, front: 'Term', back: 'Definition', sourceIndex: 0 }], questions: [{ order: 0, question: 'Question', type: 'multiple-choice', options: ['A', 'B', 'C', 'D'], correctAnswer: 'A', explanation: 'Explanation', sourceIndex: 0 }], sections: [{ title: 'Section', description: 'Description', knowledgeType: 'factual', order: 0 }] }) } }] })
  vi.mocked(sendStream).mockReset().mockImplementation(async (_event, stream) => {
    const reader = (stream as ReadableStream<Uint8Array>).getReader(), chunks: string[] = []
    while (true) { const part = await reader.read(); if (part.done) break; chunks.push(new TextDecoder().decode(part.value)) }
    return chunks.join('')
  })
  fetchMedia.mockReset().mockImplementation(async () => new Response(new Uint8Array(48044), { headers: { 'content-length': '48044' } }))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

test.each([
  ['owner', ownerMedia, () => r.artifactId], ['shared', sharedMedia, () => r.token], ['interjection', interjectionMedia, () => r.interjectionV2Id],
] as const)('off-state %s media uses the registered dev query without delivery mutations', async (_path, handler, parameter) => {
  await s.t.run(ctx => ctx.db.delete(s.f.documentId))
  vi.mocked(getRouterParam).mockReturnValue(parameter())
  const before = await s.exposures()
  const response = await handler(event)
  expectDev(`nitro.media.${_path}`, { status: response.status, headers: Object.fromEntries(response.headers), bytes: (await response.arrayBuffer()).byteLength })
  expect(query).toHaveBeenCalledOnce()
  expect(mutation).not.toHaveBeenCalled()
  expect(await s.exposures()).toEqual(before)
})

test('off-state section cache uses the registered dev query and retains deleted-source teaching', async () => {
  await s.t.run(ctx => ctx.db.delete(s.f.documentId))
  vi.mocked(getQuery).mockReturnValue({ sectionId: r.sectionId })
  const before = await s.exposures()
  expectDev('nitro.sectionCache', await sectionCache(event))
  expect(query).toHaveBeenCalledOnce()
  expect(mutation).not.toHaveBeenCalled()
  expect(await s.exposures()).toEqual(before)
})

async function outcome(run: () => Promise<unknown>) {
  try { return { value: await run() } }
  catch (error) { const e = error as { message: string, statusCode?: number, data?: unknown }; return { error: { message: e.message, statusCode: e.statusCode, data: e.data } } }
}
const handlers = [
  ['flashcards', flashcards, () => ({ folderId: s.f.folderId })],
  ['topics', topics, () => ({ folderId: s.f.folderId })],
  ['quiz', quiz, () => ({ folderId: s.f.folderId })],
  ['outline', outline, () => ({ courseId: r.courseId })],
  ['section', section, () => ({ courseId: r.courseId, sectionId: r.sectionId })],
  ['general', general, () => ({ query: 'Question', model: SERVER_DEFAULT_MODEL })],
  ['rag', rag, () => ({ query: 'Question', model: SERVER_DEFAULT_MODEL, folderId: s.f.folderId })],
  ['search', search, () => ({ query: 'Question', folderId: s.f.folderId })],
] as const

test.each(handlers)('real %s handler retains dev generation and return shape with the capability off', async (name, handler, args) => {
  if (name === 'outline') await s.t.run(ctx => ctx.db.patch(r.courseId, { status: 'generating' }))
  vi.mocked(readBody).mockResolvedValue({ ...args(), legacyClientField: true })
  const result = await outcome(() => handler(event))
  expect(result).toHaveProperty('value')
  expectDev(`nitro.${name}.success`, result)
  expect(generateCompletion).toHaveBeenCalledTimes(name === 'search' ? 0 : name === 'section' ? 3 : 1)
  expect((await s.exposures()).filter(row => row.purpose === 'teaching')).toEqual([])
})

test.each(['outline', 'section'] as const)('real %s handler supports the dev 65-source course', async name => {
  await s.t.run(async ctx => {
    for (let index = 1; index <= 64; index++) await ctx.db.insert('courseSourceDocs', { userId: HELP_OWNER.tokenIdentifier, courseId: r.courseId, folderId: s.f.folderId, documentId: s.f.documentId })
  })
  if (name === 'outline') await s.t.run(ctx => ctx.db.patch(r.courseId, { status: 'generating' }))
  vi.mocked(readBody).mockResolvedValue({ courseId: r.courseId, sectionId: r.sectionId })
  const result = await outcome(() => (name === 'outline' ? outline : section)(event))
  expect(result).toHaveProperty('value')
  expectDev(`nitro.${name}.65sources`, result)
})

test.each(handlers)('real %s handler retains dev missing-field HTTP errors', async (name, handler) => {
  vi.mocked(readBody).mockResolvedValue({})
  expectDev(`nitro.${name}.missing`, await outcome(() => handler(event)))
})

test.each(handlers)('real %s handler retains dev storage configuration requirements', async (name, handler, args) => {
  vi.mocked(readBody).mockResolvedValue(args())
  const noToken = { context: {} } as never
  expectDev(`nitro.${name}.noClient`, await outcome(() => handler(noToken)))
})

test.each([['generate', audioGenerate], ['interject', audioInterject], ['step', audioStep]] as const)('real audio %s handler retains dev request errors', async (name, handler) => {
  vi.mocked(readBody).mockResolvedValue({})
  expectDev(`nitro.audio.${name}.missing`, await outcome(() => handler(event)))
})

test.each(['general', 'rag'] as const)('real %s handler preserves raw dev citation text', async name => {
  vi.mocked(readBody).mockResolvedValue({ query: 'Question', model: SERVER_DEFAULT_MODEL, folderId: s.f.folderId })
  vi.mocked(generateCompletion).mockResolvedValue({ model: SERVER_DEFAULT_MODEL, choices: [{ message: { content: 'Answer [Source 1: retained citation]' } }] })
  expectDev(`nitro.${name}.rawText`, await outcome(() => (name === 'general' ? general : rag)(event)))
})

test.each(['provider', 'stream', 'streamPartial'] as const)('real rag handler preserves dev %s failures', async mode => {
  vi.mocked(readBody).mockResolvedValue({ query: 'Question', model: SERVER_DEFAULT_MODEL, folderId: s.f.folderId, stream: mode !== 'provider' })
  const error = Object.assign(new Error('Fixture provider failure'), { statusCode: 429 })
  vi.mocked(generateCompletion).mockRejectedValue(error)
  vi.mocked(generateCompletionStream).mockImplementation(async () => {
    if (mode === 'stream') throw error
    return new ReadableStream({ pull(controller) { controller.error(error) } })
  })
  expectDev(`nitro.rag.${mode}.error`, await outcome(() => rag(event)))
})

test.each([false, true])('real flashcard publication retains dev task requirement task=%s', async task => {
  const taskId = await s.t.run(async ctx => { const id = (await ctx.db.get(r.jobId))!.taskId; await ctx.db.patch(id, { type: 'flashcards-generation', status: 'running' }); return id })
  vi.mocked(readBody).mockResolvedValue({ folderId: s.f.folderId, roomId: r.roomId, ...(task ? { taskId } : {}) })
  const result = await outcome(() => flashcards(event))
  expect(result).toHaveProperty('value')
  expectDev(`nitro.flashcards.room.task${task}`, result)
})

test.each(['flashcards', 'quiz'] as const)('real %s handler retains dev output above the requested count', async name => {
  const cards = Array.from({ length: 7 }, (_, index) => ({ order: index, front: `Term ${index}`, back: 'Definition', sourceIndex: 0 }))
  const questions = Array.from({ length: 7 }, (_, index) => ({ order: index, question: `Question ${index}`, type: 'multiple-choice', options: ['A', 'B', 'C', 'D'], correctAnswer: 'A', explanation: 'Explanation', sourceIndex: 0 }))
  vi.mocked(generateCompletion).mockResolvedValue({ model: SERVER_DEFAULT_MODEL, choices: [{ message: { content: JSON.stringify({ title: 'Generated teaching', cards, questions }) } }] })
  vi.mocked(readBody).mockResolvedValue({ folderId: s.f.folderId, cardCount: 6, questionCount: 6 })
  const result = await outcome(() => (name === 'flashcards' ? flashcards : quiz)(event))
  expect(result).toHaveProperty('value')
  expectDev(`nitro.${name}.oversize`, result)
})

test('real audio generate handler retains the completed legacy job result', async () => {
  const { deriveAudioOverviewJobCapability, hashAudioOverviewJobCapability } = await import('../utils/audio-overview-job-auth')
  const taskId = await s.t.run(async ctx => (await ctx.db.get(r.jobId))!.taskId)
  const key = `legacy_${taskId}`
  const capability = await deriveAudioOverviewJobCapability('fixture-job-secret', HELP_OWNER.tokenIdentifier, key)
  const capabilityHash = await hashAudioOverviewJobCapability(capability)
  await s.t.run(ctx => ctx.db.patch(r.jobId, { capabilityHash }))
  vi.mocked(readBody).mockResolvedValue({ taskId })
  expectDev('nitro.audio.generate.legacy', await outcome(() => audioGenerate(event)))
  expect(generateCompletion).not.toHaveBeenCalled()
})

test('real audio interject handler retains a ready answer without delivery RPC', async () => {
  const key = 'fixture_interjection_key'
  const { AUDIO_OVERVIEW_PROFILE_CURRENT: profile } = await import('../../shared/audio-overview-profile')
  await s.t.run(async ctx => {
    const row = (await ctx.db.get(r.interjectionV2Id))!
    await ctx.db.patch(row._id, { idempotencyKey: key })
    await ctx.db.patch(row.episodeId, { audioProfileId: profile.id, audioProfileVersion: String(profile.version), renderer: profile.renderer, hostAVoice: profile.hostA.voiceName, hostBVoice: profile.hostB.voiceName })
  })
  vi.mocked(getRequestHeader).mockReturnValue(key)
  vi.mocked(readBody).mockResolvedValue({ overviewId: r.overviewId, insertedAfterTurnIndex: 0, question: 'My own question' })
  const result = await outcome(() => audioInterject(event))
  expect(result).toHaveProperty('value')
  expectDev('nitro.audio.interject.ready', result)
  expect(generateCompletion).not.toHaveBeenCalled()
})

test('real audio step handler retains the existing workflow plan without new admission RPC', async () => {
  const { hashAudioOverviewJobCapability } = await import('../utils/audio-overview-job-auth')
  const capability = 'a'.repeat(43)
  const capabilityHash = await hashAudioOverviewJobCapability(capability)
  await s.t.run(ctx => ctx.db.patch(r.jobId, { capabilityHash }))
  vi.mocked(getRequestHeader).mockReturnValue(capability)
  vi.mocked(readBody).mockResolvedValue({ jobId: r.jobId, stage: 'prepare', legacyWorkerField: true })
  const result = await outcome(() => audioStep(event))
  expect(result).toHaveProperty('value.ok', true)
  expectDev('nitro.audio.step.existing', result)
  expect(generateCompletion).not.toHaveBeenCalled()
})
