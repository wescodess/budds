/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { v } from 'convex/values'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import schema from './schema'
import { mutation } from './_generated/server'
import { api, internal } from './_generated/api'
import { LEARN_V2_PUBLIC_API_VERSION } from './lib/learnV2PublicContract'
import { masteryScopeKey } from './lib/learnV2MasteryScope'
import { deterministicLearnScoringReceipt } from './lib/learnV2MeasurementScoring'
import { scorerDigest, scorerCanonicalJson } from '../server/utils/learn-v2-mastery-scorer'
import { createLearnScorerRegistry, sealLearnScorerConfiguration } from './lib/learnV2ScorerConfig'
import { requireAuth } from './lib/auth'
import { recordLearnResponseIntegrityForOwner } from './lib/learnV2Responses'
import { privacyDigest } from './lib/learnV2ResponsePrivacy'
import { freezeFirstIndependentClaimForOwner, recordLearnMeasurementInstructionForOwner, registerLearnFirstSlotForOwner, type EnrollmentRequest } from './lib/learnV2Measurement'
import { materializeLearnMeasurementDueBatch, replaceLearnMeasurementOpportunityForOwner } from './lib/learnV2MeasurementDueWork'
import { learnMeasurementProtocolSchema, measurementClock, type LearnMeasurementProtocol } from './lib/learnV2MeasurementAssignment'
import { LEARN_V2_FORM_ORDERS } from '../shared/learn-v2-measurement'
import { LEARN_V2_ASSISTANCE_POLICY_VERSION, LEARN_V2_VALIDITY_POLICY_VERSION, LEARN_V2_RESPONSE_CONTRACT_VERSION, LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION } from '../shared/learn-v2-responses'
import type { Id } from './_generated/dataModel'

const policy = vi.hoisted(() => ({ enrollment: true, scoring: false, protocol: null as unknown, scorer: null as unknown }))
vi.mock('../shared/learn-v2-measurement-storage-manifest', async original => {
  const value = await original<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...value, LEARN_MEASUREMENT_CAPABILITIES: { ...value.LEARN_MEASUREMENT_CAPABILITIES, responses: true, get scoring() { return policy.scoring }, get enrollment() { return policy.enrollment } } }
})
vi.mock('./lib/learnV2MeasurementAssignment', async original => {
  const value = await original<typeof import('./lib/learnV2MeasurementAssignment')>()
  return { ...value, getFrozenLearnMeasurementProtocol: () => policy.protocol }
})
vi.mock('./lib/learnV2MeasurementScorerInventory', () => ({ getLearnMeasurementScorer: async () => policy.scorer }))
const NOW = Date.parse('2027-03-07T15:00:00Z')
const OWNER = { tokenIdentifier: 'https://owner.example|prospect', subject: 'prospect' }
const HASH = `sha256:${'a'.repeat(64)}`
const modules = import.meta.glob('./**/*.ts')
const enroll = makeFunctionReference<'mutation', EnrollmentRequest, { status: string, assignmentId: Id<'learnMeasurementAssignments'> | null, reasonCodes: string[] }>('learnV2Measurement:enrollProspect')
const due = makeFunctionReference<'mutation', { userId: string, through?: number }, Awaited<ReturnType<typeof materializeLearnMeasurementDueBatch>>>('learnV2MeasurementDueWork:materializeDelayedCheckEligibility')
const claim = makeFunctionReference<'mutation', { assignmentId?: Id<'learnMeasurementAssignments'>, basisAttemptId: Id<'masteryAttempts'> }, Awaited<ReturnType<typeof freezeFirstIndependentClaimForOwner>>>('measurementFixture:claim')
const integrity = makeFunctionReference<'mutation', { submissionId: Id<'learnResponses'>, effectiveAt: number }, Id<'learnResponseIntegrityEvents'> | null>('measurementFixture:integrity')
const replace = makeFunctionReference<'mutation', Parameters<typeof replaceLearnMeasurementOpportunityForOwner>[2], Awaited<ReturnType<typeof replaceLearnMeasurementOpportunityForOwner>>>('measurementFixture:replace')
const instruction = makeFunctionReference<'mutation', Parameters<typeof recordLearnMeasurementInstructionForOwner>[2], Id<'learnAssessmentExposures'>>('measurementFixture:instruction')
const batch = makeFunctionReference<'mutation', { cursor: string | null, through: number, expectedSequence?: number, coverageComplete?: boolean }, Awaited<ReturnType<typeof materializeLearnMeasurementDueBatch>>>('measurementFixture:batch')

function syntheticProtocol(anchorKind: 'enrollment' | 'sealed_cold' = 'enrollment', horizons: Array<7 | 30> = [7, 30]): LearnMeasurementProtocol {
  return learnMeasurementProtocolSchema.parse({ version: 'synthetic.protocol.v1', epoch: 'synthetic.epoch.v1', baselineSha: 'b'.repeat(40),
    cohortVersion: 'synthetic.cohort.v1', schedulingPolicyVersion: 'synthetic.calendar.v1', enrollmentStartAt: NOW - 1000,
    enrollmentEndAt: NOW + 86_400_000, flows: ['v2_today'], anchorKind, coldWindowMs: 3_600_000, disambiguation: 'reject',
    replacementReasons: ['novel_item_unavailable', 'evidence_unavailable', 'contaminated', 'abandoned'],
    windows: horizons.map(horizonDays => ({ horizonDays, dueMinute: 0, openDayOffset: 0, openMinute: 0, closeDayOffset: 1, closeMinute: 0 })),
    scoringBinding: { kind: 'deterministic', engineVersion: 'synthetic.keyed.v1', thresholdVersion: 'threshold.v1', thresholdPercent: 80, transitionVersion: 'learn-v2.mastery-transition.v1' } })
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); vi.stubEnv('LEARN_V2_ENABLED', 'true'); policy.enrollment = true; policy.scoring = false; policy.scorer = null; policy.protocol = syntheticProtocol() })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

