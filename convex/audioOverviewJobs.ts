import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { requireAuth } from './lib/auth'
import {
  AUDIO_OVERVIEW_DAILY_CAP,
  AUDIO_OVERVIEW_ENTAILMENT_VERIFICATION_BUDGET_MICRO_USD,
  AUDIO_OVERVIEW_MAX_JOB_BUDGET_MICRO_USD,
  AUDIO_OVERVIEW_SCRIPT_BUDGET_MICRO_USD,
  estimateAudioOverviewAlignmentMicrousd,
  estimateAudioOverviewSceneAttemptMicrousd,
  reserveAudioOverviewBudgetMicrousd,
} from './lib/audioOverviewPolicy'
import { reserveAudioOverviewTask } from './tasks'
import { rejectLegacyAudioOverviewWrite } from './lib/audioOverviewLegacyBoundary'
import { rejectAccountDeletion } from './lib/accountDeletionTombstone'

const voiceValidator = v.union(
  v.literal('asteria'), v.literal('luna'), v.literal('stella'),
  v.literal('athena'), v.literal('hera'), v.literal('orion'),
  v.literal('arcas'), v.literal('perseus'), v.literal('angus'),
  v.literal('orpheus'), v.literal('helios'), v.literal('zeus'),
)

const requestArgs = {
  folderId: v.id('folders'),
  roomId: v.id('audioOverviewRooms'),
  scope: v.union(
    v.object({ mode: v.literal('folder') }),
    v.object({ mode: v.literal('explicit'), documentIds: v.array(v.id('documents')) }),
  ),
  preferences: v.object({
    lengthMinutes: v.union(v.literal(5), v.literal(10), v.literal(20)),
    complexity: v.union(v.literal('beginner'), v.literal('expert')),
  }),
  voiceProfile: v.object({ hostA: voiceValidator, hostB: voiceValidator }),
  hostNames: v.object({ hostA: v.string(), hostB: v.string() }),
  idempotencyKey: v.string(),
  capability: v.string(),
}

const wordTimingValidator = v.object({
  word: v.string(),
  start: v.number(),
  end: v.number(),
})

const scriptTurnValidator = v.object({
  speaker: v.union(v.literal('host_a'), v.literal('host_b')),
  text: v.string(),
  synthesisText: v.optional(v.string()),
  sourceIndex: v.optional(v.number()),
})

const MAX_WORD_TIMINGS_PER_TURN = 10_000
const LATE_UPLOAD_RECONCILIATION_MS = 24 * 60 * 60 * 1000
const STALE_JOB_MS = 2 * 60 * 60 * 1000
const TERMINAL_JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const JOB_CLEANUP_BATCH_SIZE = 25
const JOB_TURN_CLEANUP_BATCH_SIZE = 50
const LEGACY_RETRYABLE_PRELAUNCH_FAILURE = 'Audio overview Workflow could not be started after bounded retries'

function validateIdempotencyKey(value: string) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(value)) throw new Error('Invalid idempotency key')
}

function validateCapability(value: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('Invalid job capability')
}

function hasAuthoritativeFrozenSources(task: Doc<'tasks'>): boolean {
  const documents = task.audioOverviewRequest?.documents ?? []
  return documents.length > 0 && documents.every((document) => {
    const contentHash = document.contentHash?.trim().toLowerCase() ?? ''
    return /^[a-f0-9]{64}$/.test(contentHash)
      && document.sourceRevision?.trim() === `sha256:${contentHash}`
  })
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function capabilityHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return bytesToBase64Url(new Uint8Array(digest))
}

async function deriveCapability(secret: string, userId: string, idempotencyKey: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`audio-overview-job:v1\n${userId}\n${idempotencyKey}`),
  )
  return bytesToBase64Url(new Uint8Array(signature))
}

async function requireServerDerivedCapability(userId: string, idempotencyKey: string, capability: string) {
  validateCapability(capability)
  const secret = process.env.AUDIO_OVERVIEW_JOB_SECRET?.trim()
  if (!secret) throw new Error('Audio overview jobs are not configured')
  const expected = await deriveCapability(secret, userId, idempotencyKey)
  if (!equalConstantTime(capability, expected)) throw new Error('Invalid job capability')
}

function equalConstantTime(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i)
  return mismatch === 0
}

async function requireCapability(
  ctx: QueryCtx | MutationCtx,
  jobId: Id<'audioOverviewJobs'>,
  capability: string,
): Promise<Doc<'audioOverviewJobs'>> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(capability)) throw new Error('Audio overview job not found')
  const job = await ctx.db.get(jobId)
  const candidate = await capabilityHash(capability)
  if (!job || !equalConstantTime(job.capabilityHash, candidate)) throw new Error('Audio overview job not found')
  await rejectAccountDeletion(ctx, job.userId)
  return job
}

function isActiveTask(task: Doc<'tasks'> | null) {
  return task?.type === 'audio-overview-generation'
    && (task.status === 'pending' || task.status === 'running')
    && !!task.audioOverviewRequest
}

