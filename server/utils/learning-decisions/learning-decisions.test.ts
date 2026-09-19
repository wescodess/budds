import type { H3Event } from 'h3'
import { describe, expect, test, vi } from 'vitest'
import { isBoundedDecisionRequest, unavailableDecision } from './contracts'
import { evaluateTypedDecision, scheduleShadowEvaluateQuiz, shadowEvaluateQuiz } from './index'
import { evaluateWithLaya } from './laya-adapter'

vi.stubGlobal('useRuntimeConfig', vi.fn())

const request = { kind: 'quiz_quality' as const, requestId: 'r1', inputDigest: 'a'.repeat(64), items: [{ id: 'q1', question: 'What is ATP?', correctAnswer: 'Energy', options: ['Energy'] }] }

describe('learning decision boundary', () => {
  test('keeps provider-neutral requests bounded', () => {
    expect(isBoundedDecisionRequest(request)).toBe(true)
    expect(isBoundedDecisionRequest({ ...request, items: [] })).toBe(false)
    expect(isBoundedDecisionRequest({ ...request, unexpected: true })).toBe(false)
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

  test('schedules hosted shadow work without blocking the user response', async () => {
    let resolve!: (response: Response) => void
    const pending = new Promise<Response>((done) => { resolve = done })
    const fetcher = vi.fn(() => pending)
    const waitUntil = vi.fn()
    vi.mocked(useRuntimeConfig).mockReturnValue({ learningDecisionMode: 'shadow', learningDecisionProvider: 'laya', layaEvaluatorToken: 'test-token', layaEvaluatorUrl: '' } as ReturnType<typeof useRuntimeConfig>)
    const event = { context: { waitUntil, cloudflare: { env: { LAYA_EVALUATOR: { fetch: fetcher } } } } } as unknown as H3Event

    await expect(scheduleShadowEvaluateQuiz(event, request.items)).resolves.toBeUndefined()
    expect(waitUntil).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())

    resolve(new Response('', { status: 503 }))
    await expect(waitUntil.mock.calls[0]![0]).resolves.toBeUndefined()
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
