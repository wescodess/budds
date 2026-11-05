// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compareCounts, countFiles, countViolations, rules, run } from './design-ratchet.mjs'

const empty = () => countFiles({})

describe('countViolations', () => {
  it.each([
    ['uppercase-tracking', '<p class="uppercase text-xs tracking-wide" /><p class="tracking-[.2em] font-medium uppercase" />', 2],
    ['sparkles', 'import { Sparkles } from "@lucide/vue"; <Sparkles /><Sparkles />', 3],
    ['backdrop-blur', '<div class="backdrop-blur dark:backdrop-blur-sm" />', 2],
    ['gradients', '<div class="bg-gradient-to-r bg-linear-to-br bg-radial bg-conic bg-linear-[45deg]" />', 5],
    ['gradients', '.shimmer { background: linear-gradient(red, blue) } .x { background: repeating-radial-gradient(red, blue) }', 2],
    ['hover-lift', '<div class="hover:scale-105 md:hover:scale-[1.03] hover:-translate-y-1 group-hover:-translate-x-px hover:scale-x-110" />', 5],
    ['style-block', '<style scoped>p {}</style><style lang="css"></style>', 2],
    ['violet-indigo', '<div class="border-violet-500/30 dark:text-indigo-200" />', 2],
    ['raw-amber-orange', '<div class="bg-amber-500/20 hover:text-orange-400 border-l-amber-600" />', 3],
    ['raw-hex', '<div class="bg-[#fff] text-[#ffff] [&_pre]:bg-[#0f0d0c] border-[#aabbccdd] text-[color:#ABCDEF]" />', 5],
  ])('counts each %s occurrence', (rule, source, expected) => {
    expect(countViolations(source)[rule]).toBe(expected)
    expect(countViolations(source)[rule]).toBe(expected)
  })

  it('handles Vue expressions, class maps, cn(), multiline classes, and prose apostrophes', () => {
    const source = `
      <p>It's ready</p>
      <button :aria-label="playing ? 'Pause' : 'Play'" class="hover:scale-105" />
      <div :class="['uppercase tracking-wide', active ? 'bg-amber-500' : 'text-orange-400']" />
      <div :class="{ 'backdrop-blur': open }" />
      cn('tracking-wide uppercase', props.class)
      <p class="uppercase
        font-medium tracking-widest" />
    `
    expect(countViolations(source)).toMatchObject({
      'uppercase-tracking': 3,
      'hover-lift': 1,
      'raw-amber-orange': 2,
      'backdrop-blur': 1,
    })
  })

  it('does not combine uppercase and tracking across literals or flag semantic tokens and CSS palette definitions', () => {
    const source = `
      <p class="uppercase" /><p class="tracking-wide" />
      <div :class="active ? 'uppercase' : 'tracking-wide'" />
      <div class="bg-primary text-muted-foreground hover:translate-x-1 scale-105" />
      <div class="text-[12px] bg-[var(--card)] text-[#invalid]" />
      --color-folder-indigo-ink: #6366f1;
      const NotSparkles = 'style'; <stylesheet />
    `
    expect(countViolations(source)).toEqual(Object.fromEntries(rules.map(rule => [rule, 0])))
  })

  it('sorts rules and files and omits zero counts', () => {
    const result = countFiles({ 'app/z.vue': '<Sparkles /><Sparkles />', 'app/a.ts': 'Sparkles', 'app/clean.vue': '<p />' })
    expect(Object.keys(result)).toEqual([...rules].sort())
    expect(Object.entries(result.sparkles)).toEqual([['app/a.ts', 1], ['app/z.vue', 2]])
    expect(result.gradients).toEqual({})
  })
})

