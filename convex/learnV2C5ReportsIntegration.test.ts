import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { makeFunctionReference } from 'convex/server'
import { api, internal } from './_generated/api'
import { assessmentDeliveryFixture, deliveryIdentity, publishDeliveryTeaching, syntheticDeliveryProtocol } from '../tests/fixtures/learn-v2-assessment-delivery'
import { replaceMeasurementOpportunity } from '../tests/fixtures/learn-v2-measurement-replacement'
import { sealedMeasurementReportInput } from '../tests/fixtures/learn-v2-measurement-report-run'
import { learnDueCron, runLearnDueCron } from '../tests/fixtures/learn-v2-due-cron'
import { enqueueLearnDueWork } from './lib/learnV2DueWorkQueue'
import { createLearnScorerRegistry, sealLearnScorerConfiguration } from './lib/learnV2ScorerConfig'
import { LEARN_REPORT_APPROVALS, reportControl } from './lib/learnV2MeasurementReportAccess'
import { LEARN_V2_PUBLIC_API_VERSION } from './lib/learnV2PublicContract'
import { LEARN_V2_RESPONSE_CONTRACT_VERSION } from '../shared/learn-v2-responses'
import { LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION,
  LEARN_V2_MEASUREMENT_REPORT_VERSION, buildLearningMeasurementReport, buildPublishedLearningMeasurementReport } from '../shared/learn-v2-measurement-report'

const policy = vi.hoisted(() => ({ protocol: null as unknown, scorer: null as unknown, responses: true }))
vi.mock('../shared/learn-v2-measurement-storage-manifest', async original => {
  const value = await original<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...value, LEARN_MEASUREMENT_CAPABILITIES: { ...value.LEARN_MEASUREMENT_CAPABILITIES,
    get responses() { return policy.responses }, enrollment: true, delivery: true, scoring: true, reports: true } }
})
vi.mock('./lib/learnV2MeasurementAssignment', async original => {
  const value = await original<typeof import('./lib/learnV2MeasurementAssignment')>()
  return { ...value, getFrozenLearnMeasurementProtocol: () => policy.protocol }
})
vi.mock('./lib/learnV2MeasurementScorerInventory', () => ({ getLearnMeasurementScorer: async () => policy.scorer }))

const START = Date.parse('2027-03-07T15:00:00Z')
const viewerIdentity = { tokenIdentifier: 'https://report.example|c5-integration-owner', subject: 'c5-integration-owner' }
const userId = deliveryIdentity.tokenIdentifier
const due = makeFunctionReference<'mutation', { userId: string, through?: number }>('learnV2MeasurementDueWork:materializeDelayedCheckEligibility')
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); policy.protocol = syntheticDeliveryProtocol(); policy.responses = true; LEARN_REPORT_APPROVALS.splice(0) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); LEARN_REPORT_APPROVALS.splice(0) })

async function journey(reserve: boolean, shared?: Awaited<ReturnType<typeof assessmentDeliveryFixture>>['t'], identity = deliveryIdentity) {
  const userId = identity.tokenIdentifier
  const definition = { configurationId: 'today.synthetic', configurationVersion: 'today.synthetic.v1', kind: 'legacy_baseline' as const,
    requestedModel: 'synthetic/model', endpoint: null, identity: { mappingVersion: 'synthetic.identity.v1', canonicalModel: 'synthetic/model',
      family: 'synthetic', snapshotAssurance: 'unknown' as const, verifiedReturnedModels: [] } }
  const saved = await sealLearnScorerConfiguration(definition)
  const registry = await createLearnScorerRegistry({ epoch: 'synthetic.epoch.v1', configurations: [{ definition, expectedDigest: saved.binding.configurationDigest }],
    legacyAllowlist: [definition.configurationId], prospectiveConfigurationId: null })
  policy.scorer = { registry, saved }
  const f = await assessmentDeliveryFixture({ reserve, test: shared, identity })
  await publishDeliveryTeaching(f)
  await f.t.run(ctx => ctx.db.insert('learnMeasurementSourceWatermarks', { userId, storageVersion: 'learn-v2.measurement-storage.v1',
    createdAt: START, sourceVersion: LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, sequence: 0, dueWorkThrough: null,
    historyCoverage: 'complete', updatedAt: START }))
  const start = { studySessionId: f.graph.studySessionId, expectedSessionRevision: 2, expectedContentRevision: 1, entryPoint: 'today' as const,
    idempotencyKey: 'integration_cold_start_1234567890' }
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, start)).toMatchObject({ status: 'assessment', deliveryGrant: { status: 'granted' } })
  const opportunities = () => f.t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q => q.eq('userId', userId)).take(12))
  const cold = (await opportunities()).find(row => row.purpose.kind === 'measurement_cold')!
  const sealed = await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: 'integration_cold_seal_1234567890', response: { target: { assessmentOpportunityId: cold._id }, expectedRevision: cold.revision,
      payload: { kind: 'numeric', value: 0, unit: 'members' } } } })
  if (sealed.kind !== 'accepted') throw new Error('Expected cold acceptance')
  expect(await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: sealed.submissionId, idempotencyKey: 'integration_cold_score_1234567890' })).toMatchObject({ status: 'scored', result: { scorePercent: 0 } })
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, start)).toMatchObject({ status: 'in_progress' })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'synthetic-integration-execution', model: 'synthetic/model',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ criterionResults: [{ key: 'accuracy', awarded: true }], misconceptionTags: [] }) } }],
    openrouter_metadata: { requested: 'synthetic/model', strategy: 'direct', attempt: 1,
      endpoints: { available: [{ provider: 'Synthetic Provider', model: 'synthetic/model', selected: true }] }, pipeline: [] } }))))
  for (const name of ['OPENROUTER_API_KEY', 'CF_ACCOUNT_ID', 'CLOUDFLARE_AI_GATEWAY_ID']) vi.stubEnv(name, 'synthetic-unused')
  expect(await f.owner.action(api.learnV2Mastery.submitMasteryAttempt, { studySessionId: f.graph.studySessionId,
    expectedSessionRevision: 3, expectedContentRevision: 1, expectedPlanRecordRevision: 1, expectedBlueprintRecordRevision: 1,
    response: 'My separate-case application.', confidence: 3, idempotencyKey: 'integration_independent_1234567890' }))
    .toMatchObject({ status: 'completed', state: 'independent', scorePercent: 100 })
  const original = (await opportunities()).find(row => row.horizonDays === 7)!
  expect(original).toMatchObject({ originalSlot: true, checkSequence: 1, firstCheckClaim: { claimSequence: 1 } })
  return { ...f, opportunities, original, learnerId: userId }
}

