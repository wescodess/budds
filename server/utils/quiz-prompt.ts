import { z } from 'zod'
import type { ChatMessage } from './ai-gateway'
import type { AISearchChunk } from './ai-search'

export const quizQuestionSchema = z.object({
  order: z.number().int().nonnegative(),
  question: z.string().min(1),
  type: z.enum(['multiple-choice', 'free-response']),
  options: z.array(z.string()).optional(),
  correctAnswer: z.string().min(1),
  sourceIndex: z.number().int().nonnegative(),
})

export const quizResponseSchema = z.object({
  title: z.string().min(1),
  questions: z.array(quizQuestionSchema),
})

export type QuizQuestion = z.infer<typeof quizQuestionSchema>
export type QuizResponse = z.infer<typeof quizResponseSchema>

export interface BuildQuizPromptOptions {
  questionCount?: number
}

function summarizeChunks(chunks: AISearchChunk[]): string {
  return chunks
    .map((chunk, i) => {
      const filename = (chunk.attributes?.filename as string | undefined) ?? 'unknown'
      return `[Source ${i}: ${filename}]\n${chunk.content}`
    })
    .join('\n\n---\n\n')
}

export function buildQuizPrompt(
  chunks: AISearchChunk[],
  options: BuildQuizPromptOptions = {},
): ChatMessage[] {
  const target = Math.min(Math.max(options.questionCount ?? 8, 3), 8)

  const system = `You are a quiz-authoring assistant. Produce a short, rigorous quiz grounded in the provided source passages.

Return JSON ONLY. No markdown fences, no commentary, no trailing commas. The response must match this exact shape:
{
  "title": string,
  "questions": Array<{
    "order": number,
    "question": string,
    "type": "multiple-choice" | "free-response",
    "options"?: string[],
    "correctAnswer": string,
    "sourceIndex": number
  }>
}

Rules:
- Target ${target} questions total, mixed roughly 60% multiple-choice / 40% free-response.
- Every multiple-choice question MUST have exactly 4 entries in "options", with one correct. "correctAnswer" must exactly match one of the options.
- Free-response items omit "options" and put the canonical short answer in "correctAnswer".
- "sourceIndex" is a 0-based index into the source passages array the user will send. Reference only the supplied passages. Never invent filenames or quote text that is not in a passage.
- If fewer than 2 source passages are supplied, return {"title": "Quiz", "questions": []} and nothing else.
- "order" starts at 0 and increments by 1 for each question in output order.`

  const sourceBlock = chunks.length === 0
    ? '(no sources provided)'
    : summarizeChunks(chunks)

  const user = `Source passages:\n\n${sourceBlock}\n\nWrite the quiz now.`

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

export function parseQuizResponse(raw: string): { title: string; questions: QuizQuestion[] } {
  const stripped = stripFences(raw)
  const parsed = tryJsonParse(stripped)

  if (!parsed || typeof parsed !== 'object') {
    return { title: 'Quiz', questions: [] }
  }

  const root = parsed as Record<string, unknown>
  const title = typeof root.title === 'string' && root.title.trim().length > 0
    ? root.title.trim().slice(0, 120)
    : 'Quiz'

  const rawQuestions = Array.isArray(root.questions) ? root.questions : []
  const questions: QuizQuestion[] = []

  for (const candidate of rawQuestions) {
    const result = quizQuestionSchema.safeParse(candidate)
    if (!result.success) continue
    const q = result.data
    if (q.type === 'multiple-choice') {
      if (!q.options || q.options.length !== 4) continue
      if (!q.options.includes(q.correctAnswer)) continue
    }
    questions.push(q)
  }

  return { title, questions }
}
