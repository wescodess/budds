/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import type { FunctionArgs } from 'convex/server'

const modules = import.meta.glob('./**/*.ts')
const userId = 'https://auth.example.com|handoff-owner'
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

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
    await ctx.db.insert('masteryRecords', { userId, blueprintRevisionId, objectiveId, state: 'independent', recordRevision: 1, lastAttemptId: attemptId, lastAttemptAt: 2, updatedAt: 2 })
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
    for (const eventType of ['activity_completed', 'representative_pass'] as const) await ctx.db.insert('learnActivityEvents', {
      userId, threadId, activityId, eventType, eventVersion: `${eventType}.v1`, taxonomyVersion: 'learn-adaptive.activity-events.v6',
      occurredAt: 2, sourceVersion: 'learn-v2.mastery-attempt.v1', contractVersion: 'learn-adaptive.activity-contract.v1',
      reasonCode: 'server_scored_attempt_committed', outcomeCode: eventType === 'activity_completed' ? 'completed' : 'pass',
      metadata: { activityClass: 'factual', boundaryOrdinal: 1, masteryState: 'independent' }, dedupeKeyHash: `sha256:${(eventType === 'activity_completed' ? 'c' : 'd').repeat(64)}`,
    })
    return { folderId, threadId, activityId, attemptId, jobId, sessionContentId }
  })
  return { t, owner: t.withIdentity({ tokenIdentifier: userId }), ids }
}

test('Quiz then Chat preserve two genuine origins of one accepted learning attempt across retries', async () => {
  const { owner, ids } = await fixture()
  const before = await owner.query(api.dataExport.getUserDataPage, { collection: 'masteryAttempts', paginationOpts: { cursor: null, numItems: 8 } })
  const masteryBefore = await owner.query(api.dataExport.getUserDataPage, { collection: 'masteryRecords', paginationOpts: { cursor: null, numItems: 8 } })
  const jobsBefore = await owner.query(api.dataExport.getUserDataPage, { collection: 'learnJobs', paginationOpts: { cursor: null, numItems: 8 } })
  const eventsBefore = await owner.query(api.dataExport.getUserDataPage, { collection: 'learnActivityEvents', paginationOpts: { cursor: null, numItems: 8 } })
  const quizArgs = { threadId: ids.threadId, attemptId: ids.attemptId, expectedRevision: 1, idempotencyKey: 'project-to-quiz-0001' }
  const quiz = await owner.mutation(api.learnAdaptive.projectAcceptedAttemptToQuiz, quizArgs)
  expect(quiz).toMatchObject({ kind: 'ok', value: { attemptId: ids.attemptId, activityDocumentId: ids.activityId } })
  if (quiz.kind !== 'ok') throw new Error('Expected Quiz projection')
  expect(await owner.mutation(api.learnAdaptive.projectAcceptedAttemptToQuiz, quizArgs)).toEqual(quiz)
  const chat = await owner.mutation(api.learnAdaptive.handoffQuizAttemptToChat, { threadId: ids.threadId, quizId: quiz.value.quizId, expectedRevision: quiz.revision, idempotencyKey: 'handoff-to-chat-0001' })
  if (chat.kind !== 'ok') throw new Error('Expected Chat handoff')
  expect(await owner.query(api.quizzes.getWithQuestions, { id: quiz.value.quizId })).toMatchObject({ quiz: { attemptProjection: { attemptId: ids.attemptId } } })
  const principal = await owner.query(api.users.getUser, {})
  expect(await owner.query(api.quizzes.getAcceptedAttemptProjection, { quizId: quiz.value.quizId })).toMatchObject({ ownerId: principal?._id })
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
  expect(await owner.query(api.dataExport.getUserDataPage, { collection: 'masteryRecords', paginationOpts: { cursor: null, numItems: 8 } })).toEqual(masteryBefore)
  expect(await owner.query(api.dataExport.getUserDataPage, { collection: 'learnJobs', paginationOpts: { cursor: null, numItems: 8 } })).toEqual(jobsBefore)
  const eventsAfter = await owner.query(api.dataExport.getUserDataPage, { collection: 'learnActivityEvents', paginationOpts: { cursor: null, numItems: 8 } })
  expect(eventsAfter.page.filter(event => 'eventType' in event && event.eventType !== 'contribution_recorded')).toEqual(eventsBefore.page)
  const exportedOrigins = await owner.query(api.dataExport.getUserDataPage, { collection: 'learningThreadContributions', paginationOpts: { cursor: null, numItems: 8 } })
  const lineage = exportedOrigins.page.map(row => 'attemptLineage' in row ? row.attemptLineage : null)
  expect(lineage).toHaveLength(2)
  expect(lineage[0]).toMatchObject({ version: 'learn-adaptive.accepted-attempt-projection.v1', status: 'verified', key: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) })
  expect(lineage[1]).toEqual(lineage[0])
})

