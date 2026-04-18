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
import { synthesizeVoiceWithRetry, isAuraVoice, type AuraVoice } from '../../utils/tts-workers-ai'
import { readConfiguredRuntimeValue } from '../../utils/runtime-config'
import { requireRateLimit } from '../../utils/rate-limit'

const SCRIPT_MODEL = 'google/gemini-2.5-flash'
const MAX_SEARCH_RESULTS = 10
const DEFAULT_HOSTS: { hostA: AuraVoice, hostB: AuraVoice } = { hostA: 'asteria', hostB: 'orion' }

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
  requireRateLimit(event, 10)
  const userId = getConvexTokenIdentifier(event)

  const body = await readBody<{
    overviewId: string
    insertedAfterTurnIndex: number
    question: string
    model?: string
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
  if (!convexClient) {
    throw createError({ statusCode: 500, message: 'Convex client unavailable' })
  }

  const overview = await convexClient.query(api.audioOverviews.getWithTurns, {
    id: body.overviewId as Id<'audioOverviews'>,
  })
  if (!overview) {
    throw createError({ statusCode: 404, message: 'Audio overview not found' })
  }
  if (overview.status !== 'ready') {
    throw createError({ statusCode: 409, message: 'Audio overview is not ready' })
  }

  const voiceProfile = {
    hostA: isAuraVoice(overview.voiceProfile?.hostA) ? overview.voiceProfile.hostA : DEFAULT_HOSTS.hostA,
    hostB: isAuraVoice(overview.voiceProfile?.hostB) ? overview.voiceProfile.hostB : DEFAULT_HOSTS.hostB,
  }

  const clampedAfterIndex = Math.max(0, Math.min(afterIndex, overview.turns.length))

  const searchResults = await searchDocuments({
    query: question,
    userId,
    folderId: overview.folderId as unknown as string,
    max_num_results: MAX_SEARCH_RESULTS,
    score_threshold: 0.05,
  })

  let chunks: AISearchChunk[] = searchResults.data ?? []

  if (chunks.length === 0) {
    try {
      const folderDocs = await fetchFolderDocs({
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

  const model = body.model?.trim() || SCRIPT_MODEL
  const promptMessages = buildInterjectionPrompt({
    question,
    overviewTitle: overview.title,
    chunks,
  })

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

  const uploadedStorageIds: Array<Id<'_storage'>> = []

  async function cleanupOrphanBlobs() {
    if (uploadedStorageIds.length === 0) return
    for (const storageId of uploadedStorageIds) {
      try {
        await convexClient!.mutation(api.audioOverviews.deleteOrphanTurnBlob, { storageId })
      }
      catch { /* best-effort */ }
    }
    uploadedStorageIds.length = 0
  }

  try {
    const persistedTurns: Array<{
      speaker: 'host_a' | 'host_b'
      text: string
      audioFileId: Id<'_storage'>
      durationMs: number
      sourceIndex?: number
    }> = []

    for (let i = 0; i < normalizedTurns.length; i++) {
      const turn = normalizedTurns[i]!
      const speaker = turn.speaker === 'host_a' ? voiceProfile.hostA : voiceProfile.hostB
      const spokenText = sanitizeTurnForSpeech(turn.text)

      let audioBytes: Uint8Array
      try {
        audioBytes = await synthesizeVoiceWithRetry({ text: spokenText, speaker })
      }
      catch (err: any) {
        throw createError({
          statusCode: 502,
          message: `Interjection synthesis failed on turn ${i + 1}: ${err?.message ?? 'unknown'}`,
        })
      }

      const uploadUrl = await convexClient.mutation(api.audioOverviews.generateTurnUploadUrl, {})
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/mpeg' },
        body: audioBytes,
      })
      if (!uploadResponse.ok) {
        const text = await uploadResponse.text().catch(() => '')
        throw createError({
          statusCode: 502,
          message: `Failed to upload interjection turn ${i + 1}: ${uploadResponse.status} ${text || uploadResponse.statusText}`,
        })
      }
      const uploadJson = await uploadResponse.json() as { storageId?: string }
      const storageId = uploadJson.storageId
      if (!storageId) {
        throw createError({
          statusCode: 502,
          message: `Upload for interjection turn ${i + 1} returned no storageId`,
        })
      }
      uploadedStorageIds.push(storageId as Id<'_storage'>)

      persistedTurns.push({
        speaker: turn.speaker,
        text: turn.text,
        audioFileId: storageId as Id<'_storage'>,
        durationMs: estimateTurnDurationMs(turn.text),
        sourceIndex: turn.sourceIndex,
      })
    }

    const { interjectionId } = await convexClient.mutation(api.audioOverviewInterjections.create, {
      audioOverviewId: body.overviewId as Id<'audioOverviews'>,
      insertedAfterTurnIndex: clampedAfterIndex,
      question,
      model,
      answerTurns: persistedTurns,
    })

    uploadedStorageIds.length = 0

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
    throw err
  }
})
