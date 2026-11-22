import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { helpConsumerFixture } from '../learn-v2-help-consumers'
import type { StudyPlanSchedulingInput } from '../../../shared/learn-v2-scheduling'

type Preferences = Omit<StudyPlanSchedulingInput, 'nowUtcMs' | 'objectives' | 'retainedReviews'>

export const schedulingCases = {
  long_review: { reviewIntervalsDays: [731] },
  sunday: { availability: [{ weekday: 7, start: '09:00', end: '13:00' }] },
  empty_deadline: { targetLocalDate: '' },
  rest_boundary: { minRestMinutes: 1440 },
  bounded_collections: {
    targetLocalDate: '2030-09-20',
    availability: Array.from({ length: 28 }, (_, index) => ({ weekday: Math.floor(index / 4) + 1, start: `${9 + index % 4}`.padStart(2, '0') + ':00', end: `${10 + index % 4}:00` })),
    blackoutDates: Array.from({ length: 90 }, (_, index) => new Date(Date.UTC(2031, 0, 1 + index)).toISOString().slice(0, 10)),
    reviewIntervalsDays: [1, 3, 731, 1000],
  },
} satisfies Record<string, Partial<Preferences>>

export async function createSchedulingPreview(s: Awaited<ReturnType<typeof helpConsumerFixture>>, changes: Partial<Preferences> = {}) {
  await s.t.run(async ctx => {
    await ctx.db.delete(s.f.scope.contextPins.studyPlanRevisionId)
    await ctx.db.delete(s.f.scope.contextPins.studyPlanId)
    await ctx.db.patch(s.f.learningVoidId, { status: 'plan_review', revision: 5 })
    await ctx.db.patch(s.f.scope.blueprintRevisionId, { recordRevision: 4 })
  })
  const schedulingInput: Preferences = {
    version: 'learn-v2.schedule-input.v1' as const, timezone: 'America/Toronto',
    startLocalDate: '2030-09-16', targetLocalDate: null, sessionMinutes: 30, minRestMinutes: 0,
    availability: [{ weekday: 1, start: '09:00', end: '13:00' }], blackoutDates: [], reviewIntervalsDays: [1], ...changes,
  }
  const receipt = await s.owner.mutation(api.learnV2Plans.createPlanPreview, {
    learningVoidId: s.f.learningVoidId, blueprintRevisionId: s.f.scope.blueprintRevisionId,
    expectedVoidRevision: 5, expectedBlueprintRecordRevision: 4, idempotencyKey: 'scheduling-projection', schedulingInput,
  })
  return { id: receipt._id as Id<'studyPlanRevisions'>, schedulingInput }
}
