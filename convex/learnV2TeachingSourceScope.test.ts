/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Doc, Id } from './_generated/dataModel'
import { api } from './_generated/api'
import { teachingReadScope } from './lib/learnV2TeachingReadScope'
import { HELP_OWNER, helpConsumerFixture } from '../tests/fixtures/learn-v2-help-consumers'

const policy = vi.hoisted(() => ({ responses: true }))
vi.mock('../shared/learn-v2-measurement-storage-manifest', async importOriginal => {
  const original = await importOriginal<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...original, LEARN_MEASUREMENT_CAPABILITIES: { ...original.LEARN_MEASUREMENT_CAPABILITIES,
    get responses() { return policy.responses } } }
})
const modules = import.meta.glob('./**/*.ts')
const acceptedBody = 'CURRENT_ACCEPTED_SOURCE_BODY'
const unusedBody = 'UNUSED_CANDIDATE_BODY'
const hash = 'a'.repeat(64)
beforeEach(() => { policy.responses = true; vi.stubEnv('LEARN_V2_ENABLED', 'true'); vi.stubEnv('NUXT_BETTER_AUTH_SECRET', 'source-scope-fixture'); vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_001) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

async function fixture(open = false) {
  const s = await helpConsumerFixture(modules, true)
  await s.t.run(async ctx => {
    await ctx.db.patch(s.f.learningVoidId, { status: 'map_review', activeBlueprintRevisionId: undefined })
    await ctx.db.patch(s.f.scope.blueprintRevisionId, { status: 'draft', revision: 2 })
    await ctx.db.patch(s.f.documentId, { r2Key: 'fixture/source', contentHash: hash, sourceRevision: `sha256:${hash}` })
    await ctx.db.patch(s.f.sourceSnapshotId, { blueprintRevisionId: s.f.scope.blueprintRevisionId, revision: 2, objectKey: 'fixture/source', contentHash: hash, sourceRevision: `sha256:${hash}` })
    await ctx.db.patch(s.f.sourceExcerptId, { excerpt: acceptedBody })
    if (!open) await ctx.db.delete(s.f.rows.learnAssessmentOpportunities)
  })
  return s
}
type Fixture = Awaited<ReturnType<typeof fixture>>
async function source(s: Fixture, status: Doc<'learnSourceSnapshots'>['status'] = 'evaluated', blueprintRevisionId = s.f.scope.blueprintRevisionId) {
  return await s.t.run(async ctx => {
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { userId: HELP_OWNER.tokenIdentifier, learningVoidId: s.f.learningVoidId,
      origin: 'user_url', externalKey: `https://example.com/${status}/${blueprintRevisionId}`, canonicalUrl: 'https://example.com/', title: 'Safe source title' })
    const id = await ctx.db.insert('learnSourceSnapshots', { userId: HELP_OWNER.tokenIdentifier, learningVoidId: s.f.learningVoidId, sourceIdentityId,
      blueprintRevisionId, revision: 1, recordRevision: 1, status, effectiveStatus: status, rightsStatus: 'permitted', conflictStatus: 'clear', createdAt: Date.now() })
    await ctx.db.insert('learnSourceExcerpts', { userId: HELP_OWNER.tokenIdentifier, sourceSnapshotId: id, locator: 'https://example.com/', excerpt: unusedBody, rightsStatus: 'permitted' })
    return id
  })
}
async function reject(s: Fixture, id: Id<'learnSourceSnapshots'>) {
  expect(await s.owner.mutation(api.learnV2Sources.rejectSource, { sourceSnapshotId: id, expectedRevision: 1, idempotencyKey: `reject_${id}` })).toMatchObject({ status: 'rejected' })
}
const paths = ['mission', 'current', 'review', 'missionDelivery', 'currentDelivery', 'reviewDelivery'] as const
type Path = typeof paths[number]
async function read(s: Fixture, path: Path) {
  const mission = { learningVoidId: s.f.learningVoidId }
  const review = { blueprintRevisionId: s.f.scope.blueprintRevisionId, paginationOpts: { numItems: 20, cursor: null } }
  const delivery = { idempotencyKey: `source_scope_${path}` }
  if (path === 'mission') return await s.owner.query(api.learnV2Journey.getMission, mission)
  if (path === 'current') return await s.owner.query(api.learnV2Journey.getCurrentMission, {})
  if (path === 'review') return await s.owner.query(api.learnV2Sources.listSourceReview, review)
  if (path === 'missionDelivery') return await s.owner.mutation(api.learnV2Journey.getMissionDelivery, { ...mission, ...delivery })
  if (path === 'currentDelivery') return await s.owner.mutation(api.learnV2Journey.getCurrentMissionDelivery, delivery)
  return await s.owner.mutation(api.learnV2Sources.listSourceReviewDelivery, { ...review, ...delivery })
}