async function fixture(coreCount: 2 | 3 = 3, reserve = false) {
  const t = convexTest(schema, { ...modules, './measurementFixture.ts': async () => ({
    claim: mutation({ args: { assignmentId: v.optional(v.id('learnMeasurementAssignments')), basisAttemptId: v.id('masteryAttempts') },
      handler: async (ctx, args) => await freezeFirstIndependentClaimForOwner(ctx, await requireAuth(ctx), args) }),
    integrity: mutation({ args: { submissionId: v.id('learnResponses'), effectiveAt: v.number() }, handler: async (ctx, args) =>
      await recordLearnResponseIntegrityForOwner(ctx, await requireAuth(ctx), { ...args, kind: 'pre_seal_contamination', reasonCode: 'synthetic_contamination', policyVersion: LEARN_V2_VALIDITY_POLICY_VERSION }) }),
    replace: mutation({ args: { assessmentOpportunityId: v.id('learnAssessmentOpportunities'), reason: v.union(v.literal('novel_item_unavailable'), v.literal('evidence_unavailable'), v.literal('contaminated'), v.literal('abandoned')) },
      handler: async (ctx, args) => await replaceLearnMeasurementOpportunityForOwner(ctx, await requireAuth(ctx), args) }),
    instruction: mutation({ args: { assignmentId: v.id('learnMeasurementAssignments'), studySessionId: v.id('studySessions'), flow: v.union(v.literal('v2_today'), v.literal('v2_canvas')),
      projectionDigest: v.string(), deliveryReceiptHash: v.string() }, handler: async (ctx, args) => await recordLearnMeasurementInstructionForOwner(ctx, await requireAuth(ctx), args) }),
    batch: mutation({ args: { cursor: v.union(v.string(), v.null()), through: v.number(), expectedSequence: v.optional(v.number()), coverageComplete: v.optional(v.boolean()) },
      handler: async (ctx, args) => await materializeLearnMeasurementDueBatch(ctx, await requireAuth(ctx), args) }),
  }) })
  const f = await t.run(async ctx => {
    const userId = OWNER.tokenIdentifier
    const base = { userId, createdAt: NOW, storageVersion: 'learn-v2.measurement-storage.v1' as const }
    await ctx.db.insert('users', { tokenIdentifier: userId, name: 'Prospect', learnV2Entitlement: { enabled: true, updatedAt: NOW } })
    const folderId = await ctx.db.insert('folders', { userId, name: 'Sources', documentCount: 0 })
    const learningVoidId = await ctx.db.insert('learningVoids', { userId, folderId, title: 'Capability', status: 'active', revision: 1, createdAt: NOW, updatedAt: NOW })
    const blueprintId = await ctx.db.insert('learnBlueprints', { userId, learningVoidId, revision: 1, createdAt: NOW })
    const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { userId, learningVoidId, blueprintId, revision: 1, recordRevision: 1, status: 'accepted', acceptedAt: NOW - 1000, createdAt: NOW, updatedAt: NOW })
    await ctx.db.patch(learningVoidId, { activeBlueprintRevisionId: blueprintRevisionId })
    const assessmentContract = { version: 'learn-v2.assessment.v1' as const, kind: 'machine_checkable' as const, responseFormat: 'structured' as const,
      instructions: 'Apply the rule.', passingScorePercent: 80 as const, criteria: [{ key: 'rule', description: 'Apply the rule.', weightPercent: 100 }] }
    const objectiveId = await ctx.db.insert('learnObjectives', { userId, blueprintRevisionId, title: 'Apply a rule', depth: 'working', assessmentContract, order: 0 })
    const capability = { learningVoidId, blueprintRevisionId, objectiveId, blueprintRecordRevision: 1, assessmentContractVersion: assessmentContract.version, assessmentContractDigest: await privacyDigest(assessmentContract), depth: 'working' as const }
    const studyPlanId = await ctx.db.insert('studyPlans', { userId, learningVoidId, revision: 1, createdAt: NOW })
    const studyPlanRevisionId = await ctx.db.insert('studyPlanRevisions', { userId, learningVoidId, studyPlanId, revision: 1, recordRevision: 1, blueprintRevisionId, blueprintRecordRevision: 1, timezone: 'America/Toronto', status: 'accepted', acceptedAt: NOW - 1000, createdAt: NOW })
    await ctx.db.patch(studyPlanId, { activeRevisionId: studyPlanRevisionId })
    const studySessionId = await ctx.db.insert('studySessions', { userId, studyPlanRevisionId, primaryObjectiveId: objectiveId, status: 'ready', revision: 1, scheduledStartAt: NOW, timezone: 'America/Toronto' })
    const catalogId = await ctx.db.insert('learnAssessmentCatalogs', { ...base, catalogRevision: 1, instrumentationEpoch: 'synthetic.instrumentation.v1', historyCompleteness: 'prospective_complete', historyBasisVersion: 'synthetic.history.v1', historyCoverageWatermark: 'synthetic.coverage.v1' })
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { userId, learningVoidId, origin: 'user_url', externalKey: 'synthetic-source' })
    const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', { userId, learningVoidId, sourceIdentityId, revision: 1, recordRevision: 1,
      status: 'user_accepted', effectiveStatus: 'user_accepted', conflictStatus: 'clear', rightsStatus: 'permitted', contentHash: HASH, sourceRevision: 'source.v1', createdAt: NOW })
    const sourceExcerptId = await ctx.db.insert('learnSourceExcerpts', { userId, sourceSnapshotId, locator: 'rule', excerpt: 'The source rule.', rightsStatus: 'permitted' })
    const familyId = await ctx.db.insert('learnMeasurementFamilies', { ...base, ...capability, evidenceStatus: 'available', familyKey: 'synthetic-family', revision: 1, recordRevision: 1,
      equivalenceVersion: 'synthetic.equivalence.v1', equivalenceDescriptor: { operation: 'apply', contentCoverage: 'rule', transferDemand: 'distinct case', responseModality: 'keyed', scoreScale: 'percent_0_100', criteriaDigest: HASH, thresholdVersion: 'threshold.v1', rationale: 'Synthetic fixture only.', difficultyPrior: 'unknown' },
      coreFormCount: coreCount, totalFormCount: coreCount + Number(reserve), validationArtifactDigest: HASH, status: 'quarantined', reasonCode: 'fixture_only' })
    const validationId = await ctx.db.insert('learnMeasurementValidations', { ...base, ...capability, evidenceStatus: 'available', subject: { kind: 'family', familyId },
      subjectRevision: 1, subjectDigest: HASH, check: 'publication', decision: 'pass', reasonCode: 'fixture_only', validatorVersion: 'synthetic.validation.v1', validatorModel: null,
      promptVersion: 'synthetic.prompt.v1', harnessArtifactDigest: HASH, comparedCatalogRevision: 1, corpusDigest: HASH, coverageWatermark: 'synthetic.coverage.v1' })
    await ctx.db.patch(familyId, { status: 'provisional_equivalent', validationId })
    const jobId = await ctx.db.insert('learnJobs', { userId, learningVoidId, type: 'synthetic_fixture', status: 'succeeded', revision: 1, idempotencyKey: 'fixture' })
    const itemIds: Id<'learnMeasurementItems'>[] = []
    for (let index = 0; index < coreCount + Number(reserve); index++) {
      const formLabel = 'ABCD'[index]!
      const caseId = await ctx.db.insert('learnAssessmentCases', { ...base, caseKey: `case-${formLabel}`, scenarioFingerprint: await privacyDigest(['scenario', index]), solutionFingerprint: await privacyDigest(['solution', index]), identityPolicyVersion: 'synthetic.identity.v1', identityValidationId: validationId, usageClass: 'measurement_reserved', reservedAt: NOW })
      const itemId = await ctx.db.insert('learnMeasurementItems', { ...base, ...capability, evidenceStatus: 'available', familyId, familyRevision: 1, itemKey: `item-${formLabel}`, revision: 1,
        caseId, formLabel, reserve: index >= coreCount, prompt: `Synthetic ${formLabel}`, promptDigest: await privacyDigest(`Synthetic ${formLabel}`),
        responseSpec: { kind: 'keyed', version: 'response.v1', maxSelections: 1 }, scoringSpecRevision: 1, scoringSpecDigest: HASH, generatorVersion: 'synthetic.generator.v1', generationJobId: jobId,
        inputDigest: HASH, catalogRevision: 1, supportManifestDigest: HASH, status: 'candidate' })
      const scoringSpecId = await ctx.db.insert('learnMeasurementScoringSpecs', { ...base, ...capability, evidenceStatus: 'available', itemId, revision: 1, digest: HASH,
        payload: { kind: 'keyed', acceptedSets: [['correct']], normalizationVersion: 'normalization.v1' }, referenceSolution: 'Apply the source rule.', scoringBinding: syntheticProtocol().scoringBinding })
      const { _id, _creationTime, ...validationFields } = (await ctx.db.get(validationId))!
      const publicationValidationId = await ctx.db.insert('learnMeasurementValidations', { ...validationFields, subject: { kind: 'item', itemId } })
      await ctx.db.patch(itemId, { status: 'published', scoringSpecId, publicationValidationId })
      const claimId = await ctx.db.insert('learnMeasurementClaims', { ...base, ...capability, evidenceStatus: 'available', itemId, scoringSpecId, order: 0, part: 'key', claim: 'The rule determines the answer.', claimDigest: HASH, revision: 1 })
      await ctx.db.insert('learnMeasurementSupports', { ...base, ...capability, evidenceStatus: 'available', claimId, itemId, scoringSpecId,
        sourceSnapshotId, sourceSnapshotRevision: 1, sourceRecordRevision: 1, sourceContentHash: HASH, sourceRevision: 'source.v1', sourceExcerptId,
        excerptDigest: HASH, locatorDigest: HASH, supportRevision: 1, supportDigest: HASH, rightsStatus: 'permitted', accessStatus: 'available', conflictStatus: 'none', entailment: 'entailed', verifierVersion: 'synthetic.verifier.v1', verifierModel: 'synthetic-verifier' })
      itemIds.push(itemId)
    }
    return { base, capability, studySessionId, familyId, itemIds, catalogId, sourceSnapshotId, studyPlanRevisionId }
  })
  const owner = t.withIdentity(OWNER)
  const request = { studySessionId: f.studySessionId, familyId: f.familyId, entryPoint: 'today' as const }
  async function admitted() {
    const result = await owner.mutation(enroll, request)
    expect(result).toMatchObject({ status: 'admitted', reasonCodes: [] })
    if (!result.assignmentId) throw new Error('Expected assignment')
    const assignment = await t.run(ctx => ctx.db.get(result.assignmentId!))
    if (assignment?.status !== 'admitted') throw new Error('Expected admitted assignment')
    return assignment
  }
  const work = async () => await t.mutation(due, { userId: OWNER.tokenIdentifier })
  const opportunities = async () => await t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(20))
  const facts = async () => await t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(100))
  const events = async () => await t.run(ctx => ctx.db.query('learnActivityEvents').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(100))
  async function grant(assessmentOpportunityId: Id<'learnAssessmentOpportunities'>) {
    return await t.run(async ctx => {
      const row = (await ctx.db.get(assessmentOpportunityId))!
      if (row.assessmentPins.kind !== 'measurement') throw new Error('Expected Measurement Item')
      const pins = row.assessmentPins.itemPins
      const exposureId = await ctx.db.insert('learnAssessmentExposures', { ...f.base, serverTime: Date.now(), createdAt: Date.now(),
        caseId: pins.caseId, itemId: pins.itemId, itemRevision: pins.itemRevision, familyId: pins.familyId, formLabel: pins.formLabel,
        learningVoidId: row.learningVoidId, blueprintRevisionId: row.blueprintRevisionId, objectiveId: row.objectiveId,
        assignmentId: row.assignmentId, assessmentOpportunityId: row._id, purpose: row.horizonDays ? 'delayed_measurement' : 'cold_measurement',
        status: 'granted', projectionDigest: pins.promptDigest, deliveryReceiptHash: await privacyDigest(['grant', row._id]), policyVersion: 'synthetic.disclosure.v1', provenanceVersion: 'synthetic.grant.v1' })
      await ctx.db.patch(row._id, { deliveryGrantId: exposureId, phase: 'test_open', revision: row.revision + 1,
        deliveryPins: { version: LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION, confidenceRequested: false } })
      return row.revision + 1
    })
  }
  return { t, f, owner, request, admitted, work, opportunities, facts, events, grant }
}

test.each(LEARN_V2_FORM_ORDERS.map((order, index) => [order, index] as const))('persists uniform %s assignment before grant and replays lost requests', async (order, index) => {
  const f = await fixture()
  const random = vi.spyOn(Math, 'random').mockReturnValue((index + 6) / 0x1_0000_0000)
  const assignment = await f.admitted()
  random.mockRestore()
  expect(assignment.allocation).toMatchObject({ kind: 'three_case', order })
  expect(assignment.sequenceIndex).toBe(index)
  expect(assignment.randomizationSeed).toHaveLength(8)
  const replay = await f.owner.mutation(enroll, { ...f.request, entryPoint: 'session_deep_link' })
  expect(replay.assignmentId).toBe(assignment._id)
  expect(await f.opportunities()).toHaveLength(1)
  expect(await f.facts()).toHaveLength(2)
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(8))).toHaveLength(0)
})

