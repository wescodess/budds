import { fetchFolderDocs } from '../../utils/r2-folder'
import { readConfiguredRuntimeValue } from '../../utils/runtime-config'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  let userId = body.userId ?? ''
  if (!userId) {
    try { userId = getConvexTokenIdentifier(event) } catch {}
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

  if (!userId || !body.folderId) {
    return { configStatus, error: 'Missing userId or folderId' }
  }

  try {
    const docs = await fetchFolderDocs({
      userId,
      folderId: body.folderId,
      maxChars: 80_000,
    })
    return { configStatus, success: true, count: docs.length, docs: docs.map(d => d.key) }
  }
  catch (error: any) {
    return { configStatus, success: false, error: error.message }
  }
})
