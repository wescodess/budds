import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import type { Doc } from '../convex/_generated/dataModel'
import {
  LEARN_V2_RESPONSE_CONTRACT_VERSION, LEARN_V2_ASSISTANCE_POLICY_VERSION, LEARN_V2_VALIDITY_POLICY_VERSION,
  learnIdSchema, learnSerializedBytes, learnResponsePayloadSchema, learnAssistanceSnapshotSchema, learnValiditySnapshotSchema,
  learnAcceptResponseRequestSchema, learnFinalResponseBundleSchema, learnResponseReceiptSchema, learnAssistanceDeliverySchema,
  parseLearnContract, resolveLearnInstrumentation, validateLearnAcceptResponseRequest, type learnResponseDependencySchema,
} from './learn-v2-responses'
import {
  LEARN_V2_MEASUREMENT_VERSION, LEARN_V2_FORM_ORDERS, learnMeasurementItemPinsSchema, learnMeasurementAllocationSchema,
  learnScorerBindingSchema, learnObservedScorerIdentitySchema, learnScoringExecutionReceiptSchema, learnPrivateScoringPayloadSchema,
  learnMeasurementFamilyManifestSchema, learnMeasurementPublicationCandidateSchema, learnAssessmentExposureSchema,
  learnMeasurementHistorySchema, learnV2ScopeSchema, learnStandaloneScopeSchema,
  doesLearnExposureConsumeCase, evaluateLearnMeasurementAdmission, isLearnScoringReceiptCommittable, learnMeasurementCoverage,
} from './learn-v2-measurement'
import {
  LEARN_V2_DELAYED_CHECK_VERSION, learnAssessmentClockSchema, learnAssessmentLifecycleSchema, learnAssessmentPurposeSchema,
  canTransitionLearnAssessment, evaluateLearnAssessmentEligibility, resolveLearnAssessmentCapabilities,
} from './learn-v2-delayed-check'
import {
  LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, learnDeliveredAssessmentSchema, learnOwnerAssessmentExportSchema,
  learnAttemptHistorySchema, projectObjectiveSummary, projectDeliveredAssessment, projectOwnerExport, canDiscloseLearnHelp,
} from './learn-v2-assessment-disclosure'
import {
  LEARN_V2_MEASUREMENT_REPORT_VERSION, LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, learnReportQuerySchema, learnReportMetricSchema, learnMeasurementReportSchema,
  learnReportProvenanceSchema, validateLearnReportSourcePage,
  type learnReportAssignmentSnapshotSchema, type learnReportResultSnapshotSchema, type learnReportFactPayloadSchema,
  type learnReportFactSchema, type learnReportInputSnapshotSchema,
} from './learn-v2-measurement-report'
import { deriveEligibleMeasurementMastery, deriveMastery, addCalendarDays } from './learn-v2-mastery'
import { LEARN_V2_PURPOSE_SESSION_CONTENT_VERSION, validateLearnV2SessionContentCandidate } from './learn-v2-session-content'
import { LEARN_MEASUREMENT_EVENT_TAXONOMY_VERSION, validateLearnMeasurementEventInput, learnMeasurementEventSemanticKey, canEmitLearnMeasurementOutcomeEvent } from './learn-adaptive-events'

const digest = `sha256:${'a'.repeat(64)}`
const ref = <T extends string>(value: string) => learnIdSchema<T>().parse(value)
const acceptedAt = Date.parse('2026-11-08T05:00:00Z')
const clock = learnAssessmentClockSchema.parse({
  protocolVersion: 'protocol.v1', schedulingPolicyVersion: 'schedule.v1', anchorKind: 'cold_acceptance', anchorEventId: 'cold-1',
  anchorAt: Date.parse('2026-11-01T05:00:00Z'), horizonDays: 7, timezone: 'America/Toronto', dueLocalDate: '2026-11-08',
  dueAt: acceptedAt, openAt: acceptedAt, closeAt: acceptedAt + 86_400_000,
})
const scope = learnV2ScopeSchema.parse({
  scopeKind: 'v2', learningVoidId: 'void1', blueprintRevisionId: 'blueprint1', objectiveId: 'objective1', blueprintRecordRevision: 1,
  assessmentContractVersion: 'assessment.v1', assessmentContractDigest: digest, depth: 'working', contextPins: { kind: 'calibration' },
})
const assistance = learnAssistanceSnapshotSchema.parse({
  policyVersion: LEARN_V2_ASSISTANCE_POLICY_VERSION, state: 'unassisted', assistanceRevision: 0,
  substantiveHintUsedAt: null, answerRevealedAt: null, priorExposure: 'prospectively_unexposed', outsideHelp: 'not_reported',
  pasteObserved: 'unknown', focusLossObserved: 'unknown', instrumentationVersion: 'instrumentation.v1', instrumentationProvenance: 'client.v1',
})
const validity = learnValiditySnapshotSchema.parse({
  policyVersion: LEARN_V2_VALIDITY_POLICY_VERSION, status: 'valid', measurementEligible: true, masteryEligible: false, exclusionReasons: [],
})
function pins(label = 'A', caseLabel = label) {
  return learnMeasurementItemPinsSchema.parse({
    itemId: `item${label}`, itemRevision: 1, promptDigest: digest, caseId: `case${caseLabel}`, familyId: 'family1', familyRevision: 1,
    formLabel: label, equivalenceVersion: 'equivalence.v1', noveltyPolicyVersion: 'novelty.v1', scoringSpecId: `spec${label}`,
    scoringSpecRevision: 1, scoringSpecDigest: digest, supportManifestDigest: digest, publicationValidationId: 'validation1',
  })
}
const deterministic = learnScorerBindingSchema.parse({
  kind: 'deterministic', engineVersion: 'keyed-scorer.v1', thresholdVersion: 'threshold.v1', thresholdPercent: 80,
  transitionVersion: 'learn-v2.mastery-transition.v1',
})
const model = learnScorerBindingSchema.parse({
  kind: 'model', configurationId: 'baseline.v1', configurationVersion: 'config.v1', configurationDigest: digest,
  requestedModel: 'vendor/model-v1', routingMode: 'strict', endpoint: 'provider/endpoint-v1',
  scorerVersion: 'learn-v2.mastery-scorer.v1', promptVersion: 'prompt.v1', responseSchemaVersion: 'response.v1',
  parserVersion: 'parser.v1', guardVersion: 'guard.v1', thresholdVersion: 'threshold.v1', thresholdPercent: 80,
  transitionVersion: 'learn-v2.mastery-transition.v1',
})
const purpose = learnAssessmentPurposeSchema.parse({ kind: 'measurement_delayed', assignmentId: 'assignment1', horizonDays: 7, clock })
const lifecycle = learnAssessmentLifecycleSchema.parse({
  version: LEARN_V2_DELAYED_CHECK_VERSION, assessmentOpportunityId: 'opportunity1', revision: 1, purpose, phase: 'test_open',
  deliveryGrantId: 'grant1', submissionId: null, authoritativeAttemptId: null, acceptedAt: null, checkSequence: 1,
})
const eligibility = {
  purpose, acceptedAt, acceptedT0: true, evidenceAvailable: true, pinsMatch: true, deliveryGranted: true,
  historyKnown: true, novelCase: 'yes' as const, inAssignedWindow: true, assignmentAdmitted: true, coldBeforeTeaching: true,
  assistance, previousState: 'learning' as const, firstIndependentLocalDate: null, firstIndependentTimezone: null,
}
const identity = { kind: 'measurement' as const, itemId: pins().itemId, itemRevision: 1, promptDigest: digest }
const disclosure = {
  version: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, owned: true, accessAvailable: true, evidenceAvailable: true, pinsMatch: true,
  lifecycle, grant: { policyVersion: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, deliveryGrantId: ref<'learnAssessmentExposures'>('grant1'), assessmentOpportunityId: lifecycle.assessmentOpportunityId,
    identity, projectionDigest: digest, grantedAt: acceptedAt - 1, status: 'granted' as const },
}
const delivered = { identity, projectionDigest: digest, prompt: 'Apply the rule to this new case.', declaredStimulus: null,
  instructions: 'Submit your answer.', responseSpec: { kind: 'keyed', version: 'keyed.v1', maxSelections: 2 } }
