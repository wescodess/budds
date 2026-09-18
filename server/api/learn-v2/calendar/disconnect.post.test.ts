import { beforeEach, describe, expect, test, vi } from 'vitest'

const queryMock = vi.fn()
const actionMock = vi.fn()
const rateLimitMock = vi.fn()
const tokenMock = vi.fn(() => 'token-id')

vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
vi.stubGlobal('createError', (options: { statusCode: number, message: string }) => Object.assign(new Error(options.message), options))
vi.stubGlobal('getConvexTokenIdentifier', tokenMock)

vi.mock('../../../../convex/_generated/api', () => ({
  api: {
    calendarConnections: { getByUser: 'get-connection' },
    calendarEvents: { disconnectCalendar: 'disconnect-calendar' },
  },
}))
vi.mock('../../../utils/convex-client', () => ({ makeConvexClient: () => ({ query: queryMock, action: actionMock }) }))
vi.mock('../../../utils/learn-v2-access', () => ({ defineLearnV2Handler: <T>(handler: T) => handler }))
vi.mock('../../../utils/rate-limit', () => ({ requireRateLimit: rateLimitMock }))

const handler = (await import('./disconnect.post')).default

describe('POST /api/learn-v2/calendar/disconnect', () => {
  beforeEach(() => {
    process.env.LEARN_V2_CALENDAR_ENABLED = 'true'
    queryMock.mockReset()
    actionMock.mockReset()
    rateLimitMock.mockReset()
    tokenMock.mockClear()
  })

  test('runs the provider-first disconnect action after rate limit and connection lookup', async () => {
    queryMock.mockResolvedValue({ provider: 'google' })
    actionMock.mockResolvedValue({ disconnected: true, googleEventsDeleted: 2, googleEventsFailed: 0 })

    await expect(handler({} as never)).resolves.toEqual({ disconnected: true, googleEventsDeleted: 2, googleEventsFailed: 0 })
    expect(rateLimitMock).toHaveBeenCalledWith(expect.anything(), 3, 'learn-v2.calendar.disconnect')
    expect(tokenMock).toHaveBeenCalledWith(expect.anything())
    expect(queryMock).toHaveBeenCalledWith('get-connection', {})
    expect(actionMock).toHaveBeenCalledWith('disconnect-calendar', {})
  })

  test('returns a clean absent result without invoking provider cleanup', async () => {
    queryMock.mockResolvedValue(null)
    await expect(handler({} as never)).resolves.toEqual({ disconnected: false, googleEventsDeleted: 0, googleEventsFailed: 0 })
    expect(actionMock).not.toHaveBeenCalled()
  })

  test('hides the route when the separate calendar flag is disabled', async () => {
    process.env.LEARN_V2_CALENDAR_ENABLED = 'false'
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 404 })
    expect(rateLimitMock).not.toHaveBeenCalled()
  })
})
