import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROOT } from './artifacts.mjs'

export const LEDGER_EXIT_TEST_NAME = 'the global approval ledger exit regressions use isolated mock adapters with network denied'
// Each disjoint group retains the original process deadline.
const patterns = ['A3 M1 and crash table', 'A[456]', 'crash table|post-dispatch|publication internals', 'B1', 'B2',
  'A9 transport table [0-9]', 'A9 transport table [a-l]', 'A9 transport table [m-p]', 'A9 transport table [q-z]']
const residualPatterns = ['A', '256 model/configuration', '[a-m]']
const residual = `(?!(?:${patterns.join('|')}))`
const filters = [...patterns.map(pattern => `--test-name-pattern=^(?:${pattern})`),
  ...residualPatterns.map(pattern => `--test-name-pattern=^${residual}(?:${pattern})`),
  `--test-skip-pattern=^(?:${[...patterns, ...residualPatterns].join('|')})`]
const expected = [/A3 M1 and crash table/, /A5 historical admission/, /crash table: approval/, /B1/, /B2/,
  /A9 transport table 400/, /A9 transport table abort/, /A9 transport table malformed-200/, /A9 transport table redirect-loop/,
  /A12 response projection/, /256 model\/configuration reservations/, /a resolved canary permits/,
  /one signed approval cannot dispatch in two directories/]
const names = ['1', '2', '3', '4', '5', '6a', '6b', '6c', '6d', '7a', '7b', '7c', '7d']
export const ledgerPartitions = filters.map((filter, index) => ({ name: names[index], filter, expected: expected[index] }))

export function runLedgerPartition(partition) {
  const started = performance.now()
  const home = mkdtempSync(join(tmpdir(), 'budds-ledger-home-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT'
    && !/(?:API_KEY|API_TOKEN|GATEWAY|CONVEX_DEPLOYMENT|E2E_)/.test(key)))
  const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--import', join(ROOT, 'tests/fixtures/learn-v2-scorer-harness/network-deny.mjs'),
    '--test', '--test-reporter=tap', '--test-concurrency=1', partition.filter, join(ROOT, 'scripts/lib/learn-v2-scorer/live-ledger.test.mjs')], {
    cwd: ROOT, env: { ...env, HOME: home }, encoding: 'utf8', timeout: 360_000, maxBuffer: 2_000_000,
  })
  rmSync(home, { recursive: true, force: true })
  assert.equal(result.error, undefined, `${result.error?.message}\n${result.stdout}\n${result.stderr}`)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, partition.expected)
  const count = Number(result.stdout.match(/^# tests (\d+)$/m)?.[1])
  assert.ok(count > 0, 'Each ledger partition must run tests')
  return `Ledger partition ${partition.name}: ${count} tests in ${(performance.now() - started).toFixed(0)} ms`
}
