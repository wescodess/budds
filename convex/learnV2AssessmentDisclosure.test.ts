/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { seedMeasurementStorage, STORAGE_CANARIES } from '../tests/fixtures/learn-v2-measurement-storage'
import { LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION } from '../shared/learn-v2-assessment-disclosure'
import { composeAdaptiveActivityPlan } from '../shared/learn-adaptive-activity-plan'
import { ASSESSMENT_DISCLOSURE_READS, disclosureDigest, resolveAssessmentDisclosureContext } from './lib/learnV2AssessmentDisclosure'

const modules = import.meta.glob('./**/*.ts')
const owner = { subject: 'same-subject', issuer: 'https://auth.example.com', tokenIdentifier: 'https://auth.example.com|disclosure-owner' }
const foreign = { subject: 'someone-else', issuer: owner.issuer, tokenIdentifier: `${owner.issuer}|foreign` }
const otherIssuer = { subject: owner.subject, issuer: 'https://another.example.com', tokenIdentifier: 'https://another.example.com|disclosure-owner' }
const digest = `sha256:${'a'.repeat(64)}`
const canaries = { ...STORAGE_CANARIES, nested: 'PRIVATE_NESTED_FUTURE_FIELD', fallback: 'PRIVATE_FALLBACK_TEXT', rawSnapshot: 'PRIVATE_PLAN_SNAPSHOT' }
const states = ['no_grant', 'open', 'sealed_pending', 'scored', 'replaced', 'revoked'] as const
type State = typeof states[number]

afterEach(() => { vi.unstubAllEnvs() })

