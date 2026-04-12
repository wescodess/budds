import { describe, test, expect } from 'vitest'
import { buildFlashcardPrompt, parseFlashcardResponse } from './flashcard-prompt'
import type { AISearchChunk } from './ai-search'

function mkChunk(i: number, filename: string, content: string): AISearchChunk {
  return {
    id: `c${i}`,
    content,
    score: 0.9,
    attributes: { filename },
  } as AISearchChunk
}

describe('buildFlashcardPrompt', () => {
  test('happy path — includes formatted sources and target count in system message', () => {
    const chunks = [
      mkChunk(0, 'bio1.pdf', 'Mitochondria produce ATP via oxidative phosphorylation.'),
      mkChunk(1, 'bio2.pdf', 'Photosynthesis converts light energy into chemical energy.'),
    ]
    const msgs = buildFlashcardPrompt(chunks, { cardCount: 8 })
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('Target 8 cards')
    expect(msgs[1].content).toContain('[Source 0: bio1.pdf]')
    expect(msgs[1].content).toContain('[Source 1: bio2.pdf]')
  })

  test('clamps cardCount to 6..16 range', () => {
    const chunks = [mkChunk(0, 'a.pdf', 'x'), mkChunk(1, 'b.pdf', 'y')]
    const low = buildFlashcardPrompt(chunks, { cardCount: 2 })
    const high = buildFlashcardPrompt(chunks, { cardCount: 100 })
    expect(low[0].content).toContain('Target 6 cards')
    expect(high[0].content).toContain('Target 16 cards')
  })

  test('defaults cardCount to 12 when not provided', () => {
    const chunks = [mkChunk(0, 'a.pdf', 'x'), mkChunk(1, 'b.pdf', 'y')]
    const msgs = buildFlashcardPrompt(chunks)
    expect(msgs[0].content).toContain('Target 12 cards')
  })
})

describe('parseFlashcardResponse', () => {
  test('happy path — returns parsed set with 3 valid cards', () => {
    const raw = JSON.stringify({
      title: 'Cell Biology',
      cards: [
        { order: 0, front: 'What produces ATP?', back: 'Mitochondria', sourceIndex: 0 },
        { order: 1, front: 'Define photosynthesis', back: 'Converting light to chemical energy', sourceIndex: 1 },
        { order: 2, front: 'Role of chlorophyll?', back: 'Absorbs light energy', sourceIndex: 1 },
      ],
    })
    const result = parseFlashcardResponse(raw)
    expect(result.title).toBe('Cell Biology')
    expect(result.cards).toHaveLength(3)
    expect(result.cards[0].front).toBe('What produces ATP?')
    expect(result.cards[2].sourceIndex).toBe(1)
  })

  test('markdown-fenced response is unwrapped before parsing', () => {
    const raw = '```json\n' + JSON.stringify({
      title: 'Deck',
      cards: [
        { order: 0, front: 'Q', back: 'A', sourceIndex: 0 },
      ],
    }) + '\n```'
    const result = parseFlashcardResponse(raw)
    expect(result.title).toBe('Deck')
    expect(result.cards).toHaveLength(1)
  })

  test('drops invalid cards while keeping valid ones', () => {
    const raw = JSON.stringify({
      title: 'Mixed',
      cards: [
        { order: 0, front: 'Valid', back: 'Answer', sourceIndex: 0 },
        { order: 1, front: '', back: 'Empty front', sourceIndex: 0 }, // invalid: empty front
        { order: 2, front: 'No back', back: '', sourceIndex: 0 }, // invalid: empty back
        { order: 3, front: 'Missing src', back: 'OK', sourceIndex: -1 }, // invalid: negative sourceIndex
        { order: 4, front: 'Valid 2', back: 'Answer 2', sourceIndex: 1 },
      ],
    })
    const result = parseFlashcardResponse(raw)
    expect(result.cards).toHaveLength(2)
    expect(result.cards[0].front).toBe('Valid')
    expect(result.cards[1].front).toBe('Valid 2')
  })

  test('non-JSON input returns empty cards with default title', () => {
    const result = parseFlashcardResponse('totally not json')
    expect(result.title).toBe('Flash Cards')
    expect(result.cards).toEqual([])
  })

  test('tolerates trailing commas', () => {
    const raw = '{"title":"Deck","cards":[{"order":0,"front":"Q","back":"A","sourceIndex":0,},],}'
    const result = parseFlashcardResponse(raw)
    expect(result.cards).toHaveLength(1)
  })
})
