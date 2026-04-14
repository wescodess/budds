import { vi, describe, test, expect, beforeEach } from 'vitest'

vi.stubGlobal('useRuntimeConfig', vi.fn())
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) =>
  Object.assign(new Error(opts.message), { statusCode: opts.statusCode }),
)
vi.stubGlobal('fetch', vi.fn())

const { generateCompletion, generateCompletionStream } = await import('./ai-gateway')

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

  test('sends correct request body with defaults', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
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
      json: () => Promise.resolve({}),
    } as any)

    await generateCompletion({ ...baseParams, temperature: 0.2, max_tokens: 512 })

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.temperature).toBe(0.2)
    expect(body.max_tokens).toBe(512)
  })

  test('throws when config is missing', async () => {
    vi.mocked((globalThis as any).useRuntimeConfig).mockReturnValue({})

    await expect(generateCompletion(baseParams)).rejects.toThrow(
      'Missing AI Gateway configuration',
    )
  })

  test('falls back to NUXT_ env vars when runtime config is empty', async () => {
    vi.mocked((globalThis as any).useRuntimeConfig).mockReturnValue({})
    process.env.NUXT_CLOUDFLARE_ACCOUNT_ID = 'env-account'
    process.env.NUXT_CLOUDFLARE_AI_GATEWAY_ID = 'env-gateway'
    process.env.NUXT_OPENROUTER_API_KEY = 'env-openrouter'
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
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

  test('includes cf-aig-authorization header when gateway API key is set', async () => {
    vi.mocked((globalThis as any).useRuntimeConfig).mockReturnValue({
      ...validConfig,
      cloudflareAiGatewayApiKey: 'gw-secret',
    })
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
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
