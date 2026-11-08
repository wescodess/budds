import { vi, describe, test, expect, beforeEach } from 'vitest'

vi.stubGlobal('useRuntimeConfig', vi.fn())
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) =>
  Object.assign(new Error(opts.message), { statusCode: opts.statusCode }),
)
vi.stubGlobal('fetch', vi.fn())

const { generateCompletion, generateCompletionStream, serializeCompletionRequest, classifyAiGatewayFailure } = await import('./ai-gateway')
const { gradeQuizAnswers, quizGradingRequest, QUIZ_GRADER_POLICY } = await import('./quiz-grading')

const validConfig = {
  cloudflareAccountId: 'test-account',
  cloudflareAiGatewayId: 'test-gateway',
  openrouterApiKey: 'test-api-key',
  cloudflareAiGatewayApiKey: '',
}

const baseParams = {
  model: 'openai/gpt-4o',
  messages: [{ role: 'user' as const, content: 'Hello' }],
}

const minimalResponse = {
  id: 'chatcmpl-test',
  choices: [{ index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
  model: 'openai/gpt-4o',
  usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
}

describe('generateCompletion', () => {
  beforeEach(() => {
    vi.mocked(globalThis.fetch).mockReset()
    vi.mocked((globalThis as any).useRuntimeConfig).mockReturnValue(validConfig)
    delete process.env.NUXT_CLOUDFLARE_ACCOUNT_ID
    delete process.env.CF_ACCOUNT_ID
    delete process.env.NUXT_CLOUDFLARE_AI_GATEWAY_ID
    delete process.env.CLOUDFLARE_AI_GATEWAY_ID
    delete process.env.NUXT_CLOUDFLARE_AI_GATEWAY_API_KEY
    delete process.env.CLOUDFLARE_AI_GATEWAY_API_KEY
    delete process.env.NUXT_OPENROUTER_API_KEY
    delete process.env.OPENROUTER_API_KEY
  })

  test('returns completion response for valid params', async () => {
    const mockResponse = {
      id: 'chatcmpl-123',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hi!' }, finish_reason: 'stop' }],
      model: 'openai/gpt-4o',
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    }
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as any)

    const result = await generateCompletion(baseParams)

    expect(result).toEqual(mockResponse)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://gateway.ai.cloudflare.com/v1/test-account/test-gateway/openrouter/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  test('the quiz byte selector matches the actual escaped wire body at 96000 bytes', async () => {
    const item = {
      id: 'wire-boundary', question: 'A question', referenceAnswer: 'The full reference', evidenceExcerpt: 'Evidence 🌱',
      criteria: [{ key: 'reference_answer', description: 'The required idea', weightPercent: 100 }], learnerAnswer: '\\"🌱\n',
    }
    const byteLength = (text: string) => new TextEncoder().encode(text).byteLength
    item.learnerAnswer += 'x'.repeat(96_000 - byteLength(serializeCompletionRequest(quizGradingRequest([item]))))
    const requestBody = serializeCompletionRequest(quizGradingRequest([item]))
    expect(byteLength(requestBody)).toBe(96_000)
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      ...minimalResponse, model: QUIZ_GRADER_POLICY.model,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
        results: [{ id: item.id, criterionResults: [{ key: 'reference_answer', verdict: 'met' }], feedback: 'You explained the idea.' }],
      }) } }],
    })))
    expect(await gradeQuizAnswers([item])).toMatchObject({ status: 'graded' })
    expect(vi.mocked(fetch).mock.calls[0]![1]!.body).toBe(requestBody)
    expect(JSON.parse(JSON.parse(requestBody).messages[1].content).items[0]).toEqual(item)
    expect(await gradeQuizAnswers([{ ...item, learnerAnswer: item.learnerAnswer + 'x' }])).toEqual({ status: 'unavailable', reason: 'oversized_evidence', retryable: false })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('sends correct request body with defaults', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(minimalResponse),
    } as any)

    await generateCompletion(baseParams)

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body).toEqual({
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.7,
      max_tokens: 2048,
      stream: false,
    })
  })

  test('uses custom temperature and max_tokens when provided', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(minimalResponse),
    } as any)

    await generateCompletion({ ...baseParams, temperature: 0.2, max_tokens: 512 })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.temperature).toBe(0.2)
    expect(body.max_tokens).toBe(512)
  })

  test('can disable gateway-level retries for a durable provider attempt', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(minimalResponse) } as any)
    const controller = new AbortController()

    await generateCompletion({ ...baseParams, maxAttempts: 1, signal: controller.signal })

    const headers = vi.mocked(globalThis.fetch).mock.calls[0][1]!.headers as Record<string, string>
    expect(headers['cf-aig-max-attempts']).toBe('1')
    expect(vi.mocked(globalThis.fetch).mock.calls[0][1]!.signal).toBe(controller.signal)
  })

  test('[P0] can require provider-backed JSON output for durable structured generation', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(minimalResponse) } as any)

    await generateCompletion({ ...baseParams, jsonMode: true })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.provider).toEqual({ require_parameters: true })
  })

  test('[P0] prefers strict JSON Schema when a structured contract is supplied', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(minimalResponse) } as any)
    const schema = {
      name: 'test_contract',
      strict: true,
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
        additionalProperties: false,
      },
    }

    await generateCompletion({ ...baseParams, jsonMode: true, jsonSchema: schema })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: schema })
    expect(body.provider).toEqual({ require_parameters: true })
  })

  test('[P0] can suppress learner payload logs and require zero-retention routing', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(minimalResponse) } as any)

    await generateCompletion({
      ...baseParams,
      jsonMode: true,
      collectLogPayload: false,
      requireZeroDataRetention: true,
      denyProviderDataCollection: true,
      skipGatewayCache: true,
      allowProviderFallbacks: false,
      providerOrder: ['azure'],
    })

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!
    const headers = init!.headers as Record<string, string>
    const body = JSON.parse(init!.body as string)
    expect(headers['cf-aig-collect-log-payload']).toBe('false')
    expect(headers['cf-aig-skip-cache']).toBe('true')
    expect(body.provider).toEqual({ require_parameters: true, allow_fallbacks: false, zdr: true, data_collection: 'deny', order: ['azure'], only: ['azure'] })
  })

  test('throws when config is missing', async () => {
    vi.mocked((globalThis as any).useRuntimeConfig).mockReturnValue({})

    await expect(generateCompletion(baseParams)).rejects.toThrow(
      'Missing AI Gateway configuration',
    )
  })

  test('emits the free-grader price, reasoning and Phala privacy policy only when supplied', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify(minimalResponse)))
    await generateCompletion({
      ...baseParams, model: 'xingchen-agi/xing4.0-29b-a4b:free', temperature: 0,
      maxPrice: { prompt: 0, completion: 0 }, reasoning: { enabled: false },
      jsonSchema: { name: 'quiz', strict: true, schema: { type: 'object' } },
      requireZeroDataRetention: true, denyProviderDataCollection: true, allowProviderFallbacks: false,
      providerOrder: ['phala'], collectLogPayload: false, skipGatewayCache: true, maxAttempts: 1,
    })
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!
    expect(JSON.parse(init!.body as string)).toEqual({
      model: 'xingchen-agi/xing4.0-29b-a4b:free', messages: baseParams.messages, temperature: 0, max_tokens: 2048, stream: false,
      reasoning: { enabled: false }, response_format: { type: 'json_schema', json_schema: { name: 'quiz', strict: true, schema: { type: 'object' } } },
      provider: { require_parameters: true, allow_fallbacks: false, zdr: true, data_collection: 'deny', order: ['phala'], only: ['phala'], max_price: { prompt: 0, completion: 0 } },
    })
    expect(init!.headers).toMatchObject({ 'cf-aig-collect-log-payload': 'false', 'cf-aig-skip-cache': 'true', 'cf-aig-max-attempts': '1' })
  })

  test.each(['120', new Date(Date.now() + 120_000).toUTCString()])('preserves a numeric Retry-After delay from %s', async (retryAfter) => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('private response', { status: 429, headers: { 'retry-after': retryAfter } }))
    const error = await generateCompletion({ ...baseParams, redactUpstreamErrorBody: true }).catch(error => error)
    expect(error).toMatchObject({ statusCode: 429, retryAfterMs: expect.any(Number) })
    expect(error.retryAfterMs).toBeGreaterThan(115_000)
    expect(error.retryAfterMs).toBeLessThanOrEqual(120_000)
  })

  test('falls back to NUXT_ env vars when runtime config is empty', async () => {
    vi.mocked((globalThis as any).useRuntimeConfig).mockReturnValue({})
    process.env.NUXT_CLOUDFLARE_ACCOUNT_ID = 'env-account'
    process.env.NUXT_CLOUDFLARE_AI_GATEWAY_ID = 'env-gateway'
    process.env.NUXT_OPENROUTER_API_KEY = 'env-openrouter'
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(minimalResponse),
    } as any)

    await generateCompletion(baseParams)

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://gateway.ai.cloudflare.com/v1/env-account/env-gateway/openrouter/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer env-openrouter',
        }),
      }),
    )
  })

  test('throws on API error response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: () => Promise.resolve('Rate limited'),
    } as any)

    await expect(generateCompletion(baseParams)).rejects.toThrow('AI Gateway error: Rate limited')
  })

  test('redacts an upstream error body at privacy-sensitive provider boundaries', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('private learner response and token=secret-value', { status: 429 }))
    const failure = generateCompletion({ ...baseParams, redactUpstreamErrorBody: true })
    await expect(failure).rejects.toThrow('AI Gateway error: Upstream provider request failed')
    await expect(failure).rejects.not.toThrow(/private learner|secret-value/)
  })

  test('keeps a gateway 5xx outcome ambiguous to prevent automatic duplicate dispatch', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('Upstream timeout', { status: 504 }))
    await expect(generateCompletion(baseParams)).rejects.toMatchObject({ aiGatewayFailureKind: 'outcome_unknown' })
  })

  test.each([400, 429, 500, 302].flatMap(status => ['ordinary', 'oversized', 'declared-oversized', 'reset', 'abort', 'timeout']
    .flatMap(body => [false, true].map(redact => ({ status, body, redact })))))('HTTP $status decides the failure despite a $body error body (redacted=$redact)', async ({ status, body, redact }) => {
    const secret = 'PRIVATE_ERROR_BODY'
    const response = ['reset', 'abort', 'timeout'].includes(body)
      ? new Response(new ReadableStream({ start(controller) {
        controller.error(body === 'reset' ? new TypeError(secret) : new DOMException(secret, body === 'abort' ? 'AbortError' : 'TimeoutError'))
      } }), { status, headers: { 'retry-after': '2' } })
      : new Response(body === 'oversized' ? secret.repeat(10) : secret, { status,
          headers: { 'retry-after': '2', ...(body === 'declared-oversized' ? { 'content-length': '1000' } : {}) } })
    vi.mocked(fetch).mockResolvedValueOnce(response)
    const error = await generateCompletion({ ...baseParams, maxResponseBytes: 32, redactUpstreamErrorBody: redact }).catch(error => error)
    expect(error).toMatchObject({ statusCode: status, aiGatewayFailureKind: status >= 500 ? 'outcome_unknown' : 'definitive_failure', retryAfterMs: 2_000 })
    expect(error.message).toBe(`AI Gateway error: ${!redact && body === 'ordinary' ? secret : 'Upstream provider request failed'}`)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test.each(['reset', 'abort', 'timeout'])('an interrupted successful body (%s) remains unknown', async mode => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) {
      controller.error(mode === 'reset' ? new TypeError('Synthetic reset') : new DOMException('Synthetic interruption', mode === 'abort' ? 'AbortError' : 'TimeoutError'))
    } })))
    const error = await generateCompletion(baseParams).catch(error => error)
    expect(classifyAiGatewayFailure(error)).toBe('outcome_unknown')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('an oversized successful body stays invalid even when cancelling its reader fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(33)) },
      cancel() { throw new Error('Synthetic cancellation loss') },
    })))
    await expect(generateCompletion({ ...baseParams, maxResponseBytes: 32 })).rejects.toMatchObject({ aiGatewayFailureKind: 'invalid_response' })
  })

  test('an oversized successful body does not wait for reader cancellation', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(33)) },
      cancel() { return new Promise(() => {}) },
    })))
    const error = await Promise.race([
      generateCompletion({ ...baseParams, maxResponseBytes: 32 }).catch(error => error),
      new Promise(resolve => setTimeout(() => resolve(null), 50)),
    ])
    expect(error).toMatchObject({ aiGatewayFailureKind: 'invalid_response' })
  })

  test.each([0, -1, NaN, 1.5])('an invalid response limit (%s) is refused before send', async maxResponseBytes => {
    await expect(generateCompletion({ ...baseParams, maxResponseBytes })).rejects.toMatchObject({ aiGatewayFailureKind: 'not_dispatched' })
    expect(fetch).not.toHaveBeenCalled()
  })

  test('an already aborted completion is refused before send', async () => {
    await expect(generateCompletion({ ...baseParams, signal: AbortSignal.abort() })).rejects.toMatchObject({ aiGatewayFailureKind: 'not_dispatched' })
    expect(fetch).not.toHaveBeenCalled()
  })

  test('rejects an oversized provider response before JSON parsing', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ payload: 'x'.repeat(128) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    await expect(generateCompletion({ ...baseParams, maxResponseBytes: 32 })).rejects.toThrow('AI Gateway response exceeded the byte limit')
  })

  test('rejects an oversized encoded request before provider I/O', async () => {
    await expect(generateCompletion({ ...baseParams, maxRequestBytes: 8 })).rejects.toThrow('AI Gateway request exceeded the byte limit')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  test('classifies a malformed successful completion envelope as an invalid response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('{}', { status: 200 }))
    await expect(generateCompletion(baseParams)).rejects.toMatchObject({
      message: 'AI Gateway returned an invalid completion envelope',
      aiGatewayFailureKind: 'invalid_response',
    })
  })

  test('rejects an oversized declared response without reading its body', async () => {
    const text = vi.fn(() => Promise.resolve('{}'))
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-length': '1024' }),
      text,
    } as any)

    await expect(generateCompletion({ ...baseParams, maxResponseBytes: 32 })).rejects.toThrow('AI Gateway response exceeded the byte limit')
    expect(text).not.toHaveBeenCalled()
  })

  test('includes cf-aig-authorization header when gateway API key is set', async () => {
    vi.mocked((globalThis as any).useRuntimeConfig).mockReturnValue({
      ...validConfig,
      cloudflareAiGatewayApiKey: 'gw-secret',
    })
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(minimalResponse),
    } as any)

    await generateCompletion(baseParams)

    const headers = vi.mocked(globalThis.fetch).mock.calls[0][1]!.headers as Record<string, string>
    expect(headers['cf-aig-authorization']).toBe('Bearer gw-secret')
  })
})

