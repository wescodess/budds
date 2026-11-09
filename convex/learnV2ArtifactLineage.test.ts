/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test'
import { makeFunctionReference, type WithoutSystemFields, type FunctionReference, type FunctionArgs, type FunctionReturnType } from 'convex/server'
import { getDocumentSize, v, type Value } from 'convex/values'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id, TableNames } from './_generated/dataModel'
import { internalMutation, type MutationCtx } from './_generated/server'
import schema from './schema'
import { ARTIFACT_LINEAGE_INDEX_RANGES, ARTIFACT_LINEAGE_READ_BYTES, ArtifactProjectionBudgetError, createArtifactLineagePublicationContext, admitArtifactInput, admitArtifactInputByIdentity, admitArtifactInputs, admitArtifactInputsForOwner, admitArtifactInputsForRecord, prepareAndRegisterInstructionalArtifacts, classifyPersonalWorkDocumentForOwner, classifyPersonalWorkDocumentForRecord, createArtifactLineageReadContext, registerInstructionalArtifactsForOwner, registerInstructionalArtifactsForRecord, registerInstructionalArtifactForRecord, resolveArtifactLineageForRecord, supersedeArtifactLineageForOwner, supersedeArtifactLineageForRecord, sessionBlockContentProjection, sectionContentProjection, audioOverviewContentProjection, artifactContentProjection, artifactManifestDigest, artifactPayloadDigest, advanceAssessmentCatalogForOwner, registerInstructionalArtifactForOwner, resolveArtifactLineageForOwner } from './lib/learnV2ArtifactLineage'
import { artifactRegistrationArgs, artifactRegistrationResultValidator } from './lib/learnV2ArtifactLineageContract'
import { invalidateMeasurementSourceBatch } from './lib/learnV2MeasurementRetention'
import { LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY, LEARN_ARTIFACT_LINEAGE_VERSION, LEARN_ARTIFACT_LINEAGE_LIMITS, type LearnArtifactReference, type LearnArtifactOwnerRecord, learnArtifactInputAdmissionResultSchema } from '../shared/learn-v2-artifact-lineage'
import { composeAdaptiveActivityPlan } from '../shared/learn-adaptive-activity-plan'
import { initiateAdaptiveThreadDeletion } from './learnAdaptiveCommands'
import { privateAdaptiveArtifactR2Key } from './lib/learnAdaptiveArtifacts'

const owner = { tokenIdentifier: 'https://auth.example.com|lineage-owner', subject: 'same-subject' }
const foreign = { tokenIdentifier: 'https://other.example.com|lineage-owner', subject: 'same-subject' }
// Exercise the dormant registration seam as an internal mutation without adding a production endpoint.
const modules = {
  ...import.meta.glob('./**/*.ts'),
  './artifactLineageTest.ts': async () => ({
    protect: internalMutation({
      args: { caseId: v.id('learnAssessmentCases'), documentId: v.id('documents'), lineageId: v.id('learnArtifactLineages'), kind: v.union(v.literal('reservation'), v.literal('availability'), v.literal('classification')) },
      returns: v.null(),
      handler: async (ctx, args) => {
        if (args.kind === 'reservation') await ctx.db.patch(args.caseId, { reservedAt: 0 })
        if (args.kind === 'availability') await ctx.db.patch(args.documentId, { status: 'indexing' })
        if (args.kind === 'classification') await ctx.db.patch(args.lineageId, { classification: 'measurement' })
        return null
      },
    }),
    registerInstructional: internalMutation({
      args: artifactRegistrationArgs,
      returns: artifactRegistrationResultValidator,
      handler: (ctx, args) => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, args),
    }),
  }),
}
const registerInstructional = makeFunctionReference<'mutation', ReturnType<typeof registration>, Awaited<ReturnType<typeof registerInstructionalArtifactForOwner>>>('artifactLineageTest:registerInstructional')
const protect = makeFunctionReference<'mutation', { caseId: Id<'learnAssessmentCases'>, documentId: Id<'documents'>, lineageId: Id<'learnArtifactLineages'>, kind: 'reservation' | 'availability' | 'classification' }, null>('artifactLineageTest:protect')
type Fixture = Awaited<ReturnType<typeof prepare>>
type Origin = Pick<Doc<'learnArtifactLineages'>, 'classification' | 'manifestDigest'> & { lineageId: Id<'learnArtifactLineages'>, caseId: Id<'learnAssessmentCases'>, reference: LearnArtifactReference }

afterEach(() => { vi.useRealTimers() })

async function prepare(ctx: MutationCtx, options: {
  classification?: Doc<'learnArtifactLineages'>['classification'], origin?: Origin, transformation?: Doc<'learnArtifactLineageOrigins'>['transformation'],
  reserved?: boolean, key?: string, fingerprint?: string,
} = {}) {
  const userId = owner.tokenIdentifier
  const base = { userId, storageVersion: 'learn-v2.measurement-storage.v1' as const, createdAt: 1_800_000_000_000 }
  let catalog = await ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', userId)).unique()
  if (!catalog) {
    const id = await ctx.db.insert('learnAssessmentCatalogs', { ...base, catalogRevision: 0, instrumentationEpoch: 'epoch.v1',
      historyCompleteness: 'prospective_complete', historyBasisVersion: 'history.v1', historyCoverageWatermark: 'coverage.v1' })
    catalog = await ctx.db.get(id)
  }
  if (!catalog) throw new Error('Missing catalogue')
  const folderId = await ctx.db.insert('folders', { userId, name: 'Owned teaching', documentCount: 0 })
  const documentId = await ctx.db.insert('documents', { userId, folderId, filename: 'owned.txt', fileSize: 5, status: 'success', sourceRevision: 'source.r1', contentHash: 'f'.repeat(64), r2Key: 'owned/source.r1' })
  const classification = options.classification ?? options.origin?.classification ?? 'teaching'
  const reference: LearnArtifactReference = { artifact: { kind: 'document', id: documentId }, key: options.key ?? 'whole', revision: 'source.r1', payloadDigest: await artifactPayloadDigest(artifactContentProjection({ kind: 'document', document: (await ctx.db.get(documentId))! })) }
  const lineageId = await ctx.db.insert('learnArtifactLineages', { ...base, ...reference, lineageVersion: LEARN_ARTIFACT_LINEAGE_VERSION,
    manifestDigest: '0'.repeat(64), evidenceStatus: 'available', classification,
    authority: options.origin ? 'server_producer' : classification === 'genuine_personal_work' ? 'personal_authorship' : classification === 'legacy_history' ? 'legacy_record' : 'server_producer',
    authorityVersion: 'producer.v1', derivation: options.origin ? 'derived' : 'original', originCount: options.origin ? 1 : 0,
    caseCount: options.origin ? 0 : 1, sourceCount: options.origin ? 0 : 1 })
  let caseId: Id<'learnAssessmentCases'>
  if (options.origin) {
    caseId = options.origin.caseId
    await ctx.db.insert('learnArtifactLineageOrigins', { ...base, lineageId, originLineageId: options.origin.lineageId,
      originRevision: options.origin.reference.revision, originPayloadDigest: options.origin.reference.payloadDigest,
      originManifestDigest: options.origin.manifestDigest, classification: options.origin.classification, transformation: options.transformation ?? 'copy' })
  }
  else {
    caseId = await ctx.db.insert('learnAssessmentCases', { ...base, caseKey: `opaque-${String(documentId)}`, scenarioFingerprint: (options.fingerprint ?? 'b').repeat(64),
      solutionFingerprint: (options.fingerprint ?? 'c').repeat(64), identityPolicyVersion: 'identity.v1', usageClass: 'unknown',
      ...(options.reserved ? { reservedAt: base.createdAt } : {}) })
    await ctx.db.insert('learnArtifactCaseBindings', { ...base, lineageId, caseId, scenarioFingerprint: (options.fingerprint ?? 'b').repeat(64),
      solutionFingerprint: (options.fingerprint ?? 'c').repeat(64), identityPolicyVersion: 'identity.v1' })
    await ctx.db.insert('learnArtifactSourceLinks', { ...base, lineageId, evidenceStatus: 'available', dependency: { kind: 'document', documentId, sourceRevision: 'source.r1' } })
  }
  const manifestDigest = await sealManifest(ctx, lineageId)
  const validationId = await ctx.db.insert('learnArtifactValidations', { ...base, lineageId, payloadDigest: reference.payloadDigest, manifestDigest,
    evidenceStatus: 'available', decision: 'pass', comparedCatalogRevision: catalog.catalogRevision, coverage: 'complete', coverageWatermark: 'coverage.v1',
    corpusDigest: 'd'.repeat(64), identityPolicyVersion: 'identity.v1', noveltyPolicyVersion: 'novelty.v1', validatorVersion: 'validator.v1', validatorModel: null, harnessArtifactDigest: 'e'.repeat(64) })
  await ctx.db.patch(lineageId, { validationId })
  return { reference, lineageId, caseId, validationId, manifestDigest, classification, documentId, folderId, base, catalogId: catalog._id, catalogRevision: catalog.catalogRevision }
}

async function currentManifestDigest(ctx: MutationCtx, lineageId: Id<'learnArtifactLineages'>) {
  const row = await ctx.db.get(lineageId)
  if (!row) throw new Error('Missing lineage')
  const [origins, cases, sources] = await Promise.all([
    ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', lineageId)).take(9),
    ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', lineageId)).take(33),
    ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', lineageId)).take(65),
  ])
  return artifactManifestDigest(ctx, row, origins, cases, sources)
}

async function sealManifest(ctx: MutationCtx, lineageId: Id<'learnArtifactLineages'>) {
  const digest = await currentManifestDigest(ctx, lineageId)
  await ctx.db.patch(lineageId, { manifestDigest: digest })
  return digest
}

function registration(f: Fixture) { return { reference: f.reference, validationId: f.validationId, expectedCatalogRevision: f.catalogRevision } }

async function prepareSourceDependency(ctx: MutationCtx, kind: 'snapshot' | 'excerpt', withBackingDocument = true) {
  const f = await prepare(ctx, { classification: 'genuine_personal_work' })
  const userId = owner.tokenIdentifier
  // Keep the artifact outside the source folder so its own deletion cannot mask access loss.
  const sourceFolderId = await ctx.db.insert('folders', { userId, name: 'Source owner', documentCount: 0 })
  const sourceDocumentId = withBackingDocument
    ? await ctx.db.insert('documents', { userId, folderId: sourceFolderId, filename: 'source.txt', fileSize: 5, status: 'success', sourceRevision: 'source.r1', contentHash: 'f'.repeat(64), r2Key: 'source/source.r1' })
    : undefined
  const learningVoidId = await ctx.db.insert('learningVoids', { userId, folderId: sourceFolderId, title: 'Source owner', status: 'active', revision: 1, createdAt: f.base.createdAt, updatedAt: f.base.createdAt })
  const identityId = await ctx.db.insert('learnSourceIdentities', { userId, learningVoidId, origin: withBackingDocument ? 'folder_document' : 'user_url', externalKey: 'source', folderDocumentId: sourceDocumentId })
  const snapshotId = await ctx.db.insert('learnSourceSnapshots', { userId, learningVoidId, sourceIdentityId: identityId,
    revision: 1, recordRevision: 1, status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear', contentHash: 'f'.repeat(64),
    ...(withBackingDocument ? { sourceRevision: 'source.r1', objectKey: 'source/source.r1' } : {}), createdAt: f.base.createdAt })
  const excerptId = await ctx.db.insert('learnSourceExcerpts', { userId, sourceSnapshotId: snapshotId, locator: 'https://example.com/', excerpt: 'Permitted source', rightsStatus: 'permitted' })
  const link = await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', f.lineageId)).unique()
  if (!link) throw new Error('Missing source link')
  const pin = { sourceSnapshotId: snapshotId, revision: 1, recordRevision: 1, contentHash: 'f'.repeat(64) }
  await ctx.db.patch(link._id, { dependency: kind === 'snapshot' ? { kind, ...pin } : { kind, ...pin, sourceExcerptId: excerptId } })
  const manifestDigest = await sealManifest(ctx, f.lineageId)
  await ctx.db.patch(f.validationId, { manifestDigest })
  return { ...f, manifestDigest, sourceFolderId, sourceDocumentId, learningVoidId, identityId, snapshotId, excerptId, linkId: link._id }
}

async function expectSourceRevoked(t: ReturnType<typeof convexTest>, f: Fixture) {
  const asOwner = t.withIdentity(owner)
  expect.soft(await asOwner.query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toEqual({ status: 'unavailable', version: LEARN_ARTIFACT_LINEAGE_VERSION })
  await expect.soft(asOwner.mutation(registerInstructional, registration(f))).rejects.toThrow('Artifact lineage unavailable')
  expect(await t.run(ctx => ctx.db.get(f.catalogId))).toMatchObject({ catalogRevision: f.catalogRevision })
  expect(await t.run(ctx => ctx.db.get(f.lineageId))).not.toHaveProperty('publication')
  expect(await t.run(ctx => ctx.db.get(f.caseId))).toMatchObject({ usageClass: 'unknown' })
}

describe('instructional artifact lineage contract', () => {
  test('registers identity and publication in the owner catalogue transaction without an exposure', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx))
    const asOwner = t.withIdentity(owner)
    expect(await asOwner.query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'unavailable' })
    expect(await asOwner.run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))).toMatchObject({ catalogRevision: 1 })
    expect(await asOwner.query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'bound', classification: 'teaching', instructionalRegistered: true,
      cases: [{ caseId: f.caseId, usageClass: 'instructional' }], validation: { comparedCatalogRevision: 0, coverage: 'complete', noveltyPolicyVersion: 'novelty.v1' } })
    expect(await t.run(ctx => ctx.db.get(f.caseId))).toMatchObject({ usageClass: 'instructional', artifactIdentityValidationId: f.validationId })
    expect(await t.run(ctx => ctx.db.query('learnAssessmentExposures').withIndex('by_userId', q => q.eq('userId', owner.tokenIdentifier)).take(1))).toEqual([])
  })

  test.each(['measurement', 'private_scoring', 'unknown', 'legacy_history'] as const)('%s classification never registers as teaching', async classification => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx, { classification }))
    await expect(t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))).rejects.toThrow('unavailable')
    expect(await t.run(ctx => ctx.db.get(f.catalogId))).toMatchObject({ catalogRevision: 0 })
    expect(await t.run(ctx => ctx.db.get(f.caseId))).toMatchObject({ usageClass: 'unknown' })
  })

  test.each(['copy', 'summary', 'rewrite', 'restore', 'import'] as const)('retains the original reserved lineage through %s with a different artifact and digest', async transformation => {
    const t = convexTest(schema, modules)
    const original = await t.run(ctx => prepare(ctx, { classification: 'measurement', reserved: true }))
    const copy = await t.run(ctx => prepare(ctx, { origin: original, transformation }))
    const result = await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: copy.reference })
    expect(result).toMatchObject({ status: 'bound', classification: 'measurement', instructionalRegistered: false,
      originLineageIds: [original.lineageId], cases: [{ caseId: original.caseId, usageClass: 'measurement_reserved' }] })
    await expect(t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(copy)))).rejects.toThrow('unavailable')
    await t.run(async ctx => {
      // Personal work needs no publication, so only the mixed-classification rule can reject this sealed rewrite.
      await ctx.db.patch(copy.lineageId, { classification: 'genuine_personal_work' })
      const manifestDigest = await sealManifest(ctx, copy.lineageId)
      await ctx.db.patch(copy.validationId, { manifestDigest })
    })
    expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: copy.reference })).toMatchObject({ status: 'unavailable' })
  })

  test('preserves genuine personal work without implying instructional or V2 eligibility', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    const result = await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })
    expect(result).toMatchObject({ status: 'bound', classification: 'genuine_personal_work', instructionalRegistered: false })
    expect(result).not.toHaveProperty('measurementEligible')
    const legacy = await t.run(ctx => ctx.db.insert('documents', { userId: owner.tokenIdentifier, folderId: f.folderId, filename: 'old.txt', fileSize: 1, status: 'success' }))
    expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: { ...f.reference, artifact: { kind: 'document', id: legacy } } })).toMatchObject({ status: 'unavailable' })
    expect(await t.run(ctx => ctx.db.get(legacy))).toMatchObject({ filename: 'old.txt' })
  })

  test('a retired reservation and an equivalent solution fingerprint both block new teaching identity', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx, { reserved: true }))
    await expect(t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))).rejects.toThrow('unavailable')
    await t.run(ctx => ctx.db.patch(f.caseId, { reservedAt: undefined }))
    await t.run(async ctx => {
      const same = await ctx.db.get(f.caseId)
      if (!same) throw new Error('Missing case')
      const { _id: _id, _creationTime: _time, ...fields } = same
      await ctx.db.insert('learnAssessmentCases', { ...fields, caseKey: 'an-unrelated-opaque-key', scenarioFingerprint: 'f'.repeat(64), reservedAt: f.base.createdAt })
    })
    await expect(t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))).rejects.toThrow('unavailable')
  })

  test('item publication advancing the same guard invalidates an older instructional validation', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx))
    const asOwner = t.withIdentity(owner)
    await asOwner.run(ctx => advanceAssessmentCatalogForOwner(ctx, owner.tokenIdentifier, 0))
    await expect(asOwner.run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))).rejects.toThrow('unavailable')
    expect(await t.run(ctx => ctx.db.get(f.lineageId))).not.toHaveProperty('publication')
    expect(await t.run(ctx => ctx.db.get(f.caseId))).toMatchObject({ usageClass: 'unknown' })
  })

  test('instructional publication invalidates competing validation and a failed producer rolls back all registration writes', async () => {
    const t = convexTest(schema, modules)
    const first = await t.run(ctx => prepare(ctx))
    const second = await t.run(ctx => prepare(ctx, { fingerprint: 'd' }))
    const asOwner = t.withIdentity(owner)
    await expect(asOwner.run(async ctx => {
      await registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(first))
      await ctx.db.patch(first.documentId, { filename: 'not-committed.txt' })
      throw new Error('Producer persistence failed')
    })).rejects.toThrow('Producer persistence failed')
    expect(await t.run(ctx => ctx.db.get(first.catalogId))).toMatchObject({ catalogRevision: 0 })
    expect(await t.run(ctx => ctx.db.get(first.caseId))).toMatchObject({ usageClass: 'unknown' })
    expect(await t.run(ctx => ctx.db.get(first.documentId))).toMatchObject({ filename: 'owned.txt' })
    expect(await t.run(ctx => ctx.db.get(first.lineageId))).not.toHaveProperty('publication')
    await asOwner.run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(first)))
    await expect(asOwner.run(ctx => advanceAssessmentCatalogForOwner(ctx, owner.tokenIdentifier, 0))).rejects.toThrow('unavailable')
    await expect(asOwner.run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(second)))).rejects.toThrow('unavailable')
    expect(await t.run(ctx => ctx.db.get(second.caseId))).toMatchObject({ usageClass: 'unknown' })
    expect(await asOwner.query(internal.learnV2ArtifactLineage.resolve, { reference: first.reference })).toMatchObject({ status: 'bound' })
  })

  test('a registered teaching summary retains its original case and rejects later reservation or origin loss', async () => {
    const t = convexTest(schema, modules)
    const original = await t.run(ctx => prepare(ctx))
    const copy = await t.run(ctx => prepare(ctx, { origin: original, transformation: 'summary' }))
    const asOwner = t.withIdentity(owner)
    await asOwner.run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(copy)))
    expect(await asOwner.query(internal.learnV2ArtifactLineage.resolve, { reference: copy.reference })).toMatchObject({ status: 'bound', instructionalRegistered: true,
      originLineageIds: [original.lineageId], cases: [{ caseId: original.caseId, usageClass: 'instructional' }] })
    await t.run(ctx => ctx.db.patch(original.caseId, { reservedAt: original.base.createdAt }))
    expect(await asOwner.query(internal.learnV2ArtifactLineage.resolve, { reference: copy.reference })).toMatchObject({ status: 'unavailable' })
    await t.run(async ctx => {
      await ctx.db.patch(original.caseId, { reservedAt: undefined })
      await ctx.db.delete(original.lineageId)
    })
    expect(await asOwner.query(internal.learnV2ArtifactLineage.resolve, { reference: copy.reference })).toMatchObject({ status: 'unavailable' })
  })

  test('a stored validation cannot be reused after replacing its case or source manifest', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    const asOwner = t.withIdentity(owner)
    expect(await asOwner.query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'bound' })
    await t.run(async ctx => {
      const binding = await ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', f.lineageId)).unique()
      if (!binding) throw new Error('Missing case binding')
      await ctx.db.delete(binding._id)
      await ctx.db.patch(f.lineageId, { caseCount: 0 })
      await sealManifest(ctx, f.lineageId)
    })
    expect(await asOwner.query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'unavailable' })
  })

  test.each(['snapshot', 'excerpt', 'document', 'folder'] as const)('resolves and invalidates the exact %s source registration', async kind => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    const source = await t.run(async ctx => {
      const link = await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', f.lineageId)).unique()
      if (!link) throw new Error('Missing source link')
      let dependency: NonNullable<Doc<'learnArtifactSourceLinks'>['dependency']>
      let source: { kind: 'snapshot', id: Id<'learnSourceSnapshots'> } | { kind: 'excerpt', id: Id<'learnSourceExcerpts'> } | { kind: 'document', id: Id<'documents'> } | { kind: 'folder', id: Id<'folders'> }
      if (kind === 'document') { dependency = { kind, documentId: f.documentId, sourceRevision: 'source.r1' }; source = { kind, id: f.documentId } }
      else if (kind === 'folder') { dependency = { kind, folderId: f.folderId }; source = { kind, id: f.folderId } }
      else {
        const learningVoidId = await ctx.db.insert('learningVoids', { userId: owner.tokenIdentifier, folderId: f.folderId, title: 'Source owner', status: 'active', revision: 1, createdAt: f.base.createdAt, updatedAt: f.base.createdAt })
        const identityId = await ctx.db.insert('learnSourceIdentities', { userId: owner.tokenIdentifier, learningVoidId, origin: 'folder_document', externalKey: 'source', folderDocumentId: f.documentId })
        const snapshotId = await ctx.db.insert('learnSourceSnapshots', { userId: owner.tokenIdentifier, learningVoidId, sourceIdentityId: identityId,
          revision: 1, recordRevision: 1, status: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear', contentHash: 'f'.repeat(64), sourceRevision: 'source.r1', objectKey: 'owned/source.r1', createdAt: f.base.createdAt })
        if (kind === 'snapshot') { dependency = { kind, sourceSnapshotId: snapshotId, revision: 1, recordRevision: 1, contentHash: 'f'.repeat(64) }; source = { kind, id: snapshotId } }
        else {
          const excerptId = await ctx.db.insert('learnSourceExcerpts', { userId: owner.tokenIdentifier, sourceSnapshotId: snapshotId, locator: 'https://example.com/', excerpt: 'Permitted source', rightsStatus: 'permitted' })
          dependency = { kind, sourceExcerptId: excerptId, sourceSnapshotId: snapshotId, revision: 1, recordRevision: 1, contentHash: 'f'.repeat(64) }; source = { kind, id: excerptId }
        }
      }
      await ctx.db.patch(link._id, { dependency })
      const manifestDigest = await sealManifest(ctx, f.lineageId)
      await ctx.db.patch(f.validationId, { manifestDigest })
      return source
    })
    const asOwner = t.withIdentity(owner)
    expect(await asOwner.query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'bound' })
    expect(await t.run(ctx => invalidateMeasurementSourceBatch(ctx, owner.tokenIdentifier, source))).toBe(true)
    expect(await asOwner.query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'unavailable' })
    expect(await t.run(ctx => ctx.db.get(f.caseId))).not.toBeNull()
  })

  describe.each(['snapshot', 'excerpt'] as const)('%s source revocation', (kind) => {
    test.each([true, false])('resolves and registers an untombstoned owned permitted source (backing document: %s)', async (withBackingDocument) => {
      const t = convexTest(schema, modules)
      const f = await t.run(ctx => prepareSourceDependency(ctx, kind, withBackingDocument))
      const asOwner = t.withIdentity(owner)
      expect(await asOwner.query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'bound' })
      expect(await asOwner.mutation(registerInstructional, registration(f))).toMatchObject({ catalogRevision: 1 })
      expect(await asOwner.query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'bound', instructionalRegistered: true })
    })

    test('revokes resolution and registration at real folder deletion before scheduled foundational cleanup', async () => {
      vi.useFakeTimers()
      const t = convexTest(schema, modules)
      const f = await t.run(ctx => prepareSourceDependency(ctx, kind, false))
      const asOwner = t.withIdentity(owner)
      expect(await asOwner.query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'bound' })
      await asOwner.mutation(api.folders.deleteFolder, { id: f.sourceFolderId })
      expect(await t.run(ctx => ctx.db.get(f.sourceFolderId))).toBeNull()
      expect(await t.run(ctx => ctx.db.get(f.folderId))).not.toBeNull()
      expect(await t.run(ctx => ctx.db.get(f.documentId))).not.toBeNull()
      expect(await t.run(ctx => ctx.db.get(f.learningVoidId))).toMatchObject({ status: 'active' })
      expect(await t.run(ctx => ctx.db.get(f.identityId))).not.toHaveProperty('tombstonedAt')
      expect(await t.run(ctx => ctx.db.get(f.snapshotId))).not.toHaveProperty('evidencePurgedAt')
      expect(await t.run(ctx => ctx.db.get(f.excerptId))).toMatchObject({ excerpt: 'Permitted source' })
      expect(await t.run(ctx => ctx.db.get(f.linkId))).toMatchObject({ evidenceStatus: 'available', dependency: { kind } })
      expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').take(20))).toContainEqual(expect.objectContaining({
        name: 'learnV2Retention:deleteFolderFoundation', state: expect.objectContaining({ kind: 'pending' }),
      }))
      await expectSourceRevoked(t, f)
    })

    test.each(['void_missing', 'void_foreign', 'void_archived', 'folder_foreign'] as const)('denies owning aggregate access loss %s without advancing the catalogue', async (state) => {
      const t = convexTest(schema, modules)
      const f = await t.run(ctx => prepareSourceDependency(ctx, kind, false))
      expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'bound' })
      await t.run(async ctx => {
        if (state === 'void_missing') await ctx.db.delete(f.learningVoidId)
        if (state === 'void_foreign') await ctx.db.patch(f.learningVoidId, { userId: foreign.tokenIdentifier })
        if (state === 'void_archived') await ctx.db.patch(f.learningVoidId, { status: 'archived' })
        if (state === 'folder_foreign') await ctx.db.patch(f.sourceFolderId, { userId: foreign.tokenIdentifier })
      })
      await expectSourceRevoked(t, f)
    })

    test('revokes resolution and registration at the real folder-document tombstone before scheduled evidence purge', async () => {
      vi.useFakeTimers()
      const t = convexTest(schema, modules)
      const f = await t.run(ctx => prepareSourceDependency(ctx, kind))
      if (!f.sourceDocumentId) throw new Error('Missing source document')
      expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'bound' })
      expect(await t.mutation(internal.learnV2Retention.purgeFolderDocumentSources, { userId: owner.tokenIdentifier, documentId: f.sourceDocumentId })).toEqual({ pending: true })
      const identity = await t.run(ctx => ctx.db.get(f.identityId))
      expect(identity).toHaveProperty('tombstonedAt')
      expect(identity).not.toHaveProperty('folderDocumentId')
      expect(await t.run(ctx => ctx.db.get(f.linkId))).toMatchObject({ evidenceStatus: 'available', dependency: { kind } })
      const snapshot = await t.run(ctx => ctx.db.get(f.snapshotId))
      expect(snapshot).toMatchObject({ status: 'user_accepted' })
      expect(snapshot).not.toHaveProperty('evidencePurgedAt')
      const excerpt = await t.run(ctx => ctx.db.get(f.excerptId))
      expect(excerpt).toMatchObject({ excerpt: 'Permitted source' })
      expect(excerpt).not.toHaveProperty('evidencePurgedAt')
      expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').take(8))).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'learnV2Retention:purgeSourceEvidence', state: { kind: 'pending' } }),
        expect.objectContaining({ name: 'learnV2Retention:purgeScopedActivityCopies', state: { kind: 'pending' } }),
      ]))
      await expectSourceRevoked(t, f)
    })

    test('denies a tombstoned identity that never had a folder document', async () => {
      const t = convexTest(schema, modules)
      const f = await t.run(ctx => prepareSourceDependency(ctx, kind, false))
      expect(await t.run(ctx => ctx.db.get(f.identityId))).not.toHaveProperty('folderDocumentId')
      expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'bound' })
      await t.run(ctx => ctx.db.patch(f.identityId, { tombstonedAt: 0 }))
      await expectSourceRevoked(t, f)
    })

    test.each(['link_invalidated', 'link_unavailable', 'snapshot_purged', 'snapshot_unavailable', 'snapshot_rejected', 'effective_status_unavailable', 'document_deleted', 'document_failed'] as const)('denies existing revocation state %s without advancing the catalogue', async (state) => {
      const t = convexTest(schema, modules)
      const f = await t.run(ctx => prepareSourceDependency(ctx, kind))
      expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'bound' })
      await t.run(async (ctx) => {
        if (state === 'link_invalidated') await ctx.db.patch(f.linkId, { invalidatedAt: 0 })
        if (state === 'link_unavailable') await ctx.db.patch(f.linkId, { evidenceStatus: 'evidence_unavailable' })
        if (state === 'snapshot_purged') await ctx.db.patch(f.snapshotId, { evidencePurgedAt: 0 })
        if (state === 'snapshot_unavailable') await ctx.db.patch(f.snapshotId, { status: 'unavailable' })
        if (state === 'snapshot_rejected') await ctx.db.patch(f.snapshotId, { status: 'rejected' })
        if (state === 'effective_status_unavailable') await ctx.db.patch(f.snapshotId, { effectiveStatus: 'unavailable' })
        if (!f.sourceDocumentId) throw new Error('Missing source document')
        if (state === 'document_deleted') await ctx.db.delete(f.sourceDocumentId)
        if (state === 'document_failed') await ctx.db.patch(f.sourceDocumentId, { status: 'failed' })
      })
      await expectSourceRevoked(t, f)
    })
  })

  test('denies a purged excerpt while the snapshot and source remain available', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareSourceDependency(ctx, 'excerpt'))
    expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'bound' })
    await t.run(ctx => ctx.db.patch(f.excerptId, { evidencePurgedAt: 0 }))
    await expectSourceRevoked(t, f)
  })

  test.each(['catalogue', 'coverage', 'validation', 'manifest', 'source', 'owner'] as const)('missing or stale %s is unavailable and cannot publish', async failure => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx))
    await t.run(async ctx => {
      if (failure === 'catalogue') await ctx.db.delete(f.catalogId)
      if (failure === 'coverage') await ctx.db.patch(f.validationId, { coverage: 'unknown' })
      if (failure === 'validation') await ctx.db.delete(f.validationId)
      if (failure === 'manifest') await ctx.db.patch(f.lineageId, { manifestDigest: 'f'.repeat(64) })
      if (failure === 'source') await ctx.db.patch(f.documentId, { sourceRevision: 'source.r2' })
      if (failure === 'owner') await ctx.db.patch(f.documentId, { userId: foreign.tokenIdentifier })
    })
    expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'unavailable' })
    await expect(t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))).rejects.toThrow('unavailable')
  })

  test('caller hashes, origin strings and a different issuer confer no authority', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx))
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))
    await expect(t.query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).rejects.toThrow('Unauthenticated')
    expect(await t.withIdentity(foreign).query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'unavailable' })
    expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: { ...f.reference, payloadDigest: 'f'.repeat(64) } })).toMatchObject({ status: 'unavailable' })
    await expect(t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference, origin: 'teaching' } as never)).rejects.toThrow()
    await expect(t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: { ...f.reference, snippet: 'safe-looking' } } as never)).rejects.toThrow()
  })

  test('source deletion drains bounded links and makes copied descendants unavailable before their own cleanup', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    const copy = await t.run(ctx => prepare(ctx, { origin: f, transformation: 'summary' }))
    for (let index = 0; index < 9; index++) await t.run(ctx => ctx.db.insert('learnArtifactSourceLinks', { ...f.base, lineageId: f.lineageId, evidenceStatus: 'available', dependency: { kind: 'document', documentId: f.documentId, sourceRevision: 'source.r1' } }))
    expect(await t.run(ctx => invalidateMeasurementSourceBatch(ctx, owner.tokenIdentifier, { kind: 'document', id: f.documentId }))).toBe(true)
    expect(await t.run(ctx => ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_dependency_documentId_and_invalidatedAt', q => q.eq('userId', owner.tokenIdentifier).eq('dependency.documentId', f.documentId).eq('invalidatedAt', undefined)).take(9))).toHaveLength(2)
    expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: copy.reference })).toMatchObject({ status: 'unavailable' })
    await t.run(ctx => invalidateMeasurementSourceBatch(ctx, owner.tokenIdentifier, { kind: 'document', id: f.documentId }))
    const links = await t.run(ctx => ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', f.lineageId)).take(11))
    expect(links).toHaveLength(10)
    expect(links.every(link => link.dependency === undefined && link.evidenceStatus === 'evidence_unavailable')).toBe(true)
    expect(await t.run(ctx => ctx.db.get(f.caseId))).not.toBeNull()
  })

  test('bounds origin depth', async () => {
    const t = convexTest(schema, modules)
    let f = await t.run(ctx => prepare(ctx, { classification: 'measurement' }))
    for (let index = 0; index < LEARN_ARTIFACT_LINEAGE_LIMITS.maxDepth + 1; index++) f = await t.run(ctx => prepare(ctx, { origin: f }))
    expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'unavailable' })
  })

  test.each(['short_first', 'long_first'] as const)('bounds the longest shared-ancestor path with %s traversal', async order => {
    for (const longBranchLength of [LEARN_ARTIFACT_LINEAGE_LIMITS.maxDepth - 2, LEARN_ARTIFACT_LINEAGE_LIMITS.maxDepth - 1]) {
      const t = convexTest(schema, modules)
      const leaf = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
      const shared = await t.run(ctx => prepare(ctx, { origin: leaf }))
      let branch = shared
      for (let index = 0; index < longBranchLength; index++) branch = await t.run(ctx => prepare(ctx, { origin: branch }))
      const origins = order === 'short_first' ? [shared, branch] : [branch, shared]
      const root = await t.run(ctx => prepare(ctx, { origin: origins[0] }))
      await t.run(async ctx => {
        const other = origins[1]!
        await ctx.db.insert('learnArtifactLineageOrigins', { ...root.base, lineageId: root.lineageId, originLineageId: other.lineageId,
          originRevision: other.reference.revision, originPayloadDigest: other.reference.payloadDigest,
          originManifestDigest: other.manifestDigest, classification: other.classification, transformation: 'copy' })
        await ctx.db.patch(root.lineageId, { originCount: 2 })
        const manifestDigest = await sealManifest(ctx, root.lineageId)
        await ctx.db.patch(root.validationId, { manifestDigest })
        const stored = await ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', root.lineageId)).take(3)
        expect(stored.map(origin => origin.originLineageId)).toEqual(origins.map(origin => origin.lineageId))
        expect(await ctx.db.query('learnArtifactLineages').take(LEARN_ARTIFACT_LINEAGE_LIMITS.maxNodes + 1)).toHaveLength(longBranchLength + 3)
      })
      const asOwner = t.withIdentity(owner)
      const withinLimit = longBranchLength + 2 === LEARN_ARTIFACT_LINEAGE_LIMITS.maxDepth
      expect(await asOwner.query(internal.learnV2ArtifactLineage.resolve, { reference: root.reference })).toMatchObject({ status: withinLimit ? 'bound' : 'unavailable' })
      if (withinLimit) expect(await asOwner.mutation(registerInstructional, registration(root))).toMatchObject({ catalogRevision: 1 })
      else {
        await expect(asOwner.mutation(registerInstructional, registration(root))).rejects.toThrow('Artifact lineage unavailable')
        expect(await t.run(ctx => ctx.db.get(root.catalogId))).toMatchObject({ catalogRevision: 0 })
      }
    }
  })

  test('rejects duplicate origins within the depth limit', async () => {
    const t = convexTest(schema, modules)
    const leaf = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    const f = await t.run(ctx => prepare(ctx, { origin: leaf }))
    await t.run(async ctx => {
      const origin = await ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', f.lineageId)).unique()
      if (!origin) throw new Error('Missing origin')
      const { _id: _id, _creationTime: _time, ...fields } = origin
      await ctx.db.insert('learnArtifactLineageOrigins', fields)
      await ctx.db.patch(f.lineageId, { originCount: 2 })
      const manifestDigest = await sealManifest(ctx, f.lineageId)
      await ctx.db.patch(f.validationId, { manifestDigest })
    })
    expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'unavailable' })
  })

  test('rejects oversized origins within the depth and node limits', async () => {
    const t = convexTest(schema, modules)
    const origins: Fixture[] = []
    for (let index = 0; index <= LEARN_ARTIFACT_LINEAGE_LIMITS.maxOrigins; index++) {
      origins.push(await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work', fingerprint: index.toString(16) })))
    }
    const root = await t.run(ctx => prepare(ctx, { origin: origins[0] }))
    // An independently encoded canonical manifest permits an oversized stored fixture without bypassing a lookup check.
    const digestFor = async (row: Doc<'learnArtifactLineages'>, links: Doc<'learnArtifactLineageOrigins'>[]) => {
      const manifest = { artifact: { id: row.artifact.id, kind: row.artifact.kind }, authority: row.authority, authorityVersion: row.authorityVersion,
        cases: [], classification: row.classification, derivation: row.derivation, key: row.key,
        origins: links.map(link => JSON.stringify({ classification: link.classification, lineageId: link.originLineageId,
          manifestDigest: link.originManifestDigest, payloadDigest: link.originPayloadDigest, revision: link.originRevision, transformation: link.transformation })).sort(),
        payloadDigest: row.payloadDigest, revision: row.revision, sources: [], userId: row.userId, version: row.lineageVersion }
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(manifest)))), value => value.toString(16).padStart(2, '0')).join('')
    }
    for (let index = 1; index < origins.length; index++) {
      await t.run(async ctx => {
        const origin = origins[index]!
        await ctx.db.insert('learnArtifactLineageOrigins', { ...root.base, lineageId: root.lineageId, originLineageId: origin.lineageId,
          originRevision: origin.reference.revision, originPayloadDigest: origin.reference.payloadDigest,
          originManifestDigest: origin.manifestDigest, classification: origin.classification, transformation: 'copy' })
        await ctx.db.patch(root.lineageId, { originCount: index + 1 })
        const row = await ctx.db.get(root.lineageId)
        if (!row) throw new Error('Missing lineage')
        const links = await ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', root.lineageId)).take(LEARN_ARTIFACT_LINEAGE_LIMITS.maxOrigins + 2)
        const manifestDigest = await digestFor(row, links)
        if (links.length <= LEARN_ARTIFACT_LINEAGE_LIMITS.maxOrigins) expect(manifestDigest).toBe(await sealManifest(ctx, root.lineageId))
        await ctx.db.patch(root.lineageId, { manifestDigest })
        await ctx.db.patch(root.validationId, { manifestDigest })
      })
      expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: root.reference })).toMatchObject({
        status: index < LEARN_ARTIFACT_LINEAGE_LIMITS.maxOrigins ? 'bound' : 'unavailable',
      })
    }
    await expect(t.withIdentity(owner).mutation(registerInstructional, registration(root))).rejects.toThrow('Artifact lineage unavailable')
    expect(await t.run(ctx => ctx.db.get(root.catalogId))).toMatchObject({ catalogRevision: 0 })
  })
})

