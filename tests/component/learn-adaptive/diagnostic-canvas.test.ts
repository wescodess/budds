import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const continueDraft = vi.fn()
const submit = vi.fn()
const renderAck = vi.fn()
const isOnline = ref(true)
mockNuxtImport('useOnlineStatus', () => () => ({ isOnline }))
mockNuxtImport('useConvexMutation', () => (reference: never) => {
  const name = getFunctionName(reference) ?? ''
  return { mutate: name.includes('continueDraft') ? continueDraft : name.includes('recordDiagnosticRendered') ? renderAck : submit }
})

const base = {
  ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Check my understanding', intent: 'refresh', revision: 2 },
  status: 'eligible', evidenceState: 'preparing', decisionPending: false,
  recovery: { title: 'Your material is preparing', body: 'You can record what you already know while the selected material prepares.', action: 'Review source' },
  activity: { id: 'diagnostic:thread_1', status: 'eligible', primitive: { type: 'diagnostic_prompt', action: 'submit_response', testId: 'learn-primitive-diagnostic-prompt', props: { prompt: 'What do you already know?', responseFormat: 'short_text' } }, response: null,
    requiredAction: { kind: 'submit_response', label: 'Save response' } },
}

describe('standalone diagnostic Canvas', () => {
  beforeEach(() => { continueDraft.mockReset().mockResolvedValue({ kind: 'ok' }); submit.mockReset().mockResolvedValue({ kind: 'ok' }); renderAck.mockReset().mockResolvedValue({ status: 'recorded' }); isOnline.value = true; sessionStorage.clear() })

  it('restores an unsaved owner-scoped response draft after refresh without overriding a saved response', async () => {
    const Comp = await import('~/components/learn-adaptive/DiagnosticCanvas.vue')
    const first = await mountSuspended(Comp.default, { props: { canvas: base } })
    await first.get('[data-testid="learn-diagnostic-response"]').setValue('My unsaved explanation.')
    first.unmount()
    const restored = await mountSuspended(Comp.default, { props: { canvas: base } })
    expect((restored.get('[data-testid="learn-diagnostic-response"]').element as HTMLTextAreaElement).value).toBe('My unsaved explanation.')
    restored.unmount()
    const saved = await mountSuspended(Comp.default, { props: { canvas: { ...base, activity: { ...base.activity, response: 'Authoritative answer.' } } } })
    expect(saved.get('[data-testid="learn-diagnostic-saved"]').text()).toContain('Authoritative answer.')
    expect(JSON.stringify(sessionStorage)).not.toContain('My unsaved explanation.')
  })

  it('expires an unsent response draft after 24 hours', async () => {
    const key = 'learn-response:owner_1:thread_1:diagnostic:thread_1'
    sessionStorage.setItem(key, JSON.stringify({ response: 'Expired private answer.', confidence: null, savedAt: Date.now() - 25 * 60 * 60 * 1_000 }))
    const Comp = await import('~/components/learn-adaptive/DiagnosticCanvas.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: base } })
    expect((wrapper.get('[data-testid="learn-diagnostic-response"]').element as HTMLTextAreaElement).value).toBe('')
    expect(sessionStorage.getItem(key)).toBeNull()
  })

  it('does not acknowledge an activity while URL selection keeps its Canvas hidden', async () => {
    const Comp = await import('~/components/learn-adaptive/DiagnosticCanvas.vue')
    const hidden = { ...base, activity: { ...base.activity, id: 'diagnostic:thread_hidden' } }
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: hidden, active: false } })
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(renderAck.mock.calls.some(([input]) => input.activityId === 'diagnostic:thread_hidden')).toBe(false)
    await wrapper.setProps({ active: true })
    await vi.waitFor(() => expect(renderAck).toHaveBeenCalledWith({ threadId: 'thread_1', activityId: 'diagnostic:thread_hidden' }))
  })

  it('starts from the draft and renders an operable registered diagnostic', async () => {
    const Comp = await import('~/components/learn-adaptive/DiagnosticCanvas.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: { ...base, status: 'draft', thread: { ...base.thread, revision: 1 }, activity: null } } })
    await wrapper.get('[data-testid="learn-diagnostic-start"]').trigger('click')
    await vi.waitFor(() => expect(continueDraft).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thread_1', expectedRevision: 1 })))
    await wrapper.setProps({ canvas: base })
    expect(wrapper.get('[data-testid="learn-primitive-diagnostic-prompt"]').text()).toContain('already know')
    expect(wrapper.get('[data-testid="learn-diagnostic-submit"]').attributes('disabled')).toBeUndefined()
    await vi.waitFor(() => expect(renderAck).toHaveBeenCalledWith({ threadId: 'thread_1', activityId: 'diagnostic:thread_1' }))
  })

  it('saves one response and keeps it visible through a ready status transition', async () => {
    const Comp = await import('~/components/learn-adaptive/DiagnosticCanvas.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: base } })
    await wrapper.get('[data-testid="learn-diagnostic-response"]').setValue('  I know the first part.  ')
    await wrapper.get('[data-testid="learn-diagnostic-submit"]').trigger('click')
    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ activityId: 'diagnostic:thread_1', expectedRevision: 2, response: 'I know the first part.' })))
    expect(wrapper.get('[data-testid="learn-diagnostic-saved"]').text()).toContain('I know the first part.')
    await wrapper.setProps({ canvas: { ...base, evidenceState: 'ready', recovery: { title: 'Source status changed', body: 'Open Learn to choose a supported session.', action: 'Open Learn' }, activity: { ...base.activity, status: 'submitted', response: 'I know the first part.' } } })
    expect(wrapper.get('[data-testid="learn-diagnostic-saved"]').text()).toContain('I know the first part.')
    expect(wrapper.get('[data-testid="learn-diagnostic-recovery"]').text()).toContain('supported session')
    expect(wrapper.find('[data-testid="learn-diagnostic-submit"]').exists()).toBe(false)
  })

  it('shows state-specific recovery and safe fallback with a reachable action', async () => {
    const Comp = await import('~/components/learn-adaptive/DiagnosticCanvas.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: { ...base, evidenceState: 'invalidated', recovery: { title: 'Evidence was invalidated', body: 'The earlier support is no longer usable. Your response remains saved.', action: 'Review source' }, activity: { ...base.activity, primitive: null, response: 'Saved response' } } } })
    expect(wrapper.get('[data-testid="learn-diagnostic-recovery"]').text()).toContain('invalidated')
    expect(wrapper.get('[data-testid="learn-diagnostic-fallback"]').text()).toContain('saved')
    await wrapper.get('[data-testid="learn-diagnostic-recovery-action"]').trigger('click')
    expect(wrapper.emitted('leave')).toHaveLength(1)
    expect(submit).not.toHaveBeenCalled()
  })

  it('keeps the response usable when render telemetry fails and retries it without blocking save', async () => {
    renderAck.mockRejectedValueOnce(new Error('temporary telemetry failure')).mockResolvedValueOnce({ status: 'recorded', replayed: true })
    const Comp = await import('~/components/learn-adaptive/DiagnosticCanvas.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: base } })
    await vi.waitFor(() => expect(renderAck).toHaveBeenCalledTimes(1))
    expect(wrapper.find('[data-testid="learn-diagnostic-error"]').exists()).toBe(false)
    await wrapper.get('[data-testid="learn-diagnostic-response"]').setValue('My starting point.')
    await wrapper.get('[data-testid="learn-diagnostic-submit"]').trigger('click')
    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ response: 'My starting point.' })))
    expect(wrapper.get('[data-testid="learn-diagnostic-saved"]').text()).toContain('My starting point.')
    await vi.waitFor(() => expect(renderAck).toHaveBeenCalledTimes(2))
  })

  it('uses a fresh key after a server conflict for both continuation and response', async () => {
    continueDraft.mockResolvedValueOnce({ kind: 'conflict' }).mockResolvedValueOnce({ kind: 'ok' })
    submit.mockResolvedValueOnce({ kind: 'conflict' }).mockResolvedValueOnce({ kind: 'ok' })
    const Comp = await import('~/components/learn-adaptive/DiagnosticCanvas.vue')
    const wrapper = await mountSuspended(Comp.default, { props: { canvas: { ...base, status: 'draft', thread: { ...base.thread, revision: 1 }, activity: null } } })
    await wrapper.get('[data-testid="learn-diagnostic-start"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-diagnostic-error"]').exists()).toBe(true))
    await wrapper.setProps({ canvas: { ...base, status: 'draft', thread: { ...base.thread, revision: 2 }, activity: null } })
    await wrapper.get('[data-testid="learn-diagnostic-start"]').trigger('click')
    await vi.waitFor(() => expect(continueDraft).toHaveBeenCalledTimes(2))
    expect(continueDraft.mock.calls[0]![0].idempotencyKey).not.toBe(continueDraft.mock.calls[1]![0].idempotencyKey)
    await wrapper.setProps({ canvas: { ...base, thread: { ...base.thread, revision: 3 } } })
    await wrapper.get('[data-testid="learn-diagnostic-response"]').setValue('My answer.')
    await wrapper.get('[data-testid="learn-diagnostic-submit"]').trigger('click')
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
    await wrapper.setProps({ canvas: { ...base, thread: { ...base.thread, revision: 4 } } })
    await wrapper.get('[data-testid="learn-diagnostic-submit"]').trigger('click')
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
    expect(submit.mock.calls[0]![0].idempotencyKey).not.toBe(submit.mock.calls[1]![0].idempotencyKey)
  })
})
