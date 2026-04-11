/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const TEST_IDENTITY = {
  tokenIdentifier: 'https://auth.example.com|user_123',
  name: 'Test User',
  email: 'test@example.com',
}

const OTHER_IDENTITY = {
  tokenIdentifier: 'https://auth.example.com|user_456',
  name: 'Other User',
  email: 'other@example.com',
}

describe('documents.generateUploadUrl', () => {
  it('[P0] should reject unauthenticated user', async () => {
    const t = convexTest(schema, modules)

    await expect(
      t.mutation(api.documents.generateUploadUrl, {}),
    ).rejects.toThrow()
  })

  it('[P0] should return URL string for authenticated user', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const url = await asUser.mutation(api.documents.generateUploadUrl, {})
    expect(typeof url).toBe('string')
    expect(url.length).toBeGreaterThan(0)
  })
})

describe('documents.createDocument', () => {
  it('[P0] should create document with correct fields and status processing', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Test Folder' })
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['test pdf content'], { type: 'application/pdf' }))
    })

    const docId = await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: 'lecture-notes.pdf',
      fileId: storageId,
      fileSize: 2048,
    })

    expect(docId).toBeDefined()

    const docs = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(docs).toHaveLength(1)
    expect(docs[0].filename).toBe('lecture-notes.pdf')
    expect(docs[0].status).toBe('processing')
    expect(docs[0].fileSize).toBeGreaterThan(0)
    expect(docs[0].userId).toBe(TEST_IDENTITY.tokenIdentifier)
    expect(docs[0].folderId).toBe(folderId)
  })

  it('[P0] should reject unauthenticated user', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Test Folder' })
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['test pdf'], { type: 'application/pdf' }))
    })

    await expect(
      t.mutation(api.documents.createDocument, {
        folderId,
        filename: 'test.pdf',
        fileId: storageId,
        fileSize: 1024,
      }),
    ).rejects.toThrow()
  })

  it('[P0] should reject if folder does not belong to user', async () => {
    const t = convexTest(schema, modules)
    const asUser1 = t.withIdentity(TEST_IDENTITY)
    const asUser2 = t.withIdentity(OTHER_IDENTITY)

    const folderId = await asUser1.mutation(api.folders.createFolder, { name: 'User1 Folder' })
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['test pdf'], { type: 'application/pdf' }))
    })

    await expect(
      asUser2.mutation(api.documents.createDocument, {
        folderId,
        filename: 'intruder.pdf',
        fileId: storageId,
        fileSize: 1024,
      }),
    ).rejects.toThrow()
  })

  it('[P0] should increment folder documentCount', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Test Folder' })
    const folderBefore = await asUser.query(api.folders.getFolder, { id: folderId })
    expect(folderBefore!.documentCount).toBe(0)

    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['pdf content'], { type: 'application/pdf' }))
    })

    await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: 'test.pdf',
      fileId: storageId,
      fileSize: 1024,
    })

    const folderAfter = await asUser.query(api.folders.getFolder, { id: folderId })
    expect(folderAfter!.documentCount).toBe(1)
  })

  it('[P1] should update folder updatedAt timestamp', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Test Folder' })
    const folderBefore = await asUser.query(api.folders.getFolder, { id: folderId })

    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['pdf content'], { type: 'application/pdf' }))
    })

    await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: 'test.pdf',
      fileId: storageId,
      fileSize: 1024,
    })

    const folderAfter = await asUser.query(api.folders.getFolder, { id: folderId })
    expect(folderAfter!.updatedAt).toBeGreaterThanOrEqual(folderBefore!.updatedAt!)
  })
})