const artifactKinds = ['session_block', 'document', 'document_chunk', 'quiz_question', 'section_block', 'flashcard_version', 'audio_overview', 'learner_artifact', 'measurement_item', 'scoring_spec'] as const satisfies readonly LearnArtifactReference['artifact']['kind'][]
type ArtifactKind = typeof artifactKinds[number]
type SourceKind = NonNullable<Doc<'learnArtifactSourceLinks'>['dependency']>['kind']

// Each artifact has an external source folder. Losing the artifact's own
// aggregate must fail independently of source cleanup, and vice versa.
async function prepareMatrix(ctx: MutationCtx, kind: ArtifactKind, sourceKind: SourceKind = 'snapshot') {
  const f = await prepareSourceDependency(ctx, sourceKind === 'excerpt' ? 'excerpt' : 'snapshot')
  const userId = owner.tokenIdentifier
  const now = f.base.createdAt
  await ctx.db.insert('users', { tokenIdentifier: userId, name: 'Lineage owner',
    learnV2Entitlement: { enabled: true, updatedAt: now }, learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: now } })
  const sourceBlueprintId = await ctx.db.insert('learnBlueprints', { userId, learningVoidId: f.learningVoidId, revision: 1, createdAt: now })
  const sourceBlueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { userId, learningVoidId: f.learningVoidId,
    blueprintId: sourceBlueprintId, revision: 1, recordRevision: 1, status: 'source_review', createdAt: now, updatedAt: now })
  await ctx.db.patch(f.snapshotId, { blueprintRevisionId: sourceBlueprintRevisionId })
  if (sourceKind === 'document') await ctx.db.patch(f.linkId, { dependency: { kind: 'document', documentId: f.sourceDocumentId!, sourceRevision: 'source.r1' } })
  if (sourceKind === 'folder') await ctx.db.patch(f.linkId, { dependency: { kind: 'folder', folderId: f.sourceFolderId } })

  const artifactVoidId = await ctx.db.insert('learningVoids', { userId, folderId: f.folderId, title: 'Artifact owner', status: 'active', revision: 1, createdAt: now, updatedAt: now })
  const blueprintId = await ctx.db.insert('learnBlueprints', { userId, learningVoidId: artifactVoidId, revision: 1, createdAt: now })
  const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { userId, learningVoidId: artifactVoidId, blueprintId, revision: 1, recordRevision: 1, status: 'accepted', createdAt: now, updatedAt: now })
  await ctx.db.patch(artifactVoidId, { activeBlueprintRevisionId: blueprintRevisionId })
  const objectiveId = await ctx.db.insert('learnObjectives', { userId, blueprintRevisionId, title: 'Owned capability', order: 0 })
  const studyPlanId = await ctx.db.insert('studyPlans', { userId, learningVoidId: artifactVoidId, revision: 1, createdAt: now })
  const planId = await ctx.db.insert('studyPlanRevisions', { userId, learningVoidId: artifactVoidId, studyPlanId,
    blueprintRevisionId, blueprintRecordRevision: 1, revision: 1, recordRevision: 1, status: 'accepted', createdAt: now })
  await ctx.db.patch(studyPlanId, { activeRevisionId: planId })
  const sessionId = await ctx.db.insert('studySessions', { userId, studyPlanRevisionId: planId, primaryObjectiveId: objectiveId, status: 'ready', revision: 1, scheduledStartAt: now })
  const contentId = await ctx.db.insert('sessionContent', { userId, studySessionId: sessionId, studyPlanRevisionId: planId,
    blueprintRevisionId, objectiveId, revision: 1, status: 'published', createdAt: now })
  const blockId = await ctx.db.insert('sessionContentBlocks', { userId, sessionContentId: contentId, order: 0, kind: 'explanation', content: 'Live teaching block' })
  const courseId = await ctx.db.insert('courses', { userId, folderId: f.folderId, title: 'Live course', status: 'ready', sourceType: 'folder',
    sourceConfidence: { docCount: 1, webPercent: 0 }, pace: 'steady', outlineSections: [], completedSectionCount: 0, totalSectionCount: 1,
    webSearchEnabled: false, createdAt: now, updatedAt: now })
  const sectionId = await ctx.db.insert('courseSections', { userId, courseId, title: 'Live section', order: 0, knowledgeType: 'factual',
    status: 'ready', contentBlocks: [{ type: 'text', content: 'Live teaching section', order: 0 }], masteryLevel: 'new' })
  const quizId = await ctx.db.insert('quizzes', { userId, folderId: f.folderId, title: 'Live quiz', status: 'ready', courseId })
  const questionId = await ctx.db.insert('quizQuestions', { userId, quizId, order: 0, question: 'One plus one?', type: 'free-response', correctAnswer: 'Two' })
  const flashcardRoomId = await ctx.db.insert('flashcardRooms', { userId, folderId: f.folderId, title: 'Live cards', updatedAt: now })
  const versionId = await ctx.db.insert('flashcardRoomVersions', { userId, roomId: flashcardRoomId, title: 'Original version', origin: 'manual', createdAt: now })
  const cardId = await ctx.db.insert('flashcardVersionCards', { userId, roomId: flashcardRoomId, versionId, displayOrder: 0, term: 'Term', definition: 'Definition' })
  await ctx.db.patch(flashcardRoomId, { activeVersionId: versionId })
  const conversationId = await ctx.db.insert('conversations', { userId, folderId: f.folderId, title: 'Audio conversation' })
  const audioRoomId = await ctx.db.insert('audioOverviewRooms', { userId, folderId: f.folderId, conversationId, title: 'Live audio room', createdAt: now, updatedAt: now })
  const overviewId = await ctx.db.insert('audioOverviews', { userId, folderId: f.folderId, roomId: audioRoomId,
    title: 'Live Audio Overview', status: 'ready', turns: [], voiceProfile: { hostA: 'a', hostB: 'b' }, totalDurationMs: 0 })
  const threadId = await ctx.db.insert('learningThreads', { userId, authorityKind: 'v2_mission', learningVoidId: artifactVoidId,
    originalNeed: 'Keep personal work', intent: 'build', availableTime: '15', sourceScope: { kind: 'folder', sourceId: String(f.folderId) },
    evidenceState: 'ready', lifecycle: 'active', revision: 1, createdAt: now, updatedAt: now })
  const plan = await composeAdaptiveActivityPlan({
    activityId: 'lineage-artifact-activity', threadId: String(threadId), boundaryOrdinal: 1, planRevision: 1,
    activityClass: 'non_factual', intent: 'build', objectiveId: null, purpose: 'Keep personal work', reasonCode: 'standalone_diagnostic',
    primitiveSequence: [{ type: 'diagnostic_prompt', action: 'submit_response', props: { prompt: 'Your own plan?', responseFormat: 'short_text', assistance: 'none' } }],
    requiredAction: { kind: 'submit_response', label: 'Save response' }, evaluationContract: { version: 'learn-adaptive.evaluation.v1', kind: 'learner_response', responseFormat: 'short_text', passingScorePercent: null },
    accessibilityMetadata: { heading: 'Starting point', instructions: 'Answer the prompt.', focusTargetTestId: 'learn-primitive-diagnostic-prompt', liveRegionMode: 'polite' },
    pins: { learningVoidId: null, blueprintRevisionId: null, objectiveId: null, sessionContentId: null }, evidenceReferences: [],
    generationInputs: { sessionContentRevision: null, sessionContentInputDigest: null, generatorVersion: null },
    decisionInputs: { intentRevision: 1, routerVersion: 'learn-adaptive.preparing-diagnostic.v1', availableTime: '15', sourceState: 'none', sourceInputs: [], priorActivityId: null, priorAttemptId: null, priorOutcome: null, assistance: 'none', confidence: null },
  })
  const activityId = await ctx.db.insert('learningThreadActivities', {
    userId, threadId, activityId: plan.activityId, boundaryOrdinal: 1, planRevision: 1, activityClass: 'non_factual', status: 'started',
    planVersion: plan.planVersion, replayVersion: plan.replayVersion, contractVersion: plan.contractVersion, rendererVersion: plan.rendererVersion,
    validationVersion: plan.validationVersion, sequenceValidationVersion: plan.sequenceValidationVersion, fallbackVersion: plan.fallbackVersion,
    intent: plan.intent, objectiveId: null, purpose: plan.purpose, reasonCode: plan.reasonCode, primitivePlan: plan.primitivePlan,
    requiredAction: plan.requiredAction, evaluationContract: plan.evaluationContract, fallback: plan.fallback, accessibilityMetadata: plan.accessibilityMetadata,
    learningVoidId: null, blueprintRevisionId: null, sessionContentId: null, evidenceReferences: [], generationInputs: plan.generationInputs,
    decisionInputs: plan.decisionInputs, replacesActivityId: null, canonicalInputSnapshot: plan.canonicalInputSnapshot, inputDigest: plan.inputDigest, createdAt: now, updatedAt: now,
  })
  await ctx.db.patch(threadId, { currentActivityId: activityId })
  const learnerArtifactId = await ctx.db.insert('learningThreadArtifacts', { userId, threadId, activityId, artifactKind: 'plan', revision: 1,
    title: 'Personal plan', summary: 'My own plan', status: 'saved', createdAt: now, updatedAt: now })
  await ctx.db.patch(learnerArtifactId, { r2ObjectKey: await privateAdaptiveArtifactR2Key(userId, learnerArtifactId) })
  const capability = { learningVoidId: artifactVoidId, blueprintRevisionId, objectiveId, blueprintRecordRevision: 1,
    assessmentContractVersion: 'assessment.v1', assessmentContractDigest: 'a'.repeat(64), depth: 'working' as const }
  const familyId = await ctx.db.insert('learnMeasurementFamilies', { ...f.base, ...capability, evidenceStatus: 'available', familyKey: 'family', revision: 1, recordRevision: 1,
    equivalenceVersion: 'equivalence.v1', equivalenceDescriptor: { operation: 'apply', contentCoverage: 'one rule', transferDemand: 'new case', responseModality: 'keyed', scoreScale: 'percent_0_100', criteriaDigest: 'a'.repeat(64), thresholdVersion: 'threshold.v1', rationale: 'Fixture', difficultyPrior: 'unknown' },
    coreFormCount: 3, totalFormCount: 3, validationArtifactDigest: 'a'.repeat(64), status: 'quarantined', reasonCode: 'fixture' })
  const jobId = await ctx.db.insert('learnJobs', { userId, learningVoidId: artifactVoidId, type: 'measurement_fixture', status: 'succeeded', revision: 1, idempotencyKey: 'fixture-job' })
  const itemId = await ctx.db.insert('learnMeasurementItems', { ...f.base, ...capability, evidenceStatus: 'available', familyId, familyRevision: 1,
    itemKey: 'item', revision: 1, caseId: f.caseId, formLabel: 'A', reserve: false, prompt: 'Private measurement prompt', promptDigest: 'a'.repeat(64),
    responseSpec: { kind: 'keyed', version: 'response.v1', maxSelections: 1 }, scoringSpecRevision: 1, scoringSpecDigest: 'b'.repeat(64), generatorVersion: 'generator.v1', generationJobId: jobId,
    inputDigest: 'a'.repeat(64), catalogRevision: 0, supportManifestDigest: 'a'.repeat(64), status: 'candidate' })
  const specId = await ctx.db.insert('learnMeasurementScoringSpecs', { ...f.base, ...capability, evidenceStatus: 'available', itemId, revision: 1, digest: 'b'.repeat(64),
    payload: { kind: 'keyed', acceptedSets: [['answer']], normalizationVersion: 'normalization.v1' }, referenceSolution: 'Private solution',
    scoringBinding: { kind: 'deterministic', engineVersion: 'engine.v1', thresholdVersion: 'threshold.v1', thresholdPercent: 80, transitionVersion: 'learn-v2.mastery-transition.v1' } })
  const publicationValidationId = await ctx.db.insert('learnMeasurementValidations', { ...f.base, ...capability, evidenceStatus: 'available', subject: { kind: 'item', itemId },
    subjectRevision: 1, subjectDigest: 'a'.repeat(64), check: 'publication', decision: 'pass', reasonCode: 'fixture', validatorVersion: 'validator.v1', validatorModel: null,
    promptVersion: 'validation.v1', harnessArtifactDigest: 'a'.repeat(64), comparedCatalogRevision: 0, corpusDigest: 'a'.repeat(64), coverageWatermark: 'coverage.v1' })
  await ctx.db.patch(familyId, { status: 'provisional_equivalent', validationId: publicationValidationId })
  await ctx.db.patch(itemId, { status: 'published', scoringSpecId: specId, publicationValidationId })
  const artifactByKind = {
    session_block: { kind: 'session_block', id: blockId }, document: { kind: 'document', id: f.documentId }, document_chunk: { kind: 'document_chunk', id: f.documentId },
    quiz_question: { kind: 'quiz_question', id: questionId }, section_block: { kind: 'section_block', id: sectionId }, flashcard_version: { kind: 'flashcard_version', id: versionId },
    audio_overview: { kind: 'audio_overview', id: overviewId }, learner_artifact: { kind: 'learner_artifact', id: learnerArtifactId }, measurement_item: { kind: 'measurement_item', id: itemId }, scoring_spec: { kind: 'scoring_spec', id: specId },
  } as const satisfies Record<ArtifactKind, LearnArtifactReference['artifact']>
  const artifact = artifactByKind[kind]
  const payload = kind === 'session_block' ? await sessionBlockContentProjection(ctx, (await ctx.db.get(blockId))!, (await ctx.db.get(contentId))!)
    : kind === 'flashcard_version' ? artifactContentProjection({ kind, version: (await ctx.db.get(versionId))!, cards: [(await ctx.db.get(cardId))!] })
      : kind === 'audio_overview' ? await audioOverviewContentProjection(ctx, (await ctx.db.get(overviewId))!)
        : kind === 'measurement_item' || kind === 'scoring_spec' ? artifactContentProjection({ kind, item: (await ctx.db.get(itemId))!, family: (await ctx.db.get(familyId))!, spec: (await ctx.db.get(specId))! })
          : kind === 'quiz_question' ? artifactContentProjection({ kind, question: (await ctx.db.get(questionId))! })
            : kind === 'section_block' ? await sectionContentProjection(ctx, (await ctx.db.get(sectionId))!)
              : kind === 'learner_artifact' ? artifactContentProjection({ kind, artifact: (await ctx.db.get(learnerArtifactId))! })
                : artifactContentProjection({ kind, document: (await ctx.db.get(f.documentId))! })
  const payloadDigest = await artifactPayloadDigest(payload)
  const revision = kind === 'document' || kind === 'document_chunk' ? 'source.r1' : kind === 'flashcard_version' ? String(versionId)
    : ['session_block', 'learner_artifact', 'measurement_item', 'scoring_spec'].includes(kind) ? '1' : `sha256:${payloadDigest}`
  const reference: LearnArtifactReference = { artifact, key: kind === 'document_chunk' ? LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY : kind === 'section_block' ? 'component-0' : 'whole', revision, payloadDigest }
  const classification: Doc<'learnArtifactLineages'>['classification'] = kind === 'measurement_item' ? 'measurement' : kind === 'scoring_spec' ? 'private_scoring' : 'genuine_personal_work'
  await ctx.db.patch(f.lineageId, { ...reference, classification, authority: classification === 'genuine_personal_work' ? 'personal_authorship' : 'server_producer' })
  const manifestDigest = await sealManifest(ctx, f.lineageId)
  await ctx.db.patch(f.validationId, { payloadDigest, manifestDigest })
  return { ...f, reference, classification, manifestDigest, artifactVoidId, blueprintRevisionId, studyPlanId, planId, sessionId, contentId, blockId,
    courseId, sectionId, quizId, questionId, flashcardRoomId, versionId, cardId, conversationId, audioRoomId, overviewId, threadId, activityId, learnerArtifactId, familyId, itemId, specId }
}

type MatrixFixture = Awaited<ReturnType<typeof prepareMatrix>>
type TestStore = TestConvex<typeof schema>

// These pin fixtures deliberately have unpublished synthetic bindings. Build
// ordinary unenrolled input for consumer probes, then restore those bindings
// before asserting their original graph/pin policy. The real guards still run.
async function ordinaryConsumerFixture<T>(t: TestStore, operation: (ctx: MutationCtx) => Promise<T>): Promise<T> {
  return t.withIdentity(owner).run(async ctx => {
    const catalog = await ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', owner.tokenIdentifier)).unique()
    expect(catalog?.measurementCapability?.enabled).not.toBe(true)
    const rows = await ctx.db.query('learnArtifactLineages').withIndex('by_userId', q => q.eq('userId', owner.tokenIdentifier)).take(201)
    if (rows.length > 200) throw new Error('Fixture exceeds ordinary consumer bound')
    for (const row of rows) await ctx.db.patch(row._id, { nextId: row._id })
    try { return await operation(ctx) }
    finally { for (const row of rows) if (await ctx.db.get(row._id)) await ctx.db.patch(row._id, { nextId: row.nextId }) }
  })
}
function consumerQuery<F extends FunctionReference<'query', 'public' | 'internal'>>(t: TestStore, reference: F, args: FunctionArgs<F>): Promise<FunctionReturnType<F>> {
  return ordinaryConsumerFixture(t, ctx => ctx.runQuery(reference, args))
}
function consumerMutation<F extends FunctionReference<'mutation', 'public' | 'internal'>>(t: TestStore, reference: F, args: FunctionArgs<F>): Promise<FunctionReturnType<F>> {
  return ordinaryConsumerFixture(t, ctx => ctx.runMutation(reference, args))
}

type Revocation = { name: string, kinds?: readonly ArtifactKind[], apply: (t: TestStore, f: MatrixFixture) => Promise<unknown> }
const documentKinds = ['document', 'document_chunk'] as const
const voidKinds = ['session_block', 'learner_artifact', 'measurement_item', 'scoring_spec'] as const
const measurementKinds = ['measurement_item', 'scoring_spec'] as const

const benignUpdates: Revocation[] = [
  { name: 'document indexJobId only (real)', kinds: documentKinds, apply: (t, f) => t.mutation(internal.documents.updateDocumentStatus, { id: f.documentId, status: 'success', indexJobId: 'new-index-job' }) },
  { name: 'document filename (real)', kinds: documentKinds, apply: (t, f) => t.mutation(internal.documents.updateDocumentFilename, { id: f.documentId, filename: 'renamed.txt' }) },
  { name: 'section completion (real)', kinds: ['section_block'], apply: (t, f) => consumerMutation(t, api.courseSections.completeSection, { sectionId: f.sectionId, practiceScore: 80, quizCorrect: 4, quizTotal: 5 }) },
  { name: 'section offline availability (real)', kinds: ['section_block'], apply: (t, f) => consumerMutation(t, api.courseSections.setOfflineAvailable, { sectionId: f.sectionId, offlineAvailable: true }) },
  { name: 'Audio Overview publication (real)', kinds: ['audio_overview'], apply: (t, f) => consumerMutation(t, api.audioOverviews.publishOverview, { id: f.overviewId }) },
  { name: 'flashcard room rename (real)', kinds: ['flashcard_version'], apply: (t, f) => consumerMutation(t, api.flashcardRooms.renameRoom, { roomId: f.flashcardRoomId, title: 'Renamed room' }) },
  { name: 'quiz rename (real)', kinds: ['quiz_question'], apply: (t, f) => consumerMutation(t, api.quizzes.updateQuiz, { quizId: f.quizId, title: 'Renamed quiz' }) },
  { name: 'session start (real)', kinds: ['session_block'], apply: (t, f) => t.withIdentity(owner).mutation(api.learnV2SessionContent.startStudySession, { studySessionId: f.sessionId, expectedSessionRevision: 1, expectedContentRevision: 1, idempotencyKey: 'lineage-benign-start' }) },
  { name: 'thread pause (real)', kinds: ['learner_artifact'], apply: (t, f) => t.withIdentity(owner).mutation(api.learnAdaptive.leaveThread, { threadId: f.threadId, expectedRevision: 1, idempotencyKey: 'lineage-benign-pause' }) },
  // These immutable/dormant records have no operational-update command.
  { name: 'content publication timestamp (injected)', kinds: ['session_block'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.contentId, { publishedAt: 123 })) },
  { name: 'question moderation timestamp (injected)', kinds: ['quiz_question'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.questionId, { flaggedAt: 123 })) },
  { name: 'version card timestamp and label (injected)', kinds: ['flashcard_version'], apply: (t, f) => t.run(async ctx => {
    await ctx.db.patch(f.versionId, { title: 'Organizational label', createdAt: 123 })
    await ctx.db.patch(f.cardId, { updatedAt: 123, sourceFilename: 'renamed.txt' })
  }) },
  { name: 'artifact save timestamps (injected)', kinds: ['learner_artifact'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.learnerArtifactId, { createdAt: 123, updatedAt: 124 })) },
  { name: 'measurement operational metadata (injected)', kinds: measurementKinds, apply: (t, f) => t.run(async ctx => {
    await ctx.db.patch(f.itemId, { createdAt: 123, catalogRevision: 1 })
    await ctx.db.patch(f.specId, { createdAt: 123 })
    await ctx.db.patch(f.familyId, { createdAt: 123, reasonCode: 'operational_note', status: 'empirically_supported' })
  }) },
  { name: 'owning folder rename (real)', kinds: measurementKinds, apply: (t, f) => t.withIdentity(owner).mutation(api.folders.renameFolder, { id: f.folderId, name: 'Renamed measurement folder' }) },
]