async function play(f: Awaited<ReturnType<typeof journey>>, reserve: boolean, score: number) {
  const userId = f.learnerId
  await f.t.mutation(due, { userId, through: Date.now() })
  const originalBinding = (await f.opportunities()).find(row => row._id === f.original._id)!
  let targetId = f.original._id
  if (reserve) {
    await f.t.run(ctx => ctx.db.patch(f.original._id, { reasonCode: 'contaminated' }))
    const replacement = await f.owner.mutation(replaceMeasurementOpportunity, { assessmentOpportunityId: f.original._id, reason: 'contaminated' })
    if (replacement.status !== 'replaced') throw new Error('Expected validated reserve')
    targetId = replacement.assessmentOpportunityId
    await f.t.mutation(due, { userId, through: Date.now() })
  }
  const today = await f.owner.query(api.learnV2Today.getToday, {})
  expect(today).toMatchObject({ status: 'ready', assessment: { state: { assessmentOpportunityId: targetId } } })
  if (today.status !== 'ready') throw new Error('Expected check discovery')
  expect(await f.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: today.sessionId, expectedSessionRevision: today.sessionRevision,
    expectedContentRevision: today.content.revision, entryPoint: 'today', idempotencyKey: 'integration_delayed_start_1234567890' }))
    .toMatchObject({ status: 'assessment', deliveryGrant: { status: 'granted' } })
  const content = await f.owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: today.sessionId })
  if (!content || !('delivered' in content) || content.delivered?.status !== 'delivered') throw new Error('Expected delivered check')
  const numbers = /groups=(\d+), size=(\d+)/u.exec(content.delivered.declaredStimulus ?? '')!
  const target = (await f.opportunities()).find(row => row._id === targetId)!
  const accepted = await f.owner.mutation(api.learnV2Mastery.acceptMasterySubmission, { submission: { version: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    idempotencyKey: 'integration_delayed_seal_1234567890', response: { target: { assessmentOpportunityId: targetId }, expectedRevision: target.revision,
      payload: { kind: 'numeric', value: score ? Number(numbers[1]) * Number(numbers[2]) : 0, unit: 'members' } } } })
  if (accepted.kind !== 'accepted') throw new Error('Expected delayed acceptance')
  expect(await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: accepted.submissionId, idempotencyKey: 'integration_delayed_score_1234567890' })).toMatchObject({ status: 'scored', result: { scorePercent: score } })
  expect(await f.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: accepted.submissionId, idempotencyKey: 'integration_delayed_replay_1234567890' })).toMatchObject({ status: 'scored' })
  return { targetId, accepted, originalBinding, sealedContextPins: target.contextPins }
}

