import { describe, expect, it } from 'vitest'
import { GENERATED_MARKDOWN_LIMITS, generatedTextFallback, parseGeneratedMarkdown, validateGeneratedLink } from '~/utils/generated-markdown'
import { MERMAID_LIMITS, validatePassiveMermaid } from '~/utils/passive-mermaid'
import { validateCompatibilityMermaid } from '~/utils/compatibility-mermaid'
import { compatibleDiagrams, refusedDiagrams } from '../support/generated-content-fixtures'
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
    '> '.repeat(10) + 'Deep content',
    'Source 1 '.repeat(300),
    Array.from({ length: 3 }, () => '```mermaid\ngraph TD\nA --> B\n```').join('\n\n'),
  ])('returns complete escaped text when a compatibility limit is exceeded', async (source) => {
    const result = await parseGeneratedMarkdown(source, context)
    expect(result.body).toBeNull()
    expect(result.fallback.map(segment => segment.type === 'text' ? segment.value : `[${segment.index}]`).join('')).toBe(source)
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

  it('uses a description when the diagram supplies one and never derives one', () => {
    expect(validateCompatibilityMermaid('graph TD\naccDescr: Start leads to Finish.\nA[Start] --> B[Finish]')).toEqual({ description: 'Start leads to Finish.' })
    expect(validateCompatibilityMermaid('graph TD\naccTitle: Overview\nA[Start] --> B[Finish]')).toEqual({ description: 'Diagram' })
  })

  it.each(refusedDiagrams)('refuses %s', (_name, source) => {
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
