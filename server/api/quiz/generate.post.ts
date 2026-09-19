import { getErrorMessage, getErrorStatusCode } from '../../../shared/errors'
import { ConvexHttpClient } from 'convex/browser'
import type { H3Event } from 'h3'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { AISearchChunk } from '../../utils/ai-search'
import { readConfiguredRuntimeValue } from '../../utils/runtime-config'
import { requireRateLimit } from '../../utils/rate-limit'
import { scheduleShadowEvaluateQuiz } from '../../utils/learning-decisions'

const SEED_QUERY = 'key concepts, definitions, and facts'

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
  await requireRateLimit(event, 5, 'quiz.generate')
  const userId = getConvexTokenIdentifier(event)

  const body = await readBody<{
    folderId: string
    model?: string
    questionCount?: number
    topics?: string[]
    questionTypes?: string[]
    difficulty?: string
    resourceIds?: string[]
    taskId?: string
  }>(event)

  if (!body?.folderId?.trim()) {
    throw createError({ statusCode: 400, message: 'folderId is required' })
  }

  const taskId = body.taskId as Id<'tasks'> | undefined
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
    const questionCount = Math.min(Math.max(body.questionCount ?? 8, 3), 50)

    const searchQuery = body.topics && body.topics.length > 0
      ? body.topics.join(', ')
      : SEED_QUERY

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
      query: searchQuery,
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
        console.error('[quiz/generate] Failed to fetch folder docs fallback:', error)
      }
    }

    if (chunks.length < 2) {
      const deepSearch = await searchOrEmpty({
        query: searchQuery,
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
      const msg = 'Not enough indexed content to generate a quiz'
      await failTask(msg)
      throw createError({ statusCode: 422, message: msg })
    }

    if (taskId) await setTaskProgress('Generating questions…')

    const messages = buildQuizPrompt(chunks, {
      questionCount,
      topics: body.topics,
      questionTypes: body.questionTypes,
      difficulty: body.difficulty,
    })

    const completion = await generateCompletion({
      model,
      messages,
      temperature: 0.3,
      max_tokens: Math.max(3000, questionCount * 400),
    })

    const raw = completion.choices[0]?.message?.content ?? ''
    const parsed = parseQuizResponse(raw)

    if (parsed.questions.length === 0) {
      const msg = 'Quiz generation produced no valid questions'
      await failTask(msg)
      throw createError({ statusCode: 502, message: msg })
    }

    // Advisory-only and bounded. Nothing below reads its outcome, preserving
    // quiz publication, persistence, and deterministic learner scoring.
    await scheduleShadowEvaluateQuiz(event, parsed.questions.map((question, index) => ({
      id: `q${index}`,
      question: question.question,
      options: question.options,
      correctAnswer: question.correctAnswer,
    }))).catch(() => undefined)

    const persistQuestions = parsed.questions.map((q, index) => {
      const chunk = chunks[q.sourceIndex] ?? chunks[index] ?? chunks[0]!
      const attrs = (chunk.attributes ?? {}) as { filename?: string; documentId?: string }
      return {
        order: index,
        question: q.question,
        type: q.type,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        sourceDocumentId: attrs.documentId,
        sourceChunkContent: chunk.content,
        sourceFilename: attrs.filename ?? 'Unknown source',
      }
    })

    if (taskId && convexClient) {
      await setTaskProgress('Saving quiz…')

      const { quizId } = await convexClient.mutation(api.quizzes.createWithQuestions, {
        folderId: body.folderId as Id<'folders'>,
        title: parsed.title,
        model,
        creationMethod: 'auto_generated' as const,
        difficulty: body.difficulty,
        questions: persistQuestions,
      })

      await convexClient.mutation(api.tasks.markComplete, {
        taskId,
        result: { quizId, questionCount: persistQuestions.length },
      })

      return {
        title: parsed.title,
        model,
        questions: persistQuestions,
        questionCount: persistQuestions.length,
        taskId,
        quizId,
      }
    }

    return {
      title: parsed.title,
      model,
      questions: persistQuestions,
      questionCount: persistQuestions.length,
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
