import { describe, expect, test, vi } from 'vitest'
import {
  deleteAllJobArtifacts,
  jobArtifactPrefix,
  type ArtifactCleanupBucket,
} from './artifact-cleanup'

describe('terminal job artifact cleanup', () => {
  test('deletes every page under the exact deterministic job prefix', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({
        objects: [{ key: 'audio-overviews/jobs/job_1/scenes/0/attempts/1.pcm' }],
        truncated: true,
        cursor: 'next',
      })
      .mockResolvedValueOnce({
        objects: [{ key: 'audio-overviews/jobs/job_1/overview.wav' }],
        truncated: false,
      })
    const deleteObjects = vi.fn().mockResolvedValue(undefined)

    await expect(deleteAllJobArtifacts(
      { list, delete: deleteObjects } as unknown as ArtifactCleanupBucket,
      'job_1',
    ))
      .resolves.toBe(2)
    expect(list).toHaveBeenNthCalledWith(1, {
      prefix: 'audio-overviews/jobs/job_1/',
      cursor: undefined,
      limit: 1_000,
    })
    expect(list).toHaveBeenNthCalledWith(2, {
      prefix: 'audio-overviews/jobs/job_1/',
      cursor: 'next',
      limit: 1_000,
    })
    expect(deleteObjects).toHaveBeenNthCalledWith(1, [
      'audio-overviews/jobs/job_1/scenes/0/attempts/1.pcm',
    ])
    expect(deleteObjects).toHaveBeenNthCalledWith(2, [
      'audio-overviews/jobs/job_1/overview.wav',
    ])
  })

  test('rejects a broad or malformed cleanup target', () => {
    expect(() => jobArtifactPrefix('')).toThrow(/invalid/i)
    expect(() => jobArtifactPrefix('../other')).toThrow(/invalid/i)
  })

  test('fails closed if a bucket page escapes the requested prefix', async () => {
    const bucket = {
      list: vi.fn().mockResolvedValue({
        objects: [{ key: 'documents/private.pdf' }],
        truncated: false,
      }),
      delete: vi.fn(),
    }
    await expect(deleteAllJobArtifacts(
      bucket as unknown as ArtifactCleanupBucket,
      'job_1',
    )).rejects.toThrow(/outside/i)
    expect(bucket.delete).not.toHaveBeenCalled()
  })
})
