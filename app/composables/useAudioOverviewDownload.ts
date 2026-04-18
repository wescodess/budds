export interface DownloadOverviewArgs {
  title: string
  turnUrls: (string | null)[]
}

export interface DownloadOverviewResult {
  total: number
  fetched: number
  skipped: number
  failed: Array<{ index: number, reason: string }>
  bytes: number
  filename: string
}

export interface ConcatResult {
  bytes: Uint8Array
  fetched: number
  skipped: number
  failed: Array<{ index: number, reason: string }>
}

export async function concatMp3Segments(urls: (string | null)[]): Promise<ConcatResult> {
  const tasks = urls.map(async (url, index): Promise<{ index: number, buf: Uint8Array | null }> => {
    if (!url) return { index, buf: null }
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`segment ${index + 1}: ${res.status} ${res.statusText}`)
    }
    const buf = new Uint8Array(await res.arrayBuffer())
    return { index, buf }
  })

  const settled = await Promise.allSettled(tasks)
  const buffers: Uint8Array[] = new Array(urls.length)
  let fetched = 0
  let skipped = 0
  const failed: Array<{ index: number, reason: string }> = []

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]!
    if (result.status === 'rejected') {
      failed.push({ index: i, reason: result.reason?.message ?? String(result.reason) })
      continue
    }
    const { buf } = result.value
    if (buf === null) {
      skipped++
      continue
    }
    if (buf.byteLength === 0) {
      skipped++
      continue
    }
    buffers[i] = buf
    fetched++
  }

  const totalBytes = buffers.reduce((sum, b) => sum + (b?.byteLength ?? 0), 0)
  const out = new Uint8Array(totalBytes)
  let offset = 0
  for (const b of buffers) {
    if (!b) continue
    out.set(b, offset)
    offset += b.byteLength
  }

  return { bytes: out, fetched, skipped, failed }
}

export function sanitizeFilename(title: string): string {
  const cleaned = title.trim().replace(/[^\w\-. ]+/g, '').replace(/\s+/g, ' ').slice(0, 80)
  return cleaned.length > 0 ? cleaned : 'audio-overview'
}

export function useAudioOverviewDownload() {
  async function downloadOverview(args: DownloadOverviewArgs): Promise<DownloadOverviewResult> {
    if (!import.meta.client) {
      throw new Error('downloadOverview must be called from the client')
    }
    const total = args.turnUrls.length
    if (total === 0) {
      throw new Error('No audio segments available to download')
    }

    const { bytes, fetched, skipped, failed } = await concatMp3Segments(args.turnUrls)

    if (fetched === 0) {
      const reasons = failed.map(f => `#${f.index + 1}: ${f.reason}`).join('; ')
      throw new Error(reasons || 'No audio segments could be loaded')
    }

    if (bytes.byteLength === 0) {
      throw new Error('Audio segments were empty')
    }

    const blob = new Blob([bytes], { type: 'audio/mpeg' })
    const url = URL.createObjectURL(blob)
    const filename = `${sanitizeFilename(args.title)}.mp3`

    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)

    return { total, fetched, skipped, failed, bytes: bytes.byteLength, filename }
  }

  return { downloadOverview }
}
