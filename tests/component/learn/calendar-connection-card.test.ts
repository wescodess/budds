import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'

const mockMutate = vi.fn()
let mockQueryData = ref<any>(null)

mockNuxtImport('useConvexQuery', () => {
  return () => ({ data: mockQueryData })
})

mockNuxtImport('useConvexMutation', () => {
  return () => ({ mutate: mockMutate, isLoading: ref(false) })
})

const componentPath = ['~', 'components', 'learn', 'CalendarConnectionCard.vue'].join('/')

describe('CalendarConnectionCard', () => {
  beforeEach(() => {
    mockMutate.mockReset()
    mockQueryData.value = null
  })

  it('renders the card', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="calendar-connection-card"]').exists()).toBe(true)
  })

  it('shows connect button when not connected', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="calendar-connect-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="calendar-disconnect-btn"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Schedule learning sessions automatically')
  })

  it('shows connected state with timezone and disconnect button', async () => {
    mockQueryData.value = {
      _id: 'conn1',
      provider: 'google',
      timezone: 'America/New_York',
      status: 'connected',
      connectedAt: Date.now(),
    }
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="calendar-disconnect-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="calendar-connect-btn"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Connected')
    expect(wrapper.text()).toContain('America/New_York')
  })

  it('calls disconnect mutation on disconnect click', async () => {
    mockQueryData.value = {
      _id: 'conn1',
      provider: 'google',
      timezone: 'America/New_York',
      status: 'connected',
      connectedAt: Date.now(),
    }
    mockMutate.mockResolvedValue(undefined)
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    await wrapper.find('[data-testid="calendar-disconnect-btn"]').trigger('click')
    expect(mockMutate).toHaveBeenCalledWith({})
  })

  it('shows Google Calendar label', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.text()).toContain('Google Calendar')
  })
})
