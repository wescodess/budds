import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockMutation = vi.fn()
const mockQuery = vi.fn()
const mockSetAuth = vi.fn()
const mockResolveTtsEngine = vi.fn(async () => 'aura-1')
const mockSynthesizeTurn = vi.fn(async () => new Uint8Array([1, 2, 3]))
const mockUpload = vi.fn()
const mockBuildClaimEntailmentPrompt = vi.fn()
const mockParseClaimEntailmentResponse = vi.fn()
const mockFetchPrivateR2Object = vi.fn()
const ORCHESTRATION_TOKEN = 'test-audio-overview-orchestration-token-0001'
const INTERJECTION_KEY = 'interjection_expected_key'

vi.stubGlobal('createError', (opts: { statusCode: number, message: string }) =>
  Object.assign(new Error(opts.message), { statusCode: opts.statusCode }),
)
vi.stubGlobal('getConvexTokenIdentifier', vi.fn(() => 'https://auth.example.com|interject_route'))
vi.stubGlobal('readBody', vi.fn())
vi.stubGlobal('getRequestHeader', vi.fn(() => undefined))
vi.stubGlobal('searchDocuments', vi.fn())
vi.stubGlobal('fetchFolderDocs', vi.fn())
vi.stubGlobal('generateCompletion', vi.fn())
vi.stubGlobal('defineEventHandler', (handler: Function) => handler)
vi.stubGlobal('useRuntimeConfig', vi.fn(() => ({
  public: { convex: { url: 'https://test.convex.cloud' } },
  audioOverviewWorkerToken: ORCHESTRATION_TOKEN,
})))

vi.mock('../../utils/r2-folder', () => ({
  fetchPrivateR2Object: mockFetchPrivateR2Object,
}))

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

vi.mock('../../utils/whisper-workers-ai', () => ({
  transcribeAudio: vi.fn(async () => ({ words: [], durationSec: 0 })),
}))

