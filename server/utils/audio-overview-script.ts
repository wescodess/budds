import { z } from 'zod'
import type { ChatMessage } from './ai-gateway'
import type { AISearchChunk } from './ai-search'

const MAX_SOURCE_CHARS = 80_000
const WORDS_PER_MINUTE = 150

function durationWordBounds(lengthMinutes: BuildDialoguePlanPromptOptions['lengthMinutes']) {
  const targetWords = lengthMinutes * WORDS_PER_MINUTE
  return {
    targetWords,
    minimumWords: Math.ceil(targetWords * 0.75),
    maximumWords: Math.floor(targetWords * 1.25),
  }
}

const utteranceSchema = z.object({
  speaker: z.enum(['host_a', 'host_b']),
  text: z.string().trim().min(1).max(2_000),
  claimIds: z.array(z.string().trim().min(1)).min(1).max(12),
  sourceIds: z.array(z.string().trim().min(1)).min(1).max(12),
  emotionalIntent: z.string().trim().min(1).max(240),
  delivery: z.string().trim().min(1).max(240),
  pauseAfterMs: z.number().int().min(0).max(3_000).optional(),
})

const sceneSchema = z.object({
  sceneId: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(120),
  emotionalIntent: z.string().trim().min(1).max(400),
  delivery: z.string().trim().min(1).max(400),
  utterances: z.array(utteranceSchema).min(2).max(30),
})

const claimSchema = z.object({
  claimId: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(1_000),
  status: z.enum(['supported', 'unsupported']),
  sourceIds: z.array(z.string().trim().min(1)).max(12),
  evidenceQuotes: z.array(z.object({
    sourceId: z.string().trim().min(1),
    quote: z.string().trim().min(8).max(2_000),
  })).max(12),
})

export const dialoguePlanSchema = z.object({
  title: z.string().trim().min(1).max(120),
  outline: z.object({
    learningObjectives: z.array(z.string().trim().min(1).max(300)).min(1).max(12),
    narrativeArc: z.array(z.string().trim().min(1).max(300)).min(1).max(20),
    plannedSourceIds: z.array(z.string().trim().min(1)).min(1).max(25),
  }),
  claims: z.array(claimSchema).min(1).max(200),
  scenes: z.array(sceneSchema).min(1).max(20),
})

export type DialoguePlan = z.infer<typeof dialoguePlanSchema>

export interface InvalidEvidenceQuote {
  claimId: string
  sourceId: string
  quote: string
}

export class DialoguePlanEvidenceError extends Error {
  readonly statusCode = 422

  constructor(
    readonly plan: DialoguePlan,
    readonly invalidEvidence: InvalidEvidenceQuote,
  ) {
    super('Claim Ledger evidence quote is absent from the frozen Source Manifest')
    this.name = 'DialoguePlanEvidenceError'
  }
}

export function isDialoguePlanEvidenceError(error: unknown): error is DialoguePlanEvidenceError {
  if (error instanceof DialoguePlanEvidenceError) return true
  if (!error || typeof error !== 'object') return false
  const candidate = error as Record<string, unknown>
  const invalidEvidence = candidate.invalidEvidence
  return candidate.name === 'DialoguePlanEvidenceError'
    && candidate.statusCode === 422
    && dialoguePlanSchema.safeParse(candidate.plan).success
    && !!invalidEvidence
    && typeof invalidEvidence === 'object'
    && typeof (invalidEvidence as Record<string, unknown>).claimId === 'string'
    && typeof (invalidEvidence as Record<string, unknown>).sourceId === 'string'
    && typeof (invalidEvidence as Record<string, unknown>).quote === 'string'
}

export class DialoguePlanDurationError extends Error {
  readonly statusCode = 422

  constructor(
    readonly plan: DialoguePlan,
    readonly actualWords: number,
    readonly targetWords: number,
    readonly minimumWords: number,
    readonly maximumWords: number,
  ) {
    super(
      `Dialogue Script duration is outside the requested tolerance (${actualWords} spoken words; expected ${minimumWords}-${maximumWords})`,
    )
    this.name = 'DialoguePlanDurationError'
  }
}

