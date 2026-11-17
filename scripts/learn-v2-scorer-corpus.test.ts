import { spawnSync } from 'node:child_process'
import { expect, test } from 'vitest'

test('ordinary CI verifies the source-proven corpus and its Node exit suite', () => {
  for (const args of [['scripts/learn-v2-scorer-corpus.mjs', 'verify'], ['--test', 'tests/fixtures/learn-v2-scorer/corpus.test.mjs']]) {
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 1_000_000 })
    expect(result.error, result.stderr).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  }
}, 65_000)