test('missing owner protocol and disabled capability cannot admit or schedule', async () => {
  const f = await fixture()
  policy.protocol = null
  expect(await f.owner.mutation(enroll, f.request)).toEqual({ status: 'protocol_not_frozen', assignmentId: null, reasonCodes: ['protocol_not_frozen'] })
  expect(await f.work()).toMatchObject({ status: 'protocol_not_frozen', complete: false })
  policy.protocol = syntheticProtocol()
  policy.enrollment = false
  expect(await f.owner.mutation(enroll, f.request)).toMatchObject({ status: 'disabled' })
  expect(await f.facts()).toHaveLength(0)
  expect(await f.opportunities()).toHaveLength(0)
})

test('checked-in protocol and capability remain default-off', async () => {
  const actualProtocol = await vi.importActual<typeof import('./lib/learnV2MeasurementAssignment')>('./lib/learnV2MeasurementAssignment')
  const actualManifest = await vi.importActual<typeof import('../shared/learn-v2-measurement-storage-manifest')>('../shared/learn-v2-measurement-storage-manifest')
  expect(actualProtocol.getFrozenLearnMeasurementProtocol()).toBeNull()
  expect(actualManifest.LEARN_MEASUREMENT_CAPABILITIES.enrollment).toBe(false)
})

test('concurrent route retries share a single persisted episode and cold slot', async () => {
  const f = await fixture()
  const [first, second] = await Promise.all([f.owner.mutation(enroll, f.request), f.owner.mutation(enroll, { ...f.request, entryPoint: 'session_deep_link' })])
  expect(first.assignmentId).toBe(second.assignmentId)
  expect(await f.opportunities()).toHaveLength(1)
  expect((await f.facts()).filter(row => row.fact.kind === 'enrollment')).toHaveLength(1)
})

test.each(['unknown', 'delivered_ready', 'no_t0', 'stale_plan', 'canvas'] as const)('retains %s candidate with honest exclusion', async kind => {
  const f = await fixture()
  if (kind === 'unknown') await f.t.run(ctx => ctx.db.patch(f.f.catalogId, { historyCompleteness: 'unknown' }))
  if (kind === 'delivered_ready') await f.t.run(ctx => ctx.db.insert('learnAssessmentExposures', { ...f.f.base,
    learningVoidId: f.f.capability.learningVoidId, blueprintRevisionId: f.f.capability.blueprintRevisionId, objectiveId: f.f.capability.objectiveId,
    purpose: 'teaching', status: 'granted', projectionDigest: HASH, deliveryReceiptHash: HASH, serverTime: NOW - 1000, policyVersion: 'disclosure.v1', provenanceVersion: 'history.v1' }))
  if (kind === 'no_t0') await f.t.run(ctx => ctx.db.patch(f.f.sourceSnapshotId, { rightsStatus: 'prohibited' }))
  if (kind === 'stale_plan') await f.t.run(ctx => ctx.db.patch(f.f.studyPlanRevisionId, { recordRevision: 2, blueprintRecordRevision: 2 }))
  const result = await f.owner.mutation(enroll, { ...f.request, entryPoint: kind === 'canvas' ? 'canvas' : 'today' })
  expect(result.status).toBe('not_admitted')
  expect(result.reasonCodes).toContain({ unknown: 'unknown_history', delivered_ready: 'prior_exposure', no_t0: 'evidence_unavailable', stale_plan: 'pins_mismatch', canvas: 'not_admitted' }[kind])
  expect(result.assignmentId).not.toBeNull()
  expect(await f.opportunities()).toHaveLength(0)
  expect((await f.facts())[0]?.fact.kind).toBe('enrollment')
})

test.each([7, 30] as const)('two forms assign only declared day %s', async horizon => {
  policy.protocol = syntheticProtocol('enrollment', [horizon])
  const f = await fixture(2)
  const assignment = await f.admitted()
  expect(assignment.allocation).toMatchObject({ kind: 'two_case', horizonDays: horizon })
  await f.work()
  expect((await f.opportunities()).filter(row => row.horizonDays).map(row => row.horizonDays)).toEqual([horizon])
})

test('unstarted cold anchor stays explicit without invented delayed clocks', async () => {
  policy.protocol = syntheticProtocol('sealed_cold')
  const f = await fixture()
  await f.admitted()
  vi.setSystemTime(NOW + 40 * 86_400_000)
  await f.work()
  await f.work()
  const rows = await f.opportunities()
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ phase: 'abandoned', reasonCode: 'anchor_not_started' })
  expect(await f.events()).toHaveLength(0)
  expect((await f.facts()).filter(row => row.fact.kind === 'opportunity')).toHaveLength(2)
})

test('sealed cold acceptance anchors windows before scoring and survives lost response replays', async () => {
  policy.protocol = syntheticProtocol('sealed_cold')
  const f = await fixture()
  const assignment = await f.admitted()
  const cold = (await f.opportunities())[0]!
  const revision = await f.grant(cold._id)
  vi.setSystemTime(NOW + 30 * 60_000)
  const request = { version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: 'synthetic_cold_request_123456',
    response: { target: { assessmentOpportunityId: cold._id }, expectedRevision: revision, payload: { kind: 'keyed' as const, keys: ['correct'] } } }
  const accepted = await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: request })
  expect(accepted.kind).toBe('accepted')
  expect(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: request })).toEqual(accepted)
  await f.work()
  await f.work()
  expect(await f.t.run(ctx => ctx.db.get(assignment._id))).toMatchObject({ anchorAt: NOW + 30 * 60_000 })
  expect((await f.opportunities()).filter(row => row.horizonDays)).toHaveLength(2)
  expect(await f.t.run(ctx => ctx.db.query('masteryAttempts').take(8))).toHaveLength(0)
  expect((await f.facts()).filter(row => row.fact.kind === 'response')).toHaveLength(1)
})

test.each([-1, 0] as const)('cold acceptance at closeAt offset %s respects the half-open boundary', async offset => {
  policy.protocol = syntheticProtocol('sealed_cold')
  const f = await fixture()
  await f.admitted()
  const cold = (await f.opportunities())[0]!
  const revision = await f.grant(cold._id)
  vi.setSystemTime(cold.closeAt + offset)
  const result = await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: 'synthetic_cold_boundary_123456', response: { target: { assessmentOpportunityId: cold._id }, expectedRevision: revision,
      payload: { kind: 'keyed', keys: ['wrong'] } } } })
  expect(result.kind).toBe(offset < 0 ? 'accepted' : 'rejected')
  if (offset === 0) expect(result).toMatchObject({ reasonCode: 'outside_window' })
})

test('non-returner misses day 7 and remains eligible day 30 below Independent; exact DST windows and replay', async () => {
  const f = await fixture()
  const assignment = await f.admitted()
  await f.work()
  let rows = await f.opportunities()
  const day7 = rows.find(row => row.horizonDays === 7)!
  const day30 = rows.find(row => row.horizonDays === 30)!
  expect(day7.openAt).toBe(Date.parse('2027-03-14T05:00:00Z'))
  expect(day7.closeAt - day7.openAt).toBe(23 * 3_600_000)
  expect(day30.openAt).toBe(Date.parse('2027-04-06T04:00:00Z'))
  vi.setSystemTime(day7.openAt - 1)
  await f.work()
  expect(await f.events()).toHaveLength(0)
  vi.setSystemTime(day7.openAt)
  await f.work()
  await f.work()
  expect(await f.events()).toHaveLength(1)
  vi.setSystemTime(day7.closeAt)
  await f.work()
  expect((await f.opportunities()).find(row => row._id === day7._id)).toMatchObject({ phase: 'abandoned', reasonCode: 'missed_window', eligibleAt: day7.openAt })
  vi.setSystemTime(day30.openAt)
  await f.work()
  await f.work()
  rows = await f.opportunities()
  expect(rows.find(row => row._id === day30._id)).toMatchObject({ phase: 'ready', operationalEligibility: 'eligible', assignmentId: assignment._id })
  expect(await f.events()).toHaveLength(2)
  expect(await f.t.run(ctx => ctx.db.query('masteryRecords').take(8))).toHaveLength(0)
  const factCount = (await f.facts()).length
  await f.work()
  expect(await f.facts()).toHaveLength(factCount)
})

test('source loss and missing items block due eligibility while preserving enrollment and opportunities', async () => {
  const f = await fixture()
  const assignment = await f.admitted()
  await f.work()
  const rows = await f.opportunities()
  const day7 = rows.find(row => row.horizonDays === 7)!
  if (assignment.allocation.kind !== 'three_case') throw new Error('Expected full protocol')
  await f.t.run(ctx => ctx.db.patch(assignment.allocation.kind === 'three_case' ? assignment.allocation.day7.itemId : assignment.allocation.cold.itemId, { status: 'retired' }))
  vi.setSystemTime(day7.openAt)
  await f.work()
  expect((await f.opportunities()).find(row => row._id === day7._id)?.reasonCode).toBe('novel_item_unavailable')
  expect(await f.events()).toHaveLength(0)
  expect((await f.facts()).filter(row => row.fact.kind === 'enrollment')).toHaveLength(1)
})

