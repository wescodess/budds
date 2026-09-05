import { vi, describe, test, expect, beforeEach } from 'vitest'

vi.stubGlobal('useRuntimeConfig', vi.fn())
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) =>
  Object.assign(new Error(opts.message), { statusCode: opts.statusCode }),
)
vi.stubGlobal('fetch', vi.fn())

const { assertSearchIndexAvailable, searchDocuments, sanitizeUserSegment } = await import('./ai-search')

const validConfig = {
  cloudflareAccountId: 'test-account',
  cloudflareAiSearchInstance: 'test-instance',
  cloudflareAiSearchToken: 'test-token',
}

function mockLegacyResponse(data: unknown[]) {
  return {
    ok: true,
    json: () => Promise.resolve({ success: true, result: { search_query: 'q', data } }),
  } as any
}

function mockStatsResponse(vectorsCount: number) {
  return new Response(JSON.stringify({
    success: true,
    result: { engine: { vectorize: { vectorsCount, dimensions: 1024 } } },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeLegacyResult(overrides: Record<string, unknown> = {}) {
  return {
    file_id: 'chunk-1',
    filename: 'cautious-elephant-39.convex.site_user123/folderABC/docXYZ.txt',
    score: 0.87,
    content: [{ id: 'chunk-1', type: 'text', text: 'Extracted passage.', score: 0.87 }],
    attributes: {
      timestamp: 1,
      folder: 'cautious-elephant-39.convex.site_user123/folderABC/',
      filename: '',
      file: {
        userid: 'https://cautious-elephant-39.convex.site|user123',
        folderid: 'folderABC',
        documentid: 'docXYZ',
        filename: 'docXYZ.txt',
        contenthash: 'a'.repeat(64),
        sourcerevision: `sha256:${'a'.repeat(64)}`,
      },
    },
    ...overrides,
  }
}

describe('sanitizeUserSegment', () => {
  test('strips protocol and replaces | and :', () => {
    expect(sanitizeUserSegment('https://foo.example.com|abc123')).toBe('foo.example.com_abc123')
    expect(sanitizeUserSegment('user_plain')).toBe('user_plain')
  })
})

describe('searchDocuments', () => {
  beforeEach(() => {
    vi.mocked(globalThis.fetch).mockReset()
    vi.mocked((globalThis as any).useRuntimeConfig).mockReturnValue(validConfig)
    delete process.env.NUXT_CLOUDFLARE_ACCOUNT_ID
    delete process.env.CF_ACCOUNT_ID
    delete process.env.NUXT_CLOUDFLARE_AI_SEARCH_INSTANCE
    delete process.env.CLOUDFLARE_AI_SEARCH_INSTANCE
    delete process.env.NUXT_CLOUDFLARE_AI_SEARCH_TOKEN
    delete process.env.CLOUDFLARE_AI_SEARCH_TOKEN
  })

  test('returns mapped chunks from legacy response shape', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockLegacyResponse([makeLegacyResult()]))

    const result = await searchDocuments({ query: 'test', userId: 'https://cautious-elephant-39.convex.site|user123', folderId: 'folderABC' })

    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({
      id: 'chunk-1',
      content: 'Extracted passage.',
      score: 0.87,
      attributes: {
        filename: 'docXYZ.txt',
        folderId: 'folderABC',
        documentId: 'docXYZ',
        contentHash: 'a'.repeat(64),
        sourceRevision: `sha256:${'a'.repeat(64)}`,
      },
    })
  })

  test('uses legacy /autorag/rags/ endpoint', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockLegacyResponse([]))

    await searchDocuments({ query: 'test', userId: 'user_123' })

    const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string
    expect(url).toContain('/autorag/rags/test-instance/search')
  })

  test('sends query as top-level field (not messages)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockLegacyResponse([]))

    await searchDocuments({ query: 'how does auth work', userId: 'user_123' })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.query).toBe('how does auth work')
    expect(body.messages).toBeUndefined()
  })

  test('sends folderid filter when folderId provided', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockLegacyResponse([]))

    await searchDocuments({ query: 'test', userId: 'user_123', folderId: 'folder_abc' })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.filters).toEqual({
      type: 'and',
      filters: [
        { type: 'eq', key: 'userid', value: 'user_123' },
        { type: 'eq', key: 'folderid', value: 'folder_abc' },
      ],
    })
  })

  test('always sends the authenticated tenant filter', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockLegacyResponse([]))

    await searchDocuments({ query: 'test', userId: 'user_123' })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.filters).toEqual({ type: 'eq', key: 'userid', value: 'user_123' })
  })

  test('[P0] bounds long tenant filters to Cloudflare\'s 64-byte prefix and still post-filters the full identity', async () => {
    const longUserId = `https://cautious-elephant-39.convex.site|${'u'.repeat(40)}`
    const filterablePrefix = new TextDecoder().decode(new TextEncoder().encode(longUserId).slice(0, 64))
    const collidingUserId = `${filterablePrefix}different-tenant`
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockLegacyResponse([
      makeLegacyResult({
        attributes: {
          file: {
            userid: longUserId,
            folderid: 'folderABC',
            documentid: 'docXYZ',
            filename: 'private.txt',
          },
        },
      }),
      makeLegacyResult({
        content: [{ id: 'other-tenant-chunk', type: 'text', text: 'Must not leak.', score: 0.99 }],
        attributes: {
          file: {
            userid: collidingUserId,
            folderid: 'folderABC',
            documentid: 'docOTHER',
            filename: 'other-private.txt',
          },
        },
      }),
    ]))

    const result = await searchDocuments({ query: 'test', userId: longUserId, folderId: 'folderABC' })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.filters.filters[0]).toEqual({
      type: 'eq',
      key: 'userid',
      value: filterablePrefix,
    })
    expect(result.data).toHaveLength(1)
    expect(result.data[0]?.id).toBe('chunk-1')
    expect(result.data[0]?.attributes.userId).toBe(longUserId)
  })

  test.each([
    ['keeps a 2-byte character that exactly reaches the boundary', `${'a'.repeat(62)}é-tail`, `${'a'.repeat(62)}é`],
    ['stops before a 2-byte character that crosses the boundary', `${'a'.repeat(63)}é-tail`, 'a'.repeat(63)],
    ['keeps a 4-byte character that exactly reaches the boundary', `${'a'.repeat(60)}😀-tail`, `${'a'.repeat(60)}😀`],
    ['stops before a 4-byte character that crosses the boundary', `${'a'.repeat(61)}😀-tail`, 'a'.repeat(61)],
  ])('%s', async (_name, userId, expectedPrefix) => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockLegacyResponse([]))

    await searchDocuments({ query: 'test', userId })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.filters.value).toBe(expectedPrefix)
    expect(new TextEncoder().encode(body.filters.value).byteLength).toBeLessThanOrEqual(64)
    expect(body.filters.value).not.toContain('\uFFFD')
  })

  test('sends max_num_results and score_threshold in body', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockLegacyResponse([]))

    await searchDocuments({ query: 'test', userId: 'user_123', max_num_results: 5, score_threshold: 0.8 })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.max_num_results).toBe(5)
    expect(body.score_threshold).toBe(0.8)
  })

  test('post-filters by docId allowlist when multiple filterDocIds', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockLegacyResponse([
      makeLegacyResult({ content: [{ id: 'a', text: 'yes', score: 0.9 }] }),
      makeLegacyResult({
        content: [{ id: 'b', text: 'no', score: 0.8 }],
        attributes: { file: { userid: 'u', folderid: 'f', documentid: 'other', filename: 'b.txt' } },
      }),
    ]))

    const result = await searchDocuments({
      query: 'test',
      userId: 'https://cautious-elephant-39.convex.site|user123',
      filterDocIds: ['docXYZ', 'anotherDoc'],
    })

    expect(result.data).toHaveLength(1)
    expect(result.data[0].id).toBe('a')
  })

  test('[P0] filters multiple authorized documents with a legacy OR instead of the unfilterable tenant id', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockLegacyResponse([]))

    await searchDocuments({
      query: 'test',
      userId: `https://cautious-elephant-39.convex.site|${'u'.repeat(40)}`,
      filterDocIds: ['docXYZ', 'anotherDoc', 'docXYZ'],
    })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.filters).toEqual({
      type: 'or',
      filters: [
        { type: 'eq', key: 'documentid', value: 'docXYZ' },
        { type: 'eq', key: 'documentid', value: 'anotherDoc' },
      ],
    })
  })

  test('drops provider results attributed to another tenant', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockLegacyResponse([
      makeLegacyResult({
        attributes: {
          file: {
            userid: 'https://auth.example.com|other',
            folderid: 'folderABC',
            documentid: 'docXYZ',
            filename: 'private.txt',
          },
        },
      }),
    ]))

    const result = await searchDocuments({
      query: 'test',
      userId: 'https://cautious-elephant-39.convex.site|user123',
      filterDocIds: ['docXYZ'],
    })

    expect(result.data).toEqual([])
  })

  test('[P0] an explicitly empty document allowlist fails closed without a provider request', async () => {
    const result = await searchDocuments({
      query: 'test',
      userId: 'https://cautious-elephant-39.convex.site|user123',
      filterDocIds: [],
    })

    expect(result).toEqual({ data: [] })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  test('drops provider results outside the requested folder', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockLegacyResponse([
      makeLegacyResult({
        attributes: {
          file: {
            userid: 'https://cautious-elephant-39.convex.site|user123',
            folderid: 'folderOTHER',
            documentid: 'docXYZ',
            filename: 'wrong-folder.txt',
          },
        },
      }),
    ]))

    const result = await searchDocuments({
      query: 'test',
      userId: 'https://cautious-elephant-39.convex.site|user123',
      folderId: 'folderABC',
    })

    expect(result.data).toEqual([])
  })

  test('normalizes missing search configuration to an unavailable index', async () => {
    vi.mocked((globalThis as any).useRuntimeConfig).mockReturnValue({})

    const error = await searchDocuments({ query: 'test', userId: 'user_123' })
      .catch((reason: unknown) => reason as Error & { statusCode?: number })

    expect(error.statusCode).toBe(503)
    expect(error.message).toBe('Search index unavailable')
  })

  test('falls back to NUXT_ env vars when runtime config is empty', async () => {
    vi.mocked((globalThis as any).useRuntimeConfig).mockReturnValue({})
    process.env.NUXT_CLOUDFLARE_ACCOUNT_ID = 'env-account'
    process.env.NUXT_CLOUDFLARE_AI_SEARCH_INSTANCE = 'env-instance'
    process.env.NUXT_CLOUDFLARE_AI_SEARCH_TOKEN = 'env-token'
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockLegacyResponse([]))

    await searchDocuments({ query: 'test', userId: 'user_123' })

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/env-account/autorag/rags/env-instance/search',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer env-token',
        }),
      }),
    )
  })

  test('throws on API error response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    } as any)

    await expect(searchDocuments({ query: 'test', userId: 'user_123' })).rejects.toThrow(
      'Search index unavailable',
    )
  })

  test.each([
    ['a network rejection', () => Promise.reject(new Error('network down'))],
    ['a success:false envelope', () => Promise.resolve(new Response(JSON.stringify({ success: false, result: null }), { status: 200 }))],
    ['a missing result envelope', () => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }))],
    ['a malformed result payload', () => Promise.resolve(new Response(JSON.stringify({ success: true, result: { data: {} } }), { status: 200 }))],
    ['a null result entry', () => Promise.resolve(new Response(JSON.stringify({ success: true, result: { data: [null] } }), { status: 200 }))],
    ['a malformed content list', () => Promise.resolve(new Response(JSON.stringify({ success: true, result: { data: [{ content: {} }] } }), { status: 200 }))],
  ])('[P0] normalizes search provider failure from %s', async (_name, responseFactory) => {
    vi.mocked(globalThis.fetch).mockImplementationOnce(responseFactory)

    const error = await searchDocuments({ query: 'test', userId: 'user_123' })
      .catch((reason: unknown) => reason as Error & { statusCode?: number })

    expect(error.statusCode).toBe(503)
    expect(error.message).toBe('Search index unavailable')
  })

  test('[P0] reports an unavailable search index when the instance has zero vectors', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockStatsResponse(0))

    const error = await assertSearchIndexAvailable()
      .catch((reason: unknown) => reason as Error & { statusCode?: number })

    expect(error.statusCode).toBe(503)
    expect(error.message).toBe('Search index unavailable')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/test-account/ai-search/instances/test-instance/stats',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    )
  })

  test.each([
    ['a network rejection', () => Promise.reject(new Error('network down'))],
    ['a non-2xx response', () => Promise.resolve(new Response('down', { status: 503 }))],
    ['a success:false envelope', () => Promise.resolve(new Response(JSON.stringify({ success: false, result: null }), { status: 200 }))],
    ['missing vector statistics', () => Promise.resolve(new Response(JSON.stringify({ success: true, result: {} }), { status: 200 }))],
  ])('[P0] normalizes %s to Search index unavailable', async (_name, responseFactory) => {
    vi.mocked(globalThis.fetch).mockImplementationOnce(responseFactory)

    const error = await assertSearchIndexAvailable()
      .catch((reason: unknown) => reason as Error & { statusCode?: number })

    expect(error.statusCode).toBe(503)
    expect(error.message).toBe('Search index unavailable')
  })
})
