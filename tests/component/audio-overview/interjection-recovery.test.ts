import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createAudioOverviewPlayback } from '~/composables/useAudioOverviewStore'
import type { Id } from '../../../convex/_generated/dataModel'

const policy = vi.hoisted(() => ({ responses: true }))
vi.mock('#shared/learn-v2-measurement-storage-manifest', async importOriginal => {
  const actual = await importOriginal<typeof import('#shared/learn-v2-measurement-storage-manifest')>()
  return { ...actual, LEARN_MEASUREMENT_CAPABILITIES: { ...actual.LEARN_MEASUREMENT_CAPABILITIES, get responses() { return policy.responses } } }
})

const originalUrl = 'https://audio.test/original.mp3'
const replacementUrl = 'https://audio.test/replacement.mp3'
const interjection = { mediaUrl: 'https://audio.test/interjection.mp3', utterances: [{ speaker: 'host_a' as const, text: 'An explanation' }], totalDurationMs: 1_000, resumeAtMs: 300, resumeAfter: true }

function audioElement() {
  const element = document.createElement('audio')
  vi.spyOn(element, 'pause').mockImplementation(() => {})
  vi.spyOn(element, 'load').mockImplementation(() => {})
  return element
}

function load(store: ReturnType<typeof createAudioOverviewPlayback>, id: string, url: string, continuous = false) {
  store.loadOverview({ overviewId: id as Id<'audioOverviews'>, folderId: null, title: id,
    turns: [{ speaker: 'host_a', text: 'Canonical teaching', durationMs: 1_000 }], turnUrls: [url],
    ...(continuous ? { playbackMode: 'continuous' as const, continuousMediaUrl: url } : {}),
  })
}

describe('interjection playback recovery', () => {
  beforeEach(() => {
    policy.responses = true
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each([false, true])('restores current canonical audio after an ordinary play failure, responses=%s', async responses => {
    policy.responses = responses
    const store = createAudioOverviewPlayback()
    const element = audioElement()
    const nativePlay = Promise.withResolvers<undefined>()
    vi.spyOn(element, 'play').mockReturnValue(nativePlay.promise)
    store.attachAudio(element, null)
    load(store, 'overview-original', originalUrl)
    const result = store.playInterjection(interjection).catch(cause => cause)
    const failure = new DOMException('Play interrupted', 'AbortError')
    nativePlay.reject(failure)
    expect(await result).toBe(failure)
    expect(element.getAttribute('src')).toBe(originalUrl)
    expect(store.isInterjectionActive.value).toBe(false)
    store.dismiss()
  })

  it.each(['release', 'dismiss', 'replacement', 'same-overview-media'] as const)('ignores a native rejection after %s', async scenario => {
    const store = createAudioOverviewPlayback()
    const element = audioElement()
    const nativePlay = Promise.withResolvers<undefined>()
    vi.spyOn(element, 'play').mockReturnValue(nativePlay.promise)
    store.attachAudio(element, null)
    load(store, 'overview-original', originalUrl)
    const result = store.playInterjection(interjection).catch(cause => cause)
    if (scenario === 'release') store.release('overview-original')
    else if (scenario === 'dismiss') store.dismiss()
    else load(store, scenario === 'replacement' ? 'overview-replacement' : 'overview-original', replacementUrl, scenario === 'same-overview-media')
    const expected = scenario === 'release' || scenario === 'dismiss' ? null : replacementUrl
    const loads = vi.mocked(element.load).mock.calls.length
    nativePlay.reject(new DOMException('Old play interrupted', 'AbortError'))
    await flushPromises()
    expect(element.getAttribute('src')).toBe(expected)
    expect(element.load).toHaveBeenCalledTimes(loads)
    expect(store.isInterjectionActive.value).toBe(false)
    expect(await result).toBeInstanceOf(Error)
    store.dismiss()
  })

  it('cannot reject or reset a replacement interjection', async () => {
    const store = createAudioOverviewPlayback()
    const element = audioElement()
    const oldPlay = Promise.withResolvers<undefined>()
    const newPlay = Promise.withResolvers<undefined>()
    vi.spyOn(element, 'play').mockReturnValueOnce(oldPlay.promise).mockReturnValueOnce(newPlay.promise)
    store.attachAudio(element, null)
    load(store, 'overview-original', originalUrl)
    const oldResult = store.playInterjection(interjection).catch(cause => cause)
    load(store, 'overview-replacement', replacementUrl)
    const nextInterjection = { ...interjection, mediaUrl: 'https://audio.test/new-interjection.mp3' }
    const newResult = store.playInterjection(nextInterjection).catch(cause => cause)
    oldPlay.reject(new Error('Old native rejection'))
    await flushPromises()
    expect(element.getAttribute('src')).toBe(nextInterjection.mediaUrl)
    expect(store.isInterjectionActive.value).toBe(true)
    const currentFailure = new Error('Current native rejection')
    newPlay.reject(currentFailure)
    expect(await newResult).toBe(currentFailure)
    expect(element.getAttribute('src')).toBe(replacementUrl)
    expect(await oldResult).toBeInstanceOf(Error)
    store.dismiss()
  })

  it('keeps an interjection current during an unchanged overview refresh', async () => {
    const store = createAudioOverviewPlayback()
    const element = audioElement()
    const nativePlay = Promise.withResolvers<undefined>()
    vi.spyOn(element, 'play').mockReturnValue(nativePlay.promise)
    store.attachAudio(element, null)
    load(store, 'overview-original', originalUrl)
    const result = store.playInterjection(interjection).catch(cause => cause)
    load(store, 'overview-original', originalUrl)
    expect(store.isInterjectionActive.value).toBe(true)
    expect(element.getAttribute('src')).toBe(interjection.mediaUrl)
    const failure = new Error('Current native rejection')
    nativePlay.reject(failure)
    expect(await result).toBe(failure)
    expect(element.getAttribute('src')).toBe(originalUrl)
    store.dismiss()
  })

  it('does not restore an old source after the attached element changes', async () => {
    const store = createAudioOverviewPlayback()
    const oldElement = audioElement()
    const nextElement = audioElement()
    const nativePlay = Promise.withResolvers<undefined>()
    vi.spyOn(oldElement, 'play').mockReturnValue(nativePlay.promise)
    store.attachAudio(oldElement, null)
    load(store, 'overview-original', originalUrl)
    const result = store.playInterjection(interjection).catch(cause => cause)
    store.attachAudio(nextElement, null)
    load(store, 'overview-replacement', replacementUrl)
    const oldSource = oldElement.getAttribute('src')
    nativePlay.reject(new Error('Detached element rejected'))
    await flushPromises()
    expect(oldElement.getAttribute('src')).toBe(oldSource)
    expect(nextElement.getAttribute('src')).toBe(replacementUrl)
    expect(store.isInterjectionActive.value).toBe(false)
    expect(await result).toBeInstanceOf(Error)
    store.dismiss()
  })
})
