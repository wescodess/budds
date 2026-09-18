import { beforeEach, describe, expect, test, vi } from 'vitest'

const setCookieMock = vi.fn()
const sendRedirectMock = vi.fn((_: unknown, location: string) => location)

vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
vi.stubGlobal('createError', (options: { statusCode: number, message: string }) => Object.assign(new Error(options.message), options))
vi.stubGlobal('useRuntimeConfig', () => ({ siteUrl: 'https://budds.test', public: { siteUrl: 'https://budds.test' }, calendarTokenEncryptionKey: 'state-key' }))
vi.stubGlobal('setCookie', setCookieMock)
vi.stubGlobal('sendRedirect', sendRedirectMock)

vi.mock('../../../utils/learn-v2-access', () => ({ defineLearnV2Handler: <T>(handler: T) => handler }))

const handler = (await import('./connect.get')).default

describe('GET /api/learn-v2/calendar/connect', () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'google-client'
    process.env.LEARN_V2_CALENDAR_ENABLED = 'true'
    setCookieMock.mockReset()
    sendRedirectMock.mockClear()
  })

  test('forces V2 re-consent with projection-only scopes and a V2-specific signed state cookie', async () => {
    const location = await handler({} as never)
    const url = new URL(location as string)

    expect(url.searchParams.get('scope')).toBe([
      'https://www.googleapis.com/auth/calendar.events.owned',
      'https://www.googleapis.com/auth/calendar.events.freebusy',
      'openid',
    ].join(' '))
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('redirect_uri')).toBe('https://budds.test/api/learn-v2/calendar/callback')
    expect(setCookieMock).toHaveBeenCalledWith(expect.anything(), 'learn_v2_calendar_oauth_state', expect.stringMatching(/^v1\.learn-v2-google-calendar\./), expect.objectContaining({ httpOnly: true, sameSite: 'lax', maxAge: 600 }))
  })

  test('hides the route while the independent calendar flag is disabled', async () => {
    process.env.LEARN_V2_CALENDAR_ENABLED = 'false'
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 404 })
    expect(setCookieMock).not.toHaveBeenCalled()
  })
})
