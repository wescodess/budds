/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { artifactManifestDigest, prepareAndRegisterInstructionalArtifacts } from './lib/learnV2ArtifactLineage'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

const modules = import.meta.glob('./**/*.ts')
const identity = { tokenIdentifier: 'https://auth.example|c43-owner', subject: 'same' }
const userId = identity.tokenIdentifier
const base = { userId, storageVersion: 'learn-v2.measurement-storage.v1' as const, createdAt: 1_800_000_000_000 }
const canary = 'held-out-private-scoring-canary'
const settings = { shuffleQuestions: false, showAllQuestions: false, immediateFeedback: false }

async function fixture(enrolled = true) {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(identity)
  const ids = await t.run(async ctx => {
    const folderId = await ctx.db.insert('folders', { userId, name: 'Owned teaching', documentCount: 1 })
    const catalogId = await ctx.db.insert('learnAssessmentCatalogs', { ...base, catalogRevision: 0, instrumentationEpoch: 'epoch.v1', historyCompleteness: 'prospective_complete', historyBasisVersion: 'history.v1', historyCoverageWatermark: 'coverage.v1', measurementCapability: { enabled: true } })
    const documentId = await ctx.db.insert('documents', { userId, folderId, filename: 'owned.txt', status: 'success', fileSize: 10, contentHash: 'a'.repeat(64), sourceRevision: 'source.r1', r2Key: 'owned/source' })
    return { folderId, catalogId, documentId }
  })
  await owner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [
    { artifact: { kind: 'document', id: ids.documentId }, key: 'whole', sources: [], origins: [] },
    { artifact: { kind: 'document_chunk', id: ids.documentId }, key: 'chunk-set', sources: [], origins: [] },
  ] }))
  const { quizId } = await owner.mutation(api.quizzes.createWithQuestions, { folderId: ids.folderId, title: 'Ordinary Quiz', requestedQuestionCount: 1,
    questions: [{ order: 0, type: 'free-response', question: 'Explain rain.', correctAnswer: 'Water condenses.', sourceDocumentId: ids.documentId, sourceChunkContent: 'Ordinary teaching.' }] })
  const question = (await owner.query(api.quizzes.getWithQuestions, { id: quizId }))!.questions[0]!
  const { roomId } = await owner.mutation(api.flashcardRooms.createRoom, { folderId: ids.folderId, title: 'Ordinary cards' })
  const cards = await owner.mutation(api.flashcardRooms.generateRoomCards, { roomId, origin: 'ai', requestedCardCount: 1, cards: [{ term: 'Condensation', definition: 'Gas becomes liquid.', metadata: { source: { documentId: ids.documentId, filename: 'owned.txt', chunkContent: 'Ordinary teaching.' } } }] })
  const { courseId } = await owner.mutation(api.courses.create, { folderId: ids.folderId, title: 'Ordinary course', sourceType: 'web-only' })
  const extra = await t.run(async ctx => {
    await ctx.db.patch(courseId, { status: 'ready' })
    const overviewId = await ctx.db.insert('audioOverviews', { userId, folderId: ids.folderId, title: canary, status: 'ready', turns: [], sourceDocumentIds: [ids.documentId], voiceProfile: { hostA: 'asteria', hostB: 'orion' }, totalDurationMs: 0 })
    const sectionId = await ctx.db.insert('courseSections', { userId, courseId, order: 0, title: 'Ordinary section', knowledgeType: 'conceptual', status: 'completed', masteryLevel: 'new', contentBlocks: [
      { type: 'text', order: 0, content: 'Ordinary teaching.' }, { type: 'quiz', order: 1, entityId: quizId, entityType: 'quiz' }, { type: 'flashcard', order: 2, entityId: roomId, entityType: 'flashcard' }, { type: 'audio', order: 3, entityId: overviewId, entityType: 'audio' },
    ] })
    return { overviewId, sectionId }
  })
  await owner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [
    { artifact: { kind: 'audio_overview', id: extra.overviewId }, key: 'whole', sources: [], origins: [] },
    ...Array.from({ length: 4 }, (_, order) => ({ artifact: { kind: 'section_block' as const, id: extra.sectionId }, key: `block.${order}`, sources: [], origins: [] })),
  ] }))
  const share = await owner.mutation(api.audioOverviews.publishOverview, { id: extra.overviewId })
  const attempt = await owner.mutation(api.quizzes.startAttempt, { quizId, settings })
  await owner.mutation(api.quizzes.submitAnswer, { attemptId: attempt.attemptId, questionId: question._id, userAnswer: 'My retained answer.' })
  await owner.mutation(api.quizzes.completeAttempt, { attemptId: attempt.attemptId })
  if (!enrolled) await t.run(ctx => ctx.db.patch(ids.catalogId, { measurementCapability: { enabled: false } }))
  return { t, owner, ...ids, ...extra, courseId, quizId, questionId: question._id, roomId, versionId: cards.versionId, attemptId: attempt.attemptId, token: share.token }
}
type Fixture = Awaited<ReturnType<typeof fixture>>

