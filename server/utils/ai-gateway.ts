import { readConfiguredRuntimeValue } from './runtime-config'
import { deterministicLearnV2Completion } from './learn-v2-e2e-fixtures'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface GenerateParams {
  model: string
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
  stream?: boolean
  maxAttempts?: number
  allowProviderFallbacks?: boolean
  collectLogPayload?: boolean
  requireZeroDataRetention?: boolean
  denyProviderDataCollection?: boolean
  skipGatewayCache?: boolean
  providerOrder?: string[]
  maxPrice?: { prompt: number, completion: number }
  reasoning?: { enabled: boolean }
  jsonMode?: boolean
  signal?: AbortSignal
  maxResponseBytes?: number
  maxRequestBytes?: number
  redactUpstreamErrorBody?: boolean
  jsonSchema?: {
    name: string
    strict?: boolean
    schema: Record<string, unknown>
  }
}

const DEFAULT_MAX_RESPONSE_BYTES = 512_000

export async function readBoundedResponseText(response: Response, maximumBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw providerError({ statusCode: 500, message: 'Invalid AI Gateway response byte limit' }, 'not_dispatched')
  const declaredLength = response.headers?.get?.('content-length')
  if (declaredLength !== null && declaredLength !== undefined) {
    const parsed = Number(declaredLength)
    if (Number.isFinite(parsed) && parsed > maximumBytes) throw providerError({ statusCode: 502, message: 'AI Gateway response exceeded the byte limit' }, 'invalid_response')
  }
  if (response.body?.getReader) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let total = 0
    let text = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maximumBytes) {
          await reader.cancel()
          throw providerError({ statusCode: 502, message: 'AI Gateway response exceeded the byte limit' }, 'invalid_response')
        }
        text += decoder.decode(value, { stream: true })
      }
      return text + decoder.decode()
    }
    finally {
      reader.releaseLock()
    }
  }
  if (typeof response.text === 'function') {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > maximumBytes) throw providerError({ statusCode: 502, message: 'AI Gateway response exceeded the byte limit' }, 'invalid_response')
    return text
  }
  const text = JSON.stringify(await response.json())
  if (new TextEncoder().encode(text).byteLength > maximumBytes) throw providerError({ statusCode: 502, message: 'AI Gateway response exceeded the byte limit' }, 'invalid_response')
  return text
}

export interface GenerateResponse {
  id: string
  choices: {
    index: number
    message: ChatMessage
    finish_reason: string
    native_finish_reason?: string
  }[]
  model: string
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    cost?: number
  }
}

export function validateGenerateResponse(value: unknown): GenerateResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw providerError({ statusCode: 502, message: 'AI Gateway returned an invalid completion envelope' }, 'invalid_response')
  const response = value as Partial<GenerateResponse>
  const firstChoice = Array.isArray(response.choices) ? response.choices[0] : undefined
  if (typeof response.id !== 'string' || !response.id.trim()
    || typeof response.model !== 'string' || !response.model.trim()
    || !firstChoice || typeof firstChoice.message !== 'object' || firstChoice.message === null
    || typeof firstChoice.message.content !== 'string') {
    throw providerError({ statusCode: 502, message: 'AI Gateway returned an invalid completion envelope' }, 'invalid_response')
  }
  return response as GenerateResponse
}

type GatewayRuntimeConfig = {
  cloudflareAccountId?: unknown
  cloudflareAiGatewayId?: unknown
  cloudflareAiGatewayApiKey?: unknown
  openrouterApiKey?: unknown
}

export type AiGatewayFailureKind = 'not_dispatched' | 'definitive_failure' | 'invalid_response' | 'outcome_unknown'

const gatewayGlobals = globalThis as typeof globalThis & {
  useRuntimeConfig?: () => GatewayRuntimeConfig
  createError?: (options: { statusCode: number, message: string }) => Error
}

