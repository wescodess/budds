import { v } from 'convex/values'
import { LEARN_V2_MEASUREMENT_REPORT_VERSION, LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION } from '../../shared/learn-v2-measurement-report'
import {
  learnReportMetricValidator, learnReportAssignmentSnapshotValidator as reportAssignmentSnapshot,
  learnReportResultSnapshotValidator as reportResultSnapshot, learnReportInputSnapshotValidator as reportInputSnapshot,
  learnReportFirstSlotStratumValidator, learnReportCapturedMasteryStateValidator,
} from './learnV2MeasurementReportContract'
import { LEARN_V2_RESPONSE_CONTEXT_VERSION, LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION, LEARN_V2_RESPONSE_TERMINALIZATION_VERSION } from '../../shared/learn-v2-responses'

// Storage shapes only. Admission, payload limits and command validators are
// supplied by the following serial contracts; no current player writes these.
const base = { userId: v.string(), storageVersion: v.literal('learn-v2.measurement-storage.v1'), createdAt: v.number() }
const evidenceState = {
  evidenceStatus: v.union(v.literal('available'), v.literal('evidence_unavailable')),
  invalidatedAt: v.optional(v.number()),
}
const capability = {
  learningVoidId: v.id('learningVoids'), blueprintRevisionId: v.id('learnBlueprintRevisions'),
  objectiveId: v.id('learnObjectives'), blueprintRecordRevision: v.number(),
  assessmentContractVersion: v.string(), assessmentContractDigest: v.string(),
  depth: v.union(v.literal('foundational'), v.literal('working'), v.literal('advanced')),
}
const planPins = {
  studyPlanId: v.id('studyPlans'), studyPlanRevisionId: v.id('studyPlanRevisions'),
  planRevision: v.number(), planRecordRevision: v.number(),
}
const sessionPins = {
  studySessionId: v.id('studySessions'), sessionRevision: v.number(),
  sessionContentId: v.id('sessionContent'), contentRevision: v.number(),
  contentInputDigest: v.string(), generatorVersion: v.string(),
}
const canvasPins = v.object({
  threadId: v.id('learningThreads'), threadRevision: v.number(), activityId: v.id('learningThreadActivities'),
  activityRevision: v.number(), planVersion: v.string(), replayVersion: v.string(),
  rendererVersion: v.string(), evaluationVersion: v.string(), pilotConfigurationVersion: v.string(),
})
const contextPins = v.union(
  v.object({ kind: v.literal('calibration'), origin: v.optional(v.union(v.literal('today'), v.literal('canvas'))) }),
  v.object({ kind: v.literal('planned_measurement'), ...planPins }),
  v.object({ kind: v.literal('session'), ...planPins, ...sessionPins, canvas: v.optional(canvasPins) }),
)
const v2Scope = { scopeKind: v.literal('v2'), ...capability, contextPins }
const standaloneScope = {
  scopeKind: v.literal('standalone'), threadId: v.id('learningThreads'),
  activityId: v.id('learningThreadActivities'), threadRevision: v.number(), activityRevision: v.number(),
  activityContractVersion: v.string(),
}
const horizon = v.union(v.literal(7), v.literal(30))
const itemPins = v.object({
  itemId: v.id('learnMeasurementItems'), itemRevision: v.number(), promptDigest: v.string(),
  caseId: v.id('learnAssessmentCases'), familyId: v.id('learnMeasurementFamilies'), familyRevision: v.number(),
  formLabel: v.string(), equivalenceVersion: v.string(), noveltyPolicyVersion: v.string(),
  scoringSpecId: v.id('learnMeasurementScoringSpecs'), scoringSpecRevision: v.number(), scoringSpecDigest: v.string(),
  supportManifestDigest: v.string(), publicationValidationId: v.id('learnMeasurementValidations'),
})
// Ordinary session and calibration opportunities keep their existing content
// authority. Only held-out checks require a measurement-family identity.
const assessmentPins = v.union(
  v.object({ kind: v.literal('measurement'), itemPins }),
  v.object({ kind: v.literal('session_application'), caseId: v.id('learnAssessmentCases'), promptDigest: v.string(), rubricVersion: v.string(), rubricDigest: v.string(), supportManifestDigest: v.string() }),
  v.object({ kind: v.literal('calibration'), caseId: v.id('learnAssessmentCases'), promptDigest: v.string(), assessmentContractVersion: v.string(), assessmentContractDigest: v.string(), supportManifestDigest: v.string() }),
)
const scoringBinding = v.union(
  v.object({ kind: v.literal('deterministic'), engineVersion: v.string(), thresholdVersion: v.string(), thresholdPercent: v.literal(80), transitionVersion: v.literal('learn-v2.mastery-transition.v1') }),
  v.object({ kind: v.literal('model'), configurationId: v.string(), configurationVersion: v.string(), configurationDigest: v.string(), requestedModel: v.string(), routingMode: v.union(v.literal('legacy_auto'), v.literal('strict')), endpoint: v.union(v.string(), v.null()), scorerVersion: v.string(), promptVersion: v.string(), responseSchemaVersion: v.string(), parserVersion: v.string(), guardVersion: v.string(), thresholdVersion: v.string(), thresholdPercent: v.literal(80), transitionVersion: v.literal('learn-v2.mastery-transition.v1') }),
)
const responseSpec = v.union(
  v.object({ kind: v.literal('keyed'), version: v.string(), maxSelections: v.number() }),
  v.object({ kind: v.literal('numeric'), version: v.string(), unit: v.string() }),
  v.object({ kind: v.literal('ordered'), version: v.string(), maxEntries: v.number() }),
  v.object({ kind: v.literal('bounded_rubric'), version: v.string(), maxCodeUnits: v.literal(12000) }),
)
const body = v.union(
  v.object({ kind: v.literal('text'), text: v.string() }),
  v.object({ kind: v.literal('keyed'), keys: v.array(v.string()) }),
  v.object({ kind: v.literal('numeric'), value: v.number(), unit: v.string() }),
  v.object({ kind: v.literal('ordered'), entries: v.array(v.string()) }),
  v.object({ kind: v.literal('source_comparison'), sourceRef: v.string(), comparison: v.string() }),
)
const observation = v.union(v.boolean(), v.literal('unknown'))
const assistanceSnapshot = v.object({
  policyVersion: v.string(), state: v.union(v.literal('unassisted'), v.literal('assisted'), v.literal('unknown')),
  assistanceRevision: v.number(), substantiveHintUsedAt: v.union(v.number(), v.null()), answerRevealedAt: v.union(v.number(), v.null()),
  priorExposure: v.union(v.literal('known'), v.literal('unknown'), v.literal('prospectively_unexposed')),
  outsideHelp: v.union(v.literal('reported'), v.literal('not_reported'), v.literal('unknown')),
  pasteObserved: observation, focusLossObserved: observation, instrumentationVersion: v.string(), instrumentationProvenance: v.string(),
})
const validitySnapshot = v.object({
  policyVersion: v.string(), status: v.union(v.literal('valid'), v.literal('excluded'), v.literal('unknown')),
  measurementEligible: v.boolean(), masteryEligible: v.boolean(), exclusionReasons: v.array(v.string()),
})
const currentResponseState = {
  bodyAvailability: v.union(v.literal('available'), v.literal('purged')),
  currentEligibility: v.union(v.literal('eligible'), v.literal('excluded'), v.literal('unknown')),
  bodyUnavailableReason: v.optional(v.literal('evidence_unavailable')), bodyPurgedAt: v.optional(v.number()),
}
const target = v.union(
  v.object({ assessmentOpportunityId: v.id('learnAssessmentOpportunities') }),
  v.object({ responseSlotId: v.id('learnResponseSlots') }),
)
const clock = v.object({
  protocolVersion: v.string(), schedulingPolicyVersion: v.string(), anchorKind: v.string(),
  anchorEventId: v.string(), anchorAt: v.number(), horizonDays: horizon, timezone: v.string(),
  dueLocalDate: v.string(), dueAt: v.number(), openAt: v.number(), closeAt: v.number(),
})
const firstCheckClaim = v.object({
  claimKey: v.string(), claimSequence: v.number(), basisAttemptId: v.id('masteryAttempts'),
  masteryRecordRevision: v.number(), firstIndependentAt: v.number(), firstIndependentLocalDate: v.string(),
  firstIndependentTimezone: v.string(), transitionVersion: v.literal('learn-v2.mastery-transition.v1'),
  claimFactSequence: v.number(),
})

