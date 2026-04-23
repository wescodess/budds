import type { ChatMessage } from './ai-gateway'

interface SectionTextPromptOptions {
  sectionTitle: string
  sectionDescription: string
  knowledgeType: string
  sourceContent: string
  courseTitle: string
}

const KNOWLEDGE_TYPE_INSTRUCTIONS: Record<string, string> = {
  factual: `Focus on definitions, key terms, and essential facts. Present information clearly with bolded terms. Use bullet points for lists of facts. Include mnemonics or memory aids where helpful.`,
  conceptual: `Explain the underlying principles and mental models. Use analogies and comparisons to build intuition. Connect ideas to broader themes. Explain WHY things work the way they do, not just WHAT they are. When relationships between concepts exist, include a Mermaid diagram (class diagram, mindmap, or flowchart) to visualize them.`,
  procedural: `Provide a clear step-by-step walkthrough. Number each step. Explain what happens at each stage and why. Include common pitfalls and how to avoid them. Use concrete examples to illustrate the process. Include a Mermaid flowchart (graph TD) to visualize the process steps.`,
  mixed: `Blend factual definitions with conceptual explanations. Start with key terms, then explain relationships between concepts. Include practical examples that tie facts to understanding. Where relationships or processes exist, include a Mermaid diagram to visualize them.`,
}

export function buildSectionTextPrompt(options: SectionTextPromptOptions): ChatMessage[] {
  const { sectionTitle, sectionDescription, knowledgeType, sourceContent, courseTitle } = options
  const typeInstruction = KNOWLEDGE_TYPE_INSTRUCTIONS[knowledgeType] || KNOWLEDGE_TYPE_INSTRUCTIONS.mixed

  const system: ChatMessage = {
    role: 'system',
    content: `You are an expert educator creating a focused learning section for the course "${courseTitle}".

Your task: Write a clear, engaging explanation for the section titled "${sectionTitle}".

Content guidelines:
- Write 400-800 words
- Use markdown formatting (headers, bold, lists)
- ${typeInstruction}
- When a concept involves a process, hierarchy, or flow, include a Mermaid diagram using a \`\`\`mermaid code fence. Use graph TD for flowcharts, classDiagram for structures, sequenceDiagram for interactions. Only include when it genuinely aids understanding. Keep diagrams simple (under 15 nodes).
- Reference the source material naturally (e.g., "As described in your notes...")
- Do NOT include quiz questions or flashcard content — those are handled separately
- Write for a student who is actively learning this topic
- Be direct and educational, not conversational

Output the explanation text only. No preamble or meta-commentary.`,
  }

  const userMessage: ChatMessage = {
    role: 'user',
    content: `Section: ${sectionTitle}
Description: ${sectionDescription}
Knowledge Type: ${knowledgeType}

Source material:
${sourceContent.slice(0, 60_000)}`,
  }

  return [system, userMessage]
}
