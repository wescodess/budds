export interface EncryptedOfflinePayload {
  iv: string
  ciphertext: string
}

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

export async function generateOfflineDataKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function encryptOfflineBytes(
  plaintext: Uint8Array<ArrayBuffer>,
  key: CryptoKey,
): Promise<EncryptedOfflinePayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(encrypted)) }
}

export async function decryptOfflineBytes(
  payload: EncryptedOfflinePayload,
  key: CryptoKey,
): Promise<Uint8Array<ArrayBuffer>> {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.ciphertext),
  )
  return new Uint8Array(decrypted)
}

export async function encryptOfflineJson<T>(value: T, key: CryptoKey): Promise<EncryptedOfflinePayload> {
  return await encryptOfflineBytes(new TextEncoder().encode(JSON.stringify(value)), key)
}

export async function decryptOfflineJson<T>(payload: EncryptedOfflinePayload, key: CryptoKey): Promise<T> {
  const bytes = await decryptOfflineBytes(payload, key)
  return JSON.parse(new TextDecoder().decode(bytes)) as T
}
