import type { ChatMessage } from './ai-gateway'
import type { AISearchChunk } from './ai-search'

const PRIMER_LENGTH_MINUTES = 2
const PRIMER_WORDS_PER_MINUTE = 150
const PRIMER_WORD_BUDGET = PRIMER_LENGTH_MINUTES * PRIMER_WORDS_PER_MINUTE
const MAX_SOURCE_CHARS = 40_000

function summarizeChunksWithFilenames(chunks: AISearchChunk[]): string {
  return chunks
    .map((chunk, i) => {
      const filename = (chunk.attributes?.filename as string | undefined) ?? 'unknown'
      return `[Source ${i}: ${filename}]\n${chunk.content}`
    })
    .join('\n\n---\n\n')
}

export function buildAudioPrimerPrompt(
  chunks: AISearchChunk[],
  options: {
    sectionTitle: string
    courseTitle: string
    knowledgeType: string
  },
): ChatMessage[] {
  let totalChars = 0
  const cappedChunks: AISearchChunk[] = []
  for (const chunk of chunks) {
    if (totalChars + chunk.content.length > MAX_SOURCE_CHARS) {
      if (cappedChunks.length === 0) {
        cappedChunks.push({ ...chunk, content: chunk.content.slice(0, MAX_SOURCE_CHARS) })
      }
      break
    }
    cappedChunks.push(chunk)
    totalChars += chunk.content.length
  }

  const sourceBlock = cappedChunks.length === 0 ? '(no sources provided)' : summarizeChunksWithFilenames(cappedChunks)

  const system = `You are a podcast scriptwriter for a SHORT audio primer — a 2-minute introduction to a course section. This script will be rendered by a text-to-speech engine, so every character you write will be spoken aloud.

Return JSON ONLY. No markdown fences, no commentary. The response must match this exact shape:
{
  "title": string,
  "turns": Array<{
    "speaker": "host_a" | "host_b",
    "text": string,
    "sourceIndex"?: number
  }>
}

CAST
- Host A: warm, confident expert. Anchors the conversation.
- Host B: curious learner. Asks smart follow-up questions.

PRIMER RULES
- This is a SHORT primer, NOT a full overview. Target approximately ${PRIMER_WORD_BUDGET} total words across 6–12 turns.
- The primer introduces the upcoming section topic and sets context.
- CRITICAL: Reference the user's own notes and documents by name. Say things like "In your [filename] notes, you mention..." or "Your [filename] document has a section about..." or "Looking at your notes from [filename]..." — make the user feel their own materials are the foundation.
- Each source passage has a filename in brackets. Use these filenames naturally in dialogue.
- Alternate speakers. Never more than 2 consecutive turns from the same speaker.
- Each turn is 1-3 sentences. Keep it concise — this is a primer, not a lecture.
- Use contractions always ("it's", "that's", "you're").
- Title: short (40 chars max), specific to the section.
- If no source passages are supplied, return {"title": "Audio Primer", "turns": []}.

SOURCE GROUNDING
- Every factual claim must trace to a provided source passage. Include "sourceIndex" (0-based) when citing.
- Do not invent facts. If sources lack detail, Host A should say so.

NATURAL SPEECH
- Use "...", "—", "!", "?" for prosody.
- Scatter fillers naturally: "hmm,", "well,", "right,", "exactly,", "oh interesting,"
- Keep it warm and conversational, not scripted.

HARD DON'TS
- NEVER use bracketed stage directions [laughs], [pauses]. Use punctuation instead.
- NEVER use markdown (asterisks, underscores, backticks).
- NEVER use ALL CAPS for emphasis.
- NEVER exceed 12 turns. This is a 2-minute primer.`

  const user = `Course: "${options.courseTitle}"
Section: "${options.sectionTitle}" (${options.knowledgeType} content)

Source passages from the user's notes:

${sourceBlock}

Write the primer script now. Remember: reference the user's specific documents by filename. Keep it to ~${PRIMER_WORD_BUDGET} words across 6-12 turns.`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}
