import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockMutation = vi.fn()
const mockQuery = vi.fn()
const mockSetAuth = vi.fn()
const mockResolveTtsEngine = vi.fn(async () => 'aura-1')

vi.stubGlobal('createError', (opts: { statusCode: number, message: string }) =>
  Object.assign(new Error(opts.message), { statusCode: opts.statusCode }),
)
vi.stubGlobal('getConvexTokenIdentifier', vi.fn(() => 'https://auth.example.com|audio_route'))
vi.stubGlobal('readBody', vi.fn())
vi.stubGlobal('searchDocuments', vi.fn())
vi.stubGlobal('fetchFolderDocs', vi.fn(async () => []))
vi.stubGlobal('assertSearchIndexAvailable', vi.fn(async () => undefined))
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
  synthesizeTurn: vi.fn(),
  synthesizeDialogue: vi.fn(),
  engineVoiceProfile: vi.fn(),
}))

vi.mock('../../utils/audio-overview-upload', () => ({
  uploadAudioOverviewBytes: vi.fn(),
}))

const handler = (await import('./generate.post')).default as Function

function makeEvent() {
  return { context: { convexToken: 'mock-jwt' } }
}

function claimedRequest() {
  return {
    folderId: 'folder_owned',
    scope: { mode: 'explicit', documentIds: ['doc_owned'] },
    documents: [{
      documentId: 'doc_owned',
      folderId: 'folder_source',
      filename: 'owned.txt',
      r2Key: 'owner/folder_source/doc_owned.txt',
    }],
    preferences: { lengthMinutes: 5, complexity: 'expert' },
    voiceProfile: { hostA: 'asteria', hostB: 'orion' },
    model: 'google/gemini-2.5-flash',
    quotaDate: '2026-09-02',
  }
}

