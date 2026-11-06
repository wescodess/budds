import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { exactKeys, hash, readJson, seal, unseal, exists, VERSION } from './artifacts.mjs'
import { LIMITS } from './contract.mjs'
import { liveOutcome, metadataOutcome } from './run-state.mjs'
import { openHistoricalRun } from './historical-run.mjs'

const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)
const integer = value => Number.isSafeInteger(value) && value >= 0
const approvalName = value => `approval-${value.slice(7)}.json`
const reservationName = value => `reservation-${hash({ approvalDigest: value.approvalDigest, id: value.id }).slice(7)}.json`
const resolutionName = value => reservationName(value).replace('reservation-', 'resolution-')
const sameRun = (claim, state) => claim.directory === state.directory && claim.pinsDigest === state.pinsDigest

function usage(ledger, state, approvalDigest, adapter) {
  let approved = 0
  let run = 0
  let dispatches = 0
  for (const [name, reservation] of ledger.reservations) {
    if (ledger.resolutions.get(name)?.status === 'not_dispatched') continue
    const claim = ledger.approvals.get(reservation.approvalDigest)
    if (reservation.approvalDigest === approvalDigest) approved += reservation.reservationMicroUsd
    if (sameRun(claim, state)) run += reservation.reservationMicroUsd
    if (reservation.model === adapter.model && reservation.configuration === adapter.configuration) dispatches++
  }
  assert.ok(integer(approved) && integer(run), 'Global reservation total is invalid')
  return { approved, run, dispatches }
}

// The caller holds the fixed global dispatch lock throughout read, charge and
// transport. Entries are immutable, fsynced, exclusively published artifacts;
// every reservation remains charged, including unknown post-dispatch outcomes.
export async function openLiveLedger(directory) {
  const ledger = { directory, approvals: new Map(), reservations: new Map(), resolutions: new Map() }
  const names = readdirSync(directory).filter(name => !['.learn-v2-scorer-global.lock', 'unresolved.json'].includes(name))
  for (const name of names) assert.match(name, /^(?:(?:approval|reservation)-[a-f0-9]{64}|resolution-[a-f0-9]{64}(?:-[a-f0-9]{64})?)\.json$/, 'Interrupted or unknown global ledger entry requires reconciliation')
  for (const name of names.filter(name => name.startsWith('approval-'))) {
    const raw = readJson(join(directory, name))
    const entry = unseal(directory, name, 'live_approval_consumption', raw.pinsDigest)
    const claim = entry.payload
    exactKeys(claim, ['approvalDigest', 'costDigest', 'directory', 'pinsDigest', 'budgetMicroUsd'])
    assert.ok(digest(claim.approvalDigest) && digest(claim.costDigest) && digest(claim.pinsDigest) && integer(claim.budgetMicroUsd))
    assert.ok(typeof claim.directory === 'string' && isAbsolute(claim.directory) && resolve(claim.directory) === claim.directory)
    assert.equal(entry.pinsDigest, claim.pinsDigest)
    assert.equal(name, approvalName(claim.approvalDigest))
    ledger.approvals.set(claim.approvalDigest, claim)
  }
  const ownedIds = new Set()
  for (const name of names.filter(name => name.startsWith('reservation-'))) {
    const raw = readJson(join(directory, name))
    const entry = unseal(directory, name, 'live_dispatch_reservation', raw.pinsDigest)
    const reservation = entry.payload
    exactKeys(reservation, ['approvalDigest', 'id', 'model', 'configuration', 'intentDigest', 'intent', 'reservationMicroUsd'])
    assert.ok(digest(reservation.approvalDigest) && digest(reservation.configuration) && digest(reservation.intentDigest))
    assert.match(reservation.id, /^item_[a-f0-9]{32}$/)
    assert.ok(typeof reservation.model === 'string' && reservation.model.length > 0 && reservation.model.length <= 200)
    assert.ok(integer(reservation.reservationMicroUsd) && reservation.reservationMicroUsd > 0)
    const claim = ledger.approvals.get(reservation.approvalDigest)
    assert.ok(claim, 'Global reservation has no approval consumption record')
    assert.equal(entry.pinsDigest, claim.pinsDigest)
    assert.equal(name, reservationName(reservation))
    assert.equal(reservation.intentDigest, hash({ version: VERSION, kind: 'dispatch_intent', pinsDigest: claim.pinsDigest, payload: reservation.intent }))
    assert.equal(reservation.intent.id, reservation.id)
    assert.equal(reservation.intent.approval.approvalDigest, reservation.approvalDigest)
    assert.equal(reservation.intent.reservationMicroUsd, reservation.reservationMicroUsd)
    assert.equal(reservation.intent.dispatched, true)
    const ownedId = hash([claim.directory, claim.pinsDigest, reservation.id])
    assert.ok(!ownedIds.has(ownedId), 'Duplicate global dispatch requires reconciliation')
    ownedIds.add(ownedId)
    ledger.reservations.set(name, reservation)
  }
  const runs = new Map()
  for (const name of names.filter(name => name.startsWith('resolution-')).sort()) {
    const raw = readJson(join(directory, name))
    const entry = unseal(directory, name, 'live_dispatch_resolution', raw.pinsDigest)
    const resolution = entry.payload
    exactKeys(resolution, ['approvalDigest', 'id', 'intentDigest', 'recordName', 'recordDigest', 'status'])
    const reservation = ledger.reservations.get(reservationName(resolution))
    assert.ok(reservation, 'Global resolution has no dispatch reservation')
    const claim = ledger.approvals.get(reservation.approvalDigest)
    assert.equal(entry.pinsDigest, claim.pinsDigest)
    assert.equal(resolution.intentDigest, reservation.intentDigest)
    assert.ok(name === resolutionName(reservation) || name === resolutionName(reservation).replace('.json', `-${resolution.recordDigest.slice(7)}.json`))
    if (!runs.has(claim.directory)) {
      const state = await openHistoricalRun(claim.directory, claim.pinsDigest)
      verifyLiveRun(ledger, state)
      runs.set(claim.directory, state)
    }
    verifyResolution(runs.get(claim.directory), claim.pinsDigest, resolution)
    const previous = ledger.resolutions.get(reservationName(reservation))
    if (previous && previous.status !== 'still_unknown' && resolution.status !== 'still_unknown') assert.deepEqual(previous, resolution, 'Conflicting global resolutions')
    if (!previous || resolution.status !== 'still_unknown') ledger.resolutions.set(reservationName(reservation), resolution)
  }
  for (const claim of ledger.approvals.values()) {
    const siblings = [...ledger.approvals.values()].filter(other => other.directory === claim.directory)
    assert.ok(siblings.every(other => other.pinsDigest === claim.pinsDigest && other.budgetMicroUsd === claim.budgetMicroUsd), 'Global run pins changed')
    const totals = usage(ledger, claim, claim.approvalDigest, {})
    assert.ok(totals.approved <= claim.budgetMicroUsd && totals.run <= claim.budgetMicroUsd, 'Global approval budget exceeded')
  }
  for (const reservation of ledger.reservations.values()) assert.ok(
    usage(ledger, ledger.approvals.get(reservation.approvalDigest), reservation.approvalDigest, reservation).dispatches <= LIMITS.dispatchesPerModelOrConfiguration,
    'Global per-model/configuration dispatch ceiling exceeded')
  return ledger
}