export const assessmentCatalogFields = {
  ...base, catalogRevision: v.number(), instrumentationEpoch: v.string(),
  historyCompleteness: v.union(v.literal('unknown'), v.literal('prospective_complete')),
  historyBasisVersion: v.string(), historyCoverageWatermark: v.string(),
  measurementCapability: v.optional(v.object({ enabled: v.boolean() })),
}
export const assessmentCaseFields = {
  ...base, caseKey: v.string(), scenarioFingerprint: v.string(), solutionFingerprint: v.string(),
  identityPolicyVersion: v.string(), identityValidationId: v.optional(v.id('learnMeasurementValidations')),
  artifactIdentityValidationId: v.optional(v.id('learnArtifactValidations')),
  usageClass: v.union(v.literal('instructional'), v.literal('measurement_reserved'), v.literal('unknown')),
  reservedAt: v.optional(v.number()),
}
export const measurementFamilyFields = {
  ...base, ...capability, ...evidenceState, familyKey: v.string(), revision: v.number(), recordRevision: v.number(),
  equivalenceVersion: v.string(), equivalenceDescriptor: v.object({ operation: v.string(), contentCoverage: v.string(), transferDemand: v.string(), responseModality: v.string(), scoreScale: v.literal('percent_0_100'), criteriaDigest: v.string(), thresholdVersion: v.string(), rationale: v.string(), difficultyPrior: v.string() }),
  coreFormCount: v.union(v.literal(2), v.literal(3)), totalFormCount: v.number(),
  validationId: v.optional(v.id('learnMeasurementValidations')), validationArtifactDigest: v.string(),
  status: v.union(v.literal('provisional_equivalent'), v.literal('empirically_supported'), v.literal('quarantined'), v.literal('retired')),
  reasonCode: v.string(),
}
export const measurementItemFields = {
  ...base, ...capability, ...evidenceState, familyId: v.id('learnMeasurementFamilies'), familyRevision: v.number(),
  itemKey: v.string(), revision: v.number(), caseId: v.id('learnAssessmentCases'), formLabel: v.string(), reserve: v.boolean(),
  prompt: v.optional(v.string()), declaredStimulus: v.optional(v.string()), promptDigest: v.string(), responseSpec,
  scoringSpecId: v.optional(v.id('learnMeasurementScoringSpecs')), scoringSpecRevision: v.number(), scoringSpecDigest: v.string(),
  generatorVersion: v.string(), generationJobId: v.id('learnJobs'), inputDigest: v.string(),
  catalogRevision: v.number(), supportManifestDigest: v.string(), publicationValidationId: v.optional(v.id('learnMeasurementValidations')),
  status: v.union(v.literal('candidate'), v.literal('quarantined'), v.literal('published'), v.literal('retired')),
}
const scoringSpecPayload = v.union(
    v.object({ kind: v.literal('keyed'), acceptedSets: v.array(v.array(v.string())), normalizationVersion: v.string() }),
    v.object({ kind: v.literal('numeric'), expected: v.number(), unit: v.string(), absoluteTolerance: v.number(), relativeTolerance: v.number(), normalizationVersion: v.string() }),
    v.object({ kind: v.literal('ordered'), expected: v.array(v.string()), normalizationVersion: v.string() }),
    v.object({ kind: v.literal('bounded_rubric'), keyInsufficientReason: v.string(), criteria: v.array(v.object({ key: v.string(), description: v.string(), weightPercent: v.number() })) }),
  )

