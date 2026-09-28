import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const allowed = ref(true)
const canvas = ref<Record<string, unknown> | null>(null)
const diagnostic = ref<Record<string, unknown> | null>(null)
const artifact = ref<Record<string, unknown> | null>(null)
const evidence = ref<Record<string, unknown> | null>(null)
const projection = ref<Record<string, unknown> | null>(null)
const canvasPending = ref(false)
const diagnosticPending = ref(false)
const user = ref<{ _id: string } | null>({ _id: 'owner_1' })
const requestedRoute = reactive({ params: { threadId: 'thread_1' }, query: { activity: undefined as string | undefined } })
const calls = vi.fn()
const mutationCalls = vi.fn().mockResolvedValue({ kind: 'ok' })

mockNuxtImport('useLearnAdaptiveAccess', () => () => ({ allowed, checkingAccess: ref(false) }))
mockNuxtImport('useRoute', () => () => requestedRoute)
mockNuxtImport('useOnlineStatus', () => () => ({ isOnline: ref(true) }))
mockNuxtImport('useConvexMutation', () => () => ({ mutate: mutationCalls }))
mockNuxtImport('useConvexAction', () => () => ({ mutate: vi.fn() }))
mockNuxtImport('useConvexQuery', () => (reference: never, args: unknown) => {
  const name = getFunctionName(reference)
  calls(name, args)
  return { data: name === 'users:getUser' ? user : name === 'learnAdaptive:getThread' ? projection : name === 'learnAdaptiveRecovery:getDiagnosticCanvas' ? diagnostic : name === 'learnAdaptiveEvidence:getThreadActivityEvidence' ? evidence : name === 'learnAdaptive:getArtifactCanvas' ? artifact : name === 'learnAdaptive:listThreadArtifacts' ? ref([]) : canvas,
    pending: name === 'learnAdaptiveRecovery:getDiagnosticCanvas' ? diagnosticPending : name === 'learnAdaptiveCanvas:getCanvas' ? canvasPending : ref(false) }
})

const path = ['~', 'pages', 'app', 'learn', 'thread', '[threadId].vue'].join('/')

