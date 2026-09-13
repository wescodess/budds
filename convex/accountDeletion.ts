import { v } from 'convex/values'
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id, TableNames } from './_generated/dataModel'
import { scheduleAudioOverviewDeletion } from './audioOverviews'
import { isAccountDeletionActive } from './lib/accountDeletionTombstone'

export { isAccountDeletionActive } from './lib/accountDeletionTombstone'

// Convex permits documents close to 1 MiB while mutations have a 16 MiB read
// and write ceiling. Eight rows leaves room for index metadata, the durable
// job/tombstone reads, and cleanup records created in the same transaction.
const DELETE_BATCH_SIZE = 8
const REFERENCE_DELETE_BATCH_SIZE = 8
const CLEANUP_BATCH_SIZE = 20
const STALE_DELETION_JOB_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 10
const BASE_BACKOFF_MS = 30_000
const MAX_BACKOFF_MS = 3_600_000

type AccountDeletionJob = Doc<'accountDeletionJobs'>
type DeletionPhase = AccountDeletionJob['phase']
type PendingCleanupRow = Doc<'pendingCleanup'>

type DirectUserTable =
  | 'messages'
  | 'conversations'
  | 'quizAttempts'
  | 'quizQuestions'
  | 'quizzes'
  | 'flashcards'
  | 'flashcardSets'
  | 'flashcardRoomCards'
  | 'flashcardVersionCards'
  | 'flashcardRoomVersions'
  | 'flashcardRooms'
  | 'learnProfile'
  | 'reviewItems'
  | 'reviewSessions'
  | 'courseSourceDocs'
  | 'courseSections'
  | 'courseDeletionJobs'
  | 'courses'
  | 'audioOverviewJobs'
  | 'audioOverviewRooms'
  | 'rateLimitBuckets'
  | 'tasks'
  | 'folders'
  | 'learnV2'

const DIRECT_PHASES = {
  messages: { table: 'messages', next: 'conversations' },
  conversations: { table: 'conversations', next: 'attemptAnswers' },
  quizAttempts: { table: 'quizAttempts', next: 'quizQuestions' },
  quizQuestions: { table: 'quizQuestions', next: 'quizzes' },
  quizzes: { table: 'quizzes', next: 'flashcards' },
  flashcards: { table: 'flashcards', next: 'flashcardSets' },
  flashcardSets: { table: 'flashcardSets', next: 'flashcardRoomCards' },
  flashcardRoomCards: { table: 'flashcardRoomCards', next: 'flashcardVersionCards' },
  flashcardVersionCards: { table: 'flashcardVersionCards', next: 'flashcardRoomVersions' },
  flashcardRoomVersions: { table: 'flashcardRoomVersions', next: 'flashcardRooms' },
  flashcardRooms: { table: 'flashcardRooms', next: 'learnProfile' },
  learnProfile: { table: 'learnProfile', next: 'reviewItems' },
  reviewItems: { table: 'reviewItems', next: 'reviewSessions' },
  reviewSessions: { table: 'reviewSessions', next: 'calendarEvents' },
  courseSourceDocs: { table: 'courseSourceDocs', next: 'courseSections' },
  courseSections: { table: 'courseSections', next: 'courseDeletionJobs' },
  courseDeletionJobs: { table: 'courseDeletionJobs', next: 'courses' },
  courses: { table: 'courses', next: 'learnV2' },
  audioJobs: { table: 'audioOverviewJobs', next: 'audioRooms' },
  audioRooms: { table: 'audioOverviewRooms', next: 'rateLimitBuckets' },
  rateLimitBuckets: { table: 'rateLimitBuckets', next: 'tasks' },
  tasks: { table: 'tasks', next: 'folders' },
  folders: { table: 'folders', next: 'user' },
} as const satisfies Partial<Record<DeletionPhase, { table: DirectUserTable, next: DeletionPhase }>>

// Child-before-parent order keeps each deletion transaction bounded and never
// leaves V2 rows reachable while the account tombstone is active.
const LEARN_V2_DELETE_ORDER = ['learnFolderSourceManifestEntries', 'learnFolderSourceManifestFolders', 'learnFolderSourceManifests', 'learnLifecycleReceipts', 'learnClaimSupports', 'sessionContentClaims', 'sessionContentBlocks', 'sessionContent', 'studySessionRetrievalObjectives', 'calendarProjections', 'studySessions', 'studyPlanRevisions', 'studyPlans', 'masteryAttempts', 'masteryRecords', 'learnObjectiveSources', 'learnSourceExcerpts', 'learnSourceSnapshots', 'learnObjectivePrerequisites', 'learnObjectives', 'learnMilestones', 'learnBlueprintRevisions', 'learnBlueprints', 'searchReservations', 'searchQuotaBuckets', 'learnJobs', 'reminderPolicies', 'learnSourceIdentities', 'learningVoids'] as const
type LearnV2Table = typeof LEARN_V2_DELETE_ORDER[number]

export function backoffMs(attempts: number): number {
  const capped = Math.min(attempts, 20)
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, capped), MAX_BACKOFF_MS)
}

