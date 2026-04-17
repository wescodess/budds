"use node";
import { createRequire } from 'module'
import { parseHTML } from 'linkedom'
import { Readability } from '@mozilla/readability'

const require = createRequire(import.meta.url)
const { YoutubeTranscript } = require('youtube-transcript') as typeof import('youtube-transcript')

const MAX_CONTENT_BYTES = 4 * 1024 * 1024

function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1).split('/')[0] || null
    }
    if (parsed.hostname.includes('youtube.com')) {
      if (parsed.pathname.startsWith('/shorts/')) {
        return parsed.pathname.split('/')[2] || null
      }
      return parsed.searchParams.get('v')
    }
  } catch {
    return null
  }
  return null
}

export function isYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname === 'youtu.be' || parsed.hostname.includes('youtube.com')
  } catch {
    return false
  }
}

export async function extractYouTubeTranscript(url: string): Promise<{ title: string; content: string }> {
  const videoId = extractVideoId(url)
  if (!videoId) throw new Error('Invalid YouTube URL — could not extract video ID')

  const segments = await YoutubeTranscript.fetchTranscript(videoId)
  if (!segments.length) throw new Error('No transcript available for this video')

  const lines = segments.map(s => s.text).join(' ')
  let content = `# YouTube Transcript\n\nSource: ${url}\nVideo ID: ${videoId}\n\n${lines}`

  if (new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    content = decoder.decode(encoder.encode(content).slice(0, MAX_CONTENT_BYTES))
  }

  return { title: `YouTube: ${videoId}`, content }
}

export async function extractWebsiteContent(url: string): Promise<{ title: string; content: string }> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Budds/1.0)',
      'Accept': 'text/html,application/xhtml+xml,*/*',
    },
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) throw new Error(`Failed to fetch page (${response.status})`)

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    throw new Error('URL does not point to an HTML page')
  }

  const html = await response.text()
  if (!html.trim()) throw new Error('Page returned empty content')

  const { document } = parseHTML(html)
  const reader = new Readability(document as unknown as Document)
  const article = reader.parse()

  if (!article?.textContent?.trim()) {
    throw new Error('Could not extract readable content from this page')
  }

  const pageTitle = article.title || new URL(url).hostname
  let content = `# ${pageTitle}\n\nSource: ${url}\n\n${article.textContent}`

  if (new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    content = decoder.decode(encoder.encode(content).slice(0, MAX_CONTENT_BYTES))
  }

  return { title: pageTitle, content }
}
