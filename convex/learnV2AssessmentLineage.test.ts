/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { artifactManifestDigest, prepareAndRegisterInstructionalArtifacts } from './lib/learnV2ArtifactLineage'
import * as courses from './courses'
import * as courseSections from './courseSections'
import * as documents from './documents'
import * as folders from './folders'
import * as courseSourceDocs from './courseSourceDocs'
import * as reviewItems from './reviewItems'
import * as audioOverviewRooms from './audioOverviewRooms'
import { invokePrivacyQuery, tracePrivacyReads } from '../tests/fixtures/learn-v2-privacy-reads'
import { ASSESSMENT_DISCLOSURE_OTHER_OWNERS } from './lib/learnV2AssessmentDisclosure'
import producerGuide from '../docs/plans/learn-v2-c1-public-api-contract.md?raw'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

const modules = import.meta.glob('./**/*.ts')
const identity = { tokenIdentifier: 'https://auth.example|c43-owner', subject: 'same' }
const userId = identity.tokenIdentifier
const base = { userId, storageVersion: 'learn-v2.measurement-storage.v1' as const, createdAt: 1_800_000_000_000 }
const canary = 'held-out-private-scoring-canary'
const settings = { shuffleQuestions: false, showAllQuestions: false, immediateFeedback: false }

test.each(ASSESSMENT_DISCLOSURE_OTHER_OWNERS['C4.3 #431'])('%s is mapped in the producer contract inventory', surface => {
  const inventory = producerGuide.split('### C4.3 producer and legacy surface inventory')[1]!
  expect(inventory).toContain(`\`${surface}\``)
})

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

