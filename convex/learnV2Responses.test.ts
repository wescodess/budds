/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { makeFunctionReference, type FunctionArgs } from 'convex/server'
import { v } from 'convex/values'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import { action, mutation, query } from './_generated/server'
import schema from './schema'
import { requireAuth } from './lib/auth'
import { authorizeLearnResponseAssistanceForOwner, recordLearnResponseIntegrityForOwner } from './lib/learnV2Responses'
import * as facts from './lib/learnV2MeasurementFacts'
import {
  authorizeAssistanceArgs, assistanceAuthorizationValidator, LEARN_V2_PUBLIC_API_VERSION,
  acceptMasterySubmissionArgs,
  type LearnV2AssistanceAuthorization,
} from './lib/learnV2PublicContract'
import {
  LEARN_V2_RESPONSE_CONTRACT_VERSION, LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION, LEARN_V2_RESPONSE_TERMINALIZATION_VERSION,
  type LearnResponseReceipt,
} from '../shared/learn-v2-responses'
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
const help = makeFunctionReference<'mutation', FunctionArgs<typeof api.learnV2Assistance.authorizeAssistance>, LearnV2AssistanceAuthorization>('responseFixture:help')
const integrity = makeFunctionReference<'mutation', { submissionId: string, kind: 'evidence_unavailable' | 'pre_seal_contamination' | 'body_purged', effectiveAt: number }, string | null>('responseFixture:integrity')
const watermark = makeFunctionReference<'query'>('responseFixture:watermark')
const badFact = makeFunctionReference<'mutation', { assignmentId: string }, null>('responseFixture:badFact')
const failedScoring = makeFunctionReference<'action', FunctionArgs<typeof api.learnV2Mastery.acceptMasterySubmission>, null>('responseFixture:failedScoring')

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
  const t = convexTest(schema, { ...modules, './responseFixture.ts': async () => ({
    failedScoring: action({ args: acceptMasterySubmissionArgs, returns: v.null(), handler: async (ctx, args) => {
      await ctx.runMutation(api.learnV2Mastery.acceptMasterySubmission, args)
      throw new Error('injected provider failure after acceptance')
    } }),
    help: mutation({ args: authorizeAssistanceArgs, returns: assistanceAuthorizationValidator,
      handler: async (ctx, args) => await authorizeLearnResponseAssistanceForOwner(ctx, await requireAuth(ctx), args) }),
    integrity: mutation({ args: { submissionId: v.id('learnResponses'), kind: v.union(v.literal('evidence_unavailable'), v.literal('pre_seal_contamination'), v.literal('body_purged')), effectiveAt: v.number() },
      returns: v.union(v.id('learnResponseIntegrityEvents'), v.null()), handler: async (ctx, args) => await recordLearnResponseIntegrityForOwner(ctx, await requireAuth(ctx), { ...args, reasonCode: 'test_integrity', policyVersion: 'integrity.v1' }) }),
    watermark: query({ args: {}, handler: async ctx => await facts.readLearnMeasurementWatermarkSnapshot(ctx, await requireAuth(ctx)) }),
    badFact: mutation({ args: { assignmentId: v.id('learnMeasurementAssignments') }, returns: v.null(), handler: async (ctx, args) => {
      const assignment = (await ctx.db.get(args.assignmentId))!
      await ctx.db.patch(assignment._id, { exclusionReasons: ['should_roll_back'] })
      await facts.appendLearnMeasurementFact(ctx, await requireAuth(ctx), { epoch: assignment.epoch, learningVoidId: assignment.learningVoidId,
        occurredAt: NOW, fact: { kind: 'enrollment', assignmentId: assignment._id, recordRevision: NaN, status: assignment.status,
          snapshot: { epoch: assignment.epoch, baselineSha: 'a'.repeat(40), cohortVersion: 'cohort.v1', flow: 'v2_today', entryPoint: 'today', depth: 'working',
            protocolVersion: null, enrollmentAt: null, timezone: null, anchorAt: null, anchorKind: null, historyStatus: 'unknown', familyId: null, familyRevision: null,
            familyValidationStatus: 'unknown', equivalenceVersion: null, allocationOrder: null, assignedDay7: false, assignedDay30: false, sourceCoverage: 'unknown' } } })
      return null
    } }),
  }) })
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

