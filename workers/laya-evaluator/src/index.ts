import { Container, getContainer } from '@cloudflare/containers'
import { isEvaluation, isEvaluationRequest, MAX_REQUEST_BYTES } from './contracts'

export interface Env {
  LAYA_EVALUATOR: DurableObjectNamespace<LayaEvaluator>
  LAYA_EVALUATOR_TOKEN: string
  LAYA_DAILY_ALLOWANCE: string
}

const INSTANCE_NAME = 'budds-shadow-v1'
const MODEL_READY_ATTEMPTS = 40
const MODEL_READY_DELAY_MS = 500
const INFERENCE_TIMEOUT_MS = 5_000

async function tokenMatches(provided: string, expected: string): Promise<boolean> {
  const encode = (value: string) => new TextEncoder().encode(value)
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encode(provided)),
    crypto.subtle.digest('SHA-256', encode(expected)),
  ])
  const a = new Uint8Array(left); const b = new Uint8Array(right)
  let mismatch = 0
  for (let i = 0; i < a.length; i += 1) mismatch |= a[i]! ^ b[i]!
  return mismatch === 0
}

function retryable(status: number) { return status === 408 || status === 429 || status >= 500 }
function error(status: number, retryAfter?: number) {
  return Response.json({ error: status === 429 ? 'Unavailable' : 'Request rejected' }, { status, headers: retryAfter ? { 'Retry-After': String(retryAfter) } : undefined })
}
function allowance(value: string): number | null { const cap = Number(value); return Number.isSafeInteger(cap) && cap >= 0 && cap <= 1_000 ? cap : null }

type AllowanceStorage = Pick<DurableObjectStorage, 'get' | 'put'>
type GateOptions = { timeoutMs?: number, onTimeout?: () => Promise<void> }
type ReadyOptions = { attempts?: number, delayMs?: number, delay?: (durationMs: number) => Promise<void> }

/** Waits for the HTTP process and its asynchronously loaded model, not just an open port. */
export async function waitForModelReady(
  fetchReady: () => Promise<Response>,
  options: ReadyOptions = {},
): Promise<boolean> {
  const attempts = options.attempts ?? MODEL_READY_ATTEMPTS
  const delayMs = options.delayMs ?? MODEL_READY_DELAY_MS
  const delay = options.delay ?? ((duration: number) => new Promise<void>(resolve => setTimeout(resolve, duration)))
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetchReady().catch(() => null)
    if (response?.ok) return true
    if (response && response.status !== 503) return false
    if (attempt < attempts - 1) await delay(delayMs)
  }
  return false
}

export class EvaluationGate {
  private active = false

  async run(storage: AllowanceStorage, day: string, cap: number, operation: () => Promise<Response>, options: GateOptions = {}): Promise<Response> {
    if (this.active) return error(429, 1)
    this.active = true
    try {
      const allowance = await storage.get<{ day: string, used: number }>('utc-allowance')
      const used = allowance?.day === day ? allowance.used : 0
      if (used >= cap) return error(429, 60 * 60)
      await storage.put('utc-allowance', { day, used: used + 1 })
      const timeoutMs = options.timeoutMs ?? 1_500
      let timer: ReturnType<typeof setTimeout> | undefined
      const outcome = await Promise.race([
        operation().then(response => ({ response }), () => ({ response: error(503, 1) })),
        new Promise<{ timedOut: true }>((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs) }),
      ])
      if (timer) clearTimeout(timer)
      if ('timedOut' in outcome) {
        await options.onTimeout?.().catch(() => undefined)
        return error(503, 1)
      }
      return outcome.response
    }
    finally {
      this.active = false
    }
  }
}

export class LayaEvaluator extends Container<Env> {
  defaultPort = 8080
  requiredPorts = [8080]
  sleepAfter = '5m'
  enableInternet = false
  pingEndpoint = '/health/live'
  private gate = new EvaluationGate()
  private active = false

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== '/v1/evaluate' || request.method !== 'POST') return error(404)
    const raw = await request.text()
    const body: unknown = (() => { try { return JSON.parse(raw) } catch { return null } })()
    if (!isEvaluationRequest(body)) return error(422)
    if (this.active) return error(429, 1)
    this.active = true
    try {
      const ready = await waitForModelReady(() => super.fetch(new Request('http://container/health/ready')))
      if (!ready) {
        await this.stop().catch(() => undefined)
        return error(503, 1)
      }
      const now = new Date()
      const day = now.toISOString().slice(0, 10)
      const cap = allowance(this.env.LAYA_DAILY_ALLOWANCE || '50')
      if (cap === null) return error(503, 1)
      return await this.gate.run(this.ctx.storage, day, cap, async () => {
        const response = await super.fetch(new Request('http://container/v1/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw }))
        if (!response.ok) return error(response.status, retryable(response.status) ? 1 : undefined)
        const result: unknown = await response.json().catch(() => null)
        return isEvaluation(result) ? Response.json(result) : error(502)
      }, { timeoutMs: INFERENCE_TIMEOUT_MS, onTimeout: async () => { await this.stop() } })
    }
    finally {
      this.active = false
    }
  }
}

type ResolveContainer = (env: Env, name: string) => { fetch(request: Request): Promise<Response> }

/** A single named container gives this CPU-only model a bounded, serialized execution lane. */
export function createWorkerHandler(resolveContainer: ResolveContainer = (env, name) => getContainer(env.LAYA_EVALUATOR, name)): ExportedHandler<Env> {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url)
      if (url.pathname !== '/v1/evaluate') return error(404)
      if (request.method !== 'POST') return error(405)
      const authorization = request.headers.get('Authorization')
      const provided = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
      if (!provided || env.LAYA_EVALUATOR_TOKEN.length < 32 || !await tokenMatches(provided, env.LAYA_EVALUATOR_TOKEN)) return error(401)
      const contentLength = Number(request.headers.get('Content-Length') || 0)
      if (!Number.isFinite(contentLength) || contentLength > MAX_REQUEST_BYTES) return error(413)
      const raw = await request.text()
      if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) return error(413)
      const body: unknown = (() => { try { return JSON.parse(raw) } catch { return null } })()
      if (!isEvaluationRequest(body)) return error(422)
      const container = resolveContainer(env, INSTANCE_NAME)
      try {
        return await container.fetch(new Request('http://container/v1/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw }))
      }
      catch {
        return error(503, 1)
      }
    },
  }
}

export default createWorkerHandler()
