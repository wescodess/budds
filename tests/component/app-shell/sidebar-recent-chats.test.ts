import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import DefaultLayout from '~/layouts/default.vue'

describe('Sidebar Recent Chats — AC3: Populated List', () => {
  it.skip('[P0] should render up to 20 recent conversations with title and parent folder name', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const group = wrapper.find('[data-testid="sidebar-chats-group"]')
    expect(group.exists()).toBe(true)

    const items = wrapper.findAll('[data-testid="sidebar-chat-item"]')
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThanOrEqual(20)

    const first = items[0]
    expect(first.text()).toMatch(/.+/)
    const folderLabel = first.find('.text-muted-foreground')
    expect(folderLabel.exists()).toBe(true)
  })

  it.skip('[P0] should expose data-conversation-id on each row', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const items = wrapper.findAll('[data-testid="sidebar-chat-item"]')
    expect(items.length).toBeGreaterThan(0)
    items.forEach((item) => {
      expect(item.attributes('data-conversation-id')).toBeDefined()
    })
  })

  it.skip('[P1] should link each row to /app/folders/{folderId}?conversationId={id}', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const items = wrapper.findAll('[data-testid="sidebar-chat-item"]')
    expect(items.length).toBeGreaterThan(0)

    const link = items[0].find('a')
    expect(link.exists()).toBe(true)
    const href = link.attributes('href') || ''
    expect(href).toMatch(/^\/app\/folders\/[^/]+\?conversationId=.+$/)
  })

  it.skip('[P1] should preserve existing empty state when user has zero conversations', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const empty = wrapper.find('[data-testid="sidebar-chats-empty"]')
    expect(empty.exists()).toBe(true)
    expect(empty.text()).toContain('No recent chats')

    const items = wrapper.findAll('[data-testid="sidebar-chat-item"]')
    expect(items).toHaveLength(0)
  })

  it.skip('[P1] should truncate long titles to a single line', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const items = wrapper.findAll('[data-testid="sidebar-chat-item"]')
    items.forEach((item) => {
      const title = item.find('.truncate')
      expect(title.exists()).toBe(true)
    })
  })
})

describe('Sidebar Recent Chats — AC5: Delete Flow', () => {
  it.skip('[P0] should render a kebab action trigger for each row', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const items = wrapper.findAll('[data-testid="sidebar-chat-item"]')
    expect(items.length).toBeGreaterThan(0)

    items.forEach((item) => {
      const action = item.find('[data-testid^="sidebar-chat-actions-"]')
      expect(action.exists()).toBe(true)
    })
  })

  it.skip('[P0] should open an AlertDialog with "Delete conversation?" on delete action', async () => {
    const wrapper = await mountSuspended(DefaultLayout)

    const item = wrapper.find('[data-testid="sidebar-chat-item"]')
    expect(item.exists()).toBe(true)

    const deleteTrigger = item.find('[data-testid^="sidebar-chat-delete-"]')
    expect(deleteTrigger.exists()).toBe(true)
    await deleteTrigger.trigger('click')

    const dialog = document.body.querySelector('[data-testid="delete-conversation-dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.textContent).toContain('Delete conversation?')
  })
})
