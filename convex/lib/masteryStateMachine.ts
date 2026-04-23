export type MasteryLevel = 'new' | 'learning' | 'reviewing' | 'mastered'

export type MasteryEvent =
  | { type: 'section_completed'; score: number }
  | { type: 'section_reviewed'; score: number }
  | { type: 'review_item_failed' }

export interface MasteryState {
  level: MasteryLevel
  consecutiveReviewPasses: number
}

const REVIEW_THRESHOLD = 70
const MASTERY_THRESHOLD = 80
const CONSECUTIVE_PASSES_REQUIRED = 3

export function transitionMastery(
  current: MasteryState,
  event: MasteryEvent,
): MasteryState {
  switch (event.type) {
    case 'section_completed':
      return {
        level: 'learning',
        consecutiveReviewPasses: 0,
      }

    case 'section_reviewed': {
      if (current.level === 'mastered') {
        return {
          level: 'learning',
          consecutiveReviewPasses: 0,
        }
      }

      if (current.level === 'reviewing') {
        if (event.score >= MASTERY_THRESHOLD) {
          const passes = current.consecutiveReviewPasses + 1
          if (passes >= CONSECUTIVE_PASSES_REQUIRED) {
            return { level: 'mastered', consecutiveReviewPasses: passes }
          }
          return { level: 'reviewing', consecutiveReviewPasses: passes }
        }
        return { level: 'learning', consecutiveReviewPasses: 0 }
      }

      if (current.level === 'learning' || current.level === 'new') {
        if (event.score >= REVIEW_THRESHOLD) {
          return { level: 'reviewing', consecutiveReviewPasses: 0 }
        }
        return { level: 'learning', consecutiveReviewPasses: 0 }
      }

      return current
    }

    case 'review_item_failed':
      if (current.level === 'mastered') {
        return { level: 'reviewing', consecutiveReviewPasses: 0 }
      }
      return current
  }
}
