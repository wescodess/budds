import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import fs, { chmodSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { mock, test } from 'node:test'
import { syncBuiltinESMExports } from 'node:module'
import * as artifacts from './artifacts.mjs'
import { registerScorerImports, forbidNetwork } from './runtime.mjs'
import { mockNativeFetch } from '../../../tests/fixtures/learn-v2-scorer-harness/network-deny.mjs'

registerScorerImports()
forbidNetwork()
const adapters = await import('./adapters.mjs')
const contract = await import('./contract.mjs')
function immutable(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child)
    Object.freeze(value)
  }
  return value
}

// Compute fixture inputs with the real functions once, then share only frozen
// values. Mutable manifests/maps/files stay isolated. CLI coverage is uncached.
const verifiedCorpus = immutable(await contract.corpusInputs())
const verifiedImplementation = immutable(artifacts.implementationPins())
const fixtureClock = Date.now()
const runFixtures = new Map()
const schedules = new Map()
const requests = new Map()
const requestDigests = new WeakMap()
let globalDirectory
let interruptIntent = false
let outcome = 'valid'
const calls = []
const metadataCalls = []
let metadataOutcome = 'resolved'
let omitProvider = false
let publicationFailures = new Set()
let failuresAfterWrite = new Set()
let earlyFailures = new Set()
let earlyFailuresAfterWrite = new Set()
let lockReleaseFailure = false
let markerRemovalFailure = null
let revision = null
let afterIntent = null
let beforeBaselineTransport = null
let realAdapters = false
let preparationFailure = null
let abortBeforeSend = false
let baselineStatus = null
const PROVIDER_REFUSAL_TEXT = 'SYNTHETIC-PROVIDER-REFUSAL-TEXT'

// Keep the production CLI's fixed global path and transport unchanged. Native
// module mocks isolate this test process and deny every real network entry.
mock.module(new URL('./artifacts.mjs', import.meta.url).href, { namedExports: { ...artifacts,
  hash: value => requestDigests.get(value) ?? artifacts.hash(value),
  implementationPins: () => ({ ...verifiedImplementation, ...revision }),
  outputDirectory: path => artifacts.outputDirectory(path === artifacts.liveLedgerDirectory() ? globalDirectory : path),
  seal(...args) {
    if (interruptIntent && args[2] === 'dispatch_intent') throw new Error('Simulated interruption before local intent')
    if (earlyFailures.has(args[2])) throw new Error(`Simulated early publication failure: ${args[2]}`)
    if (calls.length && publicationFailures.has(args[2])) throw new Error(`Simulated publication failure: ${args[2]}`)
    const value = artifacts.seal(...args)
    if (args[2] === 'dispatch_intent') afterIntent?.(value.payload)
    if (earlyFailuresAfterWrite.has(args[2])) throw new Error(`Simulated early interrupted publication: ${args[2]}`)
    if (calls.length && failuresAfterWrite.has(args[2])) throw new Error(`Simulated interrupted publication: ${args[2]}`)
    return value
  },
  async exclusiveLock(directory, name, operation) {
    const result = await artifacts.exclusiveLock(directory, name, operation)
    if (lockReleaseFailure) {
      writeFileSync(join(directory, name), 'test-owned interrupted lock release\n')
      throw new Error('Simulated lock release failure')
    }
    return result
  },
  removeSealed(...args) {
    if (markerRemovalFailure === 'before') throw new Error('Simulated marker removal failure')
    artifacts.removeSealed(...args)
    if (markerRemovalFailure === 'after') throw new Error('Simulated interrupted marker removal')
  },
} })
mock.module(new URL('./contract.mjs', import.meta.url).href, { namedExports: { ...contract,
  corpusInputs: async () => verifiedCorpus,
  runPins: options => ({ ...contract.runPins(options), implementation: { ...verifiedImplementation, ...revision } }),
  schedule(corpus, sources, seed, adapters) {
    // The corpus mock fixes both corpus and sources. Reuse the real schedule
    // for each seed/adapter combination; callers cannot mutate this input.
    const key = artifacts.hash([seed, adapters])
    if (!schedules.has(key)) schedules.set(key, immutable(contract.schedule(corpus, sources, seed, adapters)))
    return schedules.get(key)
  },
} })
mock.module(new URL('./adapters.mjs', import.meta.url).href, { namedExports: { ...adapters,
  requestFor(adapter, blind) {
    const key = artifacts.canonical(adapter)
    if (!requests.has(key)) requests.set(key, new WeakMap())
    const cache = requests.get(key)
    if (!cache.has(blind)) {
      const request = immutable(adapters.requestFor(adapter, blind))
      cache.set(blind, request)
      requestDigests.set(request, artifacts.hash(request))
    }
    return cache.get(blind)
  },
  baselineExecution(options) {
    if (options.infer && preparationFailure) return Promise.reject(preparationFailure)
    return adapters.baselineExecution({ ...options, ...(options.infer ? { infer: (...args) => {
      beforeBaselineTransport?.()
      return options.infer(...args)
    } } : {}) }).then(result => !options.infer && baselineStatus ? { ...result, status: baselineStatus, scorePercent: null, criteria: null } : result)
  },
  async liveInfer(adapter, request, signal, baselineRequest) {
    if (realAdapters) return adapters.liveInfer(adapter, request, abortBeforeSend ? AbortSignal.abort() : signal, baselineRequest)
    calls.push({ adapter: adapter.id, requestDigest: artifacts.hash(request) })
    const body = JSON.parse(request.body)
    const payload = adapter.role === 'gemini' ? body.input : body.messages.find(row => row.role === 'user').content
    const scoringInput = JSON.parse(payload)
    const raw = adapters.fixtureEnvelope(adapter, { id: scoringInput.evidence[0].alias, payload, scoringInput }, outcome)
    if (omitProvider && adapter.role === 'baseline') {
      delete raw.provider
      delete raw.openrouter_metadata
    }
    calls.at(-1).raw = raw
    return raw
  },
  async liveMetadata(generationId, signal) {
    metadataCalls.push(generationId)
    assert.equal(signal.aborted, false)
    if (metadataOutcome === 'unavailable') throw new Error('Synthetic metadata unavailable')
    return { generationId: metadataOutcome === 'contradictory' ? 'other-generation' : generationId,
      returnedModel: metadataOutcome === 'wrong-model' ? 'openai/gpt-other' : metadataOutcome === 'missing-model' ? null : 'openai/gpt-4.1',
      servingProvider: metadataOutcome === 'wrong-provider' ? 'Other' : metadataOutcome === 'missing-provider' ? null : 'OpenAI', upstreamRequestId: null,
      finishReason: 'stop', nativeFinishReason: 'stop', cancelled: metadataOutcome === 'failed', usage: null }
  },
} })
const { initialize, planRun, dispatchLive, reconcileLive, replay } = await import('./runner.mjs')
const { main, cli, RUN_HALTED_MESSAGE } = await import('../../learn-v2-scorer-harness.mjs')
const { openLiveLedger, reserveLiveDispatch, unresolvedLiveDispatches } = await import('./live-ledger.mjs')
const { sealLearnScorerConfiguration } = await import('../../../convex/lib/learnV2ScorerConfig.ts')
const { canonical, hash, readJson, outputDirectory } = artifacts

process.env.NUXT_CLOUDFLARE_ACCOUNT_ID = 'approval-contract-account'
process.env.NUXT_CLOUDFLARE_AI_GATEWAY_ID = 'approval-contract-gateway'

async function workspace(t, approvalDurationMs = 600000, initialClock = fixtureClock) {
  const parent = mkdtempSync(join(tmpdir(), 'budds-c3-global-ledger-'))
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  const home = join(parent, 'home')
  globalDirectory = outputDirectory(join(home, '.budds', 'learn-v2-scorer-live'))
  calls.length = 0
  metadataCalls.length = 0
  outcome = 'valid'
  metadataOutcome = 'resolved'
  omitProvider = false
  publicationFailures = new Set()
  failuresAfterWrite = new Set()
  interruptIntent = false
  earlyFailures = new Set()
  earlyFailuresAfterWrite = new Set()
  lockReleaseFailure = false
  markerRemovalFailure = null
  revision = null
  afterIntent = null
  beforeBaselineTransport = null
  realAdapters = false
  preparationFailure = null
  abortBeforeSend = false
  baselineStatus = null
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
  const clock = initialClock
  let now = clock
  const clockMock = mock.method(Date, 'now', () => now)
  t.after(() => clockMock.mock.restore())
  const options = { mode: 'live', fixture: null, inventory, clock, seed: 'approval-contract-shuffle-v1',
    budgetMicroUsd: 100000, priceAccessDate: new Date(clock).toISOString().slice(0, 10) }
  const createRun = async name => {
    const directory = outputDirectory(join(parent, name))
    const key = hash([options, revision])
    if (!runFixtures.has(key)) {
      await initialize({ ...options, output: directory })
      runFixtures.set(key, { manifest: readJson(join(directory, 'manifest.json')), plan: await planRun(directory) })
    }
    const { manifest, plan } = structuredClone(runFixtures.get(key))
    artifacts.seal(directory, 'manifest.json', 'manifest', manifest.pinsDigest, manifest.payload)
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
      privacyApproved: true, payloadPolicy: artifacts.POLICY, issuedAt: clock, expiresAt: clock + approvalDurationMs, costEvidenceDigest: hash(cost) }
    return { approvalFile: signed(`${name}-approval.json`, approval), costFile: signed(`${name}-cost.json`, cost), trustKey,
      record: { approvalDigest: hash(approval), costDigest: hash(cost), ownerKeyDigest: hash(publicKey.export({ type: 'spki', format: 'der' })) } }
  }
  return { createRun, approve, signed, clock, home, setClock: value => { now = value } }
}

function syntheticKeys(t) {
  const keys = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'NUXT_OPENROUTER_API_KEY']
  const previous = keys.map(key => [key, process.env[key]])
  for (const key of keys) process.env[key] = 'local-synthetic-only'
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  })
  return () => { for (const key of keys) process.env[key] = 'local-synthetic-only' }
}

function nativeRedirect(url, request, mode, hops, finalResponse = { status: 400, body: 'Synthetic HTTP rejection' }) {
  const status = Number(/^redirect-(\d+)/.exec(mode)?.[1] ?? 302)
  const endpoint = new URL(url)
  const targets = [endpoint.href, 'https://unapproved.invalid/redirect-target', 'https://also-unapproved.invalid/final-target']
  return mockNativeFetch({ dispatch(options, handler) {
    const hop = { origin: String(options.origin), path: options.path, method: options.method, body: '' }
    hops.push(hop)
    assert.ok(hops.length <= 21, 'Only the bounded native redirect loop may repeat')
    const index = targets.indexOf(new URL(options.path, options.origin).href)
    assert.ok(index >= 0, 'Only synthetic redirect endpoints are accepted')
    queueMicrotask(async () => {
      let aborted = false
      handler.onConnect(error => { aborted = true; handler.onError(error) })
      try {
        const chunks = []
        for await (const chunk of options.body ?? []) chunks.push(Buffer.from(chunk))
        hop.body = Buffer.concat(chunks).toString('utf8')
        const redirect = index < 2 || mode === 'redirect-loop'
        const headers = mode.endsWith('no-location') ? []
          : [Buffer.from('location'), Buffer.from(targets[mode === 'redirect-loop' ? 1 : Math.min(index + 1, 2)])]
        handler.onHeaders(redirect ? status : mode.endsWith('503') ? 503 : finalResponse.status,
          redirect ? headers : [], () => {}, '')
        if (!aborted) {
          handler.onData(Buffer.from(finalResponse.body))
          handler.onComplete([])
        }
      }
      catch (error) { handler.onError(error) }
    })
    return true
  } })(url, request)
}

function syntheticHttp(t, setup, mode) {
  let responseMode = mode
  const resetKeys = syntheticKeys(t)
  const bodies = []
  const rejectedBody = (status, declared = false, cleanup = 'resolve', streamed = false) => {
    const transfer = { cancelled: 0 }
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(streamed ? contract.LIMITS.maxResponseBytes + 1 : 2)) },
      cancel() {
        transfer.cancelled++
        if (cleanup === 'throw') throw new Error('Synthetic cancellation failure')
        if (cleanup === 'reject') return Promise.reject(new Error('Synthetic cancellation rejection'))
        if (cleanup === 'pending') return new Promise(() => {})
      },
    })
    bodies.push({ body, signal: calls.at(-1).signal, count: () => transfer.cancelled })
    return new Response(body, { status, headers: declared ? { 'content-length': String(contract.LIMITS.maxResponseBytes + 1) } : {} })
  }
  realAdapters = true
  abortBeforeSend = mode === 'pre-send-abort'
  const timeouts = []
  const setTimer = globalThis.setTimeout
  if (['timeout', 'response-timeout'].includes(mode)) {
    const timerMock = mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
      if (delay > 0 && delay <= 90_000) timeouts.push(() => callback(...args))
      return setTimer(callback, delay, ...args)
    })
    t.after(() => timerMock.mock.restore())
  }
  const fetchMock = mock.method(globalThis, 'fetch', async (url, request) => {
    const adapter = setup.state.pins.adapters.find(adapter => adapter.endpoint === url)
    assert.ok(adapter, 'Only pinned synthetic HTTP requests are accepted')
    assert.equal(request.method, 'POST')
    assert.equal(request.signal.aborted, false)
    calls.push({ url, signal: request.signal })
    if (responseMode.startsWith('redirect-')) {
      const hops = calls.at(-1).hops = []
      return nativeRedirect(url, request, responseMode, hops)
    }
    if (responseMode === 'network-loss') throw new TypeError('Synthetic connection lost after send')
    if (responseMode === 'abort') throw new DOMException('Synthetic abort after send', 'AbortError')
    if (responseMode === 'classified-rejection') throw Object.assign(new Error('Synthetic classified rejection'), { aiGatewayFailureKind: 'definitive_failure' })
    const intent = readJson(join(setup.state.directory, `${setup.id}.intent.json`)).payload
    if (/^late-4\d\d$/.test(responseMode)) setup.setClock(intent.deadline + 1)
    if (responseMode === 'timeout') return new Promise((_resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(new DOMException('Synthetic timeout after send', 'AbortError')), { once: true })
      setTimer(() => {
        setup.setClock(intent.deadline)
        assert.ok(timeouts.length > 0)
        for (const timeout of timeouts) timeout()
      }, 0)
    })
    if (responseMode === 'backward-clock-200') setup.setClock(intent.startedAt - 5_000)
    if (responseMode.startsWith('provider-') || responseMode.startsWith('gemini-') || responseMode.startsWith('baseline-') || responseMode === 'missing-id-200' || responseMode === 'backward-clock-200') {
      const wire = JSON.parse(request.body)
      const payload = adapter.role === 'gemini' ? wire.input : wire.messages.find(row => row.role === 'user').content
      const scoringInput = JSON.parse(payload)
      const body = adapters.fixtureEnvelope(adapter, { id: setup.id, payload, scoringInput }, 'valid')
      delete body.requestId // This is harness metadata, not a native provider field.
      if (responseMode === 'missing-id-200') delete body.id
      if (responseMode === 'baseline-truncated') body.choices[0].finish_reason = 'length'
      if (responseMode === 'baseline-identity-mismatch') body.model = 'openai/wrong-model'
      if (responseMode === 'baseline-routing') body.openrouter_metadata.attempt = 2
      if (responseMode === 'baseline-upstream') {
        body.provider = 'Different observed provider'
        body.openrouter_metadata.endpoints.available[0].provider = body.provider
      }
      if (responseMode.startsWith('gemini-status-')) body.status = responseMode.slice('gemini-status-'.length)
      if (responseMode === 'gemini-thought') body.steps.unshift({ type: 'thought', summary: [{ type: 'text', text: 'Synthetic thought' }], signature: 'opaque' })
      if (responseMode === 'gemini-tool') body.steps.push({ type: 'tool_call', name: 'forbidden' })
      if (responseMode.startsWith('provider-failure-')) {
        const value = responseMode.slice('provider-failure-'.length)
        body.failure = value === 'null' ? null : value === 'false' ? false : value === 'empty' ? '' : value
      }
      if (responseMode === 'provider-requestId') body.requestId = 'provider-controlled-request-id'
      if (responseMode === 'provider-pinsDigest') body.pinsDigest = hash('provider-controlled-pins')
      if (responseMode === 'provider-accessRefusalStatus') body.accessRefusalStatus = 429
      if (responseMode === 'provider-extras') {
        body.providerExtra = { ignored: true }
        if (adapter.role === 'baseline') Object.assign(body, { failure: 'not_dispatched', accessRefusalStatus: 429, requestId: 'provider-controlled-id', pinsDigest: hash('provider-controlled-pins') })
      }
      return new Response(JSON.stringify(body), { headers: { 'request-id': 'synthetic-header-request-id' } })
    }
    const status = /(?:^|-)([2345]\d\d)$/.exec(responseMode)?.[1] ?? '400'
    if (responseMode === '204' || responseMode === '205') return new Response(null, { status: Number(responseMode) })
    if (responseMode === 'response-timeout' || responseMode.startsWith('body-')) {
      let sentChunk = false
      return new Response(new ReadableStream({
        pull(controller) {
          if (!sentChunk) {
            sentChunk = true
            controller.enqueue(new TextEncoder().encode('{'))
            return
          }
          if (responseMode === 'response-timeout') {
            request.signal.addEventListener('abort', () => controller.error(new DOMException('Synthetic body timeout', 'AbortError')), { once: true })
            setTimer(() => {
              setup.setClock(intent.deadline)
              assert.ok(timeouts.length > 0)
              for (const timeout of timeouts) timeout()
            }, 0)
          }
          else controller.error(responseMode === 'body-abort-200'
            ? new DOMException('Synthetic body abort', 'AbortError')
            : Object.assign(new TypeError('Synthetic body reset'), { code: 'ECONNRESET' }))
        },
      }), { status: responseMode === 'response-timeout' ? 200 : Number(status) })
    }
    if (responseMode.includes('malformed-200')) {
      if (responseMode.startsWith('late-')) setup.setClock(intent.deadline + 1)
      return new Response('{', { status: 200 })
    }
    if (responseMode === 'null-200') return new Response('null', { status: 200 })
    if (responseMode === 'array-200') return new Response('[]', { status: 200 })
    if (responseMode === 'primitive-200') return new Response('"synthetic"', { status: 200 })
    if (responseMode.startsWith('oversized-')) return rejectedBody(Number(status), false, responseMode.includes('cancel') ? 'throw' : 'resolve', true)
    if (responseMode.startsWith('declared-')) return rejectedBody(200, true, /declared-(reject|throw|pending)-/.exec(responseMode)?.[1] ?? 'resolve')
    if (responseMode.startsWith('refusal-text-')) return new Response(PROVIDER_REFUSAL_TEXT, { status: Number(status) })
    return rejectedBody(Number(status))
  })
  t.after(() => fetchMock.mock.restore())
  const reset = () => {
    responseMode = '400'
    abortBeforeSend = false
    resetKeys()
  }
  reset.verifyCleanup = async () => {
    for (const { body, signal, count } of bodies) {
      assert.equal(count(), 1, 'Each unread body must be cancelled once')
      assert.equal(signal.aborted, false, 'Body cleanup does not abort the caller or change its result')
      assert.equal(body.locked, false)
      const reader = body.getReader()
      try { assert.deepEqual(await reader.read(), { done: true, value: undefined }, 'No rejected body may remain open') }
      finally { reader.releaseLock() }
    }
  }
  return reset
}

