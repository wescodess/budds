import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const componentPath = ['~', 'components', 'learn', 'StreakDisplay.vue'].join('/')

describe('StreakDisplay', () => {
  it('renders when streak > 0', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { streakCurrent: 7 },
    })
    expect(wrapper.find('[data-testid="streak-display"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('7')
    expect(wrapper.text()).toContain('days')
  })

  it('does not render when streak is 0', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { streakCurrent: 0 },
    })
    expect(wrapper.find('[data-testid="streak-display"]').exists()).toBe(false)
  })

  it('shows singular day for streak of 1', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { streakCurrent: 1 },
    })
    expect(wrapper.text()).toContain('day')
    expect(wrapper.text()).not.toContain('days')
  })

  it('has correct aria label', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { streakCurrent: 5 },
    })
    const el = wrapper.find('[data-testid="streak-display"]')
    expect(el.attributes('aria-label')).toBe('Learning streak: 5 days')
  })

  it('shows freeze available indicator', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { streakCurrent: 3, streakFreezeAvailable: true },
    })
    expect(wrapper.find('[data-testid="streak-freeze-available"]').exists()).toBe(true)
  })

  it('hides freeze indicator when not available', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { streakCurrent: 3, streakFreezeAvailable: false },
    })
    expect(wrapper.find('[data-testid="streak-freeze-available"]').exists()).toBe(false)
  })

  it('includes freeze in aria label when available', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { streakCurrent: 5, streakFreezeAvailable: true },
    })
    const el = wrapper.find('[data-testid="streak-display"]')
    expect(el.attributes('aria-label')).toBe('Learning streak: 5 days, freeze available')
  })
})
