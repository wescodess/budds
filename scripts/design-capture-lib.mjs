import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { renameSync, writeFileSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, rmdir, unlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod'

// Convex's backend port probes and shared dashboard cache are not isolated per run.
export async function acquireCaptureStackLock(lock = join(tmpdir(), `budds-design-capture-stack-${process.getuid?.() ?? 'user'}.lock`)) {
  const owner = { pid: process.pid, token: randomUUID(), startedAt: new Date().toISOString() }
  const ownerFile = `owner-${owner.pid}-${owner.token}.json`
  const candidate = await mkdtemp(`${lock}.candidate-`)
  const alive = pid => {
    try { process.kill(pid, 0); return true }
    catch (error) { if (error.code === 'ESRCH') return false; if (error.code === 'EPERM') return true; throw error }
  }
  try {
    await writeFile(join(candidate, ownerFile), JSON.stringify(owner))
    while (true) {
      // Installing a populated directory is atomic. It can replace an empty
      // legacy/crashed lock, but cannot replace another populated owner.
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
      // Rename the exact dead owner's unique entry to our live PID/token.
      // Only one contender can claim it; the directory is never left empty.
      try { renameSync(join(lock, files[0]), join(lock, ownerFile)) }
      catch (error) { if (error.code === 'ENOENT') continue; throw error }
      if (previous.stackPid !== undefined) {
        if (!Number.isSafeInteger(previous.stackPid) || previous.stackPid <= 0) throw new Error(`Invalid disposable stack process group: ${lock}`)
        owner.stackPid = previous.stackPid
      }
      // Retain orphan ownership even if this recovery process is hard-killed.
      writeFileSync(join(lock, ownerFile), JSON.stringify(owner))
      if (owner.stackPid && alive(-owner.stackPid)) {
        await signalStackGroup(owner.stackPid, 'SIGTERM')
        const deadline = Date.now() + 30_000
        while (alive(-owner.stackPid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
        if (alive(-owner.stackPid)) await signalStackGroup(owner.stackPid, 'SIGKILL')
        const killedDeadline = Date.now() + 2000
        while (alive(-owner.stackPid) && Date.now() < killedDeadline) await new Promise(resolve => setTimeout(resolve, 25))
        if (alive(-owner.stackPid)) throw new Error(`Orphaned E2E stack group has not stopped: ${owner.stackPid}`)
      }
      delete owner.stackPid
      writeFileSync(join(lock, ownerFile), JSON.stringify(owner))
      break
    }
  }
  finally { await rm(candidate, { recursive: true, force: true }) }
  let releasing
  const release = () => releasing ||= (async () => {
    await unlink(join(lock, ownerFile))
    await rmdir(lock).catch(error => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error })
  })()
  release.recordStack = pid => {
    owner.stackPid = pid
    writeFileSync(join(lock, ownerFile), JSON.stringify(owner))
  }
  return release
}

async function confirmStackGroupStopped(pid) {
  const deadline = Date.now() + 2000
  while (true) {
    try { process.kill(-pid, 0) }
    catch (error) { if (error.code === 'ESRCH') return; if (error.code !== 'EPERM') throw error }
    if (Date.now() >= deadline) throw new Error(`Owned E2E stack group has not stopped: ${pid}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

async function signalStackGroup(pid, signal) {
  try { process.kill(-pid, signal) }
  catch (error) {
    if (error.code === 'ESRCH') return
    // A disappearing group can briefly deny signals on macOS. Suppress the
    // error only after a subsequent probe confirms the entire group is gone.
    if (error.code === 'EPERM') await confirmStackGroupStopped(pid)
    else throw error
  }
}

export async function stopCaptureStack(child, release, timeoutMs) {
  try { await stopChild(child, timeoutMs) }
  finally {
    // SIGKILL delivery can precede the last descendant being reaped. Keep the
    // lock until the owned group is gone, including when stopChild rejects.
    if (child?.pid) await confirmStackGroupStopped(child.pid)
    await release?.()
  }
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
export function stopChild(child, timeoutMs = 30_000) {
  if (!child?.pid) return Promise.resolve()
  if (stopping.has(child)) return stopping.get(child)
  const stopped = (async () => {
    const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit')
    await signalStackGroup(child.pid, 'SIGTERM')
    let timer
    try {
      await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('E2E stack cleanup timed out')), timeoutMs) })])
    }
    finally {
      clearTimeout(timer)
      // The stack can exit while a startup subprocess or grandchild is still alive.
      await signalStackGroup(child.pid, 'SIGKILL')
      await exited
    }
  })()
  stopping.set(child, stopped)
  return stopped
}
