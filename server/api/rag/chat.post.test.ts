import { vi, describe, test, expect, beforeEach } from 'vitest'

const mockConvexQuery = vi.fn()

vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    setAuth(_token: string) {}
    query(...args: unknown[]) {
      return mockConvexQuery(...args)
    }
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
vi.stubGlobal('generateCompletionStream', vi.fn())
vi.stubGlobal('setResponseHeader', vi.fn())
vi.stubGlobal('sendStream', vi.fn())
vi.stubGlobal('defineEventHandler', (handler: (...args: never[]) => unknown) => handler)
vi.stubGlobal('isAllowedModel', (await import('../../utils/models')).isAllowedModel)
vi.stubGlobal('SERVER_DEFAULT_MODEL', (await import('../../utils/models')).SERVER_DEFAULT_MODEL)

const handler = (await import('./chat.post')).default
const mockEvent = {} as any

describe('POST /api/rag/chat — folderId enforcement (AC #1)', () => {
  beforeEach(() => {
    vi.mocked(globalThis.useRuntimeConfig).mockReturnValue({
      public: { convex: { url: 'https://convex.example' } },
    })
    vi.mocked(globalThis.readBody).mockReset()
    vi.mocked(globalThis.searchDocuments).mockReset()
    vi.mocked(globalThis.fetchFolderDocs).mockReset()
    vi.mocked(globalThis.fetchFolderDocs).mockResolvedValue([])
    vi.mocked(globalThis.generateCompletion).mockReset()
    mockConvexQuery.mockReset()
  })

  test('[P0] should return 400 when folderId is missing from request body', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({
      query: 'What is photosynthesis?',
      model: 'openai/gpt-4o-mini',
    })

    const error = await (handler(mockEvent) as Promise<any>).catch((e: any) => e)
    expect(error.statusCode).toBe(400)
    expect(error.message).toContain('folderId')
  })

  test('[P0] should pass folderId in searchDocuments filters when provided', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({
      query: 'What is photosynthesis?',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_abc123',
    })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [{ id: '1', content: 'test content', score: 0.9, attributes: { filename: 'bio.pdf' } }],
    })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue({
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
    vi.mocked(globalThis.readBody).mockResolvedValue({
      query: 'Explain mitosis',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_xyz789',
    })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue({
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
    vi.mocked(globalThis.readBody).mockResolvedValue({
      query: 'What is DNA?',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_bio101',
    })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [
        { id: '1', content: 'DNA is a molecule', score: 0.95, attributes: { filename: 'genetics.pdf', userId: 'u1' } },
        { id: '2', content: 'Double helix structure', score: 0.87, attributes: { filename: 'biology.pdf', userId: 'u1' } },
      ],
    })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue({
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

  test('[P1] should instruct the model to use only numeric inline citations', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({
      query: 'What is DNA?',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_bio101',
    })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue({
      choices: [{ message: { content: 'DNA stores genetic information [1].' } }],
      model: 'openai/gpt-4o-mini',
      usage: {},
    })

    await handler(mockEvent)

    const params = vi.mocked(globalThis.generateCompletion).mock.calls[0][0]
    expect(params.messages[0].content).toContain('Use only the [N] format for citations.')
    expect(params.messages[0].content).toContain('Do not write citations as (Source 1), Source 1, or [Source 1: filename].')
    expect(params.messages[0].content).toContain('Do not include a trailing "References" or "Sources" section in the answer.')
  })

  test('[P0] should return fallback folder docs as sources when chunk search is empty', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({
      query: 'Summarize this folder',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_bio101',
    })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.fetchFolderDocs).mockResolvedValue([
      {
        key: 'user/folder/doc-1.txt',
        documentId: 'doc-1',
        filename: 'chapter-1.pdf',
        content: 'Chapter one summary content',
      },
      {
        key: 'user/folder/doc-2.txt',
        documentId: 'doc-2',
        filename: 'chapter-2.pdf',
        content: 'Chapter two summary content',
      },
    ])
    vi.mocked(globalThis.generateCompletion).mockResolvedValue({
      choices: [{ message: { content: 'Summary [1] [2]' } }],
      model: 'openai/gpt-4o-mini',
      usage: {},
    })

    const result = await handler(mockEvent)

    expect(result.sources).toHaveLength(2)
    expect(result.sources[0]).toEqual(
      expect.objectContaining({
        content: 'Chapter one summary content',
        score: 1,
      }),
    )
    expect(result.sources[0].attributes.filename).toBe('chapter-1.pdf')
    expect(result.sources[1].attributes.documentId).toBe('doc-2')
  })

  test('[P1] should continue with chunk context when folder-doc fallback throws', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({
      query: 'Summarize this folder',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_bio101',
    })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [
        {
          id: '1',
          content: 'Indexed chunk content',
          score: 0.93,
          attributes: { filename: 'chapter-1.pdf', userId: 'u1' },
        },
      ],
    })
    vi.mocked(globalThis.fetchFolderDocs).mockRejectedValue(new Error('R2 unavailable'))
    vi.mocked(globalThis.generateCompletion).mockResolvedValue({
      choices: [{ message: { content: 'Summary [1]' } }],
      model: 'openai/gpt-4o-mini',
      usage: {},
    })

    const result = await handler(mockEvent)

    expect(result.answer).toBe('Summary [1]')
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0].content).toBe('Indexed chunk content')
  })

  test('[P0] should keep scoped chats search-first and only load selected docs when scoped search is poor', async () => {
    const scopedEvent = {
      context: { convexToken: 'convex-test-token' },
    } as any

    vi.mocked(globalThis.readBody).mockResolvedValue({
      query: 'Summarize the selected docs',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_root',
      scope: {
        folderIds: ['folder_child'],
        fileIds: ['doc_child'],
      },
    })
    mockConvexQuery.mockResolvedValue({
      documentIds: ['doc_child'],
      documents: [
        {
          id: 'doc_child',
          folderId: 'folder_child',
          filename: 'child.pdf',
          r2Key: 'user/folder_child/doc_child.txt',
        },
      ],
      ownedFolderIds: ['folder_child'],
    })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [],
    })
    vi.mocked(globalThis.fetchFolderDocs).mockResolvedValue([
      {
        key: 'user/folder_child/doc_child.txt',
        documentId: 'doc_child',
        folderId: 'folder_child',
        filename: 'child.pdf',
        content: 'Selected doc fallback content',
      },
    ])
    vi.mocked(globalThis.generateCompletion).mockResolvedValue({
      choices: [{ message: { content: 'Scoped answer [1]' } }],
      model: 'openai/gpt-4o-mini',
      usage: {},
    })

    const result = await handler(scopedEvent)

    expect(globalThis.searchDocuments).toHaveBeenCalledWith(
      expect.not.objectContaining({ folderId: 'folder_root' }),
    )
    expect(globalThis.fetchFolderDocs).toHaveBeenCalledWith(
      expect.objectContaining({
        documents: [
          expect.objectContaining({
            documentId: 'doc_child',
            folderId: 'folder_child',
          }),
        ],
      }),
    )
    expect(result.sources[0].attributes.documentId).toBe('doc_child')
    expect(result.sources[0].content).toBe('Selected doc fallback content')
  })

  test('[P0] should not load selected docs when scoped search results are strong enough', async () => {
    const scopedEvent = {
      context: { convexToken: 'convex-test-token' },
    } as any

    vi.mocked(globalThis.readBody).mockResolvedValue({
      query: 'What does the selected doc say about mitosis?',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_root',
      scope: {
        fileIds: ['doc_child'],
      },
    })
    mockConvexQuery.mockResolvedValue({
      documentIds: ['doc_child'],
      documents: [
        {
          id: 'doc_child',
          folderId: 'folder_child',
          filename: 'child.pdf',
          r2Key: 'user/folder_child/doc_child.txt',
        },
      ],
      ownedFolderIds: [],
    })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [
        { id: '1', content: 'Chunk A', score: 0.91, attributes: { filename: 'child.pdf', documentId: 'doc_child' } },
        { id: '2', content: 'Chunk B', score: 0.88, attributes: { filename: 'child.pdf', documentId: 'doc_child' } },
        { id: '3', content: 'Chunk C', score: 0.84, attributes: { filename: 'child.pdf', documentId: 'doc_child' } },
      ],
    })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue({
      choices: [{ message: { content: 'Scoped chunk answer [1]' } }],
      model: 'openai/gpt-4o-mini',
      usage: {},
    })

    const result = await handler(scopedEvent)

    expect(globalThis.fetchFolderDocs).not.toHaveBeenCalled()
    expect(result.sources).toHaveLength(3)
    expect(result.sources[0].content).toBe('Chunk A')
  })

  test('[P0] should append raw context for selected files that search has not surfaced yet', async () => {
    const scopedEvent = {
      context: { convexToken: 'convex-test-token' },
    } as any

    vi.mocked(globalThis.readBody).mockResolvedValue({
      query: 'Compare the selected files',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_root',
      scope: {
        fileIds: ['doc_existing', 'doc_new'],
      },
    })
    mockConvexQuery.mockResolvedValue({
      documentIds: ['doc_existing', 'doc_new'],
      documents: [
        {
          id: 'doc_existing',
          folderId: 'folder_root',
          filename: 'existing.pdf',
          r2Key: 'user/folder_root/doc_existing.txt',
        },
        {
          id: 'doc_new',
          folderId: 'folder_root',
          filename: 'new-upload.pdf',
          r2Key: 'user/folder_root/doc_new.txt',
        },
      ],
      ownedFolderIds: [],
    })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [
        { id: '1', content: 'Existing chunk A', score: 0.91, attributes: { filename: 'existing.pdf', documentId: 'doc_existing' } },
        { id: '2', content: 'Existing chunk B', score: 0.88, attributes: { filename: 'existing.pdf', documentId: 'doc_existing' } },
        { id: '3', content: 'Existing chunk C', score: 0.84, attributes: { filename: 'existing.pdf', documentId: 'doc_existing' } },
      ],
    })
    vi.mocked(globalThis.fetchFolderDocs).mockResolvedValue([
      {
        key: 'user/folder_root/doc_new.txt',
        documentId: 'doc_new',
        folderId: 'folder_root',
        filename: 'new-upload.pdf',
        content: 'Fresh upload fallback content',
      },
    ])
    vi.mocked(globalThis.generateCompletion).mockResolvedValue({
      choices: [{ message: { content: 'Comparison [1] [4]' } }],
      model: 'openai/gpt-4o-mini',
      usage: {},
    })

    const result = await handler(scopedEvent)

    expect(globalThis.fetchFolderDocs).toHaveBeenCalledWith(
      expect.objectContaining({
        documents: [
          expect.objectContaining({
            documentId: 'doc_new',
            folderId: 'folder_root',
          }),
        ],
      }),
    )
    expect(result.sources).toHaveLength(4)
    expect(result.sources[3].attributes.documentId).toBe('doc_new')
    expect(result.sources[3].content).toBe('Fresh upload fallback content')
  })
})

