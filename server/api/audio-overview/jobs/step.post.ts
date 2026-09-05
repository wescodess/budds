import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { mainUtteranceVerificationId } from '../../../../shared/audio-overview-grounding'
import { AUDIO_OVERVIEW_PROFILE_V1 } from '../../../../shared/audio-overview-profile'
import type { AISearchChunk } from '../../../utils/ai-search'
import { alignRecognizedWordsToScript } from '../../../utils/audio-overview-alignment'
import {
  buildDialoguePlanDurationRepairPrompt,
  buildDialoguePlanEntailmentRepairPrompt,
  buildDialoguePlanEvidenceRepairPrompt,
  buildDialoguePlanJsonSchema,
  buildDialoguePlanPrompt,
  compactDialoguePlanDuration,
  isDialoguePlanDurationError,
  isDialoguePlanEvidenceError,
  parseDialoguePlanResponse,
  type DialoguePlan,
} from '../../../utils/audio-overview-script'
import {
  batchClaimEntailmentInputs,
  buildClaimEntailmentJsonSchema,
  buildClaimEntailmentPrompt,
  CLAIM_ENTAILMENT_VERSION,
  parseClaimEntailmentResponse,
} from '../../../utils/audio-overview-grounding'
import { fetchPrivateR2Object, getScopedR2ObjectIdentity } from '../../../utils/r2-folder'
import { readConfiguredRuntimeValue } from '../../../utils/runtime-config'
import { transcribeAudio } from '../../../utils/whisper-workers-ai'

const SEED_QUERY = 'key concepts, definitions, discussions, and themes'
const SCRIPT_MODEL = 'google/gemini-2.5-flash'
const MIN_GROUNDED_CHARACTERS_PER_MINUTE = {
  beginner: 250,
  expert: 375,
} as const

type QualityCheck = { code: string, outcome: 'accepted' | 'rejected', message: string }
type QualityGate = {
  version: string
  decision: 'accepted' | 'rejected'
  checks: QualityCheck[]
  metrics: {
    durationMs: number
    expectedDurationMs: number
    silenceRatio: number
    clippingRatio: number
    spokenDirections: string[]
    transcriptDivergence: number
    transcriptDivergenceThreshold: number
  }
}
type AudioFormat = { encoding: string, sampleRateHz: number, bitDepth: number, channels: number }
type SceneArtifact = {
  r2Key: string
  etag?: string
  contentType: string
  byteLength: number
  durationMs: number
  sha256: string
  sceneId: string
  sceneOrder: number
  attempt: number
  model: string
  audioProfileId: string
  audioProfileVersion: string
  format: AudioFormat
}
type FinalArtifact = Omit<SceneArtifact, 'sceneId' | 'sceneOrder' | 'attempt'> & {
  pcmByteLength: number
  sceneCount: number
  manifestSha256: string
}
type StepBody = {
  jobId?: string
  stage?: 'prepare' | 'scene-context' | 'claim-render' | 'commit-scene' | 'publish' | 'align' | 'fail'
  sceneOrder?: number
  attempt?: number
  artifact?: SceneArtifact | FinalArtifact
  qualityGate?: QualityGate
  error?: string
}

