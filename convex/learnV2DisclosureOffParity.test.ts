/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { makeFunctionReference } from 'convex/server'
import { api } from './_generated/api'
import { HELP_OWNER, helpConsumerFixture } from '../tests/fixtures/learn-v2-help-consumers'
import { seedTeachingReads } from '../tests/fixtures/learn-v2-teaching-reads'
import { authorizeExport } from '../tests/fixtures/learn-v2-personal-export'
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

test.each(['unsigned', 'v1', 'signed_deleted', 'signed_unknown', 'signed_invalid'] as const)('off-state %s chat retains the dev content through query, replay and export', async kind => {
  const s = await fixture()
  const conversationId = await s.owner.mutation(api.conversations.createConversation, { folderId: s.f.folderId, title: 'Saved chat' })
  const content = 'Retained assistant answer [1]'
  const sources = [{ content: 'Retained source quote', filename: 'source.txt', score: 1 }]
  let proof = kind.startsWith('signed_')
    ? await signMessageProvenance(process.env.NUXT_BETTER_AUTH_SECRET!, HELP_OWNER.tokenIdentifier, content, sources, kind === 'signed_deleted' ? [{ kind: 'document', id: s.f.documentId }] : null)
    : kind === 'v1' ? { version: 'learn-v2.message-provenance.v1' as const, references: [{ kind: 'document' as const, id: s.f.documentId }] } : undefined
  if (kind === 'signed_invalid' && proof?.version === 'learn-v2.message-provenance.v3') proof = { ...proof, signature: '0'.repeat(64) }
  const rows = await s.t.run(async ctx => {
    const learner = await ctx.db.insert('messages', { userId: HELP_OWNER.tokenIdentifier, conversationId, role: 'user', content: 'My question' })
    const assistant = await ctx.db.insert('messages', { userId: HELP_OWNER.tokenIdentifier, conversationId, role: 'assistant', content, sources, helpScope: proof })
    await ctx.db.delete(s.f.documentId)
    return [(await ctx.db.get(learner))!, (await ctx.db.get(assistant))!]
  })
  const visible = rows.map(({ helpScope: _scope, ...row }) => row)
  const before = await s.exposures()
  expect(await s.owner.query(api.messages.listByConversation, { conversationId })).toEqual(visible)
  expect(await s.owner.mutation(api.messages.replayByConversation, { conversationId, idempotencyKey: 'off_replay' })).toEqual({
    admission: { version: 'learn-v2.help-admission.v1', status: 'ordinary' }, messages: visible,
  })
  const exported = await s.owner.query(api.dataExport.getUserDataPage, { collection: 'messages', paginationOpts: { numItems: 8, cursor: null }, authorizationId: await authorizeExport(s.owner) })
  expect(exported.page).toEqual(rows)
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
  expect(rows.map(({ _id: _id, _creationTime: _time, ...row }) => row)).toEqual(['user', 'assistant'].map(role => ({ conversationId, userId: HELP_OWNER.tokenIdentifier, role, ...fields })))
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
  const original = await s.owner.query(query, args)
  expect(JSON.stringify(original)).toContain(text)
  const before = await s.exposures()
  await s.t.run(ctx => ctx.db.delete(s.f.documentId))
  const expected = path === 'audioOverviews.getCourseScopedOverview' ? { ...original as object, sourceFilenames: ['Source'] } : original
  expect(await s.owner.query(query, args)).toEqual(expected)
  expect(await s.owner.mutation(delivery, { ...args, idempotencyKey: 'off_delivery' })).toEqual({ admission: { version: 'learn-v2.help-admission.v1', status: 'ordinary' }, value: expected })
  expect(await s.exposures()).toEqual(before)
})

test.each(['courses', 'courseSections', 'quizQuestions', 'quizAnswerAssessments', 'flashcardRoomVersions', 'flashcardVersionCards', 'reviewItems', 'audioOverviews', 'audioOverviewUtterances', 'audioOverviewInterjectionUtterances', 'tasks'] as const)('off-state %s export retains dev teaching without origin or revocation withholding', async collection => {
  const s = await fixture()
  await s.t.run(ctx => ctx.db.delete(s.f.documentId))
  const exported = await s.owner.query(api.dataExport.getUserDataPage, { collection, paginationOpts: { numItems: 8, cursor: null }, authorizationId: await authorizeExport(s.owner) })
  expect(exported.page).not.toHaveLength(0)
  expect(JSON.stringify(exported)).not.toContain('evidence_unavailable')
  if (collection !== 'tasks') expect(JSON.stringify(exported)).toContain(text)
})