const artifactRevocations: Revocation[] = [
  { name: 'record_deleted', apply: (t, f) => t.run(ctx => ctx.db.delete(f.reference.artifact.id)) },
  { name: 'record_foreign', apply: (t, f) => t.run(ctx => ctx.db.patch(f.reference.artifact.id, { userId: foreign.tokenIdentifier })) },
  { name: 'folder_deleted_real', apply: (t, f) => t.withIdentity(owner).mutation(api.folders.deleteFolder, { id: f.folderId }) },
  { name: 'folder_foreign', apply: (t, f) => t.run(ctx => ctx.db.patch(f.folderId, { userId: foreign.tokenIdentifier })) },
  { name: 'lineage_invalidated_zero', apply: (t, f) => t.run(ctx => ctx.db.patch(f.lineageId, { invalidatedAt: 0 })) },
  { name: 'lineage_evidence_unavailable', apply: (t, f) => t.run(ctx => ctx.db.patch(f.lineageId, { evidenceStatus: 'evidence_unavailable' })) },
  { name: 'validation_invalidated_zero', apply: (t, f) => t.run(ctx => ctx.db.patch(f.validationId, { invalidatedAt: 0 })) },
  { name: 'validation_evidence_unavailable', apply: (t, f) => t.run(ctx => ctx.db.patch(f.validationId, { evidenceStatus: 'evidence_unavailable' })) },
  { name: 'void_archived_real', kinds: voidKinds, apply: (t, f) => t.withIdentity(owner).mutation(api.learnV2Lifecycle.transitionLearningVoid, { learningVoidId: f.artifactVoidId, status: 'archived', expectedRevision: 1, idempotencyKey: 'artifact-void-archive' }) },
  { name: 'void_deleted', kinds: voidKinds, apply: (t, f) => t.run(ctx => ctx.db.delete(f.artifactVoidId)) },
  { name: 'void_foreign', kinds: voidKinds, apply: (t, f) => t.run(ctx => ctx.db.patch(f.artifactVoidId, { userId: foreign.tokenIdentifier })) },
  { name: 'document_deleted_real', kinds: documentKinds, apply: (t, f) => t.withIdentity(owner).mutation(api.documents.deleteDocument, { id: f.documentId }) },
  ...(['processing', 'indexing', 'failed'] as const).map(status => ({ name: `document_${status}_real`, kinds: documentKinds,
    apply: (t: TestStore, f: MatrixFixture) => t.mutation(internal.documents.updateDocumentStatus, { id: f.documentId, status }) })),
  { name: 'document_revision_replaced_real', kinds: documentKinds, apply: (t, f) => t.mutation(internal.documents.updateDocumentStatus, { id: f.documentId, status: 'success', sourceRevision: 'source.r2' }) },
  { name: 'document_hash_replaced_real', kinds: documentKinds, apply: (t, f) => t.mutation(internal.documents.updateDocumentStatus, { id: f.documentId, status: 'success', contentHash: 'a'.repeat(64) }) },
  { name: 'document_object_replaced_real', kinds: documentKinds, apply: (t, f) => t.mutation(internal.documents.updateDocumentStatus, { id: f.documentId, status: 'success', r2Key: 'replaced-object' }) },
  { name: 'content_superseded', kinds: ['session_block'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.contentId, { status: 'superseded' })) },
  { name: 'content_deleted', kinds: ['session_block'], apply: (t, f) => t.run(ctx => ctx.db.delete(f.contentId)) },
  { name: 'content_revision_changed', kinds: ['session_block'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.contentId, { revision: 2 })) },
  { name: 'block_payload_changed', kinds: ['session_block'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.blockId, { content: 'Replaced block' })) },
  { name: 'content_rubric_changed', kinds: ['session_block'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.contentId, { assessmentRubricSnapshot: 'Replaced rubric' })) },
  { name: 'session_cancelled', kinds: ['session_block'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.sessionId, { status: 'cancelled' })) },
  { name: 'plan_superseded', kinds: ['session_block'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.planId, { status: 'superseded' })) },
  { name: 'plan_pointer_replaced', kinds: ['session_block'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.studyPlanId, { activeRevisionId: undefined })) },
  { name: 'blueprint_superseded', kinds: ['session_block', ...measurementKinds], apply: (t, f) => t.run(ctx => ctx.db.patch(f.blueprintRevisionId, { status: 'superseded' })) },
  { name: 'quiz_deleted_real', kinds: ['quiz_question'], apply: (t, f) => consumerMutation(t, api.quizzes.deleteQuiz, { quizId: f.quizId }) },
  { name: 'question_deleted_real', kinds: ['quiz_question'], apply: (t, f) => consumerMutation(t, api.quizzes.deleteQuestion, { questionId: f.questionId }) },
  { name: 'question_payload_changed_real', kinds: ['quiz_question'], apply: (t, f) => consumerMutation(t, api.quizzes.updateQuestion, { questionId: f.questionId, question: 'A different question?' }) },
  { name: 'question_answer_changed_real', kinds: ['quiz_question'], apply: (t, f) => consumerMutation(t, api.quizzes.updateQuestion, { questionId: f.questionId, correctAnswer: 'Three' }) },
  { name: 'question_correction_changed_real', kinds: ['quiz_question'], apply: (t, f) => consumerMutation(t, api.contentFlags.flagQuizQuestion, { questionId: f.questionId, correctedAnswer: 'Three', correctedExplanation: 'Revised explanation' }) },
  { name: 'quiz_failed', kinds: ['quiz_question'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.quizId, { status: 'failed' })) },
  { name: 'quiz_tombstone_zero', kinds: ['quiz_question'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.quizId, { deletedAt: 0 })) },
  { name: 'course_deleting_real', kinds: ['quiz_question', 'section_block'], apply: (t, f) => t.mutation(internal.courseDeletion.start, { courseId: f.courseId, userId: owner.tokenIdentifier }) },
  { name: 'course_failed_real', kinds: ['quiz_question', 'section_block'], apply: (t, f) => t.withIdentity(owner).mutation(api.courses.markFailed, { courseId: f.courseId }) },
  { name: 'section_failed_real', kinds: ['section_block'], apply: (t, f) => t.mutation(internal.courseSections.markSectionFailed, { sectionId: f.sectionId }) },
  { name: 'section_payload_changed_real', kinds: ['section_block'], apply: (t, f) => consumerMutation(t, api.courseSections.updateTitle, { sectionId: f.sectionId, title: 'Changed section' }) },
  { name: 'section_blocks_changed', kinds: ['section_block'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.sectionId, { contentBlocks: [{ type: 'text', content: 'Revised teaching body', order: 0 }] })) },
  { name: 'flashcard_room_deleted_real', kinds: ['flashcard_version'], apply: (t, f) => consumerMutation(t, api.flashcardRooms.deleteRoom, { roomId: f.flashcardRoomId }) },
  { name: 'flashcard_room_missing', kinds: ['flashcard_version'], apply: (t, f) => t.run(ctx => ctx.db.delete(f.flashcardRoomId)) },
  { name: 'flashcard_payload_changed', kinds: ['flashcard_version'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.cardId, { definition: 'Replaced version content' })) },
  { name: 'flashcard_prompt_changed', kinds: ['flashcard_version'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.versionId, { prompt: 'Revised prompt' })) },
  { name: 'audio_deleting_real', kinds: ['audio_overview'], apply: (t, f) => consumerMutation(t, api.audioOverviews.deleteOverview, { id: f.overviewId }) },
  { name: 'audio_failed', kinds: ['audio_overview'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.overviewId, { status: 'failed' })) },
  { name: 'audio_room_deleted_real', kinds: ['audio_overview'], apply: (t, f) => t.withIdentity(owner).mutation(api.audioOverviewRooms.remove, { roomId: f.audioRoomId }) },
  { name: 'audio_room_missing', kinds: ['audio_overview'], apply: (t, f) => t.run(ctx => ctx.db.delete(f.audioRoomId)) },
  { name: 'audio_conversation_deleted_real', kinds: ['audio_overview'], apply: (t, f) => t.withIdentity(owner).mutation(api.conversations.deleteConversation, { id: f.conversationId }) },
  { name: 'audio_conversation_archived_zero', kinds: ['audio_overview'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.conversationId, { archivedAt: 0 })) },
  { name: 'audio_payload_changed', kinds: ['audio_overview'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.overviewId, { title: 'Replaced revision' })) },
  { name: 'learner_artifact_deleted_real', kinds: ['learner_artifact'], apply: (t, f) => t.withIdentity(owner).mutation(api.learnAdaptive.deleteArtifact, { threadId: f.threadId, artifactId: f.learnerArtifactId, expectedRevision: 1, idempotencyKey: 'lineage-delete-artifact' }) },
  { name: 'learner_payload_changed_real', kinds: ['learner_artifact'], apply: (t, f) => t.withIdentity(owner).mutation(api.learnAdaptive.saveArtifact, { threadId: f.threadId, activityId: 'lineage-artifact-activity', artifactId: f.learnerArtifactId,
    artifactKind: 'plan', title: 'Revised plan', summary: 'Revised personal work', status: 'saved', expectedRevision: 1, idempotencyKey: 'lineage-edit-artifact' }) },
  { name: 'learner_object_changed', kinds: ['learner_artifact'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.learnerArtifactId, { r2ObjectKey: 'replaced/artifact' })) },
  { name: 'thread_deleting_real', kinds: ['learner_artifact'], apply: (t, f) => t.run(ctx => initiateAdaptiveThreadDeletion(ctx, owner.tokenIdentifier, f.threadId)) },
  { name: 'thread_missing', kinds: ['learner_artifact'], apply: (t, f) => t.run(ctx => ctx.db.delete(f.threadId)) },
  { name: 'thread_rollback', kinds: ['learner_artifact'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.threadId, { lifecycle: 'rollback' })) },
  { name: 'thread_evidence_invalidated', kinds: ['learner_artifact'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.threadId, { evidenceState: 'invalidated' })) },
  { name: 'measurement_retired', kinds: measurementKinds, apply: (t, f) => t.run(ctx => ctx.db.patch(f.itemId, { status: 'retired' })) },
  { name: 'family_retired', kinds: measurementKinds, apply: (t, f) => t.run(ctx => ctx.db.patch(f.familyId, { status: 'retired' })) },
  { name: 'family_quarantined', kinds: measurementKinds, apply: (t, f) => t.run(ctx => ctx.db.patch(f.familyId, { status: 'quarantined' })) },
  { name: 'family_invalidated_zero', kinds: measurementKinds, apply: (t, f) => t.run(ctx => ctx.db.patch(f.familyId, { invalidatedAt: 0 })) },
  { name: 'item_invalidated_zero', kinds: measurementKinds, apply: (t, f) => t.run(ctx => ctx.db.patch(f.itemId, { invalidatedAt: 0 })) },
  { name: 'item_purged', kinds: measurementKinds, apply: (t, f) => t.run(ctx => ctx.db.patch(f.itemId, { evidenceStatus: 'evidence_unavailable', prompt: undefined })) },
  { name: 'measurement_payload_changed', kinds: ['measurement_item'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.itemId, { prompt: 'Replaced private item' })) },
  { name: 'spec_invalidated_zero', kinds: measurementKinds, apply: (t, f) => t.run(ctx => ctx.db.patch(f.specId, { invalidatedAt: 0 })) },
  { name: 'spec_purged', kinds: measurementKinds, apply: (t, f) => t.run(ctx => ctx.db.patch(f.specId, { evidenceStatus: 'evidence_unavailable', payload: undefined, referenceSolution: undefined })) },
  { name: 'spec_payload_changed', kinds: measurementKinds, apply: (t, f) => t.run(ctx => ctx.db.patch(f.specId, { referenceSolution: 'Replaced private solution' })) },
  { name: 'spec_key_changed', kinds: measurementKinds, apply: (t, f) => t.run(ctx => ctx.db.patch(f.specId, { payload: { kind: 'keyed', acceptedSets: [['replaced-key']], normalizationVersion: 'normalization.v1' } })) },
  { name: 'family_equivalence_changed', kinds: measurementKinds, apply: (t, f) => t.run(async ctx => {
    const family = (await ctx.db.get(f.familyId))!
    await ctx.db.patch(f.familyId, { equivalenceDescriptor: { ...family.equivalenceDescriptor, contentCoverage: 'Replaced coverage' } })
  }) },
]

// Real production commands carry the _real suffix. The remaining rows inject
// individual stored states, including zero-valued markers and dormant C1
// records that have no lifecycle writer yet. No scheduled cleanup is run.
const sourceRevocations: Revocation[] = [
  { name: 'source_folder_deleted_real', apply: (t, f) => t.withIdentity(owner).mutation(api.folders.deleteFolder, { id: f.sourceFolderId }) },
  { name: 'source_void_archived_real', apply: (t, f) => t.withIdentity(owner).mutation(api.learnV2Lifecycle.transitionLearningVoid, { learningVoidId: f.learningVoidId, status: 'archived', expectedRevision: 1, idempotencyKey: 'source-void-archive' }) },
  { name: 'source_void_deleted', apply: (t, f) => t.run(ctx => ctx.db.delete(f.learningVoidId)) },
  { name: 'source_document_deleted_real', apply: (t, f) => t.withIdentity(owner).mutation(api.documents.deleteDocument, { id: f.sourceDocumentId! }) },
  ...(['processing', 'indexing', 'failed'] as const).map(status => ({ name: `source_document_${status}_real`, apply: (t: TestStore, f: MatrixFixture) => t.mutation(internal.documents.updateDocumentStatus, { id: f.sourceDocumentId!, status }) })),
  { name: 'source_revision_replaced_real', apply: (t, f) => t.mutation(internal.documents.updateDocumentStatus, { id: f.sourceDocumentId!, status: 'success', sourceRevision: 'source.r2' }) },
  { name: 'source_hash_replaced_real', apply: (t, f) => t.mutation(internal.documents.updateDocumentStatus, { id: f.sourceDocumentId!, status: 'success', contentHash: 'a'.repeat(64) }) },
  { name: 'source_object_replaced_real', apply: (t, f) => t.mutation(internal.documents.updateDocumentStatus, { id: f.sourceDocumentId!, status: 'success', r2Key: 'replaced/source-object' }) },
  { name: 'source_unavailable_real', apply: (t, f) => t.withIdentity(owner).mutation(api.learnV2Sources.markUnavailable, { sourceSnapshotId: f.snapshotId, expectedRevision: 1, idempotencyKey: 'lineage-unavailable-source', reason: 'access_lost' }) },
  { name: 'source_tombstoned_real', apply: (t, f) => t.mutation(internal.learnV2Retention.purgeFolderDocumentSources, { userId: owner.tokenIdentifier, documentId: f.sourceDocumentId! }) },
  { name: 'source_evidence_purged_real', apply: (t, f) => t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: owner.tokenIdentifier, sourceIdentityId: f.identityId }) },
  { name: 'identity_tombstoned_zero', apply: (t, f) => t.run(ctx => ctx.db.patch(f.identityId, { tombstonedAt: 0 })) },
  { name: 'identity_document_pointer_removed', apply: (t, f) => t.run(ctx => ctx.db.patch(f.identityId, { folderDocumentId: undefined })) },
  { name: 'snapshot_evidence_purged_zero', apply: (t, f) => t.run(ctx => ctx.db.patch(f.snapshotId, { evidencePurgedAt: 0 })) },
  { name: 'source_rights_prohibited', apply: (t, f) => t.run(ctx => ctx.db.patch(f.snapshotId, { rightsStatus: 'prohibited' })) },
  { name: 'source_rights_unknown', apply: (t, f) => t.run(ctx => ctx.db.patch(f.snapshotId, { rightsStatus: 'unknown' })) },
  { name: 'source_conflict', apply: (t, f) => t.run(ctx => ctx.db.patch(f.snapshotId, { conflictStatus: 'unresolved' })) },
  { name: 'snapshot_lifecycle_rejected', apply: (t, f) => t.run(ctx => ctx.db.patch(f.snapshotId, { status: 'rejected' })) },
  { name: 'snapshot_record_revision_changed', apply: (t, f) => t.run(ctx => ctx.db.patch(f.snapshotId, { recordRevision: 2 })) },
  { name: 'source_link_invalidated_zero', apply: (t, f) => t.run(ctx => ctx.db.patch(f.linkId, { invalidatedAt: 0 })) },
  { name: 'source_link_unavailable', apply: (t, f) => t.run(ctx => ctx.db.patch(f.linkId, { evidenceStatus: 'evidence_unavailable' })) },
  { name: 'source_link_invalidation_real', apply: (t, f) => t.run(async ctx => {
    const link = await ctx.db.get(f.linkId)
    if (!link?.dependency) throw new Error('Missing dependency')
    const dependency = link.dependency
    const source = dependency.kind === 'snapshot' ? { kind: dependency.kind, id: dependency.sourceSnapshotId }
      : dependency.kind === 'excerpt' ? { kind: dependency.kind, id: dependency.sourceExcerptId }
        : dependency.kind === 'document' ? { kind: dependency.kind, id: dependency.documentId } : { kind: dependency.kind, id: dependency.folderId }
    return invalidateMeasurementSourceBatch(ctx, owner.tokenIdentifier, source)
  }) },
]
const excerptRevocations: Revocation[] = [
  { name: 'excerpt_purged_zero', apply: (t, f) => t.run(ctx => ctx.db.patch(f.excerptId, { evidencePurgedAt: 0 })) },
  { name: 'excerpt_rights_prohibited', apply: (t, f) => t.run(ctx => ctx.db.patch(f.excerptId, { rightsStatus: 'prohibited' })) },
  { name: 'excerpt_body_removed', apply: (t, f) => t.run(ctx => ctx.db.patch(f.excerptId, { excerpt: undefined })) },
]

async function expectMatrixRevoked(t: TestStore, f: MatrixFixture, copy: Fixture) {
  // Assert both checks even if one fails in the deliberate mutation runs.
  for (const target of [f, copy]) await expectSourceRevoked(t, target)
}

async function matrixControl(t: TestStore, f: MatrixFixture) {
  const summary = await t.run(ctx => prepare(ctx, { origin: f, transformation: 'summary' }))
  const copy = await t.run(ctx => prepare(ctx, { origin: summary, transformation: 'rewrite' }))
  for (const target of [f, summary, copy]) expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: target.reference })).toMatchObject({ status: 'bound' })
  return copy
}

describe.each(artifactKinds)('A3 revocation matrix: %s', (kind) => {
  beforeEach(() => { vi.stubEnv('LEARN_V2_ENABLED', 'true') })
  afterEach(() => { vi.unstubAllEnvs() })
  test.each(benignUpdates.filter(row => row.kinds?.includes(kind)).flatMap(update => (['root', 'summary', 'rewrite'] as const).map(target => ({ ...update, target }))))('A4 benign update: $name keeps $target live and preserves registration', async ({ apply, target: targetName }) => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, kind))
    const summary = await t.run(ctx => prepare(ctx, { origin: f, transformation: 'summary' }))
    const rewrite = await t.run(ctx => prepare(ctx, { origin: summary, transformation: 'rewrite' }))
    const asOwner = t.withIdentity(owner)
    for (const target of [f, summary, rewrite]) expect(await asOwner.query(internal.learnV2ArtifactLineage.resolve, { reference: target.reference })).toMatchObject({ status: 'bound' })
    await apply(t, f)
    for (const target of [f, summary, rewrite]) expect.soft(await asOwner.query(internal.learnV2ArtifactLineage.resolve, { reference: target.reference })).toMatchObject({ status: 'bound' })
    const target = targetName === 'root' ? f : targetName === 'summary' ? summary : rewrite
    if (measurementKinds.some(value => value === kind)) {
      await expect(asOwner.mutation(registerInstructional, registration(target))).rejects.toThrow('Artifact lineage unavailable')
      expect(await t.run(ctx => ctx.db.get(f.catalogId))).toMatchObject({ catalogRevision: 0 })
    }
    else {
      await expect.soft(asOwner.mutation(registerInstructional, registration(target))).resolves.toMatchObject({ catalogRevision: 1 })
      expect.soft(await asOwner.query(internal.learnV2ArtifactLineage.resolve, { reference: target.reference })).toMatchObject({ status: 'bound', instructionalRegistered: true })
    }
  })
  test('live control: root and summary preserve their classification and registration policy', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, kind))
    const copy = await matrixControl(t, f)
    if (kind === 'measurement_item' || kind === 'scoring_spec') {
      for (const target of [f, copy]) await expect(t.withIdentity(owner).mutation(registerInstructional, registration(target))).rejects.toThrow('Artifact lineage unavailable')
      expect(await t.run(ctx => ctx.db.get(f.catalogId))).toMatchObject({ catalogRevision: 0 })
    }
    else {
      expect(await t.withIdentity(owner).mutation(registerInstructional, registration(copy))).toMatchObject({ catalogRevision: 1 })
      expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: copy.reference })).toMatchObject({ status: 'bound', instructionalRegistered: true })
    }
  })

  test('live control: the root can register exactly when its classification permits teaching', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, kind))
    await matrixControl(t, f)
    if (kind === 'measurement_item' || kind === 'scoring_spec') {
      await expect(t.withIdentity(owner).mutation(registerInstructional, registration(f))).rejects.toThrow('Artifact lineage unavailable')
      expect(await t.run(ctx => ctx.db.get(f.catalogId))).toMatchObject({ catalogRevision: 0 })
    }
    else expect(await t.withIdentity(owner).mutation(registerInstructional, registration(f))).toMatchObject({ catalogRevision: 1 })
  })

  test.each(artifactRevocations.filter(row => !row.kinds || row.kinds.includes(kind)))('$name revokes root and its summary before cleanup', async ({ apply }) => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, kind))
    const copy = await matrixControl(t, f)
    await apply(t, f)
    await expectMatrixRevoked(t, f, copy)
    expect(await t.run(ctx => ctx.db.get(f.sourceFolderId))).not.toBeNull()
    // Both original records and source links may survive while worker cleanup is pending.
    expect(await t.run(ctx => ctx.db.get(copy.lineageId))).not.toBeNull()
  })

  describe.each(['snapshot', 'excerpt'] as const)('%s backing source', sourceKind => {
    test('rejectSource refuses accepted lifecycle history; markUnavailable is its revocation command', async () => {
      const t = convexTest(schema, modules)
      const f = await t.run(ctx => prepareMatrix(ctx, kind, sourceKind))
      await expect(t.withIdentity(owner).mutation(api.learnV2Sources.rejectSource, { sourceSnapshotId: f.snapshotId, expectedRevision: 1, idempotencyKey: 'lineage-reject-source' })).rejects.toThrow('Invalid source transition')
      await matrixControl(t, f)
      expect(await t.run(ctx => ctx.db.get(f.catalogId))).toMatchObject({ catalogRevision: 0 })
    })
    test.each([...sourceRevocations, ...(sourceKind === 'excerpt' ? excerptRevocations : [])])('$name revokes root and summary before cleanup', async ({ name, apply }) => {
      vi.useFakeTimers()
      const t = convexTest(schema, modules)
      const f = await t.run(ctx => prepareMatrix(ctx, kind, sourceKind))
      const copy = await matrixControl(t, f)
      await apply(t, f)
      // No artifact mutation/cleanup can mask the backing-document check.
      expect(await t.run(ctx => ctx.db.get(f.reference.artifact.id))).not.toBeNull()
      expect(await t.run(ctx => ctx.db.get(f.folderId))).not.toBeNull()
      if (name.includes('replaced')) {
        expect(await t.run(ctx => ctx.db.get(f.linkId))).toMatchObject({ evidenceStatus: 'available' })
        expect(await t.run(ctx => ctx.db.get(f.snapshotId))).toMatchObject({ status: 'user_accepted', recordRevision: 1 })
      }
      await expectMatrixRevoked(t, f, copy)
    })
  })

  describe.each(['document', 'folder'] as const)('direct %s dependency', sourceKind => {
    const rows = sourceKind === 'document'
      ? sourceRevocations.filter(row => row.name === 'source_folder_deleted_real' || row.name.startsWith('source_document_') || row.name === 'source_revision_replaced_real' || row.name.startsWith('source_link_'))
      : sourceRevocations.filter(row => row.name === 'source_folder_deleted_real' || row.name.startsWith('source_link_'))
    test.each(rows)('$name revokes root and summary before cleanup', async ({ apply }) => {
      vi.useFakeTimers()
      const t = convexTest(schema, modules)
      const f = await t.run(ctx => prepareMatrix(ctx, kind, sourceKind))
      const copy = await matrixControl(t, f)
      await apply(t, f)
      await expectMatrixRevoked(t, f, copy)
    })
  })

  test.each(['revision', 'payloadDigest'] as const)('rejects a resealed %s pin that does not match the current artifact', async pin => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, kind))
    await matrixControl(t, f)
    const reference = { ...f.reference, [pin]: pin === 'revision' ? 'unmatched.r2' : '0'.repeat(64) }
    const changed = await t.run(async ctx => {
      await ctx.db.patch(f.lineageId, { ...reference })
      const manifestDigest = await sealManifest(ctx, f.lineageId)
      await ctx.db.patch(f.validationId, { payloadDigest: reference.payloadDigest, manifestDigest })
      return { ...f, reference, manifestDigest }
    })
    // Create fresh origin pins so manifest/origin rejection cannot mask the
    // comparison against the authoritative artifact's unchanged record.
    const copy = await t.run(ctx => prepare(ctx, { origin: changed, transformation: 'summary' }))
    await expectMatrixRevoked(t, changed, copy)
  })

  test('account deletion denies both seams immediately with all artifact rows still present', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, kind))
    const copy = await matrixControl(t, f)
    expect(await t.withIdentity(owner).mutation(internal.accountDeletion.deleteCurrentUser, {})).toMatchObject({ scheduled: true })
    for (const target of [f, copy]) {
      await expect(t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: target.reference })).rejects.toThrow('Account deletion is in progress')
      await expect(t.withIdentity(owner).mutation(registerInstructional, registration(target))).rejects.toThrow('Account deletion is in progress')
    }
    expect(await t.run(ctx => ctx.db.get(f.reference.artifact.id))).not.toBeNull()
    expect(await t.run(ctx => ctx.db.get(f.catalogId))).toMatchObject({ catalogRevision: 0 })
  })
})

async function prepareV2Audio(ctx: MutationCtx) {
  const f = await prepareMatrix(ctx, 'audio_overview')
  const userId = owner.tokenIdentifier
  const now = f.base.createdAt
  const taskId = await ctx.db.insert('tasks', { userId, folderId: f.folderId, type: 'audio-overview-generation', status: 'completed', title: 'Audio job', createdAt: now, updatedAt: now })
  const jobId = await ctx.db.insert('audioOverviewJobs', { userId, taskId, folderId: f.folderId, roomId: f.audioRoomId,
    idempotencyKey: 'audio-lineage-job', capabilityHash: 'a'.repeat(64), status: 'completed', stage: 'complete', completedTurns: 0, createdAt: now, updatedAt: now })
  const base = { userId, jobId, taskId }
  const sourceManifestId = await ctx.db.insert('audioOverviewSourceManifests', { ...base, folderId: f.folderId, schemaVersion: 2,
    revision: 'manifest.r1', contentHash: 'a'.repeat(64), planFingerprint: 'b'.repeat(64), entryCount: 0, frozenAt: now })
  const outlineId = await ctx.db.insert('audioOverviewOutlines', { ...base, narrativeArc: 'An overview', learningObjectiveCount: 0, createdAt: now })
  const claimLedgerId = await ctx.db.insert('audioOverviewClaimLedgers', { ...base, claimCount: 0, supportedClaimCount: 0, createdAt: now })
  const episodeId = await ctx.db.insert('audioOverviewEpisodes', { ...base, folderId: f.folderId, roomId: f.audioRoomId,
    sourceManifestId, outlineId, claimLedgerId, schemaVersion: 2, title: 'Ready episode', model: 'fixture', audioProfileId: 'profile',
    audioProfileVersion: 'profile.v1', renderer: 'fixture', hostAVoice: 'a', hostBVoice: 'b', requestedLengthMinutes: 5, complexity: 'beginner',
    status: 'ready', sceneCount: 0, utteranceCount: 0, compatibilityOverviewId: f.overviewId, createdAt: now, updatedAt: now })
  const mediaId = await ctx.db.insert('audioOverviewAudioArtifacts', { userId, episodeId, jobId, kind: 'final', status: 'published', storageProvider: 'r2',
    objectKey: 'audio/final.wav', checksumSha256: 'a'.repeat(64), byteLength: 10, contentType: 'audio/wav', container: 'wav', sampleRateHz: 24000,
    channelCount: 1, bitsPerSample: 16, durationMs: 10, createdAt: now, publishedAt: now })
  await ctx.db.patch(episodeId, { finalArtifactId: mediaId })
  await ctx.db.patch(f.overviewId, { episodeId, finalArtifactId: mediaId })
  const payloadDigest = await artifactPayloadDigest(await audioOverviewContentProjection(ctx, (await ctx.db.get(f.overviewId))!))
  const reference = { ...f.reference, revision: `sha256:${payloadDigest}`, payloadDigest }
  await ctx.db.patch(f.lineageId, reference)
  const manifestDigest = await sealManifest(ctx, f.lineageId)
  await ctx.db.patch(f.validationId, { payloadDigest, manifestDigest })
  return { ...f, reference, manifestDigest, episodeId, mediaId }
}

type AudioFixture = Awaited<ReturnType<typeof prepareV2Audio>>
const v2AudioRevocations: { name: string, apply: (t: TestStore, f: AudioFixture) => Promise<unknown> }[] = [
  ...(['planning', 'rendering', 'failed', 'deleting'] as const).map(status => ({ name: `episode_${status}`, apply: (t: TestStore, f: AudioFixture) => t.run(ctx => ctx.db.patch(f.episodeId, { status })) })),
  ...(['staged', 'rejected', 'deleting', 'deleted'] as const).map(status => ({ name: `media_${status}`, apply: (t: TestStore, f: AudioFixture) => t.run(ctx => ctx.db.patch(f.mediaId, { status })) })),
  { name: 'episode_missing', apply: (t, f) => t.run(ctx => ctx.db.delete(f.episodeId)) },
  { name: 'episode_foreign', apply: (t, f) => t.run(ctx => ctx.db.patch(f.episodeId, { userId: foreign.tokenIdentifier })) },
  { name: 'media_missing', apply: (t, f) => t.run(ctx => ctx.db.delete(f.mediaId)) },
  { name: 'media_foreign', apply: (t, f) => t.run(ctx => ctx.db.patch(f.mediaId, { userId: foreign.tokenIdentifier })) },
  { name: 'media_object_replaced', apply: (t, f) => t.run(ctx => ctx.db.patch(f.mediaId, { objectKey: 'replaced.wav' })) },
  { name: 'media_hash_replaced', apply: (t, f) => t.run(ctx => ctx.db.patch(f.mediaId, { checksumSha256: 'f'.repeat(64) })) },
  { name: 'delete_overview_real', apply: (t, f) => consumerMutation(t, api.audioOverviews.deleteOverview, { id: f.overviewId }) },
]

describe('A3 revocation matrix: V2 Audio Overview backing episode and media', () => {
  test('A4 benign V2 publication preserves episode/media pins and its derived chain', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareV2Audio(ctx))
    const copy = await matrixControl(t, f)
    await consumerMutation(t, api.audioOverviews.publishOverview, { id: f.overviewId })
    await t.run(async ctx => {
      await ctx.db.patch(f.episodeId, { updatedAt: 123, publishedAt: 124 })
      await ctx.db.patch(f.mediaId, { createdAt: 123, publishedAt: 124 })
    })
    for (const target of [f, copy]) expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: target.reference })).toMatchObject({ status: 'bound' })
    expect(await t.withIdentity(owner).mutation(registerInstructional, registration(copy))).toMatchObject({ catalogRevision: 1 })
  })
  test('live control resolves and registers an owned ready episode and published final media', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareV2Audio(ctx))
    const copy = await matrixControl(t, f)
    expect(await t.withIdentity(owner).mutation(registerInstructional, registration(copy))).toMatchObject({ catalogRevision: 1 })
  })
  test.each(v2AudioRevocations)('$name revokes the original and its derived chain before cleanup', async ({ apply }) => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareV2Audio(ctx))
    const copy = await matrixControl(t, f)
    await apply(t, f)
    await expectMatrixRevoked(t, f, copy)
    expect(await t.run(ctx => ctx.db.get(f.overviewId))).not.toBeNull()
  })
})

describe('A3 revocation matrix: learner artifact factual evidence', () => {
  test.each(['activity_blocked', 'evidence_link_invalidated', 'evidence_link_invalidated_zero', 'thread_evidence_stale'] as const)('%s denies retained artifacts and their copies', async state => {
    const t = convexTest(schema, modules)
    const f = await t.run(async ctx => {
      const fixture = await prepareMatrix(ctx, 'learner_artifact')
      await ctx.db.patch(fixture.activityId, { activityClass: 'factual' })
      return fixture
    })
    const copy = await matrixControl(t, f)
    await t.run(async ctx => {
      if (state === 'activity_blocked') await ctx.db.patch(f.activityId, { status: 'blocked' })
      if (state === 'thread_evidence_stale') await ctx.db.patch(f.threadId, { evidenceState: 'stale' })
      if (state.startsWith('evidence_link_invalidated')) await ctx.db.insert('learnActivityEvidenceLinks', { userId: owner.tokenIdentifier,
        threadId: f.threadId, activityId: f.activityId, sourceSnapshotId: f.snapshotId, boundaryOrdinal: 1, invalidatedAt: state.endsWith('zero') ? 0 : 1, createdAt: f.base.createdAt })
    })
    await expectMatrixRevoked(t, f, copy)
  })
})

// Observe actual reader calls underneath the production budget. In particular,
// indexed iteration must stop before fetching another maximum-size document.
function traceLineageReads(ctx: MutationCtx) {
  const stats = { bytes: 0, charged: 0, documents: 0, requests: 0, ranges: 0 }
  const record = (row: unknown) => {
    if (row === null || row === undefined) return
    const bytes = getDocumentSize(row as Record<string, Value>)
    expect(bytes).toBeLessThanOrEqual(1024 * 1024)
    stats.bytes += bytes
    stats.charged += bytes + 64
    stats.documents++
  }
  const query = <Q extends object>(original: Q): Q => new Proxy(original, {
    get(target, property) {
      if (property === Symbol.asyncIterator) return async function* () {
        const iterator = (target as AsyncIterable<unknown>)[Symbol.asyncIterator]()
        try {
          while (true) {
            stats.requests++
            const next = await iterator.next()
            if (next.done) return
            record(next.value)
            yield next.value
          }
        }
        finally { await iterator.return?.() }
      }
      const method: unknown = Reflect.get(target, property)
      if (typeof method !== 'function') throw new Error('Unexpected query operation')
      return (...args: unknown[]) => query(Reflect.apply(method, target, args) as object)
    },
  })
  const db = new Proxy(ctx.db, {
    get(target, property) {
      const method: unknown = Reflect.get(target, property)
      if (typeof method !== 'function') return method
      if (property === 'get') return async (...args: unknown[]) => {
        stats.requests++
        stats.ranges++
        const row: unknown = await Reflect.apply(method, target, args)
        record(row)
        return row
      }
      if (property === 'query') return (...args: unknown[]) => {
        stats.ranges++
        return query(Reflect.apply(method, target, args) as object)
      }
      return method.bind(target)
    },
  })
  return { ctx: { ...ctx, db }, stats }
}

