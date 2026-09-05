"use node";
import { parseHTML } from 'linkedom'
import { Readability } from '@mozilla/readability'

const MAX_CONTENT_BYTES = 4 * 1024 * 1024

const YT_VIDEO_ID_RE = /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i
const YT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const YT_INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false'
const YT_WEB_CLIENT = { client: { clientName: 'WEB', clientVersion: '2.20241126.01.00', hl: 'en' } }

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
    const inner = pMatch[1] ?? ''
    let text = ''
    const sRe = /<s[^>]*>([^<]*)<\/s>/g
    let sMatch: RegExpExecArray | null
    while ((sMatch = sRe.exec(inner)) !== null) text += sMatch[1] ?? ''
    if (!text) text = inner.replace(/<[^>]+>/g, '')
    text = decodeHtmlEntities(text).trim()
    if (text) segments.push(text)
  }

  if (segments.length > 0) return segments

  const textTagRe = /<text start="[^"]*" dur="[^"]*">([^<]*)<\/text>/g
  let tMatch: RegExpExecArray | null
  while ((tMatch = textTagRe.exec(xml)) !== null) {
    const text = decodeHtmlEntities(tMatch[1] ?? '').trim()
    if (text) segments.push(text)
  }

  return segments
}

interface CaptionTrack { baseUrl: string; languageCode: string }

function extractJsonObject(text: string, startIdx: number): any | null {
  let depth = 0
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) {
        try { return JSON.parse(text.slice(startIdx, i + 1)) } catch { return null }
      }
    }
  }
  return null
}

function extractCaptionTracksFromHtml(html: string): CaptionTrack[] | null {
  const markers = [
    'var ytInitialPlayerResponse = ',
    'ytInitialPlayerResponse = ',
    'window["ytInitialPlayerResponse"] = ',
  ]
  for (const marker of markers) {
    const idx = html.indexOf(marker)
    if (idx === -1) continue
    const obj = extractJsonObject(html, idx + marker.length)
    const tracks = obj?.captions?.playerCaptionsTracklistRenderer?.captionTracks
    if (Array.isArray(tracks) && tracks.length > 0) return tracks
  }

  const captionsRegex = /"captionTracks"\s*:\s*(\[[\s\S]*?\])\s*,\s*"/
  const match = html.match(captionsRegex)
  if (match?.[1]) {
    try {
      const tracks = JSON.parse(match[1]) as CaptionTrack[]
      if (tracks.length > 0) return tracks
    } catch { /* regex match wasn't valid JSON */ }
  }

  return null
}

function extractCookies(headers: Headers): string {
  const cookies: string[] = []
  headers.forEach((val, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      const cookie = val.split(';')[0]
      if (cookie) cookies.push(cookie)
    }
  })
  return cookies.join('; ')
}

async function getCaptionTracks(videoId: string): Promise<CaptionTrack[]> {
  const homeRes = await fetch('https://www.youtube.com/', {
    headers: { 'User-Agent': YT_USER_AGENT },
    redirect: 'follow',
  })
  let cookies = extractCookies(homeRes.headers)
  await homeRes.text()

  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': YT_USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
      ...(cookies ? { 'Cookie': cookies } : {}),
    },
  })
  const pageCookies = extractCookies(pageRes.headers)
  if (pageCookies) cookies = cookies ? `${cookies}; ${pageCookies}` : pageCookies
  const html = await pageRes.text()

  if (html.includes('class="g-recaptcha"')) {
    throw new Error('YouTube is rate-limiting requests — try again later')
  }
  if (!html.includes('"playabilityStatus":')) {
    throw new Error('Video is unavailable')
  }

  const htmlTracks = extractCaptionTracksFromHtml(html)
  if (htmlTracks) return htmlTracks

  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/)
  const clientVerMatch = html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/)
  const apiKey = apiKeyMatch?.[1]
  const clientVer = clientVerMatch?.[1] ?? '2.20241126.01.00'

  if (apiKey) {
    try {
      const url = `${YT_INNERTUBE_URL}${YT_INNERTUBE_URL.includes('?') ? '&' : '?'}key=${apiKey}&prettyPrint=false`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': YT_USER_AGENT,
          'Origin': 'https://www.youtube.com',
          ...(cookies ? { 'Cookie': cookies } : {}),
        },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion: clientVer, hl: 'en' } },
          videoId,
        }),
      })
      if (res.ok) {
        const data = await res.json() as any
        const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks
        if (Array.isArray(tracks) && tracks.length > 0) return tracks
      }
    } catch { /* InnerTube failed */ }
  }

  throw new Error(
    'Transcript not available — YouTube blocks server-side access for some videos. '
    + 'Try pasting the transcript text manually instead.'
  )
}

export function isYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname === 'youtu.be' || parsed.hostname.includes('youtube.com')
  } catch {
    return false
  }
}

async function fetchViaExternalApi(videoId: string, url: string): Promise<{ title: string; content: string } | null> {
  try {
    const apiUrl = `https://getyoutubetext.com/api/transcript?url=https://www.youtube.com/watch?v=${videoId}`
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Budds/1.0)' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return null

    const data = await res.json() as {
      transcript?: Array<{ text: string; offset: number; duration: number }>
      title?: string
    }
    if (!data.transcript?.length) return null

    const text = data.transcript
      .map(s => decodeHtmlEntities(s.text))
      .join(' ')

    const title = data.title ? decodeHtmlEntities(data.title) : `YouTube: ${videoId}`
    let content = `# ${title}\n\nSource: ${url}\nVideo ID: ${videoId}\n\n${text}`

    if (new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) {
      content = new TextDecoder().decode(
        new TextEncoder().encode(content).slice(0, MAX_CONTENT_BYTES),
      )
    }

    return { title, content }
  } catch {
    return null
  }
}

async function fetchViaDirectScrape(videoId: string, url: string): Promise<{ title: string; content: string }> {
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
    content = new TextDecoder().decode(
      new TextEncoder().encode(content).slice(0, MAX_CONTENT_BYTES),
    )
  }

  return { title: `YouTube: ${videoId}`, content }
}

export async function extractYouTubeTranscript(url: string): Promise<{ title: string; content: string }> {
  const videoId = resolveVideoId(url)

  const external = await fetchViaExternalApi(videoId, url)
  if (external) return external

  return fetchViaDirectScrape(videoId, url)
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
