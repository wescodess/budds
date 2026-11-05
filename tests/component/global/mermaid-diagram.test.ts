import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import MermaidDiagram from '~/components/global/MermaidDiagram.vue'
import TextBlock from '~/components/learn/TextBlock.vue'
import Message from '~/components/chat/Message.vue'
import { compatibleDiagrams, refusedDiagrams } from '../../support/generated-content-fixtures'

const { initialize, render, getConfig } = vi.hoisted(() => ({
  initialize: vi.fn(), render: vi.fn(), getConfig: vi.fn(),
}))

vi.mock('mermaid', () => ({ default: { initialize, render, mermaidAPI: { getConfig } } }))

const code = 'flowchart TD\naccDescr: A leads to B.\nA --> B'

describe('MermaidDiagram', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getConfig.mockImplementation(() => initialize.mock.calls[0]?.[0] ?? {})
    render.mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>A leads to B.</text></svg>' })
  })

  it('keeps strict security and the pinned Mermaid layout and sizing behind the passive gate', async () => {
    const wrapper = await mountSuspended(MermaidDiagram, { props: { code } })
    try {
      await vi.waitFor(() => expect(initialize).toHaveBeenCalledTimes(2), { timeout: 10_000 })
      const presentation = {
        startOnLoad: false, securityLevel: 'strict', layout: 'dagre', look: 'classic',
        flowchart: { wrappingWidth: 200, minNodeWidth: 0 },
        state: { wrappingWidth: 200, minNodeWidth: 0 },
        mindmap: { layout: 'cose-bilkent' },
      }
      expect(initialize).toHaveBeenNthCalledWith(1, expect.objectContaining(presentation))
      expect(initialize).toHaveBeenLastCalledWith(expect.objectContaining({
        ...presentation,
        htmlLabels: false, suppressErrorRendering: true, maxTextSize: 2000, maxEdges: 64,
        flowchart: { ...presentation.flowchart, htmlLabels: false },
      }))
      expect(render).toHaveBeenCalledWith(expect.stringMatching(/^generated-mermaid-/), code, expect.any(HTMLElement))
      expect(document.querySelector('[data-generated-mermaid-staging]')).toBeNull()
    } finally { wrapper.unmount() }
  }, 15_000)

  it('keeps the session default: an undescribed diagram stays readable without importing Mermaid', async () => {
    const legacy = 'flowchart TD\nA --> B'
    const wrapper = await mountSuspended(MermaidDiagram, { props: { code: legacy } })
    try {
      await vi.waitFor(() => expect(wrapper.find('pre').text()).toBe(legacy), { timeout: 10_000 })
      expect(initialize).not.toHaveBeenCalled()
      expect(render).not.toHaveBeenCalled()
    } finally { wrapper.unmount() }
  }, 15_000)

  describe.each([['course', TextBlock], ['chat', Message]] as const)('%s sink', (_surface, sink) => {
    const mountFence = (source: string) => mountSuspended(sink, { props: { role: 'assistant', animate: false, content: `\`\`\`mermaid\n${source}\n\`\`\`` } })

    it.each(compatibleDiagrams)('sends an undescribed %s diagram to Mermaid', async (_family, source) => {
      const wrapper = await mountFence(source)
      try {
        await vi.waitFor(() => expect(render).toHaveBeenCalledWith(expect.stringMatching(/^generated-mermaid-/), `${source}\n`, expect.any(HTMLElement)), { timeout: 10_000 })
      } finally { wrapper.unmount() }
    }, 15_000)

    it.each(refusedDiagrams)('keeps %s as escaped code without Mermaid', async (_name, source) => {
      const wrapper = await mountFence(source)
      try {
        await vi.waitFor(() => expect(wrapper.find('pre').exists()).toBe(true), { timeout: 10_000 })
        expect(wrapper.find('pre').text()).toBe(source.trim())
        expect(render).not.toHaveBeenCalled()
      } finally { wrapper.unmount() }
    }, 15_000)
  })
})
