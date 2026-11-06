import { z } from 'zod'
import {
  learnCodeSchema, learnDigestSchema, learnIdSchema, learnVersionSchema, learnTimestampSchema, learnSequenceSchema,
  learnRevisionSchema, learnScoreSchema, learnObservationSchema, learnReasonCodesSchema, learnTimezoneSchema,
  learnAssistanceSnapshotSchema, learnValiditySnapshotSchema, parseLearnContract,
} from './learn-v2-responses'
import { learnAssessmentClockSchema, learnFirstCheckClaimSchema, learnAssessmentPhaseSchema } from './learn-v2-delayed-check'
import { learnMeasurementFlowSchema, learnMeasurementDepthSchema, learnHistoryStatusSchema, learnFamilyStatusSchema, learnMeasurementHorizonSchema, LEARN_V2_FORM_ORDERS } from './learn-v2-measurement'
import { LEARN_MEASUREMENT_STORAGE_LIMITS } from './learn-v2-measurement-storage-manifest'

export const LEARN_V2_MEASUREMENT_REPORT_VERSION = 'learn-v2.measurement-report.v3' as const
export const LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION = 'learn-v2.measurement-report-source.v3' as const
export const LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION = 'learn-v2.measurement-report-query.v1' as const
export const VERIFIED_LEARNING_GAIN_VERSION = 'verified_learning_gain.v1' as const
export const FALSE_MASTERY_NEXT_DELAYED_VERSION = 'false_mastery_next_delayed.v1' as const
export const LEARN_V2_REPORT_PRECISION = { bootstrapReplicates: 10_000, minimumLearnerClusters: 20, confidenceLevel: 0.95 } as const
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
  ...frozenStratum, responseKind: z.enum(LEARN_V2_REPORT_RESPONSE_KINDS).nullable(), scorerConfiguration: learnReportScorerConfigurationSchema.nullable(),
  protocolVersion: learnVersionSchema.nullable(), enrollmentAt: learnTimestampSchema.nullable(), timezone: learnTimezoneSchema.nullable(),
  anchorAt: learnTimestampSchema.nullable(), anchorKind: learnVersionSchema.nullable(), historyStatus: learnHistoryStatusSchema,
  allocationOrder: z.enum([...LEARN_V2_FORM_ORDERS, 'AB', 'BA']).nullable(),
  assignedDay7: z.boolean(), assignedDay30: z.boolean(), sourceCoverage,
}).refine(value => (value.responseKind === null) === (value.scorerConfiguration === null)
  && (value.protocolVersion === null || value.scorerConfiguration !== null), 'Frozen assignments require response and scorer strata')
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
export const learnReportEpisodeSnapshotSchema = z.strictObject({
  kind: z.literal('episode'), ...computationKeys, assignmentId: learnIdSchema<'learnMeasurementAssignments'>(),
  learningVoidId: learnIdSchema<'learningVoids'>(), blueprintRevisionId: learnIdSchema<'learnBlueprintRevisions'>(), objectiveId: learnIdSchema<'learnObjectives'>(),
  horizonDays: learnMeasurementHorizonSchema, assignment: learnReportAssignmentSnapshotSchema, clock: learnAssessmentClockSchema.nullable(),
  coldOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>().nullable(),
  originalOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>().nullable(), replacementOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>().nullable(),
  coldAcceptance: learnReportAcceptanceSnapshotSchema.nullable(), delayedAcceptance: learnReportAcceptanceSnapshotSchema.nullable(),
  cold: learnReportResultSnapshotSchema.nullable(), delayed: learnReportResultSnapshotSchema.nullable(),
  replacementAcceptance: learnReportAcceptanceSnapshotSchema.nullable(), replacement: learnReportResultSnapshotSchema.nullable(),
  replacementPolicy: learnReportReplacementPolicySchema.nullable(), operationalEligibility: z.enum(['pending', 'eligible', 'blocked']),
  disposition: learnReportDispositionSchema, reasonCodes: learnReasonCodesSchema, mixedFlow: z.boolean(), treatmentEpochChanged: z.boolean(),
}).refine(value => (value.cold === null || value.cold.kind === 'measurement_cold')
  && (value.delayed === null || value.delayed.kind === 'measurement_delayed')
  && (value.replacement === null || value.replacement.kind === 'measurement_delayed'), 'Incorrect measurement endpoint kind')
  .refine(value => acceptedResultMatches(value.coldAcceptance, value.cold) && acceptedResultMatches(value.delayedAcceptance, value.delayed)
    && acceptedResultMatches(value.replacementAcceptance, value.replacement), 'Results require their accepted submission and performance time')
  .refine(value => (value.clock === null || value.clock.horizonDays === value.horizonDays)
    && (value.coldAcceptance === null || value.coldOpportunityId !== null)
    && (value.delayedAcceptance === null || value.originalOpportunityId !== null)
    && (value.replacementOpportunityId === null ? value.replacementAcceptance === null && value.replacement === null
      : value.originalOpportunityId !== null && value.replacementOpportunityId !== value.originalOpportunityId)
    && (value.coldOpportunityId === null || ![value.originalOpportunityId, value.replacementOpportunityId].includes(value.coldOpportunityId))
    && ((value.assignment.protocolVersion === null) === (value.replacementPolicy === null))
    && (value.replacementPolicy?.kind !== 'predeclared' || value.replacementPolicy.protocolVersion === value.assignment.protocolVersion), 'Inconsistent original or replacement slot pins')
  .refine(value => {
    const submissions = [value.coldAcceptance, value.delayedAcceptance, value.replacementAcceptance].flatMap(acceptance => acceptance ? [acceptance.submissionId] : [])
    const attempts = [value.cold, value.delayed, value.replacement].flatMap(result => result ? [result.attemptId] : [])
    return new Set(submissions).size === submissions.length && new Set(attempts).size === attempts.length
  }, 'Distinct slots require distinct submissions and attempts')