// One executable contract for all adapters. Only the synthetic HTTP boundary
// is replaced; capture, sealing, replay, reconciliation and admission are real.
const transportOutcomes = [
  ['400', 'definitive_failure'], ['401', 'definitive_failure'], ['402', 'definitive_failure'], ['403', 'definitive_failure'], ['429', 'definitive_failure'],
  ['500', 'outcome_unknown'], ['503', 'outcome_unknown'],
  ['204', 'invalid_response'], ['205', 'invalid_response'],
  ...[301, 302, 303, 307, 308].map(status => [`redirect-${status}-to-400`, 'outcome_unknown']),
  ['redirect-302-no-location', 'outcome_unknown'],
  ['redirect-302-to-503', 'outcome_unknown'], ['redirect-loop', 'outcome_unknown'],
  ['late-400', 'definitive_failure'], ['late-429', 'definitive_failure'], ['classified-rejection', 'definitive_failure'],
  ['network-loss', 'outcome_unknown'], ['timeout', 'outcome_unknown'], ['abort', 'outcome_unknown'],
  ['response-timeout', 'outcome_unknown'], ['body-reset-200', 'outcome_unknown'], ['body-abort-200', 'outcome_unknown'],
  ['malformed-200', 'invalid_response'], ['late-malformed-200', 'invalid_response'], ['null-200', 'invalid_response'],
  ['array-200', 'invalid_response'], ['primitive-200', 'invalid_response'],
  ['oversized-200', 'invalid_response'], ['declared-oversized-200', 'invalid_response'], ['oversized-cancel-200', 'invalid_response'],
  ['declared-reject-200', 'invalid_response'], ['declared-throw-200', 'invalid_response'], ['declared-pending-200', 'invalid_response'],
  ['oversized-400', 'definitive_failure'], ['oversized-429', 'definitive_failure'], ['oversized-500', 'outcome_unknown'],
  ['body-reset-400', 'definitive_failure'], ['body-reset-429', 'definitive_failure'], ['body-reset-500', 'outcome_unknown'],
  ['missing-key', 'not_dispatched'], ['pre-send-abort', 'not_dispatched'],
  ...['not_dispatched', 'definitive_failure', 'outcome_unknown', 'invalid_response', 'null', 'false', 'empty']
    .map(value => [`provider-failure-${value}`, 'invalid_response', ['claude', 'gemini']]),
  ...['requestId', 'pinsDigest', 'accessRefusalStatus'].map(key => [`provider-${key}`, 'invalid_response', ['claude', 'gemini']]),
  ['missing-id-200', 'invalid_response'],
  ...[['in_progress', 'ambiguous'], ['requires_action', 'truncated'], ['requires_continuation', 'truncated'], ['incomplete', 'truncated'],
    ['failed', 'definitive_failure'], ['cancelled', 'definitive_failure']].map(([status, result]) => [`gemini-status-${status}`, null, ['gemini'], result]),
  ['gemini-thought', null, ['gemini'], 'valid'], ['gemini-tool', null, ['gemini'], 'malformed'],
  ['baseline-truncated', null, ['baseline'], 'nonterminal_output'], ['baseline-identity-mismatch', null, ['baseline'], 'identity_mismatch'],
  ['baseline-routing', null, ['baseline'], 'unexpected_routing'], ['baseline-upstream', null, ['baseline'], 'valid'],
]
for (const [mode, failure, roles = ['baseline', 'claude', 'gemini'], nativeStatus] of transportOutcomes) {
  test(`A9 transport table ${mode}: classification, replay and admission`, async t => {
    for (const role of roles) await t.test(role, async t => {
      const setup = await canary(t, role)
      const { state, approval, id, createRun, approve } = setup
      const before = calls.length
      const rejectNextRequest = syntheticHttp(t, setup, mode)
      if (mode === 'missing-key') {
        if (role === 'baseline') process.env.OPENROUTER_API_KEY = process.env.NUXT_OPENROUTER_API_KEY = ''
        else process.env[role === 'claude' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY'] = ''
      }
      const summary = await dispatchLive(state.directory, id, approval)
      await rejectNextRequest.verifyCleanup()
      if (mode.startsWith('redirect-')) {
        const sent = calls.at(-1)
        const endpoint = new URL(sent.url)
        assert.deepEqual(sent.hops.map(hop => ({ origin: hop.origin, path: hop.path, method: hop.method })),
          [{ origin: endpoint.origin, path: endpoint.pathname + endpoint.search, method: 'POST' }],
        'One approved intent permits exactly one POST to its approved origin, without a redirect hop')
        assert.equal(sent.hops[0].body, readJson(join(state.directory, `${id}.intent.json`)).payload.request.body)
      }
      const terminal = readJson(join(state.directory, `${id}.terminal.json`))
      const expectedStatus = nativeStatus ?? (failure === 'outcome_unknown' ? 'ambiguous' : failure === 'invalid_response' ? 'malformed' : failure)
      const unknown = expectedStatus === 'ambiguous'
      const notSent = failure === 'not_dispatched'
      const refusalStatus = Number(/^(?:late-|oversized-|body-reset-)?(401|402|403|429)$/.exec(mode)?.[1]) || null
      if (nativeStatus) assert.equal(Object.hasOwn(terminal.payload.raw, 'failure'), false)
      else assert.deepEqual(terminal.payload.raw, { failure, ...(refusalStatus ? { accessRefusalStatus: refusalStatus } : {}) })
      assert.equal(summary.halted?.httpStatus ?? null, refusalStatus)
      assert.equal(terminal.payload.result.status, expectedStatus)
      assert.equal(summary.ambiguous, Number(unknown))
      assert.equal(summary.dispatched, before + Number(!notSent))
      assert.equal(calls.length, before + Number(!notSent))
      assert.equal(readJson(summary.report).payload.reservations.retainedMicroUsd, (before + Number(!notSent)) * 100)
      const ledger = await openLiveLedger(globalDirectory)
      assert.equal([...ledger.reservations.values()].filter(row => row.intentDigest === terminal.payload.intentDigest).length, 1)
      const charged = [...ledger.reservations].filter(([name]) => ledger.resolutions.get(name)?.status !== 'not_dispatched')
      assert.equal(charged.length, before + Number(!notSent))
      assert.equal(charged.reduce((total, [, row]) => total + row.reservationMicroUsd, 0), (before + Number(!notSent)) * 100)
      assert.equal(unresolvedLiveDispatches(ledger).length, Number(unknown))
      const resolvedStatus = notSent ? 'not_dispatched' : unknown ? 'still_unknown' : expectedStatus === 'valid' ? 'resolved' : 'failed'
      if (!unknown) assert.equal([...ledger.resolutions.values()].find(row => row.intentDigest === terminal.payload.intentDigest).status, resolvedStatus)
      assert.equal((await replay(state.directory)).digest, summary.digest, 'Sealed classification must reproduce exactly')
      assert.equal((await reconcileLive(state.directory, id, approval)).reconciliation, resolvedStatus)
      if (mode.startsWith('provider-')) {
        const files = readdirSync(globalDirectory).sort()
        for (let attempt = 0; attempt < 2; attempt++) {
          const recovered = await reconcileLive(state.directory, id, approval)
          assert.equal(recovered.reconciliation, 'failed')
          assert.equal(recovered.dispatched, before + 1)
          assert.equal(readJson(recovered.report).payload.reservations.retainedMicroUsd, (before + 1) * 100)
          assert.equal(artifacts.exists(join(state.directory, `${id}.not-dispatched.json`)), false, 'Provider fields never authorize cancellation')
          assert.deepEqual(readdirSync(globalDirectory).sort(), files, 'Repeated recovery cannot release or rewrite the charge')
        }
      }
      assert.equal(calls.length, before + Number(!notSent), 'Replay and reconciliation never retry inference')
      assert.equal(metadataCalls.length, 0)
      if (refusalStatus) {
        const later = state.plan[state.plan.findIndex(row => row.id === id) + 1].id
        assert.equal((await dispatchLive(state.directory, later, approval)).halted.httpStatus, refusalStatus)
        assert.equal(calls.length, before + 1, 'A halted run refuses later dispatches without transport')
        assert.equal(artifacts.exists(join(state.directory, `${later}.intent.json`)), false)
      }
      const next = await createRun('separately-approved')
      const nextApproval = approve(next, 'separate')
      if (unknown) await assert.rejects(dispatchLive(next.directory, next.plan[0].id, nextApproval), /requires reconciliation/)
      else {
        // A separate synthetic 400 proves admission without depending on a valid grade.
        rejectNextRequest()
        await dispatchLive(next.directory, next.plan[0].id, nextApproval)
      }
      assert.equal(calls.length, before + Number(!notSent) + Number(!unknown))
      await dispatchLive(state.directory, id, approval).then(() => assert.ok(!unknown), () => assert.ok(unknown))
      assert.equal(calls.length, before + Number(!notSent) + Number(!unknown), 'Original intent cannot be redispatched or refunded')
      await rejectNextRequest.verifyCleanup()
    })
  })
}

test('A12 response projection keeps native fields and excludes provider metadata from harness state', async t => {
  for (const role of ['baseline', 'claude', 'gemini']) await t.test(role, async t => {
    const setup = await canary(t, role)
    const { state, approval, id } = setup
    const before = calls.length
    syntheticHttp(t, setup, 'provider-extras')
    const summary = await dispatchLive(state.directory, id, approval)
    const { raw, result } = readJson(join(state.directory, `${id}.terminal.json`)).payload
    assert.equal(result.status, 'valid')
    for (const key of ['failure', 'accessRefusalStatus', 'pinsDigest', 'providerExtra']) assert.equal(Object.hasOwn(raw, key), false)
    if (role === 'baseline') {
      assert.equal(Object.hasOwn(raw, 'requestId'), false)
      assert.ok(raw.scoringProvenance.metadataValid)
    }
    else {
      assert.equal(raw.requestId, 'synthetic-header-request-id')
      assert.deepEqual(Object.keys(raw).sort(), ['id', 'model', 'usage', 'requestId', ...(role === 'claude' ? ['stop_reason', 'content'] : ['status', 'steps'])].sort())
    }
    assert.equal((await replay(state.directory)).digest, summary.digest)
    assert.equal(calls.length, before + 1)
  })
})

test('A12 provider outcome rejection recovers a missing terminal without cancellation or release', async t => {
  for (const role of ['claude', 'gemini']) await t.test(role, async t => {
    const setup = await canary(t, role)
    const { state, approval, id } = setup
    const before = calls.length
    syntheticHttp(t, setup, 'provider-failure-not_dispatched')
    publicationFailures.add('sealed_verdict')
    await assert.rejects(dispatchLive(state.directory, id, approval), /Simulated publication failure/)
    publicationFailures.clear()
    assert.deepEqual(readJson(join(state.directory, `${id}.observation.json`)).payload.raw, { failure: 'invalid_response' })
    for (let attempt = 0; attempt < 3; attempt++) {
      const summary = await reconcileLive(state.directory, id, approval)
      assert.equal(summary.reconciliation, 'failed')
      assert.equal(summary.dispatched, before + 1)
      assert.equal(readJson(summary.report).payload.reservations.retainedMicroUsd, (before + 1) * 100)
      assert.equal(artifacts.exists(join(state.directory, `${id}.not-dispatched.json`)), false)
      assert.equal(readJson(join(state.directory, `${id}.terminal.json`)).payload.result.status, 'malformed')
    }
    assert.equal(calls.length, before + 1)
    assert.equal(metadataCalls.length, 0)
  })
})

test('A12 unresolved terminal and reconciliation never publish a global resolution', async t => {
  for (const role of ['baseline', 'claude', 'gemini']) await t.test(role, async t => {
    const setup = await canary(t, role)
    const { state, approval, id } = setup
    const before = calls.length
    const resolutions = () => readdirSync(globalDirectory).filter(name => name.startsWith('resolution-')).sort()
    const original = resolutions()
    syntheticHttp(t, setup, 'network-loss')
    const summary = await dispatchLive(state.directory, id, approval)
    assert.equal(summary.ambiguous, 1)
    assert.deepEqual(resolutions(), original, 'Unknown terminal must not publish a global resolution')
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.equal((await reconcileLive(state.directory, id, approval)).reconciliation, 'still_unknown')
      assert.deepEqual(resolutions(), original, 'Unknown reconciliation must not publish a global resolution')
      const ledger = await openLiveLedger(globalDirectory)
      assert.equal(unresolvedLiveDispatches(ledger).length, 1)
      assert.equal([...ledger.resolutions.values()].some(row => row.id === id), false)
    }
    await assertBlocked(setup, before + 1)
    assert.equal(metadataCalls.length, 0)
  })
})

test('A11 non-scoring gateway calls preserve native redirect following', async t => {
  syntheticKeys(t)
  const { generateCompletion } = await import('../../../server/utils/ai-gateway.ts')
  const response = { id: 'synthetic-completion', model: 'synthetic-model',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{}' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
  for (const status of [301, 302, 303, 307, 308]) await t.test(String(status), async t => {
    const hops = []
    const fetchMock = mock.method(globalThis, 'fetch', (url, request) => nativeRedirect(url, request, `redirect-${status}`, hops, { status: 200, body: JSON.stringify(response) }))
    t.after(() => fetchMock.mock.restore())
    assert.deepEqual(await generateCompletion({ model: response.model, messages: [{ role: 'user', content: 'Synthetic redirect control' }] }), response)
    assert.equal(hops.length, 3)
    assert.deepEqual(hops.map(row => row.origin), ['https://gateway.ai.cloudflare.com', 'https://unapproved.invalid', 'https://also-unapproved.invalid'])
    assert.deepEqual(hops.map(row => row.method), [301, 302, 303].includes(status) ? ['POST', 'GET', 'GET'] : ['POST', 'POST', 'POST'])
    assert.ok(hops[0].body.length > 0)
    assert.ok(hops.slice(1).every(row => row.body === ([301, 302, 303].includes(status) ? '' : hops[0].body)))
  })
})

test('A10 cancellation failures and pending cleanup cannot delay or change a completed invalid response', async t => {
  syntheticKeys(t)
  for (const role of ['baseline', 'claude', 'gemini']) for (const declared of [true, false]) for (const cleanup of ['pending', 'sync']) {
    await t.test(`${role}/${declared ? 'declared' : 'streamed'}/${cleanup}`, async t => {
      let cancelled = 0
      const body = new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(contract.LIMITS.maxResponseBytes + 1)) },
        cancel() { cancelled++; return cleanup === 'pending' ? new Promise(() => {}) : undefined },
      })
      if (cleanup === 'sync') {
        const throwingCancel = cancel => () => {
          void cancel().catch(() => undefined)
          throw new Error('Synthetic synchronous cancellation failure after closing')
        }
        body.cancel = throwingCancel(body.cancel.bind(body))
        const getReader = body.getReader.bind(body)
        body.getReader = (...args) => {
          const reader = getReader(...args)
          reader.cancel = throwingCancel(reader.cancel.bind(reader))
          return reader
        }
      }
      const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(body, {
        headers: declared ? { 'content-length': String(contract.LIMITS.maxResponseBytes + 1) } : {},
      }))
      t.after(() => fetchMock.mock.restore())
      const request = { model: 'openai/gpt-4.1', messages: [{ role: 'user', content: 'Synthetic cleanup contract' }], maxResponseBytes: contract.LIMITS.maxResponseBytes }
      const result = await Promise.race([
        adapters.liveInfer({ role, endpoint: 'https://cleanup.invalid', api: 'synthetic' }, { body: '{}' }, new AbortController().signal, request).catch(error => error),
        new Promise(resolve => setTimeout(() => resolve(null), 50)),
      ])
      assert.equal(result?.aiGatewayFailureKind, 'invalid_response')
      assert.equal(cancelled, 1)
      const reader = body.getReader()
      try { assert.equal((await reader.read()).done, true) }
      finally { reader.releaseLock() }
    })
  }
})

test('A8 pre-send preparation rejections remain not dispatched', async t => {
  for (const point of ['prepare', 'infer-wrapper']) await t.test(point, async t => {
    const setup = await canary(t, 'baseline')
    const { state, approval, id } = setup
    syntheticHttp(t, setup, '400')
    const error = Object.assign(new Error('Synthetic rejection before transport'), { aiGatewayFailureKind: 'definitive_failure' })
    if (point === 'prepare') preparationFailure = error
    else beforeBaselineTransport = () => { throw error }
    const before = calls.length
    const summary = await dispatchLive(state.directory, id, approval)
    preparationFailure = null
    beforeBaselineTransport = null
    assert.equal(calls.length, before)
    assert.equal(readJson(join(state.directory, `${id}.terminal.json`)).payload.result.status, 'not_dispatched')
    assert.equal(readJson(join(state.directory, `${id}.not-dispatched.json`)).payload.reason, 'transport_rejected_before_send')
    assert.equal(summary.ambiguous, 0)
    assert.equal(readJson(summary.report).payload.reservations.retainedMicroUsd, before * 100)
    assert.equal((await replay(state.directory)).digest, summary.digest)
    assert.equal((await reconcileLive(state.directory, id, approval)).reconciliation, 'not_dispatched')
    assert.equal(unresolvedLiveDispatches(await openLiveLedger(globalDirectory)).length, 0)
  })
})