test('a result handoff exports useful records without its private authority pins', async () => {
  const { owner, ids } = await fixture()
  const quiz = await owner.mutation(api.learnAdaptive.projectAcceptedAttemptToQuiz, { threadId: ids.threadId, attemptId: ids.attemptId, expectedRevision: 1, idempotencyKey: 'export-quiz-result-0001' })
  if (quiz.kind !== 'ok') throw new Error('Expected Quiz projection')
  const chat = await owner.mutation(api.learnAdaptive.handoffQuizAttemptToChat, { threadId: ids.threadId, quizId: quiz.value.quizId, expectedRevision: quiz.revision, idempotencyKey: 'export-chat-result-0001' })
  if (chat.kind !== 'ok') throw new Error('Expected Chat handoff')
  for (const collection of ['quizzes', 'messages', 'learningThreadContributions', 'learningThreadActivities'] as const) {
    const exported = await owner.query(api.dataExport.getUserDataPage, { collection, paginationOpts: { cursor: null, numItems: 8 } })
    expect(exported.page.length).toBeGreaterThan(0)
    expect(JSON.stringify(exported)).not.toMatch(/attemptProjection|attemptHandoff|scoringJobId|projectionQuizId|activityInputDigest/)
  }
})

test('new request keys recover the same Quiz and Chat records without another accepted outcome', async () => {
  const { owner, ids } = await fixture()
  const authorityBefore = await owner.query(api.dataExport.getUserDataPage, { collection: 'learningThreadActivities', paginationOpts: { cursor: null, numItems: 8 } })
  const jobsBefore = await owner.query(api.dataExport.getUserDataPage, { collection: 'learnJobs', paginationOpts: { cursor: null, numItems: 8 } })
  const quiz = await owner.mutation(api.learnAdaptive.projectAcceptedAttemptToQuiz, { threadId: ids.threadId, attemptId: ids.attemptId, expectedRevision: 1, idempotencyKey: 'recover-quiz-origin-0001' })
  if (quiz.kind !== 'ok') throw new Error('Expected Quiz projection')
  const duplicateQuiz = await owner.mutation(api.learnAdaptive.projectAcceptedAttemptToQuiz, { threadId: ids.threadId, attemptId: ids.attemptId, expectedRevision: quiz.revision, idempotencyKey: 'recover-quiz-origin-0002' })
  expect(duplicateQuiz).toMatchObject({ kind: 'ok', value: { quizId: quiz.value.quizId }, revision: quiz.revision })
  const chatArgs = { threadId: ids.threadId, quizId: quiz.value.quizId, expectedRevision: quiz.revision, idempotencyKey: 'recover-chat-origin-0001' }
  const chat = await owner.mutation(api.learnAdaptive.handoffQuizAttemptToChat, chatArgs)
  if (chat.kind !== 'ok') throw new Error('Expected Chat handoff')
  expect(await owner.mutation(api.learnAdaptive.handoffQuizAttemptToChat, chatArgs)).toEqual(chat)
  expect(await owner.mutation(api.learnAdaptive.handoffQuizAttemptToChat, { ...chatArgs, expectedRevision: chat.revision, idempotencyKey: 'recover-chat-origin-0002' })).toMatchObject({ kind: 'ok', value: chat.value, revision: chat.revision })
  expect(await owner.query(api.quizzes.listByFolder, { folderId: ids.folderId })).toHaveLength(1)
  expect(await owner.query(api.conversations.listRecentForUser, {})).toHaveLength(1)
  expect(await owner.query(api.messages.listByConversation, { conversationId: chat.value.conversationId })).toHaveLength(1)
  const events = await owner.query(api.dataExport.getUserDataPage, { collection: 'learnActivityEvents', paginationOpts: { cursor: null, numItems: 8 } })
  expect(events.page.filter(event => 'eventType' in event && event.eventType === 'contribution_recorded')).toHaveLength(2)
  expect(events.page.filter(event => 'eventType' in event && typeof event.eventType === 'string' && ['activity_completed', 'representative_pass'].includes(event.eventType))).toHaveLength(2)
  expect(await owner.query(api.dataExport.getUserDataPage, { collection: 'learningThreadActivities', paginationOpts: { cursor: null, numItems: 8 } })).toEqual(authorityBefore)
  expect(await owner.query(api.dataExport.getUserDataPage, { collection: 'learnJobs', paginationOpts: { cursor: null, numItems: 8 } })).toEqual(jobsBefore)
})

