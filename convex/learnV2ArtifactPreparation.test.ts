/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test'
import { getDocumentSize } from 'convex/values'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import schema from './schema'
import {
  advanceAssessmentCatalogForOwner, classifyPersonalWorkDocumentForOwner, classifyPersonalWorkDocumentForRecord,
  createArtifactLineageReadContext, createArtifactLineagePublicationContext, instructionalReservationSemanticAdapter, isArtifactRegistrationRequired,
  isArtifactRegistrationRequiredForOwner, isArtifactRegistrationRequiredForRecord, normalizedInstructionalCaseFingerprints,
  prepareAndRegisterInstructionalArtifacts, prepareAndRegisterInstructionalArtifactsForOwner, prepareAndRegisterInstructionalArtifactsForRecord,
  resolveArtifactLineageForOwner,
  admitArtifactInput, admitArtifactInputs, artifactContentProjection, artifactPayloadDigest, artifactManifestDigest,
  admitArtifactInputByIdentity, admitArtifactInputByIdentityForOwner, admitArtifactInputByIdentityForRecord, admitArtifactInputsByIdentity, admitArtifactInputsByIdentityForOwner, admitArtifactInputsByIdentityForRecord,
} from './lib/learnV2ArtifactLineage'
import { LEARN_ARTIFACT_CASE_IDENTITY_VERSION, LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY, LEARN_ARTIFACT_LINEAGE_LIMITS, type LearnArtifactPreparationArgs, type LearnArtifactReference } from '../shared/learn-v2-artifact-lineage'

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

async function registerSource(f: Fixture, both = false) {
  return f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member({ kind: 'document', id: f.documentId }),
    ...(both ? [member({ kind: 'document_chunk', id: f.documentId }, LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY)] : [])] }))
}

