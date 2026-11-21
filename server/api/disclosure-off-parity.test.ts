/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { HELP_OWNER, helpConsumerFixture } from '../../tests/fixtures/learn-v2-help-consumers'
import { seedTeachingReads } from '../../tests/fixtures/learn-v2-teaching-reads'
import { createHelpAdmissionGuard } from '../utils/learn-v2-help-admission'
import { createTeachingHelpGuard, loadTeachingScope, assertTeachingCommand, assertTeachingSourcePins } from '../utils/teaching-source-scope'

const { mutation, query, fetchMedia } = vi.hoisted(() => ({ mutation: vi.fn(), query: vi.fn(), fetchMedia: vi.fn() }))
vi.mock('convex/browser', () => ({ ConvexHttpClient: class { setAuth() {}; mutation = mutation; query = query } }))
vi.mock('../utils/r2-folder', () => ({ fetchPrivateR2Object: fetchMedia }))
vi.mock('../../shared/learn-v2-measurement-storage-manifest', async importOriginal => {
  const original = await importOriginal<typeof import('../../shared/learn-v2-measurement-storage-manifest')>()
  return { ...original, LEARN_MEASUREMENT_CAPABILITIES: { ...original.LEARN_MEASUREMENT_CAPABILITIES, responses: false } }
})
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('createError', (options: { message: string }) => Object.assign(new Error(options.message), options))
vi.stubGlobal('getRequestHeader', (_event: unknown, name: string) => name === 'idempotency-key' ? 'legacy'.repeat(100) : undefined)
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
  vi.stubEnv('LEARN_V2_ENABLED', 'true'); vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_001)
  s = await helpConsumerFixture(modules)
  r = await s.t.run(async ctx => {
    await ctx.db.patch(s.f.documentId, { contentHash: 'a'.repeat(64), sourceRevision: 'source.r1' })
    return await seedTeachingReads(ctx, HELP_OWNER.tokenIdentifier, s.f.folderId, s.f.documentId, await ctx.storage.store(new Blob(['audio'])))
  })
  query.mockReset().mockImplementation((reference, args) => s.owner.query(reference, args))
  mutation.mockReset().mockImplementation((reference, args) => s.owner.mutation(reference, args))
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
  expect(response.status).toBe(200)
  expect((await response.arrayBuffer()).byteLength).toBe(48044)
  expect(query).toHaveBeenCalledOnce()
  expect(mutation).not.toHaveBeenCalled()
  expect(await s.exposures()).toEqual(before)
})

test('off-state section cache uses the registered dev query and retains deleted-source teaching', async () => {
  await s.t.run(ctx => ctx.db.delete(s.f.documentId))
  vi.mocked(getQuery).mockReturnValue({ sectionId: r.sectionId })
  const before = await s.exposures()
  expect(JSON.stringify(await sectionCache(event))).toContain('TEACHING_READ_CANARY')
  expect(query).toHaveBeenCalledOnce()
  expect(mutation).not.toHaveBeenCalled()
  expect(await s.exposures()).toEqual(before)
})

test('off-state retrieval and generation adapters add no scope query, admission or pin denial', async () => {
  const client = { query, mutation } as never
  const before = await s.exposures()
  await createHelpAdmissionGuard(event, { kind: 'chat', scope: null }, client)(true)
  expect(await loadTeachingScope(client, { folderId: s.f.folderId })).toBeUndefined()
  expect(await createTeachingHelpGuard(event, client, { folderId: s.f.folderId })()).toBeUndefined()
  expect(() => assertTeachingSourcePins(undefined, { documentId: s.f.documentId })).not.toThrow()
  expect(() => assertTeachingCommand({ legacyField: true }, {})).not.toThrow()
  expect(query).not.toHaveBeenCalled()
  expect(mutation).not.toHaveBeenCalled()
  expect(await s.exposures()).toEqual(before)
})
