import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const chatInputPath = ['~', 'components', 'chat', 'Input.vue'].join('/')

async function setComposerText(wrapper: any, value: string) {
  const editor = wrapper.get('[data-testid="chat-composer-editor"]')
  ;(editor.element as HTMLDivElement).textContent = value
  await editor.trigger('input')
  return editor
}

describe('ChatInput — AC #6', () => {
  it('[P0] should emit submit with trimmed message when Enter is pressed', async () => {
    const ChatInput = await import(chatInputPath)

    const wrapper = await mountSuspended(ChatInput.default, {
      props: {
        placeholder: 'Ask about your materials...',
      },
    })

    const editor = await setComposerText(wrapper, 'What is photosynthesis?')
    await editor.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('submit')).toBeTruthy()
    expect(wrapper.emitted('submit')![0]).toEqual(['What is photosynthesis?'])
  })

  it('[P0] should insert newline on Shift+Enter instead of submitting', async () => {
    const ChatInput = await import(chatInputPath)

    const wrapper = await mountSuspended(ChatInput.default)

    const editor = await setComposerText(wrapper, 'Line 1')
    await editor.trigger('keydown', { key: 'Enter', shiftKey: true })

    expect(wrapper.emitted('submit')).toBeFalsy()
  })

  it('[P0] should prevent empty or whitespace-only submissions', async () => {
    const ChatInput = await import(chatInputPath)

    const wrapper = await mountSuspended(ChatInput.default)

    const editor = await setComposerText(wrapper, '   ')
    await editor.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('submit')).toBeFalsy()
  })

  it('[P0] should disable the editor and send button when disabled prop is true', async () => {
    const ChatInput = await import(chatInputPath)

    const wrapper = await mountSuspended(ChatInput.default, {
      props: {
        disabled: true,
      },
    })

    const editor = wrapper.get('[data-testid="chat-composer-editor"]')
    expect(editor.attributes('contenteditable')).toBe('false')
    expect(editor.attributes('aria-disabled')).toBe('true')

    const sendButton = wrapper.get('[data-testid="chat-send-button"]')
    expect(sendButton.attributes('disabled')).toBeDefined()
  })

  it('[P1] should disable send button when input is empty', async () => {
    const ChatInput = await import(chatInputPath)

    const wrapper = await mountSuspended(ChatInput.default)

    const sendButton = wrapper.get('[data-testid="chat-send-button"]')
    expect(sendButton.attributes('disabled')).toBeDefined()
  })

  it('[P1] should expose focus() method via defineExpose', async () => {
    const ChatInput = await import(chatInputPath)

    const wrapper = await mountSuspended(ChatInput.default)

    expect(typeof wrapper.vm.focus).toBe('function')
  })
})
