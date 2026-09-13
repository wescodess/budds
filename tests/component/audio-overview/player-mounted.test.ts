import { flushPromises, mount } from '@vue/test-utils'
import { getFunctionName } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { createAudioOverviewPlayback } from '~/composables/useAudioOverviewStore'

class FakeAudio extends EventTarget {
  currentTime = 0
  playbackRate = 1
  src = ''
  async play() { this.dispatchEvent(new Event('play')) }
  pause() { this.dispatchEvent(new Event('pause')) }
  load() {}
  removeAttribute(name: string) { if (name === 'src') this.src = '' }
}

const baseV2 = {
  schemaVersion: 2 as const,
  title: 'Mounted continuous overview',
  totalDurationMs: 4_000,
  sourceManifest: { sources: [{ sourceId: 'source-1', displayReference: 'Chapter One' }] },
  scenes: [{ sceneId: 'scene-1', order: 0, durationMs: 4_000 }],
  utterances: [
    { utteranceId: 'u1', sceneId: 'scene-1', order: 0, speaker: 'host_a' as const, text: 'Host A opens.' },
    { utteranceId: 'u2', sceneId: 'scene-1', order: 1, speaker: 'host_b' as const, text: 'Host B answers.' },
  ],
  finalArtifact: { artifactId: 'artifact-1' },
}

const baseV1 = {
  _id: 'overview-v1',
  _creationTime: 1,
  userId: 'owner-1',
  folderId: 'folder-1',
  title: 'Mounted segmented overview',
  status: 'ready',
  totalDurationMs: 3_000,
  sourceDocumentIds: ['document-1'],
  voiceProfile: { hostA: 'asteria', hostB: 'orion' },
  turns: [
    { speaker: 'host_a' as const, text: 'Legacy Host A opens.', audioFileId: 'audio-1', durationMs: 1_000 },
    { speaker: 'host_b' as const, text: 'Legacy Host B answers.', audioFileId: 'audio-2', durationMs: 2_000 },
  ],
}

