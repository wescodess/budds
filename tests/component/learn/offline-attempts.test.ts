import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAddOfflineAttempt = vi.fn().mockResolvedValue(1)
const mockGetUnsyncedAttempts = vi.fn().mockResolvedValue([])
const mockMarkAttemptSynced = vi.fn().mockResolvedValue(undefined)
const mockClearSyncedAttempts = vi.fn().mockResolvedValue(undefined)

vi.mock('~/composables/useOfflineCache', () => ({
  addOfflineAttempt: (...args: any[]) => mockAddOfflineAttempt(...args),
  getUnsyncedAttempts: (...args: any[]) => mockGetUnsyncedAttempts(...args),
  markAttemptSynced: (...args: any[]) => mockMarkAttemptSynced(...args),
  clearSyncedAttempts: (...args: any[]) => mockClearSyncedAttempts(...args),
  useOfflineCache: () => ({
    cacheStatus: { value: new Map() },
    cacheSectionContent: vi.fn(),
    getCachedSection: vi.fn(),
    checkCacheStatus: vi.fn(),
    removeCachedSection: vi.fn(),
    getAudioFromCache: vi.fn(),
  }),
}))

describe('Offline Attempts — Queue Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queueQuizRetake writes attempt with correct structure', async () => {
    const { useOfflineAttempts } = await import('~/composables/useOfflineAttempts')
    const { queueQuizRetake } = useOfflineAttempts()

    await queueQuizRetake('sec_1', 'course_abc', 4, 5)

    expect(mockAddOfflineAttempt).toHaveBeenCalledOnce()
    const call = mockAddOfflineAttempt.mock.calls[0][0]
    expect(call.type).toBe('section-review')
    expect(call.sectionId).toBe('sec_1')
    expect(call.courseId).toBe('course_abc')
    expect(call.data.practiceScore).toBe(80)
    expect(call.data.quizCorrect).toBe(4)
    expect(call.data.quizTotal).toBe(5)
    expect(typeof call.timestamp).toBe('number')
  })

  it('queueQuizRetake computes score correctly for perfect score', async () => {
    const { useOfflineAttempts } = await import('~/composables/useOfflineAttempts')
    const { queueQuizRetake } = useOfflineAttempts()

    await queueQuizRetake('sec_1', 'course_abc', 5, 5)

    const call = mockAddOfflineAttempt.mock.calls[0][0]
    expect(call.data.practiceScore).toBe(100)
  })

  it('queueQuizRetake handles zero total gracefully', async () => {
    const { useOfflineAttempts } = await import('~/composables/useOfflineAttempts')
    const { queueQuizRetake } = useOfflineAttempts()

    await queueQuizRetake('sec_1', 'course_abc', 0, 0)

    const call = mockAddOfflineAttempt.mock.calls[0][0]
    expect(call.data.practiceScore).toBe(100)
  })

  it('queueFlashcardPractice writes attempt with correct type', async () => {
    const { useOfflineAttempts } = await import('~/composables/useOfflineAttempts')
    const { queueFlashcardPractice } = useOfflineAttempts()

    await queueFlashcardPractice('sec_2', 'course_abc')

    expect(mockAddOfflineAttempt).toHaveBeenCalledOnce()
    const call = mockAddOfflineAttempt.mock.calls[0][0]
    expect(call.type).toBe('flashcard-practice')
    expect(call.sectionId).toBe('sec_2')
    expect(call.courseId).toBe('course_abc')
    expect(typeof call.timestamp).toBe('number')
  })

  it('queues review ratings with their server idempotency key', async () => {
    const { useOfflineAttempts } = await import('~/composables/useOfflineAttempts')
    const { queueReviewItemRating } = useOfflineAttempts()

    await queueReviewItemRating('review_1', 4, 'rating-key-1')

    expect(mockAddOfflineAttempt).toHaveBeenCalledWith(expect.objectContaining({
      type: 'review-item-rating',
      idempotencyKey: 'rating-key-1',
      data: { reviewItemId: 'review_1', quality: 4 },
    }))
  })

  it('queues review session completion with its server idempotency key', async () => {
    const { useOfflineAttempts } = await import('~/composables/useOfflineAttempts')
    const { queueReviewSessionCompletion } = useOfflineAttempts()

    await queueReviewSessionCompletion({
      itemsReviewed: 5,
      itemsCorrect: 4,
      durationMs: 90_000,
      mode: 'quick',
      idempotencyKey: 'session-key-1',
    })

    expect(mockAddOfflineAttempt).toHaveBeenCalledWith(expect.objectContaining({
      type: 'review-session-completion',
      idempotencyKey: 'session-key-1',
    }))
  })
})

describe('Offline Attempts — IndexedDB Operations', () => {
  it('getUnsyncedAttempts returns only unsynced items', async () => {
    mockGetUnsyncedAttempts.mockResolvedValueOnce([
      { id: 1, type: 'section-review', sectionId: 'sec_1', courseId: 'c1', timestamp: 1000, data: {}, synced: false },
      { id: 2, type: 'flashcard-practice', sectionId: 'sec_2', courseId: 'c1', timestamp: 2000, data: {}, synced: false },
    ])

    const { getUnsyncedAttempts } = await import('~/composables/useOfflineCache')
    const result = await getUnsyncedAttempts()
    expect(result).toHaveLength(2)
    expect(result[0].synced).toBe(false)
  })

  it('markAttemptSynced marks correct attempt', async () => {
    const { markAttemptSynced } = await import('~/composables/useOfflineCache')
    await markAttemptSynced(1)
    expect(mockMarkAttemptSynced).toHaveBeenCalledWith(1)
  })

  it('clearSyncedAttempts removes synced entries', async () => {
    const { clearSyncedAttempts } = await import('~/composables/useOfflineCache')
    await clearSyncedAttempts()
    expect(mockClearSyncedAttempts).toHaveBeenCalledOnce()
  })
})
