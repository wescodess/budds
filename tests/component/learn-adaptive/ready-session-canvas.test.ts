import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const start = vi.fn()
const assist = vi.fn()
const stage = vi.fn()
const submit = vi.fn()
const meaningfulStart = vi.fn()
const applyOverride = vi.fn()
const reportRenderFailure = vi.fn()
const isOnline = ref(true)

mockNuxtImport('useOnlineStatus', () => () => ({ isOnline }))
mockNuxtImport('useConvexMutation', () => (reference: never) => {
  const name = getFunctionName(reference) ?? ''
  return { mutate: name.includes('startStudySession') ? start : name.includes('recordMeaningfulActivityStarted') ? meaningfulStart : name.includes('recordAssistanceUse') ? assist : name.includes('submitCanvasResponse') ? stage : name.includes('applyOverride') ? applyOverride : name.includes('reportRenderFailure') ? reportRenderFailure : vi.fn() }
})
mockNuxtImport('useConvexAction', () => (reference: never) => ({ mutate: getFunctionName(reference)?.includes('submitResponse') ? submit : vi.fn() }))

const canvas = {
  ownerId: 'owner_1', status: 'ready', thread: { id: 'thread_1', outcome: 'Explain gravity', intent: 'understand', revision: 2 },
  activity: { id: 'ready-session:session_1', status: 'eligible', purpose: 'Study a supported explanation.', reasonCode: 'ready_v2_session', planRevision: 1,
    evidenceScope: { version: 'learn-adaptive.canvas-evidence-scope.v1', integrityState: 'accepted', sourceRefs: ['source_1'] },
    primitive: { contractVersion: 'learn-adaptive.activity-contract.v1', rendererVersion: 'learn-adaptive.renderer.v1', type: 'cited_explanation', action: 'continue', testId: 'learn-primitive-cited-explanation', props: { heading: 'Gravity', explanation: 'Gravity attracts masses.', sourceRefs: ['source_1'] } },
    fallback: { testId: 'learn-activity-fallback', title: 'Activity unavailable', body: 'Try later.', primaryAction: { label: 'Continue safely' } },
    requiredAction: { kind: 'continue', label: 'Continue' } },
  session: { studySessionId: 'session_1', revision: 2, contentRevision: 1, planRecordRevision: 5, blueprintRecordRevision: 3, scheduledStartAt: 0, scheduledEndAt: null, timezone: 'UTC' },
  responsePrompt: 'Explain why an apple falls.',
}

