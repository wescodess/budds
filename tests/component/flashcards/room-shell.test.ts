import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { getFunctionName } from 'convex/server'

const mockRoomData = ref<any>({
  room: {
    _id: 'room_1',
    _creationTime: Date.now(),
    title: 'Cell Biology',
    userId: 'user_a',
    folderId: 'folder_abc',
    updatedAt: Date.now(),
    activeVersionId: undefined,
  },
  cards: [
    { _id: 'c1', displayOrder: 0, term: 'a', definition: '1' },
    { _id: 'c2', displayOrder: 1, term: 'b', definition: '2' },
  ],
})

const mockVersionsData = ref<any[]>([])
const mockRenameMutate = vi.fn()
const mockDeleteMutate = vi.fn()

mockNuxtImport('useConvexQuery', () => {
  return (apiRef: any, _args: unknown) => {
    const refStr = JSON.stringify(apiRef ?? '')
    if (refStr.includes('listRoomVersions')) return { data: mockVersionsData }
    return { data: mockRoomData }
  }
})

mockNuxtImport('useConvexMutation', () => {
  return (apiRef: any) => {
    const name = getFunctionName(apiRef) ?? ''
    if (name.includes('renameRoom')) return { mutate: mockRenameMutate, isLoading: ref(false) }
    if (name.includes('deleteRoom')) return { mutate: mockDeleteMutate, isLoading: ref(false) }
    return { mutate: vi.fn(), isLoading: ref(false) }
  }
})

mockNuxtImport('useFlashcardRooms', () => {
  return () => ({
    rooms: ref([]),
    hasIndexedDocuments: ref(true),
    generating: ref(false),
    lastError: ref(null),
    createRoom: vi.fn(),
    deleteRoom: vi.fn(),
    renameRoom: vi.fn(),
    generate: vi.fn(),
  })
})

const shellPath = ['~', 'components', 'flashcards', 'RoomShell.vue'].join('/')

describe('RoomShell', () => {
  beforeEach(() => {
    mockRenameMutate.mockReset()
    mockDeleteMutate.mockReset()
  })

  it('[P0] renders header with room title', async () => {
    const RoomShell = await import(shellPath)
    const wrapper = await mountSuspended(RoomShell.default, {
      props: { roomId: 'room_1', folderId: 'folder_abc' },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="flashcard-room-shell"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flashcard-room-title"]').text()).toBe('Cell Biology')
  })

  it('[P0] mode switch toggles between editor and practice', async () => {
    const RoomShell = await import(shellPath)
    const wrapper = await mountSuspended(RoomShell.default, {
      props: { roomId: 'room_1', folderId: 'folder_abc' },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="flashcard-room-editor"]').exists()).toBe(true)
    await wrapper.find('[data-testid="flashcard-room-mode-practice"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="flashcard-room-practice"]').exists()).toBe(true)
  })

  it('[P0] rename triggers renameRoom mutation with trimmed title', async () => {
    mockRenameMutate.mockResolvedValue(undefined)
    const RoomShell = await import(shellPath)
    const wrapper = await mountSuspended(RoomShell.default, {
      props: { roomId: 'room_1', folderId: 'folder_abc' },
    })
    await flushPromises()

    await wrapper.find('[data-testid="flashcard-room-rename-trigger"]').trigger('click')
    await flushPromises()
    const input = wrapper.find<HTMLInputElement>('[data-testid="flashcard-room-title-input"]')
    await input.setValue('  Renamed  ')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(mockRenameMutate).toHaveBeenCalled()
    const arg = mockRenameMutate.mock.calls[0]![0]
    expect(arg.title).toBe('Renamed')
  })
})
