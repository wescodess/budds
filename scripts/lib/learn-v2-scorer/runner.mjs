import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { hash, seal, unseal, removeSealed, exists, implementationPins, exclusiveLock, outputDirectory, FIXTURES, exactKeys, readJson } from './artifacts.mjs'
import { corpusInputs, bindInventory, runPins, schedule, LIMITS } from './contract.mjs'
import { requestFor, fixtureEnvelope, baselineExecution, reconcileBaselineExecution, liveMetadata, parseIndependent, liveInfer, GRADER_PROMPT, GRADER_SCHEMA } from './adapters.mjs'
import { buildReport, fitThresholds } from './report.mjs'
import { admitLive } from './live-approval.mjs'
import { openLiveLedger, verifyLiveRun, reserveLiveDispatch, recordLiveResolution, unresolvedLiveDispatches, liveOutcome, metadataOutcome } from './live-ledger.mjs'

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
    intents: new Map(), terminals: new Map(), observations: new Map(), metadataIntents: new Map(), reconciliations: new Map(),
    artifacts: [], fitDigests: [], reserved: 0, dispatchCounts: new Map() }
  const allowed = new Set(['manifest.json', 'thresholds.json', '.run.lock'])
  for (const item of plan) {
    for (const kind of ['intent', 'terminal']) allowed.add(artifactName(item.blind.id, kind))
    if (pins.mode === 'live') for (const kind of ['observation', 'metadata-intent', 'reconciled']) allowed.add(artifactName(item.blind.id, kind))
    const intentName = artifactName(item.blind.id, 'intent')
    const terminalName = artifactName(item.blind.id, 'terminal')
    if (!exists(join(directory, intentName))) {
      for (const kind of ['terminal', 'observation', 'metadata-intent', 'reconciled']) assert.ok(!exists(join(directory, artifactName(item.blind.id, kind))), 'Orphan dispatch artifact')
      continue
    }
    const intent = unseal(directory, intentName, 'dispatch_intent', state.pinsDigest)
    verifyIntent(state, item, intent.payload)
    state.intents.set(item.blind.id, intent)
    state.reserved += intent.payload.reservationMicroUsd
    const adapter = pins.adapters.find(adapter => adapter.id === item.adapter)
    state.dispatchCounts.set(adapter.model, (state.dispatchCounts.get(adapter.model) ?? 0) + Number(intent.payload.dispatched))
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
      assert.equal(terminal.payload.intentDigest, intent.digest)
      if (pins.mode === 'live' && intent.payload.dispatched) assert.deepEqual(state.observations.get(item.blind.id)?.payload,
        { intentDigest: intent.digest, raw: terminal.payload.raw, terminalAt: terminal.payload.terminalAt }, 'Terminal differs from saved observation')
      const reproduced = await evaluate(state, item, intent.payload, terminal.payload.raw, terminal.payload.terminalAt)
      assert.deepEqual(reproduced, terminal.payload.result, 'Sealed verdict replay changed')
      recordTerminal(state, item, terminal)
    }
    await openReconciliation(state, item, intent)
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

async function reconcileObservation(state, item, intent, observation, lookup, clock) {
  const adapter = state.pins.adapters.find(adapter => adapter.id === item.adapter)
  const original = await evaluate(state, item, intent.payload, observation.payload.raw, observation.payload.terminalAt)
  const saved = state.pins.bindings.find(binding => binding.binding.configurationDigest === adapter.configuration)
  const result = await reconcileBaselineExecution({ adapter, blind: item.blind, saved, registry: state.registry,
    startedAt: intent.payload.startedAt, raw: observation.payload.raw, execution: original.execution, lookup, clock })
  return { ...result, weights: original.weights }
}