describe('POST /api/rag/chat — streaming (AC #1, #2)', () => {
  beforeEach(() => {
    vi.mocked(globalThis.readBody).mockReset()
    vi.mocked(globalThis.searchDocuments).mockReset()
    vi.mocked(globalThis.fetchFolderDocs).mockReset()
    vi.mocked(globalThis.fetchFolderDocs).mockResolvedValue([])
    vi.mocked(globalThis.generateCompletion).mockReset()
    vi.mocked(globalThis.generateCompletionStream).mockReset()
    vi.mocked(globalThis.setResponseHeader).mockReset()
    vi.mocked(globalThis.sendStream).mockReset()
  })

  test('[P0] should call generateCompletionStream when stream: true', async () => {
    const mockStream = new ReadableStream({
      start(controller) { controller.close() },
    })
    vi.mocked(globalThis.readBody).mockResolvedValue({
      query: 'What is photosynthesis?',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_abc',
      stream: true,
    })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.generateCompletionStream).mockResolvedValue(mockStream)
    vi.mocked(globalThis.sendStream).mockReturnValue(undefined)

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
    vi.mocked(globalThis.readBody).mockResolvedValue({
      query: 'Test',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_abc',
      stream: true,
    })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.generateCompletionStream).mockResolvedValue(mockStream)
    vi.mocked(globalThis.sendStream).mockReturnValue(undefined)

    await handler(mockEvent)

    expect(globalThis.setResponseHeader).toHaveBeenCalledWith(mockEvent, 'Content-Type', 'text/event-stream')
    expect(globalThis.setResponseHeader).toHaveBeenCalledWith(mockEvent, 'Cache-Control', 'no-cache')
    expect(globalThis.setResponseHeader).toHaveBeenCalledWith(mockEvent, 'Connection', 'keep-alive')
  })

  test('[P0] should call sendStream with the transformed stream', async () => {
    const mockStream = new ReadableStream({
      start(controller) { controller.close() },
    })
    vi.mocked(globalThis.readBody).mockResolvedValue({
      query: 'Test',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_abc',
      stream: true,
    })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.generateCompletionStream).mockResolvedValue(mockStream)
    vi.mocked(globalThis.sendStream).mockReturnValue(undefined)

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
    vi.mocked(globalThis.readBody).mockResolvedValue({
      query: 'What is DNA?',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_bio',
      stream: true,
    })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [
        { id: '1', content: 'DNA content', score: 0.9, attributes: { filename: 'bio.pdf' } },
      ],
    })
    vi.mocked(globalThis.generateCompletionStream).mockResolvedValue(mockStream)

    let capturedStream: ReadableStream | null = null
    vi.mocked(globalThis.sendStream).mockImplementation((_event: any, stream: ReadableStream) => {
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

  test('[P0] should emit fallback folder docs in the sources SSE event when chunk search is empty', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Summary"}}]}\n\n'))
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    vi.mocked(globalThis.readBody).mockResolvedValue({
      query: 'Summarize this folder',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_bio',
      stream: true,
    })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.fetchFolderDocs).mockResolvedValue([
      {
        key: 'user/folder/doc-1.txt',
        documentId: 'doc-1',
        filename: 'bio-notes.pdf',
        content: 'Fallback source content',
      },
    ])
    vi.mocked(globalThis.generateCompletionStream).mockResolvedValue(mockStream)

    let capturedStream: ReadableStream | null = null
    vi.mocked(globalThis.sendStream).mockImplementation((_event: any, stream: ReadableStream) => {
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
    expect(output).toContain('"content":"Fallback source content"')
    expect(output).toContain('"filename":"bio-notes.pdf"')
    expect(output).toContain('"documentId":"doc-1"')
  })
})

