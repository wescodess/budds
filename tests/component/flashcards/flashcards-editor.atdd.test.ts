/**
 * Story 7.3 ATDD (red-first) — Editor.vue surface for flash-card edit/delete.
 *
 * Drives Task 4 (Editor.vue). Targeted ACs:
 *   #3 — Edit branch in Tab renders Editor
 *   #4 — Editor lists one row per card, shows front/back/citation/chunk + Edit/Delete
 *   #5 — Edit opens textareas (front + back), Save + Cancel appear
 *   #6 — Save calls updateCard with trimmed payload; empty blocks Save
 *   #7 — Delete row → inline Confirm / Cancel swap; Confirm calls deleteCard
 *
 * Reka-portal discipline: no portaled primitives in Editor subtree. mountSuspended
 * covers every assertion — the inline swap-in-place pattern matches 6-3 quiz/Editor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

const mockSetData = ref<any>(undefined)
const mockMutate = vi.fn()

// Track per-mutation calls by the payload's arg shape.
const mockUpdateCard = {
  get mock() {
    return {
      calls: mockMutate.mock.calls.filter(
        ([arg]: any[]) => arg && 'front' in arg && 'back' in arg,
      ),
    }
  },
}
const mockDeleteCard = {
  get mock() {
    return {
      calls: mockMutate.mock.calls.filter(
        ([arg]: any[]) => arg && 'cardId' in arg && !('front' in arg),
      ),
    }
  },
}

mockNuxtImport('useConvexQuery', () => {
  return (_api: unknown, _args: unknown) => ({ data: mockSetData })
})

mockNuxtImport('useConvexMutation', () => {
  return (_apiRef: unknown) => ({
    mutate: mockMutate,
    isLoading: ref(false),
  })
})

const editorPath = ['~', 'components', 'flashcards', 'Editor.vue'].join('/')

function sampleSet() {
  return {
    set: {
      _id: 'set_1',
      _creationTime: Date.now(),
      userId: 'user_test',
      folderId: 'folder_abc',
      title: 'Cell Biology',
      status: 'ready',
      cardCount: 2,
    },
    cards: [
      {
        _id: 'card_1',
        _creationTime: Date.now(),
        setId: 'set_1',
        userId: 'user_test',
        order: 0,
        front: 'What is ATP?',
        back: 'The energy currency of the cell.',
        sourceChunkContent: 'ATP stores chemical energy.',
        sourceFilename: 'bio.pdf',
      },
      {
        _id: 'card_2',
        _creationTime: Date.now(),
        setId: 'set_1',
        userId: 'user_test',
        order: 1,
        front: 'Define photosynthesis',
        back: 'Converting light energy into chemical energy.',
        sourceChunkContent: 'Photosynthesis occurs in chloroplasts.',
        sourceFilename: 'bio.pdf',
      },
    ],
  }
}

describe('FlashcardsEditor — Story 7.3 ATDD (red-first)', () => {
  beforeEach(() => {
    mockSetData.value = undefined
    mockMutate.mockReset()
  })

  it('[P0] renders one row per card with read-only front/back/citation', async () => {
    const Editor = await import(editorPath)
    mockSetData.value = sampleSet()

    const wrapper = await mountSuspended(Editor.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="flashcards-editor-card-row"]')
    expect(rows).toHaveLength(2)
    expect(wrapper.text()).toContain('What is ATP?')
    expect(wrapper.text()).toContain('Define photosynthesis')
    expect(wrapper.find('[data-testid="flashcards-editor-card-front"]').exists()).toBe(false)
  })

  it('[P0] Edit on a row opens front + back textareas with Save/Cancel', async () => {
    const Editor = await import(editorPath)
    mockSetData.value = sampleSet()

    const wrapper = await mountSuspended(Editor.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    const editBtns = wrapper.findAll('[data-testid="flashcards-editor-card-edit"]')
    await editBtns[0]!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="flashcards-editor-card-front"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flashcards-editor-card-back"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flashcards-editor-card-save"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flashcards-editor-card-cancel"]').exists()).toBe(true)
  })

  it('[P0] Save with valid edits calls updateCard with trimmed payload', async () => {
    const Editor = await import(editorPath)
    mockSetData.value = sampleSet()
    mockMutate.mockResolvedValue(undefined)

    const wrapper = await mountSuspended(Editor.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    await wrapper.findAll('[data-testid="flashcards-editor-card-edit"]')[0]!.trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="flashcards-editor-card-save"]').trigger('click')
    await flushPromises()

    expect(mockUpdateCard.mock.calls).toHaveLength(1)
    const payload = mockUpdateCard.mock.calls[0]![0]
    expect(payload.cardId).toBe('card_1')
    expect(payload.front).toBe('What is ATP?')
    expect(payload.back).toBe('The energy currency of the cell.')
  })

  it('[P0] Save with empty front blocks mutation and surfaces an error', async () => {
    const Editor = await import(editorPath)
    mockSetData.value = sampleSet()

    const wrapper = await mountSuspended(Editor.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    await wrapper.findAll('[data-testid="flashcards-editor-card-edit"]')[0]!.trigger('click')
    await flushPromises()

    const frontInput = wrapper.find<HTMLTextAreaElement>('[data-testid="flashcards-editor-card-front"]')
    await frontInput.setValue('   ')
    await flushPromises()

    await wrapper.find('[data-testid="flashcards-editor-card-save"]').trigger('click')
    await flushPromises()

    expect(mockUpdateCard.mock.calls).toHaveLength(0)
    expect(wrapper.find('[data-testid="flashcards-editor-card-error"]').exists()).toBe(true)
  })

  it('[P0] Delete row → inline Confirm → mutation called with cardId', async () => {
    const Editor = await import(editorPath)
    mockSetData.value = sampleSet()
    mockMutate.mockResolvedValue(undefined)

    const wrapper = await mountSuspended(Editor.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    await wrapper.findAll('[data-testid="flashcards-editor-card-delete"]')[0]!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="flashcards-editor-card-delete-confirm"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flashcards-editor-card-delete-cancel"]').exists()).toBe(true)

    await wrapper.find('[data-testid="flashcards-editor-card-delete-confirm"]').trigger('click')
    await flushPromises()

    expect(mockDeleteCard.mock.calls).toHaveLength(1)
    expect(mockDeleteCard.mock.calls[0]![0]).toEqual({ cardId: 'card_1' })
  })

  it('[P0] Back button emits back', async () => {
    const Editor = await import(editorPath)
    mockSetData.value = sampleSet()

    const wrapper = await mountSuspended(Editor.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    await wrapper.find('[data-testid="flashcards-editor-back"]').trigger('click')
    expect(wrapper.emitted('back')).toBeTruthy()
  })

  it('[P1] does not reserve the entire editor surface as a gesture owner', async () => {
    const Editor = await import(editorPath)
    mockSetData.value = sampleSet()

    const wrapper = await mountSuspended(Editor.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="flashcards-editor"]').attributes('data-gesture-owner')).toBeUndefined()
  })
})
