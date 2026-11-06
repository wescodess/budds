import { z } from 'zod'
import { addCalendarDays, localDateAt, type MasteryState } from './learn-v2-mastery'
import {
  learnIdSchema, learnVersionSchema, learnTimestampSchema, learnLocalDateSchema, learnTimezoneSchema,
  learnRevisionSchema, learnSequenceSchema, learnAssistanceSnapshotSchema, learnReasonCodesSchema,
  LEARN_V2_ASSISTANCE_POLICY_VERSION, LEARN_V2_RETAINED_PROMOTION_INELIGIBLE, parseLearnContract,
} from './learn-v2-responses'
import { learnMeasurementHorizonSchema } from './learn-v2-measurement'

export const LEARN_V2_DELAYED_CHECK_VERSION = 'learn-v2.delayed-check.v1' as const
export const LEARN_V2_ASSESSMENT_CAPABILITIES_VERSION = 'learn-v2.assessment-capabilities.v1' as const
export const LEARN_V2_ASSESSMENT_PHASES = [
  'preparing', 'ready', 'test_open', 'submitted_sealed', 'scoring_pending', 'scored_pass', 'scored_fail',
  'retryable_failure', 'reconciliation_required', 'invalid', 'cancelled', 'abandoned',
] as const
export const learnAssessmentPhaseSchema = z.enum(LEARN_V2_ASSESSMENT_PHASES)
export const learnAssessmentClockSchema = z.strictObject({
  protocolVersion: learnVersionSchema, schedulingPolicyVersion: learnVersionSchema, anchorKind: learnVersionSchema,
  anchorEventId: learnVersionSchema, anchorAt: learnTimestampSchema, horizonDays: learnMeasurementHorizonSchema,
  timezone: learnTimezoneSchema, dueLocalDate: learnLocalDateSchema,
  dueAt: learnTimestampSchema, openAt: learnTimestampSchema, closeAt: learnTimestampSchema,
}).refine(value => value.anchorAt <= value.openAt && value.openAt < value.closeAt
  && value.dueAt >= value.openAt && value.dueAt < value.closeAt
  && localDateAt(value.dueAt, value.timezone) === value.dueLocalDate, 'Inconsistent assessment clock')
export const learnFirstCheckClaimSchema = z.strictObject({
  claimKey: learnVersionSchema, claimSequence: learnRevisionSchema, basisAttemptId: learnIdSchema<'masteryAttempts'>(),
  masteryRecordRevision: learnRevisionSchema, firstIndependentAt: learnTimestampSchema,
  firstIndependentLocalDate: learnLocalDateSchema, firstIndependentTimezone: learnTimezoneSchema,
  transitionVersion: z.literal('learn-v2.mastery-transition.v1'), claimFactSequence: learnRevisionSchema,
}).refine(value => localDateAt(value.firstIndependentAt, value.firstIndependentTimezone) === value.firstIndependentLocalDate, 'Inconsistent Independent anchor')
export const learnAssessmentPurposeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('calibration') }),
  z.strictObject({ kind: z.literal('independent_application') }),
  z.strictObject({ kind: z.literal('retained_transfer'), basisAttemptId: learnIdSchema<'masteryAttempts'>(), clock: learnAssessmentClockSchema }),
  z.strictObject({ kind: z.literal('measurement_cold'), assignmentId: learnIdSchema<'learnMeasurementAssignments'>(), protocolVersion: learnVersionSchema }),
  z.strictObject({ kind: z.literal('measurement_delayed'), assignmentId: learnIdSchema<'learnMeasurementAssignments'>(),
    horizonDays: learnMeasurementHorizonSchema, clock: learnAssessmentClockSchema }).refine(value => value.horizonDays === value.clock.horizonDays),
])
export type LearnAssessmentPurpose = z.infer<typeof learnAssessmentPurposeSchema>
export type LearnAssessmentPhase = z.infer<typeof learnAssessmentPhaseSchema>

