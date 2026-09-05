import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockQuery = vi.fn()
const mockMutation = vi.fn()
const mockReadBody = vi.fn()
const mockSearchDocuments = vi.fn()
const mockFetchFolderDocs = vi.fn()
const mockAssertSearchIndexAvailable = vi.fn()
const mockGenerateCompletion = vi.fn()
const mockBuildDialoguePlanPrompt = vi.fn()
const mockBuildDialoguePlanDurationRepairPrompt = vi.fn()
const mockBuildDialoguePlanEntailmentRepairPrompt = vi.fn()
const mockBuildDialoguePlanEvidenceRepairPrompt = vi.fn()
const mockBuildDialoguePlanJsonSchema = vi.fn()
const mockCompactDialoguePlanDuration = vi.fn()
const mockParseDialoguePlanResponse = vi.fn()
const mockIsDialoguePlanDurationError = vi.fn()
const mockIsDialoguePlanEvidenceError = vi.fn()
const mockBuildClaimEntailmentPrompt = vi.fn()
const mockBuildClaimEntailmentJsonSchema = vi.fn()
const mockParseClaimEntailmentResponse = vi.fn()
const mockObjectIdentity = vi.fn()

vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
vi.stubGlobal('getRequestHeader', vi.fn(() => 'valid-job-capability'))
vi.stubGlobal('readBody', mockReadBody)
vi.stubGlobal('searchDocuments', mockSearchDocuments)
vi.stubGlobal('fetchFolderDocs', mockFetchFolderDocs)
vi.stubGlobal('assertSearchIndexAvailable', mockAssertSearchIndexAvailable)
vi.stubGlobal('generateCompletion', mockGenerateCompletion)
vi.stubGlobal('createError', (options: { statusCode: number, message: string }) =>
  Object.assign(new Error(options.message), { statusCode: options.statusCode }),
)
vi.stubGlobal('useRuntimeConfig', vi.fn(() => ({ public: { convex: { url: 'https://test.convex.cloud' } } })))

vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    query = mockQuery
    mutation = mockMutation
  },
}))

vi.mock('../../../utils/runtime-config', () => ({ readConfiguredRuntimeValue: vi.fn((...values: unknown[]) => values.find(Boolean)) }))
vi.mock('../../../utils/audio-overview-script', () => ({
  buildDialoguePlanDurationRepairPrompt: mockBuildDialoguePlanDurationRepairPrompt,
  buildDialoguePlanEntailmentRepairPrompt: mockBuildDialoguePlanEntailmentRepairPrompt,
  buildDialoguePlanEvidenceRepairPrompt: mockBuildDialoguePlanEvidenceRepairPrompt,
  buildDialoguePlanJsonSchema: mockBuildDialoguePlanJsonSchema,
  buildDialoguePlanPrompt: mockBuildDialoguePlanPrompt,
  compactDialoguePlanDuration: mockCompactDialoguePlanDuration,
  isDialoguePlanDurationError: mockIsDialoguePlanDurationError,
  isDialoguePlanEvidenceError: mockIsDialoguePlanEvidenceError,
  parseDialoguePlanResponse: mockParseDialoguePlanResponse,
}))
vi.mock('../../../utils/audio-overview-grounding', () => ({
  CLAIM_ENTAILMENT_VERSION: 'claim-entailment.v1',
  batchClaimEntailmentInputs: (inputs: unknown[]) => [inputs],
  buildClaimEntailmentJsonSchema: mockBuildClaimEntailmentJsonSchema,
  buildClaimEntailmentPrompt: mockBuildClaimEntailmentPrompt,
  parseClaimEntailmentResponse: mockParseClaimEntailmentResponse,
}))
vi.mock('../../../utils/r2-folder', () => ({
  getScopedR2ObjectIdentity: mockObjectIdentity,
  fetchPrivateR2Object: vi.fn(),
}))
vi.mock('../../../utils/whisper-workers-ai', () => ({ transcribeAudio: vi.fn() }))
vi.mock('../../../utils/audio-overview-alignment', () => ({ alignRecognizedWordsToScript: vi.fn() }))

const handler = (await import('./step.post')).default as (event: { context: Record<string, unknown> }) => Promise<Record<string, unknown>>

const sourceHash = 'a'.repeat(64)
function activeJobContext(preferences: { lengthMinutes: 5 | 10 | 20, complexity: 'beginner' | 'expert' } = { lengthMinutes: 5, complexity: 'beginner' }) {
  return {
    cancelled: false,
    job: { _id: 'job_1', userId: 'owner', status: 'accepted', stage: 'accepted', completedTurns: 0 },
    request: {
      documents: [{
        documentId: 'doc_1',
        folderId: 'folder_1',
        filename: 'source.pdf',
        r2Key: 'owner/source.pdf',
        contentHash: sourceHash,
        sourceRevision: `sha256:${sourceHash}`,
      }],
      preferences,
      voiceProfile: { hostA: 'asteria', hostB: 'orion' },
    },
  }
}

