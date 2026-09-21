import { describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const path = ['~', 'components', 'learn-adaptive', 'InitialClarification.vue'].join('/')

describe('initial clarification', () => {
  async function mount(props: Record<string, unknown> = {}) {
    const component = await import(path)
    return await mountSuspended(component.default, { props: { originalNeed: '  Preserve my exact original wording.  ', decision: { status: 'pending', continuationKind: 'standalone_non_factual', question: { key: 'useful_outcome', templateVersion: 'learn-adaptive.clarification-templates.v1', prompt: 'What outcome would make this first step useful?', help: 'Name one concrete result.' } }, ...props } })
  }

  it('keeps original wording visible and emits one bounded answer or explicit skip', async () => {
    const wrapper = await mount()
    expect(wrapper.get('[data-testid="learn-clarification-original-need"]').element.textContent).toBe('  Preserve my exact original wording.  ')
    const answer = wrapper.get('[data-testid="learn-clarification-answer"]')
    await answer.setValue('A checklist I can use tomorrow.')
    await wrapper.get('[data-testid="learn-clarification-submit"]').trigger('click')
    expect(wrapper.emitted('resolve')?.[0]?.[0]).toEqual({ kind: 'answer', answer: 'A checklist I can use tomorrow.' })
    await wrapper.get('[data-testid="learn-clarification-skip"]').trigger('click')
    expect(wrapper.emitted('resolve')?.[1]?.[0]).toEqual({ kind: 'skip' })
    expect(wrapper.get('[data-testid="learn-clarification-skip"]').classes()).toContain('min-h-11')
  })

  it('associates and focuses an empty/oversized answer without destroying it', async () => {
    const wrapper = await mount()
    const answer = wrapper.get('[data-testid="learn-clarification-answer"]')
    const focus = vi.spyOn(answer.element as HTMLTextAreaElement, 'focus')
    await wrapper.get('[data-testid="learn-clarification-submit"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('answer or skip')
    expect(answer.attributes('aria-invalid')).toBe('true')
    expect(answer.attributes('aria-describedby')).toBe(wrapper.get('[role="alert"]').attributes('id'))
    expect(focus).toHaveBeenCalled()
    await answer.setValue('💥'.repeat(300))
    await wrapper.get('[data-testid="learn-clarification-submit"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('1 KB')
    expect((answer.element as HTMLTextAreaElement).value).toHaveLength(600)
    expect(wrapper.emitted('resolve')).toBeUndefined()
  })

  it('shows a polite continuation-ready state without manufacturing an activity', async () => {
    const wrapper = await mount({ decision: { status: 'not_required', continuationKind: 'preparing_non_factual', reasonCode: 'declared_inputs_sufficient' } })
    expect(wrapper.get('[data-testid="learn-continuation-ready"]').text()).toContain('next step is ready')
    expect(wrapper.find('[data-testid="learn-clarification-answer"]').exists()).toBe(false)
  })
})
