import { describe, expect, test } from 'vitest'
import {
  batchClaimEntailmentInputs,
  buildClaimEntailmentJsonSchema,
  buildClaimEntailmentPrompt,
  parseClaimEntailmentResponse,
} from './audio-overview-grounding'

const utterances = [
  {
    utteranceId: 'scene:0:cell-energy:utterance:0',
    sceneId: 'cell-energy',
    sceneOrder: 0,
    utteranceOrder: 0,
    text: 'Cells store energy in useful forms.',
    claims: [{
      claimId: 'claim-atp',
      text: 'Cells store energy.',
      evidenceQuotes: [{ sourceId: 'doc-atp', quote: 'Cells store energy.' }],
    }],
  },
  {
    utteranceId: 'scene:0:cell-energy:utterance:1',
    sceneId: 'cell-energy',
    sceneOrder: 0,
    utteranceOrder: 1,
    text: 'Glycolysis converts glucose into pyruvate.',
    claims: [{
      claimId: 'claim-glycolysis',
      text: 'Glycolysis converts glucose into pyruvate.',
      evidenceQuotes: [{ sourceId: 'doc-glycolysis', quote: 'Glycolysis converts glucose into pyruvate.' }],
    }],
  },
]

describe('Claim entailment verifier contract', () => {
  test('batches long episodes so verifier responses stay bounded', () => {
    const inputs = Array.from({ length: 17 }, (_, index) => ({
      ...utterances[0]!,
      utteranceId: `utterance-${index}`,
    }))

    expect(batchClaimEntailmentInputs(inputs).map(batch => batch.length)).toEqual([8, 8, 1])
  })

  test('enforces an exact, non-empty provider decision set', () => {
    const schema = buildClaimEntailmentJsonSchema(utterances.length) as any
    expect(schema.properties.decisions.minItems).toBe(2)
    expect(schema.properties.decisions.maxItems).toBe(2)
    expect(schema.properties.decisions.items.properties.claimIds.minItems).toBe(1)
  })

  test('asks for semantic entailment rather than treating a present quote as proof', () => {
    const prompt = buildClaimEntailmentPrompt(utterances)

    expect(prompt[0]!.content).toContain('semantic entailment')
    expect(prompt[0]!.content).toContain('Quote presence alone is not proof')
    expect(prompt[0]!.content).toContain('Entailment is directional')
    expect(prompt[0]!.content).toContain('do not reject an Utterance solely because it omits a qualifier')
    expect(prompt[0]!.content).toContain('exact spoken text')
    expect(prompt[1]!.content).toContain('Cells store energy in useful forms.')
    expect(prompt[1]!.content).toContain('scene:0:cell-energy:utterance:0')
  })

  test('accepts only an exact, complete, all-entailed structured decision set', () => {
    const raw = JSON.stringify({
      version: 'claim-entailment.v1',
      decisions: utterances.map(utterance => ({
        utteranceId: utterance.utteranceId,
        claimIds: utterance.claims.map(claim => claim.claimId),
        decision: 'entailed',
        reason: 'The evidence directly supports the exact spoken text.',
      })),
    })

    expect(parseClaimEntailmentResponse(raw, utterances).decisions).toHaveLength(2)
  })

  test('preserves a rejected overclaim for the bounded dialogue repair pass', () => {
    const raw = JSON.stringify({
      version: 'claim-entailment.v1',
      decisions: [
        {
          utteranceId: utterances[0]!.utteranceId,
          claimIds: ['claim-atp'],
          decision: 'not_entailed',
          reason: 'The words in useful forms add a fact absent from the claim and quote.',
        },
        { utteranceId: utterances[1]!.utteranceId, claimIds: ['claim-glycolysis'], decision: 'entailed', reason: 'Directly stated.' },
      ],
    })

    expect(parseClaimEntailmentResponse(raw, utterances).decisions[0])
      .toMatchObject({ decision: 'not_entailed', utteranceId: utterances[0]!.utteranceId })
  })

  test('fails closed for missing, duplicate, unknown, or malformed decisions', () => {
    expect(() => parseClaimEntailmentResponse(JSON.stringify({
      version: 'claim-entailment.v1',
      decisions: [{ utteranceId: utterances[0]!.utteranceId, claimIds: ['claim-atp'], decision: 'entailed', reason: 'Direct.' }],
    }), utterances)).toThrow(/complete/i)

    expect(() => parseClaimEntailmentResponse(JSON.stringify({
      version: 'claim-entailment.v1',
      decisions: [
        { utteranceId: utterances[0]!.utteranceId, claimIds: ['claim-atp'], decision: 'entailed', reason: 'Direct.' },
        { utteranceId: utterances[0]!.utteranceId, claimIds: ['claim-atp'], decision: 'entailed', reason: 'Repeated.' },
      ],
    }), [utterances[0]!])).toThrow(/duplicate/i)

    expect(() => parseClaimEntailmentResponse(JSON.stringify({
      version: 'claim-entailment.v1',
      decisions: utterances.map(utterance => ({
        utteranceId: utterance.utteranceId,
        claimIds: ['wrong-claim'],
        decision: 'entailed',
        reason: 'Not actually bound to the cited claim.',
      })),
    }), utterances)).toThrow(/claim links/i)

    expect(() => parseClaimEntailmentResponse('{}', [utterances[0]!]))
      .toThrow(/required structure/i)
  })
})
