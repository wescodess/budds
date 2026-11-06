import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const fakePnpm = `#!/usr/bin/env node
const { createServer } = require('node:http')
const port = Number(process.argv[process.argv.indexOf('--port') + 1])
const html = '<div id="__nuxt"><button aria-busy="false"></button><a href="/terms"></a></div>'
const scenario = process.env.FAKE_WRANGLER_SCENARIO
const ready = () => console.log('[wrangler:info] Ready on http://127.0.0.1:' + port)
let loaded = false
const held = []
function answer(response) {
  response.writeHead(200, { 'content-type': 'text/html' })
  response.end(html)
}
createServer((request, response) => {
  if (scenario === 'hung') return
  if (loaded) answer(response)
  else held.push(response)
}).listen(port, '127.0.0.1', () => {
  console.log('fake wrangler booted')
  if (scenario === 'hung') ready()
  if (scenario === 'missing-ready') {
    loaded = true
    held.splice(0).forEach(answer)
  }
  if (scenario === 'slow-start') {
    setTimeout(() => {
      loaded = true
      ready()
      held.splice(0).forEach(answer)
    }, 16_000)
  }
})
`

const root = mkdtempSync(join(tmpdir(), 'budds-smoke-fixture-'))
const bin = join(root, 'bin')
const dist = join(root, 'dist')
mkdirSync(bin)
mkdirSync(join(dist, '_worker.js'), { recursive: true })
writeFileSync(join(dist, '_worker.js/index.js'), '')
writeFileSync(join(bin, 'pnpm'), fakePnpm)
chmodSync(join(bin, 'pnpm'), 0o755)
after(() => rmSync(root, { recursive: true, force: true }))

async function smoke(scenario, env = {}) {
  const startedAt = Date.now()
  const child = spawn(process.execPath, [fileURLToPath(new URL('./smoke-production.mjs', import.meta.url)), dist], {
    env: { ...process.env, ...env, FAKE_WRANGLER_SCENARIO: scenario, PATH: `${bin}${delimiter}${process.env.PATH}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const [status] = await once(child, 'close')
  return { status, stdout, stderr, elapsed: Date.now() - startedAt }
}

describe('production smoke startup', { concurrency: true }, () => {
  test('a worker that loads after the request limit still passes', async () => {
    const result = await smoke('slow-start')
    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.elapsed >= 16_000, `elapsed ${result.elapsed}`)
    assert.match(result.stdout, /Production SSR passed: \/login/)
    assert.match(result.stdout, /Production SSR passed: \/privacy/)
  })

  test('a hung renderer fails at the request limit as a hang', async () => {
    const result = await smoke('hung')
    assert.equal(result.status, 1)
    assert.match(result.stderr, /\/login: renderer hung: no complete response within 15s after Wrangler reported ready/)
    assert.ok(result.elapsed < 30_000, `elapsed ${result.elapsed}`)
  })

  test('a missing ready line fails at the deadline with labelled output', async () => {
    const result = await smoke('missing-ready', { SMOKE_STARTUP_TIMEOUT_MS: '1500' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Wrangler did not print "Ready on" within 1\.5s/)
    assert.match(result.stderr, /--- Captured Wrangler output ---\nfake wrangler booted\n/)
    assert.ok(result.elapsed < 15_000, `elapsed ${result.elapsed}`)
  })
})
