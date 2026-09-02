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
import { isAuraVoice, type AuraVoice } from '../../utils/tts-workers-ai'
import { resolveTtsEngine, synthesizeTurn, synthesizeDialogue, engineVoiceProfile, type TtsEngine } from '../../utils/tts-provider'
import { readConfiguredRuntimeValue } from '../../utils/runtime-config'
import { uploadAudioOverviewBytes } from '../../utils/audio-overview-upload'

const SEED_QUERY = 'key concepts, definitions, discussions, and themes'
const SCRIPT_MODEL = 'google/gemini-2.5-flash'
const DEFAULT_LENGTH_MINUTES = 10
const DEFAULT_COMPLEXITY = 'beginner' as const
const DEFAULT_VOICE_PROFILE: { hostA: AuraVoice; hostB: AuraVoice } = {
  hostA: 'asteria',
  hostB: 'orion',
}
const MAX_SEARCH_RESULTS = 50
const MAX_TURNS = 50
const MIN_TURNS = 3

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

interface ClaimedAudioOverviewRequest {
  folderId: Id<'folders'>
  scope: { mode: 'folder' } | { mode: 'explicit', documentIds: Id<'documents'>[] }
  documents: Array<{
    documentId: Id<'documents'>
    folderId: Id<'folders'>
    filename: string
    r2Key?: string
  }>
  preferences: { lengthMinutes: 5 | 10 | 20, complexity: 'beginner' | 'expert' }
  voiceProfile: { hostA: string, hostB: string }
  model?: string
  quotaDate: string
}

