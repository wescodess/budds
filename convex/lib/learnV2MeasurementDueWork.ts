import { measurementReadContext } from './learnV2MeasurementReadContext'
import { LEARN_SYSTEM_DUE_WORK_LATE } from '../../shared/learn-v2-delayed-check'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import {
  getFrozenLearnMeasurementProtocol, learnMeasurementProtocolSchema, measurementClock,
  measurementWindowPolicyDigest, LEARN_MEASUREMENT_ELIGIBILITY_VERSION, type LearnMeasurementProtocol,
} from './learnV2MeasurementAssignment'
import {
  measurementScopeReason, measurementFlowReason, measurementItemReason, measurementCaseExposed,
  writeMeasurementOpportunityFact, registerLearnFirstSlotForOwner, linkFirstIndependentClaimForOwner, type AdmittedAssignment,
} from './learnV2Measurement'
import { privacyDigest, liveResponseAggregate } from './learnV2ResponsePrivacy'
import { hasAccountDeletionTombstone } from './accountDeletionTombstone'
import { getScopedMasteryRecord } from './learnV2MasteryScope'
import { writeLearnMeasurementEnrollmentFact, nextLearnMeasurementSourceSequence } from './learnV2MeasurementFacts'
import { LEARN_MEASUREMENT_CAPABILITIES, LEARN_MEASUREMENT_STORAGE_VERSION } from '../../shared/learn-v2-measurement-storage-manifest'
import { parseLearnContract } from '../../shared/learn-v2-responses'
import { learnMeasurementAllocationSchema, learnMeasurementItemPinsSchema } from '../../shared/learn-v2-measurement'
import { learnMeasurementEventInputSchema, LEARN_MEASUREMENT_EVENT_TAXONOMY_VERSION } from '../../shared/learn-adaptive-events'
import { bindLearnDelayedCheck, finalizeLearnDelayedCheckSession, readLearnDelayedCheckBinding } from './learnV2DelayedDelivery'
import { measurementAllocationMatches } from './learnV2MeasurementAllocation'

async function updateOpportunity(ctx: MutationCtx, assignment: AdmittedAssignment, row: Doc<'learnAssessmentOpportunities'>,
  patch: Partial<Pick<Doc<'learnAssessmentOpportunities'>, 'phase' | 'operationalEligibility' | 'eligibleAt' | 'reasonCode' | 'replacementBinding'>>) {
  if (Object.entries(patch).every(([key, value]) => row[key as keyof typeof row] === value)) return
  await ctx.db.patch(row._id, { ...patch, revision: row.revision + 1 })
  if (patch.phase && ['invalid', 'cancelled', 'abandoned'].includes(patch.phase))
    await finalizeLearnDelayedCheckSession(ctx, assignment.userId, { ...row, ...patch })
  await writeMeasurementOpportunityFact(ctx, assignment, (await ctx.db.get(row._id))!)
}

async function emitEligibility(ctx: MutationCtx, assignment: AdmittedAssignment, row: Doc<'learnAssessmentOpportunities'>) {
  const semanticKey = `opportunity:${row._id}:eligible`
  const dedupeKeyHash = await privacyDigest([LEARN_MEASUREMENT_EVENT_TAXONOMY_VERSION, assignment.userId, semanticKey])
  const prior = await ctx.db.query('learnActivityEvents').withIndex('by_userId_and_dedupeKeyHash', q => q.eq('userId', assignment.userId).eq('dedupeKeyHash', dedupeKeyHash)).unique()
  if (prior) {
    if (prior.taxonomyVersion !== LEARN_MEASUREMENT_EVENT_TAXONOMY_VERSION || prior.assessmentOpportunityId !== row._id) throw new Error('Learn eligibility event identity conflicts')
    return
  }
  const canvas = row.contextPins.kind === 'session' ? row.contextPins.canvas : null
  const { record } = await getScopedMasteryRecord(ctx, assignment.userId, row.blueprintRevisionId, row.objectiveId)
  const event = parseLearnContract(learnMeasurementEventInputSchema, {
    taxonomyVersion: LEARN_MEASUREMENT_EVENT_TAXONOMY_VERSION, eventType: 'delayed_check_eligible', eventVersion: 'delayed_check_eligible.v2',
    sourceVersion: LEARN_MEASUREMENT_ELIGIBILITY_VERSION, contractVersion: row.eligibilityPolicyVersion,
    occurredAt: row.eligibleAt, learningVoidId: row.learningVoidId, blueprintRevisionId: row.blueprintRevisionId, objectiveId: row.objectiveId,
    assessmentOpportunityId: row._id, horizonDays: row.horizonDays, measurementEligible: true, masteryEligible: false,
    semanticKey, metadata: { masteryState: record?.state ?? 'unseen' }, ...(canvas ? { threadId: canvas.threadId, activityId: canvas.activityId } : {}),
  })
  const { semanticKey: _semanticKey, ...fields } = event
  await ctx.db.insert('learnActivityEvents', { userId: assignment.userId, ...fields, dedupeKeyHash })
}

