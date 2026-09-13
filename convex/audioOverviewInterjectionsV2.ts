import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, mutation, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { interjectionUtteranceVerificationId } from '../shared/audio-overview-grounding'
import { AUDIO_OVERVIEW_PROFILE_CURRENT } from '../shared/audio-overview-profile'
import { getOptionalAuthUserId, requireAuth } from './lib/auth'
import { AUDIO_OVERVIEW_MAX_EXPLICIT_SOURCES, todayUtcYmd } from './lib/audioOverviewPolicy'
import { requireAudioOverviewOrchestrationCredential } from './lib/audioOverviewOrchestrationAuth'

const MAX_UTTERANCES = 4
const MAX_SOURCES_PER_UTTERANCE = 4
const MAX_INTERJECTIONS_PER_EPISODE = 20
const DAILY_INTERJECTION_CAP = 10
const INTERJECTION_BUDGET_RESERVATION_MICROUSD = 40_000
const INTERJECTION_SCRIPT_PLAN_ESTIMATE_MICROUSD = 800
const INTERJECTION_ENTAILMENT_ESTIMATE_MICROUSD = 200
const INTERJECTION_SCRIPT_ESTIMATE_MICROUSD
  = INTERJECTION_SCRIPT_PLAN_ESTIMATE_MICROUSD + INTERJECTION_ENTAILMENT_ESTIMATE_MICROUSD
const INTERJECTION_TTS_ESTIMATE_MICROUSD_PER_SECOND = 250
const MAX_INTERJECTION_DURATION_MS = 2 * 60_000
const SCRIPTING_ATTEMPT_TTL_MS = 5 * 60_000
const RENDER_ATTEMPT_TTL_MS = 10 * 60_000
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/
const SHA256 = /^[a-f0-9]{64}$/
const CANONICAL_PROFILE = {
  id: AUDIO_OVERVIEW_PROFILE_CURRENT.id,
  version: String(AUDIO_OVERVIEW_PROFILE_CURRENT.version),
  renderer: AUDIO_OVERVIEW_PROFILE_CURRENT.renderer,
  hostAVoice: AUDIO_OVERVIEW_PROFILE_CURRENT.hostA.voiceName,
  hostBVoice: AUDIO_OVERVIEW_PROFILE_CURRENT.hostB.voiceName,
} as const

const utteranceInput = v.object({
  speaker: v.union(v.literal('host_a'), v.literal('host_b')),
  text: v.string(),
  sourceIds: v.array(v.string()),
  claimId: v.optional(v.string()),
  claimText: v.optional(v.string()),
  evidenceQuotes: v.optional(v.array(v.object({ sourceId: v.string(), quote: v.string() }))),
  verification: v.optional(v.object({
    version: v.literal('claim-entailment.v1'),
    utteranceId: v.string(),
    model: v.string(),
    decision: v.literal('entailed'),
    reason: v.string(),
  })),
})

const artifactInput = v.object({
  objectKey: v.string(),
  etag: v.optional(v.string()),
  checksumSha256: v.string(),
  byteLength: v.number(),
  contentType: v.string(),
  durationMs: v.number(),
})

function boundedText(value: string, field: string, maximum: number): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > maximum) throw new Error(`Invalid ${field}`)
  return normalized
}

function isCompatibleProfile(episode: Doc<'audioOverviewEpisodes'>): boolean {
  return episode.audioProfileId === CANONICAL_PROFILE.id
    && episode.audioProfileVersion === CANONICAL_PROFILE.version
    && episode.renderer === CANONICAL_PROFILE.renderer
    && episode.hostAVoice === CANONICAL_PROFILE.hostAVoice
    && episode.hostBVoice === CANONICAL_PROFILE.hostBVoice
}

async function requireOwnedInterjection(
  ctx: QueryCtx | MutationCtx,
  interjectionId: Id<'audioOverviewInterjectionsV2'>,
  userId: string,
) {
  const interjection = await ctx.db.get(interjectionId)
  if (!interjection || interjection.userId !== userId) throw new Error('Interjection not found')
  return interjection
}

