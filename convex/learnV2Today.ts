import type { Doc } from './_generated/dataModel'
import { query } from './_generated/server'
import { requireLearnV2QueryAccess } from './lib/learnV2Access'

const MAX_SESSIONS = 128
const MAX_CLAIMS = 32

function rank(session: { placementKind?: string, schedulingPriority?: string, scheduledStartAt: number }, record: { state: string, nextReviewAt?: number } | null, now = Date.now()) {
  if (session.placementKind === 'retained_review' && session.scheduledStartAt <= now) return 0
  if (session.schedulingPriority === 'overdue_retained_review') return 0
  if (record?.state === 'needs_review' || record?.nextReviewAt !== undefined && record.nextReviewAt <= now || session.schedulingPriority === 'prerequisite_remediation') return 1
  if (session.schedulingPriority === 'due_review' || session.placementKind === 'review') return 2
  return 3
}

type Candidate = { session: Doc<'studySessions'>, plan: Doc<'studyPlanRevisions'>, blueprint: Doc<'learnBlueprintRevisions'>, objective: Doc<'learnObjectives'>, record: Doc<'masteryRecords'> | null }

// The projection intentionally verifies current pins again. A stale shell is not a
// to-do item: it remains invisible until the plan/generation path repairs it.
export const getToday = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireLearnV2QueryAccess(ctx)
    const sessions = await ctx.db.query('studySessions').withIndex('by_userId', q => q.eq('userId', userId)).take(MAX_SESSIONS + 1)
    if (sessions.length > MAX_SESSIONS) return { status: 'blocked' as const, reason: 'today_candidate_limit' }
    const now = Date.now()
    const candidates: Candidate[] = []
    for (const session of sessions) {
      if (session.status !== 'planned' && session.status !== 'ready' && session.status !== 'in_progress' && session.status !== 'blocked' && session.status !== 'generation_failed') continue
      const plan = await ctx.db.get(session.studyPlanRevisionId); const root = plan && await ctx.db.get(plan.studyPlanId)
      const blueprint = plan?.blueprintRevisionId && await ctx.db.get(plan.blueprintRevisionId); const objective = await ctx.db.get(session.primaryObjectiveId)
      const voidRow = plan && await ctx.db.get(plan.learningVoidId); const folder = voidRow && await ctx.db.get(voidRow.folderId)
      if (!plan || !root || !blueprint || !objective || !voidRow || !folder || plan.userId !== userId || root.userId !== userId || blueprint.userId !== userId || objective.userId !== userId || voidRow.userId !== userId || folder.userId !== userId || root.activeRevisionId !== plan._id || plan.status !== 'accepted' || blueprint.status !== 'accepted' || plan.blueprintRecordRevision !== blueprint.recordRevision || objective.blueprintRevisionId !== blueprint._id) continue
      const record = await ctx.db.query('masteryRecords').withIndex('by_userId_and_objectiveId', q => q.eq('userId', userId).eq('objectiveId', objective._id)).unique()
      candidates.push({ session, plan, blueprint, objective, record })
    }
    const nextScheduledAt = candidates.filter(row => row.session.scheduledStartAt > now).map(row => row.session.scheduledStartAt).sort((a, b) => a - b)[0] ?? null
    if (!candidates.length) return { status: 'empty' as const, nextScheduledAt }
    candidates.sort((a, b) => rank(a.session, a.record, now) - rank(b.session, b.record, now) || a.session.scheduledStartAt - b.session.scheduledStartAt || String(a.session._id).localeCompare(String(b.session._id)))
    const candidate = candidates[0]!
    if (candidate.session.status === 'blocked' || candidate.session.status === 'generation_failed') return { status: 'blocked' as const, reason: candidate.session.auditReasonCode ?? 'session_generation_unavailable', nextScheduledAt }
    if (candidate.session.status === 'planned') return { status: 'pending' as const, sessionId: candidate.session._id, scheduledStartAt: candidate.session.scheduledStartAt, nextScheduledAt }
    const content = candidate.session.status === 'in_progress'
      ? await ctx.db.query('sessionContent').withIndex('by_userId_and_studySessionId_and_revision', q => q.eq('userId', userId).eq('studySessionId', candidate.session._id).eq('revision', candidate.session.startedSessionContentRevision!)).unique()
      : await ctx.db.query('sessionContent').withIndex('by_userId_and_studySessionId_and_revision', q => q.eq('userId', userId).eq('studySessionId', candidate.session._id)).order('desc').first()
    if (!content || content.status !== 'published' || content.studyPlanRevisionId !== candidate.plan._id || content.blueprintRevisionId !== candidate.blueprint._id || content.objectiveId !== candidate.objective._id) return { status: 'blocked' as const, reason: 'started_content_unavailable', nextScheduledAt }
    const claims = await ctx.db.query('sessionContentClaims').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(MAX_CLAIMS + 1)
    if (!claims.length || claims.length > MAX_CLAIMS) return { status: 'blocked' as const, reason: 'content_evidence_unavailable', nextScheduledAt }
    for (const claim of claims) {
      const supports = await ctx.db.query('learnClaimSupports').withIndex('by_userId_and_sessionContentClaimId', q => q.eq('userId', userId).eq('sessionContentClaimId', claim._id)).take(9)
      if (!supports.length || supports.length > 8 || supports.some(row => row.entailment !== 'entailed' || row.conflictStatus !== 'clear' || row.evidenceStatus !== 'evidence_available')) return { status: 'blocked' as const, reason: 'content_evidence_unavailable', nextScheduledAt }
    }
    return { status: 'ready' as const, sessionId: candidate.session._id, sessionRevision: candidate.session.revision, scheduledStartAt: candidate.session.scheduledStartAt, scheduledEndAt: candidate.session.scheduledEndAt ?? null, placementKind: candidate.session.placementKind ?? 'learning', objective: { id: candidate.objective._id, title: candidate.objective.title, capability: candidate.objective.capability ?? null, estimatedMinutes: candidate.objective.estimatedMinutes ?? null }, mastery: { state: candidate.record?.state ?? 'unseen', nextReviewAt: candidate.record?.nextReviewAt ?? null }, content: { id: content._id, revision: content.revision, assessmentRubricVersion: (() => { try { return JSON.parse(content.assessmentRubricSnapshot ?? '{}').version ?? null } catch { return null } })() }, plan: { revisionId: candidate.plan._id, recordRevision: candidate.plan.recordRevision ?? null, blueprintRevisionId: candidate.blueprint._id, blueprintRecordRevision: candidate.blueprint.recordRevision }, nextScheduledAt }
  },
})
