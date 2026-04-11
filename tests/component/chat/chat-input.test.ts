import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const chatInputPath = ['~', 'components', 'chat', 'ChatInput.vue'].join('/')

describe('ChatInput — AC #6', () => {
  it('[P0] should emit submit with trimmed message when Enter is pressed', async () => {
    const ChatInput = await import(chatInputPath)

    const wrapper = await mountSuspended(ChatInput.default, {
      props: {
        placeholder: 'Ask about your materials...',
      },
    })

    const textarea = wrapper.find('textarea')
    await textarea.setValue('What is photosynthesis?')
    await textarea.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('submit')).toBeTruthy()
    expect(wrapper.emitted('submit')![0]).toEqual(['What is photosynthesis?'])
  })

  it('[P0] should insert newline on Shift+Enter instead of submitting', async () => {
    const ChatInput = await import(chatInputPath)

    const wrapper = await mountSuspended(ChatInput.default)

    const textarea = wrapper.find('textarea')
    await textarea.setValue('Line 1')
    await textarea.trigger('keydown', { key: 'Enter', shiftKey: true })

    expect(wrapper.emitted('submit')).toBeFalsy()
  })

  it('[P0] should prevent empty or whitespace-only submissions', async () => {
    const ChatInput = await import(chatInputPath)

    const wrapper = await mountSuspended(ChatInput.default)

    const textarea = wrapper.find('textarea')
    await textarea.setValue('   ')
    await textarea.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('submit')).toBeFalsy()
  })

  it('[P0] should disable textarea and send button when disabled prop is true', async () => {
    const ChatInput = await import(chatInputPath)

    const wrapper = await mountSuspended(ChatInput.default, {
      props: {
        disabled: true,
      },
    })

    const textarea = wrapper.find('textarea')
    expect(textarea.attributes('disabled')).toBeDefined()

    const sendButton = wrapper.find('button')
    expect(sendButton.attributes('disabled')).toBeDefined()
  })

  it('[P1] should disable send button when input is empty', async () => {
    const ChatInput = await import(chatInputPath)

    const wrapper = await mountSuspended(ChatInput.default)

    const sendButton = wrapper.find('button')
    expect(sendButton.attributes('disabled')).toBeDefined()
  })

  it('[P1] should expose focus() method via defineExpose', async () => {
    const ChatInput = await import(chatInputPath)

    const wrapper = await mountSuspended(ChatInput.default)

    expect(typeof wrapper.vm.focus).toBe('function')
  })
})
