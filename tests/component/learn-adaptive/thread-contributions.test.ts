import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { getFunctionName } from 'convex/server'

const allowed = ref(true)
const user = ref<{ _id: string } | null>({ _id: 'owner_1' })
const projection = ref<Record<string, unknown> | null>(null)
const contributions = ref<Record<string, unknown>>({ page: [], isDone: true, continueCursor: '' })
const convert = vi.fn()
const requestedRoute = reactive({ params: { threadId: 'thread_1' }, query: {} as Record<string, string> })

mockNuxtImport('useLearnAdaptiveAccess', () => () => ({ allowed, checkingAccess: ref(false) }))
mockNuxtImport('useRoute', () => () => requestedRoute)
mockNuxtImport('useConvexMutation', () => (reference: never) => ({
  mutate: getFunctionName(reference) === 'learnAdaptive:convertContributionToActivity' ? convert : vi.fn().mockResolvedValue({ kind: 'ok' }),
}))
mockNuxtImport('useConvexQuery', () => (reference: never) => {
  const name = getFunctionName(reference)
  const data = name === 'users:getUser' ? user
    : name === 'learnAdaptive:getThread' ? projection
      : name === 'learnAdaptive:listThreadContributions' ? contributions : ref(null)
  return { data, pending: ref(false) }
})

const path = ['~', 'pages', 'app', 'learn', 'thread', '[threadId].vue'].join('/')

function contribution(id: string, overrides: Record<string, unknown> = {}) {
  return { _id: id, userId: 'auth-issuer|owner_1', threadId: 'thread_1', sourceIdentity: 'private-source-id', sourceRevision: 'sha256:private-revision', sourceFeature: 'chat',
    contributionKind: 'context', classification: 'non_factual', sourceStatus: 'available', metadata: {}, createdAt: 1, ...overrides }
}

describe('adaptive thread contribution conversion', () => {
  beforeEach(() => {
    allowed.value = true
    user.value = { _id: 'owner_1' }
    requestedRoute.params.threadId = 'thread_1'
    requestedRoute.query = {}
    projection.value = {
      ownerId: 'owner_1', thread: { id: 'thread_1', outcome: 'Keep learning', intent: 'understand', evidenceState: 'none', lifecycle: 'active', revision: 7, authorityKind: 'standalone' },
      currentActivity: null, artifact: null, history: [], nextAction: { kind: 'continue', label: 'Continue' },
    }
    contributions.value = { page: [], isDone: true, continueCursor: '' }
    convert.mockReset()
  })

  it('offers only available non-factual contributions and keeps source identifiers private', async () => {
    contributions.value = { page: [
      contribution('contribution_safe'),
      contribution('contribution_factual', { classification: 'accepted_evidence' }),
      contribution('contribution_stale', { sourceStatus: 'source_revision_changed' }),
      contribution('contribution_other_thread', { threadId: 'thread_other' }),
    ], isDone: true, continueCursor: '' }
    const Page = await import(path)
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })

    const chooser = wrapper.get('[data-testid="learn-thread-contributions"]')
    expect(chooser.text()).toContain('Chat')
    expect(chooser.text()).toContain('non-factual context')
    expect(chooser.text()).toContain('factual authority')
    expect(chooser.text()).toContain('Source changed')
    expect(chooser.text()).not.toContain('private-source-id')
    expect(chooser.text()).not.toContain('sha256:private-revision')
    expect(chooser.findAll('[data-testid="learn-convert-contribution"]')).toHaveLength(1)
    wrapper.unmount()
  })

  it('retries an unconfirmed conversion with the same key and reports its non-scoring result', async () => {
    contributions.value = { page: [contribution('contribution_safe')], isDone: true, continueCursor: '' }
    convert.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ kind: 'ok', value: { activityId: 'activity_2', activityClass: 'non_factual' }, revision: 8 })
    const Page = await import(path)
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })

    await wrapper.get('[data-testid="learn-convert-contribution"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="learn-thread-conversion-error"]').text()).toContain('outcome could not be confirmed')
    expect(convert).toHaveBeenCalledTimes(1)
    const firstCommand = convert.mock.calls[0]![0]
    expect(firstCommand).toMatchObject({ threadId: 'thread_1', contributionId: 'contribution_safe', expectedRevision: 7 })
    expect(firstCommand.idempotencyKey).toEqual(expect.any(String))

    await wrapper.get('[data-testid="learn-thread-conversion-retry"]').trigger('click')
    await flushPromises()
    expect(convert).toHaveBeenCalledTimes(2)
    expect(convert.mock.calls[1]![0]).toEqual(firstCommand)
    expect(wrapper.get('[data-testid="learn-thread-conversion-notice"]').text()).toContain('unscored')
    expect(wrapper.get('[data-testid="learn-thread-conversion-notice"]').text()).toContain('does not award mastery')
    expect(wrapper.find('[data-testid="learn-convert-contribution"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows a changed source as unavailable after authoritative rejection even if the list is stale', async () => {
    contributions.value = { page: [contribution('contribution_safe')], isDone: true, continueCursor: '' }
    convert.mockResolvedValueOnce({ kind: 'blocked', code: 'source_revision_changed' })
    const Page = await import(path)
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })

    await wrapper.get('[data-testid="learn-convert-contribution"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="learn-thread-contribution-row"]').text()).toContain('Source changed')
    expect(wrapper.find('[data-testid="learn-convert-contribution"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('requires a fresh selection after a revision conflict and resets retry state on thread switch', async () => {
    contributions.value = { page: [contribution('contribution_safe')], isDone: true, continueCursor: '' }
    convert.mockResolvedValueOnce({ kind: 'conflict', code: 'stale_revision' }).mockRejectedValueOnce(new Error('timeout'))
    const Page = await import(path)
    const wrapper = await mountSuspended(Page.default, { route: '/app/learn/thread/thread_1' })

    await wrapper.get('[data-testid="learn-convert-contribution"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="learn-thread-conversion-error"]').text()).toContain('changed in another tab')
    projection.value = { ...projection.value!, thread: { ...(projection.value!.thread as Record<string, unknown>), revision: 8 } }
    await nextTick()
    await wrapper.get('[data-testid="learn-convert-contribution"]').trigger('click')
    await flushPromises()
    expect(convert.mock.calls[0]![0]).toMatchObject({ expectedRevision: 7 })
    expect(convert.mock.calls[1]![0]).toMatchObject({ expectedRevision: 8 })
    expect(convert.mock.calls[1]![0].idempotencyKey).not.toBe(convert.mock.calls[0]![0].idempotencyKey)
    expect(wrapper.find('[data-testid="learn-thread-conversion-retry"]').exists()).toBe(true)

    requestedRoute.params.threadId = 'thread_2'
    await nextTick()
    expect(wrapper.find('[data-testid="learn-thread-conversion-retry"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
