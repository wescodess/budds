import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, rmdir, unlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const alive = pid => {
  try { process.kill(pid, 0); return true }
  catch (error) { if (error.code === 'ESRCH') return false; if (error.code === 'EPERM') return true; throw error }
}
const inspectionError = lock => new Error(`Cannot verify disposable stack identity: ${lock}. No unverified group was signalled. After manually confirming all capture processes have stopped, remove this lock directory and retry.`)

function processIdentity(pid, lock) {
  let output
  try { output = execFileSync('ps', ['-ww', '-o', 'lstart=,pgid=,command=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 2000, maxBuffer: 4 * 1024 * 1024 }) }
  catch { if (!alive(pid)) return null; throw inspectionError(lock) }
  const match = output.trim().match(/^(\w{3}\s+\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\d+)\s+(.+)$/u)
  if (!match) throw inspectionError(lock)
  return { pid, startedAt: match[1], pgid: Number(match[2]), command: match[3] }
}

function processTable(lock) {
  try {
    return execFileSync('ps', ['-A', '-o', 'pid=,ppid=,pgid='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 2000, maxBuffer: 4 * 1024 * 1024 }).trim().split('\n').map(line => {
      const row = line.trim().split(/\s+/u).map(Number)
      if (row.length !== 3 || !row.every(Number.isSafeInteger)) throw inspectionError(lock)
      return { pid: row[0], ppid: row[1], pgid: row[2] }
    })
  } catch { throw inspectionError(lock) }
}

function groupState(group, lock) {
  if (!Number.isSafeInteger(group.pid) || group.pid <= 0) throw inspectionError(lock)
  if (!alive(-group.pid)) return false
  if (!group.identities?.length) throw inspectionError(lock)
  let reused = false
  for (const recorded of group.identities) {
    if (!Number.isSafeInteger(recorded.pid) || recorded.pid <= 0 || recorded.pgid !== group.pid
      || typeof recorded.startedAt !== 'string' || !recorded.startedAt || typeof recorded.command !== 'string' || !recorded.command) throw inspectionError(lock)
    const current = processIdentity(recorded.pid, lock)
    if (!current) continue
    if (current.startedAt === recorded.startedAt && current.command === recorded.command && current.pgid === group.pid) return true
    reused ||= recorded.pid === group.pid
  }
  // A different leader proves PID reuse. An absent leader with unknown surviving
  // members cannot establish ownership, so keep the lock for manual recovery.
  if (reused) return false
  return null
}

function snapshotGroups(stack, groups, lock) {
  if (!groupState(stack, lock)) return groups
  const rows = processTable(lock)
  const descendants = new Set([stack.pid])
  let size
  do {
    size = descendants.size
    for (const row of rows) if (descendants.has(row.ppid)) descendants.add(row.pid)
  } while (size !== descendants.size)
  const owned = new Set(groups.filter(group => groupState(group, lock)).map(group => group.pid))
  for (const row of rows) if (descendants.has(row.pid) && descendants.has(row.pgid)) owned.add(row.pgid)
  const result = new Map(groups.map(group => [group.pid, group]))
  for (const pid of owned) {
    const identities = rows.filter(row => row.pgid === pid).map(row => processIdentity(row.pid, lock)).filter(Boolean).filter(identity => identity.pgid === pid)
    if (identities.length) result.set(pid, { pid, identities })
  }
  return [...result.values()]
}

async function signalStackGroup(group, signal, lock) {
  const deadline = Date.now() + 2000
  let state = groupState(group, lock)
  while (state === null && Date.now() < deadline) { await delay(25); state = groupState(group, lock) }
  if (state === null) throw inspectionError(lock)
  if (!state) return
  try { process.kill(-group.pid, signal) }
  catch (error) {
    if (error.code === 'ESRCH') return
    if (error.code !== 'EPERM') throw error
    const deadline = Date.now() + 2000
    while (alive(-group.pid) && Date.now() < deadline) await delay(25)
    if (alive(-group.pid)) throw error
  }
}

async function finishGroups(groups, lock, timeoutMs = 30_000, refresh = () => {}) {
  const wait = async ms => {
    const deadline = Date.now() + ms
    while (true) {
      refresh()
      if (groups.every(group => groupState(group, lock) === false)) {
        // Re-read after the producers exit, including registrations made mid-probe.
        const count = groups.length
        refresh()
        if (groups.length === count) return true
        continue
      }
      if (Date.now() >= deadline) return false
      await delay(25)
    }
  }
  if (await wait(timeoutMs)) return
  refresh()
  for (const group of groups) await signalStackGroup(group, 'SIGTERM', lock)
  if (await wait(timeoutMs)) return
  for (const group of groups) await signalStackGroup(group, 'SIGKILL', lock)
  if (!await wait(2000)) throw new Error(`Owned E2E process groups have not stopped; lock retained: ${lock}`)
}

// Convex's backend port probes and shared dashboard cache are not isolated per run.
export async function acquireCaptureStackLock(lock = join(tmpdir(), `budds-design-capture-stack-${process.getuid?.() ?? 'user'}.lock`)) {
  const owner = { pid: process.pid, token: randomUUID(), startedAt: new Date().toISOString(), stackGroups: [], groupsTokens: [] }
  const ownerFile = `owner-${owner.pid}-${owner.token}.json`
  const candidate = await mkdtemp(`${lock}.candidate-`)
  const save = () => writeFileSync(join(lock, ownerFile), JSON.stringify(owner))
  const groupsPath = token => {
    if (typeof token !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(token)) throw inspectionError(lock)
    return `${lock}.groups-${token}.jsonl`
  }
  function* registeredPids(tokens) {
    for (const token of tokens) {
      let contents
      try { contents = readFileSync(groupsPath(token), 'utf8') }
      catch (error) { if (error.code === 'ENOENT') continue; throw inspectionError(lock) }
      for (const line of contents.split('\n').filter(Boolean)) {
        let pid
        try { ({ pid } = JSON.parse(line)) } catch { throw inspectionError(lock) }
        if (!Number.isSafeInteger(pid) || pid <= 0) throw inspectionError(lock)
        yield pid
      }
    }
  }
  const refreshGroups = () => {
    for (const pid of registeredPids(owner.groupsTokens)) {
      if (owner.stackGroups.some(group => group.pid === pid)) continue
      const group = { pid, identities: [] }
      owner.stackGroups.push(group)
      save()
      const identity = processIdentity(pid, lock)
      if (identity) {
        if (identity.pgid !== pid || !identity.command.includes('e2e-process-owner.mjs')) throw inspectionError(lock)
        group.identities.push(identity)
        save()
      }
    }
  }
  const removeGroupsFiles = async () => {
    for (const token of owner.groupsTokens) await unlink(groupsPath(token)).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
  try {
    await writeFile(join(candidate, ownerFile), JSON.stringify(owner))
    while (true) {
      // Installing a populated directory is atomic; only one stale contender wins.
      try { renameSync(candidate, lock); break }
      catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error }
      let files
      try { files = await readdir(lock) }
      catch (error) { if (error.code === 'ENOENT') continue; throw error }
      if (!files.length) continue
      if (files.length !== 1 || !/^owner-\d+-[a-f0-9-]+\.json$/u.test(files[0])) throw new Error(`Unrecognized disposable stack lock: ${lock}`)
      const previousPid = Number(files[0].split('-')[1])
      if (!Number.isSafeInteger(previousPid) || previousPid <= 0) throw new Error(`Invalid disposable stack lock owner: ${lock}`)
      if (alive(previousPid)) throw new Error(`Another route capture owns the disposable stack lock: ${lock} (PID ${previousPid}). Run route captures one at a time.`)
      let previous
      try { previous = JSON.parse(await readFile(join(lock, files[0]), 'utf8')) }
      catch (error) { if (error.code === 'ENOENT') continue; throw error }
      const pending = new Set()
      const recorded = previous.stackGroups || []
      const tokens = previous.groupsTokens || []
      const manualRecovery = () => new Error(`Stale disposable stack lock may have live processes: ${[...pending].map(pid => `PID/PGID ${pid}`).join(', ') || 'unknown PID/PGID'}. Inspect each group with ps -o pid,pgid,lstart,command -g <pgid>, stop the processes, then remove the lock directory at ${lock} and retry.`)
      try {
        if (!Array.isArray(recorded) || !Array.isArray(tokens)) throw manualRecovery()
        const groups = [...recorded]
        if (previous.stackPid !== undefined && !groups.some(group => group.pid === previous.stackPid)) groups.push({ pid: previous.stackPid, identities: [] })
        for (const group of groups) {
          try { if (groupState(group, lock) !== false) pending.add(group.pid) }
          catch { pending.add(group.pid) }
        }
        for (const pid of registeredPids(tokens)) {
          try { if (alive(pid) || alive(-pid)) pending.add(pid) }
          catch { pending.add(pid) }
        }
      } catch { throw manualRecovery() }
      if (pending.size) throw manualRecovery()
      try { renameSync(join(lock, files[0]), join(lock, ownerFile)) }
      catch (error) { if (error.code === 'ENOENT') continue; throw error }
      owner.groupsTokens = tokens
      await removeGroupsFiles()
      owner.groupsTokens = []
      save()
      break
    }
  }
  finally { await rm(candidate, { recursive: true, force: true }) }
  owner.groupsTokens = [owner.token]
  const groupsFile = groupsPath(owner.token)
  writeFileSync(groupsFile, '', { flag: 'wx', mode: 0o600 })
  save()
  let releasing
  const release = timeoutMs => releasing ||= (async () => {
    await finishGroups(owner.stackGroups, lock, timeoutMs, refreshGroups)
    await removeGroupsFiles()
    await unlink(join(lock, ownerFile))
    await rmdir(lock).catch(error => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error })
  })()
  release.recordStack = pid => {
    const identity = processIdentity(pid, lock)
    if (!identity || identity.pgid !== pid || !identity.command.includes('e2e-stack.mjs')) throw inspectionError(lock)
    owner.stackPid = pid
    owner.stackGroups = [{ pid, identities: [identity] }]
    save()
    // One initial snapshot preserves identities of children already in the stack group.
    owner.stackGroups = snapshotGroups(owner.stackGroups[0], owner.stackGroups, lock)
    save()
    refreshGroups()
  }
  release.groupsFile = groupsFile
  release.readGroups = refreshGroups
  release.stackGroup = () => owner.stackGroups.find(group => group.pid === owner.stackPid)
  return release
}

export async function stopCaptureStack(child, release, timeoutMs) {
  release?.readGroups()
  try { await stopChild(child, timeoutMs, release?.stackGroup()) }
  finally { await release?.(timeoutMs) }
}

// Explicit ports are caller-coordinated; default runs ask the OS for a free port.
export async function selectCaptureBaseUrl(explicitUrl) {
  const baseUrl = new URL(explicitUrl || 'http://127.0.0.1')
  if (baseUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(baseUrl.hostname)
    || baseUrl.username || baseUrl.password || baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) throw new Error('Design capture requires an HTTP loopback E2E base URL')
  const probe = createServer()
  await new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(explicitUrl ? Number(baseUrl.port || 80) : 0, baseUrl.hostname, resolve)
  })
  const port = probe.address().port
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()))
  baseUrl.port = String(port)
  return baseUrl
}