describe('POST /api/rag/chat — model validation (AC #4)', () => {
  beforeEach(() => {
    vi.mocked(globalThis.readBody).mockReset()
    vi.mocked(globalThis.searchDocuments).mockReset()
    vi.mocked(globalThis.fetchFolderDocs).mockReset()
    vi.mocked(globalThis.fetchFolderDocs).mockResolvedValue([])
    vi.mocked(globalThis.generateCompletion).mockReset()
    vi.mocked(globalThis.generateCompletionStream).mockReset()
    vi.mocked(globalThis.setResponseHeader).mockReset()
    vi.mocked(globalThis.sendStream).mockReset()
  })

  test('[P0] should pass valid model through unchanged', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({
      query: 'What is photosynthesis?',
      model: 'openai/gpt-4o-mini',
      folderId: 'folder_abc',
    })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue({
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
    vi.mocked(globalThis.readBody).mockResolvedValue({
      query: 'What is photosynthesis?',
      model: 'invalid/nonexistent-model',
      folderId: 'folder_abc',
    })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue({
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
    vi.mocked(globalThis.readBody).mockResolvedValue({
      query: 'Test',
      model: 'invalid/nonexistent-model',
      folderId: 'folder_abc',
      stream: true,
    })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.generateCompletionStream).mockResolvedValue(mockStream)

    let capturedStream: ReadableStream | null = null
    vi.mocked(globalThis.sendStream).mockImplementation((_event: any, stream: ReadableStream) => {
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
    vi.mocked(globalThis.readBody).mockResolvedValue({
      query: 'Explain mitosis',
      model: 'some/unknown-model-xyz',
      folderId: 'folder_bio',
    })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue({
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
