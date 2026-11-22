import { generatedTextFallback } from './generated-markdown'

export function normalizeAssistantCitations(text: string): string {
  return generatedTextFallback(text, Number.MAX_SAFE_INTEGER)
    .map(segment => segment.type === 'text' ? segment.value : `[${segment.index}]`).join('')
}
