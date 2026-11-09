/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION, LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION } from '../shared/learn-v2-responses'
import { seedMeasurementStorage } from '../tests/fixtures/learn-v2-measurement-storage'
import { LEARN_V2_PUBLIC_API_VERSION } from './lib/learnV2PublicContract'
import { authorizeExport } from '../tests/fixtures/learn-v2-personal-export'

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

async function fixture(kind: 'ordinary' | 'measurement' | 'calibration' = 'ordinary') {
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
    if (kind !== 'measurement') {
      const caseId = await ctx.db.insert('learnAssessmentCases', { ...f.base, caseKey: 'ordinary-case', scenarioFingerprint: HASH,
        solutionFingerprint: HASH, identityPolicyVersion: 'identity.v1', usageClass: 'unknown' })
      const assessmentPins = kind === 'ordinary'
        ? { kind: 'session_application' as const, caseId, promptDigest: await hash(prompt), rubricVersion: 'rubric.v1', rubricDigest: await hash(rubric), supportManifestDigest: HASH }
        : { kind: 'calibration' as const, caseId, promptDigest: await hash(prompt), assessmentContractVersion: capability.assessmentContractVersion,
            assessmentContractDigest: capability.assessmentContractDigest, supportManifestDigest: HASH }
      await ctx.db.patch(opportunity._id, { ...capability, contextPins: kind === 'ordinary' ? context : { kind: 'calibration', origin: 'today' },
        purpose: { kind: kind === 'ordinary' ? 'independent_application' : 'calibration' }, assessmentPins, scoringBinding,
        assignmentId: undefined, phase: 'test_open', submissionId: undefined, revision: 1, openAt: NOW - 1000, closeAt: NOW + 100000,
        deliveryPins: { version: LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION, confidenceRequested: true } })
      await ctx.db.patch(f.rows.learnAssessmentExposures, { caseId, itemId: undefined, itemRevision: undefined, familyId: undefined, formLabel: undefined,
        assignmentId: undefined, purpose: 'practice', projectionDigest: assessmentPins.promptDigest })
      if (kind === 'calibration') await ctx.db.insert('learnObjectiveSources', { userId: OWNER.tokenIdentifier,
        objectiveId: capability.objectiveId, sourceSnapshotId: f.sourceSnapshotId, coverage: 'strong' })
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
  const submission = { ...request, response: { ...response, target: assessmentTarget, ...(kind !== 'measurement' ? { confidence: 3 } : {}) } }
  return { t, f, owner, target, assessmentTarget, request, submission, response, capability, context }
}

const assistanceCases = [
  ['granted', 'teaching', 'assisted'], ['acknowledged', 'practice', 'assisted'], ['known', 'feedback', 'assisted'],
  ['possible', 'teaching', 'unknown'], ['unknown', 'feedback', 'unknown'], ['unknown', 'imported', 'unknown'],
  ['possible', 'calibration', 'unknown'], ['requested_denied', 'teaching', 'unassisted'],
  ['requested_denied', 'assistance_requested_denied', 'unassisted'],
] as const
test.each((['ordinary', 'measurement', 'calibration'] as const).flatMap(kind => assistanceCases.map(value => [kind, ...value] as const)))(
  'acceptance classifies %s %s %s as %s', async (kind, status, purpose, state) => {
  const { t, f, owner, submission } = await fixture(kind)
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

test.each(['ordinary', 'measurement', 'calibration'] as const)('confirmed help takes precedence over unresolved exposure for %s', async kind => {
  const { t, f, owner, submission } = await fixture(kind)
  await t.run(async ctx => {
    for (const [status, purpose] of [['unknown', 'imported'], ['known', 'feedback']] as const) {
      await ctx.db.insert('learnAssessmentExposures', { ...f.base, assessmentOpportunityId: f.rows.learnAssessmentOpportunities,
        status, purpose, projectionDigest: HASH, deliveryReceiptHash: `precedence-${status}`, serverTime: NOW,
        policyVersion: 'help.v1', provenanceVersion: 'help.v1' })
    }
  })
  const result = await owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission })
  expect(result.kind).toBe('accepted')
  if (result.kind !== 'accepted') throw new Error('Expected acceptance')
  expect((await t.run(ctx => ctx.db.get(result.submissionId)))?.assistanceSnapshot.state).toBe('assisted')
})

test.each((['ordinary', 'measurement', 'calibration'] as const).flatMap(kind => (['known_history', 'missing_history'] as const).map(control => [kind, control] as const)))(
  'acceptance keeps %s %s semantics and ignores its own delivery grant', async (kind, control) => {
  const { t, f, owner, submission, context } = await fixture(kind)
  await t.run(async ctx => {
    await ctx.db.patch(f.rows.learnAssessmentExposures, { status: 'known' })
    if (control === 'missing_history') {
      if (kind === 'ordinary') await ctx.db.patch(context.studySessionId, { assistanceRevision: undefined })
      else await ctx.db.patch(f.rows.learnAssessmentCatalogs, { historyCompleteness: 'unknown' })
    }
  })
  const result = await owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission })
  expect(result.kind).toBe('accepted')
  if (result.kind !== 'accepted') throw new Error('Expected acceptance')
  const response = await t.run(ctx => ctx.db.get(result.submissionId))
  expect(response?.assistanceSnapshot.state).toBe(control === 'known_history' ? 'unassisted' : 'unknown')
  if (kind === 'measurement') expect(response?.validitySnapshot.measurementEligible).toBe(control === 'known_history')
})

