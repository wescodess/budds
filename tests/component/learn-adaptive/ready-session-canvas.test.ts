import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const start = vi.fn()
const assist = vi.fn()
const stage = vi.fn()
const submit = vi.fn()
const meaningfulStart = vi.fn()
const applyOverride = vi.fn()
const isOnline = ref(true)

mockNuxtImport('useOnlineStatus', () => () => ({ isOnline }))
mockNuxtImport('useConvexMutation', () => (reference: never) => {
  const name = getFunctionName(reference) ?? ''
  return { mutate: name.includes('startStudySession') ? start : name.includes('recordMeaningfulActivityStarted') ? meaningfulStart : name.includes('recordAssistanceUse') ? assist : name.includes('submitCanvasResponse') ? stage : name.includes('applyOverride') ? applyOverride : vi.fn() }
})
mockNuxtImport('useConvexAction', () => (reference: never) => ({ mutate: getFunctionName(reference)?.includes('submitResponse') ? submit : vi.fn() }))

const canvas = {
  ownerId: 'owner_1', status: 'ready', thread: { id: 'thread_1', outcome: 'Explain gravity', intent: 'understand', revision: 2 },
  activity: { id: 'ready-session:session_1', status: 'eligible', purpose: 'Study a supported explanation.', reasonCode: 'ready_v2_session',
    primitive: { type: 'cited_explanation', action: 'continue', testId: 'learn-primitive-cited-explanation', props: { heading: 'Gravity', explanation: 'Gravity attracts masses.', sourceRefs: ['source_1'] } },
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
    isOnline.value = true
    sessionStorage.clear()
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

  it('reveals the existing answer step after the server accepts Answer now', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const controlled = { ...canvas, status: 'started', activity: { ...canvas.activity, status: 'started', controls: {
      reasonText: { version: 'learn-adaptive.reason-text.v1', purpose: 'Study a supported explanation.', text: 'This activity uses accepted sources.' }, selected: null, fixedNextPlan: null,
      options: [{ key: 'answer_now' as const, label: 'Answer now', available: true, unavailableReason: null }],
    } } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: controlled } })
    expect(wrapper.find('[data-testid="learn-canvas-response"]').exists()).toBe(false)
    await wrapper.get('[data-testid="learn-why-toggle"]').trigger('click')
    await wrapper.get('[data-testid="learn-override-answer_now"]').trigger('click')
    await vi.waitFor(() => expect(applyOverride).toHaveBeenCalledWith(expect.objectContaining({ option: 'answer_now' })))
    await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-response"]').exists()).toBe(true))
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
    expect(wrapper.get('[role="status"]').text()).toContain('Try later.')
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
