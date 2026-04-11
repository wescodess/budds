import { vi, describe, test, expect, beforeEach } from 'vitest'

vi.stubGlobal('useRuntimeConfig', vi.fn())
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) =>
  Object.assign(new Error(opts.message), { statusCode: opts.statusCode }),
)
vi.stubGlobal('getConvexTokenIdentifier', vi.fn(() => 'https://auth.example.com|user_test_123'))
vi.stubGlobal('readBody', vi.fn())
vi.stubGlobal('searchDocuments', vi.fn())
vi.stubGlobal('generateCompletion', vi.fn())
vi.stubGlobal('generateCompletionStream', vi.fn())
vi.stubGlobal('setResponseHeader', vi.fn())
vi.stubGlobal('sendStream', vi.fn())
vi.stubGlobal('defineEventHandler', (handler: Function) => handler)

const handler = (await import('./chat.post')).default as Function
const mockEvent = {} as any

describe('POST /api/rag/chat — folderId enforcement (AC #1)', () => {
  beforeEach(() => {
    vi.mocked(globalThis.readBody as any).mockReset()
    vi.mocked(globalThis.searchDocuments as any).mockReset()
    vi.mocked(globalThis.generateCompletion as any).mockReset()
  })

  test('[P0] should return 400 when folderId is missing from request body', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      query: 'What is photosynthesis?',
      model: 'openai/gpt-4o-mini',
    })

    const error = await (handler(mockEvent) as Promise<any>).catch((e: any) => e)
    expect(error.statusCode).toBe(400)
    expect(error.message).toContain('folderId')
  })

  test('[P0] should pass folderId in searchDocuments filters when provided', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      query: 'What is photosynthesis?',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_abc123',
    })
    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({
      data: [{ id: '1', content: 'test content', score: 0.9, attributes: { filename: 'bio.pdf' } }],
    })
    vi.mocked(globalThis.generateCompletion as any).mockResolvedValue({
      choices: [{ message: { content: 'Answer text [1]' } }],
      model: 'openai/gpt-4o-mini',
      usage: {},
    })

    await handler(mockEvent)

    expect(globalThis.searchDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ folderId: 'folder_abc123' }),
      }),
    )
  })

  test('[P0] should call searchDocuments with both userId and folderId filters', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      query: 'Explain mitosis',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_xyz789',
    })
    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.generateCompletion as any).mockResolvedValue({
      choices: [{ message: { content: 'Response' } }],
      model: 'openai/gpt-4o-mini',
      usage: {},
    })

    await handler(mockEvent)

    expect(globalThis.searchDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'https://auth.example.com|user_test_123',
        filters: expect.objectContaining({ folderId: 'folder_xyz789' }),
      }),
    )
  })

  test('[P1] should return sources with content, score, and filename in response', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      query: 'What is DNA?',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_bio101',
    })
    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({
      data: [
        { id: '1', content: 'DNA is a molecule', score: 0.95, attributes: { filename: 'genetics.pdf', userId: 'u1' } },
        { id: '2', content: 'Double helix structure', score: 0.87, attributes: { filename: 'biology.pdf', userId: 'u1' } },
      ],
    })
    vi.mocked(globalThis.generateCompletion as any).mockResolvedValue({
      choices: [{ message: { content: 'DNA stands for [1] deoxyribonucleic acid [2]' } }],
      model: 'openai/gpt-4o-mini',
      usage: {},
    })

    const result = await handler(mockEvent)

    expect(result.sources).toHaveLength(2)
    expect(result.sources[0]).toEqual(
      expect.objectContaining({
        content: 'DNA is a molecule',
        score: 0.95,
      }),
    )
    expect(result.sources[0].attributes.filename).toBe('genetics.pdf')
  })
})
