/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import schema from './schema'
import {
  admitArtifactInput, admitArtifactInputForOwner, admitArtifactInputForRecord,
  artifactContentProjection, artifactManifestDigest, artifactPayloadDigest, classifyPersonalWorkDocumentForOwner, classifyPersonalWorkDocumentForRecord,
  createArtifactLineageReadContext, instructionalReservationSemanticAdapter, isArtifactRegistrationRequired,
  prepareAndRegisterInstructionalArtifacts, prepareAndRegisterInstructionalArtifactsForRecord, resolveArtifactLineageForOwner, sessionBlockContentProjection,
} from './lib/learnV2ArtifactLineage'
import { LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY, LEARN_ARTIFACT_INPUT_ADMISSION_VERSION, LEARN_ARTIFACT_LINEAGE_LIMITS, LEARN_ARTIFACT_LINEAGE_VERSION,
  learnArtifactInputAdmissionResultSchema, type LearnArtifactReference } from '../shared/learn-v2-artifact-lineage'
import { seedMeasurementStorage } from '../tests/fixtures/learn-v2-measurement-storage'

const modules = import.meta.glob('./**/*.ts')
const owner = { tokenIdentifier: 'https://auth.example.com|input-admission', subject: 'same-subject' }
const foreign = { tokenIdentifier: 'https://other.example.com|input-admission', subject: 'same-subject' }
const userId = owner.tokenIdentifier
const base = { userId, storageVersion: 'learn-v2.measurement-storage.v1' as const, createdAt: 1_800_000_000_000 }
const kinds = ['document', 'document_chunk'] as const
type Kind = typeof kinds[number]
type Fixture = Awaited<ReturnType<typeof setup>>
type Store = TestConvex<typeof schema>
afterEach(() => { vi.restoreAllMocks() })

async function setup(enrolled: boolean | null = true) {
  const t = convexTest(schema, modules)
  const records = await t.run(async ctx => {
    const folderId = await ctx.db.insert('folders', { userId, name: 'Owned input', documentCount: 1 })
    const documentId = await ctx.db.insert('documents', { userId, folderId, filename: 'input.txt', fileSize: 10, status: 'success',
      sourceRevision: 'source.r1', contentHash: 'a'.repeat(64), r2Key: 'owned/input.r1' })
    const catalogId = enrolled === null ? null : await ctx.db.insert('learnAssessmentCatalogs', { ...base, catalogRevision: 1,
      instrumentationEpoch: 'epoch.v1', historyCompleteness: 'prospective_complete', historyBasisVersion: 'history.v1', historyCoverageWatermark: 'coverage.v1', measurementCapability: { enabled: enrolled } })
    return { folderId, documentId, catalogId }
  })
  return { ...records, t, asOwner: t.withIdentity(owner) }
}

async function reference(ctx: MutationCtx, documentId: Id<'documents'>, kind: Kind): Promise<LearnArtifactReference> {
  const document = await ctx.db.get(documentId)
  if (!document?.sourceRevision) throw new Error('Missing fixture document')
  return { artifact: { kind, id: documentId }, key: kind === 'document' ? 'whole' : LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY,
    revision: document.sourceRevision, payloadDigest: await artifactPayloadDigest(artifactContentProjection({ kind, document })) }
}

