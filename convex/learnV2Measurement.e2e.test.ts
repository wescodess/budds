import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { convexTest } from 'convex-test'
import schema from './schema'
import { api, internal } from './_generated/api'
import { createLearnScorerRegistry, sealLearnScorerConfiguration } from './lib/learnV2ScorerConfig'
import { LEARN_REPORT_APPROVALS, reportControl } from './lib/learnV2MeasurementReportAccess'
import { privacyDigest } from './lib/learnV2ResponsePrivacy'
import { LEARN_V2_PUBLIC_API_VERSION } from './lib/learnV2PublicContract'
import { ADAPTIVE_V2_PILOT_MANIFEST } from '../shared/adaptive-v2-pilot-policy'
import { LEARN_V2_POST_SEAL_TEACHING_VERSION } from '../shared/learn-v2-assessment-disclosure'
import { instructionalReservationSemanticAdapter } from './lib/learnV2ArtifactLineage'
import { syntheticDeliveryProtocol } from '../tests/fixtures/learn-v2-assessment-delivery'
import { sealedMeasurementReportInput } from '../tests/fixtures/learn-v2-measurement-report-run'
import { authorizeExport } from '../tests/fixtures/learn-v2-personal-export'
import { seedCompleteMeasurementStorage } from '../tests/fixtures/learn-v2-measurement-storage'
import { disclosureProofInventory } from '../tests/fixtures/learn-v2-measurement/disclosure'
import { ASSESSMENT_DISCLOSURE_READS, ASSESSMENT_DISCLOSURE_OTHER_OWNERS } from './lib/learnV2AssessmentDisclosure'
import { LEARN_MEASUREMENT_COLLECTIONS, LEARN_MEASUREMENT_STORAGE_MANIFEST } from '../shared/learn-v2-measurement-storage-manifest'
import { PERSONAL_EXPORT_COLLECTIONS } from './lib/learnV2PersonalExportCollections'
import { ADAPTIVE_ROUTING_ASSIGNMENT_UNIT, ADAPTIVE_ROUTING_ASSIGNMENT_CONTRACT_VERSION } from '../shared/learn-adaptive-experiment'
import { ANSWER_CANARY, PROOF_START, advanceProofClock, createMeasurementLearner, postSealPractice, submitMeasurement, teachToday,
  type MeasurementLearner, type ProofRoute } from '../tests/fixtures/learn-v2-measurement/commands'
import { expectedMeasurement, measurementScenarios } from '../tests/fixtures/learn-v2-measurement/scenarios'
import { LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, LEARN_V2_MEASUREMENT_REPORT_VERSION, learnReportFactPayloadSchema,
  buildLearningMeasurementReport, type LearnPublishedReportMetric } from '../shared/learn-v2-measurement-report'

const policy = vi.hoisted(() => ({ pointers: false, protocol: null as unknown, registry: null as unknown, saved: null as unknown, legacy: null as unknown, alternate: null as unknown }))
vi.mock('../shared/learn-v2-measurement-storage-manifest', async original => {
  const value = await original<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...value, LEARN_MEASUREMENT_CAPABILITIES: { ...value.LEARN_MEASUREMENT_CAPABILITIES,
    responses: true, enrollment: true, delivery: true, scoring: true, reports: true, get todayCanvasChecks() { return policy.pointers } } }
})
vi.mock('./lib/learnV2MeasurementAssignment', async original => {
  const value = await original<typeof import('./lib/learnV2MeasurementAssignment')>()
  return { ...value, getFrozenLearnMeasurementProtocol: () => policy.protocol }
})
vi.mock('./lib/learnV2MeasurementScorerInventory', () => ({ getLearnMeasurementScorer: async (binding?: { configurationId: string }) => ({ registry: policy.registry,
  saved: binding?.configurationId === 'c64.baseline' ? policy.legacy : binding?.configurationId === 'c64.alternate' ? policy.alternate : policy.saved }) }))

