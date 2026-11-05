import { describe, expect, it } from 'vitest'
import type { MDCElement, MDCNode, MDCRoot } from '@nuxtjs/mdc'
import { GENERATED_MARKDOWN_LIMITS, generatedTextFallback, parseGeneratedMarkdown, validateGeneratedLink } from '~/utils/generated-markdown'
import { MERMAID_LIMITS, validatePassiveMermaid } from '~/utils/passive-mermaid'
import { validateCompatibilityMermaid } from '~/utils/compatibility-mermaid'
import { compatibleDiagrams, disguisedRefusals, refusedDiagrams } from '../support/generated-content-fixtures'
import { normalizeAssistantCitations } from '~/utils/normalize-assistant-citations'

const context = { applicationOrigins: ['https://budds-ci.invalid'], sourceCount: 2 }

describe('passive generated content policy', () => {
  it('rebuilds only approved fields, with no generated data or heading IDs', async () => {
    const result = await parseGeneratedMarkdown('# Topic\n\nText **bold** [1]', context)
    expect(result.body).toEqual({ type: 'root', children: [
      { type: 'element', tag: 'h2', props: { __ignoreMap: '' }, children: [{ type: 'text', value: 'Topic' }] },
      { type: 'element', tag: 'p', props: { __ignoreMap: '' }, children: [
        { type: 'text', value: 'Text ' },
        { type: 'element', tag: 'strong', props: { __ignoreMap: '' }, children: [{ type: 'text', value: 'bold' }] },
        { type: 'text', value: ' ' },
        { type: 'element', tag: 'citation', props: { index: 1 }, children: [] },
      ] },
    ] })
  })

  it('keeps fallback code, links, metadata, authored tags and unknown markers literal', () => {
    const content = 'Fact [1] [0] [3] [9007199254740992]\n`[1]` [Label [1]](https://example.invalid/[2])\n```text\n[1]\n```\n:citation[1]\nEnd (Source 2)'
    expect(generatedTextFallback(content, 2).filter(segment => segment.type === 'citation')).toEqual([
      { type: 'citation', index: 1 }, { type: 'citation', index: 2 },
    ])
  })

  it('keeps code and link text literal when transport normalizes historical citations', () => {
    const source = 'Fact (Source 1)\n`Source 2`\n```text\n[Source 1]\n```\n[Source 2](https://example.invalid/Source_1)'
    expect(normalizeAssistantCitations(source)).toBe('Fact [1]\n`Source 2`\n```text\n[Source 1]\n```\n[Source 2](https://example.invalid/Source_1)')
  })

  it('keeps multiline code spans and link labels literal on parse failure', () => {
    const source = 'Fact [1]\n`<sample>\n[1]`\n[label\n[1]](https://example.invalid)\nTail [2]'
    expect(generatedTextFallback(source, 2).filter(segment => segment.type === 'citation')).toEqual([
      { type: 'citation', index: 1 }, { type: 'citation', index: 2 },
    ])
  })

  it('excludes indented and nested code, bare URLs and reference links in fallback and transport', () => {
    const literal = '    Source 1 [1]\n\t[1]\n\n> ~~~text\n> Source 1 [1]\n> ~~~\n\n[Source 1]\n[ref]\n\n[Source 2]\n\n[ref]: https://example.invalid\n[Source 2]: https://example.invalid\n\nhttps://example.invalid/[1]'
    const source = `Fact [1]\n\n${literal}\n\nTail (Source 2)`
    expect(generatedTextFallback(source, 2).filter(segment => segment.type === 'citation')).toEqual([
      { type: 'citation', index: 1 }, { type: 'citation', index: 2 },
    ])
    expect(normalizeAssistantCitations(source)).toBe(`Fact [1]\n\n${literal}\n\nTail [2]`)
  })

  it('preserves CRLF text and citations', async () => {
    const result = await parseGeneratedMarkdown('First\r\n\r\nFact [1]', context)
    expect(JSON.stringify(result.body)).toContain('"tag":"citation"')
  })

  it.each([
    'x'.repeat(GENERATED_MARKDOWN_LIMITS.source + 1),
    Array.from({ length: 260 }, (_, i) => `Paragraph ${i}`).join('\n\n'),
    'Source 1 '.repeat(300),
  ])('returns complete escaped text when a document-wide limit is exceeded', async (source) => {
    const result = await parseGeneratedMarkdown(source, context)
    expect(result.body).toBeNull()
    expect(result.fallback.map(segment => segment.type === 'text' ? segment.value : `[${segment.index}]`).join('')).toBe(source)
  })

  const refusedBlocks = (body: MDCRoot | null) => body!.children.filter(node => node.type === 'element' && 'data-generated-refused' in (node.props ?? {}))
  const literal = (node: MDCNode) => (node as MDCElement).children.map(child => child.type === 'text' ? child.value : '').join('')

  it.each([
    '---\ntitle: canary\n---\nBody',
    '--- \ntitle: canary\n---\nBody',
    '\uFEFF---\ntitle: canary\n---\nBody',
    '---',
  ])('keeps document-wide fallback for frontmatter %j', async (source) => {
    const result = await parseGeneratedMarkdown(source, context)
    expect(result.body).toBeNull()
    expect(result.tailRefused).toBe(false)
  })

  it('degrades only the third diagram and only over-deep blocks', async () => {
    const diagram = '```mermaid\ngraph TD\nA --> B\n```'
    const diagrams = await parseGeneratedMarkdown([diagram, diagram, diagram].join('\n\n'), context)
    expect(diagrams.body!.children.filter(node => node.type === 'element' && node.tag === 'pre')).toHaveLength(2)
    expect(refusedBlocks(diagrams.body).map(literal)).toEqual([diagram])
    const deep = `${'> '.repeat(30)}Deep content`
    const nested = await parseGeneratedMarkdown(`Good\n\n${deep}\n\nTail`, context)
    expect(refusedBlocks(nested.body).map(literal)).toEqual([deep])
    expect(nested.body!.children).toHaveLength(3)
  })

  it('does not let a refused block consume budgets later blocks need', async () => {
    const diagram = '```mermaid\ngraph TD\nA --> B\n```'
    const result = await parseGeneratedMarkdown(`> ${diagram.replaceAll('\n', '\n> ')}\n> <b>refused</b>\n\n${diagram}\n\n${diagram}`, context)
    expect(refusedBlocks(result.body)).toHaveLength(1)
    expect(result.body!.children.filter(node => node.type === 'element' && node.tag === 'pre')).toHaveLength(2)
  })

  it('slices refused blocks exactly across CRLF, tabs and a byte order mark', async () => {
    for (const [source, expected] of [
      ['Good\r\n\r\n<b>one</b>\r\n\r\nTail', '<b>one</b>'],
      ['\tcode\n\n<b>one</b>\n\nTail', '<b>one</b>'],
      ['\uFEFFGood\n\n<b>one</b>', '<b>one</b>'],
      ['- \titem\n\n<b>one</b>', '<b>one</b>'],
    ] as const) {
      expect(refusedBlocks((await parseGeneratedMarkdown(source, context)).body).map(literal)).toEqual([expected])
    }
  })

  it('never reaches the compiler with refused content, so a malformed destination stays block-scoped', async () => {
    const result = await parseGeneratedMarkdown('Good\n\nSee https://example.invalid/%C3 now\n\nTail', context)
    expect(refusedBlocks(result.body).map(literal)).toEqual(['See https://example.invalid/%C3 now'])
    expect(result.tailRefused).toBe(false)
  })

  it('reports a refused open block, including one refused through a trailing definition', async () => {
    expect((await parseGeneratedMarkdown('Good\n\nok :smile', context)).tailRefused).toBe(true)
    expect((await parseGeneratedMarkdown('Good :smile\n\nTail', context)).tailRefused).toBe(false)
    expect((await parseGeneratedMarkdown('Read [a][r] now\n\n[r]: https://example.invalid/%C3', context)).tailRefused).toBe(true)
    expect((await parseGeneratedMarkdown('Good\n\n[r]: https://example.invalid', context)).tailRefused).toBe(false)
  })

  describe('braces', () => {
    it.each([
      ['Set {1, 2, 3}', 'Set {1, 2, 3}'],
      ['$x_{i}$', '$x_{i}$'],
      ['x_{i}', 'x_{i}'],
      ['a_{i} b_{j}', 'a_{i} b_{j}'],
      ['$\\sum_{i=1}^{n} x_{i}$', '$\\sum_{i=1}^{n} x_{i}$'],
      ['x*{i}', 'x*{i}'],
      ['word{.canary}', 'word{.canary}'],
      ['{.canary}', '{.canary}'],
      ['\\{\\{ value \\}\\}', '{{ value }}'],
    ])('keeps %s as one plain text node', async (source, value) => {
      const result = await parseGeneratedMarkdown(source, { ...context, sourceCount: 0 })
      expect(result.body!.children).toEqual([{ type: 'element', tag: 'p', props: { __ignoreMap: '' }, children: [{ type: 'text', value }] }])
    })

    it.each([
      'x_{.canary}',
      'x_{#canary}',
      'x_{title="canary"}',
      'x_{:title="canary"}',
      '*{.canary}',
      'x_{i}{.canary}',
      '**x**{.canary}',
      '*x*{i}',
      '[x](https://example.invalid){@click="canary"}',
      '**x**{@click="canary"}',
      '`x`{@click="canary"}',
      '[1]{@click="canary"}',
      '[**x**{@click="canary"}](https://example.invalid)',
      '`x`{.canary}',
      '[x]{.canary}',
      '[x](https://example.invalid){.canary}',
      '{{ canary }}',
      'x_{{ canary }}',
      ':canary',
      ':canary{title="canary"}',
      '&lt;x_{i}',
      '- a\n  x_{i}\n  y_{.canary}',
    ])('refuses the attribute, binding or component form %j to literal text', async (source) => {
      const result = await parseGeneratedMarkdown(source, context)
      expect(result.body!.children).toHaveLength(1)
      expect(refusedBlocks(result.body).map(literal)).toEqual([source])
    })
  })

  it('preserves zero starts, column alignment and double-tilde deletion only', async () => {
    const list = (await parseGeneratedMarkdown('0. a\n1. b', context)).body!.children[0] as MDCElement
    expect(list.props!.start).toBe(0)
    const table = (await parseGeneratedMarkdown('| a | b | c | d |\n|:--|:-:|--:|---|\n| 1 | 2 | 3 | 4 |', context)).body!.children[0] as MDCElement
    const row = ((table.children[1] as MDCElement).children[0] as MDCElement).children as MDCElement[]
    expect(row.map(cell => cell.props!.class)).toEqual(['text-left!', 'text-center!', 'text-right!', undefined])
    expect(JSON.stringify((await parseGeneratedMarkdown('~~a~~', context)).body)).toContain('"tag":"del"')
    expect(JSON.stringify((await parseGeneratedMarkdown('H~2~O', context)).body)).not.toContain('"tag":"del"')
  })

  it.each([
    ['nested quotes', '> '.repeat(30_000)],
    ['nested list markers', '- '.repeat(30_000)],
    ['ordered list markers', '1. '.repeat(20_000)],
    ['component fences', '::a\n'.repeat(15_000)],
    ['open brackets', '['.repeat(60_000)],
    ['open braces', '{'.repeat(60_000)],
    ['citation labels', `[Source 1: ${' '.repeat(60_000)}`],
  ])('stays fast and escaped on pathological %s', async (_name, source) => {
    const started = Date.now()
    const result = await parseGeneratedMarkdown(source, context)
    expect(result.fallback.map(segment => segment.type === 'text' ? segment.value : '').join('')).toBe(source)
    expect(normalizeAssistantCitations(source)).toBe(source)
    expect(Date.now() - started).toBeLessThan(20_000)
  }, 40_000)

  it('keeps document-wide fallback only when pathological nesting cannot reach the parser', async () => {
    expect((await parseGeneratedMarkdown(`Good\n\n${'> '.repeat(65)}x`, context)).body).toBeNull()
    expect((await parseGeneratedMarkdown(`Good\n\n${'> '.repeat(64)}x`, context)).body).not.toBeNull()
  })

  it('bounds pathological depth while admitting ordinary nesting', async () => {
    const nested = (levels: number) => Array.from({ length: levels }, (_, level) => `${'  '.repeat(level)}- **item ${level}**`).join('\n')
    expect(refusedBlocks((await parseGeneratedMarkdown(nested(6), context)).body)).toHaveLength(0)
    expect(refusedBlocks((await parseGeneratedMarkdown(nested(12), context)).body)).toHaveLength(1)
  })

  it.each([
    ['> Quoted fact [1].', 1],
    ['For x < y, choose y [1].', 1],
    ['If a > b and c <= d, stop [1] (Source 2).', 2],
    ['Set {1, 2} holds [1].', 1],
    ['A -> B [1]', 1],
    ['3<5 [1]', 1],
    ['Inline <b>markup</b> [1]', 0],
    ['<cite>[1]</cite>', 0],
    ['[1]{.canary}', 0],
    ['Note {[1]} here', 0],
    ['{{ [1] }}', 0],
    ['Open {[1]', 0],
    ['> :canary[1]', 0],
    ['> [1]: https://example.invalid', 0],
    ['Fact [1] (see the table)', 1],
    ['[Label [1]](https://example.invalid)', 0],
    ['::canary[1]', 0],
  ])('fallback for %s keeps the same text with %i application-created citations', (source, citations) => {
    const segments = generatedTextFallback(source, 2)
    expect(segments.filter(segment => segment.type === 'citation')).toHaveLength(citations)
    if (!citations) expect(segments.map(segment => segment.type === 'text' ? segment.value : '').join('')).toBe(source)
  })

  it('normalizes an external URL once and never grants navigation props', () => {
    expect(validateGeneratedLink('HTTPS://EXAMPLE.INVALID:443/path?q=one', context.applicationOrigins)).toBe('https://example.invalid/path?q=one')
    expect(validateGeneratedLink('https://BUDDS-CI.invalid:443/path', context.applicationOrigins)).toBeNull()
    expect(validateGeneratedLink('https://example.invalid/\u0000', context.applicationOrigins)).toBeNull()
    expect(validateGeneratedLink('https://example.invalid/%0D', context.applicationOrigins)).toBeNull()
  })
})

