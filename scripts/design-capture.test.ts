import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureIdentity, compareFloor, normalizeSelector, resetCaptureOutput, stopChild, validateSurface, violationId } from './design-capture-lib.mjs'
import { checkLayout } from './design-capture-checks.mjs'

const surface = {
  version: 1,
  kind: 'routes',
  notes: 'A bounded synthetic fixture.',
  themes: ['dark', 'light'],
  viewports: [{ width: 320, height: 640 }],
  contentSelector: 'main',
  readySelector: 'main[data-ready=true]',
  cases: [{ kind: 'explanation', state: 'ready', path: '/__e2e/canvas?state=ready' }],
}
const capture = captureIdentity('example', surface.cases[0], 'dark', surface.viewports[0])
const floor = { version: 1, surface: 'example', status: 'complete', errors: [], captures: [capture], violations: [{ id: 'known' }] }

describe('surface definitions', () => {
  it('accepts route and standalone HTML surfaces', () => {
    expect(validateSurface(surface).surfaceSeparation).toEqual([])
    expect(validateSurface({ ...surface, kind: 'html', file: '/tmp/concept.html', cases: [{ kind: 'concept', state: 'ready' }] }).kind).toBe('html')
  })

  it.each([
    { themes: [] }, { themes: ['sepia'] }, { themes: ['dark', 'dark'] },
    { viewports: [{ width: 0, height: 640 }] }, { viewports: [surface.viewports[0], surface.viewports[0]] },
    { cases: [] }, { cases: [surface.cases[0], surface.cases[0]] },
    { notes: '' }, { contentSelector: '' }, { readySelector: '' }, { typo: true },
    { surfaceSeparation: [{ selectors: ['body'], minContrast: 1.1 }] },
    { surfaceSeparation: [{ selectors: ['main', 'body'], minContrast: 22 }] },
  ])('rejects invalid or ambiguous definitions: %j', change => {
    expect(() => validateSurface({ ...surface, ...change })).toThrow()
  })

  it.each(['https://example.com/', '//example.com/', '/\\example.com/', 'relative', 'file:///tmp/mock.html'])('rejects non-local routes: %s', path => {
    expect(() => validateSurface({ ...surface, cases: [{ ...surface.cases[0], path }] })).toThrow()
  })

  it('requires an HTML file and rejects route paths on HTML cases', () => {
    expect(() => validateSurface({ ...surface, kind: 'html' })).toThrow()
    expect(() => validateSurface({ ...surface, kind: 'html', file: 'concept.html' })).toThrow()
  })
})

describe('violation identity', () => {
  it('ignores SHA, metrics, and property insertion order', () => {
    const reordered = { viewport: { height: 640, width: 320 }, theme: 'dark', state: 'ready', kind: 'explanation', surface: 'example', sha: 'different' }
    expect(violationId('axe/contrast', capture, ['main', '#button'])).toBe(violationId('axe/contrast', reordered, ['main', '#button']))
  })

  it('distinguishes rules, selectors, and every capture dimension', () => {
    const id = violationId('target-size-24', capture, '#save')
    expect(violationId('horizontal-overflow', capture, '#save')).not.toBe(id)
    expect(violationId('target-size-24', capture, '#other')).not.toBe(id)
    for (const change of [{ surface: 'other' }, { kind: 'artifact' }, { state: 'active' }, { theme: 'light' }, { viewport: { width: 390, height: 844 } }]) {
      expect(violationId('target-size-24', { ...capture, ...change }, '#save')).not.toBe(id)
    }
  })

  it('preserves selector boundaries', () => {
    expect(violationId('axe/contrast', capture, ['a,b', 'c'])).not.toBe(violationId('axe/contrast', capture, ['a', 'b,c']))
  })
})

describe('floor comparison', () => {
  it('accepts existing debt, removals, and self-comparison', () => {
    expect(compareFloor(floor, floor)).toEqual([])
    expect(compareFloor({ ...floor, violations: [] }, floor)).toEqual([])
  })

  it('returns only newly introduced IDs', () => {
    expect(compareFloor({ ...floor, violations: [{ id: 'new' }, { id: 'known' }] }, floor)).toEqual([{ id: 'new' }])
    expect(compareFloor(floor, { ...floor, violations: [] })).toEqual([{ id: 'known' }])
  })

  it.each([
    { ...floor, status: 'error' }, { ...floor, status: 'running' },
    { ...floor, errors: ['Browser failed'] }, { ...floor, violations: [{}] },
    { ...floor, version: 2 }, {}, null,
  ])('rejects incomplete or invalid baselines: %j', baseline => {
    expect(() => compareFloor(floor, baseline)).toThrow()
  })

  it('rejects a different surface', () => {
    expect(() => compareFloor({ ...floor, surface: 'another' }, floor)).toThrow('same surface')
  })
})


