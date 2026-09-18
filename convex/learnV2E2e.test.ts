import { describe, expect, test } from 'vitest'
import { canBootstrapLearnV2E2e } from './lib/learnV2E2e'

const local = {
  BUDDS_E2E_MODE: 'true',
  BUDDS_E2E_AUTH_TOKEN: 'a'.repeat(32),
  CONVEX_CLOUD_URL: 'http://127.0.0.1:3210',
}

describe('Learn V2 local E2E admission', () => {
  test('admits only an explicitly marked loopback Convex backend', () => {
    expect(canBootstrapLearnV2E2e(local)).toBe(true)
  })

  test.each([
    [{ ...local, CONVEX_CLOUD_URL: 'https://example.convex.cloud' }],
    [{ ...local, CONVEX_CLOUD_URL: 'http://localhost.example.test:3210' }],
    [{ ...local, BUDDS_E2E_MODE: undefined }],
    [{ ...local, BUDDS_E2E_AUTH_TOKEN: 'short' }],
    [{ ...local, CONVEX_CLOUD_URL: undefined }],
  ])('denies cloud or incomplete configuration %#', (environment) => {
    expect(canBootstrapLearnV2E2e(environment)).toBe(false)
  })
})
