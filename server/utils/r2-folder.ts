import { AwsClient } from 'aws4fetch'
import { sanitizeUserSegment } from './ai-search'
import { readConfiguredRuntimeValue } from './runtime-config'

export interface FolderDoc {
  key: string
  documentId: string
  folderId?: string
  filename?: string
  content: string
  contentHash?: string
  sourceRevision?: string
}

export interface FetchFolderDocsParams {
  userId: string
  folderId?: string
  documents?: Array<{
    documentId: string
    folderId: string
    filename?: string
    r2Key?: string
  }>
  maxChars?: number
}

function getR2Config() {
  const config = useRuntimeConfig()
  const r2Endpoint = readConfiguredRuntimeValue(config.r2Endpoint, 'NUXT_R2_ENDPOINT', 'R2_ENDPOINT')
  const r2AccessKeyId = readConfiguredRuntimeValue(
    config.r2AccessKeyId,
    'NUXT_R2_ACCESS_KEY_ID',
    'R2_ACCESS_KEY_ID',
  )
  const r2SecretAccessKey = readConfiguredRuntimeValue(
    config.r2SecretAccessKey,
    'NUXT_R2_SECRET_ACCESS_KEY',
    'R2_SECRET_ACCESS_KEY',
  )
  const r2BucketName = readConfiguredRuntimeValue(config.r2BucketName, 'NUXT_R2_BUCKET_NAME', 'R2_BUCKET_NAME')

  if (!r2Endpoint || !r2AccessKeyId || !r2SecretAccessKey || !r2BucketName) return null

  const client = new AwsClient({
    accessKeyId: r2AccessKeyId,
    secretAccessKey: r2SecretAccessKey,
    service: 's3',
    region: 'auto',
  })

  return { client, endpoint: r2Endpoint, bucket: r2BucketName }
}

export async function fetchPrivateR2Object(
  key: string,
  init?: { method?: 'GET' | 'HEAD', range?: string },
): Promise<Response> {
  const normalizedKey = key.trim()
  if (!normalizedKey || normalizedKey.startsWith('/') || normalizedKey.split('/').includes('..')) {
    throw createError({ statusCode: 400, message: 'Invalid private R2 object key' })
  }
  const r2 = getR2Config()
  if (!r2) throw createError({ statusCode: 503, message: 'Audio storage unavailable' })
  const url = `${r2.endpoint}/${r2.bucket}/${encodeURIComponent(normalizedKey).replace(/%2F/g, '/')}`
  const headers = new Headers()
  if (init?.range) headers.set('Range', init.range)
  return await r2.client.fetch(url, { method: init?.method ?? 'GET', headers })
}

async function getObject(r2: NonNullable<ReturnType<typeof getR2Config>>, key: string) {
  const url = `${r2.endpoint}/${r2.bucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}`
  const response = await r2.client.fetch(url)
  if (!response.ok) return null

  const content = await response.text()
  const filename = response.headers.get('x-amz-meta-filename') ?? undefined
  const contentHash = (response.headers.get('x-amz-meta-contenthash')
    ?? response.headers.get('x-amz-meta-content-hash')
    ?? '').trim().toLowerCase() || undefined
  const sourceRevision = (response.headers.get('x-amz-meta-sourcerevision')
    ?? response.headers.get('x-amz-meta-source-revision')
    ?? '').trim() || undefined
  return { content, filename, contentHash, sourceRevision }
}

interface ListEntry { key: string }

