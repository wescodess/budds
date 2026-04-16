import { z } from 'zod'
import type { ChatMessage } from './ai-gateway'
import type { AISearchChunk } from './ai-search'

export const flashcardSchema = z.object({
  order: z.number().int().nonnegative(),
  front: z.string().min(1),
  back: z.string().min(1),
  sourceIndex: z.number().int().nonnegative(),
})

export const flashcardResponseSchema = z.object({
  title: z.string().min(1),
  cards: z.array(flashcardSchema),
})

export type Flashcard = z.infer<typeof flashcardSchema>
export type FlashcardResponse = z.infer<typeof flashcardResponseSchema>

export interface BuildFlashcardPromptOptions {
  cardCount?: number
}

function summarizeChunks(chunks: AISearchChunk[]): string {
  return chunks
    .map((chunk, i) => {
      const filename = (chunk.attributes?.filename as string | undefined) ?? 'unknown'
      return `[Source ${i}: ${filename}]\n${chunk.content}`
    })
    .join('\n\n---\n\n')
}

export function buildFlashcardPrompt(
  chunks: AISearchChunk[],
  options: BuildFlashcardPromptOptions = {},
): ChatMessage[] {
  const target = Math.min(Math.max(options.cardCount ?? 12, 6), 16)

  const system = `You are a flashcard-authoring assistant. Produce a set of study flashcards grounded in the provided source passages.

Return JSON ONLY. No markdown fences, no commentary, no trailing commas. The response must match this exact shape:
{
  "title": string,
  "cards": Array<{
    "order": number,
    "front": string,
    "back": string,
    "sourceIndex": number
  }>
}

Rules:
- Target ${target} cards total. Each card is a short memorizable front/back pair.
- "front" is a prompt, question, or term (one line preferred). "back" is a concise definition or answer.
- Do NOT produce multiple-choice questions or options arrays. Just front/back.
- "sourceIndex" is a 0-based index into the source passages array the user will send. Reference only the supplied passages. Never invent filenames or quote text that is not in a passage.
- If no source passages are supplied, return {"title": "Flash Cards", "cards": []} and nothing else.
- "order" starts at 0 and increments by 1 for each card in output order.`

  const sourceBlock = chunks.length === 0
    ? '(no sources provided)'
    : summarizeChunks(chunks)

  const user = `Source passages:\n\n${sourceBlock}\n\nWrite the flashcards now.`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

function stripFences(raw: string): string {
  const trimmed = raw.trim()
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenceMatch) return fenceMatch[1]!.trim()
  return trimmed
}

function tryJsonParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw)
  } catch {
    const cleaned = raw.replace(/,(\s*[}\]])/g, '$1')
    try {
      return JSON.parse(cleaned)
    } catch {
      return null
    }
  }
}

export function parseFlashcardResponse(raw: string): { title: string; cards: Flashcard[] } {
  const stripped = stripFences(raw)
  const parsed = tryJsonParse(stripped)

  if (!parsed || typeof parsed !== 'object') {
    return { title: 'Flash Cards', cards: [] }
  }

  const root = parsed as Record<string, unknown>
  const title = typeof root.title === 'string' && root.title.trim().length > 0
    ? root.title.trim().slice(0, 120)
    : 'Flash Cards'

  const rawCards = Array.isArray(root.cards) ? root.cards : []
  const cards: Flashcard[] = []

  for (const candidate of rawCards) {
    const result = flashcardSchema.safeParse(candidate)
    if (!result.success) continue
    cards.push(result.data)
  }

  return { title, cards }
}
