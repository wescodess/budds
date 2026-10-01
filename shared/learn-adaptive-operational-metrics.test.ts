import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const run = () => spawnSync(process.execPath, ['scripts/adaptive-learn-metrics.mjs'], { encoding: 'utf8' })
const frozen = () => JSON.parse(readFileSync('docs/operations/adaptive-learn-metric-fixtures/operational.v1.json', 'utf8'))
const custom = (fixture: unknown) => {
  const directory = mkdtempSync(join(tmpdir(), 'learn-metrics-'))
  try {
    const path = join(directory, 'fixture.json')
    writeFileSync(path, JSON.stringify(fixture))
    return spawnSync(process.execPath, ['scripts/adaptive-learn-metrics.mjs', '--fixture', path], { encoding: 'utf8' })
  }
  finally { rmSync(directory, { recursive: true }) }
}

test('operator reproduces frozen synthetic counters with pending activation', () => {
  const result = run()
  expect(result.status).toBe(0)
  const report = JSON.parse(result.stdout)
  expect(report).toMatchObject({
    synthetic: true, activationReady: false, queryVersion: 'operational_fixture_query.v1',
    metrics: {
      firstValue: { readyNumerator: 1, readyDenominator: 2, preparingDenominator: 1, readyRate: 0.5 },
      providerAmbiguity: { numerator: 1, denominator: 2, rate: 0.5 },
      fallback: { numerator: 1, denominator: 2, rate: 0.5 },
      latency: { sampleCount: 2, meanMs: 1500 },
      quotaDenial: { numerator: 1, denominator: 3, rate: 1 / 3 },
      recordedCost: { sampleCount: 2, totalUsdMicros: 3000 },
    },
  })
  expect(report.fixture.contentDigest).toMatch(/^[a-f0-9]{64}$/)
  expect(result.stdout).not.toContain('synthetic-owner')
  expect(result.stdout).not.toContain('synthetic-boundary-1')
  expect(report.definitions.every((definition: { approval: string, ownerPrincipal: null }) => definition.approval === 'pending' && definition.ownerPrincipal === null)).toBe(true)
})

test('operator distinguishes known non-dispatch from unknown dispatch completeness', () => {
  const fixture = frozen()
  fixture.providerBoundaries[2].reservationDecision = 'admitted'
  const notDispatched = JSON.parse(custom(fixture).stdout).metrics
  expect(notDispatched).toMatchObject({ providerAmbiguity: { status: 'known', denominator: 2 }, latency: { status: 'known', eligibleCount: 2, meanMs: 1500 }, recordedCost: { status: 'known', totalUsdMicros: 3000 } })
  fixture.providerBoundaries[2].dispatchState = 'unknown'
  const unknown = JSON.parse(custom(fixture).stdout).metrics
  expect(unknown).toMatchObject({ providerAmbiguity: { status: 'unknown', denominator: 2, missingCount: 1, rate: null }, latency: { status: 'unknown', eligibleCount: 2, unknownDispatchCount: 1, meanMs: null }, recordedCost: { status: 'unknown', unknownDispatchCount: 1, totalUsdMicros: null } })
})

test('operator rejects fixture bytes beyond the published bound', () => {
  const fixture = frozen()
  fixture.providerBoundaries = []
  fixture.ownerEvents = []
  const event = { ...fixture.firstValueEvents[0], eventId: 'bounded-event'.padEnd(100, 'a'), userId: 'bounded-owner'.padEnd(100, 'a'), threadId: 'bounded-thread'.padEnd(100, 'a') }
  fixture.firstValueEvents = [event]
  expect(custom(fixture).status).toBe(0)
  // Every row is otherwise valid and the 1,000-row limit is respected, so an
  // unrelated private-field or row-count rejection cannot satisfy this check.
  fixture.firstValueEvents = Array.from({ length: 1000 }, (_, index) => ({ ...event, eventId: `bounded-event-${index}`.padEnd(100, 'a'), opportunityOrdinal: index + 1 }))
  expect(Buffer.byteLength(JSON.stringify(fixture))).toBeGreaterThan(262_144)
  const result = custom(fixture)
  expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({ status: 1, stdout: '', stderr: 'Adaptive Learn metric fixture rejected\n' })
})

