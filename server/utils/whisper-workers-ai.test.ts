import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { transcribeAudio } from './whisper-workers-ai'

function wav(durationSec: number): Uint8Array {
  const pcmLength = durationSec * 48_000
  const output = new Uint8Array(44 + pcmLength)
  const view = new DataView(output.buffer)
  const text = (offset: number, value: string) => value.split('').forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, 36 + pcmLength, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 24_000, true); view.setUint32(28, 48_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, pcmLength, true)
  return output
}

describe('Workers AI Whisper transcription', () => {
  beforeEach(() => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      cloudflareAccountId: 'account',
      cloudflareAiGatewayId: 'gateway',
      cloudflareWorkersAiToken: 'token',
    }))
  })

  afterEach(() => vi.unstubAllGlobals())

  test('sends bounded WAV byte arrays and offsets word timestamps across chunks', async () => {
    const requestFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ result: { words: [{ word: ' First ', start: 1, end: 2 }] }, success: true }))
      .mockResolvedValueOnce(Response.json({ result: { words: [{ word: 'second', start: 0.5, end: 1 }] }, success: true }))
      .mockResolvedValueOnce(Response.json({ result: { words: [{ word: 'last', start: 0, end: 0.5 }] }, success: true }))
    vi.stubGlobal('fetch', requestFetch)

    const result = await transcribeAudio(wav(11))

    expect(requestFetch).toHaveBeenCalledTimes(3)
    const bodies = requestFetch.mock.calls.map(([, init]) => JSON.parse(init?.body as string))
    expect(bodies.every(body => Array.isArray(body.audio))).toBe(true)
    expect(Math.max(...bodies.map(body => body.audio.length))).toBeLessThanOrEqual(240_044)
    expect(result.words).toEqual([
      { word: 'First', start: 1, end: 2 },
      { word: 'second', start: 5.5, end: 6 },
      { word: 'last', start: 10, end: 10.5 },
    ])
    expect(result.durationSec).toBe(11)
  })
})
