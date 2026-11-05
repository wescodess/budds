import { parseMarkdown } from '@nuxtjs/mdc/runtime'
import type { MDCElement, MDCNode, MDCRoot } from '@nuxtjs/mdc'

export const GENERATED_RENDER_POLICY = 'generated.passive.v1'
// Compatibility limits apply per saved section/message, not per conversation.
export const GENERATED_MARKDOWN_LIMITS = { source: 64_000, depth: 8, nodes: 512, diagrams: 2 } as const

interface MarkdownNode {
  type: string
  value?: string
  name?: string
  url?: string
  identifier?: string
  depth?: number
  ordered?: boolean
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

function citationNodes(value: string, sourceCount?: number): MDCNode[] {
  return citationSegments(value, sourceCount).map(segment => segment.type === 'text'
    ? text(segment.value)
    : { type: 'element', tag: 'citation', props: { index: segment.index }, children: [] })
}

// This lexer grants only citation controls on parser failure. Everything else is
// interpolated text. Code, link labels/destinations and authored markup stay literal.
export function generatedTextFallback(source: string, sourceCount = 0): GeneratedTextSegment[] {
  if (source.length > GENERATED_MARKDOWN_LIMITS.source) return [{ type: 'text', value: source }]
  const ranges: Array<[number, number]> = []
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
  if (/^(?:\uFEFF)?---(?:\r?\n|$)/.test(source)) {
    const closing = /^---\s*$/gm
    closing.lastIndex = lineEnd(0)
    const end = closing.exec(source)
    cursor = end ? lineEnd(end.index) : source.length
    ranges.push([0, cursor])
  }
  while (cursor < source.length) {
    if (cursor === 0 || source[cursor - 1] === '\n') {
      const boundary = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(source.slice(cursor))
      if (boundary) {
        const fence = boundary[1]!
        let end = cursor + boundary[0].length
        while (end < source.length) {
          const next = lineEnd(end)
          const closing = /^ {0,3}(`+|~+)\s*$/.exec(source.slice(end, next))?.[1]
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
      const suffix = source[labelEnd]
      if (suffix === '(' || suffix === '[') {
        const end = balancedEnd(labelEnd, suffix, suffix === '(' ? ')' : ']')
        ranges.push([cursor, end]); cursor = end; continue
      }
      if (source[labelEnd - 1] !== ']') { ranges.push([cursor, source.length]); break }
    }
    cursor++
  }
  let offset = 0
  for (const line of source.split(/(?<=\n)/)) {
    if (/[<>]|[{}]|(?:^|\s):[\w-]+|^ {0,3}\[[^\]]+\]:/.test(line)) ranges.push([offset, offset + line.length])
    offset += line.length
  }
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

export async function parseGeneratedMarkdown(source: string, context: GeneratedMarkdownContext) {
  let body: MDCRoot | null = null
  const markdown = source.replace(/\r\n/g, '\n')
  try {
    if (source.length > GENERATED_MARKDOWN_LIMITS.source || /^(?:\uFEFF)?---(?:\r?\n|$)/.test(source)) throw new Error('source')
    let count = 0
    let diagrams = 0
    const definitions = new Map<string, string>()
    const rebuild = (node: MarkdownNode, depth: number, inLink = false): MDCNode[] => {
      if (++count > GENERATED_MARKDOWN_LIMITS.nodes || depth > GENERATED_MARKDOWN_LIMITS.depth) throw new Error('tree')
      if (Object.keys(node.attributes ?? {}).length || Object.keys(node.fmAttributes ?? {}).length) throw new Error('attributes')
      if (node.type === 'textComponent' && node.name === 'span' && node.position) {
        const original = markdown.slice(node.position.start.offset, node.position.end.offset)
        if (!/^\[[^{}\n]*\]$/.test(original)) throw new Error('component')
        return inLink ? [text(original)] : citationNodes(original, context.sourceCount)
      }
      if (node.data && Object.keys(node.data).length) throw new Error('extension')
      const children = () => (node.children ?? []).flatMap(child => rebuild(child, depth + 1, inLink))
      if (node.type === 'root') return children()
      if (node.type === 'text') {
        if (/[{}]/.test(node.value ?? '')) throw new Error('extension-syntax')
        return inLink ? [text(node.value ?? '')] : citationNodes(node.value ?? '', context.sourceCount)
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
        if (start != null && (!Number.isSafeInteger(start) || start < 1 || start > 1_000_000)) throw new Error('list')
        return [element(node.ordered ? 'ol' : 'ul', children(), node.ordered && start ? { start } : {})]
      }
      if (node.type === 'definition') return []
      if (node.type === 'link' || node.type === 'linkReference') {
        const href = validateGeneratedLink(node.url ?? definitions.get(node.identifier ?? '') ?? '', context.applicationOrigins)
        if (!href) throw new Error('link')
        return [element('a', (node.children ?? []).flatMap(child => rebuild(child, depth + 1, true)), { href })]
      }
      if (node.type === 'table') {
        const rows = node.children ?? []
        const header = (rows[0]?.children ?? []).flatMap(cell => rebuild(cell, depth + 2)).map(cell => ({ ...cell, tag: 'th' })) as MDCNode[]
        return [element('table', [element('thead', [element('tr', header)]), element('tbody', rows.slice(1).flatMap(row => rebuild(row, depth + 1)))])]
      }
      if (node.type === 'listItem' && node.checked != null) throw new Error('task-list')
      const tag = proseTags[node.type]
      if (!tag) throw new Error('syntax')
      return [element(tag, children())]
    }
    // Inspect the Markdown AST before raw HTML expansion/compilation. Rebuild
    // approved fields only; neither the compiled body nor parsed.data is trusted.
    await parseMarkdown(markdown, {
      toc: false, contentHeading: false, highlight: false,
      remark: { plugins: {
        'generated-passive-gate': { instance: () => (tree: MarkdownNode) => {
          for (const node of tree.children ?? []) {
            if (node.type === 'definition' && node.identifier && node.url) definitions.set(node.identifier, node.url)
          }
          const children = rebuild(tree, 0)
          let nodes = 0
          const check = (node: MDCNode, depth: number) => {
            if (++nodes > GENERATED_MARKDOWN_LIMITS.nodes || depth > GENERATED_MARKDOWN_LIMITS.depth) throw new Error('rebuilt-tree')
            if (node.type === 'element') node.children.forEach(child => check(child, depth + 1))
          }
          children.forEach(child => check(child, 1))
          body = { type: 'root', children }
        } },
      } },
    })
    if (!body) throw new Error('parser')
  } catch { body = null }
  return { body, fallback: generatedTextFallback(source, context.sourceCount) }
}
