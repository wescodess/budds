import { readConfiguredRuntimeValue } from './runtime-config'

export interface WhisperWordTiming {
  word: string
  start: number
  end: number
}

function getWhisperConfig() {
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

  if (!accountId || !gatewayId || !workersAiToken) return null

  const url = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/workers-ai/@cf/openai/whisper`

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${workersAiToken}`,
  }
  if (gatewayApiKey) headers['cf-aig-authorization'] = `Bearer ${gatewayApiKey}`

  return { url, headers }
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

// Alignment is performed one 1-3 minute Scene at a time. A three-minute
// mono/24 kHz/16-bit WAV is about 8.7 MB; keep a little bounded headroom.
const MAX_AUDIO_BYTES = 12 * 1024 * 1024

export async function transcribeAudio(audioBytes: Uint8Array): Promise<{ words: WhisperWordTiming[], durationSec: number }> {
  const config = getWhisperConfig()
  if (!config) return { words: [], durationSec: 0 }
  if (audioBytes.length > MAX_AUDIO_BYTES) return { words: [], durationSec: 0 }

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        ...config.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audio: bytesToBase64(audioBytes),
        word_timestamps: true,
      }),
      signal: AbortSignal.timeout(90_000),
    })

    if (!response.ok) return { words: [], durationSec: 0 }

    const json = await response.json() as {
      result?: {
        text?: string
        words?: { word: string, start: number, end: number }[]
        duration?: number
      }
      success?: boolean
    }

    const result = json.result
    if (!result) return { words: [], durationSec: 0 }

    const words: WhisperWordTiming[] = (result.words ?? []).map(w => ({
      word: w.word.trim(),
      start: w.start,
      end: w.end,
    })).filter(w => w.word.length > 0)

    const durationSec = result.duration
      ?? (words.length > 0 ? words[words.length - 1]!.end : 0)

    return { words, durationSec }
  }
  catch {
    return { words: [], durationSec: 0 }
  }
}
