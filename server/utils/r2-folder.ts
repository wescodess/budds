import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'
import { sanitizeUserSegment } from './ai-search'
import { readConfiguredRuntimeValue } from './runtime-config'

export interface FolderDoc {
  key: string
  documentId: string
  filename?: string
  content: string
}

export interface FetchFolderDocsParams {
  userId: string
  folderId: string
  maxChars?: number
}

function getR2Client() {
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
  if (!r2Endpoint || !r2AccessKeyId || !r2SecretAccessKey) return null
  return new S3Client({
    region: 'auto',
    endpoint: r2Endpoint,
    credentials: { accessKeyId: r2AccessKeyId, secretAccessKey: r2SecretAccessKey },
  })
}

export async function fetchFolderDocs(params: FetchFolderDocsParams): Promise<FolderDoc[]> {
  const config = useRuntimeConfig()
  const r2BucketName = readConfiguredRuntimeValue(config.r2BucketName, 'NUXT_R2_BUCKET_NAME', 'R2_BUCKET_NAME')
  if (!r2BucketName) return []
  const client = getR2Client()
  if (!client) return []

  const prefix = `${sanitizeUserSegment(params.userId)}/${params.folderId}/`
  const list = await client.send(new ListObjectsV2Command({
    Bucket: r2BucketName,
    Prefix: prefix,
    MaxKeys: 50,
  }))

  const objects = (list.Contents ?? []).filter(o => o.Key?.endsWith('.txt'))
  const budget = params.maxChars ?? 80_000

  const docs: FolderDoc[] = []
  let spent = 0

  for (const obj of objects) {
    if (!obj.Key || spent >= budget) break
    const head = await client.send(new GetObjectCommand({ Bucket: r2BucketName, Key: obj.Key }))
    const fullContent = await head.Body?.transformToString()
    if (!fullContent) continue

    const remaining = budget - spent
    const content = fullContent.length > remaining ? fullContent.slice(0, remaining) : fullContent
    spent += content.length

    const parts = obj.Key.split('/')
    const documentId = (parts[parts.length - 1] ?? '').replace(/\.txt$/, '')
    const filename = head.Metadata?.filename

    docs.push({ key: obj.Key, documentId, filename, content })
  }

  return docs
}
