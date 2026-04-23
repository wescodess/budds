import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const componentPath = ['~', 'components', 'learn', 'SectionCompletionCard.vue'].join('/')

const baseProps = {
  practiceScore: 85,
  masteryLevel: 'reviewing' as const,
  conceptsForReview: 0,
  feedbackText: '',
  hasNextSection: true,
  isLastSection: false,
  nextSectionReady: true,
  nextSectionGenerating: false,
}

describe('SectionCompletionCard', () => {
  it('renders accuracy score', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    const score = wrapper.find('[data-testid="accuracy-score"]')
    expect(score.text()).toBe('85%')
  })

  it('renders mastery badge', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    const badge = wrapper.find('[data-testid="mastery-badge"]')
    expect(badge.text()).toContain('Reviewing')
  })

  it('shows mastered badge for high scores', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { ...baseProps, masteryLevel: 'mastered' },
    })
    const badge = wrapper.find('[data-testid="mastery-badge"]')
    expect(badge.text()).toContain('Mastered')
  })

  it('shows continue button when next section exists and is ready', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    const btn = wrapper.find('[data-testid="continue-button"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('Continue to next section')
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('disables continue button when next section is not ready', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { ...baseProps, nextSectionReady: false, nextSectionGenerating: true },
    })
    const btn = wrapper.find('[data-testid="continue-button"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('Preparing next section')
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('hides continue button for last section', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { ...baseProps, isLastSection: true, hasNextSection: false },
    })
    const btn = wrapper.find('[data-testid="continue-button"]')
    expect(btn.exists()).toBe(false)
  })

  it('shows Course Complete title for last section', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { ...baseProps, isLastSection: true, hasNextSection: false },
    })
    expect(wrapper.text()).toContain('Course Complete!')
  })

  it('shows Section Complete title for non-last section', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    expect(wrapper.text()).toContain('Section Complete')
  })

  it('shows back button always', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    const btn = wrapper.find('[data-testid="back-button"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('Back to Course Overview')
  })

  it('emits continueToNext on continue click', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    await wrapper.find('[data-testid="continue-button"]').trigger('click')
    expect(wrapper.emitted('continueToNext')).toHaveLength(1)
  })

  it('emits backToCourse on back click', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    await wrapper.find('[data-testid="back-button"]').trigger('click')
    expect(wrapper.emitted('backToCourse')).toHaveLength(1)
  })

  it('shows adaptive feedback when provided', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { ...baseProps, feedbackText: 'This section had challenging concepts.' },
    })
    const feedback = wrapper.find('[data-testid="adaptive-feedback"]')
    expect(feedback.exists()).toBe(true)
    expect(feedback.text()).toContain('challenging concepts')
  })

  it('hides adaptive feedback when empty', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    const feedback = wrapper.find('[data-testid="adaptive-feedback"]')
    expect(feedback.exists()).toBe(false)
  })

  it('shows review count text', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    const review = wrapper.find('[data-testid="review-count"]')
    expect(review.text()).toContain('Concepts ready for future review')
  })

  it('shows concepts count when > 0', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { ...baseProps, conceptsForReview: 5 },
    })
    const review = wrapper.find('[data-testid="review-count"]')
    expect(review.text()).toContain('5 concepts added to review')
  })

  it('has accessible region role', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, { props: baseProps })
    const card = wrapper.find('[data-testid="section-completion-card"]')
    expect(card.attributes('role')).toBe('region')
    expect(card.attributes('aria-label')).toBe('Section completion summary')
  })
})
