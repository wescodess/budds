import { z } from 'zod'
import {
  learnCodeSchema, learnDigestSchema, learnIdSchema, learnRevisionSchema, learnSequenceSchema,
  learnTimestampSchema, learnScoreSchema, learnTextSchema, learnVersionSchema,
  parseLearnContract,
} from './learn-v2-responses'
import { LEARN_MEASUREMENT_STORAGE_LIMITS } from './learn-v2-measurement-storage-manifest'

export const LEARN_V2_MEASUREMENT_VERSION = 'learn-v2.measurement.v1' as const
export const LEARN_V2_SCORER_BINDING_VERSION = 'learn-v2.scorer-binding.v1' as const
export const LEARN_V2_SCORER_RECEIPT_VERSION = 'learn-v2.scorer-receipt.v1' as const
export const LEARN_V2_FORM_ORDERS = ['ABC', 'ACB', 'BAC', 'BCA', 'CAB', 'CBA'] as const
export const learnMeasurementHorizonSchema = z.union([z.literal(7), z.literal(30)])
export const learnMeasurementFlowSchema = z.enum(['v2_today', 'v2_canvas'])
export const learnMeasurementDepthSchema = z.enum(['foundational', 'working', 'advanced'])
export const learnHistoryStatusSchema = z.enum(['prospectively_unexposed', 'returning', 'unknown'])
export const learnFamilyStatusSchema = z.enum(['provisional_equivalent', 'empirically_supported', 'quarantined', 'retired'])

export const learnCapabilityFields = {
  learningVoidId: learnIdSchema<'learningVoids'>(), blueprintRevisionId: learnIdSchema<'learnBlueprintRevisions'>(),
  objectiveId: learnIdSchema<'learnObjectives'>(), blueprintRecordRevision: learnRevisionSchema,
  assessmentContractVersion: learnVersionSchema, assessmentContractDigest: learnDigestSchema,
  depth: learnMeasurementDepthSchema,
}
export const learnCanvasPinsSchema = z.strictObject({
  threadId: learnIdSchema<'learningThreads'>(), threadRevision: learnRevisionSchema,
  activityId: learnIdSchema<'learningThreadActivities'>(), activityRevision: learnRevisionSchema,
  planVersion: learnVersionSchema, replayVersion: learnVersionSchema, rendererVersion: learnVersionSchema,
  evaluationVersion: learnVersionSchema, pilotConfigurationVersion: learnVersionSchema,
})
const planFields = {
  studyPlanId: learnIdSchema<'studyPlans'>(), studyPlanRevisionId: learnIdSchema<'studyPlanRevisions'>(),
  planRevision: learnRevisionSchema, planRecordRevision: learnRevisionSchema,
}
export const learnContextPinsSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('calibration') }),
  z.strictObject({ kind: z.literal('planned_measurement'), ...planFields }),
  z.strictObject({ kind: z.literal('session'), ...planFields,
    studySessionId: learnIdSchema<'studySessions'>(), sessionRevision: learnRevisionSchema,
    sessionContentId: learnIdSchema<'sessionContent'>(), contentRevision: learnRevisionSchema,
    contentInputDigest: learnDigestSchema, generatorVersion: learnVersionSchema, canvas: learnCanvasPinsSchema.optional() }),
])
export const learnV2ScopeSchema = z.strictObject({ scopeKind: z.literal('v2'), ...learnCapabilityFields, contextPins: learnContextPinsSchema })
export const learnStandaloneScopeSchema = z.strictObject({
  scopeKind: z.literal('standalone'), threadId: learnIdSchema<'learningThreads'>(), activityId: learnIdSchema<'learningThreadActivities'>(),
  threadRevision: learnRevisionSchema, activityRevision: learnRevisionSchema, activityContractVersion: learnVersionSchema,
})
export const learnResponseScopeSchema = z.discriminatedUnion('scopeKind', [learnV2ScopeSchema, learnStandaloneScopeSchema])