test.each(paths.flatMap(path => [false, true].map(responses => ({ path, responses }))))('$path retains accepted evidence after public rejection (responses $responses)', async ({ path, responses }) => {
  policy.responses = responses
  const s = await fixture()
  const id = await source(s)
  expect(JSON.stringify(await read(s, path))).toContain(acceptedBody)
  await reject(s, id)
  const result = JSON.stringify(await read(s, path))
  expect(result).toContain(acceptedBody)
  expect(result).not.toContain(unusedBody)
  expect(result).toContain(id)
  expect(result).not.toContain('assessmentContract')
})

test('source review keeps mixed lifecycle metadata and only current available bodies', async () => {
  const s = await fixture()
  const ids: Id<'learnSourceSnapshots'>[] = []
  for (const status of ['candidate', 'fetched', 'evaluated', 'unavailable', 'rejected'] as const) ids.push(await source(s, status))
  const review = await s.owner.query(api.learnV2Sources.listSourceReview, { blueprintRevisionId: s.f.scope.blueprintRevisionId, paginationOpts: { numItems: 20, cursor: null } })
  expect(review.page.filter(row => ids.includes(row._id)).map(row => [row.effectiveStatus, row.excerpt])).toEqual([
    ['candidate', null], ['fetched', unusedBody], ['evaluated', unusedBody], ['unavailable', null], ['rejected', null],
  ])
  expect(JSON.stringify(await read(s, 'mission'))).not.toContain(unusedBody)
})

test.each(paths)('$0 excludes unrelated historical revisions from mandatory authority', async path => {
  const s = await fixture()
  const historical = await s.t.run(async ctx => {
    const current = (await ctx.db.get(s.f.scope.blueprintRevisionId))!
    const { _id, _creationTime, ...fields } = current
    return await ctx.db.insert('learnBlueprintRevisions', { ...fields, revision: 1, status: 'superseded' })
  })
  const id = await source(s, 'evaluated', historical)
  await s.t.run(async ctx => {
    const row = (await ctx.db.get(id))!
    await ctx.db.patch(row.sourceIdentityId, { tombstonedAt: Date.now() })
    await ctx.db.patch(id, { status: 'rejected', effectiveStatus: 'rejected' })
  })
  // More than the old whole-Void cap, all outside the returned revision.
  for (let index = 0; index < 64; index++) await source(s, 'candidate', historical)
  const result = JSON.stringify(await read(s, path))
  expect(result).toContain(acceptedBody)
  expect(result).not.toContain(id)
  expect(result).not.toContain(unusedBody)
})

test.each(paths)('$0 excludes an older revision of the same document from current snapshot authority', async path => {
  const s = await fixture()
  const historicalId = await s.t.run(async ctx => {
    const current = (await ctx.db.get(s.f.scope.blueprintRevisionId))!
    const { _id, _creationTime, ...fields } = current
    const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { ...fields, revision: 1, status: 'superseded' })
    const sourceId = await ctx.db.insert('learnSourceSnapshots', { userId: HELP_OWNER.tokenIdentifier, learningVoidId: s.f.learningVoidId,
      sourceIdentityId: s.f.sourceIdentityId, blueprintRevisionId, revision: 1, recordRevision: 1, status: 'user_accepted', effectiveStatus: 'user_accepted',
      sourceRevision: `sha256:${'b'.repeat(64)}`, contentHash: 'b'.repeat(64), objectKey: 'fixture/old-source', rightsStatus: 'permitted', conflictStatus: 'clear', createdAt: Date.now() - 1 })
    await ctx.db.insert('learnSourceExcerpts', { userId: HELP_OWNER.tokenIdentifier, sourceSnapshotId: sourceId, locator: 'https://example.com/', excerpt: unusedBody, rightsStatus: 'permitted' })
    return sourceId
  })
  const result = JSON.stringify(await read(s, path))
  expect(result).toContain(acceptedBody)
  expect(result).not.toContain(unusedBody)
  expect(await s.owner.run(ctx => teachingReadScope(ctx, HELP_OWNER.tokenIdentifier, [{ kind: 'source_snapshot', id: historicalId }]))).toBeNull()
})

