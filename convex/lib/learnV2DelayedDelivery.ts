import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { LEARN_MEASUREMENT_CAPABILITIES } from '../../shared/learn-v2-measurement-storage-manifest'
import { ADAPTIVE_ASSESSMENT_PLAN_VERSION, composeAdaptiveActivityPlan } from '../../shared/learn-adaptive-activity-plan'
import { adaptiveV2PilotDecision } from '../../shared/adaptive-v2-pilot-policy'
import { isLearnRetainedPromotionTimeEligible } from '../../shared/learn-v2-delayed-check'
import { learnMeasurementItemPinsSchema } from '../../shared/learn-v2-measurement'
import { getFrozenLearnMeasurementProtocol, measurementWindowPolicyDigest } from './learnV2MeasurementAssignment'
import { measurementCaseExposed, measurementFlowReason, measurementItemReason, measurementScopeReason, writeMeasurementOpportunityFact, type AdmittedAssignment } from './learnV2Measurement'
import { requireMeasurementCapability } from './learnV2MeasurementItems'
import { materializeLearnMeasurementAssignment } from './learnV2MeasurementDueWork'
import { masteryScopeKey } from './learnV2MasteryScope'
import { privacyDigest } from './learnV2ResponsePrivacy'
import { measurementAllocationMatches } from './learnV2MeasurementAllocation'
import { hasLearnReflowPlanAuthority, LEARN_DELAYED_DELIVERY_VERSION } from './learnV2FixedChecks'

const VERSION = LEARN_DELAYED_DELIVERY_VERSION
type Binding = { kind: 'ready', sessionId: Id<'studySessions'>, scheduledStartAt: number } | { kind: 'blocked', reasonCode: string }

export async function readLearnDelayedCheckBinding(ctx: MutationCtx | QueryCtx, userId: string, row: Doc<'learnAssessmentOpportunities'>,
  current?: Doc<'studySessions'>) {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses || row.userId !== userId || row.purpose.kind !== 'measurement_delayed'
    || row.contextPins.kind !== 'session' || row.contextPins.generatorVersion !== VERSION) return null
  const session = current ?? await ctx.db.get(row.contextPins.studySessionId)
  if (!session || session.userId !== userId || session._id !== row.contextPins.studySessionId
    || session.assessmentOpportunityId !== row._id || session.assessmentPurpose !== 'measurement_delayed'
    || session.studyPlanRevisionId !== row.contextPins.studyPlanRevisionId || session.primaryObjectiveId !== row.objectiveId
    || session.startedSessionContentId !== undefined && (session.startedSessionContentId !== row.contextPins.sessionContentId
      || session.startedSessionContentRevision !== row.contextPins.contentRevision)
    || session.revision !== row.contextPins.sessionRevision) return null
  const content = await ctx.db.get(row.contextPins.sessionContentId)
  if (!content || content.userId !== userId || content.studySessionId !== session._id || content.assessmentOpportunityId !== row._id
    || content.studyPlanRevisionId !== row.contextPins.studyPlanRevisionId || content.blueprintRevisionId !== row.blueprintRevisionId || content.objectiveId !== row.objectiveId
    || content.assessmentPurpose !== 'measurement_delayed' || content.generatorVersion !== VERSION
    || content.revision !== row.contextPins.contentRevision || content.inputDigest !== row.contextPins.contentInputDigest) return null
  return { session, content }
}

export async function finalizeLearnDelayedCheckSession(ctx: MutationCtx, userId: string, row: Doc<'learnAssessmentOpportunities'>,
  current?: Doc<'studySessions'>): Promise<'completed' | 'missed' | 'cancelled' | null> {
  const now = Date.now()
  const status = row.submissionId ? 'completed' : ['invalid', 'cancelled'].includes(row.phase) ? 'cancelled'
    : row.phase === 'abandoned' || now >= row.closeAt ? 'missed' : null
  if (!status) return null
  const binding = await readLearnDelayedCheckBinding(ctx, userId, row, current)
  if (!binding || !['planned', 'ready', 'in_progress', 'blocked', 'generation_failed'].includes(binding.session.status)) return null
  const { session } = binding
  // Operational closure keeps the accepted content and assistance revision pinned.
  await ctx.db.patch(session._id, { status, ...(status === 'missed' ? { missedAt: now, auditReasonCode: 'session_expired' }
    : status === 'cancelled' ? { auditReasonCode: row.reasonCode ?? 'assessment_unavailable' } : {}) })
  return status
}

