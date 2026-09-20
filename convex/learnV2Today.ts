import type { Doc } from './_generated/dataModel'
import { query } from './_generated/server'
import { requireLearnV2QueryAccess } from './lib/learnV2Access'
import { localDateAt } from '../shared/learn-v2-mastery'

const MAX_SESSIONS = 128
const MAX_CLAIMS = 32
const ACTIVE_SESSION_STATUSES: Array<Doc<'studySessions'>['status']> = ['in_progress', 'ready', 'blocked', 'generation_failed', 'planned']

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
    const sessions: Doc<'studySessions'>[] = []
    for (const status of ACTIVE_SESSION_STATUSES) {
      const remaining = MAX_SESSIONS - sessions.length
      const rows = await ctx.db.query('studySessions')
        .withIndex('by_userId_and_status_and_scheduledStartAt', q => q.eq('userId', userId).eq('status', status))
        .take(remaining + 1)
      if (rows.length > remaining) return { status: 'blocked' as const, reason: 'today_candidate_limit' }
      sessions.push(...rows)
    }
    const now = Date.now()
    const candidates: Candidate[] = []
    for (const session of sessions) {
      const plan = await ctx.db.get(session.studyPlanRevisionId); const root = plan && await ctx.db.get(plan.studyPlanId)
      const blueprint = plan?.blueprintRevisionId && await ctx.db.get(plan.blueprintRevisionId); const objective = await ctx.db.get(session.primaryObjectiveId)
      const voidRow = plan && await ctx.db.get(plan.learningVoidId); const folder = voidRow && await ctx.db.get(voidRow.folderId)
      if (!plan || !root || !blueprint || !objective || !voidRow || !folder || plan.userId !== userId || root.userId !== userId || blueprint.userId !== userId || objective.userId !== userId || voidRow.userId !== userId || folder.userId !== userId || root.activeRevisionId !== plan._id || plan.status !== 'accepted' || blueprint.status !== 'accepted' || voidRow.activeBlueprintRevisionId !== blueprint._id || plan.blueprintRecordRevision !== blueprint.recordRevision || objective.blueprintRevisionId !== blueprint._id) continue
      const record = await ctx.db.query('masteryRecords').withIndex('by_userId_and_blueprintRevisionId_and_objectiveId', q => q.eq('userId', userId).eq('blueprintRevisionId', blueprint._id).eq('objectiveId', objective._id)).unique()
      candidates.push({ session, plan, blueprint, objective, record })
    }
    const nextScheduledAt = candidates.filter(row => row.session.status !== 'in_progress' && row.session.scheduledStartAt > now).map(row => row.session.scheduledStartAt).sort((a, b) => a - b)[0] ?? null
    const selectable = candidates.filter(row => {
      if (row.session.status === 'in_progress') return true
      if (row.session.scheduledEndAt !== undefined && row.session.scheduledEndAt < now) return false
      if (row.session.scheduledStartAt <= now) return true
      const timezone = row.session.timezone ?? row.plan.timezone ?? 'UTC'
      return localDateAt(row.session.scheduledStartAt, timezone) === localDateAt(now, timezone)
    })
    if (!selectable.length) return { status: 'empty' as const, nextScheduledAt }
    selectable.sort((a, b) => rank(a.session, a.record, now) - rank(b.session, b.record, now) || a.session.scheduledStartAt - b.session.scheduledStartAt || String(a.session._id).localeCompare(String(b.session._id)))
    const candidate = selectable[0]!
    if (candidate.session.status === 'blocked' || candidate.session.status === 'generation_failed') return {
      status: 'blocked' as const,
      reason: candidate.session.auditReasonCode ?? 'session_generation_unavailable',
      sessionId: candidate.session._id,
      sessionRevision: candidate.session.revision,
      canRetryGeneration: true,
      nextScheduledAt,
    }
    if (candidate.session.status === 'planned') return { status: 'pending' as const, sessionId: candidate.session._id, scheduledStartAt: candidate.session.scheduledStartAt, nextScheduledAt }
    const content = candidate.session.status === 'in_progress'
      ? await ctx.db.query('sessionContent').withIndex('by_userId_and_studySessionId_and_revision', q => q.eq('userId', userId).eq('studySessionId', candidate.session._id).eq('revision', candidate.session.startedSessionContentRevision!)).unique()
      : await ctx.db.query('sessionContent').withIndex('by_userId_and_studySessionId_and_revision', q => q.eq('userId', userId).eq('studySessionId', candidate.session._id)).order('desc').first()
    if (!content || content.status !== 'published'
      || (candidate.session.status === 'in_progress' && (candidate.session.startedSessionContentId !== content._id || candidate.session.startedSessionContentRevision !== content.revision))
      || content.studyPlanRevisionId !== candidate.plan._id || content.blueprintRevisionId !== candidate.blueprint._id || content.objectiveId !== candidate.objective._id) return { status: 'blocked' as const, reason: 'started_content_unavailable', nextScheduledAt }
    const claims = await ctx.db.query('sessionContentClaims').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(MAX_CLAIMS + 1)
    if (!claims.length || claims.length > MAX_CLAIMS) return { status: 'blocked' as const, reason: 'content_evidence_unavailable', nextScheduledAt }
    for (const claim of claims) {
      const supports = await ctx.db.query('learnClaimSupports').withIndex('by_userId_and_sessionContentClaimId', q => q.eq('userId', userId).eq('sessionContentClaimId', claim._id)).take(9)
      if (!supports.length || supports.length > 8) return { status: 'blocked' as const, reason: 'content_evidence_unavailable', nextScheduledAt }
      for (const support of supports) {
        const excerpt = await ctx.db.get(support.sourceExcerptId)
        const sourceId = support.sourceSnapshotId ?? excerpt?.sourceSnapshotId
        const source = sourceId && await ctx.db.get(sourceId)
        if (!excerpt || excerpt.userId !== userId || excerpt.evidencePurgedAt !== undefined
          || !source || source.userId !== userId || source.evidencePurgedAt !== undefined || source.status !== 'user_accepted' || source.effectiveStatus !== 'user_accepted' || source.conflictStatus !== 'clear'
          || support.entailment !== 'entailed' || support.conflictStatus !== 'clear' || support.evidenceStatus !== 'evidence_available' || !support.verifierVersion?.trim() || (support.confidence ?? 0) < 0.8) return { status: 'blocked' as const, reason: 'content_evidence_unavailable', nextScheduledAt }
        const storedEvidence = source.rightsStatus === 'permitted' && excerpt.rightsStatus === 'permitted' && !!excerpt.excerpt?.trim()
        const identity = storedEvidence ? null : await ctx.db.get(source.sourceIdentityId)
        const folderLocator = identity?.userId === userId && identity.origin === 'folder_document' && !!identity.folderDocumentId
          && typeof source.contentHash === 'string' && typeof source.sourceRevision === 'string'
        if (!storedEvidence && !folderLocator) return { status: 'blocked' as const, reason: 'content_evidence_unavailable', nextScheduledAt }
      }
    }
    if (!Number.isSafeInteger(candidate.plan.recordRevision)) return { status: 'blocked' as const, reason: 'plan_revision_unavailable', nextScheduledAt }
    return { status: 'ready' as const, sessionId: candidate.session._id, sessionRevision: candidate.session.revision, scheduledStartAt: candidate.session.scheduledStartAt, scheduledEndAt: candidate.session.scheduledEndAt ?? null, timezone: candidate.session.timezone ?? candidate.plan.timezone ?? 'UTC', placementKind: candidate.session.placementKind ?? 'learning', objective: { id: candidate.objective._id, title: candidate.objective.title, capability: candidate.objective.capability ?? null, estimatedMinutes: candidate.objective.estimatedMinutes ?? null }, mastery: { state: candidate.record?.state ?? 'unseen', nextReviewAt: candidate.record?.nextReviewAt ?? null }, content: { id: content._id, revision: content.revision, assessmentRubricVersion: (() => { try { return JSON.parse(content.assessmentRubricSnapshot ?? '{}').version ?? null } catch { return null } })() }, plan: { revisionId: candidate.plan._id, recordRevision: candidate.plan.recordRevision!, blueprintRevisionId: candidate.blueprint._id, blueprintRecordRevision: candidate.blueprint.recordRevision }, nextScheduledAt }
  },
})
