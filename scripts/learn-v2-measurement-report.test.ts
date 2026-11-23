import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLearningMeasurementReport, fingerprintLearnReportInput, learnReportFirstClaimV2SnapshotSchema, LEARN_V2_FIRST_INDEPENDENT_CLAIM_VERSION,
  type LearnReportInputSnapshot } from '../shared/learn-v2-measurement-report'
import { computationEpisode, computationInput } from '../tests/fixtures/learn-v2-measurement-computation'
import { measurementReportNonAdmittedFixture } from '../tests/fixtures/learn-v2-measurement-report'

const script = fileURLToPath(new URL('./learn-v2-measurement-report.mjs', import.meta.url))
const fixturePath = fileURLToPath(new URL('./learn-v2-measurement-report.fixture.v1.json', import.meta.url))
const fixture = () => JSON.parse(readFileSync(fixturePath, 'utf8'))
const fixtureOutputDigest = '1cc788e6fd69b67aa8d616d67df3d6367f27fd0d9178d28dab83503ac7555a06'
const sealedOutputDigest = '26423699722bfcd5e9da0b1e0512348005190c261c14463eba857ae2be33c96c'
let directory: string
let guard: string
let sequence = 0

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'budds-measurement-replay-'))
  guard = join(directory, 'deny-network.mjs')
  // Fail even if the CLI catches the denial: the exit marker counts attempts.
  writeFileSync(guard, `
import { createRequire, registerHooks, syncBuiltinESMExports } from 'node:module'
const require = createRequire(import.meta.url)
let calls = 0
const deny = () => { calls++; throw new Error('network_or_dispatch_forbidden') }
for (const [module, methods] of Object.entries({
  'node:http': ['request','get'], 'node:https': ['request','get'], 'node:http2': ['connect'],
  'node:net': ['connect','createConnection','createServer'], 'node:tls': ['connect','createServer'],
  'node:dgram': ['createSocket'], 'node:dns': ['lookup','resolve','reverse'],
  'node:child_process': ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'],
})) for (const method of methods) require(module)[method] = deny
require('node:net').Socket.prototype.connect = deny
for (const method of ['lookup','resolve','reverse']) require('node:dns').promises[method] = deny
for (const name of ['fetch','WebSocket','EventSource']) globalThis[name] = deny
syncBuiltinESMExports()
registerHooks({ resolve(specifier, context, next) {
  if (/^(node:)?(http|https|http2|net|tls|dgram|dns)(\\/|$)/.test(specifier)
    || /^(ai|@ai-sdk\\/|openai|@anthropic-ai\\/|convex\\/(browser|server))/.test(specifier)
    || /\\/(server|convex)\\//.test(specifier)) deny()
  return next(specifier, context)
}})
process.on('exit', () => process.stderr.write('network_or_dispatch_calls=' + calls + '\\n'))
`)
})

afterAll(() => { rmSync(directory, { recursive: true, force: true }) })

