import { describe, expect, it } from 'vitest'
import { assertE2eServerMode, isAuthorizedE2eRequest, isE2eServerMode } from './e2e-mode'

const enabled = { NODE_ENV: 'test', BUDDS_E2E_MODE: 'true', BUDDS_E2E_AUTH_TOKEN: 'a'.repeat(32) }

describe('E2E server mode', () => {
  it('fails closed unless explicit non-production credentials are present', () => {
    expect(isE2eServerMode({ NODE_ENV: 'test', BUDDS_E2E_MODE: 'true' })).toBe(false)
    expect(isE2eServerMode({ ...enabled, NODE_ENV: 'production' })).toBe(false)
    expect(() => assertE2eServerMode({ ...enabled, NODE_ENV: 'production' })).toThrow('E2E_MODE_DISABLED')
  })

  it('requires the server-only bootstrap token', () => {
    expect(isAuthorizedE2eRequest(enabled.BUDDS_E2E_AUTH_TOKEN, enabled)).toBe(true)
    expect(isAuthorizedE2eRequest('wrong', enabled)).toBe(false)
  })
})