async function manifestEntries(ctx: QueryCtx | MutationCtx, manifestId: Id<'audioOverviewSourceManifests'>) {
  const rows = await ctx.db
    .query('audioOverviewSourceManifestEntries')
    .withIndex('by_manifestId_and_order', q => q.eq('manifestId', manifestId))
    .take(AUDIO_OVERVIEW_MAX_EXPLICIT_SOURCES + 1)
  if (rows.length < 1 || rows.length > AUDIO_OVERVIEW_MAX_EXPLICIT_SOURCES) throw new Error('Frozen Source Manifest is unavailable')
  return rows
}

function sourceProjection(entries: Doc<'audioOverviewSourceManifestEntries'>[]) {
  return entries.map(entry => ({
    sourceId: entry.sourceId,
    documentId: entry.documentId,
    revision: entry.revision,
    contentHash: entry.contentHash,
    displayReference: entry.displayReference,
  }))
}

/** Planning estimate only, not an invoice: $0.0008 plan + $0.0002 entailment + $0.00025/TTS second. */
function estimateInterjectionCostMicrousd(durationMs: number): number {
  return INTERJECTION_SCRIPT_ESTIMATE_MICROUSD
    + Math.ceil(durationMs / 1_000) * INTERJECTION_TTS_ESTIMATE_MICROUSD_PER_SECOND
}

async function stageDeterministicArtifactCleanup(
  ctx: MutationCtx,
  interjection: Doc<'audioOverviewInterjectionsV2'>,
) {
  const objectKey = `audio-overviews/jobs/${interjection.jobId}/interjections/${interjection._id}.wav`
  const existingCleanup = await ctx.db
    .query('pendingCleanup')
    .withIndex('by_r2Key', q => q.eq('r2Key', objectKey))
    .unique()
  if (!existingCleanup) {
    await ctx.db.insert('pendingCleanup', {
      userId: interjection.userId,
      documentId: `audio-interjection:${interjection._id}`,
      r2Key: objectKey,
      kind: 'r2',
      attempts: 0,
    })
  }
  await ctx.scheduler.runAfter(0, internal.accountDeletion.drainPendingCleanup, { userId: interjection.userId })
  return objectKey
}

