import type { TestConvex } from 'convex-test'
import type schema from '../../convex/schema'
import type { Id } from '../../convex/_generated/dataModel'
import type { LearnArtifactReference } from '../../shared/learn-v2-artifact-lineage'
import { artifactManifestDigest, prepareAndRegisterInstructionalArtifacts } from '../../convex/lib/learnV2ArtifactLineage'

type Store = TestConvex<typeof schema>
export async function enrollProducer(t: Store, userId: string, documents: Id<'documents'>[]) {
  await t.run(ctx => ctx.db.insert('learnAssessmentCatalogs', { userId, storageVersion: 'learn-v2.measurement-storage.v1', createdAt: 1_800_000_000_000, catalogRevision: 0, instrumentationEpoch: 'epoch.v1', historyCompleteness: 'prospective_complete', historyBasisVersion: 'history.v1', historyCoverageWatermark: 'coverage.v1', measurementCapability: { enabled: true } }))
  await t.withIdentity({ tokenIdentifier: userId }).run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: documents.flatMap(id => [
    { artifact: { kind: 'document' as const, id }, key: 'whole', sources: [], origins: [] },
    { artifact: { kind: 'document_chunk' as const, id }, key: 'chunk-set', sources: [], origins: [] },
  ]) }))
}
export async function protectProducerArtifact(t: Store, userId: string, artifact: LearnArtifactReference['artifact'], classification: 'measurement' | 'private_scoring' | 'unknown') {
  await t.run(async ctx => {
    const rows = await ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', artifact.kind).eq('artifact.id', artifact.id).eq('nextId', undefined)).take(16)
    if (!rows.length) throw new Error('Expected registered fixture')
    for (const before of rows) {
      await ctx.db.patch(before._id, { classification, authority: 'server_producer', publication: undefined })
      const row = (await ctx.db.get(before._id))!
      const origins = await ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', row._id)).take(9)
      const cases = await ctx.db.query('learnArtifactCaseBindings').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', row._id)).take(500)
      const sources = await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', row._id)).take(65)
      const manifestDigest = await artifactManifestDigest(ctx, row, origins, cases, sources)
      await ctx.db.patch(row._id, { manifestDigest })
      await ctx.db.patch(row.validationId!, { manifestDigest })
    }
  })
}
