import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerScorerImports, forbidNetwork } from './lib/learn-v2-scorer/runtime.mjs'

export async function main(argv = process.argv.slice(2)) {
  registerScorerImports()
  const [command, ...args] = argv
  assert.ok(['init', 'run', 'replay', 'plan', 'dispatch', 'reconcile'].includes(command), 'Usage: node scripts/learn-v2-scorer-harness.mjs init|run|replay|plan|dispatch|reconcile --output DIRECTORY [options]')
  const options = {}
  const allowed = ['output', 'inventory', 'fixture', 'clock', 'seed', 'budget-micro-usd', 'price-access-date', 'mode', 'configuration', 'anchors',
    'stop-after', 'crash-after-intent', 'expected-report', 'id', 'approval', 'cost-evidence', 'owner-public-key']
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.slice(2)
    assert.ok(args[index]?.startsWith('--') && allowed.includes(key) && args[index + 1] && !(key in options), 'Unknown, duplicated or incomplete option')
    options[key] = args[index + 1]
  }
  assert.ok(options.output, 'Artifact directory required')
  if (!['dispatch', 'reconcile'].includes(command)) forbidNetwork()
  const { initialize, runOffline, replay, dispatchLive, reconcileLive, planRun } = await import('./lib/learn-v2-scorer/runner.mjs')
  const { readJson } = await import('./lib/learn-v2-scorer/artifacts.mjs')
  if (command === 'init') {
    assert.ok(options.inventory && options.clock && options.seed && options['budget-micro-usd'] && options['price-access-date'], 'Complete explicit run pins required')
    const output = await initialize({ output: options.output, mode: options.mode ?? 'offline', inventory: readJson(options.inventory),
      fixture: options.fixture ? readJson(options.fixture) : null, anchors: options.anchors ? readJson(options.anchors) : undefined,
      clock: Number(options.clock), seed: options.seed, budgetMicroUsd: Number(options['budget-micro-usd']),
      priceAccessDate: options['price-access-date'], configuration: options.configuration })
    return { output, initialized: true, liveDispatches: 0 }
  }
  if (command === 'run') {
    const stopAfter = options['stop-after'] === undefined ? undefined : Number(options['stop-after'])
    assert.ok(stopAfter === undefined || (Number.isSafeInteger(stopAfter) && stopAfter > 0), 'Invalid stop count')
    if (options['crash-after-intent'] !== undefined) assert.equal(options['crash-after-intent'], 'true')
    return runOffline(options.output, { stopAfter, crashAfterIntent: options['crash-after-intent'] === 'true' })
  }
  if (command === 'replay') return replay(options.output, options['expected-report'])
  if (command === 'plan') return planRun(options.output)
  const live = command === 'reconcile' ? reconcileLive : dispatchLive
  return live(options.output, options.id, { approvalFile: options.approval, costFile: options['cost-evidence'], trustKey: options['owner-public-key'] })
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(() => {
    // No upstream bodies, source/response text, keys or approval contents in logs.
    process.stderr.write('Scorer harness blocked; inspect local pins, sealed artifacts and required approvals.\n')
    process.exitCode = 1
  })
}
