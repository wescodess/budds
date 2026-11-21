import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

const roomData = ref<any>(null)
const roomError = ref<unknown>(null)
const room = { room: { title: 'Test Room' }, cards: [{ _id: 'c1', term: 'Mitosis', definition: 'Cell division', displayOrder: 0 }] }
const refresh = vi.fn(async () => { roomError.value = null; roomData.value = room })
const denied = (reasonCode: string) => Object.assign(new Error('denied'), { data: { admission: { status: 'denied', reasonCode } } })

mockNuxtImport('useConvexQuery', () => () => ({ data: roomData, error: roomError, refresh }))
mockNuxtImport('useConvexMutation', () => () => ({ mutate: vi.fn() }))

const componentPath = ['~', 'components', 'learn', 'FlashcardBlock.vue'].join('/')

async function mount(props: Record<string, unknown> = { roomId: 'room_123' }) {
  const Comp = await import(componentPath)
  const wrapper = await mountSuspended(Comp.default, { props })
  await flushPromises()
  return wrapper
}

describe('FlashcardBlock teaching read failures', () => {
  beforeEach(() => {
    roomData.value = null
    roomError.value = null
    refresh.mockClear()
  })

  it('pauses while a check is open instead of loading forever', async () => {
    roomError.value = denied('test_open')
    const wrapper = await mount()
    expect(wrapper.text()).not.toContain('Loading flashcards...')
    expect(wrapper.get('[data-testid="flashcard-block-read-paused"]').text()).toBe('This is paused while you have a check open. Finish the check, then come back.')
    expect(wrapper.find('[data-testid="flashcard-block-read-retry"]').exists()).toBe(false)
  })

  it('says the content is unavailable when disclosure is unknown', async () => {
    roomError.value = denied('disclosure_unknown')
    const wrapper = await mount()
    expect(wrapper.get('[data-testid="flashcard-block-read-paused"]').text()).toBe('This isn’t available right now.')
    expect(wrapper.find('[data-testid="flashcard-block-read-retry"]').exists()).toBe(false)
  })

  it('retries a failed read and recovers to the cards', async () => {
    roomError.value = new Error('Network down')
    const wrapper = await mount()
    expect(wrapper.get('[data-testid="flashcard-block-read-error"]').text()).toContain('Could not load these flashcards.')
    await wrapper.get('[data-testid="flashcard-block-read-retry"]').trigger('click')
    await flushPromises()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="flashcard-block-read-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Mitosis')
  })

  it('keeps offline cards when offline', async () => {
    roomError.value = denied('test_open')
    const wrapper = await mount({ roomId: 'room_123', isOffline: true, offlineData: { cards: [{ term: 'Offline term', definition: 'Offline definition' }] } })
    expect(wrapper.find('[data-testid="flashcard-block-read-paused"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Offline term')
  })

  it('drops shown and offline cards when a check opens after content was shown', async () => {
    roomData.value = { room: { title: 'Test Room' }, cards: [{ _id: 'c1', term: 'Mitosis', definition: 'Cell division', displayOrder: 0 }, { _id: 'c2', term: 'Meiosis', definition: 'Gamete division', displayOrder: 1 }] }
    const wrapper = await mount({ roomId: 'room_123', isOffline: false, offlineData: { cards: [{ term: 'Offline term', definition: 'Offline definition' }] } })
    await wrapper.get('[data-testid="flag-button"]').trigger('click')
    expect(wrapper.find('[data-testid="flag-editor"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Mitosis')

    roomError.value = denied('test_open')
    roomData.value = null
    await flushPromises()
    expect(wrapper.get('[data-testid="flashcard-block-read-paused"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Mitosis')
    expect(wrapper.find('[data-testid="flag-editor"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="flag-button"]').exists()).toBe(false)

    await wrapper.setProps({ isOffline: true })
    await flushPromises()
    expect(wrapper.get('[data-testid="flashcard-block-read-paused"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Offline term')
    expect(wrapper.text()).not.toContain('Offline definition')
  })
})