function validateTiming(durationMs: number, wordTimings?: Array<{ word: string, start: number, end: number }>) {
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 6 * 60 * 60 * 1000) {
    throw new Error('Invalid audio duration')
  }
  if (!wordTimings) return
  if (wordTimings.length > MAX_WORD_TIMINGS_PER_TURN) throw new Error('Too many audio word timings')
  let priorStart = -1
  for (const timing of wordTimings) {
    if (!timing.word.trim() || timing.word.length > 200 || !Number.isFinite(timing.start) || !Number.isFinite(timing.end)
      || timing.start < 0 || timing.end < timing.start || timing.start < priorStart || timing.end * 1000 > durationMs + 5_000) {
      throw new Error('Invalid audio word timing')
    }
    priorStart = timing.start
  }
}

export const request = mutation({
  args: requestArgs,
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    await rejectAccountDeletion(ctx, userId)
    validateIdempotencyKey(args.idempotencyKey)
    await requireServerDerivedCapability(userId, args.idempotencyKey, args.capability)
    const verifiedCapabilityHash = await capabilityHash(args.capability)

    const existing = await ctx.db
      .query('audioOverviewJobs')
      .withIndex('by_userId_and_idempotencyKey', q => q
        .eq('userId', userId)
        .eq('idempotencyKey', args.idempotencyKey))
      .unique()
    if (existing) {
      if (!equalConstantTime(existing.capabilityHash, verifiedCapabilityHash)) {
        throw new Error('Idempotency capability mismatch')
      }
      const task = await ctx.db.get(existing.taskId)
      if (!task) throw new Error('Existing audio overview task is unavailable')
      const frozen = task.audioOverviewRequest
      const requestedIds = args.scope.mode === 'explicit'
        ? [...new Set(args.scope.documentIds.map(String))].sort()
        : []
      const frozenIds = frozen?.scope.mode === 'explicit'
        ? [...new Set(frozen.scope.documentIds.map(String))].sort()
        : []
      if (
        String(existing.folderId) !== String(args.folderId)
        || String(existing.roomId) !== String(args.roomId)
        || !frozen
        || frozen.scope.mode !== args.scope.mode
        || requestedIds.length !== frozenIds.length
        || requestedIds.some((id, index) => id !== frozenIds[index])
        || frozen.preferences.lengthMinutes !== args.preferences.lengthMinutes
        || frozen.preferences.complexity !== args.preferences.complexity
        || frozen.voiceProfile.hostA !== args.voiceProfile.hostA
        || frozen.voiceProfile.hostB !== args.voiceProfile.hostB
        || frozen.hostNames?.hostA !== args.hostNames.hostA.trim()
        || frozen.hostNames?.hostB !== args.hostNames.hostB.trim()
      ) {
        throw new Error('Idempotency key was already used for a different audio overview request')
      }
      let status = existing.status
      if (
        existing.status === 'failed'
        && existing.stage === 'failed'
        && existing.error === LEGACY_RETRYABLE_PRELAUNCH_FAILURE
        && task.status === 'failed'
        && task.error === LEGACY_RETRYABLE_PRELAUNCH_FAILURE
      ) {
        const pendingTask = await ctx.db
          .query('tasks')
          .withIndex('by_userId_and_type_and_status', q => q
            .eq('userId', userId)
            .eq('type', 'audio-overview-generation')
            .eq('status', 'pending'))
          .first()
        const runningTask = await ctx.db
          .query('tasks')
          .withIndex('by_userId_and_type_and_status', q => q
            .eq('userId', userId)
            .eq('type', 'audio-overview-generation')
            .eq('status', 'running'))
          .first()
        if (pendingTask || runningTask) {
          throw new Error('An audio overview generation is already active')
        }
        const now = Date.now()
        await ctx.db.patch(existing._id, {
          status: 'accepted',
          stage: 'accepted',
          error: undefined,
          completedAt: undefined,
          updatedAt: now,
        })
        await ctx.db.patch(task._id, {
          status: 'pending',
          progress: 'Preparing…',
          error: undefined,
          completedAt: undefined,
          updatedAt: now,
        })
        status = 'accepted'
      }
      const user = await ctx.db
        .query('users')
        .withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId))
        .unique()
      const quotaDate = task.audioOverviewRequest?.quotaDate ?? new Date().toISOString().slice(0, 10)
      const used = user?.audioOverviewQuota?.date === quotaDate ? user.audioOverviewQuota.count : 0
      const reservedMicrousd = existing.budgetReservedMicrousd
        ?? reserveAudioOverviewBudgetMicrousd(frozen.preferences.lengthMinutes)
      return {
        jobId: existing._id,
        taskId: existing.taskId,
        duplicate: true,
        status,
        quota: { used, cap: AUDIO_OVERVIEW_DAILY_CAP, date: quotaDate },
        budget: { reservedMicrousd },
      }
    }

    const reservedMicrousd = reserveAudioOverviewBudgetMicrousd(args.preferences.lengthMinutes)
    if (reservedMicrousd > AUDIO_OVERVIEW_MAX_JOB_BUDGET_MICRO_USD) {
      throw new Error('Audio overview request exceeds the per-job budget')
    }
    const reservation = await reserveAudioOverviewTask(ctx, userId, args)
    const now = Date.now()
    const jobId = await ctx.db.insert('audioOverviewJobs', {
      userId,
      taskId: reservation.taskId,
      folderId: args.folderId,
      roomId: args.roomId,
      idempotencyKey: args.idempotencyKey,
      capabilityHash: verifiedCapabilityHash,
      status: 'accepted',
      stage: 'accepted',
      completedTurns: 0,
      budgetReservedMicrousd: reservedMicrousd,
      budgetDebitedMicrousd: AUDIO_OVERVIEW_SCRIPT_BUDGET_MICRO_USD,
      budgetDebitKeys: ['script'],
      scriptAttemptsStarted: 0,
      createdAt: now,
      updatedAt: now,
    })
    return {
      jobId,
      taskId: reservation.taskId,
      duplicate: false,
      status: 'accepted' as const,
      quota: reservation.quota,
      budget: { reservedMicrousd },
    }
  },
})

