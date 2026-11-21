import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx, MutationCtx } from '../_generated/server'
import type { MessageScopeReference } from '../../shared/learn-v2-message-provenance'
import { getOptionalAuthUserId } from './auth'
import { LEARN_HELP_LIMITS } from './learnV2HelpContract'
import { admitArtifactInputsByIdentityForOwner, admitArtifactInputsByIdentityForRecord } from './learnV2ArtifactLineage'
import { responsePrivacyReadContext } from './learnV2PrivacyReadContext'
import { sourceBodyAvailable } from './learnV2ResponsePrivacy'
import { projectStoredMessage, inspectStoredMessageProof } from './learnV2MessageProvenance'

export async function messageReplayAccess(ctx: QueryCtx | MutationCtx, userId: string, row: Doc<'messages'>) {
  const proof = await inspectStoredMessageProof(userId, row)
  const available = proof.state === 'independent' || proof.state === 'known' && await currentMessageSourceAccess(ctx, userId, proof.references)
  const teaching = row.role === 'assistant' || Boolean(row.sources?.length || row.model || row.interjectionContext)
  return { proof, available, unavailable: teaching && !available, ownText: row.role === 'user' && proof.state !== 'invalid' }
}

export async function exportRetainedMessage(ctx: QueryCtx, userId: string, row: Doc<'messages'>) {
  const access = await messageReplayAccess(ctx, userId, row)
  return { ...projectStoredMessage(row, access.available, access.ownText), ...(access.unavailable ? { evidenceStatus: 'evidence_unavailable' as const } : {}) }
}

export async function currentMessageSourceAccess(ctx: QueryCtx | MutationCtx, userId: string, references: MessageScopeReference[] | null | undefined) {
  if (!references?.some(reference => reference.kind === 'document') || references.length > LEARN_HELP_LIMITS.references) return false
  ctx = responsePrivacyReadContext(ctx, userId)
  const folders = new Set<string>()
  const documents = new Set<Id<'documents'>>()
  let retainedIdentities = 0
  let retainedSnapshots = 0
  const folder = async (id: Id<'folders'>) => {
    let current: Id<'folders'> | undefined = id
    const path = new Set<string>()
    while (current) {
      if (path.has(current) || path.size >= LEARN_HELP_LIMITS.folderDepth) return false
      if (folders.has(current)) return true
      path.add(current)
      const row: Doc<'folders'> | null = await ctx.db.get(current)
      if (!row || row.userId !== userId) return false
      current = row.parentId
    }
    for (const item of path) folders.add(item)
    return true
  }
  try {
    for (const reference of references) {
      if (reference.kind === 'folder') {
        if (!await folder(reference.id)) return false
        continue
      }
      if (documents.has(reference.id)) continue
      documents.add(reference.id)
      const document = await ctx.db.get(reference.id)
      if (!document || document.userId !== userId || document.status !== 'success' || !await folder(document.folderId)) return false
      const identities = await ctx.db.query('learnSourceIdentities').withIndex('by_userId_and_folderDocumentId', q =>
        q.eq('userId', userId).eq('folderDocumentId', document._id)).take(LEARN_HELP_LIMITS.sources + 1 - retainedIdentities)
      retainedIdentities += identities.length
      if (retainedIdentities > LEARN_HELP_LIMITS.sources) return false
      for (const identity of identities) {
        if (identity.tombstonedAt !== undefined) return false
        const snapshots = await ctx.db.query('learnSourceSnapshots').withIndex('by_userId_and_sourceIdentityId_and_revision', q =>
          q.eq('userId', userId).eq('sourceIdentityId', identity._id)).take(LEARN_HELP_LIMITS.sources + 1 - retainedSnapshots)
        retainedSnapshots += snapshots.length
        if (retainedSnapshots > LEARN_HELP_LIMITS.sources) return false
        for (const snapshot of snapshots) if (!await sourceBodyAvailable(ctx, userId, snapshot._id, { allowUnaccepted: true })) return false
      }
    }
    if (documents.size) {
      const input = { artifacts: [...documents].map(id => ({ kind: 'document' as const, id })) }
      const admission = await getOptionalAuthUserId(ctx) === userId
        ? await admitArtifactInputsByIdentityForOwner(ctx, userId, input)
        : await admitArtifactInputsByIdentityForRecord(ctx, { kind: 'document', id: [...documents][0]! }, input)
      if (admission.status === 'rejected') return false
    }
    return true
  } catch { return false }
}
