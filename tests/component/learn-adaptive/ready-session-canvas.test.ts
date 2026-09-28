import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'
import { adaptiveRecoveryCopy } from '~~/shared/learn-adaptive-recovery'

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

  const comparison = {
    ...canvas,
    activity: { ...canvas.activity,
      evidenceScope: { ...canvas.activity.evidenceScope, sourceRefs: ['source_1', 'source_2'] },
      primitive: { ...canvas.activity.primitive, type: 'source_comparison', action: 'submit_comparison', testId: 'learn-primitive-source-comparison',
        props: { prompt: 'Which source better supports the claim?', sources: [
          { sourceRef: 'source_1', label: 'Source A', summary: 'A primary observation.', integrityState: 'accepted' },
          { sourceRef: 'source_2', label: 'Source B', summary: 'A later review.', integrityState: 'accepted' },
        ] } },
      requiredAction: { kind: 'submit_comparison', label: 'Submit comparison' } },
  }

  const primitiveFixtures = [
    { type: 'cited_explanation', action: 'continue', label: 'Continue', props: canvas.activity.primitive.props, heading: 'Gravity' },
    { type: 'worked_example', action: 'reveal_example', label: 'Reveal example', props: { heading: 'Guided gravity', problem: 'Trace the apple.', steps: ['Find the mass.'], guidedConsequence: 'This is guided.', sourceRefs: ['source_1'] }, heading: 'Guided gravity' },
    { type: 'independent_application', action: 'submit_response', label: 'Submit response', props: { prompt: 'Explain why an apple falls.', responseFormat: 'long_text', draftPersistence: true }, heading: 'Apply it independently' },
    { type: 'source_comparison', action: 'choose_source', label: 'Choose source', props: comparison.activity.primitive.props, heading: 'Compare two sources' },
  ] as const

  it.each(primitiveFixtures)('mounts $type in ready, completed, mobile, and fallback states', async fixture => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const activity = { ...canvas.activity,
      evidenceScope: fixture.type === 'source_comparison' ? comparison.activity.evidenceScope : canvas.activity.evidenceScope,
      primitive: { ...canvas.activity.primitive, type: fixture.type, action: fixture.action,
        testId: `learn-primitive-${fixture.type.replaceAll('_', '-')}`, props: fixture.props },
      requiredAction: { kind: fixture.action, label: fixture.label } }
    const readyCanvas = { ...canvas, activity }
    const ready = await mountSuspended(Comp.default, { props: { canvas: readyCanvas }, attachTo: document.body })
    const readyArticle = ready.get(`[data-testid="${activity.primitive.testId}-ready"]`)
    expect(readyArticle.attributes('aria-label')).toBe('Activity ready')
    expect(readyArticle.get('h2').text()).toContain(fixture.heading)
    expect(ready.get('[data-testid="learn-canvas-start"]').element).toBeInstanceOf(HTMLButtonElement)
    ready.unmount()

    const completed = await mountSuspended(Comp.default, { props: { canvas: { ...readyCanvas, status: 'feedback',
      savedResponse: { response: 'Gravity pulls the apple down.', confidence: 4 } } }, attachTo: document.body })
    expect(completed.get(`[data-testid="${activity.primitive.testId}"]`).exists()).toBe(true)
    expect(completed.get('[data-testid="learn-canvas-status"]').attributes('role')).toBe('status')
    expect(completed.get('[data-testid="learn-canvas-status"]').text()).toContain('Response scored')
    completed.unmount()

    const mobile = await mountSuspended(Comp.default, { props: { canvas: { ...readyCanvas, status: 'started' }, showHeader: false }, attachTo: document.body })
    expect(mobile.get('[data-testid="learn-adaptive-canvas"]').attributes('aria-label')).toBe('Current activity')
    expect(mobile.get(`[data-testid="${activity.primitive.testId}"]`).classes()).toContain('min-w-0')
    const mobileAction = fixture.type === 'cited_explanation' ? 'learn-canvas-continue'
      : fixture.type === 'worked_example' ? 'learn-canvas-reveal-example' : 'learn-canvas-submit'
    expect(mobile.get(`[data-testid="${mobileAction}"]`).classes()).toContain('min-h-11')
    mobile.unmount()

    const fallback = await mountSuspended(Comp.default, { props: { canvas: { ...readyCanvas,
      activity: { ...activity, primitive: { ...activity.primitive, rendererVersion: 'learn-adaptive.renderer.v2' } } } }, attachTo: document.body })
    expect(fallback.get('[data-testid="learn-activity-fallback"]').attributes('role')).toBe('alert')
    expect(fallback.get('[data-testid="learn-canvas-fallback-action"]').text()).toBe('Continue safely')
    expect(fallback.find(`[data-testid="${activity.primitive.testId}"]`).exists()).toBe(false)
    fallback.unmount()
  })

  it('renders an independent application and submits through the authoritative scoring path', async () => {
    const application = { ...canvas, status: 'started', activity: { ...canvas.activity,
      primitive: { ...canvas.activity.primitive, type: 'independent_application', action: 'submit_response', testId: 'learn-primitive-independent-application', props: { prompt: 'Explain why an apple falls.', responseFormat: 'long_text', draftPersistence: true } },
      requiredAction: { kind: 'submit_response', label: 'Submit response' } } }
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: application } })
    expect(wrapper.find('[data-testid="learn-primitive-independent-application"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Explain why an apple falls.')
    await wrapper.get('[data-testid="learn-canvas-response"]').setValue('The moon follows a curved path under gravity.')
    await wrapper.get('[data-testid="learn-canvas-confidence-3"]').setValue()
    await wrapper.get('[data-testid="learn-canvas-submit"]').trigger('click')
    await vi.waitFor(() => expect(stage).toHaveBeenCalledWith(expect.objectContaining({ response: 'The moon follows a curved path under gravity.' })))
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce())
    wrapper.unmount()
  })

  it('shows independent ready, scored, and safe fallback states from the plan', async () => {
    const application = { ...canvas, activity: { ...canvas.activity,
      primitive: { ...canvas.activity.primitive, type: 'independent_application', action: 'submit_response', testId: 'learn-primitive-independent-application', props: { prompt: 'Explain why an apple falls.', responseFormat: 'long_text', draftPersistence: true } },
      requiredAction: { kind: 'submit_response', label: 'Submit response' } } }
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const ready = await mountSuspended(Comp.default, { props: { canvas: application } })
    expect(ready.get('[data-testid="learn-primitive-independent-application-ready"]').text()).toContain('Apply it independently')
    ready.unmount()
    const completed = await mountSuspended(Comp.default, { props: { canvas: { ...application, status: 'feedback', savedResponse: { response: 'Gravity pulls the apple toward Earth.', confidence: 4 } } } })
    expect(completed.get('[data-testid="learn-canvas-status"]').text()).toContain('Response scored')
    completed.unmount()
    const mismatched = await mountSuspended(Comp.default, { props: { canvas: { ...application, activity: { ...application.activity,
      primitive: { ...application.activity.primitive, props: { ...application.activity.primitive.props, prompt: 'A different question.' } } } } } })
    expect(mismatched.get('[data-testid="learn-activity-fallback"]').text()).toContain('could not be displayed safely')
    mismatched.unmount()
  })

  it('moves focus to the independent response after Start succeeds', async () => {
    const application = { ...canvas, activity: { ...canvas.activity,
      primitive: { ...canvas.activity.primitive, type: 'independent_application', action: 'submit_response', testId: 'learn-primitive-independent-application', props: { prompt: 'Explain why an apple falls.', responseFormat: 'long_text', draftPersistence: true } },
      requiredAction: { kind: 'submit_response', label: 'Submit response' } } }
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: application }, attachTo: document.body })
    await wrapper.get('[data-testid="learn-canvas-start"]').trigger('click')
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(document.activeElement).toBe(wrapper.get('[data-testid="learn-canvas-independent-response-heading"]').element))
    wrapper.unmount()
  })

  it('renders two accepted source cards and preserves choice and rationale after a failed submission', async () => {
    stage.mockRejectedValueOnce(new Error('timeout before commit'))
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const ready = await mountSuspended(Comp.default, { props: { canvas: comparison } })
    expect(ready.get('[data-testid="learn-primitive-source-comparison-ready"]').text()).toContain('Which source better supports the claim?')
    ready.unmount()
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: { ...comparison, status: 'started' } } })
    const cards = wrapper.findAll('[data-testid^="learn-canvas-comparison-source-"]')
    expect(cards).toHaveLength(2)
    await vi.waitFor(() => expect(meaningfulStart).toHaveBeenCalledWith({ studySessionId: 'session_1', expectedContentRevision: 1 }))
    expect(cards[0]!.text()).toContain('Accepted evidence')
    expect(cards[1]!.text()).toContain('A later review.')
    await wrapper.get('[data-testid="learn-canvas-comparison-choice-2"]').setValue()
    await wrapper.get('[data-testid="learn-canvas-comparison-rationale"]').setValue('The review explains the newer result.')
    await wrapper.get('[data-testid="learn-canvas-confidence-3"]').setValue()
    await wrapper.get('[data-testid="learn-canvas-submit"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('Submission did not confirm'))
    expect((wrapper.get('[data-testid="learn-canvas-comparison-choice-2"]').element as HTMLInputElement).checked).toBe(true)
    expect((wrapper.get('[data-testid="learn-canvas-comparison-rationale"]').element as HTMLTextAreaElement).value).toBe('The review explains the newer result.')
    expect(stage).toHaveBeenCalledWith(expect.objectContaining({ response: '{"version":"learn-adaptive.source-comparison-response.v1","sourceRef":"source_2","rationale":"The review explains the newer result."}' }))
    wrapper.unmount()
  })

  it('focuses the comparison heading after the shared session start succeeds', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: comparison }, attachTo: document.body })
    await wrapper.get('[data-testid="learn-canvas-start"]').trigger('click')
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(document.activeElement).toBe(wrapper.get('[data-testid="learn-canvas-comparison-heading"]').element))
    wrapper.unmount()
  })

  it('renders a saved comparison and refuses a source integrity value that does not match the accepted server scope', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const draftKey = 'learn-comparison:owner_1:thread_1:ready-session:session_1:plan:1'
    sessionStorage.setItem(draftKey, JSON.stringify({ sourceRef: 'source_2', rationale: 'Stale local draft.', savedAt: Date.now() }))
    const saved = await mountSuspended(Comp.default, { props: { canvas: { ...comparison, status: 'feedback', savedResponse: { response: '{"version":"learn-adaptive.source-comparison-response.v1","sourceRef":"source_1","rationale":"It is the primary observation."}', confidence: 4 } } } })
    expect(saved.get('[data-testid="learn-primitive-source-comparison"]').text()).toContain('Accepted evidence')
    expect(saved.get('[data-testid="learn-canvas-comparison-saved"]').text()).toContain('Source A')
    expect((saved.get('[data-testid="learn-canvas-comparison-choice-1"]').element as HTMLInputElement).checked).toBe(true)
    expect(saved.get('[data-testid="learn-canvas-comparison-saved"]').text()).toContain('Rationale: It is the primary observation.')
    expect(sessionStorage.getItem(draftKey)).toBeNull()
    saved.unmount()
    const conflict = { ...comparison, activity: { ...comparison.activity, primitive: { ...comparison.activity.primitive,
      props: { ...comparison.activity.primitive.props, sources: [comparison.activity.primitive.props.sources[0], { ...comparison.activity.primitive.props.sources[1], integrityState: 'conflict' }] } } } }
    const fallback = await mountSuspended(Comp.default, { props: { canvas: conflict } })
    expect(fallback.get('[data-testid="learn-activity-fallback"]').text()).toContain('evidence')
    await vi.waitFor(() => expect(reportRenderFailure).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: 'invalid_evidence_link' })))
    fallback.unmount()
  })

  it('keeps source identity, evidence access, and form errors usable in a narrow layout', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: { ...comparison, status: 'started' } }, attachTo: document.body })
    expect(wrapper.get('[data-testid="learn-primitive-source-comparison"]').classes()).toContain('min-w-0')
    expect(wrapper.get('[data-testid="learn-canvas-comparison-source-1"]').classes()).toContain('min-w-0')
    expect(wrapper.get('[data-testid="learn-canvas-comparison-source-2"]').text()).toContain('Accepted evidence')
    expect(wrapper.get('[data-testid="learn-canvas-source-2"]').attributes('aria-label')).toContain('Source B')
    await wrapper.get('[data-testid="learn-canvas-submit"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('Choose one of the two sources')
    await wrapper.get('[data-testid="learn-canvas-comparison-choice-1"]').setValue()
    await wrapper.get('[data-testid="learn-canvas-submit"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('Explain why')
    expect(document.activeElement).toBe(wrapper.get('[data-testid="learn-canvas-comparison-rationale"]').element)
    await wrapper.get('[data-testid="learn-canvas-comparison-rationale"]').setValue('Primary observation.')
    expect((wrapper.get('[data-testid="learn-canvas-comparison-rationale"]').element as HTMLTextAreaElement).value).toBe('Primary observation.')
    await wrapper.get('[data-testid="learn-canvas-submit"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('Choose your confidence')
    wrapper.unmount()
  })

  it.each([
    ['ASCII', 'a'.repeat(11_950)],
    ['multibyte', '🙂'.repeat(3_000)],
  ])('explains an oversized %s comparison and focuses the rationale without submitting', async (_, rationale) => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: { ...comparison, status: 'started' } }, attachTo: document.body })
    await wrapper.get('[data-testid="learn-canvas-comparison-choice-1"]').setValue()
    await wrapper.get('[data-testid="learn-canvas-comparison-rationale"]').setValue(rationale)
    await wrapper.get('[data-testid="learn-canvas-confidence-3"]').setValue()
    expect(wrapper.get('[data-testid="learn-canvas-submit"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[data-testid="learn-canvas-submit"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('12 KB')
    expect(document.activeElement).toBe(wrapper.get('[data-testid="learn-canvas-comparison-rationale"]').element)
    expect((wrapper.get('[data-testid="learn-canvas-comparison-rationale"]').element as HTMLTextAreaElement).value).toBe(rationale)
    expect(stage).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it.each([
    ['ASCII at the field limit', 'a'.repeat(12_000)],
    ['multibyte', '🙂'.repeat(3_000)],
  ])('restores an oversized %s comparison choice and rationale after refresh', async (_, rationale) => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const current = { ...comparison, status: 'started' }
    const first = await mountSuspended(Comp.default, { props: { canvas: current } })
    await first.get('[data-testid="learn-canvas-comparison-choice-2"]').setValue()
    await first.get('[data-testid="learn-canvas-comparison-rationale"]').setValue(rationale)
    first.unmount()

    const restored = await mountSuspended(Comp.default, { props: { canvas: current } })
    expect((restored.get('[data-testid="learn-canvas-comparison-choice-2"]').element as HTMLInputElement).checked).toBe(true)
    expect((restored.get('[data-testid="learn-canvas-comparison-rationale"]').element as HTMLTextAreaElement).value).toBe(rationale)
    await restored.get('[data-testid="learn-canvas-confidence-3"]').setValue()
    await restored.get('[data-testid="learn-canvas-submit"]').trigger('click')
    expect(restored.get('[role="alert"]').text()).toContain('12 KB')
    expect(stage).not.toHaveBeenCalled()
    restored.unmount()
  })

  it('discards a comparison draft beyond the bounded rationale field', async () => {
    const key = 'learn-comparison:owner_1:thread_1:ready-session:session_1:plan:1'
    sessionStorage.setItem(key, JSON.stringify({ sourceRef: 'source_2', rationale: 'a'.repeat(12_001), savedAt: Date.now() }))
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: { ...comparison, status: 'started' } } })
    expect((wrapper.get('[data-testid="learn-canvas-comparison-choice-2"]').element as HTMLInputElement).checked).toBe(false)
    expect((wrapper.get('[data-testid="learn-canvas-comparison-rationale"]').element as HTMLTextAreaElement).value).toBe('')
    expect(sessionStorage.getItem(key)).toBeNull()
    wrapper.unmount()
  })

  it('restores a blocked comparison draft when the same plan recovers without remounting, but not a new plan', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const current = { ...comparison, status: 'started', activity: { ...comparison.activity, draftKind: 'source_comparison' } }
    const first = await mountSuspended(Comp.default, { props: { canvas: current } })
    await first.get('[data-testid="learn-canvas-comparison-choice-2"]').setValue()
    await first.get('[data-testid="learn-canvas-comparison-rationale"]').setValue('The later review is more direct.')
    first.unmount()

    const blocked = { ...current, status: 'blocked', responsePrompt: null, activity: { ...current.activity, primitive: null } }
    const restored = await mountSuspended(Comp.default, { props: { canvas: blocked } })
    expect(restored.get('[data-testid="learn-activity-fallback"]').exists()).toBe(true)
    expect(restored.find('[data-testid="learn-primitive-source-comparison"]').exists()).toBe(false)
    await restored.setProps({ canvas: current })
    expect((restored.get('[data-testid="learn-canvas-comparison-choice-2"]').element as HTMLInputElement).checked).toBe(true)
    expect((restored.get('[data-testid="learn-canvas-comparison-rationale"]').element as HTMLTextAreaElement).value).toBe('The later review is more direct.')

    await restored.setProps({ canvas: { ...current, activity: { ...current.activity, planRevision: 2 } } })
    expect((restored.get('[data-testid="learn-canvas-comparison-choice-2"]').element as HTMLInputElement).checked).toBe(false)
    expect((restored.get('[data-testid="learn-canvas-comparison-rationale"]').element as HTMLTextAreaElement).value).toBe('')
    await restored.setProps({ canvas: { ...canvas, status: 'started', activity: { ...canvas.activity, planRevision: 3 } } })
    expect((restored.get('[data-testid="learn-canvas-response"]').element as HTMLTextAreaElement).value).toBe('')
    restored.unmount()
  })

  it.each([
    ['conflict', 'An unresolved source conflict'],
    ['gap', 'An evidence gap'],
  ])('names a server-projected %s while keeping the factual activity blocked', async (recoveryEvidenceIssue, message) => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const blocked = { ...comparison, status: 'blocked', recoveryEvidenceIssue, activity: { ...comparison.activity, primitive: null }, responsePrompt: null }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: blocked } })
    expect(wrapper.get('[data-testid="learn-activity-fallback"]').text()).toContain(message)
    expect(wrapper.find('[data-testid="learn-canvas-submit"]').exists()).toBe(false)
    wrapper.unmount()
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

  it('renders cited source controls as keyboard buttons that request the canonical Evidence drawer', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: { ...canvas, status: 'started' } }, attachTo: document.body })
    const article = wrapper.get('[data-testid="learn-primitive-cited-explanation"]')
    expect(article.element.tagName).toBe('ARTICLE')
    const source = wrapper.get('[data-testid="learn-canvas-source-1"]')
    expect(source.element.tagName).toBe('BUTTON')
    expect(source.attributes('type')).toBe('button')
    expect(source.attributes('aria-label')).toContain('Evidence')
    expect(source.attributes('href')).toBeUndefined()
    ;(source.element as HTMLButtonElement).focus()
    expect(document.activeElement).toBe(source.element)
    await source.trigger('click')
    expect(wrapper.emitted('inspectEvidence')?.[0]?.[0]).toBe(source.element)
    wrapper.unmount()
  })

  it('renders a worked example as guided support through reveal and completed states', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const example = { ...canvas, status: 'started', activity: { ...canvas.activity, primitive: {
      ...canvas.activity.primitive, type: 'worked_example', action: 'reveal_example', testId: 'learn-primitive-worked-example',
      props: { heading: 'Gravity example', problem: 'Why does an apple fall?', steps: ['Identify the masses.', 'Describe their attraction.'], guidedConsequence: 'This is guided support and cannot count as an independent attempt.', sourceRefs: ['source_1'] },
    }, requiredAction: { kind: 'reveal_example', label: 'Reveal example' } } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: example }, attachTo: document.body })
    const article = wrapper.get('[data-testid="learn-primitive-worked-example"]')
    expect(article.element.tagName).toBe('ARTICLE')
    expect(article.text()).toContain('guided support and cannot count as an independent attempt')
    expect(article.text()).not.toContain('Identify the masses.')
    await wrapper.get('[data-testid="learn-canvas-reveal-example"]').trigger('click')
    await vi.waitFor(() => expect(assist).toHaveBeenCalledWith({ studySessionId: 'session_1', expectedSessionRevision: 2, kind: 'answer_reveal' }))
    await vi.waitFor(() => expect(article.text()).toContain('Identify the masses.'))
    expect(article.find('ol').exists()).toBe(true)
    expect(document.activeElement).toBe(article.get('h3').element)
    expect(wrapper.get('[data-testid="learn-canvas-worked-status"]').text()).toContain('Guided support reviewed')
    await wrapper.setProps({ canvas: { ...example, session: { ...example.session, revision: 3 }, activity: { ...example.activity, primitive: { ...example.activity.primitive } } } })
    expect(article.text()).toContain('Identify the masses.')
    wrapper.unmount()
  })

  it('keeps worked steps hidden when the server cannot record guided assistance', async () => {
    assist.mockRejectedValueOnce(new Error('revision conflict'))
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const example = { ...canvas, status: 'started', activity: { ...canvas.activity, primitive: {
      ...canvas.activity.primitive, type: 'worked_example', action: 'reveal_example', testId: 'learn-primitive-worked-example',
      props: { heading: 'Gravity example', problem: 'Why?', steps: ['Guided step.'], guidedConsequence: 'Guided support only.', sourceRefs: ['source_1'] },
    }, requiredAction: { kind: 'reveal_example', label: 'Reveal example' } } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: example } })
    await wrapper.get('[data-testid="learn-canvas-reveal-example"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-canvas-error"]').text()).toContain('worked steps remain hidden'))
    expect(wrapper.get('[data-testid="learn-primitive-worked-example"]').text()).not.toContain('Guided step.')
    expect(wrapper.find('[data-testid="learn-canvas-continue"]').exists()).toBe(false)
  })

  it('records an already-visible worked-example plan as guided before allowing the response', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const example = { ...canvas, status: 'started', activity: { ...canvas.activity, primitive: {
      ...canvas.activity.primitive, type: 'worked_example', action: 'continue', testId: 'learn-primitive-worked-example',
      props: { heading: 'Gravity example', problem: 'Why?', steps: ['Guided step.'], guidedConsequence: 'Guided support only.', sourceRefs: ['source_1'] },
    } } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: example } })
    await vi.waitFor(() => expect(assist).toHaveBeenCalledWith({ studySessionId: 'session_1', expectedSessionRevision: 2, kind: 'answer_reveal' }))
    await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-primitive-worked-example"]').text()).toContain('Guided step.'))
    await wrapper.get('[data-testid="learn-canvas-continue"]').trigger('click')
    await wrapper.get('[data-testid="learn-canvas-response"]').setValue('A guided response.')
    await wrapper.get('[data-testid="learn-canvas-confidence-3"]').setValue()
    await wrapper.get('[data-testid="learn-canvas-submit"]').trigger('click')
    await vi.waitFor(() => expect(stage).toHaveBeenCalledWith(expect.objectContaining({ expectedSessionRevision: 4 })))
  })

  it('records meaningful start when a delayed guided acknowledgement makes Continue operable', async () => {
    let finishGuidance!: (value: unknown) => void
    assist.mockImplementationOnce(() => new Promise(resolve => { finishGuidance = resolve }))
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const example = { ...canvas, status: 'started', activity: { ...canvas.activity, primitive: {
      ...canvas.activity.primitive, type: 'worked_example', action: 'continue', testId: 'learn-primitive-worked-example',
      props: { heading: 'Gravity example', problem: 'Why?', steps: ['Guided step.'], guidedConsequence: 'Guided support only.', sourceRefs: ['source_1'] },
    } } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: example } })
    await vi.waitFor(() => expect(assist).toHaveBeenCalledTimes(1))
    expect(meaningfulStart).not.toHaveBeenCalled()
    finishGuidance({ revision: 4, assistance: { content: 'Guided step.' } })
    await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-canvas-continue"]').exists()).toBe(true))
    await vi.waitFor(() => expect(meaningfulStart).toHaveBeenCalledWith({ studySessionId: 'session_1', expectedContentRevision: 1 }))
    wrapper.unmount()
  })

  it('renders primitive-specific ready states before the server-owned session start', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const cited = await mountSuspended(Comp.default, { props: { canvas } })
    expect(cited.get('[data-testid="learn-primitive-cited-explanation-ready"]').text()).toContain('1 accepted source is ready')
    expect(cited.get('[data-testid="learn-canvas-start"]').text()).toBe('Start')
    cited.unmount()

    const example = { ...canvas, activity: { ...canvas.activity, primitive: {
      ...canvas.activity.primitive, type: 'worked_example', action: 'reveal_example', testId: 'learn-primitive-worked-example',
      props: { heading: 'Gravity example', problem: 'Why does an apple fall?', steps: ['Identify the masses.'], guidedConsequence: 'This remains guided.', sourceRefs: ['source_1'] },
    }, requiredAction: { kind: 'reveal_example', label: 'Reveal example' } } }
    const worked = await mountSuspended(Comp.default, { props: { canvas: example } })
    expect(worked.get('[data-testid="learn-primitive-worked-example-ready"]').text()).toContain('Why does an apple fall?')
    expect(worked.get('[data-testid="learn-canvas-ready-guided-consequence"]').text()).toContain('steps remain hidden')
    expect(worked.text()).not.toContain('Identify the masses.')
    expect(worked.get('[data-testid="learn-canvas-start"]').text()).toBe('Start')
    worked.unmount()
  })

  it.each([390, 768])('keeps both primitive controls in one readable column at %ipx', async width => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: { ...canvas, status: 'started' } } })
    expect(wrapper.get('[data-testid="learn-primitive-cited-explanation"]').classes()).toContain('min-w-0')
    expect(wrapper.get('[data-testid="learn-canvas-source-1"]').classes()).toContain('min-h-11')
    expect(wrapper.get('[data-testid="learn-canvas-continue"]').classes()).toContain('focus-visible:ring-2')
    wrapper.unmount()
    const example = { ...canvas, status: 'started', activity: { ...canvas.activity, primitive: { ...canvas.activity.primitive, type: 'worked_example', action: 'continue', testId: 'learn-primitive-worked-example',
      props: { heading: 'Gravity example', problem: 'Why?', steps: ['Trace gravity.'], guidedConsequence: 'Guided support only.', sourceRefs: ['source_1'] } } } }
    const worked = await mountSuspended(Comp.default, { props: { canvas: example } })
    expect(worked.get('[data-testid="learn-primitive-worked-example"]').classes()).toContain('min-w-0')
    expect(worked.get('[data-testid="learn-canvas-source-1"]').classes()).toContain('min-h-11')
    worked.unmount()
  })

  it('keeps a completed worked example labelled as guided, with the saved response status', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const completed = { ...canvas, status: 'feedback', savedResponse: { response: 'Gravity acts between masses.', confidence: 3 }, activity: { ...canvas.activity, primitive: {
      ...canvas.activity.primitive, type: 'worked_example', action: 'continue', testId: 'learn-primitive-worked-example',
      props: { heading: 'Gravity example', problem: 'Why does an apple fall?', steps: ['Identify the masses.'], guidedConsequence: 'This is guided support.', sourceRefs: ['source_1'] },
    } } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: completed } })
    expect(wrapper.get('[data-testid="learn-canvas-worked-status"]').text()).toContain('not an independent attempt or proof of mastery')
    expect(wrapper.get('[data-testid="learn-canvas-status"]').text()).toContain('Response scored')
    expect(wrapper.get('[data-testid="learn-primitive-worked-example"]').text()).toContain('Identify the masses.')
  })

  it('falls back for invalid worked example props and actions with the same bounded report', async () => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const base = { ...canvas, activity: { ...canvas.activity, primitive: { ...canvas.activity.primitive, type: 'worked_example', action: 'continue', testId: 'learn-primitive-worked-example',
      props: { heading: 'Gravity example', problem: 'Why?', steps: ['Trace gravity.'], guidedConsequence: 'Guided support only.', sourceRefs: ['source_1'] } } } }
    const invalid = { ...base, activity: { ...base.activity, primitive: { ...base.activity.primitive, props: { ...base.activity.primitive.props, steps: ['<script>bad</script>'] } } } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: invalid } })
    expect(wrapper.get('[data-testid="learn-activity-fallback"]').text()).toContain('unsupported executable content')
    await vi.waitFor(() => expect(reportRenderFailure).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: 'executable_content' })))
    await wrapper.setProps({ canvas: { ...base, activity: { ...base.activity, primitive: { ...base.activity.primitive, action: 'run_tool' } } } })
    expect(wrapper.get('[data-testid="learn-activity-fallback"]').text()).toContain('action is not supported')
    wrapper.unmount()
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

  it.each(primitiveFixtures)('keeps the $type Canvas boundary and one safe action through server recovery states', async fixture => {
    const Comp = await import('~/components/learn-adaptive/ReadySessionCanvas.vue')
    const activity = { ...canvas.activity,
      evidenceScope: fixture.type === 'source_comparison' ? comparison.activity.evidenceScope : canvas.activity.evidenceScope,
      primitive: { ...canvas.activity.primitive, type: fixture.type, action: fixture.action,
        testId: `learn-primitive-${fixture.type.replaceAll('_', '-')}`, props: fixture.props },
      requiredAction: { kind: fixture.action, label: fixture.label } }
    const current = { ...canvas, status: 'started', activity }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: current }, attachTo: document.body })
    for (const state of ['preparing', 'blocked', 'stale', 'invalidated', 'unavailable'] as const) {
      const recovery = adaptiveRecoveryCopy(state)
      await wrapper.setProps({ canvas: { ...current, status: 'blocked', recoveryState: state, recovery,
        activity: { ...activity, primitive: null }, responsePrompt: null } })
      const boundary = wrapper.get('[data-testid="learn-adaptive-canvas"]')
      expect(boundary.attributes('aria-labelledby')).toBe('learn-canvas-title')
      expect(boundary.get('h1').text()).toBe('Explain gravity')
      const fallback = wrapper.get('[data-testid="learn-activity-fallback"]')
      expect(fallback.attributes('role')).toBe(state === 'preparing' ? 'status' : 'alert')
      expect(fallback.get('h2').text()).toBe(recovery.title)
      expect(fallback.text()).toContain(recovery.body)
      expect(wrapper.find(`[data-testid="${activity.primitive.testId}"]`).exists()).toBe(false)
      const actions = fallback.findAll('button')
      expect(actions).toHaveLength(1)
      expect(actions[0]!.text()).toBe(recovery.action)
      expect(actions[0]!.classes()).toContain('min-h-11')
      expect(actions[0]!.element).toBeInstanceOf(HTMLButtonElement)
      if (state !== 'preparing') await vi.waitFor(() => expect(document.activeElement).toBe(actions[0]!.element))
      await actions[0]!.trigger('click')
      expect(wrapper.emitted('leave')).toHaveLength(['preparing', 'blocked', 'stale', 'invalidated', 'unavailable'].indexOf(state) + 1)
    }
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
