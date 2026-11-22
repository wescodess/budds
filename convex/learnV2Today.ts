import type { Doc } from './_generated/dataModel'
import { query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { requireLearnV2QueryAccess } from './lib/learnV2Access'
import { localDateAt } from '../shared/learn-v2-mastery'
import { requireActiveBlueprint } from './lib/learnV2BlueprintAuthority'
import { getScopedMasteryRecord, masteryScopeKey } from './lib/learnV2MasteryScope'
import { isTestOnlyMeasurementSession } from './lib/learnV2MeasurementItems'
import { enrollLearnMeasurementForOwner, type AdmittedAssignment } from './lib/learnV2Measurement'
import { getFrozenLearnMeasurementProtocol } from './lib/learnV2MeasurementAssignment'
import { privacyDigest } from './lib/learnV2ResponsePrivacy'
import { readLearnAssessmentStateForOwner } from './lib/learnV2AssessmentDelivery'
import type { LearnV2AssessmentState } from './lib/learnV2PublicContract'
import { LEARN_MEASUREMENT_CAPABILITIES } from '../shared/learn-v2-measurement-storage-manifest'

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

export type TodayAssessment =
  | { kind: 'ordinary' }
  | { kind: 'unprepared' }
  | { kind: 'blocked', reasonCode: string, opportunity: Doc<'learnAssessmentOpportunities'> | null, state: LearnV2AssessmentState | null }
  | { kind: 'check', opportunity: Doc<'learnAssessmentOpportunities'>, state: LearnV2AssessmentState & { status: 'available' } }
  | { kind: 'teach', opportunity: Doc<'learnAssessmentOpportunities'>, assignment: AdmittedAssignment }

async function measurementCatalogEnabled(ctx: QueryCtx | MutationCtx, userId: string) {
  const rows = await ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', userId)).take(2)
  return rows.length === 1 && rows[0]!.measurementCapability?.enabled === true
}

async function assessmentState(ctx: QueryCtx | MutationCtx, userId: string, opportunity: Doc<'learnAssessmentOpportunities'>): Promise<TodayAssessment> {
  const state = await readLearnAssessmentStateForOwner(ctx, userId, opportunity._id, 'today')
  if (state.status !== 'available') return { kind: 'blocked', reasonCode: state.status === 'disabled' ? 'disabled' : state.reasonCodes[0] ?? 'assessment_unavailable', opportunity, state }
  return { kind: 'check', opportunity, state }
}

function coldOpen(opportunity: Doc<'learnAssessmentOpportunities'>, now: number) {
  return opportunity.submissionId === undefined && ['ready', 'test_open'].includes(opportunity.phase)
    && opportunity.operationalEligibility === 'eligible' && now < opportunity.closeAt
}

export async function resolveTodayAssessment(ctx: QueryCtx | MutationCtx, userId: string, session: Doc<'studySessions'>): Promise<TodayAssessment> {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return { kind: 'ordinary' }
  const blocked = (reasonCode: string): TodayAssessment => ({ kind: 'blocked', reasonCode, opportunity: null, state: null })
  if (isTestOnlyMeasurementSession(session)) {
    let opportunity = session.assessmentOpportunityId ? await ctx.db.get(session.assessmentOpportunityId) : null
    if (session.assessmentOpportunityId && !opportunity) return blocked('assessment_unavailable')
    if (!opportunity) {
      const rows = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_contextPins_studySessionId', q => q.eq('userId', userId).eq('contextPins.studySessionId', session._id)).take(2)
      if (rows.length !== 1) return blocked('assessment_unavailable')
      opportunity = rows[0]!
    }
    if (opportunity.userId !== userId || opportunity.objectiveId !== session.primaryObjectiveId || opportunity.contextPins.kind === 'calibration'
      || opportunity.contextPins.studyPlanRevisionId !== session.studyPlanRevisionId
      || opportunity.contextPins.kind === 'session' && opportunity.contextPins.studySessionId !== session._id
      || session.assessmentPurpose !== undefined && opportunity.purpose.kind !== session.assessmentPurpose
      || session.placementKind === 'retained_review' && !['retained_transfer', 'measurement_delayed'].includes(opportunity.purpose.kind)) return blocked('pins_mismatch')
    return await assessmentState(ctx, userId, opportunity)
  }
  if (!LEARN_MEASUREMENT_CAPABILITIES.enrollment || !await measurementCatalogEnabled(ctx, userId)) return { kind: 'ordinary' }
  const protocol = getFrozenLearnMeasurementProtocol()
  if (!protocol) return blocked('protocol_not_frozen')
  const plan = await ctx.db.get(session.studyPlanRevisionId)
  if (!plan?.blueprintRevisionId || plan.userId !== userId) return blocked('pins_mismatch')
  const assignmentKey = await privacyDigest(['learn-v2.measurement-episode.v1',
    await masteryScopeKey(userId, plan.blueprintRevisionId, session.primaryObjectiveId), protocol.epoch])
  const assignment = await ctx.db.query('learnMeasurementAssignments').withIndex('by_userId_and_assignmentKey', q => q.eq('userId', userId).eq('assignmentKey', assignmentKey)).unique()
  if (!assignment) return session.status === 'in_progress' ? { kind: 'ordinary' } : { kind: 'unprepared' }
  if (assignment.status !== 'admitted') return { kind: 'ordinary' }
  const opportunity = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_assignmentId_and_horizonDays', q => q.eq('userId', userId).eq('assignmentId', assignment._id).eq('horizonDays', undefined)).unique()
  if (!opportunity || opportunity.purpose.kind !== 'measurement_cold' || opportunity.objectiveId !== session.primaryObjectiveId) return blocked('assessment_unavailable')
  if (!coldOpen(opportunity, Date.now())) return { kind: 'teach', opportunity, assignment: assignment as AdmittedAssignment }
  if (assignment.flow !== 'v2_today') return { kind: 'blocked', reasonCode: 'flow_mismatch', opportunity, state: null }
  return await assessmentState(ctx, userId, opportunity)
}

export async function prepareTodayAssessment(ctx: MutationCtx, userId: string, session: Doc<'studySessions'>, entryPoint: 'today' | 'session_deep_link') {
  const current = await resolveTodayAssessment(ctx, userId, session)
  if (current.kind !== 'unprepared') return current
  const plan = await ctx.db.get(session.studyPlanRevisionId)
  if (!plan?.blueprintRevisionId) return current
  const families = await ctx.db.query('learnMeasurementFamilies').withIndex('by_userId_and_blueprintRevisionId_and_objectiveId', q => q.eq('userId', userId).eq('blueprintRevisionId', plan.blueprintRevisionId!).eq('objectiveId', session.primaryObjectiveId)).take(7)
  const available = families.filter(row => ['provisional_equivalent', 'empirically_supported'].includes(row.status) && row.evidenceStatus === 'available' && row.invalidatedAt === undefined)
  await enrollLearnMeasurementForOwner(ctx, userId, { studySessionId: session._id, entryPoint,
    ...(families.length <= 6 && available.length === 1 ? { familyId: available[0]!._id } : {}) })
  const prepared = await resolveTodayAssessment(ctx, userId, session)
  return prepared.kind === 'unprepared' ? { kind: 'blocked' as const, reasonCode: 'assessment_not_prepared', opportunity: null, state: null } : prepared
}

export function todayAssessmentSummary(assessment: Exclude<TodayAssessment, { kind: 'ordinary' }>, reasonCode?: string) {
  return { kind: assessment.kind, reasonCode: reasonCode ?? (assessment.kind === 'blocked' ? assessment.reasonCode : null),
    state: assessment.kind === 'check' || assessment.kind === 'blocked' ? assessment.state : null }
}

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
      if (!plan || !root || !blueprint || !objective || !voidRow || !folder || plan.userId !== userId || root.userId !== userId || blueprint.userId !== userId || objective.userId !== userId || voidRow.userId !== userId || folder.userId !== userId || root.activeRevisionId !== plan._id || plan.status !== 'accepted' || blueprint.status !== 'accepted' || plan.blueprintRecordRevision !== blueprint.recordRevision || objective.blueprintRevisionId !== blueprint._id) continue
      try { await requireActiveBlueprint(ctx, userId, voidRow, blueprint._id) }
      catch { continue }
      const record = (await getScopedMasteryRecord(ctx, userId, blueprint._id, objective._id)).record
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
    const assessment = await resolveTodayAssessment(ctx, userId, candidate.session)
    if (assessment.kind === 'blocked') return { status: 'blocked' as const, reason: assessment.reasonCode,
      sessionId: candidate.session._id, sessionRevision: candidate.session.revision, canRetryGeneration: false, nextScheduledAt }
    if (assessment.kind === 'check') return { status: 'ready' as const, sessionId: candidate.session._id, sessionRevision: candidate.session.revision,
      scheduledStartAt: candidate.session.scheduledStartAt, scheduledEndAt: candidate.session.scheduledEndAt ?? null,
      timezone: candidate.session.timezone ?? candidate.plan.timezone ?? 'UTC', placementKind: candidate.session.placementKind ?? 'learning',
      objective: { id: candidate.objective._id, title: candidate.objective.title, capability: candidate.objective.capability ?? null, estimatedMinutes: candidate.objective.estimatedMinutes ?? null },
      mastery: { state: candidate.record?.state ?? 'unseen', nextReviewAt: candidate.record?.nextReviewAt ?? null },
      content: { id: content._id, revision: content.revision, assessmentRubricVersion: null },
      plan: { revisionId: candidate.plan._id, recordRevision: candidate.plan.recordRevision!, blueprintRevisionId: candidate.blueprint._id, blueprintRecordRevision: candidate.blueprint.recordRevision },
      assessment: todayAssessmentSummary(assessment), nextScheduledAt }
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
    return { status: 'ready' as const, sessionId: candidate.session._id, sessionRevision: candidate.session.revision, scheduledStartAt: candidate.session.scheduledStartAt, scheduledEndAt: candidate.session.scheduledEndAt ?? null, timezone: candidate.session.timezone ?? candidate.plan.timezone ?? 'UTC', placementKind: candidate.session.placementKind ?? 'learning', objective: { id: candidate.objective._id, title: candidate.objective.title, capability: candidate.objective.capability ?? null, estimatedMinutes: candidate.objective.estimatedMinutes ?? null }, mastery: { state: candidate.record?.state ?? 'unseen', nextReviewAt: candidate.record?.nextReviewAt ?? null }, content: { id: content._id, revision: content.revision, assessmentRubricVersion: (() => { try { return JSON.parse(content.assessmentRubricSnapshot ?? '{}').version ?? null } catch { return null } })() }, plan: { revisionId: candidate.plan._id, recordRevision: candidate.plan.recordRevision!, blueprintRevisionId: candidate.blueprint._id, blueprintRecordRevision: candidate.blueprint.recordRevision }, ...(assessment.kind === 'ordinary' ? {} : { assessment: todayAssessmentSummary(assessment) }), nextScheduledAt }
  },
})
