import { vi, describe, test, expect, beforeEach } from 'vitest'
import { buildOutlinePrompt, parseOutlineResponse } from '../../utils/outline-prompt'

const mockMutation = vi.fn()
const mockQuery = vi.fn()
const mockSetAuth = vi.fn()

vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) =>
  Object.assign(new Error(opts.message), { statusCode: opts.statusCode }),
)
vi.stubGlobal('getConvexTokenIdentifier', vi.fn(() => 'https://auth.example.com|user_outline_123'))
vi.stubGlobal('readBody', vi.fn())
vi.stubGlobal('searchDocuments', vi.fn())
vi.stubGlobal('generateCompletion', vi.fn())
vi.stubGlobal('defineEventHandler', (handler: Function) => handler)
vi.stubGlobal('useRuntimeConfig', vi.fn(() => ({
  public: { convex: { url: 'https://test.convex.cloud' } },
})))
vi.stubGlobal('isAllowedModel', (await import('../../utils/models')).isAllowedModel)
vi.stubGlobal('SERVER_DEFAULT_MODEL', (await import('../../utils/models')).SERVER_DEFAULT_MODEL)

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

const handler = (await import('./generate-outline.post')).default as Function

function makeEvent(): any {
  return {
    context: { convexToken: 'mock-jwt-token' },
  }
}

function goodOutlineResponse() {
  return {
    choices: [{
      message: {
        content: JSON.stringify({
          sections: [
            { title: 'Introduction', description: 'Overview of the topic', knowledgeType: 'conceptual', order: 0 },
            { title: 'Core Concepts', description: 'Fundamental ideas', knowledgeType: 'conceptual', order: 1 },
            { title: 'Practical Application', description: 'Hands-on exercises', knowledgeType: 'procedural', order: 2 },
            { title: 'Key Terms', description: 'Important vocabulary', knowledgeType: 'factual', order: 3 },
            { title: 'Advanced Topics', description: 'Deeper exploration', knowledgeType: 'mixed', order: 4 },
          ],
        }),
      },
    }],
    model: 'openai/gpt-4o-mini',
    usage: {},
  }
}

