export const MERMAID_LIMITS = { source: 2_000, description: 1_000, entities: 32, edges: 64, svgBytes: 256 * 1024 } as const

const id = '[A-Za-z][A-Za-z0-9_]{0,31}'
const label = "[\\p{L}\\p{N} .,:'?!_+()/=-]{1,120}"
const node = `(${id})(?:\\["?${label}"?\\]|\\(${label}\\))?`
const declaration = new RegExp(`^${node}$`, 'u')
const edge = new RegExp(`^${node}\\s*(?:-->|---|-\\.->|==>)(?:\\|${label}\\|)?\\s*${node}$`, 'u')
const participant = new RegExp(`^(?:participant|actor) (${id})(?: as ${label})?$`, 'u')
const message = new RegExp(`^(${id})\\s*(?:->>|-->>|->|-->|-x|--x)\\s*(${id}):\\s*${label}$`, 'u')
const note = new RegExp(`^Note (?:left of|right of|over) (${id})(?:,\\s*(${id}))?:\\s*${label}$`, 'u')

/** A closed statement grammar, before Mermaid can create any staging DOM. */
export function validatePassiveMermaid(source: string): { description: string } | null {
  if (source.length > MERMAID_LIMITS.source) return null
  const lines = source.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const family = /^(?:flowchart|graph) (?:TD|TB|BT|LR|RL)$/.test(lines[0] ?? '') ? 'flowchart' : lines[0] === 'sequenceDiagram' ? 'sequence' : null
  if (!family) return null
  const entities = new Set<string>()
  let edges = 0
  let description = ''
  for (const line of lines.slice(1)) {
    if (line.startsWith('accDescr: ')) {
      if (description) return null
      description = line.slice(10).trim()
      if (!description || description.length > MERMAID_LIMITS.description || /[<>]/u.test(description) || Array.from(description).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null
      continue
    }
    if (/^accTitle: [\p{L}\p{N} .,:'?!_+()/=-]{1,120}$/u.test(line)) continue
    const relation = family === 'flowchart' ? edge.exec(line) : message.exec(line) ?? note.exec(line)
    const entity = family === 'flowchart' ? declaration.exec(line) : participant.exec(line)
    if (relation) {
      entities.add(relation[1]!)
      if (relation[2]) entities.add(relation[2])
      if (++edges > MERMAID_LIMITS.edges) return null
    } else if (entity) entities.add(entity[1]!)
    else return null
    if (entities.size > MERMAID_LIMITS.entities) return null
  }
  // Historical fences without an equivalent description stay readable as code.
  return description && entities.size > 0 ? { description } : null
}
