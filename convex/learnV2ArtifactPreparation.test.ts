/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test'
import { getDocumentSize } from 'convex/values'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import schema from './schema'
import { authorizeExport } from '../tests/fixtures/learn-v2-personal-export'
import {
  advanceAssessmentCatalogForOwner, classifyPersonalWorkDocumentForOwner, classifyPersonalWorkDocumentForRecord,
  createArtifactLineageReadContext, createArtifactLineagePublicationContext, instructionalReservationSemanticAdapter, isArtifactRegistrationRequired,
  isArtifactRegistrationRequiredForOwner, isArtifactRegistrationRequiredForRecord, normalizedInstructionalCaseFingerprints,
  prepareAndRegisterInstructionalArtifacts, prepareAndRegisterInstructionalArtifactsForOwner, prepareAndRegisterInstructionalArtifactsForRecord,
  resolveArtifactLineageForOwner,
  admitArtifactInput, admitArtifactInputs, artifactContentProjection, artifactPayloadDigest, artifactManifestDigest,
  admitArtifactInputByIdentity, admitArtifactInputByIdentityForOwner, admitArtifactInputByIdentityForRecord, admitArtifactInputsByIdentity, admitArtifactInputsByIdentityForOwner, admitArtifactInputsByIdentityForRecord,
  repinArtifactLineageDescendants, repinArtifactLineageDescendantsForOwner, repinArtifactLineageDescendantsForRecord,
} from './lib/learnV2ArtifactLineage'
import { LEARN_ARTIFACT_CASE_IDENTITY_VERSION, LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY, LEARN_ARTIFACT_LINEAGE_LIMITS, type LearnArtifactPreparationArgs, type LearnArtifactReference } from '../shared/learn-v2-artifact-lineage'

const modules = import.meta.glob('./**/*.ts')
const owner = { tokenIdentifier: 'https://auth.example.com|preparation-owner', subject: 'same-subject' }
const foreign = { tokenIdentifier: 'https://other.example.com|preparation-owner', subject: 'same-subject' }
const userId = owner.tokenIdentifier
const base = { userId, storageVersion: 'learn-v2.measurement-storage.v1' as const, createdAt: 1_800_000_000_000 }
type Store = TestConvex<typeof schema>
type Fixture = Awaited<ReturnType<typeof setup>>

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

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
    const authorizationId = await authorizeExport(f.asOwner)
    for (const collection of ['learnArtifactValidations', 'learnAssessmentCatalogs'] as const) {
      const exported = await f.asOwner.query(api.dataExport.getUserDataPage, { authorizationId, collection, paginationOpts: { cursor: null, numItems: 8 } })
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

  test('only an exact scenario and solution pair reuses a case in the same batch', async () => {
    const f = await setup()
    await registerSource(f)
    await publishQuiz(f, [{ question: 'Task A', answer: 'Solution A' }, { question: 'Task B', answer: 'Solution B' }, { question: 'Task A', answer: 'Solution B' }, { question: ' TASK  a', answer: 'solution A ' }])
    const state = await inventory(f.t)
    expect(state.cases).toHaveLength(3)
    expect(state.bindings.map(row => row.caseId)).toEqual([state.cases[0]!._id, state.cases[1]!._id, state.cases[2]!._id, state.cases[0]!._id])
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

  test('rejects a late batch collision without partial writes and returns an unchanged active binding', async () => {
    const f = await setup()
    await registerSource(f)
    const first = await publishQuiz(f)
    const before = await inventory(f.t)
    expect(await f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(first.references[0]!.artifact as LearnArtifactPreparationArgs['artifacts'][number]['artifact'])] })))
      .toMatchObject({ lineageIds: first.lineageIds, references: first.references, catalogRevision: first.catalogRevision })
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


async function fullLineageInventory(t: Store) {
  return t.run(async ctx => {
    const state = []
    for (const table of ['learnAssessmentCatalogs', 'learnAssessmentCases', 'learnArtifactLineages', 'learnArtifactLineageOrigins', 'learnArtifactCaseBindings', 'learnArtifactValidations', 'learnArtifactSourceLinks'] as const) {
      const rows = await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(4000)
      expect(rows.length).toBeLessThan(4000)
      state.push(rows)
    }
    return state
  })
}

describe('round-2 producer budgets', { timeout: 30_000 }, () => {
  test.each(['Quiz', 'section_procedural', 'section_factual', 'section_conceptual', 'Flashcards', 'Flashcards_200', 'Audio Overview', 'document'] as const)('%s admits maximum sources and prepares the full output batch', async shape => {
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
      if (shape.startsWith('Flashcards') || section) {
        // A full deck keeps every card's quote within the 500,000-byte content ceiling.
        const full = shape === 'Flashcards_200'
        const cardCount = full ? 200 : shape === 'section_procedural' ? 8 : shape === 'section_conceptual' ? 12 : 16
        const roomId = await ctx.db.insert('flashcardRooms', { userId, folderId: f.folderId, title: 'Cards', updatedAt: base.createdAt })
        const versionId = await ctx.db.insert('flashcardRoomVersions', { userId, roomId, title: 'Cards', origin: 'ai', cardCount, ...(full ? { prompt: 'p'.repeat(2000) } : {}) })
        for (let i = 0; i < cardCount; i++) {
          const card = { userId, roomId, term: `Term ${i}`, definition: `Definition ${i}`, displayOrder: i, sourceDocumentId: docs[i % docs.length], sourceChunkContent: 's'.repeat(full ? 2050 : 8192) }
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
      return { shape, inputs: refs.length, outputs: published.references.length, references: published.references, lineageIds: published.lineageIds, admission, preparation, publication, producer, sameTransaction, total: publication }
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
      expect(versionCardReads).toBe(section || shape.startsWith('Flashcards') ? 2 : 0)
      return { ...total.readUsage, ranges: total.indexRanges, versionCardReads }
    })
    const beforeReplay = await fullLineageInventory(f.t)
    const replay = await f.asOwner.run(async raw => {
      const total = createArtifactLineagePublicationContext(raw)
      expect(await isArtifactRegistrationRequired(total.admission.ctx)).toBe(true)
      if (refs.length) expect(await admitArtifactInputs(total.admission.ctx, { references: refs })).toMatchObject({ status: 'admitted_registered' })
      const producer = { chargedBytes: 0, ranges: 0 }
      for (const id of [f.folderId, ...docs.slice(0, count)]) {
        const row = await raw.db.get(id)
        producer.ranges++
        if (row) producer.chargedBytes += getDocumentSize(row) + 64
      }
      const prepared = await prepareAndRegisterInstructionalArtifacts(total.preparation.ctx, { artifacts: result.references.map(reference =>
        member(reference.artifact as LearnArtifactPreparationArgs['artifacts'][number]['artifact'], reference.key)) })
      expect(prepared.references).toEqual(result.references)
      expect(prepared.lineageIds).toEqual(result.lineageIds)
      return { ...total.readUsage, ranges: total.indexRanges, producer, preparation: { ...total.preparation.readUsage, ranges: total.preparation.indexRanges } }
    })
    expect(await fullLineageInventory(f.t)).toEqual(beforeReplay)
    expect(replay.ranges).toBeLessThanOrEqual(3072)
    expect(replay.chargedBytes).toBeLessThan(8 * 1024 * 1024)
    // Edit writers re-register a section alone; its components are admitted.
    const edit = !section ? undefined : await f.asOwner.run(async raw => {
      const reference = result.references.find(ref => ref.artifact.kind === 'section_block')!
      if (reference.artifact.kind !== 'section_block') throw new Error('Expected section')
      await raw.db.patch(reference.artifact.id, { title: 'Edited section' })
      const total = createArtifactLineagePublicationContext(raw)
      await prepareAndRegisterInstructionalArtifacts(total.preparation.ctx, { artifacts: [0, 1, 2, 3].map(index => member(reference.artifact as LearnArtifactPreparationArgs['artifacts'][number]['artifact'], `block-${index}`)) })
      return { ...total.readUsage, ranges: total.indexRanges }
    })
    const { references: _references, lineageIds: _lineageIds, ...metrics } = result
    console.log(JSON.stringify({ ...metrics, later, replay, edit }))
    if (edit) {
      expect(edit.ranges).toBeLessThanOrEqual(3072)
      expect(edit.chargedBytes).toBeLessThan(8 * 1024 * 1024)
    }
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
      const found = await f.t.run(ctx => ctx.db.query('learnAssessmentCases').withIndex('by_userId_and_scenarioFingerprint_and_solutionFingerprint', q => q.eq('userId', userId)
        .eq('scenarioFingerprint', pins.scenarioFingerprint).eq('solutionFingerprint', pins.solutionFingerprint)).take(2))
      expect(found).toHaveLength(1)
      expect(found[0]!.usageClass).toBe('instructional')
    }
    const state = await inventory(f.t)
    expect(state.cases).toHaveLength(new Set(questions.map(row => `${row.question}\n${row.answer}`)).size)
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
    const [original] = (await inventory(f.t)).cases
    const pairs = { flag: await normalizedInstructionalCaseFingerprints('How does rain form?', 'Corrected solution'), unflag: await normalizedInstructionalCaseFingerprints('How does rain form?', 'Water condenses.') }
    for (const action of ['flag', 'unflag', 'flag'] as const) {
      const before = published.references[0]!
      published = await f.asOwner.run(async ctx => {
        if (action === 'flag') await ctx.db.patch(question.id, { flagged: true, correctedAnswer: 'Corrected solution' })
        else await ctx.db.patch(question.id, { flagged: undefined, correctedAnswer: undefined })
        expect(await admitArtifactInputByIdentity(ctx, question)).toMatchObject({ status: 'rejected', reasonCode: 'registration_required' })
        return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(question)] })
      })
      expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, question))).toMatchObject({ status: 'admitted_registered' })
      expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference: before }))).toMatchObject({ status: 'unavailable' })
      const state = await inventory(f.t)
      expect(state.cases).toHaveLength(2)
      expect(state.cases[0]).toEqual(original)
      expect(state.cases.every(row => row.usageClass === 'instructional')).toBe(true)
      const bound = state.bindings.filter(row => row.lineageId === published.lineageIds[0])
      expect(bound).toMatchObject([pairs[action]])
    }
  })

  test('forty content edits bind only current cases, keep every taught case and never lock out', async () => {
    const f = await setup()
    await registerSource(f)
    let published = await publishQuiz(f)
    const artifact = published.references[0]!.artifact
    if (artifact.kind !== 'quiz_question') throw new Error('Expected question')
    for (let i = 0; i < 40; i++) {
      published = await f.asOwner.run(async ctx => {
        await ctx.db.patch(artifact.id, { question: `Edited scenario ${i}` })
        return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(artifact)] })
      })
      expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: published.references[0]! }))).toMatchObject({ status: 'admitted_registered' })
    }
    const state = await teachingInventory(f.t)
    expect(state.cases).toHaveLength(41)
    expect(state.cases.every(row => row.usageClass === 'instructional')).toBe(true)
    expect(state.lineages.filter(row => row.nextId === undefined)).toHaveLength(1)
    expect(state.lineages.every(row => row.caseCount === 1)).toBe(true)
    expect(new Set(state.bindings.map(row => row.caseId)).size).toBe(41)
  })

  test.each(['measurement', 'private_scoring', 'unknown'] as const)('a restrictive stranded %s row cannot be superseded by teaching', async classification => {
    const f = await setup()
    await registerSource(f)
    const published = await publishQuiz(f)
    const artifact = published.references[0]!.artifact
    if (artifact.kind !== 'quiz_question') throw new Error('Expected question')
    await f.t.run(ctx => ctx.db.patch(published.lineageIds[0]!, { classification }))
    await f.t.run(ctx => ctx.db.patch(artifact.id, { question: 'Stranded protected scenario' }))
    const before = await inventory(f.t)
    await expect(f.asOwner.run(async ctx => {
      await ctx.db.patch(artifact.id, { question: 'A different scenario' })
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
    await f.t.run(ctx => ctx.db.patch(artifact.id, { flagged: true, correctedAnswer: 'Reserved solution' }))
    await f.t.run(ctx => reserve(ctx))
    await expect(f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: quiz.artifacts }))).rejects.toThrow('reservation check rejected')
  })

  test('a corrected section-card definition is checked against the reserved solution', async () => {
    const f = await setup()
    await registerSource(f)
    const section = await f.t.run(ctx => writeSectionCards(ctx, f))
    await f.t.run(ctx => ctx.db.patch(section.cardId, { flagged: true, correctedDefinition: 'Reserved solution' }))
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
        if (action === 'flag') await ctx.db.patch(section.cardId, { flagged: true, correctedDefinition: 'Corrected card solution' })
        else await ctx.db.patch(section.cardId, { flagged: undefined, correctedDefinition: undefined })
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
  test('a server-side version projection repair keeps its stable version ID and binds only its current cards', async () => {
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
    expect(state.lineages.map(row => row.caseCount)).toEqual([1, 1])
    expect(state.bindings.map(row => row.caseId)).toEqual(state.cases.map(row => row._id))
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
      await ctx.db.patch(artifact.id, { question: 'Stricter successor scenario' })
      const extra = await ctx.db.insert('folders', { userId, name: 'Additional required access', documentCount: 0 })
      const output = member(artifact)
      output.sources.push({ kind: 'folder', folderId: extra })
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [output] })
    })
    expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: next.references[0]! }))).toMatchObject({ status: 'admitted_registered' })
    const row = await f.t.run(ctx => ctx.db.get(next.lineageIds[0]!))
    expect(row!.sourceCount).toBe(2)
    expect(row!.caseCount).toBe(1)
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

