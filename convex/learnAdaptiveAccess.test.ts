/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import { ADAPTIVE_PROVIDER_ACTIONS, requireAdaptiveJobAdmission, requireAdaptiveMutationAccess, requireAdaptiveQueryAccess } from './lib/adaptiveLearnAccess'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const originalFlag = process.env.LEARN_V2_ENABLED
const OWNER = { tokenIdentifier: 'https://auth.example.com|adaptive-owner', subject: 'adaptive-owner', issuer: 'https://auth.example.com' }

beforeEach(() => { process.env.LEARN_V2_ENABLED = 'true' })
afterAll(() => { if (originalFlag === undefined) delete process.env.LEARN_V2_ENABLED; else process.env.LEARN_V2_ENABLED = originalFlag })

async function setup() {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(OWNER)
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: OWNER.tokenIdentifier, enabled: true })
  return { t, owner }
}

describe('Adaptive Learn canonical access gate', () => {
  test.each([undefined, '', 'false', 'TRUE', ' true ', '1'])('fails closed for absent or malformed V2 flag %s', async (flag) => {
    const { owner } = await setup()
    await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
    if (flag === undefined) delete process.env.LEARN_V2_ENABLED
    else process.env.LEARN_V2_ENABLED = flag
    await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'denied' })
    await expect(owner.query(ctx => requireAdaptiveQueryAccess(ctx))).rejects.toThrow(/denied/)
    await expect(owner.mutation(ctx => requireAdaptiveMutationAccess(ctx))).rejects.toThrow(/denied/)
    await expect(owner.mutation(ctx => requireAdaptiveJobAdmission(ctx))).rejects.toThrow(/denied/)
  })

  test('is default-deny and conjunctive with V2 plus adaptive entitlement', async () => {
    const { t, owner } = await setup()
    await expect(t.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'denied' })
    await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'denied' })
    await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
    await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'allowed' })
    await expect(owner.query(ctx => requireAdaptiveQueryAccess(ctx))).resolves.toBe(OWNER.tokenIdentifier)
    await expect(owner.mutation(ctx => requireAdaptiveMutationAccess(ctx))).resolves.toBe(OWNER.tokenIdentifier)
    await expect(owner.mutation(ctx => requireAdaptiveJobAdmission(ctx))).resolves.toBe(OWNER.tokenIdentifier)
    await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: false })
    await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'denied' })
    await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
    process.env.LEARN_V2_ENABLED = 'false'
    await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'denied' })
    expect(await t.run(ctx => ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', OWNER.tokenIdentifier)).unique())).toMatchObject({ learnAdaptiveExperienceEntitlement: { enabled: true } })
  })

  test('keeps provider actions explicitly deferred and maintenance export outside the rollout gate', async () => {
    const { t, owner } = await setup()
    expect(ADAPTIVE_PROVIDER_ACTIONS).toBe('deferred_pending_manifest_and_activation')
    const threadId = await t.run(ctx => ctx.db.insert('learningThreads', { userId: OWNER.tokenIdentifier, originalNeed: 'Export during rollback', intent: 'understand', availableTime: '15', authorityKind: 'standalone', sourceScope: { kind: 'none' }, evidenceState: 'none', lifecycle: 'ready', revision: 1, createdAt: 1, updatedAt: 1 }))
    process.env.LEARN_V2_ENABLED = 'false'
    await expect(owner.query(api.dataExport.getUserDataPage, { collection: 'learningThreads', paginationOpts: { cursor: null, numItems: 8 } })).resolves.toMatchObject({ page: [{ _id: threadId }] })
  })

  test('derives the entitlement owner from auth and denies anonymous or tombstoned changes', async () => {
    const { t, owner } = await setup()
    await expect(t.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })).rejects.toThrow(/denied/)
    await expect(owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true, tokenIdentifier: 'forged' } as never)).rejects.toThrow()
    await t.run(ctx => ctx.db.insert('accountDeletionJobs', { userId: OWNER.tokenIdentifier, status: 'active', phase: 'documents', startedAt: 1, updatedAt: 1 }))
    await expect(owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: false })).rejects.toThrow(/denied/)
    await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'denied' })
    await expect(owner.query(ctx => requireAdaptiveQueryAccess(ctx))).rejects.toThrow(/denied/)
    await expect(owner.mutation(ctx => requireAdaptiveMutationAccess(ctx))).rejects.toThrow(/denied/)
    await expect(owner.mutation(ctx => requireAdaptiveJobAdmission(ctx))).rejects.toThrow(/denied/)
  })
})
