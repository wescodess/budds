import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { useOfflineCache, clearOfflineData } from '~/composables/useOfflineCache'
import type { CachedSection } from '~/composables/useOfflineCache'
import { encryptOfflineJson, decryptOfflineJson } from '~~/shared/offline-data-encryption'

vi.mock('#shared/learn-v2-measurement-storage-manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#shared/learn-v2-measurement-storage-manifest')>()
  return { ...actual, LEARN_MEASUREMENT_CAPABILITIES: { ...actual.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})

vi.mock('~~/shared/offline-data-encryption', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~~/shared/offline-data-encryption')>()
  return { ...actual, encryptOfflineJson: vi.fn(actual.encryptOfflineJson), decryptOfflineJson: vi.fn(actual.decryptOfflineJson) }
})

const section: CachedSection = { sectionId: 's1', courseId: 'c1', title: 'Cached lesson', contentBlocks: [{ type: 'text', content: 'Private teaching', order: 0 }], cachedAt: 1 }
const original = await vi.importActual<typeof import('~~/shared/offline-data-encryption')>('~~/shared/offline-data-encryption')

describe('offline cache operations racing teaching revocation', () => {
  beforeEach(async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    await clearOfflineData()
    vi.mocked(encryptOfflineJson).mockReset().mockImplementation(original.encryptOfflineJson)
    vi.mocked(decryptOfflineJson).mockReset().mockImplementation(original.decryptOfflineJson)
  })
  afterEach(async () => {
    await clearOfflineData()
    vi.unstubAllGlobals()
  })

  function cache(cache = useOfflineCache(), data = section, audioUrls: string[] = []) {
    return cache.cacheSectionContent(data.sectionId, data.courseId, data.title, data.contentBlocks, audioUrls)
  }

  it('cannot restore a section whose encryption started before another caller revoked its course', async () => {
    const gate = Promise.withResolvers<undefined>()
    vi.mocked(encryptOfflineJson).mockImplementationOnce(async (value, key) => { await gate.promise; return original.encryptOfflineJson(value, key) })
    const writer = useOfflineCache()
    const write = cache(writer)
    await vi.waitFor(() => expect(encryptOfflineJson).toHaveBeenCalledTimes(1))
    await useOfflineCache().forgetCachedCourse('c1')
    gate.resolve(undefined)
    await write
    expect(await writer.getCachedSection('s1')).toBeNull()
    expect(writer.cacheStatus.value.get('s1')).not.toBe(true)
  })

  it('cannot restore section or audio bytes when a download completes after revocation', async () => {
    const download = Promise.withResolvers<Response>()
    const fetch = vi.fn().mockReturnValue(download.promise)
    vi.stubGlobal('fetch', fetch)
    const writer = useOfflineCache()
    const write = cache(writer, { ...section, contentBlocks: [{ type: 'audio', order: 0, audioUrls: ['https://audio.test/lesson'] }] }, ['https://audio.test/lesson'])
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await useOfflineCache().forgetCachedCourse('c1')
    download.resolve(new Response('private audio'))
    await write
    expect(await writer.getCachedSection('s1')).toBeNull()
    expect(await writer.getAudioFromCache('https://audio.test/lesson')).toBeUndefined()
    expect(writer.cacheStatus.value.get('s1')).not.toBe(true)
  })

  it('rejects an already-read section that finishes decryption after revocation', async () => {
    const reader = useOfflineCache()
    await cache(reader)
    const gate = Promise.withResolvers<undefined>()
    const started = Promise.withResolvers<undefined>()
    vi.mocked(decryptOfflineJson).mockImplementationOnce(async (value, key) => { started.resolve(undefined); await gate.promise; return original.decryptOfflineJson(value, key) })
    const read = reader.getCachedSection('s1')
    await started.promise
    await useOfflineCache().forgetCachedCourse('c1')
    gate.resolve(undefined)
    expect(await read).toBeNull()
    expect(await reader.getCachedSection('s1')).toBeNull()
  })

  it('allows a fresh authorized cache write after deletion and preserves other courses', async () => {
    const writer = useOfflineCache()
    await cache(writer)
    await cache(writer, { ...section, sectionId: 's2', courseId: 'c2' })
    const gate = Promise.withResolvers<undefined>()
    const started = Promise.withResolvers<undefined>()
    vi.mocked(decryptOfflineJson).mockImplementationOnce(async (value, key) => { started.resolve(undefined); await gate.promise; return original.decryptOfflineJson(value, key) })
    const deletion = useOfflineCache().forgetCachedCourse('c1')
    await started.promise
    expect(await writer.getCachedSection('s1')).toBeNull()
    const write = cache(writer, { ...section, title: 'Fresh authorized teaching' })
    gate.resolve(undefined)
    await deletion
    await write
    expect((await writer.getCachedSection('s1'))?.title).toBe('Fresh authorized teaching')
    expect((await writer.getCachedSection('s2'))?.courseId).toBe('c2')
  })

  it('does not recreate cleared offline data from an in-flight write', async () => {
    const gate = Promise.withResolvers<undefined>()
    vi.mocked(encryptOfflineJson).mockImplementationOnce(async (value, key) => { await gate.promise; return original.encryptOfflineJson(value, key) })
    const writer = useOfflineCache()
    const write = cache(writer)
    await vi.waitFor(() => expect(encryptOfflineJson).toHaveBeenCalledTimes(1))
    await clearOfflineData()
    gate.resolve(undefined)
    await write
    expect(await writer.getCachedSection('s1')).toBeNull()
    expect(writer.cacheStatus.value.get('s1')).not.toBe(true)
  })
})
