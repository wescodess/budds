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
import { prepareAndRegisterInstructionalArtifactsForOwner } from '../../../convex/lib/learnV2ArtifactLineage'
import { LEARN_V2_POST_SEAL_TEACHING_VERSION } from '../../../shared/learn-v2-assessment-disclosure'
import { LEARN_TODAY_CHECK_POINTER_VERSION } from '../../../shared/learn-v2-today-check'

export const PROOF_START = Date.parse('2027-03-07T15:00:00Z')
export const ANSWER_CANARY = 'PRIVATE-LEARNER-ANSWER-C64'
export type ProofRoute = 'today' | 'today_canvas' | 'canvas'

export async function createMeasurementLearner(input: { route: ProofRoute, scenario: MeasurementScenario, ordinal: number,
  binding: LearnScorerBinding, test?: TestConvex<typeof schema>, key?: string, runtime?: boolean }) {
  const userId = `https://fixture.invalid|c64-${input.route}-${input.scenario.name}-${input.ordinal}${input.key ?? ''}`
  const f = await measurementFamilyFixture(input.binding, { test: input.test, identity: { tokenIdentifier: userId, subject: userId }, rubric: true })
  await f.t.run(async ctx => {
    const user = (await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique())!
    await ctx.db.patch(user._id, { learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: PROOF_START } })
    await ctx.db.insert('learnMeasurementSourceWatermarks', { userId, storageVersion: 'learn-v2.measurement-storage.v1', createdAt: PROOF_START,
      sourceVersion: LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, sequence: 0, dueWorkThrough: null, historyCoverage: 'complete', updatedAt: PROOF_START })
  })
  const teachingContentId = await publishDeliveryTeaching(f)
  if (input.runtime || input.route === 'canvas') await registerMeasurementTeaching({ ...f, userId, teachingContentId })
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
  return { ...f, userId, route: input.route, ordinal: input.ordinal, runtime: input.runtime ?? false,
    scenario: input.scenario, teachingContentId, start, opportunities, cold,
    accepted: new Map<number, Id<'learnResponses'>>() }
}
export type MeasurementLearner = Awaited<ReturnType<typeof createMeasurementLearner>>

async function registerMeasurementTeaching(f: Pick<MeasurementLearner, 't' | 'owner' | 'userId' | 'teachingContentId' | 'graph'>) {
  const blocks = await f.t.run(ctx => ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q =>
    q.eq('userId', f.userId).eq('sessionContentId', f.teachingContentId)).take(16))
  await f.owner.run(ctx => prepareAndRegisterInstructionalArtifactsForOwner(ctx, f.userId, {
    artifacts: blocks.filter(block => ['faded_example', 'explanation', 'worked_example'].includes(block.kind)).map(block => ({
      artifact: { kind: 'session_block', id: block._id }, key: 'whole', origins: [], sources: [{ kind: 'excerpt',
        sourceSnapshotId: f.graph.sourceSnapshotId, sourceExcerptId: f.graph.sourceExcerptId,
        revision: 1, recordRevision: 1, contentHash: f.graph.support.sourceContentHash }] })),
  }))
}

export async function openMeasurement(f: MeasurementLearner, opportunity: Doc<'learnAssessmentOpportunities'>) {
  if (f.route === 'today_canvas' && f.runtime) {
    const pointers = await f.owner.query(api.learnV2Today.getCheckPointers, { pointerVersion: LEARN_TODAY_CHECK_POINTER_VERSION })
    expect(pointers).toMatchObject({ status: 'available', checks: expect.arrayContaining([expect.objectContaining({
      version: LEARN_TODAY_CHECK_POINTER_VERSION, reference: opportunity.delayedCheckId, topic: 'Apply a rule',
      timing: opportunity.horizonDays === 7 ? 'about_a_week' : opportunity.horizonDays === 30 ? 'about_a_month' : 'this_session',
    })]) })
  }
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
  const start = () => f.owner.mutation(api.learnV2SessionContent.startStudySession, f.start)
  if (!f.runtime) expect(await start()).toMatchObject({ status: 'in_progress' })
  const delivery = await f.owner.mutation(api.learnV2SessionContent.getSessionContentDelivery, { studySessionId: f.graph.studySessionId,
    idempotencyKey: 'teachingteaching' })
  expect(delivery, JSON.stringify(delivery)).toMatchObject({ value: { blocks: expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining('TEACHING-CANARY') })]) } })
  if (f.runtime) expect(await start()).toMatchObject({ status: 'in_progress' })
  setVerdict(100)
  const request = { studySessionId: f.graph.studySessionId,
    expectedSessionRevision: 3, expectedContentRevision: 1, expectedPlanRecordRevision: 1, expectedBlueprintRecordRevision: 1,
    response: 'Separate ordinary application.', confidence: 3, idempotencyKey: 'c64_independent_key' }
  const result = await f.owner.action(api.learnV2Mastery.submitMasteryAttempt, request)
  expect(result).toMatchObject({ status: 'completed', state: 'independent', scorePercent: 100 })
  expect(await f.owner.action(api.learnV2Mastery.submitMasteryAttempt, request)).toEqual({ ...result, replayed: true })
  const application = (await f.opportunities()).find(row => row.purpose.kind === 'independent_application')!
  if (f.runtime) await postSealPractice(f, application, 100)
  expect(await f.t.run(ctx => ctx.db.get(f.teachingContentId))).toEqual(content)
  return result
}

