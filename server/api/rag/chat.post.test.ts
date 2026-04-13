import { vi, describe, test, expect, beforeEach } from 'vitest'

vi.stubGlobal('useRuntimeConfig', vi.fn())
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) =>
  Object.assign(new Error(opts.message), { statusCode: opts.statusCode }),
)
vi.stubGlobal('getConvexTokenIdentifier', vi.fn(() => 'https://auth.example.com|user_test_123'))
vi.stubGlobal('readBody', vi.fn())
vi.stubGlobal('searchDocuments', vi.fn())
vi.stubGlobal('fetchFolderDocs', vi.fn(async () => []))
vi.stubGlobal('generateCompletion', vi.fn())
vi.stubGlobal('generateCompletionStream', vi.fn())
vi.stubGlobal('setResponseHeader', vi.fn())
vi.stubGlobal('sendStream', vi.fn())
vi.stubGlobal('defineEventHandler', (handler: Function) => handler)
vi.stubGlobal('isAllowedModel', (await import('../../utils/models')).isAllowedModel)
vi.stubGlobal('SERVER_DEFAULT_MODEL', (await import('../../utils/models')).SERVER_DEFAULT_MODEL)

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
      expect.objectContaining({ folderId: 'folder_abc123' }),
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
        folderId: 'folder_xyz789',
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

describe('POST /api/rag/chat — streaming (AC #1, #2)', () => {
  beforeEach(() => {
    vi.mocked(globalThis.readBody as any).mockReset()
    vi.mocked(globalThis.searchDocuments as any).mockReset()
    vi.mocked(globalThis.generateCompletion as any).mockReset()
    vi.mocked(globalThis.generateCompletionStream as any).mockReset()
    vi.mocked(globalThis.setResponseHeader as any).mockReset()
    vi.mocked(globalThis.sendStream as any).mockReset()
  })

  test('[P0] should call generateCompletionStream when stream: true', async () => {
    const mockStream = new ReadableStream({
      start(controller) { controller.close() },
    })
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      query: 'What is photosynthesis?',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_abc',
      stream: true,
    })
    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.generateCompletionStream as any).mockResolvedValue(mockStream)
    vi.mocked(globalThis.sendStream as any).mockReturnValue(undefined)

    await handler(mockEvent)

    expect(globalThis.generateCompletionStream).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true }),
    )
    expect(globalThis.generateCompletion).not.toHaveBeenCalled()
  })

  test('[P0] should set SSE headers for streaming response', async () => {
    const mockStream = new ReadableStream({
      start(controller) { controller.close() },
    })
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      query: 'Test',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_abc',
      stream: true,
    })
    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.generateCompletionStream as any).mockResolvedValue(mockStream)
    vi.mocked(globalThis.sendStream as any).mockReturnValue(undefined)

    await handler(mockEvent)

    expect(globalThis.setResponseHeader).toHaveBeenCalledWith(mockEvent, 'Content-Type', 'text/event-stream')
    expect(globalThis.setResponseHeader).toHaveBeenCalledWith(mockEvent, 'Cache-Control', 'no-cache')
    expect(globalThis.setResponseHeader).toHaveBeenCalledWith(mockEvent, 'Connection', 'keep-alive')
  })

  test('[P0] should call sendStream with the transformed stream', async () => {
    const mockStream = new ReadableStream({
      start(controller) { controller.close() },
    })
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      query: 'Test',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_abc',
      stream: true,
    })
    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.generateCompletionStream as any).mockResolvedValue(mockStream)
    vi.mocked(globalThis.sendStream as any).mockReturnValue(undefined)

    await handler(mockEvent)

    expect(globalThis.sendStream).toHaveBeenCalledWith(mockEvent, expect.any(ReadableStream))
  })

  test('[P0] should prepend sources event in the transformed stream', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'))
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      query: 'What is DNA?',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_bio',
      stream: true,
    })
    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({
      data: [
        { id: '1', content: 'DNA content', score: 0.9, attributes: { filename: 'bio.pdf' } },
      ],
    })
    vi.mocked(globalThis.generateCompletionStream as any).mockResolvedValue(mockStream)

    let capturedStream: ReadableStream | null = null
    vi.mocked(globalThis.sendStream as any).mockImplementation((_event: any, stream: ReadableStream) => {
      capturedStream = stream
    })

    await handler(mockEvent)

    const reader = capturedStream!.getReader()
    const decoder = new TextDecoder()
    let output = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      output += decoder.decode(value, { stream: true })
    }

    expect(output).toContain('event: sources')
    expect(output).toContain('"content":"DNA content"')
    expect(output).toContain('"score":0.9')
    expect(output).toContain('data: {"choices"')
  })
})

