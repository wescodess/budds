"use node";
import { v } from 'convex/values'
import { internalAction } from './_generated/server'
import { internal } from './_generated/api'
import { extractText } from 'unpdf'
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'

function getR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
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

export const ingestDocument = internalAction({
  args: {
    documentId: v.id('documents'),
    fileId: v.id('_storage'),
    userId: v.string(),
    folderId: v.id('folders'),
    filename: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const blob = await ctx.storage.get(args.fileId)
      if (!blob) {
        await ctx.runMutation(internal.documents.updateDocumentStatus, {
          id: args.documentId,
          status: 'failed',
          failureReason: 'File not found in storage',
        })
        return
      }

      const arrayBuffer = await blob.arrayBuffer()
      const result = await extractText(new Uint8Array(arrayBuffer), { mergePages: true })

      if (!result.text || !(result.text as string).trim()) {
        await ctx.runMutation(internal.documents.updateDocumentStatus, {
          id: args.documentId,
          status: 'failed',
          failureReason: 'No extractable text detected — scanned or image-only PDF',
        })
        return
      }

      const bucket = process.env.R2_BUCKET_NAME
      if (!bucket) {
        await ctx.runMutation(internal.documents.updateDocumentStatus, {
          id: args.documentId,
          status: 'failed',
          failureReason: 'Missing R2 configuration',
        })
        return
      }

      const r2Key = `${sanitizeUserSegment(args.userId)}/${args.folderId}/${args.documentId}.txt`
      const r2 = getR2Client()

      await r2.send(new PutObjectCommand({
        Bucket: bucket,
        Key: r2Key,
        Body: result.text as string,
        ContentType: 'text/plain',
        Metadata: {
          userId: args.userId,
          documentId: args.documentId,
          folderId: String(args.folderId),
          filename: args.filename,
        },
      }))

      const config = getAiSearchConfig()
      if (!config) {
        await ctx.runMutation(internal.documents.updateDocumentStatus, {
          id: args.documentId,
          status: 'failed',
          failureReason: 'Missing Cloudflare AI Search configuration',
          r2Key,
        })
        return
      }

      const jobsUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-search/instances/${config.instance}/jobs`
      const syncResponse = await fetch(jobsUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.token}` },
      })

      let jobId: string | undefined

      if (syncResponse.ok) {
        const syncData = await syncResponse.json() as { result?: { id?: string } }
        jobId = syncData.result?.id
      } else if (syncResponse.status === 429) {
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
        await ctx.runMutation(internal.documents.updateDocumentStatus, {
          id: args.documentId,
          status: 'failed',
          failureReason: `Failed to trigger indexing (${syncResponse.status}): ${errorText}`,
          r2Key,
        })
        return
      }

      await ctx.runMutation(internal.documents.updateDocumentStatus, {
        id: args.documentId,
        status: 'indexing',
        r2Key,
        indexJobId: jobId,
      })

      if (jobId) {
        await ctx.scheduler.runAfter(10_000, internal.documentActions.pollIndexingStatus, {
          documentId: args.documentId,
          jobId,
        })
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      await ctx.runMutation(internal.documents.updateDocumentStatus, {
        id: args.documentId,
        status: 'failed',
        failureReason: message,
      })
    }
  },
})

export const pollIndexingStatus = internalAction({
  args: {
    documentId: v.id('documents'),
    jobId: v.string(),
  },
  handler: async (ctx, args) => {
    const config = getAiSearchConfig()
    if (!config) return

    const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-search/instances/${config.instance}/jobs/${args.jobId}`
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${config.token}` },
    })

    if (!response.ok) {
      await ctx.runMutation(internal.documents.updateDocumentStatus, {
        id: args.documentId,
        status: 'failed',
        failureReason: `Failed to check indexing status (${response.status})`,
      })
      return
    }

    const data = await response.json() as { result?: { ended_at?: string | null, end_reason?: string | null } }
    const job = data.result

    if (job?.ended_at) {
      if (job.end_reason) {
        await ctx.runMutation(internal.documents.updateDocumentStatus, {
          id: args.documentId,
          status: 'failed',
          failureReason: `Indexing failed: ${job.end_reason}`,
        })
      } else {
        await ctx.runMutation(internal.documents.updateDocumentStatus, {
          id: args.documentId,
          status: 'success',
        })
      }
    } else {
      await ctx.scheduler.runAfter(10_000, internal.documentActions.pollIndexingStatus, {
        documentId: args.documentId,
        jobId: args.jobId,
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
    const config = getAiSearchConfig()
    if (!config) return

    const bucket = process.env.R2_BUCKET_NAME
    let content: string | undefined

    if (bucket && args.r2Key) {
      try {
        const r2 = getR2Client()
        const obj = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: args.r2Key }))
        content = await obj.Body?.transformToString()
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`R2 read for metadata update failed: ${message}`)
      }
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-search/instances/${config.instance}/documents/upsert`

    try {
      const document: Record<string, unknown> = {
        id: args.documentId,
        attributes: {
          userId: args.userId,
          documentId: args.documentId,
          folderId: args.folderId,
          filename: args.filename,
        },
      }
      if (content) document.content = content

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.token}`,
        },
        body: JSON.stringify({ documents: [document] }),
      })

      if (!response.ok) {
        const errorText = (await response.text()).slice(0, 500)
        console.error(`AI Search metadata update failed (${response.status}): ${errorText}`)
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`AI Search metadata update error: ${message}`)
    }
  },
})

export const deleteDocumentFromR2 = internalAction({
  args: {
    documentId: v.string(),
    r2Key: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const bucket = process.env.R2_BUCKET_NAME
    if (!bucket || !args.r2Key) return

    try {
      const r2 = getR2Client()
      await r2.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: args.r2Key,
      }))

      const config = getAiSearchConfig()
      if (config) {
        const syncUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-search/instances/${config.instance}/jobs`
        await fetch(syncUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${config.token}` },
        })
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const isNotFound = message.includes('NoSuchKey') || message.includes('404')
      if (!isNotFound) console.error(`R2 delete error: ${message}`)
    }
  },
})

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
  handler: async (_ctx, args): Promise<{ ok: true } | { ok: false; error: string }> => {
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
  },
})