export interface R2ObjectIdentity {
  key: string
  contentHash: string
  revision: string
  byteLength: number
  etag?: string
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const MAX_SOURCE_IDENTITY_BYTES = 8 * 1024 * 1024

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Resolve an immutable identity for one already-authorized Source Manifest
 * object. New uploads carry their byte hash in R2 metadata. Legacy objects are
 * read once and hashed so an old PDF can enter the v2 pipeline without
 * pretending its object key is a content hash.
 */
export async function getScopedR2ObjectIdentity(key: string): Promise<R2ObjectIdentity> {
  const normalizedKey = key.trim()
  if (!normalizedKey || normalizedKey.startsWith('/') || normalizedKey.split('/').includes('..')) {
    throw createError({ statusCode: 400, message: 'Invalid source object key' })
  }
  const r2 = getR2Config()
  if (!r2) throw createError({ statusCode: 503, message: 'Source storage unavailable' })
  const url = `${r2.endpoint}/${r2.bucket}/${encodeURIComponent(normalizedKey).replace(/%2F/g, '/')}`
  const head = await r2.client.fetch(url, { method: 'HEAD' }).catch(() => null)
  if (!head?.ok) throw createError({ statusCode: 503, message: 'Source storage unavailable' })

  const byteLength = Number(head.headers.get('content-length') ?? 0)
  if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAX_SOURCE_IDENTITY_BYTES) {
    throw createError({ statusCode: 422, message: 'Source is too large or empty for an audio overview' })
  }
  const metadataHash = (head.headers.get('x-amz-meta-contenthash')
    ?? head.headers.get('x-amz-meta-content-hash')
    ?? '').trim().toLowerCase()
  const metadataRevision = (head.headers.get('x-amz-meta-sourcerevision')
    ?? head.headers.get('x-amz-meta-source-revision')
    ?? '').trim()
  const etag = head.headers.get('etag')?.replace(/^W\//, '').replace(/^"|"$/g, '') || undefined
  if (SHA256_PATTERN.test(metadataHash)) {
    return {
      key: normalizedKey,
      contentHash: metadataHash,
      revision: metadataRevision || `sha256:${metadataHash}`,
      byteLength,
      etag,
    }
  }

  const object = await r2.client.fetch(url)
  if (!object.ok) throw createError({ statusCode: 503, message: 'Source storage unavailable' })
  const bytes = new Uint8Array(await object.arrayBuffer())
  if (bytes.byteLength !== byteLength || bytes.byteLength > MAX_SOURCE_IDENTITY_BYTES) {
    throw createError({ statusCode: 409, message: 'Source changed while the audio overview was being prepared' })
  }
  const contentHash = await sha256Hex(bytes)
  return {
    key: normalizedKey,
    contentHash,
    revision: metadataRevision || `sha256:${contentHash}`,
    byteLength,
    etag,
  }
}

async function listObjects(r2: NonNullable<ReturnType<typeof getR2Config>>, prefix: string): Promise<ListEntry[]> {
  const url = `${r2.endpoint}/${r2.bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=50`
  const response = await r2.client.fetch(url)
  if (!response.ok) return []

  const xml = await response.text()
  const entries: ListEntry[] = []
  const keyRegex = /<Key>([^<]+)<\/Key>/g
  let match: RegExpExecArray | null
  while ((match = keyRegex.exec(xml)) !== null) {
    entries.push({ key: match[1]! })
  }
  return entries
}

const TEXT_READABLE_EXTS = new Set(['.txt', '.md', '.csv', '.html', '.json', '.yaml', '.toml'])

function isTextReadableKey(key: string): boolean {
  const dotIdx = key.lastIndexOf('.')
  if (dotIdx === -1) return false
  return TEXT_READABLE_EXTS.has(key.slice(dotIdx))
}

export async function fetchFolderDocs(params: FetchFolderDocsParams): Promise<FolderDoc[]> {
  const r2 = getR2Config()
  if (!r2) return []
  const budget = params.maxChars ?? 80_000

  const docs: FolderDoc[] = []
  let spent = 0

  if (params.documents?.length) {
    for (const doc of params.documents) {
      if (spent >= budget) break

      const key = doc.r2Key
        ?? `${sanitizeUserSegment(params.userId)}/${doc.folderId}/${doc.documentId}.txt`

      if (!isTextReadableKey(key)) continue

      try {
        const result = await getObject(r2, key)
        if (!result?.content) continue

        const remaining = budget - spent
        const content = result.content.length > remaining ? result.content.slice(0, remaining) : result.content
        spent += content.length

        docs.push({
          key,
          documentId: doc.documentId,
          folderId: doc.folderId,
          filename: result.filename ?? doc.filename,
          content,
          contentHash: result.contentHash,
          sourceRevision: result.sourceRevision,
        })
      }
      catch (error) {
        console.error(`[r2-folder] Failed to read scoped doc ${doc.documentId}:`, error)
      }
    }

    return docs
  }

  if (!params.folderId) return []

  const prefix = `${sanitizeUserSegment(params.userId)}/${params.folderId}/`
  const objects = (await listObjects(r2, prefix)).filter(o => isTextReadableKey(o.key))

  for (const obj of objects) {
    if (spent >= budget) break

    try {
      const result = await getObject(r2, obj.key)
      if (!result?.content) continue

      const remaining = budget - spent
      const content = result.content.length > remaining ? result.content.slice(0, remaining) : result.content
      spent += content.length

      const parts = obj.key.split('/')
      const lastPart = parts[parts.length - 1] ?? ''
      const dotIdx = lastPart.lastIndexOf('.')
      const documentId = dotIdx !== -1 ? lastPart.slice(0, dotIdx) : lastPart

      docs.push({
        key: obj.key,
        documentId,
        folderId: params.folderId,
        filename: result.filename,
        content,
        contentHash: result.contentHash,
        sourceRevision: result.sourceRevision,
      })
    }
    catch (error) {
      console.error(`[r2-folder] Failed to read object ${obj.key}:`, error)
    }
  }

  return docs
}
