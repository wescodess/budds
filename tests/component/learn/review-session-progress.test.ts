import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const componentPath = ['~', 'components', 'learn', 'ReviewSessionProgress.vue'].join('/')

describe('ReviewSessionProgress', () => {
  it('renders progress count', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { current: 3, total: 8 },
    })
    expect(wrapper.find('[data-testid="progress-count"]').text()).toBe('3/8')
  })

  it('renders progress bar with correct aria values', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { current: 5, total: 10 },
    })
    const bar = wrapper.find('[role="progressbar"]')
    expect(bar.exists()).toBe(true)
    expect(bar.attributes('aria-valuenow')).toBe('50')
    expect(bar.attributes('aria-label')).toBe('Review progress: 5 of 10')
  })

  it('handles zero total gracefully', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { current: 0, total: 0 },
    })
    const bar = wrapper.find('[role="progressbar"]')
    expect(bar.attributes('aria-valuenow')).toBe('0')
  })

  it('shows 100% when all items reviewed', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { current: 8, total: 8 },
    })
    const bar = wrapper.find('[role="progressbar"]')
    expect(bar.attributes('aria-valuenow')).toBe('100')
    expect(wrapper.find('[data-testid="progress-count"]').text()).toBe('8/8')
  })
})
