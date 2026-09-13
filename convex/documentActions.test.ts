/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

vi.mock('./sourceExtractors', () => ({
  extractYouTubeTranscript: vi.fn(),
  extractWebsiteContent: vi.fn(),
  isYouTubeUrl: vi.fn(() => false),
}))

const modules = import.meta.glob('./**/*.ts')

const TEST_IDENTITY = {
  tokenIdentifier: 'https://auth.example.com|user_123',
  name: 'Test User',
  email: 'test@example.com',
}

const CF_ENV = {
  CF_ACCOUNT_ID: 'test-account-id',
  CLOUDFLARE_AI_SEARCH_INSTANCE: 'test-instance',
  CLOUDFLARE_AI_SEARCH_TOKEN: 'test-token',
  R2_BUCKET_NAME: 'test-bucket',
}

async function setupIndexingDocument(
  t: ReturnType<typeof convexTest>,
  asUser: ReturnType<ReturnType<typeof convexTest>['withIdentity']>,
) {
  const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Index verification folder' })
  const r2Key = `auth.example.com_user_123/${folderId}/zero-vector.pdf`
  const contentHash = 'a'.repeat(64)
  const sourceRevision = `sha256:${contentHash}`
  const documentId = await t.run(async (ctx) => await ctx.db.insert('documents', {
    userId: TEST_IDENTITY.tokenIdentifier,
    folderId,
    filename: 'zero-vector.pdf',
    status: 'indexing',
    fileSize: 2048,
    sourceType: 'file',
    mimeType: 'application/pdf',
    indexJobId: 'job-zero-vector',
    r2Key,
    contentHash,
    sourceRevision,
  }))
  return { folderId, r2Key, documentId, contentHash, sourceRevision }
}

function completedJobResponse() {
  return {
    ok: true,
    json: () => Promise.resolve({
      success: true,
      result: { id: 'job-zero-vector', ended_at: '2026-09-02T21:00:00.000Z', end_reason: null },
    }),
  } as unknown as Response
}

describe('documentActions.ingestDocument', () => {
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalEnv = { ...process.env }
    Object.assign(process.env, CF_ENV)
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    process.env = originalEnv
    vi.unstubAllGlobals()
  })

  test('[P1] should fail when file is not found in storage', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Test Folder' })
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['fake pdf bytes'], { type: 'application/pdf' }))
    })

    const docId = await t.run(async (ctx) => {
      return await ctx.db.insert('documents', {
        userId: TEST_IDENTITY.tokenIdentifier,
        folderId,
        filename: 'missing.pdf',
        fileId: storageId,
        status: 'processing' as const,
        fileSize: 2048,
        sourceType: 'file' as const,
      })
    })

    await t.run(async (ctx) => {
      await ctx.storage.delete(storageId)
    })

    await t.action(internal.documentActions.ingestDocument, {
      documentId: docId,
      fileId: storageId,
      userId: TEST_IDENTITY.tokenIdentifier,
      folderId,
      filename: 'missing.pdf',
    })

    const docs = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(docs[0].status).toBe('failed')
    expect(docs[0].failureReason).toContain('File not found in storage')
  })
})

