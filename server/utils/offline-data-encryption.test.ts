import { describe, expect, test } from 'vitest'
import {
  decryptOfflineBytes,
  decryptOfflineJson,
  encryptOfflineBytes,
  encryptOfflineJson,
  generateOfflineDataKey,
} from '../../shared/offline-data-encryption'

describe('offline data encryption', () => {
  test('encrypts structured learning data with a non-extractable key', async () => {
    const key = await generateOfflineDataKey()
    const payload = await encryptOfflineJson({ answer: 'private study answer' }, key)

    expect(key.extractable).toBe(false)
    expect(payload.ciphertext).not.toContain('private study answer')
    await expect(decryptOfflineJson(payload, key)).resolves.toEqual({ answer: 'private study answer' })
  })

  test('encrypts cached audio bytes', async () => {
    const key = await generateOfflineDataKey()
    const bytes = new TextEncoder().encode('private audio bytes')
    const payload = await encryptOfflineBytes(bytes, key)

    expect(new TextDecoder().decode(await decryptOfflineBytes(payload, key))).toBe('private audio bytes')
  })
})