async function teachingInventory(t: Store) {
  const state = await inventory(t)
  const lineages = state.lineages.filter(row => row.classification === 'teaching')
  const ids = new Set(lineages.map(row => row._id))
  return { ...state, lineages, validations: state.validations.filter(row => ids.has(row.lineageId)), sources: state.sources.filter(row => ids.has(row.lineageId)) }
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
    await registerSource(f)
    const semantic = vi.spyOn(instructionalReservationSemanticAdapter, 'compare')
    const result = await publishQuiz(f)
    expect(result.catalogRevision).toBe(2)
    expect(semantic).not.toHaveBeenCalled()
    const state = await teachingInventory(f.t)
    expect(state.catalogs).toMatchObject([{ catalogRevision: 2, historyCompleteness: 'prospective_complete', historyBasisVersion: 'history.v1' }])
    expect(state.lineages).toMatchObject([{ classification: 'teaching', authority: 'server_producer', caseCount: 1, sourceCount: 1, publication: { catalogRevision: 2 } }])
    expect(state.validations).toMatchObject([{ decision: 'pass', comparedCatalogRevision: 1, coverage: 'complete', coverageWatermark: 'coverage.v1', validatorModel: null,
      preparation: { kind: 'instructional_reservation', reservedCaseCount: 0, deterministicDecision: 'pass', semanticDecision: 'not_required',
        historyCompleteness: 'prospective_complete', historyBasisVersion: 'history.v1', instrumentationEpoch: 'prospective.epoch.v1' } }])
    expect(state.cases).toMatchObject([{ usageClass: 'instructional', artifactIdentityValidationId: state.validations[0]!._id }])
    expect(state.sources).toMatchObject([{ dependency: { kind: 'document', documentId: f.documentId, sourceRevision: 'source.r1' } }])
    expect(state.exposures).toEqual([])
    const resolved = await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference: result.references[0] }))
    expect(resolved).toMatchObject({ status: 'bound', instructionalRegistered: true })
    for (const collection of ['learnArtifactValidations', 'learnAssessmentCatalogs'] as const) {
      const exported = await f.asOwner.query(api.dataExport.getUserDataPage, { collection, paginationOpts: { cursor: null, numItems: 8 } })
      expect(exported.page).toHaveLength(collection === 'learnArtifactValidations' ? 2 : 1)
      expect(exported.page[0]).not.toHaveProperty('preparation')
      expect(exported.page[0]).not.toHaveProperty('measurementCapability')
    }
  })

  test('reuses normalized identities across new artifact IDs and preserves append-only decisions', async () => {
    const f = await setup()
    await registerSource(f)
    const first = await publishQuiz(f, [{ question: 'ＦＩＮＤ   X', answer: 'The FIRST solution' }])
    const original = await teachingInventory(f.t)
    const second = await publishQuiz(f, [{ question: 'find x', answer: '  the first\nsolution  ' }])
    const state = await teachingInventory(f.t)
    expect(state.cases).toHaveLength(1)
    expect(state.bindings.map(binding => binding.caseId)).toEqual([state.cases[0]!._id, state.cases[0]!._id])
    expect(state.validations[0]).toEqual(original.validations[0])
    expect(state.cases[0]!.artifactIdentityValidationId).toBe(original.validations[0]!._id)
    expect(second.references[0]!.payloadDigest).not.toBe(first.references[0]!.payloadDigest)
    expect(state.validations.map(row => row.comparedCatalogRevision)).toEqual([1, 2])
  })

  test('solution-only matches retain separate scenario identities', async () => {
    const f = await setup()
    await registerSource(f)
    await publishQuiz(f, [{ question: 'Original scenario', answer: 'Shared solution' }])
    const before = await teachingInventory(f.t)
    await publishQuiz(f, [{ question: 'A different scenario', answer: '  SHARED\nsolution ' }])
    const after = await teachingInventory(f.t)
    expect(after.cases).toHaveLength(2)
    expect(after.cases[0]).toEqual(before.cases[0])
    expect(after.bindings.map(binding => binding.caseId)).toEqual(after.cases.map(row => row._id))
    expect(after.validations.map(validation => validation.comparedCatalogRevision)).toEqual([1, 2])
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
    await registerSource(f)
    const result = await f.asOwner.run(async ctx => {
      const quiz = await writeQuiz(ctx, f, Array.from({ length: 50 }, (_, i) => ({ question: `Question ${i}`, answer: `Solution ${i}` })), 's'.repeat(8192))
      return prepareAndRegisterInstructionalArtifactsForOwner(ctx, userId, { artifacts: quiz.artifacts })
    })
    expect(result.lineageIds).toHaveLength(50)
    expect(result.references).toHaveLength(50)
    expect(result.readUsage.chargedBytes).toBeLessThan(4 * 1024 * 1024)
    const state = await teachingInventory(f.t)
    expect(state.cases).toHaveLength(50)
    expect(state.questions).toHaveLength(50)
    expect(state.validations.map(row => row.comparedCatalogRevision)).toEqual(Array(50).fill(1))
    expect(state.lineages.every(row => row.publication?.catalogRevision === 2)).toBe(true)
    expect(state.catalogs[0]!.catalogRevision).toBe(2)
  })

  test('prepares section prose, linked Quiz and card version together, retaining the same atomic cases', async () => {
    const f = await setup()
    await registerSource(f)
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
    const state = await teachingInventory(f.t)
    expect(result.lineageIds).toHaveLength(3)
    expect(state.cases).toHaveLength(3)
    expect(state.lineages.map(row => row.caseCount)).toEqual([1, 1, 3])
    for (const reference of result.references) expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference }))).toMatchObject({ status: 'bound', instructionalRegistered: true })
    expect(state.lineages.every(row => row.publication?.catalogRevision === 2)).toBe(true)
  })

  test('keeps origin provenance and rejects reservation on an original case despite a rewrite', async () => {
    const f = await setup()
    await registerSource(f)
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
    await registerSource(f)
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
    expect((await teachingInventory(f.t)).lineages).toMatchObject([{ classification: 'teaching', sourceCount: 1 }])
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
    await registerSource(f)
    const results = await Promise.all([
      publishQuiz(f, [{ question: 'First concurrent task', answer: 'First concurrent solution' }]),
      publishQuiz(f, [{ question: 'Second concurrent task', answer: 'Second concurrent solution' }]),
    ])
    const state = await teachingInventory(f.t)
    expect(results.map(result => result.catalogRevision).sort()).toEqual([2, 3])
    expect(state.validations.map(row => row.comparedCatalogRevision).sort()).toEqual([1, 2])
    expect(state.catalogs[0]!.catalogRevision).toBe(3)
    const before = await teachingInventory(f.t)
    await expect(f.asOwner.run(async ctx => {
      await advanceAssessmentCatalogForOwner(ctx, userId, 0)
      await reserve(ctx)
    })).rejects.toThrow('unavailable')
    expect(await teachingInventory(f.t)).toEqual(before)
  })

  test.each(['count', 'bytes', 'ranges', 'producer_failure'] as const)('rolls back all preparation state on %s exhaustion or producer failure', async kind => {
    const f = await setup()
    await registerSource(f)
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

  test('scenario reuse remains distinct from a shared solution in the same batch', async () => {
    const f = await setup()
    await registerSource(f)
    await publishQuiz(f, [{ question: 'Task A', answer: 'Solution A' }, { question: 'Task B', answer: 'Solution B' }, { question: 'Task A', answer: 'Solution B' }])
    const state = await inventory(f.t)
    expect(state.cases).toHaveLength(2)
    expect(state.bindings.map(row => row.caseId)).toEqual([state.cases[0]!._id, state.cases[1]!._id, state.cases[0]!._id])
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
    await registerSource(f)
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


describe('round-2 producer budgets', { timeout: 30_000 }, () => {
  test.each(['Quiz', 'section_procedural', 'section_factual', 'section_conceptual', 'Flashcards', 'Audio Overview', 'document'] as const)('%s admits maximum sources and prepares the full output batch', async shape => {
    const f = await setup()
    const section = shape.startsWith('section_')
    const count = shape === 'document' ? 0 : section ? 59 : 50
    const docs = await f.t.run(async ctx => {
      const ids = [f.documentId]
      for (let i = 1; i < count; i++) ids.push(await ctx.db.insert('documents', { userId, folderId: f.folderId, filename: `source-${i}.txt`, fileSize: 8192, status: 'success', sourceRevision: 'source.r1', contentHash: 'a'.repeat(64), r2Key: `owned/source-${i}.r1` }))
      return ids
    })
    const refs: LearnArtifactReference[] = []
    for (const id of docs.slice(0, count)) refs.push(...(await f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member({ kind: 'document', id }), member({ kind: 'document_chunk', id }, LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY)] }))).references.filter(ref => ref.artifact.kind === 'document'))
    const result = await f.asOwner.run(async raw => {
      const total = createArtifactLineagePublicationContext(raw)
      expect(total.readUsage.limitBytes).toBe(8 * 1024 * 1024)
      expect(total.admission.readUsage.limitBytes).toBe(4 * 1024 * 1024)
      expect(total.preparation.readUsage.limitBytes).toBe(6 * 1024 * 1024)
      const inputs = total.admission.ctx
      expect(await isArtifactRegistrationRequired(inputs)).toBe(true)
      if (refs.length) expect(await admitArtifactInputs(inputs, { references: refs })).toMatchObject({ status: 'admitted_registered' })
      const admission = { ...total.admission.readUsage, ranges: total.admission.indexRanges }
      const ctx = raw
      const producer = { chargedBytes: 0, ranges: 0 }
      for (const id of [f.folderId, ...docs.slice(0, count)]) {
        const row = await raw.db.get(id)
        producer.ranges++
        if (row) producer.chargedBytes += getDocumentSize(row) + 64
      }
      const artifacts: LearnArtifactPreparationArgs['artifacts'] = []
      if (shape === 'Quiz') artifacts.push(...(await writeQuiz(ctx, f, Array.from({ length: 50 }, (_, i) => ({ question: `Question ${i} ${'q'.repeat(1200)}`, answer: `Answer ${i} ${'a'.repeat(1200)}` })), 's'.repeat(8192))).artifacts)
      if (shape === 'Flashcards' || section) {
        const cardCount = shape === 'section_procedural' ? 8 : shape === 'section_conceptual' ? 12 : 16
        const roomId = await ctx.db.insert('flashcardRooms', { userId, folderId: f.folderId, title: 'Cards', updatedAt: base.createdAt })
        const versionId = await ctx.db.insert('flashcardRoomVersions', { userId, roomId, title: 'Cards', origin: 'ai', cardCount })
        for (let i = 0; i < cardCount; i++) {
          const card = { userId, roomId, term: `Term ${i}`, definition: `Definition ${i}`, displayOrder: i, sourceDocumentId: docs[i], sourceChunkContent: 's'.repeat(8192) }
          await ctx.db.insert('flashcardRoomCards', card)
          await ctx.db.insert('flashcardVersionCards', { ...card, versionId })
        }
        await ctx.db.patch(roomId, { activeVersionId: versionId })
        artifacts.push(member({ kind: 'flashcard_version', id: versionId }))
        if (section) {
          const courseId = await ctx.db.insert('courses', { userId, folderId: f.folderId, title: 'Course', status: 'ready', sourceType: 'folder', sourceConfidence: { docCount: count, webPercent: 0 }, pace: 'steady', outlineSections: [], completedSectionCount: 0, totalSectionCount: 1, webSearchEnabled: false, createdAt: base.createdAt, updatedAt: base.createdAt })
          const questionCount = shape === 'section_procedural' ? 10 : shape === 'section_factual' ? 5 : 8
          const quiz = await writeQuiz(ctx, f, Array.from({ length: questionCount }, (_, i) => ({ question: `Task ${i}`, answer: `Solution ${i}` })), 's'.repeat(8192))
          artifacts.push(...quiz.artifacts)
          let audioId: Doc<'audioOverviews'>['_id'] | undefined
          if (shape === 'section_conceptual') {
            const audioFileId = await ctx.storage.store(new Blob(['audio']))
            audioId = await ctx.db.insert('audioOverviews', { userId, folderId: f.folderId, title: 'Course Audio Overview', status: 'ready', courseScoped: true, totalDurationMs: 1000, voiceProfile: { hostA: 'a', hostB: 'b' }, sourceDocumentIds: docs, turns: [{ speaker: 'host_a', text: 'Spoken section content', audioFileId, durationMs: 1000 }] })
            artifacts.push(member({ kind: 'audio_overview', id: audioId }))
          }
          const sectionId = await ctx.db.insert('courseSections', { userId, courseId, title: 'Section', order: 0, knowledgeType: shape === 'section_procedural' ? 'procedural' : shape === 'section_factual' ? 'factual' : 'conceptual', status: 'ready', masteryLevel: 'new', contentBlocks: [{ type: 'text', content: 'Section prose', order: 0 }, { type: 'quiz', entityId: quiz.quizId, order: 1 }, { type: 'flashcard', entityId: roomId, order: 2 }, audioId ? { type: 'audio', entityId: audioId, order: 3 } : { type: 'text', content: 'Section conclusion', order: 3 }] })
          for (let i = 0; i < 4; i++) artifacts.push(member({ kind: 'section_block', id: sectionId }, `block-${i}`))
        }
      }
      if (shape === 'Audio Overview') {
        const audioFileId = await ctx.storage.store(new Blob(['audio']))
        const id = await ctx.db.insert('audioOverviews', { userId, folderId: f.folderId, title: 'Audio Overview', status: 'ready', totalDurationMs: 1000, voiceProfile: { hostA: 'a', hostB: 'b' }, sourceDocumentIds: docs, turns: [{ speaker: 'host_a', text: 'a'.repeat(240000), audioFileId, durationMs: 1000 }] })
        artifacts.push(member({ kind: 'audio_overview', id }))
      }
      if (shape === 'document') artifacts.push(member({ kind: 'document', id: f.documentId }), member({ kind: 'document_chunk', id: f.documentId }, LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY))
      for (const artifact of artifacts) artifact.sources = docs.slice(0, count).map(documentId => ({ kind: 'document', documentId, sourceRevision: 'source.r1' }))
      const published = await prepareAndRegisterInstructionalArtifacts(total.preparation.ctx, { artifacts })
      const publication = { ...total.readUsage, ranges: total.indexRanges }
      const preparation = { ...total.preparation.readUsage, ranges: total.preparation.indexRanges }
      const decision = await admitArtifactInputs(total.admission.ctx, { references: published.references })
      const sameTransaction = { ...total.readUsage, ranges: total.indexRanges, decision }
      if (decision.status === 'rejected') expect(decision.reasonCode).toBe('lineage_unavailable')
      expect(sameTransaction.ranges).toBeLessThanOrEqual(3072)
      expect(sameTransaction.chargedBytes).toBeLessThan(8 * 1024 * 1024)
      return { shape, inputs: refs.length, outputs: published.references.length, references: published.references, admission, preparation, publication, producer, sameTransaction, total: publication }
    })
    const links = await f.t.run(ctx => ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId', q => q.eq('userId', userId)).take(4000))
    expect(links).toHaveLength(count ? count * (2 + result.outputs) : 2)
    const later = await f.asOwner.run(async raw => {
      let versionCardReads = 0
      const db = new Proxy(raw.db, { get(target, property) {
        const method: unknown = Reflect.get(target, property)
        if (property === 'query' && typeof method === 'function') return (...args: unknown[]) => {
          if (args[0] === 'flashcardVersionCards') versionCardReads++
          return Reflect.apply(method, target, args)
        }
        return typeof method === 'function' ? method.bind(target) : method
      } })
      const total = createArtifactLineagePublicationContext({ ...raw, db })
      expect(await admitArtifactInputs(total.admission.ctx, { references: result.references })).toMatchObject({ status: 'admitted_registered' })
      expect(versionCardReads).toBe(section || shape === 'Flashcards' ? 2 : 0)
      return { ...total.readUsage, ranges: total.indexRanges, versionCardReads }
    })
    const { references: _references, ...metrics } = result
    console.log(JSON.stringify({ ...metrics, later }))
    expect(later.ranges).toBeLessThanOrEqual(3072)
    expect(later.chargedBytes).toBeLessThan(8 * 1024 * 1024)
    expect(result.total.ranges).toBeLessThanOrEqual(3072)
    expect(result.total.chargedBytes).toBeLessThan(8 * 1024 * 1024)
  })

  test.each(['ranges', 'bytes'] as const)('the publication total retains %s charges across phases and rolls back', async kind => {
    const f = await setup()
    const before = await inventory(f.t)
    await expect(f.asOwner.run(async raw => {
      const total = createArtifactLineagePublicationContext(raw)
      for (const [index, phase] of [total.admission, total.preparation].entries()) {
        if (kind === 'ranges') for (let i = 0; i < 1600; i++) await phase.ctx.db.get(f.folderId)
        else {
          const id = await phase.ctx.db.insert('documents', { userId, folderId: f.folderId, filename: 'p'.repeat(500000), fileSize: 1, status: 'success' })
          for (let i = 0; i < (index === 0 ? 6 : 9); i++) await phase.ctx.db.get(id)
        }
      }
      return prepareAndRegisterInstructionalArtifacts(total.preparation.ctx, { artifacts: [member({ kind: 'document', id: f.documentId })] })
    })).rejects.toThrow()
    expect(await inventory(f.t)).toEqual(before)
  })

  test.each(['admission', 'preparation'] as const)('round-3 %s byte exhaustion rolls back producer writes', async name => {
    const f = await setup()
    const before = await inventory(f.t)
    const documentIds = () => f.t.run(async ctx => (await ctx.db.query('documents').withIndex('by_userId', q => q.eq('userId', userId)).take(3)).map(row => row._id))
    const documents = await documentIds()
    await expect(f.asOwner.run(async raw => {
      const total = createArtifactLineagePublicationContext(raw)
      await writeQuiz(total.preparation.ctx, f)
      const id = await total.preparation.ctx.db.insert('documents', { userId, folderId: f.folderId, filename: 's'.repeat(500000), fileSize: 1, status: 'success' })
      for (let i = 0; i < (name === 'admission' ? 8 : 12); i++) await total[name].ctx.db.get(id)
    })).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
    expect(await documentIds()).toEqual(documents)
  })

  test('publication counters remain live and share both phase charges', async () => {
    const f = await setup()
    await f.asOwner.run(async ctx => {
      const total = createArtifactLineagePublicationContext(ctx)
      const initial = total.readUsage
      await total.admission.ctx.db.get(f.folderId)
      await total.preparation.ctx.db.query('documents').withIndex('by_userId', q => q.eq('userId', userId)).take(1)
      expect(total.admission.indexRanges).toBe(1)
      expect(total.preparation.indexRanges).toBe(1)
      expect(total.indexRanges).toBe(2)
      expect(createArtifactLineageReadContext(total.admission.ctx).indexRanges).toBe(1)
      expect(total.readUsage.chargedBytes).toBe(total.admission.readUsage.chargedBytes + total.preparation.readUsage.chargedBytes)
      expect(total.readUsage.documentsRead).toBe(2)
      expect(initial.chargedBytes).toBe(0)
    })
  })

  test('exhausted preparation returns a structured rejection by throwing', async () => {
    const f = await setup()
    await expect(f.asOwner.run(async ctx => {
      const total = createArtifactLineagePublicationContext(ctx)
      for (let i = 0; i < 2046; i++) await total.preparation.ctx.db.query('learnAssessmentCases').withIndex('by_userId', q => q.eq('userId', 'absent')).take(1)
      return prepareAndRegisterInstructionalArtifacts(total.preparation.ctx, { artifacts: [member({ kind: 'document', id: f.documentId })] })
    })).rejects.toMatchObject({ data: { status: 'rejected', reasonCode: 'projection_exceeds_budget' } })
  })

  test('round-4 preparation rereads sources after its own writes', async () => {
    const f = await setup()
    await f.asOwner.run(async ctx => {
      let reads = 0
      const db = new Proxy(ctx.db, { get(target, property) {
        const value: unknown = Reflect.get(target, property)
        if (property !== 'get' || typeof value !== 'function') return typeof value === 'function' ? value.bind(target) : value
        return (...args: unknown[]) => {
          if (args.at(-1) === f.documentId) reads++
          return Reflect.apply(value, target, args)
        }
      } })
      await prepareAndRegisterInstructionalArtifacts({ ...ctx, db }, { artifacts: [member({ kind: 'document', id: f.documentId }), member({ kind: 'document_chunk', id: f.documentId }, LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY)] })
      expect(reads).toBeGreaterThan(1)
    })
  })

  test('preparation snapshots never survive a producer source edit between calls', async () => {
    const f = await setup()
    await registerSource(f)
    const first = await publishQuiz(f)
    const before = await inventory(f.t)
    await expect(f.asOwner.run(async raw => {
      const total = createArtifactLineagePublicationContext(raw)
      expect(await resolveArtifactLineageForOwner(total.admission.ctx, userId, { reference: first.references[0]! })).toMatchObject({ status: 'bound' })
      await raw.db.patch(f.documentId, { sourceRevision: 'source.r2', contentHash: 'b'.repeat(64) })
      const second = await writeQuiz(raw, f, [{ question: 'Fresh task', answer: 'Fresh solution' }])
      return prepareAndRegisterInstructionalArtifacts(total.preparation.ctx, { artifacts: second.artifacts })
    })).rejects.toThrow('registration required')
    expect(await inventory(f.t)).toEqual(before)
  })
})

describe('Stage B scenario identities and preparation provenance', () => {
  test.each([
    { questions: [{ question: 'How many sides has a square?', answer: '4' }, { question: 'How many seasons are there?', answer: 'Four' }, { question: 'What is two plus two?', answer: '4' }] },
    { questions: [{ question: 'What is the smallest prime?', answer: '2' }, { question: 'What is the next prime?', answer: '3' }, { question: 'What is the smallest prime?', answer: '3' }] },
  ])('ordinary short answers do not merge distinct scenarios: %j', async ({ questions }) => {
    const f = await setup()
    await registerSource(f, true)
    for (const question of questions) {
      const result = await publishQuiz(f, [question])
      expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: result.references[0]! }))).toMatchObject({ status: 'admitted_registered' })
      const pins = await normalizedInstructionalCaseFingerprints(question.question, question.answer)
      const found = await f.t.run(ctx => ctx.db.query('learnAssessmentCases').withIndex('by_userId_and_scenarioFingerprint', q => q.eq('userId', userId).eq('scenarioFingerprint', pins.scenarioFingerprint)).take(2))
      expect(found).toHaveLength(1)
      expect(found[0]!.usageClass).toBe('instructional')
    }
    const state = await inventory(f.t)
    expect(state.cases).toHaveLength(new Set(questions.map(row => row.question)).size)
    expect(new Set(state.bindings.map(row => row.caseId)).size).toBe(state.cases.length)
  })

  test('a solution-only reserved match rejects before semantic dispatch', async () => {
    const f = await setup()
    await registerSource(f)
    await f.t.run(ctx => reserve(ctx, 'Held-out scenario', '4'))
    const before = await inventory(f.t)
    const semantic = vi.spyOn(instructionalReservationSemanticAdapter, 'compare')
    await expect(publishQuiz(f, [{ question: 'An unrelated scenario', answer: '4' }])).rejects.toThrow('reservation check rejected')
    expect(semantic).not.toHaveBeenCalled()
    expect(await inventory(f.t)).toEqual(before)
  })

  test.each(['document', 'document_chunk'] as const)('preparation rejects protected %s source lineage', async kind => {
    for (const classification of ['measurement', 'private_scoring', 'unknown'] as const) {
      const f = await setup()
      const source = await registerSource(f, true)
      const id = source.lineageIds[kind === 'document' ? 0 : 1]!
      await f.t.run(ctx => ctx.db.patch(id, { classification }))
      const before = await inventory(f.t)
      await expect(publishQuiz(f)).rejects.toThrow('unavailable')
      expect(await inventory(f.t)).toEqual(before)
    }
  })

  test('preparation follows a source document into its protected retained dependency', async () => {
    const f = await setup()
    const first = await registerSource(f)
    const second = await f.t.run(ctx => ctx.db.insert('documents', { userId, folderId: f.folderId, filename: 'other.txt', fileSize: 1, status: 'success', sourceRevision: 'source.r1', contentHash: 'b'.repeat(64) }))
    const next = await f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member({ kind: 'document', id: second })] }))
    await f.t.run(async ctx => {
      const lineageId = first.lineageIds[0]!
      await ctx.db.insert('learnArtifactSourceLinks', { ...base, lineageId, evidenceStatus: 'available', dependency: { kind: 'document', documentId: second, sourceRevision: 'source.r1' } })
      await ctx.db.patch(lineageId, { sourceCount: 2 })
      const row = (await ctx.db.get(lineageId))!
      const links = await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', lineageId)).take(65)
      const manifestDigest = await artifactManifestDigest(ctx, row, [], [], links)
      await ctx.db.patch(lineageId, { manifestDigest })
      await ctx.db.patch(row.validationId!, { manifestDigest })
      await ctx.db.patch(next.lineageIds[0]!, { classification: 'private_scoring' })
    })
    expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference: first.references[0]! }))).toMatchObject({ status: 'bound' })
    await expect(publishQuiz(f)).rejects.toThrow('unavailable')
  })

  test('fingerprints include the frozen identity version', async () => {
    expect(await normalizedInstructionalCaseFingerprints('  FOUR  ', '4')).toEqual({
      scenarioFingerprint: 'eb7cc7b8c4408eab48b2109e6c98c2c09a399771c0593d794ca8c74075700281', solutionFingerprint: '7ef745193bce4f3d4ed55a0cdbb0fcbc4282519e41b3b2831ee910a52ef4a1be',
    })
  })

  test('a case present in both reservation indexes counts once at the 256-case boundary', async () => {
    const f = await setup()
    await registerSource(f)
    await f.t.run(async ctx => {
      const id = await reserve(ctx, 'Held-out zero', 'Reserved zero', true)
      const row = (await ctx.db.get(id))!
      await ctx.db.patch(id, { reservedAt: 0 })
      const { _id, _creationTime, ...fields } = row
      for (let i = 1; i < 256; i++) {
        const pins = await normalizedInstructionalCaseFingerprints(`Held-out ${i}`, `Reserved ${i}`)
        await ctx.db.insert('learnAssessmentCases', { ...fields, ...pins, caseKey: `reserved-${i}`, reservedAt: 0 })
      }
    })
    vi.spyOn(instructionalReservationSemanticAdapter, 'compare').mockResolvedValue({ decision: 'pass', coverage: 'complete' })
    await publishQuiz(f)
    expect((await teachingInventory(f.t)).validations[0]!.preparation).toMatchObject({ reservedCaseCount: 256 })
  })
})