export function isDialoguePlanDurationError(error: unknown): error is DialoguePlanDurationError {
  if (error instanceof DialoguePlanDurationError) return true
  if (!error || typeof error !== 'object') return false
  const candidate = error as Record<string, unknown>
  return candidate.name === 'DialoguePlanDurationError'
    && candidate.statusCode === 422
    && dialoguePlanSchema.safeParse(candidate.plan).success
    && ['actualWords', 'targetWords', 'minimumWords', 'maximumWords']
      .every(key => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]))
}

export interface BuildDialoguePlanPromptOptions {
  lengthMinutes: 5 | 10 | 20
  complexity: 'beginner' | 'expert'
  hostNames?: { hostA: string, hostB: string }
}

export function buildDialoguePlanJsonSchema(_options: BuildDialoguePlanPromptOptions): Record<string, unknown> {
  const stringArray = (minItems: number) => ({
    type: 'array',
    items: { type: 'string' },
    minItems,
  })
  const evidenceQuote = {
    type: 'object',
    additionalProperties: false,
    properties: {
      sourceId: { type: 'string' },
      quote: { type: 'string' },
    },
    required: ['sourceId', 'quote'],
  }
  const claim = {
    type: 'object',
    additionalProperties: false,
    properties: {
      claimId: { type: 'string' },
      text: { type: 'string' },
      status: { type: 'string', enum: ['supported', 'unsupported'] },
      sourceIds: stringArray(0),
      evidenceQuotes: { type: 'array', items: evidenceQuote, minItems: 0 },
    },
    required: ['claimId', 'text', 'status', 'sourceIds', 'evidenceQuotes'],
  }
  const utterance = {
    type: 'object',
    additionalProperties: false,
    properties: {
      speaker: { type: 'string', enum: ['host_a', 'host_b'] },
      text: { type: 'string' },
      claimIds: stringArray(1),
      sourceIds: stringArray(1),
      emotionalIntent: { type: 'string' },
      delivery: { type: 'string' },
      pauseAfterMs: { type: 'integer' },
    },
    required: ['speaker', 'text', 'claimIds', 'sourceIds', 'emotionalIntent', 'delivery'],
  }
  const scene = {
    type: 'object',
    additionalProperties: false,
    properties: {
      sceneId: { type: 'string' },
      title: { type: 'string' },
      emotionalIntent: { type: 'string' },
      delivery: { type: 'string' },
      utterances: { type: 'array', items: utterance, minItems: 2 },
    },
    required: ['sceneId', 'title', 'emotionalIntent', 'delivery', 'utterances'],
  }

  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      outline: {
        type: 'object',
        additionalProperties: false,
        properties: {
          learningObjectives: stringArray(1),
          narrativeArc: stringArray(1),
          plannedSourceIds: stringArray(1),
        },
        required: ['learningObjectives', 'narrativeArc', 'plannedSourceIds'],
      },
      claims: { type: 'array', items: claim, minItems: 1 },
      scenes: { type: 'array', items: scene, minItems: 1 },
    },
    required: ['title', 'outline', 'claims', 'scenes'],
  }
}

function stripFences(raw: string): string {
  const trimmed = raw.trim()
  return trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim() ?? trimmed
}

function sourceBlock(chunks: AISearchChunk[]): string {
  let used = 0
  const blocks: string[] = []
  for (const chunk of chunks) {
    const content = chunk.content.trim()
    const sourceId = String(chunk.attributes?.documentId ?? '').trim()
    if (!content || !sourceId || used >= MAX_SOURCE_CHARS) continue
    const remaining = MAX_SOURCE_CHARS - used
    const excerpt = content.slice(0, remaining)
    used += excerpt.length
    blocks.push([
      `sourceId: ${sourceId}`,
      `displayName: ${String(chunk.attributes?.filename ?? 'Source')}`,
      excerpt,
    ].join('\n'))
  }
  return blocks.join('\n\n---\n\n')
}