const work = { submissionId: ref<'learnResponses'>('submission1'), acceptedAt, confidence: 3,
  assistanceSnapshot: assistance, validitySnapshot: validity, currentEligibility: 'eligible',
  body: { bodyAvailability: 'available', payload: { kind: 'text', text: 'An independently written correct answer' } }, result: null }

describe('owned response boundary', () => {
  const request = { version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'request_1234567890',
    response: { target: { responseSlotId: ref<'learnResponseSlots'>('slot1') }, expectedRevision: 1, payload: { kind: 'text', text: '  私の答え🙂  ' } } }

  it('preserves Unicode and whitespace exactly and leaves missing instrumentation unknown', () => {
    const parsed = validateLearnAcceptResponseRequest(request, { diagnostic: false, confidenceRequested: false })
    expect(parsed.response.payload).toEqual(request.response.payload)
    expect(resolveLearnInstrumentation(parsed.response.instrumentation)).toMatchObject({ pasteObserved: 'unknown', focusLossObserved: 'unknown' })
    expect(learnSerializedBytes(request)).toBe(new TextEncoder().encode(JSON.stringify(request)).byteLength)
  })
  it.each([NaN, Infinity, -Infinity])('rejects non-finite numeric work: %s', value => {
    expect(() => parseLearnContract(learnResponsePayloadSchema, { kind: 'numeric', value, unit: 'm' })).toThrow()
  })
  it.each([
    { kind: 'text', text: ' ' }, { kind: 'text', text: 'x'.repeat(12001) },
    { kind: 'keyed', keys: ['a', 'a'] }, { kind: 'keyed', keys: Array.from({ length: 33 }, (_, index) => String(index)) },
    { kind: 'numeric', value: 3, unit: 'm', expected: 3 }, { kind: 'ordered', entries: [] },
    { kind: 'text', text: 'ok', privateRubric: 'private' },
  ])('rejects invalid or oversized typed answers', payload => {
    expect(() => parseLearnContract(learnResponsePayloadSchema, payload)).toThrow()
  })
  it('checks serialized payload bytes, including escaping, at the exact 48 KiB ceiling', () => {
    const overhead = learnSerializedBytes({ kind: 'text', text: '' })
    const controls = Math.floor((48 * 1024 - overhead) / 6)
    const remainder = 48 * 1024 - overhead - controls * 6
    const text = '\u0000'.repeat(controls) + 'x'.repeat(remainder)
    expect(learnSerializedBytes({ kind: 'text', text })).toBe(48 * 1024)
    expect(parseLearnContract(learnResponsePayloadSchema, { kind: 'text', text })).toEqual({ kind: 'text', text })
    expect(() => parseLearnContract(learnResponsePayloadSchema, { kind: 'text', text: text + 'x' })).toThrow()
  })
  it('counts JavaScript code units and retains the tighter diagnostic byte limit', () => {
    expect(() => parseLearnContract(learnResponsePayloadSchema, { kind: 'text', text: '🙂'.repeat(6000) })).not.toThrow()
    expect(() => parseLearnContract(learnResponsePayloadSchema, { kind: 'text', text: '🙂'.repeat(6001) })).toThrow()
    expect(() => validateLearnAcceptResponseRequest({ ...request, response: { ...request.response, payload: { kind: 'text', text: '漢'.repeat(4000) } } }, { diagnostic: true, confidenceRequested: false })).toThrow()
  })
  it('rejects oversized original envelopes and executable or cyclic values', () => {
    expect(() => parseLearnContract(learnAcceptResponseRequestSchema, { ...request, extra: 'x'.repeat(65536) })).toThrow()
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
    expect(() => learnSerializedBytes(cyclic)).toThrow()
    expect(() => learnSerializedBytes({ value: undefined })).toThrow()
    expect(() => learnSerializedBytes({ toJSON: () => request })).toThrow()
    expect(() => learnSerializedBytes(Array(2))).toThrow()
  })
  it('requires exactly one owned target and slot-specific confidence', () => {
    expect(() => parseLearnContract(learnAcceptResponseRequestSchema, { ...request, userId: 'forged' })).toThrow()
    expect(() => parseLearnContract(learnAcceptResponseRequestSchema, { ...request, response: { ...request.response,
      target: { responseSlotId: 'slot1', assessmentOpportunityId: 'opportunity1' } } })).toThrow()
    expect(() => validateLearnAcceptResponseRequest(request, { diagnostic: false, confidenceRequested: true })).toThrow()
    for (const confidence of [0, 1.5, 6, NaN]) expect(() => parseLearnContract(learnAcceptResponseRequestSchema, { ...request,
      response: { ...request.response, confidence } })).toThrow()
  })
  it('limits the final bundle to one ungraded slot and one assessment', () => {
    const bundle = { version: request.version, idempotencyKey: request.idempotencyKey, teachBack: request.response,
      application: { ...request.response, target: { assessmentOpportunityId: 'opportunity1' } } }
    expect(parseLearnContract(learnFinalResponseBundleSchema, bundle)).toEqual(bundle)
    expect(() => parseLearnContract(learnFinalResponseBundleSchema, { ...bundle, third: request.response })).toThrow()
    expect(() => parseLearnContract(learnFinalResponseBundleSchema, { ...bundle, application: request.response })).toThrow()
  })
  it('accepts an exact 64 KiB final envelope and rejects the next byte', () => {
    const bundle = { version: request.version, idempotencyKey: request.idempotencyKey,
      teachBack: { ...request.response, payload: { kind: 'text', text: '\u0000'.repeat(5400) } },
      application: { ...request.response, target: { assessmentOpportunityId: 'opportunity1' }, payload: { kind: 'text', text: '\u0000'.repeat(5400) } } }
    bundle.application.payload.text += 'x'.repeat(64 * 1024 - learnSerializedBytes(bundle))
    expect(learnSerializedBytes(bundle)).toBe(64 * 1024)
    expect(() => parseLearnContract(learnFinalResponseBundleSchema, bundle)).not.toThrow()
    expect(() => parseLearnContract(learnFinalResponseBundleSchema, { ...bundle, application: { ...bundle.application,
      payload: { kind: 'text', text: bundle.application.payload.text + 'x' } } })).toThrow()
  })
  it('enforces the exact 12,000-byte diagnostic payload ceiling', () => {
    const text = 'x'.repeat(12000 - learnSerializedBytes({ kind: 'text', text: '' }))
    const diagnostic = { ...request, response: { ...request.response, payload: { kind: 'text', text } } }
    expect(() => validateLearnAcceptResponseRequest(diagnostic, { diagnostic: true, confidenceRequested: false })).not.toThrow()
    expect(() => validateLearnAcceptResponseRequest({ ...diagnostic, response: { ...diagnostic.response,
      payload: { kind: 'text', text: text + 'x' } } }, { diagnostic: true, confidenceRequested: false })).toThrow()
  })
  it('separates denied help from delivered help and instrumentation from assistance', () => {
    expect(parseLearnContract(learnAssistanceDeliverySchema, { kind: 'requested_denied', reasonCode: 'test_open', requestedAt: acceptedAt })).toMatchObject({ kind: 'requested_denied' })
    expect(() => parseLearnContract(learnAssistanceDeliverySchema, { kind: 'requested_denied', exposureId: 'help', requestedAt: acceptedAt, reasonCode: 'test_open' })).toThrow()
    expect(learnAssistanceSnapshotSchema.parse({ ...assistance, pasteObserved: true, focusLossObserved: true }).state).toBe('unassisted')
    expect(() => learnAssistanceSnapshotSchema.parse({ ...assistance, answerRevealedAt: acceptedAt })).toThrow()
    expect(() => learnAssistanceSnapshotSchema.parse({ ...assistance, pasteObserved: null })).toThrow()
    expect(() => learnValiditySnapshotSchema.parse({ ...validity, status: 'excluded', exclusionReasons: ['assisted'] })).toThrow()
  })
  it('cannot return body/key material in an acceptance receipt', () => {
    expect(() => parseLearnContract(learnResponseReceiptSchema, { kind: 'rejected', version: request.version, reasonCode: 'disabled', payload: 'private' })).toThrow()
  })
})

