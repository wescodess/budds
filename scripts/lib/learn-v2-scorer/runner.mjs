import assert from 'node:assert/strict'
import { join } from 'node:path'
import { hash, seal, removeSealed, exists, exclusiveLock, outputDirectory, readJson } from './artifacts.mjs'
import { corpusInputs, bindInventory, runPins, LIMITS } from './contract.mjs'
import { requestFor, fixtureEnvelope, baselineExecution, liveMetadata, liveInfer, GRADER_PROMPT, GRADER_SCHEMA } from './adapters.mjs'
import { buildReport, fitThresholds } from './report.mjs'
import { admitLive } from './live-approval.mjs'
import { openLiveLedger, verifyLiveRun, reserveLiveDispatch, recordLiveResolution, unresolvedLiveDispatches } from './live-ledger.mjs'
import { artifactName, reconciliationName, assertCurrent, openRun, verifyIntent, evaluate, reconcileObservation, recordReconciliation, recordTerminal, liveOutcome, metadataOutcome, validateFixture, replayMetadata } from './run-state.mjs'

const emptyAnchors = { version: 'learn-v2.synthetic-anchor-checks.v1', evidenceStatus: 'synthetic_contract_only', canvasAdmitted: false, rows: [] }

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

function freezeThresholds(state) {
  if (state.thresholds) return
  // All fit slots must have either a sealed outcome or a durable no-dispatch
  // explanation before a threshold can be frozen and held-out work can begin.
  const payload = fitThresholds(state.corpus.corpus, state.pins.adapters, state.results, state.fitDigests)
  state.thresholds = seal(state.directory, 'thresholds.json', 'frozen_thresholds', state.pinsDigest, payload)
}

