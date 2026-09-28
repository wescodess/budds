import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'

const mutate = vi.fn()
const isOnline = ref(true)
mockNuxtImport('useOnlineStatus', () => () => ({ isOnline }))
mockNuxtImport('useConvexMutation', () => () => ({ mutate }))

describe('Why and bounded controls', () => {
  beforeEach(() => { mutate.mockReset().mockResolvedValue({ kind: 'ok', revision: 5, value: { fixedNextPlan: { version: 'learn-adaptive.fixed-next-plan.v1', inputOption: 'time_45', nextActivity: 'continue_with_time', availableTime: '45', difficulty: 'same', maxNewActivities: 1, authority: 'server_revalidate_at_boundary' } } }); isOnline.value = true; document.body.innerHTML = '' })

  it('keeps focus on the selected control and explains disabled options without requesting them', async () => {
    const Comp = await import('~/components/learn-adaptive/WhyControls.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { threadId: 'thread_1', activityId: 'activity_1', revision: 4,
      controls: { reasonText: { version: 'learn-adaptive.reason-text.v1', purpose: 'Prepare your next move.', text: 'This activity prepares your next move.' }, selected: null, fixedNextPlan: null,
        options: [{ key: 'example', label: 'Show an example', available: false, unavailableReason: 'evidence' },
          { key: 'harder', label: 'Make it harder', available: false, unavailableReason: 'policy' },
          { key: 'time_45', label: '45 minutes', available: true, unavailableReason: null }] } }, attachTo: document.body })
    const disclosure = wrapper.get('[data-testid="learn-why-toggle"]')
    disclosure.element.focus()
    await disclosure.trigger('click')
    expect(disclosure.attributes('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(disclosure.element)
    const disabled = wrapper.get('[data-testid="learn-override-example"]')
    expect(disabled.attributes('aria-describedby')).toBe('learn-override-reason-example')
    expect(disabled.attributes('disabled')).toBeDefined()
    await disabled.trigger('click')
    expect(wrapper.get('#learn-override-reason-harder').text()).toContain('Difficulty changes need a supported next activity')
    await wrapper.get('[data-testid="learn-override-harder"]').trigger('click')
    expect(mutate).not.toHaveBeenCalled()
    const available = wrapper.get('[data-testid="learn-override-time_45"]')
    available.element.focus()
    await available.trigger('click')
    await vi.waitFor(() => expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ option: 'time_45', expectedRevision: 4 })))
    expect(document.activeElement).toBe(available.element)
    expect(wrapper.text()).toContain('Selected: 45 minutes')
    expect(wrapper.get('[data-testid="learn-fixed-next-plan"]').text()).toContain('Next activity: Continue with 45 minutes')
    wrapper.unmount()
  })
})
