import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'
import { adaptiveRecoveryCopy } from '~~/shared/learn-adaptive-recovery'

const allowed = ref(true)
const canvas = ref<Record<string, unknown> | null>(null)
const diagnostic = ref<Record<string, unknown> | null>(null)
const artifact = ref<Record<string, unknown> | null>(null)
const reflection = ref<Record<string, unknown> | null>(null)
const evidence = ref<Record<string, unknown> | null>(null)
const memory = ref<Record<string, unknown> | null>(null)
const contributions = ref({ page: [], isDone: true, continueCursor: '' })
const projection = ref<Record<string, unknown> | null>(null)
const canvasPending = ref(false)
const diagnosticPending = ref(false)
const user = ref<{ _id: string } | null>({ _id: 'owner_1' })
const requestedRoute = reactive({ params: { threadId: 'thread_1' }, query: { activity: undefined as string | undefined } })
const calls = vi.fn()
const documentSubscriptions = vi.fn().mockReturnValue(vi.fn())
const mutationCalls = vi.fn().mockResolvedValue({ kind: 'ok' })
const memoryMutationCalls = vi.fn().mockResolvedValue({ kind: 'ok', revision: 4 })
const isOnline = ref(true)

mockNuxtImport('useLearnAdaptiveAccess', () => () => ({ allowed, checkingAccess: ref(false), fallbackRoute: ref({ name: 'app-learn', href: '/app/learn?legacy=v2', label: 'Open V2 learning plans' }) }))
mockNuxtImport('useRoute', () => () => requestedRoute)
mockNuxtImport('useOnlineStatus', () => () => ({ isOnline }))
mockNuxtImport('useConvex', () => () => ({ query: vi.fn(), onUpdate: documentSubscriptions }))
mockNuxtImport('useConvexMutation', () => (reference: never) => ({ mutate: ['learnAdaptive:setMemoryPreference', 'learnAdaptive:deleteArtifact', 'learnAdaptive:requestPromotion'].some(name => getFunctionName(reference).startsWith(name)) ? memoryMutationCalls : mutationCalls }))
mockNuxtImport('useConvexAction', () => () => ({ mutate: vi.fn() }))
mockNuxtImport('useConvexQuery', () => (reference: never, args: unknown) => {
  const name = getFunctionName(reference)
  calls(name, args)
  return { data: name === 'users:getUser' ? user : name === 'learnAdaptive:getThread' ? projection : name === 'learnAdaptive:getMemory' ? memory : name === 'learnAdaptive:listThreadContributions' ? contributions : name === 'learnAdaptiveRecovery:getDiagnosticCanvas' ? diagnostic : name === 'learnAdaptiveEvidence:getThreadActivityEvidence' ? evidence : name === 'learnAdaptive:getArtifactCanvas' ? artifact : name === 'learnAdaptive:getReflectionCanvas' ? reflection : name === 'learnAdaptive:listThreadArtifacts' ? ref([]) : canvas,
    pending: name === 'learnAdaptiveRecovery:getDiagnosticCanvas' ? diagnosticPending : name === 'learnAdaptiveCanvas:getCanvas' ? canvasPending : ref(false) }
})

const path = ['~', 'pages', 'app', 'learn', 'thread', '[threadId].vue'].join('/')