async function beginReport(f: Awaited<ReturnType<typeof journey>>, cohort: Awaited<ReturnType<typeof journey>>[], key: string, pinOnly = false) {
  if (!pinOnly) await runLearnDueCron(f.t)
  const protocol = syntheticDeliveryProtocol(START)
  if (!LEARN_REPORT_APPROVALS.length) LEARN_REPORT_APPROVALS.push({ tokenIdentifier: viewerIdentity.tokenIdentifier,
    principalBindingVersion: 'integration.binding.v1', grantVersion: 'integration.grant.v1',
    cohortVersion: protocol.cohortVersion, epoch: protocol.epoch, protocolVersion: protocol.version, baselineSha: protocol.baselineSha,
    frozenAt: protocol.enrollmentStartAt - 1, owners: cohort.map(learner => learner.learnerId), replacementPolicy: { kind: 'secondary_only' } })
  const grantId = await f.t.run(ctx => ctx.db.insert('learnMeasurementReportViewerGrants', { userId: viewerIdentity.tokenIdentifier,
    storageVersion: 'learn-v2.measurement-storage.v1', createdAt: Date.now(), cohortVersion: protocol.cohortVersion, epoch: protocol.epoch,
    principalBindingVersion: 'integration.binding.v1', grantVersion: 'integration.grant.v1', status: 'active', grantedAt: Date.now(), expiresAt: Date.now() + 86_400_000 }))
  const viewer = f.t.withIdentity(viewerIdentity)
  const request = { version: LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, viewerGrantId: grantId, idempotencyKey: key,
    enrollmentStartAt: protocol.enrollmentStartAt, enrollmentEndAt: protocol.enrollmentEndAt, cutoff: Date.now() }
  const report = await viewer.mutation(api.learnV2MeasurementReports.requestReport, request)
  if (report.status !== 'requested') throw new Error('Expected report request')
  for (let batch = 0; batch < Math.ceil(cohort.length / 8); batch++)
    await f.t.mutation(internal.learnV2MeasurementReports.pinReportOwners, { reportRunId: report.reportRunId })
  if (pinOnly) return { viewer, reportRunId: report.reportRunId }
  for (let batch = 0; batch < cohort.length * 16; batch++) {
    const run = (await f.t.run(ctx => ctx.db.get(report.reportRunId)))!
    if (run.status !== 'building' || reportControl(run).phase !== 'extracting') break
    await f.t.action(internal.learnV2MeasurementReports.buildReportBatch, { reportRunId: report.reportRunId })
  }
  await f.t.action(internal.learnV2MeasurementReports.finalizeReport, { reportRunId: report.reportRunId })
  const manifest = await viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version: LEARN_V2_MEASUREMENT_REPORT_VERSION, reportRunId: report.reportRunId })
  expect(manifest, JSON.stringify(manifest)).toMatchObject({ status: 'sealed' })
  return { viewer, reportRunId: report.reportRunId }
}

async function cohortJourney(reserve: boolean, count: number) {
  const first = await journey(reserve)
  const cohort = [first]
  for (let index = 1; index < count; index++) cohort.push(await journey(false, first.t,
    { subject: `integration-${index}`, tokenIdentifier: `https://auth.example|integration-${index}` }))
  return cohort
}

