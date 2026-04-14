/**
 * ATDD — Story 7.2 AC #2, #3, #4, #5, #7, #8, #10, #11
 *
 * Generated BEFORE Study.vue exists. These tests MUST fail at this point;
 * dev-story Task 3/4/5/6 makes them pass.
 *
 * Covers the happy path: load set → front renders → flip to back → Next →
 * advance through all cards → completion summary → Restart → back to card 0.
 * Plus source-reveal inline toggle (no portaled primitives).
 *
 * Portal constraint (Story 7.1 + Epic 6 retro standing rule):
 * Study.vue introduces NO portaled primitives. All assertions target direct DOM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

const mockSetData = ref<any>(null)

mockNuxtImport('useConvexQuery', () => {
  return (_api: unknown, _args: unknown) => ({ data: mockSetData })
})

const studyPath = ['~', 'components', 'flashcards', 'Study.vue'].join('/')

function sampleSet() {
  return {
    set: {
      _id: 'set_1',
      _creationTime: Date.now(),
      userId: 'user_test',
      folderId: 'folder_abc',
      title: 'Cell Biology Flashcards',
      status: 'ready',
      cardCount: 3,
    },
    cards: [
      {
        _id: 'card_1',
        _creationTime: Date.now(),
        setId: 'set_1',
        userId: 'user_test',
        order: 0,
        front: 'What do mitochondria produce?',
        back: 'ATP',
        sourceFilename: 'bio1.pdf',
        sourceChunkContent: 'Mitochondria are the powerhouse of the cell, producing ATP.',
      },
      {
        _id: 'card_2',
        _creationTime: Date.now(),
        setId: 'set_1',
        userId: 'user_test',
        order: 1,
        front: 'What is photosynthesis?',
        back: 'Plants convert light into chemical energy.',
        sourceFilename: 'bio2.pdf',
        sourceChunkContent: 'Photosynthesis transforms light energy into glucose.',
      },
      {
        _id: 'card_3',
        _creationTime: Date.now(),
        setId: 'set_1',
        userId: 'user_test',
        order: 2,
        front: 'Define osmosis.',
        back: 'Water diffuses across a semipermeable membrane.',
        sourceFilename: 'bio3.pdf',
        sourceChunkContent: 'Osmosis is passive water movement across a membrane.',
      },
    ],
  }
}

describe('FlashcardsStudy — Story 7.2 happy-path ATDD (red-first)', () => {
  beforeEach(() => {
    mockSetData.value = sampleSet()
  })

  it('[P0] renders first card front + progress 1 / N + set title', async () => {
    const Study = await import(studyPath)

    const wrapper = await mountSuspended(Study.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="flashcard-viewer"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flashcard-progress"]').text()).toContain('1 / 3')
    expect(wrapper.text()).toContain('Cell Biology Flashcards')
    expect(wrapper.text()).toContain('What do mitochondria produce?')
    // Front side showing (not flipped) — both faces render in DOM with
    // backface-visibility: hidden; we assert state via aria-pressed, not text.
    expect(wrapper.find('[data-testid="flashcard-viewer"]').attributes('aria-pressed')).toBe('false')
  })

  it('[P0] clicking the card flips to back and reveals answer + citation', async () => {
    const Study = await import(studyPath)

    const wrapper = await mountSuspended(Study.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    await wrapper.find('[data-testid="flashcard-viewer"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="flashcard-viewer"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.text()).toContain('ATP')
    // Citation badge renders with filename in aria-label (badge body is the index number)
    const badge = wrapper.find('[aria-label="Source 1 from bio1.pdf"]')
    expect(badge.exists()).toBe(true)
  })

  it('[P0] Next button advances progress and resets to front', async () => {
    const Study = await import(studyPath)

    const wrapper = await mountSuspended(Study.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    // Flip to back first
    await wrapper.find('[data-testid="flashcard-viewer"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="flashcard-viewer"]').attributes('aria-pressed')).toBe('true')

    await wrapper.find('[data-testid="flashcard-next"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="flashcard-progress"]').text()).toContain('2 / 3')
    expect(wrapper.text()).toContain('What is photosynthesis?')
    // Flip state resets to front on advance
    expect(wrapper.find('[data-testid="flashcard-viewer"]').attributes('aria-pressed')).toBe('false')
  })

  it('[P0] Previous is disabled on first card and enabled after Next', async () => {
    const Study = await import(studyPath)

    const wrapper = await mountSuspended(Study.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    const prev = wrapper.find('[data-testid="flashcard-prev"]')
    expect(prev.exists()).toBe(true)
    expect(prev.attributes('disabled') !== undefined || prev.attributes('aria-disabled') === 'true').toBe(true)

    await wrapper.find('[data-testid="flashcard-next"]').trigger('click')
    await flushPromises()

    const prevAfter = wrapper.find('[data-testid="flashcard-prev"]')
    expect(prevAfter.attributes('disabled')).toBeUndefined()
    expect(prevAfter.attributes('aria-disabled')).not.toBe('true')
  })

  it('[P0] advancing past the last card shows completion summary', async () => {
    const Study = await import(studyPath)

    const wrapper = await mountSuspended(Study.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    await wrapper.find('[data-testid="flashcard-next"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="flashcard-next"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="flashcard-next"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="flashcard-completion"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('You finished!')
    expect(wrapper.text()).toContain('You reviewed 3 cards')
    expect(wrapper.find('[data-testid="flashcard-restart"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flashcard-back"]').exists()).toBe(true)
  })

  it('[P0] Restart returns to card 0, front-side', async () => {
    const Study = await import(studyPath)

    const wrapper = await mountSuspended(Study.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    await wrapper.find('[data-testid="flashcard-next"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="flashcard-next"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="flashcard-next"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="flashcard-restart"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="flashcard-completion"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="flashcard-viewer"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flashcard-progress"]').text()).toContain('1 / 3')
    expect(wrapper.text()).toContain('What do mitochondria produce?')
  })

  it('[P0] Back button emits back event (returns to list)', async () => {
    const Study = await import(studyPath)

    const wrapper = await mountSuspended(Study.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    // Top-level back button near title
    const topBack = wrapper.find('[data-testid="flashcard-study-back"]')
    expect(topBack.exists()).toBe(true)
    await topBack.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('back')).toBeTruthy()
  })

  it('[P1] source-reveal toggle on the back expands passage inline (no portal)', async () => {
    const Study = await import(studyPath)

    const wrapper = await mountSuspended(Study.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    // Flip to back
    await wrapper.find('[data-testid="flashcard-viewer"]').trigger('click')
    await flushPromises()

    const toggle = wrapper.find('[data-testid="flashcard-source-toggle"]')
    expect(toggle.exists()).toBe(true)

    await toggle.trigger('click')
    await flushPromises()

    // ChatSourceCard renders with chunk content inline
    expect(wrapper.text()).toContain('Mitochondria are the powerhouse of the cell, producing ATP.')
  })
})
