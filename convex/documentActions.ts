"use node";
import { v } from 'convex/values'
import { internalAction, type ActionCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { S3Client, PutObjectCommand, DeleteObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3'
async function loadExtractors() {
  return await import('./sourceExtractors')
}

const FAILED_DOCUMENT_RETENTION_MS = 10_000
const AI_SEARCH_MAX_FILE_BYTES = 4 * 1024 * 1024
const SEARCH_INDEX_UNAVAILABLE = 'Search index unavailable'
const MAX_INDEX_VERIFICATION_ATTEMPTS = 6
const MAX_INDEX_REPAIR_ATTEMPTS = 6
const MAX_INDEX_JOB_POLL_ATTEMPTS = 180

type CleanupAttemptResult =
  | { ok: true }
  | { ok: false; error: string }

function getR2Client() {
  const endpoint = process.env.R2_ENDPOINT
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('Missing R2 credentials: R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY must all be set')
  }
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  })
}

function sanitizeUserSegment(userId: string): string {
  return userId.replace(/^https?:\/\//, '').replace(/[|:]/g, '_')
}

function getAiSearchConfig() {
  const accountId = process.env.CF_ACCOUNT_ID
  const instance = process.env.CLOUDFLARE_AI_SEARCH_INSTANCE
  const token = process.env.CLOUDFLARE_AI_SEARCH_TOKEN
  if (!accountId || !instance || !token) return null
  return { accountId, instance, token }
}

interface AiSearchItem {
  key: string
  source_id?: string | null
  status: 'queued' | 'running' | 'completed' | 'error' | 'skipped' | 'outdated'
  chunks_count?: number | null
  error?: string | null
  metadata?: Record<string, string | number | boolean> | null
}

type AiSearchItemVerification =
  | { kind: 'ready' }
  | { kind: 'metadata_mismatch' }
  | { kind: 'terminal' }
  | { kind: 'transient' }

async function verifyAiSearchItem(
  config: NonNullable<ReturnType<typeof getAiSearchConfig>>,
  key: string,
  expected: { userId: string, folderId: string, documentId: string },
): Promise<AiSearchItemVerification> {
  const bucket = process.env.R2_BUCKET_NAME
  if (!bucket) return { kind: 'terminal' }
  const sourceId = `r2:${bucket}`

  try {
    const url = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-search/instances/${config.instance}/items`,
    )
    url.searchParams.set('key', key)
    url.searchParams.set('source', sourceId)
    url.searchParams.set('per_page', '1')

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${config.token}` },
    })
    if (!response.ok) return { kind: 'transient' }

    const data = await response.json() as { success?: boolean, result?: AiSearchItem[] }
    if (data.success !== true || !Array.isArray(data.result)) return { kind: 'transient' }

    const item = data.result.find(candidate => candidate.key === key && candidate.source_id === sourceId)
    if (!item) return { kind: 'transient' }
    if (item.status === 'completed') {
      if ((item.chunks_count ?? 0) <= 0) return { kind: 'terminal' }
      const metadata = Object.fromEntries(
        Object.entries(item.metadata ?? {}).map(([name, value]) => [name.toLowerCase(), String(value)]),
      )
      if (
        metadata.userid !== expected.userId
        || metadata.folderid !== expected.folderId
        || metadata.documentid !== expected.documentId
      ) {
        return { kind: 'metadata_mismatch' }
      }
      return { kind: 'ready' }
    }
    if (item.status === 'error' || item.status === 'skipped') return { kind: 'terminal' }
    return { kind: 'transient' }
  }
  catch {
    return { kind: 'transient' }
  }
}

