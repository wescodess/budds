import { vi, describe, test, expect, beforeEach } from 'vitest'

const mockMutation = vi.fn()
const mockQuery = vi.fn()
const mockSetAuth = vi.fn()
const { mockResolveTtsEngine, mockSynthesizeTurn, mockSynthesizeDialogue, mockUploadAudio } = vi.hoisted(() => ({
  mockResolveTtsEngine: vi.fn(async () => 'aura-1'),
  mockSynthesizeTurn: vi.fn(async () => new Uint8Array([0xff, 0xfb])),
  mockSynthesizeDialogue: vi.fn(async () => ({
    audio: new Uint8Array([0xff, 0xfb]),
    durationMs: 5000,
  })),
  mockUploadAudio: vi.fn(),
}))

vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) =>
  Object.assign(new Error(opts.message), { statusCode: opts.statusCode }),
)
vi.stubGlobal('getConvexTokenIdentifier', vi.fn(() => 'https://auth.example.com|user_section_123'))
vi.stubGlobal('readBody', vi.fn())
vi.stubGlobal('searchDocuments', vi.fn())
vi.stubGlobal('generateCompletion', vi.fn())
vi.stubGlobal('defineEventHandler', (handler: (...args: never[]) => unknown) => handler)
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

vi.mock('../../utils/tts-provider', () => ({
  resolveTtsEngine: mockResolveTtsEngine,
  synthesizeTurn: mockSynthesizeTurn,
  synthesizeDialogue: mockSynthesizeDialogue,
  engineVoiceProfile: vi.fn(() => ({ hostA: 'asteria', hostB: 'orion' })),
}))

vi.mock('../../utils/audio-overview-upload', () => ({
  uploadAudioOverviewBytes: mockUploadAudio,
}))

