import { describe, expect, test } from 'vitest'
import {
  createSourceObjectMetadata,
  readSourceIdentityMetadata,
} from '../../shared/source-identity'

describe('source identity metadata contract', () => {
  test('round-trips the upload producer fields through lower-cased R2 and AI Search metadata', () => {
    const hash = 'a'.repeat(64)
    const produced = createSourceObjectMetadata({
      userId: 'owner',
      folderId: 'folder-1',
      documentId: 'document-1',
      filename: 'Lecture.pdf',
      contentHash: hash,
      sourceRevision: `sha256:${hash}`,
    })
    const providerMetadata = Object.fromEntries(
      Object.entries(produced).map(([key, value]) => [key.toLowerCase(), value]),
    )

    expect(readSourceIdentityMetadata(providerMetadata)).toEqual({
      contentHash: hash,
      sourceRevision: `sha256:${hash}`,
    })
  })

  test('rejects a mismatched revision instead of manufacturing a same-revision mapping', () => {
    expect(() => createSourceObjectMetadata({
      userId: 'owner',
      folderId: 'folder-1',
      documentId: 'document-1',
      filename: 'Lecture.pdf',
      contentHash: 'a'.repeat(64),
      sourceRevision: `sha256:${'b'.repeat(64)}`,
    })).toThrow(/source identity/i)
  })
})
