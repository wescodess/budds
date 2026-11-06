/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import type { GenericValidator } from 'convex/values'
import schema from './schema'
import { PERSONAL_EXPORT_COLLECTIONS, PERSONAL_EXPORT_CONTENT_COLLECTIONS, PERSONAL_EXPORT_CHILD_CONTENT_PARENTS, PERSONAL_EXPORT_COLLECTION_POLICY } from './lib/learnV2PersonalExportCollections'
import { PERSONAL_EXPORT_CONTENT_CASES, measurementExportFixture, seedExportContent } from '../tests/fixtures/learn-v2-export-content'
import { authorizeExport } from '../tests/fixtures/learn-v2-personal-export'
import { LINEAGE_EXPORT_FIELDS, seedMeasurementStorage } from '../tests/fixtures/learn-v2-measurement-storage'
import { LEARN_MEASUREMENT_COLLECTIONS } from '../shared/learn-v2-measurement-storage-manifest'

vi.mock('../shared/learn-v2-measurement-storage-manifest', async importOriginal => {
  const original = await importOriginal<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...original, LEARN_MEASUREMENT_CAPABILITIES: { ...original.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})

const modules = import.meta.glob('./**/*.ts')
const identity = { tokenIdentifier: 'https://owner.example|export-exposure' }
type ExportPage = { page: Array<Record<string, unknown>>, isDone: boolean, continueCursor: string }
beforeEach(() => {
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  vi.useFakeTimers()
  vi.setSystemTime(1_800_000_000_001)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

test('every audited content projection is in the inventory and every classified collection has a direct page', async () => {
  expect(PERSONAL_EXPORT_COLLECTIONS).toHaveLength(126)
  expect(PERSONAL_EXPORT_CONTENT_COLLECTIONS).toHaveLength(39)
  expect(LEARN_MEASUREMENT_COLLECTIONS).toHaveLength(29)
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

test.each(Object.keys(LINEAGE_EXPORT_FIELDS) as Array<keyof typeof LINEAGE_EXPORT_FIELDS>)('%s exports only audited metadata through owned pages with flags off', async collection => {
  vi.stubEnv('LEARN_V2_ENABLED', 'false')
  expect(PERSONAL_EXPORT_COLLECTION_POLICY[collection]).toBe('metadata')
  expect(PERSONAL_EXPORT_CONTENT_COLLECTIONS).not.toContain(collection)
  const fields: Record<string, GenericValidator> = schema.tables[collection].validator.fields
  for (const name of LINEAGE_EXPORT_FIELDS[collection]) {
    const field = fields[name]!
    expect(field.kind === 'float64' || field.kind === 'literal' || field.kind === 'union' && field.members.every(member => member.kind === 'literal')).toBe(true)
  }
  const t = convexTest(schema, modules)
  const f = await t.run(ctx => seedMeasurementStorage(ctx, identity.tokenIdentifier))
  const foreign = await t.run(ctx => seedMeasurementStorage(ctx, 'https://foreign.example|lineage-export'))
  await t.run(async ctx => {
    await ctx.db.patch(f.rows.learnArtifactLineages, { nextId: f.rows.learnArtifactLineages, invalidatedAt: 0 })
    await ctx.db.patch(f.rows.learnArtifactValidations, { invalidatedAt: 0 })
    await ctx.db.patch(f.rows.learnArtifactSourceLinks, { invalidatedAt: 0 })
  })
  const owner = t.withIdentity(identity)
  await expect(owner.query(api.dataExport.getUserDataPage, { collection, paginationOpts: { cursor: null, numItems: 1 } })).rejects.toThrow('Export authorization unavailable')
  const authorizationId = await authorizeExport(owner)
  const rows: Array<Record<string, unknown>> = []
  let cursor: string | null = null
  for (let page = 0; page < 8; page++) {
    const result: ExportPage = await owner.query(api.dataExport.getUserDataPage, { authorizationId, collection, paginationOpts: { cursor, numItems: 1 } })
    expect(result.page.length).toBeLessThanOrEqual(1)
    rows.push(...result.page)
    if (result.isDone) break
    cursor = result.continueCursor
    expect(page).toBeLessThan(7)
  }
  const stored = await t.run(ctx => ctx.db.query(collection).withIndex('by_userId', q => q.eq('userId', identity.tokenIdentifier)).take(8))
  const allowed = ['_id', '_creationTime', 'createdAt', ...LINEAGE_EXPORT_FIELDS[collection]]
  expect(rows).toEqual(stored.map(row => Object.fromEntries(allowed.flatMap(name => {
    const value = (row as unknown as Record<string, unknown>)[name]
    return value === undefined ? [] : [[name, value]]
  }))))
  expect(JSON.stringify(rows)).not.toContain(foreign.rows[collection])
  expect(rows.some(row => row._id === f.rows[collection])).toBe(true)
})

test('lineage metadata changes do not change the reusable content inventory or add assistance exposures', async () => {
  const t = convexTest(schema, modules)
  const f = await t.run(ctx => seedMeasurementStorage(ctx, identity.tokenIdentifier))
  const owner = t.withIdentity(identity)
  const authorizationId = await authorizeExport(owner)
  const before = await t.run(ctx => ctx.db.query('learnAssessmentExposures').withIndex('by_userId', q => q.eq('userId', identity.tokenIdentifier)).take(16))
  await t.run(async ctx => {
    const row = (await ctx.db.get(f.rows.learnArtifactLineages))!
    const { _id: _id, _creationTime: _time, ...fields } = row
    await ctx.db.insert('learnArtifactLineages', fields)
    await ctx.db.patch(f.rows.learnArtifactValidations, { decision: 'reject', invalidatedAt: Date.now() })
  })
  expect(await authorizeExport(owner)).toBe(authorizationId)
  expect(await t.run(ctx => ctx.db.query('learnAssessmentExposures').withIndex('by_userId', q => q.eq('userId', identity.tokenIdentifier)).take(16))).toEqual(before)
  for (const collection of Object.keys(LINEAGE_EXPORT_FIELDS) as Array<keyof typeof LINEAGE_EXPORT_FIELDS>) {
    await expect(owner.query(api.dataExport.getUserDataPage, { authorizationId, collection, paginationOpts: { cursor: null, numItems: 8 } })).resolves.toHaveProperty('page')
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
