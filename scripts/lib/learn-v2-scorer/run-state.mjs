import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { hash, unseal, exists, implementationPins, outputDirectory, FIXTURES, exactKeys, readJson } from './artifacts.mjs'
import { corpusInputs, bindInventory, runPins, schedule, LIMITS } from './contract.mjs'
import { fitThresholds } from './report.mjs'
import { requestFor, baselineExecution, reconcileBaselineExecution, GRADER_PROMPT, GRADER_SCHEMA, parseIndependent } from './adapters.mjs'

const int = value => Number.isSafeInteger(value) && value >= 0
export const artifactName = (id, type) => `${id}.${type}.json`
export const reconciliationName = (id, index) => artifactName(id, index ? `reconciled-${index}` : 'reconciled')

export function validateFixture(fixture) {
  exactKeys(fixture, ['version', 'default', 'reservationMicroUsd', 'outcomes'])
  assert.equal(fixture.version, 'learn-v2.fixture-transport.v1')
  assert.ok(['valid', 'abstained', 'refused', 'truncated', 'malformed', 'mismatched', 'coverage', 'budget_exhausted', 'ambiguous', 'disagree', 'deadline'].includes(fixture.default))
  assert.ok(int(fixture.reservationMicroUsd) && fixture.reservationMicroUsd > 0)
  for (const [role, outcomes] of Object.entries(fixture.outcomes)) {
    assert.ok(['baseline', 'claude', 'gemini'].includes(role) && Array.isArray(outcomes) && outcomes.length <= 256)
    for (const value of outcomes) validateFixture({ ...fixture, default: value, outcomes: {} })
  }
}

export function liveOutcome(result) {
  if (result.status === 'not_dispatched') return 'not_dispatched'
  if (['ambiguous', 'outcome_unknown', 'identity_unavailable', 'identity_mismatch', 'upstream_mismatch', 'unexpected_routing', 'nonterminal_output', 'lease_expired'].includes(result.status)) return 'still_unknown'
  return result.status === 'valid' ? 'resolved' : 'failed'
}

export function metadataOutcome(result) {
  const execution = result?.execution
  const metadata = execution?.metadata
  if (!metadata || execution.receipt.observedIdentity.status !== 'verified' || result.status === 'upstream_mismatch'
    || metadata.generationId !== execution.terminal.generationId || metadata.returnedModel === null || metadata.servingProvider === null) return 'still_unknown'
  if (metadata.cancelled === true || ['content_filter', 'length', 'error'].includes(metadata.finishReason)) return 'failed'
  return result.status === 'valid' && metadata.finishReason === 'stop' && metadata.cancelled === false ? 'resolved' : 'still_unknown'
}

export function assertCurrent(pins) {
  assert.deepEqual(implementationPins(), pins.implementation, 'Run pins are stale or changed')
  for (const [name, digest] of Object.entries(pins.corpusHashes)) {
    assert.equal(hash(readFileSync(join(FIXTURES, `${name}.v1.json`))), digest, 'Corpus/manifest pin changed')
  }
}

