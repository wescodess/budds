import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, readdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { registerScorerImports, forbidNetwork } from './runtime.mjs'

registerScorerImports()
forbidNetwork()
const { requestFor, requestPinsDigest, GRADER_SCHEMA, GRADER_PROMPT, parseIndependent, adapterRequestDigest, baselineExecution, fixtureEnvelope } = await import('./adapters.mjs')
const { ADAPTER_PINS, corpusInputs, blindRow, bindInventory } = await import('./contract.mjs')
const { canonical, hash, seal, ROOT } = await import('./artifacts.mjs')
const { anchorReport, fitThresholds, buildReport } = await import('./report.mjs')
const { sealLearnScorerConfiguration, createLearnScorerRegistry } = await import('../../../convex/lib/learnV2ScorerConfig.ts')
let inputs
const corpus = async () => inputs ??= await corpusInputs()
const adapter = role => ({ ...ADAPTER_PINS[role], role, id: `${role}_1`, configuration: hash('configuration'), upstream: 'observed' })

test('B1 H1/H2 provider request bodies use supported schema keywords and exact wire shapes', () => {
  const keywords = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minItems'])
  const check = schema => {
    for (const key of Object.keys(schema)) assert.ok(keywords.has(key), `Unsupported schema keyword: ${key}`)
    if (schema.type === 'object') assert.equal(schema.additionalProperties, false)
    if (schema.minItems !== undefined) assert.ok([0, 1].includes(schema.minItems))
    for (const child of Object.values(schema.properties ?? {})) check(child)
    if (schema.items) check(schema.items)
  }
  const payload = 'A fixed synthetic scoring payload'
  const claude = requestFor(adapter('claude'), { payload })
  const google = requestFor(adapter('gemini'), { payload })
  check(JSON.parse(claude.body).output_config.format.schema)
  check(JSON.parse(google.body).response_format.schema)
  assert.deepEqual(JSON.parse(claude.body), { model: 'claude-sonnet-5-5', max_tokens: 2048, thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: GRADER_SCHEMA } }, system: GRADER_PROMPT,
    messages: [{ role: 'user', content: payload }] })
  assert.deepEqual(JSON.parse(google.body), { model: 'gemini-3.6-flash', input: payload, system_instruction: GRADER_PROMPT,
    generation_config: { thinking_level: 'medium', thinking_summaries: 'none', max_output_tokens: 2048 },
    response_format: { type: 'text', mime_type: 'application/json', schema: GRADER_SCHEMA }, store: false, stream: false })
  assert.equal(claude.api, '2026-10-21')
  assert.equal(google.api, '2026-05-20')
  assert.equal(google.endpoint, 'https://generativelanguage.googleapis.com/v1beta/interactions')
  assert.deepEqual(google.transport, { attempts: 1, redirect: 'error' })
  assert.equal(adapterRequestDigest(adapter('gemini')), hash(requestFor(adapter('gemini'), { payload: '' })))
})

test('B1 ceiling request pins include every wire setting while excluding per-item text', () => {
  for (const role of ['baseline', 'claude', 'gemini']) assert.equal(requestPinsDigest(requestFor(adapter(role), { payload: 'item one' })),
    requestPinsDigest(requestFor(adapter(role), { payload: 'item two' })), role)
  const request = requestFor(adapter('gemini'), { payload: 'item one' })
  const fingerprint = requestPinsDigest(request)
  assert.equal(requestPinsDigest(requestFor(adapter('gemini'), { payload: 'item two' })), fingerprint)
  for (const change of ['prompt', 'schema', 'api', 'endpoint', 'settings', 'transport']) {
    const altered = structuredClone(request)
    const body = JSON.parse(altered.body)
    if (change === 'prompt') body.system_instruction += ' changed'
    if (change === 'schema') body.response_format.schema.properties.extra = { type: 'string' }
    if (change === 'api') altered.api = 'next-revision'
    if (change === 'endpoint') altered.endpoint += '/next'
    if (change === 'settings') body.generation_config.thinking_level = 'low'
    if (change === 'transport') altered.transport.attempts = 2
    altered.body = JSON.stringify(body)
    assert.notEqual(requestPinsDigest(altered), fingerprint, change)
  }
})

