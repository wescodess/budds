import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod'

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

export async function resetCaptureOutput(root, surface, output) {
  name.parse(surface)
  const child = relative(resolve(root, '.design-captures', surface), resolve(output))
  if (!child || child === '..' || child.startsWith('../') || isAbsolute(child)) throw new Error('Capture output must be inside .design-captures/<surface>/')
  if (child.includes('/')) throw new Error('Capture output must be an immediate child of its surface')
  const parent = join(await realpath(root), '.design-captures', surface)
  const target = join(parent, child)
  await mkdir(parent, { recursive: true })
  if (await realpath(parent) !== parent) throw new Error('Capture output parent must not traverse symlinks')
  const actual = await realpath(target).catch(error => {
    if (error.code !== 'ENOENT') throw error
    return target
  })
  if (actual !== target || relative(parent, actual).startsWith('..')) throw new Error('Capture output must not traverse symlinks')
  await rm(target, { recursive: true, force: true })
  await mkdir(target)
}

const stopping = new WeakMap()
export function stopChild(child, timeoutMs = 30_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  if (stopping.has(child)) return stopping.get(child)
  const stopped = (async () => {
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    let timer
    try {
      await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('E2E stack cleanup timed out')), timeoutMs) })])
    }
    catch (error) {
      child.kill('SIGKILL')
      await exited
      throw error
    }
    finally { clearTimeout(timer) }
  })()
  stopping.set(child, stopped)
  return stopped
}
