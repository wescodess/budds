import { open } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const eligibleTypes = ['quiz_result', 'chat_discussion_projection']
const contributionFeatures = { quiz_result: 'quiz', chat_discussion_projection: 'chat', chat_reference: 'chat', flashcards_reference: 'flashcards', audio_overview_reference: 'podcast', document_reference: 'documents' }
const reject = () => { throw new Error('invalid') }
const keys = (value, allowed) => {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).length !== allowed.length || Object.keys(value).some(key => !allowed.includes(key))) reject()
}
const id = value => { if (typeof value !== 'string' || !/^fixture-[a-z0-9-]{1,48}$/.test(value)) reject() }
const integer = value => { if (!Number.isSafeInteger(value) || value < 0 || value > 1000000) reject() }
const boolean = value => { if (typeof value !== 'boolean') reject() }
const optional = (value, check) => { if (value !== null) check(value) }
const distinct = values => { if (new Set(values).size !== values.length) reject() }
const validate = fixture => {
  keys(fixture, ['version', 'synthetic', 'minimumPracticalEffect', 'declarations', 'cases'])
  if (fixture.version !== 'cross-feature-provenance-fixture.v1' || fixture.synthetic !== true) reject()
  optional(fixture.minimumPracticalEffect, value => { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) reject() })
  keys(fixture.declarations, ['owner', 'approver', 'verifier', 'approved'])
  for (const field of ['owner', 'approver', 'verifier']) optional(fixture.declarations[field], id)
  boolean(fixture.declarations.approved)
  if (!Array.isArray(fixture.cases) || fixture.cases.length > 100) reject()
  let rows = fixture.cases.length
  const contributions = new Set(); const attempts = new Map(); const origins = new Map()
  const claim = (registry, key, value) => {
    if (registry.has(key) && registry.get(key) !== value) reject()
    registry.set(key, value)
  }
  distinct(fixture.cases.map(row => row.caseId)); distinct(fixture.cases.map(row => row.activityId))
  for (const row of fixture.cases) {
    keys(row, ['caseId', 'activityId', 'arm', 'eligible', 'contributions', 'before', 'after', 'nextAction'])
    id(row.caseId); id(row.activityId); boolean(row.eligible)
    if (!['baseline', 'treatment'].includes(row.arm) || !Array.isArray(row.contributions)) reject()
    rows += row.contributions.length
    const contributionOrigins = new Map()
    for (const snapshot of [row.before, row.after]) {
      keys(snapshot, ['attempts', 'masteryIncrements', 'origins'])
      optional(snapshot.masteryIncrements, integer)
      optional(snapshot.attempts, values => {
        if (!Array.isArray(values)) reject()
        rows += values.length; distinct(values)
        for (const value of values) { id(value); claim(attempts, value, row.activityId) }
      })
      optional(snapshot.origins, values => {
        if (!Array.isArray(values)) reject()
        rows += values.length; distinct(values.map(origin => origin.originId))
        for (const origin of values) {
          keys(origin, ['originId', 'sourceFeature', 'visible']); id(origin.originId); boolean(origin.visible)
          if (!Object.values(contributionFeatures).includes(origin.sourceFeature)) reject()
          // A changed feature in the after snapshot is measured as an origin violation.
          claim(origins, origin.originId, row.activityId)
        }
      })
    }
    for (const contribution of row.contributions) {
      keys(contribution, ['contributionId', 'type', 'activityId', 'attemptId', 'originId', 'sourceFeature'])
      for (const field of ['contributionId', 'activityId', 'attemptId', 'originId']) id(contribution[field])
      if (contributions.has(contribution.contributionId)) reject()
      contributions.add(contribution.contributionId)
      if (contributionFeatures[contribution.type] !== contribution.sourceFeature || contribution.activityId !== row.activityId) reject()
      claim(attempts, contribution.attemptId, row.activityId); claim(origins, contribution.originId, row.activityId)
      claim(contributionOrigins, contribution.originId, contribution.sourceFeature)
      if (eligibleTypes.includes(contribution.type) && row.before.attempts !== null && !row.before.attempts.includes(contribution.attemptId)) reject()
      const existing = row.before.origins?.find(origin => origin.originId === contribution.originId)
      if (existing && existing.sourceFeature !== contribution.sourceFeature) reject()
    }
    if (new Set(row.contributions.filter(contribution => eligibleTypes.includes(contribution.type)).map(contribution => contribution.attemptId)).size > 1) reject()
    keys(row.nextAction, ['representativeTaskPassed', 'usefulnessRating', 'completed', 'clickCount'])
    optional(row.nextAction.representativeTaskPassed, boolean); optional(row.nextAction.completed, boolean); optional(row.nextAction.clickCount, integer)
    optional(row.nextAction.usefulnessRating, value => { integer(value); if (value < 1 || value > 5) reject() })
    if (rows > 500) reject()
  }
}
const normalize = value => Array.isArray(value)
  ? value.map(normalize).sort((a, b) => {
      const left = JSON.stringify(a); const right = JSON.stringify(b)
      return left < right ? -1 : left > right ? 1 : 0
    })
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]))
    : value
