import { readMeasurementClaims, readMeasurementSupports } from './learnV2MeasurementEvidenceReads'
import { LEARN_MEASUREMENT_ITEM_LIMITS as itemLimits } from '../../shared/learn-v2-measurement-item-limits'
import { measurementReadContext } from './learnV2MeasurementReadContext'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { hasLearnV2Access } from './learnV2Access'
import { hasAdaptiveExperienceAccess } from './adaptiveLearnAccess'
import { materializeLearnMeasurementAssignment } from './learnV2MeasurementDueWork'
import { enqueueLearnOpportunityEdges, learnDueWorkEnabled, learnOpeningWorkFaultedInWindow, retireLearnOpportunityDueWork } from './learnV2DueWorkQueue'
import { finalizeLearnDelayedCheckSession } from './learnV2DelayedDelivery'
import { hasAccountDeletionTombstone } from './accountDeletionTombstone'
import { privacyDigest, sourceBodyAvailable } from './learnV2ResponsePrivacy'
import { hasLearnCarriedSessionAuthority, hasLearnReflowPlanAuthority } from './learnV2FixedChecks'
import { documentMatchesSnapshot } from './learnV2BackingSource'
import { getScopedMasteryRecord, masteryScopeKey } from './learnV2MasteryScope'
import { appendLearnMeasurementFact, nextLearnMeasurementSourceSequence, readEarliestLearnFirstSlot, readLearnFirstSlotInventory, writeLearnMeasurementEnrollmentFact } from './learnV2MeasurementFacts'
import {
  allocateLearnMeasurementItems, getFrozenLearnMeasurementProtocol, learnMeasurementProtocolSchema,
  measurementWindowPolicyDigest, LEARN_MEASUREMENT_ELIGIBILITY_VERSION, type LearnMeasurementProtocol,
} from './learnV2MeasurementAssignment'
import {
  evaluateLearnMeasurementAdmission, learnMeasurementItemPinsSchema, learnCheckSurfaceBindingSchema,
  type LearnMeasurementItemPins, type LearnCheckSurfaceBinding,
} from '../../shared/learn-v2-measurement'
import { LEARN_MEASUREMENT_CAPABILITIES, LEARN_MEASUREMENT_STORAGE_VERSION, LEARN_MEASUREMENT_STORAGE_LIMITS as storageLimits } from '../../shared/learn-v2-measurement-storage-manifest'
import { LEARN_V2_ASSISTANCE_POLICY_VERSION, LEARN_V2_VALIDITY_POLICY_VERSION, learnTimezoneSchema, parseLearnContract } from '../../shared/learn-v2-responses'
import { learnFirstCheckClaimSchema, LEARN_SYSTEM_DUE_WORK_LATE } from '../../shared/learn-v2-delayed-check'
import { LEARN_V2_FIRST_INDEPENDENT_CLAIM_VERSION, learnReportIndependentClaimV2Schema, resolveLearnReportFirstSlotV2, type LearnReportIndependentClaimV2 } from '../../shared/learn-v2-measurement-report'
import { localDateAt } from '../../shared/learn-v2-mastery'
import { adaptiveV2PilotDecision, validateAdaptiveProviderPayload } from '../../shared/adaptive-v2-pilot-policy'
import { todayCanvasChecksEnabled } from '../../shared/learn-v2-today-check'

type ReadCtx = QueryCtx | MutationCtx
export type MeasurementFlow = 'v2_today' | 'v2_canvas'
export type EnrollmentRequest = {
  studySessionId: Id<'studySessions'>, familyId?: Id<'learnMeasurementFamilies'>,
  entryPoint: 'today' | 'session_deep_link' | 'canvas', canvasActivityId?: Id<'learningThreadActivities'>,
  checkSurface?: LearnCheckSurfaceBinding, exclusionReason?: string,
}
export type AdmittedAssignment = Extract<Doc<'learnMeasurementAssignments'>, { status: 'admitted' }>
export type MeasurementScope = Pick<Doc<'learnAssessmentOpportunities'>,
  'learningVoidId' | 'blueprintRevisionId' | 'objectiveId' | 'blueprintRecordRevision' | 'assessmentContractVersion' | 'assessmentContractDigest' | 'depth' | 'contextPins'>
  & Partial<Pick<Doc<'learnAssessmentOpportunities'>, 'purpose' | 'submissionId'>>

export async function requireMeasurementSession(ctx: ReadCtx, userId: string, request: EnrollmentRequest) {
  if (!await hasLearnV2Access(ctx, userId)) throw new Error('Learn V2 access denied')
  const session = await ctx.db.get(request.studySessionId)
  const revision = session && await ctx.db.get(session.studyPlanRevisionId)
  const plan = revision && await ctx.db.get(revision.studyPlanId)
  const learningVoid = plan && await ctx.db.get(plan.learningVoidId)
  const objective = session && await ctx.db.get(session.primaryObjectiveId)
  const blueprint = objective && await ctx.db.get(objective.blueprintRevisionId)
  const folder = learningVoid && await ctx.db.get(learningVoid.folderId)
  if (!session || !revision || !plan || !learningVoid || !objective || !blueprint || !folder
    || [session, revision, plan, learningVoid, objective, blueprint, folder].some(row => row.userId !== userId)
    || revision.learningVoidId !== learningVoid._id || blueprint.learningVoidId !== learningVoid._id) throw new Error('Learn measurement scope unavailable')
  return { session, revision, plan, learningVoid, objective, blueprint }
}

export async function measurementScopeReason(ctx: ReadCtx, userId: string, scope: MeasurementScope) {
  const [learningVoid, blueprint, objective] = await Promise.all([
    ctx.db.get(scope.learningVoidId), ctx.db.get(scope.blueprintRevisionId), ctx.db.get(scope.objectiveId),
  ])
  const folder = learningVoid && await ctx.db.get(learningVoid.folderId)
  if (!learningVoid || !blueprint || !objective || !folder
    || [learningVoid, blueprint, objective, folder].some(row => row.userId !== userId)
    || learningVoid.status === 'archived' || blueprint.learningVoidId !== learningVoid._id
    || objective.blueprintRevisionId !== blueprint._id) return 'pins_mismatch'
  if (learningVoid.activeBlueprintRevisionId !== blueprint._id || !['accepted', 'active'].includes(blueprint.status)
    || blueprint.acceptedAt === undefined || blueprint.recordRevision !== scope.blueprintRecordRevision
    || objective.depth !== scope.depth || !objective.assessmentContract || typeof objective.assessmentContract === 'string'
    || objective.assessmentContract.version !== scope.assessmentContractVersion
    || await privacyDigest(objective.assessmentContract) !== scope.assessmentContractDigest) return 'pins_mismatch'
  const pins = scope.contextPins
  if (pins.kind === 'calibration') return 'pins_mismatch'
  const [plan, revision] = await Promise.all([ctx.db.get(pins.studyPlanId), ctx.db.get(pins.studyPlanRevisionId)])
  const carriedSession = pins.kind === 'session' && (scope.purpose?.kind === 'independent_application' || scope.purpose?.kind === 'retained_transfer')
    ? await ctx.db.get(pins.studySessionId) : null
  const frozenPlan = revision && ((scope.purpose?.kind === 'measurement_cold' || scope.purpose?.kind === 'measurement_delayed')
    && await hasLearnReflowPlanAuthority(ctx, userId, revision, pins.planRecordRevision)
    || carriedSession && await hasLearnCarriedSessionAuthority(ctx, userId, carriedSession, revision, pins.planRecordRevision))
  if (!plan || !revision || plan.userId !== userId || revision.userId !== userId
    || plan.learningVoidId !== learningVoid._id || revision.learningVoidId !== learningVoid._id
    || revision.studyPlanId !== plan._id || !frozenPlan && (plan.activeRevisionId !== revision._id
      || !['accepted', 'active'].includes(revision.status) || revision.recordRevision !== pins.planRecordRevision) || revision.acceptedAt === undefined
    || revision.blueprintRevisionId !== blueprint._id || revision.blueprintRecordRevision !== blueprint.recordRevision
    || revision.revision !== pins.planRevision) return 'pins_mismatch'
  return null
}