export const reserve = mutation({
  args: {
    audioOverviewId: v.id('audioOverviews'),
    idempotencyKey: v.string(),
    insertedAfterTurnIndex: v.number(),
    question: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const overview = await ctx.db.get(args.audioOverviewId)
    if (!overview || overview.userId !== userId) throw new Error('Audio overview not found')
    if (overview.status !== 'ready' || !overview.episodeId || !overview.finalArtifactId) {
      throw new Error('Version 2 Audio Overview is not ready')
    }
    const episode = await ctx.db.get(overview.episodeId)
    if (!episode
      || episode.userId !== userId
      || episode.status !== 'ready'
      || episode.compatibilityOverviewId !== overview._id
      || episode.finalArtifactId !== overview.finalArtifactId) {
      throw new Error('Version 2 Audio Overview is not ready')
    }
    if (!isCompatibleProfile(episode)) throw new Error('Audio Overview uses an incompatible Audio Profile')
    if (!IDEMPOTENCY_KEY.test(args.idempotencyKey)) throw new Error('Invalid interjection idempotency key')
    const question = boundedText(args.question, 'interjection question', 500)
    if (!Number.isSafeInteger(args.insertedAfterTurnIndex)) throw new Error('Invalid interjection position')
    const entries = await manifestEntries(ctx, episode.sourceManifestId)
    const manifest = await ctx.db.get(episode.sourceManifestId)
    if (!manifest
      || manifest.userId !== userId
      || manifest.jobId !== episode.jobId
      || manifest.entryCount !== entries.length) {
      throw new Error('Frozen Source Manifest is unavailable')
    }
    const existing = await ctx.db
      .query('audioOverviewInterjectionsV2')
      .withIndex('by_userId_and_audioOverviewId_and_idempotencyKey', q => q
        .eq('userId', userId)
        .eq('audioOverviewId', overview._id)
        .eq('idempotencyKey', args.idempotencyKey))
      .unique()
    if (existing) {
      if (existing.question !== question) throw new Error('Interjection idempotency key was already used')
      return {
        duplicate: true,
        interjectionId: existing._id,
        status: existing.status,
        sourceManifestId: manifest._id,
        jobId: existing.jobId,
        sources: sourceProjection(entries),
        hostAVoice: existing.hostAVoice,
        hostBVoice: existing.hostBVoice,
        quota: { date: existing.quotaDate, cap: DAILY_INTERJECTION_CAP },
        budget: { reservedMicrousd: existing.budgetReservedMicrousd ?? INTERJECTION_BUDGET_RESERVATION_MICROUSD },
      }
    }
    const episodeInterjections = await ctx.db
      .query('audioOverviewInterjectionsV2')
      .withIndex('by_episodeId', q => q.eq('episodeId', episode._id))
      .take(MAX_INTERJECTIONS_PER_EPISODE)
    if (episodeInterjections.length >= MAX_INTERJECTIONS_PER_EPISODE) {
      throw new Error('Audio Overview has reached its Interjection limit')
    }
    const user = await ctx.db
      .query('users')
      .withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId))
      .unique()
    if (!user) throw new Error('User account is unavailable')
    const quotaDate = todayUtcYmd()
    const quotaUsed = user.audioOverviewInterjectionQuota?.date === quotaDate
      ? user.audioOverviewInterjectionQuota.count
      : 0
    if (quotaUsed >= DAILY_INTERJECTION_CAP) {
      throw new Error('User has reached the daily Interjection limit')
    }
    const now = Date.now()
    const interjectionId = await ctx.db.insert('audioOverviewInterjectionsV2', {
      audioOverviewId: overview._id,
      episodeId: episode._id,
      sourceManifestId: manifest._id,
      jobId: episode.jobId,
      userId,
      idempotencyKey: args.idempotencyKey,
      insertedAfterTurnIndex: Math.max(0, Math.min(args.insertedAfterTurnIndex, episode.utteranceCount)),
      question,
      model: 'gemini-2.5-flash',
      audioProfileId: CANONICAL_PROFILE.id,
      audioProfileVersion: CANONICAL_PROFILE.version,
      renderer: CANONICAL_PROFILE.renderer,
      hostAVoice: CANONICAL_PROFILE.hostAVoice,
      hostBVoice: CANONICAL_PROFILE.hostBVoice,
      status: 'reserved',
      utteranceCount: 0,
      quotaDate,
      budgetReservedMicrousd: INTERJECTION_BUDGET_RESERVATION_MICROUSD,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.patch(user._id, {
      audioOverviewInterjectionQuota: { date: quotaDate, count: quotaUsed + 1 },
    })
    return {
      duplicate: false,
      interjectionId,
      status: 'reserved' as const,
      sourceManifestId: manifest._id,
      jobId: episode.jobId,
      sources: sourceProjection(entries),
      hostAVoice: CANONICAL_PROFILE.hostAVoice,
      hostBVoice: CANONICAL_PROFILE.hostBVoice,
      quota: { used: quotaUsed + 1, cap: DAILY_INTERJECTION_CAP, date: quotaDate },
      budget: { reservedMicrousd: INTERJECTION_BUDGET_RESERVATION_MICROUSD },
    }
  },
})