async function openReconciliation(state, item, intent) {
  const lookupName = artifactName(item.blind.id, 'metadata-intent')
  const name = artifactName(item.blind.id, 'reconciled')
  const observation = state.observations.get(item.blind.id)
  if (exists(join(state.directory, lookupName))) {
    const lookup = unseal(state.directory, lookupName, 'metadata_lookup_intent', state.pinsDigest)
    exactKeys(lookup.payload, ['intentDigest', 'generationId', 'startedAt', 'deadline'])
    assert.equal(lookup.payload.intentDigest, intent.digest)
    assert.equal(lookup.payload.generationId, observation?.payload.raw.id)
    assert.ok(typeof lookup.payload.generationId === 'string' && lookup.payload.generationId.length > 0)
    assert.ok(int(lookup.payload.startedAt) && lookup.payload.startedAt >= intent.payload.startedAt)
    assert.equal(lookup.payload.deadline, Math.min(lookup.payload.startedAt + 10_000, intent.payload.deadline))
    state.metadataIntents.set(item.blind.id, lookup)
  }
  if (!exists(join(state.directory, name))) return
  const record = unseal(state.directory, name, 'reconciled_verdict', state.pinsDigest)
  const payload = record.payload
  exactKeys(payload, ['intentDigest', 'observationDigest', 'lookupDigest', 'reconciledAt', 'status', 'result'])
  assert.equal(payload.intentDigest, intent.digest)
  assert.equal(payload.observationDigest, observation?.digest ?? null)
  const lookup = state.metadataIntents.get(item.blind.id)
  assert.equal(payload.lookupDigest, lookup?.digest ?? null)
  assert.ok(int(payload.reconciledAt) && payload.reconciledAt >= (lookup?.payload.startedAt ?? intent.payload.startedAt))
  assert.equal(payload.status, metadataOutcome(payload.result))
  if (payload.result !== null) {
    assert.ok(lookup && observation, 'Reconciled execution requires saved observation and metadata intent')
    let lookedUp = false
    const reproduced = await reconcileObservation(state, item, intent, observation, async generationId => {
      assert.equal(generationId, lookup.payload.generationId)
      lookedUp = true
      if (payload.result.execution.metadata === null) throw new Error('Saved metadata unavailable')
      return payload.result.execution.metadata
    }, () => lookedUp ? payload.reconciledAt : lookup.payload.startedAt)
    assert.deepEqual(reproduced, payload.result, 'Reconciled verdict replay changed')
  }
  recordReconciliation(state, item, record)
}