async function fixture(state: State = 'open') {
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  const t = convexTest(schema, modules)
  const f = await t.run(async ctx => {
    for (const identity of [owner, foreign, otherIssuer]) await ctx.db.insert('users', { tokenIdentifier: identity.tokenIdentifier,
      name: identity.subject, learnV2Entitlement: { enabled: true, updatedAt: 1 }, learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: 1 } })
    const f = await seedMeasurementStorage(ctx, owner.tokenIdentifier)
    const generatedItem = await ctx.db.get(f.rows.learnMeasurementItems)
    if (!generatedItem) throw new Error('Missing fixture item')
    const generationJobId = generatedItem.generationJobId
    await ctx.db.patch(generationJobId, { type: 'blueprint_generation', blueprintRevisionId: f.scope.blueprintRevisionId, checkpoint: canaries.nested })
    const contract = { version: 'learn-v2.assessment.v1' as const, kind: 'bounded_rubric' as const, responseFormat: 'short_text' as const,
      instructions: canaries.prompt, passingScorePercent: 80 as const, criteria: [{ key: canaries.key, description: canaries.rubric, weightPercent: 100 }] }
    await ctx.db.patch(f.learningVoidId, { activeBlueprintRevisionId: f.scope.blueprintRevisionId })
    await ctx.db.patch(f.scope.blueprintRevisionId, { status: 'accepted' })
    await ctx.db.patch(f.scope.objectiveId, { depth: 'working', capability: 'Apply a source-grounded rule', assessmentContract: contract })
    await ctx.db.patch(f.documentId, { contentHash: 'source-hash', status: 'success' })
    await ctx.db.patch(f.sourceSnapshotId, { blueprintRevisionId: f.scope.blueprintRevisionId, publicLocator: 'https://example.com/private-capability', privateLocator: canaries.locator })
    await ctx.db.insert('learnObjectiveSources', { userId: owner.tokenIdentifier, objectiveId: f.scope.objectiveId, sourceSnapshotId: f.sourceSnapshotId, coverage: 'strong' })
    await ctx.db.patch(f.scope.contextPins.studyPlanRevisionId, { status: 'accepted', blueprintRevisionId: f.scope.blueprintRevisionId, blueprintRecordRevision: 1,
      inputSnapshot: JSON.stringify({ privateScoring: canaries.rawSnapshot }), resultSnapshot: JSON.stringify({ status: 'feasible', reasonCodes: ['capacity_available'], alternatives: [], privateScoring: canaries.rawSnapshot }) })
    await ctx.db.patch(f.scope.contextPins.studyPlanId, { activeRevisionId: f.scope.contextPins.studyPlanRevisionId })
    await ctx.db.patch(f.scope.contextPins.sessionContentId, { studyPlanRevisionId: f.scope.contextPins.studyPlanRevisionId, blueprintRevisionId: f.scope.blueprintRevisionId,
      objectiveId: f.scope.objectiveId, inputDigest: digest, generatorVersion: 'generator.v1', assessmentOpportunityId: f.rows.learnAssessmentOpportunities, assessmentPurpose: 'measurement_cold' })
    const scope = { ...f.scope, assessmentContractDigest: digest, contextPins: { ...f.scope.contextPins, contentInputDigest: digest } }
    const itemPins = { ...f.itemPins, promptDigest: digest, scoringSpecDigest: digest, supportManifestDigest: digest }
    await ctx.db.patch(f.rows.learnMeasurementItems, { assessmentContractDigest: digest, promptDigest: digest, scoringSpecDigest: digest, supportManifestDigest: digest })
    const assignment = await ctx.db.get(f.rows.learnMeasurementAssignments)
    if (!assignment || assignment.status !== 'admitted' || assignment.allocation.kind !== 'three_case') throw new Error('Missing fixture assignment')
    await ctx.db.patch(assignment._id, { allocation: { ...assignment.allocation, cold: itemPins } })
    await ctx.db.patch(f.rows.learnAssessmentExposures, { policyVersion: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, projectionDigest: digest,
      deliveryReceiptHash: digest, status: state === 'revoked' ? 'unknown' : 'granted' })
    await ctx.db.patch(f.rows.learnResponses, { ...scope, assessmentPins: { kind: 'measurement', itemPins }, payloadDigest: digest })
    await ctx.db.patch(f.rows.learnResponseBodies, { payloadDigest: digest })
    const attemptId = await ctx.db.insert('masteryAttempts', { userId: owner.tokenIdentifier, objectiveId: f.scope.objectiveId, blueprintRevisionId: f.scope.blueprintRevisionId,
      studySessionId: f.studySessionId, sessionContentId: f.scope.contextPins.sessionContentId, attemptedAt: f.base.createdAt, idempotencyKey: 'history', kind: 'measurement_cold',
      serverScorePercent: 80, response: canaries.answer, rubricSnapshot: JSON.stringify({ private: canaries.rubric }), criterionResultsJson: JSON.stringify({ private: canaries.nested }),
      feedbackProjectionJson: JSON.stringify({ private: canaries.nested }), contentRevisionPinsJson: JSON.stringify({ private: canaries.locator }),
      submissionId: f.rows.learnResponses, assessmentOpportunityId: f.rows.learnAssessmentOpportunities,
      measurementStorage: { version: 'learn-v2.measurement-storage.v1', scope, itemPins, scoringBinding: f.scoringBinding,
        assessmentOpportunityId: f.rows.learnAssessmentOpportunities, submissionId: f.rows.learnResponses, executionId: f.rows.learnScoringExecutions,
        assistanceSnapshot: f.assistanceSnapshot, validitySnapshot: f.validitySnapshot, acceptedAt: f.base.createdAt, scoreCommittedAt: f.base.createdAt,
        requestedScorerModel: null, returnedScorerModel: null } })
    const sealed = state === 'sealed_pending' || state === 'scored'
    await ctx.db.patch(f.rows.learnAssessmentOpportunities, { ...scope, assessmentPins: { kind: 'measurement', itemPins },
      phase: state === 'no_grant' ? 'ready' : state === 'scored' ? 'scored_pass' : state === 'sealed_pending' ? 'scoring_pending' : state === 'replaced' ? 'abandoned' : 'test_open',
      deliveryGrantId: state === 'no_grant' ? undefined : f.rows.learnAssessmentExposures, submissionId: sealed ? f.rows.learnResponses : undefined,
      authoritativeAttemptId: state === 'scored' ? attemptId : undefined })
    // Keep a standalone diagnostic as a separate, legitimate non-factual read.
    await ctx.db.patch(f.threadId, { currentActivityId: f.activityId })
    const claimId = await ctx.db.insert('sessionContentClaims', { userId: owner.tokenIdentifier, sessionContentId: f.scope.contextPins.sessionContentId,
      order: 0, claim: canaries.solution, verifierVersion: 'verifier.v1', confidence: 1 })
    const supportId = await ctx.db.insert('learnClaimSupports', { userId: owner.tokenIdentifier, sessionContentClaimId: claimId, sourceExcerptId: f.sourceExcerptId,
      sourceSnapshotId: f.sourceSnapshotId, entailment: 'entailed', conflictStatus: 'clear', evidenceStatus: 'evidence_available', verifierVersion: 'verifier.v1', confidence: 1 })
    const evidenceThreadId = await ctx.db.insert('learningThreads', { userId: owner.tokenIdentifier, authorityKind: 'v2_mission', learningVoidId: f.learningVoidId,
      originalNeed: 'Practice the capability', intent: 'understand', availableTime: '15', sourceScope: { kind: 'folder', sourceId: String(f.folderId) },
      evidenceState: 'ready', lifecycle: 'active', revision: 1, createdAt: 1, updatedAt: 1 })
    const composed = await composeAdaptiveActivityPlan({ activityId: 'held-out-wrapper', threadId: String(evidenceThreadId), boundaryOrdinal: 1, planRevision: 1,
      activityClass: 'factual', intent: 'understand', objectiveId: String(f.scope.objectiveId), purpose: canaries.prompt, reasonCode: 'ready_v2_session',
      primitiveSequence: [{ type: 'cited_explanation', action: 'continue', props: { heading: 'Capability', explanation: canaries.solution, sourceRefs: [String(f.sourceSnapshotId)] } }],
      requiredAction: { kind: 'continue', label: 'Continue' }, evaluationContract: { version: 'learn-adaptive.evaluation.v1', kind: 'acknowledgement', responseFormat: 'none', passingScorePercent: null },
      accessibilityMetadata: { heading: 'Capability', instructions: canaries.rubric, focusTargetTestId: 'learn-primitive-cited-explanation', liveRegionMode: 'polite' },
      pins: { learningVoidId: String(f.learningVoidId), blueprintRevisionId: String(f.scope.blueprintRevisionId), objectiveId: String(f.scope.objectiveId), sessionContentId: String(f.scope.contextPins.sessionContentId) },
      evidenceReferences: [{ claimId: String(claimId), supportId: String(supportId), sourceSnapshotId: String(f.sourceSnapshotId), sourceSnapshotRevision: 1, sourceRecordRevision: 1, sourceEffectiveStatus: 'user_accepted', verifierVersion: 'verifier.v1', integrityState: 'accepted' }],
      generationInputs: { sessionContentRevision: 1, sessionContentInputDigest: digest, generatorVersion: 'generator.v1' },
      decisionInputs: { intentRevision: 1, routerVersion: 'fixture.v1', availableTime: '15', sourceState: 'ready', sourceInputs: [{ sourceSnapshotId: String(f.sourceSnapshotId), effectiveStatus: 'user_accepted', recordRevision: 1 }], priorActivityId: null, priorAttemptId: null, priorOutcome: null, assistance: 'none', confidence: null } })
    const evidenceActivityId = await ctx.db.insert('learningThreadActivities', { userId: owner.tokenIdentifier, threadId: evidenceThreadId, activityId: composed.activityId,
      boundaryOrdinal: 1, planRevision: 1, activityClass: 'factual', status: state === 'replaced' ? 'replaced' : 'started',
      planVersion: composed.planVersion, replayVersion: composed.replayVersion, contractVersion: composed.contractVersion, rendererVersion: composed.rendererVersion,
      validationVersion: composed.validationVersion, sequenceValidationVersion: composed.sequenceValidationVersion, fallbackVersion: composed.fallbackVersion,
      intent: composed.intent, objectiveId: f.scope.objectiveId, purpose: composed.purpose, reasonCode: composed.reasonCode, primitivePlan: composed.primitivePlan,
      requiredAction: composed.requiredAction, evaluationContract: composed.evaluationContract, fallback: { ...composed.fallback, body: canaries.fallback },
      accessibilityMetadata: composed.accessibilityMetadata, learningVoidId: f.learningVoidId, blueprintRevisionId: f.scope.blueprintRevisionId, sessionContentId: f.scope.contextPins.sessionContentId,
      evidenceReferences: [{ claimId, supportId, sourceSnapshotId: f.sourceSnapshotId, sourceSnapshotRevision: 1, sourceRecordRevision: 1, sourceEffectiveStatus: 'user_accepted', verifierVersion: 'verifier.v1', integrityState: 'accepted' }],
      generationInputs: composed.generationInputs, decisionInputs: composed.decisionInputs, replacesActivityId: null,
      canonicalInputSnapshot: composed.canonicalInputSnapshot, inputDigest: composed.inputDigest, createdAt: 2, updatedAt: 2 })
    await ctx.db.patch(evidenceThreadId, { currentActivityId: state === 'replaced' ? undefined : evidenceActivityId })
    const routingThreadId = await ctx.db.insert('learningThreads', { userId: owner.tokenIdentifier, authorityKind: 'standalone', originalNeed: 'A separate starting point',
      intent: 'understand', availableTime: '15', sourceScope: { kind: 'none' }, evidenceState: 'none', lifecycle: 'ready', revision: 1, createdAt: 3, updatedAt: 3 })
    return { ...f, scope, itemPins, attemptId, evidenceThreadId, evidenceActivityId, contract, generationJobId, routingThreadId }
  })
  const asOwner = t.withIdentity(owner)
  const routingArgs = { threadId: f.routingThreadId, expectedRevision: 1, idempotencyKey: 'matrix-routing-replay' }
  const route = await asOwner.mutation(api.learnAdaptiveRouting.decideNextActivity, routingArgs)
  if (route.kind !== 'ok') throw new Error('Missing routing decision')
  const decisionId = await t.run(async ctx => ctx.db.normalizeId('learnActivityDecisions', route.value.decisionId))
  if (!decisionId) throw new Error('Invalid routing fixture')
  return { t, f: { ...f, routingArgs, decisionId }, asOwner }
}