export async function openRun(path) {
  const directory = outputDirectory(path)
  const raw = readJson(join(directory, 'manifest.json'))
  const manifest = unseal(directory, 'manifest.json', 'manifest', raw.pinsDigest)
  const pins = manifest.payload
  assert.equal(hash(pins), manifest.pinsDigest, 'Incomplete run pins')
  assertCurrent(pins)
  const corpus = await corpusInputs()
  const { registry, bindings } = await bindInventory(pins.inventory, pins.mode)
  assert.deepEqual(bindings, pins.bindings, 'Frozen binding changed')
  // Rebuild the complete pin set, not a caller-selected subset of fields.
  const fresh = runPins({ ...pins, corpus, bindings })
  fresh.adapters = fresh.adapters.filter(adapter => adapter.configuration === bindings.find(binding => binding.binding.configurationId === pins.selectedConfiguration)?.binding.configurationDigest)
  Object.assign(fresh, { selectedConfiguration: pins.selectedConfiguration, priceAccessDate: pins.priceAccessDate,
    components: { cli: 'learn-v2.scorer-cli.v1', parser: 'learn-v2.independent-parser.v1', promptVersion: 'learn-v2.independent-prompt.v1',
      promptDigest: hash(GRADER_PROMPT), schemaVersion: 'learn-v2.independent-schema.v1', schemaDigest: hash(GRADER_SCHEMA) } })
  assert.deepEqual(fresh, pins, 'Incomplete or altered manifest pins')
  if (pins.mode === 'offline') validateFixture(pins.fixture)
  const plan = schedule(corpus.corpus, corpus.sources, pins.seed, pins.adapters)
  const results = new Map(pins.adapters.map(adapter => [adapter.id, new Map()]))
  const state = { directory, pins, pinsDigest: manifest.pinsDigest, registry, corpus, plan, results,
    intents: new Map(), terminals: new Map(), observations: new Map(), metadataIntents: new Map(), reconciliations: new Map(), notDispatched: new Map(),
    verifiedRecords: new Map(), reconciliationNames: new Map(), metadataObservations: new Map(),
    artifacts: [], fitDigests: [], reserved: 0, dispatchCounts: new Map() }
  const names = readdirSync(directory)
  const allowed = new Set(['manifest.json', 'thresholds.json', '.run.lock'])
  for (const item of plan) {
    for (const kind of ['intent', 'terminal']) allowed.add(artifactName(item.blind.id, kind))
    const history = names.filter(name => name === reconciliationName(item.blind.id, 0)
      || new RegExp(`^${item.blind.id}\\.reconciled-[1-9][0-9]*\\.json$`).test(name))
      .sort((a, b) => (Number(a.match(/reconciled-(\d+)/)?.[1]) || 0) - (Number(b.match(/reconciled-(\d+)/)?.[1]) || 0))
    if (pins.mode === 'live') {
      for (const kind of ['observation', 'metadata-intent', 'metadata-observation', 'not-dispatched']) allowed.add(artifactName(item.blind.id, kind))
      for (const name of history) allowed.add(name)
    }
    const intentName = artifactName(item.blind.id, 'intent')
    const terminalName = artifactName(item.blind.id, 'terminal')
    if (!exists(join(directory, intentName))) {
      for (const kind of ['terminal', 'observation', 'metadata-intent', 'metadata-observation', 'not-dispatched']) assert.ok(!exists(join(directory, artifactName(item.blind.id, kind))), 'Orphan dispatch artifact')
      assert.equal(history.length, 0, 'Orphan reconciliation history')
      continue
    }
    const intent = unseal(directory, intentName, 'dispatch_intent', state.pinsDigest)
    verifyIntent(state, item, intent.payload)
    state.intents.set(item.blind.id, intent)
    const cancellationName = artifactName(item.blind.id, 'not-dispatched')
    if (exists(join(directory, cancellationName))) {
      const cancellation = unseal(directory, cancellationName, 'dispatch_not_sent', state.pinsDigest)
      exactKeys(cancellation.payload, ['intentDigest', 'checkedAt', 'reason'])
      assert.equal(cancellation.payload.intentDigest, intent.digest)
      assert.equal(cancellation.payload.reason, 'lease_expired_before_transport')
      assert.ok(pins.mode === 'live' && intent.payload.dispatched && int(cancellation.payload.checkedAt)
        && cancellation.payload.checkedAt >= intent.payload.deadline, 'Invalid not-dispatched lease record')
      for (const kind of ['observation', 'metadata-intent', 'metadata-observation']) assert.ok(!exists(join(directory, artifactName(item.blind.id, kind))), 'Not-dispatched intent has transport evidence')
      assert.equal(history.length, 0, 'Not-dispatched intent has reconciliation history')
      state.notDispatched.set(item.blind.id, cancellation)
      state.verifiedRecords.set(cancellation.digest, { name: cancellationName, intentDigest: intent.digest, status: 'not_dispatched' })
      state.artifacts.push(cancellation.digest)
      if (item.phase === 'fit') state.fitDigests.push(cancellation.digest)
    }
    const dispatched = intent.payload.dispatched && !state.notDispatched.has(item.blind.id)
    state.reserved += dispatched ? intent.payload.reservationMicroUsd : 0
    const adapter = pins.adapters.find(adapter => adapter.id === item.adapter)
    state.dispatchCounts.set(adapter.model, (state.dispatchCounts.get(adapter.model) ?? 0) + Number(dispatched))
    const observationName = artifactName(item.blind.id, 'observation')
    if (exists(join(directory, observationName))) {
      const observation = unseal(directory, observationName, 'dispatch_observation', state.pinsDigest)
      exactKeys(observation.payload, ['intentDigest', 'raw', 'terminalAt'])
      assert.equal(observation.payload.intentDigest, intent.digest)
      assert.ok(int(observation.payload.terminalAt) && observation.payload.terminalAt >= intent.payload.startedAt)
      state.observations.set(item.blind.id, observation)
    }
    if (exists(join(directory, terminalName))) {
      const terminal = unseal(directory, terminalName, 'sealed_verdict', state.pinsDigest)
      exactKeys(terminal.payload, ['intentDigest', 'raw', 'terminalAt', 'result'])
      assert.equal(terminal.payload.intentDigest, intent.digest)
      if (pins.mode === 'live' && dispatched) assert.deepEqual(state.observations.get(item.blind.id)?.payload,
        { intentDigest: intent.digest, raw: terminal.payload.raw, terminalAt: terminal.payload.terminalAt }, 'Terminal differs from saved observation')
      const reproduced = await evaluate(state, item, intent.payload, terminal.payload.raw, terminal.payload.terminalAt)
      assert.deepEqual(reproduced, terminal.payload.result, 'Sealed verdict replay changed')
      state.verifiedRecords.set(terminal.digest, { name: terminalName, intentDigest: intent.digest, status: liveOutcome(reproduced) })
      recordTerminal(state, item, terminal)
    }
    await openReconciliation(state, item, intent, history)
  }
  for (const name of readdirSync(directory)) {
    if (/^report-[a-f0-9]{24}\.json$/.test(name)) continue
    assert.ok(allowed.has(name), `Unexpected artifact or interrupted write requires reconciliation: ${name}`)
  }
  assert.ok(int(state.reserved) && state.reserved <= pins.budgetMicroUsd, 'Reservation ledger exceeds frozen cap')
  for (const count of state.dispatchCounts.values()) assert.ok(count <= 256, 'Dispatch ceiling exceeded')
  if (exists(join(directory, 'thresholds.json'))) {
    state.thresholds = unseal(directory, 'thresholds.json', 'frozen_thresholds', state.pinsDigest)
    assert.deepEqual(state.thresholds.payload, fitThresholds(corpus.corpus, pins.adapters, results, state.fitDigests), 'Fit-only threshold seal changed')
  }
  for (const item of plan.filter(item => item.phase === 'heldout' && state.intents.has(item.blind.id))) {
    assert.ok(state.thresholds, 'Held-out dispatch occurred before threshold freeze')
    assert.equal(state.intents.get(item.blind.id).payload.thresholdDigest, state.thresholds.digest)
  }
  return state
}

