export const TAVILY_USAGE_ENDPOINT = 'https://api.tavily.com/usage'
export const TAVILY_SEARCH_ENDPOINT = 'https://api.tavily.com/search'
export const TAVILY_MAX_RESULTS = 8

export const TAVILY_MAX_USAGE_BODY_BYTES = 32 * 1024
export const TAVILY_MAX_SEARCH_BODY_BYTES = 256 * 1024
export const TAVILY_USAGE_TIMEOUT_MS = 5_000
export const TAVILY_SEARCH_TIMEOUT_MS = 15_000
const MAX_PROVIDER_PLAN_LIMIT = 1_000
const MAX_PROVIDER_KEY_LIMIT = 800
const MAX_TITLE_CHARS = 300
const MAX_URL_CHARS = 2_048
const MAX_SNIPPET_CHARS = 2_000

export type TavilyFreeErrorCode =
  | 'config_invalid'
  | 'provider_unavailable'
  | 'provider_response_invalid'
  | 'free_plan_required'
  | 'unexpected_credit_usage'

export class TavilyFreeSearchError extends Error {
  readonly code: TavilyFreeErrorCode
  readonly dispatched: boolean

  constructor(code: TavilyFreeErrorCode, dispatched: boolean) {
    super('Public search unavailable')
    this.name = 'TavilyFreeSearchError'
    this.code = code
    this.dispatched = dispatched
  }
}

export type TavilyFreeConfig = {
  apiKey: string
  projectId?: string
}

export type TavilyFreeUsage = {
  plan: 'Researcher'
  keyUsage: number
  keyLimit: number
  planUsage: number
  planLimit: number
  paygoUsage: number
  paygoLimit: 0
}

export type TavilyDiscoveryResult = {
  title: string
  url: string
  snippet: string
  score?: number
}

export type TavilySearchSuccess = {
  requestIdHashInput: string
  credits: 1
  results: TavilyDiscoveryResult[]
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function headers(config: TavilyFreeConfig): Headers {
  const result = new Headers({
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  })
  if (config.projectId) result.set('X-Project-ID', config.projectId)
  return result
}

export function readTavilyFreeConfig(env: Record<string, string | undefined> = process.env): TavilyFreeConfig {
  const apiKey = env.TAVILY_API_KEY?.trim()
  const projectId = env.TAVILY_PROJECT_ID?.trim()
  if (!apiKey || apiKey.length < 8 || apiKey.length > 512) {
    throw new TavilyFreeSearchError('config_invalid', false)
  }
  if (projectId !== undefined && (projectId.length < 1 || projectId.length > 128)) {
    throw new TavilyFreeSearchError('config_invalid', false)
  }
  return { apiKey, ...(projectId ? { projectId } : {}) }
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  return await new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    reader.read().then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => {})
  }
  catch {
    // Cancellation is best effort after the authoritative sanitized failure.
  }
}

async function readBoundedJson(response: Response, maxBytes: number, dispatched: boolean, signal: AbortSignal): Promise<unknown> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) {
      throw new TavilyFreeSearchError('provider_response_invalid', dispatched)
    }
    const declaredLength = Number(contentLength)
    if (!Number.isSafeInteger(declaredLength) || declaredLength > maxBytes) {
      throw new TavilyFreeSearchError('provider_response_invalid', dispatched)
    }
  }
  if (!response.body) throw new TavilyFreeSearchError('provider_response_invalid', dispatched)

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await readChunk(reader, signal)
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        cancelReader(reader)
        throw new TavilyFreeSearchError('provider_response_invalid', dispatched)
      }
      chunks.push(value)
    }
  }
  catch (error) {
    cancelReader(reader)
    throw error
  }
  finally {
    try {
      reader.releaseLock()
    }
    catch {
      // A still-pending read must not replace the sanitized bounded/timeout error.
    }
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  }
  catch {
    throw new TavilyFreeSearchError('provider_response_invalid', dispatched)
  }
}

function cancelResponseBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => {})
  }
  catch {
    // The sanitized provider failure remains authoritative.
  }
}

