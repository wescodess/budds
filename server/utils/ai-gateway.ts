import { readConfiguredRuntimeValue } from './runtime-config'
import { deterministicLearnV2Completion } from './learn-v2-e2e-fixtures'
import { z } from 'zod'

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
  captureScoringProvenance?: boolean
  jsonSchema?: {
    name: string
    strict?: boolean
    schema: Record<string, unknown>
  }
}

const DEFAULT_MAX_RESPONSE_BYTES = 512_000

function cancelBody(body: { cancel: () => Promise<unknown> } | null | undefined) {
  try { void Promise.resolve(body?.cancel()).catch(() => undefined) }
  catch { /* Cleanup must not replace the observed outcome. */ }
}

async function readBoundedResponseText(response: Response, maximumBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    cancelBody(response.body)
    throw providerError({ statusCode: 500, message: 'Invalid AI Gateway response byte limit' }, 'not_dispatched')
  }
  const declaredLength = response.headers?.get?.('content-length')
  if (declaredLength !== null && declaredLength !== undefined) {
    const parsed = Number(declaredLength)
    if (Number.isFinite(parsed) && parsed > maximumBytes) {
      cancelBody(response.body)
      throw providerError({ statusCode: 502, message: 'AI Gateway response exceeded the byte limit' }, 'invalid_response')
    }
  }
  if (response.body?.getReader) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let total = 0
    let text = ''
    let complete = false
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) { complete = true; break }
        total += value.byteLength
        if (total > maximumBytes) {
          throw providerError({ statusCode: 502, message: 'AI Gateway response exceeded the byte limit' }, 'invalid_response')
        }
        text += decoder.decode(value, { stream: true })
      }
      return text + decoder.decode()
    }
    finally {
      if (!complete) cancelBody(reader)
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
  scoringProvenance?: GatewayScoringProvenance
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    cost?: number
  }
}

export type ScoringGenerateResponse = Omit<GenerateResponse, 'id' | 'model' | 'usage' | 'scoringProvenance'> & {
  id: string | null, model: string | null, usage?: GenerateResponse['usage'], scoringProvenance: GatewayScoringProvenance
}

export function validateGenerateResponse(value: unknown, captureScoringProvenance?: false): GenerateResponse
export function validateGenerateResponse(value: unknown, captureScoringProvenance: true): ScoringGenerateResponse
export function validateGenerateResponse(value: unknown, captureScoringProvenance: boolean): GenerateResponse | ScoringGenerateResponse
export function validateGenerateResponse(value: unknown, captureScoringProvenance = false): GenerateResponse | ScoringGenerateResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw providerError({ statusCode: 502, message: 'AI Gateway returned an invalid completion envelope' }, 'invalid_response')
  const response = value as Partial<GenerateResponse>
  const firstChoice = Array.isArray(response.choices) ? response.choices[0] : undefined
  if (captureScoringProvenance) {
    const provenance = observeScoringProvenance(value)
    if (response.choices?.length !== 1 || firstChoice?.message?.role !== 'assistant') provenance.metadataValid = false
    return {
      id: optionalObservation(response.id), model: optionalObservation(response.model),
      choices: [{ index: 0, message: { role: 'assistant', content: typeof firstChoice?.message?.content === 'string' ? firstChoice.message.content : '' },
        finish_reason: provenance.finishReason ?? 'unknown', ...(provenance.nativeFinishReason ? { native_finish_reason: provenance.nativeFinishReason } : {}) }],
      ...(provenance.usage ? { usage: { prompt_tokens: provenance.usage.inputTokens, completion_tokens: provenance.usage.outputTokens,
        total_tokens: provenance.usage.inputTokens + provenance.usage.outputTokens } } : {}),
      scoringProvenance: provenance,
    }
  }
  if (typeof response.id !== 'string' || !response.id.trim()
    || typeof response.model !== 'string' || !response.model.trim()
    || !firstChoice || typeof firstChoice.message !== 'object' || firstChoice.message === null
    || typeof firstChoice.message.content !== 'string') {
    throw providerError({ statusCode: 502, message: 'AI Gateway returned an invalid completion envelope' }, 'invalid_response')
  }
  return response as GenerateResponse
}

const observedLabel = z.string().min(1).max(200).regex(/^[\x20-\x7e]+$/)
const observedCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const usageSchema = z.object({ prompt_tokens: observedCount, completion_tokens: observedCount,
  cost: z.number().finite().min(0).optional() })
