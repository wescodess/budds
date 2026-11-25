import { MeasurementItemBoundsError } from '../shared/learn-v2-measurement-item-limits'
import { LearnAccessError, LearnScoringInputError } from '../shared/learn-v2-errors'
import { ZodError } from 'zod'
import { MeasurementValidationError, getValidatedMeasurementFamily } from './lib/learnV2MeasurementItems'
import { measurementReadContext } from './lib/learnV2MeasurementReadContext'
import { defineTeachingRead } from './lib/learnV2TeachingReads'
import { teachingReadScope } from './lib/learnV2TeachingReadScope'
import { createResponsePrivacyReadContext, privacyRead, responsePrivacyReadContext } from './lib/learnV2PrivacyReadContext'
import { v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { hasAdaptiveExperienceAccess, requireAdaptiveMutationAccess, requireAdaptiveQueryAccess } from './lib/adaptiveLearnAccess'
import { requireActiveBlueprint } from './lib/learnV2BlueprintAuthority'
import { findCurrentAdaptiveActivityForSessionContent, hasLearnActivityEvent, writeLearnActivityEvent } from './lib/learnAdaptiveEvents'
import { loadAdaptiveClaimProjection } from './lib/adaptiveClaimProjection'
import { isLearnV2ContentEvidenceReady } from './lib/learnV2ContentEvidenceReady'
import { boundedAdaptiveCommandReference, prepareAdaptiveCommand } from '../shared/adaptive-command-authority'
import { ADAPTIVE_ASSESSMENT_PLAN_VERSION, composeAdaptiveActivityPlan, readAdaptiveAssessmentReference, replayAdaptiveActivityPlan, type AdaptiveEvidenceState } from '../shared/learn-adaptive-activity-plan'
import { localDateAt } from '../shared/learn-v2-mastery'
import { adaptiveRecoveryCopy } from '../shared/learn-adaptive-recovery'
import { executeAdaptiveThreadCommand } from './learnAdaptiveCommands'
import { liveEvidenceState, storedPlan } from './learnAdaptiveRecovery'
import { projectAdaptiveControls, reasonTextForActivity } from '../shared/learn-adaptive-controls'
import { ADAPTIVE_ACTIVITY_VALIDATION_ANALYTICS_VERSION, validateAdaptiveActivityPrimitive } from '../shared/learn-adaptive-activity-registry'
import { decodeSourceComparisonResponse, encodeSourceComparisonResponse } from '../shared/learn-adaptive-source-comparison-response'
import { activityResponseAvailable, privacyDigest, retainedSourceExcerpt } from './lib/learnV2ResponsePrivacy'
import { LEARN_MEASUREMENT_CAPABILITIES } from '../shared/learn-v2-measurement-storage-manifest'
import { hasLearnReflowPlanAuthority, isDedicatedLearnCheck } from './lib/learnV2FixedChecks'
import { ADAPTIVE_V2_PILOT_MANIFEST, adaptiveV2PilotDecision } from '../shared/adaptive-v2-pilot-policy'
import type { LearnV2AssessmentDelivery } from './lib/learnV2PublicContract'
import { canvasCheckReadArgs } from './lib/learnV2PublicContract'
import { grantLearnAssessmentDeliveryForOwner, readLearnAssessmentForOwner, readLearnAssessmentStateForOwner } from './lib/learnV2AssessmentDelivery'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION, LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION, type LearnResponsePayload } from '../shared/learn-v2-responses'
import { getLearnResponseStateForOwner } from './lib/learnV2Responses'
import { acceptMasterySubmissionForOwner } from './learnV2Mastery'
import { enrollLearnMeasurementForOwner, measurementFlowReason, measurementItemReason, measurementScopeReason, requireMeasurementSession } from './lib/learnV2Measurement'
import { LEARN_CHECK_SURFACE_VERSION, learnMeasurementItemPinsSchema, learnAssessmentBoundSurface } from '../shared/learn-v2-measurement'
import { bindLearnDelayedCheck } from './lib/learnV2DelayedDelivery'
import { getFrozenLearnMeasurementProtocol, learnMeasurementProtocolSchema } from './lib/learnV2MeasurementAssignment'
import { getLearnMeasurementScorer } from './lib/learnV2MeasurementScorerInventory'
import { readSavedLearnScoringState } from './lib/learnV2MeasurementScoring'
import { readMeasurementClaims } from './lib/learnV2MeasurementEvidenceReads'
import { hasAccountDeletionTombstone } from './lib/accountDeletionTombstone'
import { LEARN_CANVAS_CHECK_RECEIPT_VERSION, LEARN_TODAY_CHECK_POINTER_LEGACY_VERSION, type LEARN_TODAY_CHECK_POINTER_VERSION, isFrozenTodayCanvasAssignment, learnCanvasCheckReceiptSchema, learnTodayCheckPointerSchema, learnTodayCheckRoute, todayCanvasChecksEnabled, type LearnCanvasCheckReceipt, type LearnCanvasCheckTiming, type LearnTodayCheckPointer } from '../shared/learn-v2-today-check'
import { canvasCheckTiming, todayCheckLabel } from './lib/learnV2TodayCheckLabel'
import { LEARN_V2_POST_SEAL_TEACHING_VERSION } from '../shared/learn-v2-assessment-disclosure'

const RECEIPT_TTL_MS = 30 * 24 * 60 * 60_000

type CanvasAttachmentRequest = { studySessionId: Id<'studySessions'>, expectedSessionRevision: number, idempotencyKey: string }
const canvasUnavailable = (reasonCode: string) => ({ kind: 'not_admitted' as const, reasonCode, observations: 'no_observations' as const })

export async function prepareCanvasSessionForOwner(ctx: MutationCtx, args: CanvasAttachmentRequest, entryPoint: 'today' | 'session_deep_link' | 'canvas' = 'canvas') {
  const userId = await requireAdaptiveMutationAccess(ctx)
  ctx = measurementReadContext(ctx, userId)
  const prepared = await prepareAdaptiveCommand({ userId, commandName: 'prepareCanvasSession', targetId: String(args.studySessionId),
    expectedRevision: args.expectedSessionRevision, idempotencyKey: args.idempotencyKey, payload: { studySessionId: String(args.studySessionId), ...(entryPoint === 'canvas' ? {} : { entryPoint }) } })
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses || !LEARN_MEASUREMENT_CAPABILITIES.delivery || !LEARN_MEASUREMENT_CAPABILITIES.enrollment) return canvasUnavailable('disabled')
  const prior = await ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId_and_idempotencyKeyHash', q => q.eq('userId', userId).eq('idempotencyKeyHash', prepared.idempotencyKeyHash)).unique()
  if (prior && (prior.commandName !== 'prepareCanvasSession' || prior.requestFingerprint !== prepared.requestFingerprint)) throw new Error('Idempotency key was already used for a different request')
  const complete = async (threadId: Id<'learningThreads'>, assessmentOpportunityId: Id<'learnAssessmentOpportunities'>, sessionContentId: Id<'sessionContent'>) => {
    if (!prior) await ctx.db.insert('learnActivityCommandReceipts', { userId, threadId, idempotencyKeyHash: prepared.idempotencyKeyHash,
      requestFingerprint: prepared.requestFingerprint, commandName: 'prepareCanvasSession', targetRevision: args.expectedSessionRevision,
      resultKind: 'ok', resultReference: boundedAdaptiveCommandReference({ assessmentOpportunityId, sessionContentId }), errorReference: null,
      createdAt: Date.now(), resultExpiresAt: Date.now() + RECEIPT_TTL_MS, redactionStatus: 'pending' })
    return { kind: 'prepared' as const, assessmentOpportunityId, sessionContentId }
  }
  const frozen = getFrozenLearnMeasurementProtocol()
  if (!frozen) return canvasUnavailable('protocol_not_frozen')
  const protocol = learnMeasurementProtocolSchema.parse(frozen)
  const { session, revision, learningVoid, objective, blueprint } = await requireMeasurementSession(ctx, userId, { studySessionId: args.studySessionId, entryPoint: 'canvas' })
  if (session.assessmentOpportunityId) {
    const opportunity = await ctx.db.get(session.assessmentOpportunityId)
    const assignment = opportunity?.assignmentId ? await ctx.db.get(opportunity.assignmentId) : null
    if (!opportunity || opportunity.contextPins.kind !== 'session' || !opportunity.contextPins.canvas || await measurementScopeReason(ctx, userId, opportunity)
      || assignment?.checkSurface && learnAssessmentBoundSurface(assignment.status === 'admitted' ? assignment : null, opportunity.contextPins) !== 'canvas'
      || await measurementFlowReason(ctx, userId, assignment?.flow ?? 'v2_canvas', opportunity, protocol)) return canvasUnavailable('flow_mismatch')
    const state = await readLearnAssessmentStateForOwner(ctx, userId, opportunity._id, 'canvas')
    if (state.status !== 'available') return canvasUnavailable(state.status === 'disabled' ? 'disabled' : state.reasonCodes[0] ?? 'assessment_unavailable')
    return await complete(opportunity.contextPins.canvas.threadId, opportunity._id, opportunity.contextPins.sessionContentId)
  }
  if (session.status !== 'ready' || session.revision !== args.expectedSessionRevision) return canvasUnavailable('session_unavailable')
  const now = Date.now()
  const timezone = session.timezone ?? revision.timezone ?? 'UTC'
  if (session.scheduledStartAt > now && localDateAt(session.scheduledStartAt, timezone) !== localDateAt(now, timezone)
    || session.scheduledEndAt !== undefined && session.scheduledEndAt < now) return canvasUnavailable('outside_window')
  const content = await ctx.db.query('sessionContent').withIndex('by_userId_and_studySessionId_and_revision', q => q.eq('userId', userId).eq('studySessionId', session._id)).order('desc').first()
  if (!content || content.status !== 'published' || content.studyPlanRevisionId !== revision._id || content.blueprintRevisionId !== blueprint._id
    || content.objectiveId !== objective._id || !content.inputDigest || !content.generatorVersion
    || !await isLearnV2ContentEvidenceReady(ctx, userId, content, learningVoid._id)) return canvasUnavailable('evidence_unavailable')
  const families = await ctx.db.query('learnMeasurementFamilies').withIndex('by_userId_and_blueprintRevisionId_and_objectiveId', q =>
    q.eq('userId', userId).eq('blueprintRevisionId', blueprint._id).eq('objectiveId', objective._id)).take(7)
  const available = families.filter(row => ['provisional_equivalent', 'empirically_supported'].includes(row.status) && row.evidenceStatus === 'available' && row.invalidatedAt === undefined)
  if (families.length > 6 || available.length !== 1) return canvasUnavailable('novel_item_unavailable')
  const manifest = await getValidatedMeasurementFamily(ctx, userId, available[0]!._id).catch(error => {
    if (!(error instanceof MeasurementValidationError) && !(error instanceof MeasurementItemBoundsError) && !(error instanceof ZodError)) throw error
    return null
  })
  if (!manifest) return canvasUnavailable('assessment_unavailable')
  for (const member of manifest.members) {
    const item = await ctx.db.get(member.pins.itemId)
    if (!item || item.responseSpec.kind !== 'bounded_rubric' || !assessmentPrimitive(item.prompt).ok) return canvasUnavailable('response_format_unavailable')
  }
  if (!await canvasPilotDecision(userId, protocol.scoringBinding, 'learn-adaptive.activity-contract.v1', 'learn-adaptive.evaluation.v1', process.env.LEARN_ADAPTIVE_V2_PILOT_MANIFEST)
    || !adaptiveV2PilotDecision(process.env.LEARN_ADAPTIVE_V2_PILOT_MANIFEST, { model: content.providerModel ?? '', now,
      activityContractVersion: 'learn-adaptive.activity-contract.v1', evaluationContractVersion: 'learn-adaptive.evaluation.v1',
      learnerHash: await privacyDigest(['adaptive-v2-pilot-cohort.v1', userId]) }).allowed) return canvasUnavailable(entryPoint === 'canvas' ? 'canvas_not_admitted' : 'pilot_not_admitted')
  if (protocol.scoringBinding.kind !== 'model') return canvasUnavailable('scorer_unavailable')
  const scorer = await getLearnMeasurementScorer(protocol.scoringBinding)
  if (!scorer.saved || await privacyDigest((await scorer.registry.verifySaved(scorer.saved)).binding) !== await privacyDigest(protocol.scoringBinding)) return canvasUnavailable('scorer_unavailable')
  if (entryPoint !== 'canvas') {
    const enrolled = await enrollLearnMeasurementForOwner(ctx, userId, { studySessionId: session._id, familyId: manifest.familyId, entryPoint,
      checkSurface: { version: LEARN_CHECK_SURFACE_VERSION, surface: 'canvas', measurementFlow: 'v2_today' } })
    if (enrolled.status !== 'admitted' || !enrolled.assignmentId) return canvasUnavailable(enrolled.reasonCodes[0] ?? 'not_admitted')
    const assignment = (await ctx.db.get(enrolled.assignmentId))!
    const opportunity = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_assignmentId_and_horizonDays', q =>
      q.eq('userId', userId).eq('assignmentId', enrolled.assignmentId!).eq('horizonDays', undefined)).unique()
    if (assignment.status !== 'admitted' || !opportunity) throw new Error('Learn Canvas preparation conflicts')
    const binding = await bindLearnDelayedCheck(ctx, assignment, opportunity, undefined, { providerModel: content.providerModel,
      pilotConfigurationVersion: process.env.LEARN_ADAPTIVE_V2_PILOT_MANIFEST ?? '' })
    if (binding.kind !== 'ready') throw new LearnScoringInputError(`Learn Canvas preparation unavailable: ${binding.reasonCode}`)
    const bound = (await ctx.db.get(opportunity._id))!
    if (bound.contextPins.kind !== 'session' || !bound.contextPins.canvas) throw new Error('Learn Canvas preparation conflicts')
    const owner = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique()
    if (!owner) throw new Error('Learn Canvas owner unavailable')
    if (!owner.learnTodayCheckSurfaceVersion) await ctx.db.patch(owner._id, { learnTodayCheckSurfaceVersion: LEARN_CHECK_SURFACE_VERSION })
    return await complete(bound.contextPins.canvas.threadId, bound._id, bound.contextPins.sessionContentId)
  }
  const sessionContentId = await ctx.db.insert('sessionContent', { userId, studySessionId: session._id, studyPlanRevisionId: revision._id,
    blueprintRevisionId: blueprint._id, objectiveId: objective._id, revision: content.revision + 1, status: 'published',
    inputDigest: await privacyDigest(['learn-v2.canvas-preparation.v1', content._id, content.inputDigest]), generatorVersion: 'learn-v2.canvas-preparation.v1',
    providerModel: content.providerModel, assessmentPurpose: 'measurement_cold', createdAt: now, publishedAt: now })
  const evidenceReferences: Doc<'learningThreadActivities'>['evidenceReferences'] = []
  const teachingClaims = await ctx.db.query('sessionContentClaims').withIndex('by_userId_and_sessionContentId_and_order', q =>
    q.eq('userId', userId).eq('sessionContentId', content._id)).take(17)
  if (!teachingClaims.length || teachingClaims.length > 16) throw new Error('Learn Canvas evidence unavailable')
  for (const claim of teachingClaims) {
    const support = await ctx.db.query('learnClaimSupports').withIndex('by_userId_and_sessionContentClaimId', q => q.eq('userId', userId).eq('sessionContentClaimId', claim._id)).first()
    const sourceId = support?.sourceSnapshotId
    const source = sourceId ? await ctx.db.get(sourceId) : null
    if (!support || !source || !support.verifierVersion) throw new Error('Learn Canvas evidence unavailable')
    evidenceReferences.push({ claimId: claim._id, supportId: support._id, sourceSnapshotId: source._id,
      sourceSnapshotRevision: source.revision, sourceRecordRevision: source.recordRevision ?? 1, sourceEffectiveStatus: 'user_accepted',
      verifierVersion: support.verifierVersion, integrityState: 'accepted' })
  }
  const threadId = await ctx.db.insert('learningThreads', { userId, originalNeed: 'Complete the assigned check.', outcome: 'Assigned check',
    outcomeProvenance: 'explicit', intent: 'master', availableTime: '15', authorityKind: 'v2_mission', learningVoidId: learningVoid._id,
    sourceScope: { kind: 'none' }, evidenceState: 'ready', lifecycle: 'active', revision: 1, createdAt: now, updatedAt: now })
  const provisional = await composeAdaptiveActivityPlan({ activityId: `preparation:${session._id}`, threadId, boundaryOrdinal: 1, planRevision: 1,
    activityClass: 'factual', intent: 'master', objectiveId: objective._id, purpose: 'Complete the assigned check.', reasonCode: 'assessment_check',
    primitiveSequence: [{ type: 'independent_application', action: 'submit_response', props: { prompt: 'Complete the assigned check.', responseFormat: 'short_text', draftPersistence: false } }],
    requiredAction: { kind: 'submit_response', label: 'Submit response' }, evaluationContract: { version: 'learn-adaptive.evaluation.v1', kind: 'server_scored', responseFormat: 'short_text', passingScorePercent: 80 },
    accessibilityMetadata: { heading: 'Assigned check', instructions: 'Submit your response.', focusTargetTestId: 'learn-primitive-independent-application', liveRegionMode: 'polite' },
    pins: { learningVoidId: learningVoid._id, blueprintRevisionId: blueprint._id, objectiveId: objective._id, sessionContentId }, evidenceReferences,
    generationInputs: { sessionContentRevision: content.revision + 1, sessionContentInputDigest: (await ctx.db.get(sessionContentId))!.inputDigest!, generatorVersion: 'learn-v2.canvas-preparation.v1' },
    decisionInputs: { intentRevision: 1, routerVersion: ADAPTIVE_ASSESSMENT_PLAN_VERSION, availableTime: '15', sourceState: 'ready',
      sourceInputs: evidenceReferences.map(ref => ({ sourceSnapshotId: ref.sourceSnapshotId, effectiveStatus: ref.sourceEffectiveStatus, recordRevision: ref.sourceRecordRevision })),
      priorActivityId: null, priorAttemptId: null, priorOutcome: null, assistance: 'none', confidence: null } })
  const { pins: _pins, threadId: _thread, objectiveId: _objective, evidenceReferences: _evidence, ...fields } = provisional
  const activityId = await ctx.db.insert('learningThreadActivities', { ...fields, status: 'eligible', userId, threadId, learningVoidId: learningVoid._id,
    blueprintRevisionId: blueprint._id, objectiveId: objective._id, sessionContentId, evidenceReferences, createdAt: now, updatedAt: now })
  await ctx.db.patch(threadId, { currentActivityId: activityId })
  const enrolled = await enrollLearnMeasurementForOwner(ctx, userId, { studySessionId: session._id, familyId: manifest.familyId, entryPoint, canvasActivityId: activityId })
  if (enrolled.status !== 'admitted' || !enrolled.assignmentId) {
    await ctx.db.delete(activityId)
    await ctx.db.delete(threadId)
    await ctx.db.delete(sessionContentId)
    return canvasUnavailable(enrolled.reasonCodes[0] ?? 'canvas_not_admitted')
  }
  const opportunity = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_assignmentId_and_horizonDays', q =>
    q.eq('userId', userId).eq('assignmentId', enrolled.assignmentId!).eq('horizonDays', undefined)).unique()
  if (!opportunity || opportunity.assessmentPins.kind !== 'measurement' || opportunity.contextPins.kind !== 'session'
    || opportunity.contextPins.canvas?.activityId !== activityId) throw new Error('Learn Canvas preparation conflicts')
  const item = (await ctx.db.get(opportunity.assessmentPins.itemPins.itemId))!
  if (item.responseSpec.kind !== 'bounded_rubric') throw new Error('Learn Canvas response format unavailable')
  const claims = await ctx.db.query('learnMeasurementClaims').withIndex('by_userId_and_itemId_and_order', q => q.eq('userId', userId).eq('itemId', item._id)).take(33)
  const final = await composeAdaptiveActivityPlan({ ...provisional, replacesActivityId: undefined, activityId: `assessment:${opportunity._id}`, primitiveSequence: [], evidenceReferences: [],
    decisionInputs: { ...provisional.decisionInputs, sourceInputs: [] },
    assessmentReference: { version: ADAPTIVE_ASSESSMENT_PLAN_VERSION, assessmentOpportunityId: opportunity._id, deliveryGrantId: null,
      item: { itemId: item._id, itemRevision: item.revision, promptDigest: item.promptDigest }, responseSpec: item.responseSpec,
      claims: claims.map(claim => ({ claimId: claim._id, revision: claim.revision, claimDigest: claim.claimDigest })) } })
  const { pins: _finalPins, threadId: _finalThread, objectiveId: _finalObjective, evidenceReferences: _finalEvidence, ...finalFields } = final
  await ctx.db.patch(activityId, { ...finalFields, evidenceReferences: [] })
  await ctx.db.patch(opportunity._id, { deliveryPins: { version: LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION, confidenceRequested: true } })
  await ctx.db.patch(sessionContentId, { assessmentOpportunityId: opportunity._id })
  await ctx.db.patch(session._id, { assessmentOpportunityId: opportunity._id, assessmentPurpose: 'measurement_cold', assistanceRevision: session.assistanceRevision ?? 0 })
  return await complete(threadId, opportunity._id, sessionContentId)
}