function accepted(result: LearnResponseReceipt) {
  expect(result.kind).toBe('accepted')
  if (result.kind !== 'accepted') throw new Error(`Response rejected: ${result.reasonCode}`)
  return result
}

async function ledger(t: Awaited<ReturnType<typeof fixture>>['t']) {
  return await t.run(async ctx => ({ responses: await ctx.db.query('learnResponses').take(8), bodies: await ctx.db.query('learnResponseBodies').take(8),
    receipts: await ctx.db.query('learnResponseCommandReceipts').take(16), facts: await ctx.db.query('learnMeasurementReportFacts').take(8),
    watermark: await ctx.db.query('learnMeasurementSourceWatermarks').unique(), attempts: await ctx.db.query('masteryAttempts').take(8),
    mastery: await ctx.db.query('masteryRecords').take(8) }))
}

describe('registered immutable response commands', () => {
  test.each(['same', 'different'] as const)('serializes %s-key races on a formative slot', async mode => {
    const f = await fixture()
    const [first, second] = await Promise.all([f.owner.mutation(api.learnV2Responses.acceptResponse, f.request),
      f.owner.mutation(api.learnV2Responses.acceptResponse, { ...f.request, idempotencyKey: mode === 'same' ? KEY : KEY + '_other' })])
    accepted(first)
    if (mode === 'same') expect(second).toEqual(first)
    else expect(second).toMatchObject({ kind: 'rejected', reasonCode: 'already_accepted' })
    const state = await ledger(f.t)
    expect(state.responses).toHaveLength(1)
    expect(state.bodies).toHaveLength(1)
    expect(state.bodies[0]?.payload).toEqual(f.response.payload)
    expect(state.attempts).toEqual([])
    expect(state.mastery).toEqual([])
  })

  test('recovers a lost acceptance response and rejects changed payloads without replacing the answer', async () => {
    const f = await fixture()
    const original = accepted(await f.owner.mutation(api.learnV2Responses.acceptResponse, f.request))
    expect(await f.owner.mutation(api.learnV2Responses.acceptResponse, f.request)).toEqual(original)
    expect(await f.owner.mutation(api.learnV2Responses.acceptResponse, { ...f.request, response: { ...f.response, payload: { kind: 'text', text: 'Changed answer' } } })).toMatchObject({ kind: 'rejected', reasonCode: 'idempotency_conflict' })
    const recovered = await f.owner.query(api.learnV2Responses.getResponseState, { version: LEARN_V2_PUBLIC_API_VERSION, target: f.target })
    expect(recovered).toMatchObject({ state: 'accepted', work: { submissionId: original.submissionId, body: { bodyAvailability: 'available', payload: f.response.payload }, result: null } })
    expect((await ledger(f.t)).responses).toHaveLength(1)
  })

  test('retains a sealed body when scoring is unavailable and creates no mastery', async () => {
    const f = await fixture()
    const result = accepted(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: f.submission }))
    const opportunity = await f.t.run(ctx => ctx.db.get(f.assessmentTarget.assessmentOpportunityId))
    expect(opportunity).toMatchObject({ phase: 'submitted_sealed', submissionId: result.submissionId })
    const job = opportunity?.scoringJobId && await f.t.run(ctx => ctx.db.get(opportunity.scoringJobId!))
    expect(job).toMatchObject({ submissionId: result.submissionId, status: 'queued', providerEnabled: false })
    expect(await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION, submissionId: result.submissionId, idempotencyKey: KEY })).toMatchObject({ status: 'disabled' })
    const state = await ledger(f.t)
    expect(state.responses[0]).toMatchObject({ responseContextVersion: 'learn-v2.response-context.v1', flow: 'today', measurementContext: { status: 'not_enrolled' } })
    expect(state.bodies[0]?.payload).toEqual(f.response.payload)
    expect(state.attempts).toEqual([])
    expect(state.mastery).toEqual([])
  })

  test.each(['same', 'different'] as const)('seals one assessment across %s-key races', async mode => {
    const f = await fixture()
    const results = await Promise.all([f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: f.submission }),
      f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { ...f.submission, idempotencyKey: mode === 'same' ? KEY : KEY + '_other' } })])
    accepted(results[0]!)
    if (mode === 'same') expect(results[1]).toEqual(results[0])
    else expect(results[1]).toMatchObject({ kind: 'rejected', reasonCode: 'already_accepted' })
    expect((await ledger(f.t)).responses).toHaveLength(1)
  })

  test('rejects another issuer, missing ownership, and an account deletion tombstone', async () => {
    const f = await fixture()
    const before = await ledger(f.t)
    await expect(f.t.withIdentity(FOREIGN).mutation(api.learnV2Responses.acceptResponse, f.request)).rejects.toThrow('Learn access denied')
    await expect(f.t.mutation(api.learnV2Responses.acceptResponse, f.request)).rejects.toThrow('Unauthenticated')
    expect(await ledger(f.t)).toEqual(before)
    await f.t.run(ctx => ctx.db.insert('accountDeletionJobs', { userId: OWNER.tokenIdentifier, status: 'active', phase: 'documents', startedAt: NOW, updatedAt: NOW }))
    await expect(f.owner.mutation(api.learnV2Responses.acceptResponse, f.request)).rejects.toThrow('Account deletion is in progress')
  })

  test('keeps the new capability disabled without a runtime switch', async () => {
    const f = await fixture()
    policy.responses = false
    expect(await f.owner.mutation(api.learnV2Responses.acceptResponse, f.request)).toMatchObject({ kind: 'rejected', reasonCode: 'disabled' })
    expect(await f.owner.query(api.learnV2Responses.getResponseState, { version: LEARN_V2_PUBLIC_API_VERSION, target: f.target })).toMatchObject({ status: 'disabled' })
    expect((await ledger(f.t)).responses).toEqual([])
  })
})

