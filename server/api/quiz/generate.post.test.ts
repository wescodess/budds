import { vi, describe, test, expect, beforeEach } from 'vitest'

const mockMutation = vi.fn()
const mockSetAuth = vi.fn()
vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    setAuth = mockSetAuth
    mutation = mockMutation
  },
}))

vi.stubGlobal('useRuntimeConfig', vi.fn())
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) =>
  Object.assign(new Error(opts.message), { statusCode: opts.statusCode }),
)
vi.stubGlobal('getConvexTokenIdentifier', vi.fn(() => 'https://auth.example.com|user_test_123'))
vi.stubGlobal('readBody', vi.fn())
vi.stubGlobal('searchDocuments', vi.fn())
vi.stubGlobal('fetchFolderDocs', vi.fn(async () => []))
vi.stubGlobal('generateCompletion', vi.fn())
vi.stubGlobal('defineEventHandler', (handler: Function) => handler)
vi.stubGlobal('buildQuizPrompt', (await import('../../utils/quiz-prompt')).buildQuizPrompt)
vi.stubGlobal('parseQuizResponse', (await import('../../utils/quiz-prompt')).parseQuizResponse)
vi.stubGlobal('isAllowedModel', (await import('../../utils/models')).isAllowedModel)
vi.stubGlobal('SERVER_DEFAULT_MODEL', (await import('../../utils/models')).SERVER_DEFAULT_MODEL)

process.env.CONVEX_URL = 'https://test.convex.site'

const handler = (await import('./generate.post')).default as Function

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
            title: 'Cellular Biology Quiz',
            questions: [
              {
                order: 0,
                question: 'What do mitochondria produce?',
                type: 'multiple-choice',
                options: ['ATP', 'DNA', 'RNA', 'Glucose'],
                correctAnswer: 'ATP',
                sourceIndex: 1,
              },
              {
                order: 1,
                question: 'What is photosynthesis?',
                type: 'free-response',
                correctAnswer: 'Converting light to chemical energy.',
                sourceIndex: 0,
              },
            ],
          }),
        },
      },
    ],
    model: 'openai/gpt-4o-mini',
    usage: {},
  }
}

