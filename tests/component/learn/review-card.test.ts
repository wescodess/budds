import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const componentPath = ['~', 'components', 'learn', 'ReviewCard.vue'].join('/')

const baseProps = {
  prompt: 'What is the primary function of a nucleophile?',
  answer: 'To donate an electron pair to an electrophile.',
  courseTitle: 'Organic Chemistry',
  sectionOrder: 2,
  revealed: false,
}

describe('ReviewCard', () => {
  it('renders the prompt text', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    expect(wrapper.find('[data-testid="review-prompt"]').text()).toBe(baseProps.prompt)
  })

  it('shows reveal button when not revealed', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    expect(wrapper.find('[data-testid="reveal-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="review-answer"]').exists()).toBe(false)
  })

  it('shows answer when revealed', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { ...baseProps, revealed: true },
    })
    expect(wrapper.find('[data-testid="review-answer"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="review-answer"]').text()).toContain(baseProps.answer)
    expect(wrapper.find('[data-testid="reveal-button"]').exists()).toBe(false)
  })

  it('emits reveal event on button click', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    await wrapper.find('[data-testid="reveal-button"]').trigger('click')
    expect(wrapper.emitted('reveal')).toHaveLength(1)
  })

  it('renders source attribution', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    const attr = wrapper.find('[data-testid="source-attribution"]')
    expect(attr.text()).toBe('From: Organic Chemistry, Section 3')
  })

  it('shows corrected answer when flagged', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { ...baseProps, revealed: true, flagged: true, correctedAnswer: 'Corrected text.' },
    })
    expect(wrapper.find('[data-testid="review-answer"]').text()).toContain('Corrected text.')
  })

  it('has aria-live polite when revealed', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { ...baseProps, revealed: true },
    })
    expect(wrapper.find('[data-testid="review-card"]').attributes('aria-live')).toBe('polite')
  })
})
