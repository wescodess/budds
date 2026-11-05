import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('Vue guard rejects split versions, missing records, and format drift', () => {
  const directory = mkdtempSync(join(tmpdir(), 'budds-vue-lock-'))
  const file = join(directory, 'pnpm-lock.yaml')
  const names = ['vue', ...['reactivity', 'runtime-core', 'runtime-dom', 'server-renderer', 'shared', 'compiler-core', 'compiler-dom', 'compiler-sfc', 'compiler-ssr'].map(name => `@vue/${name}`)]
  const records = names.map(name => `  '${name}@3.5.44': {}`).join('\n')
  const fixture = `lockfileVersion: '9.0'\npackages:\n${records}\nsnapshots:\n${records}\n`
  function check(contents) {
    writeFileSync(file, contents)
    return spawnSync(process.execPath, [new URL('./check-vue-runtime.mjs', import.meta.url).pathname, file], { encoding: 'utf8' })
  }
  try {
    assert.equal(check(fixture).status, 0)
    // Peer variants of the same version are fine; a second runtime version is not.
    assert.equal(check(`${fixture}  vue@3.5.44(typescript@5.9.3):\n`).status, 0)
    for (const name of names) {
      const split = check(`${fixture}  '${name}@3.5.42(vue@3.5.42)':\n`)
      assert.equal(split.status, 1, name)
      assert.ok(split.stderr.includes(`${name}:`), split.stderr)
    }
    assert.equal(check(fixture.replaceAll("  '@vue/shared@3.5.44': {}\n", '')).status, 1)
    assert.equal(check(fixture.replace("'9.0'", "'10.0'")).status, 1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