type QuizArtifact = Extract<LearnArtifactReference['artifact'], { kind: 'quiz_question' }>
function quizArtifact(reference: LearnArtifactReference) {
  if (reference.artifact.kind !== 'quiz_question') throw new Error('Expected question')
  return reference.artifact as QuizArtifact
}

type RunCtx = Parameters<Parameters<Store['run']>[0]>[0]
async function writeLinkedSection(ctx: RunCtx, f: Pick<Fixture, 'folderId' | 'documentId'>, options: { questions: number, cards: number, audio?: boolean, prompt?: string, sources?: Doc<'documents'>['_id'][], text?: (kind: 'task' | 'solution' | 'term' | 'definition', index: number) => string }) {
  const source = (index: number) => options.sources?.[index % options.sources.length] ?? f.documentId
  const text = options.text ?? ((kind, index) => `Linked ${kind} ${index}`)
  const courseId = await ctx.db.insert('courses', { userId, folderId: f.folderId, title: 'Course', status: 'ready', sourceType: 'folder', sourceConfidence: { docCount: 1, webPercent: 0 }, pace: 'steady',
    outlineSections: [], completedSectionCount: 0, totalSectionCount: 1, webSearchEnabled: false, createdAt: base.createdAt, updatedAt: base.createdAt })
  const quizId = await ctx.db.insert('quizzes', { userId, folderId: f.folderId, title: 'Section Quiz', status: 'ready', questionCount: options.questions, creationMethod: 'auto_generated', courseScoped: true, courseId })
  const questions = []
  for (let order = 0; order < options.questions; order++) {
    questions.push(await ctx.db.insert('quizQuestions', { userId, quizId, order, question: text('task', order), correctAnswer: text('solution', order), type: 'free-response', sourceDocumentId: source(order) }))
  }
  const contentBlocks: Doc<'courseSections'>['contentBlocks'] = [{ type: 'text', order: 0, content: 'Section prose' }, { type: 'quiz', order: 1, entityId: quizId }]
  const artifacts = questions.map(id => member({ kind: 'quiz_question', id }))
  let versionId: Doc<'flashcardRoomVersions'>['_id'] | undefined
  if (options.cards) {
    const roomId = await ctx.db.insert('flashcardRooms', { userId, folderId: f.folderId, title: 'Section cards', updatedAt: base.createdAt, courseScoped: true })
    versionId = await ctx.db.insert('flashcardRoomVersions', { userId, roomId, title: 'Section cards', origin: 'ai', cardCount: options.cards, prompt: options.prompt })
    for (let displayOrder = 0; displayOrder < options.cards; displayOrder++) {
      const card = { userId, roomId, term: text('term', displayOrder), definition: text('definition', displayOrder), displayOrder, sourceDocumentId: source(displayOrder) }
      await ctx.db.insert('flashcardRoomCards', card)
      await ctx.db.insert('flashcardVersionCards', { ...card, versionId })
    }
    await ctx.db.patch(roomId, { activeVersionId: versionId })
    contentBlocks.push({ type: 'flashcard', order: 2, entityId: roomId })
    artifacts.push(member({ kind: 'flashcard_version', id: versionId }))
  }
  if (options.audio) {
    const audioFileId = await ctx.storage.store(new Blob(['audio']))
    const audioId = await ctx.db.insert('audioOverviews', { userId, folderId: f.folderId, title: 'Section Audio Overview', status: 'ready', courseScoped: true, totalDurationMs: 1000,
      voiceProfile: { hostA: 'a', hostB: 'b' }, sourceDocumentIds: [f.documentId], turns: [{ speaker: 'host_a', text: 'Spoken section content', audioFileId, durationMs: 1000 }] })
    contentBlocks.push({ type: 'audio', order: 3, entityId: audioId })
    artifacts.push(member({ kind: 'audio_overview', id: audioId }))
  }
  const sectionId = await ctx.db.insert('courseSections', { userId, courseId, title: 'Linked section', order: 0, knowledgeType: 'procedural', status: 'ready', masteryLevel: 'new', contentBlocks })
  artifacts.push(member({ kind: 'section_block', id: sectionId }))
  return { courseId, quizId, questions, versionId, sectionId, artifacts }
}

async function bindingsFor(t: Store, lineageId: Doc<'learnArtifactLineages'>['_id']) {
  return t.run(ctx => ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', lineageId)).take(450))
}

async function registerDocument(f: Fixture, name: string) {
  const id = await f.t.run(ctx => ctx.db.insert('documents', { userId, folderId: f.folderId, filename: `${name}.txt`, fileSize: 12, status: 'success', sourceRevision: 'source.r1', contentHash: 'b'.repeat(64), r2Key: `owned/${name}.r1` }))
  await f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member({ kind: 'document', id }), member({ kind: 'document_chunk', id }, LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY)] }))
  return id
}

