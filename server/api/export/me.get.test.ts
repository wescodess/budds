import { vi, describe, test, expect, beforeEach } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'

const recordedHeaders: Record<string, string> = {}

vi.stubGlobal('createError', (opts: { statusCode: number; statusMessage?: string; message?: string }) =>
  Object.assign(new Error(opts.statusMessage || opts.message || 'error'), { statusCode: opts.statusCode }),
)
vi.stubGlobal('setResponseHeader', (_event: any, key: string, value: string) => {
  recordedHeaders[key.toLowerCase()] = value
})
vi.stubGlobal('setResponseStatus', vi.fn())
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
vi.stubGlobal('defineEventHandler', (handler: (...args: never[]) => unknown) => handler)

const getExportMetadataMock = vi.fn()
const getUserDataPageMock = vi.fn()
const getAttemptAnswersPageMock = vi.fn()
const getCourseSourceDocsPageMock = vi.fn()
const getDocumentDownloadUrlMock = vi.fn()

vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    setAuth(_token: string) {}
    query(_fnRef: unknown, args: unknown) {
      const queryArgs = args as Record<string, unknown>
      if ('collection' in queryArgs) return getUserDataPageMock(queryArgs)
      if ('attemptId' in queryArgs) return getAttemptAnswersPageMock(queryArgs)
      if ('courseId' in queryArgs) return getCourseSourceDocsPageMock(queryArgs)
      if ('documentId' in queryArgs) return getDocumentDownloadUrlMock(queryArgs)
      return getExportMetadataMock(queryArgs)
    }
  },
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const handler = (await import('./me.get')).default

function mockExportData(data: Record<string, any>) {
  getExportMetadataMock.mockResolvedValue({ userId: data.userId, user: data.user })
  getUserDataPageMock.mockImplementation(({ collection }: { collection: string }) => ({
    page: data[collection] ?? [],
    isDone: true,
    continueCursor: '',
  }))
  getAttemptAnswersPageMock.mockResolvedValue({
    page: data.attemptAnswers ?? [],
    isDone: true,
    continueCursor: '',
  })
  getCourseSourceDocsPageMock.mockResolvedValue({
    page: data.courseSourceDocs ?? [],
    isDone: true,
    continueCursor: '',
  })
}

function makeEvent(token: string | undefined) {
  return { context: token ? { convexToken: token } : {} } as any
}

