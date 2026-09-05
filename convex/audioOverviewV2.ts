import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, mutation, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { mainUtteranceVerificationId } from '../shared/audio-overview-grounding'
import { estimateAudioOverviewCostMicrousd } from './lib/audioOverviewPolicy'
import { hasAccountDeletionTombstone, rejectAccountDeletion } from './lib/accountDeletionTombstone'
import { getOptionalAuthUserId } from './lib/auth'

const speakerValidator = v.union(v.literal('host_a'), v.literal('host_b'))

const manifestEntryValidator = v.object({
  sourceId: v.string(),
  documentId: v.id('documents'),
  revision: v.string(),
  contentHash: v.string(),
  displayReference: v.string(),
  objectKey: v.optional(v.string()),
})

const utteranceValidator = v.object({
  speaker: speakerValidator,
  text: v.string(),
  emotionalIntent: v.string(),
  deliveryIntent: v.string(),
  pauseAfterMs: v.optional(v.number()),
  sourceEntryOrders: v.array(v.number()),
  claimIds: v.array(v.string()),
  verification: v.object({
    version: v.literal('claim-entailment.v1'),
    utteranceId: v.string(),
    model: v.string(),
    decision: v.literal('entailed'),
    reason: v.string(),
  }),
})

const sceneValidator = v.object({
  sceneId: v.string(),
  title: v.string(),
  narrativePurpose: v.string(),
  targetDurationMs: v.number(),
  utterances: v.array(utteranceValidator),
})

const claimValidator = v.object({
  claimId: v.string(),
  text: v.string(),
  status: v.union(v.literal('supported'), v.literal('unsupported')),
  sourceEntryOrders: v.array(v.number()),
  verification: v.optional(v.object({
    version: v.literal('claim-entailment.v1'),
    model: v.string(),
    decision: v.literal('entailed'),
    reason: v.string(),
  })),
})

const pcmArtifactValidator = v.object({
  objectKey: v.string(),
  etag: v.optional(v.string()),
  checksumSha256: v.string(),
  byteLength: v.number(),
  contentType: v.string(),
  container: v.literal('pcm'),
  sampleRateHz: v.literal(24000),
  channelCount: v.literal(1),
  bitsPerSample: v.literal(16),
  durationMs: v.number(),
  rendererRequestId: v.optional(v.string()),
})

const wavArtifactValidator = v.object({
  objectKey: v.string(),
  etag: v.optional(v.string()),
  checksumSha256: v.string(),
  byteLength: v.number(),
  contentType: v.string(),
  container: v.literal('wav'),
  sampleRateHz: v.literal(24000),
  channelCount: v.literal(1),
  bitsPerSample: v.literal(16),
  durationMs: v.number(),
})

const qualityChecksValidator = v.object({
  claimsSupported: v.boolean(),
  scriptedSpeakerPairValid: v.boolean(),
  audioProfileMatches: v.boolean(),
  speakerCountEvidence: v.literal('not_measured'),
  speakerConsistencyEvidence: v.literal('not_measured'),
  durationWithinTolerance: v.boolean(),
  silenceWithinTolerance: v.boolean(),
  clippingWithinTolerance: v.boolean(),
  truncationFree: v.boolean(),
  tempoWithinTolerance: v.boolean(),
  directionsNotSpoken: v.boolean(),
  transcriptDivergence: v.optional(v.number()),
  transcriptDivergenceThreshold: v.optional(v.number()),
})

const alignmentSegmentValidator = v.object({
  utteranceId: v.id('audioOverviewUtterances'),
  wordIndex: v.number(),
  word: v.string(),
  startMs: v.number(),
  endMs: v.number(),
  confidence: v.optional(v.number()),
})

const MAX_MANIFEST_ENTRIES = 50
const MAX_SCENES = 24
const MAX_UTTERANCES = 400
const MAX_UTTERANCES_PER_SCENE = 80
const MAX_SOURCES_PER_UTTERANCE = 12
const MAX_LEARNING_OBJECTIVES = 12
const MAX_CLAIMS = 500
const MAX_CLAIMS_PER_UTTERANCE = 20
const MAX_TOTAL_SCRIPT_CHARACTERS = 240_000
const MAX_SCENE_ATTEMPTS = 5
const MAX_ALIGNMENT_SEGMENTS_PER_BATCH = 100
const MAX_TOTAL_ALIGNMENT_SEGMENTS = 10_000
const MAX_INTERJECTION_ARTIFACTS = 20
const MAX_ARTIFACTS = MAX_SCENES * MAX_SCENE_ATTEMPTS + MAX_INTERJECTION_ARTIFACTS + 2

function equalConstantTime(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index++) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return mismatch === 0
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  let binary = ''
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function requireCapability(
  ctx: QueryCtx | MutationCtx,
  jobId: Id<'audioOverviewJobs'>,
  capability: string,
): Promise<Doc<'audioOverviewJobs'>> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(capability)) throw new Error('Audio overview job not found')
  const job = await ctx.db.get(jobId)
  const candidate = await sha256Base64Url(capability)
  if (!job || !equalConstantTime(job.capabilityHash, candidate)) {
    throw new Error('Audio overview job not found')
  }
  await rejectAccountDeletion(ctx, job.userId)
  return job
}

function requireBoundedText(value: string, field: string, maxLength: number): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) throw new Error(`Invalid ${field}`)
  return trimmed
}

function requireNonNegativeInteger(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`Invalid ${field}`)
  return value
}

function requirePositiveInteger(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new Error(`Invalid ${field}`)
  return value
}

function requireSha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`Invalid ${field}`)
  return normalized
}

function requireObjectKey(value: string, jobId: Id<'audioOverviewJobs'>): string {
  const normalized = value.trim()
  const ownedPrefix = `audio-overviews/jobs/${jobId}/`
  if (
    !normalized
    || normalized.length > 1024
    || normalized.startsWith('/')
    || normalized.split('/').includes('..')
    || !normalized.startsWith(ownedPrefix)
  ) {
    throw new Error('Invalid private R2 object key')
  }
  return normalized
}

function validateArtifactNumbers(artifact: {
  byteLength: number
  durationMs: number
  sampleRateHz: 24000
  channelCount: 1
  bitsPerSample: 16
}) {
  requirePositiveInteger(artifact.byteLength, 'artifact byte length', 2 * 1024 * 1024 * 1024)
  requirePositiveInteger(artifact.durationMs, 'artifact duration', 6 * 60 * 60 * 1000)
}

async function takeBounded<T>(promise: Promise<T[]>, maximum: number, label: string): Promise<T[]> {
  const rows = await promise
  if (rows.length > maximum) throw new Error(`${label} exceeds the supported bound`)
  return rows
}

