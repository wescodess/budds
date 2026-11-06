import type { Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

export function canonicalPrivacyJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalPrivacyJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalPrivacyJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export async function privacyDigest(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalPrivacyJson(value)))
  return `sha256:${[...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export async function digestLegacyFingerprint(value: string) {
  if (/^sha256:[a-f0-9]{64}$/.test(value)) return value
  try { return await privacyDigest(JSON.parse(value)) }
  catch { return await privacyDigest(value) }
}

// This is a retention/access predicate, independent of product flags. A
// tombstone revokes every revision before its bounded byte purge completes.
export async function sourceBodyAvailable(ctx: QueryCtx | MutationCtx, userId: string, id: Id<'learnSourceSnapshots'>) {
  const source = await ctx.db.get(id)
  if (!source || source.userId !== userId || (source.effectiveStatus ?? source.status) !== 'user_accepted'
    || source.status !== 'user_accepted' || source.evidencePurgedAt !== undefined
    || source.rightsStatus === 'prohibited' || source.conflictStatus === 'unresolved') return false
  const identity = await ctx.db.get(source.sourceIdentityId)
  if (!identity || identity.userId !== userId || identity.learningVoidId !== source.learningVoidId
    || identity.tombstonedAt !== undefined) return false
  const aggregate = await ctx.db.get(source.learningVoidId)
  const folder = aggregate && await ctx.db.get(aggregate.folderId)
  if (!aggregate || aggregate.userId !== userId || !folder || folder.userId !== userId) return false
  if (identity.folderDocumentId) {
    const document = await ctx.db.get(identity.folderDocumentId)
    const documentFolder = document && await ctx.db.get(document.folderId)
    if (!document || document.userId !== userId || document.status !== 'success'
      || document.sourceRevision !== source.sourceRevision || !documentFolder || documentFolder.userId !== userId) return false
  }
  return true
}