test('operator rejects private payload without echoing input', () => {
  const fixture = frozen()
  fixture.providerBoundaries[0].privatePrompt = 'PRIVATE_CANARY'
  const result = custom(fixture)
  expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({ status: 1, stdout: '', stderr: 'Adaptive Learn metric fixture rejected\n' })
})

test('operator sees incomplete cost and timing as unknown and never interprets a reservation failure as quota denial', () => {
  const fixture = frozen()
  fixture.providerBoundaries[0].completedAt = null
  fixture.providerBoundaries[0].recordedCostUsdMicros = null
  fixture.providerBoundaries[2].reservationDecision = null
  fixture.ownerEvents.push({ eventId: 'o3', boundaryId: 'synthetic-boundary-3', eventVersion: 'provider_failure.v1', occurredAt: 131000, providerStage: 'reservation' })
  const result = custom(fixture)
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout).metrics).toMatchObject({
    latency: { status: 'unknown', missingCount: 1, sampleCount: 1, meanMs: null, observedMeanMs: 2000 },
    recordedCost: { status: 'unknown', missingCount: 1, sampleCount: 1, totalUsdMicros: null, observedTotalUsdMicros: 2000 },
    quotaDenial: { status: 'unknown', missingCount: 1, numerator: 0, denominator: 2, rate: null },
  })
})

test('operator counts identical retries once regardless of input order', () => {
  const fixture = frozen()
  fixture.firstValueEvents.push({ ...fixture.firstValueEvents[0] })
  fixture.providerBoundaries.push({ ...fixture.providerBoundaries[0] })
  fixture.ownerEvents.push({ ...fixture.ownerEvents[0] })
  for (const name of ['firstValueEvents', 'providerBoundaries', 'ownerEvents']) fixture[name].reverse()
  const result = custom(fixture)
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout).metrics).toEqual(JSON.parse(run().stdout).metrics)
})

test.each([
  ['conflicting event ID', (fixture: ReturnType<typeof frozen>) => fixture.ownerEvents.push({ ...fixture.ownerEvents[0], occurredAt: 125000 })],
  ['conflicting boundary ID', (fixture: ReturnType<typeof frozen>) => fixture.providerBoundaries.push({ ...fixture.providerBoundaries[0], eventId: 'retry' })],
  ['invalid event version', (fixture: ReturnType<typeof frozen>) => fixture.ownerEvents[0].eventVersion = 'provider_ambiguity.v2'],
  ['unsafe timestamp', (fixture: ReturnType<typeof frozen>) => fixture.windowEnd = Number.MAX_SAFE_INTEGER + 1],
  ['retention exceeded', (fixture: ReturnType<typeof frozen>) => fixture.windowEnd = fixture.windowStart + 90 * 86400000 + 1],
  ['negative latency', (fixture: ReturnType<typeof frozen>) => fixture.providerBoundaries[0].completedAt = 100001],
  ['out of window', (fixture: ReturnType<typeof frozen>) => fixture.ownerEvents[0].occurredAt = 99999],
  ['unbounded rows', (fixture: ReturnType<typeof frozen>) => fixture.ownerEvents = Array.from({ length: 1001 }, () => fixture.ownerEvents[0])],
  ['actual cost overflow', (fixture: ReturnType<typeof frozen>) => fixture.providerBoundaries[0].recordedCostUsdMicros = Number.MAX_SAFE_INTEGER],
  ['non-synthetic input', (fixture: ReturnType<typeof frozen>) => fixture.synthetic = false],
  ['input approval override', (fixture: ReturnType<typeof frozen>) => fixture.approval = 'approved'],
  ['zero opportunity ordinal', (fixture: ReturnType<typeof frozen>) => fixture.firstValueEvents[0].opportunityOrdinal = 0],
  ['ready with exclusion', (fixture: ReturnType<typeof frozen>) => fixture.firstValueEvents[0].firstValueExclusionCode = 'flag_ineligible'],
  ['ambiguity before dispatch', (fixture: ReturnType<typeof frozen>) => fixture.ownerEvents[0].occurredAt = 119999],
])('operator rejects %s with a constant private-data-safe error', (_name, change) => {
  const fixture = frozen()
  change(fixture)
  const result = custom(fixture)
  expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({ status: 1, stdout: '', stderr: 'Adaptive Learn metric fixture rejected\n' })
})

