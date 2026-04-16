import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

const mockHasIndexedDocuments = ref(false)
const mockRooms = ref<any[]>([])
const mockGenerating = ref(false)
const mockLastError = ref<string | null>(null)
const mockCreateRoom = vi.fn()
const mockDeleteRoom = vi.fn()
const mockRenameRoom = vi.fn()
const mockGenerate = vi.fn()
const mockMutate = vi.fn()

mockNuxtImport('useFlashcardRooms', () => {
  return () => ({
    rooms: mockRooms,
    hasIndexedDocuments: mockHasIndexedDocuments,
    generating: mockGenerating,
    lastError: mockLastError,
    createRoom: mockCreateRoom,
    deleteRoom: mockDeleteRoom,
    renameRoom: mockRenameRoom,
    generate: mockGenerate,
  })
})

mockNuxtImport('useConvexMutation', () => {
  return (_apiRef: unknown) => ({ mutate: mockMutate, isLoading: ref(false) })
})

const tabPath = ['~', 'components', 'flashcards', 'Tab.vue'].join('/')

describe('FlashcardsTab — rooms-first landing', () => {
  beforeEach(() => {
    mockHasIndexedDocuments.value = false
    mockRooms.value = []
    mockGenerating.value = false
    mockLastError.value = null
    mockCreateRoom.mockReset()
    mockDeleteRoom.mockReset()
    mockRenameRoom.mockReset()
    mockGenerate.mockReset()
    mockMutate.mockReset()
  })

  it('[P0] empty-no-docs state when no rooms and no indexed docs', async () => {
    const FlashcardsTab = await import(tabPath)
    const wrapper = await mountSuspended(FlashcardsTab.default, {
      props: { folderId: 'folder_abc' },
    })
    expect(wrapper.find('[data-testid="flashcards-empty-no-docs"]').exists()).toBe(true)
  })

  it('[P0] empty-ready state with Create room button when docs exist but no rooms', async () => {
    mockHasIndexedDocuments.value = true
    const FlashcardsTab = await import(tabPath)
    const wrapper = await mountSuspended(FlashcardsTab.default, {
      props: { folderId: 'folder_abc' },
    })
    expect(wrapper.find('[data-testid="flashcards-empty-ready"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flashcards-create-room-button"]').exists()).toBe(true)
  })

  it('[P0] renders one card per room', async () => {
    mockHasIndexedDocuments.value = true
    mockRooms.value = [
      { _id: 'room_1', _creationTime: Date.now(), title: 'Biology', cardCount: 12, updatedAt: Date.now() },
      { _id: 'room_2', _creationTime: Date.now(), title: 'Chemistry', cardCount: 5, updatedAt: Date.now() },
    ]

    const FlashcardsTab = await import(tabPath)
    const wrapper = await mountSuspended(FlashcardsTab.default, {
      props: { folderId: 'folder_abc' },
    })

    const cards = wrapper.findAll('[data-testid="flashcards-room-card"]')
    expect(cards).toHaveLength(2)
    expect(wrapper.text()).toContain('Biology')
    expect(wrapper.text()).toContain('Chemistry')
    expect(wrapper.text()).toContain('12 cards')
  })

  it('[P0] clicking New room invokes createRoom mutation', async () => {
    mockHasIndexedDocuments.value = true
    mockMutate.mockResolvedValue({ roomId: 'room_new' })

    const FlashcardsTab = await import(tabPath)
    const wrapper = await mountSuspended(FlashcardsTab.default, {
      props: { folderId: 'folder_abc' },
    })

    await wrapper.find('[data-testid="flashcards-create-room-button"]').trigger('click')
    await flushPromises()

    expect(mockMutate).toHaveBeenCalled()
  })
})
