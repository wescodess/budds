import { normalizeAssistantCitations } from './normalize-assistant-citations'

const CITATION_RE = /\[(\d+)\]/g

export function expandCitations(text: string): string {
  return normalizeAssistantCitations(text)
    .replace(CITATION_RE, (_match, index) => `<citation index="${index}">${index}</citation>`)
}
