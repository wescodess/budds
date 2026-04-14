import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const folderPagePath = ['~', 'pages', 'app', 'folders', '[id].vue'].join('/')

describe('Folder Chat — AC4: New Chat Button', () => {
  it.skip('[P0] should render a "New Chat" button in the chat tab header', async () => {
    const FolderPage = await import(folderPagePath)
    const wrapper = await mountSuspended(FolderPage.default)

    const newChatButton = wrapper.find('[data-testid="chat-new-button"]')
    expect(newChatButton.exists()).toBe(true)
    expect(newChatButton.text()).toContain('New Chat')
  })

  it.skip('[P0] should clear messages when "New Chat" is clicked', async () => {
    const FolderPage = await import(folderPagePath)
    const wrapper = await mountSuspended(FolderPage.default)

    const newChatButton = wrapper.find('[data-testid="chat-new-button"]')
    expect(newChatButton.exists()).toBe(true)

    await newChatButton.trigger('click')

    const messages = wrapper.findAll('[data-testid="chat-message"]')
    expect(messages).toHaveLength(0)
  })
})

describe('Folder Chat — AC4: Cmd/Ctrl+N Keyboard Shortcut', () => {
  it.skip('[P0] should start a new conversation when Cmd+N / Ctrl+N fires outside an input', async () => {
    const FolderPage = await import(folderPagePath)
    const wrapper = await mountSuspended(FolderPage.default)

    const shortcut = new KeyboardEvent('keydown', {
      key: 'n',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(shortcut)

    await wrapper.vm.$nextTick()

    expect(shortcut.defaultPrevented).toBe(true)

    const messages = wrapper.findAll('[data-testid="chat-message"]')
    expect(messages).toHaveLength(0)
  })

  it.skip('[P0] should NOT fire when focus is inside a TEXTAREA', async () => {
    const FolderPage = await import(folderPagePath)
    const wrapper = await mountSuspended(FolderPage.default)

    const textarea = wrapper.find('textarea')
    expect(textarea.exists()).toBe(true)
    ;(textarea.element as HTMLTextAreaElement).focus()

    const shortcut = new KeyboardEvent('keydown', {
      key: 'n',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    textarea.element.dispatchEvent(shortcut)

    expect(shortcut.defaultPrevented).toBe(false)
  })

  it.skip('[P1] should NOT fire when activeTab is not "chat"', async () => {
    const FolderPage = await import(folderPagePath)
    const wrapper = await mountSuspended(FolderPage.default, {
      props: { initialTab: 'documents' },
    })

    const shortcut = new KeyboardEvent('keydown', {
      key: 'n',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(shortcut)

    expect(shortcut.defaultPrevented).toBe(false)
  })
})

describe('useChat — Conversation Persistence Surface', () => {
  it.skip('[P0] should expose currentConversationId, loadConversation, startNewConversation', async () => {
    const mod = await import('~/composables/useChat')
    const exported = Object.keys(mod.useChat.toString())
    expect(typeof mod.useChat).toBe('function')

    const folderRef = ref('folder_id' as unknown as import('../../../convex/_generated/dataModel').Id<'folders'>)
    const chat = (mod.useChat as any)(folderRef)
    expect(chat.currentConversationId).toBeDefined()
    expect(typeof chat.loadConversation).toBe('function')
    expect(typeof chat.startNewConversation).toBe('function')

    void exported
  })
})