async function boundedFetch(
  fetcher: FetchLike,
  endpoint: string,
  init: RequestInit,
  timeoutMs: number,
  maxBytes: number,
  dispatched: boolean,
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(endpoint, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) {
      controller.abort()
      cancelResponseBody(response)
      throw new TavilyFreeSearchError('provider_unavailable', dispatched)
    }
    return await readBoundedJson(response, maxBytes, dispatched, controller.signal)
  }
  catch (error) {
    controller.abort()
    if (error instanceof TavilyFreeSearchError) throw error
    throw new TavilyFreeSearchError('provider_unavailable', dispatched)
  }
  finally {
    clearTimeout(timeout)
  }
}

export async function verifyTavilyFreeUsage(
  config: TavilyFreeConfig,
  fetcher: FetchLike = fetch,
): Promise<TavilyFreeUsage> {
  const value = await boundedFetch(fetcher, TAVILY_USAGE_ENDPOINT, {
    method: 'GET',
    headers: headers(config),
  }, TAVILY_USAGE_TIMEOUT_MS, TAVILY_MAX_USAGE_BODY_BYTES, false)

  if (!isRecord(value) || !isRecord(value.key) || !isRecord(value.account)) {
    throw new TavilyFreeSearchError('provider_response_invalid', false)
  }
  const plan = value.account.current_plan ?? value.account.plan
  const keyUsage = value.key.usage
  const keyLimit = value.key.limit
  const planUsage = value.account.plan_usage
  const planLimit = value.account.plan_limit
  const paygoUsage = value.account.paygo_usage
  const paygoLimit = value.account.paygo_limit

  if (
    plan !== 'Researcher'
    || !finiteNonNegativeInteger(keyUsage)
    || !finiteNonNegativeInteger(keyLimit)
    || keyLimit > MAX_PROVIDER_KEY_LIMIT
    || !finiteNonNegativeInteger(planUsage)
    || !finiteNonNegativeInteger(planLimit)
    || planLimit > MAX_PROVIDER_PLAN_LIMIT
    || !finiteNonNegativeInteger(paygoUsage)
    || paygoLimit !== 0
  ) throw new TavilyFreeSearchError('free_plan_required', false)

  if (keyUsage >= keyLimit || planUsage >= planLimit || paygoUsage !== 0) {
    throw new TavilyFreeSearchError('free_plan_required', false)
  }
  return { plan, keyUsage, keyLimit, planUsage, planLimit, paygoUsage, paygoLimit }
}

export async function searchTavilyFree(
  query: string,
  config: TavilyFreeConfig,
  fetcher: FetchLike = fetch,
): Promise<TavilySearchSuccess> {
  const value = await boundedFetch(fetcher, TAVILY_SEARCH_ENDPOINT, {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify({
      query,
      search_depth: 'basic',
      auto_parameters: false,
      max_results: TAVILY_MAX_RESULTS,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      include_usage: true,
      safe_search: true,
    }),
  }, TAVILY_SEARCH_TIMEOUT_MS, TAVILY_MAX_SEARCH_BODY_BYTES, true)

  if (!isRecord(value) || !boundedString(value.request_id, 256) || !isRecord(value.usage)) {
    throw new TavilyFreeSearchError('provider_response_invalid', true)
  }
  if (value.usage.credits !== 1) {
    throw new TavilyFreeSearchError('unexpected_credit_usage', true)
  }
  if (!Array.isArray(value.results) || value.results.length > TAVILY_MAX_RESULTS) {
    throw new TavilyFreeSearchError('provider_response_invalid', true)
  }

  const results = value.results.map((item): TavilyDiscoveryResult => {
    if (!isRecord(item)
      || !boundedString(item.title, MAX_TITLE_CHARS)
      || !boundedString(item.url, MAX_URL_CHARS)
      || !boundedString(item.content, MAX_SNIPPET_CHARS)) {
      throw new TavilyFreeSearchError('provider_response_invalid', true)
    }
    let parsed: URL
    try {
      parsed = new URL(item.url)
    }
    catch {
      throw new TavilyFreeSearchError('provider_response_invalid', true)
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new TavilyFreeSearchError('provider_response_invalid', true)
    }
    if (item.score !== undefined && (typeof item.score !== 'number' || !Number.isFinite(item.score))) {
      throw new TavilyFreeSearchError('provider_response_invalid', true)
    }
    return {
      title: item.title,
      url: parsed.toString(),
      snippet: item.content,
      ...(typeof item.score === 'number' ? { score: item.score } : {}),
    }
  })

  return { requestIdHashInput: value.request_id, credits: 1, results }
}
