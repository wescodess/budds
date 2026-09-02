import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { AISearchChunk } from '../../utils/ai-search'
import {
  buildInterjectionPrompt,
  parseInterjectionResponse,
  capInterjectionTurns,
  MIN_ANSWER_TURNS,
} from '../../utils/interjection-prompt'
import {
  estimateTurnDurationMs,
  sanitizeTurnForSpeech,
  splitOversizedTurns,
  type AudioScriptTurn,
} from '../../utils/audio-script-prompt'
import { isAuraVoice, type AuraVoice } from '../../utils/tts-workers-ai'
import { resolveTtsEngine, synthesizeTurn, type TtsEngine } from '../../utils/tts-provider'
import { readConfiguredRuntimeValue } from '../../utils/runtime-config'
import { uploadAudioOverviewBytes } from '../../utils/audio-overview-upload'

const SCRIPT_MODEL = 'google/gemini-2.5-flash'
const MAX_SEARCH_RESULTS = 10
const DEFAULT_HOSTS: { hostA: AuraVoice, hostB: AuraVoice } = { hostA: 'asteria', hostB: 'orion' }

function makeConvexClient(event: any): ConvexHttpClient {
  const token = event.context.convexToken as string | undefined
  const runtimeConfig = useRuntimeConfig(event)
  const convexUrl = readConfiguredRuntimeValue(
    runtimeConfig.public?.convex?.url,
    'NUXT_PUBLIC_CONVEX_URL',
    'CONVEX_URL',
  )
  if (!token || !convexUrl) {
    throw createError({ statusCode: 500, message: 'Convex client unavailable' })
  }
  const client = new ConvexHttpClient(convexUrl)
  client.setAuth(token)
  return client
}

