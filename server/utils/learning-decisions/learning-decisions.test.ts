import type { H3Event } from 'h3'
import { describe, expect, test, vi } from 'vitest'
import { FREE_RESPONSE_ASSESSMENT_KIND, FREE_RESPONSE_RUBRIC, isBoundedDecisionRequest, isCompletedTypedDecision, unavailableDecision } from './contracts'
import { evaluateTypedDecision, shadowEvaluateQuiz } from './index'
import { evaluateWithLaya } from './laya-adapter'

vi.stubGlobal('useRuntimeConfig', vi.fn())

const request = { kind: 'quiz_quality' as const, requestId: 'r1', inputDigest: 'a'.repeat(64), items: [{ id: 'q1', question: 'What is ATP?', correctAnswer: 'Energy', options: ['Energy'] }] }
const semanticRequest = {
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
    await expect(evaluateWithLaya(request, { enabled: true, token: 'x', url: 'https://internal', binding: { fetch: vi.fn(async () => new Response('{}')) } })).resolves.toMatchObject({ status: 'unavailable', reason: 'malformed' })
    await expect(evaluateWithLaya(request, { enabled: true, token: 'x', url: 'https://internal', binding: { fetch: vi.fn(async () => new Response('', { status: 503 })) } })).resolves.toMatchObject({ status: 'unavailable', reason: 'unavailable', retryable: true })
    await expect(evaluateWithLaya(request, { enabled: true, token: 'x', url: 'https://internal', binding: { fetch: vi.fn(async () => new Response('', { status: 429 })) } })).resolves.toMatchObject({ status: 'unavailable', reason: 'over_budget', retryable: true })
  })

  test('times out and rejects mismatched decision IDs', async () => {
    const never = { fetch: vi.fn(() => new Promise<Response>(() => undefined)) }
    await expect(evaluateWithLaya(request, { enabled: true, token: 'x', url: 'https://internal', binding: never, timeoutMs: 50 })).resolves.toMatchObject({ status: 'unavailable', reason: 'timeout', retryable: true })
    const mismatched = { status: 'completed', provider: 'laya', modelRevision: 'pinned', decisions: [{ id: 'other', label: 'supported', confidence: 0.9 }] }
    await expect(evaluateWithLaya(request, { enabled: true, token: 'x', url: 'https://internal', binding: { fetch: vi.fn(async () => Response.json(mismatched)) } })).resolves.toMatchObject({ status: 'unavailable', reason: 'malformed' })
  })

  test('returns only a schema-validated canonical result', async () => {
    const response = { status: 'completed', provider: 'laya', modelRevision: 'f9ab0b228f0fc0f14d873dbc99038f135c2da1b2', decisions: [{ id: 'q1', label: 'supported', confidence: 0.9 }] }
    await expect(evaluateWithLaya(request, { enabled: true, token: 'x', url: 'https://internal', binding: { fetch: vi.fn(async () => Response.json(response)) } })).resolves.toEqual(response)
  })

  test('returns a validated semantic assessment without changing provider-neutral labels', async () => {
    const response = { status: 'completed', provider: 'laya', modelRevision: 'f9ab0b228f0fc0f14d873dbc99038f135c2da1b2', decisions: [{ id: 'answer-1', label: 'partially_correct', confidence: 0.7, probabilities: { fully_correct: 0.1, partially_correct: 0.7, incorrect: 0.1, uncertain: 0.1 } }] }
    await expect(evaluateWithLaya(semanticRequest, { enabled: true, token: 'x', url: 'https://internal', binding: { fetch: vi.fn(async () => Response.json(response)) } })).resolves.toEqual(response)
  })

  test('dispatches configured shadow work through the service binding', async () => {
    const response = { status: 'completed', provider: 'laya', modelRevision: 'f9ab0b228f0fc0f14d873dbc99038f135c2da1b2', decisions: [{ id: 'q1', label: 'supported', confidence: 0.9 }] }
    const fetcher = vi.fn(async () => Response.json(response))
    vi.mocked(useRuntimeConfig).mockReturnValue({ learningDecisionMode: 'shadow', learningDecisionProvider: 'laya', layaEvaluatorToken: 'test-token', layaEvaluatorUrl: '' } as ReturnType<typeof useRuntimeConfig>)
    const event = { context: { cloudflare: { env: { LAYA_EVALUATOR: { fetch: fetcher } } } } } as unknown as H3Event

    await expect(evaluateTypedDecision(event, request)).resolves.toEqual(response)
    expect(fetcher).toHaveBeenCalledOnce()

    vi.mocked(useRuntimeConfig).mockReturnValue({ learningDecisionMode: 'off' } as ReturnType<typeof useRuntimeConfig>)
    await expect(evaluateTypedDecision(event, request)).resolves.toEqual(unavailableDecision('disabled'))
    expect(fetcher).toHaveBeenCalledOnce()
  })

  test('bounds quiz shadow batches and logs only sanitized aggregates', async () => {
    const items = Array.from({ length: 25 }, (_, index) => ({ id: `q${index}`, question: `question-${index}`, correctAnswer: `answer-${index}` }))
    let forwarded: typeof request | undefined
    const fetcher = vi.fn(async (outbound: Request) => {
      forwarded = await outbound.json() as typeof request
      return Response.json({ status: 'completed', provider: 'laya', modelRevision: 'f9ab0b228f0fc0f14d873dbc99038f135c2da1b2', decisions: forwarded.items.map(item => ({ id: item.id, label: 'supported', confidence: 0.5 })) })
    })
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.mocked(useRuntimeConfig).mockReturnValue({ learningDecisionMode: 'shadow', learningDecisionProvider: 'laya', layaEvaluatorToken: 'test-token', layaEvaluatorUrl: '' } as ReturnType<typeof useRuntimeConfig>)
    const event = { context: { cloudflare: { env: { LAYA_EVALUATOR: { fetch: fetcher } } } } } as unknown as H3Event

    await shadowEvaluateQuiz(event, items)

    expect(forwarded?.items).toHaveLength(20)
    expect(forwarded?.items.at(-1)?.id).toBe('q19')
    const logged = info.mock.calls[0]![1]
    expect(logged).toMatchObject({ itemCount: 20, omittedItemCount: 5, supportedCount: 20, needsReviewCount: 0, meanConfidence: 0.5 })
    expect(JSON.stringify(logged)).not.toContain('question-')
    expect(JSON.stringify(logged)).not.toContain('answer-')
    info.mockRestore()
  })
})
