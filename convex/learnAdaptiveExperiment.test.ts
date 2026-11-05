/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const OWNER = 'https://auth.example.com|adaptive-experiment-owner'
const previousLearnFlag = process.env.LEARN_V2_ENABLED

beforeAll(() => { process.env.LEARN_V2_ENABLED = 'true' })
afterAll(() => {
  if (previousLearnFlag === undefined) delete process.env.LEARN_V2_ENABLED
  else process.env.LEARN_V2_ENABLED = previousLearnFlag
})

async function fixture() {
  const t = convexTest(schema, modules)
  const threadId = await t.run(async ctx => {
    await ctx.db.insert('users', { tokenIdentifier: OWNER, name: 'Experiment owner',
      learnV2Entitlement: { enabled: true, updatedAt: 1 },
      learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: 1 } })
    return await ctx.db.insert('learningThreads', {
      userId: OWNER, originalNeed: 'Find a useful next step.', intent: 'explore',
      availableTime: '25', authorityKind: 'standalone', sourceScope: { kind: 'none' },
      evidenceState: 'none', lifecycle: 'ready', revision: 1, createdAt: 1, updatedAt: 1,
    })
  })
  return { t, threadId, owner: t.withIdentity({ tokenIdentifier: OWNER }) }
}

const SYNTHETIC_PLAN = {
  version: 'adaptive-routing-analysis.v1' as const, fixedContinuationVersion: 'synthetic-fixed.v1',
  primaryOutcomeVersion: 'synthetic-representative-task.v1', eligibilityVersion: 'learn-adaptive.experiment-eligibility.v1',
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

async function approveSyntheticPlan(t: Awaited<ReturnType<typeof fixture>>['t']) {
  const planId = await t.mutation(internal.learnAdaptiveExperiment.freezeAnalysisPlan, { plan: SYNTHETIC_PLAN })
  await t.mutation(internal.learnAdaptiveExperiment.recordApproval, {
    planId, productAnalyticsReference: 'synthetic-analytics-approval',
    productReference: 'synthetic-product-approval', qaReference: 'synthetic-qa-verification',
    engineeringReference: 'synthetic-engineering-replay',
  })
  return planId
}

test.each([
  { eligibilityVersion: 'unimplemented-eligibility.v2' },
  { assignmentUnit: 'learning_thread' },
])('assignment fails closed when the frozen contract is unsupported: %j', async (unsupported) => {
  const { t, owner, threadId } = await fixture()
  const planId = await approveSyntheticPlan(t)
  await t.run(ctx => ctx.db.patch(planId, { plan: { ...SYNTHETIC_PLAN, ...unsupported } }))
  const priorFlag = process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
  process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED = 'true'
  try {
    expect(await owner.mutation(api.learnAdaptiveExperiment.assignForThread, { threadId }))
      .toMatchObject({ kind: 'excluded', reason: 'analysis_contract_unsupported' })
  }
  finally {
    if (priorFlag === undefined) delete process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
    else process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED = priorFlag
  }
  expect(await owner.query(api.learnAdaptiveExperiment.getMyStatus, { threadId }))
    .toMatchObject({ exposure: 'off', assignment: null })
  const events = await owner.query(api.dataExport.getUserDataPage, {
    collection: 'learnActivityEvents', paginationOpts: { numItems: 8, cursor: null },
  })
  expect(events.page).toEqual([expect.objectContaining({ reasonCode: 'analysis_contract_unsupported' })])
})

test('the experiment stays unassigned and unexposed without an approved analysis', async () => {
  const { owner, threadId } = await fixture()
  const priorFlag = process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
  delete process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
  try {
    expect(await owner.mutation(api.learnAdaptiveExperiment.assignForThread, { threadId }))
      .toEqual({ kind: 'excluded', reason: 'experiment_disabled', analysisVersion: 'adaptive-routing-analysis.v1' })
  }
  finally {
    if (priorFlag === undefined) delete process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
    else process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED = priorFlag
  }
  expect(await owner.query(api.learnAdaptiveExperiment.getMyStatus, { threadId }))
    .toEqual({ analysisVersion: 'adaptive-routing-analysis.v1', exposure: 'off', assignment: null })
  const events = await owner.query(api.dataExport.getUserDataPage, {
    collection: 'learnActivityEvents', paginationOpts: { numItems: 8, cursor: null },
  })
  expect(events.page).toEqual([])
})

test('public experiment APIs reject another entitled learner thread', async () => {
  const { t, threadId } = await fixture()
  const otherUser = 'https://auth.example.com|adaptive-experiment-visitor'
  await t.run(ctx => ctx.db.insert('users', { tokenIdentifier: otherUser, name: 'Visitor',
    learnV2Entitlement: { enabled: true, updatedAt: 1 },
    learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: 1 } }))
  const other = t.withIdentity({ tokenIdentifier: otherUser })
  await expect(other.mutation(api.learnAdaptiveExperiment.assignForThread, { threadId })).rejects.toThrow(/thread access denied/i)
  await expect(other.query(api.learnAdaptiveExperiment.getMyStatus, { threadId })).rejects.toThrow(/thread access denied/i)
  await expect(other.query(api.learnAdaptiveExperiment.getGuardrailStatus, { threadId })).rejects.toThrow(/thread access denied/i)
})

