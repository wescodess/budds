/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import {
  requireLearnV2MutationAccess,
  requireLearnV2QueryAccess,
} from './lib/learnV2Access'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const originalFlag = process.env.LEARN_V2_ENABLED

const OWNER = {
  tokenIdentifier: 'https://auth.example.com|learn-v2-owner',
  subject: 'learn-v2-owner',
  issuer: 'https://auth.example.com',
  name: 'V2 Owner',
}
const OTHER = {
  tokenIdentifier: 'https://auth.example.com|learn-v2-other',
  subject: 'learn-v2-other',
  issuer: 'https://auth.example.com',
  name: 'Other User',
}

beforeEach(() => {
  delete process.env.LEARN_V2_ENABLED
})

afterAll(() => {
  if (originalFlag === undefined) delete process.env.LEARN_V2_ENABLED
  else process.env.LEARN_V2_ENABLED = originalFlag
})

async function createUser(t: ReturnType<typeof convexTest>, identity = OWNER) {
  await t.withIdentity(identity).mutation(api.users.upsertUser, {})
}

async function setEntitlement(
  t: ReturnType<typeof convexTest>,
  tokenIdentifier: string,
  enabled: boolean,
) {
  return await t.mutation(internal.learnV2Access.setCohortEntitlement, {
    tokenIdentifier,
    enabled,
  })
}

const DENIED_CAPABILITIES = {
  entry: false,
  read: false,
  write: false,
  jobAdmission: false,
} as const

const ALLOWED_CAPABILITIES = {
  entry: true,
  read: true,
  write: true,
  jobAdmission: true,
} as const

async function addDeletionTombstone(
  t: ReturnType<typeof convexTest>,
  status: 'active' | 'complete',
) {
  await t.run(async (ctx) => {
    const now = Date.now()
    await ctx.db.insert('accountDeletionJobs', {
      userId: OWNER.tokenIdentifier,
      status,
      phase: status === 'active' ? 'documents' : 'complete',
      startedAt: now,
      updatedAt: now,
      ...(status === 'complete' ? { completedAt: now } : {}),
    })
  })
}

