"use node";
import { v } from 'convex/values'
import { internalAction } from './_generated/server'
import { internal } from './_generated/api'
import pdfParse from 'pdf-parse'

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
      const buffer = Buffer.from(arrayBuffer)
      const result = await pdfParse(buffer)

      if (!result.text || !result.text.trim()) {
        await ctx.runMutation(internal.documents.updateDocumentStatus, {
          id: args.documentId,
          status: 'failed',
          failureReason: 'No extractable text detected — scanned or image-only PDF',
        })
        return
      }

      const accountId = process.env.CF_ACCOUNT_ID
      const instance = process.env.CLOUDFLARE_AI_SEARCH_INSTANCE
      const token = process.env.CLOUDFLARE_AI_SEARCH_TOKEN

      if (!accountId || !instance || !token) {
        await ctx.runMutation(internal.documents.updateDocumentStatus, {
          id: args.documentId,
          status: 'failed',
          failureReason: 'Missing Cloudflare AI Search configuration',
        })
        return
      }

      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai-search/instances/${instance}/documents/upsert`

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          documents: [
            {
              id: args.documentId,
              text: result.text,
              attributes: {
                userId: args.userId,
                documentId: args.documentId,
                folderId: String(args.folderId),
                filename: args.filename,
              },
            },
          ],
        }),
      })

      if (!response.ok) {
        const errorText = (await response.text()).slice(0, 500)
        await ctx.runMutation(internal.documents.updateDocumentStatus, {
          id: args.documentId,
          status: 'failed',
          failureReason: `AI Search upsert failed (${response.status}): ${errorText}`,
        })
        return
      }

      await ctx.runMutation(internal.documents.updateDocumentStatus, {
        id: args.documentId,
        status: 'success',
      })
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
