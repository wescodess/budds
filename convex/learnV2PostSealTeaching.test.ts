/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { makeFunctionReference, mutationGeneric, queryGeneric, type FunctionArgs, type FunctionReturnType } from 'convex/server'
import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { learnV2CanvasMeasurementApi } from './learnV2ApiAdapters'
import {
  postSealTeachingValidator, practiceAssistanceAuthorizationValidator,
  type LearnV2PostSealTeaching, type LearnV2PracticeAssistanceAuthorization,
} from './lib/learnV2PublicContract'
import {
  LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, LEARN_V2_POST_SEAL_TEACHING_VERSION,
  learnPostSealTeachingSchema, type learnPostSealTeachingSourceSchema, learnAuthorizePracticeAssistanceSchema, type learnPostSealTeachingReferenceSchema,
  learnPracticeAssistanceAuthorizationSchema, projectPostSealTeaching, projectPracticeAssistanceAuthorization,
  type LearnPostSealTeachingContext,
} from '../shared/learn-v2-assessment-disclosure'
import {
  LEARN_V2_ASSESSMENT_PHASES, LEARN_V2_ASSESSMENT_CAPABILITIES_VERSION, LEARN_V2_DELAYED_CHECK_VERSION,
  type LearnAssessmentPhase,
} from '../shared/learn-v2-delayed-check'
import { learnIdSchema, parseLearnContract } from '../shared/learn-v2-responses'
import { LEARN_MEASUREMENT_COLLECTIONS } from '../shared/learn-v2-measurement-storage-manifest'
import { seedMeasurementStorage, STORAGE_CANARIES } from '../tests/fixtures/learn-v2-measurement-storage'
import type { z } from 'zod'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://owner.example|learner', subject: 'learner' }
const FOREIGN = { tokenIdentifier: 'https://foreign.example|learner', subject: 'learner' }
const version = LEARN_V2_POST_SEAL_TEACHING_VERSION
const key = 'practice_help_1234567890'
const disabled = { version, status: 'unavailable', reasonCode: 'disabled' }
const denied = { version, status: 'denied', reasonCode: 'disabled' }
const sealedPhases: readonly LearnAssessmentPhase[] = ['submitted_sealed', 'scoring_pending', 'scored_pass', 'scored_fail', 'retryable_failure', 'reconciliation_required', 'invalid']
const readProjection = makeFunctionReference<'query'>('postSealContractFixture:read')
const authorizeProjection = makeFunctionReference<'mutation'>('postSealContractFixture:authorize')
const rawRead = makeFunctionReference<'query'>('postSealContractFixture:rawRead')
const rawAuthorization = makeFunctionReference<'mutation'>('postSealContractFixture:rawAuthorization')

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