describe('Learn Anything V2 access and rollback gate', () => {
  test.each([undefined, '', 'false', 'TRUE', ' true ', '1'])(
    'fails closed unless LEARN_V2_ENABLED is exactly true (%s)',
    async (flag) => {
      if (flag === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = flag

      const t = convexTest(schema, modules)
      await createUser(t)
      await setEntitlement(t, OWNER.tokenIdentifier, true)

      await expect(t.withIdentity(OWNER).query(api.learnV2Access.status, {})).resolves.toEqual({
        kind: 'denied',
        capabilities: DENIED_CAPABILITIES,
      })
    },
  )

  test.each([undefined, 'false', 'true'])(
    'returns the same generic denial to unauthenticated callers for rollout state %s',
    async (flag) => {
      if (flag === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = flag
      const t = convexTest(schema, modules)

      await expect(t.query(api.learnV2Access.status, {})).resolves.toEqual({
        kind: 'denied',
        capabilities: DENIED_CAPABILITIES,
      })
    },
  )

  test('does not accept identity arguments on the public status query', async () => {
    process.env.LEARN_V2_ENABLED = 'true'
    const t = convexTest(schema, modules)

    await expect(t.withIdentity(OWNER).query(
      api.learnV2Access.status,
      { tokenIdentifier: OTHER.tokenIdentifier } as never,
    )).rejects.toThrow()
  })

  test('denies missing users, missing entitlement, and disabled entitlement', async () => {
    process.env.LEARN_V2_ENABLED = 'true'
    const t = convexTest(schema, modules)

    await expect(t.withIdentity(OWNER).query(api.learnV2Access.status, {})).resolves.toEqual({
      kind: 'denied',
      capabilities: DENIED_CAPABILITIES,
    })

    await createUser(t)
    await expect(t.withIdentity(OWNER).query(api.learnV2Access.status, {})).resolves.toEqual({
      kind: 'denied',
      capabilities: DENIED_CAPABILITIES,
    })

    await setEntitlement(t, OWNER.tokenIdentifier, false)
    await expect(t.withIdentity(OWNER).query(api.learnV2Access.status, {})).resolves.toEqual({
      kind: 'denied',
      capabilities: DENIED_CAPABILITIES,
    })
  })

  test('changes entitlements only for an existing user and records the server update time', async () => {
    const t = convexTest(schema, modules)
    await expect(setEntitlement(t, OWNER.tokenIdentifier, true))
      .rejects.toThrow('Learn V2 entitlement user not found')

    await createUser(t)
    const before = Date.now()
    const entitlement = await setEntitlement(t, OWNER.tokenIdentifier, true)
    expect(entitlement).toMatchObject({ enabled: true })
    expect(entitlement.updatedAt).toBeGreaterThanOrEqual(before)

    const storedEntitlement = await t.run(async ctx => (await ctx.db
      .query('users')
      .withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', OWNER.tokenIdentifier))
      .unique())?.learnV2Entitlement)
    expect(storedEntitlement).toEqual(entitlement)
  })

  test('admits every normal surface for an enabled cohort user', async () => {
    process.env.LEARN_V2_ENABLED = 'true'
    const t = convexTest(schema, modules)
    await createUser(t)
    await setEntitlement(t, OWNER.tokenIdentifier, true)
    const asOwner = t.withIdentity(OWNER)

    await expect(asOwner.query(api.learnV2Access.status, {})).resolves.toEqual({
      kind: 'allowed',
      capabilities: ALLOWED_CAPABILITIES,
    })
    await expect(asOwner.query(async ctx => await requireLearnV2QueryAccess(ctx)))
      .resolves.toBe(OWNER.tokenIdentifier)
    await expect(asOwner.mutation(async ctx => await requireLearnV2MutationAccess(ctx)))
      .resolves.toBe(OWNER.tokenIdentifier)
  })

  test('isolates entitlement by authenticated tokenIdentifier and revokes immediately', async () => {
    process.env.LEARN_V2_ENABLED = 'true'
    const t = convexTest(schema, modules)
    await createUser(t, OWNER)
    await createUser(t, OTHER)
    await setEntitlement(t, OWNER.tokenIdentifier, true)

    await expect(t.withIdentity(OTHER).query(async ctx => await requireLearnV2QueryAccess(ctx)))
      .rejects.toThrow()

    await setEntitlement(t, OWNER.tokenIdentifier, false)
    await expect(t.withIdentity(OWNER).mutation(async ctx => await requireLearnV2MutationAccess(ctx)))
      .rejects.toThrow()
  })

  test('rollback denies every normal surface, preserves entitlement, and re-enable resumes access', async () => {
    process.env.LEARN_V2_ENABLED = 'true'
    const t = convexTest(schema, modules)
    await createUser(t)
    await setEntitlement(t, OWNER.tokenIdentifier, true)
    const asOwner = t.withIdentity(OWNER)

    await expect(asOwner.query(async ctx => await requireLearnV2QueryAccess(ctx)))
      .resolves.toBe(OWNER.tokenIdentifier)

    process.env.LEARN_V2_ENABLED = 'false'
    await expect(asOwner.query(async ctx => await requireLearnV2QueryAccess(ctx)))
      .rejects.toThrow()
    await expect(asOwner.mutation(async ctx => await requireLearnV2MutationAccess(ctx)))
      .rejects.toThrow()

    process.env.LEARN_V2_ENABLED = 'true'
    await expect(asOwner.query(api.learnV2Access.status, {})).resolves.toEqual({
      kind: 'allowed',
      capabilities: ALLOWED_CAPABILITIES,
    })
  })

  test.each(['active', 'complete'] as const)(
    'denies %s account-deletion tombstones across every normal access seam',
    async (tombstoneStatus) => {
      process.env.LEARN_V2_ENABLED = 'true'
      const t = convexTest(schema, modules)
      await createUser(t)
      await setEntitlement(t, OWNER.tokenIdentifier, true)
      await addDeletionTombstone(t, tombstoneStatus)
      const asOwner = t.withIdentity(OWNER)

      await expect(asOwner.query(api.learnV2Access.status, {})).resolves.toEqual({
        kind: 'denied',
        capabilities: DENIED_CAPABILITIES,
      })
      await expect(asOwner.query(async ctx => await requireLearnV2QueryAccess(ctx))).rejects.toThrow()
      await expect(asOwner.mutation(async ctx => await requireLearnV2MutationAccess(ctx))).rejects.toThrow()
      await expect(setEntitlement(t, OWNER.tokenIdentifier, false)).rejects.toThrow()
    },
  )

  test('rollback does not gate export or account deletion maintenance paths', async () => {
    process.env.LEARN_V2_ENABLED = 'false'
    const t = convexTest(schema, modules)
    await createUser(t)
    await setEntitlement(t, OWNER.tokenIdentifier, true)

    await expect(t.withIdentity(OWNER).query(api.dataExport.getExportMetadata, {})).resolves.toMatchObject({
      userId: OWNER.tokenIdentifier,
    })
    await expect(t.withIdentity(OWNER).mutation(internal.accountDeletion.deleteCurrentUser, {})).resolves.toEqual({
      scheduled: true,
      existing: false,
    })
  })
})
