import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const frozen = () => JSON.parse(readFileSync('docs/operations/adaptive-learn-metric-fixtures/outcomes.v1.json', 'utf8'))
const run = (fixture?: ReturnType<typeof frozen>) => {
  const directory = mkdtempSync(join(tmpdir(), 'learn-outcomes-'))
  try {
    const args = ['scripts/adaptive-learn-outcomes.mjs']
    if (fixture) {
      const path = join(directory, 'fixture.json')
      writeFileSync(path, JSON.stringify(fixture))
      args.push('--fixture', path)
    }
    return spawnSync(process.execPath, args, { encoding: 'utf8' })
  }
  finally { rmSync(directory, { recursive: true }) }
}
const report = (fixture?: ReturnType<typeof frozen>) => {
  const result = run(fixture)
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' })
  return JSON.parse(result.stdout)
}

test('operator counts a seven-local-day DST pass and keeps unchecked due capabilities unknown', () => {
  expect(report()).toMatchObject({ synthetic: true, activationReady: false, metrics: {
    retention: { status: 'unknown', numerator: 1, denominator: 2, missingCount: 1, rate: null, observedChecks: { numerator: 1, denominator: 1, rate: 1 }, exclusions: { early: 1, assisted: 1, not_due: 1 } },
  } })
})

test('operator uses the earliest eligible delayed check rather than a later passing retry', () => {
  const fixture = frozen()
  fixture.attempts[3].scorePercent = 79
  fixture.experimentOutcomes[0].performancePassed = false
  fixture.attempts.push({ ...fixture.attempts[3], attemptId: 'later-pass', occurredAt: 1773072000000, scorePercent: 100 })
  expect(report(fixture).metrics.retention.observedChecks).toMatchObject({ numerator: 0, denominator: 1, rate: 0 })
})

test('operator preserves frozen experiment assignment and reports performance, completion and usefulness separately', () => {
  const fixture = frozen()
  fixture.coverage.experiment = true
  fixture.plans = [{ planId: 'plan1', version: 'adaptive-routing-analysis.v1', digest: 'a'.repeat(64), assignmentUnit: 'authenticated_learner', eligibilityVersion: 'learn-adaptive.experiment-eligibility.v1', exclusionVersion: 'learn-adaptive.experiment-exclusion.v1', denominatorVersion: 'denominator.v1', outcomeVersion: 'representative.v1', fixedContinuationVersion: 'fixed.v1' }]
  fixture.assignments = [{ assignmentId: 'assignment1', planId: 'plan1', planDigest: 'a'.repeat(64), learnerId: 'synthetic-learner-1', cohort: 'pilot', arm: 'adaptive', assignedAt: fixture.windowStart, eligible: true, exclusionCode: null, assignmentVersion: 'learn-adaptive.experiment-assignment.v1' }]
  fixture.experimentOutcomes = [{ assignmentId: 'assignment1', attemptId: 'delayed1', outcomeVersion: 'representative.v1', occurredAt: 1772985600000, performancePassed: true, completed: true, usefulnessRating: 2 }]
  expect(report(fixture).metrics.experiment).toMatchObject({ adaptive: { assignments: 1, outcomeAttempts: 1, performance: { numerator: 1, denominator: 1, rate: 1 }, completion: { rate: 1 }, usefulness: { numerator: 0, denominator: 1, rate: 0 } }, decisions: 'pending' })
  fixture.experimentOutcomes[0].usefulnessRating = null
  expect(report(fixture).metrics.experiment.adaptive.usefulness).toMatchObject({ status: 'unknown', missingCount: 1, rate: null })
})

test('operator deduplicates authoritative cross-feature attempts while retaining all verified origins', () => {
  const fixture = frozen()
  fixture.coverage.crossFeature = true
  const origins = ['chat', 'quiz', 'flashcards', 'podcast', 'documents'].map((sourceFeature, index) => ({ originId: `origin${index}`, sourceFeature, sourceIdentity: `source${index}`, sourceRevision: 'revision1', provenanceKey: `provenance${index}` }))
  const contribution = { contributionId: 'contribution1', contributionRevision: 1, authoritativeAttemptId: 'delayed1', lineageId: 'lineage1', producerProofVersion: 'synthetic_producer_proof.v1', producerVerified: true, originVisible: true, silentMastery: false, nextActionImproved: true, origins }
  fixture.contributions = [contribution, { ...contribution, contributionId: 'contribution2', origins: [origins[0]] }]
  expect(report(fixture).metrics.crossFeature).toMatchObject({ improvement: { numerator: 1, denominator: 1, rate: 1 }, authoritativeAttempts: 1, distinctOrigins: 5, duplicateAttemptProjections: 1, silentMasteryIncrements: 0, hiddenOrigins: 0, originCounts: { chat: 1, quiz: 1, flashcards: 1, podcast: 1, documents: 1 }, approval: 'pending' })
})

