import { describe, expect, test, vi } from 'vitest'
import { GEMINI_AUDIO_PROFILE_V1, type GeminiSceneRenderResult } from './gemini-audio-renderer'
import { sha256Hex } from './media'
import {
  isWorkflowActiveStatus,
  orchestrateAudioOverview,
  resolvePagesStageUrl,
  type AudioArtifactStore,
  type AudioOverviewWorkflowServices,
  type DurableStep,
  type StageCaller,
  type StageFailure,
  type WorkflowScene,
} from './orchestration'

function immediateStep(
  names: string[],
  configs: Array<{ name: string, config: Parameters<DurableStep['do']>[1] }> = [],
): DurableStep {
  return {
    async do<T>(
      name: string,
      config: Parameters<DurableStep['do']>[1],
      callback: () => Promise<T>,
    ) {
      names.push(name)
      configs.push({ name, config })
      return await callback()
    },
  }
}

function pcmSecond(amplitude = 4_000): Uint8Array {
  const bytes = new Uint8Array(48_000)
  const view = new DataView(bytes.buffer)
  for (let sample = 0; sample < 24_000; sample++) view.setInt16(sample * 2, sample % 2 ? -amplitude : amplitude, true)
  return bytes
}

function rendered(audio = pcmSecond()): GeminiSceneRenderResult {
  return {
    audio,
    metadata: {
      encoding: 'pcm_s16le', sampleRateHz: 24_000, bitDepth: 16, channels: 1,
      byteLength: audio.byteLength, durationMs: 1_000,
      providerMimeType: 'audio/L16;codec=pcm;rate=24000',
      model: GEMINI_AUDIO_PROFILE_V1.model,
      audioProfileId: GEMINI_AUDIO_PROFILE_V1.id,
      audioProfileVersion: GEMINI_AUDIO_PROFILE_V1.version,
    },
  }
}

const scenes: WorkflowScene[] = [0, 1].map(order => ({
  sceneId: `scene-${order}`,
  title: `Scene ${order + 1}`,
  direction: order ? 'Build energy.' : 'Open warmly.',
  expectedDurationMs: 1_000,
  utterances: [
    { speaker: 'host_a', text: `Grounded point ${order}.`, emotionalIntent: 'warm' },
    { speaker: 'host_b', text: `Question ${order}?`, deliveryIntent: 'curious', pauseAfterMs: 200 },
  ],
}))

type Stored = {
  bytes: Uint8Array
  etag: string
  httpMetadata: { contentType?: string }
  customMetadata: Record<string, string>
}

function memoryStore() {
  const objects = new Map<string, Stored>()
  const putKeys: string[] = []
  const store: AudioArtifactStore = {
    async head(key) {
      const value = objects.get(key)
      return value ? { size: value.bytes.byteLength, etag: value.etag, httpMetadata: value.httpMetadata, customMetadata: value.customMetadata } : null
    },
    async get(key) {
      const value = objects.get(key)
      if (!value) return null
      const bytes = value.bytes.slice()
      return {
        size: bytes.byteLength,
        etag: value.etag,
        httpMetadata: value.httpMetadata,
        customMetadata: value.customMetadata,
        body: new Blob([bytes]).stream(),
        async arrayBuffer() { return bytes.slice().buffer },
      }
    },
    async put(key, input, options) {
      const bytes = input instanceof Uint8Array
        ? input.slice()
        : new Uint8Array(await new Response(input).arrayBuffer())
      const stored = {
        bytes,
        etag: `etag-${putKeys.length}-${bytes.byteLength}`,
        httpMetadata: { ...options.httpMetadata },
        customMetadata: { ...options.customMetadata },
      }
      objects.set(key, stored)
      putKeys.push(key)
      return { size: bytes.byteLength, ...stored }
    },
  }
  return { store, objects, putKeys }
}

function services(artifactStore = memoryStore(), audio = rendered()) {
  const renderScene = vi.fn(async () => audio)
  const transcribeScene = vi.fn(async (_pcm: Uint8Array, context: { sceneId: string }) => {
    const scene = scenes.find(candidate => candidate.sceneId === context.sceneId)
    return scene?.utterances.map(utterance => utterance.text).join(' ') ?? ''
  })
  const result: AudioOverviewWorkflowServices = {
    artifacts: artifactStore.store,
    renderScene,
    transcribeScene,
    createFixedLengthStream: () => {
      const stream = new TransformStream<Uint8Array, Uint8Array>()
      return { readable: stream.readable, writable: stream.writable }
    },
  }
  return { ...artifactStore, renderScene, transcribeScene, services: result }
}

