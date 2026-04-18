import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { AISearchChunk } from '../../utils/ai-search'
import {
  buildAudioScriptPrompt,
  estimateTurnDurationMs,
  parseAudioScriptResponse,
  sanitizeTurnForSpeech,
  splitOversizedTurns,
} from '../../utils/audio-script-prompt'
import { synthesizeVoiceWithRetry, isAuraVoice, type AuraVoice } from '../../utils/tts-workers-ai'
import { readConfiguredRuntimeValue } from '../../utils/runtime-config'
import { requireRateLimit } from '../../utils/rate-limit'

const SEED_QUERY = 'key concepts, definitions, discussions, and themes'
const SCRIPT_MODEL = 'google/gemini-2.5-flash'
const DEFAULT_LENGTH_MINUTES = 10
const DEFAULT_COMPLEXITY = 'beginner' as const
const DEFAULT_VOICE_PROFILE: { hostA: AuraVoice; hostB: AuraVoice } = {
  hostA: 'asteria',
  hostB: 'orion',
}
const MAX_SEARCH_RESULTS = 20
const MAX_TURNS = 50
const MIN_TURNS = 3

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
  requireRateLimit(event, 5)
  const userId = getConvexTokenIdentifier(event)

  const body = await readBody<{
    folderId: string
    taskId?: string
    model?: string
    preferences?: {
      lengthMinutes?: number
      complexity?: 'beginner' | 'expert'
    }
    voiceProfile?: {
      hostA?: string
      hostB?: string
    }
    scopeDocIds?: string[]
  }>(event)

  if (!body?.folderId?.trim()) {
    throw createError({ statusCode: 400, message: 'folderId is required' })
  }

  const taskId = body.taskId as Id<'tasks'> | undefined
  const convexClient = makeConvexClient(event)
  if (taskId && !convexClient) {
    throw createError({ statusCode: 500, message: 'Convex client unavailable — cannot attach task' })
  }

  const lengthMinutes = body.preferences?.lengthMinutes ?? DEFAULT_LENGTH_MINUTES
  const complexity = body.preferences?.complexity ?? DEFAULT_COMPLEXITY
  const requestedHostA = body.voiceProfile?.hostA
  const requestedHostB = body.voiceProfile?.hostB
  const resolvedHostA: AuraVoice = isAuraVoice(requestedHostA) ? requestedHostA : DEFAULT_VOICE_PROFILE.hostA
  const resolvedHostB: AuraVoice = isAuraVoice(requestedHostB) ? requestedHostB : DEFAULT_VOICE_PROFILE.hostB
  if (requestedHostA !== undefined && !isAuraVoice(requestedHostA)) {
    console.warn(`[audio-overview/generate] Unknown hostA voice "${requestedHostA}", falling back to ${DEFAULT_VOICE_PROFILE.hostA}`)
  }
  if (requestedHostB !== undefined && !isAuraVoice(requestedHostB)) {
    console.warn(`[audio-overview/generate] Unknown hostB voice "${requestedHostB}", falling back to ${DEFAULT_VOICE_PROFILE.hostB}`)
  }
  const voiceProfile = { hostA: resolvedHostA, hostB: resolvedHostB }

  async function setTaskProgress(progress: string) {
    if (!taskId || !convexClient) return
    try { await convexClient.mutation(api.tasks.setProgress, { taskId, progress }) }
    catch { /* best-effort */ }
  }

  async function failTask(error: string) {
    if (!taskId || !convexClient) return
    try { await convexClient.mutation(api.tasks.markFailed, { taskId, error }) }
    catch { /* best-effort */ }
  }

  async function isTaskCancelled(): Promise<boolean> {
    if (!taskId || !convexClient) return false
    try {
      const task = await convexClient.query(api.tasks.get, { taskId })
      return !!task && task.status === 'cancelled'
    }
    catch { return false }
  }

  const uploadedStorageIds: Array<Id<'_storage'>> = []

  async function cleanupOrphanBlobs() {
    if (uploadedStorageIds.length === 0 || !convexClient) return
    for (const storageId of uploadedStorageIds) {
      try {
        await convexClient.mutation(api.audioOverviews.deleteOrphanTurnBlob, { storageId })
      }
      catch { /* best-effort */ }
    }
    uploadedStorageIds.length = 0
  }

  try {
    if (taskId) await setTaskProgress('Retrieving sources…')

    const scopeDocIds = Array.isArray(body.scopeDocIds) && body.scopeDocIds.length > 0
      ? body.scopeDocIds
      : undefined

    const searchResults = await searchDocuments({
      query: SEED_QUERY,
      userId,
      folderId: scopeDocIds ? undefined : body.folderId,
      max_num_results: MAX_SEARCH_RESULTS,
      score_threshold: 0.05,
      filterDocIds: scopeDocIds,
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
        console.error('[audio-overview/generate] Failed to fetch folder docs fallback:', error)
      }
    }

    if (chunks.length === 0) {
      const msg = 'Not enough indexed content for an audio overview'
      await failTask(msg)
      throw createError({ statusCode: 422, message: msg })
    }

    if (await isTaskCancelled()) {
      return { cancelled: true as const, taskId }
    }

    await setTaskProgress('Writing dialogue…')

    const scriptModel = body.model?.trim() || SCRIPT_MODEL
    const promptMessages = buildAudioScriptPrompt(chunks, { lengthMinutes, complexity })

    const completion = await generateCompletion({
      model: scriptModel,
      messages: promptMessages,
      temperature: 0.5,
      max_tokens: Math.max(4000, lengthMinutes * 400),
    })

    const raw = completion.choices[0]?.message?.content ?? ''
    const parsedScript = parseAudioScriptResponse(raw)
    let normalizedTurns = splitOversizedTurns(parsedScript.turns)

    if (normalizedTurns.length > MAX_TURNS) {
      console.warn(`[audio-overview/generate] LLM returned ${normalizedTurns.length} turns; capping to ${MAX_TURNS}`)
      normalizedTurns = normalizedTurns.slice(0, MAX_TURNS)
    }

    if (normalizedTurns.length < MIN_TURNS) {
      const msg = `Audio overview script too short (got ${normalizedTurns.length}, need at least ${MIN_TURNS})`
      throw createError({ statusCode: 502, message: msg })
    }

    if (await isTaskCancelled()) {
      return { cancelled: true as const, taskId }
    }

    const persistedTurns: Array<{
      speaker: 'host_a' | 'host_b'
      text: string
      audioFileId: Id<'_storage'>
      durationMs: number
      sourceIndex?: number
    }> = []
    const sourceDocumentIds = new Set<string>()

    for (let i = 0; i < normalizedTurns.length; i++) {
      if (await isTaskCancelled()) {
        return { cancelled: true as const, taskId }
      }

      const turn = normalizedTurns[i]!
      await setTaskProgress(`Synthesizing turn ${i + 1}/${normalizedTurns.length}…`)

      const speaker = turn.speaker === 'host_a' ? voiceProfile.hostA : voiceProfile.hostB
      const spokenText = sanitizeTurnForSpeech(turn.text)

      let audioBytes: Uint8Array
      try {
        audioBytes = await synthesizeVoiceWithRetry({ text: spokenText, speaker })
      }
      catch (err: any) {
        const msg = `Audio synthesis failed on turn ${i + 1}: ${err?.message ?? 'unknown error'}`
        throw createError({ statusCode: 502, message: msg })
      }

      if (!convexClient) {
        throw createError({ statusCode: 500, message: 'Convex client unavailable — cannot upload audio' })
      }

      const uploadUrl = await convexClient.mutation(api.audioOverviews.generateTurnUploadUrl, {})
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/mpeg' },
        body: audioBytes,
      })
      if (!uploadResponse.ok) {
        const text = await uploadResponse.text().catch(() => '')
        const msg = `Failed to upload audio turn ${i + 1}: ${uploadResponse.status} ${text || uploadResponse.statusText}`
        throw createError({ statusCode: 502, message: msg })
      }

      const uploadJson = await uploadResponse.json() as { storageId?: string }
      const storageId = uploadJson.storageId
      if (!storageId) {
        const msg = `Upload for turn ${i + 1} returned no storageId`
        throw createError({ statusCode: 502, message: msg })
      }
      uploadedStorageIds.push(storageId as Id<'_storage'>)

      const sourceChunk = turn.sourceIndex !== undefined ? chunks[turn.sourceIndex] : undefined
      const docId = (sourceChunk?.attributes?.documentId as string | undefined) ?? undefined
      if (docId) sourceDocumentIds.add(docId)

      persistedTurns.push({
        speaker: turn.speaker,
        text: turn.text,
        audioFileId: storageId as Id<'_storage'>,
        durationMs: estimateTurnDurationMs(turn.text),
        sourceIndex: turn.sourceIndex,
      })
    }

    if (await isTaskCancelled()) {
      return { cancelled: true as const, taskId }
    }

    if (!convexClient) {
      throw createError({ statusCode: 500, message: 'Convex client unavailable — cannot persist overview' })
    }

    const { overviewId } = await convexClient.mutation(api.audioOverviews.createWithTurns, {
      folderId: body.folderId as Id<'folders'>,
      taskId,
      title: parsedScript.title,
      model: scriptModel,
      turns: persistedTurns,
      voiceProfile,
      preferences: { lengthMinutes, complexity },
      sourceDocumentIds: Array.from(sourceDocumentIds),
      scopeDocIds: scopeDocIds,
    })

    uploadedStorageIds.length = 0

    if (taskId) {
      await convexClient.mutation(api.tasks.markComplete, {
        taskId,
        result: { overviewId, turnCount: persistedTurns.length },
      })
    }

    return {
      title: parsedScript.title,
      model: scriptModel,
      turnCount: persistedTurns.length,
      totalDurationMs: persistedTurns.reduce((s, t) => s + t.durationMs, 0),
      taskId,
      overviewId,
    }
  }
  catch (err: any) {
    await cleanupOrphanBlobs()
    await failTask(err?.message || 'Generation failed')
    throw err
  }
})
