import { parseMarkdown } from '@nuxtjs/mdc/runtime'
import type { MDCElement, MDCNode, MDCRoot } from '@nuxtjs/mdc'

export const GENERATED_RENDER_POLICY = 'generated.passive.v1'
// Compatibility limits apply per saved section/message, not per conversation.
export const GENERATED_MARKDOWN_LIMITS = { source: 64_000, syntaxWork: 4_000_000, lines: 4_096, blockSyntax: 512, containers: 64, components: 64, depth: 24, nodes: 512, diagrams: 2 } as const

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

const citationCandidate = /[[(]|\bsource/gi
const numericMarker = /\[(\d+)\]/y
const labelledMarker = /\[\s*source\s+(\d+)\s*(?:\]|:\s*)/iy
const parenthesizedMarker = /\(\s*sources?\s+(\d+)\s*\)/iy
const bareMarker = /\bsource\s+(\d+)\b/iy
const labelBoundary = /[\]\n]/g
const whitespaceRun = /\s*/y

// A `[Source N: label]` may close after one line end. Failed attempts over the
// same label suffix share this lookup, so a regular expression's rescans cannot return.
function labelCloser(value: string) {
  let stop = -1
  let close = -1
  return (start: number) => {
    if (start > stop) {
      labelBoundary.lastIndex = start
      stop = labelBoundary.exec(value)?.index ?? value.length
      whitespaceRun.lastIndex = stop
      whitespaceRun.test(value)
      const next = value[stop] === '\n' ? whitespaceRun.lastIndex : stop
      close = value[next] === ']' ? next : -1
    }
    return close
  }
}

function citationMarkerAt(value: string, start: number, closeLabel: (start: number) => number) {
  const read = (pattern: RegExp) => { pattern.lastIndex = start; return pattern.exec(value) }
  if (value[start] !== '[') {
    const match = read(value[start] === '(' ? parenthesizedMarker : bareMarker)
    return match && { numeral: match[1]!, end: start + match[0].length }
  }
  const numeric = read(numericMarker)
  if (numeric) return { numeral: numeric[1]!, end: start + numeric[0].length }
  const labelled = read(labelledMarker)
  if (!labelled) return null
  const prefixEnd = start + labelled[0].length
  const end = labelled[0].endsWith(']') ? prefixEnd : closeLabel(prefixEnd) + 1
  return end ? { numeral: labelled[1]!, end } : null
}

export function citationSegments(value: string, sourceCount = 0): GeneratedTextSegment[] {
  const result: GeneratedTextSegment[] = []
  const closeLabel = labelCloser(value)
  let offset = 0
  let cursor = 0
  for (const { index: start } of value.matchAll(citationCandidate)) {
    if (start < cursor) continue
    const marker = citationMarkerAt(value, start, closeLabel)
    if (!marker) continue
    cursor = marker.end
    if (!/^[1-9]\d*$/.test(marker.numeral)) continue
    const index = Number(marker.numeral)
    if (!Number.isSafeInteger(index) || index < 1 || index > sourceCount) continue
    if (start > offset) result.push({ type: 'text', value: value.slice(offset, start) })
    result.push({ type: 'citation', index })
    offset = cursor
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
const containerMarker = /[ \t]*(?:>|(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)|\[\^(?:\\\S|[^\s[\]\\])+\]:)/y
const bulletItem = /^ {0,3}[-+*][ \t]+\S/
const parserFenceOpening = /^([ \t]*)(`{3,}(?=[^`]*$)|~{3,})/
const parserFenceClosing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const nodeSyntax = /[@|]|www\.|:\/\//gi
const componentDataFence = /^[ \t>]*-[- \t]*$/
const INLINE_DELIMITER = 2
const asciiSyntax = new Uint8Array(128)
for (const char of '"#$%\'()+,-./:;=>?@^|}') asciiSyntax[char.charCodeAt(0)] = 1
for (const char of '!&*<[\\]_`~{') asciiSyntax[char.charCodeAt(0)] = INLINE_DELIMITER

// Nothing can interrupt the synchronous parser once it starts, and its cost is
// superlinear in several independent ways, so each is charged before it runs.
// Inline delimiters rescan or walk back through their inline context. Punctuation
// in an unbroken run drives the autolink scans. Block syntax, lines, containers and
// component fences multiply document work, and a document above the node limit
// would be refused anyway, after paying for all of it. Long ordinary prose keeps
// the full source allowance; dense syntax falls back.
export function withinGeneratedParseBudget(markdown: string): boolean {
  const limits = GENERATED_MARKDOWN_LIMITS
  const lines = markdown.split(/[\r\n]/)
  if (lines.length > limits.lines) return false
  let work = 0
  let blockSyntax = 0
  let components = 0
  let opensComponent = false
  let containerDepth = 0
  let contextLength = 0
  let contextDelimiters = 0
  let openBrackets = 0
  // A label after a line-leading colon is read at block level, across blank lines.
  let labelsCrossBlocks = false
  let openFence = ''
  // A column-zero fence's content never reaches inline parsing, unless an earlier
  // indented fence, HTML block or component means the parser disagrees that it is one.
  let fencesKnown = true
  const endInlineContext = () => {
    work += contextLength * contextDelimiters
    contextLength = 0
    contextDelimiters = 0
    if (!labelsCrossBlocks) openBrackets = 0
  }
  for (const line of lines) {
    if (openFence) {
      const closing = parserFenceClosing.exec(line)?.[1]
      if (closing && closing[0] === openFence[0] && closing.length >= openFence.length) openFence = ''
      continue
    }
    let markers = 0
    let start = 0
    containerMarker.lastIndex = 0
    while (containerMarker.test(line)) { markers++; start = containerMarker.lastIndex }
    while (line[start] === ' ' || line[start] === '\t') start++
    // MDC parses this YAML during the parse, and its cost explodes within a few hundred characters.
    if (opensComponent && componentDataFence.test(line)) return false
    opensComponent = line.startsWith('::', start)
    if (start === line.length && !markers) { endInlineContext(); continue }
    // Every nesting level takes at least two prefix characters, apart from a bare `>`.
    const depth = Math.max(markers, start / 2)
    if (depth > limits.containers) return false
    containerDepth = Math.max(containerDepth, depth)
    const opening = parserFenceOpening.exec(line)
    if (opening) {
      if (fencesKnown && !opening[1]) { endInlineContext(); openFence = opening[2]!; continue }
      fencesKnown = false
    }
    const first = line.charCodeAt(start)
    if (first === 60 || first === 58) fencesKnown = false
    if (first === 58) labelsCrossBlocks = true
    if (opensComponent) components++
    blockSyntax += markers + (asciiSyntax[first] ? 1 : 0) + (line.match(nodeSyntax)?.length ?? 0)
    if (bulletItem.test(line)) endInlineContext()
    // Inside a nested label, MDC emits an empty text chunk for this and micromark never finishes tokenizing it.
    if (line[start] === ']' && openBrackets >= 2) return false
    let runLength = 0
    let runPunctuation = 0
    let previous = 32
    let escaped = false
    for (let index = 0; index < line.length; index++) {
      const code = line.charCodeAt(index)
      if (escaped) escaped = false
      else if (code === 92) escaped = true
      else if (code === 91) openBrackets++
      else if (code === 93 && openBrackets) openBrackets--
      if (code === 32 || code === 9) {
        work += runLength * runPunctuation
        runLength = 0
        runPunctuation = 0
      } else {
        runLength++
        if (asciiSyntax[code]) runPunctuation++
        // MDC reads a colon as syntax only after whitespace or an opening delimiter.
        if (asciiSyntax[code] === INLINE_DELIMITER || (code === 58 && (previous === 32 || previous === 9 || previous === 91 || previous === 42 || previous === 95 || previous === 40))) contextDelimiters++
      }
      previous = code
    }
    work += runLength * runPunctuation
    contextLength += line.length + 1
  }
  endInlineContext()
  // Every line pays for its open containers, even lazily, and each component's
  // content is tokenized again as a nested document.
  work += (containerDepth + components) * 128 * lines.length + components * markdown.length
  return work <= limits.syntaxWork && blockSyntax <= limits.blockSyntax && components <= limits.components
}

const referenceKey = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase()
const referenceLabels = (source: string) => new Set(Array.from(source.matchAll(new RegExp(referenceDefinition, 'gm')), match => referenceKey(match[1]!)))

// Index every delimiter once instead of searching nested suffixes repeatedly.
function delimiterEnds(source: string): Uint32Array {
  const escaped = new Uint8Array(source.length)
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 92 && i + 1 < source.length) escaped[++i] = 1
  }
  const ends = new Uint32Array(source.length)
  const brackets: number[] = []
  const parentheses: number[] = []
  for (let i = source.length - 1; i >= 0; i--) {
    const char = source.charCodeAt(i)
    if (char === 93 && !escaped[i]) brackets.push(i + 1)
    if (char === 41 && !escaped[i]) parentheses.push(i + 1)
    const stack = char === 91 ? brackets : char === 40 ? parentheses : null
    if (stack) {
      ends[i] = stack.at(-1) ?? 0
      // A scan beginning at an escaped opener still sees its following suffix.
      if (!escaped[i]) stack.pop()
    }
  }
  return ends
}

