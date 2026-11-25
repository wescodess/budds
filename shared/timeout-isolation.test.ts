import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify, stripVTControlCharacters } from 'node:util'
import { expect, test } from 'vitest'

const execute = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))
const cli = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
const config = fileURLToPath(new URL('../tests/fixtures/timeout-isolation/vitest.config.ts', import.meta.url))

async function runFixture(kind: string, mode: string) {
  try {
    const result = await execute(process.execPath, [cli, 'run', `convex/late-success-${kind}.test.ts`, '--config', config,
      '--mode', mode, '--maxWorkers=1', '--no-file-parallelism', '--reporter=verbose'], { cwd: root, timeout: 15_000, maxBuffer: 1024 * 1024 })
    return { code: 0, ...result }
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || !('stdout' in error) || !('stderr' in error)) throw error
    return { code: error.code, stdout: String(error.stdout), stderr: String(error.stderr) }
  }
}

test.each(['callback', 'await', 'rejection'])('a late %s failure after success still fails the run', async kind => {
  for (const mode of ['native', 'guarded']) {
    const result = await runFixture(kind, mode)
    const output = stripVTControlCharacters(`${result.stdout}\n${result.stderr}`)
    expect(output, mode).toMatch(/Tests\s+2 passed/)
    expect(output, mode).toContain(`Error: late-success-${kind}`)
    expect(output, mode).toContain('Unhandled Rejection')
    expect(result.code, mode).toBe(1)
  }
}, 35_000)
