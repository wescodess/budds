import { LearnBlueprintAuthorityError } from '../shared/learn-v2-errors'
import type { Doc } from './_generated/dataModel'
import { v } from 'convex/values'
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
import { hasLearnReflowPlanAuthority, isDedicatedLearnCheck } from './lib/learnV2FixedChecks'
import { hasAdaptiveExperienceAccess } from './lib/adaptiveLearnAccess'
import { prepareCanvasSessionForOwner, readCanvasCheckPointerForOwner } from './learnAdaptiveCanvas'
import { LEARN_TODAY_CHECK_LIMIT, LEARN_TODAY_CLOSED_CHECK_DAYS, isFrozenTodayCanvasAssignment, todayCanvasChecksEnabled, type LearnTodayCheckPointer } from '../shared/learn-v2-today-check'
import { measurementReadContext } from './lib/learnV2MeasurementReadContext'
import { remainingPrivacyReadBudget } from './lib/learnV2PrivacyReadContext'
import { todayCheckPointersValidator } from './lib/learnV2PublicContract'
import { ADAPTIVE_ACTIVITY_PLAN_VERSION } from '../shared/learn-adaptive-activity-plan'

const MAX_SESSIONS = 128
const MAX_CLAIMS = 32
const POINTER_READ_RESERVE = 896
const POINTER_CANDIDATE_LIMIT = 8
const POINTER_PHASES = ['ready', 'test_open', 'submitted_sealed', 'scoring_pending', 'retryable_failure', 'reconciliation_required', 'scored_pass', 'scored_fail'] as const
const POINTER_PURPOSES = ['measurement_cold', 'measurement_delayed', 'retained_transfer'] as const
const POINTER_CURSOR_PREFIX = 'today-checks-v2:'
const POINTER_DISCOVERY_RESERVE = 48
const POINTER_SAVED_PAGE = 32
const POINTER_VERSION_PAGE = 4
const ACTIVE_SESSION_STATUSES: Array<Doc<'studySessions'>['status']> = ['in_progress', 'ready', 'blocked', 'generation_failed', 'planned']

