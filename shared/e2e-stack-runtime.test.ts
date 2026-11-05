import { spawn, execFile } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { PassThrough } from 'node:stream'
import { expect, test, vi } from 'vitest'
import { cleanupStack, createStartupOutput, ensureDisposableLearner, forwardChildOutput, redactStartupOutput, spawnOwnedChild, stopChild, supportsProcessGroups, waitForConvexReady, waitForPortsClosed } from '../scripts/e2e-stack-runtime.mjs'

test('startup redaction does not release a credential split across adjacent chunks', () => {
  const secret = 'synthetic-boundary-credential'
  let emitted = ''
  const output = createStartupOutput(new Set([secret]), (_stream: string, text: string) => { emitted += text })
  output.write('stdout', secret.slice(0, 10))
  expect(emitted).toBe('')
  output.write('stdout', secret.slice(10))
  output.finish()
  expect(emitted).toBe('[REDACTED]')
})

test.skipIf(!supportsProcessGroups).each([true, false])('shutdown releases descendants after launcher exit (inherited pipes: %s)', async (inherit) => {
  const backend = `const fs=require('node:fs');const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>fs.writeFileSync(process.argv[1],String(s.address().port)));process.on('SIGINT',()=>setTimeout(()=>s.close(()=>{fs.writeFileSync(process.argv[1]+'.closed','graceful');process.exit(0)}),100));`
  const directory = await mkdtemp(join(tmpdir(), 'budds-owned-process-'))
  const portFile = join(directory, 'port')
  const wrapper = `const fs=require('node:fs');require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(backend)},${JSON.stringify(portFile)}],{stdio:${inherit ? "'inherit'" : "'ignore'"}});const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(portFile)})){clearInterval(t);console.log(fs.readFileSync(${JSON.stringify(portFile)},'utf8'));process.exit(0)}},10);`
  const child = spawnOwnedChild(process.execPath, ['-e', wrapper])
  const exited = once(child, 'commandExit')
  try {
    const [data] = await once(child.stdout!, 'data')
    const port = Number(data.toString().trim())
    expect(port).toBeGreaterThan(0)
    await exited
    expect(child.commandExited).toBe(true)
    const stopping = stopChild(child)
    await Promise.all([stopping, stopChild(child)])
    await waitForPortsClosed([port])
    expect(await readFile(`${portFile}.closed`, 'utf8')).toBe('graceful')
    const server = createServer()
    server.listen(port, '127.0.0.1')
    await once(server, 'listening')
    await new Promise<void>(resolve => server.close(() => resolve()))
    await stopChild(child)
  } finally {
    await stopChild(child)
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)

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
  const child = spawnOwnedChild(process.execPath, ['-e', wrapper])
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

test.each(['synthetic-boundary-credential', 'bEaReR opaque-fixture-token', 'eyJfixture.payload.signature'])('redacts every split of a synthetic credential (%#)', (credential) => {
  for (let split = 1; split <= credential.length; split++) {
    let emitted = ''
    const output = createStartupOutput(new Set(['synthetic-boundary-credential']), (_stream: string, text: string) => { emitted += text })
    output.write('stdout', `SAFE ${credential.slice(0, split)}`)
    output.write('stdout', `${credential.slice(split)} DONE\n`)
    output.finish()
    expect(emitted).toBe('SAFE [REDACTED] DONE\n')
    expect(output.diagnostics).toBe(emitted)
  }
})

test.each(['synthetic-boundary-credential', 'Bearer opaque-fixture-token', 'eyJfixture.payload.signature'])('redacts bytewise, across streams and through interleaving (%#)', (credential) => {
  for (const interleave of [false, true]) {
    const pieces: string[] = []
    const output = createStartupOutput(new Set(['synthetic-boundary-credential']), (_stream: string, text: string) => pieces.push(text))
    for (const char of credential) {
      output.write('stdout', Buffer.from(char))
      if (interleave) output.write('stderr', 'other-stream\n')
    }
    output.finish()
    expect(pieces.join('').includes(credential)).toBe(false)
    expect(pieces.join('').includes('boundary')).toBe(false)
    expect(pieces.join('').includes('opaque')).toBe(false)
    expect(pieces.join('').includes('payload')).toBe(false)
    expect(pieces.join('')).toContain('[REDACTED]')
  }
  for (let split = 1; split < credential.length; split++) {
    let emitted = ''
    const output = createStartupOutput(new Set(['synthetic-boundary-credential']), (_stream: string, text: string) => { emitted += text })
    output.write('stdout', credential.slice(0, split))
    output.write('stderr', credential.slice(split))
    output.finish()
    expect(emitted).toBe('[REDACTED]')
  }
})

test('UTF-8 decoding preserves safe diagnostics and masks a multibyte credential on both streams', () => {
  let emitted = ''
  const secret = 'synthetic-é-credential'
  const output = createStartupOutput(new Set([secret]), (_stream: string, text: string) => { emitted += text })
  for (const stream of ['stdout', 'stderr']) {
    for (const byte of Buffer.from(`✓ ${secret} ✓\n`)) output.write(stream, Buffer.from([byte]))
    output.end(stream)
  }
  output.finish()
  expect(emitted).toBe('✓ [REDACTED] ✓\n✓ [REDACTED] ✓\n')
})

test('an incomplete final UTF-8 sequence cannot release an already buffered credential prefix', () => {
  let emitted = ''
  const secret = 'synthetic-é-credential'
  const output = createStartupOutput(new Set([secret]), (_stream: string, text: string) => { emitted += text })
  output.write('stdout', Buffer.from(secret).subarray(0, Buffer.byteLength('synthetic-') + 1))
  output.finish()
  expect(emitted.includes('synthetic-')).toBe(false)
  expect(emitted).toContain('[REDACTED]')
})

test('long lines, idle prefixes and token bodies keep output and retained diagnostics bounded', () => {
  let emitted = ''
  const output = createStartupOutput(new Set(['synthetic-credential']), (_stream: string, text: string) => { emitted += text })
  output.write('stdout', 'synthetic-')
  for (let index = 0; index < 20; index++) {
    output.write('stderr', 'safe diagnostic '.repeat(1000))
    expect(output.bufferedCharacters).toBeLessThan(8192)
    expect(output.diagnostics.length).toBeLessThanOrEqual(8000)
  }
  output.write('stdout', 'credential\n')
  output.write('stderr', `Bearer ${'x'.repeat(40_000)}\neyJ${'y'.repeat(40_000)}.payload.signature\nEND\n`)
  output.finish()
  expect(emitted.includes('synthetic-')).toBe(false)
  expect(emitted.includes('credential')).toBe(false)
  expect(emitted.includes('xxxxx')).toBe(false)
  expect(emitted.includes('yyyyy')).toBe(false)
  expect(output.diagnostics).toContain('END\n')
  expect(output.bufferedCharacters).toBe(0)
})

test('finalization masks incomplete known/token prefixes and does not duplicate output', () => {
  for (const prefix of ['synthetic-', 'B', 'Bear', 'Bearer ', 'e', 'ey', 'eyJfixture.']) {
    let emitted = ''
    const output = createStartupOutput(new Set(['synthetic-credential']), (_stream: string, text: string) => { emitted += text })
    output.write('stderr', `FAIL ${prefix}`)
    output.finish()
    output.finish()
    output.write('stderr', 'ignored after end')
    expect(emitted).toBe('FAIL [REDACTED]')
  }
  expect(redactStartupOutput('SAFE synthetic-credential synthetic-credential-long DONE', new Set(['synthetic-credential', 'synthetic-credential-long']))).toBe('SAFE [REDACTED] [REDACTED] DONE')
})

test('known multiline credentials are masked even when they overlap an opaque token', () => {
  let emitted = ''
  const secret = 'synthetic fixture\ncredential'
  const output = createStartupOutput(new Set([secret]), (_stream: string, text: string) => { emitted += text })
  for (const char of `Bearer prefix-${secret} DONE\n`) output.write('stdout', char)
  output.finish()
  expect(emitted.includes('fixture')).toBe(false)
  expect(emitted.includes('credential')).toBe(false)
  expect(emitted).toContain('DONE\n')
})

test('oversized credentials fail closed while readiness remains detectable', () => {
  let emitted = ''
  const output = createStartupOutput(new Set(['z'.repeat(5000)]), (_stream: string, text: string) => { emitted += text })
  output.write('stdout', 'z'.repeat(5000))
  output.write('stderr', 'Convex functions ready!')
  output.finish()
  expect(emitted).toBe('[REDACTED]')
  expect(output.ready).toBe(true)
})

function startupFixture() {
  return Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() })
}

