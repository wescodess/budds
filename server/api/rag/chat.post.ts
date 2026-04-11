const SYSTEM_PROMPT = `You are a helpful assistant that answers questions based on the provided context.
Use the context below to answer the user's question accurately.
If the context doesn't contain enough information to answer, say so clearly.
Always cite which source documents your answer is based on when possible.`

export default defineEventHandler(async (event) => {
  await requireUserSession(event)

  const body = await readBody<{
    query: string
    model: string
    history?: ChatMessage[]
    max_num_results?: number
    score_threshold?: number
    filters?: Record<string, unknown>
    temperature?: number
    max_tokens?: number
    stream?: boolean
  }>(event)

  if (!body.query?.trim()) {
    throw createError({ statusCode: 400, message: 'query is required' })
  }

  if (!body.model?.trim()) {
    throw createError({ statusCode: 400, message: 'model is required' })
  }

  const searchResults = await searchDocuments({
    query: body.query,
    max_num_results: body.max_num_results ?? 10,
    score_threshold: body.score_threshold,
    filters: body.filters,
  })

  const chunks = searchResults.data ?? []

  const context = chunks
    .map((chunk, i) => {
      const source = chunk.attributes?.filename || chunk.attributes?.url || `Source ${i + 1}`
      return `[${source}]\n${chunk.content}`
    })
    .join('\n\n---\n\n')

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ]

  if (context) {
    messages.push({
      role: 'user',
      content: `Context:\n${context}`,
    })
    messages.push({
      role: 'assistant',
      content: 'I\'ve reviewed the provided context. How can I help you?',
    })
  }

  if (body.history?.length) {
    messages.push(...body.history)
  }

  messages.push({ role: 'user', content: body.query })

  if (body.stream) {
    const stream = await generateCompletionStream({
      model: body.model,
      messages,
      temperature: body.temperature,
      max_tokens: body.max_tokens,
      stream: true,
    })

    setResponseHeader(event, 'Content-Type', 'text/event-stream')
    setResponseHeader(event, 'Cache-Control', 'no-cache')
    setResponseHeader(event, 'Connection', 'keep-alive')

    return sendStream(event, stream)
  }

  const completion = await generateCompletion({
    model: body.model,
    messages,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
  })

  return {
    answer: completion.choices[0]?.message?.content ?? '',
    model: completion.model,
    usage: completion.usage,
    sources: chunks.map((chunk) => ({
      content: chunk.content,
      score: chunk.score,
      attributes: chunk.attributes,
    })),
  }
})