async function tracedLookup(t: TestStore, f: Fixture, mode: 'resolve' | 'register') {
  let stats = { bytes: 0, charged: 0, documents: 0, requests: 0, ranges: 0 }
  let status: 'bound' | 'unavailable' = 'unavailable'
  const rollback = 'Rollback successful budget probe'
  try {
    await t.withIdentity(owner).run(async ctx => {
      const traced = traceLineageReads(ctx)
      stats = traced.stats
      if (mode === 'resolve') status = (await resolveArtifactLineageForOwner(traced.ctx, owner.tokenIdentifier, { reference: f.reference })).status
      else {
        await registerInstructionalArtifactForOwner(traced.ctx, owner.tokenIdentifier, registration(f))
        status = 'bound'
        // Measure registration's extra auth/catalogue reads without persisting
        // its publication or changing the validation used by the next probe.
        throw new Error(rollback)
      }
    })
  }
  catch (error) {
    if (error instanceof ArtifactProjectionBudgetError) expect(error.data.reasonCode).toBe('projection_exceeds_budget')
    else if (!(error instanceof Error) || ![rollback, 'Artifact lineage unavailable'].includes(error.message)) throw error
  }
  return { status, ...stats }
}

async function setCoursePadding(t: TestStore, f: MatrixFixture, bytes: number) {
  await t.withIdentity(owner).mutation(api.courses.updateOutline, { courseId: f.courseId,
    outlineSections: [{ title: 'Instructional outline', description: 'x'.repeat(bytes), knowledgeType: 'factual', order: 0 }], totalSectionCount: 1 })
}

async function prepareBudgetGraph(t: TestStore, count: 4 | 16, sectionBytes = 0) {
  const fixtures: MatrixFixture[] = []
  for (let index = 0; index < count; index++) {
    const f = await t.run(async (ctx: MutationCtx) => {
      const f = await prepareMatrix(ctx, 'section_block')
      const scenarioFingerprint = index.toString(16).padStart(64, '0')
      const solutionFingerprint = (index + 32).toString(16).padStart(64, '0')
      await ctx.db.patch(f.caseId, { scenarioFingerprint, solutionFingerprint })
      const binding = await ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', f.lineageId)).unique()
      await ctx.db.patch(binding!._id, { scenarioFingerprint, solutionFingerprint })
      if (sectionBytes) {
        await ctx.db.patch(f.sectionId, { contentBlocks: [{ type: 'text', content: 's'.repeat(sectionBytes), order: 0 }] })
        const payloadDigest = await artifactPayloadDigest(await sectionContentProjection(ctx, (await ctx.db.get(f.sectionId))!))
        f.reference = { ...f.reference, payloadDigest, revision: `sha256:${payloadDigest}` }
        await ctx.db.patch(f.lineageId, f.reference)
        await ctx.db.patch(f.validationId, { payloadDigest })
      }
      return f
    })
    await setCoursePadding(t, f, 0)
    fixtures.push(f)
  }
  for (let index = count - 1; index >= 0; index--) {
    const f = fixtures[index]!
    // Exactly sixteen nodes, eight root origins, and a longest path of two.
    const origins = index === 0 ? fixtures.slice(1, 9) : count === 16 && index <= 7 ? [fixtures[index + 8]!] : []
    await t.run(async ctx => {
      for (const origin of origins) await ctx.db.insert('learnArtifactLineageOrigins', { ...f.base, lineageId: f.lineageId,
        originLineageId: origin.lineageId, originRevision: origin.reference.revision, originPayloadDigest: origin.reference.payloadDigest,
        originManifestDigest: origin.manifestDigest, classification: origin.classification, transformation: 'summary' })
      if (origins.length) await ctx.db.patch(f.lineageId, { originCount: origins.length, derivation: 'derived', authority: 'server_producer' })
      f.manifestDigest = await sealManifest(ctx, f.lineageId)
      await ctx.db.patch(f.validationId, { manifestDigest: f.manifestDigest })
    })
  }
  return fixtures
}

describe('A4 graph-wide read budget', () => {
  test('a realistic sixteen-course graph resolves and registers below budget', async () => {
    const t = convexTest(schema, modules)
    const graph = await prepareBudgetGraph(t, 16, 12_000)
    for (const f of graph) await setCoursePadding(t, f, 8_000)
    for (const mode of ['resolve', 'register'] as const) {
      const result = await tracedLookup(t, graph[0]!, mode)
      expect(result).toMatchObject({ status: 'bound' })
      expect(result.bytes).toBeGreaterThan(300_000)
      expect(result.charged).toBeLessThan(ARTIFACT_LINEAGE_READ_BYTES - 1024 * 1024)
    }
    expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: graph[0]!.reference })).toMatchObject({ status: 'bound' })
    expect(await t.withIdentity(owner).mutation(registerInstructional, registration(graph[0]!))).toMatchObject({ catalogRevision: 1 })
  })

  test('the A4 depth-two, eight-origin, sixteen-course graph fails closed before 4 MiB', async () => {
    const t = convexTest(schema, modules)
    const graph = await prepareBudgetGraph(t, 16, 200_000)
    for (const f of graph) await setCoursePadding(t, f, 940_000)
    for (const mode of ['resolve', 'register'] as const) {
      const result = await tracedLookup(t, graph[0]!, mode)
      expect.soft(result).toMatchObject({ status: 'unavailable' })
      expect.soft(result.bytes).toBeLessThan(ARTIFACT_LINEAGE_READ_BYTES)
      expect.soft(result.documents).toBeLessThan(100)
    }
    await expectSourceRevoked(t, graph[0]!)
  })

  test.each(['resolve', 'register'] as const)('%s admits the exact reservation boundary and denies one extra byte', async mode => {
    const t = convexTest(schema, modules)
    const graph = await prepareBudgetGraph(t, 4)
    const root = graph[0]!
    const baseline = await tracedLookup(t, root, mode)
    expect(baseline.status).toBe('bound')
    const boundary = ARTIFACT_LINEAGE_READ_BYTES - (1024 * 1024 + 64)
    const padding = boundary - baseline.charged
    const perCourse = Math.floor(padding / graph.length)
    for (const [index, f] of graph.entries()) await setCoursePadding(t, f, perCourse + (index === 0 ? padding % graph.length : 0))
    const exact = await tracedLookup(t, root, mode)
    expect(exact).toMatchObject({ status: 'bound', charged: boundary, documents: baseline.documents, requests: baseline.requests })
    await setCoursePadding(t, root, perCourse + padding % graph.length + 1)
    const over = await tracedLookup(t, root, mode)
    expect.soft(over.status).toBe('unavailable')
    expect.soft(over.requests).toBeLessThan(exact.requests)
    expect.soft(over.bytes).toBeLessThan(ARTIFACT_LINEAGE_READ_BYTES)
    expect(await t.run(ctx => ctx.db.get(root.catalogId))).toMatchObject({ catalogRevision: 0 })
    expect(await t.run(ctx => ctx.db.get(root.lineageId))).not.toHaveProperty('publication')
    expect(await t.run(ctx => ctx.db.get(root.caseId))).toMatchObject({ usageClass: 'unknown' })
  })
})

// A5: compare real consumer payloads independently of the pin implementation.
// Historical version rows and dormant measurement inventory have no edit API;
// their content edits are explicitly injected, never described as commands.
const operationalFields = new Set(['_creationTime', 'createdAt', 'updatedAt', 'publishedAt', 'completedAt', 'flaggedAt', 'flagged',
  'status', 'evidenceStatus', 'reasonCode', 'catalogRevision', 'filename', 'sourceFilename', 'sourceFilenames', 'indexJobId', 'taskId',
  'failureReason', 'providerModel', 'providerRequestId', 'model', 'origin', 'cardCount', 'requestedCardCount',
  'offlineAvailable', 'masteryLevel', 'practiceScore', 'consecutiveReviewPasses', 'reviewHistory', 'shareToken', 'isPublic'])
function consumerContent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(consumerContent)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key, child]) => !operationalFields.has(key) && child !== undefined).map(([key, child]) => [key, consumerContent(child)]))
  return value
}
function withoutLabels<T extends { title: string }>(record: T) {
  const { title: _label, ...content } = record
  return content
}
async function currentContent(ctx: MutationCtx, f: MatrixFixture) {
  switch (f.reference.artifact.kind) {
    case 'session_block': return sessionBlockContentProjection(ctx, (await ctx.db.get(f.blockId))!, (await ctx.db.get(f.contentId))!)
    case 'document': case 'document_chunk': return artifactContentProjection({ kind: f.reference.artifact.kind, document: (await ctx.db.get(f.documentId))! })
    case 'quiz_question': return artifactContentProjection({ kind: 'quiz_question', question: (await ctx.db.get(f.questionId))! })
    case 'section_block': return sectionContentProjection(ctx, (await ctx.db.get(f.sectionId))!)
    case 'flashcard_version': return artifactContentProjection({ kind: 'flashcard_version', version: (await ctx.db.get(f.versionId))!,
      cards: await ctx.db.query('flashcardVersionCards').withIndex('by_versionId', q => q.eq('versionId', f.versionId)).take(201) })
    case 'audio_overview': return audioOverviewContentProjection(ctx, (await ctx.db.get(f.overviewId))!)
    case 'learner_artifact': return artifactContentProjection({ kind: 'learner_artifact', artifact: (await ctx.db.get(f.learnerArtifactId))! })
    case 'measurement_item': case 'scoring_spec': return artifactContentProjection({ kind: f.reference.artifact.kind,
      item: (await ctx.db.get(f.itemId))!, family: (await ctx.db.get(f.familyId))!, spec: (await ctx.db.get(f.specId))! })
  }
}
async function repinContent<F extends MatrixFixture>(t: TestStore, f: F): Promise<F> {
  return t.run(async ctx => {
    const payloadDigest = await artifactPayloadDigest(await currentContent(ctx, f))
    const reference = { ...f.reference, payloadDigest, revision: f.reference.revision.startsWith('sha256:') ? `sha256:${payloadDigest}` : f.reference.revision }
    await ctx.db.patch(f.lineageId, reference)
    const manifestDigest = await sealManifest(ctx, f.lineageId)
    await ctx.db.patch(f.validationId, { payloadDigest, manifestDigest })
    return { ...f, reference, manifestDigest }
  })
}
async function readConsumerContent(t: TestStore, f: MatrixFixture) {
  const asOwner = t.withIdentity(owner)
  switch (f.reference.artifact.kind) {
    case 'session_block': {
      const result = await asOwner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: f.sessionId })
      expect(result).not.toBeNull()
      return consumerContent(result)
    }
    case 'document': case 'document_chunk': return consumerContent(await t.query(internal.documents.getDocument, { id: f.documentId }))
    case 'quiz_question': {
      const result = await consumerQuery(t, api.quizzes.getWithQuestions, { id: f.quizId })
      expect(result).not.toBeNull()
      return consumerContent(result!.questions.find(q => q._id === f.questionId))
    }
    case 'section_block': {
      const section = await consumerQuery(t, api.courseSections.get, { id: f.sectionId })
      expect(section).not.toBeNull()
      expect(await asOwner.query(api.courses.get, { id: f.courseId })).not.toBeNull()
      const links = []
      for (const block of section!.contentBlocks) {
        if (!block.entityId || block.type === 'text') continue
        if (block.type === 'quiz') {
          const data = await consumerQuery(t, api.quizzes.getWithQuestions, { id: block.entityId as Id<'quizzes'> })
          links.push(data?.questions)
        }
        else if (block.type === 'flashcard') {
          const data = await consumerQuery(t, api.flashcardRooms.getRoom, { roomId: block.entityId as Id<'flashcardRooms'> })
          links.push(data?.cards)
        }
        else links.push(await consumerQuery(t, api.audioOverviews.getCourseScopedOverview, { id: block.entityId as Id<'audioOverviews'> }))
      }
      return consumerContent({ section, links })
    }
    case 'flashcard_version': {
      const data = await consumerQuery(t, api.flashcardRooms.getRoomVersion, { versionId: f.versionId })
      expect(data).not.toBeNull()
      return consumerContent({ version: withoutLabels(data!.version), cards: data!.cards })
    }
    case 'audio_overview': return consumerContent(await consumerQuery(t, api.audioOverviews.getWithTurns, { id: f.overviewId }))
    case 'learner_artifact': {
      const data = await asOwner.query(api.learnAdaptive.listThreadArtifacts, { threadId: f.threadId })
      const artifact = data.find(a => a.id === f.learnerArtifactId)
      expect(artifact).toBeDefined()
      const { historical: _historical, readOnly: _readOnly, evidenceLabel: _evidenceLabel, ...content } = artifact!
      return consumerContent(content)
    }
    case 'measurement_item': case 'scoring_spec':
      // No measurement/scoring reader is enabled. Inspect the actual C1 stored
      // union consumed by the future internal reader, without a public facade.
      return consumerContent(await t.run(async ctx => ({ item: await ctx.db.get(f.itemId), family: await ctx.db.get(f.familyId), spec: await ctx.db.get(f.specId) })))
  }
}
async function expectDifferential(t: TestStore, f: MatrixFixture, apply: () => Promise<unknown>, changes: boolean,
  read = () => readConsumerContent(t, f)) {
  const before = await read()
  const digest = await t.run(async ctx => artifactPayloadDigest(await currentContent(ctx, f)))
  expect(digest).toBe(f.reference.payloadDigest)
  const summary = await t.run(ctx => prepare(ctx, { origin: f, transformation: 'summary' }))
  const rewrite = await t.run(ctx => prepare(ctx, { origin: summary, transformation: 'rewrite' }))
  for (const target of [f, summary, rewrite]) expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: target.reference })).toMatchObject({ status: 'bound' })
  await apply()
  const after = await read()
  const nextDigest = await t.run(async ctx => artifactPayloadDigest(await currentContent(ctx, f)))
  expect(JSON.stringify(after) !== JSON.stringify(before)).toBe(changes)
  expect(nextDigest !== digest).toBe(changes)
  for (const target of [f, summary, rewrite]) expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: target.reference })).toMatchObject({ status: changes ? 'unavailable' : 'bound' })
  if (changes) await expectSourceRevoked(t, rewrite)
}

const differentialEdits: Revocation[] = [
  { name: 'document revision (real)', kinds: documentKinds, apply: (t, f) => t.mutation(internal.documents.updateDocumentStatus, { id: f.documentId, status: 'success', sourceRevision: 'source.r2' }) },
  { name: 'document hash (real)', kinds: documentKinds, apply: (t, f) => t.mutation(internal.documents.updateDocumentStatus, { id: f.documentId, status: 'success', contentHash: 'a'.repeat(64) }) },
  { name: 'document object (real)', kinds: documentKinds, apply: (t, f) => t.mutation(internal.documents.updateDocumentStatus, { id: f.documentId, status: 'success', r2Key: 'replaced/document' }) },
  { name: 'question edit (real)', kinds: ['quiz_question'], apply: (t, f) => consumerMutation(t, api.quizzes.updateQuestion, { questionId: f.questionId, question: 'Two plus two?', correctAnswer: 'Four', explanation: 'Addition' }) },
  { name: 'question correction (real)', kinds: ['quiz_question'], apply: (t, f) => consumerMutation(t, api.contentFlags.flagQuizQuestion, { questionId: f.questionId, correctedAnswer: 'Corrected answer', correctedExplanation: 'Corrected explanation' }) },
  { name: 'section blocks (real)', kinds: ['section_block'], apply: (t, f) => consumerMutation(t, internal.courseSections.markReady, { sectionId: f.sectionId, contentBlocks: [{ type: 'text', order: 0, content: 'Replacement teaching' }] }) },
  { name: 'section generation (real)', kinds: ['section_block'], apply: (t, f) => consumerMutation(t, api.courseSections.finalizeSectionGeneration, { sectionId: f.sectionId, textContent: 'New generated section', quizData: { title: 'Embedded Quiz', questions: [{ order: 0, type: 'free-response', question: 'Generated question', correctAnswer: 'Generated answer' }] }, flashcardData: { title: 'Embedded cards', cards: [{ term: 'Generated term', definition: 'Generated definition' }] } }) },
  { name: 'section title (real)', kinds: ['section_block'], apply: (t, f) => consumerMutation(t, api.courseSections.updateTitle, { sectionId: f.sectionId, title: 'New instructional heading' }) },
  { name: 'section knowledge type (real)', kinds: ['section_block'], apply: (t, f) => consumerMutation(t, api.courseSections.updateKnowledgeType, { sectionId: f.sectionId, knowledgeType: 'conceptual' }) },
  { name: 'block edit (injected immutable row)', kinds: ['session_block'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.blockId, { content: 'A different explanation' })) },
  { name: 'version card edit (injected immutable row)', kinds: ['flashcard_version'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.cardId, { term: 'New term', definition: 'New definition' })) },
  { name: 'version card addition (injected immutable row)', kinds: ['flashcard_version'], apply: (t, f) => t.run(ctx => ctx.db.insert('flashcardVersionCards', { userId: owner.tokenIdentifier, versionId: f.versionId, roomId: f.flashcardRoomId, displayOrder: 1, term: 'Second', definition: 'Card' })) },
  { name: 'legacy audio text (injected retired writer)', kinds: ['audio_overview'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.overviewId, { title: 'A different instructional title' })) },
  { name: 'artifact edit (real)', kinds: ['learner_artifact'], apply: (t, f) => t.withIdentity(owner).mutation(api.learnAdaptive.saveArtifact, { threadId: f.threadId, activityId: 'lineage-artifact-activity', artifactId: f.learnerArtifactId,
    artifactKind: 'plan', title: 'Revised plan', summary: 'A revised learner plan', status: 'saved', expectedRevision: 1, idempotencyKey: 'lineage-differential-edit' }) },
  { name: 'item prompt (injected dormant writer)', kinds: measurementKinds, apply: (t, f) => t.run(ctx => ctx.db.patch(f.itemId, { prompt: 'A different held-out prompt' })) },
  { name: 'scoring solution (injected dormant writer)', kinds: measurementKinds, apply: (t, f) => t.run(ctx => ctx.db.patch(f.specId, { referenceSolution: 'A different private solution' })) },
  { name: 'scoring payload (injected dormant writer)', kinds: measurementKinds, apply: (t, f) => t.run(ctx => ctx.db.patch(f.specId, { payload: { kind: 'keyed', acceptedSets: [['new answer']], normalizationVersion: 'normalization.v1' } })) },
  { name: 'family equivalence (injected dormant writer)', kinds: measurementKinds, apply: (t, f) => t.run(async ctx => {
    const family = (await ctx.db.get(f.familyId))!
    await ctx.db.patch(f.familyId, { equivalenceDescriptor: { ...family.equivalenceDescriptor, rationale: 'Different equivalence rationale' } })
  }) },
]

describe.each(artifactKinds)('A5 consumer differential: %s', (kind) => {
  beforeEach(() => { vi.stubEnv('LEARN_V2_ENABLED', 'true'); vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000) })
  afterEach(() => { vi.unstubAllEnvs() })
  test.each(differentialEdits.filter(row => row.kinds?.includes(kind)))('$name changes content and pin and denies the chain', async ({ apply }) => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, kind))
    await expectDifferential(t, f, () => apply(t, f), true)
  })
  test.each(benignUpdates.filter(row => !row.kinds || row.kinds.includes(kind)))('$name preserves consumer content, pin and binding', async ({ apply }) => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, kind))
    await expectDifferential(t, f, () => apply(t, f), false)
  })
})

async function prepareLinkedSection(t: TestStore, corrected = false) {
  const f = await t.run(async ctx => {
    const f = await prepareMatrix(ctx, 'section_block')
    const activeCardId = await ctx.db.insert('flashcardRoomCards', { userId: owner.tokenIdentifier, roomId: f.flashcardRoomId, displayOrder: 0, term: 'First term', definition: 'First definition' })
    await ctx.db.patch(f.sectionId, { status: 'completed', contentBlocks: [
      { type: 'text', content: 'Section teaching', order: 0 }, { type: 'quiz', entityId: f.quizId, entityType: 'quiz', order: 1 },
      { type: 'flashcard', entityId: f.flashcardRoomId, entityType: 'flashcard', order: 2 }, { type: 'audio', entityId: f.overviewId, entityType: 'audio', order: 3 },
    ] })
    return { ...f, activeCardId }
  })
  if (corrected) {
    await consumerMutation(t, api.contentFlags.flagQuizQuestion, { questionId: f.questionId, correctedAnswer: 'Correction' })
    await consumerMutation(t, api.contentFlags.flagFlashcard, { cardId: f.activeCardId, correctedDefinition: 'Correction' })
  }
  return repinContent(t, f)
}
type LinkedSection = Awaited<ReturnType<typeof prepareLinkedSection>>
const linkedSectionChanges: Array<{ name: string, corrected?: boolean, changes: boolean, apply: (t: TestStore, f: LinkedSection) => Promise<unknown> }> = [
  { name: 'Quiz addition', changes: true, apply: (t, f) => consumerMutation(t, api.quizzes.addQuestion, { quizId: f.quizId, type: 'free-response', questionText: 'New embedded question?', correctAnswer: 'New answer' }) },
  { name: 'Quiz edit', changes: true, apply: (t, f) => consumerMutation(t, api.quizzes.updateQuestion, { questionId: f.questionId, question: 'Changed question', correctAnswer: 'Changed answer' }) },
  { name: 'Quiz correction', changes: true, apply: (t, f) => consumerMutation(t, api.contentFlags.flagQuizQuestion, { questionId: f.questionId, correctedAnswer: 'Corrected', correctedExplanation: 'Corrected reasoning' }) },
  { name: 'Quiz uncorrection', corrected: true, changes: true, apply: (t, f) => consumerMutation(t, api.contentFlags.unflagQuizQuestion, { questionId: f.questionId }) },
  { name: 'Quiz removal', changes: true, apply: (t, f) => consumerMutation(t, api.quizzes.deleteQuestion, { questionId: f.questionId }) },
  { name: 'card addition', changes: true, apply: (t, f) => consumerMutation(t, api.flashcardRooms.createCard, { roomId: f.flashcardRoomId, term: 'Second', definition: 'Another card' }) },
  { name: 'card edit', changes: true, apply: (t, f) => consumerMutation(t, api.flashcardRooms.updateCard, { cardId: f.activeCardId, term: 'Changed term', definition: 'Changed definition' }) },
  { name: 'card correction', changes: true, apply: (t, f) => consumerMutation(t, api.contentFlags.flagFlashcard, { cardId: f.activeCardId, correctedDefinition: 'Corrected definition' }) },
  { name: 'card uncorrection', corrected: true, changes: true, apply: (t, f) => consumerMutation(t, api.contentFlags.unflagFlashcard, { cardId: f.activeCardId }) },
  { name: 'card removal', changes: true, apply: (t, f) => consumerMutation(t, api.flashcardRooms.deleteCard, { cardId: f.activeCardId }) },
  { name: 'card generation', changes: true, apply: (t, f) => consumerMutation(t, api.flashcardRooms.generateRoomCards, { roomId: f.flashcardRoomId, origin: 'manual', cards: [{ term: 'Generated', definition: 'Generated definition' }] }) },
  { name: 'version restore', changes: true, apply: async (t, f) => {
    await t.run(ctx => ctx.db.patch(f.flashcardRoomId, { activeVersionId: undefined }))
    return consumerMutation(t, api.flashcardRooms.restoreRoomVersion, { roomId: f.flashcardRoomId, versionId: f.versionId })
  } },
  { name: 'Quiz rename', changes: false, apply: (t, f) => consumerMutation(t, api.quizzes.updateQuiz, { quizId: f.quizId, title: 'Organizational label' }) },
  { name: 'room rename', changes: false, apply: (t, f) => consumerMutation(t, api.flashcardRooms.renameRoom, { roomId: f.flashcardRoomId, title: 'Organizational label' }) },
  { name: 'share publication', changes: false, apply: (t, f) => consumerMutation(t, api.audioOverviews.publishOverview, { id: f.overviewId }) },
  { name: 'section review', changes: false, apply: (t, f) => consumerMutation(t, api.courseSections.reviewSection, { sectionId: f.sectionId, practiceScore: 80, quizCorrect: 1, quizTotal: 1 }) },
  { name: 'course pace', changes: false, apply: (t, f) => t.withIdentity(owner).mutation(api.courses.updatePace, { courseId: f.courseId, pace: 'relaxed' }) },
  { name: 'offline availability', changes: false, apply: (t, f) => consumerMutation(t, api.courseSections.setOfflineAvailable, { sectionId: f.sectionId, offlineAvailable: true }) },
  { name: 'linked audio content (retired writer injected)', changes: true, apply: (t, f) => t.run(ctx => ctx.db.patch(f.overviewId, { title: 'New audio teaching' })) },
]
describe('A5 linked section consumer differential', () => {
  test.each(linkedSectionChanges)('$name changes the pin iff consumer teaching changes', async ({ corrected, changes, apply }) => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const f = await prepareLinkedSection(t, corrected)
    await expectDifferential(t, f, () => apply(t, f), changes)
  })
  test('card reorder follows both online display order and offline payload', async () => {
    const t = convexTest(schema, modules)
    let f = await prepareLinkedSection(t)
    const { cardId } = await consumerMutation(t, api.flashcardRooms.createCard, { roomId: f.flashcardRoomId, term: 'Second', definition: 'Another card' })
    f = await repinContent(t, f)
    await expectDifferential(t, f, () => consumerMutation(t, api.flashcardRooms.reorderCards, { roomId: f.flashcardRoomId,
      order: [{ cardId: f.activeCardId, displayOrder: 1 }, { cardId, displayOrder: 0 }] }), true)
  })
})

const alignmentCapability = 'c'.repeat(43)
async function preparePlaybackDifferential(t: TestStore, ready = true) {
  const f = await t.run(async ctx => {
    const f = await prepareV2Audio(ctx)
    const e = (await ctx.db.get(f.episodeId))!
    const base = { userId: owner.tokenIdentifier, jobId: e.jobId, createdAt: f.base.createdAt }
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(alignmentCapability)))
    const capabilityHash = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    await ctx.db.patch(e.jobId, { capabilityHash })
    const entryId = await ctx.db.insert('audioOverviewSourceManifestEntries', { ...base, manifestId: e.sourceManifestId, order: 0,
      sourceId: 'source-one', documentId: f.documentId, revision: 'source.r1', contentHash: 'f'.repeat(64), objectKey: 'owned/source.r1', displayReference: 'Source One' })
    const objectiveId = await ctx.db.insert('audioOverviewLearningObjectives', { ...base, outlineId: e.outlineId, order: 0, text: 'Learn one idea' })
    const outlineSourceId = await ctx.db.insert('audioOverviewOutlineSources', { ...base, outlineId: e.outlineId, order: 0, manifestEntryId: entryId })
    const claimId = await ctx.db.insert('audioOverviewClaims', { ...base, ledgerId: e.claimLedgerId, order: 0, claimId: 'claim-one', text: 'A supported claim', status: 'supported' })
    const claimSourceId = await ctx.db.insert('audioOverviewClaimSources', { ...base, ledgerId: e.claimLedgerId, claimRecordId: claimId, manifestEntryId: entryId })
    const sceneId = await ctx.db.insert('audioOverviewScenes', { episodeId: e._id, jobId: e.jobId, userId: e.userId,
      order: 0, title: 'Opening', narrativePurpose: 'Introduce the idea', targetDurationMs: 10, status: 'ready', currentAttempt: 1, updatedAt: base.createdAt })
    const utteranceId = await ctx.db.insert('audioOverviewUtterances', { ...base, episodeId: e._id, sceneId,
      order: 0, sceneOrder: 0, speaker: 'host_a', text: 'One', emotionalIntent: 'curious', deliveryIntent: 'clear', pauseAfterMs: 1 })
    const utteranceSourceId = await ctx.db.insert('audioOverviewUtteranceSources', { ...base, episodeId: e._id, utteranceId, manifestEntryId: entryId })
    const utteranceClaimId = await ctx.db.insert('audioOverviewUtteranceClaims', { ...base, episodeId: e._id, utteranceId, claimRecordId: claimId })
    const alignmentId = await ctx.db.insert('audioOverviewAlignments', { ...base, episodeId: e._id, artifactId: f.mediaId,
      status: 'pending', segmentCount: 0, updatedAt: base.createdAt })
    await ctx.db.patch(e._id, { alignmentId })
    return { ...f, jobId: e.jobId, sourceManifestId: e.sourceManifestId, outlineId: e.outlineId, claimLedgerId: e.claimLedgerId,
      entryId, objectiveId, outlineSourceId, claimId, claimSourceId, sceneId, utteranceId, utteranceSourceId, utteranceClaimId, alignmentId }
  })
  await t.run(async ctx => {
    const job = (await ctx.db.get(f.jobId))!
    const episode = (await ctx.db.get(f.episodeId))!
    const entries = await ctx.db.query('audioOverviewSourceManifestEntries').withIndex('by_manifestId_and_order', q => q.eq('manifestId', episode.sourceManifestId)).take(50)
    const documents = []
    for (const entry of entries) {
      const document = (await ctx.db.get(entry.documentId))!
      documents.push({ documentId: document._id, folderId: document.folderId, filename: document.filename, r2Key: document.r2Key, sourceRevision: document.sourceRevision, contentHash: document.contentHash })
    }
    await ctx.db.patch(job.taskId, { audioOverviewRequest: { scope: { mode: 'explicit', documentIds: documents.map(document => document.documentId) }, documents, preferences: { lengthMinutes: 5, complexity: 'beginner' }, voiceProfile: { hostA: 'asteria', hostB: 'orion' }, quotaDate: '2026-09-03' } })
  })
  await consumerMutation(t, api.audioOverviewV2.appendAlignmentSegments, { jobId: f.jobId, capability: alignmentCapability, alignmentId: f.alignmentId,
    segments: [{ utteranceId: f.utteranceId, wordIndex: 0, word: 'One', startMs: 0, endMs: 4 }] })
  if (ready) await consumerMutation(t, api.audioOverviewV2.completeAlignment, { jobId: f.jobId, capability: alignmentCapability, alignmentId: f.alignmentId })
  return repinContent(t, f)
}
type PlaybackFixture = Awaited<ReturnType<typeof preparePlaybackDifferential>>
async function readPlaybackContent(t: TestStore, f: PlaybackFixture) {
  const playback = await consumerQuery(t, api.audioOverviewV2.getPlaybackForOwner, { overviewId: f.overviewId })
  expect(playback).not.toBeNull()
  // Alignment status/count and publication/model diagnostics are not teaching.
  const { alignment: _alignment, ...content } = playback!
  return consumerContent(content)
}
const playbackEdits: Array<{ name: string, changes?: boolean, pending?: boolean, apply: (t: TestStore, f: PlaybackFixture) => Promise<unknown> }> = [
  { name: 'utterance text', apply: (t, f) => t.run(ctx => ctx.db.patch(f.utteranceId, { text: 'Changed spoken teaching' })) },
  { name: 'utterance speaker', apply: (t, f) => t.run(ctx => ctx.db.patch(f.utteranceId, { speaker: 'host_b' })) },
  { name: 'utterance delivery', apply: (t, f) => t.run(ctx => ctx.db.patch(f.utteranceId, { emotionalIntent: 'reflective', deliveryIntent: 'slow', pauseAfterMs: 2 })) },
  { name: 'outline narrative', apply: (t, f) => t.run(ctx => ctx.db.patch(f.outlineId, { narrativeArc: 'Different narrative' })) },
  { name: 'outline objective', apply: (t, f) => t.run(ctx => ctx.db.patch(f.objectiveId, { text: 'Learn a second idea' })) },
  { name: 'outline source link', apply: (t, f) => t.run(ctx => ctx.db.delete(f.outlineSourceId)) },
  { name: 'supported claim text', apply: (t, f) => t.run(ctx => ctx.db.patch(f.claimId, { text: 'Different supported claim' })) },
  { name: 'supported claim removal', apply: (t, f) => t.run(ctx => ctx.db.patch(f.claimId, { status: 'unsupported' })) },
  { name: 'claim source link', apply: (t, f) => t.run(ctx => ctx.db.delete(f.claimSourceId)) },
  { name: 'source manifest revision', apply: (t, f) => t.run(ctx => ctx.db.patch(f.sourceManifestId, { revision: 'manifest.r2' })) },
  { name: 'source manifest hash', apply: (t, f) => t.run(ctx => ctx.db.patch(f.sourceManifestId, { contentHash: 'b'.repeat(64) })) },
  { name: 'source entry content', apply: (t, f) => t.run(async ctx => {
    await ctx.db.patch(f.documentId, { sourceRevision: 'source.r2', contentHash: 'b'.repeat(64) })
    await ctx.db.patch(f.entryId, { displayReference: 'Revised source reference', revision: 'source.r2', contentHash: 'b'.repeat(64) })
  }) },
  { name: 'scene teaching', apply: (t, f) => t.run(ctx => ctx.db.patch(f.sceneId, { title: 'Second scene', narrativePurpose: 'Apply the rule', durationMs: 9 })) },
  { name: 'utterance source link', apply: (t, f) => t.run(ctx => ctx.db.delete(f.utteranceSourceId)) },
  { name: 'utterance claim link', apply: (t, f) => t.run(ctx => ctx.db.delete(f.utteranceClaimId)) },
  { name: 'alignment word', apply: (t, f) => t.run(async (ctx: MutationCtx) => {
    const segment = (await ctx.db.query('audioOverviewAlignmentSegments').withIndex('by_alignmentId_and_utteranceId_and_wordIndex', q => q.eq('alignmentId', f.alignmentId)).first())!
    await ctx.db.patch(segment._id, { word: 'Changed' })
  }) },
  { name: 'alignment timing', apply: (t, f) => t.run(async (ctx: MutationCtx) => {
    const segment = (await ctx.db.query('audioOverviewAlignmentSegments').withIndex('by_alignmentId_and_utteranceId_and_wordIndex', q => q.eq('alignmentId', f.alignmentId)).first())!
    await ctx.db.patch(segment._id, { startMs: 1, endMs: 5 })
  }) },
  { name: 'final media object', apply: (t, f) => t.run(ctx => ctx.db.patch(f.mediaId, { objectKey: 'audio/replaced.wav' })) },
  { name: 'final media content', apply: (t, f) => t.run(ctx => ctx.db.patch(f.mediaId, { checksumSha256: 'b'.repeat(64), durationMs: 9 })) },
  { name: 'episode teaching', apply: (t, f) => t.run(ctx => ctx.db.patch(f.episodeId, { title: 'Different episode heading', hostAName: 'Ada' })) },
  { name: 'completeAlignment (real)', pending: true, apply: (t, f) => consumerMutation(t, api.audioOverviewV2.completeAlignment, { jobId: f.jobId, capability: alignmentCapability, alignmentId: f.alignmentId }) },
  { name: 'append and completeAlignment (real)', pending: true, apply: async (t, f) => {
    await consumerMutation(t, api.audioOverviewV2.appendAlignmentSegments, { jobId: f.jobId, capability: alignmentCapability, alignmentId: f.alignmentId,
      segments: [{ utteranceId: f.utteranceId, wordIndex: 1, word: 'Two', startMs: 5, endMs: 9 }] })
    return consumerMutation(t, api.audioOverviewV2.completeAlignment, { jobId: f.jobId, capability: alignmentCapability, alignmentId: f.alignmentId })
  } },
  { name: 'pending alignment append (real)', pending: true, changes: false, apply: (t, f) => consumerMutation(t, api.audioOverviewV2.appendAlignmentSegments, { jobId: f.jobId, capability: alignmentCapability, alignmentId: f.alignmentId,
    segments: [{ utteranceId: f.utteranceId, wordIndex: 1, word: 'Two', startMs: 5, endMs: 9 }] }) },
  { name: 'pending alignment failure (real)', pending: true, changes: false, apply: (t, f) => consumerMutation(t, api.audioOverviewV2.failAlignment, { jobId: f.jobId, capability: alignmentCapability, alignmentId: f.alignmentId, error: 'Alignment unavailable' }) },
  { name: 'publishOverview (real)', changes: false, apply: (t, f) => consumerMutation(t, api.audioOverviews.publishOverview, { id: f.overviewId }) },
  { name: 'publish and unpublish (real)', changes: false, apply: async (t, f) => {
    await consumerMutation(t, api.audioOverviews.publishOverview, { id: f.overviewId })
    return consumerMutation(t, api.audioOverviews.unpublishOverview, { id: f.overviewId })
  } },
  { name: 'alignment confidence and diagnostics', changes: false, apply: (t, f) => t.run(async (ctx: MutationCtx) => {
    const segment = (await ctx.db.query('audioOverviewAlignmentSegments').withIndex('by_alignmentId_and_utteranceId_and_wordIndex', q => q.eq('alignmentId', f.alignmentId)).first())!
    await ctx.db.patch(segment._id, { confidence: 0.5, createdAt: 12 })
    await ctx.db.patch(f.alignmentId, { aligner: 'another-aligner', alignerVersion: 'v2', updatedAt: 123 })
  }) },
  { name: 'episode generation diagnostics', changes: false, apply: (t, f) => t.run(ctx => ctx.db.patch(f.episodeId, { model: 'new-model', renderer: 'new-renderer', sceneCount: 2, utteranceCount: 2, updatedAt: 123 })) },
  { name: 'planning diagnostics', changes: false, apply: (t, f) => t.run(async ctx => {
    await ctx.db.patch(f.sourceManifestId, { entryCount: 2, frozenAt: 123 })
    await ctx.db.patch(f.outlineId, { createdAt: 123, learningObjectiveCount: 2 })
    await ctx.db.patch(f.claimId, { verificationModel: 'another-model', entailmentReason: 'Reverified', createdAt: 123 })
    await ctx.db.patch(f.sceneId, { currentAttempt: 2, updatedAt: 123 })
    await ctx.db.patch(f.mediaId, { etag: 'transport-tag', rendererRequestId: 'request-2', publishedAt: 123 })
  }) },
]
describe('A5 V2 playback consumer differential', () => {
  test.each(playbackEdits)('$name changes the pin iff playback teaching changes', async ({ pending, changes = true, apply }) => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const f = await preparePlaybackDifferential(t, !pending)
    await expectDifferential(t, f, () => apply(t, f), changes, () => readPlaybackContent(t, f))
  })
})

