import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { LEARN_MEASUREMENT_CAPABILITIES } from '../../shared/learn-v2-measurement-storage-manifest'

export const LEARN_DELAYED_DELIVERY_VERSION = 'learn-v2.delayed-delivery.v1'
const MAX_REFLOWS = 32
type ReadCtx = QueryCtx | MutationCtx
type Plan = Doc<'studyPlanRevisions'>

export function isDedicatedLearnCheck(session: Doc<'studySessions'>) {
  return LEARN_MEASUREMENT_CAPABILITIES.responses && ['measurement_cold', 'measurement_delayed'].includes(session.assessmentPurpose ?? '')
    && session.assessmentOpportunityId !== undefined && session.schedulerVersion === LEARN_DELAYED_DELIVERY_VERSION
}

function samePlanScope(left: Plan, right: Plan, userId: string) {
  return left.userId === userId && right.userId === userId && left.studyPlanId === right.studyPlanId
    && left.learningVoidId === right.learningVoidId && left.blueprintRevisionId === right.blueprintRevisionId
    && left.blueprintRecordRevision === right.blueprintRecordRevision
}

export async function hasLearnReflowPlanAuthority(ctx: ReadCtx, userId: string, plan: Plan, pinnedRecordRevision?: number) {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses || plan.userId !== userId || plan.status !== 'superseded'
    || plan.acceptedAt === undefined || pinnedRecordRevision !== undefined && plan.recordRevision !== pinnedRecordRevision + 1) return false
  const root = await ctx.db.get(plan.studyPlanId)
  if (!root || root.userId !== userId || root.learningVoidId !== plan.learningVoidId || !root.activeRevisionId) return false
  let current = await ctx.db.get(root.activeRevisionId)
  if (current?.status !== 'accepted') return false
  const seen = new Set<string>()
  for (let count = 0; count < MAX_REFLOWS; count++) {
    if (!current || current.acceptedAt === undefined || seen.has(current._id) || !samePlanScope(plan, current, userId)
      || current.changeReason !== 'future_incomplete_reflow' || !current.parentRevisionId) return false
    if (current.parentRevisionId === plan._id) return current.revision === plan.revision + 1
    seen.add(current._id)
    const parent: Plan | null = await ctx.db.get(current.parentRevisionId)
    if (parent?.status !== 'superseded' || current.revision !== parent.revision + 1) return false
    current = parent
  }
  return false
}

export async function requireLearnActiveWorkPlan(ctx: ReadCtx, userId: string, source: Plan) {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return source
  const [root, learningVoid, blueprint] = await Promise.all([ctx.db.get(source.studyPlanId), ctx.db.get(source.learningVoidId),
    source.blueprintRevisionId ? ctx.db.get(source.blueprintRevisionId) : null])
  const active = root?.activeRevisionId ? await ctx.db.get(root.activeRevisionId) : null
  const folder = learningVoid && await ctx.db.get(learningVoid.folderId)
  if (!root || root.userId !== userId || !learningVoid || learningVoid.userId !== userId || learningVoid.status === 'archived'
    || !folder || folder.userId !== userId || !blueprint || blueprint.userId !== userId || blueprint.status !== 'accepted'
    || blueprint.learningVoidId !== learningVoid._id || learningVoid.activeBlueprintRevisionId !== blueprint._id
    || root.learningVoidId !== learningVoid._id || !active || active.status !== 'accepted' || !samePlanScope(source, active, userId)
    || active.blueprintRecordRevision !== blueprint.recordRevision
    || active._id !== source._id && !await hasLearnReflowPlanAuthority(ctx, userId, source)) throw new Error('Learn follow-up active plan unavailable')
  const latest = await ctx.db.query('studyPlanRevisions').withIndex('by_userId_and_studyPlanId_and_revision', q =>
    q.eq('userId', userId).eq('studyPlanId', root._id)).order('desc').first()
  if (!latest || latest._id !== active._id && latest.status !== 'draft') throw new Error('Learn follow-up active plan unavailable')
  return active
}

