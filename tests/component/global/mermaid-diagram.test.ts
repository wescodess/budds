import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import MermaidDiagram from '~/components/global/MermaidDiagram.vue'

const { initialize, render } = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}))

vi.mock('mermaid', () => ({ default: { initialize, render } }))

describe('MermaidDiagram', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    render.mockResolvedValue({ svg: '<svg data-testid="diagram"></svg>' })
  })

  it('keeps strict security and the pinned Mermaid 11 layout and sizing', async () => {
    const wrapper = await mountSuspended(MermaidDiagram, { props: { code: 'flowchart TD\n  A --> B' } })

    await vi.waitFor(() => expect(wrapper.find('[data-testid="diagram"]').exists()).toBe(true))

    expect(initialize).toHaveBeenCalledOnce()
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({
      startOnLoad: false,
      securityLevel: 'strict',
      layout: 'dagre',
      look: 'classic',
      flowchart: { wrappingWidth: 200, minNodeWidth: 0 },
      state: { wrappingWidth: 200, minNodeWidth: 0 },
      mindmap: { layout: 'cose-bilkent' },
    }))
    expect(render).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-/), 'flowchart TD\n  A --> B')
  })
})