test.each(['audioOverviews.getByShareToken', 'audioOverviewV2.getPlaybackByShareToken'] as const)('%s retains ordinary anonymous and owner shares while off', async path => {
  const s = await fixture(), query = makeFunctionReference<'query', { token: string }, unknown>(path.replace('.', ':'))
  const original = await s.t.query(query, { token: s.r.token })
  expect(JSON.stringify(original)).toContain(text)
  expect(await s.owner.query(query, { token: s.r.token })).toEqual(original)
  await s.t.run(ctx => ctx.db.delete(s.f.documentId))
  const result = await s.t.query(query, { token: s.r.token })
  expect(JSON.stringify(result)).toContain(text)
  expect(await s.owner.query(query, { token: s.r.token })).toEqual(result)
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
  const before = await s.exposures(), original = await s.owner.query(query, args)
  expect(original).not.toBeNull()
  await s.t.run(ctx => ctx.db.delete(s.f.documentId))
  expect(await s.owner.query(query, args)).toEqual(original)
  expect(await s.owner.mutation(delivery, { ...args, idempotencyKey: 'off_media' })).toEqual({ admission: { version: 'learn-v2.help-admission.v1', status: 'ordinary' }, value: original })
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
  expect(await s.owner.query(api.tasks.get, { taskId: row._id })).toEqual(row)
  expect(await s.owner.query(api.tasks.listByFolder, { folderId: s.f.folderId })).toContainEqual(row)
  const exported = await s.owner.query(api.dataExport.getUserDataPage, { collection: 'tasks', paginationOpts: { numItems: 8, cursor: null }, authorizationId: await authorizeExport(s.owner) })
  expect(exported.page).toEqual([row])
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
  expect((await s.owner.query(api.flashcardRooms.getRoom, { roomId: s.r.roomId }))?.cards).toHaveLength(202)
  expect((await s.owner.query(api.flashcardRooms.getRoomVersion, { versionId: s.r.versionId }))?.cards).toHaveLength(202)
  expect(await s.owner.query(api.audioOverviews.listByFolder, { folderId: s.f.folderId })).toHaveLength(101)
})

test('off-state folder discovery retains dev scopes larger than the new admission limit', async () => {
  const s = await fixture()
  const ids = await s.t.run(async ctx => {
    const rows = []
    for (let index = 0; index < 65; index++) rows.push(await ctx.db.insert('documents', { userId: HELP_OWNER.tokenIdentifier, folderId: s.f.folderId, filename: `source-${index}.txt`, status: 'success', fileSize: 1 }))
    return rows
  })
  expect((await s.owner.query(api.folders.resolveScope, { fileIds: ids })).documentIds).toEqual(ids)
  expect((await s.owner.query(api.folders.resolveScope, { folderIds: [s.f.folderId] })).documentIds).toEqual([s.f.documentId, ...ids])
})

test('off-state source review and mission retain dev titles, locators and excerpts during an open check', async () => {
  const s = await fixture(), locator = 'https://example.com/source?view=1#page'
  await s.t.run(async ctx => {
    await ctx.db.patch(s.f.sourceIdentityId, { title: 'Study\nreference' })
    await ctx.db.patch(s.f.sourceSnapshotId, { blueprintRevisionId: s.f.scope.blueprintRevisionId, publicLocator: locator })
    await ctx.db.patch(s.f.sourceExcerptId, { locator })
  })
  const review = await s.owner.query(api.learnV2Sources.listSourceReview, { blueprintRevisionId: s.f.scope.blueprintRevisionId, paginationOpts: { numItems: 8, cursor: null } })
  expect(review.page[0]).toMatchObject({ identity: { title: 'Study reference' }, excerpt: 'Source rule' })
  const mission = await s.owner.query(api.learnV2Journey.getMission, { learningVoidId: s.f.learningVoidId })
  expect(mission?.sources.items[0]).toMatchObject({ title: 'Study\nreference', publicLocator: locator, excerpt: { locator, text: 'Source rule' } })
})

test('assessment criteria, rubrics and keys stay omitted from the registered map while off', async () => {
  const s = await fixture()
  const result = await s.owner.query(api.learnV2Blueprints.getBlueprintMap, { blueprintRevisionId: s.f.scope.blueprintRevisionId })
  expect(result?.objectives).not.toHaveLength(0)
  expect(JSON.stringify(result)).not.toMatch(/assessmentContract|weightPercent|criteria|rubric|scoringPayload/)
})