async function restrict(f: Fixture, kind: 'quiz_question' | 'section_block' | 'document' | 'document_chunk' | 'flashcard_version' | 'audio_overview', classification: 'measurement' | 'private_scoring' | 'unknown' = 'private_scoring') {
  const id = kind === 'quiz_question' ? f.questionId : kind === 'section_block' ? f.sectionId : kind === 'flashcard_version' ? f.versionId : kind === 'audio_overview' ? f.overviewId : f.documentId
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
    rooms: await ctx.db.query('flashcardRooms').withIndex('by_userId', q => q.eq('userId', userId)).take(100),
    cards: await ctx.db.query('flashcardRoomCards').withIndex('by_userId', q => q.eq('userId', userId)).take(200),
    versionCards: await ctx.db.query('flashcardVersionCards').withIndex('by_userId', q => q.eq('userId', userId)).take(200),
    versions: await ctx.db.query('flashcardRoomVersions').withIndex('by_userId', q => q.eq('userId', userId)).take(200),
    lineages: await ctx.db.query('learnArtifactLineages').withIndex('by_userId', q => q.eq('userId', userId)).take(200),
    overviews: await ctx.db.query('audioOverviews').withIndex('by_userId', q => q.eq('userId', userId)).take(100),
    reviewItems: await ctx.db.query('reviewItems').withIndex('by_userId', q => q.eq('userId', userId)).take(200),
    attempts: await ctx.db.query('quizAttempts').withIndex('by_userId', q => q.eq('userId', userId)).take(200),
  }))
}
const quizEntries: Array<[string, (f: Fixture) => Promise<unknown>]> = [
  ['submitAnswer', async f => {
    return f.owner.mutation(api.quizzes.submitAnswer, { attemptId: f.attemptId, questionId: f.questionId, userAnswer: 'Own work' })
  }],
  ['submitAllAnswers', async f => {
    return f.owner.mutation(api.quizzes.submitAllAnswers, { attemptId: f.attemptId, answers: [{ questionId: f.questionId, userAnswer: 'Own work' }] })
  }],
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
  test.each(quizEntries)('%s rejects private lineage on either enrollment state', async (name, run) => {
    for (const enrolled of [true, false]) {
      const f = await fixture(enrolled)
      if (name === 'submitAnswer' || name === 'submitAllAnswers') await f.t.run(ctx => ctx.db.patch(f.attemptId, { status: 'in_progress' }))
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
  test.each(sectionEntries)('%s rejects direct protected section lineage', async (_name, run) => {
    const f = await fixture(false)
    await restrict(f, 'section_block')
    const before = await inventory(f)
    await expect(run(f)).rejects.toThrow('Teaching input is unavailable')
    expect(await inventory(f)).toEqual(before)
  })
  test.each(quizEntries)('%s rejects a retired reserved case before adopting an answer', async (name, run) => {
    const f = await fixture(false)
    if (name === 'submitAnswer' || name === 'submitAllAnswers') await f.t.run(ctx => ctx.db.patch(f.attemptId, { status: 'in_progress' }))
    await f.t.run(async ctx => {
      const lineage = (await ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', 'quiz_question').eq('artifact.id', f.questionId).eq('nextId', undefined)).take(1))[0]!
      const binding = (await ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', lineage._id)).take(1))[0]!
      await ctx.db.patch(binding.caseId, { reservedAt: 0 })
    })
    const before = await inventory(f)
    await expect(run(f)).rejects.toThrow('Teaching input is unavailable')
    expect(await inventory(f)).toEqual(before)
  })
  test.each(['document', 'document_chunk'] as const)('course/Quiz/card scope rejects a restrictive %s representation', async kind => {
    const f = await fixture(false)
    await restrict(f, kind)
    await expect(f.owner.query(api.documents.getTeachingScope, { folderId: f.folderId })).rejects.toThrow('Teaching input is unavailable')
    await expect(f.owner.mutation(api.quizzes.createWithQuestions, { folderId: f.folderId, title: 'copy', questions: [{ type: 'free-response', order: 0, question: 'Rewrite', correctAnswer: 'copy', sourceDocumentId: f.documentId }] })).rejects.toThrow('Teaching input is unavailable')
    await expect(f.owner.mutation(api.flashcardRooms.generateRoomCards, { roomId: f.roomId, origin: 'ai', cards: [{ term: 'Copy', definition: 'Rewrite', metadata: { source: { documentId: f.documentId, filename: 'copy', chunkContent: canary } } }] })).rejects.toThrow('Teaching input is unavailable')
  })
  test.each(['getRoom', 'getRoomVersion', 'restoreRoomVersion', 'listRoomVersions'] as const)('%s refuses a private version, including restore replay', async entry => {
    const f = await fixture()
    await restrict(f, 'flashcard_version')
    const work = entry === 'listRoomVersions' ? f.owner.query(api.flashcardRooms.listRoomVersions, { roomId: f.roomId }) : entry === 'getRoom' ? f.owner.query(api.flashcardRooms.getRoom, { roomId: f.roomId }) : entry === 'getRoomVersion' ? f.owner.query(api.flashcardRooms.getRoomVersion, { versionId: f.versionId }) : f.owner.mutation(api.flashcardRooms.restoreRoomVersion, { roomId: f.roomId, versionId: f.versionId })
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
  test.each([NaN, Infinity, 0, 201, 1.5])('invalid requested card count %s cannot authorize a producing write', async requestedCardCount => {
    const f = await fixture(false)
    const before = await inventory(f)
    await expect(f.owner.mutation(api.flashcardRooms.generateRoomCards, { roomId: f.roomId, origin: 'ai', requestedCardCount, cards: [{ term: 'New', definition: 'New' }] })).rejects.toThrow('Flashcards exceed the requested publication size')
    expect(await inventory(f)).toEqual(before)
  })
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
  test.each(['quiz', 'cards'] as const)('the internal course %s seam requires a session and rejects reserved output atomically', async kind => {
    const f = await fixture()
    const write = (authenticated: boolean) => {
      const caller = authenticated ? f.owner : f.t
      return kind === 'quiz'
        ? caller.mutation(internal.quizzes.createCourseScopedQuiz, { userId, courseId: f.courseId, folderId: f.folderId, title: 'Internal Quiz', questions: [{ order: 0, type: 'free-response', question: 'Rewritten question', correctAnswer: 'Rewritten solution' }] })
        : caller.mutation(internal.flashcardRooms.createCourseScopedRoom, { userId, folderId: f.folderId, title: 'Internal cards', cards: [{ term: 'Rewritten term', definition: 'Rewritten solution', sourceFilename: 'owned.txt', sourceChunkContent: 'A snippet grants no identity.' }] })
    }
    const before = await inventory(f)
    await expect(write(false)).rejects.toThrow('Unauthenticated')
    expect(await inventory(f)).toEqual(before)
    await f.t.run(async ctx => {
      const cases = await ctx.db.query('learnAssessmentCases').withIndex('by_userId', q => q.eq('userId', userId)).take(100)
      await ctx.db.patch(cases[0]!._id, { reservedAt: 0 })
    })
    const reserved = await inventory(f)
    await expect(write(true)).rejects.toThrow(/reservation check/)
    expect(await inventory(f)).toEqual(reserved)
  })
})

const writers: Array<[string, 'quiz_question' | 'flashcard_version', (f: Fixture) => Promise<unknown>]> = [
  ['quizzes.updateQuestion', 'quiz_question', f => f.owner.mutation(api.quizzes.updateQuestion, { questionId: f.questionId, correctAnswer: 'Edited answer' })],
  ['quizzes.addQuestion', 'quiz_question', f => f.owner.mutation(api.quizzes.addQuestion, { quizId: f.quizId, type: 'free-response', questionText: 'New question', correctAnswer: 'New answer' })],
  ['quizzes.deleteQuestion', 'flashcard_version', f => f.owner.mutation(api.quizzes.deleteQuestion, { questionId: f.questionId })],
  ['contentFlags.flagQuizQuestion', 'quiz_question', f => f.owner.mutation(api.contentFlags.flagQuizQuestion, { questionId: f.questionId, correctedAnswer: 'Corrected answer' })],
  ['contentFlags.unflagQuizQuestion', 'quiz_question', f => f.owner.mutation(api.contentFlags.unflagQuizQuestion, { questionId: f.questionId })],
  ['courseSections.updateTitle', 'quiz_question', f => f.owner.mutation(api.courseSections.updateTitle, { sectionId: f.sectionId, title: 'New title' })],
  ['courseSections.updateKnowledgeType', 'quiz_question', f => f.owner.mutation(api.courseSections.updateKnowledgeType, { sectionId: f.sectionId, knowledgeType: 'procedural' })],
  ['courseSections.updateOrder', 'quiz_question', f => f.owner.mutation(api.courseSections.updateOrder, { courseId: f.courseId, sectionIds: [f.sectionId] })],
  ['courseSections.remove', 'quiz_question', f => f.owner.mutation(api.courseSections.remove, { sectionId: f.sectionId })],
  ['courseSections.markReady', 'quiz_question', f => f.owner.mutation(internal.courseSections.markReady, { sectionId: f.sectionId, contentBlocks: [{ type: 'text', order: 0, content: 'New teaching' }] })],
  ['courseSections.finalizeSectionGeneration', 'quiz_question', f => f.owner.mutation(api.courseSections.finalizeSectionGeneration, { sectionId: f.sectionId, textContent: 'New teaching' })],
  ['flashcardRooms.createCard', 'flashcard_version', f => f.owner.mutation(api.flashcardRooms.createCard, { roomId: f.roomId, term: 'Second', definition: 'Second definition' })],
  ['flashcardRooms.updateCard', 'flashcard_version', async f => f.owner.mutation(api.flashcardRooms.updateCard, { cardId: (await f.t.run(ctx => ctx.db.query('flashcardRoomCards').withIndex('by_roomId', q => q.eq('roomId', f.roomId)).first()))!._id, term: 'Edited', definition: 'Edited definition' })],
  ['flashcardRooms.deleteCard', 'flashcard_version', async f => f.owner.mutation(api.flashcardRooms.deleteCard, { cardId: (await f.t.run(ctx => ctx.db.query('flashcardRoomCards').withIndex('by_roomId', q => q.eq('roomId', f.roomId)).first()))!._id })],
  ['flashcardRooms.reorderCards', 'flashcard_version', async f => f.owner.mutation(api.flashcardRooms.reorderCards, { roomId: f.roomId, order: [{ cardId: (await f.t.run(ctx => ctx.db.query('flashcardRoomCards').withIndex('by_roomId', q => q.eq('roomId', f.roomId)).first()))!._id, displayOrder: 0 }] })],
  ['flashcardRooms.generateRoomCards', 'flashcard_version', f => f.owner.mutation(api.flashcardRooms.generateRoomCards, { roomId: f.roomId, origin: 'manual', requestedCardCount: 1, cards: [{ term: 'New', definition: 'New definition' }] })],
  ['flashcardRooms.restoreRoomVersion', 'flashcard_version', f => f.owner.mutation(api.flashcardRooms.restoreRoomVersion, { roomId: f.roomId, versionId: f.versionId })],
  ['contentFlags.flagFlashcard', 'flashcard_version', async f => f.owner.mutation(api.contentFlags.flagFlashcard, { cardId: (await f.t.run(ctx => ctx.db.query('flashcardRoomCards').withIndex('by_roomId', q => q.eq('roomId', f.roomId)).first()))!._id, correctedDefinition: 'Corrected' })],
  ['contentFlags.unflagFlashcard', 'flashcard_version', async f => f.owner.mutation(api.contentFlags.unflagFlashcard, { cardId: (await f.t.run(ctx => ctx.db.query('flashcardRoomCards').withIndex('by_roomId', q => q.eq('roomId', f.roomId)).first()))!._id })],
]

describe('C4.3 complete writer admission and re-registration', () => {
  test.each(writers)('%s rejects protected input without persisting a prefix', async (_name, kind, write) => {
    const f = await fixture()
    await restrict(f, kind)
    const before = await inventory(f)
    await expect(write(f)).rejects.toThrow(/unavailable|reservation check/)
    expect(await inventory(f)).toEqual(before)
  })
  test.each(writers.filter(([name]) => !['courseSections.remove', 'quizzes.deleteQuestion', 'courseSections.markReady', 'courseSections.finalizeSectionGeneration'].includes(name)))('%s keeps ordinary teaching and every affected current key usable', async (name, _kind, write) => {
    const f = await fixture()
    if (name === 'flashcardRooms.deleteCard') await f.owner.mutation(api.flashcardRooms.createCard, { roomId: f.roomId, term: 'Survivor', definition: 'Remaining teaching' })
    await f.owner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [
      { artifact: { kind: 'quiz_question', id: f.questionId }, key: 'alias', sources: [], origins: [] },
      { artifact: { kind: 'flashcard_version', id: f.versionId }, key: 'alias', sources: [], origins: [] },
      { artifact: { kind: 'section_block', id: f.sectionId }, key: 'alias', sources: [], origins: [] },
    ] }))
    await write(f)
    expect(await f.owner.query(api.courseSections.getOfflineCachePayload, { sectionId: f.sectionId })).toBeTruthy()
    expect(await f.owner.query(api.quizzes.getWithQuestions, { id: f.quizId })).toBeTruthy()
    expect(await f.owner.query(api.flashcardRooms.getRoom, { roomId: f.roomId })).toBeTruthy()
  })
  test.each(['getForGeneration', 'completeSection', 'reviewSection'] as const)('%s rejects private nested input before generation or review extraction', async entry => {
    const f = await fixture()
    await restrict(f, 'quiz_question')
    const before = await inventory(f)
    const run = entry === 'getForGeneration' ? f.owner.query(internal.courseSections.getForGeneration, { sectionId: f.sectionId }) : entry === 'completeSection' ? f.owner.mutation(api.courseSections.completeSection, { sectionId: f.sectionId, practiceScore: 80, quizCorrect: 1, quizTotal: 1 }) : f.owner.mutation(api.courseSections.reviewSection, { sectionId: f.sectionId, practiceScore: 80, quizCorrect: 1, quizTotal: 1 })
    await expect(run).rejects.toThrow('Teaching input is unavailable')
    expect(await inventory(f)).toEqual(before)
    expect(await f.t.run(ctx => ctx.db.query('reviewItems').withIndex('by_userId', q => q.eq('userId', userId)).take(1))).toEqual([])
  })
  test('deletion retains case history and re-registers reordered survivors and containing sections', async () => {
    const f = await fixture()
    await f.owner.mutation(api.quizzes.addQuestion, { quizId: f.quizId, type: 'free-response', questionText: 'Second question', correctAnswer: 'Second answer' })
    const cases = await f.t.run(ctx => ctx.db.query('learnAssessmentCases').withIndex('by_userId', q => q.eq('userId', userId)).take(100))
    await f.owner.mutation(api.quizzes.deleteQuestion, { questionId: f.questionId })
    expect((await f.owner.query(api.quizzes.getWithQuestions, { id: f.quizId }))?.questions[0]?.order).toBe(0)
    expect(await f.owner.query(api.courseSections.getOfflineCachePayload, { sectionId: f.sectionId })).toBeTruthy()
    expect((await f.t.run(ctx => ctx.db.query('learnAssessmentCases').withIndex('by_userId', q => q.eq('userId', userId)).take(100))).map(row => row._id)).toEqual(expect.arrayContaining(cases.map(row => row._id)))
  })
  test('standalone card corrections register their effective answer and keep the original immutable version', async () => {
    const f = await fixture()
    await f.t.run(ctx => ctx.db.patch(f.sectionId, { contentBlocks: [] }))
    const card = (await f.t.run(ctx => ctx.db.query('flashcardRoomCards').withIndex('by_roomId', q => q.eq('roomId', f.roomId)).first()))!
    await f.owner.mutation(api.contentFlags.flagFlashcard, { cardId: card._id, correctedDefinition: 'A new corrected answer' })
    const room = (await f.owner.query(api.flashcardRooms.getRoom, { roomId: f.roomId }))!
    expect(room.room.activeVersionId).not.toBe(f.versionId)
    expect((await f.owner.query(api.flashcardRooms.getRoomVersion, { versionId: room.room.activeVersionId }))?.cards[0]?.definition).toBe('A new corrected answer')
    expect((await f.owner.query(api.flashcardRooms.getRoomVersion, { versionId: f.versionId }))?.cards[0]?.definition).toBe('Gas becomes liquid.')
  })
  test.each(['markReady', 'finalizeSectionGeneration'] as const)('%s replaces all section aliases in one publication', async writer => {
    const f = await fixture()
    await f.owner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [{ artifact: { kind: 'section_block', id: f.sectionId }, key: 'alias', sources: [], origins: [] }] }))
    if (writer === 'markReady') await f.owner.mutation(internal.courseSections.markReady, { sectionId: f.sectionId, contentBlocks: [{ type: 'text', order: 0, content: 'New complete teaching.' }] })
    else await f.owner.mutation(api.courseSections.finalizeSectionGeneration, { sectionId: f.sectionId, textContent: 'New complete teaching.', quizData: { title: 'New Quiz', questions: [{ order: 0, type: 'free-response', question: 'New question', correctAnswer: 'New answer' }] }, flashcardData: { title: 'New cards', cards: [{ term: 'New term', definition: 'New definition' }] } })
    expect(await f.owner.query(api.courseSections.get, { id: f.sectionId })).toMatchObject({ status: 'ready' })
    await f.t.run(ctx => ctx.db.patch(f.sectionId, { status: 'completed' }))
    expect(await f.owner.query(api.courseSections.getOfflineCachePayload, { sectionId: f.sectionId })).toBeTruthy()
    const rows = await f.t.run(ctx => ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', 'section_block').eq('artifact.id', f.sectionId).eq('nextId', undefined)).take(16))
    expect(rows.map(row => row.key)).toEqual(expect.arrayContaining(['alias', 'block.0', 'block.1', 'block.2', 'block.3']))
    expect(new Set(rows.map(row => row.payloadDigest)).size).toBe(1)
  })
  test.each(['remove', 'updateOrder'] as const)('%s re-registers every shifted sibling and its aliases', async writer => {
    const f = await fixture()
    const siblingId = await f.t.run(ctx => ctx.db.insert('courseSections', { userId, courseId: f.courseId, title: 'Sibling', order: 1, knowledgeType: 'conceptual', status: 'ready', masteryLevel: 'new', contentBlocks: [{ type: 'text', order: 0, content: 'Sibling teaching.' }] }))
    await f.owner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: ['block.0', 'alias'].map(key => ({ artifact: { kind: 'section_block' as const, id: siblingId }, key, sources: [], origins: [] })) }))
    if (writer === 'remove') await f.owner.mutation(api.courseSections.remove, { sectionId: f.sectionId })
    else await f.owner.mutation(api.courseSections.updateOrder, { courseId: f.courseId, sectionIds: [siblingId, f.sectionId] })
    expect((await f.owner.query(api.courseSections.get, { id: siblingId }))?.order).toBe(0)
    await f.t.run(ctx => ctx.db.patch(siblingId, { status: 'completed' }))
    expect(await f.owner.query(api.courseSections.getOfflineCachePayload, { sectionId: siblingId })).toBeTruthy()
    const rows = await f.t.run(ctx => ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', 'section_block').eq('artifact.id', siblingId).eq('nextId', undefined)).take(16))
    expect(rows.map(row => row.key).sort()).toEqual(['alias', 'block.0'])
    expect(new Set(rows.map(row => row.payloadDigest)).size).toBe(1)
  })
})