function recordReconciliation(state, item, record) {
  state.reconciliations.set(item.blind.id, record)
  if (record.payload.result) state.results.get(item.adapter).set(item.rowId, record.payload.result)
  state.artifacts.push(record.digest)
  if (item.phase === 'fit') state.fitDigests.push(record.digest)
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

function unresolvedItem(state, id) {
  if (state.reconciliations.has(id)) return state.reconciliations.get(id).payload.status === 'still_unknown'
  const terminal = state.terminals.get(id)
  return !terminal || (state.pins.mode === 'live' ? liveOutcome(terminal.payload.result) === 'still_unknown'
    : ['ambiguous', 'outcome_unknown'].includes(terminal.payload.result.status))
}

function stopped(state, adapterId) {
  return state.plan.some(item => item.adapter === adapterId && state.intents.has(item.blind.id) && unresolvedItem(state, item.blind.id))
}

function approveLive(state, item, options, now) {
  assert.ok(now - state.pins.clock >= 0 && now - state.pins.clock < 86_400_000, 'Run clock is stale')
  assert.equal(state.pins.priceAccessDate, new Date(now).toISOString().slice(0, 10), 'Price access must be refreshed on dispatch day')
  const request = requestFor(state.pins.adapters.find(adapter => adapter.id === item.adapter), item.blind)
  return admitLive({ pins: state.pins, pinsDigest: state.pinsDigest, item, request, now,
    requestPins: state.plan.map(row => ({ id: row.blind.id, requestDigest: hash(requestFor(state.pins.adapters.find(adapter => adapter.id === row.adapter), row.blind)) })),
    ...options })
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
    approval = approveLive(state, item, options, startedAt)
  }
  const reservationMicroUsd = approval?.reservationMicroUsd ?? state.pins.fixture.reservationMicroUsd
  let dispatchAllowed = true
  if (state.pins.mode === 'offline') {
    dispatchAllowed = outcome !== 'budget_exhausted' && state.reserved + reservationMicroUsd <= state.pins.budgetMicroUsd
    assert.ok((state.dispatchCounts.get(adapter.model) ?? 0) < LIMITS.dispatchesPerModelOrConfiguration, 'Per-model dispatch ceiling reached')
  }
  const payload = {
    id: item.blind.id, adapter: item.adapter, request, requestDigest: hash(request), startedAt, deadline: startedAt + LIMITS.timeoutMs,
    responseDigest: hash(item.blind.scoringInput.learnerResponse), reservationMicroUsd: dispatchAllowed ? reservationMicroUsd : 0,
    dispatched: dispatchAllowed, thresholdDigest: state.thresholds?.digest ?? null, approval,
  }
  if (state.pins.mode === 'live') {
    dispatchAllowed = reserveLiveDispatch(state.liveLedger, state, adapter, payload)
    if (!dispatchAllowed) Object.assign(payload, { dispatched: false, reservationMicroUsd: 0 })
  }
  const intent = seal(state.directory, artifactName(item.blind.id, 'intent'), 'dispatch_intent', state.pinsDigest, payload)
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
  if (state.pins.mode === 'live' && dispatchAllowed) {
    const observation = seal(state.directory, artifactName(item.blind.id, 'observation'), 'dispatch_observation', state.pinsDigest,
      { intentDigest: intent.digest, raw, terminalAt })
    state.observations.set(item.blind.id, observation)
  }
  const result = await evaluate(state, item, intent.payload, raw, terminalAt)
  const terminal = seal(state.directory, artifactName(item.blind.id, 'terminal'), 'sealed_verdict', state.pinsDigest,
    { intentDigest: intent.digest, raw, terminalAt, result })
  recordTerminal(state, item, terminal)
  if (state.pins.mode === 'live' && dispatchAllowed) recordLiveResolution(state.liveLedger, state, intent, terminal)
  return true
}

function report(state) {
  const thresholds = state.thresholds?.payload ?? { ...fitThresholds(state.corpus.corpus, state.pins.adapters, state.results, state.fitDigests), phase: 'diagnostic_fit_not_frozen' }
  const ambiguous = [...state.intents].filter(([id]) => unresolvedItem(state, id))
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
    state.liveLedger = openLiveLedger(global)
    assert.equal(unresolvedLiveDispatches(state.liveLedger).length, 0, 'Global dispatch outcome requires reconciliation')
    verifyLiveRun(state.liveLedger, state)
    const item = state.plan.find(item => item.blind.id === id)
    assert.ok(item, 'Unknown opaque dispatch ID')
    if (state.intents.has(id)) return report(state)
    const next = state.plan.find(item => !state.intents.has(item.blind.id) && !stopped(state, item.adapter))
    assert.equal(item, next, 'Single dispatch must follow the frozen blind schedule')
    if (!item.canary) assert.ok(state.plan.filter(row => row.canary).every(row => state.results.get(row.adapter).get(row.rowId)?.status === 'valid'),
      'All three authorized canaries must validate before core live dispatch')
    if (item.phase === 'heldout') freezeThresholds(state)
    // The reservation already blocks globally before transport. This marker is
    // supplemental; failures publishing it cannot release the durable block.
    await dispatch(state, item, options)
    if (stopped(state, item.adapter)) seal(global, 'unresolved.json', 'global_reconciliation_required', state.pinsDigest,
      { directory: state.directory, id: item.blind.id })
    return report(state)
  }))
}