function makeJobClient(event: any) {
  const config = useRuntimeConfig(event)
  const convexUrl = readConfiguredRuntimeValue(config.public?.convex?.url, 'NUXT_PUBLIC_CONVEX_URL', 'CONVEX_URL')
  if (!convexUrl) throw createError({ statusCode: 503, message: 'Convex client unavailable' })
  return new ConvexHttpClient(convexUrl)
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : Uint8Array.from(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function classifyRetry(error: unknown) {
  const candidate = error as { statusCode?: number, status?: number, message?: string }
  const status = candidate.statusCode ?? candidate.status ?? 0
  const message = candidate.message ?? String(error)
  const permanent = [400, 401, 403, 404, 409, 422].includes(status)
    || /not configured|invalid|not enough indexed|search index unavailable|job not found|outside the frozen|outside the source|source manifest|claim|entailment|not semantically entailed|quality gate|provider budget|provider output limit|provider returned no text|unsupported audio|source changed/i.test(message)
  return { retryable: !permanent && (status === 0 || status === 408 || status === 429 || status >= 500), message: message.slice(0, 500) }
}

function errorStatus(error: unknown): number {
  const candidate = error as { statusCode?: number, status?: number }
  return candidate.statusCode ?? candidate.status ?? 0
}

function dialoguePlanMaxTokens(lengthMinutes: 5 | 10 | 20): number {
  // The response contains the spoken script plus its compact Claim Ledger and
  // source links. A real five-minute fixture exceeded 6k tokens, so leave room
  // for JSON closure and scale longer episodes linearly.
  return Math.max(12_000, lengthMinutes * 1_200)
}

function requireCompleteJsonContent(
  completion: Awaited<ReturnType<typeof generateCompletion>>,
  label: string,
): string {
  const choice = completion.choices[0]
  if (choice?.finish_reason === 'length' || choice?.native_finish_reason === 'MAX_TOKENS') {
    throw new Error(`${label} exceeded the provider output limit`)
  }
  const content = choice?.message?.content
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error(`${label} provider returned no text`)
  }
  return content
}

async function activeContext(client: ConvexHttpClient, jobId: Id<'audioOverviewJobs'>, capability: string) {
  const context = await client.query(api.audioOverviewJobs.getStepContext, { jobId, capability })
  const terminal = ['completed', 'failed', 'cancelled'].includes(context.job.status)
  return { active: !context.cancelled && !terminal, context }
}

function minimumGroundedCharacters(request: any): number {
  const lengthMinutes: unknown = request.preferences?.lengthMinutes
  const complexity: unknown = request.preferences?.complexity
  if ((lengthMinutes !== 5 && lengthMinutes !== 10 && lengthMinutes !== 20)
    || (complexity !== 'beginner' && complexity !== 'expert')) {
    throw createError({ statusCode: 422, message: 'Invalid frozen audio overview preferences' })
  }
  return lengthMinutes * MIN_GROUNDED_CHARACTERS_PER_MINUTE[complexity]
}

async function retrieveGroundedChunks(request: any, userId: string): Promise<AISearchChunk[]> {
  const minimumCharacters = minimumGroundedCharacters(request)
  const scopeDocIds = request.documents.map((document: any) => String(document.documentId))
  const frozenIdentityByDocument = new Map<string, { contentHash: string, sourceRevision: string }>(request.documents.map((document: any) => [
    String(document.documentId),
    {
      contentHash: String(document.contentHash ?? '').trim().toLowerCase(),
      sourceRevision: String(document.sourceRevision ?? '').trim(),
    },
  ]))
  const matchesFrozenRevision = (chunk: AISearchChunk) => {
    const documentId = String(chunk.attributes.documentId ?? '')
    const frozen = frozenIdentityByDocument.get(documentId)
    if (!frozen) return false
    const indexedHash = chunk.attributes.contentHash?.trim().toLowerCase()
    const indexedRevision = chunk.attributes.sourceRevision?.trim()
    return indexedHash === frozen.contentHash && indexedRevision === frozen.sourceRevision
  }
  let searchUnavailable = false
  let indexedRevisionUnavailable = false
  const searchOrEmpty = async (scoreThreshold: number) => {
    try {
      const result = await searchDocuments({
        query: SEED_QUERY,
        userId,
        max_num_results: 50,
        score_threshold: scoreThreshold,
        filterDocIds: scopeDocIds,
      })
      searchUnavailable = false
      const candidates = result.data ?? []
      const matched = candidates.filter(matchesFrozenRevision)
      if (candidates.length > matched.length) indexedRevisionUnavailable = true
      return matched
    }
    catch (error: unknown) {
      const candidate = error as { statusCode?: number, message?: string }
      if (candidate.statusCode !== 503 || candidate.message !== 'Search index unavailable') throw error
      searchUnavailable = true
      return []
    }
  }

  let chunks = await searchOrEmpty(0.05)
  if (chunks.reduce((sum, chunk) => sum + chunk.content.trim().length, 0) < minimumCharacters) {
    const deeper = await searchOrEmpty(0.02)
    if (deeper.length > chunks.length) chunks = deeper
  }
  if (chunks.reduce((sum, chunk) => sum + chunk.content.trim().length, 0) < minimumCharacters) {
    const exactTextSources = await fetchFolderDocs({
      userId,
      documents: request.documents.map((document: any) => ({
        documentId: String(document.documentId),
        folderId: String(document.folderId),
        filename: document.filename,
        r2Key: document.r2Key,
      })),
      maxChars: 80_000,
    })
    const exactSources = exactTextSources.filter((document: any) => {
      const frozen = frozenIdentityByDocument.get(String(document.documentId))
      return frozen
        && document.contentHash?.trim().toLowerCase() === frozen.contentHash
        && document.sourceRevision?.trim() === frozen.sourceRevision
    })
    if (exactSources.length > 0) {
      chunks = exactSources.map((document: any): AISearchChunk => ({
        id: document.key,
        content: document.content,
        score: 1,
        attributes: {
          filename: document.filename,
          folderId: document.folderId,
          documentId: document.documentId,
          userId,
          contentHash: document.contentHash,
          sourceRevision: document.sourceRevision,
        },
      }))
    }
  }
  if (chunks.reduce((sum, chunk) => sum + chunk.content.trim().length, 0) < minimumCharacters) {
    if (searchUnavailable || indexedRevisionUnavailable) throw createError({ statusCode: 503, message: 'Search index unavailable' })
    await assertSearchIndexAvailable()
    throw createError({ statusCode: 422, message: 'Not enough indexed content for an audio overview' })
  }
  return chunks
}

async function buildManifest(request: any) {
  const entries: Array<{
    sourceId: string
    documentId: Id<'documents'>
    revision: string
    contentHash: string
    displayReference: string
    objectKey?: string
  }> = await Promise.all(request.documents.map(async (document: any) => {
    const frozenHash = typeof document.contentHash === 'string' && /^[a-f0-9]{64}$/i.test(document.contentHash)
      ? document.contentHash.toLowerCase()
      : null
    const frozenRevision = typeof document.sourceRevision === 'string' && document.sourceRevision.trim()
      ? document.sourceRevision.trim()
      : null
    if (!frozenHash || frozenRevision !== `sha256:${frozenHash}`) {
      throw createError({ statusCode: 422, message: 'A selected source has no immutable revision; re-index it and try again' })
    }
    if (document.r2Key) {
      const currentIdentity = await getScopedR2ObjectIdentity(document.r2Key)
      if (currentIdentity.contentHash !== frozenHash || currentIdentity.revision !== frozenRevision) {
        throw createError({ statusCode: 409, message: 'A selected source changed after command reservation' })
      }
    }
    return {
      sourceId: String(document.documentId),
      documentId: document.documentId as Id<'documents'>,
      revision: frozenRevision,
      contentHash: frozenHash,
      displayReference: document.filename,
      objectKey: document.r2Key,
    }
  }))
  const contentHash = await sha256Hex(JSON.stringify(entries.map(entry => ({
    sourceId: entry.sourceId,
    revision: entry.revision,
    contentHash: entry.contentHash,
  }))))
  return { revision: `manifest-v2:${contentHash}`, contentHash, entries }
}

function sourceEntryOrders(sourceIds: string[], sourceOrder: Map<string, number>): number[] {
  return [...new Set(sourceIds.map(sourceId => sourceOrder.get(sourceId)).filter((order): order is number => order !== undefined))]
}

function exactEvidenceSpeech(claims: DialoguePlan['claims']): string {
  const selected: string[] = []
  const observed = new Set<string>()
  let spokenLength = 0
  for (const claim of claims) {
    for (const evidence of claim.evidenceQuotes) {
      const quote = evidence.quote.trim()
      if (!quote || observed.has(quote)) continue
      const separatorLength = selected.length > 0 ? 1 : 0
      if (spokenLength + separatorLength + quote.length > 2_000) {
        throw new Error('Rejected Utterance complete frozen evidence exceeds the spoken-text limit')
      }
      selected.push(quote)
      observed.add(quote)
      spokenLength += separatorLength + quote.length
    }
  }
  if (selected.length === 0) throw new Error('Rejected Utterance has no exact frozen evidence fallback')
  return selected.join(' ')
}

function groundRejectedUtterancesInFrozenEvidence(
  plan: DialoguePlan,
  rejected: Array<{ utteranceId: string, reason: string }>,
): DialoguePlan {
  const rejectedIds = new Set(rejected.map(row => row.utteranceId))
  const claimById = new Map(plan.claims.map(claim => [claim.claimId, claim] as const))
  const observed = new Set<string>()
  const scenes = plan.scenes.map((scene, sceneOrder) => ({
    ...scene,
    utterances: scene.utterances.map((utterance, utteranceOrder) => {
      const utteranceId = mainUtteranceVerificationId(scene.sceneId, sceneOrder, utteranceOrder)
      if (!rejectedIds.has(utteranceId)) return utterance
      observed.add(utteranceId)
      const claims = utterance.claimIds
        .map(claimId => claimById.get(claimId))
        .filter((claim): claim is DialoguePlan['claims'][number] => claim?.status === 'supported')
      if (claims.length === 0) throw new Error('Rejected Utterance has no supported Claim Ledger fallback')
      return {
        ...utterance,
        text: exactEvidenceSpeech(claims),
      }
    }),
  }))
  if (observed.size !== rejectedIds.size) throw new Error('Rejected Utterance identity is absent from the Dialogue Script')
  return { ...plan, scenes }
}

function rejectedEntailmentMessage(rejected: Array<{ utteranceId: string, reason: string }>): string {
  const detail = rejected
    .slice(0, 3)
    .map(row => `${row.utteranceId}: ${row.reason}`)
    .join('; ')
  return `A spoken Utterance is not semantically entailed by its frozen evidence${detail ? ` (${detail})` : ''}`
}

function planScenes(
  plan: DialoguePlan,
  sourceOrder: Map<string, number>,
  verificationByUtteranceId: Map<string, { reason: string }>,
) {
  return plan.scenes.map((scene, sceneOrder) => {
    const spokenWords = scene.utterances.reduce((sum, utterance) => sum + (utterance.text.match(/\S+/g)?.length ?? 0), 0)
    return {
      sceneId: scene.sceneId,
      title: scene.title,
      narrativePurpose: `${scene.emotionalIntent}\n${scene.delivery}`,
      targetDurationMs: Math.max(60_000, Math.min(180_000, Math.round(spokenWords / 150 * 60_000))),
      utterances: scene.utterances.map((utterance, utteranceOrder) => {
        const utteranceId = mainUtteranceVerificationId(scene.sceneId, sceneOrder, utteranceOrder)
        const verification = verificationByUtteranceId.get(utteranceId)
        if (!verification) throw new Error('Spoken Utterance has no semantic entailment verification')
        return {
          speaker: utterance.speaker,
          text: utterance.text,
          emotionalIntent: utterance.emotionalIntent,
          deliveryIntent: utterance.delivery,
          pauseAfterMs: utterance.pauseAfterMs,
          sourceEntryOrders: sourceEntryOrders(utterance.sourceIds, sourceOrder),
          claimIds: utterance.claimIds,
          verification: {
            version: CLAIM_ENTAILMENT_VERSION,
            utteranceId,
            model: SCRIPT_MODEL,
            decision: 'entailed' as const,
            reason: verification.reason,
          },
        }
      }),
    }
  })
}

async function prepare(client: ConvexHttpClient, jobId: Id<'audioOverviewJobs'>, capability: string) {
  const existing = await client.query(api.audioOverviewV2.getForWorkflow, { jobId, capability })
  if (existing) return { cancelled: false, sceneCount: existing.episode.sceneCount }
  const checked = await activeContext(client, jobId, capability)
  if (!checked.active) return { cancelled: true, sceneCount: 0 }
  const request = checked.context.request
  const progress = await client.mutation(api.audioOverviewJobs.setProgress, { jobId, capability, progress: 'Retrieving sources…', stage: 'preparing' })
  if (!progress.active) return { cancelled: true, sceneCount: 0 }
  const [chunks, manifest] = await Promise.all([
    retrieveGroundedChunks(request, checked.context.job.userId),
    buildManifest(request),
  ])
  const beforePaid = await activeContext(client, jobId, capability)
  if (!beforePaid.active) return { cancelled: true, sceneCount: 0 }
  await client.mutation(api.audioOverviewJobs.setProgress, { jobId, capability, progress: 'Writing dialogue…', stage: 'preparing' })
  const allowedSourceIds = [...new Set(chunks.map(chunk => String(chunk.attributes.documentId ?? '')).filter(Boolean))]
  let dialogueMessages = buildDialoguePlanPrompt(chunks, request.preferences)
  let dialogueTemperature = 0.45
  let plan: DialoguePlan | undefined
  let acceptedScriptAttemptId: string | undefined
  let acceptedScriptAttemptNumber = 0
  let verification: ReturnType<typeof parseClaimEntailmentResponse> | undefined
  let exactEvidenceFallbackApplied = false
  let exactEvidenceFallbackBudgetClaimed = false
  while (!verification) {
    while (!plan) {
      const scriptAttempt = await client.mutation(api.audioOverviewJobs.beginScriptGeneration, { jobId, capability })
      if (!scriptAttempt.proceed) {
        const current = await client.query(api.audioOverviewV2.getForWorkflow, { jobId, capability })
        if (current) return { cancelled: false, sceneCount: current.episode.sceneCount }
        if (scriptAttempt.cancelled) return { cancelled: true, sceneCount: 0 }
        throw createError({ statusCode: 409, message: 'Dialogue generation outcome is ambiguous; refusing a duplicate provider call' })
      }

      let completion: Awaited<ReturnType<typeof generateCompletion>>
      try {
        completion = await generateCompletion({
          model: SCRIPT_MODEL,
          messages: dialogueMessages,
          temperature: dialogueTemperature,
          max_tokens: dialoguePlanMaxTokens(request.preferences.lengthMinutes),
          maxAttempts: 1,
          jsonSchema: {
            name: 'audio_overview_dialogue_plan',
            strict: true,
            schema: buildDialoguePlanJsonSchema(request.preferences),
          },
        })
      }
      catch (error) {
        // An HTTP response is a definitive provider outcome. A transport failure
        // has no status and keeps the marker so a potentially billable call is not
        // repeated.
        if (errorStatus(error) > 0) {
          await client.mutation(api.audioOverviewJobs.releaseScriptGeneration, { jobId, capability, attemptId: scriptAttempt.attemptId })
        }
        throw error
      }

      try {
        plan = parseDialoguePlanResponse(
          requireCompleteJsonContent(completion, 'Dialogue Script'),
          allowedSourceIds,
          chunks,
          request.preferences,
        )
        acceptedScriptAttemptId = scriptAttempt.attemptId
        acceptedScriptAttemptNumber = scriptAttempt.attempt
      }
      catch (error) {
        if (isDialoguePlanDurationError(error)) {
          if (scriptAttempt.attempt < 3) {
            // The response arrived and was conclusively rejected, so a bounded
            // replacement provider attempt is safe and explicitly debited.
            await client.mutation(api.audioOverviewJobs.releaseScriptGeneration, { jobId, capability, attemptId: scriptAttempt.attemptId })
            dialogueMessages = buildDialoguePlanDurationRepairPrompt(
              error.plan,
              request.preferences,
              error.actualWords,
              scriptAttempt.attempt,
            )
            dialogueTemperature = 0
            continue
          }
          try {
            const compacted = compactDialoguePlanDuration(error.plan, request.preferences)
            plan = parseDialoguePlanResponse(
              JSON.stringify(compacted),
              allowedSourceIds,
              chunks,
              request.preferences,
            )
            acceptedScriptAttemptId = scriptAttempt.attemptId
            acceptedScriptAttemptNumber = scriptAttempt.attempt
            continue
          }
          catch (compactionError) {
            await client.mutation(api.audioOverviewJobs.releaseScriptGeneration, { jobId, capability, attemptId: scriptAttempt.attemptId })
            throw compactionError
          }
        }
        // The response arrived and was conclusively rejected, so a bounded new
        // attempt is safe. beginScriptGeneration debits that replacement attempt.
        await client.mutation(api.audioOverviewJobs.releaseScriptGeneration, { jobId, capability, attemptId: scriptAttempt.attemptId })
        if (isDialoguePlanEvidenceError(error) && scriptAttempt.attempt < 3) {
          dialogueMessages = buildDialoguePlanEvidenceRepairPrompt(
            error.plan,
            chunks,
            error.invalidEvidence,
          )
          dialogueTemperature = 0
          continue
        }
        throw error
      }
    }

    const supportedClaimById = new Map(plan.claims
      .filter(claim => claim.status === 'supported')
      .map(claim => [claim.claimId, claim] as const))
    const entailmentInput = plan.scenes.flatMap((scene, sceneOrder) => scene.utterances.map((utterance, utteranceOrder) => ({
      utteranceId: mainUtteranceVerificationId(scene.sceneId, sceneOrder, utteranceOrder),
      sceneId: scene.sceneId,
      sceneOrder,
      utteranceOrder,
      text: utterance.text,
      claims: utterance.claimIds.map((claimId) => {
        const claim = supportedClaimById.get(claimId)
        if (!claim) throw new Error('Spoken Utterance references an unavailable supported claim')
        return { claimId: claim.claimId, text: claim.text, evidenceQuotes: claim.evidenceQuotes }
      }),
    })))
    if (exactEvidenceFallbackApplied && !exactEvidenceFallbackBudgetClaimed) {
      const budget = await client.mutation(api.audioOverviewJobs.claimProviderBudget, {
        jobId,
        capability,
        kind: 'entailment-fallback',
      })
      if (!budget.allowed) return { cancelled: true, sceneCount: 0 }
      exactEvidenceFallbackBudgetClaimed = true
    }
    const verificationDecisions: ReturnType<typeof parseClaimEntailmentResponse>['decisions'] = []
    try {
      for (const batch of batchClaimEntailmentInputs(entailmentInput)) {
        const completion = await generateCompletion({
          model: SCRIPT_MODEL,
          messages: buildClaimEntailmentPrompt(batch),
          temperature: 0,
          max_tokens: Math.max(800, batch.length * 180),
          maxAttempts: 1,
          jsonSchema: {
            name: 'audio_overview_claim_entailment',
            strict: true,
            schema: buildClaimEntailmentJsonSchema(batch.length),
          },
        })
        const parsedBatch = parseClaimEntailmentResponse(
          requireCompleteJsonContent(completion, 'Claim entailment response'),
          batch,
        )
        verificationDecisions.push(...parsedBatch.decisions)
      }
    }
    catch (error) {
      await client.mutation(api.audioOverviewJobs.releaseScriptGeneration, { jobId, capability, attemptId: acceptedScriptAttemptId! })
      throw error
    }
    const candidateVerification: ReturnType<typeof parseClaimEntailmentResponse> = {
      version: CLAIM_ENTAILMENT_VERSION,
      decisions: verificationDecisions,
    }
    const rejected = candidateVerification.decisions
      .filter(decision => decision.decision === 'not_entailed')
      .map(decision => ({ utteranceId: decision.utteranceId, reason: decision.reason }))
    if (rejected.length > 0) {
      await client.mutation(api.audioOverviewJobs.releaseScriptGeneration, { jobId, capability, attemptId: acceptedScriptAttemptId! })
      if (acceptedScriptAttemptNumber < 3) {
        dialogueMessages = buildDialoguePlanEntailmentRepairPrompt(plan, rejected)
        dialogueTemperature = 0
        plan = undefined
        acceptedScriptAttemptId = undefined
        continue
      }
      if (exactEvidenceFallbackApplied) throw new Error(rejectedEntailmentMessage(rejected))
      const groundedPlan = groundRejectedUtterancesInFrozenEvidence(plan, rejected)
      try {
        plan = parseDialoguePlanResponse(
          JSON.stringify(groundedPlan),
          allowedSourceIds,
          chunks,
          request.preferences,
        )
      }
      catch (error) {
        if (!isDialoguePlanDurationError(error)) throw error
        plan = parseDialoguePlanResponse(
          JSON.stringify(compactDialoguePlanDuration(error.plan, request.preferences)),
          allowedSourceIds,
          chunks,
          request.preferences,
        )
      }
      exactEvidenceFallbackApplied = true
      continue
    }
    verification = candidateVerification
  }
  if (!plan) throw new Error('Verified Dialogue Script is unavailable')
  const verificationByUtteranceId = new Map(verification.decisions.map(decision => [decision.utteranceId, decision]))
  const verificationByClaimId = new Map<string, { reason: string }>()
  for (const decision of verification.decisions) {
    for (const claimId of decision.claimIds) {
      if (!verificationByClaimId.has(claimId)) verificationByClaimId.set(claimId, decision)
    }
  }
  const orderBySource = new Map(manifest.entries.map((entry, order) => [entry.sourceId, order]))
  const claims = plan.claims.map((claim) => {
    const claimVerification = claim.status === 'supported' ? verificationByClaimId.get(claim.claimId) : undefined
    if (claim.status === 'supported' && !claimVerification) {
      throw new Error('Supported Claim Ledger entry is not bound to a verified spoken Utterance')
    }
    return {
      claimId: claim.claimId,
      text: claim.text,
      status: claim.status,
      sourceEntryOrders: sourceEntryOrders(claim.sourceIds, orderBySource),
      verification: claimVerification
        ? {
            version: CLAIM_ENTAILMENT_VERSION,
            model: SCRIPT_MODEL,
            decision: 'entailed' as const,
            reason: claimVerification.reason,
          }
        : undefined,
    }
  })
  const scenes = planScenes(plan, orderBySource, verificationByUtteranceId)
  const planFingerprint = await sha256Hex(JSON.stringify({
    manifest: manifest.contentHash,
    model: SCRIPT_MODEL,
    audioProfile: AUDIO_OVERVIEW_PROFILE_V1,
    plan,
    groundingVerification: verification,
  }))
  let commitError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await client.mutation(api.audioOverviewV2.createPlan, {
        jobId,
        capability,
        planFingerprint,
        title: plan.title,
        model: SCRIPT_MODEL,
        audioProfile: {
          id: AUDIO_OVERVIEW_PROFILE_V1.id,
          version: String(AUDIO_OVERVIEW_PROFILE_V1.version),
          renderer: AUDIO_OVERVIEW_PROFILE_V1.renderer,
          hostAVoice: AUDIO_OVERVIEW_PROFILE_V1.hostA.voiceName,
          hostBVoice: AUDIO_OVERVIEW_PROFILE_V1.hostB.voiceName,
        },
        manifest,
        outline: {
          narrativeArc: plan.outline.narrativeArc.join('\n'),
          learningObjectives: plan.outline.learningObjectives,
          plannedSourceIds: plan.outline.plannedSourceIds,
        },
        claims,
        scenes,
      })
      await client.mutation(api.audioOverviewJobs.setProgress, { jobId, capability, progress: `Synthesizing scene 1/${scenes.length}…`, stage: 'synthesizing' })
      return { cancelled: false, sceneCount: scenes.length }
    }
    catch (error) { commitError = error }
  }
  throw commitError
}

