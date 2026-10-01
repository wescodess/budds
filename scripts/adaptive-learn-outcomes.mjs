import { open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { OUTCOME_METRIC_DEFINITIONS, OUTCOME_REGISTRY_VERSION, OUTCOME_QUERY_VERSION, OUTCOME_FIXTURE_VERSION, OUTCOME_FIXTURE_LIMITS, OUTCOME_SOURCE_VERSIONS } from '../shared/learn-adaptive-outcome-metrics.ts'
import { localDateAt, addCalendarDays, LEARN_V2_MASTERY_THRESHOLD } from '../shared/learn-v2-mastery.ts'

const reject = () => { throw new Error('invalid') }
const keys = (value, allowed) => {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).length !== allowed.length || Object.keys(value).some(key => !allowed.includes(key))) reject()
}
const integer = value => { if (!Number.isSafeInteger(value) || value < 0) reject() }
const token = value => { if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(value)) reject() }
const digest = value => { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) reject() }
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value
const canonical = value => JSON.stringify(normalize(value))
const unique = (rows, field) => {
  const identities = new Map()
  for (const row of rows) {
    const previous = identities.get(row[field])
    if (previous && canonical(previous) !== canonical(row)) reject()
    identities.set(row[field], row)
  }
  return [...identities.values()].sort((a, b) => a[field].localeCompare(b[field]))
}
const ratio = (numerator, denominator, known, missingCount = 0) => ({ status: !known || missingCount ? 'unknown' : denominator ? 'known' : 'no_denominator', numerator: known ? numerator : null, denominator: known ? denominator : null, missingCount: known ? missingCount : null, rate: known && !missingCount && denominator ? numerator / denominator : null })
const pins = ['blueprintRevision', 'objectiveId', 'rubricVersion', 'sourceRevision']
const originTypes = ['chat', 'quiz', 'flashcards', 'podcast', 'documents']
const supportCategories = ['accessibility', 'recovery', 'provider', 'evidence', 'account', 'other']
const validate = fixture => {
  keys(fixture, ['version', 'fixtureId', 'synthetic', 'windowStart', 'windowEnd', 'sourceVersions', 'coverage', 'capabilities', 'attempts', 'plans', 'assignments', 'experimentOutcomes', 'contributions', 'accessibilityProtocol', 'accessibilityRuns', 'requests', 'supportContacts', 'supportDenominators'])
  if (fixture.version !== OUTCOME_FIXTURE_VERSION || fixture.fixtureId !== 'outcomes.v1' || fixture.synthetic !== true) reject()
  integer(fixture.windowStart); integer(fixture.windowEnd)
  if (fixture.windowEnd < fixture.windowStart || fixture.windowEnd - fixture.windowStart > OUTCOME_FIXTURE_LIMITS.windowMs) reject()
  keys(fixture.sourceVersions, Object.keys(OUTCOME_SOURCE_VERSIONS))
  if (Object.entries(OUTCOME_SOURCE_VERSIONS).some(([key, version]) => fixture.sourceVersions[key] !== version)) reject()
  keys(fixture.coverage, ['capabilities', 'attempts', 'experiment', 'crossFeature', 'accessibility', 'requests', 'supportContacts', 'supportDenominators'])
  if (Object.values(fixture.coverage).some(value => typeof value !== 'boolean')) reject()
  const inWindow = value => { integer(value); if (value < fixture.windowStart || value > fixture.windowEnd) reject() }
  for (const name of ['capabilities', 'attempts']) {
    if (!Array.isArray(fixture[name]) || (!fixture.coverage[name] && fixture[name].length)) reject()
    for (const row of fixture[name]) {
      if (name === 'capabilities') {
        keys(row, ['capabilityId', 'learnerId', ...pins, 'firstIndependentAttemptId', 'firstIndependentAt', 'timeZone'])
        token(row.learnerId); token(row.firstIndependentAttemptId); integer(row.firstIndependentAt)
        if (row.firstIndependentAt > fixture.windowEnd) reject()
        if (typeof row.timeZone !== 'string' || row.timeZone.length > 100) reject()
        localDateAt(row.firstIndependentAt, row.timeZone)
      }
      else {
        keys(row, ['attemptId', 'capabilityId', 'occurredAt', 'kind', 'assisted', 'scorePercent', ...pins])
        token(row.attemptId); integer(row.occurredAt); integer(row.scorePercent)
        if (row.occurredAt > fixture.windowEnd || (row.occurredAt < fixture.windowStart && !fixture.capabilities.some(capability => capability.firstIndependentAttemptId === row.attemptId && capability.firstIndependentAt === row.occurredAt))) reject()
        if (row.scorePercent > 100 || typeof row.assisted !== 'boolean' || !['independent_application', 'retained_transfer'].includes(row.kind)) reject()
      }
      token(row.capabilityId); for (const pin of pins) token(row[pin])
    }
  }
  for (const name of ['plans', 'assignments', 'experimentOutcomes']) {
    if (!Array.isArray(fixture[name]) || (!fixture.coverage.experiment && fixture[name].length)) reject()
  }
  if (!Array.isArray(fixture.contributions) || (!fixture.coverage.crossFeature && fixture.contributions.length) || fixture.contributions.some(row => !Array.isArray(row.origins))) reject()
  if (!Array.isArray(fixture.accessibilityRuns) || (!fixture.coverage.accessibility && (fixture.accessibilityRuns.length || fixture.accessibilityProtocol !== null))) reject()
  if (!Array.isArray(fixture.requests) || (!fixture.coverage.requests && fixture.requests.length)) reject()
  for (const name of ['supportContacts', 'supportDenominators']) if (!Array.isArray(fixture[name]) || (!fixture.coverage[name] && fixture[name].length)) reject()
  if (['capabilities', 'attempts', 'plans', 'assignments', 'experimentOutcomes', 'contributions', 'accessibilityRuns', 'requests', 'supportContacts', 'supportDenominators'].reduce((sum, name) => sum + fixture[name].length, 0) + fixture.contributions.reduce((sum, row) => sum + row.origins.length, 0) + (fixture.accessibilityProtocol === null ? 0 : 1) > OUTCOME_FIXTURE_LIMITS.rows) reject()
  fixture.capabilities = unique(fixture.capabilities, 'capabilityId'); fixture.attempts = unique(fixture.attempts, 'attemptId')
  if (new Set(fixture.capabilities.map(row => canonical([row.learnerId, row.blueprintRevision, row.objectiveId]))).size !== fixture.capabilities.length) reject()
  const capabilities = new Map(fixture.capabilities.map(row => [row.capabilityId, row]))
  for (const attempt of fixture.attempts) {
    const capability = capabilities.get(attempt.capabilityId)
    if (!capability || pins.some(pin => capability[pin] !== attempt[pin]) || attempt.occurredAt < capability.firstIndependentAt) reject()
  }
  if (fixture.coverage.attempts) for (const capability of fixture.capabilities) {
    const first = fixture.attempts.find(row => row.attemptId === capability.firstIndependentAttemptId)
    if (!first || first.capabilityId !== capability.capabilityId || first.occurredAt !== capability.firstIndependentAt || first.assisted || first.kind !== 'independent_application' || first.scorePercent < LEARN_V2_MASTERY_THRESHOLD) reject()
  }
  for (const plan of fixture.plans) {
    keys(plan, ['planId', 'version', 'digest', 'assignmentUnit', 'eligibilityVersion', 'exclusionVersion', 'denominatorVersion', 'outcomeVersion', 'fixedContinuationVersion'])
    for (const field of ['planId', 'denominatorVersion', 'outcomeVersion', 'fixedContinuationVersion']) token(plan[field])
    digest(plan.digest)
    if (plan.version !== 'adaptive-routing-analysis.v1' || plan.assignmentUnit !== 'authenticated_learner' || plan.eligibilityVersion !== 'learn-adaptive.experiment-eligibility.v1' || plan.exclusionVersion !== 'learn-adaptive.experiment-exclusion.v1') reject()
  }
  fixture.plans = unique(fixture.plans, 'planId')
  // One frozen analysis population per bounded report prevents pooled plans.
  if (fixture.plans.length > 1) reject()
  for (const row of fixture.assignments) {
    keys(row, ['assignmentId', 'planId', 'planDigest', 'learnerId', 'cohort', 'arm', 'assignedAt', 'eligible', 'exclusionCode', 'assignmentVersion'])
    for (const field of ['assignmentId', 'planId', 'learnerId', 'cohort']) token(row[field])
    integer(row.assignedAt); digest(row.planDigest)
    if (row.assignedAt > fixture.windowEnd) reject()
    if (!['adaptive', 'fixed'].includes(row.arm) || typeof row.eligible !== 'boolean' || row.assignmentVersion !== 'learn-adaptive.experiment-assignment.v1' || (row.eligible ? row.exclusionCode !== null : !['flag_ineligible', 'not_authenticated'].includes(row.exclusionCode))) reject()
    const plan = fixture.plans.find(plan => plan.planId === row.planId)
    if (!plan || plan.digest !== row.planDigest) reject()
  }
  fixture.assignments = unique(fixture.assignments, 'assignmentId')
  if (new Set(fixture.assignments.map(row => row.learnerId)).size !== fixture.assignments.length) reject()
  if (new Set(fixture.assignments.map(row => row.cohort)).size > 1) reject()
  for (const row of fixture.experimentOutcomes) {
    keys(row, ['assignmentId', 'attemptId', 'outcomeVersion', 'occurredAt', 'performancePassed', 'completed', 'usefulnessRating'])
    token(row.assignmentId); token(row.attemptId); inWindow(row.occurredAt)
    if ([row.performancePassed, row.completed].some(value => value !== null && typeof value !== 'boolean')) reject()
    if (row.usefulnessRating !== null) { integer(row.usefulnessRating); if (row.usefulnessRating < 1 || row.usefulnessRating > 5) reject() }
    const assignment = fixture.assignments.find(assignment => assignment.assignmentId === row.assignmentId)
    const attempt = fixture.attempts.find(attempt => attempt.attemptId === row.attemptId)
    const capability = attempt && capabilities.get(attempt.capabilityId)
    if (!assignment || !attempt || capability.learnerId !== assignment.learnerId || attempt.occurredAt !== row.occurredAt || row.occurredAt < assignment.assignedAt || row.outcomeVersion !== fixture.plans[0]?.outcomeVersion) reject()
    if (row.performancePassed !== null && row.performancePassed !== (!attempt.assisted && attempt.scorePercent >= LEARN_V2_MASTERY_THRESHOLD)) reject()
  }
  fixture.experimentOutcomes = unique(fixture.experimentOutcomes, 'attemptId')
  const origins = new Map(); const provenance = new Map(); const canonicalOrigins = new Map(); const lineage = new Map(); const attemptLineage = new Map()
  for (const row of fixture.contributions) {
    keys(row, ['contributionId', 'contributionRevision', 'authoritativeAttemptId', 'lineageId', 'producerProofVersion', 'producerVerified', 'originVisible', 'silentMastery', 'nextActionImproved', 'origins'])
    for (const field of ['contributionId', 'authoritativeAttemptId', 'lineageId']) token(row[field])
    integer(row.contributionRevision)
    if (row.contributionRevision < 1 || row.producerProofVersion !== 'synthetic_producer_proof.v1' || row.producerVerified !== true || row.originVisible !== true || row.silentMastery !== false || !row.origins.length || (row.nextActionImproved !== null && typeof row.nextActionImproved !== 'boolean')) reject()
    if (!fixture.attempts.some(attempt => attempt.attemptId === row.authoritativeAttemptId)) reject()
    const outcomePin = canonical({ attempt: row.authoritativeAttemptId, improved: row.nextActionImproved })
    if (lineage.has(row.lineageId) && lineage.get(row.lineageId) !== outcomePin) reject()
    if (attemptLineage.has(row.authoritativeAttemptId) && attemptLineage.get(row.authoritativeAttemptId) !== row.lineageId) reject()
    lineage.set(row.lineageId, outcomePin); attemptLineage.set(row.authoritativeAttemptId, row.lineageId)
    for (const origin of row.origins) {
      keys(origin, ['originId', 'sourceFeature', 'sourceIdentity', 'sourceRevision', 'provenanceKey'])
      for (const field of ['originId', 'sourceIdentity', 'sourceRevision', 'provenanceKey']) token(origin[field])
      if (!originTypes.includes(origin.sourceFeature)) reject()
      const originPin = canonical({ ...origin, attempt: row.authoritativeAttemptId, lineage: row.lineageId })
      const sourceKey = canonical([origin.sourceFeature, origin.sourceIdentity, origin.sourceRevision, row.authoritativeAttemptId])
      if (canonicalOrigins.has(sourceKey) && canonicalOrigins.get(sourceKey) !== originPin) reject()
      if ((origins.has(origin.originId) && origins.get(origin.originId) !== originPin) || (provenance.has(origin.provenanceKey) && provenance.get(origin.provenanceKey) !== originPin)) reject()
      origins.set(origin.originId, originPin); provenance.set(origin.provenanceKey, originPin); canonicalOrigins.set(sourceKey, originPin)
    }
    row.origins = unique(row.origins, 'originId')
  }
  fixture.contributions = unique(fixture.contributions, 'contributionId')
  if (fixture.coverage.accessibility) {
    const protocol = fixture.accessibilityProtocol
    keys(protocol, ['version', 'testedSha', 'taskVersion', 'baselineVersion', 'treatmentVersion', 'verifierSourceVersion', 'evidenceDigest'])
    if (protocol.version !== 'accessibility_protocol.v1' || !/^[a-f0-9]{40}$/.test(protocol.testedSha) || protocol.verifierSourceVersion !== 'synthetic_verifier.v1') reject()
    for (const field of ['taskVersion', 'baselineVersion', 'treatmentVersion']) token(protocol[field])
    digest(protocol.evidenceDigest)
    for (const row of fixture.accessibilityRuns) {
      keys(row, ['runId', 'taskId', 'arm', 'occurredAt', 'eligible', 'exclusionCode', 'completed', 'recovered', 'evidenceDigest', 'verifierSourceVersion'])
      token(row.runId); token(row.taskId); inWindow(row.occurredAt)
      if (!['fixed', 'adaptive'].includes(row.arm) || typeof row.eligible !== 'boolean' || (row.eligible ? row.exclusionCode !== null : row.exclusionCode !== 'not_applicable')) reject()
      if ([row.completed, row.recovered].some(value => value !== null && typeof value !== 'boolean')) reject()
      if (row.evidenceDigest !== null) digest(row.evidenceDigest)
      if (row.verifierSourceVersion !== null && row.verifierSourceVersion !== protocol.verifierSourceVersion) reject()
      if ((row.completed !== null || row.recovered !== null) && (row.evidenceDigest === null || row.verifierSourceVersion === null)) reject()
    }
    fixture.accessibilityRuns = unique(fixture.accessibilityRuns, 'runId')
    if (new Set(fixture.accessibilityRuns.map(row => `${row.taskId}:${row.arm}`)).size !== fixture.accessibilityRuns.length) reject()
  }
  for (const row of fixture.requests) {
    keys(row, ['requestId', 'occurredAt', 'dispatchState', 'actualCostUsdMicros', 'eligible', 'exclusionCode'])
    token(row.requestId); inWindow(row.occurredAt)
    if (!['dispatched', 'not_dispatched', 'unknown'].includes(row.dispatchState) || typeof row.eligible !== 'boolean' || (row.eligible ? row.exclusionCode !== null : row.exclusionCode !== 'ineligible')) reject()
    if (row.actualCostUsdMicros !== null) { integer(row.actualCostUsdMicros); if (row.dispatchState !== 'dispatched') reject() }
  }
  fixture.requests = unique(fixture.requests, 'requestId')
  for (const row of fixture.supportDenominators) {
    keys(row, ['denominatorId', 'cohort', 'eligibleLearnerCount'])
    token(row.denominatorId); token(row.cohort); integer(row.eligibleLearnerCount)
  }
  fixture.supportDenominators = unique(fixture.supportDenominators, 'denominatorId')
  if (new Set(fixture.supportDenominators.map(row => row.cohort)).size !== fixture.supportDenominators.length) reject()
  for (const row of fixture.supportContacts) {
    keys(row, ['contactId', 'cohort', 'occurredAt', 'category', 'eligible', 'exclusionCode'])
    token(row.contactId); token(row.cohort); inWindow(row.occurredAt)
    if (!supportCategories.includes(row.category) || typeof row.eligible !== 'boolean' || (row.eligible ? row.exclusionCode !== null : row.exclusionCode !== 'ineligible')) reject()
    if (fixture.coverage.supportDenominators && !fixture.supportDenominators.some(denominator => denominator.cohort === row.cohort && (!row.eligible || denominator.eligibleLearnerCount > 0))) reject()
  }
  fixture.supportContacts = unique(fixture.supportContacts, 'contactId')
}
const retention = fixture => {
  const exclusions = { not_due: 0, early: 0, assisted: 0 }
  let due = 0; let checked = 0; let passed = 0
  for (const capability of fixture.capabilities) {
    const dueDate = addCalendarDays(localDateAt(capability.firstIndependentAt, capability.timeZone), 7)
    if (localDateAt(fixture.windowEnd, capability.timeZone) < dueDate) { exclusions.not_due++; continue }
    due++
    const checks = fixture.attempts.filter(row => row.capabilityId === capability.capabilityId && row.kind === 'retained_transfer').filter(row => {
      if (row.assisted) { exclusions.assisted++; return false }
      if (localDateAt(row.occurredAt, capability.timeZone) < dueDate) { exclusions.early++; return false }
      return true
    })
    if (checks.length) checked++
    checks.sort((a, b) => a.occurredAt - b.occurredAt || a.attemptId.localeCompare(b.attemptId))
    if (checks[0]?.scorePercent >= LEARN_V2_MASTERY_THRESHOLD) passed++
  }
  const known = fixture.coverage.capabilities && fixture.coverage.attempts
  return { ...ratio(passed, due, known, due - checked), denominator: fixture.coverage.capabilities ? due : null, observedChecks: ratio(passed, checked, known), checkCoverage: { ...ratio(checked, due, known), denominator: fixture.coverage.capabilities ? due : null }, exclusions: known ? { ...exclusions, missing_check: due - checked } : null }
}
const experiment = fixture => {
  const known = fixture.coverage.experiment && fixture.coverage.attempts && fixture.coverage.capabilities
  return { ...Object.fromEntries(['fixed', 'adaptive'].map(arm => {
    const assignments = fixture.assignments.filter(row => row.arm === arm && row.eligible)
    const selected = assignments.map(assignment => fixture.experimentOutcomes.filter(row => row.assignmentId === assignment.assignmentId).sort((a, b) => a.occurredAt - b.occurredAt || a.attemptId.localeCompare(b.attemptId))[0])
    const metric = (field, pass) => {
      const observed = selected.filter(row => row && row[field] !== null)
      return ratio(observed.filter(row => pass(row[field])).length, assignments.length, known, assignments.length - observed.length)
    }
    return [arm, { assignments: known ? assignments.length : null, outcomeAttempts: known ? fixture.experimentOutcomes.filter(row => assignments.some(assignment => assignment.assignmentId === row.assignmentId)).length : null, performance: metric('performancePassed', value => value === true), completion: metric('completed', value => value === true), usefulness: metric('usefulnessRating', value => value >= 4) }]
  })), cohort: fixture.assignments[0]?.cohort ?? null, exclusions: known ? { flag_ineligible: fixture.assignments.filter(row => row.exclusionCode === 'flag_ineligible').length, not_authenticated: fixture.assignments.filter(row => row.exclusionCode === 'not_authenticated').length } : null, analysisPlan: fixture.plans[0] ? { version: fixture.plans[0].version, digest: fixture.plans[0].digest, assignmentUnit: fixture.plans[0].assignmentUnit, eligibilityVersion: fixture.plans[0].eligibilityVersion, exclusionVersion: fixture.plans[0].exclusionVersion, denominatorVersion: fixture.plans[0].denominatorVersion, outcomeVersion: fixture.plans[0].outcomeVersion, fixedContinuationVersion: fixture.plans[0].fixedContinuationVersion } : null, decisions: 'pending' }
}
const crossFeature = fixture => {
  const known = fixture.coverage.crossFeature && fixture.coverage.attempts && fixture.coverage.capabilities
  const attempts = unique(fixture.contributions.map(row => ({ attemptId: row.authoritativeAttemptId, improved: row.nextActionImproved })), 'attemptId')
  const origins = unique(fixture.contributions.flatMap(row => row.origins), 'originId')
  return { improvement: ratio(attempts.filter(row => row.improved === true).length, attempts.length, known, attempts.filter(row => row.improved === null).length), authoritativeAttempts: known ? attempts.length : null, distinctOrigins: known ? origins.length : null, duplicateAttemptProjections: known ? fixture.contributions.length - attempts.length : null, originCounts: known ? Object.fromEntries(originTypes.map(type => [type, origins.filter(row => row.sourceFeature === type).length])) : null, silentMasteryIncrements: known ? 0 : null, hiddenOrigins: known ? 0 : null, corpusEvidence: 'synthetic_only', approval: 'pending' }
}
const accessibility = fixture => ({
  ...Object.fromEntries(['fixed', 'adaptive'].map(arm => {
    const rows = fixture.accessibilityRuns.filter(row => row.arm === arm && row.eligible)
    const metric = field => ratio(rows.filter(row => row[field] === true).length, rows.length, fixture.coverage.accessibility, rows.filter(row => row[field] === null).length)
    return [arm, { completion: metric('completed'), recovery: metric('recovered') }]
  })), protocol: fixture.accessibilityProtocol, exclusions: fixture.coverage.accessibility ? { not_applicable: fixture.accessibilityRuns.filter(row => !row.eligible).length } : null,
  physicalAssistiveTechnologyEvidence: 'unknown', deployedEvidence: 'unknown', approval: 'pending',
})
const cost = fixture => {
  const eligible = fixture.requests.filter(row => row.eligible)
  const dispatched = eligible.filter(row => row.dispatchState === 'dispatched')
  const samples = dispatched.filter(row => row.actualCostUsdMicros !== null)
  const sum = samples.reduce((sum, row) => sum + row.actualCostUsdMicros, 0)
  integer(sum)
  const unknownDispatchCount = eligible.filter(row => row.dispatchState === 'unknown').length
  const missingCount = dispatched.length - samples.length
  const known = fixture.coverage.requests
  const complete = known && !unknownDispatchCount && !missingCount
  return { status: !complete ? 'unknown' : dispatched.length ? 'known' : 'no_denominator', eligibleRequestCount: known ? eligible.length : null, dispatchedCount: known ? dispatched.length : null, sampleCount: known ? samples.length : null, missingCount: known ? missingCount : null, unknownDispatchCount: known ? unknownDispatchCount : null, totalUsdMicros: complete ? sum : null, costPerRequestUsdMicros: complete && dispatched.length ? sum / dispatched.length : null, observedTotalUsdMicros: known ? sum : null, observedCostPerRecordedRequestUsdMicros: known && samples.length ? sum / samples.length : null, exclusions: known ? { not_dispatched: eligible.filter(row => row.dispatchState === 'not_dispatched').length, ineligible: fixture.requests.length - eligible.length } : null }
}
const support = fixture => {
  const cohorts = [...new Set([...fixture.supportDenominators, ...fixture.supportContacts].map(row => row.cohort))].sort()
  const known = fixture.coverage.supportContacts && fixture.coverage.supportDenominators
  return { status: !known ? 'unknown' : cohorts.length ? 'known' : 'no_denominator', cohorts: Object.fromEntries(cohorts.map(cohort => {
    const contacts = fixture.supportContacts.filter(row => row.cohort === cohort)
    const eligible = contacts.filter(row => row.eligible)
    const denominator = fixture.supportDenominators.find(row => row.cohort === cohort)?.eligibleLearnerCount ?? 0
    return [cohort, { contacts: ratio(eligible.length, denominator, known), categoryCounts: fixture.coverage.supportContacts ? Object.fromEntries(supportCategories.map(category => [category, eligible.filter(row => row.category === category).length])) : null, excluded: fixture.coverage.supportContacts ? contacts.length - eligible.length : null }]
  })) }
}