test('planned measurement stays unknown and excluded after a pre-seal personal export', async () => {
  const { t, f, owner, submission } = await fixture('measurement')
  await owner.mutation(api.dataExport.authorizePersonalExport, {})
  const exposure = await t.run(ctx => ctx.db.query('learnAssessmentExposures')
    .withIndex('by_userId_and_assessmentOpportunityId', q => q.eq('userId', OWNER.tokenIdentifier).eq('assessmentOpportunityId', f.rows.learnAssessmentOpportunities)).collect())
  expect(exposure.some(row => row.purpose === 'imported' && row.status === 'unknown')).toBe(true)
  const result = await owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission })
  expect(result.kind).toBe('accepted')
  if (result.kind !== 'accepted') throw new Error('Expected acceptance')
  expect(await t.run(ctx => ctx.db.get(result.submissionId))).toMatchObject({
    assistanceSnapshot: { state: 'unknown' }, validitySnapshot: { measurementEligible: false },
  })
})

test.each(['slot', 'assessment'] as const)('an archived Void rejects %s acceptance and terminalization', async kind => {
  const { t, f, owner, request, submission, target, assessmentTarget } = await fixture()
  const responseTarget = kind === 'slot' ? target : assessmentTarget
  expect(await owner.query(api.learnV2Responses.getResponseState, { version: LEARN_V2_PUBLIC_API_VERSION, target: responseTarget })).toMatchObject({ state: 'open' })
  await owner.mutation(api.learnV2Lifecycle.transitionLearningVoid, { learningVoidId: f.learningVoidId, status: 'archived', expectedRevision: 1, idempotencyKey: 'archive-response' })
  const before = await t.run(ctx => ctx.db.get(kind === 'slot' ? target.responseSlotId : assessmentTarget.assessmentOpportunityId))
  const result = kind === 'slot' ? await owner.mutation(api.learnV2Responses.acceptResponse, request)
    : await owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission })
  expect(result).toMatchObject({ kind: 'rejected', reasonCode: 'unavailable' })
  expect(await owner.mutation(api.learnV2Responses.terminalizeResponse, { version: LEARN_V2_PUBLIC_API_VERSION,
    target: responseTarget, expectedRevision: 1, idempotencyKey: KEY + '_terminal', reason: 'cancelled' })).toMatchObject({ status: 'unavailable', reasonCodes: ['unavailable'] })
  expect(await t.run(ctx => ctx.db.get(before!._id))).toEqual(before)
  expect(await t.run(ctx => ctx.db.query('learnResponses').collect())).toEqual([])
  expect(await t.run(ctx => ctx.db.query('learnResponseBodies').collect())).toEqual([])
})

test.each(['slot', 'assessment'] as const)('an archived Void keeps safe %s history while denying saved bodies and acceptance replay', async kind => {
  const { t, f, owner, request, submission, target, assessmentTarget } = await fixture()
  const accept = () => kind === 'slot' ? owner.mutation(api.learnV2Responses.acceptResponse, request)
    : owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission })
  const result = await accept()
  expect(result.kind).toBe('accepted')
  if (result.kind !== 'accepted') throw new Error('Expected acceptance')
  const query = { version: LEARN_V2_PUBLIC_API_VERSION, target: kind === 'slot' ? target : assessmentTarget }
  const live = await owner.query(api.learnV2Responses.getResponseState, query)
  expect(live).toMatchObject({ work: { body: { bodyAvailability: 'available', payload: request.response.payload } } })
  const response = await t.run(ctx => ctx.db.get(result.submissionId))
  await owner.mutation(api.learnV2Lifecycle.transitionLearningVoid, { learningVoidId: f.learningVoidId, status: 'archived', expectedRevision: 1, idempotencyKey: 'archive-saved-response' })
  const revoked = await owner.query(api.learnV2Responses.getResponseState, query)
  expect(revoked).toMatchObject({ state: 'accepted', work: { submissionId: result.submissionId, acceptedAt: NOW,
    assistanceSnapshot: response?.assistanceSnapshot, validitySnapshot: response?.validitySnapshot,
    body: { bodyAvailability: 'unavailable', reasonCode: 'evidence_unavailable' } } })
  expect(JSON.stringify(revoked)).not.toContain(request.response.payload.text)
  expect(await accept()).toMatchObject({ kind: 'rejected', reasonCode: 'unavailable' })
  // Archiving revokes access immediately; it does not rewrite acceptance facts.
  expect(await t.run(ctx => ctx.db.get(result.submissionId))).toEqual(response)
})