describe('Measurement Item identity and scorer pins', () => {
  it.each(LEARN_V2_FORM_ORDERS)('freezes the distinct-case order %s', order => {
    const allocation = learnMeasurementAllocationSchema.parse({ kind: 'three_case', order, cold: pins(order[0]), day7: pins(order[1]), day30: pins(order[2]) })
    expect(learnMeasurementCoverage(allocation)).toEqual({ kind: 'full', day7: true, day30: true })
  })
  it.each([7, 30])('explicitly declares only the %s-day delayed horizon for two forms', horizonDays => {
    const allocation = learnMeasurementAllocationSchema.parse({ kind: 'two_case', horizonDays, cold: pins('A'), delayed: pins('B') })
    expect(learnMeasurementCoverage(allocation)).toEqual({ kind: 'partial', day7: horizonDays === 7, day30: horizonDays === 30 })
    expect(() => learnMeasurementAllocationSchema.parse({ ...allocation, day30: pins('C') })).toThrow()
  })
  it('rejects a paraphrase of the same case, mixed families and a rerolled order', () => {
    const allocation = { kind: 'three_case', order: 'ABC', cold: pins('A'), day7: pins('B'), day30: pins('C') }
    expect(() => learnMeasurementAllocationSchema.parse({ ...allocation, day7: pins('B', 'A') })).toThrow()
    expect(() => learnMeasurementAllocationSchema.parse({ ...allocation, day7: { ...pins('B'), familyRevision: 2 } })).toThrow()
    expect(() => learnMeasurementAllocationSchema.parse({ ...allocation, order: 'BAC' })).toThrow()
  })
  it('bounds family members and private numeric/rubric scoring payloads', () => {
    expect(() => learnPrivateScoringPayloadSchema.parse({ kind: 'numeric', expected: Infinity, unit: 'm', absoluteTolerance: 0, relativeTolerance: 0, normalizationVersion: 'numeric.v1' })).toThrow()
    expect(() => learnPrivateScoringPayloadSchema.parse({ kind: 'bounded_rubric', keyInsufficientReason: 'reasoning', criteria: [{ key: 'a', description: 'private', weightPercent: 80 }] })).toThrow()
    const family = { version: LEARN_V2_MEASUREMENT_VERSION, learningVoidId: scope.learningVoidId, blueprintRevisionId: scope.blueprintRevisionId,
      objectiveId: scope.objectiveId, blueprintRecordRevision: scope.blueprintRecordRevision, assessmentContractVersion: scope.assessmentContractVersion,
      assessmentContractDigest: digest, depth: scope.depth, familyId: 'family1', revision: 1, equivalenceVersion: 'equivalence.v1',
      equivalenceDescriptor: { operation: 'apply', contentCoverage: 'rule', transferDemand: 'new case', responseModality: 'keyed', scoreScale: 'percent_0_100',
        criteriaDigest: digest, thresholdVersion: 'threshold.v1', rationale: 'same demand', difficultyPrior: 'provisional' },
      status: 'provisional_equivalent', coreFormCount: 3,
      members: ['A', 'B', 'C', 'D', 'E', 'F'].map(label => ({ pins: pins(label), reserve: !'ABC'.includes(label) })) }
    expect(learnMeasurementFamilyManifestSchema.parse(family).members).toHaveLength(6)
    expect(() => learnMeasurementFamilyManifestSchema.parse({ ...family, members: [...family.members, { pins: pins('F'), reserve: true }] })).toThrow()
    expect(() => learnMeasurementFamilyManifestSchema.parse({ ...family, coreFormCount: 2 })).toThrow()
  })
  it('requires bounded T0 support and matching response/scoring contracts before publication', () => {
    const support = { sourceSnapshotId: 'snapshot1', sourceSnapshotRevision: 1, sourceRecordRevision: 1, sourceContentHash: digest,
      sourceRevision: 'source.v1', sourceExcerptId: 'excerpt1', excerptDigest: digest, locatorDigest: digest, supportRevision: 1, supportDigest: digest,
      rightsStatus: 'permitted', accessStatus: 'available', conflictStatus: 'none', entailment: 'entailed', verifierVersion: 'verifier.v1', verifierModel: 'verifier/model' }
    const candidate = { version: LEARN_V2_MEASUREMENT_VERSION, learningVoidId: scope.learningVoidId, blueprintRevisionId: scope.blueprintRevisionId,
      objectiveId: scope.objectiveId, blueprintRecordRevision: 1, assessmentContractVersion: scope.assessmentContractVersion,
      assessmentContractDigest: digest, depth: scope.depth, pins: pins(), prompt: 'Apply a rule', declaredStimulus: null,
      responseSpec: { kind: 'keyed', version: 'keyed.v1', maxSelections: 2 }, privateScoring: { kind: 'keyed', acceptedSets: [['a']], normalizationVersion: 'keyed.v1' },
      referenceSolution: 'private answer', derivation: 'private derivation', scoringBinding: deterministic,
      claims: [{ order: 0, part: 'key', claim: 'private supported claim', claimDigest: digest, revision: 1, supports: [support] }] }
    expect(parseLearnContract(learnMeasurementPublicationCandidateSchema, candidate).claims).toHaveLength(1)
    expect(() => parseLearnContract(learnMeasurementPublicationCandidateSchema, { ...candidate, scoringBinding: model })).toThrow()
    expect(() => parseLearnContract(learnMeasurementPublicationCandidateSchema, { ...candidate, claims: [{ ...candidate.claims[0], supports: [] }] })).toThrow()
    expect(() => parseLearnContract(learnMeasurementPublicationCandidateSchema, { ...candidate, claims: [{ ...candidate.claims[0], supports: [{ ...support, entailment: 'unknown' }] }] })).toThrow()
    expect(() => learnStandaloneScopeSchema.parse({ scopeKind: 'standalone', threadId: 'thread1', activityId: 'activity1',
      threadRevision: 1, activityRevision: 1, activityContractVersion: 'diagnostic.v1', objectiveId: 'invented' })).toThrow()
  })
  const admission = { protocolFrozen: true, flowAdmitted: true, acceptedT0: true, evidenceAvailable: true,
    historyStatus: 'prospectively_unexposed' as const, historyBasisVersion: 'history.v1', historyCoverageWatermark: 'coverage.v1',
    inventoryNovel: 'yes' as const, familyStatus: 'provisional_equivalent' as const, pinsMatch: true }
  it('requires T0 and positive history evidence rather than absence of exposure rows', () => {
    expect(evaluateLearnMeasurementAdmission(admission).admitted).toBe(true)
    expect(evaluateLearnMeasurementAdmission({ ...admission, acceptedT0: false }).reasonCodes).toContain('unmeasurable_no_t0')
    expect(evaluateLearnMeasurementAdmission({ ...admission, historyStatus: 'unknown' }).reasonCodes).toContain('unknown_history')
    expect(evaluateLearnMeasurementAdmission({ ...admission, historyCoverageWatermark: null }).admitted).toBe(false)
    expect(learnMeasurementHistorySchema.parse({ kind: 'legacy', historyStatus: 'unknown', identityStatus: 'unverified_legacy' })).toMatchObject({ historyStatus: 'unknown' })
    expect(() => learnMeasurementHistorySchema.parse({ kind: 'legacy', historyStatus: 'prospectively_unexposed', identityStatus: 'verified' })).toThrow()
  })
  it('preserves denied requests without consuming an unseen case', () => {
    const exposure = learnAssessmentExposureSchema.parse({ purpose: 'assistance_requested_denied', status: 'requested_denied',
      projectionDigest: digest, deliveryReceiptHash: digest, serverTime: acceptedAt, policyVersion: 'policy.v1', provenanceVersion: 'provenance.v1' })
    expect(doesLearnExposureConsumeCase(exposure)).toBe(false)
    expect(doesLearnExposureConsumeCase({ ...exposure, purpose: 'imported', status: 'unknown' })).toBe(true)
    expect(() => learnAssessmentExposureSchema.parse({ ...exposure, status: 'granted' })).toThrow()
  })
  const observed = learnObservedScorerIdentitySchema.parse({ status: 'verified', requestedScorerModel: 'vendor/model-v1', returnedScorerModel: 'vendor/model-v1',
    generationId: 'generation1', servingProvider: 'provider', upstreamRequestId: null, endpoint: 'provider/endpoint-v1', revision: null, fingerprint: null,
    observationSource: 'inline_metadata', observationVersion: 'identity.v1', observedAt: acceptedAt + 1 })
  const receipt = { assessmentOpportunityId: 'opportunity1', submissionId: 'submission1', jobId: 'job1', dispatchOrdinal: 1, leaseIdentityHash: digest,
    dispatchedAt: acceptedAt, responseDigest: digest, assessmentPins: { kind: 'measurement', itemPins: pins() }, scoringBinding: model,
    frozenConfiguration: { digest, snapshot: '{"version":"config.v1"}' }, requestDigest: digest, requestBytes: 1024, transportSettingsDigest: digest,
    observedIdentity: observed, outcome: 'validated', verdict: { criterionResults: [{ key: 'criterion1', awarded: true }], misconceptionTags: [], scorePercent: 80,
      verdictDigest: digest, responseDigest: digest }, usage: null, integrityResult: 'verified' }
  it('commits only a complete verified intended/observed receipt', () => {
    const policy = { version: 'aliases.v1', verifiedModelAliases: [] }
    expect(isLearnScoringReceiptCommittable(receipt, policy)).toBe(true)
    for (const status of ['unknown', 'mismatch', 'unverified_legacy']) {
      expect(isLearnScoringReceiptCommittable({ ...receipt, observedIdentity: { ...observed, status } }, policy)).toBe(false)
    }
    expect(isLearnScoringReceiptCommittable({ ...receipt, observedIdentity: { ...observed, returnedScorerModel: 'other/model' } }, policy)).toBe(false)
    expect(isLearnScoringReceiptCommittable({ ...receipt, observedIdentity: { ...observed, endpoint: null } }, policy)).toBe(false)
    expect(() => learnScorerBindingSchema.parse({ ...model, endpoint: null })).toThrow()
    expect(() => learnScoringExecutionReceiptSchema.parse({ ...receipt, verdict: { ...receipt.verdict, scorePercent: NaN } })).toThrow()
    expect(() => learnScoringExecutionReceiptSchema.parse({ ...receipt, outcome: 'reconciliation_required' })).toThrow()
    expect(() => learnScoringExecutionReceiptSchema.parse({ ...receipt, actualModel: 'guessed' })).toThrow()
  })
  it('keeps deterministic execution explicitly model-free', () => {
    expect(isLearnScoringReceiptCommittable({ ...receipt, scoringBinding: deterministic,
      observedIdentity: { status: 'deterministic', engineVersion: 'keyed-scorer.v1' } }, { version: 'aliases.v1', verifiedModelAliases: [] })).toBe(true)
  })
})

