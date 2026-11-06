/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION, LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION } from '../shared/learn-v2-responses'
import { seedMeasurementStorage } from '../tests/fixtures/learn-v2-measurement-storage'

const policy = vi.hoisted(() => ({ responses: true }))
vi.mock('../shared/learn-v2-measurement-storage-manifest', async importOriginal => {
  const original = await importOriginal<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...original, LEARN_MEASUREMENT_CAPABILITIES: { ...original.LEARN_MEASUREMENT_CAPABILITIES,
    get responses() { return policy.responses } } }
})

const OWNER = { tokenIdentifier: 'https://owner.example|response-owner', subject: 'response-owner' }
const FOREIGN = { tokenIdentifier: 'https://foreign.example|response-owner', subject: 'response-owner' }
const NOW = 1_800_000_000_001
const HASH = `sha256:${'a'.repeat(64)}`
const KEY = 'response_command_1234567890'
const modules = import.meta.glob('./**/*.ts')
beforeEach(() => {
  policy.responses = true
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

async function hash(value: unknown) {
  const canonical = (input: unknown): string => {
    if (Array.isArray(input)) return `[${input.map(canonical).join(',')}]`
    if (input && typeof input === 'object') {
      const row = input as Record<string, unknown>
      return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`
    }
    return JSON.stringify(input)
  }
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value))))
  return `sha256:${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

async function fixture(kind: 'ordinary' | 'measurement' = 'ordinary') {
  const t = convexTest(schema, modules)
  for (const identity of [OWNER, FOREIGN]) {
    await t.withIdentity(identity).mutation(api.users.upsertUser, {})
    await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
    await t.withIdentity(identity).mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  }
  const f = await t.run(ctx => seedMeasurementStorage(ctx, OWNER.tokenIdentifier))
  const contract = { version: 'learn-v2.assessment.v1' as const, kind: 'bounded_rubric' as const, responseFormat: 'short_text' as const,
    instructions: 'Apply the rule.', passingScorePercent: 80 as const, criteria: [{ key: 'correct', description: 'Correct application', weightPercent: 100 }] }
  const rubric = { version: 'rubric.v1', criteria: contract.criteria }
  const prompt = 'Apply the rule to a new case.'
  const capability = { learningVoidId: f.learningVoidId, blueprintRevisionId: f.scope.blueprintRevisionId, objectiveId: f.scope.objectiveId,
    blueprintRecordRevision: 1, assessmentContractVersion: contract.version, assessmentContractDigest: await hash(contract), depth: 'working' as const }
  const context = { ...f.scope.contextPins, contentInputDigest: HASH }
  const scoringBinding = { ...f.scoringBinding, configurationDigest: HASH }
  await t.run(async ctx => {
    for (const table of ['learnResponses', 'learnResponseBodies', 'learnResponseEvidenceLinks', 'learnResponseIntegrityEvents', 'learnResponseCommandReceipts', 'learnScoringExecutions', 'learnMeasurementReportFacts', 'learnMeasurementSourceWatermarks'] as const) {
      for (const row of await ctx.db.query(table).take(8)) await ctx.db.delete(row._id)
    }
    await ctx.db.patch(f.documentId, { status: 'success' })
    await ctx.db.patch(f.learningVoidId, { activeBlueprintRevisionId: capability.blueprintRevisionId })
    await ctx.db.patch(capability.blueprintRevisionId, { status: 'accepted' })
    await ctx.db.patch(capability.objectiveId, { depth: 'working', assessmentContract: contract })
    await ctx.db.patch(context.studyPlanId, { activeRevisionId: context.studyPlanRevisionId })
    await ctx.db.patch(context.studyPlanRevisionId, { status: 'accepted', blueprintRevisionId: capability.blueprintRevisionId, blueprintRecordRevision: 1 })
    await ctx.db.patch(context.studySessionId, { status: 'in_progress', startedSessionContentId: context.sessionContentId, startedSessionContentRevision: 1, assistanceRevision: 0 })
    await ctx.db.patch(context.sessionContentId, { blueprintRevisionId: capability.blueprintRevisionId, objectiveId: capability.objectiveId,
      studyPlanRevisionId: context.studyPlanRevisionId, inputDigest: HASH, generatorVersion: context.generatorVersion, assessmentRubricSnapshot: JSON.stringify(rubric) })
    await ctx.db.insert('sessionContentBlocks', { userId: OWNER.tokenIdentifier, sessionContentId: context.sessionContentId, order: 0, kind: 'transfer_challenge', content: prompt })
    const claim = await ctx.db.insert('sessionContentClaims', { userId: OWNER.tokenIdentifier, sessionContentId: context.sessionContentId, order: 0, claim: 'A verified rule' })
    await ctx.db.insert('learnClaimSupports', { userId: OWNER.tokenIdentifier, sessionContentClaimId: claim, sourceExcerptId: f.sourceExcerptId,
      sourceSnapshotId: f.sourceSnapshotId, entailment: 'entailed', conflictStatus: 'clear', evidenceStatus: 'evidence_available', verifierVersion: 'verifier.v1', confidence: 0.99 })
    const exposureId = await ctx.db.insert('learnAssessmentExposures', { ...f.base, learningVoidId: f.learningVoidId, blueprintRevisionId: capability.blueprintRevisionId,
      objectiveId: capability.objectiveId, studySessionId: context.studySessionId, purpose: 'practice', status: 'granted', projectionDigest: HASH,
      deliveryReceiptHash: HASH, serverTime: NOW - 1, policyVersion: 'delivery.v1', provenanceVersion: 'delivery.v1' })
    await ctx.db.patch(f.rows.learnResponseSlots, { ...capability, contextPins: context, confidenceRequested: false, promptDigest: HASH,
      deliveryExposureId: exposureId, status: 'open', revision: 1 })
    const opportunity = (await ctx.db.get(f.rows.learnAssessmentOpportunities))!
    if (kind === 'ordinary') {
      const caseId = await ctx.db.insert('learnAssessmentCases', { ...f.base, caseKey: 'ordinary-case', scenarioFingerprint: HASH,
        solutionFingerprint: HASH, identityPolicyVersion: 'identity.v1', usageClass: 'unknown' })
      const assessmentPins = { kind: 'session_application' as const, caseId, promptDigest: await hash(prompt), rubricVersion: 'rubric.v1', rubricDigest: await hash(rubric), supportManifestDigest: HASH }
      await ctx.db.patch(opportunity._id, { ...capability, contextPins: context, purpose: { kind: 'independent_application' }, assessmentPins, scoringBinding,
        assignmentId: undefined, phase: 'test_open', submissionId: undefined, revision: 1, openAt: NOW - 1000, closeAt: NOW + 100000,
        deliveryPins: { version: LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION, confidenceRequested: true } })
      await ctx.db.patch(f.rows.learnAssessmentExposures, { caseId, itemId: undefined, itemRevision: undefined, familyId: undefined, formLabel: undefined,
        assignmentId: undefined, purpose: 'practice', projectionDigest: assessmentPins.promptDigest })
    } else {
      await ctx.db.delete(exposureId)
      const assignment = (await ctx.db.get(f.rows.learnMeasurementAssignments))!
      if (assignment.status !== 'admitted') throw new Error('Missing admitted fixture')
      const allocation = { ...assignment.allocation }
      if (allocation.kind !== 'three_case') throw new Error('Missing full allocation')
      for (const key of ['cold', 'day7', 'day30'] as const) {
        allocation[key] = { ...allocation[key], promptDigest: HASH, scoringSpecDigest: HASH, supportManifestDigest: HASH }
        await ctx.db.patch(allocation[key].itemId, { ...capability, promptDigest: HASH, scoringSpecDigest: HASH, supportManifestDigest: HASH })
        await ctx.db.patch(allocation[key].scoringSpecId, { ...capability, digest: HASH, scoringBinding })
      }
      await ctx.db.patch(f.rows.learnMeasurementFamilies, { ...capability })
      await ctx.db.patch(f.rows.learnMeasurementValidations, { ...capability })
      await ctx.db.patch(f.rows.learnMeasurementSupports, { ...capability })
      await ctx.db.patch(f.rows.learnMeasurementAssignments, { ...capability, baselineSha: 'a'.repeat(40), allocation, scoringBinding })
      const planned = { kind: 'planned_measurement' as const, studyPlanId: context.studyPlanId, studyPlanRevisionId: context.studyPlanRevisionId,
        planRevision: 1, planRecordRevision: 1 }
      await ctx.db.patch(opportunity._id, { ...capability, contextPins: planned, assessmentPins: { kind: 'measurement', itemPins: allocation.cold },
        scoringBinding, phase: 'test_open', submissionId: undefined, revision: 1, openAt: NOW - 1000, closeAt: NOW + 100000,
        deliveryPins: { version: LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION, confidenceRequested: false } })
      await ctx.db.patch(f.rows.learnAssessmentExposures, { projectionDigest: HASH })
    }
  })
  const owner = t.withIdentity(OWNER)
  const target = { responseSlotId: f.rows.learnResponseSlots }
  const assessmentTarget = { assessmentOpportunityId: f.rows.learnAssessmentOpportunities }
  const response = { target, expectedRevision: 1, payload: { kind: 'text' as const, text: '  My answer 私🙂  ' } }
  const request = { version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: KEY, response }
  const submission = { ...request, response: { ...response, target: assessmentTarget, ...(kind === 'ordinary' ? { confidence: 3 } : {}) } }
  return { t, f, owner, target, assessmentTarget, request, submission, response, capability, context }
}

test.each([
  ['granted', 'teaching', 'assisted'], ['acknowledged', 'practice', 'assisted'], ['known', 'feedback', 'assisted'],
  ['possible', 'teaching', 'unknown'], ['unknown', 'feedback', 'unknown'], ['unknown', 'imported', 'unknown'],
  ['possible', 'calibration', 'unknown'], ['requested_denied', 'teaching', 'unassisted'],
  ['requested_denied', 'assistance_requested_denied', 'unassisted'],
] as const)('acceptance classifies %s %s as %s', async (status, purpose, state) => {
  const { t, f, owner, submission } = await fixture()
  await t.run(ctx => ctx.db.insert('learnAssessmentExposures', {
    ...f.base, createdAt: NOW, learningVoidId: f.learningVoidId,
    assessmentOpportunityId: f.rows.learnAssessmentOpportunities, purpose, status,
    projectionDigest: HASH, deliveryReceiptHash: 'export-exposure', serverTime: NOW,
    policyVersion: 'learn-v2.personal-export.v1', provenanceVersion: 'export.v1',
  }))
  const result = await owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission })
  expect(result.kind).toBe('accepted')
  if (result.kind !== 'accepted') throw new Error('Expected acceptance')
  const response = await t.run(ctx => ctx.db.get(result.submissionId))
  expect(response?.assistanceSnapshot.state).toBe(state)
  if (state !== 'unassisted') expect(response?.validitySnapshot.measurementEligible).toBe(false)
  const snapshot = response?.assistanceSnapshot
  await t.run(ctx => ctx.db.insert('learnAssessmentExposures', {
    ...f.base, assessmentOpportunityId: f.rows.learnAssessmentOpportunities, purpose: 'teaching', status: 'known',
    projectionDigest: HASH, deliveryReceiptHash: 'post-seal-help', serverTime: NOW + 1,
    policyVersion: 'help.v1', provenanceVersion: 'help.v1',
  }))
  expect((await t.run(ctx => ctx.db.get(result.submissionId)))?.assistanceSnapshot).toEqual(snapshot)
})

test.each(['known_history', 'missing_history', 'hint', 'reveal'] as const)('acceptance keeps %s semantics and ignores its own grant', async control => {
  const { t, f, owner, submission, context } = await fixture()
  await t.run(async ctx => {
    await ctx.db.patch(f.rows.learnAssessmentExposures, { status: 'unknown', purpose: 'teaching' })
    if (control === 'missing_history') await ctx.db.patch(context.studySessionId, { assistanceRevision: undefined })
    if (control === 'hint') await ctx.db.patch(context.studySessionId, { substantiveHintUsedAt: NOW - 1 })
    if (control === 'reveal') await ctx.db.patch(context.studySessionId, { answerRevealedAt: NOW - 1 })
  })
  // Delivery itself requires a valid grant; changing its purpose to teaching
  // does not make the current prompt assistance.
  await t.run(ctx => ctx.db.patch(f.rows.learnAssessmentExposures, { status: 'granted' }))
  const result = await owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission })
  expect(result.kind).toBe('accepted')
  if (result.kind !== 'accepted') throw new Error('Expected acceptance')
  expect((await t.run(ctx => ctx.db.get(result.submissionId)))?.assistanceSnapshot.state)
    .toBe(control === 'known_history' ? 'unassisted' : control === 'missing_history' ? 'unknown' : 'assisted')
})