test('C6 pin-time coverage stays unknown with pending retries and becomes complete after the durable work drains', async () => {
  const cohort = await cohortJourney(false, 5)
  const f = cohort[0]!
  vi.setSystemTime(f.original.openAt)
  const watermark = (await f.t.run(ctx => ctx.db.query('learnMeasurementSourceWatermarks').withIndex('by_userId', q => q.eq('userId', f.learnerId)).unique()))!
  await f.t.run(async ctx => {
    await ctx.db.patch(watermark._id, { dueWorkThrough: Date.now() })
    const pending = await ctx.db.query('learnMeasurementDueWork').withIndex('by_userId_and_state_and_dueAt', q =>
      q.eq('userId', f.learnerId).eq('state', 'pending')).take(16)
    expect(pending.length).toBeGreaterThan(0)
    for (const row of pending) await ctx.db.patch(row._id, { nextAttemptAt: Date.now() + 60_000 })
  })
  const first = await beginReport(f, cohort, 'pending_due_work_report_1234567890', true)
  const before = await f.t.run(ctx => ctx.db.query('learnMeasurementReportRows').withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', first.reportRunId)).take(8))
  expect(before).toHaveLength(5)
  for (const row of before) expect(row.snapshot).toMatchObject({ kind: 'owner_watermark', dueWorkThrough: null })
  expect(await f.t.run(ctx => ctx.db.get(first.reportRunId))).toMatchObject({ sourceCoverage: 'unknown' })
  policy.responses = false
  vi.setSystemTime(Date.now() + 1)
  const paused = await beginReport(f, cohort, 'paused_due_work_report_1234567890', true)
  const pausedPins = await f.t.run(ctx => ctx.db.query('learnMeasurementReportRows').withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', paused.reportRunId)).take(8))
  expect(pausedPins).toHaveLength(5)
  for (const row of pausedPins) expect(row.snapshot).toMatchObject({ kind: 'owner_watermark', dueWorkThrough: null })
  policy.responses = true
  vi.setSystemTime(Date.now() + 60_000)
  await runLearnDueCron(f.t)
  expect(await f.t.run(ctx => ctx.db.query('learnMeasurementDueWork').withIndex('by_userId_and_state_and_dueAt', q =>
    q.eq('userId', f.learnerId).eq('state', 'pending')).take(16))).toEqual([])
  const drained = await beginReport(f, cohort, 'drained_due_work_report_1234567890')
  const covered = (await sealedMeasurementReportInput(f.t, drained.reportRunId)).rows.filter(row => row.kind === 'owner_watermark')
  expect(covered).toHaveLength(5)
  for (const row of covered) expect(row).toMatchObject({ dueWorkThrough: Date.now() })
  expect(await f.t.run(ctx => ctx.db.get(drained.reportRunId))).toMatchObject({ sourceCoverage: 'complete' })
  await f.t.run(async ctx => {
    await enqueueLearnDueWork(ctx, { userId: f.learnerId, key: 'exhausted', kind: 'owner', dueAt: Date.now() })
    const work = (await ctx.db.query('learnMeasurementDueWork').withIndex('by_userId_and_key', q => q.eq('userId', f.learnerId).eq('key', 'exhausted')).unique())!
    await ctx.db.patch(work._id, { state: 'terminal', attempts: 8, reasonCode: 'retries_exhausted' })
  })
  vi.setSystemTime(Date.now() + 1)
  const terminal = await beginReport(f, cohort, 'terminal_due_work_report_1234567890', true)
  expect(await f.t.run(ctx => ctx.db.get(terminal.reportRunId))).toMatchObject({ sourceCoverage: 'unknown' })
  const terminalPin = (await f.t.run(ctx => ctx.db.query('learnMeasurementReportRows').withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', terminal.reportRunId)).take(8))).find(row => row.userId === f.learnerId)
  expect(terminalPin?.snapshot).toMatchObject({ kind: 'owner_watermark', dueWorkThrough: null })
}, 30_000)

test('system-late undelivered checks remain missing outcomes in a sealed C6 report', async () => {
  const cohort = await cohortJourney(false, 5)
  const f = cohort[0]!
  const day30 = (await f.opportunities()).find(row => row.horizonDays === 30)!
  vi.setSystemTime(day30.closeAt + 86_400_000)
  await runLearnDueCron(f.t)
  for (const learner of cohort) {
    const originals = (await learner.opportunities()).filter(row => row.horizonDays)
    expect(originals).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'abandoned', reasonCode: 'system_due_work_late' })]))
    expect(originals.every(row => row.reasonCode === 'system_due_work_late')).toBe(true)
    expect(originals.some(row => row.contextPins.kind === 'session' && row.contextPins.generatorVersion === 'learn-v2.delayed-delivery.v1')).toBe(true)
    for (const row of originals) if (row.contextPins.kind === 'session' && row.contextPins.generatorVersion === 'learn-v2.delayed-delivery.v1') {
      const session = await f.t.run(ctx => ctx.db.get(row.contextPins.kind === 'session' ? row.contextPins.studySessionId : learner.graph.studySessionId))
      expect(session).toMatchObject({ status: 'cancelled', auditReasonCode: 'system_due_work_late' })
      expect(session).not.toHaveProperty('missedAt')
    }
  }
  const { reportRunId } = await beginReport(f, cohort, 'system_late_report_1234567890')
  const input = await sealedMeasurementReportInput(f.t, reportRunId)
  const episodes = input.rows.filter(row => row.kind === 'episode')
  expect(episodes).toHaveLength(10)
  for (const episode of episodes) expect(episode).toMatchObject({ disposition: 'missing_delayed', reasonCodes: ['system_due_work_late'], delayed: null })
  const built = await buildLearningMeasurementReport(input)
  expect(built.report.status).toBe('sealed')
  const cells = built.pages.flatMap(page => page.cells).filter(cell => cell.metric === 'verified_learning_gain.v1' && cell.stratum.startingBand === 'all')
  expect(cells.length).toBeGreaterThan(0)
  for (const cell of cells) {
    expect(cell.counts.dispositions.abandoned).toBe(0)
    expect(cell.counts.dispositions.missing_delayed).toBe(5)
    expect(cell.reasonCodes).toContain('system_due_work_late')
  }
  const claims = input.rows.filter(row => row.kind === 'first_check_claim_v2')
  expect(claims).toHaveLength(5)
  for (const claim of claims) expect(claim).toMatchObject({ firstSlot: { kind: 'linked', unresolvedReason: 'system_due_work_late', acceptance: null, result: null } })
  const published = await buildPublishedLearningMeasurementReport(input)
  const cellSets = [built.pages.flatMap(page => page.cells), published.pages.flatMap(page => page.cells)]
  for (const set of cellSets) {
    const falseMastery = set.filter(cell => cell.metric === 'false_mastery_next_delayed.v1' && cell.stratum.startingBand === 'all')
    expect(falseMastery.length).toBeGreaterThan(0)
    for (const cell of falseMastery) {
      expect(cell.counts).toMatchObject({ maturedClaims: 5, checkedClaims: 0, failedClaims: 0, dispositions: { missing_delayed: 5,
        reconciliation_required: 0, invalid_item_novelty: 0, abandoned: 0 } })
      expect(cell.populationState).toBe('known')
      expect(cell.missingOutcomeBounds).not.toBeNull()
      expect(cell.reasonCodes).toContain('system_due_work_late')
      expect(cell.reasonCodes).not.toContain('reconciliation_required')
    }
  }
  expect(await f.t.run(ctx => ctx.db.get(reportRunId))).toMatchObject({ sourceCoverage: 'complete' })
  const watermarks = () => f.t.run(ctx => ctx.db.query('learnMeasurementSourceWatermarks').take(16))
  const swept = await watermarks()
  expect(swept).toHaveLength(5)
  vi.setSystemTime(Date.now() + 86_400_000)
  const cron = learnDueCron()
  const idle = await f.t.mutation(async ctx => {
    const value = await ctx.runMutation(cron.reference, cron.args)
    return { value, metrics: await ctx.meta.getTransactionMetrics() }
  })
  expect(idle.value).toMatchObject({ status: 'complete', scheduledLearners: 0 })
  expect(idle.metrics.functionsScheduled.used).toBe(0)
  expect(await watermarks()).toEqual(swept)
  const later = await beginReport(f, cohort, 'system_late_later_report_1234567890')
  const pinned = (await sealedMeasurementReportInput(f.t, later.reportRunId)).rows.filter(row => row.kind === 'owner_watermark')
  expect(pinned).toHaveLength(5)
  for (const row of pinned) expect(row).toMatchObject({ dueWorkThrough: Date.now(), historyCoverage: 'complete' })
  expect(await f.t.run(ctx => ctx.db.get(later.reportRunId))).toMatchObject({ sourceCoverage: 'complete' })
}, 30_000)

