const ENVELOPE_VERSION = 'v1'
const AAD = new TextEncoder().encode('budds/calendar-token/v1')

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function importEncryptionKey(encodedKey: string): Promise<CryptoKey> {
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = base64ToBytes(encodedKey)
  }
  catch {
    throw new Error('Calendar token encryption key must be valid Base64')
  }
  if (bytes.byteLength !== 32) {
    throw new Error('Calendar token encryption key must decode to exactly 32 bytes')
  }
  return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export function isCalendarTokenEnvelope(value: string): boolean {
  return value.startsWith(`${ENVELOPE_VERSION}.`)
}

export async function encryptCalendarToken(plaintext: string, encodedKey: string): Promise<string> {
  if (!plaintext) throw new Error('Cannot encrypt an empty calendar token')
  const key = await importEncryptionKey(encodedKey)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: AAD },
    key,
    new TextEncoder().encode(plaintext),
  )
  return `${ENVELOPE_VERSION}.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`
}

export async function decryptCalendarToken(envelope: string, encodedKey: string): Promise<string> {
  const [version, encodedIv, encodedCiphertext, ...extra] = envelope.split('.')
  if (version !== ENVELOPE_VERSION || !encodedIv || !encodedCiphertext || extra.length > 0) {
    throw new Error('Unsupported calendar token envelope')
  }
  const key = await importEncryptionKey(encodedKey)
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(encodedIv), additionalData: AAD },
    key,
    base64ToBytes(encodedCiphertext),
  )
  return new TextDecoder().decode(decrypted)
}

export async function decryptLegacyOrEncryptedCalendarToken(
  storedValue: string,
  encodedKey: string,
): Promise<{ plaintext: string; legacy: boolean }> {
  if (isCalendarTokenEnvelope(storedValue)) {
    return { plaintext: await decryptCalendarToken(storedValue, encodedKey), legacy: false }
  }
  return { plaintext: new TextDecoder().decode(base64ToBytes(storedValue)), legacy: true }
}
