import { beforeEach, describe, expect, test, vi } from 'vitest'

const query = vi.hoisted(() => vi.fn())
const mutation = vi.hoisted(() => vi.fn())
const evaluateTypedDecision = vi.hoisted(() => vi.fn())
const requireRateLimit = vi.hoisted(() => vi.fn(async () => undefined))
const activationDecision = vi.hoisted(() => vi.fn(() => ({ enabled: true, code: 'enabled' })))

vi.mock('../../utils/convex-client', () => ({ makeConvexClient: vi.fn(() => ({ query, mutation })) }))
vi.mock('../../utils/rate-limit', () => ({ requireRateLimit }))
vi.mock('../../utils/learning-decisions/activation', () => ({ bundledQuizSemanticActivationDecision: activationDecision }))
vi.mock('../../utils/learning-decisions', async importOriginal => ({
  ...await importOriginal<typeof import('../../utils/learning-decisions')>(),
  evaluateTypedDecision,
}))

vi.stubGlobal('defineEventHandler', (handler: (...args: never[]) => unknown) => handler)
vi.stubGlobal('readBody', vi.fn())
vi.stubGlobal('useRuntimeConfig', vi.fn())
vi.stubGlobal('createError', (opts: { statusCode: number, message: string }) => Object.assign(new Error(opts.message), opts))

const handler = (await import('./assess-attempt.post')).default
const assessmentId = 'assessment_123'
const pending = [{
  assessmentId,
  kind: 'quiz.free_response_assessment.v1',
  contractVersion: 'budds.learning-decision-contract.v2',
  snapshotVersion: 'quiz-answer-snapshot.v2',
  languageSnapshot: 'en',
  questionSnapshot: { question: 'Describe ATP.', questionType: 'free-response', expectedAnswer: 'Energy carrier', evidenceExcerpt: 'ATP carries energy.' },
  learnerAnswerSnapshot: 'It carries energy.',
  rubricVersion: 'quiz.free_response_assessment.v1',
  rubricSnapshot: [
    { label: 'fully_correct', description: 'The response answers the question completely and is supported by the evidence.' },
    { label: 'partially_correct', description: 'The response contains a supported correct idea but is materially incomplete or has a minor error.' },
    { label: 'incorrect', description: 'The response is contradicted by the evidence, unsupported, or misses the requested concept.' },
    { label: 'uncertain', description: 'The evidence or response is insufficient to make a reliable assessment.' },
  ],
  attemptCount: 0,
}]

function event() {
  return { context: { convexToken: 'token' } } as never
}