export async function bindLearnDelayedCheck(ctx: MutationCtx, assignment: AdmittedAssignment, row: Doc<'learnAssessmentOpportunities'>,
  target?: Doc<'studySessions'>): Promise<Binding> {
  const blocked = (reasonCode: string): Binding => ({ kind: 'blocked', reasonCode })
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses || !LEARN_MEASUREMENT_CAPABILITIES.delivery || !LEARN_MEASUREMENT_CAPABILITIES.enrollment) return blocked('disabled')
  const protocol = getFrozenLearnMeasurementProtocol()
  if (!protocol) return blocked('protocol_not_frozen')
  if (assignment.evidenceStatus !== 'available' || assignment.invalidatedAt !== undefined) return blocked('evidence_unavailable')
  if (assignment.protocolVersion !== protocol.version || assignment.epoch !== protocol.epoch
    || assignment.windowPolicyDigest !== await measurementWindowPolicyDigest(protocol)) return blocked('protocol_not_frozen')
  if (row.userId !== assignment.userId || row.assignmentId !== assignment._id || row.purpose.kind !== 'measurement_delayed'
    || row.assessmentPins.kind !== 'measurement' || row.contextPins.kind === 'calibration') return blocked('pins_mismatch')
  if (row.horizonDays !== row.purpose.horizonDays || row.openAt !== row.purpose.clock.openAt || row.closeAt !== row.purpose.clock.closeAt
    || row.dueAt !== row.purpose.clock.dueAt || !await measurementAllocationMatches(ctx, assignment.userId, row, assignment)) return blocked('pins_mismatch')
  const userId = assignment.userId
  try { await requireMeasurementCapability(ctx, userId) } catch { return blocked('unknown_history') }
  const reason = await measurementScopeReason(ctx, userId, row)
    ?? await measurementFlowReason(ctx, userId, assignment.flow, row, protocol)
    ?? await measurementItemReason(ctx, userId, learnMeasurementItemPinsSchema.parse(row.assessmentPins.itemPins), row, row.scoringBinding)
    ?? (await measurementCaseExposed(ctx, userId, row.assessmentPins.itemPins.caseId, row._id) ? 'novel_item_unavailable' : null)
  if (reason) return blocked(reason)
  if (row.submissionId || ['invalid', 'abandoned', 'cancelled'].includes(row.phase)) return blocked(row.reasonCode ?? 'assessment_unavailable')
  const existing = row.contextPins.kind === 'session' ? await ctx.db.get(row.contextPins.studySessionId) : null
  const priorContent = row.contextPins.kind === 'session' ? await ctx.db.get(row.contextPins.sessionContentId) : null
  if (row.contextPins.kind === 'session' && existing?.userId === userId && existing.assessmentOpportunityId === row._id && priorContent?.assessmentOpportunityId === row._id) {
    if (!['ready', 'in_progress'].includes(existing.status) || priorContent.status !== 'published'
      || existing.revision !== row.contextPins.sessionRevision || priorContent.revision !== row.contextPins.contentRevision
      || priorContent.inputDigest !== row.contextPins.contentInputDigest || priorContent.generatorVersion !== row.contextPins.generatorVersion) return blocked('pins_mismatch')
    return { kind: 'ready', sessionId: existing._id, scheduledStartAt: existing.scheduledStartAt }
  }
  if (row.deliveryGrantId) return blocked('disclosure_unknown')
  const item = (await ctx.db.get(row.assessmentPins.itemPins.itemId))!
  if (assignment.flow === 'v2_canvas' && (item.responseSpec.kind !== 'bounded_rubric' || row.contextPins.kind !== 'session' || !row.contextPins.canvas)) return blocked('response_format_unavailable')
  if (assignment.flow === 'v2_canvas') {
    const canvas = row.contextPins.kind === 'session' ? row.contextPins.canvas : null
    if (!canvas || canvas.pilotConfigurationVersion !== process.env.LEARN_ADAPTIVE_V2_PILOT_MANIFEST
      || !adaptiveV2PilotDecision(canvas.pilotConfigurationVersion, { model: row.scoringBinding.kind === 'model' ? row.scoringBinding.requestedModel : '', now: Date.now(),
        activityContractVersion: 'learn-adaptive.activity-contract.v1', evaluationContractVersion: 'learn-adaptive.evaluation.v1',
        learnerHash: await privacyDigest(['adaptive-v2-pilot-cohort.v1', userId]) }).allowed) return blocked('canvas_not_admitted')
  }
  if (target && (target.userId !== userId || target.primaryObjectiveId !== row.objectiveId
    || target.placementKind !== 'retained_review' || !['planned', 'blocked'].includes(target.status))) return blocked('pins_mismatch')
  if (target && target.studyPlanRevisionId !== row.contextPins.studyPlanRevisionId) {
    const [sourcePlan, targetPlan] = await Promise.all([ctx.db.get(row.contextPins.studyPlanRevisionId), ctx.db.get(target.studyPlanRevisionId)])
    const root = targetPlan && await ctx.db.get(targetPlan.studyPlanId)
    if (!sourcePlan || !targetPlan || targetPlan.userId !== userId || targetPlan.status !== 'accepted'
      || sourcePlan.studyPlanId !== targetPlan.studyPlanId || root?.activeRevisionId !== targetPlan._id
      || !await hasLearnReflowPlanAuthority(ctx, userId, sourcePlan, row.contextPins.planRecordRevision)) return blocked('pins_mismatch')
    target = undefined
  }
  const now = Date.now()
  const sessionId = target?._id ?? await ctx.db.insert('studySessions', { userId, studyPlanRevisionId: row.contextPins.studyPlanRevisionId,
    primaryObjectiveId: row.objectiveId, status: 'ready', revision: 1, scheduledStartAt: row.openAt, scheduledEndAt: row.closeAt,
    timezone: row.purpose.clock.timezone, placementKind: 'review', schedulingPriority: 'due_review', schedulerVersion: VERSION })
  const sessionRevision = target ? target.revision + 1 : 1
  const inputDigest = await privacyDigest([VERSION, row._id, row.assessmentPins.itemPins, sessionId, assignment.flow])
  const contentId = await ctx.db.insert('sessionContent', { userId, studySessionId: sessionId, studyPlanRevisionId: row.contextPins.studyPlanRevisionId,
    blueprintRevisionId: row.blueprintRevisionId, objectiveId: row.objectiveId, revision: 1, status: 'published', inputDigest,
    generatorVersion: VERSION, providerModel: priorContent?.providerModel, assessmentPurpose: 'measurement_delayed', assessmentOpportunityId: row._id,
    createdAt: now, publishedAt: now })
  const contextPins = { kind: 'session' as const, studyPlanId: row.contextPins.studyPlanId, studyPlanRevisionId: row.contextPins.studyPlanRevisionId,
    planRevision: row.contextPins.planRevision, planRecordRevision: row.contextPins.planRecordRevision, studySessionId: sessionId, sessionRevision,
    sessionContentId: contentId, contentRevision: 1, contentInputDigest: inputDigest, generatorVersion: VERSION }
  let canvasPins: Extract<Doc<'learnAssessmentOpportunities'>['contextPins'], { kind: 'session' }>['canvas']
  if (assignment.flow === 'v2_canvas' && item.responseSpec.kind === 'bounded_rubric') {
    const threadId = await ctx.db.insert('learningThreads', { userId, originalNeed: 'Complete the assigned check.', outcome: 'Assigned check', outcomeProvenance: 'explicit',
      intent: 'master', availableTime: '15', authorityKind: 'v2_mission', learningVoidId: row.learningVoidId, sourceScope: { kind: 'none' },
      evidenceState: 'ready', lifecycle: 'active', revision: 1, createdAt: now, updatedAt: now })
    const claims = await ctx.db.query('learnMeasurementClaims').withIndex('by_userId_and_itemId_and_order', q => q.eq('userId', userId).eq('itemId', item._id)).take(33)
    const plan = await composeAdaptiveActivityPlan({ activityId: `assessment:${row._id}`, threadId, boundaryOrdinal: 1, planRevision: 1,
      activityClass: 'factual', intent: 'master', objectiveId: row.objectiveId, purpose: 'Complete the assigned check.', reasonCode: 'assessment_check', primitiveSequence: [],
      requiredAction: { kind: 'submit_response', label: 'Submit response' }, evaluationContract: { version: 'learn-adaptive.evaluation.v1', kind: 'server_scored', responseFormat: 'short_text', passingScorePercent: 80 },
      accessibilityMetadata: { heading: 'Assigned check', instructions: 'Submit your response.', focusTargetTestId: 'learn-primitive-independent-application', liveRegionMode: 'polite' },
      pins: { learningVoidId: row.learningVoidId, blueprintRevisionId: row.blueprintRevisionId, objectiveId: row.objectiveId, sessionContentId: contentId }, evidenceReferences: [],
      generationInputs: { sessionContentRevision: 1, sessionContentInputDigest: inputDigest, generatorVersion: VERSION },
      decisionInputs: { intentRevision: 1, routerVersion: ADAPTIVE_ASSESSMENT_PLAN_VERSION, availableTime: '15', sourceState: 'ready', sourceInputs: [],
        priorActivityId: null, priorAttemptId: null, priorOutcome: null, assistance: 'none', confidence: null },
      assessmentReference: { version: ADAPTIVE_ASSESSMENT_PLAN_VERSION, assessmentOpportunityId: row._id, deliveryGrantId: null,
        item: { itemId: item._id, itemRevision: item.revision, promptDigest: item.promptDigest }, responseSpec: item.responseSpec,
        claims: claims.map(claim => ({ claimId: claim._id, revision: claim.revision, claimDigest: claim.claimDigest })) } })
    const { pins: _pins, threadId: _threadId, objectiveId: _objectiveId, evidenceReferences: _evidenceReferences, ...fields } = plan
    const activityId = await ctx.db.insert('learningThreadActivities', { ...fields, userId, threadId, status: 'eligible', learningVoidId: row.learningVoidId,
      blueprintRevisionId: row.blueprintRevisionId, objectiveId: row.objectiveId, sessionContentId: contentId, evidenceReferences: [], createdAt: now, updatedAt: now })
    await ctx.db.patch(threadId, { currentActivityId: activityId })
    canvasPins = { threadId, threadRevision: 1, activityId, activityRevision: plan.planRevision, planVersion: plan.planVersion,
      replayVersion: plan.replayVersion, rendererVersion: plan.rendererVersion, evaluationVersion: plan.evaluationContract.version,
      pilotConfigurationVersion: row.contextPins.kind === 'session' ? row.contextPins.canvas!.pilotConfigurationVersion : '' }
  }
  await ctx.db.patch(sessionId, { status: 'ready', revision: sessionRevision, scheduledStartAt: row.openAt, scheduledEndAt: row.closeAt,
    timezone: row.purpose.clock.timezone, assistanceRevision: 0, assessmentOpportunityId: row._id, assessmentPurpose: 'measurement_delayed',
    schedulerVersion: VERSION, auditReasonCode: undefined })
  await ctx.db.patch(row._id, { contextPins: { ...contextPins, ...(canvasPins ? { canvas: canvasPins } : {}) }, revision: row.revision + 1 })
  await writeMeasurementOpportunityFact(ctx, assignment, (await ctx.db.get(row._id))!)
  return { kind: 'ready', sessionId, scheduledStartAt: row.openAt }
}

