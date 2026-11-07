import { providerRetryAfterMs, readBoundedResponseText, validateGenerateResponse, type GenerateParams } from './ai-gateway'

export const GROQ_QUIZ_MODEL = 'openai/gpt-oss-120b'
export const GROQ_QUIZ_BATCH_SIZE = 2
export const GROQ_QUIZ_MAX_REQUEST_BYTES = 6000
export const GROQ_QUIZ_MAX_COMPLETION_TOKENS = 1024

// The full serialized UTF8 body conservatively budgets input bytes as tokens;
// 6000 + 1024 output + 976 framing headroom = 8000 tokens per reservation.
export function serializeGroqQuizRequest(params: GenerateParams) {
  return JSON.stringify({
    model: GROQ_QUIZ_MODEL, messages: params.messages, temperature: 0,
    max_completion_tokens: GROQ_QUIZ_MAX_COMPLETION_TOKENS,
    reasoning_effort: 'low', include_reasoning: false, stream: false,
    response_format: { type: 'json_schema', json_schema: params.jsonSchema },
  })
}

export async function generateGroqQuizCompletion(params: GenerateParams, key: string) {
  const body = serializeGroqQuizRequest(params)
  if (new TextEncoder().encode(body).byteLength > GROQ_QUIZ_MAX_REQUEST_BYTES) {
    throw Object.assign(new Error('Quiz request exceeded its byte limit'), { aiGatewayFailureKind: 'not_dispatched' })
  }
  // No SDK, redirects, retries, tools, streaming, batch or stateful endpoints.
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', redirect: 'error',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body, signal: params.signal,
  })
  if (!response.ok) {
    // Do not read or retain upstream bodies: they may echo protected inputs.
    const retryAfterMs = providerRetryAfterMs(response.headers.get('retry-after'))
    throw Object.assign(new Error('Quiz provider request failed'), {
      statusCode: response.status,
      aiGatewayFailureKind: response.status >= 500 ? 'outcome_unknown' : 'definitive_failure',
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    })
  }
  const text = await readBoundedResponseText(response, 32_000)
  let parsed: unknown
  try { parsed = JSON.parse(text) }
  catch { throw Object.assign(new Error('Invalid quiz completion'), { aiGatewayFailureKind: 'invalid_response' }) }
  return validateGenerateResponse(parsed)
}