export const learnAssessmentLifecycleSchema = z.strictObject({
  version: z.literal(LEARN_V2_DELAYED_CHECK_VERSION), assessmentOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>(),
  revision: learnRevisionSchema, purpose: learnAssessmentPurposeSchema, phase: learnAssessmentPhaseSchema,
  deliveryGrantId: learnIdSchema<'learnAssessmentExposures'>().nullable(), submissionId: learnIdSchema<'learnResponses'>().nullable(),
  authoritativeAttemptId: learnIdSchema<'masteryAttempts'>().nullable(), acceptedAt: learnTimestampSchema.nullable(),
  checkSequence: learnSequenceSchema,
}).superRefine((value, ctx) => {
  const sealedPhase = ['submitted_sealed', 'scoring_pending', 'scored_pass', 'scored_fail', 'retryable_failure', 'reconciliation_required'].includes(value.phase)
  const beforeSeal = ['preparing', 'ready', 'test_open', 'cancelled', 'abandoned'].includes(value.phase)
  if ((sealedPhase && (!value.submissionId || !value.deliveryGrantId))
    || (beforeSeal && value.submissionId !== null)
    || ((value.submissionId !== null) !== (value.acceptedAt !== null))
    || (value.phase === 'test_open' && !value.deliveryGrantId)
    || (['scored_pass', 'scored_fail'].includes(value.phase) && value.authoritativeAttemptId === null)
    || (value.authoritativeAttemptId !== null && !['scored_pass', 'scored_fail', 'invalid'].includes(value.phase))) {
    ctx.addIssue({ code: 'custom', message: 'Inconsistent sealed assessment lifecycle' })
  }
})

const nextPhases: Record<LearnAssessmentPhase, readonly LearnAssessmentPhase[]> = {
  preparing: ['ready', 'invalid', 'cancelled', 'abandoned'],
  ready: ['test_open', 'invalid', 'cancelled', 'abandoned'],
  test_open: ['submitted_sealed', 'invalid', 'cancelled', 'abandoned'],
  submitted_sealed: ['scoring_pending', 'invalid'],
  scoring_pending: ['scored_pass', 'scored_fail', 'retryable_failure', 'reconciliation_required', 'invalid'],
  retryable_failure: ['scoring_pending', 'invalid'],
  reconciliation_required: ['scored_pass', 'scored_fail', 'invalid'],
  scored_pass: [], scored_fail: [], invalid: [], cancelled: [], abandoned: [],
}
export function canTransitionLearnAssessment(from: LearnAssessmentPhase, to: LearnAssessmentPhase) {
  return nextPhases[learnAssessmentPhaseSchema.parse(from)].includes(learnAssessmentPhaseSchema.parse(to))
}
export function isLearnAssessmentTestOnly(purpose: LearnAssessmentPurpose) {
  return ['retained_transfer', 'measurement_cold', 'measurement_delayed'].includes(purpose.kind)
}

export const learnAssessmentCapabilitiesSchema = z.strictObject({
  version: z.literal(LEARN_V2_ASSESSMENT_CAPABILITIES_VERSION), status: z.enum(['disabled', 'unavailable', 'available']),
  canDeliver: z.boolean(), canSubmit: z.boolean(), canRequestAssistance: z.boolean(), canTeachSeparateCase: z.boolean(),
  canReadFeedback: z.boolean(), reasonCodes: learnReasonCodesSchema,
}).refine(value => value.status === 'available' || !(value.canDeliver || value.canSubmit || value.canRequestAssistance || value.canTeachSeparateCase || value.canReadFeedback))
export const learnAssessmentCapabilityInputSchema = z.strictObject({
  lifecycle: learnAssessmentLifecycleSchema, enabled: z.boolean().optional(), authorized: z.boolean(),
  evidenceAvailable: z.boolean(), pinsMatch: z.boolean(), validScore: z.boolean(),
})

export function resolveLearnAssessmentCapabilities(input: {
  lifecycle: z.infer<typeof learnAssessmentLifecycleSchema>, enabled?: boolean,
  authorized: boolean, evidenceAvailable: boolean, pinsMatch: boolean, validScore: boolean,
}) {
  const value = parseLearnContract(learnAssessmentCapabilityInputSchema, input)
  const lifecycle = value.lifecycle
  const available = value.enabled === true && value.authorized && value.evidenceAvailable && value.pinsMatch
  const sealed = lifecycle.submissionId !== null
  const open = lifecycle.phase === 'test_open'
  return learnAssessmentCapabilitiesSchema.parse({
    version: LEARN_V2_ASSESSMENT_CAPABILITIES_VERSION,
    status: value.enabled !== true ? 'disabled' : available ? 'available' : 'unavailable',
    canDeliver: available && lifecycle.phase === 'ready',
    canSubmit: available && open,
    canRequestAssistance: available && (sealed || (open && !isLearnAssessmentTestOnly(lifecycle.purpose))),
    canTeachSeparateCase: available && sealed,
    canReadFeedback: available && value.validScore && ['scored_pass', 'scored_fail'].includes(lifecycle.phase),
    reasonCodes: value.enabled !== true ? ['disabled'] : !available ? ['assessment_unavailable'] : [],
  })
}

