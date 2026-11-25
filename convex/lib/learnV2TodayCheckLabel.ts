import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { LEARN_TODAY_CHECK_POINTER_LEGACY_VERSION, LEARN_TODAY_CHECK_POINTER_VERSION, todayCanvasChecksEnabled } from '../../shared/learn-v2-today-check'
import { privacyRead } from './learnV2PrivacyReadContext'

async function timingForCheck(ctx: QueryCtx | MutationCtx, userId: string, opportunity: Doc<'learnAssessmentOpportunities'>) {
  if (opportunity.purpose.kind === 'measurement_cold') return 'this_session' as const
  if (opportunity.purpose.kind === 'retained_transfer') return 'retained' as const
  if (opportunity.purpose.kind !== 'measurement_delayed' || !opportunity.assignmentId) return 'earlier' as const
  const taught = await privacyRead<Doc<'learnAssessmentExposures'> | null>(ctx, userId, ['today-check-teaching', opportunity.assignmentId], null, ctx =>
    ctx.db.query('learnAssessmentExposures').withIndex('by_userId_and_assignmentId_and_purpose_and_status_and_serverTime', q =>
      q.eq('userId', userId).eq('assignmentId', opportunity.assignmentId).eq('purpose', 'teaching').eq('status', 'granted')).first())
  const now = Date.now()
  if (!taught || taught.objectiveId !== opportunity.objectiveId || taught.blueprintRevisionId !== opportunity.blueprintRevisionId
    || taught.learningVoidId !== opportunity.learningVoidId || !Number.isFinite(taught.serverTime) || taught.serverTime < 0 || taught.serverTime > now) return 'earlier' as const
  const days = (now - taught.serverTime) / 86_400_000
  return days >= 4 && days < 14 ? 'about_a_week' as const : days >= 14 && days < 46 ? 'about_a_month' as const : 'earlier' as const
}

export async function todayCheckLabel(ctx: QueryCtx | MutationCtx, userId: string, opportunity: Doc<'learnAssessmentOpportunities'>,
  pointerVersion: string) {
  if (!todayCanvasChecksEnabled() || pointerVersion !== LEARN_TODAY_CHECK_POINTER_VERSION) return { version: LEARN_TODAY_CHECK_POINTER_LEGACY_VERSION }
  const timing = await timingForCheck(ctx, userId, opportunity)
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