const originalPilot = structuredClone(ADAPTIVE_V2_PILOT_MANIFEST)
const viewerIdentity = { tokenIdentifier: 'https://fixture.invalid|c64-viewer', subject: 'c64-viewer' }
let verdict = 100
let upstream = 'Synthetic Provider'
const setVerdict = (value: number) => { verdict = value }

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(PROOF_START); LEARN_REPORT_APPROVALS.splice(0)
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.spyOn(instructionalReservationSemanticAdapter, 'compare').mockResolvedValue({ decision: 'pass', coverage: 'complete' })
  upstream = 'Synthetic Provider'
  vi.stubEnv('LEARN_ADAPTIVE_V2_PILOT_MANIFEST', ADAPTIVE_V2_PILOT_MANIFEST.version)
  for (const name of ['OPENROUTER_API_KEY', 'CF_ACCOUNT_ID', 'CLOUDFLARE_AI_GATEWAY_ID']) vi.stubEnv(name, 'synthetic-unused')
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = String(init?.body)
    return new Response(JSON.stringify({ id: 'synthetic-c64-execution', model: 'synthetic/model',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
        criterionResults: [{ key: body.includes('private-criterion') ? 'private-criterion' : 'accuracy', awarded: verdict === 100 }], misconceptionTags: [],
      }) } }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
      openrouter_metadata: { requested: 'synthetic/model', strategy: 'direct', attempt: 1,
        endpoints: { available: [{ provider: upstream, model: 'synthetic/model', selected: true }] }, pipeline: [] } }))
  }))
})
afterEach(() => {
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, originalPilot); LEARN_REPORT_APPROVALS.splice(0)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers()
})

async function configure(route: ProofRoute) {
  const definition = { configurationId: 'c64.measurement', configurationVersion: 'synthetic.c64.v1', kind: 'measurement_rubric' as const,
    requestedModel: 'synthetic/model', endpoint: null, identity: { mappingVersion: 'synthetic.identity.v1', canonicalModel: 'synthetic/model',
      family: 'synthetic', snapshotAssurance: 'unknown' as const, verifiedReturnedModels: [] } }
  const baseline = { ...definition, configurationId: 'c64.baseline', kind: 'legacy_baseline' as const }
  const saved = await sealLearnScorerConfiguration(definition)
  const legacy = await sealLearnScorerConfiguration(baseline)
  policy.registry = await createLearnScorerRegistry({ epoch: 'synthetic.epoch.v1', configurations: [
    { definition, expectedDigest: saved.binding.configurationDigest }, { definition: baseline, expectedDigest: legacy.binding.configurationDigest }],
  legacyAllowlist: [baseline.configurationId], prospectiveConfigurationId: null })
  policy.saved = saved; policy.legacy = legacy; policy.protocol = { ...syntheticDeliveryProtocol(PROOF_START), scoringBinding: saved.binding }; policy.pointers = route === 'today_canvas'
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST, { pilotApproved: true,
    startsAt: new Date(PROOF_START - 86_400_000).toISOString(), endsAt: new Date(PROOF_START + 40 * 86_400_000).toISOString(),
    cohort: { ...originalPilot.cohort, subjectHashes: await Promise.all(measurementScenarios.flatMap(scenario => Array.from({ length: 3 }, (_, ordinal) =>
      privacyDigest(['adaptive-v2-pilot-cohort.v1', `https://fixture.invalid|c64-${route}-${scenario.name}-${ordinal}`])))) },
    modelPolicies: [{ model: 'synthetic/model', inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.1 }],
    productControls: { ...originalPilot.productControls, maxDispatchesPerHour: 4096, maxDispatchesPerDay: 4096, maxConcurrent: 128, maxReservedMicroUsdPerDay: 409_600_000 },
    rollback: { ...originalPilot.rollback, ownerSubjectHash: await privacyDigest(['adaptive-v2-rollback-owner.tokenIdentifier-sha256.v1', viewerIdentity.tokenIdentifier]) } })
  return { binding: saved.binding, saved, legacy, definition, baseline }
}

async function cohort(route: ProofRoute) {
  const { binding } = await configure(route)
  const learners: MeasurementLearner[] = []
  for (const scenario of measurementScenarios) for (let ordinal = 0; ordinal < 3; ordinal++) {
    const f = await createMeasurementLearner({ route, scenario, ordinal, binding, test: learners[0]?.t, runtime: route !== 'canvas' && ordinal === 0 })
    learners.push(f)
    await submitMeasurement(f, f.cold, scenario.cold, setVerdict)
  }
  const first = learners[0]!
  await advanceProofClock(first.t, first.cold.closeAt + 1)
  if (route !== 'canvas') for (const f of learners) {
    await teachToday(f, setVerdict)
    if (f.ordinal === 0 && f.scenario.cold !== null) await postSealPractice(f, f.cold, f.scenario.cold)
  }
  for (const horizon of [7, 30] as const) {
    const original = (await first.opportunities()).find(row => row.horizonDays === horizon)!
    await advanceProofClock(first.t, original.openAt + 1000)
    for (const f of learners) {
      const opportunity = (await f.opportunities()).find(row => row.horizonDays === horizon)!
      expect(opportunity.operationalEligibility).toBe('eligible')
      await submitMeasurement(f, opportunity, horizon === 7 ? f.scenario.day7 : f.scenario.day30, setVerdict)
    }
    await advanceProofClock(first.t, original.closeAt + 1)
  }
  return learners
}

