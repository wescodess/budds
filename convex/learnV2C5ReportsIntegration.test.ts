import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { makeFunctionReference } from 'convex/server'
import { api, internal } from './_generated/api'
import { assessmentDeliveryFixture, deliveryIdentity, publishDeliveryTeaching, syntheticDeliveryProtocol } from '../tests/fixtures/learn-v2-assessment-delivery'
import { replaceMeasurementOpportunity } from '../tests/fixtures/learn-v2-measurement-replacement'
import { sealedMeasurementReportInput } from '../tests/fixtures/learn-v2-measurement-report-run'
import { runLearnDueCron } from '../tests/fixtures/learn-v2-due-cron'
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

async function beginReport(f: Awaited<ReturnType<typeof journey>>, cohort: Awaited<ReturnType<typeof journey>>[], key: string) {
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
  vi.setSystemTime(Date.now() + 86_400_000)
  await runLearnDueCron(f.t)
  const watermark = await f.t.run(ctx => ctx.db.query('learnMeasurementSourceWatermarks').withIndex('by_userId', q => q.eq('userId', f.learnerId)).unique())
  expect(watermark?.dueWorkThrough).toBe(Date.now())
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
