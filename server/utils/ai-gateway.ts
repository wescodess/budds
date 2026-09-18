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
  jsonMode?: boolean
  signal?: AbortSignal
  maxResponseBytes?: number
  jsonSchema?: {
    name: string
    strict?: boolean
    schema: Record<string, unknown>
  }
}

const DEFAULT_MAX_RESPONSE_BYTES = 512_000

async function readBoundedResponseText(response: Response, maximumBytes: number): Promise<string> {
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

function validateGenerateResponse(value: unknown): GenerateResponse {
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

export async function generateCompletion(params: GenerateParams): Promise<GenerateResponse> {
  const deterministic = deterministicLearnV2Completion(params)
  if (deterministic) return deterministic
  const { baseUrl, headers: baseHeaders } = getGatewayConfig()
  const headers = { ...baseHeaders }
  if (params.maxAttempts !== undefined) headers['cf-aig-max-attempts'] = String(params.maxAttempts)
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
      stream: false,
      ...(params.jsonSchema
        ? {
            response_format: {
              type: 'json_schema',
              json_schema: params.jsonSchema,
            },
            provider: {
              require_parameters: true,
              ...(params.allowProviderFallbacks === false ? { allow_fallbacks: false } : {}),
            },
          }
        : params.jsonMode
        ? {
            response_format: { type: 'json_object' },
            provider: { require_parameters: true },
          }
        : {}),
    }),
  })

  const responseText = await readBoundedResponseText(response, params.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES)
  if (!response.ok) {
    const error = responseText
    const options = { statusCode: response.status, message: `AI Gateway error: ${error}` }
    throw providerError(options, response.status >= 500 ? 'outcome_unknown' : 'definitive_failure')
  }

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
