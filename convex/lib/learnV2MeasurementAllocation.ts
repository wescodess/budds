import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { LEARN_MEASUREMENT_CAPABILITIES } from '../../shared/learn-v2-measurement-storage-manifest'
import { getFrozenLearnMeasurementProtocol, measurementWindowPolicyDigest } from './learnV2MeasurementAssignment'
import { privacyDigest } from './learnV2ResponsePrivacy'

type Opportunity = Doc<'learnAssessmentOpportunities'>
type Assignment = Doc<'learnMeasurementAssignments'>

export async function measurementAllocationMatches(ctx: QueryCtx | MutationCtx, userId: string, row: Opportunity, assignment: Assignment) {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses || assignment.status !== 'admitted' || assignment.userId !== userId || row.userId !== userId
    || row.assignmentId !== assignment._id || !('assignmentId' in row.purpose) || row.purpose.assignmentId !== assignment._id
    || row.assessmentPins.kind !== 'measurement' || row.learningVoidId !== assignment.learningVoidId
    || row.blueprintRevisionId !== assignment.blueprintRevisionId || row.objectiveId !== assignment.objectiveId
    || row.blueprintRecordRevision !== assignment.blueprintRecordRevision || row.assessmentContractDigest !== assignment.assessmentContractDigest
    || row.assessmentContractVersion !== assignment.assessmentContractVersion || row.depth !== assignment.depth
    || await privacyDigest(row.scoringBinding) !== await privacyDigest(assignment.scoringBinding)) return false
  const allocation = assignment.allocation
  const assigned = row.purpose.kind === 'measurement_cold' ? allocation.cold : row.purpose.kind === 'measurement_delayed'
    ? allocation.kind === 'three_case' ? row.purpose.horizonDays === 7 ? allocation.day7 : allocation.day30
      : allocation.horizonDays === row.purpose.horizonDays ? allocation.delayed : null : null
  if (!assigned) return false
  if (!row.replacesOpportunityId) return !row.replacementReason && (row.purpose.kind === 'measurement_cold' || row.originalSlot)
    && await privacyDigest(assigned) === await privacyDigest(row.assessmentPins.itemPins)
  if (row.purpose.kind !== 'measurement_delayed' || row.originalSlot || row.checkSequence !== 0 || !row.replacementReason) return false
  const protocol = getFrozenLearnMeasurementProtocol()
  if (!protocol || protocol.version !== assignment.protocolVersion || protocol.epoch !== assignment.epoch
    || await measurementWindowPolicyDigest(protocol) !== assignment.windowPolicyDigest
    || !protocol.replacementReasons.some(reason => reason === row.replacementReason)) return false
  const original = await ctx.db.get(row.replacesOpportunityId)
  if (!original || original.userId !== userId || original.assignmentId !== assignment._id || !original.originalSlot
    || original.replacesOpportunityId || original.replacementBinding?.assessmentOpportunityId !== row._id || original.submissionId || original.authoritativeAttemptId
    || original.purpose.kind !== 'measurement_delayed' || original.purpose.assignmentId !== assignment._id
    || original.purpose.horizonDays !== row.purpose.horizonDays || original.horizonDays !== row.horizonDays
    || original.learningVoidId !== row.learningVoidId || original.blueprintRevisionId !== row.blueprintRevisionId
    || original.objectiveId !== row.objectiveId || original.blueprintRecordRevision !== row.blueprintRecordRevision
    || original.assessmentContractDigest !== row.assessmentContractDigest || original.assessmentContractVersion !== row.assessmentContractVersion
    || original.depth !== row.depth || original.assessmentPins.kind !== 'measurement'
    || !['invalid', 'abandoned'].includes(original.phase) || original.operationalEligibility !== 'blocked'
    || original.reasonCode !== row.replacementReason || original.openAt !== row.openAt || original.closeAt !== row.closeAt || original.dueAt !== row.dueAt
    || row.openAt !== row.purpose.clock.openAt || row.closeAt !== row.purpose.clock.closeAt || row.dueAt !== row.purpose.clock.dueAt
    || await privacyDigest(original.purpose.clock) !== await privacyDigest(row.purpose.clock)
    || await privacyDigest(original.scoringBinding) !== await privacyDigest(row.scoringBinding)
    || await privacyDigest(original.assessmentPins.itemPins) !== await privacyDigest(assigned)
    || original.replacementBinding.itemPinsDigest !== await privacyDigest(row.assessmentPins.itemPins)
    || row.delayedCheckId !== await privacyDigest([original._id, 'reserve'])) return false
  const item = await ctx.db.get(row.assessmentPins.itemPins.itemId)
  return item?.userId === userId && item.reserve && item.familyId === assignment.familyId && item.familyRevision === assignment.familyRevision
    && item.caseId !== original.assessmentPins.itemPins.caseId
}