test('report pinning leaves coverage unknown for an owner with an unapplied close edge', async () => {
  const cohort = await cohortJourney(false, 5)
  const f = cohort[0]!
  const day30 = (await f.opportunities()).find(row => row.horizonDays === 30)!
  vi.setSystemTime(day30.closeAt + 86_400_000)
  await runLearnDueCron(f.t)
  const swept = (await f.t.run(ctx => ctx.db.query('learnMeasurementSourceWatermarks').withIndex('by_userId', q => q.eq('userId', f.learnerId)).unique()))!
  vi.setSystemTime(Date.now() + 86_400_000)
  const lagging = cohort[1]!
  const stuck = (await lagging.opportunities()).find(row => row.horizonDays === 7)!
  await f.t.run(ctx => ctx.db.patch(stuck._id, { phase: 'ready', closeAt: swept.dueWorkThrough! + 1000 }))
  const protocol = syntheticDeliveryProtocol(START)
  LEARN_REPORT_APPROVALS.push({ tokenIdentifier: viewerIdentity.tokenIdentifier, principalBindingVersion: 'integration.binding.v1', grantVersion: 'integration.grant.v1',
    cohortVersion: protocol.cohortVersion, epoch: protocol.epoch, protocolVersion: protocol.version, baselineSha: protocol.baselineSha,
    frozenAt: protocol.enrollmentStartAt - 1, owners: cohort.map(learner => learner.learnerId), replacementPolicy: { kind: 'secondary_only' } })
  const grantId = await f.t.run(ctx => ctx.db.insert('learnMeasurementReportViewerGrants', { userId: viewerIdentity.tokenIdentifier,
    storageVersion: 'learn-v2.measurement-storage.v1', createdAt: Date.now(), cohortVersion: protocol.cohortVersion, epoch: protocol.epoch,
    principalBindingVersion: 'integration.binding.v1', grantVersion: 'integration.grant.v1', status: 'active', grantedAt: Date.now(), expiresAt: Date.now() + 86_400_000 }))
  const report = await f.t.withIdentity(viewerIdentity).mutation(api.learnV2MeasurementReports.requestReport, { version: LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION,
    viewerGrantId: grantId, idempotencyKey: 'lagging_owner_report_1234567890', enrollmentStartAt: protocol.enrollmentStartAt,
    enrollmentEndAt: protocol.enrollmentEndAt, cutoff: Date.now() })
  if (report.status !== 'requested') throw new Error('Expected report request')
  await f.t.mutation(internal.learnV2MeasurementReports.pinReportOwners, { reportRunId: report.reportRunId })
  const coverage = new Map((await f.t.run(ctx => ctx.db.query('learnMeasurementSourceWatermarks').take(16))).map(row => [row.userId, row.dueWorkThrough]))
  for (const learner of cohort) expect(coverage.get(learner.learnerId)).toBe(learner === lagging ? swept.dueWorkThrough : Date.now())
  const pinned = await f.t.run(ctx => ctx.db.query('learnMeasurementReportRows').withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', report.reportRunId)).take(8))
  expect(pinned.filter(row => row.snapshot.kind === 'owner_watermark' && row.snapshot.dueWorkThrough === swept.dueWorkThrough)).toHaveLength(1)
}, 30_000)

test.each([{ reserve: false, score: 100 }, { reserve: false, score: 0 }, { reserve: true, score: 100 }])(
  'C5 delivery feeds a sealed C6 report once: reserve=$reserve score=$score', async ({ reserve, score }) => {
    const cohort = await cohortJourney(reserve, reserve ? 10 : 5)
    const f = cohort[0]!
    vi.setSystemTime(f.original.openAt + 1000)
    const played = await play(f, reserve, score)
    for (const [index, learner] of cohort.entries()) {
      if (!index) continue
      if (reserve && index < 5) await learner.t.mutation(due, { userId: learner.learnerId, through: Date.now() })
      else await play(learner, false, 100)
    }
    vi.setSystemTime(f.original.closeAt + 1)
    for (const learner of cohort) await learner.t.mutation(due, { userId: learner.learnerId, through: Date.now() })
    const { viewer, reportRunId } = await beginReport(f, cohort, 'integration_report_1234567890')
    const input = await sealedMeasurementReportInput(f.t, reportRunId)
    const ownClaim = input.rows.filter(row => row.kind === 'first_check_claim_v2' && row.firstSlot.kind === 'linked'
      && row.firstSlot.firstCheckOpportunityId === f.original._id)
    expect(ownClaim).toHaveLength(1)
    expect(ownClaim[0]).toMatchObject({ firstSlot: { kind: 'linked', firstCheckOpportunityId: f.original._id,
      clock: f.original.purpose.kind === 'measurement_delayed' ? f.original.purpose.clock : undefined,
      stateAtEligibility: 'independent', stateAtAcceptance: reserve ? null : 'independent',
      acceptance: reserve ? null : { submissionId: played.accepted.submissionId }, result: reserve ? null : { scorePercent: score } } })
    const learnerKey = ownClaim[0]!.learnerKey
    expect(input.rows.filter(row => row.kind === 'first_check_claim_v2' && row.learnerKey === learnerKey)).toHaveLength(1)
    const episode = input.rows.find(row => row.kind === 'episode' && row.learnerKey === learnerKey && row.horizonDays === 7)
    expect(episode).toMatchObject({ originalOpportunityId: f.original._id,
      delayed: reserve ? null : { scorePercent: score }, replacement: reserve ? { scorePercent: score } : null })
    const computed = (await buildLearningMeasurementReport(input)).pages.flatMap(page => page.cells)
    const first = computed.filter(cell => cell.metric === 'false_mastery_next_delayed.v1' && cell.weighting === 'capability_episode' && cell.stratum.startingBand === 'all')
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ counts: { maturedClaims: cohort.length, checkedClaims: 5, failedClaims: !reserve && !score ? 1 : 0,
      distinctLearners: { maturedClaims: cohort.length, checkedClaims: 5 } } })
    expect(first[0]!.reasonCodes).not.toContain('first_slot_claim_missing')
    const published = await buildPublishedLearningMeasurementReport(input)
    expect(await viewer.mutation(api.learnV2MeasurementReports.readReportCells, { version: LEARN_V2_MEASUREMENT_REPORT_VERSION, reportRunId, cursor: null }))
      .toMatchObject({ cells: published.pages[0]!.cells })
    const facts = await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId', q => q.eq('userId', userId)).take(80))
    expect(facts.filter(row => row.fact.kind === 'independent_claim_v2')).toHaveLength(1)
    expect(facts.filter(row => row.fact.kind === 'response' && row.fact.submissionId === played.accepted.submissionId)).toHaveLength(1)
    expect(facts.filter(row => row.fact.kind === 'integrity')).toEqual([])
    expect(await f.t.run(ctx => ctx.db.get(f.original._id))).toMatchObject({ firstCheckClaim: f.original.firstCheckClaim, checkSequence: 1,
      contextPins: reserve ? played.originalBinding.contextPins : played.sealedContextPins })
    for (const row of facts) if (row.fact.kind === 'opportunity' && row.fact.assessmentOpportunityId === f.original._id && row.fact.status === 'eligible')
      expect(row.fact.stateAtEligibility).toBe('independent')
    if (reserve) {
      const replacement = (await f.opportunities()).find(row => row._id === played.targetId)
      expect(replacement).toMatchObject({ originalSlot: false, checkSequence: 0 })
      expect(replacement).not.toHaveProperty('firstCheckClaim')
    }
    const fixed = await f.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_assessmentPurpose', q =>
      q.eq('userId', userId).eq('studyPlanRevisionId', f.graph.studyPlanRevisionId).eq('assessmentPurpose', 'measurement_delayed')).take(4))
    expect(fixed.find(row => row.assessmentOpportunityId === played.targetId)).toMatchObject({ status: 'completed' })
    await f.t.mutation(internal.learnV2Retention.purgeResponseCopies, { userId, submissionId: played.accepted.submissionId })
    expect(await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_kind_and_sequence', q =>
      q.eq('userId', userId).eq('fact.kind', 'integrity')).take(2))).toHaveLength(1)
    expect(await viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version: LEARN_V2_MEASUREMENT_REPORT_VERSION, reportRunId }))
      .toMatchObject({ status: 'stale', reasonCodes: ['source_invalidated'] })
  }, 30_000)