const name = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/u)
const selector = z.string().trim().min(1)
const viewport = z.object({ width: z.number().int().min(1).max(7680), height: z.number().int().min(1).max(7680) }).strict()
const localPath = z.string().refine(value => value.startsWith('/') && !value.startsWith('//')
  && !value.includes('\\') && new URL(value, 'http://127.0.0.1').origin === 'http://127.0.0.1', 'Expected a local route path')
const common = {
  version: z.literal(1),
  notes: z.string().trim().min(1),
  themes: z.array(z.enum(['dark', 'light'])).min(1),
  viewports: z.array(viewport).min(1),
  contentSelector: selector,
  readySelector: selector,
  requiredFonts: z.array(z.string().trim().min(1)).default([]),
  surfaceSeparation: z.array(z.object({
    selectors: z.tuple([selector, selector]),
    minContrast: z.number().min(1).max(21),
  }).strict()).default([]),
}
const surfaceSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('routes'), cases: z.array(z.object({ kind: name, state: name, path: localPath }).strict()).min(1) }).strict(),
  z.object({ ...common, kind: z.literal('html'), file: z.string().min(1), cases: z.array(z.object({ kind: name, state: name }).strict()).min(1) }).strict(),
])

export function validateSurface(value) {
  const surface = surfaceSchema.parse(value)
  for (const [label, values] of [
    ['themes', surface.themes],
    ['viewports', surface.viewports.map(value => `${value.width}x${value.height}`)],
    ['cases', surface.cases.map(value => `${value.kind}/${value.state}`)],
    ['surfaceSeparation', surface.surfaceSeparation.map(value => JSON.stringify(value.selectors))],
  ]) {
    if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} in surface`)
  }
  return surface
}

export function captureIdentity(surface, entry, theme, viewport) {
  return { surface, kind: entry.kind, state: entry.state, theme, viewport: { width: viewport.width, height: viewport.height } }
}

export function violationId(rule, capture, selector) {
  const identity = captureIdentity(capture.surface, capture, capture.theme, capture.viewport)
  return `${rule}:${createHash('sha256').update(JSON.stringify([rule, identity, normalizeSelector(selector)])).digest('hex').slice(0, 24)}`
}

// Vue useId and Reka append allocation counters. Preserve raw selectors in reports.
export function normalizeSelector(selector) {
  if (Array.isArray(selector)) return selector.map(normalizeSelector)
  return selector.replace(/#(?:reka-(?:v-)?|v-)\d+(?:-\d+)*(?=$|[^\w-]|-[a-z])/gu, '#generated-id')
}

const captureSchema = z.object({ surface: name, kind: name, state: name, theme: z.enum(['dark', 'light']), viewport }).strict()
const floorSchema = z.object({
  version: z.literal(1),
  surface: name,
  status: z.literal('complete'),
  errors: z.array(z.unknown()).length(0),
  captures: z.array(captureSchema).min(1),
  violations: z.array(z.object({ id: z.string().min(1) }).passthrough()),
}).passthrough()

export function compareFloor(current, baseline) {
  floorSchema.parse(baseline)
  if (current.surface !== baseline.surface) throw new Error('Comparison requires the same surface')
  const key = value => JSON.stringify(captureIdentity(value.surface, value, value.theme, value.viewport))
  const present = new Set(current.captures.map(key))
  const missing = baseline.captures.filter(value => !present.has(key(value)))
  if (missing.length) throw new Error(`Missing baseline captures: ${missing.map(value => `${value.kind}/${value.state} ${value.theme} ${value.viewport.width}x${value.viewport.height}`).join(', ')}`)
  const known = new Set(baseline.violations.map(value => value.id))
  return current.violations.filter(value => !known.has(value.id))
}

async function safeCapturePath(root, surface, output) {
  name.parse(surface)
  const parent = join(await realpath(root), '.design-captures', surface)
  const logicalChild = relative(resolve(root, '.design-captures', surface), resolve(output))
  const child = logicalChild.startsWith('../') ? relative(parent, resolve(output)) : logicalChild
  if (!child || child === '..' || child.startsWith('../') || isAbsolute(child)) throw new Error('Capture output must be inside .design-captures/<surface>/')
  if (child.includes('/')) throw new Error('Capture output must be an immediate child of its surface')
  const target = join(parent, child)
  await mkdir(parent, { recursive: true })
  if (await realpath(parent) !== parent) throw new Error('Capture output parent must not traverse symlinks')
  if ((await lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error }))?.isSymbolicLink()) throw new Error('Capture output must not traverse symlinks')
  const actual = await realpath(target).catch(error => {
    if (error.code !== 'ENOENT') throw error
    return target
  })
  if (actual !== target || relative(parent, actual).startsWith('..')) throw new Error('Capture output must not traverse symlinks')
  return target
}

export async function resetCaptureOutput(root, surface, output) {
  const target = await safeCapturePath(root, surface, output)
  if (!/^[a-f0-9]{7}$/u.test(relative(resolve(root, '.design-captures', surface), resolve(output)))) throw new Error('Published capture requires a short SHA')
  return mkdtemp(`${target}.staging-`)
}

export async function readComparisonFloor(directory) {
  const actual = await realpath(directory)
  if ([resolve(directory), actual].some(path => path.split('/').some(part => /\.(?:staging-|previous-|publish-lock)/u.test(part)))) throw new Error('Comparison requires a published capture or a copy, not a staging folder')
  return JSON.parse(await readFile(join(actual, 'floor.json'), 'utf8'))
}

export async function publishCaptureOutput(root, surface, staging, output, isInterrupted = () => false) {
  const target = await safeCapturePath(root, surface, output)
  const source = await safeCapturePath(root, surface, staging)
  const child = relative(resolve(root, '.design-captures', surface), resolve(output))
  if (!/^[a-f0-9]{7}$/u.test(child) || !source.startsWith(`${target}.staging-`)) throw new Error('Publication requires a short SHA and its staging folder')
  const lock = await safeCapturePath(root, surface, `${output}.publish-lock`)
  const deadline = Date.now() + 5000
  // Only the short rename transaction is serialized; captures remain independent.
  const assertActive = () => { if (isInterrupted()) throw new Error('Capture interrupted before publication') }
  while (true) {
    assertActive()
    try { await mkdir(lock); break }
    catch (error) {
      if (error.code !== 'EEXIST' || Date.now() >= deadline) throw error
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }
  let previous
  try {
    await safeCapturePath(root, surface, output)
    assertActive()
    previous = `${target}.previous-${randomUUID()}`
    // Do not yield between renames: keep the publication gap as short as possible.
    try { renameSync(target, previous) }
    catch (error) { if (error.code !== 'ENOENT') throw error; previous = null }
    try { renameSync(source, target) }
    catch (error) {
      if (previous) renameSync(previous, target)
      throw error
    }
  }
  finally { await rm(lock, { recursive: true, force: true }).catch(error => console.error(`Publication lock can be deleted: ${lock}: ${error.message}`)) }
  if (previous) await rm(previous, { recursive: true, force: true }).catch(error => console.error(`Old capture can be deleted: ${previous}: ${error.message}`))
}

const stopping = new WeakMap()
export function stopChild(child, timeoutMs = 30_000, recordedGroup) {
  if (!child?.pid) return Promise.resolve()
  if (stopping.has(child)) return stopping.get(child)
  const stopped = (async () => {
    const lock = 'unlocked capture child'
    if (!recordedGroup && (child.exitCode !== null || child.signalCode !== null)) {
      if (alive(-child.pid)) throw inspectionError(lock)
      return
    }
    const identity = recordedGroup ? null : processIdentity(child.pid, lock)
    const group = recordedGroup || (identity?.pgid === child.pid ? snapshotGroups({ pid: child.pid, identities: [identity] }, [], lock).find(group => group.pid === child.pid) : null)
    if (!group) { if (alive(-child.pid)) throw inspectionError(lock); return }
    const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit')
    await signalStackGroup(group, 'SIGTERM', lock)
    let timer
    try {
      await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('E2E stack cleanup timed out')), timeoutMs) })])
    }
    finally {
      clearTimeout(timer)
      // The stack can exit while a startup subprocess or grandchild is still alive.
      await signalStackGroup(group, 'SIGKILL', lock)
      await exited
    }
  })()
  stopping.set(child, stopped)
  return stopped
}
