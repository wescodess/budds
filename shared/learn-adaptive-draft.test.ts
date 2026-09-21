import { describe, expect, test } from 'vitest'
import { validateNeedFirstDraftInput } from './learn-adaptive-draft'

describe('need-first draft contract', () => {
  test('preserves learner wording while accepting every bounded source scope', () => {
    const need = '  Help me understand why this proof works.  '
    const outcome = 'Explain the proof in my own words.'
    for (const sourceScope of [
      { kind: 'none' as const },
      { kind: 'folder' as const, folderId: 'folder-id' },
      { kind: 'document' as const, documentId: 'document-id' },
      { kind: 'url' as const, url: 'https://example.com/guide?q=1' },
      { kind: 'pasted' as const, contentDigest: `sha256:${'a'.repeat(64)}`, byteCount: 42 },
    ]) expect(validateNeedFirstDraftInput({ need, outcome, intent: 'understand', availableTime: '15', sourceScope })).toMatchObject({ need, outcome, sourceScope })
  })

  test('keeps a separate outcome optional so the need alone remains sufficient', () => {
    expect(validateNeedFirstDraftInput({ need: 'Help me understand this mechanism.', intent: 'understand', availableTime: '15', sourceScope: { kind: 'none' } })).toEqual({ need: 'Help me understand this mechanism.', intent: 'understand', availableTime: '15', sourceScope: { kind: 'none' } })
  })

  test.each([
    [{ need: 'short', outcome: 'Explain this', intent: 'understand', availableTime: '15', sourceScope: { kind: 'none' } }, '8 meaningful'],
    [{ need: 'Learn this', outcome: 'Explain this', intent: 'understand', availableTime: '15', sourceScope: { kind: 'url', url: 'ftp://example.com' } }, 'URL'],
    [{ need: 'Learn this', outcome: 'Explain this', intent: 'understand', availableTime: '15', sourceScope: { kind: 'pasted', contentDigest: `sha256:${'a'.repeat(64)}`, byteCount: 0 } }, 'paste'],
    [{ need: 'Learn this', outcome: 'Explain this', intent: 'understand', availableTime: '15', sourceScope: { kind: 'pasted', contentDigest: 'raw material', byteCount: 12 } }, 'digest'],
  ])('rejects the smallest malformed input without normalizing the draft', (input, message) => {
    expect(() => validateNeedFirstDraftInput(input as never)).toThrow(new RegExp(message, 'i'))
  })
})
