/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { HELP_OWNER, helpConsumerFixture } from '../../tests/fixtures/learn-v2-help-consumers'
import { seedTeachingReads } from '../../tests/fixtures/learn-v2-teaching-reads'

const { mutation, query, fetchMedia } = vi.hoisted(() => ({mutation:vi.fn(), query:vi.fn(), fetchMedia:vi.fn()}))
vi.mock('convex/browser', () => ({ ConvexHttpClient: class { setAuth() {}; mutation = mutation; query = query } }))
vi.mock('../utils/r2-folder', () => ({ fetchPrivateR2Object: fetchMedia }))
vi.mock('../../shared/learn-v2-measurement-storage-manifest', async importOriginal => {
  const original = await importOriginal<typeof import('../../shared/learn-v2-measurement-storage-manifest')>()
  return { ...original, LEARN_MEASUREMENT_CAPABILITIES: { ...original.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('createError', (options: { message: string }) => Object.assign(new Error(options.message), options))
vi.stubGlobal('getRequestHeader', () => undefined)
vi.stubGlobal('useRuntimeConfig', () => ({ public: { convex: { url: 'https://test.convex.cloud' } } }))
vi.stubGlobal('getRouterParam', vi.fn())
vi.stubGlobal('getQuery', vi.fn())
const ownerMedia = (await import('./audio-overview/media/[artifactId].get')).default
const sharedMedia = (await import('./audio-overview/public/[token]/media.get')).default
const interjectionMedia = (await import('./audio-overview/interjections/[interjectionId]/media.get')).default
const sectionCache = (await import('./learn/section-cache-payload.get')).default
const event = { context: { convexToken: 'fixture-token' } } as never
const modules = import.meta.glob('../../convex/**/*.ts')
let s: Awaited<ReturnType<typeof helpConsumerFixture>>, r: Awaited<ReturnType<typeof seedTeachingReads>>
beforeEach(async () => {
  vi.stubEnv('AUDIO_OVERVIEW_WORKER_TOKEN','fixture-worker-token-000000000000000000000'); vi.stubEnv('LEARN_V2_ENABLED', 'true'); vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_001)
  s = await helpConsumerFixture(modules, false)
  await s.t.run(async ctx=>{ await ctx.db.patch(s.f.documentId,{r2Key:'fixture/source',contentHash:'a'.repeat(64),sourceRevision:`sha256:${'a'.repeat(64)}`}); await ctx.db.patch(s.f.sourceSnapshotId,{objectKey:'fixture/source',contentHash:'a'.repeat(64),sourceRevision:`sha256:${'a'.repeat(64)}`}) })
  r = await s.t.run(async ctx => seedTeachingReads(ctx, HELP_OWNER.tokenIdentifier, s.f.folderId, s.f.documentId, await ctx.storage.store(new Blob(['fixture']))))
  mutation.mockReset().mockImplementation((reference, args) => s.owner.mutation(reference, args))
  query.mockReset().mockImplementation((reference, args) => s.owner.query(reference, args))
  fetchMedia.mockReset()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
const paths = [
  ['owner audio', ownerMedia, () => r.artifactId], ['shared audio', sharedMedia, () => r.token],
  ['interjection audio', interjectionMedia, () => r.interjectionV2Id],
] as const
const granted = async () => (await s.exposures()).filter(row => row.purpose === 'teaching' && row.status === 'granted')
async function openCheck() { await s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { purpose: { kind: 'measurement_cold', assignmentId: s.f.rows.learnMeasurementAssignments, protocolVersion: 'protocol.fixture' }, revision: 2 })) }

test.each(paths)('%s denies before fetching bytes during a held-out check', async (_path, handler, id) => {
  vi.mocked(globalThis.getRouterParam).mockReturnValue(id())
  await openCheck()
  await expect(handler(event)).rejects.toMatchObject({ data: { admission: { status: 'denied', reasonCode: 'test_open' } } })
  expect(fetchMedia).not.toHaveBeenCalled()
  expect(await granted()).toHaveLength(0)
})

test.each(paths)('%s fetch failure is not delivered assistance', async (_path, handler, id) => {
  vi.mocked(globalThis.getRouterParam).mockReturnValue(id())
  fetchMedia.mockRejectedValueOnce(new Error('Fixture storage unavailable'))
  await expect(handler(event)).rejects.toThrow('Fixture storage unavailable')
  expect(await granted()).toHaveLength(0)
})

test.each(paths)('%s accounts the first chunk once and stops after a check opens', async (_path, handler, id) => {
  vi.mocked(globalThis.getRouterParam).mockReturnValue(id())
  fetchMedia.mockResolvedValue(new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array([1,2,3,4])) } }, { highWaterMark: 0 })))
  const response = await handler(event) as Response
  expect(await granted()).toHaveLength(0)
  const reader = response.body!.getReader()
  expect((await reader.read()).value).toEqual(new Uint8Array([1,2,3,4]))
  expect(await granted()).toHaveLength(1)
  await openCheck()
  await expect(reader.read()).rejects.toThrow('Teaching content is unavailable.')
  expect(await granted()).toHaveLength(1)
})

test.each(paths)('%s partial storage failure retains one delivered exposure', async (_path, handler, id) => {
  vi.mocked(globalThis.getRouterParam).mockReturnValue(id())
  let chunks = 0
  fetchMedia.mockResolvedValue(new Response(new ReadableStream({ pull(controller) {
    if (++chunks <= 2) controller.enqueue(new Uint8Array([1,2,3,4]))
    else controller.error(new Error('Fixture partial failure'))
  } }, { highWaterMark: 0 })))
  const reader = (await handler(event) as Response).body!.getReader()
  await reader.read(); await reader.read()
  await expect(reader.read()).rejects.toThrow('Fixture partial failure')
  expect(await granted()).toHaveLength(1)
})

test('section cache JSON is returned only by its accounted delivery mutation', async () => {
  vi.mocked(globalThis.getQuery).mockReturnValue({ sectionId: r.sectionId })
  expect(await sectionCache(event)).toHaveProperty('contentBlocks')
  expect(await granted()).toHaveLength(1)
  await openCheck()
  await expect(sectionCache(event)).rejects.toMatchObject({ data: { admission: { reasonCode: 'test_open' } } })
})
