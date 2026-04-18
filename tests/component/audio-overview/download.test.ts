import { describe, it, expect, vi, beforeEach } from 'vitest'
import { concatMp3Segments, sanitizeFilename } from '~/composables/useAudioOverviewDownload'

function mockFetch(byNamedUrl: Record<string, Response>) {
  ;(globalThis as any).fetch = vi.fn(async (url: string) => {
    const res = byNamedUrl[url]
    if (!res) throw new Error(`Unknown URL: ${url}`)
    return res
  })
}

function okResponse(bytes: Uint8Array): Response {
  return {
    ok: true,
    statusText: 'OK',
    status: 200,
    arrayBuffer: async () => bytes.buffer,
  } as unknown as Response
}

function errorResponse(status: number, statusText: string): Response {
  return {
    ok: false,
    status,
    statusText,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response
}

describe('concatMp3Segments', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('concatenates all segments in URL order', async () => {
    mockFetch({
      'u1': okResponse(new Uint8Array([1, 2, 3])),
      'u2': okResponse(new Uint8Array([4, 5])),
      'u3': okResponse(new Uint8Array([6, 7, 8, 9])),
    })

    const result = await concatMp3Segments(['u1', 'u2', 'u3'])

    expect(result.fetched).toBe(3)
    expect(result.skipped).toBe(0)
    expect(result.failed).toEqual([])
    expect(Array.from(result.bytes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('skips null URLs but preserves order of the remaining segments', async () => {
    mockFetch({
      'u1': okResponse(new Uint8Array([10])),
      'u3': okResponse(new Uint8Array([30])),
    })

    const result = await concatMp3Segments(['u1', null, 'u3'])

    expect(result.fetched).toBe(2)
    expect(result.skipped).toBe(1)
    expect(result.failed).toEqual([])
    expect(Array.from(result.bytes)).toEqual([10, 30])
    expect((globalThis as any).fetch).toHaveBeenCalledTimes(2)
  })

  it('treats zero-byte success as skipped', async () => {
    mockFetch({
      'u1': okResponse(new Uint8Array([1, 2])),
      'u2': okResponse(new Uint8Array([])),
      'u3': okResponse(new Uint8Array([3])),
    })

    const result = await concatMp3Segments(['u1', 'u2', 'u3'])

    expect(result.fetched).toBe(2)
    expect(result.skipped).toBe(1)
    expect(result.failed).toEqual([])
    expect(Array.from(result.bytes)).toEqual([1, 2, 3])
  })

  it('captures per-index failures without aborting', async () => {
    mockFetch({
      'u1': okResponse(new Uint8Array([1])),
      'u2': errorResponse(503, 'Service Unavailable'),
      'u3': okResponse(new Uint8Array([3])),
    })

    const result = await concatMp3Segments(['u1', 'u2', 'u3'])

    expect(result.fetched).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]!.index).toBe(1)
    expect(result.failed[0]!.reason).toContain('503')
    expect(Array.from(result.bytes)).toEqual([1, 3])
  })

  it('returns empty buffer when all URLs are null', async () => {
    const result = await concatMp3Segments([null, null])
    expect(result.fetched).toBe(0)
    expect(result.skipped).toBe(2)
    expect(result.failed).toEqual([])
    expect(result.bytes.byteLength).toBe(0)
  })

  it('fetches segments in parallel', async () => {
    const resolved: number[] = []
    let released!: () => void
    const gate = new Promise<void>((r) => { released = r })

    ;(globalThis as any).fetch = vi.fn(async (url: string) => {
      // All fetches start before any resolves
      if (url === 'u1') {
        await gate
        resolved.push(1)
      } else if (url === 'u2') {
        resolved.push(2)
        released()
      }
      return okResponse(new Uint8Array([Number(url.slice(1))])) as Response
    })

    const result = await concatMp3Segments(['u1', 'u2'])
    expect(result.fetched).toBe(2)
    // u2 resolved first even though u1 was awaited first => proves parallel dispatch
    expect(resolved[0]).toBe(2)
  })
})

describe('sanitizeFilename', () => {
  it('strips unsafe characters', () => {
    expect(sanitizeFilename('Hello/World\\foo?.mp3')).toBe('HelloWorldfoo.mp3')
  })

  it('collapses whitespace', () => {
    expect(sanitizeFilename('  many   spaces   here  ')).toBe('many spaces here')
  })

  it('caps length at 80 chars', () => {
    const long = 'a'.repeat(200)
    expect(sanitizeFilename(long).length).toBe(80)
  })

  it('falls back to a default when empty', () => {
    expect(sanitizeFilename('   ')).toBe('audio-overview')
    expect(sanitizeFilename('')).toBe('audio-overview')
  })
})