export const prepareCanvasSession = mutation({
  args: { studySessionId: v.id('studySessions'), expectedSessionRevision: v.number(), idempotencyKey: v.string() },
  returns: v.union(v.object({ kind: v.literal('not_admitted'), reasonCode: v.string(), observations: v.literal('no_observations') }),
    v.object({ kind: v.literal('prepared'), assessmentOpportunityId: v.id('learnAssessmentOpportunities'), sessionContentId: v.id('sessionContent') })),
  handler: async (ctx, args) => await prepareCanvasSessionForOwner(ctx, args),
})

export const listDueChecks = query({
  args: {},
  returns: v.object({ status: v.union(v.literal('available'), v.literal('disabled'), v.literal('unavailable')), reasonCode: v.union(v.string(), v.null()),
    checks: v.array(v.object({ assessmentOpportunityId: v.id('learnAssessmentOpportunities'), studySessionId: v.id('studySessions'),
      sessionRevision: v.number(), contentRevision: v.number(), horizonDays: v.union(v.literal(7), v.literal(30)), dueAt: v.number(), closeAt: v.number() })) }),
  handler: async (ctx) => {
    const userId = await requireAdaptiveQueryAccess(ctx)
    const unavailable = (reasonCode: string) => ({ status: 'unavailable' as const, reasonCode, checks: [] })
    if (!LEARN_MEASUREMENT_CAPABILITIES.responses || !LEARN_MEASUREMENT_CAPABILITIES.delivery) return { status: 'disabled' as const, reasonCode: 'disabled', checks: [] }
    const checks = []
    for (const phase of ['ready', 'test_open'] as const) {
      const rows = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_phase', q => q.eq('userId', userId).eq('phase', phase)).take(33)
      if (rows.length > 32) return unavailable('discovery_limit')
      for (const row of rows) {
        if (row.purpose.kind !== 'measurement_delayed' || row.submissionId || Date.now() < row.openAt || Date.now() >= row.closeAt
          || row.contextPins.kind !== 'session' || !row.contextPins.canvas) continue
        const scope = await canvasAssessmentScope(ctx, userId, row.contextPins.canvas.threadId)
        if (!scope || scope.opportunity._id !== row._id) return unavailable('pins_mismatch')
        if (!await canvasPilotAllowed(userId, scope)) return unavailable('canvas_not_admitted')
        const state = await readLearnAssessmentStateForOwner(ctx, userId, row._id, 'canvas')
        if (state.status !== 'available') return unavailable(state.status === 'disabled' ? 'disabled' : state.reasonCodes[0] ?? 'assessment_unavailable')
        checks.push({ assessmentOpportunityId: row._id, studySessionId: scope.session._id, sessionRevision: scope.session.revision,
          contentRevision: scope.content.revision, horizonDays: row.purpose.horizonDays, dueAt: row.dueAt!, closeAt: row.closeAt })
        if (checks.length > 32) return unavailable('discovery_limit')
      }
    }
    checks.sort((a, b) => a.dueAt - b.dueAt || String(a.assessmentOpportunityId).localeCompare(String(b.assessmentOpportunityId)))
    return { status: 'available' as const, reasonCode: null, checks }
  },
})

