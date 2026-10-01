/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const userId = 'https://auth.example.com|handoff-owner'
afterEach(() => vi.unstubAllEnvs())

async function fixture() {
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    await ctx.db.insert('users', { tokenIdentifier: userId, name: 'Learner', learnV2Entitlement: { enabled: true, updatedAt: 1 }, learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: 1 } })
    const folderId = await ctx.db.insert('folders', { userId, name: 'Practice', documentCount: 0 })
    const learningVoidId = await ctx.db.insert('learningVoids', { userId, folderId, title: 'Practice', status: 'active', revision: 1, createdAt: 1, updatedAt: 1 })
    const blueprintId = await ctx.db.insert('learnBlueprints', { userId, learningVoidId, revision: 1, createdAt: 1 })
    const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { userId, learningVoidId, blueprintId, revision: 1, recordRevision: 3, status: 'accepted', createdAt: 1, updatedAt: 1 })
    const objectiveId = await ctx.db.insert('learnObjectives', { userId, blueprintRevisionId, title: 'Explain a mechanism', order: 1 })
    const studyPlanId = await ctx.db.insert('studyPlans', { userId, learningVoidId, revision: 1, createdAt: 1 })
    const studyPlanRevisionId = await ctx.db.insert('studyPlanRevisions', { userId, learningVoidId, studyPlanId, blueprintRevisionId, blueprintRecordRevision: 3, revision: 2, recordRevision: 5, status: 'accepted', createdAt: 1 })
    const studySessionId = await ctx.db.insert('studySessions', { userId, studyPlanRevisionId, primaryObjectiveId: objectiveId, status: 'completed', revision: 8, scheduledStartAt: 1 })
    const sessionContentId = await ctx.db.insert('sessionContent', { userId, studySessionId, studyPlanRevisionId, blueprintRevisionId, objectiveId, revision: 11, status: 'published', createdAt: 1, publishedAt: 1 })
    await ctx.db.patch(studySessionId, { startedSessionContentId: sessionContentId, startedSessionContentRevision: 11 })
    const attemptId = await ctx.db.insert('masteryAttempts', { userId, blueprintRevisionId, objectiveId, studySessionId, sessionContentId, studyPlanRevisionId, activityContractVersion: 'learn-v2.mastery-attempt.v1', attemptedAt: 2, idempotencyKey: 'original-authoritative-attempt', serverScorePercent: 80, contentRevision: 11, sessionRevision: 7, planRevision: 2, planRecordRevision: 5, blueprintRecordRevision: 3, result: 'independent', masteryRecordRevision: 1 })
    const threadId = await ctx.db.insert('learningThreads', { userId, originalNeed: 'Explain a mechanism', intent: 'master', availableTime: '15', authorityKind: 'v2_mission', learningVoidId, sourceScope: { kind: 'folder', sourceId: String(folderId) }, evidenceState: 'ready', lifecycle: 'active', revision: 1, createdAt: 1, updatedAt: 1 })
    const activityId = await ctx.db.insert('learningThreadActivities', {
      userId, threadId, activityId: 'accepted-activity', boundaryOrdinal: 1, planRevision: 1, activityClass: 'factual', status: 'feedback',
      planVersion: 'learn-adaptive.activity-plan.v1', replayVersion: 'learn-adaptive.activity-replay.v1', contractVersion: 'learn-adaptive.activity-contract.v1', rendererVersion: 'learn-adaptive.renderer.v1', validationVersion: 'learn-adaptive.primitive-validation.v1', sequenceValidationVersion: 'learn-adaptive.primitive-sequence-validation.v1', fallbackVersion: 'learn-adaptive.text-card-fallback.v1',
      intent: 'master', objectiveId, purpose: 'Explain a mechanism', reasonCode: 'pilot_scoring', primitivePlan: [], requiredAction: { kind: 'submit_response', label: 'Submit' }, evaluationContract: { version: 'learn-adaptive.evaluation.v1', kind: 'server_scored', responseFormat: 'short_text', passingScorePercent: 80 }, fallback: { version: 'learn-adaptive.text-card-fallback.v1', kind: 'text_card', title: 'Saved', body: 'Try later', primaryAction: { type: 'continue_safe', label: 'Continue' }, testId: 'learn-activity-fallback' }, accessibilityMetadata: { heading: 'Practice', instructions: 'Answer', focusTargetTestId: 'practice', liveRegionMode: 'polite' }, learningVoidId, blueprintRevisionId, sessionContentId,
      evidenceReferences: [], generationInputs: { sessionContentRevision: 11, sessionContentInputDigest: null, generatorVersion: null }, decisionInputs: { intentRevision: 1, routerVersion: 'v1', availableTime: '15', sourceState: 'ready', sourceInputs: [], priorActivityId: null, priorAttemptId: null, priorOutcome: null, assistance: 'none', confidence: null }, replacesActivityId: null, canonicalInputSnapshot: '{}', inputDigest: `sha256:${'a'.repeat(64)}`, masteryAttemptId: attemptId, createdAt: 1, updatedAt: 2,
    })
    const jobId = await ctx.db.insert('learnJobs', { userId, learningVoidId, blueprintRevisionId, studyPlanRevisionId, studySessionId, adaptiveThreadId: threadId, adaptiveActivityId: activityId, type: 'mastery_scoring', status: 'succeeded', revision: 2, idempotencyKey: 'original-authoritative-attempt', checkpoint: `attempt:${attemptId}` })
    await ctx.db.patch(activityId, { scoringJobId: jobId })
    await ctx.db.patch(threadId, { currentActivityId: activityId })
    return { folderId, threadId, activityId, attemptId, jobId, sessionContentId }
  })
  return { t, owner: t.withIdentity({ tokenIdentifier: userId }), ids }
}

