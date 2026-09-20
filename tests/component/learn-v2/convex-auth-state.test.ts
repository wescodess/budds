import { describe, expect, it } from 'vitest'
import { isCurrentAuthenticatedCallback } from '../../../app/utils/convex-auth-state'

describe('Convex auth callback authority', () => {
  it('accepts only a positive callback for the current logged-in session', () => {
    expect(isCurrentAuthenticatedCallback(3, 3, true, true)).toBe(true)
    expect(isCurrentAuthenticatedCallback(3, 3, true, false)).toBe(false)
    expect(isCurrentAuthenticatedCallback(2, 3, true, true)).toBe(false)
    expect(isCurrentAuthenticatedCallback(3, 3, false, true)).toBe(false)
  })
})