const routerMetadataSchema = z.object({
  requested: observedLabel.optional(), strategy: observedLabel.optional(), attempt: observedCount.optional(),
  endpoints: z.object({ available: z.array(z.object({ provider: observedLabel, model: observedLabel, selected: z.boolean() })).max(32) }).optional(),
  attempts: z.array(z.object({ provider: observedLabel, model: observedLabel, status: z.number().int().min(100).max(599) })).max(8).optional(),
  pipeline: z.array(z.object({ type: observedLabel })).max(16).optional(),
})
export type GatewayScoringUsage = { inputTokens: number, outputTokens: number, costMicroUsd: number | null }
export type GatewayScoringProvenance = {
  version: 'learn-v2.scoring-provenance.v1'
  metadataValid: boolean
  requestedModel: string | null
  selectedModel: string | null
  servingProvider: string | null
  upstreamRequestId: string | null
  endpoint: null
  revision: null
  fingerprint: string | null
  strategy: string | null
  attemptCount: number | null
  attempts: Array<{ provider: string, model: string, status: number }> | null
  pipelineTypes: string[] | null
  finishReason: string | null
  nativeFinishReason: string | null
  refused: boolean
  errored: boolean
  usage: GatewayScoringUsage | null
}

function optionalObservation(value: unknown): string | null {
  const parsed = observedLabel.safeParse(value)
  return parsed.success ? parsed.data : null
}

function scoringUsage(value: unknown): GatewayScoringUsage | null {
  const parsed = usageSchema.safeParse(value)
  if (!parsed.success) return null
  const cost = parsed.data.cost === undefined ? null : Math.round(parsed.data.cost * 1_000_000)
  if (cost !== null && !Number.isSafeInteger(cost)) return null
  return { inputTokens: parsed.data.prompt_tokens, outputTokens: parsed.data.completion_tokens, costMicroUsd: cost }
}

