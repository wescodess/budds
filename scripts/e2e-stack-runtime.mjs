import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { connect } from 'node:net'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'

export const supportsProcessGroups = process.platform !== 'win32'
const children = new WeakMap()

function trackChild(child, ownedGroup) {
  const state = { ownedGroup, closed: false, stopping: null, done: null }
  state.done = new Promise(resolve => {
    const finish = () => { state.closed = true; resolve() }
    const observe = () => {
      const exited = child.exitCode !== null || child.signalCode !== null || !child.pid
      const pipesClosed = [child.stdout, child.stderr].every(stream => !stream || stream.closed || stream.destroyed)
      // Explicit IPC disconnect can omit the aggregate close event on Node.
      // Exit plus closed owned pipes and IPC is the same completion boundary.
      if (exited && pipesClosed && !child.connected) finish()
    }
    child.once('close', finish)
    for (const event of ['exit', 'disconnect', 'error']) child.once(event, observe)
    for (const stream of [child.stdout, child.stderr]) stream?.once('close', observe)
    observe()
  })
  children.set(child, state)
  return state
}

export function spawnOwnedChild(command, args, options = {}) {
  const child = Object.assign(supportsProcessGroups
    ? spawn(process.execPath, [fileURLToPath(new URL('./e2e-process-owner.mjs', import.meta.url)), command, ...args], { ...options, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    : spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] }), { commandExited: false })
  const groupsFile = (options.env || process.env).BUDDS_E2E_OWNED_GROUPS_FILE
  if (supportsProcessGroups && child.pid && groupsFile) appendFileSync(groupsFile, `${JSON.stringify({ pid: child.pid })}\n`)
  trackChild(child, supportsProcessGroups)
  const exited = (code, signal) => {
    child.commandExited = true
    child.emit('commandExit', code, signal)
  }
  // Keep an error listener from spawn through teardown, including failed spawn.
  child.on('error', () => {})
  if (supportsProcessGroups) child.on('message', message => {
    if (message.type === 'commandExit') exited(message.code, message.signal)
    if (message.type === 'commandError') child.emit('error', new Error(message.message))
  })
  else child.once('exit', exited)
  return child
}

export async function stopChild(child) {
  if (!child) return
  let state = children.get(child)
  if (!state) {
    // Unregistered children get the direct-child fallback, never a group signal.
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
    state = trackChild(child, false)
  }
  if (state.stopping) return state.stopping
  if (state.closed) return
  state.stopping = (async () => {
    let force
    let deadline
    const waiting = new Promise((resolve, reject) => {
      state.done.then(resolve)
      deadline = setTimeout(() => reject(new Error('Disposable process did not close after shutdown')), 60_000)
      if (state.ownedGroup) {
        // The owner handles disconnect too; no numeric PID is signalled here.
        if (child.connected) child.send('stop', () => {})
      } else if (child.exitCode === null && child.signalCode === null) {
        const signal = name => {
          try { child.kill(name) } catch (error) { if (error.code !== 'ESRCH') reject(error) }
        }
        signal('SIGINT')
        force = setTimeout(() => signal('SIGKILL'), 30_000)
      }
    })
    try { await waiting } finally { clearTimeout(force); clearTimeout(deadline) }
  })()
  return state.stopping
}

