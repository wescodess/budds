import { beforeEach, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const decide = vi.fn()
const reportRenderFailure = vi.fn()
const isOnline = ref(true)
mockNuxtImport('useOnlineStatus', () => () => ({ isOnline }))
mockNuxtImport('useConvexMutation', () => (reference: never) => ({ mutate: getFunctionName(reference)?.includes('reportRenderFailure') ? reportRenderFailure : decide }))

const primitive = {
  contractVersion: 'learn-adaptive.activity-contract.v1', rendererVersion: 'learn-adaptive.renderer.v1',
  type: 'reflection_next_move', action: 'accept_next_move', testId: 'learn-primitive-reflection-next-move',
  props: { feedback: 'You completed the guided example.', nextMove: 'Try one independent example.', allowedDecisions: ['accept', 'override', 'end'] },
}
const canvas = {
  ownerId: 'owner_1', status: 'eligible', decision: null,
  thread: { id: 'thread_1', revision: 3, outcome: 'Learn deliberately', lifecycle: 'active' },
  activity: { id: 'reflection_1', planRevision: 1, status: 'eligible', purpose: 'Choose what to do next.',
    reason: 'You have finished this guided step.', primitive,
    fallback: { title: 'Activity unavailable', body: 'Try later.', testId: 'learn-activity-fallback', primaryAction: { label: 'Continue safely' } } },
}

beforeEach(() => { decide.mockReset().mockResolvedValue({ kind: 'ok', revision: 4, value: { outcome: 'accepted' } }); reportRenderFailure.mockReset().mockResolvedValue({ recorded: true }); isOnline.value = true })

it('mounts reflection ready, completed, mobile, and version fallback fixtures with accessible actions', async () => {
  const Component = await import('~/components/learn-adaptive/ReflectionNextMove.vue')
  const ready = await mountSuspended(Component.default, { props: { canvas }, attachTo: document.body })
  expect(ready.get('[data-testid="learn-primitive-reflection-next-move"]').attributes('aria-labelledby')).toBe('learn-reflection-title')
  expect(ready.get('[data-testid="learn-reflection-accept"]').text()).toBe('Accept next move')
  ready.unmount()

  const completedCanvas = { ...canvas, status: 'completed', decision: { outcome: 'accepted', nextMove: 'Try one independent example.', decidedAt: 2 } }
  const completed = await mountSuspended(Component.default, { props: { canvas: completedCanvas }, attachTo: document.body })
  expect(completed.get('[data-testid="learn-reflection-completed"]').attributes('role')).toBe('status')
  expect(completed.get('[data-testid="learn-reflection-completed"]').text()).toContain('Next move accepted')
  completed.unmount()

  const mobile = await mountSuspended(Component.default, { props: { canvas }, attachTo: document.body })
  expect(mobile.get('[data-testid="learn-reflection-accept"]').classes()).toContain('w-full')
  expect(mobile.get('[data-testid="learn-reflection-accept"]').classes()).toContain('min-h-11')
  mobile.unmount()

  const fallback = await mountSuspended(Component.default, { props: { canvas: { ...canvas,
    activity: { ...canvas.activity, primitive: { ...primitive, rendererVersion: 'learn-adaptive.renderer.v2' } } } }, attachTo: document.body })
  expect(fallback.get('[data-testid="learn-activity-fallback"]').attributes('role')).toBe('alert')
  expect(fallback.find('[data-testid="learn-reflection-accept"]').exists()).toBe(false)
  fallback.unmount()
})

it('renders persisted reflection content and bounded keyboard actions without a mastery claim', async () => {
  const Component = await import('~/components/learn-adaptive/ReflectionNextMove.vue')
  const wrapper = await mountSuspended(Component.default, { props: { canvas } })
  const region = wrapper.get('[data-testid="learn-primitive-reflection-next-move"]')
  expect(region.attributes('aria-labelledby')).toBe('learn-reflection-title')
  expect(region.text()).toContain('You have finished this guided step.')
  expect(region.text()).toContain('You completed the guided example.')
  expect(region.text()).toContain('Try one independent example.')
  expect(region.text()).toContain('does not record mastery')
  expect(wrapper.get('[data-testid="learn-reflection-accept"]').classes()).toContain('min-h-11')
  expect(wrapper.get('[data-testid="learn-reflection-override"]').element).toBeInstanceOf(HTMLButtonElement)
  expect(wrapper.get('[data-testid="learn-reflection-end"]').text()).toContain('End this thread')
  const actions = [...region.element.querySelectorAll('button')]
  expect(actions.map(button => button.textContent?.trim())).toEqual(['Accept next move', 'Choose another', 'End this thread'])
  expect(actions.every(button => button.className.includes('min-h-11'))).toBe(true)
  expect(actions.every(button => button.className.includes('focus-visible:ring-2'))).toBe(true)
  expect(actions.every(button => button.className.includes('w-full'))).toBe(true)
  wrapper.unmount()
})

it('submits only the selected closed decision and waits for authoritative completion', async () => {
  const Component = await import('~/components/learn-adaptive/ReflectionNextMove.vue')
  const wrapper = await mountSuspended(Component.default, { props: { canvas }, attachTo: document.body })
  await wrapper.get('[data-testid="learn-reflection-accept"]').trigger('click')
  await vi.waitFor(() => expect(decide).toHaveBeenCalledWith({ threadId: 'thread_1', activityId: 'reflection_1', decision: 'accept', expectedRevision: 3, idempotencyKey: expect.stringMatching(/^reflection-/) }))
  expect(wrapper.get('[role="status"]').text()).toContain('Choice saved')
  expect(wrapper.find('[data-testid="learn-reflection-completed"]').exists()).toBe(false)
  const completed = { ...canvas, status: 'completed', decision: { outcome: 'accepted', nextMove: 'Try one independent example.', decidedAt: 2 },
    thread: { ...canvas.thread, revision: 4 }, activity: { ...canvas.activity, status: 'ended' } }
  await wrapper.setProps({ canvas: completed })
  expect(wrapper.get('[data-testid="learn-primitive-reflection-next-move"]').attributes('aria-labelledby')).toBe('learn-reflection-title')
  expect(wrapper.get('[data-testid="learn-reflection-completed"] #learn-reflection-title').text()).toContain('Next move accepted')
  expect(wrapper.get('[data-testid="learn-reflection-completed-action"]').text()).toBe('Try one independent example.')
  await vi.waitFor(() => expect(document.activeElement).toBe(wrapper.get('[data-testid="learn-reflection-completed"] h2').element))
  wrapper.unmount()
})

it.each([
  ['overridden', 'You chose a different next move.'],
  ['ended', 'Thread ended.'],
] as const)('renders the authoritative %s completed state with a text label', async (outcome, label) => {
  const Component = await import('~/components/learn-adaptive/ReflectionNextMove.vue')
  const completed = { ...canvas, status: 'completed', decision: { outcome, nextMove: 'Try one independent example.', decidedAt: 2 },
    thread: { ...canvas.thread, revision: 4, lifecycle: outcome === 'ended' ? 'ended' : 'active' }, activity: { ...canvas.activity, status: 'ended' } }
  const wrapper = await mountSuspended(Component.default, { props: { canvas: completed }, attachTo: document.body })
  expect(wrapper.get('[data-testid="learn-reflection-completed"]').text()).toContain(label)
  expect(wrapper.text()).toContain('not a mastery result')
  await vi.waitFor(() => expect(document.activeElement).toBe(wrapper.get('[data-testid="learn-reflection-completed"] h2').element))
  wrapper.unmount()
})

it('renders deterministic fallback for a mismatched action or extra primitive field', async () => {
  const Component = await import('~/components/learn-adaptive/ReflectionNextMove.vue')
  const invalid = { ...canvas, activity: { ...canvas.activity, primitive: { ...primitive, action: 'share_artifact', generatedMarkup: '<button>Run</button>' } } }
  const wrapper = await mountSuspended(Component.default, { props: { canvas: invalid as never }, attachTo: document.body })
  expect(wrapper.get('[data-testid="learn-activity-fallback"]').text()).toContain('action is not supported')
  expect(wrapper.find('[data-testid="learn-reflection-accept"]').exists()).toBe(false)
  await vi.waitFor(() => expect(document.activeElement).toBe(wrapper.get('[data-testid="learn-activity-fallback"] button').element))
  await vi.waitFor(() => expect(reportRenderFailure).toHaveBeenCalledWith({ threadId: 'thread_1', activityId: 'reflection_1', expectedPlanRevision: 1, reasonCode: 'unsupported_action' }))
  wrapper.unmount()
})

it('keeps decisions unavailable offline and announces a non-color state', async () => {
  isOnline.value = false
  const Component = await import('~/components/learn-adaptive/ReflectionNextMove.vue')
  const wrapper = await mountSuspended(Component.default, { props: { canvas } })
  expect(wrapper.get('[role="status"]').text()).toContain('offline')
  expect((wrapper.get('[data-testid="learn-reflection-accept"]').element as HTMLButtonElement).disabled).toBe(true)
  wrapper.unmount()
})
