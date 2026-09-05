import { fetchPrivateR2Object } from './r2-folder'

export type PrivateAudioMedia = {
  objectKey: string
  etag?: string
  checksumSha256: string
  byteLength: number
  contentType: string
  container: string
}

const SINGLE_BYTE_RANGE = /^bytes=(?:\d+-\d*|-\d+)$/

export async function privateAudioResponse(event: any, media: PrivateAudioMedia): Promise<Response> {
  if (media.container !== 'wav' || media.contentType !== 'audio/wav' || media.byteLength < 44) {
    throw createError({ statusCode: 409, message: 'Published audio media is invalid' })
  }
  const range = getRequestHeader(event, 'range')?.trim()
  if (range && !SINGLE_BYTE_RANGE.test(range)) {
    throw createError({ statusCode: 416, message: 'Requested audio range is invalid' })
  }
  const upstream = await fetchPrivateR2Object(media.objectKey, range ? { range } : undefined)
  if (upstream.status === 404) throw createError({ statusCode: 404, message: 'Audio media is unavailable' })
  if (upstream.status !== 200 && upstream.status !== 206) {
    throw createError({ statusCode: 502, message: 'Audio storage could not serve the published artifact' })
  }
  if (!range) {
    const receivedLength = Number(upstream.headers.get('content-length') ?? media.byteLength)
    if (receivedLength !== media.byteLength) {
      throw createError({ statusCode: 409, message: 'Published audio media changed after publication' })
    }
  }
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store, max-age=0',
    'Content-Type': 'audio/wav',
    'ETag': media.etag ? `"${media.etag.replace(/^"|"$/g, '')}"` : `"sha256-${media.checksumSha256}"`,
    'X-Content-Type-Options': 'nosniff',
  })
  for (const name of ['content-length', 'content-range']) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  return new Response(upstream.body, { status: upstream.status, headers })
}
