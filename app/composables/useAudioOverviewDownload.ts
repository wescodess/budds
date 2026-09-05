export interface DownloadOverviewArgs {
  title: string
  turnUrls?: (string | null)[]
  mediaUrl?: string | null
}

export interface DownloadOverviewResult {
  total: number
  fetched: number
  skipped: number
  failed: Array<{ index: number, reason: string }>
  bytes: number
  filename: string
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
    const continuousMediaUrl = args.mediaUrl?.trim()
    if (continuousMediaUrl) {
      const filename = `${sanitizeFilename(args.title)}.wav`
      const a = document.createElement('a')
      a.href = continuousMediaUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      return { total: 1, fetched: 1, skipped: 0, failed: [], bytes: 0, filename }
    }

    // A bytewise join of independent MP3 files is not a valid assembled media
    // artifact. Version 1 stays playable segment-by-segment, while downloadable
    // media starts with the server-published continuous v2 WAV above.
    throw new Error('Download is unavailable for this legacy audio. Generate a new Audio Overview to download a valid WAV file.')
  }

  return { downloadOverview }
}