export async function teachCanvas(f: MeasurementLearner, setVerdict: (score: number) => void) {
  const content = await f.t.run(ctx => ctx.db.get(f.teachingContentId))
  const cold = (await f.t.run(ctx => ctx.db.get(f.cold._id)))!
  if (cold.contextPins.kind !== 'session') throw new Error('Expected dedicated Canvas cold check')
  expect(cold.contextPins.studySessionId).not.toBe(f.graph.studySessionId)
  const session = (await f.t.run(ctx => ctx.db.get(f.graph.studySessionId)))!
  const request = { studySessionId: session._id, expectedSessionRevision: session.revision,
    expectedContentRevision: 1, idempotencyKey: 'canvasstartstart' }
  if (!cold.submissionId) {
    expect(await f.owner.mutation(api.learnAdaptiveCanvas.startCanvasSession, request))
      .toMatchObject({ kind: 'not_admitted', reasonCode: 'not_sealed' })
    expect(await f.t.run(ctx => ctx.db.get(session._id))).toEqual(session)
    expect((await f.opportunities()).filter(row => row.purpose.kind === 'independent_application')).toEqual([])
    return null
  }
  const response = await f.t.run(ctx => ctx.db.get(cold.submissionId!))
  const reference = { version: LEARN_V2_POST_SEAL_TEACHING_VERSION, assessmentOpportunityId: cold._id }
  expect(await f.owner.query(api.learnV2Assessments.getPostSealTeaching, reference)).toMatchObject({ status: 'available',
    feedback: { tier: 'T0' }, lesson: f.scenario.cold === 100 ? null : { tier: 'T0' } })
  if (f.runtime) await postSealPractice(f, cold, f.scenario.cold!)
  const attached = await f.owner.mutation(api.learnAdaptiveCanvas.startCanvasSession, request)
  if (attached.kind !== 'attached') throw new Error(`Canvas continuation: ${JSON.stringify(attached)}`)
  expect(await f.owner.mutation(api.learnAdaptiveCanvas.startCanvasSession, request)).toEqual({ ...attached, replayed: true })
  expect(await f.owner.query(api.learnV2Assessments.getPostSealTeaching, reference))
    .toMatchObject({ status: 'unavailable', reasonCode: 'test_open' })
  const canvas = (await f.owner.query(api.learnAdaptiveCanvas.getCanvas, { threadId: attached.threadId }))!
  expect(canvas.responsePrompt).toBeTruthy()
  const submission = { studySessionId: session._id, threadId: attached.threadId, activityId: attached.activityId,
    expectedRevision: canvas.thread.revision, expectedSessionRevision: canvas.session.revision,
    response: 'Separate ordinary application.', confidence: 3, idempotencyKey: 'c64_independent_key' }
  const receipt = await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, submission)
  if (receipt.kind !== 'accepted') throw new Error(`Canvas application: ${JSON.stringify(receipt)}`)
  const applicationResponse = await f.t.run(ctx => ctx.db.get(receipt.submissionId))
  expect(applicationResponse).toMatchObject({ flow: 'canvas', assistanceSnapshot: { state: 'unassisted' },
    contextPins: { kind: 'session', studySessionId: session._id, canvas: { threadId: attached.threadId } } })
  expect(await f.owner.mutation(api.learnAdaptiveCanvas.submitCanvasResponse, submission)).toEqual(receipt)
  setVerdict(100)
  const score = { threadId: attached.threadId, activityId: attached.activityId, submissionId: receipt.submissionId,
    idempotencyKey: 'canvasscorescore' }
  expect(await f.owner.action(api.learnAdaptive.submitResponse, score)).toMatchObject({ kind: 'accepted', status: 'completed' })
  expect(await f.owner.action(api.learnAdaptive.submitResponse, score)).toMatchObject({ kind: 'accepted', status: 'completed' })
  const applications = (await f.opportunities()).filter(row => row.purpose.kind === 'independent_application')
  expect(applications).toHaveLength(1)
  const application = applications[0]!
  expect(application).toMatchObject({ submissionId: receipt.submissionId, phase: 'scored_pass' })
  const basis = (await f.t.run(ctx => ctx.db.get(application.authoritativeAttemptId!)))!
  expect(basis).toMatchObject({ kind: 'independent_application', studySessionId: session._id,
    masteryStateAfter: 'independent', serverScorePercent: 100 })
  expect(await f.t.run(ctx => ctx.db.query('learnAssessmentExposures')
    .withIndex('by_userId_and_assignmentId_and_purpose_and_status_and_serverTime', q => q.eq('userId', f.userId)
      .eq('assignmentId', cold.assignmentId).eq('purpose', 'teaching').eq('status', 'granted')).take(2)))
    .toEqual([expect.objectContaining({ provenanceVersion: 'learn-v2.instructional-flow.v2_canvas.v1' })])
  if (f.runtime) await postSealPractice(f, application, 100)
  expect(await f.owner.mutation(api.learnAdaptiveCanvas.startCanvasSession, request)).toEqual({ ...attached, replayed: true })
  expect(await f.t.run(ctx => ctx.db.get(cold._id))).toEqual(cold)
  expect(await f.t.run(ctx => ctx.db.get(cold.submissionId!))).toEqual(response)
  expect(await f.t.run(ctx => ctx.db.get(receipt.submissionId))).toEqual(applicationResponse)
  expect(await f.t.run(ctx => ctx.db.get(f.teachingContentId))).toEqual(content)
  return { application, basis, submissionId: receipt.submissionId }
}

