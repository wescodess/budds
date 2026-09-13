import { getErrorStatusCode } from '../../shared/errors'
import { readConfiguredRuntimeValue } from './runtime-config'

export type DiaSpeaker = 'S1' | 'S2'

export interface DiaSynthesizeParams {
  text: string
  speaker: DiaSpeaker
}

function getDiaConfig() {
  const config = useRuntimeConfig()
  const serverUrl = readConfiguredRuntimeValue(
    (config as { diaServerUrl?: string }).diaServerUrl,
    'NUXT_DIA_SERVER_URL',
    'DIA_SERVER_URL',
  )
  const apiKey = readConfiguredRuntimeValue(
    (config as { diaServerApiKey?: string }).diaServerApiKey,
    'NUXT_DIA_SERVER_API_KEY',
    'DIA_SERVER_API_KEY',
  )
  const startFunctionUrl = readConfiguredRuntimeValue(
    (config as { diaStartFunctionUrl?: string }).diaStartFunctionUrl,
    'NUXT_DIA_START_FUNCTION_URL',
    'DIA_START_FUNCTION_URL',
  )

  return { serverUrl, apiKey, startFunctionUrl }
}

export function isDiaConfigured(): boolean {
  try {
    const { serverUrl } = getDiaConfig()
    return !!serverUrl
  }
  catch {
    return false
  }
}

export async function isDiaServerHealthy(): Promise<boolean> {
  try {
    const { serverUrl } = getDiaConfig()
    if (!serverUrl) return false

    const response = await fetch(`${serverUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return false
    const data = await response.json() as { model_loaded?: boolean }
    return !!data.model_loaded
  }
  catch {
    return false
  }
}

export async function ensureDiaServerRunning(): Promise<boolean> {
  if (await isDiaServerHealthy()) return true

  const { startFunctionUrl, apiKey } = getDiaConfig()
  if (!startFunctionUrl) return false

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers['X-API-Key'] = apiKey

    const response = await fetch(startFunctionUrl, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(240_000),
    })

    if (!response.ok) return false
    const data = await response.json() as { status?: string }
    return data.status === 'ready'
  }
  catch {
    return false
  }
}

export async function synthesizeDiaVoice(params: DiaSynthesizeParams): Promise<Uint8Array> {
  const { serverUrl, apiKey } = getDiaConfig()
  if (!serverUrl) {
    throw createError({ statusCode: 500, message: 'Dia server URL not configured' })
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['X-API-Key'] = apiKey

  const response = await fetch(`${serverUrl}/synthesize`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text: params.text, speaker: params.speaker }),
    signal: AbortSignal.timeout(60_000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw createError({ statusCode: response.status, message: `Dia TTS error: ${text || response.statusText}` })
  }

  const buf = await response.arrayBuffer()
  return new Uint8Array(buf)
}

export async function synthesizeDiaVoiceWithRetry(params: DiaSynthesizeParams): Promise<Uint8Array> {
  const backoffsMs = [1000, 2000, 4000]
  let lastError: unknown

  for (let attempt = 0; attempt < backoffsMs.length + 1; attempt++) {
    try {
      return await synthesizeDiaVoice(params)
    }
    catch (err) {
      lastError = err
      const status = getErrorStatusCode(err) ?? 0
      const retriable = status === 0 || (status >= 500 && status < 600) || status === 429
      if (!retriable || attempt >= backoffsMs.length) break
      await new Promise<void>(resolve => setTimeout(resolve, backoffsMs[attempt]!))
    }
  }

  throw lastError
}

export interface DiaDialogueParams {
  script: string
  maxTokens?: number
  requestId?: string
}

export interface DiaDialogueResult {
  audio: Uint8Array
  durationSec: number
  requestId: string
  wordTimings: { word: string, start: number, end: number }[]
}

export async function synthesizeDiaDialogue(params: DiaDialogueParams): Promise<DiaDialogueResult> {
  const { serverUrl, apiKey } = getDiaConfig()
  if (!serverUrl) {
    throw createError({ statusCode: 500, message: 'Dia server URL not configured' })
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['X-API-Key'] = apiKey

  const requestId = params.requestId || crypto.randomUUID()
  const body: Record<string, unknown> = { script: params.script, request_id: requestId }
  if (params.maxTokens) body.max_tokens = params.maxTokens

  const response = await fetch(`${serverUrl}/dialogue`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600_000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw createError({ statusCode: response.status, message: `Dia dialogue error: ${text || response.statusText}` })
  }

  const json = await response.json() as {
    audio?: string
    durationSec?: number
    requestId?: string
    wordTimings?: { word: string, start: number, end: number }[]
  }

  if (!json.audio) {
    throw createError({ statusCode: 502, message: 'Dia dialogue response missing audio' })
  }

  const audioBytes = new Uint8Array(Buffer.from(json.audio, 'base64'))

  return {
    audio: new Uint8Array(audioBytes),
    durationSec: json.durationSec ?? 0,
    requestId: json.requestId ?? requestId,
    wordTimings: json.wordTimings ?? [],
  }
}

export async function cancelDiaRequest(requestId: string): Promise<void> {
  const { serverUrl, apiKey } = getDiaConfig()
  if (!serverUrl) return
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['X-API-Key'] = apiKey
  try {
    await fetch(`${serverUrl}/cancel`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ request_id: requestId }),
      signal: AbortSignal.timeout(5000),
    })
  }
  catch {
    // Cancellation is best effort; the original synthesis error is authoritative.
  }
}

export async function synthesizeDiaDialogueWithRetry(params: DiaDialogueParams): Promise<DiaDialogueResult> {
  const backoffsMs = [2000, 5000]
  let lastError: unknown

  for (let attempt = 0; attempt < backoffsMs.length + 1; attempt++) {
    try {
      return await synthesizeDiaDialogue(params)
    }
    catch (err) {
      lastError = err
      const status = getErrorStatusCode(err) ?? 0
      const retriable = status === 0 || (status >= 500 && status < 600) || status === 429
      if (!retriable || attempt >= backoffsMs.length) break
      await new Promise<void>(resolve => setTimeout(resolve, backoffsMs[attempt]!))
    }
  }

  throw lastError
}
