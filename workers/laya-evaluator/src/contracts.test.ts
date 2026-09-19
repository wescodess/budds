import { describe, expect, test } from 'vitest'
import { isEvaluation, isEvaluationRequest, MAX_REQUEST_BYTES } from './contracts'

describe('Laya evaluator DTO boundary', () => {
  const request = { kind: 'quiz_quality', requestId: 'r1', inputDigest: 'a'.repeat(64), items: [{ id: 'q1', question: 'What is ATP?', correctAnswer: 'Energy', options: ['Energy'] }] }
  test('accepts the bounded canonical request and rejects invalid batches', () => {
    expect(isEvaluationRequest(request)).toBe(true)
    expect(isEvaluationRequest({ ...request, items: [] })).toBe(false)
    expect(isEvaluationRequest({ ...request, items: [request.items[0], request.items[0]] })).toBe(false)
    expect(MAX_REQUEST_BYTES).toBeLessThan(64_000)
  })
  test('requires provider metadata and bounded confidences from the container', () => {
    expect(isEvaluation({ status: 'completed', provider: 'laya', modelRevision: 'f9ab0b228f0fc0f14d873dbc99038f135c2da1b2', decisions: [{ id: 'q1', label: 'supported', confidence: 1 }] })).toBe(true)
    expect(isEvaluation({ status: 'completed', provider: 'laya', modelRevision: 'wrong', decisions: [{ id: 'q1', label: 'supported', confidence: 1 }] })).toBe(false)
    expect(isEvaluation({ status: 'completed', provider: 'laya', modelRevision: 'f9ab0b228f0fc0f14d873dbc99038f135c2da1b2', decisions: [{ id: 'q1', label: 'supported', confidence: 2 }] })).toBe(false)
  })
})