async function attachAssessmentCanvas(ctx: MutationCtx, args: CanvasAttachmentRequest) {
  const userId = await requireAdaptiveMutationAccess(ctx)
  const prepared = await prepareAdaptiveCommand({ userId, commandName: 'attachReadySession', targetId: String(args.studySessionId),
    expectedRevision: args.expectedSessionRevision, idempotencyKey: args.idempotencyKey, payload: { studySessionId: String(args.studySessionId) } })
  const unavailable = (reasonCode: string) => ({ kind: 'not_admitted' as const, reasonCode, observations: 'no_observations' as const })
  const prior = await ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId_and_idempotencyKeyHash', q => q.eq('userId', userId).eq('idempotencyKeyHash', prepared.idempotencyKeyHash)).unique()
  if (prior && (prior.commandName !== 'attachReadySession' || prior.requestFingerprint !== prepared.requestFingerprint)) throw new Error('Idempotency key was already used for a different request')
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses || !LEARN_MEASUREMENT_CAPABILITIES.delivery) return unavailable('disabled')
  const session = await ctx.db.get(args.studySessionId)
  if (!session || session.userId !== userId) return unavailable('unavailable')
  const opportunity = session.assessmentOpportunityId ? await ctx.db.get(session.assessmentOpportunityId) : null
  if (!opportunity || opportunity.userId !== userId || opportunity.contextPins.kind === 'calibration') return unavailable('assessment_unavailable')
  const plan = await ctx.db.get(session.studyPlanRevisionId)
  const content = session.startedSessionContentId ? await ctx.db.get(session.startedSessionContentId)
    : await ctx.db.query('sessionContent').withIndex('by_userId_and_studySessionId_and_revision', q => q.eq('userId', userId).eq('studySessionId', session._id)).order('desc').first()
  const learningVoid = await ctx.db.get(opportunity.learningVoidId)
  if (!plan || !content || !learningVoid || [plan, content, learningVoid].some(row => row.userId !== userId)
    || content.studySessionId !== session._id || content.studyPlanRevisionId !== plan._id
    || content.status !== 'published' || session.primaryObjectiveId !== opportunity.objectiveId
    || content.assessmentOpportunityId !== opportunity._id || content.objectiveId !== opportunity.objectiveId
    || content.blueprintRevisionId !== opportunity.blueprintRevisionId || plan.learningVoidId !== opportunity.learningVoidId
    || !content.inputDigest || !content.generatorVersion || await measurementScopeReason(ctx, userId, opportunity)) return unavailable('pins_mismatch')
  const itemPins = opportunity.assessmentPins.kind === 'measurement' ? learnMeasurementItemPinsSchema.parse(opportunity.assessmentPins.itemPins) : null
  const item = itemPins ? await ctx.db.get(itemPins.itemId) : null
  if (itemPins && (!item || item.userId !== userId || item.responseSpec.kind !== 'bounded_rubric')) return unavailable('response_format_unavailable')
  if (item && !assessmentPrimitive(item.prompt).ok) return unavailable('response_format_unavailable')
  const responseSpec = item?.responseSpec.kind === 'bounded_rubric' ? item.responseSpec : null
  const claims = item ? await ctx.db.query('learnMeasurementClaims').withIndex('by_userId_and_itemId_and_order', q => q.eq('userId', userId).eq('itemId', item._id)).take(33) : []
  const evidenceReferences: Doc<'learningThreadActivities'>['evidenceReferences'] = []
  if (itemPins) {
    const reason = await measurementItemReason(ctx, userId, itemPins, opportunity, opportunity.scoringBinding)
    if (reason) return unavailable(reason)
    if (!claims.length || claims.length > 32) return unavailable('evidence_unavailable')
  } else {
    if (!await isLearnV2ContentEvidenceReady(ctx, userId, content, learningVoid._id)) return unavailable('evidence_unavailable')
    const blocks = await ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(17)
    const prompts = blocks.filter(block => block.kind === 'transfer_challenge')
    if (blocks.length > 16 || prompts.length !== 1 || !assessmentPrimitive(prompts[0]?.content).ok) return unavailable('response_format_unavailable')
    const teachingClaims = await ctx.db.query('sessionContentClaims').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(17)
    if (!teachingClaims.length || teachingClaims.length > 16) return unavailable('evidence_unavailable')
    for (const claim of teachingClaims) {
      const support = await ctx.db.query('learnClaimSupports').withIndex('by_userId_and_sessionContentClaimId', q => q.eq('userId', userId).eq('sessionContentClaimId', claim._id)).first()
      const source = support?.sourceSnapshotId ? await ctx.db.get(support.sourceSnapshotId) : null
      if (!support || !source || source.userId !== userId || !support.verifierVersion) return unavailable('evidence_unavailable')
      evidenceReferences.push({ claimId: claim._id, supportId: support._id, sourceSnapshotId: source._id,
        sourceSnapshotRevision: source.revision, sourceRecordRevision: source.recordRevision ?? 1, sourceEffectiveStatus: 'user_accepted',
        verifierVersion: support.verifierVersion, integrityState: 'accepted' })
    }
  }
  const linked = await findCurrentAdaptiveActivityForSessionContent(ctx, userId, content._id)
  if (linked) {
    const scope = await canvasAssessmentScope(ctx, userId, linked.thread._id)
    if (!scope || !await canvasPilotAllowed(userId, scope)) return unavailable('canvas_not_admitted')
    const ungranted = !opportunity.deliveryGrantId && !opportunity.submissionId && opportunity.phase === 'ready'
    if (ungranted) {
      const reference = readAdaptiveAssessmentReference(scope.activity)
      if (!reference || reference.deliveryGrantId !== null) return unavailable('disclosure_unknown')
      const rebuilt = await composeAdaptiveActivityPlan({ ...storedPlan(scope.activity), replacesActivityId: undefined, primitiveSequence: [], assessmentReference: reference })
      if (rebuilt.inputDigest !== scope.activity.inputDigest || rebuilt.canonicalInputSnapshot !== scope.activity.canonicalInputSnapshot) return unavailable('disclosure_unknown')
    } else if (!(await replayAdaptiveActivityPlan(storedPlan(scope.activity))).ok) return unavailable('disclosure_unknown')
    let granted = false
    if (!opportunity.deliveryGrantId && !opportunity.submissionId && opportunity.phase === 'ready') {
      if (session.revision !== args.expectedSessionRevision || session.status !== 'ready') return unavailable('session_unavailable')
      const receipt = await grantLearnAssessmentDeliveryForOwner(ctx, userId, { assessmentOpportunityId: opportunity._id,
        expectedRevision: opportunity.revision, idempotencyKey: args.idempotencyKey, flow: 'canvas' })
      if (receipt.status !== 'granted') return unavailable(receipt.status === 'unavailable' ? receipt.reasonCodes[0] ?? 'canvas_not_admitted' : 'disabled')
      granted = true
      const reference = readAdaptiveAssessmentReference(scope.activity)
      if (!reference || opportunity.contextPins.kind !== 'session') throw new Error('Learn Canvas preparation unavailable')
      const plan = await composeAdaptiveActivityPlan({ ...storedPlan(scope.activity), replacesActivityId: undefined, primitiveSequence: [],
        assessmentReference: { ...reference, deliveryGrantId: receipt.deliveryGrantId } })
      await ctx.db.patch(scope.activity._id, { canonicalInputSnapshot: plan.canonicalInputSnapshot, inputDigest: plan.inputDigest, status: 'started', updatedAt: Date.now() })
      await ctx.db.patch(session._id, { status: 'in_progress', revision: session.revision + 1,
        startedSessionContentId: content._id, startedSessionContentRevision: content.revision })
      await ctx.db.patch(opportunity._id, { contextPins: { ...opportunity.contextPins, sessionRevision: session.revision + 1 } })
    }
    const delivery = await readLearnAssessmentForOwner(ctx, userId, opportunity._id, 'canvas')
    if (delivery.status !== 'delivered') {
      if (granted) throw new Error('Learn Canvas delivery authority changed')
      return unavailable('assessment_unavailable')
    }
    if (prior?.resultReference && prior.resultRedactedAt === undefined) {
      const saved = JSON.parse(prior.resultReference) as { threadId: string, activityId: string }
      if (saved.threadId !== scope.thread._id || saved.activityId !== scope.activity.activityId) return unavailable('receipt_conflict')
    }
    if (!prior) await ctx.db.insert('learnActivityCommandReceipts', { userId, threadId: scope.thread._id, idempotencyKeyHash: prepared.idempotencyKeyHash,
      requestFingerprint: prepared.requestFingerprint, commandName: 'attachReadySession', targetRevision: args.expectedSessionRevision,
      resultKind: 'ok', resultReference: boundedAdaptiveCommandReference({ threadId: scope.thread._id, activityId: scope.activity.activityId }), errorReference: null,
      createdAt: Date.now(), resultExpiresAt: Date.now() + RECEIPT_TTL_MS, redactionStatus: 'pending' })
    return { kind: 'attached' as const, threadId: scope.thread._id, activityId: scope.activity.activityId, replayed: !ungranted }
  }
  if (session.revision !== args.expectedSessionRevision || !['ready', 'in_progress'].includes(session.status)
    || opportunity.deliveryGrantId || opportunity.submissionId || opportunity.contextPins.kind === 'session' && opportunity.contextPins.canvas) return unavailable('flow_already_bound')
  const candidates = await ctx.db.query('learningThreadActivities').withIndex('by_userId_and_sessionContentId_and_updatedAt', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(1)
  if (candidates.length) return unavailable('canvas_unavailable')
  if (!await canvasPilotDecision(userId, opportunity.scoringBinding, 'learn-adaptive.activity-contract.v1', 'learn-adaptive.evaluation.v1', process.env.LEARN_ADAPTIVE_V2_PILOT_MANIFEST)) return unavailable('canvas_not_admitted')
  const now = Date.now()
  const threadId = await ctx.db.insert('learningThreads', { userId, originalNeed: 'Complete the assigned check.', outcome: 'Assigned check',
    outcomeProvenance: 'explicit', intent: 'master', availableTime: '15', authorityKind: 'v2_mission', learningVoidId: learningVoid._id,
    sourceScope: { kind: 'none' }, evidenceState: 'ready', lifecycle: 'active', revision: 1, createdAt: now, updatedAt: now })
  const compose = async (deliveryGrantId: Id<'learnAssessmentExposures'> | null) => await composeAdaptiveActivityPlan({
    activityId: `assessment:${String(opportunity._id)}`, threadId: String(threadId), boundaryOrdinal: 1, planRevision: 1,
    activityClass: 'factual', intent: 'master', objectiveId: String(opportunity.objectiveId), purpose: 'Complete the assigned check.', reasonCode: 'assessment_check',
    primitiveSequence: item ? [] : [{ type: 'independent_application', action: 'submit_response', props: { prompt: 'Complete the assigned application.', responseFormat: 'short_text', draftPersistence: false } }],
    ...(item && responseSpec ? { assessmentReference: { version: ADAPTIVE_ASSESSMENT_PLAN_VERSION, assessmentOpportunityId: opportunity._id, deliveryGrantId,
      item: { itemId: item._id, itemRevision: item.revision, promptDigest: item.promptDigest }, responseSpec,
      claims: claims.map(claim => ({ claimId: claim._id, revision: claim.revision, claimDigest: claim.claimDigest })) } } : {}),
    requiredAction: { kind: 'submit_response', label: 'Submit response' },
    evaluationContract: { version: 'learn-adaptive.evaluation.v1', kind: 'server_scored', responseFormat: 'short_text', passingScorePercent: 80 },
    accessibilityMetadata: { heading: 'Assigned check', instructions: 'Submit your response.', focusTargetTestId: 'learn-primitive-independent-application', liveRegionMode: 'polite' },
    pins: { learningVoidId: String(learningVoid._id), blueprintRevisionId: String(opportunity.blueprintRevisionId), objectiveId: String(opportunity.objectiveId), sessionContentId: String(content._id) },
    evidenceReferences, generationInputs: { sessionContentRevision: content.revision, sessionContentInputDigest: content.inputDigest!, generatorVersion: content.generatorVersion! },
    decisionInputs: { intentRevision: 1, routerVersion: ADAPTIVE_ASSESSMENT_PLAN_VERSION, availableTime: '15', sourceState: 'ready', sourceInputs: evidenceReferences.map(ref => ({ sourceSnapshotId: ref.sourceSnapshotId, effectiveStatus: ref.sourceEffectiveStatus, recordRevision: ref.sourceRecordRevision })),
      priorActivityId: null, priorAttemptId: null, priorOutcome: null, assistance: 'none', confidence: null } })
  const composed = await compose(null)
  const { pins: _pins, threadId: _threadId, objectiveId: _objectiveId, evidenceReferences: _references, ...fields } = composed
  const activityId = await ctx.db.insert('learningThreadActivities', { ...fields, userId, threadId, status: 'started',
    objectiveId: opportunity.objectiveId, learningVoidId: learningVoid._id, blueprintRevisionId: opportunity.blueprintRevisionId,
    sessionContentId: content._id, evidenceReferences, createdAt: now, updatedAt: now })
  await ctx.db.patch(threadId, { currentActivityId: activityId })
  const contextPins = { ...opportunity.contextPins, kind: 'session' as const, studySessionId: session._id, sessionRevision: session.revision,
    sessionContentId: content._id, contentRevision: content.revision, contentInputDigest: content.inputDigest, generatorVersion: content.generatorVersion,
    canvas: { threadId, threadRevision: 1, activityId, activityRevision: 1, planVersion: composed.planVersion, replayVersion: composed.replayVersion,
      rendererVersion: composed.rendererVersion, evaluationVersion: composed.evaluationContract.version,
      pilotConfigurationVersion: process.env.LEARN_ADAPTIVE_V2_PILOT_MANIFEST ?? '' } }
  await ctx.db.patch(opportunity._id, { contextPins })
  const receipt = await grantLearnAssessmentDeliveryForOwner(ctx, userId, { assessmentOpportunityId: opportunity._id, expectedRevision: opportunity.revision,
    idempotencyKey: args.idempotencyKey, flow: 'canvas' })
  if (receipt.status !== 'granted') {
    await ctx.db.patch(opportunity._id, { contextPins: opportunity.contextPins })
    await ctx.db.delete(activityId)
    await ctx.db.delete(threadId)
    return unavailable(receipt.status === 'unavailable' ? receipt.reasonCodes[0] ?? 'canvas_not_admitted' : 'disabled')
  }
  if (session.status === 'ready') {
    await ctx.db.patch(session._id, { status: 'in_progress', revision: session.revision + 1,
      startedSessionContentId: content._id, startedSessionContentRevision: content.revision })
    await ctx.db.patch(opportunity._id, { contextPins: { ...contextPins, sessionRevision: session.revision + 1 } })
  }
  const sealedPlan = await compose(receipt.deliveryGrantId)
  await ctx.db.patch(activityId, { canonicalInputSnapshot: sealedPlan.canonicalInputSnapshot, inputDigest: sealedPlan.inputDigest })
  if ((await readLearnAssessmentForOwner(ctx, userId, opportunity._id, 'canvas')).status !== 'delivered') throw new Error('Learn Canvas delivery authority changed')
  const receiptId = await ctx.db.insert('learnActivityCommandReceipts', { userId, threadId, idempotencyKeyHash: prepared.idempotencyKeyHash,
    requestFingerprint: prepared.requestFingerprint, commandName: 'attachReadySession', targetRevision: args.expectedSessionRevision,
    resultKind: 'ok', resultReference: boundedAdaptiveCommandReference({ threadId, activityId: composed.activityId }), errorReference: null,
    createdAt: now, resultExpiresAt: now + RECEIPT_TTL_MS, redactionStatus: 'pending' })
  return { kind: 'attached' as const, threadId, activityId: composed.activityId, receiptId: String(receiptId), replayed: false }
}

function referencedClaimOrders(raw: string | undefined): number[] {
  let parsed: unknown
  try { parsed = raw && JSON.parse(raw) } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new Error('Ready Canvas evidence is unavailable', { cause: error })
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 16
    || parsed.some(order => !Number.isSafeInteger(order) || order < 0)
    || new Set(parsed).size !== parsed.length) throw new Error('Ready Canvas evidence is unavailable')
  return parsed as number[]
}

