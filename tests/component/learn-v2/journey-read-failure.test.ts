import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'

const denied = (reasonCode: string) => Object.assign(new Error('denied'), { data: { admission: { status: 'denied', reasonCode } } })
const pausedCopy = 'This is paused while you have a check open. Finish the check, then come back.'

const mission = ref<unknown>(null)
const readFailure = ref<{ reason: string, retryable: boolean, message: string | null } | null>(null)
const retryRead = vi.fn()
const dueItems = ref<unknown>(null)
const dueError = ref<Error | null>(null)
const refreshDue = vi.fn()

mockNuxtImport('useLearnV2Journey', () => () => ({ allowed: ref(true), checkingAccess: ref(false), mission, readFailure, retryRead, snapshot: ref(null), busy: ref(false), error: ref(null) }))
mockNuxtImport('useRoute', () => () => ({ params: { learningVoidId: 'void_1' }, query: {} }))
mockNuxtImport('useConvexMutation', () => () => ({ mutate: vi.fn() }))
mockNuxtImport('useConvexQuery', () => (reference: never) => getFunctionName(reference) === 'reviewItems:listDueWithContext'
  ? { data: dueItems, error: dueError, refresh: refreshDue }
  : { data: ref(null) })
mockNuxtImport('useOfflineAttempts', () => () => ({ queueReviewItemRating: vi.fn(), queueReviewSessionCompletion: vi.fn() }))
mockNuxtImport('useOfflineSync', () => () => ({ pendingCount: ref(0), isSyncing: ref(false) }))

const page = (...parts: string[]) => ['~', 'pages', 'app', 'learn', ...parts].join('/')

describe('Learn V2 workspace reads', () => {
  beforeEach(() => {
    mission.value = null
    readFailure.value = null
    retryRead.mockReset()
  })

  it('replaces the workspace loading message with the open-check pause and no retry', async () => {
    readFailure.value = { reason: 'test_open', retryable: false, message: pausedCopy }
    const Page = await import(page('[learningVoidId]', 'index.vue'))
    const wrapper = await mountSuspended(Page.default)
    expect(wrapper.get('[data-testid="learn-v2-workspace-read-paused"]').text()).toBe(pausedCopy)
    expect(wrapper.find('[data-testid="learn-v2-workspace-read-retry"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Loading learning workspace')
  })

  it('offers a retry on the workspace and returns to loading once it clears', async () => {
    readFailure.value = { reason: 'error', retryable: true, message: null }
    retryRead.mockImplementation(() => { readFailure.value = null })
    const Page = await import(page('[learningVoidId]', 'index.vue'))
    const wrapper = await mountSuspended(Page.default)
    expect(wrapper.get('[data-testid="learn-v2-workspace-read-error"]').text()).toContain('Could not load this learning workspace.')
    await wrapper.get('[data-testid="learn-v2-workspace-read-retry"]').trigger('click')
    expect(retryRead).toHaveBeenCalledTimes(1)
    await nextTick()
    expect(wrapper.find('[data-testid="learn-v2-workspace-read-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Loading learning workspace')
  })

  it('shows the unknown-disclosure copy on calibration instead of preparing forever', async () => {
    readFailure.value = { reason: 'disclosure_unknown', retryable: false, message: 'This isn’t available right now.' }
    const Page = await import(page('[learningVoidId]', 'calibration.vue'))
    const wrapper = await mountSuspended(Page.default)
    expect(wrapper.get('[data-testid="learn-v2-calibration-read-paused"]').text()).toBe('This isn’t available right now.')
    expect(wrapper.text()).not.toContain('Preparing calibration')
  })
})

describe('Review reads', () => {
  beforeEach(() => {
    dueItems.value = null
    dueError.value = null
    refreshDue.mockReset()
  })

  it('pauses review while a check is open', async () => {
    dueError.value = denied('test_open')
    const Page = await import(page('review.vue'))
    const wrapper = await mountSuspended(Page.default)
    expect(wrapper.get('[data-testid="review-read-paused"]').text()).toBe(pausedCopy)
    expect(wrapper.find('[data-testid="review-read-retry"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Loading review items')
  })

  it('retries a failed review read and recovers to the empty state', async () => {
    dueError.value = denied('unavailable')
    refreshDue.mockImplementation(async () => { dueError.value = null; dueItems.value = [] })
    const Page = await import(page('review.vue'))
    const wrapper = await mountSuspended(Page.default)
    expect(wrapper.get('[data-testid="review-read-error"]').attributes('role')).toBe('alert')
    await wrapper.get('[data-testid="review-read-retry"]').trigger('click')
    expect(refreshDue).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(true))
    expect(wrapper.find('[data-testid="review-read-error"]').exists()).toBe(false)
  })

  it('clears an active session when a check opens mid-review', async () => {
    dueItems.value = [{ _id: 'item_1', prompt: 'What is inertia?', answer: 'Resistance to change in motion', courseId: 'c1', sectionId: 's1', courseTitle: 'Physics', sectionTitle: 'Motion', sectionOrder: 0, flagged: false }]
    const Page = await import(page('review.vue'))
    const wrapper = await mountSuspended(Page.default)
    await wrapper.get('[data-testid="reveal-button"]').trigger('click')
    expect(wrapper.get('[data-testid="review-answer"]').text()).toContain('Resistance to change in motion')

    dueItems.value = null
    dueError.value = denied('test_open')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="review-read-paused"]').exists()).toBe(true))
    expect(wrapper.text()).not.toContain('What is inertia?')
    expect(wrapper.text()).not.toContain('Resistance to change in motion')
    expect(wrapper.find('[data-testid="review-card"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="reveal-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="flag-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mode-toggle"]').exists()).toBe(false)

    dueError.value = null
    dueItems.value = [{ _id: 'item_2', prompt: 'What is mass?', answer: 'Amount of matter', courseId: 'c1', sectionId: 's1', courseTitle: 'Physics', sectionTitle: 'Motion', sectionOrder: 0, flagged: false }]
    await vi.waitFor(() => expect(wrapper.get('[data-testid="review-prompt"]').text()).toContain('What is mass?'))
    expect(wrapper.find('[data-testid="review-answer"]').exists()).toBe(false)
  })
})