export const measurementScoringSpecFields = {
  ...base, ...capability, ...evidenceState, itemId: v.id('learnMeasurementItems'), revision: v.number(), digest: v.string(),
  // A missing payload is only a privacy-purged revision, never a usable key.
  payload: v.optional(scoringSpecPayload),
  referenceSolution: v.optional(v.string()), derivation: v.optional(v.string()), scoringBinding,
}
export const assessmentCaseValidator = v.union(
  v.object({ ...assessmentCaseFields, usageClass: v.literal('unknown') }),
  v.object({ ...assessmentCaseFields, usageClass: v.union(v.literal('instructional'), v.literal('measurement_reserved')), identityValidationId: v.id('learnMeasurementValidations') }),
  v.object({ ...assessmentCaseFields, usageClass: v.literal('instructional'), artifactIdentityValidationId: v.id('learnArtifactValidations') }),
)
export const measurementFamilyValidator = v.union(
  v.object({ ...measurementFamilyFields, status: v.union(v.literal('quarantined'), v.literal('retired')) }),
  v.object({ ...measurementFamilyFields, status: v.union(v.literal('provisional_equivalent'), v.literal('empirically_supported')), validationId: v.id('learnMeasurementValidations') }),
)
export const measurementItemValidator = v.union(
  v.object({ ...measurementItemFields, status: v.union(v.literal('candidate'), v.literal('quarantined'), v.literal('retired')) }),
  v.object({ ...measurementItemFields, status: v.literal('published'), evidenceStatus: v.literal('available'), prompt: v.string(), scoringSpecId: v.id('learnMeasurementScoringSpecs'), publicationValidationId: v.id('learnMeasurementValidations') }),
  v.object({ ...measurementItemFields, status: v.literal('published'), evidenceStatus: v.literal('evidence_unavailable') }),
)
export const measurementScoringSpecValidator = v.union(
  v.object({ ...measurementScoringSpecFields, evidenceStatus: v.literal('available'), payload: scoringSpecPayload, referenceSolution: v.string() }),
  v.object({ ...measurementScoringSpecFields, evidenceStatus: v.literal('evidence_unavailable') }),
)
export const measurementClaimFields = {
  ...base, ...capability, ...evidenceState, itemId: v.id('learnMeasurementItems'), scoringSpecId: v.id('learnMeasurementScoringSpecs'),
  order: v.number(), part: v.union(v.literal('stimulus'), v.literal('key'), v.literal('rubric'), v.literal('solution')),
  claim: v.optional(v.string()), claimDigest: v.string(), revision: v.number(),
}
export const measurementSupportFields = {
  ...base, ...capability, ...evidenceState, claimId: v.id('learnMeasurementClaims'), itemId: v.id('learnMeasurementItems'),
  scoringSpecId: v.id('learnMeasurementScoringSpecs'), sourceSnapshotId: v.id('learnSourceSnapshots'), sourceSnapshotRevision: v.number(),
  sourceRecordRevision: v.number(), sourceContentHash: v.string(), sourceRevision: v.string(), sourceExcerptId: v.id('learnSourceExcerpts'),
  excerptDigest: v.string(), locatorDigest: v.string(), supportRevision: v.number(), supportDigest: v.string(),
  rightsStatus: v.literal('permitted'), accessStatus: v.literal('available'), conflictStatus: v.literal('none'),
  entailment: v.literal('entailed'), verifierVersion: v.string(), verifierModel: v.string(),
}
export const measurementValidationFields = {
  ...base, ...capability, ...evidenceState, subject: v.union(
    v.object({ kind: v.literal('case'), caseId: v.id('learnAssessmentCases') }),
    v.object({ kind: v.literal('item'), itemId: v.id('learnMeasurementItems') }),
    v.object({ kind: v.literal('family'), familyId: v.id('learnMeasurementFamilies') }),
    v.object({ kind: v.literal('scoring_spec'), scoringSpecId: v.id('learnMeasurementScoringSpecs') }),
  ), subjectRevision: v.number(), subjectDigest: v.string(),
  check: v.union(v.literal('source_key_correctness'), v.literal('same_case_novelty'), v.literal('comparable_forms'), v.literal('publication')),
  decision: v.union(v.literal('pass'), v.literal('reject'), v.literal('unknown')), reasonCode: v.string(),
  validatorVersion: v.string(), validatorModel: v.union(v.string(), v.null()), promptVersion: v.string(),
  harnessArtifactDigest: v.string(), comparedCatalogRevision: v.number(), corpusDigest: v.string(), coverageWatermark: v.string(),
}
const assignmentBase = {
  ...base, ...capability, ...evidenceState, assignmentKey: v.string(), epoch: v.string(), baselineSha: v.string(),
  flow: v.union(v.literal('v2_today'), v.literal('v2_canvas')), entryPoint: v.string(), cohortVersion: v.string(),
  historyStatus: v.union(v.literal('prospectively_unexposed'), v.literal('returning'), v.literal('unknown')),
  historyBasisVersion: v.string(), instrumentationEpoch: v.string(), exclusionReasons: v.array(v.string()),
  familyId: v.optional(v.id('learnMeasurementFamilies')), familyRevision: v.optional(v.number()),
}
const allocation = v.union(
  v.object({ kind: v.literal('three_case'), order: v.union(v.literal('ABC'), v.literal('ACB'), v.literal('BAC'), v.literal('BCA'), v.literal('CAB'), v.literal('CBA')), cold: itemPins, day7: itemPins, day30: itemPins }),
  v.object({ kind: v.literal('two_case'), horizonDays: horizon, cold: itemPins, delayed: itemPins }),
)
export const measurementAssignmentValidator = v.union(
  v.object({ ...assignmentBase, status: v.union(v.literal('considered'), v.literal('not_admitted')), protocolStatus: v.union(v.literal('protocol_not_frozen'), v.literal('blocked')), reasonCode: v.string() }),
  v.object({ ...assignmentBase, status: v.literal('admitted'), protocolStatus: v.literal('frozen'),
    responseKind: v.union(v.literal('keyed'), v.literal('numeric'), v.literal('ordered'), v.literal('bounded_rubric')),
    familyId: v.id('learnMeasurementFamilies'), familyRevision: v.number(), allocation,
    randomizationSeed: v.string(), allocationVersion: v.string(), sequenceIndex: v.number(),
    protocolVersion: v.string(), schedulingPolicyVersion: v.string(), enrollmentAt: v.number(), enrollmentTimezone: v.string(),
    anchorKind: v.string(), anchorEventId: v.union(v.string(), v.null()), anchorAt: v.union(v.number(), v.null()),
    windowPolicyDigest: v.string(), scoringBinding,
  }),
)
const purpose = v.union(
  v.object({ kind: v.literal('calibration') }),
  v.object({ kind: v.literal('independent_application') }),
  v.object({ kind: v.literal('retained_transfer'), basisAttemptId: v.id('masteryAttempts'), clock }),
  v.object({ kind: v.literal('measurement_cold'), assignmentId: v.id('learnMeasurementAssignments'), protocolVersion: v.string() }),
  v.object({ kind: v.literal('measurement_delayed'), assignmentId: v.id('learnMeasurementAssignments'), horizonDays: horizon, clock }),
)
export const assessmentOpportunityFields = {
  ...base, ...v2Scope, ...evidenceState, delayedCheckId: v.string(), purpose, assessmentPins, scoringBinding,
  assignmentId: v.optional(v.id('learnMeasurementAssignments')), horizonDays: v.optional(horizon),
  phase: v.union(v.literal('preparing'), v.literal('ready'), v.literal('test_open'), v.literal('submitted_sealed'), v.literal('scoring_pending'), v.literal('scored_pass'), v.literal('scored_fail'), v.literal('retryable_failure'), v.literal('reconciliation_required'), v.literal('invalid'), v.literal('cancelled'), v.literal('abandoned')),
  revision: v.number(), eligibilityPolicyVersion: v.string(), operationalEligibility: v.union(v.literal('pending'), v.literal('eligible'), v.literal('blocked')),
  dueAt: v.optional(v.number()), openAt: v.number(), closeAt: v.number(), eligibleAt: v.optional(v.number()), reasonCode: v.optional(v.string()),
  deliveryGrantId: v.optional(v.id('learnAssessmentExposures')), submissionId: v.optional(v.id('learnResponses')),
  scoringJobId: v.optional(v.id('learnJobs')), authoritativeAttemptId: v.optional(v.id('masteryAttempts')),
  replacesOpportunityId: v.optional(v.id('learnAssessmentOpportunities')), replacementReason: v.optional(v.string()),
  firstCheckClaim: v.optional(firstCheckClaim), checkSequence: v.number(), originalSlot: v.boolean(),
  deliveryPins: v.optional(v.object({ version: v.literal(LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION), confidenceRequested: v.boolean() })),
}
export const assessmentExposureFields = {
  ...base, caseId: v.optional(v.id('learnAssessmentCases')), itemId: v.optional(v.id('learnMeasurementItems')),
  itemRevision: v.optional(v.number()), familyId: v.optional(v.id('learnMeasurementFamilies')), formLabel: v.optional(v.string()),
  learningVoidId: v.optional(v.id('learningVoids')), blueprintRevisionId: v.optional(v.id('learnBlueprintRevisions')),
  objectiveId: v.optional(v.id('learnObjectives')), studySessionId: v.optional(v.id('studySessions')),
  threadId: v.optional(v.id('learningThreads')), activityId: v.optional(v.id('learningThreadActivities')),
  assignmentId: v.optional(v.id('learnMeasurementAssignments')), assessmentOpportunityId: v.optional(v.id('learnAssessmentOpportunities')),
  purpose: v.union(v.literal('teaching'), v.literal('practice'), v.literal('calibration'), v.literal('cold_measurement'), v.literal('delayed_measurement'), v.literal('retained_check'), v.literal('feedback'), v.literal('imported'), v.literal('assistance_requested_denied')),
  status: v.union(v.literal('granted'), v.literal('acknowledged'), v.literal('known'), v.literal('possible'), v.literal('unknown'), v.literal('requested_denied')),
  projectionDigest: v.string(), deliveryReceiptHash: v.string(), serverTime: v.number(), observedAt: v.optional(v.number()),
  policyVersion: v.string(), provenanceVersion: v.string(),
}
const slotBase = {
  ...base, ...evidenceState, stage: v.union(v.literal('retrieval'), v.literal('prediction'), v.literal('practice'), v.literal('teach_back'), v.literal('diagnostic')),
  slotKey: v.string(), blockId: v.string(), promptDigest: v.string(), promptRevision: v.number(), responseFormatVersion: v.string(),
  deliveryExposureId: v.id('learnAssessmentExposures'), revision: v.number(),
  status: v.union(v.literal('open'), v.literal('accepted'), v.literal('terminal')),
  confidenceRequested: v.optional(v.boolean()),
  terminalReason: v.optional(v.string()), submissionId: v.optional(v.id('learnResponses')),
}
export const responseSlotValidator = v.union(v.object({ ...slotBase, ...v2Scope }), v.object({ ...slotBase, ...standaloneScope, stage: v.literal('diagnostic') }))
const responseBase = {
  ...base, ...evidenceState, acceptedAt: v.number(), payloadDigest: v.string(), confidence: v.optional(v.number()),
  assistanceSnapshot, validitySnapshot, ...currentResponseState,
  responseContractVersion: v.string(), disclosurePolicyVersion: v.string(), receiptId: v.id('learnResponseCommandReceipts'),
}
const assessmentResponseFields = {
  ...responseBase, ...v2Scope, assessmentOpportunityId: v.id('learnAssessmentOpportunities'), assessmentPins, scoringBinding, deliveryGrantId: v.id('learnAssessmentExposures'),
}
const currentAssessmentResponseFields = { ...assessmentResponseFields,
  responseContextVersion: v.literal(LEARN_V2_RESPONSE_CONTEXT_VERSION), flow: v.union(v.literal('today'), v.literal('canvas')) }
