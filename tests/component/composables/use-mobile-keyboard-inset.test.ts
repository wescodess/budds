import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mockMatchMedia } from '../../support/match-media'

class MockVisualViewport extends EventTarget {
  height = 800
  offsetTop = 0
}

describe('useMobileKeyboardInset', () => {
  beforeEach(() => {
    vi.resetModules()
    mockMatchMedia({ touch: true, mobile: true })
    document.body.innerHTML = ''
    document.documentElement.style.removeProperty('--mobile-vh')
    document.documentElement.style.removeProperty('--vk-height')
    document.documentElement.style.removeProperty('--vk-safe-bottom')
    delete document.documentElement.dataset.keyboardOpen

    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 800,
    })

    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: new MockVisualViewport(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    document.documentElement.style.removeProperty('--mobile-vh')
    document.documentElement.style.removeProperty('--vk-height')
    document.documentElement.style.removeProperty('--vk-safe-bottom')
    delete document.documentElement.dataset.keyboardOpen
  })

  it('[P1] updates keyboard css vars when the visual viewport shrinks', async () => {
    const { useMobileKeyboardInset } = await import('~/composables/useMobileKeyboardInset')
    const viewport = window.visualViewport as unknown as MockVisualViewport
    const state = useMobileKeyboardInset()

    expect(document.documentElement.style.getPropertyValue('--mobile-vh')).toBe('800px')
    expect(document.documentElement.style.getPropertyValue('--vk-height')).toBe('0px')
    expect(document.documentElement.dataset.keyboardOpen).toBe('false')
    expect(state.keyboardOpen.value).toBe(false)

    viewport.height = 520
    viewport.dispatchEvent(new Event('resize'))
    await nextTick()

    expect(document.documentElement.style.getPropertyValue('--mobile-vh')).toBe('520px')
    expect(document.documentElement.style.getPropertyValue('--vk-height')).toBe('280px')
    expect(document.documentElement.style.getPropertyValue('--vk-safe-bottom')).toBe('env(safe-area-inset-bottom, 0px)')
    expect(document.documentElement.dataset.keyboardOpen).toBe('true')
    expect(state.keyboardOpen.value).toBe(true)
  })

  it('[P1] preserves the visible viewport bottom when iOS shifts the visual viewport downward', async () => {
    const { useMobileKeyboardInset } = await import('~/composables/useMobileKeyboardInset')
    const viewport = window.visualViewport as unknown as MockVisualViewport

    useMobileKeyboardInset()

    viewport.height = 520
    viewport.offsetTop = 56
    viewport.dispatchEvent(new Event('resize'))
    await nextTick()

    expect(document.documentElement.style.getPropertyValue('--mobile-vh')).toBe('576px')
    expect(document.documentElement.style.getPropertyValue('--vk-height')).toBe('224px')
    expect(document.documentElement.dataset.keyboardOpen).toBe('true')
  })
})
