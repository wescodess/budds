import { vi, describe, test, expect, beforeEach } from 'vitest'

vi.stubGlobal('useRuntimeConfig', vi.fn())
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) =>
  Object.assign(new Error(opts.message), { statusCode: opts.statusCode }),
)
vi.stubGlobal('fetch', vi.fn())

const { searchDocuments, sanitizeUserSegment } = await import('./ai-search')

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

  test('throws when config is missing', async () => {
    vi.mocked((globalThis as any).useRuntimeConfig).mockReturnValue({})

    await expect(searchDocuments({ query: 'test', userId: 'user_123' })).rejects.toThrow(
      'Missing Cloudflare AI Search configuration',
    )
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
      'AI Search error: Internal Server Error',
    )
  })
})
