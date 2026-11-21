import type { Id } from '../convex/_generated/dataModel'

export const MESSAGE_PROVENANCE_VERSION = 'learn-v2.message-provenance.v2' as const
export const MESSAGE_PROVENANCE_LIMIT = 64
export type MessageScopeReference = { kind: 'document', id: Id<'documents'> } | { kind: 'folder', id: Id<'folders'> }
export type MessageProvenance = { version: typeof MESSAGE_PROVENANCE_VERSION, references: MessageScopeReference[], signature: string }
type Source = { content: string, score: number, filename: string }

async function signingKey(secret: string) {
  return await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}
function payload(userId: string, role: 'user' | 'assistant', content: string, sources: Source[], references: MessageScopeReference[]) {
  return new TextEncoder().encode(JSON.stringify([MESSAGE_PROVENANCE_VERSION, userId, role, content,
    sources.map(source => [source.content, source.score, source.filename]), references.map(reference => [reference.kind, reference.id])]))
}
export async function signMessageProvenance(secret: string, userId: string, content: string, sources: Source[], references: MessageScopeReference[], role: 'user' | 'assistant' = 'assistant'): Promise<MessageProvenance | undefined> {
  if (!secret || references.length > MESSAGE_PROVENANCE_LIMIT || sources.some(source => !Number.isFinite(source.score) || Object.is(source.score, -0))) return
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), payload(userId, role, content, sources, references))
  return { version: MESSAGE_PROVENANCE_VERSION, references, signature: Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('') }
}
export async function verifyMessageProvenance(secret: string, userId: string, content: string, sources: Source[], provenance: MessageProvenance, role: 'user' | 'assistant' = 'assistant') {
  if (!secret || provenance.version !== MESSAGE_PROVENANCE_VERSION || sources.some(source => !Number.isFinite(source.score) || Object.is(source.score, -0))
    || provenance.references.length > MESSAGE_PROVENANCE_LIMIT || !/^[a-f0-9]{64}$/.test(provenance.signature)) return false
  const signature = Uint8Array.from(provenance.signature.match(/../g)!, hex => Number.parseInt(hex, 16))
  return await crypto.subtle.verify('HMAC', await signingKey(secret), signature, payload(userId, role, content, sources, provenance.references))
}
