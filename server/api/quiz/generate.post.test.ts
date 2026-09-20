import { vi, describe, test, expect, beforeEach } from 'vitest'

const shadowEvaluateQuiz = vi.hoisted(() => vi.fn())
vi.mock('../../utils/learning-decisions', () => ({ shadowEvaluateQuiz }))

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
vi.stubGlobal('buildQuizPrompt', (await import('../../utils/quiz-prompt')).buildQuizPrompt)
vi.stubGlobal('parseQuizResponse', (await import('../../utils/quiz-prompt')).parseQuizResponse)
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
    vi.mocked(globalThis.readBody).mockReset()
    vi.mocked(globalThis.searchDocuments).mockReset()
    vi.mocked(globalThis.assertSearchIndexAvailable).mockReset()
    vi.mocked(globalThis.assertSearchIndexAvailable).mockResolvedValue(undefined)
    vi.mocked(globalThis.generateCompletion).mockReset()
    shadowEvaluateQuiz.mockReset()
    shadowEvaluateQuiz.mockResolvedValue({ status: 'unavailable', reason: 'disabled', retryable: false })
    vi.mocked(globalThis.getConvexTokenIdentifier).mockReturnValue('https://auth.example.com|user_test_123')
  })

  test('[P0] 401 when Convex token is missing', async () => {
    vi.mocked(globalThis.getConvexTokenIdentifier).mockImplementation(() => {
      throw Object.assign(new Error('Convex authentication token not available'), { statusCode: 401 })
    })
    vi.mocked(globalThis.readBody).mockResolvedValue({ folderId: 'folder_abc', language: 'en' })

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

    expect(result.questionCount).toBe(2)
    expect(globalThis.assertSearchIndexAvailable).not.toHaveBeenCalled()
  })

  test('[P0] 200 happy path: returns generated quiz payload for client persistence', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({ folderId: 'folder_abc', language: 'en' })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [
        { id: '1', content: 'Photosynthesis content', score: 0.9, attributes: { filename: 'bio1.pdf', documentId: 'doc_1' } },
        { id: '2', content: 'Mitochondria content', score: 0.85, attributes: { filename: 'bio2.pdf', documentId: 'doc_2' } },
      ],
    })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue(goodLlmResponse())

    const result = await handler(makeEvent())

    expect(result).toEqual({
      title: 'Cellular Biology Quiz',
      model: 'openai/gpt-4o-mini',
      questions: [
        {
          order: 0,
          question: 'What do mitochondria produce?',
          type: 'multiple-choice',
          options: ['ATP', 'DNA', 'RNA', 'Glucose'],
          correctAnswer: 'ATP',
          sourceDocumentId: 'doc_2',
          sourceChunkContent: 'Mitochondria content',
          sourceFilename: 'bio2.pdf',
        },
        {
          order: 1,
          question: 'What is photosynthesis?',
          type: 'free-response',
          correctAnswer: 'Converting light to chemical energy.',
          sourceDocumentId: 'doc_1',
          sourceChunkContent: 'Photosynthesis content',
          sourceFilename: 'bio1.pdf',
        },
      ],
      questionCount: 2,
    })
    expect(shadowEvaluateQuiz).toHaveBeenCalledOnce()
    expect(shadowEvaluateQuiz).toHaveBeenCalledWith(expect.anything(), [
      { id: 'q0', question: 'What do mitochondria produce?', options: ['ATP', 'DNA', 'RNA', 'Glucose'], correctAnswer: 'ATP', language: 'en', evidence: { sourceIndex: 1, excerpt: 'Mitochondria content' } },
      { id: 'q1', question: 'What is photosynthesis?', options: undefined, correctAnswer: 'Converting light to chemical energy.', language: 'en', evidence: { sourceIndex: 0, excerpt: 'Photosynthesis content' } },
    ])
  })

  test('[P0] preserves a generated question with an invalid source index without substituting or evaluating false provenance', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({ folderId: 'folder_abc', language: 'en' })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [
        { id: '1', content: 'Photosynthesis content', score: 0.9, attributes: { filename: 'bio1.pdf', documentId: 'doc_1' } },
        { id: '2', content: 'Mitochondria content', score: 0.85, attributes: { filename: 'bio2.pdf', documentId: 'doc_2' } },
      ],
    })
    const generated = goodLlmResponse()
    generated.choices[0]!.message.content = JSON.stringify({
      title: 'Cellular Biology Quiz',
      questions: [{
        order: 0,
        question: 'What do mitochondria produce?',
        type: 'multiple-choice',
        options: ['ATP', 'DNA', 'RNA', 'Glucose'],
        correctAnswer: 'ATP',
        sourceIndex: 99,
      }],
    })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue(generated)

    const result = await handler(makeEvent())

    expect(result.questions).toEqual([{
      order: 0,
      question: 'What do mitochondria produce?',
      type: 'multiple-choice',
      options: ['ATP', 'DNA', 'RNA', 'Glucose'],
      correctAnswer: 'ATP',
      explanation: undefined,
      sourceDocumentId: undefined,
      sourceChunkContent: undefined,
      sourceFilename: undefined,
    }])
    expect(shadowEvaluateQuiz).not.toHaveBeenCalled()
  })

  test('[P0] evaluates exactly sourced items while reporting invalid evidence without substitution', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.mocked(globalThis.readBody).mockResolvedValue({ folderId: 'folder_abc', language: 'en' })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [
        { id: '1', content: 'Photosynthesis content', score: 0.9, attributes: { filename: 'bio1.pdf', documentId: 'doc_1' } },
        { id: '2', content: 'Mitochondria content', score: 0.85, attributes: { filename: 'bio2.pdf', documentId: 'doc_2' } },
      ],
    })
    const generated = goodLlmResponse()
    const payload = JSON.parse(generated.choices[0]!.message.content)
    payload.questions[1].sourceIndex = 99
    generated.choices[0]!.message.content = JSON.stringify(payload)
    vi.mocked(globalThis.generateCompletion).mockResolvedValue(generated)

    const result = await handler(makeEvent())

    expect(result.questions[1]).toMatchObject({ sourceDocumentId: undefined, sourceChunkContent: undefined, sourceFilename: undefined })
    expect(shadowEvaluateQuiz).toHaveBeenCalledOnce()
    expect(shadowEvaluateQuiz).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({
      id: 'q0', evidence: { sourceIndex: 1, excerpt: 'Mitochondria content' },
    })])
    expect(console.info).toHaveBeenCalledWith('[quiz-quality-evidence]', {
      status: 'unavailable', reason: 'missing_evidence', itemCount: 1,
    })
  })

  test('[P0] evaluator failure leaves the quiz response unchanged', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({ folderId: 'folder_abc' })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [
        { id: '1', content: 'Photosynthesis content', score: 0.9, attributes: { filename: 'bio1.pdf', documentId: 'doc_1' } },
        { id: '2', content: 'Mitochondria content', score: 0.85, attributes: { filename: 'bio2.pdf', documentId: 'doc_2' } },
      ],
    })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue(goodLlmResponse())
    shadowEvaluateQuiz.mockRejectedValue(new Error('provider unavailable'))

    const result = await handler(makeEvent())

    expect(result.title).toBe('Cellular Biology Quiz')
    expect(result.questionCount).toBe(2)
    expect(result.questions.map((question: { correctAnswer: string }) => question.correctAnswer)).toEqual(['ATP', 'Converting light to chemical energy.'])
  })

  test('[P0] 502 when parseQuizResponse yields no valid questions', async () => {
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

  test('[P1] integration: response questions round-trip through zod', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({ folderId: 'folder_abc' })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [
        { id: '1', content: 'content 1', score: 0.9, attributes: { filename: 'a.pdf' } },
        { id: '2', content: 'content 2', score: 0.9, attributes: { filename: 'b.pdf' } },
      ],
    })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue(goodLlmResponse())

    const result = await handler(makeEvent())

    for (const q of result.questions) {
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