describe('B2 revision succession binds current content', { timeout: 60_000 }, () => {
  test('a generated section survives thirty title edits and binds only its current cases', async () => {
    const f = await setup()
    await registerSource(f, true)
    const section = await f.asOwner.run(async ctx => {
      const written = await writeLinkedSection(ctx, f, { questions: 10, cards: 8 })
      await prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: written.artifacts })
      return written
    })
    const artifact = { kind: 'section_block' as const, id: section.sectionId }
    for (let i = 0; i < 30; i++) {
      await f.asOwner.run(async ctx => {
        await ctx.db.patch(section.sectionId, { title: `Edited section ${i}` })
        expect(await admitArtifactInputByIdentity(ctx, artifact)).toMatchObject({ status: 'rejected', reasonCode: 'registration_required' })
        await prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(artifact)] })
      })
      expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, artifact))).toMatchObject({ status: 'admitted_registered' })
    }
    const state = await teachingInventory(f.t)
    const sections = state.lineages.filter(row => row.artifact.kind === 'section_block')
    expect(sections).toHaveLength(31)
    expect(sections.filter(row => row.nextId === undefined)).toHaveLength(1)
    expect(sections.every(row => row.caseCount === 19)).toBe(true)
    expect(state.cases).toHaveLength(18 + 31)
    expect(state.cases.every(row => row.usageClass === 'instructional')).toBe(true)
  })

  test('a flagged question keeps the sources and origins its generator recorded', async () => {
    const f = await setup()
    await registerSource(f, true)
    const origin = await publishQuiz(f, [{ question: 'Original generated task', answer: 'Original generated solution' }])
    const published = await f.asOwner.run(async ctx => {
      const quiz = await writeQuiz(ctx, f, [{ question: 'Rewritten task', answer: 'Rewritten solution' }])
      const scope = await ctx.db.insert('folders', { userId, name: 'Generation scope', documentCount: 0 })
      quiz.artifacts[0]!.origins = [{ reference: origin.references[0]!, transformation: 'rewrite' }]
      quiz.artifacts[0]!.sources = [{ kind: 'folder', folderId: scope }]
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: quiz.artifacts })
    })
    const question = quizArtifact(published.references[0]!)
    const flagged = await f.asOwner.run(async ctx => {
      await ctx.db.patch(question.id, { flagged: true, correctedAnswer: 'Corrected rewritten solution' })
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(question)] })
    })
    expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, question))).toMatchObject({ status: 'admitted_registered' })
    const rows = await f.t.run(async ctx => ({
      before: await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', published.lineageIds[0]!)).take(10),
      after: await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', flagged.lineageIds[0]!)).take(10),
      origins: await ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', flagged.lineageIds[0]!)).take(10),
      row: await ctx.db.get(flagged.lineageIds[0]!),
    }))
    expect(rows.before).toHaveLength(2)
    expect(rows.after.map(link => link.dependency)).toEqual(expect.arrayContaining(rows.before.map(link => link.dependency)))
    expect(rows.after).toHaveLength(2)
    expect(rows.origins).toMatchObject([{ originLineageId: origin.lineageIds[0], transformation: 'rewrite' }])
    expect(rows.row).toMatchObject({ derivation: 'derived', originCount: 1, caseCount: 1, sourceCount: 2 })
  })

  test('deleting a linked question keeps its source document on the containing section', async () => {
    const f = await setup()
    await registerSource(f, true)
    const other = await registerDocument(f, 'other')
    const section = await f.asOwner.run(async ctx => {
      const written = await writeLinkedSection(ctx, f, { questions: 2, cards: 0, sources: [f.documentId, other] })
      await prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: written.artifacts })
      return written
    })
    const artifact = { kind: 'section_block' as const, id: section.sectionId }
    const next = await f.asOwner.run(async ctx => {
      await ctx.runMutation(api.quizzes.deleteQuestion, { questionId: section.questions[1]! })
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(artifact)] })
    })
    expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, artifact))).toMatchObject({ status: 'admitted_registered' })
    const links = await f.t.run(ctx => ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', next.lineageIds[0]!)).take(10))
    expect(links.map(link => link.dependency)).toEqual(expect.arrayContaining([expect.objectContaining({ documentId: other }), expect.objectContaining({ documentId: f.documentId })]))
    expect(await bindingsFor(f.t, next.lineageIds[0]!)).toHaveLength(2)
  })

  test('a successor still cannot drop a deleted generation source', async () => {
    const f = await setup()
    await registerSource(f, true)
    const other = await registerDocument(f, 'deleted-source')
    const published = await f.asOwner.run(async ctx => {
      const quiz = await writeQuiz(ctx, f)
      quiz.artifacts[0]!.sources = [{ kind: 'document', documentId: other, sourceRevision: 'source.r1' }]
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: quiz.artifacts })
    })
    const question = quizArtifact(published.references[0]!)
    await f.t.run(ctx => ctx.db.delete(other))
    const before = await inventory(f.t)
    await expect(f.asOwner.run(async ctx => {
      await ctx.db.patch(question.id, { question: 'Edited after source deletion' })
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(question)] })
    })).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })

  test('a teaching successor binds only its own checked cases while its predecessor keeps reserved history', async () => {
    const f = await setup()
    await registerSource(f, true)
    const first = await publishQuiz(f, [{ question: 'Superseded task', answer: 'Superseded solution' }])
    const question = quizArtifact(first.references[0]!)
    const [taught] = (await inventory(f.t)).cases
    await f.t.run(ctx => ctx.db.patch(taught!._id, { reservedAt: 0 }))
    vi.spyOn(instructionalReservationSemanticAdapter, 'compare').mockResolvedValue({ decision: 'pass', coverage: 'complete' })
    const edit = (fields: { question?: string, correctAnswer?: string, explanation?: string }) => f.asOwner.run(async ctx => {
      await ctx.db.patch(question.id, { ...fields })
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(question)] })
    })
    await expect(edit({ explanation: 'Only the explanation changed' })).rejects.toThrow('reservation check rejected')
    const next = await edit({ question: 'An unrelated replacement task', correctAnswer: 'An unrelated replacement solution' })
    expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, question))).toMatchObject({ status: 'admitted_registered' })
    expect((await bindingsFor(f.t, first.lineageIds[0]!)).map(row => row.caseId)).toEqual([taught!._id])
    expect((await bindingsFor(f.t, next.lineageIds[0]!)).map(row => row.caseId)).not.toContain(taught!._id)
    expect(await f.t.run(ctx => ctx.db.get(taught!._id))).toMatchObject({ reservedAt: 0, usageClass: 'instructional' })
  })
})

describe('B2 per-kind case caps', { timeout: 60_000 }, () => {
  test('a 200-card deck with its prompt and a section above thirty-two cases register and admit', async () => {
    const f = await setup()
    await registerSource(f, true)
    const section = await f.asOwner.run(async ctx => {
      const written = await writeLinkedSection(ctx, f, { questions: 40, cards: 200, prompt: 'Make cards about cloud formation' })
      return { ...written, result: await prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: written.artifacts }) }
    })
    const state = await teachingInventory(f.t)
    const counts = Object.fromEntries(state.lineages.filter(row => row.classification === 'teaching').map(row => [row.artifact.kind, row.caseCount]))
    expect(counts).toEqual({ quiz_question: 1, flashcard_version: 201, section_block: 241 })
    expect(state.cases).toHaveLength(242)
    const deck = { kind: 'flashcard_version' as const, id: section.versionId! }
    const sectionArtifact = { kind: 'section_block' as const, id: section.sectionId }
    expect(await f.asOwner.run(ctx => admitArtifactInputsByIdentity(ctx, { artifacts: [deck, sectionArtifact] }))).toMatchObject({ status: 'admitted_registered' })
    const resolved = await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference: section.result.references.at(-1)! }))
    expect(resolved).toMatchObject({ status: 'bound', instructionalRegistered: true })
    expect(resolved.status === 'bound' && resolved.cases).toHaveLength(241)
  })
})

describe('B2 exact pair identity', () => {
  test('a corrected answer binds its own pair, so reserving it later rejects admission', async () => {
    const f = await setup()
    await registerSource(f, true)
    const first = await publishQuiz(f, [{ question: 'What is the capital of Australia?', answer: 'Sydney' }])
    const question = quizArtifact(first.references[0]!)
    const corrected = await f.asOwner.run(async ctx => {
      await ctx.db.patch(question.id, { flagged: true, correctedAnswer: 'Canberra' })
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(question)] })
    })
    expect(await bindingsFor(f.t, corrected.lineageIds[0]!)).toMatchObject([await normalizedInstructionalCaseFingerprints('What is the capital of Australia?', 'Canberra')])
    expect(await bindingsFor(f.t, first.lineageIds[0]!)).toMatchObject([await normalizedInstructionalCaseFingerprints('What is the capital of Australia?', 'Sydney')])
    expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, question))).toMatchObject({ status: 'admitted_registered' })
    await f.t.run(ctx => reserve(ctx, 'Name the national capital of Australia', 'Canberra'))
    expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, question))).toMatchObject({ status: 'rejected', reasonCode: 'lineage_unavailable' })
    expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference: corrected.references[0]! }))).toMatchObject({ status: 'unavailable' })
  })

  test('"Which of the following is true?" stems keep one case per exact pair and fail closed on either fingerprint', async () => {
    const f = await setup()
    await registerSource(f, true)
    const stem = 'Which of the following is true?'
    const first = await publishQuiz(f, ['Water boils at 100 °C at sea level', 'The Moon orbits the Earth', 'Copper conducts electricity'].map(answer => ({ question: stem, answer })))
    const second = await publishQuiz(f, ['The Moon orbits the Earth', 'Light travels faster than sound'].map(answer => ({ question: stem, answer })))
    const state = await teachingInventory(f.t)
    expect(state.cases).toHaveLength(4)
    expect(state.bindings.map(row => row.caseId)).toEqual([...state.cases.slice(0, 3).map(row => row._id), state.cases[1]!._id, state.cases[3]!._id])
    const references = [...first.references, ...second.references]
    const admit = async () => {
      const statuses = []
      for (const reference of references) statuses.push((await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference }))).status)
      return statuses
    }
    expect(await admit()).toEqual(Array(5).fill('admitted_registered'))
    await f.t.run(ctx => reserve(ctx, 'A held-out conductor question', 'Copper conducts electricity'))
    expect(await admit()).toEqual(['admitted_registered', 'admitted_registered', 'rejected', 'admitted_registered', 'admitted_registered'])
    await f.t.run(ctx => reserve(ctx, stem, 'A held-out answer'))
    expect(await admit()).toEqual(Array(5).fill('rejected'))
  })

  test('a pair recorded under another identity policy is never reused', async () => {
    const f = await setup()
    await registerSource(f, true)
    await f.t.run(async ctx => ctx.db.insert('learnAssessmentCases', { ...base, ...await normalizedInstructionalCaseFingerprints('How does rain form?', 'Water condenses.'),
      caseKey: 'other-policy', identityPolicyVersion: 'learn-v2.other-identity.v1', usageClass: 'unknown' }))
    const before = await inventory(f.t)
    await expect(publishQuiz(f)).rejects.toThrow('reservation check rejected')
    expect(await inventory(f.t)).toEqual(before)
  })

  test('a reservation under another identity policy fails closed for preparation and admission', async () => {
    const f = await setup()
    await registerSource(f, true)
    const published = await publishQuiz(f)
    expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: published.references[0]! }))).toMatchObject({ status: 'admitted_registered' })
    await f.t.run(async ctx => ctx.db.patch(await reserve(ctx, 'Unrelated held-out task', 'Unrelated held-out solution'), { identityPolicyVersion: 'learn-v2.other-identity.v1' }))
    vi.spyOn(instructionalReservationSemanticAdapter, 'compare').mockResolvedValue({ decision: 'pass', coverage: 'complete' })
    const before = await inventory(f.t)
    await expect(publishQuiz(f, [{ question: 'Fresh task', answer: 'Fresh solution' }])).rejects.toThrow('reservation check unknown')
    expect(await inventory(f.t)).toEqual(before)
    expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: published.references[0]! }))).toMatchObject({ status: 'rejected', reasonCode: 'lineage_unavailable' })
  })
})

