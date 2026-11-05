/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const OWNER = 'https://auth.example.com|experiment-v2-owner'
const OTHER = 'https://auth.example.com|experiment-v2-other'
const previousLearnFlag = process.env.LEARN_V2_ENABLED
const previousExperimentFlag = process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED

beforeAll(() => {
  process.env.LEARN_V2_ENABLED = 'true'
  process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED = 'true'
})
afterAll(() => {
  if (previousLearnFlag === undefined) delete process.env.LEARN_V2_ENABLED
  else process.env.LEARN_V2_ENABLED = previousLearnFlag
  if (previousExperimentFlag === undefined) delete process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
  else process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED = previousExperimentFlag
})

// Statistical values and approval references are synthetic setup, never rollout evidence.
const SYNTHETIC_PLAN = {
  version: 'adaptive-routing-analysis.v1' as const,
  fixedContinuationVersion: 'synthetic-fixed.v1',
  primaryOutcomeVersion: 'synthetic-representative-task.v1',
  eligibilityVersion: 'learn-adaptive.experiment-eligibility.v1',
  assignmentUnit: 'authenticated_learner',
  denominatorVersion: 'synthetic-denominator.v1', baselineRate: 0.5,
  minimumEffectPercentagePoints: 5, minimumSamplePerArm: 10, stopAfterDays: 30,
  confidenceRule: 'synthetic-95-percent-ci-rule',
  accessibilityCompletionVersion: 'synthetic-accessibility.v1',
  recoverySuccessVersion: 'synthetic-recovery.v1',
  productAnalyticsOwner: 'synthetic-analytics-owner', productApprover: 'synthetic-product-approver',
  qaGuardrailVerifier: 'synthetic-qa-verifier', engineeringReplayOwner: 'synthetic-engineering-owner',
  guardrailMaxDegradationPercentagePoints: 3 as const,
  rollbackTrigger: 'strict_guardrail_drop_gt_3pp' as const,
  definitions: {
    fixedContinuation: 'Synthetic fixed continuation policy pinned for this test.',
    primaryOutcome: 'Synthetic server-scored representative pass in the outcome window.',
    eligibility: 'Synthetic ready and entitled learner with safe evidence.',
    denominator: 'Synthetic all eligible assigned learners by arm.',
    baselineSource: 'Synthetic fixed-arm fixture, not production evidence.',
    baselineWindow: 'Synthetic thirty-day observation window.',
    sampleStop: 'Synthetic minimum ten learners per arm at thirty days.',
    confidenceMethod: 'Synthetic two-sided 95 percent interval rule.',
    accessibilityCompletion: 'Synthetic accessible task completion per assigned learner.',
    recoverySuccess: 'Synthetic recovery success per recovery opportunity.',
    guardrailWindow: 'Synthetic thirty-day guardrail observation window.',
  },
}

