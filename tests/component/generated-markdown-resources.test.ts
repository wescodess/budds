import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import TextBlock from '~/components/learn/TextBlock.vue'
import Message from '~/components/chat/Message.vue'
import { GENERATED_MARKDOWN_LIMITS, citationSegments, generatedTextFallback, parseGeneratedMarkdown, withinGeneratedParseBudget } from '~/utils/generated-markdown'
import { normalizeAssistantCitations } from '~/utils/normalize-assistant-citations'
import { createSources } from '../support/factories/chat.factory'
import { costlySyntaxClasses, fill, parserStallSources, permittedSourceLength } from '../support/generated-markdown-resources'

const parser = vi.hoisted(() => ({ calls: vi.fn(), forbidden: false }))
vi.mock('@nuxtjs/mdc/runtime', async (original) => {
  const actual = await original<typeof import('@nuxtjs/mdc/runtime')>()
  return { ...actual, parseMarkdown: (...args: Parameters<typeof actual.parseMarkdown>) => {
    parser.calls()
    // A gate regression must fail its assertion, never stall the worker inside the parser.
    if (parser.forbidden) throw new Error('parser reached')
    return actual.parseMarkdown(...args)
  } }
})

const limits = GENERATED_MARKDOWN_LIMITS
const context = { applicationOrigins: ['https://budds-ci.invalid'], sourceCount: 2 }
const denseSource = '{}'.repeat(30_000)
const literalText = (segments: ReturnType<typeof generatedTextFallback>) => segments.map(segment => segment.type === 'text' ? segment.value : `[${segment.index}]`).join('')
const body = (result: Awaited<ReturnType<typeof parseGeneratedMarkdown>>) => JSON.stringify(result.body)

async function countReads<T>(work: () => T | Promise<T>) {
  const original = String.prototype.charCodeAt
  let reads = 0
  String.prototype.charCodeAt = function (this: string, index: number) { reads++; return original.call(this, index) }
  try { return { result: await work(), reads } } finally { String.prototype.charCodeAt = original }
}

function largestAdmittedLength(build: (length: number) => string) {
  let admitted = 0
  let refused = permittedSourceLength
  while (refused - admitted > Math.max(8, admitted / 100)) {
    const middle = Math.floor((admitted + refused) / 2)
    if (withinGeneratedParseBudget(build(middle))) admitted = middle
    else refused = middle
  }
  return admitted
}

afterEach(() => { vi.restoreAllMocks(); parser.calls.mockClear(); parser.forbidden = false })

