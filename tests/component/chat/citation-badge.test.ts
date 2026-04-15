import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { mockMatchMedia } from '../../support/match-media'

const citationBadgePath = ['~', 'components', 'chat', 'CitationBadge.vue'].join('/')

function dispatchPointer(target: Element, type: string, init: Record<string, unknown>) {
  const event = typeof PointerEvent === 'function'
    ? new PointerEvent(type, { bubbles: true, ...init })
    : Object.assign(new Event(type, { bubbles: true }), init)
  target.dispatchEvent(event)
}

describe('CitationBadge — AC #2, #3, #4', () => {
  beforeEach(() => {
    mockMatchMedia()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('[P0] should render the citation index number as a pill', async () => {
    const CitationBadge = await import(citationBadgePath)

    const wrapper = await mountSuspended(CitationBadge.default, {
      props: {
        index: 1,
        filename: 'lecture-notes.pdf',
      },
    })

    expect(wrapper.text()).toContain('1')
  })

  it('[P0] should emit click event with the citation index when clicked', async () => {
    const CitationBadge = await import(citationBadgePath)

    const wrapper = await mountSuspended(CitationBadge.default, {
      props: {
        index: 3,
        filename: 'biology.pdf',
      },
    })

    const button = wrapper.find('button')
    await button.trigger('click')

    expect(wrapper.emitted('click')).toBeTruthy()
    expect(wrapper.emitted('click')![0]).toEqual([3])
  })

  it('[P0] should have correct aria-label with index and filename', async () => {
    const CitationBadge = await import(citationBadgePath)

    const wrapper = await mountSuspended(CitationBadge.default, {
      props: {
        index: 2,
        filename: 'chemistry-notes.pdf',
      },
    })

    const button = wrapper.find('button')
    expect(button.attributes('aria-label')).toBe('Source 2 from chemistry-notes.pdf')
  })

  it('[P0] should be keyboard focusable as a native button', async () => {
    const CitationBadge = await import(citationBadgePath)

    const wrapper = await mountSuspended(CitationBadge.default, {
      props: {
        index: 1,
        filename: 'notes.pdf',
      },
    })

    const button = wrapper.find('button')
    expect(button.exists()).toBe(true)
    expect(button.attributes('type')).toBe('button')
  })

  it('[P1] should emit long-press on touch devices', async () => {
    vi.useFakeTimers()
    mockMatchMedia({ touch: true, mobile: true })

    const CitationBadge = await import(citationBadgePath)
    const wrapper = await mountSuspended(CitationBadge.default, {
      props: {
        index: 4,
        filename: 'field-guide.pdf',
      },
    })

    const button = wrapper.get('button')
    dispatchPointer(button.element, 'pointerdown', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 40,
      clientY: 40,
    })

    await vi.advanceTimersByTimeAsync(500)

    dispatchPointer(button.element, 'pointerup', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 40,
      clientY: 40,
    })

    expect(wrapper.emitted('long-press')).toEqual([[4]])
  })
})