async function withMeasurementCanvasScope(ctx: ReadCtx, userId: string, scope: MeasurementScope, session: Doc<'studySessions'>, activityId?: Id<'learningThreadActivities'>) {
  if (!activityId || scope.contextPins.kind === 'calibration') return scope
  const activity = await ctx.db.get(activityId)
  const thread = activity && await ctx.db.get(activity.threadId)
  const content = activity?.sessionContentId ? await ctx.db.get(activity.sessionContentId) : null
  if (!activity || !thread || !content || activity.userId !== userId || thread.userId !== userId || content.userId !== userId
    || content.studySessionId !== session._id) throw new Error('Learn measurement Canvas scope unavailable')
  return { ...scope, contextPins: { ...scope.contextPins, kind: 'session' as const, studySessionId: session._id,
    sessionRevision: session.revision, sessionContentId: content._id, contentRevision: content.revision,
    contentInputDigest: content.inputDigest ?? '', generatorVersion: content.generatorVersion ?? '',
    canvas: { threadId: thread._id, threadRevision: thread.revision, activityId: activity._id, activityRevision: activity.planRevision,
      planVersion: activity.planVersion, replayVersion: activity.replayVersion, rendererVersion: activity.rendererVersion,
      evaluationVersion: activity.evaluationContract.version, pilotConfigurationVersion: process.env.LEARN_ADAPTIVE_V2_PILOT_MANIFEST ?? '' } } }
}

export async function measurementFlowReason(ctx: ReadCtx, userId: string, flow: MeasurementFlow, scope: MeasurementScope, protocol: LearnMeasurementProtocol) {
  if (!protocol.flows.includes(flow) || !await hasLearnV2Access(ctx, userId)) return 'not_admitted'
  if (flow === 'v2_today') return null
  return await measurementCanvasReason(ctx, userId, scope)
}

export async function measurementCanvasReason(ctx: ReadCtx, userId: string, scope: MeasurementScope) {
  if (!await hasAdaptiveExperienceAccess(ctx, userId) || scope.contextPins.kind !== 'session' || !scope.contextPins.canvas) return 'canvas_not_admitted'
  const pins = scope.contextPins.canvas
  const [thread, activity, content] = await Promise.all([ctx.db.get(pins.threadId), ctx.db.get(pins.activityId), ctx.db.get(scope.contextPins.sessionContentId)])
  if (!thread || !activity || !content || thread.userId !== userId || activity.userId !== userId || content.userId !== userId
    || thread.authorityKind !== 'v2_mission' || thread.learningVoidId !== scope.learningVoidId || thread.deletionStartedAt !== undefined
    || thread.currentActivityId !== activity._id || activity.threadId !== thread._id || thread.revision !== pins.threadRevision
    || activity.activityClass !== 'factual' || activity.learningVoidId !== scope.learningVoidId
    || activity.objectiveId !== scope.objectiveId || activity.blueprintRevisionId !== scope.blueprintRevisionId
    || activity.sessionContentId !== content._id || activity.planRevision !== pins.activityRevision
    || activity.planVersion !== pins.planVersion || activity.replayVersion !== pins.replayVersion
    || activity.rendererVersion !== pins.rendererVersion || activity.evaluationContract.version !== pins.evaluationVersion
    || ['ended', 'replaced', 'blocked'].includes(activity.status)) return 'canvas_not_admitted'
  const pilot = adaptiveV2PilotDecision(pins.pilotConfigurationVersion, {
    model: content.providerModel ?? '', now: Date.now(), activityContractVersion: activity.contractVersion,
    evaluationContractVersion: activity.evaluationContract.version,
    learnerHash: await privacyDigest(['adaptive-v2-pilot-cohort.v1', userId]),
  })
  return pilot.allowed ? null : 'canvas_not_admitted'
}

