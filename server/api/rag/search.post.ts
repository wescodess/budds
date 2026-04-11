export default defineEventHandler(async (event) => {
  const userId = getConvexTokenIdentifier(event)

  const body = await readBody<{
    query: string
    max_num_results?: number
    score_threshold?: number
    filters?: Record<string, unknown>
  }>(event)

  if (!body.query?.trim()) {
    throw createError({ statusCode: 400, message: 'query is required' })
  }

  return await searchDocuments({
    query: body.query,
    userId,
    max_num_results: body.max_num_results,
    score_threshold: body.score_threshold,
    filters: body.filters,
  })
})