export async function postSealPractice(f: MeasurementLearner, opportunity: Doc<'learnAssessmentOpportunities'>, score: number) {
  const reference = { version: LEARN_V2_POST_SEAL_TEACHING_VERSION, assessmentOpportunityId: opportunity._id }
  const content = await f.t.run(ctx => ctx.db.get(f.teachingContentId))
  const current = (await f.t.run(ctx => ctx.db.get(opportunity._id)))!
  const response = (await f.t.run(ctx => ctx.db.get(current.submissionId!)))!
  const read = await f.owner.query(api.learnV2Assessments.getPostSealTeaching, reference)
  expect(read).toMatchObject({ status: 'available', feedback: { tier: 'T0' }, practice: null })
  expect(JSON.stringify(read)).not.toMatch(/PRIVATE-|private-criterion/u)
  const published = await f.owner.mutation(api.learnV2PostSealTeaching.publishFeedback, reference)
  expect(published).toMatchObject({ status: 'available', feedback: { tier: 'T0' }, lesson: score < 80 ? { tier: 'T0' } : null, practice: null })
  expect(await f.owner.mutation(api.learnV2PostSealTeaching.publishFeedback, reference)).toEqual(published)
  const opened = await f.owner.mutation(api.learnV2PostSealTeaching.openPractice, reference)
  if (opened.status !== 'available' || !opened.practice) throw new Error(`Expected separate practice: ${JSON.stringify(opened)}`)
  expect(await f.owner.mutation(api.learnV2PostSealTeaching.openPractice, reference)).toEqual(opened)
  expect(opened.practice.prompt).toContain('TEACHING-CANARY-faded_example')
  for (const kind of (score < 80 ? ['hint', 'worked_example'] : ['worked_example']) as Array<'hint' | 'worked_example'>) {
    const request = { ...reference, target: { responseSlotId: opened.practice.responseSlotId }, expectedRevision: 1,
      kind, idempotencyKey: `c64_help_${opportunity._id}_${kind}` }
    const help = await f.owner.mutation(api.learnV2Assistance.authorizePracticeAssistance, request)
    expect(help).toMatchObject({ status: 'authorized', content: { kind, tier: 'T0' } })
    expect(await f.owner.mutation(api.learnV2Assistance.authorizePracticeAssistance, request)).toEqual(help)
    expect(JSON.stringify(help)).not.toMatch(/PRIVATE-|private-criterion/u)
  }
  const submission = { version: LEARN_V2_RESPONSE_CONTRACT_VERSION, idempotencyKey: `c64_practice_${opportunity._id}`,
    response: { target: { responseSlotId: opened.practice.responseSlotId }, expectedRevision: 1,
      payload: { kind: 'text' as const, text: 'A separate formative practice response.' } } }
  const accepted = await f.owner.mutation(api.learnV2Responses.acceptResponse, submission)
  expect(accepted).toMatchObject({ kind: 'accepted' })
  expect(await f.owner.mutation(api.learnV2Responses.acceptResponse, submission)).toEqual(accepted)
  expect(await f.t.run(ctx => ctx.db.get(response._id))).toEqual(response)
  expect(await f.t.run(ctx => ctx.db.get(f.teachingContentId))).toEqual(content)
  return opened
}

export async function advanceProofClock(t: TestConvex<typeof schema>, through: number) {
  vi.setSystemTime(through)
  const { runLearnDueCron } = await import('../learn-v2-due-cron')
  await runLearnDueCron(t)
}