export async function measurementItemReason(ctx: ReadCtx, userId: string, pins: LearnMeasurementItemPins, scope: MeasurementScope,
  scoringBinding: Doc<'learnAssessmentOpportunities'>['scoringBinding']) {
  ctx = measurementReadContext(ctx, userId)
  const [item, family, spec, caseRow, validation] = await Promise.all([
    ctx.db.get(pins.itemId), ctx.db.get(pins.familyId), ctx.db.get(pins.scoringSpecId), ctx.db.get(pins.caseId), ctx.db.get(pins.publicationValidationId),
  ])
  if (!item || !family || !spec || !caseRow || !validation || [item, family, spec, caseRow, validation].some(row => row.userId !== userId)) return 'novel_item_unavailable'
  if (family.status === 'quarantined' || family.status === 'retired') return 'family_quarantined'
  if (item.status !== 'published' || caseRow.usageClass !== 'measurement_reserved' || !caseRow.identityValidationId
    || validation.decision !== 'pass' || validation.check !== 'publication' || !validation.coverageWatermark
    || validation.subject.kind !== 'item' || validation.subject.itemId !== item._id || validation.subjectRevision !== item.revision) return 'novel_item_unavailable'
  if (item.evidenceStatus !== 'available' || family.evidenceStatus !== 'available' || spec.evidenceStatus !== 'available'
    || validation.evidenceStatus !== 'available' || item.invalidatedAt !== undefined || family.invalidatedAt !== undefined
    || spec.invalidatedAt !== undefined || validation.invalidatedAt !== undefined || !spec.payload || !spec.referenceSolution || !item.prompt) return 'evidence_unavailable'
  if (item.learningVoidId !== scope.learningVoidId || item.blueprintRevisionId !== scope.blueprintRevisionId || item.objectiveId !== scope.objectiveId
    || family.learningVoidId !== scope.learningVoidId || family.blueprintRevisionId !== scope.blueprintRevisionId || family.objectiveId !== scope.objectiveId
    || item.assessmentContractDigest !== scope.assessmentContractDigest || family.assessmentContractDigest !== scope.assessmentContractDigest
    || item.depth !== scope.depth || family.depth !== scope.depth || item.revision !== pins.itemRevision || item.caseId !== pins.caseId
    || item.familyId !== pins.familyId || item.familyRevision !== pins.familyRevision || family.revision !== pins.familyRevision
    || item.formLabel !== pins.formLabel || item.promptDigest !== pins.promptDigest || item.scoringSpecId !== spec._id
    || spec.itemId !== item._id || spec.revision !== pins.scoringSpecRevision || item.scoringSpecRevision !== spec.revision
    || spec.digest !== pins.scoringSpecDigest || item.scoringSpecDigest !== spec.digest || item.supportManifestDigest !== pins.supportManifestDigest
    || item.publicationValidationId !== pins.publicationValidationId || family.equivalenceVersion !== pins.equivalenceVersion
    || await privacyDigest(spec.scoringBinding) !== await privacyDigest(scoringBinding) || item.responseSpec.kind !== spec.payload.kind) return 'pins_mismatch'
  const claimLimit = scope.submissionId ? storageLimits.maxClaims : itemLimits.claims
  const supportLimit = scope.submissionId ? storageLimits.maxSupportsPerClaim : itemLimits.supportsPerClaim
  const claims = await readMeasurementClaims(ctx, userId, item._id, claimLimit)
  if (!claims.length || claims.length > claimLimit) return 'unmeasurable_no_t0'
  let evidenceRows = 0
  const sources = new Set<string>()
  for (const claim of claims) {
    if (claim.evidenceStatus !== 'available' || claim.invalidatedAt !== undefined || claim.scoringSpecId !== spec._id) return 'evidence_unavailable'
    const supports = await readMeasurementSupports(ctx, userId, claim._id, supportLimit)
    evidenceRows += supports.length
    if (!scope.submissionId && evidenceRows > itemLimits.evidenceRows) return 'item_evidence_limit'
    if (!supports.length || supports.length > supportLimit) return 'unmeasurable_no_t0'
    for (const support of supports) {
      const [source, excerpt] = await Promise.all([ctx.db.get(support.sourceSnapshotId), ctx.db.get(support.sourceExcerptId)])
      if (!source || !excerpt || source.userId !== userId || excerpt.userId !== userId || source.learningVoidId !== scope.learningVoidId
        || source.status !== 'user_accepted' || source.effectiveStatus !== 'user_accepted' || source.conflictStatus !== 'clear'
        || source.evidencePurgedAt !== undefined || excerpt.evidencePurgedAt !== undefined || support.evidenceStatus !== 'available'
        || support.invalidatedAt !== undefined || support.itemId !== item._id || support.scoringSpecId !== spec._id
        || source.revision !== support.sourceSnapshotRevision || (source.recordRevision ?? 1) !== support.sourceRecordRevision
        || source.contentHash !== support.sourceContentHash || source.sourceRevision !== support.sourceRevision
        || excerpt.sourceSnapshotId !== source._id || support.entailment !== 'entailed' || !support.verifierVersion || !support.verifierModel
        || !await sourceBodyAvailable(ctx, userId, source._id)) return 'evidence_unavailable'
      const identity = await ctx.db.get(source.sourceIdentityId)
      if (!identity || identity.userId !== userId || identity.learningVoidId !== scope.learningVoidId || identity.tombstonedAt !== undefined) return 'evidence_unavailable'
      if (identity.folderDocumentId) {
        const document = await ctx.db.get(identity.folderDocumentId)
        if (!document || document.userId !== userId || document.status !== 'success' || !documentMatchesSnapshot(document, source)) return 'evidence_unavailable'
      }
      if (!(source.rightsStatus === 'permitted' && excerpt.rightsStatus === 'permitted' && excerpt.excerpt?.trim())
        && !(identity.origin === 'folder_document' && identity.folderDocumentId && source.contentHash && source.sourceRevision)) return 'unmeasurable_no_t0'
      sources.add(source._id)
      if (sources.size > 64) return 'evidence_unavailable'
    }
  }
  if (scope.contextPins.kind === 'session' && scope.contextPins.canvas) {
    const sourceRows = await Promise.all([...sources].map(id => ctx.db.get(id as Id<'learnSourceSnapshots'>)))
    if (sourceRows.some(source => source?.rightsStatus !== 'permitted')) return 'provider_blocked'
    if (!validateAdaptiveProviderPayload({ learnerResponse: 'pending', challenge: item.prompt, evidence: claims.map(claim => claim.claim ?? ''),
      rubric: spec.payload.kind === 'bounded_rubric' ? spec.payload.criteria.map(criterion => criterion.description) : [] }).allowed) return 'provider_blocked'
  }
  if (scoringBinding.kind === 'model' && (!process.env.OPENROUTER_API_KEY?.trim() || !process.env.CF_ACCOUNT_ID?.trim()
    || !process.env.CLOUDFLARE_AI_GATEWAY_ID?.trim())) return 'provider_blocked'
  return null
}

export async function measurementCaseExposed(ctx: ReadCtx, userId: string, caseId: Id<'learnAssessmentCases'>, opportunityId?: Id<'learnAssessmentOpportunities'>) {
  const exposures = await ctx.db.query('learnAssessmentExposures').withIndex('by_userId_and_caseId_and_serverTime', q => q.eq('userId', userId).eq('caseId', caseId)).take(65)
  return exposures.length > 64 || exposures.some(row => row.status !== 'requested_denied'
    && (opportunityId === undefined || row.assessmentOpportunityId !== opportunityId))
}

const PRIOR_TEACHING_SESSION_LIMIT = 128
const PRIOR_TEACHING_PLAN_LIMIT = 32

async function priorObjectiveTeaching(ctx: ReadCtx, userId: string, session: Doc<'studySessions'>) {
  let remaining = PRIOR_TEACHING_SESSION_LIMIT
  const seen = new Set<string>()
  let plan = await ctx.db.get(session.studyPlanRevisionId)
  while (plan) {
    if (plan.userId !== userId || seen.has(plan._id) || seen.size === PRIOR_TEACHING_PLAN_LIMIT) return 'unknown' as const
    seen.add(plan._id)
    const planId = plan._id
    const rows = await ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', q =>
      q.eq('userId', userId).eq('studyPlanRevisionId', planId)).take(remaining + 1)
    if (rows.length > remaining) return 'unknown' as const
    remaining -= rows.length
    if (rows.some(row => row._id !== session._id && row.primaryObjectiveId === session.primaryObjectiveId
      && row.assessmentOpportunityId === undefined && row.assessmentPurpose === undefined
      && (row.startedSessionContentId !== undefined || ['in_progress', 'completed'].includes(row.status)))) return 'returning' as const
    if (plan.changeReason !== 'future_incomplete_reflow' || !plan.parentRevisionId) return null
    plan = await ctx.db.get(plan.parentRevisionId)
  }
  return null
}

