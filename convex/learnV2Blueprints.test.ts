/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const identity = { tokenIdentifier: 'https://auth.example.com|blueprint-owner', name: 'Blueprint Owner' }
let previousGate: string | undefined

beforeEach(() => {
  previousGate = process.env.LEARN_V2_ENABLED
  process.env.LEARN_V2_ENABLED = 'true'
})

afterEach(() => {
  if (previousGate === undefined) delete process.env.LEARN_V2_ENABLED
  else process.env.LEARN_V2_ENABLED = previousGate
})

async function setup() {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(identity)
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
  const folderId = await owner.mutation(api.folders.createFolder, { name: 'Blueprint evidence' })
  const learningVoidId = await t.run(ctx => ctx.db.insert('learningVoids', {
    userId: identity.tokenIdentifier,
    folderId,
    title: 'Evidence-bound blueprint',
    status: 'source_review',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  }))
  const blueprintRevisionId = await t.run(async (ctx) => {
    const blueprintId = await ctx.db.insert('learnBlueprints', { userId: identity.tokenIdentifier, learningVoidId, revision: 1, createdAt: 1 })
    return await ctx.db.insert('learnBlueprintRevisions', {
      userId: identity.tokenIdentifier,
      blueprintId,
      learningVoidId,
      revision: 1,
      recordRevision: 1,
      status: 'source_review',
      intentVersion: 'learn-v2.blueprint-intent.v1',
      desiredOutcome: 'Apply the accepted evidence to a bounded real-world case',
      mode: 'apply',
      desiredDepth: 'working',
      sourcePolicy: 'folder_plus_web',
      createdAt: 1,
      updatedAt: 1,
    })
  })
  const sourceSnapshotId = await insertAcceptedSource(t, learningVoidId, blueprintRevisionId, 'one')
  return { t, owner, folderId, learningVoidId, blueprintRevisionId, sourceSnapshotId }
}

async function insertAcceptedSource(
  t: ReturnType<typeof convexTest>,
  learningVoidId: Id<'learningVoids'>,
  blueprintRevisionId: Id<'learnBlueprintRevisions'>,
  suffix: string,
) {
  return await t.run(async (ctx) => {
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', {
      userId: identity.tokenIdentifier,
      learningVoidId,
      origin: 'user_url',
      externalKey: `source-${suffix}`,
      canonicalUrl: `https://example.com/${suffix}`,
      title: `Source ${suffix}`,
    })
    const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', {
      userId: identity.tokenIdentifier,
      sourceIdentityId,
      learningVoidId,
      blueprintRevisionId,
      revision: 1,
      recordRevision: 4,
      status: 'user_accepted',
      effectiveStatus: 'user_accepted',
      contentHash: suffix.padEnd(64, 'a').slice(0, 64),
      sourceRevision: `sha256:${suffix.padEnd(64, 'a').slice(0, 64)}`,
      rightsStatus: 'permitted',
      conflictStatus: 'clear',
      acceptedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    await ctx.db.insert('learnSourceExcerpts', {
      userId: identity.tokenIdentifier,
      sourceSnapshotId,
      locator: `https://example.com/${suffix}`,
      excerpt: `Verified evidence for ${suffix} and its bounded capabilities.`,
      rightsStatus: 'permitted',
    })
    return sourceSnapshotId
  })
}

function candidate(sourceSnapshotId: Id<'learnSourceSnapshots'>) {
  return {
    version: 'learn-v2.blueprint-candidate.v1' as const,
    generatorVersion: 'test-generator.v1',
    milestones: [
      { key: 'foundations', order: 0, title: 'Foundations' },
      { key: 'practice', order: 1, title: 'Practice' },
      { key: 'transfer', order: 2, title: 'Transfer' },
    ],
    objectives: Array.from({ length: 6 }, (_, index) => ({
      key: `objective-${index + 1}`,
      milestoneKey: index < 2 ? 'foundations' : index < 4 ? 'practice' : 'transfer',
      order: index,
      title: `Objective ${index + 1}`,
      capability: `Apply capability ${index + 1} to a bounded case`,
      estimatedMinutes: 25,
      coverage: 'strong' as 'strong' | 'partial' | 'gap',
      gapReason: undefined as string | undefined,
      sourceSnapshotIds: [sourceSnapshotId],
      gapSourceSnapshotIds: [] as Id<'learnSourceSnapshots'>[],
      prerequisiteObjectiveKeys: index === 0 ? [] : [`objective-${index}`],
      assessmentContract: {
        version: 'learn-v2.assessment.v1' as const,
        kind: 'bounded_rubric' as const,
        responseFormat: 'short_text' as const,
        instructions: `Apply capability ${index + 1} to a novel case.`,
        passingScorePercent: 80 as const,
        criteria: [
          { key: 'accuracy', description: 'Uses accepted evidence accurately.', weightPercent: 60 },
          { key: 'application', description: 'Applies the capability.', weightPercent: 40 },
        ],
      },
    })),
  }
}

function providerCandidate(sourceAlias = 'source-001') {
  const value = candidate('provider-alias-placeholder' as Id<'learnSourceSnapshots'>)
  const { generatorVersion: _generatorVersion, ...providerValue } = value
  return {
    ...providerValue,
    milestones: value.milestones.map(milestone => ({ ...milestone, description: null })),
    objectives: value.objectives.map(({ sourceSnapshotIds: _sourceSnapshotIds, gapSourceSnapshotIds: _gapSourceSnapshotIds, ...objective }) => ({
      ...objective,
      gapReason: objective.gapReason ?? null,
      sourceAliases: [sourceAlias],
      gapSourceAliases: [],
    })),
  }
}

async function startAndBegin(setupResult: Awaited<ReturnType<typeof setup>>, key = 'generate-blueprint') {
  const job = await setupResult.owner.mutation(api.learnV2Blueprints.startBlueprintGeneration, {
    learningVoidId: setupResult.learningVoidId,
    blueprintRevisionId: setupResult.blueprintRevisionId,
    expectedVoidRevision: 1,
    expectedBlueprintRecordRevision: 1,
    idempotencyKey: key,
  })
  const lease = await setupResult.t.mutation(internal.learnV2Blueprints.leaseBlueprintGeneration, {
    tokenIdentifier: identity.tokenIdentifier,
    jobId: job._id,
    expectedRevision: 1,
  })
  if (lease.kind !== 'leased') throw new Error('Expected Blueprint lease')
  const running = await setupResult.t.mutation(internal.learnV2Blueprints.beginBlueprintGeneration, {
    tokenIdentifier: identity.tokenIdentifier,
    jobId: job._id,
    leaseToken: lease.leaseToken,
    expectedRevision: lease.revision,
  })
  return { job, lease, running }
}

