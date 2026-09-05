import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockQuery = vi.fn()
const mockPrivateAudioResponse = vi.fn()

vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
vi.stubGlobal('getRouterParam', vi.fn(() => 'shared_token_1234567890'))
vi.stubGlobal('useRuntimeConfig', vi.fn(() => ({ public: { convex: { url: 'https://test.convex.cloud' } } })))
vi.stubGlobal('createError', (options: { statusCode: number, message: string }) =>
  Object.assign(new Error(options.message), { statusCode: options.statusCode }),
)
vi.mock('convex/browser', () => ({ ConvexHttpClient: class { query = mockQuery } }))
vi.mock('../../../../utils/runtime-config', () => ({ readConfiguredRuntimeValue: vi.fn((...values: unknown[]) => values.find(Boolean)) }))
vi.mock('../../../../utils/audio-overview-media', () => ({ privateAudioResponse: mockPrivateAudioResponse }))

const handler = (await import('./media.get')).default as (event: any) => Promise<Response>

describe('public Audio Overview media route', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockPrivateAudioResponse.mockReset()
  })

  test('does not touch R2 after a revoked or unknown share token', async () => {
    mockQuery.mockResolvedValue(null)

    await expect(handler({ context: {} })).rejects.toMatchObject({ statusCode: 404 })
    expect(mockPrivateAudioResponse).not.toHaveBeenCalled()
  })

  test('uses only the artifact resolved by the public share projection', async () => {
    const media = { objectKey: 'audio-overviews/jobs/job_1/overview.wav', container: 'wav', contentType: 'audio/wav' }
    const response = new Response('wav')
    mockQuery.mockResolvedValue(media)
    mockPrivateAudioResponse.mockResolvedValue(response)

    await expect(handler({ context: {} })).resolves.toBe(response)
    expect(mockQuery).toHaveBeenCalledWith(expect.anything(), { token: 'shared_token_1234567890' })
    expect(mockPrivateAudioResponse).toHaveBeenCalledWith(expect.anything(), media)
  })
})