export const createPlan = mutation({
  args: {
    jobId: v.id('audioOverviewJobs'),
    capability: v.string(),
    planFingerprint: v.string(),
    title: v.string(),
    model: v.string(),
    audioProfile: v.object({
      id: v.string(),
      version: v.string(),
      renderer: v.string(),
      hostAVoice: v.string(),
      hostBVoice: v.string(),
    }),
    manifest: v.object({
      revision: v.string(),
      contentHash: v.string(),
      entries: v.array(manifestEntryValidator),
    }),
    outline: v.object({
      narrativeArc: v.string(),
      learningObjectives: v.array(v.string()),
      plannedSourceIds: v.array(v.string()),
    }),
    claims: v.array(claimValidator),
    scenes: v.array(sceneValidator),
  },
  handler: async (ctx, args) => {
    const job = await requireCapability(ctx, args.jobId, args.capability)
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      throw new Error('Audio overview job is terminal')
    }

    const planFingerprint = requireSha256(args.planFingerprint, 'plan fingerprint')
    const existingManifest = await ctx.db
      .query('audioOverviewSourceManifests')
      .withIndex('by_jobId', q => q.eq('jobId', args.jobId))
      .unique()
    if (existingManifest) {
      if (existingManifest.planFingerprint !== planFingerprint) {
        throw new Error('Audio overview plan is already frozen')
      }
      const episode = await ctx.db
        .query('audioOverviewEpisodes')
        .withIndex('by_jobId', q => q.eq('jobId', args.jobId))
        .unique()
      if (!episode) throw new Error('Frozen audio overview plan is incomplete')
      return { duplicate: true, manifestId: existingManifest._id, episodeId: episode._id }
    }

    if (args.manifest.entries.length < 1 || args.manifest.entries.length > MAX_MANIFEST_ENTRIES) {
      throw new Error('Invalid source manifest size')
    }
    if (args.outline.learningObjectives.length < 1
      || args.outline.learningObjectives.length > MAX_LEARNING_OBJECTIVES) {
      throw new Error('Invalid learning objective count')
    }
    if (args.outline.plannedSourceIds.length < 1
      || args.outline.plannedSourceIds.length > MAX_MANIFEST_ENTRIES) {
      throw new Error('Invalid planned source coverage')
    }
    if (args.claims.length < 1 || args.claims.length > MAX_CLAIMS) throw new Error('Invalid claim ledger size')
    if (args.scenes.length < 1 || args.scenes.length > MAX_SCENES) throw new Error('Invalid scene count')

    const task = await ctx.db.get(job.taskId)
    if (!task || task.userId !== job.userId || task.folderId !== job.folderId || !task.audioOverviewRequest) {
      throw new Error('Audio overview reservation is unavailable')
    }

    const expectedDocumentIds = [...new Set(task.audioOverviewRequest.documents.map(row => String(row.documentId)))].sort()
    const submittedDocumentIds = [...new Set(args.manifest.entries.map(row => String(row.documentId)))].sort()
    if (
      expectedDocumentIds.length !== submittedDocumentIds.length
      || expectedDocumentIds.some((id, index) => id !== submittedDocumentIds[index])
    ) {
      throw new Error('Source manifest does not match the frozen source scope')
    }

    const sourceIds = new Set<string>()
    const documentIds = new Set<string>()
    const claimById = new Map<string, typeof args.claims[number]>()
    let utteranceCount = 0
    let scriptCharacters = 0
    for (const [entryOrder, entry] of args.manifest.entries.entries()) {
      requireBoundedText(entry.sourceId, `source id ${entryOrder}`, 160)
      requireBoundedText(entry.revision, `source revision ${entryOrder}`, 256)
      requireSha256(entry.contentHash, `source content hash ${entryOrder}`)
      requireBoundedText(entry.displayReference, `source display reference ${entryOrder}`, 1_000)
      if (sourceIds.has(entry.sourceId) || documentIds.has(String(entry.documentId))) {
        throw new Error('Source manifest entries must be unique')
      }
      sourceIds.add(entry.sourceId)
      documentIds.add(String(entry.documentId))
      const frozenDocument = task.audioOverviewRequest.documents.find(row => row.documentId === entry.documentId)
      if (!frozenDocument) throw new Error('Source manifest contains an unauthorized source')
      if (entry.objectKey && entry.objectKey !== frozenDocument.r2Key) {
        throw new Error('Source object key does not match the frozen source scope')
      }
      const frozenHash = frozenDocument.contentHash?.trim().toLowerCase() ?? ''
      const frozenRevision = frozenDocument.sourceRevision?.trim() ?? ''
      if (!/^[a-f0-9]{64}$/.test(frozenHash) || frozenRevision !== `sha256:${frozenHash}`) {
        throw new Error('Frozen source scope has no authoritative immutable revision')
      }
      if (entry.contentHash.trim().toLowerCase() !== frozenHash) {
        throw new Error('Source content hash does not match the frozen source scope')
      }
      if (entry.revision.trim() !== frozenRevision) {
        throw new Error('Source revision does not match the frozen source scope')
      }
    }

    requireBoundedText(args.outline.narrativeArc, 'outline narrative arc', 4_000)
    for (const [objectiveOrder, objective] of args.outline.learningObjectives.entries()) {
      requireBoundedText(objective, `learning objective ${objectiveOrder}`, 1_000)
    }
    const uniquePlannedSourceIds = new Set(args.outline.plannedSourceIds.map(sourceId => sourceId.trim()))
    if (uniquePlannedSourceIds.size !== args.outline.plannedSourceIds.length) {
      throw new Error('Outline planned sources must be unique')
    }
    for (const sourceId of uniquePlannedSourceIds) {
      if (!sourceIds.has(sourceId)) throw new Error('Outline references a source outside the frozen manifest')
    }
    for (const [claimOrder, claim] of args.claims.entries()) {
      const claimId = claim.claimId.trim()
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(claimId) || claimById.has(claimId)) {
        throw new Error('Claim identifiers must be unique and stable')
      }
      requireBoundedText(claim.text, `claim text ${claimOrder}`, 4_000)
      if (claim.sourceEntryOrders.length > MAX_SOURCES_PER_UTTERANCE) {
        throw new Error('Too many supporting sources for claim')
      }
      const uniqueClaimSources = new Set(claim.sourceEntryOrders)
      if (uniqueClaimSources.size !== claim.sourceEntryOrders.length) {
        throw new Error('Duplicate supporting source for claim')
      }
      for (const sourceOrder of claim.sourceEntryOrders) {
        requireNonNegativeInteger(sourceOrder, 'claim source order', args.manifest.entries.length - 1)
      }
      if (claim.status === 'supported' && claim.sourceEntryOrders.length === 0) {
        throw new Error('Supported claims require source evidence')
      }
      if (claim.status === 'supported') {
        if (!claim.verification
          || claim.verification.version !== 'claim-entailment.v1'
          || claim.verification.decision !== 'entailed') {
          throw new Error('Supported claims require semantic entailment verification')
        }
        requireBoundedText(claim.verification.model, 'claim entailment model', 200)
        requireBoundedText(claim.verification.reason, 'claim entailment reason', 500)
      }
      claimById.set(claimId, claim)
    }

    for (const [sceneOrder, scene] of args.scenes.entries()) {
      requireBoundedText(scene.sceneId, `scene identity ${sceneOrder}`, 80)
      requireBoundedText(scene.title, `scene title ${sceneOrder}`, 300)
      requireBoundedText(scene.narrativePurpose, `scene narrative purpose ${sceneOrder}`, 2_000)
      requirePositiveInteger(scene.targetDurationMs, `scene target duration ${sceneOrder}`, 5 * 60 * 1000)
      if (scene.utterances.length < 1 || scene.utterances.length > MAX_UTTERANCES_PER_SCENE) {
        throw new Error('Invalid utterance count for scene')
      }
      for (const [utteranceOrder, utterance] of scene.utterances.entries()) {
        utteranceCount++
        scriptCharacters += utterance.text.length
        requireBoundedText(utterance.text, 'utterance text', 8_000)
        requireBoundedText(utterance.emotionalIntent, 'utterance emotional intent', 500)
        requireBoundedText(utterance.deliveryIntent, 'utterance delivery intent', 500)
        if (utterance.pauseAfterMs !== undefined) {
          requireNonNegativeInteger(utterance.pauseAfterMs, 'utterance pause', 10_000)
        }
        if (utterance.sourceEntryOrders.length > MAX_SOURCES_PER_UTTERANCE) {
          throw new Error('Too many supporting sources for utterance')
        }
        if (utterance.claimIds.length > MAX_CLAIMS_PER_UTTERANCE) {
          throw new Error('Too many claims for utterance')
        }
        if (utterance.sourceEntryOrders.length < 1 || utterance.claimIds.length < 1) {
          throw new Error('Every spoken Utterance requires supported claim evidence')
        }
        const expectedVerificationId = mainUtteranceVerificationId(scene.sceneId, sceneOrder, utteranceOrder)
        if (utterance.verification.version !== 'claim-entailment.v1'
          || utterance.verification.decision !== 'entailed'
          || utterance.verification.utteranceId !== expectedVerificationId) {
          throw new Error('Every spoken Utterance requires exact semantic entailment verification')
        }
        requireBoundedText(utterance.verification.model, 'Utterance entailment model', 200)
        requireBoundedText(utterance.verification.reason, 'Utterance entailment reason', 500)
        const uniqueSourceOrders = new Set(utterance.sourceEntryOrders)
        if (uniqueSourceOrders.size !== utterance.sourceEntryOrders.length) {
          throw new Error('Duplicate supporting source for utterance')
        }
        for (const sourceOrder of utterance.sourceEntryOrders) {
          requireNonNegativeInteger(sourceOrder, 'utterance source order', args.manifest.entries.length - 1)
        }
        const uniqueClaimIds = new Set(utterance.claimIds.map(claimId => claimId.trim()))
        if (uniqueClaimIds.size !== utterance.claimIds.length) throw new Error('Duplicate claim link for utterance')
        for (const claimId of uniqueClaimIds) {
          const claim = claimById.get(claimId)
          if (!claim) throw new Error('Utterance references an unknown claim')
          if (claim.status !== 'supported') throw new Error('Utterance references an unsupported claim')
          if (claim.sourceEntryOrders.some(sourceOrder => !uniqueSourceOrders.has(sourceOrder))) {
            throw new Error('Utterance claim evidence is missing from its source links')
          }
        }
      }
    }
    if (utteranceCount > MAX_UTTERANCES || scriptCharacters > MAX_TOTAL_SCRIPT_CHARACTERS) {
      throw new Error('Audio overview script exceeds the supported bound')
    }

    requireBoundedText(args.title, 'episode title', 300)
    requireBoundedText(args.model, 'episode model', 200)
    requireBoundedText(args.audioProfile.id, 'audio profile id', 200)
    requireBoundedText(args.audioProfile.version, 'audio profile version', 100)
    requireBoundedText(args.audioProfile.renderer, 'audio renderer', 200)
    requireBoundedText(args.audioProfile.hostAVoice, 'host A voice', 200)
    requireBoundedText(args.audioProfile.hostBVoice, 'host B voice', 200)
    if (args.audioProfile.hostAVoice === args.audioProfile.hostBVoice) {
      throw new Error('Audio profile must use two distinct voices')
    }

    const now = Date.now()
    const manifestId = await ctx.db.insert('audioOverviewSourceManifests', {
      jobId: job._id,
      taskId: job.taskId,
      userId: job.userId,
      folderId: job.folderId,
      schemaVersion: 2,
      revision: requireBoundedText(args.manifest.revision, 'manifest revision', 256),
      contentHash: requireSha256(args.manifest.contentHash, 'manifest content hash'),
      planFingerprint,
      entryCount: args.manifest.entries.length,
      frozenAt: now,
    })
    const manifestEntryIds: Array<Id<'audioOverviewSourceManifestEntries'>> = []
    for (const [order, entry] of args.manifest.entries.entries()) {
      manifestEntryIds.push(await ctx.db.insert('audioOverviewSourceManifestEntries', {
        manifestId,
        jobId: job._id,
        userId: job.userId,
        order,
        sourceId: entry.sourceId.trim(),
        documentId: entry.documentId,
        revision: entry.revision.trim(),
        contentHash: entry.contentHash.trim().toLowerCase(),
        displayReference: entry.displayReference.trim(),
        objectKey: entry.objectKey,
        createdAt: now,
      }))
    }

    const outlineId = await ctx.db.insert('audioOverviewOutlines', {
      jobId: job._id,
      taskId: job.taskId,
      userId: job.userId,
      narrativeArc: args.outline.narrativeArc.trim(),
      learningObjectiveCount: args.outline.learningObjectives.length,
      createdAt: now,
    })
    for (const [order, objective] of args.outline.learningObjectives.entries()) {
      await ctx.db.insert('audioOverviewLearningObjectives', {
        outlineId,
        jobId: job._id,
        userId: job.userId,
        order,
        text: objective.trim(),
        createdAt: now,
      })
    }
    const manifestEntryIdBySourceId = new Map(
      args.manifest.entries.map((entry, order) => [entry.sourceId.trim(), manifestEntryIds[order]!]),
    )
    for (const [order, sourceId] of args.outline.plannedSourceIds.entries()) {
      await ctx.db.insert('audioOverviewOutlineSources', {
        outlineId,
        manifestEntryId: manifestEntryIdBySourceId.get(sourceId.trim())!,
        jobId: job._id,
        userId: job.userId,
        order,
        createdAt: now,
      })
    }

    const claimLedgerId = await ctx.db.insert('audioOverviewClaimLedgers', {
      jobId: job._id,
      taskId: job.taskId,
      userId: job.userId,
      claimCount: args.claims.length,
      supportedClaimCount: args.claims.filter(claim => claim.status === 'supported').length,
      createdAt: now,
    })
    const claimRecordById = new Map<string, Id<'audioOverviewClaims'>>()
    for (const [order, claim] of args.claims.entries()) {
      const claimId = await ctx.db.insert('audioOverviewClaims', {
        ledgerId: claimLedgerId,
        jobId: job._id,
        userId: job.userId,
        order,
        claimId: claim.claimId.trim(),
        text: claim.text.trim(),
        status: claim.status,
        verificationVersion: claim.verification?.version,
        verificationModel: claim.verification?.model.trim(),
        entailmentDecision: claim.verification?.decision,
        entailmentReason: claim.verification?.reason.trim(),
        createdAt: now,
      })
      claimRecordById.set(claim.claimId.trim(), claimId)
      for (const sourceOrder of claim.sourceEntryOrders) {
        await ctx.db.insert('audioOverviewClaimSources', {
          ledgerId: claimLedgerId,
          claimRecordId: claimId,
          manifestEntryId: manifestEntryIds[sourceOrder]!,
          jobId: job._id,
          userId: job.userId,
          createdAt: now,
        })
      }
    }

    const episodeId = await ctx.db.insert('audioOverviewEpisodes', {
      jobId: job._id,
      taskId: job.taskId,
      userId: job.userId,
      folderId: job.folderId,
      sourceManifestId: manifestId,
      outlineId,
      claimLedgerId,
      schemaVersion: 2,
      title: args.title.trim(),
      model: args.model.trim(),
      audioProfileId: args.audioProfile.id.trim(),
      audioProfileVersion: args.audioProfile.version.trim(),
      renderer: args.audioProfile.renderer.trim(),
      hostAVoice: args.audioProfile.hostAVoice.trim(),
      hostBVoice: args.audioProfile.hostBVoice.trim(),
      requestedLengthMinutes: task.audioOverviewRequest.preferences.lengthMinutes,
      complexity: task.audioOverviewRequest.preferences.complexity,
      status: 'planning',
      sceneCount: args.scenes.length,
      utteranceCount,
      createdAt: now,
      updatedAt: now,
    })

    let episodeOrder = 0
    for (const [sceneOrder, scene] of args.scenes.entries()) {
      const sceneId = await ctx.db.insert('audioOverviewScenes', {
        episodeId,
        jobId: job._id,
        userId: job.userId,
        order: sceneOrder,
        title: scene.title.trim(),
        narrativePurpose: scene.narrativePurpose.trim(),
        targetDurationMs: scene.targetDurationMs,
        status: 'pending',
        currentAttempt: 0,
        updatedAt: now,
      })
      for (const [utteranceOrder, utterance] of scene.utterances.entries()) {
        const utteranceId = await ctx.db.insert('audioOverviewUtterances', {
          episodeId,
          sceneId,
          jobId: job._id,
          userId: job.userId,
          order: episodeOrder++,
          sceneOrder: utteranceOrder,
          speaker: utterance.speaker,
          text: utterance.text.trim(),
          emotionalIntent: utterance.emotionalIntent.trim(),
          deliveryIntent: utterance.deliveryIntent.trim(),
          pauseAfterMs: utterance.pauseAfterMs,
          verificationUtteranceId: utterance.verification.utteranceId,
          verificationVersion: utterance.verification.version,
          verificationModel: utterance.verification.model.trim(),
          entailmentDecision: utterance.verification.decision,
          entailmentReason: utterance.verification.reason.trim(),
          createdAt: now,
        })
        for (const sourceOrder of utterance.sourceEntryOrders) {
          await ctx.db.insert('audioOverviewUtteranceSources', {
            episodeId,
            utteranceId,
            manifestEntryId: manifestEntryIds[sourceOrder]!,
            jobId: job._id,
            userId: job.userId,
            createdAt: now,
          })
        }
        for (const linkedClaimId of utterance.claimIds) {
          await ctx.db.insert('audioOverviewUtteranceClaims', {
            episodeId,
            utteranceId,
            claimRecordId: claimRecordById.get(linkedClaimId.trim())!,
            jobId: job._id,
            userId: job.userId,
            createdAt: now,
          })
        }
      }
    }
    return { duplicate: false, manifestId, episodeId }
  },
})