describe('test-only lifecycle and mastery eligibility', () => {
  it('allows delayed measurement below Independent without awarding mastery', () => {
    expect(evaluateLearnAssessmentEligibility(eligibility)).toMatchObject({ measurementEligible: true, masteryEligible: false })
    expect(deriveEligibleMeasurementMastery({ kind: 'measurement_delayed', scorePercent: 90, measurementEligible: true, masteryEligible: false, previousState: 'learning' })).toBeNull()
    expect(evaluateLearnAssessmentEligibility({ ...eligibility, purpose: { kind: 'measurement_cold', assignmentId: ref<'learnMeasurementAssignments'>('assignment1'), protocolVersion: 'protocol.v1' } })).toMatchObject({ measurementEligible: true, masteryEligible: false })
  })
  it('preserves the local-calendar seven-day rule and the 80 threshold through DST', () => {
    const promoted = evaluateLearnAssessmentEligibility({ ...eligibility, previousState: 'independent', firstIndependentLocalDate: '2026-11-01', firstIndependentTimezone: 'America/Toronto' })
    expect(promoted.masteryEligible).toBe(true)
    expect(evaluateLearnAssessmentEligibility({ ...eligibility, acceptedAt: acceptedAt - 1, previousState: 'independent', firstIndependentLocalDate: '2026-11-01', firstIndependentTimezone: 'America/Toronto' }).masteryEligible).toBe(false)
    expect(evaluateLearnAssessmentEligibility({ ...eligibility, acceptedAt: clock.closeAt }).measurementEligible).toBe(false)
    const input = { kind: 'measurement_delayed' as const, measurementEligible: true, masteryEligible: true, previousState: 'independent' as const,
      firstIndependentLocalDate: '2026-11-01', attemptLocalDate: '2026-11-08' }
    expect(deriveEligibleMeasurementMastery({ ...input, scorePercent: 80 })?.state).toBe('retained')
    expect(deriveEligibleMeasurementMastery({ ...input, scorePercent: 79 })?.state).toBe('needs_review')
    expect(addCalendarDays('2026-11-01', 7)).toBe('2026-11-08')
    expect(deriveMastery({ kind: 'independent_application', assisted: true, scorePercent: 100 }).state).toBe('guided')
  })
  it('never turns unknown history or assistance into clean performance', () => {
    expect(evaluateLearnAssessmentEligibility({ ...eligibility, historyKnown: false }).measurementEligible).toBe(false)
    expect(evaluateLearnAssessmentEligibility({ ...eligibility, assistance: { ...assistance, state: 'unknown' } }).measurementEligible).toBe(false)
    expect(evaluateLearnAssessmentEligibility({ ...eligibility, assistance: { ...assistance, pasteObserved: true, focusLossObserved: true } }).measurementEligible).toBe(true)
    expect(evaluateLearnAssessmentEligibility({ ...eligibility, assistance: { ...assistance, policyVersion: 'unknown.v1' } }).measurementEligible).toBe(false)
  })
  it('defaults every capability off and opens separate-case teaching only after sealing', () => {
    const input = { lifecycle, authorized: true, evidenceAvailable: true, pinsMatch: true, validScore: false }
    expect(resolveLearnAssessmentCapabilities(input)).toMatchObject({ status: 'disabled', canSubmit: false, canRequestAssistance: false, canTeachSeparateCase: false })
    expect(resolveLearnAssessmentCapabilities({ ...input, enabled: true })).toMatchObject({ canSubmit: true, canRequestAssistance: false, canTeachSeparateCase: false })
    const sealed = { ...lifecycle, phase: 'submitted_sealed' as const, submissionId: ref<'learnResponses'>('submission1'), acceptedAt }
    expect(resolveLearnAssessmentCapabilities({ ...input, lifecycle: sealed, enabled: true })).toMatchObject({ canSubmit: false, canTeachSeparateCase: true, canReadFeedback: false })
  })
  it('cannot reopen a sealed or abandoned response or redispatch an ambiguous execution', () => {
    expect(canTransitionLearnAssessment('test_open', 'submitted_sealed')).toBe(true)
    expect(canTransitionLearnAssessment('submitted_sealed', 'test_open')).toBe(false)
    expect(canTransitionLearnAssessment('abandoned', 'ready')).toBe(false)
    expect(canTransitionLearnAssessment('reconciliation_required', 'scoring_pending')).toBe(false)
    expect(() => learnAssessmentLifecycleSchema.parse({ ...lifecycle, phase: 'scoring_pending' })).toThrow()
    expect(() => learnAssessmentClockSchema.parse({ ...clock, closeAt: clock.openAt })).toThrow()
  })
})

