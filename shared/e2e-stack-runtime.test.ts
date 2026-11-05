import { spawn, execFile } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'
import { ensureDisposableLearner, stopChild, supportsProcessGroups, waitForPortsClosed } from '../scripts/e2e-stack-runtime.mjs'

test.each([200, 422])('disposable learner signup (%i) reuses only an authenticated existing account', async (signupStatus) => {
  const requests: string[] = []
  const origin = 'http://127.0.0.1:3102'
  const server = createServer((request, response) => {
    expect(request.headers.origin).toBe(origin)
    requests.push(request.url!)
    response.setHeader('content-type', 'application/json')
    if (requests.length === 1) {
      response.statusCode = 401
      response.end(JSON.stringify({ code: 'INVALID_EMAIL_OR_PASSWORD' }))
    } else if (request.url === '/api/auth/sign-in/email') {
      response.end(JSON.stringify({ user: { id: 'stable-subject' } }))
    } else {
      response.statusCode = signupStatus
      response.end(JSON.stringify(signupStatus === 200 ? { user: { id: 'synthetic-signup-subject' } } : { code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' }))
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as { port: number }
  const url = `http://127.0.0.1:${address.port}`
  const learner = { email: 'learner@e2e.budds.invalid', password: 'test-password', name: 'Learner' }
  try {
    expect(await ensureDisposableLearner(url, origin, learner)).toBe('stable-subject')
    expect(await ensureDisposableLearner(url, origin, learner)).toBe('stable-subject')
    expect(requests).toEqual(['/api/auth/sign-in/email', '/api/auth/sign-up/email', '/api/auth/sign-in/email', '/api/auth/sign-in/email'])
    server.removeAllListeners('request')
    server.on('request', (request, response) => {
      requests.push(request.url!)
      response.writeHead(403, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ code: 'INVALID_ORIGIN', message: 'private-response-secret' }))
    })
    await expect(ensureDisposableLearner(url, origin, learner)).rejects.toThrow('HTTP 403 (INVALID_ORIGIN)')
    expect(requests).toHaveLength(5)
    server.removeAllListeners('request')
    server.on('request', (request, response) => {
      response.writeHead(request.url === '/api/auth/sign-up/email' ? 200 : 401, { 'content-type': 'application/json' })
      response.end(JSON.stringify(request.url === '/api/auth/sign-up/email' ? { user: { id: 'synthetic-signup-subject' } } : { code: 'INVALID_EMAIL_OR_PASSWORD' }))
    })
    await expect(ensureDisposableLearner(url, origin, learner)).rejects.toThrow('HTTP 401 (INVALID_EMAIL_OR_PASSWORD)')
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test.skipIf(!supportsProcessGroups)('shutdown stops the wrapper and its backend before the port is reused', async () => {
  const backend = `const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));process.on('SIGINT',()=>setTimeout(()=>s.close(()=>process.exit(0)),250));`
  const wrapper = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(backend)}],{stdio:'inherit'});process.on('SIGINT',()=>process.exit(0));`
  const child = spawn(process.execPath, ['-e', wrapper], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    const [data] = await once(child.stdout!, 'data')
    const port = Number(data.toString().trim())
    expect(port).toBeGreaterThan(0)
    await stopChild(child)
    await waitForPortsClosed([port])
    await stopChild(child)
  } finally { await stopChild(child) }
}, 60_000)

test.skipIf(!supportsProcessGroups)('stack startup reports captured subprocess diagnostics without credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'budds-e2e-startup-error-'))
  const secret = 'test-only-private-token-that-must-be-redacted'
  try {
    await writeFile(join(directory, 'pnpm'), '#!/usr/bin/env node\nconsole.error("CONVEX_DOWNLOAD_FAILED " + process.env.BUDDS_E2E_AUTH_TOKEN); process.exit(1)\n', { mode: 0o755 })
    const error = await promisify(execFile)(process.execPath, [resolve('scripts/e2e-stack.mjs')], {
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, BUDDS_E2E_AUTH_TOKEN: secret },
    }).then(() => { throw new Error('Expected startup to fail') }, error => error)
    expect(error.stderr).toContain('initializing disposable Convex failed (exit 1)')
    expect(error.stderr).toContain('CONVEX_DOWNLOAD_FAILED [REDACTED]')
    expect(error.stderr).not.toContain(secret)
    expect(error.stdout).not.toContain(secret)
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 60_000)
