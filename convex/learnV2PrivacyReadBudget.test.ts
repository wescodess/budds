/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { getUserDataPage } from './dataExport'
import { getMission, getCurrentMission, listHub } from './learnV2Journey'
import { getResponseState } from './learnV2Responses'
import { getDiagnosticCanvas } from './learnAdaptiveRecovery'
import { listSourceReview } from './learnV2Sources'
import { LEARN_V2_PUBLIC_API_VERSION } from './lib/learnV2PublicContract'
import * as readContext from './lib/learnV2PrivacyReadContext'
import { PERSONAL_RESPONSE_COLLECTIONS } from './lib/learnV2PersonalExportPage'
import { activityResponseAvailable, legacyResponseAvailable, retainedResponsePayload, retainedSourceExcerpt, privacyDigest, threadSourceAvailable, liveResponseAggregate } from './lib/learnV2ResponsePrivacy'
import { authorizeExport } from '../tests/fixtures/learn-v2-personal-export'
import { appendActivityResponseTargets, legacyActivityResponseFixture, activityResponseFixture } from '../tests/fixtures/learn-v2-activity-responses'
import { privacyHistoryFixture, tracePrivacyReads, invokePrivacyQuery, addDistinctActivitySources, canonicalPrivacyPageFixture } from '../tests/fixtures/learn-v2-privacy-reads'
import { seedMeasurementStorage } from '../tests/fixtures/learn-v2-measurement-storage'

vi.mock('../shared/learn-v2-measurement-storage-manifest', async importOriginal => {
  const original = await importOriginal<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...original, LEARN_MEASUREMENT_CAPABILITIES: { ...original.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_001); vi.stubEnv('LEARN_V2_ENABLED', 'true') })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks() })
type Page = { page: Array<Record<string, unknown>>, isDone: boolean, continueCursor: string }

test.each(['get', 'query'] as const)('the %s budget denies before issuing an extra range and preserves unrelated errors', async operation => {
  const f = await privacyHistoryFixture(convexTest(schema, import.meta.glob('./**/*.ts')), 'https://owner.example|privacy-exact-budget')
  await f.owner.run(async ctx => {
    const traced = tracePrivacyReads(ctx)
    const budget = readContext.createResponsePrivacyReadContext(traced.ctx, f.userId, 1)
    const result = await readContext.privacyRead(budget.ctx, f.userId, ['exact-limit'], false, async scoped => {
      if (operation === 'get') {
        await scoped.db.get(f.sourceSnapshotId!)
        await scoped.db.get(f.documentId)
      } else {
        await scoped.db.query('learnSourceSnapshots').take(1)
        await scoped.db.query('learnSourceExcerpts').take(1)
      }
      return true
    })
    expect(result).toBe(false)
    expect(traced.stats.calls).toBe(1)
    expect(budget.reads).toBe(1)
    const fresh = readContext.createResponsePrivacyReadContext(traced.ctx, f.userId, 1)
    await expect(readContext.privacyRead(fresh.ctx, f.userId, ['unrelated-error'], false, async () => { throw new Error('Unrelated read failure') })).rejects.toThrow('Unrelated read failure')
  })
})

test('an internal caller cannot raise the request budget above its reserved allowance', async () => {
  const f = await privacyHistoryFixture(convexTest(schema, import.meta.glob('./**/*.ts')), 'https://owner.example|privacy-budget-ceiling')
  await f.owner.run(async ctx => {
    const traced = tracePrivacyReads(ctx)
    const budget = readContext.createResponsePrivacyReadContext(traced.ctx, f.userId, 10_000)
    const result = await readContext.privacyRead(budget.ctx, f.userId, ['ceiling'], false, async scoped => {
      for (let ordinal = 0; ordinal < 10_000; ordinal++) await scoped.db.query('masteryAttempts').take(0)
      return true
    })
    expect(result).toBe(false)
    expect(traced.stats.calls).toBe(readContext.RESPONSE_PRIVACY_READ_BUDGET - 16)
  })
})

