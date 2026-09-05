import { describe, expect, test } from 'vitest'
import {
  AUDIO_OVERVIEW_PCM_FORMAT,
  assembleWavBytes,
  createWavByteSequence,
  durationMsForPcmBytes,
  sha256Hex,
  validatePcmScenes,
  type PcmScene,
} from './media'

function pcm16(...samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true))
  return bytes
}

function scene(bytes: Uint8Array, overrides: Partial<PcmScene> = {}): PcmScene {
  return { bytes, ...AUDIO_OVERVIEW_PCM_FORMAT, ...overrides }
}

describe('Audio Overview PCM media', () => {
  test('accepts homogeneous mono 24 kHz signed 16-bit little-endian Scenes', () => {
    const result = validatePcmScenes([
      scene(pcm16(0, 1)),
      scene(pcm16(-1, 32767)),
    ])

    expect(result).toEqual({
      sceneCount: 2,
      pcmByteLength: 8,
      sampleCount: 4,
      durationMs: 1,
      format: AUDIO_OVERVIEW_PCM_FORMAT,
    })
  })

  test.each([
    ['sample rate', { sampleRateHz: 16_000 }],
    ['channel count', { channelCount: 2 }],
    ['bit depth', { bitsPerSample: 24 }],
    ['sample encoding', { sampleEncoding: 'unsigned-integer' as const }],
    ['byte order', { byteOrder: 'big-endian' as const }],
  ])('rejects a Scene with the wrong %s', (_name, override) => {
    expect(() => validatePcmScenes([scene(pcm16(1)), scene(pcm16(2), override)]))
      .toThrow(/homogeneous mono 24 kHz signed 16-bit little-endian PCM/)
  })

  test('rejects empty Scenes and partial PCM frames', () => {
    expect(() => validatePcmScenes([])).toThrow(/at least one Scene/)
    expect(() => validatePcmScenes([scene(new Uint8Array())])).toThrow(/must contain PCM/)
    expect(() => validatePcmScenes([scene(new Uint8Array([1]))])).toThrow(/complete PCM frames/)
  })

  test('computes PCM duration and a stable SHA-256 checksum', async () => {
    expect(durationMsForPcmBytes(48_000)).toBe(1000)
    expect(durationMsForPcmBytes(48_002)).toBe(1000)
    expect(await sha256Hex(new TextEncoder().encode('abc')))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  test('emits a streaming-safe WAV header followed by untouched Scene bytes', () => {
    const first = scene(pcm16(0, 32767))
    const second = scene(pcm16(-32768, 1))
    const sequence = createWavByteSequence([first, second])

    expect(sequence.parts).toEqual([sequence.header, first.bytes, second.bytes])
    expect(sequence.totalByteLength).toBe(52)

    const header = sequence.header
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
    expect(new TextDecoder().decode(header.subarray(0, 4))).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(44)
    expect(new TextDecoder().decode(header.subarray(8, 12))).toBe('WAVE')
    expect(new TextDecoder().decode(header.subarray(12, 16))).toBe('fmt ')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(24_000)
    expect(view.getUint32(28, true)).toBe(48_000)
    expect(view.getUint16(32, true)).toBe(2)
    expect(view.getUint16(34, true)).toBe(16)
    expect(new TextDecoder().decode(header.subarray(36, 40))).toBe('data')
    expect(view.getUint32(40, true)).toBe(8)

    expect(assembleWavBytes([first, second])).toEqual(new Uint8Array([
      ...header,
      ...first.bytes,
      ...second.bytes,
    ]))
  })
})
