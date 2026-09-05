/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const mockS3Send = vi.hoisted(() => vi.fn())

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(public readonly input: unknown) {}
  }
  return {
    S3Client: class {
      send = mockS3Send
    },
    PutObjectCommand: Command,
    DeleteObjectCommand: Command,
    CopyObjectCommand: Command,
  }
})

const modules = import.meta.glob('./**/*.ts')
const IDENTITY = {
  tokenIdentifier: 'https://auth.example.com|post-put-race-user',
  name: 'Post PUT Race User',
}

describe('account deletion R2 upload boundary', () => {
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalEnv = { ...process.env }
    Object.assign(process.env, {
      CF_ACCOUNT_ID: 'test-account-id',
      CLOUDFLARE_AI_SEARCH_INSTANCE: 'test-instance',
      CLOUDFLARE_AI_SEARCH_TOKEN: 'test-token',
      R2_BUCKET_NAME: 'test-bucket',
      R2_ENDPOINT: 'https://test.r2.cloudflarestorage.com',
      R2_ACCESS_KEY_ID: 'test-key',
      R2_SECRET_ACCESS_KEY: 'test-secret',
    })
    mockS3Send.mockReset()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  test('[P0] a post-PUT document race durably records the deterministic orphan key', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'R2 race' })
    const documentId = await asUser.mutation(api.documents.createDocumentFromText, {
      folderId,
      filename: 'late-upload.md',
      text: 'Personal source content',
    })
    const expectedKey = `auth.example.com_post-put-race-user/${folderId}/${documentId}.md`

    mockS3Send.mockImplementationOnce(async () => {
      // Simulate account deletion removing the document after the external PUT
      // commits but before updateDocumentStatus can persist its r2Key.
      await t.run(async (ctx) => await ctx.db.delete(documentId))
      return {}
    })

    await expect(t.action(internal.documentActions.ingestText, {
      documentId,
      userId: IDENTITY.tokenIdentifier,
      folderId,
      filename: 'late-upload.md',
      text: 'Personal source content',
    })).resolves.toBeNull()

    const cleanup = await t.run(async (ctx) => await ctx.db
      .query('pendingCleanup')
      .withIndex('by_userId', q => q.eq('userId', IDENTITY.tokenIdentifier))
      .collect())
    expect(cleanup).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'r2', r2Key: expectedKey, attempts: 0 }),
      expect.objectContaining({
        kind: 'ai-search',
        documentId: String(documentId),
        r2Key: expectedKey,
        attempts: 0,
      }),
    ]))
    expect(mockS3Send).toHaveBeenCalledOnce()
  })
})