export async function reconcileLive(path, id, options) {
  const global = outputDirectory('/tmp/budds-learn-v2-scorer-live')
  return exclusiveLock(global, '.learn-v2-scorer-global.lock', () => exclusiveLock(outputDirectory(path), '.run.lock', async () => {
    const state = await openRun(path)
    assert.equal(state.pins.mode, 'live')
    const ledger = openLiveLedger(global)
    verifyLiveRun(ledger, state)
    const item = state.plan.find(item => item.blind.id === id)
    const intent = state.intents.get(id)
    assert.ok(item && intent?.payload.dispatched, 'Reconciliation requires a recorded dispatched intent')
    const marker = exists(join(global, 'unresolved.json')) ? readJson(join(global, 'unresolved.json')) : null
    const ownsMarker = marker?.pinsDigest === state.pinsDigest && marker?.payload.directory === state.directory && marker?.payload.id === id
    assert.ok(unresolvedLiveDispatches(ledger).some(reservation => reservation.id === id && reservation.intentDigest === intent.digest) || ownsMarker,
      'Only unresolved global intents can be reconciled')
    assert.deepEqual(approveLive(state, item, options, Date.now()), intent.payload.approval, 'Reconciliation requires the original signed approval and pins')
    // A known result may already be durable when only its ledger publication
    // failed. Finish that publication without consuming a metadata lookup.
    const terminal = state.terminals.get(id)
    if (!state.reconciliations.has(id) && terminal && liveOutcome(terminal.payload.result) !== 'still_unknown') {
      recordLiveResolution(ledger, state, intent, terminal)
      clearResolvedMarker(global, ledger, state, id)
      return { ...report(state), reconciliation: liveOutcome(terminal.payload.result) }
    }
    let record = state.reconciliations.get(id)
    if (!record) {
      const observation = state.observations.get(id)
      let lookup = state.metadataIntents.get(id)
      let result = null
      const adapter = state.pins.adapters.find(adapter => adapter.id === item.adapter)
      if (!lookup && observation && adapter.role === 'baseline') {
        const original = await evaluate(state, item, intent.payload, observation.payload.raw, observation.payload.terminalAt)
        const generationId = original.execution?.terminal.generationId
        const now = Date.now()
        if (generationId && original.execution.receipt.integrityResult === 'identity_unavailable' && now < intent.payload.deadline) {
          // Persist the one lookup allowance before metadata I/O. A crash after
          // this point cannot authorize another lookup, even on another process.
          lookup = seal(state.directory, artifactName(id, 'metadata-intent'), 'metadata_lookup_intent', state.pinsDigest,
            { intentDigest: intent.digest, generationId, startedAt: now, deadline: Math.min(now + 10_000, intent.payload.deadline) })
          state.metadataIntents.set(id, lookup)
          try { result = await reconcileObservation(state, item, intent, observation, liveMetadata, Date.now) }
          catch { /* Keep the global intent unresolved; never fall back to inference. */ }
        }
      }
      const payload = { intentDigest: intent.digest, observationDigest: observation?.digest ?? null, lookupDigest: lookup?.digest ?? null,
        reconciledAt: result?.execution.metadata ? result.identity.observedAt : Date.now(), status: metadataOutcome(result), result }
      record = seal(state.directory, artifactName(id, 'reconciled'), 'reconciled_verdict', state.pinsDigest, payload)
      recordReconciliation(state, item, record)
    }
    recordLiveResolution(ledger, state, intent, record, true)
    clearResolvedMarker(global, ledger, state, id)
    return { ...report(state), reconciliation: record.payload.status }
  }))
}

function clearResolvedMarker(global, ledger, state, id) {
  if (unresolvedLiveDispatches(ledger).length !== 0 || !exists(join(global, 'unresolved.json'))) return
  const marker = readJson(join(global, 'unresolved.json'))
  assert.equal(marker.pinsDigest, state.pinsDigest)
  assert.deepEqual(marker.payload, { directory: state.directory, id })
  removeSealed(global, 'unresolved.json', 'global_reconciliation_required', state.pinsDigest)
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