describe('GET /api/export/me', () => {
  beforeEach(() => {
    getExportMetadataMock.mockReset()
    getUserDataPageMock.mockReset()
    getAttemptAnswersPageMock.mockReset()
    getCourseSourceDocsPageMock.mockReset()
    getDocumentDownloadUrlMock.mockReset()
    fetchMock.mockReset()
    for (const key of Object.keys(recordedHeaders)) Reflect.deleteProperty(recordedHeaders, key)
    process.env.CONVEX_URL = 'https://test.convex.cloud'
  })

  test('returns 401 when no Convex token is present on the event', async () => {
    const err = await handler(makeEvent(undefined)).catch((e: any) => e)
    expect(err.statusCode).toBe(401)
  })

  test('returns a streaming zip with expected entries for an authenticated user', async () => {
    mockExportData({
      userId: 'tok|user1',
      user: { name: 'Alice', email: 'alice@example.com' },
      folders: [{ _id: 'f1', name: 'Notes', userId: 'tok|user1' }],
      documents: [
        { _id: 'd1', filename: 'one.pdf', userId: 'tok|user1', fileId: 's1', folderId: 'f1', status: 'success', fileSize: 10 },
      ],
      conversations: [{ _id: 'c1', title: 'chat', userId: 'tok|user1', folderId: 'f1' }],
      messages: [{ _id: 'm1', role: 'user', content: 'hi', userId: 'tok|user1', conversationId: 'c1' }],
      learnFolderSourceManifests: [{ _id: 'fm1', status: 'frozen', userId: 'tok|user1' }],
      learnFolderSourceManifestFolders: [{ _id: 'ff1', manifestId: 'fm1', userId: 'tok|user1' }],
      learnFolderSourceManifestEntries: [{ _id: 'fe1', manifestId: 'fm1', userId: 'tok|user1' }],
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
        'attemptAnswers.json',
        'audioOverviewAlignmentSegments.json',
        'audioOverviewAlignments.json',
        'audioOverviewAudioArtifacts.json',
        'audioOverviewClaimLedgers.json',
        'audioOverviewClaimSources.json',
        'audioOverviewClaims.json',
        'audioOverviewEpisodes.json',
        'audioOverviewInterjectionSources.json',
        'audioOverviewInterjectionUtterances.json',
        'audioOverviewInterjections.json',
        'audioOverviewInterjectionsV2.json',
        'audioOverviewJobs.json',
        'audioOverviewJobTurns.json',
        'audioOverviewLearningObjectives.json',
        'audioOverviewOutlineSources.json',
        'audioOverviewOutlines.json',
        'audioOverviewSceneQualityGates.json',
        'audioOverviewScenes.json',
        'audioOverviewSourceManifestEntries.json',
        'audioOverviewSourceManifests.json',
        'audioOverviewUtteranceClaims.json',
        'audioOverviewUtteranceSources.json',
        'audioOverviewUtterances.json',
        'audioOverviews.json',
        'calendarConnections.json',
        'calendarEvents.json',
        'calendarProjections.json',
        'conversations.json',
        'courses.json',
        'courseSourceDocs.json',
        'courseSections.json',
        'documents.json',
        'documents/d1.pdf',
        'flashcardRoomCards.json',
        'flashcardRoomVersions.json',
        'flashcardRooms.json',
        'flashcardSets.json',
        'flashcardVersionCards.json',
        'flashcards.json',
        'folders.json',
        'learnBlueprintRevisions.json',
        'learnBlueprints.json',
        'learnClaimSupports.json',
        'learnFolderSourceManifestEntries.json',
        'learnFolderSourceManifestFolders.json',
        'learnFolderSourceManifests.json',
        'learnJobs.json',
        'learnLifecycleReceipts.json',
        'learnMilestones.json',
        'learnObjectivePrerequisites.json',
        'learnObjectiveSources.json',
        'learnObjectives.json',
        'learnProfile.json',
        'learnSourceExcerpts.json',
        'learnSourceIdentities.json',
        'learnSourceSnapshots.json',
        'learningVoids.json',
        'manifest.json',
        'masteryAttempts.json',
        'masteryRecords.json',
        'messages.json',
        'quizAttempts.json',
        'quizQuestions.json',
        'quizzes.json',
        'reminderPolicies.json',
        'reviewItems.json',
        'reviewSessions.json',
        'searchQuotaBuckets.json',
        'searchReservations.json',
        'sessionContent.json',
        'sessionContentBlocks.json',
        'sessionContentClaims.json',
        'studyPlanRevisions.json',
        'studyPlans.json',
        'studySessionRetrievalObjectives.json',
        'studySessions.json',
        'tasks.json',
      ].sort(),
    )

    const manifest = JSON.parse(strFromU8(entries['manifest.json']!))
    expect(manifest.schemaVersion).toBe(8)
    expect(manifest.userId).toBe('tok|user1')
    expect(manifest.counts.documents).toBe(1)
    expect(manifest.counts.learnFolderSourceManifests).toBe(1)
    expect(manifest.counts.learnFolderSourceManifestFolders).toBe(1)
    expect(manifest.counts.learnFolderSourceManifestEntries).toBe(1)
    expect(manifest.unresolvedDocuments).toEqual([])
    expect(manifest.nonFileBackedDocuments).toEqual([])

    const pdf = strFromU8(entries['documents/d1.pdf']!)
    expect(pdf).toContain('%PDF-1.4')
  })

  test('follows Convex cursors and streams message and folder-manifest pages into their JSON entries', async () => {
    mockExportData({
      userId: 'tok|user1',
      user: { name: 'Alice', email: 'alice@example.com' },
      documents: [],
    })
    getUserDataPageMock.mockImplementation(({
      collection,
      paginationOpts,
    }: {
      collection: string
      paginationOpts: { cursor: string | null }
    }) => {
      if (collection !== 'messages' && collection !== 'learnFolderSourceManifestEntries') {
        return { page: [], isDone: true, continueCursor: '' }
      }
      if (paginationOpts.cursor === null) {
        return {
          page: collection === 'messages'
            ? [{ _id: 'm1', userId: 'tok|user1', content: 'first' }]
            : [{ _id: 'fe1', userId: 'tok|user1', manifestId: 'fm1', order: 0 }],
          isDone: false,
          continueCursor: `${collection}-page-2`,
        }
      }
      return {
        page: collection === 'messages'
          ? [{ _id: 'm2', userId: 'tok|user1', content: 'second' }]
          : [{ _id: 'fe2', userId: 'tok|user1', manifestId: 'fm1', order: 1 }],
        isDone: true,
        continueCursor: '',
      }
    })

    const zipBytes = await handler(makeEvent('fake-jwt'))
    const entries = unzipSync(zipBytes)
    const messages = JSON.parse(strFromU8(entries['messages.json']!))
    const manifestEntries = JSON.parse(strFromU8(entries['learnFolderSourceManifestEntries.json']!))
    const manifest = JSON.parse(strFromU8(entries['manifest.json']!))

    expect(messages.map((message: { _id: string }) => message._id)).toEqual(['m1', 'm2'])
    expect(manifestEntries.map((entry: { _id: string }) => entry._id)).toEqual(['fe1', 'fe2'])
    expect(manifest.counts.messages).toBe(2)
    expect(manifest.counts.learnFolderSourceManifestEntries).toBe(2)
    expect(getUserDataPageMock.mock.calls.filter(([args]) => args.collection === 'messages')).toHaveLength(2)
    expect(getUserDataPageMock.mock.calls.filter(([args]) => args.collection === 'learnFolderSourceManifestEntries')).toHaveLength(2)
  })

  test('records unresolved documents when the blob URL is missing', async () => {
    mockExportData({
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
    expect(manifest.nonFileBackedDocuments).toEqual([])
  })

  test('uses safe original extensions and falls back to .bin', async () => {
    mockExportData({
      userId: 'tok|user1',
      user: { name: 'Alice', email: 'alice@example.com' },
      documents: [
        { _id: 'd1', filename: 'notes.DOCX', userId: 'tok|user1', fileId: 's1', status: 'success' },
        { _id: 'd2', filename: 'no-extension', userId: 'tok|user1', fileId: 's2', status: 'success' },
      ],
    })
    getDocumentDownloadUrlMock
      .mockResolvedValueOnce({ url: 'https://storage.example.com/d1', filename: 'notes.DOCX' })
      .mockResolvedValueOnce({ url: 'https://storage.example.com/d2', filename: '../unsafe/name.' })
    fetchMock.mockImplementation(() => Promise.resolve({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('document bytes'))
          controller.close()
        },
      }),
    }))

    const zipBytes = await handler(makeEvent('fake-jwt'))
    const entries = unzipSync(zipBytes)

    expect(entries['documents/d1.docx']).toBeDefined()
    expect(entries['documents/d2.bin']).toBeDefined()
    expect(entries['documents/d1.pdf']).toBeUndefined()
    expect(entries['documents/d2.pdf']).toBeUndefined()
  })

  test('records website and YouTube sources as intentionally non-file-backed', async () => {
    mockExportData({
      userId: 'tok|user1',
      user: { name: 'Alice', email: 'alice@example.com' },
      documents: [
        { _id: 'd1', filename: 'example.com', userId: 'tok|user1', sourceType: 'website', sourceUrl: 'https://example.com' },
        { _id: 'd2', filename: 'Video', userId: 'tok|user1', sourceType: 'youtube', sourceUrl: 'https://youtu.be/example' },
      ],
    })

    const zipBytes = await handler(makeEvent('fake-jwt'))
    const entries = unzipSync(zipBytes)
    const manifest = JSON.parse(strFromU8(entries['manifest.json']!))

    expect(getDocumentDownloadUrlMock).not.toHaveBeenCalled()
    expect(manifest.unresolvedDocuments).toEqual([])
    expect(manifest.nonFileBackedDocuments).toEqual([
      { documentId: 'd1', sourceType: 'website', sourceUrl: 'https://example.com' },
      { documentId: 'd2', sourceType: 'youtube', sourceUrl: 'https://youtu.be/example' },
    ])
  })

  test('aborts the response when a document stream fails after emitting bytes', async () => {
    mockExportData({
      userId: 'tok|user1',
      user: { name: 'Alice', email: 'alice@example.com' },
      documents: [
        { _id: 'd1', filename: 'partial.pdf', userId: 'tok|user1', fileId: 's1', folderId: 'f1', status: 'success', fileSize: 10 },
      ],
    })
    getDocumentDownloadUrlMock.mockResolvedValue({
      url: 'https://storage.example.com/partial.pdf',
      filename: 'partial.pdf',
    })

    const read = vi.fn()
      .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('%PDF-partial') })
      .mockRejectedValueOnce(new Error('upstream reset'))
    fetchMock.mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read }) },
    })

    await expect(handler(makeEvent('fake-jwt'))).rejects.toThrow('upstream reset')
  })
})