async function processDueOpportunity(ctx: MutationCtx, assignment: AdmittedAssignment, protocol: LearnMeasurementProtocol,
  row: Doc<'learnAssessmentOpportunities'>, through: number) {
  const observedAt = Date.now()
  if (row.submissionId || ['cancelled', 'abandoned', 'invalid', 'scored_pass', 'scored_fail'].includes(row.phase)) return
  if (through < row.openAt || observedAt < row.openAt) return
  if (observedAt >= row.closeAt) {
    const playable = !LEARN_MEASUREMENT_CAPABILITIES.responses || row.deliveryGrantId !== undefined || row.eligibleAt !== undefined && row.eligibleAt < row.closeAt
      && await readLearnDelayedCheckBinding(ctx, assignment.userId, row) !== null
    const reasonCode = LEARN_MEASUREMENT_CAPABILITIES.responses && row.operationalEligibility === 'blocked' && row.reasonCode ? row.reasonCode
      : playable ? 'missed_window' : LEARN_SYSTEM_DUE_WORK_LATE
    await updateOpportunity(ctx, assignment, row, { phase: 'abandoned', operationalEligibility: 'blocked', reasonCode })
    return
  }
  const reason = assignment.evidenceStatus !== 'available' || assignment.invalidatedAt !== undefined ? 'evidence_unavailable'
    : await measurementScopeReason(ctx, assignment.userId, row)
      ?? await measurementFlowReason(ctx, assignment.userId, assignment.flow, row, protocol)
      ?? (row.assessmentPins.kind !== 'measurement' ? 'pins_mismatch'
        : await measurementItemReason(ctx, assignment.userId, parseLearnContract(learnMeasurementItemPinsSchema, row.assessmentPins.itemPins), row, assignment.scoringBinding)
          ?? (await measurementCaseExposed(ctx, assignment.userId, row.assessmentPins.itemPins.caseId, row._id) ? 'novel_item_unavailable' : null))
  if (reason) {
    await updateOpportunity(ctx, assignment, row, { operationalEligibility: 'blocked', reasonCode: reason })
    return
  }
  if (LEARN_MEASUREMENT_CAPABILITIES.responses && LEARN_MEASUREMENT_CAPABILITIES.delivery) {
    const binding = await bindLearnDelayedCheck(ctx, assignment, row)
    if (binding.kind === 'blocked') {
      await updateOpportunity(ctx, assignment, row, { operationalEligibility: 'blocked', reasonCode: binding.reasonCode })
      return
    }
    row = (await ctx.db.get(row._id))!
  }
  await updateOpportunity(ctx, assignment, row, { phase: row.phase === 'preparing' ? 'ready' : row.phase,
    operationalEligibility: 'eligible', reasonCode: undefined, eligibleAt: row.eligibleAt ?? observedAt })
  await emitEligibility(ctx, assignment, (await ctx.db.get(row._id))!)
}