const handler = (await import('./generate-section.post')).default

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
    vi.mocked(globalThis.readBody).mockReset()
    vi.mocked(globalThis.searchDocuments).mockReset()
    vi.mocked(globalThis.generateCompletion).mockReset()
    vi.mocked(globalThis.buildQuizPrompt).mockReturnValue([{ role: 'system', content: '' }])
    vi.mocked(globalThis.parseQuizResponse).mockReturnValue({ title: 'Quiz', questions: [] })
    vi.mocked(globalThis.buildFlashcardPrompt).mockReturnValue([{ role: 'system', content: '' }])
    vi.mocked(globalThis.parseFlashcardResponse).mockReturnValue({ title: 'Cards', cards: [] })
    mockMutation.mockReset()
    mockQuery.mockReset()
    mockSynthesizeTurn.mockClear()
    mockSynthesizeDialogue.mockClear()
    mockResolveTtsEngine.mockClear()
    mockUploadAudio.mockClear()
  })

  test('rejects missing courseId', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({})
    const err = await (handler(makeEvent()) as Promise<any>).catch((e: any) => e)
    expect(err.statusCode).toBe(400)
  })

  test('rejects missing sectionId', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({ courseId: 'course_123' })
    const err = await (handler(makeEvent()) as Promise<any>).catch((e: any) => e)
    expect(err.statusCode).toBe(400)
  })

  test('generates text content for section', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({
      courseId: 'course_123',
      sectionId: 'section_123',
    })

    mockQuery.mockImplementation((_ref: any, args: any) => {
      if (args?.id) return mockCourse()
      if (args?.courseId === 'course_123' && !args?.id) return [mockSection()]
      return []
    })

    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [{ id: '1', content: 'Test content', score: 0.9, attributes: { filename: 'test.pdf' } }],
    })

    vi.mocked(globalThis.generateCompletion).mockResolvedValue(
      textCompletionResponse('Generated text explanation about factual content.'),
    )

    mockMutation.mockResolvedValue({ status: 'ready', blockCount: 1 })

    const result = await handler(makeEvent())
    expect(result.status).toBe('ready')
    expect(mockMutation).toHaveBeenCalled()
  })

  test('factual knowledge type skips audio', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({
      courseId: 'course_123',
      sectionId: 'section_123',
    })

    mockQuery.mockImplementation((_ref: any, args: any) => {
      if (args?.id) return mockCourse()
      if (args?.courseId) return [mockSection({ knowledgeType: 'factual' })]
      return []
    })

    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [{ id: '1', content: 'Facts', score: 0.9, attributes: { filename: 'test.pdf' } }],
    })

    vi.mocked(globalThis.generateCompletion).mockResolvedValue(
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
    vi.mocked(globalThis.readBody).mockResolvedValue({
      courseId: 'course_123',
      sectionId: 'section_123',
    })

    mockQuery.mockImplementation((_ref: any, args: any) => {
      if (args?.id) return mockCourse()
      if (args?.courseId) return [mockSection()]
      return []
    })

    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.generateCompletion).mockRejectedValue(new Error('LLM down'))

    mockMutation.mockResolvedValue({ status: 'failed' })

    const result = await handler(makeEvent())
    expect(result.failedEngines).toContain('text explanation')
  })

  test('[P0] conceptual course primer fails closed with v2 guidance and no legacy audio side effect', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({
      courseId: 'course_123',
      sectionId: 'section_123',
    })
    mockQuery
      .mockResolvedValueOnce(mockCourse())
      .mockResolvedValueOnce([mockSection({ knowledgeType: 'conceptual' })])
      .mockResolvedValueOnce([{ folderId: 'folder_123', documentId: 'doc_1' }])
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [
        { id: '1', content: 'A', score: 0.9, attributes: { documentId: 'doc_1' } },
        { id: '2', content: 'B', score: 0.8, attributes: { documentId: 'doc_1' } },
        { id: '3', content: 'C', score: 0.7, attributes: { documentId: 'doc_1' } },
      ],
    })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue(
      textCompletionResponse('Generated content'),
    )
    mockMutation.mockResolvedValue({ status: 'ready', blockCount: 1 })

    const result = await handler(makeEvent())

    expect(result.failedEngines).toContain('audio primer')
    expect(result.audioPrimer).toEqual({
      status: 'requires-audio-overview-v2',
      message: 'Course audio primers must be generated through the durable Audio Overview workflow.',
    })
    expect(globalThis.searchDocuments).toHaveBeenCalledWith(expect.objectContaining({
      folderId: 'folder_123',
      filterDocIds: ['doc_1'],
    }))
    expect(globalThis.generateCompletion).toHaveBeenCalledTimes(3)
    expect(mockMutation.mock.calls.some(([, args]) => args?.scope || args?.turns || args?.voiceProfile)).toBe(false)
    expect(mockResolveTtsEngine).not.toHaveBeenCalled()
    expect(mockSynthesizeTurn).not.toHaveBeenCalled()
    expect(mockSynthesizeDialogue).not.toHaveBeenCalled()
    expect(mockUploadAudio).not.toHaveBeenCalled()
  })

  test('[P1] conceptual primer does not reserve or strand a legacy audio task', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({
      courseId: 'course_123',
      sectionId: 'section_123',
    })
    mockQuery
      .mockResolvedValueOnce(mockCourse())
      .mockResolvedValueOnce([mockSection({ knowledgeType: 'conceptual' })])
      .mockResolvedValueOnce([{ folderId: 'folder_123', documentId: 'doc_1' }])
      .mockResolvedValue({ _id: 'audio_task_1', status: 'running' })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [
        { id: '1', content: 'A', score: 0.9, attributes: { documentId: 'doc_1' } },
        { id: '2', content: 'B', score: 0.8, attributes: { documentId: 'doc_1' } },
        { id: '3', content: 'C', score: 0.7, attributes: { documentId: 'doc_1' } },
      ],
    })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue(
      textCompletionResponse('Not a valid audio script'),
    )
    mockMutation.mockImplementation((_ref: any, args: any) => {
      if (args?.scope) return { taskId: 'audio_task_1' }
      if (args?.sectionId) return { status: 'ready', blockCount: 1 }
      return undefined
    })

    const result = await handler(makeEvent())

    expect(result.audioPrimer?.status).toBe('requires-audio-overview-v2')
    expect(mockMutation.mock.calls.some(([, args]) => args?.scope || args?.voiceProfile || args?.turns)).toBe(false)
    expect(mockResolveTtsEngine).not.toHaveBeenCalled()
    expect(mockSynthesizeTurn).not.toHaveBeenCalled()
    expect(mockSynthesizeDialogue).not.toHaveBeenCalled()
    expect(mockUploadAudio).not.toHaveBeenCalled()
  })
})