describe('purpose-specific public disclosure', () => {
  it('emits only the exact granted prompt and omits every private addition', () => {
    const privateInput = { ...delivered, answerKey: 'KEY_CANARY', privateRubric: 'RUBRIC_CANARY', siblingForm: 'FORM_CANARY',
      workedExample: 'TEACHING_CANARY', providerResponse: 'PROVIDER_CANARY', sourceLocator: 'LOCATOR_CANARY' }
    const result = projectDeliveredAssessment(privateInput, disclosure)
    expect(result.status).toBe('delivered')
    expect(JSON.stringify(result)).not.toContain('CANARY')
    expect(() => parseLearnContract(learnDeliveredAssessmentSchema, { ...result, answerKey: 'private' })).toThrow()
    expect(projectDeliveredAssessment(privateInput, { ...disclosure, grant: null })).toMatchObject({ status: 'unavailable', reasonCode: 'not_delivered' })
    expect(projectDeliveredAssessment(privateInput, { ...disclosure, evidenceAvailable: false })).toMatchObject({ status: 'unavailable', reasonCode: 'evidence_unavailable' })
    expect(projectDeliveredAssessment({ ...delivered, identity: { ...identity, itemRevision: 2 } }, disclosure).status).toBe('unavailable')
  })
  it('constructs objective summaries without forwarding raw assessment contracts', () => {
    const result = projectObjectiveSummary({ objectiveId: 'objective1', title: 'Capability', capability: 'Apply a rule', depth: 'working', revision: 1, assessmentContract: 'RUBRIC_CANARY' })
    expect(JSON.stringify(result)).not.toContain('CANARY')
  })
  it('preserves own work before scoring, independently of a prompt grant', () => {
    const exported = projectOwnerExport({ work: { ...work, scoringPayload: 'PRIVATE_CANARY' }, assessment: delivered,
      context: { ...disclosure, grant: null }, bodyDisclosureAllowed: true, resultDisclosureAllowed: false })
    expect(exported.work.body).toEqual(work.body)
    expect(exported.work.result).toBeNull()
    expect(exported.assessment.status).toBe('unavailable')
    expect(JSON.stringify(exported)).not.toContain('CANARY')
    expect(() => learnOwnerAssessmentExportSchema.parse({ ...exported, privateRubric: 'private' })).toThrow()
    expect(() => learnAttemptHistorySchema.parse({ ...exported.work, responseFingerprint: 'raw answer' })).toThrow()
  })
  it('exports a purged body as unavailable without reconstructing it', () => {
    const exported = projectOwnerExport({ work: { ...work, body: { bodyAvailability: 'purged', reasonCode: 'evidence_unavailable', purgedAt: acceptedAt } },
      assessment: delivered, context: { ...disclosure, evidenceAvailable: false }, bodyDisclosureAllowed: false, resultDisclosureAllowed: false })
    expect(exported.work.body.bodyAvailability).toBe('purged')
    expect(JSON.stringify(exported)).not.toContain('independently written')
  })
  it('withholds a body immediately on evidence loss while bounded purge is still pending', () => {
    const exported = projectOwnerExport({ work, assessment: delivered, context: { ...disclosure, evidenceAvailable: false },
      bodyDisclosureAllowed: true, resultDisclosureAllowed: false })
    expect(exported.work.body).toEqual({ bodyAvailability: 'unavailable', reasonCode: 'evidence_unavailable' })
    expect(exported.work.acceptedAt).toBe(acceptedAt)
    expect(JSON.stringify(exported)).not.toContain('independently written')
  })
  it('fails closed for context-free help and always withholds reserved solutions', () => {
    expect(canDiscloseLearnHelp({ owned: true, relevantOpenCheck: 'unknown', sealed: false, reservedCase: 'no', reasonCodes: [] })).toBe(false)
    expect(canDiscloseLearnHelp({ owned: true, relevantOpenCheck: 'yes', sealed: true, reservedCase: 'yes', reasonCodes: [] })).toBe(false)
    expect(canDiscloseLearnHelp({ owned: true, relevantOpenCheck: 'yes', sealed: true, reservedCase: 'no', reasonCodes: [] })).toBe(true)
  })
  it('accepts a test envelope without teaching blocks and retains the legacy path', () => {
    const candidate = { version: LEARN_V2_PURPOSE_SESSION_CONTENT_VERSION, purpose, assessmentOpportunityId: lifecycle.assessmentOpportunityId,
      generatorVersion: 'generator.v1', itemPins: pins(), inputDigest: digest }
    expect(validateLearnV2SessionContentCandidate(candidate, ['source1'], 'measurement_delayed')).toEqual(candidate)
    for (const field of ['blocks', 'claims', 'assessmentRubric', 'answerKey']) {
      expect(() => validateLearnV2SessionContentCandidate({ ...candidate, [field]: 'PRIVATE_CANARY' }, ['source1'], 'measurement_delayed')).toThrow()
    }
    expect(() => validateLearnV2SessionContentCandidate(candidate, ['source1'])).toThrow()
    expect(() => validateLearnV2SessionContentCandidate(candidate, [], 'measurement_delayed')).toThrow()
  })
})