test('bounded history fits the request read budget on mastery, activity and Journey', async () => {
  const f = await privacyHistoryFixture(convexTest(schema, import.meta.glob('./**/*.ts')), 'https://owner.example|privacy-read-history')
  const authorizationId = await authorizeExport(f.owner)
  const profiles = []
  for (const path of ['masteryAttempts', 'learningThreadActivities', 'journey'] as const) {
    const profile = await f.owner.run(async ctx => {
      const traced = tracePrivacyReads(ctx, 20_000)
      const result = path === 'journey' ? await invokePrivacyQuery(getMission, traced.ctx, { learningVoidId: f.learningVoidId })
        : await invokePrivacyQuery(getUserDataPage, traced.ctx, { authorizationId, collection: path, paginationOpts: { cursor: null, numItems: 8 } })
      expect(JSON.stringify(result)).toContain(f.answer)
      return { path, ...traced.stats }
    })
    profiles.push(profile)
  }
  for (const profile of profiles) {
    expect(profile.calls).toBeLessThan(350)
    expect(profile.byTable['get:learnSourceSnapshots']).toBe(4)
    expect(profile.byTable['query:learnSourceExcerpts']).toBe(4)
  }
})

test.each(['learnResponses', 'learnResponseBodies'] as const)('%s preserves eight answers at the maximum source-dependency cardinality', async collection => {
  const f = await canonicalPrivacyPageFixture(convexTest(schema, import.meta.glob('./**/*.ts')), 'https://owner.example|privacy-canonical-cardinality')
  const authorizationId = await authorizeExport(f.owner)
  vi.stubEnv('LEARN_V2_ENABLED', 'false')
  await f.owner.run(async ctx => {
    const traced = tracePrivacyReads(ctx)
    const result = await invokePrivacyQuery(getUserDataPage, traced.ctx, { authorizationId, collection, paginationOpts: { cursor: null, numItems: 8 } })
    expect(result.page).toHaveLength(8)
    for (const row of result.page) expect(row).toMatchObject({ bodyAvailability: 'available' })
    if (collection === 'learnResponseBodies') expect(JSON.stringify(result.page)).toContain(f.answer)
    expect(traced.stats.calls).toBeLessThanOrEqual(readContext.RESPONSE_PRIVACY_READ_BUDGET)
    expect(traced.stats.byTable['query:learnSourceExcerpts']).toBe(512)
  })
}, 30_000)

test.each(PERSONAL_RESPONSE_COLLECTIONS)('%s ends a budget-limited page early and resumes every owned row once in order', async collection => {
  const f = await privacyHistoryFixture(convexTest(schema, import.meta.glob('./**/*.ts')), 'https://owner.example|privacy-budget-page')
  const limit = collection === 'learnResponses' || collection === 'learnResponseBodies' ? 50 : 56
  if (limit === 50) await f.t.run(async ctx => {
    for (let ordinal = 0; ordinal < 7; ordinal++) await seedMeasurementStorage(ctx, f.userId)
  })
  const authorizationId = await authorizeExport(f.owner)
  const expected = await f.t.run(ctx => ctx.db.query(collection).withIndex('by_userId', q => q.eq('userId', f.userId)).take(1000))
  const create = readContext.createResponsePrivacyReadContext
  vi.spyOn(readContext, 'createResponsePrivacyReadContext').mockImplementation((ctx, owner) => create(ctx, owner, limit))
  const ids = []
  let cursor: string | null = null
  for (let ordinal = 0; ordinal < expected.length + 2; ordinal++) {
    const result: Page = await f.owner.run(async ctx => {
      const traced = tracePrivacyReads(ctx)
      const result = await invokePrivacyQuery(getUserDataPage, traced.ctx, { authorizationId, collection, paginationOpts: { cursor, numItems: ordinal === 0 ? 8 : 1 } })
      expect(traced.stats.calls).toBeLessThanOrEqual(limit + 16)
      return result
    })
    expect(result.page).toHaveLength(1)
    expect(JSON.stringify(result.page)).not.toContain(f.answer)
    expect(result.page[0]).toMatchObject({ bodyAvailability: 'unavailable', bodyUnavailableReason: 'evidence_unavailable' })
    ids.push(...result.page.map(row => row._id))
    if (result.isDone) break
    expect(result.continueCursor).not.toBe(cursor)
    cursor = result.continueCursor
  }
  expect(ids).toEqual(expected.map(row => row._id))
})