export async function replaceLearnMeasurementOpportunityForOwner(ctx: MutationCtx, userId: string, input: {
  assessmentOpportunityId: Id<'learnAssessmentOpportunities'>,
  reason: 'novel_item_unavailable' | 'evidence_unavailable' | 'contaminated' | 'abandoned',
}) {
  ctx = measurementReadContext(ctx, userId)
  const original = await ctx.db.get(input.assessmentOpportunityId)
  const assignment = original?.assignmentId ? await ctx.db.get(original.assignmentId) : null
  const protocol = getFrozenLearnMeasurementProtocol()
  if (!original || original.userId !== userId || !assignment || assignment.userId !== userId || assignment.status !== 'admitted') throw new Error('Learn replacement scope unavailable')
  if (!protocol || !LEARN_MEASUREMENT_CAPABILITIES.enrollment || protocol.version !== assignment.protocolVersion
    || await measurementWindowPolicyDigest(protocol) !== assignment.windowPolicyDigest) return { status: 'protocol_not_frozen' as const }
  const delayedCheckId = await privacyDigest([original._id, 'reserve'])
  const previous = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_delayedCheckId', q => q.eq('userId', userId).eq('delayedCheckId', delayedCheckId)).unique()
  if (previous) {
    if (previous.replacementReason !== input.reason) throw new Error('Learn replacement reason conflicts')
    if (LEARN_MEASUREMENT_CAPABILITIES.responses && !await measurementAllocationMatches(ctx, userId, previous, assignment)) return { status: 'replacement_not_allowed' as const }
    return { status: 'replaced' as const, assessmentOpportunityId: previous._id }
  }
  if (!original.originalSlot || original.submissionId || original.authoritativeAttemptId
    || ['submitted_sealed', 'scoring_pending', 'scored_pass', 'scored_fail', 'retryable_failure', 'reconciliation_required'].includes(original.phase)
    || original.purpose.kind !== 'measurement_delayed' || original.assessmentPins.kind !== 'measurement'
    || !protocol.replacementReasons.includes(input.reason) || original.reasonCode !== input.reason
    || Date.now() < original.openAt || Date.now() >= original.closeAt) return { status: 'replacement_not_allowed' as const }
  const scopeReason = await measurementScopeReason(ctx, userId, original) ?? await measurementFlowReason(ctx, userId, assignment.flow, original, protocol)
  if (scopeReason) return { status: 'blocked' as const, reasonCode: scopeReason }
  const items = await ctx.db.query('learnMeasurementItems').withIndex('by_userId_and_familyId_and_familyRevision_and_formLabel', q => q.eq('userId', userId).eq('familyId', assignment.familyId).eq('familyRevision', assignment.familyRevision)).take(7)
  if (items.length > 6) return { status: 'novel_item_unavailable' as const }
  for (const item of items.filter(row => row.reserve)) {
    const caseRow = await ctx.db.get(item.caseId)
    const parsed = learnMeasurementItemPinsSchema.safeParse({ itemId: item._id, itemRevision: item.revision, promptDigest: item.promptDigest,
      caseId: item.caseId, familyId: item.familyId, familyRevision: item.familyRevision, formLabel: item.formLabel,
      equivalenceVersion: original.assessmentPins.itemPins.equivalenceVersion, noveltyPolicyVersion: caseRow?.identityPolicyVersion,
      scoringSpecId: item.scoringSpecId, scoringSpecRevision: item.scoringSpecRevision, scoringSpecDigest: item.scoringSpecDigest,
      supportManifestDigest: item.supportManifestDigest, publicationValidationId: item.publicationValidationId })
    if (!parsed.success || await measurementCaseExposed(ctx, userId, item.caseId)
      || await measurementItemReason(ctx, userId, parsed.data, original, assignment.scoringBinding)) continue
    const assigned = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_assignmentId_and_horizonDays', q => q.eq('userId', userId).eq('assignmentId', assignment._id)).take(9)
    if (assigned.length > 8) return { status: 'novel_item_unavailable' as const }
    if (assigned.some(row => row.assessmentPins.kind === 'measurement' && row.assessmentPins.itemPins.caseId === item.caseId)) continue
    const { _id, _creationTime, deliveryGrantId: _grant, submissionId: _submission, scoringJobId: _job,
      authoritativeAttemptId: _attempt, firstCheckClaim: _claim, eligibleAt: _eligible, replacementBinding: _replacement, ...fields } = original
    const id = await ctx.db.insert('learnAssessmentOpportunities', { ...fields, createdAt: Date.now(), delayedCheckId,
      assessmentPins: { kind: 'measurement', itemPins: parsed.data }, phase: 'ready', revision: 1, operationalEligibility: 'eligible', eligibleAt: Date.now(),
      reasonCode: undefined, replacesOpportunityId: original._id, replacementReason: input.reason, originalSlot: false, checkSequence: 0 })
    await updateOpportunity(ctx, assignment, original, { phase: original.phase === 'abandoned' ? 'abandoned' : 'invalid', operationalEligibility: 'blocked', reasonCode: input.reason,
      ...(LEARN_MEASUREMENT_CAPABILITIES.responses ? { replacementBinding: { assessmentOpportunityId: id, itemPinsDigest: await privacyDigest(parsed.data) } } : {}) })
    const replacement = (await ctx.db.get(id))!
    await writeMeasurementOpportunityFact(ctx, assignment, replacement)
    await emitEligibility(ctx, assignment, replacement)
    return { status: 'replaced' as const, assessmentOpportunityId: id }
  }
  return { status: 'novel_item_unavailable' as const }
}