test('A8 real transport: definitive rejection survives interrupted terminal publication', async t => {
  for (const role of ['baseline', 'claude', 'gemini']) await t.test(role, async t => {
    const setup = await canary(t, role)
    const { state, approval, id } = setup
    const before = calls.length
    syntheticHttp(t, setup, '400')
    publicationFailures.add('sealed_verdict')
    await assert.rejects(dispatchLive(state.directory, id, approval), /Simulated/)
    publicationFailures.clear()
    assert.deepEqual(readJson(join(state.directory, `${id}.observation.json`)).payload.raw, { failure: 'definitive_failure' })
    const summary = await reconcileLive(state.directory, id, approval)
    assert.equal(summary.reconciliation, 'failed')
    assert.equal(summary.ambiguous, 0)
    assert.equal(readJson(summary.report).payload.reservations.retainedMicroUsd, (before + 1) * 100)
    assert.equal((await replay(state.directory)).digest, summary.digest)
    assert.equal(unresolvedLiveDispatches(await openLiveLedger(globalDirectory)).length, 0)
    assert.equal(calls.length, before + 1)
    assert.equal(metadataCalls.length, 0)
  })
})

test('A8 pre-send records reject impossible timestamps and unknown reasons before terminal publication', async t => {
  for (const change of ['before-intent', 'expired-rejection', 'unknown-reason']) await t.test(change, async t => {
    const setup = await canary(t, 'baseline')
    const { state, approval, id } = setup
    syntheticHttp(t, setup, '400')
    process.env.OPENROUTER_API_KEY = process.env.NUXT_OPENROUTER_API_KEY = ''
    earlyFailures.add('sealed_verdict')
    await assert.rejects(dispatchLive(state.directory, id, approval), /Simulated/)
    earlyFailures.clear()
    assert.ok(!artifacts.exists(join(state.directory, `${id}.terminal.json`)))
    const intent = readJson(join(state.directory, `${id}.intent.json`)).payload
    rewrite(join(state.directory, `${id}.not-dispatched.json`), value => {
      if (change === 'before-intent') value.payload.checkedAt = intent.startedAt - 1
      if (change === 'expired-rejection') value.payload.checkedAt = intent.deadline
      if (change === 'unknown-reason') value.payload.reason = 'unknown'
    })
    await assert.rejects(openLiveLedger(globalDirectory), /Invalid not-dispatched record/)
    await assert.rejects(replay(state.directory), /Invalid not-dispatched record/)
    await assert.rejects(reconcileLive(state.directory, id, approval), /Invalid not-dispatched record/)
    assert.equal(calls.length, 0)
  })
})

test('A9 pre-send cancellation requires the signed approval bound even with an unexpired lease', async t => {
  const setup = await canary(t, 'baseline', 1_000)
  const { state, approval, id } = setup
  syntheticHttp(t, setup, '400')
  process.env.OPENROUTER_API_KEY = process.env.NUXT_OPENROUTER_API_KEY = ''
  earlyFailures.add('sealed_verdict')
  await assert.rejects(dispatchLive(state.directory, id, approval), /Simulated/)
  earlyFailures.clear()
  const intent = readJson(join(state.directory, `${id}.intent.json`)).payload
  assert.ok(intent.approval.validUntil < intent.deadline)
  rewrite(join(state.directory, `${id}.not-dispatched.json`), value => {
    value.payload.checkedAt = intent.approval.validUntil
  })
  await assert.rejects(openLiveLedger(globalDirectory), /Invalid not-dispatched record/)
  await assert.rejects(replay(state.directory), /Invalid not-dispatched record/)
  await assert.rejects(reconcileLive(state.directory, id, approval), /Invalid not-dispatched record/)
  assert.equal(calls.length, 0)
})

function advanceRevision() {
  const implementation = artifacts.implementationPins()
  revision = { repositoryCommit: '1'.repeat(40), files: { ...implementation.files,
    'pnpm-lock.yaml': hash('next lockfile'), 'scripts/lib/learn-v2-scorer/adapters.mjs': hash('next adapter implementation') } }
}

function lossPath(state, id, kind) {
  if (kind === 'run-directory') return state.directory
  if (kind === 'local-intent') return join(state.directory, `${id}.intent.json`)
  const prefix = kind === 'consumption' ? 'approval-' : 'reservation-'
  return join(globalDirectory, readdirSync(globalDirectory).find(name => name.startsWith(prefix)
    && (kind === 'consumption' || readJson(join(globalDirectory, name)).payload.id === id)))
}

for (const kind of ['reservation', 'local-intent', 'consumption', 'run-directory']) {
  test(`A6 consumed run: lost ${kind} blocks a separately approved run`, async t => {
    for (const gap of ['missing', 'unreadable', 'mismatched']) await t.test(gap, async t => {
      const { createRun, approve } = await workspace(t)
      const first = await createRun('unresolved')
      const second = await createRun('separately-approved')
      const nextApproval = approve(second, 'distinct')
      const id = first.plan[0].id
      publicationFailures.add('dispatch_observation')
      await assert.rejects(dispatchLive(first.directory, id, approve(first, 'original')), /Simulated/)
      publicationFailures.clear()
      assert.equal(calls.length, 1)
      assert.ok(!artifacts.exists(join(globalDirectory, 'unresolved.json')))
      assert.ok(!readdirSync(globalDirectory).some(name => name.startsWith('resolution-')))
      const path = lossPath(first, id, kind)
      const evidence = kind === 'run-directory' ? join(path, 'manifest.json') : path
      if (gap === 'missing') rmSync(path, { recursive: true })
      if (gap === 'unreadable') chmodSync(evidence, 0o000)
      if (gap === 'mismatched') {
        const value = readJson(evidence)
        value.payload.changed = true
        writeFileSync(evidence, `${canonical(value)}\n`)
      }
      calls.length = 0
      try {
        await assert.rejects(openLiveLedger(globalDirectory), undefined, 'Admission must detect the gap, even without a resolution or marker')
        await assert.rejects(dispatchLive(second.directory, second.plan[0].id, nextApproval))
        assert.equal(calls.length, 0)
        assert.equal(metadataCalls.length, 0)
        if (kind === 'run-directory' && gap === 'missing') assert.ok(!artifacts.exists(path), 'Admission cannot recreate a lost run directory')
      }
      finally { if (gap === 'unreadable') chmodSync(evidence, 0o600) }
    })
  })
}

test('A6 control: a fully resolved consumed run with intact files permits a separate approval', async t => {
  const { createRun, approve } = await workspace(t)
  const first = await createRun('resolved')
  await dispatchLive(first.directory, first.plan[0].id, approve(first, 'original'))
  const consumption = readJson(lossPath(first, first.plan[0].id, 'consumption'))
  assert.equal(consumption.payload.directory, first.directory, 'Consumption durably indexes its run directory')
  const second = await createRun('separately-approved')
  calls.length = 0
  await dispatchLive(second.directory, second.plan[0].id, approve(second, 'distinct'))
  assert.equal(calls.length, 1)
  assert.equal(metadataCalls.length, 0)
  assert.equal(unresolvedLiveDispatches(await openLiveLedger(globalDirectory)).length, 0)
})

test('A6 consumption: a claim without a reservation still requires its matching local manifest', async t => {
  for (const change of ['budget', 'mode', 'directory']) await t.test(change, async t => {
    const { createRun, approve } = await workspace(t)
    const first = await createRun('consumed-only')
    earlyFailures.add('live_dispatch_reservation')
    await assert.rejects(dispatchLive(first.directory, first.plan[0].id, approve(first, 'original')), /Simulated/)
    earlyFailures.clear()
    const path = lossPath(first, first.plan[0].id, 'consumption')
    if (change === 'budget') rewrite(path, value => { value.payload.budgetMicroUsd++ })
    if (change === 'mode') {
      const manifest = rewrite(join(first.directory, 'manifest.json'), value => {
        value.payload.mode = 'offline'
        value.pinsDigest = hash(value.payload)
      })
      rewrite(path, value => { value.pinsDigest = value.payload.pinsDigest = manifest.pinsDigest })
    }
    if (change === 'directory') {
      renameSync(first.directory, `${first.directory}-moved`)
      symlinkSync(`${first.directory}-moved`, first.directory, 'dir')
    }
    const second = await createRun('separately-approved')
    await assert.rejects(openLiveLedger(globalDirectory))
    await assert.rejects(dispatchLive(second.directory, second.plan[0].id, approve(second, 'distinct')))
    assert.equal(calls.length, 0)
  })
})

test('A6 dispatch boundary: file loss after admission prevents every transport', async t => {
  for (const role of ['baseline', 'claude', 'gemini', 'baseline-preparation']) {
    for (const kind of ['reservation', 'local-intent', 'consumption', 'run-directory']) await t.test(`${role}/${kind}`, async t => {
      const { state, approval, id } = await canary(t, role === 'baseline-preparation' ? 'baseline' : role)
      calls.length = 0
      const lose = () => rmSync(lossPath(state, id, kind), { recursive: true })
      if (role === 'baseline-preparation') beforeBaselineTransport = lose
      else afterIntent = lose
      await assert.rejects(dispatchLive(state.directory, id, approval))
      afterIntent = null
      beforeBaselineTransport = null
      assert.equal(calls.length, 0, 'The final consistency check must precede transport')
      assert.equal(metadataCalls.length, 0)
    })
  }
})

test('A6 dispatch boundary: a newly lost historical resolution blocks the pending dispatch', async t => {
  const { createRun, approve } = await workspace(t)
  const first = await createRun('resolved')
  await dispatchLive(first.directory, first.plan[0].id, approve(first, 'original'))
  const second = await createRun('pending')
  const path = join(globalDirectory, readdirSync(globalDirectory).find(name => name.startsWith('resolution-')))
  afterIntent = () => rmSync(path)
  calls.length = 0
  await assert.rejects(dispatchLive(second.directory, second.plan[0].id, approve(second, 'distinct')), /requires reconciliation/)
  afterIntent = null
  assert.equal(calls.length, 0)
})

test('A4 historical pins: a separately approved fresh run dispatches after commit, source and lockfile changes', async t => {
  const { createRun, approve } = await workspace(t)
  const historical = await createRun('historical')
  await dispatchLive(historical.directory, historical.plan[0].id, approve(historical, 'historical'))
  advanceRevision()
  await assert.rejects(dispatchLive(historical.directory, historical.plan[1].id, approve(historical, 'historical')), /pins are stale/)
  const fresh = await createRun('fresh')
  assert.notEqual(fresh.pinsDigest, historical.pinsDigest)
  await dispatchLive(fresh.directory, fresh.plan[0].id, approve(fresh, 'fresh'))
  assert.equal(calls.length, 2)
  assert.equal(unresolvedLiveDispatches(await openLiveLedger(globalDirectory)).length, 0)
})

test('A5 historical admission: Node patch, minor, major and unavailable historical commits do not block fresh approvals', async t => {
  for (const change of ['patch', 'minor', 'major', 'missing-commit']) await t.test(change, async t => {
    const { createRun, approve } = await workspace(t)
    if (change === 'missing-commit') {
      const pins = artifacts.implementationPins()
      revision = { repositoryCommit: '2'.repeat(40), files: { ...pins.files, 'pnpm-lock.yaml': hash('unavailable historical lockfile') } }
    }
    const historical = await createRun('historical')
    await dispatchLive(historical.directory, historical.plan[0].id, approve(historical, 'historical'))
    const [major, minor, patch] = process.versions.node.split('.').map(Number)
    revision = change === 'missing-commit' ? null : { node: change === 'patch' ? `${major}.${minor}.${patch + 1}`
      : change === 'minor' ? `${major}.${minor + 1}.0` : `${major + 1}.0.0` }
    const fresh = await createRun('fresh')
    assert.notEqual(fresh.pinsDigest, historical.pinsDigest)
    await dispatchLive(fresh.directory, fresh.plan[0].id, approve(fresh, 'fresh'))
    assert.equal(calls.length, 2)
    assert.equal(metadataCalls.length, 0)
    assert.equal(unresolvedLiveDispatches(await openLiveLedger(globalDirectory)).length, 0)
  })
})

test('A5 historical structure: truncated, missing, orphaned and inconsistent evidence still blocks', async t => {
  for (const change of ['truncated', 'missing-observation', 'request-digest', 'orphan', 'terminal-observation', 'resolution-status']) await t.test(change, async t => {
    const { createRun, approve } = await workspace(t)
    const old = await createRun('historical')
    const id = old.plan[0].id
    await dispatchLive(old.directory, id, approve(old, 'historical'))
    if (change === 'truncated') writeFileSync(join(old.directory, `${id}.terminal.json`), '{')
    if (change === 'missing-observation') rmSync(join(old.directory, `${id}.observation.json`))
    if (change === 'request-digest') rewrite(join(old.directory, `${id}.intent.json`), value => { value.payload.requestDigest = hash('changed') })
    if (change === 'orphan') artifacts.seal(old.directory, `item_${'f'.repeat(32)}.observation.json`, 'dispatch_observation', old.pinsDigest, {})
    if (change === 'terminal-observation') rewrite(join(old.directory, `${id}.terminal.json`), value => { value.payload.raw = { failure: 'changed' } })
    if (change === 'resolution-status') {
      const name = readdirSync(globalDirectory).find(name => name.startsWith('resolution-'))
      rewrite(join(globalDirectory, name), value => { value.payload.status = 'failed' })
    }
    if (change === 'terminal-observation') {
      const { openRun } = await import('./run-state.mjs')
      await assert.rejects(openRun(old.directory, { sealedOnly: true }), /Terminal differs from saved observation/)
    }
    advanceRevision()
    const fresh = await createRun('fresh')
    await assert.rejects(dispatchLive(fresh.directory, fresh.plan[0].id, approve(fresh, 'fresh')))
    assert.equal(calls.length, 1)
    assert.equal(metadataCalls.length, 0)
  })
})

test('A5 structural intent: a saved request must match its digest before any terminal exists', async t => {
  const { createRun, approve } = await workspace(t)
  const state = await createRun('intent')
  const id = state.plan[0].id
  await dispatchLive(state.directory, id, { ...approve(state, 'intent'), crashAfterIntent: true })
  rewrite(join(state.directory, `${id}.intent.json`), value => { value.payload.requestDigest = hash('changed request') })
  const { openRun } = await import('./run-state.mjs')
  await assert.rejects(openRun(state.directory, { sealedOnly: true }), /Sealed request digest changed/)
  assert.equal(calls.length, 0)
})

test('A5 own recovery: already-sealed known outcomes recover by digest across versions without new I/O', async t => {
  for (const evidence of ['terminal', 'reconciled', 'cancellation', 'cancellation-only']) await t.test(evidence, async t => {
    const setup = evidence === 'reconciled' ? await pendingBaseline(t) : await canary(t, 'baseline')
    const { state, approval, id } = setup
    if (evidence === 'reconciled') await reconcileLive(state.directory, id, approval)
    else {
      if (evidence.startsWith('cancellation')) afterIntent = intent => setup.setClock(intent.deadline)
      publicationFailures.add('live_dispatch_resolution')
      if (evidence.startsWith('cancellation')) earlyFailures.add(evidence === 'cancellation-only' ? 'sealed_verdict' : 'live_dispatch_resolution')
      await assert.rejects(dispatchLive(state.directory, id, approval), /Simulated/)
      publicationFailures.clear()
      earlyFailures.clear()
      afterIntent = null
    }
    const before = calls.length
    const lookups = metadataCalls.length
    advanceRevision()
    await assert.rejects(reconcileLive(state.directory, id, setup.approve(state, 'other')), /original signed approval/)
    const summary = await reconcileLive(state.directory, id, approval)
    assert.equal(summary.verification, 'sealed_digest_consistency')
    assert.equal(summary.reconciliation, evidence.startsWith('cancellation') ? 'not_dispatched' : 'resolved')
    assert.equal((await replay(state.directory)).digest, summary.digest)
    assert.equal(summary.report, null, 'Changed implementations cannot regenerate a historical report')
    assert.equal(summary.ambiguous, 0)
    assert.equal((await reconcileLive(state.directory, id, approval)).digest, summary.digest)
    assert.equal(unresolvedLiveDispatches(await openLiveLedger(globalDirectory)).length, 0)
    assert.equal(calls.length, before)
    assert.equal(metadataCalls.length, lookups)
  })
})

test('A5 own recovery: an older reservation without a local intent never auto-resolves', async t => {
  const { createRun, approve } = await workspace(t)
  const old = await createRun('historical')
  const approval = approve(old, 'historical')
  interruptIntent = true
  await assert.rejects(dispatchLive(old.directory, old.plan[0].id, approval), /Simulated/)
  interruptIntent = false
  advanceRevision()
  await assert.rejects(reconcileLive(old.directory, old.plan[0].id, approval))
  const fresh = await createRun('fresh')
  await assert.rejects(dispatchLive(fresh.directory, fresh.plan[0].id, approve(fresh, 'fresh')), /requires reconciliation/)
  await assert.rejects(openLiveLedger(globalDirectory), /discrepancy requires reconciliation/)
  assert.equal(calls.length, 0)
  assert.equal(metadataCalls.length, 0)
})

test('A4 historical pins: altered historical seals still block fresh dispatch', async t => {
  for (const kind of ['manifest', 'approval', 'intent', 'observation', 'terminal', 'resolution']) await t.test(kind, async t => {
    const { createRun, approve } = await workspace(t)
    const historical = await createRun('historical')
    const id = historical.plan[0].id
    await dispatchLive(historical.directory, id, approve(historical, 'historical'))
    advanceRevision()
    const fresh = await createRun('fresh')
    const approval = approve(fresh, 'fresh')
    const ledgerName = readdirSync(globalDirectory).find(name => name.startsWith(`${kind}-`))
    const path = kind === 'manifest' ? join(historical.directory, 'manifest.json')
      : ['approval', 'resolution'].includes(kind) ? join(globalDirectory, ledgerName)
        : join(historical.directory, `${id}.${kind}.json`)
    const value = readJson(path)
    value.payload.altered = true
    writeFileSync(path, `${canonical(value)}\n`)
    await assert.rejects(dispatchLive(fresh.directory, fresh.plan[0].id, approval))
    assert.equal(calls.length, 1)
    assert.equal(metadataCalls.length, 0)
  })
})