async function bind(ctx: MutationCtx, documentId: Id<'documents'>, kind: Kind, classification: Doc<'learnArtifactLineages'>['classification'] = 'genuine_personal_work', registered = false, key?: string, reserved = false) {
  const ref = { ...await reference(ctx, documentId, kind), ...(key ? { key } : {}) }
  const lineageId = await ctx.db.insert('learnArtifactLineages', { ...base, ...ref, lineageVersion: LEARN_ARTIFACT_LINEAGE_VERSION, manifestDigest: '0'.repeat(64),
    classification, authority: classification === 'genuine_personal_work' ? 'personal_authorship' : 'server_producer', authorityVersion: 'fixture.v1',
    evidenceStatus: 'available', derivation: 'original', originCount: 0, caseCount: reserved ? 1 : 0, sourceCount: 0 })
  const cases: Doc<'learnArtifactCaseBindings'>[] = []
  if (reserved) {
    const pin = { scenarioFingerprint: 'e'.repeat(64), solutionFingerprint: 'f'.repeat(64), identityPolicyVersion: 'identity.v1' }
    const caseId = await ctx.db.insert('learnAssessmentCases', { ...base, ...pin, caseKey: 'retained-reservation', usageClass: 'unknown', reservedAt: 0 })
    const bindingId = await ctx.db.insert('learnArtifactCaseBindings', { ...base, ...pin, lineageId, caseId })
    cases.push((await ctx.db.get(bindingId))!)
  }
  const row = (await ctx.db.get(lineageId))!
  const manifestDigest = await artifactManifestDigest(ctx, row, [], cases, [])
  const validationId = await ctx.db.insert('learnArtifactValidations', { ...base, lineageId, payloadDigest: ref.payloadDigest, manifestDigest,
    evidenceStatus: 'available', decision: 'pass', comparedCatalogRevision: 0, coverage: 'complete', coverageWatermark: 'coverage.v1',
    corpusDigest: 'b'.repeat(64), identityPolicyVersion: 'identity.v1', noveltyPolicyVersion: 'novelty.v1', validatorVersion: 'fixture.v1', validatorModel: null, harnessArtifactDigest: 'c'.repeat(64) })
  await ctx.db.patch(lineageId, { manifestDigest, validationId, ...(registered ? { publication: { validationId, catalogRevision: 1, publishedAt: base.createdAt } } : {}) })
  return { reference: ref, lineageId, validationId }
}

async function state(t: Store) {
  return t.run(async ctx => ({
    documents: await ctx.db.query('documents').withIndex('by_userId', q => q.eq('userId', userId)).take(2),
    catalog: await ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', userId)).take(2),
    lineages: await ctx.db.query('learnArtifactLineages').withIndex('by_userId', q => q.eq('userId', userId)).take(20),
    validations: await ctx.db.query('learnArtifactValidations').withIndex('by_userId', q => q.eq('userId', userId)).take(20),
    cases: await ctx.db.query('learnAssessmentCases').withIndex('by_userId', q => q.eq('userId', userId)).take(1),
  }))
}

async function personalClassificationRejected(f: Fixture) {
  await expect(f.asOwner.run(ctx => classifyPersonalWorkDocumentForOwner(ctx, userId, f.documentId))).rejects.toThrow('unavailable')
  await expect(f.t.run(ctx => classifyPersonalWorkDocumentForRecord(ctx, { kind: 'document', id: f.documentId }))).rejects.toThrow('unavailable')
}