test.each(['quiz', 'chat'] as const)('deleting the derived %s origin preserves canonical authority and prevents resurrection', async feature => {
  vi.useFakeTimers()
  const { t, owner, ids } = await fixture()
  const attemptsBefore = await owner.query(api.dataExport.getUserDataPage, { collection: 'masteryAttempts', paginationOpts: { cursor: null, numItems: 8 } })
  const authorityBefore = await owner.query(api.dataExport.getUserDataPage, { collection: 'learningThreadActivities', paginationOpts: { cursor: null, numItems: 8 } })
  const quizArgs = { threadId: ids.threadId, attemptId: ids.attemptId, expectedRevision: 1, idempotencyKey: 'delete-origin-quiz-0001' }
  const quiz = await owner.mutation(api.learnAdaptive.projectAcceptedAttemptToQuiz, quizArgs)
  if (quiz.kind !== 'ok') throw new Error('Expected Quiz projection')
  const chatArgs = { threadId: ids.threadId, quizId: quiz.value.quizId, expectedRevision: quiz.revision, idempotencyKey: 'delete-origin-chat-0001' }
  const chat = await owner.mutation(api.learnAdaptive.handoffQuizAttemptToChat, chatArgs)
  if (chat.kind !== 'ok') throw new Error('Expected Chat handoff')
  if (feature === 'quiz') await owner.mutation(api.quizzes.deleteQuiz, { quizId: quiz.value.quizId })
  else await owner.mutation(api.conversations.deleteConversation, { id: chat.value.conversationId })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  const contributions = await owner.query(api.learnAdaptive.listThreadContributions, { threadId: ids.threadId, paginationOpts: { cursor: null, numItems: 8 } })
  expect(contributions.page.find(row => row.sourceFeature === feature)?.sourceStatus).toBe('source_unavailable')
  expect(contributions.page.find(row => row.sourceFeature !== feature)?.sourceStatus).toBe('available')
  expect(await owner.query(api.learnAdaptive.getThread, { threadId: ids.threadId })).toMatchObject({ currentActivity: { id: 'accepted-activity', status: 'feedback', acceptedAttemptHandoff: { eligible: false } }, history: [] })
  expect(await owner.mutation(api.learnAdaptive.handoffQuizAttemptToChat, chatArgs)).toMatchObject({ kind: 'blocked', code: 'source_unavailable' })
  expect(await owner.mutation(api.learnAdaptive.handoffQuizAttemptToChat, { ...chatArgs, expectedRevision: chat.revision, idempotencyKey: 'no-resurrect-chat-0002' })).toMatchObject({ kind: 'blocked', code: 'accepted_attempt_unavailable' })
  if (feature === 'quiz') expect(await owner.mutation(api.learnAdaptive.projectAcceptedAttemptToQuiz, quizArgs)).toMatchObject({ kind: 'blocked', code: 'source_unavailable' })
  else expect(await owner.query(api.quizzes.getAcceptedAttemptProjection, { quizId: quiz.value.quizId })).toMatchObject({ status: 'accepted', handoffAllowed: false })
  expect(await owner.query(api.dataExport.getUserDataPage, { collection: 'masteryAttempts', paginationOpts: { cursor: null, numItems: 8 } })).toEqual(attemptsBefore)
  expect(await owner.query(api.dataExport.getUserDataPage, { collection: 'learningThreadActivities', paginationOpts: { cursor: null, numItems: 8 } })).toEqual(authorityBefore)
})