function verifyResolution(state, pinsDigest, resolution) {
  assert.ok(['resolved', 'failed', 'still_unknown', 'not_dispatched'].includes(resolution.status))
  assert.equal(state.pinsDigest, pinsDigest)
  const reconciled = new RegExp(`^${resolution.id}\\.reconciled(?:-[1-9][0-9]*)?\\.json$`).test(resolution.recordName)
  const notDispatched = resolution.recordName === `${resolution.id}.not-dispatched.json`
  assert.equal(notDispatched, resolution.status === 'not_dispatched', 'Charge release requires a not-dispatched record')
  assert.ok(reconciled || notDispatched || resolution.recordName === `${resolution.id}.terminal.json`)
  const record = unseal(state.directory, resolution.recordName, reconciled ? 'reconciled_verdict' : notDispatched ? 'dispatch_not_sent' : 'sealed_verdict', pinsDigest)
  assert.equal(record.digest, resolution.recordDigest)
  assert.equal(record.payload.intentDigest, resolution.intentDigest)
  const replayed = state.verifiedRecords.get(record.digest)
  assert.deepEqual(replayed, { name: resolution.recordName, intentDigest: resolution.intentDigest, status: resolution.status }, 'Global resolution differs from authoritative replay')
}

export function unresolvedLiveDispatches(ledger) {
  // A reservation is also the durable global dispatch intent. Absence of a
  // matching durable resolution blocks every run, including distinct approvals.
  return [...ledger.reservations].filter(([name]) => !['resolved', 'failed', 'not_dispatched'].includes(ledger.resolutions.get(name)?.status)).map(([, reservation]) => reservation)
}