describe('ready adaptive Canvas', () => {
  beforeEach(() => {
    start.mockReset().mockResolvedValue({ status: 'in_progress', sessionContentRevision: 1 })
    assist.mockReset().mockResolvedValue({ status: 'recorded', revision: 4, assistance: { content: 'Think about mass.' } })
    stage.mockReset().mockResolvedValue({ kind: 'ok', revision: 3, value: { status: 'submitted' } })
    submit.mockReset().mockResolvedValue({ kind: 'accepted', status: 'in_progress' })
    meaningfulStart.mockReset().mockResolvedValue({ status: 'recorded', replayed: false })
    applyOverride.mockReset().mockImplementation(async (input: { option: string }) => ({ kind: 'ok', revision: 3, value: { fixedNextPlan: { version: 'learn-adaptive.fixed-next-plan.v1', inputOption: input.option, nextActivity: input.option === 'answer_now' ? 'answer_step' : 'worked_example', availableTime: '25', difficulty: 'same', maxNewActivities: 1, authority: 'server_revalidate_at_boundary' } } }))
    reportRenderFailure.mockReset().mockResolvedValue({ recorded: true })
    isOnline.value = true
    sessionStorage.clear()
  })

  it.each([
    ['unknown_primitive', { type: 'generated_widget' }],
    ['unsupported_action', { action: 'run_tool' }],
    ['unsafe_url', { props: { heading: 'Gravity', explanation: 'javascript:alert(1)', sourceRefs: ['source_1'] } }],
    ['invalid_evidence_link', { props: { heading: 'Gravity', explanation: 'Gravity attracts masses.', sourceRefs: ['unknown_source'] } }],
    ['oversized_prop', { props: { heading: 'Gravity', explanation: 'x'.repeat(4_001), sourceRefs: ['source_1'] } }],
    ['executable_content', { props: { heading: 'Gravity', explanation: '<script>alert(1)</script>', sourceRefs: ['source_1'] } }],
  ])('rejects %s, reports the versioned failure, and restores the same draft after recovery', async (reasonCode, override) => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const current = { ...canvas, status: 'started', activity: { ...canvas.activity, status: 'started' } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: current } })
    await wrapper.get('[data-testid="learn-canvas-continue"]').trigger('click')
    await wrapper.get('[data-testid="learn-canvas-response"]').setValue('My unfinished answer.')
    await wrapper.setProps({ canvas: { ...current, activity: { ...current.activity, primitive: { ...current.activity.primitive, ...override } } } })
    await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-activity-fallback"]').exists()).toBe(true))
    expect(wrapper.text()).not.toContain('javascript:alert')
    expect(wrapper.find('[data-testid="learn-primitive-cited-explanation"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="learn-canvas-draft-fallback"]').text()).toContain('unfinished response')
    expect(wrapper.get('[data-testid="learn-canvas-fallback-action"]').text()).toBe('Continue safely')
    await vi.waitFor(() => expect(reportRenderFailure).toHaveBeenCalledWith({ threadId: 'thread_1', activityId: 'ready-session:session_1', expectedPlanRevision: 1, reasonCode }))
    await wrapper.setProps({ canvas: current })
    expect((wrapper.get('[data-testid="learn-canvas-response"]').element as HTMLTextAreaElement).value).toBe('My unfinished answer.')
    expect(stage).not.toHaveBeenCalled()
  })

  it('retries a transient render-failure report with the same bounded reason', async () => {
    reportRenderFailure.mockRejectedValueOnce(new Error('network timeout')).mockResolvedValueOnce({ recorded: true })
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const invalid = { ...canvas, activity: { ...canvas.activity, primitive: { ...canvas.activity.primitive, type: 'generated_widget' } } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: invalid } })
    await vi.waitFor(() => expect(reportRenderFailure).toHaveBeenCalledTimes(2))
    expect(reportRenderFailure.mock.calls[0]?.[0]).toEqual(reportRenderFailure.mock.calls[1]?.[0])
    expect(wrapper.get('[data-testid="learn-activity-fallback"]').text()).toContain('not supported')
  })

  it('resumes an exhausted render report after offline reconnect with a fresh bounded budget', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { canvas } })
    reportRenderFailure.mockRejectedValueOnce(new Error('network 1'))
      .mockRejectedValueOnce(new Error('network 2'))
      .mockRejectedValueOnce(new Error('network 3'))
      .mockResolvedValueOnce({ recorded: true })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const invalid = { ...canvas, activity: { ...canvas.activity, primitive: { ...canvas.activity.primitive, type: 'generated_widget' } } }
      await wrapper.setProps({ canvas: invalid })
      await Promise.resolve()
      expect(reportRenderFailure).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(100)
      expect(reportRenderFailure).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(500)
      expect(reportRenderFailure).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(reportRenderFailure).toHaveBeenCalledTimes(3)
      isOnline.value = false
      await nextTick()
      isOnline.value = true
      await nextTick()
      await Promise.resolve()
      expect(reportRenderFailure).toHaveBeenCalledTimes(4)
      expect(reportRenderFailure.mock.calls[3]?.[0]).toEqual(reportRenderFailure.mock.calls[0]?.[0])
      await vi.advanceTimersByTimeAsync(2_000)
      expect(reportRenderFailure).toHaveBeenCalledTimes(4)
    }
    finally { wrapper.unmount(); vi.useRealTimers() }
  })

  it('reports renderer_unavailable for a valid registered primitive without its Story 3.5 renderer', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const future = { ...canvas, activity: { ...canvas.activity, primitive: { ...canvas.activity.primitive, type: 'diagnostic_prompt', action: 'submit_response', testId: 'learn-primitive-diagnostic-prompt',
      props: { prompt: 'What do you know?', responseFormat: 'short_text', assistance: 'none' } } } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: future } })
    expect(wrapper.get('[data-testid="learn-activity-fallback"]').text()).toContain('renderer is not available')
    await vi.waitFor(() => expect(reportRenderFailure).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: 'renderer_unavailable' })))
  })

  it('counts explanation citations separately from activity-wide accepted source scope', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const scoped = { ...canvas, status: 'started', activity: { ...canvas.activity, status: 'started',
      evidenceScope: { ...canvas.activity.evidenceScope, sourceRefs: ['source_1', 'source_2'] } } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: scoped } })
    expect(wrapper.get('[data-testid="learn-canvas-explanation-citations"]').text()).toContain('1 accepted source')
    expect(wrapper.get('[data-testid="learn-canvas-evidence-scope"]').text()).toContain('2 accepted sources')
  })

  it('keeps the factual response draft mounted while choosing a supported next-boundary control', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const controlled = { ...canvas, status: 'started', activity: { ...canvas.activity, status: 'started', controls: { reasonText: { version: 'learn-adaptive.reason-text.v1', purpose: 'Study a supported explanation.', text: 'This activity uses accepted sources.' }, selected: null, fixedNextPlan: null,
      options: [{ key: 'example' as const, label: 'Show an example', available: true, unavailableReason: null }] } } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: controlled } })
    await wrapper.get('[data-testid="learn-canvas-continue"]').trigger('click')
    await wrapper.get('[data-testid="learn-canvas-response"]').setValue('A draft about gravity.')
    await wrapper.get('[data-testid="learn-why-toggle"]').trigger('click')
    await wrapper.get('[data-testid="learn-override-example"]').trigger('click')
    await vi.waitFor(() => expect(applyOverride).toHaveBeenCalledWith(expect.objectContaining({ option: 'example', activityId: 'ready-session:session_1', expectedRevision: 2 })))
    expect((wrapper.get('[data-testid="learn-canvas-response"]').element as HTMLTextAreaElement).value).toBe('A draft about gravity.')
    expect(wrapper.get('[data-testid="learn-why-controls"]').text()).toContain('Selected: Show an example')
  })

  it('keeps the current Canvas step, focus, and scroll when Answer now is saved for the next boundary', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const controlled = { ...canvas, status: 'started', activity: { ...canvas.activity, status: 'started', controls: {
      reasonText: { version: 'learn-adaptive.reason-text.v1', purpose: 'Study a supported explanation.', text: 'This activity uses accepted sources.' }, selected: null, fixedNextPlan: null,
      options: [{ key: 'answer_now' as const, label: 'Answer now', available: true, unavailableReason: null }],
    } } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: controlled }, attachTo: document.body })
    expect(wrapper.find('[data-testid="learn-canvas-response"]').exists()).toBe(false)
    await wrapper.get('[data-testid="learn-why-toggle"]').trigger('click')
    const answerNow = wrapper.get('[data-testid="learn-override-answer_now"]')
    answerNow.element.focus()
    document.documentElement.scrollTop = 240
    await answerNow.trigger('click')
    await vi.waitFor(() => expect(applyOverride).toHaveBeenCalledWith(expect.objectContaining({ option: 'answer_now' })))
    expect(wrapper.find('[data-testid="learn-canvas-response"]').exists()).toBe(false)
    expect(document.activeElement).toBe(answerNow.element)
    expect(document.documentElement.scrollTop).toBe(240)
    wrapper.unmount()
  })

  it('restores the current unsent answer and confidence after refresh', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const current = { ...canvas, status: 'started', activity: { ...canvas.activity, status: 'started' } }
    const first = await mountSuspended(Comp.default, { props: { canvas: current } })
    await first.get('[data-testid="learn-canvas-continue"]').trigger('click')
    await first.get('[data-testid="learn-canvas-response"]').setValue('A draft about gravity.')
    await first.get('[data-testid="learn-canvas-confidence-4"]').setValue()
    first.unmount()
    const restored = await mountSuspended(Comp.default, { props: { canvas: current } })
    await restored.get('[data-testid="learn-canvas-continue"]').trigger('click')
    expect((restored.get('[data-testid="learn-canvas-response"]').element as HTMLTextAreaElement).value).toBe('A draft about gravity.')
    expect((restored.get('[data-testid="learn-canvas-confidence-4"]').element as HTMLInputElement).checked).toBe(true)
  })

  it('keeps an offline response draft in place and blocks submission until reconnect', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const current = { ...canvas, status: 'started', activity: { ...canvas.activity, status: 'started' } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: current } })
    await wrapper.get('[data-testid="learn-canvas-continue"]').trigger('click')
    await wrapper.get('[data-testid="learn-canvas-response"]').setValue('Offline draft.')
    await wrapper.get('[data-testid="learn-canvas-confidence-3"]').setValue()
    isOnline.value = false
    await nextTick()
    expect(wrapper.get('[role="status"]').text()).toContain('connection is required')
    expect((wrapper.get('[data-testid="learn-canvas-response"]').element as HTMLTextAreaElement).value).toBe('Offline draft.')
    expect((wrapper.get('[data-testid="learn-canvas-submit"]').element as HTMLButtonElement).disabled).toBe(true)
    expect(stage).not.toHaveBeenCalled()
    isOnline.value = true
    await nextTick()
    expect((wrapper.get('[data-testid="learn-canvas-response"]').element as HTMLTextAreaElement).value).toBe('Offline draft.')
  })

  it.each([['preparing', 'status'], ['stale', 'alert'], ['invalidated', 'alert'], ['blocked', 'alert']])('announces %s recovery with %s and the safe action', async (recoveryState, role) => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const current = { ...canvas, status: 'started', activity: { ...canvas.activity, status: 'started' } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: current }, attachTo: document.body })
    await wrapper.setProps({ canvas: { ...current, status: 'blocked', recoveryState, activity: { ...current.activity, primitive: null },
      recovery: { title: 'Source needs attention', body: 'Your response remains available.', action: 'Back to Learn' } } })
    expect(wrapper.get(`[role="${role}"]`).text()).toContain('Source needs attention')
    const action = wrapper.get('[data-testid="learn-canvas-fallback-action"]')
    expect(action.text()).toBe('Back to Learn')
    if (role === 'alert') await vi.waitFor(() => expect(document.activeElement?.getAttribute('data-testid')).toBe('learn-canvas-fallback-action'))
    await action.trigger('click')
    expect(wrapper.emitted('leave')).toHaveLength(1)
    wrapper.unmount()
  })

  it('does not acknowledge a hidden current activity until the URL selects it again', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const current = { ...canvas, status: 'started', activity: { ...canvas.activity, status: 'started' } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: current, active: false } })
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(meaningfulStart).not.toHaveBeenCalled()
    await wrapper.setProps({ active: true })
    await vi.waitFor(() => expect(meaningfulStart).toHaveBeenCalledWith({ studySessionId: 'session_1', expectedContentRevision: 1 }))
  })

  it('starts in the thread and submits one independent response through shared V2 admission', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { canvas } })
    expect(wrapper.text()).toContain('Explain gravity')
    await wrapper.get('[data-testid="learn-canvas-start"]').trigger('click')
    await vi.waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({ studySessionId: 'session_1', expectedSessionRevision: 2 })))
    await vi.waitFor(() => expect(meaningfulStart).toHaveBeenCalledWith({ studySessionId: 'session_1', expectedContentRevision: 1 }))
    expect(wrapper.find('[data-testid="learn-primitive-cited-explanation"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="learn-canvas-continue"]').exists()).toBe(true)
    await wrapper.get('[data-testid="learn-canvas-continue"]').trigger('click')
    expect(wrapper.get('[data-testid="learn-canvas-response-prompt"]').text()).toContain('apple falls')
    await wrapper.get('[data-testid="learn-canvas-response"]').setValue('Earth attracts the apple.')
    await wrapper.get('[data-testid="learn-canvas-confidence-4"]').setValue()
    await wrapper.get('[data-testid="learn-canvas-submit"]').trigger('click')
    await vi.waitFor(() => expect(stage).toHaveBeenCalledWith(expect.objectContaining({ activityId: 'ready-session:session_1', expectedRevision: 2, expectedSessionRevision: 3 })))
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thread_1', activityId: 'ready-session:session_1', response: 'Earth attracts the apple.', confidence: 4 }))
    expect(wrapper.get('[data-testid="learn-canvas-status"]').text()).toContain('Scoring')
  })

  it('hydrates a saved response so provider denial or reload can retry deterministically', async () => {
    meaningfulStart.mockRejectedValue(new Error('telemetry unavailable'))
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const savedCanvas = { ...canvas, status: 'submitted', activity: { ...canvas.activity, status: 'submitted' }, savedResponse: { response: 'Saved answer.', confidence: 3 } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: savedCanvas } })
    expect(wrapper.get('[data-testid="learn-canvas-status"]').text()).toContain('Response submitted')
    expect(wrapper.text()).not.toContain('telemetry unavailable')
    await wrapper.get('[data-testid="learn-canvas-retry-scoring"]').trigger('click')
    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ response: 'Saved answer.', confidence: 3 })))
  })

  it('keeps the draft and retries an unconfirmed submission with the same key', async () => {
    stage.mockRejectedValueOnce(new Error('timeout before commit')).mockResolvedValueOnce({ kind: 'ok', revision: 3 })
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const current = { ...canvas, status: 'started', activity: { ...canvas.activity, status: 'started' } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: current } })
    await wrapper.get('[data-testid="learn-canvas-continue"]').trigger('click')
    await wrapper.get('[data-testid="learn-canvas-response"]').setValue('My answer.')
    await wrapper.get('[data-testid="learn-canvas-confidence-4"]').setValue()
    await wrapper.get('[data-testid="learn-canvas-submit"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('Submission did not confirm'))
    expect((wrapper.get('[data-testid="learn-canvas-response"]').element as HTMLTextAreaElement).value).toBe('My answer.')
    expect(submit).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="learn-canvas-submit"]').trigger('click')
    await vi.waitFor(() => expect(stage).toHaveBeenCalledTimes(2))
    expect(stage.mock.calls[0]?.[0].idempotencyKey).toBe(stage.mock.calls[1]?.[0].idempotencyKey)
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
  })

  it('shows a saved unconfirmed scoring outcome and reconciles with the same key', async () => {
    submit.mockRejectedValueOnce(new Error('timeout before commit')).mockResolvedValueOnce({ kind: 'accepted', status: 'completed' })
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const saved = { ...canvas, status: 'submitted', activity: { ...canvas.activity, status: 'submitted' }, savedResponse: { response: 'Saved answer.', confidence: 3 } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: saved } })
    await wrapper.get('[data-testid="learn-canvas-retry-scoring"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('Scoring did not confirm'))
    expect(wrapper.get('[data-testid="learn-canvas-status"]').text()).toContain('outcome is unconfirmed')
    expect(wrapper.find('[data-testid="learn-canvas-saved-fallback"]').exists()).toBe(false)
    await wrapper.get('[data-testid="learn-canvas-retry-scoring"]').trigger('click')
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
    expect(submit.mock.calls[0]?.[0].idempotencyKey).toBe(submit.mock.calls[1]?.[0].idempotencyKey)
    await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-canvas-status"]').text()).toContain('Response scored'))
  })

  it('announces an ambiguous provider outcome without offering another dispatch', async () => {
    submit.mockResolvedValueOnce({ kind: 'blocked', code: 'provider_outcome_requires_reconciliation', message: 'Scoring needs reconciliation.', retryable: false })
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const saved = { ...canvas, status: 'submitted', activity: { ...canvas.activity, status: 'submitted' }, savedResponse: { response: 'Saved answer.', confidence: 3 } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: saved } })
    await wrapper.get('[data-testid="learn-canvas-retry-scoring"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-canvas-status"]').text()).toContain('needs reconciliation'))
    expect(wrapper.find('[data-testid="learn-canvas-retry-scoring"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="learn-canvas-status"]').attributes('role')).toBe('status')
  })

  it('freezes the canonical response before staging and scoring awaits', async () => {
    let finishStage!: (value: unknown) => void
    stage.mockImplementationOnce(() => new Promise(resolve => { finishStage = resolve }))
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: { ...canvas, status: 'started', activity: { ...canvas.activity, status: 'started' }, session: { ...canvas.session, revision: 3 } } } })
    await wrapper.get('[data-testid="learn-canvas-continue"]').trigger('click')
    await wrapper.get('[data-testid="learn-canvas-response"]').setValue('  Frozen answer.  ')
    await wrapper.get('[data-testid="learn-canvas-confidence-4"]').setValue()
    await wrapper.get('[data-testid="learn-canvas-submit"]').trigger('click')
    await vi.waitFor(() => expect(stage).toHaveBeenCalledWith(expect.objectContaining({ response: 'Frozen answer.', confidence: 4 })))
    await wrapper.get('[data-testid="learn-canvas-response"]').setValue('Edited while staging.')
    finishStage({ kind: 'ok', revision: 3, value: { status: 'submitted' } })
    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ response: 'Frozen answer.', confidence: 4 })))
  })

  it('syncs authoritative saved values from another tab before retrying', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: { ...canvas, status: 'started', activity: { ...canvas.activity, status: 'started' }, session: { ...canvas.session, revision: 3 } } } })
    await wrapper.setProps({ canvas: { ...canvas, status: 'submitted', activity: { ...canvas.activity, status: 'submitted' }, session: { ...canvas.session, revision: 3 }, savedResponse: { response: 'Other tab answer.', confidence: 2 } } })
    await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-status"]').exists()).toBe(true))
    await wrapper.get('[data-testid="learn-canvas-retry-scoring"]').trigger('click')
    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ response: 'Other tab answer.', confidence: 2 })))
  })

  it('does not score a local snapshot after a stage conflict reveals an authoritative cross-tab response', async () => {
    let finishStage!: (value: unknown) => void
    stage.mockImplementationOnce(() => new Promise(resolve => { finishStage = resolve }))
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: { ...canvas, status: 'started', activity: { ...canvas.activity, status: 'started' }, session: { ...canvas.session, revision: 3 } } } })
    await wrapper.get('[data-testid="learn-canvas-continue"]').trigger('click')
    await wrapper.get('[data-testid="learn-canvas-response"]').setValue('Local answer A.')
    await wrapper.get('[data-testid="learn-canvas-confidence-4"]').setValue()
    await wrapper.get('[data-testid="learn-canvas-submit"]').trigger('click')
    await vi.waitFor(() => expect(stage).toHaveBeenCalledWith(expect.objectContaining({ response: 'Local answer A.' })))
    await wrapper.setProps({ canvas: { ...canvas, status: 'submitted', activity: { ...canvas.activity, status: 'submitted' }, session: { ...canvas.session, revision: 3 }, savedResponse: { response: 'Authoritative answer B.', confidence: 2 } } })
    finishStage({ kind: 'conflict' })
    await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-error"]').exists()).toBe(true))
    expect(submit).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="learn-canvas-retry-scoring"]').trigger('click')
    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ response: 'Authoritative answer B.', confidence: 2 })))
  })

  it('preserves saved-response status without promising retry in the blocked fallback', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const blockedCanvas = { ...canvas, status: 'blocked', activity: { ...canvas.activity, status: 'submitted', primitive: null }, responsePrompt: null, savedResponse: { response: 'Still saved.', confidence: 5 } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: blockedCanvas } })
    expect(wrapper.get('[data-testid="learn-canvas-saved-fallback"]').text()).toContain('response is saved')
    expect(wrapper.find('[data-testid="learn-canvas-fallback-retry-scoring"]').exists()).toBe(false)
    expect(submit).not.toHaveBeenCalled()
  })

  it('explains invalidated evidence while keeping a staged response and safe action', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const blockedCanvas = { ...canvas, status: 'blocked', activity: { ...canvas.activity, status: 'submitted', primitive: null }, responsePrompt: null,
      savedResponse: { response: 'Still saved.', confidence: 5 },
      recovery: { title: 'Evidence was invalidated', body: 'The earlier support is no longer usable. Your response remains saved.', action: 'Back to Learn' } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: blockedCanvas } })
    expect(wrapper.get('[data-testid="learn-activity-fallback"]').text()).toContain('Evidence was invalidated')
    expect(wrapper.get('[data-testid="learn-canvas-saved-fallback"]').text()).toContain('saved')
    expect(wrapper.get('[data-testid="learn-canvas-fallback-action"]').text()).toBe('Back to Learn')
    expect(submit).not.toHaveBeenCalled()
  })

  it('keeps rendered activity operable and retries a transient meaningful-start acknowledgement', async () => {
    meaningfulStart.mockRejectedValueOnce(new Error('temporary transport failure')).mockResolvedValueOnce({ status: 'recorded', replayed: true })
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: { ...canvas, status: 'started', activity: { ...canvas.activity, status: 'started' }, session: { ...canvas.session, revision: 3 } } } })
    await vi.waitFor(() => expect(meaningfulStart).toHaveBeenCalledTimes(1))
    expect(wrapper.find('[data-testid="learn-primitive-cited-explanation"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="learn-canvas-continue"]').exists()).toBe(true)
    await wrapper.get('[data-testid="learn-canvas-continue"]').trigger('click')
    await vi.waitFor(() => expect(meaningfulStart).toHaveBeenCalledTimes(2))
    expect(wrapper.find('[data-testid="learn-canvas-error"]').exists()).toBe(false)
  })

  it('shows the deterministic fallback action and leaves for Learn', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const blockedCanvas = { ...canvas, status: 'blocked', activity: { ...canvas.activity, primitive: null } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: blockedCanvas } })
    expect(wrapper.get('[role="alert"]').text()).toContain('Try later.')
    expect(wrapper.get('[data-testid="learn-canvas-fallback-action"]').text()).toBe('Continue safely')
    await wrapper.get('[data-testid="learn-canvas-fallback-action"]').trigger('click')
    expect(wrapper.emitted('leave')).toHaveLength(1)
  })

  it('does not regress a newer session revision after delayed start and assistance results', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    let finishStart!: (value: unknown) => void
    start.mockImplementationOnce(() => new Promise(resolve => { finishStart = resolve }))
    let finishAssist!: (value: unknown) => void
    assist.mockImplementationOnce(() => new Promise(resolve => { finishAssist = resolve }))
    const wrapper = await mountSuspended(Comp.default, { props: { canvas } })
    await wrapper.get('[data-testid="learn-canvas-start"]').trigger('click')
    await wrapper.setProps({ canvas: { ...canvas, session: { ...canvas.session, revision: 5 } } })
    finishStart({ status: 'in_progress' })
    await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-continue"]').exists()).toBe(true))
    await wrapper.get('[data-testid="learn-canvas-continue"]').trigger('click')
    await wrapper.get('[data-testid="learn-canvas-hint"]').trigger('click')
    expect(assist).toHaveBeenCalledWith(expect.objectContaining({ expectedSessionRevision: 5 }))
    await wrapper.setProps({ canvas: { ...canvas, status: 'started', session: { ...canvas.session, revision: 8 } } })
    finishAssist({ revision: 6, assistance: { content: 'Think about mass.' } })
    await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-canvas-response"]').exists()).toBe(true))
    await wrapper.get('[data-testid="learn-canvas-response"]').setValue('Earth attracts the apple.')
    await wrapper.get('[data-testid="learn-canvas-confidence-4"]').setValue()
    await wrapper.get('[data-testid="learn-canvas-submit"]').trigger('click')
    await vi.waitFor(() => expect(stage).toHaveBeenCalledWith(expect.objectContaining({ expectedSessionRevision: 8 })))
  })
})
