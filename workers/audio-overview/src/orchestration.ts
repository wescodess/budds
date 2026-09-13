import { createHash } from 'node:crypto'
import { buildGeminiPerformanceNotes, GEMINI_AUDIO_PROFILE, type GeminiSceneRenderInput, type GeminiSceneRenderResult } from './gemini-audio-renderer'
import { createWavHeader, durationMsForPcmBytes, sha256Hex } from './media'
import {
  analyzeAudioOverviewTranscript,
  evaluateAudioOverviewQuality,
  type AudioOverviewQualityGateResult,
  type AudioOverviewTranscriptEvidence,
} from './quality'

export type AudioOverviewWorkflowParams = { jobId: string, capability: string }

export type WorkflowScene = Omit<GeminiSceneRenderInput, 'sceneDirection'> & {
  title: string
  direction: string
  expectedDurationMs: number
}

export type SceneArtifactMetadata = {
  r2Key: string
  etag: string
  contentType: 'audio/L16;codec=pcm;rate=24000'
  byteLength: number
  durationMs: number
  sha256: string
  sceneId: string
  sceneOrder: number
  attempt: number
  model: typeof GEMINI_AUDIO_PROFILE.model
  audioProfileId: typeof GEMINI_AUDIO_PROFILE.id
  audioProfileVersion: string
  format: typeof GEMINI_AUDIO_PROFILE.format
}

export type AudioArtifactMetadata = {
  r2Key: string
  etag: string
  contentType: 'audio/wav'
  byteLength: number
  pcmByteLength: number
  durationMs: number
  sceneCount: number
  sha256: string
  manifestSha256: string
  model: typeof GEMINI_AUDIO_PROFILE.model
  audioProfileId: typeof GEMINI_AUDIO_PROFILE.id
  audioProfileVersion: string
  format: typeof GEMINI_AUDIO_PROFILE.format
}

export type PagesStageBody =
  | { jobId: string, stage: 'prepare' }
  | { jobId: string, stage: 'scene-context', sceneOrder: number }
  | { jobId: string, stage: 'claim-render', sceneOrder: number, attempt: number }
  | { jobId: string, stage: 'commit-scene', sceneOrder: number, artifact: SceneArtifactMetadata, qualityGate: AudioOverviewQualityGateResult }
  | { jobId: string, stage: 'publish', artifact: AudioArtifactMetadata }
  | { jobId: string, stage: 'align' }
  | { jobId: string, stage: 'fail', error?: string }

export type StepResult = {
  ok: boolean
  retryable?: boolean
  message?: string
  cancelled?: boolean
  sceneCount?: number
  scene?: WorkflowScene
}

export type DurableStep = {
  do<T>(
    name: string,
    config: { retries: { limit: number, delay: string, backoff: 'constant' | 'linear' | 'exponential' }, timeout: string },
    callback: () => Promise<T>,
  ): Promise<T>
}

export type StageCaller = (body: PagesStageBody) => Promise<StepResult>

type StoredArtifactHead = {
  size: number
  etag: string
  httpMetadata?: { contentType?: string }
  customMetadata?: Record<string, string>
}

type StoredArtifactBody = StoredArtifactHead & {
  body: ReadableStream<Uint8Array>
  arrayBuffer(): Promise<ArrayBuffer>
}

export type AudioArtifactStore = {
  head(key: string): Promise<StoredArtifactHead | null>
  get(key: string): Promise<StoredArtifactBody | null>
  put(
    key: string,
    value: Uint8Array | ReadableStream<Uint8Array>,
    options: { httpMetadata: { contentType: string }, customMetadata: Record<string, string> },
  ): Promise<StoredArtifactHead>
}

export type FixedLengthStreamFactory = (byteLength: number) => {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
}

export type AudioOverviewWorkflowServices = {
  artifacts: AudioArtifactStore
  renderScene(scene: GeminiSceneRenderInput): Promise<GeminiSceneRenderResult>
  transcribeScene(pcm: Uint8Array, context: { sceneId: string, sceneOrder: number, attempt: number }): Promise<string>
  createFixedLengthStream?: FixedLengthStreamFactory
  sleep?: (milliseconds: number) => Promise<void>
}

export function isWorkflowActiveStatus(status: string): boolean {
  return ['queued', 'running', 'paused', 'waiting', 'waitingForPause'].includes(status)
}