test('an enrolled empty version fails closed without fabricating a teaching case', async () => {
  const f = await fixture()
  const card = (await f.t.run(ctx => ctx.db.query('flashcardRoomCards').withIndex('by_roomId', q => q.eq('roomId', f.roomId)).first()))!
  const before = await inventory(f)
  await expect(f.owner.mutation(api.flashcardRooms.deleteCard, { cardId: card._id })).rejects.toThrow('Artifact lineage unavailable')
  expect(await inventory(f)).toEqual(before)
  expect(await f.t.run(ctx => ctx.db.get(card._id))).toEqual(card)
})

test('generated-title indexes omit protected Quiz, deck and Audio publications', async () => {
  const f = await fixture()
  const { roomId } = await f.owner.mutation(api.audioOverviewRooms.create, { folderId: f.folderId })
  await f.t.run(ctx => ctx.db.patch(f.overviewId, { roomId }))
  await f.owner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [{ artifact: { kind: 'audio_overview', id: f.overviewId }, key: 'whole', sources: [], origins: [] }] }))
  await restrict(f, 'quiz_question')
  await restrict(f, 'flashcard_version')
  await restrict(f, 'audio_overview')
  expect(await f.owner.query(api.quizzes.listByFolder, { folderId: f.folderId })).toEqual([])
  expect(await f.owner.query(api.flashcardRooms.listRoomsByFolder, { folderId: f.folderId })).toEqual([])
  expect(await f.owner.query(api.audioOverviews.listByFolder, { folderId: f.folderId })).toEqual([])
  expect(await f.owner.query(api.audioOverviews.listByRoom, { roomId })).toEqual([])
  await expect(f.owner.query(api.audioOverviews.getCourseScopedOverview, { id: f.overviewId })).rejects.toThrow('Teaching input is unavailable')
})