async function fixture() {
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  vi.useFakeTimers()
  vi.setSystemTime(1_800_000_000_001)
  let context: LearnPostSealTeachingContext
  const t = convexTest(schema, { ...modules, './postSealContractFixture.ts': async () => ({
    read: queryGeneric({ args: {}, returns: postSealTeachingValidator, handler: () => projectPostSealTeaching(source, context) }),
    authorize: mutationGeneric({ args: {}, returns: practiceAssistanceAuthorizationValidator,
      handler: () => projectPracticeAssistanceAuthorization({ request: savedRequest, result: authorization }, request, context) }),
    rawRead: queryGeneric({ args: {}, returns: postSealTeachingValidator, handler: () => teaching }),
    rawAuthorization: mutationGeneric({ args: {}, returns: practiceAssistanceAuthorizationValidator, handler: () => authorization }),
  }) })
  for (const identity of [OWNER, FOREIGN]) {
    await t.withIdentity(identity).mutation(api.users.upsertUser, {})
    await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
  }
  const f = await t.run(ctx => seedMeasurementStorage(ctx, OWNER.tokenIdentifier))
  await t.run(async ctx => {
    await ctx.db.patch(f.scope.contextPins.sessionContentId, {
      blueprintRevisionId: f.scope.blueprintRevisionId, studyPlanRevisionId: f.scope.contextPins.studyPlanRevisionId, objectiveId: f.scope.objectiveId,
    })
    await ctx.db.patch(f.rows.learnResponseSlots, { stage: 'practice' })
  })
  const reference = { version, assessmentOpportunityId: f.rows.learnAssessmentOpportunities }
  const target = { responseSlotId: f.rows.learnResponseSlots }
  const request: z.infer<typeof learnAuthorizePracticeAssistanceSchema> = { ...reference, target, expectedRevision: 1, kind: 'hint', idempotencyKey: key }
  const savedRequest = { ...request }
  const citations = [{ sourceRef: 'source_public_1', label: 'Accepted source' }]
  const source: z.infer<typeof learnPostSealTeachingSourceSchema> = { assessmentOpportunityId: reference.assessmentOpportunityId, submissionId: f.rows.learnResponses,
    feedback: { text: 'FEEDBACK_CANARY', citations }, lesson: { paragraphs: ['LESSON_CANARY'], citations },
    practice: { ...target, revision: 1, prompt: 'PRACTICE_CANARY' } }
  const authorization: LearnV2PracticeAssistanceAuthorization = { ...reference, status: 'authorized', target, revision: 1,
    authorizationId: f.rows.learnAssessmentExposures, deliveredAt: f.base.createdAt + 1, content: { kind: 'hint', text: 'HINT_CANARY' } }
  const teaching: LearnV2PostSealTeaching = { ...reference, status: 'available', feedback: source.feedback, lesson: source.lesson, practice: source.practice }
  function setPhase(phase: LearnAssessmentPhase, mask = 31, validScore = true) {
    const sealed = sealedPhases.includes(phase)
    context = {
      disclosure: { version: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, owned: true, accessAvailable: true, evidenceAvailable: true, pinsMatch: true,
        lifecycle: { version: LEARN_V2_DELAYED_CHECK_VERSION, assessmentOpportunityId: reference.assessmentOpportunityId,
          revision: 1, purpose: { kind: 'measurement_cold', assignmentId: f.rows.learnMeasurementAssignments, protocolVersion: 'fixture.v1' }, phase,
          submissionId: sealed ? f.rows.learnResponses : null, acceptedAt: sealed ? f.base.createdAt : null,
          deliveryGrantId: sealed || phase === 'test_open' ? f.rows.learnAssessmentExposures : null,
          authoritativeAttemptId: phase === 'scored_pass' || phase === 'scored_fail' ? learnIdSchema<'masteryAttempts'>().parse('attempt') : null, checkSequence: 0 },
        grant: { policyVersion: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, deliveryGrantId: f.rows.learnAssessmentExposures,
          assessmentOpportunityId: reference.assessmentOpportunityId, projectionDigest: 'b'.repeat(64), grantedAt: f.base.createdAt, status: 'granted',
          identity: { kind: 'measurement', itemId: f.rows.learnMeasurementItems, itemRevision: 1, promptDigest: 'a'.repeat(64) } } },
      capabilities: { version: LEARN_V2_ASSESSMENT_CAPABILITIES_VERSION, status: 'available', reasonCodes: [],
        canDeliver: !!(mask & 1), canSubmit: !!(mask & 2), canRequestAssistance: !!(mask & 4), canTeachSeparateCase: !!(mask & 8), canReadFeedback: !!(mask & 16) },
      validScore, publicationAllowed: true, practiceBinding: { assessmentOpportunityId: reference.assessmentOpportunityId, submissionId: f.rows.learnResponses, target, revision: 1,
        stage: 'practice', owned: true, caseRelation: 'separate_case', reservedCase: 'no' },
    }
    return context
  }
  setPhase('scored_fail')
  return { t, f, reference, target, source, request, savedRequest, authorization, teaching, setPhase,
    get context() { return context } }
}

async function snapshot(f: Awaited<ReturnType<typeof fixture>>) {
  const tables = [...LEARN_MEASUREMENT_COLLECTIONS, 'masteryAttempts', 'masteryRecords', 'learnJobs', 'studySessions'] as const
  return f.t.run(async ctx => Promise.all(tables.map(table => ctx.db.query(table).take(8))))
}