test('operator separates accessibility and recovery task denominators and missing verified outcomes', () => {
  const fixture = frozen()
  fixture.coverage.accessibility = true
  fixture.accessibilityProtocol = { version: 'accessibility_protocol.v1', testedSha: 'b'.repeat(40), taskVersion: 'task.v1', baselineVersion: 'fixed.v1', treatmentVersion: 'adaptive.v1', verifierSourceVersion: 'synthetic_verifier.v1', evidenceDigest: 'c'.repeat(64) }
  fixture.accessibilityRuns = [
    { runId: 'run1', taskId: 'task1', arm: 'fixed', occurredAt: fixture.windowStart, eligible: true, exclusionCode: null, completed: true, recovered: false, evidenceDigest: 'd'.repeat(64), verifierSourceVersion: 'synthetic_verifier.v1' },
    { runId: 'run2', taskId: 'task1', arm: 'adaptive', occurredAt: fixture.windowStart, eligible: true, exclusionCode: null, completed: null, recovered: true, evidenceDigest: 'e'.repeat(64), verifierSourceVersion: 'synthetic_verifier.v1' },
  ]
  expect(report(fixture).metrics.accessibility).toMatchObject({ fixed: { completion: { numerator: 1, denominator: 1, rate: 1 }, recovery: { numerator: 0, denominator: 1, rate: 0 } }, adaptive: { completion: { status: 'unknown', missingCount: 1, rate: null }, recovery: { rate: 1 } }, physicalAssistiveTechnologyEvidence: 'unknown', deployedEvidence: 'unknown' })
})

test('operator reports actual cost per recorded dispatched request and names incomplete samples', () => {
  const fixture = frozen()
  fixture.coverage.requests = true
  fixture.requests = [
    { requestId: 'request1', occurredAt: fixture.windowStart, dispatchState: 'dispatched', actualCostUsdMicros: 1000, eligible: true, exclusionCode: null },
    { requestId: 'request2', occurredAt: fixture.windowStart, dispatchState: 'dispatched', actualCostUsdMicros: 3000, eligible: true, exclusionCode: null },
    { requestId: 'request3', occurredAt: fixture.windowStart, dispatchState: 'not_dispatched', actualCostUsdMicros: null, eligible: true, exclusionCode: null },
  ]
  expect(report(fixture).metrics.cost).toMatchObject({ status: 'known', dispatchedCount: 2, sampleCount: 2, totalUsdMicros: 4000, costPerRequestUsdMicros: 2000, exclusions: { not_dispatched: 1, ineligible: 0 } })
  fixture.requests[1].actualCostUsdMicros = null
  fixture.requests[2].dispatchState = 'unknown'
  expect(report(fixture).metrics.cost).toMatchObject({ status: 'unknown', missingCount: 1, unknownDispatchCount: 1, totalUsdMicros: null, costPerRequestUsdMicros: null, observedTotalUsdMicros: 1000, observedCostPerRecordedRequestUsdMicros: 1000 })
})

test('operator counts deduplicated support contacts against an explicit cohort denominator', () => {
  const fixture = frozen()
  fixture.coverage.supportContacts = true; fixture.coverage.supportDenominators = true
  fixture.supportDenominators = [{ denominatorId: 'population1', cohort: 'pilot', eligibleLearnerCount: 10 }]
  const contact = { contactId: 'contact1', cohort: 'pilot', occurredAt: fixture.windowStart, category: 'recovery', eligible: true, exclusionCode: null }
  fixture.supportContacts = [contact, { ...contact }]
  expect(report(fixture).metrics.support).toMatchObject({ cohorts: { pilot: { contacts: { numerator: 1, denominator: 10, rate: 0.1 }, categoryCounts: { recovery: 1 }, excluded: 0 } } })
  fixture.coverage.supportContacts = false; fixture.supportContacts = []
  expect(report(fixture).metrics.support.cohorts.pilot.contacts).toMatchObject({ status: 'unknown', numerator: null, rate: null })
})