test('a partially checked export row retries on a fresh page and retains its available answer', async () => {
  const f = await privacyHistoryFixture(convexTest(schema, import.meta.glob('./**/*.ts')), 'https://owner.example|privacy-retried-row')
  const authorizationId = await authorizeExport(f.owner)
  vi.stubEnv('LEARN_V2_ENABLED', 'false')
  const create = readContext.createResponsePrivacyReadContext
  vi.spyOn(readContext, 'createResponsePrivacyReadContext').mockImplementation((ctx, owner) => create(ctx, owner, 110))
  const ids: string[] = []
  let cursor: string | null = null
  for (let ordinal = 0; ordinal < f.attempts.length + 1; ordinal++) {
    const result: Page = await f.owner.run(async ctx => {
      const traced = tracePrivacyReads(ctx)
      const result = await invokePrivacyQuery(getUserDataPage, traced.ctx, { authorizationId, collection: 'masteryAttempts', paginationOpts: { cursor, numItems: 8 } })
      expect(traced.stats.calls).toBeLessThanOrEqual(110 + 16)
      return result
    })
    expect(result.page.length).toBeGreaterThan(0)
    for (const row of result.page) expect(row).toMatchObject({ bodyAvailability: 'available', response: f.answer })
    ids.push(...result.page.map(row => String(row._id)))
    if (result.isDone) break
    expect(result.continueCursor).not.toBe(cursor)
    cursor = result.continueCursor
  }
  expect(ids).toEqual(f.attempts)
})

test('a dense owned history stops at the production budget before the synthetic platform limit', async () => {
  const f = await privacyHistoryFixture(convexTest(schema, import.meta.glob('./**/*.ts')), 'https://owner.example|privacy-dense-history', 16, 1)
  await addDistinctActivitySources(f, 64)
  const authorizationId = await authorizeExport(f.owner)
  for (const path of ['masteryAttempts', 'learningThreadActivities', 'journey'] as const) await f.owner.run(async ctx => {
    const traced = tracePrivacyReads(ctx)
    const result = path === 'journey' ? await invokePrivacyQuery(getMission, traced.ctx, { learningVoidId: f.learningVoidId })
      : await invokePrivacyQuery(getUserDataPage, traced.ctx, { authorizationId, collection: path, paginationOpts: { cursor: null, numItems: 8 } })
    expect(traced.stats.calls).toBeLessThanOrEqual(readContext.RESPONSE_PRIVACY_READ_BUDGET)
    expect(traced.stats.calls).toBeGreaterThan(3000)
    if (path === 'journey') {
      expect(result).toMatchObject({ mastery: [{ attempts: [{ serverScorePercent: 80, bodyAvailability: 'unavailable' }] }] })
    } else {
      expect(result).toMatchObject({ page: [{ bodyAvailability: 'unavailable' }] })
      expect((result as Page).page).toHaveLength(1)
      if (path === 'learningThreadActivities') expect((result as Page).isDone).toBe(false)
    }
    expect(JSON.stringify(result)).not.toContain(f.answer)
  })
}, 30_000)

test('Journey keeps all safe history metadata when its request budget is exhausted', async () => {
  const f = await privacyHistoryFixture(convexTest(schema, import.meta.glob('./**/*.ts')), 'https://owner.example|privacy-budget-journey')
  await f.t.run(async ctx => {
    const first = (await ctx.db.get(f.attempts[0]!))!
    const objectiveId = await ctx.db.insert('learnObjectives', { userId: f.userId, blueprintRevisionId: first.blueprintRevisionId!, order: 1, title: 'Second retained capability' })
    await ctx.db.insert('masteryAttempts', { userId: f.userId, blueprintRevisionId: first.blueprintRevisionId!, objectiveId,
      kind: 'calibration', attemptedAt: Date.now(), confidence: 4, serverScorePercent: 80, response: f.answer,
      sourceSnapshotIdsJson: JSON.stringify(f.sources), idempotencyKey: 'second-objective-history' })
  })
  const create = readContext.createResponsePrivacyReadContext
  vi.spyOn(readContext, 'createResponsePrivacyReadContext').mockImplementation((ctx, owner) => create(ctx, owner, 56))
  await f.owner.run(async ctx => {
    const traced = tracePrivacyReads(ctx)
    const journey = await invokePrivacyQuery(getMission, traced.ctx, { learningVoidId: f.learningVoidId })
    expect(traced.stats.calls).toBeLessThanOrEqual(56 + 16)
    const mastery = journey!.mastery.flatMap(row => row.attempts)
    expect(mastery).toHaveLength(9)
    expect(journey!.calibration.attempts).toHaveLength(8)
    for (const row of [...mastery, ...journey!.calibration.attempts]) expect(row).toMatchObject({ serverScorePercent: 80, confidence: 4, bodyAvailability: 'unavailable' })
    expect(JSON.stringify([...mastery, ...journey!.calibration.attempts])).not.toContain(f.answer)
  })
})

