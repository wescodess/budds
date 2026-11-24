import type { Doc } from '../_generated/dataModel'
import { MESSAGE_PROVENANCE_VERSION, LEGACY_MESSAGE_PROVENANCE_VERSION, verifyMessageProvenance, type MessageScopeReference, type MessageProvenance, type LegacyMessageProvenance } from '../../shared/learn-v2-message-provenance'

export function projectStoredMessage(row: Doc<'messages'>, allowContent: boolean, allowOwnText = true) {
  return {
    _id: row._id, _creationTime: row._creationTime, conversationId: row.conversationId,
    userId: row.userId, role: row.role, content: allowContent || row.role === 'user' && allowOwnText ? row.content : '',
    ...(allowContent && row.model ? { model: row.model } : {}),
    ...(allowContent && row.sources ? { sources: row.sources } : {}),
    ...(allowContent && row.interjectionContext ? { interjectionContext: row.interjectionContext } : {}),
  }
}

export function messageSigningSecret() {
  return process.env.NUXT_BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET || ''
}

export type StoredMessageProof = { state: 'invalid' | 'unknown' | 'independent' } | { state: 'known', references: MessageScopeReference[] }

export async function inspectStoredMessageProof(userId: string, message: Doc<'messages'>): Promise<StoredMessageProof> {
  const proof = message.helpScope
  if (message.userId !== userId) return { state: 'invalid' }
  if (!proof || proof.version === 'learn-v2.message-provenance.v1') return { state: 'unknown' }
  if (message.model !== undefined || message.interjectionContext || !proof.signature) return { state: 'invalid' }
  let signed: MessageProvenance | LegacyMessageProvenance
  if (proof.version === MESSAGE_PROVENANCE_VERSION) {
    if (!proof.scope || proof.references === undefined) return { state: 'invalid' }
    signed = { version: proof.version, scope: proof.scope, references: proof.references, signature: proof.signature }
  } else {
    if (proof.version !== LEGACY_MESSAGE_PROVENANCE_VERSION || !Array.isArray(proof.references)) return { state: 'invalid' }
    signed = { version: proof.version, references: proof.references, signature: proof.signature }
  }
  if (!await verifyMessageProvenance(messageSigningSecret(), userId, message.content, message.sources ?? [], signed, message.role)) return { state: 'invalid' }
  if (signed.version === MESSAGE_PROVENANCE_VERSION && signed.scope === 'independent') return { state: 'independent' }
  if ((signed.version === LEGACY_MESSAGE_PROVENANCE_VERSION || signed.scope === 'known') && signed.references?.some(reference => reference.kind === 'document')) {
    return { state: 'known', references: signed.references }
  }
  return { state: 'unknown' }
}

export async function verifiedStoredMessageScope(userId: string, message: Doc<'messages'>) {
  const proof = await inspectStoredMessageProof(userId, message)
  return proof.state === 'known' ? proof.references : proof.state === 'independent' ? [] : null
}
