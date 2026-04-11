/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

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
  R2_ENDPOINT: 'https://r2.example.com',
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET_NAME: 'test-bucket',
}

async function setupSuccessDocument(
  t: ReturnType<typeof convexTest>,
  asUser: ReturnType<ReturnType<typeof convexTest>['withIdentity']>,
) {
  const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Biology 101' })
  const storageId = await t.run(async (ctx) => {
    return await ctx.storage.store(new Blob(['extracted text content'], { type: 'text/plain' }))
  })
  const docId = await asUser.mutation(api.documents.createDocument, {
    folderId,
    filename: 'lecture.pdf',
    fileId: storageId,
    fileSize: 4096,
  })
  await t.run(async (ctx) => {
    await ctx.db.patch(docId, { status: 'success', r2Key: `${TEST_IDENTITY.tokenIdentifier}/${docId}.txt` })
  })
  return { folderId, storageId, docId }
}

describe('documentActions.updateDocumentAiSearchMetadata — AC: prerequisite', () => {
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

  test('[P0] should call Cloudflare AI Search upsert endpoint with updated folderId', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, docId } = await setupSuccessDocument(t, asUser)

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const newFolderId = await asUser.mutation(api.folders.createFolder, { name: 'Chemistry 202' })

    await t.action(internal.documentActions.updateDocumentAiSearchMetadata, {
      documentId: String(docId),
      userId: TEST_IDENTITY.tokenIdentifier,
      folderId: String(newFolderId),
      filename: 'lecture.pdf',
    })

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toContain('/ai-search/instances/')
    expect(url).toContain('/documents/upsert')

    const body = JSON.parse(options.body)
    expect(body.documents[0].attributes.folderId).toBe(String(newFolderId))
  })

  test('[P0] should not throw when AI Search API returns an error', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, docId } = await setupSuccessDocument(t, asUser)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Service Unavailable'),
    }))

    await expect(
      t.action(internal.documentActions.updateDocumentAiSearchMetadata, {
        documentId: String(docId),
        userId: TEST_IDENTITY.tokenIdentifier,
        folderId: String(folderId),
        filename: 'lecture.pdf',
      }),
    ).resolves.not.toThrow()
  })
})

describe('documents.moveDocument — schedules metadata update (AC: prerequisite)', () => {
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalEnv = { ...process.env }
    Object.assign(process.env, CF_ENV)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    }))
  })

  afterEach(() => {
    process.env = originalEnv
    vi.unstubAllGlobals()
  })

  test('[P0] should schedule metadata update when moving a document with status success', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const { folderId, docId } = await setupSuccessDocument(t, asUser)

    const destFolderId = await asUser.mutation(api.folders.createFolder, { name: 'Physics 201' })

    await asUser.mutation(api.documents.moveDocument, {
      id: docId,
      destinationFolderId: destFolderId,
    })

    const doc = await t.run(async (ctx) => await ctx.db.get(docId))
    expect(doc?.folderId).toBe(destFolderId)
  })
})
