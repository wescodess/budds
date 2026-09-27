import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const allowed = ref(true)
const canvas = ref<Record<string, unknown> | null>(null)
const diagnostic = ref<Record<string, unknown> | null>(null)
const user = ref<{ _id: string } | null>({ _id: 'owner_1' })
const requestedRoute = reactive({ params: { threadId: 'thread_1' } })
const calls = vi.fn()

mockNuxtImport('useLearnAdaptiveAccess', () => () => ({ allowed, checkingAccess: ref(false) }))
mockNuxtImport('useRoute', () => () => requestedRoute)
mockNuxtImport('useOnlineStatus', () => () => ({ isOnline: ref(true) }))
mockNuxtImport('useConvexMutation', () => () => ({ mutate: vi.fn() }))
mockNuxtImport('useConvexAction', () => () => ({ mutate: vi.fn() }))
mockNuxtImport('useConvexQuery', () => (reference: never, args: unknown) => {
  const name = getFunctionName(reference)
  calls(name, args)
  return { data: name === 'users:getUser' ? user : name === 'learnAdaptiveRecovery:getDiagnosticCanvas' ? diagnostic : canvas, pending: ref(false) }
})

const path = ['~', 'pages', 'app', 'learn', 'thread', '[threadId].vue'].join('/')

describe('adaptive thread route isolation', () => {
  beforeEach(() => { allowed.value = true; canvas.value = null; diagnostic.value = null; user.value = { _id: 'owner_1' }; requestedRoute.params.threadId = 'thread_1'; calls.mockClear() })

  it('queries only the owned adaptive Canvas and does not render a V1 or mission session for a missing thread', async () => {
    const Page = await import(path)
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
    expect(calls).toHaveBeenCalledWith('learnAdaptiveCanvas:getCanvas', expect.anything())
    expect(calls).toHaveBeenCalledWith('learnAdaptiveRecovery:getDiagnosticCanvas', expect.anything())
    expect(wrapper.get('[data-testid="learn-adaptive-thread-unavailable"]').text()).toContain('unavailable')
    expect(wrapper.find('[data-testid="learn-v2-session"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="learn-v1-course"]').exists()).toBe(false)
  })

  it('renders only the owned standalone diagnostic on the same thread route', async () => {
    const Page = await import(path)
    diagnostic.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Check my learning', intent: 'refresh', revision: 1 },
      status: 'draft', evidenceState: 'preparing', decisionPending: false,
      recovery: { title: 'Your material is preparing', body: 'Record what you know.', action: 'Review source' }, activity: null }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
    expect(wrapper.find('[data-testid="learn-diagnostic-canvas"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(false)
    user.value = { _id: 'owner_2' }
    await nextTick()
    expect(wrapper.find('[data-testid="learn-diagnostic-canvas"]').exists()).toBe(false)
  })

  it('does not render a cached projection for another thread or account', async () => {
    const Page = await import(path)
    canvas.value = {
      status: 'blocked', ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Gravity', intent: 'understand', revision: 2 },
      activity: { id: 'activity_1', status: 'eligible', purpose: 'Study.', reasonCode: 'ready_v2_session', primitive: null,
        fallback: { testId: 'learn-activity-fallback', title: 'Unavailable', body: 'Try later.', primaryAction: { label: 'Back to Learn' } }, requiredAction: { kind: 'continue', label: 'Continue' } },
      session: { studySessionId: 'session_1', revision: 2, contentRevision: 1, planRecordRevision: 5, blueprintRecordRevision: 3, scheduledStartAt: 0, scheduledEndAt: null, timezone: 'UTC' }, responsePrompt: null,
    }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
    expect(wrapper.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(true)
    user.value = { _id: 'owner_2' }
    await nextTick()
    expect(wrapper.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(false)
    user.value = { _id: 'owner_1' }
    requestedRoute.params.threadId = 'thread_2'
    await nextTick()
    expect(wrapper.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(false)
  })
})
