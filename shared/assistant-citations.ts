const LABELED_SOURCE_RE = /\[\s*Source\s+(\d+)(?:\s*:\s*[^\]]*)?\s*\]/gi
const PAREN_SOURCE_RE = /\(\s*Sources?\s+(\d+)\s*\)/gi
const BARE_SOURCE_RE = /\bSource\s+(\d+)\b/gi

export function normalizeAssistantCitations(text: string): string {
  return text
    .replace(LABELED_SOURCE_RE, '[$1]')
    .replace(PAREN_SOURCE_RE, '[$1]')
    .replace(BARE_SOURCE_RE, '[$1]')
}
