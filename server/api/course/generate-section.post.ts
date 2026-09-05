import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { AISearchChunk } from '../../utils/ai-search'
import { readConfiguredRuntimeValue } from '../../utils/runtime-config'
import { requireRateLimit } from '../../utils/rate-limit'
import { buildSectionTextPrompt } from '../../utils/section-text-prompt'
import { buildQuizPrompt, parseQuizResponse } from '../../utils/quiz-prompt'
import { buildFlashcardPrompt, parseFlashcardResponse } from '../../utils/flashcard-prompt'

interface EngineConfig {
  includeAudio: boolean
  quizQuestionCount: number
  flashcardCount: number
  quizTopics?: string[]
}

function getEngineConfig(knowledgeType: string): EngineConfig {
  switch (knowledgeType) {
    case 'factual':
      return { includeAudio: false, quizQuestionCount: 5, flashcardCount: 16 }
    case 'conceptual':
      return { includeAudio: true, quizQuestionCount: 8, flashcardCount: 12 }
    case 'procedural':
      return { includeAudio: false, quizQuestionCount: 10, flashcardCount: 8 }
    default:
      return { includeAudio: false, quizQuestionCount: 8, flashcardCount: 12 }
  }
}

function makeConvexClient(event: any): ConvexHttpClient {
  const token = event.context.convexToken as string | undefined
  const runtimeConfig = useRuntimeConfig(event)
  const convexUrl = readConfiguredRuntimeValue(
    runtimeConfig.public?.convex?.url,
    'NUXT_PUBLIC_CONVEX_URL',
    'CONVEX_URL',
  )
  if (!token || !convexUrl) {
    throw createError({ statusCode: 500, message: 'Failed to initialize Convex client' })
  }
  const client = new ConvexHttpClient(convexUrl)
  client.setAuth(token)
  return client
}

