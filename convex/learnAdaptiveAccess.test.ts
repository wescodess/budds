/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
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
  test('is default-deny and conjunctive with V2 plus adaptive entitlement', async () => {
    const { t, owner } = await setup()
    await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'denied' })
    await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
    await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'allowed' })
    process.env.LEARN_V2_ENABLED = 'false'
    await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'denied' })
    expect(await t.run(ctx => ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', OWNER.tokenIdentifier)).unique())).toMatchObject({ learnAdaptiveExperienceEntitlement: { enabled: true } })
  })

  test('derives the entitlement owner from auth and denies anonymous or tombstoned changes', async () => {
    const { t, owner } = await setup()
    await expect(t.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })).rejects.toThrow(/denied/)
    await expect(owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true, tokenIdentifier: 'forged' } as never)).rejects.toThrow()
    await t.run(ctx => ctx.db.insert('accountDeletionJobs', { userId: OWNER.tokenIdentifier, status: 'active', phase: 'documents', startedAt: 1, updatedAt: 1 }))
    await expect(owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: false })).rejects.toThrow(/denied/)
    await expect(owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).resolves.toMatchObject({ kind: 'denied' })
  })
})
