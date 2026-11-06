/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { getDocumentSize, type Value } from 'convex/values'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalMutation, type MutationCtx } from './_generated/server'
import schema from './schema'
import { ARTIFACT_LINEAGE_READ_BYTES, createArtifactLineageReadContext, registerInstructionalArtifactsForOwner, registerInstructionalArtifactsForRecord, registerInstructionalArtifactForRecord, resolveArtifactLineageForRecord, supersedeArtifactLineageForOwner, supersedeArtifactLineageForRecord, sessionBlockContentProjection, sectionContentProjection, audioOverviewContentProjection, artifactContentProjection, artifactManifestDigest, artifactPayloadDigest, advanceAssessmentCatalogForOwner, registerInstructionalArtifactForOwner, resolveArtifactLineageForOwner } from './lib/learnV2ArtifactLineage'
import { artifactRegistrationArgs, artifactRegistrationResultValidator } from './lib/learnV2ArtifactLineageContract'
import { invalidateMeasurementSourceBatch } from './lib/learnV2MeasurementRetention'
import { LEARN_ARTIFACT_LINEAGE_VERSION, LEARN_ARTIFACT_LINEAGE_LIMITS, type LearnArtifactReference, type LearnArtifactOwnerRecord } from '../shared/learn-v2-artifact-lineage'
import { composeAdaptiveActivityPlan } from '../shared/learn-adaptive-activity-plan'
import { initiateAdaptiveThreadDeletion } from './learnAdaptiveCommands'
import { privateAdaptiveArtifactR2Key } from './lib/learnAdaptiveArtifacts'

const owner = { tokenIdentifier: 'https://auth.example.com|lineage-owner', subject: 'same-subject' }
const foreign = { tokenIdentifier: 'https://other.example.com|lineage-owner', subject: 'same-subject' }
// Exercise the dormant registration seam as an internal mutation without adding a production endpoint.
const modules = {
  ...import.meta.glob('./**/*.ts'),
  './artifactLineageTest.ts': async () => ({
    registerInstructional: internalMutation({
      args: artifactRegistrationArgs,
      returns: artifactRegistrationResultValidator,
      handler: (ctx, args) => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, args),
    }),
  }),
}
const registerInstructional = makeFunctionReference<'mutation', ReturnType<typeof registration>, Awaited<ReturnType<typeof registerInstructionalArtifactForOwner>>>('artifactLineageTest:registerInstructional')
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
      expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').take(2))).toMatchObject([{ name: 'learnV2Retention:purgeSourceEvidence', state: { kind: 'pending' } }])
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
  const reference: LearnArtifactReference = { artifact, key: kind === 'document_chunk' || kind === 'section_block' ? 'component-0' : 'whole', revision, payloadDigest }
  const classification: Doc<'learnArtifactLineages'>['classification'] = kind === 'measurement_item' ? 'measurement' : kind === 'scoring_spec' ? 'private_scoring' : 'genuine_personal_work'
  await ctx.db.patch(f.lineageId, { ...reference, classification, authority: classification === 'genuine_personal_work' ? 'personal_authorship' : 'server_producer' })
  const manifestDigest = await sealManifest(ctx, f.lineageId)
  await ctx.db.patch(f.validationId, { payloadDigest, manifestDigest })
  return { ...f, reference, classification, manifestDigest, artifactVoidId, blueprintRevisionId, studyPlanId, planId, sessionId, contentId, blockId,
    courseId, sectionId, quizId, questionId, flashcardRoomId, versionId, cardId, conversationId, audioRoomId, overviewId, threadId, activityId, learnerArtifactId, familyId, itemId, specId }
}

type MatrixFixture = Awaited<ReturnType<typeof prepareMatrix>>
type TestStore = ReturnType<typeof convexTest>
type Revocation = { name: string, kinds?: readonly ArtifactKind[], apply: (t: TestStore, f: MatrixFixture) => Promise<unknown> }
const documentKinds = ['document', 'document_chunk'] as const
const voidKinds = ['session_block', 'learner_artifact', 'measurement_item', 'scoring_spec'] as const
const measurementKinds = ['measurement_item', 'scoring_spec'] as const

