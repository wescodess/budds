import { vi, describe, test, expect, beforeEach } from 'vitest'

const mockMutation = vi.fn()
const mockQuery = vi.fn()
const mockSetAuth = vi.fn()

vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) =>
  Object.assign(new Error(opts.message), { statusCode: opts.statusCode }),
)
vi.stubGlobal('getConvexTokenIdentifier', vi.fn(() => 'https://auth.example.com|user_section_123'))
vi.stubGlobal('readBody', vi.fn())
vi.stubGlobal('searchDocuments', vi.fn())
vi.stubGlobal('generateCompletion', vi.fn())
vi.stubGlobal('defineEventHandler', (handler: Function) => handler)
vi.stubGlobal('useRuntimeConfig', vi.fn(() => ({
  public: { convex: { url: 'https://test.convex.cloud' } },
})))
vi.stubGlobal('isAllowedModel', (await import('../../utils/models')).isAllowedModel)
vi.stubGlobal('SERVER_DEFAULT_MODEL', (await import('../../utils/models')).SERVER_DEFAULT_MODEL)
vi.stubGlobal('buildQuizPrompt', vi.fn(() => [{ role: 'system', content: '' }, { role: 'user', content: '' }]))
vi.stubGlobal('parseQuizResponse', vi.fn(() => ({ title: 'Quiz', questions: [] })))
vi.stubGlobal('buildFlashcardPrompt', vi.fn(() => [{ role: 'system', content: '' }, { role: 'user', content: '' }]))
vi.stubGlobal('parseFlashcardResponse', vi.fn(() => ({ title: 'Cards', cards: [] })))

vi.mock('convex/browser', () => {
  return {
    ConvexHttpClient: class MockConvexHttpClient {
      setAuth = mockSetAuth
      query = mockQuery
      mutation = mockMutation
    },
  }
})

vi.mock('../../utils/runtime-config', () => ({
  readConfiguredRuntimeValue: vi.fn((...args: any[]) => args[0] || args[1] || args[2]),
}))

vi.mock('../../utils/rate-limit', () => ({
  requireRateLimit: vi.fn(),
}))

const handler = (await import('./generate-section.post')).default as Function

function makeEvent(): any {
  return {
    context: { convexToken: 'mock-jwt-token' },
  }
}

function mockCourse(overrides: Record<string, any> = {}) {
  return {
    _id: 'course_123',
    userId: 'https://auth.example.com|user_section_123',
    folderId: 'folder_123',
    title: 'Test Course',
    status: 'ready',
    sourceType: 'folder',
    outlineSections: [
      { title: 'Section One', description: 'First topic', knowledgeType: 'factual', order: 0 },
    ],
    ...overrides,
  }
}

function mockSection(overrides: Record<string, any> = {}) {
  return {
    _id: 'section_123',
    courseId: 'course_123',
    userId: 'https://auth.example.com|user_section_123',
    order: 0,
    title: 'Section One',
    knowledgeType: 'factual',
    status: 'generating',
    contentBlocks: [],
    ...overrides,
  }
}

function textCompletionResponse(content: string) {
  return {
    choices: [{ message: { content } }],
    model: 'openai/gpt-4o-mini',
    usage: {},
  }
}

