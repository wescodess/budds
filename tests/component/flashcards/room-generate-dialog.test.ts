import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

const mockGenerating = ref(false)
const mockLastError = ref<string | null>(null)
const mockGenerate = vi.fn()

mockNuxtImport('useFlashcardRooms', () => {
  return () => ({
    rooms: ref([]),
    hasIndexedDocuments: ref(true),
    generating: mockGenerating,
    lastError: mockLastError,
    createRoom: vi.fn(),
    deleteRoom: vi.fn(),
    renameRoom: vi.fn(),
    generate: mockGenerate,
  })
})

const dialogPath = ['~', 'components', 'flashcards', 'RoomGenerateDialog.vue'].join('/')

describe('RoomGenerateDialog', () => {
  beforeEach(() => {
    mockGenerating.value = false
    mockLastError.value = null
    mockGenerate.mockReset()
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

  it('[P0] submit invokes generate()', async () => {
    mockGenerate.mockResolvedValue({ versionId: 'version_1', cardCount: 12 })
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

    expect(mockGenerate).toHaveBeenCalled()
  })
})