describe('POST /api/quiz/generate', () => {
  beforeEach(() => {
    vi.mocked(globalThis.readBody as any).mockReset()
    vi.mocked(globalThis.searchDocuments as any).mockReset()
    vi.mocked(globalThis.generateCompletion as any).mockReset()
    vi.mocked(globalThis.getConvexTokenIdentifier as any).mockReturnValue('https://auth.example.com|user_test_123')
    mockMutation.mockReset()
  })

  test('[P0] 401 when Convex token is missing', async () => {
    vi.mocked(globalThis.getConvexTokenIdentifier as any).mockImplementation(() => {
      throw Object.assign(new Error('Convex authentication token not available'), { statusCode: 401 })
    })
    vi.mocked(globalThis.readBody as any).mockResolvedValue({ folderId: 'folder_abc' })

    const err = await (handler(makeEvent()) as Promise<any>).catch((e: any) => e)
    expect(err.statusCode).toBe(401)
  })

  test('[P0] 400 when folderId is missing', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({})

    const err = await (handler(makeEvent()) as Promise<any>).catch((e: any) => e)
    expect(err.statusCode).toBe(400)
    expect(err.message).toContain('folderId')
  })

  test('[P0] 422 when both AI Search and folder-doc fallback are empty (LLM not called)', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({ folderId: 'folder_abc' })
    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.fetchFolderDocs as any).mockResolvedValue([])

    const err = await (handler(makeEvent()) as Promise<any>).catch((e: any) => e)
    expect(err.statusCode).toBe(422)
    expect(globalThis.generateCompletion).not.toHaveBeenCalled()
  })

  test('[P0] 200 happy path: returns quizId + title + questionCount and persists via mutation', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({ folderId: 'folder_abc' })
    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({
      data: [
        { id: '1', content: 'Photosynthesis content', score: 0.9, attributes: { filename: 'bio1.pdf', documentId: 'doc_1' } },
        { id: '2', content: 'Mitochondria content', score: 0.85, attributes: { filename: 'bio2.pdf', documentId: 'doc_2' } },
      ],
    })
    vi.mocked(globalThis.generateCompletion as any).mockResolvedValue(goodLlmResponse())
    mockMutation.mockResolvedValue({ quizId: 'quiz_abc' })

    const result = await handler(makeEvent())

    expect(result).toEqual({
      quizId: 'quiz_abc',
      title: 'Cellular Biology Quiz',
      questionCount: 2,
    })
    expect(mockMutation).toHaveBeenCalledTimes(1)
    const [, mutationArgs] = mockMutation.mock.calls[0]
    expect(mutationArgs.folderId).toBe('folder_abc')
    expect(mutationArgs.title).toBe('Cellular Biology Quiz')
    expect(mutationArgs.questions).toHaveLength(2)
    expect(mutationArgs.questions[0].sourceFilename).toBe('bio2.pdf')
    expect(mutationArgs.questions[0].sourceChunkContent).toBe('Mitochondria content')
    expect(mutationArgs.questions[0].sourceDocumentId).toBe('doc_2')
    expect(mutationArgs.questions[1].sourceFilename).toBe('bio1.pdf')
  })

  test('[P0] 502 when parseQuizResponse yields no valid questions', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({ folderId: 'folder_abc' })
    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({
      data: [
        { id: '1', content: 'a', score: 0.9, attributes: { filename: 'a.pdf' } },
        { id: '2', content: 'b', score: 0.9, attributes: { filename: 'b.pdf' } },
      ],
    })
    vi.mocked(globalThis.generateCompletion as any).mockResolvedValue({
      choices: [{ message: { content: 'totally not json' } }],
      model: 'openai/gpt-4o-mini',
      usage: {},
    })

    const err = await (handler(makeEvent()) as Promise<any>).catch((e: any) => e)
    expect(err.statusCode).toBe(502)
    expect(mockMutation).not.toHaveBeenCalled()
  })

  test('[P1] disallowed model falls back to SERVER_DEFAULT_MODEL', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      folderId: 'folder_abc',
      model: 'bogus/model',
    })
    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({
      data: [
        { id: '1', content: 'a', score: 0.9, attributes: { filename: 'a.pdf' } },
        { id: '2', content: 'b', score: 0.9, attributes: { filename: 'b.pdf' } },
      ],
    })
    vi.mocked(globalThis.generateCompletion as any).mockResolvedValue(goodLlmResponse())
    mockMutation.mockResolvedValue({ quizId: 'quiz_xyz' })

    await handler(makeEvent())

    expect(globalThis.generateCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai/gpt-4o-mini' }),
    )
    const [, mutationArgs] = mockMutation.mock.calls[0]
    expect(mutationArgs.model).toBe('openai/gpt-4o-mini')
  })

  test('[P1] integration: mutation receives questions that round-trip through zod', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({ folderId: 'folder_abc' })
    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({
      data: [
        { id: '1', content: 'content 1', score: 0.9, attributes: { filename: 'a.pdf' } },
        { id: '2', content: 'content 2', score: 0.9, attributes: { filename: 'b.pdf' } },
      ],
    })
    vi.mocked(globalThis.generateCompletion as any).mockResolvedValue(goodLlmResponse())
    mockMutation.mockResolvedValue({ quizId: 'quiz_round' })

    await handler(makeEvent())

    const [, mutationArgs] = mockMutation.mock.calls[0]
    for (const q of mutationArgs.questions) {
      expect(typeof q.order).toBe('number')
      expect(typeof q.question).toBe('string')
      expect(['multiple-choice', 'free-response']).toContain(q.type)
      expect(typeof q.correctAnswer).toBe('string')
      expect(typeof q.sourceChunkContent).toBe('string')
      expect(typeof q.sourceFilename).toBe('string')
      if (q.type === 'multiple-choice') {
        expect(q.options).toHaveLength(4)
        expect(q.options).toContain(q.correctAnswer)
      }
    }
  })
})
