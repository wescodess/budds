/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalMutation, type MutationCtx } from './_generated/server'
import schema from './schema'
import { artifactManifestDigest, advanceAssessmentCatalogForOwner, registerInstructionalArtifactForOwner } from './lib/learnV2ArtifactLineage'
import { artifactRegistrationArgs, artifactRegistrationResultValidator } from './lib/learnV2ArtifactLineageContract'
import { invalidateMeasurementSourceBatch } from './lib/learnV2MeasurementRetention'
import { LEARN_ARTIFACT_LINEAGE_VERSION, LEARN_ARTIFACT_LINEAGE_LIMITS, type LearnArtifactReference } from '../shared/learn-v2-artifact-lineage'

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
  const documentId = await ctx.db.insert('documents', { userId, folderId, filename: 'owned.txt', fileSize: 5, status: 'success', sourceRevision: 'source.r1' })
  const classification = options.classification ?? options.origin?.classification ?? 'teaching'
  const reference: LearnArtifactReference = { artifact: { kind: 'document', id: documentId }, key: options.key ?? 'whole', revision: 'source.r1', payloadDigest: (options.origin ? 'f' : 'a').repeat(64) }
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

async function sealManifest(ctx: MutationCtx, lineageId: Id<'learnArtifactLineages'>) {
  const row = await ctx.db.get(lineageId)
  if (!row) throw new Error('Missing lineage')
  const [origins, cases, sources] = await Promise.all([
    ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', lineageId)).take(9),
    ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', lineageId)).take(33),
    ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', lineageId)).take(65),
  ])
  const digest = await artifactManifestDigest(row, origins, cases, sources)
  await ctx.db.patch(lineageId, { manifestDigest: digest })
  return digest
}

function registration(f: Fixture) { return { reference: f.reference, validationId: f.validationId, expectedCatalogRevision: f.catalogRevision } }

async function prepareSourceDependency(ctx: MutationCtx, kind: 'snapshot' | 'excerpt', withBackingDocument = true) {
  const f = await prepare(ctx, { classification: 'genuine_personal_work' })
  const userId = owner.tokenIdentifier
  // The source document is distinct from the artifact, so deleting it exercises source access.
  const sourceDocumentId = withBackingDocument
    ? await ctx.db.insert('documents', { userId, folderId: f.folderId, filename: 'source.txt', fileSize: 5, status: 'success' })
    : undefined
  const learningVoidId = await ctx.db.insert('learningVoids', { userId, folderId: f.folderId, title: 'Source owner', status: 'active', revision: 1, createdAt: f.base.createdAt, updatedAt: f.base.createdAt })
  const identityId = await ctx.db.insert('learnSourceIdentities', { userId, learningVoidId, origin: withBackingDocument ? 'folder_document' : 'user_url', externalKey: 'source', folderDocumentId: sourceDocumentId })
  const snapshotId = await ctx.db.insert('learnSourceSnapshots', { userId, learningVoidId, sourceIdentityId: identityId,
    revision: 1, recordRevision: 1, status: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear', contentHash: 'f'.repeat(64), createdAt: f.base.createdAt })
  const excerptId = await ctx.db.insert('learnSourceExcerpts', { userId, sourceSnapshotId: snapshotId, locator: 'https://example.com/', excerpt: 'Permitted source', rightsStatus: 'permitted' })
  const link = await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', f.lineageId)).unique()
  if (!link) throw new Error('Missing source link')
  const pin = { sourceSnapshotId: snapshotId, revision: 1, recordRevision: 1, contentHash: 'f'.repeat(64) }
  await ctx.db.patch(link._id, { dependency: kind === 'snapshot' ? { kind, ...pin } : { kind, ...pin, sourceExcerptId: excerptId } })
  const manifestDigest = await sealManifest(ctx, f.lineageId)
  await ctx.db.patch(f.validationId, { manifestDigest })
  return { ...f, manifestDigest, sourceDocumentId, identityId, snapshotId, excerptId, linkId: link._id }
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
    await t.run(ctx => ctx.db.patch(copy.lineageId, { classification: 'teaching' }))
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
          revision: 1, recordRevision: 1, status: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear', contentHash: 'f'.repeat(64), createdAt: f.base.createdAt })
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

  test('bounds origin depth and rejects duplicate and oversized children', async () => {
    const t = convexTest(schema, modules)
    let f = await t.run(ctx => prepare(ctx, { classification: 'measurement' }))
    for (let index = 0; index < LEARN_ARTIFACT_LINEAGE_LIMITS.maxDepth + 1; index++) f = await t.run(ctx => prepare(ctx, { origin: f }))
    expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'unavailable' })
    await t.run(async ctx => {
      const origin = await ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', owner.tokenIdentifier).eq('lineageId', f.lineageId)).unique()
      if (!origin) throw new Error('Missing origin')
      const { _id: _id, _creationTime: _time, ...fields } = origin
      for (let index = 0; index < 8; index++) await ctx.db.insert('learnArtifactLineageOrigins', fields)
    })
    expect(await t.withIdentity(owner).query(internal.learnV2ArtifactLineage.resolve, { reference: f.reference })).toMatchObject({ status: 'unavailable' })
  })
})
