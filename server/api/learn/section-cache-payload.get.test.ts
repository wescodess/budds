import { beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../../convex/_generated/api'

const query = vi.hoisted(() => vi.fn())
vi.mock('../../utils/convex-client', () => ({ makeConvexClient: () => ({ query }) }))
vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
vi.stubGlobal('getQuery', () => ({ sectionId: 'section_1' }))
vi.stubGlobal('createError', (options: { statusCode: number, statusMessage: string }) => Object.assign(new Error(options.statusMessage), options))
const handler = (await import('./section-cache-payload.get')).default

describe('section offline transport lineage', () => {
  beforeEach(() => { query.mockReset() })

  test('returns only the authoritative offline projection', async () => {
    const payload = { sectionId: 'section_1', contentBlocks: [{ type: 'text', content: 'Ordinary teaching' }] }
    query.mockResolvedValue(payload)
    await expect(handler({ context: { convexToken: 'owner-token' } } as never)).resolves.toEqual(payload)
    expect(query).toHaveBeenCalledWith(api.courseSections.getOfflineCachePayload, { sectionId: 'section_1' })
  })

  test('rejects a protected nested payload without returning an offline envelope', async () => {
    query.mockRejectedValue(new Error('Teaching input is unavailable'))
    await expect(handler({ context: { convexToken: 'owner-token' } } as never)).rejects.toThrow('Teaching input is unavailable')
    expect(query).toHaveBeenCalledOnce()
  })
})
