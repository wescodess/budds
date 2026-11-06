import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { hash, seal, unseal, exists, implementationPins, exclusiveLock, outputDirectory, FIXTURES, exactKeys, readJson } from './artifacts.mjs'
import { corpusInputs, bindInventory, runPins, schedule, LIMITS } from './contract.mjs'
import { requestFor, fixtureEnvelope, baselineExecution, parseIndependent, liveInfer, GRADER_PROMPT, GRADER_SCHEMA } from './adapters.mjs'
import { buildReport, fitThresholds } from './report.mjs'
import { admitLive } from './live-approval.mjs'

const emptyAnchors = { version: 'learn-v2.synthetic-anchor-checks.v1', evidenceStatus: 'synthetic_contract_only', canvasAdmitted: false, rows: [] }
const int = value => Number.isSafeInteger(value) && value >= 0
const artifactName = (id, type) => `${id}.${type}.json`

function validateFixture(fixture) {
  exactKeys(fixture, ['version', 'default', 'reservationMicroUsd', 'outcomes'])
  assert.equal(fixture.version, 'learn-v2.fixture-transport.v1')
  assert.ok(['valid', 'abstained', 'refused', 'truncated', 'malformed', 'mismatched', 'coverage', 'budget_exhausted', 'ambiguous', 'disagree', 'deadline'].includes(fixture.default))
  assert.ok(int(fixture.reservationMicroUsd) && fixture.reservationMicroUsd > 0)
  for (const [role, outcomes] of Object.entries(fixture.outcomes)) {
    assert.ok(['baseline', 'claude', 'gemini'].includes(role) && Array.isArray(outcomes) && outcomes.length <= 256)
    for (const value of outcomes) validateFixture({ ...fixture, default: value, outcomes: {} })
  }
}

