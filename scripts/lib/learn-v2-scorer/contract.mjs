import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateCorpus } from '../../learn-v2-scorer-corpus.mjs'
import { FIXTURES, VERSION, POLICY, canonical, hash, readJson, exactKeys, implementationPins } from './artifacts.mjs'
import { sealLearnScorerConfiguration, createLearnScorerRegistry } from '../../../convex/lib/learnV2ScorerConfig.ts'
import { buildBaselineMasteryScoringPayload } from '../../../server/utils/learn-v2-mastery-scorer.ts'
import { adapterRequestDigest } from './adapters.mjs'

export const ADAPTER_PINS = {
  baseline: { version: 'baseline-service.v1', provider: 'openrouter-via-cloudflare-ai-gateway', api: 'openrouter.chat-completions.v1',
    endpoint: 'existing_gateway_configuration', settings: { temperature: 0, maxOutputTokens: 1200, attempts: 1, fallback: false } },
  claude: { version: 'direct-claude.v1', provider: 'anthropic', family: 'claude', model: 'claude-sonnet-5-5',
    endpoint: 'https://api.anthropic.com/v1/messages', api: '2026-10-21', snapshotAssurance: 'documented_snapshot',
    settings: { thinking: 'adaptive', effort: 'high', maxOutputTokens: 2048, sampling: 'omitted', tools: false, cache: false } },
  gemini: { version: 'direct-gemini.v1', provider: 'google', family: 'gemini', model: 'gemini-3.6-flash',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/interactions', api: '2026-05-20', snapshotAssurance: 'unknown_immutable_weights',
    settings: { thinking: 'medium', maxOutputTokens: 2048, thoughtSummaries: false, store: false, tools: false, previousInteraction: false } },
}
export const LIMITS = { dispatchesPerModelOrConfiguration: 256, concurrency: 1, timeoutMs: 90_000,
  maxRequestBytes: 48_000, maxResponseBytes: 32_000, maxInputTokens: 4096, retry: false, fallback: false, continuation: false }
export const THRESHOLD_POLICY = { version: 'fit-attainable-threshold.v1', baseline: 80, falsePassAlarm: 0.05, falseBlockAlarm: 0.10,
  selection: 'least_restrictive_attainable_meeting_both_alarms', status: 'provisional', promotion: 'forbidden' }

export async function corpusInputs() {
  const rebuilt = await generateCorpus(FIXTURES)
  const corpus = readJson(join(FIXTURES, 'corpus.v1.json'))
  const manifest = readJson(join(FIXTURES, 'manifest.v1.json'))
  assert.deepEqual(corpus, rebuilt.corpus, 'Frozen corpus changed')
  assert.deepEqual(manifest, rebuilt.manifest, 'Frozen corpus manifest changed')
  return { ...rebuilt, corpus, manifest,
    hashes: Object.fromEntries(['sources', 'splits', 'corpus', 'manifest'].map(name => [name, hash(readFileSync(join(FIXTURES, `${name}.v1.json`)))])) }
}

