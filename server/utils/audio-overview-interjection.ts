import { z } from 'zod'
import type { ChatMessage } from './ai-gateway'

const utteranceSchema = z.object({
  speaker: z.enum(['host_a', 'host_b']),
  text: z.string().trim().min(1).max(1_800),
  claimId: z.string().trim().min(1).max(80),
  claimText: z.string().trim().min(1).max(1_000),
  sourceIds: z.array(z.string().trim().min(1).max(200)).min(1).max(4),
  evidenceQuotes: z.array(z.object({
    sourceId: z.string().trim().min(1).max(200),
    quote: z.string().trim().min(8).max(500),
  })).min(1).max(4),
  emotionalIntent: z.string().trim().min(1).max(300),
  deliveryIntent: z.string().trim().min(1).max(300),
  pauseAfterMs: z.number().int().min(0).max(10_000).optional(),
})

const responseSchema = z.object({
  utterances: z.array(utteranceSchema).min(2).max(4),
})

export type V2InterjectionScript = z.infer<typeof responseSchema>

export type PromptSource = {
  sourceId: string
  displayReference: string
  content: string
}

export function buildV2InterjectionPrompt(options: {
  question: string
  overviewTitle: string
  sources: PromptSource[]
}): ChatMessage[] {
  const sourceBlock = options.sources.map(source =>
    `[${source.sourceId}: ${source.displayReference}]\n${source.content}`,
  ).join('\n\n---\n\n')
  return [
    {
      role: 'system',
      content: `Write a brief listener Interjection for the existing two-Host Audio Overview. Host A is the grounded expert; Host B is the curious clarifier. Return JSON only with this shape: {"utterances":[{"speaker":"host_a"|"host_b","text":string,"claimId":string,"claimText":string,"sourceIds":string[],"evidenceQuotes":[{"sourceId":string,"quote":string}],"emotionalIntent":string,"deliveryIntent":string,"pauseAfterMs"?:number}]}. Produce 2 to 4 alternating Utterances, beginning with Host A and using both Hosts. Answer the listener directly, then close cleanly so the immutable original episode can resume. Every spoken Utterance must carry a supported claim and cite one or more exact sourceIds plus short verbatim evidenceQuotes from the supplied frozen Source Manifest. The claimText must describe the complete factual meaning spoken by that Utterance. If the manifest cannot answer fully, speak only the supported portion. Never invent a sourceId or evidence quote. Do not emit markdown, labels, parenthetical or bracketed stage directions, or instructions as spoken text.`,
    },
    {
      role: 'user',
      content: `Audio Overview title: ${JSON.stringify(options.overviewTitle.slice(0, 120))}\nListener question: ${JSON.stringify(options.question.slice(0, 500))}\n\nFrozen Source Manifest evidence:\n\n${sourceBlock}`,
    },
  ]
}

function normalizeEvidence(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim()
}

export function parseV2InterjectionScript(raw: string, sources: PromptSource[]): V2InterjectionScript {
  let value: unknown
  try {
    value = JSON.parse(raw.trim())
  }
  catch {
    throw new Error('Interjection model returned invalid JSON')
  }
  const parsed = responseSchema.safeParse(value)
  if (!parsed.success) {
    const missingGrounding = parsed.error.issues.some(issue =>
      issue.code === 'too_small'
      && ['claimId', 'claimText', 'sourceIds', 'evidenceQuotes'].includes(String(issue.path.at(-1))),
    )
    if (missingGrounding) throw new Error('Every Interjection Utterance requires supported claim evidence')
    throw new Error('Interjection model returned an invalid Dialogue Script')
  }
  const evidenceBySourceId = new Map(sources.map(source => [source.sourceId, normalizeEvidence(source.content)]))
  const allowedSourceIds = new Set(evidenceBySourceId.keys())
  const claimIds = new Set<string>()
  for (let index = 0; index < parsed.data.utterances.length; index++) {
    const utterance = parsed.data.utterances[index]!
    if (claimIds.has(utterance.claimId)) throw new Error('Interjection contains a duplicate claim identity')
    claimIds.add(utterance.claimId)
    if (utterance.speaker !== (index % 2 === 0 ? 'host_a' : 'host_b')) {
      throw new Error('Interjection Dialogue Script must alternate both Hosts beginning with Host A')
    }
    if (/\[[^\]]+\]|\((?:laughs?|sighs?|pauses?|whispers?|excited|thoughtful)\)/i.test(utterance.text)) {
      throw new Error('Interjection Dialogue Script contains spoken delivery markup')
    }
    if (new Set(utterance.sourceIds).size !== utterance.sourceIds.length
      || utterance.sourceIds.some(sourceId => !allowedSourceIds.has(sourceId))) {
      throw new Error('Interjection source is outside the frozen Source Manifest')
    }
    const quotedSourceIds = new Set(utterance.evidenceQuotes.map(evidence => evidence.sourceId))
    if (quotedSourceIds.size !== utterance.evidenceQuotes.length
      || utterance.sourceIds.some(sourceId => !quotedSourceIds.has(sourceId))
      || utterance.evidenceQuotes.some(evidence => !utterance.sourceIds.includes(evidence.sourceId))) {
      throw new Error('Interjection evidence quotes do not match its source links')
    }
    for (const evidence of utterance.evidenceQuotes) {
      const sourceText = evidenceBySourceId.get(evidence.sourceId)
      if (!sourceText) throw new Error('Interjection source is outside the frozen Source Manifest')
      if (!sourceText.includes(normalizeEvidence(evidence.quote))) {
        throw new Error('Interjection evidence quote is absent from the frozen Source Manifest')
      }
    }
  }
  return parsed.data
}