export const learnMeasurementItemPinsSchema = z.strictObject({
  itemId: learnIdSchema<'learnMeasurementItems'>(), itemRevision: learnRevisionSchema, promptDigest: learnDigestSchema,
  caseId: learnIdSchema<'learnAssessmentCases'>(), familyId: learnIdSchema<'learnMeasurementFamilies'>(), familyRevision: learnRevisionSchema,
  formLabel: z.enum(['A', 'B', 'C', 'D', 'E', 'F']), equivalenceVersion: learnVersionSchema, noveltyPolicyVersion: learnVersionSchema,
  scoringSpecId: learnIdSchema<'learnMeasurementScoringSpecs'>(), scoringSpecRevision: learnRevisionSchema, scoringSpecDigest: learnDigestSchema,
  supportManifestDigest: learnDigestSchema, publicationValidationId: learnIdSchema<'learnMeasurementValidations'>(),
})
export const learnAssessmentPinsSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('measurement'), itemPins: learnMeasurementItemPinsSchema }),
  z.strictObject({ kind: z.literal('session_application'), caseId: learnIdSchema<'learnAssessmentCases'>(), promptDigest: learnDigestSchema,
    rubricVersion: learnVersionSchema, rubricDigest: learnDigestSchema, supportManifestDigest: learnDigestSchema }),
  z.strictObject({ kind: z.literal('calibration'), caseId: learnIdSchema<'learnAssessmentCases'>(), promptDigest: learnDigestSchema,
    assessmentContractVersion: learnVersionSchema, assessmentContractDigest: learnDigestSchema, supportManifestDigest: learnDigestSchema }),
])

const thresholdFields = { thresholdVersion: learnVersionSchema, thresholdPercent: z.literal(80), transitionVersion: z.literal('learn-v2.mastery-transition.v1') }
export const learnScorerBindingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('deterministic'), engineVersion: learnVersionSchema, ...thresholdFields }),
  z.strictObject({ kind: z.literal('model'), configurationId: learnVersionSchema, configurationVersion: learnVersionSchema,
    configurationDigest: learnDigestSchema, requestedModel: learnTextSchema(200), routingMode: z.enum(['legacy_auto', 'strict']),
    endpoint: learnTextSchema(200).nullable(), scorerVersion: learnVersionSchema, promptVersion: learnVersionSchema,
    responseSchemaVersion: learnVersionSchema, parserVersion: learnVersionSchema, guardVersion: learnVersionSchema, ...thresholdFields,
  }).refine(value => value.routingMode !== 'strict' || value.endpoint !== null, 'Strict scoring requires an endpoint'),
])
export const learnObservedScorerIdentitySchema = z.union([
  z.strictObject({ status: z.literal('deterministic'), engineVersion: learnVersionSchema }),
  z.strictObject({ status: z.enum(['verified', 'unknown', 'mismatch', 'unverified_legacy']), requestedScorerModel: learnTextSchema(200),
    returnedScorerModel: learnTextSchema(200).nullable(), generationId: learnTextSchema(200).nullable(),
    servingProvider: learnTextSchema(200).nullable(), upstreamRequestId: learnTextSchema(200).nullable(),
    endpoint: learnTextSchema(200).nullable(), revision: learnTextSchema(200).nullable(), fingerprint: learnTextSchema(200).nullable(),
    observationSource: learnVersionSchema, observationVersion: learnVersionSchema, observedAt: learnTimestampSchema }),
])
export const learnScoringVerdictSchema = z.strictObject({
  criterionResults: z.array(z.strictObject({ key: learnTextSchema(64), awarded: z.boolean() })).min(1).max(8)
    .refine(values => new Set(values.map(value => value.key)).size === values.length),
  misconceptionTags: z.array(learnCodeSchema).max(16).refine(values => new Set(values).size === values.length),
  scorePercent: learnScoreSchema, verdictDigest: learnDigestSchema, responseDigest: learnDigestSchema,
})
export const learnScoringExecutionReceiptSchema = z.strictObject({
  assessmentOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>(), submissionId: learnIdSchema<'learnResponses'>(),
  jobId: learnIdSchema<'learnJobs'>(), dispatchOrdinal: learnRevisionSchema, leaseIdentityHash: learnDigestSchema,
  dispatchedAt: learnTimestampSchema, responseDigest: learnDigestSchema, assessmentPins: learnAssessmentPinsSchema,
  scoringBinding: learnScorerBindingSchema, frozenConfiguration: z.strictObject({ digest: learnDigestSchema, snapshot: learnTextSchema() }),
  requestDigest: learnDigestSchema, requestBytes: learnRevisionSchema, transportSettingsDigest: learnDigestSchema,
  observedIdentity: learnObservedScorerIdentitySchema, outcome: z.enum(['pending', 'validated', 'refused', 'error', 'reconciliation_required']),
  verdict: learnScoringVerdictSchema.optional(),
  usage: z.strictObject({ inputTokens: learnSequenceSchema, outputTokens: learnSequenceSchema, costMicroUsd: learnSequenceSchema.nullable() }).nullable(),
  authoritativeAttemptId: learnIdSchema<'masteryAttempts'>().optional(), committedAt: learnTimestampSchema.optional(), integrityResult: learnCodeSchema,
}).superRefine((value, ctx) => {
  if ((value.outcome === 'validated') !== (value.verdict !== undefined)
    || (value.verdict && value.verdict.responseDigest !== value.responseDigest)
    || ((value.authoritativeAttemptId !== undefined) !== (value.committedAt !== undefined))
    || (value.committedAt !== undefined && (value.outcome !== 'validated' || value.committedAt < value.dispatchedAt))
    || (value.observedIdentity.status !== 'deterministic' && value.observedIdentity.observedAt < value.dispatchedAt)
    || (value.scoringBinding.kind === 'model' && value.frozenConfiguration.digest !== value.scoringBinding.configurationDigest)) {
    ctx.addIssue({ code: 'custom', message: 'Inconsistent scorer receipt pins' })
  }
})

export const learnMeasurementResponseSpecSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('keyed'), version: learnVersionSchema, maxSelections: z.number().int().min(1).max(32) }),
  z.strictObject({ kind: z.literal('numeric'), version: learnVersionSchema, unit: learnTextSchema(100) }),
  z.strictObject({ kind: z.literal('ordered'), version: learnVersionSchema, maxEntries: z.number().int().min(1).max(32) }),
  z.strictObject({ kind: z.literal('bounded_rubric'), version: learnVersionSchema, maxCodeUnits: z.literal(12000) }),
])
const keyedEntries = z.array(learnTextSchema(200)).min(1).max(32).refine(values => new Set(values).size === values.length)
export const learnPrivateScoringPayloadSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('keyed'), acceptedSets: z.array(keyedEntries).min(1).max(8), normalizationVersion: learnVersionSchema }),
  z.strictObject({ kind: z.literal('numeric'), expected: z.number().finite(), unit: learnTextSchema(100),
    absoluteTolerance: z.number().finite().min(0), relativeTolerance: z.number().finite().min(0), normalizationVersion: learnVersionSchema }),
  z.strictObject({ kind: z.literal('ordered'), expected: z.array(learnTextSchema(200)).min(1).max(32), normalizationVersion: learnVersionSchema }),
  z.strictObject({ kind: z.literal('bounded_rubric'), keyInsufficientReason: learnTextSchema(1000),
    criteria: z.array(z.strictObject({ key: learnTextSchema(64), description: learnTextSchema(300), weightPercent: z.number().int().min(1).max(100) })).min(1).max(8)
      .refine(values => new Set(values.map(value => value.key)).size === values.length && values.reduce((sum, value) => sum + value.weightPercent, 0) === 100) }),
])
export const learnMeasurementEquivalenceSchema = z.strictObject({
  operation: learnTextSchema(1000), contentCoverage: learnTextSchema(1000), transferDemand: learnTextSchema(1000),
  responseModality: learnVersionSchema, scoreScale: z.literal('percent_0_100'), criteriaDigest: learnDigestSchema,
  thresholdVersion: learnVersionSchema, rationale: learnTextSchema(2000), difficultyPrior: learnTextSchema(1000),
})
export const learnMeasurementSupportSchema = z.strictObject({
  sourceSnapshotId: learnIdSchema<'learnSourceSnapshots'>(), sourceSnapshotRevision: learnRevisionSchema,
  sourceRecordRevision: learnRevisionSchema, sourceContentHash: learnDigestSchema, sourceRevision: learnVersionSchema,
  sourceExcerptId: learnIdSchema<'learnSourceExcerpts'>(), excerptDigest: learnDigestSchema, locatorDigest: learnDigestSchema,
  supportRevision: learnRevisionSchema, supportDigest: learnDigestSchema,
  rightsStatus: z.literal('permitted'), accessStatus: z.literal('available'), conflictStatus: z.literal('none'),
  entailment: z.literal('entailed'), verifierVersion: learnVersionSchema, verifierModel: learnTextSchema(200),
})
export const learnMeasurementPublicationCandidateSchema = z.strictObject({
  version: z.literal(LEARN_V2_MEASUREMENT_VERSION), ...learnCapabilityFields,
  pins: learnMeasurementItemPinsSchema, prompt: learnTextSchema(), declaredStimulus: learnTextSchema().nullable(),
  responseSpec: learnMeasurementResponseSpecSchema, privateScoring: learnPrivateScoringPayloadSchema,
  referenceSolution: learnTextSchema(), derivation: learnTextSchema(), scoringBinding: learnScorerBindingSchema,
  claims: z.array(z.strictObject({ order: z.number().int().min(0).max(31), part: z.enum(['stimulus', 'key', 'rubric', 'solution']),
    claim: learnTextSchema(1000), claimDigest: learnDigestSchema, revision: learnRevisionSchema,
    supports: z.array(learnMeasurementSupportSchema).min(1).max(8),
  })).min(1).max(32),
}).superRefine((value, ctx) => {
  const sources = new Set(value.claims.flatMap(claim => claim.supports.map(support => support.sourceSnapshotId)))
  const responseSpec = value.responseSpec
  if (value.responseSpec.kind !== value.privateScoring.kind || sources.size > 64
    || value.claims.some((claim, index) => claim.order !== index || new Set(claim.supports.map(support => support.sourceSnapshotId)).size !== claim.supports.length)
    || (value.responseSpec.kind !== 'bounded_rubric' && value.scoringBinding.kind !== 'deterministic')
    || (value.responseSpec.kind === 'numeric' && value.privateScoring.kind === 'numeric' && value.responseSpec.unit !== value.privateScoring.unit)
    || (responseSpec.kind === 'keyed' && value.privateScoring.kind === 'keyed' && value.privateScoring.acceptedSets.some(set => set.length > responseSpec.maxSelections))
    || (value.responseSpec.kind === 'ordered' && value.privateScoring.kind === 'ordered' && value.privateScoring.expected.length > value.responseSpec.maxEntries)) {
    ctx.addIssue({ code: 'custom', message: 'Inconsistent item response, scoring or source bounds' })
  }
})

