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
  filterDocIds?: string[]
}

export function sanitizeUserSegment(userId: string): string {
  return userId.replace(/^https?:\/\//, '').replace(/[|:]/g, '_')
}

interface LegacyChunkContent {
  id: string
  type?: string
  text: string
  score: number
}

interface LegacyResult {
  file_id: string
  filename: string
  score: number
  content: LegacyChunkContent[]
  attributes: {
    timestamp?: number
    folder?: string
    filename?: string
    file?: {
      userid?: string
      folderid?: string
      documentid?: string
      filename?: string
    }
  }
}

const AI_SEARCH_FILTERABLE_STRING_BYTES = 64
const SEARCH_INDEX_UNAVAILABLE = 'Search index unavailable'

function filterableStringPrefix(value: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(value).byteLength <= AI_SEARCH_FILTERABLE_STRING_BYTES) return value

  let prefix = ''
  let byteLength = 0
  for (const character of value) {
    const characterBytes = encoder.encode(character).byteLength
    if (byteLength + characterBytes > AI_SEARCH_FILTERABLE_STRING_BYTES) break
    prefix += character
    byteLength += characterBytes
  }
  return prefix
}

function buildFilters(params: AISearchParams): Record<string, unknown> | undefined {
  const filters: Record<string, unknown>[] = [
    { type: 'eq', key: 'userid', value: filterableStringPrefix(params.userId) },
  ]

  if (params.folderId) {
    filters.push({ type: 'eq', key: 'folderid', value: params.folderId })
  }

  if (params.filterDocIds?.length === 1) {
    filters.push({ type: 'eq', key: 'documentid', value: params.filterDocIds[0] })
  }

  if (filters.length === 0) return undefined
  if (filters.length === 1) return filters[0]
  return { type: 'and', filters }
}

export async function assertSearchIndexAvailable(): Promise<void> {
  try {
    const config = useRuntimeConfig()
    const accountId = readConfiguredRuntimeValue(
      config.cloudflareAccountId,
      'NUXT_CLOUDFLARE_ACCOUNT_ID',
      'CF_ACCOUNT_ID',
    )
    const instance = readConfiguredRuntimeValue(
      config.cloudflareAiSearchInstance,
      'NUXT_CLOUDFLARE_AI_SEARCH_INSTANCE',
      'CLOUDFLARE_AI_SEARCH_INSTANCE',
    )
    const token = readConfiguredRuntimeValue(
      config.cloudflareAiSearchToken,
      'NUXT_CLOUDFLARE_AI_SEARCH_TOKEN',
      'CLOUDFLARE_AI_SEARCH_TOKEN',
    )
    if (!accountId || !instance || !token) throw new Error('Missing AI Search configuration')

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai-search/instances/${instance}/stats`,
      { headers: { 'Authorization': `Bearer ${token}` } },
    )
    if (!response.ok) throw new Error(`AI Search stats returned ${response.status}`)

    const json = await response.json() as {
      success?: boolean
      result?: { engine?: { vectorize?: { vectorsCount?: number } } }
    }
    const vectorsCount = json.result?.engine?.vectorize?.vectorsCount
    if (
      json.success !== true
      || typeof vectorsCount !== 'number'
      || !Number.isFinite(vectorsCount)
      || vectorsCount <= 0
    ) {
      throw new Error('AI Search has no available vectors')
    }
  }
  catch {
    throw createError({ statusCode: 503, message: SEARCH_INDEX_UNAVAILABLE })
  }
}

export async function searchDocuments(params: AISearchParams): Promise<AISearchResponse> {
  if (params.filterDocIds && params.filterDocIds.length === 0) return { data: [] }

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
      statusCode: 503,
      message: SEARCH_INDEX_UNAVAILABLE,
    })
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/autorag/rags/${cloudflareAiSearchInstance}/search`

  const body: Record<string, unknown> = {
    query: params.query,
    max_num_results: params.max_num_results ?? 20,
    score_threshold: params.score_threshold ?? 0.05,
  }

  const filters = buildFilters(params)
  if (filters) body.filters = filters

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cloudflareAiSearchToken}`,
      },
      body: JSON.stringify(body),
    })
  }
  catch {
    throw createError({ statusCode: 503, message: SEARCH_INDEX_UNAVAILABLE })
  }

  if (!response.ok) {
    throw createError({ statusCode: 503, message: SEARCH_INDEX_UNAVAILABLE })
  }

  let json: {
    success?: boolean
    result?: {
      search_query?: string
      data?: unknown
    }
  }
  try {
    json = await response.json() as typeof json
  }
  catch {
    throw createError({ statusCode: 503, message: SEARCH_INDEX_UNAVAILABLE })
  }

  if (json.success !== true || !json.result || !Array.isArray(json.result.data)) {
    throw createError({ statusCode: 503, message: SEARCH_INDEX_UNAVAILABLE })
  }

  const results = json.result.data as LegacyResult[]
  const validResults = results.every(result =>
    !!result
    && typeof result === 'object'
    && Array.isArray(result.content)
    && result.content.every(chunk =>
      !!chunk
      && typeof chunk === 'object'
      && typeof chunk.id === 'string'
      && typeof chunk.text === 'string'
      && typeof chunk.score === 'number',
    ),
  )
  if (!validResults) {
    throw createError({ statusCode: 503, message: SEARCH_INDEX_UNAVAILABLE })
  }

  const chunks: AISearchChunk[] = []
  for (const r of results) {
    const file = r.attributes?.file ?? {}
    const userId = file.userid
    const folderId = file.folderid
    const documentId = file.documentid
    const filename = file.filename ?? r.attributes?.filename

    for (const c of r.content ?? []) {
      chunks.push({
        id: c.id,
        content: c.text ?? '',
        score: c.score,
        attributes: {
          filename,
          folderId,
          documentId,
          userId,
          folder: r.filename,
        },
      })
    }
  }

  const docIdAllowlist = params.filterDocIds?.length
    ? new Set(params.filterDocIds)
    : null

  const filtered = chunks.filter((chunk) => {
    if (chunk.attributes.userId !== params.userId) return false
    if (params.folderId && chunk.attributes.folderId !== params.folderId) return false
    if (!docIdAllowlist) return true
    return !!chunk.attributes.documentId && docIdAllowlist.has(chunk.attributes.documentId)
  })

  console.log(`[ai-search] q=${JSON.stringify(params.query)} folder=${params.folderId ?? '-'} results=${results.length} chunks=${filtered.length}`)

  return { data: filtered, search_query: json.result.search_query }
}
