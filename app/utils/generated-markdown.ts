import { parseMarkdown } from '@nuxtjs/mdc/runtime'
import type { MDCElement, MDCNode, MDCRoot } from '@nuxtjs/mdc'

export const GENERATED_RENDER_POLICY = 'generated.passive.v1'
// Compatibility limits apply per saved section/message, not per conversation.
export const GENERATED_MARKDOWN_LIMITS = { source: 64_000, depth: 24, nodes: 512, diagrams: 2 } as const

interface MarkdownNode {
  type: string
  value?: string
  name?: string
  url?: string
  identifier?: string
  depth?: number
  ordered?: boolean
  align?: Array<string | null>
  start?: number | null
  checked?: boolean | null
  lang?: string | null
  meta?: string | null
  data?: Record<string, unknown>
  attributes?: Record<string, unknown>
  fmAttributes?: Record<string, unknown>
  position?: { start: { offset: number }; end: { offset: number } }
  children?: MarkdownNode[]
}

export interface GeneratedMarkdownContext {
  applicationOrigins: string[]
  sourceCount?: number
}
export type GeneratedTextSegment = { type: 'text'; value: string } | { type: 'citation'; index: number }

const languages = new Set(['text', 'ts', 'js', 'jsx', 'tsx', 'vue', 'bash', 'shell', 'json', 'md', 'python', 'sql', 'html', 'css', 'diff', 'yaml', 'mermaid'])
const proseTags: Record<string, string> = {
  paragraph: 'p', break: 'br', emphasis: 'em', strong: 'strong', blockquote: 'blockquote',
  thematicBreak: 'hr', listItem: 'li', table: 'table', tableRow: 'tr', tableCell: 'td',
}
// Important: the sinks' own table cell classes would otherwise win.
const columnAlignments: Record<string, string> = { left: 'text-left!', center: 'text-center!', right: 'text-right!' }

function text(value: string): MDCNode { return { type: 'text', value } }
function element(tag: string, children: MDCNode[], props: MDCElement['props'] = {}): MDCElement {
  // The pinned MDC renderer otherwise merges global mappings even with prose:false.
  // __ignoreMap is consumed by MDC and never forwarded to the DOM.
  return { type: 'element', tag, props: { __ignoreMap: '', ...props }, children }
}

export function validateGeneratedLink(value: string, applicationOrigins: string[]): string | null {
  const hasUnsafeCharacters = (text: string) => Array.from(text).some(char => char.charCodeAt(0) <= 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159) || char === '\\')
  if (!/^https?:\/\//i.test(value) || hasUnsafeCharacters(value)) return null
  try {
    const decoded = decodeURIComponent(value)
    if (hasUnsafeCharacters(decoded) || /%[\da-f]{2}/i.test(decoded)) return null
    const url = new URL(value)
    const ownOrigins = applicationOrigins.flatMap(origin => { try { return [new URL(origin).origin] } catch { return [] } })
    if (!url.hostname || url.username || url.password || ownOrigins.includes(url.origin)) return null
    return url.href
  } catch { return null }
}

const marker = /\[(\d+)\]|\[\s*Source\s+(\d+)(?:\s*:\s*[^\]\n]*)?\s*\]|\(\s*Sources?\s+(\d+)\s*\)|\bSource\s+(\d+)\b/gi

