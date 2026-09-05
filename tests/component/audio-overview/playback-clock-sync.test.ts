import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildContinuousPlaybackTurns, createAudioOverviewPlayback, type AudioOverviewTurn } from '~/composables/useAudioOverviewStore'
import { useWordSync } from '~/composables/useWordSync'
import type { Id } from '../../../convex/_generated/dataModel'

class FakeAudio extends EventTarget {
  currentTime = 0
  playbackRate = 1
  private source = ''
  srcAssignments = 0
  playCalls = 0

  get src() { return this.source }
  set src(value: string) {
    this.source = value
    this.srcAssignments++
  }

  async play() {
    this.playCalls++
    this.dispatchEvent(new Event('play'))
  }

  pause() {
    this.dispatchEvent(new Event('pause'))
  }

  load() {}

  removeAttribute(name: string) {
    if (name === 'src') this.source = ''
  }
}

const turn: AudioOverviewTurn = {
  speaker: 'host_a',
  text: 'One two three four',
  audioFileId: 'file_1' as unknown as Id<'_storage'>,
  durationMs: 10_000,
  wordTimings: [
    { word: 'One', start: 0, end: 1 },
    { word: 'two', start: 1, end: 2 },
    { word: 'three', start: 2, end: 3 },
    { word: 'four', start: 3, end: 4 },
  ],
}