async function findDeletionJob(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<AccountDeletionJob | null> {
  return await ctx.db
    .query('accountDeletionJobs')
    .withIndex('by_userId', q => q.eq('userId', userId))
    .unique()
}

export const getDeletionTombstone = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const job = await findDeletionJob(ctx, args.userId)
    return job
      ? { active: job.status === 'active', phase: job.phase, startedAt: job.startedAt }
      : null
  },
})

async function ensureStorageCleanup(
  ctx: MutationCtx,
  args: { userId: string, documentId: string, fileId: Id<'_storage'> },
): Promise<boolean> {
  const existing = await ctx.db
    .query('pendingCleanup')
    .withIndex('by_fileId', q => q.eq('fileId', args.fileId))
    .unique()
  if (existing) {
    if (existing.userId !== args.userId || existing.kind !== 'convex-storage') {
      throw new Error('Convex storage cleanup ownership mismatch')
    }
    return false
  }
  await ctx.db.insert('pendingCleanup', {
    userId: args.userId,
    documentId: args.documentId,
    fileId: args.fileId,
    kind: 'convex-storage',
    attempts: 0,
  })
  return true
}

export async function enqueueDocumentCleanup(
  ctx: MutationCtx,
  args: {
    userId: string
    documentId: string
    status: Doc<'documents'>['status']
    r2Key?: string
    fileId?: Id<'_storage'>
  },
): Promise<{ r2Enqueued: boolean, aiSearchEnqueued: boolean, convexStorageEnqueued: boolean }> {
  let r2Enqueued = false
  let aiSearchEnqueued = false
  let convexStorageEnqueued = false

  if (args.r2Key) {
    await ctx.db.insert('pendingCleanup', {
      userId: args.userId,
      documentId: args.documentId,
      r2Key: args.r2Key,
      kind: 'r2',
      attempts: 0,
    })
    r2Enqueued = true
  }

  if (args.status === 'success' || args.status === 'indexing') {
    await ctx.db.insert('pendingCleanup', {
      userId: args.userId,
      documentId: args.documentId,
      r2Key: args.r2Key,
      kind: 'ai-search',
      attempts: 0,
    })
    aiSearchEnqueued = true
  }

  if (args.fileId) {
    convexStorageEnqueued = await ensureStorageCleanup(ctx, {
      userId: args.userId,
      documentId: args.documentId,
      fileId: args.fileId,
    })
  }

  return { r2Enqueued, aiSearchEnqueued, convexStorageEnqueued }
}

async function beginAccountDeletion(ctx: MutationCtx, userId: string) {
  const existing = await findDeletionJob(ctx, userId)
  if (existing) {
    if (existing.status === 'active') {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.runDeletionBatch, { userId })
    }
    return { scheduled: existing.status === 'active', existing: true }
  }

  const now = Date.now()
  await ctx.db.insert('accountDeletionJobs', {
    userId,
    status: 'active',
    phase: 'documents',
    startedAt: now,
    updatedAt: now,
  })
  await ctx.db.insert('pendingCleanup', {
    userId,
    documentId: '__user_bulk__',
    kind: 'ai-search',
    attempts: 0,
  })

  // The tombstone is committed in the same transaction as these schedules.
  // Public/read and worker paths must reject the tombstone immediately; the
  // durable deletion jobs can then safely outlive the Better Auth session.
  await ctx.scheduler.runAfter(0, internal.accountDeletion.stageUserEpisodesForDeletion, {
    userId,
    cursor: null,
  })
  await ctx.scheduler.runAfter(0, internal.audioOverviews.deleteUserOverviews, {
    userId,
    cursor: null,
  })
  await ctx.scheduler.runAfter(0, internal.audioOverviewUploads.cleanupUserClaims, { userId })
  await ctx.scheduler.runAfter(0, internal.accountDeletion.runDeletionBatch, { userId })
  await ctx.scheduler.runAfter(0, internal.accountDeletion.cancelActiveAudioJobs, { userId })
  await ctx.scheduler.runAfter(0, internal.accountDeletion.drainPendingCleanup, { userId })
  return { scheduled: true, existing: false }
}

export const deleteCurrentUser = internalMutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')
    return await beginAccountDeletion(ctx, identity.tokenIdentifier)
  },
})

/** Called only by the server-owned Better Auth beforeDelete hook. */
export const beginAccountDeletionForAuthUser = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => await beginAccountDeletion(ctx, args.userId),
})

// Retained for internal migrations/tests; this now starts the same durable
// workflow instead of attempting an unbounded single transaction.
export const deleteAccountCascade = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => await beginAccountDeletion(ctx, args.userId),
})

/**
 * Stop paid/background work promptly after the tombstone commits. This is a
 * separate bounded mutation so a large job history cannot enlarge the account
 * deletion transaction. Persisted media is removed later by the durable
 * account-deletion phases.
 */