test('a draft mission resolves the latest Blueprint rather than an unrelated older revision', async () => {
  const s = await fixture()
  await s.t.run(async ctx => {
    await ctx.db.patch(s.f.learningVoidId, { status: 'map_review', activeBlueprintRevisionId: undefined })
    await ctx.db.patch(s.f.scope.blueprintRevisionId, { status: 'draft', revision: 2 })
    const current = (await ctx.db.get(s.f.scope.blueprintRevisionId))!
    const { _id, _creationTime, ...fields } = current
    await ctx.db.insert('learnBlueprintRevisions', { ...fields, revision: 1, status: 'superseded' })
  })
  expect(JSON.stringify(await read(s, 'mission'))).toContain(acceptedBody)
})

test('an active mission follows its accepted pointer rather than a newer draft', async () => {
  const s = await fixture()
  await s.t.run(async ctx => {
    await ctx.db.patch(s.f.learningVoidId, { status: 'active', activeBlueprintRevisionId: s.f.scope.blueprintRevisionId })
    await ctx.db.patch(s.f.scope.blueprintRevisionId, { status: 'accepted' })
    const current = (await ctx.db.get(s.f.scope.blueprintRevisionId))!
    const { _id, _creationTime, ...fields } = current
    await ctx.db.insert('learnBlueprintRevisions', { ...fields, revision: 3, status: 'draft' })
  })
  expect(JSON.stringify(await read(s, 'mission'))).toContain(acceptedBody)
})

test.each(paths.flatMap(path => (['tombstone', 'pin', 'foreign', 'rights'] as const).map(revocation => ({ path, revocation }))))('$path still denies a required accepted source after $revocation', async ({ path, revocation }) => {
  const s = await fixture()
  await source(s, 'user_accepted') // Surviving bytes must not hide a broken map dependency.
  await s.t.run(async ctx => {
    if (revocation === 'tombstone') await ctx.db.patch(s.f.sourceIdentityId, { tombstonedAt: Date.now() })
    else if (revocation === 'pin') await ctx.db.patch(s.f.documentId, { sourceRevision: `sha256:${'b'.repeat(64)}` })
    else if (revocation === 'foreign') await ctx.db.patch(s.f.sourceSnapshotId, { userId: 'foreign-owner' })
    else await ctx.db.patch(s.f.sourceSnapshotId, { rightsStatus: 'prohibited' })
  })
  if (path.endsWith('Delivery')) expect(await read(s, path)).toMatchObject({ admission: { status: 'denied', reasonCode: 'unavailable' }, value: null })
  else await expect(read(s, path)).rejects.toMatchObject({ data: { admission: { status: 'denied', reasonCode: 'unavailable' } } })
})

test('metadata exclusions retain Void/folder relevance and do not bypass an open check', async () => {
  const s = await fixture(true)
  const id = await source(s)
  await reject(s, id)
  const scope = await s.owner.run(ctx => teachingReadScope(ctx, HELP_OWNER.tokenIdentifier, [{ kind: 'learning_void', id: s.f.learningVoidId }]))
  expect(scope?.references).toEqual(expect.arrayContaining([{ kind: 'learning_void', id: s.f.learningVoidId }, { kind: 'folder', id: s.f.folderId }, { kind: 'source_snapshot', id: s.f.sourceSnapshotId }]))
  expect(scope?.references).not.toContainEqual({ kind: 'source_snapshot', id })
  await s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { phase: 'test_open', submissionId: undefined }))
  for (const path of paths) {
    const result = await read(s, path).then(value => ({ value }), (error: unknown) => ({ error }))
    expect(JSON.stringify(result)).not.toContain(acceptedBody)
    if ('value' in result) expect(result.value).toMatchObject({ admission: { status: 'denied' }, value: null })
    else expect(result.error).toMatchObject({ data: { admission: { status: 'denied' } } })
  }
  expect((await s.exposures()).some(row => row.status === 'requested_denied')).toBe(true)
})

test.each(['foreign', 'cycle'] as const)('explicit snapshot authority retains $0 folder ancestry denial', async ancestry => {
  const s = await fixture()
  await s.t.run(async ctx => {
    const parentId = ancestry === 'cycle' ? s.f.folderId : await ctx.db.insert('folders', { userId: 'foreign-owner', name: 'Foreign', documentCount: 0 })
    await ctx.db.patch(s.f.folderId, { parentId })
  })
  await expect(read(s, 'mission')).rejects.toMatchObject({ data: { admission: { status: 'denied', reasonCode: 'unavailable' } } })
})