async function enrollmentHistory(ctx: ReadCtx, userId: string, scope: MeasurementScope, session: Doc<'studySessions'>) {
  const catalog = await ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', userId)).unique()
  if (!catalog || catalog.historyCompleteness !== 'prospective_complete' || !catalog.historyBasisVersion || !catalog.historyCoverageWatermark || !catalog.instrumentationEpoch) return { status: 'unknown' as const, catalog }
  if (session._creationTime < catalog.createdAt) return { status: 'unknown' as const, catalog }
  const exposures = await ctx.db.query('learnAssessmentExposures').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', scope.learningVoidId)).take(65)
  if (exposures.length > 64 || exposures.some(row => row.status === 'unknown' || row.status === 'possible')) return { status: 'unknown' as const, catalog }
  if (exposures.some(row => row.status !== 'requested_denied' && row.blueprintRevisionId !== scope.blueprintRevisionId)) return { status: 'unknown' as const, catalog }
  if (session.startedSessionContentId || ['in_progress', 'completed', 'missed'].includes(session.status)
    || exposures.some(row => row.status !== 'requested_denied' && row.objectiveId === scope.objectiveId)) return { status: 'returning' as const, catalog }
  return { status: 'prospectively_unexposed' as const, catalog }
}

const canonicalJson = (value: unknown) => JSON.stringify(value ?? null, (_key, nested: unknown) => nested && typeof nested === 'object' && !Array.isArray(nested)
  ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b))) : nested)
function sameOpportunityFact(previous: Record<string, unknown>, next: Record<string, unknown>) {
  const keys = ['assessmentOpportunityId', 'status', 'dueAt', 'closeAt', 'clock', 'originalSlot', 'reasonCode', 'stateAtEligibility']
  return keys.every(key => canonicalJson(previous[key]) === canonicalJson(next[key]))
}

export async function writeMeasurementOpportunityFact(ctx: MutationCtx, assignment: Pick<AdmittedAssignment, 'userId' | 'epoch' | 'learningVoidId'>, row: Doc<'learnAssessmentOpportunities'>) {
  const faulted = await retireLearnOpportunityDueWork(ctx, row)
  if (faulted && row.purpose.kind === 'measurement_delayed' && ['abandoned', 'cancelled', 'invalid'].includes(row.phase) && Date.now() >= row.closeAt
    && !row.submissionId && !row.deliveryGrantId && !row.authoritativeAttemptId && !(row.eligibleAt !== undefined && row.eligibleAt < row.closeAt)
    && (row.phase !== 'abandoned' || row.reasonCode !== LEARN_SYSTEM_DUE_WORK_LATE)) {
    row = { ...row, phase: 'abandoned', operationalEligibility: 'blocked', reasonCode: LEARN_SYSTEM_DUE_WORK_LATE, revision: row.revision + 1 }
    await ctx.db.patch(row._id, { phase: row.phase, operationalEligibility: row.operationalEligibility, reasonCode: row.reasonCode, revision: row.revision })
    await finalizeLearnDelayedCheckSession(ctx, assignment.userId, row)
  }
  const previous = await ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_assessmentOpportunityId', q => q.eq('userId', assignment.userId).eq('fact.assessmentOpportunityId', row._id)).order('desc').first()
  if (previous?.fact.kind === 'opportunity' && previous.fact.recordRevision === row.revision) {
    return previous.sequence
  }
  let stateAtEligibility = LEARN_MEASUREMENT_CAPABILITIES.responses && previous?.fact.kind === 'opportunity' ? previous.fact.stateAtEligibility : undefined
  if (LEARN_MEASUREMENT_CAPABILITIES.responses && stateAtEligibility === undefined && row.originalSlot && 'clock' in row.purpose
    && row.operationalEligibility === 'eligible' && ['ready', 'test_open'].includes(row.phase)) {
    const history = await ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_assessmentOpportunityId', q =>
      q.eq('userId', assignment.userId).eq('fact.assessmentOpportunityId', row._id)).order('asc').take(8)
    const first = history.find(fact => fact.fact.kind === 'opportunity' && fact.fact.status === 'eligible')
    stateAtEligibility = first?.fact.kind === 'opportunity' ? first.fact.stateAtEligibility ?? 'unknown'
      : history.length === 8 ? 'unknown' : (await getScopedMasteryRecord(ctx, assignment.userId, row.blueprintRevisionId, row.objectiveId)).record?.state ?? 'unseen'
  }
  const fact = { kind: 'opportunity' as const, assessmentOpportunityId: row._id, recordRevision: row.revision,
    status: ['cancelled', 'abandoned', 'invalid'].includes(row.phase) ? row.phase as 'cancelled' | 'abandoned' | 'invalid' : row.operationalEligibility,
    dueAt: row.dueAt ?? null, closeAt: row.closeAt, clock: 'clock' in row.purpose ? row.purpose.clock : null, originalSlot: row.originalSlot,
    ...(LEARN_MEASUREMENT_CAPABILITIES.responses && row.reasonCode ? { reasonCode: row.reasonCode } : {}),
    ...(stateAtEligibility !== undefined ? { stateAtEligibility } : {}) }
  if (previous?.fact.kind === 'opportunity' && learnDueWorkEnabled() && sameOpportunityFact(previous.fact, fact)) {
    return previous.sequence
  }
  const sequence = await appendLearnMeasurementFact(ctx, assignment.userId, { epoch: assignment.epoch, occurredAt: Date.now(), learningVoidId: assignment.learningVoidId, fact })
  return sequence
}

export async function retireLearnMeasurementDueWork(ctx: MutationCtx, reference: Doc<'learnMeasurementDueWork'>) {
  if (!learnDueWorkEnabled()) return
  const work = await ctx.db.get(reference._id)
  if (!work) return
  if (work.userId !== reference.userId) throw new Error('Learn due-work retirement scope conflicts')
  if (work.kind === 'open' && work.assessmentOpportunityId && !await hasAccountDeletionTombstone(ctx, work.userId)) {
    const row = await ctx.db.get(work.assessmentOpportunityId)
    if (row && row.userId === work.userId && row.purpose.kind === 'measurement_delayed' && Date.now() >= row.closeAt
      && !row.submissionId && !row.deliveryGrantId && !row.authoritativeAttemptId && !(row.eligibleAt !== undefined && row.eligibleAt < row.closeAt)
      && learnOpeningWorkFaultedInWindow(work, row.closeAt)) {
      const closed = { ...row, phase: 'abandoned' as const, operationalEligibility: 'blocked' as const, reasonCode: LEARN_SYSTEM_DUE_WORK_LATE, revision: row.revision + 1 }
      await ctx.db.patch(row._id, { phase: closed.phase, operationalEligibility: closed.operationalEligibility, reasonCode: closed.reasonCode, revision: closed.revision })
      await finalizeLearnDelayedCheckSession(ctx, work.userId, closed)
      const assignment = row.assignmentId ? await ctx.db.get(row.assignmentId) : null
      if (assignment?.userId === work.userId && assignment.status === 'admitted') await writeMeasurementOpportunityFact(ctx, assignment, closed)
    }
  }
  if (await ctx.db.get(work._id)) await ctx.db.delete(work._id)
}

