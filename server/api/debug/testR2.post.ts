import { fetchFolderDocs } from '../../utils/r2-folder'
import { getConvexTokenIdentifier } from '../../utils/convex-identity'
import { readConfiguredRuntimeValue } from '../../utils/runtime-config'

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_R2_DEBUG_ROUTE !== 'true') {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const userId = getConvexTokenIdentifier(event)
  const body = await readBody<{ folderId?: unknown }>(event)
  const hasUnsafeFolderIdCharacter = typeof body?.folderId === 'string'
    && Array.from(body.folderId).some(character => (
      character === '/'
      || character === '\\'
      || character.charCodeAt(0) <= 0x1f
    ))
  if (typeof body?.folderId !== 'string'
    || body.folderId.length === 0
    || body.folderId.length > 128
    || hasUnsafeFolderIdCharacter) {
    throw createError({ statusCode: 400, message: 'A valid folderId is required' })
  }

  const config = useRuntimeConfig()
  const r2Endpoint = readConfiguredRuntimeValue(config.r2Endpoint, 'NUXT_R2_ENDPOINT', 'R2_ENDPOINT')
  const r2AccessKeyId = readConfiguredRuntimeValue(config.r2AccessKeyId, 'NUXT_R2_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID')
  const r2SecretAccessKey = readConfiguredRuntimeValue(config.r2SecretAccessKey, 'NUXT_R2_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY')
  const r2BucketName = readConfiguredRuntimeValue(config.r2BucketName, 'NUXT_R2_BUCKET_NAME', 'R2_BUCKET_NAME')

  const configStatus = {
    r2Endpoint: !!r2Endpoint,
    r2AccessKeyId: !!r2AccessKeyId,
    r2SecretAccessKey: !!r2SecretAccessKey,
    r2BucketName: !!r2BucketName,
    userId: userId.slice(0, 40) + '…',
  }

  try {
    const docs = await fetchFolderDocs({
      userId,
      folderId: body.folderId,
      maxChars: 80_000,
    })
    return { configStatus, success: true, count: docs.length, docs: docs.map(d => d.key) }
  }
  catch {
    throw createError({ statusCode: 502, message: 'R2 diagnostic failed' })
  }
})
