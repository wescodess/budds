import { describe, expect, it } from 'vitest'
import { expandCitations } from '~/utils/expand-citations'

describe('expandCitations', () => {
  it('rewrites numeric citations to raw citation tags', () => {
    expect(expandCitations('context [1] and [2]')).toBe(
      'context <citation index="1">1</citation> and <citation index="2">2</citation>',
    )
  })

  it('normalizes source labels before rewriting citations', () => {
    expect(expandCitations('context (Source 1) and [Source 2: notes.pdf]')).toBe(
      'context <citation index="1">1</citation> and <citation index="2">2</citation>',
    )
  })
})
