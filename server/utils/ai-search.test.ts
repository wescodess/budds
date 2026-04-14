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

function mockCfResponse(chunks: unknown[]) {
  return {
    ok: true,
    json: () => Promise.resolve({ success: true, result: { search_query: 'q', chunks } }),
  } as any
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
  })

  test('returns mapped chunks from CF response shape', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockCfResponse([
      {
        id: 'chunk-1',
        type: 'text',
        score: 0.87,
        text: 'Extracted passage.',
        item: {
          key: 'cautious-elephant-39.convex.site_user123/folderABC/docXYZ.txt',
          timestamp: 1,
          metadata: {
            userid: 'https://cautious-elephant-39.convex.site|user123',
            folderid: 'folderABC',
            documentid: 'docXYZ',
            filename: 'docXYZ.txt',
          },
        },
      },
    ]))

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

  test('filters out chunks that do not belong to the requesting user', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockCfResponse([
      { id: 'a', score: 0.9, text: 'mine', item: { metadata: { userid: 'user_123', folderid: 'f1', documentid: 'd1', filename: 'a.txt' } } },
      { id: 'b', score: 0.8, text: 'someone else', item: { metadata: { userid: 'user_other', folderid: 'f1', documentid: 'd2', filename: 'b.txt' } } },
    ]))

    const result = await searchDocuments({ query: 'test', userId: 'user_123' })

    expect(result.data).toHaveLength(1)
    expect(result.data[0].id).toBe('a')
  })

  test('filters out chunks outside the requested folder when folderId provided', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockCfResponse([
      { id: 'a', score: 0.9, text: 'in folder', item: { metadata: { userid: 'user_123', folderid: 'f1', documentid: 'd1', filename: 'a.txt' } } },
      { id: 'b', score: 0.8, text: 'other folder', item: { metadata: { userid: 'user_123', folderid: 'f2', documentid: 'd2', filename: 'b.txt' } } },
    ]))

    const result = await searchDocuments({ query: 'test', userId: 'user_123', folderId: 'f1' })

    expect(result.data).toHaveLength(1)
    expect(result.data[0].id).toBe('a')
  })

  test('does not send retrieval filters in request body', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockCfResponse([]))

    await searchDocuments({ query: 'test', userId: 'https://x.com|user_123', folderId: 'folder_abc' })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.ai_search_options?.retrieval).toBeUndefined()
  })

  test('sends query as user message in request body', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockCfResponse([]))

    await searchDocuments({ query: 'how does auth work', userId: 'user_123' })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.messages).toEqual([{ role: 'user', content: 'how does auth work' }])
  })

  test('throws when config is missing', async () => {
    vi.mocked((globalThis as any).useRuntimeConfig).mockReturnValue({})

    await expect(searchDocuments({ query: 'test', userId: 'user_123' })).rejects.toThrow(
      'Missing Cloudflare AI Search configuration',
    )
  })

  test('includes max_num_results, score_threshold, reranking when provided', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockCfResponse([]))

    await searchDocuments({
      query: 'test',
      userId: 'user_123',
      max_num_results: 5,
      score_threshold: 0.8,
      reranking: true,
    })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.ai_search_options).toMatchObject({
      max_num_results: 5,
      score_threshold: 0.8,
      reranking: { enabled: true },
    })
    expect(body.ai_search_options.retrieval).toBeUndefined()
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
