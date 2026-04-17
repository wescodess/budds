import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

const mockCreateTask = vi.fn()

mockNuxtImport('useFlashcardRooms', () => {
  return () => ({
    rooms: ref([]),
    hasIndexedDocuments: ref(true),
    createRoom: vi.fn(),
    deleteRoom: vi.fn(),
    renameRoom: vi.fn(),
  })
})

mockNuxtImport('useConvexMutation', () => {
  return () => ({
    mutate: mockCreateTask,
    isLoading: ref(false),
  })
})

mockNuxtImport('useConvexQuery', () => {
  return () => ({ data: ref(null) })
})

const dialogPath = ['~', 'components', 'flashcards', 'RoomGenerateDialog.vue'].join('/')

describe('RoomGenerateDialog', () => {
  beforeEach(() => {
    mockCreateTask.mockReset()
    mockCreateTask.mockResolvedValue({ taskId: 'task_1' })
    document.body.innerHTML = ''
  })

  it('[P0] shows archive warning when hasExistingCards is true', async () => {
    const Dialog = await import(dialogPath)
    await mountSuspended(Dialog.default, {
      props: {
        open: true,
        roomId: 'room_1',
        folderId: 'folder_abc',
        hasExistingCards: true,
      },
    })
    await flushPromises()

    const warning = document.body.querySelector('[data-testid="flashcard-room-generate-archive-warning"]')
    expect(warning).not.toBeNull()
  })

  it('[P0] hides archive warning when no existing cards', async () => {
    const Dialog = await import(dialogPath)
    await mountSuspended(Dialog.default, {
      props: {
        open: true,
        roomId: 'room_1',
        folderId: 'folder_abc',
        hasExistingCards: false,
      },
    })
    await flushPromises()

    const warning = document.body.querySelector('[data-testid="flashcard-room-generate-archive-warning"]')
    expect(warning).toBeNull()
  })

  it('[P0] submit creates a task', async () => {
    const Dialog = await import(dialogPath)
    await mountSuspended(Dialog.default, {
      props: {
        open: true,
        roomId: 'room_1',
        folderId: 'folder_abc',
        hasExistingCards: false,
      },
    })
    await flushPromises()

    const submit = document.body.querySelector<HTMLButtonElement>('[data-testid="flashcard-room-generate-submit"]')
    expect(submit).not.toBeNull()
    submit!.click()
    await flushPromises()

    expect(mockCreateTask).toHaveBeenCalled()
  })
})
