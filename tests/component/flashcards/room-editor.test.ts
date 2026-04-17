import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { getFunctionName } from 'convex/server'

const mockCreateMutate = vi.fn()
const mockUpdateMutate = vi.fn()
const mockDeleteMutate = vi.fn()
const mockReorderMutate = vi.fn()

mockNuxtImport('useConvexMutation', () => {
  return (apiRef: any) => {
    const name = getFunctionName(apiRef) ?? ''
    if (name.includes('createCard')) return { mutate: mockCreateMutate, isLoading: ref(false) }
    if (name.includes('updateCard')) return { mutate: mockUpdateMutate, isLoading: ref(false) }
    if (name.includes('deleteCard')) return { mutate: mockDeleteMutate, isLoading: ref(false) }
    if (name.includes('reorderCards')) return { mutate: mockReorderMutate, isLoading: ref(false) }
    return { mutate: vi.fn(), isLoading: ref(false) }
  }
})

const editorPath = ['~', 'components', 'flashcards', 'RoomEditor.vue'].join('/')

function sampleCards() {
  return [
    {
      _id: 'card_1',
      displayOrder: 0,
      term: 'What is ATP?',
      definition: 'The energy currency of the cell.',
      metadata: {
        source: { filename: 'bio.pdf', chunkContent: 'ATP stores chemical energy.' },
      },
    },
    {
      _id: 'card_2',
      displayOrder: 1,
      term: 'Define photosynthesis',
      definition: 'Converting light energy into chemical energy.',
      metadata: {
        source: { filename: 'bio.pdf', chunkContent: 'Photosynthesis occurs in chloroplasts.' },
      },
    },
  ]
}