const admittedResponseContext = v.object({ status: v.literal('admitted'), assignmentId: v.id('learnMeasurementAssignments'), baselineEpoch: v.string() })
export const responseValidator = v.union(
  v.object({ ...assessmentResponseFields, baselineEpoch: v.string(), flow: v.union(v.literal('v2_today'), v.literal('v2_canvas')) }),
  v.object({ ...currentAssessmentResponseFields, contextPins: v.union(
    v.object({ kind: v.literal('calibration'), origin: v.union(v.literal('today'), v.literal('canvas')) }), contextPins.members[2]),
  measurementContext: v.union(v.object({ status: v.literal('not_enrolled') }), admittedResponseContext) }),
  v.object({ ...currentAssessmentResponseFields, contextPins: contextPins.members[1], measurementContext: admittedResponseContext }),
  v.object({ ...responseBase, ...v2Scope, responseSlotId: v.id('learnResponseSlots') }),
  v.object({ ...responseBase, ...standaloneScope, responseSlotId: v.id('learnResponseSlots') }),
)
const responseChildScope = v.union(
  v.object({ learningVoidId: v.id('learningVoids') }),
  v.object({ threadId: v.id('learningThreads') }),
)
// Child aggregate anchors are repeated for indexed, child-first cleanup.
export const responseBodyValidator = v.union(
  v.object({ ...base, submissionId: v.id('learnResponses'), learningVoidId: v.id('learningVoids'), payload: body, payloadBytes: v.number(), payloadDigest: v.string() }),
  v.object({ ...base, submissionId: v.id('learnResponses'), threadId: v.id('learningThreads'), payload: body, payloadBytes: v.number(), payloadDigest: v.string() }),
)
export const responseEvidenceLinkFields = {
  ...base, ...evidenceState, submissionId: v.id('learnResponses'), aggregate: responseChildScope,
  learningVoidId: v.optional(v.id('learningVoids')), threadId: v.optional(v.id('learningThreads')),
  dependency: v.union(
    v.object({ kind: v.literal('snapshot'), sourceSnapshotId: v.id('learnSourceSnapshots'), sourceSnapshotRevision: v.number(), sourceRecordRevision: v.number(), supportManifestDigest: v.string() }),
    v.object({ kind: v.literal('document'), documentId: v.id('documents'), sourceRevision: v.string() }),
    v.object({ kind: v.literal('folder'), folderId: v.id('folders'), scopeRevision: v.string() }),
  ),
}
export const responseIntegrityFields = {
  ...base, submissionId: v.id('learnResponses'), learningVoidId: v.optional(v.id('learningVoids')), threadId: v.optional(v.id('learningThreads')),
  sequence: v.number(), kind: v.union(v.literal('evidence_unavailable'), v.literal('pre_seal_contamination'), v.literal('body_purged')),
  reasonCode: v.string(), effectiveAt: v.number(), policyVersion: v.string(), sourceFactSequence: v.number(),
}
const receiptBase = {
  ...base, learningVoidId: v.optional(v.id('learningVoids')), threadId: v.optional(v.id('learningThreads')),
  idempotencyKeyHash: v.string(), requestDigest: v.string(), commandVersion: v.string(), target: v.optional(target),
}
const terminalizedResult = v.object({ kind: v.literal('terminalized'), target, revision: v.number(),
  reasonCode: v.union(v.literal('cancelled'), v.literal('abandoned')), terminalizedAt: v.number() })
