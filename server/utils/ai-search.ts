export interface AISearchChunk {
  id: string
  content: string
  score: number
  attributes: Record<string, unknown>
}

export interface AISearchResponse {
  data: AISearchChunk[]
  search_query?: string
  has_more?: boolean
  next_page?: string
  [key: string]: unknown
}

export interface AISearchParams {
  query: string
  max_num_results?: number
  score_threshold?: number
  reranking?: boolean
  filters?: Record<string, unknown>
}

export async function searchDocuments(params: AISearchParams): Promise<AISearchResponse> {
  const config = useRuntimeConfig()
  const { cloudflareAccountId, cloudflareAiSearchInstance, cloudflareAiSearchToken } = config

  if (!cloudflareAccountId || !cloudflareAiSearchInstance || !cloudflareAiSearchToken) {
    throw createError({ statusCode: 500, message: 'Missing Cloudflare AI Search configuration. Check CF_ACCOUNT_ID, CLOUDFLARE_AI_SEARCH_INSTANCE, and CLOUDFLARE_AI_SEARCH_TOKEN env vars.' })
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/ai-search/instances/${cloudflareAiSearchInstance}/search`

  const body: Record<string, unknown> = {
    messages: [{ role: 'user', content: params.query }],
  }

  const searchOptions: Record<string, unknown> = {}
  if (params.max_num_results) searchOptions.max_num_results = params.max_num_results
  if (params.score_threshold) searchOptions.score_threshold = params.score_threshold
  if (params.reranking !== undefined) searchOptions.reranking = { enabled: params.reranking }
  if (params.filters) searchOptions.filters = params.filters

  if (Object.keys(searchOptions).length > 0) {
    body.ai_search_options = searchOptions
  }

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

  return response.json()
}