/** Atomically elects one synchronous request to perform the paid script step. */
export const claimScripting = mutation({
  args: { interjectionId: v.id('audioOverviewInterjectionsV2'), orchestrationToken: v.string() },
  handler: async (ctx, args) => {
    requireAudioOverviewOrchestrationCredential(args.orchestrationToken)
    const userId = await requireAuth(ctx)
    const interjection = await requireOwnedInterjection(ctx, args.interjectionId, userId)
    if (interjection.status !== 'reserved') {
      return { claimed: false, status: interjection.status }
    }
    const claimedAt = Date.now()
    await ctx.db.patch(interjection._id, { status: 'scripting', scriptingClaimedAt: claimedAt, updatedAt: claimedAt })
    await ctx.scheduler.runAfter(SCRIPTING_ATTEMPT_TTL_MS, internal.audioOverviewInterjectionsV2.expireStaleAttempt, {
      interjectionId: interjection._id,
      phase: 'scripting',
      claimedAt,
    })
    return { claimed: true, status: 'scripting' as const }
  },
})

export const startRendering = mutation({
  args: {
    interjectionId: v.id('audioOverviewInterjectionsV2'),
    orchestrationToken: v.string(),
    utterances: v.array(utteranceInput),
  },
  handler: async (ctx, args) => {
    requireAudioOverviewOrchestrationCredential(args.orchestrationToken)
    const userId = await requireAuth(ctx)
    const interjection = await requireOwnedInterjection(ctx, args.interjectionId, userId)
    if (interjection.status === 'cancelled' || interjection.status === 'deleting') throw new Error('Interjection was cancelled')
    if (interjection.status === 'failed') throw new Error('Interjection has failed')
    if (interjection.status === 'ready') throw new Error('Interjection is already ready')
    if (interjection.status === 'reserved') throw new Error('Interjection scripting was not claimed')
    if (args.utterances.length < 2 || args.utterances.length > MAX_UTTERANCES) {
      throw new Error('Interjection Dialogue Script requires 2 to 4 Utterances')
    }
    const entries = await manifestEntries(ctx, interjection.sourceManifestId)
    const entryBySourceId = new Map(entries.map(entry => [entry.sourceId, entry]))
    const normalized = args.utterances.map((utterance, index) => {
      if (utterance.speaker !== (index % 2 === 0 ? 'host_a' : 'host_b')) {
        throw new Error('Interjection Dialogue Script must alternate both Hosts beginning with Host A')
      }
      const text = boundedText(utterance.text, 'interjection Utterance', 1_800)
      const sourceIds = [...new Set(utterance.sourceIds.map(sourceId => sourceId.trim()))]
      if (sourceIds.length < 1 || sourceIds.length > MAX_SOURCES_PER_UTTERANCE
        || sourceIds.some(sourceId => !entryBySourceId.has(sourceId))) {
        throw new Error('Interjection source is outside the frozen Source Manifest')
      }
      if (!utterance.claimId || !utterance.claimText || !utterance.evidenceQuotes?.length || !utterance.verification) {
        throw new Error('Every Interjection Utterance requires verified claim evidence')
      }
      const claimId = boundedText(utterance.claimId, 'interjection claim identity', 80)
      const claimText = boundedText(utterance.claimText, 'interjection claim text', 1_000)
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(claimId)
        || utterance.evidenceQuotes.length > MAX_SOURCES_PER_UTTERANCE
        || utterance.verification.version !== 'claim-entailment.v1'
        || utterance.verification.decision !== 'entailed') {
        throw new Error('Every Interjection Utterance requires verified claim evidence')
      }
      const expectedVerificationId = interjectionUtteranceVerificationId(String(interjection._id), index)
      if (utterance.verification.utteranceId !== expectedVerificationId) {
        throw new Error('Every Interjection Utterance requires exact semantic entailment verification')
      }
      const evidenceQuotes = utterance.evidenceQuotes.map((evidence) => {
        const sourceId = evidence.sourceId.trim()
        const quote = boundedText(evidence.quote, 'interjection evidence quote', 500)
        if (quote.length < 8 || !sourceIds.includes(sourceId)) {
          throw new Error('Interjection evidence quotes do not match its source links')
        }
        return { sourceId, quote }
      })
      if (new Set(evidenceQuotes.map(evidence => evidence.sourceId)).size !== evidenceQuotes.length
        || sourceIds.some(sourceId => !evidenceQuotes.some(evidence => evidence.sourceId === sourceId))) {
        throw new Error('Interjection evidence quotes do not match its source links')
      }
      const verificationModel = boundedText(utterance.verification.model, 'interjection entailment model', 200)
      const verificationReason = boundedText(utterance.verification.reason, 'interjection entailment reason', 500)
      return {
        speaker: utterance.speaker,
        text,
        sourceIds,
        claimId,
        claimText,
        evidenceQuotes,
        verificationModel,
        verificationReason,
        verificationUtteranceId: expectedVerificationId,
      }
    })

    const existingUtterances = await ctx.db
      .query('audioOverviewInterjectionUtterances')
      .withIndex('by_interjectionId_and_order', q => q.eq('interjectionId', interjection._id))
      .take(MAX_UTTERANCES + 1)
    if (existingUtterances.length > 0) {
      if (existingUtterances.length !== normalized.length
        || existingUtterances.some((row, index) => row.speaker !== normalized[index]!.speaker
          || row.text !== normalized[index]!.text
          || row.claimId !== normalized[index]!.claimId
          || row.claimText !== normalized[index]!.claimText)) {
        throw new Error('Interjection rendering was already started with a different Dialogue Script')
      }
      return { duplicate: true, status: interjection.status }
    }

    const now = Date.now()
    for (let order = 0; order < normalized.length; order++) {
      const utterance = normalized[order]!
      const utteranceId = await ctx.db.insert('audioOverviewInterjectionUtterances', {
        interjectionId: interjection._id,
        episodeId: interjection.episodeId,
        userId,
        order,
        speaker: utterance.speaker,
        text: utterance.text,
        claimId: utterance.claimId,
        claimText: utterance.claimText,
        evidenceQuotes: utterance.evidenceQuotes,
        verificationUtteranceId: utterance.verificationUtteranceId,
        verificationVersion: 'claim-entailment.v1',
        verificationModel: utterance.verificationModel,
        entailmentDecision: 'entailed',
        entailmentReason: utterance.verificationReason,
        createdAt: now,
      })
      for (const sourceId of utterance.sourceIds) {
        await ctx.db.insert('audioOverviewInterjectionSources', {
          interjectionId: interjection._id,
          utteranceId,
          manifestEntryId: entryBySourceId.get(sourceId)!._id,
          episodeId: interjection.episodeId,
          userId,
          createdAt: now,
        })
      }
    }
    await ctx.db.patch(interjection._id, { status: 'rendering', utteranceCount: normalized.length, updatedAt: now })
    return { duplicate: false, status: 'rendering' as const }
  },
})

