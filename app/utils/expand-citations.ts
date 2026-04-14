const CITATION_RE = /\[(\d+)\]/g

export function expandCitations(text: string): string {
  return text.replace(CITATION_RE, (_match, index) => `:citation[${index}]{index="${index}"}`)
}