export function buildDialoguePlanPrompt(
  chunks: AISearchChunk[],
  options: BuildDialoguePlanPromptOptions,
): ChatMessage[] {
  const { targetWords: wordBudget, minimumWords, maximumWords } = durationWordBounds(options.lengthMinutes)
  const minimumScenes = Math.ceil(options.lengthMinutes / 3)
  const maximumScenes = Math.ceil(options.lengthMinutes / 2) + 1
  const minimumUtterances = Math.max(8, Math.round(wordBudget / 60))
  const maximumUtterances = Math.max(minimumUtterances + 4, Math.round(wordBudget / 35))
  const maximumClaims = Math.max(10, Math.round(wordBudget / 50))
  const complexity = options.complexity === 'expert'
    ? 'Use precise domain terminology and preserve important nuance.'
    : 'Define jargon naturally and build concepts with accessible examples.'
  const hostAName = options.hostNames?.hostA.trim() || 'Host A'
  const hostBName = options.hostNames?.hostB.trim() || 'Host B'
  const system = `You create a source-grounded Dialogue Script for a two-Host Audio Overview.

Return JSON only with this exact structure:
{
  "title": string,
  "outline": {
    "learningObjectives": string[],
    "narrativeArc": string[],
    "plannedSourceIds": string[]
  },
  "claims": [{
    "claimId": string,
    "text": string,
    "status": "supported" | "unsupported",
    "sourceIds": string[],
    "evidenceQuotes": [{ "sourceId": string, "quote": string }]
  }],
  "scenes": [{
    "sceneId": string,
    "title": string,
    "emotionalIntent": string,
    "delivery": string,
    "utterances": [{
      "speaker": "host_a" | "host_b",
      "text": string,
      "claimIds": string[],
      "sourceIds": string[],
      "emotionalIntent": string,
      "delivery": string,
      "pauseAfterMs"?: number
    }]
  }]
}

Create the Outline and Claim Ledger before writing Scenes. Mark a claim supported only when the supplied evidence entails it; otherwise mark it unsupported and do not speak it. Every supported factual claim must link to one or more supplied sourceId values and include exactly one short verbatim evidenceQuotes entry for each linked sourceId. The sourceIds array and evidenceQuotes sourceId values must be one-to-one: never omit a linked source, add an unlinked quote, or quote the same source twice for one claim. Every Utterance must have at least one claimId and sourceId, including questions, reactions, transitions, and the introduction; anchor conversational speech to the supported claim it is discussing. An Utterance may reference only supported Claim Ledger entries and must include every sourceId used by those claims. Never invent a sourceId or quote text that is absent from its source.

Keep this representation compact: use at most ${maximumClaims} non-duplicative claims, reuse claimIds across Utterances, use the single strongest source for a claim unless multiple sources are necessary, keep evidence quotes to 8-30 words, and keep each emotionalIntent and delivery value to 2-8 words.

Target ${wordBudget} spoken words total across ${minimumScenes}-${maximumScenes} coherent Scenes and approximately ${minimumUtterances}-${maximumUtterances} Utterances. The complete spoken text has a hard acceptance range of ${minimumWords}-${maximumWords} words. Count only Utterance text, and revise it before responding if it is outside that range. Each 1-3 minute Scene must stay within roughly 150-450 spoken words. Both Hosts must speak in every Scene. Host A is ${hostAName}, a warm, confident guide; Host B is ${hostBName}, an intelligent, genuinely curious learner. Use ${hostAName} and ${hostBName} naturally as spoken vocatives across the conversation so listeners can identify the speakers, including both names within the opening Scene. Do not turn host identity into an unsupported factual claim or prepend a name label to every Utterance. Give the episode a whole-story emotional arc rather than repetitive excitement. ${complexity}

Write natural speech with contractions, varied sentence lengths, thoughtful pauses, and occasional authentic course corrections. Do not impose filler, laughter, agreement, interruption, or recap quotas. Keep performance direction in emotionalIntent, delivery, and pauseAfterMs fields; never insert direction markup into spoken text.`

  return [
    { role: 'system', content: system },
    { role: 'user', content: `Frozen Source Manifest evidence:\n\n${sourceBlock(chunks)}\n\nCreate the grounded Dialogue Script now.` },
  ]
}