test('the enabled assignment path records a bounded exclusion when analysis is unapproved', async () => {
  const { owner, threadId } = await fixture()
  const priorFlag = process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
  process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED = 'true'
  try {
    expect(await owner.mutation(api.learnAdaptiveExperiment.assignForThread, { threadId }))
      .toEqual({ kind: 'excluded', reason: 'analysis_unapproved', analysisVersion: 'adaptive-routing-analysis.v1' })
  }
  finally {
    if (priorFlag === undefined) delete process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
    else process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED = priorFlag
  }
  const events = await owner.query(api.dataExport.getUserDataPage, {
    collection: 'learnActivityEvents', paginationOpts: { numItems: 8, cursor: null },
  })
  expect(events.page).toEqual([expect.objectContaining({ eventType: 'experiment_assignment',
    metadata: { cohort: 'excluded', experimentEligibility: 'excluded',
      experimentExclusionCode: 'analysis_unapproved', experimentAnalysisVersion: 'adaptive-routing-analysis.v1',
      experimentEligibilityVersion: 'learn-adaptive.experiment-eligibility.v1',
      experimentExclusionVersion: 'learn-adaptive.experiment-exclusion.v1',
      experimentAssignmentUnit: 'authenticated_learner' } })])
  expect(await owner.query(api.learnAdaptiveExperiment.getMyStatus, { threadId }))
    .toMatchObject({ exposure: 'off', assignment: null })
})

test('an approved synthetic analysis yields a stable server-owned assignment', async () => {
  const { t, owner, threadId } = await fixture()
  const priorFlag = process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
  process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED = 'true'
  try {
    await approveSyntheticPlan(t)
    const first = await owner.mutation(api.learnAdaptiveExperiment.assignForThread, { threadId })
    expect(first).toMatchObject({ kind: 'assigned', analysisVersion: 'adaptive-routing-analysis.v1',
      cohort: expect.stringMatching(/^(adaptive|fixed)$/), eligibility: 'eligible' })
    if (first.kind !== 'assigned') throw new Error('Expected an assigned cohort')
    expect(await owner.mutation(api.learnAdaptiveExperiment.assignForThread, { threadId })).toEqual(first)
    expect(await owner.query(api.learnAdaptiveExperiment.getMyStatus, { threadId }))
      .toMatchObject({ analysisVersion: 'adaptive-routing-analysis.v1', exposure: 'off', assignment: first })
    const events = await owner.query(api.dataExport.getUserDataPage, {
      collection: 'learnActivityEvents', paginationOpts: { numItems: 8, cursor: null },
    })
    expect(events.page).toEqual([expect.objectContaining({
      eventType: 'experiment_assignment', eventVersion: 'experiment_assignment.v1',
      contractVersion: 'learn-adaptive.experiment-assignment.v1',
      metadata: { cohort: first.cohort, experimentEligibility: 'eligible',
        experimentAnalysisVersion: 'adaptive-routing-analysis.v1',
        experimentEligibilityVersion: 'learn-adaptive.experiment-eligibility.v1',
        experimentExclusionVersion: 'learn-adaptive.experiment-exclusion.v1',
        experimentAssignmentUnit: 'authenticated_learner' },
    })])
    expect(JSON.stringify(events.page)).not.toMatch(/originalNeed|semanticKey|dedupeKeyHash|tokenIdentifier|sourcePayload|providerPayload/)
  }
  finally {
    if (priorFlag === undefined) delete process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
    else process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED = priorFlag
  }
})

