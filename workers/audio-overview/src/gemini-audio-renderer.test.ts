import { describe, expect, test, vi } from 'vitest'
import {
  buildGeminiScenePrompt,
  GEMINI_AUDIO_PROFILE_V1,
  renderGeminiScene,
  type GeminiSceneRenderInput,
} from './gemini-audio-renderer'

const scene: GeminiSceneRenderInput = {
  sceneId: 'opening',
  sceneDirection: 'Begin reflective, then let the discovery feel energizing.',
  utterances: [
    {
      speaker: 'host_a',
      text: 'The first result changes how we frame the problem.',
      emotionalIntent: 'thoughtful confidence',
      deliveryIntent: 'measured, then brighten on changes',
      pauseAfterMs: 450,
    },
    {
      speaker: 'host_b',
      text: 'Wait, does that mean the earlier assumption no longer holds?',
      emotionalIntent: 'genuine surprise',
      deliveryIntent: 'quick but clear',
      pauseAfterMs: 250,
    },
  ],
}

function audioResponse(data = btoa(String.fromCharCode(1, 0, 2, 0)), mimeType = 'audio/L16;codec=pcm;rate=24000') {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ inlineData: { data, mimeType } }] } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('Gemini Audio Renderer', () => {
  test('uses the native two-speaker generateContent contract and fixed versioned profile', async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(audioResponse())

    await renderGeminiScene(scene, {
      fetch: requestFetch,
      config: { apiKey: 'test-key', baseUrl: 'https://gemini.test/' },
    })

    expect(requestFetch).toHaveBeenCalledOnce()
    const [url, init] = requestFetch.mock.calls[0]!
    expect(url).toBe('https://gemini.test/v1beta/models/gemini-2.5-flash-preview-tts:generateContent')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json', 'x-goog-api-key': 'test-key' })
    const body = JSON.parse(init?.body as string)
    expect(body.generationConfig.responseModalities).toEqual(['AUDIO'])
    expect(body.generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs).toEqual([
      { speaker: 'Host A', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
      { speaker: 'Host B', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
    ])
    const prompt = body.contents[0].parts[0].text as string
    expect(prompt).toContain(`Audio Profile: ${GEMINI_AUDIO_PROFILE_V1.id} version 1.`)
    expect(prompt).toContain('Scene guidance: Begin reflective')
    expect(prompt).toContain('emotion: thoughtful confidence')
    expect(prompt).toContain('delivery: quick but clear')
    expect(prompt).toContain('pause after: 450 ms')
    expect(prompt).toContain('Host A: The first result')
    expect(prompt).toContain('Host B: Wait, does that mean')
  })

  test('returns raw mono 24 kHz 16-bit PCM metadata', async () => {
    const result = await renderGeminiScene(scene, {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(audioResponse()),
      config: { apiKey: 'test-key' },
    })

    expect([...result.audio]).toEqual([1, 0, 2, 0])
    expect(result.metadata).toEqual({
      encoding: 'pcm_s16le',
      sampleRateHz: 24_000,
      bitDepth: 16,
      channels: 1,
      byteLength: 4,
      durationMs: 0,
      providerMimeType: 'audio/L16;codec=pcm;rate=24000',
      model: 'gemini-2.5-flash-preview-tts',
      audioProfileId: 'budds-two-host-gemini-v1',
      audioProfileVersion: 1,
    })
  })

  test('decodes production-sized base64 audio without recursive regex overflow', async () => {
    const data = 'AQID'.repeat(400_000)
    const result = await renderGeminiScene(scene, {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(audioResponse(data)),
      config: { apiKey: 'test-key' },
    })

    expect(result.audio.byteLength).toBe(1_200_000)
  })

  test('requires both transcript speakers before making a provider call', async () => {
    const requestFetch = vi.fn<typeof fetch>()
    await expect(renderGeminiScene({ ...scene, utterances: [scene.utterances[0]!, { ...scene.utterances[0]! }] }, {
      fetch: requestFetch,
      config: { apiKey: 'test-key' },
    })).rejects.toThrow('require both configured speakers')
    expect(requestFetch).not.toHaveBeenCalled()
  })

  test('rejects invalid pause guidance before making a provider call', async () => {
    const requestFetch = vi.fn<typeof fetch>()
    await expect(renderGeminiScene({
      ...scene,
      utterances: [{ ...scene.utterances[0]!, pauseAfterMs: -1 }, scene.utterances[1]!],
    }, { fetch: requestFetch, config: { apiKey: 'test-key' } })).rejects.toThrow('pause guidance')
    expect(requestFetch).not.toHaveBeenCalled()
  })

  test('rejects non-retryable provider errors with bounded detail', async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response('bad request', { status: 400 }))
    await expect(renderGeminiScene(scene, {
      fetch: requestFetch,
      config: { apiKey: 'test-key' },
    })).rejects.toThrow('request failed (400): bad request')
    expect(requestFetch).toHaveBeenCalledOnce()
  })

  test('retries only definitive 429/5xx responses before accepting audio', async () => {
    const requestFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('high demand', { status: 503 }))
      .mockResolvedValueOnce(audioResponse())
    const sleep = vi.fn(async () => {})

    await expect(renderGeminiScene(scene, {
      fetch: requestFetch,
      sleep,
      config: { apiKey: 'test-key' },
    })).resolves.toMatchObject({ metadata: { audioProfileVersion: 1 } })

    expect(requestFetch).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(1_000)
  })

  test('[P0] honors the provider retry delay before replaying a definitive 429', async () => {
    const requestFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          code: 429,
          message: 'Quota exhausted. Please retry in 9.08817314s.',
          details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '9s' }],
        },
      }), { status: 429, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(audioResponse())
    const sleep = vi.fn(async () => {})

    await expect(renderGeminiScene(scene, {
      fetch: requestFetch,
      sleep,
      config: { apiKey: 'test-key' },
    })).resolves.toMatchObject({ metadata: { audioProfileVersion: 1 } })

    expect(requestFetch).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(9_089)
  })

  test.each([
    ['missing audio', audioResponse('', 'audio/L16;codec=pcm;rate=24000'), 'did not contain audio'],
    ['invalid base64', audioResponse('not-base64', 'audio/L16;codec=pcm;rate=24000'), 'invalid base64 audio'],
    ['wrong sample rate', audioResponse(undefined, 'audio/L16;codec=pcm;rate=16000'), 'unsupported audio format'],
    ['compressed audio', audioResponse(undefined, 'audio/mpeg'), 'unsupported audio format'],
  ])('rejects %s responses', async (_name, response, message) => {
    await expect(renderGeminiScene(scene, {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
      config: { apiKey: 'test-key' },
    })).rejects.toThrow(message)
  })

  test('requires injected or runtime API configuration', async () => {
    await expect(renderGeminiScene(scene, {
      fetch: vi.fn<typeof fetch>(),
      config: { apiKey: '   ' },
    })).rejects.toThrow('not configured')
  })

  test('keeps performance metadata out of transcript lines', () => {
    const prompt = buildGeminiScenePrompt(scene)
    const transcript = prompt.slice(prompt.indexOf('Transcript'))
    expect(transcript).not.toContain('thoughtful confidence')
    expect(transcript).not.toContain('pause after')
  })
})