export function resolvePagesStageUrl(baseUrl: string | undefined): URL | null {
  if (!baseUrl) return null
  try {
    const url = new URL('/api/audio-overview/jobs/step', baseUrl)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  }
  catch {
    return null
  }
}

export class StageFailure extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message)
    this.name = 'StageFailure'
  }
}

const RETRY = {
  retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' as const },
  timeout: '15 minutes',
}

const RENDER_RETRY = {
  // A Gemini response can be billable even when the Worker loses the response
  // before it can persist R2 evidence. Retrying that same paid step would make
  // spend and voice output ambiguous, so quality retries use a newly budgeted
  // attempt while transport ambiguity fails closed.
  retries: { limit: 0, delay: '10 seconds', backoff: 'exponential' as const },
  timeout: '15 minutes',
}

const MAX_SCENE_QUALITY_ATTEMPTS = 3

async function expectSuccess(result: StepResult): Promise<StepResult> {
  if (!result.ok) throw new StageFailure(result.message || 'Audio overview stage failed', result.retryable !== false)
  return result
}

function requireScene(result: StepResult, expectedOrder: number): WorkflowScene {
  const scene = result.scene
  if (!scene || typeof scene.sceneId !== 'string' || !scene.sceneId.trim()
    || typeof scene.title !== 'string' || !scene.title.trim()
    || typeof scene.direction !== 'string' || !scene.direction.trim()
    || !Number.isFinite(scene.expectedDurationMs) || scene.expectedDurationMs <= 0 || scene.expectedDurationMs > 180_000
    || !Array.isArray(scene.utterances) || scene.utterances.length < 2) {
    throw new StageFailure(`Scene ${expectedOrder} context is invalid`, false)
  }
  return scene
}

function sceneKey(jobId: string, sceneOrder: number, attempt: number): string {
  return `audio-overviews/jobs/${jobId}/scenes/${sceneOrder}/attempts/${attempt}.pcm`
}

function artifactKey(jobId: string): string {
  return `audio-overviews/jobs/${jobId}/overview.wav`
}

async function sceneFingerprint(scene: WorkflowScene, sceneOrder: number, attempt: number): Promise<string> {
  return sha256Hex(new TextEncoder().encode(JSON.stringify({
    sceneOrder,
    attempt,
    sceneId: scene.sceneId,
    title: scene.title,
    direction: scene.direction,
    expectedDurationMs: scene.expectedDurationMs,
    utterances: scene.utterances,
    audioProfileId: GEMINI_AUDIO_PROFILE.id,
    audioProfileVersion: GEMINI_AUDIO_PROFILE.version,
    model: GEMINI_AUDIO_PROFILE.model,
  })))
}

function dialogueScript(scene: WorkflowScene): string {
  return scene.utterances
    .map(utterance => `${utterance.speaker === 'host_a' ? 'Host A' : 'Host B'}: ${utterance.text}`)
    .join('\n')
}

function spokenTranscript(scene: WorkflowScene): string {
  return scene.utterances.map(utterance => utterance.text).join(' ')
}

function evaluateScene(
  scene: WorkflowScene,
  pcm: Uint8Array,
  transcriptEvidence: AudioOverviewTranscriptEvidence,
): AudioOverviewQualityGateResult {
  return evaluateAudioOverviewQuality({
    pcm,
    expectedDurationMs: scene.expectedDurationMs,
    dialogueScript: dialogueScript(scene),
    transcriptEvidence,
  })
}

function readTranscriptEvidence(
  metadata: Record<string, string> | undefined,
  sceneOrder: number,
  attempt: number,
): AudioOverviewTranscriptEvidence {
  const transcriptDivergence = Number(metadata?.transcriptDivergence)
  let spokenDirections: unknown
  try {
    spokenDirections = JSON.parse(metadata?.spokenDirections ?? '')
  }
  catch {
    throw new StageFailure(`Stored Scene ${sceneOrder} attempt ${attempt} transcript evidence is invalid`, false)
  }
  if (!Number.isFinite(transcriptDivergence) || transcriptDivergence < 0 || transcriptDivergence > 1
    || !Array.isArray(spokenDirections) || spokenDirections.some(direction => typeof direction !== 'string')) {
    throw new StageFailure(`Stored Scene ${sceneOrder} attempt ${attempt} transcript evidence is invalid`, false)
  }
  return { transcriptDivergence, spokenDirections }
}