test('the public export shows only the owner assignment and account deletion removes it', async () => {
  const { t, owner, threadId } = await fixture()
  const planId = await approveSyntheticPlan(t)
  const priorFlag = process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
  process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED = 'true'
  try {
    await owner.mutation(api.learnAdaptiveExperiment.assignForThread, { threadId })
  }
  finally {
    if (priorFlag === undefined) delete process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
    else process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED = priorFlag
  }
  const otherUser = 'https://auth.example.com|adaptive-experiment-other'
  const otherId = await t.run(ctx => ctx.db.insert('learnAdaptiveExperimentAssignments', {
    userId: otherUser, planId, analysisVersion: 'adaptive-routing-analysis.v1', cohort: 'fixed',
    eligibility: 'eligible', contractVersion: 'learn-adaptive.experiment-assignment.v1', assignedAt: 2,
    eligibilityVersion: 'learn-adaptive.experiment-eligibility.v1', assignmentUnit: 'authenticated_learner',
  }))
  const ownerPage = await owner.query(api.dataExport.getUserDataPage, {
    collection: 'learnAdaptiveExperimentAssignments', paginationOpts: { numItems: 8, cursor: null },
  })
  expect(ownerPage.page).toEqual([expect.objectContaining({ userId: OWNER,
    analysisVersion: 'adaptive-routing-analysis.v1', eligibility: 'eligible',
    assignmentUnit: 'authenticated_learner', eligibilityVersion: 'learn-adaptive.experiment-eligibility.v1' })])
  expect(JSON.stringify(ownerPage.page)).not.toMatch(/planId|originalNeed|tokenIdentifier/)
  const ownerId = ownerPage.page[0]!._id
  const otherPage = await t.withIdentity({ tokenIdentifier: otherUser }).query(api.dataExport.getUserDataPage, {
    collection: 'learnAdaptiveExperimentAssignments', paginationOpts: { numItems: 8, cursor: null },
  })
  expect(otherPage.page.map(row => row._id)).toEqual([otherId])
  await t.run(ctx => ctx.db.insert('accountDeletionJobs', {
    userId: OWNER, status: 'active', phase: 'learnV2', startedAt: 1, updatedAt: 1,
  }))
  await t.mutation(internal.accountDeletion.runDeletionBatch, { userId: OWNER })
  expect(await t.run(ctx => ctx.db.get(ownerId))).toBeNull()
  expect(await t.run(ctx => ctx.db.get(otherId))).not.toBeNull()
})

test('accessibility degradation independently emits a non-qualifying rollback trigger', async () => {
  const { t, owner, threadId } = await fixture()
  const planId = await approveSyntheticPlan(t)
  const priorFlag = process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
  process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED = 'true'
  try {
    await owner.mutation(api.learnAdaptiveExperiment.assignForThread, { threadId })
  }
  finally {
    if (priorFlag === undefined) delete process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
    else process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED = priorFlag
  }
  const result = await t.mutation(internal.learnAdaptiveExperiment.evaluateGuardrails, {
    planId, snapshotKey: 'synthetic-accessibility-regression',
    evidenceDigest: `sha256:${'a'.repeat(64)}`, snapshotSourceVersion: 'synthetic-qa-guardrails.v1',
    accessibility: { adaptiveSuccesses: 69, adaptiveEligible: 100, fixedSuccesses: 73, fixedEligible: 100 },
    recovery: { adaptiveSuccesses: 80, adaptiveEligible: 100, fixedSuccesses: 80, fixedEligible: 100 },
  })
  expect(result).toMatchObject({ status: 'non_qualifying', rollbackTrigger: true,
    reasons: ['accessibility_degradation'],
    rollbackSignal: { version: 'learn-adaptive.experiment-rollback-signal.v1',
      action: 'disable_adaptive_exposure', cohort: 'adaptive', delivery: 'pending',
      reasons: ['accessibility_degradation'], signalId: expect.any(String) } })
  expect(await owner.query(api.learnAdaptiveExperiment.getGuardrailStatus, { threadId }))
    .toMatchObject({ status: 'non_qualifying', rollbackTrigger: true,
      reasons: ['accessibility_degradation'], analysisVersion: 'adaptive-routing-analysis.v1',
      rollbackSignal: result.rollbackSignal })
  const later = await t.mutation(internal.learnAdaptiveExperiment.evaluateGuardrails, {
    planId, snapshotKey: 'synthetic-accessibility-later-pass',
    evidenceDigest: `sha256:${'0'.repeat(64)}`, snapshotSourceVersion: 'synthetic-qa-guardrails.v1',
    accessibility: { adaptiveSuccesses: 80, adaptiveEligible: 100, fixedSuccesses: 80, fixedEligible: 100 },
    recovery: { adaptiveSuccesses: 80, adaptiveEligible: 100, fixedSuccesses: 80, fixedEligible: 100 },
  })
  expect(later.rollbackSignal).toEqual(result.rollbackSignal)
  expect(await owner.query(api.learnAdaptiveExperiment.getGuardrailStatus, { threadId }))
    .toEqual(result)
})

