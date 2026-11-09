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
  for (const result of results.get('baseline_1').values()) result.identity = { servingProvider: 'observed' }
  const pins = { mode: 'live', evidenceStatus: 'synthetic_contract_only', adapters,
    anchors: { version: 'learn-v2.synthetic-anchor-checks.v1', evidenceStatus: 'synthetic_contract_only', canvasAdmitted: false, rows: [] } }
  const schedule = adapters.flatMap(adapter => rows.map(row => ({ adapter: adapter.id, rowId: row.id })))
  return { pins, pinsDigest: hash('report-pins'), corpus: data.corpus, sources: data.sources, schedule, results,
    thresholds: fitThresholds(data.corpus, adapters, results, []), artifacts: [], reservations: {} }
}

test('B2 perfect graders cannot claim consistency while the frozen 80 comparator has source-proven counterexamples', async () => {
  const input = reportInputs(await corpus())
  const report = buildReport(input)
  assert.equal(report.consistencyClaim, 'unavailable')
  assert.equal(report.complete, true)
  assert.deepEqual(report.consistencyClaimBlockers, ['threshold_counterexample'])
  assert.deepEqual(report.quarantine.map(row => [row.adapter, row.reason]), ['baseline_1', 'claude_1', 'gemini_1'].map(id => [id, 'threshold_counterexample']))
  assert.deepEqual(report.thresholdCounterexamples, { threshold: 80, core: { falsePass: 24, falseBlock: 0 }, controls: { falsePass: 0, falseBlock: 0 }, diagnostics: { falsePass: 0, falseBlock: 0 } })
  assert.deepEqual(report.graderResults, { baseline_1: 'no_errors_observed', claude_1: 'no_errors_observed', gemini_1: 'no_errors_observed' })
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

function withoutCounterexamples(data) {
  const corpus = structuredClone(data.corpus)
  for (const rows of [corpus.core, corpus.controls, corpus.repeats, corpus.diagnostics]) for (const row of rows) {
    const { atoms } = data.sources.packets.find(packet => packet.id === row.packetId)
    row.expected.referencePass = atoms.reduce((sum, atom) => sum + (row.expected.criteria[atom.id] ? atom.weight : 0), 0) >= 80
  }
  return { ...data, corpus }
}

function flipFirstCriterion(result) {
  const index = result.criteria.findIndex(row => row.awarded)
  result.criteria[index].awarded = false
  result.scorePercent -= result.weights[index]
}

test('B2 grader-level results separate perfect, erroneous, divergent and unavailable graders', async () => {
  const data = await corpus()
  for (const [counterexamples, source] of [[true, data], [false, withoutCounterexamples(data)]]) {
    const perfect = buildReport(reportInputs(source))
    assert.equal(perfect.graderResults.claude_1, 'no_errors_observed')
    assert.equal(perfect.configurations.claude_1.graderResult.criterionErrors, 0)
    assert.equal(perfect.consistencyClaim, counterexamples ? 'unavailable' : 'provisional_consistency_pass')
    assert.deepEqual(perfect.consistencyClaimBlockers, counterexamples ? ['threshold_counterexample'] : [])
    assert.ok(!perfect.quarantine.some(row => row.reason === 'source_or_repeat_divergence'))
    for (const [change, status, reason, field] of [['core', 'errors_observed', 'source_or_repeat_divergence', 'criterionErrors'],
      ['controls', 'errors_observed', 'source_or_repeat_divergence', 'criterionErrors'], ['diagnostics', 'errors_observed', 'source_or_repeat_divergence', 'criterionErrors'],
      ['repeats', 'errors_observed', 'source_or_repeat_divergence', 'repeatDisagreements'], ['unavailable', 'unavailable_evidence', 'unavailable_evidence', 'unavailable']]) {
      const input = reportInputs(source)
      const output = input.results.get('claude_1')
      if (change === 'unavailable') output.set(source.corpus.core[0].id, { status: 'malformed' })
      else flipFirstCriterion(output.get(source.corpus[change].find(row => Object.values(row.expected.criteria).includes(true)).id))
      const report = buildReport(input)
      assert.equal(report.graderResults.claude_1, status, change)
      assert.equal(report.graderResults.gemini_1, 'no_errors_observed', change)
      assert.equal(report.configurations.claude_1.graderResult[field], 1, change)
      assert.equal(report.consistencyClaim, 'unavailable', change)
      const adapterReasons = id => report.quarantine.filter(row => row.adapter === id).map(row => row.reason)
      assert.deepEqual(adapterReasons('claude_1'), [reason, ...(counterexamples ? ['threshold_counterexample'] : [])], change)
      assert.deepEqual(adapterReasons('gemini_1'), counterexamples ? ['threshold_counterexample'] : [], change)
    }
  }
})

test('B2 a report with both real errors and unavailable evidence names each blocker', async () => {
  const data = withoutCounterexamples(await corpus())
  const input = reportInputs(data)
  const output = input.results.get('claude_1')
  flipFirstCriterion(output.get(data.corpus.core.find(row => Object.values(row.expected.criteria).includes(true)).id))
  output.set(data.corpus.controls[0].id, { status: 'refused' })
  const report = buildReport(input)
  assert.equal(report.graderResults.claude_1, 'errors_observed')
  assert.deepEqual(report.consistencyClaimBlockers, ['source_or_repeat_divergence', 'unavailable_evidence'])
})

test('B2 each counterexample direction and evidence set blocks a perfect grader', async () => {
  const data = withoutCounterexamples(await corpus())
  for (const [set, referencePass, direction] of [['core', true, 'falsePass'], ['core', false, 'falseBlock'], ['controls', true, 'falsePass'],
    ['diagnostics', true, 'falsePass'], ['diagnostics', false, 'falseBlock']]) {
    const source = { ...data, corpus: structuredClone(data.corpus) }
    source.corpus[set].find(row => row.expected.referencePass === referencePass).expected.referencePass = !referencePass
    const report = buildReport(reportInputs(source))
    assert.equal(report.consistencyClaim, 'unavailable', `${set}/${direction}`)
    assert.deepEqual(report.consistencyClaimBlockers, ['threshold_counterexample'], `${set}/${direction}`)
    assert.equal(report.thresholdCounterexamples[set][direction], 1, `${set}/${direction}`)
    assert.equal(report.graderResults.claude_1, 'no_errors_observed', `${set}/${direction}`)
  }
})

test('B2 a grader-induced false pass is not reported as a threshold counterexample', async () => {
  const data = withoutCounterexamples(await corpus())
  const input = reportInputs(data)
  const row = data.corpus.core.find(row => !row.expected.referencePass)
  const result = input.results.get('claude_1').get(row.id)
  for (const criterion of result.criteria) criterion.awarded = true
  result.scorePercent = 100
  const report = buildReport(input)
  assert.equal(report.configurations.claude_1.core.falsePass, 1)
  assert.deepEqual(report.thresholdCounterexamples.core, { falsePass: 0, falseBlock: 0 })
  assert.deepEqual(report.consistencyClaimBlockers, ['source_or_repeat_divergence'])
})

async function servedBaseline(data, inventory, upstreamFor) {
  const definition = { configurationId: 'legacy.upstream.v1', configurationVersion: 'route.v1', kind: 'legacy_baseline', requestedModel: 'openai/gpt-4.1', endpoint: null,
    identity: { mappingVersion: 'route.identity.v1', canonicalModel: 'openai/gpt-4.1', family: 'openai-gpt', snapshotAssurance: 'unknown', verifiedReturnedModels: [] } }
  const saved = await sealLearnScorerConfiguration(definition)
  const registry = await createLearnScorerRegistry({ epoch: 'route.v1', configurations: [{ definition, expectedDigest: saved.binding.configurationDigest }],
    legacyAllowlist: [definition.configurationId], prospectiveConfigurationId: null })
  const input = reportInputs(data)
  const pin = { ...adapter('baseline'), model: definition.requestedModel, upstream: inventory, configuration: saved.binding.configurationDigest }
  input.pins.adapters[0] = pin
  const rows = [...data.corpus.core, ...data.corpus.controls, ...data.corpus.repeats, ...data.corpus.diagnostics]
  const output = new Map()
  for (const [index, row] of rows.entries()) {
    const blind = blindRow(row, data.sources, 'synthetic-upstream-seed', 'baseline_1')
    const raw = fixtureEnvelope({ ...pin, upstream: upstreamFor(index) }, blind, 'valid')
    output.set(row.id, { ...await baselineExecution({ adapter: pin, blind, saved, registry, startedAt: 1000, terminalAt: 1001, raw }),
      weights: blind.scoringInput.rubric.criteria.map(criterion => criterion.weightPercent) })
  }
  input.results.set('baseline_1', output)
  input.thresholds = fitThresholds(data.corpus, input.pins.adapters, input.results, [])
  return { report: buildReport(input), rows, output, configuration: pin.configuration }
}

test('B2 three observed upstreams stay valid, are each named with counts and cannot claim consistency', async () => {
  const data = withoutCounterexamples(await corpus())
  const upstreams = ['Upstream Alpha', 'Upstream Beta', 'Upstream Gamma']
  const { report, rows, output, configuration } = await servedBaseline(data, 'Upstream Alpha', index => upstreams[index % upstreams.length])
  assert.ok(rows.every(row => output.get(row.id).status === 'valid'), 'Automatic routing alone fails no row')
  const baseline = report.configurations.baseline_1
  assert.equal(baseline.inventoryUpstream, 'Upstream Alpha')
  assert.equal(baseline.core.statuses.valid, 224)
  assert.equal(baseline.observedUpstreams.unobserved, 0)
  assert.deepEqual(baseline.observedUpstreams.served.map(row => row.upstream), upstreams)
  assert.deepEqual(baseline.observedUpstreams.served.map(row => row.matchesInventory), [true, false, false])
  assert.deepEqual(baseline.observedUpstreams.served.map(row => row.scheduled), upstreams.map((_, slot) => rows.filter((__, index) => index % 3 === slot).length))
  for (const set of ['core', 'controls', 'repeats', 'diagnostics']) {
    assert.equal(baseline.observedUpstreams.served.reduce((sum, row) => sum + row[set].scheduled, 0), data.corpus[set].length, set)
    assert.equal(baseline.observedUpstreams.served.reduce((sum, row) => sum + row[set].available, 0), data.corpus[set].length, set)
  }
  assert.equal(report.consistencyClaim, 'unavailable')
  assert.deepEqual(report.consistencyClaimBlockers, ['mixed_upstream'])
  assert.deepEqual(report.quarantine, [{ configuration, adapter: 'baseline_1', status: 'quarantined_validation_claim', reason: 'mixed_upstream' }])
  assert.equal(report.configurations.claude_1.observedUpstreams, null)
})

test('B2 one upstream matching the inventory reports as before; one other upstream is blocked accurately', async () => {
  const data = withoutCounterexamples(await corpus())
  const matching = await servedBaseline(data, 'Upstream Alpha', () => 'Upstream Alpha')
  const served = matching.report.configurations.baseline_1.observedUpstreams.served
  assert.deepEqual(served.map(row => [row.upstream, row.matchesInventory, row.scheduled]), [['Upstream Alpha', true, 256]])
  assert.equal(matching.report.consistencyClaim, 'provisional_consistency_pass')
  assert.deepEqual(matching.report.quarantine, [])
  const moved = await servedBaseline(data, 'Upstream Alpha', () => 'Upstream Beta')
  assert.ok(moved.rows.every(row => moved.output.get(row.id).status === 'valid'))
  assert.deepEqual(moved.report.configurations.baseline_1.observedUpstreams.served.map(row => [row.upstream, row.matchesInventory, row.scheduled]), [['Upstream Beta', false, 256]])
  assert.equal(moved.report.consistencyClaim, 'unavailable')
  assert.deepEqual(moved.report.consistencyClaimBlockers, ['inventory_upstream_mismatch'])
})

test('B2 upstream results exclude rows without an observed upstream, without naming one', async () => {
  const data = withoutCounterexamples(await corpus())
  const { rows, output } = await servedBaseline(data, 'Upstream Alpha', () => 'Upstream Alpha')
  const input = reportInputs(data)
  input.pins.adapters[0].upstream = 'Upstream Alpha'
  input.results.set('baseline_1', output)
  output.set(rows[0].id, { status: 'ambiguous', identity: null })
  output.delete(rows[1].id)
  const report = buildReport(input)
  assert.equal(report.configurations.baseline_1.observedUpstreams.unobserved, 2)
  assert.deepEqual(report.configurations.baseline_1.observedUpstreams.served.map(row => [row.upstream, row.scheduled]), [['Upstream Alpha', 254]])
  assert.deepEqual(report.consistencyClaimBlockers, ['unavailable_evidence'])
})

test('B2 Claude redacted_thinking blocks stay valid beside documented thinking and text only', async () => {
  const data = await corpus()
  const blind = blindRow(data.corpus.core[0], data.sources, 'synthetic-thinking-seed', 'claude_1')
  const raw = fixtureEnvelope(adapter('claude'), blind, 'valid')
  const parsed = content => parseIndependent(adapter('claude'), blind, { ...raw, content }).status
  assert.equal(parsed([{ type: 'redacted_thinking', data: 'opaque' }, ...raw.content]), 'valid')
  assert.equal(parsed([{ type: 'thinking', thinking: 'synthetic', signature: 'opaque' }, { type: 'redacted_thinking', data: 'opaque' }, ...raw.content]), 'valid')
  assert.equal(parsed([{ type: 'redacted_thinking', data: 'opaque' }]), 'malformed')
  assert.equal(parsed([{ type: 'tool_use', id: 'synthetic', name: 'forbidden', input: {} }, ...raw.content]), 'malformed')
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