test('A5 recovery: unresolved historical observations and metadata wait for matching pins', async t => {
  for (const evidence of ['observation', 'metadata']) await t.test(evidence, async t => {
    const setup = evidence === 'metadata' ? await pendingBaseline(t) : await canary(t, 'baseline')
    const { state, approval, id, createRun, approve } = setup
    if (evidence === 'observation') {
      publicationFailures.add('sealed_verdict')
      await assert.rejects(dispatchLive(state.directory, id, approval), /Simulated/)
      publicationFailures.clear()
    }
    const before = calls.length
    advanceRevision()
    await assert.rejects(reconcileLive(state.directory, id, approval), /Older-version unresolved intent/)
    assert.equal(calls.length, before)
    assert.equal(metadataCalls.length, 0)
    assert.equal(unresolvedLiveDispatches(await openLiveLedger(globalDirectory)).length, 1)
    const blocked = await createRun('blocked')
    await assert.rejects(dispatchLive(blocked.directory, blocked.plan[0].id, approve(blocked, 'blocked')), /requires reconciliation/)
    revision = null
    const summary = await reconcileLive(state.directory, id, approval)
    assert.equal(summary.reconciliation, 'resolved')
    assert.equal(summary.ambiguous, 0)
    assert.equal(calls.length, before)
    assert.equal(metadataCalls.length, evidence === 'metadata' ? 1 : 0)
    advanceRevision()
    const fresh = await createRun('fresh')
    await dispatchLive(fresh.directory, fresh.plan[0].id, approve(fresh, 'fresh'))
    assert.equal(calls.length, before + 1)
  })
})

test('A5 approval expiry: all three adapters cancel durably between intent publication and transport', async t => {
  for (const role of ['baseline', 'claude', 'gemini']) for (const offset of [0, 1]) await t.test(`${role}/${offset}`, async t => {
    const { state, approval, id, setClock } = await canary(t, role, 1000)
    const before = calls.length
    afterIntent = intent => setClock(intent.approval.validUntil + offset)
    const summary = await dispatchLive(state.directory, id, approval)
    afterIntent = null
    const intent = readJson(join(state.directory, `${id}.intent.json`))
    const cancellation = readJson(join(state.directory, `${id}.not-dispatched.json`))
    assert.ok(cancellation.payload.checkedAt < intent.payload.deadline, 'The lease is still valid')
    assert.equal(cancellation.payload.checkedAt, intent.payload.approval.validUntil + offset)
    assert.equal(cancellation.payload.reason, 'approval_expired_before_transport')
    assert.equal(readJson(join(state.directory, `${id}.terminal.json`)).payload.result.status, 'not_dispatched')
    assert.equal(readJson(summary.report).payload.reservations.retainedMicroUsd, before * 100)
    assert.equal(summary.dispatched, before)
    assert.equal(summary.ambiguous, 0)
    assert.equal((await replay(state.directory)).digest, summary.digest)
    assert.equal((await reconcileLive(state.directory, id, approval)).reconciliation, 'not_dispatched')
    assert.equal(unresolvedLiveDispatches(await openLiveLedger(globalDirectory)).length, 0)
    assert.ok(!artifacts.exists(join(state.directory, `${id}.observation.json`)))
    assert.equal(calls.length, before)
    assert.equal(metadataCalls.length, 0)
  })
})

test('A5 approval expiry: the baseline rechecks approval after asynchronous preparation', async t => {
  const { state, approval, id, clock, setClock } = await canary(t, 'baseline', 1000)
  const before = calls.length
  beforeBaselineTransport = () => setClock(clock + 1000)
  const summary = await dispatchLive(state.directory, id, approval)
  beforeBaselineTransport = null
  assert.equal(calls.length, before)
  assert.equal(summary.ambiguous, 0)
  assert.equal(readJson(join(state.directory, `${id}.not-dispatched.json`)).payload.reason, 'approval_expired_before_transport')
  assert.equal(unresolvedLiveDispatches(await openLiveLedger(globalDirectory)).length, 0)
})

test('A4 lease: expiry after intent publication prevents all three transports and releases only the cancelled reservation', async t => {
  for (const role of ['baseline', 'claude', 'gemini']) await t.test(role, async t => {
    const { state, approval, id, setClock, createRun, approve } = await canary(t, role)
    const before = calls.length
    afterIntent = intent => setClock(intent.deadline + 1)
    const summary = await dispatchLive(state.directory, id, approval)
    afterIntent = null
    assert.equal(calls.length, before)
    assert.equal(summary.dispatched, before)
    assert.equal(summary.ambiguous, 0)
    const terminal = readJson(join(state.directory, `${id}.terminal.json`))
    assert.equal(terminal.payload.result.status, 'not_dispatched')
    const cancellation = readJson(join(state.directory, `${id}.not-dispatched.json`))
    assert.equal(cancellation.payload.checkedAt, readJson(join(state.directory, `${id}.intent.json`)).payload.deadline + 1)
    assert.ok(!artifacts.exists(join(state.directory, `${id}.observation.json`)))
    assert.equal(readJson(summary.report).payload.reservations.retainedMicroUsd, before * 100)
    const ledger = await openLiveLedger(globalDirectory)
    assert.equal(unresolvedLiveDispatches(ledger).length, 0)
    assert.equal([...ledger.resolutions.values()].find(row => row.id === id).status, 'not_dispatched')
    assert.equal((await replay(state.directory)).digest, summary.digest)
    const nextRun = await createRun('later')
    const next = nextRun.plan[0]
    await dispatchLive(nextRun.directory, next.id, approve(nextRun, 'later'))
    assert.equal(calls.length, before + 1, 'A cancelled lease leaves later dispatch available')
    // Fill the remaining cap through the ledger seam. Including the cancelled
    // reservation in global usage would reject this exact boundary.
    const adapter = state.pins.adapters.find(row => row.id === next.adapter)
    assert.equal(reserveLiveDispatch(await openLiveLedger(globalDirectory), state, adapter,
      { id: `item_${'a'.repeat(32)}`, approval: approval.record, dispatched: true,
        reservationMicroUsd: state.pins.budgetMicroUsd - before * 100 }), true)
  })
})

test('A4 lease: all three transports use the remaining timeout and the baseline reads the dispatch clock', async t => {
  for (const role of ['baseline', 'claude', 'gemini']) await t.test(role, async t => {
    const { state, approval, id, setClock } = await canary(t, role)
    const remaining = 137
    let watching = false
    const expected = role === 'baseline' ? 2 : 1
    afterIntent = intent => { setClock(intent.deadline - remaining); watching = true }
    const timers = []
    const original = globalThis.setTimeout
    const timerMock = mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
      if (watching && timers.length < expected) timers.push(delay)
      return original(callback, delay, ...args)
    })
    t.after(() => timerMock.mock.restore())
    const before = calls.length
    await dispatchLive(state.directory, id, approval)
    assert.equal(calls.length, before + 1)
    assert.equal(timers.length, expected)
    assert.ok(timers.every(delay => delay === remaining), `Remaining lease timers: ${timers}`)
    assert.equal(readJson(join(state.directory, `${id}.terminal.json`)).payload.result.status, 'valid')
  })
})

test('A4 survivor: a rehashed reconciliation successor cannot predate its predecessor', async t => {
  const { state, approval, id, clock, setClock } = await pendingBaseline(t)
  failuresAfterWrite.add('metadata_lookup_intent')
  await assert.rejects(reconcileLive(state.directory, id, approval), /Simulated/)
  failuresAfterWrite.clear()
  setClock(clock + 10)
  await reconcileLive(state.directory, id, approval)
  const first = readJson(join(state.directory, `${id}.reconciled.json`))
  assert.equal(first.payload.status, 'still_unknown')
  artifacts.seal(state.directory, `${id}.reconciled-1.json`, 'reconciled_verdict', state.pinsDigest,
    { ...first.payload, previousDigest: first.digest, reconciledAt: first.payload.reconciledAt - 1 })
  await assert.rejects(replay(state.directory))
  await assert.rejects(reconcileLive(state.directory, id, approval))
})

test('A4 crash table: not-dispatched publication, terminal and resolution recover on both sides of each write', async t => {
  for (const kind of ['dispatch_not_sent', 'sealed_verdict', 'live_dispatch_resolution']) for (const durable of [false, true]) {
    await t.test(`${kind}/${durable}`, async t => {
      const { createRun, approve, setClock } = await workspace(t)
      const state = await createRun('cancelled')
      const approval = approve(state, 'cancelled')
      const id = state.plan[0].id
      afterIntent = intent => setClock(intent.deadline + 1)
      const failures = durable ? earlyFailuresAfterWrite : earlyFailures
      failures.add(kind)
      await assert.rejects(dispatchLive(state.directory, id, approval), /Simulated early/)
      failures.clear()
      afterIntent = null
      const cancelled = kind !== 'dispatch_not_sent' || durable
      const summary = await reconcileLive(state.directory, id, approval)
      assert.equal(summary.reconciliation, cancelled ? 'not_dispatched' : 'still_unknown')
      assert.equal(readJson(summary.report).payload.reservations.retainedMicroUsd, cancelled ? 0 : 100)
      assert.equal(unresolvedLiveDispatches(await openLiveLedger(globalDirectory)).length, cancelled ? 0 : 1)
      assert.equal(calls.length, 0)
      assert.equal(metadataCalls.length, 0)
      if (cancelled) assert.equal((await reconcileLive(state.directory, id, approval)).digest, summary.digest)
    })
  }
})

test('A4 cancellation integrity: rehashed cancellation cannot contradict expiry or transport evidence', async t => {
  for (const change of ['expiry', 'transport']) await t.test(change, async t => {
    const { createRun, approve, setClock } = await workspace(t)
    const state = await createRun('cancellation')
    const approval = approve(state, 'cancellation')
    const id = state.plan[0].id
    afterIntent = intent => setClock(intent.deadline + 1)
    await dispatchLive(state.directory, id, approval)
    afterIntent = null
    const intent = readJson(join(state.directory, `${id}.intent.json`))
    if (change === 'expiry') {
      const cancellation = rewrite(join(state.directory, `${id}.not-dispatched.json`), value => { value.payload.checkedAt = intent.payload.deadline - 1 })
      rewrite(join(state.directory, `${id}.terminal.json`), value => { value.payload.terminalAt = cancellation.payload.checkedAt })
      const name = readdirSync(globalDirectory).find(name => name.startsWith('resolution-'))
      rewrite(join(globalDirectory, name), value => { value.payload.recordDigest = cancellation.digest })
    }
    else artifacts.seal(state.directory, `${id}.observation.json`, 'dispatch_observation', state.pinsDigest,
      { intentDigest: intent.digest, raw: { failure: 'outcome_unknown' }, terminalAt: intent.payload.deadline })
    await assert.rejects(openLiveLedger(globalDirectory))
    await assert.rejects(reconcileLive(state.directory, id, approval))
    assert.equal(calls.length, 0)
  })
})

test('A4 cancellation integrity: a terminal failure cannot act as a reservation release', async t => {
  const { createRun, approve } = await workspace(t)
  const state = await createRun('terminal-release')
  const approval = approve(state, 'terminal-release')
  const selected = state.plan.find(row => row.adapter.startsWith('claude_'))
  for (const row of state.plan.slice(0, state.plan.indexOf(selected))) await dispatchLive(state.directory, row.id, approval)
  const before = calls.length
  const id = selected.id
  await dispatchLive(state.directory, id, approval)
  const { openRun, evaluate } = await import('./run-state.mjs')
  const opened = await openRun(state.directory)
  const item = opened.plan.find(row => row.blind.id === id)
  const intent = opened.intents.get(id)
  const raw = { failure: 'not_dispatched' }
  const terminalAt = intent.payload.startedAt
  const result = await evaluate(opened, item, intent.payload, raw, terminalAt)
  rewrite(join(state.directory, `${id}.observation.json`), value => { value.payload.raw = raw })
  const terminal = rewrite(join(state.directory, `${id}.terminal.json`), value => { Object.assign(value.payload, { raw, terminalAt, result }) })
  const name = readdirSync(globalDirectory).find(name => name.startsWith('resolution-') && readJson(join(globalDirectory, name)).payload.id === id)
  rewrite(join(globalDirectory, name), value => { Object.assign(value.payload, { status: 'not_dispatched', recordDigest: terminal.digest }) })
  await assert.rejects(openLiveLedger(globalDirectory))
  assert.equal(calls.length, before + 1)
})

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
  const ledger = (await openLiveLedger(globalDirectory))
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
  const ledger = (await openLiveLedger(globalDirectory))
  for (const [index, state] of [first, second].entries()) {
    const approval = approve(state, `cap-${index}`).record
    for (let ordinal = 0; ordinal < 128; ordinal++) {
      const intent = { id: `item_${hash([index, ordinal]).slice(7, 39)}`, approval, dispatched: true, reservationMicroUsd: 100 }
      assert.equal(reserveFixture(ledger, state, adapter, intent), true)
    }
  }
  assert.equal((await openLiveLedger(globalDirectory)).reservations.size, 256)
  const nextApproval = approve(next, 'cap-next')
  const reopened = await openLiveLedger(globalDirectory)
  assert.throws(() => reserveFixture(reopened, next, adapter,
    { id: next.plan[0].id, approval: nextApproval.record, dispatched: true, reservationMicroUsd: 100 }), /Global per-model\/configuration dispatch ceiling/)
  await assert.rejects(dispatchLive(next.directory, next.plan[0].id, nextApproval), /requires reconciliation/)
  assert.equal(calls.length, 0)
  assert.equal((await openLiveLedger(globalDirectory)).reservations.size, 256)
})

