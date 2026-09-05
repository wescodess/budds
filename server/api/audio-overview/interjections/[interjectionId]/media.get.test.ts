import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockQuery = vi.fn()
const mockPrivateAudioResponse = vi.fn()

vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
vi.stubGlobal('getRouterParam', vi.fn(() => 'interjection_1'))
vi.stubGlobal('createError', (options: { statusCode: number, message: string }) =>
  Object.assign(new Error(options.message), { statusCode: options.statusCode }),
)
vi.mock('../../../../utils/convex-client', () => ({ makeConvexClient: vi.fn(() => ({ query: mockQuery })) }))
vi.mock('../../../../utils/audio-overview-media', () => ({ privateAudioResponse: mockPrivateAudioResponse }))

const handler = (await import('./media.get')).default as (event: any) => Promise<Response>

describe('owner Interjection media route', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockPrivateAudioResponse.mockReset()
  })

  test('does not touch R2 when Convex denies ownership', async () => {
    mockQuery.mockResolvedValue(null)
    await expect(handler({ context: { convexToken: 'owner-token' } })).rejects.toMatchObject({ statusCode: 404 })
    expect(mockPrivateAudioResponse).not.toHaveBeenCalled()
  })

  test('proxies only the private artifact resolved from the Interjection ID', async () => {
    const media = { objectKey: 'audio-overviews/jobs/job_1/interjections/interjection_1.wav', container: 'wav', contentType: 'audio/wav' }
    const response = new Response('wav')
    mockQuery.mockResolvedValue(media)
    mockPrivateAudioResponse.mockResolvedValue(response)
    await expect(handler({ context: { convexToken: 'owner-token' } })).resolves.toBe(response)
    expect(mockQuery).toHaveBeenCalledWith(expect.anything(), { interjectionId: 'interjection_1' })
    expect(mockPrivateAudioResponse).toHaveBeenCalledWith(expect.anything(), media)
  })
})
