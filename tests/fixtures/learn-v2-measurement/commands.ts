import { expect, vi } from 'vitest'
import type { TestConvex } from 'convex-test'
import type schema from '../../../convex/schema'
import { api } from '../../../convex/_generated/api'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import { publishDeliveryTeaching } from '../learn-v2-assessment-delivery'
import { measurementFamilyFixture } from './family'
import { LEARN_V2_PUBLIC_API_VERSION } from '../../../convex/lib/learnV2PublicContract'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION } from '../../../shared/learn-v2-responses'
import { LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION } from '../../../shared/learn-v2-measurement-report'
import type { LearnScorerBinding } from '../../../shared/learn-v2-measurement'
import type { CheckOutcome, MeasurementScenario } from './scenarios'

export const PROOF_START = Date.parse('2027-03-07T15:00:00Z')
export const ANSWER_CANARY = 'PRIVATE-LEARNER-ANSWER-C64'
export type ProofRoute = 'today' | 'today_canvas' | 'canvas'

export async function createMeasurementLearner(input: { route: ProofRoute, scenario: MeasurementScenario, ordinal: number,
  binding: LearnScorerBinding, test?: TestConvex<typeof schema>, key?: string }) {
  const userId = `https://fixture.invalid|c64-${input.route}-${input.scenario.name}-${input.ordinal}${input.key ?? ''}`
  const f = await measurementFamilyFixture(input.binding, { test: input.test, identity: { tokenIdentifier: userId, subject: userId }, rubric: true })
  await f.t.run(async ctx => {
    const user = (await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique())!
    await ctx.db.patch(user._id, { learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: PROOF_START } })
    await ctx.db.insert('learnMeasurementSourceWatermarks', { userId, storageVersion: 'learn-v2.measurement-storage.v1', createdAt: PROOF_START,
      sourceVersion: LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, sequence: 0, dueWorkThrough: null, historyCoverage: 'complete', updatedAt: PROOF_START })
  })
  const teachingContentId = await publishDeliveryTeaching(f)
  const start = { studySessionId: f.graph.studySessionId, expectedSessionRevision: 2, expectedContentRevision: 1,
    entryPoint: 'today' as const, idempotencyKey: 'c64_start_cold_1234567890' }
  const begun = input.route === 'canvas'
    ? await f.owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, { studySessionId: f.graph.studySessionId,
      expectedSessionRevision: 2, idempotencyKey: 'c64_prepare_cold_1234567890' })
    : await f.owner.mutation(api.learnV2SessionContent.startStudySession, start)
  expect(begun).toMatchObject(input.route === 'canvas' ? { kind: 'prepared' } : { status: 'assessment' })
  const opportunities = () => f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities')
    .withIndex('by_userId', q => q.eq('userId', userId)).take(16))
  const cold = (await opportunities()).find(row => row.purpose.kind === 'measurement_cold')!
  expect(cold).toBeDefined()
  return { ...f, userId, route: input.route, scenario: input.scenario, teachingContentId, start, opportunities, cold,
    accepted: new Map<number, Id<'learnResponses'>>() }
}
export type MeasurementLearner = Awaited<ReturnType<typeof createMeasurementLearner>>

export async function openMeasurement(f: MeasurementLearner, opportunity: Doc<'learnAssessmentOpportunities'>) {
  if (opportunity.contextPins.kind !== 'session' && !(f.route === 'today' && opportunity.purpose.kind === 'measurement_cold')) throw new Error('Expected materialized session')
  const session = (await f.t.run(ctx => ctx.db.get(opportunity.contextPins.kind === 'session' ? opportunity.contextPins.studySessionId : f.graph.studySessionId)))!
  if (f.route !== 'today') {
    const attached = await f.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, { studySessionId: session._id,
      expectedSessionRevision: session.revision, idempotencyKey: `c64_attach_${opportunity._id}` })
    if (attached.kind !== 'attached') throw new Error(`Check attachment: ${JSON.stringify(attached)}`)
    const canvas = (await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId }))!
    expect(canvas.responsePrompt).toBeTruthy()
    expect(JSON.stringify(canvas)).not.toMatch(/PRIVATE-(RUBRIC|SOLUTION|ORDINARY)/u)
    return { attached, canvas, session }
  }
  if (opportunity.purpose.kind !== 'measurement_cold') expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, {
    studySessionId: session._id, expectedSessionRevision: session.revision, expectedContentRevision: 1,
    entryPoint: 'today', idempotencyKey: `c64_start_${opportunity._id}` })).toMatchObject({ status: 'assessment', deliveryGrant: { status: 'granted' } })
  const content = await f.owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: session._id })
  expect(content).toMatchObject({ delivered: { status: 'delivered' } })
  expect(JSON.stringify(content)).not.toMatch(/PRIVATE-(RUBRIC|SOLUTION|ORDINARY)/u)
  return null
}

