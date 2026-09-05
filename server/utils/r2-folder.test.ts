import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const config = {
  r2Endpoint: 'https://account.r2.cloudflarestorage.com',
  r2AccessKeyId: 'test-access-key',
  r2SecretAccessKey: 'test-secret',
  r2BucketName: 'private-bucket',
}

const { fetchFolderDocs, getScopedR2ObjectIdentity } = await import('./r2-folder')

describe('getScopedR2ObjectIdentity', () => {
  beforeEach(() => {
    vi.stubGlobal('useRuntimeConfig', vi.fn(() => config))
    vi.stubGlobal('createError', (value: { statusCode: number, message: string }) =>
      Object.assign(new Error(value.message), value),
    )
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => vi.unstubAllGlobals())

  test('uses the immutable SHA-256 stored on new R2 uploads without downloading the source', async () => {
    const contentHash = 'a'.repeat(64)
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, {
      status: 200,
      headers: {
        'content-length': '128',
        'etag': '"object-etag"',
        'x-amz-meta-contenthash': contentHash,
        'x-amz-meta-sourcerevision': `sha256:${contentHash}`,
      },
    }))

    await expect(getScopedR2ObjectIdentity('owner/folder/source.pdf')).resolves.toEqual({
      key: 'owner/folder/source.pdf',
      contentHash,
      revision: `sha256:${contentHash}`,
      byteLength: 128,
      etag: 'object-etag',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect((vi.mocked(fetch).mock.calls[0]?.[0] as Request).method).toBe('HEAD')
  })

  test('hashes the exact bytes of a legacy R2 object once', async () => {
    const bytes = new TextEncoder().encode('legacy PDF bytes')
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, {
        status: 200,
        headers: { 'content-length': String(bytes.byteLength), 'etag': '"legacy-etag"' },
      }))
      .mockResolvedValueOnce(new Response(bytes, { status: 200 }))

    const result = await getScopedR2ObjectIdentity('owner/folder/legacy.pdf')

    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.revision).toBe(`sha256:${result.contentHash}`)
    expect(result.byteLength).toBe(bytes.byteLength)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  test('rejects an object that changes between identity reads', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { 'content-length': '4' } }))
      .mockResolvedValueOnce(new Response('changed', { status: 200 }))

    await expect(getScopedR2ObjectIdentity('owner/folder/source.pdf')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Source changed while the audio overview was being prepared',
    })
  })

  test('returns immutable identity metadata with a scoped text fallback', async () => {
    const contentHash = 'c'.repeat(64)
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Grounded source text', {
      status: 200,
      headers: {
        'x-amz-meta-filename': 'source.md',
        'x-amz-meta-contenthash': contentHash,
        'x-amz-meta-sourcerevision': `sha256:${contentHash}`,
      },
    }))

    await expect(fetchFolderDocs({
      userId: 'owner',
      documents: [{ documentId: 'doc_1', folderId: 'folder_1', filename: 'source.md', r2Key: 'owner/folder/source.md' }],
    })).resolves.toEqual([{
      key: 'owner/folder/source.md',
      documentId: 'doc_1',
      folderId: 'folder_1',
      filename: 'source.md',
      content: 'Grounded source text',
      contentHash,
      sourceRevision: `sha256:${contentHash}`,
    }])
  })
})