export function buildDialoguePlanDurationRepairPrompt(
  plan: DialoguePlan,
  options: BuildDialoguePlanPromptOptions,
  actualWords: number,
  repairPass = 1,
): ChatMessage[] {
  const { targetWords, minimumWords, maximumWords } = durationWordBounds(options.lengthMinutes)
  const direction = actualWords < minimumWords ? 'expand' : 'tighten'
  const requiredChange = direction === 'expand'
    ? Math.max(0, minimumWords - actualWords)
    : Math.max(0, actualWords - maximumWords)
  const targetChange = Math.abs(actualWords - targetWords)
  const changePercent = actualWords > 0 ? Math.ceil((targetChange / actualWords) * 100) : 0
  const correction = direction === 'expand'
    ? `Add at least ${requiredChange} spoken words and aim to add about ${targetChange} words.`
    : `Remove at least ${requiredChange} spoken words and aim to remove about ${targetChange} words (${changePercent}% of the current spoken text).`
  const escalation = repairPass > 1
    ? 'A previous duration correction did not reach the hard range. Make a materially larger correction this time; do not return the supplied spoken text unchanged.'
    : 'Do not return the supplied spoken text unchanged.'
  return [
    {
      role: 'system',
      content: `You are correcting the duration of an already validated, source-grounded two-Host Dialogue Script.

This is duration correction pass ${repairPass} of 2. Return the complete corrected Dialogue Script as JSON in the same structure. The supplied script currently has ${actualWords} spoken words. ${direction === 'expand' ? 'Expand' : 'Tighten'} only the spoken Utterance text and, when useful, split or add conversational Utterances within the existing Scenes. ${correction} ${escalation} Target ${targetWords} words and keep the complete spoken text between ${minimumWords} and ${maximumWords} spoken words. Count only Utterance text and revise it before responding until it is inside that hard range.

Preserve the validated Claim Ledger, evidence quotes, source links, Outline, existing Scene identities, narrative order, and factual meaning. You may add a new Scene only when the target cannot fit within the existing Scenes' 500-word upper bounds; otherwise keep the Scene set unchanged. Every Utterance must continue to reference one or more existing supported claimId and sourceId values. Do not add facts, claims, sources, delivery markup, or evidence. Keep both Hosts in every Scene, natural emotional progression, varied sentence lengths, thoughtful pauses, and the 120-500 word Scene boundaries.`,
    },
    {
      role: 'user',
      content: `Validated Dialogue Script requiring duration correction:\n\n${JSON.stringify(plan)}`,
    },
  ]
}

function spokenWordCount(text: string): number {
  return text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0
}

function sceneSpokenWordCount(scene: DialoguePlan['scenes'][number]): number {
  return scene.utterances.reduce((sum, utterance) => sum + spokenWordCount(utterance.text), 0)
}

/**
 * Last-resort duration correction for a structurally and evidentially valid
 * overlong plan. It removes complete Utterances only, so it cannot introduce
 * new factual wording. The normal model repairs run first; the resulting plan
 * is parsed and semantically verified again by the caller.
 */
export function compactDialoguePlanDuration(
  plan: DialoguePlan,
  options: BuildDialoguePlanPromptOptions,
): DialoguePlan {
  const compacted = dialoguePlanSchema.parse(plan)
  const { targetWords, minimumWords, maximumWords } = durationWordBounds(options.lengthMinutes)
  let totalWords = compacted.scenes.reduce((sum, scene) => sum + sceneSpokenWordCount(scene), 0)
  if (totalWords >= minimumWords && totalWords <= maximumWords) return compacted
  if (totalWords < minimumWords) {
    throw new DialoguePlanDurationError(compacted, totalWords, targetWords, minimumWords, maximumWords)
  }

  while (totalWords > maximumWords) {
    const candidates = compacted.scenes.flatMap((scene, sceneIndex) => {
      const sceneWords = sceneSpokenWordCount(scene)
      return scene.utterances.flatMap((utterance, utteranceIndex) => {
        if (scene.utterances.length <= 2) return []
        const utteranceWords = spokenWordCount(utterance.text)
        if (utteranceWords < 1 || sceneWords - utteranceWords < 120 || totalWords - utteranceWords < minimumWords) return []
        const remainingSpeakers = new Set(scene.utterances
          .filter((_, index) => index !== utteranceIndex)
          .map(candidate => candidate.speaker))
        if (!remainingSpeakers.has('host_a') || !remainingSpeakers.has('host_b')) return []
        return [{
          sceneIndex,
          utteranceIndex,
          utteranceWords,
          edge: utteranceIndex === 0 || utteranceIndex === scene.utterances.length - 1,
        }]
      })
    })
    if (candidates.length === 0) break
    const interior = candidates.filter(candidate => !candidate.edge)
    const pool = interior.length > 0 ? interior : candidates
    pool.sort((left, right) => {
      const leftDistance = Math.abs((totalWords - left.utteranceWords) - maximumWords)
      const rightDistance = Math.abs((totalWords - right.utteranceWords) - maximumWords)
      return leftDistance - rightDistance
        || right.utteranceWords - left.utteranceWords
        || left.sceneIndex - right.sceneIndex
        || left.utteranceIndex - right.utteranceIndex
    })
    const selected = pool[0]!
    compacted.scenes[selected.sceneIndex]!.utterances.splice(selected.utteranceIndex, 1)
    totalWords -= selected.utteranceWords
  }

  if (totalWords > maximumWords) {
    throw new DialoguePlanDurationError(compacted, totalWords, targetWords, minimumWords, maximumWords)
  }
  const spokenClaimIds = new Set(compacted.scenes.flatMap(scene =>
    scene.utterances.flatMap(utterance => utterance.claimIds),
  ))
  compacted.claims = compacted.claims.filter(claim => claim.status === 'unsupported' || spokenClaimIds.has(claim.claimId))
  return compacted
}