export async function enrollLearnMeasurementForOwner(ctx: MutationCtx, userId: string, request: EnrollmentRequest,
  historySession?: Doc<'studySessions'>) {
  ctx = measurementReadContext(ctx, userId)
  const authority = await requireMeasurementSession(ctx, userId, request)
  const historyBasis = historySession ?? authority.session
  if (historyBasis.userId !== userId || historyBasis.studyPlanRevisionId !== authority.session.studyPlanRevisionId
    || historyBasis.primaryObjectiveId !== authority.session.primaryObjectiveId) throw new Error('Learn measurement history scope conflicts')
  const supplied = getFrozenLearnMeasurementProtocol()
  if (!supplied) return { status: 'protocol_not_frozen' as const, assignmentId: null, reasonCodes: ['protocol_not_frozen'] }
  const protocol = parseLearnContract(learnMeasurementProtocolSchema, supplied)
  if (!LEARN_MEASUREMENT_CAPABILITIES.enrollment) return { status: 'disabled' as const, assignmentId: null, reasonCodes: ['disabled'] }
  const { session, revision, plan, learningVoid, objective, blueprint } = authority
  const assignmentKey = await privacyDigest(['learn-v2.measurement-episode.v1', await masteryScopeKey(userId, blueprint._id, objective._id), protocol.epoch])
  const existing = await ctx.db.query('learnMeasurementAssignments').withIndex('by_userId_and_assignmentKey', q => q.eq('userId', userId).eq('assignmentKey', assignmentKey)).unique()
  if (existing) {
    if (existing.checkSurface && request.entryPoint === 'canvas' && existing.flow !== 'v2_canvas')
      return { status: 'not_admitted' as const, assignmentId: existing._id, reasonCodes: ['flow_mismatch'] }
    if (existing.status === 'admitted' && (existing.flow === 'v2_canvas' || request.entryPoint === 'canvas' || request.canvasActivityId)) {
      const cold = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_assignmentId_and_horizonDays', q => q.eq('userId', userId).eq('assignmentId', existing._id).eq('horizonDays', undefined)).unique()
      if (!cold || await measurementFlowReason(ctx, userId, 'v2_canvas', cold, protocol)) return { status: 'not_admitted' as const, assignmentId: existing._id, reasonCodes: ['canvas_not_admitted'] }
    }
    return { status: existing.status, assignmentId: existing._id, reasonCodes: existing.exclusionReasons }
  }
  if (todayCanvasChecksEnabled() && request.entryPoint !== 'canvas' && !request.checkSurface)
    return { status: 'not_admitted' as const, assignmentId: null, reasonCodes: ['canvas_preparation_required'] }
  if (!objective.depth || !objective.assessmentContract || typeof objective.assessmentContract === 'string') return { status: 'not_admitted' as const, assignmentId: null, reasonCodes: ['pins_mismatch'] }
  const checkSurface = request.checkSurface && parseLearnContract(learnCheckSurfaceBindingSchema, request.checkSurface)
  const contextPins: MeasurementScope['contextPins'] = { kind: 'planned_measurement', studyPlanId: plan._id, studyPlanRevisionId: revision._id,
    planRevision: revision.revision, planRecordRevision: revision.recordRevision ?? 1, ...(checkSurface ? { checkSurface } : {}) }
  let scope: MeasurementScope = { learningVoidId: learningVoid._id, blueprintRevisionId: blueprint._id, objectiveId: objective._id,
    blueprintRecordRevision: blueprint.recordRevision, assessmentContractVersion: objective.assessmentContract.version,
    assessmentContractDigest: await privacyDigest(objective.assessmentContract), depth: objective.depth, contextPins }
  const canvasActivityId = request.canvasActivityId
  scope = await withMeasurementCanvasScope(ctx, userId, scope, session, canvasActivityId)
  const flow = request.entryPoint === 'canvas' || canvasActivityId && !checkSurface ? 'v2_canvas' as const : 'v2_today' as const
  let history = await enrollmentHistory(ctx, userId, scope, historyBasis)
  if (checkSurface && history.status === 'prospectively_unexposed') {
    const prior = await priorObjectiveTeaching(ctx, userId, historyBasis)
    if (prior) history = { ...history, status: prior }
  }
  const family = request.familyId ? await ctx.db.get(request.familyId) : null
  if (family && (family.userId !== userId || family.learningVoidId !== learningVoid._id || family.objectiveId !== objective._id || family.blueprintRevisionId !== blueprint._id)) throw new Error('Learn measurement family unavailable')
  const items = family ? await ctx.db.query('learnMeasurementItems').withIndex('by_userId_and_familyId_and_familyRevision_and_formLabel', q => q.eq('userId', userId).eq('familyId', family._id).eq('familyRevision', family.revision)).take(7) : []
  const core = items.filter(item => !item.reserve)
  const pins: LearnMeasurementItemPins[] = []
  const reasons = new Set<string>(request.exclusionReason ? [request.exclusionReason] : [])
  const scopeReason = await measurementScopeReason(ctx, userId, scope)
  const flowReason = checkSurface?.surface === 'canvas' && !await hasAdaptiveExperienceAccess(ctx, userId) ? 'canvas_not_admitted'
    : await measurementFlowReason(ctx, userId, flow, scope, protocol)
  if (checkSurface && checkSurface.measurementFlow !== flow) reasons.add('pins_mismatch')
  if (scopeReason) reasons.add(scopeReason)
  if (flowReason) reasons.add(flowReason)
  if (Date.now() < protocol.enrollmentStartAt || Date.now() >= protocol.enrollmentEndAt) reasons.add('outside_enrollment_window')
  if (!['planned', 'ready'].includes(session.status)) reasons.add('session_unavailable')
  if (!family || items.length > 6 || core.length !== family.coreFormCount || items.length !== family.totalFormCount) reasons.add('novel_item_unavailable')
  for (const item of core) {
    const caseRow = await ctx.db.get(item.caseId)
    const parsed = learnMeasurementItemPinsSchema.safeParse({ itemId: item._id, itemRevision: item.revision, promptDigest: item.promptDigest,
      caseId: item.caseId, familyId: item.familyId, familyRevision: item.familyRevision, formLabel: item.formLabel,
      equivalenceVersion: family?.equivalenceVersion, noveltyPolicyVersion: caseRow?.identityPolicyVersion,
      scoringSpecId: item.scoringSpecId, scoringSpecRevision: item.scoringSpecRevision, scoringSpecDigest: item.scoringSpecDigest,
      supportManifestDigest: item.supportManifestDigest, publicationValidationId: item.publicationValidationId })
    if (!parsed.success) { reasons.add('pins_mismatch'); continue }
    const reason = await measurementItemReason(ctx, userId, parsed.data, scope, protocol.scoringBinding)
    if (reason) reasons.add(reason)
    if (await measurementCaseExposed(ctx, userId, parsed.data.caseId)) reasons.add('novel_item_unavailable')
    pins.push(parsed.data)
  }
  if (family?.coreFormCount === 3 && protocol.windows.length !== 2 || family?.coreFormCount === 2 && protocol.windows.length !== 1) reasons.add('protocol_horizon_mismatch')
  if (new Set(core.map(item => item.responseSpec.kind)).size > 1) reasons.add('pins_mismatch')
  const admission = evaluateLearnMeasurementAdmission({ protocolFrozen: true, flowAdmitted: !flowReason,
    acceptedT0: !!family && !reasons.has('unmeasurable_no_t0'), evidenceAvailable: !reasons.has('evidence_unavailable'),
    historyStatus: history.status, historyBasisVersion: history.catalog?.historyBasisVersion ?? null,
    historyCoverageWatermark: history.catalog?.historyCoverageWatermark ?? null, inventoryNovel: reasons.has('novel_item_unavailable') ? 'no' : 'yes',
    familyStatus: family?.status ?? 'quarantined', pinsMatch: !reasons.has('pins_mismatch') })
  for (const reason of admission.reasonCodes) reasons.add(reason)
  const { contextPins: _context, ...capability } = scope
  const base = { userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION, createdAt: Date.now() }
  const common = { ...base, ...capability, evidenceStatus: 'available' as const, assignmentKey, epoch: protocol.epoch,
    baselineSha: protocol.baselineSha, flow, entryPoint: request.entryPoint, cohortVersion: protocol.cohortVersion,
    historyStatus: history.status, historyBasisVersion: history.catalog?.historyBasisVersion ?? 'unknown',
    instrumentationEpoch: history.catalog?.instrumentationEpoch ?? 'unknown', exclusionReasons: [...reasons],
    ...(family ? { familyId: family._id, familyRevision: family.revision } : {}), ...(checkSurface ? { checkSurface } : {}) }
  const timezone = learnTimezoneSchema.safeParse(revision.timezone)
  if (!timezone.success) reasons.add('timezone_unavailable')
  if (reasons.size || !family || !timezone.success) {
    const assignmentId = await ctx.db.insert('learnMeasurementAssignments', { ...common, exclusionReasons: [...reasons], status: 'not_admitted', protocolStatus: 'blocked', reasonCode: [...reasons][0] ?? 'not_admitted' })
    await writeLearnMeasurementEnrollmentFact(ctx, userId, (await ctx.db.get(assignmentId))!)
    return { status: 'not_admitted' as const, assignmentId, reasonCodes: [...reasons] }
  }
  const randomized = allocateLearnMeasurementItems(pins, protocol.windows.length === 1 ? protocol.windows[0]!.horizonDays : undefined)
  const assignmentId = await ctx.db.insert('learnMeasurementAssignments', { ...common, familyId: family._id, familyRevision: family.revision,
    ...randomized, status: 'admitted', protocolStatus: 'frozen', responseKind: core[0]!.responseSpec.kind,
    protocolVersion: protocol.version, schedulingPolicyVersion: protocol.schedulingPolicyVersion, enrollmentAt: Date.now(), enrollmentTimezone: timezone.data,
    anchorKind: protocol.anchorKind, anchorEventId: protocol.anchorKind === 'enrollment' ? assignmentKey : null,
    anchorAt: protocol.anchorKind === 'enrollment' ? Date.now() : null, windowPolicyDigest: await measurementWindowPolicyDigest(protocol), scoringBinding: protocol.scoringBinding })
  const assignment = (await ctx.db.get(assignmentId))! as AdmittedAssignment
  await writeLearnMeasurementEnrollmentFact(ctx, userId, assignment)
  const id = await ctx.db.insert('learnAssessmentOpportunities', { ...base, ...scope, scopeKind: 'v2', evidenceStatus: 'available',
    delayedCheckId: await privacyDigest([assignmentId, 'cold']), purpose: { kind: 'measurement_cold', assignmentId, protocolVersion: protocol.version },
    assessmentPins: { kind: 'measurement', itemPins: randomized.allocation.cold }, scoringBinding: protocol.scoringBinding, assignmentId,
    phase: 'ready', revision: 1, eligibilityPolicyVersion: LEARN_MEASUREMENT_ELIGIBILITY_VERSION, operationalEligibility: 'eligible',
    dueAt: Date.now(), openAt: Date.now(), closeAt: Date.now() + protocol.coldWindowMs, checkSequence: 0, originalSlot: true })
  await writeMeasurementOpportunityFact(ctx, assignment, (await ctx.db.get(id))!)
  await enqueueLearnOpportunityEdges(ctx, (await ctx.db.get(id))!)
  return { status: 'admitted' as const, assignmentId, reasonCodes: [] }
}

