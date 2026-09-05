import { describe, expect, test } from 'vitest'
import {
  buildDialoguePlanEvidenceRepairPrompt,
  buildDialoguePlanDurationRepairPrompt,
  buildDialoguePlanJsonSchema,
  buildDialoguePlanPrompt,
  compactDialoguePlanDuration,
  DialoguePlanEvidenceError,
  DialoguePlanDurationError,
  isDialoguePlanEvidenceError,
  isDialoguePlanDurationError,
  parseDialoguePlanResponse,
} from './audio-overview-script'
import type { AISearchChunk } from './ai-search'

const chunks: AISearchChunk[] = [
  {
    id: 'chunk-1',
    content: 'ATP stores chemical energy used by cells.',
    score: 0.9,
    attributes: { documentId: 'doc-atp', filename: 'lecture-1.pdf' },
  },
  {
    id: 'chunk-2',
    content: 'Glycolysis converts glucose into pyruvate.',
    score: 0.8,
    attributes: { documentId: 'doc-glycolysis', filename: 'lecture-2.pdf' },
  },
]

function validPlan() {
  return {
    title: 'How cells use glucose',
    outline: {
      learningObjectives: ['Explain the role of ATP.'],
      narrativeArc: ['Begin with energy needs.', 'Connect glucose to ATP.'],
      plannedSourceIds: ['doc-atp', 'doc-glycolysis'],
    },
    claims: [
      {
        claimId: 'claim-1', text: 'ATP stores chemical energy used by cells.', status: 'supported' as const, sourceIds: ['doc-atp'],
        evidenceQuotes: [{ sourceId: 'doc-atp', quote: 'ATP stores chemical energy used by cells.' }],
      },
      {
        claimId: 'claim-2', text: 'Glycolysis converts glucose into pyruvate.', status: 'supported' as const, sourceIds: ['doc-glycolysis'],
        evidenceQuotes: [{ sourceId: 'doc-glycolysis', quote: 'Glycolysis converts glucose into pyruvate.' }],
      },
    ],
    scenes: [{
      sceneId: 'scene-1',
      title: 'Why energy currency matters',
      emotionalIntent: 'Curious opening that grows into a clear discovery.',
      delivery: 'Warm, conversational, with unhurried breathing room.',
      utterances: [
        {
          speaker: 'host_a',
          text: 'Let us start with the cell\'s immediate need for usable energy.',
          claimIds: ['claim-1'],
          sourceIds: ['doc-atp'],
          emotionalIntent: 'Inviting confidence',
          delivery: 'Warm and measured',
          pauseAfterMs: 350,
        },
        {
          speaker: 'host_b',
          text: 'So ATP is the bridge between stored fuel and work?',
          claimIds: ['claim-1'],
          sourceIds: ['doc-atp'],
          emotionalIntent: 'Genuine curiosity',
          delivery: 'Lightly rising intonation',
        },
      ],
    }],
  }
}

describe('buildDialoguePlanPrompt', () => {
  test('requests the canonical outline, claim ledger, scene, and utterance structure', () => {
    const messages = buildDialoguePlanPrompt(chunks, {
      lengthMinutes: 5,
      complexity: 'beginner',
    })

    expect(messages).toHaveLength(2)
    expect(messages[0]!.content).toContain('Outline')
    expect(messages[0]!.content).toContain('Claim Ledger')
    expect(messages[0]!.content).toContain('1-3 minute Scene')
    expect(messages[0]!.content).toContain('emotionalIntent')
    expect(messages[0]!.content).toContain('pauseAfterMs')
    expect(messages[0]!.content).toContain('at most 15 non-duplicative claims')
    expect(messages[0]!.content).toContain('2-4 coherent Scenes')
    expect(messages[0]!.content).toContain('approximately 13-21 Utterances')
    expect(messages[0]!.content).toContain('evidence quotes to 8-30 words')
    expect(messages[0]!.content).toContain('Every Utterance must have at least one claimId and sourceId')
    expect(messages[0]!.content).not.toMatch(/\b(?:Dia|Aura)\b/)
    expect(messages[1]!.content).toContain('sourceId: doc-atp')
    expect(messages[1]!.content).not.toContain('evidenceId:')
  })
})

