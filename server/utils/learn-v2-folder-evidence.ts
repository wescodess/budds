import { readConfiguredRuntimeValue } from './runtime-config'
import { deterministicLearnV2FolderEvidence } from './learn-v2-e2e-fixtures'

const MAX_RESPONSE_BYTES = 512_000
const MAX_RESULTS = 32
const MAX_SOURCE_EXCERPT_CHARS = 4_000
const MAX_TOTAL_EXCERPT_CHARS = 32_000

export type FolderEvidenceSource = {
  alias: string
  documentId: string
  contentHash: string
  sourceRevision: string
}

function documentFilters(sources: FolderEvidenceSource[]): Record<string, unknown> {
  const documentIds = [...new Set(sources.map(source => source.documentId))]
  if (documentIds.length === 1) {
    return { type: 'eq', key: 'documentid', value: filterValue(documentIds[0]!) }
  }
  return {
    type: 'or',
    filters: documentIds.map(documentId => ({
      type: 'eq',
      key: 'documentid',
      value: filterValue(documentId),
    })),
  }
}

type AiSearchEnvelope = {
  success?: boolean
  result?: {
    data?: Array<{
      content?: Array<{ text?: unknown, score?: unknown }>
      attributes?: {
        file?: {
          userid?: unknown
          documentid?: unknown
          contenthash?: unknown
          contentHash?: unknown
          sourcerevision?: unknown
          sourceRevision?: unknown
        }
      }
    }>
  }
}

function filterValue(value: string) {
  const encoder = new TextEncoder()
  let result = ''
  for (const character of value) {
    if (encoder.encode(result + character).byteLength > 64) break
    result += character
  }
  return result
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error('Folder evidence response exceeded its byte limit')
  if (!response.body) throw new Error('Folder evidence response body unavailable')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('Folder evidence response exceeded its byte limit')
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  }
  finally {
    reader.releaseLock()
  }
  return JSON.parse(text)
}

export async function retrieveLearnV2FolderEvidence(args: {
  query: string
  userId: string
  sources: FolderEvidenceSource[]
  signal?: AbortSignal
}): Promise<Map<string, string>> {
  if (args.sources.length === 0) return new Map()
  const deterministic = await deterministicLearnV2FolderEvidence(args.sources)
  if (deterministic) return deterministic
  const runtime = globalThis as typeof globalThis & { useRuntimeConfig?: () => Record<string, unknown> }
  const config = runtime.useRuntimeConfig?.() ?? {}
  const accountId = readConfiguredRuntimeValue(config.cloudflareAccountId, 'NUXT_CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID')
  const instance = readConfiguredRuntimeValue(config.cloudflareAiSearchInstance, 'NUXT_CLOUDFLARE_AI_SEARCH_INSTANCE', 'CLOUDFLARE_AI_SEARCH_INSTANCE')
  const token = readConfiguredRuntimeValue(config.cloudflareAiSearchToken, 'NUXT_CLOUDFLARE_AI_SEARCH_TOKEN', 'CLOUDFLARE_AI_SEARCH_TOKEN')
  if (!accountId || !instance || !token) throw new Error('Folder evidence search is not configured')

  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/autorag/rags/${instance}/search`, {
    method: 'POST',
    signal: args.signal,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      query: args.query,
      max_num_results: MAX_RESULTS,
      ranking_options: { score_threshold: 0.05 },
      filters: documentFilters(args.sources),
    }),
  })
  if (!response.ok) throw new Error(`Folder evidence search returned ${response.status}`)
  const envelope = await boundedJson(response) as AiSearchEnvelope
  if (envelope.success !== true || !Array.isArray(envelope.result?.data)) throw new Error('Folder evidence search returned an invalid envelope')

  const sourcesByDocument = new Map(args.sources.map(source => [source.documentId, source]))
  const excerpts = new Map<string, string>()
  let totalChars = 0
  for (const result of envelope.result.data) {
    const file = result.attributes?.file
    if (!file || file.userid !== args.userId || typeof file.documentid !== 'string') continue
    const source = sourcesByDocument.get(file.documentid)
    if (!source) continue
    const contentHash = file.contentHash ?? file.contenthash
    const sourceRevision = file.sourceRevision ?? file.sourcerevision
    if (contentHash !== source.contentHash || sourceRevision !== source.sourceRevision || !Array.isArray(result.content)) continue
    for (const chunk of result.content) {
      if (typeof chunk.text !== 'string' || typeof chunk.score !== 'number' || !Number.isFinite(chunk.score)) continue
      const clean = chunk.text.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim()
      if (!clean) continue
      const prior = excerpts.get(source.alias) ?? ''
      const remainingForSource = MAX_SOURCE_EXCERPT_CHARS - prior.length
      const remainingTotal = MAX_TOTAL_EXCERPT_CHARS - totalChars
      if (remainingForSource <= 0 || remainingTotal <= 0) break
      const addition = clean.slice(0, Math.min(remainingForSource, remainingTotal))
      excerpts.set(source.alias, prior ? `${prior}\n${addition}`.slice(0, MAX_SOURCE_EXCERPT_CHARS) : addition)
      totalChars += addition.length
    }
    if (totalChars >= MAX_TOTAL_EXCERPT_CHARS) break
  }
  return excerpts
}