describe('personal-work admission preserves every known document representation', () => {
  test.each(kinds.flatMap(kind => (['measurement', 'private_scoring', 'unknown'] as const).map(classification => ({ kind, classification }))))('rejects $classification on $kind in both classifiers and preparation variants', async ({ kind, classification }) => {
    const f = await setup()
    const existing = await f.t.run(ctx => bind(ctx, f.documentId, kind, classification))
    expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference: existing.reference }))).toMatchObject({ status: classification === 'unknown' ? 'unavailable' : 'bound' })
    const before = await state(f.t)
    await personalClassificationRejected(f)
    const target = kind === 'document' ? 'document_chunk' : 'document'
    const artifacts = [{ artifact: { kind: target, id: f.documentId }, key: target === 'document' ? 'whole' : LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY, origins: [], sources: [] }]
    await expect(f.asOwner.run(async ctx => {
      await ctx.db.patch(f.documentId, { filename: 'rolled-back.txt' })
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts })
    })).rejects.toThrow('unavailable')
    await expect(f.t.run(ctx => prepareAndRegisterInstructionalArtifactsForRecord(ctx, { kind: 'document', id: f.documentId }, { artifacts }))).rejects.toThrow('unavailable')
    expect(await state(f.t)).toEqual(before)
  })

  test.each(kinds)('indexing revokes %s personal admission exactly when ordinary resolution becomes unavailable', async kind => {
    const f = await setup()
    const existing = await f.t.run(ctx => bind(ctx, f.documentId, kind, 'genuine_personal_work', true))
    expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference: existing.reference }))).toMatchObject({ status: 'bound' })
    expect(await f.asOwner.run(ctx => classifyPersonalWorkDocumentForOwner(ctx, userId, f.documentId))).toMatchObject({ classification: 'genuine_personal_work' })
    await f.t.run(ctx => ctx.db.patch(f.documentId, { status: 'indexing' }))
    expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference: existing.reference }))).toMatchObject({ status: 'unavailable' })
    await personalClassificationRejected(f)
    expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: existing.reference }))).toMatchObject({ status: 'rejected', reasonCode: 'lineage_unavailable' })
  })

  test.each(kinds)('cannot shed an older protected %s binding by changing the document revision', async kind => {
    const f = await setup()
    await f.t.run(async ctx => { await bind(ctx, f.documentId, kind, 'measurement'); await ctx.db.patch(f.documentId, { sourceRevision: 'source.r2', contentHash: 'd'.repeat(64) }) })
    await personalClassificationRejected(f)
    const before = await state(f.t)
    await expect(f.t.run(ctx => prepareAndRegisterInstructionalArtifactsForRecord(ctx, { kind: 'document', id: f.documentId }, { artifacts: [{
      artifact: { kind: 'document', id: f.documentId }, key: 'new-copy', origins: [], sources: [],
    }] }))).rejects.toThrow('unavailable')
    expect(await state(f.t)).toEqual(before)
  })

  test.each(kinds)('personal %s lineage cannot hide a retained reserved identity', async kind => {
    const f = await setup()
    const existing = await f.t.run(ctx => bind(ctx, f.documentId, kind, 'genuine_personal_work', false, undefined, true))
    expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference: existing.reference }))).toMatchObject({ status: 'bound', cases: [{ usageClass: 'measurement_reserved' }] })
    await personalClassificationRejected(f)
    expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: existing.reference }))).toMatchObject({ status: 'rejected', reasonCode: 'restricted_lineage' })
    const before = await state(f.t)
    const target = kind === 'document' ? 'document_chunk' : 'document'
    await expect(f.t.run(ctx => prepareAndRegisterInstructionalArtifactsForRecord(ctx, { kind: 'document', id: f.documentId }, { artifacts: [{
      artifact: { kind: target, id: f.documentId }, key: target === 'document' ? 'whole' : LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY, origins: [], sources: [],
    }] }))).rejects.toThrow('unavailable')
    expect(await state(f.t)).toEqual(before)
  })

  test('a genuine upload still performs no semantic comparison or reservation scan', async () => {
    const f = await setup()
    const semantic = vi.spyOn(instructionalReservationSemanticAdapter, 'compare')
    const queries: string[] = []
    const result = await f.asOwner.run(async ctx => {
      const db = new Proxy(ctx.db, { get(target, property) {
        if (property === 'query') return (table: string) => { queries.push(table); return Reflect.apply(target.query, target, [table]) }
        const value = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      } })
      const budget = createArtifactLineageReadContext({ ...ctx, db })
      await classifyPersonalWorkDocumentForOwner(budget.ctx, userId, f.documentId)
      return prepareAndRegisterInstructionalArtifacts(budget.ctx, { artifacts: [{ artifact: { kind: 'document', id: f.documentId }, key: 'whole', origins: [], sources: [] }] })
    })
    expect(result.lineageIds).toHaveLength(1)
    expect(queries).not.toContain('learnAssessmentCases')
    expect(semantic).not.toHaveBeenCalled()
    semantic.mockRestore()
  })
})