test('operator preserves the due population when delayed attempt source coverage is missing', () => {
  const fixture = frozen()
  fixture.coverage.attempts = false; fixture.attempts = []
  fixture.experimentOutcomes = []; fixture.contributions = []
  expect(report(fixture).metrics.retention).toMatchObject({ status: 'unknown', denominator: 2, numerator: null, rate: null, checkCoverage: { status: 'unknown', denominator: 2, numerator: null } })
})

test('operator rejects mixed experiment cohorts rather than pooling incompatible denominators', () => {
  const fixture = frozen()
  fixture.assignments[1].cohort = 'another-cohort'
  const result = run(fixture)
  expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({ status: 1, stdout: '', stderr: 'Adaptive Learn outcome fixture rejected\n' })
})

test('operator rejects a reset first-independent clock when an earlier unassisted pass is in authoritative history', () => {
  const fixture = frozen()
  fixture.attempts.push({ ...fixture.attempts[0], attemptId: 'earlier-first', occurredAt: fixture.windowStart })
  const result = run(fixture)
  expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({ status: 1, stdout: '', stderr: 'Adaptive Learn outcome fixture rejected\n' })
})

test('operator includes due capabilities whose pinned independent baseline predates the reporting window', () => {
  const fixture = frozen()
  fixture.windowStart = 1772928000000
  fixture.attempts = fixture.attempts.filter((row: { kind: string, occurredAt: number }) => row.kind === 'independent_application' || row.occurredAt >= fixture.windowStart)
  for (const name of ['plans', 'assignments', 'experimentOutcomes', 'contributions', 'accessibilityRuns', 'requests', 'supportContacts', 'supportDenominators']) fixture[name] = []
  fixture.accessibilityProtocol = null
  for (const name of ['experiment', 'crossFeature', 'accessibility', 'requests', 'supportContacts', 'supportDenominators']) fixture.coverage[name] = false
  expect(report(fixture).metrics.retention).toMatchObject({ numerator: 1, denominator: 2, missingCount: 1, checkCoverage: { numerator: 1, denominator: 2, rate: 0.5 } })
})

test('operator rejects distinct aliases of the same immutable learner capability', () => {
  const fixture = frozen()
  fixture.capabilities.push({ ...fixture.capabilities[0], capabilityId: 'alias', firstIndependentAttemptId: 'alias-first' })
  fixture.attempts.push({ ...fixture.attempts[0], capabilityId: 'alias', attemptId: 'alias-first' })
  const result = run(fixture)
  expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({ status: 1, stdout: '', stderr: 'Adaptive Learn outcome fixture rejected\n' })
})

test('operator retains experiment assignments frozen before the reporting window', () => {
  const fixture = frozen()
  fixture.assignments[0].assignedAt = fixture.windowStart - 86400000
  expect(report(fixture).metrics.experiment.adaptive.performance).toMatchObject({ numerator: 1, denominator: 1, rate: 1 })
})

test('operator reproduces all frozen families without publishing private identities or approvals', () => {
  const result = run()
  const publication = report()
  expect(publication.metrics).toMatchObject({
    retention: { checkCoverage: { numerator: 1, denominator: 2, rate: 0.5 } },
    experiment: { fixed: { usefulness: { rate: 1 } }, adaptive: { usefulness: { rate: 0 } }, decisions: 'pending' },
    crossFeature: { authoritativeAttempts: 1, distinctOrigins: 5, approval: 'pending' },
    accessibility: { fixed: { recovery: { rate: 0 } }, adaptive: { recovery: { rate: 1 } }, physicalAssistiveTechnologyEvidence: 'unknown' },
    cost: { totalUsdMicros: 4000, costPerRequestUsdMicros: 2000 },
    support: { cohorts: { pilot: { contacts: { rate: 0.1 }, excluded: 1 } } },
  })
  expect(publication.fixture.contentDigest).toMatch(/^[a-f0-9]{64}$/)
  expect(publication).toMatchObject({ sourceVersions: { retention: 'capability_attempt_fixture.v1', cost: 'recorded_request_cost_fixture.v1' }, sourceCoverage: { capabilities: true, attempts: true, supportDenominators: true }, fixture: { windowStart: 1772380800000, windowEnd: 1773590400000 } })
  expect(publication.definitions.every((definition: { ownerPrincipal: null, approval: string, liveTelemetryAdapter: string }) => definition.ownerPrincipal === null && definition.approval === 'pending' && definition.liveTelemetryAdapter === 'pending')).toBe(true)
  for (const identity of ['synthetic-learner-1', 'cap-dst', 'first1', 'delayed1', 'assignment1', 'contribution1', 'origin0', 'contact1', 'request1', 'run1']) expect(result.stdout).not.toContain(identity)
})

