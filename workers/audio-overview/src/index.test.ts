import { describe, expect, test, vi } from 'vitest'

vi.mock('cloudflare:workers', () => ({
  WorkflowEntrypoint: class { readonly mocked = true },
}))
vi.mock('cloudflare:workflows', () => ({
  NonRetryableError: class NonRetryableError extends Error {},
}))

const { default: worker } = await import('./index')

function request(token = 'worker-token') {
  return new Request('https://worker.test/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ jobId: 'job_1', capability: 'a'.repeat(43) }),
  })
}

function environment(overrides: Record<string, unknown> = {}) {
  const create = vi.fn(async () => undefined)
  return {
    env: {
      AUDIO_OVERVIEW_WORKER_TOKEN: 'worker-token',
      GEMINI_API_KEY: 'gemini-key',
      PAGES_BASE_URL: 'https://pages.test',
      AI: { run: vi.fn() },
      AUDIO_ARTIFACTS: {},
      AUDIO_OVERVIEW_WORKFLOW: { create, get: vi.fn() },
      ...overrides,
    } as unknown as Env,
    create,
  }
}

describe('audio overview Worker start boundary', () => {
  test('fails closed when the Worker-owned renderer, ASR, or private R2 plane is missing', async () => {
    const { env, create } = environment({ GEMINI_API_KEY: '', AI: undefined, AUDIO_ARTIFACTS: undefined })
    const response = await worker.fetch(request(), env)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Audio overview generation plane is not configured' })
    expect(create).not.toHaveBeenCalled()
  })

  test('does not start generation when the Workers AI transcription binding is unavailable', async () => {
    const { env, create } = environment({ AI: undefined })
    const response = await worker.fetch(request(), env)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Audio overview generation plane is not configured' })
    expect(create).not.toHaveBeenCalled()
  })

  test('starts a Workflow only after callback, renderer, and artifact bindings are present', async () => {
    const { env, create } = environment()
    const response = await worker.fetch(request(), env)

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ accepted: true, duplicate: false, id: 'audio-job_1' })
    expect(create).toHaveBeenCalledWith({
      id: 'audio-job_1',
      params: { jobId: 'job_1', capability: 'a'.repeat(43) },
    })
  })
})

function geminiAudioResponse(bytes = new Uint8Array([1, 0, 2, 0])) {
  const data = btoa(String.fromCharCode(...bytes))
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ inlineData: { data, mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function interjectionRequest(method: 'POST' | 'DELETE' = 'POST') {
  return new Request('https://worker.test/interjections/render', {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer worker-token' },
    body: JSON.stringify({
      jobId: 'job_1',
      interjectionId: 'interjection_1',
      idempotencyKey: 'interjection-request-0001',
      utterances: method === 'POST'
        ? [
            { speaker: 'host_a', text: 'Gravity bends the path.', emotionalIntent: 'helpful', deliveryIntent: 'warm' },
            { speaker: 'host_b', text: 'So the object keeps falling around it.', emotionalIntent: 'curious', deliveryIntent: 'clear' },
          ]
        : undefined,
    }),
  })
}

describe('audio overview Worker Interjection boundary', () => {
  test('renders both managed Hosts into one private WAV and reuses the immutable artifact idempotently', async () => {
    const stored = new Map<string, { bytes: Uint8Array, customMetadata: Record<string, string>, etag: string }>()
    const bucket = {
      head: vi.fn(async (key: string) => {
        const value = stored.get(key)
        return value ? { size: value.bytes.byteLength, etag: value.etag, customMetadata: value.customMetadata } : null
      }),
      put: vi.fn(async (key: string, value: Uint8Array, options: { customMetadata: Record<string, string> }) => {
        stored.set(key, { bytes: value, customMetadata: options.customMetadata, etag: 'etag-1' })
        return { etag: 'etag-1' }
      }),
      delete: vi.fn(async (key: string) => { stored.delete(key) }),
    }
    const { env } = environment({ AUDIO_ARTIFACTS: bucket })
    const providerFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(geminiAudioResponse())

    const first = await worker.fetch(interjectionRequest(), env)
    const duplicate = await worker.fetch(interjectionRequest(), env)

    expect(first.status).toBe(201)
    expect(await first.json()).toMatchObject({
      duplicate: false,
      artifact: {
        objectKey: 'audio-overviews/jobs/job_1/interjections/interjection_1.wav',
        contentType: 'audio/wav',
        byteLength: 48,
      },
    })
    expect(duplicate.status).toBe(200)
    expect(await duplicate.json()).toMatchObject({ duplicate: true })
    expect(providerFetch).toHaveBeenCalledOnce()
    expect(bucket.put).toHaveBeenCalledOnce()
    const storedWav = stored.get('audio-overviews/jobs/job_1/interjections/interjection_1.wav')!.bytes
    expect(new TextDecoder().decode(storedWav.subarray(0, 4))).toBe('RIFF')
    providerFetch.mockRestore()
  })

  test('requires service authentication and supports explicit idempotent cancellation cleanup', async () => {
    const bucket = {
      head: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(async () => undefined),
    }
    const { env } = environment({ AUDIO_ARTIFACTS: bucket })
    const unauthorized = interjectionRequest()
    unauthorized.headers.set('Authorization', 'Bearer wrong')
    expect((await worker.fetch(unauthorized, env)).status).toBe(401)

    const firstCancel = await worker.fetch(interjectionRequest('DELETE'), env)
    const duplicateCancel = await worker.fetch(interjectionRequest('DELETE'), env)
    expect(firstCancel.status).toBe(200)
    expect(duplicateCancel.status).toBe(200)
    expect(bucket.delete).toHaveBeenCalledTimes(2)
    expect(bucket.delete).toHaveBeenNthCalledWith(1, 'audio-overviews/jobs/job_1/interjections/interjection_1.wav')
  })
})