function run(args: string[]) {
  const execution = spawnSync(process.execPath, ['--import', guard, script, ...args], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  expect(execution.error).toBeUndefined()
  expect(execution.signal).toBeNull()
  expect(execution.stderr).toBe('network_or_dispatch_calls=0\n')
  return { code: execution.status, output: JSON.parse(execution.stdout), serialized: execution.stdout }
}

function replay(input = fixture(), mode = '--fixture') {
  const path = join(directory, `${sequence++}.json`)
  writeFileSync(path, JSON.stringify(input))
  return run([mode, path])
}

async function reseal(input: ReturnType<typeof fixture>) {
  Object.assign(input.report.provenance, await fingerprintLearnReportInput(input.roster, input.rows))
  return input
}

function primary(output: ReturnType<typeof fixture>, metric = 'verified_learning_gain.v1', horizon: number | null = 7) {
  return output.cells.find((cell: ReturnType<typeof fixture>) => cell.metric === metric && cell.horizonDays === horizon
    && cell.weighting === 'capability_episode' && cell.stratum.startingBand === 'all')
}

async function unpublished(input: ReturnType<typeof fixture>) {
  const { report, roster, rows } = input
  const computed = await buildLearningMeasurementReport({ reportRunId: report.reportRunId, query: report.query, provenance: report.provenance, roster, rows })
  return { cells: computed.pages.flatMap(page => page.cells) }
}

function expectEmpty(output: ReturnType<typeof fixture>) {
  expect(output).toMatchObject({ status: 'unavailable', reasonCodes: ['no_eligible_population'], manifest: null, cells: [] })
}

async function computed(sources: Awaited<ReturnType<typeof computationEpisode>>[]) {
  const prepared = await computationInput(sources.flatMap(source => [source.watermark, source.episode]))
  const input = fixture()
  input.rows = prepared.rows
  input.roster = prepared.roster
  Object.assign(input.report.provenance, prepared.provenance, { codeVersion: fixture().report.provenance.codeVersion })
  return input
}

describe('Node 24 offline measurement report CLI', () => {
  it('replays v2 late-linked and unresolved claims once while releasing nothing about two learners', async () => {
    const input = fixture()
    input.rows = input.rows.map((row: LearnReportInputSnapshot) => {
      if (row.kind !== 'first_check_claim') return row
      const { kind: _kind, learnerKey, capabilityKey, claim, stratum, ...slot } = row
      const { epoch, baselineSha, cohortVersion, flow, entryPoint, depth } = stratum
      return learnReportFirstClaimV2SnapshotSchema.parse({ kind: 'first_check_claim_v2', version: LEARN_V2_FIRST_INDEPENDENT_CLAIM_VERSION,
        learnerKey, capabilityKey, claim, stratum: { epoch, baselineSha, cohortVersion, flow, entryPoint, depth },
        policyPins: { assistancePolicyVersion: 'assistance.v1', validityPolicyVersion: 'validity.v1', thresholdVersion: 'threshold.v1', thresholdPercent: 80 },
        firstSlot: slot.result ? { ...slot, kind: 'linked', checkSequence: 1, linkedAt: slot.clock.closeAt + 1000, stratum }
          : { kind: 'unresolved', reason: 'no_qualifying_delayed_slot' } })
    })
    const sealed = await reseal(input)
    const { code, output } = replay(sealed, '--sealed-input')
    expect(code).toBe(2)
    expectEmpty(output)
    const cells = (await unpublished(sealed)).cells.filter(cell =>
      cell.metric === 'false_mastery_next_delayed.v1' && cell.stratum.startingBand === 'all' && cell.weighting === 'capability_episode')
    expect(cells.reduce((sum, cell) => sum + cell.counts.maturedClaims, 0)).toBe(2)
    expect(cells.reduce((sum, cell) => sum + cell.counts.checkedClaims, 0)).toBe(1)
    expect(cells.find(cell => cell.horizonDays === null)!.reasonCodes).toContain('no_qualifying_delayed_slot')
  })

  it('replays fixture diagnostics to the exact full serialized output and independent arithmetic oracle', async () => {
    const { code, output, serialized } = run(['--fixture', fixturePath])
    expect(code).toBe(2)
    expect(createHash('sha256').update(serialized).digest('hex')).toBe(fixtureOutputDigest)
    expect(output).toMatchObject({ inputClass: 'fixture_diagnostic',
      readiness: { sourceAdmission: 'pending', viewerGrant: 'unverified_offline', realObservations: 'unverified_offline', baselineCapture: 'unproven' } })
    expectEmpty(output)
    const empty = fixture()
    empty.rows = []
    empty.roster = []
    expect(replay(await reseal(empty)).serialized).toBe(serialized)
    const oracle = await unpublished(fixture())
    expect(primary(oracle)).toMatchObject({ status: 'partial_observed', observedValue: -20, allEligibleValue: null,
      missingOutcomeBounds: { lower: -30, upper: 20 }, confidenceInterval: null,
      counts: { considered: 2, maturedEpisodes: 2, acceptedSubmissions: 1, validColdScores: 2, validDelayedScores: 1, comparablePairs: 1 } })
    expect(primary(oracle, 'false_mastery_next_delayed.v1')).toMatchObject({ status: 'partial_observed', observedValue: 1,
      allEligibleValue: null, missingOutcomeBounds: { lower: 0.5, upper: 1 }, counts: { maturedClaims: 2, checkedClaims: 1, failedClaims: 1 } })
    expect(primary(oracle, 'verified_learning_gain.v1', 30)).toMatchObject({ status: 'no_eligible_population', observedValue: null, allEligibleValue: null })
  })

  it('publishes replayed values only once five distinct learners contribute', async () => {
    const input = await computed(await Promise.all([1, 2, 3, 4, 5].map(index => computationEpisode(index))))
    const { code, output } = replay(input, '--sealed-input')
    expect(code).toBe(0)
    expect(output).toMatchObject({ status: 'replayed', reasonCodes: ['offline_replay_only', 'insufficient_learners'],
      manifest: { cutoffDate: '2026-11-02T00:00:00.000Z', reportVersion: 'learn-v2.measurement-report.v3',
        provenance: { sourceVersion: 'learn-v2.measurement-report-source.v4', bootstrapReplicates: 10_000, episodeCount: null, inputBytes: null } } })
    expect(output.cells).toHaveLength(20)
    expect(primary(output)).toMatchObject({ observedValue: -20, allEligibleValue: -20, missingOutcomeBounds: { lower: -20, upper: -20 },
      confidenceInterval: null, counts: { maturedEpisodes: 5, comparablePairs: 5 }, publicationPolicyVersion: 'learn-v2.report-publication.minimum-five-learners.v3' })
    expect(primary(output).reasonCodes).not.toContain('insufficient_learners')
    input.rows = input.rows.filter((row: LearnReportInputSnapshot) => row.learnerKey !== input.roster[0])
    input.roster = input.roster.slice(1)
    expectEmpty(replay(await reseal(input), '--sealed-input').output)
  })

  it('exactly replays a sealed-input envelope without promoting the file to trusted live evidence', () => {
    const { code, output, serialized } = replay(fixture(), '--sealed-input')
    expect(code).toBe(2)
    expect(createHash('sha256').update(serialized).digest('hex')).toBe(sealedOutputDigest)
    expect(output).toMatchObject({ inputClass: 'sealed_input_replay' })
    expectEmpty(output)
    expect(output.readiness.sourceAdmission).toBe('pending')
  })

  it('is deterministic across row and roster order, preserving saved cutoff/digest/seed', async () => {
    const input = fixture()
    input.rows.reverse()
    input.roster.reverse()
    expect(createHash('sha256').update(replay(input).serialized).digest('hex')).toBe(fixtureOutputDigest)
    const published = await computed(await Promise.all([1, 2, 3, 4, 5].map(index => computationEpisode(index))))
    const forward = replay(published, '--sealed-input').serialized
    published.rows.reverse()
    published.roster.reverse()
    expect(replay(published, '--sealed-input').serialized).toBe(forward)
  })

  it.each(['stale', 'building', 'disabled', 'unavailable', 'failed'])('withholds every number for a %s snapshot', (status) => {
    const input = fixture()
    input.report = { version: input.report.version, status, reasonCodes: ['private_error_canary'] }
    const { code, output, serialized } = replay(input, '--sealed-input')
    expect(code).toBe(2)
    expect(output).toMatchObject({ status: status === 'stale' ? 'stale' : 'unavailable', manifest: null, cells: [], reasonCodes: [`snapshot_${status}`] })
    expect(serialized).not.toContain('private_error_canary')
  })

  it.each(['version', 'report', 'source', 'query', 'provenanceQuery', 'code'])('rejects an incompatible %s version', (version) => {
    const input = fixture()
    if (version === 'version') input.version = 'obsolete.v0'
    if (version === 'report') input.report.version = 'learn-v2.measurement-report.v2'
    if (version === 'source') input.report.provenance.sourceVersion = 'learn-v2.measurement-report-source.v3'
    if (version === 'query') input.report.query.version = 'obsolete.v0'
    if (version === 'provenanceQuery') input.report.provenance.queryVersion = 'obsolete.v0'
    if (version === 'code') input.report.provenance.codeVersion = 'learn-v2.report-code.c6.2.v5'
    expect(replay(input).output).toMatchObject({ status: 'failed', reasonCodes: ['incompatible_version'], manifest: null, cells: [] })
  })

  it.each(['inputDigest', 'rosterDigest', 'bootstrapSeed', 'episodeCount', 'inputBytes', 'cutoff'])('does not repair a mismatched saved %s', (field) => {
    const input = fixture()
    input.report.provenance[field] = typeof input.report.provenance[field] === 'number' ? input.report.provenance[field] + 1 : `sha256:${'0'.repeat(64)}`
    expect(replay(input).output).toMatchObject({ status: 'failed', reasonCodes: ['input_manifest_mismatch'], cells: [] })
  })

  it.each(['missing', 'duplicate', 'horizon'])('reconciles %s sources before digest checking or publishing numbers', (kind) => {
    const input = fixture()
    if (kind === 'missing') input.rows = input.rows.filter((row: ReturnType<typeof fixture>) => row.kind !== 'owner_watermark')
    if (kind === 'duplicate') input.rows.push(input.rows[0])
    if (kind === 'horizon') {
      input.rows[1].assignment.assignedDay30 = true
      input.rows[1].assignment.allocationOrder = 'ABC'
    }
    const result = replay(input)
    expect(result.code).toBe(1)
    expect(result.output).toMatchObject({ status: 'incomplete', manifest: null, cells: [] })
    expect(result.output.reasonCodes).toEqual([kind === 'missing' ? 'missing_owner_watermark'
      : kind === 'duplicate' ? 'duplicate_source_row' : 'incomplete_assignment_horizons'])
  })

  it('reports a missing protocol without guessing a schedule', () => {
    const input = fixture()
    input.report.query.protocolVersion = null
    expect(replay(input).output).toMatchObject({ status: 'unavailable', reasonCodes: ['protocol_not_frozen'], cells: [] })
  })

  it('keeps unknown source coverage explicit and all-eligible values null', async () => {
    const input = await computed(await Promise.all([1, 2, 3, 4, 5].map(index => computationEpisode(index))))
    input.report.provenance.sourceCoverage = 'unknown'
    const output = replay(await reseal(input)).output
    expect(output.cells.length).toBeGreaterThan(0)
    expect(output.reasonCodes).toContain('unknown_source_coverage')
    expect(output.cells.every((cell: ReturnType<typeof fixture>) => cell.allEligibleValue === null && cell.sourceCoverage === 'unknown')).toBe(true)
  })

  it('keeps an empty input unavailable, with no zero-valued pseudo-population', async () => {
    const input = fixture()
    input.rows = []
    input.roster = []
    expect(replay(await reseal(input)).output).toMatchObject({ status: 'unavailable', reasonCodes: ['no_eligible_population'], manifest: null, cells: [] })
  })

  it('retains pending outcomes as null even when a protocol and matured slots exist', async () => {
    const input = fixture()
    for (const row of input.rows) {
      if (row.kind === 'episode') {
        row.delayed = null
        row.delayedAcceptance = null
      }
      if (row.kind === 'first_check_claim') {
        row.result = null
        row.acceptance = null
        row.stateAtAcceptance = null
        row.unresolvedReason = 'missing_delayed'
      }
    }
    expectEmpty(replay(await reseal(input)).output)
    expect(primary(await unpublished(input))).toMatchObject({ observedValue: null, allEligibleValue: null,
      counts: { maturedEpisodes: 2, comparablePairs: 0 } })
  })

  it('reports absent outcomes only when an unsuppressed population can disclose them', async () => {
    const input = await computed(await Promise.all([1, 2, 3, 4, 5].map(index => computationEpisode(index, { delayed: null }))))
    const { code, output } = replay(input, '--sealed-input')
    expect(code).toBe(0)
    expect(output.reasonCodes).toContain('no_observed_outcomes')
    expect(primary(output)).toMatchObject({ observedValue: null, counts: { maturedEpisodes: 5, comparablePairs: 0 } })
  })

  it('reports an unfrozen non-admitted inventory through the reducer', async () => {
    const source = await measurementReportNonAdmittedFixture('considered', 'protocol_not_frozen')
    const input = fixture()
    const prepared = await computationInput([source.watermark, source.episode])
    input.rows = prepared.rows
    input.roster = prepared.roster
    Object.assign(input.report.provenance, prepared.provenance, { codeVersion: fixture().report.provenance.codeVersion })
    expect(replay(input).output).toMatchObject({ status: 'unavailable', reasonCodes: ['not_admitted', 'protocol_not_frozen'], cells: [] })
  })

  it.each(['synthetic', 'grant', 'responseText', 'prompt', 'key', 'rubric', 'sourceLocator', 'unrestrictedRows'])('never accepts %s as provenance or leaks its canary', (field) => {
    const input = fixture()
    input[field] = field === 'synthetic' ? false : 'protected_field_canary'
    const { output, serialized } = replay(input, '--sealed-input')
    expect(output).toMatchObject({ status: 'failed', reasonCodes: ['invalid_input'], cells: [] })
    expect(serialized).not.toContain('protected_field_canary')
  })

  it('omits every computation key and source identifier on both successful replay paths', async () => {
    const input = await computed(await Promise.all([1, 2, 3, 4, 5].map(index => computationEpisode(index))))
    const protectedValues = new Set<string>([input.report.reportRunId, ...input.roster])
    function collect(value: ReturnType<typeof fixture>) {
      for (const [key, nested] of Object.entries(value)) {
        if ((key.endsWith('Id') || key.endsWith('Key')) && typeof nested === 'string') protectedValues.add(nested)
        if (nested && typeof nested === 'object') collect(nested)
      }
    }
    input.rows.forEach(collect)
    for (const mode of ['--fixture', '--sealed-input']) {
      const { serialized, output } = replay(input, mode)
      expect(output.status).toBe('replayed')
      for (const value of protectedValues) expect(serialized).not.toContain(JSON.stringify(value))
      for (const field of ['learnerKey', 'capabilityKey', 'assignmentId', 'attemptId', 'reportRunId', 'rows', 'roster', 'cursor']) {
        expect(serialized).not.toContain(`"${field}"`)
      }
    }
  })

  it('rejects malformed rows without echoing a response or validation path', () => {
    const input = fixture()
    input.rows[1].cold.responseText = 'protected_response_canary'
    const { serialized, output } = replay(input)
    expect(output).toMatchObject({ status: 'failed', reasonCodes: ['invalid_input'], cells: [] })
    expect(serialized).not.toContain('protected_response_canary')
  })

  it.each(['malformed', 'directory', 'missing', 'oversize'] as const)('rejects %s input privately', kind => {
    const path = kind === 'directory' ? directory : join(directory, `${sequence++}_private_locator_canary.json`)
    if (kind === 'malformed') writeFileSync(path, '{"responseText":"protected_response_canary"')
    if (kind === 'oversize') writeFileSync(path, ' '.repeat(65 * 1024 * 1024 + 1))
    const { serialized, output, code } = run(['--fixture', path])
    expect(code).toBe(1)
    expect(output).toMatchObject({ status: 'failed', reasonCodes: ['input_unreadable_or_malformed'], cells: [] })
    expect(serialized).not.toContain('canary')
  })

  it('returns explicit diagnostics for no input without network or model dispatch', () => {
    expect(run([])).toMatchObject({ code: 2, output: { status: 'unavailable', cells: [], reasonCodes: ['input_required', 'protocol_not_frozen'] } })
  })

  it.each([
    { args: ['--live'] }, { args: ['--fixture'] }, { args: ['--sealed-input', fixturePath, '--trust'] },
    { args: ['--fixture', fixturePath, '--synthetic=false'] },
  ])('rejects invalid command $args without network or model dispatch', ({ args }) => {
    expect(run(args)).toMatchObject({ code: 1, output: { status: 'failed', reasonCodes: ['invalid_arguments'], cells: [] } })
  })
})