export const adoptLegacyRequest = mutation({
  args: {
    taskId: v.id('tasks'),
    idempotencyKey: v.string(),
    capability: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    validateIdempotencyKey(args.idempotencyKey)
    await requireServerDerivedCapability(userId, args.idempotencyKey, args.capability)
    const verifiedCapabilityHash = await capabilityHash(args.capability)
    const existing = await ctx.db
      .query('audioOverviewJobs')
      .withIndex('by_taskId', q => q.eq('taskId', args.taskId))
      .unique()
    if (existing) {
      if (existing.userId !== userId || !equalConstantTime(existing.capabilityHash, verifiedCapabilityHash)) {
        throw new Error('Legacy audio overview job not found')
      }
      const task = await ctx.db.get(existing.taskId)
      const quotaDate = task?.audioOverviewRequest?.quotaDate ?? new Date().toISOString().slice(0, 10)
      const user = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique()
      const used = user?.audioOverviewQuota?.date === quotaDate ? user.audioOverviewQuota.count : 0
      const lengthMinutes = task?.audioOverviewRequest?.preferences.lengthMinutes ?? 10
      const reservedMicrousd = existing.budgetReservedMicrousd
        ?? reserveAudioOverviewBudgetMicrousd(lengthMinutes)
      return {
        jobId: existing._id,
        taskId: existing.taskId,
        duplicate: true,
        status: existing.status,
        quota: { used, cap: AUDIO_OVERVIEW_DAILY_CAP, date: quotaDate },
        budget: { reservedMicrousd },
      }
    }
    const task = await ctx.db.get(args.taskId)
    if (!task || task.userId !== userId || task.type !== 'audio-overview-generation'
      || task.status !== 'pending' || !task.folderId || !task.audioOverviewRequest) {
      throw new Error('Legacy audio overview generation is not available')
    }
    if (!hasAuthoritativeFrozenSources(task)) {
      throw new Error('Legacy audio overview source has no authoritative immutable revision')
    }
    const now = Date.now()
    const reservedMicrousd = reserveAudioOverviewBudgetMicrousd(task.audioOverviewRequest.preferences.lengthMinutes)
    if (reservedMicrousd > AUDIO_OVERVIEW_MAX_JOB_BUDGET_MICRO_USD) {
      throw new Error('Audio overview request exceeds the per-job budget')
    }
    const jobId = await ctx.db.insert('audioOverviewJobs', {
      userId,
      taskId: task._id,
      folderId: task.folderId,
      roomId: task.audioOverviewRequest.roomId,
      idempotencyKey: args.idempotencyKey,
      capabilityHash: verifiedCapabilityHash,
      status: 'accepted',
      stage: 'accepted',
      completedTurns: 0,
      budgetReservedMicrousd: reservedMicrousd,
      budgetDebitedMicrousd: AUDIO_OVERVIEW_SCRIPT_BUDGET_MICRO_USD,
      budgetDebitKeys: ['script'],
      scriptAttemptsStarted: 0,
      createdAt: now,
      updatedAt: now,
    })
    const user = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique()
    const quotaDate = task.audioOverviewRequest.quotaDate
    const used = user?.audioOverviewQuota?.date === quotaDate ? user.audioOverviewQuota.count : 0
    return {
      jobId,
      taskId: task._id,
      duplicate: false,
      status: 'accepted' as const,
      quota: { used, cap: AUDIO_OVERVIEW_DAILY_CAP, date: quotaDate },
      budget: { reservedMicrousd },
    }
  },
})