test('operator deduplicates identical retries and origin ordering without changing aggregates', () => {
  const fixture = frozen()
  for (const name of ['capabilities', 'attempts', 'plans', 'assignments', 'experimentOutcomes', 'contributions', 'accessibilityRuns', 'requests', 'supportContacts', 'supportDenominators']) {
    fixture[name].push(structuredClone(fixture[name][0]))
    fixture[name].reverse()
  }
  for (const contribution of fixture.contributions) contribution.origins.reverse()
  expect(report(fixture).metrics).toEqual(report().metrics)
})

test('operator rejects renamed aliases of one canonical source origin', () => {
  const fixture = frozen()
  fixture.contributions[0].origins.push({ ...fixture.contributions[0].origins[0], originId: 'renamed', provenanceKey: 'renamed-key' })
  const result = run(fixture)
  expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({ status: 1, stdout: '', stderr: 'Adaptive Learn outcome fixture rejected\n' })
})

test('operator preserves distinct authoritative attempts that merely share source content', () => {
  const fixture = frozen()
  const contribution = fixture.contributions[0]
  fixture.contributions.push({ ...contribution, contributionId: 'distinct-contribution', authoritativeAttemptId: 'early1', lineageId: 'distinct-lineage', origins: [{ ...contribution.origins[0], originId: 'distinct-origin', provenanceKey: 'distinct-provenance' }] })
  expect(report(fixture).metrics.crossFeature).toMatchObject({ authoritativeAttempts: 2, distinctOrigins: 6, improvement: { numerator: 2, denominator: 2, rate: 1 } })
})

const crossFeatureWindow = () => {
  const fixture = frozen()
  fixture.windowStart = 1772928000000
  fixture.attempts = fixture.attempts.filter((row: { kind: string, occurredAt: number }) => row.kind === 'independent_application' || row.occurredAt >= fixture.windowStart)
  for (const name of ['plans', 'assignments', 'experimentOutcomes', 'accessibilityRuns', 'requests', 'supportContacts', 'supportDenominators']) fixture[name] = []
  fixture.accessibilityProtocol = null
  for (const name of ['experiment', 'accessibility', 'requests', 'supportContacts', 'supportDenominators']) fixture.coverage[name] = false
  return fixture
}

test('operator excludes historical cross-feature attempts while retaining historical retention baselines', () => {
  const fixture = crossFeatureWindow()
  fixture.contributions[0].authoritativeAttemptId = 'first1'
  expect(report(fixture).metrics).toMatchObject({ crossFeature: { improvement: { status: 'no_denominator', numerator: 0, denominator: 0, rate: null }, authoritativeAttempts: 0, distinctOrigins: 0, exclusions: { out_of_window: 1 } }, retention: { numerator: 1, denominator: 2, missingCount: 1 } })
})

test.each(['windowStart', 'windowEnd'])('operator includes cross-feature attempts at the inclusive %s boundary', (boundary) => {
  const fixture = crossFeatureWindow()
  fixture.attempts.find((row: { attemptId: string }) => row.attemptId === 'delayed1').occurredAt = fixture[boundary]
  expect(report(fixture).metrics.crossFeature).toMatchObject({ improvement: { status: 'known', numerator: 1, denominator: 1, rate: 1 }, authoritativeAttempts: 1, distinctOrigins: 5, exclusions: { out_of_window: 0 } })
})

test('operator rejects eligible contacts against an explicitly empty cohort population', () => {
  const fixture = frozen()
  fixture.supportDenominators[0].eligibleLearnerCount = 0
  const result = run(fixture)
  expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({ status: 1, stdout: '', stderr: 'Adaptive Learn outcome fixture rejected\n' })
})