export default defineEventHandler(async (event) => {
  const userId = getConvexTokenIdentifier(event)

  const body = await readBody<{
    overviewId: string
    insertedAfterTurnIndex: number
    question: string
  }>(event)

  if (!body?.overviewId) {
    throw createError({ statusCode: 400, message: 'overviewId is required' })
  }
  const question = (body.question ?? '').trim().slice(0, 500)
  if (!question) {
    throw createError({ statusCode: 400, message: 'question is required' })
  }
  const afterIndex = typeof body.insertedAfterTurnIndex === 'number'
    ? body.insertedAfterTurnIndex
    : 0

  const convexClient = makeConvexClient(event)

  const overview = await convexClient.query(api.audioOverviews.getWithTurns, {
    id: body.overviewId as Id<'audioOverviews'>,
  })
  if (!overview) {
    throw createError({ statusCode: 404, message: 'Audio overview not found' })
  }
  if (overview.status !== 'ready') {
    throw createError({ statusCode: 409, message: 'Audio overview is not ready' })
  }

  const storedHostA = overview.voiceProfile?.hostA
  const storedHostB = overview.voiceProfile?.hostB
  const overviewUsesDia = storedHostA?.startsWith('dia-') || storedHostB?.startsWith('dia-')

  const voiceProfile = {
    hostA: isAuraVoice(storedHostA) ? storedHostA : DEFAULT_HOSTS.hostA,
    hostB: isAuraVoice(storedHostB) ? storedHostB : DEFAULT_HOSTS.hostB,
  }
  const scopeDocIds = overview.scopeDocIds?.map(String)
  let audioTaskId: Id<'tasks'>
  try {
    const reservation = await convexClient.mutation(api.tasks.requestAudioOverview, {
      folderId: overview.folderId as Id<'folders'>,
      scope: scopeDocIds?.length
        ? { mode: 'explicit' as const, documentIds: scopeDocIds as Id<'documents'>[] }
        : { mode: 'folder' as const },
      preferences: { lengthMinutes: 5 as const, complexity: 'beginner' as const },
      voiceProfile,
    })
    audioTaskId = reservation.taskId
    await convexClient.mutation(api.tasks.claimAudioOverviewGeneration, { taskId: audioTaskId })
  }
  catch {
    throw createError({ statusCode: 409, message: 'Audio interjection generation is not available' })
  }

  const uploadedClaimIds: Array<Id<'audioOverviewUploadClaims'>> = []

  async function cleanupOrphanBlobs() {
    if (uploadedClaimIds.length === 0) return
    const claimIds = [...uploadedClaimIds]
    uploadedClaimIds.length = 0
    try {
      await convexClient.mutation(api.audioOverviewUploads.discard, { claimIds })
    }
    catch { /* best-effort */ }
  }

  async function failAudioTask(error: string) {
    try {
      await convexClient.mutation(api.tasks.failAudioOverviewGeneration, { taskId: audioTaskId, error })
    }
    catch { /* best-effort */ }
  }

  async function requireRunningAudioTask() {
    const task = await convexClient.query(api.tasks.get, { taskId: audioTaskId })
    if (!task || task.status !== 'running') {
      throw createError({ statusCode: 409, message: 'Audio interjection generation was cancelled' })
    }
  }

  try {

  const ttsEngine: TtsEngine = overviewUsesDia ? await resolveTtsEngine() : 'aura-1'

  await requireRunningAudioTask()

  const clampedAfterIndex = Math.max(0, Math.min(afterIndex, overview.turns.length))

  const searchResults = await searchDocuments({
    query: question,
    userId,
    folderId: scopeDocIds?.length ? undefined : overview.folderId as unknown as string,
    max_num_results: MAX_SEARCH_RESULTS,
    score_threshold: 0.05,
    filterDocIds: scopeDocIds,
  })

  let chunks: AISearchChunk[] = searchResults.data ?? []

  if (chunks.length === 0) {
    try {
      const folderDocs = scopeDocIds?.length
        ? []
        : await fetchFolderDocs({
            userId,
            folderId: overview.folderId as unknown as string,
            maxChars: 40_000,
          })
      if (folderDocs.length > 0) {
        chunks = folderDocs.map((doc): AISearchChunk => ({
          id: doc.key,
          content: doc.content,
          score: 1,
          attributes: {
            filename: doc.filename,
            folderId: overview.folderId as unknown as string,
            documentId: doc.documentId,
            userId,
          },
        }))
      }
    }
    catch (error) {
      console.error('[audio-overview/interject] folder-docs fallback failed:', error)
    }
  }

  if (chunks.length === 0) {
    throw createError({ statusCode: 422, message: 'Not enough context to answer' })
  }

  const model = SCRIPT_MODEL
  const promptMessages = buildInterjectionPrompt({
    question,
    overviewTitle: overview.title,
    chunks,
    ttsEngine,
  })

  await requireRunningAudioTask()
  const completion = await generateCompletion({
    model,
    messages: promptMessages,
    temperature: 0.6,
    max_tokens: 1500,
  })

  const raw = completion.choices[0]?.message?.content ?? ''
  const parsed = parseInterjectionResponse(raw)
  let normalizedTurns = splitOversizedTurns(parsed.turns as AudioScriptTurn[])
  normalizedTurns = capInterjectionTurns(normalizedTurns)

  if (normalizedTurns.length < MIN_ANSWER_TURNS) {
    throw createError({
      statusCode: 502,
      message: `Interjection script too short (got ${normalizedTurns.length}, need at least ${MIN_ANSWER_TURNS})`,
    })
  }

    const persistedTurns: Array<{
      speaker: 'host_a' | 'host_b'
      text: string
      audioFileId: Id<'_storage'>
      uploadClaimId: Id<'audioOverviewUploadClaims'>
      durationMs: number
      sourceIndex?: number
    }> = []

    for (let i = 0; i < normalizedTurns.length; i++) {
      await requireRunningAudioTask()
      const turn = normalizedTurns[i]!
      const auraVoice = turn.speaker === 'host_a' ? voiceProfile.hostA : voiceProfile.hostB
      const spokenText = sanitizeTurnForSpeech(turn.text, { preserveExpressions: ttsEngine === 'dia' })

      let audioBytes: Uint8Array
      try {
        audioBytes = await synthesizeTurn(spokenText, turn.speaker, ttsEngine, auraVoice)
      }
      catch (err: any) {
        throw createError({
          statusCode: 502,
          message: `Interjection synthesis failed on turn ${i + 1}: ${err?.message ?? 'unknown'}`,
        })
      }

      await requireRunningAudioTask()
      const upload = await uploadAudioOverviewBytes(convexClient, audioTaskId, audioBytes, uploadedClaimIds)


      persistedTurns.push({
        speaker: turn.speaker,
        text: turn.text,
        durationMs: estimateTurnDurationMs(turn.text),
        ...upload,
        sourceIndex: turn.sourceIndex,
      })
    }

    await requireRunningAudioTask()
    const { interjectionId } = await convexClient.mutation(api.audioOverviewInterjections.create, {
      audioOverviewId: body.overviewId as Id<'audioOverviews'>,
      taskId: audioTaskId,
      insertedAfterTurnIndex: clampedAfterIndex,
      question,
      model,
      answerTurns: persistedTurns,
    })

    uploadedClaimIds.length = 0

    const turnUrls = await convexClient.query(api.audioOverviewInterjections.getTurnUrls, {
      id: interjectionId,
    })

    const turnsWithUrls = persistedTurns.map((t, i) => ({
      speaker: t.speaker,
      text: t.text,
      durationMs: t.durationMs,
      sourceIndex: t.sourceIndex,
      audioFileId: t.audioFileId,
      audioUrl: (turnUrls ?? [])[i] ?? null,
    }))

    return {
      interjectionId,
      insertedAfterTurnIndex: clampedAfterIndex,
      answerTurnCount: persistedTurns.length,
      turns: turnsWithUrls,
      totalDurationMs: persistedTurns.reduce((s, t) => s + t.durationMs, 0),
      model,
    }
  }
  catch (err: any) {
    await cleanupOrphanBlobs()
    await failAudioTask(err?.message || 'Audio interjection generation failed')
    throw err
  }
})
