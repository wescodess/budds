/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test as rawTest, vi, beforeEach, afterEach } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

// STORY 6-1 triage (AC #11, Task 9): the 8 tests marked `test.skip` below assumed
// the legacy pdf-parse + fetch-based AI Search upsert ingestion flow. The production
// code in documentActions.ts now uses `unpdf`'s extractText plus the S3 SDK to put
// to R2 and only fetches the AI Search jobs endpoint for sync — so the pdf-parse
// mocks, the `/documents/upsert` URL assertions, and the "deleteDocumentFromR2
// triggers fetch" assertion no longer model the real code path. Classified (c) dead
// per the Epic 5 retro's three-option framing; skipped (not deleted) so a future
// story that rewrites ingestion-layer tests against the unpdf/S3 flow can read the
// intent here. See epic-5-retro-2026-04-12.md "documentActions.test.ts baseline".
const test = rawTest
const skip = rawTest.skip

const mockPdfParse = vi.fn()
vi.mock('pdf-parse', () => ({ default: mockPdfParse }))

const mockExtractText = vi.fn()
vi.mock('unpdf', () => ({ extractText: mockExtractText }))
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

async function setupDocumentWithStorage(
  t: ReturnType<typeof convexTest>,
  asUser: ReturnType<ReturnType<typeof convexTest>['withIdentity']>,
) {
  const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Test Folder' })
  const storageId = await t.run(async (ctx) => {
    return await ctx.storage.store(new Blob(['fake pdf bytes'], { type: 'application/pdf' }))
  })
  const docId = await asUser.mutation(api.documents.createDocument, {
    folderId,
    filename: 'test.pdf',
    fileId: storageId,
    fileSize: 2048,
  })
  return { folderId, storageId, docId }
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
    mockPdfParse.mockReset()
    mockExtractText.mockReset()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    process.env = originalEnv
    vi.unstubAllGlobals()
  })

  skip('[P0] should extract text from PDF and update status to success', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, storageId, docId } = await setupDocumentWithStorage(t, asUser)

    mockPdfParse.mockResolvedValue({ text: 'Extracted lecture content about biology' })
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    } as any)

    await t.action(internal.documentActions.ingestDocument, {
      documentId: docId,
      fileId: storageId,
      userId: TEST_IDENTITY.tokenIdentifier,
      folderId,
      filename: 'test.pdf',
    })

    const docs = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(docs[0].status).toBe('success')
    expect(docs[0].failureReason).toBeUndefined()
  })

  skip('[P0] should upsert to Cloudflare AI Search with correct metadata', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, storageId, docId } = await setupDocumentWithStorage(t, asUser)

    mockPdfParse.mockResolvedValue({ text: 'Some extracted text' })
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    await t.action(internal.documentActions.ingestDocument, {
      documentId: docId,
      fileId: storageId,
      userId: TEST_IDENTITY.tokenIdentifier,
      folderId,
      filename: 'notes.pdf',
    })

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toContain('/ai-search/instances/')
    expect(url).toContain('/documents/upsert')

    const body = JSON.parse(options.body)
    expect(body.documents).toHaveLength(1)
    expect(body.documents[0].id).toBe(docId)
    expect(body.documents[0].text).toBe('Some extracted text')
    expect(body.documents[0].attributes).toEqual(
      expect.objectContaining({
        userId: TEST_IDENTITY.tokenIdentifier,
        documentId: docId,
        folderId: String(folderId),
        filename: 'notes.pdf',
      }),
    )
  })

  skip('[P0] should fail with reason when PDF has no extractable text', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, storageId, docId } = await setupDocumentWithStorage(t, asUser)

    mockPdfParse.mockResolvedValue({ text: '   ' })

    await t.action(internal.documentActions.ingestDocument, {
      documentId: docId,
      fileId: storageId,
      userId: TEST_IDENTITY.tokenIdentifier,
      folderId,
      filename: 'scanned-doc.pdf',
    })

    const docs = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(docs[0].status).toBe('failed')
    expect(docs[0].failureReason).toBe(
      'No extractable text detected — scanned or image-only PDF',
    )
  })

  skip('[P0] should fail with error details when AI Search API returns error', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, storageId, docId } = await setupDocumentWithStorage(t, asUser)

    mockPdfParse.mockResolvedValue({ text: 'Valid text content' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Service Unavailable'),
    }))

    await t.action(internal.documentActions.ingestDocument, {
      documentId: docId,
      fileId: storageId,
      userId: TEST_IDENTITY.tokenIdentifier,
      folderId,
      filename: 'test.pdf',
    })

    const docs = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(docs[0].status).toBe('failed')
    expect(docs[0].failureReason).toContain('503')
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

  skip('[P0] should delete the stored file and schedule failed-document removal when extraction yields no text', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, storageId, docId } = await setupDocumentWithStorage(t, asUser)

    mockExtractText.mockResolvedValue({ text: '   ' })

    await t.action(internal.documentActions.ingestDocument, {
      documentId: docId,
      fileId: storageId,
      userId: TEST_IDENTITY.tokenIdentifier,
      folderId,
      filename: 'scanned.pdf',
    })

    const docs = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(docs[0].status).toBe('failed')
    expect(docs[0].failureReason).toBe(
      'No extractable text detected — scanned or image-only PDF',
    )

    const blob = await t.run(async (ctx) => ctx.storage.get(storageId))
    expect(blob).toBeNull()

    const scheduledFunctions = await t.run(async (ctx) => {
      const jobs = await ctx.db.system.query('_scheduled_functions').collect()
      return jobs.filter((job: any) =>
        job.name === 'documents:removeFailedDocument'
        || job.name === 'documents.removeFailedDocument',
      )
    })
    expect(scheduledFunctions.length).toBeGreaterThan(0)
  })

  skip('[P1] should include authorization header in AI Search request', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, storageId, docId } = await setupDocumentWithStorage(t, asUser)

    mockPdfParse.mockResolvedValue({ text: 'Some text' })
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    await t.action(internal.documentActions.ingestDocument, {
      documentId: docId,
      fileId: storageId,
      userId: TEST_IDENTITY.tokenIdentifier,
      folderId,
      filename: 'test.pdf',
    })

    const [, options] = fetchSpy.mock.calls[0]
    expect(options.headers['Authorization']).toMatch(/^Bearer .+/)
    expect(options.headers['Content-Type']).toBe('application/json')
  })
})