test('operator distinguishes known empty measurements from unavailable sources in every family', () => {
  const fixture = frozen()
  for (const name of ['capabilities', 'attempts', 'plans', 'assignments', 'experimentOutcomes', 'contributions', 'accessibilityRuns', 'requests', 'supportContacts', 'supportDenominators']) fixture[name] = []
  const empty = report(fixture).metrics
  expect(empty).toMatchObject({ retention: { status: 'no_denominator', denominator: 0 }, experiment: { fixed: { performance: { status: 'no_denominator', denominator: 0 } } }, crossFeature: { authoritativeAttempts: 0, improvement: { status: 'no_denominator' } }, accessibility: { adaptive: { recovery: { status: 'no_denominator' } } }, cost: { status: 'no_denominator', totalUsdMicros: 0 }, support: { status: 'no_denominator', cohorts: {} } })
  fixture.accessibilityProtocol = null
  for (const key of Object.keys(fixture.coverage)) fixture.coverage[key] = false
  expect(report(fixture).metrics).toMatchObject({ retention: { status: 'unknown', denominator: null, numerator: null }, experiment: { adaptive: { usefulness: { status: 'unknown', numerator: null } } }, crossFeature: { authoritativeAttempts: null, improvement: { status: 'unknown' } }, accessibility: { fixed: { completion: { status: 'unknown' } } }, cost: { status: 'unknown', totalUsdMicros: null }, support: { status: 'unknown' } })
})

test('operator enforces the byte limit independently of valid row and shape limits', () => {
  const fixture = frozen()
  for (const name of ['capabilities', 'attempts', 'plans', 'assignments', 'experimentOutcomes', 'contributions', 'accessibilityRuns', 'requests', 'supportContacts', 'supportDenominators']) fixture[name] = []
  fixture.accessibilityProtocol = null; fixture.coverage.accessibility = false
  fixture.requests = Array.from({ length: 1000 }, (_, index) => ({ requestId: `request-${index}`.padEnd(100, 'a'), occurredAt: fixture.windowStart, dispatchState: 'dispatched', actualCostUsdMicros: 1000, eligible: false, exclusionCode: 'ineligible' }))
  // Valid rows are just below the byte bound; whitespace alone crosses it.
  expect(run(fixture).status).toBe(0)
  const directory = mkdtempSync(join(tmpdir(), 'learn-outcome-bytes-'))
  try {
    const path = join(directory, 'fixture.json')
    writeFileSync(path, JSON.stringify(fixture).padEnd(262_145, ' '))
    const result = spawnSync(process.execPath, ['scripts/adaptive-learn-outcomes.mjs', '--fixture', path], { encoding: 'utf8' })
    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({ status: 1, stdout: '', stderr: 'Adaptive Learn outcome fixture rejected\n' })
  }
  finally { rmSync(directory, { recursive: true }) }
})

