import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const citationBadgePath = ['~', 'components', 'chat', 'CitationBadge.vue'].join('/')

describe('CitationBadge — AC #2, #3, #4', () => {
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
})
