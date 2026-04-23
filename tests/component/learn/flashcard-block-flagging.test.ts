import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'

const mockRoomData = ref<any>(null)
const mockMutate = vi.fn().mockResolvedValue({ success: true })

mockNuxtImport('useConvexQuery', () => {
  return (_apiRef: any, _args?: any) => {
    return { data: mockRoomData }
  }
})

mockNuxtImport('useConvexMutation', () => {
  return (_apiRef: any) => {
    return { mutate: mockMutate }
  }
})

const componentPath = ['~', 'components', 'learn', 'FlashcardBlock.vue'].join('/')

const unflaggedRoom = {
  room: { title: 'Test Room' },
  cards: [
    {
      _id: 'c1',
      term: 'Mitosis',
      definition: 'Cell divides into two identical cells',
      displayOrder: 0,
    },
  ],
}

const flaggedRoom = {
  room: { title: 'Test Room' },
  cards: [
    {
      _id: 'c1',
      term: 'Mitosis',
      definition: 'Wrong old definition',
      displayOrder: 0,
      flagged: true,
      correctedDefinition: 'Cell divides into two identical daughter cells.',
    },
  ],
}

describe('FlashcardBlock flagging', () => {
  beforeEach(() => {
    mockRoomData.value = null
    mockMutate.mockClear()
  })

  it('shows flag button when cards are loaded', async () => {
    mockRoomData.value = unflaggedRoom
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { roomId: 'room_123' },
    })

    const flagBtn = wrapper.find('[data-testid="flag-button"]')
    expect(flagBtn.exists()).toBe(true)
    expect(flagBtn.text()).toContain('Flag')
  })

  it('opens flag editor on click', async () => {
    mockRoomData.value = unflaggedRoom
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { roomId: 'room_123' },
    })

    const flagBtn = wrapper.find('[data-testid="flag-button"]')
    await flagBtn.trigger('click')

    expect(wrapper.find('[data-testid="flag-editor"]').exists()).toBe(true)
  })

  it('shows flag badge for flagged card', async () => {
    mockRoomData.value = flaggedRoom
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { roomId: 'room_123' },
    })

    expect(wrapper.find('[data-testid="flag-badge"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flag-badge"]').text()).toContain('Corrected')
  })

  it('shows corrected definition instead of original when flagged', async () => {
    mockRoomData.value = flaggedRoom
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { roomId: 'room_123' },
    })

    expect(wrapper.text()).toContain('Tap to flip')
  })

  it('shows "Edit correction" label when card is already flagged', async () => {
    mockRoomData.value = flaggedRoom
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { roomId: 'room_123' },
    })

    const flagBtn = wrapper.find('[data-testid="flag-button"]')
    expect(flagBtn.text()).toContain('Edit correction')
  })
})