export function verifyIntent(state, item, intent) {
  exactKeys(intent, ['id', 'adapter', 'request', 'requestDigest', 'startedAt', 'deadline', 'responseDigest', 'reservationMicroUsd', 'dispatched', 'thresholdDigest', 'approval'])
  const adapter = state.pins.adapters.find(adapter => adapter.id === item.adapter)
  assert.equal(intent.id, item.blind.id)
  assert.equal(intent.adapter, item.adapter)
  assert.deepEqual(intent.request, requestFor(adapter, item.blind), 'Checkpoint request pins changed')
  assert.equal(intent.requestDigest, hash(intent.request))
  assert.ok(int(intent.startedAt) && int(intent.reservationMicroUsd) && typeof intent.dispatched === 'boolean')
  assert.ok(intent.dispatched ? intent.reservationMicroUsd > 0 : intent.reservationMicroUsd === 0)
  if (state.pins.mode === 'offline') {
    assert.equal(intent.startedAt, state.pins.clock)
    assert.equal(intent.approval, null)
  }
  assert.equal(intent.deadline, intent.startedAt + LIMITS.timeoutMs)
  assert.ok(Buffer.byteLength(intent.request.body) <= LIMITS.maxRequestBytes)
  assert.equal(intent.responseDigest, hash(item.blind.scoringInput.learnerResponse))
}

