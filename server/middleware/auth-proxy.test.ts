import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
const handler = (await import('./auth-proxy')).default

const upstream = vi.fn<typeof fetch>()
const appendResponseHeader = vi.fn()
const setResponseStatus = vi.fn()
const body = Buffer.from(JSON.stringify({ provider: 'google', callbackURL: '/app' }))
let requestOrigin = 'https://budds-ci.invalid'
let requestHeaders: Record<string, string>

beforeEach(() => {
  requestOrigin = 'https://budds-ci.invalid'
  requestHeaders = { host: 'budds-ci.invalid', cookie: 'better-auth.session_token=session' }
  upstream.mockReset()
  appendResponseHeader.mockClear()
  setResponseStatus.mockClear()
  vi.stubGlobal('fetch', upstream)
  vi.stubGlobal('useRuntimeConfig', () => ({ convexSiteUrl: 'https://auth.budds-ci.invalid', siteUrl: 'https://budds-ci.invalid' }))
  vi.stubGlobal('getRequestHeader', (_event: unknown, name: string) => requestHeaders[name])
  vi.stubGlobal('getRequestHeaders', () => requestHeaders)
  vi.stubGlobal('getRequestURL', () => new URL(requestOrigin))
  vi.stubGlobal('readRawBody', async () => body)
  vi.stubGlobal('appendResponseHeader', appendResponseHeader)
  vi.stubGlobal('setResponseStatus', setResponseStatus)
})

afterEach(() => vi.unstubAllGlobals())

describe('Convex auth proxy', () => {
  test('forwards sign-in and replaces forged adapter origin headers with the public URL', async () => {
    requestHeaders['x-better-auth-forwarded-host'] = 'untrusted.invalid'
    requestHeaders['x-better-auth-forwarded-proto'] = 'http'
    upstream.mockResolvedValue(new Response('{"url":"https://accounts.google.com/"}', { status: 200 }))
    await handler({ path: '/api/auth/sign-in/social', method: 'POST' } as never)
    const [url, options] = upstream.mock.calls[0]!
    expect(url).toBe('https://auth.budds-ci.invalid/api/auth/sign-in/social')
    expect(options).toMatchObject({ method: 'POST', body, redirect: 'manual' })
    const headers = new Headers(options?.headers)
    expect(headers.get('cookie')).toBe(requestHeaders.cookie)
    expect(headers.get('host')).toBe('auth.budds-ci.invalid')
    expect(headers.get('x-better-auth-forwarded-host')).toBe('budds-ci.invalid')
    expect(headers.get('x-better-auth-forwarded-proto')).toBe('https')
  })

  test('preserves session JSON and upstream failure status for SSR', async () => {
    upstream.mockResolvedValue(new Response('{"message":"Unauthorized"}', { status: 401 }))
    const result = await handler({ path: '/api/auth/get-session', method: 'GET' } as never)
    expect(result?.toString()).toBe('{"message":"Unauthorized"}')
    expect(upstream.mock.calls[0]?.[1]?.body).toBeUndefined()
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 401, expect.anything())
  })

  test('preserves every sign-out cookie and never caches a token response', async () => {
    const headers = new Headers({ 'cache-control': 'no-store' })
    headers.append('set-cookie', 'better-auth.session_token=; Max-Age=0; Secure; HttpOnly; SameSite=Lax')
    headers.append('set-cookie', 'better-auth.convex_jwt=; Max-Age=0; Secure; HttpOnly; SameSite=Lax')
    upstream.mockResolvedValue(new Response('{"success":true}', { headers }))
    await handler({ path: '/api/auth/sign-out', method: 'POST' } as never)
    expect(appendResponseHeader).toHaveBeenCalledWith(expect.anything(), 'cache-control', 'no-store')
    expect(appendResponseHeader.mock.calls.filter(call => call[1] === 'set-cookie').map(call => call[2])).toEqual(headers.getSetCookie())
  })

  test('rewrites a local callback and cookie scope while preserving external OAuth redirects', async () => {
    requestOrigin = 'http://localhost:3002'
    requestHeaders.host = 'localhost:3002'
    upstream.mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'https://budds-ci.invalid/app', 'set-cookie': 'better-auth.session_token=value; Domain=budds-ci.invalid; Secure; HttpOnly; SameSite=None' },
    }))
    await handler({ path: '/api/auth/callback/google?code=ci-only', method: 'GET' } as never)
    expect(appendResponseHeader).toHaveBeenCalledWith(expect.anything(), 'location', 'http://localhost:3002/app')
    expect(appendResponseHeader).toHaveBeenCalledWith(expect.anything(), 'set-cookie', 'better-auth.session_token=value; HttpOnly; SameSite=Lax')
    upstream.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/o/oauth2/v2/auth' } }))
    await handler({ path: '/api/auth/sign-in/social', method: 'POST' } as never)
    expect(appendResponseHeader).toHaveBeenCalledWith(expect.anything(), 'location', 'https://accounts.google.com/o/oauth2/v2/auth')
  })
})
