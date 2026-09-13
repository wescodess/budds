import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { getFunctionName } from 'convex/server'
import AudioOverviewShell from '~/components/audio-overview/AudioOverviewShell.vue'

const mockCommandFetch = vi.fn()
const mockLegacyReservation = vi.fn()
const tasks = ref<any[]>([])
const documents = ref<any[]>([{ _id: 'document_1', status: 'success' }])

vi.mock('@vueuse/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@vueuse/core')>(),
  useMediaQuery: () => ref(false),
}))

const AudioOverviewCardStub = defineComponent({
  emits: ['generate'],
  template: '<button data-testid="open-audio-customize" @click="$emit(\'generate\')">Generate</button>',
})

const AudioOverviewCustomizeStub = defineComponent({
  props: { open: Boolean },
  emits: ['submit', 'update:open'],
  template: `
    <button
      v-if="open"
      data-testid="submit-audio-customize"
      @click="$emit('submit', {
        lengthMinutes: 5,
        complexity: 'expert',
        hostNames: { hostA: 'Maya', hostB: 'Leo' },
      })"
    >
      Submit
    </button>
  `,
})

const AudioOverviewGeneratingStub = defineComponent({
  props: {
    taskId: String,
    progress: String,
    status: String,
    error: String,
  },
  emits: ['cancel', 'retry'],
  template: '<div data-testid="audio-overview-generating" :data-status="status">{{ error || progress }}</div>',
})

