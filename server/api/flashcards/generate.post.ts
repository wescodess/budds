import { getErrorMessage, getErrorStatusCode } from '../../../shared/errors'
import { ConvexHttpClient } from 'convex/browser'
import type { H3Event } from 'h3'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { AISearchChunk } from '../../utils/ai-search'
import { readConfiguredRuntimeValue } from '../../utils/runtime-config'
import { requireRateLimit } from '../../utils/rate-limit'

const SEED_QUERY = 'key terms, definitions, facts to memorize'

function makeConvexClient(event: H3Event): ConvexHttpClient | null {
  const token = event.context.convexToken as string | undefined
  const runtimeConfig = useRuntimeConfig(event)
  const convexUrl = readConfiguredRuntimeValue(
    runtimeConfig.public?.convex?.url,
    'NUXT_PUBLIC_CONVEX_URL',
    'CONVEX_URL',
  )
  if (!token || !convexUrl) return null
  const client = new ConvexHttpClient(convexUrl)
  client.setAuth(token)
  return client
}

export default defineEventHandler(async (event) => {
  await requireRateLimit(event, 5, 'flashcards.generate')
  const userId = getConvexTokenIdentifier(event)

  const body = await readBody<{
    folderId: string
    model?: string
    cardCount?: number
    taskId?: string
    roomId?: string
  }>(event)

  if (!body?.folderId?.trim()) {
    throw createError({ statusCode: 400, message: 'folderId is required' })
  }

  const taskId = body.taskId as Id<'tasks'> | undefined
  const roomId = body.roomId as Id<'flashcardRooms'> | undefined
  const convexClient = taskId ? makeConvexClient(event) : null

  async function setTaskProgress(progress: string) {
    if (!taskId || !convexClient) return
    try {
      await convexClient.mutation(api.tasks.setProgress, { taskId, progress })
    } catch { /* best-effort */ }
  }

  async function failTask(error: string) {
    if (!taskId || !convexClient) return
    try {
      await convexClient.mutation(api.tasks.markFailed, { taskId, error })
    } catch { /* best-effort */ }
  }

  try {
    if (taskId) await setTaskProgress('Searching documents…')

    const requestedModel = body.model?.trim() || SERVER_DEFAULT_MODEL
    const model = isAllowedModel(requestedModel) ? requestedModel : SERVER_DEFAULT_MODEL
    const cardCount = Math.min(Math.max(body.cardCount ?? 12, 6), 16)

    let searchUnavailable = false
    const searchOrEmpty = async (params: Parameters<typeof searchDocuments>[0]) => {
      try {
        const result = await searchDocuments(params)
        searchUnavailable = false
        return result
      }
      catch (error: unknown) {
        const candidate = error as { statusCode?: number, message?: string }
        if (candidate.statusCode !== 503 || candidate.message !== 'Search index unavailable') throw error
        searchUnavailable = true
        return { data: [] }
      }
    }

    const searchResults = await searchOrEmpty({
      query: SEED_QUERY,
      userId,
      folderId: body.folderId,
      max_num_results: 50,
      score_threshold: 0.05,
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
        console.error('[flashcards/generate] Failed to fetch folder docs fallback:', error)
      }
    }

    if (chunks.length < 2) {
      const deepSearch = await searchOrEmpty({
        query: SEED_QUERY,
        userId,
        folderId: body.folderId,
        max_num_results: 40,
        score_threshold: 0.05,
      })
      if ((deepSearch.data?.length ?? 0) > chunks.length) {
        chunks = deepSearch.data
      }
    }

    if (chunks.length === 0) {
      if (searchUnavailable) {
        const msg = 'Search index unavailable'
        await failTask(msg)
        throw createError({ statusCode: 503, message: msg })
      }
      await assertSearchIndexAvailable()
      const msg = 'Not enough indexed content to generate flash cards'
      await failTask(msg)
      throw createError({ statusCode: 422, message: msg })
    }

    if (taskId) await setTaskProgress('Generating cards…')

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
      const msg = 'Flash card generation produced no valid cards'
      await failTask(msg)
      throw createError({ statusCode: 502, message: msg })
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

    if (taskId && roomId && convexClient) {
      await setTaskProgress('Archiving previous deck…')

      const payloadCards = persistCards.map((c) => ({
        term: c.front,
        definition: c.back,
        metadata: {
          source: {
            documentId: c.sourceDocumentId,
            filename: c.sourceFilename,
            chunkContent: c.sourceChunkContent,
          },
        },
      }))

      const generateResult = await convexClient.mutation(api.flashcardRooms.generateRoomCards, {
        roomId,
        origin: 'ai' as const,
        requestedCardCount: cardCount,
        model,
        title: parsed.title,
        cards: payloadCards,
      })

      await convexClient.mutation(api.tasks.markComplete, {
        taskId,
        result: {
          roomId,
          versionId: generateResult.versionId,
          cardCount: generateResult.cardCount,
        },
      })

      return {
        title: parsed.title,
        model,
        cards: persistCards,
        cardCount: persistCards.length,
        taskId,
        roomId,
        versionId: generateResult.versionId,
      }
    }

    return {
      title: parsed.title,
      model,
      cards: persistCards,
      cardCount: persistCards.length,
    }
  }
  catch (err) {
    const statusCode = getErrorStatusCode(err)
    if (taskId && statusCode !== 422 && statusCode !== 502) {
      await failTask(getErrorMessage(err, 'Generation failed'))
    }
    throw err
  }
})