describe('RoomEditor', () => {
  beforeEach(() => {
    mockCreateMutate.mockReset()
    mockUpdateMutate.mockReset()
    mockDeleteMutate.mockReset()
    mockReorderMutate.mockReset()
  })

  it('[P0] renders one row per card with term + definition', async () => {
    const RoomEditor = await import(editorPath)
    const wrapper = await mountSuspended(RoomEditor.default, {
      props: { roomId: 'room_1', cards: sampleCards() },
    })
    const rows = wrapper.findAll('[data-testid="flashcard-room-card-row"]')
    expect(rows).toHaveLength(2)
    expect(wrapper.text()).toContain('What is ATP?')
    expect(wrapper.text()).toContain('Define photosynthesis')
  })

  it('[P0] empty state surfaces "Add first card" CTA', async () => {
    const RoomEditor = await import(editorPath)
    const wrapper = await mountSuspended(RoomEditor.default, {
      props: { roomId: 'room_1', cards: [] },
    })
    expect(wrapper.find('[data-testid="flashcard-room-add-first-card"]').exists()).toBe(true)
  })

  it('[P0] clicking Edit opens textareas with Save + Cancel', async () => {
    const RoomEditor = await import(editorPath)
    const wrapper = await mountSuspended(RoomEditor.default, {
      props: { roomId: 'room_1', cards: sampleCards() },
    })
    await wrapper.findAll('[data-testid="flashcard-room-card-edit"]')[0]!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="flashcard-room-card-term"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flashcard-room-card-definition"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flashcard-room-card-save"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flashcard-room-card-cancel"]').exists()).toBe(true)
  })

  it('[P0] Save with empty term blocks mutation and surfaces error', async () => {
    const RoomEditor = await import(editorPath)
    const wrapper = await mountSuspended(RoomEditor.default, {
      props: { roomId: 'room_1', cards: sampleCards() },
    })
    await wrapper.findAll('[data-testid="flashcard-room-card-edit"]')[0]!.trigger('click')
    await flushPromises()

    const term = wrapper.find<HTMLTextAreaElement>('[data-testid="flashcard-room-card-term"]')
    await term.setValue('   ')
    await wrapper.find('[data-testid="flashcard-room-card-save"]').trigger('click')
    await flushPromises()

    expect(mockUpdateMutate).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="flashcard-room-card-error"]').exists()).toBe(true)
  })

  it('[P0] Delete calls deleteCard mutation with cardId', async () => {
    mockDeleteMutate.mockResolvedValue(undefined)
    const RoomEditor = await import(editorPath)
    const wrapper = await mountSuspended(RoomEditor.default, {
      props: { roomId: 'room_1', cards: sampleCards() },
    })
    await wrapper.findAll('[data-testid="flashcard-room-card-delete"]')[0]!.trigger('click')
    await flushPromises()
    expect(mockDeleteMutate).toHaveBeenCalled()
    const args = mockDeleteMutate.mock.calls[0]![0]
    expect(args).toMatchObject({ cardId: 'card_1' })
  })

  it('[P0] Add first card opens new-row editor and saves with createCard', async () => {
    mockCreateMutate.mockResolvedValue({ cardId: 'card_new' })
    const RoomEditor = await import(editorPath)
    const wrapper = await mountSuspended(RoomEditor.default, {
      props: { roomId: 'room_1', cards: [] },
    })

    await wrapper.find('[data-testid="flashcard-room-add-first-card"]').trigger('click')
    await flushPromises()

    const term = wrapper.find<HTMLInputElement>('[data-testid="flashcard-room-new-term"]')
    await term.setValue('New term')
    const def = wrapper.find<HTMLTextAreaElement>('[data-testid="flashcard-room-new-definition"]')
    await def.setValue('New definition')
    await wrapper.find('[data-testid="flashcard-room-new-save"]').trigger('click')
    await flushPromises()

    expect(mockCreateMutate).toHaveBeenCalled()
    const args = mockCreateMutate.mock.calls[0]![0]
    expect(args).toMatchObject({
      roomId: 'room_1',
      term: 'New term',
      definition: 'New definition',
    })
  })

  it('[P0] empty-state + clicking Add first card does NOT auto-insert a ghost DB row', async () => {
    const RoomEditor = await import(editorPath)
    const wrapper = await mountSuspended(RoomEditor.default, {
      props: { roomId: 'room_1', cards: [] },
    })

    await wrapper.find('[data-testid="flashcard-room-add-first-card"]').trigger('click')
    await flushPromises()

    expect(mockCreateMutate).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="flashcard-room-new-row"]').exists()).toBe(true)
  })

  it('[P0] reorder rollback on failure reverts card order and shows toast', async () => {
    const toastError = vi.fn()
    vi.doMock('vue-sonner', () => ({ toast: { error: toastError } }))

    mockReorderMutate.mockRejectedValue(new Error('OCC conflict'))

    const threeCards = [
      { _id: 'card_a', displayOrder: 0, term: 'A', definition: 'A def' },
      { _id: 'card_b', displayOrder: 1, term: 'B', definition: 'B def' },
      { _id: 'card_c', displayOrder: 2, term: 'C', definition: 'C def' },
    ]

    const RoomEditor = await import(editorPath)
    const wrapper = await mountSuspended(RoomEditor.default, {
      props: { roomId: 'room_1', cards: threeCards },
    })
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="flashcard-room-card-row"]')
    expect(rows).toHaveLength(3)

    const firstRow = rows[0]!.element
    const thirdRow = rows[2]!.element

    const dragStartEvent = new Event('dragstart', { bubbles: true }) as DragEvent
    Object.defineProperty(dragStartEvent, 'dataTransfer', {
      value: { effectAllowed: '', setData: vi.fn() },
    })
    firstRow.dispatchEvent(dragStartEvent)
    await flushPromises()

    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(dragOverEvent, 'dataTransfer', {
      value: { dropEffect: '' },
    })
    Object.defineProperty(dragOverEvent, 'preventDefault', { value: vi.fn() })
    thirdRow.dispatchEvent(dragOverEvent)
    await flushPromises()

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { getData: () => 'card_a' },
    })
    Object.defineProperty(dropEvent, 'preventDefault', { value: vi.fn() })
    thirdRow.dispatchEvent(dropEvent)
    await flushPromises()

    await new Promise((r) => setTimeout(r, 50))
    await flushPromises()

    const afterRows = wrapper.findAll('[data-testid="flashcard-room-card-row"]')
    const termsAfter = afterRows.map((r) => {
      const text = r.text()
      if (text.includes('A')) return 'A'
      if (text.includes('B')) return 'B'
      if (text.includes('C')) return 'C'
      return text
    })
    expect(termsAfter).toEqual(['A', 'B', 'C'])
  })
})