export const claimProviderBudget = mutation({
  args: {
    jobId: v.id('audioOverviewJobs'),
    capability: v.string(),
    kind: v.union(v.literal('scene'), v.literal('alignment'), v.literal('entailment-fallback')),
    sceneOrder: v.optional(v.number()),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const job = await requireCapability(ctx, args.jobId, args.capability)
    const task = await ctx.db.get(job.taskId)
    if (!task || task.status === 'failed' || task.status === 'cancelled'
      || job.status === 'failed' || job.status === 'cancelled') {
      return { allowed: false as const, cancelled: true as const }
    }
    let key: string
    let amountMicrousd: number
    if (args.kind === 'scene') {
      if (!Number.isSafeInteger(args.sceneOrder) || args.sceneOrder! < 0 || args.sceneOrder! >= 20
        || !Number.isSafeInteger(args.attempt) || args.attempt! < 1 || args.attempt! > 3) {
        throw new Error('Invalid Scene provider budget claim')
      }
      const scene = await ctx.db
        .query('audioOverviewScenes')
        .withIndex('by_jobId_and_order', q => q.eq('jobId', job._id).eq('order', args.sceneOrder!))
        .unique()
      if (!scene || scene.userId !== job.userId || scene.targetDurationMs < 1 || scene.targetDurationMs > 5 * 60_000) {
        throw new Error('Scene provider budget target is unavailable')
      }
      key = `scene:${args.sceneOrder}:${args.attempt}`
      amountMicrousd = estimateAudioOverviewSceneAttemptMicrousd(scene.targetDurationMs)
    }
    else if (args.kind === 'entailment-fallback') {
      if (args.sceneOrder !== undefined || args.attempt !== undefined || job.totalTurns !== undefined) {
        throw new Error('Invalid entailment fallback provider budget claim')
      }
      key = 'entailment-fallback'
      amountMicrousd = AUDIO_OVERVIEW_ENTAILMENT_VERIFICATION_BUDGET_MICRO_USD
    }
    else {
      if (args.sceneOrder !== undefined || args.attempt !== undefined || job.status !== 'completed') {
        throw new Error('Invalid Alignment provider budget claim')
      }
      const episode = await ctx.db
        .query('audioOverviewEpisodes')
        .withIndex('by_jobId', q => q.eq('jobId', job._id))
        .unique()
      const artifact = episode?.finalArtifactId ? await ctx.db.get(episode.finalArtifactId) : null
      if (!episode || !artifact || artifact.userId !== job.userId || artifact.kind !== 'final') {
        throw new Error('Alignment provider budget target is unavailable')
      }
      key = 'alignment'
      amountMicrousd = estimateAudioOverviewAlignmentMicrousd(artifact.durationMs)
    }

    const keys = job.budgetDebitKeys ?? ['script']
    const debitedMicrousd = job.budgetDebitedMicrousd ?? AUDIO_OVERVIEW_SCRIPT_BUDGET_MICRO_USD
    const reservedMicrousd = job.budgetReservedMicrousd
      ?? reserveAudioOverviewBudgetMicrousd(task.audioOverviewRequest?.preferences.lengthMinutes ?? 10)
    if (keys.includes(key)) {
      return { allowed: true as const, duplicate: true as const, amountMicrousd, debitedMicrousd, reservedMicrousd }
    }
    if (keys.length >= 62 || debitedMicrousd + amountMicrousd > reservedMicrousd) {
      throw new Error('Audio overview provider budget exhausted')
    }
    const nextDebitedMicrousd = debitedMicrousd + amountMicrousd
    await ctx.db.patch(job._id, {
      budgetReservedMicrousd: reservedMicrousd,
      budgetDebitedMicrousd: nextDebitedMicrousd,
      budgetDebitKeys: [...keys, key],
      updatedAt: Date.now(),
    })
    return {
      allowed: true as const,
      duplicate: false as const,
      amountMicrousd,
      debitedMicrousd: nextDebitedMicrousd,
      reservedMicrousd,
    }
  },
})

export const getStepContext = query({
  args: { jobId: v.id('audioOverviewJobs'), capability: v.string(), turnOrder: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const job = await requireCapability(ctx, args.jobId, args.capability)
    const task = await ctx.db.get(job.taskId)
    if (!task || task.userId !== job.userId || task.folderId !== job.folderId || !task.audioOverviewRequest) {
      throw new Error('Audio overview task is unavailable')
    }
    const turn = args.turnOrder === undefined
      ? null
      : await ctx.db
          .query('audioOverviewJobTurns')
          .withIndex('by_jobId_and_order', q => q.eq('jobId', job._id).eq('order', args.turnOrder!))
          .unique()
    return { job, task, request: task.audioOverviewRequest, turn, cancelled: task.status === 'cancelled' || job.status === 'cancelled' }
  },
})

export const getAlignmentContext = query({
  args: { jobId: v.id('audioOverviewJobs'), capability: v.string(), turnOrder: v.number() },
  handler: async (ctx, args) => {
    const job = await requireCapability(ctx, args.jobId, args.capability)
    const turn = await ctx.db
      .query('audioOverviewJobTurns')
      .withIndex('by_jobId_and_order', q => q.eq('jobId', job._id).eq('order', args.turnOrder))
      .unique()
    if (!turn || turn.status !== 'ready' || !turn.audioFileId || turn.durationMs === undefined) {
      throw new Error('Audio overview turn is not ready for alignment')
    }
    return {
      skip: job.ttsEngine === 'dia' || !!turn.wordTimings?.length,
      audioUrl: await ctx.storage.getUrl(turn.audioFileId),
    }
  },
})