test.each([
  ['unsupported fixture version', (f: ReturnType<typeof frozen>) => f.version = 'adaptive_learn_outcome_fixture.v2'],
  ['unsupported source version', (f: ReturnType<typeof frozen>) => f.sourceVersions.cost = 'recorded_request_cost_fixture.v2'],
  ['non-synthetic telemetry', (f: ReturnType<typeof frozen>) => f.synthetic = false],
  ['approval override', (f: ReturnType<typeof frozen>) => f.approval = 'approved'],
  ['raw private answer', (f: ReturnType<typeof frozen>) => f.attempts[0].privateAnswer = 'PRIVATE_CANARY'],
  ['raw contact text', (f: ReturnType<typeof frozen>) => f.supportContacts[0].contactText = 'PRIVATE_CANARY'],
  ['configured reservation substituted for actual cost', (f: ReturnType<typeof frozen>) => f.requests[0].providerReservedMicroUsd = 1000],
  ['unsafe cost', (f: ReturnType<typeof frozen>) => f.requests[0].actualCostUsdMicros = Number.MAX_SAFE_INTEGER + 1],
  ['overflowing actual cost sum', (f: ReturnType<typeof frozen>) => f.requests[0].actualCostUsdMicros = Number.MAX_SAFE_INTEGER],
  ['unsafe timestamp', (f: ReturnType<typeof frozen>) => f.windowEnd = Number.MAX_SAFE_INTEGER + 1],
  ['ninety-day window exceeded', (f: ReturnType<typeof frozen>) => f.windowEnd = f.windowStart + 90 * 86400000 + 1],
  ['unknown timezone', (f: ReturnType<typeof frozen>) => f.capabilities[0].timeZone = 'Unknown/Private'],
  ['conflicting capability retry', (f: ReturnType<typeof frozen>) => f.capabilities.push({ ...f.capabilities[0], sourceRevision: 'conflicting' })],
  ['conflicting attempt alias', (f: ReturnType<typeof frozen>) => f.attempts.push({ ...f.attempts[3], scorePercent: 99 })],
  ['conflicting objective pin', (f: ReturnType<typeof frozen>) => f.attempts[3].objectiveId = 'other-objective'],
  ['assisted first independence', (f: ReturnType<typeof frozen>) => f.attempts[0].assisted = true],
  ['missing pinned baseline', (f: ReturnType<typeof frozen>) => f.attempts.shift()],
  ['out-of-window delayed outcome', (f: ReturnType<typeof frozen>) => f.attempts[3].occurredAt = f.windowEnd + 1],
  ['unreferenced out-of-window history', (f: ReturnType<typeof frozen>) => f.attempts.push({ ...f.attempts[0], attemptId: 'unreferenced', occurredAt: f.windowStart - 1 })],
  ['analysis plan drift', (f: ReturnType<typeof frozen>) => f.assignments[0].planDigest = 'f'.repeat(64)],
  ['assignment unit drift', (f: ReturnType<typeof frozen>) => f.plans[0].assignmentUnit = 'thread'],
  ['reassignment alias', (f: ReturnType<typeof frozen>) => f.assignments.push({ ...f.assignments[0], assignmentId: 'alias' })],
  ['outcome owner mismatch', (f: ReturnType<typeof frozen>) => f.experimentOutcomes[0].assignmentId = 'assignment2'],
  ['outcome clock mismatch', (f: ReturnType<typeof frozen>) => f.experimentOutcomes[0].occurredAt++],
  ['conflicting outcome retry', (f: ReturnType<typeof frozen>) => f.experimentOutcomes.push({ ...f.experimentOutcomes[0], completed: false })],
  ['unknown outcome version', (f: ReturnType<typeof frozen>) => f.experimentOutcomes[0].outcomeVersion = 'representative.v2'],
  ['client claimed lineage', (f: ReturnType<typeof frozen>) => f.contributions[0].producerVerified = false],
  ['hidden origin', (f: ReturnType<typeof frozen>) => f.contributions[0].originVisible = false],
  ['silent mastery increment', (f: ReturnType<typeof frozen>) => f.contributions[0].silentMastery = true],
  ['origin alias conflict', (f: ReturnType<typeof frozen>) => f.contributions[0].origins.push({ ...f.contributions[0].origins[0], sourceRevision: 'drift' })],
  ['provenance alias conflict', (f: ReturnType<typeof frozen>) => f.contributions[0].origins.push({ ...f.contributions[0].origins[0], originId: 'alias' })],
  ['unrelated activity reconciled by lineage', (f: ReturnType<typeof frozen>) => f.contributions.push({ ...f.contributions[0], contributionId: 'another', authoritativeAttemptId: 'early1' })],
  ['unsupported origin type', (f: ReturnType<typeof frozen>) => f.contributions[0].origins[0].sourceFeature = 'client-private'],
  ['physical verifier claimed by fixture', (f: ReturnType<typeof frozen>) => f.accessibilityProtocol.verifierSourceVersion = 'physical_at.v1'],
  ['missing evidence for accessibility outcome', (f: ReturnType<typeof frozen>) => f.accessibilityRuns[0].evidenceDigest = null],
  ['conflicting accessibility task alias', (f: ReturnType<typeof frozen>) => f.accessibilityRuns.push({ ...f.accessibilityRuns[0], runId: 'alias' })],
  ['cost on known non-dispatch', (f: ReturnType<typeof frozen>) => f.requests[2].actualCostUsdMicros = 1000],
  ['unknown closed contact category', (f: ReturnType<typeof frozen>) => f.supportContacts[0].category = 'private-category'],
  ['conflicting contact retry', (f: ReturnType<typeof frozen>) => f.supportContacts.push({ ...f.supportContacts[0], category: 'account' })],
  ['conflicting denominator alias', (f: ReturnType<typeof frozen>) => f.supportDenominators.push({ ...f.supportDenominators[0], denominatorId: 'alias' })],
  ['coverage contradicted by rows', (f: ReturnType<typeof frozen>) => f.coverage.requests = false],
  ['total nested row limit before deduplication', (f: ReturnType<typeof frozen>) => f.contributions[0].origins = Array.from({ length: 1000 }, () => f.contributions[0].origins[0])],
])('operator rejects %s with empty stdout and constant stderr', (_name, change) => {
  const fixture = frozen()
  change(fixture)
  const result = run(fixture)
  expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({ status: 1, stdout: '', stderr: 'Adaptive Learn outcome fixture rejected\n' })
})
