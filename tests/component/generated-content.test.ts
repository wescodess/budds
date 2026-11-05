import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useRuntimeConfig } from '#app'
import TextBlock from '~/components/learn/TextBlock.vue'
import Message from '~/components/chat/Message.vue'
import SectionBlockRenderer from '~/components/learn/SectionBlockRenderer.vue'
import { rejectedGeneratedContent } from '../support/generated-content-fixtures'
import { createSources } from '../support/factories/chat.factory'

describe('generated content at the rendering sinks', () => {
  const wrappers: Array<{ unmount: () => void }> = []
  afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))

  it.each(['course', 'chat'] as const)('%s treats document metadata as escaped text', async (surface) => {
    const content = '---\ncomponent:\n  props:\n    id: metadata-canary\n---\nReadable explanation'
    const wrapper = surface === 'course'
      ? await mountSuspended(TextBlock, { props: { content } })
      : await mountSuspended(Message, { props: { role: 'assistant', content, animate: false } })
    wrappers.push(wrapper)
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.text()).toContain('Readable explanation'))
    expect(wrapper.find('#metadata-canary').exists()).toBe(false)
    expect(wrapper.text()).toContain(content)
  })



  for (const mode of ['course', 'offline', 'chat replay', 'chat streaming'] as const) {
    it.each(rejectedGeneratedContent)(`${mode} leaves %s inert in the rendered DOM`, async (_name, source) => {
      const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('render must not fetch'))
      const content = JSON.parse(JSON.stringify(source)) as string
      const wrapper = mode === 'offline'
        ? await mountSuspended(SectionBlockRenderer, { props: {
            contentBlocks: [{ type: 'text', content, order: 0 }],
            courseId: 'course-canary' as never, isOffline: true,
          } })
        : mode === 'course'
          ? await mountSuspended(TextBlock, { props: { content } })
          : await mountSuspended(Message, { props: { role: 'assistant', content, streaming: mode === 'chat streaming', animate: false } })
      wrappers.push(wrapper)
      await vi.waitFor(() => expect(wrapper.text()).toContain(content))
      expect(wrapper.find('a, img, iframe, video, form, input, math, style, citation, generated-canary').exists()).toBe(false)
      expect(wrapper.find('[title="canary"], #canary, .canary').exists()).toBe(false)
      expect(fetch).not.toHaveBeenCalled()
      fetch.mockRestore()
    })
  }

  it('keeps native Markdown and application components independent of global component maps', async () => {
    const config = useRuntimeConfig()
    const original = config.public.mdc
    let mounts = 0
    const canary = defineComponent({ setup() { mounts++; return () => h('aside', 'component canary') } })
    Object.assign(config.public, { mdc: { components: { prose: true, map: { p: 'GeneratedCanary', pre: 'GeneratedCanary', citation: 'GeneratedCanary', a: 'GeneratedCanary' } } } })
    try {
      const content = '## Lesson\n\nOrdinary **strong** and *emphasis* [1].\n\n- One\n- Two\n\n> Quote\n\n---\n\n| Topic | Fact |\n| --- | --- |\n| A | B |\n\n```unknown-language\nliteral [1] <sample>\n```\n\n[Read](HTTPS://EXAMPLE.INVALID:443/notes)'
      for (const surface of ['course', 'chat'] as const) {
        const wrapper = surface === 'course'
          ? await mountSuspended(TextBlock, { props: { content }, global: { components: { GeneratedCanary: canary } } })
          : await mountSuspended(Message, { props: { role: 'assistant', content, sources: createSources(1), animate: false }, global: { components: { GeneratedCanary: canary } } })
        wrappers.push(wrapper)
        await vi.waitFor(() => expect(wrapper.find('table').exists()).toBe(true))
        expect(wrapper.find('h2').text()).toBe('Lesson')
        expect(wrapper.find('strong').text()).toBe('strong')
        expect(wrapper.find('em').text()).toBe('emphasis')
        expect(wrapper.findAll('li')).toHaveLength(2)
        expect(wrapper.find('blockquote').text()).toBe('Quote')
        expect(wrapper.findAll('th')).toHaveLength(2)
        expect(wrapper.find('pre').text()).toBe('literal [1] <sample>')
        expect(wrapper.find('pre button').exists()).toBe(false)
        expect(wrapper.find('a').attributes()).toEqual({ href: 'https://example.invalid/notes' })
        expect(wrapper.find('style, .shiki').exists()).toBe(false)
      }
      expect(mounts).toBe(0)
    } finally { Object.assign(config.public, { mdc: original }) }
  })

  it.each([
    '/app/private', '//example.invalid/path', '#section', 'https://user:pass@example.invalid',
    'http://localhost:3000/app', 'https://budds-ci.invalid/app', 'https://example.invalid/%0a',
    'https://example.invalid/%250a', 'https://example.invalid/%zz', 'file:///canary',
    'data:text/plain,canary', 'blob:https://example.invalid/canary',
  ])('leaves rejected link %s as escaped text at both sinks', async (destination) => {
    const content = `[Readable canary](${destination})`
    for (const component of [TextBlock, Message]) {
      const wrapper = await mountSuspended(component, { props: { content, role: 'assistant', animate: false } })
      wrappers.push(wrapper)
      await vi.waitFor(() => expect(wrapper.text()).toContain(content))
      expect(wrapper.find('a').exists()).toBe(false)
    }
  })

  it('keeps citations message-local, prose-only, range-checked and reactive as sources arrive', async () => {
    const content = 'Fact [1] [Source 2: notes.pdf] (Source 1) [0] [99] [9007199254740992].\n\n`[1] Source 2`\n\n```text\n[1]\n```\n\n[Label [1]](https://example.invalid/notes/[2])'
    const wrapper = await mountSuspended(Message, { props: { role: 'assistant', content, sources: [], streaming: true, animate: false } })
    wrappers.push(wrapper)
    await vi.waitFor(() => expect(wrapper.find('p').exists()).toBe(true))
    expect(wrapper.findAll('button')).toHaveLength(0)
    await wrapper.setProps({ sources: createSources(2) })
    await vi.waitFor(() => expect(wrapper.findAll('button[aria-label^="Source "]')).toHaveLength(3))
    expect(wrapper.text()).toContain('[0] [99] [9007199254740992]')
    expect(wrapper.find('a').text()).toBe('Label [1]')
    expect(wrapper.find('pre').text()).toBe('[1]')
    await wrapper.find('button[aria-label^="Source 1"]').trigger('click')
    expect(wrapper.emitted('citation-click')).toEqual([[1]])
    const other = await mountSuspended(Message, { props: { role: 'assistant', content: 'Other [2]', sources: createSources(1), animate: false } })
    wrappers.push(other)
    await vi.waitFor(() => expect(other.text()).toContain('Other [2]'))
    expect(other.findAll('button')).toHaveLength(0)
  })

  it('revalidates successive partial streaming inputs and clears stale rich content', async () => {
    const wrapper = await mountSuspended(Message, { props: { role: 'assistant', content: 'Initial **text** [1]', sources: createSources(1), streaming: true, animate: false } })
    wrappers.push(wrapper)
    await vi.waitFor(() => expect(wrapper.find('strong').exists()).toBe(true))
    const content = '<b title="canary">streaming canary</b>'
    for (let length = 1; length <= content.length; length++) {
      await wrapper.setProps({ content: content.slice(0, length) })
      await flushPromises()
      expect(wrapper.find('[title="canary"], b, citation').exists()).toBe(false)
    }
    await vi.waitFor(() => expect(wrapper.text()).toContain(content))
    await wrapper.setProps({ content: 'Final **text** [1]', streaming: false })
    await vi.waitFor(() => expect(wrapper.find('strong').text()).toBe('text'))
    expect(wrapper.findAll('button[aria-label^="Source "]')).toHaveLength(1)
  })
})
