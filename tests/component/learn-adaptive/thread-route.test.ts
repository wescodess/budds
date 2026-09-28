import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const allowed = ref(true)
const canvas = ref<Record<string, unknown> | null>(null)
const diagnostic = ref<Record<string, unknown> | null>(null)
const projection = ref<Record<string, unknown> | null>(null)
const canvasPending = ref(false)
const diagnosticPending = ref(false)
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
  return { data: name === 'users:getUser' ? user : name === 'learnAdaptive:getThread' ? projection : name === 'learnAdaptiveRecovery:getDiagnosticCanvas' ? diagnostic : canvas,
    pending: name === 'learnAdaptiveRecovery:getDiagnosticCanvas' ? diagnosticPending : name === 'learnAdaptiveCanvas:getCanvas' ? canvasPending : ref(false) }
})

const path = ['~', 'pages', 'app', 'learn', 'thread', '[threadId].vue'].join('/')

describe('adaptive thread route isolation', () => {
  beforeEach(() => { allowed.value = true; canvas.value = null; diagnostic.value = null; projection.value = null; canvasPending.value = false; diagnosticPending.value = false; user.value = { _id: 'owner_1' }; requestedRoute.params.threadId = 'thread_1'; calls.mockClear() })

  it('resolves the static thread segment before the V2 learning void parameter', async () => {
    const Page = await import(path)
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
    expect(wrapper.vm.$router.resolve('/app/learn/thread/thread_1').matched.at(-1)?.path).toBe('/app/learn/thread/:threadId()')
  })

  it('queries only the owned adaptive Canvas and does not render a V1 or mission session for a missing thread', async () => {
    const Page = await import(path)
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
    expect(calls).toHaveBeenCalledWith('learnAdaptiveCanvas:getCanvas', expect.anything())
    expect(calls).toHaveBeenCalledWith('learnAdaptiveRecovery:getDiagnosticCanvas', expect.anything())
    expect(calls).toHaveBeenCalledWith('learnAdaptive:getThread', expect.anything())
    expect(wrapper.get('[data-testid="learn-adaptive-thread-unavailable"]').text()).toContain('unavailable')
    expect(wrapper.get('[data-testid="learn-adaptive-safe-destination"]').attributes('href')).toBe('/app/learn')
    expect(wrapper.find('[data-testid="learn-v2-session"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="learn-v1-course"]').exists()).toBe(false)
  })

  it('renders only the owned standalone diagnostic on the same thread route', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Check my learning', intent: 'refresh', evidenceState: 'preparing', lifecycle: 'draft', revision: 1, authorityKind: 'standalone' },
      currentActivity: null, history: [], nextAction: { kind: 'continue', label: 'Start learning', activityId: null } }
    diagnostic.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Check my learning', intent: 'refresh', revision: 1 },
      status: 'draft', evidenceState: 'preparing', decisionPending: false,
      recovery: { title: 'Your material is preparing', body: 'Record what you know.', action: 'Review source' }, activity: null }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
    expect(wrapper.find('[data-testid="learn-diagnostic-canvas"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="learn-adaptive-thread-shell"]').text()).toContain('Start learning')
    expect(wrapper.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(false)
    user.value = { _id: 'owner_2' }
    await nextTick()
    expect(wrapper.find('[data-testid="learn-diagnostic-canvas"]').exists()).toBe(false)
  })

  it('does not render a cached projection for another thread or account', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Gravity', intent: 'understand', evidenceState: 'ready', lifecycle: 'active', revision: 2, authorityKind: 'v2_mission', learningVoidId: 'void_1' },
      currentActivity: { id: 'activity_1', status: 'eligible', purpose: 'Study.' }, history: [], nextAction: { kind: 'continue', label: 'Continue', activityId: 'activity_1' } }
    canvas.value = {
      status: 'blocked', ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Gravity', intent: 'understand', revision: 2 },
      activity: { id: 'activity_1', status: 'eligible', purpose: 'Study.', reasonCode: 'ready_v2_session', primitive: null,
        fallback: { testId: 'learn-activity-fallback', title: 'Unavailable', body: 'Try later.', primaryAction: { label: 'Back to Learn' } }, requiredAction: { kind: 'continue', label: 'Continue' } },
      session: { studySessionId: 'session_1', revision: 2, contentRevision: 1, planRecordRevision: 5, blueprintRecordRevision: 3, scheduledStartAt: 0, scheduledEndAt: null, timezone: 'UTC' }, responsePrompt: null,
    }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
    expect(wrapper.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(true)
    projection.value = { ...projection.value!, thread: { ...(projection.value!.thread as Record<string, unknown>), revision: 3 } }
    await nextTick()
    expect(wrapper.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(false)
    projection.value = { ...projection.value!, thread: { ...(projection.value!.thread as Record<string, unknown>), revision: 2 } }
    await nextTick()
    expect(wrapper.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(true)
    user.value = { _id: 'owner_2' }
    await nextTick()
    expect(wrapper.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(false)
    user.value = { _id: 'owner_1' }
    requestedRoute.params.threadId = 'thread_2'
    await nextTick()
    expect(wrapper.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(false)
  })

  it('restores the server projected outcome, status, current activity, and bounded history inside one shell', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Explain gravity', intent: 'understand', evidenceState: 'ready', lifecycle: 'active', revision: 3, authorityKind: 'v2_mission', learningVoidId: 'void_1' },
      currentActivity: { id: 'activity_1', status: 'eligible', purpose: 'Explain the accepted mechanism.' },
      history: [{ id: 'previous_1', status: 'replaced', purpose: 'Explore the prior example.' }],
      nextAction: { kind: 'continue', label: 'Continue explanation', activityId: 'activity_1' } }
    canvas.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Explain gravity', intent: 'understand', revision: 3 },
      status: 'ready', activity: { id: 'activity_1', status: 'eligible', purpose: 'Explain the accepted mechanism.', reasonCode: 'ready_v2_session', primitive: null,
        fallback: { testId: 'learn-activity-fallback', title: 'Unavailable', body: 'Try later.', primaryAction: { label: 'Back to Learn' } }, requiredAction: { kind: 'continue', label: 'Continue' } },
      session: { studySessionId: 'session_1', revision: 2, contentRevision: 1, planRecordRevision: 5, blueprintRecordRevision: 3, scheduledStartAt: 0, scheduledEndAt: null, timezone: 'UTC' }, responsePrompt: null }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
    const shell = wrapper.get('[data-testid="learn-adaptive-thread-shell"]')
    expect(shell.text()).toContain('Explain gravity')
    expect(shell.text()).toContain('understand')
    expect(shell.text()).toContain('ready')
    expect(shell.text()).toContain('Continue explanation')
    expect(shell.text()).toContain('Explore the prior example.')
    expect(shell.findAll('[data-testid="learn-adaptive-canvas-frame"]')).toHaveLength(1)
    expect(shell.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(true)
    projection.value = { ...projection.value!, nextAction: { kind: 'wait', label: 'Your response is being checked', activityId: 'activity_1' } }
    await nextTick()
    expect(shell.text()).toContain('Your response is being checked')
  })

  it('keeps outcome and history visible with one safe Canvas frame when a V2 thread has no current activity', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Explain orbital motion', intent: 'understand', evidenceState: 'ready', lifecycle: 'active', revision: 2, authorityKind: 'v2_mission', learningVoidId: 'void_1' },
      currentActivity: null, history: [{ id: 'previous_1', status: 'ended', purpose: 'Explore an orbit.' }],
      nextAction: { kind: 'continue', label: 'Start learning', activityId: null } }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
    const shell = wrapper.get('[data-testid="learn-adaptive-thread-shell"]')
    expect(shell.text()).toContain('Explain orbital motion')
    expect(shell.text()).toContain('Explore an orbit.')
    expect(shell.text()).not.toContain('Start learning')
    expect(shell.findAll('[data-testid="learn-adaptive-canvas-frame"]')).toHaveLength(1)
    expect(shell.get('[data-testid="learn-adaptive-canvas-fallback"]').text()).toContain('unavailable')
    expect(shell.get('[data-testid="learn-adaptive-canvas-fallback-action"]').attributes('href')).toBe('/app/learn/void_1')
    expect(shell.findAll('a[href="/app/learn/void_1"]')).toHaveLength(1)
  })

  it('keeps the same shell and safe action when an owned activity loses Canvas dependencies', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Explain gravity', intent: 'understand', evidenceState: 'stale', lifecycle: 'active', revision: 4, authorityKind: 'v2_mission', learningVoidId: 'void_1' },
      currentActivity: { id: 'activity_1', status: 'eligible', purpose: 'Explain the evidence.' },
      history: [{ id: 'previous_1', status: 'replaced', purpose: 'Study the prior example.' }],
      nextAction: { kind: 'recover', label: 'Review evidence', activityId: 'activity_1' } }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
    const shell = wrapper.get('[data-testid="learn-adaptive-thread-shell"]')
    expect(shell.text()).toContain('Explain gravity')
    expect(shell.text()).toContain('Study the prior example.')
    expect(shell.findAll('[data-testid="learn-adaptive-canvas-frame"]')).toHaveLength(1)
    expect(shell.get('[data-testid="learn-adaptive-canvas-fallback-action"]').attributes('href')).toBe('/app/learn/void_1')
    expect(wrapper.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(false)
  })

  it('keeps the thread shell and announces Canvas loading until its matching query settles', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Explain gravity', intent: 'understand', evidenceState: 'ready', lifecycle: 'active', revision: 2, authorityKind: 'v2_mission', learningVoidId: 'void_1' },
      currentActivity: { id: 'activity_1', status: 'eligible', purpose: 'Explain the evidence.' }, history: [],
      nextAction: { kind: 'continue', label: 'Continue', activityId: 'activity_1' } }
    canvasPending.value = true
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
    const shell = wrapper.get('[data-testid="learn-adaptive-thread-shell"]')
    expect(shell.text()).toContain('Explain gravity')
    expect(shell.get('[data-testid="learn-adaptive-canvas-loading"]').attributes('role')).toBe('status')
    expect(shell.get('[data-testid="learn-adaptive-canvas-loading"]').text()).toContain('Loading')
    expect(shell.find('[data-testid="learn-adaptive-canvas-fallback"]').exists()).toBe(false)

    canvas.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Explain gravity', intent: 'understand', revision: 2 },
      status: 'blocked', activity: { id: 'activity_1', status: 'eligible', purpose: 'Explain the evidence.', reasonCode: 'ready_v2_session', primitive: null,
        fallback: { testId: 'learn-activity-fallback', title: 'Unavailable', body: 'Try later.', primaryAction: { label: 'Back to Learn' } }, requiredAction: { kind: 'continue', label: 'Continue' } },
      session: { studySessionId: 'session_1', revision: 2, contentRevision: 1, planRecordRevision: 5, blueprintRecordRevision: 3, scheduledStartAt: 0, scheduledEndAt: null, timezone: 'UTC' }, responsePrompt: null }
    canvasPending.value = false
    await nextTick()
    expect(shell.find('[data-testid="learn-adaptive-canvas-loading"]').exists()).toBe(false)
    expect(shell.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(true)
    canvas.value = null
    await nextTick()
    expect(shell.find('[data-testid="learn-adaptive-canvas-fallback"]').exists()).toBe(true)
  })

  it('uses only the standalone detail query to decide whether its frame is loading', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Check my learning', intent: 'refresh', evidenceState: 'none', lifecycle: 'draft', revision: 1, authorityKind: 'standalone' },
      currentActivity: null, history: [], nextAction: { kind: 'clarify', label: 'Continue on Learn', activityId: null } }
    canvasPending.value = true
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
    const shell = wrapper.get('[data-testid="learn-adaptive-thread-shell"]')
    expect(shell.find('[data-testid="learn-adaptive-canvas-loading"]').exists()).toBe(false)
    expect(shell.get('[data-testid="learn-adaptive-canvas-fallback-action"]').attributes('href')).toBe('/app/learn')
    diagnosticPending.value = true
    await nextTick()
    expect(shell.find('[data-testid="learn-adaptive-canvas-fallback"]').exists()).toBe(false)
    expect(shell.get('[data-testid="learn-adaptive-canvas-loading"]').attributes('aria-live')).toBe('polite')
  })

  it('keeps denied and rollback states on a named safe destination without redirecting the route', async () => {
    const Page = await import(path)
    allowed.value = false
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
    expect(wrapper.get('[data-testid="learn-adaptive-thread-denied"]').text()).toContain('not available')
    expect(wrapper.get('[data-testid="learn-adaptive-safe-destination"]').attributes('href')).toBe('/app/learn')
    allowed.value = true
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Gravity', intent: 'understand', evidenceState: 'ready', lifecycle: 'rollback', revision: 3, authorityKind: 'v2_mission', learningVoidId: 'void_1' },
      currentActivity: null, history: [], nextAction: { kind: 'return_to_learn', label: 'Back to Learn', activityId: null } }
    await nextTick()
    expect(wrapper.get('[data-testid="learn-adaptive-thread-unavailable"]').text()).toContain('unavailable')
    expect(wrapper.get('[data-testid="learn-adaptive-safe-destination"]').attributes('href')).toBe('/app/learn/void_1')
  })
})
