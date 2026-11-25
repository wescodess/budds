import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { LEARN_TODAY_CHECK_POINTER_LEGACY_VERSION, LEARN_TODAY_CHECK_POINTER_VERSION, todayCanvasChecksEnabled } from '../../shared/learn-v2-today-check'

export async function todayCheckLabel(ctx: QueryCtx | MutationCtx, userId: string, opportunity: Doc<'learnAssessmentOpportunities'>,
  pointerVersion: string) {
  if (!todayCanvasChecksEnabled() || pointerVersion !== LEARN_TODAY_CHECK_POINTER_VERSION) return { version: LEARN_TODAY_CHECK_POINTER_LEGACY_VERSION }
  const timing = opportunity.purpose.kind === 'measurement_cold' ? 'this_session' as const
    : opportunity.purpose.kind === 'measurement_delayed' ? opportunity.purpose.horizonDays === 7 ? 'about_a_week' as const : 'about_a_month' as const
      : 'retained' as const
  const [objective, blueprint, learningVoid] = await Promise.all([
    ctx.db.get(opportunity.objectiveId), ctx.db.get(opportunity.blueprintRevisionId), ctx.db.get(opportunity.learningVoidId),
  ])
  const folder = learningVoid && await ctx.db.get(learningVoid.folderId)
  const visible = objective && blueprint && learningVoid && folder
    && [objective, blueprint, learningVoid, folder].every(row => row.userId === userId)
    && objective.blueprintRevisionId === blueprint._id && blueprint.learningVoidId === learningVoid._id
    && learningVoid.status !== 'archived' && learningVoid.activeBlueprintRevisionId === blueprint._id
    && ['accepted', 'active'].includes(blueprint.status) && blueprint.acceptedAt !== undefined
    && blueprint.recordRevision === opportunity.blueprintRecordRevision && objective.title.trim().length > 0
  return { version: LEARN_TODAY_CHECK_POINTER_VERSION, timing, ...(visible ? { topic: objective.title } : {}) }
}
