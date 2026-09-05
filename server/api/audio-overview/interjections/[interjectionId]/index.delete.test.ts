import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockQuery = vi.fn()
const mockMutation = vi.fn()
const mockWorker = vi.fn()

vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
vi.stubGlobal('getRouterParam', vi.fn(() => 'interjection_1'))
vi.stubGlobal('setResponseStatus', vi.fn())
vi.stubGlobal('createError', (options: { statusCode: number, message: string }) =>
  Object.assign(new Error(options.message), { statusCode: options.statusCode }),
)
vi.mock('../../../../utils/convex-client', () => ({
  makeConvexClient: vi.fn(() => ({ query: mockQuery, mutation: mockMutation })),
}))
vi.mock('../../../../utils/audio-overview-interjection-worker', () => ({ requestInterjectionWorker: mockWorker }))

const handler = (await import('./index.delete')).default as (event: any) => Promise<any>

describe('DELETE v2 Interjection', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockMutation.mockReset()
    mockWorker.mockReset()
  })

  test('marks an in-flight owner Interjection cancelled and explicitly removes a raced Worker artifact', async () => {
    mockQuery.mockResolvedValue({ _id: 'interjection_1', status: 'rendering', jobId: 'job_1', idempotencyKey: 'interjection-request-0001' })
    mockMutation.mockResolvedValue({ duplicate: false, status: 'cancelled' })
    mockWorker.mockResolvedValue({ deleted: true })
    const event = { context: { convexToken: 'owner-token' } }

    await expect(handler(event)).resolves.toEqual({ accepted: true, duplicate: false, status: 'cancelled' })
    expect(mockWorker).toHaveBeenCalledWith(event, 'DELETE', {
      jobId: 'job_1',
      interjectionId: 'interjection_1',
      idempotencyKey: 'interjection-request-0001',
    })
  })

  test('returns not found and makes no mutation when owner resolution fails', async () => {
    mockQuery.mockResolvedValue(null)
    await expect(handler({ context: { convexToken: 'owner-token' } })).rejects.toMatchObject({ statusCode: 404 })
    expect(mockMutation).not.toHaveBeenCalled()
    expect(mockWorker).not.toHaveBeenCalled()
  })
})