function rank(session: { assessmentPurpose?: string, placementKind?: string, schedulingPriority?: string, scheduledStartAt: number }, record: { state: string, nextReviewAt?: number } | null, now = Date.now()) {
  if (LEARN_MEASUREMENT_CAPABILITIES.responses && session.assessmentPurpose === 'measurement_delayed' && session.scheduledStartAt <= now) return -1
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
  | { kind: 'check', flow: 'today', opportunity: Doc<'learnAssessmentOpportunities'>, state: LearnV2AssessmentState & { status: 'available' } }
  | { kind: 'check', flow: 'canvas', opportunity: Doc<'learnAssessmentOpportunities'>, state: null, pointer: LearnTodayCheckPointer }
  | { kind: 'teach', opportunity: Doc<'learnAssessmentOpportunities'>, assignment: AdmittedAssignment }

async function measurementCatalogEnabled(ctx: QueryCtx | MutationCtx, userId: string) {
  const rows = await ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', userId)).take(2)
  return rows.length === 1 && rows[0]!.measurementCapability?.enabled === true
}

async function assessmentState(ctx: QueryCtx | MutationCtx, userId: string, opportunity: Doc<'learnAssessmentOpportunities'>): Promise<TodayAssessment> {
  const assignment = opportunity.assignmentId ? await ctx.db.get(opportunity.assignmentId) : null
  const canvas = assignment?.status === 'admitted' ? assignment.flow === 'v2_canvas' : opportunity.contextPins.kind === 'session' && !!opportunity.contextPins.canvas
  if (canvas && (todayCanvasChecksEnabled() || isFrozenTodayCanvasAssignment(assignment))) {
    if (opportunity.contextPins.kind !== 'session' || !opportunity.contextPins.canvas) return { kind: 'blocked', reasonCode: 'flow_mismatch', opportunity, state: null }
    const pointer = await readCanvasCheckPointerForOwner(ctx, userId, opportunity)
    return pointer ? { kind: 'check', flow: 'canvas', opportunity, state: null, pointer }
      : { kind: 'blocked', reasonCode: 'canvas_not_admitted', opportunity, state: null }
  }
  const state = await readLearnAssessmentStateForOwner(ctx, userId, opportunity._id, 'today')
  if (state.status !== 'available') return { kind: 'blocked', reasonCode: state.status === 'disabled' ? 'disabled' : state.reasonCodes[0] ?? 'assessment_unavailable', opportunity, state }
  return { kind: 'check', flow: 'today', opportunity, state }
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
  return await assessmentState(ctx, userId, opportunity)
}

export async function prepareTodayAssessment(ctx: MutationCtx, userId: string, session: Doc<'studySessions'>, entryPoint: 'today' | 'session_deep_link') {
  const current = await resolveTodayAssessment(ctx, userId, session)
  if (current.kind !== 'unprepared') return current
  const plan = await ctx.db.get(session.studyPlanRevisionId)
  if (!plan?.blueprintRevisionId) return current
  const families = await ctx.db.query('learnMeasurementFamilies').withIndex('by_userId_and_blueprintRevisionId_and_objectiveId', q => q.eq('userId', userId).eq('blueprintRevisionId', plan.blueprintRevisionId!).eq('objectiveId', session.primaryObjectiveId)).take(7)
  const available = families.filter(row => ['provisional_equivalent', 'empirically_supported'].includes(row.status) && row.evidenceStatus === 'available' && row.invalidatedAt === undefined)
  if (todayCanvasChecksEnabled() && await hasAdaptiveExperienceAccess(ctx, userId)) {
    const prepared = await prepareCanvasSessionForOwner(ctx, { studySessionId: session._id, expectedSessionRevision: session.revision,
      idempotencyKey: `today_canvas_${(await privacyDigest([session._id, entryPoint])).slice(7)}` }, entryPoint)
    if (prepared.kind === 'prepared') return await resolveTodayAssessment(ctx, userId, (await ctx.db.get(session._id))!)
  }
  await enrollLearnMeasurementForOwner(ctx, userId, { studySessionId: session._id, entryPoint,
    ...(families.length <= 6 && available.length === 1 ? { familyId: available[0]!._id } : {}) })
  const prepared = await resolveTodayAssessment(ctx, userId, session)
  return prepared.kind === 'unprepared' ? { kind: 'blocked' as const, reasonCode: 'assessment_not_prepared', opportunity: null, state: null } : prepared
}

export function todayAssessmentSummary(assessment: Exclude<TodayAssessment, { kind: 'ordinary' }>, reasonCode?: string) {
  if (assessment.kind === 'check' && assessment.flow === 'canvas') return { kind: assessment.kind,
    reasonCode: reasonCode ?? null, state: null,
    check: assessment.pointer }
  return { kind: assessment.kind, reasonCode: reasonCode ?? (assessment.kind === 'blocked' ? assessment.reasonCode : null),
    state: assessment.kind === 'check' || assessment.kind === 'blocked' ? assessment.state : null }
}

type PointerContinuation = {
  position: PointerPosition | null, mainDone: boolean, savedCursor: string | null, savedDone: boolean,
  pending: string[], startedAt: number, versions: string[] | null, versionAfter: string | null, versionsDone: boolean,
}
function pointerCursorReference(cursor: string | null): PointerContinuation {
  if (cursor === null) return { position: null, mainDone: false, savedCursor: null, savedDone: false, pending: [], startedAt: Date.now(), versions: null, versionAfter: null, versionsDone: false }
  if (!cursor.startsWith(POINTER_CURSOR_PREFIX) || cursor.length > 65_536) throw new Error('Invalid Today check continuation')
  let value: PointerContinuation
  try { value = JSON.parse(decodeURIComponent(cursor.slice(POINTER_CURSOR_PREFIX.length))) }
  catch (error) {
    if (!(error instanceof URIError) && !(error instanceof SyntaxError)) throw error
    throw new Error('Invalid Today check continuation', { cause: error })
  }
  if (!value || typeof value !== 'object' || typeof value.mainDone !== 'boolean' || typeof value.savedDone !== 'boolean' || typeof value.versionsDone !== 'boolean'
    || value.versionAfter !== null && (typeof value.versionAfter !== 'string' || value.versionAfter.length > 4096)
    || value.versions !== null && (!Array.isArray(value.versions) || value.versions.length > POINTER_VERSION_PAGE || new Set(value.versions).size !== value.versions.length
      || value.versions.some(version => typeof version !== 'string' || version.length > 4096))
    || value.savedCursor !== null && (typeof value.savedCursor !== 'string' || value.savedCursor.length > 8192)
    || !Array.isArray(value.pending) || value.pending.length > POINTER_SAVED_PAGE
    || value.pending.some(reference => typeof reference !== 'string' || !reference.length || reference.length > 256)
    || !Number.isFinite(value.startedAt) || value.startedAt > Date.now() || value.startedAt < Date.now() - 3_600_000
    || value.position !== null && (!value.position || !Number.isFinite(value.position.closeAt) || value.position.closeAt < 0
      || typeof value.position.delayedCheckId !== 'string' || !value.position.delayedCheckId.length || value.position.delayedCheckId.length > 256)) throw new Error('Invalid Today check continuation')
  return value
}

type PointerPosition = Pick<Doc<'learnAssessmentOpportunities'>, 'closeAt' | 'delayedCheckId'>
function pointerOrder(left: PointerPosition, right: PointerPosition) {
  return left.closeAt !== right.closeAt ? left.closeAt > right.closeAt ? -1 : 1
    : left.delayedCheckId === right.delayedCheckId ? 0 : left.delayedCheckId > right.delayedCheckId ? -1 : 1
}

async function readTodayCheckPointers(ctx: QueryCtx, userId: string, cursor: string | null = null) {
  const continuation = pointerCursorReference(cursor)
  let reference = continuation.position
  let versions = continuation.versions
  let versionAfter = continuation.versionAfter
  let versionsDone = continuation.versionsDone
  let batchDone = continuation.mainDone
  if (versions === null || batchDone && !versionsDone) {
    versions = versions === null ? [ADAPTIVE_ACTIVITY_PLAN_VERSION] : []
    reference = null
    batchDone = false
    while (!versionsDone && versions.length < POINTER_VERSION_PAGE) {
      const next = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_canvasPlan_purpose_phase_closeAt_delayedCheckId', q =>
        q.eq('userId', userId).gt('contextPins.canvas.planVersion', versionAfter ?? undefined)).first()
      const version = next?.contextPins.kind === 'session' ? next.contextPins.canvas?.planVersion : undefined
      if (version === undefined) { versionsDone = true; break }
      versionAfter = version
      if (version !== ADAPTIVE_ACTIVITY_PLAN_VERSION) versions.push(version)
    }
    if (!versionsDone) {
      const next = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_canvasPlan_purpose_phase_closeAt_delayedCheckId', q =>
        q.eq('userId', userId).gt('contextPins.canvas.planVersion', versionAfter ?? undefined)).first()
      versionsDone = !next
    }
  }
  const now = Date.now()
  const sources = batchDone ? [] : await Promise.all(versions.flatMap(version => POINTER_PURPOSES.flatMap(purpose => POINTER_PHASES.flatMap(phase => {
    const live = phase === 'ready' || phase === 'test_open'
    const segments = reference === null ? [false] : [false, true]
    return segments.map(async sameTime => {
      if (live && version !== ADAPTIVE_ACTIVITY_PLAN_VERSION || live && reference !== null && reference.closeAt <= now) return []
      return await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_canvasPlan_purpose_phase_closeAt_delayedCheckId', q => {
        const range = q.eq('userId', userId).eq('contextPins.canvas.planVersion', version).eq('purpose.kind', purpose).eq('phase', phase)
        if (sameTime && reference !== null) return range.eq('closeAt', reference.closeAt).lt('delayedCheckId', reference.delayedCheckId)
        if (reference !== null) return live ? range.gt('closeAt', now).lt('closeAt', reference.closeAt) : range.lt('closeAt', reference.closeAt)
        return live ? range.gt('closeAt', now) : range
      }).order('desc').take(POINTER_CANDIDATE_LIMIT + 1)
    })
  }))))
  const full = sources.filter(rows => rows.length === POINTER_CANDIDATE_LIMIT + 1)
  const boundary = full.map(rows => rows.at(-1)!).sort(pointerOrder)[0]
  // Do not advance past unseen rows in a full source.
  const candidates = sources.flat().filter(row => boundary === undefined || pointerOrder(row, boundary) <= 0).sort(pointerOrder)
  const checks: LearnTodayCheckPointer[] = []
  let visited = 0
  let last: PointerPosition | null = reference
  for (const row of candidates) {
    if (checks.length === LEARN_TODAY_CHECK_LIMIT || visited === POINTER_CANDIDATE_LIMIT
      || visited > 0 && remainingPrivacyReadBudget(ctx) < POINTER_READ_RESERVE + POINTER_DISCOVERY_RESERVE) break
    const pointer = await readCanvasCheckPointerForOwner(ctx, userId, row)
    if (pointer) checks.push(pointer)
    last = row
    visited++
  }
  const mainDone = batchDone || visited === candidates.length && full.length === 0
  const pending = [...continuation.pending]
  let savedCursor = continuation.savedCursor
  let savedDone = continuation.savedDone
  const since = continuation.startedAt - LEARN_TODAY_CLOSED_CHECK_DAYS * 86_400_000
  const appendSaved = async () => {
    while (pending.length && checks.length < LEARN_TODAY_CHECK_LIMIT && remainingPrivacyReadBudget(ctx) >= POINTER_READ_RESERVE) {
      const reference = pending.shift()!
      const row = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_delayedCheckId', q =>
        q.eq('userId', userId).eq('delayedCheckId', reference)).unique()
      const response = row?.submissionId ? await ctx.db.get(row.submissionId) : null
      if (!row || !response || response.userId !== userId || response.acceptedAt < since || checks.some(check => check.reference === reference)) continue
      const pointer = await readCanvasCheckPointerForOwner(ctx, userId, row)
      if (pointer) checks.push(pointer)
    }
  }
  await appendSaved()
  if (!pending.length && !savedDone && remainingPrivacyReadBudget(ctx) >= POINTER_DISCOVERY_RESERVE) {
    const page = await ctx.db.query('learnResponses').withIndex('by_userId_and_flow_and_assessmentPins_kind_and_acceptedAt', q =>
      q.eq('userId', userId).eq('flow', 'canvas').eq('assessmentPins.kind', 'measurement').gte('acceptedAt', since)).order('desc')
      .paginate({ cursor: savedCursor, numItems: POINTER_SAVED_PAGE })
    savedDone = page.isDone
    savedCursor = page.isDone ? null : page.continueCursor
    for (const response of page.page) {
      if (!('assessmentOpportunityId' in response)) continue
      const row = await ctx.db.get(response.assessmentOpportunityId)
      if (!row || row.userId !== userId || row.submissionId !== response._id || row.contextPins.kind !== 'session' || !row.contextPins.canvas
        || !['measurement_cold', 'measurement_delayed', 'retained_transfer'].includes(row.purpose.kind)) continue
      if (POINTER_PHASES.some(phase => phase === row.phase)) continue
      if (!pending.includes(row.delayedCheckId) && !checks.some(check => check.reference === row.delayedCheckId)) pending.push(row.delayedCheckId)
    }
    await appendSaved()
  }
  const more = !mainDone || !versionsDone || !savedDone || pending.length > 0
  const next: PointerContinuation = { position: last, mainDone, savedCursor, savedDone, pending, startedAt: continuation.startedAt, versions, versionAfter, versionsDone }
  return { status: 'available' as const, reasonCode: null, checks, isDone: !more,
    continueCursor: more ? `${POINTER_CURSOR_PREFIX}${encodeURIComponent(JSON.stringify(next))}` : null }
}