describe('mounted Audio Overview v2 playback', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('useDocuments', () => ({ documents: ref([]) }))
    vi.stubGlobal('useAudioOverviewDownload', () => ({ downloadOverview: vi.fn() }))
  })

  afterEach(() => vi.unstubAllGlobals())

  it('renders and plays a v1 segmented overview when the v2 projection is null', async () => {
    vi.stubGlobal('useDocuments', () => ({
      documents: ref([{ _id: 'document-1', filename: 'Legacy chapter.pdf', status: 'success' }]),
    }))
    vi.stubGlobal('useConvexQuery', (reference: unknown) => {
      const name = getFunctionName(reference as never)
      if (name === 'audioOverviews:getWithTurns') return { data: ref({ ...baseV1 }) }
      if (name === 'audioOverviews:getTurnUrls') return { data: ref(['/legacy/turn-1.mp3', '/legacy/turn-2.mp3']) }
      if (name === 'audioOverviewV2:getPlaybackForOwner') return { data: ref(null) }
      return { data: ref(null) }
    })
    const playback = createAudioOverviewPlayback()
    vi.stubGlobal('useAudioOverviewStore', () => playback)

    const Component = (await import('~/components/audio-overview/AudioOverviewPlayer.vue')).default
    const wrapper = mount(Component, {
      props: { overviewId: 'overview-v1' as never, folderId: 'folder-1' as never },
    })
    await nextTick()

    expect(playback.playbackMode.value).toBe('segmented')
    expect(playback.continuousMediaUrl.value).toBeNull()
    expect(playback.turns.value.map(turn => turn.text)).toEqual([
      'Legacy Host A opens.',
      'Legacy Host B answers.',
    ])
    expect(wrapper.get('[data-testid="audio-overview-title"]').text()).toBe(baseV1.title)
    expect(wrapper.get('[data-testid="audio-overview-source-pills"]').text()).toContain('Legacy chapter.pdf')
    const player = wrapper.get('[data-testid="audio-overview-player"]')
    expect(player.classes()).toContain('overflow-hidden')
    expect(wrapper.get('[data-testid="audio-overview-player-scroll-region"]').classes()).toContain('overflow-y-auto')
    const playerBar = wrapper.get('[data-testid="audio-overview-player-bar"]')
    expect(playerBar.classes()).toContain('shrink-0')
    expect(playerBar.element.parentElement).toBe(player.element)

    const audio = new FakeAudio()
    playback.attachAudio(audio as unknown as HTMLAudioElement, null)
    await wrapper.get('[data-testid="audio-overview-play-btn"]').trigger('click')
    await nextTick()
    expect(audio.src).toBe('/legacy/turn-1.mp3')
    expect(playback.isPlaying.value).toBe(true)
    expect(wrapper.get('[data-testid="audio-overview-host-a"]').text()).toContain('Speaking')
  })

  it('updates Hosts and Alignment without refresh, pauses for an Interjection, then resumes the canonical WAV', async () => {
    const legacy = ref({ _id: 'overview-1', title: baseV2.title, turns: [], sourceDocumentIds: [] })
    const v2 = ref({ ...baseV2 })
    vi.stubGlobal('useConvexQuery', (reference: unknown) => {
      const name = getFunctionName(reference as never)
      if (name === 'audioOverviews:getWithTurns') return { data: legacy }
      if (name === 'audioOverviews:getTurnUrls') return { data: ref([]) }
      if (name === 'audioOverviewV2:getPlaybackForOwner') return { data: v2 }
      return { data: ref(null) }
    })
    const playback = createAudioOverviewPlayback()
    vi.stubGlobal('useAudioOverviewStore', () => playback)

    const Component = (await import('~/components/audio-overview/AudioOverviewPlayer.vue')).default
    const wrapper = mount(Component, { props: { overviewId: 'overview-1' as never, folderId: 'folder-1' as never } })
    await nextTick()
    expect(playback.turns.value).toHaveLength(2)
    expect(playback.playbackMode.value).toBe('continuous')

    const audio = new FakeAudio()
    playback.attachAudio(audio as unknown as HTMLAudioElement, null)
    await playback.play()
    audio.currentTime = 2.5
    audio.dispatchEvent(new Event('timeupdate'))
    await nextTick()
    expect(playback.currentTurnIndex.value).toBe(1)
    expect(wrapper.get('[data-testid="audio-overview-host-b"]').text()).toContain('Speaking')
    expect(wrapper.get('[data-testid="audio-overview-active-quote"]').text()).toContain('Host B answers.')

    v2.value = {
      ...baseV2,
      utterances: [
        { ...baseV2.utterances[0]!, alignmentStartMs: 100, wordTimings: [{ word: 'Host', start: 0.1, end: 0.3 }] },
        { ...baseV2.utterances[1]!, alignmentStartMs: 1_000, wordTimings: [{ word: 'Host', start: 1, end: 1.2 }] },
      ],
    }
    await nextTick()
    const transcript = wrapper.findComponent({ name: 'AudioOverviewSyncedTranscript' })
    expect(transcript.props('turns').map((turn: { durationMs: number }) => turn.durationMs)).toEqual([1_000, 3_000])
    expect(transcript.props('turns')[1].wordTimings[0]).toMatchObject({ word: 'Host', start: 0 })
    expect(transcript.props('turns')[1].wordTimings[0].end).toBeCloseTo(0.2)

    const interjectionDone = playback.playInterjection({
      mediaUrl: '/api/audio-overview/interjections/interjection-1/media',
      totalDurationMs: 2_000,
      resumeAtMs: 2_500,
      resumeAfter: true,
      utterances: [{ speaker: 'host_a', text: 'A grounded answer.', sourceIds: ['source-1'] }],
    })
    await nextTick()
    expect(wrapper.get('[data-testid="audio-overview-host-a"]').text()).toContain('Speaking')
    expect(wrapper.get('[data-testid="audio-overview-active-quote"]').text()).toContain('A grounded answer.')
    expect(audio.src).toBe('/api/audio-overview/interjections/interjection-1/media')

    audio.dispatchEvent(new Event('ended'))
    await interjectionDone
    await nextTick()
    expect(audio.src).toBe('/api/audio-overview/media/artifact-1')
    expect(audio.currentTime).toBe(2.5)
    expect(wrapper.get('[data-testid="audio-overview-host-b"]').text()).toContain('Speaking')

    wrapper.unmount()
    const reloadedPlayback = createAudioOverviewPlayback()
    vi.stubGlobal('useAudioOverviewStore', () => reloadedPlayback)
    const reloaded = mount(Component, { props: { overviewId: 'overview-1' as never, folderId: 'folder-1' as never } })
    await nextTick()
    expect(reloadedPlayback.playbackMode.value).toBe('continuous')
    expect(reloadedPlayback.continuousMediaUrl.value).toBe('/api/audio-overview/media/artifact-1')
    expect(reloadedPlayback.turns.value).toHaveLength(2)
    expect(reloaded.text()).toContain('Host A opens.')
  })

  it('renders the normalized public projection through the private share media route', async () => {
    vi.stubGlobal('useConvexQuery', (reference: unknown) => {
      const name = getFunctionName(reference as never)
      if (name === 'audioOverviewV2:getPlaybackByShareToken') {
        return { data: ref({ ...baseV2, voiceProfile: { hostA: 'Kore', hostB: 'Puck' }, publishedAt: 1 }) }
      }
      if (name === 'audioOverviews:getByShareToken') return { data: ref(null) }
      if (name === 'audioOverviews:getTurnUrlsByShareToken') return { data: ref([]) }
      return { data: ref(null) }
    })

    const Component = (await import('~/components/audio-overview/PublicAudioShell.vue')).default
    const wrapper = mount(Component, { props: { token: 'share-token' } })
    await flushPromises()

    expect(wrapper.get('[data-testid="public-audio-title"]').text()).toBe(baseV2.title)
    expect(wrapper.text()).toContain('Host A opens.')
    expect(wrapper.text()).toContain('Chapter One')
    expect(wrapper.html()).not.toContain('artifact-1')
  })
})