describe('B2 descendant re-pinning', { timeout: 60_000 }, () => {
  test('copies re-pin to an origin successor explicitly or at their next publication, never silently', async () => {
    const f = await setup()
    await registerSource(f, true)
    const origin = await publishQuiz(f, [{ question: 'Origin task', answer: 'Origin solution' }])
    const copies: Awaited<ReturnType<typeof publishQuiz>>[] = []
    for (const label of ['explicit', 'lazy', 'edited']) {
      copies.push(await f.asOwner.run(async ctx => {
        const quiz = await writeQuiz(ctx, f, [{ question: `Copied ${label} task`, answer: `Copied ${label} solution` }])
        quiz.artifacts[0]!.origins = [{ reference: origin.references[0]!, transformation: 'copy' }]
        return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: quiz.artifacts })
      }))
    }
    const [explicit, lazy, edited] = copies.map(copy => quizArtifact(copy.references[0]!))
    const successor = await f.asOwner.run(async ctx => {
      await ctx.db.patch(quizArtifact(origin.references[0]!).id, { question: 'Origin task, revised' })
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(quizArtifact(origin.references[0]!))] })
    })
    for (const copy of copies) {
      expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: copy.references[0]! }))).toMatchObject({ status: 'rejected', reasonCode: 'lineage_unavailable' })
      expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference: copy.references[0]! }))).toMatchObject({ status: 'unavailable' })
    }
    await expect(f.t.withIdentity(foreign).run(ctx => repinArtifactLineageDescendantsForOwner(ctx, userId, { artifacts: [explicit!] }))).rejects.toThrow('access denied')
    await expect(f.asOwner.run(ctx => repinArtifactLineageDescendants(ctx, { artifacts: [explicit!], origins: [] }))).rejects.toThrow()
    await f.t.run(ctx => ctx.db.patch(edited!.id, { question: 'Copied edited task, changed' }))
    const repinned = await f.t.run(ctx => repinArtifactLineageDescendantsForRecord(ctx, { kind: 'document', id: f.documentId }, { artifacts: [explicit!, edited!] }))
    expect(repinned).toMatchObject({ references: [copies[0]!.references[0]], catalogRevision: successor.catalogRevision + 1 })
    expect(await f.asOwner.run(ctx => repinArtifactLineageDescendants(ctx, { artifacts: [explicit!] }))).toMatchObject({ lineageIds: [], references: [], catalogRevision: repinned.catalogRevision })
    expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, edited!))).toMatchObject({ status: 'rejected', reasonCode: 'registration_required' })
    const lazyResult = await f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(lazy!)] }))
    const editedResult = await f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(edited!)] }))
    for (const [index, result] of [repinned, lazyResult, editedResult].entries()) {
      const reference = result.references[0]!
      expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference }))).toMatchObject({ status: 'bound', lineageId: result.lineageIds[0], originLineageIds: [successor.lineageIds[0]] })
      expect(await f.t.run(ctx => ctx.db.get(copies[index]!.lineageIds[0]!))).toHaveProperty('nextId', result.lineageIds[0])
      expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference }))).toMatchObject({ status: 'admitted_registered' })
    }
    expect(lazyResult.references).toEqual(copies[1]!.references)
  })
})

describe('B2 enrollment, idempotency and linked components', { timeout: 60_000 }, () => {
  test.each(['unchanged', 'edited', 'origin_edited', 'invalidated', 'origin_invalidated', 'origin_deleted', 'reserved', 'restricted', 'reenabled'] as const)('a disabled capability resolves %s registered teaching by its lineage', async condition => {
    const f = await setup()
    await registerSource(f, true)
    const origin = await publishQuiz(f, [{ question: 'Origin task', answer: 'Origin solution' }])
    const copy = await f.asOwner.run(async ctx => {
      const quiz = await writeQuiz(ctx, f, [{ question: 'Copied task', answer: 'Copied solution' }])
      quiz.artifacts[0]!.origins = [{ reference: origin.references[0]!, transformation: 'copy' }]
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: quiz.artifacts })
    })
    const artifact = quizArtifact(copy.references[0]!)
    await f.t.run(ctx => ctx.db.patch(f.catalogId, { measurementCapability: { enabled: false } }))
    if (condition === 'origin_edited') await f.t.run(ctx => ctx.db.patch(quizArtifact(origin.references[0]!).id, { question: 'Origin edited while unenrolled' }))
    else if (condition !== 'unchanged') await f.t.run(ctx => ctx.db.patch(artifact.id, { question: 'Edited while unenrolled' }))
    await f.t.run(async ctx => {
      const row = (await ctx.db.get(copy.lineageIds[0]!))!
      if (condition === 'invalidated') await ctx.db.patch(row._id, { invalidatedAt: 0 })
      if (condition === 'origin_invalidated') await ctx.db.patch(origin.lineageIds[0]!, { invalidatedAt: 0 })
      if (condition === 'origin_deleted') await ctx.db.patch((await ctx.db.get(quizArtifact(origin.references[0]!).id))!.quizId, { deletedAt: 0 })
      if (condition === 'restricted') await ctx.db.patch(row._id, { classification: 'measurement' })
      if (condition === 'reserved') {
        const [binding] = await ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', row._id)).take(1)
        await ctx.db.patch(binding!.caseId, { reservedAt: 0 })
      }
      if (condition === 'reenabled') await ctx.db.patch(f.catalogId, { measurementCapability: { enabled: true } })
    })
    const expected = {
      unchanged: { status: 'admitted_registered' }, edited: { status: 'admitted_unregistered' }, origin_edited: { status: 'admitted_unregistered' },
      invalidated: { status: 'rejected', reasonCode: 'lineage_unavailable' }, origin_invalidated: { status: 'rejected', reasonCode: 'lineage_unavailable' },
      origin_deleted: { status: 'rejected', reasonCode: 'lineage_unavailable' }, reserved: { status: 'rejected', reasonCode: 'lineage_unavailable' },
      restricted: { status: 'rejected', reasonCode: 'restricted_lineage' }, reenabled: { status: 'rejected', reasonCode: 'registration_required' },
    }[condition]
    expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, artifact))).toMatchObject(expected)
  })

  test('a stale key cannot hide behind a current sibling key for an owner who is not enrolled', async () => {
    const f = await setup()
    await registerSource(f, true)
    const published = await f.asOwner.run(async ctx => {
      const quiz = await writeQuiz(ctx, f)
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [quiz.artifacts[0]!, member(quiz.artifacts[0]!.artifact, 'sibling')] })
    })
    const question = quizArtifact(published.references[0]!)
    await f.asOwner.run(async ctx => {
      await ctx.db.patch(question.id, { question: 'Only the whole key is re-registered' })
      await prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(question)] })
    })
    await f.t.run(ctx => ctx.db.patch(f.catalogId, { measurementCapability: { enabled: false } }))
    expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, question))).toMatchObject({ status: 'rejected', reasonCode: 'lineage_unavailable' })
    await f.t.run(ctx => ctx.db.patch(question.id, { question: 'Both keys are now stale' }))
    expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, question))).toMatchObject({ status: 'admitted_unregistered' })
  })

  test('replaying an identical edit returns the existing registration until the reservation corpus rejects it', async () => {
    const f = await setup()
    await registerSource(f, true)
    const first = await publishQuiz(f, [{ question: 'Replayed task', answer: 'Replayed solution' }])
    const question = quizArtifact(first.references[0]!)
    const replay = () => f.asOwner.run(async ctx => {
      await ctx.db.patch(question.id, { question: 'Replayed task, edited' })
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(question)] })
    })
    const edited = await replay()
    const before = await inventory(f.t)
    const semantic = vi.spyOn(instructionalReservationSemanticAdapter, 'compare')
    expect(await replay()).toMatchObject({ lineageIds: edited.lineageIds, references: edited.references, catalogRevision: edited.catalogRevision })
    expect(await inventory(f.t)).toEqual(before)
    expect(semantic).not.toHaveBeenCalled()
    await f.t.run(ctx => reserve(ctx, 'An unrelated held-out task', 'An unrelated held-out solution'))
    await expect(replay()).rejects.toThrow('reservation check unknown')
    expect(semantic).toHaveBeenCalledOnce()
    await f.t.run(ctx => reserve(ctx, 'Another held-out task', 'Replayed solution'))
    await expect(replay()).rejects.toThrow('reservation check rejected')
    expect(semantic).toHaveBeenCalledOnce()
  })

  test('a moved registered document classifies while re-indexing and re-prepares idempotently', async () => {
    vi.useFakeTimers()
    const f = await setup()
    const registered = await registerSource(f, true)
    const document = { kind: 'document' as const, id: f.documentId }
    const destinationFolderId = await f.t.run(ctx => ctx.db.insert('folders', { userId, name: 'Destination', documentCount: 0 }))
    await f.asOwner.mutation(api.documents.moveDocument, { id: f.documentId, destinationFolderId })
    expect(await f.t.run(ctx => classifyPersonalWorkDocumentForRecord(ctx, document))).toMatchObject({ classification: 'genuine_personal_work' })
    expect(await f.asOwner.run(ctx => classifyPersonalWorkDocumentForOwner(ctx, userId, f.documentId))).toMatchObject({ classification: 'genuine_personal_work' })
    expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, document))).toMatchObject({ status: 'rejected', reasonCode: 'lineage_unavailable' })
    expect(await f.t.mutation(internal.documents.finalizeDocumentIndexing, { id: f.documentId, expectedFolderId: destinationFolderId, expectedR2Key: 'owned/notes.r1', status: 'success' })).toBe(true)
    const before = await inventory(f.t)
    const again = await f.t.run(ctx => prepareAndRegisterInstructionalArtifactsForRecord(ctx, document, { artifacts: [member(document), member({ kind: 'document_chunk', id: f.documentId }, LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY)] }))
    expect(again).toMatchObject({ lineageIds: registered.lineageIds, references: registered.references, catalogRevision: registered.catalogRevision })
    expect(await inventory(f.t)).toEqual(before)
    expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, document))).toMatchObject({ status: 'admitted_registered' })
  })

  test.each((['quiz_question', 'flashcard_version', 'audio_overview'] as const).flatMap(component => (['measurement', 'private_scoring', 'unknown', 'invalidated', 'teaching'] as const).map(condition => ({ component, condition }))))('section preparation over a $condition linked $component', async ({ component, condition }) => {
    const f = await setup()
    await registerSource(f, true)
    const section = await f.asOwner.run(async ctx => {
      const written = await writeLinkedSection(ctx, f, { questions: 1, cards: 1, audio: true })
      return { ...written, result: await prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: written.artifacts }) }
    })
    const target = section.result.references.findIndex(reference => reference.artifact.kind === component)
    if (condition !== 'teaching') await f.t.run(ctx => ctx.db.patch(section.result.lineageIds[target]!, condition === 'invalidated' ? { invalidatedAt: 0 } : { classification: condition }))
    const before = await inventory(f.t)
    const publish = f.asOwner.run(async ctx => {
      await ctx.db.patch(section.sectionId, { title: 'Edited over a linked component' })
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member({ kind: 'section_block', id: section.sectionId })] })
    })
    if (condition === 'teaching') expect(await publish).toMatchObject({ catalogRevision: section.result.catalogRevision + 1 })
    else {
      await expect(publish).rejects.toThrow('unavailable')
      expect(await inventory(f.t)).toEqual(before)
    }
  })
})

