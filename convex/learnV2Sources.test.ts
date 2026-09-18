/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { orchestrateSourceFetch } from './learnV2SourceActions'
import { LEARN_V2_FETCH_ADMISSION_POLICY } from './learnV2Sources'
import { SafeFetchError, classifyRetentionRights } from '../server/utils/learn-v2-safe-fetch'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const identity = { tokenIdentifier: 'https://auth.example.com|source-owner', name: 'Source Owner' }

async function setup() {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(identity)
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
  const folderId = await owner.mutation(api.folders.createFolder, { name: 'Source lifecycle' })
  const learningVoidId = await t.run(ctx => ctx.db.insert('learningVoids', {
    userId: identity.tokenIdentifier,
    folderId,
    title: 'Sources',
    status: 'draft',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  }))
  const blueprintRevisionId = await t.run(async (ctx) => {
    const blueprintId = await ctx.db.insert('learnBlueprints', {
      userId: identity.tokenIdentifier,
      learningVoidId,
      revision: 1,
      createdAt: 1,
    })
    return await ctx.db.insert('learnBlueprintRevisions', {
      userId: identity.tokenIdentifier,
      blueprintId,
      learningVoidId,
      revision: 1,
      recordRevision: 1,
      status: 'draft',
      createdAt: 1,
      updatedAt: 1,
    })
  })
  return { t, owner, learningVoidId, blueprintRevisionId }
}

async function register(setupResult: Awaited<ReturnType<typeof setup>>, key: string, url = `https://example.com/${key}`) {
  return await setupResult.owner.mutation(api.learnV2Sources.registerCandidate, {
    learningVoidId: setupResult.learningVoidId,
    blueprintRevisionId: setupResult.blueprintRevisionId,
    url,
    expectedVoidRevision: 1,
    expectedBlueprintRecordRevision: 1,
    idempotencyKey: `register-${key}`,
  }) as { sourceSnapshotId: Id<'learnSourceSnapshots'> }
}

async function collectSourcesByStatus(
  setupResult: Awaited<ReturnType<typeof setup>>,
  status: 'candidate' | 'fetched' | 'evaluated' | 'user_accepted' | 'rejected' | 'unavailable',
  numItems = 16,
) {
  const rows: Array<{ _id: Id<'learnSourceSnapshots'>, status: string, effectiveStatus: string }> = []
  const cursors = new Set<string>()
  let cursor: string | null = null
  for (let pageNumber = 0; pageNumber < 128; pageNumber += 1) {
    const result: {
      page: Array<{ _id: Id<'learnSourceSnapshots'>, status: string, effectiveStatus: string }>
      isDone: boolean
      continueCursor: string
    } = await setupResult.owner.query(api.learnV2Sources.listSources, {
      learningVoidId: setupResult.learningVoidId,
      status,
      paginationOpts: { cursor, numItems },
    })
    rows.push(...result.page)
    if (result.isDone) return { rows, cursors: [...cursors] }
    expect(result.continueCursor).not.toBe(cursor)
    expect(cursors.has(result.continueCursor)).toBe(false)
    cursors.add(result.continueCursor)
    cursor = result.continueCursor
  }
  throw new Error('Source pagination did not terminate')
}