describe('POST /api/rag/chat — model validation (AC #4)', () => {
  beforeEach(() => {
    vi.mocked(globalThis.readBody as any).mockReset()
    vi.mocked(globalThis.searchDocuments as any).mockReset()
    vi.mocked(globalThis.generateCompletion as any).mockReset()
    vi.mocked(globalThis.generateCompletionStream as any).mockReset()
    vi.mocked(globalThis.setResponseHeader as any).mockReset()
    vi.mocked(globalThis.sendStream as any).mockReset()
  })

  test('[P0] should pass valid model through unchanged', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      query: 'What is photosynthesis?',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_abc',
    })
    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.generateCompletion as any).mockResolvedValue({
      choices: [{ message: { content: 'Answer' } }],
      model: 'openai/gpt-4o-mini',
      usage: {},
    })

    const result = await handler(mockEvent)

    expect(globalThis.generateCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai/gpt-4o-mini' }),
    )
    expect(result.modelFallback).toBeUndefined()
  })

  test('[P0] should fallback to default model when invalid model is sent (non-streaming)', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      query: 'What is photosynthesis?',
      model: 'invalid/nonexistent-model',
      folderId: 'folder_abc',
    })
    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.generateCompletion as any).mockResolvedValue({
      choices: [{ message: { content: 'Answer' } }],
      model: 'openai/gpt-4o-mini',
      usage: {},
    })

    const result = await handler(mockEvent)

    expect(globalThis.generateCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai/gpt-4o-mini' }),
    )
    expect(result.modelFallback).toEqual({
      requested: 'invalid/nonexistent-model',
      actual: 'openai/gpt-4o-mini',
    })
  })

  test('[P0] should emit model-fallback SSE event for invalid model in streaming path', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'))
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      query: 'Test',
      model: 'invalid/nonexistent-model',
      folderId: 'folder_abc',
      stream: true,
    })
    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.generateCompletionStream as any).mockResolvedValue(mockStream)

    let capturedStream: ReadableStream | null = null
    vi.mocked(globalThis.sendStream as any).mockImplementation((_event: any, stream: ReadableStream) => {
      capturedStream = stream
    })

    await handler(mockEvent)

    const reader = capturedStream!.getReader()
    const decoder = new TextDecoder()
    let output = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      output += decoder.decode(value, { stream: true })
    }

    expect(output).toContain('event: model-fallback')
    expect(output).toContain('"requested":"invalid/nonexistent-model"')
    expect(output).toContain('"actual":"openai/gpt-4o-mini"')

    expect(globalThis.generateCompletionStream).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai/gpt-4o-mini' }),
    )
  })

  test('[P1] should include modelFallback in non-streaming response for invalid model', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      query: 'Explain mitosis',
      model: 'some/unknown-model-xyz',
      folderId: 'folder_bio',
    })
    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.generateCompletion as any).mockResolvedValue({
      choices: [{ message: { content: 'Mitosis is...' } }],
      model: 'openai/gpt-4o-mini',
      usage: {},
    })

    const result = await handler(mockEvent)

    expect(result.modelFallback).toBeDefined()
    expect(result.modelFallback.requested).toBe('some/unknown-model-xyz')
    expect(result.modelFallback.actual).toBe('openai/gpt-4o-mini')
    expect(result.answer).toBe('Mitosis is...')
  })
})

describe('Model allowlist sync — client/server parity', () => {
  test('server MODEL_ALLOWLIST matches client MODELS values', async () => {
    const { MODELS } = await import('../../../app/constants/models')
    const { isAllowedModel } = await import('../../utils/models')

    const clientValues = MODELS.map(m => m.value)
    for (const value of clientValues) {
      expect(isAllowedModel(value), `Client model "${value}" is not in server allowlist`).toBe(true)
    }
    expect(clientValues.length).toBe(8)
  })
})
