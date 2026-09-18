import { beforeEach, describe, expect, test, vi } from 'vitest'

const mutationMock = vi.fn()
const encryptTokenMock = vi.fn(async (value: string) => `encrypted:${value}`)
const deleteCookieMock = vi.fn()
const sendRedirectMock = vi.fn((_: unknown, location: string) => location)
const fetchMock = vi.fn()

vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
vi.stubGlobal('createError', (options: { statusCode: number, message: string }) => Object.assign(new Error(options.message), options))
vi.stubGlobal('useRuntimeConfig', () => ({ siteUrl: 'https://budds.test', public: { siteUrl: 'https://budds.test' }, calendarTokenEncryptionKey: 'state-key' }))
vi.stubGlobal('getQuery', () => ({ code: 'code', state: 'state' }))
vi.stubGlobal('getCookie', () => 'cookie')
vi.stubGlobal('deleteCookie', deleteCookieMock)
vi.stubGlobal('sendRedirect', sendRedirectMock)
vi.stubGlobal('$fetch', fetchMock)

vi.mock('../../../../convex/_generated/api', () => ({ api: { calendarConnections: { upsertConnection: 'upsert' } } }))
vi.mock('../../../../shared/calendar-token-encryption', () => ({ encryptCalendarToken: encryptTokenMock }))
vi.mock('../../../utils/convex-client', () => ({ makeConvexClient: () => ({ mutation: mutationMock }) }))
vi.mock('../../../utils/learn-v2-access', () => ({ defineLearnV2Handler: <T>(handler: T) => handler }))
vi.mock('../../../utils/learn-v2-calendar-oauth', () => ({
  LEARN_V2_GOOGLE_CALENDAR_SCOPES: [
    'https://www.googleapis.com/auth/calendar.events.owned',
    'https://www.googleapis.com/auth/calendar.events.freebusy',
    'openid',
  ],
  parseLearnV2GoogleGrantedScopes: (scope: string | undefined) => scope?.includes('calendar.events.freebusy') ? scope.split(' ') : null,
  verifyLearnV2CalendarOAuthState: () => true,
}))

const handler = (await import('./callback.get')).default

describe('GET /api/learn-v2/calendar/callback', () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'google-client'
    process.env.GOOGLE_CLIENT_SECRET = 'google-secret'
    process.env.LEARN_V2_CALENDAR_ENABLED = 'true'
    mutationMock.mockReset()
    encryptTokenMock.mockClear()
    deleteCookieMock.mockClear()
    sendRedirectMock.mockClear()
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: 'https://www.googleapis.com/auth/calendar.events.owned https://www.googleapis.com/auth/calendar.events.freebusy openid' })
    fetchMock.mockResolvedValueOnce({ value: 'America/Toronto' })
  })

  test('stores encrypted tokens with V2 consent and exact granted scopes', async () => {
    await expect(handler({} as never)).resolves.toBe('https://budds.test/app/learn/today?calendar_connected=true')
    expect(deleteCookieMock).toHaveBeenCalledWith(expect.anything(), 'learn_v2_calendar_oauth_state', { path: '/' })
    expect(mutationMock).toHaveBeenCalledWith('upsert', expect.objectContaining({
      provider: 'google',
      accessToken: 'encrypted:access',
      refreshToken: 'encrypted:refresh',
      timezone: 'America/Toronto',
      learnV2ConsentVersion: 1,
      grantedScopes: [
        'https://www.googleapis.com/auth/calendar.events.owned',
        'https://www.googleapis.com/auth/calendar.events.freebusy',
        'openid',
      ],
    }))
    expect(encryptTokenMock).toHaveBeenCalledWith('access', 'state-key')
    expect(encryptTokenMock).toHaveBeenCalledWith('refresh', 'state-key')
  })

  test('does not persist a partial Google consent grant', async () => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce({ access_token: 'access', expires_in: 3600, scope: 'openid https://www.googleapis.com/auth/calendar.events.owned' })
    await expect(handler({} as never)).resolves.toBe('https://budds.test/app/learn/today?calendar_error=insufficient_scope')
    expect(mutationMock).not.toHaveBeenCalled()
  })
})