export const commitAlignment = mutation({
  args: {
    jobId: v.id('audioOverviewJobs'), capability: v.string(), turnOrder: v.number(),
    wordTimings: v.array(wordTimingValidator),
  },
  handler: async () => rejectLegacyAudioOverviewWrite(),
})

export const setProgress = mutation({
  args: { jobId: v.id('audioOverviewJobs'), capability: v.string(), progress: v.string(), stage: v.optional(v.union(v.literal('preparing'), v.literal('synthesizing'), v.literal('finalizing'))) },
  handler: async (ctx, args) => {
    const job = await requireCapability(ctx, args.jobId, args.capability)
    const task = await ctx.db.get(job.taskId)
    if (!isActiveTask(task) || job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return { active: false }
    const now = Date.now()
    await ctx.db.patch(task!._id, { status: 'running', progress: args.progress.slice(0, 160), updatedAt: now })
    await ctx.db.patch(job._id, { status: 'running', stage: args.stage ?? job.stage, updatedAt: now })
    return { active: true }
  },
})

export const beginScriptGeneration = mutation({
  args: { jobId: v.id('audioOverviewJobs'), capability: v.string() },
  handler: async (ctx, args) => {
    const job = await requireCapability(ctx, args.jobId, args.capability)
    const task = await ctx.db.get(job.taskId)
    if (!isActiveTask(task) || job.status === 'cancelled') return { proceed: false as const, cancelled: true as const }
    if (job.totalTurns !== undefined) return { proceed: false as const, completed: true as const }
    if (job.scriptAttemptId) return { proceed: false as const, ambiguous: true as const }
    const attemptsStarted = job.scriptAttemptsStarted ?? 0
    const attempt = attemptsStarted + 1
    if (attempt > 3) throw new Error('Dialogue generation retry limit reached')

    const keys = job.budgetDebitKeys ?? ['script']
    const debitedMicrousd = job.budgetDebitedMicrousd ?? AUDIO_OVERVIEW_SCRIPT_BUDGET_MICRO_USD
    const reservedMicrousd = job.budgetReservedMicrousd
      ?? reserveAudioOverviewBudgetMicrousd(task!.audioOverviewRequest?.preferences.lengthMinutes ?? 10)
    const budgetKey = attempt === 1 ? 'script' : `script:${attempt}`
    const extraDebit = keys.includes(budgetKey) ? 0 : AUDIO_OVERVIEW_SCRIPT_BUDGET_MICRO_USD
    if (debitedMicrousd + extraDebit > reservedMicrousd) {
      throw new Error('Audio overview provider budget exhausted')
    }
    const now = Date.now()
    const attemptId = crypto.randomUUID()
    await ctx.db.patch(job._id, {
      scriptAttemptId: attemptId,
      scriptAttemptStartedAt: now,
      scriptAttemptsStarted: attempt,
      budgetReservedMicrousd: reservedMicrousd,
      budgetDebitedMicrousd: debitedMicrousd + extraDebit,
      budgetDebitKeys: extraDebit > 0 ? [...keys, budgetKey] : keys,
      updatedAt: now,
    })
    return { proceed: true as const, attemptId, attempt }
  },
})

export const releaseScriptGeneration = mutation({
  args: { jobId: v.id('audioOverviewJobs'), capability: v.string(), attemptId: v.string() },
  handler: async (ctx, args) => {
    const job = await requireCapability(ctx, args.jobId, args.capability)
    if (job.totalTurns !== undefined || job.scriptAttemptId !== args.attemptId) return { released: false }
    await ctx.db.patch(job._id, { scriptAttemptId: undefined, scriptAttemptStartedAt: undefined, updatedAt: Date.now() })
    return { released: true }
  },
})

export const beginTurnSynthesis = mutation({
  args: { jobId: v.id('audioOverviewJobs'), capability: v.string(), turnOrder: v.number() },
  handler: async () => rejectLegacyAudioOverviewWrite(),
})

export const releaseTurnSynthesis = mutation({
  args: { jobId: v.id('audioOverviewJobs'), capability: v.string(), turnOrder: v.number(), attemptId: v.string() },
  handler: async () => rejectLegacyAudioOverviewWrite(),
})

export const commitScript = mutation({
  args: {
    jobId: v.id('audioOverviewJobs'),
    capability: v.string(),
    title: v.string(),
    model: v.string(),
    ttsEngine: v.union(v.literal('aura-1'), v.literal('dia')),
    sourceDocumentIds: v.array(v.id('documents')),
    turns: v.array(scriptTurnValidator),
  },
  handler: async () => rejectLegacyAudioOverviewWrite(),
})

export const prepareTurnUpload = mutation({
  args: { jobId: v.id('audioOverviewJobs'), capability: v.string(), turnOrder: v.number() },
  handler: async () => rejectLegacyAudioOverviewWrite(),
})

export const beginTurnUpload = mutation({
  args: {
    jobId: v.id('audioOverviewJobs'), capability: v.string(), turnOrder: v.number(),
    claimId: v.id('audioOverviewUploadClaims'), expectedSha256: v.string(), expectedSize: v.number(),
  },
  handler: async () => rejectLegacyAudioOverviewWrite(),
})

function storageSha256AsHex(value: string): string {
  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase()
  try { return Array.from(atob(value), byte => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('') }
  catch { return value }
}

export const getTurnUploadContext = internalQuery({
  args: {
    jobId: v.id('audioOverviewJobs'), capability: v.string(), turnOrder: v.number(),
    claimId: v.id('audioOverviewUploadClaims'), storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    const job = await requireCapability(ctx, args.jobId, args.capability)
    const turn = await ctx.db
      .query('audioOverviewJobTurns')
      .withIndex('by_jobId_and_order', q => q.eq('jobId', job._id).eq('order', args.turnOrder))
      .unique()
    const claim = await ctx.db.get(args.claimId)
    if (turn?.status === 'ready' && turn.audioFileId === args.storageId) return { alreadyComplete: true as const }
    if (!turn || !claim || turn.uploadClaimId !== claim._id || claim.jobTurnId !== turn._id || claim.taskId !== job.taskId
      || claim.consumedAt || claim.expiresAt < Date.now() || !claim.begunAt) throw new Error('Audio upload claim not found')
    const metadata = await ctx.db.system.get('_storage', args.storageId)
    if (!metadata || !claim.expectedSha256 || !claim.expectedSize || storageSha256AsHex(metadata.sha256) !== claim.expectedSha256 || metadata.size !== claim.expectedSize) {
      throw new Error('Storage blob does not match upload claim')
    }
    if (metadata.contentType && !metadata.contentType.startsWith('audio/')) throw new Error('Storage blob is not audio')
    const existingOwner = await ctx.db
      .query('audioOverviewUploadClaims')
      .withIndex('by_storageId', q => q.eq('storageId', args.storageId))
      .unique()
    if (existingOwner && existingOwner._id !== claim._id) throw new Error('Storage blob is already claimed')
    return { alreadyComplete: false as const, nonce: claim.nonce }
  },
})

export const completeVerifiedTurn = internalMutation({
  args: {
    jobId: v.id('audioOverviewJobs'), capability: v.string(), turnOrder: v.number(),
    claimId: v.id('audioOverviewUploadClaims'), storageId: v.id('_storage'), durationMs: v.number(),
    wordTimings: v.optional(v.array(wordTimingValidator)),
  },
  handler: async (ctx, args) => {
    validateTiming(args.durationMs, args.wordTimings)
    const job = await requireCapability(ctx, args.jobId, args.capability)
    const task = await ctx.db.get(job.taskId)
    const turn = await ctx.db
      .query('audioOverviewJobTurns')
      .withIndex('by_jobId_and_order', q => q.eq('jobId', job._id).eq('order', args.turnOrder))
      .unique()
    const claim = await ctx.db.get(args.claimId)
    if (turn?.status === 'ready' && turn.audioFileId === args.storageId) {
      return { cancelled: false as const, completedTurns: job.completedTurns }
    }
    if (!turn || !claim || turn.uploadClaimId !== claim._id || claim.jobTurnId !== turn._id || claim.taskId !== job.taskId
      || claim.consumedAt || claim.expiresAt < Date.now() || !claim.begunAt) throw new Error('Audio upload claim not found')
    const metadata = await ctx.db.system.get('_storage', args.storageId)
    if (!metadata || !claim.expectedSha256 || !claim.expectedSize || storageSha256AsHex(metadata.sha256) !== claim.expectedSha256 || metadata.size !== claim.expectedSize) {
      throw new Error('Storage blob does not match upload claim')
    }
    if (!isActiveTask(task) || job.status === 'cancelled') {
      await ctx.storage.delete(args.storageId)
      await ctx.db.delete(claim._id)
      await ctx.db.patch(turn._id, { uploadClaimId: undefined, updatedAt: Date.now() })
      return { cancelled: true as const, completedTurns: job.completedTurns }
    }
    const now = Date.now()
    await ctx.db.patch(claim._id, { storageId: args.storageId, consumedAt: now, expiresAt: Number.MAX_SAFE_INTEGER })
    await ctx.db.patch(turn._id, {
      status: 'ready', audioFileId: args.storageId, durationMs: args.durationMs,
      wordTimings: args.wordTimings, updatedAt: now,
    })
    const completedTurns = job.completedTurns + 1
    await ctx.db.patch(job._id, { completedTurns, updatedAt: now })
    await ctx.db.patch(task!._id, {
      progress: completedTurns < (job.totalTurns ?? completedTurns)
        ? `Synthesizing turn ${completedTurns + 1}/${job.totalTurns}…`
        : 'Finalizing audio overview…',
      updatedAt: now,
    })
    return { cancelled: false as const, completedTurns }
  },
})

export const discardVerifiedTurnUpload = internalMutation({
  args: {
    jobId: v.id('audioOverviewJobs'), capability: v.string(), turnOrder: v.number(),
    claimId: v.id('audioOverviewUploadClaims'), storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    const job = await requireCapability(ctx, args.jobId, args.capability)
    const turn = await ctx.db
      .query('audioOverviewJobTurns')
      .withIndex('by_jobId_and_order', q => q.eq('jobId', job._id).eq('order', args.turnOrder))
      .unique()
    if (turn?.status === 'ready' && turn.audioFileId === args.storageId) return { alreadyComplete: true as const }
    const claim = await ctx.db.get(args.claimId)
    if (!turn || !claim || turn.uploadClaimId !== claim._id || claim.jobTurnId !== turn._id || claim.taskId !== job.taskId
      || claim.consumedAt || claim.storageId || claim.expiresAt < Date.now() || !claim.begunAt) {
      throw new Error('Audio upload claim not found')
    }
    const metadata = await ctx.db.system.get('_storage', args.storageId)
    if (!metadata || !claim.expectedSha256 || !claim.expectedSize
      || storageSha256AsHex(metadata.sha256) !== claim.expectedSha256 || metadata.size !== claim.expectedSize) {
      throw new Error('Storage blob does not match upload claim')
    }
    await ctx.storage.delete(args.storageId)
    await ctx.db.delete(claim._id)
    await ctx.db.patch(turn._id, { uploadClaimId: undefined, updatedAt: Date.now() })
    return { alreadyComplete: false as const }
  },
})

export const finalize = mutation({
  args: { jobId: v.id('audioOverviewJobs'), capability: v.string() },
  handler: async () => rejectLegacyAudioOverviewWrite(),
})

export const fail = mutation({
  args: { jobId: v.id('audioOverviewJobs'), capability: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const job = await requireCapability(ctx, args.jobId, args.capability)
    const task = await ctx.db.get(job.taskId)
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled'
      || task?.status === 'completed' || task?.status === 'cancelled') return { changed: false }
    const now = Date.now()
    const error = args.error.slice(0, 500)
    await ctx.db.patch(job._id, { status: 'failed', stage: 'failed', error, completedAt: now, updatedAt: now })
    if (task && (task.status === 'pending' || task.status === 'running')) {
      await ctx.db.patch(task._id, { status: 'failed', error, completedAt: now, updatedAt: now })
    }
    await ctx.scheduler.runAfter(0, internal.audioOverviewJobs.cleanupStagedMedia, { jobId: job._id })
    return { changed: true }
  },
})

export const cancelForTask = internalMutation({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    const job = await ctx.db
      .query('audioOverviewJobs')
      .withIndex('by_taskId', q => q.eq('taskId', args.taskId))
      .unique()
    if (!job || job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return null
    const now = Date.now()
    await ctx.db.patch(job._id, { status: 'cancelled', stage: 'cancelled', completedAt: now, updatedAt: now })
    await ctx.scheduler.runAfter(0, internal.audioOverviewJobs.cleanupStagedMedia, { jobId: job._id })
    return job._id
  },
})

export const reconcileStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_JOB_MS
    let failed = 0
    let shouldContinue = false
    for (const status of ['accepted', 'running'] as const) {
      const jobs = await ctx.db
        .query('audioOverviewJobs')
        .withIndex('by_status_and_updatedAt', q => q.eq('status', status).lt('updatedAt', cutoff))
        .take(JOB_CLEANUP_BATCH_SIZE)
      if (jobs.length === JOB_CLEANUP_BATCH_SIZE) shouldContinue = true
      for (const job of jobs) {
        const task = await ctx.db.get(job.taskId)
        const now = Date.now()
        if (task?.status === 'cancelled') {
          await ctx.db.patch(job._id, { status: 'cancelled', stage: 'cancelled', completedAt: now, updatedAt: now })
          await ctx.scheduler.runAfter(0, internal.audioOverviewJobs.cleanupStagedMedia, { jobId: job._id })
          continue
        }
        const error = 'Audio overview generation expired before completion'
        await ctx.db.patch(job._id, { status: 'failed', stage: 'failed', error, completedAt: now, updatedAt: now })
        if (task && (task.status === 'pending' || task.status === 'running')) {
          await ctx.db.patch(task._id, { status: 'failed', error, completedAt: now, updatedAt: now })
        }
        await ctx.scheduler.runAfter(0, internal.audioOverviewJobs.cleanupStagedMedia, { jobId: job._id })
        failed += 1
      }
    }
    if (shouldContinue) {
      await ctx.scheduler.runAfter(0, internal.audioOverviewJobs.reconcileStale, {})
    }
    return { failed }
  },
})