describe('Learn V2 source lifecycle', () => {
  test('rejects direct web candidates when the blueprint is folder only', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const setupResult = await setup()
      await setupResult.t.run(async ctx => ctx.db.patch(setupResult.blueprintRevisionId, { sourcePolicy: 'folder_only' }))
      await expect(register(setupResult, 'folder-only-web')).rejects.toThrow(/only allows folder sources/)
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('atomically acquires a lease, denies a sibling race, commits, and replays exactly', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const setupResult = await setup()
      const { t } = setupResult
      const registered = await setupResult.owner.mutation(api.learnV2Sources.registerCandidate, {
        learningVoidId: setupResult.learningVoidId,
        blueprintRevisionId: setupResult.blueprintRevisionId,
        url: 'https://example.com/article?token=private',
        title: 'Article',
        expectedVoidRevision: 1,
        expectedBlueprintRecordRevision: 1,
        idempotencyKey: 'register',
      }) as { sourceSnapshotId: Id<'learnSourceSnapshots'> }
      const admission = await t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: registered.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'fetch',
      })
      expect(admission.kind).toBe('acquired')
      const duplicate = await t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: registered.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'fetch',
      })
      expect(duplicate).toMatchObject({ kind: 'retryable_denial', reason: 'duplicate_in_flight' })
      const racing = await t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: registered.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'fetch-race',
      })
      expect(racing).toMatchObject({ kind: 'retryable_denial', reason: 'snapshot_in_flight' })
      if (admission.kind !== 'acquired') throw new Error('Expected lease')
      const committed = await t.mutation(internal.learnV2Sources.commitFetchResult, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: registered.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'fetch',
        leaseId: admission.leaseId,
        leaseToken: admission.leaseToken,
        requestFingerprint: admission.requestFingerprint,
        result: {
          kind: 'success',
          finalUrl: 'https://example.com/final?secret=value',
          publicLocator: 'https://evil.example/capability-token',
          contentHash: 'a'.repeat(64),
          contentType: 'text/html',
          wireBytes: 10,
          decodedBytes: 10,
          excerpt: 'inert source instructions',
          trustClassification: 'untrusted_source_data',
          rightsStatus: 'permitted',
          rightsProvenance: 'link_license',
          rightsPolicyVersion: 'learn-v2.rights.v2',
          fetchPolicyVersion: 'learn-v2.fetch.v2',
        },
      })
      expect(committed).toMatchObject({ status: 'fetched', recordRevision: 2 })
      const replay = await t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: registered.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'fetch',
      })
      expect(replay).toEqual({ kind: 'replayed', response: committed })
      await expect(t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: registered.sourceSnapshotId,
        expectedRevision: 2,
        idempotencyKey: 'fetch',
      })).rejects.toThrow(/Idempotency key reuse/)
      await expect(setupResult.owner.mutation(api.learnV2Sources.registerCandidate, {
        learningVoidId: setupResult.learningVoidId,
        blueprintRevisionId: setupResult.blueprintRevisionId,
        url: 'https://example.com/different',
        expectedVoidRevision: 1,
        expectedBlueprintRecordRevision: 1,
        idempotencyKey: 'register',
      })).rejects.toThrow(/Idempotency key reuse/)
      const excerpt = await t.run(async ctx => (await ctx.db.query('learnSourceExcerpts')
        .withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', identity.tokenIdentifier).eq('sourceSnapshotId', registered.sourceSnapshotId)).unique()))
      expect(excerpt).toMatchObject({
        locator: 'https://example.com/',
        trustClassification: 'untrusted_source_data',
        excerpt: 'inert source instructions',
      })
      expect(await setupResult.owner.query(api.learnV2Sources.getSource, {
        sourceSnapshotId: registered.sourceSnapshotId,
      })).toMatchObject({ publicLocator: 'https://example.com/' })
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('rejects successfully and replays while status pagination uses effective availability', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const setupResult = await setup()
      const { t, owner, learningVoidId } = setupResult
      const sourceSnapshotId = await t.run(async ctx => {
        const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', {
          userId: identity.tokenIdentifier,
          learningVoidId,
          origin: 'user_url',
          externalKey: 'https://example.com/reject',
          canonicalUrl: 'https://example.com/reject',
        })
        return await ctx.db.insert('learnSourceSnapshots', {
          userId: identity.tokenIdentifier,
          learningVoidId,
          sourceIdentityId,
          blueprintRevisionId: setupResult.blueprintRevisionId,
          revision: 1,
          recordRevision: 3,
          status: 'evaluated',
          effectiveStatus: 'evaluated',
          rightsStatus: 'unknown',
          conflictStatus: 'clear',
          createdAt: 1,
          updatedAt: 1,
        })
      })
      const args = { sourceSnapshotId, expectedRevision: 3, idempotencyKey: 'reject' }
      const rejected = await owner.mutation(api.learnV2Sources.rejectSource, args)
      expect(rejected).toMatchObject({ status: 'rejected', recordRevision: 4 })
      expect(await owner.mutation(api.learnV2Sources.rejectSource, args)).toEqual(rejected)
      await t.run(ctx => ctx.db.patch(sourceSnapshotId, { status: 'user_accepted', effectiveStatus: 'unavailable', unavailableReason: 'access_lost' }))
      const currentUnavailable = await collectSourcesByStatus(setupResult, 'unavailable', 1)
      expect(currentUnavailable.rows).toHaveLength(1)
      expect(currentUnavailable.rows[0]).toMatchObject({ status: 'user_accepted', effectiveStatus: 'unavailable' })

      const legacyIds = await t.run(async (ctx) => {
        const candidateIdentity = await ctx.db.insert('learnSourceIdentities', {
          userId: identity.tokenIdentifier,
          learningVoidId,
          origin: 'user_url',
          externalKey: 'https://example.com/legacy-candidate',
        })
        const purgedIdentity = await ctx.db.insert('learnSourceIdentities', {
          userId: identity.tokenIdentifier,
          learningVoidId,
          origin: 'user_url',
          externalKey: 'https://example.com/legacy-purged',
        })
        const candidate = await ctx.db.insert('learnSourceSnapshots', {
          userId: identity.tokenIdentifier,
          learningVoidId,
          sourceIdentityId: candidateIdentity,
          revision: 1,
          status: 'candidate',
          createdAt: 1,
        })
        const purged = await Promise.all((['candidate', 'fetched', 'evaluated', 'user_accepted', 'rejected', 'unavailable'] as const).map((status, index) => ctx.db.insert('learnSourceSnapshots', {
          userId: identity.tokenIdentifier,
          learningVoidId,
          sourceIdentityId: purgedIdentity,
          revision: index + 1,
          status,
          evidencePurgedAt: index === 0 ? 0 : index + 1,
          createdAt: index + 1,
        })))
        return { candidate, purged }
      })
      const legacyCandidates = await collectSourcesByStatus(setupResult, 'candidate')
      expect(legacyCandidates.rows.map(row => row._id)).toContain(legacyIds.candidate)
      const unavailable = await collectSourcesByStatus(setupResult, 'unavailable')
      const unavailableIds = unavailable.rows.map(row => row._id)
      expect(unavailableIds).toEqual(expect.arrayContaining(legacyIds.purged))
      expect(new Set(unavailableIds).size).toBe(unavailableIds.length)
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('paginates every legacy source beyond the former compatibility cap before current rows', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const setupResult = await setup()
      const { t, learningVoidId } = setupResult
      const inserted = await t.run(async (ctx) => {
        const legacyIdentityId = await ctx.db.insert('learnSourceIdentities', {
          userId: identity.tokenIdentifier,
          learningVoidId,
          origin: 'user_url',
          externalKey: 'https://example.com/legacy-pagination',
        })
        const currentIdentityId = await ctx.db.insert('learnSourceIdentities', {
          userId: identity.tokenIdentifier,
          learningVoidId,
          origin: 'user_url',
          externalKey: 'https://example.com/current-pagination',
        })
        const legacyIds: Array<Id<'learnSourceSnapshots'>> = []
        for (let index = 0; index < 70; index += 1) {
          legacyIds.push(await ctx.db.insert('learnSourceSnapshots', {
            userId: identity.tokenIdentifier,
            learningVoidId,
            sourceIdentityId: legacyIdentityId,
            revision: index + 1,
            status: 'candidate',
            createdAt: index + 1,
          }))
        }
        const currentIds: Array<Id<'learnSourceSnapshots'>> = []
        for (let index = 0; index < 2; index += 1) {
          currentIds.push(await ctx.db.insert('learnSourceSnapshots', {
            userId: identity.tokenIdentifier,
            learningVoidId,
            sourceIdentityId: currentIdentityId,
            revision: index + 1,
            status: 'candidate',
            effectiveStatus: 'candidate',
            createdAt: 100 + index,
          }))
        }
        return { legacyIds, currentIds }
      })

      const result = await collectSourcesByStatus(setupResult, 'candidate', 7)
      const returnedIds = result.rows.map(row => row._id)
      expect(returnedIds).toHaveLength(72)
      expect(new Set(returnedIds).size).toBe(72)
      expect(returnedIds).toEqual([...inserted.legacyIds, ...inserted.currentIds])
      expect(returnedIds).toContain(inserted.legacyIds[64])
      expect(result.cursors.length).toBeGreaterThan(9)

      const firstPage = await setupResult.owner.query(api.learnV2Sources.listSources, {
        learningVoidId,
        status: 'candidate',
        paginationOpts: { cursor: null, numItems: 7 },
      })
      await expect(setupResult.owner.query(api.learnV2Sources.listSources, {
        learningVoidId,
        status: 'unavailable',
        paginationOpts: { cursor: firstPage.continueCursor, numItems: 7 },
      })).rejects.toThrow(/Invalid source cursor/)
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('requires a current owned editable Blueprint revision before candidate registration', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const setupResult = await setup()
      await expect(setupResult.owner.mutation(api.learnV2Sources.registerCandidate, {
        learningVoidId: setupResult.learningVoidId,
        blueprintRevisionId: setupResult.blueprintRevisionId,
        url: 'https://example.com/stale-blueprint',
        expectedVoidRevision: 1,
        expectedBlueprintRecordRevision: 2,
        idempotencyKey: 'stale-blueprint',
      })).rejects.toThrow(/Blueprint revision conflict/)
      expect(await setupResult.t.run(ctx => ctx.db.query('learnSourceIdentities').collect())).toEqual([])
      await setupResult.t.run(ctx => ctx.db.patch(setupResult.blueprintRevisionId, { status: 'map_review' }))
      await expect(setupResult.owner.mutation(api.learnV2Sources.registerCandidate, {
        learningVoidId: setupResult.learningVoidId,
        blueprintRevisionId: setupResult.blueprintRevisionId,
        url: 'https://example.com/immutable-blueprint',
        expectedVoidRevision: 1,
        expectedBlueprintRecordRevision: 1,
        idempotencyKey: 'immutable-blueprint',
      })).rejects.toThrow(/not editable/)
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('fails closed for anonymous, cross-owner, and revoked action access before external I/O', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const setupResult = await setup()
      const registered = await register(setupResult, 'access-boundary')
      const otherIdentity = { tokenIdentifier: 'https://auth.example.com|other-source-owner', name: 'Other owner' }
      const other = setupResult.t.withIdentity(otherIdentity)
      await other.mutation(api.users.upsertUser, {})
      await setupResult.t.mutation(internal.learnV2Access.setCohortEntitlement, {
        tokenIdentifier: otherIdentity.tokenIdentifier,
        enabled: true,
      })
      await expect(other.query(api.learnV2Sources.getSource, {
        sourceSnapshotId: registered.sourceSnapshotId,
      })).rejects.toThrow(/Source not found/)
      await expect(other.mutation(api.learnV2Sources.markUnavailable, {
        sourceSnapshotId: registered.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'cross-owner-delete',
        reason: 'source_deleted',
      })).rejects.toThrow(/Source not found/)

      const anonymousFetcher = vi.fn()
      await expect(orchestrateSourceFetch({
        auth: { getUserIdentity: async () => null },
        runMutation: setupResult.t.mutation,
      } as never, {
        sourceSnapshotId: registered.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'anonymous-fetch',
      }, anonymousFetcher)).rejects.toThrow(/access denied/)
      expect(anonymousFetcher).not.toHaveBeenCalled()

      await setupResult.t.mutation(internal.learnV2Access.setCohortEntitlement, {
        tokenIdentifier: identity.tokenIdentifier,
        enabled: false,
      })
      const revokedFetcher = vi.fn()
      await expect(orchestrateSourceFetch({
        auth: { getUserIdentity: async () => identity },
        runMutation: setupResult.t.mutation,
      } as never, {
        sourceSnapshotId: registered.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'revoked-fetch',
      }, revokedFetcher)).rejects.toThrow(/access denied/)
      expect(revokedFetcher).not.toHaveBeenCalled()
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('enforces owner and multi-owner global concurrency plus rate-window expiry', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const setupResult = await setup()
      const sources = await Promise.all(['capacity-a', 'capacity-b', 'capacity-c'].map(key => register(setupResult, key)))
      for (let index = 0; index < LEARN_V2_FETCH_ADMISSION_POLICY.ownerConcurrencyLimit; index++) {
        expect(await setupResult.t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
          tokenIdentifier: identity.tokenIdentifier,
          sourceSnapshotId: sources[index]!.sourceSnapshotId,
          expectedRevision: 1,
          idempotencyKey: `owner-fetch-${index}`,
        })).toMatchObject({ kind: 'acquired' })
      }
      expect(await setupResult.t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: sources[2]!.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'owner-capacity-denied',
      })).toMatchObject({ kind: 'retryable_denial', reason: 'owner_capacity' })

      await setupResult.t.run(async (ctx) => {
        for (const row of await ctx.db.query('learnSourceFetchLeases').collect()) await ctx.db.delete(row._id)
        for (let index = 0; index < LEARN_V2_FETCH_ADMISSION_POLICY.globalConcurrencyLimit; index++) {
          await ctx.db.insert('learnSourceFetchLeases', {
            userId: `multi-owner-${index % 8}`,
            learningVoidId: setupResult.learningVoidId,
            sourceSnapshotId: sources[0]!.sourceSnapshotId,
            idempotencyKeyHash: `sha256:global-${index}`,
            requestFingerprint: `global-${index}`,
            leaseToken: `token-${index}`,
            expiresAt: Date.now() + 10_000,
            createdAt: Date.now(),
          })
        }
      })
      expect(await setupResult.t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: sources[2]!.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'global-capacity-denied',
      })).toMatchObject({ kind: 'retryable_denial', reason: 'global_capacity' })

      await setupResult.t.run(async (ctx) => {
        for (const row of await ctx.db.query('learnSourceFetchLeases').collect()) await ctx.db.delete(row._id)
        for (let index = 0; index < LEARN_V2_FETCH_ADMISSION_POLICY.ownerRateLimit; index++) {
          await ctx.db.insert('learnSourceFetchRateEvents', {
            userId: identity.tokenIdentifier,
            learningVoidId: setupResult.learningVoidId,
            sourceSnapshotId: sources[0]!.sourceSnapshotId,
            createdAt: Date.now(),
            expiresAt: Date.now() + LEARN_V2_FETCH_ADMISSION_POLICY.rateWindowMs,
          })
        }
      })
      expect(await setupResult.t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: sources[2]!.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'rate-denied',
      })).toMatchObject({ kind: 'retryable_denial', reason: 'rate_limited' })
      await setupResult.t.run(async (ctx) => {
        for (const row of await ctx.db.query('learnSourceFetchRateEvents').collect()) {
          await ctx.db.patch(row._id, {
            createdAt: Date.now() - LEARN_V2_FETCH_ADMISSION_POLICY.rateWindowMs - 1,
            expiresAt: Date.now() - 1,
          })
        }
      })
      expect(await setupResult.t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: sources[2]!.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'rate-expired',
      })).toMatchObject({ kind: 'acquired' })
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('treats lease and rate rows expiring exactly now as expired', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    const now = 50_000
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      const setupResult = await setup()
      const source = await register(setupResult, 'exact-expiry')
      await setupResult.t.run(async (ctx) => {
        await ctx.db.insert('learnSourceFetchLeases', {
          userId: identity.tokenIdentifier,
          learningVoidId: setupResult.learningVoidId,
          sourceSnapshotId: source.sourceSnapshotId,
          idempotencyKeyHash: 'sha256:expired-lease',
          requestFingerprint: 'expired',
          leaseToken: 'expired',
          expiresAt: now,
          createdAt: 1,
        })
        for (let index = 0; index < LEARN_V2_FETCH_ADMISSION_POLICY.ownerRateLimit; index++) {
          await ctx.db.insert('learnSourceFetchRateEvents', {
            userId: identity.tokenIdentifier,
            learningVoidId: setupResult.learningVoidId,
            sourceSnapshotId: source.sourceSnapshotId,
            createdAt: now - LEARN_V2_FETCH_ADMISSION_POLICY.rateWindowMs,
            expiresAt: now,
          })
        }
      })
      expect(await setupResult.t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: source.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'exact-expiry-fetch',
      })).toMatchObject({ kind: 'acquired' })
    }
    finally {
      clock.mockRestore()
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('preserves the owner rate window when a source is deleted and re-registered', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const setupResult = await setup()
      const url = 'https://example.com/rate-history'
      const source = await register(setupResult, 'rate-history', url)
      await setupResult.t.run(async (ctx) => {
        for (let index = 0; index < LEARN_V2_FETCH_ADMISSION_POLICY.ownerRateLimit; index++) {
          const now = Date.now()
          await ctx.db.insert('learnSourceFetchRateEvents', {
            userId: identity.tokenIdentifier,
            learningVoidId: setupResult.learningVoidId,
            sourceSnapshotId: source.sourceSnapshotId,
            createdAt: now,
            expiresAt: now + LEARN_V2_FETCH_ADMISSION_POLICY.rateWindowMs,
          })
        }
      })
      await setupResult.owner.mutation(api.learnV2Sources.markUnavailable, {
        sourceSnapshotId: source.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'delete-rate-history',
        reason: 'source_deleted',
      })
      await setupResult.t.finishAllScheduledFunctions(() => {})
      const replacement = await register(setupResult, 'rate-history-replacement', url)
      expect(await setupResult.t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: replacement.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'fetch-rate-history-replacement',
      })).toMatchObject({ kind: 'retryable_denial', reason: 'rate_limited' })
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('rejects wrong or expired leases and rechecks identity plus entitlement at commit', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const setupResult = await setup()
      const registered = await register(setupResult, 'lease-races')
      const admission = await setupResult.t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: registered.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'lease-races',
      })
      if (admission.kind !== 'acquired') throw new Error('Expected lease')
      const commitArgs = {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: registered.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'lease-races',
        leaseId: admission.leaseId,
        requestFingerprint: admission.requestFingerprint,
        result: { kind: 'failure' as const, reason: 'http_status' as const, fetchPolicyVersion: 'learn-v2.fetch.v2' as const },
      }
      await expect(setupResult.t.mutation(internal.learnV2Sources.commitFetchResult, {
        ...commitArgs,
        leaseToken: 'wrong-token',
      })).rejects.toThrow(/lease unavailable/)
      await setupResult.t.run(ctx => ctx.db.patch(admission.leaseId, { expiresAt: Date.now() - 1 }))
      await expect(setupResult.t.mutation(internal.learnV2Sources.commitFetchResult, {
        ...commitArgs,
        leaseToken: admission.leaseToken,
      })).rejects.toThrow(/lease expired/)

      const identityRace = await register(setupResult, 'identity-race')
      const identityAdmission = await setupResult.t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: identityRace.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'identity-race',
      })
      if (identityAdmission.kind !== 'acquired') throw new Error('Expected identity lease')
      await setupResult.t.run(async (ctx) => {
        const source = await ctx.db.get(identityRace.sourceSnapshotId)
        await ctx.db.patch(source!.sourceIdentityId, { tombstonedAt: Date.now(), canonicalUrl: undefined })
      })
      await expect(setupResult.t.mutation(internal.learnV2Sources.commitFetchResult, {
        ...commitArgs,
        sourceSnapshotId: identityRace.sourceSnapshotId,
        idempotencyKey: 'identity-race',
        leaseId: identityAdmission.leaseId,
        leaseToken: identityAdmission.leaseToken,
        requestFingerprint: identityAdmission.requestFingerprint,
      })).rejects.toThrow(/identity unavailable/)

      const identityAdmissionRace = await register(setupResult, 'identity-admission-race')
      await setupResult.t.run(async (ctx) => {
        const source = await ctx.db.get(identityAdmissionRace.sourceSnapshotId)
        await ctx.db.patch(source!.sourceIdentityId, { tombstonedAt: Date.now(), canonicalUrl: undefined })
      })
      await expect(setupResult.t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: identityAdmissionRace.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'identity-admission-race',
      })).rejects.toThrow(/identity unavailable/)

      const accessRace = await register(setupResult, 'access-race')
      const accessAdmissionRace = await register(setupResult, 'access-admission-race')
      const accessAdmission = await setupResult.t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: accessRace.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'access-race',
      })
      if (accessAdmission.kind !== 'acquired') throw new Error('Expected access lease')
      await setupResult.t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: false })
      await expect(setupResult.t.mutation(internal.learnV2Sources.commitFetchResult, {
        ...commitArgs,
        sourceSnapshotId: accessRace.sourceSnapshotId,
        idempotencyKey: 'access-race',
        leaseId: accessAdmission.leaseId,
        leaseToken: accessAdmission.leaseToken,
        requestFingerprint: accessAdmission.requestFingerprint,
      })).rejects.toThrow(/access denied/)
      await expect(setupResult.t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: accessAdmissionRace.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'access-admission-race',
      })).rejects.toThrow(/access denied/)
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('stores policy for terminal fetch failure but leaves retryable infrastructure failure unchanged', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const setupResult = await setup()
      const terminal = await register(setupResult, 'terminal-failure', 'https://example.com/private/failure?token=secret')
      const retryable = await register(setupResult, 'retryable-failure')
      const actionContext = {
        auth: { getUserIdentity: async () => identity },
        runMutation: setupResult.t.mutation,
      }
      expect(await orchestrateSourceFetch(actionContext as never, {
        sourceSnapshotId: terminal.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'terminal-failure',
      }, async () => { throw new SafeFetchError('authentication_required') })).toMatchObject({ status: 'unavailable' })
      expect(await setupResult.t.run(ctx => ctx.db.get(terminal.sourceSnapshotId))).toMatchObject({
        status: 'unavailable',
        fetchPolicyVersion: 'learn-v2.fetch.v2',
      })
      const failedIdentity = await setupResult.t.run(async (ctx) => {
        const source = await ctx.db.get(terminal.sourceSnapshotId)
        return source ? await ctx.db.get(source.sourceIdentityId) : null
      })
      expect(failedIdentity!.canonicalUrl).toBeUndefined()
      expect(failedIdentity!.privateLocator).toBeUndefined()
      expect(failedIdentity!.externalKey).toMatch(/^sha256:[a-f0-9]{64}$/)
      expect(await orchestrateSourceFetch(actionContext as never, {
        sourceSnapshotId: retryable.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'retryable-failure',
      }, async () => { throw new SafeFetchError('network_failure', true) })).toMatchObject({
        retryable: true,
        infrastructureFailure: true,
      })
      expect(await setupResult.t.run(ctx => ctx.db.get(retryable.sourceSnapshotId))).toMatchObject({
        status: 'candidate',
        recordRevision: 1,
      })
      expect(await setupResult.t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: retryable.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'retryable-failure',
      })).toMatchObject({ kind: 'acquired' })
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('lets the owner resume evaluation after a fetched source review was interrupted', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const setupResult = await setup()
      const registered = await register(setupResult, 'resume-fetched-review')
      await setupResult.t.run(ctx => ctx.db.patch(registered.sourceSnapshotId, {
        status: 'fetched',
        effectiveStatus: 'fetched',
        recordRevision: 2,
        rightsStatus: 'unknown',
        rightsProvenance: 'none',
        rightsPolicyVersion: 'learn-v2.rights.v2',
      }))

      await expect(setupResult.owner.mutation(api.learnV2Sources.prepareFetchedSourceForReview, {
        sourceSnapshotId: registered.sourceSnapshotId,
        expectedRevision: 2,
        idempotencyKey: 'resume-fetched-review',
      })).resolves.toMatchObject({ status: 'evaluated', recordRevision: 3, conflictStatus: 'clear' })
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('rejects registration and lifecycle writes against an older Blueprint revision', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const setupResult = await setup()
      const candidate = await register(setupResult, 'before-new-blueprint')
      await setupResult.t.run(async (ctx) => {
        const first = await ctx.db.get(setupResult.blueprintRevisionId)
        await ctx.db.insert('learnBlueprintRevisions', {
          userId: identity.tokenIdentifier,
          blueprintId: first!.blueprintId,
          learningVoidId: setupResult.learningVoidId,
          revision: 2,
          recordRevision: 1,
          status: 'draft',
          createdAt: 2,
          updatedAt: 2,
        })
      })
      await expect(register(setupResult, 'after-new-blueprint')).rejects.toThrow(/superseded/)
      await expect(setupResult.t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: candidate.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'fetch-superseded-blueprint',
      })).rejects.toThrow(/superseded/)
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('persists only key digests and erases protected URLs for unknown rights', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const setupResult = await setup()
      const rawRegisterKey = 'register-key-must-not-survive'
      const rawFetchKey = 'fetch-key-must-not-survive'
      const registered = await setupResult.owner.mutation(api.learnV2Sources.registerCandidate, {
        learningVoidId: setupResult.learningVoidId,
        blueprintRevisionId: setupResult.blueprintRevisionId,
        url: 'https://example.com/capability/secret-path?token=secret-query',
        expectedVoidRevision: 1,
        expectedBlueprintRecordRevision: 1,
        idempotencyKey: rawRegisterKey,
      }) as { sourceSnapshotId: Id<'learnSourceSnapshots'> }
      const admission = await setupResult.t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: registered.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: rawFetchKey,
      })
      if (admission.kind !== 'acquired') throw new Error('Expected lease')
      const durableBeforeCommit = await setupResult.t.run(async (ctx) => ({
        lease: await ctx.db.get(admission.leaseId),
        receipts: await ctx.db.query('learnSourceCommandReceipts').collect(),
      }))
      expect(durableBeforeCommit.lease).not.toHaveProperty('idempotencyKey')
      expect(durableBeforeCommit.lease!.idempotencyKeyHash).toMatch(/^sha256:[a-f0-9]{64}$/)
      expect(JSON.stringify(durableBeforeCommit)).not.toContain(rawRegisterKey)
      expect(JSON.stringify(durableBeforeCommit)).not.toContain(rawFetchKey)

      await setupResult.t.mutation(internal.learnV2Sources.commitFetchResult, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: registered.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: rawFetchKey,
        leaseId: admission.leaseId,
        leaseToken: admission.leaseToken,
        requestFingerprint: admission.requestFingerprint,
        result: {
          kind: 'success',
          finalUrl: 'https://redirect.example/private/final-secret?signature=secret',
          publicLocator: 'https://attacker.example/leak',
          contentHash: 'c'.repeat(64),
          contentType: 'text/plain',
          wireBytes: 4,
          decodedBytes: 4,
          excerpt: 'must not persist',
          trustClassification: 'untrusted_source_data',
          rightsStatus: 'unknown',
          rightsProvenance: 'none',
          rightsPolicyVersion: 'learn-v2.rights.v2',
          fetchPolicyVersion: 'learn-v2.fetch.v2',
        },
      })
      const durable = await setupResult.t.run(async (ctx) => {
        const source = await ctx.db.get(registered.sourceSnapshotId)
        const sourceIdentity = source ? await ctx.db.get(source.sourceIdentityId) : null
        const excerpt = await ctx.db.query('learnSourceExcerpts')
          .withIndex('by_userId_and_sourceSnapshotId', q => q
            .eq('userId', identity.tokenIdentifier).eq('sourceSnapshotId', registered.sourceSnapshotId))
          .unique()
        return { source, sourceIdentity, excerpt, receipts: await ctx.db.query('learnSourceCommandReceipts').collect() }
      })
      expect(durable.source!.publicLocator).toBe('https://redirect.example/')
      expect(durable.source!.privateLocator).toBeUndefined()
      expect(durable.sourceIdentity).toMatchObject({
        externalKey: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        publicLocator: 'https://redirect.example/',
      })
      expect(durable.sourceIdentity!.canonicalUrl).toBeUndefined()
      expect(durable.sourceIdentity!.privateLocator).toBeUndefined()
      expect(durable.excerpt).toMatchObject({ locator: 'https://redirect.example/' })
      expect(durable.excerpt!.privateLocator).toBeUndefined()
      expect(durable.excerpt!.excerpt).toBeUndefined()
      expect(JSON.stringify(durable)).not.toContain('secret-path')
      expect(JSON.stringify(durable)).not.toContain('final-secret')
      expect(durable.receipts.every(receipt => /^sha256:[a-f0-9]{64}$/.test(receipt.idempotencyKeyHash))).toBe(true)
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('ignores expired rate rows beyond the bounded cleanup batch', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100_000)
    try {
      const setupResult = await setup()
      const source = await register(setupResult, 'many-expired-rate-rows')
      await setupResult.t.run(async (ctx) => {
        for (let index = 0; index < 40; index++) {
          await ctx.db.insert('learnSourceFetchRateEvents', {
            userId: identity.tokenIdentifier,
            learningVoidId: setupResult.learningVoidId,
            sourceSnapshotId: source.sourceSnapshotId,
            createdAt: index,
            expiresAt: 100_000,
          })
        }
      })
      expect(await setupResult.t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: source.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'after-many-expired-rate-rows',
      })).toMatchObject({ kind: 'acquired' })
    }
    finally {
      clock.mockRestore()
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('validates the closed fetch failure vocabulary at the commit boundary', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const setupResult = await setup()
      const source = await register(setupResult, 'invalid-failure-vocabulary')
      const admission = await setupResult.t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: source.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'invalid-failure-vocabulary',
      })
      if (admission.kind !== 'acquired') throw new Error('Expected lease')
      await expect(setupResult.t.mutation(internal.learnV2Sources.commitFetchResult, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: source.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'invalid-failure-vocabulary',
        leaseId: admission.leaseId,
        leaseToken: admission.leaseToken,
        requestFingerprint: admission.requestFingerprint,
        result: { kind: 'failure', reason: 'attacker supplied reason', fetchPolicyVersion: 'fake-policy' },
      } as never)).rejects.toThrow()
      expect(await setupResult.t.run(ctx => ctx.db.get(source.sourceSnapshotId))).toMatchObject({ status: 'candidate' })
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('re-purges rejected and already-unavailable sources without rewriting terminal state', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const setupResult = await setup()
      const sourceSnapshotId = await setupResult.t.run(async (ctx) => {
        const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', {
          userId: identity.tokenIdentifier,
          learningVoidId: setupResult.learningVoidId,
          origin: 'user_url',
          externalKey: `sha256:${'d'.repeat(64)}`,
          canonicalUrl: 'https://example.com/private/rejected?token=secret',
          privateLocator: 'https://example.com/private/rejected?token=secret',
        })
        const id = await ctx.db.insert('learnSourceSnapshots', {
          userId: identity.tokenIdentifier,
          sourceIdentityId,
          learningVoidId: setupResult.learningVoidId,
          blueprintRevisionId: setupResult.blueprintRevisionId,
          revision: 1,
          recordRevision: 3,
          status: 'rejected',
          effectiveStatus: 'rejected',
          privateLocator: 'https://example.com/private/rejected?token=secret',
          createdAt: 1,
          updatedAt: 1,
        })
        await ctx.db.insert('learnSourceExcerpts', {
          userId: identity.tokenIdentifier,
          sourceSnapshotId: id,
          locator: 'https://example.com/private/rejected?token=secret',
          privateLocator: 'https://example.com/private/rejected?token=secret',
          excerpt: 'protected excerpt',
          rightsStatus: 'permitted',
        })
        return id
      })
      const first = await setupResult.owner.mutation(api.learnV2Sources.markUnavailable, {
        sourceSnapshotId,
        expectedRevision: 3,
        idempotencyKey: 'purge-rejected',
        reason: 'access_lost',
      })
      expect(first).toMatchObject({ status: 'rejected', effectiveStatus: 'unavailable', recordRevision: 4, unavailableReason: 'access_lost' })
      await setupResult.t.finishAllScheduledFunctions(() => {})
      const second = await setupResult.owner.mutation(api.learnV2Sources.markUnavailable, {
        sourceSnapshotId,
        expectedRevision: 4,
        idempotencyKey: 'purge-rejected-again',
        reason: 'policy_denied',
      })
      expect(second).toMatchObject({ status: 'rejected', effectiveStatus: 'unavailable', recordRevision: 4, unavailableReason: 'access_lost' })
      const stored = await setupResult.t.run(async (ctx) => ({
        source: await ctx.db.get(sourceSnapshotId),
        excerpt: await ctx.db.query('learnSourceExcerpts')
          .withIndex('by_userId_and_sourceSnapshotId', q => q
            .eq('userId', identity.tokenIdentifier).eq('sourceSnapshotId', sourceSnapshotId))
          .unique(),
      }))
      expect(stored.source).toMatchObject({ status: 'rejected', effectiveStatus: 'unavailable', unavailableReason: 'access_lost' })
      expect(stored.source!.privateLocator).toBeUndefined()
      expect(stored.excerpt!.excerpt).toBeUndefined()
      expect(stored.excerpt!.privateLocator).toBeUndefined()
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('blocks noarchive acceptance, tombstones accepted evidence exactly, and scopes identical URLs by Void', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const setupResult = await setup()
      const registered = await register(setupResult, 'noarchive', 'https://example.com/same?secret=one')
      const actionContext = {
        auth: { getUserIdentity: async () => identity },
        runMutation: setupResult.t.mutation,
      }
      const rights = classifyRetentionRights({ 'x-robots-tag': 'noarchive' })
      await orchestrateSourceFetch(actionContext as never, {
        sourceSnapshotId: registered.sourceSnapshotId,
        expectedRevision: 1,
        idempotencyKey: 'fetch-noarchive',
      }, async () => ({
        finalUrl: 'https://example.com/same?secret=two',
        publicLocator: 'https://example.com/same',
        contentHash: 'b'.repeat(64),
        contentType: 'text/html',
        wireBytes: 10,
        decodedBytes: 10,
        trustClassification: 'untrusted_source_data',
        rights,
        fetchPolicyVersion: 'learn-v2.fetch.v2',
      }))
      const deniedRetention = await setupResult.t.run(async (ctx) => {
        const source = await ctx.db.get(registered.sourceSnapshotId)
        const sourceIdentity = source ? await ctx.db.get(source.sourceIdentityId) : null
        const excerpt = await ctx.db.query('learnSourceExcerpts')
          .withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', identity.tokenIdentifier).eq('sourceSnapshotId', registered.sourceSnapshotId))
          .unique()
        return { source, sourceIdentity, excerpt }
      })
      expect(deniedRetention.source!.privateLocator).toBeUndefined()
      expect(deniedRetention.sourceIdentity!.canonicalUrl).toBeUndefined()
      expect(deniedRetention.sourceIdentity!.privateLocator).toBeUndefined()
      expect(deniedRetention.excerpt!.excerpt).toBeUndefined()
      expect(deniedRetention.excerpt!.privateLocator).toBeUndefined()
      await setupResult.t.mutation(internal.learnV2Sources.recordEvaluation, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId: registered.sourceSnapshotId,
        expectedRevision: 2,
        idempotencyKey: 'evaluate-noarchive',
        conflictStatus: 'unresolved',
      })
      await expect(setupResult.owner.mutation(api.learnV2Sources.acceptSource, {
        sourceSnapshotId: registered.sourceSnapshotId,
        expectedRevision: 3,
        idempotencyKey: 'accept-noarchive',
      })).rejects.toThrow(/cannot be accepted/)

      await setupResult.t.run(ctx => ctx.db.patch(registered.sourceSnapshotId, {
        rightsStatus: 'permitted',
        rightsProvenance: 'link_license',
      }))
      await expect(setupResult.owner.mutation(api.learnV2Sources.acceptSource, {
        sourceSnapshotId: registered.sourceSnapshotId,
        expectedRevision: 3,
        idempotencyKey: 'accept-unresolved-conflict',
      })).rejects.toThrow(/cannot be accepted/)
      await setupResult.t.run(ctx => ctx.db.patch(registered.sourceSnapshotId, { conflictStatus: 'clear' }))
      await setupResult.owner.mutation(api.learnV2Sources.acceptSource, {
        sourceSnapshotId: registered.sourceSnapshotId,
        expectedRevision: 3,
        idempotencyKey: 'accept-after-policy',
      })
      const objectiveId = await setupResult.t.run(ctx => ctx.db.insert('learnObjectives', {
        userId: identity.tokenIdentifier,
        blueprintRevisionId: setupResult.blueprintRevisionId,
        order: 0,
        title: 'Preserved objective',
      }))
      const attemptId = await setupResult.t.run(ctx => ctx.db.insert('masteryAttempts', {
        userId: identity.tokenIdentifier,
        objectiveId,
        attemptedAt: Date.now(),
        idempotencyKey: 'completed-attempt',
        result: 'completed',
      }))
      const supportId = await setupResult.t.run(async (ctx) => {
        const excerpt = await ctx.db.query('learnSourceExcerpts')
          .withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', identity.tokenIdentifier).eq('sourceSnapshotId', registered.sourceSnapshotId)).unique()
        const studyPlanId = await ctx.db.insert('studyPlans', { userId: identity.tokenIdentifier, learningVoidId: setupResult.learningVoidId, revision: 1, createdAt: 1 })
        const studyPlanRevisionId = await ctx.db.insert('studyPlanRevisions', { userId: identity.tokenIdentifier, studyPlanId, learningVoidId: setupResult.learningVoidId, revision: 1, status: 'active', createdAt: 1 })
        const sessionId = await ctx.db.insert('studySessions', { userId: identity.tokenIdentifier, studyPlanRevisionId, primaryObjectiveId: objectiveId, status: 'completed', revision: 1, scheduledStartAt: 1 })
        const contentId = await ctx.db.insert('sessionContent', { userId: identity.tokenIdentifier, studySessionId: sessionId, revision: 1, status: 'published', createdAt: 1 })
        const claimId = await ctx.db.insert('sessionContentClaims', { userId: identity.tokenIdentifier, sessionContentId: contentId, order: 0, claim: 'Accepted source claim' })
        return await ctx.db.insert('learnClaimSupports', {
          userId: identity.tokenIdentifier,
          sessionContentClaimId: claimId,
          sourceExcerptId: excerpt!._id,
          entailment: 'entailed',
          conflictStatus: 'clear',
          evidenceStatus: 'evidence_available',
        })
      })
      const secondFolderId = await setupResult.owner.mutation(api.folders.createFolder, { name: 'Second source scope' })
      const secondVoidId = await setupResult.t.run(ctx => ctx.db.insert('learningVoids', {
        userId: identity.tokenIdentifier,
        folderId: secondFolderId,
        title: 'Second Void',
        status: 'draft',
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      }))
      const secondBlueprintRevisionId = await setupResult.t.run(async (ctx) => {
        const blueprintId = await ctx.db.insert('learnBlueprints', { userId: identity.tokenIdentifier, learningVoidId: secondVoidId, revision: 1, createdAt: 1 })
        return await ctx.db.insert('learnBlueprintRevisions', { userId: identity.tokenIdentifier, blueprintId, learningVoidId: secondVoidId, revision: 1, recordRevision: 1, status: 'draft', createdAt: 1, updatedAt: 1 })
      })
      const second = await setupResult.owner.mutation(api.learnV2Sources.registerCandidate, {
        learningVoidId: secondVoidId,
        blueprintRevisionId: secondBlueprintRevisionId,
        url: 'https://example.com/same?secret=one',
        expectedVoidRevision: 1,
        expectedBlueprintRecordRevision: 1,
        idempotencyKey: 'register-same-second-void',
      }) as { sourceSnapshotId: Id<'learnSourceSnapshots'> }
      const liveIdentities = await setupResult.t.run(ctx => ctx.db.query('learnSourceIdentities').collect())
      expect(liveIdentities.filter(row => row.origin === 'user_url' && row.externalKey.startsWith('sha256:'))).toHaveLength(2)
      expect(second.sourceSnapshotId).not.toBe(registered.sourceSnapshotId)

      const deletionArgs = {
        sourceSnapshotId: registered.sourceSnapshotId,
        expectedRevision: 4,
        idempotencyKey: 'delete-accepted',
        reason: 'access_lost' as const,
      }
      const deleted = await setupResult.owner.mutation(api.learnV2Sources.markUnavailable, deletionArgs)
      expect(await setupResult.owner.mutation(api.learnV2Sources.markUnavailable, deletionArgs)).toEqual(deleted)
      await setupResult.t.finishAllScheduledFunctions(() => {})
      const stored = await setupResult.t.run(async (ctx) => {
        const source = await ctx.db.get(registered.sourceSnapshotId)
        const sourceIdentity = source ? await ctx.db.get(source.sourceIdentityId) : null
        const excerpt = await ctx.db.query('learnSourceExcerpts')
          .withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', identity.tokenIdentifier).eq('sourceSnapshotId', registered.sourceSnapshotId)).unique()
        const rateEvents = await ctx.db.query('learnSourceFetchRateEvents')
          .withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', identity.tokenIdentifier).eq('sourceSnapshotId', registered.sourceSnapshotId)).collect()
        return { source, sourceIdentity, excerpt, rateEvents, attempt: await ctx.db.get(attemptId), support: await ctx.db.get(supportId) }
      })
      expect(stored.source).toMatchObject({ status: 'user_accepted', effectiveStatus: 'unavailable', unavailableReason: 'access_lost' })
      expect(stored.source!.recordRevision).toBe(deleted.recordRevision)
      expect(stored.source!.publicLocator).toBe('https://example.com/')
      expect(stored.source!.privateLocator).toBeUndefined()
      expect(stored.sourceIdentity).toMatchObject({ externalKey: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) })
      expect(stored.sourceIdentity!.canonicalUrl).toBeUndefined()
      expect(stored.sourceIdentity!.privateLocator).toBeUndefined()
      expect(stored.excerpt!.locator).toBe('https://example.com/')
      expect(stored.excerpt!.privateLocator).toBeUndefined()
      expect(stored.rateEvents).toHaveLength(1)
      expect(stored.attempt).not.toBeNull()
      expect(stored.support).toMatchObject({ evidenceStatus: 'evidence_unavailable' })
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('rejects acceptance of an effectively unavailable evaluated source', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const setupResult = await setup()
      const sourceSnapshotId = await setupResult.t.run(async (ctx) => {
        const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', {
          userId: identity.tokenIdentifier,
          learningVoidId: setupResult.learningVoidId,
          origin: 'user_url',
          externalKey: `sha256:${'1'.repeat(64)}`,
        })
        return await ctx.db.insert('learnSourceSnapshots', {
          userId: identity.tokenIdentifier,
          learningVoidId: setupResult.learningVoidId,
          sourceIdentityId,
          blueprintRevisionId: setupResult.blueprintRevisionId,
          revision: 1,
          recordRevision: 3,
          status: 'evaluated',
          effectiveStatus: 'unavailable',
          rightsStatus: 'permitted',
          conflictStatus: 'clear',
          evidencePurgedAt: 0,
          createdAt: 1,
        })
      })
      await expect(setupResult.owner.mutation(api.learnV2Sources.acceptSource, {
        sourceSnapshotId,
        expectedRevision: 3,
        idempotencyKey: 'cannot-resurrect',
      })).rejects.toThrow(/cannot be accepted/)
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('refuses to increment exhausted source record revisions', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const setupResult = await setup()
      const sourceSnapshotId = await setupResult.t.run(async (ctx) => {
        const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', {
          userId: identity.tokenIdentifier,
          learningVoidId: setupResult.learningVoidId,
          origin: 'user_url',
          externalKey: `sha256:${'2'.repeat(64)}`,
        })
        return await ctx.db.insert('learnSourceSnapshots', {
          userId: identity.tokenIdentifier,
          learningVoidId: setupResult.learningVoidId,
          sourceIdentityId,
          blueprintRevisionId: setupResult.blueprintRevisionId,
          revision: 1,
          recordRevision: Number.MAX_SAFE_INTEGER,
          status: 'fetched',
          effectiveStatus: 'fetched',
          rightsStatus: 'unknown',
          createdAt: 1,
        })
      })
      await expect(setupResult.t.mutation(internal.learnV2Sources.recordEvaluation, {
        tokenIdentifier: identity.tokenIdentifier,
        sourceSnapshotId,
        expectedRevision: Number.MAX_SAFE_INTEGER,
        idempotencyKey: 'revision-exhausted',
        conflictStatus: 'clear',
      })).rejects.toThrow(/revision exhausted/)
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('origin-sanitizes legacy public locators in source reads', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const setupResult = await setup()
      const sourceSnapshotId = await setupResult.t.run(async (ctx) => {
        const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', {
          userId: identity.tokenIdentifier,
          learningVoidId: setupResult.learningVoidId,
          origin: 'user_url',
          externalKey: `sha256:${'3'.repeat(64)}`,
        })
        return await ctx.db.insert('learnSourceSnapshots', {
          userId: identity.tokenIdentifier,
          learningVoidId: setupResult.learningVoidId,
          sourceIdentityId,
          revision: 1,
          status: 'candidate',
          publicLocator: 'https://example.com/capability/secret?token=value#fragment',
          createdAt: 1,
        })
      })
      await expect(setupResult.owner.query(api.learnV2Sources.getSource, { sourceSnapshotId })).resolves.toMatchObject({
        publicLocator: 'https://example.com/',
      })
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('direct rejection purges protected source, excerpt, and identity fields', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    process.env.LEARN_V2_ENABLED = 'true'
    try {
      const setupResult = await setup()
      const ids = await setupResult.t.run(async (ctx) => {
        const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', {
          userId: identity.tokenIdentifier,
          learningVoidId: setupResult.learningVoidId,
          origin: 'user_url',
          externalKey: `sha256:${'4'.repeat(64)}`,
          canonicalUrl: 'https://example.com/private?token=secret',
          publicLocator: 'https://example.com/private?token=secret',
          privateLocator: 'https://example.com/private?token=secret',
        })
        const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', {
          userId: identity.tokenIdentifier,
          learningVoidId: setupResult.learningVoidId,
          sourceIdentityId,
          blueprintRevisionId: setupResult.blueprintRevisionId,
          revision: 1,
          recordRevision: 3,
          status: 'evaluated',
          effectiveStatus: 'evaluated',
          publicLocator: 'https://example.com/private?token=secret',
          privateLocator: 'https://example.com/private?token=secret',
          rightsStatus: 'permitted',
          conflictStatus: 'clear',
          createdAt: 1,
        })
        const excerptId = await ctx.db.insert('learnSourceExcerpts', {
          userId: identity.tokenIdentifier,
          sourceSnapshotId,
          locator: 'https://example.com/private?token=secret',
          privateLocator: 'https://example.com/private?token=secret',
          excerpt: 'protected evidence',
          rightsStatus: 'permitted',
        })
        return { sourceIdentityId, sourceSnapshotId, excerptId }
      })
      await setupResult.owner.mutation(api.learnV2Sources.rejectSource, {
        sourceSnapshotId: ids.sourceSnapshotId,
        expectedRevision: 3,
        idempotencyKey: 'direct-reject-purge',
      })
      const stored = await setupResult.t.run(async ctx => ({
        source: await ctx.db.get(ids.sourceSnapshotId),
        identity: await ctx.db.get(ids.sourceIdentityId),
        excerpt: await ctx.db.get(ids.excerptId),
      }))
      expect(stored.source).toMatchObject({ publicLocator: 'https://example.com/' })
      expect(stored.source!.privateLocator).toBeUndefined()
      expect(stored.identity).toMatchObject({ publicLocator: 'https://example.com/' })
      expect(stored.identity!.canonicalUrl).toBeUndefined()
      expect(stored.identity!.privateLocator).toBeUndefined()
      expect(stored.excerpt).toMatchObject({ locator: 'https://example.com/' })
      expect(stored.excerpt!.excerpt).toBeUndefined()
      expect(stored.excerpt!.privateLocator).toBeUndefined()
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })
})