describe('AudioOverviewShell durable generation command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tasks.value = []
    documents.value = [{ _id: 'document_1', status: 'success' }]
    localStorage.clear()
    mockCommandFetch.mockResolvedValue({
      accepted: true,
      taskId: 'task_accepted',
      quota: { used: 1, cap: 10, date: '2026-09-02' },
    })
    vi.stubGlobal('$fetch', mockCommandFetch)
    vi.stubGlobal('useTasks', () => ({ tasks, cancel: vi.fn() }))
    vi.stubGlobal('useDocuments', () => ({ documents }))
    vi.stubGlobal('useConvexQuery', (apiRef: unknown) => {
      const name = getFunctionName(apiRef as any) ?? ''
      if (name.includes('getDailyQuota')) return { data: ref({ used: 0, cap: 10, date: '2026-09-02' }) }
      if (name.includes('resolveScope')) return { data: ref({ documentIds: [] }) }
      if (name.includes('listByRoom')) return { data: ref([]) }
      return { data: ref(null) }
    })
    vi.stubGlobal('useConvexMutation', (apiRef: unknown) => {
      const name = getFunctionName(apiRef as any) ?? ''
      if (name.includes('requestAudioOverview')) return { mutate: mockLegacyReservation, isLoading: ref(false) }
      return { mutate: vi.fn(), isLoading: ref(false) }
    })
    vi.stubGlobal('useAudioOverviewStore', () => ({
      shellVisible: ref(false),
      activeTurn: ref(null),
      currentTurnIndex: ref(0),
      currentTimeMs: ref(0),
    }))
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '12345678-1234-4123-8123-123456789abc',
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it('[P0] submits one idempotent accepted command without using the legacy task reservation flow', async () => {
    const wrapper = mount(AudioOverviewShell, {
      props: { folderId: 'folder_1' as any, roomId: 'audio_room_1' as any },
      global: {
        stubs: {
          AudioOverviewCard: AudioOverviewCardStub,
          AudioOverviewCustomize: AudioOverviewCustomizeStub,
          AudioOverviewGenerating: AudioOverviewGeneratingStub,
          AudioOverviewPlayer: true,
          AudioOverviewShareDialog: true,
          Sheet: true,
          SheetContent: true,
          SheetHeader: true,
          SheetTitle: true,
        },
      },
    })

    await wrapper.get('[data-testid="open-audio-customize"]').trigger('click')
    await wrapper.get('[data-testid="submit-audio-customize"]').trigger('click')

    await vi.waitFor(() => expect(mockCommandFetch).toHaveBeenCalledOnce())
    expect(mockCommandFetch).toHaveBeenCalledWith('/api/audio-overview/generate', {
      method: 'POST',
      body: {
        folderId: 'folder_1',
        roomId: 'audio_room_1',
        scope: { mode: 'folder' },
        preferences: { lengthMinutes: 5, complexity: 'expert' },
        hostNames: { hostA: 'Maya', hostB: 'Leo' },
        idempotencyKey: '12345678-1234-4123-8123-123456789abc',
      },
    })
    expect(mockCommandFetch.mock.calls[0]?.[1]?.body).not.toHaveProperty('taskId')
    expect(mockLegacyReservation).not.toHaveBeenCalled()
    expect(wrapper.emitted('generation-started')).toHaveLength(1)
    expect(wrapper.get('[data-testid="audio-overview-generating"]').text()).toContain('Preparing')
  })

  it('[P0] surfaces an accepted job that fails before progress can render', async () => {
    const wrapper = mount(AudioOverviewShell, {
      props: { folderId: 'folder_1' as any, roomId: 'audio_room_1' as any },
      global: {
        stubs: {
          AudioOverviewCard: AudioOverviewCardStub,
          AudioOverviewCustomize: AudioOverviewCustomizeStub,
          AudioOverviewGenerating: AudioOverviewGeneratingStub,
          AudioOverviewPlayer: true,
          AudioOverviewShareDialog: true,
          Sheet: true,
          SheetContent: true,
          SheetHeader: true,
          SheetTitle: true,
        },
      },
    })

    await wrapper.get('[data-testid="open-audio-customize"]').trigger('click')
    await wrapper.get('[data-testid="submit-audio-customize"]').trigger('click')
    await vi.waitFor(() => expect(mockCommandFetch).toHaveBeenCalledOnce())

    tasks.value = [{
      _id: 'task_accepted',
      _creationTime: Date.now(),
      type: 'audio-overview-generation',
      status: 'failed',
      progress: 'Retrieving sources…',
      error: 'Not enough indexed content for an audio overview',
      audioOverviewRequest: { roomId: 'audio_room_1' },
    }]

    await vi.waitFor(() => {
      const state = wrapper.get('[data-testid="audio-overview-generating"]')
      expect(state.attributes('data-status')).toBe('failed')
      expect(state.text()).toContain('Not enough indexed content')
    })
  })

  it('[P1] reuses the command identity after an ambiguous launch failure', async () => {
    mockCommandFetch
      .mockRejectedValueOnce(Object.assign(new Error('Workflow unavailable'), { statusCode: 503 }))
      .mockResolvedValueOnce({
        accepted: true,
        taskId: 'task_accepted',
        quota: { used: 1, cap: 10, date: '2026-09-02' },
      })
    const wrapper = mount(AudioOverviewShell, {
      props: { folderId: 'folder_1' as any, roomId: 'audio_room_1' as any },
      global: {
        stubs: {
          AudioOverviewCard: AudioOverviewCardStub,
          AudioOverviewCustomize: AudioOverviewCustomizeStub,
          AudioOverviewGenerating: AudioOverviewGeneratingStub,
          AudioOverviewPlayer: true,
          AudioOverviewShareDialog: true,
          Sheet: true,
          SheetContent: true,
          SheetHeader: true,
          SheetTitle: true,
        },
      },
    })

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await wrapper.get('[data-testid="open-audio-customize"]').trigger('click')
      await wrapper.get('[data-testid="submit-audio-customize"]').trigger('click')
      await vi.waitFor(() => expect(mockCommandFetch).toHaveBeenCalledTimes(attempt + 1))
      await vi.waitFor(() => expect((wrapper.vm as any).submitting).toBe(false))
      if (attempt === 0) {
        expect(localStorage.getItem('audio-overview-pending-command:audio_room_1'))
          .toBe('12345678-1234-4123-8123-123456789abc')
      }
    }

    const keys = mockCommandFetch.mock.calls.map(call => call[1]?.body.idempotencyKey)
    expect(keys).toEqual([
      '12345678-1234-4123-8123-123456789abc',
      '12345678-1234-4123-8123-123456789abc',
    ])
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce()
    expect(wrapper.emitted('generation-started')).toHaveLength(1)
    expect(localStorage.getItem('audio-overview-pending-command:audio_room_1')).toBeNull()
  })
})
