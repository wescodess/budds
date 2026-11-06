/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { PERSONAL_EXPORT_COLLECTIONS, PERSONAL_EXPORT_CONTENT_COLLECTIONS, PERSONAL_EXPORT_CHILD_CONTENT_PARENTS } from './lib/learnV2PersonalExportCollections'
import { PERSONAL_EXPORT_CONTENT_CASES, measurementExportFixture, seedExportContent } from '../tests/fixtures/learn-v2-export-content'
import { authorizeExport } from '../tests/fixtures/learn-v2-personal-export'

vi.mock('../shared/learn-v2-measurement-storage-manifest', async importOriginal => {
  const original = await importOriginal<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...original, LEARN_MEASUREMENT_CAPABILITIES: { ...original.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})

const modules = import.meta.glob('./**/*.ts')
const identity = { tokenIdentifier: 'https://owner.example|export-exposure' }
beforeEach(() => {
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  vi.useFakeTimers()
  vi.setSystemTime(1_800_000_000_001)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

test('every audited content projection is in the inventory and every classified collection has a direct page', async () => {
  expect(new Set(PERSONAL_EXPORT_CONTENT_CASES.map(([collection]) => collection))).toEqual(new Set(PERSONAL_EXPORT_CONTENT_COLLECTIONS))
  expect(PERSONAL_EXPORT_CHILD_CONTENT_PARENTS).toEqual({ attemptAnswers: 'quizAttempts' })
  expect(PERSONAL_EXPORT_CONTENT_COLLECTIONS).toContain(PERSONAL_EXPORT_CHILD_CONTENT_PARENTS.attemptAnswers)
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(identity)
  vi.stubEnv('LEARN_V2_ENABLED', 'false')
  const authorizationId = await authorizeExport(owner)
  for (const collection of PERSONAL_EXPORT_COLLECTIONS) {
    expect(await owner.query(api.dataExport.getUserDataPage, { authorizationId, collection,
      paginationOpts: { cursor: null, numItems: 1 } })).toMatchObject({ page: [], isDone: true })
  }
})

test('the measurement control is unassisted and eligible before any personal export', async () => {
  const fixture = await measurementExportFixture(convexTest(schema, modules), identity.tokenIdentifier)
  const accepted = await fixture.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: fixture.submission })
  expect(accepted.kind).toBe('accepted')
  if (accepted.kind !== 'accepted') throw new Error('Expected acceptance')
  expect(await fixture.t.run(ctx => ctx.db.get(accepted.submissionId))).toMatchObject({
    assistanceSnapshot: { state: 'unassisted' }, validitySnapshot: { measurementEligible: true },
  })
})

test.each(PERSONAL_EXPORT_CONTENT_CASES)('exported %s.%s records unresolved assistance before measurement sealing', async (collection, field) => {
  const fixture = await measurementExportFixture(convexTest(schema, modules), identity.tokenIdentifier)
  const content = await seedExportContent(fixture, [collection, field])
  const authorizationId = await authorizeExport(fixture.owner)
  const page = await fixture.owner.query(api.dataExport.getUserDataPage, { authorizationId, collection,
    paginationOpts: { cursor: null, numItems: 8 } })
  const exported = page.page.find(row => row._id === content.id) as Record<string, unknown> | undefined
  expect(JSON.stringify(exported?.[field])).toContain(content.canary)
  const exposures = await fixture.t.run(ctx => ctx.db.query('learnAssessmentExposures')
    .withIndex('by_userId_and_assessmentOpportunityId', q => q.eq('userId', identity.tokenIdentifier).eq('assessmentOpportunityId', fixture.assessmentOpportunityId)).take(8))
  expect(exposures).toEqual(expect.arrayContaining([expect.objectContaining({ purpose: 'imported', status: 'unknown' })]))
  const accepted = await fixture.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: fixture.submission })
  expect(accepted.kind).toBe('accepted')
  if (accepted.kind !== 'accepted') throw new Error('Expected acceptance')
  const snapshot = await fixture.t.run(ctx => ctx.db.get(accepted.submissionId))
  expect(snapshot).toMatchObject({ assistanceSnapshot: { state: 'unknown' }, validitySnapshot: { measurementEligible: false } })
  await authorizeExport(fixture.owner)
  expect(await fixture.t.run(ctx => ctx.db.get(accepted.submissionId))).toEqual(snapshot)
})

test('a newly saved diagnostic invalidates the reusable inventory authorization before its page returns', async () => {
  const fixture = await measurementExportFixture(convexTest(schema, modules), identity.tokenIdentifier)
  const authorizationId = await authorizeExport(fixture.owner)
  await fixture.t.run(ctx => ctx.db.insert('messages', { userId: 'https://foreign.example|export-exposure',
    conversationId: '0conversations' as never, role: 'user', content: 'foreign saved answer' }))
  expect(await authorizeExport(fixture.owner)).toBe(authorizationId)
  const content = await seedExportContent(fixture, ['learningThreadActivities', 'submittedResponse'])
  const page = { collection: 'learningThreadActivities' as const, paginationOpts: { cursor: null, numItems: 8 } }
  await expect(fixture.owner.query(api.dataExport.getUserDataPage, { ...page, authorizationId })).rejects.toThrow('Export authorization unavailable')
  const refreshed = await authorizeExport(fixture.owner)
  expect(refreshed).not.toBe(authorizationId)
  expect(JSON.stringify(await fixture.owner.query(api.dataExport.getUserDataPage, { ...page, authorizationId: refreshed }))).toContain(content.canary)
})