const benignUpdates: Revocation[] = [
  { name: 'document indexJobId only (real)', kinds: documentKinds, apply: (t, f) => t.mutation(internal.documents.updateDocumentStatus, { id: f.documentId, status: 'success', indexJobId: 'new-index-job' }) },
  { name: 'document filename (real)', kinds: documentKinds, apply: (t, f) => t.mutation(internal.documents.updateDocumentFilename, { id: f.documentId, filename: 'renamed.txt' }) },
  { name: 'section completion (real)', kinds: ['section_block'], apply: (t, f) => t.withIdentity(owner).mutation(api.courseSections.completeSection, { sectionId: f.sectionId, practiceScore: 80, quizCorrect: 4, quizTotal: 5 }) },
  { name: 'section offline availability (real)', kinds: ['section_block'], apply: (t, f) => t.withIdentity(owner).mutation(api.courseSections.setOfflineAvailable, { sectionId: f.sectionId, offlineAvailable: true }) },
  { name: 'Audio Overview publication (real)', kinds: ['audio_overview'], apply: (t, f) => t.withIdentity(owner).mutation(api.audioOverviews.publishOverview, { id: f.overviewId }) },
  { name: 'flashcard room rename (real)', kinds: ['flashcard_version'], apply: (t, f) => t.withIdentity(owner).mutation(api.flashcardRooms.renameRoom, { roomId: f.flashcardRoomId, title: 'Renamed room' }) },
  { name: 'quiz rename (real)', kinds: ['quiz_question'], apply: (t, f) => t.withIdentity(owner).mutation(api.quizzes.updateQuiz, { quizId: f.quizId, title: 'Renamed quiz' }) },
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
  { name: 'quiz_deleted_real', kinds: ['quiz_question'], apply: (t, f) => t.withIdentity(owner).mutation(api.quizzes.deleteQuiz, { quizId: f.quizId }) },
  { name: 'question_deleted_real', kinds: ['quiz_question'], apply: (t, f) => t.withIdentity(owner).mutation(api.quizzes.deleteQuestion, { questionId: f.questionId }) },
  { name: 'question_payload_changed_real', kinds: ['quiz_question'], apply: (t, f) => t.withIdentity(owner).mutation(api.quizzes.updateQuestion, { questionId: f.questionId, question: 'A different question?' }) },
  { name: 'question_answer_changed_real', kinds: ['quiz_question'], apply: (t, f) => t.withIdentity(owner).mutation(api.quizzes.updateQuestion, { questionId: f.questionId, correctAnswer: 'Three' }) },
  { name: 'question_correction_changed_real', kinds: ['quiz_question'], apply: (t, f) => t.withIdentity(owner).mutation(api.contentFlags.flagQuizQuestion, { questionId: f.questionId, correctedAnswer: 'Three', correctedExplanation: 'Revised explanation' }) },
  { name: 'quiz_failed', kinds: ['quiz_question'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.quizId, { status: 'failed' })) },
  { name: 'quiz_tombstone_zero', kinds: ['quiz_question'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.quizId, { deletedAt: 0 })) },
  { name: 'course_deleting_real', kinds: ['quiz_question', 'section_block'], apply: (t, f) => t.mutation(internal.courseDeletion.start, { courseId: f.courseId, userId: owner.tokenIdentifier }) },
  { name: 'course_failed_real', kinds: ['quiz_question', 'section_block'], apply: (t, f) => t.withIdentity(owner).mutation(api.courses.markFailed, { courseId: f.courseId }) },
  { name: 'section_failed_real', kinds: ['section_block'], apply: (t, f) => t.mutation(internal.courseSections.markSectionFailed, { sectionId: f.sectionId }) },
  { name: 'section_payload_changed_real', kinds: ['section_block'], apply: (t, f) => t.withIdentity(owner).mutation(api.courseSections.updateTitle, { sectionId: f.sectionId, title: 'Changed section' }) },
  { name: 'section_blocks_changed', kinds: ['section_block'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.sectionId, { contentBlocks: [{ type: 'text', content: 'Revised teaching body', order: 0 }] })) },
  { name: 'flashcard_room_deleted_real', kinds: ['flashcard_version'], apply: (t, f) => t.withIdentity(owner).mutation(api.flashcardRooms.deleteRoom, { roomId: f.flashcardRoomId }) },
  { name: 'flashcard_room_missing', kinds: ['flashcard_version'], apply: (t, f) => t.run(ctx => ctx.db.delete(f.flashcardRoomId)) },
  { name: 'flashcard_payload_changed', kinds: ['flashcard_version'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.cardId, { definition: 'Replaced version content' })) },
  { name: 'flashcard_prompt_changed', kinds: ['flashcard_version'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.versionId, { prompt: 'Revised prompt' })) },
  { name: 'audio_deleting_real', kinds: ['audio_overview'], apply: (t, f) => t.withIdentity(owner).mutation(api.audioOverviews.deleteOverview, { id: f.overviewId }) },
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
  { name: 'delete_overview_real', apply: (t, f) => t.withIdentity(owner).mutation(api.audioOverviews.deleteOverview, { id: f.overviewId }) },
]