export async function waitForPortsClosed(ports) {
  const listening = port => new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port })
    const finish = value => { socket.destroy(); resolve(value) }
    socket.once('connect', () => finish(true))
    socket.once('error', error => finish(error.code !== 'ECONNREFUSED'))
    socket.setTimeout(1000, () => finish(true))
  })
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if ((await Promise.all(ports.map(listening))).every(value => !value)) return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Disposable Convex did not release ports ${ports.join(', ')} after shutdown`)
}

export function redactStartupOutput(value, secrets) {
  const output = createStartupOutput(secrets)
  output.write('stdout', String(value))
  output.finish()
  return output.diagnostics
}

// A scanner commits characters only once they cannot start a credential. Token
// bodies are discarded as they arrive, even without newlines or a size limit.
function credentialScanner(secrets, settle, tokens = true) {
  let pending = []
  let mode = ''
  // Advance through a match one character at a time, so a credential that starts
  // inside it can extend the masked span.
  let covered = 0
  const consume = (count, masked) => settle(pending.splice(0, count), masked)
  const push = entry => {
    pending.push(entry)
    while (pending.length) {
      const first = pending[0].char
      if (mode) {
        if (mode === 'gap' && /\s/u.test(first)) { consume(1, true); continue }
        if (mode === 'gap') mode = 'bearer'
        if (mode === 'bearer' ? !/\s/u.test(first) : /[\w.-]/u.test(first)) { consume(1, true); continue }
        mode = ''
      }
      const text = pending.map(item => item.char).join('')
      if (secrets.some(secret => secret.length > text.length && secret.startsWith(text))) return
      const matched = secrets.find(secret => text.startsWith(secret))
      if (matched) covered = Math.max(covered, [...matched].length)
      if (tokens) {
        if (text.startsWith('eyJ')) { consume(3, true); mode = 'jwt'; continue }
        if (/^bearer\s/iu.test(text)) { consume(6, true); mode = 'gap'; continue }
        if ('eyJ'.startsWith(text) || 'bearer'.startsWith(text.toLowerCase())) return
      }
      consume(1, covered > 0)
      covered = Math.max(0, covered - 1)
    }
  }
  return {
    push,
    protectPending: () => settle(pending, true),
    end: () => { settle(pending, true); pending = [] },
  }
}

/** @param {Iterable<string>} secrets @param {(stream: string, text: string) => void} [emit] */
export function createStartupOutput(secrets, emit = () => {}) {
  const known = [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)
  // Oversized environment credentials fail closed without retaining them in
  // multiple scanning buffers. Readiness still uses only a fixed marker.
  const suppressAll = known.some(secret => secret.length > 4096)
  const queue = []
  let diagnostics = ''
  let masked = false
  let ready = false
  let combinedTail = ''
  const marker = 'Convex functions ready!'
  const layers = ['localSecret', 'localToken', 'combinedSecret', 'combinedToken']
  const send = (stream, text) => { diagnostics = (diagnostics + text).slice(-8000); emit(stream, text) }
  const drain = () => {
    let stream
    let batch = ''
    while (queue.length && (queue[0].masked || layers.every(layer => queue[0][layer]))) {
      const entry = queue.shift()
      const text = entry.masked ? (masked ? '' : '[REDACTED]') : entry.char
      masked = entry.masked
      if (text) {
        if (stream && stream !== entry.stream) { send(stream, batch); batch = '' }
        stream = entry.stream
        batch += text
      }
    }
    if (batch) send(stream, batch)
  }
  const settle = layer => (entries, mask) => {
    for (const entry of entries) { entry[layer] = true; entry.masked ||= mask }
  }
  const scanners = prefix => [
    credentialScanner(suppressAll ? [] : known, settle(`${prefix}Secret`), false),
    credentialScanner([], settle(`${prefix}Token`)),
  ]
  const combined = scanners('combined')
  const streams = Object.fromEntries(['stdout', 'stderr'].map(name => [name, {
    decoder: new StringDecoder('utf8'), scanners: scanners('local'), tail: '', ended: false,
  }]))
  const protectPending = () => {
    for (const scanner of [...combined, ...Object.values(streams).flatMap(stream => stream.scanners)]) scanner.protectPending()
    drain()
  }
  const append = (name, text) => {
    const stream = streams[name]
    ready ||= (stream.tail + text).includes(marker) || (combinedTail + text).includes(marker)
    stream.tail = (stream.tail + text).slice(-(marker.length - 1))
    combinedTail = (combinedTail + text).slice(-(marker.length - 1))
    for (const char of text) {
      const entry = { char, stream: name, masked: suppressAll }
      queue.push(entry)
      if (!suppressAll) for (const scanner of [...stream.scanners, ...combined]) scanner.push(entry)
      if (queue.length >= 256) drain()
      // An idle stream's ambiguous prefix must not retain another stream's
      // endless output. Mask it now while its scanner keeps matching safely.
      if (queue.length >= 8192) protectPending()
    }
    drain()
  }
  const end = (name) => {
    const stream = streams[name]
    if (stream.ended) return
    // A decoder's final replacement character must not release a credential
    // prefix that ended inside an incomplete UTF-8 sequence.
    protectPending()
    append(name, stream.decoder.end())
    stream.ended = true
    for (const scanner of stream.scanners) scanner.end()
    if (Object.values(streams).every(item => item.ended)) for (const scanner of combined) scanner.end()
    protectPending()
  }
  return {
    write(name, chunk) { if (!streams[name].ended) append(name, typeof chunk === 'string' ? chunk : streams[name].decoder.write(chunk)) },
    end,
    finish() { end('stdout'); end('stderr') },
    protectPending,
    get ready() { return ready },
    get diagnostics() { return diagnostics },
    get bufferedCharacters() { return queue.length },
  }
}

/** @param {Iterable<string>} secrets @param {(stream: string, text: string) => void} [emit] */
export function forwardChildOutput(child, secrets, emit = undefined) {
  const output = createStartupOutput(secrets, emit)
  for (const name of ['stdout', 'stderr']) {
    child[name].on('data', chunk => output.write(name, chunk))
    for (const event of ['end', 'close']) child[name].once(event, () => output.end(name))
  }
  child.once('close', () => output.finish())
  return output
}

/** @param {Iterable<string>} secrets @param {(stream: string, text: string) => void} [emit] */
export function waitForConvexReady(child, secrets, emit = undefined) {
  const output = forwardChildOutput(child, secrets, emit)
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => fail('Timed out waiting for disposable Convex functions'), 120_000)
    const fail = (message) => {
      output.protectPending()
      clearTimeout(deadline)
      reject(new Error(`${message}:\n${output.diagnostics}`))
    }
    for (const name of ['stdout', 'stderr']) {
      child[name].on('data', () => {
        if (output.ready) { clearTimeout(deadline); resolve() }
      })
    }
    child.once('error', error => fail(`Local Convex failed to start: ${redactStartupOutput(error.message, secrets)}`))
    child.once('commandExit', code => fail(`Local Convex exited before functions were ready (exit ${code ?? 'signal'})`))
    child.once('exit', code => fail(`Local Convex owner exited before functions were ready (exit ${code ?? 'signal'})`))
    child.once('close', code => fail(`Local Convex exited before functions were ready (exit ${code ?? 'signal'})`))
  })
}

/**
 * @param {{server?: import('node:child_process').ChildProcess, backend?: import('node:child_process').ChildProcess, ports?: number[], builder?: {close: () => Promise<unknown>}, removeWorktree?: () => Promise<unknown>, removeWorkspace?: () => Promise<unknown>}} resources
 */
export async function cleanupStack({ server, backend, ports = [], builder, removeWorktree, removeWorkspace }) {
  const errors = []
  const attempt = async (label, action) => {
    try { await action() } catch (error) { errors.push({ label, error }) }
  }
  await Promise.all([attempt('stopping built server', () => stopChild(server)), attempt('stopping disposable Convex', () => stopChild(backend))])
  if (ports.length) await attempt('waiting for disposable ports', () => waitForPortsClosed(ports))
  if (builder) await attempt('closing Nuxt builder', () => builder.close())
  if (removeWorktree) await attempt('removing disposable worktree', removeWorktree)
  if (removeWorkspace) await attempt('removing disposable workspace', removeWorkspace)
  return errors
}

export async function ensureDisposableLearner(siteUrl, appUrl, learner) {
  const request = async action => {
    const response = await fetch(`${siteUrl}/api/auth/${action}/email`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: appUrl }, body: JSON.stringify(learner),
    })
    const account = await response.json().catch(() => ({}))
    return { response, account }
  }
  let { response, account } = await request('sign-in')
  if (!response.ok && account.code === 'INVALID_EMAIL_OR_PASSWORD') {
    const signup = await request('sign-up')
    if (signup.response.ok || ['USER_ALREADY_EXISTS', 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'].includes(signup.account.code)) {
      ;({ response, account } = await request('sign-in'))
    } else {
      ;({ response, account } = signup)
    }
  }
  if (!response.ok) {
    const code = typeof account.code === 'string' && /^[A-Z_]{1,80}$/.test(account.code) ? ` (${account.code})` : ''
    throw new Error(`Disposable learner authentication failed: HTTP ${response.status}${code}`)
  }
  if (typeof account.user?.id !== 'string' || !account.user.id || account.user.id.includes('|')) throw new Error('Disposable learner has no valid auth subject')
  return account.user.id
}
