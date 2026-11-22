import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { deniedRead, resetTeachingReads, teachingClient, teachingRead } from '../support/teaching-reads'

vi.mock('#shared/learn-v2-measurement-storage-manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#shared/learn-v2-measurement-storage-manifest')>()
  return { ...actual, LEARN_MEASUREMENT_CAPABILITIES: { ...actual.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})

const due = teachingRead('reviewItems:listDueWithContext')
const pausedCopy = 'This is paused while you have a check open. Finish the check, then come back.'
const item = (id: string, prompt: string, answer: string) => ({ _id: id, prompt, answer, courseId: 'c1', sectionId: 's1', courseTitle: 'Physics', sectionTitle: 'Motion', sectionOrder: 0, flagged: false })

mockNuxtImport('useConvex', () => () => teachingClient)
mockNuxtImport('useRoute', () => () => ({ params: {}, query: {} }))
mockNuxtImport('useConvexMutation', () => () => ({ mutate: vi.fn() }))
mockNuxtImport('useConvexQuery', () => () => ({ data: ref(null) }))
mockNuxtImport('useOfflineAttempts', () => () => ({ queueReviewItemRating: vi.fn(), queueReviewSessionCompletion: vi.fn() }))
mockNuxtImport('useOfflineSync', () => () => ({ pendingCount: ref(0), isSyncing: ref(false) }))

const path = ['~', 'pages', 'app', 'learn', 'review.vue'].join('/')

describe('Review reads with responses on', () => {
  beforeEach(() => resetTeachingReads())

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

  it('clears an active session when a check opens mid-review', async () => {
    due.data.value = [item('item_1', 'What is inertia?', 'Resistance to change in motion')]
    const Page = await import(path)
    const wrapper = await mountSuspended(Page.default)
    await vi.waitFor(() => expect(wrapper.find('[data-testid="reveal-button"]').exists()).toBe(true))
    await wrapper.get('[data-testid="reveal-button"]').trigger('click')
    expect(wrapper.get('[data-testid="review-answer"]').text()).toContain('Resistance to change in motion')

    due.error.value = deniedRead('test_open')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="review-read-paused"]').exists()).toBe(true))
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