describe('POST /api/course/generate-section', () => {
  beforeEach(() => {
    vi.mocked(globalThis.readBody as any).mockReset()
    vi.mocked(globalThis.searchDocuments as any).mockReset()
    vi.mocked(globalThis.generateCompletion as any).mockReset()
    vi.mocked(globalThis.buildQuizPrompt as any).mockReturnValue([{ role: 'system', content: '' }])
    vi.mocked(globalThis.parseQuizResponse as any).mockReturnValue({ title: 'Quiz', questions: [] })
    vi.mocked(globalThis.buildFlashcardPrompt as any).mockReturnValue([{ role: 'system', content: '' }])
    vi.mocked(globalThis.parseFlashcardResponse as any).mockReturnValue({ title: 'Cards', cards: [] })
    mockMutation.mockReset()
    mockQuery.mockReset()
  })

  test('rejects missing courseId', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({})
    const err = await (handler(makeEvent()) as Promise<any>).catch((e: any) => e)
    expect(err.statusCode).toBe(400)
  })

  test('rejects missing sectionId', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({ courseId: 'course_123' })
    const err = await (handler(makeEvent()) as Promise<any>).catch((e: any) => e)
    expect(err.statusCode).toBe(400)
  })

  test('generates text content for section', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      courseId: 'course_123',
      sectionId: 'section_123',
    })

    mockQuery.mockImplementation((_ref: any, args: any) => {
      if (args?.id) return mockCourse()
      if (args?.courseId === 'course_123' && !args?.id) return [mockSection()]
      return []
    })

    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({
      data: [{ id: '1', content: 'Test content', score: 0.9, attributes: { filename: 'test.pdf' } }],
    })

    vi.mocked(globalThis.generateCompletion as any).mockResolvedValue(
      textCompletionResponse('Generated text explanation about factual content.'),
    )

    mockMutation.mockResolvedValue({ status: 'ready', blockCount: 1 })

    const result = await handler(makeEvent())
    expect(result.status).toBe('ready')
    expect(mockMutation).toHaveBeenCalled()
  })

  test('factual knowledge type skips audio', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      courseId: 'course_123',
      sectionId: 'section_123',
    })

    mockQuery.mockImplementation((_ref: any, args: any) => {
      if (args?.id) return mockCourse()
      if (args?.courseId) return [mockSection({ knowledgeType: 'factual' })]
      return []
    })

    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({
      data: [{ id: '1', content: 'Facts', score: 0.9, attributes: { filename: 'test.pdf' } }],
    })

    vi.mocked(globalThis.generateCompletion as any).mockResolvedValue(
      textCompletionResponse('Factual content'),
    )

    mockMutation.mockResolvedValue({ status: 'ready', blockCount: 1 })

    await handler(makeEvent())

    const finalizationCall = mockMutation.mock.calls.find(
      (c: any[]) => c[1]?.sectionId === 'section_123' && c[1]?.textContent,
    )
    expect(finalizationCall).toBeTruthy()
    expect(finalizationCall![1].audioEntityId).toBeUndefined()
  })

  test('handles all engine failures gracefully', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      courseId: 'course_123',
      sectionId: 'section_123',
    })

    mockQuery.mockImplementation((_ref: any, args: any) => {
      if (args?.id) return mockCourse()
      if (args?.courseId) return [mockSection()]
      return []
    })

    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.generateCompletion as any).mockRejectedValue(new Error('LLM down'))

    mockMutation.mockResolvedValue({ status: 'failed' })

    const result = await handler(makeEvent())
    expect(result.failedEngines).toContain('text explanation')
  })
})

describe('section-text-prompt', () => {
  test('buildSectionTextPrompt returns correct message structure', async () => {
    const { buildSectionTextPrompt } = await import('../../utils/section-text-prompt')
    const messages = buildSectionTextPrompt({
      sectionTitle: 'Reaction Mechanisms',
      sectionDescription: 'SN1 and SN2 reactions',
      knowledgeType: 'conceptual',
      sourceContent: 'Sample content about reactions',
      courseTitle: 'Organic Chemistry',
    })

    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
    expect(messages[0].content).toContain('Organic Chemistry')
    expect(messages[0].content).toContain('Reaction Mechanisms')
    expect(messages[0].content).toContain('analogies')
    expect(messages[1].content).toContain('Sample content')
  })

  test('factual knowledge type emphasizes definitions', async () => {
    const { buildSectionTextPrompt } = await import('../../utils/section-text-prompt')
    const messages = buildSectionTextPrompt({
      sectionTitle: 'Key Terms',
      sectionDescription: 'Important vocabulary',
      knowledgeType: 'factual',
      sourceContent: 'Facts here',
      courseTitle: 'Biology',
    })

    expect(messages[0].content).toContain('definition')
  })

  test('procedural knowledge type emphasizes steps', async () => {
    const { buildSectionTextPrompt } = await import('../../utils/section-text-prompt')
    const messages = buildSectionTextPrompt({
      sectionTitle: 'Lab Procedure',
      sectionDescription: 'How to perform titration',
      knowledgeType: 'procedural',
      sourceContent: 'Steps here',
      courseTitle: 'Chemistry',
    })

    expect(messages[0].content).toContain('step-by-step')
  })
})
