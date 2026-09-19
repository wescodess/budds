import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { LEARN_V2_MASTERY_LOOP_BLOCKS, learnV2SessionCandidateFailureReason, normalizeLearnV2SessionContentProviderOutput, validateLearnV2EntailmentDecisions, validateLearnV2SessionContentCandidate } from '../shared/learn-v2-session-content'

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
  claims: [{ order: 0, claim: 'The source supports this fact.', supportSourceSnapshotIds: [sourceId] }],
})

function verifierDecisionsJson(snapshotId: Id<'learnSourceSnapshots'>, excerptId: Id<'learnSourceExcerpts'>, input = candidate()) {
  return JSON.stringify({ version: 'learn-v2.entailment.v2', decisions: input.claims.flatMap(claim => claim.supportSourceSnapshotIds.map(sourceSnapshotId => ({ claimOrder: claim.order, sourceSnapshotId: sourceSnapshotId === sourceId ? String(snapshotId) : sourceSnapshotId, sourceExcerptId: String(excerptId), decision: 'entailed', verifierVersion: 'learn-v2.entailment.v2', confidence: 0.9 }))) })
}

async function seedGenerationGraph() {
  process.env.LEARN_V2_ENABLED = 'true'
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(identity)
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
  const graph = await t.run(async ctx => {
    const now = Date.now()
    const folderId = await ctx.db.insert('folders', { userId: identity.tokenIdentifier, name: 'Sources', documentCount: 0 })
    const voidId = await ctx.db.insert('learningVoids', { userId: identity.tokenIdentifier, folderId, title: 'Learn', status: 'scheduled', revision: 2, createdAt: now, updatedAt: now })
    const blueprintId = await ctx.db.insert('learnBlueprints', { userId: identity.tokenIdentifier, learningVoidId: voidId, revision: 1, createdAt: now })
    const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { userId: identity.tokenIdentifier, blueprintId, learningVoidId: voidId, revision: 1, recordRevision: 1, status: 'accepted', createdAt: now, updatedAt: now })
    const objectiveId = await ctx.db.insert('learnObjectives', { userId: identity.tokenIdentifier, blueprintRevisionId, order: 0, title: 'Objective', assessmentContract: candidate().assessmentRubric })
    const planId = await ctx.db.insert('studyPlans', { userId: identity.tokenIdentifier, learningVoidId: voidId, revision: 1, createdAt: now })
    const planRevisionId = await ctx.db.insert('studyPlanRevisions', { userId: identity.tokenIdentifier, studyPlanId: planId, learningVoidId: voidId, revision: 1, recordRevision: 1, status: 'accepted', blueprintRevisionId, blueprintRecordRevision: 1, createdAt: now, updatedAt: now })
    await ctx.db.patch(planId, { activeRevisionId: planRevisionId })
    const sessionId = await ctx.db.insert('studySessions', { userId: identity.tokenIdentifier, studyPlanRevisionId: planRevisionId, primaryObjectiveId: objectiveId, status: 'planned', revision: 1, scheduledStartAt: now + 60_000 })
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { userId: identity.tokenIdentifier, learningVoidId: voidId, origin: 'user_url', externalKey: 'source-1' })
    const snapshotId = await ctx.db.insert('learnSourceSnapshots', { userId: identity.tokenIdentifier, sourceIdentityId, learningVoidId: voidId, blueprintRevisionId, revision: 1, status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear', createdAt: now })
    await ctx.db.insert('learnSourceExcerpts', { userId: identity.tokenIdentifier, sourceSnapshotId: snapshotId, locator: 'page:1', excerpt: 'The source supports this fact.', rightsStatus: 'permitted' })
    await ctx.db.insert('learnObjectiveSources', { userId: identity.tokenIdentifier, objectiveId, sourceSnapshotId: snapshotId, coverage: 'strong' })
    const jobId = await ctx.db.insert('learnJobs', { userId: identity.tokenIdentifier, learningVoidId: voidId, blueprintRevisionId, studyPlanRevisionId: planRevisionId, studySessionId: sessionId, type: 'session_content_generation', status: 'queued', revision: 1, idempotencyKey: 'job', inputDigest: 'sha256:input', expectedVoidRevision: 2, expectedBlueprintRecordRevision: 1, expectedSessionRevision: 1, attempts: 0, dispatchSupportingSourceSnapshotIds: [snapshotId], createdAt: now, updatedAt: now })
    return { planId, planRevisionId, sessionId, snapshotId, excerptId: (await ctx.db.query('learnSourceExcerpts').withIndex('by_userId_and_sourceSnapshotId_and_evidencePurgedAt', q => q.eq('userId', identity.tokenIdentifier).eq('sourceSnapshotId', snapshotId).eq('evidencePurgedAt', undefined)).unique())!._id, jobId }
  })
  return { t, owner, graph }
}

