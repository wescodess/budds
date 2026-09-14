import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  searchTavilyFree,
  TAVILY_MAX_SEARCH_BODY_BYTES,
  TAVILY_MAX_USAGE_BODY_BYTES,
  TAVILY_SEARCH_ENDPOINT,
  TAVILY_SEARCH_TIMEOUT_MS,
  TAVILY_USAGE_ENDPOINT,
  TAVILY_USAGE_TIMEOUT_MS,
  TavilyFreeSearchError,
  verifyTavilyFreeUsage,
} from './tavily-free-search'

const config = { apiKey: 'tvly-test-secret', projectId: 'budds-v2' }

afterEach(() => {
  vi.useRealTimers()
})

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const adapterCases = [
  {
    name: 'usage',
    maxBytes: TAVILY_MAX_USAGE_BODY_BYTES,
    timeoutMs: TAVILY_USAGE_TIMEOUT_MS,
    dispatched: false,
    invoke: async (fetcher: typeof fetch) => await verifyTavilyFreeUsage(config, fetcher),
  },
  {
    name: 'search',
    maxBytes: TAVILY_MAX_SEARCH_BODY_BYTES,
    timeoutMs: TAVILY_SEARCH_TIMEOUT_MS,
    dispatched: true,
    invoke: async (fetcher: typeof fetch) => await searchTavilyFree('public topic', config, fetcher),
  },
] as const