test.each(['response_state', 'diagnostic', 'source_review'] as const)('%s bounds shared authority reads and retains safe metadata after budget denial', async path => {
  const store = convexTest(schema, import.meta.glob('./**/*.ts'))
  const f = path === 'diagnostic' ? await activityResponseFixture(store, 'https://owner.example|privacy-companion', 'legacy')
    : await privacyHistoryFixture(store, 'https://owner.example|privacy-companion')
  const blueprintRevisionId = path === 'source_review' ? (await store.run(ctx => ctx.db.get(f.sourceSnapshotId!)))!.blueprintRevisionId! : null
  const read = async (ctx: import('./_generated/server').QueryCtx) => {
    if (path === 'diagnostic') return await invokePrivacyQuery(getDiagnosticCanvas, ctx, { threadId: f.threadId })
    if (path === 'response_state') return await invokePrivacyQuery(getResponseState, ctx, { version: LEARN_V2_PUBLIC_API_VERSION, target: f.target! })
    return await invokePrivacyQuery(listSourceReview, ctx, { blueprintRevisionId, paginationOpts: { cursor: null, numItems: 16 } })
  }
  const liveCalls = await f.owner.run(async ctx => {
    const traced = tracePrivacyReads(ctx)
    const result = await read(traced.ctx)
    if (path === 'source_review') expect(result).toMatchObject({ page: expect.arrayContaining([expect.objectContaining({ excerpt: 'Source rule' })]) })
    else expect(JSON.stringify(result)).toContain(f.answer)
    expect(traced.stats.calls).toBeLessThan(readContext.RESPONSE_PRIVACY_READ_BUDGET)
    return traced.stats.calls
  })
  const create = readContext.createResponsePrivacyReadContext
  vi.spyOn(readContext, 'createResponsePrivacyReadContext').mockImplementation((ctx, owner) => create(ctx, owner, liveCalls - (path === 'source_review' ? 8 : 4)))
  await f.owner.run(async ctx => {
    const traced = tracePrivacyReads(ctx)
    const result = await read(traced.ctx)
    expect(traced.stats.calls).toBeLessThanOrEqual(liveCalls)
    if (path === 'diagnostic') expect(result).toMatchObject({ thread: { id: f.threadId }, activity: { response: null } })
    else if (path === 'response_state') expect(result).toMatchObject({ status: 'available', work: { body: { bodyAvailability: 'unavailable' } } })
    else expect(result).toMatchObject({ page: expect.arrayContaining([expect.objectContaining({ excerpt: null, rights: expect.objectContaining({ access: 'evidence_unavailable' }) })]) })
    expect(JSON.stringify(result)).not.toContain(f.answer)
  })
})

test('current Journey shares one scope and the hub needs no excerpt disclosure reads', async () => {
  const f = await privacyHistoryFixture(convexTest(schema, import.meta.glob('./**/*.ts')), 'https://owner.example|privacy-hub')
  await f.owner.run(async ctx => {
    const traced = tracePrivacyReads(ctx)
    expect(JSON.stringify(await invokePrivacyQuery(getCurrentMission, traced.ctx, {}))).toContain(f.answer)
    expect(traced.stats.calls).toBeLessThan(350)
  })
  await f.owner.run(async ctx => {
    const traced = tracePrivacyReads(ctx)
    expect(await invokePrivacyQuery(listHub, traced.ctx, {})).toMatchObject({ items: [{ _id: f.learningVoidId }] })
    expect(traced.stats.byTable['query:learnSourceExcerpts'] ?? 0).toBe(0)
    expect(traced.stats.calls).toBeLessThan(20)
  })
})

