import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const componentPath = ['~', 'components', 'learn', 'ReviewRatingButtons.vue'].join('/')

describe('ReviewRatingButtons', () => {
  it('renders 4 rating buttons', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    const group = wrapper.find('[data-testid="rating-buttons"]')
    expect(group.exists()).toBe(true)
    const buttons = group.findAll('button')
    expect(buttons).toHaveLength(4)
  })

  it('has correct labels', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    expect(wrapper.find('[data-testid="rate-again"]').text()).toBe('Again')
    expect(wrapper.find('[data-testid="rate-hard"]').text()).toBe('Hard')
    expect(wrapper.find('[data-testid="rate-good"]').text()).toBe('Good')
    expect(wrapper.find('[data-testid="rate-easy"]').text()).toBe('Easy')
  })

  it('emits rate with quality 0 for Again', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    await wrapper.find('[data-testid="rate-again"]').trigger('click')
    expect(wrapper.emitted('rate')).toEqual([[0]])
  })

  it('emits rate with quality 3 for Hard', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    await wrapper.find('[data-testid="rate-hard"]').trigger('click')
    expect(wrapper.emitted('rate')).toEqual([[3]])
  })

  it('emits rate with quality 4 for Good', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    await wrapper.find('[data-testid="rate-good"]').trigger('click')
    expect(wrapper.emitted('rate')).toEqual([[4]])
  })

  it('emits rate with quality 5 for Easy', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    await wrapper.find('[data-testid="rate-easy"]').trigger('click')
    expect(wrapper.emitted('rate')).toEqual([[5]])
  })

  it('has role group with aria-label', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    const group = wrapper.find('[data-testid="rating-buttons"]')
    expect(group.attributes('role')).toBe('group')
    expect(group.attributes('aria-label')).toBe('Rate your recall')
  })

  it('Again button has red styling', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    const btn = wrapper.find('[data-testid="rate-again"]')
    expect(btn.classes()).toEqual(expect.arrayContaining(['text-red-400']))
  })

  it('Easy button has teal styling', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default)
    const btn = wrapper.find('[data-testid="rate-easy"]')
    expect(btn.classes()).toEqual(expect.arrayContaining(['text-teal-400']))
  })
})
