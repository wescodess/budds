import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
const handler = (await import('./convex-token')).default
const exchange = vi.fn()
let headers: Record<string, string>

beforeEach(() => {
  headers = { cookie: 'better-auth.session_token=session', 'user-agent': 'SSR test', origin: 'https://budds-ci.invalid' }
  exchange.mockReset()
  vi.stubGlobal('$fetch', exchange)
  vi.stubGlobal('getRequestHeader', (_event: unknown, name: string) => headers[name])
  vi.stubGlobal('useRuntimeConfig', () => ({ convexSiteUrl: 'https://auth.budds-ci.invalid' }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SSR Convex token exchange', () => {
  test('exchanges the session cookie without dropping request origin or user agent', async () => {
    exchange.mockResolvedValue({ token: 'convex-jwt' })
    const event = { context: {} }
    await handler(event as never)
    expect(exchange).toHaveBeenCalledWith('https://auth.budds-ci.invalid/api/auth/convex/token', { headers })
    expect(event.context).toEqual({ convexToken: 'convex-jwt' })
  })

  test('leaves signed-out SSR unauthenticated without an exchange', async () => {
    delete headers.cookie
    const event = { context: {} }
    await handler(event as never)
    expect(exchange).not.toHaveBeenCalled()
    expect(event.context).toEqual({})
  })

  test('allows SSR to continue unauthenticated when a session is rejected', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    exchange.mockRejectedValue(new Error('Unauthorized'))
    const event = { context: {} }
    await expect(handler(event as never)).resolves.toBeUndefined()
    expect(event.context).toEqual({})
  })
})