export default defineEventHandler(async (event) => {
  await requireRateLimit(event, 5, 'course.generate-section')
  const userId = getConvexTokenIdentifier(event)

  const body = await readBody<{
    courseId: string
    sectionId: string
    taskId?: string
  }>(event)

  if (!body?.courseId?.trim() || !body?.sectionId?.trim()) {
    throw createError({ statusCode: 400, message: 'courseId and sectionId are required' })
  }

  const courseId = body.courseId as Id<'courses'>
  const sectionId = body.sectionId as Id<'courseSections'>
  const taskId = body.taskId as Id<'tasks'> | undefined
  const convexClient = makeConvexClient(event)

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
    const course = await convexClient.query(api.courses.get, { id: courseId })
    if (!course) {
      throw createError({ statusCode: 404, message: 'Course not found' })
    }

    const sections = await convexClient.query(api.courseSections.listByCourse, { courseId })
    const section = sections.find((s: any) => s._id === sectionId)
    if (!section) {
      throw createError({ statusCode: 404, message: 'Section not found' })
    }

    await setTaskProgress('Retrieving source material...')

    const engineConfig = getEngineConfig(section.knowledgeType)

    let chunks: AISearchChunk[] = []
    let courseDocumentIds: string[] = []

    if (course.sourceType !== 'web-only' && course.folderId) {
      const sourceDocs = await convexClient.query(api.courseSourceDocs.listByCourse, { courseId })
      const folderIds = [...new Set(sourceDocs.map((d: any) => d.folderId).filter(Boolean))] as string[]
      const docIds = sourceDocs.map((d: any) => d.documentId).filter(Boolean) as string[]
      courseDocumentIds = [...new Set(docIds)]

      for (const folderId of folderIds) {
        if (chunks.length >= 30) break

        const folderDocIds = sourceDocs
          .filter((d: any) => d.folderId === folderId)
          .map((d: any) => d.documentId)
          .filter(Boolean) as string[]

        const results = await searchDocuments({
          query: `${section.title} ${course.title}`,
          userId,
          folderId,
          max_num_results: 30,
          score_threshold: 0.03,
          filterDocIds: folderDocIds,
        })

        if (results.data?.length > 0) {
          chunks.push(...results.data)
        }
      }

      if (chunks.length < 3 && docIds.length > 0) {
        const broadResults = await searchDocuments({
          query: `${section.title} ${course.title}`,
          userId,
          max_num_results: 30,
          score_threshold: 0.02,
          filterDocIds: courseDocumentIds,
        })
        if (broadResults.data?.length > chunks.length) {
          chunks = broadResults.data
        }
      }
    }

    await setTaskProgress('Generating section content...')

    const failedEngines: string[] = []
    const requestedModel = SERVER_DEFAULT_MODEL

    const textPromise = (async () => {
      try {
        const sourceContent = chunks.map(c => {
          const attrs = (c.attributes ?? {}) as { filename?: string }
          return `[${attrs.filename ?? 'document'}]\n${c.content}`
        }).join('\n\n---\n\n')

        const outlineSection = course.outlineSections.find((s: any) => s.order === section.order)
        const description = outlineSection?.description ?? section.title

        const messages = buildSectionTextPrompt({
          sectionTitle: section.title,
          sectionDescription: description,
          knowledgeType: section.knowledgeType,
          sourceContent: sourceContent || `Topic: ${section.title}. This is a ${course.sourceType === 'web-only' ? 'web-sourced' : 'document-based'} course about ${course.title}.`,
          courseTitle: course.title,
        })

        const completion = await generateCompletion({
          model: requestedModel,
          messages,
          temperature: 0.4,
          max_tokens: 2048,
        })

        return completion.choices[0]?.message?.content ?? null
      } catch (err: any) {
        console.error('[generate-section] Text generation failed:', err?.message)
        failedEngines.push('text explanation')
        return null
      }
    })()

    const quizPromise = (async () => {
      if (chunks.length === 0 && course.sourceType !== 'web-only') return null
      try {
        const quizMessages = buildQuizPrompt(chunks, {
          questionCount: engineConfig.quizQuestionCount,
          topics: [section.title],
        })

        const completion = await generateCompletion({
          model: requestedModel,
          messages: quizMessages,
          temperature: 0.3,
          max_tokens: Math.max(3000, engineConfig.quizQuestionCount * 400),
        })

        const raw = completion.choices[0]?.message?.content ?? ''
        const parsed = parseQuizResponse(raw)

        if (parsed.questions.length === 0) return null

        return {
          title: parsed.title || `${section.title} Quiz`,
          model: requestedModel,
          questions: parsed.questions.map((q, index) => {
            const chunk = chunks[q.sourceIndex] ?? chunks[index] ?? chunks[0]
            const attrs = (chunk?.attributes ?? {}) as { filename?: string; documentId?: string }
            return {
              order: index,
              question: q.question,
              type: q.type as 'multiple-choice' | 'free-response' | 'true_false' | 'fill_in_the_blank',
              options: q.options,
              correctAnswer: q.correctAnswer,
              explanation: q.explanation,
              sourceDocumentId: attrs.documentId,
              sourceChunkContent: chunk?.content,
              sourceFilename: attrs.filename ?? 'Unknown source',
            }
          }),
        }
      } catch (err: any) {
        console.error('[generate-section] Quiz generation failed:', err?.message)
        failedEngines.push('quiz questions')
        return null
      }
    })()

    const flashcardPromise = (async () => {
      if (chunks.length === 0 && course.sourceType !== 'web-only') return null
      try {
        const fcMessages = buildFlashcardPrompt(chunks, {
          cardCount: engineConfig.flashcardCount,
        })

        const completion = await generateCompletion({
          model: requestedModel,
          messages: fcMessages,
          temperature: 0.3,
          max_tokens: 3000,
        })

        const raw = completion.choices[0]?.message?.content ?? ''
        const parsed = parseFlashcardResponse(raw)

        if (parsed.cards.length === 0) return null

        return {
          title: parsed.title || `${section.title} Flashcards`,
          cards: parsed.cards.map((c, index) => {
            const chunk = chunks[c.sourceIndex] ?? chunks[index] ?? chunks[0]
            const attrs = (chunk?.attributes ?? {}) as { filename?: string }
            return {
              term: c.front,
              definition: c.back,
              sourceFilename: attrs.filename,
              sourceChunkContent: chunk?.content?.slice(0, 500),
            }
          }),
        }
      } catch (err: any) {
        console.error('[generate-section] Flashcard generation failed:', err?.message)
        failedEngines.push('flashcards')
        return null
      }
    })()

    // Course primers previously bypassed the durable v2 Generation Job and
    // published Dia/Aura media into the nested version-1 model. Keep section
    // generation useful, but fail this optional engine closed until it can
    // reserve and launch the same managed Audio Overview Workflow.
    const audioPrimer = engineConfig.includeAudio
      ? {
          status: 'requires-audio-overview-v2' as const,
          message: 'Course audio primers must be generated through the durable Audio Overview workflow.',
        }
      : undefined
    if (audioPrimer) failedEngines.push('audio primer')
    const audioPromise = Promise.resolve<string | null>(null)

    const [textResult, quizResult, flashcardResult, audioEntityId] = await Promise.all([
      textPromise,
      quizPromise,
      flashcardPromise,
      audioPromise,
    ])

    await setTaskProgress('Assembling section...')

    const result = await convexClient.mutation(api.courseSections.finalizeSectionGeneration, {
      sectionId,
      textContent: textResult || undefined,
      quizData: quizResult || undefined,
      flashcardData: flashcardResult || undefined,
      audioEntityId: audioEntityId || undefined,
      failedEngines: failedEngines.length > 0 ? failedEngines : undefined,
      taskId,
    })

    if (taskId) {
      if (result.status === 'ready') {
        await convexClient.mutation(api.tasks.markComplete, {
          taskId,
          result: { sectionId, blockCount: result.blockCount },
        })
      } else {
        await failTask('All content engines failed')
      }
    }

    return {
      sectionId,
      status: result.status,
      blockCount: result.status === 'ready' ? result.blockCount : 0,
      failedEngines,
      audioPrimer,
    }
  } catch (err: any) {
    if (err?.statusCode !== 400 && err?.statusCode !== 404) {
      await failTask(err?.message || 'Section generation failed')
    }
    throw err
  }
})
