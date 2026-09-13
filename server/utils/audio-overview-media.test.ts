import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockFetch = vi.fn()

vi.stubGlobal('createError', (options: { statusCode: number, message: string }) =>
  Object.assign(new Error(options.message), { statusCode: options.statusCode }),
)
vi.stubGlobal('getRequestHeader', vi.fn())
vi.mock('./r2-folder', () => ({ fetchPrivateR2Object: mockFetch }))

const { privateAudioResponse } = await import('./audio-overview-media')
const media = {
  objectKey: 'audio-overviews/jobs/job_1/overview.wav',
  etag: 'abc',
  checksumSha256: 'a'.repeat(64),
  byteLength: 48,
  contentType: 'audio/wav',
  container: 'wav',
}

describe('private Audio Overview media proxy', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.mocked(globalThis.getRequestHeader).mockReset()
  })

  test('proxies one authorized byte range with only safe media headers', async () => {
    vi.mocked(globalThis.getRequestHeader).mockReturnValue('bytes=0-15')
    mockFetch.mockResolvedValue(new Response(new Uint8Array(16), {
      status: 206,
      headers: {
        'Content-Length': '16',
        'Content-Range': 'bytes 0-15/48',
        'x-amz-meta-secret': 'must-not-leak',
      },
    }))

    const response = await privateAudioResponse({}, media)

    expect(mockFetch).toHaveBeenCalledWith(media.objectKey, { range: 'bytes=0-15' })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 0-15/48')
    expect(response.headers.get('x-amz-meta-secret')).toBeNull()
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  test('rejects multiple ranges before touching R2', async () => {
    vi.mocked(globalThis.getRequestHeader).mockReturnValue('bytes=0-1,4-5')

    await expect(privateAudioResponse({}, media)).rejects.toMatchObject({ statusCode: 416 })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  test('rejects a full object whose length changed after publication', async () => {
    mockFetch.mockResolvedValue(new Response(new Uint8Array(47), { headers: { 'Content-Length': '47' } }))

    await expect(privateAudioResponse({}, media)).rejects.toMatchObject({ statusCode: 409 })
  })
})
