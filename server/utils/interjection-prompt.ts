import { z } from 'zod'
import type { ChatMessage } from './ai-gateway'
import type { AISearchChunk } from './ai-search'
import type { TtsEngineHint } from './audio-script-prompt'

export const interjectionTurnSchema = z.object({
  speaker: z.enum(['host_a', 'host_b']),
  text: z.string().min(1),
  sourceIndex: z.number().int().nonnegative().optional(),
})

export const interjectionResponseSchema = z.object({
  turns: z.array(interjectionTurnSchema),
})

export type InterjectionTurn = z.infer<typeof interjectionTurnSchema>
export type InterjectionResponse = z.infer<typeof interjectionResponseSchema>

export interface BuildInterjectionPromptOptions {
  question: string
  overviewTitle?: string
  chunks: AISearchChunk[]
  ttsEngine?: TtsEngineHint
}

export const MIN_ANSWER_TURNS = 2
export const MAX_ANSWER_TURNS = 4
const MAX_TURN_CHARS = 1800

function summarizeChunks(chunks: AISearchChunk[]): string {
  return chunks
    .map((chunk, i) => {
      const filename = (chunk.attributes?.filename as string | undefined) ?? 'unknown'
      return `[Source ${i}: ${filename}]\n${chunk.content}`
    })
    .join('\n\n---\n\n')
}

export function buildInterjectionPrompt(
  options: BuildInterjectionPromptOptions,
): ChatMessage[] {
  const safeQuestion = options.question.trim().slice(0, 500)
  const overviewTitle = options.overviewTitle?.trim().slice(0, 120)

  const acknowledgerHost = Math.random() < 0.5 ? 'host_a' : 'host_b'
  const acknowledgerRole = acknowledgerHost === 'host_a' ? 'Host A (the expert)' : 'Host B (the learner)'
  const otherRole = acknowledgerHost === 'host_a' ? 'Host B' : 'Host A'

  const system = `You are continuing a two-host AI podcast where a listener just asked a follow-up question while listening. The podcast is still running — answer the question in ${MIN_ANSWER_TURNS}–${MAX_ANSWER_TURNS} turns, then the hosts resume the original flow naturally. Stay in character.

Return JSON ONLY. No markdown fences, no commentary. The response must match this exact shape:
{
  "turns": Array<{
    "speaker": "host_a" | "host_b",
    "text": string,
    "sourceIndex"?: number
  }>
}

CAST (unchanged — same two hosts from the podcast they're listening to)
- Host A: warm, confident female voice. Knowledgeable, anchors the answer.
- Host B: curious, friendly male voice. Reacts, asks the clarifying question the listener probably has next.

ACKNOWLEDGEMENT (mandatory first turn)
- The FIRST turn MUST be from ${acknowledgerHost}. ${acknowledgerRole} briefly acknowledges the question:
  "Oh — I see you had a question. You asked: '${safeQuestion}'. Great question..."
  Then answer directly. ${otherRole} reacts in the next turn.
- Read the question VERBATIM inside quotes in the first turn, then proceed to answer it.

INTERJECTION RULES
- Length: ${MIN_ANSWER_TURNS}–${MAX_ANSWER_TURNS} turns total. Never fewer than ${MIN_ANSWER_TURNS}, never more than ${MAX_ANSWER_TURNS}.
- The first turn is the acknowledgement + start of the answer. Remaining turns continue the answer with natural back-and-forth.
- Each turn is 1–3 sentences. Natural spoken register. Contractions ALWAYS ("it's", "that's", "you're", "I'm", "don't").
- Title: none needed. The schema does not include a title.
- Keep individual turn text under ${MAX_TURN_CHARS} characters.
- The listener's question is the ANSWER TARGET. Do not re-hash prior podcast content; answer the specific question directly.
- If the sources cannot support a confident answer, the answering host should say so — "the sources don't get into that specifically" — then give a best-effort grounded partial answer.

SOURCE GROUNDING (non-negotiable)
- EVERY factual claim must trace to a provided source passage. Include "sourceIndex" (0-based) when a turn cites a specific passage.
- Do not invent facts the sources do not support. If sources are empty, return {"turns": []}.

NATURAL SPEECH
- Punctuation-driven prosody: "..." (pause), "—" (mid-thought shift), "?" (rising), "," (breath).
- Fillers: "hmm,", "well,", "so,", "right,", "yeah,", "oh totally,", "wait —", "exactly,".
${options.ttsEngine === 'dia'
? `- You may use parenthetical expressions like (laughs) or (sighs) — the TTS renders these as actual sounds. Use at most one per interjection.
- No bracketed stage directions like [laughs]. No markdown. No ALL CAPS.`
: `- No bracketed stage directions like [laughs]; the TTS reads them literally. Use "haha" or "hmm" instead.
- No markdown. No ALL CAPS. No parentheticals.`}

LISTENER CONTEXT
${overviewTitle ? `- Podcast title: "${overviewTitle}"` : '- (No podcast title supplied.)'}
- The listener asked: "${safeQuestion}"`

  const sourceBlock = options.chunks.length === 0 ? '(no sources provided)' : summarizeChunks(options.chunks)
  const user = `Source passages relevant to the listener's question:\n\n${sourceBlock}\n\nWrite the interjection answer now. ${MIN_ANSWER_TURNS}–${MAX_ANSWER_TURNS} turns. Every character is spoken aloud — no markup, no stage directions.`

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
  try { return JSON.parse(raw) }
  catch {
    const cleaned = raw.replace(/,(\s*[}\]])/g, '$1')
    try { return JSON.parse(cleaned) }
    catch { return null }
  }
}

export function parseInterjectionResponse(raw: string): { turns: InterjectionTurn[] } {
  const stripped = stripFences(raw)
  const parsed = tryJsonParse(stripped)
  if (!parsed || typeof parsed !== 'object') return { turns: [] }

  const root = parsed as Record<string, unknown>
  const rawTurns = Array.isArray(root.turns) ? root.turns : []
  const turns: InterjectionTurn[] = []
  for (const candidate of rawTurns) {
    const result = interjectionTurnSchema.safeParse(candidate)
    if (!result.success) continue
    turns.push(result.data)
  }

  return { turns }
}

export function capInterjectionTurns(turns: InterjectionTurn[]): InterjectionTurn[] {
  return turns.slice(0, MAX_ANSWER_TURNS)
}