function providerError(options: { statusCode: number, message: string }, failureKind: AiGatewayFailureKind = 'outcome_unknown') {
  const error = gatewayGlobals.createError?.(options)
    ?? Object.assign(new Error(options.message), { statusCode: options.statusCode })
  return Object.assign(error, { aiGatewayFailureKind: failureKind })
}

export function classifyAiGatewayFailure(error: unknown): AiGatewayFailureKind {
  if (typeof error !== 'object' || error === null || !('aiGatewayFailureKind' in error)) return 'outcome_unknown'
  const kind = (error as { aiGatewayFailureKind?: unknown }).aiGatewayFailureKind
  return kind === 'not_dispatched' || kind === 'definitive_failure' || kind === 'invalid_response'
    ? kind : 'outcome_unknown'
}

function getGatewayConfig() {
  // Convex actions reuse this approved provider boundary outside Nuxt. In that
  // runtime only environment configuration exists; Nitro continues to prefer
  // its runtime config when the auto-import is present.
  const config = gatewayGlobals.useRuntimeConfig?.() ?? {}
  const accountId = readConfiguredRuntimeValue(
    config.cloudflareAccountId,
    'NUXT_CLOUDFLARE_ACCOUNT_ID',
    'CF_ACCOUNT_ID',
  )
  const gatewayId = readConfiguredRuntimeValue(
    config.cloudflareAiGatewayId,
    'NUXT_CLOUDFLARE_AI_GATEWAY_ID',
    'CLOUDFLARE_AI_GATEWAY_ID',
  )
  const gatewayApiKey = readConfiguredRuntimeValue(
    config.cloudflareAiGatewayApiKey,
    'NUXT_CLOUDFLARE_AI_GATEWAY_API_KEY',
    'CLOUDFLARE_AI_GATEWAY_API_KEY',
  )
  const openrouterApiKey = readConfiguredRuntimeValue(
    config.openrouterApiKey,
    'NUXT_OPENROUTER_API_KEY',
    'OPENROUTER_API_KEY',
  )

  if (!accountId || !gatewayId || !openrouterApiKey) {
    const options = {
      statusCode: 500,
      message: 'Missing AI Gateway configuration. Check NUXT_CLOUDFLARE_ACCOUNT_ID/CF_ACCOUNT_ID, NUXT_CLOUDFLARE_AI_GATEWAY_ID/CLOUDFLARE_AI_GATEWAY_ID, and NUXT_OPENROUTER_API_KEY/OPENROUTER_API_KEY.',
    }
    throw providerError(options, 'not_dispatched')
  }

  const baseUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${openrouterApiKey}`,
  }

  if (gatewayApiKey) {
    headers['cf-aig-authorization'] = `Bearer ${gatewayApiKey}`
  }

  return { baseUrl, headers }
}

// Opaque configuration fence for durable consumers. It is not an account or
// credential validity check, and no secret-bearing configuration is returned.
export async function aiGatewayConfigurationDigest() {
  let config: ReturnType<typeof getGatewayConfig> | null = null
  try { config = getGatewayConfig() }
  catch { /* An unconfigured gateway has a stable, non-secret fingerprint. */ }
  const bytes = new TextEncoder().encode(JSON.stringify(config))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function serializeCompletionRequest(params: GenerateParams): string {
  return JSON.stringify({
    model: params.model,
    messages: params.messages,
    temperature: params.temperature ?? 0.7,
    max_tokens: params.max_tokens ?? 2048,
    stream: false,
    ...(params.reasoning ? { reasoning: params.reasoning } : {}),
    ...(params.jsonSchema
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: params.jsonSchema,
          },
          provider: {
            require_parameters: true,
            ...(params.allowProviderFallbacks === false ? { allow_fallbacks: false } : {}),
            ...(params.requireZeroDataRetention ? { zdr: true } : {}),
            ...(params.denyProviderDataCollection ? { data_collection: 'deny' } : {}),
            ...(params.providerOrder?.length ? { order: params.providerOrder, only: params.providerOrder } : {}),
            ...(params.maxPrice ? { max_price: params.maxPrice } : {}),
          },
        }
      : params.jsonMode
      ? {
          response_format: { type: 'json_object' },
          provider: {
            require_parameters: true,
            ...(params.allowProviderFallbacks === false ? { allow_fallbacks: false } : {}),
            ...(params.requireZeroDataRetention ? { zdr: true } : {}),
            ...(params.denyProviderDataCollection ? { data_collection: 'deny' } : {}),
            ...(params.providerOrder?.length ? { order: params.providerOrder, only: params.providerOrder } : {}),
            ...(params.maxPrice ? { max_price: params.maxPrice } : {}),
          },
        }
      : params.maxPrice ? { provider: { max_price: params.maxPrice } } : {}),
  })
}

// Retain only a validated numeric delay, never the raw upstream header. A later
// floor must not be shortened to fit the scheduler's automatic retry window.
export function providerRetryAfterMs(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value || value.length > 128) return undefined
  const text = value.trim()
  const delay = /^\d+(?:\.\d{1,3})?$/.test(text) ? Number(text) * 1000
    : /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text) ? Date.parse(text) - now : NaN
  return validatedProviderRetryDelay(delay, now)
}

export function validatedProviderRetryDelay(value: unknown, now = Date.now()): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const delay = Math.max(0, Math.ceil(value))
  return Number.isSafeInteger(now + delay) && now + delay <= 8_640_000_000_000_000 ? delay : undefined
}

export async function generateCompletion(params: GenerateParams): Promise<GenerateResponse> {
  const deterministic = deterministicLearnV2Completion(params)
  if (deterministic) return deterministic
  const { baseUrl, headers: baseHeaders } = getGatewayConfig()
  const headers = { ...baseHeaders }
  if (params.maxAttempts !== undefined) headers['cf-aig-max-attempts'] = String(params.maxAttempts)
  if (params.collectLogPayload !== undefined) headers['cf-aig-collect-log-payload'] = String(params.collectLogPayload)
  if (params.skipGatewayCache !== undefined) headers['cf-aig-skip-cache'] = String(params.skipGatewayCache)
  const url = `${baseUrl}/openrouter/v1/chat/completions`

  const requestBody = serializeCompletionRequest(params)
  if (params.maxRequestBytes !== undefined && new TextEncoder().encode(requestBody).byteLength > params.maxRequestBytes) {
    throw providerError({ statusCode: 413, message: 'AI Gateway request exceeded the byte limit' }, 'not_dispatched')
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
    signal: params.signal,
    body: requestBody,
  })

  if (!response.ok) {
    const error = params.redactUpstreamErrorBody ? 'Upstream provider request failed'
      : await readBoundedResponseText(response, params.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES)
    const options = { statusCode: response.status, message: `AI Gateway error: ${error}` }
    const delay = providerRetryAfterMs(response.headers?.get?.('retry-after'))
    throw Object.assign(providerError(options, response.status >= 500 ? 'outcome_unknown' : 'definitive_failure'),
      delay !== undefined ? { retryAfterMs: delay } : {})
  }

  const responseText = await readBoundedResponseText(response, params.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES)
  let parsed: unknown
  try {
    parsed = JSON.parse(responseText)
  }
  catch {
    throw providerError({ statusCode: 502, message: 'AI Gateway returned invalid JSON' }, 'invalid_response')
  }
  return validateGenerateResponse(parsed)
}

export async function generateCompletionStream(params: GenerateParams): Promise<ReadableStream> {
  const { baseUrl, headers } = getGatewayConfig()
  const url = `${baseUrl}/openrouter/v1/chat/completions`

  const response = await fetch(url, {
    method: 'POST',
    headers,
    signal: params.signal,
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens ?? 2048,
      stream: true,
    }),
  })

  if (!response.ok) {
    const error = await readBoundedResponseText(response, params.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES)
    throw providerError({ statusCode: response.status, message: `AI Gateway error: ${error}` })
  }

  return response.body!
}