describe('post-seal teaching disclosure contract through Convex', () => {
  test.each(LEARN_V2_ASSESSMENT_PHASES)('gates %s across all 32 capability combinations and score validity states', async phase => {
    const f = await fixture()
    for (let mask = 0; mask < 32; mask++) for (const valid of [false, true]) {
      f.setPhase(phase, mask, valid)
      const read = await f.t.query(readProjection, {})
      const help = await f.t.mutation(authorizeProjection, {})
      if (!sealedPhases.includes(phase)) {
        expect(read).toEqual({ version, status: 'unavailable', reasonCode: 'not_sealed' })
        expect(help).toEqual({ version, status: 'denied', reasonCode: 'not_sealed' })
      }
      else {
        const feedbackAllowed = valid && !!(mask & 16) && ['scored_pass', 'scored_fail'].includes(phase)
        expect(read).toEqual({ ...f.reference, status: 'available', feedback: feedbackAllowed ? f.source.feedback : null,
          lesson: feedbackAllowed && phase === 'scored_fail' ? f.source.lesson : null, practice: mask & 8 ? f.source.practice : null })
        expect(help).toEqual(mask & 8 ? f.authorization : { version, status: 'denied', reasonCode: 'disclosure_unknown' })
      }
      expect(await f.t.query(readProjection, {})).toEqual(read)
      expect(await f.t.mutation(authorizeProjection, {})).toEqual(help)
      expect(JSON.stringify(read)).not.toMatch(/HINT_CANARY|WORKED_EXAMPLE_CANARY/)
    }
  })

  test.each(['disabled', 'unavailable'] as const)('capability status %s blocks content in every phase', async status => {
    const f = await fixture()
    for (const phase of LEARN_V2_ASSESSMENT_PHASES) {
      const context = f.setPhase(phase, 0)
      context.capabilities.status = status
      expect((await f.t.query(readProjection, {})).status).toBe('unavailable')
      expect((await f.t.mutation(authorizeProjection, {})).status).toBe('denied')
    }
  })

  test('invalid without an accepted submission remains sealed off despite forged capabilities', async () => {
    const f = await fixture()
    const lifecycle = f.context.disclosure.lifecycle
    lifecycle.phase = 'invalid'; lifecycle.submissionId = null; lifecycle.acceptedAt = null; lifecycle.authoritativeAttemptId = null
    expect(await f.t.query(readProjection, {})).toEqual({ version, status: 'unavailable', reasonCode: 'not_sealed' })
    expect(await f.t.mutation(authorizeProjection, {})).toEqual({ version, status: 'denied', reasonCode: 'not_sealed' })
  })

  test.each(['owned', 'accessAvailable', 'evidenceAvailable', 'pinsMatch'] as const)('rechecks %s before read and authorization replay', async field => {
    const f = await fixture()
    expect((await f.t.query(readProjection, {})).status).toBe('available')
    expect((await f.t.mutation(authorizeProjection, {})).status).toBe('authorized')
    f.context.disclosure[field] = false
    expect((await f.t.query(readProjection, {})).status).toBe('unavailable')
    expect((await f.t.mutation(authorizeProjection, {})).status).toBe('denied')
  })

  test('requires publication approval, the exact grant and source opportunity/submission', async () => {
    const f = await fixture()
    for (const change of [
      () => { f.context.publicationAllowed = false },
      () => { f.context.disclosure.grant = null },
      () => { f.context.disclosure.grant!.assessmentOpportunityId = learnIdSchema<'learnAssessmentOpportunities'>().parse('wrong') },
      () => { f.context.disclosure.grant!.deliveryGrantId = learnIdSchema<'learnAssessmentExposures'>().parse('wrong') },
    ]) {
      f.setPhase('scored_fail'); change()
      expect((await f.t.query(readProjection, {})).status).toBe('unavailable')
      expect((await f.t.mutation(authorizeProjection, {})).status).toBe('denied')
    }
    f.setPhase('scored_fail')
    for (const field of ['assessmentOpportunityId', 'submissionId']) {
      const previous = Reflect.get(f.source, field)
      Reflect.set(f.source, field, 'wrong')
      expect((await f.t.query(readProjection, {})).status).toBe('unavailable')
      Reflect.set(f.source, field, previous)
    }
  })

  test('practice requires owned, pinned, separate, nonreserved practice lineage on read and replay', async () => {
    const f = await fixture()
    const changes = [
      { caseRelation: 'check_case' }, { caseRelation: 'sibling_form' }, { caseRelation: 'unknown' },
      { reservedCase: 'yes' }, { reservedCase: 'unknown' }, { owned: false }, { revision: 2 },
      { target: { responseSlotId: 'other-slot' } }, { assessmentOpportunityId: 'other-check' }, { submissionId: 'other-answer' },
    ]
    for (const change of changes) {
      f.setPhase('scoring_pending')
      Object.assign(f.context.practiceBinding!, change)
      expect((await f.t.query(readProjection, {})).practice).toBeNull()
      expect((await f.t.mutation(authorizeProjection, {})).status).toBe('denied')
    }
    f.setPhase('scoring_pending'); f.context.practiceBinding = null
    expect((await f.t.query(readProjection, {})).practice).toBeNull()
    expect((await f.t.mutation(authorizeProjection, {})).status).toBe('denied')
  })

  test.each(['hint', 'worked_example'] as const)('%s is released only by its matching immutable authorization receipt', async kind => {
    const f = await fixture()
    f.setPhase('scoring_pending')
    f.request.kind = kind; f.savedRequest.kind = kind
    if (f.authorization.status !== 'authorized') throw new Error('Missing fixture authorization')
    f.authorization.content = { kind, text: kind === 'hint' ? 'HINT_CANARY' : 'WORKED_EXAMPLE_CANARY' }
    const before = await snapshot(f)
    const first = await f.t.mutation(authorizeProjection, {})
    expect(first).toEqual(f.authorization)
    expect(await f.t.mutation(authorizeProjection, {})).toEqual(first)
    expect(JSON.stringify(await f.t.query(readProjection, {}))).not.toMatch(/HINT_CANARY|WORKED_EXAMPLE_CANARY/)
    f.request.idempotencyKey = 'changed_key_1234567890'
    expect((await f.t.mutation(authorizeProjection, {})).status).toBe('denied')
    f.request.idempotencyKey = key; f.authorization.deliveredAt = f.f.base.createdAt - 1
    expect((await f.t.mutation(authorizeProjection, {})).status).toBe('denied')
    expect(await snapshot(f)).toEqual(before)
  })

  test.each(['assessmentOpportunityId', 'target', 'revision', 'content'] as const)('rejects a mismatched authorization %s', async field => {
    const f = await fixture()
    Reflect.set(f.authorization, field, field === 'target' ? { responseSlotId: 'wrong' }
      : field === 'content' ? { kind: 'worked_example', text: 'WRONG_HELP' } : field === 'revision' ? 2 : 'wrong')
    expect((await f.t.mutation(authorizeProjection, {})).status).toBe('denied')
  })
})