describe('buildDialoguePlanJsonSchema', () => {
  test('requires grounding arrays on every provider-generated Utterance', () => {
    const schema = buildDialoguePlanJsonSchema({ lengthMinutes: 5, complexity: 'beginner' }) as any
    const utterance = schema.properties.scenes.items.properties.utterances.items

    expect(utterance.required).toContain('claimIds')
    expect(utterance.required).toContain('sourceIds')
    expect(utterance.properties.claimIds.minItems).toBe(1)
    expect(utterance.properties.sourceIds.minItems).toBe(1)
    expect(schema.properties.claims.minItems).toBe(1)
    expect(schema.properties.scenes.minItems).toBe(1)
  })
})

describe('parseDialoguePlanResponse', () => {
  test('accepts a grounded two-host Scene', () => {
    const parsed = parseDialoguePlanResponse(JSON.stringify(validPlan()), [
      'doc-atp',
      'doc-glycolysis',
    ], chunks)

    expect(parsed.scenes).toHaveLength(1)
    expect(parsed.scenes[0]!.utterances.map(item => item.speaker)).toEqual(['host_a', 'host_b'])
    expect(parsed.claims[0]!.sourceIds).toEqual(['doc-atp'])
  })

  test('rejects a claim that escapes the frozen Source Manifest', () => {
    const plan = validPlan()
    plan.claims[0]!.sourceIds = ['doc-outside-scope']
    plan.claims[0]!.evidenceQuotes = [{ sourceId: 'doc-outside-scope', quote: 'Outside evidence.' }]

    expect(() => parseDialoguePlanResponse(JSON.stringify(plan), ['doc-atp', 'doc-glycolysis'], chunks))
      .toThrow(/outside the Source Manifest/)
  })

  test('[P0] canonicalizes a provider-returned evidenceId alias to its frozen Source Manifest sourceId', () => {
    const plan = validPlan()
    plan.claims[0]!.evidenceQuotes[0]!.sourceId = 'chunk-1'

    const parsed = parseDialoguePlanResponse(
      JSON.stringify(plan),
      ['doc-atp', 'doc-glycolysis'],
      chunks,
    )

    expect(parsed.claims[0]!.sourceIds).toEqual(['doc-atp'])
    expect(parsed.claims[0]!.evidenceQuotes).toEqual([
      { sourceId: 'doc-atp', quote: 'ATP stores chemical energy used by cells.' },
    ])
  })

  test('rejects unknown Claim Ledger references', () => {
    const plan = validPlan()
    plan.scenes[0]!.utterances[0]!.claimIds = ['claim-missing']

    expect(() => parseDialoguePlanResponse(JSON.stringify(plan), ['doc-atp', 'doc-glycolysis'], chunks))
      .toThrow(/unknown Claim Ledger entry/)
  })

  test('requires both Hosts in every Scene', () => {
    const plan = validPlan()
    plan.scenes[0]!.utterances = [
      plan.scenes[0]!.utterances[0]!,
      { ...plan.scenes[0]!.utterances[0]!, text: 'A second Host A contribution.' },
    ]

    expect(() => parseDialoguePlanResponse(JSON.stringify(plan), ['doc-atp', 'doc-glycolysis'], chunks))
      .toThrow(/both Hosts/)
  })

  test('removes spoken delivery markup and rejects incomplete claim evidence', () => {
    const directed = validPlan()
    directed.scenes[0]!.utterances[0]!.text = '[excitedly] Cells are remarkable.'
    expect(parseDialoguePlanResponse(JSON.stringify(directed), ['doc-atp', 'doc-glycolysis'], chunks)
      .scenes[0]!.utterances[0]!.text)
      .toBe('Cells are remarkable.')

    const scientificNotation = validPlan()
    scientificNotation.scenes[0]!.utterances[0]!.text = 'The measured [H+] changes during exercise.'
    expect(parseDialoguePlanResponse(JSON.stringify(scientificNotation), ['doc-atp', 'doc-glycolysis'], chunks)
      .scenes[0]!.utterances[0]!.text)
      .toBe('The measured [H+] changes during exercise.')

    const missingEvidence = validPlan()
    missingEvidence.scenes[0]!.utterances[0]!.sourceIds = []
    expect(() => parseDialoguePlanResponse(JSON.stringify(missingEvidence), ['doc-atp', 'doc-glycolysis'], chunks))
      .toThrow(/requires supported claim evidence/i)
  })

  test('rejects fabricated evidence quotes before audio synthesis', () => {
    const plan = validPlan()
    plan.claims[0]!.evidenceQuotes[0]!.quote = 'ATP is manufactured in the nucleus.'

    expect(() => parseDialoguePlanResponse(JSON.stringify(plan), ['doc-atp', 'doc-glycolysis'], chunks))
      .toThrow(/absent from the frozen Source Manifest/)
  })

  test('preserves the invalid quote context for a bounded evidence correction', () => {
    const plan = validPlan()
    plan.claims[0]!.evidenceQuotes[0]!.quote = 'ATP is the primary energy currency of every cell.'

    let failure: unknown
    try {
      parseDialoguePlanResponse(JSON.stringify(plan), ['doc-atp', 'doc-glycolysis'], chunks)
    }
    catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(DialoguePlanEvidenceError)
    expect(failure).toMatchObject({
      plan: expect.objectContaining({ title: plan.title }),
      invalidEvidence: {
        claimId: 'claim-1',
        sourceId: 'doc-atp',
        quote: 'ATP is the primary energy currency of every cell.',
      },
    })
  })

  test('canonicalizes supported source links from verified frozen quotes', () => {
    const plan = validPlan()
    plan.claims[0]!.sourceIds = ['doc-atp', 'doc-glycolysis']
    plan.claims[0]!.evidenceQuotes.push({
      sourceId: 'doc-atp',
      quote: 'ATP stores chemical energy used by cells.',
    })

    const parsed = parseDialoguePlanResponse(JSON.stringify(plan), ['doc-atp', 'doc-glycolysis'], chunks)

    expect(parsed.claims[0]!.sourceIds).toEqual(['doc-atp'])
    expect(parsed.claims[0]!.evidenceQuotes).toHaveLength(1)
  })

  test('accepts punctuation-only differences in otherwise verbatim frozen evidence', () => {
    const plan = validPlan()
    plan.claims[0]!.evidenceQuotes[0]!.quote = 'ATP stores chemical energy—used by cells.'

    expect(parseDialoguePlanResponse(JSON.stringify(plan), ['doc-atp', 'doc-glycolysis'], chunks).claims[0])
      .toMatchObject({ claimId: 'claim-1', status: 'supported' })
  })

  test('canonicalizes a near-verbatim PDF extraction quote to an exact frozen passage', () => {
    const pdfChunks: AISearchChunk[] = [{
      id: 'chunk-pdf',
      content: 'ATP stores readily accessible chemical energy used by cells during demanding work.',
      score: 0.9,
      attributes: { documentId: 'doc-atp', filename: 'lecture.pdf' },
    }, chunks[1]!]
    const plan = validPlan()
    plan.claims[0]!.evidenceQuotes[0]!.quote = 'ATP stores chemical energy used by cells during demanding work.'

    const parsed = parseDialoguePlanResponse(
      JSON.stringify(plan),
      ['doc-atp', 'doc-glycolysis'],
      pdfChunks,
    )

    expect(parsed.claims[0]!.evidenceQuotes[0]!.quote)
      .toBe('ATP stores readily accessible chemical energy used by cells during demanding work.')
  })

  test('uses a substantial exact fragment when an AI Search excerpt ends mid-quote', () => {
    const pdfChunks: AISearchChunk[] = [{
      id: 'chunk-pdf',
      content: 'ATP stores readily accessible chemical energy used by cells during demanding work.',
      score: 0.9,
      attributes: { documentId: 'doc-atp', filename: 'lecture.pdf' },
    }, {
      id: 'chunk-pdf-overlap',
      content: 'Pathways replenish reserves during intense activity.',
      score: 0.8,
      attributes: { documentId: 'doc-atp', filename: 'lecture.pdf' },
    }, chunks[1]!]
    const plan = validPlan()
    plan.claims[0]!.evidenceQuotes[0]!.quote
      = 'ATP stores readily accessible chemical energy used by cells during demanding work while pathways replenish reserves during intense activity.'

    const parsed = parseDialoguePlanResponse(
      JSON.stringify(plan),
      ['doc-atp', 'doc-glycolysis'],
      pdfChunks,
    )

    expect(parsed.claims[0]!.evidenceQuotes[0]!.quote)
      .toBe('ATP stores readily accessible chemical energy used by cells during demanding work.')
  })

  test('rejects every spoken Utterance without supported claim and source evidence links', () => {
    const withoutClaims = validPlan()
    withoutClaims.scenes[0]!.utterances[0]!.claimIds = []
    expect(() => parseDialoguePlanResponse(JSON.stringify(withoutClaims), ['doc-atp', 'doc-glycolysis'], chunks))
      .toThrow(/requires supported claim evidence/i)

    const withoutSources = validPlan()
    withoutSources.scenes[0]!.utterances[0]!.sourceIds = []
    expect(() => parseDialoguePlanResponse(JSON.stringify(withoutSources), ['doc-atp', 'doc-glycolysis'], chunks))
      .toThrow(/requires supported claim evidence/i)
  })

  test('allows unsupported planning claims but rejects them from spoken Utterances', () => {
    const plan = validPlan()
    plan.claims[0] = {
      ...plan.claims[0]!,
      status: 'unsupported',
      sourceIds: [],
      evidenceQuotes: [],
    }

    expect(() => parseDialoguePlanResponse(JSON.stringify(plan), ['doc-atp', 'doc-glycolysis'], chunks))
      .toThrow(/unsupported Claim Ledger entry/)
  })

  test('rejects a script that cannot meet the requested episode duration before synthesis', () => {
    expect(() => parseDialoguePlanResponse(
      JSON.stringify(validPlan()),
      ['doc-atp', 'doc-glycolysis'],
      chunks,
      { lengthMinutes: 5, complexity: 'beginner' },
    )).toThrow(/duration is outside/i)
  })

  test('preserves a grounded short plan as corrective retry context', () => {
    const plan = validPlan()
    plan.scenes[0]!.utterances[0]!.text = 'ATP stores chemical energy used by cells. '.repeat(20)
    plan.scenes[0]!.utterances[1]!.text = 'ATP stores chemical energy used by cells. '.repeat(20)

    let failure: unknown
    try {
      parseDialoguePlanResponse(
        JSON.stringify(plan),
        ['doc-atp', 'doc-glycolysis'],
        chunks,
        { lengthMinutes: 5, complexity: 'beginner' },
      )
    }
    catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(DialoguePlanDurationError)
    expect(failure).toMatchObject({
      actualWords: 280,
      targetWords: 750,
      minimumWords: 563,
      maximumWords: 937,
      plan: expect.objectContaining({ title: plan.title }),
    })
  })
})

