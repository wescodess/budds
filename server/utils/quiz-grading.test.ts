import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { generateCompletion, type GenerateResponse } from './ai-gateway'
import { gradeQuizAnswers, QUIZ_GRADER_POLICY, QUIZ_GRADING_TIMEOUT_MS, requireFreeQuizGradingModel, type QuizGradingInput } from './quiz-grading'

vi.mock('./ai-gateway', async (importOriginal) => ({
  ...await importOriginal<typeof import('./ai-gateway')>(), generateCompletion: vi.fn(),
}))

const items: QuizGradingInput[] = [{
  id: 'answer-1', question: 'What does mitosis produce?', referenceAnswer: 'Two identical daughter cells',
  criteria: [{ key: 'daughter_cells', description: 'Two daughter cells', weightPercent: 100 }],
  evidenceExcerpt: 'Private evidence', learnerAnswer: 'Private learner text',
}]
const result = { id: 'answer-1', criterionResults: [{ key: 'daughter_cells', verdict: 'met' }], feedback: 'You identified the daughter cells.' }

function completion(payload: unknown = { results: [result] }, model: string = QUIZ_GRADER_POLICY.model): GenerateResponse {
  return {
    id: 'mock', model,
    choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(payload) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  }
}

beforeEach(() => {
  vi.mocked(generateCompletion).mockReset().mockResolvedValue(completion())
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

test.each([QUIZ_GRADER_POLICY.model, QUIZ_GRADER_POLICY.model.replace(/:free$/, '')])('accepts only the approved returned identity: %s', async (model) => {
  vi.mocked(generateCompletion).mockResolvedValue(completion(undefined, model))
  expect(await gradeQuizAnswers(items)).toEqual({ status: 'graded', results: [result] })
})

test.each([
  'You identified both ideas. You used equivalent wording.',
  'You met every criterion.',
  'The rubric gives your answer full credit.',
  'The AI has high confidence in this grade.',
  'The missing part has a weight of 60 percent.',
  'You satisfied the higher weighted requirement.',
  'The weights total 100 percent.',
  'The weighting favors the missing idea.',
])('keeps valid judgments while replacing unsuitable learner feedback: %s', async (feedback) => {
  vi.mocked(generateCompletion).mockResolvedValue(completion({ results: [{ ...result, feedback }] }))
  expect(await gradeQuizAnswers(items)).toEqual({
    status: 'graded', results: [{ ...result, feedback: 'Compare your answer with the reference.' }],
  })
})

test('normalizes feedback whitespace without changing its meaning', async () => {
  vi.mocked(generateCompletion).mockResolvedValue(completion({ results: [{ ...result, feedback: '  You identified\n the daughter cells.  ' }] }))
  expect(await gradeQuizAnswers(items)).toEqual({ status: 'graded', results: [result] })
})

test.each(['', 'openai/gpt-4o-mini', 'xingchen-agi/xing4.0-29b-a4b', 'xingchen-agi/xing4.0-29b-a4b:free ', 'xingchen-agi/xing4.0-29b-a4b:free:other'])('the request guard rejects %s without falling back', (model) => {
  expect(() => requireFreeQuizGradingModel(model)).toThrow('Unsupported quiz grading model')
  expect(generateCompletion).not.toHaveBeenCalled()
})

test('requests only the fixed free route with strict schema, bounded transport and no learner-facing grading vocabulary', async () => {
  await gradeQuizAnswers(items)
  const [params] = vi.mocked(generateCompletion).mock.calls[0]!
  expect(params).toMatchObject({
    model: QUIZ_GRADER_POLICY.model, providerOrder: ['phala'], maxPrice: { prompt: 0, completion: 0 }, reasoning: { enabled: false },
    temperature: 0, maxAttempts: 1, requireZeroDataRetention: true, denyProviderDataCollection: true, allowProviderFallbacks: false,
    collectLogPayload: false, skipGatewayCache: true, redactUpstreamErrorBody: true,
    max_tokens: 640, maxResponseBytes: 32_000, maxRequestBytes: 96_000,
    jsonSchema: { strict: true, schema: { additionalProperties: false } },
  })
  expect(params.messages[0]!.content).toContain('plain language')
  expect(params.messages[0]!.content).toContain('no mention of criteria, rubrics, weights, confidence or grading')
  expect(JSON.parse(params.messages[1]!.content)).toEqual({ items })
  expect(JSON.stringify(params.jsonSchema)).not.toContain('score')
})

test.each([
  null, {}, { results: [] }, { results: [result, result] }, { results: [{ ...result, id: 'wrong' }] },
  { results: [{ ...result, feedback: '' }] }, { results: [{ ...result, feedback: 'x'.repeat(241) }] },
  { results: [{ ...result, feedback: '   ' }] }, { results: [{ ...result, criterionResults: [] }] },
  { results: [{ ...result, criterionResults: [{ key: 'wrong', verdict: 'met' }] }] },
  { results: [{ ...result, criterionResults: [{ key: 'daughter_cells', verdict: 'correct' }] }] },
  { results: [{ ...result, credit: 1 }] }, { results: [result], score: 1 },
])('rejects malformed results: %j', async (payload) => {
  vi.mocked(generateCompletion).mockResolvedValue(completion(payload))
  expect(await gradeQuizAnswers(items)).toEqual({ status: 'unavailable', reason: 'malformed', retryable: false })
})

test('rejects duplicate answer ids even when the batch length matches', async () => {
  vi.mocked(generateCompletion).mockResolvedValue(completion({ results: [result, result] }))
  expect(await gradeQuizAnswers([...items, { ...items[0]!, id: 'answer-2' }])).toMatchObject({ reason: 'malformed' })
})

test('rejects a truncated response or an alternate model identity', async () => {
  const truncated = completion()
  truncated.choices[0]!.finish_reason = 'length'
  vi.mocked(generateCompletion).mockResolvedValueOnce(truncated).mockResolvedValueOnce(completion(undefined, 'paid/model'))
  expect(await gradeQuizAnswers(items)).toMatchObject({ reason: 'malformed' })
  expect(await gradeQuizAnswers(items)).toMatchObject({ reason: 'malformed' })
})

test('aborts at the deadline and classifies the timeout as retryable', async () => {
  vi.useFakeTimers()
  vi.mocked(generateCompletion).mockImplementation(params => new Promise((_resolve, reject) => {
    params.signal!.addEventListener('abort', () => reject(new DOMException('Private upstream text', 'AbortError')))
  }))
  const pending = gradeQuizAnswers(items)
  await vi.advanceTimersByTimeAsync(QUIZ_GRADING_TIMEOUT_MS)
  expect(await pending).toEqual({ status: 'unavailable', reason: 'timeout', retryable: true })
})

test.each([
  { error: { statusCode: 429, retryAfterMs: 1_000_000 }, reason: 'over_budget', retryable: true, retryAfterMs: 900_000 },
  { error: { statusCode: 503 }, reason: 'unavailable', retryable: true },
  { error: { statusCode: 400, aiGatewayFailureKind: 'definitive_failure' }, reason: 'unavailable', retryable: false },
  { error: { statusCode: 500, aiGatewayFailureKind: 'not_dispatched' }, reason: 'unconfigured', retryable: false },
  { error: { statusCode: 502, aiGatewayFailureKind: 'invalid_response' }, reason: 'malformed', retryable: false },
])('classifies transport failures without including provider text: %j', async ({ error, ...expected }) => {
  vi.mocked(generateCompletion).mockRejectedValue({ ...error, message: 'Private evidence and answer' })
  expect(await gradeQuizAnswers(items)).toEqual({ status: 'unavailable', ...expected })
})

test('logs only a fixed warning if a free response reports a cost', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const response = completion()
  response.usage.cost = 0.001
  response.model = 'malicious/private-learner-text'
  vi.mocked(generateCompletion).mockResolvedValue(response)
  await gradeQuizAnswers(items)
  expect(warn.mock.calls).toEqual([['Quiz free-model grading reported a nonzero provider cost']])
})

test('rejects empty, oversized, duplicate or invalid rubric batches before dispatch', async () => {
  for (const batch of [[], Array.from({ length: 9 }, (_, index) => ({ ...items[0]!, id: String(index) })), [...items, ...items], [{ ...items[0]!, criteria: [] }]]) {
    expect(await gradeQuizAnswers(batch)).toMatchObject({ reason: 'malformed' })
  }
  expect(generateCompletion).not.toHaveBeenCalled()
})

test.each(['daughter_cells is not_met', 'reference_answer is uncertain', 'The answer is not_met', 'oxygen_out is met', 'Please include oxygen_out'])('hides literal internal keys and verdict codes: %s', async (feedback) => {
  const input = [{ ...items[0]!, criteria: [{ key: 'oxygen_out', description: 'Releases oxygen', weightPercent: 100 }] }]
  const judged = { ...result, criterionResults: [{ key: 'oxygen_out', verdict: 'met' }], feedback }
  vi.mocked(generateCompletion).mockResolvedValue(completion({ results: [judged] }))
  expect(await gradeQuizAnswers(input)).toEqual({ status: 'graded', results: [{ ...judged, feedback: 'Compare your answer with the reference.' }] })
})

test.each([false, true])('hides other answers\' criterion keys regardless of result order (reversed: %s)', async (reversed) => {
  const input = ['carbon_in', 'oxygen_out', 'private_balance'].map((key, index) => ({
    ...items[0]!, id: `answer-${index + 1}`, criteria: [{ key, description: 'The required idea', weightPercent: 100 }],
  }))
  const judged = [
    { id: 'answer-1', criterionResults: [{ key: 'carbon_in', verdict: 'met' }], feedback: 'Please include oxygen_out.' },
    { id: 'answer-2', criterionResults: [{ key: 'oxygen_out', verdict: 'not_met' }], feedback: 'You described CARBON_IN.' },
    { id: 'answer-3', criterionResults: [{ key: 'private_balance', verdict: 'uncertain' }], feedback: 'You expressed the idea.' },
  ]
  const results = reversed ? [...judged].reverse() : judged
  vi.mocked(generateCompletion).mockResolvedValue(completion({ results }))
  expect(await gradeQuizAnswers(input)).toEqual({
    status: 'graded',
    results: results.map(row => ({ ...row, feedback: row.id === 'answer-3' ? row.feedback : 'Compare your answer with the reference.' })),
  })
})

test('bounds canonical evidence by Unicode characters without truncating the learner answer', async () => {
  const learnerAnswer = 'Full answer with a quote " and a slash \\'.repeat(30)
  await gradeQuizAnswers([{ ...items[0]!, evidenceExcerpt: '🌱'.repeat(2000), learnerAnswer }])
  const sent = JSON.parse(vi.mocked(generateCompletion).mock.calls[0]![0].messages[1]!.content).items[0]
  expect(sent.evidenceExcerpt).toBe('🌱'.repeat(1200))
  expect(sent.learnerAnswer).toBe(learnerAnswer)
})

test('refuses a single unfit answer before calling the gateway', async () => {
  expect(await gradeQuizAnswers([{ ...items[0]!, learnerAnswer: '\\"'.repeat(40_000) }])).toEqual({ status: 'unavailable', reason: 'oversized_evidence', retryable: false })
  expect(generateCompletion).not.toHaveBeenCalled()
})