export const cancelActiveAudioJobs = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    if (!(await isAccountDeletionActive(ctx, args.userId))) return { cancelled: 0, hasMore: false }

    const jobs: Doc<'audioOverviewJobs'>[] = []
    for (const status of ['accepted', 'running'] as const) {
      if (jobs.length >= REFERENCE_DELETE_BATCH_SIZE) break
      const remaining = REFERENCE_DELETE_BATCH_SIZE - jobs.length
      jobs.push(...await ctx.db
        .query('audioOverviewJobs')
        .withIndex('by_userId_and_status', q => q.eq('userId', args.userId).eq('status', status))
        .take(remaining))
    }

    const now = Date.now()
    for (const job of jobs) {
      await ctx.db.patch(job._id, {
        status: 'cancelled',
        stage: 'cancelled',
        completedAt: now,
        updatedAt: now,
      })
      const task = await ctx.db.get(job.taskId)
      if (task
        && task.userId === args.userId
        && (task.status === 'pending' || task.status === 'running')) {
        await ctx.db.patch(task._id, {
          status: 'cancelled',
          completedAt: now,
          updatedAt: now,
        })
      }
    }

    const hasMore = jobs.length === REFERENCE_DELETE_BATCH_SIZE
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.cancelActiveAudioJobs, args)
    }
    return { cancelled: jobs.length, hasMore }
  },
})

async function scheduleDeletionBatch(ctx: MutationCtx, userId: string, delayMs = 0) {
  await ctx.scheduler.runAfter(delayMs, internal.accountDeletion.runDeletionBatch, { userId })
}

async function updatePhase(ctx: MutationCtx, job: AccountDeletionJob, phase: DeletionPhase) {
  await ctx.db.patch(job._id, { phase, updatedAt: Date.now() })
  await scheduleDeletionBatch(ctx, job.userId)
}

async function continuePhase(ctx: MutationCtx, job: AccountDeletionJob) {
  await ctx.db.patch(job._id, { updatedAt: Date.now() })
  await scheduleDeletionBatch(ctx, job.userId)
}

async function deleteRows<TableName extends TableNames>(ctx: MutationCtx, rows: Doc<TableName>[]) {
  for (const row of rows) await ctx.db.delete(row._id)
  return rows.length
}

async function deleteDirectUserBatch(ctx: MutationCtx, table: DirectUserTable, userId: string) {
  switch (table) {
    case 'messages': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'conversations': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'quizAttempts': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'quizQuestions': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'quizzes': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'flashcards': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'flashcardSets': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'flashcardRoomCards': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'flashcardVersionCards': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'flashcardRoomVersions': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'flashcardRooms': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'learnProfile': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'reviewItems': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'reviewSessions': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'courseSourceDocs': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'courseSections': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'courseDeletionJobs': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'courses': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'audioOverviewJobs': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'audioOverviewRooms': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'rateLimitBuckets': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'tasks': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
    case 'folders': return await deleteRows(ctx, await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).take(DELETE_BATCH_SIZE))
  }
}

async function deleteLearnV2Table<TableName extends LearnV2Table>(ctx: MutationCtx, table: TableName, userId: string) {
  // The schema guarantees this shared owner index for every listed V2 table;
  // Convex's generic union cannot retain that common index at this call site.
  const rows = await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId as never)).take(DELETE_BATCH_SIZE)
  return await deleteRows(ctx, rows)
}

async function deleteLearnV2Batch(ctx: MutationCtx, job: AccountDeletionJob) {
  for (const table of LEARN_V2_DELETE_ORDER) {
    if (await deleteLearnV2Table(ctx, table, job.userId)) { await continuePhase(ctx, job); return }
  }
  await updatePhase(ctx, job, 'audioMetadata')
}

async function waitForCalendarCleanup(ctx: MutationCtx, job: AccountDeletionJob) {
  const [connection, event, cleanupJob] = await Promise.all([
    ctx.db.query('calendarConnections').withIndex('by_userId', q => q.eq('userId', job.userId)).first(),
    ctx.db.query('calendarEvents').withIndex('by_userId', q => q.eq('userId', job.userId)).first(),
    ctx.db.query('calendarEventCleanupJobs').withIndex('by_userId', q => q.eq('userId', job.userId)).first(),
  ])

  if (job.phase === 'calendarEvents' && connection) {
    await ctx.scheduler.runAfter(0, internal.calendarEvents.startDisconnectForUser, { userId: job.userId })
  }
  if (connection || event || cleanupJob) {
    await ctx.db.patch(job._id, { updatedAt: Date.now() })
    await scheduleDeletionBatch(ctx, job.userId, 30_000)
    return
  }

  if (job.phase === 'calendarEvents') await updatePhase(ctx, job, 'calendarCleanupJobs')
  else if (job.phase === 'calendarCleanupJobs') await updatePhase(ctx, job, 'calendarConnections')
  else await updatePhase(ctx, job, 'courseSourceDocs')
}

async function deleteDocumentBatch(ctx: MutationCtx, job: AccountDeletionJob) {
  const documents = await ctx.db
    .query('documents')
    .withIndex('by_userId', q => q.eq('userId', job.userId))
    .take(REFERENCE_DELETE_BATCH_SIZE)
  if (documents.length === 0) {
    await updatePhase(ctx, job, 'messages')
    return
  }
  for (const doc of documents) {
    await enqueueDocumentCleanup(ctx, {
      userId: job.userId,
      documentId: String(doc._id),
      status: doc.status,
      r2Key: doc.r2Key,
      fileId: doc.fileId,
    })
    await ctx.db.delete(doc._id)
  }
  await continuePhase(ctx, job)
}