describe('final bundle and scope authority', () => {
  test.each([false, true].flatMap(teachBack => [false, true].map(application => ({ teachBack, application }))))(
    'uses each delivered confidence pin: teach-back=$teachBack application=$application', async pins => {
      const f = await fixture()
      await f.t.run(async ctx => {
        await ctx.db.patch(f.target.responseSlotId, { confidenceRequested: pins.teachBack })
        await ctx.db.patch(f.assessmentTarget.assessmentOpportunityId, { deliveryPins: { version: LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION, confidenceRequested: pins.application } })
      })
      const bundle = { version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: KEY,
        teachBack: { ...f.response, ...(pins.teachBack ? { confidence: 2 } : {}) },
        application: { ...f.response, target: f.assessmentTarget, ...(pins.application ? { confidence: 4 } : {}) } }
      const result = accepted(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: bundle }))
      expect(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: bundle })).toEqual(result)
      const state = await ledger(f.t)
      expect(state.responses).toHaveLength(2)
      expect(state.bodies).toHaveLength(2)
      expect(state.receipts).toHaveLength(1)
      expect(state.attempts).toEqual([])
    },
  )

  test.each(['teachBack', 'application'] as const)('rejects wrong %s confidence atomically', async entry => {
    const f = await fixture()
    const bundle = { version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: KEY, teachBack: f.response, application: f.submission.response }
    const wrong = entry === 'teachBack' ? { ...bundle, teachBack: { ...f.response, confidence: 2 } }
      : { ...bundle, application: { ...f.response, target: f.assessmentTarget } }
    expect(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: wrong })).toMatchObject({ kind: 'rejected' })
    const state = await ledger(f.t)
    expect(state.responses).toEqual([])
    expect(state.bodies).toEqual([])
    expect(state.receipts).toHaveLength(1)
    expect(state.receipts[0]?.result.kind).toBe('rejected')
  })

  test('bounds the existing final bundle to two responses and 64 KiB', async () => {
    const f = await fixture()
    const bundle = { version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: KEY,
      teachBack: f.response, application: f.submission.response }
    await expect(f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { ...bundle, third: f.response } } as never)).rejects.toThrow()
    const payload = { kind: 'text' as const, text: '漢'.repeat(12000) }
    await expect(f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { ...bundle,
      teachBack: { ...bundle.teachBack, payload }, application: { ...bundle.application, payload } } })).rejects.toThrow('Invalid Learn request')
    expect((await ledger(f.t)).responses).toEqual([])
  })

  test('does not accept a formative slot as an assessment or combine another stage into the final bundle', async () => {
    const f = await fixture()
    await expect(f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: f.request })).rejects.toThrow('Invalid Learn request')
    await expect(f.owner.mutation(api.learnV2Responses.acceptResponse, f.submission)).rejects.toThrow('Invalid Learn request')
    await f.t.run(ctx => ctx.db.patch(f.target.responseSlotId, { stage: 'practice' }))
    expect(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: {
      version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: KEY, teachBack: f.response, application: f.submission.response,
    } })).toMatchObject({ kind: 'rejected', reasonCode: 'pins_mismatch' })
    expect((await ledger(f.t)).responses).toEqual([])
  })

  test('does not admit measurement through an unrelated owned assignment', async () => {
    const f = await fixture('measurement')
    await f.t.run(async ctx => {
      const otherObjective = await ctx.db.insert('learnObjectives', { userId: OWNER.tokenIdentifier, blueprintRevisionId: f.capability.blueprintRevisionId, title: 'Unrelated', order: 2 })
      await ctx.db.patch(f.f.rows.learnMeasurementAssignments, { objectiveId: otherObjective })
    })
    expect(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: f.submission })).toMatchObject({ kind: 'rejected', reasonCode: 'pins_mismatch' })
    expect((await ledger(f.t)).responses).toEqual([])
  })

  test('keeps standalone diagnostic authority and its tighter payload ceiling', async () => {
    const f = await fixture()
    const slot = await f.t.run(async ctx => {
      const activity = (await ctx.db.get(f.f.activityId))!
      await ctx.db.patch(f.f.threadId, { currentActivityId: activity._id })
      const exposure = await ctx.db.insert('learnAssessmentExposures', { ...f.f.base, threadId: f.f.threadId, activityId: activity._id,
        purpose: 'practice', status: 'granted', projectionDigest: HASH, deliveryReceiptHash: HASH, serverTime: NOW - 1,
        policyVersion: 'delivery.v1', provenanceVersion: 'delivery.v1' })
      return await ctx.db.insert('learnResponseSlots', { ...f.f.base, scopeKind: 'standalone', threadId: f.f.threadId, activityId: activity._id,
        threadRevision: 1, activityRevision: 1, activityContractVersion: activity.contractVersion, evidenceStatus: 'available', stage: 'diagnostic',
        slotKey: 'diagnostic.v1', blockId: 'diagnostic', promptDigest: HASH, promptRevision: 1, responseFormatVersion: 'text.v1',
        confidenceRequested: false, deliveryExposureId: exposure, revision: 1, status: 'open' })
    })
    const request = { ...f.request, response: { ...f.response, target: { responseSlotId: slot } } }
    expect(await f.owner.mutation(api.learnV2Responses.acceptResponse, { ...request, response: { ...request.response, payload: { kind: 'text', text: '漢'.repeat(4000) } } })).toMatchObject({ kind: 'rejected', reasonCode: 'payload_too_large' })
    const result = accepted(await f.owner.mutation(api.learnV2Responses.acceptResponse, { ...request, idempotencyKey: KEY + '_valid' }))
    const response = await f.t.run(ctx => ctx.db.get(result.submissionId))
    expect(response).toMatchObject({ scopeKind: 'standalone', threadId: f.f.threadId, validitySnapshot: { masteryEligible: false, measurementEligible: false } })
    expect(response).not.toHaveProperty('objectiveId')
    expect((await ledger(f.t)).attempts).toEqual([])
  })

  test.each(['stale', 'source', 'grant', 'timing'] as const)('retains only a safe rejection for %s validation', async failure => {
    const f = await fixture()
    if (failure === 'stale') await f.t.run(ctx => ctx.db.patch(f.target.responseSlotId, { revision: 2 }))
    if (failure === 'source') await f.t.run(ctx => ctx.db.patch(f.f.sourceSnapshotId, { evidencePurgedAt: NOW }))
    if (failure === 'grant') await f.t.run(ctx => ctx.db.patch(f.f.rows.learnAssessmentExposures, { status: 'unknown' }))
    if (failure === 'timing') vi.setSystemTime(NOW + 100000)
    const result = failure === 'stale' || failure === 'source'
      ? await f.owner.mutation(api.learnV2Responses.acceptResponse, f.request)
      : await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: f.submission })
    expect(result.kind).toBe('rejected')
    const state = await ledger(f.t)
    expect(state.responses).toEqual([])
    expect(state.bodies).toEqual([])
    expect(state.receipts).toHaveLength(1)
    expect(JSON.stringify(state.receipts)).not.toContain(f.response.payload.text)
    expect(state.receipts[0]).toHaveProperty('expiresAt', Date.now() + 90 * 86400000)
  })
})