describe('generateCompletionStream', () => {
  beforeEach(() => {
    vi.mocked(globalThis.fetch).mockReset()
    vi.mocked((globalThis as any).useRuntimeConfig).mockReturnValue(validConfig)
    delete process.env.NUXT_CLOUDFLARE_ACCOUNT_ID
    delete process.env.CF_ACCOUNT_ID
    delete process.env.NUXT_CLOUDFLARE_AI_GATEWAY_ID
    delete process.env.CLOUDFLARE_AI_GATEWAY_ID
    delete process.env.NUXT_CLOUDFLARE_AI_GATEWAY_API_KEY
    delete process.env.CLOUDFLARE_AI_GATEWAY_API_KEY
    delete process.env.NUXT_OPENROUTER_API_KEY
    delete process.env.OPENROUTER_API_KEY
  })

  test('returns a ReadableStream on success', async () => {
    const mockStream = new ReadableStream()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      body: mockStream,
    } as any)

    const result = await generateCompletionStream({ ...baseParams, stream: true })

    expect(result).toBe(mockStream)
  })

  test('sends stream: true in request body', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream(),
    } as any)

    await generateCompletionStream({ ...baseParams, stream: true })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.stream).toBe(true)
  })

  test('throws on API error response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Service unavailable'),
    } as any)

    await expect(
      generateCompletionStream({ ...baseParams, stream: true }),
    ).rejects.toThrow('AI Gateway error: Service unavailable')
  })
})
