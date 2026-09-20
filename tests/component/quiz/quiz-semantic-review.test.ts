import { describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const reviewPanelPath = ['~', 'components', 'quiz', 'ReviewPanel.vue'].join('/')

function result(status: 'pending' | 'available' | 'unavailable', label?: 'fully_correct' | 'partially_correct' | 'incorrect' | 'uncertain') {
  return [{
    questionId: 'q1',
    questionText: 'Describe mitosis.',
    questionType: 'free-response',
    userAnswer: 'One cell creates two identical cells.',
    isCorrect: false,
    correctAnswer: 'Two genetically identical daughter cells.',
    semanticAssessment: { status, label, deterministicScoreUnchanged: true as const },
  }]
}

describe('QuizReviewPanel semantic assessment', () => {
  it('shows a non-blocking pending state without changing deterministic correctness', async () => {
    const ReviewPanel = await import(reviewPanelPath)
    const wrapper = await mountSuspended(ReviewPanel.default, { props: { results: result('pending'), semanticReviewEnabled: true } })
    expect(wrapper.get('[data-testid="quiz-semantic-assessment"]').text()).toContain('Reviewing meaning and evidence')
    expect(wrapper.get('[data-testid="quiz-semantic-assessment"]').attributes()).toMatchObject({ role: 'status', 'aria-live': 'polite' })
    expect(wrapper.text()).toContain('No exact answer match')
    expect(wrapper.text()).toContain('Reference answer')
    expect(wrapper.html()).not.toContain('text-destructive')
    expect(wrapper.text()).toContain('Development beta · AI-reviewed')
    expect(wrapper.text()).toContain('not a corrected grade')
    expect(wrapper.text()).toContain('score has not changed')
  })

  it('shows a semantic match as advisory while preserving the recorded incorrect result', async () => {
    const ReviewPanel = await import(reviewPanelPath)
    const wrapper = await mountSuspended(ReviewPanel.default, { props: { results: result('available', 'fully_correct'), semanticReviewEnabled: true } })
    expect(wrapper.get('[data-testid="quiz-semantic-assessment"]').text()).toContain('Strong meaning match')
    expect(wrapper.text()).toContain('No exact answer match')
    expect(wrapper.text()).toContain('score has not changed')
  })

  it('shows unavailable and uncertain states without a correctness claim', async () => {
    const ReviewPanel = await import(reviewPanelPath)
    const unavailable = await mountSuspended(ReviewPanel.default, { props: { results: result('unavailable'), semanticReviewEnabled: true } })
    expect(unavailable.get('[data-testid="quiz-semantic-assessment"]').text()).toContain('Meaning review unavailable')
    const uncertain = await mountSuspended(ReviewPanel.default, { props: { results: result('available', 'uncertain'), semanticReviewEnabled: true } })
    expect(uncertain.get('[data-testid="quiz-semantic-assessment"]').text()).toContain('uncertain')
  })

  it('offers an accessible retry when a retryable review is due', async () => {
    const ReviewPanel = await import(reviewPanelPath)
    const retryable = result('pending')
    retryable[0]!.semanticAssessment = { ...retryable[0]!.semanticAssessment, retryable: true, retryDueAt: 0 }
    const wrapper = await mountSuspended(ReviewPanel.default, { props: { results: retryable, semanticReviewEnabled: true } })
    const retry = wrapper.get('[data-testid="quiz-semantic-retry"]')
    expect(retry.attributes('disabled')).toBeUndefined()
    expect(retry.text()).toContain('Retry meaning review')
    await retry.trigger('click')
    expect(wrapper.emitted('retrySemantic')).toHaveLength(1)
  })

  it('enables a retry when its persisted due time passes without another data update', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000)
      const ReviewPanel = await import(reviewPanelPath)
      const retryable = result('pending')
      retryable[0]!.semanticAssessment = { ...retryable[0]!.semanticAssessment, retryable: true, retryDueAt: 2_000 }
      const wrapper = await mountSuspended(ReviewPanel.default, { props: { results: retryable, semanticReviewEnabled: true } })
      expect(wrapper.get('[data-testid="quiz-semantic-retry"]').attributes('disabled')).toBeDefined()

      await vi.advanceTimersByTimeAsync(1_000)

      expect(wrapper.get('[data-testid="quiz-semantic-retry"]').attributes('disabled')).toBeUndefined()
      wrapper.unmount()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('keeps advisory metadata hidden when the feature is not activated', async () => {
    const ReviewPanel = await import(reviewPanelPath)
    const wrapper = await mountSuspended(ReviewPanel.default, { props: { results: result('available', 'fully_correct'), semanticReviewEnabled: false } })
    expect(wrapper.find('[data-testid="quiz-semantic-assessment"]').exists()).toBe(false)
  })

  it('keeps conventional destructive feedback for objective mismatches', async () => {
    const ReviewPanel = await import(reviewPanelPath)
    const objective = [{ ...result('unavailable')[0]!, questionType: 'multiple-choice', options: ['A', 'B'], userAnswer: 'B', correctAnswer: 'A', semanticAssessment: undefined }]
    const wrapper = await mountSuspended(ReviewPanel.default, { props: { results: objective, semanticReviewEnabled: false } })
    expect(wrapper.html()).toContain('border-destructive')
    expect(wrapper.text()).not.toContain('No exact answer match')
  })

  it('keeps optionless objective mismatches destructive instead of using free-form feedback', async () => {
    const ReviewPanel = await import(reviewPanelPath)
    const objective = [{
      ...result('unavailable')[0]!,
      questionType: 'true_false',
      options: undefined,
      userAnswer: 'False',
      correctAnswer: 'True',
      semanticAssessment: undefined,
    }]
    const wrapper = await mountSuspended(ReviewPanel.default, { props: { results: objective, semanticReviewEnabled: false } })
    expect(wrapper.html()).toContain('border-destructive')
    expect(wrapper.text()).toContain('Correct answer')
    expect(wrapper.text()).not.toContain('No exact answer match')
    expect(wrapper.text()).not.toContain('Reference answer')
  })
})