describe('B2 linked component and case memo boundaries', { timeout: 60_000 }, () => {
  test('an unversioned linked deck blocks section preparation', async () => {
    const f = await setup()
    await registerSource(f, true)
    const section = await f.asOwner.run(async ctx => {
      const written = await writeLinkedSection(ctx, f, { questions: 1, cards: 2 })
      await prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: written.artifacts })
      return written
    })
    const before = await inventory(f.t)
    await expect(f.asOwner.run(async ctx => {
      const room = (await ctx.db.query('flashcardRoomCards').withIndex('by_userId', q => q.eq('userId', userId)).take(1))[0]!.roomId
      await ctx.db.insert('flashcardRoomCards', { userId, roomId: room, displayOrder: 2, term: 'An unversioned term', definition: 'An unversioned definition' })
      await ctx.db.patch(room, { activeVersionId: undefined })
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member({ kind: 'section_block', id: section.sectionId })] })
    })).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })

  test('an unregistered linked question blocks section preparation', async () => {
    const f = await setup()
    await registerSource(f, true)
    const section = await f.asOwner.run(async ctx => {
      const written = await writeLinkedSection(ctx, f, { questions: 1, cards: 1 })
      await prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: written.artifacts })
      return written
    })
    const before = await inventory(f.t)
    await expect(f.asOwner.run(async ctx => {
      await ctx.db.insert('quizQuestions', { userId, quizId: section.quizId, order: 1, question: 'An unregistered task', type: 'free-response', correctAnswer: 'An unregistered solution' })
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member({ kind: 'section_block', id: section.sectionId })] })
    })).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })

  test('a case first seen through personal lineage is still reverse-checked for teaching', async () => {
    const f = await setup()
    await registerSource(f, true)
    const published = await publishQuiz(f, [{ question: 'Shared memo task', answer: 'Shared memo solution' }])
    const document = await f.t.run(async ctx => {
      const [taught] = await ctx.db.query('learnAssessmentCases').withIndex('by_userId', q => q.eq('userId', userId)).take(1)
      const row = (await ctx.db.query('learnArtifactLineages').withIndex('by_userId', q => q.eq('userId', userId)).take(1))[0]!
      await ctx.db.insert('learnArtifactCaseBindings', { ...base, lineageId: row._id, caseId: taught!._id, scenarioFingerprint: taught!.scenarioFingerprint,
        solutionFingerprint: taught!.solutionFingerprint, identityPolicyVersion: taught!.identityPolicyVersion })
      await ctx.db.patch(row._id, { caseCount: 1 })
      const sealed = (await ctx.db.get(row._id))!
      const cases = await ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', row._id)).take(2)
      const sources = await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', row._id)).take(2)
      const manifestDigest = await artifactManifestDigest(ctx, sealed, [], cases, sources)
      await ctx.db.patch(row._id, { manifestDigest })
      await ctx.db.patch(sealed.validationId!, { manifestDigest })
      await reserve(ctx, 'An unrelated held-out task', 'Shared memo solution')
      return { artifact: sealed.artifact, key: sealed.key, revision: sealed.revision, payloadDigest: sealed.payloadDigest }
    })
    expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference: document }))).toMatchObject({ status: 'bound', classification: 'genuine_personal_work' })
    expect(await f.asOwner.run(ctx => admitArtifactInputs(ctx, { references: [document, published.references[0]!] }))).toMatchObject({ status: 'rejected', reasonCode: 'lineage_unavailable' })
  })
})

describe('B2 section budget envelope', { timeout: 120_000 }, () => {
  test('a section whose linked content exceeds the module budget fails closed and rolls back', async () => {
    const f = await setup()
    const docs = await f.t.run(async ctx => {
      const ids = [f.documentId]
      for (let i = 1; i < 59; i++) ids.push(await ctx.db.insert('documents', { userId, folderId: f.folderId, filename: `source-${i}.txt`, fileSize: 12, status: 'success', sourceRevision: 'source.r1', contentHash: 'a'.repeat(64), r2Key: `owned/source-${i}.r1` }))
      return ids
    })
    for (let i = 0; i < docs.length; i += 25) {
      await f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: docs.slice(i, i + 25).flatMap(id => [member({ kind: 'document', id }), member({ kind: 'document_chunk', id }, LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY)]) }))
    }
    const section = await f.t.run(ctx => writeLinkedSection(ctx, f, { questions: 100, cards: 200, sources: docs }))
    const questions = section.artifacts.filter(entry => entry.artifact.kind === 'quiz_question')
    for (let i = 0; i < questions.length; i += 50) await f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: questions.slice(i, i + 50) }))
    await f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member({ kind: 'flashcard_version', id: section.versionId! })] }))
    const before = await inventory(f.t)
    await expect(f.asOwner.run(async raw => {
      const total = createArtifactLineagePublicationContext(raw)
      await raw.db.patch(section.sectionId, { title: 'Edited oversized section' })
      return prepareAndRegisterInstructionalArtifacts(total.preparation.ctx, { artifacts: [member({ kind: 'section_block', id: section.sectionId })] })
    })).rejects.toMatchObject({ data: { status: 'rejected', reasonCode: 'projection_exceeds_budget' } })
    expect(await inventory(f.t)).toEqual(before)
  })
})

