import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { getFunctionName } from 'convex/server'
import { nextTick } from 'vue'
import { deniedRead, resetTeachingReads, teachingClient, teachingRead } from '../support/teaching-reads'

vi.mock('#shared/learn-v2-measurement-storage-manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#shared/learn-v2-measurement-storage-manifest')>()
  return { ...actual, LEARN_MEASUREMENT_CAPABILITIES: { ...actual.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})

const due = teachingRead('reviewItems:listDueWithContext')
const submitReview = vi.fn()
const completeSession = vi.fn()
const queueCompletion = vi.fn()
const pausedCopy = 'This is paused while you have a check open. Finish the check, then come back.'
const item = (id: string, prompt: string, answer: string) => ({ _id: id, prompt, answer, courseId: 'c1', sectionId: 's1', courseTitle: 'Physics', sectionTitle: 'Motion', sectionOrder: 0, flagged: false })

mockNuxtImport('useConvex', () => () => teachingClient)
mockNuxtImport('useRoute', () => () => ({ params: {}, query: {} }))
mockNuxtImport('useConvexMutation', () => (reference: never) => ({ mutate: getFunctionName(reference) === 'reviewItems:submitReview' ? submitReview : completeSession }))
mockNuxtImport('useConvexQuery', () => () => ({ data: ref(null) }))
mockNuxtImport('useOfflineAttempts', () => () => ({ queueReviewItemRating: vi.fn(), queueReviewSessionCompletion: queueCompletion }))
mockNuxtImport('useOfflineSync', () => () => ({ pendingCount: ref(0), isSyncing: ref(false) }))

const path = ['~', 'pages', 'app', 'learn', 'review.vue'].join('/')

describe('Review reads with responses on', () => {
  beforeEach(() => {
    resetTeachingReads()
    submitReview.mockReset().mockResolvedValue({})
    completeSession.mockReset().mockResolvedValue({ streakCurrent: 1 })
    queueCompletion.mockReset().mockResolvedValue(undefined)
  })

  it.each(['test_open', 'unavailable'] as const)('does not queue a stale completion under a recovered session key (%s)', async (reason) => {
    const completion = Promise.withResolvers<unknown>()
    completeSession.mockReturnValueOnce(completion.promise)
    due.data.value = [item('old_1', 'Old prompt', 'Old answer')]
    const Page = (await import(path)).default
    const wrapper = await mountSuspended(Page, { global: { stubs: {
      LearnReviewRatingButtons: { template: `<button data-testid="rate" @click="$emit('rate', 5)">Rate</button>` },
    } } })
    try {
      await wrapper.get('[data-testid="reveal-button"]').trigger('click')
      await wrapper.get('[data-testid="rate"]').trigger('click')
      await flushPromises()
      expect(completeSession).toHaveBeenCalledTimes(1)
      const original = completeSession.mock.calls[0]![0]

      due.error.value = deniedRead(reason)
      await nextTick()
      due.data.value = [item('new_1', 'Replacement prompt', 'Replacement answer')]
      due.error.value = null
      await flushPromises()
      expect(wrapper.get('[data-testid="review-prompt"]').text()).toBe('Replacement prompt')

      completion.reject(new Error('Original connection lost'))
      await flushPromises()
      expect(queueCompletion).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="session-complete"]').exists()).toBe(false)

      await wrapper.get('[data-testid="reveal-button"]').trigger('click')
      await wrapper.get('[data-testid="rate"]').trigger('click')
      await flushPromises()
      expect(completeSession).toHaveBeenCalledTimes(2)
      expect(completeSession.mock.calls[1]![0].idempotencyKey).not.toBe(original.idempotencyKey)
    }
    finally { wrapper.unmount() }
  })

  it('queues the original completion request when the current session loses its connection', async () => {
    completeSession.mockRejectedValueOnce(new Error('Connection lost'))
    due.data.value = [item('item_1', 'Current prompt', 'Current answer')]
    const Page = (await import(path)).default
    const wrapper = await mountSuspended(Page, { global: { stubs: {
      LearnReviewRatingButtons: { template: `<button data-testid="rate" @click="$emit('rate', 5)">Rate</button>` },
    } } })
    try {
      await wrapper.get('[data-testid="reveal-button"]').trigger('click')
      await wrapper.get('[data-testid="rate"]').trigger('click')
      await flushPromises()
      expect(completeSession).toHaveBeenCalledTimes(1)
      expect(queueCompletion).toHaveBeenCalledExactlyOnceWith(completeSession.mock.calls[0]![0])
      expect(wrapper.find('[data-testid="session-complete"]').exists()).toBe(true)
    }
    finally { wrapper.unmount() }
  })

  it('pauses review while a check is open', async () => {
    due.error.value = deniedRead('test_open')
    const Page = await import(path)
    const wrapper = await mountSuspended(Page.default)
    expect(wrapper.get('[data-testid="review-read-paused"]').text()).toBe(pausedCopy)
    expect(wrapper.find('[data-testid="review-read-retry"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Loading review items')
  })

  it('retries a failed review read by subscribing again and recovers to the empty state', async () => {
    due.error.value = deniedRead('unavailable')
    const Page = await import(path)
    const wrapper = await mountSuspended(Page.default)
    expect(wrapper.get('[data-testid="review-read-error"]').attributes('role')).toBe('alert')
    const before = due.subscriptions
    due.error.value = null
    await wrapper.get('[data-testid="review-read-retry"]').trigger('click')
    expect(due.subscriptions).toBe(before + 1)
    due.data.value = []
    await vi.waitFor(() => expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(true))
    expect(wrapper.find('[data-testid="review-read-error"]').exists()).toBe(false)
  })

  it.each(['test_open', 'unavailable'] as const)('clears an active session when a check opens mid-review (%s)', async (reason) => {
    due.data.value = [item('item_1', 'What is inertia?', 'Resistance to change in motion')]
    const Page = await import(path)
    const wrapper = await mountSuspended(Page.default)
    await vi.waitFor(() => expect(wrapper.find('[data-testid="reveal-button"]').exists()).toBe(true))
    await wrapper.get('[data-testid="reveal-button"]').trigger('click')
    expect(wrapper.get('[data-testid="review-answer"]').text()).toContain('Resistance to change in motion')

    due.error.value = deniedRead(reason)
    await vi.waitFor(() => expect(wrapper.find(`[data-testid="review-read-${reason === 'unavailable' ? 'error' : 'paused'}"]`).exists()).toBe(true))
    expect(wrapper.text()).not.toContain('What is inertia?')
    expect(wrapper.text()).not.toContain('Resistance to change in motion')
    expect(wrapper.find('[data-testid="review-card"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="flag-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mode-toggle"]').exists()).toBe(false)

    due.error.value = null
    due.data.value = [item('item_2', 'What is mass?', 'Amount of matter')]
    await vi.waitFor(() => expect(wrapper.get('[data-testid="review-prompt"]').text()).toContain('What is mass?'))
    expect(wrapper.find('[data-testid="review-answer"]').exists()).toBe(false)
  })
})
