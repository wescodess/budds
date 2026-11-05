import { describe, expect, test } from 'vitest'
import { normalizeAssistantCitations } from '../../app/utils/normalize-assistant-citations'

describe('normalizeAssistantCitations', () => {
  test('converts parenthesized source labels into numeric citations', () => {
    expect(normalizeAssistantCitations('Photosynthesis happens in chloroplasts (Source 2).'))
      .toBe('Photosynthesis happens in chloroplasts [2].')
  })

  test('converts labeled source brackets with filenames into numeric citations', () => {
    expect(normalizeAssistantCitations('See [Source 1: biology.pdf] for details.'))
      .toBe('See [1] for details.')
  })

  test('leaves existing numeric citations untouched', () => {
    expect(normalizeAssistantCitations('The answer is [3].'))
      .toBe('The answer is [3].')
  })

  test('converts bare source labels into numeric citations', () => {
    expect(normalizeAssistantCitations('See Source 2 for details.'))
      .toBe('See [2] for details.')
  })

  test('converts multiple bare source labels with punctuation', () => {
    expect(normalizeAssistantCitations('Source 2, then SOURCE 4.'))
      .toBe('[2], then [4].')
  })

  test('normalizes multiple citation forms in one string', () => {
    expect(normalizeAssistantCitations('Compare (source 2) with [Source 4: notes.md].'))
      .toBe('Compare [2] with [4].')
  })

  test.each([
    ['a label across a line end', '[Source 1: notes\n]', '[1]'],
    ['a label split by text after a line end', '[Source 1: notes\nmore] x', '[[1]: notes\nmore] x'],
    ['a marker inside a rejected numeral', '[Source 0: Source 1]', '[Source 0: Source 1]'],
    ['an escaped opener before its citation', '\\[ [1] ] (Source 2)', '\\[ [1] ] [2]'],
  ])('keeps accepted forms for %s', (_name, source, expected) => {
    expect(normalizeAssistantCitations(source)).toBe(expected)
  })

  const whitespace = ' '.repeat(29_000)
  test.each([
    ['escaped openers sharing whitespace', `${'\\['.repeat(15_000)}]${whitespace}x (Source 2)`, `${'\\['.repeat(15_000)}]${whitespace}x [2]`],
    ['a whitespace-filled closed label', `[Source 1: y${whitespace}\nx] (Source 2)`, `[[1]: y${whitespace}\nx] [2]`],
    ['open labels sharing one line end', `${'[Source 1: a '.repeat(3_000)}\n\nx] (Source 2)`, `${'[Source 1: a '.repeat(3_000)}\n\nx] (Source 2)`],
  ])('stays bounded on %s', (_name, source, expected) => {
    const started = performance.now()
    expect(normalizeAssistantCitations(source)).toBe(expected)
    // Supplementary only: these took seconds to effectively unbounded time before the linear scanner.
    expect(performance.now() - started).toBeLessThan(2_000)
  })
})
