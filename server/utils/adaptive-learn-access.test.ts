import { beforeEach, describe, expect, test, vi } from 'vitest'

const query = vi.fn()
vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
vi.stubGlobal('createError', (options: { statusCode: number, message: string }) => Object.assign(new Error(options.message), options))
vi.stubGlobal('useRuntimeConfig', () => ({ public: { convex: { url: 'https://test.convex.cloud' } } }))
vi.mock('convex/browser', () => ({ ConvexHttpClient: class { query = query; setAuth = vi.fn() } }))
const { defineAdaptiveLearnHandler } = await import('./adaptive-learn-access')
const event = (token?: string) => ({ context: token ? { convexToken: token } : {} }) as never

describe('defineAdaptiveLearnHandler', () => {
  beforeEach(() => query.mockReset())
  test('denies before handler side effects unless the exact adaptive status is allowed', async () => {
    const handler = vi.fn()
    const guarded = defineAdaptiveLearnHandler(handler)
    await expect(guarded(event())).rejects.toMatchObject({ statusCode: 401 })
    query.mockResolvedValue({ kind: 'denied', capabilities: { entry: false, read: false, write: false, jobAdmission: false } })
    await expect(guarded(event('jwt'))).rejects.toMatchObject({ statusCode: 404 })
    query.mockResolvedValue({ kind: 'allowed', capabilities: { entry: true, read: true, write: true, jobAdmission: true }, extra: true })
    await expect(guarded(event('jwt'))).rejects.toMatchObject({ statusCode: 404 })
    expect(handler).not.toHaveBeenCalled()
  })
  test('runs only after exact authorization and sanitizes authority failures', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true })
    const guarded = defineAdaptiveLearnHandler(handler)
    query.mockRejectedValueOnce(new Error('secret'))
    await expect(guarded(event('jwt'))).rejects.toMatchObject({ statusCode: 503, message: 'Learn experience unavailable' })
    query.mockResolvedValue({ kind: 'allowed', capabilities: { entry: true, read: true, write: true, jobAdmission: true } })
    await expect(guarded(event('jwt'))).resolves.toEqual({ ok: true })
  })
})
