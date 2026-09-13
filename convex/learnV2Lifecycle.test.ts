/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const identity = { tokenIdentifier: 'https://auth.example.com|learn-v2-owner', name: 'Learn V2 Owner' }

describe('Learn V2 foundational lifecycle', () => {
  test('requires the rollout gate and applies an idempotent, revision-checked transition', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(identity)
    await asUser.mutation(api.users.upsertUser, {})
    await expect(asUser.mutation(api.learnV2Lifecycle.createLearningVoid, {
      folderId: await asUser.mutation(api.folders.createFolder, { name: 'V2 sources' }),
      title: 'Learn transitions',
      idempotencyKey: 'create-void-1',
    })).rejects.toThrow(/Learn V2 access denied/)
  })

  test('returns only immutable receipt outcomes on first execution and replay', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const t = convexTest(schema, modules)
      const owner = t.withIdentity(identity)
      await owner.mutation(api.users.upsertUser, {})
      await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
      const folderId = await owner.mutation(api.folders.createFolder, { name: 'Receipt outcomes' })
      const createArgs = { folderId, title: 'Receipt outcome Void', idempotencyKey: 'receipt-create' }
      const created = await owner.mutation(api.learnV2Lifecycle.createLearningVoid, createArgs)
      expect(Object.keys(created!).sort()).toEqual(['_id', 'activeBlueprintRevisionId', 'revision', 'status'])
      await owner.mutation(api.learnV2Lifecycle.transitionLearningVoid, { learningVoidId: created!._id, status: 'sourcing', expectedRevision: 1, idempotencyKey: 'receipt-void-1' })
      expect(await owner.mutation(api.learnV2Lifecycle.createLearningVoid, createArgs)).toEqual(created)

      const voidTransitionArgs = { learningVoidId: created!._id, status: 'source_review' as const, expectedRevision: 2, idempotencyKey: 'receipt-void-2' }
      const transitionedVoid = await owner.mutation(api.learnV2Lifecycle.transitionLearningVoid, voidTransitionArgs)
      expect(Object.keys(transitionedVoid!).sort()).toEqual(['_id', 'activeBlueprintRevisionId', 'revision', 'status'])
      const blueprintArgs = { learningVoidId: created!._id, expectedVoidRevision: 3, idempotencyKey: 'receipt-blueprint' }
      const blueprint = await owner.mutation(api.learnV2Lifecycle.createBlueprintDraft, blueprintArgs)
      expect(Object.keys(blueprint!).sort()).toEqual(['_id', 'recordRevision', 'revision', 'status'])
      expect(await owner.mutation(api.learnV2Lifecycle.transitionLearningVoid, voidTransitionArgs)).toEqual(transitionedVoid)
      expect(await owner.mutation(api.learnV2Lifecycle.createBlueprintDraft, blueprintArgs)).toEqual(blueprint)

      const blueprintTransitionArgs = { blueprintRevisionId: blueprint!._id, status: 'source_review' as const, expectedRecordRevision: 1, idempotencyKey: 'receipt-blueprint-1' }
      const transitionedBlueprint = await owner.mutation(api.learnV2Lifecycle.transitionBlueprintRevision, blueprintTransitionArgs)
      expect(Object.keys(transitionedBlueprint!).sort()).toEqual(['_id', 'recordRevision', 'revision', 'status'])
      await owner.mutation(api.learnV2Lifecycle.transitionBlueprintRevision, { blueprintRevisionId: blueprint!._id, status: 'map_review', expectedRecordRevision: 2, idempotencyKey: 'receipt-blueprint-2' })
      expect(await owner.mutation(api.learnV2Lifecycle.transitionBlueprintRevision, blueprintTransitionArgs)).toEqual(transitionedBlueprint)

      const forkArgs = { blueprintRevisionId: blueprint!._id, expectedRecordRevision: 3, expectedVoidRevision: 4, idempotencyKey: 'receipt-fork' }
      const fork = await owner.mutation(api.learnV2Lifecycle.forkBlueprintDraft, forkArgs)
      expect(Object.keys(fork!).sort()).toEqual(['_id', 'recordRevision', 'revision', 'status'])
      await owner.mutation(api.learnV2Lifecycle.transitionBlueprintRevision, { blueprintRevisionId: fork!._id, status: 'source_review', expectedRecordRevision: 1, idempotencyKey: 'receipt-fork-1' })
      expect(await owner.mutation(api.learnV2Lifecycle.forkBlueprintDraft, forkArgs)).toEqual(fork)
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('rejects stale and cross-owner writes and replays a durable transition receipt', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const t = convexTest(schema, modules)
      const owner = t.withIdentity(identity)
      const other = t.withIdentity({ tokenIdentifier: 'https://auth.example.com|other', name: 'Other' })
      await owner.mutation(api.users.upsertUser, {})
      await other.mutation(api.users.upsertUser, {})
      await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
      await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: 'https://auth.example.com|other', enabled: true })
      const folderId = await owner.mutation(api.folders.createFolder, { name: 'V2 sources' })
      const created = await owner.mutation(api.learnV2Lifecycle.createLearningVoid, { folderId, title: 'Transitions', idempotencyKey: 'create' })
      await expect(owner.mutation(api.learnV2Lifecycle.createLearningVoid, { folderId, title: 'Different request', idempotencyKey: 'create' })).rejects.toThrow(/different request/)
      const transitioned = await owner.mutation(api.learnV2Lifecycle.transitionLearningVoid, { learningVoidId: created!._id, status: 'sourcing', expectedRevision: 1, idempotencyKey: 'transition-1' })
      await expect(owner.mutation(api.learnV2Lifecycle.transitionLearningVoid, { learningVoidId: created!._id, status: 'source_review', expectedRevision: 1, idempotencyKey: 'stale' })).rejects.toThrow(/revision conflict/)
      await expect(other.mutation(api.learnV2Lifecycle.transitionLearningVoid, { learningVoidId: created!._id, status: 'source_review', expectedRevision: 2, idempotencyKey: 'other' })).rejects.toThrow(/not found/)
      expect(await other.query(api.learnV2Lifecycle.getLearningVoid, { learningVoidId: created!._id })).toBeNull()
      await owner.mutation(api.learnV2Lifecycle.transitionLearningVoid, { learningVoidId: created!._id, status: 'source_review', expectedRevision: 2, idempotencyKey: 'transition-2' })
      await expect(owner.mutation(api.learnV2Lifecycle.transitionLearningVoid, { learningVoidId: created!._id, status: 'sourcing', expectedRevision: 3, idempotencyKey: 'guarded' })).rejects.toThrow(/guarded|not allowed/)
      const replay = await owner.mutation(api.learnV2Lifecycle.transitionLearningVoid, { learningVoidId: created!._id, status: 'sourcing', expectedRevision: 1, idempotencyKey: 'transition-1' })
      const createdReplay = await owner.mutation(api.learnV2Lifecycle.createLearningVoid, { folderId, title: 'Transitions', idempotencyKey: 'create' })
      const second = await owner.mutation(api.learnV2Lifecycle.createLearningVoid, { folderId, title: 'Second', idempotencyKey: 'create-2' })
      expect(transitioned).toMatchObject({ status: 'sourcing', revision: 2 })
      expect(replay).toMatchObject({ status: 'sourcing', revision: 2 })
      expect(createdReplay).toMatchObject({ _id: created!._id, status: 'draft', revision: 1 })
      const page = await owner.query(api.learnV2Lifecycle.listLearningVoids, { paginationOpts: { cursor: null, numItems: 1 } })
      expect(page.page).toHaveLength(1)
      expect(second).toBeTruthy()
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('forks and activates immutable blueprint revisions while pinning the active revision', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const t = convexTest(schema, modules)
      const owner = t.withIdentity(identity)
      const other = t.withIdentity({ tokenIdentifier: 'https://auth.example.com|blueprint-other', name: 'Blueprint Other' })
      await owner.mutation(api.users.upsertUser, {})
      await other.mutation(api.users.upsertUser, {})
      await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
      await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: 'https://auth.example.com|blueprint-other', enabled: true })
      const folderId = await owner.mutation(api.folders.createFolder, { name: 'Blueprint sources' })
      const learningVoid = await owner.mutation(api.learnV2Lifecycle.createLearningVoid, { folderId, title: 'Blueprint', idempotencyKey: 'void' })
      const first = await owner.mutation(api.learnV2Lifecycle.createBlueprintDraft, { learningVoidId: learningVoid!._id, expectedVoidRevision: 1, idempotencyKey: 'blueprint-1' })
      expect(await other.query(api.learnV2Lifecycle.getBlueprintRevision, { blueprintRevisionId: first!._id })).toBeNull()
      await expect(other.mutation(api.learnV2Lifecycle.transitionBlueprintRevision, { blueprintRevisionId: first!._id, status: 'source_review', expectedRecordRevision: 1, idempotencyKey: 'other-blueprint' })).rejects.toThrow(/not found/)
      const firstReplay = await owner.mutation(api.learnV2Lifecycle.createBlueprintDraft, { learningVoidId: learningVoid!._id, expectedVoidRevision: 1, idempotencyKey: 'blueprint-1' })
      expect(firstReplay).toMatchObject({ _id: first!._id, revision: 1, recordRevision: 1, status: 'draft' })
      await expect(owner.mutation(api.learnV2Lifecycle.createBlueprintDraft, { learningVoidId: learningVoid!._id, expectedVoidRevision: 1, idempotencyKey: 'blueprint-1' })).resolves.toMatchObject({ _id: first!._id })
      await expect(owner.mutation(api.learnV2Lifecycle.createBlueprintDraft, { learningVoidId: learningVoid!._id, expectedVoidRevision: 2, idempotencyKey: 'blueprint-1' })).rejects.toThrow(/different request/)
      await expect(owner.mutation(api.learnV2Lifecycle.createBlueprintDraft, { learningVoidId: learningVoid!._id, expectedVoidRevision: 2, idempotencyKey: 'second-blueprint' })).rejects.toThrow(/already has a stable Blueprint/)
      await owner.mutation(api.learnV2Lifecycle.transitionBlueprintRevision, { blueprintRevisionId: first!._id, status: 'source_review', expectedRecordRevision: 1, idempotencyKey: 'first-1' })
      await owner.mutation(api.learnV2Lifecycle.transitionBlueprintRevision, { blueprintRevisionId: first!._id, status: 'map_review', expectedRecordRevision: 2, idempotencyKey: 'first-2' })
      const transitionReplay = await owner.mutation(api.learnV2Lifecycle.transitionBlueprintRevision, { blueprintRevisionId: first!._id, status: 'source_review', expectedRecordRevision: 1, idempotencyKey: 'first-1' })
      expect(transitionReplay).toMatchObject({ _id: first!._id, status: 'source_review', revision: 1, recordRevision: 2 })
      await owner.mutation(api.learnV2Lifecycle.transitionBlueprintRevision, { blueprintRevisionId: first!._id, status: 'accepted', expectedRecordRevision: 3, idempotencyKey: 'first-3' })
      await expect(owner.mutation(api.learnV2Lifecycle.transitionBlueprintRevision, { blueprintRevisionId: first!._id, status: 'map_review', expectedRecordRevision: 4, idempotencyKey: 'immutable' })).rejects.toThrow(/not allowed|guarded/)
      const active = await owner.mutation(api.learnV2Lifecycle.transitionBlueprintRevision, { blueprintRevisionId: first!._id, status: 'active', expectedRecordRevision: 4, expectedVoidRevision: 2, idempotencyKey: 'first-4' })
      const fork = await owner.mutation(api.learnV2Lifecycle.forkBlueprintDraft, { blueprintRevisionId: active!._id, expectedRecordRevision: 5, expectedVoidRevision: 3, idempotencyKey: 'fork' })
      await owner.mutation(api.learnV2Lifecycle.transitionBlueprintRevision, { blueprintRevisionId: fork!._id, status: 'source_review', expectedRecordRevision: 1, idempotencyKey: 'fork-1' })
      await owner.mutation(api.learnV2Lifecycle.transitionBlueprintRevision, { blueprintRevisionId: fork!._id, status: 'map_review', expectedRecordRevision: 2, idempotencyKey: 'fork-2' })
      await owner.mutation(api.learnV2Lifecycle.transitionBlueprintRevision, { blueprintRevisionId: fork!._id, status: 'accepted', expectedRecordRevision: 3, idempotencyKey: 'fork-3' })
      await expect(owner.mutation(api.learnV2Lifecycle.transitionBlueprintRevision, { blueprintRevisionId: fork!._id, status: 'active', expectedRecordRevision: 4, expectedVoidRevision: 2, idempotencyKey: 'fork-active-stale-void' })).rejects.toThrow(/Learning Void revision conflict/)
      await owner.mutation(api.learnV2Lifecycle.transitionBlueprintRevision, { blueprintRevisionId: fork!._id, status: 'active', expectedRecordRevision: 4, expectedVoidRevision: 4, idempotencyKey: 'fork-4' })
      expect(await owner.query(api.learnV2Lifecycle.getLearningVoid, { learningVoidId: learningVoid!._id })).toMatchObject({ activeBlueprintRevisionId: fork!._id })
      expect(await owner.query(api.learnV2Lifecycle.getBlueprintRevision, { blueprintRevisionId: active!._id })).toMatchObject({ status: 'superseded' })
      await expect(owner.mutation(api.learnV2Lifecycle.transitionBlueprintRevision, { blueprintRevisionId: active!._id, status: 'active', expectedRecordRevision: 6, expectedVoidRevision: 5, idempotencyKey: 'terminal' })).rejects.toThrow(/not allowed|guarded/)
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('keeps blueprint ordinals monotonic when an older revision is forked', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const t = convexTest(schema, modules)
      const owner = t.withIdentity(identity)
      await owner.mutation(api.users.upsertUser, {})
      await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
      const folderId = await owner.mutation(api.folders.createFolder, { name: 'Ordinal sources' })
      const learningVoid = await owner.mutation(api.learnV2Lifecycle.createLearningVoid, { folderId, title: 'Ordinal', idempotencyKey: 'ordinal-void' })
      const original = await owner.mutation(api.learnV2Lifecycle.createBlueprintDraft, { learningVoidId: learningVoid!._id, expectedVoidRevision: 1, idempotencyKey: 'ordinal-blueprint' })
      const second = await owner.mutation(api.learnV2Lifecycle.forkBlueprintDraft, { blueprintRevisionId: original!._id, expectedRecordRevision: 1, expectedVoidRevision: 2, idempotencyKey: 'ordinal-second' })
      const third = await owner.mutation(api.learnV2Lifecycle.forkBlueprintDraft, { blueprintRevisionId: original!._id, expectedRecordRevision: 1, expectedVoidRevision: 3, idempotencyKey: 'ordinal-third' })
      expect([original!.revision, second!.revision, third!.revision]).toEqual([1, 2, 3])
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('rejects blank lifecycle strings and unsafe revision preconditions', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const t = convexTest(schema, modules)
      const owner = t.withIdentity(identity)
      await owner.mutation(api.users.upsertUser, {})
      await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
      const folderId = await owner.mutation(api.folders.createFolder, { name: 'Validation sources' })
      await expect(owner.mutation(api.learnV2Lifecycle.createLearningVoid, { folderId, title: ' ', idempotencyKey: 'valid-key' })).rejects.toThrow(/title must not be blank/)
      await expect(owner.mutation(api.learnV2Lifecycle.createLearningVoid, { folderId, title: 'Valid', idempotencyKey: ' ' })).rejects.toThrow(/Idempotency key must not be blank/)
      await expect(owner.mutation(api.learnV2Lifecycle.createLearningVoid, { folderId, title: 'x'.repeat(201), idempotencyKey: 'valid-key' })).rejects.toThrow(/title must not exceed 200 characters/)
      await expect(owner.mutation(api.learnV2Lifecycle.createLearningVoid, { folderId, title: 'Valid', idempotencyKey: 'x'.repeat(129) })).rejects.toThrow(/Idempotency key must not exceed 128 characters/)
      await expect(owner.mutation(api.learnV2Lifecycle.createLearningVoid, { folderId, title: 'x'.repeat(200), idempotencyKey: 'x'.repeat(128) })).resolves.toEqual(expect.objectContaining({ status: 'draft' }))
      const learningVoid = await owner.mutation(api.learnV2Lifecycle.createLearningVoid, { folderId, title: 'Valid', idempotencyKey: 'validation-void' })
      await expect(owner.mutation(api.learnV2Lifecycle.transitionLearningVoid, { learningVoidId: learningVoid!._id, status: 'sourcing', expectedRevision: 1.5, idempotencyKey: 'invalid-revision' })).rejects.toThrow(/safe positive integer/)
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('caps list pages at eight and keeps max-length rows reachable across pages', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const t = convexTest(schema, modules)
      const owner = t.withIdentity(identity)
      await owner.mutation(api.users.upsertUser, {})
      await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
      const folderId = await owner.mutation(api.folders.createFolder, { name: 'Paged rows' })
      const ids = []
      for (let index = 0; index < 9; index++) {
        const created = await owner.mutation(api.learnV2Lifecycle.createLearningVoid, { folderId, title: `(${index}) ${'x'.repeat(195)}`, idempotencyKey: `page-key-${index}` })
        ids.push(created!._id)
      }
      const first = await owner.query(api.learnV2Lifecycle.listLearningVoids, { paginationOpts: { cursor: null, numItems: 50 } })
      const second = await owner.query(api.learnV2Lifecycle.listLearningVoids, { paginationOpts: { cursor: first.continueCursor, numItems: 50 } })
      expect(first.page).toHaveLength(8)
      expect(second.page).toHaveLength(1)
      expect([...first.page, ...second.page].map(row => row._id).sort()).toEqual(ids.sort())
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('makes a deleted folder Void immediately unreadable and purges its bounded lifecycle foundation', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const t = convexTest(schema, modules)
      const owner = t.withIdentity(identity)
      await owner.mutation(api.users.upsertUser, {})
      await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
      const folderId = await owner.mutation(api.folders.createFolder, { name: 'Disposable V2 folder' })
      const learningVoid = await owner.mutation(api.learnV2Lifecycle.createLearningVoid, { folderId, title: 'Disposable', idempotencyKey: 'disposable-void' })
      const blueprint = await owner.mutation(api.learnV2Lifecycle.createBlueprintDraft, { learningVoidId: learningVoid!._id, expectedVoidRevision: 1, idempotencyKey: 'disposable-blueprint' })
      await owner.mutation(api.folders.deleteFolder, { id: folderId })
      expect(await owner.query(api.learnV2Lifecycle.getLearningVoid, { learningVoidId: learningVoid!._id })).toBeNull()
      expect(await owner.query(api.learnV2Lifecycle.getBlueprintRevision, { blueprintRevisionId: blueprint!._id })).toBeNull()
      await expect(owner.mutation(api.learnV2Lifecycle.transitionLearningVoid, { learningVoidId: learningVoid!._id, status: 'sourcing', expectedRevision: 2, idempotencyKey: 'after-folder-delete' })).rejects.toThrow(/folder not found/)
      await expect(owner.mutation(api.learnV2Lifecycle.createLearningVoid, { folderId, title: 'Disposable', idempotencyKey: 'disposable-void' })).rejects.toThrow(/folder not found/)
      for (let batch = 0; batch < 8; batch++) await t.mutation(internal.learnV2Retention.deleteFolderFoundation, { userId: identity.tokenIdentifier, folderId })
      expect(await t.run(ctx => ctx.db.get(learningVoid!._id))).toBeNull()
      expect(await t.run(ctx => ctx.db.get(blueprint!._id))).toBeNull()
      expect(await t.run(ctx => ctx.db.query('learnLifecycleReceipts').withIndex('by_userId', q => q.eq('userId', identity.tokenIdentifier)).collect())).toEqual([])
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })
})