test('later source loss retains the earlier eligibility event and its time', async () => {
  const f = await fixture()
  await f.admitted()
  await f.work()
  const day7 = (await f.opportunities()).find(row => row.horizonDays === 7)!
  vi.setSystemTime(day7.openAt)
  await f.work()
  await f.t.run(ctx => ctx.db.patch(f.f.sourceSnapshotId, { conflictStatus: 'unresolved' }))
  vi.setSystemTime(day7.openAt + 1)
  await f.work()
  expect((await f.opportunities()).find(row => row._id === day7._id)).toMatchObject({ operationalEligibility: 'blocked', reasonCode: 'evidence_unavailable', eligibleAt: day7.openAt })
  expect(await f.events()).toHaveLength(1)
})

test('provider configuration loss is an explicit due block and recovers without another slot', async () => {
  const f = await fixture()
  const scoringBinding = { kind: 'model' as const, configurationId: 'synthetic.scorer', configurationVersion: 'synthetic.config.v1', configurationDigest: HASH,
    requestedModel: 'synthetic-model', routingMode: 'strict' as const, endpoint: 'synthetic-endpoint', scorerVersion: 'synthetic.scorer.v1', promptVersion: 'synthetic.prompt.v1',
    responseSchemaVersion: 'synthetic.response.v1', parserVersion: 'synthetic.parser.v1', guardVersion: 'synthetic.guard.v1', thresholdVersion: 'threshold.v1', thresholdPercent: 80 as const, transitionVersion: 'learn-v2.mastery-transition.v1' as const }
  policy.protocol = { ...syntheticProtocol(), scoringBinding }
  vi.stubEnv('OPENROUTER_API_KEY', 'synthetic-unused')
  vi.stubEnv('CF_ACCOUNT_ID', 'synthetic-unused')
  vi.stubEnv('CLOUDFLARE_AI_GATEWAY_ID', 'synthetic-unused')
  await f.t.run(async ctx => {
    for (const itemId of f.f.itemIds) {
      const item = (await ctx.db.get(itemId))!
      await ctx.db.patch(itemId, { responseSpec: { kind: 'bounded_rubric', version: 'response.v1', maxCodeUnits: 12000 } })
      await ctx.db.patch(item.scoringSpecId!, { scoringBinding, payload: { kind: 'bounded_rubric', keyInsufficientReason: 'Reasoning is required.', criteria: [{ key: 'rule', description: 'Apply the source rule.', weightPercent: 100 }] } })
    }
  })
  await f.admitted()
  await f.work()
  const day7 = (await f.opportunities()).find(row => row.horizonDays === 7)!
  vi.stubEnv('OPENROUTER_API_KEY', '')
  vi.setSystemTime(day7.openAt)
  await f.work()
  expect((await f.opportunities()).find(row => row._id === day7._id)).toMatchObject({ operationalEligibility: 'blocked', reasonCode: 'provider_blocked' })
  expect(await f.events()).toHaveLength(0)
  vi.stubEnv('OPENROUTER_API_KEY', 'synthetic-unused')
  await f.work()
  await f.work()
  expect((await f.opportunities()).find(row => row._id === day7._id)).toMatchObject({ operationalEligibility: 'eligible' })
  expect(await f.opportunities()).toHaveLength(3)
  expect(await f.events()).toHaveLength(1)
})

test.each([true, false])('first Independent claim freezes its next slot and replays after a miss; measurement=%s', async measured => {
  const f = await fixture()
  const assignment = await f.admitted()
  await f.work()
  const basisAttemptId = await f.t.run(ctx => ctx.db.insert('masteryAttempts', {
    userId: OWNER.tokenIdentifier, blueprintRevisionId: assignment.blueprintRevisionId, objectiveId: assignment.objectiveId,
    attemptedAt: NOW, acceptedAt: NOW, idempotencyKey: 'independent_basis', kind: 'independent_application', serverScorePercent: 80,
    masteryStateBefore: 'guided', masteryStateAfter: 'independent', masteryTransitionVersion: 'learn-v2.mastery-transition.v1', masteryRecordRevision: 2,
    attemptTimezone: 'America/Toronto', attemptLocalDate: '2027-03-07',
    assistanceSnapshot: { policyVersion: LEARN_V2_ASSISTANCE_POLICY_VERSION, state: 'unassisted', assistanceRevision: 0, substantiveHintUsedAt: null, answerRevealedAt: null,
      priorExposure: 'prospectively_unexposed', outsideHelp: 'unknown', pasteObserved: 'unknown', focusLossObserved: 'unknown', instrumentationVersion: 'synthetic.v1', instrumentationProvenance: 'synthetic.v1' },
    validitySnapshot: { policyVersion: LEARN_V2_VALIDITY_POLICY_VERSION, status: 'valid', measurementEligible: false, masteryEligible: true, exclusionReasons: [] },
  }))
  const day7 = (await f.opportunities()).find(row => row.horizonDays === 7)!
  let expectedId = day7._id
  if (!measured) expectedId = await f.t.run(async ctx => {
    const { _id, _creationTime, ...fields } = day7
    await ctx.db.patch(assignment._id, { assignmentKey: 'another_epoch_assignment' })
    return await ctx.db.insert('learnAssessmentOpportunities', { ...fields, assignmentId: undefined, delayedCheckId: 'synthetic_retained_slot',
      assessmentPins: { kind: 'session_application', caseId: assignment.allocation.cold.caseId, promptDigest: HASH, rubricVersion: 'rubric.v1', rubricDigest: HASH, supportManifestDigest: HASH },
      purpose: { kind: 'retained_transfer', basisAttemptId, clock: measurementClock(syntheticProtocol(), { at: NOW, eventId: basisAttemptId }, 'America/Toronto', 7) } })
  })
  const request = { ...(measured ? { assignmentId: assignment._id } : {}), basisAttemptId }
  const first = await f.owner.mutation(claim, request)
  expect(first?.kind).toBe('independent_claim_v2')
  if (!first || first.kind !== 'independent_claim_v2' || first.firstSlot.kind !== 'linked') throw new Error('Expected first claim')
  expect(first.firstSlot.firstCheckOpportunityId).toBe(expectedId)
  vi.setSystemTime(day7.closeAt)
  await f.work()
  expect(await f.owner.mutation(claim, request)).toEqual(first)
  expect((await f.facts()).filter(row => row.fact.kind === 'independent_claim_v2')).toHaveLength(1)
})

test('ready history predating instrumentation never becomes clean on a new request or title', async () => {
  const f = await fixture()
  await f.t.run(async ctx => {
    await ctx.db.patch(f.f.catalogId, { createdAt: NOW + 1 })
    await ctx.db.patch(f.f.capability.objectiveId, { title: 'A renamed capability' })
  })
  expect((await f.owner.mutation(enroll, f.request)).reasonCodes).toContain('unknown_history')
})

test('enrollment interval is half-open and stored timezone edits cannot move assigned slots', async () => {
  policy.protocol = { ...syntheticProtocol(), enrollmentEndAt: NOW }
  const f = await fixture()
  expect((await f.owner.mutation(enroll, f.request)).reasonCodes).toContain('outside_enrollment_window')
  const second = await fixture()
  policy.protocol = { ...syntheticProtocol(), enrollmentStartAt: NOW }
  const assignment = await second.admitted()
  await second.t.run(ctx => ctx.db.patch(second.f.studyPlanRevisionId, { timezone: 'Pacific/Auckland' }))
  await second.work()
  expect((await second.opportunities()).find(row => row.horizonDays === 7)?.openAt).toBe(Date.parse('2027-03-14T05:00:00Z'))
  expect(assignment.enrollmentTimezone).toBe('America/Toronto')
})

test('fall DST window has 25 hours and a late worker cannot backdate eligibility', async () => {
  const start = Date.parse('2027-10-31T14:00:00Z')
  vi.setSystemTime(start)
  policy.protocol = { ...syntheticProtocol(), enrollmentStartAt: start, enrollmentEndAt: start + 86_400_000 }
  const f = await fixture()
  await f.admitted()
  await f.work()
  const day7 = (await f.opportunities()).find(row => row.horizonDays === 7)!
  expect(day7.closeAt - day7.openAt).toBe(25 * 3_600_000)
  vi.setSystemTime(day7.closeAt)
  await f.t.mutation(due, { userId: OWNER.tokenIdentifier, through: day7.openAt })
  expect(await f.events()).toHaveLength(0)
  expect((await f.opportunities()).find(row => row._id === day7._id)).toMatchObject({ reasonCode: 'missed_window', phase: 'abandoned' })
})

test('day-7 failure does not gate the independently assigned day-30 case', async () => {
  const f = await fixture()
  await f.admitted()
  await f.work()
  const rows = await f.opportunities()
  const day7 = rows.find(row => row.horizonDays === 7)!
  const day30 = rows.find(row => row.horizonDays === 30)!
  await f.t.run(ctx => ctx.db.patch(day7._id, { phase: 'scored_fail' }))
  vi.setSystemTime(day30.openAt)
  await f.work()
  expect((await f.opportunities()).find(row => row._id === day30._id)).toMatchObject({ operationalEligibility: 'eligible' })
  expect(await f.events()).toHaveLength(1)
  expect((await f.opportunities()).find(row => row._id === day7._id)?.phase).toBe('scored_fail')
})

