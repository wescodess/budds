import type { Doc } from '../_generated/dataModel'
import { MESSAGE_PROVENANCE_VERSION, verifyMessageProvenance } from '../../shared/learn-v2-message-provenance'

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

export async function verifiedStoredMessageScope(userId: string, message: Doc<'messages'>) {
  const proof = message.helpScope
  if (message.model !== undefined || message.interjectionContext
    || proof?.version !== MESSAGE_PROVENANCE_VERSION || !proof.signature) return null
  const valid = await verifyMessageProvenance(messageSigningSecret(), userId, message.content, message.sources ?? [], {
    version: MESSAGE_PROVENANCE_VERSION, references: proof.references, signature: proof.signature,
  }, message.role).catch(() => false)
  return valid ? proof.references : null
}