// This is the existing V2-session entry path. It creates a fresh V2-backed
// thread from an owned ready session; need-first draft promotion is a separate
// continuation and must not be inferred from the matching title or folder.
// The client chooses a session, never a plan, evidence reference, provider, or score.
export const attachReadySession = mutation({
  args: { studySessionId: v.id('studySessions'), expectedSessionRevision: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    if (LEARN_MEASUREMENT_CAPABILITIES.responses) {
      const userId = await requireAdaptiveMutationAccess(ctx)
      ctx = measurementReadContext(ctx, userId)
      const session = await ctx.db.get(args.studySessionId)
      if (session?.userId === userId && !session.assessmentOpportunityId) {
        const prepared = await prepareCanvasSessionForOwner(ctx, { ...args, idempotencyKey: `canvas_prepare_${(await privacyDigest(args.idempotencyKey)).slice(7)}` })
        if (prepared.kind !== 'prepared') return prepared
      }
      return await attachAssessmentCanvas(ctx, args)
    }
    const userId = await requireAdaptiveMutationAccess(ctx)
    const prepared = await prepareAdaptiveCommand({
      userId, commandName: 'attachReadySession', targetId: String(args.studySessionId),
      expectedRevision: args.expectedSessionRevision, idempotencyKey: args.idempotencyKey,
      payload: { studySessionId: String(args.studySessionId) },
    })
    const prior = await ctx.db.query('learnActivityCommandReceipts')
      .withIndex('by_userId_and_idempotencyKeyHash', q => q.eq('userId', userId).eq('idempotencyKeyHash', prepared.idempotencyKeyHash))
      .unique()
    if (prior) {
      if (prior.commandName !== 'attachReadySession' || prior.requestFingerprint !== prepared.requestFingerprint) throw new Error('Idempotency key was already used for a different request')
      if (!prior.resultReference || prior.resultRedactedAt !== undefined) throw new Error('Attachment receipt has expired')
      const saved = JSON.parse(prior.resultReference) as { threadId: Id<'learningThreads'>, activityId: string }
      const thread = await ctx.db.get(saved.threadId)
      if (!thread || thread.userId !== userId || thread.currentActivityId === undefined) throw new Error('Attached thread is unavailable')
      const activity = await ctx.db.get(thread.currentActivityId)
      if (!activity || activity.userId !== userId || activity.threadId !== thread._id
        || activity.activityId !== saved.activityId || activity.status === 'ended' || activity.status === 'replaced') throw new Error('Attached activity is unavailable')
      const content = activity.sessionContentId && await ctx.db.get(activity.sessionContentId)
      const session = content && await ctx.db.get(content.studySessionId)
      const plan = session && await ctx.db.get(session.studyPlanRevisionId)
      const learningVoid = plan && await ctx.db.get(plan.learningVoidId)
      if (!content || !session || !plan || !learningVoid || content.studySessionId !== args.studySessionId
        || content.userId !== userId || session.userId !== userId || plan.userId !== userId
        || thread.authorityKind !== 'v2_mission' || thread.learningVoidId !== learningVoid._id
        || activity.learningVoidId !== learningVoid._id || learningVoid.userId !== userId
        || activity.blueprintRevisionId !== content.blueprintRevisionId || activity.objectiveId !== content.objectiveId
        || activity.generationInputs.sessionContentRevision !== content.revision) throw new Error('Attached V2 anchor is unavailable')
      if (!(await isLearnV2ContentEvidenceReady(ctx, userId, content, learningVoid._id))) throw new Error('Attached Canvas evidence is unavailable')
      return { kind: 'attached' as const, ...saved, replayed: true as const }
    }

    const session = await ctx.db.get(args.studySessionId)
    if (!session || session.userId !== userId || !['ready', 'in_progress'].includes(session.status) || session.revision !== args.expectedSessionRevision) throw new Error('Ready study session is unavailable')
    const plan = await ctx.db.get(session.studyPlanRevisionId)
    const stablePlan = plan && await ctx.db.get(plan.studyPlanId)
    const learningVoid = plan && await ctx.db.get(plan.learningVoidId)
    const blueprint = plan?.blueprintRevisionId && await ctx.db.get(plan.blueprintRevisionId)
    const objective = await ctx.db.get(session.primaryObjectiveId)
    const currentPlan = plan && stablePlan && (stablePlan.activeRevisionId === plan._id && plan.status === 'accepted'
      || isDedicatedLearnCheck(session) && await hasLearnReflowPlanAuthority(ctx, userId, plan))
    if (!plan || !stablePlan || !learningVoid || !blueprint || !objective
      || plan.userId !== userId || learningVoid.userId !== userId || blueprint.userId !== userId || objective.userId !== userId
      || !currentPlan || blueprint.status !== 'accepted'
      || plan.blueprintRecordRevision !== blueprint.recordRevision || objective.blueprintRevisionId !== blueprint._id) throw new Error('Ready study session is not current')
    const folder = await ctx.db.get(learningVoid.folderId)
    if (!folder || folder.userId !== userId || typeof objective.assessmentContract !== 'object') throw new Error('Ready study session is not current')
    await requireActiveBlueprint(ctx, userId, learningVoid, blueprint._id)
    const now = Date.now()
    const timezone = session.timezone ?? plan.timezone ?? 'UTC'
    if (session.scheduledStartAt > now && localDateAt(session.scheduledStartAt, timezone) !== localDateAt(now, timezone)) throw new Error('Study session is not scheduled for today')
    if (session.scheduledEndAt !== undefined && session.scheduledEndAt < now) throw new Error('Study session window has expired')
    const content = session.status === 'in_progress' && session.startedSessionContentRevision !== undefined
      ? await ctx.db.query('sessionContent').withIndex('by_userId_and_studySessionId_and_revision', q => q.eq('userId', userId).eq('studySessionId', session._id).eq('revision', session.startedSessionContentRevision!)).unique()
      : await ctx.db.query('sessionContent').withIndex('by_userId_and_studySessionId_and_revision', q => q.eq('userId', userId).eq('studySessionId', session._id)).order('desc').first()
    if (!content || content.status !== 'published' || content.studyPlanRevisionId !== plan._id
      || content.blueprintRevisionId !== blueprint._id || content.objectiveId !== objective._id
      || !content.inputDigest || !content.generatorVersion
      || (session.status === 'in_progress' && (session.startedSessionContentId !== content._id || session.startedSessionContentRevision !== content.revision))) throw new Error('Published study content is unavailable')
    if (!(await isLearnV2ContentEvidenceReady(ctx, userId, content, learningVoid._id))) throw new Error('Ready Canvas evidence is unavailable')
    const linked = await findCurrentAdaptiveActivityForSessionContent(ctx, userId, content._id)
    if (linked) {
      if (linked.thread.authorityKind !== 'v2_mission' || linked.thread.learningVoidId !== learningVoid._id
        || linked.activity.learningVoidId !== learningVoid._id || linked.activity.blueprintRevisionId !== blueprint._id
        || linked.activity.objectiveId !== objective._id || linked.activity.sessionContentId !== content._id
        || linked.activity.generationInputs.sessionContentRevision !== content.revision) throw new Error('Attached V2 anchor is unavailable')
      return { kind: 'attached' as const, threadId: linked.thread._id, activityId: linked.activity.activityId, replayed: true as const }
    }
    if (session.status !== 'ready') throw new Error('This started session has no adaptive thread')
    const attachedRows = await ctx.db.query('learningThreadActivities')
      .withIndex('by_userId_and_sessionContentId_and_updatedAt', q => q.eq('userId', userId).eq('sessionContentId', content._id))
      .take(9)
    if (attachedRows.length) throw new Error('This session already has an adaptive activity')

    const blocks = await ctx.db.query('sessionContentBlocks')
      .withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(17)
    if (blocks.length > 16) throw new Error('Published study content exceeds Canvas bounds')
    const explanation = blocks.find(block => block.kind === 'explanation' && block.content?.trim())
    const application = blocks.find(block => block.kind === 'independent_application' && block.content?.trim())
    if (!explanation || !application) throw new Error('Ready Canvas content is unavailable')
    const explanationOrders = referencedClaimOrders(explanation.claimOrdersJson)
    const claimOrders = [...new Set([...explanationOrders, ...referencedClaimOrders(application.claimOrdersJson)])].sort((a, b) => a - b)
    if (claimOrders.length > 16) throw new Error('Ready Canvas evidence is unavailable')
    const evidenceReferences = [] as Array<{
      claimId: Id<'sessionContentClaims'>, supportId: Id<'learnClaimSupports'>, sourceSnapshotId: Id<'learnSourceSnapshots'>,
      sourceSnapshotRevision: number, sourceRecordRevision: number, sourceEffectiveStatus: 'user_accepted', verifierVersion: string, integrityState: 'accepted'
    }>
    const sourceInputs = [] as Array<{ sourceSnapshotId: string, effectiveStatus: 'user_accepted', recordRevision: number }>
    const sourceIds = new Set<string>()
    const explanationSourceIds = new Set<string>()
    for (const order of claimOrders) {
      const claim = await ctx.db.query('sessionContentClaims')
        .withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id).eq('order', order)).unique()
      if (!claim || !claim.verifierVersion || (claim.confidence ?? 0) < 0.8) throw new Error('Ready Canvas evidence is unavailable')
      const supports = await ctx.db.query('learnClaimSupports')
        .withIndex('by_userId_and_sessionContentClaimId', q => q.eq('userId', userId).eq('sessionContentClaimId', claim._id)).take(9)
      if (!supports.length || supports.length > 8) throw new Error('Ready Canvas evidence is unavailable')
      let pinned = false
      for (const support of supports) {
        if (support.entailment !== 'entailed' || support.evidenceStatus !== 'evidence_available' || support.conflictStatus !== 'clear' || (support.confidence ?? 0) < 0.8 || !support.verifierVersion) continue
        const excerpt = await ctx.db.get(support.sourceExcerptId)
        const sourceSnapshotId = support.sourceSnapshotId ?? excerpt?.sourceSnapshotId
        const source = sourceSnapshotId && await ctx.db.get(sourceSnapshotId)
        if (!excerpt || !source || excerpt.sourceSnapshotId !== source._id || source.userId !== userId || source.learningVoidId !== learningVoid._id || source.effectiveStatus !== 'user_accepted') continue
        evidenceReferences.push({ claimId: claim._id, supportId: support._id, sourceSnapshotId: source._id,
          sourceSnapshotRevision: source.revision, sourceRecordRevision: source.recordRevision ?? 1,
          sourceEffectiveStatus: 'user_accepted', verifierVersion: support.verifierVersion, integrityState: 'accepted' })
        if (!sourceIds.has(String(source._id))) {
          sourceIds.add(String(source._id))
          sourceInputs.push({ sourceSnapshotId: String(source._id), effectiveStatus: 'user_accepted', recordRevision: source.recordRevision ?? 1 })
        }
        if (explanationOrders.includes(order)) explanationSourceIds.add(String(source._id))
        pinned = true
        break
      }
      if (!pinned) throw new Error('Ready Canvas evidence is unavailable')
    }
    if (sourceIds.size > 8) throw new Error('Ready Canvas evidence is unavailable')
    const evidence = await loadAdaptiveClaimProjection(ctx, {
      userId, historical: false, sessionContentId: content._id, sessionContentRevision: content.revision, evidenceReferences,
    })
    if (evidence.integrityState !== 'accepted') throw new Error('Ready Canvas evidence is unavailable')

    const availableTime = objective.estimatedMinutes && objective.estimatedMinutes <= 15 ? '15' as const
      : objective.estimatedMinutes && objective.estimatedMinutes <= 25 ? '25' as const
        : objective.estimatedMinutes && objective.estimatedMinutes <= 45 ? '45' as const : '60' as const
    const threadId = await ctx.db.insert('learningThreads', {
      userId, originalNeed: objective.title, outcome: objective.capability ?? objective.title,
      outcomeProvenance: 'explicit', intent: 'understand', availableTime,
      authorityKind: 'v2_mission', learningVoidId: learningVoid._id,
      sourceScope: { kind: 'folder', sourceId: String(learningVoid.folderId) },
      evidenceState: 'ready', lifecycle: 'ready', unresolvedPoint: objective.title.slice(0, 240), revision: 2, createdAt: now, updatedAt: now,
    })
    const activityId = `ready-session:${String(session._id)}`
    const composed = await composeAdaptiveActivityPlan({
      activityId, threadId: String(threadId), boundaryOrdinal: 1, planRevision: 1,
      activityClass: 'factual', intent: 'understand', objectiveId: String(objective._id),
      purpose: 'Study the supported explanation, then apply it independently.',
      reasonCode: 'ready_v2_session',
      primitiveSequence: [{ type: 'cited_explanation', action: 'continue', props: {
        heading: objective.title, explanation: explanation.content!, sourceRefs: [...explanationSourceIds],
      } }],
      requiredAction: { kind: 'continue', label: 'Continue' },
      evaluationContract: { version: 'learn-adaptive.evaluation.v1', kind: 'server_scored', responseFormat: 'short_text', passingScorePercent: objective.assessmentContract.passingScorePercent },
      accessibilityMetadata: { heading: objective.title, instructions: 'Read the explanation, then continue to the independent response.', focusTargetTestId: 'learn-primitive-cited-explanation', liveRegionMode: 'polite' },
      pins: { learningVoidId: String(learningVoid._id), blueprintRevisionId: String(blueprint._id), objectiveId: String(objective._id), sessionContentId: String(content._id) },
      evidenceReferences: evidenceReferences.map(row => ({ ...row, claimId: String(row.claimId), supportId: String(row.supportId), sourceSnapshotId: String(row.sourceSnapshotId) })),
      generationInputs: { sessionContentRevision: content.revision, sessionContentInputDigest: content.inputDigest, generatorVersion: content.generatorVersion },
      decisionInputs: { intentRevision: 1, routerVersion: 'learn-adaptive.router.v1', availableTime, sourceState: 'ready', sourceInputs, priorActivityId: null, priorAttemptId: null, priorOutcome: null, assistance: 'none', confidence: null },
    })
    const activityDocumentId = await ctx.db.insert('learningThreadActivities', {
      userId, threadId, activityId, boundaryOrdinal: 1, planRevision: 1, activityClass: 'factual', status: 'eligible',
      planVersion: composed.planVersion, replayVersion: composed.replayVersion, contractVersion: composed.contractVersion,
      rendererVersion: composed.rendererVersion, validationVersion: composed.validationVersion,
      sequenceValidationVersion: composed.sequenceValidationVersion, fallbackVersion: composed.fallbackVersion,
      intent: composed.intent, objectiveId: objective._id, purpose: composed.purpose, reasonCode: composed.reasonCode,
      reasonText: reasonTextForActivity({ activityClass: 'factual', purpose: composed.purpose, reasonCode: composed.reasonCode, sourceState: 'ready' }),
      primitivePlan: composed.primitivePlan, requiredAction: composed.requiredAction,
      evaluationContract: composed.evaluationContract, fallback: composed.fallback,
      accessibilityMetadata: composed.accessibilityMetadata,
      learningVoidId: learningVoid._id, blueprintRevisionId: blueprint._id, sessionContentId: content._id,
      evidenceReferences, generationInputs: composed.generationInputs, decisionInputs: composed.decisionInputs,
      replacesActivityId: composed.replacesActivityId, canonicalInputSnapshot: composed.canonicalInputSnapshot,
      inputDigest: composed.inputDigest, createdAt: now, updatedAt: now,
    })
    await ctx.db.patch(threadId, { currentActivityId: activityDocumentId })
    for (const sourceSnapshotId of sourceIds) await ctx.db.insert('learnActivityEvidenceLinks', { userId, threadId, activityId: activityDocumentId, sourceSnapshotId: sourceSnapshotId as Id<'learnSourceSnapshots'>, boundaryOrdinal: 1, createdAt: now })
    await writeLearnActivityEvent(ctx, { userId, threadId, activityId: activityDocumentId, eventType: 'activity_eligible', eventVersion: 'activity_eligible.v1', sourceVersion: composed.planVersion, contractVersion: composed.contractVersion, semanticKey: `activity:${activityId}:eligible`, occurredAt: now, reasonCode: 'ready_session_attached', outcomeCode: 'eligible', metadata: { activityClass: 'factual', boundaryOrdinal: 1, planRevision: 1 } })
    const receiptId = await ctx.db.insert('learnActivityCommandReceipts', {
      userId, threadId, idempotencyKeyHash: prepared.idempotencyKeyHash,
      requestFingerprint: prepared.requestFingerprint, commandName: 'attachReadySession', targetRevision: args.expectedSessionRevision,
      resultKind: 'ok', resultReference: boundedAdaptiveCommandReference({ threadId, activityId }), errorReference: null,
      createdAt: now, resultExpiresAt: now + RECEIPT_TTL_MS, redactionStatus: 'pending',
    })
    return { kind: 'attached' as const, threadId, activityId, receiptId: String(receiptId), replayed: false as const }
  },
})