export const learnAssessmentExposureSchema = z.strictObject({
  caseId: learnIdSchema<'learnAssessmentCases'>().optional(), itemId: learnIdSchema<'learnMeasurementItems'>().optional(),
  itemRevision: learnRevisionSchema.optional(), familyId: learnIdSchema<'learnMeasurementFamilies'>().optional(),
  formLabel: z.enum(['A', 'B', 'C', 'D', 'E', 'F']).optional(),
  assessmentOpportunityId: learnIdSchema<'learnAssessmentOpportunities'>().optional(),
  purpose: z.enum(['teaching', 'practice', 'calibration', 'cold_measurement', 'delayed_measurement', 'retained_check', 'feedback', 'imported', 'assistance_requested_denied']),
  status: z.enum(['granted', 'acknowledged', 'known', 'possible', 'unknown', 'requested_denied']),
  projectionDigest: learnDigestSchema, deliveryReceiptHash: learnDigestSchema, serverTime: learnTimestampSchema,
  observedAt: learnTimestampSchema.optional(), policyVersion: learnVersionSchema, provenanceVersion: learnVersionSchema,
}).refine(value => (value.purpose === 'assistance_requested_denied') === (value.status === 'requested_denied')
  && (value.itemId === undefined || (value.caseId !== undefined && value.itemRevision !== undefined)), 'Inconsistent exposure fact')

export function doesLearnExposureConsumeCase(input: z.infer<typeof learnAssessmentExposureSchema>) {
  return parseLearnContract(learnAssessmentExposureSchema, input).status !== 'requested_denied'
}

