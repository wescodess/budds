const TOPIC_EXTRACTION_QUERY = 'main topics, themes, and key concepts'

export default defineEventHandler(async (event) => {
  const userId = getConvexTokenIdentifier(event)

  const body = await readBody<{
    folderId: string
    resourceIds?: string[]
  }>(event)

  if (!body?.folderId?.trim()) {
    throw createError({ statusCode: 400, message: 'folderId is required' })
  }

  const searchResults = await searchDocuments({
    query: TOPIC_EXTRACTION_QUERY,
    userId,
    folderId: body.folderId,
    max_num_results: 10,
    score_threshold: 0.1,
  })

  let chunks = searchResults.data ?? []

  if (chunks.length < 2) {
    try {
      const folderDocs = await fetchFolderDocs({ userId, folderId: body.folderId, maxChars: 40_000 })
      if (folderDocs.length > 0) {
        chunks = folderDocs.map((doc) => ({
          id: doc.key,
          content: doc.content,
          score: 1,
          attributes: {
            filename: doc.filename,
            folderId: body.folderId,
            documentId: doc.documentId,
            userId,
          },
        }))
      }
    }
    catch (error) {
      console.error('[quiz/topics] Failed to fetch folder docs fallback:', error)
    }
  }

  if (chunks.length === 0) {
    return { topics: [] }
  }

  const sourceBlock = chunks
    .map((chunk, i) => {
      const filename = (chunk.attributes?.filename as string | undefined) ?? 'unknown'
      return `[Source ${i}: ${filename}]\n${chunk.content}`
    })
    .join('\n\n---\n\n')

  const messages = [
    {
      role: 'system' as const,
      content: `You are a topic extraction assistant. Given source material, identify the 6-10 most important, distinct topics that would make good quiz subjects.

Return JSON ONLY. No markdown fences. Shape: { "topics": string[] }

Rules:
- Each topic should be 2-5 words, specific enough to generate focused questions.
- Topics should cover different aspects of the material.
- Order by importance/prominence in the source material.
- If the material is too short or unclear, return fewer topics.`,
    },
    {
      role: 'user' as const,
      content: `Source material:\n\n${sourceBlock}\n\nExtract the key topics now.`,
    },
  ]

  const completion = await generateCompletion({
    model: SERVER_DEFAULT_MODEL,
    messages,
    temperature: 0.2,
    max_tokens: 500,
  })

  const raw = completion.choices[0]?.message?.content ?? ''

  try {
    const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const cleaned = stripped.replace(/,(\s*[}\]])/g, '$1')
    const parsed = JSON.parse(cleaned) as { topics?: string[] }
    const topics = Array.isArray(parsed.topics)
      ? parsed.topics.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, 10)
      : []
    return { topics }
  }
  catch {
    return { topics: [] }
  }
})