export async function initialize(options) {
  const directory = outputDirectory(options.output)
  assert.ok(!exists(join(directory, 'manifest.json')), 'Run already initialized; use run/replay on the same directory')
  const mode = options.mode ?? 'offline'
  assert.ok(['offline', 'live'].includes(mode))
  const corpus = await corpusInputs()
  const { bindings } = await bindInventory(options.inventory, mode)
  if (mode === 'offline') validateFixture(options.fixture)
  else assert.equal(options.fixture, null, 'Live runs cannot use fixture adapters')
  const pins = runPins({ ...options, mode, bindings, corpus, anchors: options.anchors ?? emptyAnchors })
  const selected = bindings.find(binding => binding.binding.configurationId === options.configuration) ?? (bindings.length === 1 ? bindings[0] : null)
  assert.ok(selected, 'Select exactly one inventoried baseline configuration for each reserved run')
  pins.adapters = pins.adapters.filter(adapter => adapter.configuration === selected.binding.configurationDigest)
  pins.selectedConfiguration = selected.binding.configurationId
  pins.priceAccessDate = options.priceAccessDate
  assert.match(pins.priceAccessDate, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(Number.isFinite(Date.parse(`${pins.priceAccessDate}T00:00:00Z`)))
  pins.components = { cli: 'learn-v2.scorer-cli.v1', parser: 'learn-v2.independent-parser.v1',
    promptVersion: 'learn-v2.independent-prompt.v1', promptDigest: hash(GRADER_PROMPT),
    schemaVersion: 'learn-v2.independent-schema.v1', schemaDigest: hash(GRADER_SCHEMA) }
  const pinsDigest = hash(pins)
  seal(directory, 'manifest.json', 'manifest', pinsDigest, pins)
  return directory
}

function assertCurrent(pins) {
  assert.deepEqual(implementationPins(), pins.implementation, 'Run pins are stale or changed')
  for (const [name, digest] of Object.entries(pins.corpusHashes)) {
    assert.equal(hash(readFileSync(join(FIXTURES, `${name}.v1.json`))), digest, 'Corpus/manifest pin changed')
  }
}

async function openRun(path) {
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
    intents: new Map(), terminals: new Map(), artifacts: [], fitDigests: [], reserved: 0, dispatchCounts: new Map() }
  const allowed = new Set(['manifest.json', 'thresholds.json', '.run.lock'])
  for (const item of plan) {
    for (const kind of ['intent', 'terminal']) allowed.add(artifactName(item.blind.id, kind))
    const intentName = artifactName(item.blind.id, 'intent')
    const terminalName = artifactName(item.blind.id, 'terminal')
    if (!exists(join(directory, intentName))) {
      assert.ok(!exists(join(directory, terminalName)), 'Orphan terminal artifact')
      continue
    }
    const intent = unseal(directory, intentName, 'dispatch_intent', state.pinsDigest)
    verifyIntent(state, item, intent.payload)
    state.intents.set(item.blind.id, intent)
    state.reserved += intent.payload.reservationMicroUsd
    const adapter = pins.adapters.find(adapter => adapter.id === item.adapter)
    state.dispatchCounts.set(adapter.model, (state.dispatchCounts.get(adapter.model) ?? 0) + Number(intent.payload.dispatched))
    if (!exists(join(directory, terminalName))) continue
    const terminal = unseal(directory, terminalName, 'sealed_verdict', state.pinsDigest)
    assert.equal(terminal.payload.intentDigest, intent.digest)
    const reproduced = await evaluate(state, item, intent.payload, terminal.payload.raw, terminal.payload.terminalAt)
    assert.deepEqual(reproduced, terminal.payload.result, 'Sealed verdict replay changed')
    recordTerminal(state, item, terminal)
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

function verifyIntent(state, item, intent) {
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

async function evaluate(state, item, intent, raw, terminalAt) {
  const adapter = state.pins.adapters.find(adapter => adapter.id === item.adapter)
  assert.ok(int(terminalAt) && terminalAt >= intent.startedAt)
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

function recordTerminal(state, item, terminal) {
  state.terminals.set(item.blind.id, terminal)
  state.results.get(item.adapter).set(item.rowId, terminal.payload.result)
  state.artifacts.push(terminal.digest)
  if (item.phase === 'fit') state.fitDigests.push(terminal.digest)
}

function freezeThresholds(state) {
  if (state.thresholds) return
  // All fit slots must have either a sealed outcome or a durable no-dispatch
  // explanation before a threshold can be frozen and held-out work can begin.
  const payload = fitThresholds(state.corpus.corpus, state.pins.adapters, state.results, state.fitDigests)
  state.thresholds = seal(state.directory, 'thresholds.json', 'frozen_thresholds', state.pinsDigest, payload)
}

function stopped(state, adapterId) {
  return state.plan.some(item => item.adapter === adapterId && state.intents.has(item.blind.id)
    && (!state.terminals.has(item.blind.id) || ['ambiguous', 'outcome_unknown'].includes(state.terminals.get(item.blind.id).payload.result.status)))
}

async function dispatch(state, item, options) {
  assertCurrent(state.pins)
  assert.ok(!state.intents.has(item.blind.id), 'Existing intent forbids redispatch; reconcile the original dispatch')
  assert.ok(!stopped(state, item.adapter), 'Ambiguous adapter requires reconciliation, never a retry')
  const adapter = state.pins.adapters.find(adapter => adapter.id === item.adapter)
  const request = requestFor(adapter, item.blind)
  const startedAt = state.pins.mode === 'offline' ? state.pins.clock : Date.now()
  const ordinal = state.plan.filter(previous => previous.adapter === item.adapter && state.intents.has(previous.blind.id)).length
  const outcome = state.pins.mode === 'offline' ? state.pins.fixture.outcomes[adapter.role]?.[ordinal] ?? state.pins.fixture.default : null
  let approval = null
  if (state.pins.mode === 'live') {
    assert.ok(Date.now() - state.pins.clock >= 0 && Date.now() - state.pins.clock < 86_400_000, 'Run clock is stale')
    assert.equal(state.pins.priceAccessDate, new Date().toISOString().slice(0, 10), 'Price access must be refreshed on dispatch day')
    approval = admitLive({ pins: state.pins, pinsDigest: state.pinsDigest, item, request, now: startedAt,
      requestPins: state.plan.map(row => ({ id: row.blind.id, requestDigest: hash(requestFor(state.pins.adapters.find(adapter => adapter.id === row.adapter), row.blind)) })),
      ...options })
  }
  const reservationMicroUsd = approval?.reservationMicroUsd ?? state.pins.fixture.reservationMicroUsd
  const dispatchAllowed = outcome !== 'budget_exhausted' && state.reserved + reservationMicroUsd <= state.pins.budgetMicroUsd
  assert.ok((state.dispatchCounts.get(adapter.model) ?? 0) < LIMITS.dispatchesPerModelOrConfiguration, 'Per-model dispatch ceiling reached')
  const intent = seal(state.directory, artifactName(item.blind.id, 'intent'), 'dispatch_intent', state.pinsDigest, {
    id: item.blind.id, adapter: item.adapter, request, requestDigest: hash(request), startedAt, deadline: startedAt + LIMITS.timeoutMs,
    responseDigest: hash(item.blind.scoringInput.learnerResponse), reservationMicroUsd: dispatchAllowed ? reservationMicroUsd : 0,
    dispatched: dispatchAllowed, thresholdDigest: state.thresholds?.digest ?? null, approval,
  })
  state.intents.set(item.blind.id, intent)
  state.reserved += intent.payload.reservationMicroUsd
  if (dispatchAllowed) state.dispatchCounts.set(adapter.model, (state.dispatchCounts.get(adapter.model) ?? 0) + 1)
  if (options.crashAfterIntent) return false
  let raw = { failure: 'budget_exhausted' }
  let terminalAt = startedAt
  if (dispatchAllowed) {
    if (state.pins.mode === 'offline') {
      raw = fixtureEnvelope(adapter, item.blind, outcome === 'deadline' ? 'valid' : outcome)
      if (outcome === 'deadline') terminalAt = startedAt + LIMITS.timeoutMs
    }
    else {
      const controller = new AbortController()
      let timer
      try {
        // A single global lock surrounds this entire operation, including any
        // provider that ignores AbortSignal. Timeout leaves a durable intent.
        const deadline = new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ failure: 'outcome_unknown' }) }, LIMITS.timeoutMs) })
        const operation = adapter.role === 'baseline'
          ? baselineExecution({ adapter, blind: item.blind, saved: state.pins.bindings.find(binding => binding.binding.configurationDigest === adapter.configuration),
              registry: state.registry, startedAt, infer: request => liveInfer(adapter, intent.payload.request, controller.signal, request) }).then(value => value.raw)
          : liveInfer(adapter, request, controller.signal)
        raw = await Promise.race([operation.catch(() => ({ failure: 'outcome_unknown' })), deadline])
      }
      finally { clearTimeout(timer) }
      terminalAt = Date.now()
    }
  }
  const result = await evaluate(state, item, intent.payload, raw, terminalAt)
  const terminal = seal(state.directory, artifactName(item.blind.id, 'terminal'), 'sealed_verdict', state.pinsDigest,
    { intentDigest: intent.digest, raw, terminalAt, result })
  recordTerminal(state, item, terminal)
  return true
}