test('an unsafe thread is excluded with bounded, owner-visible telemetry', async () => {
  const { t, owner, threadId } = await fixture()
  await approveSyntheticPlan(t)
  await t.run(ctx => ctx.db.patch(threadId, { lifecycle: 'paused' }))
  const priorFlag = process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
  process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED = 'true'
  try {
    expect(await owner.mutation(api.learnAdaptiveExperiment.assignForThread, { threadId }))
      .toEqual({ kind: 'excluded', reason: 'safety_prerequisite_missing', analysisVersion: 'adaptive-routing-analysis.v1' })
  }
  finally {
    if (priorFlag === undefined) delete process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
    else process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED = priorFlag
  }
  const events = await owner.query(api.dataExport.getUserDataPage, {
    collection: 'learnActivityEvents', paginationOpts: { numItems: 8, cursor: null },
  })
  expect(events.page).toEqual([expect.objectContaining({ eventType: 'experiment_assignment',
    metadata: { cohort: 'excluded', experimentEligibility: 'excluded',
      experimentExclusionCode: 'safety_prerequisite_missing', experimentAnalysisVersion: 'adaptive-routing-analysis.v1',
      experimentEligibilityVersion: 'learn-adaptive.experiment-eligibility.v1',
      experimentExclusionVersion: 'learn-adaptive.experiment-exclusion.v1',
      experimentAssignmentUnit: 'authenticated_learner' } })])
  expect(await owner.query(api.learnAdaptiveExperiment.getMyStatus, { threadId }))
    .toMatchObject({ exposure: 'off', assignment: null })
})

test.each(['missing', 'foreign'] as const)('assignment rechecks a %s source despite cached ready evidence', async (sourceState) => {
  const { t, owner, threadId } = await fixture()
  await approveSyntheticPlan(t)
  await t.run(async (ctx) => {
    const sourceId = await ctx.db.insert('folders', {
      userId: sourceState === 'foreign' ? 'https://auth.example.com|other' : OWNER,
      name: 'Private source fixture', documentCount: 0,
    })
    await ctx.db.patch(threadId, { sourceScope: { kind: 'folder', sourceId }, evidenceState: 'ready' })
    if (sourceState === 'missing') await ctx.db.delete(sourceId)
  })
  const priorFlag = process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
  process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED = 'true'
  try {
    expect(await owner.mutation(api.learnAdaptiveExperiment.assignForThread, { threadId }))
      .toMatchObject({ kind: 'excluded', reason: 'safety_prerequisite_missing' })
  }
  finally {
    if (priorFlag === undefined) delete process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
    else process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED = priorFlag
  }
  expect(await owner.query(api.learnAdaptiveExperiment.getMyStatus, { threadId }))
    .toMatchObject({ exposure: 'off', assignment: null })
})

test('a cached ready V2 thread without current factual authority is excluded', async () => {
  const { t, owner, threadId } = await fixture()
  await approveSyntheticPlan(t)
  await t.run(ctx => ctx.db.patch(threadId, { authorityKind: 'v2_mission', evidenceState: 'ready' }))
  const priorFlag = process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
  process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED = 'true'
  try {
    expect(await owner.mutation(api.learnAdaptiveExperiment.assignForThread, { threadId }))
      .toMatchObject({ kind: 'excluded', reason: 'safety_prerequisite_missing' })
  }
  finally {
    if (priorFlag === undefined) delete process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
    else process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED = priorFlag
  }
})

test.each([
  ['exactly three points', { adaptiveSuccesses: 70, adaptiveEligible: 100, fixedSuccesses: 73, fixedEligible: 100 },
    { adaptiveSuccesses: 80, adaptiveEligible: 100, fixedSuccesses: 80, fixedEligible: 100 },
    'guardrails_passed', []],
  ['recovery drops four points', { adaptiveSuccesses: 80, adaptiveEligible: 100, fixedSuccesses: 80, fixedEligible: 100 },
    { adaptiveSuccesses: 69, adaptiveEligible: 100, fixedSuccesses: 73, fixedEligible: 100 },
    'non_qualifying', ['recovery_degradation']],
  ['too little evidence', { adaptiveSuccesses: 3, adaptiveEligible: 5, fixedSuccesses: 3, fixedEligible: 5 },
    { adaptiveSuccesses: 3, adaptiveEligible: 5, fixedSuccesses: 3, fixedEligible: 5 },
    'insufficient_evidence', []],
] as const)('%s guardrail evaluation is independent of the primary outcome', async (name, accessibility, recovery, status, reasons) => {
  const { t } = await fixture()
  const planId = await approveSyntheticPlan(t)
  expect(await t.mutation(internal.learnAdaptiveExperiment.evaluateGuardrails, {
    planId, snapshotKey: name.replaceAll(' ', '-'), evidenceDigest: `sha256:${'b'.repeat(64)}`,
    snapshotSourceVersion: 'synthetic-qa-guardrails.v1', accessibility, recovery,
  })).toMatchObject({ status, rollbackTrigger: status === 'non_qualifying', reasons })
})

