import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const fixture = () => JSON.parse(readFileSync('docs/experiments/cross-feature-provenance-fixture.v1.json', 'utf8'))
const run = (input?: ReturnType<typeof fixture>) => {
  const directory = mkdtempSync(join(tmpdir(), 'cross-feature-analysis-'))
  try {
    const args = ['scripts/cross-feature-provenance-analysis.mjs']
    if (input) {
      const path = join(directory, 'fixture.json')
      writeFileSync(path, JSON.stringify(input))
      args.push('--fixture', path)
    }
    return spawnSync(process.execPath, args, { encoding: 'utf8' })
  }
  finally { rmSync(directory, { recursive: true }) }
}
const report = (input?: ReturnType<typeof fixture>) => {
  const result = run(input)
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' })
  return JSON.parse(result.stdout)
}

test('operator generates a reproducible contract without approving exposure from synthetic evidence', () => {
  const result = report()
  expect(result).toMatchObject({
    version: 'cross-feature-provenance-analysis.v1', approval: 'unapproved', exposureAllowed: false,
    synthetic: true, trustedServerLineage: false,
    contract: { eligibleContributionTypes: ['chat_discussion_projection', 'quiz_result'], minimumPracticalEffect: null, owner: null, approver: null, verifier: null },
    corpus: { caseCount: 2, contributionCount: 3 },
    metrics: { baseline: { status: 'known', numerator: 0, denominator: 1, rate: 0 }, treatment: { status: 'known', numerator: 1, denominator: 1, rate: 1 }, difference: 1 },
    assertions: { duplicateAttempt: { status: 'pass', violations: 0 }, silentMastery: { status: 'pass', violations: 0 }, originVisibility: { status: 'pass', violations: 0 } },
  })
  expect(result.corpus.inputDigest).toMatch(/^[a-f0-9]{64}$/)
  expect(result.contractDigest).toMatch(/^[a-f0-9]{64}$/)
  expect(run().stdout).toBe(run().stdout)
})

test('operator rejects raw answer fields without echoing private input', () => {
  const input = fixture()
  input.cases[0].rawAnswer = 'private learner answer'
  const result = run(input)
  expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({ status: 1, stdout: '', stderr: 'Cross-feature provenance fixture rejected\n' })
})

test('operator rejects contribution type arrays rather than coercing them into eligible enum keys', () => {
  const input = fixture()
  input.cases[0].contributions[0].type = ['quiz_result']
  const result = run(input)
  expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({ status: 1, stdout: '', stderr: 'Cross-feature provenance fixture rejected\n' })
})

test('operator retains the assigned denominator when outcomes or the practical effect threshold are missing', () => {
  const input = fixture()
  input.cases[1].nextAction.usefulnessRating = null
  expect(report(input)).toMatchObject({
    metrics: { treatment: { status: 'unknown', numerator: 0, denominator: 1, missingCount: 1, rate: null }, difference: null },
    practicalEffect: { status: 'unknown', threshold: null, meetsThreshold: null },
  })
})

test('operator rejects conflicting contribution origin features rather than hiding their provenance', () => {
  const input = fixture()
  input.cases[1].contributions[1].originId = 'fixture-origin-new'
  input.cases[1].contributions.push({ ...input.cases[1].contributions[0], contributionId: 'fixture-conflicting-origin', originId: 'fixture-origin-new' })
  expect(run(input).status).toBe(1)
})

test('operator rejects projections of different attempts even when their fixture activity labels match', () => {
  const input = fixture()
  input.cases[1].before.attempts.push('fixture-unrelated-attempt')
  input.cases[1].after.attempts.push('fixture-unrelated-attempt')
  input.cases[1].contributions[1].attemptId = 'fixture-unrelated-attempt'
  expect(run(input).status).toBe(1)
})

test('operator measures hidden additional origins instead of reporting constant zero violations', () => {
  const input = fixture()
  input.cases[1].after.origins.push({ originId: 'fixture-hidden-origin', sourceFeature: 'documents', visible: false })
  expect(report(input).assertions.originVisibility).toMatchObject({ status: 'fail', violations: 1 })
})

test('operator measures newly accepted attempts, lost originals, silent mastery and changed source origins', () => {
  const input = fixture()
  input.cases[1].after.attempts = ['fixture-new-attempt']
  input.cases[1].after.masteryIncrements = 2
  input.cases[1].after.origins[0].sourceFeature = 'documents'
  input.cases[1].after.origins[1].visible = false
  expect(report(input)).toMatchObject({ approval: 'unapproved', exposureAllowed: false, assertions: {
    duplicateAttempt: { status: 'fail', violations: 2 }, silentMastery: { status: 'fail', violations: 1 }, originVisibility: { status: 'fail', violations: 2 },
  } })
})

test('operator separates unavailable observations from a measured zero and an empty denominator', () => {
  const input = fixture()
  input.cases[1].before = { attempts: null, masteryIncrements: null, origins: null }
  expect(report(input).assertions).toMatchObject({
    duplicateAttempt: { status: 'unknown', violations: null, observedViolations: 0, missingCount: 1, denominator: 2 },
    silentMastery: { status: 'unknown', violations: null, missingCount: 1 }, originVisibility: { status: 'unknown', violations: null, missingCount: 1 },
  })
  input.cases = []
  expect(report(input)).toMatchObject({ metrics: { baseline: { status: 'no_denominator', denominator: 0, rate: null }, treatment: { status: 'no_denominator', denominator: 0, rate: null }, difference: null }, assertions: { duplicateAttempt: { status: 'no_denominator', denominator: 0 } } })
})

