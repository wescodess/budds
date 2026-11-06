import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

// Keep the native Node ESM/CJS and browser-UMD probes inside the required unit suite.
// Prototype-pollution probes run in this disposable process, never in Vitest's realm.
it('passes the shipped dependency security and compatibility contracts', () => {
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'scripts/dependency-security-probe.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
})