test('a reserve leaves a sealed snapshot intact, then response integrity revokes it through the C6 index', async () => {
  const cohort = await cohortJourney(true, 5)
  const f = cohort[0]!
  vi.setSystemTime(f.original.openAt + 1000)
  for (const learner of cohort) await learner.t.mutation(due, { userId: learner.learnerId, through: Date.now() })
  const { viewer, reportRunId } = await beginReport(f, cohort, 'integration_before_reserve_1234567890')
  const pinned = await sealedMeasurementReportInput(f.t, reportRunId)
  const played = await play(f, true, 100)
  expect(await viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version: LEARN_V2_MEASUREMENT_REPORT_VERSION, reportRunId }))
    .toMatchObject({ status: 'sealed' })
  expect((await sealedMeasurementReportInput(f.t, reportRunId)).rows).toEqual(pinned.rows)
  expect(await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_kind_and_sequence', q =>
    q.eq('userId', userId).eq('fact.kind', 'integrity')).take(1))).toEqual([])
  await f.t.mutation(internal.learnV2Retention.purgeResponseCopies, { userId, submissionId: played.accepted.submissionId })
  expect(await viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version: LEARN_V2_MEASUREMENT_REPORT_VERSION, reportRunId }))
    .toMatchObject({ status: 'stale', reasonCodes: ['source_invalidated'] })
}, 30_000)

