export function normalizeLearnCasePrompt(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
}

export function learnCasePromptsMatch(left: string, right: string): boolean {
  return normalizeLearnCasePrompt(left) === normalizeLearnCasePrompt(right)
}