async function sceneContext(client: ConvexHttpClient, jobId: Id<'audioOverviewJobs'>, capability: string, sceneOrder: number) {
  const checked = await activeContext(client, jobId, capability)
  if (!checked.active) return { cancelled: true }
  const context = await client.query(api.audioOverviewV2.getForWorkflow, { jobId, capability })
  const scene = context?.scenes.find(row => row.order === sceneOrder)
  if (!context || !scene) throw createError({ statusCode: 404, message: 'Audio overview Scene not found' })
  const utterances = context.utterances
    .filter(row => row.sceneId === scene._id)
    .sort((left, right) => left.sceneOrder - right.sceneOrder)
    .map(row => ({ speaker: row.speaker, text: row.text, emotionalIntent: row.emotionalIntent, deliveryIntent: row.deliveryIntent, pauseAfterMs: row.pauseAfterMs }))
  return {
    cancelled: false,
    scene: {
      sceneId: String(scene._id),
      title: scene.title,
      direction: scene.narrativePurpose,
      expectedDurationMs: scene.targetDurationMs,
      utterances,
    },
  }
}

async function claimRenderBudget(
  client: ConvexHttpClient,
  jobId: Id<'audioOverviewJobs'>,
  capability: string,
  sceneOrder: number,
  attempt: number,
) {
  return await client.mutation(api.audioOverviewJobs.claimProviderBudget, {
    jobId,
    capability,
    kind: 'scene',
    sceneOrder,
    attempt,
  })
}

