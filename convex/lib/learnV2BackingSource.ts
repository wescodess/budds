import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

type BackingDocument = Pick<Doc<'documents'>, 'sourceRevision' | 'contentHash' | 'r2Key'>
type SnapshotPins = Pick<Doc<'learnSourceSnapshots'>, 'sourceRevision' | 'contentHash' | 'objectKey'>

export function documentMatchesSnapshot(document: BackingDocument, snapshot: SnapshotPins) {
  return !!(document.sourceRevision || document.contentHash)
    && document.sourceRevision?.trim() === snapshot.sourceRevision
    && document.contentHash?.trim().toLowerCase() === snapshot.contentHash
    && document.r2Key?.trim() === snapshot.objectKey
}

export function documentHasCurrentRevision(document: BackingDocument, pinnedRevision?: string) {
  const revision = document.sourceRevision?.trim()
  const hash = document.contentHash?.trim().toLowerCase()
  const legacy = document.sourceRevision === undefined && document.contentHash === undefined
  if (!legacy && (!hash || revision !== `sha256:${hash}`)) return false
  return pinnedRevision === undefined || revision === pinnedRevision
}

export async function sourceSupportsGeneration(ctx: QueryCtx | MutationCtx, userId: string, id: Id<'learnSourceSnapshots'>) {
  const source = await ctx.db.get(id)
  if (!source || source.userId !== userId || source.status !== 'user_accepted' || source.effectiveStatus !== 'user_accepted'
    || source.conflictStatus !== 'clear' || source.evidencePurgedAt !== undefined) return false
  if (source.rightsStatus === 'permitted') return true
  const identity = await ctx.db.get(source.sourceIdentityId)
  return identity?.userId === userId && identity.origin === 'folder_document' && !!identity.folderDocumentId
    && typeof source.contentHash === 'string' && typeof source.sourceRevision === 'string'
}