function matchingSceneHead(head: StoredArtifactHead | null, fingerprint: string, attempt: number): boolean {
  const metadata = head?.customMetadata
  return !!head && head.size > 0 && head.size % 2 === 0
    && head.httpMetadata?.contentType === 'audio/L16;codec=pcm;rate=24000'
    && metadata?.kind === 'audio-overview-scene.v2'
    && metadata.sceneFingerprint === fingerprint
    && metadata.attempt === String(attempt)
    && metadata.audioProfileId === GEMINI_AUDIO_PROFILE.id
    && metadata.audioProfileVersion === String(GEMINI_AUDIO_PROFILE.version)
    && metadata.sampleRateHz === '24000'
    && metadata.bitsPerSample === '16'
    && metadata.channels === '1'
}

async function readReusableScene(
  artifacts: AudioArtifactStore,
  key: string,
  fingerprint: string,
  scene: WorkflowScene,
  sceneOrder: number,
  attempt: number,
): Promise<{ checksum: string, qualityGate: AudioOverviewQualityGateResult, head: StoredArtifactHead } | null> {
  const head = await artifacts.head(key)
  if (!head) return null
  if (!matchingSceneHead(head, fingerprint, attempt)) {
    throw new StageFailure(`Stored Scene ${sceneOrder} attempt ${attempt} conflicts with immutable evidence`, false)
  }
  const stored = await artifacts.get(key)
  if (!stored || stored.size !== head.size) {
    throw new StageFailure(`Stored Scene ${sceneOrder} attempt ${attempt} is unavailable`, true)
  }
  const pcm = new Uint8Array(await stored.arrayBuffer())
  if (pcm.byteLength !== head.size) {
    throw new StageFailure(`Stored Scene ${sceneOrder} attempt ${attempt} is incomplete`, true)
  }
  const checksum = await sha256Hex(pcm)
  if (checksum !== head.customMetadata?.sha256) {
    throw new StageFailure(`Stored Scene ${sceneOrder} attempt ${attempt} checksum is invalid`, false)
  }
  const qualityGate = evaluateScene(scene, pcm, readTranscriptEvidence(head.customMetadata, sceneOrder, attempt))
  if (qualityGate.version !== head.customMetadata?.qualityGateVersion
    || qualityGate.decision !== head.customMetadata?.qualityDecision) {
    throw new StageFailure(`Stored Scene ${sceneOrder} attempt ${attempt} Quality Gate evidence conflicts`, false)
  }
  return { checksum, qualityGate, head }
}

function sceneMetadata(
  key: string,
  scene: WorkflowScene,
  sceneOrder: number,
  attempt: number,
  head: StoredArtifactHead,
  checksum: string,
): SceneArtifactMetadata {
  return {
    r2Key: key,
    etag: head.etag,
    contentType: 'audio/L16;codec=pcm;rate=24000',
    byteLength: head.size,
    durationMs: durationMsForPcmBytes(head.size),
    sha256: checksum,
    sceneId: scene.sceneId,
    sceneOrder,
    attempt,
    model: GEMINI_AUDIO_PROFILE.model,
    audioProfileId: GEMINI_AUDIO_PROFILE.id,
    audioProfileVersion: String(GEMINI_AUDIO_PROFILE.version),
    format: GEMINI_AUDIO_PROFILE.format,
  }
}

async function putSceneArtifact(
  services: AudioOverviewWorkflowServices,
  key: string,
  audio: Uint8Array,
  options: Parameters<AudioArtifactStore['put']>[2],
): Promise<StoredArtifactHead> {
  const sleep = services.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await services.artifacts.put(key, audio, options)
    }
    catch (error) {
      if (attempt === 3) throw error
      await sleep(attempt * 1_000)
    }
  }
  throw new StageFailure('Scene artifact write failed without a result', true)
}

