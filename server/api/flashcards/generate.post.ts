import type { AISearchChunk } from '../../utils/ai-search'

const SEED_QUERY = 'key terms, definitions, facts to memorize'

export default defineEventHandler(async (event) => {
  const userId = getConvexTokenIdentifier(event)

  const body = await readBody<{
    folderId: string
    model?: string
    cardCount?: number
  }>(event)

  if (!body?.folderId?.trim()) {
    throw createError({ statusCode: 400, message: 'folderId is required' })
  }

  const requestedModel = body.model?.trim() || SERVER_DEFAULT_MODEL
  const model = isAllowedModel(requestedModel) ? requestedModel : SERVER_DEFAULT_MODEL

  const cardCount = Math.min(Math.max(body.cardCount ?? 12, 6), 16)

  const searchResults = await searchDocuments({
    query: SEED_QUERY,
    userId,
    folderId: body.folderId,
    max_num_results: 16,
    score_threshold: 0.1,
  })

  let chunks: AISearchChunk[] = searchResults.data ?? []

  if (chunks.length < 2) {
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

  if (chunks.length === 0) {
    throw createError({
      statusCode: 422,
      message: 'Not enough indexed content to generate flash cards',
    })
  }

  const messages = buildFlashcardPrompt(chunks, { cardCount })

  const completion = await generateCompletion({
    model,
    messages,
    temperature: 0.3,
    max_tokens: 3000,
  })

  const raw = completion.choices[0]?.message?.content ?? ''
  const parsed = parseFlashcardResponse(raw)

  if (parsed.cards.length === 0) {
    throw createError({
      statusCode: 502,
      message: 'Flash card generation produced no valid cards',
    })
  }

  const persistCards = parsed.cards.map((c, index) => {
    const chunk = chunks[c.sourceIndex] ?? chunks[index] ?? chunks[0]!
    const attrs = (chunk.attributes ?? {}) as { filename?: string; documentId?: string }
    return {
      order: index,
      front: c.front,
      back: c.back,
      sourceDocumentId: attrs.documentId,
      sourceChunkContent: chunk.content,
      sourceFilename: attrs.filename ?? 'Unknown source',
    }
  })

  return {
    title: parsed.title,
    model,
    cards: persistCards,
    cardCount: persistCards.length,
  }
})
