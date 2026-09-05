function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export async function deriveAudioOverviewJobCapability(
  secret: string,
  userId: string,
  idempotencyKey: string,
): Promise<string> {
  if (!secret.trim()) throw new Error('Audio overview job secret is not configured')
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`audio-overview-job:v1\n${userId}\n${idempotencyKey}`),
  )
  return bytesToBase64Url(new Uint8Array(signature))
}

export async function hashAudioOverviewJobCapability(capability: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(capability))
  return bytesToBase64Url(new Uint8Array(digest))
}

export function isAudioOverviewIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value)
}