// Only explicit provider observations enter this vocabulary. Router region,
// requested selectors, summary text and free-form pipeline data are excluded.
export function observeScoringProvenance(value: unknown): GatewayScoringProvenance {
  const root = (value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>
  const metadata = routerMetadataSchema.safeParse(root.openrouter_metadata)
  const router = metadata.success ? metadata.data : null
  const selected = router?.endpoints?.available.filter(row => row.selected) ?? []
  const choice = (Array.isArray(root.choices) ? root.choices[0] : null) as Record<string, unknown> | null
  const message = choice?.message as Record<string, unknown> | undefined
  const provider = optionalObservation(root.provider)
  const chosen = selected.length === 1 ? selected[0]! : null
  return {
    version: 'learn-v2.scoring-provenance.v1',
    metadataValid: (root.openrouter_metadata === undefined || metadata.success) && selected.length <= 1
      && (root.provider === undefined || provider !== null) && !(provider && chosen && provider !== chosen.provider),
    requestedModel: router?.requested ?? null, selectedModel: chosen?.model ?? null,
    servingProvider: chosen?.provider ?? provider, upstreamRequestId: optionalObservation(root.upstream_id),
    // Neither documented metadata endpoint attests an inference endpoint/revision.
    endpoint: null, revision: null, fingerprint: optionalObservation(root.system_fingerprint),
    strategy: router?.strategy ?? null, attemptCount: router?.attempt ?? null,
    attempts: router?.attempts ?? null,
    pipelineTypes: router ? (router.pipeline ?? []).map(row => ['guardrail', 'plugin', 'server_tools', 'response_healing', 'context_compression'].includes(row.type) ? row.type : 'unknown') : null,
    finishReason: optionalObservation(choice?.finish_reason), nativeFinishReason: optionalObservation(choice?.native_finish_reason),
    refused: message?.refusal !== undefined && message.refusal !== null && message.refusal !== '',
    errored: root.error !== undefined || choice?.error !== undefined,
    usage: scoringUsage(root.usage),
  }
}

export type GatewayGenerationMetadata = {
  generationId: string, returnedModel: string | null, servingProvider: string | null, upstreamRequestId: string | null,
  finishReason: string | null, nativeFinishReason: string | null, cancelled: boolean | null, usage: GatewayScoringUsage | null,
}

export function validateGenerationMetadata(value: unknown): GatewayGenerationMetadata {
  const parsed = z.object({ data: z.object({ id: observedLabel, model: observedLabel.nullish(), provider_name: observedLabel.nullish(),
    upstream_id: observedLabel.nullish(), finish_reason: observedLabel.nullish(), native_finish_reason: observedLabel.nullish(),
    cancelled: z.boolean().nullish(), tokens_prompt: observedCount.nullish(), tokens_completion: observedCount.nullish(),
    total_cost: z.number().finite().min(0).nullish() }) }).safeParse(value)
  if (!parsed.success) throw providerError({ statusCode: 502, message: 'Invalid scoring generation metadata' }, 'invalid_response')
  const data = parsed.data.data
  return { generationId: data.id, returnedModel: data.model ?? null, servingProvider: data.provider_name ?? null,
    upstreamRequestId: data.upstream_id ?? null, finishReason: data.finish_reason ?? null,
    nativeFinishReason: data.native_finish_reason ?? null, cancelled: data.cancelled ?? null,
    usage: scoringUsage({ prompt_tokens: data.tokens_prompt, completion_tokens: data.tokens_completion, ...(data.total_cost == null ? {} : { cost: data.total_cost }) }),
  }
}

/** Metadata only: one GET for a saved generation, never stored prompts or inference. */
export async function lookupScoringGeneration(generationId: string, signal: AbortSignal): Promise<GatewayGenerationMetadata> {
  if (!observedLabel.safeParse(generationId).success || signal.aborted) throw providerError({ statusCode: 400, message: 'Invalid scoring metadata lookup' }, 'not_dispatched')
  const { headers } = getGatewayConfig()
  const response = await fetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generationId)}`, {
    method: 'GET', headers: { Authorization: headers.Authorization! }, signal, redirect: 'error',
  })
  const body = await readBoundedResponseText(response, 32_000)
  if (!response.ok) throw providerError({ statusCode: response.status, message: 'Scoring metadata is unavailable' })
  let parsed: unknown
  try { parsed = JSON.parse(body) }
  catch { throw providerError({ statusCode: 502, message: 'Invalid scoring generation metadata' }, 'invalid_response') }
  const metadata = validateGenerationMetadata(parsed)
  if (metadata.generationId !== generationId) throw providerError({ statusCode: 502, message: 'Scoring generation ID mismatch' }, 'invalid_response')
  return metadata
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

export function generateCompletion(params: GenerateParams & { captureScoringProvenance: true }): Promise<ScoringGenerateResponse>
export function generateCompletion(params: GenerateParams): Promise<GenerateResponse>
export async function generateCompletion(params: GenerateParams): Promise<GenerateResponse | ScoringGenerateResponse> {
  const deterministic = deterministicLearnV2Completion(params)
  if (deterministic) return params.captureScoringProvenance ? validateGenerateResponse(deterministic, true) : deterministic
  const { baseUrl, headers: baseHeaders } = getGatewayConfig()
  const headers = { ...baseHeaders }
  if (params.maxAttempts !== undefined) headers['cf-aig-max-attempts'] = String(params.maxAttempts)
  if (params.collectLogPayload !== undefined) headers['cf-aig-collect-log-payload'] = String(params.collectLogPayload)
  if (params.skipGatewayCache !== undefined) headers['cf-aig-skip-cache'] = String(params.skipGatewayCache)
  if (params.captureScoringProvenance) headers['X-OpenRouter-Metadata'] = 'enabled'
  const url = `${baseUrl}/openrouter/v1/chat/completions`

  const requestBody = serializeCompletionRequest(params)
  if (params.maxRequestBytes !== undefined && new TextEncoder().encode(requestBody).byteLength > params.maxRequestBytes) {
    throw providerError({ statusCode: 413, message: 'AI Gateway request exceeded the byte limit' }, 'not_dispatched')
  }
  const maximumBytes = params.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw providerError({ statusCode: 500, message: 'Invalid AI Gateway response byte limit' }, 'not_dispatched')
  }
  if (params.signal?.aborted) throw providerError({ statusCode: 499, message: 'AI Gateway request aborted before send' }, 'not_dispatched')
  const response = await fetch(url, {
    method: 'POST',
    headers,
    signal: params.signal,
    body: requestBody,
    ...(params.captureScoringProvenance ? { redirect: 'error' as const } : {}),
  })

  if (!response.ok) {
    // The HTTP status is already known. Error-body loss or size limits cannot
    // turn a possible execution into a known failure, or the reverse.
    const failure = response.status >= 500 ? 'outcome_unknown' : 'definitive_failure'
    const fallback = 'Upstream provider request failed'
    const error = params.redactUpstreamErrorBody ? fallback : await readBoundedResponseText(response, maximumBytes).catch(() => fallback)
    if (params.redactUpstreamErrorBody) cancelBody(response.body)
    const options = { statusCode: response.status, message: `AI Gateway error: ${error}` }
    const retryAfter = response.headers?.get?.('retry-after')
    const delay = retryAfter ? (/^\d+(?:\.\d+)?$/.test(retryAfter.trim()) ? Number(retryAfter) * 1_000 : Date.parse(retryAfter) - Date.now()) : NaN
    throw Object.assign(providerError(options, failure),
      Number.isFinite(delay) ? { retryAfterMs: Math.max(0, delay) } : {})
  }

  const responseText = await readBoundedResponseText(response, maximumBytes)
  let parsed: unknown
  try {
    parsed = JSON.parse(responseText)
  }
  catch {
    throw providerError({ statusCode: 502, message: 'AI Gateway returned invalid JSON' }, 'invalid_response')
  }
  return validateGenerateResponse(parsed, params.captureScoringProvenance === true)
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