describe('POST /api/quiz/assess-attempt', () => {
  beforeEach(() => {
    query.mockReset().mockResolvedValue(pending)
    mutation.mockReset().mockImplementation(async (_ref, args: { assessmentIds?: string[] }) => args.assessmentIds ?? null)
    evaluateTypedDecision.mockReset()
    activationDecision.mockReset().mockReturnValue({ enabled: true, code: 'enabled' })
    vi.mocked(readBody).mockReset().mockResolvedValue({ attemptId: 'attempt_123' })
    vi.mocked(useRuntimeConfig).mockReturnValue({ learningDecisionMode: 'advisory', quizAssessmentWriteSecret: 'test-assessment-write-secret-long-enough', public: { convex: { url: 'https://convex.test' } } } as ReturnType<typeof useRuntimeConfig>)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  test('persists a semantic verdict through the provider-neutral evaluator', async () => {
    evaluateTypedDecision.mockResolvedValue({
      status: 'completed', provider: 'laya', modelRevision: 'pinned',
      decisions: [{ id: assessmentId, label: 'fully_correct', confidence: 0.8, probabilities: { fully_correct: 0.8, partially_correct: 0.1, incorrect: 0.05, uncertain: 0.05 } }],
    })
    await expect(handler(event())).resolves.toEqual({ status: 'completed' })
    expect(evaluateTypedDecision).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'quiz.free_response_assessment.v1' }))
    expect(mutation).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      provider: 'laya',
      results: [expect.objectContaining({ assessmentId, label: 'fully_correct', confidence: 0.8 })],
    }))
  })

  test('persists a sanitized unavailable result and leaves scoring outside the route', async () => {
    evaluateTypedDecision.mockResolvedValue({ status: 'unavailable', reason: 'timeout', retryable: true, retryAfterMs: 12_345 })
    await handler(event())
    expect(mutation).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      assessmentIds: [assessmentId], reason: 'timeout', retryable: true, retryAfterMs: 12_345,
    }))
    expect(JSON.stringify(mutation.mock.calls)).not.toContain('It carries energy.')
  })

  test('closes a claimed batch as retryable when the evaluator throws unexpectedly', async () => {
    evaluateTypedDecision.mockRejectedValue(new Error('transport exploded'))
    await expect(handler(event())).resolves.toEqual({ status: 'completed' })
    expect(mutation).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      assessmentIds: [assessmentId], reason: 'unavailable', retryable: true,
    }))
  })

  test('does not expose or run advisory assessment outside advisory mode', async () => {
    vi.mocked(useRuntimeConfig).mockReturnValue({ learningDecisionMode: 'shadow' } as ReturnType<typeof useRuntimeConfig>)
    activationDecision.mockReturnValue({ enabled: false, code: 'mode_off' })
    await expect(handler(event())).resolves.toEqual({ status: 'disabled', reason: 'mode_off' })
    expect(query).not.toHaveBeenCalled()
    expect(evaluateTypedDecision).not.toHaveBeenCalled()
  })

  test.each(['evidence_hash_mismatch', 'artifact_mismatch', 'deployment_mismatch', 'production_forbidden'])('fails closed at the endpoint before body or provider work for %s', async (code) => {
    activationDecision.mockReturnValue({ enabled: false, code })
    await expect(handler(event())).resolves.toEqual({ status: 'disabled', reason: code })
    expect(readBody).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
    expect(evaluateTypedDecision).not.toHaveBeenCalled()
  })

  test('never truncates immutable snapshots while splitting requests by byte budget', async () => {
    const largePending = Array.from({ length: 8 }, (_, index) => ({
      ...pending[0]!,
      assessmentId: `assessment_${index}`,
      questionSnapshot: {
        ...pending[0]!.questionSnapshot,
        question: '😀'.repeat(1_300),
        expectedAnswer: 'A'.repeat(500),
        evidenceExcerpt: 'E'.repeat(1_300),
      },
      learnerAnswerSnapshot: 'R'.repeat(900),
    }))
    query.mockResolvedValue(largePending)
    evaluateTypedDecision.mockResolvedValue({ status: 'unavailable', reason: 'over_budget', retryable: true })

    await handler(event())

    expect(evaluateTypedDecision.mock.calls.length).toBeGreaterThan(1)
    for (const [, request] of evaluateTypedDecision.mock.calls) {
      expect(new TextEncoder().encode(JSON.stringify(request)).byteLength).toBeLessThan(32_000)
      expect(request.items.every((item: any) => item.question.length === 2_600
        && item.expectedAnswer.length === 500 && item.evidenceExcerpt.length === 1_300
        && item.learnerAnswer.length === 900)).toBe(true)
    }
  })

  test('drains more than one bounded pending page in a single request', async () => {
    const rows = Array.from({ length: 17 }, (_, index) => ({ ...pending[0]!, assessmentId: `assessment_${index}` }))
    query
      .mockResolvedValueOnce(rows.slice(0, 8))
      .mockResolvedValueOnce(rows.slice(8, 16))
      .mockResolvedValueOnce(rows.slice(16))
      .mockResolvedValueOnce([])
    evaluateTypedDecision.mockResolvedValue({ status: 'unavailable', reason: 'unsupported_language', retryable: false })

    await handler(event())

    expect(evaluateTypedDecision).toHaveBeenCalledTimes(3)
    expect(evaluateTypedDecision.mock.calls.flatMap(([, request]) => request.items)).toHaveLength(17)
    expect(query).toHaveBeenCalledTimes(4)
  })

  test('terminalizes exhausted rows separately and evaluates only claimable snapshots', async () => {
    const exhausted = { ...pending[0]!, assessmentId: 'assessment_exhausted', attemptCount: 3 }
    const claimable = { ...pending[0]!, assessmentId: 'assessment_claimable', attemptCount: 2 }
    query.mockResolvedValueOnce([exhausted, claimable]).mockResolvedValueOnce([])
    mutation
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([claimable.assessmentId])
      .mockResolvedValueOnce(null)
    evaluateTypedDecision.mockResolvedValue({ status: 'unavailable', reason: 'unsupported_language', retryable: false })

    await handler(event())

    expect(evaluateTypedDecision).toHaveBeenCalledTimes(1)
    expect(evaluateTypedDecision.mock.calls[0]![1].items.map((item: { id: string }) => item.id)).toEqual([claimable.assessmentId])
    expect(mutation.mock.calls[0]![1]).toEqual(expect.objectContaining({ assessmentIds: [exhausted.assessmentId] }))
  })
})