export async function resolveLearnRetainedShell(ctx: MutationCtx, userId: string, sessionId: Id<'studySessions'>, basisAttemptId: Id<'masteryAttempts'>) {
  const session = (await ctx.db.get(sessionId))!
  const basis = (await ctx.db.get(basisAttemptId))!
  const protocol = getFrozenLearnMeasurementProtocol()
  let reasonCode = 'no_item'
  if (!protocol) reasonCode = 'protocol_not_frozen'
  else if (basis.blueprintRevisionId && basis.attemptLocalDate && basis.attemptTimezone && basis.acceptedAt !== undefined) {
    const assignmentKey = await privacyDigest(['learn-v2.measurement-episode.v1', await masteryScopeKey(userId, basis.blueprintRevisionId, basis.objectiveId), protocol.epoch])
    const assignment = await ctx.db.query('learnMeasurementAssignments').withIndex('by_userId_and_assignmentKey', q => q.eq('userId', userId).eq('assignmentKey', assignmentKey)).unique()
    if (assignment?.status === 'admitted') {
      if (assignment.protocolVersion !== protocol.version || assignment.windowPolicyDigest !== await measurementWindowPolicyDigest(protocol)) reasonCode = 'protocol_not_frozen'
      else {
        await materializeLearnMeasurementAssignment(ctx, assignment, protocol, Date.now())
        const originals = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_assignmentId_and_horizonDays', q => q.eq('userId', userId).eq('assignmentId', assignment._id)).take(9)
        const first = originals.length > 8 ? null : originals.filter(row => row.originalSlot && !row.replacesOpportunityId && row.purpose.kind === 'measurement_delayed'
          && row.openAt >= basis.acceptedAt! && isLearnRetainedPromotionTimeEligible({ previousState: 'independent', acceptedAt: row.openAt,
            firstIndependentLocalDate: basis.attemptLocalDate!, firstIndependentTimezone: basis.attemptTimezone! }))
          .sort((a, b) => a.openAt - b.openAt || a.delayedCheckId.localeCompare(b.delayedCheckId))[0]
        if (first) {
          if (Date.now() >= first.closeAt) reasonCode = 'missed_window'
          else {
            const bound = await bindLearnDelayedCheck(ctx, assignment, first, session)
            if (bound.kind === 'ready') {
              if (bound.sessionId !== sessionId) await ctx.db.delete(sessionId)
              return { sessionId: bound.sessionId, scheduledStartAt: bound.scheduledStartAt }
            }
            reasonCode = bound.reasonCode
          }
        }
      }
    }
  }
  await ctx.db.patch(sessionId, { status: 'blocked', assessmentPurpose: 'retained_transfer', auditReasonCode: reasonCode, revision: session.revision + 1 })
  return { sessionId, scheduledStartAt: session.scheduledStartAt }
}
