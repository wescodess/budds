import type { ChatMessage } from '../../utils/ai-gateway'

const SYSTEM_PROMPT = `You are a helpful assistant that answers questions based on the provided context.
Use the context below to answer the user's question accurately.
If the context doesn't contain enough information to answer, say so clearly.
When citing sources, use inline numbered references like [1], [2], etc. corresponding to the provided source passages. Each number maps to the source passage at that index.`

export default defineEventHandler(async (event) => {
  const userId = getConvexTokenIdentifier(event)

  const body = await readBody<{
    query: string
    model: string
    folderId: string
    history?: ChatMessage[]
    max_num_results?: number
    score_threshold?: number
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

  const requestedModel = body.model
  let modelFallback: { requested: string; actual: string } | undefined
  if (!isAllowedModel(requestedModel)) {
    body.model = SERVER_DEFAULT_MODEL
    modelFallback = { requested: requestedModel, actual: SERVER_DEFAULT_MODEL }
  }

  if (!body.folderId?.trim()) {
    throw createError({ statusCode: 400, message: 'folderId is required' })
  }

  const searchResults = await searchDocuments({
    query: body.query,
    userId,
    folderId: body.folderId,
    max_num_results: body.max_num_results ?? 10,
    score_threshold: body.score_threshold ?? 0.1,
  })

  const chunks = searchResults.data ?? []

  const summarizationIntent = /\b(summari[sz]e|summary|overview|outline|tl;?dr|main points|key points|what(?:'s| is| are) (?:in|this|these|the)\b|tell me about)\b/i.test(body.query)
  const needsFallback = chunks.length < 3 || summarizationIntent

  let context: string
  if (needsFallback) {
    const folderDocs = await fetchFolderDocs({ userId, folderId: body.folderId, maxChars: 80_000 })
    if (folderDocs.length > 0) {
      context = folderDocs
        .map((doc, i) => `[Source ${i + 1}: ${doc.filename ?? doc.documentId}]\n${doc.content}`)
        .join('\n\n---\n\n')
    }
    else {
      context = chunks
        .map((chunk, i) => {
          const label = chunk.attributes?.filename || chunk.attributes?.url || 'unknown'
          return `[Source ${i + 1}: ${label}]\n${chunk.content}`
        })
        .join('\n\n---\n\n')
    }
  }
  else {
    context = chunks
      .map((chunk, i) => {
        const label = chunk.attributes?.filename || chunk.attributes?.url || 'unknown'
        return `[Source ${i + 1}: ${label}]\n${chunk.content}`
      })
      .join('\n\n---\n\n')
  }

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
    const safeHistory = body.history.filter(
      (m): m is ChatMessage => m.role === 'user' || m.role === 'assistant',
    )
    messages.push(...safeHistory)
  }

  messages.push({ role: 'user', content: body.query })

  const completionParams = {
    messages,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
  }

  if (body.stream) {
    let stream: ReadableStream
    try {
      stream = await generateCompletionStream({ model: body.model, ...completionParams, stream: true })
    } catch (err: any) {
      if (body.model !== SERVER_DEFAULT_MODEL) {
        modelFallback = { requested: body.model, actual: SERVER_DEFAULT_MODEL }
        stream = await generateCompletionStream({ model: SERVER_DEFAULT_MODEL, ...completionParams, stream: true })
      } else {
        throw err
      }
    }

    const sources = chunks.map((chunk) => ({
      content: chunk.content,
      score: chunk.score,
      attributes: chunk.attributes,
    }))

    const encoder = new TextEncoder()
    const fallbackEvent = modelFallback
      ? `event: model-fallback\ndata: ${JSON.stringify(modelFallback)}\n\n`
      : ''
    const sourcesEvent = `event: sources\ndata: ${JSON.stringify(sources)}\n\n`

    const transformedStream = new ReadableStream({
      async start(controller) {
        if (fallbackEvent) controller.enqueue(encoder.encode(fallbackEvent))
        controller.enqueue(encoder.encode(sourcesEvent))
        const reader = stream.getReader()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            controller.enqueue(value)
          }
          controller.close()
        } catch (err) {
          controller.error(err)
        }
      },
    })

    setResponseHeader(event, 'Content-Type', 'text/event-stream')
    setResponseHeader(event, 'Cache-Control', 'no-cache')
    setResponseHeader(event, 'Connection', 'keep-alive')

    return sendStream(event, transformedStream)
  }

  let completion: Awaited<ReturnType<typeof generateCompletion>>
  try {
    completion = await generateCompletion({ model: body.model, ...completionParams })
  } catch (err: any) {
    if (body.model !== SERVER_DEFAULT_MODEL) {
      modelFallback = { requested: body.model, actual: SERVER_DEFAULT_MODEL }
      completion = await generateCompletion({ model: SERVER_DEFAULT_MODEL, ...completionParams })
    } else {
      throw err
    }
  }

  return {
    answer: completion.choices[0]?.message?.content ?? '',
    model: completion.model,
    usage: completion.usage,
    sources: chunks.map((chunk) => ({
      content: chunk.content,
      score: chunk.score,
      attributes: chunk.attributes,
    })),
    ...(modelFallback && { modelFallback }),
  }
})