async function deleteAttemptAnswerBatch(ctx: MutationCtx, job: AccountDeletionJob) {
  const attempt = await ctx.db
    .query('quizAttempts')
    .withIndex('by_userId', q => q.eq('userId', job.userId))
    .first()
  if (!attempt) {
    await updatePhase(ctx, job, 'quizQuestions')
    return
  }
  const answers = await ctx.db
    .query('attemptAnswers')
    .withIndex('by_attemptId', q => q.eq('attemptId', attempt._id))
    .take(DELETE_BATCH_SIZE)
  for (const answer of answers) await ctx.db.delete(answer._id)
  if (answers.length === 0) await ctx.db.delete(attempt._id)
  await continuePhase(ctx, job)
}

async function deleteOrphanAudioMetadataBatch(ctx: MutationCtx, job: AccountDeletionJob) {
  const overview = await ctx.db
    .query('audioOverviews')
    .withIndex('by_userId', q => q.eq('userId', job.userId))
    .first()
  const episode = await ctx.db
    .query('audioOverviewEpisodes')
    .withIndex('by_userId', q => q.eq('userId', job.userId))
    .first()
  if (overview || episode) {
    await ctx.scheduler.runAfter(0, internal.accountDeletion.stageUserEpisodesForDeletion, {
      userId: job.userId,
      cursor: null,
    })
    await ctx.scheduler.runAfter(0, internal.audioOverviews.deleteUserOverviews, {
      userId: job.userId,
      cursor: null,
    })
    await ctx.db.patch(job._id, { updatedAt: Date.now() })
    await scheduleDeletionBatch(ctx, job.userId, 1_000)
    return
  }

  // Completed episodes are deleted by audioOverviewV2.deleteEpisodeBatch.
  // These child-first sweeps cover durable jobs cancelled before an episode
  // was assembled, plus any legacy orphan left by an interrupted cascade.
  const interjectionSources = await ctx.db.query('audioOverviewInterjectionSources').withIndex('by_userId', q => q.eq('userId', job.userId)).take(DELETE_BATCH_SIZE)
  if (interjectionSources.length) { await deleteRows(ctx, interjectionSources); await continuePhase(ctx, job); return }
  const interjectionUtterances = await ctx.db.query('audioOverviewInterjectionUtterances').withIndex('by_userId', q => q.eq('userId', job.userId)).take(DELETE_BATCH_SIZE)
  if (interjectionUtterances.length) { await deleteRows(ctx, interjectionUtterances); await continuePhase(ctx, job); return }
  const v2Interjections = await ctx.db.query('audioOverviewInterjectionsV2').withIndex('by_userId', q => q.eq('userId', job.userId)).take(DELETE_BATCH_SIZE)
  if (v2Interjections.length) { await deleteRows(ctx, v2Interjections); await continuePhase(ctx, job); return }

  const legacyInterjections = await ctx.db.query('audioOverviewInterjections').withIndex('by_userId', q => q.eq('userId', job.userId)).take(REFERENCE_DELETE_BATCH_SIZE)
  if (legacyInterjections.length) {
    for (const interjection of legacyInterjections) {
      for (const turn of interjection.answerTurns) {
        await ensureStorageCleanup(ctx, {
          userId: job.userId,
          documentId: `audio-interjection-turn:${interjection._id}`,
          fileId: turn.audioFileId,
        })
      }
      await ctx.db.delete(interjection._id)
    }
    await continuePhase(ctx, job)
    return
  }

  const alignmentSegments = await ctx.db.query('audioOverviewAlignmentSegments').withIndex('by_userId', q => q.eq('userId', job.userId)).take(DELETE_BATCH_SIZE)
  if (alignmentSegments.length) { await deleteRows(ctx, alignmentSegments); await continuePhase(ctx, job); return }
  for (const status of ['pending', 'ready', 'failed'] as const) {
    const alignments = await ctx.db.query('audioOverviewAlignments').withIndex('by_userId_and_status', q => q.eq('userId', job.userId).eq('status', status)).take(DELETE_BATCH_SIZE)
    if (alignments.length) { await deleteRows(ctx, alignments); await continuePhase(ctx, job); return }
  }
  const utteranceSources = await ctx.db.query('audioOverviewUtteranceSources').withIndex('by_userId', q => q.eq('userId', job.userId)).take(DELETE_BATCH_SIZE)
  if (utteranceSources.length) { await deleteRows(ctx, utteranceSources); await continuePhase(ctx, job); return }
  const utteranceClaims = await ctx.db.query('audioOverviewUtteranceClaims').withIndex('by_userId', q => q.eq('userId', job.userId)).take(DELETE_BATCH_SIZE)
  if (utteranceClaims.length) { await deleteRows(ctx, utteranceClaims); await continuePhase(ctx, job); return }
  const qualityGates = await ctx.db.query('audioOverviewSceneQualityGates').withIndex('by_userId', q => q.eq('userId', job.userId)).take(DELETE_BATCH_SIZE)
  if (qualityGates.length) { await deleteRows(ctx, qualityGates); await continuePhase(ctx, job); return }
  const utterances = await ctx.db.query('audioOverviewUtterances').withIndex('by_userId', q => q.eq('userId', job.userId)).take(DELETE_BATCH_SIZE)
  if (utterances.length) { await deleteRows(ctx, utterances); await continuePhase(ctx, job); return }
  const scenes = await ctx.db.query('audioOverviewScenes').withIndex('by_userId', q => q.eq('userId', job.userId)).take(DELETE_BATCH_SIZE)
  if (scenes.length) { await deleteRows(ctx, scenes); await continuePhase(ctx, job); return }
  const claimSources = await ctx.db.query('audioOverviewClaimSources').withIndex('by_userId', q => q.eq('userId', job.userId)).take(DELETE_BATCH_SIZE)
  if (claimSources.length) { await deleteRows(ctx, claimSources); await continuePhase(ctx, job); return }
  const claims = await ctx.db.query('audioOverviewClaims').withIndex('by_userId', q => q.eq('userId', job.userId)).take(DELETE_BATCH_SIZE)
  if (claims.length) { await deleteRows(ctx, claims); await continuePhase(ctx, job); return }
  const outlineSources = await ctx.db.query('audioOverviewOutlineSources').withIndex('by_userId', q => q.eq('userId', job.userId)).take(DELETE_BATCH_SIZE)
  if (outlineSources.length) { await deleteRows(ctx, outlineSources); await continuePhase(ctx, job); return }
  const objectives = await ctx.db.query('audioOverviewLearningObjectives').withIndex('by_userId', q => q.eq('userId', job.userId)).take(DELETE_BATCH_SIZE)
  if (objectives.length) { await deleteRows(ctx, objectives); await continuePhase(ctx, job); return }

  const artifacts = await ctx.db.query('audioOverviewAudioArtifacts').withIndex('by_userId', q => q.eq('userId', job.userId)).take(REFERENCE_DELETE_BATCH_SIZE)
  if (artifacts.length) {
    let waitingForExternal = false
    for (const artifact of artifacts) {
      if (artifact.status === 'deleted') {
        await ctx.db.delete(artifact._id)
        continue
      }
      const existing = await ctx.db.query('pendingCleanup').withIndex('by_audioArtifactId', q => q.eq('audioArtifactId', artifact._id)).unique()
      if (existing) {
        if (existing.userId !== job.userId || existing.kind !== 'r2' || existing.r2Key !== artifact.objectKey) {
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
      }
      if (artifact.status !== 'deleting') await ctx.db.patch(artifact._id, { status: 'deleting' })
      waitingForExternal = true
    }
    if (waitingForExternal) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.drainPendingCleanup, { userId: job.userId })
    }
    await ctx.db.patch(job._id, { updatedAt: Date.now() })
    await scheduleDeletionBatch(ctx, job.userId, waitingForExternal ? 30_000 : 0)
    return
  }

  const ledgers = await ctx.db.query('audioOverviewClaimLedgers').withIndex('by_userId', q => q.eq('userId', job.userId)).take(DELETE_BATCH_SIZE)
  if (ledgers.length) { await deleteRows(ctx, ledgers); await continuePhase(ctx, job); return }
  const outlines = await ctx.db.query('audioOverviewOutlines').withIndex('by_userId', q => q.eq('userId', job.userId)).take(DELETE_BATCH_SIZE)
  if (outlines.length) { await deleteRows(ctx, outlines); await continuePhase(ctx, job); return }
  const manifestEntries = await ctx.db.query('audioOverviewSourceManifestEntries').withIndex('by_userId', q => q.eq('userId', job.userId)).take(DELETE_BATCH_SIZE)
  if (manifestEntries.length) { await deleteRows(ctx, manifestEntries); await continuePhase(ctx, job); return }
  const manifests = await ctx.db.query('audioOverviewSourceManifests').withIndex('by_userId', q => q.eq('userId', job.userId)).take(DELETE_BATCH_SIZE)
  if (manifests.length) { await deleteRows(ctx, manifests); await continuePhase(ctx, job); return }

  await updatePhase(ctx, job, 'audioJobTurns')
}