export const learnReportFirstClaimSnapshotSchema = z.strictObject({
  kind: z.literal('first_check_claim'), ...computationKeys, stratum: learnReportFirstSlotStratumSchema,
  claim: learnFirstCheckClaimSchema, firstCheckOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>(),
  checkSequence: learnRevisionSchema, clock: learnAssessmentClockSchema,
  stateAtEligibility: masteryState, stateAtAcceptance: masteryState.nullable(), acceptance: learnReportAcceptanceSnapshotSchema.nullable(),
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
  const capabilityKeys = new Map<string, string>()
  const capabilityScopes = new Map<string, string>()
  type OutcomeBinding = { learnerKey: string, capabilityKey: string, owner: string | null, role: 'cold' | 'delayed' | 'replacement' | 'claim' }
  const outcomes = new Map<string, (OutcomeBinding & { snapshot: string, slotWindow: string | null })[]>()
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
      const scope = JSON.stringify([row.learnerKey, row.blueprintRevisionId, row.objectiveId])
      const capability = JSON.stringify([row.learnerKey, row.capabilityKey])
      if ((capabilityKeys.has(scope) && capabilityKeys.get(scope) !== row.capabilityKey)
        || (capabilityScopes.has(capability) && capabilityScopes.get(capability) !== scope)) reasons.add('conflicting_capability_key')
      capabilityKeys.set(scope, row.capabilityKey)
      capabilityScopes.set(capability, scope)
      const frozen = JSON.stringify([row.learnerKey, row.capabilityKey, row.learningVoidId, row.blueprintRevisionId, row.objectiveId,
        row.assignment, row.coldOpportunityId, row.coldAcceptance, row.cold, row.replacementPolicy])
      if (assignments.has(row.assignmentId) && assignments.get(row.assignmentId) !== frozen) reasons.add('conflicting_assignment_snapshot')
      assignments.set(row.assignmentId, frozen)
      const binding = { learnerKey: row.learnerKey, capabilityKey: row.capabilityKey }
      reconcileOutcome({ ...binding, owner: JSON.stringify(['cold', row.assignmentId]), role: 'cold' }, row.coldOpportunityId, row.coldAcceptance, row.cold)
      const episode = JSON.stringify(['episode', row.assignmentId, row.horizonDays])
      reconcileOutcome({ ...binding, owner: episode, role: 'delayed' }, row.originalOpportunityId, row.delayedAcceptance, row.delayed, row.clock)
      reconcileOutcome({ ...binding, owner: episode, role: 'replacement' }, row.replacementOpportunityId, row.replacementAcceptance, row.replacement)
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
      if (slots.some(slot => slot.role === 'cold')) reasons.add('claim_shared_cold_slot')
      // Only originals carry an episode clock. Replacement sharing still requires identical outcome snapshots.
      const originals = slots.filter(slot => slot.role === 'delayed')
      if (originals.length && new Set([...originals, ...claims].map(outcome => outcome.slotWindow)).size > 1) reasons.add('conflicting_slot_window')
    }
  }
  if (roster.some(owner => !watermarks.has(owner))) reasons.add('missing_owner_watermark')
  return { status: reasons.size ? 'incomplete' as const : 'complete' as const, reasonCodes: [...reasons].sort() }
}
export const learnReportFactPayloadSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('enrollment'), assignmentId: learnIdSchema<'learnMeasurementAssignments'>(), recordRevision: learnRevisionSchema,
    status: z.enum(['considered', 'not_admitted', 'admitted']), snapshot: learnReportAssignmentSnapshotSchema }),
  z.strictObject({ kind: z.literal('opportunity'), assessmentOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>(), recordRevision: learnRevisionSchema,
    status: learnReportOpportunityStatusSchema, dueAt: learnTimestampSchema.nullable(), closeAt: learnTimestampSchema, clock: learnAssessmentClockSchema.nullable(), originalSlot: z.boolean() }),
  z.strictObject({ kind: z.literal('response'), submissionId: learnIdSchema<'learnResponses'>(), acceptedAt: learnTimestampSchema,
    measurementEligible: z.boolean(), masteryEligible: z.boolean(), assistanceSnapshot: learnAssistanceSnapshotSchema, validitySnapshot: learnValiditySnapshotSchema }),
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