describe('generated Markdown parser admission', () => {
  it.each(costlySyntaxClasses)('refuses %s at the permitted source length before MDC', async (_name, build) => {
    parser.forbidden = true
    const source = build(permittedSourceLength)
    expect(source.length).toBeLessThanOrEqual(limits.source)
    const result = await parseGeneratedMarkdown(source, context)
    expect(parser.calls).not.toHaveBeenCalled()
    expect(result.body).toBeNull()
    expect(result.tailRefused).toBe(false)
    expect(literalText(result.fallback)).toBe(source)
    expect(normalizeAssistantCitations(source)).toBe(source)
  })

  it.each(costlySyntaxClasses)('keeps parser reads and elapsed work bounded for %s at its admitted boundary', async (_name, build) => {
    const length = largestAdmittedLength(build)
    expect(length).toBeGreaterThan(0)
    const source = build(length)
    expect(withinGeneratedParseBudget(source)).toBe(true)
    const counted = await countReads(() => parseGeneratedMarkdown(source, context))
    expect(counted.reads).toBeLessThanOrEqual(limits.syntaxWork)
    expect(parser.calls).toHaveBeenCalledOnce()
    // Supplementary only: catches a return to multi-second parses, not a responsiveness guarantee.
    const started = performance.now()
    await parseGeneratedMarkdown(source, context)
    expect(performance.now() - started).toBeLessThan(5_000)
  }, 30_000)

  it.each(costlySyntaxClasses)('keeps over-limit %s literal without scanning for citations', async (_name, build) => {
    parser.forbidden = true
    const source = `${build(limits.source)}${'x'.repeat(limits.source + 1)}`
    const counted = await countReads(() => parseGeneratedMarkdown(source, context))
    expect(parser.calls).not.toHaveBeenCalled()
    expect(counted.result.fallback).toEqual([{ type: 'text', value: source }])
    expect(counted.reads).toBe(0)
  })

  it.each(parserStallSources)('never hands the parser a %s', async (_name, source) => {
    parser.forbidden = true
    const result = await parseGeneratedMarkdown(source, context)
    expect(parser.calls).not.toHaveBeenCalled()
    expect(result.body).toBeNull()
    expect(literalText(result.fallback)).toBe(source)
    expect(normalizeAssistantCitations(source)).toBe(source)
  })

  it.each([
    ['closed nested labels before a closing line', '[a[b]\n] tail'],
    ['a single open label', '[a\n] tail'],
    ['labels split by a blank line', '[a[b\n\n] tail'],
    ['bullets reset open labels', '- [a[b\n- ] tail'],
    ['an escaped opener', '[a\\[b\n] tail'],
    ['a colon word without a label', 'Note: [a[b]\n\nTail'],
    ['a component without data', '::a\nb\n::\n\nTail'],
    ['a component after a blank line before a rule', '::a\n\n---\n::\n\nTail'],
  ])('lets %s reach the parser', async (_name, source) => {
    const result = await parseGeneratedMarkdown(source, context)
    expect(parser.calls).toHaveBeenCalledOnce()
    expect(result.body).not.toBeNull()
  })

  it.each([
    ['prose with punctuation', fill('It\'s a well-known, widely-used idea (see notes): plain; simple? Yes. ', limits.source), 'p'],
    ['prose with formatting and citations', '# Topic\n\n**Lesson** [1]\n\n'.padEnd(limits.source, 'x'), 'citation'],
    ['one long link', `[Read](https://example.invalid/${'a'.repeat(2_000)})`, 'a'],
    ['a dense code fence', fill('const a = [b[0], c_d, e!, f*g, h<i>, `j`, ~k, &l, {m}, \\n]\n', limits.source - 8, '```ts\n', '```'), 'pre'],
    ['a tilde fence with backticks in its info', fill('[]*_{}<>!&\n', 20_000, '~~~`x`\n', '~~~'), 'pre'],
    ['an unclosed fence', fill('[]*_{}<>~!&\n', 20_000, 'Intro **a**\n\n```\n'), 'pre'],
    ['several fences among prose', fill('Example **now**:\n\n```python\nprint({"a": [1, 2]}, a_b, "<ok>")\n```\n\n', 3_000), 'pre'],
    ['a bulleted lesson', fill('- **Point**: a sentence that explains the idea in full, with a citation [1].\n', 4_000), 'ul'],
    ['an ordered lesson', Array.from({ length: 30 }, (_, index) => `${index + 1}. **Step**: do this, then check [1].`).join('\n'), 'ol'],
    ['a nested list', Array.from({ length: 6 }, (_, level) => `${'  '.repeat(level)}- **item ${level}**`).join('\n'), 'ul'],
    ['a table', `| Term | Meaning |\n|---|---|\n${fill('| One | **First** `a[0]` [1] |\n', 900)}`, 'table'],
    ['a long quote', fill('> Quoted sentence that continues at length.\n', 8_000), 'blockquote'],
    ['indented code', `Intro\n\n${fill('    [a] {b} *c* _d_\n', 1_000)}`, 'pre'],
    ['bare links', fill('See https://example.invalid/a-b_c.d?e=f&g=h now.\n\n', 2_000), 'a'],
    ['math-heavy paragraphs', fill('The sum $\\sum_{i=1}^{n} x_{i}$ and $\\frac{a}{b}$ hold for **x_i** > 0 [1].\n\n', 3_000), 'strong'],
    ['unspaced script text', `${fill('光合作用是植物的过程,', 1_000)} **x**`, 'strong'],
    ['carriage return line endings', 'Good **a**\r\n\r\n- One\r\n- Two [1]\r\n', 'ul'],
    ['JSON in a list-item fence', '1. Data:\n   ```json\n   [\n     [1, 2],\n     [3, 4]\n   ]\n   ```\n2. Next **step**', 'ol'],
  ])('keeps %s rich', async (_name, source, tag) => {
    expect(source.length).toBeLessThanOrEqual(limits.source)
    const result = await parseGeneratedMarkdown(source, context)
    expect(parser.calls).toHaveBeenCalledOnce()
    expect(result.body).not.toBeNull()
    expect(body(result)).toContain(`"tag":"${tag}"`)
    expect(result.fallback).toEqual([])
  })

  // Small sizes run first: a backtracking regression fails on them instead of stalling the worker on larger ones.
  it.each<[string, (length: number) => string]>([
    ['footnote labels of backslashes', length => `[^${'\\'.repeat(length)} x`],
    ['footnote labels of words', length => `[^${'a'.repeat(length)} x`],
    ['repeated footnote labels', length => `${'[^a]:'.repeat(length / 5)} x`],
    ['whitespace before a failed marker', length => `${' '.repeat(length)}x`],
    ['digits before a failed marker', length => `${'1'.repeat(length)}x`],
    ['dashes after a component', length => `::a\n${'-'.repeat(length)}x`],
    ['spaces after a component', length => `::a\n${' -'.repeat(length / 2)}x`],
    ['backticks before an info string', length => `${'`'.repeat(length)} \`x`],
    ['fence-like closing lines', length => `\`\`\`\n${'`'.repeat(length)}x`],
    ['repeated link triggers', length => 'www.'.repeat(length / 4)],
    ['a line of list markers', length => '- '.repeat(length / 2)],
  ])('reads %s in linear time', (_name, build) => {
    for (const length of [30, 40, 3_000, permittedSourceLength]) {
      const source = build(length)
      const started = performance.now()
      withinGeneratedParseBudget(source)
      expect(performance.now() - started, String(length)).toBeLessThan(500)
    }
  })

  it('bounds document lines at the limit', () => {
    expect(withinGeneratedParseBudget('x\n'.repeat(limits.lines - 1))).toBe(true)
    expect(withinGeneratedParseBudget('x\n'.repeat(limits.lines))).toBe(false)
  })

  it('bounds block syntax at the limit', () => {
    expect(withinGeneratedParseBudget('- x\n'.repeat(limits.blockSyntax))).toBe(true)
    expect(withinGeneratedParseBudget('- x\n'.repeat(limits.blockSyntax + 1))).toBe(false)
    expect(withinGeneratedParseBudget('x|y\n'.repeat(limits.blockSyntax))).toBe(true)
    expect(withinGeneratedParseBudget('x|y\n'.repeat(limits.blockSyntax + 1))).toBe(false)
    expect(withinGeneratedParseBudget('x@y z\n'.repeat(limits.blockSyntax + 1))).toBe(false)
    expect(withinGeneratedParseBudget('www.x z\n'.repeat(limits.blockSyntax + 1))).toBe(false)
    expect(withinGeneratedParseBudget('s://x z\n'.repeat(limits.blockSyntax + 1))).toBe(false)
  })

  it('charges inline delimiters by the length of their own inline context', () => {
    const line = (count: number) => `x ${'_ '.repeat(count)}`
    const work = (count: number) => (line(count).length + 1) * count + count
    let count = 1
    while (work(count + 1) <= limits.syntaxWork) count++
    expect(withinGeneratedParseBudget(line(count))).toBe(true)
    expect(withinGeneratedParseBudget(line(count + 1))).toBe(false)
    const paragraph = `${line(100)}\n\n`
    expect(withinGeneratedParseBudget(fill(paragraph, 40 * paragraph.length))).toBe(true)
    expect(withinGeneratedParseBudget(paragraph.repeat(40).replace(/\n\n/g, '\n'))).toBe(false)
    expect(withinGeneratedParseBudget(`- ${line(1_500)}\n- ${line(1_500)}\n`)).toBe(false)
    expect(withinGeneratedParseBudget(`- ${line(900)}\n- ${line(900)}\n`)).toBe(true)
  })

  it('charges an unbroken run by its length and punctuation', () => {
    expect(withinGeneratedParseBudget(`x ${'.'.repeat(2_000)}`)).toBe(true)
    expect(withinGeneratedParseBudget(`x ${'.'.repeat(2_001)}`)).toBe(false)
    expect(withinGeneratedParseBudget('. '.repeat(limits.source / 2))).toBe(true)
    expect(withinGeneratedParseBudget(`${'x'.repeat(limits.source)}.`)).toBe(true)
  })

  it('reads a colon as syntax only where MDC does', () => {
    expect(withinGeneratedParseBudget(fill('Note: x ', limits.source))).toBe(true)
    expect(withinGeneratedParseBudget(fill('x :y ', limits.source))).toBe(false)
  })

  it('charges container depth across every line, including lazy ones', () => {
    const quote = (lines: number) => `${'> '.repeat(limits.containers)}x\n${'y\n'.repeat(lines)}`
    expect(withinGeneratedParseBudget(quote(486))).toBe(true)
    expect(withinGeneratedParseBudget(quote(487))).toBe(false)
    expect(withinGeneratedParseBudget(`${'> '.repeat(limits.containers + 1)}x`)).toBe(false)
    expect(withinGeneratedParseBudget(`${'1. '.repeat(limits.containers + 1)}x`)).toBe(false)
    expect(withinGeneratedParseBudget(`${' '.repeat(40)}- x\n${'y\n'.repeat(4_000)}`)).toBe(false)
    expect(withinGeneratedParseBudget(`${' '.repeat(limits.containers * 2)}x`)).toBe(true)
    expect(withinGeneratedParseBudget(`${' '.repeat(limits.containers * 2 + 1)}x`)).toBe(false)
    expect(withinGeneratedParseBudget(`${'[^a]: '.repeat(limits.containers + 1)}x`)).toBe(false)
  })

  it('charges component fences against the document they tokenize again', () => {
    expect(withinGeneratedParseBudget('::a\n'.repeat(limits.components))).toBe(true)
    expect(withinGeneratedParseBudget('::a\n'.repeat(limits.components + 1))).toBe(false)
    expect(withinGeneratedParseBudget(`> ${'::a\n> '.repeat(limits.components + 1)}`)).toBe(false)
    expect(withinGeneratedParseBudget(`${'::a\n'.repeat(limits.components)}\n${'x '.repeat(30_000)}`)).toBe(false)
    expect(withinGeneratedParseBudget(`${'::a\n'.repeat(8)}\n${'x '.repeat(30_000)}`)).toBe(true)
  })
})

describe('generated link validation', () => {
  it('validates a referenced destination once, however often it is used', async () => {
    const destination = `https://example.invalid/${'x'.repeat(50_000)}`
    const source = `[r]: ${destination}\n\n${'[a][r]\n\n'.repeat(100)}Tail [b](https://example.invalid/other)`
    const decodes = vi.spyOn(globalThis, 'decodeURIComponent')
    const result = await parseGeneratedMarkdown(source, context)
    expect(parser.calls).toHaveBeenCalledOnce()
    expect(decodes).toHaveBeenCalledTimes(2)
    expect(body(result).match(/"tag":"a"/g)).toHaveLength(101)
  })
})

describe('fenced code exemption', () => {
  const dense = '[]*_{}<>~!&\n'.repeat(2_000)
  const denseBody = dense.slice(0, -1)

  it.each([
    ['at the document start', ''],
    ['after a paragraph', 'Intro\n'],
    ['after a list', '- a\n'],
    ['after a quote', '> a\n'],
    ['after a table', '| a |\n|---|\n| b |\n'],
    ['after a list-item fence', '- ```\n  a\n'],
    ['after a closed fence', '```\na\n```\n'],
    ['after a blank-line-closed paragraph', 'Intro\n\n'],
    ['with an info string', ''],
  ])('admits column-zero code %s, where the parser agrees it is code', async (name, prefix) => {
    const source = `${prefix}\`\`\`${name.includes('info') ? 'ts' : ''}\n${dense}\`\`\`\n\nAfter **x**`
    expect(withinGeneratedParseBudget(source)).toBe(true)
    const result = await parseGeneratedMarkdown(source, context)
    expect(parser.calls).toHaveBeenCalledOnce()
    const code = JSON.stringify(denseBody)
    expect(body(result)).toContain(code.slice(1, -1))
    expect(body(result)).toContain('"tag":"strong"')
  }, 30_000)

  it.each([
    ['an indented fence the parser closes with the next one', '    ```\n```\n'],
    ['a shallow indented fence', '  ```\n```\n'],
    ['a tab-indented fence', '\t```\n```\n'],
    ['an HTML block', '<div>\n```\n\n'],
    ['an HTML comment', '<!--\n```\n-->\n\n'],
    ['a component', '::a\n```\n::\n'],
    ['a component in a quote', '> ::a\n```\n::\n\n'],
    ['a block-level label', ':a[b\n```\n]\n'],
    ['a backtick info string with a backtick', '``` `x`\n'],
    ['a two-tick line', '``\n'],
    ['a fence closed by a bare carriage return', '```\nb\r```\r'],
    ['a closed backtick fence', '```\nb\n```\n'],
    ['a closed tilde fence', '~~~\nb\n~~~\n'],
    ['an indented closing fence', '```\nb\n   ```\n'],
  ])('charges content after %s', (_name, prefix) => {
    expect(withinGeneratedParseBudget(`${prefix}${dense}`)).toBe(false)
  })

  it('keeps a fence open across other fence kinds and shorter runs', () => {
    expect(withinGeneratedParseBudget(`~~~\n\`\`\`\n${dense}~~~\nTail`)).toBe(true)
    expect(withinGeneratedParseBudget(`\`\`\`\`\n\`\`\`\n${dense}\`\`\`\`\nTail`)).toBe(true)
    expect(withinGeneratedParseBudget(`\`\`\`\n\`\`\` x\n${dense}\`\`\`\nTail`)).toBe(true)
    expect(withinGeneratedParseBudget(`\`\`\`\n    \`\`\`\n${dense}\`\`\`\nTail`)).toBe(true)
    expect(withinGeneratedParseBudget(`\`\`\`\n\t\`\`\`\n${dense}\`\`\`\nTail`)).toBe(true)
  })
})

describe('generated Markdown resource bounds at the sinks', () => {
  it('keeps the full source allowance for ordinary prose with formatting and citations', async () => {
    const source = '# Topic\n\n**Lesson** [1]\n\n'.padEnd(limits.source, 'x')
    const result = await parseGeneratedMarkdown(source, context)
    expect(parser.calls).toHaveBeenCalledOnce()
    expect(result.body).not.toBeNull()
    expect(body(result)).toContain('"tag":"strong"')
    expect(body(result)).toContain('"tag":"citation"')
    // Successful rich output does not also scan the complete document for fallback.
    expect(result.fallback).toEqual([])
  })

  it.each([TextBlock, Message])('falls back through the real sink without invoking MDC, then recovers', async (component) => {
    const content = `${denseSource}\nFact [1]`
    const wrapper = await mountSuspended(component, { props: { role: 'assistant', content, sources: createSources(1), animate: false, streaming: true } })
    try {
      expect(parser.calls).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain(denseSource)
      expect(wrapper.find('pre, strong, [data-generated-refused]').exists()).toBe(false)
      if (component === Message) expect(wrapper.findAll('button[aria-label^="Source 1"]')).toHaveLength(1)
      await wrapper.setProps({ content: 'Recovered **lesson**', streaming: false })
      await vi.waitFor(() => expect(wrapper.find('strong').text()).toBe('lesson'))
    } finally { wrapper.unmount() }
  })

  const sinkClasses = [
    ...costlySyntaxClasses.filter(([name]) => ['plus run', 'dotted words', 'comma run after a domain', 'escaped openers', 'bullets', 'ordered items', 'headings', 'lazy lines in deep quotes', 'mixed grammar'].includes(name)).map(([name, build]) => [name, build(permittedSourceLength)] as const),
    ...parserStallSources,
  ]

  describe.each([['course', TextBlock], ['chat', Message]] as const)('%s sink', (_surface, component) => {
    it.each(sinkClasses)('shows %s as complete escaped text without MDC', async (_name, content) => {
      parser.forbidden = true
      const wrapper = await mountSuspended(component, { props: { role: 'assistant', content, sources: createSources(1), animate: false } })
      try {
        expect(parser.calls).not.toHaveBeenCalled()
        expect(wrapper.element.textContent?.includes(content)).toBe(true)
        expect(wrapper.find('pre, strong, blockquote, ul, ol, table, a, [data-generated-refused]').exists()).toBe(false)
      } finally { wrapper.unmount() }
    })
  })

  it('rejects successive over-budget chat chunks and stream completion before MDC', async () => {
    const prefix = 'Initial **lesson**\n\n'
    const wrapper = await mountSuspended(Message, { props: { role: 'assistant', content: prefix, sources: createSources(1), animate: false, streaming: true } })
    try {
      expect(wrapper.find('strong').text()).toBe('lesson')
      parser.calls.mockClear()
      for (const length of [4_000, 16_000, 60_000]) {
        const content = prefix + denseSource.slice(0, length)
        await wrapper.setProps({ content })
        await vi.waitFor(() => expect(wrapper.find('strong').exists()).toBe(false))
        expect(wrapper.text()).toContain(content)
      }
      await wrapper.setProps({ streaming: false })
      expect(parser.calls).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="streaming-cursor"]').exists()).toBe(false)
    } finally { wrapper.unmount() }
  })

  it.each(sinkClasses.slice(0, 4))('crosses the parser limit mid-stream for %s and recovers', async (_name, content) => {
    const prefix = 'Initial **lesson**\n\n'
    const wrapper = await mountSuspended(Message, { props: { role: 'assistant', content: prefix, sources: createSources(1), animate: false, streaming: true } })
    try {
      await vi.waitFor(() => expect(wrapper.find('strong').text()).toBe('lesson'))
      parser.calls.mockClear()
      parser.forbidden = true
      await wrapper.setProps({ content: `${prefix}${content}` })
      await vi.waitFor(() => expect(wrapper.find('strong').exists()).toBe(false))
      await wrapper.setProps({ streaming: false })
      expect(parser.calls).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="streaming-cursor"]').exists()).toBe(false)
      parser.forbidden = false
      await wrapper.setProps({ content: 'Recovered **lesson**' })
      await vi.waitFor(() => expect(wrapper.find('strong').text()).toBe('lesson'))
    } finally { wrapper.unmount() }
  })

  it('stops parsing as soon as a stream completes a stalling label', async () => {
    const wrapper = await mountSuspended(Message, { props: { role: 'assistant', content: 'Intro **a**\n\n[b[c', sources: createSources(1), animate: false, streaming: true } })
    try {
      await vi.waitFor(() => expect(wrapper.find('strong').text()).toBe('a'))
      parser.calls.mockClear()
      parser.forbidden = true
      await wrapper.setProps({ content: 'Intro **a**\n\n[b[c\n]' })
      await vi.waitFor(() => expect(wrapper.element.textContent).toContain('[b[c\n]'))
      expect(wrapper.find('strong').exists()).toBe(false)
      await wrapper.setProps({ streaming: false })
      expect(parser.calls).not.toHaveBeenCalled()
    } finally { wrapper.unmount() }
  })
})