test('metadata and legacy review boundaries read no measurement or scoring input', async () => {
  const f = await fixture(false)
  const conversationId = await f.t.run(async ctx => {
    const id = await ctx.db.insert('conversations', { userId, folderId: f.folderId, title: 'Own conversation' })
    await ctx.db.insert('audioOverviewRooms', { userId, folderId: f.folderId, conversationId: id, title: 'Own room', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('courseSourceDocs', { userId, courseId: f.courseId, folderId: f.folderId, documentId: f.documentId })
    await ctx.db.insert('reviewItems', { userId, courseId: f.courseId, sectionId: f.sectionId, prompt: 'Own legacy prompt', answer: 'Own legacy answer', easeFactor: 2.5, interval: 1, repetitions: 0, nextReviewDate: '2000-01-01', flagged: false, createdAt: 1 })
    return id
  })
  await restrict(f, 'quiz_question')
  await restrict(f, 'document')
  await restrict(f, 'audio_overview')
  await f.owner.run(async ctx => {
    const trace = tracePrivacyReads(ctx)
    const outputs = [
      await invokePrivacyQuery(courses.get, trace.ctx, { id: f.courseId }),
      await invokePrivacyQuery(courses.listByUser, trace.ctx, {}),
      await invokePrivacyQuery(courses.listByFolder, trace.ctx, { folderId: f.folderId }),
      await invokePrivacyQuery(courseSections.checkPreFetchStatus, trace.ctx, { courseId: f.courseId, currentOrder: -1 }),
      await invokePrivacyQuery(documents.listDocumentsByFolder, trace.ctx, { folderId: f.folderId }),
      await invokePrivacyQuery(folders.resolveScope, trace.ctx, { folderIds: [f.folderId], fileIds: [f.documentId] }),
      await invokePrivacyQuery(folders.searchScopeItems, trace.ctx, { rootFolderId: f.folderId, search: '' }),
      await invokePrivacyQuery(courseSourceDocs.listByCourse, trace.ctx, { courseId: f.courseId }),
      await invokePrivacyQuery(reviewItems.listDueForUser, trace.ctx, {}),
      await invokePrivacyQuery(reviewItems.listDueWithContext, trace.ctx, {}),
      await invokePrivacyQuery(reviewItems.listBySection, trace.ctx, { sectionId: f.sectionId }),
      await invokePrivacyQuery(audioOverviewRooms.listByFolder, trace.ctx, { folderId: f.folderId }),
      await invokePrivacyQuery(audioOverviewRooms.getForConversation, trace.ctx, { conversationId }),
    ]
    expect(outputs.slice(8, 11).every(output => JSON.stringify(output).includes('Own legacy answer'))).toBe(true)
    expect(JSON.stringify(outputs)).not.toContain(canary)
    const allowed = ['accountDeletionJobs', 'courses', 'courseSections', 'folders', 'documents', 'courseSourceDocs', 'reviewItems', 'learnProfile', 'audioOverviewRooms', 'conversations']
    for (const key of Object.keys(trace.stats.byTable)) expect(allowed).toContain(key.split(':')[1])
  })
})