describe('terminalization and receipt replay', () => {
  test.each(['slot', 'assessment'] as const)('retains a durable %s terminalization and replays the original reason and time', async kind => {
    const f = await fixture()
    const target = kind === 'slot' ? f.target : f.assessmentTarget
    const request = { version: LEARN_V2_PUBLIC_API_VERSION, target, idempotencyKey: KEY, expectedRevision: 1, reason: 'cancelled' as const }
    const result = await f.owner.mutation(api.learnV2Responses.terminalizeResponse, request)
    expect(result).toMatchObject({ status: 'terminal', target, revision: 2, reason: 'cancelled', terminalizedAt: NOW })
    vi.setSystemTime(NOW + 1000)
    expect(await f.owner.mutation(api.learnV2Responses.terminalizeResponse, { ...request, expectedRevision: 99, reason: 'abandoned' })).toEqual(result)
    const state = await ledger(f.t)
    expect(state.receipts).toHaveLength(1)
    expect(state.receipts[0]).toMatchObject({ commandVersion: LEARN_V2_RESPONSE_TERMINALIZATION_VERSION, learningVoidId: f.f.learningVoidId,
      target, result: { kind: 'terminalized', target, revision: 2, terminalizedAt: NOW } })
    expect(state.receipts[0]).not.toHaveProperty('expiresAt')
    expect(state.responses).toEqual([])
    const acceptance = kind === 'slot' ? await f.owner.mutation(api.learnV2Responses.acceptResponse, f.request)
      : await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: f.submission })
    expect(acceptance).toMatchObject({ kind: 'rejected', reasonCode: 'idempotency_conflict' })
  })

  test('rejects command-key reuse on another target and cannot terminalize accepted work', async () => {
    const f = await fixture()
    const request = { version: LEARN_V2_PUBLIC_API_VERSION, target: f.target, idempotencyKey: KEY, expectedRevision: 1, reason: 'abandoned' as const }
    await f.owner.mutation(api.learnV2Responses.terminalizeResponse, request)
    expect(await f.owner.mutation(api.learnV2Responses.terminalizeResponse, { ...request, target: f.assessmentTarget })).toMatchObject({ status: 'unavailable', reasonCodes: ['idempotency_conflict'] })
    accepted(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { ...f.submission, idempotencyKey: KEY + '_assessment' } }))
    expect(await f.owner.mutation(api.learnV2Responses.terminalizeResponse, { ...request, target: f.assessmentTarget, idempotencyKey: KEY + '_terminal' })).toMatchObject({ status: 'unavailable', reasonCodes: ['already_accepted'] })
  })

  test('anchors both accepted and terminalized Canvas receipts to the Void and thread', async () => {
    const f = await fixture()
    await f.t.run(async ctx => {
      const activity = (await ctx.db.get(f.f.activityId))!
      const canvas = { threadId: f.f.threadId, threadRevision: 1, activityId: activity._id, activityRevision: activity.planRevision,
        planVersion: activity.planVersion, replayVersion: activity.replayVersion, rendererVersion: activity.rendererVersion,
        evaluationVersion: activity.evaluationContract.version, pilotConfigurationVersion: 'synthetic.v1' }
      await ctx.db.patch(f.f.threadId, { authorityKind: 'v2_mission', learningVoidId: f.f.learningVoidId, currentActivityId: activity._id })
      await ctx.db.patch(activity._id, { sessionContentId: f.context.sessionContentId })
      await ctx.db.patch(f.target.responseSlotId, { contextPins: { ...f.context, canvas } })
      await ctx.db.patch(f.assessmentTarget.assessmentOpportunityId, { contextPins: { ...f.context, canvas } })
    })
    accepted(await f.owner.mutation(api.learnV2Responses.acceptResponse, f.request))
    await f.owner.mutation(api.learnV2Responses.terminalizeResponse, { version: LEARN_V2_PUBLIC_API_VERSION, target: f.assessmentTarget,
      expectedRevision: 1, idempotencyKey: KEY + '_terminal', reason: 'cancelled' })
    const state = await ledger(f.t)
    expect(state.receipts).toHaveLength(2)
    for (const receipt of state.receipts) expect(receipt).toMatchObject({ learningVoidId: f.f.learningVoidId, threadId: f.f.threadId })
  })
})

