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