async function renderAndStoreScene(
  services: AudioOverviewWorkflowServices,
  params: AudioOverviewWorkflowParams,
  scene: WorkflowScene,
  sceneOrder: number,
  attempt: number,
): Promise<{ artifact: SceneArtifactMetadata, qualityGate: AudioOverviewQualityGateResult }> {
  const key = sceneKey(params.jobId, sceneOrder, attempt)
  const fingerprint = await sceneFingerprint(scene, sceneOrder, attempt)
  const reusable = await readReusableScene(services.artifacts, key, fingerprint, scene, sceneOrder, attempt)
  if (reusable) {
    return {
      artifact: sceneMetadata(key, scene, sceneOrder, attempt, reusable.head, reusable.checksum),
      qualityGate: reusable.qualityGate,
    }
  }

  const rendered = await services.renderScene({
    sceneId: scene.sceneId,
    sceneDirection: scene.direction,
    hostNames: scene.hostNames,
    utterances: scene.utterances,
  })
  const format = rendered.metadata
  if (format.encoding !== 'pcm_s16le' || format.sampleRateHz !== 24_000
    || format.bitDepth !== 16 || format.channels !== 1 || format.byteLength !== rendered.audio.byteLength) {
    throw new StageFailure(`Scene ${sceneOrder} renderer returned non-production PCM`, false)
  }
  const renderedTranscript = await services.transcribeScene(rendered.audio, {
    sceneId: scene.sceneId,
    sceneOrder,
    attempt,
  })
  const transcriptEvidence = analyzeAudioOverviewTranscript({
    dialogueScript: dialogueScript(scene),
    performanceNotes: buildGeminiPerformanceNotes({
      sceneId: scene.sceneId,
      sceneDirection: scene.direction,
      hostNames: scene.hostNames,
      utterances: scene.utterances,
    }),
    expectedTranscript: spokenTranscript(scene),
    renderedTranscript,
  })
  const qualityGate = evaluateScene(scene, rendered.audio, transcriptEvidence)
  const checksum = await sha256Hex(rendered.audio)
  const stored = await putSceneArtifact(services, key, rendered.audio, {
    httpMetadata: { contentType: 'audio/L16;codec=pcm;rate=24000' },
    customMetadata: {
      kind: 'audio-overview-scene.v2',
      jobId: params.jobId,
      sceneOrder: String(sceneOrder),
      attempt: String(attempt),
      sceneId: scene.sceneId,
      sceneFingerprint: fingerprint,
      sha256: checksum,
      qualityGateVersion: qualityGate.version,
      qualityDecision: qualityGate.decision,
      transcriptDivergence: String(transcriptEvidence.transcriptDivergence),
      spokenDirections: JSON.stringify(transcriptEvidence.spokenDirections),
      audioProfileId: GEMINI_AUDIO_PROFILE.id,
      audioProfileVersion: String(GEMINI_AUDIO_PROFILE.version),
      model: GEMINI_AUDIO_PROFILE.model,
      sampleRateHz: '24000',
      bitsPerSample: '16',
      channels: '1',
      byteOrder: 'little-endian',
    },
  })
  return { artifact: sceneMetadata(key, scene, sceneOrder, attempt, stored, checksum), qualityGate }
}

function defaultFixedLengthStream(byteLength: number) {
  const stream = new FixedLengthStream(byteLength)
  return {
    readable: stream.readable as ReadableStream<Uint8Array>,
    writable: stream.writable as WritableStream<Uint8Array>,
  }
}

async function consumeStoredScene(
  artifacts: AudioArtifactStore,
  scene: SceneArtifactMetadata,
  consume: (chunk: Uint8Array) => Promise<void> | void,
): Promise<void> {
  const stored = await artifacts.get(scene.r2Key)
  if (!stored || stored.size !== scene.byteLength || stored.etag !== scene.etag
    || stored.customMetadata?.sha256 !== scene.sha256
    || stored.customMetadata?.attempt !== String(scene.attempt)
    || stored.httpMetadata?.contentType !== scene.contentType) {
    throw new StageFailure(`Stored Scene ${scene.sceneOrder} attempt ${scene.attempt} is unavailable`, true)
  }
  const reader = stored.body.getReader()
  const sceneHash = createHash('sha256')
  let sceneBytes = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    sceneBytes += chunk.value.byteLength
    if (sceneBytes > scene.byteLength) {
      throw new StageFailure(`Stored Scene ${scene.sceneOrder} attempt ${scene.attempt} changed during assembly`, true)
    }
    sceneHash.update(chunk.value)
    await consume(chunk.value)
  }
  if (sceneBytes !== scene.byteLength) {
    throw new StageFailure(`Stored Scene ${scene.sceneOrder} attempt ${scene.attempt} is incomplete`, true)
  }
  if (sceneHash.digest('hex') !== scene.sha256) {
    throw new StageFailure(`Stored Scene ${scene.sceneOrder} attempt ${scene.attempt} checksum is invalid`, false)
  }
}