test('reserve is linked, secondary and idempotent; original exclusion and later miss remain', async () => {
  const f = await fixture(3, true)
  const assignment = await f.admitted()
  await f.work()
  const original = (await f.opportunities()).find(row => row.horizonDays === 7)!
  if (assignment.allocation.kind !== 'three_case') throw new Error('Expected full protocol')
  await f.t.run(ctx => ctx.db.patch(assignment.allocation.kind === 'three_case' ? assignment.allocation.day7.itemId : assignment.allocation.cold.itemId, { status: 'retired' }))
  vi.setSystemTime(original.openAt)
  await f.work()
  const request = { assessmentOpportunityId: original._id, reason: 'novel_item_unavailable' as const }
  const result = await f.owner.mutation(replace, request)
  expect(result.status).toBe('replaced')
  expect(await f.owner.mutation(replace, request)).toEqual(result)
  const rows = await f.opportunities()
  expect(rows.filter(row => row.horizonDays === 7)).toHaveLength(2)
  expect(rows.find(row => row.replacesOpportunityId === original._id)).toMatchObject({ originalSlot: false, replacementReason: request.reason })
  expect(rows.find(row => row._id === original._id)).toMatchObject({ phase: 'invalid', originalSlot: true })
  vi.setSystemTime(original.closeAt)
  await f.work()
  expect((await f.opportunities()).find(row => row.replacesOpportunityId === original._id)?.phase).toBe('abandoned')
})

test('exhausted reserves and wrong answers cannot reroll a case', async () => {
  const f = await fixture()
  await f.admitted()
  await f.work()
  const original = (await f.opportunities()).find(row => row.horizonDays === 7)!
  vi.setSystemTime(original.openAt)
  await f.t.run(ctx => ctx.db.patch(original._id, { reasonCode: 'novel_item_unavailable', operationalEligibility: 'blocked' }))
  expect(await f.owner.mutation(replace, { assessmentOpportunityId: original._id, reason: 'novel_item_unavailable' })).toEqual({ status: 'novel_item_unavailable' })
  await f.t.run(ctx => ctx.db.patch(original._id, { phase: 'scored_fail', reasonCode: 'abandoned' }))
  expect(await f.owner.mutation(replace, { assessmentOpportunityId: original._id, reason: 'abandoned' })).toEqual({ status: 'replacement_not_allowed' })
})

test('instruction exposure persists before delivery, retries once, and blocks a late cold baseline', async () => {
  const f = await fixture()
  const assignment = await f.admitted()
  const request = { assignmentId: assignment._id, studySessionId: f.f.studySessionId, flow: 'v2_today' as const, projectionDigest: HASH, deliveryReceiptHash: HASH }
  const first = await f.owner.mutation(instruction, request)
  expect(await f.owner.mutation(instruction, request)).toBe(first)
  expect((await f.opportunities())[0]).toMatchObject({ reasonCode: 'cold_after_teaching', operationalEligibility: 'blocked' })
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentExposures').take(8))).toHaveLength(1)
  const foreign = f.t.withIdentity({ tokenIdentifier: 'https://elsewhere.example|prospect', subject: OWNER.subject })
  await expect(foreign.mutation(enroll, f.request)).rejects.toThrow('access denied')
  expect(await f.owner.mutation(enroll, { ...f.request, entryPoint: 'canvas' })).toMatchObject({ status: 'not_admitted', assignmentId: assignment._id, reasonCodes: ['canvas_not_admitted'] })
})

test('due-work resumes bounded pages, restarts on source changes and preserves incomplete coverage', async () => {
  const f = await fixture()
  const assignment = await f.admitted()
  await f.t.run(async ctx => {
    const { _id, _creationTime, ...fields } = assignment
    await ctx.db.insert('learnMeasurementAssignments', { ...fields, assignmentKey: 'synthetic_missing_cold' })
  })
  const first = await f.owner.mutation(batch, { cursor: null, through: NOW })
  expect(first).toMatchObject({ processed: 1, complete: false })
  expect(first.cursor).not.toBeNull()
  const second = await f.owner.mutation(batch, { cursor: first.cursor, through: NOW, expectedSequence: first.sequence, coverageComplete: first.coverageComplete })
  expect(second).toMatchObject({ processed: 1, complete: false, coverageComplete: false, cursor: null })
  expect(await f.t.run(ctx => ctx.db.query('learnMeasurementSourceWatermarks').first())).toMatchObject({ dueWorkThrough: null })
  const restart = await f.owner.mutation(batch, { cursor: first.cursor, through: NOW, expectedSequence: 0 })
  expect(restart).toMatchObject({ processed: 1, complete: false })
  expect(restart.cursor).not.toBeNull()
})


async function acceptFixtureCheck(f: Awaited<ReturnType<typeof fixture>>, opportunityId: Id<'learnAssessmentOpportunities'>,
  payload: { kind: 'keyed', keys: string[] } | { kind: 'text', text: string } | { kind: 'numeric', value: number, unit: string } | { kind: 'ordered', entries: string[] } = { kind: 'keyed', keys: ['correct'] }) {
  const revision = await f.grant(opportunityId)
  const request = { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: `accept_${opportunityId}`,
    response: { target: { assessmentOpportunityId: opportunityId }, expectedRevision: revision, payload } } }
  const accepted = await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, request)
  if (accepted.kind !== 'accepted') throw new Error(`Expected acceptance: ${JSON.stringify(accepted)}`)
  const score = () => f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: accepted.submissionId, idempotencyKey: `score_${opportunityId}` })
  return { accepted, score, request }
}

async function seedIndependent(f: Pick<Awaited<ReturnType<typeof fixture>>, 't' | 'f'>) {
  await f.t.run(async ctx => ctx.db.insert('masteryRecords', { userId: OWNER.tokenIdentifier, blueprintRevisionId: f.f.capability.blueprintRevisionId,
    objectiveId: f.f.capability.objectiveId, state: 'independent', recordRevision: 1,
    scopeKey: await masteryScopeKey(OWNER.tokenIdentifier, f.f.capability.blueprintRevisionId, f.f.capability.objectiveId),
    firstIndependentPassAt: NOW, firstIndependentLocalDate: '2027-03-07', firstIndependentTimezone: 'America/Toronto', updatedAt: NOW }))
}

async function configureModelFixture(f: Awaited<ReturnType<typeof fixture>>) {
  const definition = { configurationId: 'synthetic.legacy', configurationVersion: 'synthetic.config.v1', kind: 'legacy_baseline' as const,
    requestedModel: 'synthetic/model', endpoint: null, identity: { mappingVersion: 'synthetic.identity.v1', canonicalModel: 'synthetic/model',
      family: 'synthetic', snapshotAssurance: 'unknown' as const, verifiedReturnedModels: [] } }
  const saved = await sealLearnScorerConfiguration(definition)
  const registry = await createLearnScorerRegistry({ epoch: 'synthetic.epoch.v1',
    configurations: [{ definition, expectedDigest: saved.binding.configurationDigest }], legacyAllowlist: [definition.configurationId], prospectiveConfigurationId: null })
  policy.scorer = { registry, saved }
  policy.protocol = { ...syntheticProtocol(), scoringBinding: saved.binding }
  vi.stubEnv('OPENROUTER_API_KEY', 'synthetic-unused')
  vi.stubEnv('CF_ACCOUNT_ID', 'synthetic-unused')
  vi.stubEnv('CLOUDFLARE_AI_GATEWAY_ID', 'synthetic-unused')
  await f.t.run(async ctx => {
    for (const id of f.f.itemIds) {
      const item = (await ctx.db.get(id))!
      await ctx.db.patch(id, { responseSpec: { kind: 'bounded_rubric', version: 'response.v1', maxCodeUnits: 12000 } })
      await ctx.db.patch(item.scoringSpecId!, { scoringBinding: saved.binding, payload: { kind: 'bounded_rubric', keyInsufficientReason: 'Reasoning is required.',
        criteria: [{ key: 'rule', description: 'PRIVATE CRITERION DESCRIPTION', weightPercent: 100 }] } })
    }
  })
  return saved
}
function modelReply(model = 'synthetic/model', provider = 'Synthetic Provider') {
  return new Response(JSON.stringify({ id: 'synthetic-execution', model, choices: [{ index: 0, finish_reason: 'stop',
    message: { role: 'assistant', content: JSON.stringify({ criterionResults: [{ key: 'rule', awarded: true }], misconceptionTags: [] }) } }],
    usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
    openrouter_metadata: { requested: 'synthetic/model', strategy: 'direct', attempt: 1,
      endpoints: { available: [{ provider, model, selected: true }] }, pipeline: [] } }))
}

test.each([['keyed', 'correct'], ['keyed', 'wrong']] as const)('sealed deterministic %s answer %s scores exactly once without a provider or cold mastery', async (_kind, answer) => {
  const f = await fixture()
  policy.scoring = true
  const network = vi.fn(() => { throw new Error('Unexpected provider call') })
  vi.stubGlobal('fetch', network)
  await f.admitted()
  const cold = (await f.opportunities())[0]!
  const response = await acceptFixtureCheck(f, cold._id, { kind: 'keyed', keys: [answer] })
  vi.setSystemTime(NOW + 120_000)
  const result = await response.score()
  expect(result).toMatchObject({ status: 'scored', result: { scorePercent: answer === 'correct' ? 100 : 0, scoreCommittedAt: Date.now() } })
  expect(await response.score()).toEqual(result)
  const attempts = await f.t.run(ctx => ctx.db.query('masteryAttempts').take(8))
  expect(attempts).toHaveLength(1)
  expect(attempts[0]).toMatchObject({ kind: 'measurement_cold', acceptedAt: NOW, attemptedAt: NOW, scoreCommittedAt: Date.now() })
  expect(attempts[0]?.response).toBeUndefined()
  expect(await f.t.run(ctx => ctx.db.query('masteryRecords').take(8))).toHaveLength(0)
  expect(await f.t.run(ctx => ctx.db.get(f.f.studySessionId))).toMatchObject({ status: 'ready' })
  expect((await f.facts()).filter(row => row.fact.kind === 'score')).toHaveLength(1)
  expect((await f.events()).filter(row => row.eventType === 'representative_pass')).toHaveLength(0)
  expect(network).not.toHaveBeenCalled()
})