describe('audio overview playback clock', () => {
  const frameCallbacks = new Map<number, FrameRequestCallback>()
  let nextFrameId = 1

  beforeEach(() => {
    frameCallbacks.clear()
    nextFrameId = 1
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId++
      frameCallbacks.set(id, callback)
      return id
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => {
      frameCallbacks.delete(id)
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([0.5, 1, 1.2, 1.5, 2])('tracks the active transcript word every frame at %sx speed', async (rate) => {
    const playback = createAudioOverviewPlayback()
    const audio = new FakeAudio()
    playback.attachAudio(audio as unknown as HTMLAudioElement, null)
    playback.loadOverview({
      overviewId: 'overview_1' as unknown as Id<'audioOverviews'>,
      folderId: 'folder_1' as unknown as Id<'folders'>,
      title: 'Clock sync',
      turns: [turn],
      turnUrls: ['https://audio.test/turn-1.mp3'],
    })
    playback.setSpeed(rate)
    const { activeWordIndex } = useWordSync(
      playback.turns,
      playback.currentTurnIndex,
      playback.currentAudioTimeSec,
    )

    await playback.play()
    audio.currentTime = 2.75

    const frame = [...frameCallbacks.values()][0]
    expect(frame).toBeTypeOf('function')
    frame!(16)

    expect(activeWordIndex.value).toBe(2)
  })

  it('binds the selected overview audio after switching history entries', async () => {
    const playback = createAudioOverviewPlayback()
    const audio = new FakeAudio()
    playback.attachAudio(audio as unknown as HTMLAudioElement, null)
    playback.loadOverview({
      overviewId: 'overview_1' as unknown as Id<'audioOverviews'>,
      folderId: 'folder_1' as unknown as Id<'folders'>,
      title: 'First overview',
      turns: [turn],
      turnUrls: ['https://audio.test/first.mp3'],
    })
    await playback.play()

    playback.loadOverview({
      overviewId: 'overview_2' as unknown as Id<'audioOverviews'>,
      folderId: 'folder_1' as unknown as Id<'folders'>,
      title: 'Second overview',
      turns: [{ ...turn, audioFileId: 'file_2' as unknown as Id<'_storage'> }],
      turnUrls: ['https://audio.test/second.mp3'],
    })

    expect(audio.src).toBe('https://audio.test/second.mp3')
    expect(playback.currentTurnIndex.value).toBe(0)

    await playback.play()
    expect(playback.isPlaying.value).toBe(true)
  })

  it('plays one continuous WAV while advancing approximate utterance timing', async () => {
    const playback = createAudioOverviewPlayback()
    const audio = new FakeAudio()
    playback.attachAudio(audio as unknown as HTMLAudioElement, null)
    playback.loadOverview({
      overviewId: 'overview_v2' as unknown as Id<'audioOverviews'>,
      folderId: 'folder_1' as unknown as Id<'folders'>,
      title: 'Continuous overview',
      playbackMode: 'continuous',
      continuousMediaUrl: '/api/audio-overview/media/artifact_1',
      turns: [
        { speaker: 'host_a', text: 'First', durationMs: 1_000 },
        { speaker: 'host_b', text: 'Second', durationMs: 2_000 },
        { speaker: 'host_a', text: 'Third', durationMs: 1_000 },
      ],
    })

    await playback.play()
    audio.currentTime = 1.5
    audio.dispatchEvent(new Event('timeupdate'))

    expect(playback.playbackMode.value).toBe('continuous')
    expect(playback.currentTurnIndex.value).toBe(1)
    expect(playback.currentAudioTimeSec.value).toBe(0.5)
    expect(playback.currentTimeMs.value).toBe(1_500)
    expect(audio.srcAssignments).toBe(1)

    playback.seek(3_500)
    expect(audio.currentTime).toBe(3.5)
    expect(playback.currentTurnIndex.value).toBe(2)
    expect(audio.srcAssignments).toBe(1)

    audio.dispatchEvent(new Event('ended'))
    // The seek while playing preserves playback, so it intentionally invokes
    // play once more without reassigning the continuous media source.
    expect(audio.playCalls).toBe(2)
    expect(playback.currentTurnIndex.value).toBe(2)
    expect(playback.currentTimeMs.value).toBe(4_000)
  })

  it('allocates the published duration across Scene utterances without duplicating media', () => {
    const turns = buildContinuousPlaybackTurns(
      [
        { sceneId: 'scene_1', order: 0, durationMs: 2_000 },
        { sceneId: 'scene_2', order: 1, durationMs: 1_000 },
      ],
      [
        { utteranceId: 'u1', sceneId: 'scene_1', order: 0, speaker: 'host_a', text: 'A short thought.' },
        { utteranceId: 'u2', sceneId: 'scene_1', order: 1, speaker: 'host_b', text: 'A longer response with a deliberate pause.', pauseAfterMs: 800 },
        { utteranceId: 'u3', sceneId: 'scene_2', order: 2, speaker: 'host_a', text: 'The close.' },
      ],
      3_000,
    )

    expect(turns).toHaveLength(3)
    expect(turns.reduce((sum, item) => sum + item.durationMs, 0)).toBe(3_000)
    expect(turns[1]!.durationMs).toBeGreaterThan(turns[0]!.durationMs)
    expect(turns.every(item => item.audioFileId === undefined)).toBe(true)
  })

  it('uses realtime Alignment anchors when they become ready', () => {
    const turns = buildContinuousPlaybackTurns(
      [{ sceneId: 'scene_1', order: 0, durationMs: 4_000 }],
      [
        {
          utteranceId: 'u1', sceneId: 'scene_1', order: 0, speaker: 'host_a', text: 'First thought.',
          alignmentStartMs: 200,
          wordTimings: [{ word: 'First', start: 0.2, end: 0.6 }],
        },
        {
          utteranceId: 'u2', sceneId: 'scene_1', order: 1, speaker: 'host_b', text: 'Second thought.',
          alignmentStartMs: 2_000,
          wordTimings: [{ word: 'Second', start: 2, end: 2.5 }],
        },
      ],
      4_000,
    )

    expect(turns.map(item => item.durationMs)).toEqual([2_000, 2_000])
    expect(turns[0]!.wordTimings).toEqual([{ word: 'First', start: 0.2, end: 0.6 }])
    expect(turns[1]!.wordTimings).toEqual([{ word: 'Second', start: 0, end: 0.5 }])
  })

  it('pauses one continuous episode, plays an Interjection once, then resumes the exact canonical time', async () => {
    const playback = createAudioOverviewPlayback()
    const audio = new FakeAudio()
    playback.attachAudio(audio as unknown as HTMLAudioElement, null)
    playback.loadOverview({
      overviewId: 'overview_v2' as unknown as Id<'audioOverviews'>,
      folderId: 'folder_1' as unknown as Id<'folders'>,
      title: 'Continuous overview',
      playbackMode: 'continuous',
      continuousMediaUrl: '/api/audio-overview/media/artifact_1',
      turns: [
        { speaker: 'host_a', text: 'Canonical opening.', durationMs: 10_000 },
        { speaker: 'host_b', text: 'Canonical explanation.', durationMs: 20_000 },
      ],
    })
    await playback.play()
    audio.currentTime = 12.5
    audio.dispatchEvent(new Event('timeupdate'))

    const completed = playback.playInterjection({
      mediaUrl: '/api/audio-overview/interjections/interjection_1/media',
      totalDurationMs: 4_000,
      resumeAtMs: 12_500,
      resumeAfter: true,
      utterances: [
        { speaker: 'host_a', text: 'Here is the grounded answer.', sourceIds: ['source-1'] },
        { speaker: 'host_b', text: 'That explains the distinction.', sourceIds: ['source-1'] },
      ],
    })
    await Promise.resolve()

    expect(playback.isInterjectionActive.value).toBe(true)
    expect(playback.interjectionTurns.value.map(item => item.speaker)).toEqual(['host_a', 'host_b'])
    expect(audio.src).toBe('/api/audio-overview/interjections/interjection_1/media')

    audio.currentTime = 3
    audio.dispatchEvent(new Event('timeupdate'))
    expect(playback.interjectionCurrentTurnIndex.value).toBe(1)

    audio.dispatchEvent(new Event('ended'))
    await completed
    expect(playback.isInterjectionActive.value).toBe(false)
    expect(audio.src).toBe('/api/audio-overview/media/artifact_1')
    expect(audio.currentTime).toBe(12.5)
    expect(playback.currentTimeMs.value).toBe(12_500)
    expect(audio.playCalls).toBe(3)
  })
})