describe('canonical measurement event v2', () => {
  const event = { taxonomyVersion: LEARN_MEASUREMENT_EVENT_TAXONOMY_VERSION, eventType: 'delayed_check_eligible', eventVersion: 'delayed_check_eligible.v2',
    sourceVersion: 'eligibility.v1', contractVersion: LEARN_V2_DELAYED_CHECK_VERSION, occurredAt: acceptedAt,
    learningVoidId: 'void1', blueprintRevisionId: 'blueprint1', objectiveId: 'objective1', assessmentOpportunityId: 'opportunity1', horizonDays: 7,
    measurementEligible: true, masteryEligible: false, semanticKey: 'opportunity:opportunity1:eligible', metadata: {} }
  it('works without a fabricated adaptive thread and deduplicates both representative outcomes together', () => {
    expect(validateLearnMeasurementEventInput(event)).not.toHaveProperty('threadId')
    expect(learnMeasurementEventSemanticKey({ eventType: 'representative_pass', assessmentOpportunityId: 'opportunity1', attemptId: 'attempt1' }))
      .toBe(learnMeasurementEventSemanticKey({ eventType: 'representative_fail', assessmentOpportunityId: 'opportunity1', attemptId: 'attempt1' }))
  })
  it('separates eligibility from accepted submission and requires event/version pairing', () => {
    expect(() => validateLearnMeasurementEventInput({ ...event, submissionId: 'submission1' })).toThrow()
    expect(() => validateLearnMeasurementEventInput({ ...event, eventVersion: 'delayed_check_eligible.v1' })).toThrow()
    expect(() => validateLearnMeasurementEventInput({ ...event, metadata: { rawAnswer: 'private' } })).toThrow()
    expect(() => validateLearnMeasurementEventInput({ ...event, semanticKey: 'thread:other:eligible' })).toThrow()
    expect(validateLearnMeasurementEventInput({ ...event, eventType: 'delayed_check_attempt', eventVersion: 'delayed_check_attempt.v2',
      submissionId: 'submission1', semanticKey: 'submission:submission1:delayed_attempt', measurementEligible: false })).toMatchObject({ submissionId: 'submission1' })
  })
  it('excludes cold, pending and contaminated results and emits retained only on a transition', () => {
    const basis = { kind: 'measurement_delayed' as const, gradingStatus: 'scored' as const, scorePercent: 80,
      assistanceSnapshot: assistance, validitySnapshot: { ...validity, masteryEligible: true },
      masteryStateBefore: 'independent' as const, masteryStateAfter: 'retained' as const }
    expect(canEmitLearnMeasurementOutcomeEvent('representative_pass', basis)).toBe(true)
    expect(canEmitLearnMeasurementOutcomeEvent('retained', basis)).toBe(true)
    expect(canEmitLearnMeasurementOutcomeEvent('retained', { ...basis, masteryStateBefore: 'retained' })).toBe(false)
    expect(canEmitLearnMeasurementOutcomeEvent('representative_pass', { ...basis, kind: 'measurement_cold' })).toBe(false)
    expect(canEmitLearnMeasurementOutcomeEvent('representative_pass', { ...basis, gradingStatus: 'pending' })).toBe(false)
    expect(canEmitLearnMeasurementOutcomeEvent('representative_pass', { ...basis, assistanceSnapshot: { ...assistance, state: 'assisted', substantiveHintUsedAt: acceptedAt } })).toBe(false)
    expect(canEmitLearnMeasurementOutcomeEvent('representative_pass', { ...basis, kind: 'independent_application',
      assistanceSnapshot: { ...assistance, state: 'assisted', substantiveHintUsedAt: acceptedAt },
      validitySnapshot: { ...validity, measurementEligible: false } })).toBe(true)
  })
})

