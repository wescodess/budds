import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockQuery = vi.fn()
const mockPrivateAudioResponse = vi.fn()

vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
vi.stubGlobal('getRouterParam', vi.fn(() => 'artifact_1'))
vi.stubGlobal('createError', (options: { statusCode: number, message: string }) =>
  Object.assign(new Error(options.message), { statusCode: options.statusCode }),
)
vi.mock('../../../utils/convex-client', () => ({ makeConvexClient: vi.fn(() => ({ query: mockQuery })) }))
vi.mock('../../../utils/audio-overview-media', () => ({ privateAudioResponse: mockPrivateAudioResponse }))

const handler = (await import('./[artifactId].get')).default as (event: any) => Promise<Response>

describe('owner Audio Overview media route', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockPrivateAudioResponse.mockReset()
  })

  test('does not touch R2 when Convex denies ownership', async () => {
    mockQuery.mockResolvedValue(null)

    await expect(handler({ context: { convexToken: 'owner-token' } })).rejects.toMatchObject({ statusCode: 404 })
    expect(mockPrivateAudioResponse).not.toHaveBeenCalled()
  })

  test('passes only Convex-resolved media to the private proxy', async () => {
    const media = { objectKey: 'audio-overviews/jobs/job_1/overview.wav', container: 'wav', contentType: 'audio/wav' }
    const response = new Response('wav')
    mockQuery.mockResolvedValue(media)
    mockPrivateAudioResponse.mockResolvedValue(response)

    await expect(handler({ context: { convexToken: 'owner-token' } })).resolves.toBe(response)
    expect(mockQuery).toHaveBeenCalledWith(expect.anything(), { artifactId: 'artifact_1' })
    expect(mockPrivateAudioResponse).toHaveBeenCalledWith(expect.anything(), media)
  })
})