export async function evaluate(state, item, intent, raw, terminalAt) {
  const adapter = state.pins.adapters.find(adapter => adapter.id === item.adapter)
  assert.ok(int(terminalAt) && terminalAt >= intent.startedAt)
  const cancellation = state.notDispatched?.get(item.blind.id)
  if (cancellation) {
    assert.equal(terminalAt, cancellation.payload.checkedAt)
    assert.deepEqual(raw, { failure: 'not_dispatched' })
    return { status: 'not_dispatched', scorePercent: null, criteria: null, identity: null, usage: null,
      weights: item.blind.scoringInput.rubric.criteria.map(row => row.weightPercent) }
  }
  let result
  if (!intent.dispatched) result = { status: 'budget_exhausted', scorePercent: null, criteria: null, identity: null, usage: null }
  else if (adapter.role === 'baseline') {
    const saved = state.pins.bindings.find(binding => binding.binding.configurationDigest === adapter.configuration)
    result = await baselineExecution({ adapter, blind: item.blind, saved, registry: state.registry, startedAt: intent.startedAt, terminalAt, raw })
  }
  else result = parseIndependent(adapter, item.blind, raw)
  if (terminalAt >= intent.deadline) result = { ...result, status: 'ambiguous', scorePercent: null, criteria: null }
  return { ...result, weights: item.blind.scoringInput.rubric.criteria.map(row => row.weightPercent) }
}

export async function reconcileObservation(state, item, intent, observation, lookup, clock) {
  const adapter = state.pins.adapters.find(adapter => adapter.id === item.adapter)
  const original = await evaluate(state, item, intent.payload, observation.payload.raw, observation.payload.terminalAt)
  const saved = state.pins.bindings.find(binding => binding.binding.configurationDigest === adapter.configuration)
  const result = await reconcileBaselineExecution({ adapter, blind: item.blind, saved, registry: state.registry,
    startedAt: intent.payload.startedAt, raw: observation.payload.raw, execution: original.execution, lookup, clock })
  return { ...result, weights: original.weights }
}

export async function replayMetadata(state, item, intent, observation, lookup, saved) {
  if (!saved || saved.payload.observedAt >= lookup.payload.deadline) return null
  let lookedUp = false
  return reconcileObservation(state, item, intent, observation, async generationId => {
    assert.equal(generationId, lookup.payload.generationId)
    lookedUp = true
    if (saved.payload.metadata === null) throw new Error('Saved metadata unavailable')
    return saved.payload.metadata
  }, () => lookedUp ? saved.payload.observedAt : lookup.payload.startedAt)
}