export async function bindInventory(inventory, mode) {
  exactKeys(inventory, ['version', 'scope', 'epoch', 'configurations'])
  assert.equal(inventory.version, 'learn-v2.harness-inventory.v1')
  assert.equal(inventory.scope, mode === 'offline' ? 'synthetic_only' : 'reviewed_published_inventory')
  assert.ok(inventory.configurations.length >= 1 && inventory.configurations.length <= 32)
  const configurations = []
  const models = new Set()
  for (const entry of inventory.configurations) {
    exactKeys(entry, ['definition', 'expectedDigest', 'upstream', 'transportEndpoint', 'inventoryEvidence'])
    const definition = entry.definition
    assert.equal(definition.kind, 'legacy_baseline', 'Baseline must preserve legacy automatic routing')
    const identity = definition.identity
    assert.ok(identity.family && identity.canonicalModel && identity.mappingVersion, 'Unknown baseline family/alias blocks the run')
    assert.ok(!['unknown', 'unverified', 'auto'].includes(identity.family.toLowerCase()), 'Unknown baseline family blocks the run')
    // Require canonical family names, never a caller-invented model-family alias.
    assert.ok(['openai-gpt', 'claude', 'gemini', 'llama', 'mistral', 'deepseek', 'qwen'].includes(identity.family), 'Unreviewed family mapping')
    const familyOf = model => {
      const patterns = [['openai-gpt', /^openai\/gpt-/i], ['claude', /^(?:anthropic\/)?claude-/i], ['gemini', /^(?:google\/)?gemini-/i],
        ['llama', /^meta-llama\/llama-/i], ['mistral', /^mistralai\//i], ['deepseek', /^deepseek\//i], ['qwen', /^qwen\//i]]
      return patterns.find(([, pattern]) => pattern.test(model))?.[0] ?? null
    }
    assert.equal(familyOf(identity.canonicalModel), identity.family, 'Canonical model family is unknown or conflicting')
    assert.equal(familyOf(definition.requestedModel), identity.family, 'Requested model family is unknown or conflicting')
    for (const model of identity.verifiedReturnedModels) assert.equal(familyOf(model), identity.family, 'Returned alias family is unknown or conflicting')
    for (const pin of [ADAPTER_PINS.claude, ADAPTER_PINS.gemini]) assert.notEqual(identity.family, pin.family, 'Independent grader overlaps a bound baseline family')
    assert.ok(entry.upstream && entry.inventoryEvidence, 'Unknown baseline upstream/inventory blocks the run')
    assert.ok(!['unknown', 'unverified', 'auto', 'legacy_auto'].includes(entry.upstream.toLowerCase()), 'Unknown upstream blocks the run')
    assert.match(entry.transportEndpoint, /^https:\/\/gateway\.ai\.cloudflare\.com\/v1\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/openrouter\/v1\/chat\/completions$/, 'Exact gateway transport pin required')
    assert.ok(!models.has(definition.requestedModel), 'Duplicate effective baseline model')
    models.add(definition.requestedModel)
    if (mode === 'live') assert.ok(!/\b(?:fixture|synthetic|test)\b/i.test(canonical(entry)), 'Fixture inventory is forbidden live')
    const saved = await sealLearnScorerConfiguration(definition)
    if (mode === 'live' || entry.expectedDigest !== null) assert.equal(entry.expectedDigest, saved.binding.configurationDigest, 'Unreviewed baseline configuration digest')
    configurations.push({ definition, expectedDigest: saved.binding.configurationDigest })
  }
  const registry = await createLearnScorerRegistry({ epoch: inventory.epoch, configurations,
    legacyAllowlist: configurations.map(row => row.definition.configurationId), prospectiveConfigurationId: null })
  const bindings = []
  for (const entry of inventory.configurations) {
    const saved = await sealLearnScorerConfiguration(entry.definition)
    await registry.verifySaved(saved)
    bindings.push({ ...saved, upstream: entry.upstream, transportEndpoint: entry.transportEndpoint })
  }
  return { registry, bindings }
}

export function blindRow(row, sources, seed, adapter) {
  const packet = sources.packets.find(packet => packet.id === row.packetId)
  const form = packet.forms.find(form => form.id === row.formId)
  const id = `item_${hash(`${seed}/${adapter}/${row.id}`).slice(7, 39)}`
  const atoms = packet.atoms.map((atom, index) => ({
    id: `k${index + 1}`, sourceClaimId: `c${index + 1}`, description: atom.description,
    kind: atom.kind, query: atom.query, ...(atom.unit ? { unit: atom.unit, unitAliases: atom.unitAliases } : {}),
  }))
  const key = { version: packet.keyVersion, atoms }
  const source = { context: packet.source.context, records: packet.source.records,
    claims: Object.fromEntries(atoms.map(atom => [atom.sourceClaimId, { description: atom.description, kind: atom.kind, query: atom.query }])) }
  const rubric = { version: packet.rubricVersion,
    criteria: packet.atoms.map((atom, index) => ({ key: `k${index + 1}`, description: atom.description, weightPercent: atom.weight })) }
  // No source locator, packet/form/class/split IDs, essential flags, proofs,
  // expected response vectors, timestamps or other grades enter this projection.
  const scoringInput = { rubric, challenge: form.question,
    evidence: [{ alias: id, claim: 'Use only this public synthetic source and executable answer key.', excerpt: canonical({ source, key }) }],
    learnerResponse: row.response }
  return { id, scoringInput, payload: buildBaselineMasteryScoringPayload(scoringInput) }
}

export function schedule(corpus, sources, seed, adapters) {
  const rows = [...corpus.core, ...corpus.controls, ...corpus.repeats, ...corpus.diagnostics]
  return adapters.flatMap(adapter => rows.map(row => ({ adapter: adapter.id, rowId: row.id, phase: row.split, canary: row.purpose === 'canary',
    blind: blindRow(row, sources, seed, adapter.id) }))).sort((a, b) => {
    if (a.canary !== b.canary) return a.canary ? -1 : 1
    if (a.phase !== b.phase) return a.phase === 'fit' ? -1 : 1
    const x = hash(`${seed}/shuffle/${a.adapter}/${a.rowId}`)
    const y = hash(`${seed}/shuffle/${b.adapter}/${b.rowId}`)
    return x < y ? -1 : x > y ? 1 : 0
  })
}

export function runPins({ mode, inventory, bindings, corpus, fixture, clock, seed, budgetMicroUsd, anchors }) {
  assert.ok(Number.isSafeInteger(clock) && clock > 0, 'Explicit run clock required')
  assert.ok(typeof seed === 'string' && seed.length >= 16, 'Shuffle seed required')
  assert.ok(Number.isSafeInteger(budgetMicroUsd) && budgetMicroUsd >= 0, 'Finite budget required')
  const adapters = bindings.flatMap((binding, index) => ['baseline', 'claude', 'gemini'].map(role => ({
    id: `${role}_${index + 1}`, role, configuration: binding.binding.configurationDigest,
    model: role === 'baseline' ? binding.binding.requestedModel : ADAPTER_PINS[role].model,
    upstream: role === 'baseline' ? binding.upstream : ADAPTER_PINS[role].provider,
    ...ADAPTER_PINS[role], ...(role === 'baseline' ? { endpoint: binding.transportEndpoint } : {}),
  })))
  for (const adapter of adapters) adapter.requestPinsDigest = adapterRequestDigest(adapter)
  return { version: VERSION, mode, evidenceStatus: mode === 'offline' ? 'offline_contract_only' : 'unvalidated_live_capture',
    payloadPolicyVersion: POLICY, implementation: implementationPins(), clock, seed, budgetMicroUsd,
    corpusHashes: corpus.hashes, corpusManifest: corpus.manifest, inventory, bindings, adapters,
    fixture, anchors, limits: LIMITS, thresholdPolicy: THRESHOLD_POLICY }
}