describe('report source and aggregate boundaries', () => {
  const query = { version: LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, cohortVersion: 'cohort.v1', epoch: 'epoch.v1', protocolVersion: 'protocol.v1',
    enrollmentStartAt: 0, enrollmentEndAt: 86_400_000, cutoff: acceptedAt }
  const counts = { considered: 0, notAdmitted: 0, horizonNotAssigned: 0, anchorNotStarted: 0, notYetDue: 0, windowOpen: 0,
    maturedEpisodes: 0, operationallyEligible: 0, acceptedSubmissions: 0, validDelayedScores: 0, validColdScores: 0, comparablePairs: 0,
    maturedClaims: 0, checkedClaims: 0, failedClaims: 0,
    distinctLearners: { maturedEpisodes: 0, operationallyEligible: 0, acceptedSubmissions: 0, validDelayedScores: 0, validColdScores: 0,
      comparablePairs: 0, maturedClaims: 0, checkedClaims: 0, failedClaims: 0 } }
  const metric = { metric: 'verified_learning_gain.v1', horizonDays: 7, weighting: 'capability_episode',
    stratum: { flow: 'v2_today', entryPoint: 'today.v1', depth: 'working', startingBand: 'unknown', scoringKind: 'deterministic',
      configurationDigest: digest, observedModel: null, observedUpstream: null, familyValidationStatus: 'provisional_equivalent' },
    status: 'no_eligible_population', populationState: 'known', sourceCoverage: 'complete', outcomeCoverage: 'none', validity: 'provisional',
    precision: 'insufficient_clusters', counts, observedValue: null, allEligibleValue: null, missingOutcomeBounds: null, confidenceInterval: null,
    reasonCodes: ['no_eligible_population', 'insufficient_clusters'] }
  it('rejects individual filters and oversized enrollment ranges', () => {
    expect(learnReportQuerySchema.parse(query)).toEqual(query)
    expect(() => learnReportQuerySchema.parse({ ...query, learnerId: 'foreign' })).toThrow()
    expect(() => learnReportQuerySchema.parse({ ...query, enrollmentEndAt: 91 * 86_400_000 })).toThrow()
  })
  it('returns null/reasons for absent observations and preserves negative observed VLG', () => {
    expect(learnReportMetricSchema.parse(metric).observedValue).toBeNull()
    expect(() => learnReportMetricSchema.parse({ ...metric, observedValue: 0 })).toThrow()
    expect(() => learnReportMetricSchema.parse({ ...metric, reasonCodes: [] })).toThrow()
    const observedCounts = { ...counts, maturedEpisodes: 2, operationallyEligible: 2, acceptedSubmissions: 1, validDelayedScores: 1, validColdScores: 2, comparablePairs: 1,
      distinctLearners: { ...counts.distinctLearners, maturedEpisodes: 2, operationallyEligible: 2, acceptedSubmissions: 1, validDelayedScores: 1, validColdScores: 2, comparablePairs: 1 } }
    const partial = { ...metric, counts: observedCounts, observedValue: -20, status: 'partial_observed', outcomeCoverage: 'partial',
      missingOutcomeBounds: { lower: -60, upper: 40 }, reasonCodes: ['missing_delayed', 'insufficient_clusters'] }
    expect(learnReportMetricSchema.parse(partial).observedValue).toBe(-20)
    expect(() => learnReportMetricSchema.parse({ ...partial, allEligibleValue: -10 })).toThrow()
    expect(() => learnReportMetricSchema.parse({ ...partial, confidenceInterval: { lower: -21, upper: -19 } })).toThrow()
  })
  it('bounds source pages without truncating or copying answer/item/scoring payloads', () => {
    const row = { kind: 'owner_watermark', sequence: 1, dueWorkThrough: null, historyCoverage: 'unknown' }
    const page = { version: LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, reportRunId: 'run1', sequence: 0, sourceWatermark: 1,
      rows: [row], cursor: null, isDone: true }
    expect(validateLearnReportSourcePage(page).rows).toHaveLength(1)
    expect(() => validateLearnReportSourcePage({ ...page, rows: Array.from({ length: 9 }, () => row) })).toThrow()
    expect(() => validateLearnReportSourcePage({ ...page, rows: [{ ...row, response: 'PRIVATE_CANARY' }] })).toThrow()
    expect(() => validateLearnReportSourcePage({ ...page, extra: 'x'.repeat(256 * 1024) })).toThrow()
    expect(() => validateLearnReportSourcePage({ ...page, isDone: false })).toThrow()
  })
  it('keeps aggregate provenance free of source-owner rosters or individual rows', () => {
    expect(learnMeasurementReportSchema.parse({ version: LEARN_V2_MEASUREMENT_REPORT_VERSION, status: 'disabled', reasonCodes: ['disabled'] })).toMatchObject({ status: 'disabled' })
    const provenance = { kind: 'aggregate_snapshot', sourceVersion: LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION,
      queryVersion: LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, adapterVersion: 'adapter.v1', codeVersion: 'code.v1',
      rosterDigest: digest, inputDigest: digest, cutoff: acceptedAt, extractionStartedAt: acceptedAt, extractionEndedAt: acceptedAt,
      sourceCoverage: 'complete', episodeCount: 10, inputBytes: 1000, bootstrapSeed: digest, bootstrapReplicates: 10000 }
    expect(learnReportProvenanceSchema.parse(provenance)).toEqual(provenance)
    expect(() => learnReportProvenanceSchema.parse({ ...provenance, ownerWatermarks: [{ userId: 'foreign', sequence: 1 }] })).toThrow()
    expect(() => learnReportProvenanceSchema.parse({ ...provenance, inputBytes: 64 * 1024 * 1024 + 1 })).toThrow()
  })
})

