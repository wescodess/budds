import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const directory = resolve(process.argv[2] || 'dist')
await access(join(directory, '_worker.js/index.js'))
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'budds-production-smoke-'))
const socket = createServer()
socket.listen(0, '127.0.0.1')
await once(socket, 'listening')
const port = socket.address().port
await new Promise(resolve => socket.close(resolve))

// Use the deploy script's pinned Wrangler, without a second application build.
// An empty working directory prevents loading local .env/.dev.vars or bindings.
const args = [
  '--package=wrangler@4.157.0', 'dlx', 'wrangler', 'pages', 'dev', directory,
  '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0',
  '--compatibility-date', '2025-01-01', '--compatibility-flags', 'nodejs_compat',
]
for (const name of ['CONVEX_URL', 'NUXT_PUBLIC_CONVEX_URL', 'NUXT_PUBLIC_SITE_URL', 'NUXT_BETTER_AUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
  if (process.env[name]) args.push('--binding', `${name}=${process.env[name]}`)
}
const server = spawn('pnpm', args, {
  cwd: temporaryDirectory,
  env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})
const closed = new Promise(resolve => server.once('close', resolve))
let output = ''
let startupError
server.on('error', error => { startupError = error })
for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', chunk => { output = (output + chunk.toString()).slice(-32_000) })
}

function stop(signal = 'SIGTERM') {
  if (server.pid) {
    try { process.kill(-server.pid, signal) } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
}
async function shutdown() {
  stop()
  if (await Promise.race([closed.then(() => true), delay(5_000, false, { ref: false })])) return
  stop('SIGKILL')
  if (!await Promise.race([closed.then(() => true), delay(5_000, false, { ref: false })])) {
    server.stdout.destroy()
    server.stderr.destroy()
    throw new Error('Pages preview did not close after SIGKILL')
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    try { await shutdown() } finally { process.exit(signal === 'SIGINT' ? 130 : 143) }
  })
}

try {
  const origin = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 180_000
  let response
  while (Date.now() < deadline) {
    if (startupError) throw startupError
    if (server.exitCode !== null || server.signalCode !== null) throw new Error('Pages preview exited before readiness')
    // Retry connection startup only. A served 500 must fail immediately.
    response = await fetch(`${origin}/login`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) }).catch((error) => {
      if (error.cause?.code !== 'ECONNREFUSED') throw new Error('/login: production Pages preview request failed or timed out', { cause: error })
    })
    if (response) break
    await delay(500)
  }
  if (!response) throw new Error('Timed out starting the production Pages preview')

  for (const [pathname, marker] of [['/login', /<button\b[^>]*\baria-busy="false"/], ['/privacy', /<a\b[^>]*\bhref="\/terms"/]]) {
    const page = pathname === '/login' ? response : await fetch(`${origin}${pathname}`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    const html = await page.text()
    const ssrBody = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    if (page.status !== 200 || !page.headers.get('content-type')?.includes('text/html') || !/<div\b[^>]*\bid="__nuxt"[^>]*>/.test(ssrBody) || !marker.test(ssrBody)) {
      throw new Error(`${pathname}: expected Nuxt SSR HTML containing ${marker}, got HTTP ${page.status}\n${html.slice(0, 1000)}`)
    }
    console.log(`Production SSR passed: ${pathname} HTTP 200, rendered page attributes.`)
  }
  if (/Cannot read properties of null \(reading ['"]ce['"]\)/.test(output)) {
    throw new Error('Vue rendering-state failure in production preview output')
  }
} catch (error) {
  console.error(output)
  throw error
} finally {
  try { await shutdown() } finally { await rm(temporaryDirectory, { recursive: true, force: true }) }
}