/** Records the single paid Gemini attempt before the Worker is called. */
export const claimRenderingAttempt = mutation({
  args: { interjectionId: v.id('audioOverviewInterjectionsV2'), orchestrationToken: v.string() },
  handler: async (ctx, args) => {
    requireAudioOverviewOrchestrationCredential(args.orchestrationToken)
    const userId = await requireAuth(ctx)
    const interjection = await requireOwnedInterjection(ctx, args.interjectionId, userId)
    if (interjection.status !== 'rendering' || interjection.renderAttemptedAt !== undefined) {
      return { claimed: false, status: interjection.status, claimedAt: interjection.renderAttemptedAt }
    }
    const claimedAt = Date.now()
    await ctx.db.patch(interjection._id, { renderAttemptedAt: claimedAt, updatedAt: claimedAt })
    await ctx.scheduler.runAfter(RENDER_ATTEMPT_TTL_MS, internal.audioOverviewInterjectionsV2.expireStaleAttempt, {
      interjectionId: interjection._id,
      phase: 'rendering',
      claimedAt,
    })
    return { claimed: true, status: 'rendering' as const, claimedAt }
  },
})

export const expireStaleAttempt = internalMutation({
  args: {
    interjectionId: v.id('audioOverviewInterjectionsV2'),
    phase: v.union(v.literal('scripting'), v.literal('rendering')),
    claimedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const interjection = await ctx.db.get(args.interjectionId)
    if (!interjection) return { expired: false }
    const matches = args.phase === 'scripting'
      ? interjection.status === 'scripting' && interjection.scriptingClaimedAt === args.claimedAt
      : interjection.status === 'rendering' && interjection.renderAttemptedAt === args.claimedAt
    if (!matches) return { expired: false }

    const now = Date.now()
    await ctx.db.patch(interjection._id, {
      status: 'failed',
      error: `Interjection ${args.phase} attempt expired`,
      updatedAt: now,
      completedAt: now,
    })
    if (args.phase === 'rendering') {
      await stageDeterministicArtifactCleanup(ctx, interjection)
    }
    return { expired: true }
  },
})