describe('B2 fast-path dependency regressions', { timeout: 60_000 }, () => {
  test('a fresh indexing upload with no catalogue still classifies provisionally', async () => {
    const f = await setup()
    await f.t.run(async ctx => { await ctx.db.delete(f.catalogId); await ctx.db.patch(f.documentId, { status: 'indexing' }) })
    expect(await f.asOwner.run(ctx => classifyPersonalWorkDocumentForOwner(ctx, userId, f.documentId))).toMatchObject({ classification: 'genuine_personal_work' })
  })

  test.each(['quiz_question', 'flashcard_version', 'audio_overview'] as const)('identical section preparation rechecks its invalidated %s', async component => {
    const f = await setup()
    await registerSource(f, true)
    const section = await f.asOwner.run(async ctx => {
      const written = await writeLinkedSection(ctx, f, { questions: 1, cards: 1, audio: true })
      return { ...written, registered: await prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: written.artifacts }) }
    })
    const index = section.registered.references.findIndex(reference => reference.artifact.kind === component)
    await f.t.run(ctx => ctx.db.patch(section.registered.lineageIds[index]!, { invalidatedAt: 0 }))
    const before = await inventory(f.t)
    await expect(f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member({ kind: 'section_block', id: section.sectionId })] }))).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })

  test.each(['deleted', 'invalidated', 'protected'] as const)('identical preparation rechecks a %s source document', async condition => {
    const f = await setup()
    const source = await registerSource(f, true)
    const quiz = await publishQuiz(f)
    await f.t.run(async ctx => {
      if (condition === 'deleted') await ctx.db.delete(f.documentId)
      else await ctx.db.patch(source.lineageIds[1]!, condition === 'invalidated' ? { invalidatedAt: 0 } : { classification: 'measurement' })
    })
    const before = await inventory(f.t)
    await expect(f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(quizArtifact(quiz.references[0]!))] }))).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })

  test.each(['source', 'origin'] as const)('identical payload includes a newly supplied %s in its successor', async dependency => {
    const f = await setup()
    await registerSource(f, true)
    const origin = await publishQuiz(f, [{ question: 'Origin task', answer: 'Origin answer' }])
    const extra = await publishQuiz(f, [{ question: 'Additional origin', answer: 'Additional answer' }])
    const published = await f.asOwner.run(async ctx => {
      const quiz = await writeQuiz(ctx, f)
      quiz.artifacts[0]!.origins = [{ reference: origin.references[0]!, transformation: 'rewrite' }]
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: quiz.artifacts })
    })
    const candidate = member(quizArtifact(published.references[0]!))
    if (dependency === 'source') {
      const documentId = await registerDocument(f, 'added-source')
      candidate.sources = [{ kind: 'document', documentId, sourceRevision: 'source.r1' }]
    }
    else candidate.origins = [{ reference: extra.references[0]!, transformation: 'summary' }]
    const next = await f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [candidate] }))
    expect(next.references).toEqual(published.references)
    expect(next.lineageIds).not.toEqual(published.lineageIds)
    const state = await inventory(f.t)
    expect(state.lineages.find(row => row._id === published.lineageIds[0])!.nextId).toBe(next.lineageIds[0])
    expect(state.lineages.find(row => row._id === next.lineageIds[0])).toMatchObject(dependency === 'source' ? { sourceCount: 2 } : { originCount: 2 })
    const before = await inventory(f.t)
    expect(await f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [candidate] }))).toMatchObject({ lineageIds: next.lineageIds, catalogRevision: next.catalogRevision })
    expect(await inventory(f.t)).toEqual(before)
  })

  test.each(['source', 'origin'] as const)('identical preparation rejects a newly supplied invalidated %s', async dependency => {
    const f = await setup()
    await registerSource(f, true)
    const quiz = await publishQuiz(f)
    const candidate = member(quizArtifact(quiz.references[0]!))
    if (dependency === 'source') {
      const id = await registerDocument(f, 'invalidated-source')
      candidate.sources = [{ kind: 'document', documentId: id, sourceRevision: 'source.r1' }]
      await f.t.run(async ctx => {
        const row = (await ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', 'document').eq('artifact.id', id).eq('nextId', undefined)).take(1))[0]!
        await ctx.db.patch(row._id, { invalidatedAt: 0 })
      })
    }
    else {
      const origin = await publishQuiz(f, [{ question: 'Invalidated origin', answer: 'Origin answer' }])
      candidate.origins = [{ reference: origin.references[0]!, transformation: 'copy' }]
      await f.t.run(ctx => ctx.db.patch(origin.lineageIds[0]!, { invalidatedAt: 0 }))
    }
    const before = await inventory(f.t)
    await expect(f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [candidate] }))).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })

  test('an identical payload cannot ignore a changed origin transformation', async () => {
    const f = await setup()
    await registerSource(f)
    const origin = await publishQuiz(f, [{ question: 'Retained origin', answer: 'Retained answer' }])
    const registered = await f.asOwner.run(async ctx => {
      const quiz = await writeQuiz(ctx, f)
      quiz.artifacts[0]!.origins = [{ reference: origin.references[0]!, transformation: 'rewrite' }]
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: quiz.artifacts })
    })
    const candidate = member(quizArtifact(registered.references[0]!))
    candidate.origins = [{ reference: origin.references[0]!, transformation: 'summary' }]
    const before = await inventory(f.t)
    await expect(f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [candidate] }))).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })

  test('a changed payload cannot supersede an invalidated predecessor validation', async () => {
    const f = await setup()
    await registerSource(f)
    const registered = await publishQuiz(f)
    await f.t.run(async ctx => ctx.db.patch((await ctx.db.get(registered.lineageIds[0]!))!.validationId!, { invalidatedAt: 0 }))
    const before = await inventory(f.t)
    await expect(f.asOwner.run(async ctx => {
      const artifact = quizArtifact(registered.references[0]!)
      await ctx.db.patch(artifact.id, { question: 'Changed after invalidation' })
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(artifact)] })
    })).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })

  test.each((['quiz_question', 'flashcard_version', 'audio_overview'] as const).flatMap(component =>
    (['measurement', 'private_scoring', 'unknown', 'invalidated', 'validation_invalidated'] as const).map(condition => ({ component, condition }))))('batch preparation checks every key of its $condition $component', async ({ component, condition }) => {
    const f = await setup()
    await registerSource(f, true)
    const section = await f.asOwner.run(async ctx => {
      const written = await writeLinkedSection(ctx, f, { questions: 1, cards: 1, audio: true })
      const artifact = written.artifacts.find(candidate => candidate.artifact.kind === component)!.artifact
      const registered = await prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [...written.artifacts, member(artifact, 'other-key')] })
      return { ...written, registered }
    })
    const id = section.registered.lineageIds.at(-1)!
    await f.t.run(async ctx => {
      if (condition === 'validation_invalidated') await ctx.db.patch((await ctx.db.get(id))!.validationId!, { invalidatedAt: 0 })
      else await ctx.db.patch(id, condition === 'invalidated' ? { invalidatedAt: 0 } : { classification: condition })
    })
    const before = await inventory(f.t)
    for (const artifacts of [section.artifacts, [...section.artifacts].reverse()]) {
      await expect(f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts }))).rejects.toThrow('unavailable')
      expect(await inventory(f.t)).toEqual(before)
    }
  })

  test.each(['document', 'document_chunk'] as const)('re-indexing %s validates its complete retained source graph', async kind => {
    for (const condition of ['deleted', 'invalidated', 'protected'] as const) {
      const f = await setup()
      const other = await registerDocument(f, `retained-${condition}`)
      const candidate = member({ kind, id: f.documentId }, kind === 'document_chunk' ? LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY : 'whole')
      candidate.sources = [{ kind: 'document', documentId: other, sourceRevision: 'source.r1' }]
      const registered = await f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [candidate] }))
      expect(await f.asOwner.run(ctx => classifyPersonalWorkDocumentForOwner(ctx, userId, f.documentId))).toMatchObject({ classification: 'genuine_personal_work' })
      await f.t.run(async ctx => {
        await ctx.db.patch(f.documentId, { status: 'indexing' })
        if (condition === 'deleted') await ctx.db.delete(other)
        else {
          const row = (await ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', 'document_chunk').eq('artifact.id', other).eq('nextId', undefined)).take(1))[0]!
          await ctx.db.patch(row._id, condition === 'invalidated' ? { invalidatedAt: 0 } : { classification: 'private_scoring' })
        }
      })
      await expect(f.asOwner.run(ctx => classifyPersonalWorkDocumentForOwner(ctx, userId, f.documentId))).rejects.toThrow('unavailable')
      await expect(f.t.run(ctx => classifyPersonalWorkDocumentForRecord(ctx, { kind: 'document', id: f.documentId }))).rejects.toThrow('unavailable')
      expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference: registered.references[0]! }))).toMatchObject({ status: 'unavailable' })
    }
  })

  test.each(['deleted', 'invalidated', 'indexing'] as const)('re-indexing classification rejects a %s retained origin', async condition => {
    const f = await setup()
    const other = await registerDocument(f, 'personal-origin')
    const registered = await registerSource(f, true)
    await f.t.run(async ctx => {
      const origin = (await ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', 'document').eq('artifact.id', other).eq('nextId', undefined)).take(1))[0]!
      const id = registered.lineageIds[1]!
      await ctx.db.insert('learnArtifactLineageOrigins', { ...base, lineageId: id, originLineageId: origin._id, originRevision: origin.revision,
        originPayloadDigest: origin.payloadDigest, originManifestDigest: origin.manifestDigest, classification: origin.classification, transformation: 'import' })
      await ctx.db.patch(id, { derivation: 'derived', authority: 'server_producer', originCount: 1 })
      const row = (await ctx.db.get(id))!
      const origins = await ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', id)).take(9)
      const sources = await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', id)).take(65)
      const manifestDigest = await artifactManifestDigest(ctx, row, origins, [], sources)
      await ctx.db.patch(id, { manifestDigest })
      await ctx.db.patch(row.validationId!, { manifestDigest })
    })
    expect(await f.asOwner.run(ctx => classifyPersonalWorkDocumentForOwner(ctx, userId, f.documentId))).toMatchObject({ classification: 'genuine_personal_work' })
    await f.t.run(async ctx => {
      await ctx.db.patch(f.documentId, { status: 'indexing' })
      if (condition === 'deleted') await ctx.db.delete(other)
      else if (condition === 'indexing') await ctx.db.patch(other, { status: 'indexing' })
      else {
        const row = (await ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', 'document').eq('artifact.id', other).eq('nextId', undefined)).take(1))[0]!
        await ctx.db.patch(row._id, { invalidatedAt: 0 })
      }
    })
    await expect(f.asOwner.run(ctx => classifyPersonalWorkDocumentForOwner(ctx, userId, f.documentId))).rejects.toThrow('unavailable')
    await expect(f.t.run(ctx => classifyPersonalWorkDocumentForRecord(ctx, { kind: 'document', id: f.documentId }))).rejects.toThrow('unavailable')
  })

  test('re-indexing classification requires enrolled retained sources to be registered', async () => {
    const f = await setup()
    const other = await registerDocument(f, 'unregistered-retained-source')
    const candidate = member({ kind: 'document', id: f.documentId })
    candidate.sources = [{ kind: 'document', documentId: other, sourceRevision: 'source.r1' }]
    await f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [candidate] }))
    await f.t.run(async ctx => {
      const rows = await ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', 'document').eq('artifact.id', other).eq('nextId', undefined)).take(17)
      const chunks = await ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', 'document_chunk').eq('artifact.id', other).eq('nextId', undefined)).take(17)
      for (const row of [...rows, ...chunks]) await ctx.db.delete(row._id)
      await ctx.db.patch(f.documentId, { status: 'indexing' })
    })
    await expect(f.asOwner.run(ctx => classifyPersonalWorkDocumentForOwner(ctx, userId, f.documentId))).rejects.toThrow('unavailable')
    await expect(f.t.run(ctx => classifyPersonalWorkDocumentForRecord(ctx, { kind: 'document', id: f.documentId }))).rejects.toThrow('unavailable')
  })

  test.each(['deleted', 'invalidated'] as const)('a sibling key cannot hide its %s retained source', async condition => {
    const f = await setup()
    await registerSource(f, true)
    const other = await registerDocument(f, 'sibling-source')
    const section = await f.asOwner.run(async ctx => {
      const written = await writeLinkedSection(ctx, f, { questions: 1, cards: 0 })
      const alternate = member({ kind: 'quiz_question', id: written.questions[0]! }, 'other-key')
      alternate.sources = [{ kind: 'document', documentId: other, sourceRevision: 'source.r1' }]
      await prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [...written.artifacts, alternate] })
      return written
    })
    await f.t.run(async ctx => {
      if (condition === 'deleted') await ctx.db.delete(other)
      else {
        const row = (await ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', 'document').eq('artifact.id', other).eq('nextId', undefined)).take(1))[0]!
        await ctx.db.patch(row._id, { invalidatedAt: 0 })
      }
    })
    const before = await inventory(f.t)
    await expect(f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: section.artifacts }))).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })
})


async function siblingOriginFixture() {
  const f = await setup()
  await registerSource(f, true)
  const origin = await f.asOwner.run(async ctx => {
    const section = await writeLinkedSection(ctx, f, { questions: 1, cards: 0, text: (kind, index) => `Origin ${kind} ${index}` })
    return { ...section, registered: await prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: section.artifacts }) }
  })
  const outer = await f.asOwner.run(async ctx => {
    const section = await writeLinkedSection(ctx, f, { questions: 1, cards: 0 })
    const alternate = member({ kind: 'quiz_question', id: section.questions[0]! }, 'alternate')
    alternate.origins = [{ reference: origin.registered.references.at(-1)!, transformation: 'copy' }]
    return { ...section, registered: await prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [...section.artifacts, alternate] }) }
  })
  return { f, origin, outer }
}