describe('A3 revocation matrix: V2 Audio Overview backing episode and media', () => {
  test('A4 benign V2 publication preserves episode/media pins and its derived chain', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareV2Audio(ctx))
    const copy = await matrixControl(t, f)
    await t.withIdentity(owner).mutation(api.audioOverviews.publishOverview, { id: f.overviewId })
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
  const stats = { bytes: 0, charged: 0, documents: 0, requests: 0 }
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
        const row: unknown = await Reflect.apply(method, target, args)
        record(row)
        return row
      }
      if (property === 'query') return (...args: unknown[]) => query(Reflect.apply(method, target, args) as object)
      return method.bind(target)
    },
  })
  return { ctx: { ...ctx, db }, stats }
}

async function tracedLookup(t: TestStore, f: Fixture, mode: 'resolve' | 'register') {
  let stats = { bytes: 0, charged: 0, documents: 0, requests: 0 }
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
    if (!(error instanceof Error) || ![rollback, 'Artifact lineage unavailable'].includes(error.message)) throw error
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
      const result = await asOwner.query(api.quizzes.getWithQuestions, { id: f.quizId })
      expect(result).not.toBeNull()
      return consumerContent(result!.questions.find(q => q._id === f.questionId))
    }
    case 'section_block': {
      const section = await asOwner.query(api.courseSections.get, { id: f.sectionId })
      expect(section).not.toBeNull()
      expect(await asOwner.query(api.courses.get, { id: f.courseId })).not.toBeNull()
      const links = []
      for (const block of section!.contentBlocks) {
        if (!block.entityId || block.type === 'text') continue
        if (block.type === 'quiz') {
          const data = await asOwner.query(api.quizzes.getWithQuestions, { id: block.entityId as Id<'quizzes'> })
          links.push(data?.questions)
        }
        else if (block.type === 'flashcard') {
          const data = await asOwner.query(api.flashcardRooms.getRoom, { roomId: block.entityId as Id<'flashcardRooms'> })
          links.push(data?.cards)
        }
        else links.push(await asOwner.query(api.audioOverviews.getCourseScopedOverview, { id: block.entityId as Id<'audioOverviews'> }))
      }
      return consumerContent({ section, links })
    }
    case 'flashcard_version': {
      const data = await asOwner.query(api.flashcardRooms.getRoomVersion, { versionId: f.versionId })
      expect(data).not.toBeNull()
      return consumerContent({ version: withoutLabels(data!.version), cards: data!.cards })
    }
    case 'audio_overview': return consumerContent(await asOwner.query(api.audioOverviews.getWithTurns, { id: f.overviewId }))
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
  { name: 'question edit (real)', kinds: ['quiz_question'], apply: (t, f) => t.withIdentity(owner).mutation(api.quizzes.updateQuestion, { questionId: f.questionId, question: 'Two plus two?', correctAnswer: 'Four', explanation: 'Addition' }) },
  { name: 'question correction (real)', kinds: ['quiz_question'], apply: (t, f) => t.withIdentity(owner).mutation(api.contentFlags.flagQuizQuestion, { questionId: f.questionId, correctedAnswer: 'Corrected answer', correctedExplanation: 'Corrected explanation' }) },
  { name: 'section blocks (real)', kinds: ['section_block'], apply: (t, f) => t.mutation(internal.courseSections.markReady, { sectionId: f.sectionId, contentBlocks: [{ type: 'text', order: 0, content: 'Replacement teaching' }] }) },
  { name: 'section generation (real)', kinds: ['section_block'], apply: (t, f) => t.withIdentity(owner).mutation(api.courseSections.finalizeSectionGeneration, { sectionId: f.sectionId, textContent: 'New generated section', quizData: { title: 'Embedded Quiz', questions: [{ order: 0, type: 'free-response', question: 'Generated question', correctAnswer: 'Generated answer' }] }, flashcardData: { title: 'Embedded cards', cards: [{ term: 'Generated term', definition: 'Generated definition' }] } }) },
  { name: 'section title (real)', kinds: ['section_block'], apply: (t, f) => t.withIdentity(owner).mutation(api.courseSections.updateTitle, { sectionId: f.sectionId, title: 'New instructional heading' }) },
  { name: 'section knowledge type (real)', kinds: ['section_block'], apply: (t, f) => t.withIdentity(owner).mutation(api.courseSections.updateKnowledgeType, { sectionId: f.sectionId, knowledgeType: 'conceptual' }) },
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
    await t.withIdentity(owner).mutation(api.contentFlags.flagQuizQuestion, { questionId: f.questionId, correctedAnswer: 'Correction' })
    await t.withIdentity(owner).mutation(api.contentFlags.flagFlashcard, { cardId: f.activeCardId, correctedDefinition: 'Correction' })
  }
  return repinContent(t, f)
}
type LinkedSection = Awaited<ReturnType<typeof prepareLinkedSection>>
const linkedSectionChanges: Array<{ name: string, corrected?: boolean, changes: boolean, apply: (t: TestStore, f: LinkedSection) => Promise<unknown> }> = [
  { name: 'Quiz addition', changes: true, apply: (t, f) => t.withIdentity(owner).mutation(api.quizzes.addQuestion, { quizId: f.quizId, type: 'free-response', questionText: 'New embedded question?', correctAnswer: 'New answer' }) },
  { name: 'Quiz edit', changes: true, apply: (t, f) => t.withIdentity(owner).mutation(api.quizzes.updateQuestion, { questionId: f.questionId, question: 'Changed question', correctAnswer: 'Changed answer' }) },
  { name: 'Quiz correction', changes: true, apply: (t, f) => t.withIdentity(owner).mutation(api.contentFlags.flagQuizQuestion, { questionId: f.questionId, correctedAnswer: 'Corrected', correctedExplanation: 'Corrected reasoning' }) },
  { name: 'Quiz uncorrection', corrected: true, changes: true, apply: (t, f) => t.withIdentity(owner).mutation(api.contentFlags.unflagQuizQuestion, { questionId: f.questionId }) },
  { name: 'Quiz removal', changes: true, apply: (t, f) => t.withIdentity(owner).mutation(api.quizzes.deleteQuestion, { questionId: f.questionId }) },
  { name: 'card addition', changes: true, apply: (t, f) => t.withIdentity(owner).mutation(api.flashcardRooms.createCard, { roomId: f.flashcardRoomId, term: 'Second', definition: 'Another card' }) },
  { name: 'card edit', changes: true, apply: (t, f) => t.withIdentity(owner).mutation(api.flashcardRooms.updateCard, { cardId: f.activeCardId, term: 'Changed term', definition: 'Changed definition' }) },
  { name: 'card correction', changes: true, apply: (t, f) => t.withIdentity(owner).mutation(api.contentFlags.flagFlashcard, { cardId: f.activeCardId, correctedDefinition: 'Corrected definition' }) },
  { name: 'card uncorrection', corrected: true, changes: true, apply: (t, f) => t.withIdentity(owner).mutation(api.contentFlags.unflagFlashcard, { cardId: f.activeCardId }) },
  { name: 'card removal', changes: true, apply: (t, f) => t.withIdentity(owner).mutation(api.flashcardRooms.deleteCard, { cardId: f.activeCardId }) },
  { name: 'card generation', changes: true, apply: (t, f) => t.withIdentity(owner).mutation(api.flashcardRooms.generateRoomCards, { roomId: f.flashcardRoomId, origin: 'manual', cards: [{ term: 'Generated', definition: 'Generated definition' }] }) },
  { name: 'version restore', changes: true, apply: async (t, f) => {
    await t.run(ctx => ctx.db.patch(f.flashcardRoomId, { activeVersionId: undefined }))
    return t.withIdentity(owner).mutation(api.flashcardRooms.restoreRoomVersion, { roomId: f.flashcardRoomId, versionId: f.versionId })
  } },
  { name: 'Quiz rename', changes: false, apply: (t, f) => t.withIdentity(owner).mutation(api.quizzes.updateQuiz, { quizId: f.quizId, title: 'Organizational label' }) },
  { name: 'room rename', changes: false, apply: (t, f) => t.withIdentity(owner).mutation(api.flashcardRooms.renameRoom, { roomId: f.flashcardRoomId, title: 'Organizational label' }) },
  { name: 'share publication', changes: false, apply: (t, f) => t.withIdentity(owner).mutation(api.audioOverviews.publishOverview, { id: f.overviewId }) },
  { name: 'section review', changes: false, apply: (t, f) => t.withIdentity(owner).mutation(api.courseSections.reviewSection, { sectionId: f.sectionId, practiceScore: 80, quizCorrect: 1, quizTotal: 1 }) },
  { name: 'course pace', changes: false, apply: (t, f) => t.withIdentity(owner).mutation(api.courses.updatePace, { courseId: f.courseId, pace: 'relaxed' }) },
  { name: 'offline availability', changes: false, apply: (t, f) => t.withIdentity(owner).mutation(api.courseSections.setOfflineAvailable, { sectionId: f.sectionId, offlineAvailable: true }) },
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
    const { cardId } = await t.withIdentity(owner).mutation(api.flashcardRooms.createCard, { roomId: f.flashcardRoomId, term: 'Second', definition: 'Another card' })
    f = await repinContent(t, f)
    await expectDifferential(t, f, () => t.withIdentity(owner).mutation(api.flashcardRooms.reorderCards, { roomId: f.flashcardRoomId,
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
  await t.mutation(api.audioOverviewV2.appendAlignmentSegments, { jobId: f.jobId, capability: alignmentCapability, alignmentId: f.alignmentId,
    segments: [{ utteranceId: f.utteranceId, wordIndex: 0, word: 'One', startMs: 0, endMs: 4 }] })
  if (ready) await t.mutation(api.audioOverviewV2.completeAlignment, { jobId: f.jobId, capability: alignmentCapability, alignmentId: f.alignmentId })
  return repinContent(t, f)
}
type PlaybackFixture = Awaited<ReturnType<typeof preparePlaybackDifferential>>
async function readPlaybackContent(t: TestStore, f: PlaybackFixture) {
  const playback = await t.withIdentity(owner).query(api.audioOverviewV2.getPlaybackForOwner, { overviewId: f.overviewId })
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
  { name: 'source entry content', apply: (t, f) => t.run(ctx => ctx.db.patch(f.entryId, { displayReference: 'Revised source reference', revision: 'source.r2', contentHash: 'b'.repeat(64) })) },
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
  { name: 'completeAlignment (real)', pending: true, apply: (t, f) => t.mutation(api.audioOverviewV2.completeAlignment, { jobId: f.jobId, capability: alignmentCapability, alignmentId: f.alignmentId }) },
  { name: 'append and completeAlignment (real)', pending: true, apply: async (t, f) => {
    await t.mutation(api.audioOverviewV2.appendAlignmentSegments, { jobId: f.jobId, capability: alignmentCapability, alignmentId: f.alignmentId,
      segments: [{ utteranceId: f.utteranceId, wordIndex: 1, word: 'Two', startMs: 5, endMs: 9 }] })
    return t.mutation(api.audioOverviewV2.completeAlignment, { jobId: f.jobId, capability: alignmentCapability, alignmentId: f.alignmentId })
  } },
  { name: 'pending alignment append (real)', pending: true, changes: false, apply: (t, f) => t.mutation(api.audioOverviewV2.appendAlignmentSegments, { jobId: f.jobId, capability: alignmentCapability, alignmentId: f.alignmentId,
    segments: [{ utteranceId: f.utteranceId, wordIndex: 1, word: 'Two', startMs: 5, endMs: 9 }] }) },
  { name: 'pending alignment failure (real)', pending: true, changes: false, apply: (t, f) => t.mutation(api.audioOverviewV2.failAlignment, { jobId: f.jobId, capability: alignmentCapability, alignmentId: f.alignmentId, error: 'Alignment unavailable' }) },
  { name: 'publishOverview (real)', changes: false, apply: (t, f) => t.withIdentity(owner).mutation(api.audioOverviews.publishOverview, { id: f.overviewId }) },
  { name: 'publish and unpublish (real)', changes: false, apply: async (t, f) => {
    await t.withIdentity(owner).mutation(api.audioOverviews.publishOverview, { id: f.overviewId })
    return t.withIdentity(owner).mutation(api.audioOverviews.unpublishOverview, { id: f.overviewId })
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
    const asOwner = t.withIdentity(owner)
    const { cardId } = await asOwner.mutation(api.flashcardRooms.createCard, { roomId: f.flashcardRoomId, term: 'Active term', definition: 'Active definition' })
    await expectDifferential(t, f, async () => {
      if (command === 'createCard') return asOwner.mutation(api.flashcardRooms.createCard, { roomId: f.flashcardRoomId, term: 'Another', definition: 'Another definition' })
      if (command === 'updateCard') return asOwner.mutation(api.flashcardRooms.updateCard, { cardId, term: 'Edited', definition: 'Edited definition' })
      if (command === 'deleteCard') return asOwner.mutation(api.flashcardRooms.deleteCard, { cardId })
      if (command === 'reorderCards') return asOwner.mutation(api.flashcardRooms.reorderCards, { roomId: f.flashcardRoomId, order: [{ cardId, displayOrder: 0 }] })
      if (command === 'generateRoomCards') return asOwner.mutation(api.flashcardRooms.generateRoomCards, { roomId: f.flashcardRoomId, origin: 'manual', cards: [{ term: 'Generated', definition: 'New version' }] })
      return asOwner.mutation(api.flashcardRooms.restoreRoomVersion, { roomId: f.flashcardRoomId, versionId: f.versionId })
    }, false)
  })
})

describe('A5 linked-content read budget', () => {
  test('oversized embedded Quiz reads fail closed before exhausting 4 MiB', async () => {
    const t = convexTest(schema, modules)
    const f = await prepareLinkedSection(t)
    for (let i = 0; i < 5; i++) await t.withIdentity(owner).mutation(api.quizzes.addQuestion, { quizId: f.quizId,
      type: 'free-response', questionText: `${i}${'x'.repeat(850_000)}`, correctAnswer: 'Answer' })
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
    const playback = (await t.withIdentity(owner).query(api.audioOverviewV2.getPlaybackForOwner, { overviewId: f.overviewId }))!
    const { overviewId, model: _model, publishedAt: _publishedAt, alignment: _alignment, ...teaching } = playback
    const projection = await t.run(async ctx => audioOverviewContentProjection(ctx, (await ctx.db.get(f.overviewId))!))
    expect(projection.payload).toEqual({ id: overviewId, userId: owner.tokenIdentifier, ...teaching })
  })
  test('real Quiz addition changes offline teaching, including at the 50-question cache boundary', async () => {
    const t = convexTest(schema, modules)
    let f = await prepareLinkedSection(t)
    const asOwner = t.withIdentity(owner)
    const before = await asOwner.query(api.courseSections.getOfflineCachePayload, { sectionId: f.sectionId })
    await asOwner.mutation(api.quizzes.addQuestion, { quizId: f.quizId, type: 'free-response', questionText: 'Second question', correctAnswer: 'Second answer' })
    const after = await asOwner.query(api.courseSections.getOfflineCachePayload, { sectionId: f.sectionId })
    expect(after).not.toEqual(before)
    expect(after!.contentBlocks.find(b => b.type === 'quiz')!.quizData!.questions).toHaveLength(2)
    for (let i = 2; i < 50; i++) await asOwner.mutation(api.quizzes.addQuestion, { quizId: f.quizId, type: 'free-response', questionText: `Question ${i}`, correctAnswer: `Answer ${i}` })
    f = await repinContent(t, f)
    const fullCache = await asOwner.query(api.courseSections.getOfflineCachePayload, { sectionId: f.sectionId })
    await expectDifferential(t, f, () => asOwner.mutation(api.quizzes.addQuestion, { quizId: f.quizId, type: 'free-response', questionText: 'Online question 51', correctAnswer: 'Online answer 51' }), true)
    expect(await asOwner.query(api.courseSections.getOfflineCachePayload, { sectionId: f.sectionId })).toEqual(fullCache)
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
    const before = await t.withIdentity(owner).query(api.courseSections.getOfflineCachePayload, { sectionId: section.sectionId })
    await expectDifferential(t, section, () => t.mutation(api.audioOverviewV2.completeAlignment, { jobId: audio.jobId, capability: alignmentCapability, alignmentId: audio.alignmentId }), false)
    expect(await t.withIdentity(owner).query(api.courseSections.getOfflineCachePayload, { sectionId: section.sectionId })).toEqual(before)
    expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: audio.reference })).toMatchObject({ status: 'unavailable' })
  })
})

