/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test'
import { getFunctionName, type FunctionArgs, type FunctionReturnType } from 'convex/server'
import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { learnV2TodayMeasurementApi, learnV2CanvasMeasurementApi } from './learnV2ApiAdapters'
import { seedMeasurementStorage, STORAGE_CANARIES } from '../tests/fixtures/learn-v2-measurement-storage'
import { LEARN_MEASUREMENT_COLLECTIONS } from '../shared/learn-v2-measurement-storage-manifest'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION, type learnAcceptResponseRequestSchema } from '../shared/learn-v2-responses'
import { LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, LEARN_V2_MEASUREMENT_REPORT_VERSION } from '../shared/learn-v2-measurement-report'
import {
  LEARN_V2_PUBLIC_API_VERSION, type LearnV2SubmissionScore, type LearnV2ResponseState, type LearnV2AggregateExport,
} from './lib/learnV2PublicContract'
import type { z } from 'zod'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://owner.example|learner', subject: 'learner' }
const FOREIGN = { tokenIdentifier: 'https://foreign.example|learner', subject: 'learner' }
const key = 'public_api_1234567890'
const disabled = { version: LEARN_V2_PUBLIC_API_VERSION, status: 'disabled', reasonCodes: ['disabled'] }
const rejected = { kind: 'rejected', version: LEARN_V2_RESPONSE_CONTRACT_VERSION, reasonCode: 'disabled' }
const reportDisabled = { version: LEARN_V2_MEASUREMENT_REPORT_VERSION, status: 'disabled', reasonCodes: ['disabled', 'protocol_not_frozen'] }
type Actor = Pick<TestConvex<typeof schema>, 'query' | 'mutation' | 'action' | 'run'>
type Fixture = Awaited<ReturnType<typeof fixture>>

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

async function fixture() {
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  vi.useFakeTimers()
  vi.setSystemTime(1_800_000_000_001)
  const t = convexTest(schema, modules)
  for (const identity of [OWNER, FOREIGN]) {
    await t.withIdentity(identity).mutation(api.users.upsertUser, {})
    await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
    await t.withIdentity(identity).mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  }
  const f = await t.run(ctx => seedMeasurementStorage(ctx, OWNER.tokenIdentifier))
  await t.run(ctx => ctx.db.patch(f.scope.contextPins.sessionContentId, {
    blueprintRevisionId: f.scope.blueprintRevisionId, studyPlanRevisionId: f.scope.contextPins.studyPlanRevisionId, objectiveId: f.scope.objectiveId,
  }))
  const target = { responseSlotId: f.rows.learnResponseSlots }
  const assessmentTarget = { assessmentOpportunityId: f.rows.learnAssessmentOpportunities }
  const response = { target, expectedRevision: 1, payload: { kind: 'text' as const, text: '  Learner response 私🙂  ' } }
  return { t, f, target, assessmentTarget, response,
    responseRequest: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: key, response },
    assessmentReference: { version: LEARN_V2_PUBLIC_API_VERSION, ...assessmentTarget },
    reportReference: { version: LEARN_V2_MEASUREMENT_REPORT_VERSION, reportRunId: f.rows.learnMeasurementReportRuns },
  }
}