async function restrict(f: Fixture, kind: 'quiz_question' | 'document' | 'document_chunk' | 'flashcard_version' | 'audio_overview', classification: 'measurement' | 'private_scoring' | 'unknown' = 'private_scoring') {
  const id = kind === 'quiz_question' ? f.questionId : kind === 'flashcard_version' ? f.versionId : kind === 'audio_overview' ? f.overviewId : f.documentId
  await f.t.run(async ctx => {
    const rows = await ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', kind).eq('artifact.id', id).eq('nextId', undefined)).take(16)
    expect(rows.length).toBeGreaterThan(0)
    for (const before of rows) {
      await ctx.db.patch(before._id, { classification, authority: 'server_producer', publication: undefined })
      const row = (await ctx.db.get(before._id))!
      const origins = await ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', row._id)).take(9)
      const cases = await ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', row._id)).take(300)
      const sources = await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', row._id)).take(65)
      const manifestDigest = await artifactManifestDigest(ctx, row, origins, cases, sources)
      await ctx.db.patch(row._id, { manifestDigest })
      await ctx.db.patch(row.validationId!, { manifestDigest })
    }
  })
}
async function inventory(f: Fixture) {
  return f.t.run(async ctx => ({
    catalog: await ctx.db.get(f.catalogId),
    sections: await ctx.db.query('courseSections').withIndex('by_userId', q => q.eq('userId', userId)).take(200),
    jobs: await ctx.db.query('audioOverviewJobs').withIndex('by_userId', q => q.eq('userId', userId)).take(200),
    quizzes: await ctx.db.query('quizzes').withIndex('by_userId', q => q.eq('userId', userId)).take(100),
    questions: await ctx.db.query('quizQuestions').withIndex('by_userId', q => q.eq('userId', userId)).take(200),
    versions: await ctx.db.query('flashcardRoomVersions').withIndex('by_userId', q => q.eq('userId', userId)).take(200),
    lineages: await ctx.db.query('learnArtifactLineages').withIndex('by_userId', q => q.eq('userId', userId)).take(200),
    attempts: await ctx.db.query('quizAttempts').withIndex('by_userId', q => q.eq('userId', userId)).take(200),
  }))
}
const quizEntries: Array<[string, (f: Fixture) => Promise<unknown>]> = [
  ['getWithQuestions', f => f.owner.query(api.quizzes.getWithQuestions, { id: f.quizId })],
  ['startAttempt', f => f.owner.mutation(api.quizzes.startAttempt, { quizId: f.quizId, settings, restart: true })],
  ['getAttemptResults', f => f.owner.query(api.quizzes.getAttemptResults, { attemptId: f.attemptId })],
  ['getQuizHistory', f => f.owner.query(api.quizzes.getQuizHistory, { quizId: f.quizId })],
  ['listAttempts', f => f.owner.query(api.quizzes.listAttempts, { quizId: f.quizId })],
  ['submitAttempt', f => f.owner.mutation(api.quizzes.submitAttempt, { quizId: f.quizId, answers: [{ questionId: f.questionId, response: 'own answer' }] })],
  ['listPendingForAttempt', f => f.owner.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId: f.attemptId })],
  ['listPendingForShadowAttempt', f => f.owner.query(api.quizAnswerAssessments.listPendingForShadowAttempt, { attemptId: f.attemptId })],
]
const sectionEntries: Array<[string, (f: Fixture) => Promise<unknown>]> = [
  ['get', f => f.owner.query(api.courseSections.get, { id: f.sectionId })],
  ['listByCourse', f => f.owner.query(api.courseSections.listByCourse, { courseId: f.courseId })],
  ['getNextSection', f => f.owner.query(api.courseSections.getNextSection, { courseId: f.courseId, currentOrder: -1 })],
  ['getOfflineCachePayload', f => f.owner.query(api.courseSections.getOfflineCachePayload, { sectionId: f.sectionId })],
  ['setOfflineAvailable', f => f.owner.mutation(api.courseSections.setOfflineAvailable, { sectionId: f.sectionId, offlineAvailable: true })],
]

