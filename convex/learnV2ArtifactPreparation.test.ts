/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import schema from './schema'
import {
  advanceAssessmentCatalogForOwner, classifyPersonalWorkDocumentForOwner, classifyPersonalWorkDocumentForRecord,
  createArtifactLineageReadContext, instructionalReservationSemanticAdapter, isArtifactRegistrationRequired,
  isArtifactRegistrationRequiredForOwner, isArtifactRegistrationRequiredForRecord, normalizedInstructionalCaseFingerprints,
  prepareAndRegisterInstructionalArtifacts, prepareAndRegisterInstructionalArtifactsForOwner, prepareAndRegisterInstructionalArtifactsForRecord,
  resolveArtifactLineageForOwner,
  admitArtifactInput, artifactContentProjection, artifactPayloadDigest,
} from './lib/learnV2ArtifactLineage'
import { LEARN_ARTIFACT_CASE_IDENTITY_VERSION, LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY, LEARN_ARTIFACT_LINEAGE_LIMITS, type LearnArtifactPreparationArgs } from '../shared/learn-v2-artifact-lineage'

const modules = import.meta.glob('./**/*.ts')
const owner = { tokenIdentifier: 'https://auth.example.com|preparation-owner', subject: 'same-subject' }
const foreign = { tokenIdentifier: 'https://other.example.com|preparation-owner', subject: 'same-subject' }
const userId = owner.tokenIdentifier
const base = { userId, storageVersion: 'learn-v2.measurement-storage.v1' as const, createdAt: 1_800_000_000_000 }
type Store = TestConvex<typeof schema>
type Fixture = Awaited<ReturnType<typeof setup>>

afterEach(() => { vi.restoreAllMocks() })

function member(artifact: LearnArtifactPreparationArgs['artifacts'][number]['artifact'], key = 'whole'): LearnArtifactPreparationArgs['artifacts'][number] {
  return { artifact, key, origins: [], sources: [] }
}

async function setup(enabled: boolean | undefined = true, historyCompleteness: Doc<'learnAssessmentCatalogs'>['historyCompleteness'] = 'prospective_complete') {
  const t = convexTest(schema, modules)
  const f = await t.run(async ctx => {
    const folderId = await ctx.db.insert('folders', { userId, name: 'Owned source', documentCount: 1 })
    const documentId = await ctx.db.insert('documents', { userId, folderId, filename: 'notes.txt', fileSize: 12, status: 'success',
      sourceRevision: 'source.r1', contentHash: 'a'.repeat(64), r2Key: 'owned/notes.r1' })
    const catalogId = await ctx.db.insert('learnAssessmentCatalogs', { ...base, catalogRevision: 0, instrumentationEpoch: 'prospective.epoch.v1',
      historyCompleteness, historyBasisVersion: 'history.v1', historyCoverageWatermark: 'coverage.v1',
      ...(enabled === undefined ? {} : { measurementCapability: { enabled } }) })
    return { folderId, documentId, catalogId }
  })
  return { t, asOwner: t.withIdentity(owner), ...f }
}

async function writeQuiz(ctx: MutationCtx, f: Pick<Fixture, 'folderId' | 'documentId'>, questions = [{ question: 'How does rain form?', answer: 'Water condenses.' }], sourceText?: string) {
  const quizId = await ctx.db.insert('quizzes', { userId, folderId: f.folderId, title: 'Quiz', status: 'ready', questionCount: questions.length, creationMethod: 'auto_generated' })
  const artifacts = []
  for (const [order, q] of questions.entries()) {
    const id = await ctx.db.insert('quizQuestions', { userId, quizId, order, question: q.question, correctAnswer: q.answer, type: 'free-response',
      sourceDocumentId: f.documentId, sourceChunkContent: sourceText })
    artifacts.push(member({ kind: 'quiz_question', id }))
  }
  return { quizId, artifacts }
}

async function publishQuiz(f: Fixture, questions?: Array<{ question: string, answer: string }>) {
  return f.asOwner.run(async ctx => {
    const quiz = await writeQuiz(ctx, f, questions)
    return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: quiz.artifacts })
  })
}

