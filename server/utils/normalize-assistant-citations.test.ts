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
})
