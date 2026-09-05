import { flushPromises, mount } from '@vue/test-utils'
import { getFunctionName } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { createAudioOverviewPlayback } from '~/composables/useAudioOverviewStore'

vi.mock('@vueuse/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@vueuse/core')>(),
  useMediaQuery: () => ref(false),
}))

const summaries = [
  {
    _id: 'overview-v1',
    _creationTime: 1,
    title: 'Legacy segmented overview',
    status: 'ready',
    turnCount: 1,
    totalDurationMs: 1_000,
  },
  {
    _id: 'overview-v2',
    _creationTime: 2,
    title: 'Continuous v2 overview',
    status: 'ready',
    turnCount: 1,
    totalDurationMs: 1_000,
  },
]

const legacyOverview = {
  ...summaries[0],
  userId: 'owner-1',
  folderId: 'folder-1',
  voiceProfile: { hostA: 'asteria', hostB: 'orion' },
  sourceDocumentIds: [],
  turns: [{
    speaker: 'host_a' as const,
    text: 'A historical v1 recording.',
    audioFileId: 'audio-1',
    durationMs: 1_000,
  }],
}

const v2Playback = {
  schemaVersion: 2 as const,
  title: summaries[1]!.title,
  totalDurationMs: 1_000,
  sourceManifest: { sources: [{ sourceId: 'source-1', displayReference: 'Source One' }] },
  scenes: [{ sceneId: 'scene-1', order: 0, durationMs: 1_000 }],
  utterances: [{
    utteranceId: 'utterance-1',
    sceneId: 'scene-1',
    order: 0,
    speaker: 'host_a' as const,
    text: 'A continuous v2 recording.',
  }],
  finalArtifact: { artifactId: 'artifact-1' },
}

const ButtonStub = defineComponent({
  emits: ['click'],
  template: '<button type="button" @click="$emit(\'click\', $event)"><slot /></button>',
})
const Passthrough = defineComponent({ template: '<div><slot /></div>' })