export async function materializeLearnMeasurementAssignment(ctx: MutationCtx, assignment: AdmittedAssignment, protocol: LearnMeasurementProtocol, through: number) {
  ctx = measurementReadContext(ctx, assignment.userId)
  const cold = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_assignmentId_and_horizonDays', q => q.eq('userId', assignment.userId).eq('assignmentId', assignment._id).eq('horizonDays', undefined)).unique()
  if (!cold || cold.purpose.kind !== 'measurement_cold') return 'missing_cold_opportunity'
  if (!await liveResponseAggregate(ctx, assignment.userId, cold)) return 'aggregate_unavailable'
  if (assignment.protocolVersion !== protocol.version || assignment.epoch !== protocol.epoch
    || assignment.baselineSha !== protocol.baselineSha || assignment.cohortVersion !== protocol.cohortVersion
    || assignment.windowPolicyDigest !== await measurementWindowPolicyDigest(protocol)) return 'protocol_pins_mismatch'
  if (assignment.anchorKind === 'enrollment' && Date.now() >= cold.closeAt && !cold.submissionId) {
    await updateOpportunity(ctx, assignment, cold, { phase: 'abandoned', operationalEligibility: 'blocked', reasonCode: 'missing_cold' })
  }
  if (assignment.anchorAt === null && assignment.anchorKind === 'sealed_cold' && cold.submissionId) {
    const response = await ctx.db.get(cold.submissionId)
    if (!response || response.userId !== assignment.userId || !('assessmentOpportunityId' in response) || response.assessmentOpportunityId !== cold._id
      || response.acceptedAt < cold.openAt || response.acceptedAt >= cold.closeAt || response.acceptedAt > through) return 'anchor_not_started'
    await ctx.db.patch(assignment._id, { anchorAt: response.acceptedAt, anchorEventId: response._id })
    assignment = (await ctx.db.get(assignment._id))! as AdmittedAssignment
    await writeLearnMeasurementEnrollmentFact(ctx, assignment.userId, assignment)
  }
  if (assignment.anchorAt === null || assignment.anchorEventId === null) {
    await updateOpportunity(ctx, assignment, cold, { reasonCode: 'anchor_not_started', ...(through >= cold.closeAt && !cold.submissionId ? { phase: 'abandoned' as const, operationalEligibility: 'blocked' as const } : {}) })
    return 'anchor_not_started'
  }
  const allocation = parseLearnContract(learnMeasurementAllocationSchema, assignment.allocation)
  const slots = allocation.kind === 'three_case'
    ? [{ horizonDays: 7 as const, pins: allocation.day7 }, { horizonDays: 30 as const, pins: allocation.day30 }]
    : [{ horizonDays: allocation.horizonDays, pins: allocation.delayed }]
  for (const slot of slots) {
    const delayedCheckId = await privacyDigest([assignment._id, slot.horizonDays, 'original'])
    let row = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_delayedCheckId', q => q.eq('userId', assignment.userId).eq('delayedCheckId', delayedCheckId)).unique()
    if (!row) {
      const clock = measurementClock(protocol, { at: assignment.anchorAt, eventId: assignment.anchorEventId }, assignment.enrollmentTimezone, slot.horizonDays)
      const id = await ctx.db.insert('learnAssessmentOpportunities', {
        userId: assignment.userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION, createdAt: Date.now(),
        scopeKind: 'v2', learningVoidId: assignment.learningVoidId, blueprintRevisionId: assignment.blueprintRevisionId,
        objectiveId: assignment.objectiveId, blueprintRecordRevision: assignment.blueprintRecordRevision,
        assessmentContractVersion: assignment.assessmentContractVersion, assessmentContractDigest: assignment.assessmentContractDigest,
        depth: assignment.depth, contextPins: cold.contextPins, evidenceStatus: assignment.evidenceStatus, delayedCheckId,
        purpose: { kind: 'measurement_delayed', assignmentId: assignment._id, horizonDays: slot.horizonDays, clock },
        assessmentPins: { kind: 'measurement', itemPins: slot.pins }, scoringBinding: assignment.scoringBinding,
        assignmentId: assignment._id, horizonDays: slot.horizonDays, phase: 'preparing', revision: 1,
        eligibilityPolicyVersion: LEARN_MEASUREMENT_ELIGIBILITY_VERSION, operationalEligibility: 'pending',
        dueAt: clock.dueAt, openAt: clock.openAt, closeAt: clock.closeAt, checkSequence: 0, originalSlot: true, firstSlotEpoch: assignment.epoch,
      })
      row = (await ctx.db.get(id))!
      await writeMeasurementOpportunityFact(ctx, assignment, row)
    }
    if (row.assignmentId !== assignment._id || row.assessmentPins.kind !== 'measurement'
      || row.assessmentPins.itemPins.itemId !== slot.pins.itemId || row.horizonDays !== slot.horizonDays || !row.originalSlot) throw new Error('Learn original opportunity identity conflicts')
    await registerLearnFirstSlotForOwner(ctx, row, assignment.epoch, false)
    await processDueOpportunity(ctx, assignment, protocol, row, through)
    const replacementKey = await privacyDigest([row._id, 'reserve'])
    const replacement = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_delayedCheckId', q => q.eq('userId', assignment.userId).eq('delayedCheckId', replacementKey)).unique()
    if (replacement) await processDueOpportunity(ctx, assignment, protocol, replacement, through)
  }
  await linkFirstIndependentClaimForOwner(ctx, assignment.userId, assignment.blueprintRevisionId, assignment.objectiveId, assignment.epoch)
  return 'processed'
}