async function instructionAdmission(ctx: ReadCtx, userId: string, assignment: AdmittedAssignment, session: Doc<'studySessions'>,
  flow: MeasurementFlow, canvasActivityId?: Id<'learningThreadActivities'>) {
  const blocked = (reasonCode: string) => ({ kind: 'blocked' as const, reasonCode })
  const protocol = getFrozenLearnMeasurementProtocol()
  const cold = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_assignmentId_and_horizonDays', q => q.eq('userId', userId).eq('assignmentId', assignment._id).eq('horizonDays', undefined)).unique()
  if (!protocol || protocol.version !== assignment.protocolVersion || await measurementWindowPolicyDigest(protocol) !== assignment.windowPolicyDigest) return blocked('protocol_not_frozen')
  if (!cold) return blocked('assessment_unavailable')
  const assigned = await measurementFlowReason(ctx, userId, assignment.flow, cold, protocol)
  if (assigned) return blocked(assigned)
  const delivered = await measurementFlowReason(ctx, userId, flow, await withMeasurementCanvasScope(ctx, userId, cold, session, canvasActivityId), protocol)
  return delivered ? blocked(delivered) : { kind: 'admitted' as const, cold }
}

export async function learnMeasurementInstructionBlock(ctx: ReadCtx, userId: string, assignment: AdmittedAssignment, session: Doc<'studySessions'>) {
  if (!LEARN_MEASUREMENT_CAPABILITIES.enrollment) return 'disabled'
  if (assignment.checkSurface && assignment.flow !== 'v2_today') return 'flow_mismatch'
  if (session.userId !== userId || session.primaryObjectiveId !== assignment.objectiveId) return 'pins_mismatch'
  const admission = await instructionAdmission(ctx, userId, assignment, session, 'v2_today')
  return admission.kind === 'blocked' ? admission.reasonCode : null
}