export function isLearnCanvasColdContinuation(session: Doc<'studySessions'>) {
  return LEARN_MEASUREMENT_CAPABILITIES.responses && session.assessmentPurpose === 'independent_application'
    && session.assessmentOpportunityId !== undefined && session.canvasColdCheckId !== undefined
}

export async function hasLearnStartedSessionBinding(ctx: ReadCtx, userId: string, session: Doc<'studySessions'>, plan: Plan) {
  if (!isLearnCanvasColdContinuation(session) || session.userId !== userId || session.studyPlanRevisionId !== plan._id || !['in_progress', 'completed'].includes(session.status)
    || !session.startedSessionContentId || session.startedSessionContentRevision === undefined) return false
  const content = await ctx.db.get(session.startedSessionContentId)
  const objective = await ctx.db.get(session.primaryObjectiveId)
  if (!content || content.userId !== userId || content.status !== 'published' || content.studySessionId !== session._id
    || content.studyPlanRevisionId !== plan._id || content.blueprintRevisionId !== plan.blueprintRevisionId
    || content.objectiveId !== session.primaryObjectiveId || content.revision !== session.startedSessionContentRevision
    || content.assessmentPurpose !== undefined && content.assessmentPurpose !== session.assessmentPurpose
    || content.assessmentOpportunityId !== undefined && content.assessmentOpportunityId !== session.assessmentOpportunityId
    || !objective || objective.userId !== userId || objective.blueprintRevisionId !== plan.blueprintRevisionId) return false
  const opportunity = await ctx.db.get(session.assessmentOpportunityId!)
  const pins = opportunity?.contextPins
  if (!(opportunity?.userId === userId && opportunity.purpose.kind === 'independent_application' && opportunity.assessmentPins.kind === 'session_application'
    && pins?.kind === 'session' && pins.canvas
    && pins.studySessionId === session._id && pins.studyPlanRevisionId === plan._id && pins.sessionContentId === content._id
    && pins.contentRevision === content.revision && pins.contentInputDigest === content.inputDigest && pins.generatorVersion === content.generatorVersion
    && opportunity.objectiveId === session.primaryObjectiveId && opportunity.blueprintRevisionId === plan.blueprintRevisionId)) return false
  const cold = await ctx.db.get(session.canvasColdCheckId!)
  if (!cold || cold.userId !== userId || cold.purpose.kind !== 'measurement_cold' || !cold.assignmentId
    || cold.learningVoidId !== plan.learningVoidId || cold.blueprintRevisionId !== plan.blueprintRevisionId || cold.objectiveId !== session.primaryObjectiveId
    || cold.contextPins.kind !== 'session' || !cold.contextPins.canvas || cold.contextPins.studySessionId === session._id) return false
  const assignment = await ctx.db.get(cold.assignmentId)
  const check = await ctx.db.get(cold.contextPins.studySessionId)
  const source = await ctx.db.get(cold.contextPins.studyPlanRevisionId)
  return assignment?.userId === userId && assignment.status === 'admitted' && assignment.flow === 'v2_canvas'
    && assignment.learningVoidId === cold.learningVoidId && assignment.blueprintRevisionId === cold.blueprintRevisionId && assignment.objectiveId === cold.objectiveId
    && !!check && check.userId === userId && isDedicatedLearnCheck(check) && check.assessmentPurpose === 'measurement_cold'
    && check.assessmentOpportunityId === cold._id && check.studyPlanRevisionId === cold.contextPins.studyPlanRevisionId
    && check.primaryObjectiveId === cold.objectiveId && check.startedSessionContentId === cold.contextPins.sessionContentId
    && check.startedSessionContentRevision === cold.contextPins.contentRevision && !!source && samePlanScope(plan, source, userId)
    && source.revision <= plan.revision && (source._id === plan._id || await hasLearnReflowPlanAuthority(ctx, userId, source, cold.contextPins.planRecordRevision))
}