export async function recordLiveResolution(ledger, state, intent, record, recordName = `${intent.payload.id}.terminal.json`) {
  const reservation = ledger.reservations.get(reservationName({ approvalDigest: intent.payload.approval.approvalDigest, id: intent.payload.id }))
  assert.ok(reservation && sameRun(ledger.approvals.get(reservation.approvalDigest), state))
  const resolution = { approvalDigest: reservation.approvalDigest, id: reservation.id, intentDigest: intent.digest,
    recordName, recordDigest: record.digest,
    status: record.kind === 'dispatch_not_sent' ? 'not_dispatched'
      : record.kind === 'reconciled_verdict' ? (state.replay?.metadataOutcome ?? metadataOutcome)(record.payload.result)
        : (state.replay?.liveOutcome ?? liveOutcome)(record.payload.result) }
  verifyResolution(await openHistoricalRun(state.directory, state.pinsDigest), state.pinsDigest, resolution)
  if (resolution.status === 'still_unknown') return
  const base = resolutionName(reservation)
  const name = exists(join(ledger.directory, base)) && readJson(join(ledger.directory, base)).payload.status === 'still_unknown'
    ? base.replace('.json', `-${record.digest.slice(7)}.json`) : base
  seal(ledger.directory, name, 'live_dispatch_resolution', state.pinsDigest, resolution)
  ledger.resolutions.set(reservationName(reservation), resolution)
}

export function claimLiveApproval(ledger, state, approval) {
  const claim = { approvalDigest: approval.approvalDigest, costDigest: approval.costDigest, directory: state.directory,
    pinsDigest: state.pinsDigest, budgetMicroUsd: state.pins.budgetMicroUsd }
  const previous = ledger.approvals.get(approval.approvalDigest)
  if (previous) assert.deepEqual(previous, claim, 'Live approval already consumed by another run')
  for (const other of ledger.approvals.values()) if (other.directory === state.directory) {
    assert.equal(other.pinsDigest, state.pinsDigest, 'Global run pins changed')
    assert.equal(other.budgetMicroUsd, state.pins.budgetMicroUsd, 'Global run budget changed')
  }
  if (!previous) seal(ledger.directory, approvalName(approval.approvalDigest), 'live_approval_consumption', state.pinsDigest, claim)
  ledger.approvals.set(approval.approvalDigest, claim)
}

function reservationFor(state, adapter, intent) {
  return { approvalDigest: intent.approval.approvalDigest, id: intent.id, model: adapter.model, configuration: adapter.configuration,
    intentDigest: hash({ version: VERSION, kind: 'dispatch_intent', pinsDigest: state.pinsDigest, payload: intent }),
    intent, reservationMicroUsd: intent.reservationMicroUsd }
}

export function verifyLiveRun(ledger, state) {
  const owned = [...ledger.reservations.values()].filter(reservation => sameRun(ledger.approvals.get(reservation.approvalDigest), state))
  const dispatched = [...state.intents.values()].filter(intent => intent.payload.dispatched)
  assert.equal(owned.length, dispatched.length, 'Global reservation/local intent discrepancy requires reconciliation')
  for (const intent of state.intents.values()) {
    assert.ok(intent.payload.approval, 'Live intent has no signed approval record')
    const claim = ledger.approvals.get(intent.payload.approval.approvalDigest)
    assert.ok(claim && sameRun(claim, state) && claim.budgetMicroUsd === state.pins.budgetMicroUsd
      && claim.costDigest === intent.payload.approval.costDigest, 'Live intent has no matching global approval consumption')
    if (!intent.payload.dispatched) continue
    const adapter = state.pins.adapters.find(adapter => adapter.id === intent.payload.adapter)
    const expected = reservationFor(state, adapter, intent.payload)
    assert.deepEqual(ledger.reservations.get(reservationName(expected)), expected, 'Live intent differs from its global reservation')
    assert.equal(intent.digest, expected.intentDigest)
  }
}

export function reserveLiveDispatch(ledger, state, adapter, intent) {
  claimLiveApproval(ledger, state, intent.approval)
  const totals = usage(ledger, state, intent.approval.approvalDigest, adapter)
  assert.ok(totals.dispatches < LIMITS.dispatchesPerModelOrConfiguration, 'Global per-model/configuration dispatch ceiling reached')
  const amount = intent.reservationMicroUsd
  assert.ok(integer(amount) && amount > 0)
  if (totals.approved + amount > state.pins.budgetMicroUsd || totals.run + amount > state.pins.budgetMicroUsd) return false
  assert.ok(![...ledger.reservations.values()].some(reservation => sameRun(ledger.approvals.get(reservation.approvalDigest), state)
    && reservation.id === intent.id), 'Global reservation forbids redispatch')
  const reservation = reservationFor(state, adapter, intent)
  const name = reservationName(reservation)
  // Charge and record global uncertainty before the local intent or transport.
  // Only a durable terminal/resolution clears this intent; lock cleanup cannot.
  seal(ledger.directory, name, 'live_dispatch_reservation', state.pinsDigest, reservation)
  ledger.reservations.set(name, reservation)
  return true
}