describe('adaptive thread route isolation', () => {
  beforeEach(() => { allowed.value = true; isOnline.value = true; canvas.value = null; diagnostic.value = null; artifact.value = null; reflection.value = null; evidence.value = null; memory.value = null; projection.value = null; canvasPending.value = false; diagnosticPending.value = false; user.value = { _id: 'owner_1' }; requestedRoute.params.threadId = 'thread_1'; requestedRoute.query.activity = undefined; calls.mockClear(); documentSubscriptions.mockClear(); mutationCalls.mockClear(); memoryMutationCalls.mockReset().mockResolvedValue({ kind: 'ok', revision: 4 }); sessionStorage.clear() })

  it('does not subscribe to folder documents for a no-source thread', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Explain gravity', intent: 'understand', evidenceState: 'none', lifecycle: 'active', revision: 2, authorityKind: 'standalone', sourceScope: { kind: 'none' } }, history: [], nextAction: { kind: 'resume', label: 'Continue' } }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
    expect(calls.mock.calls.some(([name]) => name === 'documents:listDocumentsByFolder')).toBe(false)
    expect(documentSubscriptions).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('restores the saved goal, unresolved point, attempt context, artifact, and next move', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', goal: 'Understand gravity', outcome: 'Explain an orbit', intent: 'understand', evidenceState: 'none', lifecycle: 'active', revision: 3, authorityKind: 'standalone' },
      currentActivity: { id: 'activity_1', status: 'feedback', purpose: 'Explain the orbit' },
      unresolvedPoint: 'Why does it keep curving?', attemptContext: { priorOutcome: 'representative_fail', assistance: 'hint' },
      artifact: { id: 'artifact_1', title: 'Orbit sketch', status: 'saved', activityId: 'activity_1' },
      history: [], nextAction: { kind: 'review_feedback', label: 'Review your feedback', activityId: 'activity_1' } }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
    expect(wrapper.get('[data-testid="learn-thread-goal"]').text()).toContain('Understand gravity')
    expect(wrapper.get('[data-testid="learn-thread-unresolved"]').text()).toContain('Why does it keep curving?')
    expect(wrapper.get('[data-testid="learn-thread-resume-context"]').text()).toContain('representative_fail')
    expect(wrapper.get('[data-testid="learn-thread-resume-context"]').text()).toContain('Earlier work used a hint')
    expect(wrapper.get('[data-testid="learn-thread-resume-context"]').text()).toContain('Orbit sketch')
    expect(wrapper.get('#learn-thread-next-title').element.parentElement?.textContent).toContain('Review your feedback')
    wrapper.unmount()
  })

  it.each(['preparing', 'blocked', 'stale', 'invalidated', 'unavailable'] as const)('keeps an owned factual response through routed %s recovery', async evidenceState => {
    const Page = await import(path)
    const primitive = { contractVersion: 'learn-adaptive.activity-contract.v1', rendererVersion: 'learn-adaptive.renderer.v1',
      type: 'independent_application', action: 'submit_response', testId: 'learn-primitive-independent-application',
      props: { prompt: 'Explain why an apple falls.', responseFormat: 'long_text', draftPersistence: true } }
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Explain gravity', intent: 'understand', evidenceState: 'ready', lifecycle: 'active', revision: 2, authorityKind: 'v2_mission', learningVoidId: 'void_1' },
      currentActivity: { id: 'activity_1', status: 'started', purpose: 'Apply gravity independently.' }, history: [],
      nextAction: { kind: 'submit_response', label: 'Submit response', activityId: 'activity_1' } }
    canvas.value = { ownerId: 'owner_1', status: 'started', thread: { id: 'thread_1', outcome: 'Explain gravity', intent: 'understand', revision: 2 },
      activity: { id: 'activity_1', status: 'started', purpose: 'Apply gravity independently.', reasonCode: 'ready_v2_session', planRevision: 1,
        evidenceScope: { version: 'learn-adaptive.canvas-evidence-scope.v1', integrityState: 'accepted', sourceRefs: ['source_1'] },
        primitive, fallback: { testId: 'learn-activity-fallback', title: 'Activity unavailable', body: 'Try later.', primaryAction: { label: 'Back to Learn' } },
        requiredAction: { kind: 'submit_response', label: 'Submit response' } },
      session: { studySessionId: 'session_1', revision: 2, contentRevision: 1, planRecordRevision: 5, blueprintRecordRevision: 3, scheduledStartAt: 0, scheduledEndAt: null, timezone: 'UTC' },
      responsePrompt: 'Explain why an apple falls.' }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1', attachTo: document.body })
    await wrapper.get('[data-testid="learn-canvas-response"]').setValue('My unfinished answer.')
    expect(wrapper.get('[data-testid="learn-adaptive-canvas-frame"]').attributes('aria-label')).toBe('Current learning activity')
    projection.value = { ...projection.value!, thread: { ...(projection.value!.thread as Record<string, unknown>), evidenceState } }
    await nextTick()
    const guard = wrapper.get('[data-testid="learn-current-source-recovery"]')
    expect(guard.attributes('role')).toBe('alert')
    expect(guard.text()).toContain(`Evidence ${evidenceState}`)
    expect(guard.get('a').attributes('href')).toBe('/app/learn/void_1')
    expect(wrapper.get('[data-testid="learn-adaptive-canvas"]').element.parentElement?.getAttribute('style')).toContain('display: none')
    expect((wrapper.get('[data-testid="learn-canvas-response"]').element as HTMLTextAreaElement).value).toBe('My unfinished answer.')

    const recovery = adaptiveRecoveryCopy(evidenceState)
    canvas.value = { ...canvas.value!, status: 'blocked', recoveryState: evidenceState, recovery }
    await nextTick()
    expect(wrapper.find('[data-testid="learn-current-source-recovery"]').exists()).toBe(false)
    const fallback = wrapper.get('[data-testid="learn-activity-fallback"]')
    expect(fallback.attributes('role')).toBe(evidenceState === 'preparing' ? 'status' : 'alert')
    expect(fallback.text()).toContain(recovery.title)
    expect(fallback.text()).toContain('Your unfinished response remains on this device.')
    expect(fallback.get('button').text()).toBe('Back to Learn')
    expect(wrapper.find('[data-testid="learn-canvas-submit"]').exists()).toBe(false)
    if (evidenceState !== 'preparing') await vi.waitFor(() => expect(document.activeElement).toBe(fallback.get('button').element))
    projection.value = { ...projection.value!, thread: { ...(projection.value!.thread as Record<string, unknown>), evidenceState: 'ready' } }
    canvas.value = { ...canvas.value!, status: 'started', recoveryState: null, recovery: null }
    await nextTick()
    expect((wrapper.get('[data-testid="learn-canvas-response"]').element as HTMLTextAreaElement).value).toBe('My unfinished answer.')
    wrapper.unmount()
  })

  it('keeps a routed diagnostic draft through offline, timed-out save, and rollback', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Check my learning', intent: 'refresh', evidenceState: 'preparing', lifecycle: 'active', revision: 2, authorityKind: 'standalone' },
      currentActivity: { id: 'diagnostic:thread_1', status: 'eligible', purpose: 'Record your starting point.' }, history: [],
      nextAction: { kind: 'submit_response', label: 'Save response', activityId: 'diagnostic:thread_1' } }
    diagnostic.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Check my learning', intent: 'refresh', revision: 2 },
      status: 'eligible', evidenceState: 'preparing', decisionPending: false, recovery: adaptiveRecoveryCopy('preparing'),
      activity: { id: 'diagnostic:thread_1', status: 'eligible', planRevision: 1,
        primitive: { contractVersion: 'learn-adaptive.activity-contract.v1', rendererVersion: 'learn-adaptive.renderer.v1', type: 'diagnostic_prompt', action: 'submit_response', testId: 'learn-primitive-diagnostic-prompt', props: { prompt: 'What do you know?', responseFormat: 'short_text', assistance: 'none' } },
        response: null, requiredAction: { kind: 'submit_response', label: 'Save response' } } }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1', attachTo: document.body })
    await wrapper.get('[data-testid="learn-diagnostic-response"]').setValue('My unsent starting point.')
    isOnline.value = false
    await nextTick()
    expect(wrapper.text()).toContain('Reconnect to save your response.')
    expect((wrapper.get('[data-testid="learn-diagnostic-submit"]').element as HTMLButtonElement).disabled).toBe(true)
    expect((wrapper.get('[data-testid="learn-diagnostic-response"]').element as HTMLTextAreaElement).value).toBe('My unsent starting point.')
    isOnline.value = true
    await nextTick()
    mutationCalls.mockRejectedValueOnce(new Error('timeout'))
    await wrapper.get('[data-testid="learn-diagnostic-submit"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-diagnostic-error"]').attributes('role')).toBe('alert'))
    expect((wrapper.get('[data-testid="learn-diagnostic-response"]').element as HTMLTextAreaElement).value).toBe('My unsent starting point.')
    projection.value = { ...projection.value!, thread: { ...(projection.value!.thread as Record<string, unknown>), lifecycle: 'rollback' },
      unresolvedPoint: 'Check the earlier explanation.', history: [{ id: 'activity_before', status: 'ended', purpose: 'Earlier explanation', boundaryOrdinal: 1 }] }
    await nextTick()
    expect(wrapper.get('[data-testid="learn-thread-rollback-recovery"]').text()).toContain('past activity remain available')
    expect(wrapper.get('[data-testid="learn-thread-unresolved"]').text()).toContain('Check the earlier explanation.')
    expect(wrapper.get('#learn-thread-history-title').element.parentElement?.textContent).toContain('Earlier explanation')
    expect(wrapper.get('[data-testid="learn-thread-rollback-recovery"] a').attributes('href')).toBe('/app/learn')
    expect(wrapper.get('[data-testid="learn-adaptive-canvas-frame"] > div:last-child').attributes('style')).toContain('display: none')
    projection.value = { ...projection.value!, thread: { ...(projection.value!.thread as Record<string, unknown>), lifecycle: 'active' } }
    await nextTick()
    expect((wrapper.get('[data-testid="learn-diagnostic-response"]').element as HTMLTextAreaElement).value).toBe('My unsent starting point.')
    wrapper.unmount()
  })

  it('routes an ambiguous saved scoring outcome to reconciliation with one safe action', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Explain gravity', intent: 'understand', evidenceState: 'ready', lifecycle: 'active', revision: 3, authorityKind: 'v2_mission', learningVoidId: 'void_1' },
      currentActivity: { id: 'activity_1', status: 'reconciling', purpose: 'Apply gravity independently.' }, history: [],
      nextAction: { kind: 'recover', label: 'Wait for scoring reconciliation', activityId: 'activity_1' } }
    canvas.value = { ownerId: 'owner_1', status: 'reconciling', thread: { id: 'thread_1', outcome: 'Explain gravity', intent: 'understand', revision: 3 },
      activity: { id: 'activity_1', status: 'reconciling', purpose: 'Apply gravity independently.', reasonCode: 'ready_v2_session', planRevision: 1,
        evidenceScope: { version: 'learn-adaptive.canvas-evidence-scope.v1', integrityState: 'accepted', sourceRefs: ['source_1'] },
        primitive: { contractVersion: 'learn-adaptive.activity-contract.v1', rendererVersion: 'learn-adaptive.renderer.v1', type: 'independent_application', action: 'submit_response', testId: 'learn-primitive-independent-application', props: { prompt: 'Explain why an apple falls.', responseFormat: 'long_text', draftPersistence: true } },
        fallback: { testId: 'learn-activity-fallback', title: 'Activity unavailable', body: 'Try later.', primaryAction: { label: 'Back to Learn' } }, requiredAction: { kind: 'submit_response', label: 'Submit response' } },
      session: { studySessionId: 'session_1', revision: 3, contentRevision: 1, planRecordRevision: 5, blueprintRecordRevision: 3, scheduledStartAt: 0, scheduledEndAt: null, timezone: 'UTC' },
      responsePrompt: 'Explain why an apple falls.', savedResponse: { response: 'Gravity pulls the apple down.', confidence: 4 } }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1', attachTo: document.body })
    const status = wrapper.get('[data-testid="learn-canvas-status"]')
    expect(status.attributes('role')).toBe('status')
    expect(status.text()).toContain('Scoring needs reconciliation. Your response is saved.')
    expect(wrapper.find('[data-testid="learn-canvas-retry-scoring"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="learn-canvas-submit"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="learn-canvas-scoring-safe-action"]').text()).toBe('Back to Learn')
    expect(wrapper.get('[data-testid="learn-canvas-scoring-safe-action"]').classes()).toContain('min-h-11')
    expect(wrapper.text()).not.toContain('Mastery achieved')
    wrapper.unmount()
  })

  it('keeps an ended thread available for its authoritative reflection completion', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Learn deliberately', intent: 'explore', evidenceState: 'none', lifecycle: 'ended', revision: 4, authorityKind: 'standalone' },
      currentActivity: { id: 'reflection_1', status: 'ended', activityClass: 'non_factual', purpose: 'Choose what to do next.' }, history: [], nextAction: { kind: 'return_to_learn', label: 'Back to Learn', reasonCode: 'reflection_thread_ended', activityId: 'reflection_1' } }
    reflection.value = { ownerId: 'owner_1', status: 'completed', decision: { outcome: 'ended', nextMove: 'Try one independent example.', decidedAt: 2 },
      thread: { id: 'thread_1', revision: 4, outcome: 'Learn deliberately', lifecycle: 'ended' },
      activity: { id: 'reflection_1', planRevision: 1, status: 'ended', purpose: 'Choose what to do next.', reason: 'The guided step is complete.',
        primitive: { contractVersion: 'learn-adaptive.activity-contract.v1', rendererVersion: 'learn-adaptive.renderer.v1', type: 'reflection_next_move', action: 'accept_next_move', testId: 'learn-primitive-reflection-next-move', props: { feedback: 'You completed the guided example.', nextMove: 'Try one independent example.', allowedDecisions: ['accept', 'override', 'end'] } },
        fallback: { title: 'Unavailable', body: 'Try later.', testId: 'learn-activity-fallback', primaryAction: { label: 'Continue safely' } } } }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })
    expect(wrapper.get('[data-testid="learn-reflection-completed"]').text()).toContain('Thread ended')
    expect(wrapper.find('[data-testid="learn-adaptive-thread-unavailable"]').exists()).toBe(false)
    wrapper.unmount()
  })

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
    expect(wrapper.get('[data-testid="learn-adaptive-safe-destination"]').attributes('href')).toBe('/app/learn?legacy=v2')
    expect(wrapper.get('[data-testid="learn-adaptive-safe-destination"]').text()).toBe('Open V2 learning plans')
    expect(wrapper.html()).not.toContain('void_1')
    allowed.value = true
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Gravity', intent: 'understand', evidenceState: 'ready', lifecycle: 'rollback', revision: 3, authorityKind: 'v2_mission', learningVoidId: 'void_1' },
      currentActivity: null, history: [], nextAction: { kind: 'return_to_learn', label: 'Back to Learn', activityId: null } }
    await nextTick()
    expect(wrapper.get('[data-testid="learn-adaptive-thread-shell"]').text()).toContain('Gravity')
    expect(wrapper.get('[data-testid="learn-thread-rollback-recovery"]').text()).toContain('unavailable')
    expect(wrapper.get('[data-testid="learn-thread-rollback-recovery"] a').attributes('href')).toBe('/app/learn/void_1')
  })

  it('opens owned memory and closes back to its trigger without exposing another owner projection', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Build a plan', intent: 'build', evidenceState: 'none', lifecycle: 'active', revision: 3, authorityKind: 'standalone' },
      currentActivity: null, history: [], nextAction: { kind: 'continue', label: 'Continue', activityId: null } }
    memory.value = { ownerId: 'owner_1', threadId: 'thread_1', threadRevision: 3, lifecycle: 'active', unresolvedPoint: 'Plan the next step',
      nextAction: { label: 'Continue' }, evidenceState: 'none', preferences: [], artifacts: [], history: [] }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1', attachTo: document.body })
    expect(calls.mock.calls.some(([name]) => name === 'learnAdaptive:getMemory')).toBe(true)
    const trigger = wrapper.get('[data-testid="learn-memory-open"]')
    await trigger.trigger('click')
    expect(document.querySelector('[data-testid="learn-memory-drawer"]')?.textContent).toContain('Plan the next step')
    ;(document.querySelector('[data-testid="learn-memory-close"]') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger.element))
    memory.value = { ...memory.value, ownerId: 'owner_2', unresolvedPoint: 'Private other-owner memory' }
    await trigger.trigger('click')
    expect(document.querySelector('[data-testid="learn-memory-drawer"]')?.textContent).not.toContain('Private other-owner memory')
    expect(document.querySelector('[data-testid="learn-memory-drawer"]')?.textContent).toContain('Memory is unavailable')
    wrapper.unmount()
  })

  it('sends a revision-checked preference command and preserves an edit after a server conflict', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Build a plan', intent: 'build', evidenceState: 'none', lifecycle: 'active', revision: 3, authorityKind: 'standalone' },
      currentActivity: null, history: [], nextAction: { kind: 'continue', label: 'Continue', activityId: null } }
    memory.value = { ownerId: 'owner_1', threadId: 'thread_1', threadRevision: 3, lifecycle: 'active', unresolvedPoint: null,
      nextAction: { label: 'Continue' }, evidenceState: 'none', preferences: [{ key: 'representation', value: 'Use diagrams', state: 'active', revision: 1 }], artifacts: [], history: [] }
    memoryMutationCalls.mockResolvedValueOnce({ kind: 'conflict', code: 'stale_revision', actualRevision: 4 })
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1', attachTo: document.body })
    await wrapper.get('[data-testid="learn-memory-open"]').trigger('click')
    const drawer = document.querySelector('[data-testid="learn-memory-drawer"]') as HTMLElement
    const input = drawer.querySelector('[data-testid="learn-memory-preference-representation"]') as HTMLInputElement
    input.value = 'Use short diagrams'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    ;(drawer.querySelector('[data-testid="learn-memory-save-representation"]') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(memoryMutationCalls).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread_1', key: 'representation', operation: 'set', value: 'Use short diagrams', expectedRevision: 3,
      idempotencyKey: expect.any(String),
    })))
    await vi.waitFor(() => expect(drawer.querySelector('[role="alert"]')?.textContent).toContain('changed'))
    expect(input.value).toBe('Use short diagrams')
    wrapper.unmount()
  })

  it('retries an unconfirmed memory command with its original key and clears it on account change', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Build a plan', intent: 'build', evidenceState: 'none', lifecycle: 'active', revision: 3, authorityKind: 'standalone' },
      currentActivity: null, history: [], nextAction: { kind: 'continue', label: 'Continue', activityId: null } }
    memory.value = { ownerId: 'owner_1', threadId: 'thread_1', threadRevision: 3, lifecycle: 'active', unresolvedPoint: null,
      nextAction: { label: 'Continue' }, evidenceState: 'none', preferences: [], artifacts: [], history: [] }
    memoryMutationCalls.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ kind: 'ok', revision: 4 })
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1', attachTo: document.body })
    await wrapper.get('[data-testid="learn-memory-open"]').trigger('click')
    const drawer = document.querySelector('[data-testid="learn-memory-drawer"]') as HTMLElement
    const input = drawer.querySelector('[data-testid="learn-memory-preference-pace"]') as HTMLInputElement
    input.value = 'Short steps'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    ;(drawer.querySelector('[data-testid="learn-memory-save-pace"]') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(memoryMutationCalls).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(drawer.querySelector('[role="alert"]')?.textContent).toContain('could not be confirmed'))
    await vi.waitFor(() => expect(drawer.querySelector('[data-testid="learn-memory-retry"]')).not.toBeNull())
    ;(drawer.querySelector('[data-testid="learn-memory-refresh"]') as HTMLButtonElement).click()
    expect(drawer.querySelector('[data-testid="learn-memory-retry"]')).not.toBeNull()
    const first = memoryMutationCalls.mock.calls[0]?.[0]
    ;(drawer.querySelector('[data-testid="learn-memory-retry"]') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(memoryMutationCalls).toHaveBeenCalledTimes(2))
    expect(memoryMutationCalls.mock.calls[1]?.[0]).toEqual(first)
    await vi.waitFor(() => expect(drawer.querySelector('[data-testid="learn-memory-status"]')?.textContent).toContain('saved'))
    memoryMutationCalls.mockRejectedValueOnce(new Error('timeout'))
    const another = drawer.querySelector('[data-testid="learn-memory-preference-practice_style"]') as HTMLInputElement
    another.value = 'Recall first'
    another.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    ;(drawer.querySelector('[data-testid="learn-memory-save-practice_style"]') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(drawer.querySelector('[data-testid="learn-memory-retry"]')).not.toBeNull())
    user.value = { _id: 'owner_2' }
    projection.value = { ...projection.value!, ownerId: 'owner_2' }
    memory.value = { ...memory.value!, ownerId: 'owner_2' }
    await nextTick()
    expect(document.querySelector('[data-testid="learn-memory-retry"]')).toBeNull()
    expect(wrapper.text()).not.toContain('The result could not be confirmed')
    wrapper.unmount()
  })

  it('deletes an owned artifact through the existing command and reports pending cleanup', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Build a plan', intent: 'build', evidenceState: 'none', lifecycle: 'active', revision: 3, authorityKind: 'standalone' },
      currentActivity: null, history: [], nextAction: { kind: 'continue', label: 'Continue', activityId: null } }
    memory.value = { ownerId: 'owner_1', threadId: 'thread_1', threadRevision: 3, lifecycle: 'active', unresolvedPoint: null,
      nextAction: { label: 'Continue' }, evidenceState: 'none', preferences: [],
      artifacts: [{ id: 'artifact_1', kind: 'plan', title: 'My plan', summary: 'Three steps', status: 'saved', revision: 1, updatedAt: 1,
        historical: false, readOnly: false, evidenceLabel: null }], history: [] }
    memoryMutationCalls.mockResolvedValueOnce({ kind: 'ok', revision: 4, value: { cleanupPending: true } })
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1', attachTo: document.body })
    await wrapper.get('[data-testid="learn-memory-open"]').trigger('click')
    const drawer = document.querySelector('[data-testid="learn-memory-drawer"]') as HTMLElement
    ;(drawer.querySelector('[data-testid="learn-memory-delete-artifact_1"]') as HTMLButtonElement).click()
    await nextTick()
    expect(memoryMutationCalls).not.toHaveBeenCalled()
    ;(drawer.querySelector('[data-testid="learn-memory-confirm-delete-artifact_1"]') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(memoryMutationCalls).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread_1', artifactId: 'artifact_1', expectedRevision: 3, idempotencyKey: expect.any(String),
    })))
    await vi.waitFor(() => expect(drawer.querySelector('[data-testid="learn-memory-status"]')?.textContent).toContain('cleanup is pending'))
    wrapper.unmount()
  })

  it('sends an explicit proposal with the selected source and thread revision', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Build a plan', intent: 'build', evidenceState: 'none', lifecycle: 'active', revision: 3, authorityKind: 'standalone' },
      currentActivity: null, history: [], nextAction: { kind: 'continue', label: 'Continue', activityId: null } }
    memory.value = { ownerId: 'owner_1', threadId: 'thread_1', threadRevision: 3, lifecycle: 'active', unresolvedPoint: null,
      nextAction: { label: 'Continue' }, evidenceState: 'none', preferences: [], artifacts: [], history: [],
      promotionCandidates: [{ basis: 'useful_artifact', sourceId: 'artifact_1', label: 'My plan', allowedKinds: ['review', 'mastery'] }],
      promotionProposals: [] }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1', attachTo: document.body })
    await wrapper.get('[data-testid="learn-memory-open"]').trigger('click')
    const drawer = document.querySelector('[data-testid="learn-memory-drawer"]') as HTMLElement
    ;(drawer.querySelector('[data-testid="learn-memory-promote-review-artifact_1"]') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(memoryMutationCalls).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread_1', kind: 'review', artifactId: 'artifact_1', expectedRevision: 3, idempotencyKey: expect.any(String),
    })))
    await vi.waitFor(() => expect(drawer.querySelector('[data-testid="learn-memory-status"]')?.textContent).toContain('No check was scheduled'))
    wrapper.unmount()
  })

  it('lets an ended thread review memory without mounting an editable activity', async () => {
    const Page = await import(path)
    projection.value = { ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Finished plan', intent: 'build', evidenceState: 'none', lifecycle: 'ended', revision: 4, authorityKind: 'standalone' },
      currentActivity: { id: 'artifact_1', status: 'ended', activityClass: 'non_factual', purpose: 'Build a plan' }, history: [],
      nextAction: { kind: 'return_to_learn', label: 'Back to Learn', activityId: 'artifact_1' } }
    memory.value = { ownerId: 'owner_1', threadId: 'thread_1', threadRevision: 4, lifecycle: 'ended', unresolvedPoint: 'Review the plan',
      nextAction: { label: 'Back to Learn' }, evidenceState: 'none', preferences: [], artifacts: [], history: [] }
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1', attachTo: document.body })
    expect(wrapper.get('[data-testid="learn-thread-ended-history"]').text()).toContain('ended')
    expect(wrapper.find('[data-testid="learn-primitive-artifact-workspace"]').exists()).toBe(false)
    await wrapper.get('[data-testid="learn-memory-open"]').trigger('click')
    const drawer = document.querySelector('[data-testid="learn-memory-drawer"]') as HTMLElement
    expect(drawer.textContent).toContain('Review the plan')
    expect(drawer.querySelector('[data-testid="learn-memory-save-representation"]')).toBeNull()
    wrapper.unmount()
  })
})
