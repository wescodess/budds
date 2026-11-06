import { privacyDigest } from '../../../convex/lib/learnV2ResponsePrivacy'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { convexTest } from 'convex-test'
import { api, internal } from '../../../convex/_generated/api'
import schema from '../../../convex/schema'
import { LINEAGE_EXPORT_FIELDS, seedMeasurementStorage, STORAGE_CANARIES } from '../../../tests/fixtures/learn-v2-measurement-storage'
import { authorizeExport } from '../../../tests/fixtures/learn-v2-personal-export'
import { ADAPTIVE_LEARN_EXPORT_COLLECTIONS } from '../../../shared/adaptive-learn-storage-manifest'
import { LEARN_MEASUREMENT_STORAGE_MANIFEST, LEARN_MEASUREMENT_COLLECTIONS } from '../../../shared/learn-v2-measurement-storage-manifest'
import { LEARN_V2_MEASUREMENT_REPORT_VERSION, LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION } from '../../../shared/learn-v2-measurement-report'
import { LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION, LEARN_V2_RESPONSE_TERMINALIZATION_VERSION } from '../../../shared/learn-v2-responses'
import { deriveLearnAssessmentResponseContext } from '../../../shared/learn-v2-measurement'
import { PERSONAL_EXPORT_COLLECTIONS, PERSONAL_EXPORT_CONTENT_COLLECTIONS } from '../../../convex/lib/learnV2PersonalExportCollections'
import { PERSONAL_EXPORT_CONTENT_CASES, measurementExportFixture, seedExportContent } from '../../../tests/fixtures/learn-v2-export-content'
import { standaloneResponseFixture } from '../../../tests/fixtures/learn-v2-standalone-response'