async function deleteAudioReferenceBatch(ctx: MutationCtx, job: AccountDeletionJob) {
  const claims = await ctx.db
    .query('audioOverviewUploadClaims')
    .withIndex('by_userId', q => q.eq('userId', job.userId))
    .take(REFERENCE_DELETE_BATCH_SIZE)
  if (claims.length > 0) {
    for (const claim of claims) {
      const fileId = claim.storageId ?? claim.abortingStorageId
      if (fileId) {
        await ensureStorageCleanup(ctx, {
          userId: job.userId,
          documentId: `audio-upload:${claim._id}`,
          fileId,
        })
      }
      await ctx.db.delete(claim._id)
    }
    await continuePhase(ctx, job)
    return
  }

  const turns = await ctx.db
    .query('audioOverviewJobTurns')
    .withIndex('by_userId', q => q.eq('userId', job.userId))
    .take(REFERENCE_DELETE_BATCH_SIZE)
  if (turns.length === 0) {
    await updatePhase(ctx, job, 'audioJobs')
    return
  }
  for (const turn of turns) {
    if (turn.audioFileId) {
      await ensureStorageCleanup(ctx, {
        userId: job.userId,
        documentId: `audio-job-turn:${turn._id}`,
        fileId: turn.audioFileId,
      })
    }
    await ctx.db.delete(turn._id)
  }
  await continuePhase(ctx, job)
}