describe('documentActions.pollIndexingStatus', () => {
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalEnv = { ...process.env }
    Object.assign(process.env, CF_ENV)
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    process.env = originalEnv
    vi.unstubAllGlobals()
  })

  test('[P0] does not mark a PDF indexed when Cloudflare completed the job with zero chunks', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, r2Key, documentId } = await setupIndexingDocument(t, asUser)

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(completedJobResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          result: [{ key: r2Key, source_id: 'r2:test-bucket', status: 'completed', chunks_count: 0, error: null }],
        }),
      } as unknown as Response)

    await t.action(internal.documentActions.pollIndexingStatus, {
      documentId,
      jobId: 'job-zero-vector',
    })

    const documents = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(documents[0]?.status).toBe('failed')
    expect(documents[0]?.failureReason).toBe('Search index unavailable')
    const [itemUrl, itemOptions] = vi.mocked(globalThis.fetch).mock.calls[1]!
    expect(String(itemUrl)).toContain(`/items?key=${encodeURIComponent(r2Key)}`)
    expect(itemOptions).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
    }))
  })

  test('[P0] keeps indexing and schedules verification when the item read is transiently unavailable', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, documentId } = await setupIndexingDocument(t, asUser)
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(completedJobResponse())
      .mockRejectedValueOnce(new Error('temporary network failure'))

    await t.action(internal.documentActions.pollIndexingStatus, {
      documentId,
      jobId: 'job-zero-vector',
    })

    const documents = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(documents[0]?.status).toBe('indexing')
    const scheduled = await t.run(async (ctx) => await ctx.db.system.query('_scheduled_functions').collect())
    expect(scheduled.some(job => job.name.includes('pollIndexingStatus'))).toBe(true)
  })

  test('[P0] verification retries read the item directly instead of re-fetching the completed job', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, r2Key, documentId, contentHash, sourceRevision } = await setupIndexingDocument(t, asUser)
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        result: [{
          key: r2Key,
          source_id: 'r2:test-bucket',
          status: 'completed',
          chunks_count: 3,
          metadata: {
            userid: TEST_IDENTITY.tokenIdentifier,
            folderid: String(folderId),
            documentid: String(documentId),
            contenthash: contentHash,
            sourcerevision: sourceRevision,
          },
        }],
      }),
    } as unknown as Response)

    await t.action(internal.documentActions.pollIndexingStatus, {
      documentId,
      jobId: 'job-zero-vector',
      verificationAttempt: 1,
    })

    const documents = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(documents[0]?.status).toBe('success')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0]![0])).toContain('/items?')
  })

  test('[P0] does not mark an item ready until its searchable metadata matches the document', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, r2Key, documentId } = await setupIndexingDocument(t, asUser)
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(completedJobResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          result: [{
            key: r2Key,
            source_id: 'r2:test-bucket',
            status: 'completed',
            chunks_count: 3,
            metadata: {
              userid: TEST_IDENTITY.tokenIdentifier,
              folderid: 'wrong-folder',
              documentid: String(documentId),
            },
          }],
        }),
      } as unknown as Response)

    await t.action(internal.documentActions.pollIndexingStatus, {
      documentId,
      jobId: 'job-zero-vector',
    })

    const documents = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(documents[0]?.status).toBe('indexing')
    const scheduled = await t.run(async (ctx) => await ctx.db.system.query('_scheduled_functions').collect())
    expect(scheduled.some(job => job.name.includes('updateDocumentAiSearchMetadata'))).toBe(true)
  })

  test('[P0] rejects a successful result from a stale job revision', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, r2Key, documentId } = await setupIndexingDocument(t, asUser)
    await t.run(async (ctx) => await ctx.db.patch(documentId, { indexJobId: 'newer-job' }))
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        result: [{
          key: r2Key,
          source_id: 'r2:test-bucket',
          status: 'completed',
          chunks_count: 3,
          metadata: {
            userid: TEST_IDENTITY.tokenIdentifier,
            folderid: String(folderId),
            documentid: String(documentId),
          },
        }],
      }),
    } as unknown as Response)

    await t.action(internal.documentActions.pollIndexingStatus, {
      documentId,
      jobId: 'job-zero-vector',
      verificationAttempt: 1,
    })

    const documents = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(documents[0]?.status).toBe('indexing')
    expect(documents[0]?.indexJobId).toBe('newer-job')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  test('[P0] bounds repeated metadata mismatch repairs', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, r2Key, documentId } = await setupIndexingDocument(t, asUser)
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        result: [{
          key: r2Key,
          source_id: 'r2:test-bucket',
          status: 'completed',
          chunks_count: 3,
          metadata: {},
        }],
      }),
    } as unknown as Response)

    await t.action(internal.documentActions.pollIndexingStatus, {
      documentId,
      jobId: 'job-zero-vector',
      verificationAttempt: 1,
      repairAttempt: 6,
    })

    const documents = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(documents[0]?.status).toBe('failed')
    expect(documents[0]?.failureReason).toBe('Search index unavailable')
    const scheduled = await t.run(async (ctx) => await ctx.db.system.query('_scheduled_functions').collect())
    expect(scheduled.some(job => job.name.includes('updateDocumentAiSearchMetadata'))).toBe(false)
  })

  test('[P1] bounds a job that never reaches a terminal state', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, documentId } = await setupIndexingDocument(t, asUser)
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      result: { id: 'job-zero-vector', ended_at: null, end_reason: null },
    }), { status: 200 }))

    await t.action(internal.documentActions.pollIndexingStatus, {
      documentId,
      jobId: 'job-zero-vector',
      pollAttempt: 180,
    })

    const documents = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(documents[0]?.status).toBe('failed')
    expect(documents[0]?.failureReason).toBe('Search index unavailable')
  })

  test('[P0] a mature job survives its first transient status-read failure', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, documentId } = await setupIndexingDocument(t, asUser)
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('temporary status outage'))

    await t.action(internal.documentActions.pollIndexingStatus, {
      documentId,
      jobId: 'job-zero-vector',
      pollAttempt: 7,
    })

    const documents = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(documents[0]?.status).toBe('indexing')
    const scheduled = await t.run(async (ctx) => await ctx.db.system.query('_scheduled_functions').collect())
    expect(scheduled.some(job => job.name.includes('pollIndexingStatus'))).toBe(true)
  })

  test('[P0] retries initial job acquisition when a 429 cannot yet find the active job', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, documentId } = await setupIndexingDocument(t, asUser)
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(new Response('temporarily unavailable', { status: 503 }))

    await t.action(internal.documentActions.startDocumentIndexing, { documentId })

    const documents = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(documents[0]?.status).toBe('indexing')
    const scheduled = await t.run(async (ctx) => await ctx.db.system.query('_scheduled_functions').collect())
    expect(scheduled.some(job => job.name.includes('startDocumentIndexing'))).toBe(true)
  })

  test('[P0] rejects a same-key item from another data source', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, r2Key, documentId } = await setupIndexingDocument(t, asUser)
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(completedJobResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          result: [{ key: r2Key, source_id: 'builtin', status: 'completed', chunks_count: 3 }],
        }),
      } as unknown as Response)

    await t.action(internal.documentActions.pollIndexingStatus, {
      documentId,
      jobId: 'job-zero-vector',
    })

    const documents = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(documents[0]?.status).toBe('indexing')
    const itemUrl = String(vi.mocked(globalThis.fetch).mock.calls[1]![0])
    expect(itemUrl).toContain(`source=${encodeURIComponent('r2:test-bucket')}`)
  })

  test('[P0] a resync 429 follows the active job instead of failing the document', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, documentId } = await setupIndexingDocument(t, asUser)
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(completedJobResponse())
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: [{ id: 'active-resync-job', ended_at: null }],
      }), { status: 200 }))

    await t.action(internal.documentActions.pollIndexingStatus, {
      documentId,
      jobId: 'job-zero-vector',
      needsResync: true,
    })

    const documents = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(documents[0]?.status).toBe('indexing')
    const scheduled = await t.run(async (ctx) => await ctx.db.system.query('_scheduled_functions').collect())
    expect(scheduled.some(job => job.name.includes('pollIndexingStatus'))).toBe(true)
  })
})

// deleteDocumentFromR2 tests removed — function deleted (dead since Story 5.2)