async function snapshot(learners: MeasurementLearner[]) {
  const first = learners[0]!
  const protocol = syntheticDeliveryProtocol(PROOF_START)
  LEARN_REPORT_APPROVALS.push({ tokenIdentifier: viewerIdentity.tokenIdentifier, principalBindingVersion: 'synthetic.c64.binding.v1', grantVersion: 'synthetic.c64.grant.v1',
    cohortVersion: protocol.cohortVersion, epoch: protocol.epoch, protocolVersion: protocol.version, baselineSha: protocol.baselineSha,
    frozenAt: protocol.enrollmentStartAt - 1, owners: learners.map(f => f.userId), replacementPolicy: { kind: 'secondary_only' } })
  const grantId = await first.t.run(ctx => ctx.db.insert('learnMeasurementReportViewerGrants', { userId: viewerIdentity.tokenIdentifier,
    storageVersion: 'learn-v2.measurement-storage.v1', createdAt: Date.now(), cohortVersion: protocol.cohortVersion, epoch: protocol.epoch,
    principalBindingVersion: 'synthetic.c64.binding.v1', grantVersion: 'synthetic.c64.grant.v1', status: 'active', grantedAt: Date.now(), expiresAt: Date.now() + 86_400_000 }))
  const viewer = first.t.withIdentity(viewerIdentity)
  const request = { version: LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, viewerGrantId: grantId, idempotencyKey: 'c64_report_1234567890',
    enrollmentStartAt: protocol.enrollmentStartAt, enrollmentEndAt: protocol.enrollmentEndAt, cutoff: Date.now() }
  const requested = await viewer.mutation(api.learnV2MeasurementReports.requestReport, request)
  if (requested.status !== 'requested') throw new Error(JSON.stringify(requested))
  await first.t.finishAllScheduledFunctions(() => vi.runAllTimers(), 4000)
  const reference = { version: LEARN_V2_MEASUREMENT_REPORT_VERSION, reportRunId: requested.reportRunId }
  const manifest = await viewer.mutation(api.learnV2MeasurementReports.readReportManifest, reference)
  expect(manifest).toMatchObject({ status: 'sealed', provenance: { codeVersion: 'learn-v2.report-code.c6.2.v9' } })
  const run = (await first.t.run(ctx => ctx.db.get(reference.reportRunId)))!
  expect(run.sourceCoverage).toBe('complete')
  expect(reportControl(run).sourcePages.length).toBeGreaterThan(1)
  const cells: LearnPublishedReportMetric[] = []
  let cursor: string | undefined
  let pages = 0
  do {
    const page = await viewer.mutation(api.learnV2MeasurementReports.readReportCells, { ...reference, cursor: cursor ?? null })
    if (!('cells' in page)) throw new Error(JSON.stringify(page))
    expect(page.cells.length).toBeLessThanOrEqual(8)
    cells.push(...page.cells); pages++
    cursor = page.isDone ? undefined : page.cursor ?? undefined
    if (!page.isDone) expect(cursor).toBeTruthy()
    expect(pages).toBeLessThan(100)
  } while (cursor)
  expect(pages).toBe(Math.ceil(cells.length / 8))
  expect(pages).toBeGreaterThan(1)
  const input = await sealedMeasurementReportInput(first.t, reference.reportRunId)
  expect(input.rows.filter(row => row.kind === 'owner_watermark')).toHaveLength(learners.length)
  expect(input.rows.filter(row => row.kind === 'episode')).toHaveLength(learners.length * 2)
  return { viewer, reference, input, cells, grantId }
}

