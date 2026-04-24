import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

const mockMutate = vi.fn().mockResolvedValue({})
const mockGetUnsyncedAttempts = vi.fn().mockResolvedValue([])
const mockMarkAttemptSynced = vi.fn().mockResolvedValue(undefined)
const mockClearSyncedAttempts = vi.fn().mockResolvedValue(undefined)

const isOnlineRef = ref(true)

mockNuxtImport('useOnlineStatus', () => {
  return () => ({ isOnline: isOnlineRef })
})

mockNuxtImport('useConvexMutation', () => {
  return (_api: unknown) => ({
    mutate: mockMutate,
    isLoading: ref(false),
  })
})

vi.mock('~/composables/useOfflineCache', () => ({
  getUnsyncedAttempts: (...args: any[]) => mockGetUnsyncedAttempts(...args),
  markAttemptSynced: (...args: any[]) => mockMarkAttemptSynced(...args),
  clearSyncedAttempts: (...args: any[]) => mockClearSyncedAttempts(...args),
  addOfflineAttempt: vi.fn().mockResolvedValue(1),
  useOfflineCache: () => ({
    cacheStatus: { value: new Map() },
    cacheSectionContent: vi.fn(),
    getCachedSection: vi.fn(),
    checkCacheStatus: vi.fn(),
    removeCachedSection: vi.fn(),
    getAudioFromCache: vi.fn(),
  }),
}))

describe('Offline Sync — Conflict Resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isOnlineRef.value = false
    mockGetUnsyncedAttempts.mockResolvedValue([])
  })

  it('uses most recent attempt per section (timestamp-based)', async () => {
    const attempts = [
      { id: 1, type: 'section-review' as const, sectionId: 'sec_1', courseId: 'c1', timestamp: 1000, data: { practiceScore: 60, quizCorrect: 3, quizTotal: 5 }, synced: false },
      { id: 2, type: 'section-review' as const, sectionId: 'sec_1', courseId: 'c1', timestamp: 3000, data: { practiceScore: 90, quizCorrect: 4, quizTotal: 5 }, synced: false },
      { id: 3, type: 'section-review' as const, sectionId: 'sec_1', courseId: 'c1', timestamp: 2000, data: { practiceScore: 70, quizCorrect: 3, quizTotal: 5 }, synced: false },
    ]
    mockGetUnsyncedAttempts.mockResolvedValue(attempts)

    const { useOfflineSync } = await import('~/composables/useOfflineSync')
    const { syncAttempts } = useOfflineSync()

    isOnlineRef.value = true
    await syncAttempts()

    expect(mockMutate).toHaveBeenCalledOnce()
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ practiceScore: 90 }),
    )
  })

  it('groups attempts by sectionId and syncs section-review types', async () => {
    const attempts = [
      { id: 1, type: 'section-review' as const, sectionId: 'sec_1', courseId: 'c1', timestamp: 1000, data: { practiceScore: 80, quizCorrect: 4, quizTotal: 5 }, synced: false },
      { id: 2, type: 'flashcard-practice' as const, sectionId: 'sec_2', courseId: 'c1', timestamp: 2000, data: { practiceScore: 100, quizCorrect: 0, quizTotal: 0 }, synced: false },
    ]
    mockGetUnsyncedAttempts.mockResolvedValue(attempts)

    const { useOfflineSync } = await import('~/composables/useOfflineSync')
    const { syncAttempts } = useOfflineSync()

    isOnlineRef.value = true
    await syncAttempts()

    expect(mockMutate).toHaveBeenCalledTimes(1)
    expect(mockMarkAttemptSynced).toHaveBeenCalledWith(1)
  })

  it('marks all attempts in a group as synced', async () => {
    const attempts = [
      { id: 1, type: 'section-review' as const, sectionId: 'sec_1', courseId: 'c1', timestamp: 1000, data: { practiceScore: 60, quizCorrect: 3, quizTotal: 5 }, synced: false },
      { id: 2, type: 'section-review' as const, sectionId: 'sec_1', courseId: 'c1', timestamp: 2000, data: { practiceScore: 80, quizCorrect: 4, quizTotal: 5 }, synced: false },
    ]
    mockGetUnsyncedAttempts.mockResolvedValue(attempts)

    const { useOfflineSync } = await import('~/composables/useOfflineSync')
    const { syncAttempts } = useOfflineSync()

    isOnlineRef.value = true
    await syncAttempts()

    expect(mockMarkAttemptSynced).toHaveBeenCalledWith(1)
    expect(mockMarkAttemptSynced).toHaveBeenCalledWith(2)
  })

  it('clears synced attempts after successful sync', async () => {
    const attempts = [
      { id: 1, type: 'section-review' as const, sectionId: 'sec_1', courseId: 'c1', timestamp: 1000, data: { practiceScore: 80, quizCorrect: 4, quizTotal: 5 }, synced: false },
    ]
    mockGetUnsyncedAttempts.mockResolvedValue(attempts)

    const { useOfflineSync } = await import('~/composables/useOfflineSync')
    const { syncAttempts } = useOfflineSync()

    isOnlineRef.value = true
    await syncAttempts()

    expect(mockClearSyncedAttempts).toHaveBeenCalledOnce()
  })

  it('does nothing when queue is empty', async () => {
    mockGetUnsyncedAttempts.mockResolvedValue([])

    const { useOfflineSync } = await import('~/composables/useOfflineSync')
    const { syncAttempts } = useOfflineSync()

    isOnlineRef.value = true
    await syncAttempts()

    expect(mockMutate).not.toHaveBeenCalled()
    expect(mockClearSyncedAttempts).not.toHaveBeenCalled()
  })

  it('continues syncing other sections if one fails', async () => {
    const attempts = [
      { id: 1, type: 'section-review' as const, sectionId: 'sec_1', courseId: 'c1', timestamp: 1000, data: { practiceScore: 80, quizCorrect: 4, quizTotal: 5 }, synced: false },
      { id: 2, type: 'section-review' as const, sectionId: 'sec_2', courseId: 'c1', timestamp: 2000, data: { practiceScore: 90, quizCorrect: 4, quizTotal: 5 }, synced: false },
    ]
    mockGetUnsyncedAttempts.mockResolvedValue(attempts)
    mockMutate
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({})

    const { useOfflineSync } = await import('~/composables/useOfflineSync')
    const { syncAttempts } = useOfflineSync()

    isOnlineRef.value = true
    await syncAttempts()

    expect(mockMutate).toHaveBeenCalledTimes(2)
    expect(mockMarkAttemptSynced).toHaveBeenCalledWith(2)
    expect(mockMarkAttemptSynced).not.toHaveBeenCalledWith(1)
  })
})
