/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalMutation, type MutationCtx } from './_generated/server'
import schema from './schema'
import { artifactManifestDigest, artifactPayloadDigest, advanceAssessmentCatalogForOwner, registerInstructionalArtifactForOwner } from './lib/learnV2ArtifactLineage'
import { artifactRegistrationArgs, artifactRegistrationResultValidator } from './lib/learnV2ArtifactLineageContract'
import { invalidateMeasurementSourceBatch } from './lib/learnV2MeasurementRetention'
import { LEARN_ARTIFACT_LINEAGE_VERSION, LEARN_ARTIFACT_LINEAGE_LIMITS, type LearnArtifactReference } from '../shared/learn-v2-artifact-lineage'
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
  const reference: LearnArtifactReference = { artifact: { kind: 'document', id: documentId }, key: options.key ?? 'whole', revision: 'source.r1', payloadDigest: await artifactPayloadDigest([await ctx.db.get(documentId)]) }
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
  const record = await ctx.db.get(artifact.id)
  const payload = kind === 'session_block' ? [record, await ctx.db.get(contentId)]
    : kind === 'flashcard_version' ? [record, [await ctx.db.get(cardId)]] : kind === 'audio_overview' ? [record, null, null]
      : kind === 'measurement_item' ? [record, await ctx.db.get(familyId), await ctx.db.get(specId)]
        : kind === 'scoring_spec' ? [record, await ctx.db.get(itemId), await ctx.db.get(familyId)] : [record]
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
  { name: 'session_cancelled', kinds: ['session_block'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.sessionId, { status: 'cancelled' })) },
  { name: 'plan_superseded', kinds: ['session_block'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.planId, { status: 'superseded' })) },
  { name: 'plan_pointer_replaced', kinds: ['session_block'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.studyPlanId, { activeRevisionId: undefined })) },
  { name: 'blueprint_superseded', kinds: ['session_block', ...measurementKinds], apply: (t, f) => t.run(ctx => ctx.db.patch(f.blueprintRevisionId, { status: 'superseded' })) },
  { name: 'quiz_deleted_real', kinds: ['quiz_question'], apply: (t, f) => t.withIdentity(owner).mutation(api.quizzes.deleteQuiz, { quizId: f.quizId }) },
  { name: 'question_deleted_real', kinds: ['quiz_question'], apply: (t, f) => t.withIdentity(owner).mutation(api.quizzes.deleteQuestion, { questionId: f.questionId }) },
  { name: 'question_payload_changed_real', kinds: ['quiz_question'], apply: (t, f) => t.withIdentity(owner).mutation(api.quizzes.updateQuestion, { questionId: f.questionId, question: 'A different question?' }) },
  { name: 'quiz_failed', kinds: ['quiz_question'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.quizId, { status: 'failed' })) },
  { name: 'quiz_tombstone_zero', kinds: ['quiz_question'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.quizId, { deletedAt: 0 })) },
  { name: 'course_deleting_real', kinds: ['quiz_question', 'section_block'], apply: (t, f) => t.mutation(internal.courseDeletion.start, { courseId: f.courseId, userId: owner.tokenIdentifier }) },
  { name: 'course_failed_real', kinds: ['quiz_question', 'section_block'], apply: (t, f) => t.withIdentity(owner).mutation(api.courses.markFailed, { courseId: f.courseId }) },
  { name: 'section_failed_real', kinds: ['section_block'], apply: (t, f) => t.mutation(internal.courseSections.markSectionFailed, { sectionId: f.sectionId }) },
  { name: 'section_payload_changed_real', kinds: ['section_block'], apply: (t, f) => t.withIdentity(owner).mutation(api.courseSections.updateTitle, { sectionId: f.sectionId, title: 'Changed section' }) },
  { name: 'flashcard_room_deleted_real', kinds: ['flashcard_version'], apply: (t, f) => t.withIdentity(owner).mutation(api.flashcardRooms.deleteRoom, { roomId: f.flashcardRoomId }) },
  { name: 'flashcard_room_missing', kinds: ['flashcard_version'], apply: (t, f) => t.run(ctx => ctx.db.delete(f.flashcardRoomId)) },
  { name: 'flashcard_payload_changed', kinds: ['flashcard_version'], apply: (t, f) => t.run(ctx => ctx.db.patch(f.cardId, { definition: 'Replaced version content' })) },
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
  const payloadDigest = await artifactPayloadDigest([await ctx.db.get(f.overviewId), await ctx.db.get(episodeId), await ctx.db.get(mediaId)])
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