export function buildDialoguePlanEvidenceRepairPrompt(
  plan: DialoguePlan,
  chunks: AISearchChunk[],
  invalidEvidence: InvalidEvidenceQuote,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You are correcting evidence quotations in an already structured two-Host Dialogue Script.

Return the complete corrected Dialogue Script as JSON in the same structure. Every evidenceQuotes.quote must be an exact verbatim substring from the supplied frozen evidence for its sourceId; audit every evidence quote, not only the identified invalid quote. Replace any non-verbatim quote with the shortest exact passage that directly supports the existing claim.

Do not change any spoken Utterance, title, Outline, Scene, claim text, claim status, sourceId, sourceIds, delivery direction, emotional intent, pause, identity, or ordering. Do not add or remove claims, sources, evidence entries, Scenes, or Utterances. If the frozen evidence does not support a claim, leave its quote unchanged so the server rejects the script rather than fabricating support.`,
    },
    {
      role: 'user',
      content: `Invalid evidence quote:
claimId: ${invalidEvidence.claimId}
sourceId: ${invalidEvidence.sourceId}
quote: ${invalidEvidence.quote}

Frozen Source Manifest evidence:

${sourceBlock(chunks)}

Dialogue Script requiring evidence correction:

${JSON.stringify(plan)}`,
    },
  ]
}

export function buildDialoguePlanEntailmentRepairPrompt(
  plan: DialoguePlan,
  rejected: Array<{ utteranceId: string, reason: string }>,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You are correcting unsupported spoken wording in an otherwise validated two-Host Dialogue Script.

Return the complete corrected Dialogue Script as JSON in the same structure. Rewrite only the spoken text of the rejected Utterances identified below so every factual assertion, implication, presupposition, quantity, polarity, causality, scope, certainty, comparison, and added detail follows directly from its existing Claim Ledger entries and evidence quotes. Conversational questions and reactions are allowed only when they introduce no unsupported factual meaning.

Preserve all identities, ordering, speakers, Scenes, title, Outline, Claim Ledger, evidence quotes, source links, emotional intent, delivery, pauses, and non-rejected Utterance text. Keep each corrected Utterance close to its original spoken length so the validated episode duration remains stable. Do not add facts, claims, sources, evidence, delivery markup, Scenes, or Utterances.`,
    },
    {
      role: 'user',
      content: `Rejected Utterances and verifier reasons:\n${JSON.stringify(rejected)}\n\nDialogue Script requiring correction:\n${JSON.stringify(plan)}`,
    },
  ]
}

function normalizeEvidence(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const DELIVERY_DIRECTION_WORDS = /\b(?:beat|breath(?:e|es|ing)?|chuckle(?:s|d|ing)?|excited(?:ly)?|gasp(?:s|ed|ing)?|laugh(?:s|ed|ing|ter)?|pause(?:s|d|ing)?|reflective(?:ly)?|sigh(?:s|ed|ing)?|thoughtful(?:ly)?|whisper(?:s|ed|ing)?|warmly)\b/i

function sanitizeSpokenText(value: string): string {
  const removeDirection = (whole: string, inner: string) => DELIVERY_DIRECTION_WORDS.test(inner) ? '' : whole
  return value
    .replace(/\[([^\]\n]{1,120})\]/g, removeDirection)
    .replace(/<([^>\n]{1,120})>/g, removeDirection)
    .replace(/\*([^*\n]{1,120})\*/g, (whole, inner: string) => DELIVERY_DIRECTION_WORDS.test(inner) ? '' : inner)
    .replace(/^\s*\(([^)\n]{1,120})\)\s*/g, removeDirection)
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

