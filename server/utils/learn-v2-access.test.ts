import { beforeEach, describe, expect, test, vi } from 'vitest'

const queryMock = vi.fn()
const setAuthMock = vi.fn()

vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
vi.stubGlobal('createError', (options: { statusCode: number, message: string }) =>
  Object.assign(new Error(options.message), { statusCode: options.statusCode }),
)
vi.stubGlobal('useRuntimeConfig', () => ({ public: { convex: { url: 'https://test.convex.cloud' } } }))

vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    query = queryMock
    setAuth = setAuthMock
  },
}))

const { defineLearnV2Handler } = await import('./learn-v2-access')

function event(token?: string) {
  return { context: token ? { convexToken: token } : {} } as never
}

describe('defineLearnV2Handler', () => {
  beforeEach(() => {
    queryMock.mockReset()
    setAuthMock.mockReset()
  })

  test('returns 401 before the handler runs when no JWT is present', async () => {
    const handler = vi.fn()
    const guarded = defineLearnV2Handler(handler)

    const error = await guarded(event()).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ statusCode: 401 })
    expect(queryMock).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  test('returns hidden-beta 404 before handler side effects for denied status', async () => {
    queryMock.mockResolvedValue({
      kind: 'denied',
      capabilities: { entry: false, read: false, write: false, jobAdmission: false },
    })
    const handler = vi.fn()
    const guarded = defineLearnV2Handler(handler)

    const error = await guarded(event('jwt')).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ statusCode: 404 })
    expect(handler).not.toHaveBeenCalled()
  })

  test('runs the handler only after Convex authorizes access', async () => {
    queryMock.mockResolvedValue({
      kind: 'allowed',
      capabilities: { entry: true, read: true, write: true, jobAdmission: true },
    })
    const handler = vi.fn().mockResolvedValue({ ok: true })
    const guarded = defineLearnV2Handler(handler)
    const request = event('jwt')

    await expect(guarded(request)).resolves.toEqual({ ok: true })
    expect(setAuthMock).toHaveBeenCalledWith('jwt')
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(request)
  })

  test.each([
    {
      label: 'malformed allowed capabilities',
      value: { kind: 'allowed', capabilities: { entry: true } },
    },
    {
      label: 'extra allowed capability',
      value: {
        kind: 'allowed',
        capabilities: { entry: true, read: true, write: true, jobAdmission: true, admin: true },
      },
    },
    {
      label: 'extra allowed status field',
      value: {
        kind: 'allowed',
        capabilities: { entry: true, read: true, write: true, jobAdmission: true },
        reason: 'trusted-client',
      },
    },
    { label: 'unknown shape', value: { kind: 'future-state' } },
  ])('fails closed before handler side effects for $label', async ({ value }) => {
    queryMock.mockResolvedValue(value)
    const handler = vi.fn()
    const guarded = defineLearnV2Handler(handler)

    const error = await guarded(event('jwt')).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ statusCode: 404 })
    expect(handler).not.toHaveBeenCalled()
  })

  test('returns sanitized 503 before handler side effects when Convex status fails', async () => {
    queryMock.mockRejectedValue(new Error('sensitive upstream detail'))
    const handler = vi.fn()
    const guarded = defineLearnV2Handler(handler)

    const error = await guarded(event('jwt')).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ statusCode: 503, message: 'Learn experience unavailable' })
    expect(error.message).not.toContain('sensitive upstream detail')
    expect(handler).not.toHaveBeenCalled()
  })
})