function assertArithmetic(cells: LearnPublishedReportMetric[], route: ProofRoute) {
  for (const [horizon, expected] of [[7, expectedMeasurement.day7], [30, expectedMeasurement.day30]] as const) {
    for (const weighting of ['capability_episode', 'learner_sensitivity']) {
      const cell = cells.find(cell => cell.metric === 'verified_learning_gain.v1' && cell.horizonDays === horizon && cell.weighting === weighting && cell.stratum.startingBand === 'all')!
      expect(cell).toBeDefined()
      expect(cell.stratum).toMatchObject({ flow: route === 'canvas' ? 'v2_canvas' : 'v2_today', checkSurface: route === 'today' ? 'today' : 'canvas' })
      expect(cell.counts).toMatchObject({ maturedEpisodes: expected.population, comparablePairs: expected.pairs,
        considered: 30, notAdmitted: 0, acceptedColdSubmissions: 27, acceptedSubmissions: expected.accepted, dispositions: expected.dispositions })
      expect(cell.observedValue).toBeCloseTo(expected.observed, 10)
      expect(cell.allEligibleValue).toBeNull()
      expect(cell.missingOutcomeBounds).toEqual({ lower: expected.bounds[0], upper: expected.bounds[1] })
    }
  }
  if (route === 'canvas') expect(cells.filter(cell => cell.metric === 'false_mastery_next_delayed.v1')).toEqual([])
  else for (const weighting of ['capability_episode', 'learner_sensitivity']) {
    const expected = expectedMeasurement.firstCheck
    const cell = cells.find(cell => cell.metric === 'false_mastery_next_delayed.v1' && cell.weighting === weighting && cell.stratum.startingBand === 'all')!
    expect(cell.stratum).toMatchObject({ flow: 'v2_today', checkSurface: route === 'today' ? 'today' : 'canvas' })
    expect(cell.counts).toMatchObject({ maturedClaims: expected.population, checkedClaims: expected.checked, failedClaims: expected.failed })
    expect(cell.observedValue).toBeCloseTo(expected.observed, 10)
    expect(cell.allEligibleValue).toBeNull()
    expect(cell.missingOutcomeBounds).toEqual({ lower: expected.bounds[0], upper: expected.bounds[1] })
  }
}

