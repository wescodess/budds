/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import betterAuthTest from '@convex-dev/better-auth/test'
import schema from './schema'

// Better Auth captures NODE_ENV during module initialization and disables
// origin checks in test mode. Exercise the normal local HTTP security checks.
vi.hoisted(() => {
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('TEST', 'false')
})

const modules = import.meta.glob('./**/*.ts')
const siteUrl = 'http://localhost:3002'
const convexSiteUrl = 'http://localhost:3211'

function createTestBackend() {
  const t = convexTest(schema, modules)
  betterAuthTest.register(t)
  return t
}

function cookies(response: Response) {
  return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
}

function decodeBase64Url(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0))
}

describe('Better Auth with the Convex adapter', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('TEST', 'false')
    vi.stubEnv('SITE_URL', siteUrl)
    vi.stubEnv('CONVEX_SITE_URL', convexSiteUrl)
    vi.stubEnv('CONVEX_CLOUD_URL', 'http://localhost:3210')
    vi.stubEnv('BETTER_AUTH_SECRET', 'ci-only-better-auth-secret-000000000000')
    vi.stubEnv('GOOGLE_CLIENT_ID', 'ci-only-google-client-id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'ci-only-google-client-secret')
    vi.stubEnv('BUDDS_E2E_MODE', 'true')
    vi.stubEnv('BUDDS_E2E_AUTH_TOKEN', 'ci-only-local-auth-test-000000000000')
  })

  afterEach(() => vi.unstubAllEnvs())

  test('starts Google sign-in with PKCE state and rejects an untrusted callback', async () => {
    const t = createTestBackend()
    const signIn = (callbackURL: string) => t.fetch('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: siteUrl },
      body: JSON.stringify({ provider: 'google', callbackURL }),
    })
    const response = await signIn('/app')
    expect(response.status).toBe(200)
    const { url } = await response.json()
    const authorization = new URL(url)
    expect(authorization.hostname).toBe('accounts.google.com')
    expect(authorization.searchParams.get('client_id')).toBe('ci-only-google-client-id')
    expect(authorization.searchParams.get('redirect_uri')).toBe(`${siteUrl}/api/auth/callback/google`)
    expect(authorization.searchParams.get('state')).toBeTruthy()
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
    expect((await signIn('https://untrusted.invalid/app')).status).toBe(403)
  })

  test('creates a local session, verifies a Convex JWT, and revokes both paths on sign-out', async () => {
    const t = createTestBackend()
    const signedUp = await t.fetch('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: siteUrl },
      body: JSON.stringify({ name: 'Auth test', email: 'auth@budds-ci.invalid', password: 'ci-only-local-password-000000' }),
    })
    expect(signedUp.status).toBe(200)
    const headers = { cookie: cookies(signedUp), origin: siteUrl }
    expect(headers.cookie).toContain('session_token=')

    const session = await t.fetch('/api/auth/get-session', { headers })
    expect(session.status).toBe(200)
    const data = await session.json()
    expect(data.user.email).toBe('auth@budds-ci.invalid')
    expect(new Date(data.session.expiresAt).getTime() - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000)

    const tokenResponse = await t.fetch('/api/auth/convex/token', { headers })
    expect(tokenResponse.status).toBe(200)
    const { token } = await tokenResponse.json()
    const [header, payload, signature] = token.split('.')
    expect(JSON.parse(new TextDecoder().decode(decodeBase64Url(header))).alg).toBe('RS256')
    expect(JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)))).toMatchObject({ iss: convexSiteUrl, sub: data.user.id, aud: 'convex' })
    const jwks = await (await t.fetch('/api/auth/convex/jwks')).json()
    const key = await crypto.subtle.importKey('jwk', jwks.keys[0], { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decodeBase64Url(signature), new TextEncoder().encode(`${header}.${payload}`))).toBe(true)

    const signedOut = await t.fetch('/api/auth/sign-out', { method: 'POST', headers })
    expect(signedOut.status).toBe(200)
    expect(signedOut.headers.getSetCookie().some(value => value.includes('session_token=;') && value.includes('Max-Age=0'))).toBe(true)
    expect(await (await t.fetch('/api/auth/get-session', { headers })).json()).toBeNull()
    expect((await t.fetch('/api/auth/convex/token', { headers })).status).toBe(401)
  })

  test('rejects a real session cookie with a tampered signature on both auth paths', async () => {
    const t = createTestBackend()
    const signedUp = await t.fetch('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: siteUrl },
      body: JSON.stringify({ name: 'Auth test', email: 'auth@budds-ci.invalid', password: 'ci-only-local-password-000000' }),
    })
    expect(signedUp.status).toBe(200)
    const cookie = cookies(signedUp)
    const headers = { cookie, origin: siteUrl }
    expect((await (await t.fetch('/api/auth/get-session', { headers })).json()).user.email).toBe('auth@budds-ci.invalid')
    expect((await t.fetch('/api/auth/convex/token', { headers })).status).toBe(200)

    headers.cookie = cookie.replace(/(session_token=)([^;]+)/, (_match, prefix, value) => {
      const signedValue = decodeURIComponent(value)
      const signatureStart = signedValue.lastIndexOf('.') + 1
      const character = signedValue[signatureStart] === 'A' ? 'B' : 'A'
      return `${prefix}${encodeURIComponent(`${signedValue.slice(0, signatureStart)}${character}${signedValue.slice(signatureStart + 1)}`)}`
    })
    expect(headers.cookie).not.toBe(cookie)
    const session = await t.fetch('/api/auth/get-session', { headers })
    const tokenResponse = await t.fetch('/api/auth/convex/token', { headers })
    expect({ session: await session.json(), tokenStatus: tokenResponse.status }).toEqual({ session: null, tokenStatus: 401 })
  })

  test('rejects forged cookies and unauthenticated token exchanges', async () => {
    const t = createTestBackend()
    const headers = { cookie: 'better-auth.session_token=forged' }
    expect(await (await t.fetch('/api/auth/get-session', { headers })).json()).toBeNull()
    expect((await t.fetch('/api/auth/convex/token', { headers })).status).toBe(401)
    expect((await t.fetch('/api/auth/convex/token')).status).toBe(401)
  })
})