function accepted(gate: QualityGate, code: string): boolean {
  return gate.checks.some(check => check.code === code && check.outcome === 'accepted')
}

async function commitScene(client: ConvexHttpClient, jobId: Id<'audioOverviewJobs'>, capability: string, sceneOrder: number, artifact: SceneArtifact, gate: QualityGate) {
  const checked = await activeContext(client, jobId, capability)
  if (!checked.active) return { cancelled: true }
  const context = await client.query(api.audioOverviewV2.getForWorkflow, { jobId, capability })
  const scene = context?.scenes.find(row => row.order === sceneOrder)
  if (!context || !scene || artifact.sceneId !== String(scene._id) || artifact.sceneOrder !== sceneOrder) {
    throw createError({ statusCode: 400, message: 'Scene artifact does not match the frozen Dialogue Script' })
  }
  if (!Number.isInteger(artifact.attempt) || artifact.attempt < 1 || artifact.attempt > 3) {
    throw createError({ statusCode: 400, message: 'Scene artifact attempt is invalid' })
  }
  const profileMatches = artifact.model === AUDIO_OVERVIEW_PROFILE_V1.model
    && artifact.audioProfileId === AUDIO_OVERVIEW_PROFILE_V1.id
    && artifact.audioProfileVersion === String(AUDIO_OVERVIEW_PROFILE_V1.version)
    && artifact.format.encoding === AUDIO_OVERVIEW_PROFILE_V1.format.encoding
    && artifact.format.sampleRateHz === AUDIO_OVERVIEW_PROFILE_V1.format.sampleRateHz
    && artifact.format.bitDepth === AUDIO_OVERVIEW_PROFILE_V1.format.bitDepth
    && artifact.format.channels === AUDIO_OVERVIEW_PROFILE_V1.format.channels
  if (!profileMatches) throw createError({ statusCode: 400, message: 'Scene artifact uses an unsupported Audio Profile' })
  const sceneUtterances = context.utterances.filter(row => row.sceneId === scene._id)
  const scriptedSpeakerPairValid = new Set(sceneUtterances.map(row => row.speaker)).size === 2
  const supportedClaimRecords = new Set(context.claims.filter(claim => claim.status === 'supported').map(claim => String(claim._id)))
  const claimsSupported = context.utteranceClaims
    .filter(link => sceneUtterances.some(row => row._id === link.utteranceId))
    .every(link => supportedClaimRecords.has(String(link.claimRecordId)))
  const passed = gate.decision === 'accepted' && profileMatches && scriptedSpeakerPairValid && claimsSupported
  const firstFailure = gate.checks.find(check => check.outcome === 'rejected')
  if (scene.status === 'ready' && scene.audioArtifactId) {
    const existingArtifact = context.artifacts.find(row => row._id === scene.audioArtifactId)
    if (!existingArtifact || existingArtifact.objectKey !== artifact.r2Key || existingArtifact.checksumSha256 !== artifact.sha256) {
      throw createError({ statusCode: 409, message: 'Completed Scene artifact changed during Workflow replay' })
    }
    return { cancelled: false, duplicate: true }
  }
  const result = await client.mutation(api.audioOverviewV2.recordSceneEvaluation, {
    jobId,
    capability,
    sceneId: scene._id,
    attempt: artifact.attempt,
    passed,
    artifact: {
      objectKey: artifact.r2Key,
      etag: artifact.etag,
      checksumSha256: artifact.sha256,
      byteLength: artifact.byteLength,
      contentType: artifact.contentType,
      container: 'pcm' as const,
      sampleRateHz: 24000 as const,
      channelCount: 1 as const,
      bitsPerSample: 16 as const,
      durationMs: artifact.durationMs,
    },
    checks: {
      claimsSupported,
      scriptedSpeakerPairValid,
      audioProfileMatches: profileMatches,
      // Workers AI Whisper provides text, not diarization or voice embeddings.
      // Persist the evidence boundary instead of relabeling configuration as
      // an acoustic measurement. G11 listening proof remains required.
      speakerCountEvidence: 'not_measured' as const,
      speakerConsistencyEvidence: 'not_measured' as const,
      durationWithinTolerance: accepted(gate, 'minimum-duration') && accepted(gate, 'maximum-duration'),
      silenceWithinTolerance: accepted(gate, 'silence-ratio'),
      clippingWithinTolerance: accepted(gate, 'clipping-ratio'),
      truncationFree: accepted(gate, 'minimum-duration') && accepted(gate, 'complete-pcm-frames'),
      tempoWithinTolerance: accepted(gate, 'minimum-duration') && accepted(gate, 'maximum-duration'),
      directionsNotSpoken: accepted(gate, 'unspoken-delivery-directions'),
      transcriptDivergence: gate.metrics.transcriptDivergence,
      transcriptDivergenceThreshold: gate.metrics.transcriptDivergenceThreshold,
    },
    failureCode: passed ? undefined : firstFailure?.code ?? 'scene-contract',
    failureMessage: passed ? undefined : firstFailure?.message ?? 'Scene failed its production contract',
  })
  const completed = context.scenes.filter(row => row.status === 'ready').length + (passed && scene.status !== 'ready' ? 1 : 0)
  await client.mutation(api.audioOverviewJobs.setProgress, {
    jobId,
    capability,
    progress: !passed
      ? `Retrying scene ${sceneOrder + 1}/${context.episode.sceneCount}…`
      : completed < context.episode.sceneCount
        ? `Synthesizing scene ${completed + 1}/${context.episode.sceneCount}…`
        : 'Finalizing audio overview…',
    stage: passed && completed >= context.episode.sceneCount ? 'finalizing' : 'synthesizing',
  })
  return { cancelled: false, ...result }
}

