import { MERMAID_LIMITS } from './passive-mermaid'

const GENERIC_ACCESSIBLE_NAME = 'Diagram'
const MAX_BLOCK_DEPTH = 4

const direction = '(?:TD|TB|BT|LR|RL)'
const plain = "\\p{L}\\p{N}\\p{M} .,:'?!_+/=&*%-"
const word = `[${plain}]{1,120}`
const quoted = `"[${plain}()\\[\\]]{1,120}"`
const text = `(?:${quoted}|${word})`
const prose = `[${plain}()\\[\\]"]{1,160}`
const identifier = '[A-Za-z0-9][A-Za-z0-9_]{0,31}'

const describedAs = new RegExp(`^(accTitle|accDescr): ([${plain}()\\[\\]"]{1,${MERMAID_LIMITS.description}})$`, 'u')
const comment = /^%%[^{}]*$/
const refused = /[\\`]|%%|\$\$|:::|@\{|\bfa[bklrs]?:fa-/iu
const header = new RegExp(`^(?:flowchart|graph)(?: ${direction})?$`)
// Mermaid also breaks lines on these, so they could hide a statement from this scan.
const hasHiddenLineBreak = (source: string) => Array.from(source.replace(/\r\n/g, '\n')).some((char) => {
  const code = char.charCodeAt(0)
  return (code < 32 && code !== 9 && code !== 10) || code === 127 || code === 0x85 || code === 0x2028 || code === 0x2029
})

const flowchartReserved = new Set(['end', 'subgraph', 'graph', 'flowchart', 'style', 'class', 'classDef', 'click', 'linkStyle', 'default', 'call', 'href', 'direction', 'interpolate'])
const sequenceReserved = new Set(['participant', 'actor', 'create', 'destroy', 'box', 'link', 'links', 'properties', 'details', 'loop', 'alt', 'opt', 'par', 'and', 'rect', 'note', 'end', 'else', 'critical', 'option', 'break', 'activate', 'deactivate', 'autonumber', 'title', 'acctitle', 'accdescr'])
const classReserved = new Set(['class', 'classDef', 'cssClass', 'click', 'callback', 'call', 'link', 'href', 'style', 'note', 'namespace', 'direction', 'end'])

const shape = [
  `\\(\\(\\(${text}\\)\\)\\)`, `\\(\\(${text}\\)\\)`, `\\(\\[${text}\\]\\)`, `\\[\\(${text}\\)\\]`, `\\[\\[${text}\\]\\]`,
  `\\{\\{${text}\\}\\}`, `\\{${text}\\}`, `\\[${text}\\]`, `\\(${text}\\)`, `>${text}\\]`,
].join('|')
const flowNode = new RegExp(`(${identifier})(?:${shape})?`, 'uy')
const flowJoin = / *& */y
const edgeText = "[\\p{L}\\p{N}\\p{M} ,:'?!_+/&*%]{1,120}"
const inlineEdgeText = `(?:${quoted}|${edgeText})`
const flowLink = new RegExp([
  `[xo<]?-- *${inlineEdgeText} *-{2,8}[xo>]?`,
  `[xo<]?== *${inlineEdgeText} *={2,8}[xo>]?`,
  `[xo<]?-\\. *${inlineEdgeText} *\\.-[xo>]?`,
  `(?:[xo<]?-{2,8}[xo>]|-{3,8}|[xo<]?={2,8}[xo>]|={3,8}|[xo<]?-\\.{1,8}-[xo>]?|~{3,8})(?: *\\|${text}\\|)?`,
].join('|'), 'uy')
const flowSpace = / */y
const subgraph = new RegExp(`^subgraph(?: (?:${quoted}|${identifier} *\\[${text}\\]|${word}))?$`, 'u')
const flowDirection = new RegExp(`^direction ${direction}$`)

const sequenceArrow = '(?:<<-->>|<<->>|-->>|->>|-->|->|--x|-x|--\\)|-\\))'
const message = new RegExp(`^(${identifier}) *${sequenceArrow}[+-]? *(${identifier}) *: *${prose}$`, 'u')
const participant = new RegExp(`^(?:participant|actor) (${identifier})(?: as ${word})?$`, 'u')
const sequenceNote = new RegExp(`^note (?:left of|right of|over) (${identifier})(?:, *(${identifier}))? *: *${prose}$`, 'iu')
const sequenceOpen = new RegExp(`^(?:loop|alt|opt|par|critical|break)(?: ${prose})?$`, 'u')
const sequenceBranch = new RegExp(`^(?:else|and|option)(?: ${prose})?$`, 'u')
const sequenceActivation = new RegExp(`^(?:activate|deactivate) (${identifier})$`, 'u')
const sequenceSetting = new RegExp(`^(?:autonumber(?: \\d{1,6}(?: \\d{1,6})?| off)?|title:? ${word})$`, 'u')

const classId = `${identifier}(?:~[A-Za-z0-9_, ]{1,40}~)?`
const classDeclaration = new RegExp(`^class (${classId})(?:\\[${quoted}\\])?(?: ?(\\{))?$`, 'u')
const classMember = new RegExp(`^[+\\-#~]?[\\p{L}\\p{N}\\p{M}_ .,:()\\[\\]~]{1,120}[*$]?$`, 'u')
const classMemberOf = new RegExp(`^(${classId}) *: *(.+)$`, 'u')
const classArrow = '(?:<\\||\\*|o|<)?(?:--|\\.\\.)(?:\\|>|\\*|o|>)?'
const classCardinality = '(?: *"[A-Za-z0-9.* ]{1,16}")?'
const classRelation = new RegExp(`^(${classId})${classCardinality} *${classArrow} *${classCardinality} *(${classId})(?: *: *${word})?$`, 'u')
const classAnnotation = /^<<[A-Za-z]{1,32}>>(?: ([A-Za-z0-9][A-Za-z0-9_]{0,31}))?$/
const classNote = new RegExp(`^note (?:for (${identifier}) )?${quoted}$`, 'u')

const mindmapShape = `\\(\\(${text}\\)\\)|\\)\\)${text}\\(\\(|\\)${text}\\(|\\{\\{${text}\\}\\}|\\[${text}\\]|\\(${text}\\)`
const mindmapNode = new RegExp(`^(?:(${identifier})?(?:${mindmapShape})|${quoted}|${word})$`, 'u')

type Tally = { entities: Set<string>; edges: number }
const addEntity = (tally: Tally, entity: string | undefined) => { if (entity) tally.entities.add(entity) }
const baseOf = (id: string) => id.split('~')[0]!

function matchAt(pattern: RegExp, source: string, position: number): number | null {
  pattern.lastIndex = position
  return pattern.test(source) ? pattern.lastIndex : null
}

function scanFlowNodes(statement: string, start: number, tally: Tally): number | null {
  let position = start
  for (;;) {
    flowNode.lastIndex = position
    const found = flowNode.exec(statement)
    if (!found || flowchartReserved.has(found[1]!)) return null
    tally.entities.add(found[1]!)
    position = flowNode.lastIndex
    const joined = matchAt(flowJoin, statement, position)
    if (joined === null) return position
    position = joined
  }
}

function flowchartStatement(statement: string, tally: Tally, depth: { value: number }): boolean {
  if (flowDirection.test(statement)) return true
  if (statement === 'end') return --depth.value >= 0
  if (subgraph.test(statement)) {
    tally.entities.add(`subgraph:${statement}`)
    return ++depth.value <= MAX_BLOCK_DEPTH
  }
  let position = scanFlowNodes(statement, 0, tally)
  while (position !== null) {
    if (position === statement.length) return true
    position = matchAt(flowSpace, statement, position)!
    const linked = matchAt(flowLink, statement, position)
    if (linked === null) return false
    tally.edges++
    position = scanFlowNodes(statement, matchAt(flowSpace, statement, linked)!, tally)
  }
  return false
}

function sequenceStatement(statement: string, tally: Tally, depth: { value: number }): boolean {
  if (statement === 'end') return --depth.value >= 0
  if (sequenceOpen.test(statement)) return ++depth.value <= MAX_BLOCK_DEPTH
  if (sequenceSetting.test(statement)) return true
  if (sequenceBranch.test(statement)) return depth.value > 0
  const declared = participant.exec(statement) ?? sequenceActivation.exec(statement)
  const related = message.exec(statement) ?? sequenceNote.exec(statement)
  const named = [declared?.[1], related?.[1], related?.[2]].filter(Boolean) as string[]
  if (!named.length || named.some(name => sequenceReserved.has(name.toLowerCase()))) return false
  named.forEach(name => tally.entities.add(name))
  if (message.test(statement)) tally.edges++
  return true
}

function classStatement(statement: string, tally: Tally, body: { open: boolean }): boolean {
  if (body.open) {
    if (statement === '}') { body.open = false; return true }
    return /^<<[A-Za-z]{1,32}>>$/.test(statement) || classMember.test(statement)
  }
  if (flowDirection.test(statement)) return true
  const declared = classDeclaration.exec(statement)
  if (declared) {
    if (classReserved.has(baseOf(declared[1]!))) return false
    tally.entities.add(baseOf(declared[1]!))
    body.open = Boolean(declared[2])
    return true
  }
  const annotated = classAnnotation.exec(statement)
  if (annotated) {
    addEntity(tally, annotated[1])
    return !classReserved.has(annotated[1] ?? '')
  }
  const noted = classNote.exec(statement)
  if (noted) {
    addEntity(tally, noted[1])
    return !classReserved.has(noted[1] ?? '')
  }
  const related = classRelation.exec(statement)
  if (related) {
    if (classReserved.has(baseOf(related[1]!)) || classReserved.has(baseOf(related[2]!))) return false
    tally.entities.add(baseOf(related[1]!)).add(baseOf(related[2]!))
    tally.edges++
    return true
  }
  const member = classMemberOf.exec(statement)
  if (!member || classReserved.has(baseOf(member[1]!)) || !classMember.test(member[2]!)) return false
  tally.entities.add(baseOf(member[1]!))
  return true
}

/**
 * The V1 and chat diagram grammar. Session content keeps validatePassiveMermaid,
 * which additionally requires a description and admits fewer families.
 */
export function validateCompatibilityMermaid(source: string): { description: string } | null {
  if (source.length > MERMAID_LIMITS.source || hasHiddenLineBreak(source)) return null
  const lines = source.split('\n').map(line => line.trim()).filter(line => line && !comment.test(line))
  if (lines.some(line => refused.test(line))) return null
  const splitsStatements = /^(?:flowchart|graph|sequenceDiagram)\b/.test(lines[0] ?? '')
  const statements = splitsStatements ? lines.flatMap(line => line.split(';').map(part => part.trim()).filter(Boolean)) : lines
  const first = statements[0] ?? ''
  const family = header.test(first) ? 'flowchart'
    : first === 'sequenceDiagram' ? 'sequence'
      : first === 'classDiagram' ? 'class'
        : first === 'mindmap' ? 'mindmap' : null
  if (!family) return null

  const tally: Tally = { entities: new Set(), edges: 0 }
  const depth = { value: 0 }
  const body = { open: false }
  let description = ''
  for (const statement of statements.slice(1)) {
    const described = family === 'mindmap' || body.open ? null : describedAs.exec(statement)
    if (described) {
      if (described[1] === 'accDescr') {
        if (description) return null
        description = described[2]!.trim()
      }
      continue
    }
    let admitted: boolean
    if (family === 'flowchart') admitted = flowchartStatement(statement, tally, depth)
    else if (family === 'sequence') admitted = sequenceStatement(statement, tally, depth)
    else if (family === 'class') admitted = classStatement(statement, tally, body)
    else {
      admitted = mindmapNode.test(statement)
      tally.entities.add(`node:${tally.entities.size}`)
    }
    if (!admitted || tally.edges > MERMAID_LIMITS.edges || tally.entities.size > MERMAID_LIMITS.entities) return null
  }
  if (depth.value !== 0 || body.open || tally.entities.size === 0) return null
  return { description: description || GENERIC_ACCESSIBLE_NAME }
}