function report(state) {
  const thresholds = state.thresholds?.payload ?? { ...fitThresholds(state.corpus.corpus, state.pins.adapters, state.results, state.fitDigests), phase: 'diagnostic_fit_not_frozen' }
  const ambiguous = [...state.intents].filter(([id]) => !state.terminals.has(id) || state.terminals.get(id).payload.result.status === 'ambiguous')
  const payload = buildReport({ pins: state.pins, pinsDigest: state.pinsDigest, corpus: state.corpus.corpus, schedule: state.plan,
    results: state.results, thresholds, artifacts: state.artifacts,
    reservations: { capMicroUsd: state.pins.budgetMicroUsd, retainedMicroUsd: state.reserved,
      ambiguousCount: ambiguous.length, ambiguousReservedMicroUsd: ambiguous.reduce((sum, [, intent]) => sum + intent.payload.reservationMicroUsd, 0),
      policy: 'retain_full_reservations_until_separate_reconciliation_no_automatic_refund',
      dispatchCounts: Object.fromEntries(state.dispatchCounts) } })
  const name = `report-${hash(payload).slice(7, 31)}.json`
  const artifact = seal(state.directory, name, 'report', state.pinsDigest, payload)
  return { report: join(state.directory, name), digest: artifact.digest, evidenceStatus: payload.evidenceStatus,
    complete: payload.complete, dispatched: [...state.dispatchCounts.values()].reduce((sum, count) => sum + count, 0),
    ambiguous: ambiguous.length, realAnchorValidity: payload.realAnchorValidity }
}