export const responseReceiptFields = {
  ...receiptBase,
  result: v.union(v.object({ kind: v.literal('accepted'), submissionId: v.id('learnResponses'), acceptedAt: v.number() }), v.object({ kind: v.literal('rejected'), reasonCode: v.string() }), terminalizedResult),
  expiresAt: v.optional(v.number()),
}
export const responseReceiptValidator = v.union(
  v.object({ ...responseReceiptFields, result: v.object({ kind: v.literal('accepted'), submissionId: v.id('learnResponses'), acceptedAt: v.number() }) }),
  v.object({ ...responseReceiptFields, result: v.object({ kind: v.literal('rejected'), reasonCode: v.string() }), expiresAt: v.number() }),
  v.object({ ...receiptBase, commandVersion: v.literal(LEARN_V2_RESPONSE_TERMINALIZATION_VERSION), target, result: terminalizedResult }),
)
export const scoringExecutionFields = {
  ...base, ...capability, ...evidenceState, assessmentOpportunityId: v.id('learnAssessmentOpportunities'), submissionId: v.id('learnResponses'),
  jobId: v.id('learnJobs'), dispatchOrdinal: v.number(), leaseIdentityHash: v.string(), dispatchedAt: v.number(),
  responseDigest: v.string(), assessmentPins, scoringBinding,
  frozenConfiguration: v.object({ digest: v.string(), snapshot: v.string() }),
  requestDigest: v.string(), requestBytes: v.number(), transportSettingsDigest: v.string(),
  observedIdentity: v.union(
    v.object({ status: v.literal('deterministic'), engineVersion: v.string() }),
    v.object({ status: v.union(v.literal('verified'), v.literal('unknown'), v.literal('mismatch'), v.literal('unverified_legacy')), requestedScorerModel: v.string(), returnedScorerModel: v.union(v.string(), v.null()), generationId: v.union(v.string(), v.null()), servingProvider: v.union(v.string(), v.null()), upstreamRequestId: v.union(v.string(), v.null()), endpoint: v.union(v.string(), v.null()), revision: v.union(v.string(), v.null()), fingerprint: v.union(v.string(), v.null()), observationSource: v.string(), observationVersion: v.string(), observedAt: v.number() }),
  ),
  outcome: v.union(v.literal('pending'), v.literal('validated'), v.literal('refused'), v.literal('error'), v.literal('reconciliation_required')),
  verdict: v.optional(v.object({ criterionResults: v.array(v.object({ key: v.string(), awarded: v.boolean() })), misconceptionTags: v.array(v.string()), scorePercent: v.number(), verdictDigest: v.string(), responseDigest: v.string() })),
  usage: v.union(v.object({ inputTokens: v.number(), outputTokens: v.number(), costMicroUsd: v.union(v.number(), v.null()) }), v.null()),
  authoritativeAttemptId: v.optional(v.id('masteryAttempts')), committedAt: v.optional(v.number()), integrityResult: v.string(),
}