async function deleteUserRow(ctx: MutationCtx, job: AccountDeletionJob) {
  const userRow = await ctx.db
    .query('users')
    .withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', job.userId))
    .unique()
  if (userRow) await ctx.db.delete(userRow._id)
  await updatePhase(ctx, job, 'waitingExternal')
}

async function waitForExternalCleanup(ctx: MutationCtx, job: AccountDeletionJob) {
  const [pending, overview, episode, uploadClaim] = await Promise.all([
    ctx.db.query('pendingCleanup').withIndex('by_userId', q => q.eq('userId', job.userId)).first(),
    ctx.db.query('audioOverviews').withIndex('by_userId', q => q.eq('userId', job.userId)).first(),
    ctx.db.query('audioOverviewEpisodes').withIndex('by_userId', q => q.eq('userId', job.userId)).first(),
    ctx.db.query('audioOverviewUploadClaims').withIndex('by_userId', q => q.eq('userId', job.userId)).first(),
  ])

  if (overview || episode) {
    await ctx.scheduler.runAfter(0, internal.accountDeletion.stageUserEpisodesForDeletion, {
      userId: job.userId,
      cursor: null,
    })
    await ctx.scheduler.runAfter(0, internal.audioOverviews.deleteUserOverviews, {
      userId: job.userId,
      cursor: null,
    })
  }
  if (pending) {
    await ctx.scheduler.runAfter(0, internal.accountDeletion.drainPendingCleanup, { userId: job.userId })
  }
  if (uploadClaim) {
    await ctx.db.patch(job._id, { phase: 'audioJobTurns', updatedAt: Date.now() })
    await scheduleDeletionBatch(ctx, job.userId)
    return
  }
  if (pending || overview || episode) {
    await ctx.db.patch(job._id, { updatedAt: Date.now() })
    await scheduleDeletionBatch(ctx, job.userId, 60_000)
    return
  }

  const now = Date.now()
  await ctx.db.patch(job._id, {
    status: 'complete',
    phase: 'complete',
    updatedAt: now,
    completedAt: now,
  })
}

export const runDeletionBatch = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const job = await findDeletionJob(ctx, args.userId)
    if (!job || job.status !== 'active') return { state: 'inactive' as const }

    if (job.phase === 'documents') {
      await deleteDocumentBatch(ctx, job)
      return { state: 'running' as const, phase: job.phase }
    }
    if (job.phase === 'attemptAnswers') {
      await deleteAttemptAnswerBatch(ctx, job)
      return { state: 'running' as const, phase: job.phase }
    }
    if (job.phase === 'calendarEvents'
      || job.phase === 'calendarCleanupJobs'
      || job.phase === 'calendarConnections') {
      await waitForCalendarCleanup(ctx, job)
      return { state: 'running' as const, phase: job.phase }
    }
    if (job.phase === 'audioMetadata') {
      await deleteOrphanAudioMetadataBatch(ctx, job)
      return { state: 'running' as const, phase: job.phase }
    }
    if (job.phase === 'learnV2') {
      await deleteLearnV2Batch(ctx, job)
      return { state: 'running' as const, phase: job.phase }
    }
    if (job.phase === 'audioJobTurns') {
      await deleteAudioReferenceBatch(ctx, job)
      return { state: 'running' as const, phase: job.phase }
    }
    if (job.phase === 'user') {
      await deleteUserRow(ctx, job)
      return { state: 'running' as const, phase: job.phase }
    }
    if (job.phase === 'waitingExternal') {
      await waitForExternalCleanup(ctx, job)
      return { state: 'running' as const, phase: job.phase }
    }
    if (job.phase === 'complete') return { state: 'complete' as const }

    const direct = DIRECT_PHASES[job.phase as keyof typeof DIRECT_PHASES]
    if (!direct) throw new Error(`Unsupported account deletion phase: ${job.phase}`)
    const deleted = await deleteDirectUserBatch(ctx, direct.table, job.userId)
    if (deleted === 0) await updatePhase(ctx, job, direct.next)
    else await continuePhase(ctx, job)
    return { state: 'running' as const, phase: job.phase, deleted }
  },
})

export const resumeStaleDeletionJobs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stale = await ctx.db
      .query('accountDeletionJobs')
      .withIndex('by_status_and_updatedAt', q =>
        q.eq('status', 'active').lt('updatedAt', Date.now() - STALE_DELETION_JOB_MS),
      )
      .take(25)
    for (const job of stale) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.runDeletionBatch, { userId: job.userId })
    }
    return { resumed: stale.length }
  },
})

