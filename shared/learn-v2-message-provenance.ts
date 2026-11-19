import { normalizeAssistantCitations } from './assistant-citations'
import type { Id } from '../convex/_generated/dataModel'

export const MESSAGE_PROVENANCE_VERSION = 'learn-v2.message-provenance.v1' as const
export const MESSAGE_PROVENANCE_LIMIT = 64
export type MessageScopeReference = { kind: 'document', id: Id<'documents'> } | { kind: 'folder', id: Id<'folders'> }
export type MessageProvenance = { version: typeof MESSAGE_PROVENANCE_VERSION, references: MessageScopeReference[], signature: string }
type Source = { content: string, score: number, filename: string }

async function signingKey(secret: string) {
  return await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}
function payload(userId: string, content: string, sources: Source[], references: MessageScopeReference[]) {
  return new TextEncoder().encode(JSON.stringify([MESSAGE_PROVENANCE_VERSION, userId, normalizeAssistantCitations(content),
    sources.map(source => [source.content, source.score, source.filename]), references.map(reference => [reference.kind, reference.id])]))
}
export async function signMessageProvenance(secret: string, userId: string, content: string, sources: Source[], references: MessageScopeReference[]): Promise<MessageProvenance | undefined> {
  if (!secret || !references.length || references.length > MESSAGE_PROVENANCE_LIMIT) return
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), payload(userId, content, sources, references))
  return { version: MESSAGE_PROVENANCE_VERSION, references, signature: Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('') }
}
export async function verifyMessageProvenance(secret: string, userId: string, content: string, sources: Source[], provenance: MessageProvenance) {
  if (!secret || provenance.version !== MESSAGE_PROVENANCE_VERSION || !provenance.references.length
    || provenance.references.length > MESSAGE_PROVENANCE_LIMIT || !/^[a-f0-9]{64}$/.test(provenance.signature)) return false
  const signature = Uint8Array.from(provenance.signature.match(/../g)!, hex => Number.parseInt(hex, 16))
  return await crypto.subtle.verify('HMAC', await signingKey(secret), signature, payload(userId, content, sources, provenance.references))
}