async function surfaceCanvasPointers(ctx: QueryCtx, userId: string) {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return false
  if (todayCanvasChecksEnabled()) return true
  for (const entryPoint of ['today', 'session_deep_link'] as const) {
    const assignment = await ctx.db.query('learnMeasurementAssignments').withIndex('by_userId_and_flow_and_entryPoint_and_status', q =>
      q.eq('userId', userId).eq('flow', 'v2_canvas').eq('entryPoint', entryPoint).eq('status', 'admitted')).first()
    if (assignment?.status === 'admitted') return true
  }
  return false
}

export const getCheckPointers = query({
  args: { cursor: v.optional(v.string()) }, returns: todayCheckPointersValidator,
  handler: async (ctx, args) => {
    const userId = await requireLearnV2QueryAccess(ctx)
    if (!await surfaceCanvasPointers(ctx, userId)) return { status: 'disabled' as const, reasonCode: 'disabled', checks: [], isDone: true, continueCursor: null }
    return await readTodayCheckPointers(measurementReadContext(ctx, userId), userId, args.cursor)
  },
})

// The projection intentionally verifies current pins again. A stale shell is not a
// to-do item: it remains invisible until the plan/generation path repairs it.
async function projectToday(ctx: QueryCtx, userId: string) {
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
      if (LEARN_MEASUREMENT_CAPABILITIES.responses && isTestOnlyMeasurementSession(session) && session.assessmentOpportunityId) {
        const check = await ctx.db.get(session.assessmentOpportunityId)
        const assignment = check?.assignmentId ? await ctx.db.get(check.assignmentId) : null
        if (check?.userId === userId && check.contextPins.kind === 'session' && check.contextPins.canvas
          && (todayCanvasChecksEnabled() || isFrozenTodayCanvasAssignment(assignment))) continue
      }
      if (LEARN_MEASUREMENT_CAPABILITIES.responses && session.assessmentPurpose === 'measurement_delayed' && session.assessmentOpportunityId) {
        const check = await ctx.db.get(session.assessmentOpportunityId)
        if (check?.userId === userId && (check.contextPins.kind === 'session' && check.contextPins.canvas
          || check.submissionId || now >= check.closeAt)) continue
      }
      const plan = await ctx.db.get(session.studyPlanRevisionId); const root = plan && await ctx.db.get(plan.studyPlanId)
      const blueprint = plan?.blueprintRevisionId && await ctx.db.get(plan.blueprintRevisionId); const objective = await ctx.db.get(session.primaryObjectiveId)
      const voidRow = plan && await ctx.db.get(plan.learningVoidId); const folder = voidRow && await ctx.db.get(voidRow.folderId)
      const currentPlan = plan && root && (root.activeRevisionId === plan._id && plan.status === 'accepted'
        || isDedicatedLearnCheck(session) && await hasLearnReflowPlanAuthority(ctx, userId, plan))
      if (!plan || !root || !blueprint || !objective || !voidRow || !folder || plan.userId !== userId || root.userId !== userId || blueprint.userId !== userId || objective.userId !== userId || voidRow.userId !== userId || folder.userId !== userId || !currentPlan || blueprint.status !== 'accepted' || plan.blueprintRecordRevision !== blueprint.recordRevision || objective.blueprintRevisionId !== blueprint._id) continue
      try { await requireActiveBlueprint(ctx, userId, voidRow, blueprint._id) }
      catch (error) {
        if (LEARN_MEASUREMENT_CAPABILITIES.responses && !(error instanceof LearnBlueprintAuthorityError)) throw error
        continue
      }
      const record = (await getScopedMasteryRecord(ctx, userId, blueprint._id, objective._id)).record
      candidates.push({ session, plan, blueprint, objective, record })
    }
    const nextScheduledAt = candidates.filter(row => row.session.status !== 'in_progress' && row.session.scheduledStartAt > now).map(row => row.session.scheduledStartAt).sort((a, b) => a - b)[0] ?? null
    const selectable = candidates.filter(row => {
      if (LEARN_MEASUREMENT_CAPABILITIES.responses && row.session.assessmentPurpose === 'measurement_delayed' && row.session.scheduledStartAt > now) return false
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
      canRetryGeneration: !(LEARN_MEASUREMENT_CAPABILITIES.responses && isTestOnlyMeasurementSession(candidate.session)),
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
    return { status: 'ready' as const, sessionId: candidate.session._id, sessionRevision: candidate.session.revision, scheduledStartAt: candidate.session.scheduledStartAt, scheduledEndAt: candidate.session.scheduledEndAt ?? null, timezone: candidate.session.timezone ?? candidate.plan.timezone ?? 'UTC', placementKind: candidate.session.placementKind ?? 'learning', objective: { id: candidate.objective._id, title: candidate.objective.title, capability: candidate.objective.capability ?? null, estimatedMinutes: candidate.objective.estimatedMinutes ?? null }, mastery: { state: candidate.record?.state ?? 'unseen', nextReviewAt: candidate.record?.nextReviewAt ?? null }, content: { id: content._id, revision: content.revision, assessmentRubricVersion: (() => { try { return JSON.parse(content.assessmentRubricSnapshot ?? '{}').version ?? null } catch (error) {
      if (LEARN_MEASUREMENT_CAPABILITIES.responses && !(error instanceof SyntaxError)) throw error
      return null
    } })() }, plan: { revisionId: candidate.plan._id, recordRevision: candidate.plan.recordRevision!, blueprintRevisionId: candidate.blueprint._id, blueprintRecordRevision: candidate.blueprint.recordRevision }, ...(assessment.kind === 'ordinary' ? {} : { assessment: todayAssessmentSummary(assessment) }), nextScheduledAt }
}

export const getToday = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireLearnV2QueryAccess(ctx)
    if (!await surfaceCanvasPointers(ctx, userId)) return await projectToday(ctx, userId)
    ctx = measurementReadContext(ctx, userId)
    const today = await projectToday(ctx, userId)
    const checks = remainingPrivacyReadBudget(ctx) >= POINTER_READ_RESERVE + POINTER_VERSION_PAGE * POINTER_PHASES.length * POINTER_PURPOSES.length + POINTER_DISCOVERY_RESERVE + 6 ? await readTodayCheckPointers(ctx, userId)
      : { status: 'unavailable' as const, reasonCode: 'pointer_page_budget', checks: [], isDone: false, continueCursor: null }
    return { ...today, checkPointers: checks }
  },
})