async function computeWavSha256(
  artifacts: AudioArtifactStore,
  scenes: readonly SceneArtifactMetadata[],
  pcmByteLength: number,
): Promise<string> {
  const hash = createHash('sha256')
  hash.update(createWavHeader(pcmByteLength))
  for (const scene of scenes) {
    await consumeStoredScene(artifacts, scene, (chunk) => {
      hash.update(chunk)
    })
  }
  return hash.digest('hex')
}

async function writeWavStream(
  artifacts: AudioArtifactStore,
  scenes: readonly SceneArtifactMetadata[],
  writable: WritableStream<Uint8Array>,
  pcmByteLength: number,
): Promise<string> {
  const writer = writable.getWriter()
  const hash = createHash('sha256')
  try {
    const header = createWavHeader(pcmByteLength)
    hash.update(header)
    await writer.write(header)
    for (const scene of scenes) {
      await consumeStoredScene(artifacts, scene, async (chunk) => {
        hash.update(chunk)
        await writer.write(chunk)
      })
    }
    await writer.close()
    return hash.digest('hex')
  }
  catch (error) {
    await writer.abort(error).catch(() => undefined)
    throw error
  }
}

function matchingArtifactHead(head: StoredArtifactHead | null, manifestSha256: string, byteLength: number): boolean {
  return !!head && head.size === byteLength && head.httpMetadata?.contentType === 'audio/wav'
    && head.customMetadata?.kind === 'audio-overview-artifact.v2'
    && head.customMetadata.manifestSha256 === manifestSha256
    && head.customMetadata.audioProfileId === GEMINI_AUDIO_PROFILE.id
    && head.customMetadata.audioProfileVersion === String(GEMINI_AUDIO_PROFILE.version)
    && /^[a-f0-9]{64}$/.test(head.customMetadata.sha256 ?? '')
}

async function reusableArtifactSha256(
  artifacts: AudioArtifactStore,
  key: string,
  head: StoredArtifactHead,
): Promise<string | null> {
  const stored = await artifacts.get(key)
  if (!stored || stored.size !== head.size || stored.etag !== head.etag) return null
  const hash = createHash('sha256')
  const reader = stored.body.getReader()
  let byteLength = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    byteLength += chunk.value.byteLength
    if (byteLength > head.size) return null
    hash.update(chunk.value)
  }
  if (byteLength !== head.size) return null
  const checksum = hash.digest('hex')
  return checksum === head.customMetadata?.sha256 ? checksum : null
}

async function assembleAndStoreArtifact(
  services: AudioOverviewWorkflowServices,
  params: AudioOverviewWorkflowParams,
  scenes: readonly SceneArtifactMetadata[],
): Promise<AudioArtifactMetadata> {
  const pcmByteLength = scenes.reduce((sum, scene) => sum + scene.byteLength, 0)
  const wavByteLength = pcmByteLength + 44
  createWavHeader(pcmByteLength)
  const manifestSha256 = await sha256Hex(new TextEncoder().encode(JSON.stringify(
    scenes.map(scene => ({ r2Key: scene.r2Key, byteLength: scene.byteLength, sha256: scene.sha256 })),
  )))
  const key = artifactKey(params.jobId)
  let stored = await services.artifacts.head(key)
  let checksum = matchingArtifactHead(stored, manifestSha256, wavByteLength)
    ? await reusableArtifactSha256(services.artifacts, key, stored!)
    : null
  if (!checksum) {
    checksum = await computeWavSha256(services.artifacts, scenes, pcmByteLength)
    const streamFactory = services.createFixedLengthStream ?? defaultFixedLengthStream
    const stream = streamFactory(wavByteLength)
    const pump = writeWavStream(services.artifacts, scenes, stream.writable, pcmByteLength)
    const upload = services.artifacts.put(key, stream.readable, {
      httpMetadata: { contentType: 'audio/wav' },
      customMetadata: {
        kind: 'audio-overview-artifact.v2',
        jobId: params.jobId,
        sha256: checksum,
        manifestSha256,
        sceneCount: String(scenes.length),
        audioProfileId: GEMINI_AUDIO_PROFILE.id,
        audioProfileVersion: String(GEMINI_AUDIO_PROFILE.version),
        model: GEMINI_AUDIO_PROFILE.model,
        sampleRateHz: '24000',
        bitsPerSample: '16',
        channels: '1',
        byteOrder: 'little-endian',
      },
    })
    const result = await Promise.all([upload, pump])
    if (result[1] !== checksum) {
      throw new StageFailure('Streamed WAV checksum did not match the planned artifact', false)
    }
    stored = result[0]
  }
  return {
    r2Key: key,
    etag: stored!.etag,
    contentType: 'audio/wav',
    byteLength: wavByteLength,
    pcmByteLength,
    durationMs: durationMsForPcmBytes(pcmByteLength),
    sceneCount: scenes.length,
    sha256: checksum,
    manifestSha256,
    model: GEMINI_AUDIO_PROFILE.model,
    audioProfileId: GEMINI_AUDIO_PROFILE.id,
    audioProfileVersion: String(GEMINI_AUDIO_PROFILE.version),
    format: GEMINI_AUDIO_PROFILE.format,
  }
}

