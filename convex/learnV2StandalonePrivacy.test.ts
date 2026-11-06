/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { standaloneResponseFixture } from '../tests/fixtures/learn-v2-standalone-response'
import { authorizeExport } from '../tests/fixtures/learn-v2-personal-export'
import { LEARN_V2_PUBLIC_API_VERSION } from './lib/learnV2PublicContract'

vi.mock('../shared/learn-v2-measurement-storage-manifest', async importOriginal => {
  const original = await importOriginal<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...original, LEARN_MEASUREMENT_CAPABILITIES: { ...original.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

const cases = [
  [false, 'document_deleted'], [false, 'document_unavailable'], [false, 'folder_deleted'],
  [true, 'document_deleted'], [true, 'document_unavailable'], [true, 'document_replaced'], [true, 'folder_deleted'], [true, 'body_purged'],
] as const

test('direct folder cleanup purges copies across owner and activity pages without touching other scopes or owners', async () => {
  vi.useFakeTimers()
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  const t = convexTest(schema, import.meta.glob('./**/*.ts'))
  const f = await standaloneResponseFixture(t, 'https://owner.example|bounded-standalone', 'folder')
  const unrelated = await standaloneResponseFixture(t, f.userId, 'none')
  const foreign = await standaloneResponseFixture(t, 'https://foreign.example|bounded-standalone', 'folder')
  const ids = await t.run(async ctx => {
    const { _id: _threadId, _creationTime: _threadTime, ...thread } = (await ctx.db.get(f.threadId))!
    const { _id: _activityId, _creationTime: _activityTime, ...activity } = (await ctx.db.get(f.activityId))!
    const ids = [f.activityId]
    for (let index = 0; index < 10; index++) {
      const threadId = await ctx.db.insert('learningThreads', { ...thread, currentActivityId: undefined })
      for (let ordinal = 0; ordinal < (index === 0 ? 10 : 1); ordinal++) ids.push(await ctx.db.insert('learningThreadActivities', {
        ...activity, threadId, activityId: `bounded-${index}-${ordinal}`, boundaryOrdinal: ordinal + 1,
      }))
    }
    return ids
  })
  await f.owner.mutation(api.folders.deleteFolder, { id: f.folderId })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  for (const id of ids) expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ canonicalInputSnapshot: '[purged]', primitivePlan: [] })
  for (const id of ids) expect((await t.run(ctx => ctx.db.get(id)))?.submittedResponse).toBeUndefined()
  expect((await t.run(ctx => ctx.db.get(unrelated.activityId)))?.submittedResponse).toBe(unrelated.answer)
  expect((await t.run(ctx => ctx.db.get(foreign.activityId)))?.submittedResponse).toBe(foreign.answer)
})

test.each(cases)('standalone aliases share source authority with canonical=%s after %s', async (canonical, revocation) => {
  vi.useFakeTimers()
  vi.setSystemTime(1_800_000_000_000)
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  const t = convexTest(schema, import.meta.glob('./**/*.ts'))
  const f = await standaloneResponseFixture(t, 'https://owner.example|standalone-privacy', revocation === 'folder_deleted' ? 'folder' : 'document', canonical)
  const unrelated = await standaloneResponseFixture(t, f.userId, 'none', false)
  const foreign = await standaloneResponseFixture(t, 'https://foreign.example|standalone-privacy')
  const pages = async () => {
    vi.stubEnv('LEARN_V2_ENABLED', 'false')
    const authorizationId = await authorizeExport(f.owner)
    const page = await f.owner.query(api.dataExport.getUserDataPage, { authorizationId, collection: 'learningThreadActivities', paginationOpts: { cursor: null, numItems: 16 } })
    vi.stubEnv('LEARN_V2_ENABLED', 'true')
    return page.page
  }
  expect((await pages()).find(row => row._id === f.activityId)).toMatchObject({ submittedResponse: f.answer, diagnosticResponse: f.answer })
  expect((await f.owner.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId: f.threadId }))?.activity).toMatchObject({ response: f.answer })
  if (revocation === 'document_deleted') await f.owner.mutation(api.documents.deleteDocument, { id: f.documentId })
  if (revocation === 'document_unavailable') await t.mutation(internal.documents.updateDocumentStatus, { id: f.documentId, status: 'failed' })
  if (revocation === 'document_replaced') await t.mutation(internal.documents.updateDocumentStatus, { id: f.documentId, status: 'success', sourceRevision: 'source.r2' })
  if (revocation === 'folder_deleted') await f.owner.mutation(api.folders.deleteFolder, { id: f.folderId })
  if (revocation === 'body_purged') await t.mutation(internal.learnV2Retention.purgeResponseCopies, { userId: f.userId, submissionId: f.submissionId! })
  expect((await t.run(ctx => ctx.db.get(f.activityId)))?.submittedResponse).toBe(f.answer)
  const assertDenied = async () => {
    const rows = await pages()
    const row = rows.find(row => row._id === f.activityId)
    expect(row).toMatchObject({ threadId: f.threadId, updatedAt: expect.any(Number), bodyAvailability: 'unavailable', bodyUnavailableReason: 'evidence_unavailable' })
    expect(row).not.toHaveProperty('submittedResponse')
    expect(row).not.toHaveProperty('diagnosticResponse')
    const canvas = await f.owner.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId: f.threadId })
    expect(canvas?.activity).toMatchObject({ response: null, planRevision: 1 })
    if (f.responseSlotId) {
      const state = await f.owner.query(api.learnV2Responses.getResponseState, { version: LEARN_V2_PUBLIC_API_VERSION, target: { responseSlotId: f.responseSlotId } })
      expect(state).toMatchObject({ work: { submissionId: f.submissionId, acceptedAt: 1_800_000_000_000 } })
      expect(JSON.stringify(state)).not.toContain(f.answer)
    }
    expect(rows.find(row => row._id === unrelated.activityId)).toMatchObject({ submittedResponse: unrelated.answer })
    expect(rows.find(row => row._id === foreign.activityId)).toBeUndefined()
  }
  await assertDenied()
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  await assertDenied()
  if (revocation === 'document_deleted' || revocation === 'folder_deleted' || revocation === 'body_purged') {
    expect((await t.run(ctx => ctx.db.get(f.activityId)))?.submittedResponse).toBeUndefined()
  }
  expect((await t.run(ctx => ctx.db.get(unrelated.activityId)))?.submittedResponse).toBe(unrelated.answer)
  expect((await t.run(ctx => ctx.db.get(foreign.activityId)))?.submittedResponse).toBe(foreign.answer)
})
