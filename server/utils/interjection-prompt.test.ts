/// <reference types="vite/client" />
import { describe, expect, test } from 'vitest'
import {
  buildInterjectionPrompt,
  parseInterjectionResponse,
  capInterjectionTurns,
  MIN_ANSWER_TURNS,
  MAX_ANSWER_TURNS,
} from './interjection-prompt'
import type { AISearchChunk } from './ai-search'

function chunk(i: number, filename: string, content: string): AISearchChunk {
  return {
    id: `chunk-${i}`,
    content,
    score: 1,
    attributes: { filename, documentId: 'doc-x', userId: 'u1', folderId: 'f1' },
  }
}

describe('buildInterjectionPrompt', () => {
  test('returns a system + user message', () => {
    const messages = buildInterjectionPrompt({
      question: 'What does ATP stand for?',
      overviewTitle: 'Cellular respiration',
      chunks: [chunk(0, 'bio.pdf', 'ATP is adenosine triphosphate.')],
    })
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('system')
    expect(messages[1]!.role).toBe('user')
  })

  test('embeds the listener question in the system prompt', () => {
    const messages = buildInterjectionPrompt({
      question: 'What are thylakoids exactly?',
      chunks: [],
    })
    expect(messages[0]!.content).toContain('What are thylakoids exactly?')
  })

  test('embeds the overview title when provided', () => {
    const messages = buildInterjectionPrompt({
      question: 'Clarify?',
      overviewTitle: 'Photosynthesis deep dive',
      chunks: [],
    })
    expect(messages[0]!.content).toContain('Photosynthesis deep dive')
  })

  test('trims long questions to 500 characters', () => {
    const long = 'q'.repeat(900)
    const messages = buildInterjectionPrompt({ question: long, chunks: [] })
    // Find the "listener asked:" line and check the quoted content length
    const match = messages[0]!.content.match(/The listener asked: "(.+?)"/s)
    expect(match).not.toBeNull()
    expect(match![1]!.length).toBe(500)
  })

  test('enforces 2–4 turn range in system prompt', () => {
    const messages = buildInterjectionPrompt({ question: 'x', chunks: [] })
    expect(messages[0]!.content).toContain(`${MIN_ANSWER_TURNS}–${MAX_ANSWER_TURNS} turns`)
  })

  test('lists source passages in the user message when chunks are present', () => {
    const messages = buildInterjectionPrompt({
      question: 'q',
      chunks: [
        chunk(0, 'a.pdf', 'Passage A'),
        chunk(1, 'b.pdf', 'Passage B'),
      ],
    })
    expect(messages[1]!.content).toContain('[Source 0: a.pdf]')
    expect(messages[1]!.content).toContain('Passage A')
    expect(messages[1]!.content).toContain('[Source 1: b.pdf]')
  })

  test('falls back to "(no sources provided)" when chunks are empty', () => {
    const messages = buildInterjectionPrompt({ question: 'q', chunks: [] })
    expect(messages[1]!.content).toContain('(no sources provided)')
  })
})

describe('parseInterjectionResponse', () => {
  test('parses a valid 3-turn response', () => {
    const raw = JSON.stringify({
      turns: [
        { speaker: 'host_a', text: 'Right — so ATP stands for adenosine triphosphate.', sourceIndex: 0 },
        { speaker: 'host_b', text: 'Oh interesting. Why tri-phosphate?' },
        { speaker: 'host_a', text: 'The three phosphate bonds store the energy.' },
      ],
    })
    const result = parseInterjectionResponse(raw)
    expect(result.turns.length).toBe(3)
    expect(result.turns[0]!.speaker).toBe('host_a')
    expect(result.turns[0]!.sourceIndex).toBe(0)
  })

  test('strips markdown fences', () => {
    const raw = '```json\n{"turns": [{"speaker": "host_a", "text": "Hi"}]}\n```'
    const result = parseInterjectionResponse(raw)
    expect(result.turns.length).toBe(1)
  })

  test('tolerates trailing commas', () => {
    const raw = '{"turns": [{"speaker": "host_a", "text": "Hi",},]}'
    const result = parseInterjectionResponse(raw)
    expect(result.turns.length).toBe(1)
  })

  test('drops turns that fail schema validation', () => {
    const raw = JSON.stringify({
      turns: [
        { speaker: 'host_a', text: 'Ok' },
        { speaker: 'host_c', text: 'Bad speaker' },
        { speaker: 'host_b', text: '' },
        { speaker: 'host_b', text: 'Valid' },
      ],
    })
    const result = parseInterjectionResponse(raw)
    expect(result.turns.length).toBe(2)
    expect(result.turns.map(t => t.speaker)).toEqual(['host_a', 'host_b'])
  })

  test('returns {turns: []} on malformed JSON', () => {
    const result = parseInterjectionResponse('<not json at all>')
    expect(result.turns).toEqual([])
  })

  test('returns {turns: []} on non-object JSON', () => {
    const result = parseInterjectionResponse('[1, 2, 3]')
    expect(result.turns).toEqual([])
  })
})

describe('capInterjectionTurns', () => {
  test('returns input unchanged when within cap', () => {
    const turns = [
      { speaker: 'host_a' as const, text: 'a' },
      { speaker: 'host_b' as const, text: 'b' },
    ]
    expect(capInterjectionTurns(turns)).toEqual(turns)
  })

  test('truncates to MAX_ANSWER_TURNS', () => {
    const turns = [
      { speaker: 'host_a' as const, text: '1' },
      { speaker: 'host_b' as const, text: '2' },
      { speaker: 'host_a' as const, text: '3' },
      { speaker: 'host_b' as const, text: '4' },
      { speaker: 'host_a' as const, text: '5' },
      { speaker: 'host_b' as const, text: '6' },
    ]
    expect(capInterjectionTurns(turns).length).toBe(MAX_ANSWER_TURNS)
  })
})