describe('Learn V2 evidence-bound Blueprint generation', () => {
  test('configures canonical intent idempotently and binds its revision into admission', async () => {
    const setupResult = await setup()
    const args = {
      blueprintRevisionId: setupResult.blueprintRevisionId,
      expectedBlueprintRecordRevision: 1,
      desiredOutcome: '  Understand the evidence well enough to explain it clearly.  ',
      mode: 'understand' as const,
      desiredDepth: 'deep' as const,
      sourcePolicy: 'folder_only' as const,
      targetLocalDate: '2030-10-15',
      sessionMinutes: 45 as const,
      idempotencyKey: 'configure-intent',
    }
    const configured = await setupResult.owner.mutation(api.learnV2Blueprints.configureBlueprintIntent, args)
    expect(configured).toMatchObject({
      recordRevision: 2,
      replayed: false,
      intent: { desiredOutcome: 'Understand the evidence well enough to explain it clearly.', sourcePolicy: 'folder_only', targetLocalDate: '2030-10-15', sessionMinutes: 45 },
    })
    await expect(setupResult.owner.mutation(api.learnV2Blueprints.configureBlueprintIntent, args)).resolves.toMatchObject({ replayed: true })
    await expect(setupResult.owner.mutation(api.learnV2Blueprints.startBlueprintGeneration, {
      learningVoidId: setupResult.learningVoidId,
      blueprintRevisionId: setupResult.blueprintRevisionId,
      expectedVoidRevision: 1,
      expectedBlueprintRecordRevision: 1,
      idempotencyKey: 'stale-intent-revision',
    })).rejects.toThrow(/revision conflict/)
    await expect(setupResult.owner.mutation(api.learnV2Blueprints.startBlueprintGeneration, {
      learningVoidId: setupResult.learningVoidId,
      blueprintRevisionId: setupResult.blueprintRevisionId,
      expectedVoidRevision: 1,
      expectedBlueprintRecordRevision: 2,
      idempotencyKey: 'folder-policy-rejects-url',
    })).rejects.toThrow(/source policy/)
  })

  test('prepares an exact frozen folder revision for evaluation without persisting its text', async () => {
    const setupResult = await setup()
    const hash = 'b'.repeat(64)
    const folderEvidence = await setupResult.t.run(async (ctx) => {
      const documentId = await ctx.db.insert('documents', {
        userId: identity.tokenIdentifier,
        folderId: setupResult.folderId,
        filename: 'private-notes.txt',
        status: 'success',
        fileSize: 100,
        r2Key: 'owners/blueprint/private-notes.txt',
        contentHash: hash,
        sourceRevision: `sha256:${hash}`,
      })
      const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', {
        userId: identity.tokenIdentifier,
        learningVoidId: setupResult.learningVoidId,
        origin: 'folder_document',
        externalKey: `document:${documentId}`,
        folderDocumentId: documentId,
        title: 'private-notes.txt',
      })
      const manifestId = await ctx.db.insert('learnFolderSourceManifests', {
        userId: identity.tokenIdentifier,
        learningVoidId: setupResult.learningVoidId,
        blueprintRevisionId: setupResult.blueprintRevisionId,
        rootFolderId: setupResult.folderId,
        expectedVoidRevision: 1,
        expectedBlueprintRecordRevision: 1,
        recordRevision: 1,
        status: 'frozen',
        coverage: 'complete',
        idempotencyKey: 'folder-manifest',
        requestFingerprint: 'fingerprint',
        explicitDocumentIds: [],
        explicitDocumentCursor: 0,
        nextFolderOrder: 1,
        nextEntryOrder: 1,
        entryCount: 1,
        availableCount: 1,
        unavailableCount: 0,
        createdAt: 1,
        frozenAt: 1,
      })
      const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', {
        userId: identity.tokenIdentifier,
        sourceIdentityId,
        learningVoidId: setupResult.learningVoidId,
        blueprintRevisionId: setupResult.blueprintRevisionId,
        folderManifestId: manifestId,
        revision: 1,
        recordRevision: 1,
        status: 'candidate',
        effectiveStatus: 'candidate',
        contentHash: hash,
        sourceRevision: `sha256:${hash}`,
        objectKey: 'owners/blueprint/private-notes.txt',
        folderId: setupResult.folderId,
        folderRevision: 'folder-revision',
        filename: 'private-notes.txt',
        createdAt: 1,
        updatedAt: 1,
      })
      await ctx.db.insert('learnSourceExcerpts', {
        userId: identity.tokenIdentifier,
        sourceSnapshotId,
        locator: 'private-locator',
        privateLocator: 'https://private.example/folder',
        excerpt: 'must be removed',
        rightsStatus: 'permitted',
      })
      await ctx.db.insert('learnFolderSourceManifestEntries', {
        userId: identity.tokenIdentifier,
        manifestId,
        order: 0,
        documentId,
        folderId: setupResult.folderId,
        folderRevision: 'folder-revision',
        sourceIdentityId,
        sourceSnapshotId,
        contentHash: hash,
        documentRevision: `sha256:${hash}`,
        availability: 'available',
      })
      return { sourceSnapshotId, documentId }
    })
    const folderSource = folderEvidence.sourceSnapshotId

    await setupResult.owner.mutation(api.learnV2Sources.prepareFolderSourceForReview, {
      sourceSnapshotId: folderSource,
      expectedRevision: 1,
      idempotencyKey: 'prepare-folder-source',
    })
    await setupResult.owner.mutation(api.learnV2Sources.acceptSource, {
      sourceSnapshotId: folderSource,
      expectedRevision: 3,
      idempotencyKey: 'accept-folder-source',
    })

    const stored = await setupResult.t.run(async (ctx) => ({
      source: await ctx.db.get(folderSource),
      blueprint: await ctx.db.get(setupResult.blueprintRevisionId),
      excerpt: await ctx.db.query('learnSourceExcerpts')
        .withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', identity.tokenIdentifier).eq('sourceSnapshotId', folderSource))
        .unique(),
    }))
    expect(stored.source).toMatchObject({ status: 'user_accepted', rightsStatus: 'unknown', recordRevision: 4 })
    expect(stored.excerpt).toMatchObject({ locator: `sha256:${hash}`, rightsStatus: 'unknown' })
    expect(stored.excerpt?.excerpt).toBeUndefined()
    expect(stored.blueprint).toMatchObject({ recordRevision: 2 })
    const review = await setupResult.owner.query(api.learnV2Sources.listSourceReview, {
      blueprintRevisionId: setupResult.blueprintRevisionId,
      paginationOpts: { cursor: null, numItems: 16 },
    })
    const folderCard = review.page.find(row => row._id === folderSource)
    const urlCard = review.page.find(row => row._id === setupResult.sourceSnapshotId)
    expect(folderCard).toMatchObject({ identity: { origin: 'folder_document', title: 'private-notes.txt' }, rightsStatus: 'unknown', conflictStatus: 'clear', effectiveStatus: 'user_accepted' })
    expect(urlCard).toMatchObject({ identity: { origin: 'user_url', title: 'Source one' }, effectiveStatus: 'user_accepted' })
    expect(JSON.stringify(review)).not.toContain('owners/blueprint')
    expect(JSON.stringify(review)).not.toContain('https://example.com/one')
    expect(JSON.stringify(review)).not.toContain('must be removed')

    await setupResult.owner.mutation(api.learnV2Blueprints.configureBlueprintIntent, {
      blueprintRevisionId: setupResult.blueprintRevisionId,
      expectedBlueprintRecordRevision: 2,
      desiredOutcome: 'Map what these private notes can and cannot currently support.',
      mode: 'understand',
      desiredDepth: 'overview',
      sourcePolicy: 'folder_only',
      targetLocalDate: null,
      sessionMinutes: 25,
      idempotencyKey: 'folder-only-intent',
    })
    process.env.LEARN_V2_BLUEPRINT_PROVIDER_ENABLED = 'true'
    process.env.LEARN_V2_BLUEPRINT_MODEL = 'openai/test-blueprint'
    process.env.NUXT_CLOUDFLARE_ACCOUNT_ID = 'test-account'
    process.env.NUXT_CLOUDFLARE_AI_SEARCH_INSTANCE = 'test-search'
    process.env.NUXT_CLOUDFLARE_AI_SEARCH_TOKEN = 'test-search-token'
    process.env.NUXT_CLOUDFLARE_AI_GATEWAY_ID = 'test-gateway'
    process.env.NUXT_OPENROUTER_API_KEY = 'test-key'
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        result: {
          data: [{
            attributes: {
              file: {
                userid: identity.tokenIdentifier,
                documentid: String(folderEvidence.documentId),
                contentHash: hash,
                sourceRevision: `sha256:${hash}`,
              },
            },
            content: [{ text: 'Pinned folder evidence supports the bounded capability.', score: 0.9 }],
          }],
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'folder-evidence-response',
        model: 'openai/test-blueprint',
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(providerCandidate()) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200 }))
    try {
      await setupResult.owner.mutation(api.learnV2Blueprints.startBlueprintGeneration, {
        learningVoidId: setupResult.learningVoidId,
        blueprintRevisionId: setupResult.blueprintRevisionId,
        expectedVoidRevision: 1,
        expectedBlueprintRecordRevision: 3,
        idempotencyKey: 'folder-only-evidence-map',
      })
      await setupResult.t.finishAllScheduledFunctions(() => {})
      const map = await setupResult.owner.query(api.learnV2Blueprints.getBlueprintMap, { blueprintRevisionId: setupResult.blueprintRevisionId })
      expect(map?.objectives).toHaveLength(6)
      expect(map?.objectives.every(objective => objective.coverage === 'strong'
        && objective.sourceLinks.every(link => link.evidenceStatus === 'evidence_available'))).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const searchBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { filters: unknown }
      expect(searchBody.filters).toEqual({
        type: 'and',
        filters: [
          { type: 'eq', key: 'userid', value: identity.tokenIdentifier },
          { type: 'or', filters: [{ type: 'eq', key: 'documentid', value: String(folderEvidence.documentId) }] },
        ],
      })
      expect(JSON.stringify(searchBody)).not.toContain('private-notes.txt')
      const requestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { messages: Array<{ content: string }> }
      const modelInput = requestBody.messages.at(-1)?.content ?? ''
      expect(modelInput).toContain('Pinned folder evidence supports the bounded capability.')
      expect(modelInput).not.toContain('Source one')
      expect(modelInput).not.toContain('private-notes.txt')
      expect(modelInput).not.toContain(String(setupResult.sourceSnapshotId))
      expect(modelInput).not.toContain(String(folderSource))
      expect(modelInput).not.toContain(String(folderEvidence.documentId))
      expect(modelInput).not.toContain('folderEvidence')
    }
    finally {
      fetchMock.mockRestore()
      delete process.env.LEARN_V2_BLUEPRINT_PROVIDER_ENABLED
      delete process.env.LEARN_V2_BLUEPRINT_MODEL
      delete process.env.NUXT_CLOUDFLARE_ACCOUNT_ID
      delete process.env.NUXT_CLOUDFLARE_AI_SEARCH_INSTANCE
      delete process.env.NUXT_CLOUDFLARE_AI_SEARCH_TOKEN
      delete process.env.NUXT_CLOUDFLARE_AI_GATEWAY_ID
      delete process.env.NUXT_OPENROUTER_API_KEY
    }
  })

  test('atomically commits a validated map and exposes bounded review data', async () => {
    const setupResult = await setup()
    const started = await startAndBegin(setupResult)

    const committed = await setupResult.t.mutation(internal.learnV2Blueprints.commitBlueprintCandidate, {
      tokenIdentifier: identity.tokenIdentifier,
      jobId: started.job._id,
      leaseToken: started.lease.leaseToken,
      expectedJobRevision: started.running.revision,
      candidate: candidate(setupResult.sourceSnapshotId),
    })

    expect(committed).toMatchObject({ status: 'map_review', replayed: false })
    const map = await setupResult.owner.query(api.learnV2Blueprints.getBlueprintMap, { blueprintRevisionId: setupResult.blueprintRevisionId })
    expect(map).not.toBeNull()
    if (!map) throw new Error('Expected Blueprint map')
    expect(map.milestones).toHaveLength(3)
    expect(map.objectives).toHaveLength(6)
    expect(map.objectives[5]).toMatchObject({ coverage: 'strong', prerequisiteObjectiveIds: [map.objectives[4]?._id] })
    expect(map.blueprint).toMatchObject({ status: 'map_review', generatorVersion: 'test-generator.v1' })
    expect(await setupResult.t.run(ctx => ctx.db.get(setupResult.learningVoidId))).toMatchObject({ status: 'map_review', revision: 2 })
    expect(await setupResult.owner.query(api.learnV2Blueprints.getBlueprintGenerationJob, { jobId: started.job._id })).toMatchObject({ status: 'awaiting_approval' })

    await expect(setupResult.t.mutation(internal.learnV2Blueprints.commitBlueprintCandidate, {
      tokenIdentifier: identity.tokenIdentifier,
      jobId: started.job._id,
      leaseToken: started.lease.leaseToken,
      expectedJobRevision: started.running.revision,
      candidate: candidate(setupResult.sourceSnapshotId),
    })).resolves.toMatchObject({ replayed: true })
  })

  test('does not allow accepted locator-only metadata to substantiate covered objectives', async () => {
    const setupResult = await setup()
    await setupResult.t.run(async (ctx) => {
      const excerpt = await ctx.db.query('learnSourceExcerpts')
        .withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', identity.tokenIdentifier).eq('sourceSnapshotId', setupResult.sourceSnapshotId))
        .unique()
      if (!excerpt) throw new Error('Expected source excerpt')
      await ctx.db.patch(setupResult.sourceSnapshotId, { rightsStatus: 'unknown' })
      await ctx.db.patch(excerpt._id, { rightsStatus: 'unknown', excerpt: undefined })
    })
    const started = await startAndBegin(setupResult, 'locator-only-coverage')
    await expect(setupResult.t.mutation(internal.learnV2Blueprints.commitBlueprintCandidate, {
      tokenIdentifier: identity.tokenIdentifier,
      jobId: started.job._id,
      leaseToken: started.lease.leaseToken,
      expectedJobRevision: started.running.revision,
      candidate: candidate(setupResult.sourceSnapshotId),
    })).rejects.toThrow(/bounded accepted source set|not accepted/)
  })

  test('retains reviewed-source attribution for an explicit evidence gap', async () => {
    const setupResult = await setup()
    const gapSourceId = await setupResult.t.run(async (ctx) => {
      const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', {
        userId: identity.tokenIdentifier,
        learningVoidId: setupResult.learningVoidId,
        origin: 'user_url',
        externalKey: 'conflicting-gap-source',
        title: 'Conflicting gap source',
      })
      return await ctx.db.insert('learnSourceSnapshots', {
        userId: identity.tokenIdentifier,
        sourceIdentityId,
        learningVoidId: setupResult.learningVoidId,
        blueprintRevisionId: setupResult.blueprintRevisionId,
        revision: 1,
        recordRevision: 3,
        status: 'evaluated',
        effectiveStatus: 'evaluated',
        rightsStatus: 'permitted',
        conflictStatus: 'unresolved',
        createdAt: 1,
        updatedAt: 1,
      })
    })
    const started = await startAndBegin(setupResult, 'explicit-gap-attribution')
    const value = candidate(setupResult.sourceSnapshotId)
    value.objectives[0] = {
      ...value.objectives[0]!,
      coverage: 'gap',
      gapReason: 'The reviewed sources conflict on this capability.',
      sourceSnapshotIds: [],
      gapSourceSnapshotIds: [gapSourceId],
    }
    await setupResult.t.mutation(internal.learnV2Blueprints.commitBlueprintCandidate, {
      tokenIdentifier: identity.tokenIdentifier,
      jobId: started.job._id,
      leaseToken: started.lease.leaseToken,
      expectedJobRevision: started.running.revision,
      candidate: value,
    })
    const map = await setupResult.owner.query(api.learnV2Blueprints.getBlueprintMap, { blueprintRevisionId: setupResult.blueprintRevisionId })
    expect(map?.objectives[0]).toMatchObject({
      coverage: 'gap',
      gapReason: 'The reviewed sources conflict on this capability.',
      sourceLinks: [{ sourceSnapshotId: gapSourceId, coverage: 'gap', evidenceStatus: 'evidence_unavailable' }],
    })
  })

  test('runs public admission through the scheduled approved provider boundary', async () => {
    const setupResult = await setup()
    process.env.LEARN_V2_BLUEPRINT_PROVIDER_ENABLED = 'true'
    process.env.LEARN_V2_BLUEPRINT_MODEL = 'openai/test-blueprint'
    process.env.NUXT_CLOUDFLARE_ACCOUNT_ID = 'test-account'
    process.env.NUXT_CLOUDFLARE_AI_GATEWAY_ID = 'test-gateway'
    process.env.NUXT_OPENROUTER_API_KEY = 'test-key'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      id: 'blueprint-response',
      model: 'openai/test-blueprint',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(providerCandidate()) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200 }))
    try {
      const job = await setupResult.owner.mutation(api.learnV2Blueprints.startBlueprintGeneration, {
        learningVoidId: setupResult.learningVoidId,
        blueprintRevisionId: setupResult.blueprintRevisionId,
        expectedVoidRevision: 1,
        expectedBlueprintRecordRevision: 1,
        idempotencyKey: 'scheduled-provider',
      })
      await setupResult.t.finishAllScheduledFunctions(() => {})
      expect(await setupResult.owner.query(api.learnV2Blueprints.getBlueprintGenerationJob, { jobId: job._id })).toMatchObject({ status: 'awaiting_approval' })
      expect(await setupResult.owner.query(api.learnV2Blueprints.getBlueprintMap, { blueprintRevisionId: setupResult.blueprintRevisionId })).toMatchObject({
        blueprint: {
          status: 'map_review',
          generatorVersion: 'learn-v2.blueprint-generator.v1',
          generationProvider: 'openrouter_via_cloudflare_ai_gateway',
          generationModel: 'openai/test-blueprint',
          generationRequestId: 'blueprint-response',
        },
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const request = fetchMock.mock.calls[0]?.[1]
      const body = JSON.parse(String(request?.body)) as {
        messages: Array<{ content: string }>
        response_format: { type: string, json_schema: { strict: boolean, schema: { additionalProperties: boolean } } }
        provider: { require_parameters: boolean, allow_fallbacks: boolean }
      }
      expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true, schema: { additionalProperties: false } } })
      expect(body.provider).toEqual({ require_parameters: true, allow_fallbacks: false })
      expect(body.messages.at(-1)?.content).toContain('source-001')
      expect(body.messages.at(-1)?.content).toContain('folder_plus_web')
      expect(body.messages.at(-1)?.content).not.toContain(String(setupResult.sourceSnapshotId))
    }
    finally {
      fetchMock.mockRestore()
      delete process.env.LEARN_V2_BLUEPRINT_PROVIDER_ENABLED
      delete process.env.LEARN_V2_BLUEPRINT_MODEL
      delete process.env.NUXT_CLOUDFLARE_ACCOUNT_ID
      delete process.env.NUXT_CLOUDFLARE_AI_GATEWAY_ID
      delete process.env.NUXT_OPENROUTER_API_KEY
    }
  })

  test('distinguishes a known pre-dispatch failure from an ambiguous provider outcome', async () => {
    const unavailable = await setup()
    process.env.LEARN_V2_BLUEPRINT_PROVIDER_ENABLED = 'true'
    process.env.LEARN_V2_BLUEPRINT_MODEL = 'openai/test-blueprint'
    delete process.env.NUXT_CLOUDFLARE_ACCOUNT_ID
    delete process.env.CF_ACCOUNT_ID
    delete process.env.NUXT_CLOUDFLARE_AI_GATEWAY_ID
    delete process.env.CLOUDFLARE_AI_GATEWAY_ID
    delete process.env.NUXT_OPENROUTER_API_KEY
    delete process.env.OPENROUTER_API_KEY
    try {
      const knownFailure = await unavailable.owner.mutation(api.learnV2Blueprints.startBlueprintGeneration, {
        learningVoidId: unavailable.learningVoidId,
        blueprintRevisionId: unavailable.blueprintRevisionId,
        expectedVoidRevision: 1,
        expectedBlueprintRecordRevision: 1,
        idempotencyKey: 'missing-provider-config',
      })
      await unavailable.t.finishAllScheduledFunctions(() => {})
      expect(await unavailable.t.run(ctx => ctx.db.get(knownFailure._id))).toMatchObject({ status: 'blocked', terminalReason: 'provider_unavailable' })

      process.env.NUXT_CLOUDFLARE_ACCOUNT_ID = 'test-account'
      process.env.NUXT_CLOUDFLARE_AI_GATEWAY_ID = 'test-gateway'
      process.env.NUXT_OPENROUTER_API_KEY = 'test-key'
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('network outcome unknown'))
      try {
        const ambiguous = await unavailable.owner.mutation(api.learnV2Blueprints.startBlueprintGeneration, {
          learningVoidId: unavailable.learningVoidId,
          blueprintRevisionId: unavailable.blueprintRevisionId,
          expectedVoidRevision: 1,
          expectedBlueprintRecordRevision: 1,
          idempotencyKey: 'ambiguous-provider-call',
        })
        await unavailable.t.finishAllScheduledFunctions(() => {})
        expect(await unavailable.t.run(ctx => ctx.db.get(ambiguous._id))).toMatchObject({ status: 'blocked', terminalReason: 'provider_outcome_unknown' })
        await expect(unavailable.owner.mutation(api.learnV2Blueprints.startBlueprintGeneration, {
          learningVoidId: unavailable.learningVoidId,
          blueprintRevisionId: unavailable.blueprintRevisionId,
          expectedVoidRevision: 1,
          expectedBlueprintRecordRevision: 1,
          idempotencyKey: 'blocked-after-ambiguous',
        })).rejects.toThrow(/unresolved provider outcome/)
      }
      finally {
        fetchMock.mockRestore()
      }
    }
    finally {
      delete process.env.LEARN_V2_BLUEPRINT_PROVIDER_ENABLED
      delete process.env.LEARN_V2_BLUEPRINT_MODEL
      delete process.env.NUXT_CLOUDFLARE_ACCOUNT_ID
      delete process.env.NUXT_CLOUDFLARE_AI_GATEWAY_ID
      delete process.env.NUXT_OPENROUTER_API_KEY
    }
  })

  test('rejects invalid candidate atomically and binds commit replay to its exact candidate', async () => {
    const setupResult = await setup()
    const started = await startAndBegin(setupResult, 'atomic-invalid')
    const invalid = candidate(setupResult.sourceSnapshotId)
    invalid.objectives[0]!.sourceSnapshotIds = []
    await expect(setupResult.t.mutation(internal.learnV2Blueprints.commitBlueprintCandidate, {
      tokenIdentifier: identity.tokenIdentifier,
      jobId: started.job._id,
      leaseToken: started.lease.leaseToken,
      expectedJobRevision: started.running.revision,
      candidate: invalid,
    })).rejects.toThrow(/evidence/)
    expect(await setupResult.t.run(async ctx => ({
      milestones: await ctx.db.query('learnMilestones').withIndex('by_userId', q => q.eq('userId', identity.tokenIdentifier)).collect(),
      objectives: await ctx.db.query('learnObjectives').withIndex('by_userId', q => q.eq('userId', identity.tokenIdentifier)).collect(),
    }))).toEqual({ milestones: [], objectives: [] })
    await setupResult.t.mutation(internal.learnV2Blueprints.commitBlueprintCandidate, {
      tokenIdentifier: identity.tokenIdentifier,
      jobId: started.job._id,
      leaseToken: started.lease.leaseToken,
      expectedJobRevision: started.running.revision,
      candidate: candidate(setupResult.sourceSnapshotId),
    })
    const changed = candidate(setupResult.sourceSnapshotId)
    changed.objectives[0]!.title = 'A different replay'
    await expect(setupResult.t.mutation(internal.learnV2Blueprints.commitBlueprintCandidate, {
      tokenIdentifier: identity.tokenIdentifier,
      jobId: started.job._id,
      leaseToken: started.lease.leaseToken,
      expectedJobRevision: started.running.revision,
      candidate: changed,
    })).rejects.toThrow(/candidate mismatch/)
  })

  test('terminalizes stale pre-dispatch work and projects deleted evidence as an effective gap', async () => {
    const setupResult = await setup()
    const started = await startAndBegin(setupResult, 'deleted-evidence')
    await setupResult.t.mutation(internal.learnV2Blueprints.commitBlueprintCandidate, {
      tokenIdentifier: identity.tokenIdentifier,
      jobId: started.job._id,
      leaseToken: started.lease.leaseToken,
      expectedJobRevision: started.running.revision,
      candidate: candidate(setupResult.sourceSnapshotId),
    })
    await setupResult.owner.mutation(api.learnV2Sources.markUnavailable, {
      sourceSnapshotId: setupResult.sourceSnapshotId,
      expectedRevision: 4,
      idempotencyKey: 'delete-after-review',
      reason: 'source_deleted',
    })
    const map = await setupResult.owner.query(api.learnV2Blueprints.getBlueprintMap, { blueprintRevisionId: setupResult.blueprintRevisionId })
    expect(map?.objectives[0]).toMatchObject({ coverage: 'gap', storedCoverage: 'strong', gapReason: 'Accepted evidence is no longer available.' })
    expect(map?.objectives[0]?.sourceLinks[0]).toMatchObject({ evidenceStatus: 'evidence_unavailable' })
    expect(map?.blueprint.recordRevision).toBe(2)

    const stale = await setup()
    const job = await stale.owner.mutation(api.learnV2Blueprints.startBlueprintGeneration, {
      learningVoidId: stale.learningVoidId,
      blueprintRevisionId: stale.blueprintRevisionId,
      expectedVoidRevision: 1,
      expectedBlueprintRecordRevision: 1,
      idempotencyKey: 'stale-before-dispatch',
    })
    const lease = await stale.t.mutation(internal.learnV2Blueprints.leaseBlueprintGeneration, { tokenIdentifier: identity.tokenIdentifier, jobId: job._id, expectedRevision: 1 })
    if (lease.kind !== 'leased') throw new Error('Expected lease')
    await stale.t.run(ctx => ctx.db.patch(stale.learningVoidId, { revision: 2 }))
    await expect(stale.t.mutation(internal.learnV2Blueprints.beginBlueprintGeneration, {
      tokenIdentifier: identity.tokenIdentifier,
      jobId: job._id,
      leaseToken: lease.leaseToken,
      expectedRevision: lease.revision,
    })).resolves.toMatchObject({ status: 'blocked', reason: 'input_revision_conflict' })
  })

  test('rejects a 65th accepted source instead of silently truncating Blueprint evidence', async () => {
    const setupResult = await setup()
    for (let index = 2; index <= 64; index += 1) {
      await insertAcceptedSource(setupResult.t, setupResult.learningVoidId, setupResult.blueprintRevisionId, `cap-${index}`)
    }
    const evaluatedSource = await setupResult.t.run(async (ctx) => {
      const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', {
        userId: identity.tokenIdentifier,
        learningVoidId: setupResult.learningVoidId,
        origin: 'user_url',
        externalKey: 'source-over-cap',
        canonicalUrl: 'https://example.com/source-over-cap',
        title: 'Source over cap',
      })
      return await ctx.db.insert('learnSourceSnapshots', {
        userId: identity.tokenIdentifier,
        sourceIdentityId,
        learningVoidId: setupResult.learningVoidId,
        blueprintRevisionId: setupResult.blueprintRevisionId,
        revision: 1,
        recordRevision: 3,
        status: 'evaluated',
        effectiveStatus: 'evaluated',
        rightsStatus: 'permitted',
        conflictStatus: 'clear',
        createdAt: 1,
      })
    })

    await expect(setupResult.owner.mutation(api.learnV2Sources.acceptSource, {
      sourceSnapshotId: evaluatedSource,
      expectedRevision: 3,
      idempotencyKey: 'reject-source-over-cap',
    })).rejects.toThrow(/maximum accepted sources/)
  })

  test('freezes source membership after map review', async () => {
    const setupResult = await setup()
    const pendingSource = await setupResult.t.run(async (ctx) => {
      const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', {
        userId: identity.tokenIdentifier,
        learningVoidId: setupResult.learningVoidId,
        origin: 'user_url',
        externalKey: 'pending-source',
        canonicalUrl: 'https://example.com/pending',
        title: 'Pending source',
      })
      return await ctx.db.insert('learnSourceSnapshots', {
        userId: identity.tokenIdentifier,
        sourceIdentityId,
        learningVoidId: setupResult.learningVoidId,
        blueprintRevisionId: setupResult.blueprintRevisionId,
        revision: 1,
        recordRevision: 1,
        status: 'candidate',
        effectiveStatus: 'candidate',
        createdAt: 1,
      })
    })
    const evaluatedSource = await setupResult.t.run(async (ctx) => {
      const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', {
        userId: identity.tokenIdentifier,
        learningVoidId: setupResult.learningVoidId,
        origin: 'user_url',
        externalKey: 'late-source',
        title: 'Late source',
      })
      return await ctx.db.insert('learnSourceSnapshots', {
        userId: identity.tokenIdentifier,
        sourceIdentityId,
        learningVoidId: setupResult.learningVoidId,
        blueprintRevisionId: setupResult.blueprintRevisionId,
        revision: 1,
        recordRevision: 3,
        status: 'evaluated',
        effectiveStatus: 'evaluated',
        rightsStatus: 'permitted',
        conflictStatus: 'clear',
        createdAt: 1,
      })
    })
    const started = await startAndBegin(setupResult, 'freeze-membership')
    await setupResult.t.mutation(internal.learnV2Blueprints.commitBlueprintCandidate, {
      tokenIdentifier: identity.tokenIdentifier,
      jobId: started.job._id,
      leaseToken: started.lease.leaseToken,
      expectedJobRevision: started.running.revision,
      candidate: candidate(setupResult.sourceSnapshotId),
    })
    await expect(setupResult.owner.mutation(api.learnV2Sources.acceptSource, {
      sourceSnapshotId: evaluatedSource,
      expectedRevision: 3,
      idempotencyKey: 'late-accept',
    })).rejects.toThrow(/immutable after source review/)
    await expect(setupResult.t.mutation(internal.learnV2Sources.replayOrAcquireFetch, {
      tokenIdentifier: identity.tokenIdentifier,
      sourceSnapshotId: pendingSource,
      expectedRevision: 1,
      idempotencyKey: 'fetch-after-map-review',
    })).rejects.toThrow(/source review is closed/)
  })

  test('replays admission and rejects a changed accepted-source set before any map write', async () => {
    const setupResult = await setup()
    const args = {
      learningVoidId: setupResult.learningVoidId,
      blueprintRevisionId: setupResult.blueprintRevisionId,
      expectedVoidRevision: 1,
      expectedBlueprintRecordRevision: 1,
      idempotencyKey: 'source-race',
    }
    const first = await setupResult.owner.mutation(api.learnV2Blueprints.startBlueprintGeneration, args)
    expect(await setupResult.owner.mutation(api.learnV2Blueprints.startBlueprintGeneration, args)).toEqual(first)
    const lease = await setupResult.t.mutation(internal.learnV2Blueprints.leaseBlueprintGeneration, {
      tokenIdentifier: identity.tokenIdentifier,
      jobId: first._id,
      expectedRevision: 1,
    })
    if (lease.kind !== 'leased') throw new Error('Expected Blueprint lease')
    const running = await setupResult.t.mutation(internal.learnV2Blueprints.beginBlueprintGeneration, {
      tokenIdentifier: identity.tokenIdentifier,
      jobId: first._id,
      leaseToken: lease.leaseToken,
      expectedRevision: lease.revision,
    })
    await insertAcceptedSource(setupResult.t, setupResult.learningVoidId, setupResult.blueprintRevisionId, 'two')

    await expect(setupResult.t.mutation(internal.learnV2Blueprints.commitBlueprintCandidate, {
      tokenIdentifier: identity.tokenIdentifier,
      jobId: first._id,
      leaseToken: lease.leaseToken,
      expectedJobRevision: running.revision,
      candidate: candidate(setupResult.sourceSnapshotId),
    })).rejects.toThrow(/source set changed/)
    const stored = await setupResult.t.run(async (ctx) => ({
      milestones: await ctx.db.query('learnMilestones').withIndex('by_userId', q => q.eq('userId', identity.tokenIdentifier)).collect(),
      objectives: await ctx.db.query('learnObjectives').withIndex('by_userId', q => q.eq('userId', identity.tokenIdentifier)).collect(),
    }))
    expect(stored).toEqual({ milestones: [], objectives: [] })
  })

  test('fails closed for unaccepted evidence, stale revisions, and another owner', async () => {
    const setupResult = await setup()
    const otherIdentity = { tokenIdentifier: 'https://auth.example.com|blueprint-other', name: 'Other' }
    const other = setupResult.t.withIdentity(otherIdentity)
    await other.mutation(api.users.upsertUser, {})
    await setupResult.t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: otherIdentity.tokenIdentifier, enabled: true })
    expect(await other.query(api.learnV2Blueprints.getBlueprintMap, { blueprintRevisionId: setupResult.blueprintRevisionId })).toBeNull()
    await expect(other.mutation(api.learnV2Blueprints.startBlueprintGeneration, {
      learningVoidId: setupResult.learningVoidId,
      blueprintRevisionId: setupResult.blueprintRevisionId,
      expectedVoidRevision: 1,
      expectedBlueprintRecordRevision: 1,
      idempotencyKey: 'other',
    })).rejects.toThrow(/not found/)

    await setupResult.t.run(ctx => ctx.db.patch(setupResult.sourceSnapshotId, { effectiveStatus: 'unavailable' }))
    await expect(setupResult.owner.mutation(api.learnV2Blueprints.startBlueprintGeneration, {
      learningVoidId: setupResult.learningVoidId,
      blueprintRevisionId: setupResult.blueprintRevisionId,
      expectedVoidRevision: 1,
      expectedBlueprintRecordRevision: 1,
      idempotencyKey: 'no-evidence',
    })).rejects.toThrow(/accepted source/i)
  })

  test('admits legacy accepted status and enforces the bounded attempt limit', async () => {
    const setupResult = await setup()
    await setupResult.t.run(ctx => ctx.db.patch(setupResult.sourceSnapshotId, { effectiveStatus: undefined }))
    const job = await setupResult.owner.mutation(api.learnV2Blueprints.startBlueprintGeneration, {
      learningVoidId: setupResult.learningVoidId,
      blueprintRevisionId: setupResult.blueprintRevisionId,
      expectedVoidRevision: 1,
      expectedBlueprintRecordRevision: 1,
      idempotencyKey: 'legacy-accepted',
    })
    await setupResult.t.run(ctx => ctx.db.patch(job._id, { status: 'leased', attempts: 2, leaseExpiresAt: 0 }))
    await expect(setupResult.t.mutation(internal.learnV2Blueprints.leaseBlueprintGeneration, {
      tokenIdentifier: identity.tokenIdentifier,
      jobId: job._id,
      expectedRevision: 1,
    })).resolves.toMatchObject({ kind: 'blocked', reason: 'attempt_limit_exhausted' })
    expect(await setupResult.owner.query(api.learnV2Blueprints.getBlueprintGenerationJob, { jobId: job._id })).toMatchObject({ status: 'failed' })
  })

  test('terminalizes revoked access before dispatch', async () => {
    const setupResult = await setup()
    const job = await setupResult.owner.mutation(api.learnV2Blueprints.startBlueprintGeneration, {
      learningVoidId: setupResult.learningVoidId,
      blueprintRevisionId: setupResult.blueprintRevisionId,
      expectedVoidRevision: 1,
      expectedBlueprintRecordRevision: 1,
      idempotencyKey: 'revoked-before-dispatch',
    })
    await setupResult.t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: false })
    await expect(setupResult.t.mutation(internal.learnV2Blueprints.leaseBlueprintGeneration, {
      tokenIdentifier: identity.tokenIdentifier,
      jobId: job._id,
      expectedRevision: 1,
    })).resolves.toMatchObject({ kind: 'blocked', reason: 'access_revoked' })
    expect(await setupResult.t.run(ctx => ctx.db.get(job._id))).toMatchObject({ status: 'blocked', terminalReason: 'access_revoked' })
  })

  test('recovers an expired running lease into manual provider-outcome review', async () => {
    const setupResult = await setup()
    const jobId = await setupResult.t.run(async (ctx) => {
      for (let index = 0; index < 16; index++) {
        await ctx.db.insert('learnJobs', {
          userId: identity.tokenIdentifier,
          learningVoidId: setupResult.learningVoidId,
          type: 'unrelated_job',
          status: 'running',
          revision: 1,
          idempotencyKey: `unrelated-expired-${index}`,
          leaseExpiresAt: 0,
        })
      }
      return await ctx.db.insert('learnJobs', {
      userId: identity.tokenIdentifier,
      learningVoidId: setupResult.learningVoidId,
      blueprintRevisionId: setupResult.blueprintRevisionId,
      type: 'blueprint_generation',
      status: 'running',
      revision: 3,
      idempotencyKey: 'expired-running-provider',
      attempts: 1,
      leaseToken: 'expired-lease',
      leaseExpiresAt: 0,
      checkpoint: 'provider_dispatch_started',
      createdAt: 1,
      updatedAt: 1,
      })
    })
    await expect(setupResult.t.mutation(internal.learnV2Blueprints.recoverExpiredBlueprintJobs, {})).resolves.toMatchObject({ processed: 1 })
    expect(await setupResult.t.run(ctx => ctx.db.get(jobId))).toMatchObject({ status: 'blocked', terminalReason: 'provider_outcome_unknown', revision: 4 })
    await expect(setupResult.owner.mutation(api.learnV2Blueprints.startBlueprintGeneration, {
      learningVoidId: setupResult.learningVoidId,
      blueprintRevisionId: setupResult.blueprintRevisionId,
      expectedVoidRevision: 1,
      expectedBlueprintRecordRevision: 1,
      idempotencyKey: 'blocked-by-unknown-outcome',
    })).rejects.toThrow(/unresolved provider outcome/)
    await expect(setupResult.t.mutation(internal.learnV2Blueprints.resolveProviderOutcomeUnknown, {
      tokenIdentifier: identity.tokenIdentifier,
      jobId,
      expectedRevision: 4,
    })).resolves.toMatchObject({ status: 'failed', revision: 5 })

    const preDispatchJobId = await setupResult.t.run(ctx => ctx.db.insert('learnJobs', {
      userId: identity.tokenIdentifier,
      learningVoidId: setupResult.learningVoidId,
      blueprintRevisionId: setupResult.blueprintRevisionId,
      type: 'blueprint_generation',
      status: 'running',
      revision: 3,
      idempotencyKey: 'expired-pre-dispatch',
      attempts: 1,
      leaseToken: 'expired-pre-dispatch-lease',
      leaseExpiresAt: 0,
      checkpoint: 'preparing_input',
    }))
    await setupResult.t.mutation(internal.learnV2Blueprints.recoverExpiredBlueprintJobs, {})
    expect(await setupResult.t.run(ctx => ctx.db.get(preDispatchJobId))).toMatchObject({ status: 'queued', revision: 4 })
    expect((await setupResult.t.run(ctx => ctx.db.get(preDispatchJobId)))?.checkpoint).toBeUndefined()
  })

  test('enforces the combined current and legacy accepted-source cap and exact Void scope', async () => {
    const overflow = await setup()
    for (let index = 0; index < 64; index++) {
      const sourceId = await insertAcceptedSource(overflow.t, overflow.learningVoidId, overflow.blueprintRevisionId, `legacy-${index}`)
      await overflow.t.run(ctx => ctx.db.patch(sourceId, { effectiveStatus: undefined }))
    }
    await expect(overflow.owner.mutation(api.learnV2Blueprints.startBlueprintGeneration, {
      learningVoidId: overflow.learningVoidId,
      blueprintRevisionId: overflow.blueprintRevisionId,
      expectedVoidRevision: 1,
      expectedBlueprintRecordRevision: 1,
      idempotencyKey: 'accepted-overflow',
    })).rejects.toThrow(/too many accepted sources/)

    const mismatch = await setup()
    const otherVoidId = await mismatch.t.run(ctx => ctx.db.insert('learningVoids', {
      userId: identity.tokenIdentifier,
      folderId: mismatch.folderId,
      title: 'Other Void',
      status: 'source_review',
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    }))
    await mismatch.t.run(async (ctx) => {
      const source = await ctx.db.get(mismatch.sourceSnapshotId)
      if (!source) throw new Error('Missing source')
      await ctx.db.patch(source._id, { learningVoidId: otherVoidId })
      await ctx.db.patch(source.sourceIdentityId, { learningVoidId: otherVoidId })
    })
    await expect(mismatch.owner.mutation(api.learnV2Blueprints.startBlueprintGeneration, {
      learningVoidId: mismatch.learningVoidId,
      blueprintRevisionId: mismatch.blueprintRevisionId,
      expectedVoidRevision: 1,
      expectedBlueprintRecordRevision: 1,
      idempotencyKey: 'void-mismatch',
    })).rejects.toThrow(/no longer eligible/)
  })

  test('bounds a large unavailable folder inventory without blocking accepted evidence', async () => {
    const setupResult = await setup()
    await setupResult.t.run(async (ctx) => {
      for (let index = 0; index < 65; index++) {
        const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', {
          userId: identity.tokenIdentifier,
          learningVoidId: setupResult.learningVoidId,
          origin: 'folder_document',
          externalKey: `large-folder-unavailable-${index}`,
        })
        await ctx.db.insert('learnSourceSnapshots', {
          userId: identity.tokenIdentifier,
          sourceIdentityId,
          learningVoidId: setupResult.learningVoidId,
          blueprintRevisionId: setupResult.blueprintRevisionId,
          revision: 1,
          recordRevision: 1,
          status: 'unavailable',
          effectiveStatus: 'unavailable',
          unavailableReason: 'manifest_document_unavailable',
          createdAt: 1,
        })
      }
    })
    await expect(setupResult.owner.mutation(api.learnV2Blueprints.startBlueprintGeneration, {
      learningVoidId: setupResult.learningVoidId,
      blueprintRevisionId: setupResult.blueprintRevisionId,
      expectedVoidRevision: 1,
      expectedBlueprintRecordRevision: 1,
      idempotencyKey: 'large-unavailable-inventory',
    })).resolves.toMatchObject({ status: 'queued' })
  })
})