async function publish(client: ConvexHttpClient, jobId: Id<'audioOverviewJobs'>, capability: string, artifact: FinalArtifact) {
  const result = await client.mutation(api.audioOverviewV2.publishFinalArtifact, {
    jobId,
    capability,
    artifact: {
      objectKey: artifact.r2Key,
      etag: artifact.etag,
      checksumSha256: artifact.sha256,
      byteLength: artifact.byteLength,
      contentType: artifact.contentType,
      container: 'wav' as const,
      sampleRateHz: 24000 as const,
      channelCount: 1 as const,
      bitsPerSample: 16 as const,
      durationMs: artifact.durationMs,
    },
    alignment: { aligner: '@cf/openai/whisper', alignerVersion: 'workers-ai' },
  })
  return { cancelled: false, ...result }
}

function wavFromPcm(pcm: Uint8Array): Uint8Array {
  const output = new Uint8Array(44 + pcm.byteLength)
  const view = new DataView(output.buffer)
  const text = (offset: number, value: string) => value.split('').forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, 36 + pcm.byteLength, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 24_000, true); view.setUint32(28, 48_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, pcm.byteLength, true); output.set(pcm, 44)
  return output
}

async function align(client: ConvexHttpClient, jobId: Id<'audioOverviewJobs'>, capability: string) {
  const context = await client.query(api.audioOverviewV2.getForWorkflow, { jobId, capability })
  if (!context?.alignment || context.alignment.status !== 'pending') return { skipped: true }
  try {
    const finalArtifact = context.artifacts.find(row => row._id === context.episode.finalArtifactId)
    if (!finalArtifact) throw new Error('Published Audio Artifact is unavailable for Alignment')
    await client.mutation(api.audioOverviewJobs.claimProviderBudget, {
      jobId,
      capability,
      kind: 'alignment',
    })
    const segments: Array<{ utteranceId: Id<'audioOverviewUtterances'>, wordIndex: number, word: string, startMs: number, endMs: number, confidence?: number }> = []
    let sceneOffsetMs = 0
    for (const scene of [...context.scenes].sort((left, right) => left.order - right.order)) {
      const artifact = context.artifacts.find(row => row._id === scene.audioArtifactId)
      if (!artifact || !scene.durationMs) throw new Error('Published Scene media is unavailable for alignment')
      const response = await fetchPrivateR2Object(artifact.objectKey)
      if (!response.ok) throw new Error(`Published Scene media returned ${response.status}`)
      const pcm = new Uint8Array(await response.arrayBuffer())
      const transcription = await transcribeAudio(wavFromPcm(pcm))
      if (transcription.words.length === 0) throw new Error('Alignment provider returned no word timings')
      const utterances = context.utterances.filter(row => row.sceneId === scene._id).sort((left, right) => left.sceneOrder - right.sceneOrder)
      segments.push(...alignRecognizedWordsToScript({
        utterances: utterances.map(row => ({ utteranceId: String(row._id), text: row.text })),
        recognizedWords: transcription.words,
        sceneOffsetMs,
        sceneDurationMs: scene.durationMs,
      }).map(row => ({ ...row, utteranceId: row.utteranceId as Id<'audioOverviewUtterances'> })))
      sceneOffsetMs += scene.durationMs
    }
    if (segments.length === 0) throw new Error('Alignment produced no script timing records')
    for (let offset = 0; offset < segments.length; offset += 100) {
      await client.mutation(api.audioOverviewV2.appendAlignmentSegments, {
        jobId,
        capability,
        alignmentId: context.alignment._id,
        segments: segments.slice(offset, offset + 100),
      })
    }
    await client.mutation(api.audioOverviewV2.completeAlignment, { jobId, capability, alignmentId: context.alignment._id })
    return { skipped: false }
  }
  catch (error) {
    await client.mutation(api.audioOverviewV2.failAlignment, {
      jobId,
      capability,
      alignmentId: context.alignment._id,
      error: error instanceof Error ? error.message : 'Audio alignment failed',
    })
    return { skipped: true }
  }
}

