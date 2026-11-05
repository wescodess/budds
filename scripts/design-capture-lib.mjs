import { createHash } from 'node:crypto'
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
  return `${rule}:${createHash('sha256').update(JSON.stringify([rule, identity, selector])).digest('hex').slice(0, 24)}`
}

const floorSchema = z.object({
  version: z.literal(1),
  surface: name,
  status: z.literal('complete'),
  errors: z.array(z.unknown()).length(0),
  violations: z.array(z.object({ id: z.string().min(1) }).passthrough()),
}).passthrough()

export function compareFloor(current, baseline) {
  floorSchema.parse(baseline)
  if (current.surface !== baseline.surface) throw new Error('Comparison requires the same surface')
  const known = new Set(baseline.violations.map(value => value.id))
  return current.violations.filter(value => !known.has(value.id))
}
