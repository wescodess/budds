import { readConfiguredRuntimeValue } from './runtime-config'

export interface AISearchChunk {
  id: string
  content: string
  score: number
  attributes: {
    filename?: string
    folderId?: string
    documentId?: string
    userId?: string
    folder?: string
  }
}

export interface AISearchResponse {
  data: AISearchChunk[]
  search_query?: string
}

export interface AISearchParams {
  query: string
  userId: string
  folderId?: string
  max_num_results?: number
  score_threshold?: number
  reranking?: boolean
}

export function sanitizeUserSegment(userId: string): string {
  return userId.replace(/^https?:\/\//, '').replace(/[|:]/g, '_')
}

interface RawChunkMetadata {
  userid?: string
  folderid?: string
  documentid?: string
  filename?: string
  [k: string]: unknown
}

interface RawChunk {
  id: string
  type?: string
  score: number
  text: string
  content?: string
  item?: { key?: string; timestamp?: number; metadata?: RawChunkMetadata }
  attributes?: Record<string, unknown>
}

export async function searchDocuments(params: AISearchParams): Promise<AISearchResponse> {
  const config = useRuntimeConfig()
  const cloudflareAccountId = readConfiguredRuntimeValue(
    config.cloudflareAccountId,
    'NUXT_CLOUDFLARE_ACCOUNT_ID',
    'CF_ACCOUNT_ID',
  )
  const cloudflareAiSearchInstance = readConfiguredRuntimeValue(
    config.cloudflareAiSearchInstance,
    'NUXT_CLOUDFLARE_AI_SEARCH_INSTANCE',
    'CLOUDFLARE_AI_SEARCH_INSTANCE',
  )
  const cloudflareAiSearchToken = readConfiguredRuntimeValue(
    config.cloudflareAiSearchToken,
    'NUXT_CLOUDFLARE_AI_SEARCH_TOKEN',
    'CLOUDFLARE_AI_SEARCH_TOKEN',
  )

  if (!params.userId) {
    throw createError({ statusCode: 500, message: 'userId is required for AI Search queries' })
  }

  if (!cloudflareAccountId || !cloudflareAiSearchInstance || !cloudflareAiSearchToken) {
    throw createError({
      statusCode: 500,
      message: 'Missing Cloudflare AI Search configuration. Check NUXT_CLOUDFLARE_ACCOUNT_ID/CF_ACCOUNT_ID, NUXT_CLOUDFLARE_AI_SEARCH_INSTANCE/CLOUDFLARE_AI_SEARCH_INSTANCE, and NUXT_CLOUDFLARE_AI_SEARCH_TOKEN/CLOUDFLARE_AI_SEARCH_TOKEN.',
    })
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/ai-search/instances/${cloudflareAiSearchInstance}/search`

  const searchOptions: Record<string, unknown> = {}
  if (params.max_num_results !== undefined) searchOptions.max_num_results = params.max_num_results
  if (params.score_threshold !== undefined) searchOptions.score_threshold = params.score_threshold
  if (params.reranking !== undefined) searchOptions.reranking = { enabled: params.reranking }

  const body: Record<string, unknown> = {
    messages: [{ role: 'user', content: params.query }],
  }
  if (Object.keys(searchOptions).length > 0) body.ai_search_options = searchOptions

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cloudflareAiSearchToken}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw createError({ statusCode: response.status, message: `AI Search error: ${error}` })
  }

  const json = await response.json() as {
    success?: boolean
    result?: { search_query?: string; chunks?: RawChunk[] }
    data?: RawChunk[]
  }


  const raw = json.result?.chunks ?? json.data ?? []

  const mapped: AISearchChunk[] = raw.map((c): AISearchChunk => {
    const meta = c.item?.metadata ?? {}
    return {
      id: c.id,
      content: c.text ?? c.content ?? '',
      score: c.score,
      attributes: {
        filename: meta.filename,
        folderId: meta.folderid,
        documentId: meta.documentid,
        userId: meta.userid,
        folder: c.item?.key,
      },
    }
  })

  const chunks = mapped.filter((c) => {
    if (c.attributes.userId !== params.userId) return false
    if (params.folderId && c.attributes.folderId !== params.folderId) return false
    return true
  })

  console.log(`[ai-search] q=${JSON.stringify(params.query)} folder=${params.folderId ?? '-'} raw=${mapped.length} kept=${chunks.length}`)

  return { data: chunks, search_query: json.result?.search_query }
}
