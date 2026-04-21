"use node";
import { v } from 'convex/values'
import { internalAction, type ActionCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { S3Client, PutObjectCommand, DeleteObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3'
async function loadExtractors() {
  return await import('./sourceExtractors')
}

const FAILED_DOCUMENT_RETENTION_MS = 10_000
const AI_SEARCH_MAX_FILE_BYTES = 4 * 1024 * 1024
const BINARY_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

async function extractTextFromBinary(
  arrayBuffer: ArrayBuffer,
  filename: string,
  mimeType: string,
): Promise<string | null> {
  try {
    if (mimeType === 'application/pdf') {
      const pdfParse = (await import('pdf-parse')).default
      const result = await pdfParse(Buffer.from(arrayBuffer))
      const text = result.text?.trim()
      if (!text) return null
      console.log(`[extract] PDF ${filename}: ${text.length} chars`)
      return `# ${filename}\n\n${text}`
    }

    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer: Buffer.from(arrayBuffer) })
      const text = result.value?.trim()
      if (!text) return null
      console.log(`[extract] DOCX ${filename}: ${text.length} chars`)
      return `# ${filename}\n\n${text}`
    }

    return null
  } catch (err) {
    console.error(`[extract] Failed for ${filename}:`, err)
    return null
  }
}

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

  const config = getAiSearchConfig()
  if (!config) {
    await failDocumentIngestion(ctx, {
      documentId: args.documentId,
      fileId: args.fileId,
      failureReason: 'Missing Cloudflare AI Search configuration',
      r2Key: args.r2Key,
      taskId: args.taskId,
    })
    return
  }

  const jobsUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-search/instances/${config.instance}/jobs`
  const syncResponse = await fetch(jobsUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${config.token}` },
  })

  let jobId: string | undefined
  let piggybackedOnExistingJob = false

  if (syncResponse.ok) {
    const syncData = await syncResponse.json() as { result?: { id?: string } }
    jobId = syncData.result?.id
  } else if (syncResponse.status === 429) {
    piggybackedOnExistingJob = true
    const listResponse = await fetch(jobsUrl, {
      headers: { 'Authorization': `Bearer ${config.token}` },
    })
    if (listResponse.ok) {
      const listData = await listResponse.json() as { result?: Array<{ id: string, ended_at?: string | null }> }
      const running = listData.result?.find(j => !j.ended_at)
      jobId = running?.id ?? listData.result?.[0]?.id
    }
  } else {
    const errorText = (await syncResponse.text()).slice(0, 500)
    await failDocumentIngestion(ctx, {
      documentId: args.documentId,
      fileId: args.fileId,
      failureReason: `Failed to trigger indexing (${syncResponse.status}): ${errorText}`,
      r2Key: args.r2Key,
      taskId: args.taskId,
    })
    return
  }

  await ctx.runMutation(internal.documents.updateDocumentStatus, {
    id: args.documentId,
    status: 'indexing',
    r2Key: args.r2Key,
    indexJobId: jobId,
  })

  if (args.taskId) {
    await ctx.runMutation(internal.tasks.updateProgress, { taskId: args.taskId, progress: 'Indexing for search…' })
  }

  if (jobId) {
    await ctx.scheduler.runAfter(10_000, internal.documentActions.pollIndexingStatus, {
      documentId: args.documentId,
      jobId,
      needsResync: piggybackedOnExistingJob,
    })
  }
}

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
        const resolvedMime = args.mimeType ?? blob.type ?? 'application/octet-stream'
        const isBinary = BINARY_MIME_TYPES.has(resolvedMime)
        console.log(`[ingest] file=${args.filename} argsMime=${args.mimeType} blobType=${blob.type} resolved=${resolvedMime} isBinary=${isBinary} size=${arrayBuffer.byteLength}`)

        if (!isBinary && arrayBuffer.byteLength > AI_SEARCH_MAX_FILE_BYTES) {
          const sizeMB = (arrayBuffer.byteLength / (1024 * 1024)).toFixed(1)
          await failDocumentIngestion(ctx, {
            documentId: args.documentId,
            fileId: args.fileId,
            failureReason: `File is ${sizeMB} MB — exceeds the 4 MB indexing limit. Try splitting it into smaller files.`,
            taskId: args.taskId,
          })
          return
        }

        if (isBinary) {
          if (args.taskId) {
            await ctx.runMutation(internal.tasks.updateProgress, { taskId: args.taskId, progress: 'Extracting text…' })
          }
          const markdown = await extractTextFromBinary(arrayBuffer, args.filename, resolvedMime)

          const r2Key = markdown
            ? `${sanitizeUserSegment(args.userId)}/${args.folderId}/${args.documentId}.md`
            : `${sanitizeUserSegment(args.userId)}/${args.folderId}/${args.documentId}${getR2Extension(args.filename, args.mimeType)}`

          await uploadToR2AndSync(ctx, {
            documentId: args.documentId,
            fileId: args.fileId,
            userId: args.userId,
            folderId: args.folderId,
            filename: args.filename,
            r2Key,
            body: markdown ?? new Uint8Array(arrayBuffer),
            contentType: markdown ? 'text/markdown' : resolvedMime,
            taskId: args.taskId,
          })
        } else {
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
            contentType: resolvedMime,
            taskId: args.taskId,
          })
        }
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
  },
  handler: async (ctx, args) => {
    const doc = await ctx.runQuery(internal.documents.getDocument, { id: args.documentId })
    if (!doc || doc.status === 'failed') return

    const taskId = doc.taskId

    const config = getAiSearchConfig()
    if (!config) {
      await failDocumentIngestion(ctx, {
        documentId: args.documentId,
        fileId: doc.fileId ?? undefined,
        failureReason: 'Missing Cloudflare AI Search configuration',
        r2Key: doc.r2Key,
        taskId,
      })
      return
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-search/instances/${config.instance}/jobs/${args.jobId}`
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${config.token}` },
    })

    if (!response.ok) {
      await failDocumentIngestion(ctx, {
        documentId: args.documentId,
        fileId: doc.fileId ?? undefined,
        failureReason: `Failed to check indexing status (${response.status})`,
        r2Key: doc.r2Key,
        cleanupAiSearch: true,
        taskId,
      })
      return
    }

    const data = await response.json() as { result?: { ended_at?: string | null, end_reason?: string | null } }
    const job = data.result

    if (job?.ended_at) {
      if (job.end_reason) {
        await failDocumentIngestion(ctx, {
          documentId: args.documentId,
          fileId: doc.fileId ?? undefined,
          failureReason: `Indexing failed: ${job.end_reason}`,
          r2Key: doc.r2Key,
          cleanupAiSearch: true,
          taskId,
        })
      } else if (args.needsResync) {
        const jobsUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-search/instances/${config.instance}/jobs`
        const resyncResponse = await fetch(jobsUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${config.token}` },
        })
        if (resyncResponse.ok) {
          const resyncData = await resyncResponse.json() as { result?: { id?: string } }
          const newJobId = resyncData.result?.id
          if (newJobId) {
            await ctx.runMutation(internal.documents.updateDocumentStatus, {
              id: args.documentId,
              status: 'indexing',
              indexJobId: newJobId,
            })
            await ctx.scheduler.runAfter(10_000, internal.documentActions.pollIndexingStatus, {
              documentId: args.documentId,
              jobId: newJobId,
            })
            return
          }
        }
        await ctx.runMutation(internal.documents.updateDocumentStatus, {
          id: args.documentId,
          status: 'success',
        })
        if (taskId) {
          await ctx.runMutation(internal.tasks.complete, { taskId, result: { documentId: String(args.documentId) } })
        }
      } else {
        await ctx.runMutation(internal.documents.updateDocumentStatus, {
          id: args.documentId,
          status: 'success',
        })
        if (taskId) {
          await ctx.runMutation(internal.tasks.complete, { taskId, result: { documentId: String(args.documentId) } })
        }
        await ctx.scheduler.runAfter(0, internal.documentActions.updateDocumentAiSearchMetadata, {
          documentId: String(args.documentId),
          userId: doc.userId,
          folderId: String(doc.folderId),
          filename: doc.filename,
          r2Key: doc.r2Key,
        })
      }
    } else {
      await ctx.scheduler.runAfter(10_000, internal.documentActions.pollIndexingStatus, {
        documentId: args.documentId,
        jobId: args.jobId,
        needsResync: args.needsResync,
      })
    }
  },
})

export const updateDocumentAiSearchMetadata = internalAction({
  args: {
    documentId: v.string(),
    userId: v.string(),
    folderId: v.string(),
    filename: v.string(),
    r2Key: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const bucket = process.env.R2_BUCKET_NAME
    if (!bucket || !args.r2Key) return

    try {
      const r2 = getR2Client()
      await r2.send(new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${args.r2Key}`,
        Key: args.r2Key,
        MetadataDirective: 'REPLACE',
        Metadata: {
          userId: args.userId,
          documentId: args.documentId,
          folderId: args.folderId,
          filename: args.filename.replace(/[^\x20-\x7E]/g, ''),
        },
      }))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`R2 metadata update failed: ${message}`)
      return
    }

    const config = getAiSearchConfig()
    if (!config) return

    try {
      const jobsUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-search/instances/${config.instance}/jobs`
      await fetch(jobsUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.token}` },
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`AI Search sync trigger after metadata update failed: ${message}`)
    }
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