describe('help and acceptance serialization', () => {
  test.each(['open', 'sealed'] as const)('an archived Void denies %s assistance authorization and replay', async phase => {
    const f = await fixture()
    if (phase === 'sealed') accepted(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: f.submission }))
    const request = { version: LEARN_V2_PUBLIC_API_VERSION, ...f.assessmentTarget, kind: 'hint' as const, idempotencyKey: KEY + '_help' }
    expect(await f.owner.mutation(help, request)).toMatchObject({ status: 'authorized' })
    const before = await ledger(f.t)
    await f.owner.mutation(api.learnV2Lifecycle.transitionLearningVoid, { learningVoidId: f.f.learningVoidId,
      status: 'archived', expectedRevision: 1, idempotencyKey: 'archive-assistance' })
    expect(await f.owner.mutation(help, request)).toMatchObject({ status: 'denied', reasonCode: 'unavailable' })
    expect(await f.owner.mutation(help, { ...request, idempotencyKey: KEY + '_new_help' })).toMatchObject({ status: 'denied', reasonCode: 'unavailable' })
    expect(await ledger(f.t)).toEqual(before)
  })

  test('paste and focus observations alone do not remove measurement eligibility', async () => {
    const f = await fixture('measurement')
    accepted(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { ...f.submission,
      response: { ...f.submission.response, instrumentation: { pasteObserved: true, focusLossObserved: true, version: 'observations.v1' } } } }))
    expect((await ledger(f.t)).responses[0]).toMatchObject({ assistanceSnapshot: { state: 'unassisted', pasteObserved: true, focusLossObserved: true },
      validitySnapshot: { measurementEligible: true } })
  })
  test('denied test-only help is not assistance and does not prevent clean measurement acceptance', async () => {
    const f = await fixture('measurement')
    const result = await f.owner.mutation(help, { version: LEARN_V2_PUBLIC_API_VERSION, ...f.assessmentTarget, kind: 'export', idempotencyKey: KEY + '_help' })
    expect(result).toMatchObject({ status: 'denied', reasonCode: 'test_open' })
    accepted(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: f.submission }))
    const state = await ledger(f.t)
    expect(state.responses[0]).toMatchObject({ assistanceSnapshot: { state: 'unassisted' }, validitySnapshot: { status: 'valid', measurementEligible: true, masteryEligible: false },
      measurementContext: { status: 'admitted', assignmentId: f.f.rows.learnMeasurementAssignments, baselineEpoch: 'fixture-epoch' } })
  })

  test('retains actual pre-seal contamination as excluded work', async () => {
    const f = await fixture('measurement')
    await f.t.run(ctx => ctx.db.insert('learnAssessmentExposures', { ...f.f.base, ...f.assessmentTarget,
      purpose: 'teaching', status: 'granted', projectionDigest: HASH, deliveryReceiptHash: 'actual-help', serverTime: NOW,
      policyVersion: 'assistance.v1', provenanceVersion: 'actual_delivery.v1' }))
    accepted(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: f.submission }))
    const state = await ledger(f.t)
    expect(state.responses[0]).toMatchObject({ assistanceSnapshot: { state: 'assisted' }, validitySnapshot: { status: 'excluded', measurementEligible: false, masteryEligible: false } })
    expect(state.bodies).toHaveLength(1)
    expect(state.mastery).toEqual([])
  })

  test.each(['help_first', 'seal_first', 'race'] as const)('freezes assistance for %s ordering', async ordering => {
    const f = await fixture()
    const request = { version: LEARN_V2_PUBLIC_API_VERSION, ...f.assessmentTarget, kind: 'hint' as const, idempotencyKey: KEY + '_help' }
    if (ordering === 'help_first') await f.owner.mutation(help, request)
    if (ordering === 'race') await Promise.all([f.owner.mutation(help, request), f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: f.submission })])
    else accepted(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: f.submission }))
    const before = (await ledger(f.t)).responses[0]!
    if (ordering !== 'race') expect(before.assistanceSnapshot.state).toBe(ordering === 'help_first' ? 'assisted' : 'unassisted')
    expect(await f.owner.mutation(help, request)).toMatchObject({ status: 'authorized' })
    expect((await ledger(f.t)).responses[0]).toEqual(before)
  })
})

