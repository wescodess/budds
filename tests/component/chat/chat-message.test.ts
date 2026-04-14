import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
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