describe('POST /api/course/generate-outline', () => {
  beforeEach(() => {
    vi.mocked(globalThis.readBody as any).mockReset()
    vi.mocked(globalThis.searchDocuments as any).mockReset()
    vi.mocked(globalThis.generateCompletion as any).mockReset()
    vi.mocked(globalThis.getConvexTokenIdentifier as any).mockReturnValue('https://auth.example.com|user_outline_123')
    mockMutation.mockReset()
    mockQuery.mockReset()
  })

  test('rejects missing courseId', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({})
    const err = await (handler(makeEvent()) as Promise<any>).catch((e: any) => e)
    expect(err.statusCode).toBe(400)
  })

  test('rejects when course not found', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({ courseId: 'abc123' })
    mockQuery.mockResolvedValue(null)
    const err = await (handler(makeEvent()) as Promise<any>).catch((e: any) => e)
    expect(err.statusCode).toBe(404)
  })

  test('happy path: doc-based outline generation', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      courseId: 'course_123',
      taskId: 'task_456',
    })

    mockQuery
      .mockResolvedValueOnce({
        _id: 'course_123',
        userId: 'https://auth.example.com|user_outline_123',
        title: 'Biology 101',
        sourceType: 'folder',
        status: 'generating',
        folderId: 'folder_1',
      })
      .mockResolvedValueOnce([
        { courseId: 'course_123', documentId: 'doc_1', folderId: 'folder_1', userId: 'user_1' },
        { courseId: 'course_123', documentId: 'doc_2', folderId: 'folder_1', userId: 'user_1' },
      ])

    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({
      data: [
        { id: '1', content: 'Cell biology basics', score: 0.9, attributes: { filename: 'cells.pdf' } },
        { id: '2', content: 'DNA and RNA structures', score: 0.8, attributes: { filename: 'genetics.pdf' } },
      ],
    })

    vi.mocked(globalThis.generateCompletion as any).mockResolvedValue(goodOutlineResponse())
    mockMutation.mockResolvedValue(undefined)

    const result = await handler(makeEvent())

    expect(result.courseId).toBe('course_123')
    expect(result.sectionCount).toBe(5)
    expect(result.sections).toHaveLength(5)

    const progressCalls = mockMutation.mock.calls
      .filter((c: any) => c[1]?.progress)
      .map((c: any) => c[1].progress)
    expect(progressCalls).toContain('Retrieving documents...')
    expect(progressCalls).toContain('Generating outline...')
    expect(progressCalls).toContain('Creating sections...')
  })

  test('happy path: web-only outline generation', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      courseId: 'course_web',
      taskId: 'task_789',
    })

    mockQuery.mockResolvedValueOnce({
      _id: 'course_web',
      userId: 'https://auth.example.com|user_outline_123',
      title: 'React Hooks',
      sourceType: 'web-only',
      status: 'generating',
    })

    vi.mocked(globalThis.generateCompletion as any).mockResolvedValue(goodOutlineResponse())
    mockMutation.mockResolvedValue(undefined)

    const result = await handler(makeEvent())

    expect(result.courseId).toBe('course_web')
    expect(result.sectionCount).toBe(5)
    expect(globalThis.searchDocuments).not.toHaveBeenCalled()
  })

  test('marks task and course as failed on LLM error', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      courseId: 'course_fail',
      taskId: 'task_fail',
    })

    mockQuery.mockResolvedValueOnce({
      _id: 'course_fail',
      userId: 'https://auth.example.com|user_outline_123',
      title: 'Broken Course',
      sourceType: 'web-only',
      status: 'generating',
    })

    vi.mocked(globalThis.generateCompletion as any).mockRejectedValue(
      Object.assign(new Error('AI Gateway error'), { statusCode: 500 }),
    )
    mockMutation.mockResolvedValue(undefined)

    const err = await (handler(makeEvent()) as Promise<any>).catch((e: any) => e)
    expect(err.statusCode).toBe(500)

    const failCalls = mockMutation.mock.calls.filter((c: any) => c[1]?.error)
    expect(failCalls.length).toBeGreaterThan(0)
  })

  test('marks course failed when outline produces no sections', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      courseId: 'course_empty',
      taskId: 'task_empty',
    })

    mockQuery.mockResolvedValueOnce({
      _id: 'course_empty',
      userId: 'https://auth.example.com|user_outline_123',
      title: 'Empty Course',
      sourceType: 'web-only',
      status: 'generating',
    })

    vi.mocked(globalThis.generateCompletion as any).mockResolvedValue({
      choices: [{ message: { content: '{}' } }],
      model: 'test',
      usage: {},
    })
    mockMutation.mockResolvedValue(undefined)

    const err = await (handler(makeEvent()) as Promise<any>).catch((e: any) => e)
    expect(err.statusCode).toBe(502)
  })

  test('rejects unauthenticated request', async () => {
    vi.mocked(globalThis.getConvexTokenIdentifier as any).mockImplementation(() => {
      throw Object.assign(new Error('Convex authentication token not available'), { statusCode: 401 })
    })
    vi.mocked(globalThis.readBody as any).mockResolvedValue({ courseId: 'abc' })

    const err = await (handler(makeEvent()) as Promise<any>).catch((e: any) => e)
    expect(err.statusCode).toBe(401)
  })
})

describe('buildOutlinePrompt', () => {
  test('produces system + user messages for doc-based course', () => {
    const messages = buildOutlinePrompt('Some content about cells', 'Biology 101', 'folder')
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('system')
    expect(messages[1]!.role).toBe('user')
    expect(messages[1]!.content).toContain('Biology 101')
    expect(messages[1]!.content).toContain('Some content about cells')
    expect(messages[1]!.content).toContain('source material')
  })

  test('produces web-only prompt without source content', () => {
    const messages = buildOutlinePrompt('', 'React Hooks', 'web-only')
    expect(messages).toHaveLength(2)
    expect(messages[1]!.content).toContain('React Hooks')
    expect(messages[1]!.content).toContain('using your knowledge')
  })
})