function replay(input: Awaited<ReturnType<typeof sealedMeasurementReportInput>>, report: Awaited<ReturnType<typeof buildLearningMeasurementReport>>['report']) {
  const directory = mkdtempSync(join(tmpdir(), 'learn-c64-'))
  try {
    const path = join(directory, 'synthetic.json')
    writeFileSync(path, JSON.stringify({ version: 'learn-v2.measurement-report-replay.v2', report, roster: input.roster, rows: input.rows }))
    const result = spawnSync(process.execPath, ['scripts/learn-v2-measurement-report.mjs', '--sealed-input', path], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 60_000 })
    expect(result.error).toBeUndefined(); expect(result.status).toBe(0); expect(result.stderr).toBe('')
    const output = JSON.parse(result.stdout)
    expect(output.readiness).toMatchObject({ sourceAdmission: 'pending', viewerGrant: 'unverified_offline', realObservations: 'unverified_offline', baselineCapture: 'unproven' })
    expect(result.stdout).not.toMatch(/PRIVATE-|https:\/\/fixture.invalid|learnerKey|capabilityKey|submissionId|assessmentOpportunityId/u)
    return output.cells
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

test.each(['today', 'today_canvas', 'canvas'] as const)('registered collection, scheduler, bounded report and CLI: %s', async route => {
  const learners = await cohort(route)
  const report = await snapshot(learners)
  expect(report.input.rows.filter(row => row.kind === 'first_check_claim_v2')).toHaveLength(route === 'canvas' ? 0 : 30)
  if (route !== 'canvas') expect(report.cells.length).toBeGreaterThan(8)
  assertArithmetic(report.cells, route)
  const unpublished = await buildLearningMeasurementReport(report.input)
  expect(unpublished.report.status).toBe('sealed')
  const replayed = replay(report.input, unpublished.report)
  expect(replayed).toEqual(report.cells)
  const f = learners[0]!
  const pins = await f.t.run(ctx => ctx.db.get(f.accepted.get(0)!))
  const assignment = (await f.t.run(ctx => ctx.db.get(f.cold.assignmentId!)))!
  if (assignment.status !== 'admitted' || assignment.allocation.kind !== 'three_case') throw new Error('Expected frozen three-case allocation')
  const cases = []
  for (const [horizon, itemPins] of [[0, assignment.allocation.cold], [7, assignment.allocation.day7], [30, assignment.allocation.day30]] as const) {
    const response = (await f.t.run(ctx => ctx.db.get(f.accepted.get(horizon)!)))!
    expect(response).toMatchObject({ assessmentPins: { kind: 'measurement', itemPins }, scoringBinding: assignment.scoringBinding })
    cases.push(itemPins.caseId)
  }
  expect(new Set(cases).size).toBe(3)
  vi.setSystemTime(Date.now() + 1000)
  expect(await f.t.run(ctx => ctx.db.get(f.accepted.get(0)!))).toEqual(pins)
  for (const learner of learners.filter(value => value.scenario.name === 'first_failure_later_pass')) {
    const episodes = report.input.rows.filter(row => row.kind === 'episode' && row.assignmentId === learner.cold.assignmentId)
    expect(episodes).toEqual(expect.arrayContaining([expect.objectContaining({ horizonDays: 7, delayed: expect.objectContaining({ scorePercent: 0 }) }),
      expect.objectContaining({ horizonDays: 30, delayed: expect.objectContaining({ scorePercent: 100 }) })]))
    if (route !== 'canvas') {
      const original = (await learner.opportunities()).find(row => row.horizonDays === 7)!
      const claim = report.input.rows.find(row => row.kind === 'first_check_claim_v2' && row.firstSlot.kind === 'linked' && row.firstSlot.firstCheckOpportunityId === original._id)
      expect(claim).toMatchObject({ firstSlot: { result: { scorePercent: 0 }, acceptance: { submissionId: learner.accepted.get(7) } } })
    }
  }
  const outsider = f.t.withIdentity({ tokenIdentifier: 'https://other.invalid|c64-viewer', subject: viewerIdentity.subject })
  await expect(outsider.query(api.learnV2Assessments.getAssessment, { version: LEARN_V2_PUBLIC_API_VERSION,
    assessmentOpportunityId: f.cold._id })).rejects.toThrow()
  for (const owner of [f.t, outsider]) {
    await expect(owner.mutation(api.learnV2MeasurementReports.readReportManifest, report.reference)).rejects.toThrow()
    await expect(owner.mutation(api.learnV2MeasurementReports.exportReportPage, { ...report.reference, cursor: null })).rejects.toThrow()
    await expect(owner.mutation(api.learnV2MeasurementReports.downloadReportPage, { ...report.reference, cursor: null })).rejects.toThrow()
  }
  expect(await report.viewer.query(api.learnV2MeasurementReports.getReportCells, { ...report.reference, cursor: null })).toMatchObject({ status: 'unavailable', reasonCodes: ['audited_access_required'] })
  const exported = await report.viewer.mutation(api.learnV2MeasurementReports.exportReportPage, { ...report.reference, cursor: null })
  expect(JSON.stringify(exported)).not.toMatch(/PRIVATE-|learnerKey|capabilityKey|submissionId|assessmentOpportunityId/u)
  const authorizationId = await authorizeExport(f.owner)
  for (const collection of ['learnMeasurementReportFacts', 'learnMeasurementScoringSpecs', 'learnScoringExecutions', 'learnMeasurementItems'] as const) {
    const page = await f.owner.query(api.dataExport.getUserDataPage, { authorizationId, collection, paginationOpts: { cursor: null, numItems: 8 } })
    expect(page.page.length).toBeGreaterThan(0)
    expect(JSON.stringify(page)).not.toMatch(/PRIVATE-|learnerKey|capabilityKey|privateScoring|frozenConfiguration|rubricSnapshot/u)
    await expect(outsider.query(api.dataExport.getUserDataPage, { authorizationId, collection, paginationOpts: { cursor: null, numItems: 8 } })).rejects.toThrow()
  }
  const pinned = structuredClone(report.input.rows)
  await f.t.mutation(internal.learnV2Retention.purgeResponseCopies, { userId: f.userId, submissionId: f.accepted.get(7)! })
  expect(await report.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, report.reference)).toMatchObject({ status: 'stale', reasonCodes: ['source_invalidated'] })
  expect((await sealedMeasurementReportInput(f.t, report.reference.reportRunId)).rows).toEqual(pinned)
  expect(JSON.stringify(await report.viewer.mutation(api.learnV2MeasurementReports.exportReportPage, { ...report.reference, cursor: null }))).not.toContain(ANSWER_CANARY)
}, 300_000)

