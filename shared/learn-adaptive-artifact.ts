import { v } from 'convex/values'

export const adaptiveArtifactKindValidator = v.union(v.literal('note'), v.literal('plan'), v.literal('draft'), v.literal('answer'), v.literal('other'))
export const adaptiveArtifactStatusValidator = v.union(v.literal('draft'), v.literal('saved'))

export function boundedArtifactText(title: string, summary: string, status: 'draft' | 'saved') {
  const normalizedTitle = title.trim()
  const normalizedSummary = summary.trim()
  const encoder = new TextEncoder()
  if (!normalizedTitle || encoder.encode(normalizedTitle).length > 160) throw new Error('Artifact title must be between 1 and 160 bytes')
  if (encoder.encode(normalizedSummary).length > 4096 || status === 'saved' && !normalizedSummary) throw new Error('Artifact summary must be between 1 and 4096 bytes when saved')
  if ([...normalizedTitle, ...normalizedSummary].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 && code !== 9 && code !== 10 && code !== 13
  })) throw new Error('Artifact text must be plain text')
  return { title: normalizedTitle, summary: normalizedSummary }
}
