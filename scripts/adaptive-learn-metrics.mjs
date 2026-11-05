import { open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { OPERATIONAL_METRIC_DEFINITIONS, OPERATIONAL_REGISTRY_VERSION, OPERATIONAL_QUERY_VERSION, OPERATIONAL_FIXTURE_LIMITS, OPERATIONAL_FIXTURE_VERSION, PROVIDER_BOUNDARY_SOURCE_VERSION } from '../shared/learn-adaptive-operational-metrics.ts'
import { buildFirstValuePilotReport } from '../shared/learn-adaptive-metrics.ts'

const reject = () => { throw new Error('invalid') }
const keys = (value, allowed, required = allowed) => {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !(key in value))) reject()
}
const integer = value => { if (!Number.isSafeInteger(value) || value < 0) reject() }
const token = value => { if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(value)) reject() }
const canonical = value => JSON.stringify(value, Object.keys(value).sort())
const validate = fixture => {
  keys(fixture, ['version', 'fixtureId', 'synthetic', 'windowStart', 'windowEnd', 'coverage', 'firstValueEvents', 'providerBoundaries', 'ownerEvents'])
  if (fixture.version !== OPERATIONAL_FIXTURE_VERSION || fixture.fixtureId !== 'operational.v1' || fixture.synthetic !== true) reject()
  integer(fixture.windowStart); integer(fixture.windowEnd)
  if (fixture.windowEnd < fixture.windowStart || fixture.windowEnd - fixture.windowStart > OPERATIONAL_FIXTURE_LIMITS.windowMs) reject()
  keys(fixture.coverage, ['firstValue', 'providerBoundaries', 'ownerEvents'])
  if (Object.values(fixture.coverage).some(value => typeof value !== 'boolean')) reject()
  const arrays = ['firstValueEvents', 'providerBoundaries', 'ownerEvents']
  if (arrays.some(key => !Array.isArray(fixture[key])) || arrays.reduce((sum, key) => sum + fixture[key].length, 0) > OPERATIONAL_FIXTURE_LIMITS.rows) reject()
  const ids = new Map()
  const inWindow = value => { integer(value); if (value < fixture.windowStart || value > fixture.windowEnd) reject() }
  for (const name of arrays) {
    const rows = []
    for (const row of fixture[name]) {
      if (name === 'firstValueEvents') {
        keys(row, ['eventId', 'userId', 'threadId', 'opportunityOrdinal', 'eventVersion', 'occurredAt', 'firstValueEligibility', 'firstValueExclusionCode', 'cohort', 'activityContractVersion'], ['eventId', 'userId', 'threadId', 'opportunityOrdinal', 'eventVersion', 'occurredAt'])
        token(row.userId); token(row.threadId); integer(row.opportunityOrdinal)
        if (row.opportunityOrdinal < 1 || (row.firstValueExclusionCode !== undefined && row.firstValueEligibility !== 'excluded')) reject()
        if (!['thread_command_committed.v1', 'meaningful_activity_started.v1'].includes(row.eventVersion)) reject()
        if (row.firstValueEligibility !== undefined && !['ready_factual_content', 'ready_standalone_non_factual', 'preparing', 'excluded'].includes(row.firstValueEligibility)) reject()
        if (row.firstValueExclusionCode !== undefined && !OPERATIONAL_METRIC_DEFINITIONS[0].exclusions.includes(row.firstValueExclusionCode)) reject()
        if (row.firstValueEligibility === 'excluded' && row.firstValueExclusionCode === undefined) reject()
        if (row.eventVersion === 'thread_command_committed.v1') { token(row.cohort); if (row.activityContractVersion !== 'learn-adaptive.activity-contract.v1' || row.firstValueEligibility === undefined) reject() }
        else if (row.cohort !== undefined || row.activityContractVersion !== undefined || row.firstValueEligibility !== undefined || row.firstValueExclusionCode !== undefined) reject()
      }
      else if (name === 'providerBoundaries') {
        keys(row, ['eventId', 'sourceVersion', 'boundaryId', 'occurredAt', 'reservationDecision', 'dispatchState', 'dispatchedAt', 'completedAt', 'recordedCostUsdMicros', 'renderAttempt'])
        token(row.boundaryId)
        if (row.sourceVersion !== PROVIDER_BOUNDARY_SOURCE_VERSION || !['admitted', 'quota_denied', null].includes(row.reservationDecision) || typeof row.renderAttempt !== 'boolean') reject()
        if (!['dispatched', 'not_dispatched', 'unknown'].includes(row.dispatchState)) reject()
        if ((row.dispatchState === 'dispatched' && row.dispatchedAt === null) || (row.dispatchState !== 'dispatched' && row.dispatchedAt !== null) || (row.reservationDecision === 'quota_denied' && row.dispatchState !== 'not_dispatched')) reject()
        if (row.dispatchedAt !== null) inWindow(row.dispatchedAt)
        if (row.completedAt !== null) { inWindow(row.completedAt); if (row.dispatchedAt === null || row.completedAt < row.dispatchedAt) reject() }
        if (row.recordedCostUsdMicros !== null) { integer(row.recordedCostUsdMicros); if (row.dispatchedAt === null) reject() }
        if (row.reservationDecision !== 'admitted' && row.dispatchedAt !== null) reject()
        if (row.dispatchedAt !== null && row.dispatchedAt < row.occurredAt) reject()
      }
      else {
        keys(row, ['eventId', 'boundaryId', 'eventVersion', 'occurredAt', 'providerStage', 'outcomeCode'], ['eventId', 'boundaryId', 'eventVersion', 'occurredAt'])
        token(row.boundaryId)
        if (row.eventVersion === 'provider_ambiguity.v1') { if (row.providerStage !== 'reconciliation' || row.outcomeCode !== undefined) reject() }
        else if (row.eventVersion === 'provider_failure.v1') { if (!['reservation', 'outcome'].includes(row.providerStage) || row.outcomeCode !== undefined) reject() }
        else if (row.eventVersion === 'canvas_render_failure.v1') { if (row.outcomeCode !== 'fallback_rendered' || row.providerStage !== undefined) reject() }
        else reject()
      }
      token(row.eventId); inWindow(row.occurredAt)
      const identity = `${name}:${canonical(row)}`
      if (ids.has(row.eventId)) { if (ids.get(row.eventId) !== identity) reject() }
      else { ids.set(row.eventId, identity); rows.push(row) }
    }
    fixture[name] = rows.sort((a, b) => a.eventId.localeCompare(b.eventId))
  }
  const boundaries = new Map()
  for (const row of fixture.providerBoundaries) { if (boundaries.has(row.boundaryId)) reject(); boundaries.set(row.boundaryId, row) }
  for (const row of fixture.ownerEvents) {
    const boundary = boundaries.get(row.boundaryId)
    if (fixture.coverage.providerBoundaries && (!boundary || row.occurredAt < boundary.occurredAt || (row.eventVersion === 'provider_ambiguity.v1' && (boundary.dispatchedAt === null || row.occurredAt < boundary.dispatchedAt)) || (row.eventVersion === 'canvas_render_failure.v1' && !boundary.renderAttempt))) reject()
  }
  if ((!fixture.coverage.firstValue && fixture.firstValueEvents.length) || (!fixture.coverage.providerBoundaries && fixture.providerBoundaries.length) || (!fixture.coverage.ownerEvents && fixture.ownerEvents.length)) reject()
}

