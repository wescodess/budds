import { readConfiguredRuntimeValue } from './runtime-config'

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
  jsonMode?: boolean
  jsonSchema?: {
    name: string
    strict?: boolean
    schema: Record<string, unknown>
  }
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

function getGatewayConfig() {
  const config = useRuntimeConfig()
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
    throw createError({
      statusCode: 500,
      message: 'Missing AI Gateway configuration. Check NUXT_CLOUDFLARE_ACCOUNT_ID/CF_ACCOUNT_ID, NUXT_CLOUDFLARE_AI_GATEWAY_ID/CLOUDFLARE_AI_GATEWAY_ID, and NUXT_OPENROUTER_API_KEY/OPENROUTER_API_KEY.',
    })
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
  const { baseUrl, headers: baseHeaders } = getGatewayConfig()
  const headers = { ...baseHeaders }
  if (params.maxAttempts !== undefined) headers['cf-aig-max-attempts'] = String(params.maxAttempts)
  const url = `${baseUrl}/openrouter/v1/chat/completions`

  const response = await fetch(url, {
    method: 'POST',
    headers,
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
            provider: { require_parameters: true },
          }
        : params.jsonMode
        ? {
            response_format: { type: 'json_object' },
            provider: { require_parameters: true },
          }
        : {}),
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw createError({ statusCode: response.status, message: `AI Gateway error: ${error}` })
  }

  return response.json()
}

export async function generateCompletionStream(params: GenerateParams): Promise<ReadableStream> {
  const { baseUrl, headers } = getGatewayConfig()
  const url = `${baseUrl}/openrouter/v1/chat/completions`

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens ?? 2048,
      stream: true,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw createError({ statusCode: response.status, message: `AI Gateway error: ${error}` })
  }

  return response.body!
}