it('compiles every persisted contract against C1.1 without widening storage', () => {
  type V2Response = Extract<Doc<'learnResponses'>, { scopeKind: 'v2', assessmentOpportunityId: unknown }>
  expectTypeOf<z.infer<typeof learnMeasurementItemPinsSchema>>().toMatchTypeOf<Extract<V2Response['assessmentPins'], { kind: 'measurement' }>['itemPins']>()
  expectTypeOf<z.infer<typeof learnAssistanceSnapshotSchema>>().toMatchTypeOf<V2Response['assistanceSnapshot']>()
  expectTypeOf<z.infer<typeof learnValiditySnapshotSchema>>().toMatchTypeOf<V2Response['validitySnapshot']>()
  expectTypeOf<z.infer<typeof learnV2ScopeSchema>>().toMatchTypeOf<Pick<V2Response, keyof z.infer<typeof learnV2ScopeSchema>>>()
  expectTypeOf<z.infer<typeof learnStandaloneScopeSchema>>().toMatchTypeOf<Pick<Extract<Doc<'learnResponses'>, { scopeKind: 'standalone' }>, keyof z.infer<typeof learnStandaloneScopeSchema>>>()
  expectTypeOf<z.infer<typeof learnResponsePayloadSchema>>().toMatchTypeOf<Doc<'learnResponseBodies'>['payload']>()
  expectTypeOf<z.infer<typeof learnResponseDependencySchema>>().toMatchTypeOf<Doc<'learnResponseEvidenceLinks'>['dependency']>()
  expectTypeOf<z.infer<typeof learnAssessmentPurposeSchema>>().toMatchTypeOf<Doc<'learnAssessmentOpportunities'>['purpose']>()
  expectTypeOf<z.infer<typeof learnMeasurementAllocationSchema>>().toMatchTypeOf<Extract<Doc<'learnMeasurementAssignments'>, { status: 'admitted' }>['allocation']>()
  expectTypeOf<z.infer<typeof learnScoringExecutionReceiptSchema>>().toMatchTypeOf<Pick<Doc<'learnScoringExecutions'>, keyof z.infer<typeof learnScoringExecutionReceiptSchema>>>()
  expectTypeOf<z.infer<typeof learnReportAssignmentSnapshotSchema>>().toMatchTypeOf<Extract<Doc<'learnMeasurementReportFacts'>['fact'], { kind: 'enrollment' }>['snapshot']>()
  expectTypeOf<z.infer<typeof learnReportResultSnapshotSchema>>().toMatchTypeOf<Extract<Doc<'learnMeasurementReportFacts'>['fact'], { kind: 'score' }>['snapshot']>()
  expectTypeOf<z.infer<typeof learnReportFactPayloadSchema>>().toMatchTypeOf<Doc<'learnMeasurementReportFacts'>['fact']>()
  expectTypeOf<z.infer<typeof learnReportFactSchema>>().toMatchTypeOf<Pick<Doc<'learnMeasurementReportFacts'>, keyof z.infer<typeof learnReportFactSchema>>>()
  expectTypeOf<z.infer<typeof learnReportInputSnapshotSchema>>().toMatchTypeOf<Doc<'learnMeasurementReportRows'>['snapshot']>()
  expectTypeOf<z.infer<typeof learnPrivateScoringPayloadSchema>>().toMatchTypeOf<NonNullable<Doc<'learnMeasurementScoringSpecs'>['payload']>>()
  expectTypeOf<z.infer<typeof learnMeasurementPublicationCandidateSchema>['claims'][number]['supports'][number]>()
    .toMatchTypeOf<Pick<Doc<'learnMeasurementSupports'>, keyof z.infer<typeof learnMeasurementPublicationCandidateSchema>['claims'][number]['supports'][number]>>()
})
