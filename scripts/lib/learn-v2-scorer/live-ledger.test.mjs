import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock, test } from 'node:test'
import * as artifacts from './artifacts.mjs'
import { registerScorerImports, forbidNetwork } from './runtime.mjs'

registerScorerImports()
forbidNetwork()
const adapters = await import('./adapters.mjs')
let globalDirectory
let interruptIntent = false
let outcome = 'valid'
const calls = []

// Keep the production CLI's fixed global path and transport unchanged. Native
// module mocks isolate this test process and deny every real network entry.
mock.module(new URL('./artifacts.mjs', import.meta.url).href, { namedExports: { ...artifacts,
  outputDirectory: path => artifacts.outputDirectory(path === '/tmp/budds-learn-v2-scorer-live' ? globalDirectory : path),
  seal(...args) {
    if (interruptIntent && args[2] === 'dispatch_intent') throw new Error('Simulated interruption before local intent')
    return artifacts.seal(...args)
  },
} })
mock.module(new URL('./adapters.mjs', import.meta.url).href, { namedExports: { ...adapters,
  async liveInfer(adapter, request) {
    calls.push({ adapter: adapter.id, requestDigest: artifacts.hash(request) })
    const body = JSON.parse(request.body)
    const payload = adapter.role === 'gemini' ? body.input[0].content[0].text : body.messages.find(row => row.role === 'user').content
    const scoringInput = JSON.parse(payload)
    return adapters.fixtureEnvelope(adapter, { id: scoringInput.evidence[0].alias, payload, scoringInput }, outcome)
  },
} })
const { initialize, planRun, dispatchLive } = await import('./runner.mjs')
const { openLiveLedger, reserveLiveDispatch } = await import('./live-ledger.mjs')
const { sealLearnScorerConfiguration } = await import('../../../convex/lib/learnV2ScorerConfig.ts')
const { canonical, hash, readJson, outputDirectory } = artifacts

process.env.NUXT_CLOUDFLARE_ACCOUNT_ID = 'approval-contract-account'
process.env.NUXT_CLOUDFLARE_AI_GATEWAY_ID = 'approval-contract-gateway'

