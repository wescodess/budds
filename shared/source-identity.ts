const SHA256 = /^[a-f0-9]{64}$/

export type SourceIdentity = {
  contentHash: string
  sourceRevision: string
}

export type SourceObjectMetadataInput = SourceIdentity & {
  userId: string
  folderId: string
  documentId: string
  filename: string
}

export function createSourceObjectMetadata(input: SourceObjectMetadataInput): Record<string, string> {
  const contentHash = input.contentHash.trim().toLowerCase()
  const sourceRevision = input.sourceRevision.trim()
  if (!SHA256.test(contentHash) || sourceRevision !== `sha256:${contentHash}`) {
    throw new Error('Invalid source identity metadata')
  }
  return {
    userId: input.userId,
    documentId: input.documentId,
    folderId: input.folderId,
    filename: input.filename.replace(/[^\x20-\x7E]/g, ''),
    contentHash,
    sourceRevision,
  }
}

export function readSourceIdentityMetadata(
  metadata: Record<string, string | number | boolean | undefined>,
): SourceIdentity | null {
  const normalized = Object.fromEntries(
    Object.entries(metadata).map(([name, value]) => [name.toLowerCase(), String(value ?? '').trim()]),
  )
  const contentHash = normalized.contenthash?.toLowerCase() ?? ''
  const sourceRevision = normalized.sourcerevision ?? ''
  if (!SHA256.test(contentHash) || sourceRevision !== `sha256:${contentHash}`) return null
  return { contentHash, sourceRevision }
}