test('B1 H2 Gemini reads the last model_output step and ignores documented thought steps', async () => {
  const data = await corpus()
  const blind = blindRow(data.corpus.core[0], data.sources, 'synthetic-protocol-seed', 'gemini_1')
  const verdict = JSON.stringify({ disposition: 'supported', criterionResults: blind.scoringInput.rubric.criteria.map(row => ({ key: row.key, awarded: true,
    sourceRefs: [{ alias: blind.id, start: 0, end: 1 }] })) })
  const body = { id: 'interaction-native', model: 'gemini-3.6-flash', status: 'completed', usage: { total_input_tokens: 100, total_output_tokens: 100 },
    steps: [{ type: 'thought', summary: [{ type: 'text', text: 'Not a verdict.' }], signature: 'opaque' },
      { type: 'model_output', content: [{ type: 'text', text: 'Earlier text is not the final verdict.' }] },
      { type: 'model_output', content: [{ type: 'text', text: verdict.slice(0, 20) }, { type: 'text', text: verdict.slice(20) }] }] }
  assert.ok(Array.isArray(fixtureEnvelope(adapter('gemini'), blind, 'valid').steps))
  assert.equal(Object.hasOwn(fixtureEnvelope(adapter('gemini'), blind, 'valid'), 'outputs'), false)
  for (const outcome of ['valid', 'refused', 'truncated']) assert.ok(['completed', 'failed', 'incomplete'].includes(fixtureEnvelope(adapter('gemini'), blind, outcome).status))
  assert.equal(parseIndependent(adapter('gemini'), blind, body).status, 'valid')
  assert.equal(parseIndependent(adapter('gemini'), blind, body).scorePercent, 100)
  for (const [status, expected] of [['in_progress', 'ambiguous'], ['requires_action', 'truncated'], ['requires_continuation', 'truncated'],
    ['incomplete', 'truncated'], ['failed', 'definitive_failure'], ['cancelled', 'definitive_failure'], ['refused', 'malformed'], ['other', 'malformed']]) {
    assert.equal(parseIndependent(adapter('gemini'), blind, { ...body, status }).status, expected)
  }
  for (const type of ['tool_call', 'tool_result', 'user_input', 'other']) {
    assert.equal(parseIndependent(adapter('gemini'), blind, { ...body, steps: [...body.steps, { type }] }).status, 'malformed')
    assert.equal(parseIndependent(adapter('gemini'), blind, { ...body, steps: [{ type: 'model_output', content: [{ type, text: verdict }] }] }).status, 'malformed')
    assert.equal(parseIndependent(adapter('gemini'), blind, { ...body,
      steps: [{ type: 'model_output', content: [{ type, text: verdict }] }, ...body.steps] }).status, 'malformed')
  }
  assert.equal(parseIndependent(adapter('gemini'), blind, { ...body, steps: [] }).status, 'malformed')
  assert.equal(parseIndependent(adapter('gemini'), blind, { ...body, steps: undefined, outputs: [{ type: 'text', text: verdict }] }).status, 'malformed')
  for (const change of ['too-many-refs', 'negative-start', 'empty-span', 'past-source', 'extra-criterion']) {
    const invalid = JSON.parse(verdict)
    const refs = invalid.criterionResults[0].sourceRefs
    if (change === 'too-many-refs') refs.push(...Array.from({ length: 3 }, () => ({ ...refs[0] })))
    if (change === 'negative-start') refs[0].start = -1
    if (change === 'empty-span') refs[0].end = 0
    if (change === 'past-source') refs[0].end = blind.scoringInput.evidence[0].excerpt.length + 1
    if (change === 'extra-criterion') invalid.criterionResults.push(invalid.criterionResults[0])
    assert.equal(parseIndependent(adapter('gemini'), blind, { ...body,
      steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(invalid) }] }] }).status, 'malformed', change)
  }
})

test('B1 strict upstream mismatch is unscored while legacy automatic routing accepts observed upstreams', async () => {
  const data = await corpus()
  const blind = blindRow(data.corpus.core[0], data.sources, 'synthetic-routing-seed', 'baseline_1')
  for (const strict of [false, true]) {
    const definition = { configurationId: strict ? 'strict.route.v1' : 'legacy.route.v1', configurationVersion: 'route.v1',
      kind: strict ? 'strict_prospective' : 'legacy_baseline', requestedModel: 'openai/gpt-4.1', endpoint: strict ? 'provider/region' : null,
      identity: { mappingVersion: 'route.identity.v1', canonicalModel: 'openai/gpt-4.1', family: 'openai-gpt', snapshotAssurance: 'unknown', verifiedReturnedModels: [] } }
    const saved = await sealLearnScorerConfiguration(definition)
    const registry = await createLearnScorerRegistry({ epoch: 'route.v1', configurations: [{ definition, expectedDigest: saved.binding.configurationDigest }],
      legacyAllowlist: strict ? [] : [definition.configurationId], prospectiveConfigurationId: strict ? definition.configurationId : null })
    const pin = { ...adapter('baseline'), model: definition.requestedModel, upstream: 'Inventory observation', configuration: saved.binding.configurationDigest }
    const raw = fixtureEnvelope({ ...pin, upstream: 'Actual observed upstream' }, blind, 'valid')
    const result = await baselineExecution({ adapter: pin, blind, saved, registry, startedAt: 1000, terminalAt: 1001, raw })
    assert.equal(result.status, strict ? 'upstream_mismatch' : 'valid')
    if (strict) assert.equal(result.scorePercent, null)
  }
})

