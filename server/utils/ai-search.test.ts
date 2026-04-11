import { vi, describe, test, expect, beforeEach } from 'vitest'

vi.stubGlobal('useRuntimeConfig', vi.fn())
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) =>
  Object.assign(new Error(opts.message), { statusCode: opts.statusCode }),
)
vi.stubGlobal('fetch', vi.fn())

const { searchDocuments } = await import('./ai-search')

const validConfig = {
  cloudflareAccountId: 'test-account',
  cloudflareAiSearchInstance: 'test-instance',
  cloudflareAiSearchToken: 'test-token',
}

describe('searchDocuments', () => {
  beforeEach(() => {
    vi.mocked(globalThis.fetch).mockReset()
    vi.mocked((globalThis as any).useRuntimeConfig).mockReturnValue(validConfig)
  })

  test('returns search results for a valid query', async () => {
    const mockResponse = {
      data: [{ id: '1', content: 'test content', score: 0.95, attributes: { filename: 'doc.pdf' } }],
    }
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as any)

    const result = await searchDocuments({ query: 'test query', userId: 'user_123' })

    expect(result).toEqual(mockResponse)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/test-account/ai-search/instances/test-instance/search',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
      }),
    )
  })

  test('sends query as user message in request body', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    } as any)

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

  test('includes search options when provided', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    } as any)

    await searchDocuments({
      query: 'test',
      userId: 'user_123',
      max_num_results: 5,
      score_threshold: 0.8,
      filters: { category: 'docs' },
    })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.ai_search_options).toEqual({
      max_num_results: 5,
      score_threshold: 0.8,
      filters: { category: 'docs', userId: 'user_123' },
    })
  })

  test('always includes ai_search_options with userId filter even when no other options provided', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    } as any)

    await searchDocuments({ query: 'test', userId: 'user_123' })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.ai_search_options).toBeDefined()
    expect(body.ai_search_options.filters.userId).toBe('user_123')
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

  test('includes reranking option when specified', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    } as any)

    await searchDocuments({ query: 'test', userId: 'user_123', reranking: true })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.ai_search_options.reranking).toEqual({ enabled: true })
  })
})

describe('searchDocuments userId enforcement', () => {
  beforeEach(() => {
    vi.mocked(globalThis.fetch).mockReset()
    vi.mocked((globalThis as any).useRuntimeConfig).mockReturnValue(validConfig)
  })

  test('[P0] should always inject userId into filters', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    } as any)

    await searchDocuments({ query: 'test', userId: 'user_123' })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.ai_search_options.filters.userId).toBe('user_123')
  })

  test('[P0] should merge userId with caller-provided filters', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    } as any)

    await searchDocuments({
      query: 'test',
      userId: 'user_123',
      filters: { folderId: 'folder_abc' },
    })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.ai_search_options.filters.userId).toBe('user_123')
    expect(body.ai_search_options.filters.folderId).toBe('folder_abc')
  })

  test('[P0] should not allow caller to override userId filter', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    } as any)

    await searchDocuments({
      query: 'test',
      userId: 'user_123',
      filters: { userId: 'user_MALICIOUS' },
    })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.ai_search_options.filters.userId).toBe('user_123')
  })
})
