import { vi, describe, test, expect, beforeEach } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'

const recordedHeaders: Record<string, string> = {}
let recordedStatus: number | undefined

vi.stubGlobal('createError', (opts: { statusCode: number; statusMessage?: string; message?: string }) =>
  Object.assign(new Error(opts.statusMessage || opts.message || 'error'), { statusCode: opts.statusCode }),
)
vi.stubGlobal('setResponseHeader', (_event: any, key: string, value: string) => {
  recordedHeaders[key.toLowerCase()] = value
})
vi.stubGlobal('setResponseStatus', (_event: any, status: number) => {
  recordedStatus = status
})
vi.stubGlobal('sendStream', async (_event: any, stream: ReadableStream) => {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  let total = 0
  for (const c of chunks) total += c.byteLength
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
})
vi.stubGlobal('defineEventHandler', (handler: Function) => handler)

const collectUserDataMock = vi.fn()
const getDocumentDownloadUrlMock = vi.fn()

vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    private calls = 0
    constructor(_url: string) {}
    setAuth(_token: string) {}
    query(_fnRef: unknown, args: unknown) {
      this.calls++
      if (this.calls === 1) return collectUserDataMock(args)
      return getDocumentDownloadUrlMock(args)
    }
  },
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const handler = (await import('./me.get')).default as Function

function makeEvent(token: string | undefined) {
  return { context: token ? { convexToken: token } : {} } as any
}

describe('GET /api/export/me', () => {
  beforeEach(() => {
    collectUserDataMock.mockReset()
    getDocumentDownloadUrlMock.mockReset()
    fetchMock.mockReset()
    for (const key of Object.keys(recordedHeaders)) delete recordedHeaders[key]
    recordedStatus = undefined
    process.env.CONVEX_URL = 'https://test.convex.cloud'
  })

  test('returns 401 when no Convex token is present on the event', async () => {
    const err = await handler(makeEvent(undefined)).catch((e: any) => e)
    expect(err.statusCode).toBe(401)
  })

  test('returns a streaming zip with expected entries for an authenticated user', async () => {
    collectUserDataMock.mockResolvedValue({
      userId: 'tok|user1',
      user: { name: 'Alice', email: 'alice@example.com' },
      folders: [{ _id: 'f1', name: 'Notes', userId: 'tok|user1' }],
      documents: [
        { _id: 'd1', filename: 'one.pdf', userId: 'tok|user1', fileId: 's1', folderId: 'f1', status: 'success', fileSize: 10 },
      ],
      conversations: [{ _id: 'c1', title: 'chat', userId: 'tok|user1', folderId: 'f1' }],
      messages: [{ _id: 'm1', role: 'user', content: 'hi', userId: 'tok|user1', conversationId: 'c1' }],
    })
    getDocumentDownloadUrlMock.mockResolvedValue({
      url: 'https://storage.example.com/d1.pdf',
      filename: 'one.pdf',
    })

    fetchMock.mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('%PDF-1.4 fake pdf bytes'))
          controller.close()
        },
      }),
    })

    const zipBytes = await handler(makeEvent('fake-jwt'))

    expect(recordedHeaders['content-type']).toBe('application/zip')
    expect(recordedHeaders['content-disposition']).toMatch(/attachment; filename="budds-export-\d{4}-\d{2}-\d{2}\.zip"/)
    expect(zipBytes).toBeInstanceOf(Uint8Array)
    expect(zipBytes.byteLength).toBeGreaterThan(100)

    const entries = unzipSync(zipBytes)
    expect(Object.keys(entries).sort()).toEqual(
      [
        'conversations.json',
        'documents.json',
        'documents/d1.pdf',
        'flashcardSets.json',
        'flashcards.json',
        'folders.json',
        'manifest.json',
        'messages.json',
        'quizAttempts.json',
        'quizQuestions.json',
        'quizzes.json',
      ].sort(),
    )

    const manifest = JSON.parse(strFromU8(entries['manifest.json']!))
    expect(manifest.schemaVersion).toBe(4)
    expect(manifest.userId).toBe('tok|user1')
    expect(manifest.counts.documents).toBe(1)
    expect(manifest.unresolvedDocuments).toEqual([])

    const pdf = strFromU8(entries['documents/d1.pdf']!)
    expect(pdf).toContain('%PDF-1.4')
  })

  test('records unresolved documents when the blob URL is missing', async () => {
    collectUserDataMock.mockResolvedValue({
      userId: 'tok|user1',
      user: { name: 'Alice', email: 'alice@example.com' },
      folders: [],
      documents: [
        { _id: 'd1', filename: 'gone.pdf', userId: 'tok|user1', fileId: 's1', folderId: 'f1', status: 'success', fileSize: 10 },
      ],
      conversations: [],
      messages: [],
    })
    getDocumentDownloadUrlMock.mockResolvedValue({ url: null, filename: 'gone.pdf' })

    const zipBytes = await handler(makeEvent('fake-jwt'))
    const entries = unzipSync(zipBytes)
    expect(entries['documents/d1.pdf']).toBeUndefined()

    const manifest = JSON.parse(strFromU8(entries['manifest.json']!))
    expect(manifest.unresolvedDocuments).toEqual(['d1'])
  })
})
