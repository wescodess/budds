import { AUDIO_OVERVIEW_PROFILE_CURRENT } from '../../../shared/audio-overview-profile'

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com'
const MAX_PCM_BYTES = 16 * 1024 * 1024
const MAX_DEFINITIVE_HTTP_ATTEMPTS = 3
const MAX_PROVIDER_RETRY_DELAY_MS = 120_000
const HOST_NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} .'-]{0,29}$/u

export const GEMINI_AUDIO_PROFILE = AUDIO_OVERVIEW_PROFILE_CURRENT

export type GeminiSceneSpeaker = 'host_a' | 'host_b'

export interface GeminiSceneUtterance {
  speaker: GeminiSceneSpeaker
  text: string
  emotionalIntent?: string
  deliveryIntent?: string
  pauseAfterMs?: number
}

export interface GeminiSceneRenderInput {
  sceneId: string
  utterances: GeminiSceneUtterance[]
  sceneDirection?: string
  hostNames?: { hostA: string, hostB: string }
}

export interface GeminiPcmMetadata {
  encoding: 'pcm_s16le'
  sampleRateHz: 24_000
  bitDepth: 16
  channels: 1
  byteLength: number
  durationMs: number
  providerMimeType: string
  model: typeof GEMINI_AUDIO_PROFILE.model
  audioProfileId: typeof GEMINI_AUDIO_PROFILE.id
  audioProfileVersion: typeof GEMINI_AUDIO_PROFILE.version
}

export interface GeminiSceneRenderResult {
  audio: Uint8Array
  metadata: GeminiPcmMetadata
}

export interface GeminiAudioRendererConfig {
  apiKey: string
  baseUrl?: string
}

export interface GeminiAudioRendererDependencies {
  fetch?: typeof globalThis.fetch
  sleep?: (milliseconds: number) => Promise<void>
  config: GeminiAudioRendererConfig
}

export const GEMINI_API_KEY_TYPE_ERROR
  = 'GEMINI_API_KEY must contain a Google AI Studio API key, not an OAuth access token'

export function geminiApiKeyConfigurationError(value: string | undefined): string | null {
  const credential = value?.trim() ?? ''
  if (!credential) return 'Gemini Audio Renderer is not configured'
  if (/^(?:ya29\.|Bearer\s+)/i.test(credential)) return GEMINI_API_KEY_TYPE_ERROR
  return null
}

type GeminiInteractionAudio = {
  type?: string
  data?: string
  mime_type?: string
  sample_rate?: number
  channels?: number
}

type GeminiInteractionResponse = {
  output_audio?: GeminiInteractionAudio
  steps?: Array<{
    type?: string
    content?: GeminiInteractionAudio[]
  }>
}

function requireNonEmptyText(value: string, field: string, maxLength: number): string {
  const text = value.trim()
  if (!text || text.length > maxLength) throw new Error(`Invalid Gemini Audio Renderer ${field}`)
  return text
}

function validateScene(input: GeminiSceneRenderInput): GeminiSceneRenderInput {
  requireNonEmptyText(input.sceneId, 'scene ID', 200)
  if (!Array.isArray(input.utterances) || input.utterances.length < 2 || input.utterances.length > 100) {
    throw new Error('Gemini Audio Renderer requires 2 to 100 utterances')
  }
  const speakers = new Set<GeminiSceneSpeaker>()
  for (const utterance of input.utterances) {
    if (utterance.speaker !== 'host_a' && utterance.speaker !== 'host_b') {
      throw new Error('Gemini Audio Renderer received an unknown speaker')
    }
    speakers.add(utterance.speaker)
    requireNonEmptyText(utterance.text, 'utterance', 4_000)
    if (utterance.emotionalIntent !== undefined) requireNonEmptyText(utterance.emotionalIntent, 'emotional intent', 300)
    if (utterance.deliveryIntent !== undefined) requireNonEmptyText(utterance.deliveryIntent, 'delivery intent', 300)
    if (utterance.pauseAfterMs !== undefined
      && (!Number.isInteger(utterance.pauseAfterMs) || utterance.pauseAfterMs < 0 || utterance.pauseAfterMs > 10_000)) {
      throw new Error('Invalid Gemini Audio Renderer pause guidance')
    }
  }
  if (speakers.size !== 2) throw new Error('Gemini Audio Renderer scenes require both configured speakers')
  if (input.sceneDirection !== undefined) requireNonEmptyText(input.sceneDirection, 'scene direction', 1_000)
  if (input.hostNames) {
    const hostA = requireNonEmptyText(input.hostNames.hostA, 'host A name', 30)
    const hostB = requireNonEmptyText(input.hostNames.hostB, 'host B name', 30)
    if (!HOST_NAME_PATTERN.test(hostA) || !HOST_NAME_PATTERN.test(hostB)
      || hostA.toLocaleLowerCase() === hostB.toLocaleLowerCase()) {
      throw new Error('Gemini Audio Renderer requires distinct host names')
    }
  }
  return input
}