try {
  const args = process.argv.slice(2)
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--fixture')) throw new Error('invalid')
  const handle = await open(args[1] ?? new URL('../docs/operations/adaptive-learn-metric-fixtures/operational.v1.json', import.meta.url), 'r')
  let bytes
  try {
    if (!(await handle.stat()).isFile()) reject()
    const buffer = Buffer.alloc(OPERATIONAL_FIXTURE_LIMITS.bytes + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > OPERATIONAL_FIXTURE_LIMITS.bytes) reject()
    bytes = buffer.subarray(0, length)
  }
  finally { await handle.close() }
  const fixture = JSON.parse(bytes.toString('utf8'))
  validate(fixture)
  const first = buildFirstValuePilotReport(fixture.firstValueEvents)
  const boundaries = fixture.providerBoundaries
  const dispatched = boundaries.filter(row => row.dispatchedAt !== null)
  const unknownDispatch = boundaries.filter(row => row.dispatchState === 'unknown').length
  const decisions = boundaries.filter(row => row.reservationDecision !== null)
  const renders = boundaries.filter(row => row.renderAttempt)
  const latencies = dispatched.filter(row => row.completedAt !== null).map(row => row.completedAt - row.dispatchedAt)
  const costs = dispatched.filter(row => row.recordedCostUsdMicros !== null).map(row => row.recordedCostUsdMicros)
  const ratio = (numerator, denominator, sourceKnown = true, missingCount = 0) => ({
    status: !sourceKnown || missingCount ? 'unknown' : denominator ? 'known' : 'no_denominator',
    numerator: sourceKnown ? numerator : null, denominator: sourceKnown ? denominator : null,
    rate: sourceKnown && !missingCount && denominator ? numerator / denominator : null,
    missingCount: sourceKnown ? missingCount : null,
  })
  const samples = (values, eligibleCount, field, observedField, mean = false) => {
    const sum = values.reduce((a, b) => a + b, 0)
    integer(sum)
    const observed = mean ? (values.length ? sum / values.length : null) : sum
    const known = fixture.coverage.providerBoundaries
    const missingCount = eligibleCount - values.length
    return { status: !known || missingCount || unknownDispatch ? 'unknown' : eligibleCount ? 'known' : 'known_empty', eligibleCount: known ? eligibleCount : null, sampleCount: known ? values.length : null, missingCount: known ? missingCount : null, unknownDispatchCount: known ? unknownDispatch : null, [field]: known && !missingCount && !unknownDispatch ? observed : null, [observedField]: known ? observed : null }
  }
  const sourceKnown = fixture.coverage.providerBoundaries && fixture.coverage.ownerEvents
  console.log(JSON.stringify({
    synthetic: true, activationReady: false, registryVersion: OPERATIONAL_REGISTRY_VERSION, queryVersion: OPERATIONAL_QUERY_VERSION,
    fixture: { identity: fixture.fixtureId, version: fixture.version, contentDigest: createHash('sha256').update(bytes).digest('hex') },
    definitions: OPERATIONAL_METRIC_DEFINITIONS,
    metrics: {
      firstValue: fixture.coverage.firstValue ? { status: first.readyDenominator ? 'known' : 'no_denominator', readyNumerator: first.readyNumerator, readyDenominator: first.readyDenominator, preparingDenominator: first.preparingDenominator, excluded: first.excluded, readyRate: first.readyRate, targetReadyRate: first.targetReadyRate, meetsPilotTarget: first.meetsPilotTarget, exclusionCounts: Object.fromEntries(OPERATIONAL_METRIC_DEFINITIONS[0].exclusions.map(code => [code, first.opportunities.filter(row => row.exclusionCode === code).length])) } : { status: 'unknown', readyNumerator: null, readyDenominator: null, preparingDenominator: null, excluded: null, readyRate: null, targetReadyRate: first.targetReadyRate, meetsPilotTarget: null, exclusionCounts: null },
      providerAmbiguity: ratio(new Set(fixture.ownerEvents.filter(row => row.eventVersion === 'provider_ambiguity.v1').map(row => row.boundaryId)).size, dispatched.length, sourceKnown, unknownDispatch),
      fallback: ratio(new Set(fixture.ownerEvents.filter(row => row.outcomeCode === 'fallback_rendered').map(row => row.boundaryId)).size, renders.length, sourceKnown),
      latency: samples(latencies, dispatched.length, 'meanMs', 'observedMeanMs', true),
      quotaDenial: ratio(boundaries.filter(row => row.reservationDecision === 'quota_denied').length, decisions.length, fixture.coverage.providerBoundaries, boundaries.length - decisions.length),
      recordedCost: samples(costs, dispatched.length, 'totalUsdMicros', 'observedTotalUsdMicros'),
    },
    liveTelemetryAdapter: 'pending',
  }))
}
catch {
  console.error('Adaptive Learn metric fixture rejected')
  process.exitCode = 1
}