describe('documents.listDocumentsByFolder', () => {
  it('[P0] should return documents for a given folder', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'My Folder' })
    const storageId1 = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['pdf 1'], { type: 'application/pdf' }))
    })
    const storageId2 = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['pdf 2'], { type: 'application/pdf' }))
    })

    await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: 'file1.pdf',
      fileId: storageId1,
      fileSize: 1024,
    })
    await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: 'file2.pdf',
      fileId: storageId2,
      fileSize: 2048,
    })

    const docs = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(docs).toHaveLength(2)
    expect(docs.map((d: any) => d.filename)).toContain('file1.pdf')
    expect(docs.map((d: any) => d.filename)).toContain('file2.pdf')
  })

  it('[P0] should return empty array for folder with no documents', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Empty Folder' })

    const docs = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(docs).toEqual([])
  })

  it('[P0] should respect user isolation', async () => {
    const t = convexTest(schema, modules)
    const asUser1 = t.withIdentity(TEST_IDENTITY)
    const asUser2 = t.withIdentity(OTHER_IDENTITY)

    const folder1 = await asUser1.mutation(api.folders.createFolder, { name: 'User1 Folder' })
    const folder2 = await asUser2.mutation(api.folders.createFolder, { name: 'User2 Folder' })

    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['pdf'], { type: 'application/pdf' }))
    })

    await asUser1.mutation(api.documents.createDocument, {
      folderId: folder1,
      filename: 'user1-doc.pdf',
      fileId: storageId,
      fileSize: 1024,
    })

    const user2Docs = await asUser2.query(api.documents.listDocumentsByFolder, { folderId: folder1 })
    expect(user2Docs).toEqual([])
  })

  it('[P0] should reject unauthenticated user', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Folder' })

    await expect(
      t.query(api.documents.listDocumentsByFolder, { folderId }),
    ).rejects.toThrow()
  })

  it('[P1] should order documents by _creationTime desc', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Folder' })

    const storageId1 = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['pdf 1'], { type: 'application/pdf' }))
    })
    await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: 'first.pdf',
      fileId: storageId1,
      fileSize: 1024,
    })

    const storageId2 = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['pdf 2'], { type: 'application/pdf' }))
    })
    await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: 'second.pdf',
      fileId: storageId2,
      fileSize: 2048,
    })

    const docs = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(docs[0].filename).toBe('second.pdf')
    expect(docs[1].filename).toBe('first.pdf')
  })
})

describe('documents.updateDocumentStatus (internal)', () => {
  it('[P0] should update status to success', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Folder' })
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['pdf'], { type: 'application/pdf' }))
    })

    const docId = await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: 'test.pdf',
      fileId: storageId,
      fileSize: 1024,
    })

    await t.mutation(internal.documents.updateDocumentStatus, {
      id: docId,
      status: 'success',
    })

    const docs = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(docs[0].status).toBe('success')
  })

  it('[P0] should update status to failed with reason', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Folder' })
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['pdf'], { type: 'application/pdf' }))
    })

    const docId = await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: 'corrupt.pdf',
      fileId: storageId,
      fileSize: 1024,
    })

    await t.mutation(internal.documents.updateDocumentStatus, {
      id: docId,
      status: 'failed',
      failureReason: 'PDF parsing failed: invalid header',
    })

    const docs = await asUser.query(api.documents.listDocumentsByFolder, { folderId })
    expect(docs[0].status).toBe('failed')
    expect(docs[0].failureReason).toBe('PDF parsing failed: invalid header')
  })
})

describe('documents.deleteDocument (stub)', () => {
  it('[P1] should decrement folder documentCount', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Folder' })
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(['pdf'], { type: 'application/pdf' }))
    })

    const docId = await asUser.mutation(api.documents.createDocument, {
      folderId,
      filename: 'test.pdf',
      fileId: storageId,
      fileSize: 1024,
    })

    const folderBefore = await asUser.query(api.folders.getFolder, { id: folderId })
    expect(folderBefore!.documentCount).toBe(1)

    await asUser.mutation(api.documents.deleteDocument, { id: docId })

    const folderAfter = await asUser.query(api.folders.getFolder, { id: folderId })
    expect(folderAfter!.documentCount).toBe(0)
  })
})
