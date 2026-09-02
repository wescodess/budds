import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockMutation = vi.fn()
const mockQuery = vi.fn()
const mockSetAuth = vi.fn()
const mockResolveTtsEngine = vi.fn(async () => 'aura-1')
const mockSynthesizeTurn = vi.fn(async () => new Uint8Array([1, 2, 3]))
const mockUpload = vi.fn()

vi.stubGlobal('createError', (opts: { statusCode: number, message: string }) =>
  Object.assign(new Error(opts.message), { statusCode: opts.statusCode }),
)
vi.stubGlobal('getConvexTokenIdentifier', vi.fn(() => 'https://auth.example.com|interject_route'))
vi.stubGlobal('readBody', vi.fn())
vi.stubGlobal('searchDocuments', vi.fn())
vi.stubGlobal('fetchFolderDocs', vi.fn())
vi.stubGlobal('generateCompletion', vi.fn())
vi.stubGlobal('defineEventHandler', (handler: Function) => handler)
vi.stubGlobal('useRuntimeConfig', vi.fn(() => ({
  public: { convex: { url: 'https://test.convex.cloud' } },
})))

vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    setAuth = mockSetAuth
    mutation = mockMutation
    query = mockQuery
  },
}))

vi.mock('../../utils/runtime-config', () => ({
  readConfiguredRuntimeValue: vi.fn((...values: any[]) => values.find(Boolean)),
}))

vi.mock('../../utils/tts-provider', () => ({
  resolveTtsEngine: mockResolveTtsEngine,
  synthesizeTurn: mockSynthesizeTurn,
}))

vi.mock('../../utils/audio-overview-upload', () => ({
  uploadAudioOverviewBytes: mockUpload,
}))

const handler = (await import('./interject.post')).default as Function

function makeEvent() {
  return { context: { convexToken: 'mock-jwt' } }
}

function overview() {
  return {
    _id: 'overview_1',
    folderId: 'folder_1',
    title: 'Cells',
    status: 'ready',
    turns: [{ speaker: 'host_a', text: 'Intro', durationMs: 1000 }],
    scopeDocIds: ['doc_1'],
    voiceProfile: { hostA: 'asteria', hostB: 'orion' },
  }
}

describe('POST /api/audio-overview/interject authority', () => {
  beforeEach(() => {
    mockMutation.mockReset()
    mockQuery.mockReset()
    mockResolveTtsEngine.mockReset()
    mockResolveTtsEngine.mockResolvedValue('aura-1')
    mockSynthesizeTurn.mockClear()
    mockUpload.mockReset()
    vi.mocked(globalThis.readBody as any).mockReset()
    vi.mocked(globalThis.searchDocuments as any).mockReset()
    vi.mocked(globalThis.fetchFolderDocs as any).mockReset()
    vi.mocked(globalThis.generateCompletion as any).mockReset()
  })

  test('[P0] denied reservation produces no retrieval or provider side effect', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      overviewId: 'overview_1',
      insertedAfterTurnIndex: 0,
      question: 'What is ATP?',
      model: 'attacker/unbounded-model',
    })
    mockQuery.mockResolvedValueOnce(overview())
    mockMutation.mockRejectedValueOnce(new Error('Daily audio overview quota reached'))

    const error = await (handler(makeEvent()) as Promise<any>).catch(reason => reason)

    expect(error.statusCode).toBe(409)
    expect(globalThis.searchDocuments).not.toHaveBeenCalled()
    expect(globalThis.generateCompletion).not.toHaveBeenCalled()
    expect(mockResolveTtsEngine).not.toHaveBeenCalled()
    expect(mockSynthesizeTurn).not.toHaveBeenCalled()
  })

  test('[P0] freezes exact scope and ignores caller-selected model', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      overviewId: 'overview_1',
      insertedAfterTurnIndex: 0,
      question: 'What is ATP?',
      model: 'attacker/unbounded-model',
    })
    mockQuery.mockImplementation((_ref: any, args: any) => {
      if (args?.taskId) return { _id: args.taskId, status: 'running' }
      if (args?.id === 'overview_1') return overview()
      if (args?.id === 'interjection_1') return ['https://audio.example.com']
      return null
    })
    mockMutation
      .mockResolvedValueOnce({ taskId: 'task_1' })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ interjectionId: 'interjection_1' })
    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({
      data: [{ id: 'chunk_1', content: 'ATP stores energy.', score: 1, attributes: { documentId: 'doc_1' } }],
    })
    vi.mocked(globalThis.generateCompletion as any).mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ turns: [
        { speaker: 'host_a', text: 'ATP stores energy.', sourceIndex: 0 },
        { speaker: 'host_b', text: 'That makes sense.', sourceIndex: 0 },
      ] }) } }],
    })
    mockUpload
      .mockResolvedValueOnce({ audioFileId: 'storage_1', uploadClaimId: 'claim_1' })
      .mockResolvedValueOnce({ audioFileId: 'storage_2', uploadClaimId: 'claim_2' })

    await handler(makeEvent())

    expect(mockMutation).toHaveBeenNthCalledWith(1, expect.anything(), {
      folderId: 'folder_1',
      scope: { mode: 'explicit', documentIds: ['doc_1'] },
      preferences: { lengthMinutes: 5, complexity: 'beginner' },
      voiceProfile: { hostA: 'asteria', hostB: 'orion' },
    })
    expect(globalThis.generateCompletion).toHaveBeenCalledWith(expect.objectContaining({
      model: 'google/gemini-2.5-flash',
    }))
    expect(mockUpload).toHaveBeenCalledWith(expect.anything(), 'task_1', expect.anything(), expect.anything())
  })

  test('[P1] cancellation while Dia wakes prevents retrieval and LLM work', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      overviewId: 'overview_1',
      insertedAfterTurnIndex: 0,
      question: 'What is ATP?',
    })
    mockQuery.mockImplementation((_ref: any, args: any) => {
      if (args?.id === 'overview_1') {
        return { ...overview(), voiceProfile: { hostA: 'dia-speaker-1', hostB: 'dia-speaker-2' } }
      }
      if (args?.taskId) return { _id: args.taskId, status: 'failed' }
      return null
    })
    mockMutation.mockResolvedValueOnce({ taskId: 'task_1' }).mockResolvedValue(undefined)
    let finishWakeup!: (engine: 'aura-1') => void
    mockResolveTtsEngine.mockImplementationOnce(() => new Promise((resolve) => {
      finishWakeup = resolve
    }))

    const request = handler(makeEvent()) as Promise<any>
    await vi.waitFor(() => expect(mockResolveTtsEngine).toHaveBeenCalledOnce())
    finishWakeup('aura-1')

    const error = await request.catch(reason => reason)
    expect(error.statusCode).toBe(409)
    expect(globalThis.searchDocuments).not.toHaveBeenCalled()
    expect(globalThis.generateCompletion).not.toHaveBeenCalled()
  })
})
