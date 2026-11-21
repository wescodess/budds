import type { Doc } from '../_generated/dataModel'
import { MESSAGE_PROVENANCE_VERSION, verifyMessageProvenance } from '../../shared/learn-v2-message-provenance'

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
