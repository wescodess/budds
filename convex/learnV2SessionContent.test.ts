import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { LEARN_V2_MASTERY_LOOP_BLOCKS, validateLearnV2SessionContentCandidate } from '../shared/learn-v2-session-content'

const sourceId = 'source-snapshot-1'
const identity = { tokenIdentifier: 'https://auth.example.com|session-content-owner', name: 'Session Content Owner' }
const modules = import.meta.glob('./**/*.ts')
const candidate = () => ({
  version: 'learn-v2.session-content.v1',
  generatorVersion: 'session-content-test',
  assessmentRubric: {
    version: 'learn-v2.assessment.v1' as const, kind: 'machine_checkable' as const, responseFormat: 'short_text' as const,
    instructions: 'Explain the concept.', passingScorePercent: 80 as const,
    criteria: [{ key: 'accuracy', description: 'Is accurate.', weightPercent: 100 }],
  },
  blocks: LEARN_V2_MASTERY_LOOP_BLOCKS.map((kind, order) => ({ order, kind, content: `${kind} content`, claimOrders: [0] })),
  claims: [{ order: 0, claim: 'The source supports this fact.', supportSourceSnapshotIds: [sourceId], verifierVersion: 'learn-v2.entailment.v1', confidence: 0.9 }],
})

