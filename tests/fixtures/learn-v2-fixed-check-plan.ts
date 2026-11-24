import type { Id } from '../../convex/_generated/dataModel'
import type { MutationCtx } from '../../convex/_generated/server'
import { scheduleStudyPlan, type StudyPlanSchedulingInput } from '../../shared/learn-v2-scheduling'

export async function seedFixedCheckPlan(ctx: MutationCtx, userId: string, graph: {
  studyPlanRevisionId: Id<'studyPlanRevisions'>, studySessionId: Id<'studySessions'>, objectiveId: Id<'learnObjectives'>,
}, now: number) {
  const day = 86_400_000
  const input: StudyPlanSchedulingInput = { version: 'learn-v2.schedule-input.v1', nowUtcMs: now, timezone: 'UTC',
    startLocalDate: new Date(now).toISOString().slice(0, 10), targetLocalDate: new Date(now + 14 * day).toISOString().slice(0, 10),
    sessionMinutes: 30, minRestMinutes: 0, availability: Array.from({ length: 7 }, (_, index) => ({ weekday: index + 1, start: '08:00', end: '20:00' })),
    blackoutDates: [], reviewIntervalsDays: [], retainedReviews: [],
    objectives: [{ id: graph.objectiveId, order: 0, estimatedMinutes: 60, prerequisiteIds: [], priority: 'new_learning' }] }
  await ctx.db.patch(graph.studyPlanRevisionId, { inputSnapshot: JSON.stringify(input), resultSnapshot: JSON.stringify(scheduleStudyPlan(input)),
    schedulerVersion: 'learn-v2.scheduler.v1', feasibility: 'feasible' })
  const source = (await ctx.db.get(graph.studySessionId))!
  await ctx.db.patch(source._id, { placementId: 'ordinary-past', scheduledEndAt: source.scheduledStartAt + 30 * 60_000,
    status: 'missed', missedAt: now, placementKind: 'learning', schedulingPriority: 'new_learning', schedulerVersion: 'learn-v2.scheduler.v1', timezone: 'UTC' })
  const futureId = await ctx.db.insert('studySessions', { userId, studyPlanRevisionId: graph.studyPlanRevisionId,
    primaryObjectiveId: graph.objectiveId, placementId: 'ordinary-future', status: 'planned', revision: 1,
    scheduledStartAt: now + 2 * day, scheduledEndAt: now + 2 * day + 30 * 60_000,
    placementKind: 'learning', schedulingPriority: 'new_learning', schedulerVersion: 'learn-v2.scheduler.v1', timezone: 'UTC' })
  return { input, futureId }
}
