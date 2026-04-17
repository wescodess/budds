import type { AISearchChunk } from '../../utils/ai-search'

const SEED_QUERY = 'key concepts, definitions, and facts'

export default defineEventHandler(async (event) => {
  const userId = getConvexTokenIdentifier(event)

  const body = await readBody<{
    folderId: string
    model?: string
    questionCount?: number
  }>(event)

  if (!body?.folderId?.trim()) {
    throw createError({ statusCode: 400, message: 'folderId is required' })
  }

  const requestedModel = body.model?.trim() || SERVER_DEFAULT_MODEL
  const model = isAllowedModel(requestedModel) ? requestedModel : SERVER_DEFAULT_MODEL

  const questionCount = Math.min(Math.max(body.questionCount ?? 8, 3), 8)

  const searchResults = await searchDocuments({
    query: SEED_QUERY,
    userId,
    folderId: body.folderId,
    max_num_results: 12,
    score_threshold: 0.1,
  })

  let chunks: AISearchChunk[] = searchResults.data ?? []

  if (chunks.length < 2) {
    try {
      const folderDocs = await fetchFolderDocs({ userId, folderId: body.folderId, maxChars: 80_000 })
      if (folderDocs.length > 0) {
        chunks = folderDocs.map((doc): AISearchChunk => ({
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
      console.error('[quiz/generate] Failed to fetch folder docs fallback:', error)
    }
  }

  if (chunks.length === 0) {
    throw createError({
      statusCode: 422,
      message: 'Not enough indexed content to generate a quiz',
    })
  }

  const messages = buildQuizPrompt(chunks, { questionCount })

  const completion = await generateCompletion({
    model,
    messages,
    temperature: 0.3,
    max_tokens: 3000,
  })

  const raw = completion.choices[0]?.message?.content ?? ''
  const parsed = parseQuizResponse(raw)

  if (parsed.questions.length === 0) {
    throw createError({
      statusCode: 502,
      message: 'Quiz generation produced no valid questions',
    })
  }

  const persistQuestions = parsed.questions.map((q, index) => {
    const chunk = chunks[q.sourceIndex] ?? chunks[index] ?? chunks[0]!
    const attrs = (chunk.attributes ?? {}) as { filename?: string; documentId?: string }
    return {
      order: index,
      question: q.question,
      type: q.type,
      options: q.options,
      correctAnswer: q.correctAnswer,
      sourceDocumentId: attrs.documentId,
      sourceChunkContent: chunk.content,
      sourceFilename: attrs.filename ?? 'Unknown source',
    }
  })

  return {
    title: parsed.title,
    model,
    questions: persistQuestions,
    questionCount: persistQuestions.length,
  }
})
