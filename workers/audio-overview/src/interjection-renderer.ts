import { renderGeminiScene, type GeminiSceneUtterance } from './gemini-audio-renderer'
import { assembleWavBytes, AUDIO_OVERVIEW_PCM_FORMAT, sha256Hex } from './media'

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

export interface InterjectionRenderCommand {
  jobId: string
  interjectionId: string
  idempotencyKey: string
  utterances: GeminiSceneUtterance[]
}

export interface InterjectionCancelCommand {
  jobId: string
  interjectionId: string
  idempotencyKey: string
}

export type InterjectionArtifact = {
  objectKey: string
  etag?: string
  checksumSha256: string
  byteLength: number
  contentType: 'audio/wav'
  durationMs: number
}

type Dependencies = {
  bucket: R2Bucket
  apiKey: string
  fetch?: typeof globalThis.fetch
}

function validateIdentity(command: InterjectionCancelCommand) {
  if (!ID_PATTERN.test(command.jobId)
    || !ID_PATTERN.test(command.interjectionId)
    || !IDEMPOTENCY_PATTERN.test(command.idempotencyKey)) {
    throw new TypeError('Invalid Interjection render command')
  }
}

export function interjectionObjectKey(command: InterjectionCancelCommand): string {
  validateIdentity(command)
  return `audio-overviews/jobs/${command.jobId}/interjections/${command.interjectionId}.wav`
}

function artifactFromExisting(key: string, object: R2Object): InterjectionArtifact | null {
  const metadata = object.customMetadata ?? {}
  const checksumSha256 = metadata.checksumSha256 ?? ''
  const durationMs = Number(metadata.durationMs)
  if (!/^[a-f0-9]{64}$/.test(checksumSha256)
    || !Number.isSafeInteger(durationMs)
    || durationMs < 1
    || object.size < 46) return null
  return {
    objectKey: key,
    etag: object.etag,
    checksumSha256,
    byteLength: object.size,
    contentType: 'audio/wav',
    durationMs,
  }
}

export async function renderInterjection(
  command: InterjectionRenderCommand,
  dependencies: Dependencies,
): Promise<{ duplicate: boolean, artifact: InterjectionArtifact }> {
  const key = interjectionObjectKey(command)
  if (!Array.isArray(command.utterances) || command.utterances.length < 2 || command.utterances.length > 4) {
    throw new TypeError('Interjection requires 2 to 4 Utterances')
  }
  const existing = await dependencies.bucket.head(key)
  if (existing) {
    const metadata = existing.customMetadata ?? {}
    if (metadata.interjectionId !== command.interjectionId || metadata.idempotencyKey !== command.idempotencyKey) {
      throw new Error('Interjection object key already contains different evidence')
    }
    const artifact = artifactFromExisting(key, existing)
    if (!artifact) throw new Error('Existing Interjection artifact is invalid')
    return { duplicate: true, artifact }
  }

  const rendered = await renderGeminiScene({
    sceneId: `interjection-${command.interjectionId}`,
    sceneDirection: 'Briefly answer the listener, preserve both established Host voices, then close cleanly so the original episode can resume.',
    utterances: command.utterances,
  }, {
    fetch: dependencies.fetch,
    config: { apiKey: dependencies.apiKey },
  })
  const wav = assembleWavBytes([{
    bytes: rendered.audio,
    sampleRateHz: AUDIO_OVERVIEW_PCM_FORMAT.sampleRateHz,
    channelCount: AUDIO_OVERVIEW_PCM_FORMAT.channelCount,
    bitsPerSample: AUDIO_OVERVIEW_PCM_FORMAT.bitsPerSample,
    sampleEncoding: AUDIO_OVERVIEW_PCM_FORMAT.sampleEncoding,
    byteOrder: AUDIO_OVERVIEW_PCM_FORMAT.byteOrder,
  }])
  const checksumSha256 = await sha256Hex(wav)
  const durationMs = Math.max(1, rendered.metadata.durationMs)
  const stored = await dependencies.bucket.put(key, wav, {
    httpMetadata: { contentType: 'audio/wav' },
    customMetadata: {
      interjectionId: command.interjectionId,
      idempotencyKey: command.idempotencyKey,
      checksumSha256,
      durationMs: String(durationMs),
      audioProfileId: rendered.metadata.audioProfileId,
      audioProfileVersion: String(rendered.metadata.audioProfileVersion),
      rendererModel: rendered.metadata.model,
    },
  })
  return {
    duplicate: false,
    artifact: {
      objectKey: key,
      etag: stored?.etag,
      checksumSha256,
      byteLength: wav.byteLength,
      contentType: 'audio/wav',
      durationMs,
    },
  }
}

export async function cancelInterjection(
  command: InterjectionCancelCommand,
  dependencies: Pick<Dependencies, 'bucket'>,
): Promise<{ deleted: true, objectKey: string }> {
  const objectKey = interjectionObjectKey(command)
  await dependencies.bucket.delete(objectKey)
  return { deleted: true, objectKey }
}