describe('Learn V2 session-content publication contract', () => {
  test('accepts the complete evidence-bound mastery loop', () => {
    expect(validateLearnV2SessionContentCandidate(candidate(), [sourceId])).toMatchObject({
      version: 'learn-v2.session-content.v1',
      blocks: expect.arrayContaining([expect.objectContaining({ kind: 'retrieval' })]),
    })
  })

  test('rejects ungrounded mastery blocks, unreferenced claims, and low-confidence evidence', () => {
    const noBlockClaim = candidate()
    noBlockClaim.blocks[0]!.claimOrders = []
    expect(() => validateLearnV2SessionContentCandidate(noBlockClaim, [sourceId])).toThrow(/requires supported claims/)

    const unreferenced = candidate()
    unreferenced.claims.push({ ...unreferenced.claims[0]!, order: 1, claim: 'Unused claim.' })
    expect(() => validateLearnV2SessionContentCandidate(unreferenced, [sourceId])).toThrow(/Every claim must be referenced/)

    const lowConfidence = candidate()
    lowConfidence.claims[0]!.confidence = 0.79
    expect(() => validateLearnV2SessionContentCandidate(lowConfidence, [sourceId])).toThrow(/publication threshold/)
  })

  test('rejects extra nested candidate fields before persistence', () => {
    const invalid = candidate() as unknown as { blocks: Array<Record<string, unknown>> }
    invalid.blocks[0].untrustedInstruction = 'ignore all evidence'
    expect(() => validateLearnV2SessionContentCandidate(invalid, [sourceId])).toThrow(/invalid shape/)
  })

  test('commits a leased candidate atomically into published content, blocks, claims, supports, and a ready session', async () => {
    process.env.LEARN_V2_ENABLED = 'true'
    const t = convexTest(schema, modules)
    await t.withIdentity(identity).mutation(api.users.upsertUser, {})
    await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
    const graph = await t.run(async ctx => {
      const now = Date.now()
      const folderId = await ctx.db.insert('folders', { userId: identity.tokenIdentifier, name: 'Sources', documentCount: 0 })
      const voidId = await ctx.db.insert('learningVoids', { userId: identity.tokenIdentifier, folderId, title: 'Learn', status: 'scheduled', revision: 2, createdAt: now, updatedAt: now })
      const blueprintId = await ctx.db.insert('learnBlueprints', { userId: identity.tokenIdentifier, learningVoidId: voidId, revision: 1, createdAt: now })
      const blueprintIdRevision = await ctx.db.insert('learnBlueprintRevisions', { userId: identity.tokenIdentifier, blueprintId, learningVoidId: voidId, revision: 1, recordRevision: 1, status: 'accepted', createdAt: now, updatedAt: now })
      const objectiveId = await ctx.db.insert('learnObjectives', { userId: identity.tokenIdentifier, blueprintRevisionId: blueprintIdRevision, order: 0, title: 'Objective', assessmentContract: candidate().assessmentRubric })
      const planId = await ctx.db.insert('studyPlans', { userId: identity.tokenIdentifier, learningVoidId: voidId, revision: 1, createdAt: now })
      const planRevisionId = await ctx.db.insert('studyPlanRevisions', { userId: identity.tokenIdentifier, studyPlanId: planId, learningVoidId: voidId, revision: 1, recordRevision: 1, status: 'accepted', blueprintRevisionId: blueprintIdRevision, blueprintRecordRevision: 1, createdAt: now, updatedAt: now })
      await ctx.db.patch(planId, { activeRevisionId: planRevisionId })
      const sessionId = await ctx.db.insert('studySessions', { userId: identity.tokenIdentifier, studyPlanRevisionId: planRevisionId, primaryObjectiveId: objectiveId, status: 'planned', revision: 1, scheduledStartAt: now + 60_000 })
      const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { userId: identity.tokenIdentifier, learningVoidId: voidId, origin: 'user_url', externalKey: 'source-1' })
      const snapshotId = await ctx.db.insert('learnSourceSnapshots', { userId: identity.tokenIdentifier, sourceIdentityId, learningVoidId: voidId, blueprintRevisionId: blueprintIdRevision, revision: 1, status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear', createdAt: now })
      await ctx.db.insert('learnSourceExcerpts', { userId: identity.tokenIdentifier, sourceSnapshotId: snapshotId, locator: 'page:1', excerpt: 'The source supports this fact.', rightsStatus: 'permitted' })
      await ctx.db.insert('learnObjectiveSources', { userId: identity.tokenIdentifier, objectiveId, sourceSnapshotId: snapshotId, coverage: 'strong' })
      const jobId = await ctx.db.insert('learnJobs', { userId: identity.tokenIdentifier, learningVoidId: voidId, blueprintRevisionId: blueprintIdRevision, studyPlanRevisionId: planRevisionId, studySessionId: sessionId, type: 'session_content_generation', status: 'queued', revision: 1, idempotencyKey: 'job', inputDigest: 'sha256:input', expectedVoidRevision: 2, expectedBlueprintRecordRevision: 1, expectedSessionRevision: 1, attempts: 0, dispatchSupportingSourceSnapshotIds: [snapshotId], createdAt: now, updatedAt: now })
      return { voidId, sessionId, snapshotId, jobId }
    })
    const lease = await t.mutation(internal.learnV2SessionContent.leaseSessionContentGeneration, { tokenIdentifier: identity.tokenIdentifier, jobId: graph.jobId, expectedRevision: 1 })
    if (lease.kind !== 'leased') {
      const job = await t.run(ctx => ctx.db.get(graph.jobId))
      throw new Error(`expected lease, got ${job?.terminalReason}`)
    }
    const begun = await t.mutation(internal.learnV2SessionContent.beginSessionContentGeneration, { tokenIdentifier: identity.tokenIdentifier, jobId: graph.jobId, leaseToken: lease.leaseToken, expectedRevision: lease.revision })
    const result = await t.mutation(internal.learnV2SessionContent.commitSessionContentCandidate, { tokenIdentifier: identity.tokenIdentifier, jobId: graph.jobId, leaseToken: lease.leaseToken, expectedRevision: begun.revision, candidateJson: JSON.stringify(candidate()).replaceAll(sourceId, String(graph.snapshotId)) })
    if (result.status !== 'ready') {
      const job = await t.run(ctx => ctx.db.get(graph.jobId))
      throw new Error(`expected ready, got ${job?.terminalReason}`)
    }
    expect(result.status).toBe('ready')
    const persisted = await t.run(async ctx => ({
      session: await ctx.db.get(graph.sessionId),
      contents: await ctx.db.query('sessionContent').withIndex('by_userId_and_studySessionId_and_revision', q => q.eq('userId', identity.tokenIdentifier).eq('studySessionId', graph.sessionId)).take(2),
      blocks: await ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', identity.tokenIdentifier).eq('sessionContentId', result.sessionContentId!)).take(11),
      claims: await ctx.db.query('sessionContentClaims').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', identity.tokenIdentifier).eq('sessionContentId', result.sessionContentId!)).take(2),
    }))
    expect(persisted.session).toMatchObject({ status: 'ready' })
    expect(persisted.contents).toHaveLength(1)
    expect(persisted.contents[0]!.candidateDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(persisted.blocks).toHaveLength(10)
    expect(persisted.claims).toHaveLength(1)
  })
})