describe('atomic scalar report facts', () => {
  test('an archived Void denies integrity writes and replay without changing saved facts', async () => {
    const f = await fixture('measurement')
    const result = accepted(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: f.submission }))
    const request = { submissionId: result.submissionId, kind: 'pre_seal_contamination' as const, effectiveAt: NOW }
    expect(await f.owner.mutation(integrity, request)).toBeTypeOf('string')
    const before = await ledger(f.t)
    await f.owner.mutation(api.learnV2Lifecycle.transitionLearningVoid, { learningVoidId: f.f.learningVoidId,
      status: 'archived', expectedRevision: 1, idempotencyKey: 'archive-integrity' })
    await expect(f.owner.mutation(integrity, request)).rejects.toThrow('Learn access denied')
    await expect(f.owner.mutation(integrity, { ...request, kind: 'body_purged' })).rejects.toThrow('Learn access denied')
    expect(await ledger(f.t)).toEqual(before)
  })

  test('retains pending work across a scoring action failure after the acceptance commit', async () => {
    const f = await fixture('measurement')
    await expect(f.owner.action(failedScoring, { submission: f.submission })).rejects.toThrow('injected provider failure after acceptance')
    const state = await ledger(f.t)
    expect(state.responses).toHaveLength(1)
    expect(state.bodies).toHaveLength(1)
    expect(state.watermark?.sequence).toBe(2)
    expect(state.attempts).toEqual([])
    expect(state.mastery).toEqual([])
    expect(await f.owner.query(api.learnV2Responses.getResponseState, { version: LEARN_V2_PUBLIC_API_VERSION, target: f.assessmentTarget })).toMatchObject({ work: { body: { bodyAvailability: 'available', payload: f.response.payload }, result: null } })
  })
  test('writes enrollment and acceptance facts with one contiguous owner watermark and no replay duplicates', async () => {
    const f = await fixture('measurement')
    const result = accepted(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: f.submission }))
    expect(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: f.submission })).toEqual(result)
    const state = await ledger(f.t)
    expect(state.facts.map(row => row.sequence)).toEqual([1, 2])
    expect(state.facts.map(row => row.fact.kind)).toEqual(['enrollment', 'response'])
    expect(state.watermark).toMatchObject({ sequence: 2, historyCoverage: 'unknown', dueWorkThrough: null, sourceVersion: 'learn-v2.measurement-report-source.v2' })
    expect(await f.owner.query(watermark, {})).toMatchObject({ sequence: 2, historyCoverage: 'unknown', legacyIndependentAudit: { sourceCoverage: 'unknown', unknownCount: null } })
    expect(JSON.stringify(state.facts)).not.toContain(f.response.payload.text)
  })

  test('rolls back every acceptance write if fact persistence fails', async () => {
    const f = await fixture('measurement')
    const before = await ledger(f.t)
    vi.spyOn(facts, 'writeLearnResponseAcceptanceFact').mockRejectedValueOnce(new Error('injected fact failure'))
    await expect(f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: f.submission })).rejects.toThrow('injected fact failure')
    expect(await ledger(f.t)).toEqual(before)
    expect(await f.t.run(ctx => ctx.db.get(f.assessmentTarget.assessmentOpportunityId))).toMatchObject({ phase: 'test_open', revision: 1 })
  })

  test('parses scalar facts before persistence and rolls back the source mutation on NaN', async () => {
    const f = await fixture('measurement')
    await expect(f.owner.mutation(badFact, { assignmentId: f.f.rows.learnMeasurementAssignments })).rejects.toThrow()
    const state = await ledger(f.t)
    expect(state.facts).toEqual([])
    expect(state.watermark).toBeNull()
    expect(await f.t.run(ctx => ctx.db.get(f.f.rows.learnMeasurementAssignments))).toMatchObject({ exclusionReasons: [] })
  })

  test('appends later integrity facts without rewriting the acceptance snapshot', async () => {
    const f = await fixture('measurement')
    const result = accepted(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: f.submission }))
    const before = (await ledger(f.t)).responses[0]!
    const request = { submissionId: result.submissionId, kind: 'pre_seal_contamination' as const, effectiveAt: NOW }
    const event = await f.owner.mutation(integrity, request)
    expect(await f.owner.mutation(integrity, request)).toBe(event)
    const state = await ledger(f.t)
    expect(state.responses[0]?.assistanceSnapshot).toEqual(before.assistanceSnapshot)
    expect(state.responses[0]?.validitySnapshot).toEqual(before.validitySnapshot)
    expect(state.responses[0]?.currentEligibility).toBe('excluded')
    expect(state.watermark?.sequence).toBe(3)
    expect(state.facts[2]?.fact).toMatchObject({ kind: 'integrity', integrityEventId: event, currentEligibility: 'excluded' })
    expect(await f.t.run(ctx => ctx.db.query('learnResponseIntegrityEvents').unique())).toMatchObject({ sequence: 1, sourceFactSequence: 3 })
    await f.owner.mutation(integrity, { ...request, kind: 'body_purged' })
    expect((await ledger(f.t)).bodies).toEqual([])
    expect(await f.owner.query(api.learnV2Responses.getResponseState, { version: LEARN_V2_PUBLIC_API_VERSION, target: f.assessmentTarget })).toMatchObject({ work: { body: { bodyAvailability: 'purged', purgedAt: NOW } } })
  })
})