vi.mock('../../utils/audio-overview-grounding', () => ({
  CLAIM_ENTAILMENT_VERSION: 'claim-entailment.v1',
  buildClaimEntailmentPrompt: mockBuildClaimEntailmentPrompt,
  parseClaimEntailmentResponse: mockParseClaimEntailmentResponse,
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
    vi.mocked(globalThis.readBody).mockReset()
    vi.mocked(globalThis.getRequestHeader).mockReset().mockReturnValue(INTERJECTION_KEY)
    vi.mocked(globalThis.searchDocuments).mockReset()
    vi.mocked(globalThis.fetchFolderDocs).mockReset()
    vi.mocked(globalThis.generateCompletion).mockReset()
    mockBuildClaimEntailmentPrompt.mockReset().mockReturnValue([])
    mockParseClaimEntailmentResponse.mockReset().mockReturnValue({
      version: 'claim-entailment.v1',
      decisions: [
        { utteranceId: 'interjection:interjection_v2:utterance:0', claimIds: ['gravity-claim'], decision: 'entailed', reason: 'Directly stated.' },
        { utteranceId: 'interjection:interjection_v2:utterance:1', claimIds: ['orbit-claim'], decision: 'entailed', reason: 'Directly stated.' },
      ],
    })
    mockFetchPrivateR2Object.mockReset().mockResolvedValue(new Response(null, {
      status: 200,
      headers: {
        'content-length': '48044',
        'content-type': 'audio/wav',
        'etag': '"etag-v2"',
        'x-amz-meta-checksumsha256': 'a'.repeat(64),
        'x-amz-meta-durationms': '1000',
        'x-amz-meta-interjectionid': 'interjection_v2',
        'x-amz-meta-idempotencykey': INTERJECTION_KEY,
      },
    }))
  })

  test('[P0] legacy Audio Overview Ask fails closed without creating Dia or Aura work', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({
      overviewId: 'overview_1',
      insertedAfterTurnIndex: 0,
      question: 'What is ATP?',
      model: 'attacker/unbounded-model',
    })
    mockQuery.mockResolvedValueOnce(overview())
    const error = await (handler(makeEvent()) as Promise<any>).catch(reason => reason)

    expect(error.statusCode).toBe(409)
    expect(error.message).toMatch(/generate a new audio overview/i)
    expect(mockMutation).not.toHaveBeenCalled()
    expect(globalThis.searchDocuments).not.toHaveBeenCalled()
    expect(globalThis.generateCompletion).not.toHaveBeenCalled()
    expect(mockResolveTtsEngine).not.toHaveBeenCalled()
    expect(mockSynthesizeTurn).not.toHaveBeenCalled()
  })

  test('[P0] v2 uses only its frozen Source Manifest and the authenticated managed Worker renderer', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({
      overviewId: 'overview_v2',
      insertedAfterTurnIndex: 1,
      question: 'Why does it orbit?',
    })
    const workerFetch = vi.fn(async () => Response.json({
      duplicate: false,
      artifact: {
        objectKey: 'audio-overviews/jobs/job_v2/interjections/interjection_v2.wav',
        etag: 'etag-v2',
        checksumSha256: 'a'.repeat(64),
        byteLength: 48_044,
        contentType: 'audio/wav',
        durationMs: 1_000,
      },
    }, { status: 201 }))
    const event = {
      context: {
        convexToken: 'mock-jwt',
        cloudflare: { env: { AUDIO_OVERVIEW_WORKFLOW: { fetch: workerFetch } } },
      },
    }
    mockQuery
      .mockResolvedValueOnce({ _id: 'overview_v2', episodeId: 'episode_v2', title: 'Gravity', status: 'ready' })
      .mockResolvedValueOnce({ _id: 'interjection_v2', status: 'rendering' })
      .mockResolvedValueOnce({
        _id: 'interjection_v2',
        status: 'ready',
        insertedAfterTurnIndex: 1,
        model: 'gemini-2.5-flash',
        artifact: { artifactId: 'artifact_v2', durationMs: 1_000 },
        utterances: [
          { speaker: 'host_a', text: 'Gravity bends the path.', sourceIds: ['gravity-source'] },
          { speaker: 'host_b', text: 'So it keeps falling around the body.', sourceIds: ['orbits-source'] },
        ],
      })
    mockMutation
      .mockResolvedValueOnce({
        duplicate: false,
        interjectionId: 'interjection_v2',
        jobId: 'job_v2',
        status: 'reserved',
        sources: [
          { sourceId: 'gravity-source', documentId: 'doc_1', displayReference: 'Gravity', contentHash: 'a'.repeat(64), revision: `sha256:${'a'.repeat(64)}` },
          { sourceId: 'orbits-source', documentId: 'doc_2', displayReference: 'Orbits', contentHash: 'b'.repeat(64), revision: `sha256:${'b'.repeat(64)}` },
        ],
      })
      .mockResolvedValueOnce({ claimed: true, status: 'scripting' })
      .mockResolvedValueOnce({ duplicate: false, status: 'rendering' })
      .mockResolvedValueOnce({ claimed: true, status: 'rendering', claimedAt: 1 })
      .mockResolvedValueOnce({ duplicate: false, artifactId: 'artifact_v2' })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [
      { id: 'chunk_1', content: 'Gravity bends a moving path.', score: 1, attributes: { documentId: 'doc_1', contentHash: 'a'.repeat(64), sourceRevision: `sha256:${'a'.repeat(64)}` } },
      { id: 'chunk_2', content: 'An orbit is continuous free fall.', score: 1, attributes: { documentId: 'doc_2', contentHash: 'b'.repeat(64), sourceRevision: `sha256:${'b'.repeat(64)}` } },
      { id: 'escaped', content: 'Must not be used.', score: 1, attributes: { documentId: 'doc_other' } },
    ] })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue({ choices: [{ message: { content: JSON.stringify({
      utterances: [
        {
          speaker: 'host_a', text: 'Gravity bends the path.', claimId: 'gravity-claim', claimText: 'Gravity bends a moving path.',
          sourceIds: ['gravity-source'], evidenceQuotes: [{ sourceId: 'gravity-source', quote: 'Gravity bends a moving path.' }],
          emotionalIntent: 'helpful', deliveryIntent: 'warm',
        },
        {
          speaker: 'host_b', text: 'So it keeps falling around the body.', claimId: 'orbit-claim', claimText: 'An orbit is continuous free fall.',
          sourceIds: ['orbits-source'], evidenceQuotes: [{ sourceId: 'orbits-source', quote: 'An orbit is continuous free fall.' }],
          emotionalIntent: 'curious', deliveryIntent: 'clear',
        },
      ],
    }) } }] })

    const response = await handler(event)

    expect(globalThis.searchDocuments).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'https://auth.example.com|interject_route',
      filterDocIds: ['doc_1', 'doc_2'],
    }))
    expect(vi.mocked(globalThis.searchDocuments).mock.calls[0]![0]).not.toHaveProperty('folderId')
    expect(globalThis.fetchFolderDocs).not.toHaveBeenCalled()
    expect(globalThis.generateCompletion).toHaveBeenCalledTimes(2)
    expect(globalThis.generateCompletion).toHaveBeenNthCalledWith(2, expect.objectContaining({
      model: 'google/gemini-2.5-flash',
      temperature: 0,
      maxAttempts: 1,
    }))
    expect(mockBuildClaimEntailmentPrompt).toHaveBeenCalledWith([
      expect.objectContaining({
        utteranceId: 'interjection:interjection_v2:utterance:0',
        text: 'Gravity bends the path.',
        claims: [expect.objectContaining({ claimId: 'gravity-claim', text: 'Gravity bends a moving path.' })],
      }),
      expect.objectContaining({
        utteranceId: 'interjection:interjection_v2:utterance:1',
        text: 'So it keeps falling around the body.',
      }),
    ])
    expect(mockMutation).toHaveBeenNthCalledWith(3, expect.anything(), expect.objectContaining({
      orchestrationToken: ORCHESTRATION_TOKEN,
      utterances: [expect.objectContaining({
        claimId: 'gravity-claim',
        verification: expect.objectContaining({
          version: 'claim-entailment.v1',
          utteranceId: 'interjection:interjection_v2:utterance:0',
          decision: 'entailed',
        }),
      }), expect.anything()],
    }))
    expect(mockResolveTtsEngine).not.toHaveBeenCalled()
    expect(mockSynthesizeTurn).not.toHaveBeenCalled()
    expect(workerFetch).toHaveBeenCalledOnce()
    const workerRequest = workerFetch.mock.calls[0]![0]
    expect(workerRequest.headers.get('Authorization')).toBe(`Bearer ${ORCHESTRATION_TOKEN}`)
    expect(await workerRequest.json()).toMatchObject({ jobId: 'job_v2', interjectionId: 'interjection_v2' })
    expect(mockFetchPrivateR2Object).toHaveBeenCalledWith(
      'audio-overviews/jobs/job_v2/interjections/interjection_v2.wav',
      { method: 'HEAD' },
    )
    expect(mockFetchPrivateR2Object.mock.invocationCallOrder[0])
      .toBeLessThan(mockMutation.mock.invocationCallOrder[4]!)
    expect(response).toMatchObject({
      schemaVersion: 2,
      interjectionId: 'interjection_v2',
      artifactUrl: '/api/audio-overview/interjections/interjection_v2/media',
      totalDurationMs: 1_000,
    })
  })

  test.each([
    ['missing', new Response(null, { status: 404 })],
    ['mismatched', new Response(null, {
      status: 200,
      headers: {
        'content-length': '48044',
        'content-type': 'audio/wav',
        'etag': '"etag-v2"',
        'x-amz-meta-checksumsha256': 'b'.repeat(64),
        'x-amz-meta-durationms': '1000',
        'x-amz-meta-interjectionid': 'interjection_v2',
        'x-amz-meta-idempotencykey': INTERJECTION_KEY,
      },
    })],
  ])('[P0] does not publish a %s private-R2 artifact', async (_case, headResponse) => {
    vi.mocked(globalThis.readBody).mockResolvedValue({
      overviewId: 'overview_v2',
      insertedAfterTurnIndex: 1,
      question: 'Why does it orbit?',
    })
    const workerFetch = vi.fn(async () => Response.json({
      artifact: {
        objectKey: 'audio-overviews/jobs/job_v2/interjections/interjection_v2.wav',
        etag: 'etag-v2',
        checksumSha256: 'a'.repeat(64),
        byteLength: 48_044,
        contentType: 'audio/wav',
        durationMs: 1_000,
      },
    }, { status: 201 }))
    const event = {
      context: {
        convexToken: 'mock-jwt',
        cloudflare: { env: { AUDIO_OVERVIEW_WORKFLOW: { fetch: workerFetch } } },
      },
    }
    mockQuery
      .mockResolvedValueOnce({ _id: 'overview_v2', episodeId: 'episode_v2', title: 'Gravity', status: 'ready' })
      .mockResolvedValueOnce({ _id: 'interjection_v2', status: 'rendering' })
    mockMutation
      .mockResolvedValueOnce({
        interjectionId: 'interjection_v2',
        jobId: 'job_v2',
        status: 'reserved',
        sources: [{
          sourceId: 'gravity-source',
          documentId: 'doc_1',
          displayReference: 'Gravity',
          contentHash: 'a'.repeat(64),
          revision: `sha256:${'a'.repeat(64)}`,
        }],
      })
      .mockResolvedValueOnce({ claimed: true, status: 'scripting' })
      .mockResolvedValueOnce({ status: 'rendering' })
      .mockResolvedValueOnce({ claimed: true, status: 'rendering', claimedAt: 1 })
      .mockResolvedValueOnce({ status: 'failed' })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [{
      id: 'chunk_1',
      content: 'Gravity bends a moving path.',
      score: 1,
      attributes: {
        documentId: 'doc_1',
        contentHash: 'a'.repeat(64),
        sourceRevision: `sha256:${'a'.repeat(64)}`,
      },
    }] })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue({ choices: [{ message: { content: JSON.stringify({
      utterances: [
        {
          speaker: 'host_a', text: 'Gravity bends the path.', claimId: 'gravity-claim', claimText: 'Gravity bends a moving path.',
          sourceIds: ['gravity-source'], evidenceQuotes: [{ sourceId: 'gravity-source', quote: 'Gravity bends a moving path.' }],
          emotionalIntent: 'helpful', deliveryIntent: 'warm',
        },
        {
          speaker: 'host_b', text: 'It keeps falling.', claimId: 'orbit-claim', claimText: 'Gravity bends a moving path.',
          sourceIds: ['gravity-source'], evidenceQuotes: [{ sourceId: 'gravity-source', quote: 'Gravity bends a moving path.' }],
          emotionalIntent: 'curious', deliveryIntent: 'clear',
        },
      ],
    }) } }] })
    mockFetchPrivateR2Object.mockResolvedValueOnce(headResponse)

    await expect(handler(event)).rejects.toThrow(/private storage|does not match private storage/i)

    expect(mockMutation.mock.calls.some(([, args]) => args && 'artifact' in args)).toBe(false)
    expect(mockMutation.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({
      interjectionId: 'interjection_v2',
      orchestrationToken: ORCHESTRATION_TOKEN,
    }))
  })

  test('[P0] rejects unsupported facts in exact Interjection text before rendering', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({
      overviewId: 'overview_v2',
      insertedAfterTurnIndex: 1,
      question: 'How do cells store energy?',
    })
    const workerFetch = vi.fn()
    const event = {
      context: {
        convexToken: 'mock-jwt',
        cloudflare: { env: { AUDIO_OVERVIEW_WORKFLOW: { fetch: workerFetch } } },
      },
    }
    mockQuery.mockResolvedValueOnce({ _id: 'overview_v2', episodeId: 'episode_v2', title: 'Cells', status: 'ready' })
    mockMutation
      .mockResolvedValueOnce({
        interjectionId: 'interjection_v2',
        jobId: 'job_v2',
        status: 'reserved',
        sources: [{
          sourceId: 'cells-source',
          documentId: 'doc_1',
          displayReference: 'Cells',
          contentHash: 'a'.repeat(64),
          revision: `sha256:${'a'.repeat(64)}`,
        }],
      })
      .mockResolvedValueOnce({ claimed: true, status: 'scripting' })
      .mockResolvedValueOnce({ status: 'failed' })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [{
      id: 'chunk_1',
      content: 'Cells store energy.',
      score: 1,
      attributes: {
        documentId: 'doc_1',
        contentHash: 'a'.repeat(64),
        sourceRevision: `sha256:${'a'.repeat(64)}`,
      },
    }] })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue({ choices: [{ message: { content: JSON.stringify({
      utterances: [
        {
          speaker: 'host_a', text: 'Cells store energy in useful forms.', claimId: 'cell-energy', claimText: 'Cells store energy.',
          sourceIds: ['cells-source'], evidenceQuotes: [{ sourceId: 'cells-source', quote: 'Cells store energy.' }],
          emotionalIntent: 'helpful', deliveryIntent: 'warm',
        },
        {
          speaker: 'host_b', text: 'Cells store energy.', claimId: 'cell-energy-repeat', claimText: 'Cells store energy.',
          sourceIds: ['cells-source'], evidenceQuotes: [{ sourceId: 'cells-source', quote: 'Cells store energy.' }],
          emotionalIntent: 'curious', deliveryIntent: 'clear',
        },
      ],
    }) } }] })
    mockParseClaimEntailmentResponse.mockImplementationOnce((_raw, targets) => {
      expect(targets[0]).toMatchObject({
        text: 'Cells store energy in useful forms.',
        claims: [{ text: 'Cells store energy.' }],
      })
      throw new Error('A spoken Utterance is not semantically entailed by its frozen evidence')
    })

    await expect(handler(event)).rejects.toThrow(/not semantically entailed/i)

    expect(workerFetch).not.toHaveBeenCalled()
    expect(mockMutation.mock.calls.some(([, args]) => args && 'utterances' in args)).toBe(false)
  })

  test('[P0] v2 retry fails closed while rendering without a second paid Worker call', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({
      overviewId: 'overview_v2',
      insertedAfterTurnIndex: 1,
      question: 'Why does it orbit?',
    })
    vi.mocked(globalThis.getRequestHeader).mockReturnValueOnce('interjection-stable-retry-0001')
    const workerFetch = vi.fn()
    const event = {
      context: {
        convexToken: 'mock-jwt',
        cloudflare: { env: { AUDIO_OVERVIEW_WORKFLOW: { fetch: workerFetch } } },
      },
    }
    mockQuery
      .mockResolvedValueOnce({ _id: 'overview_v2', episodeId: 'episode_v2', title: 'Gravity', status: 'ready' })
      .mockResolvedValueOnce({ _id: 'interjection_v2', status: 'rendering', utterances: [] })
    mockMutation
      .mockResolvedValueOnce({
        duplicate: true,
        interjectionId: 'interjection_v2',
        jobId: 'job_v2',
        status: 'rendering',
        sources: [{ sourceId: 'gravity-source', documentId: 'doc_1', displayReference: 'Gravity', contentHash: 'a'.repeat(64), revision: `sha256:${'a'.repeat(64)}` }],
      })
      .mockResolvedValueOnce({ claimed: false, status: 'rendering' })

    const error = await (handler(event) as Promise<any>).catch(reason => reason)

    expect(error).toMatchObject({ statusCode: 409 })
    expect(globalThis.searchDocuments).not.toHaveBeenCalled()
    expect(globalThis.generateCompletion).not.toHaveBeenCalled()
    expect(workerFetch).not.toHaveBeenCalled()
  })

  test('[P0] v2 rejects legacy AI Search chunks without frozen revision metadata', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({
      overviewId: 'overview_v2',
      insertedAfterTurnIndex: 1,
      question: 'Why does it orbit?',
    })
    mockQuery.mockResolvedValueOnce({
      _id: 'overview_v2',
      episodeId: 'episode_v2',
      title: 'Gravity',
      status: 'ready',
    })
    mockMutation
      .mockResolvedValueOnce({
        interjectionId: 'interjection_v2',
        jobId: 'job_v2',
        status: 'reserved',
        sources: [{
          sourceId: 'gravity-source',
          documentId: 'doc_1',
          displayReference: 'Gravity',
          contentHash: 'a'.repeat(64),
          revision: `sha256:${'a'.repeat(64)}`,
        }],
      })
      .mockResolvedValueOnce({ claimed: true, status: 'scripting' })
      .mockResolvedValueOnce({ status: 'failed' })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [{
      id: 'legacy-chunk',
      content: 'Unversioned evidence must never reach scripting.',
      score: 1,
      attributes: { documentId: 'doc_1' },
    }] })

    await expect(handler(makeEvent())).rejects.toMatchObject({
      statusCode: 503,
      message: 'Search index unavailable',
    })
    expect(globalThis.generateCompletion).not.toHaveBeenCalled()
    expect(mockMutation.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({
      orchestrationToken: ORCHESTRATION_TOKEN,
    }))
  })

  test('[P0] ambiguous Worker transport failure is terminal and deletes the deterministic object key', async () => {
    vi.mocked(globalThis.readBody).mockResolvedValue({
      overviewId: 'overview_v2',
      insertedAfterTurnIndex: 1,
      question: 'Why does it orbit?',
    })
    const workerFetch = vi.fn(async (request: Request) => {
      if (request.method === 'POST') throw new Error('connection reset after upload')
      return Response.json({ deleted: true })
    })
    const event = {
      context: {
        convexToken: 'mock-jwt',
        cloudflare: { env: { AUDIO_OVERVIEW_WORKFLOW: { fetch: workerFetch } } },
      },
    }
    mockQuery.mockResolvedValueOnce({ _id: 'overview_v2', episodeId: 'episode_v2', title: 'Gravity', status: 'ready' })
    mockMutation
      .mockResolvedValueOnce({
        duplicate: false,
        interjectionId: 'interjection_v2',
        jobId: 'job_v2',
        status: 'reserved',
        sources: [{ sourceId: 'gravity-source', documentId: 'doc_1', displayReference: 'Gravity', contentHash: 'a'.repeat(64), revision: `sha256:${'a'.repeat(64)}` }],
      })
      .mockResolvedValueOnce({ claimed: true, status: 'scripting' })
      .mockResolvedValueOnce({ duplicate: false, status: 'rendering' })
      .mockResolvedValueOnce({ claimed: true, status: 'rendering', claimedAt: 1 })
      .mockResolvedValueOnce({ duplicate: false, status: 'failed' })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [
      { id: 'chunk_1', content: 'Gravity bends a moving path.', score: 1, attributes: { documentId: 'doc_1', contentHash: 'a'.repeat(64), sourceRevision: `sha256:${'a'.repeat(64)}` } },
    ] })
    vi.mocked(globalThis.generateCompletion).mockResolvedValue({ choices: [{ message: { content: JSON.stringify({
      utterances: [
        {
          speaker: 'host_a', text: 'Gravity bends the path.', claimId: 'gravity-claim', claimText: 'Gravity bends a moving path.',
          sourceIds: ['gravity-source'], evidenceQuotes: [{ sourceId: 'gravity-source', quote: 'Gravity bends a moving path.' }],
          emotionalIntent: 'helpful', deliveryIntent: 'warm',
        },
        {
          speaker: 'host_b', text: 'So it keeps falling.', claimId: 'orbit-claim', claimText: 'Gravity bends a moving path.',
          sourceIds: ['gravity-source'], evidenceQuotes: [{ sourceId: 'gravity-source', quote: 'Gravity bends a moving path.' }],
          emotionalIntent: 'curious', deliveryIntent: 'clear',
        },
      ],
    }) } }] })

    await expect(handler(event)).rejects.toThrow(/connection reset/)

    expect(workerFetch).toHaveBeenCalledTimes(2)
    expect(workerFetch.mock.calls.map(call => call[0].method)).toEqual(['POST', 'DELETE'])
    const deletePayload = await workerFetch.mock.calls[1]![0].json()
    expect(deletePayload).toMatchObject({ jobId: 'job_v2', interjectionId: 'interjection_v2' })
    expect(mockMutation).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      interjectionId: 'interjection_v2',
      error: 'connection reset after upload',
    }))
  })
})