try {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--fixture')) reject()
  const handle = await open(args[1] ?? new URL('../docs/operations/adaptive-learn-metric-fixtures/outcomes.v1.json', import.meta.url), 'r')
  let bytes
  try {
    if (!(await handle.stat()).isFile()) reject()
    const buffer = Buffer.alloc(OUTCOME_FIXTURE_LIMITS.bytes + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > OUTCOME_FIXTURE_LIMITS.bytes) reject()
    bytes = buffer.subarray(0, length)
  }
  finally { await handle.close() }
  const fixture = JSON.parse(bytes.toString('utf8'))
  validate(fixture)
  console.log(JSON.stringify({ synthetic: true, activationReady: false, registryVersion: OUTCOME_REGISTRY_VERSION, queryVersion: OUTCOME_QUERY_VERSION, fixture: { identity: fixture.fixtureId, version: fixture.version, windowStart: fixture.windowStart, windowEnd: fixture.windowEnd, contentDigest: createHash('sha256').update(bytes).digest('hex') }, sourceVersions: OUTCOME_SOURCE_VERSIONS, sourceCoverage: fixture.coverage, definitions: OUTCOME_METRIC_DEFINITIONS, metrics: { retention: retention(fixture), experiment: experiment(fixture), crossFeature: crossFeature(fixture), accessibility: accessibility(fixture), cost: cost(fixture), support: support(fixture) }, liveTelemetryAdapter: 'pending' }))
}
catch {
  console.error('Adaptive Learn outcome fixture rejected')
  process.exitCode = 1
}
