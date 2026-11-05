// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type {} from '../support/generated-content-browser'
import { compatibleDiagrams, multilineDiagrams, refusedDiagrams, rejectedGeneratedContent } from '../support/generated-content-fixtures'
import { goodMarkdownCorpus, mixedMarkdownCorpus } from '../support/generated-markdown-corpus'

let browser: Browser
let page: Page
const networkRequests: string[] = []
const graph = 'graph TD\naccDescr: Start leads to Finish.\nA[Start] --> B[Finish]'

beforeAll(async () => {
  // Build outside Vitest's module transforms; all output stays in memory.
  const code = execFileSync(process.execPath, ['tests/support/build-generated-content-browser.mjs'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  const executablePath = [chromium.executablePath(), '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(path => existsSync(path))
  if (!executablePath) throw new Error('Chromium or system Chrome is required for SVG security tests')
  browser = await chromium.launch({ headless: true, executablePath })
  page = await browser.newPage()
  await page.route('**/*', route => { networkRequests.push(route.request().url()); return route.abort() })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<!doctype html><html><body></body></html>')
  await page.addScriptTag({ path: resolve('node_modules/mermaid/dist/mermaid.min.js') })
  await page.evaluate(() => {
    const context = globalThis as unknown as { mermaid: typeof import('mermaid')['default']; __mermaidTestModule: typeof import('mermaid')['default'] }
    // The distribution exposes getter-only exports; copy the real functions so
    // lifecycle failure injections can replace them without silently doing nothing.
    context.__mermaidTestModule = { ...context.mermaid }
  })
  await page.addScriptTag({ content: code })
  if (errors.length) throw new Error(errors.join('\n'))
  if (!await page.evaluate(() => Boolean(window.__generatedContentTest))) throw new Error('browser harness did not load')
}, 120_000)

afterAll(async () => { await browser?.close() })

const render = (source: string) => page.evaluate(async (code) => {
  const mermaid = (globalThis as unknown as { __mermaidTestModule: typeof import('mermaid')['default'] }).__mermaidTestModule
  return window.__generatedContentTest.renderGeneratedMermaid(code, async () => ({ default: mermaid }) as typeof import('mermaid'), () => true)
}, source)

const sanitize = (source: string) => page.evaluate(svg => window.__generatedContentTest.sanitizeGeneratedMermaidSvg(svg, 'owned-canary', 'Start leads to Finish.'), source)

describe('real browser Mermaid boundary', () => {
  it.each(['course', 'chat'] as const)('%s rejects the inert source matrix in Chromium', async (surface) => {
    for (const [, content] of rejectedGeneratedContent) {
      await page.evaluate(({ surface, content }) => window.__generatedContentTest.mount(surface, content!), { surface, content })
      await expect.poll(() => page.locator('#host').textContent()).toContain(content)
      expect(await page.locator('#host a, #host img, #host iframe, #host video, #host form, #host input, #host math, #host style, #host citation, #host generated-canary').count()).toBe(0)
      expect(await page.locator('#host svg').count()).toBe(surface === 'course' ? 1 : 0)
    }
  }, 30_000)

  it.each(['course', 'chat'] as const)('%s renders the Markdown corpus in Chromium, degrading only refused blocks', async (surface) => {
    for (const { source, selectors, refused } of [...goodMarkdownCorpus, ...mixedMarkdownCorpus] as Array<(typeof mixedMarkdownCorpus)[number] | (typeof goodMarkdownCorpus)[number] & { refused?: undefined }>) {
      await page.evaluate(({ surface, source }) => window.__generatedContentTest.mount(surface, source), { surface, source })
      await page.locator(`#host ${selectors[0]!}`).first().waitFor({ state: 'attached' })
      expect(await page.locator('#host [data-generated-refused]').count(), source).toBe(refused ? 1 : 0)
      for (const selector of selectors) expect(await page.locator(`#host ${selector}`).count(), selector).toBeGreaterThan(0)
      expect(await page.locator('#host img, #host iframe, #host video, #host form, #host input, #host math, #host style, #host citation, #host .canary, #host #canary').count(), source).toBe(0)
    }
  }, 60_000)

  it.each([graph, 'sequenceDiagram\naccDescr: Alice greets Bob.\nparticipant Alice\nparticipant Bob\nAlice->>Bob: Hello'])('renders actual static diagrams through the final sanitizer', async (source) => {
    const svg = await render(source)
    expect(svg).toContain('role="img"')
    expect(svg).not.toMatch(/<style| style=|foreignObject|<image|<a\b|<script|<use\b/)
    expect(await page.locator('[data-generated-mermaid-staging]').count()).toBe(0)
  })

  it('preserves natural diagram sizing and scales within a narrow viewport', async () => {
    const svg = await render(graph)
    const size = await page.evaluate((svg) => {
      const host = document.createElement('div')
      host.style.width = '900px'
      host.innerHTML = svg
      document.body.append(host)
      const diagram = host.querySelector('svg')!
      // These are the component's application-owned responsive utilities.
      diagram.style.maxWidth = '100%'
      diagram.style.height = 'auto'
      const natural = diagram.getBoundingClientRect()
      const bounds = diagram.viewBox.baseVal
      const expected = { width: bounds.width, height: bounds.height }
      host.style.width = '40px'
      const narrow = diagram.getBoundingClientRect()
      host.remove()
      return { natural: { width: natural.width, height: natural.height }, expected, narrow: { width: narrow.width, height: narrow.height } }
    }, svg)
    expect(size.natural.width).toBeCloseTo(size.expected.width, 1)
    expect(size.natural.height).toBeCloseTo(size.expected.height, 1)
    expect(size.narrow.width).toBeCloseTo(40, 1)
    expect(size.narrow.height / size.narrow.width).toBeCloseTo(size.expected.height / size.expected.width, 2)
  })

  it.each(['course', 'chat'] as const)('%s mounts real fenced Mermaid and preserves numeric citations', async (surface) => {
    await page.evaluate(({ surface, graph }) => window.__generatedContentTest.mount(surface, `Fact [1]\n\n\`\`\`mermaid\n${graph}\n\`\`\``), { surface, graph })
    await expect.poll(() => page.locator('#host svg[role="img"]').count()).toBe(1)
    expect(await page.locator('#host svg[role="img"]').getAttribute('aria-label')).toBe('Start leads to Finish.')
    expect(await page.locator('#host foreignObject, #host style').count()).toBe(0)
    expect(await page.locator('#host button').count()).toBe(surface === 'chat' ? 1 : 0)
  })

  it.each(['foreignObject', 'a', 'image', 'script', 'animate', 'set', 'use'])('rejects SVG %s integration', async (tag) => {
    await expect(sanitize(`<svg xmlns="http://www.w3.org/2000/svg"><${tag}>inert canary</${tag}></svg>`)).rejects.toThrow('svg-structure')
  })

  it('replaces CSS and resource/event attributes and rewrites internal references', async () => {
    const clean = await sanitize('<svg xmlns="http://www.w3.org/2000/svg" id="diagram"><style>/* canary */</style><defs><marker id="arrow"><path d="M0 0 L10 5 L0 10"/></marker></defs><g style="color:red" class="canary"><rect width="10" height="10"/><path d="M0 0 L10 10" marker-end="url(#arrow)" onclick="inertCanary" href="https://example.invalid/resource"/><text>Start</text></g></svg>')
    expect(clean).toContain('marker-end="url(#owned-canary-1)"')
    expect(clean).toContain('fill="#d6d3d1"')
    expect(clean).not.toMatch(/<style| style=| class=| href=| onclick=/)
  })

  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><path marker-end="url(https://example.invalid)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path marker-end="url(#absent)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><g id="same"/><g id="same"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg">' + ' '.repeat(256 * 1024) + '</svg>',
    '<svg xmlns="http://www.w3.org/2000/svg">' + '<rect x="0" y="0" width="1" height="1"/>'.repeat(5000) + '</svg>',
  ])('rejects unresolved references, duplicate IDs and oversized output', async (source) => {
    await expect(sanitize(source)).rejects.toThrow()
  })

  describe.each(['course', 'chat'] as const)('%s diagrams', (surface) => {
    const mountFence = (source: string) => page.evaluate(({ surface, source }) => window.__generatedContentTest.mount(surface, `\`\`\`mermaid\n${source}\n\`\`\``), { surface, source })

    it.each(compatibleDiagrams)('renders an undescribed %s diagram', async (_family, source, labels) => {
      await mountFence(source)
      const diagram = page.locator('#host svg[role="img"]')
      await expect.poll(() => diagram.count(), { timeout: 30_000 }).toBe(1)
      expect(await diagram.getAttribute('aria-label')).toBe('Diagram')
      expect(await page.locator('#host pre').count()).toBe(0)
      expect(await page.locator('#host foreignObject, #host style, #host a, #host image, #host use').count()).toBe(0)
      const text = await diagram.textContent()
      for (const label of labels) expect(text).toContain(label)
      const layout = await diagram.evaluate((svg) => {
        const bounds = svg.getBoundingClientRect()
        const labels = [...svg.querySelectorAll('text')].filter(label => label.textContent?.trim())
        return { width: bounds.width, height: bounds.height, shapes: svg.querySelectorAll('rect, path, polygon, circle').length, clipped: labels.filter((label) => {
          const box = label.getBoundingClientRect()
          return box.left < bounds.left - 1 || box.right > bounds.right + 1 || box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1
        }).map(label => label.textContent) }
      })
      expect(layout.width).toBeGreaterThan(50)
      expect(layout.height).toBeGreaterThan(50)
      expect(layout.shapes).toBeGreaterThan(0)
      expect(layout.clipped).toEqual([])
      expect(networkRequests).toEqual([])
      await page.evaluate(() => window.__generatedContentTest.unmount())
    }, 45_000)

    it.each(multilineDiagrams)('draws %s as separate SVG text lines', async (_name, source, lines) => {
      await mountFence(source)
      const diagram = page.locator('#host svg[role="img"]')
      await expect.poll(() => diagram.count(), { timeout: 30_000 }).toBe(1)
      const drawn = await diagram.evaluate((svg) => {
        const leaves = [...svg.querySelectorAll('text, tspan')].filter(el => !el.querySelector('tspan') && el.textContent?.trim())
        return {
          markup: svg.outerHTML,
          namespaces: [...new Set([...svg.querySelectorAll('*')].map(el => el.namespaceURI))],
          leaves: leaves.map(el => ({ text: el.textContent!.trim(), top: el.getBoundingClientRect().top })),
        }
      })
      expect(drawn.markup).not.toMatch(/foreignObject|<br|&lt;|<div|<span|<p\b/)
      expect(drawn.namespaces).toEqual(['http://www.w3.org/2000/svg'])
      const tops = lines.map(line => drawn.leaves.find(leaf => leaf.text === line)?.top)
      expect(tops.every(top => top !== undefined)).toBe(true)
      for (let index = 0; index < lines.length; index += 2) expect(tops[index + 1]!).toBeGreaterThan(tops[index]!)
      expect(networkRequests).toEqual([])
      await page.evaluate(() => window.__generatedContentTest.unmount())
    }, 45_000)

    it.each(refusedDiagrams)('keeps %s as escaped code', async (_name, source) => {
      await page.evaluate(() => {
        const context = globalThis as unknown as { __mermaidTestModule: typeof import('mermaid')['default']; savedRender: typeof import('mermaid')['default']['render']; renderCalls: number }
        context.savedRender = context.__mermaidTestModule.render
        context.renderCalls = 0
        context.__mermaidTestModule.render = ((...args: Parameters<typeof context.savedRender>) => { context.renderCalls++; return context.savedRender(...args) }) as typeof context.savedRender
      })
      try {
        await mountFence(source)
        await expect.poll(() => page.locator('#host pre').count()).toBe(1)
        expect(await page.locator('#host pre').textContent()).toContain(source.trim().split('\n')[0])
        expect(await page.locator('#host svg[role="img"]').count()).toBe(0)
        expect(await page.evaluate(() => (globalThis as unknown as { renderCalls: number }).renderCalls)).toBe(0)
        expect(await page.locator('[data-generated-mermaid-staging]').count()).toBe(0)
      } finally {
        await page.evaluate(() => {
          const context = globalThis as unknown as { __mermaidTestModule: typeof import('mermaid')['default']; savedRender: typeof import('mermaid')['default']['render'] }
          context.__mermaidTestModule.render = context.savedRender
          window.__generatedContentTest.unmount()
        })
      }
    })

    it('still applies the final SVG restriction to an undescribed diagram', async () => {
      const source = 'graph TD\nA --> B'
      await page.evaluate(() => {
        const context = globalThis as unknown as { __mermaidTestModule: typeof import('mermaid')['default']; savedRender: typeof import('mermaid')['default']['render'] }
        context.savedRender = context.__mermaidTestModule.render
        context.__mermaidTestModule.render = (async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">integration canary</div></foreignObject></svg>' })) as typeof context.__mermaidTestModule.render
      })
      try {
        await mountFence(source)
        await expect.poll(() => page.locator('#host pre').count()).toBe(1)
        expect(await page.locator('#host pre').textContent()).toContain(source)
        expect(await page.locator('#host foreignObject, #host svg[role="img"]').count()).toBe(0)
        expect(await page.locator('[data-generated-mermaid-staging]').count()).toBe(0)
      } finally {
        await page.evaluate(() => {
          const context = globalThis as unknown as { __mermaidTestModule: typeof import('mermaid')['default']; savedRender: typeof import('mermaid')['default']['render'] }
          context.__mermaidTestModule.render = context.savedRender
          window.__generatedContentTest.unmount()
        })
      }
    })
  })

  it.each([
    ['class', compatibleDiagrams[2][1], '+String name', 'start'],
    ['mindmap', compatibleDiagrams[3][1], 'Sunlight', 'start'],
    ['flowchart subgraph', compatibleDiagrams[0][1], 'Review', 'start'],
    ['flowchart node', compatibleDiagrams[0][1], 'Process', 'middle'],
  ])('anchors %s labels where Mermaid positioned them', async (_family, source, label, anchor) => {
    await page.evaluate(source => window.__generatedContentTest.mount('course', `\`\`\`mermaid\n${source}\n\`\`\``), source)
    const text = page.locator('#host svg[role="img"] text', { hasText: label }).first()
    await expect.poll(() => text.count(), { timeout: 30_000 }).toBe(1)
    expect(await text.getAttribute('text-anchor')).toBe(anchor)
    await page.evaluate(() => window.__generatedContentTest.unmount())
  }, 45_000)

  it.each([
    ['one actor', 'sequenceDiagram\nactor A\nA->>A: Hello', 2],
    ['several actors', 'sequenceDiagram\nactor A\nactor B\nactor C\nA->>B: Hello\nB->>C: Hello', 6],
    ['an actor after a participant', 'sequenceDiagram\nparticipant P\nactor A\nA->>P: Hello', 2],
  ])('draws every stick figure for %s, with a unique ID on each element', async (_name, source, figures) => {
    await page.evaluate(source => window.__generatedContentTest.mount('course', `\`\`\`mermaid\n${source}\n\`\`\``), source)
    const diagram = page.locator('#host svg[role="img"]')
    await expect.poll(() => diagram.count(), { timeout: 30_000 }).toBe(1)
    const drawn = await diagram.evaluate((svg) => {
      const ids = [...svg.querySelectorAll('[id]')].map(el => el.id)
      return { ids, unique: new Set(ids).size, circles: [...svg.querySelectorAll('circle')].filter(el => !el.closest('marker')).length, lines: svg.querySelectorAll('g > line').length }
    })
    expect(drawn.unique).toBe(drawn.ids.length)
    expect(drawn.circles).toBe(figures)
    // Each figure has a torso, arms and two legs, on top of the actors' lifelines.
    expect(drawn.lines).toBeGreaterThanOrEqual(figures * 4)
    await page.evaluate(() => window.__generatedContentTest.unmount())
  }, 45_000)

  it('drops only unreferenced repeats of the generated actor figure IDs', async () => {
    const figure = (id: string, parentClass = 'actor-man') => `<g class="${parentClass}"><line id="${id}" x1="0" y1="0" x2="1" y2="1"/></g>`
    const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`
    const clean = await sanitize(svg(figure('actor-man-torso2') + figure('actor-man-arms2') + figure('actor-man-torso2') + figure('actor-man-arms2')))
    expect(clean.match(/ id=/g)).toHaveLength(2)
    expect(clean.match(/<line/g)).toHaveLength(4)
    for (const source of [
      svg(figure('other-line') + figure('other-line')),
      svg(figure('actor-man-torso2extra') + figure('actor-man-torso2extra')),
      svg(figure('actor-man-torso2', 'canary') + figure('actor-man-torso2', 'canary')),
      svg(`${figure('actor-man-torso2')}<g id="actor-man-torso2"/>${figure('actor-man-torso2')}`),
      svg(`${figure('actor-man-torso2') + figure('actor-man-torso2')}<rect aria-labelledby="actor-man-torso2"/>`),
      svg(`${figure('actor-man-torso2') + figure('actor-man-torso2')}<path marker-end="url(#actor-man-torso2)"/>`),
    ]) await expect(sanitize(source)).rejects.toThrow(/svg-id|svg-reference/)
  })

  it('accepts only the mindmap background ID repeat and keeps its node fill opaque', async () => {
    const clean = await sanitize('<svg xmlns="http://www.w3.org/2000/svg"><g id="node"><path id="node" class="node-bkg" d="M0 0 L10 10"/></g></svg>')
    expect(clean.match(/ id=/g)).toHaveLength(1)
    expect(clean).toContain('fill="#292524"')
    for (const source of [
      '<svg xmlns="http://www.w3.org/2000/svg"><g id="node"><path id="node" d="M0 0 L10 10"/></g></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><path id="node" class="node-bkg"/><path id="node" class="node-bkg"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><g id="other"><path id="node" class="node-bkg"/></g><g id="node"/></svg>',
    ]) await expect(sanitize(source)).rejects.toThrow('svg-id')
  })

  it('keeps the session default stricter: undescribed and other-family diagrams stay escaped code', async () => {
    const source = 'classDiagram\nclass A'
    await page.evaluate(source => window.__generatedContentTest.mount('mermaid', source), source)
    await expect.poll(() => page.locator('#host pre').count()).toBe(1)
    expect(await page.locator('#host pre').textContent()).toBe(source)
    expect(await page.locator('#host svg').count()).toBe(0)
  })

  it('rejects returned HTML integration at the real component insertion sink', async () => {
    await page.evaluate((source) => {
      const context = globalThis as unknown as { __mermaidTestModule: typeof import('mermaid')['default']; savedRender: typeof import('mermaid')['default']['render'] }
      context.savedRender = context.__mermaidTestModule.render
      context.__mermaidTestModule.render = (async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">integration canary</div></foreignObject></svg>' })) as typeof context.__mermaidTestModule.render
      window.__generatedContentTest.mount('mermaid', source)
    }, graph)
    try {
      await expect.poll(() => page.locator('#host pre').count()).toBe(1)
      expect(await page.locator('#host pre').textContent()).toBe(graph)
      expect(await page.locator('#host foreignObject, #host svg').count()).toBe(0)
      expect(await page.locator('[data-generated-mermaid-staging]').count()).toBe(0)
    } finally {
      await page.evaluate(() => {
        const context = globalThis as unknown as { __mermaidTestModule: typeof import('mermaid')['default']; savedRender: typeof import('mermaid')['default']['render'] }
        context.__mermaidTestModule.render = context.savedRender
        window.__generatedContentTest.unmount()
      })
    }
  })

  it('does not insert a stale component completion after update and unmount', async () => {
    await page.evaluate((source) => {
      const context = globalThis as unknown as { __mermaidTestModule: typeof import('mermaid')['default']; savedRender: typeof import('mermaid')['default']['render']; finishRender: (result: { svg: string }) => void }
      context.savedRender = context.__mermaidTestModule.render
      context.__mermaidTestModule.render = (() => new Promise(resolve => { context.finishRender = resolve })) as typeof context.__mermaidTestModule.render
      window.__generatedContentTest.mount('mermaid', source)
    }, graph)
    await page.waitForFunction(() => Boolean((globalThis as unknown as { finishRender?: unknown }).finishRender))
    await page.evaluate(() => window.__generatedContentTest.update('classDiagram\nclass A'))
    await expect.poll(() => page.locator('#host pre').count()).toBe(1)
    await page.evaluate(() => {
      const context = globalThis as unknown as { __mermaidTestModule: typeof import('mermaid')['default']; savedRender: typeof import('mermaid')['default']['render']; finishRender: (result: { svg: string }) => void }
      window.__generatedContentTest.unmount()
      context.finishRender({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Stale</text></svg>' })
      context.__mermaidTestModule.render = context.savedRender
    })
    await page.evaluate(source => window.__generatedContentTest.mount('mermaid', source), graph)
    await expect.poll(() => page.locator('#host svg[role="img"]').count()).toBe(1)
    expect(await page.locator('#host').textContent()).not.toContain('Stale')
    expect(await page.locator('[data-generated-mermaid-staging]').count()).toBe(0)
  })

  it('rejects unsupported source before import or staging and handles import failure', async () => {
    const result = await page.evaluate(async () => {
      let imports = 0
      const load = async (): Promise<typeof import('mermaid')> => { imports++; throw new Error('import failure') }
      for (const source of ['graph TD\nA --> B', 'graph TD\naccDescr: A leads to B.\nA --> B']) {
        try { await window.__generatedContentTest.renderGeneratedMermaid(source, load, () => true) } catch { /* expected */ }
      }
      return { imports, staging: document.querySelectorAll('[data-generated-mermaid-staging]').length }
    })
    expect(result).toEqual({ imports: 1, staging: 0 })
  })

  it('serializes staging, discards stale completion and cleans up on render failure', async () => {
    const result = await page.evaluate(async (source) => {
      const harness = window.__generatedContentTest
      const actual = (globalThis as unknown as { __mermaidTestModule: typeof import('mermaid')['default'] }).__mermaidTestModule
      const original = actual.render
      let finish: ((value: { svg: string }) => void) | undefined
      let current = true
      let calls = 0
      let maxStages = 0
      actual.render = (async () => {
        calls++
        maxStages = Math.max(maxStages, document.querySelectorAll('[data-generated-mermaid-staging]').length)
        if (calls === 1) return new Promise(resolve => { finish = resolve })
        throw new Error('render failed')
      }) as typeof actual.render
      const load = async () => ({ default: actual }) as typeof import('mermaid')
      try {
        const first = harness.renderGeneratedMermaid(source, load, () => current).catch(() => 'stale')
        while (!finish) await Promise.resolve()
        const second = harness.renderGeneratedMermaid(source, load, () => true).catch(() => 'failed')
        current = false
        finish({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Stale</text></svg>' })
        const results = await Promise.all([first, second])
        return { results, maxStages, calls, staging: document.querySelectorAll('[data-generated-mermaid-staging]').length }
      } finally { actual.render = original }
    }, graph)
    expect(result).toEqual({ results: ['stale', 'failed'], maxStages: 1, calls: 2, staging: 0 })
  })

  it('never fetches generated destinations while rendering Markdown and diagrams', async () => {
    const requests: string[] = []
    page.on('request', request => requests.push(request.url()))
    await page.evaluate(({ graph }) => window.__generatedContentTest.mount('chat', `[Read](https://example.invalid/notes)\n\n\`\`\`mermaid\n${graph}\n\`\`\``), { graph })
    await expect.poll(() => page.locator('#host svg[role="img"]').count()).toBe(1)
    expect(await page.locator('#host a').getAttribute('href')).toBe('https://example.invalid/notes')
    expect(requests).toEqual([])
    expect(networkRequests).toEqual([])
    await page.evaluate(() => window.__generatedContentTest.unmount())
  })
})