export const publish = mutation({
  args: {
    interjectionId: v.id('audioOverviewInterjectionsV2'),
    orchestrationToken: v.string(),
    artifact: artifactInput,
  },
  handler: async (ctx, args) => {
    requireAudioOverviewOrchestrationCredential(args.orchestrationToken)
    const userId = await requireAuth(ctx)
    const interjection = await requireOwnedInterjection(ctx, args.interjectionId, userId)
    if (interjection.status === 'cancelled' || interjection.status === 'deleting') throw new Error('Interjection was cancelled')
    if (interjection.status === 'failed') throw new Error('Interjection has failed')
    if (interjection.renderAttemptedAt === undefined) throw new Error('Interjection render attempt was not claimed')
    const expectedKey = `audio-overviews/jobs/${interjection.jobId}/interjections/${interjection._id}.wav`
    const checksum = args.artifact.checksumSha256.trim().toLowerCase()
    if (args.artifact.objectKey !== expectedKey) throw new Error('Invalid private R2 object key')
    if (!SHA256.test(checksum)) throw new Error('Invalid interjection artifact checksum')
    if (args.artifact.contentType !== 'audio/wav') throw new Error('Invalid interjection artifact content type')
    if (!Number.isSafeInteger(args.artifact.durationMs) || args.artifact.durationMs < 1 || args.artifact.durationMs > MAX_INTERJECTION_DURATION_MS) {
      throw new Error('Invalid interjection artifact duration')
    }
    const expectedBytes = 44 + Math.round(args.artifact.durationMs * 48)
    if (!Number.isSafeInteger(args.artifact.byteLength)
      || args.artifact.byteLength < 46
      || Math.abs(args.artifact.byteLength - expectedBytes) > 48) {
      throw new Error('Interjection WAV byte length does not match its Audio Profile')
    }
    if (interjection.artifactId) {
      const existing = await ctx.db.get(interjection.artifactId)
      if (!existing || existing.objectKey !== expectedKey || existing.checksumSha256 !== checksum) {
        throw new Error('Interjection was already published with different evidence')
      }
      return {
        duplicate: true,
        artifactId: existing._id,
        estimatedCostMicrousd: interjection.estimatedCostMicrousd
          ?? estimateInterjectionCostMicrousd(existing.durationMs),
      }
    }
    if (interjection.status !== 'rendering') throw new Error('Interjection Dialogue Script is not ready for publication')
    const now = Date.now()
    const artifactId = await ctx.db.insert('audioOverviewAudioArtifacts', {
      episodeId: interjection.episodeId,
      interjectionId: interjection._id,
      jobId: interjection.jobId,
      userId,
      kind: 'interjection',
      status: 'published',
      storageProvider: 'r2',
      objectKey: expectedKey,
      etag: args.artifact.etag,
      checksumSha256: checksum,
      byteLength: args.artifact.byteLength,
      contentType: 'audio/wav',
      container: 'wav',
      sampleRateHz: 24000,
      channelCount: 1,
      bitsPerSample: 16,
      durationMs: args.artifact.durationMs,
      createdAt: now,
      publishedAt: now,
    })
    const estimatedCostMicrousd = estimateInterjectionCostMicrousd(args.artifact.durationMs)
    await ctx.db.patch(interjection._id, {
      status: 'ready',
      artifactId,
      estimatedCostMicrousd,
      updatedAt: now,
      completedAt: now,
    })
    return { duplicate: false, artifactId, estimatedCostMicrousd }
  },
})

