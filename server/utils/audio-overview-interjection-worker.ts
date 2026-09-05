import { readConfiguredRuntimeValue } from './runtime-config'
import { fetchPrivateR2Object } from './r2-folder'

type InterjectionWorker = { fetch(request: Request): Promise<Response> }

export function getAudioOverviewWorkerToken(event: any): string {
  const config = useRuntimeConfig(event)
  const token = readConfiguredRuntimeValue(
    config.audioOverviewWorkerToken,
    'NUXT_AUDIO_OVERVIEW_WORKER_TOKEN',
    'AUDIO_OVERVIEW_WORKER_TOKEN',
  )
  if (!token || token.length < 32) {
    throw createError({ statusCode: 503, message: 'Audio overview generation plane is not configured' })
  }
  return token
}

type InterjectionArtifactEvidence = {
  objectKey: string
  etag?: string
  checksumSha256: string
  byteLength: number
  contentType: string
  durationMs: number
}

function normalizedEtag(value: string | null | undefined): string | undefined {
  return value?.trim().replace(/^W\//, '').replace(/^"|"$/g, '') || undefined
}

/** Fail closed unless private R2 independently confirms the Worker's evidence. */
export async function assertPrivateInterjectionArtifact(
  artifact: InterjectionArtifactEvidence,
  expected: { interjectionId: string, idempotencyKey: string },
): Promise<void> {
  const head = await fetchPrivateR2Object(artifact.objectKey, { method: 'HEAD' }).catch(() => null)
  if (!head?.ok) {
    throw createError({ statusCode: 502, message: 'Interjection Audio Artifact is unavailable in private storage' })
  }
  const byteLength = Number(head.headers.get('content-length'))
  const durationMs = Number(head.headers.get('x-amz-meta-durationms'))
  const checksumSha256 = head.headers.get('x-amz-meta-checksumsha256')?.trim().toLowerCase()
  const interjectionId = head.headers.get('x-amz-meta-interjectionid')?.trim()
  const idempotencyKey = head.headers.get('x-amz-meta-idempotencykey')?.trim()
  const contentType = head.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  const storedEtag = normalizedEtag(head.headers.get('etag'))
  const reportedEtag = normalizedEtag(artifact.etag)

  if (!Number.isSafeInteger(byteLength)
    || byteLength !== artifact.byteLength
    || !Number.isSafeInteger(durationMs)
    || durationMs !== artifact.durationMs
    || checksumSha256 !== artifact.checksumSha256.trim().toLowerCase()
    || interjectionId !== expected.interjectionId
    || idempotencyKey !== expected.idempotencyKey
    || contentType !== 'audio/wav'
    || artifact.contentType !== 'audio/wav'
    || (reportedEtag !== undefined && storedEtag !== reportedEtag)) {
    throw createError({ statusCode: 502, message: 'Interjection Audio Artifact evidence does not match private storage' })
  }
}

export async function requestInterjectionWorker(
  event: any,
  method: 'POST' | 'DELETE',
  payload: Record<string, unknown>,
) {
  const config = useRuntimeConfig(event)
  const token = getAudioOverviewWorkerToken(event)
  const request = new Request('https://audio-overview-worker.internal/interjections/render', {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
  const binding = event.context.cloudflare?.env?.AUDIO_OVERVIEW_WORKFLOW as InterjectionWorker | undefined
  let response: Response
  if (binding?.fetch) response = await binding.fetch(request)
  else {
    const workerUrl = readConfiguredRuntimeValue(
      config.audioOverviewWorkerUrl,
      'NUXT_AUDIO_OVERVIEW_WORKER_URL',
      'AUDIO_OVERVIEW_WORKER_URL',
    )
    if (!workerUrl || !import.meta.dev) {
      throw createError({ statusCode: 503, message: 'Audio overview Workflow binding is not configured' })
    }
    response = await fetch(new URL('/interjections/render', workerUrl), {
      method,
      headers: request.headers,
      body: await request.text(),
    })
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    throw createError({ statusCode: response.status >= 500 ? 502 : response.status, message: `Interjection Audio Renderer failed${detail ? `: ${detail}` : ''}` })
  }
  return await response.json() as any
}
