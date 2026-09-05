import { addOfflineAttempt } from './useOfflineCache'
import type { OfflineAttempt } from './useOfflineCache'

export function useOfflineAttempts() {
  async function queueQuizRetake(
    sectionId: string,
    courseId: string,
    quizCorrect: number,
    quizTotal: number,
  ): Promise<void> {
    const score = quizTotal > 0 ? Math.round((quizCorrect / quizTotal) * 100) : 100
    await addOfflineAttempt({
      type: 'section-review',
      sectionId,
      courseId,
      timestamp: Date.now(),
      data: {
        practiceScore: score,
        quizCorrect,
        quizTotal,
      },
    })
  }

  async function queueFlashcardPractice(
    sectionId: string,
    courseId: string,
  ): Promise<void> {
    await addOfflineAttempt({
      type: 'flashcard-practice',
      sectionId,
      courseId,
      timestamp: Date.now(),
      data: {
        practiceScore: 100,
        quizCorrect: 0,
        quizTotal: 0,
      },
    })
  }

  async function queueReviewItemRating(
    reviewItemId: string,
    quality: number,
    idempotencyKey: string,
  ): Promise<void> {
    await addOfflineAttempt({
      type: 'review-item-rating',
      idempotencyKey,
      timestamp: Date.now(),
      data: { reviewItemId, quality },
    })
  }

  async function queueReviewSessionCompletion(args: {
    itemsReviewed: number
    itemsCorrect: number
    durationMs: number
    mode: 'full' | 'quick'
    idempotencyKey: string
  }): Promise<void> {
    await addOfflineAttempt({
      type: 'review-session-completion',
      idempotencyKey: args.idempotencyKey,
      timestamp: Date.now(),
      data: args,
    })
  }

  return {
    queueQuizRetake,
    queueFlashcardPractice,
    queueReviewItemRating,
    queueReviewSessionCompletion,
  }
}