type Fixture = Awaited<ReturnType<typeof fixture>>
const reads = [
  ['learnV2Journey.listHub', (s: Fixture) => s.asOwner.query(api.learnV2Journey.listHub, {})],
  ['learnV2Journey.getMission', (s: Fixture) => s.asOwner.query(api.learnV2Journey.getMission, { learningVoidId: s.f.learningVoidId })],
  ['learnV2Journey.getCurrentMission', (s: Fixture) => s.asOwner.query(api.learnV2Journey.getCurrentMission, {})],
  ['learnV2Journey.getSessionCandidate', (s: Fixture) => s.asOwner.query(api.learnV2Journey.getSessionCandidate, { learningVoidId: s.f.learningVoidId, studySessionId: s.f.studySessionId })],
  ['learnV2Blueprints.getBlueprintMap', (s: Fixture) => s.asOwner.query(api.learnV2Blueprints.getBlueprintMap, { blueprintRevisionId: s.f.scope.blueprintRevisionId })],
  ['learnV2Blueprints.getBlueprintGenerationJob', (s: Fixture) => s.asOwner.query(api.learnV2Blueprints.getBlueprintGenerationJob, { jobId: s.f.generationJobId })],
  ['learnV2Lifecycle.getLearningVoid', (s: Fixture) => s.asOwner.query(api.learnV2Lifecycle.getLearningVoid, { learningVoidId: s.f.learningVoidId })],
  ['learnV2Lifecycle.listLearningVoids', (s: Fixture) => s.asOwner.query(api.learnV2Lifecycle.listLearningVoids, { paginationOpts: { cursor: null, numItems: 8 } })],
  ['learnV2Lifecycle.getBlueprintRevision', (s: Fixture) => s.asOwner.query(api.learnV2Lifecycle.getBlueprintRevision, { blueprintRevisionId: s.f.scope.blueprintRevisionId })],
  ['learnV2Plans.getPlanPreview', (s: Fixture) => s.asOwner.query(api.learnV2Plans.getPlanPreview, { studyPlanRevisionId: s.f.scope.contextPins.studyPlanRevisionId })],
  ['learnV2Sources.getSource', (s: Fixture) => s.asOwner.query(api.learnV2Sources.getSource, { sourceSnapshotId: s.f.sourceSnapshotId })],
  ['learnV2Sources.listSources', (s: Fixture) => s.asOwner.query(api.learnV2Sources.listSources, { learningVoidId: s.f.learningVoidId, paginationOpts: { cursor: null, numItems: 8 } })],
  ['learnV2Sources.listSourceReview', (s: Fixture) => s.asOwner.query(api.learnV2Sources.listSourceReview, { blueprintRevisionId: s.f.scope.blueprintRevisionId, paginationOpts: { cursor: null, numItems: 8 } })],
  ['learnAdaptive.getThread', (s: Fixture) => s.asOwner.query(api.learnAdaptive.getThread, { threadId: s.f.evidenceThreadId })],
  ['learnAdaptive.getMemory', (s: Fixture) => s.asOwner.query(api.learnAdaptive.getMemory, { threadId: s.f.evidenceThreadId })],
  ['learnAdaptive.listThreadHistory', (s: Fixture) => s.asOwner.query(api.learnAdaptive.listThreadHistory, { cursor: null })],
  ['learnAdaptive.listResumeCandidates', (s: Fixture) => s.asOwner.query(api.learnAdaptive.listResumeCandidates, {})],
  ['learnAdaptive.listPromotionProposals', (s: Fixture) => s.asOwner.query(api.learnAdaptive.listPromotionProposals, { threadId: s.f.evidenceThreadId })],
  ['learnAdaptive.listThreadArtifacts', (s: Fixture) => s.asOwner.query(api.learnAdaptive.listThreadArtifacts, { threadId: s.f.evidenceThreadId })],
  ['learnAdaptive.listThreadContributions', (s: Fixture) => s.asOwner.query(api.learnAdaptive.listThreadContributions, { threadId: s.f.evidenceThreadId, paginationOpts: { cursor: null, numItems: 8 } })],
  ['learnAdaptive.inspectContributionSource', (s: Fixture) => s.asOwner.query(api.learnAdaptive.inspectContributionSource, { source: { feature: 'documents', id: s.f.documentId } })],
  ['learnAdaptive.getArtifactCanvas', (s: Fixture) => s.asOwner.query(api.learnAdaptive.getArtifactCanvas, { threadId: s.f.evidenceThreadId })],
  ['learnAdaptive.getReflectionCanvas', (s: Fixture) => s.asOwner.query(api.learnAdaptive.getReflectionCanvas, { threadId: s.f.evidenceThreadId })],
  ['learnAdaptiveEvidence.getThreadActivityEvidence', (s: Fixture) => s.asOwner.query(api.learnAdaptiveEvidence.getThreadActivityEvidence, { threadId: s.f.evidenceThreadId, activityId: 'held-out-wrapper' })],
  ['learnAdaptiveEvidence.getActivityEvidence', (s: Fixture) => s.asOwner.query(internal.learnAdaptiveEvidence.getActivityEvidence, { activityId: 'held-out-wrapper' })],
  ['learnAdaptiveRecovery.getDiagnosticCanvas', (s: Fixture) => s.asOwner.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId: s.f.threadId })],
  ['learnAdaptiveDrafts.getThreadDraft', (s: Fixture) => s.asOwner.query(api.learnAdaptiveDrafts.getThreadDraft, { threadId: s.f.threadId })],
  ['learnAdaptiveClarifications.getInitialDecision', (s: Fixture) => s.asOwner.query(api.learnAdaptiveClarifications.getInitialDecision, { threadId: s.f.threadId })],
  ['learnAdaptiveRouting.decideNextActivity', (s: Fixture) => s.asOwner.mutation(api.learnAdaptiveRouting.decideNextActivity, s.f.routingArgs)],
  ['learnAdaptiveRouting.replayDecision', (s: Fixture) => s.asOwner.query(api.learnAdaptiveRouting.replayDecision, { decisionId: s.f.decisionId })],
] as const