export default defineEventHandler(async (event) => {
  const capability = getRequestHeader(event, 'x-budds-job-capability')?.trim()
  const body = await readBody<StepBody>(event)
  if (!capability || !body?.jobId || !body.stage) throw createError({ statusCode: 400, message: 'Job capability, ID, and stage are required' })
  if (!['prepare', 'scene-context', 'claim-render', 'commit-scene', 'publish', 'align', 'fail'].includes(body.stage)) {
    throw createError({ statusCode: 400, message: 'Invalid audio overview job stage' })
  }
  const client = makeJobClient(event)
  const jobId = body.jobId as Id<'audioOverviewJobs'>
  try {
    if (body.stage === 'prepare') return { ok: true, ...await prepare(client, jobId, capability) }
    if (body.stage === 'scene-context') {
      if (!Number.isInteger(body.sceneOrder) || body.sceneOrder! < 0) throw createError({ statusCode: 400, message: 'sceneOrder is required' })
      return { ok: true, ...await sceneContext(client, jobId, capability, body.sceneOrder!) }
    }
    if (body.stage === 'claim-render') {
      if (!Number.isInteger(body.sceneOrder) || body.sceneOrder! < 0
        || !Number.isInteger(body.attempt) || body.attempt! < 1) {
        throw createError({ statusCode: 400, message: 'Scene render budget claim is invalid' })
      }
      return {
        ok: true,
        ...await claimRenderBudget(client, jobId, capability, body.sceneOrder!, body.attempt!),
      }
    }
    if (body.stage === 'commit-scene') {
      if (!Number.isInteger(body.sceneOrder) || body.sceneOrder! < 0 || !body.artifact || !body.qualityGate || !('sceneId' in body.artifact)) {
        throw createError({ statusCode: 400, message: 'Scene artifact and Quality Gate are required' })
      }
      return { ok: true, ...await commitScene(client, jobId, capability, body.sceneOrder!, body.artifact, body.qualityGate) }
    }
    if (body.stage === 'publish') {
      if (!body.artifact || !('sceneCount' in body.artifact)) throw createError({ statusCode: 400, message: 'Final Audio Artifact is required' })
      return { ok: true, ...await publish(client, jobId, capability, body.artifact) }
    }
    if (body.stage === 'align') return { ok: true, ...await align(client, jobId, capability) }
    if (body.stage === 'fail') return { ok: true, ...await client.mutation(api.audioOverviewJobs.fail, { jobId, capability, error: body.error ?? 'Audio overview Workflow failed' }) }
    throw createError({ statusCode: 400, message: 'Invalid audio overview job stage' })
  }
  catch (error: unknown) {
    console.error('[audio-overview/jobs/step] failed', body.stage, error)
    return { ok: false, ...classifyRetry(error) }
  }
})