test('later grants and scores preserve unknown historical eligibility instead of inferring it from current mastery', async () => {
  const f = await journey(false)
  vi.setSystemTime(f.original.openAt + 1000)
  await f.t.mutation(due, { userId, through: Date.now() })
  const sequence = await f.t.run(async ctx => {
    const facts = await ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_assessmentOpportunityId', q =>
      q.eq('userId', userId).eq('fact.assessmentOpportunityId', f.original._id)).take(8)
    for (const row of facts) if (row.fact.kind === 'opportunity') {
      const { stateAtEligibility: _state, ...fact } = row.fact
      await ctx.db.patch(row._id, { fact })
    }
    return Math.max(...facts.map(row => row.sequence))
  })
  await play(f, false, 100)
  const facts = await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_assessmentOpportunityId', q =>
    q.eq('userId', userId).eq('fact.assessmentOpportunityId', f.original._id)).take(8))
  const appended = facts.filter(row => row.sequence > sequence)
  expect(appended.length).toBeGreaterThan(0)
  for (const row of appended) if (row.fact.kind === 'opportunity') expect(row.fact.stateAtEligibility).toBe('unknown')
})

test('responses-off due work keeps its original opportunity-fact shape without captured eligibility state', async () => {
  const f = await journey(false)
  policy.responses = false
  vi.setSystemTime(f.original.openAt + 1000)
  await f.t.mutation(due, { userId, through: Date.now() })
  const facts = await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_assessmentOpportunityId', q =>
    q.eq('userId', userId).eq('fact.assessmentOpportunityId', f.original._id)).take(8))
  expect(facts.some(row => row.fact.kind === 'opportunity' && row.fact.status === 'eligible')).toBe(true)
  for (const row of facts) expect(row.fact).not.toHaveProperty('stateAtEligibility')
})