export async function materializeLearnMeasurementDueBatch(ctx: MutationCtx, userId: string, input: {
  cursor: string | null, through: number, expectedSequence?: number, coverageComplete?: boolean,
}) {
  ctx = measurementReadContext(ctx, userId)
  const frozen = getFrozenLearnMeasurementProtocol()
  if (!frozen) return { status: 'protocol_not_frozen' as const, cursor: null, processed: 0, sequence: 0, complete: false }
  if (!LEARN_MEASUREMENT_CAPABILITIES.enrollment) return { status: 'disabled' as const, cursor: null, processed: 0, sequence: 0, complete: false }
  if (await hasAccountDeletionTombstone(ctx, userId)) return { status: 'unavailable' as const, cursor: null, processed: 0, sequence: 0, complete: false }
  if (!Number.isSafeInteger(input.through) || input.through < 0 || input.through > Date.now()) throw new Error('Learn due-work cutoff is invalid')
  const protocol = parseLearnContract(learnMeasurementProtocolSchema, frozen)
  const initial = await nextLearnMeasurementSourceSequence(ctx, userId)
  const restarted = input.expectedSequence !== undefined && input.expectedSequence !== initial.sequence - 1
  const cursor = restarted ? null : input.cursor
  const page = await ctx.db.query('learnMeasurementAssignments').withIndex('by_userId', q => q.eq('userId', userId)).paginate({ cursor, numItems: 1 })
  let complete = restarted ? true : input.coverageComplete ?? true
  for (const assignment of page.page) {
    if (assignment.status !== 'admitted') continue
    const result = await materializeLearnMeasurementAssignment(ctx, assignment, protocol, input.through)
    if (['protocol_pins_mismatch', 'missing_cold_opportunity', 'aggregate_unavailable'].includes(result)) complete = false
  }
  const { watermark, sequence } = await nextLearnMeasurementSourceSequence(ctx, userId)
  // Completeness is established only by a full sweep. Unknown history stays unknown.
  if (page.isDone && complete && watermark && (!LEARN_MEASUREMENT_CAPABILITIES.responses || watermark.dueWorkThrough === null || watermark.dueWorkThrough < input.through))
    await ctx.db.patch(watermark._id, { dueWorkThrough: Math.max(watermark.dueWorkThrough ?? 0, input.through), updatedAt: Date.now() })
  return { status: 'processed' as const, cursor: page.isDone ? null : page.continueCursor, processed: page.page.length,
    sequence: sequence - 1, complete: page.isDone && complete, coverageComplete: complete }
}