export async function runOffline(path, options = {}) {
  const directory = outputDirectory(path)
  return exclusiveLock(directory, '.run.lock', async () => {
    const state = await openRun(directory)
    assert.equal(state.pins.mode, 'offline', 'Use the separately approved single-dispatch command live')
    let count = 0
    for (const item of state.plan) {
      if (item.phase === 'heldout') freezeThresholds(state)
      if (state.intents.has(item.blind.id) || stopped(state, item.adapter)) continue
      const finished = await dispatch(state, item, options)
      count++
      if (!finished || (options.stopAfter && count >= options.stopAfter)) break
    }
    return report(state)
  })
}

export async function dispatchLive(path, id, options) {
  // Fixed across runs and invocations on this machine, with no CLI override.
  // An unresolved provider outcome also keeps a global uncertainty tombstone.
  const global = outputDirectory('/tmp/budds-learn-v2-scorer-live')
  return exclusiveLock(global, '.learn-v2-scorer-global.lock', () => exclusiveLock(outputDirectory(path), '.run.lock', async () => {
    assert.ok(!exists(join(global, 'unresolved.json')), 'Global dispatch outcome requires reconciliation')
    const state = await openRun(path)
    assert.equal(state.pins.mode, 'live')
    const item = state.plan.find(item => item.blind.id === id)
    assert.ok(item, 'Unknown opaque dispatch ID')
    const next = state.plan.find(item => !state.intents.has(item.blind.id) && !stopped(state, item.adapter))
    assert.equal(item, next, 'Single dispatch must follow the frozen blind schedule')
    if (!item.canary) assert.ok(state.plan.filter(row => row.canary).every(row => state.terminals.get(row.blind.id)?.payload.result.status === 'valid'),
      'All three authorized canaries must validate before core live dispatch')
    if (item.phase === 'heldout') freezeThresholds(state)
    // The global lock itself remains after process death. For a normal return
    // with an unknown outcome, retain a separate immutable reconciliation marker.
    await dispatch(state, item, options)
    if (stopped(state, item.adapter)) seal(global, 'unresolved.json', 'global_reconciliation_required', state.pinsDigest,
      { directory: state.directory, id: item.blind.id })
    return report(state)
  }))
}

export async function replay(path, expectedReport) {
  const directory = outputDirectory(path)
  return exclusiveLock(directory, '.run.lock', async () => {
    const state = await openRun(directory)
    const summary = report(state)
    if (expectedReport) assert.equal(summary.report, join(state.directory, expectedReport), 'Exact report replay differs')
    return summary
  })
}

export async function planRun(path) {
  const state = await openRun(path)
  return { pinsDigest: state.pinsDigest, requests: state.plan.map(item => ({ id: item.blind.id, adapter: item.adapter,
    requestDigest: hash(requestFor(state.pins.adapters.find(adapter => adapter.id === item.adapter), item.blind)) })) }
}
