import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sanitizeFilename, useAudioOverviewDownload } from '~/composables/useAudioOverviewDownload'

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

describe('continuous WAV download', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('downloads the published WAV directly without fetching or concatenating segments', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const result = await useAudioOverviewDownload().downloadOverview({
      title: 'Grounded overview',
      mediaUrl: '/api/audio-overview/media/artifact_1',
    })

    expect(click).toHaveBeenCalledOnce()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result).toEqual({
      total: 1,
      fetched: 1,
      skipped: 0,
      failed: [],
      bytes: 0,
      filename: 'Grounded overview.wav',
    })
  })

  it('rejects legacy segmented MP3 download without fetching or concatenating bytes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(useAudioOverviewDownload().downloadOverview({
      title: 'Legacy overview',
      turnUrls: ['/segment-1.mp3', '/segment-2.mp3'],
    })).rejects.toThrow(/generate a new Audio Overview/i)

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