describe('session Mermaid source grammar', () => {
  const graph = 'graph TD\naccDescr: Start leads to Finish.\nA[Start] --> B[Finish]'
  it('admits described static flowcharts and sequences', () => {
    expect(validatePassiveMermaid(graph)).toEqual({ description: 'Start leads to Finish.' })
    expect(validatePassiveMermaid('sequenceDiagram\naccDescr: Alice greets Bob.\nparticipant Alice\nparticipant Bob\nAlice->>Bob: Hello')).toEqual({ description: 'Alice greets Bob.' })
  })
  it.each([
    'graph TD\nA --> B',
    'classDiagram\naccDescr: A class.\nclass A',
    'mindmap\naccDescr: A map.\nroot((A))',
    graph + '\nclick A "https://example.invalid"',
    graph + '\nstyle A fill:red',
    graph + '\nclassDef canary fill:red',
    graph + '\nclass A canary',
    graph + '\n%%{init: {}}%%',
    '---\ntitle: canary\n---\n' + graph,
    graph.replace('Start]', '<b>Start</b>]'),
    graph + '\nA@{img: "canary"}',
    graph + '\nsubgraph canary',
    graph + 'x'.repeat(MERMAID_LIMITS.source),
    'graph TD\naccDescr: ' + 'x'.repeat(MERMAID_LIMITS.description + 1) + '\nA --> B',
    graph + '\n' + Array.from({ length: 33 }, (_, i) => `Node${i}`).join('\n'),
    graph + '\n' + Array.from({ length: 65 }, () => 'A --> B').join('\n'),
  ])('rejects unsupported statements, missing descriptions and resource limits', (source) => {
    expect(validatePassiveMermaid(source)).toBeNull()
  })
})