export async function orchestrateAudioOverview(
  step: DurableStep,
  params: AudioOverviewWorkflowParams,
  callStage: StageCaller,
  services: AudioOverviewWorkflowServices,
): Promise<{ cancelled: boolean }> {
  const prepared = await step.do('prepare', RETRY, async () =>
    expectSuccess(await callStage({ jobId: params.jobId, stage: 'prepare' })),
  )
  if (prepared.cancelled) return { cancelled: true }
  const sceneCount = prepared.sceneCount ?? 0
  if (!Number.isInteger(sceneCount) || sceneCount < 1 || sceneCount > 20) {
    throw new StageFailure('Prepare stage returned an invalid Scene count', false)
  }

  const sceneArtifacts: SceneArtifactMetadata[] = []
  for (let sceneOrder = 0; sceneOrder < sceneCount; sceneOrder++) {
    const context = await step.do(`scene-context-${sceneOrder}`, RETRY, async () =>
      expectSuccess(await callStage({ jobId: params.jobId, stage: 'scene-context', sceneOrder })),
    )
    if (context.cancelled) return { cancelled: true }
    const scene = requireScene(context, sceneOrder)
    let acceptedArtifact: SceneArtifactMetadata | null = null
    for (let attempt = 1; attempt <= MAX_SCENE_QUALITY_ATTEMPTS; attempt++) {
      const budget = await step.do(`claim-render-budget-${sceneOrder}-attempt-${attempt}`, RETRY, async () =>
        expectSuccess(await callStage({
          jobId: params.jobId,
          stage: 'claim-render',
          sceneOrder,
          attempt,
        })),
      )
      if (budget.cancelled) return { cancelled: true }
      const rendered = await step.do(`render-scene-${sceneOrder}-attempt-${attempt}`, RENDER_RETRY, async () =>
        renderAndStoreScene(services, params, scene, sceneOrder, attempt),
      )
      const committed = await step.do(`commit-scene-${sceneOrder}-attempt-${attempt}`, RETRY, async () =>
        expectSuccess(await callStage({
          jobId: params.jobId,
          stage: 'commit-scene',
          sceneOrder,
          artifact: rendered.artifact,
          qualityGate: rendered.qualityGate,
        })),
      )
      if (committed.cancelled) return { cancelled: true }
      if (rendered.qualityGate.decision === 'accepted') {
        acceptedArtifact = rendered.artifact
        break
      }
    }
    if (!acceptedArtifact) {
      throw new StageFailure(`Scene ${sceneOrder} exhausted ${MAX_SCENE_QUALITY_ATTEMPTS} Quality Gate attempts`, false)
    }
    sceneArtifacts.push(acceptedArtifact)
  }

  const artifact = await step.do('assemble-wav', RETRY, async () =>
    assembleAndStoreArtifact(services, params, sceneArtifacts),
  )
  const published = await step.do('publish', RETRY, async () =>
    expectSuccess(await callStage({ jobId: params.jobId, stage: 'publish', artifact })),
  )
  if (published.cancelled) return { cancelled: true }

  try {
    await step.do('align', RETRY, async () =>
      expectSuccess(await callStage({ jobId: params.jobId, stage: 'align' })),
    )
  }
  catch {
    // The immutable WAV is already published; alignment only enriches playback.
  }
  return { cancelled: false }
}
