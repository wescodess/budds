import type { Id } from '../convex/_generated/dataModel'

export const MESSAGE_PROVENANCE_VERSION = 'learn-v2.message-provenance.v3' as const
export const LEGACY_MESSAGE_PROVENANCE_VERSION = 'learn-v2.message-provenance.v2' as const
export const MESSAGE_PROVENANCE_LIMIT = 64
export type MessageScopeReference = { kind: 'document', id: Id<'documents'> } | { kind: 'folder', id: Id<'folders'> }
export type MessageProvenance = { version: typeof MESSAGE_PROVENANCE_VERSION, scope: 'known' | 'unknown' | 'independent', references: MessageScopeReference[] | null, signature: string }
export type LegacyMessageProvenance = { version: typeof LEGACY_MESSAGE_PROVENANCE_VERSION, references: MessageScopeReference[], signature: string }
type Source = { content: string, score: number, filename: string }

async function signingKey(secret: string) {
  return await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}
function payload(userId: string, role: 'user' | 'assistant', content: string, sources: Source[], proof: Pick<MessageProvenance, 'version' | 'scope' | 'references'> | Omit<LegacyMessageProvenance, 'signature'>) {
  const values: unknown[] = [proof.version, userId, role, content, sources.map(source => [source.content, source.score, source.filename])]
  if (proof.version === MESSAGE_PROVENANCE_VERSION) values.push(proof.scope)
  values.push(proof.references?.map(reference => [reference.kind, reference.id]) ?? null)
  return new TextEncoder().encode(JSON.stringify(values))
}
export async function signMessageProvenance(secret: string, userId: string, content: string, sources: Source[], references: MessageScopeReference[] | null,
  role: 'user' | 'assistant' = 'assistant', origin: 'contextual' | 'independent' = 'contextual'): Promise<MessageProvenance | undefined> {
  if (!secret || (references?.length ?? 0) > MESSAGE_PROVENANCE_LIMIT || sources.some(source => !Number.isFinite(source.score) || Object.is(source.score, -0))) return
  if (origin === 'independent' && (sources.length || references?.length)) return
  const scope = origin === 'independent' ? 'independent' : references?.some(reference => reference.kind === 'document') ? 'known' : 'unknown'
  const proof = { version: MESSAGE_PROVENANCE_VERSION, scope, references: scope === 'known' ? references : null } as const
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), payload(userId, role, content, sources, proof))
  return { ...proof, signature: Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('') }
}
export async function verifyMessageProvenance(secret: string, userId: string, content: string, sources: Source[], proof: MessageProvenance | LegacyMessageProvenance, role: 'user' | 'assistant' = 'assistant') {
  if (!secret || sources.some(source => !Number.isFinite(source.score) || Object.is(source.score, -0)) || !/^[a-f0-9]{64}$/.test(proof.signature)) return false
  if (proof.version === MESSAGE_PROVENANCE_VERSION) {
    if (proof.scope === 'known') {
      if (!proof.references?.some(reference => reference.kind === 'document') || proof.references.length > MESSAGE_PROVENANCE_LIMIT) return false
    } else if (!['unknown', 'independent'].includes(proof.scope) || proof.references !== null || proof.scope === 'independent' && sources.length) return false
  } else if (proof.version !== LEGACY_MESSAGE_PROVENANCE_VERSION || !Array.isArray(proof.references) || proof.references.length > MESSAGE_PROVENANCE_LIMIT) return false
  const signature = Uint8Array.from(proof.signature.match(/../g)!, hex => Number.parseInt(hex, 16))
  return await crypto.subtle.verify('HMAC', await signingKey(secret), signature, payload(userId, role, content, sources, proof))
}