describe('registered disabled post-seal endpoints', () => {
  test.each(LEARN_V2_ASSESSMENT_PHASES)('%s never returns content or acknowledges delivery, even on replay', async phase => {
    const f = await fixture()
    await f.t.run(ctx => ctx.db.patch(f.reference.assessmentOpportunityId, { phase }))
    const before = await snapshot(f)
    const provider = vi.fn(() => { throw new Error('Unexpected provider dispatch') })
    vi.stubGlobal('fetch', provider)
    const actor = f.t.withIdentity(OWNER)
    for (let replay = 0; replay < 2; replay++) {
      expect(await actor.query(learnV2CanvasMeasurementApi.getPostSealTeaching, f.reference)).toEqual(disabled)
      for (const kind of ['hint', 'worked_example'] as const) expect(await actor.mutation(learnV2CanvasMeasurementApi.authorizePracticeAssistance, { ...f.request, kind })).toEqual(denied)
    }
    expect(await snapshot(f)).toEqual(before)
    expect(provider).not.toHaveBeenCalled()
  })

  test('both scope references require the authenticated owner; a check cannot be the help target', async () => {
    const f = await fixture()
    await f.t.run(ctx => ctx.db.patch(f.target.responseSlotId, { userId: FOREIGN.tokenIdentifier }))
    await expect(f.t.withIdentity(OWNER).mutation(learnV2CanvasMeasurementApi.authorizePracticeAssistance, f.request)).rejects.toThrow('Learn access denied')
    await expect(f.t.withIdentity(OWNER).mutation(learnV2CanvasMeasurementApi.authorizePracticeAssistance,
      { ...f.request, target: { assessmentOpportunityId: f.reference.assessmentOpportunityId } } as never)).rejects.toThrow()
  })

  test.each(['userId', 'phase', 'capabilities', 'validScore', 'publicationAllowed', 'practiceBinding', 'feedback', 'lesson', 'hint', 'workedExample'])('rejects client authority/content field %s', async field => {
    const f = await fixture()
    const actor = f.t.withIdentity(OWNER)
    await expect(actor.query(learnV2CanvasMeasurementApi.getPostSealTeaching, { ...f.reference, [field]: 'forged' } as never)).rejects.toThrow()
    await expect(actor.mutation(learnV2CanvasMeasurementApi.authorizePracticeAssistance, { ...f.request, [field]: 'forged' } as never)).rejects.toThrow()
  })

  test('publishes matching importable request/return contracts', () => {
    expectTypeOf<FunctionArgs<typeof learnV2CanvasMeasurementApi.getPostSealTeaching>>().toEqualTypeOf<z.infer<typeof learnPostSealTeachingReferenceSchema>>()
    expectTypeOf<FunctionReturnType<typeof learnV2CanvasMeasurementApi.getPostSealTeaching>>().toEqualTypeOf<LearnV2PostSealTeaching>()
    expectTypeOf<FunctionArgs<typeof learnV2CanvasMeasurementApi.authorizePracticeAssistance>>().toEqualTypeOf<z.infer<typeof learnAuthorizePracticeAssistanceSchema>>()
    expectTypeOf<FunctionReturnType<typeof learnV2CanvasMeasurementApi.authorizePracticeAssistance>>().toEqualTypeOf<LearnV2PracticeAssistanceAuthorization>()
  })
})