export const cleanupTerminalJobs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - TERMINAL_JOB_RETENTION_MS
    let deleted = 0
    let shouldContinue = false
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      const jobs = await ctx.db
        .query('audioOverviewJobs')
        .withIndex('by_status_and_updatedAt', q => q.eq('status', status).lt('updatedAt', cutoff))
        .take(JOB_CLEANUP_BATCH_SIZE)
      if (jobs.length === JOB_CLEANUP_BATCH_SIZE) shouldContinue = true
      for (const job of jobs) {
        const turns = await ctx.db
          .query('audioOverviewJobTurns')
          .withIndex('by_jobId_and_order', q => q.eq('jobId', job._id))
          .take(JOB_TURN_CLEANUP_BATCH_SIZE + 1)
        for (const turn of turns.slice(0, JOB_TURN_CLEANUP_BATCH_SIZE)) {
          if (status !== 'completed' && turn.audioFileId) await ctx.storage.delete(turn.audioFileId)
          if (turn.uploadClaimId) {
            const claim = await ctx.db.get(turn.uploadClaimId)
            if (claim) await ctx.db.delete(claim._id)
          }
          await ctx.db.delete(turn._id)
        }
        if (turns.length > JOB_TURN_CLEANUP_BATCH_SIZE) {
          shouldContinue = true
          continue
        }
        const task = await ctx.db.get(job.taskId)
        await ctx.db.delete(job._id)
        if (task && ['completed', 'failed', 'cancelled'].includes(task.status)) await ctx.db.delete(task._id)
        deleted += 1
      }
    }
    if (shouldContinue) {
      await ctx.scheduler.runAfter(0, internal.audioOverviewJobs.cleanupTerminalJobs, {})
    }
    return { deleted }
  },
})