async function leaseAndBegin(t: ReturnType<typeof convexTest>, jobId: Id<'learnJobs'>) {
  const lease = await t.mutation(internal.learnV2SessionContent.leaseSessionContentGeneration, { tokenIdentifier: identity.tokenIdentifier, jobId, expectedRevision: 1 })
  if (lease.kind !== 'leased') throw new Error('expected leased job')
  const begun = await t.mutation(internal.learnV2SessionContent.beginSessionContentGeneration, { tokenIdentifier: identity.tokenIdentifier, jobId, leaseToken: lease.leaseToken, expectedRevision: lease.revision })
  if (begun.status !== 'running') throw new Error('expected running job')
  return { lease, begun }
}

describe('Learn V2 session-content publication contract', () => {
  test('accepts the complete evidence-bound mastery loop', () => {
    expect(validateLearnV2SessionContentCandidate(candidate(), [sourceId])).toMatchObject({
      version: 'learn-v2.session-content.v1',
      blocks: expect.arrayContaining([expect.objectContaining({ kind: 'retrieval' })]),
    })
  })

  test('rejects ungrounded mastery blocks and unreferenced claims', () => {
    const noBlockClaim = candidate()
    noBlockClaim.blocks[0]!.claimOrders = []
    expect(() => validateLearnV2SessionContentCandidate(noBlockClaim, [sourceId])).toThrow(/requires supported claims/)

    const unreferenced = candidate()
    unreferenced.claims.push({ ...unreferenced.claims[0]!, order: 1, claim: 'Unused claim.' })
    expect(() => validateLearnV2SessionContentCandidate(unreferenced, [sourceId])).toThrow(/Every claim must be referenced/)

  })

  test('canonicalizes harmless provider ordering, declared claim orders, and aliases without inventing content', () => {
    const input = candidate()
    input.blocks.reverse()
    input.blocks.forEach(block => { block.claimOrders = [7] })
    input.claims[0]!.order = 7
    input.claims[0]!.supportSourceSnapshotIds = ['source-001']
    input.assessmentRubric.instructions = 'Provider tried to replace the accepted rubric.'
    const authoritativeRubric = candidate().assessmentRubric
    const normalized = normalizeLearnV2SessionContentProviderOutput(input, new Map([['source-001', sourceId]]), authoritativeRubric)

    expect(validateLearnV2SessionContentCandidate(normalized, [sourceId])).toMatchObject({
      assessmentRubric: authoritativeRubric,
      blocks: LEARN_V2_MASTERY_LOOP_BLOCKS.map((kind, order) => expect.objectContaining({ kind, order, claimOrders: [0] })),
      claims: [{ order: 0, supportSourceSnapshotIds: [sourceId] }],
    })
  })

  test('keeps missing, duplicate, and unused provider claim links invalid', () => {
    const missing = candidate()
    missing.blocks[0]!.claimOrders = [7]
    expect(() => validateLearnV2SessionContentCandidate(normalizeLearnV2SessionContentProviderOutput(missing, new Map(), candidate().assessmentRubric), [sourceId])).toThrow(/Every claim must be referenced/)

    const duplicate = candidate()
    duplicate.blocks[0]!.claimOrders = [0, 0]
    expect(() => validateLearnV2SessionContentCandidate(normalizeLearnV2SessionContentProviderOutput(duplicate, new Map(), candidate().assessmentRubric), [sourceId])).toThrow(/claim links must be unique/)

    const unused = candidate()
    unused.claims.push({ order: 1, claim: 'Unused provider claim.', supportSourceSnapshotIds: [sourceId] })
    expect(() => validateLearnV2SessionContentCandidate(normalizeLearnV2SessionContentProviderOutput(unused, new Map(), candidate().assessmentRubric), [sourceId])).toThrow(/Every claim must be referenced/)
  })

  test('records a bounded diagnostic reason for strict provider candidate failures', () => {
    expect(learnV2SessionCandidateFailureReason(new Error('Session content must contain the complete mastery loop in order'))).toBe('provider_output_invalid_block_order')
    expect(learnV2SessionCandidateFailureReason(new Error('Every factual claim requires an accepted source'))).toBe('provider_output_invalid_claim_support')
    expect(learnV2SessionCandidateFailureReason(new Error('unexpected provider shape'))).toBe('provider_output_invalid')
  })

  test('fails closed for hallucinated, low-confidence, incomplete, and mismatched entailment decisions', () => {
    const generated = validateLearnV2SessionContentCandidate(candidate(), [sourceId])
    const evidence = new Map([[sourceId, { sourceExcerptId: 'excerpt-1', excerpt: 'The source supports this fact.' }]])
    const valid = { claimOrder: 0, sourceSnapshotId: sourceId, sourceExcerptId: 'excerpt-1', decision: 'entailed', verifierVersion: 'learn-v2.entailment.v2', confidence: 0.9 }
    expect(() => validateLearnV2EntailmentDecisions({ version: 'learn-v2.entailment.v2', decisions: [{ ...valid, claimOrder: 1 }] }, generated, evidence)).toThrow(/unknown or duplicate/)
    expect(() => validateLearnV2EntailmentDecisions({ version: 'learn-v2.entailment.v2', decisions: [{ ...valid, decision: 'not_entailed' }] }, generated, evidence)).toThrow(/not entailed/)
    expect(() => validateLearnV2EntailmentDecisions({ version: 'learn-v2.entailment.v2', decisions: [{ ...valid, confidence: 0.79 }] }, generated, evidence)).toThrow(/publication threshold/)
    expect(() => validateLearnV2EntailmentDecisions({ version: 'learn-v2.entailment.v2', decisions: [] }, generated, evidence)).toThrow(/incomplete/)
    expect(() => validateLearnV2EntailmentDecisions({ version: 'learn-v2.entailment.v2', decisions: [{ ...valid, sourceExcerptId: 'wrong-excerpt' }] }, generated, evidence)).toThrow(/exact source excerpt/)
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
      const excerptId = await ctx.db.insert('learnSourceExcerpts', { userId: identity.tokenIdentifier, sourceSnapshotId: snapshotId, locator: 'page:1', excerpt: 'The source supports this fact.', rightsStatus: 'permitted' })
      await ctx.db.insert('learnObjectiveSources', { userId: identity.tokenIdentifier, objectiveId, sourceSnapshotId: snapshotId, coverage: 'strong' })
      const jobId = await ctx.db.insert('learnJobs', { userId: identity.tokenIdentifier, learningVoidId: voidId, blueprintRevisionId: blueprintIdRevision, studyPlanRevisionId: planRevisionId, studySessionId: sessionId, type: 'session_content_generation', status: 'queued', revision: 1, idempotencyKey: 'job', inputDigest: 'sha256:input', expectedVoidRevision: 2, expectedBlueprintRecordRevision: 1, expectedSessionRevision: 1, attempts: 0, dispatchSupportingSourceSnapshotIds: [snapshotId], createdAt: now, updatedAt: now })
      return { voidId, sessionId, snapshotId, excerptId, jobId }
    })
    const lease = await t.mutation(internal.learnV2SessionContent.leaseSessionContentGeneration, { tokenIdentifier: identity.tokenIdentifier, jobId: graph.jobId, expectedRevision: 1 })
    if (lease.kind !== 'leased') {
      const job = await t.run(ctx => ctx.db.get(graph.jobId))
      throw new Error(`expected lease, got ${job?.terminalReason}`)
    }
    const begun = await t.mutation(internal.learnV2SessionContent.beginSessionContentGeneration, { tokenIdentifier: identity.tokenIdentifier, jobId: graph.jobId, leaseToken: lease.leaseToken, expectedRevision: lease.revision })
    const generated = candidate()
    const result = await t.mutation(internal.learnV2SessionContent.commitSessionContentCandidate, { tokenIdentifier: identity.tokenIdentifier, jobId: graph.jobId, leaseToken: lease.leaseToken, expectedRevision: begun.revision, candidateJson: JSON.stringify(generated).replaceAll(sourceId, String(graph.snapshotId)), verifierDecisionsJson: verifierDecisionsJson(graph.snapshotId, graph.excerptId, generated) })
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

  test('keeps an invalid candidate wholly unpublished and records a terminal failure', async () => {
    const { t, graph } = await seedGenerationGraph()
    const { lease, begun } = await leaseAndBegin(t, graph.jobId)
    const invalid = candidate()
    invalid.claims[0]!.supportSourceSnapshotIds = []
    const result = await t.mutation(internal.learnV2SessionContent.commitSessionContentCandidate, {
      tokenIdentifier: identity.tokenIdentifier, jobId: graph.jobId, leaseToken: lease.leaseToken,
      expectedRevision: begun.revision, candidateJson: JSON.stringify(invalid).replaceAll(sourceId, String(graph.snapshotId)),
      verifierDecisionsJson: verifierDecisionsJson(graph.snapshotId, graph.excerptId, invalid),
    })
    expect(result).toEqual({ status: 'generation_failed' })
    const rows = await t.run(async ctx => ({
      job: await ctx.db.get(graph.jobId), session: await ctx.db.get(graph.sessionId),
      content: await ctx.db.query('sessionContent').withIndex('by_userId_and_studySessionId_and_revision', q => q.eq('userId', identity.tokenIdentifier).eq('studySessionId', graph.sessionId)).take(2),
      blocks: await ctx.db.query('sessionContentBlocks').take(12),
      claims: await ctx.db.query('sessionContentClaims').take(2),
    }))
    expect(rows.job).toMatchObject({ status: 'failed', terminalReason: 'candidate_validation_failed' })
    expect(rows.job).not.toHaveProperty('leaseToken')
    expect(rows.session).toMatchObject({ status: 'generation_failed', auditReasonCode: 'candidate_validation_failed' })
    expect(rows.content).toEqual([])
    expect(rows.blocks).toEqual([])
    expect(rows.claims).toEqual([])
  })

  test('keeps non-entailed, low-confidence, incomplete, and mismatched verifier decisions unpublished', async () => {
    const invalidators = [
      (decisions: Array<Record<string, unknown>>) => { decisions[0]!.decision = 'not_entailed' },
      (decisions: Array<Record<string, unknown>>) => { decisions[0]!.confidence = 0.79 },
      (decisions: Array<Record<string, unknown>>) => { decisions.pop() },
      (decisions: Array<Record<string, unknown>>) => { decisions[0]!.sourceExcerptId = 'a-different-excerpt' },
    ]
    for (const invalidate of invalidators) {
      const { t, graph } = await seedGenerationGraph()
      const { lease, begun } = await leaseAndBegin(t, graph.jobId)
      const verifier = JSON.parse(verifierDecisionsJson(graph.snapshotId, graph.excerptId)) as { decisions: Array<Record<string, unknown>> }
      invalidate(verifier.decisions)
      expect(await t.mutation(internal.learnV2SessionContent.commitSessionContentCandidate, {
        tokenIdentifier: identity.tokenIdentifier, jobId: graph.jobId, leaseToken: lease.leaseToken,
        expectedRevision: begun.revision, candidateJson: JSON.stringify(candidate()).replaceAll(sourceId, String(graph.snapshotId)),
        verifierDecisionsJson: JSON.stringify(verifier),
      })).toEqual({ status: 'generation_failed' })
      expect(await t.run(ctx => ctx.db.query('sessionContent').take(2))).toEqual([])
      expect(await t.run(ctx => ctx.db.get(graph.jobId))).toMatchObject({ status: 'failed', terminalReason: 'entailment_verification_failed' })
    }
  })

  test('blocks publication when a dispatch source is purged or its plan is no longer current', async () => {
    const purged = await seedGenerationGraph()
    const purgedLease = await leaseAndBegin(purged.t, purged.graph.jobId)
    const purgedDecisions = verifierDecisionsJson(purged.graph.snapshotId, purged.graph.excerptId)
    await purged.t.run(async ctx => {
      const excerpt = await ctx.db.query('learnSourceExcerpts').withIndex('by_userId_and_sourceSnapshotId_and_evidencePurgedAt', q => q.eq('userId', identity.tokenIdentifier).eq('sourceSnapshotId', purged.graph.snapshotId).eq('evidencePurgedAt', undefined)).unique()
      await ctx.db.patch(purged.graph.snapshotId, { evidencePurgedAt: Date.now() })
      await ctx.db.patch(excerpt!._id, { evidencePurgedAt: Date.now() })
    })
    await expect(purged.t.mutation(internal.learnV2SessionContent.commitSessionContentCandidate, {
      tokenIdentifier: identity.tokenIdentifier, jobId: purged.graph.jobId, leaseToken: purgedLease.lease.leaseToken,
      expectedRevision: purgedLease.begun.revision, candidateJson: JSON.stringify(candidate()).replaceAll(sourceId, String(purged.graph.snapshotId)),
      verifierDecisionsJson: purgedDecisions,
    })).resolves.toEqual({ status: 'blocked' })
    expect(await purged.t.run(ctx => ctx.db.get(purged.graph.jobId))).toMatchObject({ status: 'blocked', terminalReason: 'evidence_unavailable' })
    expect(await purged.t.run(ctx => ctx.db.query('sessionContent').take(2))).toEqual([])

    const stale = await seedGenerationGraph()
    await stale.t.run(ctx => ctx.db.patch(stale.graph.planId, { activeRevisionId: undefined }))
    expect(await stale.t.mutation(internal.learnV2SessionContent.leaseSessionContentGeneration, {
      tokenIdentifier: identity.tokenIdentifier, jobId: stale.graph.jobId, expectedRevision: 1,
    })).toEqual({ kind: 'blocked' })
    expect(await stale.t.run(ctx => ctx.db.get(stale.graph.jobId))).toMatchObject({ status: 'blocked', terminalReason: 'input_revision_conflict' })
  })

  test('requeues an expired pre-dispatch lease but blocks an expired dispatched generation as uncertain', async () => {
    const preDispatch = await seedGenerationGraph()
    const preLease = await leaseAndBegin(preDispatch.t, preDispatch.graph.jobId)
    await preDispatch.t.run(ctx => ctx.db.patch(preDispatch.graph.jobId, { leaseExpiresAt: Date.now() - 1 }))
    expect(await preDispatch.t.mutation(internal.learnV2SessionContent.recoverExpiredSessionContentJobs, {})).toMatchObject({ recovered: 1, blocked: 0 })
    const recoveredPreDispatch = await preDispatch.t.run(ctx => ctx.db.get(preDispatch.graph.jobId))
    expect(recoveredPreDispatch).toMatchObject({ status: 'queued', revision: preLease.begun.revision + 1 })
    expect(recoveredPreDispatch).not.toHaveProperty('checkpoint')
    expect(recoveredPreDispatch).not.toHaveProperty('leaseToken')

    const postDispatch = await seedGenerationGraph()
    const postLease = await leaseAndBegin(postDispatch.t, postDispatch.graph.jobId)
    await postDispatch.t.mutation(internal.learnV2SessionContent.markSessionContentDispatchStarted, { tokenIdentifier: identity.tokenIdentifier, jobId: postDispatch.graph.jobId, leaseToken: postLease.lease.leaseToken, expectedRevision: postLease.begun.revision })
    await postDispatch.t.run(ctx => ctx.db.patch(postDispatch.graph.jobId, { leaseExpiresAt: Date.now() - 1 }))
    expect(await postDispatch.t.mutation(internal.learnV2SessionContent.recoverExpiredSessionContentJobs, {})).toMatchObject({ recovered: 0, blocked: 1 })
    const blockedPostDispatch = await postDispatch.t.run(ctx => ctx.db.get(postDispatch.graph.jobId))
    expect(blockedPostDispatch).toMatchObject({ status: 'blocked', terminalReason: 'provider_outcome_unknown' })
    expect(blockedPostDispatch).not.toHaveProperty('leaseToken')
    expect(await postDispatch.t.run(ctx => ctx.db.get(postDispatch.graph.sessionId))).toMatchObject({ status: 'blocked', auditReasonCode: 'provider_outcome_unknown' })
  })

  test('lets the owner explicitly retry a terminal session generation without changing accepted plan or evidence pins', async () => {
    process.env.LEARN_V2_SESSION_CONTENT_PROVIDER_ENABLED = 'true'
    process.env.LEARN_V2_SESSION_CONTENT_MODEL = 'openai/gpt-4o-mini'
    const { t, owner, graph } = await seedGenerationGraph()
    const { lease, begun } = await leaseAndBegin(t, graph.jobId)
    await t.mutation(internal.learnV2SessionContent.terminalizeSessionContentGeneration, {
      tokenIdentifier: identity.tokenIdentifier,
      jobId: graph.jobId,
      leaseToken: lease.leaseToken,
      expectedRevision: begun.revision,
      reason: 'provider_outcome_unknown',
      sessionStatus: 'blocked',
    })

    const result = await owner.mutation(api.learnV2SessionContent.retrySessionContentGeneration, {
      studySessionId: graph.sessionId,
      expectedSessionRevision: 2,
      idempotencyKey: 'retry-session-generation',
    })

    expect(result).toMatchObject({ status: 'pending', sessionRevision: 3 })
    const rows = await t.run(async ctx => ({
      session: await ctx.db.get(graph.sessionId),
      jobs: await ctx.db.query('learnJobs')
        .withIndex('by_userId_and_studySessionId_and_type_and_status', q => q
          .eq('userId', identity.tokenIdentifier)
          .eq('studySessionId', graph.sessionId)
          .eq('type', 'session_content_generation'))
        .take(4),
    }))
    expect(rows.session).toMatchObject({ status: 'planned', revision: 3 })
    expect(rows.session).not.toHaveProperty('auditReasonCode')
    expect(rows.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ _id: graph.jobId, status: 'failed', terminalReason: 'provider_outcome_reviewed_no_candidate' }),
      expect.objectContaining({ status: 'queued', expectedSessionRevision: 3, attempts: 0 }),
    ]))
  })

  test('starts only the exact published revision and returns the durable receipt only to its owner', async () => {
    const { t, owner, graph } = await seedGenerationGraph()
    const { lease, begun } = await leaseAndBegin(t, graph.jobId)
    const published = await t.mutation(internal.learnV2SessionContent.commitSessionContentCandidate, {
      tokenIdentifier: identity.tokenIdentifier, jobId: graph.jobId, leaseToken: lease.leaseToken,
      expectedRevision: begun.revision, candidateJson: JSON.stringify(candidate()).replaceAll(sourceId, String(graph.snapshotId)),
      verifierDecisionsJson: verifierDecisionsJson(graph.snapshotId, graph.excerptId),
    })
    if (published.status !== 'ready') throw new Error('expected published session content')
    await t.run(ctx => ctx.db.patch(graph.sessionId, { scheduledStartAt: Date.now() - 1 }))
    await expect(owner.mutation(api.learnV2SessionContent.startStudySession, {
      studySessionId: graph.sessionId, expectedSessionRevision: 2, expectedContentRevision: 2, idempotencyKey: 'start-exact-revision',
    })).rejects.toThrow(/Published session content is required/)
    const args = { studySessionId: graph.sessionId, expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'start-exact-revision' }
    const first = await owner.mutation(api.learnV2SessionContent.startStudySession, args)
    expect(await owner.mutation(api.learnV2SessionContent.startStudySession, args)).toEqual(first)
    expect(await t.run(ctx => ctx.db.query('learnPlanCommandReceipts').withIndex('by_userId_and_idempotencyKey', q => q.eq('userId', identity.tokenIdentifier).eq('idempotencyKey', args.idempotencyKey)).take(2))).toHaveLength(1)
    const otherIdentity = { tokenIdentifier: 'https://auth.example.com|other-session-owner', name: 'Other owner' }
    const other = t.withIdentity(otherIdentity)
    await other.mutation(api.users.upsertUser, {})
    await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: otherIdentity.tokenIdentifier, enabled: true })
    await expect(other.mutation(api.learnV2SessionContent.startStudySession, args)).rejects.toThrow(/Study session is not ready/)
  })

  test('allows a ready session to start early on its scheduled local day but not on a future day', async () => {
    const { t, owner, graph } = await seedGenerationGraph()
    const { lease, begun } = await leaseAndBegin(t, graph.jobId)
    const published = await t.mutation(internal.learnV2SessionContent.commitSessionContentCandidate, {
      tokenIdentifier: identity.tokenIdentifier, jobId: graph.jobId, leaseToken: lease.leaseToken,
      expectedRevision: begun.revision, candidateJson: JSON.stringify(candidate()).replaceAll(sourceId, String(graph.snapshotId)),
      verifierDecisionsJson: verifierDecisionsJson(graph.snapshotId, graph.excerptId),
    })
    if (published.status !== 'ready') throw new Error('expected published session content')
    await t.run(ctx => ctx.db.patch(graph.sessionId, { scheduledStartAt: Date.now() + 60_000, timezone: 'America/Toronto' }))
    await expect(owner.mutation(api.learnV2SessionContent.startStudySession, {
      studySessionId: graph.sessionId, expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'start-early-today',
    })).resolves.toMatchObject({ status: 'in_progress' })

    const future = await seedGenerationGraph()
    const futureLease = await leaseAndBegin(future.t, future.graph.jobId)
    const futurePublished = await future.t.mutation(internal.learnV2SessionContent.commitSessionContentCandidate, {
      tokenIdentifier: identity.tokenIdentifier, jobId: future.graph.jobId, leaseToken: futureLease.lease.leaseToken,
      expectedRevision: futureLease.begun.revision, candidateJson: JSON.stringify(candidate()).replaceAll(sourceId, String(future.graph.snapshotId)),
      verifierDecisionsJson: verifierDecisionsJson(future.graph.snapshotId, future.graph.excerptId),
    })
    if (futurePublished.status !== 'ready') throw new Error('expected published future session content')
    await future.t.run(ctx => ctx.db.patch(future.graph.sessionId, { scheduledStartAt: Date.now() + 48 * 60 * 60_000, timezone: 'America/Toronto' }))
    await expect(future.owner.mutation(api.learnV2SessionContent.startStudySession, {
      studySessionId: future.graph.sessionId, expectedSessionRevision: 2, expectedContentRevision: 1, idempotencyKey: 'start-too-early',
    })).rejects.toThrow(/not scheduled for today/)
  })
})