export async function recordLearnMeasurementInstructionForOwner(ctx: MutationCtx, userId: string, input: {
  assignmentId: Id<'learnMeasurementAssignments'>, studySessionId: Id<'studySessions'>, flow: MeasurementFlow,
  projectionDigest: string, deliveryReceiptHash: string, canvasActivityId?: Id<'learningThreadActivities'>,
}) {
  const assignment = await ctx.db.get(input.assignmentId)
  if (!assignment || assignment.userId !== userId || assignment.status !== 'admitted') throw new Error('Learn measurement assignment unavailable')
  if (assignment.checkSurface && assignment.flow !== input.flow) throw new Error('Learn measurement teaching flow mismatch')
  if (!LEARN_MEASUREMENT_CAPABILITIES.enrollment) throw new Error('Learn measurement is disabled')
  const authority = await requireMeasurementSession(ctx, userId, { studySessionId: input.studySessionId, entryPoint: input.flow === 'v2_today' ? 'today' : 'canvas' })
  if (authority.objective._id !== assignment.objectiveId || authority.blueprint._id !== assignment.blueprintRevisionId) throw new Error('Learn measurement instruction scope conflicts')
  const admission = await instructionAdmission(ctx, userId, assignment, authority.session, input.flow, input.canvasActivityId)
  if (admission.kind === 'blocked') throw new Error('Learn measurement flow is not admitted')
  const { cold } = admission
  const previous = await ctx.db.query('learnAssessmentExposures').withIndex('by_userId_and_deliveryReceiptHash', q => q.eq('userId', userId).eq('deliveryReceiptHash', input.deliveryReceiptHash)).unique()
  if (previous) {
    if (previous.assignmentId !== assignment._id || previous.projectionDigest !== input.projectionDigest
      || previous.provenanceVersion !== `learn-v2.instructional-flow.${input.flow}.v1`) throw new Error('Learn instruction delivery receipt conflicts')
    return previous._id
  }
  const mixed = input.flow !== assignment.flow
  if (mixed && !assignment.exclusionReasons.includes('mixed_flow')) await ctx.db.patch(assignment._id, { exclusionReasons: [...assignment.exclusionReasons, 'mixed_flow'] })
  if (mixed || !cold.submissionId) {
    await ctx.db.patch(cold._id, { reasonCode: mixed ? 'mixed_flow' : 'cold_after_teaching', operationalEligibility: 'blocked', revision: cold.revision + 1 })
    await writeMeasurementOpportunityFact(ctx, assignment, (await ctx.db.get(cold._id))!)
  }
  return await ctx.db.insert('learnAssessmentExposures', { userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION, createdAt: Date.now(),
    learningVoidId: assignment.learningVoidId, blueprintRevisionId: assignment.blueprintRevisionId, objectiveId: assignment.objectiveId,
    studySessionId: input.studySessionId, assignmentId: assignment._id, purpose: 'teaching', status: 'granted',
    projectionDigest: input.projectionDigest, deliveryReceiptHash: input.deliveryReceiptHash, serverTime: Date.now(),
    policyVersion: LEARN_MEASUREMENT_ELIGIBILITY_VERSION, provenanceVersion: `learn-v2.instructional-flow.${input.flow}.v1` })
}

export async function freezeFirstIndependentClaimForOwner(ctx: MutationCtx, userId: string, input: {
  assignmentId?: Id<'learnMeasurementAssignments'>, basisAttemptId: Id<'masteryAttempts'>,
}) {
  let assignment = input.assignmentId ? await ctx.db.get(input.assignmentId) : null
  const basis = await ctx.db.get(input.basisAttemptId)
  if (!basis || basis.userId !== userId || !basis.blueprintRevisionId
    || input.assignmentId && (!assignment || assignment.userId !== userId || assignment.status !== 'admitted'
      || basis.blueprintRevisionId !== assignment.blueprintRevisionId || basis.objectiveId !== assignment.objectiveId)) throw new Error('Learn claim scope unavailable')
  const protocol = getFrozenLearnMeasurementProtocol()
  if (!LEARN_MEASUREMENT_CAPABILITIES.enrollment) return { kind: 'disabled' as const }
  if (!protocol || assignment?.status === 'admitted' && (protocol.version !== assignment.protocolVersion
    || await measurementWindowPolicyDigest(protocol) !== assignment.windowPolicyDigest)) return { kind: 'protocol_not_frozen' as const }
  const blueprintRevisionId = basis.blueprintRevisionId
  const objectiveId = basis.objectiveId
  const blueprint = await ctx.db.get(blueprintRevisionId)
  if (!blueprint || blueprint.userId !== userId) throw new Error('Learn claim scope unavailable')
  if (!assignment) {
    const assignmentKey = await privacyDigest(['learn-v2.measurement-episode.v1', await masteryScopeKey(userId, blueprintRevisionId, objectiveId), protocol.epoch])
    const candidate = await ctx.db.query('learnMeasurementAssignments').withIndex('by_userId_and_assignmentKey', q => q.eq('userId', userId).eq('assignmentKey', assignmentKey)).unique()
    if (candidate?.status === 'admitted') assignment = candidate
  }
  if (assignment?.status === 'admitted') await materializeLearnMeasurementAssignment(ctx, assignment, protocol, Date.now())
  const claimKey = await privacyDigest(['learn-v2.first-independent.v1', await masteryScopeKey(userId, blueprintRevisionId, objectiveId), protocol.epoch])
  const prior = await ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_claimKey_and_fact_claimSequence', q => q.eq('userId', userId).eq('fact.claimKey', claimKey).eq('fact.claimSequence', 1)).take(3)
  const saved = prior.find(row => row.fact.kind === 'independent_claim_v2')
  if (saved?.fact.kind === 'independent_claim_v2') return await linkFirstIndependentClaimForOwner(ctx, userId, blueprintRevisionId, objectiveId, protocol.epoch)
  if (prior.length) throw new Error('Learn legacy first-Independent claims must be reconciled before new claims')
  const acceptedAt = basis.acceptedAt ?? basis.measurementStorage?.acceptedAt
  if (basis.kind !== 'independent_application' || basis.masteryStateAfter !== 'independent' || basis.masteryStateBefore === undefined
    || ['independent', 'retained'].includes(basis.masteryStateBefore) || basis.masteryTransitionVersion !== 'learn-v2.mastery-transition.v1'
    || !basis.masteryRecordRevision || acceptedAt === undefined || acceptedAt > Date.now()
    || acceptedAt < (assignment?.status === 'admitted' ? assignment.enrollmentAt : protocol.enrollmentStartAt)
    || basis.serverScorePercent === undefined || basis.serverScorePercent < 80 || basis.serverScorePercent > 100
    || !Number.isFinite(basis.serverScorePercent) || basis.assistanceSnapshot?.state !== 'unassisted'
    || basis.assistanceSnapshot.policyVersion !== LEARN_V2_ASSISTANCE_POLICY_VERSION
    || basis.validitySnapshot?.status !== 'valid' || basis.validitySnapshot.policyVersion !== LEARN_V2_VALIDITY_POLICY_VERSION
    || !basis.validitySnapshot.masteryEligible || !basis.attemptTimezone
    || basis.attemptLocalDate !== localDateAt(acceptedAt, basis.attemptTimezone)) throw new Error('Learn first Independent basis is invalid')
  const { sequence } = await nextLearnMeasurementSourceSequence(ctx, userId)
  const objective = await ctx.db.get(objectiveId)
  const basisResponse = basis.submissionId ? await ctx.db.get(basis.submissionId) : null
  const claim = parseLearnContract(learnReportIndependentClaimV2Schema, {
    kind: 'independent_claim_v2', version: LEARN_V2_FIRST_INDEPENDENT_CLAIM_VERSION,
    claimKey, claimSequence: 1, basisAttemptId: basis._id, masteryRecordRevision: basis.masteryRecordRevision,
    firstIndependentAt: acceptedAt, firstIndependentLocalDate: basis.attemptLocalDate,
    firstIndependentTimezone: basis.attemptTimezone, transitionVersion: basis.masteryTransitionVersion, claimFactSequence: sequence,
    blueprintRevisionId, objectiveId,
    stratum: { epoch: protocol.epoch, baselineSha: protocol.baselineSha, cohortVersion: protocol.cohortVersion,
      flow: assignment?.flow ?? (basisResponse && 'flow' in basisResponse && basisResponse.flow === 'canvas' ? 'v2_canvas' : 'v2_today'),
      ...(assignment?.checkSurface ? { checkSurface: assignment.checkSurface.surface } : {}), entryPoint: assignment?.entryPoint ?? 'retained_check', depth: objective?.depth },
    policyPins: { assistancePolicyVersion: basis.assistanceSnapshot.policyVersion, validityPolicyVersion: basis.validitySnapshot.policyVersion,
      thresholdVersion: basis.scoringBinding?.thresholdVersion ?? 'learn-v2.mastery-threshold.v1', thresholdPercent: 80 },
    firstSlot: { kind: 'unresolved', reason: 'no_qualifying_delayed_slot' },
  })
  const first = await readEarliestLearnFirstSlot(ctx, userId, claim)
  const fact = first ? { ...claim, firstSlot: first } : claim
  await appendLearnMeasurementFact(ctx, userId, { epoch: protocol.epoch, learningVoidId: blueprint.learningVoidId,
    occurredAt: Date.now(), expectedSequence: sequence, fact })
  if (first) await fixFirstSlotProjection(ctx, userId, fact, first.firstCheckOpportunityId)
  return fact
}

