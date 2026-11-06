import type { Doc } from '../_generated/dataModel'

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