test.each(['parked', 'terminal'] as const)('C6 coverage resolves a %s opening fault after its closed outcome is recorded', async state => {
  const cohort = await cohortJourney(false, 5)
  const f = cohort[0]!
  await runLearnDueCron(f.t)
  vi.setSystemTime(f.original.openAt - 1)
  await runLearnDueCron(f.t)
  expect(await f.t.run(ctx => ctx.db.get(f.original._id))).toMatchObject({ phase: 'preparing', operationalEligibility: 'pending' })
  const dueHelpers = await import('./lib/learnV2MeasurementDueWork')
  const original = dueHelpers.processLearnMeasurementDueOpportunity
  const failure = vi.spyOn(dueHelpers, 'processLearnMeasurementDueOpportunity').mockImplementation((ctx, assignment, protocol, row, through) => {
    if (row._id === f.original._id) throw new Error('synthetic_opening_fault')
    return original(ctx, assignment, protocol, row, through)
  })
  vi.setSystemTime(f.original.openAt)
  for (let attempt = 1; attempt <= 8; attempt++) {
    await runLearnDueCron(f.t)
    const work = (await f.t.run(ctx => ctx.db.query('learnMeasurementDueWork').withIndex('by_userId_and_key', q =>
      q.eq('userId', f.learnerId).eq('key', `${f.original._id}:open`)).unique()))!
    expect(work.attempts).toBe(attempt)
    if (attempt < 8) vi.setSystemTime(work.nextAttemptAt)
  }
  const parked = (await f.t.run(ctx => ctx.db.query('learnMeasurementDueWork').withIndex('by_userId_and_key', q =>
    q.eq('userId', f.learnerId).eq('key', `${f.original._id}:open`)).unique()))!
  expect(parked).toMatchObject({ state: 'parked', nextAttemptAt: f.original.closeAt })
  if (state === 'terminal') await f.t.run(ctx => ctx.db.patch(parked._id, { state, recoveryAttempts: 3, nextAttemptAt: Number.MAX_SAFE_INTEGER }))
  const before = await beginReport(f, cohort, `${state}_opening_fault_report`, true)
  const pins = await f.t.run(ctx => ctx.db.query('learnMeasurementReportRows').withIndex('by_reportRunId_and_sequence', q =>
    q.eq('reportRunId', before.reportRunId)).take(8))
  expect(pins.find(row => row.userId === f.learnerId)?.snapshot).toMatchObject({ kind: 'owner_watermark', dueWorkThrough: null })
  failure.mockRestore()
  vi.setSystemTime(f.original.closeAt)
  await runLearnDueCron(f.t)
  expect(await f.t.run(ctx => ctx.db.get(parked._id))).toBeNull()
  expect(await f.t.run(ctx => ctx.db.get(f.original._id))).toMatchObject({ phase: 'abandoned', reasonCode: 'system_due_work_late' })
  const after = await beginReport(f, cohort, `${state}_closed_fault_report`)
  expect(await f.t.run(ctx => ctx.db.get(after.reportRunId))).toMatchObject({ sourceCoverage: 'complete' })
}, 30_000)

test('C6 preserves a recorded access block ahead of a legacy system-late label', async () => {
  const cohort = await cohortJourney(false, 10)
  const f = cohort[0]!
  const blocked = cohort.slice(0, 5)
  for (const learner of blocked) await f.t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: learner.learnerId, enabled: false })
  vi.setSystemTime(f.original.openAt)
  await runLearnDueCron(f.t)
  for (const learner of blocked) expect(await f.t.run(ctx => ctx.db.get(learner.original._id))).toMatchObject({ reasonCode: 'not_admitted' })
  vi.setSystemTime(f.original.closeAt)
  await runLearnDueCron(f.t)
  const { writeMeasurementOpportunityFact } = await import('./lib/learnV2Measurement')
  await f.t.run(async ctx => {
    for (const learner of blocked) {
      const row = (await ctx.db.get(learner.original._id))!
      expect(row).toMatchObject({ phase: 'abandoned', reasonCode: 'not_admitted' })
      await ctx.db.patch(row._id, { reasonCode: 'system_due_work_late', revision: row.revision + 1 })
      const assignment = (await ctx.db.get(row.assignmentId!))!
      await writeMeasurementOpportunityFact(ctx, assignment, (await ctx.db.get(row._id))!)
    }
  })
  const report = await beginReport(f, cohort, 'legacy_blocked_slot_report')
  const input = await sealedMeasurementReportInput(f.t, report.reportRunId)
  const ids = new Set(blocked.map(learner => String(learner.original._id)))
  const episodes = input.rows.filter(row => row.kind === 'episode' && ids.has(String(row.originalOpportunityId)))
  expect(episodes).toHaveLength(5)
  for (const row of episodes) {
    expect(row).toMatchObject({ disposition: 'access_provider_blocked' })
    if (row.kind === 'episode') expect(row.reasonCodes).not.toContain('system_due_work_late')
  }
  const claims = input.rows.filter(row => row.kind === 'first_check_claim_v2' && row.firstSlot.kind === 'linked' && ids.has(String(row.firstSlot.firstCheckOpportunityId)))
  expect(claims).toHaveLength(5)
  for (const row of claims) expect(row).toMatchObject({ firstSlot: { unresolvedReason: 'access_provider_blocked' } })
}, 30_000)
