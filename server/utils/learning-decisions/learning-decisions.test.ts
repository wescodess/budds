import type { H3Event } from 'h3'
import { describe, expect, test, vi } from 'vitest'
import activation from '../../../convex/quizSemanticActivationManifest.json'
import evaluatorManifest from '../../../workers/laya-evaluator/learningDecisionManifest.json'
import { FREE_RESPONSE_ASSESSMENT_KIND, FREE_RESPONSE_RUBRIC, isBoundedDecisionRequest, isCompletedTypedDecision, LEARNING_DECISION_CONTRACT_VERSION, LEARNING_DECISION_SNAPSHOT_VERSION, unavailableDecision } from './contracts'
import { evaluateTypedDecision, shadowEvaluateQuiz } from './index'
import { evaluateWithLaya } from './laya-adapter'

vi.stubGlobal('useRuntimeConfig', vi.fn())
vi.stubGlobal('fetch', vi.fn())

const envelope = { contractVersion: LEARNING_DECISION_CONTRACT_VERSION, snapshotVersion: LEARNING_DECISION_SNAPSHOT_VERSION }
const expectedProvenance = {
  packageVersion: evaluatorManifest.model.packageVersion,
  modelRevision: evaluatorManifest.model.revision,
  modelSha256: evaluatorManifest.model.sha256,
  evaluationManifestSha256: activation.evaluationManifest.sha256,
  calibratorSha256: activation.calibrator.sha256,
}
const configured = { enabled: true, token: 'x', url: 'https://internal', expectedProvenance }
function realResponse(payload: unknown) {
  return Response.json(payload, { headers: {
    'X-Laya-Evidence-Backend': 'real',
    'X-Laya-Calibrator-Status': 'valid',
    'X-Laya-Package-Version': expectedProvenance.packageVersion,
    'X-Laya-Model-Revision': expectedProvenance.modelRevision,
    'X-Laya-Model-SHA256': expectedProvenance.modelSha256,
    'X-Laya-Evaluation-Manifest-SHA256': expectedProvenance.evaluationManifestSha256,
    'X-Laya-Calibrator-SHA256': expectedProvenance.calibratorSha256,
  } })
}
const request = { ...envelope, kind: 'quiz_quality' as const, requestId: 'r1', inputDigest: 'a'.repeat(64), items: [{ id: 'q1', question: 'What is ATP?', correctAnswer: 'Energy', options: ['Energy'], language: 'en-CA', evidence: { sourceIndex: 2, excerpt: 'ATP transfers chemical energy.' } }] }
const semanticRequest = {
  ...envelope,
  kind: FREE_RESPONSE_ASSESSMENT_KIND,
  requestId: 'semantic-1',
  inputDigest: 'b'.repeat(64),
  items: [{
    id: 'answer-1',
    question: 'Describe mitosis.',
    questionType: 'free-response' as const,
    expectedAnswer: 'Cell division into two identical daughter cells.',
    learnerAnswer: 'One cell divides into two genetically identical cells.',
    evidenceExcerpt: 'Mitosis produces two genetically identical daughter cells.',
    language: 'en',
    rubricVersion: FREE_RESPONSE_ASSESSMENT_KIND,
    rubric: [...FREE_RESPONSE_RUBRIC],
  }],
}