test('an archived Void denies terminalization replay without changing its receipt', async () => {
  const { t, f, owner, target } = await fixture()
  const request = { version: LEARN_V2_PUBLIC_API_VERSION, target, expectedRevision: 1, idempotencyKey: KEY + '_terminal', reason: 'cancelled' as const }
  expect(await owner.mutation(api.learnV2Responses.terminalizeResponse, request)).toMatchObject({ status: 'terminal' })
  const receipt = await t.run(ctx => ctx.db.query('learnResponseCommandReceipts').unique())
  await owner.mutation(api.learnV2Lifecycle.transitionLearningVoid, { learningVoidId: f.learningVoidId, status: 'archived', expectedRevision: 1, idempotencyKey: 'archive-terminal-response' })
  expect(await owner.mutation(api.learnV2Responses.terminalizeResponse, request)).toMatchObject({ status: 'unavailable', reasonCodes: ['unavailable'] })
  expect(await t.run(ctx => ctx.db.get(receipt!._id))).toEqual(receipt)
})

test.each(['before_acceptance', 'after_wrapper_deletion', 'replacement'] as const)('Canvas response freezes its direct document authority through %s', async revocation => {
  const { t, f, owner, context, submission, target, assessmentTarget } = await fixture()
  const documentId = await t.run(async ctx => {
    const activity = (await ctx.db.get(f.activityId))!
    const id = await ctx.db.insert('documents', { userId: OWNER.tokenIdentifier, folderId: f.folderId, filename: 'direct-scope.txt', fileSize: 1,
      status: 'success', sourceRevision: HASH, contentHash: 'a'.repeat(64) })
    const canvas = { threadId: f.threadId, threadRevision: 1, activityId: activity._id, activityRevision: activity.planRevision,
      planVersion: activity.planVersion, replayVersion: activity.replayVersion, rendererVersion: activity.rendererVersion,
      evaluationVersion: activity.evaluationContract.version, pilotConfigurationVersion: 'synthetic.v1' }
    await ctx.db.patch(f.threadId, { authorityKind: 'v2_mission', learningVoidId: f.learningVoidId, currentActivityId: activity._id, sourceScope: { kind: 'document', sourceId: String(id) } })
    await ctx.db.patch(activity._id, { sessionContentId: context.sessionContentId })
    for (const id of [target.responseSlotId, assessmentTarget.assessmentOpportunityId]) await ctx.db.patch(id, { contextPins: { ...context, canvas } })
    return id
  })
  const accept = () => owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission })
  if (revocation === 'before_acceptance') {
    await owner.mutation(api.documents.deleteDocument, { id: documentId })
    expect(await accept()).toMatchObject({ kind: 'rejected', reasonCode: 'evidence_unavailable' })
    return
  }
  const accepted = await accept()
  if (accepted.kind !== 'accepted') throw new Error('Expected acceptance')
  const links = await t.run(ctx => ctx.db.query('learnResponseEvidenceLinks').withIndex('by_userId_and_submissionId', q => q.eq('userId', OWNER.tokenIdentifier).eq('submissionId', accepted.submissionId)).take(8))
  expect(links).toEqual(expect.arrayContaining([expect.objectContaining({ dependency: { kind: 'document', documentId, sourceRevision: HASH } })]))
  const query = { version: LEARN_V2_PUBLIC_API_VERSION, target: assessmentTarget }
  expect(await owner.query(api.learnV2Responses.getResponseState, query)).toMatchObject({ work: { body: { bodyAvailability: 'available' } } })
  if (revocation === 'after_wrapper_deletion') {
    await owner.mutation(api.learnAdaptive.requestThreadDeletion, { threadId: f.threadId })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await t.run(ctx => ctx.db.get(f.threadId))).toBeNull()
    expect(await owner.query(api.learnV2Responses.getResponseState, query)).toMatchObject({ work: { body: { bodyAvailability: 'available' } } })
    await owner.mutation(api.documents.deleteDocument, { id: documentId })
  }
  else await t.mutation(internal.documents.updateDocumentStatus, { id: documentId, status: 'success', sourceRevision: 'direct.r2' })
  const revoked = await owner.query(api.learnV2Responses.getResponseState, query)
  expect(revoked).toMatchObject({ work: { submissionId: accepted.submissionId, body: { bodyAvailability: 'unavailable' } } })
  expect(JSON.stringify(revoked)).not.toContain(submission.response.payload.text)
  const authorizationId = await authorizeExport(owner)
  const page = await owner.query(api.dataExport.getUserDataPage, { authorizationId, collection: 'learnResponseBodies', paginationOpts: { cursor: null, numItems: 8 } })
  expect(page.page[0]).not.toHaveProperty('payload')
  if (revocation === 'after_wrapper_deletion') {
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect((await t.run(ctx => ctx.db.get(accepted.submissionId)))?.bodyAvailability).toBe('purged')
  }
})