describe('capture coverage', () => {
  it.each([
    { ...capture, theme: 'light' },
    { ...capture, viewport: { width: 390, height: 844 } },
    { ...capture, state: 'fallback' },
  ])('rejects missing baseline coverage even without violations: %j', missing => {
    expect(() => compareFloor({ ...floor, violations: [] }, { ...floor, captures: [capture, missing], violations: [] }))
      .toThrow(`Missing baseline captures: ${missing.kind}/${missing.state} ${missing.theme} ${missing.viewport.width}x${missing.viewport.height}`)
  })

  it('allows added captures and reports their new violations', () => {
    expect(compareFloor({ ...floor, captures: [capture, { ...capture, theme: 'light' }], violations: [{ id: 'added' }] }, floor)).toEqual([{ id: 'added' }])
  })

  it('rejects legacy baselines without capture identities', () => {
    const { captures: _captures, ...legacy } = floor
    expect(() => compareFloor(floor, legacy)).toThrow()
  })
})

describe('generated selectors', () => {
  it.each([['#v-0', '#v-98'], ['#v-0-1', '#v-9-88'], ['#reka-v-1', '#reka-v-7'], ['#reka-1', '#reka-33'], ['#reka-v-1-trigger-settings', '#reka-v-99-trigger-settings']])('ignores allocation counters: %s and %s', (before, after) => {
    expect(violationId('target-size-24', capture, before)).toBe(violationId('target-size-24', capture, after))
    expect(violationId('axe/label', capture, [['main', before]])).toBe(violationId('axe/label', capture, [['main', after]]))
  })

  it('keeps authored IDs and selector structure distinct', () => {
    expect(normalizeSelector('main > #save, #v-settings')).toBe('main > #save, #v-settings')
    expect(violationId('axe/label', capture, '#reka-v-1-trigger-one')).not.toBe(violationId('axe/label', capture, '#reka-v-2-trigger-two'))
    expect(violationId('axe/label', capture, ['#v-1 > input'])).not.toBe(violationId('axe/label', capture, ['#v-2 > button']))
  })
})

describe('capture output reset', () => {
  it('removes obsolete PNGs and reports at the same SHA', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-capture-reset-'))
    try {
      const output = join(root, '.design-captures/example/abc1234')
      await mkdir(output, { recursive: true })
      await writeFile(join(output, 'obsolete.png'), 'stale frame')
      await writeFile(join(output, 'floor.json'), JSON.stringify(floor))
      const baseline = JSON.parse(await readFile(join(output, 'floor.json'), 'utf8'))
      await resetCaptureOutput(root, 'example', output)
      expect(await readdir(output)).toEqual([])
      expect(compareFloor(floor, baseline)).toEqual([])
    }
    finally { await rm(root, { recursive: true, force: true }) }
  })

  it('refuses the surface root, outside paths and symlink escapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-capture-safe-'))
    try {
      const parent = join(root, '.design-captures/example')
      const outside = join(root, 'preserved')
      await mkdir(parent, { recursive: true })
      await mkdir(outside)
      await writeFile(join(outside, 'keep.png'), 'keep')
      for (const path of [parent, outside, join(parent, '../other')]) await expect(resetCaptureOutput(root, 'example', path)).rejects.toThrow('inside')
      await symlink(outside, join(parent, 'abc1234'))
      await expect(resetCaptureOutput(root, 'example', join(parent, 'abc1234'))).rejects.toThrow('symlink')
      expect(await readFile(join(outside, 'keep.png'), 'utf8')).toBe('keep')
      await symlink(outside, join(root, '.design-captures/linked'))
      await expect(resetCaptureOutput(root, 'linked', join(root, '.design-captures/linked/abc1234'))).rejects.toThrow('symlink')
    }
    finally { await rm(root, { recursive: true, force: true }) }
  })
})

