import { describe, expect, test } from 'vitest'
import {
  decryptCalendarToken,
  decryptLegacyOrEncryptedCalendarToken,
  encryptCalendarToken,
  isCalendarTokenEnvelope,
} from '../../shared/calendar-token-encryption'

const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index + 1)))

describe('calendar token encryption', () => {
  test('round trips an AES-GCM envelope without storing plaintext', async () => {
    const envelope = await encryptCalendarToken('google-access-token', KEY)

    expect(isCalendarTokenEnvelope(envelope)).toBe(true)
    expect(envelope).not.toContain('google-access-token')
    await expect(decryptCalendarToken(envelope, KEY)).resolves.toBe('google-access-token')
  })

  test('uses a random IV for each encryption', async () => {
    const first = await encryptCalendarToken('same-token', KEY)
    const second = await encryptCalendarToken('same-token', KEY)

    expect(first).not.toBe(second)
  })

  test('rejects tampered ciphertext', async () => {
    const envelope = await encryptCalendarToken('secret', KEY)
    const tampered = `${envelope.slice(0, -1)}${envelope.endsWith('A') ? 'B' : 'A'}`

    await expect(decryptCalendarToken(tampered, KEY)).rejects.toThrow()
  })

  test('reads legacy Base64 only for controlled migration', async () => {
    const result = await decryptLegacyOrEncryptedCalendarToken(btoa('legacy-token'), KEY)

    expect(result).toEqual({ plaintext: 'legacy-token', legacy: true })
  })

  test('rejects keys that are not 256 bits', async () => {
    await expect(encryptCalendarToken('secret', btoa('too-short'))).rejects.toThrow(
      'exactly 32 bytes',
    )
  })
})
