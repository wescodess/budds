import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { gradeQuizAnswers, quizGradingRequestBytes, type QuizGradingInput } from './quiz-grading'

const input: QuizGradingInput = {
  id: 'answer-1', question: 'What does mitosis produce?', referenceAnswer: 'Two identical daughter cells',
  criteria: [{ key: 'daughter_cells', description: 'Two daughter cells', weightPercent: 100 }],
  evidenceExcerpt: 'Private evidence', learnerAnswer: 'Private learner text',
}
const result = { id: input.id, criterionResults: [{ key: 'daughter_cells', verdict: 'met' }], feedback: 'You identified the daughter cells.' }
function response(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    id: 'synthetic', model: 'openai/gpt-oss-120b',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ results: [result] }) } }],
    ...overrides,
  }))
}
beforeEach(() => {
  vi.stubEnv('QUIZ_GRADING_PROVIDER', 'groq')
  vi.stubEnv('QUIZ_GRADING_GROQ_API_KEY', 'synthetic-groq-key')
  vi.stubEnv('QUIZ_GRADING_GROQ_FREE_PLAN_CONFIRMED', 'true')
  vi.stubEnv('QUIZ_GRADING_GROQ_ZDR_CONFIRMED', 'true')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

test('sends one synchronous strict Groq request with a fixed model and no routing or paid fallback knobs', async () => {
  expect(await gradeQuizAnswers([input])).toEqual({ status: 'graded', results: [result] })
  expect(fetch).toHaveBeenCalledTimes(1)
  const [url, init] = vi.mocked(fetch).mock.calls[0]!
  expect(url).toBe('https://api.groq.com/openai/v1/chat/completions')
  expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer synthetic-groq-key', 'Content-Type': 'application/json' } })
  const body = JSON.parse(init!.body as string)
  expect(Object.keys(body).sort()).toEqual(['max_completion_tokens', 'messages', 'model', 'reasoning_effort', 'include_reasoning', 'response_format', 'stream', 'temperature'].sort())
  expect(body).toMatchObject({ model: 'openai/gpt-oss-120b', max_completion_tokens: 1024, stream: false, reasoning_effort: 'low', include_reasoning: false, temperature: 0, response_format: { type: 'json_schema', json_schema: { strict: true, schema: { additionalProperties: false } } } })
  expect(JSON.parse(body.messages[1].content)).toEqual({ items: [input] })
  expect(new TextEncoder().encode(init!.body as string).byteLength).toBe(quizGradingRequestBytes([input]))
  expect(init!.signal).toBeInstanceOf(AbortSignal)
})

test.each([
  ['QUIZ_GRADING_PROVIDER', 'unknown'], ['QUIZ_GRADING_PROVIDER', 'groq '],
  ['QUIZ_GRADING_PROVIDER', ''],
  ['QUIZ_GRADING_GROQ_API_KEY', ''], ['QUIZ_GRADING_GROQ_FREE_PLAN_CONFIRMED', ''],
  ['QUIZ_GRADING_GROQ_FREE_PLAN_CONFIRMED', 'false'], ['QUIZ_GRADING_GROQ_ZDR_CONFIRMED', ''],
  ['QUIZ_GRADING_GROQ_ZDR_CONFIRMED', 'TRUE'],
])('fails closed before network when %s=%s', async (key, value) => {
  vi.stubEnv(key, value)
  expect(await gradeQuizAnswers([input])).toEqual({ status: 'unavailable', reason: 'unconfigured', retryable: false })
  expect(fetch).not.toHaveBeenCalled()
})

test.each([
  { model: 'paid/model' }, { model: 'openai/gpt-oss-20b' }, { model: 'openai/gpt-oss-120b:free' },
  { choices: [{ finish_reason: 'length', message: { content: JSON.stringify({ results: [result] }) } }] },
  { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ results: [{ ...result, score: 1 }] }) } }] },
  { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ results: [{ ...result, criterionResults: [{ key: 'wrong', verdict: 'met' }] }] }) } }] },
  { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ results: [{ ...result, criterionResults: [{ key: 'daughter_cells', verdict: 'correct' }] }] }) } }] },
])('rejects a malformed Groq completion without another request: %j', async (overrides) => {
  vi.mocked(fetch).mockResolvedValue(response(overrides))
  expect(await gradeQuizAnswers([input])).toMatchObject({ status: 'unavailable', reason: 'malformed', retryable: false })
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('suppresses even oversized 429 bodies and preserves a long Retry-After floor', async () => {
  const rejected = new Response('private flagged input'.repeat(3000), { status: 429, headers: { 'Retry-After': '86400' } })
  const read = vi.spyOn(rejected, 'text')
  vi.mocked(fetch).mockResolvedValue(rejected)
  const outcome = await gradeQuizAnswers([input])
  expect(outcome).toMatchObject({ status: 'unavailable', reason: 'over_budget', retryable: true, retryAfterMs: 86_400_000, httpStatus: 429 })
  expect(JSON.stringify(outcome)).not.toMatch(/private|flagged|raw|metadata/)
  expect(read).not.toHaveBeenCalled()
  expect(rejected.bodyUsed).toBe(false)
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('preserves an HTTP-date retry floor without retaining arbitrary error fields', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-07T00:00:00Z'))
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: { message: 'private learner text', metadata: { raw: 'private evidence' } } }), {
    status: 429, headers: { 'retry-after': 'Sun, 08 Nov 2026 00:00:00 GMT', 'x-private': 'private input' },
  }))
  expect(await gradeQuizAnswers([input])).toEqual({ status: 'unavailable', reason: 'over_budget', retryable: true, retryAfterMs: 86_400_000, httpStatus: 429 })
})