export default defineEventHandler(async (event) => {
  const userId = getConvexTokenIdentifier(event)

  const body = await readBody<{
    taskId?: string
  }>(event)

  if (!body?.taskId?.trim()) {
    throw createError({ statusCode: 400, message: 'taskId is required' })
  }

  const taskId = body.taskId as Id<'tasks'>
  const convexClient = makeConvexClient(event)

  let request: ClaimedAudioOverviewRequest
  try {
    request = await convexClient.mutation(
      api.tasks.claimAudioOverviewGeneration,
      { taskId },
    ) as ClaimedAudioOverviewRequest
  }
  catch {
    throw createError({ statusCode: 409, message: 'Audio overview generation is not available' })
  }

  const folderId = request.folderId
  const lengthMinutes = request.preferences?.lengthMinutes ?? DEFAULT_LENGTH_MINUTES
  const complexity = request.preferences?.complexity ?? DEFAULT_COMPLEXITY
  const requestedHostA = request.voiceProfile?.hostA
  const requestedHostB = request.voiceProfile?.hostB
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
    try { await convexClient.mutation(api.tasks.setProgress, { taskId, progress }) }
    catch { /* best-effort */ }
  }

  async function failTask(error: string) {
    try { await convexClient.mutation(api.tasks.failAudioOverviewGeneration, { taskId, error }) }
    catch { /* best-effort */ }
  }

  async function isTaskCancelled(): Promise<boolean> {
    try {
      const task = await convexClient.query(api.tasks.get, { taskId })
      return !task || task.status !== 'running'
    }
    catch {
      throw createError({ statusCode: 503, message: 'Unable to verify generation status' })
    }
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

  async function cancelledResult() {
    await cleanupOrphanBlobs()
    return { cancelled: true as const, taskId }
  }

  try {
    await setTaskProgress('Retrieving sources…')

    if (request.documents.length === 0) {
      const message = 'No ready sources were present when this audio overview was reserved'
      await failTask(message)
      throw createError({ statusCode: 422, message })
    }

    const scopeDocIds = request.documents.map(document => String(document.documentId))

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
      folderId: undefined,
      max_num_results: MAX_SEARCH_RESULTS,
      score_threshold: 0.05,
      filterDocIds: scopeDocIds,
    })

    let chunks: AISearchChunk[] = searchResults.data ?? []

    if (chunks.length < 2) {
      try {
        const folderDocs = await fetchFolderDocs({
          userId,
          documents: request.documents.map(document => ({
            documentId: String(document.documentId),
            folderId: String(document.folderId),
            filename: document.filename,
            r2Key: document.r2Key,
          })),
          maxChars: 80_000,
        })
        if (folderDocs.length > 0) {
          chunks = folderDocs.map((doc): AISearchChunk => ({
            id: doc.key,
            content: doc.content,
            score: 1,
            attributes: {
              filename: doc.filename,
              folderId: doc.folderId ?? String(folderId),
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

    if (chunks.length < 2) {
      const deepSearch = await searchOrEmpty({
        query: SEED_QUERY,
        userId,
        folderId: undefined,
        max_num_results: 40,
        score_threshold: 0.02,
        filterDocIds: scopeDocIds,
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
      const msg = 'Not enough indexed content for an audio overview'
      await failTask(msg)
      throw createError({ statusCode: 422, message: msg })
    }

    if (await isTaskCancelled()) {
      return await cancelledResult()
    }

    await setTaskProgress('Preparing voice engine…')
    const ttsEngine: TtsEngine = await resolveTtsEngine()

    if (await isTaskCancelled()) {
      return await cancelledResult()
    }

    await setTaskProgress('Writing dialogue…')

    const scriptModel = request.model?.trim() || SCRIPT_MODEL
    const promptMessages = buildAudioScriptPrompt(chunks, { lengthMinutes, complexity, ttsEngine })

    const completion = await generateCompletion({
      model: scriptModel,
      messages: promptMessages,
      temperature: 0.5,
      max_tokens: Math.max(4000, lengthMinutes * (ttsEngine === 'dia' ? 800 : 400)),
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
      return await cancelledResult()
    }

    const persistedTurns: Array<{
      speaker: 'host_a' | 'host_b'
      text: string
      audioFileId: Id<'_storage'>
      uploadClaimId: Id<'audioOverviewUploadClaims'>
      durationMs: number
      sourceIndex?: number
    }> = []
    const sourceDocumentIds = new Set<string>()

    for (const turn of normalizedTurns) {
      const sourceChunk = turn.sourceIndex !== undefined ? chunks[turn.sourceIndex] : undefined
      const docId = (sourceChunk?.attributes?.documentId as string | undefined) ?? undefined
      if (docId) sourceDocumentIds.add(docId)
    }

    if (ttsEngine === 'dia') {
      await setTaskProgress('Synthesizing audio…')

      const diaScript = normalizedTurns
        .map(t => `[${t.speaker === 'host_a' ? 'S1' : 'S2'}] ${sanitizeTurnForSpeech(t.text, { preserveExpressions: true })}`)
        .join(' ... ')

      let audioBytes: Uint8Array
      let durationMs: number
      try {
        const result = await synthesizeDialogue(diaScript)
        audioBytes = result.audio
        durationMs = result.durationMs
      }
      catch (err: any) {
        throw createError({ statusCode: 502, message: `Audio synthesis failed: ${err?.message ?? 'unknown error'}` })
      }

      if (await isTaskCancelled()) return await cancelledResult()
      const upload = await uploadAudioOverviewBytes(convexClient, taskId, audioBytes, uploadedClaimIds)

      const combinedText = normalizedTurns.map(t => `${t.speaker === 'host_a' ? 'Host A' : 'Host B'}: ${t.text}`).join('\n')
      persistedTurns.push({
        speaker: 'host_a',
        text: combinedText,
        ...upload,
        durationMs,
      })
    }
    else {
      for (let i = 0; i < normalizedTurns.length; i++) {
        if (await isTaskCancelled()) {
          return await cancelledResult()
        }

        const turn = normalizedTurns[i]!
        await setTaskProgress(`Synthesizing turn ${i + 1}/${normalizedTurns.length}…`)

        const auraVoice = turn.speaker === 'host_a' ? voiceProfile.hostA : voiceProfile.hostB
        const spokenText = sanitizeTurnForSpeech(turn.text)

        let audioBytes: Uint8Array
        try {
          audioBytes = await synthesizeTurn(spokenText, turn.speaker, ttsEngine, auraVoice)
        }
        catch (err: any) {
          const msg = `Audio synthesis failed on turn ${i + 1}: ${err?.message ?? 'unknown error'}`
          throw createError({ statusCode: 502, message: msg })
        }

        if (await isTaskCancelled()) return await cancelledResult()
        const upload = await uploadAudioOverviewBytes(convexClient, taskId, audioBytes, uploadedClaimIds)


        persistedTurns.push({
          speaker: turn.speaker,
          text: turn.text,
          durationMs: estimateTurnDurationMs(turn.text),
          ...upload,
          sourceIndex: turn.sourceIndex,
        })
      }
    }

    if (await isTaskCancelled()) {
      return await cancelledResult()
    }

    const { overviewId } = await convexClient.mutation(api.audioOverviews.createWithTurns, {
      folderId,
      taskId,
      title: parsedScript.title,
      model: scriptModel,
      turns: persistedTurns,
      voiceProfile: ttsEngine === 'dia' ? engineVoiceProfile('dia') : voiceProfile,
      preferences: { lengthMinutes, complexity },
      sourceDocumentIds: Array.from(sourceDocumentIds),
    })

    uploadedClaimIds.length = 0

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