export const stageUserEpisodesForDeletion = internalMutation({
  args: { userId: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const batch = await ctx.db
      .query('audioOverviewEpisodes')
      .withIndex('by_userId', q => q.eq('userId', args.userId))
      .paginate({ cursor: args.cursor, numItems: 25 })

    for (const episode of batch.page) {
      const existingOverview = episode.compatibilityOverviewId
        ? await ctx.db.get(episode.compatibilityOverviewId)
        : null
      if (existingOverview && existingOverview.userId !== args.userId) {
        throw new Error('Audio overview ownership mismatch')
      }
      if (existingOverview) {
        await scheduleAudioOverviewDeletion(ctx, existingOverview._id, args.userId)
        continue
      }

      const overviewId = await ctx.db.insert('audioOverviews', {
        userId: args.userId,
        folderId: episode.folderId,
        taskId: episode.taskId,
        episodeId: episode._id,
        finalArtifactId: episode.finalArtifactId,
        title: episode.title,
        status: 'deleting',
        model: episode.model,
        turns: [],
        voiceProfile: { hostA: episode.hostAVoice, hostB: episode.hostBVoice },
        preferences: {
          lengthMinutes: episode.requestedLengthMinutes,
          complexity: episode.complexity,
        },
        totalDurationMs: episode.totalDurationMs ?? 0,
      })
      await ctx.db.patch(episode._id, { compatibilityOverviewId: overviewId, status: 'deleting' })
      await scheduleAudioOverviewDeletion(ctx, overviewId, args.userId)
    }

    if (!batch.isDone) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.stageUserEpisodesForDeletion, {
        userId: args.userId,
        cursor: batch.continueCursor,
      })
    }
    return {
      staged: batch.page.length,
      done: batch.isDone,
      continueCursor: batch.isDone ? null : batch.continueCursor,
    }
  },
})

export const listPendingCleanupForUser = internalQuery({
  args: { userId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const rows: PendingCleanupRow[] = []
    for (let attempts = 0; attempts < MAX_ATTEMPTS && rows.length <= CLEANUP_BATCH_SIZE; attempts++) {
      const remaining = CLEANUP_BATCH_SIZE + 1 - rows.length
      rows.push(...await ctx.db
        .query('pendingCleanup')
        .withIndex('by_userId_and_attempts_and_nextAttemptAt', q => q
          .eq('userId', args.userId)
          .eq('attempts', attempts)
          .eq('nextAttemptAt', undefined))
        .take(remaining))
      if (rows.length > CLEANUP_BATCH_SIZE) break
      rows.push(...await ctx.db
        .query('pendingCleanup')
        .withIndex('by_userId_and_attempts_and_nextAttemptAt', q => q
          .eq('userId', args.userId)
          .eq('attempts', attempts)
          .gt('nextAttemptAt', 0)
          .lte('nextAttemptAt', args.now))
        .take(CLEANUP_BATCH_SIZE + 1 - rows.length))
    }
    return rows
  },
})

export const listPendingCleanupSweep = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const rows: PendingCleanupRow[] = []
    const kinds = ['ai-search', 'r2', 'convex-storage'] as const
    for (const [index, kind] of kinds.entries()) {
      // Reserve capacity for every provider so a persistently failing queue of
      // one kind cannot starve storage or another external system forever.
      const kindLimit = index === 0 ? 9 : 8
      const kindRows: PendingCleanupRow[] = []
      let remaining = kindLimit
      kindRows.push(...await ctx.db
        .query('pendingCleanup')
        .withIndex('by_kind_and_attempts_and_nextAttemptAt', q => q
          .eq('kind', kind)
          .eq('attempts', MAX_ATTEMPTS)
          .eq('nextAttemptAt', undefined))
        .take(remaining))
      remaining = kindLimit - kindRows.length
      if (remaining > 0) kindRows.push(...await ctx.db
        .query('pendingCleanup')
        .withIndex('by_kind_and_attempts_and_nextAttemptAt', q => q
          .eq('kind', kind)
          .eq('attempts', MAX_ATTEMPTS)
          .gt('nextAttemptAt', 0)
          .lte('nextAttemptAt', args.now))
        .take(remaining))
      rows.push(...kindRows)
    }
    return rows
  },
})

export const getPendingCleanup = internalQuery({
  args: { id: v.id('pendingCleanup') },
  handler: async (ctx, args) => await ctx.db.get(args.id),
})

async function removePendingCleanupImpl(ctx: MutationCtx, row: PendingCleanupRow) {
  let overviewDeletionToResume: { overviewId: Doc<'audioOverviews'>['_id'], userId: string } | null = null
  if (row.audioArtifactId) {
    const artifact = await ctx.db.get(row.audioArtifactId)
    if (artifact
      && artifact.userId === row.userId
      && artifact.objectKey === row.r2Key
      && artifact.status === 'deleting') {
      await ctx.db.patch(artifact._id, { status: 'deleted' })
      const episode = await ctx.db.get(artifact.episodeId)
      if (episode?.compatibilityOverviewId && episode.userId === row.userId) {
        const overview = await ctx.db.get(episode.compatibilityOverviewId)
        if (overview?.status === 'deleting' && overview.userId === row.userId) {
          overviewDeletionToResume = { overviewId: overview._id, userId: row.userId }
        }
      }
    }
  }
  await ctx.db.delete(row._id)
  if (overviewDeletionToResume) {
    await ctx.scheduler.runAfter(0, internal.audioOverviewV2.deleteEpisodeBatch, overviewDeletionToResume)
  }
}

export const removePendingCleanup = internalMutation({
  args: { id: v.id('pendingCleanup') },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id)
    if (row) await removePendingCleanupImpl(ctx, row)
  },
})

async function recordRetryImpl(ctx: MutationCtx, row: PendingCleanupRow, error: string) {
  const attempts = Math.min(row.attempts + 1, MAX_ATTEMPTS)
  await ctx.db.patch(row._id, {
    attempts,
    lastAttemptAt: Date.now(),
    nextAttemptAt: Date.now() + backoffMs(attempts),
    lastError: error.slice(0, 500),
  })
}

