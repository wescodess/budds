import type { H3Event } from 'h3'
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

export async function privateAudioResponse(event: H3Event, media: PrivateAudioMedia, deliver: () => Promise<void>): Promise<Response> {
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
  if (!upstream.body) return new Response(upstream.body, { status: upstream.status, headers })
  const reader = upstream.body.getReader()
  let bytes = 0
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        let part = await reader.read()
        for (let empty = 0; !part.done && part.value.byteLength === 0; empty++) {
          if (empty >= 128) throw new Error('Audio storage could not deliver published media')
          part = await reader.read()
        }
        if (part.done) { controller.close(); return }
        bytes += part.value.byteLength
        if (bytes > media.byteLength) throw new Error('Published audio media changed after publication')
        await deliver()
        controller.enqueue(part.value)
      } catch (error) {
        await reader.cancel().catch(() => {})
        controller.error(error)
      }
    },
    async cancel() { await reader.cancel() },
  }, { highWaterMark: 0 })
  return new Response(body, { status: upstream.status, headers })
}