describe('buildDialoguePlanDurationRepairPrompt', () => {
  test('turns a validated short plan into an exact corrective instruction', () => {
    const messages = buildDialoguePlanDurationRepairPrompt(validPlan(), {
      lengthMinutes: 5,
      complexity: 'beginner',
    }, 160)

    expect(messages[0]!.content).toContain('between 563 and 937 spoken words')
    expect(messages[0]!.content).toContain('currently has 160 spoken words')
    expect(messages[0]!.content).toContain('Preserve the validated Claim Ledger')
    expect(messages[0]!.content).toContain('add a new Scene only when the target cannot fit')
    expect(messages[1]!.content).toContain('How cells use glucose')
  })

  test('escalates an unchanged 1078-word second correction with an exact reduction budget', () => {
    const messages = buildDialoguePlanDurationRepairPrompt(validPlan(), {
      lengthMinutes: 5,
      complexity: 'beginner',
    }, 1078, 2)

    expect(messages[0]!.content).toContain('correction pass 2 of 2')
    expect(messages[0]!.content).toContain('Remove at least 141 spoken words')
    expect(messages[0]!.content).toContain('aim to remove about 328 words (31%')
    expect(messages[0]!.content).toContain('previous duration correction did not reach the hard range')
  })
})

describe('compactDialoguePlanDuration', () => {
  test('reduces the exact 1078-word production failure by removing only complete grounded Utterances', () => {
    const plan = validPlan()
    const utteranceText = (wordCount: number) => Array.from(
      { length: wordCount },
      (_, index) => ['Cells', 'store', 'usable', 'energy'][index % 4]!,
    ).join(' ') + '.'
    plan.scenes = Array.from({ length: 3 }, (_, sceneIndex) => ({
      ...plan.scenes[0]!,
      sceneId: `scene-${sceneIndex + 1}`,
      utterances: Array.from({ length: 6 }, (_, utteranceIndex) => ({
        ...plan.scenes[0]!.utterances[utteranceIndex % 2]!,
        speaker: utteranceIndex % 2 === 0 ? 'host_a' as const : 'host_b' as const,
        text: utteranceText(sceneIndex === 2 && utteranceIndex === 5 ? 58 : 60),
        claimIds: ['claim-1'],
        sourceIds: ['doc-atp'],
      })),
    }))
    const originalTexts = new Set(plan.scenes.flatMap(scene => scene.utterances.map(utterance => utterance.text)))
    const countWords = (candidate: typeof plan) => candidate.scenes.reduce(
      (total, scene) => total + scene.utterances.reduce(
        (sceneTotal, utterance) => sceneTotal + (utterance.text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0),
        0,
      ),
      0,
    )
    expect(countWords(plan)).toBe(1078)

    const compacted = compactDialoguePlanDuration(plan, { lengthMinutes: 5, complexity: 'beginner' })

    expect(countWords(compacted)).toBeGreaterThanOrEqual(563)
    expect(countWords(compacted)).toBeLessThanOrEqual(937)
    expect(compacted.scenes.flatMap(scene => scene.utterances)).toHaveLength(15)
    expect(compacted.scenes.every(scene => new Set(scene.utterances.map(utterance => utterance.speaker)).size === 2)).toBe(true)
    expect(compacted.scenes.flatMap(scene => scene.utterances).every(utterance => originalTexts.has(utterance.text))).toBe(true)
    expect(compacted.claims.map(claim => claim.claimId)).toEqual(['claim-1'])
    expect(plan.scenes.flatMap(scene => scene.utterances)).toHaveLength(18)
    expect(() => parseDialoguePlanResponse(
      JSON.stringify(compacted),
      ['doc-atp', 'doc-glycolysis'],
      chunks,
      { lengthMinutes: 5, complexity: 'beginner' },
    )).not.toThrow()
  })
})