async function readyMissionFixture() {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity({ tokenIdentifier: OWNER })
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: OWNER, enabled: true })
  await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  const ids = await t.run(async ctx => {
    const now = Date.now()
    const userId = OWNER
    const assessmentContract = {
      version: 'learn-v2.assessment.v1' as const, kind: 'machine_checkable' as const,
      responseFormat: 'short_text' as const, instructions: 'Explain from the evidence.',
      passingScorePercent: 80 as const,
      criteria: [{ key: 'accuracy', description: 'Accurate explanation.', weightPercent: 100 }],
    }
    const folderId = await ctx.db.insert('folders', { userId, name: 'Gravity sources', documentCount: 0 })
    const learningVoidId = await ctx.db.insert('learningVoids', {
      userId, folderId, title: 'Explain gravity', status: 'active', revision: 1, createdAt: now, updatedAt: now,
    })
    const blueprintId = await ctx.db.insert('learnBlueprints', { userId, learningVoidId, revision: 1, createdAt: now })
    const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', {
      userId, blueprintId, learningVoidId, revision: 1, recordRevision: 3,
      status: 'accepted', createdAt: now, updatedAt: now,
    })
    await ctx.db.patch(learningVoidId, { activeBlueprintRevisionId: blueprintRevisionId })
    const objectiveId = await ctx.db.insert('learnObjectives', {
      userId, blueprintRevisionId, order: 0, title: 'Explain gravity', assessmentContract,
    })
    const studyPlanId = await ctx.db.insert('studyPlans', { userId, learningVoidId, revision: 1, createdAt: now })
    const studyPlanRevisionId = await ctx.db.insert('studyPlanRevisions', {
      userId, studyPlanId, learningVoidId, revision: 1, recordRevision: 5, status: 'accepted',
      blueprintRevisionId, blueprintRecordRevision: 3, createdAt: now,
    })
    await ctx.db.patch(studyPlanId, { activeRevisionId: studyPlanRevisionId })
    const studySessionId = await ctx.db.insert('studySessions', {
      userId, studyPlanRevisionId, primaryObjectiveId: objectiveId, status: 'ready', revision: 2,
      scheduledStartAt: now - 1_000, timezone: 'UTC',
    })
    const sessionContentId = await ctx.db.insert('sessionContent', {
      userId, studySessionId, studyPlanRevisionId, blueprintRevisionId, objectiveId,
      revision: 1, status: 'published', inputDigest: `sha256:${'a'.repeat(64)}`,
      generatorVersion: 'learn-v2.session-content.v1', providerModel: 'synthetic/session-model',
      assessmentRubricSnapshot: JSON.stringify(assessmentContract), createdAt: now, publishedAt: now,
    })
    await ctx.db.insert('sessionContentBlocks', {
      userId, sessionContentId, order: 0, kind: 'explanation',
      content: 'Gravity attracts masses.', claimOrdersJson: '[0]',
    })
    await ctx.db.insert('sessionContentBlocks', {
      userId, sessionContentId, order: 1, kind: 'independent_application',
      content: 'Explain why an apple falls.', claimOrdersJson: '[0]',
    })
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', {
      userId, learningVoidId, origin: 'user_url', externalKey: 'gravity-source',
    })
    const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', {
      userId, sourceIdentityId, learningVoidId, blueprintRevisionId, revision: 1, recordRevision: 1,
      status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted',
      conflictStatus: 'clear', createdAt: now,
    })
    await ctx.db.insert('learnObjectiveSources', { userId, objectiveId, sourceSnapshotId, coverage: 'strong' })
    const sourceExcerptId = await ctx.db.insert('learnSourceExcerpts', {
      userId, sourceSnapshotId, locator: 'p:1', excerpt: 'Gravity attracts masses.', rightsStatus: 'permitted',
    })
    const claimId = await ctx.db.insert('sessionContentClaims', {
      userId, sessionContentId, order: 0, claim: 'Gravity attracts masses.',
      verifierVersion: 'learn-v2.entailment.v2', confidence: 0.95,
    })
    await ctx.db.insert('learnClaimSupports', {
      userId, sessionContentClaimId: claimId, sourceExcerptId, sourceSnapshotId,
      entailment: 'entailed', verifierVersion: 'learn-v2.entailment.v2', confidence: 0.95,
      conflictStatus: 'clear', evidenceStatus: 'evidence_available',
    })
    return { studySessionId, sourceSnapshotId }
  })
  const attached = await owner.mutation(api.learnAdaptiveCanvas.attachReadySession, {
    studySessionId: ids.studySessionId, expectedSessionRevision: 2,
    idempotencyKey: 'experiment-v2-ready-attachment-0001',
  })
  const planId = await t.mutation(internal.learnAdaptiveExperiment.freezeAnalysisPlan, { plan: SYNTHETIC_PLAN })
  await t.mutation(internal.learnAdaptiveExperiment.recordApproval, {
    planId, productAnalyticsReference: 'synthetic-analytics-approval',
    productReference: 'synthetic-product-approval', qaReference: 'synthetic-qa-verification',
    engineeringReference: 'synthetic-engineering-replay',
  })
  return { t, owner, ids, threadId: attached.threadId }
}