function speakerName(input: GeminiSceneRenderInput, speaker: GeminiSceneSpeaker): string {
  if (input.hostNames) return speaker === 'host_a' ? input.hostNames.hostA.trim() : input.hostNames.hostB.trim()
  return speaker === 'host_a'
    ? GEMINI_AUDIO_PROFILE.hostA.speakerName
    : GEMINI_AUDIO_PROFILE.hostB.speakerName
}

export function buildGeminiScenePrompt(input: GeminiSceneRenderInput): string {
  validateScene(input)
  const performanceNotes = buildGeminiPerformanceNotes(input)
  const transcript = input.utterances
    .map(utterance => `${speakerName(input, utterance.speaker)}: ${utterance.text.trim()}`)
    .join('\n')

  return [
    `Audio Profile: ${GEMINI_AUDIO_PROFILE.id} version ${GEMINI_AUDIO_PROFILE.version}.`,
    `Director guidance: ${GEMINI_AUDIO_PROFILE.directorGuidance}`,
    performanceNotes,
    `Transcript (speak only these lines; labels identify voices and are not spoken):\n${transcript}`,
  ].filter(Boolean).join('\n\n')
}

/** Exact non-spoken performance text sent to Gemini before the transcript. */
export function buildGeminiPerformanceNotes(input: GeminiSceneRenderInput): string {
  validateScene(input)
  const utteranceNotes = input.utterances.map((utterance, index) => {
    const notes = [
      utterance.emotionalIntent ? `emotion: ${utterance.emotionalIntent.trim()}` : '',
      utterance.deliveryIntent ? `delivery: ${utterance.deliveryIntent.trim()}` : '',
      utterance.pauseAfterMs !== undefined ? `pause after: ${utterance.pauseAfterMs} ms` : '',
    ].filter(Boolean).join('; ')
    return notes ? `${index + 1}. ${speakerName(input, utterance.speaker)} — ${notes}` : ''
  }).filter(Boolean)
  return [
    input.sceneDirection ? `Scene guidance: ${input.sceneDirection.trim()}` : '',
    utteranceNotes.length ? `Per-utterance performance notes (not spoken):\n${utteranceNotes.join('\n')}` : '',
  ].filter(Boolean).join('\n')
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/\s/g, '')
  if (!normalized || normalized.length % 4 !== 0 || normalized.length > Math.ceil(MAX_PCM_BYTES / 3) * 4 + 4) {
    throw new Error('Gemini Audio Renderer returned invalid base64 audio')
  }
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  for (let index = 0; index < normalized.length - padding; index++) {
    const code = normalized.charCodeAt(index)
    const valid = (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
      || (code >= 48 && code <= 57)
      || code === 43
      || code === 47
    if (!valid) throw new Error('Gemini Audio Renderer returned invalid base64 audio')
  }
  try {
    const binary = atob(normalized)
    const output = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) output[index] = binary.charCodeAt(index)
    return output
  }
  catch {
    throw new Error('Gemini Audio Renderer returned invalid base64 audio')
  }
}

function parsePcmMimeType(value: string | undefined, sampleRate?: number, channels?: number): string {
  const mimeType = value?.trim() ?? ''
  const normalized = mimeType.toLowerCase().replace(/\s/g, '')
  const isPcm = normalized === 'audio/l16' || normalized.startsWith('audio/l16;')
    || normalized === 'audio/pcm' || normalized.startsWith('audio/pcm;')
  const rateMatches = sampleRate === 24_000 || /(?:^|;)rate=24000(?:;|$)/.test(normalized)
  if (!isPcm || !rateMatches || (channels !== undefined && channels !== 1)) {
    throw new Error(`Gemini Audio Renderer returned unsupported audio format${mimeType ? `: ${mimeType}` : ''}`)
  }
  return mimeType
}

function findAudio(response: GeminiInteractionResponse): { data: string, mimeType: string } {
  const candidates = [
    response.output_audio,
    ...(response.steps ?? []).flatMap(step => step.type === 'model_output' ? (step.content ?? []) : []),
  ]
  for (const audio of candidates) {
    if (audio?.data && (!audio.type || audio.type === 'audio')) {
      return {
        data: audio.data,
        mimeType: parsePcmMimeType(audio.mime_type, audio.sample_rate, audio.channels),
      }
    }
  }
  throw new Error('Gemini Audio Renderer response did not contain audio')
}

