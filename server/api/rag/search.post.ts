export default defineEventHandler(async (event) => {
  const userId = getConvexTokenIdentifier(event)

  const body = await readBody<{
    query: string
    folderId?: string
    max_num_results?: number
    score_threshold?: number
  }>(event)

  if (!body.query?.trim()) {
    throw createError({ statusCode: 400, message: 'query is required' })
  }

  return await searchDocuments({
    query: body.query,
    userId,
    folderId: body.folderId,
    max_num_results: body.max_num_results,
    score_threshold: body.score_threshold,
  })
})