describe('strict post-seal public validators', () => {
  const forbidden = ['scorePercent', 'thresholdPercent', 'criteria', 'rubric', 'rubricSnapshot', 'assessmentRubricSnapshot', 'weights', 'weightPercent',
    'criterionVerdicts', 'scorerRationale', 'modelConfidence', 'model', 'scorerModel', 'answerKey', 'expectedAnswer', 'referenceSolution',
    'caseId', 'familyId', 'itemId', 'sourceSnapshotId', 'sourceExcerptId', 'privateLocator', 'providerResponse', 'hint', 'workedExample']
  test.each(forbidden)('Zod and Convex reject %s at every new content/metadata boundary', async field => {
    const f = await fixture()
    if (f.teaching.status !== 'available' || f.authorization.status !== 'authorized') throw new Error('Missing fixture content')
    const locations = [f.teaching, f.teaching.feedback!, f.teaching.feedback!.citations[0]!, f.teaching.lesson!, f.teaching.practice!]
    for (const location of locations) {
      Reflect.set(location, field, 'FORBIDDEN_CANARY')
      expect(learnPostSealTeachingSchema.safeParse(f.teaching).success).toBe(false)
      await expect(f.t.query(rawRead, {})).rejects.toThrow()
      Reflect.deleteProperty(location, field)
    }
    for (const location of [f.authorization, f.authorization.target, f.authorization.content]) {
      Reflect.set(location, field, 'FORBIDDEN_CANARY')
      expect(learnPracticeAssistanceAuthorizationSchema.safeParse(f.authorization).success).toBe(false)
      await expect(f.t.mutation(rawAuthorization, {})).rejects.toThrow()
      Reflect.deleteProperty(location, field)
    }
    expect(learnPostSealTeachingSchema.safeParse({ ...disabled, [field]: 'FORBIDDEN_CANARY' }).success).toBe(false)
    expect(learnPracticeAssistanceAuthorizationSchema.safeParse({ ...denied, [field]: 'FORBIDDEN_CANARY' }).success).toBe(false)
    for (const canary of Object.values(STORAGE_CANARIES)) {
      expect(JSON.stringify(await f.t.query(rawRead, {}))).not.toContain(canary)
      expect(JSON.stringify(await f.t.mutation(rawAuthorization, {}))).not.toContain(canary)
    }
  })

  test('bounds public text, citations, paragraphs, revisions and original envelope bytes', async () => {
    const f = await fixture()
    const content = f.teaching
    if (content.status !== 'available' || !content.feedback || !content.lesson || !content.practice) throw new Error('Missing fixture content')
    for (const invalid of [
      { ...content, feedback: { ...content.feedback, text: 'x'.repeat(12001) } },
      { ...content, feedback: { ...content.feedback, citations: [] } },
      { ...content, feedback: { ...content.feedback, citations: Array(17).fill(content.feedback.citations[0]) } },
      { ...content, lesson: { ...content.lesson, paragraphs: Array(9).fill('paragraph') } },
      { ...content, practice: { ...content.practice, revision: 0 } },
      { ...content, practice: { ...content.practice, revision: Infinity } },
      { ...content, lesson: { ...content.lesson, paragraphs: Array(8).fill('漢'.repeat(12000)) } },
    ]) expect(() => parseLearnContract(learnPostSealTeachingSchema, invalid)).toThrow()
    for (const idempotencyKey of ['short', 'bad:key', 'x'.repeat(129)]) expect(learnAuthorizePracticeAssistanceSchema.safeParse({ ...f.request, idempotencyKey }).success).toBe(false)
  })
})
