import { v } from 'convex/values'
import type { Id } from './_generated/dataModel'
import { action } from './_generated/server'
import { api } from './_generated/api'

const MAX_FILE_SIZE = 52_428_800

function resolveImportUrl(raw: string) {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error('Enter a valid URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https links are supported')
  }

  return url
}

function extractFilenameFromDisposition(contentDisposition: string | null) {
  if (!contentDisposition) return null

  const utf8Match = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]).trim()
  }

  const plainMatch = contentDisposition.match(/filename\s*=\s*"?([^\";]+)"?/i)
  return plainMatch?.[1]?.trim() || null
}

function normalizePdfFilename(url: URL, contentDisposition: string | null) {
  const fromHeader = extractFilenameFromDisposition(contentDisposition)
  const fallback = url.pathname.split('/').filter(Boolean).pop() || 'imported-document.pdf'
  const raw = fromHeader || fallback
  const base = raw.endsWith('.pdf') ? raw : `${raw}.pdf`
  return base.replace(/[\\/:*?"<>|]+/g, '-')
}

export const importDocumentFromUrl = action({
  args: {
    folderId: v.id('folders'),
    url: v.string(),
  },
  handler: async (ctx, args): Promise<{ documentId: Id<'documents'> | undefined; filename: string }> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')

    const sourceUrl = resolveImportUrl(args.url)
    const response = await fetch(sourceUrl.toString())

    if (!response.ok) {
      throw new Error(`Failed to fetch file (${response.status})`)
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() || ''
    const looksLikePdf = contentType.includes('application/pdf') || sourceUrl.pathname.toLowerCase().endsWith('.pdf')
    if (!looksLikePdf) {
      throw new Error('Only direct PDF links are supported')
    }

    const body = await response.arrayBuffer()
    if (body.byteLength === 0) {
      throw new Error('Downloaded file was empty')
    }
    if (body.byteLength > MAX_FILE_SIZE) {
      throw new Error('File exceeds 50MB limit')
    }

    const blob = new Blob([body], { type: 'application/pdf' })
    const fileId = await ctx.storage.store(blob)
    const filename = normalizePdfFilename(sourceUrl, response.headers.get('content-disposition'))
    const documentId: Id<'documents'> | undefined = await ctx.runMutation(api.documents.createDocument, {
      folderId: args.folderId,
      filename,
      fileId,
      fileSize: blob.size,
    })

    return { documentId, filename }
  },
})