test.each([false, true])('a valid delayed failure preserves measurement below Independent and applies only eligible remediation: independent=%s', async independent => {
  const f = await fixture()
  policy.scoring = true
  if (independent) await seedIndependent(f)
  await f.admitted()
  await f.work()
  const day7 = (await f.opportunities()).find(row => row.horizonDays === 7)!
  vi.setSystemTime(day7.openAt)
  await f.work()
  const response = await acceptFixtureCheck(f, day7._id, { kind: 'keyed', keys: ['wrong'] })
  expect(await response.score()).toMatchObject({ status: 'scored', result: { scorePercent: 0 } })
  expect(await response.score()).toMatchObject({ status: 'scored' })
  const attempts = await f.t.run(ctx => ctx.db.query('masteryAttempts').take(8))
  expect(attempts).toHaveLength(1)
  expect(attempts[0]).toMatchObject({ kind: 'measurement_delayed', horizonDays: 7, masteryStateAfter: independent ? 'needs_review' : 'unseen' })
  const records = await f.t.run(ctx => ctx.db.query('masteryRecords').take(8))
  expect(records).toHaveLength(independent ? 1 : 0)
  if (independent) expect(records[0]).toMatchObject({ state: 'needs_review', schedulingPriority: 'remediation', remediationAttemptId: attempts[0]!._id })
  expect((await f.events()).map(row => row.eventVersion)).toEqual(['delayed_check_eligible.v2', 'delayed_check_attempt.v2', 'representative_fail.v2'])
})

test('competing commits consume one deterministic receipt and emit one retained transition', async () => {
  const f = await fixture()
  policy.scoring = true
  await seedIndependent(f)
  await f.admitted()
  await f.work()
  const day7 = (await f.opportunities()).find(row => row.horizonDays === 7)!
  vi.setSystemTime(day7.openAt)
  await f.work()
  const response = await acceptFixtureCheck(f, day7._id)
  const command = { tokenIdentifier: OWNER.tokenIdentifier, submissionId: response.accepted.submissionId }
  const reservation = await f.owner.mutation(internal.learnV2Mastery.beginSealedMasteryScoring, command)
  if (reservation.kind !== 'acquired') throw new Error('Expected lease')
  const input = await f.owner.query(internal.learnV2Mastery.getSealedMasteryScoringInput, command)
  const receipt = await deterministicLearnScoringReceipt(input, { dispatchedAt: Date.now(), dispatchOrdinal: 1, leaseIdentityHash: await privacyDigest(reservation.leaseToken) })
  await expect(f.owner.mutation(internal.learnV2Mastery.registerSealedMasteryScoring, { ...command, receiptJson: JSON.stringify({ ...receipt, responseDigest: HASH }) })).rejects.toThrow()
  const executionId = await f.owner.mutation(internal.learnV2Mastery.registerSealedMasteryScoring, { ...command, receiptJson: JSON.stringify(receipt) })
  const commits = await Promise.all([f.owner.mutation(internal.learnV2Mastery.commitSealedMasteryAttempt, { ...command, executionId }),
    f.owner.mutation(internal.learnV2Mastery.commitSealedMasteryAttempt, { ...command, executionId })])
  expect(commits[0]).toBe(commits[1])
  expect(await f.t.run(ctx => ctx.db.query('masteryAttempts').take(8))).toHaveLength(1)
  expect((await f.events()).filter(row => row.eventType === 'retained')).toHaveLength(1)
  expect((await f.events()).filter(row => row.eventType === 'representative_pass')).toHaveLength(1)
})

test('a saved answer survives a provider failure and scores with its bound model after the default changes', async () => {
  const f = await fixture()
  policy.scoring = true
  await configureModelFixture(f)
  const network = vi.fn<typeof fetch>(async () => new Response('Definitive fixture failure', { status: 400 }))
  vi.stubGlobal('fetch', network)
  await f.admitted()
  const cold = (await f.opportunities())[0]!
  const response = await acceptFixtureCheck(f, cold._id, { kind: 'text', text: 'Original immutable answer.' })
  expect(await response.score()).toMatchObject({ status: 'retryable_failure' })
  expect(await f.t.run(ctx => ctx.db.query('learnResponseBodies').take(8))).toMatchObject([{ payload: { text: 'Original immutable answer.' } }])
  expect(await f.t.run(ctx => ctx.db.query('masteryAttempts').take(8))).toHaveLength(0)
  expect(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { ...response.request.submission,
    response: { ...response.request.submission.response, payload: { kind: 'text', text: 'Changed answer.' } } } })).toMatchObject({ kind: 'rejected', reasonCode: 'idempotency_conflict' })
  vi.stubEnv('LEARN_V2_MASTERY_MODEL', 'another/model')
  network.mockImplementation(async () => modelReply())
  const result = await response.score()
  expect(result).toMatchObject({ status: 'scored', result: { scorePercent: 100, feedbackCodes: ['pass'] } })
  expect(JSON.stringify(result)).not.toContain('PRIVATE CRITERION DESCRIPTION')
  expect(network).toHaveBeenCalledTimes(2)
  expect(JSON.parse(String(network.mock.calls[1]![1]?.body)).model).toBe('synthetic/model')
  const attempts = await f.t.run(ctx => ctx.db.query('masteryAttempts').take(8))
  expect(attempts[0]).toMatchObject({ requestedScorerModel: 'synthetic/model', returnedScorerModel: 'synthetic/model', acceptedAt: NOW })
})

test.each(['model', 'upstream', 'terminal'] as const)('a %s mismatch stays unscored and cannot redispatch the answer', async mismatch => {
  const f = await fixture()
  policy.scoring = true
  await configureModelFixture(f)
  vi.stubGlobal('fetch', vi.fn(async () => {
    const response = modelReply(mismatch === 'model' ? 'another/model' : 'synthetic/model', mismatch === 'upstream' ? '' : 'Synthetic Provider')
    if (mismatch !== 'terminal') return response
    const value = await response.json()
    value.choices[0].finish_reason = 'length'
    return new Response(JSON.stringify(value))
  }))
  await f.admitted()
  const response = await acceptFixtureCheck(f, (await f.opportunities())[0]!._id, { kind: 'text', text: 'A saved answer.' })
  expect(await response.score()).toMatchObject({ status: 'reconciliation_required' })
  expect(await response.score()).toMatchObject({ status: 'reconciliation_required' })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(await f.t.run(ctx => ctx.db.query('masteryAttempts').take(8))).toHaveLength(0)
  expect((await f.facts()).filter(row => row.fact.kind === 'score')).toHaveLength(0)
})


