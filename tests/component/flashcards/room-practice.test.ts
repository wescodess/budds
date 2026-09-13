import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mockMatchMedia } from '../../support/match-media'

const practicePath = ['~', 'components', 'flashcards', 'RoomPractice.vue'].join('/')

function sampleCards() {
  return [
    {
      _id: 'card_a',
      displayOrder: 0,
      term: 'Chemical symbol for gold?',
      definition: 'Au',
      metadata: { source: { filename: 'chem.pdf', chunkContent: 'Gold (Au) is a metal.' } },
    },
    {
      _id: 'card_b',
      displayOrder: 1,
      term: 'pH of pure water at 25 C?',
      definition: '7',
      metadata: { source: { filename: 'chem-ph.pdf', chunkContent: 'Pure water has pH 7.' } },
    },
    {
      _id: 'card_c',
      displayOrder: 2,
      term: 'Atomic number of carbon?',
      definition: '6',
    },
  ]
}

describe('RoomPractice', () => {
  beforeEach(() => {
    mockMatchMedia()
  })

  it('[P0] renders first card front with progress 1 / N', async () => {
    const RoomPractice = await import(practicePath)
    const wrapper = await mountSuspended(RoomPractice.default, {
      props: { cards: sampleCards() },
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="flashcard-room-practice-viewer"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flashcard-room-practice-progress"]').text()).toContain('1 / 3')
    expect(wrapper.text()).toContain('Chemical symbol for gold?')
  })

  it('[P0] clicking viewer flips to definition', async () => {
    const RoomPractice = await import(practicePath)
    const wrapper = await mountSuspended(RoomPractice.default, {
      props: { cards: sampleCards() },
    })
    await flushPromises()

    const viewer = wrapper.find('[data-testid="flashcard-room-practice-viewer"]')
    expect(viewer.attributes('aria-pressed')).toBe('false')
    await viewer.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="flashcard-room-practice-viewer"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.text()).toContain('Au')
  })

  it('[P0] Next advances, Previous retreats; Previous disabled at index 0', async () => {
    const RoomPractice = await import(practicePath)
    const wrapper = await mountSuspended(RoomPractice.default, {
      props: { cards: sampleCards() },
    })
    await flushPromises()

    const prev = wrapper.find('[data-testid="flashcard-room-practice-prev"]')
    expect(prev.attributes('aria-disabled')).toBe('true')

    await wrapper.find('[data-testid="flashcard-room-practice-next"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="flashcard-room-practice-progress"]').text()).toContain('2 / 3')

    await wrapper.find('[data-testid="flashcard-room-practice-prev"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="flashcard-room-practice-progress"]').text()).toContain('1 / 3')
  })

  it('[P0] advancing past last card shows completion', async () => {
    const RoomPractice = await import(practicePath)
    const wrapper = await mountSuspended(RoomPractice.default, {
      props: { cards: sampleCards() },
    })
    await flushPromises()

    await wrapper.find('[data-testid="flashcard-room-practice-next"]').trigger('click')
    await wrapper.find('[data-testid="flashcard-room-practice-next"]').trigger('click')
    await wrapper.find('[data-testid="flashcard-room-practice-next"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="flashcard-room-practice-complete"]').exists()).toBe(true)
  })

  it('[P0] Reset returns to card 0, front-side', async () => {
    const RoomPractice = await import(practicePath)
    const wrapper = await mountSuspended(RoomPractice.default, {
      props: { cards: sampleCards() },
    })
    await flushPromises()

    await wrapper.find('[data-testid="flashcard-room-practice-next"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="flashcard-room-practice-progress"]').text()).toContain('2 / 3')

    await wrapper.find('[data-testid="flashcard-room-practice-reset"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="flashcard-room-practice-progress"]').text()).toContain('1 / 3')
    expect(wrapper.text()).toContain('Chemical symbol for gold?')
  })

  it('[P0] Shuffle with seed produces deterministic order across runs', async () => {
    const RoomPractice = await import(practicePath)

    // Run 1
    const wrapper1 = await mountSuspended(RoomPractice.default, {
      props: { cards: sampleCards(), seedForTests: 42 },
    })
    await flushPromises()
    await wrapper1.find('[data-testid="flashcard-room-practice-shuffle"]').trigger('click')
    await flushPromises()
    const firstShown1 = wrapper1.text()

    // Run 2
    const wrapper2 = await mountSuspended(RoomPractice.default, {
      props: { cards: sampleCards(), seedForTests: 42 },
    })
    await flushPromises()
    await wrapper2.find('[data-testid="flashcard-room-practice-shuffle"]').trigger('click')
    await flushPromises()
    const firstShown2 = wrapper2.text()

    // Both runs should contain the same first card term (same seed ⇒ same shuffle)
    const terms = ['Chemical symbol for gold?', 'pH of pure water at 25 C?', 'Atomic number of carbon?']
    const runs = [firstShown1, firstShown2].map((text) => terms.find((t) => text.indexOf(t) !== -1))
    expect(runs[0]).toBeDefined()
    expect(runs[0]).toBe(runs[1])
  })
})