describe('Tavily zero-paid adapter', () => {
  test('keeps the usage and search deadlines at the fixed 5s and 15s boundaries', () => {
    expect(TAVILY_USAGE_TIMEOUT_MS).toBe(5_000)
    expect(TAVILY_SEARCH_TIMEOUT_MS).toBe(15_000)
  })

  test('verifies Researcher plan, bounded key, and PAYG disabled before search', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      key: { usage: 4, limit: 800 },
      account: { current_plan: 'Researcher', plan_usage: 4, plan_limit: 1000, paygo_usage: 0, paygo_limit: 0 },
    }))

    await expect(verifyTavilyFreeUsage(config, fetcher)).resolves.toMatchObject({
      plan: 'Researcher',
      keyLimit: 800,
      paygoLimit: 0,
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [endpoint, init] = fetcher.mock.calls[0]!
    expect(endpoint).toBe(TAVILY_USAGE_ENDPOINT)
    expect(init?.method).toBe('GET')
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${config.apiKey}`)
    expect(new Headers(init?.headers).get('x-project-id')).toBe(config.projectId)
    expect(init?.redirect).toBe('error')
  })

  test.each([
    ['paid plan', { current_plan: 'Pro', plan_usage: 0, plan_limit: 1000, paygo_usage: 0, paygo_limit: 0 }],
    ['PAYG', { current_plan: 'Researcher', plan_usage: 0, plan_limit: 1000, paygo_usage: 0, paygo_limit: 1 }],
    ['oversized plan', { current_plan: 'Researcher', plan_usage: 0, plan_limit: 1001, paygo_usage: 0, paygo_limit: 0 }],
    ['exhausted plan', { current_plan: 'Researcher', plan_usage: 1000, plan_limit: 1000, paygo_usage: 0, paygo_limit: 0 }],
  ])('fails closed for %s without disclosing provider data', async (_name, account) => {
    await expect(verifyTavilyFreeUsage(config, async () => jsonResponse({
      key: { usage: 0, limit: 800 }, account,
    }))).rejects.toMatchObject({ code: 'free_plan_required', dispatched: false })
  })

  test('fails closed when the provider key allowance is exactly exhausted', async () => {
    await expect(verifyTavilyFreeUsage(config, async () => jsonResponse({
      key: { usage: 800, limit: 800 },
      account: { current_plan: 'Researcher', plan_usage: 800, plan_limit: 1000, paygo_usage: 0, paygo_limit: 0 },
    }))).rejects.toMatchObject({ code: 'free_plan_required', dispatched: false })
  })

  test('sends one fixed Basic request and returns bounded HTTPS discovery records', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      request_id: 'provider-request-1',
      usage: { credits: 1 },
      results: [{ title: 'Solar history', url: 'https://example.org/solar', content: 'Discovery only.', score: 0.8 }],
    }))

    await expect(searchTavilyFree('solar history', config, fetcher)).resolves.toEqual({
      requestIdHashInput: 'provider-request-1',
      credits: 1,
      results: [{ title: 'Solar history', url: 'https://example.org/solar', snippet: 'Discovery only.', score: 0.8 }],
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [endpoint, init] = fetcher.mock.calls[0]!
    expect(endpoint).toBe(TAVILY_SEARCH_ENDPOINT)
    expect(init?.redirect).toBe('error')
    expect(JSON.parse(String(init?.body))).toEqual({
      query: 'solar history',
      search_depth: 'basic',
      auto_parameters: false,
      max_results: 8,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      include_usage: true,
      safe_search: true,
    })
  })

  test.each([
    ['two credits', { request_id: 'r', usage: { credits: 2 }, results: [] }, 'unexpected_credit_usage'],
    ['non-HTTPS result', { request_id: 'r', usage: { credits: 1 }, results: [{ title: 'x', url: 'http://example.org', content: 'x' }] }, 'provider_response_invalid'],
    ['too many results', { request_id: 'r', usage: { credits: 1 }, results: Array.from({ length: 9 }, (_, i) => ({ title: `${i}`, url: `https://example.org/${i}`, content: 'x' })) }, 'provider_response_invalid'],
    ['malformed response', { request_id: 'r', results: [] }, 'provider_response_invalid'],
  ])('keeps post-dispatch %s ambiguous', async (_name, body, code) => {
    await expect(searchTavilyFree('public topic', config, async () => jsonResponse(body)))
      .rejects.toMatchObject({ code, dispatched: true })
  })

  test('sanitizes HTTP and network failures and performs no retry', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ query: 'must-not-leak' }, 429))
    let error: unknown
    try {
      await searchTavilyFree('must-not-leak', config, fetcher)
    }
    catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(TavilyFreeSearchError)
    expect(String(error)).toBe('TavilyFreeSearchError: Public search unavailable')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  test.each(adapterCases)('rejects an oversized declared Content-Length before reading the $name body', async ({ maxBytes, dispatched, invoke }) => {
    let bodyAccessed = false
    let signal: AbortSignal | undefined
    const response = {
      ok: true,
      headers: new Headers({ 'Content-Length': String(maxBytes + 1) }),
      get body() {
        bodyAccessed = true
        throw new Error('body must not be accessed')
      },
    } as unknown as Response
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return response
    })

    let error: unknown
    try {
      await invoke(fetcher)
    }
    catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({ code: 'provider_response_invalid', dispatched })
    expect(String(error)).toBe('TavilyFreeSearchError: Public search unavailable')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(bodyAccessed).toBe(false)
    expect(signal?.aborted).toBe(true)
  })

  test.each(adapterCases)('stops the $name response when streamed bytes cross the limit', async ({ maxBytes, dispatched, invoke }) => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(maxBytes))
        controller.enqueue(new Uint8Array(1))
      },
      cancel() {
        cancelled = true
      },
    })
    const fetcher = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    let error: unknown
    try {
      await invoke(fetcher)
    }
    catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({ code: 'provider_response_invalid', dispatched })
    expect(String(error)).toBe('TavilyFreeSearchError: Public search unavailable')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(cancelled).toBe(true)
  })

  test.each(adapterCases)('actively aborts a stalled $name request at its exact deadline, once', async ({ dispatched, invoke, timeoutMs }) => {
    vi.useFakeTimers()
    const fetcher = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('private provider timeout detail', 'AbortError')), { once: true })
    }))

    let settled = false
    const invocation = invoke(fetcher).finally(() => { settled = true })
    const assertion = expect(invocation).rejects.toMatchObject({
      code: 'provider_unavailable',
      dispatched,
      message: 'Public search unavailable',
    })
    await vi.advanceTimersByTimeAsync(timeoutMs - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await assertion
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  test.each(adapterCases)('aborts a stalled $name response body at its exact deadline, once', async ({ dispatched, invoke, timeoutMs }) => {
    vi.useFakeTimers()
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      cancel() { cancelled = true },
    })
    const fetcher = vi.fn(async () => new Response(body, { status: 200 }))
    let settled = false
    const invocation = invoke(fetcher).finally(() => { settled = true })
    const assertion = expect(invocation).rejects.toMatchObject({
      code: 'provider_unavailable',
      dispatched,
      message: 'Public search unavailable',
    })
    await vi.advanceTimersByTimeAsync(timeoutMs - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await assertion
    expect(cancelled).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  test.each(adapterCases)('sanitizes a $name HTTP failure and makes one attempt', async ({ dispatched, invoke }) => {
    let signal: AbortSignal | undefined
    let cancelled = false
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Response(new ReadableStream({ cancel() { cancelled = true } }), { status: 429 })
    })
    let error: unknown
    try {
      await invoke(fetcher)
    }
    catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({ code: 'provider_unavailable', dispatched })
    expect(String(error)).toBe('TavilyFreeSearchError: Public search unavailable')
    expect(JSON.stringify(error)).not.toContain('provider body must not escape')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(signal?.aborted).toBe(true)
    expect(cancelled).toBe(true)
  })

  test.each(adapterCases)('does not await a $name response cancellation that never settles', async ({ dispatched, invoke }) => {
    let cancelCalled = false
    const never = new Promise<void>(() => {})
    const fetcher = vi.fn(async () => new Response(new ReadableStream({
      cancel() {
        cancelCalled = true
        return never
      },
    }), { status: 429 }))
    let settled = false
    const invocation = invoke(fetcher).finally(() => { settled = true })
    const assertion = expect(invocation).rejects.toMatchObject({ code: 'provider_unavailable', dispatched })
    await assertion
    expect(cancelCalled).toBe(true)
    expect(settled).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  test.each(adapterCases)('preserves the $name deadline when stalled-body cancellation never settles', async ({ dispatched, invoke, timeoutMs }) => {
    vi.useFakeTimers()
    let cancelCalled = false
    const never = new Promise<void>(() => {})
    const fetcher = vi.fn(async () => new Response(new ReadableStream({
      cancel() {
        cancelCalled = true
        return never
      },
    }), { status: 200 }))
    let settled = false
    const invocation = invoke(fetcher).finally(() => { settled = true })
    const assertion = expect(invocation).rejects.toMatchObject({ code: 'provider_unavailable', dispatched })
    await vi.advanceTimersByTimeAsync(timeoutMs)
    await assertion
    expect(cancelCalled).toBe(true)
    expect(settled).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
