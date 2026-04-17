import { describe, expect, test } from 'vitest'
import {
  audioScriptResponseSchema,
  buildAudioScriptPrompt,
  estimateTurnDurationMs,
  parseAudioScriptResponse,
  splitOversizedTurns,
} from './audio-script-prompt'
import type { AISearchChunk } from './ai-search'

function chunk(i: number, content: string, filename = 'bio.pdf'): AISearchChunk {
  return {
    id: `c${i}`,
    content,
    score: 1,
    attributes: { filename, folderId: 'f1', documentId: 'd1', userId: 'u1' },
  }
}

describe('buildAudioScriptPrompt', () => {
  test('emits system + user messages with source passages', () => {
    const chunks = [chunk(0, 'ATP stores chemical energy.'), chunk(1, 'Glycolysis breaks glucose to pyruvate.')]
    const messages = buildAudioScriptPrompt(chunks, { lengthMinutes: 10, complexity: 'beginner' })
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('system')
    expect(messages[0]!.content).toMatch(/Host A/)
    expect(messages[0]!.content).toMatch(/BEGINNER/)
    expect(messages[1]!.role).toBe('user')
    expect(messages[1]!.content).toContain('ATP stores chemical energy.')
    expect(messages[1]!.content).toContain('Glycolysis breaks glucose')
  })

  test('switches complexity rule for expert', () => {
    const messages = buildAudioScriptPrompt([chunk(0, 'x')], { complexity: 'expert' })
    expect(messages[0]!.content).toMatch(/EXPERT/)
  })

  test('handles empty chunks gracefully', () => {
    const messages = buildAudioScriptPrompt([])
    expect(messages[1]!.content).toContain('(no sources provided)')
  })
})

describe('parseAudioScriptResponse', () => {
  test('parses valid JSON', () => {
    const raw = JSON.stringify({
      title: 'Cellular respiration',
      turns: [
        { speaker: 'host_a', text: 'Welcome.', sourceIndex: 0 },
        { speaker: 'host_b', text: 'Hi there.' },
      ],
    })
    const parsed = parseAudioScriptResponse(raw)
    expect(parsed.title).toBe('Cellular respiration')
    expect(parsed.turns).toHaveLength(2)
  })

  test('strips ```json fences', () => {
    const raw = '```json\n{"title":"T","turns":[{"speaker":"host_a","text":"hi"}]}\n```'
    const parsed = parseAudioScriptResponse(raw)
    expect(parsed.title).toBe('T')
    expect(parsed.turns).toHaveLength(1)
  })

  test('recovers from trailing commas', () => {
    const raw = '{"title":"T","turns":[{"speaker":"host_a","text":"hi"},]}'
    const parsed = parseAudioScriptResponse(raw)
    expect(parsed.turns).toHaveLength(1)
  })

  test('rejects turns with unknown speaker values', () => {
    const raw = JSON.stringify({
      title: 'T',
      turns: [
        { speaker: 'host_c', text: 'bogus' },
        { speaker: 'host_a', text: 'ok' },
      ],
    })
    const parsed = parseAudioScriptResponse(raw)
    expect(parsed.turns).toHaveLength(1)
    expect(parsed.turns[0]!.speaker).toBe('host_a')
  })

  test('returns empty turns + default title when JSON is invalid', () => {
    const parsed = parseAudioScriptResponse('not json at all')
    expect(parsed.title).toBe('Audio Overview')
    expect(parsed.turns).toEqual([])
  })

  test('returns empty turns when turns missing', () => {
    const parsed = parseAudioScriptResponse('{"title":"T"}')
    expect(parsed.turns).toEqual([])
  })

  test('drops empty text turns', () => {
    const raw = JSON.stringify({
      title: 'T',
      turns: [{ speaker: 'host_a', text: '' }, { speaker: 'host_b', text: 'ok' }],
    })
    const parsed = parseAudioScriptResponse(raw)
    expect(parsed.turns).toHaveLength(1)
    expect(parsed.turns[0]!.speaker).toBe('host_b')
  })
})

describe('audioScriptResponseSchema', () => {
  test('validates shape directly', () => {
    const res = audioScriptResponseSchema.safeParse({
      title: 'x',
      turns: [{ speaker: 'host_a', text: 'hi' }],
    })
    expect(res.success).toBe(true)
  })
})

describe('splitOversizedTurns', () => {
  test('passes short turns through unchanged', () => {
    const turns = [{ speaker: 'host_a' as const, text: 'Short sentence.' }]
    expect(splitOversizedTurns(turns)).toEqual(turns)
  })

  test('splits very long text at sentence boundaries', () => {
    const sentence = 'This is a sentence that is long. '.repeat(80)
    const turns = [{ speaker: 'host_a' as const, text: sentence.trim(), sourceIndex: 2 }]
    const split = splitOversizedTurns(turns)
    expect(split.length).toBeGreaterThan(1)
    for (const t of split) {
      expect(t.speaker).toBe('host_a')
      expect(t.sourceIndex).toBe(2)
      expect(t.text.length).toBeLessThanOrEqual(1800)
    }
  })
})

describe('estimateTurnDurationMs', () => {
  test('returns at least 1 second for any text', () => {
    expect(estimateTurnDurationMs('a')).toBeGreaterThanOrEqual(1000)
  })

  test('scales with text length', () => {
    const short = estimateTurnDurationMs('hello')
    const long = estimateTurnDurationMs('hello world '.repeat(50))
    expect(long).toBeGreaterThan(short)
  })
})
