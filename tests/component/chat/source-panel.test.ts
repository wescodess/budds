import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createSources } from '../../support/factories/chat.factory'

const sourcePanelPath = ['~', 'components', 'chat', 'SourcePanel.vue'].join('/')

describe('SourcePanel — AC #3', () => {
  it('[P0] should render a SourceCard for each source in the sources array', async () => {
    const SourcePanel = await import(sourcePanelPath)
    const sources = createSources(3)

    const wrapper = await mountSuspended(SourcePanel.default, {
      props: {
        sources,
        activeCitationIndex: null,
        open: true,
      },
    })

    const cards = wrapper.findAll('[aria-label^="Source passage from"]')
    expect(cards).toHaveLength(3)
  })

  it('[P0] should highlight the matching SourceCard when activeCitationIndex changes', async () => {
    const SourcePanel = await import(sourcePanelPath)
    const sources = createSources(3)

    const wrapper = await mountSuspended(SourcePanel.default, {
      props: {
        sources,
        activeCitationIndex: 1,
        open: true,
      },
    })

    const cards = wrapper.findAll('[aria-label^="Source passage from"]')
    expect(cards[1].classes()).toEqual(expect.arrayContaining([expect.stringContaining('ring')]))
  })

  it('[P1] should emit close when close button is clicked', async () => {
    const SourcePanel = await import(sourcePanelPath)
    const sources = createSources(2)

    const wrapper = await mountSuspended(SourcePanel.default, {
      props: {
        sources,
        activeCitationIndex: null,
        open: true,
      },
    })

    const closeButton = wrapper.find('[data-testid="source-panel-close"]')
    await closeButton.trigger('click')

    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('[P1] should not render when open prop is false', async () => {
    const SourcePanel = await import(sourcePanelPath)
    const sources = createSources(2)

    const wrapper = await mountSuspended(SourcePanel.default, {
      props: {
        sources,
        activeCitationIndex: null,
        open: false,
      },
    })

    const panel = wrapper.find('[data-testid="source-panel"]')
    expect(panel.exists()).toBe(false)
  })
})