describe.each(['quiz_question', 'section_block'] as const)('A5 %s Quiz operational commands', kind => {
  test.each(['startAttempt', 'completeAttempt', 'abandonAttempt', 'submitAllAnswers', 'submitAttempt'] as const)('%s preserves teaching and binding', async command => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const f = kind === 'section_block' ? await prepareLinkedSection(t) : await t.run(ctx => prepareMatrix(ctx, kind))
    const asOwner = t.withIdentity(owner)
    await expectDifferential(t, f, async () => {
      if (command === 'submitAttempt') return asOwner.mutation(api.quizzes.submitAttempt, { quizId: f.quizId, answers: [{ questionId: f.questionId, response: 'Two' }] })
      const started = await asOwner.mutation(api.quizzes.startAttempt, { quizId: f.quizId, settings: { shuffleQuestions: false, showAllQuestions: true, immediateFeedback: true } })
      if (command === 'startAttempt') return started
      if (command === 'completeAttempt') return asOwner.mutation(api.quizzes.completeAttempt, { attemptId: started.attemptId })
      if (command === 'abandonAttempt') return asOwner.mutation(api.quizzes.abandonAttempt, { attemptId: started.attemptId })
      return asOwner.mutation(api.quizzes.submitAllAnswers, { attemptId: started.attemptId, answers: [{ questionId: f.questionId, userAnswer: 'Two' }] })
    }, false)
  })
})