function retryDelayMs(response: Response, detail: string, attempt: number): number {
  const delays = [attempt * 1_000]
  const retryAfter = Number(response.headers.get('retry-after'))
  if (Number.isFinite(retryAfter) && retryAfter >= 0) delays.push(Math.ceil(retryAfter * 1_000))

  for (const pattern of [
    /retry\s+in\s+([0-9]+(?:\.[0-9]+)?)s/i,
    /"retryDelay"\s*:\s*"([0-9]+(?:\.[0-9]+)?)s"/i,
  ]) {
    const seconds = Number(detail.match(pattern)?.[1])
    if (Number.isFinite(seconds) && seconds >= 0) delays.push(Math.ceil(seconds * 1_000))
  }

  return Math.min(Math.max(...delays), MAX_PROVIDER_RETRY_DELAY_MS)
}

function isTransientInteractionsInvalidRequest(response: Response, detail: string): boolean {
  if (response.status !== 400) return false
  try {
    const parsed = JSON.parse(detail) as { error?: { code?: unknown, message?: unknown, details?: unknown } }
    return parsed.error?.code === 'invalid_request'
      && parsed.error.message === 'Request contains an invalid argument.'
      && parsed.error.details === undefined
  }
  catch {
    return false
  }
}

export async function renderGeminiScene(
  input: GeminiSceneRenderInput,
  dependencies: GeminiAudioRendererDependencies,
): Promise<GeminiSceneRenderResult> {
  validateScene(input)
  const config = dependencies.config
  const apiKey = config.apiKey.trim()
  const configurationError = geminiApiKeyConfigurationError(apiKey)
  if (configurationError) throw new Error(configurationError)
  const requestFetch = dependencies.fetch ?? globalThis.fetch
  if (!requestFetch) throw new Error('Gemini Audio Renderer fetch is unavailable')

  const baseUrl = (config.baseUrl?.trim() || GEMINI_API_BASE_URL).replace(/\/+$/, '')
  const url = `${baseUrl}/v1beta/interactions`
  const request: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      model: GEMINI_AUDIO_PROFILE.model,
      input: buildGeminiScenePrompt(input),
      response_format: { type: 'audio' },
      generation_config: {
        speech_config: [
          { speaker: speakerName(input, 'host_a'), voice: GEMINI_AUDIO_PROFILE.hostA.voiceName },
          { speaker: speakerName(input, 'host_b'), voice: GEMINI_AUDIO_PROFILE.hostB.voiceName },
        ],
      },
    }),
  }
  const sleep = dependencies.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  let response: Response | undefined
  for (let attempt = 1; attempt <= MAX_DEFINITIVE_HTTP_ATTEMPTS; attempt++) {
    // A network exception has an ambiguous provider outcome and is deliberately
    // never retried. Retry only definitive capacity failures and the preview
    // Interactions API's detail-free invalid_request response, which is emitted
    // transiently for payloads that succeed unchanged on replay.
    response = await requestFetch(url, request)
    if (response.ok) break
    const detail = (await response.text().catch(() => '')).trim().slice(0, 500)
    const retryable = response.status === 429
      || response.status >= 500
      || isTransientInteractionsInvalidRequest(response, detail)
    if (retryable && attempt < MAX_DEFINITIVE_HTTP_ATTEMPTS) {
      await sleep(retryDelayMs(response, detail, attempt))
      continue
    }
    throw new Error(`Gemini Audio Renderer request failed (${response.status})${detail ? `: ${detail}` : ''}`)
  }
  if (!response?.ok) throw new Error('Gemini Audio Renderer request failed without a definitive response')
  const providerAudio = findAudio(await response.json() as GeminiInteractionResponse)
  const audio = decodeBase64(providerAudio.data)
  if (!audio.byteLength || audio.byteLength % 2 !== 0 || audio.byteLength > MAX_PCM_BYTES) {
    throw new Error('Gemini Audio Renderer returned invalid PCM audio')
  }
  const format = GEMINI_AUDIO_PROFILE.format
  return {
    audio,
    metadata: {
      ...format,
      byteLength: audio.byteLength,
      durationMs: Math.round(audio.byteLength / (format.sampleRateHz * format.channels * (format.bitDepth / 8)) * 1_000),
      providerMimeType: providerAudio.mimeType,
      model: GEMINI_AUDIO_PROFILE.model,
      audioProfileId: GEMINI_AUDIO_PROFILE.id,
      audioProfileVersion: GEMINI_AUDIO_PROFILE.version,
    },
  }
}
