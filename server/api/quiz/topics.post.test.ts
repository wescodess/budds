import { beforeEach, describe, expect, test, vi } from 'vitest'

const query = vi.hoisted(() => vi.fn())
vi.mock('../../utils/convex-client', () => ({ makeConvexClient: () => ({ query }) }))
vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
vi.stubGlobal('getConvexTokenIdentifier', () => 'owner')
vi.stubGlobal('readBody', vi.fn())
vi.stubGlobal('searchDocuments', vi.fn())
vi.stubGlobal('fetchFolderDocs', vi.fn())
vi.stubGlobal('generateCompletion', vi.fn())
vi.stubGlobal('SERVER_DEFAULT_MODEL', 'fixture')
vi.stubGlobal('createError', (options: object) => Object.assign(new Error('invalid'), options))
const handler = (await import('./topics.post')).default

describe('Quiz topic input isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    query.mockReset().mockResolvedValue([])
    vi.mocked(globalThis.readBody).mockResolvedValue({ folderId: 'folder' })
    vi.mocked(globalThis.searchDocuments).mockResolvedValue({ data: [] })
    vi.mocked(globalThis.fetchFolderDocs).mockResolvedValue([])
  })
  test.each(['measurement', 'private_scoring', 'unknown'])('denies %s before retrieval and fallback', async () => {
    query.mockRejectedValueOnce(new Error('Teaching input is unavailable'))
    await expect(handler({ context: {} })).rejects.toThrow('Teaching input is unavailable')
    expect(globalThis.searchDocuments).not.toHaveBeenCalled()
    expect(globalThis.fetchFolderDocs).not.toHaveBeenCalled()
    expect(globalThis.generateCompletion).not.toHaveBeenCalled()
  })
  test.each([{ lineage: { kind: 'scoring_spec' } }, { resourceIds: [{ kind: 'measurement_item' }] }, { payload: { answer: 'private' } }])('rejects aliases and nested payloads %j', async payload => {
    vi.mocked(globalThis.readBody).mockResolvedValue({ folderId: 'folder', ...payload })
    await expect(handler({ context: {} })).rejects.toThrow('Teaching input is unavailable')
    expect(query).not.toHaveBeenCalled()
  })
  test('ordinary empty sources return an empty topic list', async () => {
    expect(await handler({ context: {} })).toEqual({ topics: [] })
  })
})