describe('A5 linked aggregate revocation', () => {
  test.each(['Quiz tombstone', 'card room deletion', 'Audio Overview deletion', 'audio room deletion', 'audio conversation archive (injected marker)'] as const)('%s denies the section before scheduled cleanup', async change => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const f = await prepareLinkedSection(t)
    const copy = await matrixControl(t, f)
    if (change === 'Quiz tombstone') await t.withIdentity(owner).mutation(api.quizzes.deleteQuiz, { quizId: f.quizId })
    if (change === 'card room deletion') await t.withIdentity(owner).mutation(api.flashcardRooms.deleteRoom, { roomId: f.flashcardRoomId })
    if (change === 'Audio Overview deletion') await t.withIdentity(owner).mutation(api.audioOverviews.deleteOverview, { id: f.overviewId })
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

async function prepareQuizBatch(t: TestStore, count: number) {
  return t.run(async (ctx: MutationCtx) => {
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
      const questionId = await ctx.db.insert('quizQuestions', { userId: owner.tokenIdentifier, quizId, order: i, question: `Question ${i}?`, type: 'free-response', correctAnswer: `Answer ${i}` })
      const payloadDigest = await artifactPayloadDigest(artifactContentProjection({ kind: 'quiz_question', question: (await ctx.db.get(questionId))! }))
      const reference: LearnArtifactReference = { artifact: { kind: 'quiz_question', id: questionId }, key: 'whole', revision: `sha256:${payloadDigest}`, payloadDigest }
      await ctx.db.patch(f.lineageId, reference)
      const manifestDigest = await sealManifest(ctx, f.lineageId)
      await ctx.db.patch(f.validationId, { payloadDigest, manifestDigest })
      fixtures.push({ ...f, reference, manifestDigest })
    }
    return fixtures
  })
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
    const fixtures = await prepareQuizBatch(t, 3)
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
  test('a real move and indexing completion preserve a registered document and its summary', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, kind, 'document'))
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(f)))
    const summary = await t.run(ctx => prepare(ctx, { origin: f, transformation: 'summary' }))
    await t.withIdentity(owner).run(ctx => registerInstructionalArtifactForOwner(ctx, owner.tokenIdentifier, registration(summary)))
    const destinationFolderId = await t.run(ctx => ctx.db.insert('folders', { userId: owner.tokenIdentifier, name: 'Destination', documentCount: 0 }))
    await t.withIdentity(owner).mutation(api.documents.moveDocument, { id: f.documentId, destinationFolderId })
    for (const target of [f, summary]) expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: target.reference })).toMatchObject({ status: 'unavailable' })
    expect(await t.mutation(internal.documents.finalizeDocumentIndexing, { id: f.documentId, expectedFolderId: destinationFolderId, expectedR2Key: 'owned/source.r1', status: 'success' })).toBe(true)
    expect(await t.run(async ctx => artifactPayloadDigest(await currentContent(ctx, f)))).toBe(f.reference.payloadDigest)
    for (const target of [f, summary]) expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: target.reference })).toMatchObject({ status: 'bound', instructionalRegistered: true })
  })
  test.each(['deleted', 'foreign'] as const)('a %s destination still denies access', async state => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => prepareMatrix(ctx, kind))
    const destinationFolderId = await t.run(ctx => ctx.db.insert('folders', { userId: owner.tokenIdentifier, name: 'Destination', documentCount: 0 }))
    await t.withIdentity(owner).mutation(api.documents.moveDocument, { id: f.documentId, destinationFolderId })
    await t.mutation(internal.documents.finalizeDocumentIndexing, { id: f.documentId, expectedFolderId: destinationFolderId, expectedR2Key: 'owned/source.r1', status: 'success' })
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