const backtickRun = /`+/y

// This lexer grants only citation controls in refused text. Everything else is
// interpolated text. Code, link labels/destinations and authored markup stay literal.
export function generatedTextFallback(source: string, sourceCount = 0, references?: ReadonlySet<string>): GeneratedTextSegment[] {
  const literal = (): GeneratedTextSegment[] => [{ type: 'text', value: source }]
  if (!sourceCount || source.length > GENERATED_MARKDOWN_LIMITS.source) return literal()
  const labels = references ?? referenceLabels(source)
  const ends = delimiterEnds(source)
  // Escaped openers can share a label end, so its following whitespace is read once.
  const suffixStarts = new Uint32Array(source.length + 1)
  const suffixStartAfter = (labelEnd: number) => {
    if (!suffixStarts[labelEnd]) {
      whitespaceRun.lastIndex = labelEnd
      whitespaceRun.test(source)
      suffixStarts[labelEnd] = whitespaceRun.lastIndex
    }
    return suffixStarts[labelEnd]!
  }
  // Reference normalization must also be bounded for overlapping nested labels.
  let referenceWork = source.length * 4
  const hasReference = (start: number, end: number) => {
    if (!labels.size) return false
    referenceWork -= Math.max(0, end - start)
    return referenceWork >= 0 && labels.has(referenceKey(source.slice(start, end)))
  }
  const ranges = new Int32Array(source.length + 1)
  const protect = (start: number, end: number) => { ranges[start]!++; ranges[end]!-- }
  for (const match of source.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>]+/gi)) protect(match.index, match.index + match[0].length)
  const lineEnd = (offset: number) => { const end = source.indexOf('\n', offset); return end < 0 ? source.length : end + 1 }
  let cursor = 0
  if (/^\uFEFF?---/.test(source)) {
    const closing = /^---\s*$/gm
    closing.lastIndex = lineEnd(0)
    const end = closing.exec(source)
    cursor = end ? lineEnd(end.index) : source.length
    protect(0, cursor)
  }
  while (cursor < source.length) {
    if (cursor === 0 || source[cursor - 1] === '\n') {
      const end = lineEnd(cursor)
      const line = source.slice(cursor, end)
      if (indentedCode.test(line)) {
        protect(cursor, end); cursor = end; continue
      }
      const boundary = fenceOpening.exec(line)
      if (boundary) {
        const fence = boundary[1]!
        let end = cursor + boundary[0].length
        while (end < source.length) {
          const next = lineEnd(end)
          const closing = fenceClosing.exec(source.slice(end, next))?.[1]
          end = next
          if (closing && closing[0] === fence[0] && closing.length >= fence.length) break
        }
        protect(cursor, end); cursor = end; continue
      }
    }
    if (source[cursor] === '`') {
      backtickRun.lastIndex = cursor
      const ticks = backtickRun.exec(source)![0]
      const closing = /`+/g
      closing.lastIndex = cursor + ticks.length
      let match: RegExpExecArray | null
      let end = source.length
      while ((match = closing.exec(source))) {
        if (match[0] === ticks) { end = match.index + ticks.length; break }
      }
      protect(cursor, end); cursor = end; continue
    }
    if (source[cursor] === '[') {
      const labelEnd = ends[cursor]!
      if (!labelEnd) { protect(cursor, source.length); break }
      const suffixStart = suffixStartAfter(labelEnd)
      const suffix = source[suffixStart]
      const attached = suffixStart === labelEnd
      const referenceEnd = suffix === '[' ? ends[suffixStart] || source.length : suffixStart
      const referenceStart = referenceEnd > suffixStart + 2 ? suffixStart : cursor
      const referenceLabelEnd = referenceEnd > suffixStart + 2 ? referenceEnd : labelEnd
      const reference = suffix === '[' && (attached || hasReference(referenceStart + 1, referenceLabelEnd - 1))
      if (referenceWork < 0) return literal()
      if ((suffix === '(' && attached) || reference) {
        const end = ends[suffixStart] || source.length
        protect(cursor, end); cursor = end; continue
      }
      if (hasReference(cursor + 1, labelEnd - 1)) {
        protect(cursor, labelEnd); cursor = labelEnd; continue
      }
      if (referenceWork < 0) return literal()
    }
    cursor++
  }
  let offset = 0
  for (const line of source.split(/(?<=\n)/)) {
    if (literalLine.test(line)) protect(offset, offset + line.length)
    offset += line.length
  }
  for (const match of source.matchAll(/(?:\[[^[\]\n]*\])?\{[^}\n]*(?:\}|$)/gm)) protect(match.index, match.index + match[0].length)
  const result: GeneratedTextSegment[] = []
  offset = 0
  let coverage = 0
  for (let i = 0; i <= source.length; i++) {
    const wasProtected = coverage > 0
    coverage += ranges[i]!
    if (wasProtected === (coverage > 0)) continue
    if (wasProtected) result.push({ type: 'text', value: source.slice(offset, i) })
    else result.push(...citationSegments(source.slice(offset, i), sourceCount))
    offset = i
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
    if (!withinGeneratedParseBudget(markdown)) throw new Error('complexity')
    let count = 0
    let diagrams = 0
    const definitions = new Map<string, string>()
    const validatedLinks = new Map<string, string | null>()
    const validatedLink = (destination: string) => {
      if (!validatedLinks.has(destination)) validatedLinks.set(destination, validateGeneratedLink(destination, context.applicationOrigins))
      return validatedLinks.get(destination)
    }
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
        const href = validatedLink(node.url ?? definitions.get(node.identifier ?? '') ?? '')
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
  return { body, tailRefused, fallback: body ? [] : generatedTextFallback(source, context.sourceCount) }
}
