import { getErrorStatusCode } from '../../shared/errors'
import { readConfiguredRuntimeValue } from './runtime-config'

export type AuraVoice =
  | 'asteria' | 'luna' | 'stella' | 'athena' | 'hera'
  | 'orion' | 'arcas' | 'perseus' | 'angus' | 'orpheus' | 'helios' | 'zeus'

export const FEMALE_VOICES: readonly AuraVoice[] = ['asteria', 'luna', 'stella', 'athena', 'hera']
export const MALE_VOICES: readonly AuraVoice[] = ['orion', 'arcas', 'perseus', 'angus', 'orpheus', 'helios', 'zeus']
export const ALL_AURA_VOICES: readonly AuraVoice[] = [...FEMALE_VOICES, ...MALE_VOICES]

export function isAuraVoice(v: unknown): v is AuraVoice {
  return typeof v === 'string' && (ALL_AURA_VOICES as readonly string[]).includes(v)
}

export interface SynthesizeVoiceParams {
  text: string
  speaker: AuraVoice
  maxAttempts?: number
}

function getWorkersAiConfig() {
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
  const workersAiToken = readConfiguredRuntimeValue(
    (config as { cloudflareWorkersAiToken?: string }).cloudflareWorkersAiToken,
    'NUXT_CLOUDFLARE_WORKERS_AI_TOKEN',
    'CLOUDFLARE_WORKERS_AI_TOKEN',
  ) || readConfiguredRuntimeValue(
    config.cloudflareAiSearchToken,
    'NUXT_CLOUDFLARE_AI_SEARCH_TOKEN',
    'CLOUDFLARE_AI_SEARCH_TOKEN',
  )

  if (!accountId || !gatewayId || !workersAiToken) {
    throw createError({
      statusCode: 500,
      message: 'Missing Workers AI configuration. Check NUXT_CLOUDFLARE_ACCOUNT_ID, NUXT_CLOUDFLARE_AI_GATEWAY_ID, and NUXT_CLOUDFLARE_WORKERS_AI_TOKEN (or a CLOUDFLARE_AI_SEARCH_TOKEN carrying Workers AI Read permission).',
    })
  }

  const baseUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/workers-ai/@cf/deepgram/aura-1`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${workersAiToken}`,
  }
  if (gatewayApiKey) headers['cf-aig-authorization'] = `Bearer ${gatewayApiKey}`

  return { url: baseUrl, headers }
}

export async function synthesizeVoice(params: SynthesizeVoiceParams): Promise<Uint8Array> {
  const { url, headers: baseHeaders } = getWorkersAiConfig()
  const headers = { ...baseHeaders }
  if (params.maxAttempts !== undefined) headers['cf-aig-max-attempts'] = String(params.maxAttempts)

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      text: params.text,
      speaker: params.speaker,
      encoding: 'mp3',
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw createError({ statusCode: response.status, message: `Aura-1 TTS error: ${text || response.statusText}` })
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const json = await response.json() as { result?: { audio?: string }; success?: boolean; errors?: Array<{ message: string }> }
    if (json.success === false) {
      const msg = json.errors?.map(e => e.message).join('; ') ?? 'Workers AI returned success=false'
      throw createError({ statusCode: 502, message: `Aura-1: ${msg}` })
    }
    const audioBase64 = json.result?.audio
    if (!audioBase64) {
      throw createError({ statusCode: 502, message: 'Aura-1 response missing audio payload' })
    }
    return base64ToBytes(audioBase64)
  }

  const buf = await response.arrayBuffer()
  return new Uint8Array(buf)
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = typeof atob === 'function'
    ? atob(b64)
    : Buffer.from(b64, 'base64').toString('binary')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function synthesizeVoiceWithRetry(params: SynthesizeVoiceParams): Promise<Uint8Array> {
  const backoffsMs = [500, 1000, 2000]
  let lastError: unknown

  for (let attempt = 0; attempt < backoffsMs.length + 1; attempt++) {
    try {
      return await synthesizeVoice(params)
    }
    catch (err) {
      lastError = err
      const status = getErrorStatusCode(err) ?? 0
      const retriable = status === 0 || (status >= 500 && status < 600) || status === 429
      if (!retriable || attempt >= backoffsMs.length) break
      await new Promise<void>((resolve) => setTimeout(resolve, backoffsMs[attempt]!))
    }
  }

  throw lastError
}
