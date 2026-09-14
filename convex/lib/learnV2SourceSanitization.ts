const SIMPLE_PUBLIC_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/
const OPAQUE_INTEGRITY_LOCATOR = /^[A-Za-z][A-Za-z0-9+.-]*:[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/

export function sanitizePublicSourceLocator(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (/%(?![0-9A-Fa-f]{2})/.test(value)) return undefined
  try {
    const url = new URL(value)
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname) return `${url.origin}/`
    return OPAQUE_INTEGRITY_LOCATOR.test(value) ? value : undefined
  }
  catch {
    return SIMPLE_PUBLIC_LABEL.test(value) ? value : undefined
  }
}

export function incrementRecordRevision(value: number | undefined): number {
  const revision = value ?? 1
  if (!Number.isSafeInteger(revision) || revision < 1 || revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Record revision exhausted')
  }
  return revision + 1
}

export async function tombstonedSourceExternalKey(identityId: string): Promise<string> {
  // Derive the tombstone from the server-owned identity only. This is stable
  // across repeated cleanup and cannot preserve or reveal the original URL key.
  const encoded = new TextEncoder().encode(JSON.stringify({ tombstoneIdentityId: identityId }))
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoded))
  return `sha256:${[...bytes].map(value => value.toString(16).padStart(2, '0')).join('')}`
}
