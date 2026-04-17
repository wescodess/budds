import { AwsClient } from 'aws4fetch'
import { sanitizeUserSegment } from './ai-search'
import { readConfiguredRuntimeValue } from './runtime-config'

export interface FolderDoc {
  key: string
  documentId: string
  folderId?: string
  filename?: string
  content: string
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

async function getObject(r2: NonNullable<ReturnType<typeof getR2Config>>, key: string) {
  const url = `${r2.endpoint}/${r2.bucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}`
  const response = await r2.client.fetch(url)
  if (!response.ok) return null

  const content = await response.text()
  const filename = response.headers.get('x-amz-meta-filename') ?? undefined
  return { content, filename }
}

interface ListEntry { key: string }

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
  const objects = (await listObjects(r2, prefix)).filter(o => o.key.endsWith('.txt'))

  for (const obj of objects) {
    if (spent >= budget) break

    try {
      const result = await getObject(r2, obj.key)
      if (!result?.content) continue

      const remaining = budget - spent
      const content = result.content.length > remaining ? result.content.slice(0, remaining) : result.content
      spent += content.length

      const parts = obj.key.split('/')
      const documentId = (parts[parts.length - 1] ?? '').replace(/\.txt$/, '')

      docs.push({ key: obj.key, documentId, folderId: params.folderId, filename: result.filename, content })
    }
    catch (error) {
      console.error(`[r2-folder] Failed to read object ${obj.key}:`, error)
    }
  }

  return docs
}