test('deleting a Canvas thread preserves the Adaptive admission boundary for open work', async () => {
  const { t, f, owner, context, submission, target, assessmentTarget } = await fixture()
  const canvas = await t.run(async ctx => {
    const activity = (await ctx.db.get(f.activityId))!
    const pins = { threadId: f.threadId, threadRevision: 1, activityId: activity._id, activityRevision: activity.planRevision,
      planVersion: activity.planVersion, replayVersion: activity.replayVersion, rendererVersion: activity.rendererVersion,
      evaluationVersion: activity.evaluationContract.version, pilotConfigurationVersion: 'synthetic.v1' }
    await ctx.db.patch(f.threadId, { authorityKind: 'v2_mission', learningVoidId: f.learningVoidId, currentActivityId: activity._id })
    await ctx.db.patch(activity._id, { sessionContentId: context.sessionContentId })
    for (const id of [target.responseSlotId, assessmentTarget.assessmentOpportunityId]) await ctx.db.patch(id, { contextPins: { ...context, canvas: pins } })
    return pins
  })
  expect(await owner.query(api.learnV2Responses.getResponseState, { version: LEARN_V2_PUBLIC_API_VERSION, target: assessmentTarget })).toMatchObject({ state: 'open' })
  await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: false })
  const accept = () => owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission })
  await expect(accept()).rejects.toThrow('Learn access denied')
  await owner.mutation(api.learnAdaptive.requestThreadDeletion, { threadId: f.threadId })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await t.run(ctx => ctx.db.get(f.threadId))).toBeNull()
  await expect(accept()).rejects.toThrow('Learn access denied')
  for (const id of [target.responseSlotId, assessmentTarget.assessmentOpportunityId]) {
    expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ contextPins: { canvas } })
  }
  await expect(owner.mutation(api.learnV2Responses.acceptResponse, { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: KEY + '_slot', response: { target, expectedRevision: 1, payload: { kind: 'text', text: 'Open Canvas work' } } })).rejects.toThrow('Learn access denied')
  expect(await t.run(ctx => ctx.db.query('learnResponses').collect())).toEqual([])
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

test.each(['purge_first', 'accept_first', 'concurrent'] as const)('source purge versus acceptance and export: %s', async ordering => {
  const { t, f, owner, submission } = await fixture()
  const purge = () => t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: OWNER.tokenIdentifier, sourceIdentityId: f.sourceIdentityId })
  const accept = () => owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission })
  if (ordering === 'purge_first') { await purge(); expect((await accept()).kind).toBe('rejected') }
  else if (ordering === 'accept_first') { expect((await accept()).kind).toBe('accepted'); await purge() }
  else await Promise.all([accept(), purge()])
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await t.run(ctx => ctx.db.query('learnResponseBodies').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(8))).toEqual([])
  const replay = await accept()
  expect(['accepted', 'rejected']).toContain(replay.kind)
  expect(await t.run(ctx => ctx.db.query('learnResponseBodies').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(8))).toEqual([])
})

test.each(['export_first', 'accept_first', 'concurrent'] as const)('serializes personal export with acceptance: %s', async ordering => {
  const { t, f, owner, submission } = await fixture()
  const authorize = () => owner.mutation(api.dataExport.authorizePersonalExport, {})
  const accept = () => owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission })
  let expected: 'unassisted' | 'unknown' | null = null
  if (ordering === 'export_first') { await authorize(); await accept(); expected = 'unknown' }
  else if (ordering === 'accept_first') { await accept(); await authorize(); expected = 'unassisted' }
  else await Promise.all([accept(), authorize()])
  const response = await t.run(ctx => ctx.db.query('learnResponses').withIndex('by_userId_and_assessmentOpportunityId', q => q.eq('userId', OWNER.tokenIdentifier).eq('assessmentOpportunityId', f.rows.learnAssessmentOpportunities)).unique())
  expect(response).not.toBeNull()
  if (expected) expect(response?.assistanceSnapshot.state).toBe(expected)
  else expect(['unknown', 'unassisted']).toContain(response?.assistanceSnapshot.state)
  const snapshot = response?.assistanceSnapshot
  await authorize()
  expect((await t.run(ctx => ctx.db.get(response!._id)))?.assistanceSnapshot).toEqual(snapshot)
})
