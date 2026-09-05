import { describe, expect, test, vi } from 'vitest'
import { WORKERS_AI_TRANSCRIPTION_MODEL, transcribePcmScene } from './workers-ai-transcriber'

function pcm16(...samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true))
  return bytes
}

describe('Workers AI Scene transcription', () => {
  test('sends a WAV-wrapped PCM Scene to Whisper Large v3 Turbo and returns observed text', async () => {
    const run = vi.fn(async (
      _model: typeof WORKERS_AI_TRANSCRIPTION_MODEL,
      _input: { audio: string, task: 'transcribe', vad_filter: boolean, condition_on_previous_text: boolean },
    ) => ({ text: 'Observed scene transcript.' }))

    await expect(transcribePcmScene(pcm16(4_000, -4_000), { run })).resolves.toBe('Observed scene transcript.')

    expect(run).toHaveBeenCalledWith(WORKERS_AI_TRANSCRIPTION_MODEL, expect.objectContaining({
      task: 'transcribe',
      audio: expect.any(String),
    }))
    const input = run.mock.calls[0]![1]
    const wav = Uint8Array.from(atob(input.audio), character => character.charCodeAt(0))
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe('WAVE')
    expect(wav.byteLength).toBe(48)
  })

  test('returns an empty observed transcript so silence can be recorded as rejected evidence', async () => {
    const run = vi.fn(async (
      _model: typeof WORKERS_AI_TRANSCRIPTION_MODEL,
      _input: { audio: string, task: 'transcribe', vad_filter: boolean, condition_on_previous_text: boolean },
    ) => ({ text: '   ' }))

    await expect(transcribePcmScene(pcm16(1, -1), { run })).resolves.toBe('')
  })

  test('fails honestly when Workers AI omits its transcript result', async () => {
    const run = vi.fn(async (
      _model: typeof WORKERS_AI_TRANSCRIPTION_MODEL,
      _input: { audio: string, task: 'transcribe', vad_filter: boolean, condition_on_previous_text: boolean },
    ) => ({}))

    await expect(transcribePcmScene(pcm16(1, -1), { run })).rejects.toThrow(/missing transcript result/i)
  })

  test('[P0] retries transient Workers AI inference failures without rerendering audio', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('InferenceUpstreamError: internal error'))
      .mockResolvedValueOnce({ text: 'Recovered observed transcript.' })
    const sleep = vi.fn(async () => {})

    await expect(transcribePcmScene(pcm16(1, -1), { run }, { sleep }))
      .resolves.toBe('Recovered observed transcript.')

    expect(run).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(1_000)
  })
})