async function ordinaryFixture() {
  const f = await fixture()
  policy.scoring = true
  const saved = await configureModelFixture(f)
  const args = await f.t.run(async ctx => {
    const userId = OWNER.tokenIdentifier
    const session = (await ctx.db.get(f.f.studySessionId))!
    const plan = (await ctx.db.get(f.f.studyPlanRevisionId))!
    const objective = (await ctx.db.get(f.f.capability.objectiveId))!
    const prompt = 'Apply the source rule to this ordinary case.'
    const rubricSnapshot = JSON.stringify(objective.assessmentContract)
    const contentId = await ctx.db.insert('sessionContent', { userId, studySessionId: session._id, studyPlanRevisionId: plan._id,
      blueprintRevisionId: f.f.capability.blueprintRevisionId, objectiveId: objective._id, revision: 1, status: 'published',
      inputDigest: HASH, generatorVersion: 'synthetic.generator.v1', providerModel: 'different/generator', assessmentRubricSnapshot: rubricSnapshot, createdAt: NOW, publishedAt: NOW })
    await ctx.db.insert('sessionContentBlocks', { userId, sessionContentId: contentId, order: 0, kind: 'transfer_challenge', content: prompt })
    await ctx.db.insert('sessionContentBlocks', { userId, sessionContentId: contentId, order: 1, kind: 'worked_example', content: 'Separate-case support.' })
    await ctx.db.insert('sessionContentBlocks', { userId, sessionContentId: contentId, order: 2, kind: 'faded_example', content: 'Separate-case hint.' })
    const excerpt = (await ctx.db.query('learnSourceExcerpts').withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('sourceSnapshotId', f.f.sourceSnapshotId)).first())!
    const claimId = await ctx.db.insert('sessionContentClaims', { userId, sessionContentId: contentId, order: 0, claim: 'The rule applies.', verifierVersion: 'synthetic.verifier.v1', confidence: 1 })
    await ctx.db.insert('learnClaimSupports', { userId, sessionContentClaimId: claimId, sourceExcerptId: excerpt._id,
      sourceSnapshotId: f.f.sourceSnapshotId, entailment: 'entailed', verifierVersion: 'synthetic.verifier.v1', confidence: 1, conflictStatus: 'clear', evidenceStatus: 'evidence_available' })
    const validation = (await ctx.db.get(f.f.itemIds[0]!))!.publicationValidationId!
    const caseId = await ctx.db.insert('learnAssessmentCases', { ...f.f.base, caseKey: 'ordinary-case', scenarioFingerprint: HASH,
      solutionFingerprint: HASH, identityPolicyVersion: 'synthetic.identity.v1', identityValidationId: validation, usageClass: 'instructional' })
    const opportunityId = await ctx.db.insert('learnAssessmentOpportunities', { ...f.f.base, ...f.f.capability, scopeKind: 'v2', evidenceStatus: 'available',
      contextPins: { kind: 'session', studyPlanId: plan.studyPlanId, studyPlanRevisionId: plan._id, planRevision: plan.revision,
        planRecordRevision: plan.recordRevision ?? 1, studySessionId: session._id, sessionRevision: 1, sessionContentId: contentId, contentRevision: 1,
        contentInputDigest: HASH, generatorVersion: 'synthetic.generator.v1' }, purpose: { kind: 'independent_application' },
      assessmentPins: { kind: 'session_application', caseId, promptDigest: await privacyDigest(prompt), rubricVersion: 'learn-v2.assessment.v1',
        rubricDigest: await privacyDigest(objective.assessmentContract), supportManifestDigest: HASH }, scoringBinding: saved.binding,
      delayedCheckId: 'ordinary-original', phase: 'test_open', revision: 1, eligibilityPolicyVersion: 'synthetic.ordinary.v1', operationalEligibility: 'eligible',
      openAt: NOW, closeAt: NOW + 86_400_000, checkSequence: 0, originalSlot: true,
      deliveryPins: { version: LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION, confidenceRequested: true } })
    const grantId = await ctx.db.insert('learnAssessmentExposures', { ...f.f.base, caseId, learningVoidId: f.f.capability.learningVoidId,
      blueprintRevisionId: f.f.capability.blueprintRevisionId, objectiveId: objective._id, assessmentOpportunityId: opportunityId,
      purpose: 'practice', status: 'granted', serverTime: NOW, projectionDigest: await privacyDigest(prompt), deliveryReceiptHash: HASH,
      policyVersion: 'synthetic.disclosure.v1', provenanceVersion: 'synthetic.grant.v1' })
    await ctx.db.patch(opportunityId, { deliveryGrantId: grantId })
    await ctx.db.patch(session._id, { status: 'in_progress', startedSessionContentId: contentId, startedSessionContentRevision: 1, assistanceRevision: 0 })
    return { studySessionId: session._id, expectedSessionRevision: 1, expectedContentRevision: 1, expectedPlanRecordRevision: 1,
      expectedBlueprintRecordRevision: 1, response: 'The ordinary application response.', confidence: 4, idempotencyKey: 'ordinary:compatibility:key', opportunityId }
  })
  const { opportunityId, ...request } = args
  return { ...f, request, opportunityId }
}

test('the ordinary compatibility wrapper seals before scoring and atomically writes one v2 Independent claim at acceptance time', async () => {
  const f = await ordinaryFixture()
  const network = vi.fn<typeof fetch>(async () => modelReply())
  vi.stubGlobal('fetch', network)
  const first = await f.owner.action(api.learnV2Mastery.submitMasteryAttempt, f.request)
  expect(first).toMatchObject({ status: 'completed', scorePercent: 100, state: 'independent' })
  expect(await f.owner.action(api.learnV2Mastery.submitMasteryAttempt, f.request)).toMatchObject({ status: 'completed', attemptId: 'attemptId' in first ? first.attemptId : undefined })
  expect(network).toHaveBeenCalledTimes(1)
  const claims = (await f.facts()).filter(row => row.fact.kind === 'independent_claim_v2')
  expect(claims).toHaveLength(1)
  expect(claims[0]?.fact).toMatchObject({ firstIndependentAt: NOW, firstSlot: { kind: 'unresolved', reason: 'no_qualifying_delayed_slot' } })
  expect((await f.facts()).filter(row => row.fact.kind === 'independent_claim')).toHaveLength(0)
  expect((await f.facts()).filter(row => row.fact.kind === 'response')).toHaveLength(1)
  expect((await f.events()).filter(row => row.eventType === 'representative_pass')).toHaveLength(1)
  expect((await f.events())[0]?.threadId).toBeUndefined()
  expect(JSON.stringify(first)).not.toContain('Apply the rule.')
})

test('post-seal help and its replay cannot change frozen ordinary assistance or create a second claim', async () => {
  const f = await ordinaryFixture()
  vi.stubGlobal('fetch', vi.fn(async () => modelReply()))
  const { tokenIdentifier: _owner, ...noToken } = { tokenIdentifier: OWNER.tokenIdentifier, ...f.request }
  const accepted = await f.owner.mutation(internal.learnV2Mastery.acceptCompatibilityMasterySubmission, { tokenIdentifier: OWNER.tokenIdentifier, ...noToken })
  if (accepted.kind !== 'accepted') throw new Error('Expected acceptance')
  await f.owner.mutation(api.learnV2Mastery.recordAssistanceUse, { studySessionId: f.f.studySessionId, expectedSessionRevision: 1, kind: 'substantive_hint' })
  await f.t.run(ctx => ctx.db.patch(f.f.studySessionId, { timezone: 'Pacific/Auckland' }))
  const result = await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION, submissionId: accepted.submissionId, idempotencyKey: 'score_saved_ordinary_123456' })
  expect(result).toMatchObject({ status: 'scored', result: { feedbackCodes: ['pass'] } })
  expect(await f.t.run(ctx => ctx.db.get(accepted.submissionId))).toMatchObject({ assistanceSnapshot: { state: 'unassisted', substantiveHintUsedAt: null } })
  expect((await f.facts()).find(row => row.fact.kind === 'independent_claim_v2')?.fact).toMatchObject({ firstIndependentTimezone: 'America/Toronto', firstIndependentLocalDate: '2027-03-07' })
})

test('test-only assistance is gated before an old help replay returns its content', async () => {
  const f = await ordinaryFixture()
  await f.t.run(ctx => ctx.db.patch(f.f.studySessionId, { substantiveHintUsedAt: NOW, revision: 2 }))
  const basisAttemptId = await f.t.run(ctx => ctx.db.insert('masteryAttempts', { userId: OWNER.tokenIdentifier,
    objectiveId: f.f.capability.objectiveId, blueprintRevisionId: f.f.capability.blueprintRevisionId, attemptedAt: NOW, idempotencyKey: 'test-only-basis' }))
  await f.t.run(async ctx => {
    const row = (await ctx.db.get(f.opportunityId))!
    if (row.contextPins.kind !== 'session') throw new Error('Expected session')
    await ctx.db.patch(row._id, { contextPins: { ...row.contextPins, sessionRevision: 2 }, purpose: { kind: 'retained_transfer', basisAttemptId,
      clock: measurementClock(syntheticProtocol(), { at: NOW, eventId: basisAttemptId }, 'America/Toronto', 7) } })
  })
  await expect(f.owner.mutation(api.learnV2Mastery.recordAssistanceUse, { studySessionId: f.f.studySessionId,
    expectedSessionRevision: 2, kind: 'substantive_hint' })).rejects.toThrow(/test_open|before sealing/)
  expect(await f.t.run(ctx => ctx.db.get(f.f.studySessionId))).toMatchObject({ substantiveHintUsedAt: NOW, revision: 2 })
})

test.each(['numeric', 'ordered'] as const)('sealed %s checks use their private deterministic key without a provider', async kind => {
  const f = await fixture()
  policy.scoring = true
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected model') }))
  await f.t.run(async ctx => {
    for (const id of f.f.itemIds) {
      const item = (await ctx.db.get(id))!
      await ctx.db.patch(id, { responseSpec: kind === 'numeric' ? { kind, version: 'response.v1', unit: 'm' } : { kind, version: 'response.v1', maxEntries: 3 } })
      await ctx.db.patch(item.scoringSpecId!, { payload: kind === 'numeric' ? { kind, expected: 10, unit: 'm', absoluteTolerance: 0.1, relativeTolerance: 0, normalizationVersion: 'normalization.v1' }
        : { kind, expected: ['first', 'second'], normalizationVersion: 'normalization.v1' } })
    }
  })
  await f.admitted()
  const response = await acceptFixtureCheck(f, (await f.opportunities())[0]!._id,
    kind === 'numeric' ? { kind, value: 10.05, unit: 'm' } : { kind, entries: ['first', 'second'] })
  expect(await response.score()).toMatchObject({ status: 'scored', result: { scorePercent: 100 } })
  expect(fetch).not.toHaveBeenCalled()
})


