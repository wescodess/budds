import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const start = vi.fn()
const assist = vi.fn()
const stage = vi.fn()
const submit = vi.fn()
const isOnline = ref(true)

mockNuxtImport('useOnlineStatus', () => () => ({ isOnline }))
mockNuxtImport('useConvexMutation', () => (reference: never) => {
  const name = getFunctionName(reference) ?? ''
  return { mutate: name.includes('startStudySession') ? start : name.includes('recordAssistanceUse') ? assist : name.includes('submitCanvasResponse') ? stage : vi.fn() }
})
mockNuxtImport('useConvexAction', () => (reference: never) => ({ mutate: getFunctionName(reference)?.includes('submitResponse') ? submit : vi.fn() }))

const canvas = {
  status: 'ready', thread: { id: 'thread_1', outcome: 'Explain gravity', intent: 'understand', revision: 2 },
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
    isOnline.value = true
  })

  it('starts in the thread and submits one independent response through shared V2 admission', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { canvas } })
    expect(wrapper.text()).toContain('Explain gravity')
    await wrapper.get('[data-testid="learn-canvas-start"]').trigger('click')
    await vi.waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({ studySessionId: 'session_1', expectedSessionRevision: 2 })))
    await wrapper.get('[data-testid="learn-canvas-continue"]').trigger('click')
    expect(wrapper.get('[data-testid="learn-canvas-response-prompt"]').text()).toContain('apple falls')
    await wrapper.get('[data-testid="learn-canvas-response"]').setValue('Earth attracts the apple.')
    await wrapper.get('[data-testid="learn-canvas-confidence-4"]').setValue()
    await wrapper.get('[data-testid="learn-canvas-submit"]').trigger('click')
    await vi.waitFor(() => expect(stage).toHaveBeenCalledWith(expect.objectContaining({ activityId: 'ready-session:session_1', expectedRevision: 2, expectedSessionRevision: 3 })))
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thread_1', activityId: 'ready-session:session_1', response: 'Earth attracts the apple.', confidence: 4 }))
    expect(wrapper.get('[data-testid="learn-canvas-status"]').text()).toContain('Scoring')
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