const cases: Array<{ name: string, call: (actor: Actor, f: Fixture) => Promise<unknown>, expected: unknown }> = [
  { name: 'acceptResponse', call: (actor, f) => actor.mutation(api.learnV2Responses.acceptResponse, f.responseRequest), expected: rejected },
  { name: 'getResponseState', call: (actor, f) => actor.query(api.learnV2Responses.getResponseState, { version: LEARN_V2_PUBLIC_API_VERSION, target: f.target }), expected: disabled },
  { name: 'terminalizeResponse', call: (actor, f) => actor.mutation(api.learnV2Responses.terminalizeResponse, { version: LEARN_V2_PUBLIC_API_VERSION, target: f.target, expectedRevision: 1, idempotencyKey: key, reason: 'abandoned' }), expected: disabled },
  { name: 'grantAssessmentDelivery', call: (actor, f) => actor.mutation(api.learnV2Assessments.grantAssessmentDelivery, { ...f.assessmentReference, expectedRevision: 1, idempotencyKey: key }), expected: disabled },
  { name: 'getAssessment', call: (actor, f) => actor.query(api.learnV2Assessments.getAssessment, f.assessmentReference), expected: disabled },
  { name: 'getAssessmentState', call: (actor, f) => actor.query(api.learnV2Assessments.getAssessmentState, f.assessmentReference), expected: disabled },
  { name: 'acceptMasterySubmission', call: (actor, f) => actor.mutation(api.learnV2Mastery.acceptMasterySubmission, { ...f.responseRequest, response: { ...f.response, target: f.assessmentTarget } }), expected: rejected },
  { name: 'acceptMasterySubmission bundle', call: (actor, f) => actor.mutation(api.learnV2Mastery.acceptMasterySubmission, { version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: key, teachBack: f.response, application: { ...f.response, target: f.assessmentTarget, confidence: 3 } }), expected: rejected },
  { name: 'scoreMasterySubmission', call: (actor, f) => actor.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION, submissionId: f.f.rows.learnResponses, idempotencyKey: key }), expected: disabled },
  { name: 'authorizeAssistance', call: (actor, f) => actor.mutation(api.learnV2Assistance.authorizeAssistance, { ...f.assessmentReference, kind: 'hint', idempotencyKey: key }), expected: { version: LEARN_V2_PUBLIC_API_VERSION, status: 'denied', reasonCode: 'disabled' } },
  { name: 'requestReport', call: (actor, f) => actor.mutation(api.learnV2MeasurementReports.requestReport, { version: LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, viewerGrantId: f.f.rows.learnMeasurementReportViewerGrants, enrollmentStartAt: f.f.base.createdAt - 1000, enrollmentEndAt: f.f.base.createdAt, cutoff: f.f.base.createdAt, idempotencyKey: key }), expected: reportDisabled },
  { name: 'getReport', call: (actor, f) => actor.query(api.learnV2MeasurementReports.getReport, f.reportReference), expected: reportDisabled },
  { name: 'getReportCells', call: (actor, f) => actor.query(api.learnV2MeasurementReports.getReportCells, { ...f.reportReference, cursor: null }), expected: reportDisabled },
  { name: 'exportAggregateReport', call: (actor, f) => actor.query(api.learnV2MeasurementReports.exportAggregateReport, { ...f.reportReference, cursor: null }), expected: reportDisabled },
]

async function snapshot(t: Actor) {
  return await t.run(async ctx => {
    const tables = [...LEARN_MEASUREMENT_COLLECTIONS, 'masteryAttempts', 'masteryRecords', 'learnJobs'] as const
    return await Promise.all(tables.map(table => ctx.db.query(table).take(8)))
  })
}

