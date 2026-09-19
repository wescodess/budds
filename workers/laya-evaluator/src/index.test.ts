import { describe, expect, test, vi } from 'vitest'
import { createWorkerHandler, EvaluationGate, type Env, LayaEvaluator } from './index'

const containerFetch = vi.hoisted(() => vi.fn())
const containerStop = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@cloudflare/containers', () => ({
  Container: class MockContainer {
    ctx: unknown
    env: unknown
    constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env }
    fetch(request: Request) { return containerFetch(request) }
    stop() { return containerStop() }
  },
  getContainer: vi.fn(),
}))

const token = 'test-token-with-at-least-thirty-two-characters'
const body = JSON.stringify({
  kind: 'quiz_quality',
  requestId: 'request-1',
  inputDigest: 'a'.repeat(64),
  items: [{ id: 'q1', question: 'What is ATP?', correctAnswer: 'Energy', options: ['Energy'] }],
})
const result = {
  status: 'completed',
  provider: 'laya',
  modelRevision: 'f9ab0b228f0fc0f14d873dbc99038f135c2da1b2',
  decisions: [{ id: 'q1', label: 'supported', confidence: 0.9 }],
}
const env = { LAYA_EVALUATOR_TOKEN: token, LAYA_DAILY_ALLOWANCE: '2' } as Env

function request(path = '/v1/evaluate', init: RequestInit = {}) {
  return new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
    ...init,
  })
}

function invoke(handler: ExportedHandler<Env>, outbound: Request): Promise<Response> {
  const fetchHandler = handler.fetch as unknown as (request: Request, env: Env, context: ExecutionContext) => Promise<Response>
  return fetchHandler(outbound, env, {} as ExecutionContext)
}

describe('evaluator Worker boundary', () => {
  test('closes routes and methods and requires bearer authentication', async () => {
    const resolve = vi.fn(() => ({ fetch: vi.fn() }))
    const handler = createWorkerHandler(resolve)
    expect((await invoke(handler, request('/missing'))).status).toBe(404)
    expect((await invoke(handler, request('/v1/evaluate', { method: 'GET', body: undefined }))).status).toBe(405)
    expect((await invoke(handler, request('/v1/evaluate', { headers: {} }))).status).toBe(401)
    expect((await invoke(handler, request('/v1/evaluate', { headers: { Authorization: 'Bearer definitely-wrong-but-long-enough-token' } }))).status).toBe(401)
    expect(resolve).not.toHaveBeenCalled()
  })

  test('rejects oversized and invalid DTOs before container routing', async () => {
    const resolve = vi.fn(() => ({ fetch: vi.fn() }))
    const handler = createWorkerHandler(resolve)
    const oversized = request('/v1/evaluate', { headers: { Authorization: `Bearer ${token}`, 'Content-Length': '999999' } })
    expect((await invoke(handler, oversized)).status).toBe(413)
    const invalid = request('/v1/evaluate', { body: JSON.stringify({ unexpected: true }) })
    expect((await invoke(handler, invalid)).status).toBe(422)
    expect(resolve).not.toHaveBeenCalled()
  })

  test('routes to the stable singleton and preserves retryable upstream status', async () => {
    const fetcher = vi.fn(async (_forwarded: Request) => Response.json(result))
    const resolve = vi.fn(() => ({ fetch: fetcher }))
    const handler = createWorkerHandler(resolve)
    const response = await invoke(handler, request())
    expect(response.status).toBe(200)
    expect(resolve).toHaveBeenCalledWith(env, 'budds-shadow-v1')
    expect(new URL(fetcher.mock.calls[0]![0].url).pathname).toBe('/v1/evaluate')

    const unavailable = createWorkerHandler(() => ({ fetch: vi.fn(async () => new Response('', { status: 503, headers: { 'Retry-After': '1' } })) }))
    expect((await invoke(unavailable, request())).status).toBe(503)
  })
})

describe('container admission gate', () => {
  test('rejects concurrent and over-budget work with 429', async () => {
    let allowance: { day: string, used: number } | undefined
    const storage = {
      get: vi.fn(async () => allowance),
      put: vi.fn(async (_key: string, value: { day: string, used: number }) => { allowance = value }),
    }
    const gate = new EvaluationGate()
    let release!: () => void
    const blocked = new Promise<Response>((resolve) => { release = () => resolve(new Response('ok')) })
    const first = gate.run(storage as never, '2026-09-19', 1, () => blocked)
    await vi.waitFor(() => expect(storage.put).toHaveBeenCalled())
    expect((await gate.run(storage as never, '2026-09-19', 1, async () => new Response('no'))).status).toBe(429)
    release()
    expect((await first).status).toBe(200)
    expect((await gate.run(storage as never, '2026-09-19', 1, async () => new Response('no'))).status).toBe(429)
  })

  test('stops timed-out work before releasing admission', async () => {
    const storage = { get: vi.fn(async () => undefined), put: vi.fn(async () => undefined) }
    const stop = vi.fn(async () => undefined)
    const gate = new EvaluationGate()
    const result = await gate.run(storage as never, '2026-09-19', 1, () => new Promise<Response>(() => undefined), { timeoutMs: 5, onTimeout: stop })
    expect(result.status).toBe(503)
    expect(stop).toHaveBeenCalledOnce()
  })

  test('the deployed container class applies admission and validates output', async () => {
    let allowance: { day: string, used: number } | undefined
    const storage = {
      get: vi.fn(async () => allowance),
      put: vi.fn(async (_key: string, value: { day: string, used: number }) => { allowance = value }),
    }
    const evaluator = new LayaEvaluator({ storage } as unknown as ConstructorParameters<typeof LayaEvaluator>[0], env)
    let release!: () => void
    containerFetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = () => resolve(Response.json(result)) }))
    const first = evaluator.fetch(new Request('https://container/v1/evaluate', { method: 'POST', body }))
    await vi.waitFor(() => expect(containerFetch).toHaveBeenCalled())
    expect((await evaluator.fetch(new Request('https://container/v1/evaluate', { method: 'POST', body }))).status).toBe(429)
    release()
    expect((await first).status).toBe(200)

    containerFetch.mockResolvedValueOnce(Response.json({ unexpected: true }))
    allowance = { day: new Date().toISOString().slice(0, 10), used: 0 }
    expect((await evaluator.fetch(new Request('https://container/v1/evaluate', { method: 'POST', body }))).status).toBe(502)
  })
})
