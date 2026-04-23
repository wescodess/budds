import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { readConfiguredRuntimeValue } from '../../utils/runtime-config'
import { requireRateLimit } from '../../utils/rate-limit'
import { buildOutlinePrompt, parseOutlineResponse } from '../../utils/outline-prompt'

const MAX_CONTENT_CHARS = 80_000

function makeConvexClient(event: any): ConvexHttpClient | null {
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
  requireRateLimit(event, 3)
  const userId = getConvexTokenIdentifier(event)

  const body = await readBody<{
    courseId: string
    taskId?: string
  }>(event)

  if (!body?.courseId?.trim()) {
    throw createError({ statusCode: 400, message: 'courseId is required' })
  }

  const courseId = body.courseId as Id<'courses'>
  const taskId = body.taskId as Id<'tasks'> | undefined
  const convexClient = makeConvexClient(event)

  if (!convexClient) {
    throw createError({ statusCode: 500, message: 'Failed to initialize Convex client' })
  }

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

    await setTaskProgress('Retrieving documents...')

    let documentContent = ''
    let docCount = 0

    if (course.sourceType !== 'web-only') {
      const sourceDocs = await convexClient.query(api.courseSourceDocs.listByCourse, { courseId })

      const folderIds = [...new Set(sourceDocs.map(d => d.folderId).filter(Boolean))] as string[]
      const docIds = sourceDocs.map(d => d.documentId).filter(Boolean) as string[]

      for (const folderId of folderIds) {
        if (documentContent.length >= MAX_CONTENT_CHARS) break

        const folderDocIds = sourceDocs
          .filter(d => d.folderId === folderId)
          .map(d => d.documentId)
          .filter(Boolean) as string[]

        const results = await searchDocuments({
          query: course.title,
          userId,
          folderId,
          max_num_results: 50,
          score_threshold: 0.03,
          filterDocIds: folderDocIds,
        })

        if (results.data?.length > 0) {
          for (const chunk of results.data) {
            if (documentContent.length >= MAX_CONTENT_CHARS) break
            documentContent += `[${chunk.attributes?.filename ?? 'document'}]\n${chunk.content}\n\n---\n\n`
          }
          docCount += folderDocIds.length
        }
      }

      if (!documentContent.trim() && docIds.length > 0) {
        const broadResults = await searchDocuments({
          query: course.title,
          userId,
          max_num_results: 40,
          score_threshold: 0.02,
        })
        if (broadResults.data?.length > 0) {
          for (const chunk of broadResults.data) {
            if (documentContent.length >= MAX_CONTENT_CHARS) break
            documentContent += `[${chunk.attributes?.filename ?? 'document'}]\n${chunk.content}\n\n---\n\n`
          }
          docCount = docIds.length
        }
      }
    }

    await setTaskProgress('Generating outline...')

    const messages = buildOutlinePrompt(documentContent, course.title, course.sourceType)

    const model = course.sourceType === 'web-only'
      ? 'openai/gpt-4o'
      : SERVER_DEFAULT_MODEL

    const completion = await generateCompletion({
      model,
      messages,
      temperature: 0.4,
      max_tokens: 4096,
    })

    const raw = completion.choices[0]?.message?.content ?? ''
    const sections = parseOutlineResponse(raw)

    if (sections.length === 0) {
      const msg = 'Outline generation produced no valid sections'
      await failTask(msg)
      await convexClient.mutation(api.courses.markFailed, { courseId })
      throw createError({ statusCode: 502, message: msg })
    }

    await setTaskProgress('Creating sections...')

    const sourceConfidence = course.sourceType === 'web-only'
      ? { docCount: 0, webPercent: 100 }
      : { docCount, webPercent: 0 }

    await convexClient.mutation(api.courses.finalizeOutline, {
      courseId,
      outlineSections: sections.map(s => ({
        title: s.title,
        description: s.description,
        knowledgeType: s.knowledgeType,
        order: s.order,
      })),
      sourceConfidence,
      totalSectionCount: sections.length,
    })

    if (taskId) {
      await convexClient.mutation(api.tasks.markComplete, {
        taskId,
        result: { courseId, sectionCount: sections.length },
      })
    }

    return {
      courseId,
      sectionCount: sections.length,
      sections: sections.map(s => ({ title: s.title, knowledgeType: s.knowledgeType })),
    }
  } catch (err: any) {
    if (err?.statusCode !== 400 && err?.statusCode !== 404 && err?.statusCode !== 502) {
      await failTask(err?.message || 'Outline generation failed')
      try {
        await convexClient.mutation(api.courses.markFailed, { courseId })
      } catch { /* best-effort */ }
    }
    throw err
  }
})