export const getForWorkflow = query({
  args: { jobId: v.id('audioOverviewJobs'), capability: v.string() },
  handler: async (ctx, args) => {
    await requireCapability(ctx, args.jobId, args.capability)
    const manifest = await ctx.db
      .query('audioOverviewSourceManifests')
      .withIndex('by_jobId', q => q.eq('jobId', args.jobId))
      .unique()
    const episode = await ctx.db
      .query('audioOverviewEpisodes')
      .withIndex('by_jobId', q => q.eq('jobId', args.jobId))
      .unique()
    if (!manifest || !episode) return null

    const [
      entries,
      outlines,
      learningObjectives,
      outlineSources,
      claimLedgers,
      claims,
      claimSources,
      scenes,
      utterances,
      utteranceSources,
      utteranceClaims,
      artifacts,
      qualityGates,
      alignments,
    ] = await Promise.all([
      takeBounded(ctx.db.query('audioOverviewSourceManifestEntries').withIndex('by_jobId', q => q.eq('jobId', args.jobId)).take(MAX_MANIFEST_ENTRIES + 1), MAX_MANIFEST_ENTRIES, 'Source manifest'),
      takeBounded(ctx.db.query('audioOverviewOutlines').withIndex('by_jobId', q => q.eq('jobId', args.jobId)).take(2), 1, 'Outline list'),
      takeBounded(ctx.db.query('audioOverviewLearningObjectives').withIndex('by_jobId', q => q.eq('jobId', args.jobId)).take(MAX_LEARNING_OBJECTIVES + 1), MAX_LEARNING_OBJECTIVES, 'Learning objective list'),
      takeBounded(ctx.db.query('audioOverviewOutlineSources').withIndex('by_jobId', q => q.eq('jobId', args.jobId)).take(MAX_MANIFEST_ENTRIES + 1), MAX_MANIFEST_ENTRIES, 'Outline source list'),
      takeBounded(ctx.db.query('audioOverviewClaimLedgers').withIndex('by_jobId', q => q.eq('jobId', args.jobId)).take(2), 1, 'Claim ledger list'),
      takeBounded(ctx.db.query('audioOverviewClaims').withIndex('by_jobId', q => q.eq('jobId', args.jobId)).take(MAX_CLAIMS + 1), MAX_CLAIMS, 'Claim list'),
      takeBounded(ctx.db.query('audioOverviewClaimSources').withIndex('by_jobId', q => q.eq('jobId', args.jobId)).take(MAX_CLAIMS * MAX_SOURCES_PER_UTTERANCE + 1), MAX_CLAIMS * MAX_SOURCES_PER_UTTERANCE, 'Claim source list'),
      takeBounded(ctx.db.query('audioOverviewScenes').withIndex('by_jobId_and_order', q => q.eq('jobId', args.jobId)).take(MAX_SCENES + 1), MAX_SCENES, 'Scene list'),
      takeBounded(ctx.db.query('audioOverviewUtterances').withIndex('by_jobId', q => q.eq('jobId', args.jobId)).take(MAX_UTTERANCES + 1), MAX_UTTERANCES, 'Utterance list'),
      takeBounded(ctx.db.query('audioOverviewUtteranceSources').withIndex('by_jobId', q => q.eq('jobId', args.jobId)).take(MAX_UTTERANCES * MAX_SOURCES_PER_UTTERANCE + 1), MAX_UTTERANCES * MAX_SOURCES_PER_UTTERANCE, 'Utterance source list'),
      takeBounded(ctx.db.query('audioOverviewUtteranceClaims').withIndex('by_jobId', q => q.eq('jobId', args.jobId)).take(MAX_UTTERANCES * MAX_CLAIMS_PER_UTTERANCE + 1), MAX_UTTERANCES * MAX_CLAIMS_PER_UTTERANCE, 'Utterance claim list'),
      takeBounded(ctx.db.query('audioOverviewAudioArtifacts').withIndex('by_jobId_and_objectKey', q => q.eq('jobId', args.jobId)).take(MAX_ARTIFACTS + 1), MAX_ARTIFACTS, 'Artifact list'),
      takeBounded(ctx.db.query('audioOverviewSceneQualityGates').withIndex('by_jobId', q => q.eq('jobId', args.jobId)).take(MAX_SCENES * MAX_SCENE_ATTEMPTS + 1), MAX_SCENES * MAX_SCENE_ATTEMPTS, 'Quality gate list'),
      takeBounded(ctx.db.query('audioOverviewAlignments').withIndex('by_jobId', q => q.eq('jobId', args.jobId)).take(2), 1, 'Alignment list'),
    ])
    return {
      episode,
      manifest,
      entries,
      outline: outlines[0] ?? null,
      learningObjectives,
      outlineSources,
      claimLedger: claimLedgers[0] ?? null,
      claims,
      claimSources,
      scenes,
      utterances,
      utteranceSources,
      utteranceClaims,
      artifacts,
      qualityGates,
      alignment: alignments[0] ?? null,
    }
  },
})

