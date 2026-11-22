import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, onScopeDispose, ref, toValue } from 'vue'
import { createAudioOverviewPlayback } from '~/composables/useAudioOverviewStore'
import { deniedRead as denied, resetTeachingReads, teachingClient, teachingRead, type TeachingRead } from '../support/teaching-reads'

vi.mock('#shared/learn-v2-measurement-storage-manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#shared/learn-v2-measurement-storage-manifest')>()
  return { ...actual, LEARN_MEASUREMENT_CAPABILITIES: { ...actual.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})

const v2 = {
  schemaVersion: 2 as const,
  title: 'Recovered overview',
  totalDurationMs: 4_000,
  voiceProfile: { hostA: 'Kore', hostB: 'Puck' },
  hostNames: { hostA: 'Host A', hostB: 'Host B' },
  publishedAt: 1,
  sourceManifest: { sources: [{ sourceId: 'source-1', displayReference: 'Chapter One' }] },
  scenes: [{ sceneId: 'scene-1', order: 0, durationMs: 4_000 }],
  utterances: [{ utteranceId: 'u1', sceneId: 'scene-1', order: 0, speaker: 'host_a' as const, text: 'Host A opens.' }],
  finalArtifact: { artifactId: 'artifact-1' },
}

let queries: Record<string, TeachingRead>

function stubQueries(names: string[]) {
  resetTeachingReads()
  queries = Object.fromEntries(names.map(name => [name, teachingRead(name)]))
  for (const read of Object.values(queries)) read.data.value = null
}

const ownerOverview = { _id: 'overview-1', title: 'Owner overview', turns: [], hostNames: { hostA: 'Host A', hostB: 'Host B' }, sourceDocumentIds: [] }
const publicOverview = { title: 'Shared overview', turns: [], voiceProfile: v2.voiceProfile, hostNames: v2.hostNames, totalDurationMs: 4_000, sourceDocumentIds: [], sourceFilenames: [], publishedAt: 1 }

function fakeAudio() {
  const el = document.createElement('audio')
  vi.spyOn(el, 'pause').mockImplementation(() => {})
  vi.spyOn(el, 'load').mockImplementation(() => {})
  vi.spyOn(el, 'play').mockResolvedValue(undefined)
  return el
}

