import type { Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { LEARN_MEASUREMENT_STORAGE_LIMITS } from '../../shared/learn-v2-measurement-storage-manifest'

type Source = { kind: 'snapshot', id: Id<'learnSourceSnapshots'> } | { kind: 'excerpt', id: Id<'learnSourceExcerpts'> }
  | { kind: 'document', id: Id<'documents'> } | { kind: 'folder', id: Id<'folders'> }

export async function readPostSealSourceLinks(ctx: QueryCtx | MutationCtx, userId: string, source: Source) {
  const limit = LEARN_MEASUREMENT_STORAGE_LIMITS.pageSize
  switch (source.kind) {
    case 'snapshot': return await ctx.db.query('learnPostSealSourceLinks').withIndex('by_userId_and_dependency_sourceSnapshotId_and_invalidatedAt', q => q.eq('userId', userId).eq('dependency.sourceSnapshotId', source.id).eq('invalidatedAt', undefined)).take(limit)
    case 'excerpt': return await ctx.db.query('learnPostSealSourceLinks').withIndex('by_userId_and_dependency_sourceExcerptId_and_invalidatedAt', q => q.eq('userId', userId).eq('dependency.sourceExcerptId', source.id).eq('invalidatedAt', undefined)).take(limit)
    case 'document': return await ctx.db.query('learnPostSealSourceLinks').withIndex('by_userId_and_dependency_documentId_and_invalidatedAt', q => q.eq('userId', userId).eq('dependency.documentId', source.id).eq('invalidatedAt', undefined)).take(limit)
    case 'folder': return await ctx.db.query('learnPostSealSourceLinks').withIndex('by_userId_and_dependency_folderId_and_invalidatedAt', q => q.eq('userId', userId).eq('dependency.folderId', source.id).eq('invalidatedAt', undefined)).take(limit)
  }
}

export async function purgePostSealSourceLink(ctx: MutationCtx, userId: string, id: Id<'learnPostSealSourceLinks'>) {
  const link = await ctx.db.get(id)
  if (!link || link.userId !== userId || link.invalidatedAt !== undefined) return
  const targetId = 'teachingSourceId' in link.target ? link.target.teachingSourceId
    : 'practiceBindingId' in link.target ? link.target.practiceBindingId : link.target.helpReceiptId
  const target = await ctx.db.get(targetId)
  const now = Date.now()
  if (target?.userId === userId) {
    if (target.content.status !== 'purged') await ctx.db.patch(targetId, {
      evidenceStatus: 'evidence_unavailable', invalidatedAt: now,
      content: { status: 'purged', reasonCode: 'evidence_unavailable', purgedAt: now },
    })
    if ('practiceCaseId' in target) {
      const slot = await ctx.db.get(target.responseSlotId)
      if (slot?.userId === userId && slot.scopeKind === 'v2') {
        await ctx.db.patch(slot._id, { evidenceStatus: 'evidence_unavailable', invalidatedAt: now })
      }
    }
  }
  await ctx.db.patch(link._id, { evidenceStatus: 'evidence_unavailable', invalidatedAt: now, dependency: undefined })
}