async function loadPlaybackProjection(ctx: QueryCtx, overview: Doc<'audioOverviews'>) {
  if (!overview.episodeId || !overview.finalArtifactId || overview.status !== 'ready') return null
  const [episode, artifact] = await Promise.all([
    ctx.db.get(overview.episodeId),
    ctx.db.get(overview.finalArtifactId),
  ])
  if (!episode
    || episode.userId !== overview.userId
    || episode.compatibilityOverviewId !== overview._id
    || episode.finalArtifactId !== artifact?._id
    || !artifact
    || artifact.episodeId !== episode._id
    || artifact.kind !== 'final'
    || artifact.status !== 'published') {
    return null
  }

  const [
    manifest,
    outline,
    claimLedger,
    alignment,
    entries,
    learningObjectives,
    outlineSources,
    claims,
    claimSources,
    scenes,
    utterances,
    utteranceSources,
    utteranceClaims,
  ] = await Promise.all([
    ctx.db.get(episode.sourceManifestId),
    ctx.db.get(episode.outlineId),
    ctx.db.get(episode.claimLedgerId),
    episode.alignmentId ? ctx.db.get(episode.alignmentId) : Promise.resolve(null),
    takeBounded(ctx.db.query('audioOverviewSourceManifestEntries').withIndex('by_manifestId_and_order', q => q.eq('manifestId', episode.sourceManifestId)).take(MAX_MANIFEST_ENTRIES + 1), MAX_MANIFEST_ENTRIES, 'Source manifest'),
    takeBounded(ctx.db.query('audioOverviewLearningObjectives').withIndex('by_outlineId_and_order', q => q.eq('outlineId', episode.outlineId)).take(MAX_LEARNING_OBJECTIVES + 1), MAX_LEARNING_OBJECTIVES, 'Learning objective list'),
    takeBounded(ctx.db.query('audioOverviewOutlineSources').withIndex('by_outlineId_and_order', q => q.eq('outlineId', episode.outlineId)).take(MAX_MANIFEST_ENTRIES + 1), MAX_MANIFEST_ENTRIES, 'Outline source list'),
    takeBounded(ctx.db.query('audioOverviewClaims').withIndex('by_ledgerId_and_order', q => q.eq('ledgerId', episode.claimLedgerId)).take(MAX_CLAIMS + 1), MAX_CLAIMS, 'Claim list'),
    takeBounded(ctx.db.query('audioOverviewClaimSources').withIndex('by_ledgerId', q => q.eq('ledgerId', episode.claimLedgerId)).take(MAX_CLAIMS * MAX_SOURCES_PER_UTTERANCE + 1), MAX_CLAIMS * MAX_SOURCES_PER_UTTERANCE, 'Claim source list'),
    takeBounded(ctx.db.query('audioOverviewScenes').withIndex('by_episodeId_and_order', q => q.eq('episodeId', episode._id)).take(MAX_SCENES + 1), MAX_SCENES, 'Scene list'),
    takeBounded(ctx.db.query('audioOverviewUtterances').withIndex('by_episodeId_and_order', q => q.eq('episodeId', episode._id)).take(MAX_UTTERANCES + 1), MAX_UTTERANCES, 'Utterance list'),
    takeBounded(ctx.db.query('audioOverviewUtteranceSources').withIndex('by_episodeId', q => q.eq('episodeId', episode._id)).take(MAX_UTTERANCES * MAX_SOURCES_PER_UTTERANCE + 1), MAX_UTTERANCES * MAX_SOURCES_PER_UTTERANCE, 'Utterance source list'),
    takeBounded(ctx.db.query('audioOverviewUtteranceClaims').withIndex('by_episodeId', q => q.eq('episodeId', episode._id)).take(MAX_UTTERANCES * MAX_CLAIMS_PER_UTTERANCE + 1), MAX_UTTERANCES * MAX_CLAIMS_PER_UTTERANCE, 'Utterance claim list'),
  ])
  if (!manifest || !outline || !claimLedger) return null
  const alignmentSegments = alignment?.status === 'ready'
    ? await takeBounded(
        ctx.db
          .query('audioOverviewAlignmentSegments')
          .withIndex('by_alignmentId_and_utteranceId_and_wordIndex', q => q.eq('alignmentId', alignment._id))
          .take(MAX_TOTAL_ALIGNMENT_SEGMENTS + 1),
        MAX_TOTAL_ALIGNMENT_SEGMENTS,
        'Alignment segment list',
      )
    : []

  const entryById = new Map(entries.map(entry => [String(entry._id), entry]))
  const claimByRecordId = new Map(claims.map(claim => [String(claim._id), claim]))
  const sourceIdsByUtterance = new Map<string, string[]>()
  for (const link of utteranceSources) {
    const entry = entryById.get(String(link.manifestEntryId))
    if (!entry) continue
    const key = String(link.utteranceId)
    sourceIdsByUtterance.set(key, [...(sourceIdsByUtterance.get(key) ?? []), entry.sourceId])
  }
  const claimIdsByUtterance = new Map<string, string[]>()
  for (const link of utteranceClaims) {
    const claim = claimByRecordId.get(String(link.claimRecordId))
    if (!claim || claim.status !== 'supported') continue
    const key = String(link.utteranceId)
    claimIdsByUtterance.set(key, [...(claimIdsByUtterance.get(key) ?? []), claim.claimId])
  }
  const sourceIdsByClaim = new Map<string, string[]>()
  for (const link of claimSources) {
    const entry = entryById.get(String(link.manifestEntryId))
    if (!entry) continue
    const key = String(link.claimRecordId)
    sourceIdsByClaim.set(key, [...(sourceIdsByClaim.get(key) ?? []), entry.sourceId])
  }
  const timingsByUtterance = new Map<string, typeof alignmentSegments>()
  for (const segment of alignmentSegments) {
    const key = String(segment.utteranceId)
    timingsByUtterance.set(key, [...(timingsByUtterance.get(key) ?? []), segment])
  }

  return {
    overviewId: overview._id,
    episodeId: episode._id,
    schemaVersion: 2 as const,
    title: episode.title,
    model: episode.model,
    voiceProfile: { hostA: episode.hostAVoice, hostB: episode.hostBVoice },
    preferences: {
      lengthMinutes: episode.requestedLengthMinutes,
      complexity: episode.complexity,
    },
    totalDurationMs: artifact.durationMs,
    publishedAt: overview.publishedAt ?? null,
    sourceManifest: {
      revision: manifest.revision,
      contentHash: manifest.contentHash,
      sources: entries.map(entry => ({
        sourceId: entry.sourceId,
        documentId: entry.documentId,
        revision: entry.revision,
        contentHash: entry.contentHash,
        displayReference: entry.displayReference,
      })),
    },
    outline: {
      narrativeArc: outline.narrativeArc,
      learningObjectives: learningObjectives.map(objective => objective.text),
      plannedSourceIds: outlineSources
        .map(link => entryById.get(String(link.manifestEntryId))?.sourceId)
        .filter((sourceId): sourceId is string => sourceId !== undefined),
    },
    claims: claims
      .filter(claim => claim.status === 'supported')
      .map(claim => ({
        claimId: claim.claimId,
        text: claim.text,
        sourceIds: sourceIdsByClaim.get(String(claim._id)) ?? [],
      })),
    scenes: scenes.map(scene => ({
      sceneId: scene._id,
      order: scene.order,
      title: scene.title,
      narrativePurpose: scene.narrativePurpose,
      durationMs: scene.durationMs ?? scene.targetDurationMs,
    })),
    utterances: utterances.map((utterance) => {
      const timings = [...(timingsByUtterance.get(String(utterance._id)) ?? [])]
        .sort((left, right) => left.wordIndex - right.wordIndex)
      return {
        utteranceId: utterance._id,
        sceneId: utterance.sceneId,
        order: utterance.order,
        sceneOrder: utterance.sceneOrder,
        speaker: utterance.speaker,
        text: utterance.text,
        emotionalIntent: utterance.emotionalIntent,
        deliveryIntent: utterance.deliveryIntent,
        pauseAfterMs: utterance.pauseAfterMs,
        sourceIds: sourceIdsByUtterance.get(String(utterance._id)) ?? [],
        claimIds: claimIdsByUtterance.get(String(utterance._id)) ?? [],
        alignmentStartMs: timings[0]?.startMs,
        wordTimings: timings.length > 0
          ? timings.map(timing => ({
              word: timing.word,
              start: timing.startMs / 1_000,
              end: timing.endMs / 1_000,
            }))
          : undefined,
      }
    }),
    finalArtifact: {
      artifactId: artifact._id,
      storageProvider: artifact.storageProvider,
      objectKey: artifact.objectKey,
      checksumSha256: artifact.checksumSha256,
      byteLength: artifact.byteLength,
      contentType: artifact.contentType,
      container: artifact.container,
      sampleRateHz: artifact.sampleRateHz,
      channelCount: artifact.channelCount,
      bitsPerSample: artifact.bitsPerSample,
      durationMs: artifact.durationMs,
    },
    alignment: alignment
      ? { alignmentId: alignment._id, status: alignment.status, segmentCount: alignment.segmentCount }
      : null,
  }
}

