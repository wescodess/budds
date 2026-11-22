import { LEARN_MEASUREMENT_CAPABILITIES } from '../../shared/learn-v2-measurement-storage-manifest'
import type { Doc } from '../_generated/dataModel'

export function publicReviewItem(row: Doc<'reviewItems'>) {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return row
  return { _id: row._id, _creationTime: row._creationTime, userId: row.userId, courseId: row.courseId, sectionId: row.sectionId,
    flashcardRoomCardId: row.flashcardRoomCardId, prompt: row.prompt, answer: row.answer, easeFactor: row.easeFactor,
    interval: row.interval, repetitions: row.repetitions, nextReviewDate: row.nextReviewDate, lastReviewQuality: row.lastReviewQuality,
    lastReviewedAt: row.lastReviewedAt, lastReviewIdempotencyKey: row.lastReviewIdempotencyKey, flagged: row.flagged,
    correctedAnswer: row.correctedAnswer, createdAt: row.createdAt }
}