test('the global budget survives reopening and a new approval for the original run', async t => {
  const { createRun, approve } = await workspace(t)
  const state = await createRun('budget')
  const adapter = state.pins.adapters[0]
  // Exercise the ledger's finite boundary independently of admission's stricter
  // full-schedule cost check. No provider dispatch is authorized by this probe.
  state.pins.budgetMicroUsd = 150
  state.pinsDigest = hash(state.pins)
  rewrite(join(state.directory, 'manifest.json'), value => {
    value.payload = state.pins
    value.pinsDigest = state.pinsDigest
  })
  const first = { id: `item_${'1'.repeat(32)}`, approval: approve(state, 'budget-first').record, dispatched: true, reservationMicroUsd: 100 }
  assert.equal(reserveFixture((await openLiveLedger(globalDirectory)), state, adapter, first), true)
  const next = { ...first, id: `item_${'2'.repeat(32)}`, approval: approve(state, 'budget-next').record }
  assert.equal(reserveFixture((await openLiveLedger(globalDirectory)), state, adapter, next), false)
  const ledger = (await openLiveLedger(globalDirectory))
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
  assert.equal([...(await openLiveLedger(globalDirectory)).reservations.values()][0].reservationMicroUsd, 100)
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
  await assert.rejects(openLiveLedger(globalDirectory), /discrepancy requires reconciliation/)
  await assert.rejects(dispatchLive(state.directory, state.plan[0].id, approval), /requires reconciliation/)
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

test('post-dispatch publication failures retain global uncertainty across directories and distinct approvals', async t => {
  for (const [name, transportOutcome, kinds] of [
    ['unknown-terminal', 'ambiguous', ['sealed_verdict']],
    ['unknown-terminal-and-marker', 'ambiguous', ['sealed_verdict', 'global_reconciliation_required']],
    ['unknown-marker', 'ambiguous', ['global_reconciliation_required']],
    ['known-terminal', 'valid', ['sealed_verdict']],
    ['observation', 'ambiguous', ['dispatch_observation']],
    ['resolution-ledger', 'valid', ['live_dispatch_resolution']],
  ]) await t.test(name, async t => {
    const { createRun, approve } = await workspace(t)
    const first = await createRun('first')
    const second = await createRun('second')
    outcome = transportOutcome
    publicationFailures = new Set(kinds)
    await assert.rejects(dispatchLive(first.directory, first.plan[0].id, approve(first, 'first')), /Simulated publication failure/)
    assert.equal(calls.length, 1)
    assert.equal(unresolvedLiveDispatches((await openLiveLedger(globalDirectory))).length, 1)
    assert.ok(!artifacts.exists(join(globalDirectory, '.learn-v2-scorer-global.lock')), 'Transient lock cleanup must leave the durable global block')
    publicationFailures.clear()
    await assert.rejects(dispatchLive(second.directory, second.plan[0].id, approve(second, 'distinct')), /requires reconciliation/)
    assert.equal(calls.length, 1)
  })
})

async function pendingBaseline(t, approvalDurationMs) {
  const workspaceState = await workspace(t, approvalDurationMs)
  const state = await workspaceState.createRun('pending')
  const approval = workspaceState.approve(state, 'original')
  const item = state.plan.find(row => row.adapter.startsWith('baseline_'))
  for (const preceding of state.plan.slice(0, state.plan.indexOf(item))) await dispatchLive(state.directory, preceding.id, approval)
  omitProvider = true
  const summary = await dispatchLive(state.directory, item.id, approval)
  assert.equal(summary.ambiguous, 1)
  omitProvider = false
  return { ...workspaceState, state, approval, id: item.id, inferenceCalls: calls.length }
}

test('the explicit CLI reconciles saved generation metadata as resolved or failed without new inference', async t => {
  for (const status of ['resolved', 'failed']) await t.test(status, async t => {
    const { state, approval, id, inferenceCalls, createRun, approve } = await pendingBaseline(t)
    metadataOutcome = status
    const summary = await main(['reconcile', '--output', state.directory, '--id', id,
      '--approval', approval.approvalFile, '--cost-evidence', approval.costFile, '--owner-public-key', approval.trustKey])
    assert.equal(summary.reconciliation, status)
    assert.equal(summary.ambiguous, 0)
    assert.equal(calls.length, inferenceCalls)
    assert.deepEqual(metadataCalls, [readJson(join(state.directory, `${id}.observation.json`)).payload.raw.id])
    const ledger = (await openLiveLedger(globalDirectory))
    assert.equal(unresolvedLiveDispatches(ledger).length, 0)
    assert.equal([...ledger.reservations.values()].reduce((sum, row) => sum + row.reservationMicroUsd, 0), inferenceCalls * 100)
    assert.ok(!artifacts.exists(join(globalDirectory, 'unresolved.json')))
    assert.equal((await replay(state.directory)).digest, summary.digest)
    const second = await createRun('second')
    await dispatchLive(second.directory, second.plan[0].id, approve(second, 'distinct'))
    assert.equal(calls.length, inferenceCalls + 1)
    assert.equal(metadataCalls.length, 1)
  })
})

test('missing metadata stays unknown while contradictory metadata resolves failed with one lookup', async t => {
  for (const status of ['unavailable', 'contradictory', 'wrong-model', 'wrong-provider', 'missing-model', 'missing-provider']) await t.test(status, async t => {
    const { state, approval, id, inferenceCalls, createRun, approve } = await pendingBaseline(t)
    metadataOutcome = status
    const summary = await reconcileLive(state.directory, id, approval)
    const known = ['contradictory', 'wrong-model', 'wrong-provider'].includes(status)
    assert.equal(summary.reconciliation, status === 'wrong-provider' ? 'resolved' : known ? 'failed' : 'still_unknown')
    assert.equal(summary.ambiguous, Number(!known))
    if (!known) {
      const report = readJson(summary.report).payload.configurations.baseline_1
      assert.equal(['core', 'controls', 'diagnostics'].reduce((count, group) => count + (report[group].statuses.identity_unavailable ?? 0), 0), 1)
    }
    assert.equal((await replay(state.directory)).digest, summary.digest)
    assert.equal((await reconcileLive(state.directory, id, approval)).digest, summary.digest)
    assert.equal(metadataCalls.length, 1)
    const second = await createRun('second')
    if (known) await dispatchLive(second.directory, second.plan[0].id, approve(second, 'distinct'))
    else await assert.rejects(dispatchLive(second.directory, second.plan[0].id, approve(second, 'distinct')), /requires reconciliation/)
    assert.equal(calls.length, inferenceCalls + Number(known))
  })
})

test('a resolved canary permits the original run to continue its frozen schedule', async t => {
  const { state, approval, id, inferenceCalls } = await pendingBaseline(t)
  await reconcileLive(state.directory, id, approval)
  assert.equal(calls.length, inferenceCalls)
  for (const item of state.plan.slice(inferenceCalls, 4)) await dispatchLive(state.directory, item.id, approval)
  assert.equal(calls.length, 4, 'All three canaries and the first core dispatch completed')
  assert.equal(metadataCalls.length, 1)
})

test('reconciliation refuses unrecorded intents, other approvals and changed pins before metadata I/O', async t => {
  const { state, approval, id, inferenceCalls, approve } = await pendingBaseline(t)
  await assert.rejects(reconcileLive(state.directory, id, {}))
  await assert.rejects(reconcileLive(state.directory, id, approve(state, 'other')), /original signed approval/)
  await assert.rejects(reconcileLive(state.directory, state.plan.find(item => item.id !== id && item.adapter === 'baseline_1').id, approval), /recorded dispatched intent/)
  const manifestPath = join(state.directory, 'manifest.json')
  const original = readFileSync(manifestPath)
  writeFileSync(manifestPath, '{}')
  await assert.rejects(reconcileLive(state.directory, id, approval))
  writeFileSync(manifestPath, original)
  assert.equal(metadataCalls.length, 0)
  assert.equal(calls.length, inferenceCalls)
})

test('missing saved generation IDs remain unknown without metadata lookup or new inference', async t => {
  const { createRun, approve } = await workspace(t)
  const state = await createRun('unknown')
  const approval = approve(state, 'unknown')
  outcome = 'ambiguous'
  await dispatchLive(state.directory, state.plan[0].id, approval)
  const summary = await reconcileLive(state.directory, state.plan[0].id, approval)
  assert.equal(summary.reconciliation, 'still_unknown')
  assert.equal(summary.ambiguous, 1)
  assert.equal(metadataCalls.length, 0)
  assert.equal(calls.length, 1)
})

test('a crash publishing reconciliation or its lookup intent fails closed without a second lookup', async t => {
  for (const [kind, afterWrite] of [['metadata_observation', false], ['metadata_lookup_intent', true]]) await t.test(kind, async t => {
    const { state, approval, id, inferenceCalls, createRun, approve } = await pendingBaseline(t)
    const failures = afterWrite ? failuresAfterWrite : publicationFailures
    failures.add(kind)
    await assert.rejects(reconcileLive(state.directory, id, approval), /Simulated/)
    const lookups = metadataCalls.length
    assert.equal(lookups, kind === 'metadata_observation' ? 1 : 0)
    publicationFailures.clear()
    failuresAfterWrite.clear()
    const second = await createRun('second')
    await assert.rejects(dispatchLive(second.directory, second.plan[0].id, approve(second, 'distinct')), /requires reconciliation/)
    assert.equal((await reconcileLive(state.directory, id, approval)).reconciliation, 'still_unknown')
    assert.equal(metadataCalls.length, lookups)
    assert.equal(calls.length, inferenceCalls)
  })
})

test('interrupted global resolution publication resumes from the durable reconciliation without another lookup', async t => {
  for (const afterWrite of [false, true]) await t.test(`after durable publication: ${afterWrite}`, async t => {
    const { state, approval, id, inferenceCalls } = await pendingBaseline(t)
    const failures = afterWrite ? failuresAfterWrite : publicationFailures
    failures.add('live_dispatch_resolution')
    await assert.rejects(reconcileLive(state.directory, id, approval), /Simulated/)
    assert.equal(metadataCalls.length, 1)
    assert.equal(unresolvedLiveDispatches((await openLiveLedger(globalDirectory))).length, afterWrite ? 0 : 1)
    assert.ok(artifacts.exists(join(globalDirectory, 'unresolved.json')))
    failures.clear()
    assert.equal((await reconcileLive(state.directory, id, approval)).reconciliation, 'resolved')
    assert.equal(metadataCalls.length, 1)
    assert.equal(calls.length, inferenceCalls)
  })
})

test('a known durable terminal finishes its global ledger publication without metadata or inference', async t => {
  const { createRun, approve } = await workspace(t)
  const state = await createRun('known')
  const approval = approve(state, 'known')
  publicationFailures.add('live_dispatch_resolution')
  await assert.rejects(dispatchLive(state.directory, state.plan[0].id, approval), /Simulated publication failure/)
  publicationFailures.clear()
  assert.equal((await reconcileLive(state.directory, state.plan[0].id, approval)).reconciliation, 'resolved')
  assert.equal(unresolvedLiveDispatches((await openLiveLedger(globalDirectory))).length, 0)
  assert.equal(metadataCalls.length, 0)
  assert.equal(calls.length, 1)
})

test('a terminal seal failure preserves the saved generation for metadata-only reconciliation', async t => {
  const { createRun, approve } = await workspace(t)
  const state = await createRun('terminal-interrupted')
  const approval = approve(state, 'terminal-interrupted')
  const item = state.plan.find(row => row.adapter.startsWith('baseline_'))
  for (const preceding of state.plan.slice(0, state.plan.indexOf(item))) await dispatchLive(state.directory, preceding.id, approval)
  omitProvider = true
  publicationFailures.add('sealed_verdict')
  await assert.rejects(dispatchLive(state.directory, item.id, approval), /Simulated publication failure/)
  const before = calls.length
  publicationFailures.clear()
  assert.equal((await reconcileLive(state.directory, item.id, approval)).reconciliation, 'resolved')
  assert.equal(metadataCalls.length, 1)
  assert.equal(calls.length, before)
  assert.equal(unresolvedLiveDispatches((await openLiveLedger(globalDirectory))).length, 0)
})

async function canary(t, role, approvalDurationMs) {
  const setup = await workspace(t, approvalDurationMs)
  const state = await setup.createRun('crash-points')
  const approval = setup.approve(state, 'original')
  const item = state.plan.find(row => row.adapter.startsWith(`${role}_`))
  for (const row of state.plan.slice(0, state.plan.indexOf(item))) await dispatchLive(state.directory, row.id, approval)
  return { ...setup, state, approval, id: item.id }
}

function rewrite(path, mutate) {
  const value = readJson(path)
  mutate(value)
  value.digest = hash(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'digest')))
  writeFileSync(path, `${canonical(value)}\n`)
  return value
}

function ownerWriteOff(setup, name = 'owner-write-off', change = value => value) {
  const { state, id, signed } = setup
  const intent = readJson(join(state.directory, `${id}.intent.json`))
  return signed(name, change({ version: 'learn-v2.harness-write-off.v1', directory: state.directory, pinsDigest: state.pinsDigest,
    intentDigest: intent.digest, approvalDigest: intent.payload.approval.approvalDigest, reason: 'Owner accepts the unknown outcome and full charge.', issuedAt: Date.now() }))
}

test('B1 known baseline classifications resolve failed and admit another approved run without a grade', async t => {
  for (const status of ['identity_mismatch', 'upstream_mismatch', 'unexpected_routing', 'nonterminal_output']) await t.test(status, async t => {
    const setup = await canary(t, 'baseline')
    const { state, approval, id, createRun, approve } = setup
    baselineStatus = status // Isolate the runner's classified-result boundary.
    const summary = await dispatchLive(state.directory, id, approval)
    const terminal = readJson(join(state.directory, `${id}.terminal.json`)).payload.result
    assert.equal(terminal.status, status)
    assert.equal(terminal.scorePercent, null)
    assert.equal(terminal.criteria, null)
    assert.equal(summary.ambiguous, 0)
    assert.equal(readJson(summary.report).payload.reservations.retainedMicroUsd, 100)
    const ledger = await openLiveLedger(globalDirectory)
    assert.equal([...ledger.resolutions.values()].find(row => row.id === id).status, 'failed')
    assert.equal((await reconcileLive(state.directory, id, approval)).reconciliation, 'failed')
    assert.equal((await replay(state.directory)).digest, summary.digest)
    const next = await createRun('after-known-failure')
    await dispatchLive(next.directory, next.plan[0].id, approve(next, 'after-known-failure'))
    assert.equal(calls.length, 2)
  })
})

test('B1 genuinely unknown baseline classifications retain the global block', async t => {
  for (const status of ['ambiguous', 'outcome_unknown', 'identity_unavailable', 'lease_expired']) await t.test(status, async t => {
    const setup = await canary(t, 'baseline')
    baselineStatus = status
    assert.equal((await dispatchLive(setup.state.directory, setup.id, setup.approval)).ambiguous, 1)
    await assertBlocked(setup, 1)
  })
})

test('B1 owner write-off retains charge and count, unblocks a separate run and forbids redispatch', async t => {
  for (const role of ['baseline', 'claude', 'gemini']) await t.test(role, async t => {
    const setup = await canary(t, role)
    const { state, approval, id, createRun, approve } = setup
    const before = calls.length
    const reset = syntheticHttp(t, setup, 'network-loss')
    await dispatchLive(state.directory, id, approval)
    const file = ownerWriteOff(setup)
    const summary = await main(['reconcile', '--output', state.directory, '--id', id, '--approval', approval.approvalFile,
      '--cost-evidence', approval.costFile, '--owner-public-key', approval.trustKey, '--write-off', file])
    assert.equal(summary.reconciliation, 'written_off')
    assert.equal(summary.ambiguous, 0)
    assert.equal(summary.dispatched, before + 1)
    assert.equal(readJson(summary.report).payload.reservations.retainedMicroUsd, (before + 1) * 100)
    assert.equal((await replay(state.directory)).digest, summary.digest)
    const ledger = await openLiveLedger(globalDirectory)
    assert.equal(unresolvedLiveDispatches(ledger).length, 0)
    assert.equal([...ledger.resolutions.values()].find(row => row.id === id).status, 'written_off')
    assert.equal([...ledger.reservations.values()].find(row => row.id === id).reservationMicroUsd, 100)
    assert.equal((await reconcileLive(state.directory, id, approval)).digest, summary.digest)
    await assert.rejects(dispatchLive(state.directory, id, approval), /Written-off intent/)
    assert.equal(calls.length, before + 1)
    assert.equal(metadataCalls.length, 0)
    const next = await createRun('after-write-off')
    reset()
    await dispatchLive(next.directory, next.plan[0].id, approve(next, 'after-write-off'))
    assert.equal(calls.length, before + 2)
  })
})

test('B1 write-off rejects unsigned, wrong-key and incorrectly bound decisions', async t => {
  for (const change of ['unsigned', 'wrong-key', 'wrong-key-reapproval', 'directory', 'pinsDigest', 'intentDigest', 'approvalDigest', 'reason', 'issuedAt']) await t.test(change, async t => {
    const setup = await canary(t, 'baseline')
    const { state, approval, id } = setup
    syntheticHttp(t, setup, 'network-loss')
    await dispatchLive(state.directory, id, approval)
    const file = ownerWriteOff(setup, 'bad-write-off', value => {
      if (['directory', 'pinsDigest', 'intentDigest', 'approvalDigest'].includes(change)) value[change] = 'wrong'
      if (change === 'reason') value.reason = ''
      if (change === 'issuedAt') value.issuedAt = Date.now() + 1
      return value
    })
    const envelope = readJson(file)
    if (change === 'unsigned') writeFileSync(file, JSON.stringify(envelope.payload))
    if (change === 'wrong-key') envelope.signature = sign(null, Buffer.from(canonical(envelope.payload)), generateKeyPairSync('ed25519').privateKey).toString('base64')
    if (change === 'wrong-key') writeFileSync(file, JSON.stringify(envelope))
    if (change === 'wrong-key-reapproval') {
      const other = generateKeyPairSync('ed25519')
      const keyFile = join(state.directory, '..', 'different-owner.pem')
      writeFileSync(keyFile, other.publicKey.export({ type: 'spki', format: 'pem' }))
      for (const path of [file, approval.approvalFile, approval.costFile]) {
        const document = readJson(path)
        document.signature = sign(null, Buffer.from(canonical(document.payload)), other.privateKey).toString('base64')
        writeFileSync(path, JSON.stringify(document))
      }
      approval.trustKey = keyFile
    }
    await assert.rejects(reconcileLive(state.directory, id, { ...approval, writeOffFile: file }))
    assert.equal(artifacts.exists(join(state.directory, `${id}.written-off.json`)), false)
    await assertBlocked(setup, 1)
    assert.equal(metadataCalls.length, 0)
  })
})

test('B1 signed write-off works after approval expiry without metadata or inference', async t => {
  const setup = await canary(t, 'baseline')
  const { state, approval, id, setClock, clock } = setup
  syntheticHttp(t, setup, 'network-loss')
  await dispatchLive(state.directory, id, approval)
  setClock(clock + 2 * 86_400_000)
  const summary = await reconcileLive(state.directory, id, { ...approval, writeOffFile: ownerWriteOff(setup) })
  assert.equal(summary.reconciliation, 'written_off')
  assert.equal(summary.dispatched, 1)
  assert.equal(readJson(summary.report).payload.reservations.retainedMicroUsd, 100)
  assert.equal(calls.length, 1)
  assert.equal(metadataCalls.length, 0)
})

test('B1 write-off cannot replace a known result or release its global ceiling count', async t => {
  const setup = await canary(t, 'baseline')
  const { state, id, approval, createRun, approve } = setup
  const reset = syntheticHttp(t, setup, 'network-loss')
  await dispatchLive(state.directory, id, approval)
  await reconcileLive(state.directory, id, { ...approval, writeOffFile: ownerWriteOff(setup) })
  const next = await createRun('paid-count')
  const ledger = await openLiveLedger(globalDirectory)
  const adapter = next.pins.adapters.find(row => row.role === 'baseline')
  const limit = contract.LIMITS.dispatchesPerModelOrConfiguration
  contract.LIMITS.dispatchesPerModelOrConfiguration = 1
  try {
    assert.throws(() => reserveFixture(ledger, next, adapter, { id: next.plan.find(row => row.adapter === adapter.id).id,
      approval: approve(next, 'paid-count').record, dispatched: true, reservationMicroUsd: 100 }), /ceiling/)
  }
  finally { contract.LIMITS.dispatchesPerModelOrConfiguration = limit }
  reset()
  const known = await createRun('known-failure')
  const knownApproval = approve(known, 'known-failure')
  const knownId = known.plan[0].id
  await dispatchLive(known.directory, knownId, knownApproval)
  const file = ownerWriteOff({ ...setup, state: known, id: knownId })
  await assert.rejects(reconcileLive(known.directory, knownId, { ...knownApproval, writeOffFile: file }), /Only an unknown outcome/)
  assert.equal(artifacts.exists(join(known.directory, `${knownId}.written-off.json`)), false)
})

test('B1 signed write-off closes an older-version unknown without replaying historical code', async t => {
  const setup = await canary(t, 'baseline')
  syntheticHttp(t, setup, 'network-loss')
  await dispatchLive(setup.state.directory, setup.id, setup.approval)
  const file = ownerWriteOff(setup)
  advanceRevision()
  const summary = await reconcileLive(setup.state.directory, setup.id, { ...setup.approval, writeOffFile: file })
  assert.equal(summary.reconciliation, 'written_off')
  assert.equal(summary.verification, 'sealed_digest_consistency')
  assert.equal(summary.dispatched, 1)
  assert.equal(summary.ambiguous, 0)
  assert.equal(calls.length, 1)
  assert.equal(metadataCalls.length, 0)
})

test('B1 signed write-off can recover an intent publication interruption without inference', async t => {
  const { createRun, approve, signed } = await workspace(t)
  const state = await createRun('write-off-unpublished-intent')
  const approval = approve(state, 'write-off-unpublished-intent')
  const id = state.plan[0].id
  interruptIntent = true
  await assert.rejects(dispatchLive(state.directory, id, approval), /Simulated/)
  interruptIntent = false
  const reservation = [...(await openLiveLedger(globalDirectory, { recoveringDirectory: state.directory })).reservations.values()][0]
  const file = signed('owner-write-off', { version: 'learn-v2.harness-write-off.v1', directory: state.directory, pinsDigest: state.pinsDigest,
    intentDigest: reservation.intentDigest, approvalDigest: reservation.approvalDigest, reason: 'Owner retains the unresolved reservation.', issuedAt: Date.now() })
  const summary = await reconcileLive(state.directory, id, { ...approval, writeOffFile: file })
  assert.equal(summary.reconciliation, 'written_off')
  assert.equal(summary.dispatched, 1)
  assert.equal(readJson(summary.report).payload.reservations.retainedMicroUsd, 100)
  assert.equal(calls.length, 0)
  assert.equal(metadataCalls.length, 0)
})