describe('Stage B revision succession', () => {
  test('flag, unflag and flag again supersede the active Quiz revision atomically', async () => {
    const f = await setup()
    await registerSource(f, true)
    let published = await publishQuiz(f)
    const question = published.references[0]!.artifact
    if (question.kind !== 'quiz_question') throw new Error('Expected question')
    const cases = (await inventory(f.t)).cases
    for (const action of ['flag', 'unflag', 'flag'] as const) {
      const before = published.references[0]!
      published = await f.asOwner.run(async ctx => {
        if (action === 'flag') await ctx.runMutation(api.contentFlags.flagQuizQuestion, { questionId: question.id, correctedAnswer: 'Corrected solution' })
        else await ctx.runMutation(api.contentFlags.unflagQuizQuestion, { questionId: question.id })
        expect(await admitArtifactInputByIdentity(ctx, question)).toMatchObject({ status: 'rejected', reasonCode: 'registration_required' })
        return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(question)] })
      })
      expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, question))).toMatchObject({ status: 'admitted_registered' })
      expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference: before }))).toMatchObject({ status: 'unavailable' })
      expect((await inventory(f.t)).cases).toEqual(cases)
    }
  })

  test('twenty content edits retain all case bindings without an active-history lockout', async () => {
    const f = await setup()
    await registerSource(f)
    let published = await publishQuiz(f)
    const artifact = published.references[0]!.artifact
    if (artifact.kind !== 'quiz_question') throw new Error('Expected question')
    for (let i = 0; i < 20; i++) {
      published = await f.asOwner.run(async ctx => {
        await ctx.runMutation(api.quizzes.updateQuestion, { questionId: artifact.id, question: `Edited scenario ${i}` })
        return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(artifact)] })
      })
      expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: published.references[0]! }))).toMatchObject({ status: 'admitted_registered' })
    }
    const state = await teachingInventory(f.t)
    expect(state.cases).toHaveLength(21)
    expect(state.lineages.filter(row => row.nextId === undefined)).toHaveLength(1)
    expect(state.lineages.at(-1)!.caseCount).toBe(21)
  })

  test.each(['measurement', 'private_scoring', 'unknown'] as const)('a restrictive stranded %s row cannot be superseded by teaching', async classification => {
    const f = await setup()
    await registerSource(f)
    const published = await publishQuiz(f)
    const artifact = published.references[0]!.artifact
    if (artifact.kind !== 'quiz_question') throw new Error('Expected question')
    await f.t.run(ctx => ctx.db.patch(published.lineageIds[0]!, { classification }))
    await f.asOwner.mutation(api.quizzes.updateQuestion, { questionId: artifact.id, question: 'Stranded protected scenario' })
    const before = await inventory(f.t)
    await expect(f.asOwner.run(async ctx => {
      await ctx.runMutation(api.quizzes.updateQuestion, { questionId: artifact.id, question: 'A different scenario' })
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(artifact)] })
    })).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
    expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, artifact))).toMatchObject({ status: 'rejected' })
  })
})

