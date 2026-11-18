import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import TextBlock from '~/components/learn/TextBlock.vue'
import Message from '~/components/chat/Message.vue'
import { createSources } from '../support/factories/chat.factory'

const parser = vi.hoisted(() => ({ pending: undefined as (() => void) | undefined }))
vi.mock('@nuxtjs/mdc/runtime', async (original) => {
  const actual = await original<typeof import('@nuxtjs/mdc/runtime')>()
  return {
    ...actual,
    parseMarkdown: async (...args: Parameters<typeof actual.parseMarkdown>) => {
      if (args[0].startsWith('Unavailable')) throw new Error('inert parser failure')
      if (args[0].startsWith('Delayed')) await new Promise<void>(resolve => { parser.pending = resolve })
      return actual.parseMarkdown(...args)
    },
  }
})

describe('generated content asynchronous failures', () => {
  afterEach(() => { parser.pending?.(); parser.pending = undefined })

  it.each([TextBlock, Message])('discards an older parse after a new revision and after unmount', async (component) => {
    const wrapper = await mountSuspended(component, { props: { role: 'assistant', content: 'Initial **lesson**', animate: false } })
    try {
      await wrapper.setProps({ content: 'Delayed **old lesson**' })
      await vi.waitFor(() => expect(parser.pending).toBeTypeOf('function'))
      await wrapper.setProps({ content: 'Newest **lesson**' })
      await vi.waitFor(() => expect(wrapper.find('strong').text()).toBe('lesson'))
      parser.pending!()
      await flushPromises()
      expect(wrapper.text()).toContain('Newest')
      expect(wrapper.text()).not.toContain('old lesson')
      parser.pending = undefined
      await wrapper.setProps({ content: 'Delayed **unmounted lesson**' })
      await vi.waitFor(() => expect(parser.pending).toBeTypeOf('function'))
    } finally { wrapper.unmount() }
    parser.pending!()
    await flushPromises()
    expect(wrapper.element.isConnected).toBe(false)
  })

  it('keeps the previous result on screen while a streaming parse is pending', async () => {
    const skeleton = '[data-slot="skeleton"]'
    const wrapper = await mountSuspended(Message, { props: { role: 'assistant', content: '', streaming: true, animate: false } })
    try {
      await wrapper.setProps({ content: 'Delayed **first**' })
      await vi.waitFor(() => expect(parser.pending).toBeTypeOf('function'))
      await vi.waitFor(() => expect(wrapper.find(skeleton).exists()).toBe(true))
      parser.pending!()
      parser.pending = undefined
      await vi.waitFor(() => expect(wrapper.find('strong').text()).toBe('first'))
      expect(wrapper.find(skeleton).exists()).toBe(false)

      await wrapper.setProps({ content: 'Delayed **first** and **second**' })
      await vi.waitFor(() => expect(parser.pending).toBeTypeOf('function'))
      await flushPromises()
      expect(wrapper.findAll('strong').map(node => node.text())).toEqual(['first'])
      expect(wrapper.find(skeleton).exists()).toBe(false)
      expect(wrapper.find('[data-testid="streaming-cursor"]').exists()).toBe(true)

      await wrapper.setProps({ content: 'Newest **third**' })
      await vi.waitFor(() => expect(wrapper.find('strong').text()).toBe('third'))
      parser.pending!()
      parser.pending = undefined
      await flushPromises()
      expect(wrapper.findAll('strong').map(node => node.text())).toEqual(['third'])
    } finally { wrapper.unmount() }
  })

  it('does not bring the skeleton back over a whole-document fallback', async () => {
    const skeleton = '[data-slot="skeleton"]'
    const wrapper = await mountSuspended(Message, { props: { role: 'assistant', content: 'Unavailable first', streaming: true, animate: false } })
    try {
      expect(wrapper.text()).toContain('Unavailable first')
      await wrapper.setProps({ content: 'Delayed text' })
      await vi.waitFor(() => expect(parser.pending).toBeTypeOf('function'))
      await flushPromises()
      expect(wrapper.find(skeleton).exists()).toBe(false)
      expect(wrapper.text()).toContain('Delayed text')
    } finally { wrapper.unmount() }
  })

  it('keeps fallback citation association while code, links and source excerpts remain text', async () => {
    const content = 'Unavailable [1] [0] [2]\n`[1]`\n[Label [1]](https://example.invalid/[1])\n:citation[1]'
    const wrapper = await mountSuspended(Message, { props: { role: 'assistant', content, sources: createSources(1), animate: false } })
    try {
      expect(wrapper.findAll('button[aria-label^="Source "]')).toHaveLength(1)
      expect(wrapper.find('a, citation').exists()).toBe(false)
      expect(wrapper.text()).toContain('`[1]`')
      await wrapper.find('button[aria-label^="Source 1"]').trigger('click')
      expect(wrapper.emitted('citation-click')).toEqual([[1]])
    } finally { wrapper.unmount() }
  })
})