export const getPlaybackForOwner = query({
  args: { overviewId: v.id('audioOverviews') },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return null
    const overview = await ctx.db.get(args.overviewId)
    if (!overview || overview.userId !== userId) return null
    return await loadPlaybackProjection(ctx, overview)
  },
})

const SHARE_TOKEN_PATTERN = /^[0-9a-f]{32}$/

export const getPlaybackByShareToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (!SHARE_TOKEN_PATTERN.test(args.token)) return null
    const overview = await ctx.db
      .query('audioOverviews')
      .withIndex('by_shareToken', q => q.eq('shareToken', args.token))
      .unique()
    if (!overview || !overview.publishedAt || overview.status !== 'ready') return null
    if (await hasAccountDeletionTombstone(ctx, overview.userId)) return null
    const folder = await ctx.db.get(overview.folderId)
    if (!folder || folder.userId !== overview.userId) return null
    const projection = await loadPlaybackProjection(ctx, overview)
    if (!projection) return null
    return {
      overviewId: projection.overviewId,
      schemaVersion: projection.schemaVersion,
      title: projection.title,
      voiceProfile: projection.voiceProfile,
      totalDurationMs: projection.totalDurationMs,
      publishedAt: projection.publishedAt,
      sourceManifest: {
        sources: projection.sourceManifest.sources.map(source => ({
          sourceId: source.sourceId,
          displayReference: source.displayReference,
        })),
      },
      scenes: projection.scenes,
      utterances: projection.utterances,
      alignment: projection.alignment,
    }
  },
})

function mediaMetadata(artifact: Doc<'audioOverviewAudioArtifacts'>) {
  return {
    artifactId: artifact._id,
    storageProvider: artifact.storageProvider,
    objectKey: artifact.objectKey,
    etag: artifact.etag,
    checksumSha256: artifact.checksumSha256,
    byteLength: artifact.byteLength,
    contentType: artifact.contentType,
    container: artifact.container,
    sampleRateHz: artifact.sampleRateHz,
    channelCount: artifact.channelCount,
    bitsPerSample: artifact.bitsPerSample,
    durationMs: artifact.durationMs,
  }
}

function isPublishedFinalArtifact(artifact: Doc<'audioOverviewAudioArtifacts'> | null): artifact is Doc<'audioOverviewAudioArtifacts'> {
  return artifact?.kind === 'final'
    && artifact.status === 'published'
    && artifact.storageProvider === 'r2'
    && artifact.container === 'wav'
}

export const resolveMediaForOwner = query({
  args: { artifactId: v.id('audioOverviewAudioArtifacts') },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return null
    const artifact = await ctx.db.get(args.artifactId)
    if (!isPublishedFinalArtifact(artifact) || artifact.userId !== userId) return null
    const episode = await ctx.db.get(artifact.episodeId)
    if (!episode || episode.userId !== userId || episode.finalArtifactId !== artifact._id) return null
    const overview = await ctx.db
      .query('audioOverviews')
      .withIndex('by_episodeId', q => q.eq('episodeId', episode._id))
      .unique()
    if (!overview
      || overview.userId !== userId
      || overview.status !== 'ready'
      || overview.finalArtifactId !== artifact._id) return null
    return mediaMetadata(artifact)
  },
})

export const resolveMediaByShareToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (!SHARE_TOKEN_PATTERN.test(args.token)) return null
    const overview = await ctx.db
      .query('audioOverviews')
      .withIndex('by_shareToken', q => q.eq('shareToken', args.token))
      .unique()
    if (!overview
      || !overview.publishedAt
      || overview.status !== 'ready'
      || !overview.episodeId
      || !overview.finalArtifactId) return null
    if (await hasAccountDeletionTombstone(ctx, overview.userId)) return null
    const artifact = await ctx.db.get(overview.finalArtifactId)
    if (!isPublishedFinalArtifact(artifact)
      || artifact.userId !== overview.userId
      || artifact.episodeId !== overview.episodeId) return null
    const episode = await ctx.db.get(overview.episodeId)
    if (!episode
      || episode.userId !== overview.userId
      || episode.compatibilityOverviewId !== overview._id
      || episode.finalArtifactId !== artifact._id) return null
    return mediaMetadata(artifact)
  },
})

export const recordSceneEvaluation = mutation({
  args: {
    jobId: v.id('audioOverviewJobs'),
    capability: v.string(),
    sceneId: v.id('audioOverviewScenes'),
    attempt: v.number(),
    passed: v.boolean(),
    artifact: pcmArtifactValidator,
    checks: qualityChecksValidator,
    failureCode: v.optional(v.string()),
    failureMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await requireCapability(ctx, args.jobId, args.capability)
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      throw new Error('Audio overview job is terminal')
    }
    const scene = await ctx.db.get(args.sceneId)
    if (!scene || scene.jobId !== job._id || scene.userId !== job.userId) throw new Error('Audio overview scene not found')
    const attempt = requirePositiveInteger(args.attempt, 'scene attempt', MAX_SCENE_ATTEMPTS)
    const booleanChecks = [
      args.checks.claimsSupported,
      args.checks.scriptedSpeakerPairValid,
      args.checks.audioProfileMatches,
      args.checks.durationWithinTolerance,
      args.checks.silenceWithinTolerance,
      args.checks.clippingWithinTolerance,
      args.checks.truncationFree,
      args.checks.tempoWithinTolerance,
      args.checks.directionsNotSpoken,
    ]
    const divergencePassed = args.checks.transcriptDivergence === undefined
      || (args.checks.transcriptDivergenceThreshold !== undefined
        && args.checks.transcriptDivergence <= args.checks.transcriptDivergenceThreshold)
    if (args.passed !== (booleanChecks.every(Boolean) && divergencePassed)) {
      throw new Error('Scene quality result does not match its evidence')
    }
    if (!args.passed) {
      requireBoundedText(args.failureCode ?? '', 'quality failure code', 100)
      requireBoundedText(args.failureMessage ?? '', 'quality failure message', 2_000)
    }
    if (args.checks.transcriptDivergence !== undefined) {
      if (!Number.isFinite(args.checks.transcriptDivergence) || args.checks.transcriptDivergence < 0 || args.checks.transcriptDivergence > 1) {
        throw new Error('Invalid transcript divergence')
      }
      if (args.checks.transcriptDivergenceThreshold === undefined
        || !Number.isFinite(args.checks.transcriptDivergenceThreshold)
        || args.checks.transcriptDivergenceThreshold < 0
        || args.checks.transcriptDivergenceThreshold > 1) {
        throw new Error('Invalid transcript divergence threshold')
      }
    }
    validateArtifactNumbers(args.artifact)
    if (args.artifact.byteLength % 2 !== 0
      || Math.abs(args.artifact.durationMs - args.artifact.byteLength / 48) > 1) {
      throw new Error('Scene PCM byte length does not match its audio profile')
    }
    const objectKey = requireObjectKey(args.artifact.objectKey, job._id)
    const checksumSha256 = requireSha256(args.artifact.checksumSha256, 'artifact checksum')

    const existingGate = await ctx.db
      .query('audioOverviewSceneQualityGates')
      .withIndex('by_sceneId_and_attempt', q => q.eq('sceneId', scene._id).eq('attempt', attempt))
      .unique()
    if (existingGate) {
      const artifact = await ctx.db.get(existingGate.artifactId)
      if (!artifact || artifact.objectKey !== objectKey || artifact.checksumSha256 !== checksumSha256 || existingGate.passed !== args.passed) {
        throw new Error('Scene attempt was already recorded with different evidence')
      }
      return { duplicate: true, artifactId: artifact._id, qualityGateId: existingGate._id }
    }
    if (scene.status === 'ready') throw new Error('Audio overview scene already passed its quality gate')
    if (attempt <= scene.currentAttempt) throw new Error('Scene attempt is stale')

    const existingArtifact = await ctx.db
      .query('audioOverviewAudioArtifacts')
      .withIndex('by_jobId_and_objectKey', q => q.eq('jobId', job._id).eq('objectKey', objectKey))
      .unique()
    if (existingArtifact) throw new Error('R2 object key was already used by another artifact')

    const now = Date.now()
    const artifactId = await ctx.db.insert('audioOverviewAudioArtifacts', {
      episodeId: scene.episodeId,
      sceneId: scene._id,
      jobId: job._id,
      userId: job.userId,
      kind: 'scene',
      status: args.passed ? 'staged' : 'rejected',
      storageProvider: 'r2',
      objectKey,
      etag: args.artifact.etag,
      checksumSha256,
      byteLength: args.artifact.byteLength,
      contentType: requireBoundedText(args.artifact.contentType, 'artifact content type', 200),
      container: 'pcm',
      sampleRateHz: 24000,
      channelCount: 1,
      bitsPerSample: 16,
      durationMs: args.artifact.durationMs,
      rendererRequestId: args.artifact.rendererRequestId,
      createdAt: now,
    })
    const qualityGateId = await ctx.db.insert('audioOverviewSceneQualityGates', {
      episodeId: scene.episodeId,
      sceneId: scene._id,
      artifactId,
      jobId: job._id,
      userId: job.userId,
      attempt,
      passed: args.passed,
      ...args.checks,
      failureCode: args.failureCode?.trim(),
      failureMessage: args.failureMessage?.trim(),
      evaluatedAt: now,
    })
    await ctx.db.patch(scene._id, {
      status: args.passed ? 'ready' : 'failed',
      currentAttempt: attempt,
      durationMs: args.artifact.durationMs,
      audioArtifactId: args.passed ? artifactId : undefined,
      updatedAt: now,
    })
    await ctx.db.patch(scene.episodeId, { status: 'rendering', updatedAt: now })
    return { duplicate: false, artifactId, qualityGateId }
  },
})