test('bound Today first-Independent commit persists one claim and first slot after Canvas cold scoring', async () => {
  const { binding } = await configure('today_canvas')
  const f = await createMeasurementLearner({ route: 'today_canvas', binding, scenario: measurementScenarios[0], ordinal: 0 })
  await submitMeasurement(f, f.cold, 0, setVerdict)
  await advanceProofClock(f.t, f.cold.closeAt + 1)
  await teachToday(f, setVerdict)
  const attempts = await f.t.run(ctx => ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', f.userId)).take(8))
  expect(attempts).toHaveLength(2)
  const basis = attempts.find(row => row.kind === 'independent_application')!
  expect(basis).toMatchObject({ masteryStateAfter: 'independent' })
  const claims = await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_kind_and_sequence', q =>
    q.eq('userId', f.userId).eq('fact.kind', 'independent_claim_v2')).take(8))
  expect(claims).toHaveLength(1)
  const day7 = (await f.opportunities()).find(row => row.horizonDays === 7)!
  expect(learnReportFactPayloadSchema.parse(claims[0]!.fact)).toEqual(claims[0]!.fact)
  expect(claims[0]!.fact).toMatchObject({ basisAttemptId: basis._id, firstIndependentAt: Date.now(),
    stratum: { flow: 'v2_today', checkSurface: 'canvas', entryPoint: 'today' },
    firstSlot: { kind: 'linked', firstCheckOpportunityId: day7._id, stratum: { flow: 'v2_today', checkSurface: 'canvas' } } })
  expect(day7).toMatchObject({ originalSlot: true, firstCheckClaim: { basisAttemptId: basis._id } })
  expect(await f.t.run(ctx => ctx.db.query('masteryRecords').withIndex('by_userId', q => q.eq('userId', f.userId)).take(1)))
    .toEqual([expect.objectContaining({ state: 'independent' })])
})

test('Canvas cold scoring cannot yet continue its original session into teaching or Independent', async () => {
  const { binding } = await configure('canvas')
  const f = await createMeasurementLearner({ route: 'canvas', binding, scenario: measurementScenarios[0], ordinal: 0, runtime: true })
  const content = await f.t.run(ctx => ctx.db.get(f.teachingContentId))
  await submitMeasurement(f, f.cold, 0, setVerdict)
  const reference = { version: LEARN_V2_POST_SEAL_TEACHING_VERSION, assessmentOpportunityId: f.cold._id }
  expect(await f.owner.query(api.learnV2Assessments.getPostSealTeaching, reference))
    .toMatchObject({ status: 'available', feedback: null, lesson: null, practice: null })
  expect(await f.owner.mutation(api.learnV2PostSealTeaching.publishFeedback, reference))
    .toMatchObject({ status: 'available', feedback: null, lesson: null, practice: null })
  expect(await f.owner.mutation(api.learnV2PostSealTeaching.openPractice, reference))
    .toMatchObject({ status: 'available', feedback: null, lesson: null, practice: null,
      availability: { practice: { status: 'unavailable', reasonCode: 'disclosure_unknown' } } })
  await advanceProofClock(f.t, f.cold.closeAt + 1)
  await expect(f.owner.mutation(api.learnV2SessionContent.startStudySession, f.start)).rejects.toThrow('Study session is not ready')
  const session = (await f.t.run(ctx => ctx.db.get(f.graph.studySessionId)))!
  await expect(f.owner.action(api.learnV2Mastery.submitMasteryAttempt, { studySessionId: session._id,
    expectedSessionRevision: session.revision, expectedContentRevision: 1, expectedPlanRecordRevision: 1,
    expectedBlueprintRecordRevision: 1, response: 'Separate ordinary application.', confidence: 3,
    idempotencyKey: 'c64_independent_key' })).rejects.toThrow('Learn assessment opportunity unavailable')
  expect(await f.t.run(ctx => ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', f.userId)).take(8)))
    .toEqual([expect.objectContaining({ kind: 'measurement_cold' })])
  expect((await f.opportunities()).filter(row => row.purpose.kind === 'independent_application')).toEqual([])
  expect(await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_kind_and_sequence', q =>
    q.eq('userId', f.userId).eq('fact.kind', 'independent_claim_v2')).take(1))).toEqual([])
  expect(await f.t.run(ctx => ctx.db.get(f.teachingContentId))).toEqual(content)
})