interface EvidenceToken {
  value: string
  start: number
  end: number
}

function evidenceTokens(value: string): { text: string, tokens: EvidenceToken[] } {
  const text = value.normalize('NFKC')
  const tokens: EvidenceToken[] = []
  for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const start = match.index
    tokens.push({
      value: match[0].toLocaleLowerCase('en-US'),
      start,
      end: start + match[0].length,
    })
  }
  return { text, tokens }
}

function tokenEditDistance(left: string[], right: string[], limit: number): number {
  if (Math.abs(left.length - right.length) > limit) return limit + 1
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      const substitution = previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      const value = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        substitution,
      )
      current.push(value)
    }
    previous = current
  }
  return previous[right.length]!
}

function canonicalFrozenEvidenceQuote(quote: string, sourceChunks: string[]): string | undefined {
  const quoteWords = normalizeEvidence(quote).split(' ').filter(Boolean)
  // Short fuzzy matches are too easy to satisfy accidentally. They must remain exact.
  if (quoteWords.length < 8) return undefined
  const allowedEdits = Math.min(12, Math.max(2, Math.floor(quoteWords.length * 0.25)))
  let best: { distance: number, text: string } | undefined
  let bestContiguous: { words: number, text: string } | undefined
  const availableSourceWords = new Set<string>()

  for (const sourceChunk of sourceChunks) {
    const source = evidenceTokens(sourceChunk)
    const sourceWords = source.tokens.map(token => token.value)
    for (const word of sourceWords) availableSourceWords.add(word)

    // AI Search excerpts can end in the middle of a sentence that Gemini
    // quotes in full from an overlapping excerpt. Preserve the longest exact
    // raw fragment when it is substantial enough to remain meaningful.
    let previousContiguous = new Array(sourceWords.length + 1).fill(0) as number[]
    for (let quoteIndex = 1; quoteIndex <= quoteWords.length; quoteIndex++) {
      const currentContiguous = new Array(sourceWords.length + 1).fill(0) as number[]
      for (let sourceIndex = 1; sourceIndex <= sourceWords.length; sourceIndex++) {
        if (quoteWords[quoteIndex - 1] !== sourceWords[sourceIndex - 1]) continue
        const words = previousContiguous[sourceIndex - 1]! + 1
        currentContiguous[sourceIndex] = words
        if (bestContiguous && words <= bestContiguous.words) continue
        const start = sourceIndex - words
        const first = source.tokens[start]!
        const last = source.tokens[sourceIndex - 1]!
        const trailing = source.text.slice(last.end).match(/^[.,;:!?\u2019'")\]}]+/)?.[0] ?? ''
        bestContiguous = {
          words,
          text: source.text.slice(first.start, last.end + trailing.length).trim(),
        }
      }
      previousContiguous = currentContiguous
    }

    const candidateStarts = new Set<number>()
    for (let quoteAnchor = 0; quoteAnchor < Math.min(4, quoteWords.length); quoteAnchor++) {
      for (let sourceAnchor = 0; sourceAnchor < sourceWords.length; sourceAnchor++) {
        if (quoteWords[quoteAnchor] !== sourceWords[sourceAnchor]) continue
        const alignedStart = sourceAnchor - quoteAnchor
        for (let drift = -allowedEdits; drift <= allowedEdits; drift++) {
          const start = alignedStart + drift
          if (start >= 0 && start < sourceWords.length) candidateStarts.add(start)
        }
      }
    }

    for (const start of candidateStarts) {
      for (
        let wordCount = Math.max(8, quoteWords.length - allowedEdits);
        wordCount <= quoteWords.length + allowedEdits && start + wordCount <= sourceWords.length;
        wordCount++
      ) {
        const candidateWords = sourceWords.slice(start, start + wordCount)
        const distance = tokenEditDistance(quoteWords, candidateWords, allowedEdits)
        if (distance > allowedEdits || (best && distance >= best.distance)) continue
        const first = source.tokens[start]!
        const last = source.tokens[start + wordCount - 1]!
        // Preserve adjacent sentence punctuation when it belongs to the final
        // matched word. The resulting text remains an exact raw substring.
        const trailing = source.text.slice(last.end).match(/^[.,;:!?\u2019'")\]}]+/)?.[0] ?? ''
        const candidateText = source.text.slice(first.start, last.end + trailing.length).trim()
        if (candidateText.length > 500) continue
        best = { distance, text: candidateText }
      }
    }
  }

  if (best) return best.text
  const sourceCoverage = quoteWords.filter(word => availableSourceWords.has(word)).length / quoteWords.length
  const minimumContiguousWords = Math.max(8, Math.ceil(quoteWords.length * 0.5))
  return sourceCoverage >= 0.8
    && bestContiguous
    && bestContiguous.words >= minimumContiguousWords
    ? bestContiguous.text
    : undefined
}

export function parseDialoguePlanResponse(
  raw: string,
  allowedSourceIds: string[],
  chunks: AISearchChunk[],
  requested?: BuildDialoguePlanPromptOptions,
): DialoguePlan {
  let value: unknown
  try {
    value = JSON.parse(stripFences(raw))
  }
  catch {
    throw new Error('Dialogue Script response is not valid JSON')
  }
  const parsed = dialoguePlanSchema.safeParse(value)
  if (!parsed.success) {
    const missingGrounding = parsed.error.issues.some(issue =>
      issue.code === 'too_small'
      && (issue.path.at(-1) === 'claimIds' || issue.path.at(-1) === 'sourceIds'),
    )
    if (missingGrounding) throw new Error('Every spoken Utterance requires supported claim evidence')
    throw new Error('Dialogue Script response does not match the required structure')
  }

  const plan = parsed.data
  const allowed = new Set(allowedSourceIds)
  const sourceIdByExcerptId = new Map<string, string>()
  const ambiguousExcerptIds = new Set<string>()
  const evidenceBySource = new Map<string, string[]>()
  for (const chunk of chunks) {
    const sourceId = String(chunk.attributes?.documentId ?? '').trim()
    if (!allowed.has(sourceId)) continue
    const excerptId = String(chunk.id ?? '').trim()
    if (excerptId && !allowed.has(excerptId)) {
      const existing = sourceIdByExcerptId.get(excerptId)
      if (existing && existing !== sourceId) ambiguousExcerptIds.add(excerptId)
      else if (!ambiguousExcerptIds.has(excerptId)) sourceIdByExcerptId.set(excerptId, sourceId)
    }
    evidenceBySource.set(sourceId, [...(evidenceBySource.get(sourceId) ?? []), chunk.content])
  }
  for (const excerptId of ambiguousExcerptIds) sourceIdByExcerptId.delete(excerptId)
  const canonicalSourceId = (sourceId: string) => sourceIdByExcerptId.get(sourceId) ?? sourceId
  plan.outline.plannedSourceIds = plan.outline.plannedSourceIds.map(canonicalSourceId)
  for (const claim of plan.claims) {
    claim.sourceIds = claim.sourceIds.map(canonicalSourceId)
    for (const evidence of claim.evidenceQuotes) evidence.sourceId = canonicalSourceId(evidence.sourceId)
  }
  for (const scene of plan.scenes) {
    for (const utterance of scene.utterances) {
      utterance.sourceIds = utterance.sourceIds.map(canonicalSourceId)
    }
  }
  const claimIds = new Set<string>()
  const plannedSourceIds = new Set(plan.outline.plannedSourceIds)
  if (plannedSourceIds.size !== plan.outline.plannedSourceIds.length) {
    throw new Error('Outline contains duplicate planned sources')
  }
  for (const sourceId of plan.outline.plannedSourceIds) {
    if (!allowed.has(sourceId)) throw new Error('Outline references a source outside the Source Manifest')
  }
  const claimById = new Map<string, typeof plan.claims[number]>()
  for (const claim of plan.claims) {
    if (claimIds.has(claim.claimId)) throw new Error('Claim Ledger contains a duplicate claim identity')
    claimIds.add(claim.claimId)
    claimById.set(claim.claimId, claim)
    for (const evidence of claim.evidenceQuotes) {
      if (!allowed.has(evidence.sourceId)) throw new Error('Claim Ledger evidence references a source outside the Source Manifest')
      const sourceChunks = evidenceBySource.get(evidence.sourceId) ?? []
      const normalizedQuote = normalizeEvidence(evidence.quote)
      const exact = sourceChunks.some(source => normalizeEvidence(source).includes(normalizedQuote))
      if (!exact) {
        const canonicalQuote = canonicalFrozenEvidenceQuote(evidence.quote, sourceChunks)
        if (canonicalQuote) {
          evidence.quote = canonicalQuote
          continue
        }
        throw new DialoguePlanEvidenceError(
          plan,
          {
            claimId: claim.claimId,
            sourceId: evidence.sourceId,
            quote: evidence.quote,
          },
        )
      }
    }
    if (claim.status === 'supported') {
      const evidenceBySourceId = new Map(claim.evidenceQuotes.map(evidence => [evidence.sourceId, evidence]))
      if (evidenceBySourceId.size < 1) throw new Error('Supported Claim Ledger entry has no frozen evidence')
      // Source links are redundant with the validated quote identities. Derive
      // the canonical links server-side so harmless model bookkeeping drift
      // cannot weaken or block the frozen-evidence contract.
      claim.evidenceQuotes = [...evidenceBySourceId.values()]
      claim.sourceIds = [...evidenceBySourceId.keys()]
    }
    else {
      if (new Set(claim.sourceIds).size !== claim.sourceIds.length) {
        throw new Error('Claim Ledger contains duplicate source evidence')
      }
      if (claim.sourceIds.some(sourceId => !allowed.has(sourceId))) {
        throw new Error('Claim Ledger references a source outside the Source Manifest')
      }
      const quotedSources = new Set(claim.evidenceQuotes.map(evidence => evidence.sourceId))
      if (quotedSources.size !== claim.evidenceQuotes.length
        || claim.sourceIds.some(sourceId => !quotedSources.has(sourceId))
        || claim.evidenceQuotes.some(evidence => !claim.sourceIds.includes(evidence.sourceId))) {
        throw new Error('Claim Ledger evidence quotes do not match its source links')
      }
    }
  }
  const sceneIds = new Set<string>()
  let totalSpokenWords = 0
  for (const scene of plan.scenes) {
    if (sceneIds.has(scene.sceneId)) throw new Error('Dialogue Script contains a duplicate Scene identity')
    sceneIds.add(scene.sceneId)
    const speakers = new Set(scene.utterances.map(utterance => utterance.speaker))
    if (!speakers.has('host_a') || !speakers.has('host_b')) {
      throw new Error('Every Scene must contain both Hosts')
    }
    const sceneSpokenWords = scene.utterances.reduce(
      (sum, utterance) => sum + (utterance.text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0),
      0,
    )
    totalSpokenWords += sceneSpokenWords
    if (requested && (sceneSpokenWords < 120 || sceneSpokenWords > 500)) {
      throw new Error('Dialogue Script Scene duration is outside the 1-3 minute rendering boundary')
    }
    for (const utterance of scene.utterances) {
      utterance.text = sanitizeSpokenText(utterance.text)
      if (!utterance.text) throw new Error('Spoken text contains only delivery-direction markup')
      if (new Set(utterance.sourceIds).size !== utterance.sourceIds.length
        || new Set(utterance.claimIds).size !== utterance.claimIds.length) {
        throw new Error('Utterance contains duplicate grounding links')
      }
      if (utterance.sourceIds.some(sourceId => !allowed.has(sourceId))) {
        throw new Error('Utterance references a source outside the Source Manifest')
      }
      if (utterance.claimIds.some(claimId => !claimIds.has(claimId))) {
        throw new Error('Utterance references an unknown Claim Ledger entry')
      }
      for (const claimId of utterance.claimIds) {
        const claim = claimById.get(claimId)!
        if (claim.status !== 'supported') {
          throw new Error('Utterance references an unsupported Claim Ledger entry')
        }
        if (claim.sourceIds.some(sourceId => !utterance.sourceIds.includes(sourceId))) {
          throw new Error('Utterance omits source evidence required by its claim')
        }
      }
    }
  }
  if (requested) {
    const { targetWords, minimumWords, maximumWords } = durationWordBounds(requested.lengthMinutes)
    if (totalSpokenWords < minimumWords || totalSpokenWords > maximumWords) {
      throw new DialoguePlanDurationError(
        plan,
        totalSpokenWords,
        targetWords,
        minimumWords,
        maximumWords,
      )
    }
  }
  return plan
}