export const learnAssessmentEligibilityInputSchema = z.strictObject({
  purpose: learnAssessmentPurposeSchema, acceptedAt: learnTimestampSchema,
  acceptedT0: z.boolean(), evidenceAvailable: z.boolean(), pinsMatch: z.boolean(), deliveryGranted: z.boolean(),
  historyKnown: z.boolean(), novelCase: z.enum(['yes', 'no', 'unknown']), inAssignedWindow: z.boolean(),
  assignmentAdmitted: z.boolean(), coldBeforeTeaching: z.boolean(),
  assistance: learnAssistanceSnapshotSchema,
  previousState: z.enum(['unseen', 'learning', 'guided', 'independent', 'retained', 'needs_review', 'blocked', 'provisionally_known']),
  firstIndependentLocalDate: learnLocalDateSchema.nullable(), firstIndependentTimezone: learnTimezoneSchema.nullable(),
})
export const learnAssessmentEligibilitySchema = z.strictObject({
  version: z.literal(LEARN_V2_DELAYED_CHECK_VERSION), measurementEligible: z.boolean(), masteryEligible: z.boolean(),
  reasonCodes: learnReasonCodesSchema,
})

export function isLearnRetainedPromotionTimeEligible(input: {
  previousState: MasteryState, acceptedAt: number, firstIndependentLocalDate: string | null, firstIndependentTimezone: string | null,
}) {
  if (!['independent', 'retained'].includes(input.previousState) || !input.firstIndependentLocalDate || !input.firstIndependentTimezone) return false
  const date = learnLocalDateSchema.parse(input.firstIndependentLocalDate)
  const timezone = learnTimezoneSchema.parse(input.firstIndependentTimezone)
  return localDateAt(learnTimestampSchema.parse(input.acceptedAt), timezone) >= addCalendarDays(date, 7)
}

export function evaluateLearnAssessmentEligibility(input: z.infer<typeof learnAssessmentEligibilityInputSchema>) {
  const value = parseLearnContract(learnAssessmentEligibilityInputSchema, input)
  const reasons: string[] = []
  if (!value.acceptedT0) reasons.push('unmeasurable_no_t0')
  if (!value.evidenceAvailable) reasons.push('evidence_unavailable')
  if (!value.pinsMatch) reasons.push('pins_mismatch')
  if (!value.deliveryGranted) reasons.push('not_delivered')
  if (value.assistance.policyVersion !== LEARN_V2_ASSISTANCE_POLICY_VERSION) reasons.push('assistance_policy_unknown')
  const clock = 'clock' in value.purpose ? value.purpose.clock : null
  if (!value.inAssignedWindow || (clock && (value.acceptedAt < clock.openAt || value.acceptedAt >= clock.closeAt))) reasons.push('outside_window')
  const testOnly = isLearnAssessmentTestOnly(value.purpose)
  if (testOnly && !value.historyKnown) reasons.push('unknown_history')
  if (testOnly && value.novelCase !== 'yes') reasons.push('novel_item_unavailable')
  if (testOnly && value.assistance.state !== 'unassisted') reasons.push(value.assistance.state === 'assisted' ? 'assisted' : 'assistance_unknown')
  const measurement = value.purpose.kind === 'measurement_cold' || value.purpose.kind === 'measurement_delayed'
  if (measurement && !value.assignmentAdmitted) reasons.push('not_admitted')
  if (value.purpose.kind === 'measurement_cold' && !value.coldBeforeTeaching) reasons.push('cold_after_teaching')
  const clean = reasons.length === 0
  const delayed = value.purpose.kind === 'measurement_delayed' || value.purpose.kind === 'retained_transfer'
  const retained = delayed && isLearnRetainedPromotionTimeEligible(value)
  if (delayed && !retained) reasons.push(LEARN_V2_RETAINED_PROMOTION_INELIGIBLE)
  return learnAssessmentEligibilitySchema.parse({
    version: LEARN_V2_DELAYED_CHECK_VERSION,
    measurementEligible: clean && measurement,
    masteryEligible: clean && (delayed ? retained : value.purpose.kind !== 'measurement_cold'),
    reasonCodes: reasons,
  })
}
