import { describe, expect, test } from 'vitest'
import { buildV2InterjectionPrompt, parseV2InterjectionScript } from './audio-overview-interjection'

const sources = [
  { sourceId: 'gravity-source', displayReference: 'Gravity', content: 'Gravity bends a moving object’s path.' },
  { sourceId: 'orbits-source', displayReference: 'Orbits', content: 'An orbit is continuous free fall around a body.' },
]

describe('v2 Interjection Dialogue Script', () => {
  test('prompts from the exact frozen Source Manifest identities and fixed Host contract', () => {
    const prompt = buildV2InterjectionPrompt({ question: 'Why does it orbit?', overviewTitle: 'Gravity', sources })
    expect(prompt[0]!.content).toContain('Host A')
    expect(prompt[0]!.content).toContain('Host B')
    expect(prompt[0]!.content).toContain('sourceIds')
    expect(prompt[0]!.content).toContain('claimId')
    expect(prompt[0]!.content).toContain('evidenceQuotes')
    expect(prompt[1]!.content).toContain('[gravity-source: Gravity]')
    expect(prompt[1]!.content).toContain('[orbits-source: Orbits]')
  })

  test('accepts a grounded alternating answer and rejects source escape or spoken markup', () => {
    const valid = JSON.stringify({ utterances: [
      {
        speaker: 'host_a', text: 'Gravity bends the path.', claimId: 'gravity-claim', claimText: 'Gravity bends a moving object’s path.',
        sourceIds: ['gravity-source'], evidenceQuotes: [{ sourceId: 'gravity-source', quote: 'Gravity bends a moving object’s path.' }],
        emotionalIntent: 'helpful', deliveryIntent: 'warm', pauseAfterMs: 200,
      },
      {
        speaker: 'host_b', text: 'So the object keeps falling around it.', claimId: 'orbit-claim', claimText: 'An orbit is continuous free fall around a body.',
        sourceIds: ['orbits-source'], evidenceQuotes: [{ sourceId: 'orbits-source', quote: 'An orbit is continuous free fall around a body.' }],
        emotionalIntent: 'curious', deliveryIntent: 'clear', pauseAfterMs: 300,
      },
    ] })
    expect(parseV2InterjectionScript(valid, sources).utterances).toHaveLength(2)

    expect(() => parseV2InterjectionScript(valid.replaceAll('gravity-source', 'other-folder-source'), sources))
      .toThrow(/frozen Source Manifest/)
    expect(() => parseV2InterjectionScript(valid.replace('Gravity bends the path.', '[excited] Gravity bends the path.'), sources))
      .toThrow(/delivery markup/)

    const emptyClaim = JSON.parse(valid)
    emptyClaim.utterances[0].claimId = ''
    expect(() => parseV2InterjectionScript(JSON.stringify(emptyClaim), sources))
      .toThrow(/supported claim evidence/i)

    const fabricatedQuote = JSON.parse(valid)
    fabricatedQuote.utterances[0].evidenceQuotes[0].quote = 'Gravity always makes objects accelerate at exactly ten metres per second.'
    expect(() => parseV2InterjectionScript(JSON.stringify(fabricatedQuote), sources))
      .toThrow(/absent from the frozen Source Manifest/i)
  })
})