async function completePublication(
  ctx: MutationCtx,
  job: Doc<'audioOverviewJobs'>,
  episode: Doc<'audioOverviewEpisodes'>,
  artifact: Doc<'audioOverviewAudioArtifacts'>,
  alignmentId: Id<'audioOverviewAlignments'>,
): Promise<Id<'audioOverviews'>> {
  const task = await ctx.db.get(job.taskId)
  if (!task
    || task.userId !== job.userId
    || task.folderId !== job.folderId
    || !task.audioOverviewRequest
    || task.status === 'failed'
    || task.status === 'cancelled') {
    throw new Error('Audio overview task is unavailable for publication')
  }
  const existingOverview = await ctx.db
    .query('audioOverviews')
    .withIndex('by_episodeId', q => q.eq('episodeId', episode._id))
    .unique()
  let overviewId: Id<'audioOverviews'>
  if (existingOverview) {
    if (existingOverview.finalArtifactId !== artifact._id
      || existingOverview.taskId !== task._id
      || existingOverview.userId !== job.userId) {
      throw new Error('Audio overview compatibility root conflicts with the published artifact')
    }
    overviewId = existingOverview._id
  }
  else {
    const entries = await takeBounded(
      ctx.db
        .query('audioOverviewSourceManifestEntries')
        .withIndex('by_manifestId_and_order', q => q.eq('manifestId', episode.sourceManifestId))
        .take(MAX_MANIFEST_ENTRIES + 1),
      MAX_MANIFEST_ENTRIES,
      'Source manifest',
    )
    if (entries.length < 1) throw new Error('Audio overview source manifest is empty')
    overviewId = await ctx.db.insert('audioOverviews', {
      userId: job.userId,
      folderId: job.folderId,
      taskId: task._id,
      episodeId: episode._id,
      finalArtifactId: artifact._id,
      title: episode.title,
      status: 'ready',
      model: episode.model,
      turns: [],
      voiceProfile: { hostA: episode.hostAVoice, hostB: episode.hostBVoice },
      preferences: {
        lengthMinutes: episode.requestedLengthMinutes,
        complexity: episode.complexity,
      },
      totalDurationMs: artifact.durationMs,
      sourceDocumentIds: entries.map(entry => entry.documentId),
      scopeDocIds: entries.map(entry => entry.documentId),
    })
  }

  const now = Date.now()
  const renderAttempts = await takeBounded(
    ctx.db
      .query('audioOverviewAudioArtifacts')
      .withIndex('by_episodeId_and_kind', q => q.eq('episodeId', episode._id).eq('kind', 'scene'))
      .take(MAX_ARTIFACTS + 1),
    MAX_ARTIFACTS,
    'Scene artifact list',
  )
  const renderedAttemptDurationMs = renderAttempts.reduce((total, attempt) => total + attempt.durationMs, 0)
  const estimatedCostMicrousd = estimateAudioOverviewCostMicrousd(
    renderedAttemptDurationMs,
    artifact.durationMs,
  )
  await ctx.db.patch(episode._id, {
    status: 'ready',
    totalDurationMs: artifact.durationMs,
    finalArtifactId: artifact._id,
    alignmentId,
    compatibilityOverviewId: overviewId,
    updatedAt: now,
    publishedAt: episode.publishedAt ?? now,
  })
  await ctx.db.patch(job._id, {
    status: 'completed',
    stage: 'complete',
    title: episode.title,
    model: episode.model,
    estimatedCostMicrousd,
    updatedAt: now,
    completedAt: now,
  })
  await ctx.db.patch(task._id, {
    status: 'completed',
    progress: 'Complete',
    result: {
      overviewId,
      episodeId: episode._id,
      finalArtifactId: artifact._id,
      turnCount: episode.utteranceCount,
      schemaVersion: 2,
    },
    updatedAt: now,
    completedAt: now,
  })
  return overviewId
}

