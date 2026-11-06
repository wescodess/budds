import { spawnSync } from 'node:child_process'
import { expect, test } from 'vitest'

test('the scorer harness exit test runs offline through the Node 24 CLI', () => {
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'scripts/lib/learn-v2-scorer/exit.test.mjs'], {
    encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', OPENROUTER_API_KEY: '', NUXT_OPENROUTER_API_KEY: '' },
    timeout: 240_000, maxBuffer: 2_000_000,
  })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}, 250_000)