async function projection(ctx: QueryCtx, interjection: Doc<'audioOverviewInterjectionsV2'>) {
  const utterances = await ctx.db
    .query('audioOverviewInterjectionUtterances')
    .withIndex('by_interjectionId_and_order', q => q.eq('interjectionId', interjection._id))
    .take(MAX_UTTERANCES + 1)
  const links = await ctx.db
    .query('audioOverviewInterjectionSources')
    .withIndex('by_interjectionId', q => q.eq('interjectionId', interjection._id))
    .take(MAX_UTTERANCES * MAX_SOURCES_PER_UTTERANCE + 1)
  const sourceIdsByUtterance = new Map<string, string[]>()
  for (const link of links) {
    const entry = await ctx.db.get(link.manifestEntryId)
    if (!entry || entry.manifestId !== interjection.sourceManifestId) continue
    const key = String(link.utteranceId)
    sourceIdsByUtterance.set(key, [...(sourceIdsByUtterance.get(key) ?? []), entry.sourceId])
  }
  const artifact = interjection.artifactId ? await ctx.db.get(interjection.artifactId) : null
  return {
    ...interjection,
    utterances: utterances.map(row => ({
      utteranceId: row._id,
      order: row.order,
      speaker: row.speaker,
      text: row.text,
      sourceIds: sourceIdsByUtterance.get(String(row._id)) ?? [],
    })),
    artifact: artifact && artifact.interjectionId === interjection._id
      ? {
          artifactId: artifact._id,
          durationMs: artifact.durationMs,
          byteLength: artifact.byteLength,
          contentType: artifact.contentType,
        }
      : null,
  }
}

export const getForOwner = query({
  args: { interjectionId: v.id('audioOverviewInterjectionsV2') },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return null
    const interjection = await ctx.db.get(args.interjectionId)
    if (!interjection || interjection.userId !== userId) return null
    return await projection(ctx, interjection)
  },
})

export const resolveMediaForOwner = query({
  args: { interjectionId: v.id('audioOverviewInterjectionsV2') },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return null
    const interjection = await ctx.db.get(args.interjectionId)
    if (!interjection || interjection.userId !== userId || interjection.status !== 'ready' || !interjection.artifactId) return null
    const artifact = await ctx.db.get(interjection.artifactId)
    if (!artifact
      || artifact.userId !== userId
      || artifact.interjectionId !== interjection._id
      || artifact.episodeId !== interjection.episodeId
      || artifact.kind !== 'interjection'
      || artifact.status !== 'published'
      || artifact.container !== 'wav') return null
    return {
      artifactId: artifact._id,
      objectKey: artifact.objectKey,
      etag: artifact.etag,
      checksumSha256: artifact.checksumSha256,
      byteLength: artifact.byteLength,
      contentType: artifact.contentType,
      container: artifact.container,
      durationMs: artifact.durationMs,
    }
  },
})

