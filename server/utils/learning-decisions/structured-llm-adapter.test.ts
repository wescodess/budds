import { beforeEach, describe, expect, test, vi } from 'vitest'
import { FREE_RESPONSE_ASSESSMENT_KIND, FREE_RESPONSE_RUBRIC, LEARNING_DECISION_CONTRACT_VERSION, LEARNING_DECISION_SNAPSHOT_VERSION } from './contracts'

const generateCompletion = vi.hoisted(() => vi.fn())
vi.mock('../ai-gateway', async importOriginal => ({
  ...await importOriginal<typeof import('../ai-gateway')>(),
  generateCompletion,
}))

const { evaluateWithStructuredLlm } = await import('./structured-llm-adapter')

const request = {
  kind: FREE_RESPONSE_ASSESSMENT_KIND,
  requestId: 'request-1',
  inputDigest: 'a'.repeat(64),
  contractVersion: LEARNING_DECISION_CONTRACT_VERSION,
  snapshotVersion: LEARNING_DECISION_SNAPSHOT_VERSION,
  items: [{
    id: 'answer-1',
    question: 'List two factors used to rank preferred companies.',
    questionType: 'free-response' as const,
    expectedAnswer: 'Company culture, job opportunities',
    learnerAnswer: 'opportunities & cultures',
    evidenceExcerpt: 'Consider company culture and available job opportunities.',
    language: 'en',
    rubricVersion: FREE_RESPONSE_ASSESSMENT_KIND,
    rubric: [...FREE_RESPONSE_RUBRIC],
  }],
}

const completion = (content: unknown) => ({
  id: 'completion-1',
  model: 'openai/gpt-4o-mini',
  choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(content) }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
})

const validPayload = {
  decisions: [{
    id: 'answer-1',
    label: 'fully_correct',
    confidence: 0.9,
    probabilities: { fully_correct: 0.9, partially_correct: 0.05, incorrect: 0.03, uncertain: 0.02 },
  }],
}

describe('structured LLM learning-decision adapter', () => {
  beforeEach(() => generateCompletion.mockReset())

  test('requests a private, pinned, strict structured assessment and returns the canonical contract', async () => {
    generateCompletion.mockResolvedValue(completion(validPayload))

    await expect(evaluateWithStructuredLlm(request, {
      enabled: true,
      model: 'openai/gpt-4o-mini',
      upstreamProvider: 'azure',
    })).resolves.toEqual({
      status: 'completed',
      provider: 'structured-llm',
      modelRevision: 'openai/gpt-4o-mini@azure:quiz-free-response-judge.v1',
      decisions: [{ ...validPayload.decisions[0], reviewRequired: false }],
    })

    expect(generateCompletion).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openai/gpt-4o-mini',
      temperature: 0,
      maxAttempts: 1,
      allowProviderFallbacks: false,
      requireZeroDataRetention: true,
      collectLogPayload: false,
      denyProviderDataCollection: true,
      skipGatewayCache: true,
      providerOrder: ['azure'],
      jsonMode: true,
      maxResponseBytes: 32_000,
      signal: expect.any(AbortSignal),
      jsonSchema: expect.objectContaining({ name: 'budds_quiz_free_response_assessment', strict: true }),
    }))
    const call = generateCompletion.mock.calls[0]![0]
    expect(JSON.stringify(call.messages)).toContain('opportunities & cultures')
    expect(call.messages[0].content).toContain('uncertain only when the supplied evidence')
  })

  test.each([
    { decisions: [] },
    { decisions: [{ ...validPayload.decisions[0], id: 'other' }] },
    { decisions: [{ ...validPayload.decisions[0], label: 'supported' }] },
    { decisions: [{ ...validPayload.decisions[0], confidence: 0.9, probabilities: { fully_correct: 0.1, partially_correct: 0.7, incorrect: 0.1, uncertain: 0.1 } }] },
  ])('fails closed for malformed or mismatched structured output %#', async (payload) => {
    generateCompletion.mockResolvedValue(completion(payload))
    await expect(evaluateWithStructuredLlm(request, { enabled: true, model: 'openai/gpt-4o-mini', upstreamProvider: 'azure' }))
      .resolves.toMatchObject({ status: 'unavailable', reason: 'malformed', retryable: false })
  })

  test('does not dispatch unsupported quiz-quality work', async () => {
    const qualityRequest = {
      ...request,
      kind: 'quiz_quality' as const,
      items: [{ id: 'q1', question: 'What is ATP?', correctAnswer: 'Energy', language: 'en', evidence: { sourceIndex: 0, excerpt: 'ATP transfers energy.' } }],
    }
    await expect(evaluateWithStructuredLlm(qualityRequest, { enabled: true, model: 'openai/gpt-4o-mini', upstreamProvider: 'azure' }))
      .resolves.toMatchObject({ status: 'unavailable', reason: 'unconfigured' })
    expect(generateCompletion).not.toHaveBeenCalled()
  })

  test('marks low model confidence for review without converting it to rubric uncertain', async () => {
    generateCompletion.mockResolvedValue(completion({
      decisions: [{
        id: 'answer-1', label: 'partially_correct', confidence: 0.6,
        probabilities: { fully_correct: 0.1, partially_correct: 0.6, incorrect: 0.2, uncertain: 0.1 },
      }],
    }))
    await expect(evaluateWithStructuredLlm(request, { enabled: true, model: 'openai/gpt-4o-mini', upstreamProvider: 'azure' }))
      .resolves.toMatchObject({ decisions: [{ label: 'partially_correct', reviewRequired: true }] })
  })

  test('fails closed when the gateway returns a different model than the configured pin', async () => {
    generateCompletion.mockResolvedValue({ ...completion(validPayload), model: 'openai/other-model' })
    await expect(evaluateWithStructuredLlm(request, { enabled: true, model: 'openai/gpt-4o-mini', upstreamProvider: 'azure' }))
      .resolves.toMatchObject({ status: 'unavailable', reason: 'malformed' })
  })

  test('maps timeout and gateway failures to typed unavailable results', async () => {
    generateCompletion.mockRejectedValueOnce(Object.assign(new DOMException('aborted', 'AbortError')))
    await expect(evaluateWithStructuredLlm(request, { enabled: true, model: 'openai/gpt-4o-mini', upstreamProvider: 'azure' }))
      .resolves.toMatchObject({ status: 'unavailable', reason: 'timeout', retryable: true })

    generateCompletion.mockRejectedValueOnce(Object.assign(new Error('missing'), { aiGatewayFailureKind: 'not_dispatched' }))
    await expect(evaluateWithStructuredLlm(request, { enabled: true, model: 'openai/gpt-4o-mini', upstreamProvider: 'azure' }))
      .resolves.toMatchObject({ status: 'unavailable', reason: 'unconfigured', retryable: false })
  })
})