test('operator cannot substitute clicks or completion for representative next-action quality', () => {
  const input = fixture()
  input.cases[1].nextAction = { representativeTaskPassed: null, usefulnessRating: null, completed: true, clickCount: 100 }
  expect(report(input).metrics.treatment).toMatchObject({ status: 'unknown', numerator: 0, denominator: 1, rate: null })
})

test('operator freezes role labels and practical effect without trusting an approval declaration', () => {
  const input = fixture()
  input.minimumPracticalEffect = 0.2
  input.declarations = { owner: 'fixture-owner', approver: 'fixture-approver', verifier: 'fixture-verifier', approved: true }
  const result = report(input)
  expect(result).toMatchObject({ approval: 'unapproved', exposureAllowed: false, trustedServerLineage: false, contract: { owner: 'fixture-owner', approver: 'fixture-approver', verifier: 'fixture-verifier', minimumPracticalEffect: 0.2 }, practicalEffect: { status: 'known', threshold: 0.2, meetsThreshold: true } })
  expect(result.contractDigest).not.toBe(report().contractDigest)
})

test('operator reproduces identical bytes after input property and event ordering changes', () => {
  const input = fixture()
  input.cases.reverse()
  for (const row of input.cases) {
    row.contributions.reverse(); row.before.attempts.reverse(); row.after.attempts.reverse()
    row.before.origins.reverse(); row.after.origins.reverse()
    row.nextAction = Object.fromEntries(Object.entries(row.nextAction).reverse())
  }
  expect(run(input).stdout).toBe(run().stdout)
})

test('operator retains separate activities sharing content features and excludes unrelated contribution types', () => {
  const input = fixture()
  const additional = structuredClone(input.cases[0])
  additional.caseId = 'fixture-additional-case'; additional.activityId = 'fixture-additional-activity'
  additional.contributions = [{ contributionId: 'fixture-document', type: 'document_reference', activityId: additional.activityId, attemptId: 'fixture-additional-attempt', originId: 'fixture-additional-origin', sourceFeature: 'documents' }]
  additional.before = { attempts: ['fixture-additional-attempt'], masteryIncrements: 0, origins: [{ originId: 'fixture-additional-origin', sourceFeature: 'documents', visible: true }] }
  additional.after = structuredClone(additional.before)
  input.cases.push(additional)
  expect(report(input)).toMatchObject({ corpus: { caseCount: 3, eligibleCaseCount: 2, excludedCaseCount: 1 }, metrics: { baseline: { denominator: 1 }, treatment: { denominator: 1 } } })
})

test('operator publishes aggregates without fixture activity, attempt, contribution or origin identities', () => {
  const result = run()
  for (const privateLabel of ['fixture-baseline', 'fixture-treatment', 'fixture-activity-one', 'fixture-attempt-two', 'fixture-quiz-two', 'fixture-origin-three']) expect(result.stdout).not.toContain(privateLabel)
})

test.each([
  ['live input', (input: ReturnType<typeof fixture>) => input.synthetic = false],
  ['private identifier', (input: ReturnType<typeof fixture>) => input.cases[0].caseId = 'private-user-id'],
  ['source locator', (input: ReturnType<typeof fixture>) => input.cases[0].after.origins[0].locator = 'https://private.example'],
  ['client lineage alias', (input: ReturnType<typeof fixture>) => input.cases[0].contributions[0].lineageId = 'fixture-client-alias'],
  ['cross-activity attempt alias', (input: ReturnType<typeof fixture>) => input.cases[1].contributions[0].attemptId = input.cases[0].contributions[0].attemptId],
  ['cross-activity origin alias', (input: ReturnType<typeof fixture>) => input.cases[1].contributions[0].originId = input.cases[0].contributions[0].originId],
  ['duplicate assignment', (input: ReturnType<typeof fixture>) => input.cases.push(structuredClone(input.cases[0]))],
  ['unknown contribution type', (input: ReturnType<typeof fixture>) => input.cases[0].contributions[0].type = 'unsupported'],
  ['invalid outcome', (input: ReturnType<typeof fixture>) => input.cases[0].nextAction.usefulnessRating = 6],
  ['negative threshold', (input: ReturnType<typeof fixture>) => input.minimumPracticalEffect = -0.1],
  ['total row bound', (input: ReturnType<typeof fixture>) => input.cases[0].after.attempts = Array.from({ length: 500 }, (_, index) => `fixture-attempt-${index}`)],
])('operator rejects %s with a redacted failure', (_, change) => {
  const input = fixture(); change(input)
  const result = run(input)
  expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({ status: 1, stdout: '', stderr: 'Cross-feature provenance fixture rejected\n' })
})

test('operator rejects oversized input and invalid command arguments without echoing paths', () => {
  const input = fixture()
  input.privateText = 'x'.repeat(65536)
  expect(run(input).status).toBe(1)
  const result = spawnSync(process.execPath, ['scripts/cross-feature-provenance-analysis.mjs', '--unknown', '/private/path'], { encoding: 'utf8' })
  expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({ status: 1, stdout: '', stderr: 'Cross-feature provenance fixture rejected\n' })
})

test.runIf(process.platform !== 'win32')('operator rejects a FIFO fixture without waiting for a writer', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cross-feature-fifo-'))
  try {
    const path = join(directory, 'fixture.fifo')
    const setup = spawnSync('mkfifo', [path], { encoding: 'utf8', timeout: 1000 })
    expect({ status: setup.status, stderr: setup.stderr }).toEqual({ status: 0, stderr: '' })
    const result = spawnSync(process.execPath, ['scripts/cross-feature-provenance-analysis.mjs', '--fixture', path], { encoding: 'utf8', timeout: 3000 })
    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({ status: 1, stdout: '', stderr: 'Cross-feature provenance fixture rejected\n' })
  }
  finally { rmSync(directory, { recursive: true }) }
})
