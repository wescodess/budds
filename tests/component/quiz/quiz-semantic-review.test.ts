import { describe, expect, it } from 'vitest'
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
    expect(wrapper.text()).toContain('Correct answer')
    expect(wrapper.text()).toContain('score has not changed')
  })

  it('shows a semantic match as advisory while preserving the recorded incorrect result', async () => {
    const ReviewPanel = await import(reviewPanelPath)
    const wrapper = await mountSuspended(ReviewPanel.default, { props: { results: result('available', 'fully_correct'), semanticReviewEnabled: true } })
    expect(wrapper.get('[data-testid="quiz-semantic-assessment"]').text()).toContain('fully correct')
    expect(wrapper.text()).toContain('Correct answer')
    expect(wrapper.text()).toContain('score has not changed')
  })

  it('shows unavailable and uncertain states without a correctness claim', async () => {
    const ReviewPanel = await import(reviewPanelPath)
    const unavailable = await mountSuspended(ReviewPanel.default, { props: { results: result('unavailable'), semanticReviewEnabled: true } })
    expect(unavailable.get('[data-testid="quiz-semantic-assessment"]').text()).toContain('Meaning review unavailable')
    const uncertain = await mountSuspended(ReviewPanel.default, { props: { results: result('available', 'uncertain'), semanticReviewEnabled: true } })
    expect(uncertain.get('[data-testid="quiz-semantic-assessment"]').text()).toContain('uncertain')
  })

  it('keeps advisory metadata hidden when the feature is not activated', async () => {
    const ReviewPanel = await import(reviewPanelPath)
    const wrapper = await mountSuspended(ReviewPanel.default, { props: { results: result('available', 'fully_correct'), semanticReviewEnabled: false } })
    expect(wrapper.find('[data-testid="quiz-semantic-assessment"]').exists()).toBe(false)
  })
})