test('operator distinguishes missing source telemetry from a known empty window', () => {
  const fixture = frozen()
  fixture.firstValueEvents = []; fixture.providerBoundaries = []; fixture.ownerEvents = []
  const empty = JSON.parse(custom(fixture).stdout).metrics
  expect(empty).toMatchObject({ firstValue: { status: 'no_denominator', readyDenominator: 0 }, providerAmbiguity: { status: 'no_denominator', numerator: 0, rate: null }, latency: { status: 'known_empty', meanMs: null }, recordedCost: { status: 'known_empty', totalUsdMicros: 0 } })
  fixture.coverage = { firstValue: false, providerBoundaries: false, ownerEvents: false }
  const missing = JSON.parse(custom(fixture).stdout).metrics
  expect(missing).toMatchObject({ firstValue: { status: 'unknown', readyDenominator: null }, providerAmbiguity: { status: 'unknown', numerator: null }, latency: { status: 'unknown', sampleCount: null }, recordedCost: { status: 'unknown', totalUsdMicros: null } })
})

test('operator reports ready timing at the ninety-second boundary separately from preparing and exclusions', () => {
  const fixture = frozen()
  fixture.firstValueEvents[1].occurredAt = 190001
  fixture.firstValueEvents[2].firstValueExclusionCode = 'flag_ineligible'
  fixture.firstValueEvents[2].firstValueEligibility = 'excluded'
  const result = custom(fixture)
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout).metrics.firstValue).toMatchObject({ readyNumerator: 0, readyDenominator: 1, preparingDenominator: 1, excluded: 7, exclusionCounts: { flag_ineligible: 2 } })
})

test('operator reproduces all frozen exclusion codes and preparing stays separate after meaningful work starts', () => {
  const fixture = frozen()
  fixture.firstValueEvents.push({ ...fixture.firstValueEvents[1], eventId: 'preparing-stop', threadId: 'synthetic-thread-3' })
  expect(JSON.parse(custom(fixture).stdout).metrics.firstValue).toMatchObject({
    readyNumerator: 1, readyDenominator: 2, preparingDenominator: 1, excluded: 6,
    exclusionCounts: { explicit_exclusion: 1, not_authenticated: 1, flag_ineligible: 1, evidence_blocked_at_commit: 1, content_not_published_at_commit: 1, standalone_activity_invalid: 1 },
  })
})

test('operator reports the seventy percent pilot target without implying activation approval', () => {
  const fixture = frozen()
  fixture.firstValueEvents = Array.from({ length: 10 }, (_, index) => ({ ...fixture.firstValueEvents[0], eventId: `start-${index}`, threadId: `synthetic-thread-${index}` }))
  fixture.firstValueEvents.push(...Array.from({ length: 7 }, (_, index) => ({ ...frozen().firstValueEvents[1], eventId: `stop-${index}`, threadId: `synthetic-thread-${index}` })))
  const atTarget = JSON.parse(custom(fixture).stdout)
  expect(atTarget).toMatchObject({ activationReady: false, metrics: { firstValue: { targetReadyRate: 0.7, readyRate: 0.7, meetsPilotTarget: true } } })
  fixture.firstValueEvents.pop()
  expect(JSON.parse(custom(fixture).stdout).metrics.firstValue).toMatchObject({ readyRate: 0.6, meetsPilotTarget: false })
})
