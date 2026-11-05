import { MERMAID_LIMITS } from './passive-mermaid'

const GENERIC_ACCESSIBLE_NAME = 'Diagram'
const MAX_BLOCK_DEPTH = 4

type Family = 'flowchart' | 'sequence' | 'class' | 'mindmap'
type Tally = { entities: Set<string>; edges: number; depth: number; classBody: boolean; description: string }

// Mermaid's lexers read most of these as whitespace or line breaks, so they could hide a statement from this scan.
const hiddenCharacter = /(?![ \t\n‌‍])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}]/u
const comment = /^%%[^{}]*$/

const refusedAnywhere = [
  /%%/, /^-{3,}$/,
  /:::/, /::\s*icon\b/i, /@\s*\{/, /\bfa[a-z]*\s*:\s*fa-/i,
  /\$\$/, /"\s*`/, /&#?\w+;|#\w+;/,
  /:\/\/|\/\/\S|\bwww\.|\b(?:javascript|vbscript|mailto)\s*:|\bdata:[\w-]+\/|\burl\s*\(/i,
]

const refusedStatements: Record<Family, readonly string[]> = {
  flowchart: ['click', 'call', 'callback', 'href', 'style', 'linkStyle', 'classDef', 'class', 'cssClass'],
  sequence: ['link', 'links', 'properties', 'details', 'click', 'href', 'style', 'classDef', 'class'],
  class: ['click', 'call', 'callback', 'link', 'href', 'style', 'classDef', 'cssClass'],
  mindmap: [],
}
const flowchartKeywords = new Set(refusedStatements.flowchart)
const colourBlock = /^(?:rect|box)\b/i
const longerIdentifier = /^-?[\p{L}\p{N}_]/u
const classMemberUse = /^\s*[(:]/
// Flowchart and class lexing is case-sensitive, and a sequence keyword needs a following name, so a differently cased word used as a node stays a node.
const nodeUse = /^(?:[[({>]|\s*(?:[xo<]?(?:--|==|-\.|~~)|->|<<|<\||\.\.|\*--|o--))/

function opensRefusedStatement(statement: string, family: Family): boolean {
  if (family === 'sequence' && colourBlock.test(statement)) return true
  const word = /^[\p{L}\p{N}_]+/u.exec(statement)?.[0]
  const keyword = word && refusedStatements[family].find(candidate => candidate.toLowerCase() === word.toLowerCase())
  if (!word || !keyword) return false
  const rest = statement.slice(word.length)
  if (longerIdentifier.test(rest) || (family === 'class' && classMemberUse.test(rest))) return false
  return word === keyword || !nodeUse.test(rest)
}

const tagLike = /<[a-z/!?]|<\s+[a-z/!?][^<>]*>/i
const lineBreakToken = /<br\/?>(?!>)/g
const labelHasMarkup = (label: string) => tagLike.test(label.replace(lineBreakToken, ' '))
// Mermaid's SVG text path erases this sign from flowchart labels, which would change what a diagram says.
const flowLabelRefused = (label: string) => labelHasMarkup(label) || label.replace(lineBreakToken, ' ').includes('>')

const slantedShape = /(?<=[\p{L}\p{N}_])\[(?:\\[^\\[\]]*[\\/]|\/[^\\[\]]*\\)\]/gu
const asymmetricShape = /(?<=[\p{L}\p{N}_\0])>[^\]]*\]/u
const innermostBracket = /[[({]([^[\](){}]*)[\])}]/g
const pipeLabel = /\|([^|]*)\|/g
const quotedLabel = /"([^"]*)"/g
const inlineEdges = [
  /(?<![-=.])--(?![->=.]|[xo]\s)\s*((?:[^-]|-(?!-))+?)\s*--+[-xo>]?/g,
  /(?<![-=.])==(?![=>-]|[xo]\s)\s*((?:[^=]|=(?!=))+?)\s*==+[=xo>]?/g,
  /(?<![-=.])-\.(?![-.])\s*((?:[^.]|\.(?!-))+?)\s*\.-[xo>]?/g,
]
const flowLink = /(?<![\p{L}\p{N}_])[xo<]?(?:--+[-xo>]|==+[=xo>]|-?\.+-[xo>]?|~~~+)|--+[-xo>]|==+[=xo>]|-?\.+-[xo>]?|~~~+/gu
const flowDirection = /^direction\s+(?:TD|TB|BT|LR|RL)$/

/** Separates what Mermaid reads as label text from the identifiers and operators around it. */
function flowchartView(statement: string): { code: string; labels: string[] } {
  const labels: string[] = []
  const extract = (pattern: RegExp, replacement: string, code: string) => code.replace(pattern, (_match, label: string) => {
    labels.push(label)
    return replacement
  })
  let code = extract(pipeLabel, '\0', extract(quotedLabel, '\0', statement))
  for (let previous = ''; previous !== code;) {
    previous = code
    code = extract(innermostBracket, '\0', code)
  }
  const asymmetric = asymmetricShape.exec(code)?.[0]
  if (asymmetric) {
    labels.push(asymmetric.slice(1, -1))
    code = code.replace(asymmetric, '\0')
  }
  for (const edge of inlineEdges) code = extract(edge, ' --> ', code)
  return { code, labels }
}

function flowchartStatement(statement: string, tally: Tally): boolean {
  const opensSubgraph = /^subgraph(?:\s|$)/i.test(statement)
  if (opensSubgraph ? statement.includes('\\') : statement.replace(slantedShape, '').includes('\\')) return false
  const { code, labels } = flowchartView(statement)
  if (tagLike.test(code) || labels.some(flowLabelRefused)) return false
  if (flowDirection.test(statement)) return true
  if (statement === 'end') return --tally.depth >= 0
  if (opensSubgraph) {
    tally.entities.add(`subgraph:${statement}`)
    return ++tally.depth <= MAX_BLOCK_DEPTH
  }
  tally.edges += code.match(flowLink)?.length ?? 0
  for (const id of code.replace(flowLink, ' ').split(/[\s&\0]+/)) {
    if (flowchartKeywords.has(id)) return false
    if (id) tally.entities.add(id)
  }
  return true
}

const sequenceArrow = '(?:<<-->>|<<->>|-->>|->>|-->|->|--x|-x|--\\)|-\\))'
const sequenceMessage = new RegExp(`^([^:]*?)\\s*${sequenceArrow}[+-]?\\s*([^:]*?)\\s*:(.*)$`, 'u')
const sequenceNote = /^(note\s+(?:left of|right of|over)\s+)([^:]*):(.*)$/iu
const sequenceDeclaration = /^(?:create\s+)?(?:participant|actor)\s+(.+?)(?:\s+as\s+(.*))?$/iu
const sequenceBlock = /^(?:loop|alt|opt|par|par_over|critical|break)(?:\s|$)/i

function sequenceStatement(statement: string, tally: Tally): boolean {
  // Mermaid reads the rest of the line as a comment, which would silently cut the text.
  if (statement.includes('#')) return false
  if (/^end$/i.test(statement)) return --tally.depth >= 0
  if (sequenceBlock.test(statement)) {
    if (tagLike.test(statement)) return false
    return ++tally.depth <= MAX_BLOCK_DEPTH
  }
  const note = sequenceNote.exec(statement)
  if (note) {
    const targets = note[2]!.split(',').map(target => target.trim())
    targets.forEach(target => tally.entities.add(target))
    return !tagLike.test(note[2]!) && !labelHasMarkup(note[3]!)
  }
  const declared = sequenceDeclaration.exec(statement)
  if (declared) {
    tally.entities.add(declared[1]!)
    return !tagLike.test(declared[1]!) && !labelHasMarkup(declared[2] ?? '')
  }
  const message = sequenceMessage.exec(statement)
  if (message) {
    tally.edges++
    tally.entities.add(message[1]!).add(message[2]!)
    return !tagLike.test(message[1]!) && !tagLike.test(message[2]!) && !labelHasMarkup(message[3]!)
  }
  return !tagLike.test(statement)
}

const classAnnotation = /<<\w+>>/g
const classDeclaration = /^class\s+(`[^`]+`|[^\s{["~:]+)/
const classRelation = /^(`[^`]+`|[^\s"~:]+)(?:~[^~]*~)?(?:\s+"[^"]*")?\s*(?:<\||\*|o|<|\(\))?(?:--|\.\.)(?:\|>|\*|o|>|\(\))?\s*(?:"[^"]*"\s*)?(`[^`]+`|[^\s"~:]+)/
const classMemberOf = /^(`[^`]+`|[^\s"~:]+)(?:~[^~]*~)?\s*:/
const classAnnotated = /^<<\w+>>\s+(\S+)/
const classNoteFor = /^note\s+for\s+(\S+)/

function classStatement(statement: string, tally: Tally): boolean {
  if (tagLike.test(statement.replace(classAnnotation, ''))) return false
  if (tally.classBody) {
    if (!statement.includes('}')) return true
    tally.classBody = false
    return !statement.slice(statement.indexOf('}') + 1).trim()
  }
  const declared = classDeclaration.exec(statement)
  if (declared) {
    tally.entities.add(declared[1]!)
    tally.classBody = /\{\s*$/.test(statement)
    return true
  }
  const related = classRelation.exec(statement)
  if (related) {
    tally.edges++
    tally.entities.add(related[1]!).add(related[2]!)
    return true
  }
  const named = classMemberOf.exec(statement) ?? classAnnotated.exec(statement) ?? classNoteFor.exec(statement)
  if (named) tally.entities.add(named[1]!)
  return true
}

function mindmapStatement(statement: string, tally: Tally): boolean {
  tally.entities.add(`node:${tally.entities.size}`)
  return !tagLike.test(statement)
}

const statementHandlers: Record<Family, (statement: string, tally: Tally) => boolean> = {
  flowchart: flowchartStatement, sequence: sequenceStatement, class: classStatement, mindmap: mindmapStatement,
}

function familyOf(header: string): Family | null {
  if (/^(?:flowchart|graph)(?:[ \t]+(?:TD|TB|BT|LR|RL))?$/.test(header)) return 'flowchart'
  if (header === 'sequenceDiagram') return 'sequence'
  if (header === 'classDiagram' || header === 'classDiagram-v2') return 'class'
  return header === 'mindmap' ? 'mindmap' : null
}

function splitOutsideQuotes(line: string): string[] {
  const parts = ['']
  let quoted = false
  for (const char of line) {
    if (char === '"') quoted = !quoted
    if (char === ';' && !quoted) parts.push('')
    else parts[parts.length - 1] += char
  }
  return parts
}

const accessibility = /^acc(title|descr)\s*:\s*(.*)$/i

function statementsOf(line: string, family: Family): string[] | null {
  if (family === 'mindmap') return [line]
  if (family !== 'flowchart' || accessibility.test(line)) return line.split(';')
  // A label's closing quote may be on another line, where this scan cannot tell text from statements.
  return (line.match(/"/g)?.length ?? 0) % 2 ? null : splitOutsideQuotes(line)
}

/**
 * The V1 and chat source gate. It refuses configuration, interaction, styling,
 * HTML and resource constructs and leaves other syntax to Mermaid's parser;
 * sanitizeGeneratedMermaidSvg remains the boundary. Session content keeps
 * validatePassiveMermaid.
 */
export function validateCompatibilityMermaid(source: string): { description: string } | null {
  if (source.length > MERMAID_LIMITS.source) return null
  const normalized = source.replace(/\r\n/g, '\n')
  if (hiddenCharacter.test(normalized)) return null
  const lines = normalized.split('\n').map(line => line.trim()).filter(line => line && !comment.test(line))
  const header = lines[0]?.split(';')[0] ?? ''
  const family = familyOf(header.trim())
  if (!family || lines.some(line => refusedAnywhere.some(pattern => pattern.test(line)))) return null
  if ((family === 'class' || family === 'mindmap') && header !== lines[0]) return null
  if (family !== 'flowchart' && normalized.includes('\\')) return null

  const tally: Tally = { entities: new Set(), edges: 0, depth: 0, classBody: false, description: '' }
  const [, ...firstLine] = lines[0]!.split(';')
  for (const line of [firstLine.join(';'), ...lines.slice(1)]) {
    const statements = statementsOf(line, family)
    if (!statements) return null
    for (const part of statements) {
      const statement = part.trim()
      if (!statement) continue
      if (opensRefusedStatement(statement, family)) return null
      const described = family === 'mindmap' || tally.classBody ? null : accessibility.exec(statement)
      if (described) {
        const text = described[2]!.trim()
        if (/[<>\\]/.test(text) || text.length > MERMAID_LIMITS.description) return null
        if (described[1]!.toLowerCase() === 'descr') {
          if (tally.description) return null
          tally.description = text
        }
        continue
      }
      if (!statementHandlers[family](statement, tally)) return null
      if (tally.edges > MERMAID_LIMITS.edges || tally.entities.size > MERMAID_LIMITS.entities) return null
    }
  }
  if (tally.depth !== 0 || tally.classBody || tally.entities.size === 0) return null
  return { description: tally.description || GENERIC_ACCESSIBLE_NAME }
}