async function loadLegacyReadyCanvas(ctx: QueryCtx | MutationCtx, userId: string, threadId: Id<'learningThreads'>, options: { includeSavedResponse?: boolean } = {}) {
    ctx = responsePrivacyReadContext(ctx, userId)
    const owner = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique()
    const thread = await ctx.db.get(threadId)
    if (!owner || !thread || thread.userId !== userId || thread.authorityKind !== 'v2_mission' || thread.deletionStartedAt !== undefined || !thread.currentActivityId) return null
    const activity = await ctx.db.get(thread.currentActivityId)
    if (!activity || activity.userId !== userId || activity.threadId !== thread._id || !activity.sessionContentId || !activity.learningVoidId
      || thread.learningVoidId !== activity.learningVoidId) return null
    const content = await ctx.db.get(activity.sessionContentId)
    const session = content && await ctx.db.get(content.studySessionId)
    const learningVoid = await ctx.db.get(activity.learningVoidId)
    if (!content || !session || !learningVoid || content.userId !== userId || session.userId !== userId || learningVoid.userId !== userId) return null
    const plan = await ctx.db.get(session.studyPlanRevisionId)
    const stablePlan = plan && await ctx.db.get(plan.studyPlanId)
    const blueprint = activity.blueprintRevisionId && await ctx.db.get(activity.blueprintRevisionId)
    const objective = activity.objectiveId && await ctx.db.get(activity.objectiveId)
    if (!plan || !stablePlan || !blueprint || !objective || plan.userId !== userId || blueprint.userId !== userId || objective.userId !== userId) return null
    const replay = await replayAdaptiveActivityPlan({
      planVersion: activity.planVersion, replayVersion: activity.replayVersion, contractVersion: activity.contractVersion,
      rendererVersion: activity.rendererVersion, validationVersion: activity.validationVersion,
      sequenceValidationVersion: activity.sequenceValidationVersion, fallbackVersion: activity.fallbackVersion,
      activityId: activity.activityId, threadId: String(thread._id), boundaryOrdinal: activity.boundaryOrdinal,
      planRevision: activity.planRevision, activityClass: activity.activityClass, intent: activity.intent,
      objectiveId: activity.objectiveId ? String(activity.objectiveId) : null,
      purpose: activity.purpose, reasonCode: activity.reasonCode, primitivePlan: activity.primitivePlan,
      requiredAction: activity.requiredAction, evaluationContract: activity.evaluationContract,
      fallback: activity.fallback, accessibilityMetadata: activity.accessibilityMetadata,
      pins: { learningVoidId: activity.learningVoidId ? String(activity.learningVoidId) : null, blueprintRevisionId: activity.blueprintRevisionId ? String(activity.blueprintRevisionId) : null, objectiveId: activity.objectiveId ? String(activity.objectiveId) : null, sessionContentId: activity.sessionContentId ? String(activity.sessionContentId) : null },
      evidenceReferences: activity.evidenceReferences.map(reference => ({ ...reference, claimId: String(reference.claimId), supportId: String(reference.supportId), sourceSnapshotId: String(reference.sourceSnapshotId) })),
      generationInputs: activity.generationInputs, decisionInputs: activity.decisionInputs,
      replacesActivityId: activity.replacesActivityId, canonicalInputSnapshot: activity.canonicalInputSnapshot, inputDigest: activity.inputDigest,
    })
    const folder = await ctx.db.get(learningVoid.folderId)
    const blocks = await ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(17)
    const scoredAttempt = activity.masteryAttemptId && await ctx.db.get(activity.masteryAttemptId)
    const selectedOverride = await ctx.db.query('learnActivityOverrides')
      .withIndex('by_userId_and_activityId_and_createdAt', q => q.eq('userId', userId).eq('activityId', activity._id))
      .order('desc').first()
    const evidence = activity.evidenceReferences.length > 0 && activity.generationInputs.sessionContentRevision !== null
      ? await privacyRead(ctx, userId, ['canvas-evidence', activity._id], null, async ctx => await loadAdaptiveClaimProjection(ctx, { userId, historical: false, sessionContentId: content._id, sessionContentRevision: activity.generationInputs.sessionContentRevision!, evidenceReferences: activity.evidenceReferences }))
      : null
    const contentEvidenceReady = await privacyRead(ctx, userId, ['canvas-content', content._id], false, async ctx => await isLearnV2ContentEvidenceReady(ctx, userId, content, learningVoid._id))
    const sourceReady = await privacyRead(ctx, userId, ['canvas-scope', thread._id], false, async ctx => (await liveEvidenceState(ctx, thread)) === 'ready')
    let bodyAuthority = sourceReady && learningVoid.status !== 'archived' && folder?.userId === userId
      && contentEvidenceReady && activity.evidenceReferences.length > 0 && activity.evidenceReferences.length <= 64
    if (bodyAuthority) for (const reference of activity.evidenceReferences) {
      if (!await retainedSourceExcerpt(ctx, userId, reference.sourceSnapshotId)) { bodyAuthority = false; break }
    }
    const savedBodyAvailable = options.includeSavedResponse !== false && bodyAuthority && await activityResponseAvailable(ctx, userId, activity)
    const completedFeedback = activity.status === 'feedback' && session.status === 'completed' && scoredAttempt
      && scoredAttempt.userId === userId && scoredAttempt.studySessionId === session._id
      && scoredAttempt.sessionContentId === content._id && scoredAttempt.blueprintRevisionId === blueprint._id
      && scoredAttempt.objectiveId === objective._id && scoredAttempt.contentRevision === content.revision
      && session.startedSessionContentId === content._id && session.startedSessionContentRevision === content.revision
    const planCurrent = plan.status === 'accepted' && stablePlan.activeRevisionId === plan._id
      || isDedicatedLearnCheck(session) && await hasLearnReflowPlanAuthority(ctx, userId, plan)
    const current = planCurrent && blueprint.status === 'accepted' && content.status === 'published'
      && bodyAuthority
      && activity.sessionContentId === content._id && activity.objectiveId === objective._id
      && activity.blueprintRevisionId === blueprint._id && plan.blueprintRecordRevision === blueprint.recordRevision
      && session.studyPlanRevisionId === plan._id && content.studyPlanRevisionId === plan._id
      && content.blueprintRevisionId === blueprint._id && content.objectiveId === objective._id
      && learningVoid.activeBlueprintRevisionId === blueprint._id
      && (session.status === 'ready' || session.status === 'in_progress' || Boolean(completedFeedback))
      && (session.status !== 'in_progress' || session.startedSessionContentId === content._id && session.startedSessionContentRevision === content.revision)
    const prompt = blocks.length <= 16 ? blocks.find(block => block.kind === 'independent_application')?.content : undefined
    const status = !current || !replay.ok || evidence?.integrityState !== 'accepted' || !prompt?.trim()
      ? 'blocked' as const
      : activity.status === 'eligible' && session.status === 'ready' ? 'ready' as const
        : activity.status === 'started' && session.status === 'in_progress' ? 'started' as const
          : ['submitted', 'scoring', 'feedback', 'reconciling'].includes(activity.status) ? activity.status : 'blocked' as const
    const recoveryState: AdaptiveEvidenceState = thread.evidenceState === 'invalidated' || evidence?.integrityState === 'deleted' || !replay.ok ? 'invalidated'
      : evidence?.integrityState === 'unavailable' || thread.evidenceState === 'unavailable' ? 'unavailable'
        : evidence?.integrityState === 'stale' || thread.evidenceState === 'stale' ? 'stale'
          : thread.evidenceState === 'preparing' ? 'preparing'
          : thread.evidenceState === 'blocked' || evidence?.integrityState === 'insufficient' || evidence?.integrityState === 'conflicting' ? 'blocked'
            : !current ? 'stale' : 'blocked'
    return {
      status, ownerId: owner._id, thread: { id: thread._id, outcome: thread.outcome ?? thread.originalNeed, intent: thread.intent, revision: thread.revision },
      recoveryState: status === 'blocked' ? recoveryState : null,
      recoveryEvidenceIssue: status === 'blocked' && evidence?.integrityState === 'conflicting' ? 'conflict' as const
        : status === 'blocked' && evidence?.integrityState === 'insufficient' ? 'gap' as const : null,
      recovery: status === 'blocked' ? adaptiveRecoveryCopy(recoveryState) : null,
      activity: { id: activity.activityId, status: activity.status, purpose: activity.purpose, reasonCode: activity.reasonCode,
        planRevision: activity.planRevision,
        draftKind: replay.ok && activity.primitivePlan.length === 1 && activity.primitivePlan[0]?.type === 'source_comparison' ? 'source_comparison' as const : null,
        evidenceScope: { version: 'learn-adaptive.canvas-evidence-scope.v1' as const,
          integrityState: status === 'blocked' ? 'blocked' as const : 'accepted' as const,
          sourceRefs: status === 'blocked' ? [] : [...new Set(activity.evidenceReferences.map(reference => String(reference.sourceSnapshotId)))].sort() },
        controls: projectAdaptiveControls({ activityClass: 'factual', activityStatus: status === 'blocked' || !sourceReady ? 'blocked' : activity.status, lifecycle: thread.lifecycle,
          evidenceReady: status !== 'blocked' && sourceReady, sourceCount: new Set(activity.evidenceReferences.map(reference => String(reference.sourceSnapshotId))).size,
          currentTime: thread.availableTime,
          selected: selectedOverride?.option, fixedNextPlan: selectedOverride?.fixedNextPlan, reasonText: activity.reasonText,
          purpose: activity.purpose, reasonCode: activity.reasonCode, sourceState: activity.decisionInputs.sourceState }),
        primitive: status !== 'blocked' && replay.ok ? activity.primitivePlan[0] : null,
        fallback: bodyAuthority ? activity.fallback : { ...activity.fallback, title: 'Evidence unavailable', body: '', primaryAction: { type: 'continue_safe' as const, label: 'Continue' } }, requiredAction: activity.requiredAction },
      session: { studySessionId: session._id, revision: session.revision, contentRevision: content.revision,
        planRecordRevision: plan.recordRevision, blueprintRecordRevision: blueprint.recordRevision,
        scheduledStartAt: session.scheduledStartAt, scheduledEndAt: session.scheduledEndAt ?? null,
        timezone: session.timezone ?? plan.timezone ?? 'UTC' },
      responsePrompt: status === 'blocked' ? null : prompt ?? null,
      savedResponse: savedBodyAvailable && activity.submittedResponse !== undefined && activity.submittedConfidence !== undefined
        ? { response: activity.submittedResponse, confidence: activity.submittedConfidence }
        : null,
    }
}

async function canvasAssessmentScope(ctx: QueryCtx | MutationCtx, userId: string, threadId: Id<'learningThreads'>, validateClaims = true) {
  const thread = await ctx.db.get(threadId)
  const activity = thread?.currentActivityId ? await ctx.db.get(thread.currentActivityId) : null
  const content = activity?.sessionContentId ? await ctx.db.get(activity.sessionContentId) : null
  const session = content ? await ctx.db.get(content.studySessionId) : null
  const opportunityId = session?.assessmentOpportunityId ?? content?.assessmentOpportunityId
  const opportunity = opportunityId ? await ctx.db.get(opportunityId) : null
  if (!thread || !activity || !content || !session || !opportunity
    || [thread, activity, content, session, opportunity].some(row => row.userId !== userId)
    || thread.authorityKind !== 'v2_mission' || thread.deletionStartedAt !== undefined
    || thread.currentActivityId !== activity._id || activity.threadId !== thread._id || activity.activityClass !== 'factual'
    || ['ended', 'replaced', 'blocked'].includes(activity.status) || ['ended', 'rollback'].includes(thread.lifecycle)
    || thread.learningVoidId !== opportunity.learningVoidId || activity.learningVoidId !== opportunity.learningVoidId
    || activity.blueprintRevisionId !== opportunity.blueprintRevisionId || activity.objectiveId !== opportunity.objectiveId
    || content.assessmentOpportunityId !== opportunity._id || session.assessmentOpportunityId !== opportunity._id
    || content.objectiveId !== opportunity.objectiveId || content.blueprintRevisionId !== opportunity.blueprintRevisionId
    || opportunity.contextPins.kind !== 'session' || !await hasAdaptiveExperienceAccess(ctx, userId)) return null
  const pins = opportunity.contextPins
  const canvas = pins.canvas
  if (!canvas || canvas.threadId !== thread._id || canvas.activityId !== activity._id
    || canvas.threadRevision !== thread.revision || canvas.activityRevision !== activity.planRevision
    || canvas.planVersion !== activity.planVersion || canvas.replayVersion !== activity.replayVersion
    || canvas.rendererVersion !== activity.rendererVersion || canvas.evaluationVersion !== activity.evaluationContract.version
    || pins.studySessionId !== session._id || pins.sessionContentId !== content._id
    || pins.contentRevision !== content.revision || pins.contentInputDigest !== content.inputDigest
    || pins.generatorVersion !== content.generatorVersion || pins.studyPlanRevisionId !== session.studyPlanRevisionId
    || pins.studyPlanRevisionId !== content.studyPlanRevisionId) return null
  if (opportunity.assessmentPins.kind === 'measurement') {
    const reference = readAdaptiveAssessmentReference(activity)
    const itemPins = opportunity.assessmentPins.itemPins
    const item = await ctx.db.get(itemPins.itemId)
    if (!reference || reference.assessmentOpportunityId !== opportunity._id || reference.deliveryGrantId !== (opportunity.deliveryGrantId ?? null)
      || reference.item.itemId !== itemPins.itemId || reference.item.itemRevision !== itemPins.itemRevision
      || reference.item.promptDigest !== itemPins.promptDigest || !item || item.userId !== userId
      || await privacyDigest(reference.responseSpec) !== await privacyDigest(item.responseSpec)) return null
    if (!validateClaims) return { thread, activity, content, session, opportunity }
    const claims = await readMeasurementClaims(ctx, userId, itemPins.itemId, 32)
    if (!claims.length || claims.length > 32 || reference.claims.length !== claims.length
      || claims.some((claim, index) => claim.evidenceStatus !== 'available' || claim.invalidatedAt !== undefined
        || reference.claims[index]?.claimId !== claim._id || reference.claims[index]?.revision !== claim.revision
        || reference.claims[index]?.claimDigest !== claim.claimDigest)) return null
  }
  return { thread, activity, content, session, opportunity }
}

async function canvasPilotAllowed(userId: string, scope: NonNullable<Awaited<ReturnType<typeof canvasAssessmentScope>>>) {
  const { opportunity, activity } = scope
  const pins = opportunity.contextPins
  const canvas = pins.kind === 'session' ? pins.canvas : null
  return Boolean(canvas && await canvasPilotDecision(userId, opportunity.scoringBinding, activity.contractVersion,
    activity.evaluationContract.version, canvas.pilotConfigurationVersion))
}