describe('fallback scanner work', () => {
  it.each([2_000, 8_000, 29_980])('indexes nested delimiters with linear reads and slices at depth %i', (depth) => {
    const source = `${'['.repeat(depth)}Fact [1]${']'.repeat(depth)} tail [2]`
    const original = String.prototype.slice
    let sliced = 0
    const reads = vi.spyOn(String.prototype, 'charCodeAt')
    vi.spyOn(String.prototype, 'slice').mockImplementation(function (this: string, start, end) {
      const result = original.call(this, start, end)
      if (this === source) sliced += result.length
      return result
    })
    const segments = generatedTextFallback(source, 2)
    const readCount = reads.mock.calls.length
    vi.restoreAllMocks()
    expect(segments.filter(segment => segment.type === 'citation')).toEqual([{ type: 'citation', index: 1 }, { type: 'citation', index: 2 }])
    expect(literalText(segments)).toBe(source)
    expect(readCount).toBe(source.length * 2)
    expect(sliced).toBeLessThan(source.length * 4)
  })

  it.each([2_000, 4_000, 8_000, 16_000, 60_000])('reads whitespace after a shared label end once at %i source units', async (length) => {
    const source = `${'\\['.repeat(length / 4)}]${' '.repeat(length / 2 - 1)}`
    const tests = vi.spyOn(RegExp.prototype, 'test')
    const reads = await countReads(() => generatedTextFallback(source, 2))
    const regularExpressionTests = tests.mock.calls.length
    vi.restoreAllMocks()
    expect(literalText(reads.result)).toBe(source)
    expect(regularExpressionTests).toBeLessThanOrEqual(8)
    expect(reads.reads).toBeLessThanOrEqual(source.length * 2)
    expect(normalizeAssistantCitations(source)).toBe(source)
  })

  it.each<[string, string]>([
    ['escaped openers sharing whitespace', `${'\\['.repeat(15_000)}]${' '.repeat(29_000)}x`],
    ['escaped openers sharing a line-ending run', `${'\\['.repeat(15_000)}]${'\n'.repeat(29_000)}x`],
    ['escaped openers before a reference', `${'\\['.repeat(14_000)}]${' '.repeat(28_000)}[r]\n\n[r]: https://example.invalid`],
    ['spaced openers sharing a closer', `${'[ '.repeat(20_000)}${']'.repeat(19_000)}`],
    ['unmatched openers', '['.repeat(60_000)],
    ['unmatched parentheses', '('.repeat(60_000)],
    ['unmatched braces', '{'.repeat(60_000)],
    ['unmatched angle brackets', '<a '.repeat(20_000)],
    ['unclosed code spans of growing length', Array.from({ length: 340 }, (_, index) => `${'`'.repeat(index + 1)}a`).join('')],
    ['paired code spans', '`a` '.repeat(15_000)],
    ['unclosed fences', '```\n'.repeat(15_000)],
    ['alternating fence kinds', '```\n~~~\n'.repeat(7_500)],
    ['indented lines', '    a\n'.repeat(10_000)],
    ['quoted lines', '> a\n'.repeat(15_000)],
    ['deep quote prefixes', '>'.repeat(60_000)],
    ['reference definitions', '[a]: b\n'.repeat(8_000)],
    ['colon runs', `${':'.repeat(30_000)} ${':'.repeat(29_000)}`],
    ['line-ending frontmatter', `---${'\n'.repeat(59_000)}`],
    ['frontmatter-like lines', '--- x\n'.repeat(10_000)],
  ])('stays linear on %s', async (_name, source) => {
    expect(source.length).toBeLessThanOrEqual(limits.source)
    const started = performance.now()
    const reads = await countReads(() => generatedTextFallback(source, 2))
    // Supplementary only: a return to quadratic scanning takes seconds at this size.
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(literalText(reads.result)).toBe(source)
    expect(reads.reads).toBeLessThanOrEqual(source.length * 2)
    expect(normalizeAssistantCitations(source)).toBe(source)
  })

  it('bounds normalization of overlapping reference labels and preserves the complete literal source', () => {
    const source = `${'['.repeat(8_000)}Source 1${']'.repeat(8_000)}.\n\n[r]: https://example.invalid\nTail (Source 2)`
    const original = String.prototype.slice
    let sliced = 0
    vi.spyOn(String.prototype, 'slice').mockImplementation(function (this: string, start, end) {
      const result = original.call(this, start, end)
      if (this === source) sliced += result.length
      return result
    })
    const segments = generatedTextFallback(source, 2)
    vi.restoreAllMocks()
    expect(segments).toEqual([{ type: 'text', value: source }])
    expect(sliced).toBeLessThan(source.length * 6)
    expect(normalizeAssistantCitations(source)).toBe(source)
  })

  it.each([
    '[outer [label [1]](https://example.invalid/[2])] Tail [2]',
    '[label [1]](https://example.invalid/(nested)/[2]) Tail [2]',
    '[label [1]][ref]\n\n[ref]: https://example.invalid/[1]\nTail [2]',
    '[label [1]] [ref]\n\n[ref]: https://example.invalid\nTail [2]',
    '[label [1]]\n\n  [ref]\n\n[ref]: https://example.invalid\nTail [2]',
    '`[1]` <b>[1]</b>\nTail [2]',
    '``[1] ` [1]`` Tail [2]',
    '[label \\] [1]](https://example.invalid) Tail [2]',
  ])('protects code, markup and nested or escaped link syntax in %j', (source) => {
    const segments = generatedTextFallback(source, 2)
    expect(segments.filter(segment => segment.type === 'citation')).toEqual([{ type: 'citation', index: 2 }])
    expect(literalText(segments)).toBe(source)
  })

  it.each(['[label [1]', '[label [1]](unfinished [2]', '`unfinished [1]', '```text\n[1]'])('keeps unmatched syntax literal in %j', (source) => {
    expect(generatedTextFallback(source, 2)).toEqual([{ type: 'text', value: source }])
    expect(normalizeAssistantCitations(source)).toBe(source)
  })
})

describe('citation marker scanning', () => {
  // The historical expression, kept only as the reference for accepted marker forms.
  const reference = /\[(\d+)\]|\[\s*Source\s+(\d+)(?:\s*:\s*[^\]\n]*)?\s*\]|\(\s*Sources?\s+(\d+)\s*\)|\bSource\s+(\d+)\b/gi
  function referenceSegments(value: string, sourceCount: number) {
    const result: ReturnType<typeof citationSegments> = []
    let offset = 0
    for (const match of value.matchAll(reference)) {
      const numeral = match[1] ?? match[2] ?? match[3] ?? match[4] ?? ''
      if (!/^[1-9]\d*$/.test(numeral)) continue
      const index = Number(numeral)
      if (!Number.isSafeInteger(index) || index < 1 || index > sourceCount) continue
      if (match.index > offset) result.push({ type: 'text', value: value.slice(offset, match.index) })
      result.push({ type: 'citation', index })
      offset = match.index + match[0].length
    }
    if (offset < value.length) result.push({ type: 'text', value: value.slice(offset) })
    return result
  }

  it('matches the accepted marker forms across generated combinations', () => {
    const tokens = ['[', ']', '(', ')', ':', ' ', '  ', '\n', '\n\n', '\t', '\u00A0', '\u2028', '\uFEFF', '\r', 'Source', 'source', 'SOURCE', 'Sources', 'S', 'ource', '0', '1', '2', '3', '01', '12', '999', '99999999999999999999', 'a', 'x_', '_', '-', '.', 'é', '光', '[1]', '[2]', '[0]', '[Source 1]', '[Source 2: notes.pdf]', '(Source 1)', '(Sources 2)', 'Source 1', 'source 2', ': ', ' :']
    let seed = 468
    const next = (bound: number) => { seed = (seed * 1_103_515_245 + 12_345) & 0x7FFFFFFF; return seed % bound }
    for (let run = 0; run < 20_000; run++) {
      const value = Array.from({ length: 1 + next(14) }, () => tokens[next(tokens.length)]).join('')
      for (const count of [0, 2, Number.MAX_SAFE_INTEGER]) expect(citationSegments(value, count), JSON.stringify(value)).toEqual(referenceSegments(value, count))
    }
  })

  // Small sizes run first: a cubic regression fails on them in seconds instead of stalling the worker on larger ones.
  it.each<[string, (length: number) => string, number]>([
    ['a whitespace-filled open label', length => `[Source 1:${' '.repeat(length)}x`, 1],
    ['a whitespace-filled label ending at a line break', length => `[Source 1: y${' '.repeat(length)}\nx]`, 1],
    ['a label of mixed whitespace', length => `[Source 1:${' \t\n'.repeat(length / 3)}x`, 1],
    ['repeated open labels', length => '[Source 1: a '.repeat(length / 13), 0],
    ['open labels sharing one line end', length => `${'[Source 1: a '.repeat(length / 26)}${'\n'.repeat(length / 2)}x]`, 0],
    ['whitespace before a source number', length => `(Source${' '.repeat(length)}1`, 1],
    ['whitespace after a source number', length => `(Source 1${' '.repeat(length)}`, 1],
    ['a long numeral', length => `[Source ${'1'.repeat(length)}:`, 0],
  ])('stays linear on %s', (_name, build, single) => {
    for (const length of [3_000, 60_000]) {
      const value = build(length)
      const candidates = value.match(/[[(]|source/gi)?.length ?? 0
      const labelEnds = value.match(/[\]\n]/g)?.length ?? 0
      const exec = vi.spyOn(RegExp.prototype, 'exec')
      const started = performance.now()
      const segments = citationSegments(value, Number.MAX_SAFE_INTEGER)
      const elapsed = performance.now() - started
      const execCalls = exec.mock.calls.length
      const labelScans = exec.mock.contexts.filter(pattern => pattern.source === '[\\]\\n]').length
      vi.restoreAllMocks()
      expect(elapsed).toBeLessThan(1_000)
      expect(segments.filter(segment => segment.type === 'citation').length).toBeGreaterThanOrEqual(single)
      expect(execCalls).toBeLessThanOrEqual(8 * candidates + 8)
      expect(labelScans).toBeLessThanOrEqual(labelEnds + 2)
    }
  })

  const whitespaceLabel = `[Source 1:${' '.repeat(3_000)}x`
  it.each([TextBlock, Message])('renders a whitespace-filled label through the real sink', async (component) => {
    const started = performance.now()
    const wrapper = await mountSuspended(component, { props: { role: 'assistant', content: whitespaceLabel, sources: createSources(1), animate: false } })
    try {
      expect(performance.now() - started).toBeLessThan(5_000)
      expect(parser.calls).toHaveBeenCalledOnce()
      expect(wrapper.element.textContent).toContain('x')
      if (component === Message) expect(wrapper.findAll('button[aria-label^="Source 1"]')).toHaveLength(1)
    } finally { wrapper.unmount() }
  })

  it('normalizes server citations without rescanning a whitespace-filled label', () => {
    const started = performance.now()
    expect(normalizeAssistantCitations(`Fact (Source 2) ${whitespaceLabel}`)).toBe(`Fact [2] ${whitespaceLabel}`)
    expect(normalizeAssistantCitations(`Fact (Source 2) [Source 1:${' '.repeat(3_000)}\nx]`)).toBe('Fact [2] [1]')
    expect(performance.now() - started).toBeLessThan(1_000)
  })
})
