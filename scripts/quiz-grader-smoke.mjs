// Manual only; deliberately absent from package.json and all test globs.
// QUIZ_GRADER_SMOKE=1 node --env-file=/approved/path/.env scripts/quiz-grader-smoke.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { fixtures } from './quiz-grader-smoke-fixtures.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const model = 'xingchen-agi/xing4.0-29b-a4b:free'
const maximumRequests = 8
const variant = process.env.QUIZ_GRADER_SMOKE_VARIANT ?? 'production'
const spacedRetryPlan = process.env.QUIZ_GRADER_SMOKE_PLAN === 'spaced-probes-v1'
const evidencePath = resolve(root, 'docs/operations/quiz-grading-smoke-observations.json')
const credentialGroups = [
  ['NUXT_CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID'],
  ['NUXT_CLOUDFLARE_AI_GATEWAY_ID', 'CLOUDFLARE_AI_GATEWAY_ID'],
  ['NUXT_CLOUDFLARE_AI_GATEWAY_API_KEY', 'CLOUDFLARE_AI_GATEWAY_API_KEY'],
  ['NUXT_OPENROUTER_API_KEY', 'OPENROUTER_API_KEY'],
]

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

// Do not persist bodies, authentication headers, URLs, completion IDs or unrestricted errors.
// Even the short diagnostic reason is scrubbed against every loaded env value.
function safeReason(value) {
  let result = typeof value === 'string' ? value : 'No diagnostic message'
  for (const secret of Object.values(process.env).filter(value => value && value.length >= 4).sort((a, b) => b.length - a.length)) {
    result = result.replaceAll(secret, '[redacted]')
  }
  return result.replace(/Bearer\s+\S+|sk-[\w-]+|https?:\/\/\S+/gi, '[redacted]').replace(/[\r\n\t]/g, ' ').slice(0, 350)
}

const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null

function rateLimitMetadata(headers) {
  const values = Object.fromEntries([...headers].filter(([name]) => /rate.?limit|retry.?after/i.test(name))
    .map(([name, value]) => [name, safeReason(value)]))
  const retryAfter = headers.get('retry-after')
  const milliseconds = retryAfter === null ? NaN : /^\d+(?:\.\d+)?$/.test(retryAfter.trim())
    ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()
  return {
    rateLimitHeaders: values, retryAfterPresent: retryAfter !== null,
    retryAfterMs: Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : null,
    retryAfterNotBefore: Number.isFinite(milliseconds) ? new Date(Date.now() + Math.max(0, milliseconds)).toISOString() : null,
  }
}

async function waitUntil(timestamp) {
  while (Date.now() < Date.parse(timestamp)) {
    console.log(JSON.stringify({ waitingUntil: timestamp, remainingSeconds: Math.ceil((Date.parse(timestamp) - Date.now()) / 1000) }))
    await delay(Math.min(30_000, Date.parse(timestamp) - Date.now()))
  }
}