describe('Stage B legacy identity admission', () => {
  test.each(['deleted', 'unpinned'] as const)('an ordinary %s nested source needs no synthetic pins', async state => {
    for (const enrolled of [false, true]) {
      const f = await setup(enrolled)
      const quiz = await f.t.run(ctx => writeQuiz(ctx, f))
      const artifact = quiz.artifacts[0]!.artifact
      await f.t.run(ctx => state === 'deleted' ? ctx.db.delete(f.documentId) : ctx.db.patch(f.documentId, { sourceRevision: undefined, contentHash: undefined }))
      expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, artifact))).toMatchObject({ status: enrolled ? 'rejected' : 'admitted_unregistered' })
      expect(await f.asOwner.run(ctx => admitArtifactInputByIdentityForOwner(ctx, userId, artifact))).toMatchObject({ status: enrolled ? 'rejected' : 'admitted_unregistered' })
      expect(await f.asOwner.run(ctx => admitArtifactInputsByIdentity(ctx, { artifacts: [artifact] }))).toMatchObject({ status: enrolled ? 'rejected' : 'admitted_unregistered' })
    }
  })

  test.each(['document', 'document_chunk'] as const)('leftover %s lineage prevents a missing or unpinned legacy-source exception', async kind => {
    for (const state of ['deleted', 'unpinned'] as const) {
      for (const classification of ['measurement', 'private_scoring', 'unknown'] as const) {
        const f = await setup()
        const source = await registerSource(f, true)
        const quiz = await f.t.run(ctx => writeQuiz(ctx, f))
        await f.t.run(async ctx => {
          await ctx.db.patch(f.catalogId, { measurementCapability: { enabled: false } })
          await ctx.db.patch(source.lineageIds[kind === 'document' ? 0 : 1]!, { classification })
          if (state === 'deleted') await ctx.db.delete(f.documentId)
          else await ctx.db.patch(f.documentId, { sourceRevision: undefined, contentHash: undefined })
        })
        expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, quiz.artifacts[0]!.artifact))).toMatchObject({ status: 'rejected' })
      }
    }
  })

  test('owned unpinned documents use every identity authority variant and never accept supplied pins', async () => {
    const f = await setup(false)
    await f.t.run(ctx => ctx.db.patch(f.documentId, { sourceRevision: undefined, contentHash: undefined }))
    const artifact = { kind: 'document' as const, id: f.documentId }
    expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, artifact))).toMatchObject({ status: 'admitted_unregistered' })
    expect(await f.t.run(ctx => admitArtifactInputByIdentityForRecord(ctx, artifact, artifact))).toMatchObject({ status: 'admitted_unregistered' })
    await expect(f.t.withIdentity(foreign).run(ctx => admitArtifactInputByIdentityForOwner(ctx, userId, artifact))).rejects.toThrow('access denied')
    await expect(f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, { ...artifact, payloadDigest: 'a'.repeat(64) }))).rejects.toThrow()
  })
})

