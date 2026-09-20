import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const start = vi.fn()
const assist = vi.fn()
const submit = vi.fn()
const content = ref<any>(null)
const isOnline = ref(true)

mockNuxtImport('useOnlineStatus', () => () => ({ isOnline }))

mockNuxtImport('useConvexMutation', () => (reference: any) => {
  const name = getFunctionName(reference) ?? ''
  if (name.includes('startStudySession')) return { mutate: start }
  if (name.includes('recordAssistanceUse')) return { mutate: assist }
  return { mutate: vi.fn() }
})
mockNuxtImport('useConvexAction', () => (reference: any) => ({ mutate: getFunctionName(reference)?.includes('submitMasteryAttempt') ? submit : vi.fn() }))
mockNuxtImport('useConvexQuery', () => (reference: any) => ({ data: getFunctionName(reference)?.includes('getSessionContent') ? content : ref(null) }))

const path = ['~', 'components', 'learn-v2', 'TodaySession.vue'].join('/')
const candidate = { studySessionId: 'session_1', sessionRevision: 1, contentRevision: 2, planRecordRevision: 3, blueprintRecordRevision: 4, objectiveTitle: 'Explain gravity', estimatedMinutes: 12, scheduledStartAt: 0, scheduledEndAt: 17 * 60_000, timezone: 'America/Toronto', reason: 'due', progress: { retained: 0, independent: 0, total: 1 }, initiallyStarted: false }
const blocks = ['retrieval', 'objective', 'cold_attempt', 'explanation', 'worked_example', 'faded_example', 'independent_application', 'confidence_teach_back'].map((kind, order) => ({ kind, order, content: `${kind} content` }))