describe('stack interruption', () => {
  it('sends one SIGTERM and waits for asynchronous one-shot cleanup', async () => {
    const child = spawn(process.execPath, ['-e', `
      setInterval(() => {}, 1000)
      process.once('SIGTERM', () => setTimeout(() => { process.stdout.write('cleaned'); process.exit(0) }, 150))
      process.stdout.write('ready')
    `], { stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      await once(child.stdout!, 'data')
      const cleaned = once(child.stdout!, 'data')
      const first = stopChild(child)
      await new Promise(resolve => setTimeout(resolve, 25))
      await Promise.all([first, stopChild(child)])
      expect(String((await cleaned)[0])).toBe('cleaned')
      expect(child.exitCode).toBe(0)
      expect(child.signalCode).toBeNull()
    }
    finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }
  })

  it('escalates only when cleanup times out', async () => {
    const child = spawn(process.execPath, ['-e', `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.stdout.write('ready')`], { stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      await once(child.stdout!, 'data')
      await expect(stopChild(child, 100)).rejects.toThrow('cleanup timed out')
      expect(child.signalCode).toBe('SIGKILL')
    }
    finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }
  })
})

describe('adaptive frame separation guard', () => {
  it('passes current fills but fails collapsed fills, without claiming quality', async () => {
    const definition = JSON.parse(await readFile(new URL('../docs/design/surfaces/learn-adaptive-canvases.json', import.meta.url), 'utf8'))
    const minimum = definition.surfaceSeparation[0].minContrast
    expect(1.0997).toBeGreaterThanOrEqual(minimum)
    expect(1.0621).toBeGreaterThanOrEqual(minimum)
    expect(1).toBeLessThan(minimum)
    expect(definition.notes).toMatch(/regression.*not a claim.*quality/)
  })
})

describe('layout target identity and hidden inputs', () => {
  afterEach(() => vi.unstubAllGlobals())

  function layout(html: string, sizes: Record<string, [number, number]>) {
    const window = new Window()
    window.document.body.innerHTML = html
    vi.stubGlobal('document', window.document)
    vi.stubGlobal('CSS', window.CSS)
    vi.stubGlobal('getComputedStyle', window.getComputedStyle.bind(window))
    for (const element of window.document.querySelectorAll('*')) {
      const [width, height] = sizes[element.id] || [100, 100]
      const rect = { width, height, top: 0, left: 0, right: width, bottom: height }
      element.checkVisibility = () => true
      element.getClientRects = () => [rect] as any
      element.getBoundingClientRect = () => rect as any
    }
    return checkLayout().filter((finding: any) => finding.rule === 'target-size-24')
  }

  it('prefers a unique test ID to a generated ID while reporting the raw selector', () => {
    const findings = layout('<button id="reka-v-1" data-testid="save">Save</button>', { 'reka-v-1': [20, 20] })
    expect(findings[0].selector).toBe('[data-testid="save"]')
  })

  it.each(['width:1px;height:1px', 'clip:rect(0px,0px,0px,0px)', 'clip-path:inset(50%)'])('uses a full-size explicit label for hidden input: %s', style => {
    expect(layout(`<input id="input" style="${style}"><label id="label" for="input">Select</label>`, { input: style.startsWith('width') ? [1, 1] : [30, 30], label: [32, 32] })).toEqual([])
  })

  it('uses an enclosing label for a visually hidden input', () => {
    expect(layout('<label id="label">Select<input id="input"></label>', { input: [1, 1], label: [32, 32] })).toEqual([])
  })

  it('reports a small label and a hidden input without a label', () => {
    const findings = layout('<input id="small"><label id="label" for="small">Small</label><input id="unlabelled">', { small: [1, 1], label: [12, 12], unlabelled: [1, 1] })
    expect(findings.map((finding: any) => finding.selector)).toEqual(['#small', '#unlabelled'])
    expect(findings[0].rects).toEqual([{ width: 12, height: 12 }])
  })

  it('reports a clipped input without a label even with a large layout box', () => {
    expect(layout('<input id="input" style="clip-path:inset(50%)">', { input: [30, 30] })).toHaveLength(1)
  })

  it('keeps visible undersized inputs as findings even with a large label', () => {
    expect(layout('<input id="input"><label id="label" for="input">Select</label>', { input: [20, 20], label: [32, 32] })).toHaveLength(1)
  })
})