test('Quiz then Chat preserve two genuine origins of one accepted learning attempt across retries', async () => {
  const { owner, ids } = await fixture()
  const before = await owner.query(api.dataExport.getUserDataPage, { collection: 'masteryAttempts', paginationOpts: { cursor: null, numItems: 8 } })
  const quizArgs = { threadId: ids.threadId, attemptId: ids.attemptId, expectedRevision: 1, idempotencyKey: 'project-to-quiz-0001' }
  const quiz = await owner.mutation(api.learnAdaptive.projectAcceptedAttemptToQuiz, quizArgs)
  expect(quiz).toMatchObject({ kind: 'ok', value: { attemptId: ids.attemptId, activityDocumentId: ids.activityId } })
  if (quiz.kind !== 'ok') throw new Error('Expected Quiz projection')
  expect(await owner.mutation(api.learnAdaptive.projectAcceptedAttemptToQuiz, quizArgs)).toEqual(quiz)
  const chat = await owner.mutation(api.learnAdaptive.handoffQuizAttemptToChat, { threadId: ids.threadId, quizId: quiz.value.quizId, expectedRevision: quiz.revision, idempotencyKey: 'handoff-to-chat-0001' })
  if (chat.kind !== 'ok') throw new Error('Expected Chat handoff')
  expect(await owner.query(api.quizzes.getWithQuestions, { id: quiz.value.quizId })).toMatchObject({ quiz: { attemptProjection: { attemptId: ids.attemptId } } })
  expect(await owner.query(api.messages.listByConversation, { conversationId: chat.value.conversationId })).toMatchObject([{ _id: chat.value.messageId, attemptProjection: { attemptId: ids.attemptId } }])
  const contributions = await owner.query(api.learnAdaptive.listThreadContributions, { threadId: ids.threadId, paginationOpts: { cursor: null, numItems: 8 } })
  expect(contributions.page).toHaveLength(2)
  expect(contributions.page.map(row => row.sourceFeature).sort()).toEqual(['chat', 'quiz'])
  for (const contribution of contributions.page) {
    const result = await owner.mutation(api.learnAdaptive.convertContributionToActivity, { threadId: ids.threadId, contributionId: contribution._id, expectedRevision: chat.revision, idempotencyKey: `reconcile-${contribution.sourceFeature}-0001` })
    expect(result).toMatchObject({ kind: 'ok', value: { activityDocumentId: ids.activityId, attemptId: ids.attemptId, reconciled: true } })
  }
  const thread = await owner.query(api.learnAdaptive.getThread, { threadId: ids.threadId })
  expect(thread?.currentActivity).toMatchObject({ id: 'accepted-activity', boundaryOrdinal: 1, attemptOrigins: expect.arrayContaining([expect.objectContaining({ sourceFeature: 'quiz', sourceStatus: 'available' }), expect.objectContaining({ sourceFeature: 'chat', sourceStatus: 'available' })]) })
  expect(thread?.history).toEqual([])
  expect(await owner.query(api.dataExport.getUserDataPage, { collection: 'masteryAttempts', paginationOpts: { cursor: null, numItems: 8 } })).toEqual(before)
})