describe('adaptive thread route isolation', () => {
  beforeEach(() => { allowed.value = true; canvas.value = null; diagnostic.value = null; artifact.value = null; evidence.value = null; projection.value = null; canvasPending.value = false; diagnosticPending.value = false; user.value = { _id: 'owner_1' }; requestedRoute.params.threadId = 'thread_1'; requestedRoute.query.activity = undefined; calls.mockClear(); mutationCalls.mockClear(); sessionStorage.clear() })

  it('routes a current artifact workspace from its owner-bound projection', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Build a plan', intent: 'build', evidenceState: 'none', lifecycle: 'active', revision: 3, authorityKind: 'standalone' },
      currentActivity: { id: 'artifact_1', status: 'eligible', activityClass: 'non_factual', purpose: 'Build a plan.' }, history: [], nextAction: { kind: 'save_artifact', label: 'Save artifact', activityId: 'artifact_1' } }
    artifact.value = { ownerId: 'owner_1', status: 'eligible', thread: { id: 'thread_1', revision: 3, outcome: 'Build a plan' }, activity: { id: 'artifact_1', planRevision: 1, status: 'eligible',
      primitive: { contractVersion: 'learn-adaptive.activity-contract.v1', rendererVersion: 'learn-adaptive.renderer.v1', type: 'artifact_workspace', action: 'save_artifact', testId: 'learn-primitive-artifact-workspace', props: { prompt: 'Build a plan.', artifactKind: 'plan', starterText: 'Goal:' } },
      fallback: { title: 'Unavailable', body: 'Try later.', testId: 'learn-activity-fallback', primaryAction: { label: 'Continue safely' } } } }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
    expect(wrapper.get('[data-testid="learn-primitive-artifact-workspace"]').text()).toContain('Build a plan.')
    wrapper.unmount()
  })

  it('keeps an unsent diagnostic mounted through a newer thread revision when storage is unavailable', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage unavailable') })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable') })
    try {
      const Page = await import(path)
      projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Check my learning', intent: 'refresh', evidenceState: 'none', lifecycle: 'active', revision: 2, authorityKind: 'standalone' },
        currentActivity: { id: 'diagnostic:thread_1', status: 'eligible', purpose: 'Record your starting point.' }, history: [],
        nextAction: { kind: 'submit_response', label: 'Save response', activityId: 'diagnostic:thread_1' } }
      diagnostic.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Check my learning', intent: 'refresh', revision: 2 }, status: 'eligible', evidenceState: 'none', decisionPending: false,
        recovery: { title: 'Your starting point', body: 'Record what you know.', action: 'Back to Learn' },
        activity: { id: 'diagnostic:thread_1', status: 'eligible', planRevision: 1, primitive: { contractVersion: 'learn-adaptive.activity-contract.v1', rendererVersion: 'learn-adaptive.renderer.v1', type: 'diagnostic_prompt', action: 'submit_response', testId: 'learn-primitive-diagnostic-prompt', props: { prompt: 'What do you know?', responseFormat: 'short_text', assistance: 'none' } }, response: null,
          requiredAction: { kind: 'submit_response', label: 'Save response' } } }
      const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
      await wrapper.get('[data-testid="learn-diagnostic-response"]').setValue('Unsent answer in memory.')
      projection.value = { ...projection.value!, thread: { ...(projection.value!.thread as Record<string, unknown>), revision: 3 } }
      await nextTick()
      expect((wrapper.get('[data-testid="learn-diagnostic-response"]').element as HTMLTextAreaElement).value).toBe('Unsent answer in memory.')
      await wrapper.get('[data-testid="learn-diagnostic-submit"]').trigger('click')
      await vi.waitFor(() => expect(mutationCalls).toHaveBeenCalledWith(expect.objectContaining({ response: 'Unsent answer in memory.', expectedRevision: 3 })))
      wrapper.unmount()
    }
    finally { getItem.mockRestore(); setItem.mockRestore() }
  })

  it('keeps an unsent diagnostic mounted through a newer Canvas revision when storage is unavailable', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage unavailable') })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable') })
    try {
      const Page = await import(path)
      projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Check my learning', intent: 'refresh', evidenceState: 'none', lifecycle: 'active', revision: 3, authorityKind: 'standalone' },
        currentActivity: { id: 'diagnostic:thread_1', status: 'eligible', purpose: 'Record your starting point.' }, history: [],
        nextAction: { kind: 'submit_response', label: 'Save response', activityId: 'diagnostic:thread_1' } }
      diagnostic.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Check my learning', intent: 'refresh', revision: 3 }, status: 'eligible', evidenceState: 'none', decisionPending: false,
        recovery: { title: 'Your starting point', body: 'Record what you know.', action: 'Back to Learn' },
        activity: { id: 'diagnostic:thread_1', status: 'eligible', planRevision: 1, primitive: { contractVersion: 'learn-adaptive.activity-contract.v1', rendererVersion: 'learn-adaptive.renderer.v1', type: 'diagnostic_prompt', action: 'submit_response', testId: 'learn-primitive-diagnostic-prompt', props: { prompt: 'What do you know?', responseFormat: 'short_text', assistance: 'none' } }, response: null,
          requiredAction: { kind: 'submit_response', label: 'Save response' } } }
      const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
      await wrapper.get('[data-testid="learn-diagnostic-response"]').setValue('Still unsent after Canvas update.')
      diagnostic.value = { ...diagnostic.value!, thread: { ...(diagnostic.value!.thread as Record<string, unknown>), revision: 4 } }
      await nextTick()
      expect((wrapper.get('[data-testid="learn-diagnostic-response"]').element as HTMLTextAreaElement).value).toBe('Still unsent after Canvas update.')
      await wrapper.get('[data-testid="learn-diagnostic-submit"]').trigger('click')
      await vi.waitFor(() => expect(mutationCalls).toHaveBeenCalledWith(expect.objectContaining({ response: 'Still unsent after Canvas update.', expectedRevision: 4 })))
      wrapper.unmount()
    }
    finally { getItem.mockRestore(); setItem.mockRestore() }
  })

  it('restores a URL-selected historical activity while retaining the mounted current Canvas for back/forward', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Gravity', intent: 'understand', evidenceState: 'ready', lifecycle: 'active', revision: 2, authorityKind: 'v2_mission', learningVoidId: 'void_1' },
      currentActivity: { id: 'activity_2', status: 'started', purpose: 'Current explanation.' }, history: [{ id: 'activity_1', status: 'replaced', purpose: 'Earlier explanation.' }],
      nextAction: { kind: 'continue', label: 'Continue', activityId: 'activity_2' } }
    canvas.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Gravity', intent: 'understand', revision: 2 }, status: 'ready',
      activity: { id: 'activity_2', status: 'started', purpose: 'Current explanation.', reasonCode: 'ready_v2_session', primitive: null,
        fallback: { testId: 'learn-activity-fallback', title: 'Unavailable', body: 'Try later.', primaryAction: { label: 'Back to Learn' } }, requiredAction: { kind: 'continue', label: 'Continue' } },
      session: { studySessionId: 'session_1', revision: 2, contentRevision: 1, planRecordRevision: 5, blueprintRecordRevision: 3, scheduledStartAt: 0, scheduledEndAt: null, timezone: 'UTC' }, responsePrompt: null }
    requestedRoute.query.activity = 'activity_1'
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1?activity=activity_1' })
    expect(wrapper.get('[data-testid="learn-selected-history"]').text()).toContain('Earlier explanation.')
    expect(wrapper.get('[data-testid="learn-adaptive-canvas"]').element.parentElement?.getAttribute('style')).toContain('display: none')
    expect(wrapper.get('[data-testid="learn-current-activity-link"]').attributes('href')).toBe('/app/learn/thread/thread_1')
    requestedRoute.query.activity = undefined
    await nextTick()
    expect(wrapper.find('[data-testid="learn-selected-history"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="learn-adaptive-canvas"]').element.parentElement?.getAttribute('style') ?? '').not.toContain('display: none')
  })

  it('binds the mounted Evidence drawer to the URL-selected owned activity', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Gravity', intent: 'understand', evidenceState: 'stale', lifecycle: 'active', revision: 2, authorityKind: 'v2_mission', learningVoidId: 'void_1' },
      currentActivity: { id: 'activity_2', status: 'blocked', purpose: 'Current explanation.' }, history: [{ id: 'activity_1', status: 'replaced', purpose: 'Earlier explanation.' }],
      nextAction: { kind: 'recover', label: 'Review your learning mission', activityId: 'activity_2' } }
    requestedRoute.query.activity = 'activity_1'
    evidence.value = { ownerId: 'owner_1', threadId: 'thread_1', kind: 'factual', activityId: 'activity_1', eligibility: 'historical', readOnly: true, integrityState: 'stale',
      claims: [{ claimId: 'claim_1', claimText: 'Gravity attracts masses.', claimStatus: 'unknown', integrityState: 'stale',
        source: { origin: 'user_url', locator: 'page:2', sourceSnapshotId: 'source_1', sourceSnapshotRevision: 2, sourceRecordRevision: 4 } }] }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1?activity=activity_1', attachTo: document.body })
    const args = calls.mock.calls.find(([name]) => name === 'learnAdaptiveEvidence:getThreadActivityEvidence')?.[1] as Ref<{ threadId: string, activityId: string }>
    expect(args.value).toEqual({ threadId: 'thread_1', activityId: 'activity_1' })
    await wrapper.get('[data-testid="learn-evidence-open"]').trigger('click')
    expect(document.querySelector('[data-testid="learn-evidence-drawer"]')?.textContent).toContain('Past activity, read-only')
    expect(document.querySelector('[data-testid="learn-evidence-drawer"]')?.textContent).toContain('page:2')
    requestedRoute.query.activity = undefined
    await nextTick()
    expect(args.value).toEqual({ threadId: 'thread_1', activityId: 'activity_2' })
    wrapper.unmount()
  })

  it.each([
    { ownerId: 'owner_2', threadId: 'thread_1' },
    { ownerId: 'https://auth.example.com|owner_1', threadId: 'thread_1' },
    { ownerId: 'owner_1', threadId: 'thread_2' },
  ])('does not render a cached Evidence collision from $ownerId/$threadId', async identity => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Gravity', intent: 'understand', evidenceState: 'ready', lifecycle: 'active', revision: 2, authorityKind: 'v2_mission', learningVoidId: 'void_1' },
      currentActivity: { id: 'activity_1', status: 'eligible', purpose: 'Explain gravity.' }, history: [], nextAction: { kind: 'continue', label: 'Continue', activityId: 'activity_1' } }
    evidence.value = { ...identity, activityId: 'activity_1', kind: 'factual', eligibility: 'eligible', readOnly: false, integrityState: 'accepted',
      claims: [{ claimId: 'claim_1', claimText: 'Wrong cached claim', claimStatus: 'fact', integrityState: 'accepted',
        source: { origin: 'user_url', locator: 'page:1', sourceSnapshotId: 'source_1', sourceSnapshotRevision: 1, sourceRecordRevision: 1 } }] }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1', attachTo: document.body })
    await wrapper.get('[data-testid="learn-evidence-open"]').trigger('click')
    const drawer = document.querySelector('[data-testid="learn-evidence-drawer"]') as HTMLElement
    expect(drawer.textContent).toContain('Evidence details are unavailable')
    expect(drawer.textContent).not.toContain('Wrong cached claim')
    wrapper.unmount()
  })

  it('shows only safe recovery when source authority is unavailable but a retained Canvas is ready', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Gravity', intent: 'understand', evidenceState: 'unavailable', lifecycle: 'active', revision: 2, authorityKind: 'v2_mission', learningVoidId: 'void_1' },
      currentActivity: { id: 'activity_2', status: 'started', purpose: 'Current explanation.' }, history: [],
      nextAction: { kind: 'recover', label: 'Review your learning mission', activityId: 'activity_2' } }
    canvas.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Gravity', intent: 'understand', revision: 2 }, status: 'ready',
      activity: { id: 'activity_2', status: 'started', purpose: 'Current explanation.', reasonCode: 'ready_v2_session', primitive: null,
        fallback: { testId: 'learn-activity-fallback', title: 'Unavailable', body: 'Try later.', primaryAction: { label: 'Back to Learn' } }, requiredAction: { kind: 'continue', label: 'Continue' } },
      session: { studySessionId: 'session_1', revision: 2, contentRevision: 1, planRecordRevision: 5, blueprintRecordRevision: 3, scheduledStartAt: 0, scheduledEndAt: null, timezone: 'UTC' }, responsePrompt: null }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
    expect(wrapper.get('[data-testid="learn-current-source-recovery"]').text()).toContain('unavailable')
    expect(wrapper.get('[data-testid="learn-current-source-recovery"] a').attributes('href')).toBe('/app/learn/void_1')
    expect(wrapper.get('[data-testid="learn-adaptive-canvas"]').element.parentElement?.getAttribute('style')).toContain('display: none')
  })

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
    expect(wrapper.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(true)
    canvas.value = { ...canvas.value!, thread: { ...(canvas.value!.thread as Record<string, unknown>), revision: 4 } }
    await nextTick()
    expect(wrapper.find('[data-testid="learn-adaptive-canvas"]').exists()).toBe(true)
    canvas.value = { ...canvas.value!, thread: { ...(canvas.value!.thread as Record<string, unknown>), revision: 2 } }
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

  it('opens the canonical Evidence drawer from a cited explanation source and returns focus', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Explain gravity', intent: 'understand', evidenceState: 'ready', lifecycle: 'active', revision: 2, authorityKind: 'v2_mission', learningVoidId: 'void_1' },
      currentActivity: { id: 'activity_1', status: 'started', purpose: 'Study a supported explanation.' }, history: [], nextAction: { kind: 'continue', label: 'Continue', activityId: 'activity_1' } }
    canvas.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Explain gravity', intent: 'understand', revision: 2 }, status: 'started',
      activity: { id: 'activity_1', status: 'started', purpose: 'Study a supported explanation.', reasonCode: 'ready_v2_session', planRevision: 1,
        evidenceScope: { version: 'learn-adaptive.canvas-evidence-scope.v1', integrityState: 'accepted', sourceRefs: ['source_1'] },
        primitive: { contractVersion: 'learn-adaptive.activity-contract.v1', rendererVersion: 'learn-adaptive.renderer.v1', type: 'cited_explanation', action: 'continue', testId: 'learn-primitive-cited-explanation', props: { heading: 'Gravity', explanation: 'Gravity attracts masses.', sourceRefs: ['source_1'] } },
        fallback: { testId: 'learn-activity-fallback', title: 'Unavailable', body: 'Try later.', primaryAction: { label: 'Back to Learn' } }, requiredAction: { kind: 'continue', label: 'Continue' } },
      session: { studySessionId: 'session_1', revision: 2, contentRevision: 1, planRecordRevision: 5, blueprintRecordRevision: 3, scheduledStartAt: 0, scheduledEndAt: null, timezone: 'UTC' }, responsePrompt: 'Explain why an apple falls.' }
    evidence.value = { ownerId: 'owner_1', threadId: 'thread_1', kind: 'factual', activityId: 'activity_1', eligibility: 'eligible', readOnly: false, integrityState: 'accepted',
      claims: [{ claimId: 'claim_1', claimText: 'Gravity attracts masses.', claimStatus: 'fact', integrityState: 'accepted', source: { origin: 'user_url', locator: 'page:1', sourceSnapshotId: 'source_1', sourceSnapshotRevision: 1, sourceRecordRevision: 1 } }] }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1', attachTo: document.body })
    const source = wrapper.get('[data-testid="learn-canvas-source-1"]')
    await source.trigger('click')
    const drawer = document.querySelector('[data-testid="learn-evidence-drawer"]') as HTMLElement
    expect(drawer.getAttribute('role')).toBe('dialog')
    expect(drawer.textContent).toContain('Gravity attracts masses.')
    expect(drawer.textContent).toContain('page:1')
    ;(drawer.querySelector('[data-testid="learn-evidence-close"]') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(document.activeElement).toBe(source.element))
    wrapper.unmount()
  })

  it('shows a scored representative result and named V2 next move even while Canvas detail is absent', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Explain gravity', intent: 'understand', evidenceState: 'ready', lifecycle: 'active', revision: 4, authorityKind: 'v2_mission', learningVoidId: 'void_1' },
      currentActivity: { id: 'activity_1', status: 'feedback', purpose: 'Apply gravity independently.' }, history: [],
      completion: { version: 'learn-adaptive.representative-completion.v1', status: 'passed', basis: 'server_scored_representative_task', activityId: 'activity_1', recordedAt: 100 },
      nextAction: { kind: 'open_v2_mission', label: 'Choose your next move in your learning mission', reasonCode: 'representative_pass', activityId: 'activity_1' } }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
    expect(wrapper.get('[data-testid="learn-representative-outcome"]').text()).toContain('Representative task passed')
    expect(wrapper.get('#learn-thread-next-title').element.parentElement?.textContent).toContain('Choose your next move in your learning mission')
    expect(wrapper.get('[data-testid="learn-representative-next-move"]').attributes('href')).toBe('/app/learn/void_1')
    expect(wrapper.get('[data-testid="learn-adaptive-canvas-fallback"]')).toBeTruthy()
    user.value = { _id: 'owner_2' }
    await nextTick()
    expect(wrapper.text()).not.toContain('void_1')
    expect(wrapper.find('[data-testid="learn-representative-outcome"]').exists()).toBe(false)
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
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Private mission', intent: 'understand', evidenceState: 'ready', lifecycle: 'active', revision: 2, authorityKind: 'v2_mission', learningVoidId: 'void_1' },
      currentActivity: null, history: [], nextAction: { kind: 'continue', label: 'Continue', activityId: null } }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
    expect(wrapper.get('[data-testid="learn-adaptive-thread-denied"]').text()).toContain('not available')
    expect(wrapper.get('[data-testid="learn-adaptive-safe-destination"]').attributes('href')).toBe('/app/learn')
    expect(wrapper.html()).not.toContain('void_1')
    allowed.value = true
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Gravity', intent: 'understand', evidenceState: 'ready', lifecycle: 'rollback', revision: 3, authorityKind: 'v2_mission', learningVoidId: 'void_1' },
      currentActivity: null, history: [], nextAction: { kind: 'return_to_learn', label: 'Back to Learn', activityId: null } }
    await nextTick()
    expect(wrapper.get('[data-testid="learn-adaptive-thread-unavailable"]').text()).toContain('unavailable')
    expect(wrapper.get('[data-testid="learn-adaptive-safe-destination"]').attributes('href')).toBe('/app/learn/void_1')
  })
})