async function workspace(t) {
  const parent = mkdtempSync(join(tmpdir(), 'budds-c3-global-ledger-'))
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  globalDirectory = outputDirectory(join(parent, 'global'))
  calls.length = 0
  outcome = 'valid'
  interruptIntent = false
  const inventory = readJson(join(artifacts.ROOT, 'tests/fixtures/learn-v2-scorer-harness/inventory.json'))
  inventory.scope = 'reviewed_published_inventory'
  inventory.epoch = 'approval-contract.v1'
  const entry = inventory.configurations[0]
  entry.definition = { configurationId: 'approval-baseline.v1', configurationVersion: 'approval-config.v1', kind: 'legacy_baseline',
    requestedModel: 'openai/gpt-4.1', endpoint: null,
    identity: { mappingVersion: 'approval-identity.v1', canonicalModel: 'openai/gpt-4.1', family: 'openai-gpt', snapshotAssurance: 'unknown', verifiedReturnedModels: [] } }
  entry.expectedDigest = (await sealLearnScorerConfiguration(entry.definition)).binding.configurationDigest
  entry.upstream = 'OpenAI'
  entry.transportEndpoint = 'https://gateway.ai.cloudflare.com/v1/approval-contract-account/approval-contract-gateway/openrouter/v1/chat/completions'
  entry.inventoryEvidence = 'owner-recorded-inventory'
  const clock = Date.now()
  const options = { mode: 'live', fixture: null, inventory, clock, seed: 'approval-contract-shuffle-v1',
    budgetMicroUsd: 100000, priceAccessDate: new Date(clock).toISOString().slice(0, 10) }
  const createRun = async name => {
    const directory = await initialize({ ...options, output: join(parent, name) })
    const manifest = readJson(join(directory, 'manifest.json'))
    const plan = await planRun(directory)
    return { directory, pins: manifest.payload, pinsDigest: plan.pinsDigest, plan: plan.requests, intents: new Map() }
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const trustKey = join(parent, 'owner-public.pem')
  writeFileSync(trustKey, publicKey.export({ type: 'spki', format: 'pem' }))
  const signed = (name, payload) => {
    const path = join(parent, name)
    writeFileSync(path, JSON.stringify({ payload, signature: sign(null, Buffer.from(canonical(payload)), privateKey).toString('base64') }))
    return path
  }
  const approve = (state, name) => {
    const cost = { version: 'learn-v2.harness-cost-reservation.v1', pinsDigest: state.pinsDigest, priceAccessDate: options.priceAccessDate,
      verifiedAt: clock, expiresAt: clock + 600000, includesSchemaAndSystemOverhead: true, includesFeesTaxesAndPurchases: true,
      method: 'verified_conservative_reservation', requests: state.plan.map(row => ({ id: row.id, requestDigest: row.requestDigest,
        inputTokenBound: 4096, outputTokenBound: row.adapter.startsWith('baseline') ? 1200 : 2048,
        inputMicroUsdPerMillion: 1, outputMicroUsdPerMillion: 1, overheadMicroUsd: 0, maximumMicroUsd: 100,
        evidenceReference: 'synthetic-conservative-bound',
      })) }
    const approval = { version: 'learn-v2.harness-owner-approval.v1', owner: 'synthetic-owner', approvalId: name,
      pinsDigest: state.pinsDigest, budgetMicroUsd: state.pins.budgetMicroUsd, budgetApproved: true, providersApproved: true,
      privacyApproved: true, payloadPolicy: artifacts.POLICY, issuedAt: clock, expiresAt: clock + 600000, costEvidenceDigest: hash(cost) }
    return { approvalFile: signed(`${name}-approval.json`, approval), costFile: signed(`${name}-cost.json`, cost), trustKey,
      record: { approvalDigest: hash(approval), costDigest: hash(cost) } }
  }
  return { createRun, approve, clock }
}

test('one signed approval cannot dispatch in two directories; the original run restarts without redispatch', async t => {
  const { createRun, approve } = await workspace(t)
  const first = await createRun('first')
  const second = await createRun('second')
  assert.equal(first.pinsDigest, second.pinsDigest)
  const approval = approve(first, 'shared')
  const id = first.plan[0].id
  const completed = await dispatchLive(first.directory, id, approval)
  assert.equal(calls.length, 1)
  const before = readdirSync(globalDirectory).sort().map(name => [name, readFileSync(join(globalDirectory, name), 'utf8')])
  await assert.rejects(dispatchLive(second.directory, id, approval), /already consumed/)
  assert.equal(calls.length, 1)
  assert.deepEqual(readdirSync(globalDirectory).sort().map(name => [name, readFileSync(join(globalDirectory, name), 'utf8')]), before)
  const restarted = await dispatchLive(first.directory, id, approval)
  assert.equal(restarted.digest, completed.digest)
  assert.equal(calls.length, 1)
  await dispatchLive(first.directory, first.plan[1].id, approval)
  assert.equal(calls.length, 2)
  const ledger = openLiveLedger(globalDirectory)
  assert.equal(ledger.approvals.size, 1)
  assert.equal(ledger.reservations.size, 2)
  assert.equal([...ledger.reservations.values()].reduce((sum, row) => sum + row.reservationMicroUsd, 0), 200)
})

test('256 model/configuration reservations accumulate across runs and distinct approvals before transport', async t => {
  const { createRun, approve } = await workspace(t)
  const first = await createRun('first')
  const second = await createRun('second')
  const next = await createRun('next')
  const adapter = next.pins.adapters.find(adapter => adapter.id === next.plan[0].adapter)
  const ledger = openLiveLedger(globalDirectory)
  for (const [index, state] of [first, second].entries()) {
    const approval = approve(state, `cap-${index}`).record
    for (let ordinal = 0; ordinal < 128; ordinal++) {
      const intent = { id: `item_${hash([index, ordinal]).slice(7, 39)}`, approval, dispatched: true, reservationMicroUsd: 100 }
      assert.equal(reserveLiveDispatch(ledger, state, adapter, intent), true)
    }
  }
  assert.equal(openLiveLedger(globalDirectory).reservations.size, 256)
  await assert.rejects(dispatchLive(next.directory, next.plan[0].id, approve(next, 'cap-next')), /Global per-model\/configuration dispatch ceiling/)
  assert.equal(calls.length, 0)
  assert.equal(openLiveLedger(globalDirectory).reservations.size, 256)
})

test('the global budget survives reopening and a new approval for the original run', async t => {
  const { createRun, approve } = await workspace(t)
  const state = await createRun('budget')
  const adapter = state.pins.adapters[0]
  // Exercise the ledger's finite boundary independently of admission's stricter
  // full-schedule cost check. No provider dispatch is authorized by this probe.
  state.pins.budgetMicroUsd = 150
  const first = { id: `item_${'1'.repeat(32)}`, approval: approve(state, 'budget-first').record, dispatched: true, reservationMicroUsd: 100 }
  assert.equal(reserveLiveDispatch(openLiveLedger(globalDirectory), state, adapter, first), true)
  const next = { ...first, id: `item_${'2'.repeat(32)}`, approval: approve(state, 'budget-next').record }
  assert.equal(reserveLiveDispatch(openLiveLedger(globalDirectory), state, adapter, next), false)
  const ledger = openLiveLedger(globalDirectory)
  assert.equal(ledger.reservations.size, 1)
  assert.equal([...ledger.reservations.values()][0].reservationMicroUsd, 100)
  assert.equal(calls.length, 0)
})

test('unknown mock outcomes retain the global reservation and block restart without a second dispatch', async t => {
  const { createRun, approve } = await workspace(t)
  const state = await createRun('unknown')
  const approval = approve(state, 'unknown')
  outcome = 'ambiguous'
  const result = await dispatchLive(state.directory, state.plan[0].id, approval)
  assert.equal(result.ambiguous, 1)
  assert.equal(calls.length, 1)
  assert.equal([...openLiveLedger(globalDirectory).reservations.values()][0].reservationMicroUsd, 100)
  await assert.rejects(dispatchLive(state.directory, state.plan[0].id, approval), /requires reconciliation/)
  assert.equal(calls.length, 1)
})

test('an interruption between global charging and the local intent fails closed on restart', async t => {
  const { createRun, approve } = await workspace(t)
  const state = await createRun('interrupted')
  const approval = approve(state, 'interrupted')
  interruptIntent = true
  await assert.rejects(dispatchLive(state.directory, state.plan[0].id, approval), /Simulated interruption/)
  interruptIntent = false
  assert.equal(openLiveLedger(globalDirectory).reservations.size, 1)
  await assert.rejects(dispatchLive(state.directory, state.plan[0].id, approval), /discrepancy requires reconciliation/)
  assert.equal(calls.length, 0)
})

test('corrupt, truncated and interrupted global ledger writes fail closed before another dispatch', async t => {
  for (const corruption of ['digest', 'truncated', 'temporary']) {
    await t.test(corruption, async t => {
      const { createRun, approve } = await workspace(t)
      const state = await createRun('corrupt')
      const approval = approve(state, 'corrupt')
      await dispatchLive(state.directory, state.plan[0].id, approval)
      const path = join(globalDirectory, readdirSync(globalDirectory).find(name => name.startsWith('reservation-')))
      if (corruption === 'truncated') writeFileSync(path, '{"version":')
      else if (corruption === 'temporary') writeFileSync(`${path}.interrupted.tmp`, '{"version":')
      else {
        const record = readJson(path)
        record.payload.reservationMicroUsd = 0
        writeFileSync(path, `${canonical(record)}\n`)
      }
      await assert.rejects(dispatchLive(state.directory, state.plan[1].id, approval))
      assert.equal(calls.length, 1)
    })
  }
})

test('removing a global reservation cannot reset an original run to an uncharged dispatch', async t => {
  const { createRun, approve } = await workspace(t)
  const state = await createRun('missing-charge')
  const approval = approve(state, 'missing-charge')
  await dispatchLive(state.directory, state.plan[0].id, approval)
  const name = readdirSync(globalDirectory).find(name => name.startsWith('reservation-'))
  rmSync(join(globalDirectory, name))
  await assert.rejects(dispatchLive(state.directory, state.plan[1].id, approval), /discrepancy requires reconciliation/)
  assert.equal(calls.length, 1)
})