const serverLogStreams: Array<'stdout' | 'stderr'> = ['stdout', 'stderr']
test.each(serverLogStreams)('built-server %s logs redact split credentials and flush on close', (stream) => {
  const child = startupFixture()
  const emitted: Record<string, string> = { stdout: '', stderr: '' }
  const output = forwardChildOutput(child, new Set(['synthetic-server-credential']), (name: string, text: string) => { emitted[name] += text })
  child[stream].write('Server listening on loopback\nsynthetic-server-')
  expect(emitted[stream]).toBe('Server listening on loopback\n')
  child[stream].write('credential\nRequest completed\nsynthetic-server-')
  child.emit('close', 0)
  expect(emitted[stream]).toBe('Server listening on loopback\n[REDACTED]\nRequest completed\n[REDACTED]')
  expect(output.bufferedCharacters).toBe(0)
  child[stream].write('ignored after close')
  expect(emitted[stream]).not.toContain('ignored')
})

test('startup readiness spans chunks without waiting for a newline or stream closure', async () => {
  const child = startupFixture()
  let emitted = ''
  const ready = waitForConvexReady(child, new Set(), (_stream: string, text: string) => { emitted += text })
  child.stdout.write('Convex functions re')
  child.stderr.write('Safe backend diagnostic\n')
  child.stdout.write('ady!')
  await ready
  expect(emitted).toContain('ady!')
  child.stdout.end()
  child.stderr.end()
  child.emit('close', 0)
})

