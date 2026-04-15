import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { createAssistantMessage, createUserMessage, createSources } from '../../support/factories/chat.factory'

const chatMessagePath = ['~', 'components', 'chat', 'Message.vue'].join('/')

describe('ChatMessage — AC #1, #2', () => {
  it('[P0] should render user message with bg-muted and right-aligned', async () => {
    const ChatMessage = await import(chatMessagePath)
    const msg = createUserMessage({ content: 'What is photosynthesis?' })

    const wrapper = await mountSuspended(ChatMessage.default, {
      props: {
        role: msg.role,
        content: msg.content,
      },
    })

    expect(wrapper.text()).toContain('What is photosynthesis?')
    const el = wrapper.find('[data-testid="chat-message"]')
    expect(el.classes()).toEqual(expect.arrayContaining([expect.stringContaining('bg-muted')]))
  })

  it('[P0] should render assistant message with border and left-aligned', async () => {
    const ChatMessage = await import(chatMessagePath)
    const msg = createAssistantMessage({ content: 'Photosynthesis is the process...' })

    const wrapper = await mountSuspended(ChatMessage.default, {
      props: {
        role: msg.role,
        content: msg.content,
        sources: msg.sources,
      },
    })

    expect(wrapper.text()).toContain('Photosynthesis is the process')
    const el = wrapper.find('[data-testid="chat-message"]')
    expect(el.classes()).toEqual(expect.arrayContaining([expect.stringContaining('border')]))
  })

  it('[P0] should parse [1], [2] tokens into CitationBadge components in assistant messages', async () => {
    const ChatMessage = await import(chatMessagePath)
    const sources = createSources(2, { filename: 'biology.pdf' })

    const wrapper = await mountSuspended(ChatMessage.default, {
      props: {
        role: 'assistant',
        content: 'The answer is here [1] and also here [2].',
        sources,
      },
    })

    const badges = wrapper.findAll('button[type="button"]')
    expect(badges.length).toBeGreaterThanOrEqual(2)
    expect(wrapper.text()).toContain('1')
    expect(wrapper.text()).toContain('2')
    expect(wrapper.text()).not.toContain(':citation[')
    expect(wrapper.html()).not.toContain('<citation')
  })

  it('[P1] should wrap message list in role="log" with aria-label', async () => {
    const ChatMessage = await import(chatMessagePath)

    const wrapper = await mountSuspended(ChatMessage.default, {
      props: {
        role: 'user',
        content: 'Test message',
      },
    })

    const messageEl = wrapper.find('[data-testid="chat-message"]')
    expect(messageEl.attributes('aria-label')).toBeTruthy()
  })

  it('[P1] should not render CitationBadges for user messages even if sources provided', async () => {
    const ChatMessage = await import(chatMessagePath)

    const wrapper = await mountSuspended(ChatMessage.default, {
      props: {
        role: 'user',
        content: 'My question [1] about something',
      },
    })

    const badges = wrapper.findAll('button[type="button"]')
    expect(badges.length).toBe(0)
  })
})

describe('ChatMessage — streaming (AC #1, #3)', () => {
  it('[P0] should render blinking cursor when streaming=true on assistant message', async () => {
    const ChatMessage = await import(chatMessagePath)

    const wrapper = await mountSuspended(ChatMessage.default, {
      props: {
        role: 'assistant',
        content: 'Generating response...',
        streaming: true,
      },
    })

    const cursor = wrapper.find('[data-testid="streaming-cursor"]')
    expect(cursor.exists()).toBe(true)
  })

  it('[P0] should not render cursor when streaming=false', async () => {
    const ChatMessage = await import(chatMessagePath)

    const wrapper = await mountSuspended(ChatMessage.default, {
      props: {
        role: 'assistant',
        content: 'Complete response.',
        streaming: false,
      },
    })

    const cursor = wrapper.find('[data-testid="streaming-cursor"]')
    expect(cursor.exists()).toBe(false)
  })

  it('[P0] should not render cursor for user messages even with streaming=true', async () => {
    const ChatMessage = await import(chatMessagePath)

    const wrapper = await mountSuspended(ChatMessage.default, {
      props: {
        role: 'user',
        content: 'My question',
        streaming: true,
      },
    })

    const cursor = wrapper.find('[data-testid="streaming-cursor"]')
    expect(cursor.exists()).toBe(false)
  })
})

describe('ChatMessage — markdown degradation', () => {
  afterEach(() => {
    vi.doUnmock('@nuxtjs/mdc/runtime')
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('[P0] should retry assistant markdown parsing without highlighting before raw-text fallback', async () => {
    vi.resetModules()

    vi.doMock('@nuxtjs/mdc/runtime', async () => {
      const actual = await vi.importActual<typeof import('@nuxtjs/mdc/runtime')>('@nuxtjs/mdc/runtime')
      const parseMarkdown = vi.fn(actual.parseMarkdown)

      parseMarkdown.mockRejectedValueOnce(new Error('highlight failed'))

      return {
        ...actual,
        parseMarkdown,
      }
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ChatMessage = await import(chatMessagePath)

    const wrapper = await mountSuspended(ChatMessage.default, {
      props: {
        role: 'assistant',
        content: 'Key points:\n\n- First item\n- Second item',
      },
    })

    await flushPromises()

    const { parseMarkdown } = await import('@nuxtjs/mdc/runtime')
    const parseMarkdownMock = vi.mocked(parseMarkdown)

    expect(parseMarkdownMock).toHaveBeenCalledTimes(2)
    expect(parseMarkdownMock.mock.calls[0]?.[1]).toEqual({
      toc: false,
      contentHeading: false,
    })
    expect(parseMarkdownMock.mock.calls[1]?.[1]).toEqual({
      toc: false,
      contentHeading: false,
      highlight: false,
    })
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).not.toHaveBeenCalled()
    expect(wrapper.findAll('li')).toHaveLength(2)
    expect(wrapper.text()).toContain('First item')
    expect(wrapper.text()).toContain('Second item')
  })

  it('[P0] should render citation badges in fallback mode when markdown parsing keeps failing', async () => {
    vi.resetModules()

    vi.doMock('@nuxtjs/mdc/runtime', async () => {
      const actual = await vi.importActual<typeof import('@nuxtjs/mdc/runtime')>('@nuxtjs/mdc/runtime')

      return {
        ...actual,
        parseMarkdown: vi.fn().mockRejectedValue(new Error('parse failed')),
      }
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ChatMessage = await import(chatMessagePath)
    const sources = createSources(1, { filename: 'biology.pdf' })

    const wrapper = await mountSuspended(ChatMessage.default, {
      props: {
        role: 'assistant',
        content: 'Context [1]',
        sources,
      },
    })

    await flushPromises()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Context')
    expect(wrapper.findAll('button[type="button"]')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('<citation')
    expect(wrapper.text()).not.toContain(':citation[')
  })
})