describe('enrollment-aware instructional input admission', () => {
  test.each([null, false, true].flatMap(enrolled => kinds.map(kind => ({ enrolled, kind }))))('ordinary $kind with enrollment $enrolled has an explicit nonthrowing result', async ({ enrolled, kind }) => {
    const f = await setup(enrolled)
    const ref = await f.t.run(ctx => reference(ctx, f.documentId, kind))
    const before = await state(f.t)
    expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference: ref }))).toMatchObject({ status: 'unavailable' })
    const expected = { version: LEARN_ARTIFACT_INPUT_ADMISSION_VERSION, status: enrolled === true ? 'rejected' : 'admitted_unregistered', reasonCode: enrolled === true ? 'registration_required' : 'unregistered_ordinary_input' }
    expect(await f.asOwner.run(async ctx => {
      const budget = createArtifactLineageReadContext(ctx)
      expect(await isArtifactRegistrationRequired(budget.ctx)).toBe(enrolled === true)
      const result = await admitArtifactInput(budget.ctx, { reference: ref })
      expect(budget.readUsage.documentsRead).toBeGreaterThan(0)
      return result
    })).toEqual(expected)
    expect(await f.asOwner.run(ctx => admitArtifactInputForOwner(ctx, userId, { reference: ref }))).toEqual(expected)
    expect(await f.t.run(ctx => admitArtifactInputForRecord(ctx, { kind: 'document', id: f.documentId }, { reference: ref }))).toEqual(expected)
    expect(await state(f.t)).toEqual(before)
    expect(learnArtifactInputAdmissionResultSchema.parse(expected)).toEqual(expected)
    expect(learnArtifactInputAdmissionResultSchema.safeParse({ ...expected, v2Evidence: true }).success).toBe(false)
  })

  test.each([null, false, true].flatMap(enrolled => kinds.flatMap(storedKind => kinds.flatMap(inputKind => (['measurement', 'private_scoring', 'unknown', 'unavailable', 'invalidated'] as const).map(condition => ({ enrolled, storedKind, inputKind, condition }))))))('rejects $condition $storedKind for $inputKind with enrollment $enrolled', async ({ enrolled, storedKind, inputKind, condition }) => {
    const f = await setup(enrolled)
    await f.t.run(async ctx => {
      const binding = await bind(ctx, f.documentId, storedKind, condition === 'unavailable' || condition === 'invalidated' ? 'genuine_personal_work' : condition, true)
      if (condition === 'unavailable') await ctx.db.patch(binding.lineageId, { evidenceStatus: 'evidence_unavailable' })
      if (condition === 'invalidated') await ctx.db.patch(binding.lineageId, { invalidatedAt: 0 })
    })
    const ref = await f.t.run(ctx => reference(ctx, f.documentId, inputKind))
    const before = await state(f.t)
    const expected = { status: 'rejected', reasonCode: condition === 'unavailable' || condition === 'invalidated' ? 'lineage_unavailable' : 'restricted_lineage' }
    expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: ref }))).toMatchObject(expected)
    expect(await f.asOwner.run(ctx => admitArtifactInputForOwner(ctx, userId, { reference: ref }))).toMatchObject(expected)
    expect(await f.t.run(ctx => admitArtifactInputForRecord(ctx, { kind: 'document', id: f.documentId }, { reference: ref }))).toMatchObject(expected)
    await personalClassificationRejected(f)
    expect(await state(f.t)).toEqual(before)
  })

  test.each([false, true].flatMap(enrolled => (['teaching', 'genuine_personal_work'] as const).map(classification => ({ enrolled, classification }))))('admits registered $classification with enrollment $enrolled', async ({ enrolled, classification }) => {
    const f = await setup(enrolled)
    const refs = await f.t.run(async ctx => {
      const result = []
      for (const kind of kinds) result.push((await bind(ctx, f.documentId, kind, classification, true)).reference)
      return result
    })
    for (const ref of refs) expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: ref }))).toMatchObject({ status: 'admitted_registered', reasonCode: 'registered_lineage' })
    if (classification === 'teaching') await personalClassificationRejected(f)
  })

  test.each(kinds.flatMap(safeKind => (['private_scoring', 'invalidated', 'validation_unknown', 'stale_pins'] as const).map(condition => ({ safeKind, condition }))))('a passing $safeKind binding cannot hide its $condition counterpart', async ({ safeKind, condition }) => {
    const f = await setup(false)
    const existing = await f.t.run(async ctx => {
      const safe = await bind(ctx, f.documentId, safeKind, 'genuine_personal_work', true)
      const sibling = await bind(ctx, f.documentId, safeKind === 'document' ? 'document_chunk' : 'document', condition === 'private_scoring' ? 'private_scoring' : 'genuine_personal_work', true)
      if (condition === 'invalidated') await ctx.db.patch(sibling.lineageId, { invalidatedAt: 0 })
      if (condition === 'validation_unknown') await ctx.db.patch(sibling.validationId, { coverage: 'unknown' })
      if (condition === 'stale_pins') await ctx.db.patch(sibling.lineageId, { payloadDigest: 'd'.repeat(64) })
      return safe
    })
    expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference: existing.reference }))).toMatchObject({ status: 'bound', instructionalRegistered: true })
    expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: existing.reference }))).toMatchObject({ status: 'rejected', reasonCode: condition === 'private_scoring' ? 'restricted_lineage' : 'lineage_unavailable' })
  })

  test.each(kinds)('inspects a protected later key on the same %s representation', async kind => {
    const f = await setup(false)
    const safe = await f.t.run(async ctx => {
      const result = await bind(ctx, f.documentId, kind, 'genuine_personal_work', true, kind === 'document' ? 'a-safe' : undefined)
      await bind(ctx, f.documentId, kind, 'measurement', true, 'z-protected')
      return result
    })
    expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference: safe.reference }))).toMatchObject({ status: 'bound' })
    expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: safe.reference }))).toMatchObject({ status: 'rejected', reasonCode: 'restricted_lineage' })
    await personalClassificationRejected(f)
  })

  test.each([false, true])('existing unregistered personal lineage does not acquire registration at enrollment %s', async enrolled => {
    const f = await setup(enrolled)
    const binding = await f.t.run(ctx => bind(ctx, f.documentId, 'document'))
    expect(await f.asOwner.run(ctx => resolveArtifactLineageForOwner(ctx, userId, { reference: binding.reference }))).toMatchObject({ status: 'bound', instructionalRegistered: false })
    expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: binding.reference }))).toMatchObject({ status: 'rejected', reasonCode: 'registration_required' })
  })

  test.each(['indexing', 'failed', 'processing', 'pins', 'folder'] as const)('ordinary absence does not bypass %s liveness', async condition => {
    const f = await setup(null)
    const ref = await f.t.run(ctx => reference(ctx, f.documentId, 'document'))
    await f.t.run(async ctx => {
      if (condition === 'pins') await ctx.db.patch(f.documentId, { contentHash: 'd'.repeat(64) })
      else if (condition === 'folder') await ctx.db.delete(f.folderId)
      else await ctx.db.patch(f.documentId, { status: condition })
    })
    expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: ref }))).toMatchObject({ status: 'rejected', reasonCode: 'lineage_unavailable' })
  })

  test('a missing requested binding cannot use a safe sibling as ordinary absence', async () => {
    const f = await setup(false)
    await f.t.run(ctx => bind(ctx, f.documentId, 'document', 'genuine_personal_work', true))
    const ref = await f.t.run(ctx => reference(ctx, f.documentId, 'document_chunk'))
    expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: ref }))).toMatchObject({ status: 'rejected', reasonCode: 'lineage_unavailable' })
  })

  test('bounds representation inventory and retains charges across scope, admission and preparation', async () => {
    const f = await setup(false)
    const ref = await f.t.run(ctx => reference(ctx, f.documentId, 'document'))
    await f.t.run(async ctx => { for (let i = 0; i <= LEARN_ARTIFACT_LINEAGE_LIMITS.maxNodes; i++) await bind(ctx, f.documentId, 'document', 'genuine_personal_work', true, i === 0 ? 'whole' : `component-${i}`) })
    expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: ref }))).toMatchObject({ status: 'rejected', reasonCode: 'lineage_unavailable' })
    await personalClassificationRejected(f)
    const clean = await setup(false)
    const cleanRef = await clean.t.run(ctx => reference(ctx, clean.documentId, 'document'))
    expect(await clean.asOwner.run(async ctx => {
      const budget = createArtifactLineageReadContext(ctx)
      await isArtifactRegistrationRequired(budget.ctx)
      for (let i = 0; i < 2046; i++) await budget.ctx.db.query('learnAssessmentCases').withIndex('by_userId', q => q.eq('userId', 'absent-owner')).take(1)
      return admitArtifactInput(budget.ctx, { reference: cleanRef })
    })).toMatchObject({ status: 'rejected', reasonCode: 'lineage_unavailable' })
  })

  test('owner authority and caller-supplied classification cannot bypass admission', async () => {
    const f = await setup(null)
    const ref = await f.t.run(ctx => reference(ctx, f.documentId, 'document'))
    await expect(f.t.withIdentity(foreign).run(ctx => admitArtifactInputForOwner(ctx, userId, { reference: ref }))).rejects.toThrow('Learn access denied')
    expect(await f.t.withIdentity(foreign).run(ctx => admitArtifactInput(ctx, { reference: ref }))).toMatchObject({ status: 'rejected' })
    await expect(f.t.run(ctx => admitArtifactInputForOwner(ctx, userId, { reference: ref }))).rejects.toThrow('Unauthenticated')
    await expect(f.t.run(ctx => admitArtifactInputForRecord(ctx, { kind: 'document', id: f.documentId, userId } as never, { reference: ref }))).rejects.toThrow()
    await expect(f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: ref, classification: 'teaching' }))).rejects.toThrow()
    await f.t.run(ctx => bind(ctx, f.documentId, 'document', 'genuine_personal_work', true).then(async b => { await ctx.db.patch(b.lineageId, { userId: foreign.tokenIdentifier }) }))
    expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: ref }))).toMatchObject({ status: 'rejected', reasonCode: 'lineage_unavailable' })
  })

  test.each(kinds)('a foreign %s row cannot disclose its protected classification through a reason code', async kind => {
    const f = await setup(false)
    const ref = await f.t.run(async ctx => {
      const binding = await bind(ctx, f.documentId, kind, 'measurement')
      await ctx.db.patch(binding.lineageId, { userId: foreign.tokenIdentifier })
      return binding.reference
    })
    const expected = { status: 'rejected', reasonCode: 'lineage_unavailable' }
    expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: ref }))).toMatchObject(expected)
    expect(await f.asOwner.run(ctx => admitArtifactInputForOwner(ctx, userId, { reference: ref }))).toMatchObject(expected)
    expect(await f.t.run(ctx => admitArtifactInputForRecord(ctx, { kind: 'document', id: f.documentId }, { reference: ref }))).toMatchObject(expected)
  })

  test.each(['ordinary', 'purpose', 'opportunity'] as const)('ordinary session content cannot hide assessment pins: %s', async assessment => {
    const f = await setup(false)
    const ref = await f.t.run(async ctx => {
      const opportunity = assessment === 'opportunity' ? await seedMeasurementStorage(ctx, userId) : null
      if (opportunity) await ctx.db.delete(opportunity.rows.learnAssessmentCatalogs)
      const learningVoidId = await ctx.db.insert('learningVoids', { userId, folderId: f.folderId, title: 'Input', status: 'active', revision: 1, createdAt: base.createdAt, updatedAt: base.createdAt })
      const blueprintId = await ctx.db.insert('learnBlueprints', { userId, learningVoidId, revision: 1, createdAt: base.createdAt })
      const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { userId, learningVoidId, blueprintId, revision: 1, recordRevision: 1, status: 'accepted', createdAt: base.createdAt, updatedAt: base.createdAt })
      await ctx.db.patch(learningVoidId, { activeBlueprintRevisionId: blueprintRevisionId })
      const objectiveId = await ctx.db.insert('learnObjectives', { userId, blueprintRevisionId, order: 0, title: 'Input' })
      const studyPlanId = await ctx.db.insert('studyPlans', { userId, learningVoidId, revision: 1, createdAt: base.createdAt })
      const studyPlanRevisionId = await ctx.db.insert('studyPlanRevisions', { userId, learningVoidId, studyPlanId, revision: 1, recordRevision: 1, blueprintRevisionId, blueprintRecordRevision: 1, status: 'accepted', createdAt: base.createdAt })
      await ctx.db.patch(studyPlanId, { activeRevisionId: studyPlanRevisionId })
      const studySessionId = await ctx.db.insert('studySessions', { userId, studyPlanRevisionId, primaryObjectiveId: objectiveId, status: 'ready', revision: 1, scheduledStartAt: base.createdAt })
      const sessionContentId = await ctx.db.insert('sessionContent', { userId, studySessionId, studyPlanRevisionId, blueprintRevisionId, objectiveId, revision: 1, status: 'published', createdAt: base.createdAt,
        ...(assessment === 'purpose' ? { assessmentPurpose: 'measurement_cold' as const } : {}),
        ...(opportunity ? { assessmentOpportunityId: opportunity.rows.learnAssessmentOpportunities } : {}) })
      const id = await ctx.db.insert('sessionContentBlocks', { userId, sessionContentId, order: 0, kind: 'explanation', content: 'Current content' })
      const block = (await ctx.db.get(id))!
      const content = (await ctx.db.get(sessionContentId))!
      return { artifact: { kind: 'session_block' as const, id }, key: 'whole', revision: '1', payloadDigest: await artifactPayloadDigest(await sessionBlockContentProjection(ctx, block, content)) }
    })
    expect(await f.asOwner.run(ctx => admitArtifactInput(ctx, { reference: ref }))).toMatchObject(assessment === 'ordinary' ? { status: 'admitted_unregistered' } : { status: 'rejected', reasonCode: 'restricted_lineage' })
  })

  test.each(['measurement_item', 'scoring_spec'] as const)('a live %s without an artifact binding is never ordinary input', async kind => {
    const t = convexTest(schema, modules)
    const ref = await t.run(async ctx => {
      const f = await seedMeasurementStorage(ctx, userId)
      await ctx.db.patch(f.learningVoidId, { activeBlueprintRevisionId: f.scope.blueprintRevisionId })
      await ctx.db.patch(f.scope.blueprintRevisionId, { status: 'accepted' })
      await ctx.db.patch(f.rows.learnMeasurementFamilies, { status: 'provisional_equivalent', validationId: f.rows.learnMeasurementValidations })
      await ctx.db.patch(f.rows.learnMeasurementItems, { status: 'published', scoringSpecId: f.rows.learnMeasurementScoringSpecs, publicationValidationId: f.rows.learnMeasurementValidations })
      const item = (await ctx.db.get(f.rows.learnMeasurementItems))!
      const family = (await ctx.db.get(f.rows.learnMeasurementFamilies))!
      const spec = (await ctx.db.get(f.rows.learnMeasurementScoringSpecs))!
      return { artifact: kind === 'measurement_item' ? { kind, id: item._id } : { kind, id: spec._id }, key: 'whole', revision: '1',
        payloadDigest: await artifactPayloadDigest(artifactContentProjection({ kind, item, family, spec })) }
    })
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference: ref }))).toMatchObject({ status: 'rejected', reasonCode: 'restricted_lineage' })
  })
})


test('admission never reuses a decision across producer calls', async () => {
  const f = await setup(null)
  await f.asOwner.run(async ctx => {
    const budget = createArtifactLineageReadContext(ctx)
    const ref = await reference(ctx, f.documentId, 'document')
    expect(await admitArtifactInput(budget.ctx, { reference: ref })).toMatchObject({ status: 'admitted_unregistered' })
    await bind(ctx, f.documentId, 'document', 'measurement')
    expect(await admitArtifactInput(budget.ctx, { reference: ref })).toMatchObject({ status: 'rejected', reasonCode: 'restricted_lineage' })
  })
})