test('the ordinary Quiz and Chat producers cannot stamp or overwrite accepted attempt lineage', async () => {
  const { owner, ids } = await fixture()
  const quiz = await owner.mutation(api.learnAdaptive.projectAcceptedAttemptToQuiz, { threadId: ids.threadId, attemptId: ids.attemptId, expectedRevision: 1, idempotencyKey: 'protected-quiz-result-0001' })
  if (quiz.kind !== 'ok') throw new Error('Expected Quiz projection')
  await expect(owner.mutation(api.quizzes.startAttempt, { quizId: quiz.value.quizId, settings: { shuffleQuestions: false, showAllQuestions: true, immediateFeedback: true } })).rejects.toThrow(/accepted learning results/i)
  await expect(owner.mutation(api.quizzes.updateQuiz, { quizId: quiz.value.quizId, title: 'Forged' })).rejects.toThrow(/accepted learning results/i)
  await expect(owner.mutation(api.quizzes.addQuestion, { quizId: quiz.value.quizId, questionText: 'Invented question', type: 'free-response', correctAnswer: 'Invented answer' })).rejects.toThrow(/accepted learning results/i)
  await expect(owner.mutation(api.quizzes.submitAttempt, { quizId: quiz.value.quizId, answers: [] })).rejects.toThrow(/accepted learning results/i)
  const conversationId = await owner.mutation(api.conversations.createConversation, { folderId: ids.folderId, title: 'Ordinary Chat' })
  await expect(owner.mutation(api.messages.appendMessage, { conversationId, role: 'assistant', content: 'Claimed result', attemptProjection: { attemptId: ids.attemptId } } as unknown as FunctionArgs<typeof api.messages.appendMessage>)).rejects.toThrow()
  expect(await owner.query(api.messages.listByConversation, { conversationId })).toEqual([])
})

test.each(['ambiguous_job', 'superseded_content', 'changed_content_revision', 'changed_content_digest', 'changed_plan_pin', 'rollback'] as const)('declines %s authority even when a successful receipt exists', async reason => {
  const { t, owner, ids } = await fixture()
  const args = { threadId: ids.threadId, attemptId: ids.attemptId, expectedRevision: 1, idempotencyKey: 'authority-quiz-result-0001' }
  const quiz = await owner.mutation(api.learnAdaptive.projectAcceptedAttemptToQuiz, args)
  if (quiz.kind !== 'ok') throw new Error('Expected Quiz projection')
  await t.run(async ctx => {
    if (reason === 'ambiguous_job') await ctx.db.patch(ids.jobId, { status: 'blocked', terminalReason: 'provider_outcome_requires_reconciliation' })
    if (reason === 'superseded_content') await ctx.db.patch(ids.sessionContentId, { status: 'superseded' })
    if (reason === 'changed_content_revision') await ctx.db.patch(ids.sessionContentId, { revision: 12 })
    if (reason === 'changed_content_digest') await ctx.db.patch(ids.sessionContentId, { inputDigest: `sha256:${'b'.repeat(64)}` })
    if (reason === 'changed_plan_pin') {
      const content = await ctx.db.get(ids.sessionContentId)
      if (content?.studyPlanRevisionId) await ctx.db.patch(content.studyPlanRevisionId, { recordRevision: 6 })
    }
    if (reason === 'rollback') await ctx.db.patch(ids.threadId, { lifecycle: 'rollback' })
  })
  expect(await owner.mutation(api.learnAdaptive.projectAcceptedAttemptToQuiz, args)).toMatchObject({ kind: 'blocked', code: 'source_unavailable' })
  expect(await owner.mutation(api.learnAdaptive.handoffQuizAttemptToChat, { threadId: ids.threadId, quizId: quiz.value.quizId, expectedRevision: quiz.revision, idempotencyKey: 'authority-chat-result-0001' })).toMatchObject({ kind: 'blocked', code: 'accepted_attempt_unavailable' })
  expect(await owner.query(api.quizzes.getAcceptedAttemptProjection, { quizId: quiz.value.quizId })).toMatchObject({ status: 'unavailable', handoffAllowed: false, scorePercent: null })
  expect(await owner.query(api.conversations.listRecentForUser, {})).toEqual([])
})

