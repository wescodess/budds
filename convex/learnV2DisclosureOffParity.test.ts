/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { makeFunctionReference } from 'convex/server'
import { api, internal } from './_generated/api'
import { HELP_OWNER, helpConsumerFixture } from '../tests/fixtures/learn-v2-help-consumers'
import { seedTeachingReads } from '../tests/fixtures/learn-v2-teaching-reads'
import { authorizeExport } from '../tests/fixtures/learn-v2-personal-export'
import { expectDev, recordingDev } from '../tests/fixtures/c4-off-parity/expect-dev'
import { adaptiveEvidenceFixture } from '../tests/fixtures/c4-off-parity/adaptive-evidence'
import { createSchedulingPreview, schedulingCases } from '../tests/fixtures/c4-off-parity/scheduling'
import { signMessageProvenance } from '../shared/learn-v2-message-provenance'

vi.mock('../shared/learn-v2-measurement-storage-manifest', async importOriginal => {
  const original = await importOriginal<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...original, LEARN_MEASUREMENT_CAPABILITIES: { ...original.LEARN_MEASUREMENT_CAPABILITIES, responses: false } }
})
const modules = import.meta.glob('./**/*.ts')
const text = 'TEACHING_READ_CANARY'
beforeEach(() => { vi.stubEnv('LEARN_V2_ENABLED', 'true'); vi.stubEnv('NUXT_BETTER_AUTH_SECRET', 'off-parity-signing-fixture'); vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_001) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

async function fixture() {
  const s = await helpConsumerFixture(modules)
  const r = await s.t.run(async ctx => {
    await ctx.db.patch(s.f.documentId, { contentHash: 'a'.repeat(64), sourceRevision: 'source.r1', r2Key: 'fixture/source' })
    await ctx.db.patch(s.f.sourceSnapshotId, { blueprintRevisionId: s.f.scope.blueprintRevisionId, contentHash: 'a'.repeat(64), sourceRevision: 'source.r1', objectKey: 'fixture/source' })
    const result = await seedTeachingReads(ctx, HELP_OWNER.tokenIdentifier, s.f.folderId, s.f.documentId, await ctx.storage.store(new Blob(['audio'])))
    const item = (await ctx.db.query('reviewItems').withIndex('by_sectionId', q => q.eq('sectionId', result.sectionId)).take(1))[0]!
    await ctx.db.patch(item._id, { sourceVersionId: undefined })
    const answer = (await ctx.db.query('attemptAnswers').withIndex('by_attemptId', q => q.eq('attemptId', result.attemptId)).take(1))[0]!
    await ctx.db.insert('quizAnswerAssessments', { userId: HELP_OWNER.tokenIdentifier, attemptId: result.attemptId, attemptAnswerId: answer._id,
      questionId: result.questionId, kind: 'quiz.free_response_assessment.v1', status: 'available', label: 'incorrect', questionSnapshot: { question: text, questionType: 'free-response', expectedAnswer: text, explanation: text, evidenceExcerpt: '' },
      learnerAnswerSnapshot: answer.userAnswer, deterministicIsCorrect: false, rubricVersion: 'quiz.free_response_assessment.v1', rubricSnapshot: [], requestedAt: Date.now() })
    return result
  })
  return { ...s, r }
}
type Fixture = Awaited<ReturnType<typeof fixture>>

test.each([
  ['audioOverviews.getWithTurns', s => ({ id: s.r.overviewId })],
  ['audioOverviews.getTurnUrls', s => ({ id: s.r.overviewId })],
  ['audioOverviewInterjections.listByOverview', s => ({ audioOverviewId: s.r.overviewId })],
] satisfies Array<[string, (s: Fixture) => Record<string, unknown>]>)('%s returns the exact live dev audio payload while off', async (path, argsFor) => {
  const s = await fixture()
  const reference = makeFunctionReference<'query', Record<string, unknown>, unknown>(path.replace('.', ':'))
  expectDev(`audio.live.${path}`, await s.owner.query(reference, argsFor(s)))
  expect((await s.exposures()).filter(row => row.purpose === 'teaching')).toEqual([])
})

test.each(Object.entries(schedulingCases))('off-state %s scheduling snapshots retain the writer output', async (name, changes) => {
  vi.setSystemTime(Date.parse('2030-09-01T12:00:00Z'))
  const s = await fixture()
  const { id } = await createSchedulingPreview(s, changes)
  const preview = await s.owner.query(api.learnV2Plans.getPlanPreview, { studyPlanRevisionId: id })
  expectDev(`scheduling.${name}.snapshots`, { inputSnapshot: preview?.inputSnapshot, resultSnapshot: preview?.resultSnapshot })
  if (name === 'long_review') {
    const mission = await s.owner.query(api.learnV2Journey.getMission, { learningVoidId: s.f.learningVoidId })
    expectDev(`scheduling.${name}.journey`, { inputSnapshot: mission?.plan.preview?.inputSnapshot, resultSnapshot: mission?.plan.preview?.resultSnapshot })
  }
})

test.each(['revision', 'hash', 'deleted'] as const)('off-state source review keeps dev access after source %s changes', async change => {
  const s = await fixture()
  await s.t.run(async ctx => {
    await ctx.db.patch(s.f.sourceSnapshotId, { blueprintRevisionId: s.f.scope.blueprintRevisionId, publicLocator: 'https://example.com/source' })
    if (change === 'revision') await ctx.db.patch(s.f.documentId, { sourceRevision: 'source.r2' })
    else if (change === 'hash') await ctx.db.patch(s.f.documentId, { contentHash: 'b'.repeat(64) })
    else await ctx.db.delete(s.f.documentId)
  })
  expectDev(`sources.access.${change}`, await s.owner.query(api.learnV2Sources.listSourceReview, {
    blueprintRevisionId: s.f.scope.blueprintRevisionId, paginationOpts: { numItems: 8, cursor: null },
  }))
})

test.each(['unsigned', 'v1', 'signed_deleted', 'signed_unknown', 'signed_invalid'] as const)('off-state %s chat retains the dev content through query, replay and export', async kind => {
  const s = await fixture()
  const conversationId = await s.owner.mutation(api.conversations.createConversation, { folderId: s.f.folderId, title: 'Saved chat' })
  const content = 'Retained assistant answer [1]'
  const sources = [{ content: 'Retained source quote', filename: 'source.txt', score: 1 }]
  let proof = kind.startsWith('signed_')
    ? await signMessageProvenance(process.env.NUXT_BETTER_AUTH_SECRET!, HELP_OWNER.tokenIdentifier, content, sources, kind === 'signed_deleted' ? [{ kind: 'document', id: s.f.documentId }] : null)
    : kind === 'v1' ? { version: 'learn-v2.message-provenance.v1' as const, references: [{ kind: 'document' as const, id: s.f.documentId }] } : undefined
  if (kind === 'signed_invalid' && proof?.version === 'learn-v2.message-provenance.v3') proof = { ...proof, signature: '0'.repeat(64) }
  await s.t.run(async ctx => {
    const learner = await ctx.db.insert('messages', { userId: HELP_OWNER.tokenIdentifier, conversationId, role: 'user', content: 'My question' })
    const assistant = await ctx.db.insert('messages', { userId: HELP_OWNER.tokenIdentifier, conversationId, role: 'assistant', content, sources, helpScope: proof })
    await ctx.db.delete(s.f.documentId)
    return [(await ctx.db.get(learner))!, (await ctx.db.get(assistant))!]
  })
  const before = await s.exposures()
  expectDev(`chat.${kind}.list`, await s.owner.query(api.messages.listByConversation, { conversationId }))
  if (!recordingDev) expectDev(`chat.${kind}.list`, (await s.owner.mutation(api.messages.replayByConversation, { conversationId, idempotencyKey: 'off_replay' })).messages)
  const exported = await s.owner.query(api.dataExport.getUserDataPage, { collection: 'messages', paginationOpts: { numItems: 8, cursor: null }, authorizationId: await authorizeExport(s.owner) })
  expectDev(`chat.${kind}.export`, exported)
  expect((await s.exposures()).filter(row => row.purpose === 'teaching')).toEqual(before.filter(row => row.purpose === 'teaching'))
})

test.each([false, true])('off-state appends preserve dev message fields with signing secret present=%s', async signing => {
  const s = await fixture()
  if (!signing) { vi.stubEnv('NUXT_BETTER_AUTH_SECRET', ''); vi.stubEnv('BETTER_AUTH_SECRET', '') }
  const conversationId = await s.owner.mutation(api.conversations.createConversation, { folderId: s.f.folderId, title: 'New chat' })
  const fields = { content: 'An ordinary answer', model: 'fixture-model', sources: [{ content: 'Source quote', filename: 'source.txt', score: 1 }],
    interjectionContext: { overviewId: s.r.overviewId, turnIndex: 0, timeMs: 0, quotedText: 'Audio quote' } }
  for (const role of ['user', 'assistant'] as const) {
    await s.owner.mutation(api.messages.appendMessage, { conversationId, role, ...fields })
  }
  const rows = await s.owner.query(api.messages.listByConversation, { conversationId })
  expectDev(`chat.append.${signing}`, rows.map(({ _id: _id, _creationTime: _time, ...row }) => row))
})

const reads = [
  ['courses.listByUser', () => ({})], ['courses.listByFolder', s => ({ folderId: s.f.folderId })], ['courses.get', s => ({ id: s.r.courseId })],
  ['courseSections.get', s => ({ id: s.r.sectionId })], ['courseSections.listByCourse', s => ({ courseId: s.r.courseId })],
  ['courseSections.getNextSection', s => ({ courseId: s.r.courseId, currentOrder: -1 })], ['courseSections.getOfflineCachePayload', s => ({ sectionId: s.r.sectionId })],
  ['quizzes.getWithQuestions', s => ({ id: s.r.quizId })], ['quizzes.getAttemptResults', s => ({ attemptId: s.r.attemptId })],
  ['flashcardRooms.getRoom', s => ({ roomId: s.r.roomId })], ['flashcardRooms.getRoomVersion', s => ({ versionId: s.r.versionId })], ['flashcardRooms.listRoomVersions', s => ({ roomId: s.r.roomId })],
  ['reviewItems.listDueForUser', () => ({})], ['reviewItems.listDueWithContext', () => ({})], ['reviewItems.listBySection', s => ({ sectionId: s.r.sectionId })],
  ['audioOverviews.getCourseScopedOverview', s => ({ id: s.r.overviewId })], ['audioOverviews.getWithTurns', s => ({ id: s.r.overviewId })],
  ['audioOverviewInterjections.listByOverview', s => ({ audioOverviewId: s.r.overviewId })], ['audioOverviewInterjectionsV2.getForOwner', s => ({ interjectionId: s.r.interjectionV2Id })],
  ['audioOverviewV2.getPlaybackForOwner', s => ({ overviewId: s.r.overviewId })],
] satisfies Array<[string, (s: Fixture) => Record<string, unknown>]>

test.each(reads)('%s retains legacy teaching and its delivery alias while off after source deletion', async (path, argsFor) => {
  const s = await fixture(), args = argsFor(s)
  const query = makeFunctionReference<'query', Record<string, unknown>, unknown>(path.replace('.', ':'))
  const delivery = makeFunctionReference<'mutation', Record<string, unknown>, unknown>(`${path.replace('.', ':')}Delivery`)
  const before = await s.exposures()
  await s.t.run(ctx => ctx.db.delete(s.f.documentId))
  expectDev(`read.${path}.deleted`, await s.owner.query(query, args))
  if (!recordingDev) expectDev(`read.${path}.deleted`, (await s.owner.mutation(delivery, { ...args, idempotencyKey: 'off_delivery' }) as { value: unknown }).value)
  expect(await s.exposures()).toEqual(before)
})

test.each(['courses', 'courseSections', 'quizQuestions', 'quizAnswerAssessments', 'flashcardRoomVersions', 'flashcardVersionCards', 'reviewItems', 'audioOverviews', 'audioOverviewUtterances', 'audioOverviewInterjectionUtterances', 'tasks'] as const)('off-state %s export retains dev teaching without origin or revocation withholding', async collection => {
  const s = await fixture()
  await s.t.run(ctx => ctx.db.delete(s.f.documentId))
  const exported = await s.owner.query(api.dataExport.getUserDataPage, { collection, paginationOpts: { numItems: 8, cursor: null }, authorizationId: await authorizeExport(s.owner) })
  expectDev(`export.${collection}`, exported)
})

test.each(['audioOverviews.getByShareToken', 'audioOverviewV2.getPlaybackByShareToken'] as const)('%s retains ordinary anonymous and owner shares while off', async path => {
  const s = await fixture(), query = makeFunctionReference<'query', { token: string }, unknown>(path.replace('.', ':'))
  expectDev(`share.${path}.anonymous`, await s.t.query(query, { token: s.r.token }))
  expectDev(`share.${path}.owner`, await s.owner.query(query, { token: s.r.token }))
  await s.t.run(ctx => ctx.db.delete(s.f.documentId))
  const result = await s.t.query(query, { token: s.r.token })
  expectDev(`share.${path}.deleted.anonymous`, result)
  expectDev(`share.${path}.deleted.owner`, await s.owner.query(query, { token: s.r.token }))
})

test.each([
  ['audioOverviews.getTurnUrls', s => ({ id: s.r.overviewId })],
  ['audioOverviewInterjections.getTurnUrls', s => ({ id: s.r.interjectionId })],
  ['audioOverviews.getTurnUrlsByShareToken', s => ({ token: s.r.token })],
  ['audioOverviewV2.resolveMediaForOwner', s => ({ artifactId: s.r.artifactId })],
  ['audioOverviewV2.resolveMediaByShareToken', s => ({ token: s.r.token })],
  ['audioOverviewInterjectionsV2.resolveMediaForOwner', s => ({ interjectionId: s.r.interjectionV2Id })],
] satisfies Array<[string, (s: Fixture) => Record<string, unknown>]>)('%s retains dev media access without a delivery credential while off', async (path, argsFor) => {
  const s = await fixture(), args = argsFor(s)
  const query = makeFunctionReference<'query', Record<string, unknown>, unknown>(path.replace('.', ':'))
  const delivery = makeFunctionReference<'mutation', Record<string, unknown>, unknown>(`${path.replace('.', ':')}Delivery`)
  const before = await s.exposures()
  await s.t.run(ctx => ctx.db.delete(s.f.documentId))
  expectDev(`media.${path}`, await s.owner.query(query, args))
  if (!recordingDev) expectDev(`media.${path}`, (await s.owner.mutation(delivery, { ...args, idempotencyKey: 'off_media' }) as { value: unknown }).value)
  expect(await s.exposures()).toEqual(before)
})

test('off-state task reads and export retain cached teaching and progress exactly as dev', async () => {
  const s = await fixture()
  const row = await s.t.run(async ctx => {
    const job = (await ctx.db.get(s.r.jobId))!
    await ctx.db.patch(job.taskId, { result: { summary: text }, metadata: { cached: text }, progress: 'Complete', completedAt: Date.now() })
    await ctx.db.delete(s.f.documentId)
    return (await ctx.db.get(job.taskId))!
  })
  expectDev('tasks.get', await s.owner.query(api.tasks.get, { taskId: row._id }))
  expectDev('tasks.list', await s.owner.query(api.tasks.listByFolder, { folderId: s.f.folderId }))
  const exported = await s.owner.query(api.dataExport.getUserDataPage, { collection: 'tasks', paginationOpts: { numItems: 8, cursor: null }, authorizationId: await authorizeExport(s.owner) })
  expectDev('tasks.export', exported)
})

test('off-state legacy decks and Audio lists retain collections above the new teaching limits', async () => {
  const s = await fixture()
  await s.t.run(async ctx => {
    const card = (await ctx.db.query('flashcardRoomCards').withIndex('by_roomId', q => q.eq('roomId', s.r.roomId)).first())!
    const { _id: _cardId, _creationTime: _cardTime, ...fields } = card
    for (let order = 1; order <= 201; order++) {
      await ctx.db.insert('flashcardRoomCards', { ...fields, displayOrder: order })
      await ctx.db.insert('flashcardVersionCards', { ...fields, versionId: s.r.versionId, displayOrder: order })
    }
    const { _id: _overviewId, _creationTime: _overviewTime, ...overview } = (await ctx.db.get(s.r.overviewId))!
    for (let index = 1; index <= 100; index++) await ctx.db.insert('audioOverviews', { ...overview, shareToken: undefined })
  })
  expectDev('limits.cards', await s.owner.query(api.flashcardRooms.getRoom, { roomId: s.r.roomId }))
  expectDev('limits.versionCards', await s.owner.query(api.flashcardRooms.getRoomVersion, { versionId: s.r.versionId }))
  expectDev('limits.audioList', await s.owner.query(api.audioOverviews.listByFolder, { folderId: s.f.folderId }))
})

test('off-state folder discovery retains dev scopes larger than the new admission limit', async () => {
  const s = await fixture()
  const ids = await s.t.run(async ctx => {
    const rows = []
    for (let index = 0; index < 65; index++) rows.push(await ctx.db.insert('documents', { userId: HELP_OWNER.tokenIdentifier, folderId: s.f.folderId, filename: `source-${index}.txt`, status: 'success', fileSize: 1 }))
    return rows
  })
  expectDev('limits.folderFiles', await s.owner.query(api.folders.resolveScope, { fileIds: ids }))
  expectDev('limits.folderScope', await s.owner.query(api.folders.resolveScope, { folderIds: [s.f.folderId] }))
})

test('off-state source review and mission retain dev titles, locators and excerpts during an open check', async () => {
  const s = await fixture(), locator = 'https://example.com/source?view=1#page'
  await s.t.run(async ctx => {
    await ctx.db.patch(s.f.sourceIdentityId, { title: 'Study\nreference' })
    await ctx.db.patch(s.f.sourceSnapshotId, { blueprintRevisionId: s.f.scope.blueprintRevisionId, publicLocator: locator })
    await ctx.db.patch(s.f.sourceExcerptId, { locator })
  })
  const review = await s.owner.query(api.learnV2Sources.listSourceReview, { blueprintRevisionId: s.f.scope.blueprintRevisionId, paginationOpts: { numItems: 8, cursor: null } })
  expectDev('sources.review', review)
  const mission = await s.owner.query(api.learnV2Journey.getMission, { learningVoidId: s.f.learningVoidId })
  expectDev('sources.mission', mission?.sources)
})

test('assessment criteria, rubrics and keys stay omitted from the registered map while off', async () => {
  if (recordingDev) return
  const s = await fixture()
  const result = await s.owner.query(api.learnV2Blueprints.getBlueprintMap, { blueprintRevisionId: s.f.scope.blueprintRevisionId })
  expect(result?.objectives).not.toHaveLength(0)
  expect(JSON.stringify(result)).not.toMatch(/assessmentContract|weightPercent|criteria|rubric|scoringPayload/)
})


test('101 legacy interjections retain their full history and raw fields', async () => {
  const s = await fixture()
  await s.t.run(async ctx => {
    const { _id: _id, _creationTime: _time, ...row } = (await ctx.db.get(s.r.interjectionId))!
    for (let index = 1; index <= 100; index++) await ctx.db.insert('audioOverviewInterjections', { ...row, question: `Question ${index}` })
  })
  expectDev('limits.interjections101', await s.owner.query(api.audioOverviewInterjections.listByOverview, { audioOverviewId: s.r.overviewId }))
})

test('65 course source links retain dev source discovery', async () => {
  const s = await fixture()
  await s.t.run(async ctx => {
    for (let index = 1; index <= 64; index++) await ctx.db.insert('courseSourceDocs', { userId: HELP_OWNER.tokenIdentifier, courseId: s.r.courseId, folderId: s.f.folderId, documentId: s.f.documentId })
  })
  expectDev('limits.courseSources65', await s.owner.query(api.courseSourceDocs.listByCourse, { courseId: s.r.courseId }))
})

test.each(['accepted', 'revision_changed', 'deleted', 'unavailable'] as const)('Adaptive evidence %s preserves dev claim text and integrity', async state => {
  const { t, ids, ownerId } = await adaptiveEvidenceFixture(modules)
  await t.run(async ctx => {
    if (state === 'revision_changed') await ctx.db.patch(ids.sourceSnapshotId, { recordRevision: 8 })
    if (state === 'deleted') await ctx.db.delete(ids.sourceSnapshotId)
    if (state === 'unavailable') await ctx.db.patch(ids.threadId, { evidenceState: 'invalidated' })
  })
  const owner = t.withIdentity({ tokenIdentifier: ownerId })
  expectDev(`evidence.${state}.internal`, await owner.query(internal.learnAdaptiveEvidence.getActivityEvidence, { activityId: 'activity-evidence-1' }))
  expectDev(`evidence.${state}.public`, await owner.query(api.learnAdaptiveEvidence.getThreadActivityEvidence, { threadId: ids.threadId, activityId: 'activity-evidence-1' }))
})

test('legacy internal workers preserve dev auth and publication contracts', async () => {
  const s = await fixture()
  expectDev('workers.sectionInputs', await s.t.query(internal.courseSections.getForGeneration, { sectionId: s.r.sectionId }))
  expectDev('workers.markReady', await s.t.mutation(internal.courseSections.markReady, { sectionId: s.r.sectionId, contentBlocks: [{ type: 'text', content: text, order: 0 }] }))
  expectDev('workers.createCards', await s.t.mutation(internal.flashcardRooms.createCourseScopedRoom, { userId: HELP_OWNER.tokenIdentifier, folderId: s.f.folderId, title: 'Worker cards', cards: [{ term: 'Term', definition: 'Definition' }] }))
})

test('legacy flashcard source resolution and oversize publication retain dev behavior', async () => {
  const s = await fixture()
  expectDev('mutation.invalidCardSource', await s.owner.mutation(api.flashcardRooms.createCard, { roomId: s.r.roomId, term: 'Term', definition: 'Definition', metadata: { source: { documentId: 'legacy-missing-source', filename: 'Legacy', chunkContent: 'Retained quote' } } }))
  expectDev('mutation.oversizeCards', await s.owner.mutation(api.flashcardRooms.generateRoomCards, { roomId: s.r.roomId, origin: 'ai', requestedCardCount: 1, cards: [{ term: 'Term 1', definition: 'Definition' }, { term: 'Term 2', definition: 'Definition' }] }))
})

test('internal generation preserves the dev trusted-worker course relation while off', async () => {
  const s = await fixture()
  await s.t.run(ctx => ctx.db.patch(s.r.courseId, { userId: 'https://foreign.example|legacy-course' }))
  expectDev('workers.legacyCourseOwner', await s.t.query(internal.courseSections.getForGeneration, { sectionId: s.r.sectionId }))
})

test.each(['remove', 'updateOrder'] as const)('section %s keeps the dev mutation result beyond the new publication range', async method => {
  const s = await fixture()
  const ids = await s.t.run(async ctx => {
    const ids = [s.r.sectionId]
    for (let order = 1; order <= 101; order++) ids.push(await ctx.db.insert('courseSections', {
      userId: HELP_OWNER.tokenIdentifier, courseId: s.r.courseId, title: `Section ${order}`, order,
      knowledgeType: 'factual', status: 'ready', masteryLevel: 'new', contentBlocks: [{ type: 'text', content: `Teaching ${order}`, order: 0 }],
    }))
    return ids
  })
  const result = method === 'remove'
    ? await s.owner.mutation(api.courseSections.remove, { sectionId: ids[1]! })
    : await s.owner.mutation(api.courseSections.updateOrder, { courseId: s.r.courseId, sectionIds: [...ids].reverse() })
  expectDev(`mutation.sections.${method}`, result)
  expectDev(`mutation.sections.${method}.read`, await s.owner.query(api.courseSections.listByCourse, { courseId: s.r.courseId }))
})

test.each(['diagnostic_prompt', 'artifact_workspace', 'reflection_next_move'] as const)('legacy %s fallback and continuation retain the exact dev projection', async primitive => {
  const { t, ids, ownerId } = await adaptiveEvidenceFixture(modules)
  await t.run(async ctx => {
    const row = (await ctx.db.get(ids.activityId))!
    const base = { contractVersion: row.primitivePlan[0]!.contractVersion, rendererVersion: row.primitivePlan[0]!.rendererVersion }
    const props = primitive === 'diagnostic_prompt'
      ? { ...base, type: primitive, action: 'submit_response' as const, testId: 'learn-primitive-diagnostic-prompt' as const, props: { prompt: 'Prompt', responseFormat: 'short_text' as const, assistance: 'none' as const } }
      : primitive === 'artifact_workspace'
        ? { ...base, type: primitive, action: 'save_artifact' as const, testId: 'learn-primitive-artifact-workspace' as const, props: { prompt: 'Prompt', artifactKind: 'note' as const, starterText: 'Draft' } }
        : { ...base, type: primitive, action: 'accept_next_move' as const, testId: 'learn-primitive-reflection-next-move' as const, props: { feedback: 'Feedback', nextMove: 'Continue', allowedDecisions: ['accept' as const] } }
    await ctx.db.patch(ids.activityId, { activityClass: 'non_factual', primitivePlan: [props], purpose: 'Retained purpose',
      reasonText: { version: 'learn-adaptive.reason-text.v1', purpose: 'Retained purpose', text: 'Retained reason' },
      fallback: { ...row.fallback, title: 'Retained fallback', body: 'Retained fallback teaching' } })
  })
  const owner = t.withIdentity({ tokenIdentifier: ownerId })
  const path = primitive === 'diagnostic_prompt' ? 'learnAdaptiveRecovery:getDiagnosticCanvas' : primitive === 'artifact_workspace' ? 'learnAdaptive:getArtifactCanvas' : 'learnAdaptive:getReflectionCanvas'
  expectDev(`adaptive.${primitive}.canvas`, await owner.query(makeFunctionReference<'query', { threadId: typeof ids.threadId }, unknown>(path), { threadId: ids.threadId }))
  expectDev(`adaptive.${primitive}.thread`, await owner.query(api.learnAdaptive.getThread, { threadId: ids.threadId }))
  expectDev(`adaptive.${primitive}.memory`, await owner.query(api.learnAdaptive.getMemory, { threadId: ids.threadId }))
})

test('legacy Quiz creation retains dev foreign source metadata handling while off', async () => {
  const s = await fixture()
  const sourceDocumentId = await s.t.run(async ctx => {
    const userId = 'https://foreign.example|legacy-source'
    const folderId = await ctx.db.insert('folders', { userId, name: 'Foreign', documentCount: 1 })
    return await ctx.db.insert('documents', { userId, folderId, filename: 'foreign.txt', status: 'success', fileSize: 1 })
  })
  const created = await s.owner.mutation(api.quizzes.createWithQuestions, { folderId: s.f.folderId, title: 'Legacy quiz', questions: [{
    order: 0, type: 'free-response', question: 'My prompt', correctAnswer: 'My answer', sourceDocumentId,
    sourceChunkContent: 'My retained quote', sourceFilename: 'Retained label',
  }] })
  expectDev('mutation.foreignQuizSource.create', created)
  expectDev('mutation.foreignQuizSource.read', await s.owner.query(api.quizzes.getWithQuestions, { id: created.quizId }))
})