test.each(['target_overflow', 'source_revoked'])('privacy memos separate owners and activities, including a shared-session alias after %s', async failure => {
  const f = await legacyActivityResponseFixture(convexTest(schema, import.meta.glob('./**/*.ts')), 'https://owner.example|privacy-memo-owner', 'calibration')
  const otherActivityId = await f.t.run(async ctx => {
    const { _id: _id, _creationTime: _time, ...activity } = (await ctx.db.get(f.activityId))!
    return await ctx.db.insert('learningThreadActivities', { ...activity, activityId: 'other-memo-activity', boundaryOrdinal: 2,
      ...(failure === 'source_revoked' ? { canonicalInputSnapshot: '[purged]' } : {}) })
  })
  if (failure === 'target_overflow') await appendActivityResponseTargets({ ...f, activityId: otherActivityId }, 65, true, 'standalone')
  await f.owner.run(async ctx => {
    const scoped = readContext.createResponsePrivacyReadContext(ctx, f.userId).ctx
    const source = await retainedSourceExcerpt(scoped, f.userId, f.sourceSnapshotId!)
    expect(source?.excerpt).toBeTruthy()
    expect(await retainedSourceExcerpt(scoped, 'https://foreign.example|same-subject', f.sourceSnapshotId!)).toBeNull()
    const response = (await ctx.db.get(f.submissionId!))!
    expect(await retainedResponsePayload(scoped, f.userId, response)).toMatchObject({ kind: 'text', text: f.answer })
    const attempt = (await ctx.db.get(f.legacyAttemptId))!
    expect(await legacyResponseAvailable(scoped, f.userId, attempt)).toBe(false)
    expect(await activityResponseAvailable(scoped, f.userId, (await ctx.db.get(otherActivityId))!)).toBe(false)
  })
  const authorizationId = await authorizeExport(f.owner)
  const attempts = await f.owner.query(api.dataExport.getUserDataPage, { authorizationId, collection: 'masteryAttempts', paginationOpts: { cursor: null, numItems: 8 } })
  expect(attempts.page[0]).toMatchObject({ bodyAvailability: 'unavailable' })
  const bodies = await f.owner.query(api.dataExport.getUserDataPage, { authorizationId, collection: 'learnResponseBodies', paginationOpts: { cursor: null, numItems: 8 } })
  expect(bodies.page[0]).toMatchObject({ bodyAvailability: 'available', payload: { kind: 'text', text: f.answer } })
})

test('an unaccepted review result cannot authorize a retained answer in the same request', async () => {
  const f = await privacyHistoryFixture(convexTest(schema, import.meta.glob('./**/*.ts')), 'https://owner.example|privacy-memo-options')
  await f.t.run(ctx => ctx.db.patch(f.sourceSnapshotId!, { status: 'fetched', effectiveStatus: 'fetched' }))
  await f.owner.run(async ctx => {
    const scoped = readContext.createResponsePrivacyReadContext(ctx, f.userId).ctx
    expect(await retainedSourceExcerpt(scoped, f.userId, f.sourceSnapshotId!, { allowUnaccepted: true })).not.toBeNull()
    expect(await retainedSourceExcerpt(scoped, f.userId, f.sourceSnapshotId!)).toBeNull()
  })
})

test('response and legacy memo keys cannot substitute another target payload or activity bound', async () => {
  const t = convexTest(schema, import.meta.glob('./**/*.ts'))
  const userId = 'https://owner.example|privacy-response-keys'
  const a = await legacyActivityResponseFixture(t, userId, 'calibration')
  const b = await legacyActivityResponseFixture(t, userId, 'calibration')
  const payload = { kind: 'text' as const, text: 'A distinct retained answer' }
  const payloadDigest = await privacyDigest(payload)
  await t.run(async ctx => {
    await ctx.db.patch(b.submissionId!, { payloadDigest })
    await ctx.db.patch(b.activityId, { submittedResponse: payload.text })
    await ctx.db.patch(b.legacyAttemptId, { response: payload.text })
    const body = (await ctx.db.query('learnResponseBodies').withIndex('by_userId_and_submissionId', q => q.eq('userId', userId).eq('submissionId', b.submissionId!)).unique())!
    await ctx.db.patch(body._id, { payload, payloadDigest, payloadBytes: new TextEncoder().encode(JSON.stringify(payload)).byteLength })
  })
  await a.owner.run(async ctx => {
    const scoped = readContext.createResponsePrivacyReadContext(ctx, userId).ctx
    expect(await retainedResponsePayload(scoped, userId, (await ctx.db.get(a.submissionId!))!)).toMatchObject({ text: a.answer })
    expect(await retainedResponsePayload(scoped, userId, (await ctx.db.get(b.submissionId!))!)).toEqual(payload)
  })
  await appendActivityResponseTargets(b, 64, true, 'standalone')
  await a.owner.run(async ctx => {
    const scoped = readContext.createResponsePrivacyReadContext(ctx, userId).ctx
    expect(await retainedResponsePayload(scoped, userId, (await ctx.db.get(a.submissionId!))!)).not.toBeNull()
    expect(await retainedResponsePayload(scoped, userId, (await ctx.db.get(b.submissionId!))!)).toBeNull()
    expect(await legacyResponseAvailable(scoped, userId, (await ctx.db.get(a.legacyAttemptId))!)).toBe(true)
    expect(await legacyResponseAvailable(scoped, userId, (await ctx.db.get(b.legacyAttemptId))!)).toBe(false)
    expect(await activityResponseAvailable(scoped, userId, (await ctx.db.get(a.activityId))!)).toBe(true)
    expect(await activityResponseAvailable(scoped, userId, (await ctx.db.get(b.activityId))!)).toBe(false)
  })
})

