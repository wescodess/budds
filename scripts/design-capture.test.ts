import { describe, expect, it } from 'vitest'
import { captureIdentity, compareFloor, validateSurface, violationId } from './design-capture-lib.mjs'

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
const floor = { version: 1, surface: 'example', status: 'complete', errors: [], violations: [{ id: 'known' }] }

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