function assertNoPrivateFields(value: unknown) {
  if (Array.isArray(value)) { value.forEach(assertNoPrivateFields); return }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    expect(['assessmentContract', 'rubric', 'rubricSnapshot', 'assessmentRubricSnapshot', 'criterionResultsJson', 'contentRevisionPinsJson', 'privateLocator', 'referenceSolution', 'futurePrivate']).not.toContain(key)
    assertNoPrivateFields(child)
  }
}

describe('registered assessment disclosure inventory', () => {
  test('each declared C4.1 read and alias has a registered response-matrix driver', () => {
    expect(reads.map(([name]) => name).sort()).toEqual(ASSESSMENT_DISCLOSURE_READS.map(([name]) => name).sort())
  })
  test.each(states)('%s: serialized reads retain only their declared DTOs', async state => {
    const s = await fixture(state)
    for (const [name, read] of reads) {
      const value = await read(s)
      const serialized = JSON.stringify(value)
      for (const canary of Object.values(canaries)) if (canary !== canaries.answer) expect(serialized, `${state}: ${name}`).not.toContain(canary)
      assertNoPrivateFields(value)
    }
    const context = await s.asOwner.run(ctx => resolveAssessmentDisclosureContext(ctx, s.f.rows.learnAssessmentOpportunities))
    expect(context?.pinsMatch).toBe(state !== 'revoked')
    expect(context?.grant === null).toBe(state === 'no_grant' || state === 'revoked')
  })

  test.each([null, foreign, otherIssuer])('denies an unauthenticated or foreign issuer at every registered read', async identity => {
    const s = await fixture()
    const scoped = { ...s, asOwner: identity ? s.t.withIdentity(identity) : s.t }
    for (const [name, read] of reads) {
      try {
        const value = await read(scoped)
        expect(JSON.stringify(value), name).not.toContain(s.f.learningVoidId)
        for (const canary of Object.values(canaries)) expect(JSON.stringify(value), name).not.toContain(canary)
      }
      catch (error) {
        expect(String(error), name).toMatch(/denied|authenticated|not found/i)
        for (const canary of Object.values(canaries)) expect(String(error), name).not.toContain(canary)
      }
    }
  })

  test.each(['source_loss', 'stale_pins', 'unknown_purpose', 'foreign_grant', 'same_owner_wrong_grant'] as const)('%s fails closed before historical evidence expansion', async failure => {
    const s = await fixture('replaced')
    await s.t.run(async ctx => {
      if (failure === 'source_loss') await ctx.db.patch(s.f.sourceIdentityId, { tombstonedAt: Date.now() })
      else if (failure === 'stale_pins') await ctx.db.patch(s.f.scope.blueprintRevisionId, { recordRevision: 2 })
      else if (failure === 'unknown_purpose') await ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { purpose: { kind: 'measurement_cold', assignmentId: s.f.rows.learnMeasurementAssignments, protocolVersion: '' } })
      else if (failure === 'foreign_grant') await ctx.db.patch(s.f.rows.learnAssessmentExposures, { userId: foreign.tokenIdentifier })
      else await ctx.db.patch(s.f.rows.learnAssessmentExposures, { itemRevision: 2 })
    })
    const result = await s.asOwner.query(api.learnAdaptiveEvidence.getThreadActivityEvidence, { threadId: s.f.evidenceThreadId, activityId: 'held-out-wrapper' })
    expect(result).toMatchObject({ eligibility: 'historical', claims: [] })
    const context = await s.asOwner.run(ctx => resolveAssessmentDisclosureContext(ctx, s.f.rows.learnAssessmentOpportunities))
    expect(context === null || !context.pinsMatch || !context.evidenceAvailable || context.grant === null).toBe(true)
    const review = await s.asOwner.query(api.learnV2Sources.listSourceReview, { blueprintRevisionId: s.f.scope.blueprintRevisionId, paginationOpts: { cursor: null, numItems: 8 } })
    expect(review.page[0]).toMatchObject({ excerpt: null, identity: { publisherDomain: null } })
    for (const [name, read] of reads) {
      const value = await read(s)
      for (const canary of Object.values(canaries)) if (canary !== canaries.answer) expect(JSON.stringify(value), name).not.toContain(canary)
      assertNoPrivateFields(value)
    }
  })

  test('an independently correct answer remains own work without authorizing a key field', async () => {
    const s = await fixture('scored')
    await s.t.run(ctx => ctx.db.patch(s.f.rows.learnResponseBodies, { payload: { kind: 'text', text: canaries.key } }))
    const mission = await s.asOwner.query(api.learnV2Journey.getMission, { learningVoidId: s.f.learningVoidId })
    expect(mission?.mastery[0]?.attempts[0]?.work).toMatchObject({ body: { bodyAvailability: 'available', payload: { kind: 'text', text: canaries.key } } })
    assertNoPrivateFields(mission)
    expect(JSON.stringify(mission)).not.toContain(canaries.rubric)
    await s.t.run(ctx => ctx.db.patch(s.f.sourceIdentityId, { tombstonedAt: Date.now() }))
    const unavailable = await s.asOwner.query(api.learnV2Journey.getMission, { learningVoidId: s.f.learningVoidId })
    expect(unavailable?.mastery[0]?.attempts[0]?.work).toMatchObject({ body: { bodyAvailability: 'unavailable', reasonCode: 'evidence_unavailable' } })
    expect(JSON.stringify(unavailable)).not.toContain(canaries.key)
  })

  test('feature flags do not convert ownership into a grant', async () => {
    const s = await fixture('no_grant')
    for (const flag of ['true', 'false']) {
      vi.stubEnv('LEARN_V2_ENABLED', flag)
      expect(await s.asOwner.run(ctx => resolveAssessmentDisclosureContext(ctx, s.f.rows.learnAssessmentOpportunities))).toMatchObject({ owned: true, grant: null })
    }
  })

  test('malformed plan snapshots and future private fields in scheduling receipts cannot pass through a replay', async () => {
    const s = await fixture()
    const args = { studySessionId: s.f.studySessionId, expectedSessionRevision: 1, idempotencyKey: 'scheduling-disclosure-replay' }
    await s.t.run(async ctx => {
      await ctx.db.patch(s.f.scope.contextPins.studyPlanRevisionId, { resultSnapshot: `{${canaries.rawSnapshot}` })
      await ctx.db.patch(s.f.studySessionId, { scheduledStartAt: Date.now() - 120_000, scheduledEndAt: Date.now() - 60_000 })
    })
    const first = await s.asOwner.mutation(api.learnV2Plans.markStudySessionMissed, args)
    await s.t.run(async ctx => {
      const receipt = await ctx.db.query('learnPlanCommandReceipts').withIndex('by_userId_and_idempotencyKey', q => q.eq('userId', owner.tokenIdentifier).eq('idempotencyKey', args.idempotencyKey)).unique()
      if (!receipt) throw new Error('Missing scheduling receipt')
      await ctx.db.patch(receipt._id, { response: JSON.stringify({ ...first, privateSnapshot: canaries.nested }) })
    })
    const preview = await s.asOwner.query(api.learnV2Plans.getPlanPreview, { studyPlanRevisionId: s.f.scope.contextPins.studyPlanRevisionId })
    expect(preview).not.toHaveProperty('resultSnapshot')
    const replay = await s.asOwner.mutation(api.learnV2Plans.markStudySessionMissed, args)
    expect(replay).toEqual(first)
    expect(JSON.stringify(replay)).not.toContain(canaries.nested)
    assertNoPrivateFields(replay)
  })

  test('schedule preferences keep their existing wire fields while nested private snapshots are omitted', async () => {
    const s = await fixture()
    const preferences = { version: 'learn-v2.schedule-input.v1', timezone: 'UTC', startLocalDate: '2027-01-15', targetLocalDate: null,
      sessionMinutes: 25, minRestMinutes: 720, availability: [{ weekday: 2, start: '18:00', end: '20:00' }], blackoutDates: [], reviewIntervalsDays: [1, 3] }
    await s.t.run(ctx => ctx.db.patch(s.f.scope.contextPins.studyPlanRevisionId, { inputSnapshot: JSON.stringify({ ...preferences,
      availability: preferences.availability.map(window => ({ ...window, privateScoring: canaries.nested })), objectives: [{ rubric: canaries.rubric }] }) }))
    const plan = await s.asOwner.query(api.learnV2Plans.getPlanPreview, { studyPlanRevisionId: s.f.scope.contextPins.studyPlanRevisionId })
    expect(JSON.parse(plan?.inputSnapshot ?? 'null')).toEqual(preferences)
    expect(JSON.stringify(plan)).not.toContain(canaries.nested)
    expect(JSON.stringify(plan)).not.toContain(canaries.rubric)
  })

  test('calibration rediscloses only an exact historical grant and never its private rubric', async () => {
    const s = await fixture('no_grant')
    const contractDigest = await disclosureDigest(s.f.contract)
    const promptDigest = await disclosureDigest(s.f.contract.instructions)
    const identity = { kind: 'calibration' as const, objectiveId: s.f.scope.objectiveId, blueprintRevisionId: s.f.scope.blueprintRevisionId, promptDigest }
    const publicProjection = { identity, prompt: s.f.contract.instructions, declaredStimulus: null, instructions: s.f.contract.instructions,
      responseSpec: { kind: 'bounded_rubric', version: s.f.contract.version, maxCodeUnits: 12000 } }
    await s.t.run(async ctx => {
      await ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { purpose: { kind: 'calibration' }, contextPins: { kind: 'calibration' },
        assessmentContractDigest: contractDigest, assessmentPins: { kind: 'calibration', caseId: s.f.itemPins.caseId, promptDigest,
          assessmentContractVersion: s.f.contract.version, assessmentContractDigest: contractDigest, supportManifestDigest: digest } })
      await ctx.db.patch(s.f.rows.learnAssessmentExposures, { itemId: undefined, itemRevision: undefined, purpose: 'calibration', projectionDigest: await disclosureDigest(publicProjection) })
    })
    const read = () => s.asOwner.query(api.learnV2Journey.getMission, { learningVoidId: s.f.learningVoidId })
    expect((await read())?.calibration.items[0]?.prompt).toBeNull()
    await s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { phase: 'test_open', deliveryGrantId: s.f.rows.learnAssessmentExposures }))
    expect((await read())?.calibration.items[0]).toMatchObject({ prompt: canaries.prompt, assessment: { identity, prompt: canaries.prompt } })
    expect(JSON.stringify(await read())).not.toContain(canaries.rubric)
    await s.t.run(ctx => ctx.db.patch(s.f.rows.learnAssessmentOpportunities, { phase: 'abandoned' }))
    expect((await read())?.calibration.items[0]?.prompt).toBe(canaries.prompt)
    await s.t.run(ctx => ctx.db.patch(s.f.scope.objectiveId, { assessmentContract: { ...s.f.contract, instructions: 'A new, ungranted revision.' } }))
    expect((await read())?.calibration.items[0]?.prompt).toBeNull()
  })

  test.each(['diagnostic_prompt', 'artifact_workspace', 'reflection_next_move'] as const)('malformed %s never falls back to stored protected text', async kind => {
    const s = await fixture()
    await s.t.run(async ctx => {
      const activity = await ctx.db.get(s.f.activityId)
      if (!activity) throw new Error('Missing diagnostic')
      const base = { contractVersion: 'learn-adaptive.activity-contract.v1' as const, rendererVersion: 'learn-adaptive.renderer.v1' as const }
      const primitive = kind === 'artifact_workspace'
        ? { ...base, type: kind, action: 'save_artifact' as const, testId: 'learn-primitive-artifact-workspace' as const, props: { prompt: canaries.prompt, artifactKind: 'note' as const, starterText: canaries.solution } }
        : kind === 'reflection_next_move'
          ? { ...base, type: kind, action: 'accept_next_move' as const, testId: 'learn-primitive-reflection-next-move' as const, props: { feedback: canaries.rubric, nextMove: canaries.solution, allowedDecisions: ['accept' as const] } }
          : activity.primitivePlan[0]!
      await ctx.db.patch(s.f.activityId, { primitivePlan: [primitive], canonicalInputSnapshot: '{invalid',
        fallback: { ...activity.fallback, body: canaries.fallback }, purpose: canaries.prompt })
    })
    const value = kind === 'diagnostic_prompt' ? await s.asOwner.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId: s.f.threadId })
      : kind === 'artifact_workspace' ? await s.asOwner.query(api.learnAdaptive.getArtifactCanvas, { threadId: s.f.threadId })
        : await s.asOwner.query(api.learnAdaptive.getReflectionCanvas, { threadId: s.f.threadId })
    expect(value).toMatchObject({ status: 'blocked', activity: { primitive: null } })
    for (const canary of Object.values(canaries)) expect(JSON.stringify(value)).not.toContain(canary)
  })

  test('router command replay and the public replay alias validate persisted JSON before projecting it', async () => {
    const s = await fixture()
    const threadId = await s.t.run(ctx => ctx.db.insert('learningThreads', { userId: owner.tokenIdentifier, authorityKind: 'standalone', originalNeed: 'An independent goal',
      intent: 'understand', availableTime: '15', sourceScope: { kind: 'none' }, evidenceState: 'none', lifecycle: 'ready', revision: 1, createdAt: 3, updatedAt: 3 }))
    const args = { threadId, expectedRevision: 1, idempotencyKey: 'router-disclosure-key' }
    const first = await s.asOwner.mutation(api.learnAdaptiveRouting.decideNextActivity, args)
    expect(first.kind).toBe('ok')
    if (first.kind !== 'ok') throw new Error('Missing routing fixture')
    const id = await s.t.run(ctx => ctx.db.query('learnActivityDecisions').withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', owner.tokenIdentifier).eq('threadId', threadId)).unique())
    if (!id) throw new Error('Missing persisted decision')
    expect(await s.asOwner.query(api.learnAdaptiveRouting.replayDecision, { decisionId: id._id })).toMatchObject({ status: 'replayed', value: first.value })
    for (const identity of [foreign, otherIssuer]) expect(await s.t.withIdentity(identity).query(api.learnAdaptiveRouting.replayDecision, { decisionId: id._id })).toBeNull()
    await expect(s.t.query(api.learnAdaptiveRouting.replayDecision, { decisionId: id._id })).rejects.toThrow(/denied/)
    await s.t.run(ctx => ctx.db.patch(id._id, { fallback: JSON.stringify({ kind: 'safe_handoff', private: canaries.fallback }), overrideMetadata: JSON.stringify([{ private: canaries.nested }]) }))
    expect(await s.asOwner.query(api.learnAdaptiveRouting.replayDecision, { decisionId: id._id })).toEqual({ status: 'integrity_failed' })
    const replay = await s.asOwner.mutation(api.learnAdaptiveRouting.decideNextActivity, args)
    expect(replay).toMatchObject({ kind: 'invalid', code: 'routing_decision_integrity' })
    expect(JSON.stringify(replay)).not.toContain(canaries.fallback)
  })

  test('a newly added storage field stays absent from the actual registered map response', async () => {
    const extended = defineSchema({ ...schema.tables, learnObjectives: defineTable({ ...schema.tables.learnObjectives.validator.fields, futurePrivate: v.optional(v.string()) })
      .index('by_userId', ['userId']).index('by_userId_and_blueprintRevisionId_and_order', ['userId', 'blueprintRevisionId', 'order'])
      .index('by_userId_and_milestoneId_and_order', ['userId', 'milestoneId', 'order']) })
    const t = convexTest(extended, modules)
    vi.stubEnv('LEARN_V2_ENABLED', 'true')
    const ids = await t.run(async ctx => {
      const f = await seedMeasurementStorage(ctx, owner.tokenIdentifier)
      await ctx.db.insert('users', { tokenIdentifier: owner.tokenIdentifier, name: 'Owner', learnV2Entitlement: { enabled: true, updatedAt: 1 } })
      await ctx.db.patch(f.scope.objectiveId, { futurePrivate: canaries.nested })
      return f
    })
    const result = await t.withIdentity(owner).query(api.learnV2Blueprints.getBlueprintMap, { blueprintRevisionId: ids.scope.blueprintRevisionId })
    expect(JSON.stringify(result)).not.toContain(canaries.nested)
    assertNoPrivateFields(result)
  })
})