test('one trusted snapshot separates teaching flow, check surface and scorer, then source purge invalidates it', async () => {
  const configured = await configure('today')
  const definition = { ...configured.definition, configurationId: 'c64.alternate', configurationVersion: 'synthetic.c64.v2' }
  const alternate = await sealLearnScorerConfiguration(definition)
  policy.alternate = alternate
  policy.registry = await createLearnScorerRegistry({ epoch: 'synthetic.epoch.v1', configurations: [
    { definition: configured.definition, expectedDigest: configured.saved.binding.configurationDigest },
    { definition: configured.baseline, expectedDigest: configured.legacy.binding.configurationDigest },
    { definition, expectedDigest: alternate.binding.configurationDigest }], legacyAllowlist: [configured.baseline.configurationId], prospectiveConfigurationId: null })
  const groups = [
    { route: 'today' as const, binding: configured.binding, key: '' },
    { route: 'today_canvas' as const, binding: configured.binding, key: '' },
    { route: 'canvas' as const, binding: configured.binding, key: '' },
    { route: 'today' as const, binding: configured.binding, key: '-alternate' },
  ]
  Object.assign(ADAPTIVE_V2_PILOT_MANIFEST.cohort, { subjectHashes: await Promise.all(groups.flatMap(group => Array.from({ length: 5 }, (_, ordinal) =>
    privacyDigest(['adaptive-v2-pilot-cohort.v1', `https://fixture.invalid|c64-${group.route}-gain-${ordinal}${group.key}`])))) })
  const learners: MeasurementLearner[] = []
  for (const group of groups) for (let ordinal = 0; ordinal < 5; ordinal++) {
    policy.pointers = group.route === 'today_canvas'
    upstream = group.key ? 'Synthetic Alternate' : 'Synthetic Provider'
    policy.protocol = { ...syntheticDeliveryProtocol(PROOF_START), scoringBinding: group.binding }
    const f = await createMeasurementLearner({ ...group, ordinal, scenario: measurementScenarios[0], test: learners[0]?.t })
    learners.push(f)
    await submitMeasurement(f, f.cold, 0, setVerdict)
  }
  policy.protocol = { ...syntheticDeliveryProtocol(PROOF_START), scoringBinding: configured.binding }
  const first = learners[0]!
  const slot = (await first.opportunities()).find(row => row.horizonDays === 7)!
  await advanceProofClock(first.t, slot.openAt + 1000)
  for (const f of learners) {
    upstream = f.userId.endsWith('-alternate') ? 'Synthetic Alternate' : 'Synthetic Provider'
    await submitMeasurement(f, (await f.opportunities()).find(row => row.horizonDays === 7)!, 100, setVerdict)
  }
  await advanceProofClock(first.t, slot.closeAt + 1)
  const report = await snapshot(learners)
  expect(report.cells.length).toBeGreaterThan(8)
  const all = report.cells.filter(cell => cell.metric === 'verified_learning_gain.v1' && cell.horizonDays === 7
    && cell.weighting === 'capability_episode' && cell.stratum.startingBand === 'all')
  expect(all).toHaveLength(4)
  expect(all.map(cell => [cell.stratum.flow, cell.stratum.checkSurface, cell.stratum.configurationDigest]).sort()).toEqual([
    ['v2_today', 'today', configured.binding.configurationDigest], ['v2_today', 'canvas', configured.binding.configurationDigest],
    ['v2_canvas', 'canvas', configured.binding.configurationDigest], ['v2_today', 'today', configured.binding.configurationDigest],
  ].sort())
  const split = all.filter(cell => cell.stratum.flow === 'v2_today' && cell.stratum.checkSurface === 'today')
  expect(new Set(split.map(cell => cell.stratum.observedUpstream)).size).toBe(2)
  for (const cell of all) {
    expect(cell).toMatchObject({ counts: { maturedEpisodes: 5, comparablePairs: 5 }, observedValue: 100 })
    if (split.includes(cell)) expect(cell).toMatchObject({ populationState: 'unknown', allEligibleValue: null, missingOutcomeBounds: null })
    else expect(cell).toMatchObject({ allEligibleValue: 100, missingOutcomeBounds: { lower: 100, upper: 100 } })
  }
  const response = await first.t.run(ctx => ctx.db.get(first.accepted.get(0)!))
  const calls = vi.mocked(fetch).mock.calls.length
  policy.saved = alternate
  expect(await first.owner.action(api.learnV2Mastery.scoreMasterySubmission, { version: LEARN_V2_PUBLIC_API_VERSION,
    submissionId: first.accepted.get(0)!, idempotencyKey: 'c64_immutable_scorer_replay_1234567890' })).toMatchObject({ status: 'scored', result: { scorePercent: 0 } })
  expect(vi.mocked(fetch).mock.calls).toHaveLength(calls)
  expect(await first.t.run(ctx => ctx.db.get(first.accepted.get(0)!))).toEqual(response)
  await first.t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: first.userId, sourceIdentityId: first.graph.sourceIdentityId })
  await first.t.finishAllScheduledFunctions(() => vi.runAllTimers(), 4000)
  expect(await report.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, report.reference)).toMatchObject({ status: 'stale' })
  expect(await report.viewer.mutation(api.learnV2MeasurementReports.downloadReportPage, { ...report.reference, cursor: null })).not.toHaveProperty('cells')
}, 120_000)

