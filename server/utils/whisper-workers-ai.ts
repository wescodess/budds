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

// Alignment is performed one 1-3 minute Scene at a time. A three-minute
// mono/24 kHz/16-bit WAV is about 8.7 MB; keep a little bounded headroom.
const MAX_AUDIO_BYTES = 12 * 1024 * 1024
const CHUNK_DURATION_SECONDS = 5

function fourCc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4))
}

function parsePcmWav(audioBytes: Uint8Array) {
  if (audioBytes.length < 44 || fourCc(audioBytes, 0) !== 'RIFF' || fourCc(audioBytes, 8) !== 'WAVE'
    || fourCc(audioBytes, 12) !== 'fmt ' || fourCc(audioBytes, 36) !== 'data') return null
  const view = new DataView(audioBytes.buffer, audioBytes.byteOffset, audioBytes.byteLength)
  const audioFormat = view.getUint16(20, true)
  const channelCount = view.getUint16(22, true)
  const sampleRate = view.getUint32(24, true)
  const byteRate = view.getUint32(28, true)
  const blockAlign = view.getUint16(32, true)
  const bitsPerSample = view.getUint16(34, true)
  const declaredLength = view.getUint32(40, true)
  const pcmLength = Math.min(declaredLength, audioBytes.length - 44)
  if (audioFormat !== 1 || channelCount !== 1 || sampleRate !== 24_000 || byteRate !== 48_000
    || blockAlign !== 2 || bitsPerSample !== 16 || pcmLength < 2 || pcmLength % blockAlign !== 0) return null
  return { pcm: audioBytes.subarray(44, 44 + pcmLength), byteRate, blockAlign }
}

function wavFromPcm(pcm: Uint8Array): Uint8Array {
  const output = new Uint8Array(44 + pcm.byteLength)
  const view = new DataView(output.buffer)
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index))
  }
  writeText(0, 'RIFF'); view.setUint32(4, 36 + pcm.byteLength, true); writeText(8, 'WAVE'); writeText(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 24_000, true); view.setUint32(28, 48_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  writeText(36, 'data'); view.setUint32(40, pcm.byteLength, true); output.set(pcm, 44)
  return output
}

export async function transcribeAudio(audioBytes: Uint8Array): Promise<{ words: WhisperWordTiming[], durationSec: number }> {
  const config = getWhisperConfig()
  if (!config) return { words: [], durationSec: 0 }
  if (audioBytes.length > MAX_AUDIO_BYTES) return { words: [], durationSec: 0 }
  const parsedWav = parsePcmWav(audioBytes)
  if (!parsedWav) return { words: [], durationSec: 0 }

  try {
    const chunkBytes = CHUNK_DURATION_SECONDS * parsedWav.byteRate
    const words: WhisperWordTiming[] = []
    for (let offset = 0; offset < parsedWav.pcm.length; offset += chunkBytes) {
      const end = Math.min(parsedWav.pcm.length, offset + chunkBytes)
      const alignedEnd = end - (end - offset) % parsedWav.blockAlign
      const chunk = wavFromPcm(parsedWav.pcm.subarray(offset, alignedEnd))
      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          ...config.headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ audio: Array.from(chunk) }),
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
      const chunkOffsetSec = offset / parsedWav.byteRate
      words.push(...(result.words ?? []).map(word => ({
        word: word.word.trim(),
        start: word.start + chunkOffsetSec,
        end: word.end + chunkOffsetSec,
      })).filter(word => word.word.length > 0))
    }

    return { words, durationSec: parsedWav.pcm.length / parsedWav.byteRate }
  }
  catch {
    return { words: [], durationSec: 0 }
  }
}