describe('buildDialoguePlanEvidenceRepairPrompt', () => {
  test('requests exact frozen excerpts without allowing claim or dialogue drift', () => {
    const plan = validPlan()
    const messages = buildDialoguePlanEvidenceRepairPrompt(plan, chunks, {
      claimId: 'claim-1',
      sourceId: 'doc-atp',
      quote: 'ATP is the primary energy currency of every cell.',
    })

    expect(messages[0]!.content).toContain('exact verbatim substring')
    expect(messages[0]!.content).toContain('audit every evidence quote')
    expect(messages[0]!.content).toContain('Do not change any spoken Utterance')
    expect(messages[1]!.content).toContain('ATP stores chemical energy used by cells.')
    expect(messages[1]!.content).toContain('ATP is the primary energy currency of every cell.')
  })
})

describe('Dialogue Plan validation error guards', () => {
  test('recognizes evidence correction context across Nitro module boundaries', () => {
    expect(isDialoguePlanEvidenceError({
      name: 'DialoguePlanEvidenceError',
      statusCode: 422,
      message: 'Claim Ledger evidence quote is absent from the frozen Source Manifest',
      plan: validPlan(),
      invalidEvidence: {
        claimId: 'claim-1',
        sourceId: 'doc-atp',
        quote: 'ATP is the primary energy currency of every cell.',
      },
    })).toBe(true)
  })

  test('recognizes duration correction context across Nitro module boundaries', () => {
    expect(isDialoguePlanDurationError({
      name: 'DialoguePlanDurationError',
      statusCode: 422,
      message: 'Dialogue Script duration is outside the requested tolerance',
      plan: validPlan(),
      actualWords: 200,
      targetWords: 750,
      minimumWords: 563,
      maximumWords: 937,
    })).toBe(true)
  })
})