describe('compareCounts', () => {
  it('accepts exact matches', () => {
    const counts = countFiles({ 'app/a.vue': '<Sparkles />' })
    expect(compareCounts(counts, counts)).toEqual([])
  })

  it('reports increases within a file and violations in a new file', () => {
    const baseline = countFiles({ 'app/a.vue': '<Sparkles />' })
    const current = countFiles({ 'app/a.vue': '<Sparkles /><Sparkles />', 'app/new.vue': '<Sparkles />' })
    expect(compareCounts(baseline, current)).toEqual([
      { rule: 'sparkles', file: 'app/a.vue', oldCount: 1, newCount: 2 },
      { rule: 'sparkles', file: 'app/new.vue', oldCount: 0, newCount: 1 },
    ])
  })

  it('reports both sides of a move, even with unchanged totals', () => {
    expect(compareCounts(countFiles({ 'app/old.vue': '<Sparkles />' }), countFiles({ 'app/new.vue': '<Sparkles />' }))).toEqual([
      { rule: 'sparkles', file: 'app/new.vue', oldCount: 0, newCount: 1 },
      { rule: 'sparkles', file: 'app/old.vue', oldCount: 1, newCount: 0 },
    ])
  })

  it('reports reductions and deleted files', () => {
    const baseline = countFiles({ 'app/a.vue': '<Sparkles /><Sparkles />', 'app/deleted.vue': '<Sparkles />' })
    expect(compareCounts(baseline, countFiles({ 'app/a.vue': '<Sparkles />' }))).toEqual([
      { rule: 'sparkles', file: 'app/a.vue', oldCount: 2, newCount: 1 },
      { rule: 'sparkles', file: 'app/deleted.vue', oldCount: 1, newCount: 0 },
    ])
  })
})

describe('run', () => {
  const directories = []
  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  })

  async function fixture(baseline = empty()) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'design-ratchet-'))
    directories.push(root)
    await mkdir(path.join(root, 'app/nested'), { recursive: true })
    await mkdir(path.join(root, 'docs/design'), { recursive: true })
    const baselinePath = path.join(root, 'docs/design/ratchet-baseline.json')
    await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    return { root, baselinePath }
  }

  it('fails a reduction until update locks it in and is stable on repeated updates', async () => {
    const { root, baselinePath } = await fixture(countFiles({ 'app/nested/a.vue': '<Sparkles /><Sparkles />', 'app/deleted.vue': '<Sparkles />' }))
    await writeFile(path.join(root, 'app/nested/a.vue'), '<Sparkles />')
    expect(await run(root)).toBe(1)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('sparkles: app/nested/a.vue: old 2, new 1. Run pnpm design:ratchet --update'))
    expect(await run(root, ['--update'])).toBe(0)
    const updated = await readFile(baselinePath, 'utf8')
    expect(JSON.parse(updated).sparkles).toEqual({ 'app/nested/a.vue': 1 })
    expect(await run(root)).toBe(0)
    expect(await run(root, ['--update'])).toBe(0)
    expect(await readFile(baselinePath, 'utf8')).toBe(updated)
  })

  it('refuses increases and mixed moves atomically during update', async () => {
    const { root, baselinePath } = await fixture(countFiles({ 'app/old.vue': '<Sparkles />' }))
    const before = await readFile(baselinePath, 'utf8')
    await writeFile(path.join(root, 'app/nested/new.vue'), '<Sparkles />')
    expect(await run(root)).toBe(1)
    expect(await run(root, ['--update'])).toBe(1)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('sparkles: app/nested/new.vue: old 0, new 1. Remove the added violation'))
    expect(await readFile(baselinePath, 'utf8')).toBe(before)
  })

  it('accepts a visible baseline hand edit for an intentional increase', async () => {
    const { root, baselinePath } = await fixture()
    await writeFile(path.join(root, 'app/new.vue'), '<Sparkles />')
    expect(await run(root, ['--update'])).toBe(1)
    await writeFile(baselinePath, JSON.stringify(countFiles({ 'app/new.vue': '<Sparkles />' })))
    expect(await run(root)).toBe(0)
  })

  it('scans only app/ and rejects unsupported arguments', async () => {
    const { root } = await fixture()
    await writeFile(path.join(root, 'outside.vue'), '<Sparkles />')
    expect(await run(root)).toBe(0)
    await expect(run(root, ['--reset'])).rejects.toThrow('Usage:')
  })

  it.each([{}, { ...empty(), sparkles: { 'app/a.vue': -1 } }, { ...empty(), sparkles: { 'app/../a.vue': 1 } }])('rejects malformed baselines without overwriting them', async (baseline) => {
    const { root, baselinePath } = await fixture(baseline)
    const before = await readFile(baselinePath, 'utf8')
    await expect(run(root, ['--update'])).rejects.toThrow(/baseline/i)
    expect(await readFile(baselinePath, 'utf8')).toBe(before)
  })
})
