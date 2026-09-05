import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

const mockFetch = vi.fn()
let mockQueryData = ref<any>(null)

mockNuxtImport('useConvexQuery', () => {
  return () => ({ data: mockQueryData })
})

mockNuxtImport('useConvexMutation', () => {
  return () => ({ mutate: vi.fn(), isLoading: ref(false) })
})

const componentPath = ['~', 'components', 'learn', 'CalendarConnectionCard.vue'].join('/')

describe('CalendarConnectionCard', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockQueryData.value = null
    vi.stubGlobal('$fetch', mockFetch)
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

  it('calls server disconnect endpoint on disconnect confirm', async () => {
    mockQueryData.value = {
      _id: 'conn1',
      provider: 'google',
      timezone: 'America/New_York',
      status: 'connected',
      connectedAt: Date.now(),
    }
    mockFetch.mockResolvedValue({ disconnected: true })
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)

    await wrapper.find('[data-testid="calendar-disconnect-btn"]').trigger('click')
    await nextTick()

    const confirmBtn = document.querySelector('[data-testid="disconnect-confirm-btn"]') as HTMLButtonElement
    expect(confirmBtn).toBeTruthy()
    confirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(mockFetch).toHaveBeenCalledWith('/api/calendar/disconnect', { method: 'POST' })
  })

  it('shows Google Calendar label', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.text()).toContain('Google Calendar')
  })
})