async function markSearchIndexUnavailable(
  ctx: ActionCtx,
  args: {
    documentId: Id<'documents'>
    taskId?: Id<'tasks'>
    expected: {
      indexJobId?: string
      folderId: Id<'folders'>
      r2Key?: string
    }
  },
) {
  const committed = await ctx.runMutation(internal.documents.finalizeDocumentIndexing, {
    id: args.documentId,
    expectedIndexJobId: args.expected.indexJobId,
    expectedFolderId: args.expected.folderId,
    expectedR2Key: args.expected.r2Key,
    status: 'failed',
    failureReason: SEARCH_INDEX_UNAVAILABLE,
  })
  if (!committed) return false

  if (args.taskId) {
    await ctx.runMutation(internal.tasks.fail, {
      taskId: args.taskId,
      error: SEARCH_INDEX_UNAVAILABLE,
    })
  }
  return true
}

async function verifyAndFinalizeDocumentIndex(
  ctx: ActionCtx,
  doc: Doc<'documents'>,
  config: NonNullable<ReturnType<typeof getAiSearchConfig>>,
  args: {
    documentId: Id<'documents'>
    jobId: string
    verificationAttempt?: number
    repairAttempt?: number
  },
) {
  if (doc.indexJobId !== args.jobId) return

  const verification = doc.r2Key
    ? await verifyAiSearchItem(config, doc.r2Key, {
        userId: doc.userId,
        folderId: String(doc.folderId),
        documentId: String(doc._id),
      })
    : { kind: 'terminal' as const }

  if (verification.kind === 'metadata_mismatch') {
    const repairAttempt = args.repairAttempt ?? 0
    if (repairAttempt >= MAX_INDEX_REPAIR_ATTEMPTS) {
      await markSearchIndexUnavailable(ctx, {
        documentId: args.documentId,
        taskId: doc.taskId,
        expected: {
          indexJobId: args.jobId,
          folderId: doc.folderId,
          r2Key: doc.r2Key,
        },
      })
      return
    }
    await ctx.scheduler.runAfter(0, internal.documentActions.updateDocumentAiSearchMetadata, {
      documentId: args.documentId,
      userId: doc.userId,
      folderId: String(doc.folderId),
      filename: doc.filename,
      r2Key: doc.r2Key,
      expectedJobId: args.jobId,
      repairAttempt: repairAttempt + 1,
    })
    return
  }

  if (verification.kind === 'transient') {
    const attempt = args.verificationAttempt ?? 0
    if (attempt < MAX_INDEX_VERIFICATION_ATTEMPTS) {
      await ctx.scheduler.runAfter(10_000, internal.documentActions.pollIndexingStatus, {
        documentId: args.documentId,
        jobId: args.jobId,
        verificationAttempt: attempt + 1,
        repairAttempt: args.repairAttempt,
      })
      return
    }
  }

  if (verification.kind !== 'ready') {
    await markSearchIndexUnavailable(ctx, {
      documentId: args.documentId,
      taskId: doc.taskId,
      expected: {
        indexJobId: args.jobId,
        folderId: doc.folderId,
        r2Key: doc.r2Key,
      },
    })
    return
  }

  const committed = await ctx.runMutation(internal.documents.finalizeDocumentIndexing, {
    id: args.documentId,
    status: 'success',
    expectedIndexJobId: args.jobId,
    expectedFolderId: doc.folderId,
    expectedR2Key: doc.r2Key,
  })
  if (committed && doc.taskId) {
    await ctx.runMutation(internal.tasks.complete, {
      taskId: doc.taskId,
      result: { documentId: String(args.documentId) },
    })
  }
}

type AiSearchJob = { ended_at?: string | null, end_reason?: string | null }

async function readAiSearchJob(
  config: NonNullable<ReturnType<typeof getAiSearchConfig>>,
  jobId: string,
): Promise<AiSearchJob | null> {
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-search/instances/${config.instance}/jobs/${jobId}`
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${config.token}` },
    })
    if (!response.ok) return null
    const data = await response.json() as { success?: boolean, result?: AiSearchJob }
    return data.success === true && data.result ? data.result : null
  }
  catch {
    return null
  }
}