function unresolvedItem(state, id) {
  const terminal = state.terminals.get(id)
  if (state.pins.mode === 'live' && terminal && liveOutcome(terminal.payload.result) !== 'still_unknown') return false
  if (state.reconciliations.has(id)) return state.reconciliations.get(id).payload.status === 'still_unknown'
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
  if (state.pins.mode === 'live' && dispatchAllowed) await recordLiveResolution(state.liveLedger, state, intent, terminal)
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
    state.liveLedger = await openLiveLedger(global)
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
    let state = await openRun(path)
    assert.equal(state.pins.mode, 'live')
    const ledger = await openLiveLedger(global)
    const item = state.plan.find(item => item.blind.id === id)
    // The global reservation includes the exact intent so an interruption
    // before local publication cannot strand the charge or permit redispatch.
    const reserved = [...ledger.reservations.values()].find(row => row.id === id
      && ledger.approvals.get(row.approvalDigest).directory === state.directory)
    if (reserved && item && !state.intents.has(id)) {
      verifyIntent(state, item, reserved.intent)
      assert.deepEqual(approveLive(state, item, options, reserved.intent.startedAt), reserved.intent.approval, 'Reconciliation requires the original signed approval and pins')
      seal(state.directory, artifactName(id, 'intent'), 'dispatch_intent', state.pinsDigest, reserved.intent)
      state = await openRun(path)
    }
    verifyLiveRun(ledger, state)
    const intent = state.intents.get(id)
    assert.ok(item && intent?.payload.dispatched, 'Reconciliation requires a recorded dispatched intent')
    const marker = exists(join(global, 'unresolved.json')) ? readJson(join(global, 'unresolved.json')) : null
    const ownsMarker = marker?.pinsDigest === state.pinsDigest && marker?.payload.directory === state.directory && marker?.payload.id === id
    assert.ok(reserved && (unresolvedLiveDispatches(ledger).some(row => row.intentDigest === intent.digest)
      || ownsMarker || [...ledger.resolutions.values()].some(row => row.intentDigest === intent.digest)), 'Only recorded global intents can be reconciled')
    // Local replay verifies authorization at dispatch time. Expiry must not
    // strand already-saved evidence; only new metadata I/O needs current approval.
    assert.deepEqual(approveLive(state, item, options, intent.payload.startedAt), intent.payload.approval, 'Reconciliation requires the original signed approval and pins')
    const observation = state.observations.get(id)
    let terminal = state.terminals.get(id)
    if (!terminal && observation) {
      const result = await evaluate(state, item, intent.payload, observation.payload.raw, observation.payload.terminalAt)
      terminal = seal(state.directory, artifactName(id, 'terminal'), 'sealed_verdict', state.pinsDigest,
        { ...observation.payload, result })
      recordTerminal(state, item, terminal)
    }
    if (terminal && liveOutcome(terminal.payload.result) !== 'still_unknown') {
      await recordLiveResolution(ledger, state, intent, terminal)
      clearResolvedMarker(global, ledger, state, id)
      return { ...report(await openRun(path)), reconciliation: liveOutcome(terminal.payload.result) }
    }
    let record = state.reconciliations.get(id)
    if (!record || record.payload.status === 'still_unknown') {
      let lookup = state.metadataIntents.get(id)
      const adapter = state.pins.adapters.find(adapter => adapter.id === item.adapter)
      if (!lookup && observation && adapter.role === 'baseline') {
        const original = await evaluate(state, item, intent.payload, observation.payload.raw, observation.payload.terminalAt)
        const generationId = original.execution?.terminal.generationId
        const now = Date.now()
        if (generationId && original.execution.receipt.integrityResult === 'identity_unavailable' && now < intent.payload.deadline) {
          assert.deepEqual(approveLive(state, item, options, now), intent.payload.approval, 'Metadata lookup requires current original approval')
          lookup = seal(state.directory, artifactName(id, 'metadata-intent'), 'metadata_lookup_intent', state.pinsDigest,
            { intentDigest: intent.digest, generationId, startedAt: now, deadline: Math.min(now + 10_000, intent.payload.deadline) })
          await captureMetadata(state, item, intent, observation, lookup)
        }
      }
      state = await openRun(path)
      const saved = state.metadataObservations.get(id)
      const result = lookup && observation ? await replayMetadata(state, item, intent, observation, lookup, saved) : null
      const evidence = { observationDigest: observation?.digest ?? null, lookupDigest: lookup?.digest ?? null,
        metadataDigest: saved?.digest ?? null, status: metadataOutcome(result), result }
      const previousEvidence = record && Object.fromEntries(Object.keys(evidence).map(key => [key, record.payload[key]]))
      if (!record || hash(evidence) !== hash(previousEvidence)) {
        const previousName = record && state.reconciliationNames.get(record.digest)
        const index = record ? Number(previousName.match(/reconciled-(\d+)/)?.[1] ?? 0) + 1 : 0
        const name = reconciliationName(id, index)
        record = seal(state.directory, name, 'reconciled_verdict', state.pinsDigest,
          { intentDigest: intent.digest, ...evidence, previousDigest: record?.digest ?? null, reconciledAt: Date.now() })
        recordReconciliation(state, item, record, name)
      }
    }
    await recordLiveResolution(ledger, state, intent, record, state.reconciliationNames.get(record.digest))
    clearResolvedMarker(global, ledger, state, id)
    return { ...report(await openRun(path)), reconciliation: record.payload.status }
  }))
}

async function captureMetadata(state, item, intent, observation, lookup) {
  let accepting = true
  let publicationError
  try {
    await reconcileObservation(state, item, intent, observation, async (generationId, signal) => {
      let metadata = null
      try { metadata = await liveMetadata(generationId, signal) }
      catch { /* Persist an unavailable response if it arrives within the lease. */ }
      if (!accepting || signal.aborted) throw new Error('Metadata lookup lease ended')
      try {
        seal(state.directory, artifactName(item.blind.id, 'metadata-observation'), 'metadata_observation', state.pinsDigest,
          { lookupDigest: lookup.digest, metadata, observedAt: Date.now() })
      }
      catch (error) { publicationError = error; throw error }
      if (metadata === null) throw new Error('Metadata unavailable')
      return metadata
    }, Date.now)
  }
  finally { accepting = false }
  if (publicationError) throw publicationError
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
