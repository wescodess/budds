import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { ROOT } from './artifacts.mjs'

export const LEDGER_EXIT_TEST_NAME = 'the global approval ledger exit regressions use isolated mock adapters with network denied'
const patterns = ['A3 M1 and crash table', 'A[456]', 'crash table|post-dispatch|publication internals', 'B1']
const filters = [...patterns.map(pattern => `--test-name-pattern=^(?:${pattern})`),
  `--test-skip-pattern=^(?:${patterns.join('|')})`]
const expected = [/A3 M1 and crash table/, /A5 historical admission/, /crash table: approval/, /B1/, /one signed approval cannot dispatch in two directories/]
export const ledgerPartitions = filters.map((filter, index) => ({ name: String(index + 1), filter, expected: expected[index] }))

export function runLedgerPartition(partition) {
  const started = performance.now()
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT'
    && !/(?:API_KEY|API_TOKEN|GATEWAY|CONVEX_DEPLOYMENT|E2E_)/.test(key)))
  const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--import', join(ROOT, 'tests/fixtures/learn-v2-scorer-harness/network-deny.mjs'),
    '--test', '--test-reporter=tap', '--test-concurrency=1', partition.filter, join(ROOT, 'scripts/lib/learn-v2-scorer/live-ledger.test.mjs')], {
    cwd: ROOT, env, encoding: 'utf8', timeout: 360_000, maxBuffer: 2_000_000,
  })
  assert.equal(result.error, undefined, `${result.error?.message}\n${result.stdout}\n${result.stderr}`)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, partition.expected)
  const count = Number(result.stdout.match(/^# tests (\d+)$/m)?.[1])
  assert.ok(count > 0, 'Each ledger partition must run tests')
  return `Ledger partition ${partition.name}: ${count} tests in ${(performance.now() - started).toFixed(0)} ms`
}