function successfulCaller() {
  return vi.fn<StageCaller>(async (body) => {
    if (body.stage === 'prepare') return { ok: true, sceneCount: scenes.length }
    if (body.stage === 'scene-context') return { ok: true, scene: scenes[body.sceneOrder] }
    return { ok: true }
  })
}

describe('audio overview orchestration', () => {
  test('rejects a missing or invalid Pages callback URL before Workflow execution', () => {
    expect(resolvePagesStageUrl(undefined)).toBeNull()
    expect(resolvePagesStageUrl('not-a-url')).toBeNull()
    expect(resolvePagesStageUrl('ftp://localhost:3002')).toBeNull()
    expect(resolvePagesStageUrl('http://localhost:3002')?.href)
      .toBe('http://localhost:3002/api/audio-overview/jobs/step')
  })

  test('accepts duplicate IDs only while their Workflow instance is active', () => {
    expect(['queued', 'running', 'paused', 'waiting', 'waitingForPause'].every(isWorkflowActiveStatus)).toBe(true)
    expect(['complete', 'errored', 'terminated', 'unknown'].some(isWorkflowActiveStatus)).toBe(false)
  })

  test('renders joint Scenes in the Worker, commits metadata only, and streams a valid WAV to private R2', async () => {
    const names: string[] = []
    const configs: Array<{ name: string, config: Parameters<DurableStep['do']>[1] }> = []
    const call = successfulCaller()
    const runtime = services()

    await expect(orchestrateAudioOverview(
      immediateStep(names, configs),
      { jobId: 'job_1', capability: 'capability' },
      call,
      runtime.services,
    )).resolves.toEqual({ cancelled: false })

    expect(names).toEqual([
      'prepare',
      'scene-context-0', 'claim-render-budget-0-attempt-1', 'render-scene-0-attempt-1', 'commit-scene-0-attempt-1',
      'scene-context-1', 'claim-render-budget-1-attempt-1', 'render-scene-1-attempt-1', 'commit-scene-1-attempt-1',
      'assemble-wav', 'publish', 'align',
    ])
    const firstRender = configs.find(entry => entry.name === 'render-scene-0-attempt-1')
    expect(firstRender?.config.retries.limit).toBe(0)
    expect(runtime.renderScene).toHaveBeenCalledTimes(2)
    expect(runtime.transcribeScene).toHaveBeenCalledTimes(2)
    expect(runtime.renderScene).toHaveBeenNthCalledWith(1, {
      sceneId: 'scene-0',
      sceneDirection: 'Open warmly.',
      utterances: scenes[0]!.utterances,
    })
    expect(runtime.putKeys).toEqual([
      'audio-overviews/jobs/job_1/scenes/0/attempts/1.pcm',
      'audio-overviews/jobs/job_1/scenes/1/attempts/1.pcm',
      'audio-overviews/jobs/job_1/overview.wav',
    ])

    const commit = call.mock.calls.find(([body]) => body.stage === 'commit-scene')![0]
    expect(commit).toEqual(expect.objectContaining({ stage: 'commit-scene', sceneOrder: 0 }))
    if (commit.stage !== 'commit-scene') throw new Error('Expected commit-scene')
    expect(commit.qualityGate.decision).toBe('accepted')
    expect(commit.artifact).toEqual(expect.objectContaining({
      r2Key: 'audio-overviews/jobs/job_1/scenes/0/attempts/1.pcm',
      attempt: 1,
      byteLength: 48_000,
      audioProfileVersion: '1',
      format: {
        encoding: 'pcm_s16le',
        sampleRateHz: 24_000,
        bitDepth: 16,
        channels: 1,
      },
    }))
    expect(JSON.stringify(commit)).not.toContain('audioBytes')

    const wav = runtime.objects.get('audio-overviews/jobs/job_1/overview.wav')!.bytes
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe('WAVE')
    expect(wav.byteLength).toBe(96_044)
    const publish = call.mock.calls.find(([body]) => body.stage === 'publish')![0]
    if (publish.stage !== 'publish') throw new Error('Expected publish')
    expect(publish.artifact).toEqual(expect.objectContaining({
      r2Key: 'audio-overviews/jobs/job_1/overview.wav', contentType: 'audio/wav', byteLength: 96_044, sceneCount: 2,
    }))
    const expectedWavSha256 = await sha256Hex(wav)
    expect(publish.artifact.sha256).toBe(expectedWavSha256)
    expect(runtime.objects.get('audio-overviews/jobs/job_1/overview.wav')!.customMetadata.sha256)
      .toBe(expectedWavSha256)
  })

  test('reuses matching staged Scenes and final artifact without another provider call', async () => {
    const runtime = services()
    await orchestrateAudioOverview(immediateStep([]), { jobId: 'job_1', capability: 'cap' }, successfulCaller(), runtime.services)
    await orchestrateAudioOverview(immediateStep([]), { jobId: 'job_1', capability: 'cap' }, successfulCaller(), runtime.services)

    expect(runtime.renderScene).toHaveBeenCalledTimes(2)
    expect(runtime.transcribeScene).toHaveBeenCalledTimes(2)
    expect(runtime.putKeys).toHaveLength(3)
  })

  test('[P0] retries an idempotent Scene write without rerendering paid audio', async () => {
    const runtime = services()
    const originalPut = runtime.store.put.bind(runtime.store)
    const put = vi.fn<typeof runtime.store.put>()
      .mockRejectedValueOnce(new Error('put: Unspecified error (0)'))
      .mockImplementation(originalPut)
    runtime.store.put = put
    runtime.services.sleep = vi.fn(async () => {})

    await expect(orchestrateAudioOverview(
      immediateStep([]), { jobId: 'job_1', capability: 'cap' }, successfulCaller(), runtime.services,
    )).resolves.toEqual({ cancelled: false })

    expect(put).toHaveBeenCalledTimes(4)
    expect(runtime.services.sleep).toHaveBeenCalledWith(1_000)
    expect(runtime.renderScene).toHaveBeenCalledTimes(2)
    expect(runtime.transcribeScene).toHaveBeenCalledTimes(2)
  })

  test('records ASR transcript divergence as rejected evidence before accepting a retry', async () => {
    const runtime = services()
    runtime.transcribeScene.mockResolvedValueOnce('Completely unrelated words from another recording.')
    const call = successfulCaller()

    await orchestrateAudioOverview(
      immediateStep([]), { jobId: 'job_1', capability: 'cap' }, call, runtime.services,
    )

    const sceneZeroCommits = call.mock.calls
      .map(([body]) => body)
      .filter(body => body.stage === 'commit-scene' && body.sceneOrder === 0)
    expect(sceneZeroCommits).toHaveLength(2)
    if (sceneZeroCommits[0]?.stage !== 'commit-scene' || sceneZeroCommits[1]?.stage !== 'commit-scene') {
      throw new Error('Expected two Scene commit attempts')
    }
    expect(sceneZeroCommits[0].qualityGate.checks).toContainEqual(expect.objectContaining({
      code: 'transcript-divergence', outcome: 'rejected', measured: 1, limit: 0.3,
    }))
    expect(sceneZeroCommits[0].qualityGate.metrics.transcriptDivergence).toBe(1)
    expect(sceneZeroCommits[1].qualityGate.checks).toContainEqual(expect.objectContaining({
      code: 'transcript-divergence', outcome: 'accepted',
    }))
  })

  test('detects a tampered final WAV during reuse and replaces it from accepted Scene evidence', async () => {
    const runtime = services()
    await orchestrateAudioOverview(immediateStep([]), { jobId: 'job_1', capability: 'cap' }, successfulCaller(), runtime.services)
    const finalKey = 'audio-overviews/jobs/job_1/overview.wav'
    const original = runtime.objects.get(finalKey)!
    original.bytes[44] = original.bytes[44]! ^ 0xff

    const secondCall = successfulCaller()
    await orchestrateAudioOverview(immediateStep([]), { jobId: 'job_1', capability: 'cap' }, secondCall, runtime.services)

    expect(runtime.renderScene).toHaveBeenCalledTimes(2)
    expect(runtime.putKeys).toEqual([
      'audio-overviews/jobs/job_1/scenes/0/attempts/1.pcm',
      'audio-overviews/jobs/job_1/scenes/1/attempts/1.pcm',
      finalKey,
      finalKey,
    ])
    const repaired = runtime.objects.get(finalKey)!
    expect(repaired.customMetadata.sha256).toBe(await sha256Hex(repaired.bytes))
  })

  test('records a rejected Scene attempt before retrying and assembles only the accepted attempt', async () => {
    const runtime = services()
    runtime.renderScene
      .mockResolvedValueOnce(rendered(pcmSecond(0)))
      .mockResolvedValueOnce(rendered(pcmSecond()))
    const call = successfulCaller()

    await expect(orchestrateAudioOverview(
      immediateStep([]), { jobId: 'job_1', capability: 'cap' }, call, runtime.services,
    )).resolves.toEqual({ cancelled: false })

    const firstSceneCommits = call.mock.calls
      .map(([body]) => body)
      .filter(body => body.stage === 'commit-scene' && body.sceneOrder === 0)
    expect(firstSceneCommits).toHaveLength(2)
    expect(firstSceneCommits.map(body => body.stage === 'commit-scene' && ({
      attempt: body.artifact.attempt,
      decision: body.qualityGate.decision,
      containsAudio: 'audio' in body.artifact || 'audioBytes' in body.artifact,
    }))).toEqual([
      { attempt: 1, decision: 'rejected', containsAudio: false },
      { attempt: 2, decision: 'accepted', containsAudio: false },
    ])
    expect(runtime.putKeys.slice(0, 2)).toEqual([
      'audio-overviews/jobs/job_1/scenes/0/attempts/1.pcm',
      'audio-overviews/jobs/job_1/scenes/0/attempts/2.pcm',
    ])

    const wav = runtime.objects.get('audio-overviews/jobs/job_1/overview.wav')!.bytes
    expect(new DataView(wav.buffer, wav.byteOffset, wav.byteLength).getInt16(44, true)).toBe(4_000)
  })

  test('fails after three recorded Scene attempts and reuses their immutable evidence on restart', async () => {
    const runtime = services(memoryStore(), rendered(pcmSecond(0)))
    const firstCall = successfulCaller()

    await expect(orchestrateAudioOverview(
      immediateStep([]), { jobId: 'job_1', capability: 'cap' }, firstCall, runtime.services,
    )).rejects.toEqual(expect.objectContaining<Partial<StageFailure>>({
      retryable: false,
      message: expect.stringContaining('exhausted 3 Quality Gate attempts'),
    }))

    const firstCommits = firstCall.mock.calls
      .map(([body]) => body)
      .filter(body => body.stage === 'commit-scene')
    expect(firstCommits.map(body => body.stage === 'commit-scene' && body.artifact.attempt)).toEqual([1, 2, 3])
    expect(firstCommits.every(body => body.stage === 'commit-scene' && body.qualityGate.decision === 'rejected')).toBe(true)
    expect(runtime.putKeys).toEqual([
      'audio-overviews/jobs/job_1/scenes/0/attempts/1.pcm',
      'audio-overviews/jobs/job_1/scenes/0/attempts/2.pcm',
      'audio-overviews/jobs/job_1/scenes/0/attempts/3.pcm',
    ])
    expect(runtime.renderScene).toHaveBeenCalledTimes(3)
    expect(runtime.transcribeScene).toHaveBeenCalledTimes(3)

    const secondCall = successfulCaller()
    await expect(orchestrateAudioOverview(
      immediateStep([]), { jobId: 'job_1', capability: 'cap' }, secondCall, runtime.services,
    )).rejects.toThrow(/exhausted 3 Quality Gate attempts/)
    expect(runtime.renderScene).toHaveBeenCalledTimes(3)
    expect(runtime.transcribeScene).toHaveBeenCalledTimes(3)
    expect(runtime.putKeys).toHaveLength(3)
    expect(secondCall.mock.calls.filter(([body]) => body.stage === 'commit-scene')).toHaveLength(3)
    expect(secondCall.mock.calls.some(([body]) => body.stage === 'publish')).toBe(false)
  })

  test('stops after cancellation without rendering', async () => {
    const runtime = services()
    const call = vi.fn<StageCaller>(async body => body.stage === 'prepare'
      ? { ok: true, sceneCount: 2 }
      : { ok: true, cancelled: true })
    await expect(orchestrateAudioOverview(
      immediateStep([]), { jobId: 'job_1', capability: 'cap' }, call, runtime.services,
    )).resolves.toEqual({ cancelled: true })
    expect(runtime.renderScene).not.toHaveBeenCalled()
  })

  test('preserves permanent stage classification', async () => {
    const call = vi.fn<StageCaller>(async () => ({ ok: false, retryable: false, message: 'invalid manifest' }))
    await expect(orchestrateAudioOverview(
      immediateStep([]), { jobId: 'job_1', capability: 'cap' }, call, services().services,
    )).rejects.toEqual(expect.objectContaining<Partial<StageFailure>>({ retryable: false, message: 'invalid manifest' }))
  })

  test('does not revoke published audio when best-effort alignment fails', async () => {
    const call = successfulCaller()
    call.mockImplementation(async (body) => {
      if (body.stage === 'prepare') return { ok: true, sceneCount: scenes.length }
      if (body.stage === 'scene-context') return { ok: true, scene: scenes[body.sceneOrder] }
      if (body.stage === 'align') return { ok: false, retryable: true, message: 'alignment unavailable' }
      return { ok: true }
    })
    await expect(orchestrateAudioOverview(
      immediateStep([]), { jobId: 'job_1', capability: 'cap' }, call, services().services,
    )).resolves.toEqual({ cancelled: false })
    expect(call.mock.calls.some(([body]) => body.stage === 'publish')).toBe(true)
  })
})
