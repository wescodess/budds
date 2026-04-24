import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const compPath = ['~', 'components', 'learn', 'DailyReviewCTA.vue'].join('/')

describe('DailyReviewCTA', () => {
  it('renders with due count and estimated duration', async () => {
    const Comp = await import(compPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { dueCount: 12, dailyCap: 50 },
    })

    expect(wrapper.find('[data-testid="daily-review-cta"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('12 items due')
    expect(wrapper.text()).toContain('~3 min')
  })

  it('caps displayed count at dailyCap', async () => {
    const Comp = await import(compPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { dueCount: 80, dailyCap: 30 },
    })

    expect(wrapper.text()).toContain('30 items due')
  })

  it('shows singular item text for 1 item', async () => {
    const Comp = await import(compPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { dueCount: 1, dailyCap: 50 },
    })

    expect(wrapper.text()).toContain('1 item due')
    expect(wrapper.text()).not.toContain('1 items')
  })

  it('shows minimum of 1 minute estimated duration', async () => {
    const Comp = await import(compPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { dueCount: 1, dailyCap: 50 },
    })

    expect(wrapper.text()).toContain('~1 min')
  })

  it('links to review page', async () => {
    const Comp = await import(compPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { dueCount: 5, dailyCap: 50 },
    })

    const link = wrapper.find('[data-testid="daily-review-cta"]')
    expect(link.attributes('to') || link.attributes('href')).toContain('/app/learn/review')
  })
})