describe('mounted Audio Overview owner actions', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('useDocuments', () => ({ documents: ref([]) }))
    vi.stubGlobal('useAudioOverviewDownload', () => ({ downloadOverview: vi.fn() }))
  })

  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['v1', 'overview-v1', null],
    ['v2', 'overview-v2', v2Playback],
  ])('emits share and confirmed delete callbacks for an owner %s overview', async (_version, overviewId, v2) => {
    vi.stubGlobal('useConvexQuery', (reference: unknown) => {
      const name = getFunctionName(reference as never)
      if (name === 'audioOverviews:getWithTurns') {
        return { data: ref({ ...legacyOverview, _id: overviewId, title: v2?.title ?? legacyOverview.title }) }
      }
      if (name === 'audioOverviews:getTurnUrls') return { data: ref(['/legacy/turn.mp3']) }
      if (name === 'audioOverviewV2:getPlaybackForOwner') return { data: ref(v2) }
      return { data: ref(null) }
    })
    vi.stubGlobal('useAudioOverviewStore', () => createAudioOverviewPlayback())

    const Component = (await import('~/components/audio-overview/AudioOverviewPlayer.vue')).default
    const wrapper = mount(Component, {
      props: {
        overviewId: overviewId as never,
        folderId: 'folder-1' as never,
        overviews: summaries as never,
      },
    })
    await nextTick()

    await wrapper.get('[data-testid="audio-overview-share-btn"]').trigger('click')
    expect(wrapper.emitted('request-share')).toHaveLength(1)

    await wrapper.get('[data-testid="audio-overview-history-btn"]').trigger('click')
    await wrapper.get(`[data-testid="audio-overview-history-delete-${overviewId}"]`).trigger('click')
    await wrapper.get('[data-testid="audio-overview-delete-confirm"]').trigger('click')
    expect(wrapper.emitted('delete-overview')).toEqual([[overviewId]])
  })

  it.each([
    ['v1', 'overview-v1'],
    ['v2', 'overview-v2'],
  ])('publishes, reacts to the share projection, and unpublishes an owner %s overview', async (_version, overviewId) => {
    const publish = vi.fn().mockResolvedValue({ token: 'a'.repeat(32), publishedAt: 1 })
    const unpublish = vi.fn().mockResolvedValue(null)
    vi.stubGlobal('useConvexMutation', (reference: unknown) => {
      const name = getFunctionName(reference as never)
      if (name === 'audioOverviews:publishOverview') return { mutate: publish }
      if (name === 'audioOverviews:unpublishOverview') return { mutate: unpublish }
      return { mutate: vi.fn() }
    })

    const Component = (await import('~/components/audio-overview/AudioOverviewShareDialog.vue')).default
    const wrapper = mount(Component, {
      props: { open: true, overviewId: overviewId as never, shareToken: null, publishedAt: null },
      global: {
        stubs: {
          UiDialog: Passthrough,
          UiDialogContent: Passthrough,
          UiDialogHeader: Passthrough,
          UiDialogTitle: Passthrough,
          UiDialogDescription: Passthrough,
          UiDialogFooter: Passthrough,
          UiDialogClose: Passthrough,
          UiButton: ButtonStub,
        },
      },
    })

    await wrapper.get('[data-testid="audio-overview-share-publish-btn"]').trigger('click')
    await flushPromises()
    expect(publish).toHaveBeenCalledWith({ id: overviewId })

    await wrapper.setProps({ shareToken: 'a'.repeat(32), publishedAt: 1 })
    await nextTick()
    expect(wrapper.get('[data-testid="audio-overview-share-url"]').text())
      .toContain(`/audio/${'a'.repeat(32)}`)

    await wrapper.get('[data-testid="audio-overview-share-unshare-btn"]').trigger('click')
    await flushPromises()
    expect(unpublish).toHaveBeenCalledWith({ id: overviewId })
  })

  it.each([
    ['v1', summaries[0]],
    ['v2', summaries[1]],
  ])('routes owner %s deletion through the mutation and reacts without refresh', async (_version, summary) => {
    const liveOverviews = ref([summary])
    const remove = vi.fn().mockResolvedValue({ scheduled: true })
    vi.stubGlobal('useTasks', () => ({ tasks: ref([]), cancel: vi.fn() }))
    vi.stubGlobal('useDocuments', () => ({ documents: ref([{ _id: 'document-1', status: 'success' }]) }))
    vi.stubGlobal('useConvexQuery', (reference: unknown) => {
      const name = getFunctionName(reference as never)
      if (name === 'audioOverviews:listByFolder') return { data: liveOverviews }
      if (name === 'users:getDailyQuota') return { data: ref({ used: 0, cap: 10, date: '2026-09-03' }) }
      if (name === 'folders:resolveScope') return { data: ref({ documentIds: [] }) }
      return { data: ref(null) }
    })
    vi.stubGlobal('useConvexMutation', (reference: unknown) => {
      const name = getFunctionName(reference as never)
      if (name === 'audioOverviews:deleteOverview') return { mutate: remove }
      return { mutate: vi.fn() }
    })
    vi.stubGlobal('useAudioOverviewStore', () => ({
      shellVisible: ref(false),
      activeTurn: ref(null),
      currentTurnIndex: ref(0),
      currentTimeMs: ref(0),
    }))

    const PlayerStub = defineComponent({
      props: ['overviewId'],
      emits: ['request-share', 'delete-overview'],
      template: `
        <div data-testid="owner-player">
          <button data-testid="shell-share" @click="$emit('request-share')">Share</button>
          <button data-testid="shell-delete" @click="$emit('delete-overview', overviewId)">Delete</button>
        </div>
      `,
    })
    const ShareStub = defineComponent({
      props: ['open', 'overviewId'],
      template: '<div v-if="open" data-testid="shell-share-dialog">{{ overviewId }}</div>',
    })
    const CardStub = defineComponent({ template: '<div data-testid="owner-empty-card">Empty</div>' })
    const Component = (await import('~/components/audio-overview/AudioOverviewShell.vue')).default
    const wrapper = mount(Component, {
      props: { folderId: 'folder-1' as never },
      global: {
        stubs: {
          AudioOverviewPlayer: PlayerStub,
          AudioOverviewShareDialog: ShareStub,
          AudioOverviewCard: CardStub,
          AudioOverviewCustomize: true,
          AudioOverviewGenerating: true,
          Sheet: true,
          SheetContent: true,
          SheetHeader: true,
          SheetTitle: true,
        },
      },
    })
    await nextTick()

    await wrapper.get('[data-testid="shell-share"]').trigger('click')
    expect(wrapper.get('[data-testid="shell-share-dialog"]').text()).toBe(summary._id)

    await wrapper.get('[data-testid="shell-delete"]').trigger('click')
    await flushPromises()
    expect(remove).toHaveBeenCalledWith({ id: summary._id })

    liveOverviews.value = []
    await nextTick()
    expect(wrapper.find('[data-testid="owner-player"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="owner-empty-card"]').exists()).toBe(true)
  })
})