test('source, thread and aggregate memo keys cannot reuse another scope authority', async () => {
  const t = convexTest(schema, import.meta.glob('./**/*.ts'))
  const userId = 'https://owner.example|privacy-authority-keys'
  const a = await legacyActivityResponseFixture(t, userId, 'calibration')
  const b = await legacyActivityResponseFixture(t, userId, 'calibration')
  const ids = await t.run(async ctx => {
    const source = (await ctx.db.get(b.sourceSnapshotId!))!
    await ctx.db.patch(source._id, { evidencePurgedAt: Date.now() })
    await ctx.db.patch(source.learningVoidId, { status: 'archived' })
    await ctx.db.patch(b.documentId, { status: 'failed' })
    await ctx.db.patch(b.threadId, { sourceScope: { kind: 'document', sourceId: String(b.documentId) } })
    return { a: (await ctx.db.get(a.sourceSnapshotId!))!.learningVoidId, b: source.learningVoidId }
  })
  await a.owner.run(async ctx => {
    const scoped = readContext.createResponsePrivacyReadContext(ctx, userId).ctx
    expect(await retainedSourceExcerpt(scoped, userId, a.sourceSnapshotId!)).not.toBeNull()
    expect(await retainedSourceExcerpt(scoped, userId, b.sourceSnapshotId!)).toBeNull()
    expect(await threadSourceAvailable(scoped, userId, (await ctx.db.get(a.threadId))!)).toBe(true)
    expect(await threadSourceAvailable(scoped, userId, (await ctx.db.get(b.threadId))!)).toBe(false)
    expect(await liveResponseAggregate(scoped, userId, { scopeKind: 'v2', learningVoidId: ids.a })).toBe(true)
    expect(await liveResponseAggregate(scoped, userId, { scopeKind: 'v2', learningVoidId: ids.b })).toBe(false)
  })
})

test.each(['owner', 'collection', 'foreign_row'] as const)('pending export IDs recheck their %s boundary', async boundary => {
  const f = await privacyHistoryFixture(convexTest(schema, import.meta.glob('./**/*.ts')), 'https://owner.example|privacy-continuation')
  const authorizationId = await authorizeExport(f.owner)
  const create = readContext.createResponsePrivacyReadContext
  const spy = vi.spyOn(readContext, 'createResponsePrivacyReadContext').mockImplementation((ctx, owner) => create(ctx, owner, 56))
  const args = { authorizationId, collection: 'masteryAttempts' as const, paginationOpts: { cursor: null as string | null, numItems: 8 } }
  const first = await f.owner.query(api.dataExport.getUserDataPage, args)
  expect(first.isDone).toBe(false)
  spy.mockRestore()
  const prefix = 'learn-v2.personal-content-page.v1:'
  const cursor = JSON.parse(first.continueCursor.slice(prefix.length)) as { owner: string, collection: string, pending: string[] }
  if (boundary === 'owner') cursor.owner = 'https://foreign.example|same-subject'
  else if (boundary === 'collection') cursor.collection = 'learningThreadActivities'
  else cursor.pending = [await f.t.run(async ctx => {
    const attempt = (await ctx.db.get(f.attempts[0]!))!
    return await ctx.db.insert('masteryAttempts', { userId: 'https://foreign.example|same-subject', objectiveId: attempt.objectiveId,
      kind: 'calibration', attemptedAt: Date.now(), serverScorePercent: 13, idempotencyKey: 'foreign-pending' })
  })]
  await expect(f.owner.query(api.dataExport.getUserDataPage, { ...args, paginationOpts: { cursor: prefix + JSON.stringify(cursor), numItems: 8 } })).rejects.toThrow('Export continuation unavailable')
})

