import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

// Mirrors the complete published-content readiness boundary used by Today and
// shared V2 scoring. A Canvas may display fewer claims, but it cannot admit a
// session whose other claims or supports would fail the V2 scorer later.
export async function isLearnV2ContentEvidenceReady(
  ctx: Pick<QueryCtx, 'db'>,
  userId: string,
  content: Doc<'sessionContent'>,
  learningVoidId: Id<'learningVoids'>,
): Promise<boolean> {
  if (content.userId !== userId || content.status !== 'published') return false
  const claims = await ctx.db.query('sessionContentClaims')
    .withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(33)
  if (!claims.length || claims.length > 32) return false
  const sourceIds = new Set<string>()
  for (const claim of claims) {
    if (claim.userId !== userId || claim.sessionContentId !== content._id) return false
    const supports = await ctx.db.query('learnClaimSupports')
      .withIndex('by_userId_and_sessionContentClaimId', q => q.eq('userId', userId).eq('sessionContentClaimId', claim._id)).take(9)
    if (!supports.length || supports.length > 8) return false
    for (const support of supports) {
      const excerpt = await ctx.db.get(support.sourceExcerptId)
      const sourceId = support.sourceSnapshotId ?? excerpt?.sourceSnapshotId
      const source = sourceId && await ctx.db.get(sourceId)
      if (!excerpt || excerpt.userId !== userId || excerpt.evidencePurgedAt !== undefined
        || !source || source.userId !== userId || source.learningVoidId !== learningVoidId
        || excerpt.sourceSnapshotId !== source._id || support.sourceSnapshotId !== undefined && support.sourceSnapshotId !== source._id
        || source.evidencePurgedAt !== undefined || source.status !== 'user_accepted' || source.effectiveStatus !== 'user_accepted' || source.conflictStatus !== 'clear'
        || support.userId !== userId || support.sessionContentClaimId !== claim._id
        || support.entailment !== 'entailed' || support.conflictStatus !== 'clear' || support.evidenceStatus !== 'evidence_available' || !support.verifierVersion?.trim() || (support.confidence ?? 0) < 0.8) return false
      const identity = await ctx.db.get(source.sourceIdentityId)
      if (!identity || identity.userId !== userId || identity.learningVoidId !== learningVoidId || identity.tombstonedAt !== undefined) return false
      const storedEvidence = source.rightsStatus === 'permitted' && excerpt.rightsStatus === 'permitted' && !!excerpt.excerpt?.trim()
      const folderLocator = identity.origin === 'folder_document' && !!identity.folderDocumentId
        && typeof source.contentHash === 'string' && !!source.contentHash.trim()
        && typeof source.sourceRevision === 'string' && !!source.sourceRevision.trim()
      if (!storedEvidence && !folderLocator) return false
      sourceIds.add(String(source._id))
      if (sourceIds.size > 64) return false
    }
  }
  return sourceIds.size > 0
}
