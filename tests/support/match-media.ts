import { vi } from 'vitest'

type MatchMediaOptions = {
  touch?: boolean
  mobile?: boolean
}

export function mockMatchMedia(options: MatchMediaOptions = {}) {
  const touch = options.touch ?? false
  const mobile = options.mobile ?? touch

  const evaluate = (query: string) => {
    if (query.includes('hover: none') || query.includes('pointer: coarse')) return touch
    if (query.includes('(max-width: 1023px)')) return mobile
    if (query.includes('(min-width: 1024px)')) return !mobile
    return false
  }

  const matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: evaluate(query),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))

  vi.stubGlobal('matchMedia', matchMedia)
  return matchMedia
}