test('B1 M6 canonical rejects undefined before any artifact write', t => {
  const directory = mkdtempSync(join(tmpdir(), 'budds-b1-canonical-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  for (const value of [undefined, { nested: undefined }, [undefined], new Array(1), () => {}, Symbol('invalid')]) {
    assert.throws(() => seal(directory, 'bad.json', 'test', hash('pins'), value))
    assert.deepEqual(readdirSync(directory), [])
    assert.throws(() => canonical(value))
  }
  assert.equal(canonical({ value: null, zero: 0, false: false }), '{"false":false,"value":null,"zero":0}')
})

test('B1 inventory admits latest and attested while rejecting whole fixture words', async () => {
  const definition = { configurationId: 'latest.attested.v1', configurationVersion: 'reviewed.v1', kind: 'legacy_baseline', requestedModel: 'openai/gpt-4.1', endpoint: null,
    identity: { mappingVersion: 'reviewed.identity.v1', canonicalModel: 'openai/gpt-4.1', family: 'openai-gpt', snapshotAssurance: 'unknown', verifiedReturnedModels: [] } }
  const entry = { definition, expectedDigest: (await sealLearnScorerConfiguration(definition)).binding.configurationDigest, upstream: 'OpenAI',
    transportEndpoint: 'https://gateway.ai.cloudflare.com/v1/account/gateway/openrouter/v1/chat/completions', inventoryEvidence: 'latest attested review' }
  const inventory = { version: 'learn-v2.harness-inventory.v1', scope: 'reviewed_published_inventory', epoch: 'reviewed.v1', configurations: [entry] }
  await bindInventory(inventory, 'live')
  for (const word of ['test', 'fixture', 'synthetic']) await assert.rejects(bindInventory({ ...inventory,
    configurations: [{ ...entry, inventoryEvidence: `review ${word} data` }] }, 'live'), /Fixture inventory/)
})

function reportInputs(data) {
  const adapters = ['baseline', 'claude', 'gemini'].map(role => adapter(role))
  const rows = [...data.corpus.core, ...data.corpus.controls, ...data.corpus.repeats, ...data.corpus.diagnostics]
  const output = new Map(rows.map(row => {
    const weights = data.sources.packets.find(packet => packet.id === row.packetId).atoms.map(atom => atom.weight)
    const criteria = Object.values(row.expected.criteria).map((awarded, index) => ({ key: `k${index + 1}`, awarded }))
    return [row.id, { status: 'valid', criteria, weights, scorePercent: criteria.reduce((sum, row, index) => sum + (row.awarded ? weights[index] : 0), 0) }]
  }))
  const results = new Map(adapters.map(row => [row.id, structuredClone(output)]))
  const pins = { mode: 'live', evidenceStatus: 'synthetic_contract_only', adapters,
    anchors: { version: 'learn-v2.synthetic-anchor-checks.v1', evidenceStatus: 'synthetic_contract_only', canvasAdmitted: false, rows: [] } }
  const schedule = adapters.flatMap(adapter => rows.map(row => ({ adapter: adapter.id, rowId: row.id })))
  return { pins, pinsDigest: hash('report-pins'), corpus: data.corpus, schedule, results,
    thresholds: fitThresholds(data.corpus, adapters, results, []), artifacts: [], reservations: {} }
}

test('B1 M5 perfect graders pass consistency while 80-comparator partial false passes remain reported', async () => {
  const input = reportInputs(await corpus())
  const report = buildReport(input)
  assert.equal(report.consistencyClaim, 'provisional_consistency_pass')
  assert.equal(report.complete, true)
  assert.deepEqual(report.quarantine, [])
  assert.equal(report.realAnchorValidity, 'pending_real_delayed_evidence')
  assert.equal(report.authority.promotion, false)
  for (const stats of Object.values(report.configurations)) {
    assert.equal(stats.core.falsePass, 24)
    assert.equal(stats.core.criterion.falsePositive, 0)
    assert.equal(stats.core.criterion.falseNegative, 0)
    assert.equal(stats.thresholdFinding.classification, 'threshold_comparison_not_criterion_divergence')
    assert.equal(stats.thresholdFinding.falsePass.errors, 24)
  }
})

test('B1 report preserves signed score errors and criterion false-positive/negative counters', async () => {
  const input = reportInputs(await corpus())
  const output = input.results.get('claude_1')
  const positive = input.corpus.core.find(row => Object.values(row.expected.criteria).includes(false))
  const negative = input.corpus.core.find(row => row.id !== positive.id && Object.values(row.expected.criteria).includes(true))
  const flip = (row, expected) => {
    const result = output.get(row.id)
    const index = Object.values(row.expected.criteria).indexOf(expected)
    result.criteria[index].awarded = !expected
    result.scorePercent += (expected ? -1 : 1) * result.weights[index]
    return (expected ? -1 : 1) * result.weights[index]
  }
  const over = flip(positive, false)
  const under = flip(negative, true)
  const report = buildReport(input)
  const stats = report.configurations.claude_1.core
  assert.equal(stats.criterion.falsePositive, 1)
  assert.equal(stats.criterion.falseNegative, 1)
  assert.equal(stats.scoreErrors[String(over)], 1)
  assert.equal(stats.scoreErrors[String(under)], 1)
  assert.equal(stats.scoreErrors['0'], 222)
  assert.equal(report.consistencyClaim, 'unavailable')
  assert.equal(report.quarantine.find(row => row.adapter === 'claude_1').reason, 'source_or_repeat_divergence')
})

test('B1 criterion error directions remain distinct when only one direction occurs', async () => {
  for (const expected of [false, true]) {
    const input = reportInputs(await corpus())
    const row = input.corpus.core.find(row => Object.values(row.expected.criteria).includes(expected)
      && !input.corpus.repeats.some(repeat => repeat.repeatOf === row.id))
    const result = input.results.get('claude_1').get(row.id)
    const index = Object.values(row.expected.criteria).indexOf(expected)
    result.criteria[index].awarded = !expected
    result.scorePercent += (expected ? -1 : 1) * result.weights[index]
    const report = buildReport(input)
    const stats = report.configurations.claude_1.core
    assert.equal(report.consistencyClaim, 'unavailable')
    assert.equal(stats.criterion.falsePositive, Number(!expected))
    assert.equal(stats.criterion.falseNegative, Number(expected))
    assert.equal(stats.scoreErrors[String((expected ? -1 : 1) * result.weights[index])], 1)
    assert.equal(stats.scoreErrors['0'], 223)
  }
})

test('B1 consistency refuses unavailable evidence, repeat divergence and diagnostic criterion errors', async () => {
  for (const change of ['unavailable', 'repeat', 'diagnostic']) {
    const input = reportInputs(await corpus())
    const output = input.results.get('gemini_1')
    if (change === 'unavailable') output.set(input.corpus.core[0].id, { status: 'malformed' })
    else {
      const row = change === 'repeat' ? input.corpus.repeats[0] : input.corpus.diagnostics[0]
      output.get(row.id).criteria[0].awarded = !output.get(row.id).criteria[0].awarded
    }
    assert.equal(buildReport(input).consistencyClaim, 'unavailable', change)
  }
})

test('B1 anchors reject non-integer clocks and invalid window boundaries', () => {
  const row = { id: 'clock', flow: 'v2_today', horizon: 7, submittedAt: 10, acceptedAt: 10, windowStart: 0, windowEnd: 20,
    coldCase: 'cold', delayedCase: 'delayed', sourceAvailable: true, novel: true, exposedBeforeAcceptance: false, assisted: false,
    pinsMatch: true, scorePercent: 100 }
  const anchor = row => anchorReport({ version: 'learn-v2.synthetic-anchor-checks.v1', evidenceStatus: 'synthetic_contract_only', canvasAdmitted: false, rows: [row] })
  assert.equal(anchor(row).byFlowHorizon['v2_today/day7'].valid, 1)
  for (const field of ['submittedAt', 'acceptedAt', 'windowStart', 'windowEnd']) for (const value of [undefined, NaN, Infinity, -1, 1.5, '10']) {
    assert.equal(anchor({ ...row, [field]: value }).byFlowHorizon['v2_today/day7'].invalid, 1)
  }
  assert.equal(anchor({ ...row, windowStart: 20, windowEnd: 0 }).byFlowHorizon['v2_today/day7'].invalid, 1)
  assert.equal(anchor({ ...row, submittedAt: 10.5, acceptedAt: 10.5 }).byFlowHorizon['v2_today/day7'].invalid, 1)
  assert.equal(anchor({ ...row, submittedAt: null, windowStart: 20, windowEnd: 0 }).byFlowHorizon['v2_today/day7'].invalid, 1)
})

test('B1 CLI executes through a symlink instead of silently succeeding', t => {
  const directory = mkdtempSync(join(tmpdir(), 'budds-b1-symlink-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const link = join(directory, 'harness.mjs')
  symlinkSync(join(ROOT, 'scripts/learn-v2-scorer-harness.mjs'), link)
  const result = spawnSync(process.execPath, ['--import', join(ROOT, 'tests/fixtures/learn-v2-scorer-harness/network-deny.mjs'), link], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Scorer harness blocked/)
})