export const learnMeasurementHistorySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('legacy'), historyStatus: z.literal('unknown'), identityStatus: z.literal('unverified_legacy') }),
  z.strictObject({ kind: z.literal('prospective'), historyStatus: z.enum(['prospectively_unexposed', 'returning']),
    instrumentationEpoch: learnVersionSchema, historyBasisVersion: learnVersionSchema, historyCoverageWatermark: learnVersionSchema }),
])
export const learnMeasurementFamilyManifestSchema = z.strictObject({
  version: z.literal(LEARN_V2_MEASUREMENT_VERSION), ...learnCapabilityFields,
  familyId: learnIdSchema<'learnMeasurementFamilies'>(), revision: learnRevisionSchema, equivalenceVersion: learnVersionSchema,
  equivalenceDescriptor: learnMeasurementEquivalenceSchema, status: learnFamilyStatusSchema,
  coreFormCount: z.union([z.literal(2), z.literal(3)]),
  members: z.array(z.strictObject({ pins: learnMeasurementItemPinsSchema, reserve: z.boolean() })).min(2).max(6),
}).superRefine((value, ctx) => {
  const pins = value.members.map(member => member.pins)
  if (value.members.filter(member => !member.reserve).length !== value.coreFormCount
    || pins.some(pin => pin.familyId !== value.familyId || pin.familyRevision !== value.revision || pin.equivalenceVersion !== value.equivalenceVersion)
    || new Set(pins.map(pin => pin.caseId)).size !== pins.length || new Set(pins.map(pin => pin.itemId)).size !== pins.length
    || new Set(pins.map(pin => pin.formLabel)).size !== pins.length
    || value.members.filter(member => !member.reserve).some(member => !'ABC'.slice(0, value.coreFormCount).includes(member.pins.formLabel))) {
    ctx.addIssue({ code: 'custom', message: 'Family identities or core coverage conflict' })
  }
})
export const learnMeasurementAllocationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('three_case'), order: z.enum(LEARN_V2_FORM_ORDERS), cold: learnMeasurementItemPinsSchema,
    day7: learnMeasurementItemPinsSchema, day30: learnMeasurementItemPinsSchema }),
  z.strictObject({ kind: z.literal('two_case'), horizonDays: learnMeasurementHorizonSchema,
    cold: learnMeasurementItemPinsSchema, delayed: learnMeasurementItemPinsSchema }),
]).superRefine((value, ctx) => {
  const pins = value.kind === 'three_case' ? [value.cold, value.day7, value.day30] : [value.cold, value.delayed]
  if (new Set(pins.map(pin => pin.caseId)).size !== pins.length || new Set(pins.map(pin => pin.itemId)).size !== pins.length
    || new Set(pins.map(pin => pin.formLabel)).size !== pins.length
    || pins.some(pin => pin.familyId !== value.cold.familyId || pin.familyRevision !== value.cold.familyRevision || pin.equivalenceVersion !== value.cold.equivalenceVersion)
    || (value.kind === 'three_case' && pins.map(pin => pin.formLabel).join('') !== value.order)
    || (value.kind === 'two_case' && pins.some(pin => pin.formLabel !== 'A' && pin.formLabel !== 'B'))) {
    ctx.addIssue({ code: 'custom', message: 'Allocation must use distinct cases in the frozen order' })
  }
})