describe('learning decision boundary', () => {
  test('keeps provider-neutral requests bounded', () => {
    expect(isBoundedDecisionRequest(request)).toBe(true)
    expect(isBoundedDecisionRequest({ ...request, items: [] })).toBe(false)
    expect(isBoundedDecisionRequest({ ...request, unexpected: true })).toBe(false)
  })

  test('accepts bounded semantic assessments and rejects incomplete evidence or cross-kind labels', () => {
    expect(isBoundedDecisionRequest(semanticRequest)).toBe(true)
    expect(isBoundedDecisionRequest({ ...semanticRequest, items: [{ ...semanticRequest.items[0], evidenceExcerpt: '' }] })).toBe(false)
    expect(isBoundedDecisionRequest({ ...semanticRequest, items: Array.from({ length: 9 }, (_, index) => ({ ...semanticRequest.items[0], id: `a${index}` })) })).toBe(false)
    const semanticResult = { status: 'completed', provider: 'laya', modelRevision: 'revision', decisions: [{ id: 'answer-1', label: 'fully_correct', confidence: 0.8, probabilities: { fully_correct: 0.8, partially_correct: 0.1, incorrect: 0.05, uncertain: 0.05 } }] }
    expect(isCompletedTypedDecision(semanticResult, semanticRequest.kind)).toBe(true)
    expect(isCompletedTypedDecision({ ...semanticResult, decisions: [{ ...semanticResult.decisions[0], probabilities: { fully_correct: 0.8, partially_correct: 0.8, incorrect: 0, uncertain: 0 } }] }, semanticRequest.kind)).toBe(false)
    expect(isCompletedTypedDecision({ ...semanticResult, decisions: [{ id: 'answer-1', label: 'supported', confidence: 0.8 }] }, semanticRequest.kind)).toBe(false)
    expect(isCompletedTypedDecision(semanticResult, request.kind)).toBe(false)
  })

  test('disabled providers make no network call', async () => {
    const fetcher = vi.fn()
    await expect(evaluateWithLaya(request, { enabled: false, token: 'x', url: 'https://invalid', binding: { fetch: fetcher } })).resolves.toEqual(unavailableDecision('disabled'))
    expect(fetcher).not.toHaveBeenCalled()
  })

  test('malformed and unavailable provider responses fail open', async () => {
    await expect(evaluateWithLaya(request, { ...configured, binding: { fetch: vi.fn(async () => new Response('{}')) } })).resolves.toMatchObject({ status: 'unavailable', reason: 'malformed' })
    await expect(evaluateWithLaya(request, { ...configured, binding: { fetch: vi.fn(async () => new Response('', { status: 503 })) } })).resolves.toMatchObject({ status: 'unavailable', reason: 'unavailable', retryable: true })
    await expect(evaluateWithLaya(request, { ...configured, binding: { fetch: vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '9999' } })) } })).resolves.toMatchObject({ status: 'unavailable', reason: 'over_budget', retryable: true, retryAfterMs: 60_000 })
  })

  test('parses and clamps an HTTP-date Retry-After value', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-20T12:00:00.000Z'))
    try {
      const response = new Response('', { status: 503, headers: { 'Retry-After': 'Sun, 20 Sep 2026 12:00:30 GMT' } })
      await expect(evaluateWithLaya(request, {
        ...configured, binding: { fetch: vi.fn(async () => response) },
      })).resolves.toMatchObject({ status: 'unavailable', retryAfterMs: 30_000 })
    }
    finally {
      vi.useRealTimers()
    }
  })

  test('times out and rejects mismatched decision IDs', async () => {
    const never = { fetch: vi.fn(() => new Promise<Response>(() => undefined)) }
    await expect(evaluateWithLaya(request, { ...configured, binding: never, timeoutMs: 50 })).resolves.toMatchObject({ status: 'unavailable', reason: 'timeout', retryable: true })
    const mismatched = { status: 'completed', provider: 'laya', modelRevision: 'pinned', decisions: [{ id: 'other', label: 'supported', confidence: 0.9 }] }
    await expect(evaluateWithLaya(request, { ...configured, binding: { fetch: vi.fn(async () => realResponse(mismatched)) } })).resolves.toMatchObject({ status: 'unavailable', reason: 'malformed' })
  })

  test('returns only a schema-validated canonical result', async () => {
    const response = { status: 'completed', provider: 'laya', modelRevision: 'f9ab0b228f0fc0f14d873dbc99038f135c2da1b2', decisions: [{ id: 'q1', label: 'supported', confidence: 0.9 }] }
    await expect(evaluateWithLaya(request, { ...configured, binding: { fetch: vi.fn(async () => realResponse(response)) } })).resolves.toEqual(response)
  })

  test('rejects fake, raw-fit, and drifted runtime provenance', async () => {
    const response = { status: 'completed', provider: 'laya', modelRevision: expectedProvenance.modelRevision, decisions: [{ id: 'q1', label: 'supported', confidence: 0.9 }] }
    const fake = realResponse(response)
    fake.headers.set('X-Laya-Evidence-Backend', 'fake')
    await expect(evaluateWithLaya(request, { ...configured, binding: { fetch: vi.fn(async () => fake) } })).resolves.toMatchObject({ status: 'unavailable', reason: 'malformed' })

    const rawFit = realResponse(response)
    rawFit.headers.set('X-Laya-Calibrator-Status', 'raw-fit')
    rawFit.headers.set('X-Laya-Calibration-Mode', 'fit')
    await expect(evaluateWithLaya(request, { ...configured, binding: { fetch: vi.fn(async () => rawFit) } })).resolves.toMatchObject({ status: 'unavailable', reason: 'malformed' })

    const drifted = realResponse(response)
    drifted.headers.set('X-Laya-Calibrator-SHA256', 'd'.repeat(64))
    await expect(evaluateWithLaya(request, { ...configured, binding: { fetch: vi.fn(async () => drifted) } })).resolves.toMatchObject({ status: 'unavailable', reason: 'malformed' })
  })

  test('returns a validated semantic assessment without changing provider-neutral labels', async () => {
    const response = { status: 'completed', provider: 'laya', modelRevision: 'f9ab0b228f0fc0f14d873dbc99038f135c2da1b2', decisions: [{ id: 'answer-1', label: 'partially_correct', confidence: 0.7, probabilities: { fully_correct: 0.1, partially_correct: 0.7, incorrect: 0.1, uncertain: 0.1 } }] }
    await expect(evaluateWithLaya(semanticRequest, { ...configured, binding: { fetch: vi.fn(async () => realResponse(response)) } })).resolves.toEqual(response)
  })

  test('dispatches configured shadow work through the service binding', async () => {
    const response = { status: 'completed', provider: 'laya', modelRevision: 'f9ab0b228f0fc0f14d873dbc99038f135c2da1b2', decisions: [{ id: 'q1', label: 'supported', confidence: 0.9 }] }
    const fetcher = vi.fn(async () => realResponse(response))
    vi.mocked(useRuntimeConfig).mockReturnValue({ learningDecisionMode: 'shadow', learningDecisionProvider: 'laya', layaEvaluatorToken: 'test-token', layaEvaluatorUrl: '' } as ReturnType<typeof useRuntimeConfig>)
    const event = { context: { cloudflare: { env: { LAYA_EVALUATOR: { fetch: fetcher } } } } } as unknown as H3Event

    await expect(evaluateTypedDecision(event, request)).resolves.toEqual(response)
    expect(fetcher).toHaveBeenCalledOnce()

    vi.mocked(useRuntimeConfig).mockReturnValue({ learningDecisionMode: 'off' } as ReturnType<typeof useRuntimeConfig>)
    await expect(evaluateTypedDecision(event, request)).resolves.toEqual(unavailableDecision('disabled'))
    expect(fetcher).toHaveBeenCalledOnce()
  })

  test('dispatches free-response shadow work through the structured LLM without changing the canonical contract', async () => {
    vi.mocked(useRuntimeConfig).mockReturnValue({
      learningDecisionMode: 'shadow',
      learningDecisionProvider: 'structured-llm',
      quizSemanticLlmModel: 'openai/gpt-4o-mini',
      cloudflareAccountId: 'account',
      cloudflareAiGatewayId: 'gateway',
      openrouterApiKey: 'key',
    } as ReturnType<typeof useRuntimeConfig>)
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(Response.json({
      id: 'completion-1',
      model: 'openai/gpt-4o-mini',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ decisions: [{ id: 'answer-1', label: 'fully_correct', confidence: 0.9, probabilities: { fully_correct: 0.9, partially_correct: 0.05, incorrect: 0.03, uncertain: 0.02 } }] }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    }))

    await expect(evaluateTypedDecision({ context: {} } as H3Event, semanticRequest)).resolves.toMatchObject({
      status: 'completed',
      provider: 'structured-llm',
      modelRevision: 'openai/gpt-4o-mini@azure:quiz-free-response-judge.v1',
      decisions: [{ id: 'answer-1', label: 'fully_correct' }],
    })
    expect(globalThis.fetch).toHaveBeenCalledOnce()
  })

  test('fails closed before dispatch for an unapproved structured grading model', async () => {
    vi.mocked(useRuntimeConfig).mockReturnValue({
      learningDecisionMode: 'shadow',
      learningDecisionProvider: 'structured-llm',
      quizSemanticLlmModel: 'openai/unapproved-model',
    } as ReturnType<typeof useRuntimeConfig>)
    vi.mocked(globalThis.fetch).mockReset()

    await expect(evaluateTypedDecision({ context: {} } as H3Event, semanticRequest))
      .resolves.toEqual(unavailableDecision('unconfigured'))
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  test('keeps the structured LLM provider shadow-only even if advisory mode is configured', async () => {
    vi.mocked(useRuntimeConfig).mockReturnValue({
      learningDecisionMode: 'advisory',
      learningDecisionProvider: 'structured-llm',
      quizSemanticLlmModel: 'openai/gpt-4o-mini',
    } as ReturnType<typeof useRuntimeConfig>)
    vi.mocked(globalThis.fetch).mockReset()

    await expect(evaluateTypedDecision({ context: {} } as H3Event, semanticRequest))
      .resolves.toEqual(unavailableDecision('disabled'))
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  test('rejects over-budget shadow batches instead of evaluating a truncated prefix', async () => {
    const items = Array.from({ length: 25 }, (_, index) => ({ id: `q${index}`, question: `question-${index}`, correctAnswer: `answer-${index}`, language: 'en', evidence: { sourceIndex: index, excerpt: `evidence-${index}` } }))
    const fetcher = vi.fn()
    vi.mocked(useRuntimeConfig).mockReturnValue({ learningDecisionMode: 'shadow', learningDecisionProvider: 'laya', layaEvaluatorToken: 'test-token', layaEvaluatorUrl: '' } as ReturnType<typeof useRuntimeConfig>)
    const event = { context: { cloudflare: { env: { LAYA_EVALUATOR: { fetch: fetcher } } } } } as unknown as H3Event

    await expect(shadowEvaluateQuiz(event, items)).resolves.toEqual(unavailableDecision('over_budget'))
    expect(fetcher).not.toHaveBeenCalled()
  })

  test('rejects an encoded request over the manifest byte budget before provider transport', async () => {
    const fetcher = vi.fn()
    vi.mocked(useRuntimeConfig).mockReturnValue({ learningDecisionMode: 'shadow', learningDecisionProvider: 'laya', layaEvaluatorToken: 'test-token' } as ReturnType<typeof useRuntimeConfig>)
    const event = { context: { cloudflare: { env: { LAYA_EVALUATOR: { fetch: fetcher } } } } } as unknown as H3Event
    const items = Array.from({ length: 20 }, (_, index) => ({
      id: `q${index}`,
      question: '😀'.repeat(1_200),
      correctAnswer: 'answer',
      language: 'en',
      evidence: { sourceIndex: index, excerpt: 'evidence' },
    }))

    await expect(evaluateTypedDecision(event, { ...request, items })).resolves.toEqual(unavailableDecision('over_budget'))
    expect(fetcher).not.toHaveBeenCalled()
  })

  test.each([
    [{ ...request.items[0], language: '' }, 'unknown_language'],
    [{ ...request.items[0], language: 'fr' }, 'unsupported_language'],
    [{ ...request.items[0], evidence: { sourceIndex: 0, excerpt: '' } }, 'missing_evidence'],
    [{ ...request.items[0], evidence: { sourceIndex: 0, excerpt: 'x'.repeat(1_201) } }, 'oversized_evidence'],
  ])('returns typed unavailable without a provider request for invalid language or evidence', async (item, reason) => {
    const fetcher = vi.fn()
    vi.mocked(useRuntimeConfig).mockReturnValue({ learningDecisionMode: 'shadow', learningDecisionProvider: 'laya', layaEvaluatorToken: 'test-token' } as ReturnType<typeof useRuntimeConfig>)
    const event = { context: { cloudflare: { env: { LAYA_EVALUATOR: { fetch: fetcher } } } } } as unknown as H3Event
    await expect(evaluateTypedDecision(event, { ...request, items: [item] })).resolves.toMatchObject({ status: 'unavailable', reason })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