test('every disclosure surface has an explicit owner and existing regression suites', () => {
  const audit = readFileSync('docs/qa/c4-read-path-audit.md', 'utf8')
  const postSeal = [...audit.matchAll(/^\| `([^`]+)` \| `post_seal_[^`]+` \|/gmu)].map(match => ({ surface: match[1]!, owner: 'C5.6 #535' }))
  expect(postSeal).toHaveLength(4)
  expect(audit).toMatch(/^\| `learnV2Today.getCheckPointers` \| `summary_or_own_work` \|/mu)
  const expected = [...ASSESSMENT_DISCLOSURE_READS.map(([surface]) => ({ surface, owner: 'C4.1 #429' })),
    ...Object.entries(ASSESSMENT_DISCLOSURE_OTHER_OWNERS).flatMap(([owner, surfaces]) => surfaces.map(surface => ({ owner, surface }))),
    ...postSeal, { surface: 'learnV2Today.getCheckPointers', owner: 'C5.4 #435' }]
  const bySurface = <T extends { surface: string }>(rows: T[]) => rows.sort((a, b) => a.surface.localeCompare(b.surface))
  expect(bySurface(disclosureProofInventory.map(({ owner, surface }) => ({ owner, surface })))).toEqual(bySurface(expected))
  expect(new Set(disclosureProofInventory.map(row => row.surface)).size).toBe(disclosureProofInventory.length)
  for (const row of disclosureProofInventory) {
    expect(row.owner.trim()).not.toBe('')
    expect(row.tests.length).toBeGreaterThan(0)
    for (const file of row.tests) expect(readFileSync(file, 'utf8'), `${row.surface}: ${file}`).toMatch(/(?:test|it)\(/u)
  }
  expect(readFileSync('convex/http.ts', 'utf8')).not.toMatch(/learn(?:Measurement|Assessment|Response|Scoring|PostSeal)/u)
  expect(readFileSync('shared/learn-adaptive-operational-metrics.ts', 'utf8')).toContain("OPERATIONAL_QUERY_VERSION = 'operational_fixture_query.v1'")
  expect(readFileSync('shared/learn-adaptive-outcome-metrics.ts', 'utf8')).toContain("OUTCOME_QUERY_VERSION = 'outcome_fixture_query.v1'")
  expect(ADAPTIVE_ROUTING_ASSIGNMENT_UNIT).toBe('authenticated_learner')
  expect(ADAPTIVE_ROUTING_ASSIGNMENT_CONTRACT_VERSION).toBe('learn-adaptive.experiment-assignment.v1')
})

test('all measurement tables remain enumerated for export and bounded account deletion', async () => {
  const modules = import.meta.glob('./**/*.ts')
  const t = convexTest({ schema, modules, transactionLimits: true })
  const userId = 'https://fixture.invalid|c64-delete'
  const seeded = await t.run(ctx => seedCompleteMeasurementStorage(ctx, userId))
  await t.run(ctx => ctx.db.patch(seeded.documentId, { status: 'processing' }))
  expect(Object.keys(seeded.rows).sort()).toEqual([...LEARN_MEASUREMENT_COLLECTIONS].sort())
  const measurementTables = Object.keys(schema.tables).filter(table => /^learn(?:Measurement|Assessment|Response|Scoring|PostSeal|Artifact)/u.test(table))
  expect(measurementTables.sort()).toEqual([...LEARN_MEASUREMENT_COLLECTIONS, 'learnMeasurementDueWorkCursors', 'learnMeasurementReportAccessAudits'].sort())
  for (const entry of LEARN_MEASUREMENT_STORAGE_MANIFEST) {
    expect(PERSONAL_EXPORT_COLLECTIONS).toContain(entry.table)
    expect(['metadata_only', 'owner_response', 'withheld']).toContain(entry.export)
  }
  await t.run(ctx => ctx.db.insert('accountDeletionJobs', { userId, status: 'active', phase: 'documents', startedAt: Date.now(), updatedAt: Date.now() }))
  for (let batch = 0; batch < 180; batch++) {
    await t.mutation(internal.accountDeletion.runDeletionBatch, { userId })
    if ((await t.query(internal.accountDeletion.getDeletionTombstone, { userId }))?.phase === 'complete') break
  }
  expect(await t.query(internal.accountDeletion.getDeletionTombstone, { userId })).toMatchObject({ phase: 'complete' })
  for (const table of LEARN_MEASUREMENT_COLLECTIONS) expect(await t.run(ctx => ctx.db.query(table)
    .withIndex('by_userId', q => q.eq('userId', userId)).take(1)), table).toEqual([])
  await t.finishInProgressScheduledFunctions()
  vi.clearAllTimers()
})
