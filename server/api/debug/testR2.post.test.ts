import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockFetchFolderDocs = vi.fn()
const mockGetConvexTokenIdentifier = vi.fn()

vi.stubGlobal('defineEventHandler', (handler: Function) => handler)
vi.stubGlobal('readBody', vi.fn())
vi.stubGlobal('createError', (options: { statusCode: number, message: string }) =>
  Object.assign(new Error(options.message), { statusCode: options.statusCode }))
vi.stubGlobal('useRuntimeConfig', vi.fn(() => ({
  r2Endpoint: 'https://r2.example.test',
  r2AccessKeyId: 'test-access-key',
  r2SecretAccessKey: 'test-secret-key',
  r2BucketName: 'test-bucket',
})))

vi.mock('../../utils/r2-folder', () => ({
  fetchFolderDocs: mockFetchFolderDocs,
}))
vi.mock('../../utils/convex-identity', () => ({
  getConvexTokenIdentifier: mockGetConvexTokenIdentifier,
}))
vi.mock('../../utils/runtime-config', () => ({
  readConfiguredRuntimeValue: vi.fn((...values: unknown[]) => values.find(Boolean)),
}))

const handler = (await import('./testR2.post')).default as Function

describe('POST /api/debug/testR2', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('ENABLE_R2_DEBUG_ROUTE', 'true')
    mockGetConvexTokenIdentifier.mockReset().mockReturnValue('server-owner')
    mockFetchFolderDocs.mockReset().mockResolvedValue([{ key: 'server-owner/folder/document.pdf' }])
    vi.mocked(globalThis.readBody as any).mockReset().mockResolvedValue({
      folderId: 'folder',
      userId: 'attacker-controlled-owner',
    })
  })

  test('[P0] is unavailable in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    const error = await handler({ context: {} }).catch((reason: unknown) => reason)

    expect(error.statusCode).toBe(404)
    expect(mockFetchFolderDocs).not.toHaveBeenCalled()
  })

  test('[P0] ignores caller identity and scopes development reads to authenticated identity', async () => {
    await handler({ context: {} })

    expect(mockGetConvexTokenIdentifier).toHaveBeenCalledOnce()
    expect(mockFetchFolderDocs).toHaveBeenCalledWith({
      userId: 'server-owner',
      folderId: 'folder',
      maxChars: 80_000,
    })
  })

  test('[P1] rejects malformed folder identifiers before storage access', async () => {
    vi.mocked(globalThis.readBody as any).mockResolvedValue({ folderId: '' })

    const error = await handler({ context: {} }).catch((reason: unknown) => reason)

    expect(error.statusCode).toBe(400)
    expect(mockFetchFolderDocs).not.toHaveBeenCalled()
  })
})
