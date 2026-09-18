/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const owner = { tokenIdentifier: 'https://auth.example.com|journey-owner', name: 'Journey Owner' }
const other = { tokenIdentifier: 'https://auth.example.com|journey-other', name: 'Journey Other' }

const previousGate = process.env.LEARN_V2_ENABLED
afterEach(() => {
  if (previousGate === undefined) delete process.env.LEARN_V2_ENABLED
  else process.env.LEARN_V2_ENABLED = previousGate
})

async function setup() {
  process.env.LEARN_V2_ENABLED = 'true'
  const t = convexTest(schema, modules)
  const asOwner = t.withIdentity(owner)
  await asOwner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: owner.tokenIdentifier, enabled: true })
  const folderId = await asOwner.mutation(api.folders.createFolder, { name: 'Journey folder' })
  const learningVoid = await asOwner.mutation(api.learnV2Lifecycle.createLearningVoid, { folderId, title: 'Journey mission', idempotencyKey: 'journey-create' })
  return { t, asOwner, folderId, learningVoid }
}

describe('Learn V2 public journey read model', () => {
  test('returns bounded hub and current mission projections for the owner', async () => {
    const setupResult = await setup()
    await expect(setupResult.asOwner.query(api.learnV2Journey.listHub, {})).resolves.toMatchObject({ items: [{ _id: setupResult.learningVoid._id, title: 'Journey mission', status: 'draft', nextAction: 'source_selection' }] })
    const mission = await setupResult.asOwner.query(api.learnV2Journey.getMission, { learningVoidId: setupResult.learningVoid._id })
    expect(mission).toMatchObject({ learningVoid: { _id: setupResult.learningVoid._id, title: 'Journey mission' }, nextAction: 'source_selection', sources: { counts: { total: 0 } }, map: null, plan: { root: null }, calibration: { attempts: [], completed: false } })
    expect(await setupResult.asOwner.query(api.learnV2Journey.getCurrentMission, {})).toMatchObject({ learningVoid: { _id: setupResult.learningVoid._id } })
  })

  test('does not disclose another owner’s mission and requires entitlement', async () => {
    const setupResult = await setup()
    const unauthenticated = setupResult.t
    await expect(unauthenticated.query(api.learnV2Journey.getMission, { learningVoidId: setupResult.learningVoid._id })).rejects.toThrow(/access denied|authenticated/)
    const asOther = setupResult.t.withIdentity(other)
    await asOther.mutation(api.users.upsertUser, {})
    await setupResult.t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: other.tokenIdentifier, enabled: true })
    expect(await asOther.query(api.learnV2Journey.getMission, { learningVoidId: setupResult.learningVoid._id })).toBeNull()
    await expect(asOther.query(api.learnV2Journey.listHub, {})).resolves.toEqual({ items: [] })
  })
})