test.each(['deleted', 'revoked'] as const)('a pending continuation reads current %s authority', async change => {
  const f = await privacyHistoryFixture(convexTest(schema, import.meta.glob('./**/*.ts')), 'https://owner.example|privacy-continuation-current')
  const authorizationId = await authorizeExport(f.owner)
  const create = readContext.createResponsePrivacyReadContext
  const spy = vi.spyOn(readContext, 'createResponsePrivacyReadContext').mockImplementation((ctx, owner) => create(ctx, owner, 56))
  const args = { authorizationId, collection: 'masteryAttempts' as const, paginationOpts: { cursor: null as string | null, numItems: 8 } }
  const first = await f.owner.query(api.dataExport.getUserDataPage, args)
  spy.mockRestore()
  await f.t.run(async ctx => {
    if (change === 'deleted') await ctx.db.delete(f.attempts[1]!)
    else await ctx.db.patch(f.sourceSnapshotId!, { evidencePurgedAt: Date.now() })
  })
  const resumed = await f.owner.query(api.dataExport.getUserDataPage, { ...args, paginationOpts: { cursor: first.continueCursor, numItems: 8 } })
  expect(resumed.isDone).toBe(true)
  expect([...first.page, ...resumed.page].map(row => row._id)).toEqual(f.attempts.filter((_, index) => change !== 'deleted' || index !== 1))
  if (change === 'revoked') expect(JSON.stringify(resumed)).not.toContain(f.answer)
})

test('a pending continuation honors smaller pages before advancing its native cursor', async () => {
  const f = await privacyHistoryFixture(convexTest(schema, import.meta.glob('./**/*.ts')), 'https://owner.example|privacy-smaller-page')
  const authorizationId = await authorizeExport(f.owner)
  const create = readContext.createResponsePrivacyReadContext
  const spy = vi.spyOn(readContext, 'createResponsePrivacyReadContext').mockImplementation((ctx, owner) => create(ctx, owner, 56))
  const first = await f.owner.query(api.dataExport.getUserDataPage, { authorizationId, collection: 'learningThreadActivities', paginationOpts: { cursor: null, numItems: 8 } })
  expect(first.page).toHaveLength(1)
  expect(first.isDone).toBe(false)
  spy.mockRestore()
  const ids = first.page.map(row => row._id)
  let cursor = first.continueCursor
  for (let ordinal = 0; ordinal < f.activities.length; ordinal++) {
    const result: Page = await f.owner.query(api.dataExport.getUserDataPage, { authorizationId, collection: 'learningThreadActivities', paginationOpts: { cursor, numItems: 1 } })
    expect(result.page).toHaveLength(1)
    ids.push(...result.page.map(row => String(row._id)))
    if (result.isDone) break
    expect(result.continueCursor).not.toBe(cursor)
    cursor = result.continueCursor
  }
  expect(ids).toEqual(f.activities)
})

test('a request memo cannot survive the next handler call after source revocation', async () => {
  const f = await privacyHistoryFixture(convexTest(schema, import.meta.glob('./**/*.ts')), 'https://owner.example|privacy-memo-lifetime')
  const authorizationId = await authorizeExport(f.owner)
  const args = { authorizationId, collection: 'masteryAttempts' as const, paginationOpts: { cursor: null, numItems: 8 } }
  expect(JSON.stringify(await f.owner.query(api.dataExport.getUserDataPage, args))).toContain(f.answer)
  expect(JSON.stringify(await f.owner.query(api.learnV2Journey.getMission, { learningVoidId: f.learningVoidId }))).toContain(f.answer)
  await f.t.run(async ctx => {
    const source = (await ctx.db.get(f.sourceSnapshotId!))!
    await ctx.db.patch(source.sourceIdentityId, { tombstonedAt: Date.now() })
  })
  const result = await f.owner.query(api.dataExport.getUserDataPage, args)
  expect(result.page).toHaveLength(8)
  expect(JSON.stringify(result)).not.toContain(f.answer)
  for (const row of result.page) expect(row).toMatchObject({ bodyAvailability: 'unavailable', serverScorePercent: 80 })
  expect(JSON.stringify(await f.owner.query(api.learnV2Journey.getMission, { learningVoidId: f.learningVoidId }))).not.toContain(f.answer)
})