describe('A5 direct-document full identity commitment', () => {
  test.each(artifactKinds.flatMap(kind => ['sourceRevision', 'contentHash', 'r2Key', 'indexJobId', 'filename'].map(field => ({ kind, field }))))('$kind / $field (real)', async ({ kind, field }) => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, kind, 'document'))
    const copy = await matrixControl(t, f)
    const manifest = await t.run(ctx => currentManifestDigest(ctx, f.lineageId))
    const before = consumerContent(await t.query(internal.documents.getDocument, { id: f.sourceDocumentId! }))
    const changes = !['indexJobId', 'filename'].includes(field)
    if (field === 'filename') await t.mutation(internal.documents.updateDocumentFilename, { id: f.sourceDocumentId!, filename: 'renamed.txt' })
    else await t.mutation(internal.documents.updateDocumentStatus, { id: f.sourceDocumentId!, status: 'success', [field]: field === 'contentHash' ? 'a'.repeat(64) : `replacement-${field}` })
    const after = consumerContent(await t.query(internal.documents.getDocument, { id: f.sourceDocumentId! }))
    expect(JSON.stringify(after) !== JSON.stringify(before)).toBe(changes)
    if (field === 'sourceRevision') await expect(t.run(ctx => currentManifestDigest(ctx, f.lineageId))).rejects.toThrow('Artifact lineage unavailable')
    else expect(await t.run(ctx => currentManifestDigest(ctx, f.lineageId)) !== manifest).toBe(changes)
    for (const target of [f, copy]) expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: target.reference })).toMatchObject({ status: changes ? 'unavailable' : 'bound' })
    if (changes) await expectMatrixRevoked(t, f, copy)
  })
})

describe('A5 session claim and support consumer differential', () => {
  beforeEach(() => { vi.stubEnv('LEARN_V2_ENABLED', 'true') })
  afterEach(() => { vi.unstubAllEnvs() })
  test.each(['claim text', 'claim addition', 'claim removal', 'support verification', 'support source'] as const)('%s (injected immutable content)', async field => {
    const t = convexTest(schema, modules)
    const seeded = await t.run(async ctx => {
      const f = await prepareMatrix(ctx, 'session_block')
      const claimId = await ctx.db.insert('sessionContentClaims', { userId: owner.tokenIdentifier, sessionContentId: f.contentId, order: 0, claim: 'A supported instructional claim' })
      const supportId = await ctx.db.insert('learnClaimSupports', { userId: owner.tokenIdentifier, sessionContentClaimId: claimId,
        sourceExcerptId: f.excerptId, sourceSnapshotId: f.snapshotId, entailment: 'entailed', conflictStatus: 'clear', evidenceStatus: 'evidence_available', verifierVersion: 'verifier.v1' })
      return { ...f, claimId, supportId }
    })
    const f = await repinContent(t, seeded)
    await expectDifferential(t, f, () => t.run(async ctx => {
      if (field === 'claim text') await ctx.db.patch(f.claimId, { claim: 'Revised instructional claim' })
      if (field === 'claim addition') {
        const claimId = await ctx.db.insert('sessionContentClaims', { userId: owner.tokenIdentifier, sessionContentId: f.contentId, order: 1, claim: 'Another claim' })
        await ctx.db.insert('learnClaimSupports', { userId: owner.tokenIdentifier, sessionContentClaimId: claimId,
          sourceExcerptId: f.excerptId, sourceSnapshotId: f.snapshotId, entailment: 'entailed', conflictStatus: 'clear' })
      }
      if (field === 'claim removal') { await ctx.db.delete(f.claimId); await ctx.db.delete(f.supportId) }
      if (field === 'support verification') await ctx.db.patch(f.supportId, { verifierVersion: 'verifier.v2', confidence: 0.5 })
      if (field === 'support source') await ctx.db.patch(f.supportId, { sourceSnapshotId: undefined })
    }), true)
  })
})

describe('A5 historical flashcard version consumer differential', () => {
  test.each(['createCard', 'updateCard', 'deleteCard', 'reorderCards', 'generateRoomCards', 'restoreRoomVersion'] as const)('%s (real) leaves the historical payload bound', async command => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, 'flashcard_version'))
    const { cardId } = await consumerMutation(t, api.flashcardRooms.createCard, { roomId: f.flashcardRoomId, term: 'Active term', definition: 'Active definition' })
    await expectDifferential(t, f, async () => {
      if (command === 'createCard') return consumerMutation(t, api.flashcardRooms.createCard, { roomId: f.flashcardRoomId, term: 'Another', definition: 'Another definition' })
      if (command === 'updateCard') return consumerMutation(t, api.flashcardRooms.updateCard, { cardId, term: 'Edited', definition: 'Edited definition' })
      if (command === 'deleteCard') return consumerMutation(t, api.flashcardRooms.deleteCard, { cardId })
      if (command === 'reorderCards') return consumerMutation(t, api.flashcardRooms.reorderCards, { roomId: f.flashcardRoomId, order: [{ cardId, displayOrder: 0 }] })
      if (command === 'generateRoomCards') return consumerMutation(t, api.flashcardRooms.generateRoomCards, { roomId: f.flashcardRoomId, origin: 'manual', cards: [{ term: 'Generated', definition: 'New version' }] })
      return consumerMutation(t, api.flashcardRooms.restoreRoomVersion, { roomId: f.flashcardRoomId, versionId: f.versionId })
    }, false)
  })
})

describe('A5 linked-content read budget', () => {
  test('oversized embedded Quiz reads fail closed before exhausting 4 MiB', async () => {
    const t = convexTest(schema, modules)
    const f = await prepareLinkedSection(t)
    await t.run(async ctx => {
      for (let i = 0; i < 5; i++) await ctx.db.insert('quizQuestions', { userId: owner.tokenIdentifier, quizId: f.quizId,
        order: i + 1, type: 'free-response', question: `${i}${'x'.repeat(850_000)}`, correctAnswer: 'Answer' })
    })
    for (const mode of ['resolve', 'register'] as const) {
      const result = await tracedLookup(t, f, mode)
      expect(result.status).toBe('unavailable')
      expect(result.charged).toBeLessThanOrEqual(ARTIFACT_LINEAGE_READ_BYTES)
      expect(result.bytes).toBeGreaterThan(2_500_000)
    }
    expect(await t.run(ctx => ctx.db.get(f.catalogId))).toMatchObject({ catalogRevision: 0 })
  })
  test('V2 playback parents and linked rows share the graph budget', async () => {
    const t = convexTest(schema, modules)
    const f = await preparePlaybackDifferential(t)
    await t.run(async ctx => {
      await ctx.db.patch(f.episodeId, { renderer: 'x'.repeat(850_000) })
      await ctx.db.patch(f.mediaId, { rendererRequestId: 'x'.repeat(850_000) })
      await ctx.db.patch(f.sourceManifestId, { planFingerprint: 'x'.repeat(850_000) })
      await ctx.db.patch(f.outlineId, { narrativeArc: 'x'.repeat(850_000) })
    })
    for (const mode of ['resolve', 'register'] as const) {
      const result = await tracedLookup(t, f, mode)
      expect(result.status).toBe('unavailable')
      expect(result.charged).toBeLessThanOrEqual(ARTIFACT_LINEAGE_READ_BYTES)
      expect(result.bytes).toBeGreaterThan(2_500_000)
    }
    expect(await t.run(ctx => ctx.db.get(f.catalogId))).toMatchObject({ catalogRevision: 0 })
  })
})

describe('A5 consumer payload equivalence and read limits', () => {
  test('V2 pin equals the owner playback teaching payload with its ownership identity', async () => {
    const t = convexTest(schema, modules)
    const f = await preparePlaybackDifferential(t)
    const playback = (await consumerQuery(t, api.audioOverviewV2.getPlaybackForOwner, { overviewId: f.overviewId }))!
    const { overviewId, model: _model, publishedAt: _publishedAt, alignment: _alignment, ...teaching } = playback
    const projection = await t.run(async ctx => audioOverviewContentProjection(ctx, (await ctx.db.get(f.overviewId))!))
    expect(projection.payload).toEqual({ id: overviewId, userId: owner.tokenIdentifier, ...teaching })
  })
  test('real Quiz addition changes offline teaching, including at the 50-question cache boundary', async () => {
    const t = convexTest(schema, modules)
    let f = await prepareLinkedSection(t)
    const before = await consumerQuery(t, api.courseSections.getOfflineCachePayload, { sectionId: f.sectionId })
    await consumerMutation(t, api.quizzes.addQuestion, { quizId: f.quizId, type: 'free-response', questionText: 'Second question', correctAnswer: 'Second answer' })
    const after = await consumerQuery(t, api.courseSections.getOfflineCachePayload, { sectionId: f.sectionId })
    expect(after).not.toEqual(before)
    expect(after!.contentBlocks.find(b => b.type === 'quiz')!.quizData!.questions).toHaveLength(2)
    for (let i = 2; i < 50; i++) await consumerMutation(t, api.quizzes.addQuestion, { quizId: f.quizId, type: 'free-response', questionText: `Question ${i}`, correctAnswer: `Answer ${i}` })
    f = await repinContent(t, f)
    const fullCache = await consumerQuery(t, api.courseSections.getOfflineCachePayload, { sectionId: f.sectionId })
    await expectDifferential(t, f, () => consumerMutation(t, api.quizzes.addQuestion, { quizId: f.quizId, type: 'free-response', questionText: 'Online question 51', correctAnswer: 'Online answer 51' }), true)
    expect(await consumerQuery(t, api.courseSections.getOfflineCachePayload, { sectionId: f.sectionId })).toEqual(fullCache)
  })
  test.each(['Quiz', 'flashcard room'] as const)('%s child overflow stays unavailable', async aggregate => {
    const t = convexTest(schema, modules)
    const f = await prepareLinkedSection(t)
    await t.run(async ctx => {
      for (let i = 1; i < 201; i++) {
        if (aggregate === 'Quiz') await ctx.db.insert('quizQuestions', { userId: owner.tokenIdentifier, quizId: f.quizId, order: i, type: 'free-response', question: `Question ${i}`, correctAnswer: 'Answer' })
        else await ctx.db.insert('flashcardRoomCards', { userId: owner.tokenIdentifier, roomId: f.flashcardRoomId, displayOrder: i, term: `Term ${i}`, definition: 'Definition' })
      }
    })
    const copy = await t.run(ctx => prepare(ctx, { origin: f, transformation: 'rewrite' }))
    await expectMatrixRevoked(t, f, copy)
  })
})

describe('A5 section audio consumer boundary', () => {
  test('V2 alignment changes standalone playback while the section compatibility payload stays bound', async () => {
    const t = convexTest(schema, modules)
    const audio = await preparePlaybackDifferential(t, false)
    await t.run(async ctx => {
      const fingerprints = { scenarioFingerprint: 'd'.repeat(64), solutionFingerprint: 'e'.repeat(64) }
      await ctx.db.patch(audio.caseId, fingerprints)
      const binding = (await ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', audio.lineageId)).unique())!
      await ctx.db.patch(binding._id, fingerprints)
      await ctx.db.patch(audio.validationId, { manifestDigest: await sealManifest(ctx, audio.lineageId) })
    })
    let section = await prepareLinkedSection(t)
    await t.run(async ctx => {
      const row = (await ctx.db.get(section.sectionId))!
      await ctx.db.patch(row._id, { contentBlocks: row.contentBlocks.map(block => block.type === 'audio' ? { ...block, entityId: audio.overviewId } : block) })
    })
    section = await repinContent(t, section)
    const before = await consumerQuery(t, api.courseSections.getOfflineCachePayload, { sectionId: section.sectionId })
    await expectDifferential(t, section, () => consumerMutation(t, api.audioOverviewV2.completeAlignment, { jobId: audio.jobId, capability: alignmentCapability, alignmentId: audio.alignmentId }), false)
    expect(await consumerQuery(t, api.courseSections.getOfflineCachePayload, { sectionId: section.sectionId })).toEqual(before)
    expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: audio.reference })).toMatchObject({ status: 'unavailable' })
  })
})

describe.each(['quiz_question', 'section_block'] as const)('A5 %s Quiz operational commands', kind => {
  test.each(['startAttempt', 'completeAttempt', 'abandonAttempt', 'submitAllAnswers', 'submitAttempt'] as const)('%s preserves teaching and binding', async command => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const f = kind === 'section_block' ? await prepareLinkedSection(t) : await t.run(ctx => prepareMatrix(ctx, kind))
    await expectDifferential(t, f, async () => {
      if (command === 'submitAttempt') return consumerMutation(t, api.quizzes.submitAttempt, { quizId: f.quizId, answers: [{ questionId: f.questionId, response: 'Two' }] })
      const started = await consumerMutation(t, api.quizzes.startAttempt, { quizId: f.quizId, settings: { shuffleQuestions: false, showAllQuestions: true, immediateFeedback: true } })
      if (command === 'startAttempt') return started
      if (command === 'completeAttempt') return consumerMutation(t, api.quizzes.completeAttempt, { attemptId: started.attemptId })
      if (command === 'abandonAttempt') return consumerMutation(t, api.quizzes.abandonAttempt, { attemptId: started.attemptId })
      return consumerMutation(t, api.quizzes.submitAllAnswers, { attemptId: started.attemptId, answers: [{ questionId: f.questionId, userAnswer: 'Two' }] })
    }, false)
  })
})

describe('A5 linked aggregate revocation', () => {
  test.each(['Quiz tombstone', 'card room deletion', 'Audio Overview deletion', 'audio room deletion', 'audio conversation archive (injected marker)'] as const)('%s denies the section before scheduled cleanup', async change => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const f = await prepareLinkedSection(t)
    const copy = await matrixControl(t, f)
    if (change === 'Quiz tombstone') await consumerMutation(t, api.quizzes.deleteQuiz, { quizId: f.quizId })
    if (change === 'card room deletion') await consumerMutation(t, api.flashcardRooms.deleteRoom, { roomId: f.flashcardRoomId })
    if (change === 'Audio Overview deletion') await consumerMutation(t, api.audioOverviews.deleteOverview, { id: f.overviewId })
    if (change === 'audio room deletion') await t.run(ctx => ctx.db.delete(f.audioRoomId))
    if (change === 'audio conversation archive (injected marker)') await t.run(ctx => ctx.db.patch(f.conversationId, { archivedAt: 0 }))
    await expectMatrixRevoked(t, f, copy)
  })
})

async function jobAuthority(ctx: MutationCtx, f: Fixture): Promise<LearnArtifactOwnerRecord> {
  const taskId = await ctx.db.insert('tasks', { userId: owner.tokenIdentifier, folderId: f.folderId, type: 'audio-overview-generation', status: 'running', title: 'Owned audio job',
    audioOverviewRequest: { scope: { mode: 'explicit', documentIds: [f.documentId] }, documents: [{ documentId: f.documentId, folderId: f.folderId, filename: 'source.txt', r2Key: 'owned/source.r1' }], preferences: { lengthMinutes: 5, complexity: 'beginner' }, voiceProfile: { hostA: 'asteria', hostB: 'orion' }, quotaDate: '2026-11-06' },
    createdAt: f.base.createdAt, updatedAt: f.base.createdAt })
  const id = await ctx.db.insert('audioOverviewJobs', { userId: owner.tokenIdentifier, taskId, folderId: f.folderId,
    idempotencyKey: 'lineage-job', capabilityHash: 'a'.repeat(64), status: 'running', stage: 'preparing', completedTurns: 0, createdAt: f.base.createdAt, updatedAt: f.base.createdAt })
  return { kind: 'audio_job', id }
}

function recordFor(f: Fixture): LearnArtifactOwnerRecord { return { kind: 'document', id: f.documentId } }

describe.each(['document', 'audio_job'] as const)('B1 record-owner authority: %s', (kind) => {
  async function fixture() {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    const record = kind === 'document' ? recordFor(f) : await t.run(ctx => jobAuthority(ctx, f))
    return { t, f, record }
  }
  test('identity-less lookup and registration use the authoritative owner and match session semantics', async () => {
    const { t, f, record } = await fixture()
    const result = await t.query(internal.learnV2ArtifactLineage.resolveForRecord, { ownerRecord: record, reference: f.reference })
    expect(result).toEqual(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference }))
    expect(result).toMatchObject({ status: 'bound' })
    expect(await t.run(ctx => registerInstructionalArtifactForRecord(ctx, record, registration(f)))).toMatchObject({ catalogRevision: 1 })
    expect(await t.query(internal.learnV2ArtifactLineage.resolveForRecord, { ownerRecord: record, reference: f.reference })).toMatchObject({ status: 'bound', instructionalRegistered: true })
    await expect(t.run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))).rejects.toThrow('Unauthenticated')
  })
  test.each(['foreign', 'folder_missing', 'folder_foreign', 'record_missing', 'record_failed'] as const)('denies %s authority without a receipt', async (state) => {
    const { t, f, record } = await fixture()
    await t.run(async ctx => {
      if (state === 'foreign') {
        if (record.kind === 'document') await ctx.db.patch(record.id, { userId: foreign.tokenIdentifier })
        else await ctx.db.patch(record.id, { userId: foreign.tokenIdentifier })
      }
      if (state === 'folder_missing') await ctx.db.delete(f.folderId)
      if (state === 'folder_foreign') await ctx.db.patch(f.folderId, { userId: foreign.tokenIdentifier })
      if (state === 'record_missing') await ctx.db.delete(record.id)
      if (state === 'record_failed') {
        if (record.kind === 'document') await ctx.db.patch(record.id, { status: 'failed' })
        else await ctx.db.patch(record.id, { status: 'failed' })
      }
    })
    expect(await t.query(internal.learnV2ArtifactLineage.resolveForRecord, { ownerRecord: record, reference: f.reference })).toMatchObject({ status: 'unavailable' })
    await expect(t.run(ctx => registerInstructionalArtifactForRecord(ctx, record, registration(f)))).rejects.toThrow('unavailable')
    expect(await t.run(ctx => ctx.db.get(f.catalogId))).toHaveProperty('catalogRevision', 0)
    expect(await t.run(ctx => ctx.db.get(f.lineageId))).not.toHaveProperty('publication')
  })
  test.each(['active', 'complete'] as const)('denies the record owner with an %s deletion tombstone', async (status) => {
    const { t, f, record } = await fixture()
    await t.run(ctx => ctx.db.insert('accountDeletionJobs', { userId: owner.tokenIdentifier, status, phase: 'documents', startedAt: f.base.createdAt, updatedAt: f.base.createdAt }))
    await expect(t.query(internal.learnV2ArtifactLineage.resolveForRecord, { ownerRecord: record, reference: f.reference })).rejects.toThrow('Account deletion is in progress')
    await expect(t.run(ctx => registerInstructionalArtifactForRecord(ctx, record, registration(f)))).rejects.toThrow('Account deletion is in progress')
    expect(await t.run(ctx => ctx.db.get(f.catalogId))).toHaveProperty('catalogRevision', 0)
  })
  test('rejects caller-supplied owner fields in both record and operation envelopes', async () => {
    const { t, f, record } = await fixture()
    const forgedRecord = { ...record, userId: foreign.tokenIdentifier }
    await expect(t.run(ctx => resolveArtifactLineageForRecord(ctx, forgedRecord, { reference: f.reference }))).rejects.toThrow()
    await expect(t.run(ctx => registerInstructionalArtifactForRecord(ctx, forgedRecord, registration(f)))).rejects.toThrow()
    await expect(t.run(ctx => resolveArtifactLineageForRecord(ctx, record, { reference: f.reference, userId: owner.tokenIdentifier }))).rejects.toThrow()
    await expect(t.run(ctx => registerInstructionalArtifactForRecord(ctx, record, { ...registration(f), userId: owner.tokenIdentifier }))).rejects.toThrow()
  })
})

describe('B1 audio job authority access', () => {
  test.each(['task_foreign', 'task_missing', 'task_folder', 'task_cancelled', 'task_request', 'room_foreign', 'conversation_archived'] as const)('denies %s before lineage access', async state => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, 'audio_overview'))
    const record = await t.run(ctx => jobAuthority(ctx, f))
    if (record.kind !== 'audio_job') throw new Error('Expected job')
    await t.run(async ctx => {
      const job = (await ctx.db.get(record.id))!
      if (state === 'task_foreign') await ctx.db.patch(job.taskId, { userId: foreign.tokenIdentifier })
      if (state === 'task_missing') await ctx.db.delete(job.taskId)
      if (state === 'task_folder') await ctx.db.patch(job.taskId, { folderId: f.sourceFolderId })
      if (state === 'task_cancelled') await ctx.db.patch(job.taskId, { status: 'cancelled' })
      if (state === 'task_request') await ctx.db.patch(job.taskId, { audioOverviewRequest: undefined })
      if (state === 'room_foreign' || state === 'conversation_archived') {
        await ctx.db.patch(job._id, { roomId: f.audioRoomId })
        if (state === 'room_foreign') await ctx.db.patch(f.audioRoomId, { userId: foreign.tokenIdentifier })
        else await ctx.db.patch(f.conversationId, { archivedAt: f.base.createdAt })
      }
    })
    expect(await t.run(ctx => resolveArtifactLineageForRecord(ctx, record, { reference: f.reference }))).toMatchObject({ status: 'unavailable' })
    await expect(t.run(ctx => registerInstructionalArtifactForRecord(ctx, record, registration(f)))).rejects.toThrow('unavailable')
  })
})

// Generation persists at most 600 output tokens per question plus its
// retrieved chunk; these sizes exceed both to measure a worst-case batch.
function generatedQuestion(i: number) {
  return { question: `Question ${i}? ${'q'.repeat(600)}`, type: 'multiple-choice' as const, options: ['a', 'b', 'c', 'd'].map(option => option.repeat(300)),
    correctAnswer: 'a'.repeat(300), explanation: 'e'.repeat(1200), sourceChunkContent: 's'.repeat(8 * 1024) }
}
async function prepareQuizBatch(t: TestStore, count: number, generated = false) {
  return t.run(ctx => seedQuizBatch(ctx, count, generated))
}
async function seedQuizBatch(ctx: MutationCtx, count: number, generated = false) {
  const folderId = await ctx.db.insert('folders', { userId: owner.tokenIdentifier, name: 'Quiz batch', documentCount: 0 })
  const quizId = await ctx.db.insert('quizzes', { userId: owner.tokenIdentifier, folderId, title: 'Ten questions', status: 'ready' })
  const fixtures: Fixture[] = []
  for (let i = 0; i < count; i++) {
    const f = await prepare(ctx, { fingerprint: (i % 16).toString(16) })
    // Each question has a distinct stable case, not ten prompt aliases.
    const candidate = (await ctx.db.get(f.caseId))!
    const fingerprint = await artifactPayloadDigest({ question: i })
    await ctx.db.patch(f.caseId, { scenarioFingerprint: fingerprint, solutionFingerprint: fingerprint })
    const binding = (await ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', f.lineageId)).unique())!
    await ctx.db.patch(binding._id, { scenarioFingerprint: fingerprint, solutionFingerprint: fingerprint })
    expect(candidate.usageClass).toBe('unknown')
    const questionId = await ctx.db.insert('quizQuestions', generated ? { userId: owner.tokenIdentifier, quizId, order: i, ...generatedQuestion(i), sourceDocumentId: f.documentId }
      : { userId: owner.tokenIdentifier, quizId, order: i, question: `Question ${i}?`, type: 'free-response', correctAnswer: `Answer ${i}` })
    const payloadDigest = await artifactPayloadDigest(artifactContentProjection({ kind: 'quiz_question', question: (await ctx.db.get(questionId))! }))
    const reference: LearnArtifactReference = { artifact: { kind: 'quiz_question', id: questionId }, key: 'whole', revision: `sha256:${payloadDigest}`, payloadDigest }
    await ctx.db.patch(f.lineageId, reference)
    const manifestDigest = await sealManifest(ctx, f.lineageId)
    await ctx.db.patch(f.validationId, { payloadDigest, manifestDigest })
    fixtures.push({ ...f, reference, manifestDigest })
  }
  return fixtures
}
function batchRegistration(fixtures: Fixture[]) { return { artifacts: fixtures.map(f => ({ reference: f.reference, validationId: f.validationId })), expectedCatalogRevision: fixtures[0]?.catalogRevision ?? 0 } }
async function expectUnpublished(t: TestStore, fixtures: Fixture[]) {
  for (const f of fixtures) {
    expect(await t.run(ctx => ctx.db.get(f.lineageId))).not.toHaveProperty('publication')
    expect(await t.run(ctx => ctx.db.get(f.caseId))).toHaveProperty('usageClass', 'unknown')
    expect(await t.run(ctx => ctx.db.get(f.catalogId))).toHaveProperty('catalogRevision', f.catalogRevision)
  }
}

describe('B1 atomic batch registration', () => {
  test.each(['session', 'document', 'audio_job'] as const)('publishes a ten-question Quiz in one %s transaction with one catalogue advance and exact read charges', async mode => {
    const t = convexTest(schema, modules)
    const fixtures = await prepareQuizBatch(t, 10)
    const f = fixtures[0]!
    const record = mode === 'audio_job' ? await t.run(ctx => jobAuthority(ctx, f)) : recordFor(f)
    const runner = mode === 'session' ? t.withIdentity(owner) : t
    await runner.run(async ctx => {
      const traced = traceLineageReads(ctx)
      const budget = createArtifactLineageReadContext(traced.ctx)
      const result = mode === 'session'
        ? await registerInstructionalArtifactsForOwner(budget.ctx, owner.tokenIdentifier, batchRegistration(fixtures))
        : await registerInstructionalArtifactsForRecord(budget.ctx, record, batchRegistration(fixtures))
      expect(result).toMatchObject({ catalogRevision: 1, lineageIds: fixtures.map(f => f.lineageId) })
      expect(result.readUsage).toEqual(budget.readUsage)
      expect(result.readUsage).toEqual({ chargedBytes: traced.stats.charged, documentsRead: traced.stats.documents, readRequests: traced.stats.requests, limitBytes: ARTIFACT_LINEAGE_READ_BYTES })
    })
    for (const target of fixtures) {
      expect(await t.run(ctx => ctx.db.get(target.lineageId))).toHaveProperty('publication.catalogRevision', 1)
      expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: target.reference })).toMatchObject({ status: 'bound', cases: [{ caseId: target.caseId, usageClass: 'instructional' }] })
    }
    expect(await t.run(ctx => ctx.db.get(f.catalogId))).toHaveProperty('catalogRevision', 1)
  })
  test.each(['reserved', 'stale_validation', 'source_loss'] as const)('a mixed %s failure leaves no partial state even when the producer catches it', async failure => {
    const t = convexTest(schema, modules)
    const fixtures = await prepareQuizBatch(t, 10)
    const last = fixtures.at(-1)!
    await t.run(async ctx => {
      if (failure === 'reserved') await ctx.db.patch(last.caseId, { reservedAt: last.base.createdAt })
      if (failure === 'stale_validation') {
        await ctx.db.patch(last.catalogId, { catalogRevision: 1 })
        for (const f of fixtures) {
          f.catalogRevision = 1
          await ctx.db.patch(f.validationId, { comparedCatalogRevision: f === last ? 0 : 1 })
        }
      }
      if (failure === 'source_loss') await ctx.db.patch(last.documentId, { status: 'failed' })
    })
    await t.withIdentity(owner).run(async ctx => {
      await expect(registerInstructionalArtifactsForOwner(ctx, owner.tokenIdentifier, batchRegistration(fixtures))).rejects.toThrow('unavailable')
    })
    await expectUnpublished(t, fixtures)
  })
  test('denies a stale compared catalogue revision for the whole batch', async () => {
    const t = convexTest(schema, modules)
    const fixtures = await prepareQuizBatch(t, 10)
    await t.withIdentity(owner).run(ctx => advanceAssessmentCatalogForOwner(ctx, owner.tokenIdentifier, 0))
    await expect(t.withIdentity(owner).run(ctx => registerInstructionalArtifactsForOwner(ctx, owner.tokenIdentifier, batchRegistration(fixtures)))).rejects.toThrow('unavailable')
    for (const f of fixtures) expect(await t.run(ctx => ctx.db.get(f.lineageId))).not.toHaveProperty('publication')
  })
  test('admits the maximum batch and rejects empty, oversized and duplicate batches', async () => {
    const t = convexTest(schema, modules)
    const fixtures = await prepareQuizBatch(t, LEARN_ARTIFACT_LINEAGE_LIMITS.maxBatch)
    const args = batchRegistration(fixtures)
    for (const artifacts of [[], [...args.artifacts, args.artifacts[0]!], [args.artifacts[0]!, args.artifacts[0]!]]) {
      await expect(t.withIdentity(owner).run(ctx => registerInstructionalArtifactsForOwner(ctx, owner.tokenIdentifier, { ...args, artifacts }))).rejects.toThrow()
      await expectUnpublished(t, fixtures)
    }
    expect(await t.withIdentity(owner).run(ctx => registerInstructionalArtifactsForOwner(ctx, owner.tokenIdentifier, args))).toHaveProperty('lineageIds', fixtures.map(f => f.lineageId))
  })
  test('shares the read budget across otherwise admissible members and exposes failed and repeated lookup charges', async () => {
    const t = convexTest(schema, modules)
    const fixtures = await prepareQuizBatch(t, 6)
    for (const f of fixtures) await t.run(ctx => ctx.db.patch(f.documentId, { filename: 'x'.repeat(650_000) }))
    const rollback = 'Probe only'
    for (const f of fixtures) await expect(t.withIdentity(owner).run(async ctx => {
      await registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f))
      throw new Error(rollback)
    })).rejects.toThrow(rollback)
    await t.withIdentity(owner).run(async ctx => {
      const traced = traceLineageReads(ctx)
      const budget = createArtifactLineageReadContext(traced.ctx)
      await expect(registerInstructionalArtifactsForOwner(budget.ctx, owner.tokenIdentifier, batchRegistration(fixtures))).rejects.toThrow('unavailable')
      expect(budget.readUsage.chargedBytes).toBe(traced.stats.charged)
      expect(budget.readUsage.chargedBytes).toBeLessThan(ARTIFACT_LINEAGE_READ_BYTES)
      expect(budget.readUsage.chargedBytes).toBeGreaterThan(2 * 1024 * 1024)
      const requests = budget.readUsage.readRequests
      expect(await resolveArtifactLineageForOwner(budget.ctx, owner.tokenIdentifier, { reference: fixtures[0]!.reference })).toMatchObject({ status: 'unavailable' })
      expect(budget.readUsage.readRequests).toBe(requests)
    })
    await expectUnpublished(t, fixtures)
  })
})