async function writeSectionCards(ctx: MutationCtx, f: Fixture) {
  const courseId = await ctx.db.insert('courses', { userId, folderId: f.folderId, title: 'Course', status: 'ready', sourceType: 'folder', sourceConfidence: { docCount: 1, webPercent: 0 }, pace: 'steady', outlineSections: [], completedSectionCount: 0, totalSectionCount: 1, webSearchEnabled: false, createdAt: base.createdAt, updatedAt: base.createdAt })
  const roomId = await ctx.db.insert('flashcardRooms', { userId, folderId: f.folderId, title: 'Cards', updatedAt: base.createdAt })
  const versionId = await ctx.db.insert('flashcardRoomVersions', { userId, roomId, title: 'Cards', origin: 'ai', cardCount: 1 })
  const card = { userId, roomId, term: 'A card scenario', definition: 'Original card solution', displayOrder: 0, sourceDocumentId: f.documentId }
  const cardId = await ctx.db.insert('flashcardRoomCards', card)
  await ctx.db.insert('flashcardVersionCards', { ...card, versionId })
  await ctx.db.patch(roomId, { activeVersionId: versionId })
  const sectionId = await ctx.db.insert('courseSections', { userId, courseId, title: 'Section', order: 0, knowledgeType: 'factual', status: 'ready', masteryLevel: 'new', contentBlocks: [{ type: 'text', order: 0, content: 'Section prose' }, { type: 'flashcard', order: 1, entityId: roomId }] })
  return { sectionId, cardId, artifacts: [member({ kind: 'flashcard_version', id: versionId }), member({ kind: 'section_block', id: sectionId })] }
}

