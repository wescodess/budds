import { v } from 'convex/values'
import type { Id } from './_generated/dataModel'
import { action } from './_generated/server'
import { api } from './_generated/api'

const MAX_FILE_SIZE = 52_428_800

function isYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname === 'youtu.be' || parsed.hostname.includes('youtube.com')
  } catch {
    return false
  }
}

const DOWNLOADABLE_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

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

function normalizeFilename(url: URL, contentDisposition: string | null) {
  const fromHeader = extractFilenameFromDisposition(contentDisposition)
  const fallback = url.pathname.split('/').filter(Boolean).pop() || 'imported-document'
  const raw = fromHeader || fallback
  return raw.replace(/[\\/:*?"<>|]+/g, '-')
}

function isDownloadableFile(contentType: string, pathname: string): boolean {
  for (const mime of DOWNLOADABLE_MIME_TYPES) {
    if (contentType.includes(mime)) return true
  }
  const ext = pathname.toLowerCase().split('.').pop()
  const fileExts = new Set(['pdf', 'docx', 'xlsx', 'txt', 'md', 'csv', 'png', 'jpg', 'jpeg', 'webp', 'gif'])
  return ext ? fileExts.has(ext) : false
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
    const urlString = sourceUrl.toString()

    if (isYouTubeUrl(urlString)) {
      const videoId = sourceUrl.searchParams.get('v')
        ?? sourceUrl.pathname.slice(1).split('/')[0]
        ?? 'video'
      const filename = `YouTube — ${videoId}`
      const documentId: Id<'documents'> | undefined = await ctx.runMutation(api.documents.createDocumentFromSource, {
        folderId: args.folderId,
        filename,
        sourceType: 'youtube',
        sourceUrl: urlString,
      })
      return { documentId, filename }
    }

    const response = await fetch(urlString, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Budds/1.0)',
        'Accept': '*/*',
      },
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch URL (${response.status})`)
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() || ''

    if (isDownloadableFile(contentType, sourceUrl.pathname)) {
      const body = await response.arrayBuffer()
      if (body.byteLength === 0) throw new Error('Downloaded file was empty')
      if (body.byteLength > MAX_FILE_SIZE) throw new Error('File exceeds 50MB limit')

      const mimeType = contentType.split(';')[0]?.trim() || 'application/octet-stream'
      const blob = new Blob([body], { type: mimeType })
      const fileId = await ctx.storage.store(blob)
      const filename = normalizeFilename(sourceUrl, response.headers.get('content-disposition'))
      const documentId: Id<'documents'> | undefined = await ctx.runMutation(api.documents.createDocument, {
        folderId: args.folderId,
        filename,
        fileId,
        fileSize: blob.size,
      })
      return { documentId, filename }
    }

    const pageTitle = sourceUrl.hostname + sourceUrl.pathname
    const filename = pageTitle.length > 60 ? pageTitle.slice(0, 60) : pageTitle
    const documentId: Id<'documents'> | undefined = await ctx.runMutation(api.documents.createDocumentFromSource, {
      folderId: args.folderId,
      filename,
      sourceType: 'website',
      sourceUrl: urlString,
    })
    return { documentId, filename }
  },
})