async function inventory(t: Store) {
  return t.run(async ctx => ({
    catalogs: await ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', userId)).take(3),
    quizzes: await ctx.db.query('quizzes').withIndex('by_userId', q => q.eq('userId', userId)).take(60),
    questions: await ctx.db.query('quizQuestions').withIndex('by_userId', q => q.eq('userId', userId)).take(60),
    cases: await ctx.db.query('learnAssessmentCases').withIndex('by_userId', q => q.eq('userId', userId)).take(300),
    lineages: await ctx.db.query('learnArtifactLineages').withIndex('by_userId', q => q.eq('userId', userId)).take(60),
    origins: await ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId', q => q.eq('userId', userId)).take(60),
    bindings: await ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId', q => q.eq('userId', userId)).take(100),
    validations: await ctx.db.query('learnArtifactValidations').withIndex('by_userId', q => q.eq('userId', userId)).take(60),
    sources: await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId', q => q.eq('userId', userId)).take(100),
    exposures: await ctx.db.query('learnAssessmentExposures').withIndex('by_userId', q => q.eq('userId', userId)).take(1),
  }))
}

async function reserve(ctx: MutationCtx, scenario = 'Reserved task', solution = 'Reserved solution', byClass = false) {
  const fingerprints = await normalizedInstructionalCaseFingerprints(scenario, solution)
  const caseId = await ctx.db.insert('learnAssessmentCases', { ...base, ...fingerprints, identityPolicyVersion: LEARN_ARTIFACT_CASE_IDENTITY_VERSION,
    caseKey: `reserved:${scenario}`, usageClass: 'unknown', ...(byClass ? {} : { reservedAt: 0 }) })
  if (byClass) {
    const folderId = await ctx.db.insert('folders', { userId, name: 'Measurement', documentCount: 0 })
    const learningVoidId = await ctx.db.insert('learningVoids', { userId, folderId, title: 'Measurement', status: 'active', revision: 1, createdAt: base.createdAt, updatedAt: base.createdAt })
    const blueprintId = await ctx.db.insert('learnBlueprints', { userId, learningVoidId, revision: 1, createdAt: base.createdAt })
    const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { userId, blueprintId, learningVoidId, revision: 1, recordRevision: 1, status: 'active', createdAt: base.createdAt, updatedAt: base.createdAt })
    const objectiveId = await ctx.db.insert('learnObjectives', { userId, blueprintRevisionId, order: 0, title: 'Measurement' })
    const validationId = await ctx.db.insert('learnMeasurementValidations', { ...base, learningVoidId, blueprintRevisionId, objectiveId, blueprintRecordRevision: 1,
      assessmentContractVersion: 'fixture.v1', assessmentContractDigest: 'e'.repeat(64), depth: 'working', evidenceStatus: 'available', subject: { kind: 'case', caseId }, subjectRevision: 1,
      subjectDigest: 'b'.repeat(64), check: 'same_case_novelty', decision: 'pass', reasonCode: 'fixture', validatorVersion: 'fixture.v1', validatorModel: null,
      promptVersion: 'fixture.v1', harnessArtifactDigest: 'c'.repeat(64), comparedCatalogRevision: 0, corpusDigest: 'd'.repeat(64), coverageWatermark: 'coverage.v1' })
    await ctx.db.patch(caseId, { usageClass: 'measurement_reserved', identityValidationId: validationId })
  }
  return caseId
}