export const publishFinalArtifact = mutation({
  args: {
    jobId: v.id('audioOverviewJobs'),
    capability: v.string(),
    artifact: wavArtifactValidator,
    alignment: v.object({
      aligner: v.optional(v.string()),
      alignerVersion: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const job = await requireCapability(ctx, args.jobId, args.capability)
    if (job.status === 'failed' || job.status === 'cancelled') throw new Error('Audio overview job is terminal')
    const episode = await ctx.db
      .query('audioOverviewEpisodes')
      .withIndex('by_jobId', q => q.eq('jobId', job._id))
      .unique()
    if (!episode) throw new Error('Audio overview plan is unavailable')

    validateArtifactNumbers(args.artifact)
    const objectKey = requireObjectKey(args.artifact.objectKey, job._id)
    const checksumSha256 = requireSha256(args.artifact.checksumSha256, 'artifact checksum')
    const existingFinal = await ctx.db
      .query('audioOverviewAudioArtifacts')
      .withIndex('by_episodeId_and_kind', q => q.eq('episodeId', episode._id).eq('kind', 'final'))
      .unique()
    if (existingFinal) {
      if (existingFinal.objectKey !== objectKey || existingFinal.checksumSha256 !== checksumSha256) {
        throw new Error('Final artifact was already published with different evidence')
      }
      const alignment = await ctx.db
        .query('audioOverviewAlignments')
        .withIndex('by_episodeId', q => q.eq('episodeId', episode._id))
        .unique()
      if (!alignment) throw new Error('Published audio overview alignment is unavailable')
      const overviewId = await completePublication(ctx, job, episode, existingFinal, alignment._id)
      return { duplicate: true, overviewId, episodeId: episode._id, artifactId: existingFinal._id, alignmentId: alignment._id }
    }
    if (job.status === 'completed') throw new Error('Completed audio overview job has no published artifact')

    const scenes = await takeBounded(
      ctx.db.query('audioOverviewScenes').withIndex('by_episodeId_and_order', q => q.eq('episodeId', episode._id)).take(MAX_SCENES + 1),
      MAX_SCENES,
      'Scene list',
    )
    if (scenes.length !== episode.sceneCount || scenes.some(scene => scene.status !== 'ready' || !scene.audioArtifactId)) {
      throw new Error('Every scene must pass its quality gate before publication')
    }
    const expectedDurationMs = scenes.reduce((sum, scene) => sum + (scene.durationMs ?? 0), 0)
    if (Math.abs(expectedDurationMs - args.artifact.durationMs) > scenes.length * 2 + 10) {
      throw new Error('Final artifact duration does not match its scenes')
    }
    let expectedWavBytes = 44
    for (const scene of scenes) {
      const sceneArtifact = scene.audioArtifactId ? await ctx.db.get(scene.audioArtifactId) : null
      if (!sceneArtifact
        || sceneArtifact.kind !== 'scene'
        || sceneArtifact.container !== 'pcm'
        || sceneArtifact.sampleRateHz !== 24000
        || sceneArtifact.channelCount !== 1
        || sceneArtifact.bitsPerSample !== 16) {
        throw new Error('Scene artifact audio profiles are not homogeneous')
      }
      expectedWavBytes += sceneArtifact.byteLength
    }
    if (args.artifact.byteLength !== expectedWavBytes) {
      throw new Error('Final WAV byte length does not match its PCM scenes')
    }
    const reusedObject = await ctx.db
      .query('audioOverviewAudioArtifacts')
      .withIndex('by_jobId_and_objectKey', q => q.eq('jobId', job._id).eq('objectKey', objectKey))
      .unique()
    if (reusedObject) throw new Error('R2 object key was already used by another artifact')

    const now = Date.now()
    const artifactId = await ctx.db.insert('audioOverviewAudioArtifacts', {
      episodeId: episode._id,
      jobId: job._id,
      userId: job.userId,
      kind: 'final',
      status: 'published',
      storageProvider: 'r2',
      objectKey,
      etag: args.artifact.etag,
      checksumSha256,
      byteLength: args.artifact.byteLength,
      contentType: requireBoundedText(args.artifact.contentType, 'artifact content type', 200),
      container: 'wav',
      sampleRateHz: 24000,
      channelCount: 1,
      bitsPerSample: 16,
      durationMs: args.artifact.durationMs,
      createdAt: now,
      publishedAt: now,
    })
    const alignmentId = await ctx.db.insert('audioOverviewAlignments', {
      episodeId: episode._id,
      artifactId,
      jobId: job._id,
      userId: job.userId,
      status: 'pending',
      aligner: args.alignment.aligner?.trim(),
      alignerVersion: args.alignment.alignerVersion?.trim(),
      segmentCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    const artifact = await ctx.db.get(artifactId)
    if (!artifact) throw new Error('Published audio artifact is unavailable')
    const overviewId = await completePublication(ctx, job, episode, artifact, alignmentId)
    return { duplicate: false, overviewId, episodeId: episode._id, artifactId, alignmentId }
  },
})

export const appendAlignmentSegments = mutation({
  args: {
    jobId: v.id('audioOverviewJobs'),
    capability: v.string(),
    alignmentId: v.id('audioOverviewAlignments'),
    segments: v.array(alignmentSegmentValidator),
  },
  handler: async (ctx, args) => {
    const job = await requireCapability(ctx, args.jobId, args.capability)
    const alignment = await ctx.db.get(args.alignmentId)
    if (!alignment || alignment.jobId !== job._id || alignment.userId !== job.userId) {
      throw new Error('Audio overview alignment not found')
    }
    if (alignment.status !== 'pending') throw new Error('Audio overview alignment is terminal')
    if (args.segments.length < 1 || args.segments.length > MAX_ALIGNMENT_SEGMENTS_PER_BATCH) {
      throw new Error('Invalid alignment segment batch size')
    }
    const artifact = await ctx.db.get(alignment.artifactId)
    if (!artifact) throw new Error('Alignment artifact is unavailable')

    const now = Date.now()
    const batchKeys = new Set<string>()
    let inserted = 0
    for (const segment of args.segments) {
      const wordIndex = requireNonNegativeInteger(segment.wordIndex, 'alignment word index', 100_000)
      const word = requireBoundedText(segment.word, 'alignment word', 200)
      requireNonNegativeInteger(segment.startMs, 'alignment start', artifact.durationMs)
      requireNonNegativeInteger(segment.endMs, 'alignment end', artifact.durationMs)
      if (segment.endMs < segment.startMs) throw new Error('Invalid alignment time range')
      if (segment.confidence !== undefined
        && (!Number.isFinite(segment.confidence) || segment.confidence < 0 || segment.confidence > 1)) {
        throw new Error('Invalid alignment confidence')
      }
      const utterance = await ctx.db.get(segment.utteranceId)
      if (!utterance || utterance.episodeId !== alignment.episodeId || utterance.jobId !== job._id) {
        throw new Error('Alignment segment references an unrelated utterance')
      }
      const batchKey = `${segment.utteranceId}:${wordIndex}`
      if (batchKeys.has(batchKey)) throw new Error('Duplicate alignment segment in batch')
      batchKeys.add(batchKey)

      const existing = await ctx.db
        .query('audioOverviewAlignmentSegments')
        .withIndex('by_alignmentId_and_utteranceId_and_wordIndex', q => q
          .eq('alignmentId', alignment._id)
          .eq('utteranceId', utterance._id)
          .eq('wordIndex', wordIndex))
        .unique()
      if (existing) {
        if (existing.word !== word || existing.startMs !== segment.startMs || existing.endMs !== segment.endMs) {
          throw new Error('Alignment segment was already recorded with different timing')
        }
        continue
      }
      if (wordIndex > 0) {
        const previous = await ctx.db
          .query('audioOverviewAlignmentSegments')
          .withIndex('by_alignmentId_and_utteranceId_and_wordIndex', q => q
            .eq('alignmentId', alignment._id)
            .eq('utteranceId', utterance._id)
            .eq('wordIndex', wordIndex - 1))
          .unique()
        if (!previous || previous.startMs > segment.startMs) {
          throw new Error('Alignment segments must be appended in word order')
        }
      }
      await ctx.db.insert('audioOverviewAlignmentSegments', {
        alignmentId: alignment._id,
        episodeId: alignment.episodeId,
        utteranceId: utterance._id,
        sceneId: utterance.sceneId,
        jobId: job._id,
        userId: job.userId,
        wordIndex,
        word,
        startMs: segment.startMs,
        endMs: segment.endMs,
        confidence: segment.confidence,
        createdAt: now,
      })
      inserted++
    }
    if (inserted > 0) {
      await ctx.db.patch(alignment._id, { segmentCount: alignment.segmentCount + inserted, updatedAt: now })
    }
    return { inserted, duplicate: args.segments.length - inserted }
  },
})

export const completeAlignment = mutation({
  args: { jobId: v.id('audioOverviewJobs'), capability: v.string(), alignmentId: v.id('audioOverviewAlignments') },
  handler: async (ctx, args) => {
    const job = await requireCapability(ctx, args.jobId, args.capability)
    const alignment = await ctx.db.get(args.alignmentId)
    if (!alignment || alignment.jobId !== job._id || alignment.userId !== job.userId) {
      throw new Error('Audio overview alignment not found')
    }
    if (alignment.status === 'ready') return { duplicate: true }
    if (alignment.status === 'failed') throw new Error('Failed alignment cannot become ready')
    if (alignment.segmentCount < 1) throw new Error('Cannot complete an empty alignment')
    const utterances = await takeBounded(
      ctx.db
        .query('audioOverviewUtterances')
        .withIndex('by_episodeId_and_order', q => q.eq('episodeId', alignment.episodeId))
        .take(MAX_UTTERANCES + 1),
      MAX_UTTERANCES,
      'Utterance list',
    )
    const segments = await takeBounded(
      ctx.db
        .query('audioOverviewAlignmentSegments')
        .withIndex('by_alignmentId_and_utteranceId_and_wordIndex', q => q.eq('alignmentId', alignment._id))
        .take(MAX_TOTAL_ALIGNMENT_SEGMENTS + 1),
      MAX_TOTAL_ALIGNMENT_SEGMENTS,
      'Alignment segment list',
    )
    const alignedUtterances = new Set(segments.map(segment => String(segment.utteranceId)))
    if (segments.length !== alignment.segmentCount
      || utterances.length < 1
      || utterances.some(utterance => !alignedUtterances.has(String(utterance._id)))) {
      throw new Error('Cannot complete a partial audio overview alignment')
    }
    const now = Date.now()
    await ctx.db.patch(alignment._id, { status: 'ready', error: undefined, updatedAt: now, completedAt: now })
    return { duplicate: false }
  },
})

export const failAlignment = mutation({
  args: {
    jobId: v.id('audioOverviewJobs'),
    capability: v.string(),
    alignmentId: v.id('audioOverviewAlignments'),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await requireCapability(ctx, args.jobId, args.capability)
    const alignment = await ctx.db.get(args.alignmentId)
    if (!alignment || alignment.jobId !== job._id || alignment.userId !== job.userId) {
      throw new Error('Audio overview alignment not found')
    }
    if (alignment.status === 'failed') return { duplicate: true }
    if (alignment.status === 'ready') throw new Error('Ready alignment cannot become failed')
    const now = Date.now()
    await ctx.db.patch(alignment._id, {
      status: 'failed',
      error: requireBoundedText(args.error, 'alignment error', 2_000),
      updatedAt: now,
      completedAt: now,
    })
    return { duplicate: false }
  },
})

export const listAlignmentSegments = query({
  args: {
    jobId: v.id('audioOverviewJobs'),
    capability: v.string(),
    alignmentId: v.id('audioOverviewAlignments'),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const job = await requireCapability(ctx, args.jobId, args.capability)
    const alignment = await ctx.db.get(args.alignmentId)
    if (!alignment || alignment.jobId !== job._id || alignment.userId !== job.userId) {
      throw new Error('Audio overview alignment not found')
    }
    if (!Number.isSafeInteger(args.paginationOpts.numItems)
      || args.paginationOpts.numItems < 1
      || args.paginationOpts.numItems > 250) {
      throw new Error('Invalid alignment page size')
    }
    return await ctx.db
      .query('audioOverviewAlignmentSegments')
      .withIndex('by_alignmentId_and_utteranceId_and_wordIndex', q => q.eq('alignmentId', alignment._id))
      .paginate(args.paginationOpts)
  },
})

export async function stageV2OverviewDeletion(
  ctx: MutationCtx,
  overview: Doc<'audioOverviews'>,
  userId: string,
): Promise<boolean> {
  if (!overview.episodeId) return false
  if (overview.userId !== userId) throw new Error('Audio overview not found')
  const episode = await ctx.db.get(overview.episodeId)
  if (!episode) {
    await ctx.scheduler.runAfter(0, internal.audioOverviews.deleteOverviewBatch, {
      overviewId: overview._id,
      userId,
    })
    return true
  }
  if (episode.userId !== userId || episode.compatibilityOverviewId !== overview._id) {
    throw new Error('Audio overview ownership mismatch')
  }
  const artifacts = await takeBounded(
    ctx.db
      .query('audioOverviewAudioArtifacts')
      .withIndex('by_episodeId_and_kind', q => q.eq('episodeId', episode._id))
      .take(MAX_ARTIFACTS + 1),
    MAX_ARTIFACTS,
    'Artifact list',
  )
  if (artifacts.some(artifact => artifact.userId !== userId || artifact.jobId !== episode.jobId)) {
    throw new Error('Audio overview artifact ownership mismatch')
  }

  const now = Date.now()
  for (const artifact of artifacts) {
    if (artifact.status === 'deleted') continue
    const existingCleanup = await ctx.db
      .query('pendingCleanup')
      .withIndex('by_audioArtifactId', q => q.eq('audioArtifactId', artifact._id))
      .unique()
    if (existingCleanup) {
      if (existingCleanup.userId !== userId
        || existingCleanup.kind !== 'r2'
        || existingCleanup.r2Key !== artifact.objectKey) {
        throw new Error('Audio artifact cleanup ownership mismatch')
      }
    }
    else {
      await ctx.db.insert('pendingCleanup', {
        userId,
        documentId: `audio-artifact:${artifact._id}`,
        r2Key: artifact.objectKey,
        audioArtifactId: artifact._id,
        kind: 'r2',
        attempts: 0,
      })
    }
    if (artifact.status !== 'deleting') await ctx.db.patch(artifact._id, { status: 'deleting' })
  }
  if (episode.status !== 'deleting') await ctx.db.patch(episode._id, { status: 'deleting', updatedAt: now })
  if (artifacts.some(artifact => artifact.status !== 'deleted')) {
    await ctx.scheduler.runAfter(0, internal.accountDeletion.drainPendingCleanup, { userId })
  }
  await ctx.scheduler.runAfter(1_000, internal.audioOverviewV2.deleteEpisodeBatch, {
    overviewId: overview._id,
    userId,
  })
  return true
}

async function scheduleNextDeletionBatch(
  ctx: MutationCtx,
  overviewId: Id<'audioOverviews'>,
  userId: string,
  delayMs = 0,
) {
  await ctx.scheduler.runAfter(delayMs, internal.audioOverviewV2.deleteEpisodeBatch, { overviewId, userId })
}

export const deleteEpisodeBatch = internalMutation({
  args: { overviewId: v.id('audioOverviews'), userId: v.string() },
  handler: async (ctx, args) => {
    const overview = await ctx.db.get(args.overviewId)
    if (!overview || overview.userId !== args.userId || overview.status !== 'deleting') return { state: 'gone' as const }
    if (!overview.episodeId) {
      await ctx.scheduler.runAfter(0, internal.audioOverviews.deleteOverviewBatch, args)
      return { state: 'legacy' as const }
    }
    const episode = await ctx.db.get(overview.episodeId)
    if (!episode) {
      await ctx.scheduler.runAfter(0, internal.audioOverviews.deleteOverviewBatch, args)
      return { state: 'metadata-removed' as const }
    }
    if (episode.userId !== args.userId || episode.compatibilityOverviewId !== overview._id) {
      throw new Error('Audio overview ownership mismatch')
    }

    const artifacts = await takeBounded(
      ctx.db
        .query('audioOverviewAudioArtifacts')
        .withIndex('by_episodeId_and_kind', q => q.eq('episodeId', episode._id))
        .take(MAX_ARTIFACTS + 1),
      MAX_ARTIFACTS,
      'Artifact list',
    )
    if (artifacts.some(artifact => artifact.userId !== args.userId || artifact.jobId !== episode.jobId)) {
      throw new Error('Audio overview artifact ownership mismatch')
    }
    for (const artifact of artifacts) {
      if (artifact.status === 'deleted') continue
      if (artifact.status !== 'deleting') throw new Error('Audio artifact cleanup was not staged')
      const cleanup = await ctx.db
        .query('pendingCleanup')
        .withIndex('by_audioArtifactId', q => q.eq('audioArtifactId', artifact._id))
        .unique()
      if (!cleanup
        || cleanup.userId !== args.userId
        || cleanup.kind !== 'r2'
        || cleanup.r2Key !== artifact.objectKey) {
        throw new Error('Audio artifact cleanup evidence is unavailable')
      }
      if (cleanup.attempts < 10) {
        await scheduleNextDeletionBatch(ctx, overview._id, args.userId, 60_000)
        return { state: 'waiting-for-r2' as const }
      }
      return { state: 'cleanup-failed' as const }
    }

    const interjectionSources = await ctx.db
      .query('audioOverviewInterjectionSources')
      .withIndex('by_episodeId', q => q.eq('episodeId', episode._id))
      .take(100)
    if (interjectionSources.length > 0) {
      for (const row of interjectionSources) await ctx.db.delete(row._id)
      await scheduleNextDeletionBatch(ctx, overview._id, args.userId)
      return { state: 'deleting-metadata' as const }
    }
    const interjectionUtterances = await ctx.db
      .query('audioOverviewInterjectionUtterances')
      .withIndex('by_episodeId', q => q.eq('episodeId', episode._id))
      .take(100)
    if (interjectionUtterances.length > 0) {
      for (const row of interjectionUtterances) await ctx.db.delete(row._id)
      await scheduleNextDeletionBatch(ctx, overview._id, args.userId)
      return { state: 'deleting-metadata' as const }
    }
    const interjections = await ctx.db
      .query('audioOverviewInterjectionsV2')
      .withIndex('by_episodeId', q => q.eq('episodeId', episode._id))
      .take(100)
    if (interjections.length > 0) {
      for (const row of interjections) await ctx.db.delete(row._id)
      await scheduleNextDeletionBatch(ctx, overview._id, args.userId)
      return { state: 'deleting-metadata' as const }
    }

    const alignmentSegments = await ctx.db
      .query('audioOverviewAlignmentSegments')
      .withIndex('by_episodeId', q => q.eq('episodeId', episode._id))
      .take(100)
    if (alignmentSegments.length > 0) {
      for (const row of alignmentSegments) await ctx.db.delete(row._id)
      await scheduleNextDeletionBatch(ctx, overview._id, args.userId)
      return { state: 'deleting-metadata' as const }
    }
    const utteranceSources = await ctx.db
      .query('audioOverviewUtteranceSources')
      .withIndex('by_episodeId', q => q.eq('episodeId', episode._id))
      .take(100)
    if (utteranceSources.length > 0) {
      for (const row of utteranceSources) await ctx.db.delete(row._id)
      await scheduleNextDeletionBatch(ctx, overview._id, args.userId)
      return { state: 'deleting-metadata' as const }
    }
    const utteranceClaims = await ctx.db
      .query('audioOverviewUtteranceClaims')
      .withIndex('by_episodeId', q => q.eq('episodeId', episode._id))
      .take(100)
    if (utteranceClaims.length > 0) {
      for (const row of utteranceClaims) await ctx.db.delete(row._id)
      await scheduleNextDeletionBatch(ctx, overview._id, args.userId)
      return { state: 'deleting-metadata' as const }
    }
    const qualityGates = await ctx.db
      .query('audioOverviewSceneQualityGates')
      .withIndex('by_episodeId', q => q.eq('episodeId', episode._id))
      .take(100)
    if (qualityGates.length > 0) {
      for (const row of qualityGates) await ctx.db.delete(row._id)
      await scheduleNextDeletionBatch(ctx, overview._id, args.userId)
      return { state: 'deleting-metadata' as const }
    }
    const utterances = await ctx.db
      .query('audioOverviewUtterances')
      .withIndex('by_episodeId_and_order', q => q.eq('episodeId', episode._id))
      .take(100)
    if (utterances.length > 0) {
      for (const row of utterances) await ctx.db.delete(row._id)
      await scheduleNextDeletionBatch(ctx, overview._id, args.userId)
      return { state: 'deleting-metadata' as const }
    }
    const claimSources = await ctx.db
      .query('audioOverviewClaimSources')
      .withIndex('by_ledgerId', q => q.eq('ledgerId', episode.claimLedgerId))
      .take(100)
    if (claimSources.length > 0) {
      for (const row of claimSources) await ctx.db.delete(row._id)
      await scheduleNextDeletionBatch(ctx, overview._id, args.userId)
      return { state: 'deleting-metadata' as const }
    }
    const claims = await ctx.db
      .query('audioOverviewClaims')
      .withIndex('by_ledgerId_and_order', q => q.eq('ledgerId', episode.claimLedgerId))
      .take(100)
    if (claims.length > 0) {
      for (const row of claims) await ctx.db.delete(row._id)
      await scheduleNextDeletionBatch(ctx, overview._id, args.userId)
      return { state: 'deleting-metadata' as const }
    }
    const outlineSources = await ctx.db
      .query('audioOverviewOutlineSources')
      .withIndex('by_outlineId_and_order', q => q.eq('outlineId', episode.outlineId))
      .take(100)
    if (outlineSources.length > 0) {
      for (const row of outlineSources) await ctx.db.delete(row._id)
      await scheduleNextDeletionBatch(ctx, overview._id, args.userId)
      return { state: 'deleting-metadata' as const }
    }
    const learningObjectives = await ctx.db
      .query('audioOverviewLearningObjectives')
      .withIndex('by_outlineId_and_order', q => q.eq('outlineId', episode.outlineId))
      .take(100)
    if (learningObjectives.length > 0) {
      for (const row of learningObjectives) await ctx.db.delete(row._id)
      await scheduleNextDeletionBatch(ctx, overview._id, args.userId)
      return { state: 'deleting-metadata' as const }
    }
    const alignments = await ctx.db
      .query('audioOverviewAlignments')
      .withIndex('by_episodeId', q => q.eq('episodeId', episode._id))
      .take(100)
    if (alignments.length > 0) {
      for (const row of alignments) await ctx.db.delete(row._id)
      await scheduleNextDeletionBatch(ctx, overview._id, args.userId)
      return { state: 'deleting-metadata' as const }
    }
    const scenes = await ctx.db
      .query('audioOverviewScenes')
      .withIndex('by_episodeId_and_order', q => q.eq('episodeId', episode._id))
      .take(100)
    if (scenes.length > 0) {
      for (const row of scenes) await ctx.db.delete(row._id)
      await scheduleNextDeletionBatch(ctx, overview._id, args.userId)
      return { state: 'deleting-metadata' as const }
    }
    if (artifacts.length > 0) {
      for (const row of artifacts) await ctx.db.delete(row._id)
      await scheduleNextDeletionBatch(ctx, overview._id, args.userId)
      return { state: 'deleting-metadata' as const }
    }
    const manifestEntries = await ctx.db
      .query('audioOverviewSourceManifestEntries')
      .withIndex('by_manifestId_and_order', q => q.eq('manifestId', episode.sourceManifestId))
      .take(100)
    if (manifestEntries.length > 0) {
      for (const row of manifestEntries) await ctx.db.delete(row._id)
      await scheduleNextDeletionBatch(ctx, overview._id, args.userId)
      return { state: 'deleting-metadata' as const }
    }

    await ctx.db.delete(episode.claimLedgerId)
    await ctx.db.delete(episode.outlineId)
    await ctx.db.delete(episode.sourceManifestId)
    await ctx.db.delete(episode._id)
    await ctx.scheduler.runAfter(0, internal.audioOverviews.deleteOverviewBatch, args)
    return { state: 'metadata-removed' as const }
  },
})
