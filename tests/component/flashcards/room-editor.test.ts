import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

const mockMutate = vi.fn()

mockNuxtImport('useConvexMutation', () => {
  return (_apiRef: unknown) => ({ mutate: mockMutate, isLoading: ref(false) })
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
    mockMutate.mockReset()
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

    expect(mockMutate).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="flashcard-room-card-error"]').exists()).toBe(true)
  })

  it('[P0] Delete calls deleteCard mutation with cardId', async () => {
    mockMutate.mockResolvedValue(undefined)
    const RoomEditor = await import(editorPath)
    const wrapper = await mountSuspended(RoomEditor.default, {
      props: { roomId: 'room_1', cards: sampleCards() },
    })
    await wrapper.findAll('[data-testid="flashcard-room-card-delete"]')[0]!.trigger('click')
    await flushPromises()
    expect(mockMutate).toHaveBeenCalled()
    const args = mockMutate.mock.calls[0]![0]
    expect(args).toMatchObject({ cardId: 'card_1' })
  })

  it('[P0] Add first card opens new-row editor and saves with createCard', async () => {
    mockMutate.mockResolvedValue({ cardId: 'card_new' })
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

    expect(mockMutate).toHaveBeenCalled()
    const args = mockMutate.mock.calls[0]![0]
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

    // No mutation should have fired just from opening the new-row editor.
    expect(mockMutate).not.toHaveBeenCalled()
    // New row editor is visible.
    expect(wrapper.find('[data-testid="flashcard-room-new-row"]').exists()).toBe(true)
  })
})