describe.each(documentKinds)('B1 folder moves preserve %s lineage', kind => {
  test('a real move denies unregistered indexing provenance while a completed fixture preserves its content pin', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, kind, 'document'))
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))
    const summary = await t.run(ctx => prepare(ctx, { origin: f, transformation: 'summary' }))
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(summary)))
    const destinationFolderId = await t.run(ctx => ctx.db.insert('folders', { userId: owner.tokenIdentifier, name: 'Destination', documentCount: 0 }))
    await t.withIdentity(owner).mutation(api.documents.moveDocument, { id: f.documentId, destinationFolderId })
    for (const target of [f, summary]) expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: target.reference })).toMatchObject({ status: 'unavailable' })
    await expect(t.mutation(internal.documents.finalizeDocumentIndexing, { id: f.documentId, expectedFolderId: destinationFolderId, expectedR2Key: 'owned/source.r1', status: 'success' })).rejects.toThrow('Artifact lineage unavailable')
    await t.run(ctx => ctx.db.patch(f.documentId, { status: 'success' }))
    expect(await t.run(async ctx => artifactPayloadDigest(await currentContent(ctx, f)))).toBe(f.reference.payloadDigest)
    for (const target of [f, summary]) expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: target.reference })).toMatchObject({ status: 'bound', instructionalRegistered: true })
  })
  test.each(['deleted', 'foreign'] as const)('a %s destination still denies access', async state => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, kind))
    const destinationFolderId = await t.run(ctx => ctx.db.insert('folders', { userId: owner.tokenIdentifier, name: 'Destination', documentCount: 0 }))
    await t.withIdentity(owner).mutation(api.documents.moveDocument, { id: f.documentId, destinationFolderId })
    await expect(t.mutation(internal.documents.finalizeDocumentIndexing, { id: f.documentId, expectedFolderId: destinationFolderId, expectedR2Key: 'owned/source.r1', status: 'success' })).rejects.toThrow('Artifact lineage unavailable')
    await t.run(ctx => ctx.db.patch(f.documentId, { status: 'success' }))
    await t.run(async ctx => {
      if (state === 'deleted') await ctx.db.delete(destinationFolderId)
      else await ctx.db.patch(destinationFolderId, { userId: foreign.tokenIdentifier })
    })
    await expectSourceRevoked(t, f)
    await expect(t.withIdentity(owner).mutation(api.documents.moveDocument, { id: f.documentId, destinationFolderId })).rejects.toThrow()
  })
})

async function replacementLineage(ctx: MutationCtx, f: Fixture, payloadDigest: string) {
  const row = (await ctx.db.get(f.lineageId))!
  const { _id: _id, _creationTime: _time, publication: _publication, validationId: _validation, nextId: _successor, ...fields } = row
  const lineageId = await ctx.db.insert('learnArtifactLineages', { ...fields, payloadDigest })
  const origins = await ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', f.lineageId)).take(9)
  for (const { _id, _creationTime, ...edge } of origins) await ctx.db.insert('learnArtifactLineageOrigins', { ...edge, lineageId })
  const cases = await ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', f.lineageId)).take(33)
  for (const { _id, _creationTime, ...edge } of cases) await ctx.db.insert('learnArtifactCaseBindings', { ...edge, lineageId })
  const sources = await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', f.lineageId)).take(65)
  for (const { _id, _creationTime, ...edge } of sources) await ctx.db.insert('learnArtifactSourceLinks', { ...edge, lineageId })
  const manifestDigest = await sealManifest(ctx, lineageId)
  const { _id: _vid, _creationTime: _vtime, ...validation } = (await ctx.db.get(f.validationId))!
  const catalogRevision = (await ctx.db.get(f.catalogId))!.catalogRevision
  const validationId = await ctx.db.insert('learnArtifactValidations', { ...validation, lineageId, payloadDigest, manifestDigest, comparedCatalogRevision: catalogRevision })
  await ctx.db.patch(lineageId, { validationId })
  return { ...f, lineageId, validationId, manifestDigest, reference: { ...f.reference, payloadDigest }, catalogRevision }
}
const repinnableKinds = ['document', 'document_chunk', 'session_block', 'flashcard_version', 'learner_artifact', 'measurement_item', 'scoring_spec'] as const

describe('round-4 fresh helper calls', () => {
  test.each(['captured', 'bound', 'copied', 'table', 'nested'] as const)('%s writers cannot preserve an earlier admission', async handle => {
    for (const kind of ['reservation', 'availability', 'classification'] as const) {
      const t = convexTest(schema, modules)
      const f = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
      await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))
      await t.withIdentity(owner).run(async raw => {
        const captured = raw.db.patch
        const bound = raw.db.patch.bind(raw.db)
        const copied = { ...raw.db }
        const tables = raw.db as unknown as { table(name: string): { patch(id: string, fields: Record<string, unknown>): Promise<void> } }
        const table = tables.table(kind === 'reservation' ? 'learnAssessmentCases' : kind === 'availability' ? 'documents' : 'learnArtifactLineages')
        const before = Reflect.ownKeys(raw.db)
        const budget = createArtifactLineagePublicationContext(raw)
        expect(await admitArtifactInput(budget.admission.ctx, { reference: f.reference })).toMatchObject({ status: 'admitted_registered' })
        const id = kind === 'reservation' ? f.caseId : kind === 'availability' ? f.documentId : f.lineageId
        const fields = kind === 'reservation' ? { reservedAt: 0 } : kind === 'availability' ? { status: 'indexing' as const } : { classification: 'measurement' as const }
        if (handle === 'captured') await captured(id, fields)
        if (handle === 'bound') await bound(id, fields)
        if (handle === 'copied') await copied.patch(id, fields)
        if (handle === 'table') await table.patch(id, fields)
        if (handle === 'nested') await raw.runMutation(protect, { caseId: f.caseId, documentId: f.documentId, lineageId: f.lineageId, kind })
        expect(await admitArtifactInputs(budget.admission.ctx, { references: [f.reference] })).toMatchObject({ status: 'rejected' })
        expect(Reflect.ownKeys(raw.db)).toEqual(before)
        expect(raw.db.patch).toBe(captured)
      })
    }
  })

  test('one batch validates shared lineage nodes once inside its invocation', async () => {
    const t = convexTest(schema, modules)
    const origin = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(origin)))
    const copy = await t.run(ctx => prepare(ctx, { origin, transformation: 'summary' }))
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(copy)))
    await t.withIdentity(owner).run(async raw => {
      let reads = 0
      const db = new Proxy(raw.db, { get(target, property) {
        const method: unknown = Reflect.get(target, property)
        if (property === 'query' && typeof method === 'function') return (...args: unknown[]) => {
          if (args[0] === 'learnArtifactLineageOrigins') reads++
          return Reflect.apply(method, target, args)
        }
        return typeof method === 'function' ? method.bind(target) : method
      } })
      expect(await admitArtifactInputs({ ...raw, db }, { references: [origin.reference, copy.reference] })).toMatchObject({ status: 'admitted_registered' })
      expect(reads).toBe(2)
    })
  })

  test('one batch reads an artifact inventory once across component aliases', async () => {
    const t = convexTest(schema, modules)
    const a = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    const b = await t.run(async ctx => {
      const next = await replacementLineage(ctx, a, a.reference.payloadDigest)
      const reference = { ...next.reference, key: 'component' }
      await ctx.db.patch(next.lineageId, { key: reference.key })
      return resealed(ctx, { ...next, reference })
    })
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(a)))
    await t.run(ctx => ctx.db.patch(b.validationId, { comparedCatalogRevision: 1 }))
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, { ...registration(b), expectedCatalogRevision: 1 }))
    await t.withIdentity(owner).run(async raw => {
      let reads = 0
      const db = new Proxy(raw.db, { get(target, property) {
        const method: unknown = Reflect.get(target, property)
        if (property === 'query' && typeof method === 'function') return (...args: unknown[]) => {
          if (args[0] === 'learnArtifactLineages') reads++
          return Reflect.apply(method, target, args)
        }
        return typeof method === 'function' ? method.bind(target) : method
      } })
      expect(await admitArtifactInputs({ ...raw, db }, { references: [a.reference, b.reference] })).toMatchObject({ status: 'admitted_registered' })
      expect(reads).toBe(4)
    })
  })

  test('a reservation after a completed resolution prevents a later publication receipt', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    await t.withIdentity(owner).run(async raw => {
      const captured = raw.db.patch
      const budget = createArtifactLineagePublicationContext(raw)
      expect(await resolveArtifactLineageForOwner(budget.admission.ctx, owner.tokenIdentifier, { reference: f.reference })).toMatchObject({ status: 'bound' })
      await captured(f.caseId, { reservedAt: 0 })
      await expect(registerInstructionalArtifactForOwner(budget.preparation.ctx, owner.tokenIdentifier, registration(f))).rejects.toThrow('unavailable')
      expect(await raw.db.get(f.lineageId)).not.toHaveProperty('publication')
      expect((await raw.db.get(f.catalogId))!.catalogRevision).toBe(0)
    })
  })

  test('local edits cannot hide restrictive lineage or an enrollment change at the next call', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))
    await t.withIdentity(owner).run(async raw => {
      const budget = createArtifactLineagePublicationContext(raw)
      const local = (await budget.admission.ctx.db.get(f.lineageId))!
      expect(await admitArtifactInput(budget.admission.ctx, { reference: f.reference })).toMatchObject({ status: 'admitted_registered' })
      local.userId = foreign.tokenIdentifier
      await raw.db.patch(f.lineageId, { classification: 'measurement' })
      expect(await admitArtifactInput(budget.admission.ctx, { reference: f.reference })).toMatchObject({ status: 'rejected' })
      await raw.db.delete(f.lineageId)
      const catalog = (await budget.admission.ctx.db.get(f.catalogId))!
      expect(await admitArtifactInput(budget.admission.ctx, { reference: f.reference })).toMatchObject({ status: 'admitted_unregistered' })
      catalog.userId = foreign.tokenIdentifier
      await raw.db.patch(f.catalogId, { measurementCapability: { enabled: true } })
      expect(await admitArtifactInput(budget.admission.ctx, { reference: f.reference })).toMatchObject({ status: 'rejected', reasonCode: 'registration_required' })
    })
  })

  test('batch admission keeps authority, cardinality, strict fields and the most restrictive result', async () => {
    const t = convexTest(schema, modules)
    const a = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work', fingerprint: 'a' }))
    const b = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work', fingerprint: 'b' }))
    await t.run(ctx => ctx.db.delete(a.lineageId))
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(b)))
    const args = { references: [a.reference, b.reference] }
    for (const operation of [
      () => t.withIdentity(owner).run(ctx => admitArtifactInputs(ctx, args)),
      () => t.withIdentity(owner).run(ctx => admitArtifactInputsForOwner(ctx, owner.tokenIdentifier, args)),
      () => t.run(ctx => admitArtifactInputsForRecord(ctx, { kind: 'document', id: a.documentId }, args)),
    ]) expect(await operation()).toMatchObject({ status: 'admitted_unregistered' })
    await expect(t.withIdentity(foreign).run(ctx => admitArtifactInputsForOwner(ctx, owner.tokenIdentifier, args))).rejects.toThrow('Learn access denied')
    await expect(t.run(ctx => admitArtifactInputsForRecord(ctx, { kind: 'document', id: a.documentId, userId: owner.tokenIdentifier } as never, args))).rejects.toThrow()
    for (const input of [{ references: [] }, { references: Array.from({ length: 65 }, () => a.reference) }, { ...args, decision: 'pass' }, { references: [{ ...a.reference, classification: 'teaching' }] }]) {
      await expect(t.withIdentity(owner).run(ctx => admitArtifactInputs(ctx, input))).rejects.toThrow()
    }
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInputs(ctx, { references: Array.from({ length: 64 }, () => a.reference) }))).toMatchObject({ status: 'admitted_unregistered' })
    await t.run(ctx => ctx.db.patch(b.lineageId, { classification: 'private_scoring' }))
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInputs(ctx, args))).toMatchObject({ status: 'rejected' })
  })

  test.each(['registered_first', 'unregistered_first'] as const)('batch admission preserves returned rejection in %s order', async order => {
    const t = convexTest(schema, modules)
    const registered = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work', fingerprint: 'a' }))
    const ordinary = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work', fingerprint: 'b' }))
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(registered)))
    await t.run(async ctx => {
      await ctx.db.delete(ordinary.lineageId)
      await ctx.db.patch(registered.catalogId, { measurementCapability: { enabled: true } })
    })
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference: registered.reference }))).toMatchObject({ status: 'admitted_registered' })
    const references = order === 'registered_first' ? [registered.reference, ordinary.reference] : [ordinary.reference, registered.reference]
    for (const operation of [
      () => t.withIdentity(owner).run(ctx => admitArtifactInputs(ctx, { references })),
      () => t.withIdentity(owner).run(ctx => admitArtifactInputsForOwner(ctx, owner.tokenIdentifier, { references })),
      () => t.run(ctx => admitArtifactInputsForRecord(ctx, { kind: 'document', id: registered.documentId }, { references })),
    ]) expect(await operation()).toMatchObject({ status: 'rejected', reasonCode: 'registration_required' })
  })

  test.each(['cache', 'share', 'offline'] as const)('%s follow-up rechecks lineage before publication', async transport => {
    for (const state of ['ordinary', 'reserved', 'private'] as const) {
      const t = convexTest(schema, modules)
      const f = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
      await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))
      expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference: f.reference }))).toMatchObject({ status: 'admitted_registered' })
      if (state === 'reserved') await t.run(ctx => ctx.db.patch(f.caseId, { reservedAt: 0 }))
      if (state === 'private') await t.run(ctx => ctx.db.patch(f.lineageId, { classification: 'private_scoring' }))
      const decision = await t.withIdentity(owner).run(async ctx => {
        const result = await admitArtifactInputs(ctx, { references: [f.reference] })
        if (result.status === 'rejected') return result
        await ctx.db.insert('quizzes', { userId: owner.tokenIdentifier, folderId: f.folderId, title: `${transport} publication`, status: 'ready', questionCount: 0, creationMethod: 'auto_generated' })
        return result
      })
      expect(decision.status).toBe(state === 'ordinary' ? 'admitted_registered' : 'rejected')
      const publications = await t.run(ctx => ctx.db.query('quizzes').withIndex('by_userId', q => q.eq('userId', owner.tokenIdentifier)).take(2))
      expect(publications).toHaveLength(state === 'ordinary' ? 1 : 0)
    }
  })
})

describe('round-3 shared validation exactness', () => {
  test.each(['short_first', 'long_first'] as const)('shared subtree obeys the depth limit in %s order', async order => {
    for (const edges of [8, 9]) {
      const t = convexTest(schema, modules)
      const fixtures = await t.run(async ctx => {
        const all: Fixture[] = []
        for (let i = 0; i < edges + 1; i++) all.push(await prepare(ctx, { classification: 'genuine_personal_work', fingerprint: (i + 1).toString(16) }))
        const leaf = all[0]!, shared = all[1]!, root = all.at(-1)!
        const chain = all.slice(2, -1)
        for (const f of all) {
          const targets = f === root ? order === 'short_first' ? [shared, chain.at(-1)!] : [chain.at(-1)!, shared]
            : f === shared ? [leaf] : f === leaf ? [] : [chain[chain.indexOf(f) - 1] ?? shared]
          const sources = await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', f.lineageId)).take(65)
          for (const source of sources) await ctx.db.delete(source._id)
          for (const target of targets) await ctx.db.insert('learnArtifactSourceLinks', { ...f.base, lineageId: f.lineageId, evidenceStatus: 'available', dependency: { kind: 'document', documentId: target.documentId, sourceRevision: 'source.r1' } })
          if (!targets.length) await ctx.db.insert('learnArtifactSourceLinks', { ...f.base, lineageId: f.lineageId, evidenceStatus: 'available', dependency: { kind: 'folder', folderId: f.folderId } })
          await ctx.db.patch(f.lineageId, { sourceCount: targets.length || 1 })
          await resealed(ctx, f)
        }
        return all
      })
      for (const [index, f] of fixtures.entries()) await t.withIdentity(owner).run(async ctx => {
        await ctx.db.patch(f.validationId, { comparedCatalogRevision: index })
        await registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, { ...registration(f), expectedCatalogRevision: index })
      })
      const reference = fixtures.at(-1)!.reference
      expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference }))).toMatchObject({ status: edges === 8 ? 'admitted_registered' : 'rejected' })
    }
  })

  test.each(['document_patch', 'document_table_patch', 'document_replace', 'document_delete', 'folder_owner', 'reserved_case', 'validation', 'source_link', 'source_owner_move', 'extra_source', 'duplicate_case', 'unknown_case_patch', 'known_case_patch', 'origin_transform'] as const)('cached facts reject %s after a write through the original context', async mutation => {
    const t = convexTest(schema, modules)
    const f = await t.run(async ctx => {
      const origin = mutation === 'origin_transform' ? await prepare(ctx, { classification: 'genuine_personal_work', fingerprint: 'a' }) : undefined
      return { ...await prepare(ctx, { classification: 'genuine_personal_work', origin, transformation: 'summary', fingerprint: 'b' }), origin }
    })
    if (f.origin) {
      await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f.origin!)))
      await t.run(ctx => ctx.db.patch(f.validationId, { comparedCatalogRevision: 1 }))
      f.catalogRevision = 1
    }
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))
    await t.withIdentity(owner).run(async raw => {
      const spare = await raw.db.insert('learnAssessmentCases', { ...f.base, caseKey: 'unread-case', scenarioFingerprint: 'f'.repeat(64), solutionFingerprint: 'f'.repeat(64), identityPolicyVersion: 'identity.v1', usageClass: 'unknown' })
      const shared = createArtifactLineagePublicationContext(raw)
      if (mutation === 'known_case_patch') await shared.admission.ctx.db.get(spare)
      if (mutation === 'folder_owner') {
        const row = (await raw.db.get(f.lineageId))!
        const cases = await raw.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', f.lineageId)).take(33)
        const sources = await raw.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', f.lineageId)).take(65)
        await artifactManifestDigest(shared.admission.ctx, row, [], cases, sources)
      }
      expect(await admitArtifactInput(shared.admission.ctx, { reference: f.reference })).toMatchObject({ status: 'admitted_registered' })
      if (mutation === 'document_patch') await raw.db.patch(f.documentId, { status: 'indexing' })
      if (mutation === 'document_table_patch') {
        const table = raw.db as unknown as { table(name: 'documents'): { patch(id: Id<'documents'>, fields: { status: 'indexing' }): Promise<void> } }
        await table.table('documents').patch(f.documentId, { status: 'indexing' })
      }
      if (mutation === 'document_replace') {
        const row = (await raw.db.get(f.documentId))!
        const { _id: _id, _creationTime: _time, ...fields } = row
        await raw.db.replace(f.documentId, { ...fields, status: 'failed' })
      }
      if (mutation === 'document_delete') await raw.db.delete(f.documentId)
      if (mutation === 'folder_owner') await raw.db.patch(f.folderId, { userId: foreign.tokenIdentifier })
      if (mutation === 'reserved_case') await raw.db.patch(f.caseId, { reservedAt: 0 })
      if (mutation === 'validation') await raw.db.patch(f.validationId, { invalidatedAt: 0 })
      if (mutation === 'source_link' || mutation === 'source_owner_move') {
        const source = (await raw.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', f.lineageId)).unique())!
        await raw.db.patch(source._id, mutation === 'source_link' ? { invalidatedAt: 0 } : { userId: foreign.tokenIdentifier })
      }
      if (mutation === 'extra_source') await raw.db.insert('learnArtifactSourceLinks', { ...f.base, lineageId: f.lineageId, evidenceStatus: 'available', dependency: { kind: 'folder', folderId: f.folderId } })
      if (mutation === 'duplicate_case' || mutation === 'unknown_case_patch' || mutation === 'known_case_patch') {
        const pin = { scenarioFingerprint: 'b'.repeat(64), solutionFingerprint: 'b'.repeat(64) }
        if (mutation === 'duplicate_case') await raw.db.insert('learnAssessmentCases', { ...f.base, ...pin, caseKey: 'duplicate', identityPolicyVersion: 'identity.v1', usageClass: 'unknown' })
        else await raw.db.patch(spare, pin)
      }
      if (mutation === 'origin_transform') {
        const edge = (await raw.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', f.lineageId)).unique())!
        await raw.db.patch(edge._id, { transformation: 'copy' })
      }
      expect(await admitArtifactInput(shared.admission.ctx, { reference: f.reference })).toMatchObject({ status: 'rejected' })
    })
  })

  test('source and inventory caches recover after rejection and see enrollment changes', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))
    await t.withIdentity(owner).run(async raw => {
      const shared = createArtifactLineagePublicationContext(raw)
      await raw.db.patch(f.documentId, { status: 'indexing' })
      expect(await admitArtifactInput(shared.admission.ctx, { reference: f.reference })).toMatchObject({ status: 'rejected' })
      await raw.db.patch(f.documentId, { status: 'success' })
      expect(await admitArtifactInput(shared.admission.ctx, { reference: f.reference })).toMatchObject({ status: 'admitted_registered' })
      await raw.db.delete(f.lineageId)
      expect(await admitArtifactInput(shared.admission.ctx, { reference: f.reference })).toMatchObject({ status: 'admitted_unregistered' })
      await raw.db.patch(f.catalogId, { measurementCapability: { enabled: true } })
      expect(await admitArtifactInput(shared.admission.ctx, { reference: f.reference })).toMatchObject({ status: 'rejected', reasonCode: 'registration_required' })
    })
  })

  test('each resolution rereads lineage nodes, origins and sources', async () => {
    const t = convexTest(schema, modules)
    const origin = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    const copy = await t.run(ctx => prepare(ctx, { origin, transformation: 'summary' }))
    const unrelated = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work', fingerprint: 'f' }))
    await t.withIdentity(owner).run(async raw => {
      const reads = new Map<string, number>()
      const db = new Proxy(raw.db, { get(target, property) {
        const method: unknown = Reflect.get(target, property)
        if (property !== 'get' || typeof method !== 'function') return typeof method === 'function' ? method.bind(target) : method
        return (...args: unknown[]) => {
          const id = String(args.at(-1))
          reads.set(id, (reads.get(id) ?? 0) + 1)
          return Reflect.apply(method, target, args)
        }
      } })
      const budget = createArtifactLineagePublicationContext({ ...raw, db })
      for (const ctx of [budget.admission.ctx, budget.preparation.ctx]) {
        for (const f of [origin, copy]) expect(await resolveArtifactLineageForOwner(ctx, owner.tokenIdentifier, { reference: f.reference })).toMatchObject({ status: 'bound' })
        if (ctx === budget.admission.ctx) {
          await raw.db.insert('learnArtifactSourceLinks', { ...origin.base, lineageId: unrelated.lineageId, evidenceStatus: 'available', dependency: { kind: 'folder', folderId: unrelated.folderId } })
          await advanceAssessmentCatalogForOwner(budget.preparation.ctx, owner.tokenIdentifier, 0)
        }
      }
      for (const id of [origin.documentId, origin.validationId]) expect(reads.get(id), id).toBe(4)
      expect(reads.get(origin.lineageId)).toBe(2)
    })
  })

  test('reused node facts still compare against the current catalogue revision', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    await t.run(async ctx => {
      await ctx.db.patch(f.catalogId, { catalogRevision: 1 })
      await ctx.db.patch(f.validationId, { comparedCatalogRevision: 1 })
    })
    await t.withIdentity(owner).run(async raw => {
      const budget = createArtifactLineagePublicationContext(raw)
      expect(await resolveArtifactLineageForOwner(budget.admission.ctx, owner.tokenIdentifier, { reference: f.reference })).toMatchObject({ status: 'bound' })
      await raw.db.patch(f.catalogId, { catalogRevision: 0 })
      expect(await resolveArtifactLineageForOwner(budget.admission.ctx, owner.tokenIdentifier, { reference: f.reference })).toMatchObject({ status: 'unavailable' })
    })
  })

  test('projection callers cannot mutate facts retained by the validation cache', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, 'section_block', 'folder'))
    await t.withIdentity(owner).run(async raw => {
      const budget = createArtifactLineagePublicationContext(raw)
      const section = (await raw.db.get(f.sectionId))!
      const first = await sectionContentProjection(budget.admission.ctx, section)
      const expected = await artifactPayloadDigest(first)
      Reflect.set(first, 'payload', {})
      const second = await sectionContentProjection(budget.admission.ctx, section)
      expect(await artifactPayloadDigest(second)).toBe(expected)
      Reflect.set(second, 'payload', {})
      expect(await artifactPayloadDigest(await sectionContentProjection(budget.admission.ctx, section))).toBe(expected)
    })
  })

  test('supersession cannot change an origin transformation', async () => {
    const t = convexTest(schema, modules)
    const origin = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    const f = await t.run(ctx => prepare(ctx, { origin, transformation: 'summary' }))
    const next = await t.run(async ctx => {
      const next = await replacementLineage(ctx, f, f.reference.payloadDigest)
      const edge = (await ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', next.lineageId)).unique())!
      await ctx.db.patch(edge._id, { transformation: 'copy' })
      return resealed(ctx, next)
    })
    await expect(t.withIdentity(owner).run(ctx => supersedeArtifactLineageForOwner(ctx, owner.tokenIdentifier, { previousLineageId: f.lineageId, replacementLineageId: next.lineageId }))).rejects.toThrow('unavailable')
    expect(await t.run(ctx => ctx.db.get(f.lineageId))).not.toHaveProperty('nextId')
  })
})

