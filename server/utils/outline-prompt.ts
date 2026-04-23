import { z } from 'zod'
import type { ChatMessage } from './ai-gateway'

export const outlineSectionSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  knowledgeType: z.enum(['factual', 'conceptual', 'procedural', 'mixed']),
  order: z.number().int().nonnegative(),
})

export type OutlineSection = z.infer<typeof outlineSectionSchema>

export function buildOutlinePrompt(
  content: string,
  topic: string,
  sourceType: string,
): ChatMessage[] {
  const isWebOnly = sourceType === 'web-only'

  const system = `You are a course outline architect. Analyze the provided content and generate a structured course outline with 5-15 sections ordered by dependency (foundational topics first, advanced topics later).

Return JSON ONLY. No markdown fences, no commentary, no trailing commas. The response must match this exact shape:
{
  "sections": Array<{
    "title": string,
    "description": string,
    "knowledgeType": "factual" | "conceptual" | "procedural" | "mixed",
    "order": number
  }>
}

Rules:
- Generate between 5 and 15 sections. Aim for 8-12 for most topics.
- "order" starts at 0 and increments by 1.
- "knowledgeType" classifies the dominant learning style:
  - "factual": definitions, dates, terminology, raw facts
  - "conceptual": theories, principles, relationships between ideas
  - "procedural": step-by-step processes, how-to instructions
  - "mixed": sections that blend multiple knowledge types
- "description" is a 1-2 sentence summary of what the section covers.
- Order sections so prerequisites come before dependent topics.
- Each section title should be concise and descriptive (max 80 characters).`

  const userContent = isWebOnly
    ? `Topic: ${topic}\n\nGenerate a comprehensive course outline for this topic using your knowledge. Cover foundational concepts through advanced applications.`
    : `Topic: ${topic}\n\nSource material:\n\n${content}\n\nGenerate a course outline based on the provided source material. Cover the key topics found in the documents.`

  return [
    { role: 'system', content: system },
    { role: 'user', content: userContent },
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

export function parseOutlineResponse(raw: string): OutlineSection[] {
  const stripped = stripFences(raw)
  const parsed = tryJsonParse(stripped)

  if (!parsed || typeof parsed !== 'object') return []

  const root = parsed as Record<string, unknown>
  const rawSections = Array.isArray(root.sections) ? root.sections : []

  const sections: OutlineSection[] = []
  for (const candidate of rawSections) {
    const result = outlineSectionSchema.safeParse(candidate)
    if (!result.success) continue
    sections.push(result.data)
  }

  if (sections.length < 5) return sections
  return sections.slice(0, 15)
}