async function startOrFindAiSearchJob(
  config: NonNullable<ReturnType<typeof getAiSearchConfig>>,
): Promise<{ jobId: string, piggybacked: boolean } | null> {
  const jobsUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-search/instances/${config.instance}/jobs`
  try {
    const response = await fetch(jobsUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.token}` },
    })
    if (response.ok) {
      const data = await response.json() as { success?: boolean, result?: { id?: string } }
      const jobId = data.success === true ? data.result?.id : undefined
      return jobId ? { jobId, piggybacked: false } : null
    }
    if (response.status !== 429) return null

    const listResponse = await fetch(jobsUrl, {
      headers: { 'Authorization': `Bearer ${config.token}` },
    })
    if (!listResponse.ok) return null
    const data = await listResponse.json() as {
      success?: boolean
      result?: Array<{ id?: string, ended_at?: string | null }>
    }
    if (data.success !== true) return null
    const jobId = data.result?.find(job => !job.ended_at)?.id
    return jobId ? { jobId, piggybacked: true } : null
  }
  catch {
    return null
  }
}

async function performCleanupAttemptInternal(args: {
  kind: 'ai-search' | 'r2'
  userId: string
  documentId: string
  r2Key?: string
}): Promise<CleanupAttemptResult> {
  try {
    if (args.kind === 'r2') {
      if (!args.r2Key) return { ok: true }
      const bucket = process.env.R2_BUCKET_NAME
      if (!bucket) return { ok: true }
      try {
        const r2 = getR2Client()
        await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: args.r2Key }))
        return { ok: true }
      } catch (error: unknown) {
        if (isAwsNotFound(error)) return { ok: true }
        const msg = error instanceof Error ? error.message : String(error)
        return { ok: false, error: `R2 delete failed: ${msg}` }
      }
    }

    const config = getAiSearchConfig()
    if (!config) return { ok: true }

    if (args.documentId === '__user_bulk__') {
      const listUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-search/instances/${config.instance}/documents?filter=${encodeURIComponent(`userId:${args.userId}`)}`
      const listRes = await fetch(listUrl, {
        headers: { 'Authorization': `Bearer ${config.token}` },
      })
      if (listRes.status === 404) return { ok: true }
      if (!listRes.ok) {
        const text = (await listRes.text()).slice(0, 500)
        return { ok: false, error: `AI Search list failed (${listRes.status}): ${text}` }
      }
      const data = (await listRes.json()) as { result?: Array<{ id?: string }> }
      const ids = (data.result ?? []).map((r) => r.id).filter((id): id is string => typeof id === 'string')
      if (ids.length === 0) return { ok: true }

      for (const id of ids) {
        const res = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-search/instances/${config.instance}/documents/${encodeURIComponent(id)}`,
          { method: 'DELETE', headers: { 'Authorization': `Bearer ${config.token}` } },
        )
        if (!res.ok && res.status !== 404) {
          const text = (await res.text()).slice(0, 500)
          return { ok: false, error: `AI Search delete ${id} failed (${res.status}): ${text}` }
        }
      }
      return { ok: true }
    }

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-search/instances/${config.instance}/documents/${encodeURIComponent(args.documentId)}`,
      { method: 'DELETE', headers: { 'Authorization': `Bearer ${config.token}` } },
    )
    if (res.ok || res.status === 404) return { ok: true }
    const text = (await res.text()).slice(0, 500)
    return { ok: false, error: `AI Search delete failed (${res.status}): ${text}` }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    return { ok: false, error: msg }
  }
}

async function failDocumentIngestion(
  ctx: ActionCtx,
  args: {
    documentId: Id<'documents'>
    fileId?: Id<'_storage'>
    failureReason: string
    r2Key?: string
    cleanupAiSearch?: boolean
    taskId?: Id<'tasks'>
  },
) {
  const doc = await ctx.runQuery(internal.documents.getDocument, { id: args.documentId })
  if (!doc || doc.status === 'failed' || doc.status === 'success') return

  const taskId = args.taskId ?? doc.taskId
  if (taskId) {
    await ctx.runMutation(internal.tasks.fail, { taskId, error: args.failureReason })
  }

  const userId = doc.userId
  const r2Key = args.r2Key ?? doc.r2Key

  await ctx.runMutation(internal.documents.updateDocumentStatus, {
    id: args.documentId,
    status: 'failed',
    failureReason: args.failureReason,
    r2Key,
  })

  if (args.fileId) {
    try {
      await ctx.storage.delete(args.fileId)
    } catch {
      // best-effort; storage may already be gone
    }
  }

  const r2Cleanup = r2Key
    ? await performCleanupAttemptInternal({
      kind: 'r2',
      userId,
      documentId: String(args.documentId),
      r2Key,
    })
    : { ok: true } satisfies CleanupAttemptResult

  const aiSearchCleanup = args.cleanupAiSearch
    ? await performCleanupAttemptInternal({
      kind: 'ai-search',
      userId,
      documentId: String(args.documentId),
      r2Key,
    })
    : { ok: true } satisfies CleanupAttemptResult

  const { r2Enqueued, aiSearchEnqueued } = await ctx.runMutation(
    internal.documents.enqueueFailedDocumentCleanup,
    {
      userId,
      documentId: String(args.documentId),
      retryAiSearch: !aiSearchCleanup.ok,
      retryR2: !r2Cleanup.ok,
      r2Key,
    },
  )

  if (r2Enqueued || aiSearchEnqueued) {
    await ctx.scheduler.runAfter(0, internal.accountDeletion.drainPendingCleanup, {
      userId,
    })
  }

  await ctx.scheduler.runAfter(FAILED_DOCUMENT_RETENTION_MS, internal.documents.removeFailedDocument, {
    id: args.documentId,
  })
}

function getR2Extension(filename: string, mimeType?: string): string {
  const extFromName = filename.lastIndexOf('.') !== -1
    ? filename.slice(filename.lastIndexOf('.'))
    : null
  if (extFromName) return extFromName

  const mimeMap: Record<string, string> = {
    'application/pdf': '.pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'text/plain': '.txt',
    'text/markdown': '.md',
    'text/csv': '.csv',
    'text/html': '.html',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
  }
  return (mimeType && mimeMap[mimeType]) || '.bin'
}

async function uploadToR2AndSync(
  ctx: ActionCtx,
  args: {
    documentId: Id<'documents'>
    fileId?: Id<'_storage'>
    userId: string
    folderId: Id<'folders'>
    filename: string
    r2Key: string
    body: string | Uint8Array
    contentType: string
    taskId?: Id<'tasks'>
  },
) {
  const bucket = process.env.R2_BUCKET_NAME
  if (!bucket) {
    await failDocumentIngestion(ctx, {
      documentId: args.documentId,
      fileId: args.fileId,
      failureReason: 'Missing R2 configuration',
      taskId: args.taskId,
    })
    return
  }

  if (args.taskId) {
    await ctx.runMutation(internal.tasks.updateProgress, { taskId: args.taskId, progress: 'Uploading to storage…' })
  }

  const r2 = getR2Client()
  await r2.send(new PutObjectCommand({
    Bucket: bucket,
    Key: args.r2Key,
    Body: args.body,
    ContentType: args.contentType,
    Metadata: {
      userId: args.userId,
      documentId: args.documentId,
      folderId: String(args.folderId),
      filename: args.filename.replace(/[^\x20-\x7E]/g, ''),
    },
  }))

  if (args.taskId) {
    await ctx.runMutation(internal.tasks.updateProgress, { taskId: args.taskId, progress: 'Triggering indexing…' })
  }

  await ctx.runMutation(internal.documents.updateDocumentStatus, {
    id: args.documentId,
    status: 'indexing',
    r2Key: args.r2Key,
  })

  if (args.taskId) {
    await ctx.runMutation(internal.tasks.updateProgress, { taskId: args.taskId, progress: 'Indexing for search…' })
  }

  await ctx.scheduler.runAfter(0, internal.documentActions.startDocumentIndexing, {
    documentId: args.documentId,
  })
}

export const startDocumentIndexing = internalAction({
  args: {
    documentId: v.id('documents'),
    attempt: v.optional(v.number()),
    repairAttempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.runQuery(internal.documents.getDocument, { id: args.documentId })
    if (!doc || doc.status !== 'indexing') return

    const config = getAiSearchConfig()
    if (!config) {
      await markSearchIndexUnavailable(ctx, {
        documentId: args.documentId,
        taskId: doc.taskId,
        expected: { indexJobId: doc.indexJobId, folderId: doc.folderId, r2Key: doc.r2Key },
      })
      return
    }

    const started = await startOrFindAiSearchJob(config)
    if (!started) {
      const attempt = args.attempt ?? 0
      if (attempt < MAX_INDEX_VERIFICATION_ATTEMPTS) {
        await ctx.scheduler.runAfter(10_000, internal.documentActions.startDocumentIndexing, {
          documentId: args.documentId,
          attempt: attempt + 1,
          repairAttempt: args.repairAttempt,
        })
      } else {
        await markSearchIndexUnavailable(ctx, {
          documentId: args.documentId,
          taskId: doc.taskId,
          expected: { indexJobId: doc.indexJobId, folderId: doc.folderId, r2Key: doc.r2Key },
        })
      }
      return
    }

    const assigned = await ctx.runMutation(internal.documents.assignDocumentIndexJob, {
      id: args.documentId,
      expectedIndexJobId: doc.indexJobId,
      expectedFolderId: doc.folderId,
      expectedR2Key: doc.r2Key,
      indexJobId: started.jobId,
    })
    if (!assigned) return
    if (doc.taskId) {
      await ctx.runMutation(internal.tasks.updateProgress, {
        taskId: doc.taskId,
        progress: 'Indexing for search…',
      })
    }
    await ctx.scheduler.runAfter(10_000, internal.documentActions.pollIndexingStatus, {
      documentId: args.documentId,
      jobId: started.jobId,
      needsResync: started.piggybacked,
      repairAttempt: args.repairAttempt,
    })
  },
})

export const ingestDocument = internalAction({
  args: {
    documentId: v.id('documents'),
    fileId: v.optional(v.id('_storage')),
    userId: v.string(),
    folderId: v.id('folders'),
    filename: v.string(),
    sourceType: v.optional(v.union(v.literal('file'), v.literal('website'), v.literal('youtube'))),
    sourceUrl: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    taskId: v.optional(v.id('tasks')),
  },
  handler: async (ctx, args) => {
    const sourceType = args.sourceType ?? 'file'

    try {
      if (sourceType === 'file') {
        if (!args.fileId) {
          await failDocumentIngestion(ctx, { documentId: args.documentId, failureReason: 'File ID is required for file source type', taskId: args.taskId })
          return
        }

        if (args.taskId) {
          await ctx.runMutation(internal.tasks.updateProgress, { taskId: args.taskId, progress: 'Processing file…' })
        }

        const blob = await ctx.storage.get(args.fileId)
        if (!blob) {
          await failDocumentIngestion(ctx, { documentId: args.documentId, fileId: args.fileId, failureReason: 'File not found in storage', taskId: args.taskId })
          return
        }

        const arrayBuffer = await blob.arrayBuffer()

        if (arrayBuffer.byteLength > AI_SEARCH_MAX_FILE_BYTES) {
          const sizeMB = (arrayBuffer.byteLength / (1024 * 1024)).toFixed(1)
          await failDocumentIngestion(ctx, {
            documentId: args.documentId,
            fileId: args.fileId,
            failureReason: `File is ${sizeMB} MB — exceeds the 4 MB indexing limit. Try splitting it into smaller files.`,
            taskId: args.taskId,
          })
          return
        }

        const ext = getR2Extension(args.filename, args.mimeType)
        const r2Key = `${sanitizeUserSegment(args.userId)}/${args.folderId}/${args.documentId}${ext}`

        await uploadToR2AndSync(ctx, {
          documentId: args.documentId,
          fileId: args.fileId,
          userId: args.userId,
          folderId: args.folderId,
          filename: args.filename,
          r2Key,
          body: new Uint8Array(arrayBuffer),
          contentType: args.mimeType ?? blob.type ?? 'application/octet-stream',
          taskId: args.taskId,
        })
      } else if (sourceType === 'youtube') {
        if (!args.sourceUrl) {
          await failDocumentIngestion(ctx, { documentId: args.documentId, failureReason: 'Source URL is required for YouTube ingestion', taskId: args.taskId })
          return
        }

        if (args.taskId) {
          await ctx.runMutation(internal.tasks.updateProgress, { taskId: args.taskId, progress: 'Fetching transcript…' })
        }

        const { extractYouTubeTranscript } = await loadExtractors()
        const { title, content } = await extractYouTubeTranscript(args.sourceUrl)
        const r2Key = `${sanitizeUserSegment(args.userId)}/${args.folderId}/${args.documentId}.md`

        const resolvedFilename = title || args.filename
        await ctx.runMutation(internal.documents.updateDocumentFilename, { id: args.documentId, filename: resolvedFilename })

        if (args.taskId) {
          await ctx.runMutation(internal.tasks.updateProgress, { taskId: args.taskId, progress: `Uploading "${resolvedFilename}"…` })
        }

        await uploadToR2AndSync(ctx, {
          documentId: args.documentId,
          userId: args.userId,
          folderId: args.folderId,
          filename: resolvedFilename,
          r2Key,
          body: content,
          contentType: 'text/markdown',
          taskId: args.taskId,
        })
      } else if (sourceType === 'website') {
        if (!args.sourceUrl) {
          await failDocumentIngestion(ctx, { documentId: args.documentId, failureReason: 'Source URL is required for website ingestion', taskId: args.taskId })
          return
        }

        if (args.taskId) {
          await ctx.runMutation(internal.tasks.updateProgress, { taskId: args.taskId, progress: 'Extracting content…' })
        }

        const { extractWebsiteContent } = await loadExtractors()
        const { title, content } = await extractWebsiteContent(args.sourceUrl)
        const r2Key = `${sanitizeUserSegment(args.userId)}/${args.folderId}/${args.documentId}.md`

        const resolvedFilename = title || args.filename
        await ctx.runMutation(internal.documents.updateDocumentFilename, { id: args.documentId, filename: resolvedFilename })

        await uploadToR2AndSync(ctx, {
          documentId: args.documentId,
          userId: args.userId,
          folderId: args.folderId,
          filename: resolvedFilename,
          r2Key,
          body: content,
          contentType: 'text/markdown',
          taskId: args.taskId,
        })
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      await failDocumentIngestion(ctx, {
        documentId: args.documentId,
        fileId: args.fileId,
        failureReason: message,
        taskId: args.taskId,
      })
    }
  },
})

export const ingestText = internalAction({
  args: {
    documentId: v.id('documents'),
    userId: v.string(),
    folderId: v.id('folders'),
    filename: v.string(),
    text: v.string(),
    taskId: v.optional(v.id('tasks')),
  },
  handler: async (ctx, args) => {
    try {
      const r2Key = `${sanitizeUserSegment(args.userId)}/${args.folderId}/${args.documentId}.md`

      await uploadToR2AndSync(ctx, {
        documentId: args.documentId,
        userId: args.userId,
        folderId: args.folderId,
        filename: args.filename,
        r2Key,
        body: args.text,
        contentType: 'text/markdown',
        taskId: args.taskId,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      await failDocumentIngestion(ctx, {
        documentId: args.documentId,
        failureReason: message,
        taskId: args.taskId,
      })
    }
  },
})

export const pollIndexingStatus = internalAction({
  args: {
    documentId: v.id('documents'),
    jobId: v.string(),
    needsResync: v.optional(v.boolean()),
    verificationAttempt: v.optional(v.number()),
    pollAttempt: v.optional(v.number()),
    readFailureAttempt: v.optional(v.number()),
    resyncAttempt: v.optional(v.number()),
    repairAttempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.runQuery(internal.documents.getDocument, { id: args.documentId })
    if (!doc || doc.status !== 'indexing' || doc.indexJobId !== args.jobId) return

    const taskId = doc.taskId

    const config = getAiSearchConfig()
    if (!config) {
      await markSearchIndexUnavailable(ctx, {
        documentId: args.documentId,
        taskId,
        expected: { indexJobId: args.jobId, folderId: doc.folderId, r2Key: doc.r2Key },
      })
      return
    }

    if (args.verificationAttempt !== undefined) {
      await verifyAndFinalizeDocumentIndex(ctx, doc, config, {
        documentId: args.documentId,
        jobId: args.jobId,
        verificationAttempt: args.verificationAttempt,
        repairAttempt: args.repairAttempt,
      })
      return
    }

    const job = await readAiSearchJob(config, args.jobId)
    if (!job) {
      const attempt = args.readFailureAttempt ?? 0
      if (attempt < MAX_INDEX_VERIFICATION_ATTEMPTS) {
        await ctx.scheduler.runAfter(10_000, internal.documentActions.pollIndexingStatus, {
          documentId: args.documentId,
          jobId: args.jobId,
          needsResync: args.needsResync,
          pollAttempt: args.pollAttempt,
          readFailureAttempt: attempt + 1,
          resyncAttempt: args.resyncAttempt,
          repairAttempt: args.repairAttempt,
        })
      } else {
        await markSearchIndexUnavailable(ctx, {
          documentId: args.documentId,
          taskId,
          expected: { indexJobId: args.jobId, folderId: doc.folderId, r2Key: doc.r2Key },
        })
      }
      return
    }

    if (job.ended_at) {
      if (job.end_reason) {
        const committed = await ctx.runMutation(internal.documents.finalizeDocumentIndexing, {
          id: args.documentId,
          expectedIndexJobId: args.jobId,
          expectedFolderId: doc.folderId,
          expectedR2Key: doc.r2Key,
          status: 'failed',
          failureReason: `Indexing failed: ${job.end_reason}`,
        })
        if (committed && taskId) {
          await ctx.runMutation(internal.tasks.fail, {
            taskId,
            error: `Indexing failed: ${job.end_reason}`,
          })
        }
      } else if (args.needsResync) {
        const repairAttempt = args.repairAttempt ?? 0
        if (repairAttempt >= MAX_INDEX_REPAIR_ATTEMPTS) {
          await markSearchIndexUnavailable(ctx, {
            documentId: args.documentId,
            taskId,
            expected: { indexJobId: args.jobId, folderId: doc.folderId, r2Key: doc.r2Key },
          })
          return
        }
        const started = await startOrFindAiSearchJob(config)
        if (started) {
          const assigned = await ctx.runMutation(internal.documents.assignDocumentIndexJob, {
            id: args.documentId,
            expectedIndexJobId: args.jobId,
            expectedFolderId: doc.folderId,
            expectedR2Key: doc.r2Key,
            indexJobId: started.jobId,
          })
          if (!assigned) return
          await ctx.scheduler.runAfter(10_000, internal.documentActions.pollIndexingStatus, {
            documentId: args.documentId,
            jobId: started.jobId,
            needsResync: started.piggybacked,
            repairAttempt: repairAttempt + 1,
          })
          return
        }

        const attempt = args.resyncAttempt ?? 0
        if (attempt < MAX_INDEX_VERIFICATION_ATTEMPTS) {
          await ctx.scheduler.runAfter(10_000, internal.documentActions.pollIndexingStatus, {
            documentId: args.documentId,
            jobId: args.jobId,
            needsResync: true,
            pollAttempt: args.pollAttempt,
            resyncAttempt: attempt + 1,
            repairAttempt,
          })
        } else {
          await markSearchIndexUnavailable(ctx, {
            documentId: args.documentId,
            taskId,
            expected: { indexJobId: args.jobId, folderId: doc.folderId, r2Key: doc.r2Key },
          })
        }
      } else {
        await verifyAndFinalizeDocumentIndex(ctx, doc, config, {
          documentId: args.documentId,
          jobId: args.jobId,
          repairAttempt: args.repairAttempt,
        })
      }
    } else {
      const attempt = args.pollAttempt ?? 0
      if (attempt < MAX_INDEX_JOB_POLL_ATTEMPTS) {
        await ctx.scheduler.runAfter(10_000, internal.documentActions.pollIndexingStatus, {
          documentId: args.documentId,
          jobId: args.jobId,
          needsResync: args.needsResync,
          pollAttempt: attempt + 1,
          repairAttempt: args.repairAttempt,
        })
      } else {
        await markSearchIndexUnavailable(ctx, {
          documentId: args.documentId,
          taskId,
          expected: { indexJobId: args.jobId, folderId: doc.folderId, r2Key: doc.r2Key },
        })
      }
    }
  },
})

export const updateDocumentAiSearchMetadata = internalAction({
  args: {
    documentId: v.id('documents'),
    userId: v.string(),
    folderId: v.string(),
    filename: v.string(),
    r2Key: v.optional(v.string()),
    attempt: v.optional(v.number()),
    expectedJobId: v.optional(v.string()),
    repairAttempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.runQuery(internal.documents.getDocument, { id: args.documentId })
    if (
      !doc
      || doc.status !== 'indexing'
      || doc.indexJobId !== args.expectedJobId
      || doc.userId !== args.userId
      || String(doc.folderId) !== args.folderId
      || doc.r2Key !== args.r2Key
    ) return
    const bucket = process.env.R2_BUCKET_NAME
    if (!bucket || !args.r2Key) {
      await markSearchIndexUnavailable(ctx, {
        documentId: args.documentId,
        taskId: doc.taskId,
        expected: { indexJobId: doc.indexJobId, folderId: doc.folderId, r2Key: doc.r2Key },
      })
      return
    }

    try {
      const r2 = getR2Client()
      await r2.send(new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${args.r2Key}`,
        Key: args.r2Key,
        MetadataDirective: 'REPLACE',
        Metadata: {
          userId: args.userId,
          documentId: String(args.documentId),
          folderId: args.folderId,
          filename: args.filename.replace(/[^\x20-\x7E]/g, ''),
        },
      }))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`R2 metadata update failed: ${message}`)
      const attempt = args.attempt ?? 0
      if (attempt < MAX_INDEX_VERIFICATION_ATTEMPTS) {
        await ctx.scheduler.runAfter(10_000, internal.documentActions.updateDocumentAiSearchMetadata, {
          ...args,
          attempt: attempt + 1,
        })
      } else {
        await markSearchIndexUnavailable(ctx, {
          documentId: args.documentId,
          taskId: doc.taskId,
          expected: { indexJobId: doc.indexJobId, folderId: doc.folderId, r2Key: doc.r2Key },
        })
      }
      return
    }

    const current = await ctx.runQuery(internal.documents.getDocument, { id: args.documentId })
    if (
      !current
      || current.status !== 'indexing'
      || current.indexJobId !== args.expectedJobId
      || current.userId !== args.userId
      || String(current.folderId) !== args.folderId
      || current.r2Key !== args.r2Key
    ) return

    await ctx.scheduler.runAfter(0, internal.documentActions.startDocumentIndexing, {
      documentId: args.documentId,
      repairAttempt: args.repairAttempt,
    })
  },
})

// deleteDocumentFromR2 removed — dead code since Story 5.2 rerouted deletions
// through the pendingCleanup queue. See deferred-work.md §story-5.2.

function isAwsNotFound(error: unknown): boolean {
  if (!error) return false
  const e = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } }
  if (e.name === 'NoSuchKey' || e.Code === 'NoSuchKey') return true
  if (e.$metadata?.httpStatusCode === 404) return true
  const msg = error instanceof Error ? error.message : String(error)
  return msg.includes('NoSuchKey') || msg.includes('404')
}

export const performCleanupAttempt = internalAction({
  args: {
    kind: v.union(v.literal('ai-search'), v.literal('r2')),
    userId: v.string(),
    documentId: v.string(),
    r2Key: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<CleanupAttemptResult> => {
    return await performCleanupAttemptInternal(args)
  },
})