function dialoguePlan() {
  return {
    title: 'Grounded overview',
    outline: { learningObjectives: ['Understand cells'], narrativeArc: ['Begin', 'Connect'] , plannedSourceIds: ['doc_1'] },
    claims: [{ claimId: 'claim-1', text: 'Cells store energy.', status: 'supported', sourceIds: ['doc_1'], evidenceQuotes: [{ sourceId: 'doc_1', quote: 'Cells store energy.' }] }],
    scenes: [{
      sceneId: 'scene-1', title: 'Cells', emotionalIntent: 'wonder', delivery: 'warm and measured',
      utterances: [
        { speaker: 'host_a', text: 'Cells store energy in useful forms.', claimIds: ['claim-1'], sourceIds: ['doc_1'], emotionalIntent: 'warm', delivery: 'clear' },
        { speaker: 'host_b', text: 'How does that help the organism?', claimIds: ['claim-1'], sourceIds: ['doc_1'], emotionalIntent: 'curious', delivery: 'thoughtful' },
      ],
    }],
  }
}

describe('POST /api/audio-overview/jobs/step v2', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockMutation.mockReset()
    mockReadBody.mockReset().mockResolvedValue({ jobId: 'job_1', stage: 'prepare' })
    mockSearchDocuments.mockReset()
    mockFetchFolderDocs.mockReset().mockResolvedValue([])
    mockAssertSearchIndexAvailable.mockReset()
    mockGenerateCompletion.mockReset().mockResolvedValue({ choices: [{ message: { content: '{}' } }] })
    mockBuildDialoguePlanPrompt.mockReset().mockReturnValue([])
    mockBuildDialoguePlanDurationRepairPrompt.mockReset().mockReturnValue([])
    mockBuildDialoguePlanEntailmentRepairPrompt.mockReset().mockReturnValue([])
    mockBuildDialoguePlanEvidenceRepairPrompt.mockReset().mockReturnValue([])
    mockBuildDialoguePlanJsonSchema.mockReset().mockReturnValue({ type: 'object' })
    mockCompactDialoguePlanDuration.mockReset().mockReturnValue(dialoguePlan())
    mockParseDialoguePlanResponse.mockReset().mockReturnValue(dialoguePlan())
    mockIsDialoguePlanDurationError.mockReset().mockReturnValue(false)
    mockIsDialoguePlanEvidenceError.mockReset().mockReturnValue(false)
    mockBuildClaimEntailmentPrompt.mockReset().mockReturnValue([])
    mockBuildClaimEntailmentJsonSchema.mockReset().mockReturnValue({ type: 'object' })
    mockParseClaimEntailmentResponse.mockReset().mockReturnValue({
      version: 'claim-entailment.v1',
      decisions: [
        { utteranceId: 'scene:0:scene-1:utterance:0', claimIds: ['claim-1'], decision: 'entailed', reason: 'Directly stated.' },
        { utteranceId: 'scene:0:scene-1:utterance:1', claimIds: ['claim-1'], decision: 'entailed', reason: 'Directly stated.' },
      ],
    })
    mockObjectIdentity.mockReset().mockResolvedValue({
      key: 'owner/source.pdf', contentHash: sourceHash, revision: `sha256:${sourceHash}`, byteLength: 1024,
    })
  })

  test('[P0] reports an unavailable PDF search index before script or audio provider work', async () => {
    mockQuery.mockResolvedValueOnce(null).mockResolvedValueOnce(activeJobContext())
    mockMutation.mockResolvedValueOnce({ active: true })
    mockSearchDocuments.mockRejectedValue(Object.assign(new Error('Search index unavailable'), { statusCode: 503 }))

    await expect(handler({ context: {} })).resolves.toEqual({
      ok: false,
      retryable: false,
      message: 'Search index unavailable',
    })
    expect(mockGenerateCompletion).not.toHaveBeenCalled()
    expect(mockParseDialoguePlanResponse).not.toHaveBeenCalled()
  })

  test('[P0] releases a definitive invalid Dialogue response so the durable step can retry it', async () => {
    mockQuery
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeJobContext())
      .mockResolvedValueOnce(activeJobContext())
    mockMutation
      .mockResolvedValueOnce({ active: true })
      .mockResolvedValueOnce({ active: true })
      .mockResolvedValueOnce({ proceed: true, attemptId: 'attempt-1', attempt: 1 })
      .mockResolvedValueOnce({ released: true })
    mockSearchDocuments.mockResolvedValue({ data: [{
      id: 'chunk-1',
      content: 'grounded '.repeat(160),
      score: 1,
      attributes: {
        documentId: 'doc_1',
        filename: 'source.pdf',
        contentHash: sourceHash,
        sourceRevision: `sha256:${sourceHash}`,
      },
    }] })
    mockParseDialoguePlanResponse.mockImplementationOnce(() => {
      throw new Error('Dialogue Script response is not valid JSON')
    })

    await expect(handler({ context: {} })).resolves.toEqual({
      ok: false,
      retryable: true,
      message: 'Dialogue Script response is not valid JSON',
    })
    expect(mockMutation).toHaveBeenLastCalledWith(expect.anything(), {
      jobId: 'job_1',
      capability: 'valid-job-capability',
      attemptId: 'attempt-1',
    })
    expect(mockGenerateCompletion).toHaveBeenCalledWith(expect.objectContaining({
      jsonSchema: {
        name: 'audio_overview_dialogue_plan',
        strict: true,
        schema: { type: 'object' },
      },
      maxAttempts: 1,
      max_tokens: 12_000,
    }))
  })

  test('[P0] corrects a validated short Dialogue inside the bounded provider attempts', async () => {
    const shortPlan = dialoguePlan()
    const durationFailure = Object.assign(new Error('Dialogue Script duration is outside the requested tolerance'), {
      actualWords: 420,
      targetWords: 750,
      minimumWords: 563,
      maximumWords: 937,
      plan: shortPlan,
    })
    mockQuery
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeJobContext())
      .mockResolvedValueOnce(activeJobContext())
    mockMutation
      .mockResolvedValueOnce({ active: true })
      .mockResolvedValueOnce({ active: true })
      .mockResolvedValueOnce({ proceed: true, attemptId: 'attempt-1', attempt: 1 })
      .mockResolvedValueOnce({ released: true })
      .mockResolvedValueOnce({ proceed: true, attemptId: 'attempt-2', attempt: 2 })
      .mockResolvedValueOnce({ duplicate: false })
      .mockResolvedValueOnce({ active: true })
    mockSearchDocuments.mockResolvedValue({ data: [{
      id: 'chunk-1',
      content: 'grounded '.repeat(160),
      score: 1,
      attributes: {
        documentId: 'doc_1',
        filename: 'source.pdf',
        contentHash: sourceHash,
        sourceRevision: `sha256:${sourceHash}`,
      },
    }] })
    mockParseDialoguePlanResponse
      .mockImplementationOnce(() => { throw durationFailure })
      .mockReturnValueOnce(dialoguePlan())
    mockIsDialoguePlanDurationError.mockImplementation(error => error === durationFailure)

    await expect(handler({ context: {} })).resolves.toEqual({ ok: true, cancelled: false, sceneCount: 1 })

    expect(mockGenerateCompletion).toHaveBeenCalledTimes(3)
    expect(mockBuildDialoguePlanPrompt).toHaveBeenCalledTimes(1)
    expect(mockBuildDialoguePlanDurationRepairPrompt).toHaveBeenCalledWith(
      shortPlan,
      { lengthMinutes: 5, complexity: 'beginner' },
      420,
      1,
    )
    expect(mockMutation).toHaveBeenCalledWith(expect.anything(), {
      jobId: 'job_1',
      capability: 'valid-job-capability',
      attemptId: 'attempt-1',
    })
  })

  test('[P0] locally compacts a 1078-word Dialogue when all three bounded provider attempts stay over tolerance', async () => {
    const overlongPlan = dialoguePlan()
    const durationFailure = Object.assign(new Error('Dialogue Script duration is outside the requested tolerance (1078 spoken words; expected 563-937)'), {
      actualWords: 1078,
      targetWords: 750,
      minimumWords: 563,
      maximumWords: 937,
      plan: overlongPlan,
    })
    mockQuery
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeJobContext())
      .mockResolvedValueOnce(activeJobContext())
    mockMutation
      .mockResolvedValueOnce({ active: true })
      .mockResolvedValueOnce({ active: true })
      .mockResolvedValueOnce({ proceed: true, attemptId: 'attempt-1', attempt: 1 })
      .mockResolvedValueOnce({ released: true })
      .mockResolvedValueOnce({ proceed: true, attemptId: 'attempt-2', attempt: 2 })
      .mockResolvedValueOnce({ released: true })
      .mockResolvedValueOnce({ proceed: true, attemptId: 'attempt-3', attempt: 3 })
      .mockResolvedValueOnce({ duplicate: false })
      .mockResolvedValueOnce({ active: true })
    mockSearchDocuments.mockResolvedValue({ data: [{
      id: 'chunk-1',
      content: 'grounded '.repeat(160),
      score: 1,
      attributes: {
        documentId: 'doc_1',
        filename: 'source.pdf',
        contentHash: sourceHash,
        sourceRevision: `sha256:${sourceHash}`,
      },
    }] })
    mockParseDialoguePlanResponse
      .mockImplementationOnce(() => { throw durationFailure })
      .mockImplementationOnce(() => { throw durationFailure })
      .mockImplementationOnce(() => { throw durationFailure })
      .mockReturnValueOnce(dialoguePlan())
    mockIsDialoguePlanDurationError.mockImplementation(error => error === durationFailure)

    await expect(handler({ context: {} })).resolves.toEqual({ ok: true, cancelled: false, sceneCount: 1 })

    expect(mockCompactDialoguePlanDuration).toHaveBeenCalledWith(overlongPlan, {
      lengthMinutes: 5,
      complexity: 'beginner',
    })
    expect(mockMutation.mock.calls.filter(([, args]) => args?.attemptId)).toEqual([
      [expect.anything(), { jobId: 'job_1', capability: 'valid-job-capability', attemptId: 'attempt-1' }],
      [expect.anything(), { jobId: 'job_1', capability: 'valid-job-capability', attemptId: 'attempt-2' }],
    ])
    expect(mockGenerateCompletion).toHaveBeenCalledTimes(4)
  })

  test('[P0] corrects non-verbatim Claim Ledger evidence inside the bounded provider attempts', async () => {
    const invalidPlan = dialoguePlan()
    invalidPlan.claims[0]!.evidenceQuotes[0]!.quote = 'Cells retain usable power.'
    const evidenceFailure = Object.assign(new Error('Claim Ledger evidence quote is absent from the frozen Source Manifest'), {
      plan: invalidPlan,
      invalidEvidence: {
        claimId: 'claim-1',
        sourceId: 'doc_1',
        quote: 'Cells retain usable power.',
      },
    })
    mockQuery
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeJobContext())
      .mockResolvedValueOnce(activeJobContext())
    mockMutation
      .mockResolvedValueOnce({ active: true })
      .mockResolvedValueOnce({ active: true })
      .mockResolvedValueOnce({ proceed: true, attemptId: 'attempt-1', attempt: 1 })
      .mockResolvedValueOnce({ released: true })
      .mockResolvedValueOnce({ proceed: true, attemptId: 'attempt-2', attempt: 2 })
      .mockResolvedValueOnce({ duplicate: false })
      .mockResolvedValueOnce({ active: true })
    const groundedChunks = [{
      id: 'chunk-1',
      content: 'Cells store energy. '.repeat(80),
      score: 1,
      attributes: {
        documentId: 'doc_1',
        filename: 'source.pdf',
        contentHash: sourceHash,
        sourceRevision: `sha256:${sourceHash}`,
      },
    }]
    mockSearchDocuments.mockResolvedValue({ data: groundedChunks })
    mockParseDialoguePlanResponse
      .mockImplementationOnce(() => { throw evidenceFailure })
      .mockReturnValueOnce(dialoguePlan())
    mockIsDialoguePlanEvidenceError.mockImplementation(error => error === evidenceFailure)

    await expect(handler({ context: {} })).resolves.toEqual({ ok: true, cancelled: false, sceneCount: 1 })

    expect(mockGenerateCompletion).toHaveBeenCalledTimes(3)
    expect(mockBuildDialoguePlanEvidenceRepairPrompt).toHaveBeenCalledWith(
      invalidPlan,
      groundedChunks,
      evidenceFailure.invalidEvidence,
    )
    expect(mockMutation).toHaveBeenCalledWith(expect.anything(), {
      jobId: 'job_1',
      capability: 'valid-job-capability',
      attemptId: 'attempt-1',
    })
  })

  test('[P0] reports provider truncation explicitly and does not spend two more identical attempts', async () => {
    mockQuery
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeJobContext())
      .mockResolvedValueOnce(activeJobContext())
    mockMutation
      .mockResolvedValueOnce({ active: true })
      .mockResolvedValueOnce({ active: true })
      .mockResolvedValueOnce({ proceed: true, attemptId: 'attempt-1', attempt: 1 })
      .mockResolvedValueOnce({ released: true })
    mockSearchDocuments.mockResolvedValue({ data: [{
      id: 'chunk-1',
      content: 'grounded '.repeat(160),
      score: 1,
      attributes: {
        documentId: 'doc_1',
        filename: 'source.pdf',
        contentHash: sourceHash,
        sourceRevision: `sha256:${sourceHash}`,
      },
    }] })
    mockGenerateCompletion.mockResolvedValueOnce({
      choices: [{
        message: { content: '{"title":"cut off"' },
        finish_reason: 'length',
        native_finish_reason: 'MAX_TOKENS',
      }],
    })

    await expect(handler({ context: {} })).resolves.toEqual({
      ok: false,
      retryable: false,
      message: 'Dialogue Script exceeded the provider output limit',
    })
    expect(mockParseDialoguePlanResponse).not.toHaveBeenCalled()
    expect(mockMutation).toHaveBeenLastCalledWith(expect.anything(), {
      jobId: 'job_1',
      capability: 'valid-job-capability',
      attemptId: 'attempt-1',
    })
  })

  test('[P0] freezes the grounded v2 plan with the one production Gemini Audio Profile', async () => {
    mockQuery
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeJobContext())
      .mockResolvedValueOnce(activeJobContext())
    mockMutation
      .mockResolvedValueOnce({ active: true })
      .mockResolvedValueOnce({ active: true })
      .mockResolvedValueOnce({ proceed: true, attemptId: 'attempt-1' })
      .mockResolvedValueOnce({ duplicate: false })
      .mockResolvedValueOnce({ active: true })
    mockSearchDocuments.mockResolvedValue({
      data: [{
        id: 'chunk-1',
        content: 'grounded '.repeat(160),
        score: 1,
        attributes: {
          documentId: 'doc_1',
          filename: 'source.pdf',
          contentHash: sourceHash,
          sourceRevision: `sha256:${sourceHash}`,
        },
      }],
    })

    await expect(handler({ context: {} })).resolves.toEqual({ ok: true, cancelled: false, sceneCount: 1 })

    expect(mockMutation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      title: 'Grounded overview',
      model: 'google/gemini-2.5-flash',
      audioProfile: expect.objectContaining({
        id: 'budds-two-host-gemini-v1',
        renderer: 'gemini-native-multi-speaker',
        hostAVoice: 'Kore',
        hostBVoice: 'Puck',
      }),
      claims: [expect.objectContaining({
        claimId: 'claim-1',
        status: 'supported',
        sourceEntryOrders: [0],
        verification: {
          version: 'claim-entailment.v1',
          model: 'google/gemini-2.5-flash',
          decision: 'entailed',
          reason: 'Directly stated.',
        },
      })],
      scenes: [expect.objectContaining({
        sceneId: 'scene-1',
        utterances: [expect.objectContaining({
          text: 'Cells store energy in useful forms.',
          verification: expect.objectContaining({
            utteranceId: 'scene:0:scene-1:utterance:0',
            decision: 'entailed',
          }),
        }), expect.anything()],
      })],
    }))
    expect(mockGenerateCompletion).toHaveBeenCalledTimes(2)
    expect(mockGenerateCompletion).toHaveBeenNthCalledWith(2, expect.objectContaining({
      model: 'google/gemini-2.5-flash',
      temperature: 0,
      maxAttempts: 1,
    }))
    expect(mockParseClaimEntailmentResponse).toHaveBeenCalledWith(
      '{}',
      [
        expect.objectContaining({
          utteranceId: 'scene:0:scene-1:utterance:0',
          text: 'Cells store energy in useful forms.',
          claims: [expect.objectContaining({ claimId: 'claim-1', text: 'Cells store energy.' })],
        }),
        expect.objectContaining({ utteranceId: 'scene:0:scene-1:utterance:1' }),
      ],
    )
  })

  test('[P0] rejects exact spoken text that adds facts beyond its cited claim before freezing a renderable plan', async () => {
    mockQuery
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeJobContext())
      .mockResolvedValueOnce(activeJobContext())
    mockMutation
      .mockResolvedValueOnce({ active: true })
      .mockResolvedValueOnce({ active: true })
      .mockResolvedValueOnce({ proceed: true, attemptId: 'attempt-1' })
    mockSearchDocuments.mockResolvedValue({ data: [{
      id: 'chunk-1',
      content: 'grounded '.repeat(160),
      score: 1,
      attributes: {
        documentId: 'doc_1',
        filename: 'source.pdf',
        contentHash: sourceHash,
        sourceRevision: `sha256:${sourceHash}`,
      },
    }] })
    mockParseClaimEntailmentResponse.mockImplementationOnce((_raw, targets) => {
      expect(targets[0]).toMatchObject({
        text: 'Cells store energy in useful forms.',
        claims: [{ text: 'Cells store energy.' }],
      })
      throw new Error('A spoken Utterance is not semantically entailed by its frozen evidence')
    })

    await expect(handler({ context: {} })).resolves.toMatchObject({
      ok: false,
      retryable: false,
      message: 'A spoken Utterance is not semantically entailed by its frozen evidence',
    })
    expect(mockMutation.mock.calls.some(([, args]) => args && 'planFingerprint' in args)).toBe(false)
  })

  test('[P0] completes preparation with exact-evidence speech when all three model repairs remain unentailed', async () => {
    let scriptAttempt = 0
    const context = activeJobContext()
    context.request.documents.push({
      documentId: 'doc_2',
      folderId: 'folder_1',
      filename: 'feedback.pdf',
      r2Key: '',
      contentHash: sourceHash,
      sourceRevision: `sha256:${sourceHash}`,
    })
    const fallbackPlan = dialoguePlan()
    fallbackPlan.claims[0]!.text = 'Careful editing, including asking a friend for feedback, is crucial.'
    fallbackPlan.claims[0]!.sourceIds = ['doc_1', 'doc_2']
    fallbackPlan.claims[0]!.evidenceQuotes = [
      { sourceId: 'doc_1', quote: 'Careful editing is crucial.' },
      { sourceId: 'doc_2', quote: 'Careful editing, including asking a friend for feedback, is crucial.' },
    ]
    fallbackPlan.outline.plannedSourceIds = ['doc_1', 'doc_2']
    fallbackPlan.scenes[0]!.utterances[0]!.sourceIds = ['doc_1', 'doc_2']
    fallbackPlan.scenes[0]!.utterances[0]!.text = 'Careful editing is absolutely crucial.'
    mockQuery
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(context)
      .mockResolvedValueOnce(context)
    mockMutation.mockImplementation(async (_reference, args) => {
      if (args?.progress) return { active: true }
      if (args?.planFingerprint) return { duplicate: false }
      if (args?.attemptId) return { released: true }
      if (args?.kind === 'entailment-fallback') return { allowed: true, duplicate: false }
      scriptAttempt += 1
      return { proceed: true, attemptId: `attempt-${scriptAttempt}`, attempt: scriptAttempt }
    })
    mockSearchDocuments.mockResolvedValue({ data: [{
      id: 'chunk-1',
      content: 'Cells store energy. '.repeat(80),
      score: 1,
      attributes: {
        documentId: 'doc_1',
        filename: 'source.pdf',
        contentHash: sourceHash,
        sourceRevision: `sha256:${sourceHash}`,
      },
    }, {
      id: 'chunk-2',
      content: 'Careful editing, including asking a friend for feedback, is crucial. '.repeat(40),
      score: 1,
      attributes: {
        documentId: 'doc_2',
        filename: 'feedback.pdf',
        contentHash: sourceHash,
        sourceRevision: `sha256:${sourceHash}`,
      },
    }] })
    mockParseDialoguePlanResponse
      .mockReturnValueOnce(fallbackPlan)
      .mockReturnValueOnce(fallbackPlan)
      .mockReturnValueOnce(fallbackPlan)
      .mockImplementationOnce(raw => JSON.parse(raw))
    mockParseClaimEntailmentResponse
      .mockReturnValueOnce({
        version: 'claim-entailment.v1',
        decisions: [
          { utteranceId: 'scene:0:scene-1:utterance:0', claimIds: ['claim-1'], decision: 'not_entailed', reason: 'Adds useful forms.' },
          { utteranceId: 'scene:0:scene-1:utterance:1', claimIds: ['claim-1'], decision: 'entailed', reason: 'Supported.' },
        ],
      })
      .mockReturnValueOnce({
        version: 'claim-entailment.v1',
        decisions: [
          { utteranceId: 'scene:0:scene-1:utterance:0', claimIds: ['claim-1'], decision: 'not_entailed', reason: 'Still adds useful forms.' },
          { utteranceId: 'scene:0:scene-1:utterance:1', claimIds: ['claim-1'], decision: 'entailed', reason: 'Supported.' },
        ],
      })
      .mockReturnValueOnce({
        version: 'claim-entailment.v1',
        decisions: [
          { utteranceId: 'scene:0:scene-1:utterance:0', claimIds: ['claim-1'], decision: 'not_entailed', reason: 'Repair still overclaims.' },
          { utteranceId: 'scene:0:scene-1:utterance:1', claimIds: ['claim-1'], decision: 'entailed', reason: 'Supported.' },
        ],
      })
      .mockImplementationOnce((_raw, targets) => {
        expect(targets[0]).toMatchObject({
          utteranceId: 'scene:0:scene-1:utterance:0',
          text: 'Careful editing is crucial. Careful editing, including asking a friend for feedback, is crucial.',
        })
        return {
          version: 'claim-entailment.v1',
          decisions: [
            { utteranceId: 'scene:0:scene-1:utterance:0', claimIds: ['claim-1'], decision: 'entailed', reason: 'Exact frozen evidence.' },
            { utteranceId: 'scene:0:scene-1:utterance:1', claimIds: ['claim-1'], decision: 'entailed', reason: 'Supported.' },
          ],
        }
      })

    await expect(handler({ context: {} })).resolves.toEqual({ ok: true, cancelled: false, sceneCount: 1 })

    expect(mockBuildDialoguePlanEntailmentRepairPrompt).toHaveBeenCalledTimes(2)
    expect(mockGenerateCompletion).toHaveBeenCalledTimes(7)
    expect(mockMutation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      scenes: [expect.objectContaining({
        utterances: [expect.objectContaining({
          text: 'Careful editing is crucial. Careful editing, including asking a friend for feedback, is crucial.',
        }), expect.anything()],
      })],
    }))
  })

  test('[P0] scales grounded-material sufficiency with requested duration and complexity', async () => {
    const longExpertContext = activeJobContext({ lengthMinutes: 20, complexity: 'expert' })
    mockQuery.mockResolvedValueOnce(null).mockResolvedValueOnce(longExpertContext)
    mockMutation.mockResolvedValueOnce({ active: true })
    mockSearchDocuments.mockResolvedValue({
      data: [{
        id: 'thin-chunk',
        content: 'grounded '.repeat(500),
        score: 1,
        attributes: {
          documentId: 'doc_1',
          filename: 'source.pdf',
          contentHash: sourceHash,
          sourceRevision: `sha256:${sourceHash}`,
        },
      }],
    })

    await expect(handler({ context: {} })).resolves.toMatchObject({
      ok: false,
      retryable: false,
      message: 'Not enough indexed content for an audio overview',
    })
    expect(mockGenerateCompletion).not.toHaveBeenCalled()
  })

  test('[P0] rejects AI Search evidence from a different indexed source revision before script generation', async () => {
    mockQuery.mockResolvedValueOnce(null).mockResolvedValueOnce(activeJobContext())
    mockMutation.mockResolvedValueOnce({ active: true })
    mockSearchDocuments.mockResolvedValue({
      data: [{
        id: 'stale-chunk',
        content: 'stale evidence '.repeat(80),
        score: 1,
        attributes: {
          documentId: 'doc_1',
          filename: 'source.pdf',
          contentHash: 'b'.repeat(64),
          sourceRevision: `sha256:${'b'.repeat(64)}`,
        },
      }],
    })

    await expect(handler({ context: {} })).resolves.toMatchObject({
      ok: false,
      retryable: false,
      message: 'Search index unavailable',
    })
    expect(mockGenerateCompletion).not.toHaveBeenCalled()
  })

  test('[P0] rejects legacy AI Search evidence that has no immutable source identity', async () => {
    mockQuery.mockResolvedValueOnce(null).mockResolvedValueOnce(activeJobContext())
    mockMutation.mockResolvedValueOnce({ active: true })
    mockSearchDocuments.mockResolvedValue({
      data: [{
        id: 'legacy-chunk',
        content: 'unversioned evidence '.repeat(80),
        score: 1,
        attributes: { documentId: 'doc_1', filename: 'source.pdf' },
      }],
    })

    await expect(handler({ context: {} })).resolves.toMatchObject({
      ok: false,
      retryable: false,
      message: 'Search index unavailable',
    })
    expect(mockGenerateCompletion).not.toHaveBeenCalled()
  })

  test('[P0] rejects an R2 object that changed after source reservation before script generation', async () => {
    mockQuery.mockResolvedValueOnce(null).mockResolvedValueOnce(activeJobContext())
    mockMutation.mockResolvedValueOnce({ active: true })
    mockSearchDocuments.mockResolvedValue({ data: [] })
    mockObjectIdentity.mockResolvedValueOnce({
      key: 'owner/source.pdf',
      contentHash: 'b'.repeat(64),
      revision: `sha256:${'b'.repeat(64)}`,
      byteLength: 1024,
    })

    await expect(handler({ context: {} })).resolves.toMatchObject({
      ok: false,
      retryable: false,
      message: 'A selected source changed after command reservation',
    })
    expect(mockGenerateCompletion).not.toHaveBeenCalled()
  })

  test('[P0] stops before retrieval and paid generation when cancellation wins the progress CAS', async () => {
    mockQuery.mockResolvedValueOnce(null).mockResolvedValueOnce(activeJobContext())
    mockMutation.mockResolvedValueOnce({ active: false })

    await expect(handler({ context: {} })).resolves.toEqual({ ok: true, cancelled: true, sceneCount: 0 })
    expect(mockSearchDocuments).not.toHaveBeenCalled()
    expect(mockGenerateCompletion).not.toHaveBeenCalled()
  })

  test('[P0] returns normalized Scene context without rendering audio in Pages', async () => {
    mockReadBody.mockResolvedValueOnce({ jobId: 'job_1', stage: 'scene-context', sceneOrder: 0 })
    mockQuery
      .mockResolvedValueOnce(activeJobContext())
      .mockResolvedValueOnce({
        scenes: [{ _id: 'scene_db_1', order: 0, title: 'Cells', narrativePurpose: 'Open warmly.', targetDurationMs: 60_000 }],
        utterances: [
          { sceneId: 'scene_db_1', sceneOrder: 0, speaker: 'host_a', text: 'A', emotionalIntent: 'warm', deliveryIntent: 'clear' },
          { sceneId: 'scene_db_1', sceneOrder: 1, speaker: 'host_b', text: 'B', emotionalIntent: 'curious', deliveryIntent: 'natural' },
        ],
      })

    const result = await handler({ context: {} })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      scene: expect.objectContaining({ sceneId: 'scene_db_1', expectedDurationMs: 60_000 }),
    }))
    expect(mockGenerateCompletion).not.toHaveBeenCalled()
  })

  test('[P0] claims a bounded server-authoritative budget before a paid Scene render', async () => {
    mockReadBody.mockResolvedValueOnce({
      jobId: 'job_1',
      stage: 'claim-render',
      sceneOrder: 0,
      attempt: 2,
    })
    mockMutation.mockResolvedValueOnce({
      allowed: true,
      duplicate: false,
      amountMicrousd: 23_265,
      debitedMicrousd: 47_530,
      reservedMicrousd: 95_000,
    })

    await expect(handler({ context: {} })).resolves.toEqual(expect.objectContaining({
      ok: true,
      allowed: true,
      amountMicrousd: 23_265,
    }))
    expect(mockMutation).toHaveBeenCalledWith(expect.anything(), {
      jobId: 'job_1',
      capability: 'valid-job-capability',
      kind: 'scene',
      sceneOrder: 0,
      attempt: 2,
    })
    expect(mockGenerateCompletion).not.toHaveBeenCalled()
  })

  test('[P0] records the immutable Worker attempt and does not advance progress for rejected audio', async () => {
    mockReadBody.mockResolvedValueOnce({
      jobId: 'job_1',
      stage: 'commit-scene',
      sceneOrder: 0,
      artifact: {
        r2Key: 'audio-overviews/jobs/job_1/scenes/0/attempts/2.pcm',
        etag: 'etag-2',
        contentType: 'audio/L16;codec=pcm;rate=24000',
        byteLength: 2_880_000,
        durationMs: 60_000,
        sha256: 'b'.repeat(64),
        sceneId: 'scene_db_1',
        sceneOrder: 0,
        attempt: 2,
        model: 'gemini-2.5-flash-preview-tts',
        audioProfileId: 'budds-two-host-gemini-v1',
        audioProfileVersion: '1',
        format: { encoding: 'pcm_s16le', sampleRateHz: 24_000, bitDepth: 16, channels: 1 },
      },
      qualityGate: {
        version: 'audio-overview-quality-gate.v2',
        decision: 'rejected',
        checks: [
          { code: 'minimum-duration', outcome: 'rejected', message: 'Audio Artifact appears truncated' },
          { code: 'maximum-duration', outcome: 'accepted', message: 'Duration is bounded' },
          { code: 'silence-ratio', outcome: 'accepted', message: 'Silence is bounded' },
          { code: 'clipping-ratio', outcome: 'accepted', message: 'Clipping is bounded' },
          { code: 'complete-pcm-frames', outcome: 'accepted', message: 'Frames are complete' },
          { code: 'unspoken-delivery-directions', outcome: 'accepted', message: 'Directions were not spoken' },
        ],
        metrics: {
          durationMs: 60_000,
          expectedDurationMs: 90_000,
          silenceRatio: 0,
          clippingRatio: 0,
          spokenDirections: [],
          transcriptDivergence: 0.05,
          transcriptDivergenceThreshold: 0.2,
        },
      },
    })
    mockQuery
      .mockResolvedValueOnce(activeJobContext())
      .mockResolvedValueOnce({
        episode: { sceneCount: 2 },
        scenes: [{ _id: 'scene_db_1', order: 0, status: 'failed', currentAttempt: 1 }],
        utterances: [
          { _id: 'utterance_1', sceneId: 'scene_db_1', speaker: 'host_a' },
          { _id: 'utterance_2', sceneId: 'scene_db_1', speaker: 'host_b' },
        ],
        claims: [],
        utteranceClaims: [],
        artifacts: [],
      })
    mockMutation.mockResolvedValueOnce({ duplicate: false, artifactId: 'artifact_2', qualityGateId: 'gate_2' }).mockResolvedValueOnce({})

    await expect(handler({ context: {} })).resolves.toEqual(expect.objectContaining({ ok: true, duplicate: false }))

    expect(mockMutation).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({
      sceneId: 'scene_db_1',
      attempt: 2,
      passed: false,
      checks: expect.objectContaining({
        scriptedSpeakerPairValid: true,
        audioProfileMatches: true,
        speakerCountEvidence: 'not_measured',
        speakerConsistencyEvidence: 'not_measured',
        transcriptDivergence: 0.05,
        transcriptDivergenceThreshold: 0.2,
      }),
    }))
    expect(mockMutation).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({
      progress: 'Retrying scene 1/2…',
      stage: 'synthesizing',
    }))
  })

  test('[P1] rejects an obsolete or unknown v1 stage', async () => {
    mockReadBody.mockResolvedValueOnce({ jobId: 'job_1', stage: 'render-turn', turnOrder: 0 })

    await expect(handler({ context: {} })).rejects.toMatchObject({ statusCode: 400, message: 'Invalid audio overview job stage' })
    expect(mockQuery).not.toHaveBeenCalled()
  })
})