const canonical = value => JSON.stringify(normalize(value))
const digest = value => createHash('sha256').update(canonical(value)).digest('hex')
const metric = cases => {
  const missingCount = cases.filter(row => row.nextAction.representativeTaskPassed === null || row.nextAction.usefulnessRating === null).length
  const numerator = cases.filter(row => row.nextAction.representativeTaskPassed === true && row.nextAction.usefulnessRating >= 4).length
  return { status: missingCount ? 'unknown' : cases.length ? 'known' : 'no_denominator', numerator, denominator: cases.length, missingCount, rate: cases.length && !missingCount ? numerator / cases.length : null }
}
const assertion = (violations, missingCount, denominator) => ({ status: violations ? 'fail' : missingCount ? 'unknown' : denominator ? 'pass' : 'no_denominator', violations: missingCount ? null : violations, observedViolations: violations, missingCount, denominator })
const generate = fixture => {
  const contract = {
    version: 'cross-feature-provenance-contract.v1', eligibleContributionTypes: eligibleTypes,
    eligibility: 'learner-authorized immutable Quiz result or accepted-attempt Chat discussion projection; fixture activity and attempt keys must agree; shared source or client aliases never merge distinct activities',
    nextActionMetric: {
      version: 'cross-feature-next-action-quality.v1',
      definition: 'representative next-action task passed AND usefulness rating at least 4 of 5; clicks and completion are ancillary only',
      numerator: 'eligible assigned cases with both outcomes recorded and passing',
      denominator: 'all eligible assigned activity cases per baseline/treatment arm, including missing next-action outcomes',
      comparison: 'treatment rate minus baseline rate; null if either arm is incomplete or empty',
    },
    minimumPracticalEffect: fixture.minimumPracticalEffect,
    duplicateAttemptTest: 'reuse creates zero accepted attempt IDs and removes zero original accepted attempt IDs across before/after activity snapshots',
    silentMasteryAssertion: 'reuse leaves the cumulative authoritative mastery increment count unchanged',
    originVisibilityAssertion: 'every original and contributed source origin remains present with unchanged feature and visible=true after reuse',
    owner: fixture.declarations.owner, approver: fixture.declarations.approver, verifier: fixture.declarations.verifier,
    roleAuthority: 'untrusted opaque fixture labels only; names or approved booleans do not establish independent approval',
  }
  const cases = fixture.cases.filter(row => row.eligible && row.contributions.some(contribution => eligibleTypes.includes(contribution.type)))
  const baseline = metric(cases.filter(row => row.arm === 'baseline'))
  const treatment = metric(cases.filter(row => row.arm === 'treatment'))
  const difference = baseline.rate === null || treatment.rate === null ? null : treatment.rate - baseline.rate
  let duplicateAttempts = 0; let attemptMissing = 0; let silentMastery = 0; let masteryMissing = 0; let hiddenOrigins = 0; let originMissing = 0
  for (const row of cases) {
    if (row.before.attempts === null || row.after.attempts === null) attemptMissing++
    else {
      const before = new Set(row.before.attempts); const after = new Set(row.after.attempts)
      duplicateAttempts += [...after].filter(id => !before.has(id)).length + [...before].filter(id => !after.has(id)).length
    }
    if (row.before.masteryIncrements === null || row.after.masteryIncrements === null) masteryMissing++
    else if (row.before.masteryIncrements !== row.after.masteryIncrements) silentMastery++
    if (row.before.origins === null || row.after.origins === null) originMissing++
    else {
      const expected = new Map(row.before.origins.map(origin => [origin.originId, origin.sourceFeature]))
      for (const contribution of row.contributions) expected.set(contribution.originId, contribution.sourceFeature)
      for (const origin of row.after.origins) if (!expected.has(origin.originId)) expected.set(origin.originId, origin.sourceFeature)
      for (const [id, feature] of expected) {
        const after = row.after.origins.find(origin => origin.originId === id)
        if (!after || after.sourceFeature !== feature || !after.visible) hiddenOrigins++
      }
    }
  }
  return {
    version: 'cross-feature-provenance-analysis.v1', synthetic: true, trustedServerLineage: false,
    approval: 'unapproved', exposureAllowed: false,
    blockers: ['synthetic_fixture_only', 'product_analytics_inputs_missing', 'independent_approval_missing', ...(fixture.minimumPracticalEffect === null ? ['minimum_practical_effect_missing'] : [])],
    contract, contractDigest: digest(contract),
    corpus: { version: fixture.version, inputDigest: digest(fixture), caseCount: fixture.cases.length, eligibleCaseCount: cases.length, contributionCount: fixture.cases.reduce((count, row) => count + row.contributions.length, 0), excludedCaseCount: fixture.cases.length - cases.length },
    metrics: { baseline, treatment, difference },
    practicalEffect: { status: fixture.minimumPracticalEffect === null || difference === null ? 'unknown' : 'known', threshold: fixture.minimumPracticalEffect, meetsThreshold: fixture.minimumPracticalEffect === null || difference === null ? null : difference >= fixture.minimumPracticalEffect },
    assertions: { duplicateAttempt: assertion(duplicateAttempts, attemptMissing, cases.length), silentMastery: assertion(silentMastery, masteryMissing, cases.length), originVisibility: assertion(hiddenOrigins, originMissing, cases.length) },
  }
}

try {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--fixture')) throw new Error('invalid')
  const handle = await open(args[1] ?? new URL('../docs/experiments/cross-feature-provenance-fixture.v1.json', import.meta.url), 'r')
  let bytes
  try {
    if (!(await handle.stat()).isFile()) throw new Error('invalid')
    const buffer = Buffer.alloc(65537)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > 65536) throw new Error('invalid')
    bytes = buffer.subarray(0, length)
  }
  finally { await handle.close() }
  const fixture = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  validate(fixture)
  process.stdout.write(`${canonical(generate(fixture))}\n`)
}
catch {
  process.stderr.write('Cross-feature provenance fixture rejected\n')
  process.exitCode = 1
}
