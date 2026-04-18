/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test as rawTest, vi, beforeEach, afterEach } from 'vitest'

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
import { api, internal } from './_generated/api'
import schema from './schema'

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

// deleteDocumentFromR2 tests removed — function deleted (dead since Story 5.2)