export const cleanupStagedMedia = internalMutation({
  args: {
    jobId: v.id('audioOverviewJobs'),
    artifactCursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job || (job.status !== 'failed' && job.status !== 'cancelled')) return { deleted: 0 }
    const turns = await ctx.db
      .query('audioOverviewJobTurns')
      .withIndex('by_jobId_and_order', q => q.eq('jobId', job._id))
      .take(JOB_TURN_CLEANUP_BATCH_SIZE + 1)
    let shouldContinue = turns.length > JOB_TURN_CLEANUP_BATCH_SIZE
    let deleted = 0
    for (const turn of turns.slice(0, JOB_TURN_CLEANUP_BATCH_SIZE)) {
      if (turn.audioFileId) {
        await ctx.storage.delete(turn.audioFileId)
        deleted += 1
      }
      if (turn.uploadClaimId) {
        const claim = await ctx.db.get(turn.uploadClaimId)
        if (claim?.begunAt && !claim.storageId && claim.begunAt + LATE_UPLOAD_RECONCILIATION_MS > Date.now()) {
          const cleanupAt = claim.begunAt + LATE_UPLOAD_RECONCILIATION_MS
          await ctx.db.patch(claim._id, { expiresAt: cleanupAt })
          await ctx.scheduler.runAfter(Math.max(0, cleanupAt - Date.now()), internal.audioOverviewJobs.cleanupStagedMedia, { jobId: job._id })
          continue
        }
        if (claim) await ctx.db.delete(claim._id)
      }
      await ctx.db.delete(turn._id)
    }

    const artifactPage = await ctx.db
      .query('audioOverviewAudioArtifacts')
      .withIndex('by_jobId_and_objectKey', q => q.eq('jobId', job._id))
      .paginate({ cursor: args.artifactCursor ?? null, numItems: 500 })
    const artifacts = artifactPage.page
    shouldContinue ||= !artifactPage.isDone
    const ownedPrefix = `audio-overviews/jobs/${job._id}/`
    let r2Enqueued = 0
    for (const artifact of artifacts) {
      if (artifact.userId !== job.userId || !artifact.objectKey.startsWith(ownedPrefix)) {
        throw new Error('Audio overview artifact ownership mismatch')
      }
      if (artifact.status === 'deleted') continue
      const existingCleanup = await ctx.db
        .query('pendingCleanup')
        .withIndex('by_audioArtifactId', q => q.eq('audioArtifactId', artifact._id))
        .unique()
      if (existingCleanup) {
        if (existingCleanup.userId !== job.userId
          || existingCleanup.kind !== 'r2'
          || existingCleanup.r2Key !== artifact.objectKey) {
          throw new Error('Audio artifact cleanup ownership mismatch')
        }
      }
      else {
        await ctx.db.insert('pendingCleanup', {
          userId: job.userId,
          documentId: `audio-artifact:${artifact._id}`,
          r2Key: artifact.objectKey,
          audioArtifactId: artifact._id,
          kind: 'r2',
          attempts: 0,
        })
        r2Enqueued += 1
      }
      if (artifact.status !== 'deleting') await ctx.db.patch(artifact._id, { status: 'deleting' })
    }
    if (artifacts.some(artifact => artifact.status !== 'deleted')) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.drainPendingCleanup, { userId: job.userId })
    }
    if (shouldContinue) {
      await ctx.scheduler.runAfter(0, internal.audioOverviewJobs.cleanupStagedMedia, artifactPage.isDone
        ? { jobId: job._id }
        : { jobId: job._id, artifactCursor: artifactPage.continueCursor })
    }
    return { deleted, r2Enqueued }
  },
})