describe('C4.3 registered producer and legacy boundaries', () => {
  test.each(quizEntries)('%s rejects private lineage on either enrollment state', async (_name, run) => {
    for (const enrolled of [true, false]) {
      const f = await fixture(enrolled)
      await restrict(f, 'quiz_question')
      const before = await inventory(f)
      await expect(run(f)).rejects.toThrow('Teaching input is unavailable')
      expect(await inventory(f)).toEqual(before)
    }
  })
  test.each(sectionEntries)('%s rejects a nested measurement question before offline publication', async (_name, run) => {
    const f = await fixture()
    await restrict(f, 'quiz_question', 'measurement')
    await expect(run(f)).rejects.toThrow('Teaching input is unavailable')
    expect((await f.t.run(ctx => ctx.db.get(f.sectionId)))?.offlineAvailable).toBeUndefined()
  })
  test.each(['document', 'document_chunk'] as const)('course/Quiz/card scope rejects a restrictive %s representation', async kind => {
    const f = await fixture(false)
    await restrict(f, kind)
    await expect(f.owner.query(api.documents.getTeachingScope, { folderId: f.folderId })).rejects.toThrow('Teaching input is unavailable')
    await expect(f.owner.mutation(api.quizzes.createWithQuestions, { folderId: f.folderId, title: 'copy', questions: [{ type: 'free-response', order: 0, question: 'Rewrite', correctAnswer: 'copy', sourceDocumentId: f.documentId }] })).rejects.toThrow('Teaching input is unavailable')
    await expect(f.owner.mutation(api.flashcardRooms.generateRoomCards, { roomId: f.roomId, origin: 'ai', cards: [{ term: 'Copy', definition: 'Rewrite', metadata: { source: { documentId: f.documentId, filename: 'copy', chunkContent: canary } } }] })).rejects.toThrow('Teaching input is unavailable')
  })
  test.each(['getRoom', 'getRoomVersion', 'restoreRoomVersion'] as const)('%s refuses a private version, including restore replay', async entry => {
    const f = await fixture()
    await restrict(f, 'flashcard_version')
    const work = entry === 'getRoom' ? f.owner.query(api.flashcardRooms.getRoom, { roomId: f.roomId }) : entry === 'getRoomVersion' ? f.owner.query(api.flashcardRooms.getRoomVersion, { versionId: f.versionId }) : f.owner.mutation(api.flashcardRooms.restoreRoomVersion, { roomId: f.roomId, versionId: f.versionId })
    await expect(work).rejects.toThrow('Teaching input is unavailable')
  })
  test.each(['publishOverview', 'getWithTurns', 'getTurnUrls', 'getByShareToken', 'getTurnUrlsByShareToken'] as const)('%s rejects protected Audio before share or media delivery', async entry => {
    const f = await fixture(false)
    await restrict(f, 'audio_overview')
    const work = entry === 'publishOverview' ? f.owner.mutation(api.audioOverviews.publishOverview, { id: f.overviewId }) : entry === 'getWithTurns' ? f.owner.query(api.audioOverviews.getWithTurns, { id: f.overviewId }) : entry === 'getTurnUrls' ? f.owner.query(api.audioOverviews.getTurnUrls, { id: f.overviewId }) : entry === 'getByShareToken' ? f.t.query(api.audioOverviews.getByShareToken, { token: f.token }) : f.t.query(api.audioOverviews.getTurnUrlsByShareToken, { token: f.token })
    await expect(work).rejects.toThrow('Teaching input is unavailable')
  })
  test('retired case identity and a rewritten hash both block publication and roll back', async () => {
    const f = await fixture()
    await f.t.run(async ctx => {
      const cases = await ctx.db.query('learnAssessmentCases').withIndex('by_userId', q => q.eq('userId', userId)).take(100)
      await ctx.db.patch(cases[0]!._id, { reservedAt: 0 })
    })
    const before = await inventory(f)
    for (const question of ['Explain rain.', 'Rewritten words are not new case authority.']) {
      await expect(f.owner.mutation(api.quizzes.createWithQuestions, { folderId: f.folderId, title: 'New hash', questions: [{ type: 'free-response', order: 0, question, correctAnswer: 'Water condenses.' }] })).rejects.toThrow(/reservation check/)
      expect(await inventory(f)).toEqual(before)
    }
  })
  test('edits atomically register all section keys, corrected questions and a complete current deck', async () => {
    const f = await fixture()
    await f.owner.mutation(api.quizzes.updateQuestion, { questionId: f.questionId, correctAnswer: 'Condensation forms droplets.' })
    await f.owner.mutation(api.contentFlags.flagQuizQuestion, { questionId: f.questionId, correctedAnswer: 'Water forms droplets.' })
    await f.owner.mutation(api.contentFlags.unflagQuizQuestion, { questionId: f.questionId })
    await f.owner.mutation(api.flashcardRooms.updateCard, { cardId: (await f.owner.query(api.flashcardRooms.getRoom, { roomId: f.roomId }))!.cards[0]!._id, term: 'Condensation', definition: 'Cooling makes droplets.' })
    expect((await f.owner.query(api.flashcardRooms.getRoom, { roomId: f.roomId }))?.room.activeVersionId).toBeDefined()
    expect(await f.owner.query(api.courseSections.getOfflineCachePayload, { sectionId: f.sectionId })).toMatchObject({ sectionId: f.sectionId })
  })
  test('ordinary history is readable; unauthenticated and same-subject foreign issuers have no authority', async () => {
    const f = await fixture(false)
    expect(await f.owner.query(api.quizzes.getAttemptResults, { attemptId: f.attemptId })).toMatchObject({ attemptId: f.attemptId })
    expect(await f.owner.query(api.courseSections.getOfflineCachePayload, { sectionId: f.sectionId })).toBeTruthy()
    expect(await f.t.query(api.quizzes.getWithQuestions, { id: f.quizId })).toBeNull()
    expect(await f.t.withIdentity({ tokenIdentifier: 'https://other.example|c43-owner', subject: 'same' }).query(api.quizzes.getWithQuestions, { id: f.quizId })).toBeNull()
  })
  test('unenrolled publications create no catalogue, cases or lineage and cannot claim V2 evidence', async () => {
    const t = convexTest(schema, modules)
    const owner = t.withIdentity(identity)
    const folderId = await owner.mutation(api.folders.createFolder, { name: 'Ordinary history' })
    const { quizId } = await owner.mutation(api.quizzes.createWithQuestions, { folderId, title: 'Ordinary', questions: [{ order: 0, type: 'free-response', question: 'Personal work', correctAnswer: 'Personal answer' }] })
    expect(await owner.query(api.quizzes.getWithQuestions, { id: quizId })).toBeTruthy()
    expect(await t.run(ctx => ctx.db.query('learnArtifactLineages').withIndex('by_userId', q => q.eq('userId', userId)).take(1))).toEqual([])
    expect(await t.run(ctx => ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', userId)).take(1))).toEqual([])
  })
})


describe('C4.3 final publication checks', () => {
  test.each(['document', 'document_chunk'] as const)('indexing rejects %s lineage before external indexing and finalization', async kind => {
    const f = await fixture()
    await restrict(f, kind)
    await f.t.run(ctx => ctx.db.patch(f.documentId, { status: 'indexing', indexJobId: 'index-c43' }))
    const network = vi.fn()
    vi.stubGlobal('fetch', network)
    await expect(f.t.action(internal.documentActions.startDocumentIndexing, { documentId: f.documentId })).rejects.toThrow('Artifact lineage unavailable')
    expect(network).not.toHaveBeenCalled()
    await expect(f.t.mutation(internal.documents.finalizeDocumentIndexing, { id: f.documentId, expectedFolderId: f.folderId, expectedIndexJobId: 'index-c43', expectedR2Key: 'owned/source', status: 'success' })).rejects.toThrow('Artifact lineage unavailable')
    expect((await f.t.run(ctx => ctx.db.get(f.documentId)))?.status).toBe('indexing')
  })
  test('personal indexing registers both representations in the finalizing transaction', async () => {
    const f = await fixture()
    const id = await f.t.run(ctx => ctx.db.insert('documents', { userId, folderId: f.folderId, filename: 'personal.txt', fileSize: 12, status: 'indexing', sourceRevision: 'personal.r1', contentHash: 'b'.repeat(64), r2Key: 'owned/personal' }))
    expect(await f.t.mutation(internal.documents.finalizeDocumentIndexing, { id, expectedFolderId: f.folderId, expectedR2Key: 'owned/personal', status: 'success' })).toBe(true)
    expect(await f.owner.query(api.documents.getTeachingScope, { documentIds: [id] })).toMatchObject([{ documentId: id }])
    const rows = await f.t.run(ctx => ctx.db.query('learnArtifactLineages').withIndex('by_userId', q => q.eq('userId', userId)).take(100))
    expect(rows.filter(row => row.artifact.id === id).map(row => row.artifact.kind).sort()).toEqual(['document', 'document_chunk'])
  })
  test.each(['cards', 'section', 'quiz'] as const)('%s refuses reserved output and rolls back its content and catalogue', async producer => {
    const f = await fixture()
    const generationSectionId = await f.t.run(ctx => ctx.db.insert('courseSections', { userId, courseId: f.courseId, order: 1, title: 'New', knowledgeType: 'conceptual', status: 'generating', masteryLevel: 'new', contentBlocks: [] }))
    await f.t.run(async ctx => {
      const cases = await ctx.db.query('learnAssessmentCases').withIndex('by_userId', q => q.eq('userId', userId)).take(100)
      await ctx.db.patch(cases[0]!._id, { reservedAt: 0 })
    })
    const before = await inventory(f)
    const write = producer === 'cards'
      ? f.owner.mutation(api.flashcardRooms.generateRoomCards, { roomId: f.roomId, origin: 'ai', requestedCardCount: 1, cards: [{ term: 'New words', definition: 'Rewritten private solution' }] })
      : producer === 'section'
        ? f.owner.mutation(api.courseSections.finalizeSectionGeneration, { sectionId: generationSectionId, textContent: 'A rewritten private solution.' })
        : f.owner.mutation(api.quizzes.createWithQuestions, { folderId: f.folderId, title: 'Copy', questions: [{ type: 'free-response', order: 0, question: 'A new hash', correctAnswer: 'A rewritten private solution.' }] })
    await expect(write).rejects.toThrow(/unavailable|reservation check/)
    expect(await inventory(f)).toEqual(before)
  })
  test.each(['questionSnapshot', 'rubricSnapshot'] as const)('pending aliases reject a substituted %s before returning scorer material', async field => {
    const f = await fixture(false)
    await f.t.run(async ctx => {
      const row = (await ctx.db.query('quizAnswerAssessments').withIndex('by_attemptId', q => q.eq('attemptId', f.attemptId)).take(1))[0]!
      await ctx.db.patch(row._id, field === 'questionSnapshot' ? { questionSnapshot: { ...row.questionSnapshot, evidenceExcerpt: canary } } : { rubricSnapshot: [{ label: 'fully_correct', description: canary }] })
    })
    await expect(f.owner.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId: f.attemptId })).rejects.toThrow('Teaching input is unavailable')
    await expect(f.owner.query(api.quizAnswerAssessments.listPendingForShadowAttempt, { attemptId: f.attemptId })).rejects.toThrow('Teaching input is unavailable')
    expect(await f.owner.query(api.quizzes.getAttemptResults, { attemptId: f.attemptId })).toBeTruthy()
  })
})