describe('round-2 admission invariants', () => {
  test.each(documentKinds)('%s successor remains admissible after a stale payload and 16 manifest replacements', async kind => {
    const t = convexTest(schema, modules)
    let f: Fixture = await t.run(async ctx => {
      const initial = await prepare(ctx, { classification: 'genuine_personal_work' })
      const payloadDigest = await artifactPayloadDigest(artifactContentProjection({ kind, document: (await ctx.db.get(initial.documentId))! }))
      const reference = { ...initial.reference, artifact: { kind, id: initial.documentId }, key: kind === 'document_chunk' ? LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY : 'whole', payloadDigest }
      await ctx.db.patch(initial.lineageId, reference)
      await ctx.db.patch(initial.validationId, { payloadDigest })
      return resealed(ctx, { ...initial, reference })
    })
    await t.run(ctx => ctx.db.patch(f.catalogId, { measurementCapability: { enabled: true } }))
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))
    const first = f
    for (let i = 0; i < 17; i++) {
      if (i === 0) await t.run(ctx => ctx.db.patch(f.documentId, { fileSize: 6 }))
      const digest = await t.run(async ctx => artifactPayloadDigest(artifactContentProjection({ kind, document: (await ctx.db.get(f.documentId))! })))
      let next = await t.run(ctx => replacementLineage(ctx, f, digest))
      next = await t.run(async ctx => {
        await ctx.db.patch(next.lineageId, { authorityVersion: `producer.v${i + 2}` })
        return resealed(ctx, next)
      })
      await t.withIdentity(owner).run(async ctx => {
        await supersedeArtifactLineageForOwner(ctx, owner.tokenIdentifier, { previousLineageId: f.lineageId, replacementLineageId: next.lineageId })
        await registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(next))
      })
      f = next
      expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference: f.reference }))).toMatchObject({ status: 'admitted_registered' })
      expect(await t.withIdentity(owner).run(ctx => classifyPersonalWorkDocumentForOwner(ctx, owner.tokenIdentifier, f.documentId))).toMatchObject({ classification: 'genuine_personal_work' })
      expect(await t.run(ctx => classifyPersonalWorkDocumentForRecord(ctx, { kind: 'document', id: f.documentId }))).toMatchObject({ classification: 'genuine_personal_work' })
    }
    expect(await t.withIdentity(owner).run(ctx => resolveArtifactLineageForOwner(ctx, owner.tokenIdentifier, { reference: first.reference }))).toMatchObject({ status: 'unavailable' })
    expect(await t.withIdentity(owner).run(ctx => resolveArtifactLineageForOwner(ctx, owner.tokenIdentifier, { reference: f.reference }))).toMatchObject({ status: 'bound', instructionalRegistered: true })
  })

  test.each(['measurement', 'private_scoring', 'unknown'] as const)('supersession cannot relax %s to teaching', async classification => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx, { classification }))
    const next = await t.run(async ctx => {
      await ctx.db.patch(f.documentId, { fileSize: 6 })
      const digest = await artifactPayloadDigest(artifactContentProjection({ kind: 'document', document: (await ctx.db.get(f.documentId))! }))
      const next = await replacementLineage(ctx, f, digest)
      await ctx.db.patch(next.lineageId, { classification: 'teaching' })
      await resealed(ctx, next)
      return next
    })
    await expect(t.withIdentity(owner).run(ctx => supersedeArtifactLineageForOwner(ctx, owner.tokenIdentifier, { previousLineageId: f.lineageId, replacementLineageId: next.lineageId }))).rejects.toThrow('unavailable')
    expect(await t.run(ctx => ctx.db.get(f.lineageId))).not.toHaveProperty('nextId')
  })

  test('supersession cannot drop a reserved case binding', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work', reserved: true }))
    const next = await t.run(async ctx => {
      await ctx.db.patch(f.documentId, { fileSize: 6 })
      const digest = await artifactPayloadDigest(artifactContentProjection({ kind: 'document', document: (await ctx.db.get(f.documentId))! }))
      const next = await replacementLineage(ctx, f, digest)
      const bindings = await ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', next.lineageId)).take(33)
      for (const binding of bindings) await ctx.db.delete(binding._id)
      await ctx.db.patch(next.lineageId, { caseCount: 0 })
      await resealed(ctx, next)
      return next
    })
    await expect(t.withIdentity(owner).run(ctx => supersedeArtifactLineageForOwner(ctx, owner.tokenIdentifier, { previousLineageId: f.lineageId, replacementLineageId: next.lineageId }))).rejects.toThrow('unavailable')
    expect(await t.run(ctx => ctx.db.get(f.caseId))).toHaveProperty('reservedAt')
  })

  test.each(['measurement_cold', 'measurement_delayed'] as const)('parent %s denies admission and preparation without content duplicates', async purpose => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, 'session_block'))
    await t.run(async ctx => {
      await ctx.db.delete(f.lineageId)
      await ctx.db.patch(f.sessionId, { assessmentPurpose: purpose })
    })
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference: f.reference }))).toMatchObject({ status: 'rejected', reasonCode: 'restricted_lineage' })
    await t.run(ctx => ctx.db.patch(f.catalogId, { measurementCapability: { enabled: true } }))
    await expect(t.withIdentity(owner).run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [{ artifact: f.reference.artifact, key: 'whole', origins: [], sources: [] }] }))).rejects.toThrow('unavailable')
  })

  test.each(['session_block', 'quiz_question', 'section_block', 'flashcard_version', 'audio_overview', 'learner_artifact'] as const)('%s inventory cannot disappear from ordinary admission', async kind => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, kind))
    await t.run(async ctx => { await ctx.db.patch(f.lineageId, { classification: 'private_scoring', authority: 'server_producer' }); await resealed(ctx, f) })
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference: f.reference }))).toMatchObject({ status: 'rejected', reasonCode: 'restricted_lineage' })
  })

  test.each(['quiz_question', 'flashcard_version', 'audio_overview'] as const)('%s admits its complete payload only when its document source is admissible', async kind => {
    const t = convexTest(schema, modules)
    let f = await t.run(ctx => prepareMatrix(ctx, kind))
    const source = await t.run(ctx => prepare(ctx, { classification: 'measurement', fingerprint: 'e' }))
    f = await t.run(async ctx => {
      await ctx.db.delete(f.lineageId)
      if (kind === 'quiz_question') await ctx.db.patch(f.questionId, { sourceDocumentId: source.documentId })
      if (kind === 'flashcard_version') await ctx.db.patch(f.cardId, { sourceDocumentId: source.documentId })
      if (kind === 'audio_overview') await ctx.db.patch(f.overviewId, { sourceDocumentIds: [source.documentId] })
      return f
    })
    const digest = await t.run(async ctx => artifactPayloadDigest(await currentContent(ctx, f)))
    const reference = { ...f.reference, payloadDigest: digest, ...(kind === 'flashcard_version' ? {} : { revision: `sha256:${digest}` }) }
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference }))).toMatchObject({ status: 'rejected', reasonCode: 'restricted_lineage' })
  })

  test('section admission includes a private linked Quiz question', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, 'quiz_question'))
    const reference = await t.run(async ctx => {
      await ctx.db.patch(f.lineageId, { classification: 'private_scoring', authority: 'server_producer' })
      await resealed(ctx, f)
      await ctx.db.patch(f.sectionId, { contentBlocks: [{ type: 'quiz', entityId: f.quizId, order: 0 }] })
      const digest = await artifactPayloadDigest(await sectionContentProjection(ctx, (await ctx.db.get(f.sectionId))!))
      return { artifact: { kind: 'section_block' as const, id: f.sectionId }, key: 'whole', revision: `sha256:${digest}`, payloadDigest: digest }
    })
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference: f.reference }))).toMatchObject({ status: 'rejected', reasonCode: 'restricted_lineage' })
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference }))).toMatchObject({ status: 'rejected', reasonCode: 'restricted_lineage' })
  })

  test.each([false, true].flatMap(registered => ['opportunity_only', 'matching_measurement', 'mismatched_purposes', 'content_without_parent'].map(pins => ({ registered, pins }))))('session duplicate pins $pins reject with registration $registered', async ({ registered, pins }) => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, 'session_block'))
    if (registered) await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))
    await t.run(async ctx => {
      const item = (await ctx.db.get(f.itemId))!
      const opportunityId = await ctx.db.insert('learnAssessmentOpportunities', { ...f.base, evidenceStatus: 'available', scopeKind: 'v2',
        learningVoidId: f.artifactVoidId, blueprintRevisionId: f.blueprintRevisionId, blueprintRecordRevision: 1, objectiveId: item.objectiveId,
        assessmentContractVersion: item.assessmentContractVersion, assessmentContractDigest: item.assessmentContractDigest, depth: item.depth,
        contextPins: { kind: 'calibration' }, purpose: { kind: 'calibration' }, delayedCheckId: 'session-input',
        assessmentPins: { kind: 'calibration', caseId: f.caseId, promptDigest: 'a'.repeat(64), assessmentContractVersion: 'assessment.v1', assessmentContractDigest: 'a'.repeat(64), supportManifestDigest: 'a'.repeat(64) },
        scoringBinding: { kind: 'deterministic', engineVersion: 'fixture.v1', thresholdVersion: 'fixture.v1', thresholdPercent: 80, transitionVersion: 'learn-v2.mastery-transition.v1' },
        phase: 'ready', revision: 1, eligibilityPolicyVersion: 'fixture.v1', operationalEligibility: 'eligible', openAt: f.base.createdAt, closeAt: f.base.createdAt + 1000, checkSequence: 0, originalSlot: true })
      await ctx.db.patch(f.catalogId, { measurementCapability: { enabled: registered } })
      if (pins === 'opportunity_only') await ctx.db.patch(f.sessionId, { assessmentOpportunityId: opportunityId })
      if (pins === 'matching_measurement' || pins === 'mismatched_purposes') {
        await ctx.db.patch(f.sessionId, { assessmentPurpose: 'measurement_cold', assessmentOpportunityId: opportunityId })
        await ctx.db.patch(f.contentId, { assessmentPurpose: pins === 'matching_measurement' ? 'measurement_cold' : 'measurement_delayed', assessmentOpportunityId: opportunityId })
      }
      if (pins === 'content_without_parent') await ctx.db.patch(f.contentId, { assessmentPurpose: 'measurement_delayed', assessmentOpportunityId: opportunityId })
    })
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference: f.reference }))).toMatchObject({ status: 'rejected', reasonCode: 'restricted_lineage' })
    await t.run(ctx => ctx.db.patch(f.catalogId, { measurementCapability: { enabled: true } }))
    const before = await t.run(ctx => ctx.db.get(f.catalogId))
    await expect(t.withIdentity(owner).run(async ctx => {
      const id = await ctx.db.insert('sessionContentBlocks', { userId: owner.tokenIdentifier, sessionContentId: f.contentId, order: 1, kind: 'explanation', content: 'New ordinary-looking block' })
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [{ artifact: { kind: 'session_block', id }, key: 'whole', origins: [], sources: [] }] })
    })).rejects.toThrow('unavailable')
    expect(await t.run(ctx => ctx.db.get(f.catalogId))).toEqual(before)
  })

  test.each(['flashcard_version', 'audio_overview'] as const)('section admission includes a protected linked %s', async kind => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, kind))
    const reference = await t.run(async ctx => {
      await ctx.db.patch(f.lineageId, { classification: 'private_scoring', authority: 'server_producer' })
      await resealed(ctx, f)
      await ctx.db.patch(f.sectionId, { contentBlocks: [{ type: kind === 'flashcard_version' ? 'flashcard' : 'audio', entityId: kind === 'flashcard_version' ? f.flashcardRoomId : f.overviewId, order: 0 }] })
      const digest = await artifactPayloadDigest(await sectionContentProjection(ctx, (await ctx.db.get(f.sectionId))!))
      return { artifact: { kind: 'section_block' as const, id: f.sectionId }, key: 'whole', revision: `sha256:${digest}`, payloadDigest: digest }
    })
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference }))).toMatchObject({ status: 'rejected', reasonCode: 'restricted_lineage' })
  })

  test('retained sources are admitted even when the payload has no document reference', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, 'learner_artifact'))
    const source = await t.run(ctx => prepare(ctx, { classification: 'measurement', fingerprint: 'e' }))
    await t.run(async ctx => {
      await ctx.db.patch(f.linkId, { dependency: { kind: 'document', documentId: source.documentId, sourceRevision: 'source.r1' } })
      await resealed(ctx, f)
    })
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference: f.reference }))).toMatchObject({ status: 'rejected', reasonCode: 'restricted_lineage' })
  })

  test('retained origins admit their own nested projected sources', async () => {
    const t = convexTest(schema, modules)
    let origin = await t.run(ctx => prepareMatrix(ctx, 'audio_overview'))
    const source = await t.run(ctx => prepare(ctx, { classification: 'measurement', fingerprint: 'e' }))
    await t.run(ctx => ctx.db.patch(origin.overviewId, { sourceDocumentIds: [source.documentId] }))
    origin = await repinContent(t, origin)
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(origin)))
    const summary = await t.run(ctx => prepare(ctx, { origin, transformation: 'summary' }))
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(summary)))
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference: summary.reference }))).toMatchObject({ status: 'rejected', reasonCode: 'restricted_lineage' })
  })

  test('a registered aggregate with an unregistered source is ordinary only while unenrolled', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, 'quiz_question'))
    await t.run(ctx => ctx.db.patch(f.questionId, { sourceDocumentId: f.sourceDocumentId }))
    const pinned = await repinContent(t, f)
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(pinned)))
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference: pinned.reference }))).toMatchObject({ status: 'admitted_unregistered' })
    await t.run(ctx => ctx.db.patch(f.catalogId, { measurementCapability: { enabled: true } }))
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference: pinned.reference }))).toMatchObject({ status: 'rejected', reasonCode: 'registration_required' })
  })

  test.each(['revision', 'contentHash'] as const)('an unregistered V2 Audio source must retain its declared %s', async pin => {
    const t = convexTest(schema, modules)
    const f = await preparePlaybackDifferential(t, false)
    const reference = await t.run(async ctx => {
      await ctx.db.delete(f.lineageId)
      await ctx.db.patch(f.entryId, { [pin]: pin === 'revision' ? 'stale.r0' : '0'.repeat(64) })
      const digest = await artifactPayloadDigest(await audioOverviewContentProjection(ctx, (await ctx.db.get(f.overviewId))!))
      return { ...f.reference, payloadDigest: digest, revision: `sha256:${digest}` }
    })
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference }))).toMatchObject({ status: 'rejected', reasonCode: 'lineage_unavailable' })
  })

  test.each([false, true].flatMap(enrolled => ['missing_version', 'changed_cards'].map(condition => ({ enrolled, condition }))))('section cards $condition retain ordinary status with enrollment $enrolled', async ({ enrolled, condition }) => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, 'flashcard_version', 'folder'))
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))
    const section = await t.run(async ctx => {
      const card = (await ctx.db.get(f.cardId))!
      await ctx.db.insert('flashcardRoomCards', { userId: owner.tokenIdentifier, roomId: f.flashcardRoomId, displayOrder: 0, term: card.term, definition: condition === 'changed_cards' ? 'Edited current definition' : card.definition })
      if (condition === 'missing_version') await ctx.db.patch(f.flashcardRoomId, { activeVersionId: undefined })
      await ctx.db.patch(f.sectionId, { contentBlocks: [{ type: 'flashcard', entityId: f.flashcardRoomId, order: 0 }] })
      const payloadDigest = await artifactPayloadDigest(await sectionContentProjection(ctx, (await ctx.db.get(f.sectionId))!))
      const reference = { artifact: { kind: 'section_block' as const, id: f.sectionId }, key: 'whole', revision: `sha256:${payloadDigest}`, payloadDigest }
      const parent = await prepare(ctx, { classification: 'genuine_personal_work', fingerprint: 'e' })
      await ctx.db.patch(parent.lineageId, reference)
      const source = (await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', parent.lineageId)).unique())!
      await ctx.db.patch(source._id, { dependency: { kind: 'folder', folderId: f.folderId } })
      await ctx.db.patch(parent.validationId, { payloadDigest })
      return resealed(ctx, { ...parent, reference })
    })
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(section)))
    await t.run(ctx => ctx.db.patch(f.catalogId, { measurementCapability: { enabled: enrolled } }))
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference: section.reference }))).toMatchObject(enrolled ? { status: 'rejected', reasonCode: 'registration_required' } : { status: 'admitted_unregistered' })
  })

  test.each([9, 10])('nested source admission bounds a chain of %s artifacts', async count => {
    const t = convexTest(schema, modules)
    let previous: Fixture | undefined
    for (let i = 0; i < count; i++) {
      const f = await t.run(async ctx => {
        const current = await prepare(ctx, { classification: 'genuine_personal_work', fingerprint: (i + 1).toString(16) })
        if (previous) {
          const link = (await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', current.lineageId)).unique())!
          await ctx.db.patch(link._id, { dependency: { kind: 'document', documentId: previous.documentId, sourceRevision: 'source.r1' } })
          return resealed(ctx, current)
        }
        return current
      })
      await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))
      previous = f
    }
    if (!previous) throw new Error('Missing source chain')
    const reference = previous.reference
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference }))).toMatchObject({ status: count === 9 ? 'admitted_registered' : 'rejected' })
  })

  test('cyclic retained sources cannot authorize each other', async () => {
    const t = convexTest(schema, modules)
    const [a, b] = await t.run(async ctx => {
      const a = await prepare(ctx, { classification: 'genuine_personal_work', fingerprint: 'a' })
      const b = await prepare(ctx, { classification: 'genuine_personal_work', fingerprint: 'b' })
      for (const [parent, child] of [[a, b], [b, a]]) {
        if (!parent || !child) throw new Error('Missing cycle fixture')
        const link = (await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', parent.lineageId)).unique())!
        await ctx.db.patch(link._id, { dependency: { kind: 'document', documentId: child.documentId, sourceRevision: 'source.r1' } })
        await resealed(ctx, parent)
      }
      return [a, b] as const
    })
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(a)))
    await t.run(ctx => ctx.db.patch(b.validationId, { comparedCatalogRevision: 1 }))
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, { ...registration(b), expectedCatalogRevision: 1 }))
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference: a.reference }))).toMatchObject({ status: 'rejected', reasonCode: 'lineage_unavailable' })
  })

  test('Audio encoding and range ceilings return explicit rejection before publication', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareV2Audio(ctx))
    await t.run(async ctx => {
      const episode = (await ctx.db.get(f.episodeId))!
      await ctx.db.insert('audioOverviewClaims', { userId: owner.tokenIdentifier, jobId: episode.jobId, ledgerId: episode.claimLedgerId, order: 0, claimId: 'large', text: 'x'.repeat(500000), status: 'supported', createdAt: f.base.createdAt })
      await ctx.db.patch(f.catalogId, { measurementCapability: { enabled: true } })
    })
    const rejected = { status: 'rejected', reasonCode: 'projection_exceeds_budget' }
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference: f.reference }))).toMatchObject(rejected)
    await expect(t.withIdentity(owner).run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [{ artifact: f.reference.artifact, key: 'whole', origins: [], sources: [] }] }))).rejects.toMatchObject({ data: rejected })
    expect(await t.withIdentity(owner).run(async ctx => {
      const budget = createArtifactLineageReadContext(ctx)
      for (let i = 0; i < 2040; i++) await budget.ctx.db.query('learnAssessmentCases').withIndex('by_userId', q => q.eq('userId', 'absent')).take(1)
      return admitArtifactInput(budget.ctx, { reference: f.reference })
    })).toMatchObject(rejected)
  })

  test('oversized linked component inventories are rejected rather than truncated', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, 'section_block', 'folder'))
    await t.run(async ctx => {
      await ctx.db.delete(f.lineageId)
      await ctx.db.patch(f.sectionId, { contentBlocks: [{ type: 'quiz', entityId: f.quizId, order: 0 }] })
      for (let i = 1; i <= 200; i++) await ctx.db.insert('quizQuestions', { userId: owner.tokenIdentifier, quizId: f.quizId, order: i, question: `Question ${i}`, type: 'free-response', correctAnswer: `Solution ${i}` })
    })
    await expect(t.withIdentity(owner).run(async ctx => {
      const projection = await sectionContentProjection(ctx, (await ctx.db.get(f.sectionId))!)
      const payloadDigest = await artifactPayloadDigest(projection)
      return admitArtifactInput(ctx, { reference: { artifact: { kind: 'section_block', id: f.sectionId }, key: 'whole', revision: `sha256:${payloadDigest}`, payloadDigest } })
    })).rejects.toThrow('unavailable')
  })
})

describe.each(repinnableKinds)('B1 supersession: %s', kind => {
  test('repins after a projection-version bump, preserves stable lineage and leaves the old row unavailable', async () => {
    const t = convexTest(schema, modules)
    let f = await t.run(ctx => prepareMatrix(ctx, kind))
    if (kind === 'measurement_item' || kind === 'scoring_spec') await t.run(ctx => ctx.db.patch(f.caseId, { reservedAt: f.base.createdAt }))
    else await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))
    const currentDigest = f.reference.payloadDigest
    // Stored rows from a prior projection version remain sealed to that version.
    f = await t.run(async ctx => {
      const projection = await currentContent(ctx, f)
      const payloadDigest = await artifactPayloadDigest({ ...projection, version: 'learn-v2.artifact-content.v0' })
      const reference = { ...f.reference, payloadDigest }
      await ctx.db.patch(f.lineageId, reference)
      const manifestDigest = await sealManifest(ctx, f.lineageId)
      await ctx.db.patch(f.validationId, { payloadDigest, manifestDigest })
      return { ...f, reference, manifestDigest }
    })
    expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'unavailable' })
    const successor = await t.run(ctx => replacementLineage(ctx, f, currentDigest))
    const input = { previousLineageId: f.lineageId, replacementLineageId: successor.lineageId }
    await t.withIdentity(owner).run(async ctx => {
      await supersedeArtifactLineageForOwner(ctx, owner.tokenIdentifier, input)
      if (kind !== 'measurement_item' && kind !== 'scoring_spec') await registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(successor))
    })
    expect(await t.run(ctx => ctx.db.get(f.lineageId))).toHaveProperty('nextId', successor.lineageId)
    expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: successor.reference })).toMatchObject({ status: 'bound', classification: f.classification,
      cases: [{ caseId: f.caseId, usageClass: kind === 'measurement_item' || kind === 'scoring_spec' ? 'measurement_reserved' : 'instructional' }] })
    expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'unavailable' })
  })
  test('a stranded prior-version row without a successor stays unavailable', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, kind))
    await t.run(async ctx => {
      const payloadDigest = await artifactPayloadDigest({ ...await currentContent(ctx, f), version: 'learn-v2.artifact-content.v0' })
      await ctx.db.patch(f.lineageId, { payloadDigest })
      const manifestDigest = await sealManifest(ctx, f.lineageId)
      await ctx.db.patch(f.validationId, { payloadDigest, manifestDigest })
    })
    expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'unavailable' })
    const row = (await t.run(ctx => ctx.db.get(f.lineageId)))!
    expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: { ...f.reference, payloadDigest: row.payloadDigest } })).toMatchObject({ status: 'unavailable' })
  })
})

describe('B1 supersession integrity', () => {
  test('a superseded origin never resurrects through a descendant when benign content pins revert', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    const summary = await t.run(ctx => prepare(ctx, { origin: f, transformation: 'summary' }))
    await t.run(ctx => ctx.db.patch(f.documentId, { fileSize: 6 }))
    const digest = await t.run(async ctx => artifactPayloadDigest(artifactContentProjection({ kind: 'document', document: (await ctx.db.get(f.documentId))! })))
    const next = await t.run(ctx => replacementLineage(ctx, f, digest))
    await t.run(ctx => supersedeArtifactLineageForRecord(ctx, recordFor(f), { previousLineageId: f.lineageId, replacementLineageId: next.lineageId }))
    expect(await t.query(internal.learnV2ArtifactLineage.resolveForRecord, { ownerRecord: recordFor(f), reference: next.reference })).toMatchObject({ status: 'bound' })
    await t.run(ctx => ctx.db.patch(f.documentId, { fileSize: 5 }))
    for (const target of [f, next, summary]) expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: target.reference })).toMatchObject({ status: 'unavailable' })
  })
  test.each(['classification', 'cases', 'sources', 'stale_validation', 'fork'] as const)('rejects a successor with changed %s', async state => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    await t.run(ctx => ctx.db.patch(f.documentId, { fileSize: 6 }))
    const digest = await t.run(async ctx => artifactPayloadDigest(artifactContentProjection({ kind: 'document', document: (await ctx.db.get(f.documentId))! })))
    const next = await t.run(ctx => replacementLineage(ctx, f, digest))
    await t.run(async ctx => {
      if (state === 'classification') await ctx.db.patch(next.lineageId, { classification: 'legacy_history', authority: 'legacy_record' })
      if (state === 'cases') {
        const extra = await prepare(ctx, { fingerprint: 'd' })
        const candidate = (await ctx.db.get(extra.caseId))!
        const binding = (await ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', next.lineageId)).unique())!
        await ctx.db.patch(binding._id, { caseId: extra.caseId, scenarioFingerprint: candidate.scenarioFingerprint, solutionFingerprint: candidate.solutionFingerprint })
      }
      if (state === 'sources') {
        const link = (await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', next.lineageId)).unique())!
        await ctx.db.patch(link._id, { dependency: { kind: 'folder', folderId: f.folderId } })
      }
      if (state === 'fork') await replacementLineage(ctx, f, digest)
      if (state === 'stale_validation') await ctx.db.patch(f.catalogId, { catalogRevision: 1 })
      const manifestDigest = await sealManifest(ctx, next.lineageId)
      await ctx.db.patch(next.validationId, { manifestDigest, ...(state === 'stale_validation' ? { comparedCatalogRevision: 0 } : {}) })
    })
    await expect(t.withIdentity(owner).run(ctx => supersedeArtifactLineageForOwner(ctx, owner.tokenIdentifier, { previousLineageId: f.lineageId, replacementLineageId: next.lineageId }))).rejects.toThrow('unavailable')
    expect(await t.run(ctx => ctx.db.get(f.lineageId))).not.toHaveProperty('nextId')
    expect(await t.run(ctx => ctx.db.get(f.caseId))).toHaveProperty('usageClass', 'unknown')
  })
})

describe('B1 authenticated batch and supersession authority', () => {
  test.each(['unauthenticated', 'foreign', 'tombstoned'] as const)('rejects %s session batch registration', async state => {
    const t = convexTest(schema, modules)
    const fixtures = await prepareQuizBatch(t, 2)
    if (state === 'tombstoned') await t.run(ctx => ctx.db.insert('accountDeletionJobs', { userId: owner.tokenIdentifier, status: 'complete', phase: 'complete', startedAt: 1, updatedAt: 2 }))
    const runner = state === 'unauthenticated' ? t : t.withIdentity(state === 'foreign' ? foreign : owner)
    await expect(runner.run(ctx => registerInstructionalArtifactsForOwner(ctx, owner.tokenIdentifier, batchRegistration(fixtures)))).rejects.toThrow()
    await expectUnpublished(t, fixtures)
  })
  test.each(['foreign', 'tombstoned'] as const)('rejects %s record batch registration', async state => {
    const t = convexTest(schema, modules)
    const fixtures = await prepareQuizBatch(t, 2)
    const f = fixtures[0]!
    if (state === 'foreign') await t.run(ctx => ctx.db.patch(f.documentId, { userId: foreign.tokenIdentifier }))
    else await t.run(ctx => ctx.db.insert('accountDeletionJobs', { userId: owner.tokenIdentifier, status: 'complete', phase: 'complete', startedAt: 1, updatedAt: 2 }))
    await expect(t.run(ctx => registerInstructionalArtifactsForRecord(ctx, recordFor(f), batchRegistration(fixtures)))).rejects.toThrow()
    await expectUnpublished(t, fixtures)
  })
})

describe('B1 supersession retains original derivation', () => {
  test.each(['preserved', 'replaced'] as const)('%s origin retains its immutable case lineage', async state => {
    const t = convexTest(schema, modules)
    const origin = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    const f = await t.run(ctx => prepare(ctx, { origin, transformation: 'summary' }))
    await t.run(ctx => ctx.db.patch(f.documentId, { fileSize: 6 }))
    const digest = await t.run(async ctx => artifactPayloadDigest(artifactContentProjection({ kind: 'document', document: (await ctx.db.get(f.documentId))! })))
    const next = await t.run(ctx => replacementLineage(ctx, f, digest))
    if (state === 'replaced') await t.run(async ctx => {
      const other = await prepare(ctx, { classification: 'genuine_personal_work', fingerprint: 'd' })
      const edge = (await ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', next.lineageId)).unique())!
      await ctx.db.patch(edge._id, { originLineageId: other.lineageId, originRevision: other.reference.revision, originPayloadDigest: other.reference.payloadDigest, originManifestDigest: other.manifestDigest })
      const manifestDigest = await sealManifest(ctx, next.lineageId)
      await ctx.db.patch(next.validationId, { manifestDigest })
    })
    const operation = () => t.withIdentity(owner).run(ctx => supersedeArtifactLineageForOwner(ctx, owner.tokenIdentifier, { previousLineageId: f.lineageId, replacementLineageId: next.lineageId }))
    if (state === 'replaced') await expect(operation()).rejects.toThrow('unavailable')
    else {
      await operation()
      expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: next.reference })).toMatchObject({ status: 'bound', classification: 'genuine_personal_work',
        originLineageIds: [origin.lineageId], cases: [{ caseId: origin.caseId, usageClass: 'unknown' }] })
    }
  })
})

describe('B1 explicit descendant repin', () => {
  test('a derived successor can follow a recorded origin successor without losing classification or cases', async () => {
    const t = convexTest(schema, modules)
    const origin = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    const summary = await t.run(ctx => prepare(ctx, { origin, transformation: 'summary' }))
    await t.run(ctx => ctx.db.patch(origin.documentId, { fileSize: 6 }))
    const originDigest = await t.run(async ctx => artifactPayloadDigest(artifactContentProjection({ kind: 'document', document: (await ctx.db.get(origin.documentId))! })))
    const nextOrigin = await t.run(ctx => replacementLineage(ctx, origin, originDigest))
    await t.withIdentity(owner).run(ctx => supersedeArtifactLineageForOwner(ctx, owner.tokenIdentifier, { previousLineageId: origin.lineageId, replacementLineageId: nextOrigin.lineageId }))
    expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: summary.reference })).toMatchObject({ status: 'unavailable' })
    // Only its origin commitment changes; the summary body remains identical.
    const summaryDigest = await t.run(async ctx => artifactPayloadDigest(artifactContentProjection({ kind: 'document', document: (await ctx.db.get(summary.documentId))! })))
    const nextSummary = await t.run(async ctx => {
      const next = await replacementLineage(ctx, summary, summaryDigest)
      const edge = (await ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', next.lineageId)).unique())!
      await ctx.db.patch(edge._id, { originLineageId: nextOrigin.lineageId, originRevision: nextOrigin.reference.revision, originPayloadDigest: nextOrigin.reference.payloadDigest, originManifestDigest: nextOrigin.manifestDigest })
      const manifestDigest = await sealManifest(ctx, next.lineageId)
      await ctx.db.patch(next.validationId, { manifestDigest })
      return { ...next, manifestDigest }
    })
    await t.withIdentity(owner).run(ctx => supersedeArtifactLineageForOwner(ctx, owner.tokenIdentifier, { previousLineageId: summary.lineageId, replacementLineageId: nextSummary.lineageId }))
    expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: nextSummary.reference })).toMatchObject({ status: 'bound', lineageId: nextSummary.lineageId, classification: 'genuine_personal_work',
      originLineageIds: [nextOrigin.lineageId], cases: [{ caseId: origin.caseId, usageClass: 'unknown' }] })
    expect(await t.run(ctx => ctx.db.get(summary.lineageId))).toHaveProperty('nextId', nextSummary.lineageId)
  })
})

describe('B1 canonical digest encoding', () => {
  test('payload and manifest digests share code-unit ordering and omit undefined object fields', async () => {
    const bytes = new TextEncoder().encode('{"a":[{"a":1,"z":2}],"z":3}')
    const expected = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
    expect(await artifactPayloadDigest({ z: 3, omitted: undefined, a: [{ z: 2, a: 1 }] })).toBe(expected)
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    await t.run(async ctx => {
      const row = (await ctx.db.get(f.lineageId))!
      const cases = await ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', f.lineageId)).take(33)
      const sources = await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', f.lineageId)).take(65)
      const reordered = { ...row, artifact: { id: f.documentId, kind: 'document' as const } }
      expect(await artifactManifestDigest(ctx, reordered, [], cases, sources)).toBe(f.manifestDigest)
    })
  })
})

describe('B1 recorded origin successor bounds', () => {
  test.each([16, 17])('an explicit descendant repin checks a chain of %i origin successors', async hops => {
    const t = convexTest(schema, modules)
    const origin = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    const summary = await t.run(ctx => prepare(ctx, { origin, transformation: 'summary' }))
    let terminal = origin
    for (let i = 0; i < hops; i++) {
      await t.run(ctx => ctx.db.patch(origin.documentId, { fileSize: 6 + i }))
      const digest = await t.run(async ctx => artifactPayloadDigest(artifactContentProjection({ kind: 'document', document: (await ctx.db.get(origin.documentId))! })))
      const next = await t.run(ctx => replacementLineage(ctx, terminal, digest))
      await t.withIdentity(owner).run(ctx => supersedeArtifactLineageForOwner(ctx, owner.tokenIdentifier, { previousLineageId: terminal.lineageId, replacementLineageId: next.lineageId }))
      terminal = next
    }
    const nextSummary = await t.run(async ctx => {
      const next = await replacementLineage(ctx, summary, summary.reference.payloadDigest)
      const edge = (await ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', next.lineageId)).unique())!
      await ctx.db.patch(edge._id, { originLineageId: terminal.lineageId, originRevision: terminal.reference.revision, originPayloadDigest: terminal.reference.payloadDigest, originManifestDigest: terminal.manifestDigest })
      const manifestDigest = await sealManifest(ctx, next.lineageId)
      await ctx.db.patch(next.validationId, { manifestDigest })
      return next
    })
    const operation = () => t.withIdentity(owner).run(ctx => supersedeArtifactLineageForOwner(ctx, owner.tokenIdentifier, { previousLineageId: summary.lineageId, replacementLineageId: nextSummary.lineageId }))
    if (hops > 16) await expect(operation()).rejects.toThrow('unavailable')
    else {
      await operation()
      expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: summary.reference })).toMatchObject({ status: 'bound', lineageId: nextSummary.lineageId, originLineageIds: [terminal.lineageId] })
    }
  })
})

async function resealed<F extends { lineageId: Id<'learnArtifactLineages'>, validationId: Id<'learnArtifactValidations'> }>(ctx: MutationCtx, f: F) {
  const manifestDigest = await sealManifest(ctx, f.lineageId)
  await ctx.db.patch(f.validationId, { manifestDigest })
  return { ...f, manifestDigest }
}
async function supersedeOriginPin(t: TestStore, origin: Fixture) {
  await t.run(ctx => ctx.db.patch(origin.documentId, { fileSize: 6 }))
  const digest = await t.run(async ctx => artifactPayloadDigest(artifactContentProjection({ kind: 'document', document: (await ctx.db.get(origin.documentId))! })))
  const next = await t.run(ctx => replacementLineage(ctx, origin, digest))
  await t.withIdentity(owner).run(ctx => supersedeArtifactLineageForOwner(ctx, owner.tokenIdentifier, { previousLineageId: origin.lineageId, replacementLineageId: next.lineageId }))
  return next
}
const resolveOwned = (t: TestStore, reference: LearnArtifactReference) => t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference })
const contentAddressedKinds = ['quiz_question', 'section_block', 'audio_overview'] as const