async function fixFirstSlotProjection(ctx: MutationCtx, userId: string, claim: LearnReportIndependentClaimV2, id: Id<'learnAssessmentOpportunities'>) {
  const row = await ctx.db.get(id)
  if (!row || row.userId !== userId) throw new Error('Learn first slot unavailable')
  const basis = parseLearnContract(learnFirstCheckClaimSchema, {
    claimKey: claim.claimKey, claimSequence: claim.claimSequence, basisAttemptId: claim.basisAttemptId,
    masteryRecordRevision: claim.masteryRecordRevision, firstIndependentAt: claim.firstIndependentAt,
    firstIndependentLocalDate: claim.firstIndependentLocalDate, firstIndependentTimezone: claim.firstIndependentTimezone,
    transitionVersion: claim.transitionVersion, claimFactSequence: claim.claimFactSequence,
  })
  await ctx.db.patch(id, { firstCheckClaim: basis, checkSequence: 1, revision: row.revision + 1 })
  await writeMeasurementOpportunityFact(ctx, { userId, epoch: claim.stratum.epoch, learningVoidId: row.learningVoidId }, (await ctx.db.get(id))!)
}

export async function linkFirstIndependentClaimForOwner(ctx: MutationCtx, userId: string,
  blueprintRevisionId: Id<'learnBlueprintRevisions'>, objectiveId: Id<'learnObjectives'>, epoch: string) {
  const rows = await ctx.db.query('learnMeasurementReportFacts')
    .withIndex('by_userId_and_fact_objectiveId_and_fact_stratum_epoch', q => q.eq('userId', userId).eq('fact.objectiveId', objectiveId).eq('fact.stratum.epoch', epoch)).take(3)
  const saved = rows.find(row => row.fact.kind === 'independent_claim_v2' && row.fact.blueprintRevisionId === blueprintRevisionId)
  if (!saved || saved.fact.kind !== 'independent_claim_v2') return null
  const savedClaim = saved.fact
  const links = await ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_claimKey_and_fact_claimSequence', q =>
    q.eq('userId', userId).eq('fact.claimKey', savedClaim.claimKey).eq('fact.claimSequence', 1)).take(3)
  const link = links.find(row => row.fact.kind === 'first_slot_link')
  const envelope = (row: Doc<'learnMeasurementReportFacts'>) => ({ factVersion: row.factVersion, sequence: row.sequence, epoch: row.epoch, occurredAt: row.occurredAt, fact: row.fact })
  const claim = resolveLearnReportFirstSlotV2(envelope(saved), link ? envelope(link) : null)
  const first = await readEarliestLearnFirstSlot(ctx, userId, claim)
  if (claim.firstSlot.kind === 'linked') {
    if (first?.firstCheckOpportunityId !== claim.firstSlot.firstCheckOpportunityId) throw new Error('Learn original schedule conflicts with its fixed first slot')
    return claim
  }
  if (!first) return claim
  await appendLearnMeasurementFact(ctx, userId, { epoch, learningVoidId: saved.learningVoidId, occurredAt: Date.now(),
    fact: { kind: 'first_slot_link', version: LEARN_V2_FIRST_INDEPENDENT_CLAIM_VERSION,
      claimKey: claim.claimKey, claimSequence: 1, claimFactSequence: saved.sequence, slot: first } })
  const resolved = { ...claim, firstSlot: first }
  await fixFirstSlotProjection(ctx, userId, resolved, first.firstCheckOpportunityId)
  return resolved
}

export async function registerLearnFirstSlotForOwner(ctx: MutationCtx, row: Doc<'learnAssessmentOpportunities'>, epoch: string, linkNow = true) {
  if (!row.originalSlot || row.replacesOpportunityId !== undefined || !('clock' in row.purpose)) throw new Error('Learn original slot required')
  if (row.firstSlotEpoch !== epoch) await ctx.db.patch(row._id, { firstSlotEpoch: epoch })
  await readLearnFirstSlotInventory(ctx, row.userId, row.blueprintRevisionId, row.objectiveId, epoch)
  if (linkNow) await linkFirstIndependentClaimForOwner(ctx, row.userId, row.blueprintRevisionId, row.objectiveId, epoch)
}