test('B1 write-off publication and resolution crashes recover without losing the charge', async t => {
  for (const point of ['dispatch_write_off', 'live_dispatch_resolution', 'marker']) for (const after of [false, true]) await t.test(`${point}/${after}`, async t => {
    const setup = await canary(t, 'baseline')
    const { state, approval, id } = setup
    syntheticHttp(t, setup, 'network-loss')
    await dispatchLive(state.directory, id, approval)
    const file = ownerWriteOff(setup)
    if (point === 'marker') markerRemovalFailure = after ? 'after' : 'before'
    else (after ? failuresAfterWrite : publicationFailures).add(point)
    await assert.rejects(reconcileLive(state.directory, id, { ...approval, writeOffFile: file }), /Simulated/)
    publicationFailures.clear(); failuresAfterWrite.clear(); markerRemovalFailure = null
    const summary = await reconcileLive(state.directory, id, { ...approval, writeOffFile: file })
    assert.equal(summary.reconciliation, 'written_off')
    assert.equal(readJson(summary.report).payload.reservations.retainedMicroUsd, 100)
    assert.equal((await replay(state.directory)).digest, summary.digest)
    assert.equal(unresolvedLiveDispatches(await openLiveLedger(globalDirectory)).length, 0)
    await assert.rejects(dispatchLive(state.directory, id, approval), /Written-off/)
    assert.equal(calls.length, 1)
  })
})

test('B1 metadata has a separate bounded lease after the inference lease expires', async t => {
  for (const window of ['after-inference-lease', 'near-approval-expiry', 'near-cost-expiry']) await t.test(window, async t => {
    const { state, approval, id, inferenceCalls } = await pendingBaseline(t, window === 'near-cost-expiry' ? 3_600_000 : 600_000)
    const intent = readJson(join(state.directory, `${id}.intent.json`))
    const now = window === 'after-inference-lease' ? intent.payload.deadline + 1 : intent.payload.approval.validUntil - 500
    const clockMock = mock.method(Date, 'now', () => now)
    t.after(() => clockMock.mock.restore())
    const summary = await reconcileLive(state.directory, id, approval)
    assert.equal(summary.reconciliation, 'resolved')
    const lookup = readJson(join(state.directory, `${id}.metadata-intent.json`)).payload
    assert.equal(lookup.startedAt, now)
    assert.equal(lookup.deadline, Math.min(now + 10_000, intent.payload.approval.validUntil))
    assert.equal(metadataCalls.length, 1)
    assert.equal(calls.length, inferenceCalls)
    assert.equal((await replay(state.directory)).digest, summary.digest)
    assert.equal(unresolvedLiveDispatches(await openLiveLedger(globalDirectory)).length, 0)
  })
})

test('B1 durable ledger path and private permissions have no live override', async t => {
  assert.equal(artifacts.liveLedgerDirectory(), join(homedir(), '.budds', 'learn-v2-scorer-live'))
  const { createRun, approve } = await workspace(t)
  const state = await createRun('durable')
  const approval = approve(state, 'durable')
  await assert.rejects(dispatchLive(state.directory, state.plan[0].id, { ...approval, ledgerDirectory: '/tmp/untrusted-ledger' }), /overrides/)
  process.env.BUDDS_LEARN_V2_SCORER_LEDGER = '/tmp/untrusted-ledger'
  try { assert.throws(() => artifacts.liveLedgerDirectory(), /overrides/) }
  finally { delete process.env.BUDDS_LEARN_V2_SCORER_LEDGER }
  chmodSync(globalDirectory, 0o755)
  await dispatchLive(state.directory, state.plan[0].id, approval)
  assert.equal(fs.statSync(globalDirectory).mode & 0o777, 0o700)
})

test('B1 prior dispatches cannot start around a missing or empty durable ledger', async t => {
  for (const loss of ['missing', 'empty']) await t.test(loss, async t => {
    const { createRun, approve } = await workspace(t)
    const state = await createRun('lost-ledger')
    const approval = approve(state, 'lost-ledger')
    await dispatchLive(state.directory, state.plan[0].id, approval)
    rmSync(globalDirectory, { recursive: true })
    if (loss === 'empty') outputDirectory(globalDirectory)
    await assert.rejects(dispatchLive(state.directory, state.plan[1].id, approval), /original durable ledger/)
    assert.equal(calls.length, 1)
  })
})

test('B1 midnight dispatch stays inside signed cost validity and stops at expiry', async t => {
  const clock = Date.parse('2026-11-10T23:59:30Z')
  const { createRun, approve, setClock } = await workspace(t, 3_600_000, clock)
  const state = await createRun('midnight')
  const approval = approve(state, 'midnight')
  await dispatchLive(state.directory, state.plan[0].id, approval)
  setClock(clock + 60_000)
  await dispatchLive(state.directory, state.plan[1].id, approval)
  assert.equal(calls.length, 2)
  setClock(clock + 600_000)
  await assert.rejects(dispatchLive(state.directory, state.plan[2].id, approval), /Cost evidence is stale/)
  assert.equal(calls.length, 2)
})

test('B1 evidence validity controls dispatch independently of the run clock age', async t => {
  for (const fresh of [true, false]) await t.test(fresh ? 'fresh-after-old-run-clock' : 'too-old-despite-future-expiry', async t => {
    const { createRun, approve, signed, clock, setClock } = await workspace(t)
    const state = await createRun('evidence-age')
    const approval = approve(state, 'evidence-age')
    const now = clock + 2 * 86_400_000
    const cost = readJson(approval.costFile).payload
    cost.verifiedAt = fresh ? now : clock
    cost.expiresAt = now + 60_000
    const owner = readJson(approval.approvalFile).payload
    owner.issuedAt = now
    owner.expiresAt = now + 60_000
    owner.costEvidenceDigest = hash(cost)
    const options = { ...approval, costFile: signed('revalidated-cost', cost), approvalFile: signed('revalidated-approval', owner) }
    setClock(now)
    if (fresh) await dispatchLive(state.directory, state.plan[0].id, options)
    else await assert.rejects(dispatchLive(state.directory, state.plan[0].id, options), /Cost evidence is stale/)
    assert.equal(calls.length, Number(fresh))
  })
})

test('B1 changed request pins get a fresh ceiling while unchanged pins stay capped', async t => {
  const { createRun, approve } = await workspace(t)
  const first = await createRun('request-cap')
  const next = await createRun('changed-request')
  const changedRun = await createRun('changed-request-version')
  delete first.pins.adapters[0].requestPinsDigest
  first.pins.implementation.files['scripts/lib/learn-v2-scorer/adapters.mjs'] = hash('historical request identity format')
  first.pinsDigest = hash(first.pins)
  rmSync(join(first.directory, 'manifest.json'))
  artifacts.seal(first.directory, 'manifest.json', 'manifest', first.pinsDigest, first.pins)
  const adapter = first.pins.adapters[0]
  const ledger = await openLiveLedger(globalDirectory)
  const approval = approve(first, 'request-cap').record
  for (let ordinal = 0; ordinal < 256; ordinal++) assert.equal(reserveFixture(ledger, first, adapter,
    { id: `item_${hash(ordinal).slice(7, 39)}`, approval, dispatched: true, reservationMicroUsd: 100 }), true)
  const intent = { id: next.plan[0].id, approval: approve(next, 'unchanged-request').record, dispatched: true, reservationMicroUsd: 100 }
  assert.throws(() => reserveFixture(ledger, next, next.pins.adapters[0], intent), /ceiling/)
  const changedRequest = { ...adapters.requestFor(adapter, { payload: '' }), api: 'next-api-revision' }
  const changed = { ...adapter, api: changedRequest.api, requestPinsDigest: adapters.requestPinsDigest(changedRequest) }
  // A distinct, owner-signed manifest models the next adapter version. Global
  // history checks its sealed pins without executing that version's code.
  changedRun.pins.adapters[0] = changed
  changedRun.pins.implementation.files['scripts/lib/learn-v2-scorer/adapters.mjs'] = hash('changed adapter implementation')
  changedRun.pinsDigest = hash(changedRun.pins)
  rmSync(join(changedRun.directory, 'manifest.json'))
  artifacts.seal(changedRun.directory, 'manifest.json', 'manifest', changedRun.pinsDigest, changedRun.pins)
  intent.approval = approve(changedRun, 'changed-request').record
  assert.equal(reserveFixture(ledger, changedRun, changed, intent, changedRequest), true)
  assert.equal((await openLiveLedger(globalDirectory)).reservations.size, 257)
  assert.equal(calls.length, 0)
})

function reserveFixture(ledger, state, adapter, intent, request = adapters.requestFor(adapter, { payload: '' })) {
  const payload = { ...intent, adapter: adapter.id, request, requestDigest: hash(request), responseDigest: hash('synthetic'),
    startedAt: state.pins.clock, deadline: state.pins.clock + 90_000, thresholdDigest: null,
    approval: { ...intent.approval, reservationMicroUsd: intent.reservationMicroUsd, validUntil: state.pins.clock + 600_000,
      quote: { id: intent.id, requestDigest: hash(request), maximumMicroUsd: intent.reservationMicroUsd } } }
  const reserved = reserveLiveDispatch(ledger, state, adapter, payload)
  if (reserved) artifacts.seal(state.directory, `${intent.id}.intent.json`, 'dispatch_intent', state.pinsDigest, payload)
  return reserved
}

async function assertBlocked(setup, inferenceCalls) {
  const second = await setup.createRun(`blocked-${inferenceCalls}`)
  await assert.rejects(dispatchLive(second.directory, second.plan[0].id, setup.approve(second, 'distinct')))
  assert.equal(calls.length, inferenceCalls, 'No additional inference may pass a global block')
  const ledger = await openLiveLedger(globalDirectory)
  assert.equal([...ledger.reservations.values()].reduce((sum, row) => sum + row.reservationMicroUsd, 0), Math.max(inferenceCalls, 1) * 100)
}

test('crash table: approval and reservation publication before transport retain safe restart boundaries', async t => {
  for (const [kind, afterWrite] of [
    ['live_approval_consumption', false], ['live_approval_consumption', true],
    ['live_dispatch_reservation', false], ['live_dispatch_reservation', true],
  ]) await t.test(`${kind}, durable=${afterWrite}`, async t => {
    const setup = await workspace(t)
    const state = await setup.createRun('early')
    const approval = setup.approve(state, 'early')
    const before = calls.length
    const failures = afterWrite ? earlyFailuresAfterWrite : earlyFailures
    failures.add(kind)
    await assert.rejects(dispatchLive(state.directory, state.plan[0].id, approval), /Simulated early/)
    failures.clear()
    assert.equal(calls.length, before)
    const ledger = await openLiveLedger(globalDirectory, { recoveringDirectory: state.directory })
    if (kind === 'live_dispatch_reservation' && afterWrite) {
      assert.equal(unresolvedLiveDispatches(ledger).length, 1)
      await assert.rejects(dispatchLive(state.directory, state.plan[0].id, approval), /requires reconciliation/)
      assert.equal((await reconcileLive(state.directory, state.plan[0].id, approval)).reconciliation, 'still_unknown')
      assert.ok(artifacts.exists(join(state.directory, `${state.plan[0].id}.intent.json`)), 'Reconstruct the exact reserved intent without dispatch')
    }
    else {
      await dispatchLive(state.directory, state.plan[0].id, approval)
      assert.equal(calls.length, before + 1)
    }
  })
})

test('crash table: local intent before transport stays charged and can be reconciled repeatedly', async t => {
  const setup = await workspace(t)
  const state = await setup.createRun('intent')
  const approval = setup.approve(state, 'intent')
  const id = state.plan[0].id
  await dispatchLive(state.directory, id, { ...approval, crashAfterIntent: true })
  assert.equal(calls.length, 0)
  const first = await reconcileLive(state.directory, id, approval)
  assert.equal(first.reconciliation, 'still_unknown')
  assert.equal((await reconcileLive(state.directory, id, approval)).digest, first.digest)
  await assertBlocked(setup, 0)
  assert.equal(metadataCalls.length, 0)
})

test('A3 M1 and crash table: saved observations recover locally for every adapter and terminal disposition', async t => {
  for (const role of ['baseline', 'claude', 'gemini']) for (const transportOutcome of ['valid', 'refused']) {
    for (const [kind, afterWrite] of [['dispatch_observation', true], ['sealed_verdict', false], ['sealed_verdict', true], ['live_dispatch_resolution', false]]) {
      await t.test(`${role}/${transportOutcome}/${kind}/durable=${afterWrite}`, async t => {
        const setup = await canary(t, role)
        const { state, approval, id } = setup
        outcome = transportOutcome
        const failures = afterWrite ? failuresAfterWrite : publicationFailures
        failures.add(kind)
        await assert.rejects(dispatchLive(state.directory, id, approval), /Simulated/)
        failures.clear()
        const before = calls.length
        await assertBlocked(setup, before)
        const summary = await reconcileLive(state.directory, id, approval)
        assert.equal(summary.reconciliation, transportOutcome === 'valid' ? 'resolved' : 'failed')
        assert.equal(summary.ambiguous, 0)
        assert.equal((await replay(state.directory)).digest, summary.digest)
        assert.equal(calls.length, before)
        assert.equal(metadataCalls.length, 0, 'Usable local evidence never consumes a lookup')
        assert.equal(unresolvedLiveDispatches(await openLiveLedger(globalDirectory)).length, 0)
        const second = await setup.createRun('after-recovery')
        outcome = 'valid'
        await dispatchLive(second.directory, second.plan[0].id, setup.approve(second, 'after-recovery'))
        assert.equal(calls.length, before + 1)
      })
    }
  }
})

test('crash table: absent observations stay blocked, and later saved evidence supersedes an unknown attempt', async t => {
  for (const role of ['baseline', 'claude', 'gemini']) await t.test(role, async t => {
    const setup = await canary(t, role)
    const { state, approval, id } = setup
    publicationFailures.add('dispatch_observation')
    await assert.rejects(dispatchLive(state.directory, id, approval), /Simulated/)
    publicationFailures.clear()
    const before = calls.length
    const unknown = await reconcileLive(state.directory, id, approval)
    assert.equal(unknown.reconciliation, 'still_unknown')
    const historyPath = join(state.directory, `${id}.reconciled.json`)
    const history = readFileSync(historyPath)
    assert.equal((await reconcileLive(state.directory, id, approval)).digest, unknown.digest)
    await assertBlocked(setup, before)
    const intent = readJson(join(state.directory, `${id}.intent.json`))
    artifacts.seal(state.directory, `${id}.observation.json`, 'dispatch_observation', state.pinsDigest,
      { intentDigest: intent.digest, raw: calls.at(-1).raw, terminalAt: Date.now() })
    const recovered = await reconcileLive(state.directory, id, approval)
    assert.equal(recovered.reconciliation, 'resolved')
    assert.equal(recovered.ambiguous, 0)
    assert.deepEqual(readFileSync(historyPath), history, 'Never erase an earlier unknown attempt')
    assert.equal((await replay(state.directory)).digest, recovered.digest)
    assert.equal(calls.length, before)
    assert.equal(metadataCalls.length, 0)
  })
})

test('crash table: durable resolution, report failure and lock release never redispatch or lose a charge', async t => {
  for (const point of ['resolution', 'report', 'lock']) await t.test(point, async t => {
    const setup = await workspace(t)
    const state = await setup.createRun('resolved')
    const approval = setup.approve(state, 'resolved')
    if (point === 'resolution') failuresAfterWrite.add('live_dispatch_resolution')
    if (point === 'report') publicationFailures.add('report')
    if (point === 'lock') lockReleaseFailure = true
    await assert.rejects(dispatchLive(state.directory, state.plan[0].id, approval), /Simulated/)
    failuresAfterWrite.clear()
    publicationFailures.clear()
    lockReleaseFailure = false
    if (point === 'lock') {
      await assert.rejects(dispatchLive(state.directory, state.plan[0].id, approval), /never steal a lock/)
      // Only this synthetic test owner releases its interrupted mutex.
      rmSync(join(state.directory, '.run.lock'))
    }
    const ledger = await openLiveLedger(globalDirectory)
    assert.equal(unresolvedLiveDispatches(ledger).length, 0)
    assert.equal([...ledger.reservations.values()][0].reservationMicroUsd, 100)
    await dispatchLive(state.directory, state.plan[0].id, approval)
    await reconcileLive(state.directory, state.plan[0].id, approval)
    assert.equal(calls.length, 1)
    assert.equal(metadataCalls.length, 0)
  })
})

test('crash table: metadata intent, saved response and reconciled verdict cover both publication sides', async t => {
  for (const kind of ['metadata_lookup_intent', 'metadata_observation', 'reconciled_verdict']) for (const afterWrite of [false, true]) {
    await t.test(`${kind}/durable=${afterWrite}`, async t => {
      const setup = await pendingBaseline(t)
      const { state, approval, id, inferenceCalls } = setup
      const failures = afterWrite ? failuresAfterWrite : publicationFailures
      failures.add(kind)
      await assert.rejects(reconcileLive(state.directory, id, approval), /Simulated/)
      failures.clear()
      const expectedCalls = kind === 'metadata_lookup_intent' ? 0 : 1
      assert.equal(metadataCalls.length, expectedCalls)
      await assertBlocked(setup, inferenceCalls)
      const summary = await reconcileLive(state.directory, id, approval)
      const responseSaved = kind === 'reconciled_verdict' || (kind === 'metadata_observation' && afterWrite)
      const newLookupAllowed = kind === 'metadata_lookup_intent' && !afterWrite
      assert.equal(summary.reconciliation, responseSaved || newLookupAllowed ? 'resolved' : 'still_unknown')
      assert.equal(metadataCalls.length, newLookupAllowed ? 1 : expectedCalls)
      assert.equal(calls.length, inferenceCalls)
      assert.equal((await replay(state.directory)).digest, summary.digest)
    })
  }
})