describe('POST /api/audio-overview/generate authority', () => {
  beforeEach(() => {
    mockMutation.mockReset()
    mockQuery.mockReset()
    mockQuery.mockResolvedValue({ status: 'running' })
    mockResolveTtsEngine.mockReset()
    mockResolveTtsEngine.mockResolvedValue('aura-1')
    vi.mocked(globalThis.readBody as any).mockReset()
    vi.mocked(globalThis.searchDocuments as any).mockReset()
    vi.mocked(globalThis.fetchFolderDocs as any).mockReset()
    vi.mocked(globalThis.assertSearchIndexAvailable as any).mockReset()
    vi.mocked(globalThis.assertSearchIndexAvailable as any).mockResolvedValue(undefined)
    vi.mocked(globalThis.generateCompletion as any).mockReset()
  })

  test('[P0] rejects a request without a reserved task before retrieval', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({ folderId: 'caller_folder' })

    const error = await (handler(makeEvent()) as Promise<any>).catch((reason: any) => reason)

    expect(error.statusCode).toBe(400)
    expect(error.message).toMatch(/taskId/i)
    expect(globalThis.searchDocuments).not.toHaveBeenCalled()
  })

  test('[P0] a rejected task claim produces no retrieval or provider side effect', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({ taskId: 'task_unreserved' })
    mockMutation.mockRejectedValueOnce(new Error('Audio overview generation is not available'))

    const error = await (handler(makeEvent()) as Promise<any>).catch((reason: any) => reason)

    expect(error.statusCode).toBe(409)
    expect(globalThis.searchDocuments).not.toHaveBeenCalled()
    expect(globalThis.generateCompletion).not.toHaveBeenCalled()
  })

  test('[P0] an empty frozen manifest fails before any cross-folder retrieval', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({ taskId: 'task_empty' })
    mockMutation
      .mockResolvedValueOnce({ ...claimedRequest(), scope: { mode: 'folder' }, documents: [] })
      .mockResolvedValueOnce(undefined)

    const error = await (handler(makeEvent()) as Promise<any>).catch((reason: any) => reason)

    expect(error.statusCode).toBe(422)
    expect(globalThis.searchDocuments).not.toHaveBeenCalled()
    expect(globalThis.fetchFolderDocs).not.toHaveBeenCalled()
    expect(globalThis.generateCompletion).not.toHaveBeenCalled()
  })

  test('[P0] explicit scope fallback receives only frozen document descriptors', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({
      taskId: 'task_reserved',
      folderId: 'caller_override',
      scopeDocIds: ['doc_attacker'],
    })
    mockMutation.mockResolvedValueOnce(claimedRequest()).mockResolvedValue(undefined)
    vi.mocked(globalThis.searchDocuments as any).mockRejectedValue(
      Object.assign(new Error('Search index unavailable'), { statusCode: 503 }),
    )
    vi.mocked(globalThis.fetchFolderDocs as any).mockResolvedValue([{
      key: 'owner/folder_source/doc_owned.txt',
      documentId: 'doc_owned',
      folderId: 'folder_source',
      filename: 'owned.txt',
      content: 'Only frozen content',
    }])
    vi.mocked(globalThis.generateCompletion as any).mockRejectedValue(new Error('stop after retrieval'))

    await expect(handler(makeEvent())).rejects.toThrow('stop after retrieval')

    expect(globalThis.fetchFolderDocs).toHaveBeenCalledWith({
      userId: 'https://auth.example.com|audio_route',
      documents: claimedRequest().documents,
      maxChars: 80_000,
    })
    expect(globalThis.fetchFolderDocs).not.toHaveBeenCalledWith(
      expect.objectContaining({ folderId: expect.anything() }),
    )
    expect(globalThis.assertSearchIndexAvailable).not.toHaveBeenCalled()
  })

  test('[P0] reports Search index unavailable before TTS when the frozen PDF scope has no vectors', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({ taskId: 'task_reserved' })
    mockMutation.mockResolvedValueOnce(claimedRequest()).mockResolvedValue(undefined)
    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.fetchFolderDocs as any).mockResolvedValue([])
    vi.mocked(globalThis.assertSearchIndexAvailable as any).mockRejectedValue(
      Object.assign(new Error('Search index unavailable'), { statusCode: 503 }),
    )

    const error = await (handler(makeEvent()) as Promise<any>).catch((reason: any) => reason)

    expect(error.statusCode).toBe(503)
    expect(error.message).toBe('Search index unavailable')
    expect(mockResolveTtsEngine).not.toHaveBeenCalled()
    expect(globalThis.generateCompletion).not.toHaveBeenCalled()
  })

  test('[P0] a terminal task produces no provider side effect after retrieval', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({ taskId: 'task_reserved' })
    mockMutation.mockResolvedValueOnce(claimedRequest()).mockResolvedValue(undefined)
    mockQuery.mockResolvedValueOnce({ status: 'failed' })
    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({
      data: [
        { id: 'one', content: 'First', score: 1, attributes: { documentId: 'doc_owned' } },
        { id: 'two', content: 'Second', score: 1, attributes: { documentId: 'doc_owned' } },
      ],
    })

    await expect(handler(makeEvent())).resolves.toEqual({
      cancelled: true,
      taskId: 'task_reserved',
    })
    expect(globalThis.generateCompletion).not.toHaveBeenCalled()
  })

  test('[P1] cancellation while the voice engine wakes prevents the LLM call', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({ taskId: 'task_reserved' })
    mockMutation.mockResolvedValueOnce(claimedRequest()).mockResolvedValue(undefined)
    mockQuery.mockResolvedValue({ status: 'running' })
    vi.mocked(globalThis.searchDocuments as any).mockResolvedValue({
      data: [
        { id: 'one', content: 'First', score: 1, attributes: { documentId: 'doc_owned' } },
        { id: 'two', content: 'Second', score: 1, attributes: { documentId: 'doc_owned' } },
      ],
    })
    let finishWakeup!: (engine: 'aura-1') => void
    mockResolveTtsEngine.mockImplementationOnce(() => new Promise((resolve) => {
      finishWakeup = resolve
    }))

    const request = handler(makeEvent()) as Promise<any>
    await vi.waitFor(() => expect(mockResolveTtsEngine).toHaveBeenCalledOnce())
    mockQuery.mockResolvedValue({ status: 'failed' })
    finishWakeup('aura-1')

    await expect(request).resolves.toEqual({ cancelled: true, taskId: 'task_reserved' })
    expect(globalThis.generateCompletion).not.toHaveBeenCalled()
  })
})