test.each(['NaN', 'Infinity', '1e9', '-1', 'private limiter text', '9'.repeat(200)])('discards invalid Retry-After metadata: %s', async (retryAfter) => {
  vi.mocked(fetch).mockResolvedValue(new Response('private', { status: 429, headers: { 'retry-after': retryAfter } }))
  expect(await gradeQuizAnswers([input])).toEqual({ status: 'unavailable', reason: 'over_budget', retryable: true, httpStatus: 429 })
})

test('bounds successful responses to 32KB and aborts a request at 30 seconds', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response('x'.repeat(32_001)))
  expect(await gradeQuizAnswers([input])).toMatchObject({ reason: 'malformed' })
  vi.useFakeTimers()
  vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(new DOMException('private', 'AbortError')))
  }))
  const pending = gradeQuizAnswers([input])
  await vi.advanceTimersByTimeAsync(30_000)
  expect(await pending).toEqual({ status: 'unavailable', reason: 'timeout', retryable: true })
  expect(fetch).toHaveBeenCalledTimes(2)
})

test('refuses more than two items or a complete wire body over 6000 bytes without truncating content', async () => {
  expect(await gradeQuizAnswers([input, { ...input, id: '2' }, { ...input, id: '3' }])).toMatchObject({ reason: 'malformed' })
  const huge = { ...input, learnerAnswer: '\\"🌱'.repeat(1000) }
  expect(quizGradingRequestBytes([huge])).toBeGreaterThan(6000)
  expect(await gradeQuizAnswers([huge])).toMatchObject({ reason: 'oversized_evidence' })
  expect(fetch).not.toHaveBeenCalled()
})

test('unset selector preserves the existing OpenRouter zero-price and privacy wire policy', async () => {
  vi.stubEnv('QUIZ_GRADING_PROVIDER', undefined)
  vi.stubGlobal('useRuntimeConfig', () => ({ cloudflareAccountId: 'synthetic-account', cloudflareAiGatewayId: 'synthetic-gateway', openrouterApiKey: 'synthetic-key' }))
  vi.mocked(fetch).mockResolvedValue(response({ model: 'xingchen-agi/xing4.0-29b-a4b:free' }))
  expect(await gradeQuizAnswers([input])).toMatchObject({ status: 'graded' })
  const [url, init] = vi.mocked(fetch).mock.calls[0]!
  expect(url).toBe('https://gateway.ai.cloudflare.com/v1/synthetic-account/synthetic-gateway/openrouter/v1/chat/completions')
  expect(JSON.parse(init!.body as string)).toMatchObject({ model: 'xingchen-agi/xing4.0-29b-a4b:free', provider: { max_price: { prompt: 0, completion: 0 }, zdr: true, data_collection: 'deny', allow_fallbacks: false, only: ['phala'] } })
})
