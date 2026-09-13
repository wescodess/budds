import { getErrorMessage } from '../../../shared/errors'
import { ConvexHttpClient } from 'convex/browser'
import type { H3Event } from 'h3'
import { api } from '../../../convex/_generated/api'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import { interjectionUtteranceVerificationId } from '../../../shared/audio-overview-grounding'
import { readConfiguredRuntimeValue } from '../../utils/runtime-config'
import { buildV2InterjectionPrompt, parseV2InterjectionScript } from '../../utils/audio-overview-interjection'
import {
  buildClaimEntailmentPrompt,
  CLAIM_ENTAILMENT_VERSION,
  parseClaimEntailmentResponse,
} from '../../utils/audio-overview-grounding'
import {
  assertPrivateInterjectionArtifact,
  getAudioOverviewWorkerToken,
  requestInterjectionWorker,
  type InterjectionArtifactEvidence,
} from '../../utils/audio-overview-interjection-worker'

const SCRIPT_MODEL = 'google/gemini-2.5-flash'
const MAX_SEARCH_RESULTS = 10

type V2Reservation = {
  interjectionId: Id<'audioOverviewInterjectionsV2'>
  duplicate: boolean
  status: string
  jobId: Id<'audioOverviewJobs'>
  sources: Array<{
    sourceId: string
    documentId: Id<'documents'>
    revision: string
    contentHash: string
    displayReference: string
  }>
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  let binary = ''
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

type V2Projection = Doc<'audioOverviewInterjectionsV2'> & {
  utterances: Array<{ text: string }>
  artifact: {
    artifactId: Id<'audioOverviewAudioArtifacts'>
    durationMs: number
    byteLength: number
    contentType: string
  } | null
}

function v2Response(interjection: V2Projection) {
  const artifactUrl = `/api/audio-overview/interjections/${interjection._id}/media`
  const durationMs = interjection.artifact?.durationMs ?? 0
  return {
    schemaVersion: 2 as const,
    interjectionId: interjection._id,
    insertedAfterTurnIndex: interjection.insertedAfterTurnIndex,
    utterances: interjection.utterances,
    artifactId: interjection.artifact?.artifactId,
    artifactUrl,
    totalDurationMs: durationMs,
    model: interjection.model,
    // Temporary compatibility projection: one combined WAV is played once.
    // The normalized Utterances remain available above for a continuous-mode player.
    turns: [{
      speaker: 'host_a' as const,
      text: interjection.utterances.map(utterance => utterance.text).join(' '),
      durationMs,
      audioUrl: artifactUrl,
    }],
  }
}

async function runV2Interjection(
  event: H3Event,
  convexClient: ConvexHttpClient,
  userId: string,
  overview: Pick<Doc<'audioOverviews'>, 'title'>,
  body: { overviewId: string, insertedAfterTurnIndex: number, question: string },
) {
  const orchestrationToken = getAudioOverviewWorkerToken(event)
  const suppliedKey = getRequestHeader(event, 'idempotency-key')?.trim()
  const idempotencyKey = suppliedKey && /^[A-Za-z0-9_-]{16,128}$/.test(suppliedKey)
    ? suppliedKey
    : `interjection_${await sha256Base64Url(`${userId}\n${body.overviewId}\n${body.insertedAfterTurnIndex}\n${body.question}`)}`
  const reservation = await convexClient.mutation(api.audioOverviewInterjectionsV2.reserve, {
    audioOverviewId: body.overviewId as Id<'audioOverviews'>,
    idempotencyKey,
    insertedAfterTurnIndex: body.insertedAfterTurnIndex,
    question: body.question,
  }) as V2Reservation
  if (reservation.status === 'cancelled' || reservation.status === 'deleting' || reservation.status === 'failed') {
    throw createError({ statusCode: 409, message: 'Audio interjection generation is not available' })
  }
  if (reservation.status === 'ready') {
    const existing = await convexClient.query(api.audioOverviewInterjectionsV2.getForOwner, { interjectionId: reservation.interjectionId })
    if (!existing) throw createError({ statusCode: 404, message: 'Interjection not found' })
    return v2Response(existing)
  }

  let ownsScripting = false
  let workerAttempted = false
  let workerCleanupAttempted = false
  try {
    const claim = await convexClient.mutation(api.audioOverviewInterjectionsV2.claimScripting, {
      interjectionId: reservation.interjectionId,
      orchestrationToken,
    })
    ownsScripting = claim.claimed
    if (!claim.claimed) {
      const current = await convexClient.query(api.audioOverviewInterjectionsV2.getForOwner, {
        interjectionId: reservation.interjectionId,
      })
      if (current?.status === 'ready') return v2Response(current)
      throw createError({ statusCode: 409, message: 'Audio interjection generation is already in progress' })
    }
    const allowedDocuments = reservation.sources.map(source => String(source.documentId))
    const allowedSourceByDocument = new Map(reservation.sources.map(source => [String(source.documentId), source]))
    const result = await searchDocuments({
      query: body.question,
      userId,
      max_num_results: MAX_SEARCH_RESULTS,
      score_threshold: 0.05,
      filterDocIds: allowedDocuments,
    })
    const indexedChunks = result.data ?? []
    let rejectedFrozenIdentity = false
    const evidence = indexedChunks
      .map((chunk) => {
        const source = allowedSourceByDocument.get(chunk.attributes.documentId ?? '')
        if (!source
          || chunk.attributes.contentHash?.trim().toLowerCase() !== source.contentHash.trim().toLowerCase()
          || chunk.attributes.sourceRevision?.trim() !== source.revision.trim()) {
          rejectedFrozenIdentity = true
          return null
        }
        return source && chunk.content.trim()
          ? { sourceId: source.sourceId, displayReference: source.displayReference, content: chunk.content.trim().slice(0, 8_000) }
          : null
      })
      .filter((source): source is NonNullable<typeof source> => source !== null)
      .slice(0, MAX_SEARCH_RESULTS)
    if (evidence.length === 0) {
      throw createError({
        statusCode: rejectedFrozenIdentity ? 503 : 422,
        message: rejectedFrozenIdentity ? 'Search index unavailable' : 'Not enough context to answer',
      })
    }

    const completion = await generateCompletion({
      model: SCRIPT_MODEL,
      messages: buildV2InterjectionPrompt({ question: body.question, overviewTitle: overview.title, sources: evidence }),
      temperature: 0.4,
      max_tokens: 1_500,
    })
    const script = parseV2InterjectionScript(
      completion.choices[0]?.message?.content ?? '',
      evidence,
    )
    const entailmentInput = script.utterances.map((utterance, utteranceOrder) => ({
      utteranceId: interjectionUtteranceVerificationId(String(reservation.interjectionId), utteranceOrder),
      sceneId: `interjection:${reservation.interjectionId}`,
      sceneOrder: 0,
      utteranceOrder,
      text: utterance.text,
      claims: [{
        claimId: utterance.claimId,
        text: utterance.claimText,
        evidenceQuotes: utterance.evidenceQuotes,
      }],
    }))
    const verificationCompletion = await generateCompletion({
      model: SCRIPT_MODEL,
      messages: buildClaimEntailmentPrompt(entailmentInput),
      temperature: 0,
      max_tokens: Math.min(1_000, Math.max(500, entailmentInput.length * 100)),
      maxAttempts: 1,
    })
    const verification = parseClaimEntailmentResponse(
      verificationCompletion.choices[0]?.message?.content ?? '',
      entailmentInput,
    )
    const verificationByUtterance = new Map(verification.decisions.map(decision => [decision.utteranceId, decision]))
    await convexClient.mutation(api.audioOverviewInterjectionsV2.startRendering, {
      interjectionId: reservation.interjectionId,
      orchestrationToken,
      utterances: script.utterances.map((utterance, utteranceOrder) => {
        const utteranceId = interjectionUtteranceVerificationId(String(reservation.interjectionId), utteranceOrder)
        const utteranceVerification = verificationByUtterance.get(utteranceId)
        if (!utteranceVerification) throw new Error('Interjection Utterance has no semantic entailment verification')
        return {
          speaker: utterance.speaker,
          text: utterance.text,
          sourceIds: utterance.sourceIds,
          claimId: utterance.claimId,
          claimText: utterance.claimText,
          evidenceQuotes: utterance.evidenceQuotes,
          verification: {
            version: CLAIM_ENTAILMENT_VERSION,
            utteranceId,
            model: SCRIPT_MODEL,
            decision: 'entailed' as const,
            reason: utteranceVerification.reason,
          },
        }
      }),
    })
    const renderClaim = await convexClient.mutation(api.audioOverviewInterjectionsV2.claimRenderingAttempt, {
      interjectionId: reservation.interjectionId,
      orchestrationToken,
    })
    if (!renderClaim.claimed) {
      throw createError({ statusCode: 409, message: 'Audio interjection rendering was already attempted' })
    }
    workerAttempted = true
    const render = await requestInterjectionWorker<{ artifact: InterjectionArtifactEvidence }>(event, 'POST', {
      jobId: String(reservation.jobId),
      interjectionId: String(reservation.interjectionId),
      idempotencyKey,
      utterances: script.utterances,
    })
    const renderedArtifact = render.artifact
    const current = await convexClient.query(api.audioOverviewInterjectionsV2.getForOwner, {
      interjectionId: reservation.interjectionId,
    })
    if (!current || current.status !== 'rendering') {
      workerCleanupAttempted = true
      await requestInterjectionWorker(event, 'DELETE', {
        jobId: String(reservation.jobId),
        interjectionId: String(reservation.interjectionId),
        idempotencyKey,
      }).catch(() => {})
      throw createError({ statusCode: 409, message: 'Audio interjection generation was cancelled' })
    }
    await assertPrivateInterjectionArtifact(renderedArtifact, {
      interjectionId: String(reservation.interjectionId),
      idempotencyKey,
    })
    await convexClient.mutation(api.audioOverviewInterjectionsV2.publish, {
      interjectionId: reservation.interjectionId,
      orchestrationToken,
      artifact: renderedArtifact,
    })
    const published = await convexClient.query(api.audioOverviewInterjectionsV2.getForOwner, {
      interjectionId: reservation.interjectionId,
    })
    if (!published || published.status !== 'ready') throw createError({ statusCode: 502, message: 'Interjection publication failed' })
    return v2Response(published)
  }
  catch (error) {
    if (workerAttempted && !workerCleanupAttempted) {
      await requestInterjectionWorker(event, 'DELETE', {
        jobId: String(reservation.jobId),
        interjectionId: String(reservation.interjectionId),
        idempotencyKey,
      }).catch(() => {})
    }
    if (ownsScripting) {
      await convexClient.mutation(api.audioOverviewInterjectionsV2.fail, {
        interjectionId: reservation.interjectionId,
        orchestrationToken,
        error: getErrorMessage(error, 'Audio interjection generation failed'),
      }).catch(() => {})
    }
    throw error
  }
}

function makeConvexClient(event: H3Event): ConvexHttpClient {
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

  if (overview.episodeId) {
    return await runV2Interjection(event, convexClient, userId, overview, {
      overviewId: body.overviewId,
      insertedAfterTurnIndex: afterIndex,
      question,
    })
  }

  // Version 1 remains readable and playable, but Ask must never create new
  // Dia/Aura artifacts. Regeneration migrates the listener to the managed v2
  // Audio Profile and frozen Source Manifest required by the production plan.
  throw createError({
    statusCode: 409,
    message: 'Ask is unavailable for this legacy Audio Overview. Generate a new Audio Overview to use managed follow-up audio.',
  })
})
