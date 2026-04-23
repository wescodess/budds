import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { AISearchChunk } from '../../utils/ai-search'
import { readConfiguredRuntimeValue } from '../../utils/runtime-config'
import { requireRateLimit } from '../../utils/rate-limit'
import { buildSectionTextPrompt } from '../../utils/section-text-prompt'
import { buildAudioPrimerPrompt } from '../../utils/audio-primer-prompt'
import {
  parseAudioScriptResponse,
  splitOversizedTurns,
  sanitizeTurnForSpeech,
  estimateTurnDurationMs,
} from '../../utils/audio-script-prompt'
import { resolveTtsEngine, synthesizeTurn, synthesizeDialogue, engineVoiceProfile } from '../../utils/tts-provider'

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

const AUDIO_SCRIPT_MODEL = 'google/gemini-2.5-flash'
const DEFAULT_VOICE_PROFILE = { hostA: 'asteria' as const, hostB: 'orion' as const }
const MAX_PRIMER_TURNS = 16
const MIN_PRIMER_TURNS = 2

export default defineEventHandler(async (event) => {
  requireRateLimit(event, 5)
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

    const sections = await convexClient.query(api.courseSections.listByCourse, { courseId })
    const section = sections.find((s: any) => s._id === sectionId)
    if (!section) {
      throw createError({ statusCode: 404, message: 'Section not found' })
    }

    await setTaskProgress('Retrieving source material...')

    const engineConfig = getEngineConfig(section.knowledgeType)

    let chunks: AISearchChunk[] = []

    if (course.sourceType !== 'web-only' && course.folderId) {
      const sourceDocs = await convexClient.query(api.courseSourceDocs.listByCourse, { courseId })
      const folderIds = [...new Set(sourceDocs.map((d: any) => d.folderId).filter(Boolean))] as string[]
      const docIds = sourceDocs.map((d: any) => d.documentId).filter(Boolean) as string[]

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

    const audioPromise = (async (): Promise<string | null> => {
      if (!engineConfig.includeAudio) return null
      if (chunks.length === 0 && course.sourceType !== 'web-only') return null
      if (!course.folderId) return null

      const uploadedStorageIds: string[] = []

      async function cleanupOrphanBlobs() {
        for (const storageId of uploadedStorageIds) {
          try {
            await convexClient.mutation(api.audioOverviews.deleteOrphanTurnBlob, { storageId: storageId as Id<'_storage'> })
          } catch { /* best-effort */ }
        }
      }

      try {
        await setTaskProgress('Generating audio primer...')

        const primerMessages = buildAudioPrimerPrompt(chunks, {
          sectionTitle: section.title,
          courseTitle: course.title,
          knowledgeType: section.knowledgeType,
        })

        const completion = await generateCompletion({
          model: AUDIO_SCRIPT_MODEL,
          messages: primerMessages,
          temperature: 0.5,
          max_tokens: 2000,
        })

        const raw = completion.choices[0]?.message?.content ?? ''
        const parsedScript = parseAudioScriptResponse(raw)
        let normalizedTurns = splitOversizedTurns(parsedScript.turns)

        if (normalizedTurns.length > MAX_PRIMER_TURNS) {
          normalizedTurns = normalizedTurns.slice(0, MAX_PRIMER_TURNS)
        }

        if (normalizedTurns.length < MIN_PRIMER_TURNS) {
          console.warn(`[generate-section] Audio primer too short (${normalizedTurns.length} turns), skipping`)
          failedEngines.push('audio primer')
          return null
        }

        await setTaskProgress('Synthesizing audio primer...')
        const ttsEngine = await resolveTtsEngine()

        const sourceDocumentIds = new Set<string>()
        for (const turn of normalizedTurns) {
          const sourceChunk = turn.sourceIndex !== undefined ? chunks[turn.sourceIndex] : undefined
          const docId = (sourceChunk?.attributes?.documentId as string | undefined) ?? undefined
          if (docId) sourceDocumentIds.add(docId)
        }

        const persistedTurns: Array<{
          speaker: 'host_a' | 'host_b'
          text: string
          audioFileId: Id<'_storage'>
          durationMs: number
          sourceIndex?: number
        }> = []

        if (ttsEngine === 'dia') {
          const diaScript = normalizedTurns
            .map(t => `[${t.speaker === 'host_a' ? 'S1' : 'S2'}] ${sanitizeTurnForSpeech(t.text, { preserveExpressions: true })}`)
            .join(' ... ')

          const result = await synthesizeDialogue(diaScript)

          const uploadUrl = await convexClient.mutation(api.audioOverviews.generateTurnUploadUrl, {})
          const uploadResponse = await fetch(uploadUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'audio/mpeg' },
            body: result.audio,
          })
          if (!uploadResponse.ok) throw new Error('Failed to upload audio primer')

          const uploadJson = await uploadResponse.json() as { storageId?: string }
          if (!uploadJson.storageId) throw new Error('Upload returned no storageId')
          uploadedStorageIds.push(uploadJson.storageId)

          const combinedText = normalizedTurns.map(t => `${t.speaker === 'host_a' ? 'Host A' : 'Host B'}: ${t.text}`).join('\n')
          persistedTurns.push({
            speaker: 'host_a',
            text: combinedText,
            audioFileId: uploadJson.storageId as Id<'_storage'>,
            durationMs: result.durationMs,
          })
        } else {
          const voiceProfile = DEFAULT_VOICE_PROFILE
          for (let i = 0; i < normalizedTurns.length; i++) {
            const turn = normalizedTurns[i]!
            const auraVoice = turn.speaker === 'host_a' ? voiceProfile.hostA : voiceProfile.hostB
            const spokenText = sanitizeTurnForSpeech(turn.text)

            const audioBytes = await synthesizeTurn(spokenText, turn.speaker, ttsEngine, auraVoice)

            const uploadUrl = await convexClient.mutation(api.audioOverviews.generateTurnUploadUrl, {})
            const uploadResponse = await fetch(uploadUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'audio/mpeg' },
              body: audioBytes,
            })
            if (!uploadResponse.ok) throw new Error(`Failed to upload audio primer turn ${i + 1}`)

            const uploadJson = await uploadResponse.json() as { storageId?: string }
            if (!uploadJson.storageId) throw new Error(`Upload for primer turn ${i + 1} returned no storageId`)
            uploadedStorageIds.push(uploadJson.storageId)

            persistedTurns.push({
              speaker: turn.speaker,
              text: turn.text,
              audioFileId: uploadJson.storageId as Id<'_storage'>,
              durationMs: estimateTurnDurationMs(turn.text),
              sourceIndex: turn.sourceIndex,
            })
          }
        }

        const voiceProfile = ttsEngine === 'dia' ? engineVoiceProfile('dia') : DEFAULT_VOICE_PROFILE

        const { overviewId } = await convexClient.mutation(api.audioOverviews.createCourseScopedOverview, {
          folderId: course.folderId,
          title: parsedScript.title || `${section.title} Primer`,
          model: AUDIO_SCRIPT_MODEL,
          turns: persistedTurns,
          voiceProfile,
          preferences: { lengthMinutes: 2, complexity: 'beginner' },
          sourceDocumentIds: Array.from(sourceDocumentIds),
        })

        return overviewId
      } catch (err: any) {
        await cleanupOrphanBlobs()
        console.error('[generate-section] Audio primer generation failed:', err?.message)
        failedEngines.push('audio primer')
        return null
      }
    })()

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
    }
  } catch (err: any) {
    if (err?.statusCode !== 400 && err?.statusCode !== 404) {
      await failTask(err?.message || 'Section generation failed')
    }
    throw err
  }
})