describe('LearnV2TodaySession', () => {
  beforeEach(() => {
    start.mockReset().mockResolvedValue({ sessionContentRevision: 2 })
    assist.mockReset().mockResolvedValue({ revision: 3, assistance: { content: 'Server assistance' } })
    submit.mockReset().mockResolvedValue({ status: 'completed', scorePercent: 80, state: 'independent', nextReviewAt: Date.UTC(2026, 8, 24, 13), feedback: { criterionResults: [{ key: 'accuracy', awarded: true, rationale: 'Correctly applied the evidence.' }], misconceptionTags: [] } })
    content.value = { revision: 2, blocks }
    isOnline.value = true
  })
  async function mount(overrides: Partial<typeof candidate> = {}) { const Comp = await import(path); return await mountSuspended(Comp.default, { props: { candidate: { ...candidate, ...overrides } } }) }
  async function startSession(wrapper: any) { await wrapper.find('[data-testid="learn-v2-start"]').trigger('click'); await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1)) }
  async function reachConfidence(wrapper: any) {
    await wrapper.find('[data-testid="learn-v2-continue"]').trigger('click')
    await wrapper.find('textarea[aria-label="Your prediction"]').setValue('prediction')
    await wrapper.find('[data-testid="learn-v2-continue"]').trigger('click')
    await wrapper.find('[data-testid="learn-v2-continue"]').trigger('click')
    await wrapper.find('textarea[aria-label="Your faded-practice response"]').setValue('faded response')
    await wrapper.find('[data-testid="learn-v2-continue"]').trigger('click')
    await wrapper.find('textarea[aria-label="Your transfer response"]').setValue('transfer answer')
    await wrapper.find('[data-testid="learn-v2-continue"]').trigger('click')
  }

  it('offers exactly one initial primary Start action', async () => {
    const wrapper = await mount()
    expect(wrapper.findAll('button').filter((button: any) => button.text() === 'Start')).toHaveLength(1)
    expect(wrapper.find('[data-testid="learn-v2-phase-retrieval"]').exists()).toBe(false)
  })
  it('resumes an authoritative in-progress session without asking to start again', async () => {
    const wrapper = await mount({ initiallyStarted: true })
    expect(wrapper.find('[data-testid="learn-v2-start"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="learn-v2-phase-retrieval"]').isVisible()).toBe(true)
  })
  it('makes an early start explicit without implying the session was rescheduled', async () => {
    const wrapper = await mount({ scheduledStartAt: Date.now() + 48 * 60 * 60_000, scheduledEndAt: Date.now() + 48 * 60 * 60_000 + 17 * 60_000 })
    expect(wrapper.get('[data-testid="learn-v2-session-timing"]').text()).toContain('Next session')
    expect(wrapper.get('[data-testid="learn-v2-early-start-note"]').text()).toContain('You can start now')
    expect(wrapper.get('[data-testid="learn-v2-early-start-note"]').text()).toContain('stays on schedule')
    await startSession(wrapper)
    expect(wrapper.get('[data-testid="learn-v2-session-timing"]').text()).toContain('Today')
    expect(wrapper.find('[data-testid="learn-v2-early-start-note"]').exists()).toBe(false)
  })
  it('keeps the learner oriented with a quiet session path, evidence context, and a safe leave intent', async () => {
    const wrapper = await mount()
    expect(wrapper.get('[data-testid="learn-v2-session-path"]').attributes('aria-label')).toContain('Session progress')
    expect(wrapper.get('[data-testid="learn-v2-evidence-context"]').text()).toContain('evidence')
    await wrapper.get('[data-testid="learn-v2-leave"]').trigger('click')
    expect(wrapper.emitted('leave')).toHaveLength(1)

    await startSession(wrapper)
    expect(wrapper.get('[data-testid="learn-v2-current-stage"]').text()).toContain('Retrieve')
    await wrapper.get('[data-testid="learn-v2-continue"]').trigger('click')
    await wrapper.find('textarea[aria-label="Your prediction"]').setValue('prediction')
    await wrapper.get('[data-testid="learn-v2-continue"]').trigger('click')
    expect(wrapper.get('[data-testid="learn-v2-assistance-consequence"]').text()).toContain('guided')
  })
  it('applies motion, contrast, and untimed-session preferences to rendering', async () => {
    const wrapper = await mount()
    expect(wrapper.text()).toContain('17 minutes')
    await wrapper.get('[data-testid="learn-v2-reduce-motion"]').setValue(true)
    await wrapper.get('[data-testid="learn-v2-enhanced-contrast"]').setValue(true)
    await wrapper.get('[data-testid="learn-v2-hide-time"]').setValue(true)
    const session = wrapper.get('[data-testid="learn-v2-session"]')
    expect(session.classes()).toContain('learn-v2-reduced-motion')
    expect(session.classes()).toContain('learn-v2-enhanced-contrast')
    expect(wrapper.text()).not.toContain('17 minutes')
  })
  it('falls back to objective effort when a valid scheduled interval is unavailable', async () => {
    expect((await mount({ scheduledEndAt: undefined })).text()).toContain('12 minutes')
    expect((await mount({ scheduledEndAt: 0 })).text()).toContain('12 minutes')
  })
  it('keeps server-scored sessions unavailable offline without queuing an attempt', async () => {
    isOnline.value = false
    const wrapper = await mount()
    const startButton = wrapper.find('[data-testid="learn-v2-start"]')
    expect((startButton.element as HTMLButtonElement).disabled).toBe(true)
    expect(wrapper.get('[data-testid="learn-v2-offline-notice"]').text()).toContain('Server-scored sessions require a connection')
    await startButton.trigger('click')
    expect(start).not.toHaveBeenCalled()
  })
  it('progressively discloses the canonical phase order after start', async () => {
    const wrapper = await mount(); await startSession(wrapper)
    for (const phase of ['retrieval', 'prediction', 'teaching', 'fading', 'transfer', 'confidence']) {
      expect(wrapper.find(`[data-testid="learn-v2-phase-${phase}"]`).exists()).toBe(true)
      if (phase === 'prediction') await wrapper.find('textarea[aria-label="Your prediction"]').setValue('prediction')
      if (phase === 'fading') await wrapper.find('textarea[aria-label="Your faded-practice response"]').setValue('practice')
      if (phase === 'transfer') await wrapper.find('textarea[aria-label="Your transfer response"]').setValue('transfer')
      if (phase !== 'confidence') await wrapper.find('[data-testid="learn-v2-continue"]').trigger('click')
    }
  })
  it('requires prediction, response, and confidence before progressing or submitting', async () => {
    const wrapper = await mount(); await startSession(wrapper)
    await wrapper.find('[data-testid="learn-v2-continue"]').trigger('click')
    expect((wrapper.find('[data-testid="learn-v2-continue"]').element as HTMLButtonElement).disabled).toBe(true)
    await wrapper.find('textarea[aria-label="Your prediction"]').setValue('guess'); await wrapper.find('[data-testid="learn-v2-continue"]').trigger('click'); await wrapper.find('[data-testid="learn-v2-continue"]').trigger('click')
    expect((wrapper.find('[data-testid="learn-v2-continue"]').element as HTMLButtonElement).disabled).toBe(true)
    await wrapper.find('textarea[aria-label="Your faded-practice response"]').setValue('practice'); await wrapper.find('[data-testid="learn-v2-continue"]').trigger('click')
    expect((wrapper.find('[data-testid="learn-v2-continue"]').element as HTMLButtonElement).disabled).toBe(true)
    await wrapper.find('textarea[aria-label="Your transfer response"]').setValue('transfer'); await wrapper.find('[data-testid="learn-v2-continue"]').trigger('click')
    expect((wrapper.find('[data-testid="learn-v2-submit"]').element as HTMLButtonElement).disabled).toBe(true)
  })
  it('obtains reveal and hint from the server and uses returned revisions', async () => {
    const wrapper = await mount(); await startSession(wrapper)
    await wrapper.find('[data-testid="learn-v2-continue"]').trigger('click'); await wrapper.find('textarea[aria-label="Your prediction"]').setValue('guess'); await wrapper.find('[data-testid="learn-v2-continue"]').trigger('click')
    await wrapper.find('[data-testid="learn-v2-reveal"]').trigger('click'); await vi.waitFor(() => expect(assist).toHaveBeenCalledWith(expect.objectContaining({ kind: 'answer_reveal', expectedSessionRevision: 2 })))
    await wrapper.find('[data-testid="learn-v2-continue"]').trigger('click'); await wrapper.find('[data-testid="learn-v2-hint"]').trigger('click')
    await vi.waitFor(() => expect(assist).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'substantive_hint', expectedSessionRevision: 3 })))
  })
  it('guards duplicate starts and submits while requests are pending', async () => {
    let resolve!: (value: any) => void; start.mockImplementation(() => new Promise(r => { resolve = r }))
    const wrapper = await mount(); const button = wrapper.find('[data-testid="learn-v2-start"]'); await button.trigger('click'); await button.trigger('click'); expect(start).toHaveBeenCalledTimes(1); resolve({ sessionContentRevision: 2 })
  })
  it('renders pending scoring and retries with the same request key', async () => {
    submit.mockResolvedValueOnce({ status: 'in_progress', replayed: false }).mockResolvedValueOnce({ status: 'completed', scorePercent: 80, state: 'independent' })
    const wrapper = await mount(); await startSession(wrapper); await reachConfidence(wrapper)
    await wrapper.find('textarea[aria-label="Teach it back"]').setValue('teach'); await wrapper.find('input[value="4"]').setValue(); await wrapper.find('[data-testid="learn-v2-submit"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-v2-score-pending"]').exists()).toBe(true)); const first = submit.mock.calls[0]![0].idempotencyKey
    isOnline.value = false; await wrapper.vm.$nextTick()
    expect((wrapper.find('[data-testid="learn-v2-score-retry"]').element as HTMLButtonElement).disabled).toBe(true)
    isOnline.value = true; await wrapper.vm.$nextTick(); await wrapper.find('[data-testid="learn-v2-score-retry"]').trigger('click')
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2)); expect(submit.mock.calls[1]![0].idempotencyKey).toBe(first)
  })
  it('announces and displays server feedback and next review', async () => {
    const wrapper = await mount(); await startSession(wrapper); await reachConfidence(wrapper)
    await wrapper.find('textarea[aria-label="Teach it back"]').setValue('teach'); await wrapper.find('input[value="5"]').setValue(); await wrapper.find('[data-testid="learn-v2-submit"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Score: 80%')); expect(wrapper.text()).toContain('Correctly applied the evidence.'); expect(submit).toHaveBeenCalledWith(expect.objectContaining({ response: 'transfer answer' })); expect(wrapper.find('[data-testid="learn-v2-live"]').attributes('aria-live')).toBe('polite'); await wrapper.find('[data-testid="learn-v2-next-review"]').trigger('click'); expect(wrapper.find('[data-testid="learn-v2-next-review-panel"]').text()).not.toContain('No further review')
  })
})
