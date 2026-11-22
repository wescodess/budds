import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockQuery = vi.fn()
const mockPrivateAudioResponse = vi.fn()

vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
vi.stubGlobal('getRouterParam', vi.fn(() => 'artifact_1'))
vi.stubGlobal('createError', (options: { statusCode: number, message: string }) =>
  Object.assign(new Error(options.message), { statusCode: options.statusCode }),
)
vi.mock('../../../utils/convex-client', () => ({ makeConvexClient: vi.fn(() => ({ mutation: mockQuery })) }))
vi.mock('../../../utils/audio-overview-media', () => ({ privateAudioResponse: mockPrivateAudioResponse }))

const handler = (await import('./[artifactId].get')).default as (event: any) => Promise<Response>

describe('owner Audio Overview media route', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockPrivateAudioResponse.mockReset()
  })

  test('does not touch R2 when Convex denies ownership', async () => {
    mockQuery.mockResolvedValue({admission:{status:'ordinary'},value:null})

    await expect(handler({ context: { convexToken: 'owner-token' } })).rejects.toMatchObject({ statusCode: 404 })
    expect(mockPrivateAudioResponse).not.toHaveBeenCalled()
  })

  test('passes only Convex-resolved media to the private proxy', async () => {
    const media = { objectKey: 'audio-overviews/jobs/job_1/overview.wav', container: 'wav', contentType: 'audio/wav' }
    const response = new Response('wav')
    mockQuery.mockResolvedValue({admission:{status:'ordinary'},value:media})
    mockPrivateAudioResponse.mockResolvedValue(response)

    await expect(handler({ context: { convexToken: 'owner-token' } })).resolves.toBe(response)
    expect(mockQuery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ artifactId: 'artifact_1',idempotencyKey:expect.any(String) }))
    expect(mockPrivateAudioResponse).toHaveBeenCalledWith(expect.anything(), media, expect.any(Function))
  })

  test('does not touch R2 when the publication has protected lineage', async () => {
    mockQuery.mockRejectedValue(new Error('Teaching input is unavailable'))
    await expect(handler({ context: { convexToken: 'owner-token' } })).rejects.toThrow('Teaching input is unavailable')
    expect(mockPrivateAudioResponse).not.toHaveBeenCalled()
  })
})

vi.mock('../../../../shared/learn-v2-measurement-storage-manifest', async importOriginal => {
  const original = await importOriginal<typeof import('../../../../shared/learn-v2-measurement-storage-manifest')>()
  return { ...original, LEARN_MEASUREMENT_CAPABILITIES: { ...original.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})