async function savedCanvasCheckForOwner(ctx: QueryCtx | MutationCtx, userId: string, opportunity: Doc<'learnAssessmentOpportunities'>) {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses || opportunity.userId !== userId || !opportunity.submissionId
    || opportunity.contextPins.kind !== 'session' || !opportunity.contextPins.canvas
    || !['measurement_cold', 'measurement_delayed', 'retained_transfer'].includes(opportunity.purpose.kind)) return null
  ctx = measurementReadContext(ctx, userId)
  return await privacyRead(ctx, userId, ['saved-canvas-check', opportunity._id, opportunity.revision], null, async ctx => {
    const response = await ctx.db.get(opportunity.submissionId!)
    if (!response || response.userId !== userId || response.scopeKind !== 'v2' || !('assessmentOpportunityId' in response)
      || response.assessmentOpportunityId !== opportunity._id || response.flow !== 'canvas'
      || response.contextPins.kind !== 'session' || !response.contextPins.canvas
      || opportunity.contextPins.kind !== 'session' || response.contextPins.canvas.threadId !== opportunity.contextPins.canvas?.threadId) return null
    const pins = response.contextPins
    const thread = await ctx.db.get(pins.canvas!.threadId)
    if (!thread || thread.userId !== userId || thread.authorityKind !== 'v2_mission' || thread.deletionStartedAt !== undefined) return null
    const assignment = opportunity.assignmentId ? await ctx.db.get(opportunity.assignmentId) : null
    if (!todayCanvasChecksEnabled() && !isFrozenTodayCanvasAssignment(assignment)) return null
    let body: LearnCanvasCheckReceipt['body'] = { bodyAvailability: 'unavailable', reasonCode: 'evidence_unavailable' }
    let confidence: number | undefined
    try {
      const own = await getLearnResponseStateForOwner(ctx, userId, { assessmentOpportunityId: opportunity._id })
      if (own.status === 'available' && own.work?.submissionId === response._id) { body = own.work.body; confidence = own.work.confidence }
    } catch (error) {
      if (!(error instanceof LearnAccessError)) throw error
    }
    const revoked = ['invalid', 'cancelled', 'abandoned'].includes(opportunity.phase)
      || !assignment || assignment.userId !== userId || assignment.status !== 'admitted'
      || learnAssessmentBoundSurface(assignment.status === 'admitted' ? assignment : null, opportunity.contextPins) !== 'canvas'
      || assignment.evidenceStatus !== 'available' || assignment.invalidatedAt !== undefined
      || opportunity.evidenceStatus !== 'available' || opportunity.invalidatedAt !== undefined
      || response.evidenceStatus !== 'available' || response.invalidatedAt !== undefined
      || response.currentEligibility !== 'eligible' || response.validitySnapshot.status !== 'valid' || !response.validitySnapshot.measurementEligible
      || thread.evidenceState === 'invalidated' || ['ended', 'rollback'].includes(thread.lifecycle)
      || !await hasAdaptiveExperienceAccess(ctx, userId)
    const itemPins = opportunity.assessmentPins.kind === 'measurement' ? learnMeasurementItemPinsSchema.safeParse(opportunity.assessmentPins.itemPins) : null
    const reason = revoked ? 'closed' : await measurementScopeReason(ctx, userId, opportunity)
      ?? (itemPins?.success ? await measurementItemReason(ctx, userId, itemPins.data, opportunity, opportunity.scoringBinding) : 'pins_mismatch')
    let state: LearnCanvasCheckReceipt['state'] = 'closed'
    let result: Extract<LearnCanvasCheckReceipt, { state: 'result_ready' }>['result'] | undefined
    if (!reason) {
      const claimedResult = !!opportunity.authoritativeAttemptId || ['scored_pass', 'scored_fail'].includes(opportunity.phase)
      const attempt = opportunity.authoritativeAttemptId ? await ctx.db.get(opportunity.authoritativeAttemptId) : null
      const committed = attempt?.userId === userId && attempt.submissionId === response._id
        && typeof attempt.scoreCommittedAt === 'number' && Number.isFinite(attempt.scoreCommittedAt) && attempt.scoreCommittedAt >= 0
        && typeof attempt.serverScorePercent === 'number' && Number.isFinite(attempt.serverScorePercent)
        && attempt.serverScorePercent >= 0 && attempt.serverScorePercent <= 100
      let saved: Awaited<ReturnType<typeof readSavedLearnScoringState>> | null = null
      if (!claimedResult || committed) {
        try { saved = await readSavedLearnScoringState(ctx, userId, response._id) }
        catch (error) {
          if (!(error instanceof LearnScoringInputError) && !(error instanceof MeasurementItemBoundsError) && !(error instanceof LearnAccessError)) throw error
        }
      }
      state = opportunity.phase === 'reconciliation_required' ? 'result_unconfirmed'
        : saved?.status === 'scored' ? 'result_ready'
          : claimedResult ? 'result_unconfirmed'
            : saved?.status === 'reconciliation_required' ? 'result_unconfirmed'
              : saved?.status === 'scoring_pending' || saved?.status === 'retryable_failure' ? 'saved_scoring' : 'closed'
      if (state === 'saved_scoring' && opportunity.scoringJobId) {
        const job = await ctx.db.get(opportunity.scoringJobId)
        const limit = ADAPTIVE_V2_PILOT_MANIFEST.limits.maxDispatchAttemptsPerJob
        if (job && (job.attempts ?? 0) >= limit) {
          const executions = await ctx.db.query('learnScoringExecutions').withIndex('by_userId_and_jobId_and_dispatchOrdinal', q =>
            q.eq('userId', userId).eq('jobId', job._id)).take(limit + 1)
          if (executions.length > limit) throw new LearnScoringInputError('Learn execution inventory exceeds its bound')
          const verified = executions.some(row => row.outcome === 'validated' && !row.authoritativeAttemptId)
          if (!verified && job.status !== 'running') state = 'closed'
        }
      }
      if (state === 'result_ready' && saved?.status === 'scored') result = saved.result
    }
    const receipt = learnCanvasCheckReceiptSchema.parse({ version: LEARN_CANVAS_CHECK_RECEIPT_VERSION,
      reference: opportunity.delayedCheckId, state, submissionId: response._id, acceptedAt: response.acceptedAt,
      ...(confidence === undefined ? {} : { confidence }), ...(result === undefined ? {} : { result }), body })
    return { thread, response, opportunity, receipt }
  })
}

async function savedCanvasCheckForThread(ctx: QueryCtx | MutationCtx, userId: string, threadId: Id<'learningThreads'>, reference?: string) {
  if (reference !== undefined && (!reference.length || reference.length > 256)) return null
  const thread = await ctx.db.get(threadId)
  if (!thread || thread.userId !== userId || thread.deletionStartedAt !== undefined || thread.authorityKind !== 'v2_mission') return null
  if (reference !== undefined) {
    const opportunity = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_delayedCheckId', q =>
      q.eq('userId', userId).eq('delayedCheckId', reference)).unique()
    if (opportunity?.contextPins.kind !== 'session' || opportunity.contextPins.canvas?.threadId !== threadId) return null
    return await savedCanvasCheckForOwner(ctx, userId, opportunity)
  }
  const activity = thread.currentActivityId ? await ctx.db.get(thread.currentActivityId) : null
  const content = activity?.userId === userId && activity.sessionContentId ? await ctx.db.get(activity.sessionContentId) : null
  const opportunity = content?.userId === userId && content.assessmentOpportunityId ? await ctx.db.get(content.assessmentOpportunityId) : null
  if (opportunity?.submissionId) return await savedCanvasCheckForOwner(ctx, userId, opportunity)
  const responses = await ctx.db.query('learnResponses').withIndex('by_userId_and_contextPins_canvas_threadId_and_acceptedAt', q =>
    q.eq('userId', userId).eq('contextPins.canvas.threadId', threadId)).order('desc').take(4)
  for (const response of responses) {
    if (!('assessmentOpportunityId' in response)) continue
    const previous = await ctx.db.get(response.assessmentOpportunityId)
    const saved = previous && await savedCanvasCheckForOwner(ctx, userId, previous)
    if (saved) return saved
  }
  return null
}

export async function readCanvasCheckPointerForOwner(ctx: QueryCtx | MutationCtx, userId: string,
  opportunity: Doc<'learnAssessmentOpportunities'>,
  pointerVersion: typeof LEARN_TODAY_CHECK_POINTER_VERSION | typeof LEARN_TODAY_CHECK_POINTER_LEGACY_VERSION = LEARN_TODAY_CHECK_POINTER_LEGACY_VERSION): Promise<LearnTodayCheckPointer | null> {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses || opportunity.userId !== userId || opportunity.contextPins.kind !== 'session'
    || !opportunity.contextPins.canvas || !['measurement_cold', 'measurement_delayed', 'retained_transfer'].includes(opportunity.purpose.kind)) return null
  ctx = measurementReadContext(ctx, userId)
  if (opportunity.submissionId) {
    const saved = await savedCanvasCheckForOwner(ctx, userId, opportunity)
    if (!saved) return null
    const threadId = saved.thread._id
    return learnTodayCheckPointerSchema.parse({ ...await todayCheckLabel(ctx, userId, opportunity, pointerVersion), reference: opportunity.delayedCheckId,
      state: saved.receipt.state, destination: { kind: 'canvas', threadId, route: learnTodayCheckRoute(threadId, opportunity.delayedCheckId) } })
  }
  const assignment = opportunity.assignmentId ? await ctx.db.get(opportunity.assignmentId) : null
  if (!todayCanvasChecksEnabled() && !isFrozenTodayCanvasAssignment(assignment)) return null
  const scope = await canvasAssessmentScope(ctx, userId, opportunity.contextPins.canvas.threadId, false)
  if (!scope || scope.opportunity._id !== opportunity._id || !await canvasPilotAllowed(userId, scope)
    || await measurementScopeReason(ctx, userId, opportunity)) return null
  if (opportunity.assignmentId && (!assignment || assignment.userId !== userId || assignment.status !== 'admitted'
    || learnAssessmentBoundSurface(assignment, opportunity.contextPins) !== 'canvas')) return null
  if (!opportunity.deliveryGrantId && !opportunity.submissionId) {
    const reference = readAdaptiveAssessmentReference(scope.activity)
    if (!reference || reference.deliveryGrantId !== null) return null
    const rebuilt = await composeAdaptiveActivityPlan({ ...storedPlan(scope.activity), replacesActivityId: undefined, primitiveSequence: [], assessmentReference: reference })
    if (rebuilt.inputDigest !== scope.activity.inputDigest || rebuilt.canonicalInputSnapshot !== scope.activity.canonicalInputSnapshot) return null
  } else if (!(await replayAdaptiveActivityPlan(storedPlan(scope.activity))).ok) return null
  let available = opportunity.evidenceStatus === 'available' && opportunity.invalidatedAt === undefined
  if (opportunity.assessmentPins.kind === 'measurement') {
    const pins = opportunity.assessmentPins.itemPins
    const item = await ctx.db.get(pins.itemId)
    const family = await ctx.db.get(pins.familyId)
    const protocol = getFrozenLearnMeasurementProtocol()
    available &&= !!item?.prompt?.trim() && item.status === 'published' && item.evidenceStatus === 'available' && item.invalidatedAt === undefined
      && item.revision === pins.itemRevision && item.promptDigest === pins.promptDigest && item.familyId === pins.familyId
      && item.familyRevision === pins.familyRevision && family?.userId === userId && family.revision === pins.familyRevision
      && family.evidenceStatus === 'available' && family.invalidatedAt === undefined && ['provisional_equivalent', 'empirically_supported'].includes(family.status)
      && assignment?.status === 'admitted' && protocol !== null && assignment.protocolVersion === protocol.version && assignment.epoch === protocol.epoch
      && protocol.flows.includes(assignment.flow)
  }
  if (!available || opportunity.operationalEligibility !== 'eligible' || !['ready', 'test_open'].includes(opportunity.phase)
    || Date.now() < opportunity.openAt || Date.now() >= opportunity.closeAt) return null
  const phase = 'ready' as const
  if (phase === 'ready') {
    const playable = await privacyRead(ctx, userId, ['canvas-check-playable', opportunity._id, opportunity.revision], false, async ctx => {
      if (!LEARN_MEASUREMENT_CAPABILITIES.delivery) return false
      const current = await canvasAssessmentScope(ctx, userId, scope.thread._id)
      if (!current || current.content.status !== 'published' || !current.content.inputDigest || !current.content.generatorVersion
        || !opportunity.deliveryGrantId && current.session.status !== 'ready') return false
      if (opportunity.assessmentPins.kind === 'measurement') {
        const parsed = learnMeasurementItemPinsSchema.safeParse(opportunity.assessmentPins.itemPins)
        if (!parsed.success) return false
        const pins = parsed.data
        const item = await ctx.db.get(pins.itemId)
        if (!item || item.responseSpec.kind !== 'bounded_rubric' || !assessmentPrimitive(item.prompt).ok
          || await measurementItemReason(ctx, userId, pins, opportunity, opportunity.scoringBinding)) return false
      }
      const state = await readLearnAssessmentStateForOwner(ctx, userId, opportunity._id, 'canvas')
      return state.status === 'available' && (opportunity.deliveryGrantId ? state.capabilities.canSubmit : state.capabilities.canDeliver)
    })
    if (!playable) return null
  }
  const threadId = scope.thread._id
  return learnTodayCheckPointerSchema.parse({ ...await todayCheckLabel(ctx, userId, opportunity, pointerVersion), reference: opportunity.delayedCheckId,
    state: phase, destination: { kind: 'canvas', threadId, route: learnTodayCheckRoute(threadId, opportunity.delayedCheckId) } })
}

async function canvasPilotDecision(userId: string, binding: Doc<'learnAssessmentOpportunities'>['scoringBinding'], contractVersion: string, evaluationVersion: string, manifestVersion: string | undefined) {
  return manifestVersion === process.env.LEARN_ADAPTIVE_V2_PILOT_MANIFEST && adaptiveV2PilotDecision(manifestVersion, {
    model: binding.kind === 'model' ? binding.requestedModel : '', now: Date.now(),
    activityContractVersion: contractVersion, evaluationContractVersion: evaluationVersion,
    learnerHash: await privacyDigest(['adaptive-v2-pilot-cohort.v1', userId]),
  }).allowed
}