export const recordRetry = internalMutation({
  args: { id: v.id('pendingCleanup'), error: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id)
    if (row) await recordRetryImpl(ctx, row, args.error)
  },
})

export const recordCleanupProgress = internalMutation({
  args: { id: v.id('pendingCleanup'), nextPage: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id)
    if (!row) return
    await ctx.db.patch(row._id, {
      attempts: 0,
      scanPage: Math.max(1, Math.floor(args.nextPage)),
      lastAttemptAt: Date.now(),
      nextAttemptAt: undefined,
      lastError: undefined,
    })
  },
})

export const performConvexStorageCleanup = internalMutation({
  args: { id: v.id('pendingCleanup') },
  handler: async (ctx, args): Promise<CleanupAttemptResult> => {
    const row = await ctx.db.get(args.id)
    if (!row) return { ok: true }
    if (row.kind !== 'convex-storage' || !row.fileId) {
      await recordRetryImpl(ctx, row, 'Convex storage cleanup metadata is invalid')
      return { ok: false, error: 'Convex storage cleanup metadata is invalid' }
    }
    try {
      await ctx.storage.delete(row.fileId)
      await removePendingCleanupImpl(ctx, row)
      return { ok: true }
    }
    catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      await recordRetryImpl(ctx, row, message)
      return { ok: false, error: message }
    }
  },
})

async function performCleanupRow(ctx: ActionCtx, row: PendingCleanupRow): Promise<CleanupAttemptResult> {
  let outcome: CleanupAttemptResult
  if (row.kind === 'convex-storage') {
    outcome = await ctx.runMutation(internal.accountDeletion.performConvexStorageCleanup, { id: row._id })
  }
  else {
    outcome = await ctx.runAction(internal.documentActions.performCleanupAttempt, {
      kind: row.kind,
      userId: row.userId,
      documentId: row.documentId,
      r2Key: row.r2Key,
      scanPage: row.scanPage,
    })
    if (outcome.ok) {
      if ('done' in outcome && outcome.done === false) {
        await ctx.runMutation(internal.accountDeletion.recordCleanupProgress, {
          id: row._id,
          nextPage: outcome.nextPage,
        })
      }
      else {
        await ctx.runMutation(internal.accountDeletion.removePendingCleanup, { id: row._id })
      }
    }
    else {
      await ctx.runMutation(internal.accountDeletion.recordRetry, {
        id: row._id,
        error: outcome.error,
      })
    }
  }
  return outcome
}

export const retryPendingCleanupRow = internalAction({
  args: { id: v.id('pendingCleanup') },
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internal.accountDeletion.getPendingCleanup, args) as PendingCleanupRow | null
    if (!row) return { ok: true } as const
    return await performCleanupRow(ctx, row)
  },
})

export const drainPendingCleanup = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now()
    const fetched = await ctx.runQuery(internal.accountDeletion.listPendingCleanupForUser, {
      userId: args.userId,
      now,
    }) as PendingCleanupRow[]
    const rows = fetched.slice(0, CLEANUP_BATCH_SIZE)
    const hasMore = fetched.length > CLEANUP_BATCH_SIZE
    if (rows.length === 0) return { processed: 0, hasMore: false }

    let retryAttempts: number | null = null
    let madeProgress = false
    for (const row of rows) {
      const outcome = await performCleanupRow(ctx, row)

      if (outcome.ok && 'done' in outcome && outcome.done === false) {
        madeProgress = true
      }
      else if (!outcome.ok && row.attempts + 1 < MAX_ATTEMPTS) {
        retryAttempts = retryAttempts === null
          ? row.attempts + 1
          : Math.min(retryAttempts, row.attempts + 1)
      }
    }

    if (hasMore || madeProgress) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.drainPendingCleanup, { userId: args.userId })
    }
    if (retryAttempts !== null) {
      await ctx.scheduler.runAfter(
        backoffMs(retryAttempts),
        internal.accountDeletion.drainPendingCleanup,
        { userId: args.userId },
      )
    }
    return { processed: rows.length, hasMore: hasMore || madeProgress }
  },
})

export const sweepPendingCleanup = internalAction({
  args: {},
  handler: async (ctx): Promise<{ usersProcessed: number, rowsConsidered: number }> => {
    const rows = await ctx.runQuery(internal.accountDeletion.listPendingCleanupSweep, {
      now: Date.now(),
    }) as PendingCleanupRow[]
    const userIds = Array.from(new Set(rows.map(row => row.userId)))
    const progressedUsers = new Set<string>()
    for (const row of rows) {
      const outcome = await ctx.runAction(internal.accountDeletion.retryPendingCleanupRow, { id: row._id })
      if (outcome.ok && 'done' in outcome && outcome.done === false) {
        progressedUsers.add(row.userId)
      }
    }
    for (const userId of progressedUsers) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.drainPendingCleanup, { userId })
    }
    return { usersProcessed: userIds.length, rowsConsidered: rows.length }
  },
})

export type CleanupAttemptResult =
  | { ok: true }
  | { ok: true, done: false, nextPage: number }
  | { ok: false, error: string }