describe('in-transaction artifact preparation', () => {
  test('records a vacuous pass against the current explicit history basis, without semantic dispatch or exposure', async () => {
    const f = await setup()
    const semantic = vi.spyOn(instructionalReservationSemanticAdapter, 'compare')
    const result = await publishQuiz(f)
    expect(result.catalogRevision).toBe(1)
    expect(semantic).not.toHaveBeenCalled()
    const state = await inventory(f.t)
    expect(state.catalogs).toMatchObject([{ catalogRevision: 1, historyCompleteness: 'prospective_complete', historyBasisVersion: 'history.v1' }])
    expect(state.lineages).toMatchObject([{ classification: 'teaching', authority: 'server_producer', caseCount: 1, sourceCount: 1, publication: { catalogRevision: 1 } }])
    expect(state.validations).toMatchObject([{ decision: 'pass', comparedCatalogRevision: 0, coverage: 'complete', coverageWatermark: 'coverage.v1', validatorModel: null,
      preparation: { kind: 'instructional_reservation', reservedCaseCount: 0, deterministicDecision: 'pass', semanticDecision: 'not_required',
        historyCompleteness: 'prospective_complete', historyBasisVersion: 'history.v1', instrumentationEpoch: 'prospective.epoch.v1' } }])
    expect(state.cases).toMatchObject([{ usageClass: 'instructional', artifactIdentityValidationId: state.validations[0]!._id }])
    expect(state.sources).toMatchObject([{ dependency: { kind: 'document', documentId: f.documentId, sourceRevision: 'source.r1' } }])
    expect(state.exposures).toEqual([])
    const resolved = await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference: result.references[0] }))
    expect(resolved).toMatchObject({ status: 'bound', instructionalRegistered: true })
    for (const collection of ['learnArtifactValidations', 'learnAssessmentCatalogs'] as const) {
      const exported = await f.asOwner.query(api.dataExport.getUserDataPage, { collection, paginationOpts: { cursor: null, numItems: 8 } })
      expect(exported.page).toHaveLength(1)
      expect(exported.page[0]).not.toHaveProperty('preparation')
      expect(exported.page[0]).not.toHaveProperty('measurementCapability')
    }
  })

  test('reuses normalized identities across new artifact IDs and preserves append-only decisions', async () => {
    const f = await setup()
    const first = await publishQuiz(f, [{ question: 'ＦＩＮＤ   X', answer: 'The FIRST solution' }])
    const original = await inventory(f.t)
    const second = await publishQuiz(f, [{ question: 'find x', answer: '  the first\nsolution  ' }])
    const state = await inventory(f.t)
    expect(state.cases).toHaveLength(1)
    expect(state.bindings.map(binding => binding.caseId)).toEqual([state.cases[0]!._id, state.cases[0]!._id])
    expect(state.validations[0]).toEqual(original.validations[0])
    expect(state.cases[0]!.artifactIdentityValidationId).toBe(original.validations[0]!._id)
    expect(second.references[0]!.payloadDigest).not.toBe(first.references[0]!.payloadDigest)
    expect(state.validations.map(row => row.comparedCatalogRevision)).toEqual([0, 1])
  })

  test('reuses a solution-only identity when the new scenario fingerprint differs', async () => {
    const f = await setup()
    await publishQuiz(f, [{ question: 'Original scenario', answer: 'Shared solution' }])
    const before = await inventory(f.t)
    await publishQuiz(f, [{ question: 'A different scenario', answer: '  SHARED\nsolution ' }])
    const after = await inventory(f.t)
    expect(after.cases).toEqual(before.cases)
    expect(after.bindings.map(binding => binding.caseId)).toEqual([before.cases[0]!._id, before.cases[0]!._id])
    expect(after.validations.map(validation => validation.comparedCatalogRevision)).toEqual([0, 1])
  })

  test('semantic pass with unknown comparison coverage still rolls back publication', async () => {
    const f = await setup()
    await f.t.run(ctx => reserve(ctx))
    const before = await inventory(f.t)
    const semantic = vi.spyOn(instructionalReservationSemanticAdapter, 'compare').mockResolvedValue({ decision: 'pass', coverage: 'unknown' })
    await expect(publishQuiz(f)).rejects.toThrow('Instructional reservation check unknown')
    expect(semantic).toHaveBeenCalledOnce()
    expect(await inventory(f.t)).toEqual(before)
  })

  test.each([false, true])('fresh Quiz input admission follows enrollment: %s', async enrolled => {
    const f = await setup(enrolled)
    const ref = await f.t.run(async ctx => {
      const quiz = await writeQuiz(ctx, f)
      const artifact = quiz.artifacts[0]!.artifact
      if (artifact.kind !== 'quiz_question') throw new Error('Expected question')
      const question = (await ctx.db.get(artifact.id))!
      const payloadDigest = await artifactPayloadDigest(artifactContentProjection({ kind: 'quiz_question', question }))
      return { artifact, key: 'whole', revision: `sha256:${payloadDigest}`, payloadDigest }
    })
    expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: ref }))).toMatchObject({ status: enrolled ? 'rejected' : 'admitted_unregistered' })
  })

  test.each(['scenario', 'solution', 'cross_role', 'usage_class'] as const)('rejects a normalized reserved %s collision and rolls back the entire producer', async kind => {
    const f = await setup()
    await f.t.run(ctx => reserve(ctx, 'ＦＩＮＤ X', 'Kept solution', kind === 'usage_class'))
    const before = await inventory(f.t)
    const semantic = vi.spyOn(instructionalReservationSemanticAdapter, 'compare')
    const question = kind === 'scenario' || kind === 'usage_class' ? '  find\nX  ' : kind === 'cross_role' ? 'KEPT SOLUTION' : 'Different task'
    const answer = kind === 'solution' ? '  kept   SOLUTION ' : 'Other answer'
    await expect(publishQuiz(f, [{ question, answer }])).rejects.toThrow('Instructional reservation check rejected')
    expect(await inventory(f.t)).toEqual(before)
    expect(semantic).not.toHaveBeenCalled()
  })

  test.each([false, true])('semantic unknown with a reserved corpus fails closed even when both fingerprints differ (usage class: %s)', async byClass => {
    const f = await setup()
    const caseId = await f.t.run(ctx => reserve(ctx, 'Reserved task', 'Reserved solution', byClass))
    const before = await inventory(f.t)
    const semantic = vi.spyOn(instructionalReservationSemanticAdapter, 'compare')
    await expect(publishQuiz(f)).rejects.toThrow('Instructional reservation check unknown')
    expect(semantic).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      projection: expect.objectContaining({ kind: 'quiz_question' }), reservedCases: [expect.objectContaining({ _id: caseId })], catalog: expect.objectContaining({ catalogRevision: 0 }),
    }))
    expect(await inventory(f.t)).toEqual(before)
  })

  test('registers a 50-question Quiz in one transaction within the shared read ceilings', async () => {
    const f = await setup()
    const result = await f.asOwner.run(async ctx => {
      const quiz = await writeQuiz(ctx, f, Array.from({ length: 50 }, (_, i) => ({ question: `Question ${i}`, answer: `Solution ${i}` })), 's'.repeat(8192))
      return prepareAndRegisterInstructionalArtifactsForOwner(ctx, userId, { artifacts: quiz.artifacts })
    })
    expect(result.lineageIds).toHaveLength(50)
    expect(result.references).toHaveLength(50)
    expect(result.readUsage.chargedBytes).toBeLessThan(4 * 1024 * 1024)
    const state = await inventory(f.t)
    expect(state.cases).toHaveLength(50)
    expect(state.questions).toHaveLength(50)
    expect(state.validations.map(row => row.comparedCatalogRevision)).toEqual(Array(50).fill(0))
    expect(state.lineages.every(row => row.publication?.catalogRevision === 1)).toBe(true)
    expect(state.catalogs[0]!.catalogRevision).toBe(1)
  })

  test('prepares section prose, linked Quiz and card version together, retaining the same atomic cases', async () => {
    const f = await setup()
    const result = await f.asOwner.run(async ctx => {
      const courseId = await ctx.db.insert('courses', { userId, folderId: f.folderId, title: 'Course', status: 'ready', sourceType: 'folder',
        sourceConfidence: { docCount: 1, webPercent: 0 }, pace: 'steady', outlineSections: [], completedSectionCount: 0, totalSectionCount: 1,
        webSearchEnabled: false, createdAt: base.createdAt, updatedAt: base.createdAt })
      const quiz = await writeQuiz(ctx, f)
      await ctx.db.patch(quiz.quizId, { courseId })
      const roomId = await ctx.db.insert('flashcardRooms', { userId, folderId: f.folderId, title: 'Cards', updatedAt: base.createdAt })
      const versionId = await ctx.db.insert('flashcardRoomVersions', { userId, roomId, title: 'Cards', origin: 'ai', cardCount: 1 })
      const card = { userId, roomId, term: 'Cirrus', definition: 'High ice cloud', displayOrder: 0 }
      await ctx.db.insert('flashcardRoomCards', card)
      await ctx.db.insert('flashcardVersionCards', { ...card, versionId })
      await ctx.db.patch(roomId, { activeVersionId: versionId })
      const sectionId = await ctx.db.insert('courseSections', { userId, courseId, order: 0, title: 'Clouds', knowledgeType: 'mixed', status: 'ready', masteryLevel: 'new', contentBlocks: [
        { type: 'text', order: 0, content: 'Cloud formation has several stages.' }, { type: 'quiz', order: 1, entityId: quiz.quizId }, { type: 'flashcard', order: 2, entityId: roomId },
      ] })
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [...quiz.artifacts, member({ kind: 'flashcard_version', id: versionId }), member({ kind: 'section_block', id: sectionId })] })
    })
    const state = await inventory(f.t)
    expect(result.lineageIds).toHaveLength(3)
    expect(state.cases).toHaveLength(3)
    expect(state.lineages.map(row => row.caseCount)).toEqual([1, 1, 3])
    for (const reference of result.references) expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference }))).toMatchObject({ status: 'bound', instructionalRegistered: true })
    expect(state.lineages.every(row => row.publication?.catalogRevision === 1)).toBe(true)
  })

  test('keeps origin provenance and rejects reservation on an original case despite a rewrite', async () => {
    const f = await setup()
    const original = await publishQuiz(f)
    const rewritten = await f.asOwner.run(async ctx => {
      const quiz = await writeQuiz(ctx, f, [{ question: 'A rewritten task', answer: 'A rewritten solution' }])
      quiz.artifacts[0]!.origins = [{ reference: original.references[0]!, transformation: 'rewrite' }]
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: quiz.artifacts })
    })
    expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference: rewritten.references[0] }))).toMatchObject({ status: 'bound', originLineageIds: original.lineageIds, cases: expect.any(Array) })
    const state = await inventory(f.t)
    await f.t.run(ctx => ctx.db.patch(state.cases[0]!._id, { reservedAt: 0 }))
    const before = await inventory(f.t)
    await expect(f.asOwner.run(async ctx => {
      const quiz = await writeQuiz(ctx, f, [{ question: 'Unrelated surface text', answer: 'Unrelated surface solution' }])
      quiz.artifacts[0]!.origins = [{ reference: original.references[0]!, transformation: 'summary' }]
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: quiz.artifacts })
    })).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })

  test('uses the authoritative Audio Overview job without a session and pins actual dialogue', async () => {
    const f = await setup()
    const result = await f.t.run(async ctx => {
      const taskId = await ctx.db.insert('tasks', { userId, folderId: f.folderId, type: 'audio-overview-generation', status: 'running', title: 'Audio Overview',
        createdAt: base.createdAt, updatedAt: base.createdAt, audioOverviewRequest: {
          scope: { mode: 'explicit', documentIds: [f.documentId] }, documents: [{ documentId: f.documentId, folderId: f.folderId,
            filename: 'notes.txt', r2Key: 'owned/notes.r1', contentHash: 'a'.repeat(64), sourceRevision: 'source.r1' }],
          preferences: { lengthMinutes: 5, complexity: 'beginner' }, voiceProfile: { hostA: 'asteria', hostB: 'orion' }, quotaDate: '2026-11-06',
        } })
      const jobId = await ctx.db.insert('audioOverviewJobs', { userId, folderId: f.folderId, taskId, idempotencyKey: 'audio-preparation', capabilityHash: 'b'.repeat(64),
        status: 'completed', stage: 'complete', completedTurns: 1, createdAt: base.createdAt, updatedAt: base.createdAt })
      const audioFileId = await ctx.storage.store(new Blob(['audio']))
      const id = await ctx.db.insert('audioOverviews', { userId, folderId: f.folderId, title: 'Cloud formation', status: 'ready', totalDurationMs: 1000, voiceProfile: { hostA: 'asteria', hostB: 'orion' },
        turns: [{ speaker: 'host_a', text: 'Water vapour condenses into cloud droplets.', audioFileId, durationMs: 1000 }], sourceDocumentIds: [f.documentId] })
      return prepareAndRegisterInstructionalArtifactsForRecord(ctx, { kind: 'audio_job', id: jobId }, { artifacts: [member({ kind: 'audio_overview', id })] })
    })
    expect((await inventory(f.t)).lineages).toMatchObject([{ classification: 'teaching', sourceCount: 1 }])
    expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference: result.references[0] }))).toMatchObject({ status: 'bound' })
  })

  test('classifies an indexing document as personal work and registers the document/chunk set without novelty', async () => {
    const f = await setup()
    await f.t.run(async ctx => { await ctx.db.patch(f.documentId, { status: 'indexing' }); await reserve(ctx) })
    const semantic = vi.spyOn(instructionalReservationSemanticAdapter, 'compare')
    const early = await f.t.run(ctx => classifyPersonalWorkDocumentForRecord(ctx, { kind: 'document', id: f.documentId }))
    expect(early).toMatchObject({ classification: 'genuine_personal_work', reference: { artifact: { kind: 'document', id: f.documentId } } })
    expect(await f.asOwner.run(ctx => classifyPersonalWorkDocumentForOwner(ctx, userId, f.documentId))).toEqual(early)
    const result = await f.t.run(async ctx => {
      await ctx.db.patch(f.documentId, { status: 'success' })
      return prepareAndRegisterInstructionalArtifactsForRecord(ctx, { kind: 'document', id: f.documentId }, { artifacts: [
        member({ kind: 'document', id: f.documentId }), member({ kind: 'document_chunk', id: f.documentId }, LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY),
      ] })
    })
    const state = await inventory(f.t)
    expect(result.catalogRevision).toBe(1)
    expect(state.bindings).toEqual([])
    expect(state.cases).toHaveLength(1)
    expect(state.lineages).toMatchObject([{ classification: 'genuine_personal_work', authority: 'personal_authorship', caseCount: 0 }, { classification: 'genuine_personal_work', caseCount: 0 }])
    expect(state.validations).toMatchObject([{ preparation: { kind: 'personal_work' } }, { preparation: { kind: 'personal_work' } }])
    expect(state.validations.every(row => row.preparation?.kind === 'personal_work' && !('reservedCaseCount' in row.preparation))).toBe(true)
    expect(semantic).not.toHaveBeenCalled()
    for (const reference of result.references) expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference }))).toMatchObject({ status: 'bound', classification: 'genuine_personal_work' })
  })

  test.each([undefined, false, true])('registration scope requires the persisted enrollment capability: %s', async enabled => {
    const f = await setup(enabled)
    if (enabled === undefined) await f.t.run(ctx => ctx.db.patch(f.catalogId, { measurementCapability: undefined }))
    expect(await f.asOwner.run(ctx => isArtifactRegistrationRequired(ctx))).toBe(enabled === true)
    expect(await f.asOwner.run(ctx => isArtifactRegistrationRequiredForOwner(ctx, userId))).toBe(enabled === true)
    expect(await f.t.run(ctx => isArtifactRegistrationRequiredForRecord(ctx, { kind: 'document', id: f.documentId }))).toBe(enabled === true)
    if (enabled !== true) {
      const before = await inventory(f.t)
      await expect(publishQuiz(f)).rejects.toThrow('unavailable')
      expect(await inventory(f.t)).toEqual(before)
    }
  })

  test('missing catalogue means unenrolled; unknown history is never upgraded or treated as no prior teaching', async () => {
    const f = await setup(true, 'unknown')
    const before = await inventory(f.t)
    await expect(publishQuiz(f)).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
    await f.t.run(ctx => ctx.db.delete(f.catalogId))
    expect(await f.asOwner.run(ctx => isArtifactRegistrationRequired(ctx))).toBe(false)
    expect((await inventory(f.t)).catalogs).toEqual([])
  })

  test.each(['classification', 'caseId', 'decision', 'validationId', 'payloadDigest', 'revision', 'semanticAdapter', 'expectedCatalogRevision'])('rejects a worker/client %s assertion', async field => {
    const f = await setup()
    const before = await inventory(f.t)
    await expect(f.asOwner.run(async ctx => {
      const quiz = await writeQuiz(ctx, f)
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [{ ...quiz.artifacts[0], [field]: 'asserted' }] })
    })).rejects.toThrow()
    expect(await inventory(f.t)).toEqual(before)
  })

  test('enforces owner authority on both preparation paths and document admission', async () => {
    const f = await setup()
    const before = await inventory(f.t)
    await expect(f.t.withIdentity(foreign).run(ctx => prepareAndRegisterInstructionalArtifactsForOwner(ctx, userId, { artifacts: [member({ kind: 'document', id: f.documentId })] }))).rejects.toThrow('Learn access denied')
    await expect(f.t.run(ctx => prepareAndRegisterInstructionalArtifactsForOwner(ctx, userId, {}))).rejects.toThrow('Unauthenticated')
    await expect(f.t.run(ctx => prepareAndRegisterInstructionalArtifactsForRecord(ctx, { kind: 'document', id: f.documentId, userId } as never, {}))).rejects.toThrow()
    await expect(f.t.withIdentity(foreign).run(ctx => classifyPersonalWorkDocumentForOwner(ctx, foreign.tokenIdentifier, f.documentId))).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })

  test('concurrent publications cannot both validate against one catalogue revision', async () => {
    const f = await setup()
    const results = await Promise.all([
      publishQuiz(f, [{ question: 'First concurrent task', answer: 'First concurrent solution' }]),
      publishQuiz(f, [{ question: 'Second concurrent task', answer: 'Second concurrent solution' }]),
    ])
    const state = await inventory(f.t)
    expect(results.map(result => result.catalogRevision).sort()).toEqual([1, 2])
    expect(state.validations.map(row => row.comparedCatalogRevision).sort()).toEqual([0, 1])
    expect(state.catalogs[0]!.catalogRevision).toBe(2)
    const before = await inventory(f.t)
    await expect(f.asOwner.run(async ctx => {
      await advanceAssessmentCatalogForOwner(ctx, userId, 0)
      await reserve(ctx)
    })).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })

  test.each(['count', 'bytes', 'ranges', 'producer_failure'] as const)('rolls back all preparation state on %s exhaustion or producer failure', async kind => {
    const f = await setup()
    const before = await inventory(f.t)
    await expect(f.asOwner.run(async ctx => {
      const budget = createArtifactLineageReadContext(ctx)
      if (kind === 'ranges') for (let i = 0; i < 2048; i++) await budget.ctx.db.get(f.folderId)
      const quiz = await writeQuiz(ctx, f, Array.from({ length: kind === 'count' ? 51 : kind === 'bytes' ? 50 : 1 }, (_, i) => ({ question: `Budget task ${i}`, answer: `Budget solution ${i}` })), kind === 'bytes' ? 's'.repeat(80_000) : undefined)
      await prepareAndRegisterInstructionalArtifacts(budget.ctx, { artifacts: quiz.artifacts })
      if (kind === 'producer_failure') throw new Error('Producer failed after preparation')
    })).rejects.toThrow(kind === 'producer_failure' ? 'Producer failed after preparation' : undefined)
    expect(await inventory(f.t)).toEqual(before)
  })

  test('rejects ambiguous batch fingerprints rather than inventing a merged identity', async () => {
    const f = await setup()
    const before = await inventory(f.t)
    await expect(publishQuiz(f, [{ question: 'Task A', answer: 'Solution A' }, { question: 'Task B', answer: 'Solution B' }, { question: 'Task A', answer: 'Solution B' }])).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })

  test('caps comparison coverage and rejects unbound or duplicate publication members', async () => {
    const f = await setup()
    const before = await inventory(f.t)
    await expect(f.asOwner.run(async ctx => {
      const quiz = await writeQuiz(ctx, f)
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [quiz.artifacts[0], quiz.artifacts[0]] })
    })).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
    await f.t.run(async ctx => { for (let i = 0; i <= LEARN_ARTIFACT_LINEAGE_LIMITS.maxReservedCases; i++) await reserve(ctx, `Reserved ${i}`, `Reserved solution ${i}`) })
    await expect(publishQuiz(f)).rejects.toThrow('unavailable')
    expect(await f.t.run(ctx => prepareAndRegisterInstructionalArtifactsForRecord(ctx, { kind: 'document', id: f.documentId }, { artifacts: [member({ kind: 'document', id: f.documentId })] }))).toMatchObject({ catalogRevision: 1 })
  })

  test('rejects a late batch collision and an already active binding without partial writes', async () => {
    const f = await setup()
    const first = await publishQuiz(f)
    const before = await inventory(f.t)
    await expect(f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(first.references[0]!.artifact as LearnArtifactPreparationArgs['artifacts'][number]['artifact'])] }))).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
    await f.t.run(ctx => reserve(ctx, 'Last task', 'Last solution'))
    const reserved = await inventory(f.t)
    await expect(publishQuiz(f, [{ question: 'Earlier task', answer: 'Earlier solution' }, { question: 'Last task', answer: 'Last solution' }])).rejects.toThrow()
    expect(await inventory(f.t)).toEqual(reserved)
  })

  test.each(['failed', 'processing'] as const)('does not classify %s document state as personal work for indexing', async status => {
    const f = await setup(false)
    await f.t.run(ctx => ctx.db.patch(f.documentId, { status }))
    await expect(f.t.run(ctx => classifyPersonalWorkDocumentForRecord(ctx, { kind: 'document', id: f.documentId }))).rejects.toThrow('unavailable')
    await expect(f.asOwner.run(ctx => classifyPersonalWorkDocumentForOwner(ctx, userId, f.documentId))).rejects.toThrow('unavailable')
  })
})