describe('audio primer in section generation', () => {
  test('conceptual knowledge type exposes the durable Audio Overview migration notice', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({
      courseId: 'course_123',
      sectionId: 'section_123',
    })

    mockQuery.mockImplementation((_ref: any, args: any) => {
      if (args?.id) return mockCourse()
      if (args?.courseId === 'course_123' && !args?.id) {
        return [mockSection({ knowledgeType: 'conceptual' })]
      }
      return []
    })

    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [
        { id: '1', content: 'Conceptual content about reactions', score: 0.9, attributes: { filename: 'lecture-7.pdf', documentId: 'doc_1' } },
      ],
    })

    vi.mocked(globalThis.generateCompletion).mockResolvedValue(
      textCompletionResponse('Generated text for conceptual section.'),
    )

    mockMutation.mockResolvedValue({ status: 'ready', blockCount: 1 })

    const result = await handler(makeEvent())

    const finalizationCall = mockMutation.mock.calls.find(
      (c: any[]) => c[1]?.sectionId === 'section_123' && c[1]?.textContent,
    )
    expect(finalizationCall).toBeTruthy()
    expect(finalizationCall![1].audioEntityId).toBeUndefined()
    expect(result.audioPrimer?.message).toMatch(/durable Audio Overview workflow/i)
  })

  test('procedural knowledge type does not include audio', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({
      courseId: 'course_123',
      sectionId: 'section_123',
    })

    mockQuery.mockImplementation((_ref: any, args: any) => {
      if (args?.id) return mockCourse()
      if (args?.courseId) return [mockSection({ knowledgeType: 'procedural' })]
      return []
    })

    vi.mocked(globalThis.searchDocuments).mockResolvedValue({
      data: [{ id: '1', content: 'Steps', score: 0.9, attributes: { filename: 'test.pdf' } }],
    })

    vi.mocked(globalThis.generateCompletion).mockResolvedValue(
      textCompletionResponse('Procedural steps'),
    )

    mockMutation.mockResolvedValue({ status: 'ready', blockCount: 1 })

    await handler(makeEvent())

    const finalizationCall = mockMutation.mock.calls.find(
      (c: any[]) => c[1]?.sectionId === 'section_123',
    )
    expect(finalizationCall).toBeTruthy()
    expect(finalizationCall![1].audioEntityId).toBeUndefined()
  })
})

describe('audio-primer-prompt', () => {
  test('buildAudioPrimerPrompt returns correct message structure', async () => {
    const { buildAudioPrimerPrompt } = await import('../../utils/audio-primer-prompt')
    const messages = buildAudioPrimerPrompt(
      [{ id: '1', content: 'SN1 reactions overview', score: 0.9, attributes: { filename: 'lecture-7.pdf' } }],
      {
        sectionTitle: 'Reaction Mechanisms',
        courseTitle: 'Organic Chemistry',
        knowledgeType: 'conceptual',
      },
    )

    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
    expect(messages[0].content).toContain('SHORT audio primer')
    expect(messages[0].content).toContain('2-minute')
    expect(messages[0].content).toContain('Reference the user')
    expect(messages[1].content).toContain('Organic Chemistry')
    expect(messages[1].content).toContain('Reaction Mechanisms')
    expect(messages[1].content).toContain('lecture-7.pdf')
  })

  test('buildAudioPrimerPrompt targets 6-12 turns', async () => {
    const { buildAudioPrimerPrompt } = await import('../../utils/audio-primer-prompt')
    const messages = buildAudioPrimerPrompt(
      [{ id: '1', content: 'Some content', score: 0.9, attributes: {} }],
      {
        sectionTitle: 'Test',
        courseTitle: 'Course',
        knowledgeType: 'factual',
      },
    )

    expect(messages[0].content).toContain('6–12 turns')
  })

  test('buildAudioPrimerPrompt returns empty turns instruction when no chunks', async () => {
    const { buildAudioPrimerPrompt } = await import('../../utils/audio-primer-prompt')
    const messages = buildAudioPrimerPrompt([], {
      sectionTitle: 'Test',
      courseTitle: 'Course',
      knowledgeType: 'mixed',
    })

    expect(messages[1].content).toContain('no sources provided')
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
