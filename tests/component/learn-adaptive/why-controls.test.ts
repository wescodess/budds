import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { prepareAdaptiveCommand } from '~~/shared/adaptive-command-authority'

const mutate = vi.fn()
const isOnline = ref(true)
const prepareOverride = (idempotencyKey: string) => prepareAdaptiveCommand({ userId: 'owner_1', commandName: 'applyOverride', targetId: 'thread_1',
  expectedRevision: 4, idempotencyKey, payload: { activityId: 'activity_1', option: 'time_45' } })
const mountControls = async () => {
  const Comp = await import('~/components/learn-adaptive/WhyControls.vue')
  const wrapper = await mountSuspended(Comp.default, { props: { threadId: 'thread_1', activityId: 'activity_1', revision: 4,
    controls: { reasonText: { version: 'learn-adaptive.reason-text.v1', purpose: 'Prepare your next move.', text: 'This activity prepares your next move.' }, selected: null, fixedNextPlan: null,
      options: [{ key: 'time_45', label: '45 minutes', available: true, unavailableReason: null }, { key: 'time_15', label: '15 minutes', available: true, unavailableReason: null }] } }, attachTo: document.body })
  await wrapper.get('[data-testid="learn-why-toggle"]').trigger('click')
  return wrapper
}
mockNuxtImport('useOnlineStatus', () => () => ({ isOnline }))
mockNuxtImport('useConvexMutation', () => () => ({ mutate }))

describe('Why and bounded controls', () => {
  beforeEach(() => { mutate.mockReset().mockResolvedValue({ kind: 'ok', revision: 5, value: { fixedNextPlan: { version: 'learn-adaptive.fixed-next-plan.v1', inputOption: 'time_45', nextActivity: 'continue_with_time', availableTime: '45', difficulty: 'same', maxNewActivities: 1, authority: 'server_revalidate_at_boundary' } } }); isOnline.value = true; document.body.innerHTML = '' })
  afterEach(() => { vi.unstubAllGlobals() })

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

  it.each([['randomUUID', false], ['the fallback generator', true]])('sends an adjustment key the command validator accepts using %s', async (_generator, fallback) => {
    if (fallback) vi.stubGlobal('crypto', { subtle: crypto.subtle })
    const wrapper = await mountControls()
    await wrapper.get('[data-testid="learn-override-time_45"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Selected: 45 minutes'))
    const idempotencyKey = mutate.mock.calls[0]?.[0].idempotencyKey
    expect(idempotencyKey).toMatch(fallback ? /^adaptive-override-\d+-[a-z0-9]+$/ : /^adaptive-override-[0-9a-f-]{36}$/)
    await expect(prepareOverride(idempotencyKey)).resolves.toMatchObject({ idempotencyKeyHash: expect.stringMatching(/^sha256:/) })
    wrapper.unmount()
  })

  it('reports an unconfirmed adjustment safely and retries it with the same key', async () => {
    mutate.mockResolvedValueOnce(undefined)
    const wrapper = await mountControls()
    await wrapper.get('[data-testid="learn-override-time_45"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toBe('Could not save this choice. Try again.'))
    expect(wrapper.text()).not.toContain('Selected: 45 minutes')
    expect(wrapper.find('[data-testid="learn-fixed-next-plan"]').exists()).toBe(false)
    expect(wrapper.emitted('revision')).toBeUndefined()
    await wrapper.get('[data-testid="learn-override-time_45"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Selected: 45 minutes'))
    const [first, retry] = mutate.mock.calls.map(([input]) => input)
    expect(retry).toEqual(first)
    expect(await prepareOverride(retry.idempotencyKey)).toEqual(await prepareOverride(first.idempotencyKey))
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.emitted('revision')).toEqual([[5]])
    wrapper.unmount()
  })

  it('uses a new key when an unconfirmed adjustment is replaced by another choice', async () => {
    mutate.mockResolvedValueOnce(undefined)
    const wrapper = await mountControls()
    await wrapper.get('[data-testid="learn-override-time_45"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').exists()).toBe(true))
    await wrapper.get('[data-testid="learn-override-time_15"]').trigger('click')
    await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(2))
    expect(mutate.mock.calls[1]?.[0].idempotencyKey).not.toBe(mutate.mock.calls[0]?.[0].idempotencyKey)
    wrapper.unmount()
  })
})
