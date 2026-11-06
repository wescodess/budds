import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx, MutationCtx } from '../_generated/server'
import type { LearnResponseTarget } from '../../shared/learn-v2-responses'
import { requireAuth } from './auth'
import { hasLearnV2Access } from './learnV2Access'
import { hasAdaptiveExperienceAccess } from './adaptiveLearnAccess'

type ReadContext = QueryCtx | MutationCtx
type ResponseScope = Doc<'learnAssessmentOpportunities'> | Doc<'learnResponseSlots'> | Doc<'learnResponses'>
function deny(): never { throw new Error('Learn access denied') }

async function requireResponseScope(ctx: ReadContext, userId: string, row: ResponseScope) {
  if (row.userId !== userId) deny()
  if (row.scopeKind === 'standalone') {
    const [thread, activity] = await Promise.all([ctx.db.get(row.threadId), ctx.db.get(row.activityId)])
    if (!thread || thread.userId !== userId || thread.authorityKind !== 'standalone'
      || !activity || activity.userId !== userId || activity.threadId !== thread._id
      || !(await hasAdaptiveExperienceAccess(ctx, userId))) deny()
    return
  }
  const [learningVoid, blueprint, objective] = await Promise.all([
    ctx.db.get(row.learningVoidId), ctx.db.get(row.blueprintRevisionId), ctx.db.get(row.objectiveId),
  ])
  if (!learningVoid || learningVoid.userId !== userId || !blueprint || blueprint.userId !== userId
    || blueprint.learningVoidId !== learningVoid._id || !objective || objective.userId !== userId
    || objective.blueprintRevisionId !== blueprint._id || !(await hasLearnV2Access(ctx, userId))) deny()
  if (row.contextPins.kind !== 'calibration') {
    const pins = row.contextPins
    const [plan, revision] = await Promise.all([ctx.db.get(pins.studyPlanId), ctx.db.get(pins.studyPlanRevisionId)])
    if (!plan || plan.userId !== userId || plan.learningVoidId !== learningVoid._id
      || !revision || revision.userId !== userId || revision.studyPlanId !== plan._id || revision.learningVoidId !== learningVoid._id) deny()
    if (pins.kind === 'session') {
      const [session, content] = await Promise.all([ctx.db.get(pins.studySessionId), ctx.db.get(pins.sessionContentId)])
      if (!session || session.userId !== userId || session.studyPlanRevisionId !== revision._id
        || !content || content.userId !== userId || content.studySessionId !== session._id
        || content.blueprintRevisionId !== blueprint._id) deny()
      if (pins.canvas) {
        const [thread, activity] = await Promise.all([ctx.db.get(pins.canvas.threadId), ctx.db.get(pins.canvas.activityId)])
        if (!thread || thread.userId !== userId || thread.authorityKind !== 'v2_mission' || thread.learningVoidId !== learningVoid._id
          || !activity || activity.userId !== userId || activity.threadId !== thread._id || activity.sessionContentId !== content._id
          || !(await hasAdaptiveExperienceAccess(ctx, userId))) deny()
      }
    }
  }
}

export async function requireOwnedResponseTarget(ctx: ReadContext, userId: string, target: LearnResponseTarget) {
  if (await requireAuth(ctx) !== userId) deny()
  const row = 'assessmentOpportunityId' in target
    ? await ctx.db.get(target.assessmentOpportunityId) : await ctx.db.get(target.responseSlotId)
  if (!row) deny()
  await requireResponseScope(ctx, userId, row)
  return row
}

export async function requireOwnedSubmission(ctx: ReadContext, submissionId: Id<'learnResponses'>) {
  const userId = await requireAuth(ctx)
  const submission = await ctx.db.get(submissionId)
  if (!submission || submission.userId !== userId || !('assessmentOpportunityId' in submission)) deny()
  await requireResponseScope(ctx, userId, submission)
  const target = await requireOwnedResponseTarget(ctx, userId, { assessmentOpportunityId: submission.assessmentOpportunityId })
  if (target.submissionId !== submission._id) deny()
}

function activeReportGrant(grant: Doc<'learnMeasurementReportViewerGrants'>, userId: string) {
  const now = Date.now()
  return grant.userId === userId && grant.status === 'active' && grant.revokedAt === undefined
    && grant.grantedAt <= now && grant.expiresAt > now
    && grant.principalBindingVersion.trim().length > 0 && grant.grantVersion.trim().length > 0
}

export async function requireOwnedReportGrant(ctx: ReadContext, grantId: Id<'learnMeasurementReportViewerGrants'>) {
  const userId = await requireAuth(ctx)
  const grant = await ctx.db.get(grantId)
  if (!grant || !activeReportGrant(grant, userId)) deny()
  return grant
}

export async function requireOwnedReport(ctx: ReadContext, reportRunId: Id<'learnMeasurementReportRuns'>) {
  const userId = await requireAuth(ctx)
  const run = await ctx.db.get(reportRunId)
  if (!run || run.userId !== userId) deny()
  const grants = await ctx.db.query('learnMeasurementReportViewerGrants')
    .withIndex('by_userId_and_cohortVersion_and_epoch', q => q.eq('userId', userId).eq('cohortVersion', run.cohortVersion).eq('epoch', run.epoch))
    .take(8)
  if (!grants.some(grant => activeReportGrant(grant, userId))) deny()
}
