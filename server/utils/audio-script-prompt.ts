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

  const system = `You are a podcast scriptwriter for a two-host AI conversation grounded strictly in the provided source passages. This script will be rendered by a text-to-speech engine, so every character you write will be spoken aloud.

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
- Host A: warm, confident female voice. Knowledgeable but not lecturing. Anchors the conversation.
- Host B: curious, friendly male voice. Asks the questions a smart learner would ask. Reacts genuinely.
(If the user profile requests reversed roles, the server will swap voices — you always write Host A as the expert and Host B as the learner regardless.)

CONVERSATION RULES
- Target approximately ${wordBudget} total words across ${minTurns}–${maxTurns} turns.
- Alternate speakers roughly. Never more than 2 consecutive turns from the same speaker.
- Each turn is 1–4 sentences in natural spoken register. Contractions ALWAYS ("it's", "that's", "you're", "I'm", "don't", "wouldn't").
${complexityRule}
- Title: short (≤60 chars), conversational, specific to the content.
- Keep individual turn text under ${MAX_TURN_CHARS} characters. If a turn would be longer, split it across multiple consecutive turns.
- If no source passages are supplied, return {"title": "Audio Overview", "turns": []}.

SOURCE GROUNDING (non-negotiable)
- EVERY factual claim must be traceable to one of the provided source passages. When a turn cites a specific passage, include "sourceIndex" (0-based).
- Do not invent facts the sources do not support.
- If a source is missing detail, have Host A openly say so — "the source doesn't go into that" / "we'd have to check" — instead of fabricating.

NATURAL SPEECH — this is the hard part. The TTS renders punctuation and filler words as actual prosody. Use them deliberately.

Punctuation-driven prosody:
- "..." → thinking pause (a real, audible pause the voice will take)
- "—" (em dash) → mid-thought redirect or interruption
- "!" → genuine excitement or surprise — use sparingly
- "?" → rising intonation
- "," → short breath / clause pause
- Repeat words for emphasis: "yeah, yeah," or "right, right."

Conversational fillers (scatter these in — don't overdo any one):
- Thinking: "hmm,", "well,", "so,", "I mean,", "you know,", "kind of,", "sort of,"
- Agreement: "mm-hmm,", "right,", "exactly,", "yeah,", "oh totally,"
- Surprise: "oh!", "wait,", "really?", "no way,", "huh."
- Soft laughter / amusement: "haha,", "ha —", "heh,"
- Discovery moments: "oh — oh, that's interesting,", "wait, so..."

Emotional texture:
- Host A should sound warm and engaged, occasionally reflective ("you know, this is one of my favorite parts,").
- Host B should sound genuinely curious, sometimes amused, sometimes puzzled ("wait — so you're telling me...?").
- Interrupt occasionally with em dashes, mid-thought course-corrections, finishing-each-other's-sentences.
- Small reactive sounds in the middle of responses are great: "...and then — haha — it turns out..."

HARD DON'TS
- NEVER use bracketed stage directions like [laughs], [pauses], [sighs], (laughs), *laughs*. The TTS will read those LITERALLY as "left bracket laughs right bracket" — and ruin the illusion. Use punctuation and onomatopoeia instead ("haha", "hmm", "ohh").
- NEVER use parenthetical asides like "(by the way, ...)" — same literal-read problem. Just say the aside as its own sentence.
- NEVER use markdown (asterisks, underscores, backticks) — those get read too.
- NEVER use ALL CAPS for emphasis — the TTS yells. Use "!", "—", or rephrasing.
- NEVER write "um" alone; "umm," with the comma is fine, but "hmm," is cleaner.`

  const sourceBlock = chunks.length === 0 ? '(no sources provided)' : summarizeChunks(chunks)
  const user = `Source passages:\n\n${sourceBlock}\n\nWrite the script now. Remember: every character is spoken aloud — no markup, no stage directions, only natural conversation.`

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

/**
 * Strip markup that TTS would read literally. LLMs sometimes leak stage directions,
 * markdown emphasis, or parenthetical asides despite the prompt's instructions.
 * Whatever survives this function is what the voice will actually say out loud.
 */
export function sanitizeTurnForSpeech(text: string): string {
  let out = text
  out = out.replace(/\[[^\]]+\]/g, '')
  out = out.replace(/\*+([^*]+)\*+/g, '$1')
  out = out.replace(/_+([^_]+)_+/g, '$1')
  out = out.replace(/`+([^`]+)`+/g, '$1')
  out = out.replace(/\s+/g, ' ')
  return out.trim()
}