test.each(['revised', 'purged'] as const)(
  'an assigned ready V2 mission fails closed when its source is %s despite cached readiness',
  async (sourceChange) => {
    const { t, owner, ids, threadId } = await readyMissionFixture()
    const first = await owner.mutation(api.learnAdaptiveExperiment.assignForThread, { threadId })
    expect(first).toMatchObject({ kind: 'assigned', eligibility: 'eligible', cohort: expect.stringMatching(/^(adaptive|fixed)$/) })
    const originalAssignments = await owner.query(api.dataExport.getUserDataPage, {
      collection: 'learnAdaptiveExperimentAssignments', paginationOpts: { numItems: 8, cursor: null },
    })
    expect(originalAssignments.page).toHaveLength(1)

    // Simulate a later source authority change without refreshing the cached thread projection.
    await t.run(async ctx => {
      await ctx.db.patch(ids.sourceSnapshotId, sourceChange === 'revised'
        ? { recordRevision: 2 }
        : { evidencePurgedAt: Date.now() })
    })
    const threadExport = await owner.query(api.dataExport.getUserDataPage, {
      collection: 'learningThreads', paginationOpts: { numItems: 8, cursor: null },
    })
    expect(threadExport.page).toEqual([expect.objectContaining({
      _id: threadId, authorityKind: 'v2_mission', lifecycle: 'ready', evidenceState: 'ready',
    })])

    const excluded = {
      kind: 'excluded', reason: 'safety_prerequisite_missing', analysisVersion: 'adaptive-routing-analysis.v1',
    }
    expect(await owner.mutation(api.learnAdaptiveExperiment.assignForThread, { threadId })).toEqual(excluded)
    expect(await owner.mutation(api.learnAdaptiveExperiment.assignForThread, { threadId })).toEqual(excluded)
    const assignmentsAfter = await owner.query(api.dataExport.getUserDataPage, {
      collection: 'learnAdaptiveExperimentAssignments', paginationOpts: { numItems: 8, cursor: null },
    })
    expect(assignmentsAfter.page).toEqual(originalAssignments.page)
    expect(await owner.query(api.learnAdaptiveExperiment.getMyStatus, { threadId }))
      .toMatchObject({ exposure: 'off', assignment: first })

    const events = await owner.query(api.dataExport.getUserDataPage, {
      collection: 'learnActivityEvents', paginationOpts: { numItems: 8, cursor: null },
    })
    expect(events.isDone).toBe(true)
    expect(events.page.filter(event => 'eventType' in event && event.eventType === 'experiment_assignment')).toEqual([
      expect.objectContaining({ outcomeCode: 'assigned' }),
      expect.objectContaining({
        eventVersion: 'experiment_assignment.v1', contractVersion: 'learn-adaptive.experiment-assignment.v1',
        reasonCode: 'safety_prerequisite_missing', outcomeCode: 'excluded',
        metadata: {
          cohort: 'excluded', experimentEligibility: 'excluded',
          experimentExclusionCode: 'safety_prerequisite_missing',
          experimentAnalysisVersion: 'adaptive-routing-analysis.v1',
          experimentEligibilityVersion: 'learn-adaptive.experiment-eligibility.v1',
          experimentExclusionVersion: 'learn-adaptive.experiment-exclusion.v1',
          experimentAssignmentUnit: 'authenticated_learner',
        },
      }),
    ])
    expect(JSON.stringify(events.page)).not.toMatch(/semanticKey|dedupeKeyHash|tokenIdentifier|sourcePayload|providerPayload|Gravity attracts masses/)
    const otherEvents = await t.withIdentity({ tokenIdentifier: OTHER }).query(api.dataExport.getUserDataPage, {
      collection: 'learnActivityEvents', paginationOpts: { numItems: 8, cursor: null },
    })
    expect(otherEvents.page).toEqual([])
  },
)
