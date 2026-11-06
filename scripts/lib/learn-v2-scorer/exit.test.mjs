import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import { ROOT, canonical, hash, readJson, exclusiveLock } from './artifacts.mjs'
import { registerScorerImports } from './runtime.mjs'

registerScorerImports()
const { blindRow, corpusInputs, THRESHOLD_POLICY } = await import('./contract.mjs')
const { requestFor, fixtureEnvelope, parseIndependent } = await import('./adapters.mjs')
const { fitThresholds, anchorReport } = await import('./report.mjs')
const { admitLive } = await import('./live-approval.mjs')
const fixtures = join(ROOT, 'tests/fixtures/learn-v2-scorer-harness')
const seed = 'public-synthetic-exit-test-v1'
const clock = 1793966400000
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:API_KEY|API_TOKEN|GATEWAY|CONVEX_DEPLOYMENT|E2E_)/.test(key)))

function workspace(t) {
  const directory = mkdtempSync(join(tmpdir(), 'budds-c3-3-exit-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}
function cli(command, directory, args = [], expected = 0) {
  const result = spawnSync(process.execPath, ['--import', join(fixtures, 'network-deny.mjs'), join(ROOT, 'scripts/learn-v2-scorer-harness.mjs'),
    command, '--output', directory, ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 120_000, maxBuffer: 2_000_000 })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, expected, `${result.stdout}\n${result.stderr}`)
  return result.status === 0 ? JSON.parse(result.stdout) : result
}
function init(directory, extra = []) {
  return cli('init', directory, ['--inventory', join(fixtures, 'inventory.json'), '--fixture', join(fixtures, 'valid.json'),
    '--clock', String(clock), '--seed', seed, '--budget-micro-usd', '100000', '--price-access-date', '2026-11-06', ...extra])
}
function names(directory, suffix) { return readdirSync(directory).filter(name => name.endsWith(suffix)).sort() }
function terminalResults(directory) { return names(directory, '.terminal.json').map(name => readJson(join(directory, name)).payload.result) }
function snapshot(directory, suffix) { return names(directory, suffix).map(name => [name, hash(readFileSync(join(directory, name)))]) }
function file(directory, name, value) { const path = join(directory, name); writeFileSync(path, JSON.stringify(value)); return path }
function anchors() {
  const base = { flow: 'v2_today', horizon: 7, coldCase: 'synthetic_case_a', delayedCase: 'synthetic_case_b', day7Case: 'synthetic_case_b',
    submittedAt: clock, acceptedAt: clock, windowStart: clock - 1, windowEnd: clock + 1, sourceAvailable: true, novel: true,
    exposedBeforeAcceptance: false, assisted: false, pinsMatch: true, scorePercent: 20, divergent: true }
  return { version: 'learn-v2.synthetic-anchor-checks.v1', evidenceStatus: 'synthetic_contract_only', canvasAdmitted: false, rows: [
    { ...base, id: 'valid_failure' }, { ...base, id: 'valid_pass', scorePercent: 100, divergent: false },
    { ...base, id: 'missed', submittedAt: null }, { ...base, id: 'assisted', assisted: true },
    { ...base, id: 'unscored', scorePercent: null }, { ...base, id: 'exposed', exposedBeforeAcceptance: true },
    { ...base, id: 'clock_invalid', acceptedAt: clock - 5 },
    { ...base, id: 'canvas', flow: 'v2_canvas' },
    { ...base, id: 'day30_reused_case', horizon: 30 },
    { ...base, id: 'day30_valid_failure', horizon: 30, delayedCase: 'synthetic_case_c' },
  ] }
}

test('full CLI capture: 768 blind dispatches, complete core denominators, exact replay, restart and no application writes', async t => {
  const parent = workspace(t)
  const directory = join(parent, 'run')
  const before = execFileSync('git', ['status', '--porcelain=v1'], { cwd: ROOT, encoding: 'utf8' })
  const beforeDiff = execFileSync('git', ['diff', '--binary'], { cwd: ROOT })
  init(directory, ['--anchors', file(parent, 'anchors.json', anchors())])
  const summary = cli('run', directory)
  assert.equal(summary.evidenceStatus, 'offline_contract_only')
  assert.equal(summary.dispatched, 768)
  assert.equal(summary.complete, true)
  assert.equal(summary.ambiguous, 0)
  const report = readJson(summary.report).payload
  assert.equal(report.realAnchorValidity, 'pending_real_delayed_evidence')
  assert.equal(report.baselineThreshold, 80)
  assert.equal(report.consistencyClaim, 'offline_contract_only')
  assert.deepEqual(report.authority, { applicationWrites: 0, masteryWrites: 0, humanGrading: false, voting: false, promotion: false })
  assert.equal(names(directory, '.intent.json').length, 768)
  assert.equal(names(directory, '.terminal.json').length, 768)
  for (const stats of Object.values(report.configurations)) {
    assert.equal(stats.scheduled, 256)
    assert.equal(stats.core.scheduled, 224)
    assert.equal(stats.core.referencePositive, 64)
    assert.equal(stats.core.referenceNegative, 160)
    assert.equal(stats.core.unavailable, 0)
    assert.equal(stats.core.criterion.falsePositive, 0)
    assert.equal(stats.core.criterion.falseNegative, 0)
    assert.ok(stats.core.falsePass > 0, 'Essential-atom labels are independent of baseline 80')
    assert.equal(stats.fit.scheduled, 112)
    assert.equal(stats.heldout.scheduled, 112)
    assert.equal(stats.controls.scheduled, 8)
    assert.equal(stats.repeats.scheduled, 20)
    assert.equal(stats.repeats.disagreements, 0)
    assert.equal(stats.diagnostics.scheduled, 4)
    assert.equal(Object.keys(stats.domain).length, 8)
    assert.equal(Object.keys(stats.form).length, 2)
    assert.equal(stats.candidateHeldout.falsePass, 0)
    assert.equal(stats.candidateHeldout.falseBlock, 0)
  }
  for (const value of Object.values(report.disagreement)) {
    assert.equal(value.availablePairs, 224)
    assert.equal(value.criterionDisagreements, 0)
  }
  const corpus = await corpusInputs()
  const manifest = readJson(join(directory, 'manifest.json')).payload
  const rows = [...corpus.corpus.core, ...corpus.corpus.controls, ...corpus.corpus.repeats, ...corpus.corpus.diagnostics]
  const projections = new Map(manifest.adapters.flatMap(adapter => rows.map(row => {
    const packet = corpus.sources.packets.find(packet => packet.id === row.packetId)
    const form = packet.forms.find(form => form.id === row.formId)
    const id = `item_${hash(`${seed}/${adapter.id}/${row.id}`).slice(7, 39)}`
    const atoms = packet.atoms.map((atom, index) => ({ id: `k${index + 1}`, sourceClaimId: `c${index + 1}`,
      description: atom.description, kind: atom.kind, query: atom.query,
      ...(atom.unit ? { unit: atom.unit, unitAliases: atom.unitAliases } : {}) }))
    const excerpt = { source: { context: packet.source.context, records: packet.source.records,
      claims: Object.fromEntries(atoms.map(atom => [atom.sourceClaimId, { description: atom.description, kind: atom.kind, query: atom.query }])) },
    key: { version: packet.keyVersion, atoms } }
    return [id, { role: adapter.role, excerpt, input: {
      rubric: { version: packet.rubricVersion, criteria: packet.atoms.map((atom, index) => ({
        key: `k${index + 1}`, description: atom.description, weightPercent: atom.weight })) },
      challenge: form.question,
      evidence: [{ alias: id, claim: 'Use only this public synthetic source and executable answer key.', excerpt: canonical(excerpt) }],
      learnerResponse: row.response,
    } }]
  })))
  const ids = new Set()
  const threshold = readJson(join(directory, 'thresholds.json'))
  for (const name of names(directory, '.intent.json')) {
    const { payload } = readJson(join(directory, name))
    ids.add(payload.id)
    const body = payload.request.body
    const request = JSON.parse(body)
    const expected = projections.get(payload.id)
    assert.ok(expected, 'Every dispatch must map to one permitted source projection')
    let content
    if (expected.role === 'gemini') {
      assert.deepEqual(request.input.map(message => message.role), ['user'])
      assert.equal(request.input[0].content.length, 1)
      assert.equal(request.input[0].content[0].type, 'text')
      content = request.input[0].content[0].text
    }
    else {
      assert.deepEqual(request.messages.map(message => message.role), expected.role === 'baseline' ? ['system', 'user'] : ['user'])
      content = request.messages.find(message => message.role === 'user').content
    }
    const decoded = JSON.parse(content)
    assert.deepEqual(decoded, expected.input, `${expected.role}: decoded message must contain exactly the permitted projection`)
    assert.deepEqual(JSON.parse(decoded.evidence[0].excerpt), expected.excerpt, 'Decode the nested source/key payload too')
    assert.doesNotMatch(canonical(decoded), /"(?:seedClass|split|expected|referencePass|essential|packetId|formId|learnerId|condition|timestamp|scorePercent|repeatOf|proof)"\s*:/)
    assert.doesNotMatch(body, /"(?:seedClass|split|expected|referencePass|essential|packetId|formId|learnerId|condition|timestamp|scorePercent|repeatOf|proof)"\s*:/)
    for (const row of corpus.corpus.core) assert.ok(!body.includes(row.id))
    assert.doesNotMatch(body, /public-synthetic:|source\.v1|sourceSha256/)
    if (payload.thresholdDigest !== null) assert.equal(payload.thresholdDigest, threshold.digest)
  }
  assert.equal(ids.size, 768)
  assert.equal(report.anchors.byFlowHorizon['v2_today/day7'].observedFailures, 1)
  assert.equal(report.anchors.byFlowHorizon['v2_today/day7'].valid, 2)
  assert.equal(report.anchors.observations.find(row => row.id === 'valid_failure').validationClaim, 'quarantined')
  const sealed = snapshot(directory, '.json')
  assert.equal(cli('replay', directory, ['--expected-report', basename(summary.report)]).digest, summary.digest)
  assert.equal(cli('run', directory).digest, summary.digest)
  assert.deepEqual(snapshot(directory, '.json'), sealed, 'Restart must not change or double dispatch sealed work')
  assert.equal(execFileSync('git', ['status', '--porcelain=v1'], { cwd: ROOT, encoding: 'utf8' }), before)
  assert.deepEqual(execFileSync('git', ['diff', '--binary'], { cwd: ROOT }), beforeDiff)
})

test('CLI failure exit matrix retains unavailable denominators and ambiguous reservations across restart', t => {
  const directory = join(workspace(t), 'run')
  const fixture = readJson(join(fixtures, 'failures.json'))
  const fixturePath = file(workspace(t), 'failures.json', fixture)
  const args = ['--inventory', join(fixtures, 'inventory.json'), '--fixture', fixturePath, '--clock', String(clock), '--seed', seed,
    '--budget-micro-usd', '100000', '--price-access-date', '2026-11-06']
  cli('init', directory, args)
  const summary = cli('run', directory)
  assert.equal(summary.complete, false)
  assert.equal(summary.dispatched, 24)
  assert.equal(summary.ambiguous, 3)
  const report = readJson(summary.report).payload
  assert.equal(report.reservations.retainedMicroUsd, 2400)
  assert.equal(report.reservations.ambiguousReservedMicroUsd, 300)
  const statuses = new Set(terminalResults(directory).map(result => result.status))
  for (const status of ['valid', 'abstained', 'refused', 'truncated', 'malformed', 'mismatched', 'budget_exhausted', 'ambiguous']) assert.ok(statuses.has(status), status)
  for (const stats of Object.values(report.configurations)) {
    assert.equal(stats.core.scheduled, 224)
    assert.equal(stats.core.referencePositive + stats.core.referenceNegative, 224)
    assert.equal(stats.core.available + stats.core.unavailable, 224)
    assert.equal(stats.core.falsePassBounds.rate, null)
    assert.equal(stats.core.falseBlockBounds.rate, null)
    assert.ok(stats.core.falsePassBounds.upper > stats.core.falsePassBounds.lower)
  }
  for (const result of terminalResults(directory).filter(result => result.status !== 'valid')) {
    assert.equal(result.scorePercent, null)
    assert.equal(result.criteria, null)
  }
  const sealed = snapshot(directory, '.json')
  assert.equal(cli('run', directory).digest, summary.digest)
  assert.equal(cli('replay', directory, ['--expected-report', basename(summary.report)]).digest, summary.digest)
  assert.deepEqual(snapshot(directory, '.json'), sealed)
})

test('an intent without a terminal is never dispatched again; its full reservation survives restart', t => {
  const directory = join(workspace(t), 'run')
  init(directory)
  const first = cli('run', directory, ['--crash-after-intent', 'true'])
  assert.equal(first.ambiguous, 1)
  const [name] = names(directory, '.intent.json')
  const original = readFileSync(join(directory, name), 'utf8')
  assert.equal(names(directory, '.terminal.json').length, 0)
  const restarted = cli('run', directory, ['--stop-after', '1'])
  assert.equal(restarted.dispatched, 2)
  assert.equal(restarted.ambiguous, 1)
  assert.equal(readFileSync(join(directory, name), 'utf8'), original)
  assert.equal(names(directory, '.terminal.json').length, 1)
  const report = readJson(restarted.report).payload
  assert.equal(report.reservations.ambiguousReservedMicroUsd, 100)
})

test('a local cap stops dispatch before transport, without turning absent grades into zero', t => {
  const parent = workspace(t)
  const directory = join(parent, 'run')
  cli('init', directory, ['--inventory', join(fixtures, 'inventory.json'), '--fixture', join(fixtures, 'valid.json'), '--clock', String(clock), '--seed', seed,
    '--budget-micro-usd', '150', '--price-access-date', '2026-11-06'])
  const summary = cli('run', directory, ['--stop-after', '12'])
  assert.equal(summary.dispatched, 1)
  assert.equal(names(directory, '.intent.json').length, 12)
  assert.equal(terminalResults(directory).filter(result => result.status === 'budget_exhausted').length, 11)
  assert.equal(readJson(summary.report).payload.reservations.retainedMicroUsd, 100)
})

test('a terminal at the 90-second deadline is unavailable and keeps its reservation', t => {
  const parent = workspace(t)
  const directory = join(parent, 'run')
  const fixture = { ...readJson(join(fixtures, 'valid.json')), default: 'deadline' }
  cli('init', directory, ['--inventory', join(fixtures, 'inventory.json'), '--fixture', file(parent, 'deadline.json', fixture),
    '--clock', String(clock), '--seed', seed, '--budget-micro-usd', '100000', '--price-access-date', '2026-11-06'])
  const summary = cli('run', directory, ['--stop-after', '1'])
  assert.equal(summary.ambiguous, 1)
  const terminal = readJson(join(directory, names(directory, '.terminal.json')[0])).payload
  assert.equal(terminal.terminalAt, clock + 90_000)
  assert.equal(terminal.result.status, 'ambiguous')
  assert.equal(terminal.result.scorePercent, null)
  assert.equal(readJson(summary.report).payload.reservations.ambiguousReservedMicroUsd, 100)
})

test('missing, changed and stale run pins, altered verdicts and unknown artifacts block replay', t => {
  for (const mutate of [
    value => { delete value.payload.implementation.files['pnpm-lock.yaml'] },
    value => { value.payload.implementation.node = '24.0.0' },
    value => { value.payload.components.parser = 'changed.v9' },
    value => { value.payload.bindings[0].binding.requestedModel = 'openai/gpt-other' },
  ]) {
    const directory = join(workspace(t), 'run')
    init(directory)
    const path = join(directory, 'manifest.json')
    const envelope = readJson(path)
    mutate(envelope)
    envelope.pinsDigest = hash(envelope.payload)
    const unsigned = Object.fromEntries(Object.entries(envelope).filter(([key]) => key !== 'digest'))
    envelope.digest = hash(unsigned)
    writeFileSync(path, `${canonical(envelope)}\n`)
    cli('replay', directory, [], 1)
  }
  const directory = join(workspace(t), 'run')
  init(directory)
  cli('run', directory, ['--stop-after', '1'])
  const path = join(directory, names(directory, '.terminal.json')[0])
  const original = readFileSync(path, 'utf8')
  const terminal = JSON.parse(original)
  terminal.payload.result.scorePercent = 13
  const unsigned = Object.fromEntries(Object.entries(terminal).filter(([key]) => key !== 'digest'))
  terminal.digest = hash(unsigned)
  writeFileSync(path, `${canonical(terminal)}\n`)
  cli('replay', directory, [], 1)
  writeFileSync(path, original)
  file(directory, 'unexpected.json', {})
  cli('replay', directory, [], 1)
})

test('unknown families, disguised aliases, overlapping inventory and live fixture admission fail closed', t => {
  for (const change of [
    inventory => { inventory.configurations[0].definition.identity.family = null },
    inventory => { inventory.configurations[0].definition.identity.canonicalModel = 'anthropic/claude-sonnet-5-5' },
    inventory => { inventory.configurations[0].upstream = null },
    inventory => {
      const entry = structuredClone(inventory.configurations[0])
      entry.definition.configurationId = 'overlapping-baseline.v1'
      entry.definition.requestedModel = 'google/gemini-3.6-flash'
      entry.definition.identity.family = 'gemini'
      entry.definition.identity.canonicalModel = 'google/gemini-3.6-flash'
      inventory.configurations.push(entry)
    },
  ]) {
    const parent = workspace(t)
    const inventory = readJson(join(fixtures, 'inventory.json'))
    change(inventory)
    cli('init', join(parent, 'run'), ['--inventory', file(parent, 'inventory.json', inventory), '--fixture', join(fixtures, 'valid.json'),
      '--clock', String(clock), '--seed', seed, '--budget-micro-usd', '100000', '--price-access-date', '2026-11-06'], 1)
  }
  const parent = workspace(t)
  cli('init', join(parent, 'run'), ['--inventory', join(fixtures, 'inventory.json'), '--fixture', join(fixtures, 'valid.json'),
    '--mode', 'live', '--clock', String(clock), '--seed', seed, '--budget-micro-usd', '100000', '--price-access-date', '2026-11-06'], 1)
  cli('init', ROOT, ['--inventory', join(fixtures, 'inventory.json')], 1)
})

test('independent adapters pin exact APIs/settings and reject incomplete vectors, source refs and output envelopes', async () => {
  const corpus = await corpusInputs()
  const blind = blindRow(corpus.corpus.core[0], corpus.sources, seed, 'claude_1')
  const adapter = { id: 'claude_1', role: 'claude', model: 'claude-sonnet-5-5', upstream: 'anthropic' }
  const request = requestFor(adapter, blind)
  const body = JSON.parse(request.body)
  assert.equal(request.api, '2026-10-21')
  assert.equal(body.max_tokens, 2048)
  assert.deepEqual(body.thinking, { type: 'adaptive' })
  assert.ok(!('temperature' in body) && !('tools' in body))
  const raw = fixtureEnvelope(adapter, blind, 'valid')
  assert.equal(parseIndependent(adapter, blind, raw).status, 'valid')
  for (const mutate of [
    verdict => { verdict.scorePercent = 100 },
    verdict => { verdict.criterionResults.pop() },
    verdict => { verdict.criterionResults[1].key = verdict.criterionResults[0].key },
    verdict => { verdict.criterionResults[0].sourceRefs[0].end = 1_000_000 },
    verdict => { verdict.criterionResults[0].sourceRefs[0].alias = 'other_item' },
  ]) {
    const value = structuredClone(raw)
    const verdict = JSON.parse(value.content[0].text)
    mutate(verdict)
    value.content[0].text = JSON.stringify(verdict)
    assert.equal(parseIndependent(adapter, blind, value).status, 'malformed')
  }
  const gemini = requestFor({ ...adapter, role: 'gemini' }, blind)
  assert.equal(gemini.endpoint, 'https://generativelanguage.googleapis.com/v1beta/interactions')
  assert.equal(gemini.api, '2026-05-20')
  assert.equal(JSON.parse(gemini.body).store, false)
  assert.equal(JSON.parse(gemini.body).generation_config.max_output_tokens, 2048)
})

test('candidate fitting never reads held-out verdicts and keeps the baseline comparator at 80', async () => {
  const { corpus, sources } = await corpusInputs()
  const output = new Map(corpus.core.map(row => {
    const packet = sources.packets.find(packet => packet.id === row.packetId)
    return [row.id, { status: 'valid', scorePercent: packet.atoms.reduce((sum, atom) => sum + (row.expected.criteria[atom.id] ? atom.weight : 0), 0),
      criteria: Object.values(row.expected.criteria).map((awarded, index) => ({ key: `k${index + 1}`, awarded })), weights: packet.atoms.map(atom => atom.weight) }]
  }))
  const results = new Map([['baseline_1', output]])
  const before = fitThresholds(corpus, [{ id: 'baseline_1' }], results, ['sealed_fit_only'])
  assert.equal(before.configurations.baseline_1.candidate, 100)
  for (const row of corpus.core.filter(row => row.split === 'heldout')) output.set(row.id, { status: 'ambiguous' })
  assert.deepEqual(fitThresholds(corpus, [{ id: 'baseline_1' }], results, ['sealed_fit_only']), before)
  assert.equal(THRESHOLD_POLICY.baseline, 80)
})

test('delayed failures survive claim quarantine; clock, assistance, novelty and three-case checks retain exclusions', () => {
  const report = anchorReport(anchors())
  const today = report.byFlowHorizon['v2_today/day7']
  assert.equal(today.eligible, 7)
  assert.equal(today.submitted, 6)
  assert.equal(today.valid, 2)
  assert.equal(today.observedFailures, 1)
  assert.equal(today.missed, 1)
  assert.equal(today.assisted, 1)
  assert.equal(today.unscored, 1)
  assert.equal(today.invalid, 2)
  assert.equal(report.byFlowHorizon['v2_today/day30'].invalid, 1)
  assert.equal(report.byFlowHorizon['v2_today/day30'].observedFailures, 1)
  assert.equal(report.byFlowHorizon['v2_canvas/day7'].excludedCanvas, 1)
  assert.equal(report.realAnchorValidity, 'pending_real_delayed_evidence')
})

test('live admission verifies separate owner signatures, finite reservation evidence and freshness, without inference', t => {
  const directory = workspace(t)
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const keyPath = file(directory, 'unused.json', {})
  writeFileSync(keyPath, publicKey.export({ type: 'spki', format: 'pem' }))
  const request = { endpoint: 'synthetic-approved-endpoint', api: 'fixture.v1', body: '{}' }
  const pins = { mode: 'live', budgetMicroUsd: 100000, priceAccessDate: '2026-11-06', adapters: [{ id: 'claude_1', role: 'claude' }] }
  const quote = { id: 'item_0', requestDigest: hash(request), inputTokenBound: 4096, outputTokenBound: 2048,
    inputMicroUsdPerMillion: 2_000_000, outputMicroUsdPerMillion: 10_000_000, overheadMicroUsd: 0,
    maximumMicroUsd: 28672, evidenceReference: 'synthetic_conservative_bound_including_schema' }
  pins.budgetMicroUsd = 10_000_000
  const cost = { version: 'learn-v2.harness-cost-reservation.v1', pinsDigest: hash(pins), priceAccessDate: pins.priceAccessDate,
    verifiedAt: clock, expiresAt: clock + 1000, includesSchemaAndSystemOverhead: true, includesFeesTaxesAndPurchases: true,
    method: 'verified_conservative_reservation', requests: Array.from({ length: 256 }, (_, index) => ({ ...quote, id: `item_${index}` })) }
  const approval = { version: 'learn-v2.harness-owner-approval.v1', owner: 'synthetic-owner', approvalId: 'synthetic-approval',
    pinsDigest: hash(pins), budgetMicroUsd: pins.budgetMicroUsd, budgetApproved: true, providersApproved: true, privacyApproved: true,
    payloadPolicy: 'learn-v2.public-synthetic-payload.v1', issuedAt: clock, expiresAt: clock + 1000, costEvidenceDigest: hash(cost) }
  const signed = (name, payload) => file(directory, name, { payload, signature: sign(null, Buffer.from(canonical(payload)), privateKey).toString('base64') })
  const costFile = signed('cost.json', cost)
  const approvalFile = signed('approval.json', approval)
  const input = { pins, pinsDigest: hash(pins), item: { adapter: 'claude_1', blind: { id: 'item_0' } }, request,
    requestPins: cost.requests.map(row => ({ id: row.id, requestDigest: row.requestDigest })),
    approvalFile, costFile, trustKey: keyPath, now: clock + 1 }
  assert.equal(admitLive(input).reservationMicroUsd, quote.maximumMicroUsd)
  for (const [field, value] of [['privacyApproved', false], ['providersApproved', false], ['budgetApproved', false], ['expiresAt', clock - 1]]) {
    assert.throws(() => admitLive({ ...input, approvalFile: signed('bad-approval.json', { ...approval, [field]: value }) }))
  }
  assert.throws(() => admitLive({ ...input, request: { ...request, body: 'changed' } }))
  assert.throws(() => admitLive({ ...input, now: clock + 2000 }))
  assert.throws(() => admitLive({ ...input, approvalFile: undefined }))
  const unverified = { ...cost, includesSchemaAndSystemOverhead: false }
  assert.throws(() => admitLive({ ...input, costFile: signed('unverified-cost.json', unverified),
    approvalFile: signed('unverified-approval.json', { ...approval, costEvidenceDigest: hash(unverified) }) }))
})

test('exclusive locks refuse overlapping dispatchers and preserve an unknown crashed owner lock', async t => {
  const directory = workspace(t)
  let release
  const blocked = new Promise(resolve => { release = resolve })
  const first = exclusiveLock(directory, 'global.lock', () => blocked)
  assert.throws(() => exclusiveLock(directory, 'global.lock', () => {}), /reconciliation/)
  release()
  await first
  writeFileSync(join(directory, 'global.lock'), 'unknown old process\n')
  assert.throws(() => exclusiveLock(directory, 'global.lock', () => {}), /reconciliation/)
})

test('the reconcile CLI refuses an offline run without inference or metadata access', t => {
  const directory = join(workspace(t), 'run')
  init(directory)
  cli('reconcile', directory, ['--id', 'item_unrecorded'], 1)
  assert.equal(names(directory, '.intent.json').length, 0)
  assert.equal(names(directory, '.reconciled.json').length, 0)
})

test('the global approval ledger exit regressions use isolated mock adapters with network denied', t => {
  // Complementary filters keep every case while bounding each serial child
  // below the existing timeout, including on slower CI/extracted checkouts.
  const partition = '^(?:A3 M1 and crash table|A5)'
  for (const [index, filter] of ['--test-name-pattern', '--test-skip-pattern'].entries()) {
    const started = performance.now()
    const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--import', join(fixtures, 'network-deny.mjs'),
      '--test', '--test-reporter=tap', '--test-concurrency=1', `${filter}=${partition}`, join(ROOT, 'scripts/lib/learn-v2-scorer/live-ledger.test.mjs')], {
      cwd: ROOT, env: Object.fromEntries(Object.entries(env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
      encoding: 'utf8', timeout: 360_000, maxBuffer: 2_000_000,
    })
    assert.equal(result.error, undefined, `${result.error?.message}\n${result.stdout}\n${result.stderr}`)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, index === 0 ? /A3 M1 and crash table/ : /one signed approval cannot dispatch in two directories/)
    const count = result.stdout.match(/^# tests (\d+)$/m)?.[1]
    assert.ok(Number(count) > 0, 'Each ledger partition must run tests')
    t.diagnostic(`Ledger partition ${index + 1}: ${count} tests in ${(performance.now() - started).toFixed(0)} ms`)
  }
})