describe('audio teaching read failures with responses on', () => {
  let store: ReturnType<typeof createAudioOverviewPlayback>
  beforeEach(() => {
    store = createAudioOverviewPlayback()
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('useDocuments', () => ({ documents: ref([]) }))
    vi.stubGlobal('useAudioOverviewDownload', () => ({ downloadOverview: vi.fn() }))
    vi.stubGlobal('useAudioOverviewStore', () => store)
    vi.stubGlobal('useConvex', () => teachingClient)
    vi.stubGlobal('toValue', toValue)
    vi.stubGlobal('onScopeDispose', onScopeDispose)
  })

  afterEach(() => vi.unstubAllGlobals())

  describe('PublicAudioShell', () => {
    const names = ['audioOverviews:getByShareToken', 'audioOverviews:getTurnUrlsByShareToken', 'audioOverviewV2:getPlaybackByShareToken']
    async function mountShell() {
      const Component = (await import('~/components/audio-overview/PublicAudioShell.vue')).default
      const wrapper = mount(Component, { props: { token: 'share-token' } })
      await flushPromises()
      return wrapper
    }

    it('pauses without retry while a check is open', async () => {
      stubQueries(names)
      queries['audioOverviewV2:getPlaybackByShareToken']!.error.value = denied('test_open')
      const wrapper = await mountShell()
      const paused = wrapper.get('[data-testid="audio-read-paused"]')
      expect(paused.attributes('role')).toBe('status')
      expect(paused.text()).toBe('This is paused while you have a check open. Finish the check, then come back.')
      expect(wrapper.find('[data-testid="audio-read-retry"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="public-audio-loading"]').exists()).toBe(false)
    })

    it('says plainly when disclosure is unknown', async () => {
      stubQueries(names)
      queries['audioOverviews:getByShareToken']!.error.value = denied('disclosure_unknown')
      const wrapper = await mountShell()
      expect(wrapper.get('[data-testid="audio-read-paused"]').text()).toBe('This isn’t available right now.')
      expect(wrapper.find('[data-testid="audio-read-retry"]').exists()).toBe(false)
    })

    it('retries only the failed read and recovers', async () => {
      stubQueries(names)
      const failed = queries['audioOverviewV2:getPlaybackByShareToken']!
      failed.error.value = new Error('network')
      const wrapper = await mountShell()
      expect(wrapper.get('[data-testid="audio-read-error"]').attributes('role')).toBe('alert')
      expect(wrapper.text()).toContain('Could not load this audio overview.')
      const failedBefore = failed.subscriptions
      const otherBefore = queries['audioOverviews:getByShareToken']!.subscriptions
      await wrapper.get('[data-testid="audio-read-retry"]').trigger('click')
      expect(failed.subscriptions).toBe(failedBefore + 1)
      expect(queries['audioOverviews:getByShareToken']!.subscriptions).toBe(otherBefore)
      failed.data.value = v2
      failed.error.value = null
      await flushPromises()
      expect(wrapper.find('[data-testid="audio-read-error"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="public-audio-title"]').text()).toBe(v2.title)
    })

    it('stops and clears its player when a check opens after playback started, then reloads', async () => {
      stubQueries(names)
      queries['audioOverviews:getByShareToken']!.data.value = publicOverview
      queries['audioOverviewV2:getPlaybackByShareToken']!.data.value = v2
      const wrapper = await mountShell()
      const audio = wrapper.findAll('audio')[0]!.element as HTMLAudioElement
      const pause = vi.spyOn(audio, 'pause').mockImplementation(() => {})
      vi.spyOn(audio, 'load').mockImplementation(() => {})
      vi.spyOn(audio, 'play').mockResolvedValue(undefined)
      await wrapper.get('[data-testid="public-audio-play-btn"]').trigger('click')
      await flushPromises()
      expect(audio.getAttribute('src')).toBe('/api/audio-overview/public/share-token/media')
      expect(wrapper.text()).toContain('Host A opens.')

      queries['audioOverviewV2:getPlaybackByShareToken']!.error.value = denied('test_open')
      await nextTick()
      expect(pause).toHaveBeenCalled()
      expect(audio.getAttribute('src')).toBeNull()
      expect(wrapper.find('[data-testid="audio-read-paused"]').exists()).toBe(true)
      expect(wrapper.findAll('audio')).toHaveLength(0)
      expect(wrapper.find('[data-testid="public-audio-shell"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Host A opens.')

      queries['audioOverviewV2:getPlaybackByShareToken']!.error.value = null
      await flushPromises()
      expect(wrapper.get('[data-testid="public-audio-title"]').text()).toBe(v2.title)
      const reloaded = wrapper.findAll('audio')[0]!.element as HTMLAudioElement
      expect(reloaded).not.toBe(audio)
      vi.spyOn(reloaded, 'play').mockResolvedValue(undefined)
      await wrapper.get('[data-testid="public-audio-play-btn"]').trigger('click')
      await flushPromises()
      expect(reloaded.getAttribute('src')).toBe('/api/audio-overview/public/share-token/media')
    })

    it('treats an unavailable denial as retryable', async () => {
      stubQueries(names)
      queries['audioOverviews:getByShareToken']!.error.value = denied('unavailable')
      const wrapper = await mountShell()
      expect(wrapper.find('[data-testid="audio-read-retry"]').exists()).toBe(true)
    })
  })

  describe('AudioOverviewPlayer', () => {
    const names = ['audioOverviews:getWithTurns', 'audioOverviews:getTurnUrls', 'audioOverviewV2:getPlaybackForOwner']
    async function mountPlayer() {
      const Component = (await import('~/components/audio-overview/AudioOverviewPlayer.vue')).default
      const wrapper = mount(Component, { props: { overviewId: 'overview-1' as never, folderId: 'folder-1' as never } })
      await flushPromises()
      return wrapper
    }

    it('pauses without retry while a check is open', async () => {
      stubQueries(names)
      queries['audioOverviews:getWithTurns']!.error.value = denied('test_open')
      const wrapper = await mountPlayer()
      expect(wrapper.get('[data-testid="audio-read-paused"]').text()).toBe('This is paused while you have a check open. Finish the check, then come back.')
      expect(wrapper.find('[data-testid="audio-read-retry"]').exists()).toBe(false)
    })

    it('pauses and clears the shared player and disables its controls when a check opens mid-play', async () => {
      stubQueries(names)
      const audio = fakeAudio()
      store.attachAudio(audio, null)
      queries['audioOverviews:getWithTurns']!.data.value = ownerOverview
      queries['audioOverviewV2:getPlaybackForOwner']!.data.value = v2
      const wrapper = await mountPlayer()
      expect(store.overviewId.value).toBe('overview-1')
      expect(store.continuousMediaUrl.value).toBe('/api/audio-overview/media/artifact-1')
      expect(store.turns.value).toHaveLength(1)
      store.isPlaying.value = true

      queries['audioOverviewV2:getPlaybackForOwner']!.error.value = denied('test_open')
      await nextTick()
      expect(audio.pause).toHaveBeenCalled()
      expect(audio.getAttribute('src')).toBeNull()
      expect(store.isPlaying.value).toBe(false)
      expect(store.overviewId.value).toBeNull()
      expect(store.continuousMediaUrl.value).toBeNull()
      expect(store.turns.value).toEqual([])
      expect(store.turnUrls.value).toEqual([])
      expect(wrapper.get('[data-testid="audio-read-paused"]').text()).toBe('This is paused while you have a check open. Finish the check, then come back.')
      expect(wrapper.text()).not.toContain('Host A opens.')
      for (const id of ['audio-overview-play-btn', 'audio-overview-skip-back', 'audio-overview-skip-forward', 'audio-overview-scrubber', 'audio-overview-speed-btn', 'audio-overview-download-btn', 'audio-overview-share-btn', 'audio-overview-ask-btn']) {
        expect(wrapper.get(`[data-testid="${id}"]`).attributes('disabled'), id).toBeDefined()
      }

      queries['audioOverviewV2:getPlaybackForOwner']!.error.value = null
      await flushPromises()
      expect(store.overviewId.value).toBe('overview-1')
      expect(store.continuousMediaUrl.value).toBe('/api/audio-overview/media/artifact-1')
      expect(wrapper.get('[data-testid="audio-overview-play-btn"]').attributes('disabled')).toBeUndefined()
    })

    it('leaves another overview in the shared player alone', async () => {
      stubQueries(names)
      store.attachAudio(fakeAudio(), null)
      store.loadOverview({ overviewId: 'overview-2' as never, folderId: null, title: 'Other', turns: [{ speaker: 'host_a', text: 'Other turn', durationMs: 1_000 } as never], turnUrls: ['https://audio.test/other.mp3'] })
      queries['audioOverviews:getWithTurns']!.error.value = denied('test_open')
      await mountPlayer()
      expect(store.overviewId.value).toBe('overview-2')
      expect(store.turns.value).toHaveLength(1)
    })

    it('retries every failed read and clears the error', async () => {
      stubQueries(names)
      const failed = ['audioOverviews:getTurnUrls', 'audioOverviewV2:getPlaybackForOwner'].map(name => queries[name]!)
      for (const query of failed) query.error.value = new Error('network')
      const wrapper = await mountPlayer()
      const before = failed.map(query => query.subscriptions)
      const overviewBefore = queries['audioOverviews:getWithTurns']!.subscriptions
      await wrapper.get('[data-testid="audio-read-retry"]').trigger('click')
      expect(failed.map(query => query.subscriptions)).toEqual(before.map(count => count + 1))
      expect(queries['audioOverviews:getWithTurns']!.subscriptions).toBe(overviewBefore)
      for (const query of failed) query.error.value = null
      await flushPromises()
      expect(wrapper.find('[data-testid="audio-read-error"]').exists()).toBe(false)
    })
  })
})