async function main() {
  requireCondition(process.env.QUIZ_GRADER_SMOKE === '1', 'Refusing to run: set QUIZ_GRADER_SMOKE=1 explicitly.')
  requireCondition(['production', 'omit-reasoning', 'json-object'].includes(variant), 'Unknown smoke variant.')
  requireCondition(!spacedRetryPlan || variant === 'production', 'Spaced probes and fixture batches must use production defaults.')
  const missing = credentialGroups.filter(names => !names.some(name => process.env[name]?.trim()))
  requireCondition(missing.length === 0, `Missing required variables: ${missing.map(names => names.join(' or ')).join('; ')}`)
  requireCondition(process.env.BUDDS_E2E_MODE !== 'true', 'Refusing to run with deterministic E2E mode enabled.')

  // Node 24 strips TS types; this narrow hook resolves the production modules'
  // extensionless relative imports without transpiling or changing their code.
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      try { return nextResolve(specifier, context) }
      catch (error) {
        if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && context.parentURL?.startsWith(`file://${root}/`)) {
          return nextResolve(`${specifier}.ts`, context)
        }
        throw error
      }
    },
  })
  const { gradeQuizAnswers, QUIZ_GRADING_BATCH_SIZE } = await import('../server/utils/quiz-grading.ts')
  const { scoreQuizCriteria, validateQuizGradingCriteria } = await import('../shared/quiz-grading.ts')
  requireCondition(QUIZ_GRADING_BATCH_SIZE === 8, 'Production batch size changed; review the smoke script.')
  for (const fixture of fixtures) {
    validateQuizGradingCriteria(fixture.input.criteria)
    scoreQuizCriteria(fixture.input.criteria, fixture.expected)
  }

  const ledgerPath = resolve(root, execFileSync('git', ['rev-parse', '--git-path', 'quiz-grader-smoke.json'], { cwd: root, encoding: 'utf8' }).trim())
  // The lock prevents simultaneous invocations from racing the shared cap.
  const lock = openSync(`${ledgerPath}.lock`, 'wx', 0o600)
  const realFetch = globalThis.fetch
  try {
    const previousEvidence = existsSync(ledgerPath) ? ledgerPath : existsSync(evidencePath) ? evidencePath : null
    const ledger = previousEvidence ? JSON.parse(readFileSync(previousEvidence, 'utf8')) : {
      version: 1, requestsUsed: 0, halted: false, requests: [], allowance: [],
    }
    requireCondition(ledger.version === 1 && Number.isInteger(ledger.requestsUsed)
      && ledger.requestsUsed === ledger.requests.length && ledger.requestsUsed >= 0 && ledger.requestsUsed <= maximumRequests,
    'Invalid request ledger; do not reset it to obtain more budget.')
    function save() {
      const serialized = `${JSON.stringify(ledger, null, 2)}\n`
      writeFileSync(ledgerPath, serialized, { mode: 0o600 })
      writeFileSync(evidencePath, serialized)
    }

    if (spacedRetryPlan && !ledger.retryPlan) {
      requireCondition(ledger.requestsUsed === 1 && ledger.halted && ledger.requests[0].httpStatus === 429,
        'This one-time retry authorization requires exactly the original one-request 429 ledger.')
      ledger.retryPlan = {
        id: 'spaced-probes-v1', authorizedAt: new Date().toISOString(), status: 'waiting', probesUsed: 0,
        nextProbeNotBefore: new Date(Date.parse(ledger.requests[0].at) + ledger.requests[0].latencyMs + 5 * 60_000).toISOString(),
        maximumProbes: 3, delayAfter429Ms: [10 * 60_000, 20 * 60_000],
      }
      ledger.halted = false // Only the owner's bounded follow-up plan clears the original 429.
      save()
    }
    if (spacedRetryPlan && ledger.retryPlan.status === 'stopped_batch_429') {
      const last = ledger.requests.at(-1)
      // Both fixture batches are authorized after a successful probe. Do not
      // retry batch 1: space the one remaining, distinct batch after its 429.
      const secondBatchPending = last.kind === 'fixture_batch' && last.batch === 1 && last.httpStatus === 429
        && ledger.requests.some(request => request.kind === 'probe' && request.outcome === 'graded')
        && !ledger.requests.some(request => request.kind === 'fixture_batch' && request.batch === 2)
      if (secondBatchPending) {
        ledger.retryPlan.nextFixtureNotBefore = new Date(Math.max(Date.parse(last.finishedAt) + 10 * 60_000,
          Date.parse(last.retryAfterNotBefore ?? '') || 0)).toISOString()
        ledger.retryPlan.status = 'fixtures'
        ledger.halted = false
        save()
      }
    }
    if (ledger.retryPlan && ['waiting', 'fixtures', 'inflight'].includes(ledger.retryPlan.status)) {
      requireCondition(spacedRetryPlan, 'An active retry plan must resume with QUIZ_GRADER_SMOKE_PLAN=spaced-probes-v1.')
    }
    if (spacedRetryPlan) requireCondition(['waiting', 'fixtures'].includes(ledger.retryPlan.status), 'Spaced retry plan is complete, stopped or has an unresolved in-flight request.')
    requireCondition(!ledger.halted, 'Previous run halted (429 or cost/model violation); no further requests allowed.')
    requireCondition(ledger.requestsUsed < maximumRequests, 'Eight-request budget exhausted.')

    async function allowance(phase) {
      if (process.env.QUIZ_GRADER_SMOKE_CHECK_ALLOWANCE !== '1') return
      const names = credentialGroups[3]
      const key = names.map(name => process.env[name]?.trim()).find(Boolean)
      const response = await realFetch('https://openrouter.ai/api/v1/key', {
        headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(10_000),
      })
      const entry = { phase, status: response.status }
      if (response.status === 429) ledger.halted = true
      if (response.ok) {
        const { data } = await response.json()
        // Only limit and usage numbers; the endpoint is not an inference call.
        for (const name of ['limit', 'limit_remaining', 'usage', 'usage_daily', 'usage_weekly', 'usage_monthly']) entry[name] = numeric(data?.[name])
        entry.free_model_daily_requests = Object.fromEntries(['used', 'limit', 'remaining'].map(name => [name, numeric(data?.free_model_daily_requests?.[name])]))
      }
      ledger.allowance.push(entry)
      save()
      requireCondition(!ledger.halted, '429 from key endpoint; stopped without inference.')
    }

    await allowance('before')
    let active
    globalThis.fetch = async (url, options) => {
      requireCondition(!ledger.halted && ledger.requestsUsed < maximumRequests, 'Provider request budget exhausted or halted.')
      const target = new URL(url)
      requireCondition(target.origin === 'https://gateway.ai.cloudflare.com'
        && target.pathname.endsWith('/openrouter/v1/chat/completions') && options?.method === 'POST', 'Unexpected network destination.')
      const body = JSON.parse(options.body)
      const policy = body.provider
      requireCondition(body.model === model && body.temperature === 0 && body.stream === false
        && policy?.max_price?.prompt === 0 && policy?.max_price?.completion === 0
        && policy.zdr === true && policy.data_collection === 'deny' && policy.allow_fallbacks === false
        && policy.require_parameters === true && JSON.stringify(policy.only) === '["phala"]' && JSON.stringify(policy.order) === '["phala"]'
        && options.headers['cf-aig-max-attempts'] === '1' && options.headers['cf-aig-collect-log-payload'] === 'false'
        && options.headers['cf-aig-skip-cache'] === 'true' && body.response_format?.json_schema?.strict === true,
      'Production request no longer matches the mandatory smoke policy.')
      if (variant === 'omit-reasoning') delete body.reasoning
      if (variant === 'json-object') body.response_format = { type: 'json_object' }
      active.requestNumber = ++ledger.requestsUsed
      if (spacedRetryPlan) {
        if (active.kind === 'probe') ledger.retryPlan.probesUsed++
        ledger.retryPlan.status = 'inflight'
      }
      active.answerCount = JSON.parse(body.messages.at(-1).content).items.length
      active.requestBytes = Buffer.byteLength(JSON.stringify(body))
      active.requestSizeSource = 'measured before dispatch'
      active.strictSchemaRequested = variant !== 'json-object'
      active.policy = { model, phalaOnly: true, zdr: true, denyDataCollection: true, zeroPriceCap: true, fallbacks: false, payloadLogging: false, skipCache: true, maxAttempts: 1 }
      ledger.requests.push(active)
      save() // Reserve before dispatch; a crash never refunds the request.
      const start = performance.now()
      try {
        const response = await realFetch(url, { ...options, body: JSON.stringify(body), redirect: 'error' })
        active.httpStatus = response.status
        Object.assign(active, rateLimitMetadata(response.headers))
        if (response.status === 429) { ledger.halted = true; save() }
        // Consume within the adapter's existing deadline; return identical bytes.
        const text = await response.text()
        active.latencyMs = Math.round(performance.now() - start)
        active.finishedAt = new Date().toISOString()
        let envelope
        try { envelope = JSON.parse(text) }
        catch { active.reason = 'Response was not JSON' }
        if (!response.ok) active.reason = safeReason(envelope?.error?.message ?? envelope?.errors?.[0]?.message ?? 'Provider HTTP failure without a message')
        if (!response.ok && typeof envelope?.error?.metadata?.raw === 'string') {
          let raw = envelope.error.metadata.raw
          try { const parsed = JSON.parse(raw); raw = parsed.error?.message ?? parsed.message ?? 'Nested provider error (details suppressed)' }
          catch { /* Plain-text upstream errors are scrubbed just like the top-level reason. */ }
          const message = safeReason(raw)
          active.upstreamReason = message.includes('is temporarily rate-limited upstream.')
            ? `${model} is temporarily rate-limited upstream.` : message
        }
        if (response.ok && envelope) {
          active.returnedModel = [model, model.replace(/:free$/, '')].includes(envelope.model) ? envelope.model : 'unexpected (redacted)'
          active.freeSuffix = typeof envelope.model === 'string' && envelope.model.endsWith(':free')
          active.finishReason = ['stop', 'length', 'content_filter', 'error', 'tool_calls'].includes(envelope.choices?.[0]?.finish_reason) ? envelope.choices[0].finish_reason : 'unknown'
          active.cost = numeric(envelope.usage?.cost)
          if (active.returnedModel === 'unexpected (redacted)' || (active.cost !== null && active.cost !== 0)) ledger.halted = true
        }
        save()
        return new Response(text, { status: response.status, headers: response.headers })
      }
      catch (error) {
        active.latencyMs = Math.round(performance.now() - start)
        active.finishedAt = new Date().toISOString()
        active.reason = ['AbortError', 'TimeoutError'].includes(error.name) ? 'Request deadline exceeded' : 'Network failure (details suppressed)'
        save()
        throw new Error(active.reason, { cause: error })
      }
    }

    async function runBatch(batch, details) {
      active = { variant, ...details, at: new Date().toISOString(), fixtureIds: batch.map(fixture => fixture.input.id) }
      const outcome = await gradeQuizAnswers(batch.map(fixture => fixture.input))
      // An unconfigured/pre-dispatch failure must never masquerade as a call.
      requireCondition(active.requestNumber !== undefined, `No provider dispatch: ${outcome.status === 'unavailable' ? outcome.reason : 'unexpected result'}`)
      active.outcome = outcome.status
      if (outcome.status === 'graded') {
        active.schemaValid = true // The real adapter accepted exact keys, enums, lengths and complete ID/key coverage.
        active.results = outcome.results.map(result => {
          const fixture = batch.find(fixture => fixture.input.id === result.id)
          const wordingViolations = [...new Set(result.feedback.toLowerCase().match(/\b(?:criteri(?:a|on)|rubrics?|weight(?:s|ed|ing)?|grad(?:e[ds]?|ing)|confiden(?:ce|t))\b/g) ?? [])]
          const sentenceCount = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(result.feedback)].filter(part => part.segment.trim()).length
          return { id: result.id, criterionResults: result.criterionResults, ...scoreQuizCriteria(fixture.input.criteria, result.criterionResults), wordingViolations, sentenceCount }
        })
      }
      else { active.failure = { reason: outcome.reason, retryable: outcome.retryable }; active.schemaValid = null }
      save()
      console.log(JSON.stringify(active))
      return outcome
    }

    if (spacedRetryPlan && ledger.retryPlan.status === 'waiting') {
      while (ledger.retryPlan.probesUsed < ledger.retryPlan.maximumProbes) {
        await waitUntil(ledger.retryPlan.nextProbeNotBefore)
        const outcome = await runBatch(fixtures.slice(0, 1), { kind: 'probe', probe: ledger.retryPlan.probesUsed + 1 })
        if (outcome.status === 'graded' && !ledger.halted) {
          ledger.retryPlan.status = 'fixtures'
          save()
          break
        }
        if (active.httpStatus !== 429 || ledger.retryPlan.probesUsed === ledger.retryPlan.maximumProbes) {
          ledger.retryPlan.status = active.httpStatus === 429 ? 'stopped_all_probes_429' : 'stopped_probe_failure'
          ledger.halted = true
          save()
          break
        }
        // Clear only this probe's 429 for the next explicitly authorized probe.
        const minimumDelay = ledger.retryPlan.delayAfter429Ms[ledger.retryPlan.probesUsed - 1]
        ledger.retryPlan.nextProbeNotBefore = new Date(Math.max(Date.now() + minimumDelay, Date.parse(active.retryAfterNotBefore ?? '') || 0)).toISOString()
        ledger.retryPlan.status = 'waiting'
        ledger.halted = false
        save()
      }
    }

    if (!spacedRetryPlan || ledger.retryPlan.status === 'fixtures') {
      for (let offset = 0; offset < fixtures.length; offset += QUIZ_GRADING_BATCH_SIZE) {
        if (ledger.halted || ledger.requestsUsed >= maximumRequests) break
        const batchNumber = offset / QUIZ_GRADING_BATCH_SIZE + 1
        if (spacedRetryPlan && ledger.requests.some(request => request.kind === 'fixture_batch' && request.batch === batchNumber)) continue
        if (spacedRetryPlan && ledger.retryPlan.nextFixtureNotBefore) await waitUntil(ledger.retryPlan.nextFixtureNotBefore)
        const outcome = await runBatch(fixtures.slice(offset, offset + QUIZ_GRADING_BATCH_SIZE), { kind: 'fixture_batch', batch: batchNumber })
        if (spacedRetryPlan) {
          ledger.retryPlan.status = outcome.status === 'graded' && !ledger.halted ? 'fixtures' : active.httpStatus === 429 ? 'stopped_batch_429' : 'stopped_batch_failure'
          save()
        }
        if (outcome.status !== 'graded' || ledger.halted) break // Diagnostics remain manual and bounded.
      }
      if (spacedRetryPlan && ledger.retryPlan.status === 'fixtures') {
        ledger.retryPlan.status = ledger.requests.some(request => request.kind === 'fixture_batch' && request.outcome !== 'graded') ? 'complete_with_failures' : 'complete'
        ledger.halted = true
        save()
      }
    }
    if (!ledger.halted) await allowance('after')
    console.log(JSON.stringify({ requestsUsed: ledger.requestsUsed, maximumRequests, halted: ledger.halted }))
  }
  finally {
    globalThis.fetch = realFetch
    hooks.deregister()
    closeSync(lock)
    unlinkSync(`${ledgerPath}.lock`)
  }
}

main().catch(error => {
  console.error(safeReason(error.message)) // Never dump Error objects or stacks.
  process.exitCode = 1
})