export const LEARN_V2_MEASUREMENT_ADMISSION_REASONS = [
  'protocol_not_frozen', 'not_admitted', 'unmeasurable_no_t0', 'evidence_unavailable', 'unknown_history',
  'prior_exposure', 'novel_item_unavailable', 'family_quarantined', 'pins_mismatch',
] as const
export const learnMeasurementAdmissionInputSchema = z.strictObject({
  protocolFrozen: z.boolean(), flowAdmitted: z.boolean(), acceptedT0: z.boolean(), evidenceAvailable: z.boolean(),
  historyStatus: learnHistoryStatusSchema, historyBasisVersion: learnVersionSchema.nullable(), historyCoverageWatermark: learnVersionSchema.nullable(),
  inventoryNovel: z.enum(['yes', 'no', 'unknown']), familyStatus: learnFamilyStatusSchema,
  pinsMatch: z.boolean(),
})
export function evaluateLearnMeasurementAdmission(input: z.infer<typeof learnMeasurementAdmissionInputSchema>) {
  const value = parseLearnContract(learnMeasurementAdmissionInputSchema, input)
  const reasons: Array<typeof LEARN_V2_MEASUREMENT_ADMISSION_REASONS[number]> = []
  if (!value.protocolFrozen) reasons.push('protocol_not_frozen')
  if (!value.flowAdmitted) reasons.push('not_admitted')
  if (!value.acceptedT0) reasons.push('unmeasurable_no_t0')
  if (!value.evidenceAvailable) reasons.push('evidence_unavailable')
  if (value.historyStatus === 'unknown' || !value.historyBasisVersion || !value.historyCoverageWatermark) reasons.push('unknown_history')
  if (value.historyStatus === 'returning') reasons.push('prior_exposure')
  if (value.inventoryNovel !== 'yes') reasons.push('novel_item_unavailable')
  if (value.familyStatus === 'quarantined' || value.familyStatus === 'retired') reasons.push('family_quarantined')
  if (!value.pinsMatch) reasons.push('pins_mismatch')
  return { admitted: reasons.length === 0, reasonCodes: reasons }
}

export function learnMeasurementCoverage(allocation: z.infer<typeof learnMeasurementAllocationSchema>) {
  const value = parseLearnContract(learnMeasurementAllocationSchema, allocation)
  return value.kind === 'three_case'
    ? { kind: 'full' as const, day7: true, day30: true }
    : { kind: 'partial' as const, day7: value.horizonDays === 7, day30: value.horizonDays === 30 }
}

export const LEARN_V2_SCORER_IDENTITY_POLICY_VERSION = 'learn-v2.scorer-identity-policy.v2' as const
export const learnScorerIdentityPolicySchema = z.strictObject({
  version: z.literal(LEARN_V2_SCORER_IDENTITY_POLICY_VERSION),
  verifiedModelAliases: z.array(z.strictObject({
    configurationDigest: learnDigestSchema, requestedModel: learnTextSchema(200), returnedModel: learnTextSchema(200),
  })).max(16).refine(values => new Set(values.map(value => `${value.configurationDigest}:${value.requestedModel}:${value.returnedModel}`)).size === values.length),
})
export function isLearnScoringReceiptCommittable(input: unknown, policy: z.infer<typeof learnScorerIdentityPolicySchema>): boolean {
  const value = parseLearnContract(learnScoringExecutionReceiptSchema, input)
  const identityPolicy = parseLearnContract(learnScorerIdentityPolicySchema, policy)
  if (value.outcome !== 'validated' || !value.verdict || value.authoritativeAttemptId || value.integrityResult !== 'verified') return false
  const binding = value.scoringBinding
  const observed = value.observedIdentity
  if (binding.kind === 'deterministic') return observed.status === 'deterministic' && observed.engineVersion === binding.engineVersion
  return observed.status === 'verified' && observed.requestedScorerModel === binding.requestedModel
    && observed.returnedScorerModel !== null && (observed.returnedScorerModel === binding.requestedModel
      || identityPolicy.verifiedModelAliases.some(alias => alias.configurationDigest === binding.configurationDigest
        && alias.requestedModel === binding.requestedModel && alias.returnedModel === observed.returnedScorerModel))
    && observed.generationId !== null && observed.servingProvider !== null
    && (binding.routingMode !== 'strict' || observed.endpoint === binding.endpoint)
}

export type LearnMeasurementItemPins = z.infer<typeof learnMeasurementItemPinsSchema>
export type LearnScorerBinding = z.infer<typeof learnScorerBindingSchema>
export type LearnScoringExecutionReceipt = z.infer<typeof learnScoringExecutionReceiptSchema>
export type LearnMeasurementAllocation = z.infer<typeof learnMeasurementAllocationSchema>
export type LearnResponseScope = z.infer<typeof learnResponseScopeSchema>

export function validateLearnMeasurementFamily(input: unknown) {
  return parseLearnContract(learnMeasurementFamilyManifestSchema, input, LEARN_MEASUREMENT_STORAGE_LIMITS.maxEnvelopeBytes)
}