test('unknown reconciliation history accepts later saved metadata without another lookup', async t => {
  const { state, approval, id, inferenceCalls, clock } = await pendingBaseline(t)
  failuresAfterWrite.add('metadata_lookup_intent')
  await assert.rejects(reconcileLive(state.directory, id, approval), /Simulated/)
  failuresAfterWrite.clear()
  assert.equal((await reconcileLive(state.directory, id, approval)).reconciliation, 'still_unknown')
  const path = join(state.directory, `${id}.reconciled.json`)
  const original = readFileSync(path)
  const unknown = readJson(path)
  const intent = readJson(join(state.directory, `${id}.intent.json`))
  const identity = { approvalDigest: intent.payload.approval.approvalDigest, id }
  artifacts.seal(globalDirectory, `resolution-${hash(identity).slice(7)}.json`, 'live_dispatch_resolution', state.pinsDigest,
    { ...identity, intentDigest: intent.digest, recordName: `${id}.reconciled.json`, recordDigest: unknown.digest, status: 'still_unknown' })
  const lookup = readJson(join(state.directory, `${id}.metadata-intent.json`))
  artifacts.seal(state.directory, `${id}.metadata-observation.json`, 'metadata_observation', state.pinsDigest,
    { lookupDigest: lookup.digest, observedAt: Date.now(), metadata: {
      generationId: lookup.payload.generationId, returnedModel: 'openai/gpt-4.1', servingProvider: 'OpenAI', upstreamRequestId: null,
      finishReason: 'stop', nativeFinishReason: 'stop', cancelled: false, usage: null,
    } })
  const clockMock = mock.method(Date, 'now', () => clock + 2 * 86_400_000)
  t.after(() => clockMock.mock.restore())
  const summary = await reconcileLive(state.directory, id, approval)
  assert.equal(summary.reconciliation, 'resolved')
  assert.deepEqual(readFileSync(path), original)
  const successor = readJson(join(state.directory, `${id}.reconciled-1.json`))
  assert.equal(successor.payload.previousDigest, readJson(path).digest)
  assert.equal(metadataCalls.length, 0)
  assert.equal(calls.length, inferenceCalls)
  assert.equal((await replay(state.directory)).digest, summary.digest)
  assert.equal((await reconcileLive(state.directory, id, approval)).digest, summary.digest, 'Superseding an unknown global resolution remains idempotent')
  assert.equal(unresolvedLiveDispatches(await openLiveLedger(globalDirectory)).length, 0)
})

test('A3 M2 under A5 threat model: local replay rejects rehashed verdicts; global admission checks structure', async t => {
  for (const role of ['baseline', 'claude', 'gemini']) for (const change of ['status', 'raw', 'bytes']) await t.test(`${role}/${change}`, async t => {
    const setup = await canary(t, role)
    const { state, approval, id } = setup
    outcome = 'ambiguous'
    publicationFailures.add('global_reconciliation_required')
    await assert.rejects(dispatchLive(state.directory, id, approval), /Simulated/)
    publicationFailures.clear()
    assert.ok(!artifacts.exists(join(globalDirectory, 'unresolved.json')))
    const before = calls.length
    const terminalPath = join(state.directory, `${id}.terminal.json`)
    const terminal = rewrite(terminalPath, value => {
      if (change === 'raw') value.payload.raw = { failure: 'budget_exhausted' }
      else value.payload.result.status = 'valid'
    })
    if (change === 'bytes') writeFileSync(terminalPath, `${readFileSync(terminalPath, 'utf8')} `)
    const intent = readJson(join(state.directory, `${id}.intent.json`))
    const identity = { approvalDigest: intent.payload.approval.approvalDigest, id }
    artifacts.seal(globalDirectory, `resolution-${hash(identity).slice(7)}.json`, 'live_dispatch_resolution', state.pinsDigest,
      { ...identity, intentDigest: intent.digest, recordName: `${id}.terminal.json`, recordDigest: terminal.digest, status: 'resolved' })
    await assert.rejects(replay(state.directory))
    await assert.rejects(dispatchLive(state.directory, id, approval))
    const second = await setup.createRun('other')
    if (change === 'status') {
      outcome = 'valid'
      await dispatchLive(second.directory, second.plan[0].id, setup.approve(second, 'other'))
      assert.equal(calls.length, before + 1)
    }
    else {
      await assert.rejects(dispatchLive(second.directory, second.plan[0].id, setup.approve(second, 'other')))
      assert.equal(calls.length, before)
    }
    assert.equal(metadataCalls.length, 0)
  })
})

test('global resolution-record validation rejects missing records, links, digests and replay status disagreements', async t => {
  for (const change of ['missing-record', 'record-digest', 'intent-digest', 'status']) await t.test(change, async t => {
    const setup = await workspace(t)
    const state = await setup.createRun('global-verifier')
    const approval = setup.approve(state, 'global-verifier')
    await dispatchLive(state.directory, state.plan[0].id, approval)
    const name = readdirSync(globalDirectory).find(name => name.startsWith('resolution-'))
    const resolution = readJson(join(globalDirectory, name))
    if (change === 'missing-record') rmSync(join(state.directory, resolution.payload.recordName))
    else rewrite(join(globalDirectory, name), value => {
      if (change === 'record-digest') value.payload.recordDigest = `sha256:${'0'.repeat(64)}`
      if (change === 'intent-digest') value.payload.intentDigest = `sha256:${'0'.repeat(64)}`
      if (change === 'status') value.payload.status = 'failed'
    })
    await assert.rejects(openLiveLedger(globalDirectory), undefined, 'Removing resolution-record validation must fail this test')
    const second = await setup.createRun('other')
    await assert.rejects(dispatchLive(second.directory, second.plan[0].id, setup.approve(second, 'other')))
    await assert.rejects(dispatchLive(state.directory, state.plan[0].id, approval))
    assert.equal(calls.length, 1)
  })
})

test('A5 threat model: reconciliation replay stays local and global metadata links stay sealed', async t => {
  for (const change of ['result', 'metadata']) await t.test(change, async t => {
    const setup = await pendingBaseline(t)
    const { state, approval, id, inferenceCalls } = setup
    await reconcileLive(state.directory, id, approval)
    if (change === 'result') {
      const record = rewrite(join(state.directory, `${id}.reconciled.json`), value => { value.payload.result.scorePercent = 13 })
      const name = readdirSync(globalDirectory).find(name => name.startsWith('resolution-') && readJson(join(globalDirectory, name)).payload.id === id)
      rewrite(join(globalDirectory, name), value => { value.payload.recordDigest = record.digest })
    }
    else rewrite(join(state.directory, `${id}.metadata-observation.json`), value => { value.payload.metadata.cancelled = true })
    await assert.rejects(replay(state.directory))
    const second = await setup.createRun('other')
    if (change === 'result') {
      await dispatchLive(second.directory, second.plan[0].id, setup.approve(second, 'other'))
      assert.equal(calls.length, inferenceCalls + 1)
    }
    else {
      await assert.rejects(dispatchLive(second.directory, second.plan[0].id, setup.approve(second, 'other')))
      assert.equal(calls.length, inferenceCalls)
    }
    assert.equal(metadataCalls.length, 1)
  })
})

test('crash table: marker removal before or after unlink resumes from the verified resolution', async t => {
  for (const point of ['before', 'after']) await t.test(point, async t => {
    const { state, approval, id, inferenceCalls } = await pendingBaseline(t)
    markerRemovalFailure = point
    await assert.rejects(reconcileLive(state.directory, id, approval), /Simulated/)
    markerRemovalFailure = null
    const summary = await reconcileLive(state.directory, id, approval)
    assert.equal(summary.reconciliation, 'resolved')
    assert.equal(summary.ambiguous, 0)
    assert.ok(!artifacts.exists(join(globalDirectory, 'unresolved.json')))
    assert.equal(metadataCalls.length, 1)
    assert.equal(calls.length, inferenceCalls)
  })
})

test('expired approvals and late saved metadata never authorize a lookup or resolution', async t => {
  for (const point of ['expired-original', 'late-metadata']) await t.test(point, async t => {
    const { state, approval, id, inferenceCalls } = await pendingBaseline(t)
    const intent = readJson(join(state.directory, `${id}.intent.json`))
    if (point === 'expired-original') {
      const clockMock = mock.method(Date, 'now', () => intent.payload.approval.validUntil)
      t.after(() => clockMock.mock.restore())
    }
    else {
      failuresAfterWrite.add('metadata_lookup_intent')
      await assert.rejects(reconcileLive(state.directory, id, approval), /Simulated/)
      failuresAfterWrite.clear()
      const lookup = readJson(join(state.directory, `${id}.metadata-intent.json`))
      artifacts.seal(state.directory, `${id}.metadata-observation.json`, 'metadata_observation', state.pinsDigest,
        { lookupDigest: lookup.digest, observedAt: lookup.payload.deadline, metadata: {
          generationId: lookup.payload.generationId, returnedModel: 'openai/gpt-4.1', servingProvider: 'OpenAI', upstreamRequestId: null,
          finishReason: 'stop', nativeFinishReason: 'stop', cancelled: false, usage: null,
        } })
    }
    const summary = await reconcileLive(state.directory, id, approval)
    assert.equal(summary.reconciliation, 'still_unknown')
    assert.equal((await replay(state.directory)).digest, summary.digest)
    assert.equal(metadataCalls.length, 0)
    assert.equal(calls.length, inferenceCalls)
    assert.equal(unresolvedLiveDispatches(await openLiveLedger(globalDirectory)).length, 1)
  })
})

test('reconciliation history rejects missing predecessors and changed history links', async t => {
  for (const change of ['missing', 'link', 'known']) await t.test(change, async t => {
    const { state, approval, id } = await pendingBaseline(t)
    if (change !== 'known') {
      failuresAfterWrite.add('metadata_lookup_intent')
      await assert.rejects(reconcileLive(state.directory, id, approval), /Simulated/)
      failuresAfterWrite.clear()
    }
    await reconcileLive(state.directory, id, approval)
    const first = readJson(join(state.directory, `${id}.reconciled.json`))
    artifacts.seal(state.directory, `${id}.reconciled-1.json`, 'reconciled_verdict', state.pinsDigest,
      { ...first.payload, previousDigest: change === 'link' ? `sha256:${'0'.repeat(64)}` : first.digest })
    if (change === 'missing') rmSync(join(state.directory, `${id}.reconciled.json`))
    await assert.rejects(replay(state.directory), /history|known reconciliation/)
    assert.equal(metadataCalls.length, change === 'known' ? 1 : 0)
  })
})

test('publication internals: an ordinary partial write cleans its temporary inode and can be retried', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'budds-c3-seal-fault-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const originalWrite = fs.writeFileSync
  const writeMock = mock.method(fs, 'writeFileSync', (fd, bytes) => {
    originalWrite(fd, bytes.slice(0, 8))
    throw new Error('Synthetic partial write failure')
  })
  const restore = () => { writeMock.mock.restore(); syncBuiltinESMExports() }
  t.after(restore)
  syncBuiltinESMExports()
  assert.throws(() => artifacts.seal(directory, 'terminal.json', 'sealed_verdict', hash('pins'), { response: 'synthetic' }), /partial write/)
  assert.deepEqual(readdirSync(directory), [], 'An ordinary exception must not leave an unrecoverable temporary file')
  restore()
  const record = artifacts.seal(directory, 'terminal.json', 'sealed_verdict', hash('pins'), { response: 'synthetic' })
  assert.equal(artifacts.unseal(directory, 'terminal.json', 'sealed_verdict', hash('pins')).digest, record.digest)
})

test('A5 threat model: current-run restart replays arithmetic while global admission accepts consistent digests', async t => {
  const setup = await workspace(t)
  const state = await setup.createRun('arithmetic')
  const approval = setup.approve(state, 'arithmetic')
  const id = state.plan[0].id
  await dispatchLive(state.directory, id, approval)
  const terminal = rewrite(join(state.directory, `${id}.terminal.json`), value => { value.payload.result.scorePercent = 13 })
  const resolutionName = readdirSync(globalDirectory).find(name => name.startsWith('resolution-'))
  rewrite(join(globalDirectory, resolutionName), value => { value.payload.recordDigest = terminal.digest })
  await assert.rejects(replay(state.directory), /Sealed verdict replay changed/)
  await assert.rejects(dispatchLive(state.directory, id, approval), /Sealed verdict replay changed/)
  const second = await setup.createRun('other')
  await dispatchLive(second.directory, second.plan[0].id, setup.approve(second, 'other'))
  assert.equal(calls.length, 2)
})

test('crash table: recovery publication can fail again without losing the original charge or evidence', async t => {
  for (const point of ['restore-intent', 'recover-terminal']) await t.test(point, async t => {
    const setup = await workspace(t)
    const state = await setup.createRun('recovery-publication')
    const approval = setup.approve(state, 'recovery-publication')
    const id = state.plan[0].id
    if (point === 'restore-intent') interruptIntent = true
    else publicationFailures.add('sealed_verdict')
    await assert.rejects(dispatchLive(state.directory, id, approval), /Simulated/)
    await assert.rejects(reconcileLive(state.directory, id, approval), /Simulated/)
    interruptIntent = false
    publicationFailures.clear()
    assert.equal([...((await openLiveLedger(globalDirectory, { recoveringDirectory: state.directory })).reservations.values())][0].reservationMicroUsd, 100)
    const summary = await reconcileLive(state.directory, id, approval)
    assert.equal(summary.reconciliation, point === 'restore-intent' ? 'still_unknown' : 'resolved')
    assert.equal(calls.length, point === 'restore-intent' ? 0 : 1)
    assert.equal(metadataCalls.length, 0)
  })
})

test('local recovery remains available after the original approval and dispatch day expire', async t => {
  for (const role of ['baseline', 'claude', 'gemini']) await t.test(role, async t => {
    const { state, approval, id, clock } = await canary(t, role)
    publicationFailures.add('sealed_verdict')
    await assert.rejects(dispatchLive(state.directory, id, approval), /Simulated/)
    publicationFailures.clear()
    const before = calls.length
    const clockMock = mock.method(Date, 'now', () => clock + 2 * 86_400_000)
    t.after(() => clockMock.mock.restore())
    const summary = await reconcileLive(state.directory, id, approval)
    assert.equal(summary.reconciliation, 'resolved')
    assert.equal(summary.ambiguous, 0)
    assert.equal(calls.length, before)
    assert.equal(metadataCalls.length, 0)
    assert.equal((await replay(state.directory)).digest, summary.digest)
  })
})

test('expired approval cannot authorize new metadata I/O within an otherwise eligible lease', async t => {
  const { state, approval, id, clock, inferenceCalls } = await pendingBaseline(t, 1000)
  const clockMock = mock.method(Date, 'now', () => clock + 1000)
  t.after(() => clockMock.mock.restore())
  const summary = await reconcileLive(state.directory, id, approval)
  assert.equal(summary.reconciliation, 'still_unknown')
  assert.equal(summary.ambiguous, 1)
  assert.equal(metadataCalls.length, 0)
  assert.equal(calls.length, inferenceCalls)
  assert.ok(!artifacts.exists(join(state.directory, `${id}.metadata-intent.json`)))
})

test('a reserved intent can be restored after approval expiry without new transport', async t => {
  const { createRun, approve, clock } = await workspace(t)
  const state = await createRun('expired-intent')
  const approval = approve(state, 'expired-intent')
  interruptIntent = true
  await assert.rejects(dispatchLive(state.directory, state.plan[0].id, approval), /Simulated/)
  interruptIntent = false
  const clockMock = mock.method(Date, 'now', () => clock + 2 * 86_400_000)
  t.after(() => clockMock.mock.restore())
  assert.equal((await reconcileLive(state.directory, state.plan[0].id, approval)).reconciliation, 'still_unknown')
  assert.equal(calls.length, 0)
  assert.equal(metadataCalls.length, 0)
  assert.equal([...((await openLiveLedger(globalDirectory)).reservations.values())][0].reservationMicroUsd, 100)
})

const flags = (state, id, approval) => ['--output', state.directory, '--id', id, '--approval', approval.approvalFile,
  '--cost-evidence', approval.costFile, '--owner-public-key', approval.trustKey]
const nextPlanned = (state, id) => state.plan[state.plan.findIndex(row => row.id === id) + 1].id

async function runCli(args) {
  const output = { stdout: '', stderr: '' }
  const code = await cli(args, { stdout: { write: text => { output.stdout += text } }, stderr: { write: text => { output.stderr += text } } })
  return { ...output, code, summary: output.stdout ? JSON.parse(output.stdout) : null }
}

for (const status of [429, 402, 401, 403]) {
  test(`B2 access refusal ${status}: charged, halted, non-zero CLI exit and a separate run admitted`, async t => {
    for (const role of ['baseline', 'claude', 'gemini']) await t.test(role, async t => {
      const setup = await canary(t, role)
      const { state, approval, id, createRun, approve } = setup
      const before = calls.length
      const reset = syntheticHttp(t, setup, `refusal-text-${status}`)
      const halted = { reason: 'provider_access_refused', httpStatus: status, adapter: state.plan.find(row => row.id === id).adapter, id }
      const refused = await runCli(['dispatch', ...flags(state, id, approval)])
      assert.equal(refused.code, 1)
      assert.equal(refused.stderr, RUN_HALTED_MESSAGE)
      assert.deepEqual(refused.summary.halted, halted)
      assert.equal(refused.summary.dispatched, before + 1)
      assert.equal(calls.length, before + 1)
      const terminalPath = join(state.directory, `${id}.terminal.json`)
      const terminal = readJson(terminalPath).payload
      assert.deepEqual(terminal.raw, { failure: 'definitive_failure', accessRefusalStatus: status })
      assert.equal(terminal.result.status, 'definitive_failure')
      assert.equal(terminal.result.scorePercent, null)
      assert.equal(terminal.result.criteria, null)
      const report = readJson(refused.summary.report).payload
      assert.deepEqual(report.halted, halted)
      assert.equal(report.reservations.retainedMicroUsd, (before + 1) * 100)
      const ledger = await openLiveLedger(globalDirectory)
      assert.equal([...ledger.resolutions.values()].find(row => row.id === id).status, 'failed')
      assert.equal(unresolvedLiveDispatches(ledger).length, 0)
      assert.equal([...ledger.reservations.values()].find(row => row.id === id).reservationMicroUsd, 100)
      for (const text of [refused.stdout, refused.stderr, readFileSync(terminalPath, 'utf8'), readFileSync(refused.summary.report, 'utf8')]) assert.ok(!text.includes(PROVIDER_REFUSAL_TEXT))
      const later = nextPlanned(state, id)
      const repeated = await runCli(['dispatch', ...flags(state, later, approval)])
      assert.equal(repeated.code, 1)
      assert.equal(repeated.stderr, RUN_HALTED_MESSAGE)
      assert.deepEqual(repeated.summary.halted, halted)
      assert.equal(repeated.summary.digest, refused.summary.digest)
      assert.equal(calls.length, before + 1, 'A halted run refuses later dispatches without transport')
      assert.equal(artifacts.exists(join(state.directory, `${later}.intent.json`)), false)
      const original = await runCli(['dispatch', ...flags(state, id, approval)])
      assert.equal(original.code, 1)
      assert.equal(calls.length, before + 1, 'The refused intent cannot be redispatched')
      const next = await createRun('separately-approved')
      reset()
      const separate = await runCli(['dispatch', ...flags(next, next.plan[0].id, approve(next, 'separate'))])
      assert.equal(separate.code, 0)
      assert.equal(separate.stderr, '')
      assert.equal(separate.summary.halted, null)
      assert.equal(calls.length, before + 2)
      const replayed = await runCli(['replay', '--output', state.directory])
      assert.equal(replayed.code, 0)
      assert.equal(replayed.stderr, '')
      assert.deepEqual(replayed.summary.halted, halted)
    })
  })
}

