import { describe, it, expect, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'

const mockMutate = vi.fn()

mockNuxtImport('useConvexMutation', () => {
  return () => ({ mutate: mockMutate, isLoading: ref(false) })
})

const componentPath = ['~', 'components', 'learn', 'ReviewCapSetting.vue'].join('/')

describe('ReviewCapSetting', () => {
  it('renders settings toggle button', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { currentCap: 50 },
    })
    expect(wrapper.find('[data-testid="review-cap-toggle"]').exists()).toBe(true)
  })

  it('opens settings panel on click', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { currentCap: 50 },
    })
    expect(wrapper.find('[data-testid="review-cap-panel"]').exists()).toBe(false)
    await wrapper.find('[data-testid="review-cap-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="review-cap-panel"]').exists()).toBe(true)
  })

  it('shows current cap value in input', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { currentCap: 30 },
    })
    await wrapper.find('[data-testid="review-cap-toggle"]').trigger('click')
    const input = wrapper.find('[data-testid="review-cap-input"]')
    expect((input.element as HTMLInputElement).value).toBe('30')
  })

  it('calls mutation on save', async () => {
    mockMutate.mockResolvedValue(undefined)
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { currentCap: 50 },
    })
    await wrapper.find('[data-testid="review-cap-toggle"]').trigger('click')
    await wrapper.find('[data-testid="review-cap-input"]').setValue(25)
    await wrapper.find('[data-testid="review-cap-save"]').trigger('click')
    expect(mockMutate).toHaveBeenCalledWith({ cap: 25 })
  })
})
