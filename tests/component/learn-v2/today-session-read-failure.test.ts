import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'
import { deniedRead, resetTeachingReads, teachingClient, teachingRead } from '../support/teaching-reads'

vi.mock('#shared/learn-v2-measurement-storage-manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#shared/learn-v2-measurement-storage-manifest')>()
  return { ...actual, LEARN_MEASUREMENT_CAPABILITIES: { ...actual.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})

const start = vi.fn()
const assist = vi.fn()
const isOnline = ref(true)
const content = teachingRead('learnV2SessionContent:getSessionContent')

mockNuxtImport('useConvex', () => () => teachingClient)
mockNuxtImport('useOnlineStatus', () => () => ({ isOnline }))
mockNuxtImport('useConvexMutation', () => (reference: any) => {
  const name = getFunctionName(reference) ?? ''
  if (name.includes('startStudySession')) return { mutate: start }
  if (name.includes('recordAssistanceUse')) return { mutate: assist }
  return { mutate: vi.fn().mockResolvedValue({ status: 'recorded' }) }
})
mockNuxtImport('useConvexAction', () => () => ({ mutate: vi.fn() }))

const path = ['~', 'components', 'learn-v2', 'TodaySession.vue'].join('/')
const candidate = { studySessionId: 'session_1', sessionRevision: 1, contentRevision: 2, planRecordRevision: 3, blueprintRecordRevision: 4, objectiveTitle: 'Explain gravity', estimatedMinutes: 12, scheduledStartAt: 0, timezone: 'America/Toronto', reason: 'due', progress: { retained: 0, independent: 0, total: 1 } }
const blocks = ['retrieval', 'objective', 'cold_attempt', 'explanation', 'worked_example', 'faded_example', 'independent_application', 'confidence_teach_back'].map((kind, order) => ({ kind, order, content: `${kind} content` }))
const adaptivePresentation = { purpose: 'Read the supported explanation and continue.', reasonCode: 'accepted_evidence_explanation', requiredAction: { kind: 'continue', label: 'Continue' }, composition: { type: 'cited_explanation', testId: 'learn-primitive-cited-explanation', heading: 'Supported concept', explanation: 'The accepted evidence supports this explanation.' } }
const pausedCopy = 'This is paused while you have a check open. Finish the check, then come back.'

describe('LearnV2TodaySession with responses on', () => {
  beforeEach(() => {
    resetTeachingReads()
    start.mockReset().mockResolvedValue({ sessionContentRevision: 2 })
    assist.mockReset().mockResolvedValue({ revision: 3, assistance: { content: 'Server assistance' } })
    isOnline.value = true
  })
  async function mount() { const Comp = await import(path); return await mountSuspended(Comp.default, { props: { candidate } }) }
  async function startSession(wrapper: any) { await wrapper.find('[data-testid="learn-v2-start"]').trigger('click'); await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1)) }

  it('explains an open check, offers no retry and keeps Continue disabled', async () => {
    content.error.value = deniedRead('test_open')
    const wrapper = await mount(); await startSession(wrapper)
    const paused = wrapper.get('[data-testid="learn-v2-content-paused"]')
    expect(paused.attributes('role')).toBe('status')
    expect(paused.text()).toBe(pausedCopy)
    expect(paused.find('svg').classes()).toContain('text-[var(--learn-attention)]')
    expect(wrapper.find('[data-testid="learn-v2-content-retry"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Preparing the supported material')
    expect(wrapper.get('[data-testid="learn-v2-continue"]').attributes('disabled')).toBeDefined()
  })

  it('drops server-delivered hints and worked examples when a check opens mid-session', async () => {
    content.data.value = { revision: 2, blocks, adaptivePresentation }
    const wrapper = await mount(); await startSession(wrapper)
    await vi.waitFor(() => expect(wrapper.text()).toContain('retrieval content'))
    await wrapper.get('[data-testid="learn-v2-continue"]').trigger('click')
    await wrapper.find('textarea[aria-label="Your prediction"]').setValue('prediction')
    await wrapper.get('[data-testid="learn-v2-continue"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-reveal"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-v2-reveal-content"]').text()).toContain('Server assistance'))
    expect(wrapper.text()).toContain('explanation content')

    content.error.value = deniedRead('test_open')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="learn-v2-content-paused"]').exists()).toBe(true))
    expect(wrapper.find('[data-testid="learn-v2-reveal-content"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Server assistance')
    expect(wrapper.text()).not.toContain('explanation content')
    expect(wrapper.get('[data-testid="learn-v2-reveal"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="learn-v2-continue"]').attributes('disabled')).toBeDefined()
  })

  it('says plainly when disclosure is unknown', async () => {
    content.error.value = deniedRead('disclosure_unknown')
    const wrapper = await mount(); await startSession(wrapper)
    expect(wrapper.get('[data-testid="learn-v2-content-paused"]').text()).toBe('This isn’t available right now.')
    expect(wrapper.find('[data-testid="learn-v2-content-retry"]').exists()).toBe(false)
  })

  it('retries an unavailable read by subscribing again and recovers', async () => {
    content.error.value = deniedRead('unavailable')
    const wrapper = await mount(); await startSession(wrapper)
    expect(wrapper.get('[data-testid="learn-v2-content-error"]').attributes('role')).toBe('alert')
    expect(wrapper.get('[data-testid="learn-v2-content-error"]').text()).toContain('Could not load this part of your session.')
    const before = content.subscriptions
    content.error.value = null
    content.data.value = undefined
    await wrapper.get('[data-testid="learn-v2-content-retry"]').trigger('click')
    expect(content.subscriptions).toBe(before + 1)
    content.data.value = { revision: 2, blocks, adaptivePresentation }
    await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-v2-phase-retrieval"]').text()).toContain('retrieval content'))
    expect(wrapper.find('[data-testid="learn-v2-content-error"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="learn-v2-continue"]').attributes('disabled')).toBeUndefined()
  })

  it('clears a stale network error when the live subscription later succeeds', async () => {
    content.error.value = new Error('Network request failed')
    const wrapper = await mount(); await startSession(wrapper)
    expect(wrapper.find('[data-testid="learn-v2-content-retry"]').exists()).toBe(true)
    content.error.value = null
    content.data.value = { revision: 2, blocks, adaptivePresentation }
    await vi.waitFor(() => expect(wrapper.get('[data-testid="learn-v2-phase-retrieval"]').text()).toContain('retrieval content'))
    expect(wrapper.find('[data-testid="learn-v2-content-error"]').exists()).toBe(false)
  })
})
