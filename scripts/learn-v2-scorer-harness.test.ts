import { spawnSync } from 'node:child_process'
import { expect, test } from 'vitest'
import { LEDGER_EXIT_TEST_NAME, ledgerPartitions, runLedgerPartition } from './lib/learn-v2-scorer/ledger-exit.mjs'

test('the scorer harness exit test runs offline through the Node 24 CLI', () => {
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', `--test-skip-pattern=^${LEDGER_EXIT_TEST_NAME}$`, 'scripts/lib/learn-v2-scorer/exit.test.mjs'], {
    encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', OPENROUTER_API_KEY: '', NUXT_OPENROUTER_API_KEY: '' },
    timeout: 480_000, maxBuffer: 2_000_000,
  })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}, 490_000)

// Each serial partition gets its own deadline. Nesting every ledger partition
// under the CLI's 480-second process timeout made their runtimes accumulate.
test.each(ledgerPartitions)('the scorer global ledger exit partition $name runs with network denied', partition => {
  console.info(runLedgerPartition(partition))
}, 370_000)