export const reportFactFields = {
  ...base, learningVoidId: v.optional(v.id('learningVoids')), sequence: v.number(), epoch: v.string(),
  factVersion: v.literal(LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION), occurredAt: v.number(),
  fact: v.union(
    v.object({ kind: v.literal('enrollment'), assignmentId: v.id('learnMeasurementAssignments'), recordRevision: v.number(), status: v.union(v.literal('considered'), v.literal('not_admitted'), v.literal('admitted')), snapshot: reportAssignmentSnapshot }),
    v.object({ kind: v.literal('opportunity'), assessmentOpportunityId: v.id('learnAssessmentOpportunities'), recordRevision: v.number(), status: v.string(), dueAt: v.union(v.number(), v.null()), closeAt: v.number(), clock: v.union(clock, v.null()), originalSlot: v.boolean(), stateAtEligibility: v.optional(learnReportCapturedMasteryStateValidator) }),
    v.object({ kind: v.literal('response'), submissionId: v.id('learnResponses'), acceptedAt: v.number(), measurementEligible: v.boolean(), masteryEligible: v.boolean(), assistanceSnapshot, validitySnapshot, stateAtAcceptance: v.optional(learnReportCapturedMasteryStateValidator) }),
    v.object({ kind: v.literal('score'), submissionId: v.id('learnResponses'), attemptId: v.id('masteryAttempts'), executionId: v.id('learnScoringExecutions'), scorePercent: v.number(), scoreCommittedAt: v.number(), snapshot: reportResultSnapshot }),
    v.object({ kind: v.literal('independent_claim'), ...firstCheckClaim.fields, firstCheckOpportunityId: v.id('learnAssessmentOpportunities'), checkSequence: v.number(), stratum: learnReportFirstSlotStratumValidator }),
    v.object({ kind: v.literal('integrity'), submissionId: v.id('learnResponses'), integrityEventId: v.id('learnResponseIntegrityEvents'), currentEligibility: v.string(), evidenceAvailable: v.boolean(), bodyAvailability: v.union(v.literal('available'), v.literal('purged')) }),
  ),
}
export const reportWatermarkFields = {
  ...base, sequence: v.number(), sourceVersion: v.literal(LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION),
  dueWorkThrough: v.union(v.number(), v.null()), historyCoverage: v.union(v.literal('complete'), v.literal('unknown')), updatedAt: v.number(),
}
export const reportRunFields = {
  ...base, cohortVersion: v.string(), epoch: v.string(), protocolVersion: v.string(), baselineSha: v.string(),
  reportVersion: v.literal(LEARN_V2_MEASUREMENT_REPORT_VERSION), queryVersion: v.literal('learn-v2.measurement-report-query.v1'),
  adapterVersion: v.string(), codeVersion: v.string(), rosterDigest: v.string(), cutoff: v.number(),
  enrollmentStartAt: v.number(), enrollmentEndAt: v.number(), status: v.union(v.literal('building'), v.literal('sealed'), v.literal('failed'), v.literal('stale')),
  inputDigest: v.optional(v.string()), extractionStartedAt: v.number(), extractionEndedAt: v.optional(v.number()),
  sourceCoverage: v.union(v.literal('complete'), v.literal('unknown')), rowCount: v.number(), inputBytes: v.number(),
  cursor: v.optional(v.string()), bootstrapSeed: v.string(), bootstrapReplicates: v.literal(10000), reasonCode: v.optional(v.string()),
}
export const reportRowFields = {
  ...base, learningVoidId: v.optional(v.id('learningVoids')), reportRunId: v.id('learnMeasurementReportRuns'),
  sequence: v.number(), sourceWatermark: v.number(), sourceVersion: v.literal(LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION),
  assignmentId: v.optional(v.id('learnMeasurementAssignments')), horizonDays: v.optional(horizon),
  rowKind: v.union(v.literal('owner_watermark'), v.literal('episode'), v.literal('first_check_claim')),
  snapshot: reportInputSnapshot,
  // Normalized scalar inputs only; never a response, prompt or scorer payload.
  facts: v.object({ disposition: v.string(), coldScorePercent: v.union(v.number(), v.null()), delayedScorePercent: v.union(v.number(), v.null()), claimKey: v.union(v.string(), v.null()), claimSequence: v.union(v.number(), v.null()), checkSequence: v.union(v.number(), v.null()), admitted: v.boolean(), matured: v.boolean(), valid: v.boolean() }),
  invalidatedAt: v.optional(v.number()),
}
export const reportCellFields = {
  ...base, reportRunId: v.id('learnMeasurementReportRuns'), cellKey: v.string(), sequence: v.number(),
  reportVersion: v.literal(LEARN_V2_MEASUREMENT_REPORT_VERSION), ...learnReportMetricValidator.fields,
}
export const reportViewerGrantFields = {
  ...base, cohortVersion: v.string(), epoch: v.string(), principalBindingVersion: v.string(),
  grantVersion: v.string(), status: v.union(v.literal('active'), v.literal('revoked')),
  grantedAt: v.number(), revokedAt: v.optional(v.number()), expiresAt: v.number(),
}

