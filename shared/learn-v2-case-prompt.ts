export function normalizeLearnCasePrompt(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
}

export function learnCasePromptsOverlap(left: string, right: string): boolean {
  const a = normalizeLearnCasePrompt(left)
  const b = normalizeLearnCasePrompt(right)
  if (a === b) return true
  const tokens = (text: string) => text.match(/[\p{L}\p{N}]+/gu) ?? []
  const first = tokens(a)
  const second = tokens(b)
  if (!first.length || !second.length) return true
  const remaining = new Map<string, number>()
  for (const token of first) remaining.set(token, (remaining.get(token) ?? 0) + 1)
  let common = 0
  for (const token of second) {
    const count = remaining.get(token) ?? 0
    if (count) { common++; remaining.set(token, count - 1) }
  }
  return 2 * common / (first.length + second.length) >= 0.85
}