async function openReconciliation(state, item, intent, history) {
  const lookupName = artifactName(item.blind.id, 'metadata-intent')
  const observation = state.observations.get(item.blind.id)
  if (exists(join(state.directory, lookupName))) {
    const lookup = unseal(state.directory, lookupName, 'metadata_lookup_intent', state.pinsDigest)
    exactKeys(lookup.payload, ['intentDigest', 'generationId', 'startedAt', 'deadline'])
    assert.equal(lookup.payload.intentDigest, intent.digest)
    assert.equal(lookup.payload.generationId, observation?.payload.raw.id)
    assert.ok(typeof lookup.payload.generationId === 'string' && lookup.payload.generationId.length > 0)
    assert.ok(int(lookup.payload.startedAt) && lookup.payload.startedAt >= intent.payload.startedAt && lookup.payload.startedAt < intent.payload.deadline)
    assert.equal(lookup.payload.deadline, Math.min(lookup.payload.startedAt + 10_000, intent.payload.deadline))
    state.metadataIntents.set(item.blind.id, lookup)
  }
  const lookup = state.metadataIntents.get(item.blind.id)
  const metadataName = artifactName(item.blind.id, 'metadata-observation')
  if (exists(join(state.directory, metadataName))) {
    assert.ok(lookup && observation, 'Saved metadata requires its lookup intent and observation')
    const saved = unseal(state.directory, metadataName, 'metadata_observation', state.pinsDigest)
    exactKeys(saved.payload, ['lookupDigest', 'metadata', 'observedAt'])
    assert.equal(saved.payload.lookupDigest, lookup.digest)
    assert.ok(int(saved.payload.observedAt) && saved.payload.observedAt >= lookup.payload.startedAt)
    state.metadataObservations.set(item.blind.id, saved)
  }
  const saved = state.metadataObservations.get(item.blind.id)
  let previous = null
  for (const [index, name] of history.entries()) {
    assert.equal(name, reconciliationName(item.blind.id, index), 'Reconciliation history is incomplete')
    const record = unseal(state.directory, name, 'reconciled_verdict', state.pinsDigest)
    const payload = record.payload
    exactKeys(payload, ['intentDigest', 'observationDigest', 'lookupDigest', 'metadataDigest', 'previousDigest', 'reconciledAt', 'status', 'result'])
    assert.equal(payload.intentDigest, intent.digest)
    assert.equal(payload.previousDigest, previous?.digest ?? null, 'Reconciliation history changed')
    if (previous) assert.equal(previous.payload.status, 'still_unknown', 'A known reconciliation cannot be superseded')
    // Unknown attempts retain the evidence available then. New evidence can be
    // added later without rewriting those attempts or granting another lookup.
    if (payload.observationDigest !== null) assert.equal(payload.observationDigest, observation?.digest)
    if (payload.lookupDigest !== null) assert.equal(payload.lookupDigest, lookup?.digest)
    if (payload.metadataDigest !== null) assert.equal(payload.metadataDigest, saved?.digest)
    assert.ok(int(payload.reconciledAt) && payload.reconciledAt >= (previous?.payload.reconciledAt ?? intent.payload.startedAt))
    let reproduced = null
    if (payload.metadataDigest !== null) {
      assert.ok(payload.lookupDigest && payload.observationDigest)
      reproduced = await replayMetadata(state, item, intent, observation, lookup, saved)
    }
    assert.deepEqual(reproduced, payload.result, 'Reconciled verdict replay changed')
    const status = metadataOutcome(reproduced)
    assert.equal(payload.status, status, 'Reconciled status differs from replay')
    state.verifiedRecords.set(record.digest, { name, intentDigest: intent.digest, status })
    recordReconciliation(state, item, record, name)
    previous = record
  }
}

export function recordReconciliation(state, item, record, name) {
  state.reconciliations.set(item.blind.id, record)
  state.reconciliationNames.set(record.digest, name)
  if (record.payload.result && liveOutcome(state.terminals.get(item.blind.id)?.payload.result ?? { status: 'ambiguous' }) === 'still_unknown') {
    state.results.get(item.adapter).set(item.rowId, record.payload.result)
  }
  state.artifacts.push(record.digest)
  if (item.phase === 'fit') state.fitDigests.push(record.digest)
}

export function recordTerminal(state, item, terminal) {
  state.terminals.set(item.blind.id, terminal)
  state.results.get(item.adapter).set(item.rowId, terminal.payload.result)
  state.artifacts.push(terminal.digest)
  if (item.phase === 'fit') state.fitDigests.push(terminal.digest)
}