export const cancelOrDelete = mutation({
  args: { interjectionId: v.id('audioOverviewInterjectionsV2') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const interjection = await requireOwnedInterjection(ctx, args.interjectionId, userId)
    if (interjection.status === 'cancelled' || interjection.status === 'deleting') return { duplicate: true, status: interjection.status }
    const now = Date.now()
    if (!interjection.artifactId) {
      if (interjection.renderAttemptedAt !== undefined) {
        await stageDeterministicArtifactCleanup(ctx, interjection)
        await ctx.db.patch(interjection._id, { status: 'deleting', updatedAt: now, completedAt: now })
        await ctx.scheduler.runAfter(1_000, internal.audioOverviewInterjectionsV2.deleteInterjectionBatch, {
          interjectionId: interjection._id,
          userId,
        })
        return { duplicate: false, status: 'deleting' as const }
      }
      await ctx.db.patch(interjection._id, { status: 'cancelled', updatedAt: now, completedAt: now })
      return { duplicate: false, status: 'cancelled' as const }
    }
    const artifact = await ctx.db.get(interjection.artifactId)
    if (!artifact
      || artifact.userId !== userId
      || artifact.interjectionId !== interjection._id
      || artifact.kind !== 'interjection') {
      throw new Error('Interjection Audio Artifact not found')
    }
    const cleanup = await ctx.db
      .query('pendingCleanup')
      .withIndex('by_audioArtifactId', q => q.eq('audioArtifactId', artifact._id))
      .unique()
    if (!cleanup) {
      await ctx.db.insert('pendingCleanup', {
        userId,
        documentId: `audio-artifact:${artifact._id}`,
        r2Key: artifact.objectKey,
        audioArtifactId: artifact._id,
        kind: 'r2',
        attempts: 0,
      })
    }
    await ctx.db.patch(artifact._id, { status: 'deleting' })
    await ctx.db.patch(interjection._id, { status: 'deleting', updatedAt: now })
    await ctx.scheduler.runAfter(0, internal.accountDeletion.drainPendingCleanup, { userId })
    await ctx.scheduler.runAfter(1_000, internal.audioOverviewInterjectionsV2.deleteInterjectionBatch, {
      interjectionId: interjection._id,
      userId,
    })
    return { duplicate: false, status: 'deleting' as const }
  },
})

export const deleteInterjectionBatch = internalMutation({
  args: { interjectionId: v.id('audioOverviewInterjectionsV2'), userId: v.string() },
  handler: async (ctx, args) => {
    const interjection = await ctx.db.get(args.interjectionId)
    if (!interjection || interjection.userId !== args.userId || interjection.status !== 'deleting') return { state: 'gone' as const }
    const artifact = interjection.artifactId ? await ctx.db.get(interjection.artifactId) : null
    if (artifact && artifact.status !== 'deleted') {
      const cleanup = await ctx.db
        .query('pendingCleanup')
        .withIndex('by_audioArtifactId', q => q.eq('audioArtifactId', artifact._id))
        .unique()
      if (cleanup && cleanup.attempts >= 10) return { state: 'cleanup-failed' as const }
      await ctx.scheduler.runAfter(60_000, internal.audioOverviewInterjectionsV2.deleteInterjectionBatch, args)
      return { state: 'waiting-for-r2' as const }
    }
    const links = await ctx.db
      .query('audioOverviewInterjectionSources')
      .withIndex('by_interjectionId', q => q.eq('interjectionId', interjection._id))
      .take(MAX_UTTERANCES * MAX_SOURCES_PER_UTTERANCE)
    for (const link of links) await ctx.db.delete(link._id)
    const utterances = await ctx.db
      .query('audioOverviewInterjectionUtterances')
      .withIndex('by_interjectionId_and_order', q => q.eq('interjectionId', interjection._id))
      .take(MAX_UTTERANCES)
    for (const utterance of utterances) await ctx.db.delete(utterance._id)
    if (artifact) await ctx.db.delete(artifact._id)
    await ctx.db.delete(interjection._id)
    return { state: 'deleted' as const }
  },
})

export const fail = mutation({
  args: {
    interjectionId: v.id('audioOverviewInterjectionsV2'),
    orchestrationToken: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    requireAudioOverviewOrchestrationCredential(args.orchestrationToken)
    const userId = await requireAuth(ctx)
    const interjection = await requireOwnedInterjection(ctx, args.interjectionId, userId)
    if (interjection.status === 'ready' || interjection.status === 'cancelled' || interjection.status === 'deleting') {
      return { duplicate: true, status: interjection.status }
    }
    await ctx.db.patch(interjection._id, {
      status: 'failed',
      error: boundedText(args.error, 'interjection failure', 2_000),
      updatedAt: Date.now(),
      completedAt: Date.now(),
    })
    return { duplicate: false, status: 'failed' as const }
  },
})