vi.mock('../../../shared/learn-v2-measurement-storage-manifest', async importOriginal => {
  const original = await importOriginal<typeof import('../../../shared/learn-v2-measurement-storage-manifest')>()
  return { ...original, LEARN_MEASUREMENT_CAPABILITIES: { ...original.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

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

const authorizeExportMock = vi.fn()
const getExportMetadataMock = vi.fn()
const getUserDataPageMock = vi.fn()
const getAttemptAnswersPageMock = vi.fn()
const getCourseSourceDocsPageMock = vi.fn()
const getDocumentDownloadUrlMock = vi.fn()

vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    setAuth(_token: string) {}
    mutation(_fnRef: unknown, args: unknown) { return authorizeExportMock(args) }
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

const { default: handler, EXPORT_COLLECTIONS } = await import('./me.get')

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
    authorizeExportMock.mockReset().mockResolvedValue({ authorizationId: 'fixture-export-authorization', done: true, cursor: null })
    getExportMetadataMock.mockReset()
    getUserDataPageMock.mockReset()
    getAttemptAnswersPageMock.mockReset()
    getCourseSourceDocsPageMock.mockReset()
    getDocumentDownloadUrlMock.mockReset()
    fetchMock.mockReset()
    for (const key of Object.keys(recordedHeaders)) Reflect.deleteProperty(recordedHeaders, key)
    process.env.CONVEX_URL = 'https://test.convex.cloud'
  })

  test.each([[false, 'document_deleted'], [true, 'document_deleted'], [false, 'folder_deleted'], [true, 'body_purged']] as const)(
    'decoded ZIP withholds standalone aliases with canonical=%s after %s, before and after cleanup', async (canonical, revocation) => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
    vi.stubEnv('LEARN_V2_ENABLED', 'true')
    const t = convexTest(schema, import.meta.glob('../../../convex/**/*.ts'))
    const f = await standaloneResponseFixture(t, 'https://owner.example|zip-standalone-privacy', revocation === 'folder_deleted' ? 'folder' : 'document', canonical)
    authorizeExportMock.mockImplementation(args => f.owner.mutation(api.dataExport.authorizePersonalExport, args))
    getExportMetadataMock.mockImplementation(() => f.owner.query(api.dataExport.getExportMetadata, {}))
    getUserDataPageMock.mockImplementation(args => f.owner.query(api.dataExport.getUserDataPage, args))
    getAttemptAnswersPageMock.mockImplementation(args => f.owner.query(api.dataExport.getAttemptAnswersPage, args))
    getCourseSourceDocsPageMock.mockImplementation(args => f.owner.query(api.dataExport.getCourseSourceDocsPage, args))
    getDocumentDownloadUrlMock.mockResolvedValue(null)
    vi.stubEnv('LEARN_V2_ENABLED', 'false')
    const live = unzipSync(await handler(makeEvent('fixture-jwt')))
    expect(JSON.parse(strFromU8(live['learningThreadActivities.json']!))).toMatchObject([{ submittedResponse: f.answer, diagnosticResponse: f.answer }])
    if (revocation === 'document_deleted') await f.owner.mutation(api.documents.deleteDocument, { id: f.documentId })
    if (revocation === 'folder_deleted') await f.owner.mutation(api.folders.deleteFolder, { id: f.folderId })
    if (revocation === 'body_purged') await t.mutation(internal.learnV2Retention.purgeResponseCopies, { userId: f.userId, submissionId: f.submissionId! })
    expect((await t.run(ctx => ctx.db.get(f.activityId)))?.submittedResponse).toBe(f.answer)
    for (const cleanup of [false, true]) {
      if (cleanup) await t.finishAllScheduledFunctions(vi.runAllTimers)
      const entries = unzipSync(await handler(makeEvent('fixture-jwt')))
      const rows = JSON.parse(strFromU8(entries['learningThreadActivities.json']!))
      expect(rows).toMatchObject([{ _id: f.activityId, status: 'submitted', bodyAvailability: 'unavailable' }])
      expect(rows[0]).not.toHaveProperty('submittedResponse')
      expect(rows[0]).not.toHaveProperty('diagnosticResponse')
      for (const [name, bytes] of Object.entries(entries)) if (name.endsWith('.json')) expect(strFromU8(bytes)).not.toContain(f.answer)
    }
  })

  test('returns 401 when no Convex token is present on the event', async () => {
    const err = await handler(makeEvent(undefined)).catch((e: any) => e)
    expect(err.statusCode).toBe(401)
  })

  test('ZIP and Convex share the classified collection inventory and preserve every audited content projection', async () => {
    expect(EXPORT_COLLECTIONS).toBe(PERSONAL_EXPORT_COLLECTIONS)
    expect(EXPORT_COLLECTIONS).toHaveLength(126)
    expect(PERSONAL_EXPORT_CONTENT_COLLECTIONS).toHaveLength(39)
    expect(new Set(PERSONAL_EXPORT_CONTENT_CASES.map(([collection]) => collection))).toEqual(new Set(PERSONAL_EXPORT_CONTENT_COLLECTIONS))
    vi.stubEnv('LEARN_V2_ENABLED', 'false')
    const t = convexTest(schema, import.meta.glob('../../../convex/**/*.ts'))
    const fixture = await measurementExportFixture(t, 'https://owner.example|zip-content-inventory')
    const contents = []
    for (const entry of PERSONAL_EXPORT_CONTENT_CASES) contents.push(await seedExportContent(fixture, entry))
    const foreign = await t.run(ctx => ctx.db.insert('messages', { userId: 'https://foreign.example|zip-content-inventory',
      conversationId: '0conversations' as never, role: 'user', content: 'foreign-export-content-canary' }))
    const owner = fixture.owner
    authorizeExportMock.mockImplementation(args => owner.mutation(api.dataExport.authorizePersonalExport, args))
    getExportMetadataMock.mockImplementation(() => owner.query(api.dataExport.getExportMetadata, {}))
    getUserDataPageMock.mockImplementation(args => owner.query(api.dataExport.getUserDataPage, args))
    getAttemptAnswersPageMock.mockImplementation(args => owner.query(api.dataExport.getAttemptAnswersPage, args))
    getCourseSourceDocsPageMock.mockImplementation(args => owner.query(api.dataExport.getCourseSourceDocsPage, args))
    getDocumentDownloadUrlMock.mockResolvedValue(null)
    const entries = unzipSync(await handler(makeEvent('fixture-jwt')))
    for (const content of contents) {
      const rows = JSON.parse(strFromU8(entries[`${content.collection}.json`]!)) as Array<Record<string, unknown>>
      const row = rows.find(row => row._id === content.id)
      expect(JSON.stringify(row?.[content.field])).toContain(content.canary)
    }
    expect(strFromU8(entries['messages.json']!)).not.toContain(foreign)
    expect(strFromU8(entries['messages.json']!)).not.toContain('foreign-export-content-canary')
    const exposure = await t.run(ctx => ctx.db.query('learnAssessmentExposures')
      .withIndex('by_userId_and_assessmentOpportunityId', q => q.eq('userId', fixture.tokenIdentifier).eq('assessmentOpportunityId', fixture.assessmentOpportunityId)).take(8))
    expect(exposure).toEqual(expect.arrayContaining([expect.objectContaining({ purpose: 'imported', status: 'unknown' })]))
    vi.unstubAllEnvs()
  })

  test('pages the real owned Phase C records through ZIP with the same safe projections', async () => {
    vi.stubEnv('LEARN_V2_ENABLED', 'false')
    const identity = { tokenIdentifier: 'https://auth.example.com|zip-owner' }
    const t = convexTest(schema, import.meta.glob('../../../convex/**/*.ts'))
    const f = await t.run(ctx => seedMeasurementStorage(ctx, identity.tokenIdentifier))
    const other = await t.run(ctx => seedMeasurementStorage(ctx, 'https://other.example.com|zip-owner'))
    await t.run(async ctx => {
      await ctx.db.patch(f.rows.learnArtifactLineages, { nextId: f.rows.learnArtifactLineages, invalidatedAt: 0 })
      await ctx.db.patch(f.rows.learnArtifactValidations, { invalidatedAt: 0 })
      await ctx.db.patch(f.rows.learnArtifactSourceLinks, { invalidatedAt: 0 })
      const legacy = await ctx.db.get(f.rows.learnResponses)
      if (!legacy || !('baselineEpoch' in legacy)) throw new Error('Missing fixture response')
      const { _id: _id, _creationTime: _creationTime, baselineEpoch: _epoch, flow: _flow, ...fields } = legacy
      const context = deriveLearnAssessmentResponseContext({ contextPins: { ...f.scope.contextPins, contentInputDigest: 'a'.repeat(64) },
        assignment: { status: 'admitted', assignmentId: f.rows.learnMeasurementAssignments, epoch: 'fixture-epoch', flow: 'v2_today' } })
      await ctx.db.replace(f.rows.learnResponses, { ...fields, ...context })
      const { assessmentOpportunityId: _opportunity, assessmentPins: _pins, scoringBinding: _binding, deliveryGrantId: _grant, ...formativeFields } = fields
      const payload = { kind: 'text' as const, text: 'retained formative answer' }
      const payloadDigest = await privacyDigest(payload)
      const formativeId = await ctx.db.insert('learnResponses', { ...formativeFields, responseSlotId: f.rows.learnResponseSlots, payloadDigest,
        currentEligibility: 'excluded', validitySnapshot: { ...formativeFields.validitySnapshot, status: 'excluded', measurementEligible: false, masteryEligible: false, exclusionReasons: ['formative'] } })
      await ctx.db.insert('learnResponseBodies', { ...f.base, learningVoidId: f.learningVoidId, submissionId: formativeId,
        payload, payloadDigest, payloadBytes: new TextEncoder().encode(JSON.stringify(payload)).byteLength })
      const evidence = (await ctx.db.get(f.rows.learnResponseEvidenceLinks))!
      const { _id: _linkId, _creationTime: _linkTime, ...linkFields } = evidence
      await ctx.db.insert('learnResponseEvidenceLinks', { ...linkFields, submissionId: formativeId })
      await ctx.db.patch(f.rows.learnResponseSlots, { status: 'accepted', submissionId: formativeId })
      await ctx.db.insert('masteryAttempts', { userId: identity.tokenIdentifier, objectiveId: f.scope.objectiveId, attemptedAt: 123,
        idempotencyKey: 'legacy-export-answer', activityContractVersion: 'learn-v2.mastery-attempt.v1', response: 'retained legacy answer', confidence: 4, usedHint: true, usedReveal: false,
        serverScorePercent: 80, result: 'passed', sourceSnapshotIdsJson: JSON.stringify([f.sourceSnapshotId]),
        rubricSnapshot: STORAGE_CANARIES.rubric, feedbackProjectionJson: STORAGE_CANARIES.key, contentRevisionPinsJson: STORAGE_CANARIES.locator })
      await ctx.db.patch(f.rows.learnResponseSlots, { confidenceRequested: false })
      await ctx.db.patch(f.rows.learnAssessmentOpportunities, { deliveryPins: { version: LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION, confidenceRequested: true } })
      const target = { responseSlotId: f.rows.learnResponseSlots }
      await ctx.db.insert('learnResponseCommandReceipts', { ...f.base, learningVoidId: f.learningVoidId,
        idempotencyKeyHash: 'terminalization-hash', requestDigest: 'terminalization-digest', commandVersion: LEARN_V2_RESPONSE_TERMINALIZATION_VERSION, target,
        result: { kind: 'terminalized', target, revision: 2, reasonCode: 'cancelled', terminalizedAt: f.base.createdAt } })
    })
    const asUser = t.withIdentity(identity)
    authorizeExportMock.mockImplementation(args => asUser.mutation(api.dataExport.authorizePersonalExport, args))
    getExportMetadataMock.mockImplementation(() => asUser.query(api.dataExport.getExportMetadata, {}))
    getUserDataPageMock.mockImplementation(args => asUser.query(api.dataExport.getUserDataPage, args))
    getAttemptAnswersPageMock.mockImplementation(args => asUser.query(api.dataExport.getAttemptAnswersPage, args))
    getCourseSourceDocsPageMock.mockImplementation(args => asUser.query(api.dataExport.getCourseSourceDocsPage, args))
    getDocumentDownloadUrlMock.mockResolvedValue(null)
    const entries = unzipSync(await handler(makeEvent('fixture-jwt')))
    const authorizationId = await authorizeExport(asUser)
    for (const entry of LEARN_MEASUREMENT_STORAGE_MANIFEST) {
      const rows = JSON.parse(strFromU8(entries[`${entry.table}.json`]!))
      if (entry.export === 'withheld') expect(rows).toEqual([])
      else expect(rows.map((row: { _id: string }) => row._id)).toContain(f.rows[entry.table])
      const serialized = JSON.stringify(rows)
      for (const key of [...Object.values(f.reportKeys), ...Object.values(other.reportKeys)]) expect(serialized).not.toContain(key)
      expect(serialized).not.toContain(other.rows[entry.table])
      if (entry.table.startsWith('learnArtifact')) {
        const collection = entry.table as keyof typeof LINEAGE_EXPORT_FIELDS
        const allowed = ['_id', '_creationTime', 'createdAt', ...LINEAGE_EXPORT_FIELDS[collection]]
        const stored = await t.run(ctx => ctx.db.query(collection).withIndex('by_userId', q => q.eq('userId', identity.tokenIdentifier)).take(8))
        expect(rows).toEqual(stored.map(row => Object.fromEntries(allowed.flatMap(name => {
          const value = (row as unknown as Record<string, unknown>)[name]
          return value === undefined ? [] : [[name, value]]
        }))))
        const direct = await asUser.query(api.dataExport.getUserDataPage, { authorizationId, collection, paginationOpts: { cursor: null, numItems: 8 } })
        expect(rows).toEqual(direct.page)
        for (const field of ['artifact', 'payloadDigest', 'manifestDigest', 'lineageId', 'originLineageId', 'caseId', 'validationId', 'dependency', 'authorityVersion', 'nextId']) {
          expect(rows.every((row: Record<string, unknown>) => !Object.hasOwn(row, field))).toBe(true)
        }
      }
      for (const [name, canary] of Object.entries(STORAGE_CANARIES)) {
        if (name === 'answer' && entry.export === 'owner_response') expect(serialized).toContain(canary)
        else expect(serialized).not.toContain(canary)
      }
    }
    const answers = strFromU8(entries['learnResponseBodies.json']!)
    expect(answers).toContain(STORAGE_CANARIES.answer)
    expect(answers).toContain('retained formative answer')
    expect(strFromU8(entries['masteryAttempts.json']!)).toContain('retained legacy answer')
    expect(JSON.parse(strFromU8(entries['masteryAttempts.json']!))).toEqual(expect.arrayContaining([
      expect.objectContaining({ response: 'retained legacy answer', activityContractVersion: 'learn-v2.mastery-attempt.v1' }),
    ]))
    const cells = JSON.parse(strFromU8(entries['learnMeasurementReportCells.json']!))
    expect(cells).toMatchObject([{ reportVersion: LEARN_V2_MEASUREMENT_REPORT_VERSION }])
    expect(cells[0]).not.toHaveProperty('legacyIndependentAudit')
    const reportRows = JSON.parse(strFromU8(entries['learnMeasurementReportRows.json']!))
    expect(reportRows).toMatchObject([{ sourceVersion: LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION }])
    expect(reportRows[0]).not.toHaveProperty('snapshot')
    const responseRows = JSON.parse(strFromU8(entries['learnResponses.json']!)) as Array<Record<string, unknown>>
    expect(responseRows.find(row => row._id === f.rows.learnResponses)).toMatchObject({ flow: 'today',
      measurementContext: { status: 'admitted', assignmentId: f.rows.learnMeasurementAssignments, baselineEpoch: 'fixture-epoch' } })
    expect(responseRows.find(row => row.responseSlotId === f.rows.learnResponseSlots)).toMatchObject({ currentEligibility: 'excluded', validity: { measurementEligible: false, exclusionReasons: ['formative'] } })
    expect(JSON.parse(strFromU8(entries['learnResponseSlots.json']!))).toMatchObject([{ confidenceRequested: false }])
    expect(JSON.parse(strFromU8(entries['learnAssessmentOpportunities.json']!))).toMatchObject([{ deliveryPins: { confidenceRequested: true } }])
    const terminalized = JSON.parse(strFromU8(entries['learnResponseCommandReceipts.json']!)).find((row: { commandVersion: string }) => row.commandVersion === LEARN_V2_RESPONSE_TERMINALIZATION_VERSION)
    expect(terminalized.result).toEqual({ kind: 'terminalized', target: { responseSlotId: f.rows.learnResponseSlots }, revision: 2, reasonCode: 'cancelled', terminalizedAt: f.base.createdAt })
    expect(terminalized).not.toHaveProperty('expiresAt')
    expect(terminalized).not.toHaveProperty('idempotencyKeyHash')
    expect(terminalized).not.toHaveProperty('requestDigest')
    const manifest = JSON.parse(strFromU8(entries['manifest.json']!))
    expect(manifest.measurementStorage.version).toBe('learn-v2.measurement-storage.v1')
    expect(manifest.measurementStorage.omitted).toContain('unseen_prompts')
    expect(manifest.measurementStorage.omitted).toContain('private_rubrics')
    expect(getUserDataPageMock.mock.calls.every(([args]) => args.paginationOpts.numItems === 8)).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
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
      quizAnswerAssessments: [{ _id: 'qa1', userId: 'tok|user1', status: 'available', label: 'fully_correct' }],
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
        ...ADAPTIVE_LEARN_EXPORT_COLLECTIONS.map(table => `${table}.json`),
        ...LEARN_MEASUREMENT_COLLECTIONS.map(table => `${table}.json`),
        'calendarReconciliationProposals.json', 'calendarWebhookReceipts.json', 'calendarWatchChannels.json', 'learnMasteryScoringRateEvents.json',
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
        'learnPlanAuditEvents.json',
        'learnPlanCommandReceipts.json',
        'learnProfile.json',
        'learnSourceCommandReceipts.json',
        'learnSourceExcerpts.json',
        'learnSourceFetchLeases.json',
        'learnSourceFetchRateEvents.json',
        'learnSourceIdentities.json',
        'learnSourceSnapshots.json',
        'learningVoids.json',
        'manifest.json',
        'masteryAttempts.json',
        'masteryRecords.json',
        'messages.json',
        'quizAnswerAssessments.json',
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
    expect(manifest.schemaVersion).toBe(11)
    expect(manifest.userId).toBe('tok|user1')
    expect(manifest.counts.documents).toBe(1)
    expect(manifest.counts.learnFolderSourceManifests).toBe(1)
    expect(manifest.counts.learnFolderSourceManifestFolders).toBe(1)
    expect(manifest.counts.learnFolderSourceManifestEntries).toBe(1)
    expect(manifest.counts.quizAnswerAssessments).toBe(1)
    expect(manifest.unresolvedDocuments).toEqual([])
    expect(manifest.nonFileBackedDocuments).toEqual([])

    const pdf = strFromU8(entries['documents/d1.pdf']!)
    expect(pdf).toContain('%PDF-1.4')
    expect(JSON.parse(strFromU8(entries['quizAnswerAssessments.json']!))).toEqual([
      { _id: 'qa1', userId: 'tok|user1', status: 'available', label: 'fully_correct' },
    ])
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