export async function submitMeasurement(f: MeasurementLearner, opportunity: Doc<'learnAssessmentOpportunities'>,
  outcome: CheckOutcome, setVerdict: (score: number) => void) {
  if (outcome === null) return
  const opened = await openMeasurement(f, opportunity)
  if (outcome === 'unknown' || outcome === 'assisted') await f.t.run(ctx => ctx.db.insert('learnAssessmentExposures', {
    userId: f.userId, storageVersion: 'learn-v2.measurement-storage.v1', createdAt: Date.now(), assessmentOpportunityId: opportunity._id,
    purpose: 'teaching', status: outcome === 'assisted' ? 'granted' : 'possible', projectionDigest: `sha256:${'d'.repeat(64)}`,
    deliveryReceiptHash: `synthetic-adversarial-${opportunity._id}`, serverTime: Date.now(), policyVersion: 'synthetic.contamination.v1', provenanceVersion: 'synthetic.fault-input.v1',
  }))
  const current = (await f.t.run(ctx => ctx.db.get(opportunity._id)))!
  const request = { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: `c64_save_${opportunity._id}`,
    response: { target: { assessmentOpportunityId: opportunity._id }, expectedRevision: current.revision,
      payload: { kind: 'text' as const, text: ANSWER_CANARY } } } }
  const receipt = opened ? await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, {
    threadId: opened.attached.threadId, activityId: opened.attached.activityId, studySessionId: opened.session._id,
    expectedRevision: opened.canvas.thread.revision, expectedSessionRevision: opened.canvas.session.revision,
    response: ANSWER_CANARY, confidence: 3, idempotencyKey: request.submission.idempotencyKey,
  }) : await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, request)
  if (receipt.kind !== 'accepted') throw new Error(`Check acceptance: ${JSON.stringify(receipt)}`)
  f.accepted.set(opportunity.horizonDays ?? 0, receipt.submissionId)
  if (typeof outcome !== 'number') {
    const response = (await f.t.run(ctx => ctx.db.get(receipt.submissionId)))!
    expect(response).toMatchObject({ assistanceSnapshot: { state: outcome === 'unscored' ? 'unassisted' : outcome },
      validitySnapshot: { measurementEligible: outcome === 'unscored' } })
    return
  }
  setVerdict(outcome)
  const score = { version: LEARN_V2_PUBLIC_API_VERSION, submissionId: receipt.submissionId, idempotencyKey: `c64_score_${opportunity._id}` }
  expect(await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, score)).toMatchObject({ status: 'scored', result: { scorePercent: outcome } })
  const acceptedBefore = await f.t.run(ctx => ctx.db.get(receipt.submissionId))
  expect(await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, score)).toMatchObject({ status: 'scored', result: { scorePercent: outcome } })
  expect(await f.t.run(ctx => ctx.db.get(receipt.submissionId))).toEqual(acceptedBefore)
  if (!opened) {
    expect(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, request)).toEqual(receipt)
    expect(await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { ...request.submission,
      response: { ...request.submission.response, payload: { kind: 'text', text: 'Changed answer' } } } })).toMatchObject({ kind: 'rejected' })
    expect(await f.t.run(ctx => ctx.db.get(receipt.submissionId))).toEqual(acceptedBefore)
  }
}

export async function teachToday(f: MeasurementLearner, setVerdict: (score: number) => void) {
  const content = await f.t.run(ctx => ctx.db.get(f.teachingContentId))
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, f.start)).toMatchObject({ status: 'in_progress' })
  expect(await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.graph.studySessionId,
    idempotencyKey: 'teachingteaching' })).toMatchObject({ value: { blocks: expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining('TEACHING-CANARY') })]) } })
  setVerdict(100)
  expect(await f.owner.action(api.learnV2Mastery.submitMasteryAttempt, { studySessionId: f.graph.studySessionId,
    expectedSessionRevision: 3, expectedContentRevision: 1, expectedPlanRecordRevision: 1, expectedBlueprintRecordRevision: 1,
    response: 'Separate ordinary application.', confidence: 3, idempotencyKey: 'c64_independent_key' }))
    .toMatchObject({ status: 'completed', state: 'independent', scorePercent: 100 })
  expect(await f.t.run(ctx => ctx.db.get(f.teachingContentId))).toEqual(content)
}

export async function advanceProofClock(t: TestConvex<typeof schema>, through: number) {
  vi.setSystemTime(through)
  const { runLearnDueCron } = await import('../learn-v2-due-cron')
  await runLearnDueCron(t)
}
