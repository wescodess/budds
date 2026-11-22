import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import TextBlock from '~/components/learn/TextBlock.vue'
import Message from '~/components/chat/Message.vue'
import { parseGeneratedMarkdown } from '~/utils/generated-markdown'
import { rejectedGeneratedContent } from '../support/generated-content-fixtures'
import { goodMarkdownCorpus, mixedMarkdownCorpus } from '../support/generated-markdown-corpus'
import { createSources } from '../support/factories/chat.factory'

const refusedBlock = '[data-generated-refused]'
const blockedElements = 'img, iframe, video, form, input, math, style, citation, generated-canary, .canary, #canary, [title]'
const surfaces = ['course', 'chat'] as const
const context = { applicationOrigins: ['https://budds-ci.invalid'], sourceCount: 2 }

describe('realistic generated Markdown corpus', () => {
  const wrappers: Array<{ unmount: () => void }> = []
  afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))
  const mountAt = async (surface: typeof surfaces[number], content: string) => {
    const wrapper = surface === 'course'
      ? await mountSuspended(TextBlock, { props: { content } })
      : await mountSuspended(Message, { props: { role: 'assistant', content, sources: createSources(2), animate: false } })
    wrappers.push(wrapper)
    await flushPromises()
    return wrapper
  }

  it('holds enough samples to represent ordinary model output', () => {
    expect(goodMarkdownCorpus.length + mixedMarkdownCorpus.length).toBeGreaterThanOrEqual(25)
  })

  describe.each(surfaces)('%s', (surface) => {
    it.each(goodMarkdownCorpus)('renders $name richly', async ({ source, selectors, text, citations }) => {
      const wrapper = await mountAt(surface, source)
      await vi.waitFor(() => expect(wrapper.find(selectors[0]!).exists()).toBe(true))
      expect(wrapper.find(refusedBlock).exists()).toBe(false)
      for (const selector of selectors) expect(wrapper.find(selector).exists(), selector).toBe(true)
      for (const literal of text) expect(wrapper.text()).toContain(literal)
      expect(wrapper.find(blockedElements).exists()).toBe(false)
      if (surface === 'chat') expect(wrapper.findAll('button[aria-label^="Source "]')).toHaveLength(citations ?? 0)
    })

    it.each(mixedMarkdownCorpus)('degrades only the refused block in $name', async ({ source, refused, selectors, text }) => {
      const wrapper = await mountAt(surface, source)
      await vi.waitFor(() => expect(wrapper.find(refusedBlock).exists()).toBe(true))
      const blocks = wrapper.findAll(refusedBlock)
      expect(blocks).toHaveLength(1)
      expect(blocks[0]!.element.textContent).toBe(refused)
      for (const selector of selectors) expect(wrapper.find(selector).exists(), selector).toBe(true)
      for (const literal of text) expect(wrapper.text()).toContain(literal)
      expect(wrapper.find(blockedElements).exists()).toBe(false)
    })

    it.each(rejectedGeneratedContent.filter(([, source]) => !source.startsWith('---')))('keeps %s refused between good blocks', async (_name, source) => {
      const wrapper = await mountAt(surface, `Good **intro**.\n\n${source}\n\nGood *outro*.`)
      await vi.waitFor(() => expect(wrapper.find('em').exists()).toBe(true))
      expect(wrapper.find('strong').text()).toBe('intro')
      expect(wrapper.findAll(refusedBlock).map(block => block.element.textContent)).toEqual([source])
      expect(wrapper.find('a, svg:not(.lucide), iframe, video, form, input, math, style, img, citation, generated-canary, .canary, #canary, [title]').exists()).toBe(false)
    })
  })

  it('keeps citation controls in a refused chat block and links literal', async () => {
    const wrapper = await mountAt('chat', 'Good **intro** [1].\n\nInline <b>markup</b> here [1].\n\nSee [the page](/app/private) for x < y [2].')
    await vi.waitFor(() => expect(wrapper.findAll(refusedBlock)).toHaveLength(2))
    const [markup, link] = wrapper.findAll(refusedBlock)
    expect(markup!.findAll('button')).toHaveLength(0)
    expect(link!.find('a').exists()).toBe(false)
    expect(link!.findAll('button[aria-label^="Source 2"]')).toHaveLength(1)
    await link!.find('button').trigger('click')
    expect(wrapper.emitted('citation-click')).toEqual([[2]])
  })

  it('refuses only the open block at every prefix of good content', async () => {
    const results = await Promise.all(goodMarkdownCorpus.flatMap(({ source }) => Array.from(source, async (_, length) => {
      const prefix = source.slice(0, length + 1)
      const { body, tailRefused } = await parseGeneratedMarkdown(prefix, context)
      return { prefix, settledRefusals: JSON.stringify(body).split('data-generated-refused').length - 1 - (tailRefused ? 1 : 0) }
    })))
    expect(results.filter(result => result.settledRefusals > 0)).toEqual([])
  }, 120_000)

  const refusalsShownWhileStreaming = async (source: string) => {
    const wrapper = await mountSuspended(Message, { props: { role: 'assistant', content: '', sources: createSources(2), streaming: true, animate: false } })
    wrappers.push(wrapper)
    const shown: string[] = []
    const observer = new MutationObserver(() => {
      const block = wrapper.element.querySelector?.(refusedBlock)
      if (block) shown.push(block.textContent ?? '')
    })
    observer.observe(wrapper.element, { childList: true, subtree: true, characterData: true })
    for (let length = 3; length < source.length; length += 3) {
      await wrapper.setProps({ content: source.slice(0, length) })
      await parseGeneratedMarkdown(source.slice(0, length), context)
      await flushPromises()
    }
    await wrapper.setProps({ content: source })
    await parseGeneratedMarkdown(source, context)
    await flushPromises()
    observer.disconnect()
    return { shown, wrapper }
  }

  it.each(goodMarkdownCorpus)('never shows a refused block while streaming $name', async ({ source, selectors }) => {
    const { shown, wrapper } = await refusalsShownWhileStreaming(source)
    await wrapper.setProps({ streaming: false })
    await vi.waitFor(() => expect(wrapper.find(selectors[0]!).exists()).toBe(true))
    expect(shown).toEqual([])
    expect(wrapper.find(refusedBlock).exists()).toBe(false)
  }, 60_000)

  it('shows a refused block during streaming once it is settled', async () => {
    const { shown } = await refusalsShownWhileStreaming('Good **intro**.\n\nInline <b>markup</b> here.\n\nGood *outro*.')
    expect(shown.at(-1)).toBe('Inline <b>markup</b> here.')
  }, 60_000)
})
