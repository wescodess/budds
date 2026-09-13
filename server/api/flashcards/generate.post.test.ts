import { vi, describe, test, expect, beforeEach } from 'vitest'

vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) =>
  Object.assign(new Error(opts.message), { statusCode: opts.statusCode }),
)
vi.stubGlobal('getConvexTokenIdentifier', vi.fn(() => 'https://auth.example.com|user_test_123'))
vi.stubGlobal('readBody', vi.fn())
vi.stubGlobal('searchDocuments', vi.fn())
vi.stubGlobal('fetchFolderDocs', vi.fn(async () => []))
vi.stubGlobal('assertSearchIndexAvailable', vi.fn(async () => undefined))
vi.stubGlobal('generateCompletion', vi.fn())
vi.stubGlobal('defineEventHandler', (handler: (...args: never[]) => unknown) => handler)
vi.stubGlobal('buildFlashcardPrompt', (await import('../../utils/flashcard-prompt')).buildFlashcardPrompt)
vi.stubGlobal('parseFlashcardResponse', (await import('../../utils/flashcard-prompt')).parseFlashcardResponse)
vi.stubGlobal('isAllowedModel', (await import('../../utils/models')).isAllowedModel)
vi.stubGlobal('SERVER_DEFAULT_MODEL', (await import('../../utils/models')).SERVER_DEFAULT_MODEL)

const handler = (await import('./generate.post')).default

function makeEvent(): any {
  return {
    context: { convexToken: 'mock-jwt-token' },
  }
}

function goodLlmResponse() {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            title: 'Cellular Biology Flash Cards',
            cards: [
              { order: 0, front: 'What produces ATP?', back: 'Mitochondria', sourceIndex: 1 },
              { order: 1, front: 'Define photosynthesis', back: 'Converting light to chemical energy', sourceIndex: 0 },
            ],
          }),
        },
      },
    ],
    model: 'openai/gpt-4o-mini',
    usage: {},
  }
}