test('foreign owners cannot inspect, project, or hand off the accepted result', async () => {
  const { t, owner, ids } = await fixture()
  const quiz = await owner.mutation(api.learnAdaptive.projectAcceptedAttemptToQuiz, { threadId: ids.threadId, attemptId: ids.attemptId, expectedRevision: 1, idempotencyKey: 'owner-quiz-result-0001' })
  if (quiz.kind !== 'ok') throw new Error('Expected Quiz projection')
  const otherId = 'https://auth.example.com|handoff-other'
  await t.run(ctx => ctx.db.insert('users', { tokenIdentifier: otherId, name: 'Other', learnV2Entitlement: { enabled: true, updatedAt: 1 }, learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: 1 } }))
  const other = t.withIdentity({ tokenIdentifier: otherId })
  expect(await other.query(api.quizzes.getAcceptedAttemptProjection, { quizId: quiz.value.quizId })).toBeNull()
  await expect(other.mutation(api.learnAdaptive.projectAcceptedAttemptToQuiz, { threadId: ids.threadId, attemptId: ids.attemptId, expectedRevision: quiz.revision, idempotencyKey: 'foreign-quiz-result-0001' })).rejects.toThrow(/thread not found/i)
  await expect(other.mutation(api.learnAdaptive.handoffQuizAttemptToChat, { threadId: ids.threadId, quizId: quiz.value.quizId, expectedRevision: quiz.revision, idempotencyKey: 'foreign-chat-result-0001' })).rejects.toThrow(/thread not found/i)
})

test('retained Quiz results cannot advertise or execute a handoff when Adaptive access is disabled', async () => {
  const { owner, ids } = await fixture()
  const quiz = await owner.mutation(api.learnAdaptive.projectAcceptedAttemptToQuiz, { threadId: ids.threadId, attemptId: ids.attemptId, expectedRevision: 1, idempotencyKey: 'gated-quiz-result-0001' })
  if (quiz.kind !== 'ok') throw new Error('Expected Quiz projection')
  vi.stubEnv('LEARN_V2_ENABLED', 'false')
  expect(await owner.query(api.quizzes.getAcceptedAttemptProjection, { quizId: quiz.value.quizId })).toMatchObject({ status: 'accepted', scorePercent: 80, handoffAllowed: false })
  await expect(owner.mutation(api.learnAdaptive.handoffQuizAttemptToChat, { threadId: ids.threadId, quizId: quiz.value.quizId, expectedRevision: quiz.revision, idempotencyKey: 'gated-chat-result-0001' })).rejects.toThrow(/adaptive learn access denied/i)
  expect(await owner.query(api.conversations.listRecentForUser, {})).toEqual([])
})