describe('shared active-lineage dependency admission', { timeout: 60_000 }, () => {
  test.each(['invalidated', 'private_scoring'] as const)('newly declared origins reject a %s nested component through the shared rule', async condition => {
    const { f, origin } = await siblingOriginFixture()
    await f.t.run(ctx => ctx.db.patch(origin.registered.lineageIds[0]!, condition === 'invalidated' ? { invalidatedAt: 0 } : { classification: condition }))
    const before = await inventory(f.t)
    await expect(f.asOwner.run(async ctx => {
      const quiz = await writeQuiz(ctx, f, [{ question: 'Fresh derived output', answer: 'Fresh derived solution' }])
      quiz.artifacts[0]!.origins = [{ reference: origin.registered.references.at(-1)!, transformation: 'summary' }]
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: quiz.artifacts })
    })).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })

  test.each(['invalidated', 'deleted', 'stale'] as const)('a batch rejects an origin section with a %s linked question, matching preparation alone', async condition => {
    const { f, origin, outer } = await siblingOriginFixture()
    await f.t.run(async ctx => {
      if (condition === 'invalidated') await ctx.db.patch(origin.registered.lineageIds[0]!, { invalidatedAt: 0 })
      if (condition === 'deleted') await ctx.db.delete(origin.questions[0]!)
      if (condition === 'stale') await ctx.db.patch(origin.questions[0]!, { question: 'Changed origin component' })
    })
    expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, outer.artifacts[0]!.artifact))).toMatchObject({ status: 'rejected' })
    const before = await inventory(f.t)
    const reason = condition === 'invalidated' ? 'Artifact lineage unavailable' : 'Artifact registration required'
    await expect(f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [outer.artifacts.at(-1)!] }))).rejects.toThrow(reason)
    for (const artifacts of [outer.artifacts, [...outer.artifacts].reverse()]) {
      await expect(f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts }))).rejects.toThrow(reason)
      expect(await inventory(f.t)).toEqual(before)
    }
  })

  test.each([false, true])('a stale nested component stays inadmissible when also prepared in the batch (first: %s)', async first => {
    const { f, origin, outer } = await siblingOriginFixture()
    await f.t.run(ctx => ctx.db.patch(origin.questions[0]!, { question: 'Pending origin component edit' }))
    const before = await inventory(f.t)
    const nested = origin.artifacts[0]!
    const artifacts = first ? [nested, ...outer.artifacts] : [...outer.artifacts, nested]
    await expect(f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts }))).rejects.toThrow('Artifact registration required')
    expect(await inventory(f.t)).toEqual(before)
  })

  test.each([false, true])('healthy sibling origins prepare and replay without writes (nested in batch: %s)', async includeNested => {
    const { f, origin, outer } = await siblingOriginFixture()
    const artifacts = [...outer.artifacts, ...(includeNested ? [origin.artifacts[0]!] : [])]
    const expectedIds = [...outer.registered.lineageIds.slice(0, 2), ...(includeNested ? [origin.registered.lineageIds[0]!] : [])]
    const before = await inventory(f.t)
    for (const members of [artifacts, artifacts, [...artifacts].reverse()]) {
      const prepared = await f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: members }))
      expect(prepared.lineageIds).toEqual(members === artifacts ? expectedIds : [...expectedIds].reverse())
      expect(prepared.catalogRevision).toBe(outer.registered.catalogRevision)
      expect(await inventory(f.t)).toEqual(before)
    }
  })

  test('exhausting the cumulative budget during nested preparation rejects and rolls back the producer', async () => {
    const { f, outer } = await siblingOriginFixture()
    const before = await inventory(f.t)
    let ranges = 0
    await expect(f.asOwner.run(async raw => {
      const total = createArtifactLineagePublicationContext(raw)
      for (let i = 0; i < 1800; i++) await total.admission.ctx.db.get(f.folderId)
      for (let i = 0; i < 1265; i++) await total.preparation.ctx.db.get(f.folderId)
      await raw.db.patch(outer.quizId, { title: 'Must roll back' })
      try { return await prepareAndRegisterInstructionalArtifacts(total.preparation.ctx, { artifacts: outer.artifacts }) }
      finally { ranges = total.indexRanges }
    })).rejects.toMatchObject({ data: { status: 'rejected', reasonCode: 'projection_exceeds_budget' } })
    expect(ranges).toBe(3072)
    expect(await inventory(f.t)).toEqual(before)
  })

  test('repeated sibling origins share one bounded admission graph', async () => {
    const { f, origin, outer } = await siblingOriginFixture()
    await f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: Array.from({ length: 14 }, (_, index) => ({
      ...member(outer.artifacts[0]!.artifact, `alias-${index}`), origins: [{ reference: origin.registered.references.at(-1)!, transformation: 'copy' as const }],
    })) }))
    const before = await inventory(f.t)
    let normalizations = 0
    await f.asOwner.run(async raw => {
      const db = new Proxy(raw.db, { get(target, property) {
        const method: unknown = Reflect.get(target, property)
        if (property === 'normalizeId' && typeof method === 'function') return (...args: unknown[]) => { normalizations++; return Reflect.apply(method, target, args) }
        return typeof method === 'function' ? method.bind(target) : method
      } })
      await prepareAndRegisterInstructionalArtifacts({ ...raw, db }, { artifacts: [outer.artifacts[0]!] })
    })
    expect(normalizations).toBeLessThanOrEqual(48)
    expect(await inventory(f.t)).toEqual(before)
  })

  test.each(['document', 'document_chunk'] as const)('re-index classification rejects a reserved case on an unpublished personal %s binding', async kind => {
    const f = await setup()
    const registered = await f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member({ kind, id: f.documentId }, kind === 'document_chunk' ? LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY : 'whole')] }))
    const caseId = await f.t.run(async ctx => {
      const pin = await normalizedInstructionalCaseFingerprints('Personal retained scenario', 'Personal retained solution')
      const caseId = await ctx.db.insert('learnAssessmentCases', { ...base, ...pin, identityPolicyVersion: LEARN_ARTIFACT_CASE_IDENTITY_VERSION, caseKey: 'personal.retained', usageClass: 'unknown' })
      const id = registered.lineageIds[0]!
      await ctx.db.insert('learnArtifactCaseBindings', { ...base, lineageId: id, caseId, ...pin, identityPolicyVersion: LEARN_ARTIFACT_CASE_IDENTITY_VERSION })
      await ctx.db.patch(id, { publication: undefined, caseCount: 1 })
      const row = (await ctx.db.get(id))!
      const bindings = await ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', id)).take(33)
      const sources = await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', id)).take(65)
      const manifestDigest = await artifactManifestDigest(ctx, row, [], bindings, sources)
      await ctx.db.patch(id, { manifestDigest })
      await ctx.db.patch(row.validationId!, { manifestDigest })
      await ctx.db.patch(f.documentId, { status: 'indexing' })
      return caseId
    })
    expect(await f.asOwner.run(ctx => classifyPersonalWorkDocumentForOwner(ctx, userId, f.documentId))).toMatchObject({ classification: 'genuine_personal_work' })
    await f.t.run(ctx => ctx.db.patch(caseId, { reservedAt: 0 }))
    await expect(f.asOwner.run(ctx => classifyPersonalWorkDocumentForOwner(ctx, userId, f.documentId))).rejects.toThrow('unavailable')
    await expect(f.t.run(ctx => classifyPersonalWorkDocumentForRecord(ctx, { kind: 'document', id: f.documentId }))).rejects.toThrow('unavailable')
  })
})


async function siblingRecoveryFixture() {
  const f = await setup()
  await registerSource(f, true)
  const origin = await publishQuiz(f, [{ question: 'Recovery origin', answer: 'Recovery solution' }])
  const copy = await f.asOwner.run(async ctx => {
    const written = await writeQuiz(ctx, f, [{ question: 'Derived recovery task', answer: 'Derived recovery solution' }])
    const artifacts = ['whole', 'alternate'].map(key => ({ ...member(written.artifacts[0]!.artifact, key),
      origins: [{ reference: origin.references[0]!, transformation: 'copy' as const }],
    }))
    return { artifacts, registered: await prepareAndRegisterInstructionalArtifacts(ctx, { artifacts }) }
  })
  const successor = await f.asOwner.run(async ctx => {
    await ctx.db.patch(quizArtifact(origin.references[0]!).id, { question: 'Recovery origin, revised' })
    return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [member(quizArtifact(origin.references[0]!))] })
  })
  return { f, origin, copy, successor }
}

const recoveryPaths = ['explicit', 'whole', 'alternate', 'batch'] as const
function recoverSiblingKeys(f: Fixture, artifacts: LearnArtifactPreparationArgs['artifacts'], path: typeof recoveryPaths[number]) {
  return f.asOwner.run(ctx => path === 'explicit'
    ? repinArtifactLineageDescendants(ctx, { artifacts: [artifacts[0]!.artifact] })
    : prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: artifacts.filter(candidate => path === 'batch' || candidate.key === path).map(candidate => member(candidate.artifact, candidate.key)) }))
}

async function sectionSiblingFixture(retainComponent = false) {
  const f = await setup()
  await registerSource(f, true)
  const section = await f.asOwner.run(async ctx => {
    const written = await writeLinkedSection(ctx, f, { questions: 1, cards: 1, audio: true })
    const components = written.artifacts.slice(0, -1)
    const keys = Array.from({ length: 4 }, (_, index) => member({ kind: 'section_block', id: written.sectionId }, `block-${index}`))
    const origin = retainComponent ? await prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: components }) : undefined
    const initialKeys = keys.map((candidate, index) => origin && index === 3 ? { ...candidate, origins: [{ reference: origin.references[0]!, transformation: 'copy' as const }] } : candidate)
    return { ...written, components, keys, registered: await prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [...components, ...initialKeys] }) }
  })
  return { f, section }
}

async function editSectionComponent(ctx: RunCtx, artifact: LearnArtifactPreparationArgs['artifacts'][number]['artifact']) {
  if (artifact.kind === 'quiz_question') await ctx.db.patch(artifact.id, { question: 'Edited sibling question' })
  else if (artifact.kind === 'flashcard_version') {
    const card = (await ctx.db.query('flashcardVersionCards').withIndex('by_versionId', q => q.eq('versionId', artifact.id)).take(1))[0]!
    const live = (await ctx.db.query('flashcardRoomCards').withIndex('by_roomId', q => q.eq('roomId', card.roomId)).take(1))[0]!
    await ctx.db.patch(card._id, { definition: 'Repaired sibling definition' })
    await ctx.db.patch(live._id, { definition: 'Repaired sibling definition' })
  }
  else if (artifact.kind === 'audio_overview') {
    const overview = (await ctx.db.get(artifact.id))!
    await ctx.db.patch(artifact.id, { turns: overview.turns.map(turn => ({ ...turn, text: 'Edited sibling Audio Overview' })) })
  }
  else throw new Error('Expected a linked section component')
}