async function hasCanvasAssessment(ctx: QueryCtx | MutationCtx, userId: string, threadId: Id<'learningThreads'>) {
  const thread = await ctx.db.get(threadId)
  if (thread?.userId !== userId) return false
  const activity = thread.currentActivityId ? await ctx.db.get(thread.currentActivityId) : null
  const content = activity?.userId === userId && activity.sessionContentId ? await ctx.db.get(activity.sessionContentId) : null
  const session = content?.userId === userId ? await ctx.db.get(content.studySessionId) : null
  return Boolean(session?.assessmentOpportunityId || content?.assessmentOpportunityId || session?.assessmentPurpose
    || content?.assessmentPurpose || activity?.reasonCode === 'assessment_check' || LEARN_MEASUREMENT_CAPABILITIES.responses && session?.placementKind === 'retained_review')
}

type LegacyCanvasProjection = NonNullable<Awaited<ReturnType<typeof loadLegacyReadyCanvas>>>
type CanvasProjection = Omit<LegacyCanvasProjection, 'session'> & {
  session: Omit<LegacyCanvasProjection['session'], 'scheduledStartAt' | 'timezone'> & { scheduledStartAt: number | null, timezone: string | null },
  checkReceipt?: LearnCanvasCheckReceipt,
  declaredStimulus?: string | null,
  responseSpec?: Extract<LearnV2AssessmentDelivery, { status: 'delivered' }>['responseSpec'] | null,
  assessment?: { assessmentOpportunityId: Id<'learnAssessmentOpportunities'>, phase: Doc<'learnAssessmentOpportunities'>['phase'], revision: number,
    submissionId: Id<'learnResponses'> | null, bodyAvailability: string, currentEligibility: string,
    reasonCode: string | null, observations?: 'no_observations', checkTiming?: LearnCanvasCheckTiming },
}

function assessmentPrimitive(prompt: string | undefined) {
  return validateAdaptiveActivityPrimitive({ type: 'independent_application', action: 'submit_response',
    props: { prompt, responseFormat: 'short_text', draftPersistence: false } })
}

async function loadSavedCheckCanvas(ctx: QueryCtx | MutationCtx, userId: string, threadId: Id<'learningThreads'>,
  options: { includeSavedResponse?: boolean, checkReference?: string } = {}): Promise<CanvasProjection | null> {
  ctx = measurementReadContext(ctx, userId)
  const saved = await savedCanvasCheckForThread(ctx, userId, threadId, options.checkReference)
  if (!saved) return null
  const { thread, response, opportunity } = saved
  if (response.contextPins.kind !== 'session' || !response.contextPins.canvas) return null
  const pins = response.contextPins
  const [owner, activity, session] = await Promise.all([
    ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique(),
    ctx.db.get(pins.canvas!.activityId), ctx.db.get(pins.studySessionId),
  ])
  if (!owner) return null
  const timing = await canvasCheckTiming(ctx, userId, opportunity)
  const baseReceipt = options.includeSavedResponse === false ? learnCanvasCheckReceiptSchema.parse({
    version: saved.receipt.version, reference: saved.receipt.reference, state: saved.receipt.state,
    submissionId: response._id, acceptedAt: response.acceptedAt,
    ...(saved.receipt.state === 'result_ready' ? { result: saved.receipt.result } : {}),
    body: { bodyAvailability: 'unavailable', reasonCode: 'evidence_unavailable' },
  }) : saved.receipt
  const receipt = learnCanvasCheckReceiptSchema.parse({ ...baseReceipt, ...timing,
    ...(todayCanvasChecksEnabled() ? { postSealReference: { version: LEARN_V2_POST_SEAL_TEACHING_VERSION, assessmentOpportunityId: opportunity._id } } : {}) })
  const status = receipt.state === 'closed' ? 'blocked' as const
    : receipt.state === 'result_unconfirmed' ? 'reconciling' as const
      : receipt.state === 'result_ready' ? 'feedback' as const
        : opportunity.phase === 'scoring_pending' ? 'scoring' as const : 'submitted' as const
  const purpose = 'Complete the assigned check.'
  const ownedActivity = activity?.userId === userId && activity.threadId === threadId ? activity : null
  const ownedSession = session?.userId === userId ? session : null
  const payload = receipt.body.bodyAvailability === 'available' ? receipt.body.payload : null
  const recoverable = receipt.state === 'closed' || receipt.state === 'result_unconfirmed'
  return {
    status, ownerId: owner._id, checkReceipt: receipt,
    thread: { id: thread._id, outcome: 'Assigned check', intent: thread.intent, revision: thread.revision },
    recoveryState: receipt.state === 'closed' ? 'invalidated' : null, recoveryEvidenceIssue: null, recovery: null,
    activity: { id: ownedActivity?.activityId ?? String(pins.canvas!.activityId), status: 'blocked', purpose, reasonCode: 'assessment_check',
      planRevision: pins.canvas!.activityRevision, draftKind: null,
      evidenceScope: { version: 'learn-adaptive.canvas-evidence-scope.v1', integrityState: 'blocked', sourceRefs: [] },
      controls: projectAdaptiveControls({ activityClass: 'factual', activityStatus: 'blocked', lifecycle: thread.lifecycle,
        evidenceReady: false, sourceCount: 0, currentTime: thread.availableTime, purpose, reasonCode: 'assessment_check', sourceState: 'blocked' }),
      primitive: null,
      fallback: { version: 'learn-adaptive.text-card-fallback.v1', kind: 'text_card', testId: 'learn-activity-fallback',
        title: 'Assigned check', body: '', primaryAction: { type: 'continue_safe', label: 'Continue' } },
      requiredAction: { kind: 'submit_response', label: 'Submit response' } },
    session: { studySessionId: pins.studySessionId, revision: ownedSession?.revision ?? pins.sessionRevision,
      contentRevision: pins.contentRevision, planRecordRevision: pins.planRecordRevision, blueprintRecordRevision: response.blueprintRecordRevision,
      scheduledStartAt: ownedSession?.scheduledStartAt ?? null, scheduledEndAt: ownedSession?.scheduledEndAt ?? null, timezone: ownedSession?.timezone ?? null },
    responsePrompt: null, declaredStimulus: null, responseSpec: null,
    savedResponse: receipt.confidence !== undefined && (payload?.kind === 'text' || payload?.kind === 'source_comparison')
      ? { response: payload.kind === 'text' ? payload.text : encodeSourceComparisonResponse(payload.sourceRef, payload.comparison), confidence: receipt.confidence } : null,
    ...(!recoverable ? { assessment: { assessmentOpportunityId: opportunity._id, phase: opportunity.phase, revision: opportunity.revision,
      submissionId: response._id, bodyAvailability: receipt.body.bodyAvailability, currentEligibility: response.currentEligibility, reasonCode: null, ...timing } } : {}),
  }
}

async function loadAssessmentCanvas(ctx: QueryCtx | MutationCtx, userId: string, threadId: Id<'learningThreads'>, options: { includeSavedResponse?: boolean }): Promise<CanvasProjection | null> {
  const scope = await canvasAssessmentScope(ctx, userId, threadId)
  if (!scope) return null
  const { thread, activity, session, content, opportunity } = scope
  const owner = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique()
  if (!owner) return null
  const replay = await replayAdaptiveActivityPlan(storedPlan(activity))
  const allowed = LEARN_MEASUREMENT_CAPABILITIES.responses && replay.ok && await canvasPilotAllowed(userId, scope)
  const assessment: LearnV2AssessmentDelivery | null = allowed ? await readLearnAssessmentForOwner(ctx, userId, opportunity._id, 'canvas') : null
  const delivered = assessment?.status === 'delivered' && assessment.responseSpec.kind === 'bounded_rubric' ? assessment : null
  const state = options.includeSavedResponse !== false && allowed
    ? await getLearnResponseStateForOwner(ctx, userId, { assessmentOpportunityId: opportunity._id }) : null
  const work = state?.status === 'available' ? state.work : null
  const payload = work?.body.bodyAvailability === 'available' ? work.body.payload : null
  const primitive = delivered ? assessmentPrimitive(delivered.prompt) : null
  const status = !delivered || !primitive?.ok ? 'blocked' as const
    : opportunity.phase === 'test_open' ? 'started' as const
      : opportunity.phase === 'scored_pass' || opportunity.phase === 'scored_fail' ? 'feedback' as const
        : opportunity.phase === 'reconciliation_required' ? 'reconciling' as const
          : opportunity.phase === 'scoring_pending' ? 'scoring' as const
            : opportunity.submissionId ? 'submitted' as const : 'blocked' as const
  const purpose = 'Complete the assigned check.'
  return {
    status, ownerId: owner._id,
    thread: { id: thread._id, outcome: 'Assigned check', intent: thread.intent, revision: thread.revision },
    recoveryState: status === 'blocked' ? 'blocked' as const : null, recoveryEvidenceIssue: null,
    recovery: status === 'blocked' ? adaptiveRecoveryCopy('blocked') : null,
    activity: { id: activity.activityId, status: activity.status, purpose, reasonCode: 'assessment_check', planRevision: activity.planRevision,
      draftKind: null,
      evidenceScope: { version: 'learn-adaptive.canvas-evidence-scope.v1' as const, integrityState: status === 'blocked' ? 'blocked' as const : 'accepted' as const, sourceRefs: [] as string[] },
      controls: projectAdaptiveControls({ activityClass: 'factual', activityStatus: 'blocked', lifecycle: thread.lifecycle,
        evidenceReady: false, sourceCount: 0, currentTime: thread.availableTime, purpose, reasonCode: 'assessment_check', sourceState: 'blocked' }),
      primitive: status !== 'blocked' && primitive?.ok ? primitive.value : null,
      fallback: { version: 'learn-adaptive.text-card-fallback.v1' as const, kind: 'text_card' as const,
        testId: 'learn-activity-fallback' as const, title: 'Assigned check', body: '', primaryAction: { type: 'continue_safe' as const, label: 'Continue' } },
      requiredAction: { kind: 'submit_response' as const, label: 'Submit response' } },
    session: { studySessionId: session._id, revision: session.revision, contentRevision: content.revision,
      planRecordRevision: opportunity.contextPins.kind === 'session' ? opportunity.contextPins.planRecordRevision : 1, blueprintRecordRevision: opportunity.blueprintRecordRevision,
      scheduledStartAt: session.scheduledStartAt, scheduledEndAt: session.scheduledEndAt ?? null, timezone: session.timezone ?? 'UTC' },
    responsePrompt: delivered?.prompt ?? null, declaredStimulus: delivered?.declaredStimulus ?? null, responseSpec: delivered?.responseSpec ?? null,
    savedResponse: work?.confidence !== undefined && (payload?.kind === 'text' || payload?.kind === 'source_comparison')
      ? { response: payload.kind === 'text' ? payload.text : encodeSourceComparisonResponse(payload.sourceRef, payload.comparison), confidence: work.confidence } : null,
    assessment: { assessmentOpportunityId: opportunity._id, phase: opportunity.phase, revision: opportunity.revision,
      ...await canvasCheckTiming(ctx, userId, opportunity),
      submissionId: opportunity.submissionId ?? null, bodyAvailability: work?.body.bodyAvailability ?? 'unavailable',
      currentEligibility: work?.currentEligibility ?? 'unknown', reasonCode: delivered ? opportunity.reasonCode ?? null : 'not_admitted',
      ...(delivered ? {} : { observations: 'no_observations' as const }) },
  }
}

export async function loadReadyCanvas(ctx: QueryCtx | MutationCtx, userId: string, threadId: Id<'learningThreads'>, options: { includeSavedResponse?: boolean, checkReference?: string } = {}): Promise<CanvasProjection | null> {
  if (LEARN_MEASUREMENT_CAPABILITIES.responses) {
    const saved = await loadSavedCheckCanvas(ctx, userId, threadId, options)
    if (saved) return saved
  }
  if (options.checkReference !== undefined) {
    const scope = await canvasAssessmentScope(ctx, userId, threadId, false)
    if (scope?.opportunity.delayedCheckId !== options.checkReference) return null
  }
  if (await hasCanvasAssessment(ctx, userId, threadId)) return await loadAssessmentCanvas(ctx, userId, threadId, options)
  return await loadLegacyReadyCanvas(ctx, userId, threadId, options)
}

async function savedCanvasOwner(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity || await hasAccountDeletionTombstone(ctx, identity.tokenIdentifier)) return null
  return identity.tokenIdentifier
}

const getCanvasRead = defineTeachingRead({name:'learnAdaptiveCanvas.getCanvas',scope:async(ctx,userId,args)=>await teachingReadScope(ctx,userId,[{kind:'thread',id:args.threadId}]),
  args: canvasCheckReadArgs,
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveQueryAccess(ctx)
    return await loadReadyCanvas(createResponsePrivacyReadContext(ctx, userId).ctx, userId, args.threadId, args)
  },
}, {hasContent:value=>Boolean(value?.activity.primitive)})
export const getCanvas = query({ ...getCanvasRead.query, handler: async (ctx, args) => {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return await getCanvasRead.query.handler(ctx, args)
  const ownerId = await savedCanvasOwner(ctx)
  const saved = ownerId ? await loadSavedCheckCanvas(ctx, ownerId, args.threadId, args) : null
  if (saved) return saved
  const userId = await requireAdaptiveQueryAccess(ctx)
  if (await hasCanvasAssessment(ctx, userId, args.threadId)) return await loadReadyCanvas(ctx, userId, args.threadId, args)
  return await getCanvasRead.query.handler(ctx, args)
} })
export const getCanvasDelivery = mutation({ ...getCanvasRead.delivery, handler: async (ctx, args) => {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return await getCanvasRead.delivery.handler(ctx, args)
  const ownerId = await savedCanvasOwner(ctx)
  const saved = ownerId ? await loadSavedCheckCanvas(ctx, ownerId, args.threadId, args) : null
  if (saved) return { admission: { version: 'learn-v2.help-admission.v1' as const, status: 'ordinary' as const }, value: saved }
  const userId = await requireAdaptiveMutationAccess(ctx)
  if (await hasCanvasAssessment(ctx, userId, args.threadId)) return {
    admission: { version: 'learn-v2.help-admission.v1' as const, status: 'ordinary' as const },
    value: await loadReadyCanvas(ctx, userId, args.threadId, args),
  }
  return await getCanvasRead.delivery.handler(ctx, args)
} })

const renderFailureReasonValidator = v.union(
  v.literal('unknown_primitive'), v.literal('unsupported_action'), v.literal('renderer_unavailable'), v.literal('oversized_prop'),
  v.literal('oversized_plan'), v.literal('unsafe_url'), v.literal('executable_content'),
  v.literal('invalid_props'), v.literal('invalid_evidence_link'),
)