test('matching Chat content and a legacy Quiz never acquire shared attempt authority', async () => {
  const { owner, ids } = await fixture()
  const quiz = await owner.mutation(api.learnAdaptive.projectAcceptedAttemptToQuiz, { threadId: ids.threadId, attemptId: ids.attemptId, expectedRevision: 1, idempotencyKey: 'matching-quiz-result-0001' })
  if (quiz.kind !== 'ok') throw new Error('Expected Quiz projection')
  const chat = await owner.mutation(api.learnAdaptive.handoffQuizAttemptToChat, { threadId: ids.threadId, quizId: quiz.value.quizId, expectedRevision: quiz.revision, idempotencyKey: 'matching-chat-result-0001' })
  if (chat.kind !== 'ok') throw new Error('Expected Chat handoff')
  const sourceMessages = await owner.query(api.messages.listByConversation, { conversationId: chat.value.conversationId })
  const conversationId = await owner.mutation(api.conversations.createConversation, { folderId: ids.folderId, title: 'Same words' })
  const messageId = await owner.mutation(api.messages.appendMessage, { conversationId, role: 'assistant', content: sourceMessages[0]!.content })
  const inspected = await owner.query(api.learnAdaptive.inspectContributionSource, { source: { feature: 'chat', id: messageId } })
  if (!inspected.revision) throw new Error('Expected ordinary source')
  const args = { threadId: ids.threadId, source: { feature: 'chat', id: messageId, revision: inspected.revision }, classification: 'non_factual', metadata: {}, expectedRevision: chat.revision }
  expect(await owner.mutation(api.learnAdaptive.recordContribution, { ...args, contributionKind: 'result', idempotencyKey: 'claimed-result-origin-0001' })).toMatchObject({ kind: 'rejected', code: 'invalid_provenance' })
  const recorded = await owner.mutation(api.learnAdaptive.recordContribution, { ...args, contributionKind: 'context', idempotencyKey: 'ordinary-context-origin-0001' })
  if (recorded.kind !== 'recorded') throw new Error('Expected ordinary context')
  expect(await owner.mutation(api.learnAdaptive.convertContributionToActivity, { threadId: ids.threadId, contributionId: recorded.contributionId, expectedRevision: chat.revision, idempotencyKey: 'no-content-alias-0001' })).toMatchObject({ kind: 'blocked', code: 'activity_boundary_unavailable' })
  const { quizId: legacyQuizId } = await owner.mutation(api.quizzes.createWithQuestions, { folderId: ids.folderId, title: 'Accepted learning result', questions: [], creationMethod: 'manual' })
  expect(await owner.mutation(api.learnAdaptive.handoffQuizAttemptToChat, { threadId: ids.threadId, quizId: legacyQuizId, expectedRevision: chat.revision, idempotencyKey: 'no-legacy-alias-0001' })).toMatchObject({ kind: 'blocked', code: 'accepted_attempt_unavailable' })
  expect(await owner.query(api.learnAdaptive.getThread, { threadId: ids.threadId })).toMatchObject({ currentActivity: { id: 'accepted-activity', attemptOrigins: expect.any(Array) }, history: [] })
  const thread = await owner.query(api.learnAdaptive.getThread, { threadId: ids.threadId })
  expect(thread?.currentActivity?.attemptOrigins).toHaveLength(2)
})

test.each([
  { feature: 'quiz', outcome: 'conflict' }, { feature: 'quiz', outcome: 'blocked' },
  { feature: 'chat', outcome: 'conflict' }, { feature: 'chat', outcome: 'blocked' },
] as const)('replays the original $feature $outcome receipt before an origin exists', async ({ feature, outcome }) => {
  const { t, owner, ids } = await fixture()
  let quizId: FunctionArgs<typeof api.learnAdaptive.handoffQuizAttemptToChat>['quizId'] | null = null
  let revision = 1
  if (feature === 'chat') {
    const quiz = await owner.mutation(api.learnAdaptive.projectAcceptedAttemptToQuiz, { threadId: ids.threadId, attemptId: ids.attemptId, expectedRevision: 1, idempotencyKey: 'receipt-parent-quiz-0001' })
    if (quiz.kind !== 'ok') throw new Error('Expected Quiz projection')
    quizId = quiz.value.quizId
    revision = quiz.revision
  }
  if (outcome === 'blocked') await t.run(ctx => ctx.db.patch(ids.jobId, { status: 'blocked', terminalReason: 'provider_outcome_requires_reconciliation' }))
  const request = { threadId: ids.threadId, expectedRevision: outcome === 'conflict' ? 99 : revision, idempotencyKey: 'terminal-receipt-retry-0001' }
  const submit = () => feature === 'quiz'
    ? owner.mutation(api.learnAdaptive.projectAcceptedAttemptToQuiz, { ...request, attemptId: ids.attemptId })
    : owner.mutation(api.learnAdaptive.handoffQuizAttemptToChat, { ...request, quizId: quizId! })
  const original = await submit()
  expect(original).toMatchObject({ kind: outcome, code: outcome === 'conflict' ? 'stale_revision' : 'accepted_attempt_unavailable' })
  expect(await submit()).toEqual(original)
  if (outcome === 'blocked') {
    await t.run(ctx => ctx.db.patch(ids.jobId, { status: 'succeeded', terminalReason: undefined }))
    expect(await submit()).toEqual(original)
  }
  expect(await owner.query(api.quizzes.listByFolder, { folderId: ids.folderId })).toHaveLength(feature === 'quiz' ? 0 : 1)
  expect(await owner.query(api.conversations.listRecentForUser, {})).toEqual([])
})
