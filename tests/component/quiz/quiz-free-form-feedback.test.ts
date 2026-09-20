import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const shortResponsePath = ['~', 'components', 'quiz', 'inputs', 'ShortResponse.vue'].join('/')
const fillInBlankPath = ['~', 'components', 'quiz', 'inputs', 'FillInBlank.vue'].join('/')

describe.each([
  ['short response', shortResponsePath],
  ['fill in the blank', fillInBlankPath],
])('neutral free-form exact matching: %s', (_name, componentPath) => {
  it('uses neutral mismatch language and styling', async () => {
    const component = await import(componentPath)
    const wrapper = await mountSuspended(component.default, {
      props: {
        modelValue: 'A meaning-equivalent answer',
        feedback: { isCorrect: false, correctAnswer: 'The reference wording' },
      },
    })
    expect(wrapper.text()).toContain('No exact answer match')
    expect(wrapper.text()).toContain('Reference answer')
    expect(wrapper.html()).not.toContain('border-l-destructive')
  })
})