describe('registered inactive measurement API', () => {
  test.each(cases)('$name validates returns, denies foreign issuers and saves nothing', async ({ call, expected }) => {
    const f = await fixture()
    const provider = vi.fn(() => { throw new Error('Unexpected provider dispatch') })
    vi.stubGlobal('fetch', provider)
    const before = await snapshot(f.t)
    const result = await call(f.t.withIdentity(OWNER), f)
    expect(result).toEqual(expected)
    for (const canary of Object.values(STORAGE_CANARIES)) expect(JSON.stringify(result)).not.toContain(canary)
    await expect(call(f.t.withIdentity(FOREIGN), f)).rejects.toThrow('Learn access denied')
    await expect(call(f.t, f)).rejects.toThrow('Unauthenticated')
    expect(await snapshot(f.t)).toEqual(before)
    expect(provider).not.toHaveBeenCalled()
  })

  test('readiness needs authentication, defaults off, and has no UI prerequisite', async () => {
    const f = await fixture()
    const readiness = await f.t.withIdentity(OWNER).query(api.learnV2Assessments.getFeatureReadiness, {})
    expect(readiness).toEqual({ version: LEARN_V2_PUBLIC_API_VERSION, status: 'disabled', protocolStatus: 'protocol_not_frozen',
      serverUsable: false, uiRequired: false, realBaselineCaptured: false, day7Observed: false, day30Observed: false,
      capabilities: Object.fromEntries(['responseAcceptance', 'assessmentDelivery', 'assessmentAcceptance', 'scoringBySubmission', 'assistanceAuthorization', 'reportRequest', 'reportRead', 'aggregateExport']
        .map(name => [name, { status: 'disabled', reasonCodes: ['disabled'] }])) })
    vi.stubEnv('LEARN_V2_ENABLED', 'false')
    expect(await f.t.withIdentity(OWNER).query(api.learnV2Assessments.getFeatureReadiness, {})).toEqual(readiness)
    await expect(f.t.query(api.learnV2Assessments.getFeatureReadiness, {})).rejects.toThrow('Unauthenticated')
  })

  test.each(['userId', 'cohortVersion', 'scorer', 'phase', 'draft'])('rejects client authority field %s at the registered boundary', async field => {
    const f = await fixture()
    await expect(f.t.withIdentity(OWNER).mutation(api.learnV2Responses.acceptResponse, { ...f.responseRequest, [field]: 'forged' } as never)).rejects.toThrow()
    await expect(f.t.withIdentity(OWNER).mutation(api.learnV2Mastery.acceptMasterySubmission, {
      ...f.responseRequest, response: { ...f.response, target: f.assessmentTarget }, [field]: 'forged',
    } as never)).rejects.toThrow()
  })

  test.each(['bad:key', 'short', 'x'.repeat(129)])('keeps the new URL-safe key boundary: %s', async idempotencyKey => {
    const f = await fixture()
    await expect(f.t.withIdentity(OWNER).mutation(api.learnV2Responses.acceptResponse, { ...f.responseRequest, idempotencyKey })).rejects.toThrow('Invalid Learn request')
  })

  test.each([
    { kind: 'text', text: 'x'.repeat(12001) }, { kind: 'numeric', value: Infinity, unit: 'm' },
    { kind: 'keyed', keys: ['same', 'same'] }, { kind: 'text', text: ' ' },
  ])('rejects invalid work without echoing or retaining it', async payload => {
    const f = await fixture()
    const before = await snapshot(f.t)
    await expect(f.t.withIdentity(OWNER).mutation(api.learnV2Responses.acceptResponse, {
      ...f.responseRequest, response: { ...f.response, payload },
    } as never)).rejects.toThrow('Invalid Learn request')
    expect(await snapshot(f.t)).toEqual(before)
  })

  test('context-free help stays denied without fabricating delivered assistance', async () => {
    const f = await fixture()
    const before = await snapshot(f.t)
    expect(await f.t.withIdentity(OWNER).mutation(api.learnV2Assistance.authorizeAssistance, {
      version: LEARN_V2_PUBLIC_API_VERSION, kind: 'chat', idempotencyKey: key,
    })).toEqual({ version: LEARN_V2_PUBLIC_API_VERSION, status: 'denied', reasonCode: 'disabled' })
    expect(await snapshot(f.t)).toEqual(before)
  })

  test('standalone diagnostics use their owned slot and tighter byte ceiling', async () => {
    const f = await fixture()
    const slotId = await f.t.run(ctx => ctx.db.insert('learnResponseSlots', {
      ...f.f.base, scopeKind: 'standalone', threadId: f.f.threadId, activityId: f.f.activityId, threadRevision: 1, activityRevision: 1,
      activityContractVersion: 'diagnostic.v1', evidenceStatus: 'available', stage: 'diagnostic', slotKey: 'diagnostic.v1', blockId: 'diagnostic',
      promptDigest: `sha256:${'a'.repeat(64)}`, promptRevision: 1, responseFormatVersion: 'text.v1', deliveryExposureId: f.f.rows.learnAssessmentExposures,
      revision: 1, status: 'open',
    }))
    const request = { ...f.responseRequest, response: { ...f.response, target: { responseSlotId: slotId } } }
    expect(await f.t.withIdentity(OWNER).mutation(api.learnV2Responses.acceptResponse, request)).toEqual(rejected)
    await expect(f.t.withIdentity(OWNER).mutation(api.learnV2Responses.acceptResponse, {
      ...request, response: { ...request.response, payload: { kind: 'text', text: '漢'.repeat(4000) } },
    })).rejects.toThrow('Invalid Learn request')
    await expect(f.t.withIdentity(FOREIGN).mutation(api.learnV2Responses.acceptResponse, request)).rejects.toThrow('Learn access denied')
  })

  test('a Canvas-bound target keeps its adaptive gate through the Today adapter', async () => {
    const f = await fixture()
    await f.t.run(async ctx => {
      await ctx.db.patch(f.f.threadId, { authorityKind: 'v2_mission', learningVoidId: f.f.learningVoidId })
      await ctx.db.patch(f.f.activityId, { sessionContentId: f.f.scope.contextPins.sessionContentId })
      await ctx.db.patch(f.f.rows.learnResponseSlots, { contextPins: { ...f.f.scope.contextPins, canvas: {
        threadId: f.f.threadId, threadRevision: 1, activityId: f.f.activityId, activityRevision: 1,
        planVersion: 'plan.v1', replayVersion: 'replay.v1', rendererVersion: 'renderer.v1', evaluationVersion: 'evaluation.v1', pilotConfigurationVersion: 'synthetic.v1',
      } } })
    })
    expect(await f.t.withIdentity(OWNER).mutation(learnV2TodayMeasurementApi.acceptResponse, f.responseRequest)).toEqual(rejected)
    await f.t.withIdentity(OWNER).mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: false })
    await expect(f.t.withIdentity(OWNER).mutation(learnV2TodayMeasurementApi.acceptResponse, f.responseRequest)).rejects.toThrow('Learn access denied')
  })

  test('report callers cannot select cohort, protocol or individual input rows', async () => {
    const f = await fixture()
    const request = { version: LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, viewerGrantId: f.f.rows.learnMeasurementReportViewerGrants,
      enrollmentStartAt: f.f.base.createdAt - 1000, enrollmentEndAt: f.f.base.createdAt, cutoff: f.f.base.createdAt, idempotencyKey: key }
    for (const field of ['cohortVersion', 'epoch', 'protocolVersion', 'learnerId', 'rows']) {
      await expect(f.t.withIdentity(OWNER).mutation(api.learnV2MeasurementReports.requestReport, { ...request, [field]: 'forged' } as never)).rejects.toThrow()
    }
    await expect(f.t.withIdentity(OWNER).query(api.learnV2MeasurementReports.getReportCells, { ...f.reportReference, cursor: 'x'.repeat(2001) })).rejects.toThrow('Invalid Learn request')
  })

  test.each(['revoked', 'expired', 'foreign'])('all report reads and exports reject %s viewer grants', async state => {
    const f = await fixture()
    await f.t.run(ctx => ctx.db.patch(f.f.rows.learnMeasurementReportViewerGrants,
      state === 'revoked' ? { status: 'revoked', revokedAt: Date.now() }
        : state === 'expired' ? { expiresAt: Date.now() } : { userId: FOREIGN.tokenIdentifier }))
    for (const entry of cases.filter(entry => /Report/.test(entry.name))) {
      await expect(entry.call(f.t.withIdentity(OWNER), f)).rejects.toThrow('Learn access denied')
    }
  })

  test('account deletion denies the action and all disabled mutations', async () => {
    const f = await fixture()
    await f.t.run(ctx => ctx.db.insert('accountDeletionJobs', { userId: OWNER.tokenIdentifier, status: 'active', phase: 'documents', startedAt: Date.now(), updatedAt: Date.now() }))
    for (const entry of cases) await expect(entry.call(f.t.withIdentity(OWNER), f)).rejects.toThrow('Account deletion is in progress')
  })

  test('both players expose the same canonical authority and importable request contract', async () => {
    const f = await fixture()
    for (const name of ['acceptResponse', 'acceptMasterySubmission', 'scoreMasterySubmission', 'grantAssessmentDelivery', 'getAssessment', 'authorizeAssistance'] as const) {
      expect(getFunctionName(learnV2TodayMeasurementApi[name])).toBe(getFunctionName(learnV2CanvasMeasurementApi[name]))
    }
    expectTypeOf<FunctionArgs<typeof learnV2TodayMeasurementApi.acceptResponse>>().toEqualTypeOf<z.infer<typeof learnAcceptResponseRequestSchema>>()
    expectTypeOf<FunctionReturnType<typeof learnV2TodayMeasurementApi.scoreMasterySubmission>>().toEqualTypeOf<LearnV2SubmissionScore>()
    expectTypeOf<FunctionReturnType<typeof learnV2CanvasMeasurementApi.getResponseState>>().toEqualTypeOf<LearnV2ResponseState>()
    expectTypeOf<FunctionReturnType<typeof api.learnV2MeasurementReports.exportAggregateReport>>().toEqualTypeOf<LearnV2AggregateExport>()
    expect(await f.t.withIdentity(OWNER).mutation(learnV2TodayMeasurementApi.acceptResponse, f.responseRequest)).toEqual(rejected)
    expect(await f.t.withIdentity(OWNER).mutation(learnV2CanvasMeasurementApi.acceptResponse, f.responseRequest)).toEqual(rejected)
    expect(getFunctionName(learnV2TodayMeasurementApi.compatibility.submitMasteryAttempt)).toBe('learnV2Mastery:submitMasteryAttempt')
    expect(getFunctionName(learnV2CanvasMeasurementApi.compatibility.stageResponse)).toBe('learnAdaptiveCanvas:submitCanvasResponse')
    expect(getFunctionName(learnV2CanvasMeasurementApi.compatibility.submitResponse)).toBe('learnAdaptive:submitResponse')
  })
})