// Rendering telemetry is scoped to an owned current activity and contains only
// a closed validation code. It does not change the activity or scoring state.
export const reportRenderFailure = mutation({
  args: { threadId: v.id('learningThreads'), activityId: v.string(), expectedPlanRevision: v.number(), reasonCode: renderFailureReasonValidator },
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveMutationAccess(ctx)
    const thread = await ctx.db.get(args.threadId)
    const activity = thread?.currentActivityId && await ctx.db.get(thread.currentActivityId)
    if (!thread || thread.userId !== userId || thread.deletionStartedAt !== undefined
      || !activity || activity.userId !== userId || activity.threadId !== thread._id
      || activity.activityId !== args.activityId || activity.planRevision !== args.expectedPlanRevision) {
      throw new Error('Current Canvas render authority is unavailable')
    }
    const result = await writeLearnActivityEvent(ctx, {
      userId, threadId: thread._id, activityId: activity._id,
      eventType: 'canvas_render_failure', eventVersion: 'canvas_render_failure.v1',
      sourceVersion: ADAPTIVE_ACTIVITY_VALIDATION_ANALYTICS_VERSION,
      contractVersion: activity.contractVersion,
      semanticKey: `activity:${String(activity._id)}:plan:${activity.planRevision}:render:${args.reasonCode}`,
      occurredAt: Date.now(), reasonCode: args.reasonCode, outcomeCode: 'fallback_rendered',
      metadata: { activityClass: activity.activityClass, boundaryOrdinal: activity.boundaryOrdinal, planRevision: activity.planRevision },
    })
    return { recorded: !result.replayed }
  },
})

export const submitCanvasResponse = mutation({
  args: { threadId: v.id('learningThreads'), activityId: v.string(), studySessionId: v.id('studySessions'), expectedSessionRevision: v.number(), expectedRevision: v.number(), response: v.string(), confidence: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    if (LEARN_MEASUREMENT_CAPABILITIES.responses) return await acceptCanvasSubmission(ctx, args)
    const canonicalResponse = args.response.trim()
    if (!canonicalResponse || canonicalResponse.length > 12_000 || !Number.isInteger(args.confidence) || args.confidence < 1 || args.confidence > 5) throw new Error('Canvas response is invalid')
    const responseHash = `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalResponse)))).map(byte => byte.toString(16).padStart(2, '0')).join('')}`
    return await executeAdaptiveThreadCommand(ctx, {
      threadId: args.threadId, expectedRevision: args.expectedRevision, idempotencyKey: args.idempotencyKey,
      commandName: 'submitCanvasResponse',
      payload: { activityId: args.activityId, studySessionId: String(args.studySessionId), expectedSessionRevision: args.expectedSessionRevision, responseHash, confidence: args.confidence },
      apply: async (commandCtx, thread, userId) => {
        const activity = thread.currentActivityId && await commandCtx.db.get(thread.currentActivityId)
        const content = activity?.sessionContentId && await commandCtx.db.get(activity.sessionContentId)
        const session = await commandCtx.db.get(args.studySessionId)
        const plan = session && await commandCtx.db.get(session.studyPlanRevisionId)
        const stablePlan = plan && await commandCtx.db.get(plan.studyPlanId)
        const learningVoid = plan && await commandCtx.db.get(plan.learningVoidId)
        const blueprint = plan?.blueprintRevisionId && await commandCtx.db.get(plan.blueprintRevisionId)
        if (!activity || activity.userId !== userId || activity.threadId !== thread._id || activity.activityId !== args.activityId
          || activity.status !== 'started' || activity.evaluationContract.kind !== 'server_scored'
          || !content || content.studySessionId !== args.studySessionId || !session || session.userId !== userId
          || session.status !== 'in_progress' || session.revision !== args.expectedSessionRevision
          || session.startedSessionContentId !== content._id || session.startedSessionContentRevision !== content.revision
          || !plan || !stablePlan || !learningVoid || !blueprint
          || thread.authorityKind !== 'v2_mission' || thread.learningVoidId !== learningVoid._id
          || activity.learningVoidId !== learningVoid._id
          || plan.userId !== userId || learningVoid.userId !== userId || blueprint.userId !== userId
          || stablePlan.activeRevisionId !== plan._id || plan.status !== 'accepted' || blueprint.status !== 'accepted'
          || plan.blueprintRecordRevision !== blueprint.recordRevision || activity.blueprintRevisionId !== blueprint._id
          || content.studyPlanRevisionId !== plan._id || content.blueprintRevisionId !== blueprint._id
          || !(await hasLearnActivityEvent(commandCtx, userId, activity._id, 'activity_started'))) throw new Error('Started Canvas activity is unavailable')
        await requireActiveBlueprint(commandCtx, userId, learningVoid, blueprint._id)
        if (activity.evidenceReferences.length < 1 || activity.generationInputs.sessionContentRevision !== content.revision
          || (await loadAdaptiveClaimProjection(commandCtx, { userId, historical: false, sessionContentId: content._id, sessionContentRevision: content.revision, evidenceReferences: activity.evidenceReferences })).integrityState !== 'accepted'
          || !(await isLearnV2ContentEvidenceReady(commandCtx, userId, content, learningVoid._id))) throw new Error('Started Canvas evidence is unavailable')
        const primitive = activity.primitivePlan[0]
        if (primitive?.type === 'source_comparison') {
          const pinnedSourceRefs = new Set(activity.evidenceReferences.map(reference => String(reference.sourceSnapshotId)))
          const evidenceContext = Object.fromEntries([...pinnedSourceRefs].map(sourceRef => [sourceRef, { integrityState: 'accepted' as const }]))
          const validated = validateAdaptiveActivityPrimitive({ type: primitive.type, action: primitive.action,
            props: { prompt: primitive.props.prompt, sources: primitive.props.sources.map(source => ({ sourceRef: source.sourceRef, label: source.label, summary: source.summary })) } }, evidenceContext)
          if (activity.primitivePlan.length !== 1 || !validated.ok || validated.value.type !== 'source_comparison'
            || primitive.props.sources.some(source => source.integrityState !== 'accepted')
            || validated.value.props.sources.some(source => !pinnedSourceRefs.has(source.sourceRef))
            || !decodeSourceComparisonResponse(canonicalResponse, validated.value.props.sources.map(source => source.sourceRef))) {
            throw new Error('Source comparison response is invalid')
          }
        }
        else if (primitive?.type === 'independent_application') {
          const validated = validateAdaptiveActivityPrimitive({ type: primitive.type, action: primitive.action, props: primitive.props })
          const blocks = await commandCtx.db.query('sessionContentBlocks')
            .withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(17)
          const prompt = blocks.length <= 16 ? blocks.find(block => block.kind === 'independent_application')?.content?.trim() : null
          if (activity.primitivePlan.length !== 1 || !validated.ok || validated.value.type !== 'independent_application'
            || validated.value.action !== 'submit_response' || activity.requiredAction.kind !== 'submit_response'
            || validated.value.props.prompt !== prompt) throw new Error('Independent application response is invalid')
        }
        const now = Date.now()
        await commandCtx.db.patch(activity._id, {
          status: 'submitted', submittedResponse: canonicalResponse, submittedConfidence: args.confidence, updatedAt: now,
        })
        const revision = thread.revision + 1
        await commandCtx.db.patch(thread._id, { revision, lifecycle: 'active', updatedAt: now })
        return { value: { status: 'submitted' as const, activityId: activity.activityId }, revision }
      },
    })
  },
})

type CanvasSubmissionRequest = {
  threadId: Id<'learningThreads'>, activityId: string, studySessionId: Id<'studySessions'>,
  expectedSessionRevision: number, expectedRevision: number, response: string, confidence: number, idempotencyKey: string,
}

async function acceptCanvasSubmission(ctx: MutationCtx, args: CanvasSubmissionRequest) {
  const userId = await requireAdaptiveMutationAccess(ctx)
  ctx = measurementReadContext(ctx, userId)
  await prepareAdaptiveCommand({ userId, commandName: 'submitCanvasResponse', targetId: String(args.threadId),
    expectedRevision: args.expectedRevision, idempotencyKey: args.idempotencyKey, payload: {} })
  const scope = await canvasAssessmentScope(ctx, userId, args.threadId)
  const prior = scope?.opportunity.submissionId ? await ctx.db.get(scope.opportunity.submissionId) : null
  const acceptedSessionRevision = prior?.scopeKind === 'v2' && prior.contextPins.kind === 'session'
    && prior.contextPins.canvas?.threadId === args.threadId ? prior.contextPins.sessionRevision : null
  if (!scope || scope.activity.activityId !== args.activityId || scope.session._id !== args.studySessionId
    || scope.thread.revision !== args.expectedRevision || scope.session.revision !== args.expectedSessionRevision && acceptedSessionRevision !== args.expectedSessionRevision
    || scope.activity.evaluationContract.kind !== 'server_scored' || !await canvasPilotAllowed(userId, scope)
    || !(await replayAdaptiveActivityPlan(storedPlan(scope.activity))).ok) {
    return { kind: 'rejected' as const, version: LEARN_V2_RESPONSE_CONTRACT_VERSION, reasonCode: 'unavailable' as const }
  }
  const { opportunity, activity } = scope
  const delivery = await readLearnAssessmentForOwner(ctx, userId, opportunity._id, 'canvas')
  if (delivery.status !== 'delivered') return { kind: 'rejected' as const, version: LEARN_V2_RESPONSE_CONTRACT_VERSION, reasonCode: 'evidence_unavailable' as const }
  if (prior) {
    const state = await getLearnResponseStateForOwner(ctx, userId, { assessmentOpportunityId: opportunity._id })
    if (state.status !== 'available' || state.work?.body.bodyAvailability !== 'available') return { kind: 'rejected' as const, version: LEARN_V2_RESPONSE_CONTRACT_VERSION, reasonCode: 'evidence_unavailable' as const }
  }
  let payload: LearnResponsePayload = { kind: 'text', text: args.response }
  const primitive = activity.primitivePlan[0]
  if (primitive?.type === 'source_comparison') {
    const sourceRefs = primitive.props.sources.map(source => source.sourceRef)
    const evidenceRefs = new Set(activity.evidenceReferences.map(row => String(row.sourceSnapshotId)))
    const decoded = decodeSourceComparisonResponse(args.response, sourceRefs)
    if (!decoded || activity.primitivePlan.length !== 1 || sourceRefs.some(ref => !evidenceRefs.has(ref))) {
      return { kind: 'rejected' as const, version: LEARN_V2_RESPONSE_CONTRACT_VERSION, reasonCode: 'invalid_payload' as const }
    }
    payload = { kind: 'source_comparison', sourceRef: decoded.sourceRef, comparison: decoded.rationale }
  }
  if (opportunity.assessmentPins.kind === 'measurement') {
    const item = await ctx.db.get(opportunity.assessmentPins.itemPins.itemId)
    if (item?.responseSpec.kind !== 'bounded_rubric') return { kind: 'rejected' as const, version: LEARN_V2_RESPONSE_CONTRACT_VERSION, reasonCode: 'invalid_payload' as const }
  }
  const receipt = await acceptMasterySubmissionForOwner(ctx, userId, { submission: {
    version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: args.idempotencyKey,
    response: { target: { assessmentOpportunityId: opportunity._id },
      expectedRevision: prior?.masteryAtAcceptance?.opportunityRevision ?? opportunity.revision,
      payload,
      ...(opportunity.deliveryPins?.confidenceRequested ? { confidence: args.confidence } : {}) },
  } })
  if (receipt.kind === 'accepted' && !opportunity.authoritativeAttemptId) {
    await ctx.db.patch(activity._id, { status: opportunity.phase === 'reconciliation_required' ? 'reconciling' : 'submitted',
      submittedResponse: undefined, submittedConfidence: undefined, updatedAt: Date.now() })
  }
  return receipt
}

const canvasSubmissionArgs = { threadId: v.id('learningThreads'), activityId: v.string(), submissionId: v.id('learnResponses') }

export const getCanvasSubmissionAuthority = internalQuery({
  args: canvasSubmissionArgs,
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveQueryAccess(ctx)
    if (!LEARN_MEASUREMENT_CAPABILITIES.responses) throw new Error('Canvas submissions are disabled')
    const scope = await canvasAssessmentScope(ctx, userId, args.threadId)
    if (!scope || scope.activity.activityId !== args.activityId || scope.opportunity.submissionId !== args.submissionId
      || !await canvasPilotAllowed(userId, scope) || !(await replayAdaptiveActivityPlan(storedPlan(scope.activity))).ok) throw new Error('Canvas submission is unavailable')
    return { phase: scope.opportunity.phase, replayed: Boolean(scope.opportunity.authoritativeAttemptId) }
  },
})

export const recordCanvasSubmissionOutcome = internalMutation({
  args: canvasSubmissionArgs,
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveMutationAccess(ctx)
    if (!LEARN_MEASUREMENT_CAPABILITIES.responses) throw new Error('Canvas submissions are disabled')
    const scope = await canvasAssessmentScope(ctx, userId, args.threadId)
    if (!scope || scope.activity.activityId !== args.activityId || scope.opportunity.submissionId !== args.submissionId
      || !await canvasPilotAllowed(userId, scope)) throw new Error('Canvas submission is unavailable')
    const { opportunity, activity } = scope
    const attempt = opportunity.authoritativeAttemptId ? await ctx.db.get(opportunity.authoritativeAttemptId) : null
    if (attempt && (attempt.userId !== userId || attempt.submissionId !== args.submissionId
      || attempt.assessmentOpportunityId !== opportunity._id || attempt.studySessionId !== scope.session._id
      || attempt.sessionContentId !== scope.content._id)) throw new Error('Canvas result is unavailable')
    // Ordinary score commit completes the session once. Preserve the sealed
    // response's acceptance pins while keeping its current delivery anchor live.
    if (attempt && opportunity.contextPins.kind === 'session' && scope.session.status === 'completed'
      && scope.session.revision === opportunity.contextPins.sessionRevision + 1) {
      await ctx.db.patch(opportunity._id, { contextPins: { ...opportunity.contextPins, sessionRevision: scope.session.revision } })
    }
    await ctx.db.patch(activity._id, { status: attempt ? 'feedback' : opportunity.phase === 'reconciliation_required' ? 'reconciling'
      : opportunity.phase === 'scoring_pending' ? 'scoring' : 'submitted',
      ...(attempt ? { masteryAttemptId: attempt._id } : {}), updatedAt: Date.now() })
    return null
  },
})
