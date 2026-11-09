import { z } from 'zod'
import {
  learnCodeSchema, learnDigestSchema, learnIdSchema, learnVersionSchema, learnTimestampSchema, learnSequenceSchema,
  learnRevisionSchema, learnScoreSchema, learnObservationSchema, learnReasonCodesSchema, learnTimezoneSchema,
  learnAssistanceSnapshotSchema, learnValiditySnapshotSchema, parseLearnContract, learnSerializedBytes,
} from './learn-v2-responses'
import { learnAssessmentClockSchema, learnFirstCheckClaimSchema, learnAssessmentPhaseSchema } from './learn-v2-delayed-check'
import { learnMeasurementFlowSchema, learnMeasurementDepthSchema, learnHistoryStatusSchema, learnFamilyStatusSchema, learnMeasurementHorizonSchema, LEARN_V2_FORM_ORDERS } from './learn-v2-measurement'
import { LEARN_MEASUREMENT_STORAGE_LIMITS } from './learn-v2-measurement-storage-manifest'
import { addCalendarDays, localDateAt } from './learn-v2-mastery'
import { computeLearnReportEstimate, type ReportObservation, type ReportEvidence } from './learn-v2-measurement-report-math'
export { LEARN_V2_REPORT_PRECISION } from './learn-v2-measurement-report-math'

export const LEARN_V2_MEASUREMENT_REPORT_VERSION = 'learn-v2.measurement-report.v3' as const
export const LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION = 'learn-v2.measurement-report-source.v4' as const
export const LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION = 'learn-v2.measurement-report-query.v1' as const
export const VERIFIED_LEARNING_GAIN_VERSION = 'verified_learning_gain.v1' as const
export const FALSE_MASTERY_NEXT_DELAYED_VERSION = 'false_mastery_next_delayed.v1' as const
export const LEARN_V2_REPORT_STATUSES = [
  'not_admitted', 'protocol_not_frozen', 'anchor_not_started', 'not_yet_due', 'no_eligible_population',
  'unmeasurable_no_t0', 'insufficient_data', 'partial_observed', 'observed_complete', 'unknown_source_coverage', 'quarantined',
] as const
export const LEARN_V2_REPORT_DISPOSITIONS = [
  'missing_cold', 'missing_delayed', 'abandoned', 'assisted_contaminated', 'invalid_item_novelty', 'evidence_unavailable',
  'pin_flow_treatment_mismatch', 'access_provider_blocked', 'scoring_pending', 'reconciliation_required', 'valid_scored',
] as const
export const LEARN_V2_REPORT_RESPONSE_KINDS = ['keyed', 'numeric', 'ordered', 'bounded_rubric'] as const
export const LEARN_V2_REPORT_STARTING_BANDS = ['0_40', '40_80', '80_100', 'unknown', 'all'] as const
export const LEARN_V2_REPORT_SENSITIVITY_POLICY_VERSION = 'learn-v2.exclude-observed-instrumentation-flags.v1' as const
export const learnReportStatusSchema = z.enum(LEARN_V2_REPORT_STATUSES)
export const learnReportDispositionSchema = z.enum(LEARN_V2_REPORT_DISPOSITIONS)
export const learnReportOpportunityStatusSchema = z.union([learnAssessmentPhaseSchema, z.enum(['pending', 'eligible', 'blocked'])])
const sourceCoverage = z.enum(['complete', 'unknown'])
const count = z.number().int().min(0).max(LEARN_MEASUREMENT_STORAGE_LIMITS.maxReportEpisodes)
const masteryState = z.enum(['unseen', 'learning', 'guided', 'independent', 'retained', 'needs_review', 'blocked', 'provisionally_known'])
export const learnReportCapturedMasteryStateSchema = z.union([masteryState, z.literal('unknown')])
export const learnReportLegacyIndependentAuditSchema = z.strictObject({
  unknownCount: count.nullable(), sourceCoverage,
}).refine(value => (value.sourceCoverage === 'complete') === (value.unknownCount !== null), 'Legacy audit counts require complete enumeration')

export const learnReportOpaqueKeySchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const computationKeys = { learnerKey: learnReportOpaqueKeySchema, capabilityKey: learnReportOpaqueKeySchema }
export async function deriveLearnReportLearnerKey(reportRunId: string, ownerTokenIdentifier: string) {
  return reportKeyDigest(['learn-v2.measurement-report-keys.v1', 'learner', reportRunId, ownerTokenIdentifier])
}
export async function deriveLearnReportComputationKeys(input: {
  reportRunId: string, ownerTokenIdentifier: string, blueprintRevisionId: string, objectiveId: string,
}) {
  const scopeKey = await reportKeyDigest(['learn-v2-mastery-scope.v1', input.ownerTokenIdentifier, input.blueprintRevisionId, input.objectiveId])
  return { learnerKey: await deriveLearnReportLearnerKey(input.reportRunId, input.ownerTokenIdentifier),
    capabilityKey: await reportKeyDigest(['learn-v2.measurement-report-keys.v1', 'capability', input.reportRunId, scopeKey]) }
}
async function reportKeyDigest(parts: string[]) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts))))
  return `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
}
export const learnReportScorerConfigurationSchema = z.strictObject({
  scoringKind: z.enum(['deterministic', 'model']), configurationDigest: learnDigestSchema, scorerVersion: learnVersionSchema,
})
export const learnReportReplacementPolicySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('secondary_only') }),
  z.strictObject({ kind: z.literal('predeclared'), protocolVersion: learnVersionSchema, ruleVersion: learnVersionSchema, ruleDigest: learnDigestSchema }),
])
export const learnReportAcceptanceSnapshotSchema = z.strictObject({
  submissionId: learnIdSchema<'learnResponses'>(), acceptedAt: learnTimestampSchema,
})
const frozenStratum = {
  epoch: learnVersionSchema, baselineSha: z.string().regex(/^[a-f0-9]{40}$/), cohortVersion: learnVersionSchema,
  flow: learnMeasurementFlowSchema, entryPoint: learnVersionSchema, depth: learnMeasurementDepthSchema,
  familyId: learnIdSchema<'learnMeasurementFamilies'>().nullable(), familyRevision: learnRevisionSchema.nullable(),
  familyValidationStatus: z.union([learnFamilyStatusSchema, z.literal('unknown')]), equivalenceVersion: learnVersionSchema.nullable(),
}
export const learnReportFirstSlotStratumSchema = z.strictObject({
  ...frozenStratum, responseKind: z.enum(LEARN_V2_REPORT_RESPONSE_KINDS), scorerConfiguration: learnReportScorerConfigurationSchema,
})
export const learnReportAssignmentSnapshotSchema = z.strictObject({
  status: z.enum(['considered', 'not_admitted', 'admitted']), protocolStatus: z.enum(['protocol_not_frozen', 'blocked', 'frozen']),
  ...frozenStratum, responseKind: z.enum(LEARN_V2_REPORT_RESPONSE_KINDS).nullable(), scorerConfiguration: learnReportScorerConfigurationSchema.nullable(),
  protocolVersion: learnVersionSchema.nullable(), enrollmentAt: learnTimestampSchema.nullable(), timezone: learnTimezoneSchema.nullable(),
  anchorAt: learnTimestampSchema.nullable(), anchorKind: learnVersionSchema.nullable(), historyStatus: learnHistoryStatusSchema,
  allocationOrder: z.enum([...LEARN_V2_FORM_ORDERS, 'AB', 'BA']).nullable(),
  assignedDay7: z.boolean(), assignedDay30: z.boolean(), sourceCoverage,
}).refine(value => (value.responseKind === null) === (value.scorerConfiguration === null)
  && (value.protocolVersion === null || value.scorerConfiguration !== null), 'Frozen assignments require response and scorer strata')
  .refine(value => (value.status === 'admitted') === (value.protocolStatus === 'frozen'), 'Admission requires frozen protocol status')
  .refine(value => {
    const protocolPins = [value.protocolVersion, value.enrollmentAt, value.timezone, value.anchorKind,
      value.allocationOrder, value.responseKind, value.scorerConfiguration]
    return value.status === 'admitted'
      ? protocolPins.every(pin => pin !== null) && value.familyId !== null && value.familyRevision !== null
      : protocolPins.every(pin => pin === null) && value.anchorAt === null && !value.assignedDay7 && !value.assignedDay30
  }, 'Assignment pins must match storage admission state')
  .refine(value => value.status !== 'admitted' || (['AB', 'BA'].includes(value.allocationOrder!)
    ? value.assignedDay7 !== value.assignedDay30 : value.assignedDay7 && value.assignedDay30), 'Assignment horizons must match the frozen allocation')
export const learnReportResultSnapshotSchema = z.strictObject({
  submissionId: learnIdSchema<'learnResponses'>(), attemptId: learnIdSchema<'masteryAttempts'>(), executionId: learnIdSchema<'learnScoringExecutions'>(),
  kind: z.enum(['measurement_cold', 'measurement_delayed', 'independent_application', 'retained_transfer']),
  acceptedAt: learnTimestampSchema, scoreCommittedAt: learnTimestampSchema, scorePercent: learnScoreSchema, thresholdPercent: z.literal(80),
  caseId: learnIdSchema<'learnAssessmentCases'>(), itemId: learnIdSchema<'learnMeasurementItems'>().nullable(),
  familyRevision: learnRevisionSchema.nullable(), formLabel: z.enum(['A', 'B', 'C', 'D', 'E', 'F']).nullable(),
  scoringKind: z.enum(['deterministic', 'model']), configurationDigest: learnDigestSchema, scorerVersion: learnVersionSchema,
  observedModel: z.string().min(1).max(200).nullable(), observedUpstream: z.string().min(1).max(200).nullable(),
  identityVersion: learnVersionSchema, identityStatus: z.enum(['verified', 'unknown', 'mismatch', 'deterministic', 'unverified_legacy']),
  comparisonContractDigest: learnDigestSchema, supportManifestDigest: learnDigestSchema,
  assistanceState: z.enum(['unassisted', 'assisted', 'unknown']), assistancePolicyVersion: learnVersionSchema,
  validityStatus: z.enum(['valid', 'excluded', 'unknown']), exclusionReasons: learnReasonCodesSchema,
  measurementEligible: z.boolean(), masteryEligible: z.boolean(), evidenceAvailable: z.boolean(),
  pasteObserved: learnObservationSchema, focusLossObserved: learnObservationSchema, instrumentationVersion: learnVersionSchema,
  masteryStateBefore: masteryState, masteryStateAfter: masteryState,
}).refine(value => value.acceptedAt <= value.scoreCommittedAt
  && (value.scoringKind !== 'deterministic' || (value.identityStatus === 'deterministic' && value.observedModel === null && value.observedUpstream === null))
  && (!value.kind.startsWith('measurement_') || (value.itemId !== null && value.familyRevision !== null && value.formLabel !== null)), 'Inconsistent scalar result')

export const learnReportWatermarkSnapshotSchema = z.strictObject({
  kind: z.literal('owner_watermark'), learnerKey: learnReportOpaqueKeySchema,
  sequence: learnSequenceSchema, dueWorkThrough: learnTimestampSchema.nullable(), historyCoverage: sourceCoverage,
  legacyIndependentAudit: learnReportLegacyIndependentAuditSchema,
}).refine(value => value.historyCoverage !== 'unknown' || value.legacyIndependentAudit.sourceCoverage === 'unknown', 'Unknown history requires unknown legacy audit coverage')
export const learnReportColdReplacementSchema = z.strictObject({
  assessmentOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>(), replacesOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>(),
  replacementReason: learnCodeSchema, openAt: learnTimestampSchema, closeAt: learnTimestampSchema,
  eligibilityPolicyVersion: learnVersionSchema, operationalEligibility: z.enum(['pending', 'eligible', 'blocked']),
  acceptance: learnReportAcceptanceSnapshotSchema.nullable(), validitySnapshot: learnValiditySnapshotSchema.nullable(),
  result: learnReportResultSnapshotSchema.nullable(),
}).refine(value => value.openAt < value.closeAt && value.assessmentOpportunityId !== value.replacesOpportunityId,
  'Cold replacements require a distinct opportunity and bounded window')
  .refine(value => acceptedResultMatches(value.acceptance, value.result)
    && ((value.acceptance === null) === (value.validitySnapshot === null))
    && (value.result === null || value.result.kind === 'measurement_cold'), 'Cold replacement results require cold acceptance and eligibility pins')
  .refine(value => !value.validitySnapshot?.measurementEligible || (value.acceptance !== null
    && value.acceptance.acceptedAt >= value.openAt && value.acceptance.acceptedAt < value.closeAt), 'Eligible cold replacement acceptance must be inside its window')
  .refine(value => !value.result?.measurementEligible || value.validitySnapshot?.measurementEligible === true,
    'Cold replacement credit requires eligibility at acceptance')
export const learnReportEpisodeSnapshotSchema = z.strictObject({
  kind: z.literal('episode'), ...computationKeys, assignmentId: learnIdSchema<'learnMeasurementAssignments'>(),
  learningVoidId: learnIdSchema<'learningVoids'>(), blueprintRevisionId: learnIdSchema<'learnBlueprintRevisions'>(), objectiveId: learnIdSchema<'learnObjectives'>(),
  horizonDays: learnMeasurementHorizonSchema, assignment: learnReportAssignmentSnapshotSchema, clock: learnAssessmentClockSchema.nullable(),
  coldOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>().nullable(),
  originalOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>().nullable(), replacementOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>().nullable(),
  coldAcceptance: learnReportAcceptanceSnapshotSchema.nullable(), delayedAcceptance: learnReportAcceptanceSnapshotSchema.nullable(),
  cold: learnReportResultSnapshotSchema.nullable(), delayed: learnReportResultSnapshotSchema.nullable(),
  coldReplacement: learnReportColdReplacementSchema.nullable(),
  replacementClock: learnAssessmentClockSchema.nullable(),
  replacementAcceptance: learnReportAcceptanceSnapshotSchema.nullable(), replacement: learnReportResultSnapshotSchema.nullable(),
  replacementPolicy: learnReportReplacementPolicySchema.nullable(), operationalEligibility: z.enum(['pending', 'eligible', 'blocked']),
  disposition: learnReportDispositionSchema, reasonCodes: learnReasonCodesSchema, mixedFlow: z.boolean(), treatmentEpochChanged: z.boolean(),
}).refine(value => (value.cold === null || value.cold.kind === 'measurement_cold')
  && (value.delayed === null || value.delayed.kind === 'measurement_delayed')
  && (value.replacement === null || value.replacement.kind === 'measurement_delayed'), 'Incorrect measurement endpoint kind')
  .refine(value => value.assignment.status === 'admitted' || (value.horizonDays === 7 && value.clock === null
    && value.replacementClock === null && value.coldOpportunityId === null && value.originalOpportunityId === null && value.replacementOpportunityId === null
    && value.coldAcceptance === null && value.delayedAcceptance === null && value.replacementAcceptance === null
    && value.cold === null && value.delayed === null && value.replacement === null && value.coldReplacement === null), 'Non-admitted assignments have one inventory row without slots or outcomes')
  .refine(value => value.assignment.status !== 'admitted' || (value.horizonDays === 7 ? value.assignment.assignedDay7 : value.assignment.assignedDay30), 'Episode horizon must be assigned')
  .refine(value => acceptedResultMatches(value.coldAcceptance, value.cold) && acceptedResultMatches(value.delayedAcceptance, value.delayed)
    && acceptedResultMatches(value.replacementAcceptance, value.replacement), 'Results require their accepted submission and performance time')
  // #364 §4 freezes each opportunity's own clock; #366 §3 matures it at its own closeAt.
  .refine(value => (value.replacementOpportunityId === null) === (value.replacementClock === null), 'Replacement opportunities require their own clock')
  .refine(value => value.replacementClock === null || value.replacementClock.horizonDays === value.horizonDays, 'Replacement clock must match the episode horizon')
  .refine(value => (value.clock === null || value.clock.horizonDays === value.horizonDays)
    && (value.coldAcceptance === null || value.coldOpportunityId !== null)
    && (value.delayedAcceptance === null || value.originalOpportunityId !== null)
    && (value.replacementOpportunityId === null ? value.replacementAcceptance === null && value.replacement === null
      : value.originalOpportunityId !== null && value.replacementOpportunityId !== value.originalOpportunityId)
    && (value.coldOpportunityId === null || ![value.originalOpportunityId, value.replacementOpportunityId].includes(value.coldOpportunityId))
    && ((value.assignment.protocolVersion === null) === (value.replacementPolicy === null))
    && (value.replacementPolicy?.kind !== 'predeclared' || value.replacementPolicy.protocolVersion === value.assignment.protocolVersion), 'Inconsistent original or replacement slot pins')
  .refine(value => value.coldReplacement === null || (value.coldOpportunityId !== null
    && value.coldReplacement.replacesOpportunityId === value.coldOpportunityId
    && ![value.coldOpportunityId, value.originalOpportunityId, value.replacementOpportunityId].includes(value.coldReplacement.assessmentOpportunityId)),
  'Cold replacement must link to the original cold slot')
  .refine(value => {
    const submissions = [value.coldAcceptance, value.delayedAcceptance, value.replacementAcceptance, value.coldReplacement?.acceptance].flatMap(acceptance => acceptance ? [acceptance.submissionId] : [])
    const attempts = [value.cold, value.delayed, value.replacement, value.coldReplacement?.result].flatMap(result => result ? [result.attemptId] : [])
    return new Set(submissions).size === submissions.length && new Set(attempts).size === attempts.length
  }, 'Distinct slots require distinct submissions and attempts')
export const learnReportFirstClaimSnapshotSchema = z.strictObject({
  kind: z.literal('first_check_claim'), ...computationKeys, stratum: learnReportFirstSlotStratumSchema,
  claim: learnFirstCheckClaimSchema, firstCheckOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>(),
  checkSequence: learnRevisionSchema, clock: learnAssessmentClockSchema,
  stateAtEligibility: learnReportCapturedMasteryStateSchema, stateAtAcceptance: learnReportCapturedMasteryStateSchema.nullable(), acceptance: learnReportAcceptanceSnapshotSchema.nullable(),
  result: learnReportResultSnapshotSchema.nullable(),
  unresolvedReason: learnCodeSchema.nullable(),
}).refine(value => acceptedResultMatches(value.acceptance, value.result)
  && ((value.acceptance === null) === (value.stateAtAcceptance === null)), 'First-slot results and state require their accepted submission')
  .refine(value => value.result === null || ['measurement_delayed', 'retained_transfer'].includes(value.result.kind), 'Incorrect first-check endpoint kind')
function acceptedResultMatches(acceptance: z.infer<typeof learnReportAcceptanceSnapshotSchema> | null, result: z.infer<typeof learnReportResultSnapshotSchema> | null) {
  return result === null || (acceptance !== null && result.submissionId === acceptance.submissionId && result.acceptedAt === acceptance.acceptedAt)
}
export const learnReportInputSnapshotSchema = z.discriminatedUnion('kind', [learnReportWatermarkSnapshotSchema, learnReportEpisodeSnapshotSchema, learnReportFirstClaimSnapshotSchema])

export function reconcileLearnReportSourceRows(roster: readonly string[], rows: readonly z.infer<typeof learnReportInputSnapshotSchema>[]) {
  const reasons = new Set<string>()
  const owners = new Set(roster)
  const watermarks = new Set<string>()
  const identities = new Map<string, { count: number, snapshots: Set<string> }>()
  const assignments = new Map<string, string>()
  const assignmentHorizons = new Map<string, { expected: Set<number>, observed: Set<number> }>()
  const capabilityKeys = new Map<string, string>()
  const capabilityScopes = new Map<string, string>()
  type OutcomeBinding = { learnerKey: string, capabilityKey: string, owner: string | null, role: 'cold' | 'cold_replacement' | 'delayed' | 'replacement' | 'claim' }
  const outcomes = new Map<string, (OutcomeBinding & {
    snapshot: string, slotWindow: string | null,
  })[]>()
  const claimIdentities = new Set<string>()
  function reconcileOutcome(binding: OutcomeBinding, opportunityId: string | null,
    acceptance: z.infer<typeof learnReportAcceptanceSnapshotSchema> | null, result: z.infer<typeof learnReportResultSnapshotSchema> | null,
    clock: z.infer<typeof learnAssessmentClockSchema> | null = null) {
    const keys = [
      ...(opportunityId === null ? [] : [JSON.stringify(['opportunity', opportunityId])]),
      ...(acceptance === null ? [] : [JSON.stringify(['submission', acceptance.submissionId])]),
      ...(result === null ? [] : [JSON.stringify(['attempt', result.attemptId]), JSON.stringify(['execution', result.executionId])]),
    ]
    // The opportunity freezes its window/policy; the episode's protocol and claim's Independent anchors may differ.
    const slotWindow = clock === null ? null : JSON.stringify([
      clock.protocolVersion, clock.schedulingPolicyVersion, clock.horizonDays, clock.timezone,
      clock.dueLocalDate, clock.dueAt, clock.openAt, clock.closeAt,
    ])
    const outcome = { ...binding, snapshot: JSON.stringify([opportunityId, acceptance, result]), slotWindow }
    for (const key of keys) {
      const group = outcomes.get(key) ?? []
      group.push(outcome)
      outcomes.set(key, group)
    }
  }
  if (owners.size !== roster.length) reasons.add('duplicate_roster_owner')
  const validatedRows = rows.map(input => learnReportInputSnapshotSchema.parse(input))
  for (const row of validatedRows) {
    const identity = JSON.stringify(row.kind === 'owner_watermark' ? [row.kind, row.learnerKey]
      : row.kind === 'first_check_claim' ? [row.kind, row.learnerKey, row.capabilityKey, row.stratum.epoch]
        : [row.kind, row.assignmentId, row.horizonDays])
    const group = identities.get(identity) ?? { count: 0, snapshots: new Set<string>() }
    group.count += 1
    group.snapshots.add(JSON.stringify(row))
    identities.set(identity, group)
  }
  for (const group of identities.values()) {
    if (group.count > group.snapshots.size) reasons.add('duplicate_source_row')
    if (group.snapshots.size > 1) reasons.add('conflicting_source_row')
  }
  for (const row of validatedRows) {
    if (!owners.has(row.learnerKey)) reasons.add('owner_outside_roster')
    if (row.kind === 'owner_watermark') watermarks.add(row.learnerKey)
    if (row.kind === 'episode') {
      if (row.assignment.status === 'admitted') {
        const horizons = assignmentHorizons.get(row.assignmentId) ?? { expected: new Set<number>(), observed: new Set<number>() }
        if (row.assignment.assignedDay7) horizons.expected.add(7)
        if (row.assignment.assignedDay30) horizons.expected.add(30)
        horizons.observed.add(row.horizonDays)
        assignmentHorizons.set(row.assignmentId, horizons)
      }
      const scope = JSON.stringify([row.learnerKey, row.blueprintRevisionId, row.objectiveId])
      const capability = JSON.stringify([row.learnerKey, row.capabilityKey])
      if ((capabilityKeys.has(scope) && capabilityKeys.get(scope) !== row.capabilityKey)
        || (capabilityScopes.has(capability) && capabilityScopes.get(capability) !== scope)) reasons.add('conflicting_capability_key')
      capabilityKeys.set(scope, row.capabilityKey)
      capabilityScopes.set(capability, scope)
      const frozen = JSON.stringify([row.learnerKey, row.capabilityKey, row.learningVoidId, row.blueprintRevisionId, row.objectiveId,
        row.assignment, row.coldOpportunityId, row.coldAcceptance, row.cold, row.coldReplacement, row.replacementPolicy])
      if (assignments.has(row.assignmentId) && assignments.get(row.assignmentId) !== frozen) reasons.add('conflicting_assignment_snapshot')
      assignments.set(row.assignmentId, frozen)
      const binding = { learnerKey: row.learnerKey, capabilityKey: row.capabilityKey }
      reconcileOutcome({ ...binding, owner: JSON.stringify(['cold', row.assignmentId]), role: 'cold' }, row.coldOpportunityId, row.coldAcceptance, row.cold)
      if (row.coldReplacement) reconcileOutcome({ ...binding, owner: JSON.stringify(['cold_replacement', row.assignmentId]), role: 'cold_replacement' },
        row.coldReplacement.assessmentOpportunityId, row.coldReplacement.acceptance, row.coldReplacement.result)
      const episode = JSON.stringify(['episode', row.assignmentId, row.horizonDays])
      reconcileOutcome({ ...binding, owner: episode, role: 'delayed' }, row.originalOpportunityId, row.delayedAcceptance, row.delayed, row.clock)
      reconcileOutcome({ ...binding, owner: episode, role: 'replacement' }, row.replacementOpportunityId, row.replacementAcceptance, row.replacement, row.replacementClock)
    }
    if (row.kind === 'first_check_claim') {
      for (const [kind, value, reason] of [
        ['claim', row.claim.claimKey, 'duplicate_claim_key'],
        ['basis_attempt', row.claim.basisAttemptId, 'reused_claim_basis_attempt'],
        ['first_opportunity', row.firstCheckOpportunityId, 'reused_first_check_opportunity'],
      ] as const) {
        const key = JSON.stringify([kind, value])
        if (claimIdentities.has(key)) reasons.add(reason)
        else claimIdentities.add(key)
      }
      reconcileOutcome({ learnerKey: row.learnerKey, capabilityKey: row.capabilityKey, owner: null, role: 'claim' },
        row.firstCheckOpportunityId, row.acceptance, row.result, row.clock)
    }
  }
  for (const group of outcomes.values()) {
    const slots = group.filter(outcome => outcome.role !== 'claim')
    if (new Set(slots.map(slot => slot.owner)).size > 1) reasons.add('reused_outcome_identity')
    if (new Set(group.map(outcome => outcome.snapshot)).size > 1) reasons.add('conflicting_outcome_snapshot')
    // A shared measurement outcome must independently qualify for this owner's capability and delayed check.
    const claims = group.filter(outcome => outcome.role === 'claim')
    if (slots.length && claims.length) {
      if (group.some(outcome => outcome.learnerKey !== slots[0]!.learnerKey)) reasons.add('claim_learner_mismatch')
      if (group.some(outcome => outcome.capabilityKey !== slots[0]!.capabilityKey)) reasons.add('claim_capability_mismatch')
      if (slots.some(slot => slot.role === 'cold' || slot.role === 'cold_replacement')) reasons.add('claim_shared_cold_slot')
      const delayedSlots = slots.filter(slot => slot.role === 'delayed' || slot.role === 'replacement')
      if (delayedSlots.length && new Set([...delayedSlots, ...claims].map(outcome => outcome.slotWindow)).size > 1) reasons.add('conflicting_slot_window')
    }
  }
  // Only independent_application establishes Independent (#364 §5); no source endpoint admits that kind.
  // An absent ordinary V2 basis still requires canonical validation by the writer.
  for (const row of validatedRows) {
    if (row.kind !== 'first_check_claim') continue
    if (outcomes.has(JSON.stringify(['attempt', row.claim.basisAttemptId]))) reasons.add('invalid_claim_basis')
  }
  if (roster.some(owner => !watermarks.has(owner))) reasons.add('missing_owner_watermark')
  if ([...assignmentHorizons.values()].some(({ expected, observed }) => expected.size !== observed.size
    || [...expected].some(horizon => !observed.has(horizon)))) reasons.add('incomplete_assignment_horizons')
  return { status: reasons.size ? 'incomplete' as const : 'complete' as const, reasonCodes: [...reasons].sort() }
}
export const learnReportFactPayloadSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('enrollment'), assignmentId: learnIdSchema<'learnMeasurementAssignments'>(), recordRevision: learnRevisionSchema,
    status: z.enum(['considered', 'not_admitted', 'admitted']), snapshot: learnReportAssignmentSnapshotSchema })
    .refine(value => value.status === value.snapshot.status, 'Enrollment status must match the assignment snapshot'),
  z.strictObject({ kind: z.literal('opportunity'), assessmentOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>(), recordRevision: learnRevisionSchema,
    status: learnReportOpportunityStatusSchema, dueAt: learnTimestampSchema.nullable(), closeAt: learnTimestampSchema, clock: learnAssessmentClockSchema.nullable(), originalSlot: z.boolean(),
    stateAtEligibility: learnReportCapturedMasteryStateSchema.optional() }),
  z.strictObject({ kind: z.literal('response'), submissionId: learnIdSchema<'learnResponses'>(), acceptedAt: learnTimestampSchema,
    measurementEligible: z.boolean(), masteryEligible: z.boolean(), assistanceSnapshot: learnAssistanceSnapshotSchema, validitySnapshot: learnValiditySnapshotSchema,
    stateAtAcceptance: learnReportCapturedMasteryStateSchema.optional() }),
  z.strictObject({ kind: z.literal('score'), submissionId: learnIdSchema<'learnResponses'>(), attemptId: learnIdSchema<'masteryAttempts'>(),
    executionId: learnIdSchema<'learnScoringExecutions'>(), scorePercent: learnScoreSchema, scoreCommittedAt: learnTimestampSchema, snapshot: learnReportResultSnapshotSchema }),
  z.strictObject({ kind: z.literal('independent_claim'), ...learnFirstCheckClaimSchema.shape,
    firstCheckOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>(), checkSequence: learnRevisionSchema, stratum: learnReportFirstSlotStratumSchema }),
  z.strictObject({ kind: z.literal('integrity'), submissionId: learnIdSchema<'learnResponses'>(), integrityEventId: learnIdSchema<'learnResponseIntegrityEvents'>(),
    currentEligibility: z.enum(['eligible', 'excluded', 'unknown']), evidenceAvailable: z.boolean(), bodyAvailability: z.enum(['available', 'purged']) }),
])
export const learnReportFactSchema = z.strictObject({
  factVersion: z.literal(LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION), sequence: learnRevisionSchema,
  epoch: learnVersionSchema, occurredAt: learnTimestampSchema, fact: learnReportFactPayloadSchema,
})
export const learnReportSourceWatermarkSchema = z.strictObject({
  sourceVersion: z.literal(LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION), sequence: learnSequenceSchema,
  dueWorkThrough: learnTimestampSchema.nullable(), historyCoverage: sourceCoverage, updatedAt: learnTimestampSchema,
})

export const learnReportQuerySchema = z.strictObject({
  version: z.literal(LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION), cohortVersion: learnVersionSchema,
  epoch: learnVersionSchema, protocolVersion: learnVersionSchema,
  enrollmentStartAt: learnTimestampSchema, enrollmentEndAt: learnTimestampSchema, cutoff: learnTimestampSchema,
}).refine(value => value.enrollmentStartAt < value.enrollmentEndAt && value.enrollmentEndAt <= value.cutoff
  && value.enrollmentEndAt - value.enrollmentStartAt <= 90 * 86_400_000, 'Report enrollment range exceeds its bound')

export const learnReportSourcePageSchema = z.strictObject({
  version: z.literal(LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION), reportRunId: learnIdSchema<'learnMeasurementReportRuns'>(),
  sequence: learnSequenceSchema, sourceWatermark: learnSequenceSchema,
  rows: z.array(learnReportInputSnapshotSchema).max(8), cursor: z.string().min(1).max(2000).nullable(), isDone: z.boolean(),
}).refine(value => value.isDone === (value.cursor === null), 'Incomplete report cursor')
export function validateLearnReportSourcePage(input: unknown) {
  return parseLearnContract(learnReportSourcePageSchema, input, LEARN_MEASUREMENT_STORAGE_LIMITS.maxReportPageBytes)
}

export const learnReportProvenanceSchema = z.strictObject({
  kind: z.literal('aggregate_snapshot'), sourceVersion: z.literal(LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION),
  queryVersion: z.literal(LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION), adapterVersion: learnVersionSchema, codeVersion: learnVersionSchema,
  rosterDigest: learnDigestSchema, inputDigest: learnDigestSchema, cutoff: learnTimestampSchema,
  extractionStartedAt: learnTimestampSchema, extractionEndedAt: learnTimestampSchema, sourceCoverage,
  episodeCount: z.number().int().min(0).max(10_000), inputBytes: z.number().int().min(0).max(64 * 1024 * 1024),
  bootstrapSeed: learnDigestSchema, bootstrapReplicates: z.literal(10_000),
}).refine(value => value.extractionStartedAt <= value.extractionEndedAt, 'Invalid extraction range')
export const learnReportStratumSchema = z.strictObject({
  flow: learnMeasurementFlowSchema, entryPoint: learnVersionSchema, depth: learnMeasurementDepthSchema,
  startingBand: z.enum(LEARN_V2_REPORT_STARTING_BANDS), responseKind: z.enum(LEARN_V2_REPORT_RESPONSE_KINDS),
  scoringKind: z.enum(['deterministic', 'model']), configurationDigest: learnDigestSchema,
  observedModel: z.string().min(1).max(200).nullable(), observedUpstream: z.string().min(1).max(200).nullable(),
  familyValidationStatus: z.union([learnFamilyStatusSchema, z.literal('unknown')]),
})
export const learnReportDispositionCountsSchema = z.strictObject({
  missing_cold: count, missing_delayed: count, abandoned: count, assisted_contaminated: count,
  invalid_item_novelty: count, evidence_unavailable: count, pin_flow_treatment_mismatch: count,
  access_provider_blocked: count, scoring_pending: count, reconciliation_required: count, valid_scored: count,
})
export const learnReportPopulationCountsSchema = z.strictObject({
  considered: count, notAdmitted: count, horizonNotAssigned: count, anchorNotStarted: count, notYetDue: count, windowOpen: count,
  maturedEpisodes: count, operationallyEligible: count, acceptedSubmissions: count, validDelayedScores: count, validColdScores: count, comparablePairs: count,
  maturedClaims: count, checkedClaims: count, failedClaims: count,
  acceptedColdSubmissions: count, acceptedClaims: count, dispositions: learnReportDispositionCountsSchema,
  distinctLearners: z.strictObject({ maturedEpisodes: count, operationallyEligible: count, acceptedSubmissions: count,
    validDelayedScores: count, validColdScores: count, comparablePairs: count, maturedClaims: count, checkedClaims: count, failedClaims: count }),
}).refine(value => value.notAdmitted <= value.considered && value.maturedEpisodes + value.notAdmitted <= value.considered
  && value.operationallyEligible <= value.maturedEpisodes && value.acceptedSubmissions <= value.maturedEpisodes
  && value.validDelayedScores <= value.acceptedSubmissions && value.validColdScores <= value.acceptedColdSubmissions
  && value.acceptedColdSubmissions <= value.maturedEpisodes
  && value.comparablePairs <= Math.min(value.validDelayedScores, value.validColdScores)
  && value.acceptedClaims <= value.maturedClaims && value.checkedClaims <= value.acceptedClaims && value.failedClaims <= value.checkedClaims
  && Object.entries(value.distinctLearners).every(([key, learners]) => learners <= value[key as keyof typeof value.distinctLearners]), 'Inconsistent report counts')
const interval = z.strictObject({ lower: z.number().finite(), upper: z.number().finite() }).refine(value => value.lower <= value.upper)
const estimateFields = {
  status: learnReportStatusSchema, populationState: z.enum(['known', 'unknown']), sourceCoverage,
  outcomeCoverage: z.enum(['none', 'partial', 'complete', 'unknown']), validity: z.enum(['verified', 'provisional', 'quarantined', 'unknown']),
  precision: z.enum(['available', 'insufficient_clusters', 'insufficient_variation', 'unknown']),
  observedValue: z.number().finite().nullable(), allEligibleValue: z.number().finite().nullable(),
  missingOutcomeBounds: interval.nullable(), confidenceInterval: interval.nullable(), reasonCodes: learnReasonCodesSchema,
} as const
const estimateObject = z.strictObject({ population: count, observed: count, contributingLearners: count, ...estimateFields })
function refineEstimate(value: z.infer<typeof estimateObject>, ctx: z.RefinementCtx) {
  const { population, observed, contributingLearners: learners } = value
  if (observed > population || learners > observed
    || (!observed && value.observedValue !== null)
    || ((!population || observed < population || value.populationState !== 'known' || value.sourceCoverage !== 'complete') && value.allEligibleValue !== null)
    || ((!population || value.populationState !== 'known' || value.sourceCoverage !== 'complete') && value.missingOutcomeBounds !== null)
    || (value.status === 'observed_complete' && (!population || observed !== population || value.outcomeCoverage !== 'complete'))
    || (value.status === 'partial_observed' && (!observed || observed >= population || value.outcomeCoverage !== 'partial'))
    || (value.status === 'no_eligible_population' && population !== 0)
    || ((value.precision !== 'available' || learners < 20) && value.confidenceInterval !== null)
    || ((value.observedValue === null || value.allEligibleValue === null || value.confidenceInterval === null) && !value.reasonCodes.length)) {
    ctx.addIssue({ code: 'custom', message: 'Unknown or incomplete measurement must have explicit nulls and reasons' })
  }
}
export const learnReportEstimateSchema = estimateObject.superRefine(refineEstimate)
export const learnReportReplacementAccountingSchema = z.strictObject({
  policy: learnReportReplacementPolicySchema,
  originalPopulation: count, withLinkedReplacement: count, withAcceptedReplacement: count, withValidReplacement: count,
  withComparableReplacement: count, primaryIncludedPairs: count, secondary: learnReportEstimateSchema,
}).refine(value => value.withLinkedReplacement <= value.originalPopulation
  && value.withAcceptedReplacement <= value.withLinkedReplacement && value.withValidReplacement <= value.withAcceptedReplacement
  && value.withComparableReplacement <= value.withValidReplacement && value.primaryIncludedPairs <= value.withComparableReplacement
  && (value.policy.kind === 'predeclared' || value.primaryIncludedPairs === 0)
  && value.secondary.population === value.withLinkedReplacement, 'Replacement counts must retain their original population')
export const learnReportInstrumentationCountsSchema = z.strictObject({
  pasteFlagged: count, focusFlagged: count, eitherFlagged: count, unknownUnflagged: count, knownUnflagged: count,
  pasteUnknown: count, focusUnknown: count, unknownInstrumentation: count, flaggedWithUnknownInstrumentation: count,
}).refine(value => value.eitherFlagged >= Math.max(value.pasteFlagged, value.focusFlagged)
  && value.eitherFlagged <= value.pasteFlagged + value.focusFlagged
  && value.unknownInstrumentation >= Math.max(value.pasteUnknown, value.focusUnknown)
  && value.unknownInstrumentation <= value.pasteUnknown + value.focusUnknown
  && value.flaggedWithUnknownInstrumentation <= value.eitherFlagged
  && value.flaggedWithUnknownInstrumentation + value.unknownUnflagged === value.unknownInstrumentation, 'Invalid instrumentation union')
export const learnReportSensitivitySchema = z.strictObject({
  policyVersion: z.literal(LEARN_V2_REPORT_SENSITIVITY_POLICY_VERSION), excludingFlagged: learnReportEstimateSchema,
})
export const learnReportOrderCountsSchema = z.strictObject({ ABC: count, ACB: count, BAC: count, BCA: count, CAB: count, CBA: count, AB: count, BA: count, unknown: count })
export const learnReportFormCountsSchema = z.strictObject({ A: count, B: count, C: count, D: count, E: count, F: count, unknown: count })
export const learnReportAllocationCountsSchema = z.strictObject({
  assignedOrders: learnReportOrderCountsSchema, observedOrders: learnReportOrderCountsSchema,
  assignedColdForms: learnReportFormCountsSchema, observedColdForms: learnReportFormCountsSchema,
  assignedDelayedForms: learnReportFormCountsSchema, observedDelayedForms: learnReportFormCountsSchema,
}).refine(value => Object.keys(value.assignedOrders).every(key => value.observedOrders[key as keyof typeof value.observedOrders] <= value.assignedOrders[key as keyof typeof value.assignedOrders]), 'Observed orders exceed assignments')
export const learnReportSourceReasonCountSchema = z.strictObject({ covered: count, affected: count, unknown: count })
  .refine(value => value.affected <= value.covered, 'Affected rows require source coverage')
export const learnReportSourceAccountingSchema = z.strictObject({
  population: count, missingT0: learnReportSourceReasonCountSchema, unknownExposure: learnReportSourceReasonCountSchema,
  exhaustedInventory: learnReportSourceReasonCountSchema, purgedEvidence: learnReportSourceReasonCountSchema,
  replacement: learnReportSourceReasonCountSchema, treatmentChange: learnReportSourceReasonCountSchema, outsideHelpUncertainty: learnReportSourceReasonCountSchema,
}).refine(value => [value.missingT0, value.unknownExposure, value.exhaustedInventory, value.purgedEvidence,
  value.replacement, value.treatmentChange, value.outsideHelpUncertainty].every(reason => reason.covered + reason.unknown === value.population), 'Source reason coverage must reconcile')
const bandCounts = z.strictObject({ population: count, accepted: count, validScored: count, paired: count })
  .refine(value => value.paired <= value.validScored && value.validScored <= value.accepted && value.accepted <= value.population)
export const learnReportBandAttritionSchema = z.strictObject({ below40: bandCounts, from40To80: bandCounts, from80To100: bandCounts, unknown: bandCounts })

export const learnReportMetricSchema = z.strictObject({
  metric: z.enum([VERIFIED_LEARNING_GAIN_VERSION, FALSE_MASTERY_NEXT_DELAYED_VERSION]), horizonDays: learnMeasurementHorizonSchema,
  weighting: z.enum(['capability_episode', 'learner_sensitivity']), stratum: learnReportStratumSchema,
  ...estimateFields, counts: learnReportPopulationCountsSchema,
  legacyIndependentAudit: learnReportLegacyIndependentAuditSchema,
  replacements: learnReportReplacementAccountingSchema, instrumentation: learnReportInstrumentationCountsSchema,
  sensitivity: learnReportSensitivitySchema, allocations: learnReportAllocationCountsSchema,
  sourceAccounting: learnReportSourceAccountingSchema, attritionByStartingBand: learnReportBandAttritionSchema,
}).superRefine((value, ctx) => {
  const gain = value.metric === VERIFIED_LEARNING_GAIN_VERSION
  const population = gain ? value.counts.maturedEpisodes : value.counts.maturedClaims
  const observed = gain ? value.counts.comparablePairs : value.counts.checkedClaims
  const learners = gain ? value.counts.distinctLearners.comparablePairs : value.counts.distinctLearners.checkedClaims
  const accepted = gain ? value.counts.acceptedSubmissions : value.counts.acceptedClaims
  const scored = gain ? value.counts.validDelayedScores : value.counts.checkedClaims
  refineEstimate({ ...value, population, observed, contributingLearners: learners }, ctx)
  const estimates = [value, value.replacements.secondary, value.sensitivity.excludingFlagged]
  const validityStates = {
    verified: ['verified', 'provisional', 'unknown', 'quarantined'], provisional: ['provisional', 'unknown', 'quarantined'],
    unknown: ['unknown', 'quarantined'], quarantined: ['quarantined'],
  }
  const parentValidity = value.status === 'quarantined' ? 'quarantined' : value.validity
  if (estimates.slice(1).some(estimate => (value.populationState === 'unknown' && estimate.populationState !== 'unknown')
    || ((value.sourceCoverage === 'unknown' || value.status === 'unknown_source_coverage') && estimate.sourceCoverage !== 'unknown')
    || !validityStates[parentValidity].includes(estimate.validity))) {
    ctx.addIssue({ code: 'custom', message: 'Sub-estimates cannot claim stronger population, source coverage or validity than their parent cell' })
  }
  const minimum = gain ? -100 : 0
  const maximum = gain ? 100 : 1
  if (estimates.some(estimate => [estimate.observedValue, estimate.allEligibleValue, estimate.missingOutcomeBounds?.lower,
    estimate.missingOutcomeBounds?.upper, estimate.confidenceInterval?.lower, estimate.confidenceInterval?.upper]
    .some(number => number != null && (number < minimum || number > maximum)))) ctx.addIssue({ code: 'custom', message: 'Estimate exceeds the frozen metric scale' })
  const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, number) => total + number, 0)
  const bands = Object.values(value.attritionByStartingBand)
  const originalFormsMatch = (assigned: z.infer<typeof learnReportFormCountsSchema>, observed: z.infer<typeof learnReportFormCountsSchema>) =>
    Object.keys(assigned).every(key => observed[key as keyof typeof observed] <= assigned[key as keyof typeof assigned])
  const selectedBand = { '0_40': 'below40', '40_80': 'from40To80', '80_100': 'from80To100', unknown: 'unknown' } as const
  if (sum(value.counts.dispositions) !== population || value.counts.dispositions.valid_scored > scored
    || value.replacements.originalPopulation !== population || value.replacements.primaryIncludedPairs > observed
    || (!gain && value.replacements.primaryIncludedPairs !== 0)
    || value.replacements.secondary.observed !== (gain ? value.replacements.withComparableReplacement : value.replacements.withValidReplacement)
    || value.instrumentation.eitherFlagged + value.instrumentation.unknownUnflagged + value.instrumentation.knownUnflagged !== population
    || value.instrumentation.pasteFlagged + value.instrumentation.pasteUnknown > population
    || value.instrumentation.focusFlagged + value.instrumentation.focusUnknown > population
    || value.sensitivity.excludingFlagged.population !== population - value.instrumentation.eitherFlagged
    || value.sensitivity.excludingFlagged.observed > observed || value.sensitivity.excludingFlagged.contributingLearners > learners
    || value.sensitivity.excludingFlagged.observed < Math.max(0, observed - value.instrumentation.eitherFlagged)
    || value.sensitivity.excludingFlagged.contributingLearners < Math.max(0, learners - (observed - value.sensitivity.excludingFlagged.observed))
    || sum(value.allocations.assignedOrders) !== population || sum(value.allocations.observedOrders) !== accepted
    || sum(value.allocations.assignedColdForms) !== value.counts.maturedEpisodes
    || sum(value.allocations.observedColdForms) !== value.counts.acceptedColdSubmissions
    || sum(value.allocations.assignedDelayedForms) !== population || sum(value.allocations.observedDelayedForms) !== accepted
    || (value.replacements.policy.kind === 'secondary_only' && (!originalFormsMatch(value.allocations.assignedColdForms, value.allocations.observedColdForms)
      || !originalFormsMatch(value.allocations.assignedDelayedForms, value.allocations.observedDelayedForms)))
    || value.sourceAccounting.population < Math.max(population, value.counts.considered)
    || value.sourceAccounting.replacement.affected < value.replacements.withLinkedReplacement
    || bands.reduce((total, band) => total + band.population, 0) !== population
    || bands.reduce((total, band) => total + band.accepted, 0) !== accepted
    || bands.reduce((total, band) => total + band.validScored, 0) !== scored
    || bands.reduce((total, band) => total + band.paired, 0) !== observed
    || (value.stratum.startingBand !== 'all' && value.attritionByStartingBand[selectedBand[value.stratum.startingBand]].population !== population)) {
    ctx.addIssue({ code: 'custom', message: 'Aggregate breakdowns do not reconcile with the original population' })
  }
})
export const learnMeasurementReportSchema = z.discriminatedUnion('status', [
  z.strictObject({ version: z.literal(LEARN_V2_MEASUREMENT_REPORT_VERSION), status: z.literal('sealed'),
    reportRunId: learnIdSchema<'learnMeasurementReportRuns'>(), query: learnReportQuerySchema, provenance: learnReportProvenanceSchema }),
  z.strictObject({ version: z.literal(LEARN_V2_MEASUREMENT_REPORT_VERSION), status: z.enum(['disabled', 'unavailable', 'building', 'failed', 'stale']),
    reasonCodes: learnReasonCodesSchema.refine(values => values.length > 0) }),
])
export const learnMeasurementReportCellsSchema = z.strictObject({
  version: z.literal(LEARN_V2_MEASUREMENT_REPORT_VERSION), reportRunId: learnIdSchema<'learnMeasurementReportRuns'>(),
  cells: z.array(learnReportMetricSchema).max(8), cursor: z.string().min(1).max(2000).nullable(), isDone: z.boolean(),
}).refine(value => value.isDone === (value.cursor === null)).refine(value => {
  const audit = value.cells[0]?.legacyIndependentAudit
  return value.cells.every(cell => cell.legacyIndependentAudit.unknownCount === audit?.unknownCount
    && cell.legacyIndependentAudit.sourceCoverage === audit?.sourceCoverage)
}, 'Cells must repeat the same cohort legacy audit')
export function validateLearnMeasurementReportCells(input: unknown) {
  return parseLearnContract(learnMeasurementReportCellsSchema, input, LEARN_MEASUREMENT_STORAGE_LIMITS.maxReportPageBytes)
}

export type LearnReportSourceFact = z.infer<typeof learnReportFactSchema>
export type LearnReportInputSnapshot = z.infer<typeof learnReportInputSnapshotSchema>
export type LearnMeasurementReport = z.infer<typeof learnMeasurementReportSchema>
export type LearnReportMetric = z.infer<typeof learnReportMetricSchema>

type ReportEpisode = z.infer<typeof learnReportEpisodeSnapshotSchema>
type ReportClaim = z.infer<typeof learnReportFirstClaimSnapshotSchema>
type ReportResult = z.infer<typeof learnReportResultSnapshotSchema>
type ReportAcceptance = z.infer<typeof learnReportAcceptanceSnapshotSchema>
type ReportClock = z.infer<typeof learnAssessmentClockSchema>
type ReportBand = Exclude<LearnReportMetric['stratum']['startingBand'], 'all'>
type ReportStage = 'matured' | 'anchor_not_started' | 'not_yet_due' | 'window_open' | 'not_assigned' | 'unknown'
type ComputedReportRow = {
  learnerKey: string, band: ReportBand, stage: ReportStage, known: boolean, reasons: string[],
  observation: ReportObservation, secondary: ReportObservation | null, disposition: z.infer<typeof learnReportDispositionSchema>,
  eligible: boolean, acceptedCold: boolean, accepted: boolean, validCold: boolean, validDelayed: boolean,
  replacementAccepted: boolean, replacementValid: boolean, primaryIncluded: boolean,
  paste: z.infer<typeof learnObservationSchema>, focus: z.infer<typeof learnObservationSchema>,
  order: keyof z.infer<typeof learnReportOrderCountsSchema>, coldForm: string, delayedForm: string,
  observedColdForm: string | null, observedDelayedForm: string | null,
}
type ReportGroup = { metric: LearnReportMetric['metric'], horizon: 7 | 30, stratum: LearnReportMetric['stratum'],
  policy: LearnReportMetric['replacements']['policy'], rows: ComputedReportRow[], sourceRows: ReportClaim[] }

function validatedReportRows(rows: readonly unknown[]) {
  if (rows.length > 4 * LEARN_MEASUREMENT_STORAGE_LIMITS.maxReportEpisodes) throw new Error('Report source exceeds its row ceiling')
  let inputBytes = 2
  const validated = rows.map((row, index) => {
    inputBytes += learnSerializedBytes(row, LEARN_MEASUREMENT_STORAGE_LIMITS.maxReportPageBytes) + (index ? 1 : 0)
    if (inputBytes > LEARN_MEASUREMENT_STORAGE_LIMITS.maxReportInputBytes) throw new Error('Report source exceeds its byte ceiling')
    return learnReportInputSnapshotSchema.parse(row)
  })
  return { rows: validated, inputBytes }
}

/** Canonical permitted-input fingerprint; a matching digest is not proof of source authority. */
export async function fingerprintLearnReportInput(roster: readonly string[], rows: readonly LearnReportInputSnapshot[]) {
  const owners = z.array(learnReportOpaqueKeySchema).max(10_000).parse(roster).sort()
  const validated = validatedReportRows(rows)
  return fingerprintValidatedReportInput(owners, validated)
}
async function fingerprintValidatedReportInput(owners: string[], validated: ReturnType<typeof validatedReportRows>) {
  const canonical = validated.rows.map(row => JSON.stringify(row)).sort()
  const inputBytes = validated.inputBytes + learnSerializedBytes(owners, LEARN_MEASUREMENT_STORAGE_LIMITS.maxReportInputBytes) + '{"roster":,"rows":}'.length
  if (inputBytes > LEARN_MEASUREMENT_STORAGE_LIMITS.maxReportInputBytes) throw new Error('Report source exceeds its byte ceiling')
  const assignments = new Set(validated.rows.flatMap(row => row.kind === 'episode' ? [row.assignmentId] : []))
  const claims = validated.rows.filter(row => row.kind === 'first_check_claim')
  if (assignments.size > 10_000 || claims.length > 10_000) throw new Error('Report population exceeds its ceiling')
  const inputDigest = await reportKeyDigest([LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, JSON.stringify(owners), `[${canonical.join(',')}]`])
  return { inputDigest, rosterDigest: await reportKeyDigest(owners), bootstrapSeed: inputDigest,
    inputBytes, episodeCount: assignments.size }
}

export function rollUpLearnReportLegacyAudit(roster: readonly string[], rows: readonly LearnReportInputSnapshot[]) {
  const owners = new Set(z.array(learnReportOpaqueKeySchema).max(10_000).parse(roster))
  const audits = new Map<string, { count: number, row: z.infer<typeof learnReportWatermarkSnapshotSchema> }>()
  for (const input of rows) {
    if (input.kind !== 'owner_watermark' || !owners.has(input.learnerKey)) continue
    const row = learnReportWatermarkSnapshotSchema.parse(input)
    const previous = audits.get(row.learnerKey)
    audits.set(row.learnerKey, { count: (previous?.count ?? 0) + 1, row })
  }
  let total = 0
  for (const owner of owners) {
    const snapshots = audits.get(owner)
    const snapshot = snapshots?.row
    if (snapshots?.count !== 1 || !snapshot || snapshot.historyCoverage !== 'complete'
      || snapshot.legacyIndependentAudit.sourceCoverage !== 'complete' || snapshot.legacyIndependentAudit.unknownCount === null) {
      return { unknownCount: null, sourceCoverage: 'unknown' as const }
    }
    total += snapshot.legacyIndependentAudit.unknownCount
    if (total > 10_000) return { unknownCount: null, sourceCoverage: 'unknown' as const }
  }
  return { unknownCount: total, sourceCoverage: 'complete' as const }
}

function acceptedBy(acceptance: ReportAcceptance | null, cutoff: number) {
  return acceptance !== null && acceptance.acceptedAt <= cutoff
}
function resultBy(result: ReportResult | null, cutoff: number) {
  return result !== null && result.scoreCommittedAt <= cutoff ? result : null
}
function validReportResult(result: ReportResult | null, cutoff: number, configuration: z.infer<typeof learnReportScorerConfigurationSchema>,
  clock: Pick<ReportClock, 'openAt' | 'closeAt'> | null, mastery = false) {
  return result !== null && result.scoreCommittedAt <= cutoff && result.acceptedAt <= cutoff
    && result.validityStatus === 'valid' && result.evidenceAvailable && result.assistanceState === 'unassisted'
    && (mastery ? result.masteryEligible : result.measurementEligible)
    && (clock === null || (result.acceptedAt >= clock.openAt && result.acceptedAt < clock.closeAt))
    && result.scoringKind === configuration.scoringKind && result.configurationDigest === configuration.configurationDigest
    && result.scorerVersion === configuration.scorerVersion
    && (result.scoringKind === 'deterministic' ? result.identityStatus === 'deterministic'
      : result.identityStatus === 'verified' && result.observedModel !== null && result.observedUpstream !== null)
}
function reportBand(cold: ReportResult | null): ReportBand {
  return cold === null ? 'unknown' : cold.scorePercent < 40 ? '0_40' : cold.scorePercent < 80 ? '40_80' : '80_100'
}
function slotStage(clock: ReportClock | null, anchorAt: number | null, cutoff: number): ReportStage {
  if (anchorAt === null) return 'anchor_not_started'
  if (clock === null) return 'unknown'
  return clock.closeAt <= cutoff ? 'matured' : clock.openAt > cutoff ? 'not_yet_due' : 'window_open'
}
function reportFlags(results: readonly (ReportResult | null)[], key: 'pasteObserved' | 'focusLossObserved') {
  return results.some(result => result?.[key] === true) ? true
    : results.some(result => result === null || result[key] === 'unknown') ? 'unknown' as const : false
}
function comparableReportPair(cold: ReportResult | null, delayed: ReportResult | null) {
  return cold !== null && delayed !== null && cold.caseId !== delayed.caseId && cold.itemId !== delayed.itemId
    && cold.familyRevision === delayed.familyRevision && cold.comparisonContractDigest === delayed.comparisonContractDigest
    && cold.scoringKind === delayed.scoringKind && cold.configurationDigest === delayed.configurationDigest
    && cold.scorerVersion === delayed.scorerVersion && cold.identityVersion === delayed.identityVersion
    && cold.observedModel === delayed.observedModel && cold.observedUpstream === delayed.observedUpstream
    && cold.assistancePolicyVersion === delayed.assistancePolicyVersion
}
function reportObservation(learnerKey: string, cold: ReportResult | null, delayed: ReportResult | null, comparable: boolean): ReportObservation {
  const value = comparable && cold && delayed ? delayed.scorePercent - cold.scorePercent : null
  return { learnerKey, value, lower: value ?? (cold ? -cold.scorePercent : -100), upper: value ?? (cold ? 100 - cold.scorePercent : 100) }
}
function reportDisposition(reasons: readonly string[], valid: boolean): z.infer<typeof learnReportDispositionSchema> {
  if (valid) return 'valid_scored'
  for (const disposition of ['reconciliation_required', 'evidence_unavailable', 'pin_flow_treatment_mismatch', 'assisted_contaminated',
    'invalid_item_novelty', 'access_provider_blocked', 'abandoned', 'scoring_pending', 'missing_cold', 'missing_delayed'] as const) {
    if (reasons.includes(disposition)) return disposition
  }
  return 'missing_delayed'
}
function endpointReasons(result: ReportResult | null, acceptance: ReportAcceptance | null, cutoff: number,
  configuration: z.infer<typeof learnReportScorerConfigurationSchema>, clock: Pick<ReportClock, 'openAt' | 'closeAt'> | null) {
  const reasons: string[] = []
  if (acceptedBy(acceptance, cutoff) && resultBy(result, cutoff) === null) reasons.push('scoring_pending')
  if (result === null || result.scoreCommittedAt > cutoff) return reasons
  if (!result.evidenceAvailable) reasons.push('evidence_unavailable')
  if (result.assistanceState !== 'unassisted') reasons.push('assisted_contaminated')
  if (['unknown', 'unverified_legacy'].includes(result.identityStatus)) reasons.push('scorer_identity_unknown')
  if (result.scoringKind !== configuration.scoringKind || result.configurationDigest !== configuration.configurationDigest
    || result.scorerVersion !== configuration.scorerVersion || ['mismatch', 'unknown', 'unverified_legacy'].includes(result.identityStatus)
    || (result.scoringKind === 'model' && (result.observedModel === null || result.observedUpstream === null))) reasons.push('pin_flow_treatment_mismatch')
  if (clock && (result.acceptedAt < clock.openAt || result.acceptedAt >= clock.closeAt)) reasons.push('invalid_item_novelty')
  if (result.validityStatus !== 'valid' || !result.measurementEligible) {
    for (const reason of result.exclusionReasons) {
      if (['evidence_unavailable', 'purged_evidence'].includes(reason)) reasons.push('evidence_unavailable')
      else if (['assisted', 'assistance_unknown', 'pre_seal_contamination'].includes(reason)) reasons.push('assisted_contaminated')
      else if (['pins_mismatch', 'mixed_flow', 'treatment_epoch_changed'].includes(reason)) reasons.push('pin_flow_treatment_mismatch')
      else if (reason !== 'retained_promotion_ineligible') reasons.push('invalid_item_novelty')
    }
  }
  return reasons
}

function computeEpisodeRow(row: ReportEpisode, horizon: 7 | 30, cutoff: number): ComputedReportRow {
  const assignment = row.assignment
  const configuration = assignment.scorerConfiguration!
  const order = assignment.allocationOrder!
  const coldForm = order[0]!
  const delayedForm = order[order.length === 2 || horizon === 7 ? 1 : 2]!
  const originalCold = validReportResult(row.cold, cutoff, configuration, null)
    && row.cold?.familyRevision === assignment.familyRevision && row.cold?.formLabel === coldForm ? row.cold : null
  const coldReplacement = row.coldReplacement
  const useColdReplacement = row.replacementPolicy?.kind === 'predeclared' && coldReplacement !== null
  const useDelayedReplacement = row.replacementPolicy?.kind === 'predeclared' && row.replacementOpportunityId !== null
  const selectedCold = useColdReplacement ? coldReplacement.result : row.cold
  const selectedColdAcceptance = useColdReplacement ? coldReplacement.acceptance : row.coldAcceptance
  const selectedDelayed = useDelayedReplacement ? row.replacement : row.delayed
  const selectedDelayedAcceptance = useDelayedReplacement ? row.replacementAcceptance : row.delayedAcceptance
  const selectedClock = useDelayedReplacement ? row.replacementClock : row.clock
  const coldWindow = useColdReplacement ? coldReplacement : null
  const familyValid = assignment.familyValidationStatus !== 'quarantined' && assignment.historyStatus !== 'unknown'
  const coldValid = familyValid && validReportResult(selectedCold, cutoff, configuration, coldWindow)
    && selectedCold?.familyRevision === assignment.familyRevision && (useColdReplacement || selectedCold?.formLabel === coldForm)
    && (!useColdReplacement || coldReplacement.closeAt <= cutoff)
  const delayedValid = familyValid && selectedClock !== null && validReportResult(selectedDelayed, cutoff, configuration, selectedClock)
    && selectedDelayed?.familyRevision === assignment.familyRevision && (useDelayedReplacement || selectedDelayed?.formLabel === delayedForm)
    && (!useDelayedReplacement || selectedClock.closeAt <= cutoff)
  const cold = coldValid ? selectedCold : null
  const delayed = delayedValid ? selectedDelayed : null
  const originalExcluded = ['abandoned', 'assisted_contaminated', 'invalid_item_novelty', 'evidence_unavailable',
    'pin_flow_treatment_mismatch', 'access_provider_blocked', 'reconciliation_required'].includes(row.disposition)
  const pair = !row.mixedFlow && !row.treatmentEpochChanged && (!(originalExcluded && !useColdReplacement && !useDelayedReplacement))
    && comparableReportPair(cold, delayed)
  const assigned = horizon === 7 ? assignment.assignedDay7 : assignment.assignedDay30
  const stage = assigned ? slotStage(row.clock, assignment.anchorAt, cutoff) : 'not_assigned'
  const reasons = [
    ...endpointReasons(selectedCold, selectedColdAcceptance, cutoff, configuration, coldWindow),
    ...endpointReasons(selectedDelayed, selectedDelayedAcceptance, cutoff, configuration, selectedClock),
  ]
  if (row.mixedFlow || row.treatmentEpochChanged) reasons.push('pin_flow_treatment_mismatch')
  if (!familyValid || (cold && delayed && !comparableReportPair(cold, delayed))) reasons.push('invalid_item_novelty')
  if (assignment.historyStatus === 'unknown') reasons.push('unknown_history')
  if (!cold) reasons.push('missing_cold')
  if (!delayed) reasons.push('missing_delayed')
  if (row.disposition !== 'valid_scored' && !['missing_cold', 'missing_delayed'].includes(row.disposition)) reasons.push(row.disposition)
  const linked = coldReplacement !== null || row.replacementOpportunityId !== null
  const secondaryCold = coldReplacement ? coldReplacement.result : row.cold
  const secondaryDelayed = row.replacementOpportunityId ? row.replacement : row.delayed
  const secondaryColdValid = familyValid && validReportResult(secondaryCold, cutoff, configuration, coldReplacement)
    && secondaryCold?.familyRevision === assignment.familyRevision
    && (!coldReplacement || (coldReplacement.validitySnapshot?.measurementEligible === true && coldReplacement.closeAt <= cutoff))
    && (coldReplacement !== null || secondaryCold?.formLabel === coldForm)
  const secondaryClock = row.replacementOpportunityId ? row.replacementClock : row.clock
  const secondaryDelayedValid = familyValid && secondaryClock !== null && secondaryClock.closeAt <= cutoff
    && validReportResult(secondaryDelayed, cutoff, configuration, secondaryClock) && secondaryDelayed?.familyRevision === assignment.familyRevision
    && (row.replacementOpportunityId !== null || secondaryDelayed?.formLabel === delayedForm)
  const secondaryPair = linked && secondaryColdValid && secondaryDelayedValid && !row.mixedFlow && !row.treatmentEpochChanged
    && comparableReportPair(secondaryCold, secondaryDelayed)
  return { learnerKey: row.learnerKey, band: reportBand(originalCold), stage,
    known: assignment.sourceCoverage === 'complete' && assignment.historyStatus !== 'unknown' && stage !== 'unknown', reasons: [...new Set(reasons)],
    observation: reportObservation(row.learnerKey, cold, delayed, pair),
    secondary: linked ? reportObservation(row.learnerKey, secondaryColdValid ? secondaryCold : null, secondaryDelayedValid ? secondaryDelayed : null, secondaryPair) : null,
    disposition: reportDisposition(reasons, pair), eligible: row.operationalEligibility === 'eligible',
    acceptedCold: acceptedBy(selectedColdAcceptance, cutoff), accepted: acceptedBy(selectedDelayedAcceptance, cutoff), validCold: cold !== null, validDelayed: delayed !== null,
    replacementAccepted: acceptedBy(coldReplacement?.acceptance ?? null, cutoff) || acceptedBy(row.replacementAcceptance, cutoff),
    replacementValid: (coldReplacement !== null && secondaryColdValid) || (row.replacementOpportunityId !== null && secondaryDelayedValid),
    primaryIncluded: pair && (useColdReplacement || useDelayedReplacement),
    paste: reportFlags([resultBy(selectedCold, cutoff), resultBy(selectedDelayed, cutoff)], 'pasteObserved'),
    focus: reportFlags([resultBy(selectedCold, cutoff), resultBy(selectedDelayed, cutoff)], 'focusLossObserved'),
    order, coldForm, delayedForm, observedColdForm: acceptedBy(selectedColdAcceptance, cutoff) ? (useColdReplacement ? selectedCold?.formLabel ?? 'unknown' : coldForm) : null,
    observedDelayedForm: acceptedBy(selectedDelayedAcceptance, cutoff) ? (useDelayedReplacement ? selectedDelayed?.formLabel ?? 'unknown' : delayedForm) : null }
}

function computeClaimRow(row: ReportClaim, cutoff: number, cold: ReportResult | null): ComputedReportRow {
  const result = resultBy(row.result, cutoff)
  const timeEligible = localDateAt(row.clock.dueAt, row.claim.firstIndependentTimezone) >= addCalendarDays(row.claim.firstIndependentLocalDate, 7)
    && (row.acceptance === null || localDateAt(row.acceptance.acceptedAt, row.claim.firstIndependentTimezone) >= addCalendarDays(row.claim.firstIndependentLocalDate, 7))
  const stateEligible = ['independent', 'retained'].includes(row.stateAtEligibility)
    && (row.stateAtAcceptance === null || ['independent', 'retained'].includes(row.stateAtAcceptance))
  const valid = timeEligible && stateEligible && row.unresolvedReason === null
    && validReportResult(result, cutoff, row.stratum.scorerConfiguration, row.clock, true)
    && (row.stratum.familyId === null || result?.familyRevision === row.stratum.familyRevision)
    && row.stratum.familyValidationStatus !== 'quarantined'
  const reasons = endpointReasons(row.result, row.acceptance, cutoff, row.stratum.scorerConfiguration, row.clock)
  const stateKnown = row.stateAtEligibility !== 'unknown' && row.stateAtAcceptance !== 'unknown'
  if (!stateKnown) reasons.push('unknown_prior_state')
  if (!timeEligible || !stateEligible) reasons.push('invalid_item_novelty')
  if (row.unresolvedReason) reasons.push(LEARN_V2_REPORT_DISPOSITIONS.includes(row.unresolvedReason as z.infer<typeof learnReportDispositionSchema>)
    ? row.unresolvedReason : 'reconciliation_required')
  if (!valid && !row.acceptance) reasons.push('missing_delayed')
  const value = valid && result ? (result.scorePercent < result.thresholdPercent ? 1 : 0) : null
  return { learnerKey: row.learnerKey, band: reportBand(cold), stage: slotStage(row.clock, row.claim.firstIndependentAt, cutoff), known: stateKnown,
    reasons: [...new Set(reasons)], observation: { learnerKey: row.learnerKey, value, lower: value ?? 0, upper: value ?? 1 }, secondary: null,
    disposition: reportDisposition(reasons, valid), eligible: stateEligible, acceptedCold: false, accepted: acceptedBy(row.acceptance, cutoff),
    validCold: false, validDelayed: valid, replacementAccepted: false, replacementValid: false, primaryIncluded: false,
    paste: result?.pasteObserved ?? 'unknown', focus: result?.focusLossObserved ?? 'unknown', order: 'unknown', coldForm: 'unknown',
    delayedForm: result?.formLabel ?? 'unknown', observedColdForm: null, observedDelayedForm: acceptedBy(row.acceptance, cutoff) ? result?.formLabel ?? 'unknown' : null }
}

function reportStratum(frozen: z.infer<typeof learnReportFirstSlotStratumSchema>, observed: ReportResult | null): LearnReportMetric['stratum'] {
  return { flow: frozen.flow, entryPoint: frozen.entryPoint, depth: frozen.depth, startingBand: 'all', responseKind: frozen.responseKind,
    scoringKind: frozen.scorerConfiguration.scoringKind, configurationDigest: frozen.scorerConfiguration.configurationDigest,
    observedModel: observed?.observedModel ?? null, observedUpstream: observed?.observedUpstream ?? null, familyValidationStatus: frozen.familyValidationStatus }
}
function emptyReportCounts(considered: number, notAdmitted: number): LearnReportMetric['counts'] {
  return { considered, notAdmitted, horizonNotAssigned: 0, anchorNotStarted: 0, notYetDue: 0, windowOpen: 0,
    maturedEpisodes: 0, operationallyEligible: 0, acceptedSubmissions: 0, validDelayedScores: 0, validColdScores: 0, comparablePairs: 0,
    maturedClaims: 0, checkedClaims: 0, failedClaims: 0, acceptedColdSubmissions: 0, acceptedClaims: 0,
    dispositions: { missing_cold: 0, missing_delayed: 0, abandoned: 0, assisted_contaminated: 0, invalid_item_novelty: 0,
      evidence_unavailable: 0, pin_flow_treatment_mismatch: 0, access_provider_blocked: 0, scoring_pending: 0, reconciliation_required: 0, valid_scored: 0 },
    distinctLearners: { maturedEpisodes: 0, operationallyEligible: 0, acceptedSubmissions: 0, validDelayedScores: 0, validColdScores: 0,
      comparablePairs: 0, maturedClaims: 0, checkedClaims: 0, failedClaims: 0 } }
}
function sourceReportAccounting(rows: readonly (ReportEpisode | ReportClaim)[]): LearnReportMetric['sourceAccounting'] {
  const accounting: LearnReportMetric['sourceAccounting'] = { population: rows.length,
    missingT0: { covered: 0, affected: 0, unknown: 0 }, unknownExposure: { covered: 0, affected: 0, unknown: 0 },
    exhaustedInventory: { covered: 0, affected: 0, unknown: 0 }, purgedEvidence: { covered: 0, affected: 0, unknown: 0 },
    replacement: { covered: 0, affected: 0, unknown: 0 }, treatmentChange: { covered: 0, affected: 0, unknown: 0 }, outsideHelpUncertainty: { covered: 0, affected: 0, unknown: 0 } }
  for (const row of rows) {
    const results = row.kind === 'episode' ? [row.cold, row.delayed, row.replacement, row.coldReplacement?.result] : [row.result]
    const reasons = new Set([...(row.kind === 'episode' ? row.reasonCodes : row.unresolvedReason ? [row.unresolvedReason] : []),
      ...results.flatMap(result => result?.exclusionReasons ?? [])])
    const known = row.kind === 'first_check_claim' || row.assignment.sourceCoverage === 'complete'
    const affected = { missingT0: reasons.has('unmeasurable_no_t0'),
      unknownExposure: reasons.has('unknown_exposure') || reasons.has('unknown_history') || (row.kind === 'episode' && row.assignment.historyStatus === 'unknown'),
      exhaustedInventory: reasons.has('novel_item_unavailable'), purgedEvidence: reasons.has('purged_evidence') || reasons.has('evidence_unavailable') || reasons.has('body_purged'),
      replacement: row.kind === 'episode' && (row.coldReplacement !== null || row.replacementOpportunityId !== null),
      treatmentChange: row.kind === 'episode' && row.treatmentEpochChanged,
      outsideHelpUncertainty: reasons.has('outside_help_unknown') || reasons.has('outside_help_reported') }
    for (const key of Object.keys(affected) as (keyof typeof affected)[]) {
      const covered = known && (key !== 'outsideHelpUncertainty' || affected[key] || reasons.has('outside_help_not_reported'))
      if (covered) { accounting[key].covered++; if (affected[key]) accounting[key].affected++ }
      else accounting[key].unknown++
    }
  }
  return accounting
}
function reportCell(input: {
  metric: LearnReportMetric['metric'], horizon: 7 | 30, weighting: LearnReportMetric['weighting'], stratum: LearnReportMetric['stratum'],
  rows: readonly ComputedReportRow[], inventory: readonly ReportEpisode[], sourceRows: readonly ReportClaim[],
  audit: LearnReportMetric['legacyIndependentAudit'], policy: LearnReportMetric['replacements']['policy'], sourceKnown: boolean, seed: string,
}): LearnReportMetric {
  const gain = input.metric === VERIFIED_LEARNING_GAIN_VERSION
  const rows = input.rows.filter(row => input.stratum.startingBand === 'all' || row.band === input.stratum.startingBand)
  const matured = rows.filter(row => row.stage === 'matured')
  const considered = gain ? input.inventory.length : 0
  const notAdmitted = gain ? input.inventory.filter(row => row.assignment.status !== 'admitted').length : 0
  const counts = emptyReportCounts(considered, notAdmitted)
  const distinct: { [Key in keyof typeof counts.distinctLearners]: Set<string> } = {
    maturedEpisodes: new Set(), operationallyEligible: new Set(), acceptedSubmissions: new Set(), validDelayedScores: new Set(),
    validColdScores: new Set(), comparablePairs: new Set(), maturedClaims: new Set(), checkedClaims: new Set(), failedClaims: new Set(),
  }
  const add = (key: keyof typeof counts.distinctLearners, row: ComputedReportRow) => { counts[key]++; distinct[key].add(row.learnerKey) }
  for (const row of rows) {
    if (row.stage === 'anchor_not_started') counts.anchorNotStarted++
    if (row.stage === 'not_yet_due') counts.notYetDue++
    if (row.stage === 'window_open') counts.windowOpen++
    if (row.stage === 'not_assigned') counts.horizonNotAssigned++
  }
  const orders = () => ({ ABC: 0, ACB: 0, BAC: 0, BCA: 0, CAB: 0, CBA: 0, AB: 0, BA: 0, unknown: 0 })
  const forms = () => ({ A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, unknown: 0 })
  const allocations: LearnReportMetric['allocations'] = { assignedOrders: orders(), observedOrders: orders(), assignedColdForms: forms(),
    observedColdForms: forms(), assignedDelayedForms: forms(), observedDelayedForms: forms() }
  const bands = () => ({ population: 0, accepted: 0, validScored: 0, paired: 0 })
  const attritionByStartingBand: LearnReportMetric['attritionByStartingBand'] = { below40: bands(), from40To80: bands(), from80To100: bands(), unknown: bands() }
  const bandKey = { '0_40': 'below40', '40_80': 'from40To80', '80_100': 'from80To100', unknown: 'unknown' } as const
  const instrumentation: LearnReportMetric['instrumentation'] = { pasteFlagged: 0, focusFlagged: 0, eitherFlagged: 0,
    unknownUnflagged: 0, knownUnflagged: 0, pasteUnknown: 0, focusUnknown: 0, unknownInstrumentation: 0, flaggedWithUnknownInstrumentation: 0 }
  for (const row of matured) {
    counts.dispositions[row.disposition]++
    if (gain) {
      add('maturedEpisodes', row)
      if (row.eligible) add('operationallyEligible', row)
      if (row.accepted) add('acceptedSubmissions', row)
      if (row.acceptedCold) counts.acceptedColdSubmissions++
      if (row.validCold) add('validColdScores', row)
      if (row.validDelayed) add('validDelayedScores', row)
      if (row.observation.value !== null) add('comparablePairs', row)
    }
    else {
      add('maturedClaims', row)
      if (row.accepted) counts.acceptedClaims++
      if (row.observation.value !== null) add('checkedClaims', row)
      if (row.observation.value === 1) add('failedClaims', row)
    }
    allocations.assignedOrders[row.order]++
    allocations.assignedDelayedForms[row.delayedForm as keyof ReturnType<typeof forms>]++
    if (gain) allocations.assignedColdForms[row.coldForm as keyof ReturnType<typeof forms>]++
    if (row.accepted) {
      allocations.observedOrders[row.order]++
      allocations.observedDelayedForms[row.observedDelayedForm as keyof ReturnType<typeof forms>]++
    }
    if (gain && row.acceptedCold) allocations.observedColdForms[row.observedColdForm as keyof ReturnType<typeof forms>]++
    const band = attritionByStartingBand[bandKey[row.band]]
    band.population++
    if (row.accepted) band.accepted++
    if (row.validDelayed) band.validScored++
    if (row.observation.value !== null) band.paired++
    const flagged = row.paste === true || row.focus === true
    const unknown = row.paste === 'unknown' || row.focus === 'unknown'
    if (row.paste === true) instrumentation.pasteFlagged++
    if (row.focus === true) instrumentation.focusFlagged++
    if (row.paste === 'unknown') instrumentation.pasteUnknown++
    if (row.focus === 'unknown') instrumentation.focusUnknown++
    if (flagged) instrumentation.eitherFlagged++
    else if (unknown) instrumentation.unknownUnflagged++
    else instrumentation.knownUnflagged++
    if (unknown) instrumentation.unknownInstrumentation++
    if (unknown && flagged) instrumentation.flaggedWithUnknownInstrumentation++
  }
  for (const key of Object.keys(distinct) as (keyof typeof distinct)[]) counts.distinctLearners[key] = distinct[key].size
  const known = input.sourceKnown && rows.every(row => row.known)
  const family = input.stratum.familyValidationStatus
  const validity: LearnReportMetric['validity'] = family === 'quarantined' ? 'quarantined'
    : !known || family === 'unknown' || matured.some(row => row.reasons.includes('scorer_identity_unknown')) ? 'unknown'
    : family === 'empirically_supported' && input.stratum.scoringKind === 'deterministic' ? 'verified' : 'provisional'
  const emptyStatus = rows.some(row => row.stage === 'anchor_not_started') ? 'anchor_not_started'
    : rows.some(row => row.stage === 'not_yet_due' || row.stage === 'window_open') ? 'not_yet_due' : 'no_eligible_population'
  const evidence: ReportEvidence = { populationState: known ? 'known' : 'unknown', sourceCoverage: known ? 'complete' : 'unknown', validity, emptyStatus,
    reasonCodes: [...new Set(matured.flatMap(row => row.reasons))] }
  if (validity === 'provisional') evidence.reasonCodes.push('provisional_form_or_scorer')
  if (instrumentation.unknownInstrumentation) evidence.reasonCodes.push('unknown_instrumentation')
  const estimate = computeLearnReportEstimate(matured.map(row => row.observation), input.weighting, evidence, `${input.seed}:primary`)
  const secondary = matured.filter(row => row.secondary !== null)
  const { population: _population, observed: _observed, contributingLearners: _learners, ...primary } = estimate
  return learnReportMetricSchema.parse({ metric: input.metric, horizonDays: input.horizon, weighting: input.weighting, stratum: input.stratum,
    ...primary, counts, legacyIndependentAudit: input.audit,
    replacements: { policy: input.policy, originalPopulation: matured.length, withLinkedReplacement: secondary.length,
      withAcceptedReplacement: secondary.filter(row => row.replacementAccepted).length, withValidReplacement: secondary.filter(row => row.replacementValid).length,
      withComparableReplacement: secondary.filter(row => row.secondary!.value !== null).length,
      primaryIncludedPairs: matured.filter(row => row.primaryIncluded).length,
      secondary: computeLearnReportEstimate(secondary.map(row => row.secondary!), input.weighting, { ...evidence, emptyStatus: 'no_eligible_population' }, `${input.seed}:replacement`) },
    instrumentation, sensitivity: { policyVersion: LEARN_V2_REPORT_SENSITIVITY_POLICY_VERSION,
      excludingFlagged: computeLearnReportEstimate(matured.filter(row => row.paste !== true && row.focus !== true).map(row => row.observation),
        input.weighting, { ...evidence, emptyStatus: 'no_eligible_population' }, `${input.seed}:excluding_flags`) },
    allocations, sourceAccounting: sourceReportAccounting(gain ? input.inventory : input.sourceRows), attritionByStartingBand })
}

/** Whole-run action/offline computation. Public adapters publish only the returned manifest and cell pages. */
export async function buildLearningMeasurementReport(input: {
  reportRunId: string, query: z.infer<typeof learnReportQuerySchema>, provenance: z.infer<typeof learnReportProvenanceSchema>,
  roster: readonly string[], rows: readonly LearnReportInputSnapshot[],
}): Promise<{ report: LearnMeasurementReport, pages: z.infer<typeof learnMeasurementReportCellsSchema>[] }> {
  const metadata = z.strictObject({ reportRunId: learnIdSchema<'learnMeasurementReportRuns'>(), query: learnReportQuerySchema,
    provenance: learnReportProvenanceSchema, roster: z.array(learnReportOpaqueKeySchema).max(10_000), rows: z.array(z.unknown()).max(40_000) }).parse(input)
  const source = validatedReportRows(metadata.rows)
  const reconciliation = reconcileLearnReportSourceRows(metadata.roster, source.rows)
  const unavailable = (status: 'failed' | 'unavailable', reasonCodes: string[]) => ({
    report: learnMeasurementReportSchema.parse({ version: LEARN_V2_MEASUREMENT_REPORT_VERSION, status, reasonCodes }), pages: [],
  })
  if (reconciliation.status === 'incomplete') return unavailable('failed', reconciliation.reasonCodes)
  source.rows = source.rows.map(row => ({ row, key: JSON.stringify(row) })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map(({ row }) => row)
  const fingerprint = await fingerprintValidatedReportInput([...metadata.roster].sort(), source)
  if (Object.entries(fingerprint).some(([key, value]) => metadata.provenance[key as keyof typeof fingerprint] !== value)
    || metadata.provenance.cutoff !== metadata.query.cutoff) return unavailable('failed', ['input_manifest_mismatch'])
  const episodes = source.rows.filter((row): row is ReportEpisode => row.kind === 'episode')
  const claims = source.rows.filter((row): row is ReportClaim => row.kind === 'first_check_claim')
  const strata = [...episodes.map(row => row.assignment), ...claims.map(row => row.stratum)]
  if (strata.some(stratum => stratum.epoch !== metadata.query.epoch || stratum.cohortVersion !== metadata.query.cohortVersion)
    || new Set(strata.map(stratum => stratum.baselineSha)).size > 1) return unavailable('failed', ['incompatible_epoch'])
  if (episodes.some(row => row.assignment.status === 'admitted' && (row.assignment.protocolVersion !== metadata.query.protocolVersion
    || (row.clock !== null && row.clock.protocolVersion !== row.assignment.protocolVersion)))) return unavailable('failed', ['conflicting_protocol_pins'])
  const admitted = episodes.filter(row => row.assignment.status === 'admitted')
  if (admitted.some(row => row.reasonCodes.includes('unmeasurable_no_t0') || row.reasonCodes.includes('not_admitted'))) {
    return unavailable('failed', ['conflicting_admission_pins'])
  }
  const configurations = new Map<string, string>()
  for (const stratum of strata) {
    if (!stratum.scorerConfiguration) continue
    const configuration = stratum.scorerConfiguration
    const identity = JSON.stringify([configuration.scoringKind, configuration.scorerVersion])
    if (configurations.has(configuration.configurationDigest) && configurations.get(configuration.configurationDigest) !== identity) {
      return unavailable('failed', ['conflicting_scorer_configuration'])
    }
    configurations.set(configuration.configurationDigest, identity)
  }
  if (admitted.some(row => row.assignment.enrollmentAt! < metadata.query.enrollmentStartAt || row.assignment.enrollmentAt! >= metadata.query.enrollmentEndAt)) {
    return unavailable('failed', ['enrollment_outside_window'])
  }
  const inventoryByAssignment = new Map<string, ReportEpisode>()
  for (const row of episodes) {
    const previous = inventoryByAssignment.get(row.assignmentId)
    inventoryByAssignment.set(row.assignmentId, previous ? { ...row,
      reasonCodes: [...new Set([...previous.reasonCodes, ...row.reasonCodes,
        ...[previous.cold, previous.delayed, previous.replacement, row.cold, row.delayed, row.replacement].flatMap(result => result?.exclusionReasons ?? [])])],
      replacementOpportunityId: previous.replacementOpportunityId ?? row.replacementOpportunityId,
      treatmentEpochChanged: previous.treatmentEpochChanged || row.treatmentEpochChanged } : row)
  }
  const inventory = [...inventoryByAssignment.values()]
  const audit = rollUpLearnReportLegacyAudit(metadata.roster, source.rows)
  const watermarks = source.rows.filter(row => row.kind === 'owner_watermark')
  const sourceKnown = metadata.provenance.sourceCoverage === 'complete' && watermarks.every(row => row.historyCoverage === 'complete'
    && row.dueWorkThrough !== null && row.dueWorkThrough >= metadata.query.cutoff)
  const groups = new Map<string, ReportGroup>()
  const add = (metric: LearnReportMetric['metric'], horizon: 7 | 30, stratum: LearnReportMetric['stratum'],
    policy: LearnReportMetric['replacements']['policy'], row: ComputedReportRow, sourceRow?: ReportClaim) => {
    const key = JSON.stringify([metric, horizon, stratum, policy])
    const group = groups.get(key) ?? { metric, horizon, stratum, policy, rows: [], sourceRows: [] }
    group.rows.push(row)
    if (sourceRow) group.sourceRows.push(sourceRow)
    groups.set(key, group)
  }
  const assignmentRows = new Map<string, ReportEpisode[]>()
  const sharedCold = new Map<string, ReportResult | null>()
  for (const row of admitted) {
    assignmentRows.set(row.assignmentId, [...(assignmentRows.get(row.assignmentId) ?? []), row])
    const configuration = row.assignment.scorerConfiguration!
    const cold = validReportResult(row.cold, metadata.query.cutoff, configuration, null) ? row.cold : null
    if (row.originalOpportunityId) sharedCold.set(row.originalOpportunityId, cold)
    if (row.replacementOpportunityId) sharedCold.set(row.replacementOpportunityId, cold)
  }
  for (const rows of assignmentRows.values()) for (const horizon of [7, 30] as const) {
    const row = rows.find(candidate => candidate.horizonDays === horizon) ?? rows[0]!
    const computed = computeEpisodeRow(row, horizon, metadata.query.cutoff)
    const predeclared = row.replacementPolicy?.kind === 'predeclared'
    const observed = computed.stage === 'not_assigned' ? null
      : resultBy(predeclared && row.replacementOpportunityId ? row.replacement : row.delayed, metadata.query.cutoff)
        ?? resultBy(predeclared && row.coldReplacement ? row.coldReplacement.result : row.cold, metadata.query.cutoff)
    const frozen = { ...row.assignment, responseKind: row.assignment.responseKind!, scorerConfiguration: row.assignment.scorerConfiguration! }
    add(VERIFIED_LEARNING_GAIN_VERSION, horizon, reportStratum(frozen, observed), row.replacementPolicy!, computed)
  }
  for (const claim of claims) {
    const computed = computeClaimRow(claim, metadata.query.cutoff, sharedCold.get(claim.firstCheckOpportunityId) ?? null)
    add(FALSE_MASTERY_NEXT_DELAYED_VERSION, claim.clock.horizonDays, reportStratum(claim.stratum, resultBy(claim.result, metadata.query.cutoff)),
      { kind: 'secondary_only' }, computed, claim)
  }
  if (!groups.size) {
    const reasons = inventory.length ? ['not_admitted'] : ['no_eligible_population']
    if (inventory.some(row => row.assignment.protocolStatus === 'protocol_not_frozen')) reasons.push('protocol_not_frozen')
    if (inventory.some(row => row.reasonCodes.includes('unmeasurable_no_t0'))) reasons.push('unmeasurable_no_t0')
    return unavailable('unavailable', reasons)
  }
  const frozenGroups = new Map<string, ReportGroup[]>()
  for (const group of groups.values()) {
    const key = JSON.stringify([group.metric, group.horizon, { ...group.stratum, observedModel: null, observedUpstream: null }, group.policy])
    frozenGroups.set(key, [...(frozenGroups.get(key) ?? []), group])
  }
  groups.clear()
  for (const grouped of frozenGroups.values()) {
    const observed = grouped.filter(group => group.stratum.observedModel !== null || group.stratum.observedUpstream !== null)
    if (observed.length <= 1) {
      const first = observed[0] ?? grouped[0]!
      const group = { ...first, rows: grouped.flatMap(value => value.rows), sourceRows: grouped.flatMap(value => value.sourceRows) }
      groups.set(JSON.stringify([group.metric, group.horizon, group.stratum, group.policy]), group)
    }
    else for (const group of grouped) {
      // Outcome-dependent scorer strata cannot establish an all-eligible population under one frozen binding.
      group.rows = group.rows.map(row => ({ ...row, known: false, reasons: [...row.reasons, 'scorer_identity_strata_unknown'] }))
      groups.set(JSON.stringify([group.metric, group.horizon, group.stratum, group.policy]), group)
    }
  }
  const cells: LearnReportMetric[] = []
  for (const [key, group] of [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const bands: LearnReportMetric['stratum']['startingBand'][] = ['all', ...[...new Set(group.rows.map(row => row.band))].sort()]
    for (const band of bands) for (const weighting of ['capability_episode', 'learner_sensitivity'] as const) {
      cells.push(reportCell({ ...group, weighting, stratum: { ...group.stratum, startingBand: band }, inventory,
        audit, sourceKnown, seed: `${metadata.provenance.bootstrapSeed}:${key}:${band}:${weighting}` }))
    }
  }
  const pages: z.infer<typeof learnMeasurementReportCellsSchema>[] = []
  for (let offset = 0; offset < cells.length; offset += 8) {
    const isDone = offset + 8 >= cells.length
    pages.push(validateLearnMeasurementReportCells({ version: LEARN_V2_MEASUREMENT_REPORT_VERSION, reportRunId: metadata.reportRunId,
      cells: cells.slice(offset, offset + 8), cursor: isDone ? null : `cells:${offset + 8}`, isDone }))
  }
  return { report: learnMeasurementReportSchema.parse({ version: LEARN_V2_MEASUREMENT_REPORT_VERSION, status: 'sealed',
    reportRunId: metadata.reportRunId, query: metadata.query, provenance: metadata.provenance }), pages }
}