function citationSegments(value: string, sourceCount = 0): GeneratedTextSegment[] {
  const result: GeneratedTextSegment[] = []
  let offset = 0
  for (const match of value.matchAll(marker)) {
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

function segmentNodes(segments: GeneratedTextSegment[]): MDCNode[] {
  return segments.map(segment => segment.type === 'text'
    ? text(segment.value)
    : { type: 'element', tag: 'citation', props: { index: segment.index }, children: [] })
}

function citationNodes(value: string, sourceCount?: number): MDCNode[] {
  return segmentNodes(citationSegments(value, sourceCount))
}

// Spaces belong only to the following `>`, so nested quotes cannot backtrack exponentially.
const quotePrefix = String.raw`(?:(?: {0,3}>)+[ \t]?)?`
const indentedCode = new RegExp(`^${quotePrefix}(?: {4}|\\t)`)
const fenceOpening = new RegExp(String.raw`^${quotePrefix}(?: {0,3}(?:[-+*]|\d+[.)]) )? {0,3}(\`{3,}|~{3,})[^\n]*(?:\n|$)`)
const fenceClosing = new RegExp(String.raw`^${quotePrefix} {0,3}(\`+|~+)\s*$`)
const referenceDefinition = String.raw`^${quotePrefix} {0,3}\[([^\]\n]+)\]:`
const literalLine = new RegExp(String.raw`<[a-z/!?]|(?:^|\s):+[\w-]+|${referenceDefinition}`, 'i')
// The parser's cost grows quickly with these before any tree bound can apply.
const pathologicalNesting = /^(?:[ \t]*(?:>|(?:[-+*]|\d{1,9}[.)])[ \t])){65}/m
const componentFences = /^[ \t]*::/gm

const referenceKey = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase()
const referenceLabels = (source: string) => new Set(Array.from(source.matchAll(new RegExp(referenceDefinition, 'gm')), match => referenceKey(match[1]!)))

// This lexer grants only citation controls in refused text. Everything else is
// interpolated text. Code, link labels/destinations and authored markup stay literal.
export function generatedTextFallback(source: string, sourceCount = 0, references = referenceLabels(source)): GeneratedTextSegment[] {
  if (source.length > GENERATED_MARKDOWN_LIMITS.source) return [{ type: 'text', value: source }]
  const ranges: Array<[number, number]> = []
  for (const match of source.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>]+/gi)) ranges.push([match.index, match.index + match[0].length])
  const lineEnd = (offset: number) => { const end = source.indexOf('\n', offset); return end < 0 ? source.length : end + 1 }
  const balancedEnd = (start: number, open: string, close: string) => {
    let depth = 0
    for (let i = start; i < source.length; i++) {
      if (source[i] === '\\') { i++; continue }
      if (source[i] === open) depth++
      if (source[i] === close && --depth === 0) return i + 1
    }
    return source.length
  }
  let cursor = 0
  if (/^\uFEFF?---/.test(source)) {
    const closing = /^---\s*$/gm
    closing.lastIndex = lineEnd(0)
    const end = closing.exec(source)
    cursor = end ? lineEnd(end.index) : source.length
    ranges.push([0, cursor])
  }
  while (cursor < source.length) {
    if (cursor === 0 || source[cursor - 1] === '\n') {
      if (indentedCode.test(source.slice(cursor))) {
        const end = lineEnd(cursor)
        ranges.push([cursor, end]); cursor = end; continue
      }
      const boundary = fenceOpening.exec(source.slice(cursor))
      if (boundary) {
        const fence = boundary[1]!
        let end = cursor + boundary[0].length
        while (end < source.length) {
          const next = lineEnd(end)
          const closing = fenceClosing.exec(source.slice(end, next))?.[1]
          end = next
          if (closing && closing[0] === fence[0] && closing.length >= fence.length) break
        }
        ranges.push([cursor, end]); cursor = end; continue
      }
    }
    const ticks = /^`+/.exec(source.slice(cursor))?.[0]
    if (ticks) {
      const closing = /`+/g
      closing.lastIndex = cursor + ticks.length
      let match: RegExpExecArray | null
      let end = source.length
      while ((match = closing.exec(source))) {
        if (match[0] === ticks) { end = match.index + ticks.length; break }
      }
      ranges.push([cursor, end]); cursor = end; continue
    }
    if (source[cursor] === '[') {
      const labelEnd = balancedEnd(cursor, '[', ']')
      let suffixStart = labelEnd
      while (/\s/.test(source[suffixStart] ?? '') && suffixStart < source.length) suffixStart++
      const suffix = source[suffixStart]
      const referenceEnd = suffix === '[' ? balancedEnd(suffixStart, '[', ']') : suffixStart
      const referenceLabel = source.slice(suffixStart + 1, referenceEnd - 1) || source.slice(cursor + 1, labelEnd - 1)
      if ((suffix === '(' && suffixStart === labelEnd) || (suffix === '[' && (suffixStart === labelEnd || references.has(referenceKey(referenceLabel))))) {
        const end = balancedEnd(suffixStart, suffix, suffix === '(' ? ')' : ']')
        ranges.push([cursor, end]); cursor = end; continue
      }
      if (references.has(referenceKey(source.slice(cursor + 1, labelEnd - 1)))) {
        ranges.push([cursor, labelEnd]); cursor = labelEnd; continue
      }
      if (source[labelEnd - 1] !== ']') { ranges.push([cursor, source.length]); break }
    }
    cursor++
  }
  let offset = 0
  for (const line of source.split(/(?<=\n)/)) {
    if (literalLine.test(line)) ranges.push([offset, offset + line.length])
    offset += line.length
  }
  for (const match of source.matchAll(/(?:\[[^[\]\n]*\])?\{[^}\n]*(?:\}|$)/gm)) ranges.push([match.index, match.index + match[0].length])
  ranges.sort((a, b) => a[0] - b[0])
  const result: GeneratedTextSegment[] = []
  offset = 0
  for (const [start, end] of ranges) {
    if (end <= offset) continue
    if (start > offset) result.push(...citationSegments(source.slice(offset, start), sourceCount))
    result.push({ type: 'text', value: source.slice(Math.max(offset, start), end) })
    offset = end
  }
  result.push(...citationSegments(source.slice(offset), sourceCount))
  return result.length > GENERATED_MARKDOWN_LIMITS.nodes ? [{ type: 'text', value: source }] : result
}