test.each(['error', 'commandExit', 'exit', 'close'])('early startup %s flushes safe diagnostics without partial credentials', async (event) => {
  const child = startupFixture()
  let emitted = ''
  const ready = waitForConvexReady(child, new Set(['synthetic-credential']), (_stream: string, text: string) => { emitted += text })
  const rejected = expect(ready).rejects.toThrow(/FAIL \[REDACTED\]/)
  child.stderr.write('FAIL synthetic-')
  child.emit(event, event === 'error' ? new Error('synthetic-credential') : 1)
  await rejected
  child.stdout.end()
  child.stderr.end()
  expect(emitted.includes('synthetic-')).toBe(false)
  expect(emitted).toContain('FAIL [REDACTED]')
})

test('startup keeps its existing 120 second readiness deadline', async () => {
  vi.useFakeTimers()
  try {
    const child = startupFixture()
    const ready = waitForConvexReady(child, new Set())
    const rejected = expect(ready).rejects.toThrow('Timed out waiting')
    await vi.advanceTimersByTimeAsync(120_000)
    await rejected
    child.emit('close', 1)
  } finally { vi.useRealTimers() }
})

test('normal, failed-spawn, missing and already-closed children settle safely', async () => {
  await stopChild(undefined)
  const normal = spawnOwnedChild(process.execPath, ['-e', 'process.exit(0)'])
  await once(normal, 'commandExit')
  await stopChild(normal)
  const signal = vi.spyOn(process, 'kill')
  try {
    await stopChild(normal)
    expect(signal).not.toHaveBeenCalled()
  } finally { signal.mockRestore() }
  const missing = spawnOwnedChild(join(tmpdir(), 'budds-command-does-not-exist'), [])
  await new Promise<void>(resolve => missing.once('error', () => resolve()))
  await stopChild(missing)
  await stopChild(missing)
})

test.skipIf(!supportsProcessGroups)('a disconnected owner still cleans up its process group', async () => {
  const backend = "const s=require('node:net').createServer();process.on('SIGINT',()=>s.close(()=>process.exit(0)));s.listen(0,'127.0.0.1',()=>console.log(s.address().port))"
  const child = spawnOwnedChild(process.execPath, ['-e', backend])
  try {
    const [data] = await once(child.stdout!, 'data')
    const port = Number(data.toString().trim())
    child.disconnect()
    await stopChild(child)
    await waitForPortsClosed([port])
  } finally { await stopChild(child) }
})

test.skipIf(!supportsProcessGroups)('dead parent and broken output pipes cannot cancel the owner force shutdown', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'budds-e2e-orphan-output-'))
  const parent = spawn(process.execPath, [resolve('tests/fixtures/e2e-orphan-output.mjs'), 'parent', directory], { stdio: 'ignore' })
  let port: number | undefined
  try {
    await expect.poll(async () => {
      const backend = await readFile(join(directory, 'backend.json'), 'utf8').then(JSON.parse).catch(() => undefined)
      port = backend?.port
      return port ?? 0
    }).toBeGreaterThan(0)
    if (!port) throw new Error('Disposable backend did not report its listener')
    const closed = once(parent, 'close')
    const started = Date.now()
    parent.kill('SIGKILL')
    await closed
    await expect.poll(() => stat(join(directory, 'write-attempted')).then(() => true).catch(() => false)).toBe(true)
    expect(await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) }).then(response => response.ok)).toBe(true)
    await waitForPortsClosed([port])
    expect(Date.now() - started).toBeGreaterThanOrEqual(29_000)
  } finally {
    if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL')
    if (port) await fetch(`http://127.0.0.1:${port}/stop`, { signal: AbortSignal.timeout(1000) }).catch(() => {})
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)