describe('POST /api/flashcards/generate', () => {
  beforeEach(() => {
    vi.mocked(globalThis.readBody).mockReset()
    vi.mocked(globalThis.searchDocuments).mockReset()
    vi.mocked(globalThis.assertSearchIndexAvailable).mockReset()
    vi.mocked(globalThis.assertSearchIndexAvailable).mockResolvedValue(undefined)
    vi.mocked(globalThis.generateCompletion).mockReset()
    vi.mocked(globalThis.getConvexTokenIdentifier).mockReturnValue('https://auth.example.com|user_test_123')
  })

  test('[P0] 401 when Convex token is missing', async () => {
    vi.mocked(globalThis.getConvexTokenIdentifier).mockImplementation(() => {
      throw Object.assign(new Error('Convex authentication token not available'), { statusCode: 401 })
    })
    vi.mocked(globalThis.readBody).mockResolvedValue({ folderId: 'folder_abc' })

    const err = await (handler(makeEvent()) as Promise<any>).catch((e: any) => e)
    expect(err.statusCode).toBe(401)
  })

  test('[P0] 400 when folderId is missing', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({})

    const err = await (handler(makeEvent()) as Promise<any>).catch((e: any) => e)
    expect(err.statusCode).toBe(400)
    expect(err.message).toContain('folderId')
  })

  test('[P0] 422 when both AI Search and folder-doc fallback are empty (LLM not called)', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({ folderId: 'folder_abc' })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.fetchFolderDocs).mockResolvedValue([])

    const err = await (handler(makeEvent()) as Promise<any>).catch((e: any) => e)
    expect(err.statusCode).toBe(422)
    expect(globalThis.generateCompletion).not.toHaveBeenCalled()
  })

  test('[P0] 503 Search index unavailable when empty retrieval follows a zero-vector index', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({ folderId: 'folder_abc' })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.fetchFolderDocs).mockResolvedValue([])
    vi.mocked(globalThis.assertSearchIndexAvailable).mockRejectedValue(
      Object.assign(new Error('Search index unavailable'), { statusCode: 503 }),
    )

    const err = await (handler(makeEvent()) as Promise<any>).catch((e: any) => e)
    expect(err.statusCode).toBe(503)
    expect(err.message).toBe('Search index unavailable')
    expect(globalThis.generateCompletion).not.toHaveBeenCalled()
  })

  test('[P0] uses raw text fallback when the search provider is unavailable', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({ folderId: 'folder_abc' })
    vi.mocked(globalThis.searchDocuments).mockRejectedValue(
      Object.assign(new Error('Search index unavailable'), { statusCode: 503 }),
    )
    vi.mocked(globalThis.fetchFolderDocs).mockResolvedValue([
      { key: 'one.md', content: 'Photosynthesis content', filename: 'one.md', documentId: 'doc_1' },
      { key: 'two.md', content: 'Mitochondria content', filename: 'two.md', documentId: 'doc_2' },
    ])
    vi.mocked(globalThis.generateCompletion).mockResolvedValue(goodLlmResponse())

    const result = await handler(makeEvent())

    expect(result.cardCount).toBe(2)
    expect(globalThis.assertSearchIndexAvailable).not.toHaveBeenCalled()
  })

  test('[P0] 200 happy path: returns generated cards payload for client persistence', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({ folderId: 'folder_abc' })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [
        { id: '1', content: 'Photosynthesis content', score: 0.9, attributes: { filename: 'bio1.pdf', documentId: 'doc_1' } },
        { id: '2', content: 'Mitochondria content', score: 0.85, attributes: { filename: 'bio2.pdf', documentId: 'doc_2' } },
      ],
    })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue(goodLlmResponse())

    const result = await handler(makeEvent())

    expect(result).toEqual({
      title: 'Cellular Biology Flash Cards',
      model: 'openai/gpt-4o-mini',
      cards: [
        {
          order: 0,
          front: 'What produces ATP?',
          back: 'Mitochondria',
          sourceDocumentId: 'doc_2',
          sourceChunkContent: 'Mitochondria content',
          sourceFilename: 'bio2.pdf',
        },
        {
          order: 1,
          front: 'Define photosynthesis',
          back: 'Converting light to chemical energy',
          sourceDocumentId: 'doc_1',
          sourceChunkContent: 'Photosynthesis content',
          sourceFilename: 'bio1.pdf',
        },
      ],
      cardCount: 2,
    })
  })

  test('[P0] 502 when parseFlashcardResponse yields no valid cards', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({ folderId: 'folder_abc' })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [
        { id: '1', content: 'a', score: 0.9, attributes: { filename: 'a.pdf' } },
        { id: '2', content: 'b', score: 0.9, attributes: { filename: 'b.pdf' } },
      ],
    })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue({
      choices: [{ message: { content: 'totally not json' } }],
      model: 'openai/gpt-4o-mini',
      usage: {},
    })

    const err = await (handler(makeEvent()) as Promise<any>).catch((e: any) => e)
    expect(err.statusCode).toBe(502)
  })

  test('[P1] disallowed model falls back to SERVER_DEFAULT_MODEL', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({
      folderId: 'folder_abc',
      model: 'bogus/model',
    })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [
        { id: '1', content: 'a', score: 0.9, attributes: { filename: 'a.pdf' } },
        { id: '2', content: 'b', score: 0.9, attributes: { filename: 'b.pdf' } },
      ],
    })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue(goodLlmResponse())

    await handler(makeEvent())

    expect(globalThis.generateCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai/gpt-4o-mini' }),
    )
  })

  test('[P1] integration: response cards round-trip through zod', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({ folderId: 'folder_abc' })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [
        { id: '1', content: 'content 1', score: 0.9, attributes: { filename: 'a.pdf' } },
        { id: '2', content: 'content 2', score: 0.9, attributes: { filename: 'b.pdf' } },
      ],
    })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue(goodLlmResponse())

    const result = await handler(makeEvent())

    for (const c of result.cards) {
      expect(typeof c.order).toBe('number')
      expect(typeof c.front).toBe('string')
      expect(c.front.length).toBeGreaterThan(0)
      expect(typeof c.back).toBe('string')
      expect(c.back.length).toBeGreaterThan(0)
      expect(typeof c.sourceChunkContent).toBe('string')
      expect(typeof c.sourceFilename).toBe('string')
    }
  })
})
