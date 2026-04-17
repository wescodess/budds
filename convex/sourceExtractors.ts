"use node";
import { parseHTML } from 'linkedom'
import { Readability } from '@mozilla/readability'

const MAX_CONTENT_BYTES = 4 * 1024 * 1024

const YT_VIDEO_ID_RE = /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i
const YT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)'
const YT_INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false'
const YT_ANDROID_UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)'
const YT_ANDROID_CONTEXT = { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } }

function resolveVideoId(input: string): string {
  if (input.length === 11 && !input.includes('/')) return input
  const match = input.match(YT_VIDEO_ID_RE)
  if (match?.[1]) return match[1]
  throw new Error('Invalid YouTube URL — could not extract video ID')
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
}

function parseTranscriptXml(xml: string): string[] {
  const segments: string[] = []

  const pTagRe = /<p\s+t="\d+"\s+d="\d+"[^>]*>([\s\S]*?)<\/p>/g
  let pMatch: RegExpExecArray | null
  while ((pMatch = pTagRe.exec(xml)) !== null) {
    const inner = pMatch[1]
    let text = ''
    const sRe = /<s[^>]*>([^<]*)<\/s>/g
    let sMatch: RegExpExecArray | null
    while ((sMatch = sRe.exec(inner)) !== null) text += sMatch[1]
    if (!text) text = inner.replace(/<[^>]+>/g, '')
    text = decodeHtmlEntities(text).trim()
    if (text) segments.push(text)
  }

  if (segments.length > 0) return segments

  const textTagRe = /<text start="[^"]*" dur="[^"]*">([^<]*)<\/text>/g
  let tMatch: RegExpExecArray | null
  while ((tMatch = textTagRe.exec(xml)) !== null) {
    const text = decodeHtmlEntities(tMatch[1]).trim()
    if (text) segments.push(text)
  }

  return segments
}

interface CaptionTrack { baseUrl: string; languageCode: string }

async function getCaptionTracks(videoId: string): Promise<CaptionTrack[]> {
  try {
    const res = await fetch(YT_INNERTUBE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': YT_ANDROID_UA },
      body: JSON.stringify({ context: YT_ANDROID_CONTEXT, videoId }),
    })
    if (res.ok) {
      const data = await res.json() as any
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks
      if (Array.isArray(tracks) && tracks.length > 0) return tracks
    }
  } catch { /* fall through to web scrape */ }

  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'User-Agent': YT_USER_AGENT },
  })
  const html = await pageRes.text()

  if (html.includes('class="g-recaptcha"')) {
    throw new Error('YouTube is rate-limiting requests — try again later')
  }
  if (!html.includes('"playabilityStatus":')) {
    throw new Error('Video is unavailable')
  }

  const varPrefix = 'var ytInitialPlayerResponse = '
  const idx = html.indexOf(varPrefix)
  if (idx === -1) throw new Error('Transcript is disabled on this video')

  const start = idx + varPrefix.length
  let depth = 0
  for (let i = start; i < html.length; i++) {
    if (html[i] === '{') depth++
    else if (html[i] === '}') {
      depth--
      if (depth === 0) {
        try {
          const obj = JSON.parse(html.slice(start, i + 1)) as any
          const tracks = obj?.captions?.playerCaptionsTracklistRenderer?.captionTracks
          if (Array.isArray(tracks) && tracks.length > 0) return tracks
        } catch { /* parse failed */ }
        break
      }
    }
  }

  throw new Error('No transcript available for this video')
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
  const videoId = resolveVideoId(url)
  const tracks = await getCaptionTracks(videoId)

  const track = tracks.find(t => t.languageCode === 'en') ?? tracks[0]
  if (!track?.baseUrl) throw new Error('No transcript available for this video')

  const trackUrl = new URL(track.baseUrl)
  if (!trackUrl.hostname.endsWith('.youtube.com')) {
    throw new Error('No transcript available for this video')
  }

  const res = await fetch(track.baseUrl, { headers: { 'User-Agent': YT_USER_AGENT } })
  if (!res.ok) throw new Error('No transcript available for this video')

  const xml = await res.text()
  const segments = parseTranscriptXml(xml)
  if (!segments.length) throw new Error('No transcript available for this video')

  let content = `# YouTube Transcript\n\nSource: ${url}\nVideo ID: ${videoId}\n\n${segments.join(' ')}`

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
