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

    const result = await searchDocuments({ query: 'test query' })

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

    await searchDocuments({ query: 'how does auth work' })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.messages).toEqual([{ role: 'user', content: 'how does auth work' }])
  })

  test('throws when config is missing', async () => {
    vi.mocked((globalThis as any).useRuntimeConfig).mockReturnValue({})

    await expect(searchDocuments({ query: 'test' })).rejects.toThrow(
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
      max_num_results: 5,
      score_threshold: 0.8,
      filters: { category: 'docs' },
    })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.ai_search_options).toEqual({
      max_num_results: 5,
      score_threshold: 0.8,
      filters: { category: 'docs' },
    })
  })

  test('omits ai_search_options when no optional params provided', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    } as any)

    await searchDocuments({ query: 'test' })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.ai_search_options).toBeUndefined()
  })

  test('throws on API error response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    } as any)

    await expect(searchDocuments({ query: 'test' })).rejects.toThrow(
      'AI Search error: Internal Server Error',
    )
  })

  test('includes reranking option when specified', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    } as any)

    await searchDocuments({ query: 'test', reranking: true })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.ai_search_options.reranking).toEqual({ enabled: true })
  })
})
