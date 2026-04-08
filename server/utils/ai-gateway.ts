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
}

export interface GenerateResponse {
  id: string
  choices: {
    index: number
    message: ChatMessage
    finish_reason: string
  }[]
  model: string
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

function getGatewayConfig() {
  const config = useRuntimeConfig()

  if (!config.cloudflareAccountId || !config.cloudflareAiGatewayId || !config.openrouterApiKey) {
    throw createError({ statusCode: 500, message: 'Missing AI Gateway configuration. Check CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AI_GATEWAY_ID, and OPENROUTER_API_KEY env vars.' })
  }

  const baseUrl = `https://gateway.ai.cloudflare.com/v1/${config.cloudflareAccountId}/${config.cloudflareAiGatewayId}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.openrouterApiKey}`,
  }

  if (config.cloudflareAiGatewayApiKey) {
    headers['cf-aig-authorization'] = `Bearer ${config.cloudflareAiGatewayApiKey}`
  }

  return { baseUrl, headers }
}

export async function generateCompletion(params: GenerateParams): Promise<GenerateResponse> {
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
      stream: false,
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