test('direct-child fallback uses the live child handle and waits for closure', async () => {
  const child = spawn(process.execPath, ['-e', "process.on('SIGINT',()=>process.exit(0));console.log('ready');setInterval(()=>{},1000)"], { stdio: ['ignore', 'pipe', 'pipe'] })
  await once(child.stdout!, 'data')
  await stopChild(child)
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  await stopChild(child)
  const failed = spawn(join(tmpdir(), 'budds-command-does-not-exist'), [])
  await new Promise<void>(resolve => failed.once('error', () => resolve()))
  await stopChild(failed)
})

test('direct-child exit races ignore ESRCH and repeated cleanup cannot signal a reused PID', async () => {
  const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, signalCode: null, kill: vi.fn(() => {
    queueMicrotask(() => child.emit('close'))
    throw Object.assign(new Error('already gone'), { code: 'ESRCH' })
  }) })
  await stopChild(child)
  child.pid = 54321
  await stopChild(child)
  expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGINT')
})

test.each([false, true])('direct-child signal errors reject within graceful/force bounds (force: %s)', async (force) => {
  vi.useFakeTimers()
  const error = Object.assign(new Error('signal refused'), { code: 'EPERM' })
  const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, signalCode: null, kill: vi.fn((signal: string) => {
    if (!force || signal === 'SIGKILL') throw error
    return true
  }) })
  try {
    const stopping = stopChild(child)
    const rejected = expect(stopping).rejects.toBe(error)
    if (force) await vi.advanceTimersByTimeAsync(30_000)
    await rejected
    expect(child.kill.mock.calls.map(([signal]) => signal)).toEqual(force ? ['SIGINT', 'SIGKILL'] : ['SIGINT'])
    child.emit('close')
  } finally { vi.useRealTimers() }
})

test.skipIf(!supportsProcessGroups)('force shutdown bounds a group that ignores graceful signals', async () => {
  const child = spawnOwnedChild(process.execPath, ['-e', "process.on('SIGINT',()=>{});console.log('ready');setInterval(()=>{},1000)"])
  try {
    await once(child.stdout!, 'data')
    const started = Date.now()
    await stopChild(child)
    expect(Date.now() - started).toBeGreaterThanOrEqual(29_000)
    expect(child.signalCode).toBe('SIGKILL')
  } finally { await stopChild(child) }
}, 60_000)

test.each([false, true])('builder close failure still stops owned backend and removes worktree plus enclosing output (worktree removal fails: %s)', async (removeFails) => {
  const workspace = await mkdtemp(join(tmpdir(), 'budds-e2e-cleanup-'))
  const worktree = join(workspace, 'app')
  const output = join(workspace, 'output')
  await mkdir(worktree)
  await mkdir(output)
  const backend = spawnOwnedChild(process.execPath, ['-e', "console.log('ready');setInterval(()=>{},1000)"])
  const removed: string[] = []
  try {
    await once(backend.stdout!, 'data')
    const failure = new Error('builder close failed')
    const errors = await cleanupStack({
      backend,
      builder: { close: async () => { throw failure } },
      removeWorktree: async () => {
        removed.push('worktree')
        if (removeFails) throw new Error('worktree remove failed')
        await rm(worktree, { recursive: true, force: true })
      },
      removeWorkspace: async () => { removed.push('workspace'); await rm(workspace, { recursive: true, force: true }) },
    })
    expect(errors[0]).toEqual({ label: 'closing Nuxt builder', error: failure })
    expect(errors).toHaveLength(removeFails ? 2 : 1)
    expect(removed).toEqual(['worktree', 'workspace'])
    expect(backend.exitCode !== null || backend.signalCode !== null).toBe(true)
    await expect(stat(workspace)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await stopChild(backend)
    await rm(workspace, { recursive: true, force: true })
  }
})
