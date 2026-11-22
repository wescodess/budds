import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { getFunctionName } from 'convex/server'

const submitReview = vi.fn()
const completeSession = vi.fn()
const queueCompletion = vi.fn()
const due = ref([{ _id: 'item_1', prompt: 'What is inertia?', answer: 'Resistance to change in motion', courseId: 'c1', sectionId: 's1', courseTitle: 'Physics', sectionTitle: 'Motion', sectionOrder: 0, flagged: false }])

mockNuxtImport('useRoute', () => () => ({ params: {}, query: {} }))
mockNuxtImport('useConvexQuery', () => (reference: never) => ({ data: getFunctionName(reference) === 'reviewItems:listDueWithContext' ? due : ref(null) }))
mockNuxtImport('useConvexMutation', () => (reference: never) => ({ mutate: getFunctionName(reference) === 'reviewItems:submitReview' ? submitReview : completeSession }))
mockNuxtImport('useOfflineAttempts', () => () => ({ queueReviewItemRating: vi.fn(), queueReviewSessionCompletion: queueCompletion }))
mockNuxtImport('useOfflineSync', () => () => ({ pendingCount: ref(0), isSyncing: ref(false) }))

describe('review capability-off completion parity', () => {
  beforeEach(() => {
    submitReview.mockReset()
    completeSession.mockReset().mockResolvedValue({ streakCurrent: 1 })
    queueCompletion.mockReset().mockResolvedValue(undefined)
  })

  it('keeps dev offline completion after navigation unmounts the page', async () => {
    const completion = Promise.withResolvers<unknown>()
    completeSession.mockReturnValueOnce(completion.promise)
    const Page = (await import('~/pages/app/learn/review.vue')).default
    const wrapper = await mountSuspended(Page, { global: { stubs: {
      LearnReviewRatingButtons: { template: `<button data-testid="rate" @click="$emit('rate', 5)">Easy</button>` },
    } } })
    await wrapper.get('[data-testid="reveal-button"]').trigger('click')
    await wrapper.get('[data-testid="rate"]').trigger('click')
    await flushPromises()
    expect(completeSession).toHaveBeenCalledTimes(1)
    const original = completeSession.mock.calls[0]![0]
    wrapper.unmount()
    completion.reject(new Error('Connection lost'))
    await flushPromises()
    expect(queueCompletion).toHaveBeenCalledExactlyOnceWith(original)
  })

  it('keeps dev completion of an accepted rating after navigation unmounts the page', async () => {
    const rating = Promise.withResolvers<unknown>()
    submitReview.mockReturnValue(rating.promise)
    const Page = (await import('~/pages/app/learn/review.vue')).default
    const wrapper = await mountSuspended(Page, { global: { stubs: {
      LearnReviewRatingButtons: { template: `<button data-testid="rate" @click="$emit('rate', 5)">Easy</button>` },
    } } })
    await wrapper.get('[data-testid="reveal-button"]').trigger('click')
    await wrapper.get('[data-testid="rate"]').trigger('click')
    expect(submitReview).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    rating.resolve({})
    await flushPromises()
    expect(completeSession).toHaveBeenCalledTimes(1)
    expect(completeSession).toHaveBeenCalledWith(expect.objectContaining({ itemsReviewed: 1, itemsCorrect: 1, mode: 'full' }))
  })
})
