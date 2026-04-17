import { z } from 'zod'
import type { ChatMessage } from './ai-gateway'
import type { AISearchChunk } from './ai-search'

export const audioTurnSchema = z.object({
  speaker: z.enum(['host_a', 'host_b']),
  text: z.string().min(1),
  sourceIndex: z.number().int().nonnegative().optional(),
})

export const audioScriptResponseSchema = z.object({
  title: z.string().min(1),
  turns: z.array(audioTurnSchema),
})

export type AudioScriptTurn = z.infer<typeof audioTurnSchema>
export type AudioScriptResponse = z.infer<typeof audioScriptResponseSchema>

export interface BuildAudioScriptPromptOptions {
  lengthMinutes?: number
  complexity?: 'beginner' | 'expert'
  title?: string
}

const WORDS_PER_MINUTE = 150
const MAX_TURN_CHARS = 1800

function summarizeChunks(chunks: AISearchChunk[]): string {
  return chunks
    .map((chunk, i) => {
      const filename = (chunk.attributes?.filename as string | undefined) ?? 'unknown'
      return `[Source ${i}: ${filename}]\n${chunk.content}`
    })
    .join('\n\n---\n\n')
}

function buildComplexityRule(complexity?: 'beginner' | 'expert'): string {
  if (complexity === 'expert') {
    return '- Complexity: EXPERT. Use precise technical terminology; do not over-define basic concepts.'
  }
  return '- Complexity: BEGINNER. Define jargon on first use. Favor everyday analogies. Host B is a curious learner; Host A explains without condescension.'
}

export function buildAudioScriptPrompt(
  chunks: AISearchChunk[],
  options: BuildAudioScriptPromptOptions = {},
): ChatMessage[] {
  const lengthMinutes = Math.min(Math.max(options.lengthMinutes ?? 10, 3), 30)
  const wordBudget = Math.round(lengthMinutes * WORDS_PER_MINUTE)
  const minTurns = Math.max(18, Math.round(wordBudget / 60))
  const maxTurns = Math.max(minTurns + 6, Math.round(wordBudget / 35))
  const complexityRule = buildComplexityRule(options.complexity)

  const system = `You are a podcast scriptwriter for a two-host AI conversation grounded strictly in the provided source passages.

Return JSON ONLY. No markdown fences, no commentary. The response must match this exact shape:
{
  "title": string,
  "turns": Array<{
    "speaker": "host_a" | "host_b",
    "text": string,
    "sourceIndex"?: number
  }>
}

Rules:
- Target approximately ${wordBudget} total words across ${minTurns}–${maxTurns} turns.
- Host A is the expert guiding the conversation; Host B is the curious learner asking clarifying questions.
- Alternate speakers roughly (never more than 2 consecutive turns from the same speaker).
- Each turn is 1–4 sentences, natural spoken register, contractions allowed. Do not include stage directions like [laughs].
- EVERY factual claim must be traceable to one of the provided source passages. When a turn cites a specific passage, include "sourceIndex" (0-based). Do not invent facts the sources do not support.
- If a source is missing detail, have Host A openly say so; do not fabricate.
${complexityRule}
- Title: short (≤60 chars), conversational, specific to the content.
- Keep individual turn text under ${MAX_TURN_CHARS} characters. If a turn would be longer, split across multiple consecutive turns.
- If no source passages are supplied, return {"title": "Audio Overview", "turns": []}.`

  const sourceBlock = chunks.length === 0 ? '(no sources provided)' : summarizeChunks(chunks)
  const user = `Source passages:\n\n${sourceBlock}\n\nWrite the script now.`

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
  }
  catch {
    const cleaned = raw.replace(/,(\s*[}\]])/g, '$1')
    try {
      return JSON.parse(cleaned)
    }
    catch {
      return null
    }
  }
}

export function parseAudioScriptResponse(raw: string): { title: string; turns: AudioScriptTurn[] } {
  const stripped = stripFences(raw)
  const parsed = tryJsonParse(stripped)
  if (!parsed || typeof parsed !== 'object') return { title: 'Audio Overview', turns: [] }

  const root = parsed as Record<string, unknown>
  const title = typeof root.title === 'string' && root.title.trim().length > 0
    ? root.title.trim().slice(0, 120)
    : 'Audio Overview'

  const rawTurns = Array.isArray(root.turns) ? root.turns : []
  const turns: AudioScriptTurn[] = []
  for (const candidate of rawTurns) {
    const result = audioTurnSchema.safeParse(candidate)
    if (!result.success) continue
    turns.push(result.data)
  }

  return { title, turns }
}

export function splitOversizedTurns(turns: AudioScriptTurn[]): AudioScriptTurn[] {
  const out: AudioScriptTurn[] = []
  for (const turn of turns) {
    if (turn.text.length <= MAX_TURN_CHARS) {
      out.push(turn)
      continue
    }
    const sentences = turn.text.split(/(?<=[.!?])\s+/)
    let buffer = ''
    for (const sentence of sentences) {
      if (buffer.length === 0) {
        buffer = sentence
        continue
      }
      if ((buffer + ' ' + sentence).length > MAX_TURN_CHARS) {
        out.push({ speaker: turn.speaker, text: buffer, sourceIndex: turn.sourceIndex })
        buffer = sentence
      }
      else {
        buffer = buffer + ' ' + sentence
      }
    }
    if (buffer.length > 0) {
      if (buffer.length <= MAX_TURN_CHARS) {
        out.push({ speaker: turn.speaker, text: buffer, sourceIndex: turn.sourceIndex })
      }
      else {
        out.push({ speaker: turn.speaker, text: buffer.slice(0, MAX_TURN_CHARS), sourceIndex: turn.sourceIndex })
      }
    }
  }
  return out
}

export function estimateTurnDurationMs(text: string): number {
  return Math.max(1000, Math.ceil(text.length / 14) * 1000)
}
