import { ref, watch, onUnmounted } from 'vue'
import { getUnsyncedAttempts, markAttemptSynced, clearSyncedAttempts, incrementSyncAttempts } from './useOfflineCache'
import type { OfflineAttempt } from './useOfflineCache'
import { api } from '#convex/api'
import type { Id } from '~~/convex/_generated/dataModel'

export function useOfflineSync() {
  const isSyncing = ref(false)
  const pendingCount = ref(0)
  const lastSyncError = ref<string | null>(null)

  const { isOnline } = useOnlineStatus()

  const reviewMutation = import.meta.client
    ? useConvexMutation(api.courseSections.reviewSection)
    : { mutate: async () => null }
  const submitReviewMutation = import.meta.client
    ? useConvexMutation(api.reviewItems.submitReview)
    : { mutate: async () => null }
  const completeReviewSessionMutation = import.meta.client
    ? useConvexMutation(api.reviewItems.completeReviewSession)
    : { mutate: async () => null }

  let syncTimeout: ReturnType<typeof setTimeout> | null = null

  async function syncAttempts(): Promise<void> {
    if (isSyncing.value || !import.meta.client) return

    isSyncing.value = true
    lastSyncError.value = null

    try {
      const attempts = await getUnsyncedAttempts()
      pendingCount.value = attempts.length

      if (attempts.length === 0) {
        isSyncing.value = false
        return
      }

      const sorted = [...attempts].sort((a, b) => a.timestamp - b.timestamp)

      for (const attempt of sorted.filter(row =>
        row.type === 'review-item-rating' || row.type === 'review-session-completion',
      )) {
        try {
          if (attempt.type === 'review-item-rating') {
            if (!attempt.data.reviewItemId || attempt.data.quality === undefined || !attempt.idempotencyKey) {
              throw new Error('Queued review rating is incomplete')
            }
            await submitReviewMutation.mutate({
              reviewItemId: attempt.data.reviewItemId as Id<'reviewItems'>,
              quality: attempt.data.quality,
              idempotencyKey: attempt.idempotencyKey,
            })
          }
          else {
            if (
              attempt.data.itemsReviewed === undefined
              || attempt.data.itemsCorrect === undefined
              || attempt.data.durationMs === undefined
              || !attempt.idempotencyKey
            ) {
              throw new Error('Queued review session is incomplete')
            }
            await completeReviewSessionMutation.mutate({
              itemsReviewed: attempt.data.itemsReviewed,
              itemsCorrect: attempt.data.itemsCorrect,
              durationMs: attempt.data.durationMs,
              mode: attempt.data.mode,
              idempotencyKey: attempt.idempotencyKey,
            })
          }
          if (attempt.id !== undefined) await markAttemptSynced(attempt.id)
          pendingCount.value = Math.max(0, pendingCount.value - 1)
        }
        catch (error) {
          lastSyncError.value = error instanceof Error ? error.message : 'Review sync failed'
          if (attempt.id !== undefined) await incrementSyncAttempts(attempt.id)
        }
      }

      const grouped = new Map<string, OfflineAttempt[]>()
      for (const attempt of sorted.filter(row =>
        row.type !== 'review-item-rating' && row.type !== 'review-session-completion',
      )) {
        if (!attempt.sectionId) continue
        const key = attempt.sectionId
        const group = grouped.get(key) ?? []
        group.push(attempt)
        grouped.set(key, group)
      }

      for (const [sectionId, sectionAttempts] of grouped) {
        const latest = sectionAttempts[sectionAttempts.length - 1]!

        if (latest.type === 'section-review' || latest.type === 'quiz-retake') {
          try {
            await reviewMutation.mutate({
              sectionId: sectionId as Id<'courseSections'>,
              practiceScore: latest.data.practiceScore ?? 100,
              quizCorrect: latest.data.quizCorrect ?? 0,
              quizTotal: latest.data.quizTotal ?? 0,
            })
          } catch {
            lastSyncError.value = 'Section review sync failed'
            for (const attempt of sectionAttempts) {
              if (attempt.id !== undefined) {
                await incrementSyncAttempts(attempt.id)
              }
            }
            continue
          }
        }

        for (const attempt of sectionAttempts) {
          if (attempt.id !== undefined) {
            await markAttemptSynced(attempt.id)
          }
        }
        pendingCount.value = Math.max(0, pendingCount.value - sectionAttempts.length)
      }

      await clearSyncedAttempts()
    } catch (e: any) {
      lastSyncError.value = e?.message ?? 'Sync failed'
    } finally {
      isSyncing.value = false
    }
  }

  if (import.meta.client) {
    watch(isOnline, (online, wasOnline) => {
      if (online && !wasOnline) {
        if (syncTimeout) clearTimeout(syncTimeout)
        syncTimeout = setTimeout(() => {
          syncAttempts()
        }, 2000)
      }
    })

    getUnsyncedAttempts().then((attempts) => {
      pendingCount.value = attempts.length
      if (isOnline.value && attempts.length > 0) {
        syncAttempts()
      }
    }).catch(() => {})
  }

  onUnmounted(() => {
    if (syncTimeout) clearTimeout(syncTimeout)
  })

  return {
    isSyncing,
    pendingCount,
    lastSyncError,
    syncAttempts,
  }
}