describe('Stage B corrected answers and linked section revisions', () => {
  test('a corrected Quiz answer is checked against the reserved solution', async () => {
    const f = await setup()
    await registerSource(f)
    const quiz = await f.t.run(ctx => writeQuiz(ctx, f))
    const artifact = quiz.artifacts[0]!.artifact
    if (artifact.kind !== 'quiz_question') throw new Error('Expected question')
    await f.asOwner.mutation(api.contentFlags.flagQuizQuestion, { questionId: artifact.id, correctedAnswer: 'Reserved solution' })
    await f.t.run(ctx => reserve(ctx))
    await expect(f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: quiz.artifacts }))).rejects.toThrow('reservation check rejected')
  })

  test('a corrected section-card definition is checked against the reserved solution', async () => {
    const f = await setup()
    await registerSource(f)
    const section = await f.t.run(ctx => writeSectionCards(ctx, f))
    await f.asOwner.mutation(api.contentFlags.flagFlashcard, { cardId: section.cardId, correctedDefinition: 'Reserved solution' })
    await f.t.run(ctx => reserve(ctx))
    await expect(f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [section.artifacts[1]!] }))).rejects.toThrow('reservation check rejected')
  })

  test('section flag, unflag and flag again retain the registered deck lineage and the actual corrected projection', async () => {
    const f = await setup()
    await registerSource(f, true)
    const section = await f.t.run(ctx => writeSectionCards(ctx, f))
    await f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: section.artifacts }))
    for (const action of ['flag', 'unflag', 'flag'] as const) {
      const result = await f.asOwner.run(async ctx => {
        if (action === 'flag') await ctx.runMutation(api.contentFlags.flagFlashcard, { cardId: section.cardId, correctedDefinition: 'Corrected card solution' })
        else await ctx.runMutation(api.contentFlags.unflagFlashcard, { cardId: section.cardId })
        expect(await admitArtifactInputByIdentity(ctx, { kind: 'section_block', id: section.sectionId })).toMatchObject({ status: 'rejected', reasonCode: 'registration_required' })
        return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [section.artifacts[1]!] })
      })
      expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: result.references[0]! }))).toMatchObject({ status: 'admitted_registered' })
    }
  })
})


