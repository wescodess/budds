import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const componentPath = ['~', 'components', 'learn', 'MasteryBadge.vue'].join('/')

describe('MasteryBadge', () => {
  it('renders gray dot for new mastery', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { level: 'new' } })
    const dot = wrapper.find('[data-testid="mastery-dot"]')
    expect(dot.exists()).toBe(true)
    expect(dot.classes()).toEqual(expect.arrayContaining(['bg-stone-500']))
  })

  it('renders amber dot for learning mastery', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { level: 'learning' } })
    const dot = wrapper.find('[data-testid="mastery-dot"]')
    expect(dot.exists()).toBe(true)
    expect(dot.classes()).toEqual(expect.arrayContaining(['bg-amber-500']))
  })

  it('renders gold dot for reviewing mastery', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { level: 'reviewing' } })
    const dot = wrapper.find('[data-testid="mastery-dot"]')
    expect(dot.exists()).toBe(true)
    expect(dot.classes()).toEqual(expect.arrayContaining(['bg-amber-400']))
  })

  it('renders green checkmark for mastered', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { level: 'mastered' } })
    const checkmark = wrapper.find('[data-testid="mastery-checkmark"]')
    expect(checkmark.exists()).toBe(true)
    const dot = wrapper.find('[data-testid="mastery-dot"]')
    expect(dot.exists()).toBe(false)
  })

  it('shows text label by default', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { level: 'learning' } })
    const label = wrapper.find('[data-testid="mastery-label"]')
    expect(label.exists()).toBe(true)
    expect(label.text()).toBe('Learning')
  })

  it('hides text label when compact', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { level: 'learning', compact: true } })
    const label = wrapper.find('[data-testid="mastery-label"]')
    expect(label.exists()).toBe(false)
  })

  it('has accessible aria-label', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { level: 'mastered' } })
    const badge = wrapper.find('[data-testid="mastery-badge"]')
    expect(badge.attributes('aria-label')).toBe('Mastery: Mastered')
  })

  it('shows correct label for new', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { level: 'new' } })
    expect(wrapper.text()).toContain('New')
  })

  it('shows correct label for reviewing', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: { level: 'reviewing' } })
    expect(wrapper.text()).toContain('Reviewing')
  })
})
