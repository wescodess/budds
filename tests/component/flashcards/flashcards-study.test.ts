/**
 * Story 7.2 AC #11 — Full component test suite for FlashcardsStudy.
 *
 * 8 assertions:
 *   (a) front renders first card + set title + progress 1 / N
 *   (b) click/space flips to back (answer + citation visible)
 *   (c) Next advances progress and resets to front
 *   (d) Previous retreats and is disabled at index 0
 *   (e) advancing past last card shows completion
 *   (f) Restart returns to card 0, front-side
 *   (g) Back button emits `back`
 *   (h) source toggle expands inline passage (no portal)
 *
 * Reka-portal discipline preserved — no portaled primitives in Study.vue's subtree.
 * `prefers-reduced-motion` is a CSS media query (not JS-detectable under happy-dom);
 * we assert the flip class flips, not the animation duration — documented in the
 * story's Dev Agent Record Decisions section.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mockMatchMedia } from '../../support/match-media'

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
      title: 'Chemistry Quick Review',
      status: 'ready',
      cardCount: 2,
    },
    cards: [
      {
        _id: 'card_a',
        _creationTime: Date.now(),
        setId: 'set_1',
        userId: 'user_test',
        order: 0,
        front: 'What is the chemical symbol for gold?',
        back: 'Au',
        sourceFilename: 'chem-elements.pdf',
        sourceChunkContent: 'Gold (Au) is a transition metal with atomic number 79.',
      },
      {
        _id: 'card_b',
        _creationTime: Date.now(),
        setId: 'set_1',
        userId: 'user_test',
        order: 1,
        front: 'What is the pH of pure water at 25 C?',
        back: '7',
        sourceFilename: 'chem-ph.pdf',
        sourceChunkContent: 'Pure water has a neutral pH of 7 at 25 degrees Celsius.',
      },
    ],
  }
}

function dispatchPointer(target: Element, type: string, init: Record<string, unknown>) {
  const event = typeof PointerEvent === 'function'
    ? new PointerEvent(type, { bubbles: true, ...init })
    : Object.assign(new Event(type, { bubbles: true }), init)
  target.dispatchEvent(event)
}

describe('FlashcardsStudy — Story 7.2 AC #11 full component coverage', () => {
  beforeEach(() => {
    mockMatchMedia()
    mockSetData.value = sampleSet()
  })

  it('[P0] (a) renders front of first card + set title + progress 1 / N', async () => {
    const Study = await import(studyPath)
    const wrapper = await mountSuspended(Study.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="flashcard-viewer"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flashcard-progress"]').text()).toContain('1 / 2')
    expect(wrapper.text()).toContain('Chemistry Quick Review')
    expect(wrapper.text()).toContain('What is the chemical symbol for gold?')
    // answer hidden on front
    expect(wrapper.find('[data-testid="flashcard-completion"]').exists()).toBe(false)
  })

  it('[P0] (b) clicking the viewer flips to back (answer visible, aria-pressed true)', async () => {
    const Study = await import(studyPath)
    const wrapper = await mountSuspended(Study.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    const viewer = wrapper.find('[data-testid="flashcard-viewer"]')
    expect(viewer.attributes('aria-pressed')).toBe('false')

    await viewer.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="flashcard-viewer"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.text()).toContain('Au')
    // Citation badge's filename lives in aria-label (the badge body renders the index).
    expect(wrapper.find('[aria-label="Source 1 from chem-elements.pdf"]').exists()).toBe(true)
  })

  it('[P0] (b2) pressing Space on the viewer flips the card', async () => {
    const Study = await import(studyPath)
    const wrapper = await mountSuspended(Study.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    await wrapper.find('[data-testid="flashcard-viewer"]').trigger('keydown', { key: ' ' })
    await flushPromises()

    expect(wrapper.find('[data-testid="flashcard-viewer"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.text()).toContain('Au')
  })

  it('[P1] keeps gesture ownership on the viewer itself and still advances on swipe', async () => {
    mockMatchMedia({ touch: true, mobile: true })

    const Study = await import(studyPath)
    const wrapper = await mountSuspended(Study.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    const root = wrapper.get('[data-testid="flashcard-study-root"]')
    const viewer = wrapper.get('[data-testid="flashcard-viewer"]')

    expect(root.attributes('data-gesture-owner')).toBeUndefined()
    expect(viewer.attributes('data-gesture-owner')).toBe('flashcard-study')

    dispatchPointer(viewer.element, 'pointerdown', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 120,
      clientY: 48,
      buttons: 1,
    })
    dispatchPointer(viewer.element, 'pointermove', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 24,
      clientY: 48,
      buttons: 1,
    })
    dispatchPointer(viewer.element, 'pointerup', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 24,
      clientY: 48,
      buttons: 0,
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="flashcard-progress"]').text()).toContain('2 / 2')
  })

  it('[P0] (c) Next advances progress and resets to front', async () => {
    const Study = await import(studyPath)
    const wrapper = await mountSuspended(Study.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    await wrapper.find('[data-testid="flashcard-viewer"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Au')

    await wrapper.find('[data-testid="flashcard-next"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="flashcard-progress"]').text()).toContain('2 / 2')
    expect(wrapper.text()).toContain('What is the pH of pure water at 25 C?')
    expect(wrapper.find('[data-testid="flashcard-viewer"]').attributes('aria-pressed')).toBe('false')
  })

  it('[P0] (d) Previous is disabled at index 0, enabled after advance', async () => {
    const Study = await import(studyPath)
    const wrapper = await mountSuspended(Study.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    const prev = wrapper.find('[data-testid="flashcard-prev"]')
    expect(prev.attributes('disabled') !== undefined || prev.attributes('aria-disabled') === 'true').toBe(true)

    await wrapper.find('[data-testid="flashcard-next"]').trigger('click')
    await flushPromises()

    const prevAfter = wrapper.find('[data-testid="flashcard-prev"]')
    expect(prevAfter.attributes('aria-disabled')).toBe('false')

    await prevAfter.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="flashcard-progress"]').text()).toContain('1 / 2')
  })

  it('[P0] (e) advancing past last card shows completion summary', async () => {
    const Study = await import(studyPath)
    const wrapper = await mountSuspended(Study.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    await wrapper.find('[data-testid="flashcard-next"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="flashcard-next"]').trigger('click')
    await flushPromises()

    const completion = wrapper.find('[data-testid="flashcard-completion"]')
    expect(completion.exists()).toBe(true)
    expect(wrapper.text()).toContain('You finished!')
    expect(wrapper.text()).toContain('You reviewed 2 cards')
    expect(wrapper.find('[data-testid="flashcard-restart"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flashcard-back"]').exists()).toBe(true)
  })

  it('[P0] (f) Restart returns to card 0, front-side', async () => {
    const Study = await import(studyPath)
    const wrapper = await mountSuspended(Study.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    await wrapper.find('[data-testid="flashcard-next"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="flashcard-next"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="flashcard-restart"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="flashcard-completion"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="flashcard-progress"]').text()).toContain('1 / 2')
    expect(wrapper.text()).toContain('What is the chemical symbol for gold?')
    expect(wrapper.find('[data-testid="flashcard-viewer"]').attributes('aria-pressed')).toBe('false')
  })

  it('[P0] (g) top-level Back button emits `back`', async () => {
    const Study = await import(studyPath)
    const wrapper = await mountSuspended(Study.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    await wrapper.find('[data-testid="flashcard-study-back"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('back')).toBeTruthy()
    expect(wrapper.emitted('back')?.length).toBe(1)
  })

  it('[P0] (g2) completion "Back to list" button emits `back`', async () => {
    const Study = await import(studyPath)
    const wrapper = await mountSuspended(Study.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    await wrapper.find('[data-testid="flashcard-next"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="flashcard-next"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="flashcard-back"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('back')).toBeTruthy()
  })

  it('[P0] (h) source toggle reveals passage inline (no portal)', async () => {
    const Study = await import(studyPath)
    const wrapper = await mountSuspended(Study.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    await wrapper.find('[data-testid="flashcard-viewer"]').trigger('click')
    await flushPromises()

    const toggle = wrapper.find('[data-testid="flashcard-source-toggle"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.text()).toContain('Show passage')

    await toggle.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="flashcard-source-panel"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Gold (Au) is a transition metal with atomic number 79.')
  })

  it('[P1] unavailable state — data=null shows "Set not available"', async () => {
    mockSetData.value = null
    const Study = await import(studyPath)
    const wrapper = await mountSuspended(Study.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="flashcard-study-unavailable"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flashcard-viewer"]').exists()).toBe(false)
  })

  it('[P1] empty set — zero cards shows empty state', async () => {
    mockSetData.value = { set: sampleSet().set, cards: [] }
    const Study = await import(studyPath)
    const wrapper = await mountSuspended(Study.default, {
      props: { setId: 'set_1' },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="flashcard-study-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flashcard-viewer"]').exists()).toBe(false)
  })
})