test('scheduling an ordinary retained original links an existing unresolved v2 claim once, even after a miss', async () => {
  const f = await ordinaryFixture()
  vi.stubGlobal('fetch', vi.fn(async () => modelReply()))
  const result = await f.owner.action(api.learnV2Mastery.submitMasteryAttempt, f.request)
  if (result.status !== 'completed') throw new Error('Expected Independent')
  vi.setSystemTime(NOW + 9 * 86_400_000)
  const originalId = await f.t.run(async ctx => {
    const { _id, _creationTime, submissionId: _submission, scoringJobId: _job, authoritativeAttemptId: _attempt, ...row } = (await ctx.db.get(f.opportunityId))!
    const clock = measurementClock(syntheticProtocol(), { at: NOW, eventId: result.attemptId }, 'America/Toronto', 7)
    const id = await ctx.db.insert('learnAssessmentOpportunities', { ...row, delayedCheckId: 'retained-original', createdAt: Date.now(),
      purpose: { kind: 'retained_transfer', basisAttemptId: result.attemptId, clock }, openAt: clock.openAt, closeAt: clock.closeAt, dueAt: clock.dueAt,
      firstSlotEpoch: undefined, phase: 'abandoned', reasonCode: 'missed_window' })
    await registerLearnFirstSlotForOwner(ctx, (await ctx.db.get(id))!, syntheticProtocol().epoch)
    return id
  })
  const rows = await f.facts()
  expect(rows.filter(row => row.fact.kind === 'independent_claim_v2')).toHaveLength(1)
  expect(rows.filter(row => row.fact.kind === 'first_slot_link')).toHaveLength(1)
  expect(rows.find(row => row.fact.kind === 'first_slot_link')?.fact).toMatchObject({ slot: { firstCheckOpportunityId: originalId, linkedAt: Date.now() } })
  await f.t.run(async ctx => registerLearnFirstSlotForOwner(ctx, (await ctx.db.get(originalId))!, syntheticProtocol().epoch))
  expect((await f.facts()).filter(row => row.fact.kind === 'first_slot_link')).toHaveLength(1)
})

test('new scoring cannot commit a raw job-less verdict or downgrade a sealed opportunity when the capability is off', async () => {
  const f = await ordinaryFixture()
  const raw = { tokenIdentifier: OWNER.tokenIdentifier, ...f.request, scorerVerdict: { scorerVersion: 'learn-v2.mastery-scorer.v1',
    criterionResults: [{ key: 'rule', awarded: true }], misconceptionTags: [], verifierVersions: ['synthetic.verifier.v1'] } }
  await expect(f.owner.mutation(internal.learnV2Mastery.recordMasteryAttempt, raw)).rejects.toThrow('verified execution receipt required')
  policy.scoring = false
  await expect(f.owner.mutation(internal.learnV2Mastery.recordMasteryAttempt, raw)).rejects.toThrow('verified execution receipt required')
  await expect(f.owner.action(api.learnV2Mastery.submitMasteryAttempt, f.request)).rejects.toThrow('verified execution receipt required')
})

test('assisted preservation of Independent creates no new claim', async () => {
  const f = await ordinaryFixture()
  await seedIndependent(f)
  vi.stubGlobal('fetch', vi.fn(async () => modelReply()))
  const delivered = await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.f.studySessionId, idempotencyKey: 'assisted_independent_teaching' })
  expect(delivered.admission.status).toBe('authorized')
  expect(delivered.value).not.toBeNull()
  expect(await f.owner.action(api.learnV2Mastery.submitMasteryAttempt, f.request)).toMatchObject({ status: 'completed', state: 'independent' })
  expect((await f.facts()).filter(row => row.fact.kind === 'independent_claim_v2')).toHaveLength(0)
})

async function calibrationFixture() {
  const f = await ordinaryFixture()
  const old = (await f.t.run(ctx => ctx.db.get(f.opportunityId)))!
  if (old.assessmentPins.kind !== 'session_application') throw new Error('Expected ordinary pins')
  await f.t.run(async ctx => {
    await ctx.db.patch(f.f.capability.learningVoidId, { status: 'calibration' })
    await ctx.db.insert('learnObjectiveSources', { userId: OWNER.tokenIdentifier, objectiveId: f.f.capability.objectiveId, sourceSnapshotId: f.f.sourceSnapshotId, coverage: 'strong' })
    await ctx.db.patch(f.opportunityId, { purpose: { kind: 'calibration' }, contextPins: { kind: 'calibration', origin: 'today' },
      assessmentPins: { kind: 'calibration', caseId: old.assessmentPins.kind === 'session_application' ? old.assessmentPins.caseId : '' as Id<'learnAssessmentCases'>,
        promptDigest: old.assessmentPins.kind === 'session_application' ? old.assessmentPins.promptDigest : HASH,
        assessmentContractVersion: old.assessmentContractVersion, assessmentContractDigest: old.assessmentContractDigest, supportManifestDigest: HASH } })
  })
  const args = { blueprintRevisionId: f.f.capability.blueprintRevisionId, objectiveId: f.f.capability.objectiveId,
    expectedBlueprintRecordRevision: 1, expectedVoidRevision: 1, response: 'A retained calibration answer.', confidence: 4, idempotencyKey: 'calibration:legacy:key' }
  return { ...f, calibrationArgs: args }
}

test('calibration compatibility seals the answer before an unavailable scorer and rejects a raw score commit', async () => {
  const f = await calibrationFixture()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected provider') }))
  const args = { blueprintRevisionId: f.f.capability.blueprintRevisionId, objectiveId: f.f.capability.objectiveId,
    expectedBlueprintRecordRevision: 1, expectedVoidRevision: 1, response: 'A retained calibration answer.', confidence: 4, idempotencyKey: 'calibration:legacy:key' }
  expect(await f.owner.action(api.learnV2MapCalibration.submitCalibrationAttempt, args)).toMatchObject({ status: 'retryable_failure' })
  expect(await f.t.run(ctx => ctx.db.query('learnResponseBodies').take(8))).toMatchObject([{ payload: { text: args.response } }])
  expect(await f.t.run(ctx => ctx.db.query('masteryAttempts').take(8))).toHaveLength(0)
  await expect(f.owner.mutation(internal.learnV2MapCalibration.recordCalibrationAttempt, { tokenIdentifier: OWNER.tokenIdentifier,
    ...args, serverScorePercent: 100, usedHint: false, usedReveal: false, rubricVersion: 'learn-v2.assessment.v1' })).rejects.toThrow('verified execution receipt required')
  expect(fetch).not.toHaveBeenCalled()
})


test('a verified calibration execution preserves its baseline request and numerical result', async () => {
  const f = await calibrationFixture()
  const base = policy.scorer as { registry: Awaited<ReturnType<typeof createLearnScorerRegistry>>, saved: Awaited<ReturnType<typeof sealLearnScorerConfiguration>> }
  const snapshot = JSON.stringify({ baseline: 'learn-v2.calibration-score.v1', requestedModel: 'synthetic/model', threshold: 80 })
  const configurationDigest = await scorerDigest(snapshot)
  const saved = { binding: { ...base.saved.binding, configurationId: 'synthetic.calibration', scorerVersion: 'learn-v2.calibration-scorer.v1', configurationDigest },
    frozenConfiguration: { digest: configurationDigest, snapshot } }
  policy.scorer = { saved, registry: { ...base.registry, verifySaved: async (candidate: typeof saved) => {
    if (scorerCanonicalJson(candidate) !== scorerCanonicalJson(saved)) throw new Error('Unregistered calibration fixture')
    return saved
  } } }
  await f.t.run(ctx => ctx.db.patch(f.opportunityId, { scoringBinding: saved.binding }))
  const network = vi.fn<typeof fetch>(async () => modelReply())
  vi.stubGlobal('fetch', network)
  const result = await f.owner.action(api.learnV2MapCalibration.submitCalibrationAttempt, f.calibrationArgs)
  expect(result.status, JSON.stringify(result)).toBe('scored')
  const request = JSON.parse(String(network.mock.calls[0]![1]?.body))
  expect(request.model).toBe('synthetic/model')
  expect(request.temperature).toBe(0)
  expect(request.max_tokens).toBe(2000)
  expect(request.response_format.json_schema.name).toBe('learn_v2_calibration_score')
  expect(JSON.parse(request.messages[1].content)).toMatchObject({ contract: 'learn-v2.calibration-score.v1', learnerResponse: f.calibrationArgs.response })
  const attempts = await f.t.run(ctx => ctx.db.query('masteryAttempts').take(8))
  expect(attempts).toHaveLength(1)
  expect(attempts[0]).toMatchObject({ kind: 'calibration', serverScorePercent: 100, masteryStateAfter: 'provisionally_known', acceptedAt: NOW })
  expect((await f.facts()).filter(row => row.fact.kind === 'independent_claim_v2')).toHaveLength(0)
  expect((await f.events()).filter(row => row.eventType === 'retained' || row.eventType === 'representative_pass')).toHaveLength(0)
})


test('later confirmed pre-seal contamination preserves acceptance but excludes score events and mastery', async () => {
  const f = await fixture()
  policy.scoring = true
  await seedIndependent(f)
  await f.admitted()
  await f.work()
  const day7 = (await f.opportunities()).find(row => row.horizonDays === 7)!
  vi.setSystemTime(day7.openAt)
  await f.work()
  const response = await acceptFixtureCheck(f, day7._id)
  await f.owner.mutation(integrity, { submissionId: response.accepted.submissionId, effectiveAt: response.accepted.acceptedAt })
  expect(await response.score()).toMatchObject({ status: 'scored', result: { scorePercent: 100, feedbackCodes: ['excluded_result'] } })
  expect(await f.t.run(ctx => ctx.db.get(response.accepted.submissionId))).toMatchObject({ currentEligibility: 'excluded', assistanceSnapshot: { state: 'unassisted' } })
  expect((await f.t.run(ctx => ctx.db.query('masteryRecords').take(8)))[0]).toMatchObject({ state: 'independent', recordRevision: 1 })
  expect((await f.events()).map(row => row.eventType)).toEqual(['delayed_check_eligible', 'delayed_check_attempt'])
  expect((await f.facts()).find(row => row.fact.kind === 'score')?.fact).toMatchObject({ snapshot: { validityStatus: 'excluded', measurementEligible: false, masteryEligible: false } })
})