// MDC attaches some brace groups to a text node and drops them from its value.
// Restore them as literal text only when value and groups reproduce the source
// exactly and no group uses class, ID, binding, event or quoted attribute syntax.
function restoreBraceGroups(markdown: string, node: MarkdownNode): string {
  if (!node.position) throw new Error('attributes')
  const value = node.value ?? ''
  const group = /\{[\w\s+\-=,^\\]*\}/y
  let cursor = node.position.start.offset
  let restored = ''
  let index = 0
  const takeGroup = () => {
    group.lastIndex = cursor
    const match = group.exec(markdown)?.[0]
    if (match) { restored += match; cursor += match.length }
    return Boolean(match)
  }
  while (index < value.length) {
    if (markdown[cursor] === value[index]) { restored += value[index++]; cursor++ }
    else if (!takeGroup()) throw new Error('attributes')
  }
  takeGroup()
  if (restored === value) throw new Error('attributes')
  return restored
}

export async function parseGeneratedMarkdown(source: string, context: GeneratedMarkdownContext) {
  let body: MDCRoot | null = null
  let tailRefused = false
  const markdown = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  try {
    // The parser strips any closed `---` prefix, so block offsets would no longer match the source.
    if (source.length > GENERATED_MARKDOWN_LIMITS.source || markdown.startsWith('---')) throw new Error('source')
    if (pathologicalNesting.test(markdown) || (markdown.match(componentFences)?.length ?? 0) > 64) throw new Error('nesting')
    let count = 0
    let diagrams = 0
    const definitions = new Map<string, string>()
    const rebuild = (node: MarkdownNode, depth: number, inLink = false): MDCNode[] => {
      if (++count > GENERATED_MARKDOWN_LIMITS.nodes || depth > GENERATED_MARKDOWN_LIMITS.depth) throw new Error('tree')
      const hasAttributes = Object.keys(node.attributes ?? {}).length > 0
      if ((hasAttributes && node.type !== 'text') || Object.keys(node.fmAttributes ?? {}).length) throw new Error('attributes')
      if (node.type === 'textComponent' && node.name === 'span' && node.position) {
        const original = markdown.slice(node.position.start.offset, node.position.end.offset)
        if (!/^\[[^{}\n]*\]$/.test(original)) throw new Error('component')
        return inLink ? [text(original)] : citationNodes(original, context.sourceCount)
      }
      if (node.data && Object.keys(node.data).length) throw new Error('extension')
      const children = (childInLink = inLink) => (node.children ?? []).flatMap((child, index, siblings) => {
        // Reads as an attribute on the preceding inline element, even where MDC leaves it as text.
        const previous = siblings[index - 1]
        if (child.type === 'text' && child.value?.startsWith('{') && previous && !['text', 'break'].includes(previous.type)) throw new Error('attributes')
        return rebuild(child, depth + 1, childInLink)
      })
      if (node.type === 'text') {
        const value = hasAttributes ? restoreBraceGroups(markdown, node) : node.value ?? ''
        return inLink ? [text(value)] : citationNodes(value, context.sourceCount)
      }
      if (node.type === 'inlineCode') return [element('code', [text(node.value ?? '')])]
      if (node.type === 'code') {
        if (node.meta) throw new Error('fence-options')
        const code = `${node.value ?? ''}\n`
        const language = languages.has(node.lang ?? '') ? node.lang! : 'text'
        if (language === 'mermaid' && ++diagrams > GENERATED_MARKDOWN_LIMITS.diagrams) throw new Error('diagrams')
        return [{ type: 'element', tag: 'pre', props: { code, language }, children: [element('code', [text(code)])] }]
      }
      if (node.type === 'heading') return [element(`h${Math.max(2, Math.min(6, node.depth ?? 2))}`, children())]
      if (node.type === 'list') {
        const start = node.start
        if (start != null && (!Number.isSafeInteger(start) || start < 0 || start > 1_000_000)) throw new Error('list')
        return [element(node.ordered ? 'ol' : 'ul', children(), node.ordered && start != null ? { start } : {})]
      }
      if (node.type === 'definition') return []
      if (node.type === 'link' || node.type === 'linkReference') {
        const href = validateGeneratedLink(node.url ?? definitions.get(node.identifier ?? '') ?? '', context.applicationOrigins)
        if (!href) throw new Error('link')
        return [element('a', children(true), { href })]
      }
      if (node.type === 'table') {
        const rows = node.children ?? []
        const aligned = (cells: MDCNode[], tag: string) => cells.map((cell, column) => {
          const alignment = columnAlignments[node.align?.[column] ?? '']
          return { ...cell, tag, props: { ...(cell as MDCElement).props, ...(alignment ? { class: alignment } : {}) } } as MDCNode
        })
        const header = aligned((rows[0]?.children ?? []).flatMap(cell => rebuild(cell, depth + 2)), 'th')
        const body = rows.slice(1).flatMap(row => rebuild(row, depth + 1)).map(row => ({ ...row, children: aligned((row as MDCElement).children, 'td') }) as MDCNode)
        return [element('table', [element('thead', [element('tr', header)]), element('tbody', body)])]
      }
      if (node.type === 'delete') {
        // GFM also accepts a single tilde, which models use for subscripts, not deletions.
        const doubled = markdown.startsWith('~~', node.position?.start.offset ?? markdown.length)
        return doubled ? [element('del', children())] : [text('~'), ...children(), text('~')]
      }
      if (node.type === 'listItem' && node.checked != null) throw new Error('task-list')
      const tag = proseTags[node.type]
      if (!tag) throw new Error('syntax')
      return [element(tag, children())]
    }
    const exceedsDepth = (node: MDCNode, depth: number): boolean => depth > GENERATED_MARKDOWN_LIMITS.depth
      || (node.type === 'element' && node.children.some(child => exceedsDepth(child, depth + 1)))
    const size = (node: MDCNode): number => 1 + (node.type === 'element' ? node.children.reduce((total, child) => total + size(child), 0) : 0)
    // Inspect the Markdown AST before raw HTML expansion/compilation. Rebuild
    // approved fields only; neither the compiled body nor parsed.data is trusted.
    await parseMarkdown(markdown, {
      toc: false, contentHeading: false, highlight: false,
      remark: { plugins: {
        'generated-passive-gate': { instance: () => (tree: MarkdownNode) => {
          const blocks = tree.children ?? []
          for (const node of blocks) {
            if (node.type === 'definition' && node.identifier && node.url) definitions.set(node.identifier, node.url)
          }
          const references = referenceLabels(markdown)
          const refused = new Set<MarkdownNode>()
          const children = blocks.flatMap((block) => {
            const budget = { count, diagrams }
            try {
              const nodes = rebuild(block, 1)
              if (nodes.some(node => exceedsDepth(node, 1))) throw new Error('rebuilt-tree')
              return nodes
            } catch (error) {
              // The node budget covers the whole document, so it cannot be scoped to this block.
              if (count > GENERATED_MARKDOWN_LIMITS.nodes || !block.position) throw error
              count = budget.count
              diagrams = budget.diagrams
              refused.add(block)
              const literal = markdown.slice(block.position.start.offset, block.position.end.offset)
              return [element('p', segmentNodes(generatedTextFallback(literal, context.sourceCount, references)), { 'class': 'whitespace-pre-wrap break-words', 'data-generated-refused': '' })]
            }
          })
          if (children.reduce((total, child) => total + size(child), 0) > GENERATED_MARKDOWN_LIMITS.nodes) throw new Error('rebuilt-tree')
          const last = blocks.at(-1)
          // A partial trailing definition can refuse the earlier block that references it.
          tailRefused = last ? refused.has(last) || (last.type === 'definition' && refused.size > 0) : false
          body = { type: 'root', children }
          // Nothing refused may reach raw HTML expansion or MDC's compiler.
          return { type: 'root', children: [] }
        } },
      } },
    })
    if (!body) throw new Error('parser')
  } catch { body = null; tailRefused = false }
  return { body, tailRefused, fallback: generatedTextFallback(source, context.sourceCount) }
}