export const measurementAttemptPins = v.object({
    version: v.literal('learn-v2.measurement-storage.v1'), scope: v.object(v2Scope), assessmentOpportunityId: v.id('learnAssessmentOpportunities'),
    submissionId: v.id('learnResponses'), executionId: v.id('learnScoringExecutions'), itemPins, scoringBinding,
    assistanceSnapshot, validitySnapshot, acceptedAt: v.number(), scoreCommittedAt: v.number(),
    requestedScorerModel: v.union(v.string(), v.null()), returnedScorerModel: v.union(v.string(), v.null()),
    firstCheckClaim: v.optional(firstCheckClaim), checkSequence: v.optional(v.number()),
  })
export const optionalMeasurementLegacyFields = {
  measurementStorage: v.optional(measurementAttemptPins),
  submissionId: v.optional(v.id('learnResponses')), assessmentOpportunityId: v.optional(v.id('learnAssessmentOpportunities')),
  horizonDays: v.optional(horizon),
  scoringExecutionId: v.optional(v.id('learnScoringExecutions')), scoringBinding: v.optional(scoringBinding),
  assessmentPins: v.optional(assessmentPins), acceptedAt: v.optional(v.number()), scoreCommittedAt: v.optional(v.number()),
  requestedScorerModel: v.optional(v.union(v.string(), v.null())), returnedScorerModel: v.optional(v.union(v.string(), v.null())),
  assistanceSnapshot: v.optional(assistanceSnapshot), validitySnapshot: v.optional(validitySnapshot),
  firstCheckClaim: v.optional(firstCheckClaim), checkSequence: v.optional(v.number()),
  firstCheckOpportunityId: v.optional(v.id('learnAssessmentOpportunities')),
}
export const optionalAssessmentReferenceFields = {
  assessmentOpportunityId: v.optional(v.id('learnAssessmentOpportunities')),
  assessmentPurpose: v.optional(v.union(v.literal('calibration'), v.literal('independent_application'), v.literal('retained_transfer'), v.literal('measurement_cold'), v.literal('measurement_delayed'))),
}
export const optionalMeasurementJobFields = {
  ...optionalAssessmentReferenceFields, submissionId: v.optional(v.id('learnResponses')),
  familyId: v.optional(v.id('learnMeasurementFamilies')), itemId: v.optional(v.id('learnMeasurementItems')),
  publicationValidationId: v.optional(v.id('learnMeasurementValidations')), scoringBinding: v.optional(scoringBinding),
}
