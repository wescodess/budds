export type ArtifactCleanupBucket = Pick<R2Bucket, 'list' | 'delete'>

export function jobArtifactPrefix(jobId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(jobId)) throw new Error('Invalid audio overview job id')
  return `audio-overviews/jobs/${jobId}/`
}

export async function deleteAllJobArtifacts(
  bucket: ArtifactCleanupBucket,
  jobId: string,
): Promise<number> {
  const prefix = jobArtifactPrefix(jobId)
  let cursor: string | undefined
  let deleted = 0
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1_000 })
    const keys = page.objects.map(object => object.key)
    if (keys.some(key => !key.startsWith(prefix))) {
      throw new Error('R2 returned an object outside the audio overview job prefix')
    }
    if (keys.length > 0) {
      await bucket.delete(keys)
      deleted += keys.length
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return deleted
}