describe('Stage B document revision succession contract', () => {
  test.each(['document', 'document_chunk'] as const)('changed %s pins remain unavailable outside F1', async kind => {
    const f = await setup()
    await registerSource(f, true)
    const before = await inventory(f.t)
    await expect(f.asOwner.run(async ctx => {
      await ctx.runMutation(internal.documents.updateDocumentStatus, { id: f.documentId, status: 'success', sourceRevision: 'source.r2', contentHash: 'b'.repeat(64) })
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member({ kind, id: f.documentId }, kind === 'document_chunk' ? LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY : 'whole')] })
    })).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })
})

describe('Stage B card version projection succession', () => {
  test('a server-side version projection repair retains predecessor cases under its stable version ID', async () => {
    const f = await setup()
    await registerSource(f, true)
    const section = await f.t.run(ctx => writeSectionCards(ctx, f))
    const version = section.artifacts[0]!.artifact
    if (version.kind !== 'flashcard_version') throw new Error('Expected version')
    const first = await f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(version)] }))
    const second = await f.asOwner.run(async ctx => {
      const card = (await ctx.db.query('flashcardVersionCards').withIndex('by_versionId', q => q.eq('versionId', version.id)).take(1))[0]!
      await ctx.db.patch(card._id, { term: 'Repaired version scenario' })
      expect(await admitArtifactInputByIdentity(ctx, version)).toMatchObject({ status: 'rejected', reasonCode: 'registration_required' })
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(version)] })
    })
    expect(second.references[0]!.revision).toBe(first.references[0]!.revision)
    expect(second.references[0]!.payloadDigest).not.toBe(first.references[0]!.payloadDigest)
    expect(await f.t.run(ctx => ctx.db.get(first.lineageIds[0]!))).toHaveProperty('nextId', second.lineageIds[0])
    expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, version))).toMatchObject({ status: 'admitted_registered' })
    const state = await teachingInventory(f.t)
    expect(state.cases).toHaveLength(2)
    expect(state.lineages.at(-1)!.caseCount).toBe(2)
  })
})

describe('Stage B source availability and identity boundaries', () => {
  test.each(['invalidated', 'unknown_validation'] as const)('preparation rejects a source with %s lineage', async state => {
    const f = await setup()
    const source = await registerSource(f)
    await f.t.run(async ctx => {
      const row = (await ctx.db.get(source.lineageIds[0]!))!
      if (state === 'invalidated') await ctx.db.patch(row._id, { invalidatedAt: 0 })
      else await ctx.db.patch(row.validationId!, { decision: 'unknown' })
    })
    const before = await inventory(f.t)
    await expect(publishQuiz(f)).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })

  test('a historical lineage tombstone still prevents the ordinary legacy document exception', async () => {
    const f = await setup()
    const source = await registerSource(f, true)
    const quiz = await f.t.run(ctx => writeQuiz(ctx, f))
    await f.t.run(async ctx => {
      await ctx.db.patch(f.catalogId, { measurementCapability: { enabled: false } })
      for (const id of source.lineageIds) await ctx.db.patch(id, { nextId: id })
      await ctx.db.delete(f.documentId)
    })
    expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, quiz.artifacts[0]!.artifact))).toMatchObject({ status: 'rejected', reasonCode: 'lineage_unavailable' })
  })

  test.each([false, true])('an unpinned root document follows enrollment %s', async enrolled => {
    const f = await setup(enrolled)
    await f.t.run(ctx => ctx.db.patch(f.documentId, { contentHash: undefined, sourceRevision: undefined }))
    const artifact = { kind: 'document' as const, id: f.documentId }
    expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, artifact))).toMatchObject(enrolled
      ? { status: 'rejected', reasonCode: 'registration_required' }
      : { status: 'admitted_unregistered' })
  })

  test('a missing root is unavailable and an identity batch retains bounds and strict arguments', async () => {
    const f = await setup(false)
    const artifact = { kind: 'document' as const, id: f.documentId }
    await expect(f.asOwner.run(ctx => admitArtifactInputsByIdentity(ctx, { artifacts: [] }))).rejects.toThrow()
    await expect(f.asOwner.run(ctx => admitArtifactInputsByIdentity(ctx, { artifacts: Array.from({ length: 65 }, () => artifact) }))).rejects.toThrow()
    await expect(f.asOwner.run(ctx => admitArtifactInputsByIdentity(ctx, { artifacts: [artifact], decision: 'pass' }))).rejects.toThrow()
    expect(await f.asOwner.run(ctx => admitArtifactInputsByIdentity(ctx, { artifacts: Array.from({ length: 64 }, () => artifact) }))).toMatchObject({ status: 'admitted_unregistered' })
    await f.t.run(ctx => ctx.db.delete(f.documentId))
    expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, artifact))).toMatchObject({ status: 'rejected', reasonCode: 'lineage_unavailable' })
  })

  test('a same-mutation successor may strengthen source restrictions', async () => {
    const f = await setup()
    await registerSource(f)
    const first = await publishQuiz(f)
    const artifact = first.references[0]!.artifact
    if (artifact.kind !== 'quiz_question') throw new Error('Expected question')
    const next = await f.asOwner.run(async ctx => {
      await ctx.runMutation(api.quizzes.updateQuestion, { questionId: artifact.id, question: 'Stricter successor scenario' })
      const extra = await ctx.db.insert('folders', { userId, name: 'Additional required access', documentCount: 0 })
      const output = member(artifact)
      output.sources.push({ kind: 'folder', folderId: extra })
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [output] })
    })
    expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: next.references[0]! }))).toMatchObject({ status: 'admitted_registered' })
    const row = await f.t.run(ctx => ctx.db.get(next.lineageIds[0]!))
    expect(row!.sourceCount).toBe(2)
    expect(row!.caseCount).toBe(2)
  })
})