describe('parseOutlineResponse', () => {
  test('parses valid JSON response', () => {
    const input = JSON.stringify({
      sections: [
        { title: 'Intro', description: 'Overview', knowledgeType: 'conceptual', order: 0 },
        { title: 'Basics', description: 'Fundamentals', knowledgeType: 'factual', order: 1 },
        { title: 'Practice', description: 'Exercises', knowledgeType: 'procedural', order: 2 },
        { title: 'Mixed', description: 'Blend', knowledgeType: 'mixed', order: 3 },
        { title: 'Advanced', description: 'Deep dive', knowledgeType: 'conceptual', order: 4 },
      ],
    })
    const result = parseOutlineResponse(input)
    expect(result).toHaveLength(5)
    expect(result[0]!.title).toBe('Intro')
    expect(result[0]!.knowledgeType).toBe('conceptual')
  })

  test('handles markdown-fenced JSON', () => {
    const input = '```json\n{"sections": [{"title": "A", "description": "B", "knowledgeType": "factual", "order": 0}, {"title": "C", "description": "D", "knowledgeType": "mixed", "order": 1}, {"title": "E", "description": "F", "knowledgeType": "procedural", "order": 2}, {"title": "G", "description": "H", "knowledgeType": "conceptual", "order": 3}, {"title": "I", "description": "J", "knowledgeType": "factual", "order": 4}]}\n```'
    const result = parseOutlineResponse(input)
    expect(result).toHaveLength(5)
  })

  test('handles trailing commas', () => {
    const input = '{"sections": [{"title": "A", "description": "B", "knowledgeType": "factual", "order": 0,}, {"title": "C", "description": "D", "knowledgeType": "mixed", "order": 1,}, {"title": "E", "description": "F", "knowledgeType": "procedural", "order": 2,}, {"title": "G", "description": "H", "knowledgeType": "conceptual", "order": 3,}, {"title": "I", "description": "J", "knowledgeType": "factual", "order": 4,},]}'
    const result = parseOutlineResponse(input)
    expect(result).toHaveLength(5)
  })

  test('returns empty array for unparseable input', () => {
    expect(parseOutlineResponse('not json at all')).toEqual([])
  })

  test('returns empty for empty sections', () => {
    expect(parseOutlineResponse('{"sections": []}')).toEqual([])
  })

  test('skips invalid section entries', () => {
    const input = JSON.stringify({
      sections: [
        { title: 'Valid', description: 'Good', knowledgeType: 'factual', order: 0 },
        { title: '', description: 'Bad title', knowledgeType: 'factual', order: 1 },
        { title: 'Valid2', description: 'Good2', knowledgeType: 'factual', order: 2 },
        { title: 'Valid3', description: 'Good3', knowledgeType: 'conceptual', order: 3 },
        { title: 'Valid4', description: 'Good4', knowledgeType: 'procedural', order: 4 },
        { title: 'Valid5', description: 'Good5', knowledgeType: 'mixed', order: 5 },
      ],
    })
    const result = parseOutlineResponse(input)
    expect(result).toHaveLength(5)
    expect(result[1]!.title).toBe('Valid2')
  })

  test('clamps to 15 sections max', () => {
    const sections = Array.from({ length: 20 }, (_, i) => ({
      title: `Section ${i}`,
      description: `Desc ${i}`,
      knowledgeType: 'factual',
      order: i,
    }))
    const result = parseOutlineResponse(JSON.stringify({ sections }))
    expect(result).toHaveLength(15)
  })

  test('rejects invalid knowledgeType', () => {
    const input = JSON.stringify({
      sections: [
        { title: 'Bad', description: 'Invalid type', knowledgeType: 'unknown', order: 0 },
        { title: 'Good', description: 'Valid', knowledgeType: 'factual', order: 1 },
      ],
    })
    const result = parseOutlineResponse(input)
    expect(result).toHaveLength(1)
    expect(result[0]!.knowledgeType).toBe('factual')
  })
})
