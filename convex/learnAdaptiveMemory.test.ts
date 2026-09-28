/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|memory-owner' }
const OTHER = { tokenIdentifier: 'https://auth.example.com|memory-other' }
const originalFlag = process.env.LEARN_V2_ENABLED
beforeEach(() => { process.env.LEARN_V2_ENABLED = 'true'; vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })
afterAll(() => { if (originalFlag === undefined) delete process.env.LEARN_V2_ENABLED; else process.env.LEARN_V2_ENABLED = originalFlag })

async function fixture() {
  const t = convexTest(schema, modules)
  for (const identity of [OWNER, OTHER]) {
    const actor = t.withIdentity(identity)
    await actor.mutation(api.users.upsertUser, {})
    await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
    await actor.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  }
  const threadId = await t.run(ctx => ctx.db.insert('learningThreads', {
    userId: OWNER.tokenIdentifier, originalNeed: 'Explain a topic', outcome: 'Give a clear explanation', intent: 'understand',
    availableTime: '15', authorityKind: 'standalone', sourceScope: { kind: 'none' }, evidenceState: 'none',
    lifecycle: 'active', unresolvedPoint: 'I cannot explain it yet', revision: 1, createdAt: 1, updatedAt: 1,
  }))
  return { t, threadId, owner: t.withIdentity(OWNER), other: t.withIdentity(OTHER) }
}

test('memory is owner scoped and keeps editable preferences separate from historical context', async () => {
  const { t, threadId, owner, other } = await fixture()
  const initial = await owner.query(api.learnAdaptive.getMemory, { threadId })
  expect(initial).toMatchObject({ threadRevision: 1, unresolvedPoint: 'I cannot explain it yet', preferences: [], artifacts: [], history: [] })
  expect(initial).not.toHaveProperty('mastery')
  expect(await other.query(api.learnAdaptive.getMemory, { threadId })).toBeNull()
  const input = { threadId, key: 'representation' as const, operation: 'set' as const, value: 'Use concise diagrams', expectedRevision: 1, idempotencyKey: 'memory-set-0000001' }
  const saved = await owner.mutation(api.learnAdaptive.setMemoryPreference, input)
  expect(saved).toMatchObject({ kind: 'ok', value: { key: 'representation', state: 'active' }, revision: 2 })
  expect(await owner.mutation(api.learnAdaptive.setMemoryPreference, input)).toEqual(saved)
  expect(await owner.query(api.learnAdaptive.getMemory, { threadId })).toMatchObject({ preferences: [{ key: 'representation', value: 'Use concise diagrams', state: 'active' }] })
  await t.run(ctx => ctx.db.patch(threadId, { nextAction: { kind: 'submit_response', label: 'Submit mastery', reasonCode: 'forged', activityId: 'missing' } }))
  expect((await owner.query(api.learnAdaptive.getMemory, { threadId }))?.nextAction?.label).not.toBe('Submit mastery')
  expect(await t.run(ctx => ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(1))).toEqual([])
})

test('stale, foreign, and changed-key commands do not alter preference; disable and clear are explicit', async () => {
  const { threadId, owner, other } = await fixture()
  const input = { threadId, key: 'pace' as const, operation: 'set' as const, value: 'Short steps', expectedRevision: 1, idempotencyKey: 'memory-pace-0001' }
  await expect(other.mutation(api.learnAdaptive.setMemoryPreference, input)).rejects.toThrow(/not found/i)
  expect(await owner.mutation(api.learnAdaptive.setMemoryPreference, input)).toMatchObject({ kind: 'ok', revision: 2 })
  expect(await owner.mutation(api.learnAdaptive.setMemoryPreference, { ...input, value: 'Long steps' })).toMatchObject({ kind: 'conflict', code: 'duplicate_key' })
  expect(await owner.mutation(api.learnAdaptive.setMemoryPreference, { ...input, value: 'Long steps', idempotencyKey: 'memory-pace-0002' })).toMatchObject({ kind: 'conflict', code: 'stale_revision' })
  expect(await owner.query(api.learnAdaptive.getMemory, { threadId })).toMatchObject({ preferences: [{ value: 'Short steps', state: 'active' }] })
  expect(await owner.mutation(api.learnAdaptive.setMemoryPreference, { threadId, key: 'pace', operation: 'disable', expectedRevision: 2, idempotencyKey: 'memory-pace-0003' })).toMatchObject({ kind: 'ok', revision: 3 })
  expect(await owner.query(api.learnAdaptive.getMemory, { threadId })).toMatchObject({ preferences: [{ value: null, state: 'disabled' }] })
  expect(await owner.mutation(api.learnAdaptive.setMemoryPreference, { threadId, key: 'pace', operation: 'clear', expectedRevision: 3, idempotencyKey: 'memory-pace-0004' })).toMatchObject({ kind: 'ok', revision: 4 })
  expect(await owner.query(api.learnAdaptive.getMemory, { threadId })).toMatchObject({ preferences: [] })
})

test('preference export is owner scoped and thread deletion removes the record', async () => {
  const { t, threadId, owner, other } = await fixture()
  await owner.mutation(api.learnAdaptive.setMemoryPreference, {
    threadId, key: 'practice_style', operation: 'set', value: 'Recall before hints', expectedRevision: 1, idempotencyKey: 'memory-export-0001',
  })
  const page = await owner.query(api.dataExport.getUserDataPage, { collection: 'learningThreadPreferences', paginationOpts: { cursor: null, numItems: 100 } })
  expect(page.page).toMatchObject([{ threadId, key: 'practice_style', value: 'Recall before hints' }])
  expect((await other.query(api.dataExport.getUserDataPage, { collection: 'learningThreadPreferences', paginationOpts: { cursor: null, numItems: 100 } })).page).toEqual([])
  await owner.mutation(api.learnAdaptive.requestThreadDeletion, { threadId })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect((await owner.query(api.dataExport.getUserDataPage, { collection: 'learningThreadPreferences', paginationOpts: { cursor: null, numItems: 100 } })).page).toEqual([])
})
