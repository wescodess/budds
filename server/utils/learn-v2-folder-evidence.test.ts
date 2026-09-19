import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { retrieveLearnV2FolderEvidence } from './learn-v2-folder-evidence'

const source = {
  alias: 'source-001',
  documentId: 'document-1',
  contentHash: 'a'.repeat(64),
  sourceRevision: `sha256:${'a'.repeat(64)}`,
}

beforeEach(() => {
  vi.stubEnv('NUXT_CLOUDFLARE_ACCOUNT_ID', 'test-account')
  vi.stubEnv('NUXT_CLOUDFLARE_AI_SEARCH_INSTANCE', 'test-search')
  vi.stubEnv('NUXT_CLOUDFLARE_AI_SEARCH_TOKEN', 'test-token')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('Learn V2 transient folder evidence', () => {
  test('admits only exact owner, document, hash, and revision matches', async () => {
    const result = (overrides: Record<string, unknown>, text: string) => ({
      attributes: { file: {
        userid: 'owner-1',
        documentid: source.documentId,
        contentHash: source.contentHash,
        sourceRevision: source.sourceRevision,
        ...overrides,
      } },
      content: [{ text, score: 0.9 }],
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      result: { data: [
        result({ userid: 'owner-2' }, 'other owner'),
        result({ documentid: 'document-2' }, 'other document'),
        result({ contentHash: 'b'.repeat(64) }, 'other hash'),
        result({ sourceRevision: `sha256:${'b'.repeat(64)}` }, 'other revision'),
        result({}, ' Exact pinned evidence.\u0000 '),
      ] },
    }), { status: 200 }))

    await expect(retrieveLearnV2FolderEvidence({
      query: 'Apply the accepted evidence',
      userId: 'owner-1',
      sources: [source],
    })).resolves.toEqual(new Map([['source-001', 'Exact pinned evidence.']]))

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      filters: unknown
      ranking_options?: unknown
      score_threshold?: unknown
    }
    expect(body.filters).toEqual({
      type: 'eq',
      key: 'documentid',
      value: 'document-1',
    })
    expect(body.ranking_options).toEqual({ score_threshold: 0.05 })
    expect(body.score_threshold).toBeUndefined()
  })

  test('uses a flat same-key OR filter for multiple pinned documents', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      result: { data: [] },
    }), { status: 200 }))

    await retrieveLearnV2FolderEvidence({
      query: 'Apply the accepted evidence',
      userId: 'owner-1',
      sources: [source, { ...source, alias: 'source-002', documentId: 'document-2' }],
    })

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { filters: unknown }
    expect(body.filters).toEqual({
      type: 'or',
      filters: [
        { type: 'eq', key: 'documentid', value: 'document-1' },
        { type: 'eq', key: 'documentid', value: 'document-2' },
      ],
    })
  })

  test('returns evidence for every alias pinned to the same document revision', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      result: { data: [{
        attributes: { file: {
          userid: 'owner-1',
          documentid: source.documentId,
          contentHash: source.contentHash,
          sourceRevision: source.sourceRevision,
        } },
        content: [{ text: 'Shared pinned evidence.', score: 0.9 }],
      }] },
    }), { status: 200 }))

    await expect(retrieveLearnV2FolderEvidence({
      query: 'Apply the accepted evidence',
      userId: 'owner-1',
      sources: [source, { ...source, alias: 'source-002' }],
    })).resolves.toEqual(new Map([
      ['source-001', 'Shared pinned evidence.'],
      ['source-002', 'Shared pinned evidence.'],
    ]))
  })

  test('rejects a declared response larger than the bounded input budget', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', {
      status: 200,
      headers: { 'content-length': '512001' },
    }))

    await expect(retrieveLearnV2FolderEvidence({
      query: 'Apply the accepted evidence',
      userId: 'owner-1',
      sources: [source],
    })).rejects.toThrow(/byte limit/)
  })
})