describe('Stage B identity-set authority and source registration', () => {
  test('source registration is required before enrolled teaching preparation', async () => {
    const f = await setup()
    const before = await inventory(f.t)
    await expect(publishQuiz(f)).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
    await registerSource(f)
    expect(await publishQuiz(f)).toMatchObject({ catalogRevision: 2 })
  })

  test.each(['registered_first', 'unregistered_first'] as const)('identity sets preserve a returned rejection in %s order', async order => {
    const f = await setup()
    await registerSource(f)
    const quiz = await f.t.run(ctx => writeQuiz(ctx, f))
    const document = { kind: 'document' as const, id: f.documentId }
    const question = quiz.artifacts[0]!.artifact
    const artifacts = order === 'registered_first' ? [document, question] : [question, document]
    expect(await f.asOwner.run(ctx => admitArtifactInputsByIdentity(ctx, { artifacts }))).toMatchObject({ status: 'rejected', reasonCode: 'registration_required' })
    expect(await f.asOwner.run(ctx => admitArtifactInputsByIdentityForOwner(ctx, userId, { artifacts }))).toMatchObject({ status: 'rejected', reasonCode: 'registration_required' })
    expect(await f.t.run(ctx => admitArtifactInputsByIdentityForRecord(ctx, document, { artifacts }))).toMatchObject({ status: 'rejected', reasonCode: 'registration_required' })
  })

  test('identity variants bind both session and authoritative-record ownership', async () => {
    const f = await setup(false)
    const own = { kind: 'document' as const, id: f.documentId }
    const other = await f.t.run(async ctx => {
      const folderId = await ctx.db.insert('folders', { userId: foreign.tokenIdentifier, name: 'Other', documentCount: 1 })
      return { kind: 'document' as const, id: await ctx.db.insert('documents', { userId: foreign.tokenIdentifier, folderId, filename: 'other.txt', fileSize: 1, status: 'success' }) }
    })
    expect(await f.asOwner.run(ctx => admitArtifactInputsByIdentityForOwner(ctx, userId, { artifacts: [own] }))).toMatchObject({ status: 'admitted_unregistered' })
    await expect(f.t.withIdentity(foreign).run(ctx => admitArtifactInputsByIdentityForOwner(ctx, userId, { artifacts: [own] }))).rejects.toThrow('access denied')
    for (const input of [own, { artifacts: [own] }]) {
      const operation = 'artifacts' in input
        ? f.t.run(ctx => admitArtifactInputsByIdentityForRecord(ctx, other, input))
        : f.t.run(ctx => admitArtifactInputByIdentityForRecord(ctx, other, input))
      expect(await operation).toMatchObject({ status: 'rejected' })
    }
    await expect(f.t.run(ctx => admitArtifactInputByIdentityForRecord(ctx, { ...own, userId } as never, own))).rejects.toThrow()
    await expect(f.t.run(ctx => admitArtifactInputsByIdentityForRecord(ctx, { ...own, userId } as never, { artifacts: [own] }))).rejects.toThrow()
  })
})

describe('Stage B independent enrollment, history and batch guards', () => {
  test.each([false, undefined])('personal-only preparation rejects enrollment %s without relying on source admission', async enabled => {
    const f = await setup(enabled)
    if (enabled === undefined) await f.t.run(ctx => ctx.db.patch(f.catalogId, { measurementCapability: undefined }))
    const before = await inventory(f.t)
    await expect(f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member({ kind: 'document', id: f.documentId })] }))).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })

  test('personal-only preparation rejects unknown catalogue history without an instructional source', async () => {
    const f = await setup(true, 'unknown')
    const before = await inventory(f.t)
    await expect(f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member({ kind: 'document', id: f.documentId })] }))).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })

  test('sequential preparation batches share a transaction and advance fresh catalogue revisions', async () => {
    const f = await setup()
    await registerSource(f)
    const result = await f.asOwner.run(async raw => {
      const total = createArtifactLineagePublicationContext(raw)
      const first = await writeQuiz(raw, f, [{ question: 'First sequential task', answer: 'First sequential solution' }])
      const a = await prepareAndRegisterInstructionalArtifacts(total.preparation.ctx, { artifacts: first.artifacts })
      const before = total.readUsage.chargedBytes
      const second = await writeQuiz(raw, f, [{ question: 'Second sequential task', answer: 'Second sequential solution' }])
      const b = await prepareAndRegisterInstructionalArtifacts(total.preparation.ctx, { artifacts: second.artifacts })
      expect(total.readUsage.chargedBytes).toBeGreaterThan(before)
      return { revisions: [a.catalogRevision, b.catalogRevision], references: [...a.references, ...b.references] }
    })
    expect(result.revisions).toEqual([2, 3])
    expect(await f.asOwner.run(ctx => admitArtifactInputs(ctx, { references: result.references }))).toMatchObject({ status: 'admitted_registered' })
  })
})
