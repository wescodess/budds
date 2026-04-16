import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

const mockVersions = ref<any[]>([])
const mockVersionDetail = ref<any>(null)
const mockMutate = vi.fn()

mockNuxtImport('useConvexQuery', () => {
  return (apiRef: any, _args: unknown) => {
    const refStr = JSON.stringify(apiRef ?? '')
    if (refStr.includes('getRoomVersion')) return { data: mockVersionDetail }
    return { data: mockVersions }
  }
})

mockNuxtImport('useConvexMutation', () => {
  return (_apiRef: unknown) => ({ mutate: mockMutate, isLoading: ref(false) })
})

const panelPath = ['~', 'components', 'flashcards', 'RoomHistoryPanel.vue'].join('/')

describe('RoomHistoryPanel', () => {
  beforeEach(() => {
    mockVersions.value = []
    mockVersionDetail.value = null
    mockMutate.mockReset()
    document.body.innerHTML = ''
  })

  it('[P0] renders empty state when no versions', async () => {
    const Panel = await import(panelPath)
    await mountSuspended(Panel.default, {
      props: { open: true, roomId: 'room_1' },
    })
    await flushPromises()
    expect(document.querySelector('[data-testid="flashcard-room-history-empty"]')).not.toBeNull()
  })

  it('[P0] renders one entry per version', async () => {
    mockVersions.value = [
      { _id: 'v1', _creationTime: Date.now(), title: 'Gen 1', origin: 'ai', cardCount: 10 },
      { _id: 'v2', _creationTime: Date.now() - 1000, title: 'Pre-restore snapshot', origin: 'manual', cardCount: 8 },
    ]
    const Panel = await import(panelPath)
    await mountSuspended(Panel.default, {
      props: { open: true, roomId: 'room_1' },
    })
    await flushPromises()

    const entries = document.querySelectorAll('[data-testid="flashcard-room-history-version"]')
    expect(entries.length).toBe(2)
  })

  it('[P0] expanding a version shows preview', async () => {
    mockVersions.value = [
      { _id: 'v1', _creationTime: Date.now(), title: 'Gen 1', origin: 'ai', cardCount: 2 },
    ]
    mockVersionDetail.value = {
      version: { _id: 'v1' },
      cards: [
        { _id: 'c1', displayOrder: 0, term: 'term-a', definition: 'def-a' },
        { _id: 'c2', displayOrder: 1, term: 'term-b', definition: 'def-b' },
      ],
    }
    const Panel = await import(panelPath)
    await mountSuspended(Panel.default, {
      props: { open: true, roomId: 'room_1' },
    })
    await flushPromises()

    const expand = document.querySelector<HTMLButtonElement>('[data-testid="flashcard-room-history-expand"]')
    expand!.click()
    await flushPromises()

    expect(document.querySelector('[data-testid="flashcard-room-history-preview"]')).not.toBeNull()
  })
})
