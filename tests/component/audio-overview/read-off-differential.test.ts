import { flushPromises, mount } from '@vue/test-utils'
import { getFunctionName } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import { createAudioOverviewPlayback } from '~/composables/useAudioOverviewStore'

const v2 = {
  schemaVersion: 2 as const,
  title: 'Loaded overview',
  totalDurationMs: 4_000,
  voiceProfile: { hostA: 'Kore', hostB: 'Puck' },
  hostNames: { hostA: 'Host A', hostB: 'Host B' },
  publishedAt: 1,
  sourceManifest: { sources: [{ sourceId: 'source-1', displayReference: 'Chapter One' }] },
  scenes: [{ sceneId: 'scene-1', order: 0, durationMs: 4_000 }],
  utterances: [{ utteranceId: 'u1', sceneId: 'scene-1', order: 0, speaker: 'host_a' as const, text: 'Host A opens.' }],
  finalArtifact: { artifactId: 'artifact-1' },
}
const ownerOverview = { _id: 'overview-1', title: 'Owner overview', turns: [], hostNames: { hostA: 'Host A', hostB: 'Host B' }, sourceDocumentIds: [] }
const publicOverview = { title: 'Shared overview', turns: [], voiceProfile: v2.voiceProfile, hostNames: v2.hostNames, totalDurationMs: 4_000, sourceDocumentIds: [], sourceFilenames: [], publishedAt: 1 }
const ssrError = () => new Error('SSR query failed')
const deniedShape = () => Object.assign(new Error('denied'), { data: { admission: { status: 'denied', reasonCode: 'test_open' } } })

type Query = { data: Ref<unknown>, error: Ref<Error | null> }
let queries: Record<string, Query>

function stubNuxtConvexQueries(names: string[], error: () => Error) {
  queries = Object.fromEntries(names.map(name => [name, { data: ref(null), error: ref(error()) }]))
  vi.stubGlobal('useConvexQuery', (reference: unknown) => queries[getFunctionName(reference as never)] ?? { data: ref(null), error: ref(null) })
}

describe('audio reads while responses are off match dev', () => {
  let store: ReturnType<typeof createAudioOverviewPlayback>
  beforeEach(() => {
    store = createAudioOverviewPlayback()
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('useDocuments', () => ({ documents: ref([]) }))
    vi.stubGlobal('useAudioOverviewDownload', () => ({ downloadOverview: vi.fn() }))
    vi.stubGlobal('useAudioOverviewStore', () => store)
  })

  afterEach(() => vi.unstubAllGlobals())

  describe('AudioOverviewPlayer', () => {
    const names = ['audioOverviews:getWithTurns', 'audioOverviews:getTurnUrls', 'audioOverviewV2:getPlaybackForOwner']
    async function mountPlayer() {
      const Component = (await import('~/components/audio-overview/AudioOverviewPlayer.vue')).default
      const wrapper = mount(Component, { props: { overviewId: 'overview-1' as never, folderId: 'folder-1' as never } })
      await flushPromises()
      return wrapper
    }

    for (const [label, error] of [['an SSR query error', ssrError], ['a denial-shaped error', deniedShape]] as const) {
      it(`loads the overview the live subscription delivers after ${label}`, async () => {
        stubNuxtConvexQueries(names, error)
        const release = vi.spyOn(store, 'release')
        const dismiss = vi.spyOn(store, 'dismiss')
        const wrapper = await mountPlayer()
        expect(store.overviewId.value).toBeNull()

        queries['audioOverviews:getWithTurns']!.data.value = ownerOverview
        queries['audioOverviewV2:getPlaybackForOwner']!.data.value = v2
        await flushPromises()

        expect(queries['audioOverviews:getWithTurns']!.error.value).not.toBeNull()
        expect(store.overviewId.value).toBe('overview-1')
        expect(store.continuousMediaUrl.value).toBe('/api/audio-overview/media/artifact-1')
        expect(store.turns.value).toHaveLength(1)
        expect(wrapper.text()).toContain('Host A opens.')
        expect(wrapper.find('[data-testid="audio-read-error"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="audio-read-paused"]').exists()).toBe(false)
        for (const id of ['audio-overview-play-btn', 'audio-overview-skip-back', 'audio-overview-skip-forward', 'audio-overview-scrubber', 'audio-overview-speed-btn', 'audio-overview-share-btn']) {
          expect(wrapper.get(`[data-testid="${id}"]`).attributes('disabled'), id).toBeUndefined()
        }
        expect(release).not.toHaveBeenCalled()
        expect(dismiss).not.toHaveBeenCalled()
      })
    }
  })

  describe('PublicAudioShell', () => {
    const names = ['audioOverviews:getByShareToken', 'audioOverviews:getTurnUrlsByShareToken', 'audioOverviewV2:getPlaybackByShareToken']

    it('shows the shared overview the live subscription delivers after an SSR query error', async () => {
      stubNuxtConvexQueries(names, ssrError)
      const Component = (await import('~/components/audio-overview/PublicAudioShell.vue')).default
      const wrapper = mount(Component, { props: { token: 'share-token' } })
      await flushPromises()

      queries['audioOverviews:getByShareToken']!.data.value = publicOverview
      queries['audioOverviewV2:getPlaybackByShareToken']!.data.value = v2
      await flushPromises()

      expect(wrapper.get('[data-testid="public-audio-title"]').text()).toBe(v2.title)
      expect(wrapper.text()).toContain('Host A opens.')
      expect(wrapper.find('audio').exists()).toBe(true)
      expect(wrapper.get('[data-testid="public-audio-play-btn"]').attributes('disabled')).toBeUndefined()
      expect(wrapper.find('[data-testid="audio-read-error"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="audio-read-paused"]').exists()).toBe(false)
    })
  })
})