test('B2 the halt message is fixed, names the halt and carries no provider text', () => {
  assert.equal(RUN_HALTED_MESSAGE, 'Scorer run halted: the provider refused access (quota, billing or authorization). This run cannot dispatch again; a fresh run needs separate owner approval.\n')
})

test('B2 other 4xx responses stay charged without halting the run', async t => {
  for (const status of [400, 404, 408, 409, 413, 422]) await t.test(String(status), async t => {
    const setup = await workspace(t)
    const state = await setup.createRun('ordinary-4xx')
    const approval = setup.approve(state, 'ordinary-4xx')
    const [first, second] = state.plan
    syntheticHttp(t, { ...setup, state, id: first.id }, String(status))
    const rejected = await runCli(['dispatch', ...flags(state, first.id, approval)])
    assert.equal(rejected.code, 0)
    assert.equal(rejected.stderr, '')
    assert.equal(rejected.summary.halted, null)
    assert.equal(readJson(rejected.summary.report).payload.halted, null)
    assert.deepEqual(readJson(join(state.directory, `${first.id}.terminal.json`)).payload.raw, { failure: 'definitive_failure' })
    assert.equal(readJson(rejected.summary.report).payload.reservations.retainedMicroUsd, 100)
    assert.equal((await runCli(['dispatch', ...flags(state, second.id, approval)])).code, 0)
    assert.equal(calls.length, 2, 'The next planned dispatch stays admitted')
  })
})

test('B2 an access refusal interrupted before its terminal halts once reconciled', async t => {
  for (const role of ['baseline', 'claude', 'gemini']) await t.test(role, async t => {
    const setup = await canary(t, role)
    const { state, approval, id } = setup
    const before = calls.length
    syntheticHttp(t, setup, '429')
    publicationFailures.add('sealed_verdict')
    await assert.rejects(dispatchLive(state.directory, id, approval), /Simulated/)
    publicationFailures.clear()
    assert.equal(artifacts.exists(join(state.directory, `${id}.terminal.json`)), false)
    const recovered = await reconcileLive(state.directory, id, approval)
    assert.equal(recovered.reconciliation, 'failed')
    assert.equal(recovered.halted.httpStatus, 429)
    const later = await dispatchLive(state.directory, nextPlanned(state, id), approval)
    assert.equal(later.halted.httpStatus, 429)
    assert.equal(calls.length, before + 1)
    assert.equal(metadataCalls.length, 0)
  })
})

test('B2 a halted run keeps reporting its halt from sealed evidence after pins change', async t => {
  const setup = await canary(t, 'claude')
  const { state, approval, id } = setup
  syntheticHttp(t, setup, '402')
  await dispatchLive(state.directory, id, approval)
  advanceRevision()
  const summary = await replay(state.directory)
  assert.equal(summary.verification, 'sealed_digest_consistency')
  assert.equal(summary.halted.httpStatus, 402)
})

test('B2 the real CLI process refuses a halted run with its fixed message, a private HOME and network denied', async t => {
  const setup = await canary(t, 'gemini')
  const { state, approval, id, home } = setup
  syntheticHttp(t, setup, '403')
  await dispatchLive(state.directory, id, approval)
  const before = calls.length
  const later = nextPlanned(state, id)
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT' && !/(?:API_KEY|API_TOKEN|GATEWAY|CONVEX_DEPLOYMENT|E2E_)/.test(key)))
  const result = spawnSync(process.execPath, ['--import', join(artifacts.ROOT, 'tests/fixtures/learn-v2-scorer-harness/network-deny.mjs'),
    join(artifacts.ROOT, 'scripts/learn-v2-scorer-harness.mjs'), 'dispatch', ...flags(state, later, approval)],
  { cwd: artifacts.ROOT, encoding: 'utf8', timeout: 120_000, maxBuffer: 2_000_000, env: { ...env, HOME: home } })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
  assert.equal(result.stderr, RUN_HALTED_MESSAGE)
  assert.equal(JSON.parse(result.stdout).halted.httpStatus, 403)
  assert.equal(artifacts.exists(join(state.directory, `${later}.intent.json`)), false)
  assert.equal(calls.length, before)
})

test('B2 a live baseline row keeps its actual upstream and is reported beside the inventory value', async t => {
  const setup = await canary(t, 'baseline')
  const { state, approval, id } = setup
  syntheticHttp(t, setup, 'baseline-upstream')
  const summary = await dispatchLive(state.directory, id, approval)
  const { result } = readJson(join(state.directory, `${id}.terminal.json`)).payload
  assert.equal(result.status, 'valid')
  assert.equal(result.identity.servingProvider, 'Different observed provider')
  const report = readJson(summary.report).payload
  const baseline = Object.values(report.configurations).find(row => row.observedUpstreams)
  assert.equal(baseline.inventoryUpstream, 'OpenAI')
  assert.deepEqual(baseline.observedUpstreams.served.map(row => [row.upstream, row.matchesInventory, row.scheduled]), [['Different observed provider', false, 1]])
  assert.ok(report.consistencyClaimBlockers.includes('inventory_upstream_mismatch'))
})

test('B2 write-off refuses a saved known result and still closes saved uncertainty', async t => {
  const writeOffRefused = async (setup, file = ownerWriteOff(setup)) => {
    const { state, approval, id } = setup
    await assert.rejects(reconcileLive(state.directory, id, { ...approval, writeOffFile: file }), /Only an unknown outcome/)
    assert.equal(artifacts.exists(join(state.directory, `${id}.written-off.json`)), false)
  }
  for (const role of ['baseline', 'claude', 'gemini']) await t.test(`${role}/valid observation without a terminal`, async t => {
    const setup = await canary(t, role)
    const { state, approval, id } = setup
    publicationFailures.add('sealed_verdict')
    await assert.rejects(dispatchLive(state.directory, id, approval), /Simulated/)
    publicationFailures.clear()
    assert.equal(artifacts.exists(join(state.directory, `${id}.terminal.json`)), false)
    await writeOffRefused(setup)
    assert.equal((await reconcileLive(state.directory, id, approval)).reconciliation, 'resolved')
  })
  for (const role of ['baseline', 'claude', 'gemini']) await t.test(`${role}/known failure without a terminal`, async t => {
    const setup = await canary(t, role)
    const { state, approval, id } = setup
    syntheticHttp(t, setup, '400')
    publicationFailures.add('sealed_verdict')
    await assert.rejects(dispatchLive(state.directory, id, approval), /Simulated/)
    publicationFailures.clear()
    await writeOffRefused(setup)
    assert.equal((await reconcileLive(state.directory, id, approval)).reconciliation, 'failed')
  })
  for (const role of ['baseline', 'claude', 'gemini']) await t.test(`${role}/saved uncertainty without a terminal stays eligible`, async t => {
    const setup = await canary(t, role)
    const { state, approval, id } = setup
    syntheticHttp(t, setup, 'network-loss')
    publicationFailures.add('sealed_verdict')
    await assert.rejects(dispatchLive(state.directory, id, approval), /Simulated/)
    publicationFailures.clear()
    assert.equal((await reconcileLive(state.directory, id, { ...approval, writeOffFile: ownerWriteOff(setup) })).reconciliation, 'written_off')
  })
  await t.test('saved timely metadata proves a known result', async t => {
    const setup = await pendingBaseline(t)
    const { state, approval, id } = setup
    publicationFailures.add('reconciled_verdict')
    await assert.rejects(reconcileLive(state.directory, id, approval), /Simulated/)
    publicationFailures.clear()
    assert.ok(artifacts.exists(join(state.directory, `${id}.metadata-observation.json`)))
    await writeOffRefused(setup)
    assert.equal((await reconcileLive(state.directory, id, approval)).reconciliation, 'resolved')
  })
  await t.test('a durable pre-send cancellation without its terminal', async t => {
    const setup = await canary(t, 'baseline')
    const { state, approval, id } = setup
    syntheticHttp(t, setup, '400')
    process.env.OPENROUTER_API_KEY = process.env.NUXT_OPENROUTER_API_KEY = ''
    earlyFailures.add('sealed_verdict')
    await assert.rejects(dispatchLive(state.directory, id, approval), /Simulated/)
    earlyFailures.clear()
    assert.ok(artifacts.exists(join(state.directory, `${id}.not-dispatched.json`)))
    assert.equal(artifacts.exists(join(state.directory, `${id}.terminal.json`)), false)
    await writeOffRefused(setup)
    assert.equal((await reconcileLive(state.directory, id, approval)).reconciliation, 'not_dispatched')
  })
  await t.test('changed pins cannot write off a known sealed terminal', async t => {
    const setup = await canary(t, 'claude')
    const { state, approval, id } = setup
    await dispatchLive(state.directory, id, approval)
    const file = ownerWriteOff(setup)
    advanceRevision()
    await writeOffRefused(setup, file)
  })
  await t.test('changed pins cannot write off a known reconciliation', async t => {
    const setup = await pendingBaseline(t)
    const { state, approval, id } = setup
    assert.equal((await reconcileLive(state.directory, id, approval)).reconciliation, 'resolved')
    const file = ownerWriteOff(setup)
    advanceRevision()
    await writeOffRefused(setup, file)
  })
  await t.test('changed pins cannot write off a saved response they cannot classify', async t => {
    const setup = await canary(t, 'claude')
    const { state, approval, id } = setup
    publicationFailures.add('sealed_verdict')
    await assert.rejects(dispatchLive(state.directory, id, approval), /Simulated/)
    publicationFailures.clear()
    const file = ownerWriteOff(setup)
    advanceRevision()
    await writeOffRefused(setup, file)
  })
  await t.test('changed pins can still write off recorded transport uncertainty', async t => {
    const setup = await canary(t, 'claude')
    const { state, approval, id } = setup
    syntheticHttp(t, setup, 'network-loss')
    publicationFailures.add('sealed_verdict')
    await assert.rejects(dispatchLive(state.directory, id, approval), /Simulated/)
    publicationFailures.clear()
    const file = ownerWriteOff(setup)
    advanceRevision()
    assert.equal((await reconcileLive(state.directory, id, { ...approval, writeOffFile: file })).reconciliation, 'written_off')
  })
  await t.test('changed pins can still write off a sealed unknown terminal', async t => {
    const setup = await pendingBaseline(t)
    const file = ownerWriteOff(setup)
    advanceRevision()
    assert.equal((await reconcileLive(setup.state.directory, setup.id, { ...setup.approval, writeOffFile: file })).reconciliation, 'written_off')
  })
})

test('B2 a backward clock step during transport seals an observation that reopens', async t => {
  for (const role of ['baseline', 'claude', 'gemini']) await t.test(role, async t => {
    const setup = await canary(t, role)
    const { state, approval, id, createRun, approve, setClock, clock } = setup
    const before = calls.length
    const reset = syntheticHttp(t, setup, 'backward-clock-200')
    const summary = await dispatchLive(state.directory, id, approval)
    const intent = readJson(join(state.directory, `${id}.intent.json`)).payload
    const terminal = readJson(join(state.directory, `${id}.terminal.json`)).payload
    assert.equal(terminal.result.status, 'valid')
    assert.equal(terminal.terminalAt, intent.startedAt)
    assert.equal(readJson(join(state.directory, `${id}.observation.json`)).payload.terminalAt, intent.startedAt)
    assert.equal((await replay(state.directory)).digest, summary.digest)
    assert.equal(unresolvedLiveDispatches(await openLiveLedger(globalDirectory)).length, 0)
    setClock(clock)
    reset()
    const next = await createRun('after-backward-step')
    await dispatchLive(next.directory, next.plan[0].id, approve(next, 'after-backward-step'))
    assert.equal(calls.length, before + 2)
  })
})

test('B2 a backward clock step before transport cannot extend the 90-second bound', async t => {
  for (const role of ['baseline', 'claude', 'gemini']) await t.test(role, async t => {
    const { state, approval, id, setClock } = await canary(t, role)
    let watching = false
    afterIntent = intent => { setClock(intent.startedAt - 60_000); watching = true }
    const timers = []
    const expected = role === 'baseline' ? 2 : 1
    const original = globalThis.setTimeout
    const timerMock = mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
      if (watching && timers.length < expected) timers.push(delay)
      return original(callback, delay, ...args)
    })
    t.after(() => timerMock.mock.restore())
    await dispatchLive(state.directory, id, approval)
    assert.equal(timers.length, expected)
    assert.ok(timers.every(delay => delay <= contract.LIMITS.timeoutMs), `Transport timers: ${timers}`)
    assert.equal(readJson(join(state.directory, `${id}.terminal.json`)).payload.result.status, 'valid')
  })
})

test('B2 backward clock steps during reconciliation seal records that reopen', async t => {
  await t.test('metadata lookup', async t => {
    const { state, approval, id, setClock, clock, inferenceCalls } = await pendingBaseline(t)
    setClock(clock - 5_000)
    const summary = await reconcileLive(state.directory, id, approval)
    assert.equal(summary.reconciliation, 'resolved')
    assert.equal(readJson(join(state.directory, `${id}.metadata-intent.json`)).payload.startedAt, clock)
    assert.equal(readJson(join(state.directory, `${id}.metadata-observation.json`)).payload.observedAt, clock)
    assert.equal((await replay(state.directory)).digest, summary.digest)
    assert.equal(metadataCalls.length, 1)
    assert.equal(calls.length, inferenceCalls)
  })
  await t.test('metadata lookup cannot precede its saved observation', async t => {
    const { createRun, approve, setClock, clock } = await workspace(t)
    const state = await createRun('late-observation')
    const approval = approve(state, 'late-observation')
    const item = state.plan.find(row => row.adapter.startsWith('baseline_'))
    for (const preceding of state.plan.slice(0, state.plan.indexOf(item))) await dispatchLive(state.directory, preceding.id, approval)
    omitProvider = true
    afterIntent = () => setClock(clock + 1_000)
    await dispatchLive(state.directory, item.id, approval)
    afterIntent = null
    omitProvider = false
    assert.equal(readJson(join(state.directory, `${item.id}.observation.json`)).payload.terminalAt, clock + 1_000)
    setClock(clock + 500)
    const summary = await reconcileLive(state.directory, item.id, approval)
    assert.equal(summary.reconciliation, 'resolved')
    assert.equal(readJson(join(state.directory, `${item.id}.metadata-intent.json`)).payload.startedAt, clock + 1_000)
    assert.equal((await replay(state.directory)).digest, summary.digest)
  })
  await t.test('reconciliation successor', async t => {
    const { state, approval, id, setClock, clock } = await pendingBaseline(t)
    failuresAfterWrite.add('metadata_lookup_intent')
    await assert.rejects(reconcileLive(state.directory, id, approval), /Simulated/)
    failuresAfterWrite.clear()
    setClock(clock + 1_000)
    assert.equal((await reconcileLive(state.directory, id, approval)).reconciliation, 'still_unknown')
    const first = readJson(join(state.directory, `${id}.reconciled.json`)).payload
    const lookup = readJson(join(state.directory, `${id}.metadata-intent.json`))
    artifacts.seal(state.directory, `${id}.metadata-observation.json`, 'metadata_observation', state.pinsDigest,
      { lookupDigest: lookup.digest, observedAt: lookup.payload.startedAt, metadata: {
        generationId: lookup.payload.generationId, returnedModel: 'openai/gpt-4.1', servingProvider: 'OpenAI', upstreamRequestId: null,
        finishReason: 'stop', nativeFinishReason: 'stop', cancelled: false, usage: null,
      } })
    setClock(first.reconciledAt - 500)
    const summary = await reconcileLive(state.directory, id, approval)
    assert.equal(summary.reconciliation, 'resolved')
    assert.equal(readJson(join(state.directory, `${id}.reconciled-1.json`)).payload.reconciledAt, first.reconciledAt)
    assert.equal((await replay(state.directory)).digest, summary.digest)
  })
})

test('B2 operating-system metadata files are ignored while every other stray entry refuses', async t => {
  for (const name of ['.DS_Store', 'Thumbs.db', 'desktop.ini']) await t.test(name, async t => {
    const { createRun, approve } = await workspace(t)
    const state = await createRun('metadata')
    const approval = approve(state, 'metadata')
    writeFileSync(join(state.directory, name), 'operating-system metadata')
    writeFileSync(join(globalDirectory, name), 'operating-system metadata')
    const summary = await dispatchLive(state.directory, state.plan[0].id, approval)
    assert.equal(calls.length, 1)
    assert.equal((await replay(state.directory)).digest, summary.digest)
    assert.equal((await reconcileLive(state.directory, state.plan[0].id, approval)).reconciliation, 'resolved')
    assert.equal(unresolvedLiveDispatches(await openLiveLedger(globalDirectory)).length, 0)
  })
  for (const location of ['run', 'ledger']) for (const [kind, name] of [['file', 'stray.txt'], ['file', '.DS_Store.json'], ['file', '.ds_store'], ['file', 'thumbs.db'], ['directory', '.DS_Store']]) {
    await t.test(`${location}/${kind}/${name}`, async t => {
      const { createRun, approve } = await workspace(t)
      const state = await createRun('stray')
      const approval = approve(state, 'stray')
      const path = join(location === 'run' ? state.directory : globalDirectory, name)
      if (kind === 'file') writeFileSync(path, 'unexpected')
      else fs.mkdirSync(path)
      await assert.rejects(dispatchLive(state.directory, state.plan[0].id, approval), /Unexpected artifact|unknown global ledger entry/)
      assert.equal(calls.length, 0)
    })
  }
})