test('a guardrail snapshot is idempotent and conflicting replay is rejected', async () => {
  const { t } = await fixture()
  const planId = await approveSyntheticPlan(t)
  const snapshot = {
    planId, snapshotKey: 'synthetic-stable-snapshot', evidenceDigest: `sha256:${'c'.repeat(64)}`,
    snapshotSourceVersion: 'synthetic-qa-guardrails.v1',
    accessibility: { adaptiveSuccesses: 80, adaptiveEligible: 100, fixedSuccesses: 80, fixedEligible: 100 },
    recovery: { adaptiveSuccesses: 69, adaptiveEligible: 100, fixedSuccesses: 73, fixedEligible: 100 },
  }
  const first = await t.mutation(internal.learnAdaptiveExperiment.evaluateGuardrails, snapshot)
  expect(first.rollbackSignal).toMatchObject({ delivery: 'pending', action: 'disable_adaptive_exposure' })
  expect(await t.mutation(internal.learnAdaptiveExperiment.evaluateGuardrails, snapshot)).toEqual(first)
  await expect(t.mutation(internal.learnAdaptiveExperiment.evaluateGuardrails, {
    ...snapshot, evidenceDigest: `sha256:${'d'.repeat(64)}`,
  })).rejects.toThrow(/conflicts with prior evaluation/i)
})

test('a rollback trigger stops later assignment and cannot be cleared by a passing snapshot', async () => {
  const { t, owner, threadId } = await fixture()
  const planId = await approveSyntheticPlan(t)
  const observation = { adaptiveSuccesses: 69, adaptiveEligible: 100, fixedSuccesses: 73, fixedEligible: 100 }
  const pass = { adaptiveSuccesses: 80, adaptiveEligible: 100, fixedSuccesses: 80, fixedEligible: 100 }
  await t.mutation(internal.learnAdaptiveExperiment.evaluateGuardrails, {
    planId, snapshotKey: 'synthetic-rollback', evidenceDigest: `sha256:${'e'.repeat(64)}`,
    snapshotSourceVersion: 'synthetic-qa-guardrails.v1', accessibility: observation, recovery: pass,
  })
  await t.mutation(internal.learnAdaptiveExperiment.evaluateGuardrails, {
    planId, snapshotKey: 'synthetic-later-pass', evidenceDigest: `sha256:${'f'.repeat(64)}`,
    snapshotSourceVersion: 'synthetic-qa-guardrails.v1', accessibility: pass, recovery: pass,
  })
  const priorFlag = process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
  process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED = 'true'
  try {
    expect(await owner.mutation(api.learnAdaptiveExperiment.assignForThread, { threadId }))
      .toEqual({ kind: 'excluded', reason: 'guardrail_rollback', analysisVersion: 'adaptive-routing-analysis.v1' })
  }
  finally {
    if (priorFlag === undefined) delete process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED
    else process.env.ADAPTIVE_ROUTING_EXPERIMENT_ENABLED = priorFlag
  }
  expect(await owner.query(api.learnAdaptiveExperiment.getMyStatus, { threadId }))
    .toMatchObject({ exposure: 'off', assignment: null })
  expect(await owner.query(api.learnAdaptiveExperiment.getGuardrailStatus, { threadId })).toBeNull()
  const events = await owner.query(api.dataExport.getUserDataPage, {
    collection: 'learnActivityEvents', paginationOpts: { numItems: 8, cursor: null },
  })
  expect(events.page).toEqual([expect.objectContaining({ eventType: 'experiment_assignment',
    metadata: { cohort: 'excluded', experimentEligibility: 'excluded',
      experimentExclusionCode: 'guardrail_rollback', experimentAnalysisVersion: 'adaptive-routing-analysis.v1',
      experimentEligibilityVersion: 'learn-adaptive.experiment-eligibility.v1',
      experimentExclusionVersion: 'learn-adaptive.experiment-exclusion.v1',
      experimentAssignmentUnit: 'authenticated_learner' } })])
})