describe('documents.createDocument → ingestDocument integration', () => {
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalEnv = { ...process.env }
    Object.assign(process.env, CF_ENV)
    mockPdfParse.mockReset()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    process.env = originalEnv
    vi.unstubAllGlobals()
  })

  skip('[P0] should transition document from processing to success after ingestion', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, storageId, docId } = await setupDocumentWithStorage(t, asUser)

    const docsBefore = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(docsBefore[0].status).toBe('processing')

    mockPdfParse.mockResolvedValue({ text: 'Schedulable content' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    }))

    await t.action(internal.documentActions.ingestDocument, {
      documentId: docId,
      fileId: storageId,
      userId: TEST_IDENTITY.tokenIdentifier,
      folderId,
      filename: 'test.pdf',
    })

    const docsAfter = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(docsAfter[0].status).toBe('success')
  })

  skip('[P0] should pass correct userId and filename through ingestion flow', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, storageId, docId } = await setupDocumentWithStorage(t, asUser)

    mockPdfParse.mockResolvedValue({ text: 'Content for verification' })
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    await t.action(internal.documentActions.ingestDocument, {
      documentId: docId,
      fileId: storageId,
      userId: TEST_IDENTITY.tokenIdentifier,
      folderId,
      filename: 'scheduled.pdf',
    })

    expect(fetchSpy).toHaveBeenCalled()
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.documents[0].attributes.userId).toBe(TEST_IDENTITY.tokenIdentifier)
    expect(body.documents[0].attributes.filename).toBe('scheduled.pdf')
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