describe.each(contentAddressedKinds)('B2 content-addressed re-pin: %s', kind => {
  test('P1: a summary of a re-pinned origin re-pins at its unchanged content revision', async () => {
    const t = convexTest(schema, modules)
    const { origin, summary } = await t.run(async ctx => {
      const content = await prepareMatrix(ctx, kind)
      await ctx.db.patch(content.lineageId, { key: 'unrelated-fixture-row' })
      const origin = await prepare(ctx, { classification: 'genuine_personal_work', fingerprint: 'd' })
      const derived = await prepare(ctx, { origin, transformation: 'summary' })
      await ctx.db.patch(derived.lineageId, content.reference)
      await ctx.db.patch(derived.validationId, { payloadDigest: content.reference.payloadDigest })
      return { origin, summary: await resealed(ctx, { ...derived, reference: content.reference }) }
    })
    expect(await resolveOwned(t, summary.reference)).toMatchObject({ status: 'bound', originLineageIds: [origin.lineageId] })
    const nextOrigin = await supersedeOriginPin(t, origin)
    expect(await resolveOwned(t, summary.reference)).toMatchObject({ status: 'unavailable' })
    const next = await t.run(async ctx => {
      const next = await replacementLineage(ctx, summary, summary.reference.payloadDigest)
      const edge = (await ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', next.lineageId)).unique())!
      await ctx.db.patch(edge._id, { originLineageId: nextOrigin.lineageId, originRevision: nextOrigin.reference.revision, originPayloadDigest: nextOrigin.reference.payloadDigest, originManifestDigest: nextOrigin.manifestDigest })
      return resealed(ctx, next)
    })
    expect(next.reference).toEqual(summary.reference)
    expect(next.manifestDigest).not.toBe(summary.manifestDigest)
    expect(await resolveOwned(t, next.reference)).toMatchObject({ status: 'unavailable' })
    await t.withIdentity(owner).run(async ctx => {
      const budget = createArtifactLineageReadContext(ctx)
      await supersedeArtifactLineageForOwner(budget.ctx, owner.tokenIdentifier, { previousLineageId: summary.lineageId, replacementLineageId: next.lineageId })
      await registerInstructionalArtifactForOwner(budget.ctx, owner.tokenIdentifier, registration(next))
    })
    expect(await t.run(ctx => ctx.db.get(summary.lineageId))).toHaveProperty('nextId', next.lineageId)
    expect(await resolveOwned(t, next.reference)).toMatchObject({ status: 'bound', lineageId: next.lineageId, instructionalRegistered: true, classification: 'genuine_personal_work',
      originLineageIds: [nextOrigin.lineageId], cases: [{ caseId: origin.caseId, usageClass: 'instructional' }] })
  })
  test.each(['unreserved', 'reserved'] as const)('P2: a real same-revision content-hash change re-pins an %s artifact', async state => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, kind, 'document'))
    if (state === 'reserved') await t.run(ctx => ctx.db.patch(f.caseId, { reservedAt: f.base.createdAt }))
    await t.mutation(internal.documents.updateDocumentStatus, { id: f.sourceDocumentId!, status: 'success', contentHash: 'a'.repeat(64) })
    expect(await t.run(ctx => ctx.db.get(f.sourceDocumentId!))).toMatchObject({ sourceRevision: 'source.r1', contentHash: 'a'.repeat(64) })
    expect(await resolveOwned(t, f.reference)).toMatchObject({ status: 'unavailable' })
    expect(await t.run(async ctx => artifactPayloadDigest(await currentContent(ctx, f)))).toBe(f.reference.payloadDigest)
    const next = await t.run(ctx => replacementLineage(ctx, f, f.reference.payloadDigest))
    expect(next.reference).toEqual(f.reference)
    expect(next.manifestDigest).not.toBe(f.manifestDigest)
    expect(await resolveOwned(t, next.reference)).toMatchObject({ status: 'unavailable' })
    await t.run(ctx => supersedeArtifactLineageForRecord(ctx, { kind: 'document', id: f.sourceDocumentId! }, { previousLineageId: f.lineageId, replacementLineageId: next.lineageId }))
    expect(await resolveOwned(t, next.reference)).toMatchObject({ status: 'bound', lineageId: next.lineageId,
      cases: [{ caseId: f.caseId, usageClass: state === 'reserved' ? 'measurement_reserved' : 'unknown' }] })
    if (state === 'reserved') await expect(t.withIdentity(owner).mutation(registerInstructional, registration(next))).rejects.toThrow('unavailable')
    expect((await t.run(ctx => ctx.db.get(f.caseId)))?.reservedAt).toBe(state === 'reserved' ? f.base.createdAt : undefined)
  })
  test.each(['payload', 'classification', 'cases', 'sources', 'fork', 'published', 'source_loss'] as const)('rejects a same-revision successor with changed %s', async state => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, kind, 'document'))
    await t.mutation(internal.documents.updateDocumentStatus, { id: f.sourceDocumentId!, status: 'success', contentHash: 'a'.repeat(64) })
    const changed = await artifactPayloadDigest({ changed: true })
    const next = await t.run(ctx => replacementLineage(ctx, f, state === 'payload' ? changed : f.reference.payloadDigest))
    await t.run(async ctx => {
      if (state === 'classification') await ctx.db.patch(next.lineageId, { classification: 'teaching', authority: 'server_producer' })
      if (state === 'cases') {
        const extra = await prepare(ctx, { fingerprint: 'd' })
        const candidate = (await ctx.db.get(extra.caseId))!
        const binding = (await ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', next.lineageId)).unique())!
        await ctx.db.patch(binding._id, { caseId: extra.caseId, scenarioFingerprint: candidate.scenarioFingerprint, solutionFingerprint: candidate.solutionFingerprint })
      }
      if (state === 'sources') {
        const link = (await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', next.lineageId)).unique())!
        await ctx.db.patch(link._id, { dependency: { kind: 'folder', folderId: f.folderId } })
      }
      if (state === 'fork') await replacementLineage(ctx, f, f.reference.payloadDigest)
      if (state === 'published') await ctx.db.patch(next.lineageId, { publication: { validationId: next.validationId, catalogRevision: 1, publishedAt: 1 } })
      if (['classification', 'cases', 'sources'].includes(state)) await resealed(ctx, next)
      if (state === 'source_loss') await ctx.db.patch(f.sourceDocumentId!, { status: 'failed' })
    })
    await expect(t.withIdentity(owner).run(ctx => supersedeArtifactLineageForOwner(ctx, owner.tokenIdentifier, { previousLineageId: f.lineageId, replacementLineageId: next.lineageId }))).rejects.toThrow('unavailable')
    expect(await t.run(ctx => ctx.db.get(f.lineageId))).not.toHaveProperty('nextId')
  })
})

describe('B2 publication-sized batches', () => {
  test('publishes a generated 50-question Quiz with its writes in one transaction within the measured limits', async () => {
    const t = convexTest(schema, modules)
    const measured = await t.withIdentity(owner).run(async ctx => {
      const fixtures = await seedQuizBatch(ctx, LEARN_ARTIFACT_LINEAGE_LIMITS.maxBatch, true)
      const traced = traceLineageReads(ctx)
      const budget = createArtifactLineageReadContext(traced.ctx)
      const result = await registerInstructionalArtifactsForOwner(budget.ctx, owner.tokenIdentifier, batchRegistration(fixtures))
      expect(result).toMatchObject({ catalogRevision: 1, lineageIds: fixtures.map(f => f.lineageId) })
      expect(result.readUsage).toEqual({ chargedBytes: traced.stats.charged, documentsRead: traced.stats.documents, readRequests: traced.stats.requests, limitBytes: ARTIFACT_LINEAGE_READ_BYTES })
      return { fixtures, ...result.readUsage, ranges: traced.stats.ranges }
    })
    const { fixtures: _fixtures, ...usage } = measured
    console.log(JSON.stringify({ shape: 'presealed 50-question Quiz', ...usage }))
    expect(measured.fixtures).toHaveLength(50)
    // Convex allows 16 MiB read, 32,000 scanned documents and 4,096 index ranges per transaction.
    expect(measured.chargedBytes).toBeLessThan(ARTIFACT_LINEAGE_READ_BYTES / 4)
    expect(measured.documentsRead).toBeLessThan(32_000 / 20)
    expect(measured.ranges).toBeLessThanOrEqual(measured.readRequests)
    expect(measured.ranges).toBeLessThan(4_096 / 3)
    expect(measured.ranges).toBeLessThan(ARTIFACT_LINEAGE_INDEX_RANGES / 2)
    for (const f of measured.fixtures) expect(await resolveOwned(t, f.reference)).toMatchObject({ status: 'bound', instructionalRegistered: true, cases: [{ caseId: f.caseId, usageClass: 'instructional' }] })
  })
  test.each([100, 0])('empty index ranges share a 2,048-range ceiling with %i ranges left', async left => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    const missing = await t.run(async ctx => {
      const id = await ctx.db.insert('learnAssessmentCases', { ...f.base, caseKey: 'deleted', scenarioFingerprint: 'e'.repeat(64), solutionFingerprint: 'e'.repeat(64), identityPolicyVersion: 'identity.v1', usageClass: 'unknown' })
      await ctx.db.delete(id)
      return id
    })
    await t.withIdentity(owner).run(async ctx => {
      const budget = createArtifactLineageReadContext(ctx)
      for (let i = 0; i < ARTIFACT_LINEAGE_INDEX_RANGES - left; i++) expect(await budget.ctx.db.get(missing)).toBeNull()
      expect(budget.readUsage).toMatchObject({ chargedBytes: 0, documentsRead: 0 })
      expect(await resolveArtifactLineageForOwner(budget.ctx, owner.tokenIdentifier, { reference: f.reference })).toMatchObject({ status: left ? 'bound' : 'unavailable' })
    })
  })
  test('rejects 51 distinct members without writes and publishes the first 50', async () => {
    const t = convexTest(schema, modules)
    const fixtures = await prepareQuizBatch(t, LEARN_ARTIFACT_LINEAGE_LIMITS.maxBatch + 1)
    await expect(t.withIdentity(owner).run(ctx => registerInstructionalArtifactsForOwner(ctx, owner.tokenIdentifier, batchRegistration(fixtures)))).rejects.toThrow()
    await expectUnpublished(t, fixtures)
    const admitted = fixtures.slice(0, LEARN_ARTIFACT_LINEAGE_LIMITS.maxBatch)
    expect(await t.withIdentity(owner).run(ctx => registerInstructionalArtifactsForOwner(ctx, owner.tokenIdentifier, batchRegistration(admitted)))).toHaveProperty('lineageIds', admitted.map(f => f.lineageId))
    await expectUnpublished(t, fixtures.slice(LEARN_ARTIFACT_LINEAGE_LIMITS.maxBatch).map(f => ({ ...f, catalogRevision: 1 })))
  })
  test('a document publishes as two members, its document and one chunk set, and per-chunk rows stay unavailable', async () => {
    const t = convexTest(schema, modules)
    const { whole, chunkSet, perChunk } = await t.run(async ctx => {
      const whole = await prepare(ctx, { classification: 'genuine_personal_work' })
      const component = async (key: string, fingerprint: string) => {
        const f = await prepare(ctx, { classification: 'genuine_personal_work', fingerprint })
        const payloadDigest = await artifactPayloadDigest(artifactContentProjection({ kind: 'document_chunk', document: (await ctx.db.get(whole.documentId))! }))
        const reference: LearnArtifactReference = { artifact: { kind: 'document_chunk', id: whole.documentId }, key, revision: 'source.r1', payloadDigest }
        await ctx.db.patch(f.lineageId, reference)
        await ctx.db.patch(f.validationId, { payloadDigest })
        return resealed(ctx, { ...f, reference })
      }
      return { whole, chunkSet: await component(LEARN_ARTIFACT_DOCUMENT_CHUNK_SET_KEY, 'd'), perChunk: await component('chunk-0', 'e') }
    })
    const record = { kind: 'document', id: whole.documentId } as const
    expect(await t.query(internal.learnV2ArtifactLineage.resolveForRecord, { ownerRecord: record, reference: perChunk.reference })).toMatchObject({ status: 'unavailable' })
    await expect(t.run(ctx => registerInstructionalArtifactsForRecord(ctx, record, batchRegistration([whole, perChunk])))).rejects.toThrow('unavailable')
    await expectUnpublished(t, [whole, perChunk])
    expect(await t.run(ctx => registerInstructionalArtifactsForRecord(ctx, record, batchRegistration([whole, chunkSet])))).toMatchObject({ catalogRevision: 1, lineageIds: [whole.lineageId, chunkSet.lineageId] })
    expect(await t.query(internal.learnV2ArtifactLineage.resolveForRecord, { ownerRecord: record, reference: chunkSet.reference })).toMatchObject({ status: 'bound', instructionalRegistered: true })
  })
})

describe('B2 shared case proofs', () => {
  test.each(['origin_first', 'summary_first'] as const)('a shared case records its binding member validation with %s', async order => {
    const t = convexTest(schema, modules)
    const { origin, summary } = await t.run(async ctx => {
      const origin = await prepare(ctx, { classification: 'genuine_personal_work' })
      return { origin, summary: await prepare(ctx, { origin, transformation: 'summary' }) }
    })
    const members = order === 'origin_first' ? [origin, summary] : [summary, origin]
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactsForOwner(ctx, owner.tokenIdentifier, batchRegistration(members)))
    expect(await t.run(ctx => ctx.db.get(origin.caseId))).toMatchObject({ usageClass: 'instructional', artifactIdentityValidationId: origin.validationId })
  })
  test('a member that rebinds a shared case keeps its own binding ahead of the origin it copies', async () => {
    const t = convexTest(schema, modules)
    const { origin, copy } = await t.run(async ctx => {
      const origin = await prepare(ctx, { classification: 'genuine_personal_work' })
      const copy = await prepare(ctx, { origin, transformation: 'copy' })
      const candidate = (await ctx.db.get(origin.caseId))!
      await ctx.db.insert('learnArtifactCaseBindings', { ...copy.base, lineageId: copy.lineageId, caseId: origin.caseId,
        scenarioFingerprint: candidate.scenarioFingerprint, solutionFingerprint: candidate.solutionFingerprint, identityPolicyVersion: candidate.identityPolicyVersion })
      await ctx.db.patch(copy.lineageId, { caseCount: 1 })
      return { origin, copy: await resealed(ctx, copy) }
    })
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactsForOwner(ctx, owner.tokenIdentifier, batchRegistration([copy, origin])))
    expect(await t.run(ctx => ctx.db.get(origin.caseId))).toMatchObject({ usageClass: 'instructional', artifactIdentityValidationId: copy.validationId })
  })
  test('a later derived registration keeps the recorded case proof', async () => {
    const t = convexTest(schema, modules)
    const origin = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    await t.withIdentity(owner).mutation(registerInstructional, registration(origin))
    const summary = await t.run(ctx => prepare(ctx, { origin, transformation: 'summary' }))
    expect(summary.catalogRevision).toBe(1)
    await t.withIdentity(owner).mutation(registerInstructional, registration(summary))
    expect(await t.run(ctx => ctx.db.get(summary.lineageId))).toHaveProperty('publication.catalogRevision', 2)
    expect(await t.run(ctx => ctx.db.get(origin.caseId))).toMatchObject({ usageClass: 'instructional', artifactIdentityValidationId: origin.validationId })
  })
})


describe('round-2 maximum Audio Overview read footprint', () => {
  test('measures every canonical playback row once at the existing producer maxima', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareV2Audio(ctx))
    const e = (await t.run(ctx => ctx.db.get(f.episodeId)))!
    const sizes: Record<string, { rows: number, bytes: number }> = {}
    async function insert<T extends TableNames>(ctx: MutationCtx, table: T, value: WithoutSystemFields<Doc<T>>) {
      const id = await ctx.db.insert(table, value)
      const row = (await ctx.db.get(id))!
      const total = sizes[table] ??= { rows: 0, bytes: 0 }
      total.rows++
      total.bytes += getDocumentSize(row as Record<string, Value>)
      return id
    }
    const base = { userId: owner.tokenIdentifier, jobId: e.jobId, createdAt: f.base.createdAt }
    const entries = await t.run(async ctx => {
      const ids = []
      for (let i = 0; i < 50; i++) {
        const id = await insert(ctx, 'documents', { userId: base.userId, folderId: f.folderId, filename: `source-${i}`, fileSize: 1, status: 'success', sourceRevision: `sha256:${'f'.repeat(64)}`, contentHash: 'f'.repeat(64), r2Key: `owned/source-${i}` })
        ids.push(await insert(ctx, 'audioOverviewSourceManifestEntries', { ...base, manifestId: e.sourceManifestId, order: i, sourceId: `source-${i}-${'s'.repeat(145)}`, documentId: id, revision: `sha256:${'f'.repeat(64)}`, contentHash: 'f'.repeat(64), displayReference: 'd'.repeat(1000) }))
      }
      for (let i = 0; i < 12; i++) await insert(ctx, 'audioOverviewLearningObjectives', { ...base, outlineId: e.outlineId, order: i, text: 'o'.repeat(1000) })
      for (let i = 0; i < 50; i++) await insert(ctx, 'audioOverviewOutlineSources', { ...base, outlineId: e.outlineId, order: i, manifestEntryId: ids[i]! })
      await ctx.db.patch(e.sourceManifestId, { entryCount: 50 })
      await ctx.db.patch(e.outlineId, { narrativeArc: 'n'.repeat(4000), learningObjectiveCount: 12 })
      await ctx.db.patch(e.claimLedgerId, { claimCount: 500, supportedClaimCount: 500 })
      await ctx.db.patch(e._id, { sceneCount: 24, utteranceCount: 400 })
      return ids
    })
    const claims: Id<'audioOverviewClaims'>[] = []
    for (let batch = 0; batch < 5; batch++) claims.push(...await t.run(async ctx => {
      const ids = []
      for (let i = batch * 100; i < (batch + 1) * 100; i++) {
        const id = await insert(ctx, 'audioOverviewClaims', { ...base, ledgerId: e.claimLedgerId, order: i, claimId: `claim-${i}-${'c'.repeat(90)}`, text: '界'.repeat(4000), status: 'supported', verificationVersion: 'claim-entailment.v1', verificationModel: '界'.repeat(200), entailmentDecision: 'entailed', entailmentReason: '界'.repeat(500) })
        ids.push(id)
        for (let j = 0; j < 1; j++) await insert(ctx, 'audioOverviewClaimSources', { ...base, ledgerId: e.claimLedgerId, claimRecordId: id, manifestEntryId: entries[j]! })
      }
      return ids
    }))
    const scenes = await t.run(async ctx => {
      const ids = []
      for (let i = 0; i < 24; i++) ids.push(await insert(ctx, 'audioOverviewScenes', { episodeId: e._id, jobId: e.jobId, userId: e.userId, order: i, title: 't'.repeat(300), narrativePurpose: 'n'.repeat(2000), targetDurationMs: 300000, durationMs: 300000, status: 'ready', currentAttempt: 1, updatedAt: base.createdAt }))
      return ids
    })
    const utterances: Array<{ id: Id<'audioOverviewUtterances'>, sceneId: Id<'audioOverviewScenes'> }> = []
    for (let batch = 0; batch < 20; batch++) utterances.push(...await t.run(async ctx => {
      const ids = []
      for (let i = batch * 20; i < (batch + 1) * 20; i++) {
        const sceneId = scenes[i % 24]!
        const id = await insert(ctx, 'audioOverviewUtterances', { ...base, episodeId: e._id, sceneId, order: i, sceneOrder: Math.floor(i / 24), speaker: i % 2 ? 'host_b' : 'host_a', text: '界'.repeat(600), emotionalIntent: '界'.repeat(500), deliveryIntent: '界'.repeat(500), pauseAfterMs: 10000, verificationUtteranceId: `utterance-${i}`, verificationVersion: 'claim-entailment.v1', verificationModel: '界'.repeat(200), entailmentDecision: 'entailed', entailmentReason: '界'.repeat(500) })
        ids.push({ id, sceneId })
        for (let j = 0; j < 1; j++) await insert(ctx, 'audioOverviewUtteranceSources', { ...base, episodeId: e._id, utteranceId: id, manifestEntryId: entries[j]! })
        for (let j = 0; j < 13; j++) await insert(ctx, 'audioOverviewUtteranceClaims', { ...base, episodeId: e._id, utteranceId: id, claimRecordId: claims[(i * 13 + j) % 500]! })
      }
      return ids
    }))
    const alignmentId = await t.run(ctx => insert(ctx, 'audioOverviewAlignments', { ...base, episodeId: e._id, artifactId: f.mediaId, status: 'ready', segmentCount: 10000, updatedAt: base.createdAt }))
    await t.run(ctx => ctx.db.patch(e._id, { alignmentId }))
    for (let batch = 0; batch < 10; batch++) await t.run(async ctx => {
      for (let i = batch * 1000; i < (batch + 1) * 1000; i++) {
        const u = utterances[Math.floor(i / 25)]!
        await insert(ctx, 'audioOverviewAlignmentSegments', { ...base, episodeId: e._id, alignmentId, utteranceId: u.id, sceneId: u.sceneId, wordIndex: i % 25, word: '界'.repeat(24), startMs: (i % 25) * 10, endMs: (i % 25) * 10 + 9, confidence: 1 })
      }
    })
    const rows = Object.values(sizes).reduce((sum, value) => sum + value.rows, 0)
    const bytes = Object.values(sizes).reduce((sum, value) => sum + value.bytes, 0)
    console.log(JSON.stringify({ shape: 'canonical V2 Audio Overview', rows, uniqueDocumentBytes: bytes, convexReadLimit: 16 * 1024 * 1024, sizes }))
    const planRows = rows - sizes.documents!.rows - sizes.audioOverviewAlignmentSegments!.rows - sizes.audioOverviewAlignments!.rows
    expect(planRows).toBeLessThan(8192)
    expect(rows).toBeGreaterThan(17000)
    expect(bytes).toBeGreaterThan(16 * 1024 * 1024)

    const rejected = { status: 'rejected', reasonCode: 'projection_exceeds_budget' }
    for (const enabled of [false, true]) {
      await t.run(ctx => ctx.db.patch(f.catalogId, { measurementCapability: { enabled } }))
      const measured = await t.withIdentity(owner).run(async ctx => {
        const traced = traceLineageReads(ctx)
        const budget = createArtifactLineageReadContext(traced.ctx)
        const result = await admitArtifactInput(budget.ctx, { reference: f.reference })
        return { result, usage: budget.readUsage, ranges: budget.indexRanges, actual: traced.stats }
      })
      expect(measured.result).toMatchObject(rejected)
      expect(measured.usage.chargedBytes).toBeLessThanOrEqual(ARTIFACT_LINEAGE_READ_BYTES)
      expect(measured.actual.charged).toBe(measured.usage.chargedBytes)
      expect(measured.actual.charged).toBeLessThanOrEqual(ARTIFACT_LINEAGE_READ_BYTES)
      expect(measured.actual.documents).toBeLessThan(1000)
      expect(measured.ranges).toBeLessThanOrEqual(ARTIFACT_LINEAGE_INDEX_RANGES)
      console.log(JSON.stringify({ shape: 'bounded maximum V2 Audio admission', enabled, ...measured }))
    }
    const before = await t.run(async ctx => ({ title: (await ctx.db.get(f.overviewId))!.title, catalog: await ctx.db.get(f.catalogId), lineages: await ctx.db.query('learnArtifactLineages').withIndex('by_userId', q => q.eq('userId', owner.tokenIdentifier)).take(8) }))
    let preparationBytes = 0
    let preparationRows = 0
    await expect(t.withIdentity(owner).run(async ctx => {
      const traced = traceLineageReads(ctx)
      const total = createArtifactLineagePublicationContext(traced.ctx)
      try {
        await total.preparation.ctx.db.patch(f.overviewId, { title: 'Must roll back' })
        return await prepareAndRegisterInstructionalArtifacts(total.preparation.ctx, { artifacts: [{ artifact: f.reference.artifact, key: 'whole', origins: [], sources: [] }] })
      }
      finally { preparationBytes = traced.stats.charged; preparationRows = traced.stats.documents }
    })).rejects.toMatchObject({ data: rejected })
    expect(preparationBytes).toBeLessThanOrEqual(6 * 1024 * 1024)
    expect(preparationRows).toBeLessThan(1000)
    console.log(JSON.stringify({ shape: 'bounded maximum V2 Audio preparation', preparationBytes, preparationRows }))
    expect(await t.run(async ctx => ({ title: (await ctx.db.get(f.overviewId))!.title, catalog: await ctx.db.get(f.catalogId), lineages: await ctx.db.query('learnArtifactLineages').withIndex('by_userId', q => q.eq('userId', owner.tokenIdentifier)).take(8) }))).toEqual(before)
    const summary = await t.run(ctx => prepare(ctx, { origin: f, transformation: 'summary' }))
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference: summary.reference }))).toMatchObject(rejected)
    expect(learnArtifactInputAdmissionResultSchema.parse(new ArtifactProjectionBudgetError().data)).toMatchObject(rejected)
  })
})

describe('Stage B Audio alignment succession', () => {
  test('completeAlignment registers a new revision while retaining the published case and source bindings', async () => {
    const t = convexTest(schema, modules)
    const f = await preparePlaybackDifferential(t, false)
    const published = await t.withIdentity(owner).run(async ctx => {
      // Replace the deliberately unpublished pin fixture with a real enrolled publication.
      const rows = await ctx.db.query('learnArtifactLineages').withIndex('by_userId', q => q.eq('userId', owner.tokenIdentifier)).take(100)
      for (const row of rows) await ctx.db.delete(row._id)
      await ctx.db.patch(f.catalogId, { measurementCapability: { enabled: true } })
      const documents = await ctx.db.query('documents').withIndex('by_userId', q => q.eq('userId', owner.tokenIdentifier)).take(10)
      await prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: documents.flatMap(document => [
        { artifact: { kind: 'document' as const, id: document._id }, key: 'whole', origins: [], sources: [] },
        { artifact: { kind: 'document_chunk' as const, id: document._id }, key: 'chunk-set', origins: [], sources: [] },
      ]) })
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [{ artifact: { kind: 'audio_overview', id: f.overviewId }, key: 'whole', origins: [], sources: [] }] })
    })
    const before = await t.run(async ctx => ({
      cases: await ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', published.lineageIds[0]!)).take(32),
      sources: await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', published.lineageIds[0]!)).take(64),
    }))
    await t.mutation(api.audioOverviewV2.completeAlignment, { jobId: f.jobId, capability: alignmentCapability, alignmentId: f.alignmentId })
    const next = (await t.run(ctx => ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', 'audio_overview').eq('artifact.id', f.overviewId).eq('nextId', undefined)).unique()))!
    const reference = { artifact: next.artifact, key: next.key, revision: next.revision, payloadDigest: next.payloadDigest }
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInput(ctx, { reference }))).toMatchObject({ status: 'admitted_registered' })
    expect(await t.run(ctx => ctx.db.get(published.lineageIds[0]!))).toHaveProperty('nextId', next._id)
    expect(await t.withIdentity(owner).run(ctx => resolveArtifactLineageForOwner(ctx, owner.tokenIdentifier, { reference: published.references[0]! }))).toMatchObject({ status: 'unavailable' })
    const cases = await t.run(ctx => ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', next._id)).take(32))
    const sources = await t.run(ctx => ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', next._id)).take(64))
    expect(cases.map(row => row.caseId)).toEqual(before.cases.map(row => row.caseId))
    expect(sources.map(row => row.dependency)).toEqual(before.sources.map(row => row.dependency))
  })
})

describe('Stage B immutable document source commitments', () => {
  test.each(['contentHash', 'r2Key'] as const)('a changed %s cannot be repaired by document supersession or registration', async field => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepare(ctx, { classification: 'genuine_personal_work' }))
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))
    await t.mutation(internal.documents.updateDocumentStatus, { id: f.documentId, status: 'success', [field]: field === 'contentHash' ? 'a'.repeat(64) : 'owned/replaced-object' })
    const next = await t.run(async ctx => replacementLineage(ctx, f, await artifactPayloadDigest(artifactContentProjection({ kind: 'document', document: (await ctx.db.get(f.documentId))! }))))
    await expect(t.withIdentity(owner).run(ctx => supersedeArtifactLineageForOwner(ctx, owner.tokenIdentifier, { previousLineageId: f.lineageId, replacementLineageId: next.lineageId }))).rejects.toThrow('unavailable')
    await expect(t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(next)))).rejects.toThrow('unavailable')
    expect(await t.run(ctx => ctx.db.get(f.lineageId))).not.toHaveProperty('nextId')
    expect((await t.run(ctx => ctx.db.get(f.catalogId)))!.catalogRevision).toBe(1)
  })
})

describe('Stage B revision succession scope', () => {
  test('learner-artifact revision changes remain outside instructional F1 succession', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, 'learner_artifact'))
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))
    const next = await t.run(async ctx => {
      if (f.reference.artifact.kind !== 'learner_artifact') throw new Error('Expected learner artifact')
      const artifact = (await ctx.db.get(f.reference.artifact.id))!
      await ctx.db.patch(artifact._id, { revision: artifact.revision + 1, summary: 'Changed learner work' })
      const replacement = await replacementLineage(ctx, f, await artifactPayloadDigest(await currentContent(ctx, f)))
      const reference = { ...replacement.reference, revision: String(artifact.revision + 1) }
      await ctx.db.patch(replacement.lineageId, reference)
      return resealed(ctx, { ...replacement, reference })
    })
    await expect(t.withIdentity(owner).run(ctx => supersedeArtifactLineageForOwner(ctx, owner.tokenIdentifier, { previousLineageId: f.lineageId, replacementLineageId: next.lineageId }))).rejects.toThrow('unavailable')
  })
})

describe('Stage B preparation snapshot provenance', () => {
  test.each(['snapshot', 'excerpt'] as const)('a retained %s source rejects protected backing-document lineage', async kind => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareSourceDependency(ctx, kind))
    await t.run(ctx => ctx.db.patch(f.catalogId, { measurementCapability: { enabled: true } }))
    const registered = await t.withIdentity(owner).run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [{ artifact: { kind: 'document', id: f.sourceDocumentId! }, key: 'whole', origins: [], sources: [] }] }))
    await t.run(ctx => ctx.db.patch(registered.lineageIds[0]!, { classification: 'private_scoring' }))
    await expect(t.withIdentity(owner).run(async ctx => {
      const quizId = await ctx.db.insert('quizzes', { userId: owner.tokenIdentifier, folderId: f.folderId, title: 'Quiz', status: 'ready', questionCount: 1, creationMethod: 'auto_generated' })
      const id = await ctx.db.insert('quizQuestions', { userId: owner.tokenIdentifier, quizId, order: 0, question: 'A fresh scenario', correctAnswer: 'A fresh answer', type: 'free-response' })
      const snapshot = (await ctx.db.get(f.snapshotId))!
      const pins = { sourceSnapshotId: snapshot._id, revision: snapshot.revision, recordRevision: snapshot.recordRevision ?? 1, contentHash: snapshot.contentHash }
      const dependency = kind === 'snapshot' ? { kind, ...pins } : { kind, ...pins, sourceExcerptId: f.excerptId }
      return prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [{ artifact: { kind: 'quiz_question', id }, key: 'whole', origins: [], sources: [dependency] }] })
    })).rejects.toThrow('unavailable')
  })
})

describe('Stage B declared legacy document pins', () => {
  test.each(['deleted', 'unpinned'] as const)('an ordinary Audio source with declared pins remains ordinary when %s', async state => {
    const t = convexTest(schema, modules)
    const f = await preparePlaybackDifferential(t, false)
    await t.run(async ctx => {
      await ctx.db.delete(f.lineageId)
      if (state === 'deleted') await ctx.db.delete(f.documentId)
      else await ctx.db.patch(f.documentId, { sourceRevision: undefined, contentHash: undefined })
    })
    expect(await t.withIdentity(owner).run(ctx => admitArtifactInputByIdentity(ctx, { kind: 'audio_overview', id: f.overviewId }))).toMatchObject({ status: 'admitted_unregistered' })
  })
})