describe('V1 and chat Mermaid source grammar', () => {
  it.each(compatibleDiagrams)('names an undescribed %s diagram generically', (_family, source) => {
    expect(validateCompatibilityMermaid(source)).toEqual({ description: 'Diagram' })
    expect(validatePassiveMermaid(source)).toBeNull()
  })

  it.each([
    'graph TD;A-->B;B-->C;',
    'flowchart LR\nA --> B --> C',
    'graph TD\nA & B --> C & D',
    'graph TD\nStart[Begin] --> Class[Lesson] --> End[Finish]',
    'graph TD\nA{Choice} == chosen ==> B{{Prepare}}\nA -. skipped .-> C([Stop])\nA --- D[["Quoted (label)"]]',
    '%% Overview\ngraph LR\n  %% Steps\n  A --> B',
    'graph TD\r\nA --> B\r\n',
    'sequenceDiagram\nA->>B: Hello;B-->>A: Hi;',
    'classDiagram\nclass Queue~T~ {\n+push(item) void\n}\n<<interface>> Queue\nnote for Queue "First in, first out"\nStudent --> Class',
  ])('admits ordinary syntax: %s', (source) => {
    expect(validateCompatibilityMermaid(source)).toEqual({ description: 'Diagram' })
  })

  it('keeps line break tags and slanted shapes out of the session grammar', () => {
    expect(validatePassiveMermaid('graph TD\naccDescr: Start leads to Finish.\nA[One<br/>Two] --> B')).toBeNull()
    expect(validatePassiveMermaid('sequenceDiagram\naccDescr: Alice greets Bob.\nAlice->>Bob: One<br>Two')).toBeNull()
    expect(validatePassiveMermaid('graph TD\naccDescr: Start leads to Finish.\nA[\\One\\] --> B')).toBeNull()
  })

  it('uses a description when the diagram supplies one and never derives one', () => {
    expect(validateCompatibilityMermaid('graph TD\naccDescr: Start leads to Finish.\nA[Start] --> B[Finish]')).toEqual({ description: 'Start leads to Finish.' })
    expect(validateCompatibilityMermaid('graph TD\naccTitle: Overview\nA[Start] --> B[Finish]')).toEqual({ description: 'Diagram' })
  })

  it.each(refusedDiagrams)('refuses %s', (_name, source) => {
    expect(validateCompatibilityMermaid(source)).toBeNull()
  })

  it.each(refusedDiagrams)('refuses %s across whitespace and line-ending variants', (_name, source) => {
    const variants = [
      source.replaceAll('\n', '\r\n'),
      source.replaceAll('\n', '\n\n'),
      source.replaceAll('\n', ' \n'),
      source.replaceAll('\n', '\n\t  '),
      `\n  ${source}\n`,
      source.replaceAll(' ', '\t'),
      source.replaceAll(' ', '\u00A0'),
      source.replaceAll('\n', '\r'),
      source.replaceAll('\n', '\u2028'),
    ]
    for (const variant of variants) expect(validateCompatibilityMermaid(variant)).toBeNull()
  })

  it.each(disguisedRefusals)('refuses the disguised construct %j', (source) => {
    expect(validateCompatibilityMermaid(source)).toBeNull()
  })

  it.each([
    'graph TD\n' + Array.from({ length: 33 }, (_, i) => `N${i}`).join('\n'),
    'graph TD\n' + Array.from({ length: 65 }, () => 'A --> B').join('\n'),
    'mindmap\n' + Array.from({ length: 33 }, (_, i) => `  N${i}`).join('\n'),
    'graph TD\n' + 'subgraph S\n'.repeat(5) + 'A --> B\n' + 'end\n'.repeat(5),
    'graph TD\nend',
    'graph TD',
  ])('applies structural and resource bounds', (source) => {
    expect(validateCompatibilityMermaid(source)).toBeNull()
  })
})