export async function hasLearnCarriedSessionAuthority(ctx: ReadCtx, userId: string, session: Doc<'studySessions'>, plan: Plan, pinnedRecordRevision?: number) {
  if (!isLearnCanvasColdContinuation(session) || !session.carriedPlanRevisionId || !await hasLearnReflowPlanAuthority(ctx, userId, plan, pinnedRecordRevision)) return false
  const destination = await ctx.db.get(session.carriedPlanRevisionId)
  const root = await ctx.db.get(plan.studyPlanId)
  return !!destination && samePlanScope(plan, destination, userId) && destination.revision > plan.revision
    && (destination._id === root?.activeRevisionId && destination.status === 'accepted' || await hasLearnReflowPlanAuthority(ctx, userId, destination))
    && await hasLearnStartedSessionBinding(ctx, userId, session, plan)
}

export async function hasLearnSessionReflowAuthority(ctx: ReadCtx, userId: string, session: Doc<'studySessions'>, plan: Plan, pinnedRecordRevision?: number) {
  return isDedicatedLearnCheck(session) && await hasLearnReflowPlanAuthority(ctx, userId, plan, pinnedRecordRevision)
    || await hasLearnCarriedSessionAuthority(ctx, userId, session, plan, pinnedRecordRevision)
}

export async function readLearnCarriedSessions(ctx: ReadCtx, userId: string, active: Plan, limit: number) {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return []
  const rows = await ctx.db.query('studySessions').withIndex('by_userId_and_carriedPlanRevisionId_and_canvasColdCheckId', q =>
    q.eq('userId', userId).eq('carriedPlanRevisionId', active._id).gt('canvasColdCheckId', undefined)).take(limit + 1)
  if (rows.length > limit) throw new Error('Carried sessions exceed the bounded Study Plan contract')
  const continuations = rows.filter(isLearnCanvasColdContinuation)
  for (const row of continuations) {
    const plan = await ctx.db.get(row.studyPlanRevisionId)
    if (!plan || !await hasLearnCarriedSessionAuthority(ctx, userId, row, plan)) throw new Error('Carried session authority unavailable')
  }
  return continuations.sort((a, b) => a.scheduledStartAt - b.scheduledStartAt || String(a._id).localeCompare(String(b._id)))
}

export async function readLearnFixedPlanChecks(ctx: ReadCtx, userId: string, active: Plan, limit: number) {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return []
  const purposes = ['measurement_delayed', 'measurement_cold'] as const
  const plans = [active]
  let current = active
  const seen = new Set<string>([active._id])
  while (current.changeReason === 'future_incomplete_reflow' && current.parentRevisionId) {
    const parent: Plan | null = await ctx.db.get(current.parentRevisionId)
    if (!parent || parent.status !== 'superseded' || current.revision !== parent.revision + 1 || !samePlanScope(active, parent, userId)
      || seen.has(parent._id) || plans.length >= MAX_REFLOWS) throw new Error('Study plan reflow lineage is unavailable')
    plans.push(parent); seen.add(parent._id); current = parent
  }
  const checks: Doc<'studySessions'>[] = []
  for (const plan of plans) for (const purpose of purposes) {
    const remaining = limit - checks.length
    const rows = await ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_assessmentPurpose', q =>
      q.eq('userId', userId).eq('studyPlanRevisionId', plan._id).eq('assessmentPurpose', purpose)).take(remaining + 1)
    if (rows.length > remaining) throw new Error('Fixed checks exceed the bounded Study Plan contract')
    checks.push(...rows.filter(isDedicatedLearnCheck))
  }
  return checks.sort((a, b) => a.scheduledStartAt - b.scheduledStartAt || String(a._id).localeCompare(String(b._id)))
}
