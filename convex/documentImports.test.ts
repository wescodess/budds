/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const TEST_IDENTITY = {
  tokenIdentifier: 'https://auth.example.com|user_123',
  name: 'Test User',
  email: 'test@example.com',
}

describe('documentImports.importDocumentFromUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('[P0] imports a direct PDF link into the existing document pipeline', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Imports' })

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      headers: new Headers({
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="lecture-notes.pdf"',
      }),
      arrayBuffer: async () => new TextEncoder().encode('%PDF-1.4').buffer,
    } as Response)

    const result = await asUser.action(api.documentImports.importDocumentFromUrl, {
      folderId,
      url: 'https://example.com/lecture-notes.pdf',
    })

    expect(result?.filename).toBe('lecture-notes.pdf')

    const docs = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(docs).toHaveLength(1)
    expect(docs[0]!.filename).toBe('lecture-notes.pdf')
    expect(docs[0]!.status).toBe('processing')
  })

  it('[P0] imports HTML URLs as website source type', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Imports' })

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      arrayBuffer: async () => new TextEncoder().encode('<html></html>').buffer,
    } as Response)

    const result = await asUser.action(api.documentImports.importDocumentFromUrl, {
      folderId,
      url: 'https://example.com/index.html',
    })

    expect(result?.documentId).toBeDefined()

    const docs = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(docs).toHaveLength(1)
    expect(docs[0]!.sourceType).toBe('website')
    expect(docs[0]!.status).toBe('processing')
  })
})
