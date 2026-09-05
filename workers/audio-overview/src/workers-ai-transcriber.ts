import { createWavHeader } from './media'

export const WORKERS_AI_TRANSCRIPTION_MODEL = '@cf/openai/whisper-large-v3-turbo' as const

type WorkersAiTranscriptionBinding = {
  run(
    model: typeof WORKERS_AI_TRANSCRIPTION_MODEL,
    input: { audio: string, task: 'transcribe', vad_filter: boolean, condition_on_previous_text: boolean },
  ): Promise<{ text?: string }>
}

const MAX_PCM_BYTES = 12 * 1024 * 1024
const BASE64_CHUNK_BYTES = 0x8000
const MAX_TRANSCRIPTION_ATTEMPTS = 3

type WorkersAiTranscriptionDependencies = {
  sleep?: (milliseconds: number) => Promise<void>
}

function wavForPcm(pcm: Uint8Array): Uint8Array {
  if (pcm.byteLength === 0 || pcm.byteLength % 2 !== 0 || pcm.byteLength > MAX_PCM_BYTES) {
    throw new RangeError('Scene PCM cannot be transcribed safely')
  }
  const header = createWavHeader(pcm.byteLength)
  const wav = new Uint8Array(header.byteLength + pcm.byteLength)
  wav.set(header)
  wav.set(pcm, header.byteLength)
  return wav
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.byteLength; offset += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES))
  }
  return btoa(binary)
}

export async function transcribePcmScene(
  pcm: Uint8Array,
  ai: WorkersAiTranscriptionBinding,
  dependencies: WorkersAiTranscriptionDependencies = {},
): Promise<string> {
  const input = {
    audio: bytesToBase64(wavForPcm(pcm)),
    task: 'transcribe' as const,
    vad_filter: false,
    condition_on_previous_text: false,
  }
  const sleep = dependencies.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  for (let attempt = 1; attempt <= MAX_TRANSCRIPTION_ATTEMPTS; attempt++) {
    try {
      const result = await ai.run(WORKERS_AI_TRANSCRIPTION_MODEL, input)
      if (typeof result.text !== 'string') throw new Error('Workers AI returned a missing transcript result for the Scene')
      return result.text.trim()
    }
    catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      const transient = /InferenceUpstreamError|internal error|network|timeout|temporar|rate.?limit|\b429\b|\b5\d\d\b/i.test(message)
      if (!transient || attempt === MAX_TRANSCRIPTION_ATTEMPTS) throw error
      await sleep(attempt * 1_000)
    }
  }
  throw new Error('Workers AI transcription failed without a result')
}
