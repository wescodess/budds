import { flushPromises, mount } from '@vue/test-utils'
import { getFunctionName } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import { createAudioOverviewPlayback } from '~/composables/useAudioOverviewStore'

const denied = (reasonCode: string) => Object.assign(new Error('denied'), { data: { admission: { status: 'denied', reasonCode } } })

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

type Query = { data: Ref<unknown>, error: Ref<unknown>, refresh: ReturnType<typeof vi.fn> }
let queries: Record<string, Query>

function stubQueries(names: string[]) {
  queries = Object.fromEntries(names.map(name => [name, { data: ref(null), error: ref(null), refresh: vi.fn() }]))
  vi.stubGlobal('useConvexQuery', (reference: unknown) => queries[getFunctionName(reference as never)] ?? { data: ref(null), error: ref(null), refresh: vi.fn() })
}

describe('audio teaching read failures', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('useDocuments', () => ({ documents: ref([]) }))
    vi.stubGlobal('useAudioOverviewDownload', () => ({ downloadOverview: vi.fn() }))
    vi.stubGlobal('useAudioOverviewStore', () => createAudioOverviewPlayback())
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

    it('retries the failed read and recovers', async () => {
      stubQueries(names)
      const failed = queries['audioOverviewV2:getPlaybackByShareToken']!
      failed.error.value = new Error('network')
      failed.refresh.mockImplementation(() => {
        failed.error.value = null
        failed.data.value = v2
      })
      const wrapper = await mountShell()
      expect(wrapper.get('[data-testid="audio-read-error"]').attributes('role')).toBe('alert')
      expect(wrapper.text()).toContain('Could not load this audio overview.')
      await wrapper.get('[data-testid="audio-read-retry"]').trigger('click')
      await flushPromises()
      expect(failed.refresh).toHaveBeenCalledTimes(1)
      expect(queries['audioOverviews:getByShareToken']!.refresh).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="audio-read-error"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="public-audio-title"]').text()).toBe(v2.title)
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

    it('retries every failed read and clears the error', async () => {
      stubQueries(names)
      for (const name of ['audioOverviews:getTurnUrls', 'audioOverviewV2:getPlaybackForOwner']) {
        const query = queries[name]!
        query.error.value = new Error('network')
        query.refresh.mockImplementation(() => { query.error.value = null })
      }
      const wrapper = await mountPlayer()
      await wrapper.get('[data-testid="audio-read-retry"]').trigger('click')
      await flushPromises()
      expect(queries['audioOverviews:getTurnUrls']!.refresh).toHaveBeenCalledTimes(1)
      expect(queries['audioOverviewV2:getPlaybackForOwner']!.refresh).toHaveBeenCalledTimes(1)
      expect(queries['audioOverviews:getWithTurns']!.refresh).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="audio-read-error"]').exists()).toBe(false)
    })
  })
})