describe('sibling inspection recovery and batch boundaries', { timeout: 60_000 }, () => {
  test.each(recoveryPaths)('two derived keys recover through %s without rewriting inspected edges', async path => {
    const { f, origin, copy, successor } = await siblingRecoveryFixture()
    const before = await inventory(f.t)
    expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, copy.artifacts[0]!.artifact))).toMatchObject({ status: 'rejected', reasonCode: 'lineage_unavailable' })
    const recovered = await recoverSiblingKeys(f, copy.artifacts, path)
    expect(recovered.lineageIds).toHaveLength(path === 'batch' || path === 'explicit' ? 2 : 1)
    const after = await inventory(f.t)
    expect(after.origins.filter(edge => copy.registered.lineageIds.includes(edge.lineageId))).toEqual(before.origins.filter(edge => copy.registered.lineageIds.includes(edge.lineageId)))
    expect(after.origins.filter(edge => copy.registered.lineageIds.includes(edge.lineageId)).every(edge => edge.originLineageId === origin.lineageIds[0])).toBe(true)
    expect(after.origins.filter(edge => recovered.lineageIds.includes(edge.lineageId)).every(edge => edge.originLineageId === successor.lineageIds[0])).toBe(true)
    if (path === 'whole' || path === 'alternate') {
      const untouched = copy.registered.lineageIds[path === 'whole' ? 1 : 0]!
      expect(after.lineages.find(row => row._id === untouched)).toEqual(before.lineages.find(row => row._id === untouched))
      expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, copy.artifacts[0]!.artifact))).toMatchObject({ status: 'rejected' })
      await recoverSiblingKeys(f, copy.artifacts, path === 'whole' ? 'alternate' : 'whole')
    }
    expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, copy.artifacts[0]!.artifact))).toMatchObject({ status: 'admitted_registered' })
    const repaired = await inventory(f.t)
    const replay = await recoverSiblingKeys(f, [...copy.artifacts].reverse(), 'batch')
    expect(replay.lineageIds).toEqual(repaired.lineages.filter(row => row.artifact.id === copy.artifacts[0]!.artifact.id && row.nextId === undefined).sort((a, b) => a.key.localeCompare(b.key)).map(row => row._id))
    expect(await inventory(f.t)).toEqual(repaired)
  })

  test.each(recoveryPaths.flatMap(path => (['invalidated', 'deleted', 'stale', 'private_scoring'] as const).map(condition => ({ path, condition }))))('$path recovery rejects an unhealthy $condition successor', async ({ path, condition }) => {
    const { f, copy, successor } = await siblingRecoveryFixture()
    await f.t.run(async ctx => {
      if (condition === 'invalidated') await ctx.db.patch(successor.lineageIds[0]!, { invalidatedAt: 0 })
      else if (condition === 'private_scoring') await ctx.db.patch(successor.lineageIds[0]!, { classification: condition })
      else if (condition === 'deleted') await ctx.db.delete(quizArtifact(successor.references[0]!).id)
      else await ctx.db.patch(quizArtifact(successor.references[0]!).id, { question: 'Unregistered successor edit' })
    })
    const before = await inventory(f.t)
    await expect(recoverSiblingKeys(f, copy.artifacts, path)).rejects.toThrow()
    expect(await inventory(f.t)).toEqual(before)
  })

  test.each((['quiz_question', 'flashcard_version', 'audio_overview'] as const).flatMap(kind => [false, true].map(first => ({ kind, first }))))('$kind edits register with all four section keys (component first: $first)', async ({ kind, first }) => {
    const { f, section } = await sectionSiblingFixture()
    const component = section.components.find(candidate => candidate.artifact.kind === kind)!
    const before = await inventory(f.t)
    const prepared = await f.asOwner.run(async ctx => {
      await editSectionComponent(ctx, component.artifact)
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: first ? [component, ...section.keys] : [...section.keys, component] })
    })
    expect(prepared.lineageIds).toHaveLength(5)
    const after = await inventory(f.t)
    expect(after.catalogs[0]!.catalogRevision).toBe(before.catalogs[0]!.catalogRevision + 1)
    for (const reference of prepared.references) expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference }))).toMatchObject({ status: 'bound', instructionalRegistered: true })
    expect(await f.asOwner.run(ctx => admitArtifactInputByIdentity(ctx, section.keys[0]!.artifact))).toMatchObject({ status: 'admitted_registered' })
    const replay = await f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [...section.keys, component] }))
    expect(new Set(replay.lineageIds)).toEqual(new Set(prepared.lineageIds))
    expect(await inventory(f.t)).toEqual(after)
  })

  test.each(['quiz_question', 'flashcard_version', 'audio_overview'] as const)('an edited %s left outside the batch still rejects and rolls back', async kind => {
    const { f, section } = await sectionSiblingFixture()
    const component = section.components.find(candidate => candidate.artifact.kind === kind)!
    const before = await inventory(f.t)
    const stored = await f.t.run(ctx => ctx.db.get(component.artifact.id))
    await expect(f.asOwner.run(async ctx => {
      await editSectionComponent(ctx, component.artifact)
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: section.keys })
    })).rejects.toThrow('Artifact registration required')
    expect(await f.t.run(ctx => ctx.db.get(component.artifact.id))).toEqual(stored)
    expect(await inventory(f.t)).toEqual(before)
  })

  test.each([false, true])('retained origins are never exempt even when also direct batch components (first: %s)', async first => {
    const { f, section } = await sectionSiblingFixture(true)
    const component = section.components[0]!
    const before = await inventory(f.t)
    await expect(f.asOwner.run(async ctx => {
      await editSectionComponent(ctx, component.artifact)
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: first ? [component, section.keys[0]!] : [section.keys[0]!, component] })
    })).rejects.toThrow('Artifact registration required')
    expect(await inventory(f.t)).toEqual(before)
  })

  test.each(['invalidated', 'measurement', 'private_scoring', 'unknown'] as const)('a direct sibling binding that is %s never gets the component exemption', async condition => {
    const { f, section } = await sectionSiblingFixture()
    const siblingId = section.registered.lineageIds[4]!
    await f.t.run(ctx => ctx.db.patch(siblingId, condition === 'invalidated' ? { invalidatedAt: 0 } : { classification: condition }))
    const before = await inventory(f.t)
    await expect(f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [...section.components, ...section.keys] }))).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })

  test.each([false, true])('declared origins keep exact pins and no batch exemption (component first: %s)', async first => {
    const { f, origin } = await siblingOriginFixture()
    const before = await inventory(f.t)
    await expect(f.asOwner.run(async ctx => {
      await ctx.db.patch(origin.questions[0]!, { question: 'Unregistered declared-origin component' })
      const written = await writeQuiz(ctx, f, [{ question: 'New derived task', answer: 'New derived solution' }])
      written.artifacts[0]!.origins = [{ reference: origin.registered.references.at(-1)!, transformation: 'copy' }]
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: first ? [origin.artifacts[0]!, ...written.artifacts] : [...written.artifacts, origin.artifacts[0]!] })
    })).rejects.toThrow()
    expect(await inventory(f.t)).toEqual(before)
  })

  test('re-index inspection keeps exact retained-origin pins instead of following a successor', async () => {
    const f = await setup()
    const other = await registerDocument(f, 'reindex-origin')
    const source = await registerDocument(f, 'reindex-origin-source')
    const registered = await registerSource(f, true)
    await f.t.run(async ctx => {
      const origin = (await ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', 'document').eq('artifact.id', other).eq('nextId', undefined)).take(1))[0]!
      const id = registered.lineageIds[1]!
      await ctx.db.insert('learnArtifactLineageOrigins', { ...base, lineageId: id, originLineageId: origin._id, originRevision: origin.revision,
        originPayloadDigest: origin.payloadDigest, originManifestDigest: origin.manifestDigest, classification: origin.classification, transformation: 'import' })
      await ctx.db.patch(id, { derivation: 'derived', authority: 'server_producer', originCount: 1 })
      const row = (await ctx.db.get(id))!
      const origins = await ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', id)).take(9)
      const sources = await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', id)).take(65)
      const manifestDigest = await artifactManifestDigest(ctx, row, origins, [], sources)
      await ctx.db.patch(id, { manifestDigest })
      await ctx.db.patch(row.validationId!, { manifestDigest })
      await ctx.db.patch(f.documentId, { status: 'indexing' })
    })
    expect(await f.asOwner.run(ctx => classifyPersonalWorkDocumentForOwner(ctx, userId, f.documentId))).toMatchObject({ classification: 'genuine_personal_work' })
    await f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [{ ...member({ kind: 'document', id: other }), sources: [{ kind: 'document', documentId: source, sourceRevision: 'source.r1' }] }] }))
    const before = await inventory(f.t)
    await expect(f.asOwner.run(ctx => classifyPersonalWorkDocumentForOwner(ctx, userId, f.documentId))).rejects.toThrow('unavailable')
    await expect(f.t.run(ctx => classifyPersonalWorkDocumentForRecord(ctx, { kind: 'document', id: f.documentId }))).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })

  test('a new linked question outside the batch still requires registration', async () => {
    const { f, section } = await sectionSiblingFixture()
    const before = await inventory(f.t)
    await expect(f.asOwner.run(async ctx => {
      await ctx.db.insert('quizQuestions', { userId, quizId: section.quizId, order: 1, question: 'New unregistered component', correctAnswer: 'New solution', type: 'free-response', sourceDocumentId: f.documentId })
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: section.keys })
    })).rejects.toThrow('unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })
})


describe('retained-document partition', () => {
  test.each([false, true])('a same-batch document cannot repair a retained sibling source (document first: %s)', async documentFirst => {
    const f = await setup()
    await registerSource(f, true)
    const retainedDocumentId = await registerDocument(f, 'retained-only')
    const quiz = await f.asOwner.run(async ctx => {
      const written = await writeQuiz(ctx, f)
      const root = written.artifacts[0]!
      await prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [root, {
        ...root, key: 'sibling', sources: [{ kind: 'document', documentId: retainedDocumentId, sourceRevision: 'source.r1' }],
      }] })
      return written
    })
    await f.t.run(async ctx => {
      for (const kind of ['document', 'document_chunk'] as const) {
        const rows = await ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', kind).eq('artifact.id', retainedDocumentId).eq('nextId', undefined)).take(16)
        for (const row of rows) await ctx.db.patch(row._id, { publication: undefined })
      }
    })
    const root = quiz.artifacts[0]!
    const repair = member({ kind: 'document', id: retainedDocumentId }, 'repair-key')
    const before = await inventory(f.t)
    await expect(f.asOwner.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, {
      artifacts: documentFirst ? [repair, root] : [root, repair],
    }))).rejects.toThrow('Artifact lineage unavailable')
    expect(await inventory(f.t)).toEqual(before)
  })
})
