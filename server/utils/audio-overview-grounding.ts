import { z } from 'zod'
import type { ChatMessage } from './ai-gateway'

export const CLAIM_ENTAILMENT_VERSION = 'claim-entailment.v1' as const

export type CitedClaimEntailmentInput = {
  claimId: string
  text: string
  evidenceQuotes: Array<{ sourceId: string, quote: string }>
}

export type SpokenUtteranceEntailmentInput = {
  utteranceId: string
  sceneId: string
  sceneOrder: number
  utteranceOrder: number
  text: string
  claims: CitedClaimEntailmentInput[]
}

export const CLAIM_ENTAILMENT_BATCH_SIZE = 8

export function batchClaimEntailmentInputs(
  utterances: SpokenUtteranceEntailmentInput[],
): SpokenUtteranceEntailmentInput[][] {
  const batches: SpokenUtteranceEntailmentInput[][] = []
  for (let offset = 0; offset < utterances.length; offset += CLAIM_ENTAILMENT_BATCH_SIZE) {
    batches.push(utterances.slice(offset, offset + CLAIM_ENTAILMENT_BATCH_SIZE))
  }
  return batches
}

const decisionSchema = z.object({
  utteranceId: z.string().trim().min(1).max(300),
  claimIds: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  decision: z.enum(['entailed', 'not_entailed']),
  reason: z.string().trim().min(3).max(500),
}).strict()

const responseSchema = z.object({
  version: z.literal(CLAIM_ENTAILMENT_VERSION),
  decisions: z.array(decisionSchema).min(1).max(400),
}).strict()

export type ClaimEntailmentResponse = z.infer<typeof responseSchema>

export function buildClaimEntailmentJsonSchema(decisionCount: number): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      version: { type: 'string', enum: [CLAIM_ENTAILMENT_VERSION] },
      decisions: {
        type: 'array',
        minItems: decisionCount,
        maxItems: decisionCount,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            utteranceId: { type: 'string' },
            claimIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
            decision: { type: 'string', enum: ['entailed', 'not_entailed'] },
            reason: { type: 'string', minLength: 3, maxLength: 240 },
          },
          required: ['utteranceId', 'claimIds', 'decision', 'reason'],
        },
      },
    },
    required: ['version', 'decisions'],
  }
}

export function buildClaimEntailmentPrompt(utterances: SpokenUtteranceEntailmentInput[]): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You are a strict source-grounding verifier. Determine semantic entailment for the exact spoken text of every supplied Utterance using only its cited Claim Ledger entries and their evidence quotes. Quote presence alone is not proof. Entailment is directional: spoken text may be less detailed than a cited claim or evidence and still be entailed. Do not require equivalence or completeness, and do not reject an Utterance solely because it omits a qualifier or example that appears only in the broader claim or evidence. Reject an omission only when it changes the spoken text's truth conditions, polarity, scope, certainty, or meaning. Return not_entailed if either a cited claim or any factual assertion, implication, presupposition, quantity, polarity, causality, scope, certainty, comparison, or added detail in the exact spoken text does not follow from the cited evidence without outside knowledge. Stylistic phrasing is allowed only when it adds no factual meaning.

Return JSON only in this exact shape:
{"version":"${CLAIM_ENTAILMENT_VERSION}","decisions":[{"utteranceId":string,"claimIds":string[],"decision":"entailed"|"not_entailed","reason":string}]}

Copy each utteranceId and its complete ordered claimIds exactly. Return exactly one decision for every supplied Utterance and no others. Keep each reason under 30 words. When uncertain, return not_entailed.`,
    },
    {
      role: 'user',
      content: JSON.stringify({ utterances }),
    },
  ]
}

export function parseClaimEntailmentResponse(
  raw: string,
  expectedUtterances: SpokenUtteranceEntailmentInput[],
): ClaimEntailmentResponse {
  let value: unknown
  try {
    value = JSON.parse(raw.trim())
  }
  catch {
    throw new Error('Claim entailment verifier response is not valid JSON')
  }
  const parsed = responseSchema.safeParse(value)
  if (!parsed.success) throw new Error('Claim entailment verifier response does not match the required structure')

  const expected = new Map(expectedUtterances.map(utterance => [utterance.utteranceId, utterance]))
  if (expected.size !== expectedUtterances.length) throw new Error('Spoken entailment input contains a duplicate Utterance identity')
  const observed = new Set<string>()
  for (const row of parsed.data.decisions) {
    if (observed.has(row.utteranceId)) throw new Error('Claim entailment verifier returned a duplicate decision')
    observed.add(row.utteranceId)
    const expectedUtterance = expected.get(row.utteranceId)
    if (!expectedUtterance) throw new Error('Claim entailment verifier returned an unknown Utterance')
    const expectedClaimIds = expectedUtterance.claims.map(claim => claim.claimId)
    if (row.claimIds.length !== expectedClaimIds.length
      || row.claimIds.some((claimId, index) => claimId !== expectedClaimIds[index])) {
      throw new Error('Claim entailment verifier decision does not match the Utterance claim links')
    }
  }
  if (observed.size !== expected.size || [...expected.keys()].some(utteranceId => !observed.has(utteranceId))) {
    throw new Error('Claim entailment verifier did not return a complete decision set')
  }
  return parsed.data
}
