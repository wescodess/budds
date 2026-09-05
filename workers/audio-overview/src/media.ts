export const AUDIO_OVERVIEW_PCM_FORMAT = {
  sampleRateHz: 24_000,
  channelCount: 1,
  bitsPerSample: 16,
  sampleEncoding: 'signed-integer',
  byteOrder: 'little-endian',
} as const

export type PcmScene = {
  bytes: Uint8Array
  sampleRateHz: number
  channelCount: number
  bitsPerSample: number
  sampleEncoding: 'signed-integer' | 'unsigned-integer' | 'float'
  byteOrder: 'little-endian' | 'big-endian'
}

export type ValidatedPcmScenes = {
  sceneCount: number
  pcmByteLength: number
  sampleCount: number
  durationMs: number
  format: typeof AUDIO_OVERVIEW_PCM_FORMAT
}

export type WavByteSequence = ValidatedPcmScenes & {
  header: Uint8Array
  parts: readonly Uint8Array[]
  totalByteLength: number
}

const WAV_HEADER_BYTES = 44
const MAX_WAV_PCM_BYTES = 0xffff_ffff - 36
const PCM_BYTES_PER_SAMPLE = AUDIO_OVERVIEW_PCM_FORMAT.bitsPerSample / 8
const PCM_BYTES_PER_SECOND = AUDIO_OVERVIEW_PCM_FORMAT.sampleRateHz
  * AUDIO_OVERVIEW_PCM_FORMAT.channelCount
  * PCM_BYTES_PER_SAMPLE

function isProductionPcmFormat(scene: PcmScene): boolean {
  return scene.sampleRateHz === AUDIO_OVERVIEW_PCM_FORMAT.sampleRateHz
    && scene.channelCount === AUDIO_OVERVIEW_PCM_FORMAT.channelCount
    && scene.bitsPerSample === AUDIO_OVERVIEW_PCM_FORMAT.bitsPerSample
    && scene.sampleEncoding === AUDIO_OVERVIEW_PCM_FORMAT.sampleEncoding
    && scene.byteOrder === AUDIO_OVERVIEW_PCM_FORMAT.byteOrder
}

export function durationMsForPcmBytes(pcmByteLength: number): number {
  if (!Number.isSafeInteger(pcmByteLength) || pcmByteLength < 0 || pcmByteLength % PCM_BYTES_PER_SAMPLE !== 0) {
    throw new RangeError('PCM byte length must describe complete signed 16-bit samples')
  }
  if (pcmByteLength === 0) return 0
  return Math.max(1, Math.round(pcmByteLength / PCM_BYTES_PER_SECOND * 1000))
}

export function validatePcmScenes(scenes: readonly PcmScene[]): ValidatedPcmScenes {
  if (scenes.length === 0) throw new RangeError('Audio Overview requires at least one Scene')

  let pcmByteLength = 0
  for (const scene of scenes) {
    if (!isProductionPcmFormat(scene)) {
      throw new TypeError('Every Scene must use homogeneous mono 24 kHz signed 16-bit little-endian PCM')
    }
    if (scene.bytes.byteLength === 0) throw new RangeError('Every Scene must contain PCM samples')
    if (scene.bytes.byteLength % PCM_BYTES_PER_SAMPLE !== 0) {
      throw new RangeError('Every Scene must contain complete PCM frames')
    }
    pcmByteLength += scene.bytes.byteLength
    if (!Number.isSafeInteger(pcmByteLength) || pcmByteLength > MAX_WAV_PCM_BYTES) {
      throw new RangeError('Audio Artifact exceeds the WAV RIFF size limit')
    }
  }

  return {
    sceneCount: scenes.length,
    pcmByteLength,
    sampleCount: pcmByteLength / PCM_BYTES_PER_SAMPLE,
    durationMs: durationMsForPcmBytes(pcmByteLength),
    format: AUDIO_OVERVIEW_PCM_FORMAT,
  }
}

export function createWavHeader(pcmByteLength: number): Uint8Array {
  if (!Number.isSafeInteger(pcmByteLength) || pcmByteLength < 0 || pcmByteLength > MAX_WAV_PCM_BYTES) {
    throw new RangeError('PCM byte length exceeds the WAV RIFF size limit')
  }
  if (pcmByteLength % PCM_BYTES_PER_SAMPLE !== 0) {
    throw new RangeError('PCM byte length must describe complete PCM frames')
  }

  const header = new Uint8Array(WAV_HEADER_BYTES)
  const view = new DataView(header.buffer)
  const writeTag = (offset: number, tag: string) => {
    for (let index = 0; index < tag.length; index++) header[offset + index] = tag.charCodeAt(index)
  }

  writeTag(0, 'RIFF')
  view.setUint32(4, 36 + pcmByteLength, true)
  writeTag(8, 'WAVE')
  writeTag(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, AUDIO_OVERVIEW_PCM_FORMAT.channelCount, true)
  view.setUint32(24, AUDIO_OVERVIEW_PCM_FORMAT.sampleRateHz, true)
  view.setUint32(28, PCM_BYTES_PER_SECOND, true)
  view.setUint16(32, PCM_BYTES_PER_SAMPLE * AUDIO_OVERVIEW_PCM_FORMAT.channelCount, true)
  view.setUint16(34, AUDIO_OVERVIEW_PCM_FORMAT.bitsPerSample, true)
  writeTag(36, 'data')
  view.setUint32(40, pcmByteLength, true)
  return header
}

export function createWavByteSequence(scenes: readonly PcmScene[]): WavByteSequence {
  const validated = validatePcmScenes(scenes)
  const header = createWavHeader(validated.pcmByteLength)
  return {
    ...validated,
    header,
    parts: [header, ...scenes.map(scene => scene.bytes)],
    totalByteLength: WAV_HEADER_BYTES + validated.pcmByteLength,
  }
}

export function assembleWavBytes(scenes: readonly PcmScene[]): Uint8Array {
  const sequence = createWavByteSequence(scenes)
  const wav = new Uint8Array(sequence.totalByteLength)
  let offset = 0
  for (const part of sequence.parts) {
    wav.set(part, offset)
    offset += part.byteLength
  }
  return wav
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
